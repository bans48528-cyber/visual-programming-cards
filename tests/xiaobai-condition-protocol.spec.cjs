'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../xiaobai-condition-protocol.js'),M=require('../xiaobai-multi-protocol.js');
const {KIND:K,STATE:S,CONDITION:T}=C;
const vectors=require('./fixtures/motion_condition_vectors_v1.json').vectors;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let n=0;n<200&&!fn();n++)await pause(2);assert.ok(fn(),'expected condition state');}
function mock({session={lo:123,hi:456},handler,pcHandler,paused=false,timing={}}={}){
  const listeners=new Set(),lifecycle=new Set(),multiLifecycle=new Set(),writes=[],queued=[],faults=[];
  let current=true,runSerial=session.lo-1;
  const reply=(m,state,reason=0,changes={})=>{
    const packet=M.encode({...m,kind:m.kind|0x80,args:[state,reason],...changes},true);
    for(const fn of [...listeners])fn(packet);
  };
  const link={closed:false,programLinkToken:session.hi,nextProgramRunSerial(){return ++runSerial;},subscribeMulti(fn){listeners.add(fn);return()=>listeners.delete(fn);},onLifecycle(fn){lifecycle.add(fn);return()=>lifecycle.delete(fn);},onMultiLifecycle(fn){multiLifecycle.add(fn);return()=>multiLifecycle.delete(fn);},
    async write(bytes,guard=()=>true,before=()=>{},options={}){
      const send=async()=>{
        if(!guard())return false;before();const m=M.decode(bytes);writes.push({...m,priority:options.priority,bytes:Uint8Array.from(bytes)});
        if(m.kind>=K.ARM&&m.kind<=K.ACK){
          if(handler&&await handler(m,reply)===false)return true;
          if(m.kind===K.ARM||m.kind===K.QUERY)reply(m,S.READY);
          if(m.kind===K.CLOSE)reply(m,S.CANCELLED);
        }else{
          if(pcHandler&&await pcHandler(m,reply)===false)return true;
          if(m.kind===M.KIND.START)reply(m,M.STATE.READY);
          else if(m.kind===M.KIND.CAPS){const packet=M.encode({...m,kind:m.kind|0x80,args:[2,0,4,4,3,1,1,0,1,2,3,4,5,6,7,8]},true);for(const fn of [...listeners])fn(packet);}
          else if(m.kind===M.KIND.OPEN||m.kind===M.KIND.GROUP_OPEN||m.kind===M.KIND.ACTION)reply(m,1);
          else if(m.kind===M.KIND.COMMIT)reply(m,2);
          else if(m.kind===M.KIND.STOP)reply(m,6);
          else if(m.kind!==M.KIND.ACK&&m.kind!==M.KIND.HEARTBEAT)reply(m,3);
        }
        return true;
      };
      if(paused)return new Promise((resolve,reject)=>queued.push(()=>send().then(resolve,reject)));
      return send();
    }};
  const client=new C.ObserverClient(link,{session,isCurrent:()=>current,onFault:error=>faults.push(error),timing:{queueMs:200,replyMs:80,retries:1,...timing}});
  return {client,link,writes,queued,faults,reply,listeners,lifecycle,multiLifecycle,
    setCurrent(value){current=value;},emitLife(reason){for(const fn of [...lifecycle])fn(reason);},
    sent:kind=>writes.filter(m=>m.kind===kind)};
}
const descriptor={kind:T.IR_GT,args:[50]};

