'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../xiaobai-multi-protocol.js'),C=require('../xiaobai-condition-protocol.js');
const {KIND:K,STATE:S,REASON:R}=M;
const vectors=require('./fixtures/message_group_vectors_v1.json').vectors;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let n=0;n<300&&!fn();n++)await sleep(2);assert.ok(fn(),'expected protocol event');}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const random={getRandomValues(a){a[0]=0x12345678;a[1]=0x9abcdef0;return a;}};
function mock({flags=7,handler,timing={},paused=false}={}){
  const listeners=new Set(),life=new Set(),writes=[],queued=[],aborts=[];let bootstrapping=false;
  const reply=(m,state,reason=0,extra=[],changes={})=>{
    const bytes=M.encode({...m,kind:m.kind|0x80,args:[state,reason,...extra],...changes},true);
    for(const cb of [...listeners])cb(bytes);
  };
  const link={closed:false,programLinkToken:0x9abcdef0,nextProgramRunSerial(){return this.runSerial=(this.runSerial||0)+1;},subscribeMulti(cb){listeners.add(cb);return()=>listeners.delete(cb);},onLifecycle(cb){life.add(cb);return()=>life.delete(cb);},
    write(bytes,guard=()=>true,before=()=>{},options={}){
      const send=async()=>{
        if(!guard())return false;before();const m=M.decode(bytes);writes.push({...m,priority:options.priority});
        if(!bootstrapping&&handler&&await handler(m,reply)===false)return true;
        if(m.kind===K.START)reply(m,S.READY);
        else if(m.kind===K.OPEN||m.kind===K.GROUP_OPEN)reply(m,S.ACCEPTED);
        else if(m.kind===K.COMMIT||m.kind===K.GROUP_BEGIN)reply(m,S.READY);
        else if(m.kind===K.STOP)reply(m,S.CANCELLED);
        else if(m.kind===K.GROUP_FINISH||m.kind===K.CLOSE||m.kind===K.GROUP_END)reply(m,S.DONE);
        else if(m.kind>=12&&m.kind<=15&&m.kind!==K.OBSERVER_ACK)reply(m,m.kind===K.OBSERVER_CLOSE?S.CANCELLED:S.READY,0,m.args.slice(0,4));
        return true;
      };
      return paused?new Promise((resolve,reject)=>queued.push(()=>send().then(resolve,reject))):send();
    },emitLife(error){for(const cb of [...life])cb(error);}};
  const client=new M.SessionClient(link,{crypto:random,timing:{queueMs:300,controlMs:100,acceptMs:100,queryMs:10000,statusMs:30000,finishPollMs:3,...timing},onAbort:e=>aborts.push(e)});
  return {client,link,writes,queued,reply,listeners,aborts,async openIdle(count){bootstrapping=true;try{await client.open(count,{initialGroups:[count]});await client.finishGroup(count,count);}finally{bootstrapping=false;}writes.length=0;},sent:kind=>writes.filter(m=>m.kind===kind),pause(value){paused=value;}};
}
const frame={sessionLo:1,sessionHi:2,kind:K.GROUP_BEGIN,group:1,task:2,opcode:0,args:[]};

test('all 39 official message-group vectors round-trip; scoped condition D4 is exactly22 payload bytes',()=>{
  assert.equal(vectors.length,39);
  for(const v of vectors){
    const bytes=Uint8Array.from(Buffer.from(v.hex.replace(/ /g,''),'hex')),m=M.decode(bytes);
    assert.equal(bytes.length,v.bytes,v.name);assert.equal(bytes[3],v.payloadBytes,v.name);assert.deepEqual(M.encode(m),bytes,v.name);
    if((m.kind&127)>=12&&(m.kind&127)<=15){
      const condition=C.decode(bytes);assert.equal(condition.reusable,true,v.name);assert.equal(condition.runId,M.read32(m.args,m.response?2:0),v.name);
      assert.deepEqual(C.encode(condition),bytes,v.name);if(m.response)assert.equal(bytes[3],22,v.name);
    }
  }
  for(const kind of [K.GROUP_BEGIN,K.GROUP_FINISH])assert.equal(M.decode(M.encode({...frame,kind})).kind,kind);
});

