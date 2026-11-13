'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {KIND:K,STATE:S,REASON:R,encode,decode,Receiver,SessionClient,actionArgs,u32}=require('../xiaobai-multi-protocol.js');
const legacy=require('../xiaobai-protocol.js');
const vectors=require('./fixtures/multi_group_vectors_v1.json').vectors;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=1500){const deadline=Date.now()+ms;while(!fn()&&Date.now()<deadline)await sleep(2);assert.ok(fn(),'expected asynchronous event');}
const random={getRandomValues(a){a[0]=0x12345678;a[1]=0x9abcdef0;return a;}};
function mock({action,query,control,timing={}}={}){
  const listeners=new Set(),life=new Set(),multiLife=new Set(),writes=[];
  const reply=(m,state,reason=0,extra=[],changes={})=>{const frame=encode({...m,kind:m.kind|0x80,args:[state,reason,...extra],...changes});for(const cb of listeners)cb(frame);};
  const link={closed:false,programLinkToken:0x9abcdef0,nextProgramRunSerial(){return this.runSerial=(this.runSerial||0)+1;},subscribeMulti(cb){listeners.add(cb);return()=>listeners.delete(cb);},onLifecycle(cb){life.add(cb);return()=>life.delete(cb);},onMultiLifecycle(cb){multiLife.add(cb);return()=>multiLife.delete(cb);},
    async write(frame,guard=()=>true,before=()=>{},options={}){
      if(!guard())return false;before();const m=decode(frame);writes.push({...m,priority:options.priority});
      if(m.kind===K.ACTION){if(action)await action(m,reply);return true;}
      if(m.kind===K.QUERY){if(query)await query(m,reply);return true;}
      if(m.kind===K.ACK||m.kind===K.HEARTBEAT)return true;
      if(control&&await control(m,reply)===false)return true;
      reply(m,m.kind===K.START||m.kind===K.GROUP_BEGIN?S.READY:m.kind===K.STOP?S.CANCELLED:S.DONE);
      return true;
    },invalidate(error){for(const cb of multiLife)cb(error);},lifecycle(reason){for(const cb of life)cb(reason);}};
  const states=[],aborts=[];
  const client=new SessionClient(link,{crypto:random,timing:{queueMs:150,acceptMs:60,controlMs:60,readyMs:120,queryMs:1000,statusMs:3000,...timing},onState:m=>states.push(m),onAbort:e=>aborts.push(e)});
  const invoke=client.action.bind(client);client.action=(group,opcode,args,options={})=>invoke(group,opcode,args,{invocationId:client.invocations.get(group)?.id,...options});
  return {client,link,writes,states,aborts,reply,actions:()=>writes.filter(m=>m.kind===K.ACTION)};
}