test('all24 frozen shared wire vectors round-trip; observer reply payload is exactly18',()=>{
  assert.equal(vectors.length,24);
  for(const vector of vectors){
    const bytes=Uint8Array.from(Buffer.from(vector.wire_hex,'hex'));
    assert.equal(bytes[3],Buffer.from(vector.payload_hex,'hex').length,vector.name);
    if(bytes[4]===0xc2){
      const P=require('../xiaobai-protocol.js');assert.deepEqual(P.command(bytes[5],bytes[6],Array.from(bytes.slice(7,15))),bytes,vector.name);continue;
    }
    const m=M.decode(bytes);assert.deepEqual(M.encode(m),bytes,vector.name);
    if((m.kind&0x7f)>=12){assert.deepEqual(C.encode(C.decode(bytes)),bytes);if(m.response)assert.equal(bytes[3],18);}
  }
});
test('strict codec bounds, legacy run identity and condition descriptors',()=>{
  const msg={kind:K.ARM,group:0,condition:T.TIME,observerId:1,session:{lo:10,hi:0},args:M.u32(0)};
  assert.equal(C.decode(C.encode(msg)).observerId,1);
  for(const patch of [{group:5},{session:{lo:0,hi:0}},{session:{lo:10,hi:1}},{observerId:0},{condition:0},{args:M.u32(0x80000000)}])assert.throws(()=>C.encode({...msg,...patch}));
  for(let v=0;v<256;v++){
    assert.equal(C.parameters(T.IR_GT,[v]),v<=100);
    assert.equal(C.parameters(T.IR_LT,[v]),v<=100);
    assert.equal(C.parameters(T.TILT,[v]),v>=2&&v<=5);
    assert.equal(M.actionArgs(0x34,[v]),v>=1&&v<=4);
  }
  assert.deepEqual(C.condition({id:'loop-infrared',params:{comparison:'less',threshold:31}}),{kind:2,args:[31]});
  assert.deepEqual(C.condition({id:'loop-tilt',params:{direction:'right'}}),{kind:3,args:[5]});
  assert.deepEqual(C.condition({id:'loop-time',params:{duration:0}}),{kind:4,args:[0,0,0,0]});
  assert.deepEqual(C.condition({id:'loop-time',params:{duration:5}}),{kind:4,args:[136,19,0,0]});
  assert.throws(()=>C.condition({id:'loop-time',params:{duration:2147483.648}}));
  assert.throws(()=>C.encode({...msg,kind:K.ACK,args:[1]}));
  assert.throws(()=>C.encode({...msg,kind:K.QUERY,args:[0]}));
  assert.throws(()=>C.encode({...msg,kind:K.ARM|0x80,args:[S.READY,7]},true));
});
test('ARM waits for hardware initial state; already-true TIME0 skips locally without a phone timer',async t=>{
  const f=mock({handler(m,reply){if(m.kind===K.ARM){if(m.opcode===T.TIME)reply(m,S.DONE);return false;}}});t.after(()=>f.client.dispose());
  const opening=f.client.arm(1,descriptor);await until(()=>f.sent(K.ARM).length===1);
  let ready=false;opening.then(()=>ready=true);await pause(5);assert.equal(ready,false);
  f.reply(f.sent(K.ARM)[0],S.READY);const handle=await opening;assert.equal(handle.matched,false);
  assert.ok(f.sent(K.ACK).some(m=>m.args[0]===S.READY));
  const zero=await f.client.arm(1,{kind:T.TIME,args:M.u32(0)});assert.equal(zero.matched,true);
  assert.equal(f.sent(K.QUERY).length,0);await handle.close();await zero.close();
});
test('fullidentity/condition and before-write quarantine; legacy and multi bindings cannot mix',async t=>{
  const f=mock({paused:true});t.after(()=>f.client.dispose());
  const opening=f.client.arm(2,descriptor);let done=false;opening.then(()=>done=true);
  const expected={kind:K.ARM,group:2,opcode:T.IR_GT,task:1,sessionLo:123,sessionHi:456};
  f.reply(expected,S.DONE);await pause(5);assert.equal(done,false,'unsent ARM cannot receive a stale DONE');
  await f.queued.shift()();const handle=await opening;
  for(const patch of [{sessionLo:124},{sessionHi:457},{group:1},{task:2},{opcode:T.IR_LT}])f.reply(expected,S.DONE,0,patch);
  assert.equal(handle.matched,false);
  f.reply(expected,S.DONE);assert.equal(handle.matched,true);
  const legacy=mock({session:{lo:88,hi:0}});t.after(()=>legacy.client.dispose());
  await legacy.client.arm(0,descriptor);await assert.rejects(legacy.client.arm(1,descriptor),{code:'IDENTITY'});
  await assert.rejects(f.client.arm(0,descriptor),{code:'PARAM'});
});
test('latch survives transient hit/READY reordering and duplicate DONE, READY ACK does not suppress DONE ACK',async t=>{
  const f=mock();t.after(()=>f.client.dispose());const h=await f.client.arm(1,descriptor),arm=f.sent(K.ARM)[0];
  f.reply(arm,S.DONE);f.reply(arm,S.DONE);f.reply(arm,S.READY);
  assert.equal(h.matched,true);assert.equal(await h.refresh(),true);assert.equal(f.sent(K.QUERY).length,0);
  await pause(1);assert.ok(f.sent(K.ACK).some(m=>m.args[0]===S.DONE));assert.equal(f.faults.length,0);
  await h.close();assert.equal(f.sent(K.CLOSE).length,1);assert.equal(f.client.records.size,0);
});
test('fresh boundary QUERY cannot be answered by old unsolicited READY; real pushed DONE may reconcile it',async t=>{
  const f=mock({handler:m=>m.kind===K.QUERY?false:undefined});t.after(()=>f.client.dispose());
  const h=await f.client.arm(1,descriptor),arm=f.sent(K.ARM)[0];let done=false;
  const query=h.refresh().then(value=>{done=true;return value;});await until(()=>f.sent(K.QUERY).length===1);
  f.reply(arm,S.READY);await pause(5);assert.equal(done,false);
  f.reply(arm,S.DONE);assert.equal(await query,true);assert.equal(h.matched,true);
  f.reply(f.sent(K.QUERY)[0],S.READY);assert.equal(h.matched,true);
});
test('four slots pergroup,16 total, closing releases slots without reusing IDs',async t=>{
  const f=mock();t.after(()=>f.client.dispose());const handles=[];
  for(let group=1;group<=4;group++)for(let i=0;i<4;i++)handles.push(await f.client.arm(group,descriptor));
  await assert.rejects(f.client.arm(1,descriptor),{code:'OBSERVER_LIMIT'});assert.equal(f.sent(K.ARM).length,16);
  const old=f.sent(K.ARM)[0];await handles[0].close();const next=await f.client.arm(1,descriptor);assert.equal(next.id,5);
  f.reply(old,S.DONE);f.reply(old,S.FAILED,7);assert.equal(next.matched,false);assert.equal(f.faults.length,0);
  await next.close();await Promise.all(handles.slice(1).map(h=>h.close()));
  f.client.counters.set(1,0xffffffff);await assert.rejects(f.client.arm(1,descriptor),{code:'EXHAUSTED'});
});
test('same-ID ARM retry cannot reset device timer and retries are bounded',async t=>{
  const f=mock({timing:{replyMs:15,retries:1},handler(m,reply){if(m.kind===K.ARM){if(f.sent(K.ARM).length===2)reply(m,S.DONE);return false;}}});t.after(()=>f.client.dispose());
  const h=await f.client.arm(1,{kind:T.TIME,args:M.u32(5000)});assert.equal(h.matched,true);
  const requests=f.sent(K.ARM);assert.equal(requests.length,2);assert.deepEqual(requests[0].bytes,requests[1].bytes);
  const silent=mock({timing:{replyMs:10,retries:1},handler:()=>false});t.after(()=>silent.client.dispose());
  await assert.rejects(silent.client.arm(1,descriptor),{code:'CONDITION_TIMEOUT'});assert.equal(silent.sent(K.ARM).length,2);assert.equal(silent.faults.length,1);
});
test('sensorfailure after a hit immediately faults even during an indefinitely pending body; explicitcancel is silent',async t=>{
  const f=mock();t.after(()=>f.client.dispose());const h=await f.client.arm(1,{kind:T.TILT,args:[2]}),arm=f.sent(K.ARM)[0];
  f.reply(arm,S.DONE);assert.equal(h.matched,true);f.reply(arm,S.FAILED,7);f.reply(arm,S.FAILED,7);
  assert.equal(f.faults.length,1);assert.equal(f.faults[0].observerId,h.id);assert.equal(f.faults[0].group,1);
  assert.throws(()=>h.check(),/传感器/);
  const cancelled=mock({handler:()=>false});const opening=cancelled.client.arm(1,descriptor);
  cancelled.client.cancel('手动停止');await assert.rejects(opening,/手动停止/);assert.equal(cancelled.faults.length,0);
  cancelled.client.dispose();assert.equal(cancelled.listeners.size,0);
});
test('mode/disconnect lifecycle and expired/cancelled feedback never become a normal hit',async t=>{
  for(const event of ['mode','disconnect','expired','cancelled']){
    const f=mock();t.after(()=>f.client.dispose());const h=await f.client.arm(1,descriptor),arm=f.sent(K.ARM)[0];
    if(event==='expired')f.reply(arm,S.FAILED,9);else if(event==='cancelled')f.reply(arm,S.CANCELLED);else f.emitLife(event);
    assert.equal(h.matched,false);assert.equal(f.faults.length,1);assert.throws(()=>h.check());
  }
});
test('normal CLOSE is idempotent/retryable; cancellation never waits for cleanup radio confirmation',async t=>{
  let closeCalls=0;const f=mock({timing:{replyMs:12,retries:1},handler(m,reply){if(m.kind===K.CLOSE){if(++closeCalls===2)reply(m,S.CANCELLED);return false;}}});t.after(()=>f.client.dispose());
  const h=await f.client.arm(1,descriptor);const a=h.close(),b=h.close();assert.equal(a,b);await a;
  assert.equal(f.sent(K.CLOSE).length,2);assert.deepEqual(f.sent(K.CLOSE)[0].bytes,f.sent(K.CLOSE)[1].bytes);
  const noAck=mock({handler:m=>m.kind===K.CLOSE?false:undefined});t.after(()=>noAck.client.dispose());
  const c=await noAck.client.arm(1,descriptor);await c.close({cancelled:true});await c.close({cancelled:true});
  assert.equal(noAck.client.records.size,0);assert.equal(noAck.sent(K.CLOSE).length,1);assert.equal(noAck.faults.length,0);
});
test('closed/mismatched observerfeedback never touches a livePC wait; motionAPPLIED is not DONE',async t=>{
  const f=mock();t.after(()=>f.client.dispose());const aborts=[];
  const pc=new M.SessionClient(f.link,{crypto:{getRandomValues:a=>{a[0]=123;a[1]=456;return a;}},onAbort:e=>aborts.push(e)});t.after(()=>pc.dispose());await pc.open(1);assert.equal(f.sent(M.KIND.START).length,1);assert.deepEqual(f.sent(M.KIND.START)[0].args,[1]);
  let completed=false;const work=pc.action(1,0x34,[3],{invocationId:1}).then(()=>completed=true);work.catch(()=>{});
  await until(()=>f.sent(M.KIND.ACTION).length===1);
  const h=await f.client.arm(1,descriptor),arm=f.sent(K.ARM)[0];f.reply(arm,S.DONE);await pause(3);
  assert.equal(completed,false);assert.equal(aborts.length,0);await h.close();
  const action=f.sent(M.KIND.ACTION)[0];f.reply(action,M.STATE.DONE);await work;assert.equal(completed,true);
  const bad=pc.action(1,0x34,[4],{invocationId:1});await until(()=>f.sent(M.KIND.ACTION).length===2);
  f.reply(f.sent(M.KIND.ACTION)[1],M.STATE.APPLIED);await assert.rejects(bad,/完成状态/);assert.equal(aborts.length,1);
});
test('shared loop core completes the whole body after real device latch, not the current block',async t=>{
  const F=require('../xiaobai-control-flow.js'),f=mock();t.after(()=>f.client.dispose());
  let release,body=false,finished=false;const events=[];
  const done=F.runLoop({id:'loop-infrared',params:{comparison:'greater',threshold:50},children:[{id:'display-off'},{id:'display-off'}]},async()=>{
    body=true;events.push('first');await new Promise(r=>release=r);events.push('second');
  },{check:()=>f.client.check(),delay:pause,observe:item=>f.client.arm(1,C.condition(item))}).then(()=>finished=true);
  await until(()=>body);f.reply(f.sent(K.ARM)[0],S.DONE);await pause(3);assert.equal(finished,false);assert.deepEqual(events,['first']);
  release();await done;assert.deepEqual(events,['first','second']);assert.equal(f.sent(K.CLOSE).length,1);
});