test('START declares only active mask, no CAPS; CLOSE permits untouched idle listener groups',async t=>{
  const f=mock();t.after(()=>f.client.dispose());const ready=await f.client.open(4,{initialGroups:[1]});assert.equal(ready.reusable,true);assert.deepEqual(f.sent(K.START)[0].args,[1]);assert.equal(f.sent(K.CAPS).length+f.sent(K.OPEN).length+f.sent(K.GROUP_OPEN).length+f.sent(K.COMMIT).length,0);
  await assert.rejects(f.client.close(),{code:'BUSY'});await f.client.finishGroup(1,1);await f.client.close();assert.equal(f.sent(K.GROUP_END).length,0);
  const old=mock({flags:1});t.after(()=>old.client.dispose());await old.client.open(1);assert.deepEqual(old.sent(K.START)[0].args,[1]);
  const absent=mock();absent.link.programLinkToken=0;t.after(()=>absent.client.dispose());await assert.rejects(absent.client.open(1),{code:'MODE'});assert.equal(absent.sent(K.START).length,0);
});

test('BEGIN is gated by real READY; BEGIN/ACTION use one acceptance FIFO and dispatch allocator',async t=>{
  const f=mock({handler(m){if(m.kind===K.ACTION||m.kind===K.GROUP_BEGIN&&m.group===3)return false;}});t.after(()=>f.client.dispose());await f.openIdle(3);
  const a=await f.client.beginGroup(1),b=await f.client.beginGroup(2);assert.equal(typeof a,'number');assert.ok(b>a);
  const one=f.client.action(1,0x41,[1],{invocationId:a}),two=f.client.action(2,0x41,[2],{invocationId:b}),third=f.client.beginGroup(3);
  await until(()=>f.sent(K.ACTION).length===1);assert.equal(f.sent(K.GROUP_BEGIN).length,2);assert.equal(f.client.counter,7);
  f.reply(f.sent(K.ACTION)[0],S.ACCEPTED);await until(()=>f.sent(K.ACTION).length===2);assert.equal(f.sent(K.GROUP_BEGIN).length,2);assert.equal(f.client.counter,8);
  f.reply(f.sent(K.ACTION)[1],S.APPLIED);await two;await until(()=>f.sent(K.GROUP_BEGIN).length===3);
  const req=f.sent(K.GROUP_BEGIN)[2];let started=false;third.then(()=>started=true);f.reply(req,S.ACCEPTED);await flush();assert.equal(started,false);
  await assert.rejects(f.client.action(3,0x41,[3],{invocationId:req.task}),{code:'STALE'});
  f.reply(req,S.READY,0,[],{task:req.task+1});f.reply(req,S.READY,0,[],{sessionHi:22});await flush();assert.equal(started,false);
  f.reply(req,S.READY);assert.equal(await third,9);f.reply(f.sent(K.ACTION)[0],S.APPLIED);await one;
  const dispatch=f.writes.filter(m=>m.kind===K.ACTION||m.kind===K.GROUP_BEGIN);assert.deepEqual(dispatch.map(m=>m.task),[5,6,7,8,9]);assert.ok(dispatch.every(m=>m.priority===10));
  assert.equal(f.sent(K.ACK).filter(m=>m.opcode===0).length,0,'lifecycle has no new ACK shape');
});

test('BEGIN retries keep the invocation id, and stale lifecycle replies cannot finish a later run',async t=>{
  let attempts=0;const f=mock({handler(m){if(m.kind===K.GROUP_BEGIN&&++attempts===1)return false;},timing:{controlMs:10,retries:1}});t.after(()=>f.client.dispose());await f.openIdle(1);
  const first=await f.client.beginGroup(1);assert.equal(f.sent(K.GROUP_BEGIN).length,2);assert.equal(f.sent(K.GROUP_BEGIN)[0].task,f.sent(K.GROUP_BEGIN)[1].task);
  await f.client.finishGroup(1,first);const second=await f.client.beginGroup(1);assert.ok(second>first);
  f.reply({...f.sent(K.GROUP_FINISH)[0]},S.FAILED,R.EXPIRED);f.reply({...f.sent(K.GROUP_BEGIN)[0]},S.FAILED,R.EXPIRED);
  assert.equal(f.client.invocations.get(1).id,second);assert.equal(f.client.phase,'active');await assert.rejects(f.client.action(1,0x41,[1],{invocationId:first}),{code:'STALE'});
  assert.equal(f.aborts.length,0);
});