test('all frozen firmware golden frames decode and re-encode byte for byte',()=>{
  assert.equal(vectors.length,25);
  for(const vector of vectors){const bytes=Uint8Array.from(Buffer.from(vector.hex.replace(/ /g,''),'hex'));const m=decode(bytes);assert.equal(bytes.length,vector.bytes,vector.name);assert.deepEqual(encode(m),bytes,vector.name);}
});
test('codec rejects invalid SID, bounds, checksums and action parameters',()=>{
  assert.throws(()=>encode({kind:K.CAPS,sessionLo:0,sessionHi:0,task:1}));
  assert.throws(()=>encode({kind:K.ACTION,sessionLo:1,sessionHi:0,args:Array(17).fill(0)}));
  const a=encode({kind:K.CAPS,sessionLo:1,sessionHi:0,task:1});a[a.length-2]^=1;assert.throws(()=>decode(a));
  assert.equal(actionArgs(0x10,[0,1,...u32(0)]),false);assert.equal(actionArgs(0x10,[0,1,...u32(0x80000000)]),false);
  assert.equal(actionArgs(0x10,[1,2,...u32(2147483647)]),true);assert.equal(actionArgs(0x43,Array(16).fill(0xff)),true);
  for(const channel of [0,1,2])assert.equal(actionArgs(0x30,[channel,0,50]),true);
  for(let side=0;side<256;side++)assert.equal(actionArgs(0x32,[side]),side>=1&&side<=5,`tilt target ${side}`);
  assert.equal(actionArgs(0x32,[1,0]),false);assert.equal(actionArgs(0x55,[0]),false);assert.equal(actionArgs(0x99,[]),false);
});
test('receivers handle chunks, coalescing, bounded garbage and timeout without scanning nested legacy payload',()=>{
  let now=0;const seen=[],parser=new Receiver(p=>seen.push(decode(p)),{now:()=>now});
  const frame=Buffer.from(vectors[1].hex.replace(/ /g,''),'hex');
  for(const b of frame)parser.feed([b]);assert.equal(seen.length,1);
  parser.feed([...Array(1000).fill(0),...frame,...frame]);assert.equal(seen.length,3);assert.ok(parser.buffer.length<48);
  parser.feed(frame.slice(0,10));now=501;parser.feed(frame.slice(10));assert.equal(seen.length,3);parser.feed(frame);assert.equal(seen.length,4);
  const old=legacy.frame(0xd2,[1,legacy.OP.MOTOR_TIME,0]);old[1]=0x98;old[2]=0x97;old[15]=old.slice(0,15).reduce((s,b)=>s+b,0)&255;
  const envelope=encode({kind:K.ACTION|0x80,group:1,opcode:0x40,sessionLo:1,sessionHi:2,task:1,args:[S.APPLIED,0,...old]});
  const received=[],mixed=new legacy.Receiver(p=>received.push(p[4]));mixed.feed(envelope);assert.deepEqual(received,[0xd4]);
  const bad=Uint8Array.from(envelope);bad[bad.length-2]^=1;mixed.feed([...bad,...old]);assert.deepEqual(received,[0xd4,0xd2]);
});
test('Link writer serializes complete frames, prioritizes STOP/HB, drains and cancels unsent normal frames',async()=>{
  let release;const sent=[];const link=new legacy.Link({start:async()=>{},close(){},write:async bytes=>{sent.push(bytes);if(sent.length===1)await new Promise(r=>release=r);}},{minWriteMs:0});
  const frame=encode({kind:K.ACTION,group:1,opcode:0x43,sessionLo:1,sessionHi:2,task:1,args:Array(16).fill(0)});
  const first=link.write(frame);await until(()=>sent.length===1);
  const normal=link.write(legacy.command(1,legacy.OP.SHOW_NUM,[1]));
  const hb=link.write(legacy.command(0,legacy.OP.HEARTBEAT));
  const stop=link.write(legacy.command(0,legacy.OP.STOP_PROGRAM));release();await Promise.all([first,normal,hb,stop]);await link.queue;
  assert.deepEqual(sent.map(a=>a[4]===0xc4?'whole-C4':a[6]),['whole-C4',5,3,0x41]);assert.equal(sent[0].length,39);
  let releaseNext;link.transport.write=async bytes=>{sent.push(bytes);if(bytes[6]===legacy.OP.HEARTBEAT)await new Promise(r=>releaseNext=r);};
  const held=link.write(legacy.command(0,3));await until(()=>releaseNext);const cancelled=link.write(frame);link.rejectPending(new Error('cancel'));releaseNext();await held;assert.equal(await cancelled,false);link.close();
});
test('START uses current Link token and monotonic serial, one mask, and no preparation frames',async t=>{
  const m=mock();t.after(()=>m.client.dispose());const started=await m.client.open(4);assert.equal(started.reusable,true);assert.deepEqual(m.writes.map(x=>x.kind),[K.START]);assert.deepEqual(m.writes[0].args,[15]);assert.equal(m.writes[0].sessionLo,1);assert.equal(m.writes[0].sessionHi,0x9abcdef0);
  const missing=mock();missing.link.programLinkToken=0;t.after(()=>missing.client.dispose());await assert.rejects(missing.client.open(1),{code:'MODE'});assert.equal(missing.writes.length,0);
  const weak=mock();weak.link.nextProgramRunSerial=()=>0;t.after(()=>weak.client.dispose());await assert.rejects(weak.client.open(1),{code:'EXHAUSTED'});assert.equal(weak.writes.length,0);
});