test('a resource-blocked second PLAY cannot starve other BEGIN/ACTION or consume their queue deadlines',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});t.after(()=>t.mock.timers.reset());
  const f=mock({timing:{queueMs:2500},handler(m,reply){if(m.kind===K.ACTION){reply(m,S.APPLIED);return false;}}});t.after(()=>f.client.dispose());await f.openIdle(3);
  const one=await f.client.beginGroup(1),two=await f.client.beginGroup(2);await f.client.action(1,0x50,[1],{invocationId:one});const old=f.sent(K.ACTION).at(-1);
  const replacement=f.client.action(1,0x50,[2],{invocationId:one}),display=f.client.action(2,0x41,[9],{invocationId:two}),third=f.client.beginGroup(3);
  await display;const three=await third;assert.ok(three>f.sent(K.ACTION).at(-1).task);assert.equal(f.sent(K.ACTION).filter(m=>m.opcode===0x50).length,1);
  t.mock.timers.tick(3000);await flush();assert.equal(f.aborts.length,0);assert.equal(f.client.phase,'active');
  f.reply(old,S.RELEASED);await replacement;const next=f.sent(K.ACTION).at(-1);assert.equal(next.opcode,0x50);assert.ok(next.task>three,'blocked PLAY receives its identity at eventual dispatch');
});

test('FINISH polls the identical request through BUSY/ACCEPTED, releases other groups, and waits for real DONE',async t=>{
  let polls=0;const f=mock({handler(m,reply){if(m.kind===K.GROUP_FINISH){reply(m,++polls===1?S.FAILED:S.ACCEPTED,polls===1?R.BUSY:0);return false;}}});t.after(()=>f.client.dispose());await f.openIdle(2);
  const id=await f.client.beginGroup(1),counter=f.client.counter;const ending=f.client.finishGroup(1,id);let finished=false;ending.then(()=>finished=true);
  assert.strictEqual(ending,f.client.finishGroup(1,id));await assert.rejects(f.client.beginGroup(1),{code:'BUSY'});await assert.rejects(f.client.action(1,0x41,[1],{invocationId:id}),{code:'STALE'});await assert.rejects(f.client.close(),{code:'BUSY'});
  const other=await f.client.beginGroup(2);assert.ok(other>id);await until(()=>f.sent(K.GROUP_FINISH).length>=3);assert.equal(finished,false);assert.equal(f.aborts.length,0);
  const requests=f.sent(K.GROUP_FINISH);assert.ok(requests.every(m=>m.task===id&&m.group===1&&m.opcode===0&&m.args.length===0&&m.priority===10));assert.equal(f.client.counter,counter+1);
  f.reply(requests[0],S.DONE,0,[],{group:2});await flush();assert.equal(finished,false);f.reply(requests[0],S.DONE);const done=await ending;
  assert.equal(done.state,S.DONE);assert.equal(done.task,id);assert.equal(f.client.invocations.get(1).phase,'idle');assert.deepEqual(await f.client.finishGroup(1,id),done);
  const count=f.sent(K.GROUP_FINISH).length;await sleep(10);assert.equal(f.sent(K.GROUP_FINISH).length,count);const next=await f.client.beginGroup(1);assert.ok(next>other);
});

test('FINISH accepts only same-invocation planned lease CANCELLED, waits for DONE and cleans old queries',async t=>{
  const f=mock({handler(m,reply){if(m.kind===K.ACTION){reply(m,S.APPLIED);return false;}if(m.kind===K.GROUP_FINISH){for(const action of f.sent(K.ACTION).filter(a=>a.group===m.group))reply(action,S.CANCELLED);reply(m,S.ACCEPTED);return false;}}});t.after(()=>f.client.dispose());await f.openIdle(2);
  const id=await f.client.beginGroup(1);await f.client.action(1,0x11,[0,1],{invocationId:id});await f.client.action(1,0x50,[1],{invocationId:id});
  const old=f.sent(K.ACTION).slice();assert.equal([...f.client.records.values()].filter(r=>r.lease).length,2);
  const finishing=f.client.finishGroup(1,id);await until(()=>f.sent(K.GROUP_FINISH).length===1);await flush();assert.equal(f.client.phase,'active');assert.equal(f.aborts.length,0);assert.equal(f.client.invocations.get(1).phase,'finishing');
  assert.equal([...f.client.records.values()].filter(r=>r.lease).length,0);f.reply(f.sent(K.GROUP_FINISH)[0],S.DONE);await finishing;
  const next=await f.client.beginGroup(1);for(const action of old)f.reply(action,S.CANCELLED);assert.equal(f.client.invocations.get(1).id,next);assert.equal(f.aborts.length,0);
  await f.client.action(1,0x50,[2],{invocationId:next});assert.equal(f.sent(K.ACTION).length,3,'old player lease cannot block next run');
  const live=f.sent(K.ACTION).at(-1);f.reply(live,S.CANCELLED);await until(()=>f.aborts.length===1);assert.equal(f.aborts[0].task,live.task,'unexpected running cancellation still aborts');
});

test('FINISH keeps a fixed minimum10s deadline, never turns ACCEPTED into DONE and stops on expiry',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});t.after(()=>t.mock.timers.reset());
  const f=mock({timing:{finishMs:1,finishPollMs:500},handler(m,reply){if(m.kind===K.GROUP_FINISH){reply(m,S.ACCEPTED);return false;}}});t.after(()=>f.client.dispose());await f.openIdle(1);const id=await f.client.beginGroup(1);
  const ending=f.client.finishGroup(1,id),rejection=assert.rejects(ending,{code:'FINISH_TIMEOUT'});await flush();assert.equal(f.client.timing.finishMs,10000);
  t.mock.timers.tick(8000);await flush();assert.equal(f.client.invocations.get(1).phase,'finishing');assert.equal(f.aborts.length,0);
  t.mock.timers.tick(1999);await flush();assert.equal(f.aborts.length,0);t.mock.timers.tick(1);await flush();await rejection;
  assert.equal(f.aborts.length,1);assert.equal(f.sent(K.STOP).length,1);assert.notEqual(f.client.invocations.get(1).phase,'idle');
});

test('STOP, lifecycle invalidation and dispose reject pending BEGIN/FINISH and queued ACTION without resurrection',async t=>{
  for(const mode of ['stop','lifecycle','dispose']){
    const f=mock({handler(m){if(m.kind===K.GROUP_BEGIN&&m.group===2||m.kind===K.GROUP_FINISH)return false;}});t.after(()=>f.client.dispose());await f.openIdle(2);const first=await f.client.beginGroup(1);
    const pending=f.client.beginGroup(2),ending=f.client.finishGroup(1,first);const p1=assert.rejects(pending),p2=assert.rejects(ending);await flush();
    if(mode==='stop')await f.client.stop('user stop');else if(mode==='lifecycle')f.link.emitLife('lost connection');else f.client.dispose();
    await Promise.all([p1,p2]);const count=f.writes.length;for(const m of f.sent(K.GROUP_BEGIN))f.reply(m,S.READY);await sleep(5);assert.equal(f.writes.length,count,mode);
  }
});

function observer(f,options={}){const faults=[],client=new C.ObserverClient(f.link,{session:{lo:123,hi:456},reusable:true,onFault:e=>faults.push(e),timing:{queueMs:200,replyMs:20,retries:1},...options});return {client,faults};}
const descriptor={kind:C.CONDITION.IR_GT,args:[50]};

test('scoped condition codec validates raw run prefix and all lengths, preserving old18B feedback separately',()=>{
  const base={sessionLo:123,sessionHi:456,kind:12,group:1,opcode:1,task:1,args:[...M.u32(6),50]};
  assert.equal(C.decode(C.encode(base)).runId,6);for(const patch of [{group:0},{args:[0,0,0,0,50]},{args:[6,0,0,50]},{args:[...M.u32(6),101]}])assert.throws(()=>C.encode({...base,...patch}));
  for(const kind of [13,14])assert.equal(C.decode(C.encode({...base,kind,args:M.u32(6)})).runId,6);
  assert.equal(C.decode(C.encode({...base,kind:15,args:[...M.u32(6),S.DONE]})).runId,6);
  assert.throws(()=>C.encode({...base,kind:15,args:[...M.u32(6),S.ACCEPTED]}));
  assert.equal(C.encode({...base,opcode:4,args:[...M.u32(6),...M.u32(1000)]})[3],24);
  const old=C.decode(C.encode({...base,kind:0x8c,args:[S.FAILED,R.EXPIRED]},true));assert.equal(old.reusable,false);assert.equal(old.runId,undefined);
});