test('fast DONE implies acceptance, late/repeated states do not advance twice and wrong identities cannot match',async t=>{
  let action;const m=mock({action(req){action=req;}});t.after(()=>m.client.dispose());await m.client.open(2);
  let accepted=0,steps=0;const work=m.client.action(1,0x10,[0,1,...u32(100)],{onAccepted(){accepted++;},onState(){steps++;}});
  await until(()=>action);m.reply(action,S.DONE,0,[],{task:action.task+10});assert.equal(accepted,0);
  m.reply(action,S.DONE,0,[],{sessionHi:99});assert.equal(accepted,0);
  m.reply(action,S.DONE);assert.equal((await work).state,S.DONE);m.reply(action,S.ACCEPTED);m.reply(action,S.DONE);m.reply(action,S.FAILED,R.CONFLICT);
  assert.equal(accepted,1);assert.equal(steps,1);assert.equal(m.aborts.length,0);
  assert.ok(m.writes.some(r=>r.kind===K.ACK&&r.task===action.task));
});
test('one ACTION acceptance permit releases on acceptance without blocking another group completion',async t=>{
  const m=mock();t.after(()=>m.client.dispose());await m.client.open(2);
  const a=m.client.action(1,0x32,[2]),b=m.client.action(2,0x40,[1]);
  await until(()=>m.actions().length===1);assert.equal(m.actions()[0].group,1);
  const first=m.actions()[0];m.reply(first,S.ACCEPTED);await until(()=>m.actions().length===2);const second=m.actions()[1];
  assert.ok(second.task>first.task);m.reply(second,S.APPLIED);await b;assert.equal(m.client.pcBusy.has(1),true);
  await assert.rejects(m.client.action(1,0x41,[1]),/上一任务/);m.reply(first,S.DONE);await a;
  assert.equal(m.client.pcBusy.size,0);
});
test('same-group PLAY waits for real old RELEASED, other groups run, retained lease failure identifies old task',async t=>{
  const m=mock();t.after(()=>m.client.dispose());await m.client.open(2);
  const play=m.client.action(1,0x50,[1]);await until(()=>m.actions().length===1);const old=m.actions()[0];m.reply(old,S.APPLIED);await play;
  const next=m.client.action(1,0x50,[2]);const display=m.client.action(2,0x41,[9]);await until(()=>m.actions().length===2);
  assert.equal(m.actions()[1].group,2);m.reply(m.actions()[1],S.APPLIED);await display;assert.equal(m.actions().length,2);
  m.reply(old,S.RELEASED);await until(()=>m.actions().length===3);assert.equal(m.actions()[2].group,1);assert.ok(m.actions()[2].task>m.actions()[1].task);m.reply(m.actions()[2],S.APPLIED);await next;
  const sound=m.actions()[2];m.reply(sound,S.FAILED,R.ASR);await until(()=>m.aborts.length===1);assert.equal(m.aborts[0].task,sound.task);assert.equal(m.aborts[0].group,1);assert.equal(m.aborts[0].opcode,0x50);
});
test('QUERY restores original action opcode; identical retries keep task and READY deadline does not restart',async t=>{
  let first;const m=mock({timing:{acceptMs:20,retries:1,queryMs:15,statusMs:200,readyMs:100,taskMs:100},action(req,reply){if(!first){first=req;return;}reply(req,S.ACCEPTED);},query(req,reply){reply(req,S.DONE,0,[],{opcode:first.opcode});}});t.after(()=>m.client.dispose());await m.client.open(1);
  const result=await m.client.action(1,0x32,[2]);assert.equal(result.state,S.DONE);assert.equal(m.actions().length,2);assert.equal(m.actions()[0].task,m.actions()[1].task);assert.deepEqual(m.actions()[0].args,m.actions()[1].args);
  assert.ok(m.writes.some(x=>x.kind===K.QUERY&&x.opcode===0&&x.task===first.task));
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const n=mock({timing:{readyMs:80,taskMs:35},action(req,reply){reply(req,S.ACCEPTED);setTimeout(()=>reply(req,S.READY),5);setTimeout(()=>reply(req,S.READY),25);}});t.after(()=>n.client.dispose());await n.client.open(1);
  const rejection=assert.rejects(n.client.action(1,0x51,[1]),/等待超时/);
  t.mock.timers.tick(5);assert.equal(n.states.filter(x=>x.state===S.READY).length,1);
  t.mock.timers.tick(20);assert.equal(n.aborts.length,0);
  t.mock.timers.tick(14);assert.equal(n.aborts.length,0,'original 35ms READY deadline has not elapsed');
  t.mock.timers.tick(1);assert.equal(n.aborts.length,1,'deadline remains 35ms after first READY, not after repeated READY');
  await rejection;t.mock.timers.reset();
});
test('real speech readiness is required and cancellation is never a normal hit',async t=>{
  const m=mock({timing:{readyMs:25},action(req,reply){reply(req,S.ACCEPTED);}});t.after(()=>m.client.dispose());await m.client.open(1);
  await assert.rejects(m.client.action(1,0x55,[1]),/准备超时/);assert.equal(m.states.some(s=>s.state===S.READY),false);assert.equal(m.aborts.length,1);
  const n=mock({action(req,reply){reply(req,S.CANCELLED);}});t.after(()=>n.client.dispose());await n.client.open(1);await assert.rejects(n.client.action(1,0x51,[2]),e=>e.code==='CANCELLED');
});
test('stop rejects current and queued work immediately, then requires real STOP confirmation',async t=>{
  const m=mock({control(req){if(req.kind===K.STOP)return false;},timing:{controlMs:15,retries:0}});t.after(()=>m.client.dispose());await m.client.open(2);
  const a=m.client.action(1,0x32,[2]),b=m.client.action(2,0x32,[3]);await until(()=>m.actions().length===1);
  const stopping=m.client.stop('用户停止');await assert.rejects(a,/用户停止/);await assert.rejects(b,/用户停止/);await assert.rejects(stopping,/未确认/);
  assert.equal(m.actions().length,1);assert.equal(m.client.phase,'failed');
});
test('unconfirmed automatic STOP fences SID/heartbeat, awaits one physical disconnect and retains failure evidence',async t=>{
  const {SessionCoordinator}=require('../xiaobai-multi-runner.js');
  let finishDisconnect,disconnects=0,closes=0,heartbeats=true;
  const m=mock({control(req){if(req.kind===K.STOP)return false;},action(req,reply){reply(req,S.APPLIED);},timing:{queryMs:2,statusMs:8,controlMs:5,retries:0}});
  m.link.stopHeartbeat=()=>{heartbeats=false;};
  m.link.close=()=>{closes++;m.link.closed=true;m.link.lifecycle('connection retired');m.link.invalidate(new Error('connection retired'));};
  m.link.transport={disconnect(){disconnects++;return new Promise(resolve=>{finishDisconnect=resolve;});}};
  const coordinator=new SessionCoordinator({firmware:{snapshot:()=>({ready:true,targetVersion:0x020202,currentVersion:0x020202,epoch:'e',actual:{epoch:'e',info:{version:0x020202,mode:0,imageValid:true}}})},enterProgram:async()=>{},ensureFirmware:async()=>true},{createClient:options=>{m.client.onAbort=options.onAbort;return m.client;}});
  const done=coordinator.run({modelId:'xiaobai',groups:[{groupId:'a',startId:'a-head',items:[{uid:'a-motor',id:'motor-forward-continuous',params:{port:'L'}},{uid:'a-wait',id:'wait-time',params:{duration:100}}]}]});
  done.catch(()=>{});t.after(()=>{finishDisconnect?.();m.client.dispose();});
  await until(()=>Boolean(finishDisconnect));
  assert.equal(heartbeats,false);assert.equal(m.link.closed,true);assert.equal(closes,1);assert.equal(disconnects,1);
  assert.equal(coordinator.finished,false,'run cleanup may not release its owner before disconnect settles');
  assert.equal(m.client.phase,'failed');
  const sameStop=m.client.stop('repeat stop');assert.strictEqual(sameStop,m.client.stopPromise);sameStop.catch(()=>{});
  finishDisconnect();
  await assert.rejects(done,error=>error.stopError?.code==='STOP_UNCONFIRMED'&&error.stopError?.stopConfirmed===false);
  await assert.rejects(sameStop,error=>error.code==='STOP_UNCONFIRMED'&&error.connectionInvalidated===true);
  assert.equal(coordinator.finished,true);assert.equal(m.client.disposed,true);assert.equal(disconnects,1);assert.equal(closes,1);
  const count=m.writes.length;for(const req of m.actions())m.reply(req,S.FAILED,R.CONFLICT);await sleep(2);assert.equal(m.writes.length,count,'late retired SID cannot create another cleanup or control write');
});
test('open cancellation, lifecycle invalidation and disposal reject pending requests without reopening',async t=>{
  const m=mock({control(req){if(req.kind===K.START)return false;}});t.after(()=>m.client.dispose());const opening=m.client.open(1);await m.client.stop('cancel open');await assert.rejects(opening,/cancel open/);assert.equal(m.actions().length,0);
  const n=mock();t.after(()=>n.client.dispose());await n.client.open(2);const a=n.client.action(1,0x32,[2]),b=n.client.action(2,0x32,[3]);n.link.invalidate(new Error('lost connection'));await assert.rejects(a,/lost connection/);await assert.rejects(b,/lost connection/);assert.equal(n.aborts.length,1);assert.equal(n.actions().length,1);
  const count=n.writes.length;n.client.dispose();n.reply(n.actions()[0],S.DONE);await sleep(5);assert.equal(n.writes.length,count,'disposed old SID emits no cleanup traffic');
});
test('group FINISH releases only its leases, CLOSE waits for all groups and duplicate FINISH is local idempotent',async t=>{
  const m=mock({action(req,reply){reply(req,req.opcode===0x32?S.ACCEPTED:S.APPLIED);}});t.after(()=>m.client.dispose());await m.client.open(2);
  await m.client.action(1,0x11,[0,1]);const wait=m.client.action(2,0x32,[2]);await until(()=>m.actions().length===2);
  await m.client.endGroup(1);assert.equal(m.client.pcBusy.has(2),true);await assert.rejects(m.client.close(),/未结束/);
  const count=m.writes.filter(x=>x.kind===K.GROUP_FINISH).length;await m.client.endGroup(1);assert.equal(m.writes.filter(x=>x.kind===K.GROUP_FINISH).length,count);
  m.reply(m.actions()[1],S.DONE);await wait;await m.client.endGroup(2);await m.client.close();assert.equal(m.client.phase,'closed');assert.equal(m.writes.some(x=>x.kind===K.STOP),false);
});
test('session ABORT is acknowledged with group0 task0 and identifies the offending action once',async t=>{
  const m=mock();t.after(()=>m.client.dispose());await m.client.open(1);const pending=m.client.action(1,0x32,[2]);await until(()=>m.actions().length);
  const req=m.actions()[0];m.reply({...req,kind:K.STOP,group:0,opcode:0,task:0},S.ABORTED,R.CONFLICT,[1,...u32(req.task)]);
  await assert.rejects(pending);assert.equal(m.aborts.length,1);assert.equal(m.aborts[0].group,1);assert.equal(m.aborts[0].task,req.task);assert.equal(m.aborts[0].opcode,req.opcode);
  assert.ok(m.writes.some(x=>x.kind===K.ACK&&x.group===0&&x.opcode===0&&x.task===0&&x.args[0]===S.ABORTED));
});