test('every condition request captures runId; wrongrun/old18B/wrongSID/observer feedback cannot hit or abort',async t=>{
  const f=mock(),o=observer(f);t.after(()=>{o.client.dispose();f.client.dispose();});const h=await o.client.arm(1,descriptor,{runId:6}),arm=f.sent(12)[0];
  assert.equal(h.runId,6);assert.equal(h.id,1);assert.deepEqual(arm.args,[6,0,0,0,50]);
  for(const changes of [{args:[S.DONE,0,...M.u32(5)]},{args:[S.FAILED,R.EXPIRED]},{sessionHi:457},{task:2},{group:2}])f.reply(arm,S.DONE,0,M.u32(6),changes);
  assert.equal(h.matched,false);assert.equal(o.faults.length,0);
  const boundary=h.refresh();await boundary;assert.deepEqual(f.sent(13)[0].args,M.u32(6));
  f.reply(arm,S.DONE,0,M.u32(6));assert.equal(h.matched,true);await h.close();
  assert.deepEqual(f.sent(14)[0].args,M.u32(6));assert.ok(f.sent(15).every(m=>m.args.length===5&&M.read32(m.args)===6));assert.equal(o.faults.length,0);
});

test('retirement is idempotent, keeps observer IDs monotonic, and leaves other/new generations intact',async t=>{
  const f=mock(),o=observer(f);t.after(()=>{o.client.dispose();f.client.dispose();});o.client.retireGroup(4,100);o.client.retireGroup(4,100);
  const old=await o.client.arm(1,descriptor,{runId:6}),other=await o.client.arm(2,descriptor,{runId:7}),oldReq=f.sent(12)[0];
  await assert.rejects(o.client.arm(1,descriptor,{runId:8}),{code:'STALE'});o.client.retireGroup(1,6);assert.throws(()=>old.check(),{code:'CANCELLED'});
  const h=await o.client.arm(1,descriptor,{runId:8}),req=f.sent(12).at(-1);assert.equal(h.id,2);o.client.retireGroup(1,6);other.check();h.check();
  f.reply(oldReq,S.FAILED,R.EXPIRED,M.u32(6));f.reply(req,S.DONE,0,M.u32(6));assert.equal(h.matched,false);assert.equal(o.faults.length,0);
  f.reply(req,S.DONE,0,M.u32(8));assert.equal(h.matched,true);const count=f.writes.length;await old.close();assert.equal(f.writes.length,count);
});

test('queued ACK/CLOSE use captured generation and are cancelled on retirement, not retargeted to new run',async t=>{
  const f=mock(),o=observer(f);t.after(()=>{o.client.dispose();f.client.dispose();});const old=await o.client.arm(1,descriptor,{runId:6});await flush();
  f.pause(true);const req=f.sent(12)[0];f.reply(req,S.DONE,0,M.u32(6));await old.close({cancelled:true});assert.equal(f.queued.length,2);
  o.client.retireGroup(1,6);f.pause(false);const h=await o.client.arm(1,descriptor,{runId:8});const before=f.writes.length;
  for(const send of f.queued.splice(0))await send();assert.equal(f.writes.length,before,'retired writes fail their captured guards');
  assert.ok(f.sent(15).every(m=>M.read32(m.args)!==8||m.task===h.id));assert.equal(f.sent(14).length,0);h.check();assert.equal(o.faults.length,0);
});

test('ARM/QUERY retries preserve captured run, and retiring pending old work is local silent cancellation',async t=>{
  let arms=0;const f=mock({handler(m){if(m.kind===12&&++arms===1)return false;if(m.kind===13)return false;}}),o=observer(f);t.after(()=>{o.client.dispose();f.client.dispose();});
  const h=await o.client.arm(1,descriptor,{runId:6});assert.equal(f.sent(12).length,2);assert.ok(f.sent(12).every(m=>m.task===1&&M.read32(m.args)===6));
  const boundary=h.refresh(),rejection=assert.rejects(boundary,{code:'CANCELLED'});await until(()=>f.sent(13).length===1);o.client.retireGroup(1,6);await rejection;
  const next=await o.client.arm(1,descriptor,{runId:8});assert.equal(next.id,2);await sleep(25);assert.equal(f.sent(13).length,1);assert.equal(o.faults.length,0);
});

test('retirement between ARM feedback and its Promise continuation cannot return a usable old handle',async t=>{
  let observers;const f=mock({handler(m,reply){if(m.kind===12){reply(m,S.READY,0,m.args.slice(0,4));observers.retireGroup(m.group,M.read32(m.args));return false;}}});
  const o=observer(f);observers=o.client;t.after(()=>{o.client.dispose();f.client.dispose();});await assert.rejects(o.client.arm(1,descriptor,{runId:6}),{code:'CANCELLED'});assert.equal(o.faults.length,0);
});
