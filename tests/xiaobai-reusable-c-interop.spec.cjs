'use strict';
/* Shipping JS clients -> production C parser/executor/encoder. Only host BSP
 * inputs (clock, sensors and explicit ASR-format events) are controlled here.
 * This is not physical ASR, BLE radio or signed-package acceptance evidence. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),readline=require('node:readline');
const appRoot=path.resolve(process.env.CARD_APP_ROOT||path.join(__dirname,'..'));
const P=require(path.join(appRoot,'xiaobai-protocol.js')),M=require(path.join(appRoot,'xiaobai-multi-protocol.js')),C=require(path.join(appRoot,'xiaobai-condition-protocol.js'));
const {SessionCoordinator}=require(path.join(appRoot,'xiaobai-multi-runner.js'));
const {KIND:K,STATE:S,REASON:R}=M;
const releaseVersion=require(path.join(appRoot,'assets/firmware/release.json')).firmware.version;
const firmwareRoot=process.env.XIAOBAI_FIRMWARE_ROOT||path.resolve(appRoot,'../../../5月/小白机器人/LBS-XIAOBAI-AI');
const executable=process.env.XIAOBAI_C_HOST_EXE||path.join(firmwareRoot,'tests/host/build/motion_condition_transport.exe');
const sidecar=JSON.parse(fs.readFileSync(executable.replace(/\.exe$/,'.json'),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function verifySources(){
  assert.equal(sidecar.sources,16);assert.equal(Object.keys(sidecar.production_source_sha256).length,16);
  for(const [file,hash]of Object.entries(sidecar.production_source_sha256))assert.equal(sha(fs.readFileSync(path.join(firmwareRoot,file))),hash,'stale actual-C source '+file);
}
verifySources();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let n=0;n<400&&!fn();n++)await sleep(2);assert.ok(fn(),'expected actual-C state');}
class Bridge{
  constructor(){
    this.child=spawn(executable,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});this.pending=[];this.tail=Promise.resolve();this.wire=[];this.states=[];this.stderr='';
    this.child.stderr.on('data',b=>this.stderr+=b);this.lines=readline.createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{const next=this.pending.shift();if(!next)return;try{const result=JSON.parse(line);if(result.error)throw Error(result.error);
      this.latest=result;this.states.push(result);for(const hex of result.tx){const bytes=Uint8Array.from(Buffer.from(hex,'hex'));this.wire.push(bytes);this.onWire?.(bytes);}next.resolve(result);
    }catch(error){next.reject(error);}});
    this.child.on('error',error=>{for(const next of this.pending.splice(0))next.reject(error);});
    this.child.on('exit',code=>{for(const next of this.pending.splice(0))next.reject(Error(`C bridge exited ${code}: ${this.stderr}`));});
  }
  raw(line){return new Promise((resolve,reject)=>{this.pending.push({resolve,reject});this.child.stdin.write(line+'\n');});}
  batch(fn){const result=this.tail.then(fn);this.tail=result.catch(()=>{});return result;}
  command(line){return this.batch(()=>this.raw(line));}
  frame(bytes){return this.batch(async()=>{let result;for(let i=0;i<bytes.length;i+=20)result=await this.raw('frame '+Buffer.from(bytes.slice(i,i+20)).toString('hex'));return result;});}
  async settle(){for(let n=0;n<3;n++){await new Promise(setImmediate);await this.link?.queue;await this.tail;}}
  async advance(ms){do{const step=Math.min(ms,200);await this.frame(M.encode(this.pc.message(K.HEARTBEAT)));await this.command('step '+step);ms-=step;await this.settle();}while(ms>0);}
  async asr(type,task=0,item=0,stage=0,changes={}){const m={lo:this.pc.sessionLo,hi:this.pc.sessionHi,task,item,stage,state:0,reason:0,...changes};const result=await this.command(`asr ${type} ${m.lo} ${m.hi} ${m.task} ${m.item} ${m.stage} ${m.state} ${m.reason}`);await this.settle();return result;}
  async close(){this.link?.close();await this.tail;this.child.stdin.end();if(this.child.exitCode===null)await new Promise(resolve=>{this.child.once('exit',resolve);setTimeout(()=>{if(this.child.exitCode===null)this.child.kill();resolve();},1000).unref();});this.lines.close();}
}
async function rig(t,{open=true,groupCount=2,initialGroups=Array.from({length:groupCount},(_,i)=>i+1)}={}){
  const b=new Bridge();t.after(async()=>{await b.close();verifySources();});await b.command('reset');let receive;const sent=[],aborts=[];
  const link=new P.Link({async start(cb){receive=cb;},async write(bytes){sent.push(Uint8Array.from(bytes));await b.frame(bytes);},close(){}},{minWriteMs:0});
  // Logical time is advanced only with an explicit real C4 HB at <=200ms.
  // Production clients/timers/predicates are not mocked or completed locally.
  await link.start();b.link=link;b.onWire=bytes=>receive(bytes);await link.enterProgram();
  const pc=new M.SessionClient(link,{crypto:crypto.webcrypto,onAbort:e=>aborts.push(e),timing:{controlMs:500,acceptMs:500,queryMs:20000,statusMs:30000,finishPollMs:10}});b.pc=pc;t.after(()=>pc.dispose());
  await b.asr(11,0,1,0,{lo:0,hi:0});if(open){const ready=await pc.open(groupCount,{initialGroups});assert.equal(ready.reusable,true);assert.deepEqual(ready.initialGroups,initialGroups);await b.asr(14);}
  return {b,link,pc,sent,aborts,requests:kind=>sent.filter(a=>a[4]===0xc4).map(a=>M.decode(a)).filter(m=>m.kind===kind),responses:kind=>b.wire.filter(a=>a[4]===0xd4).map(a=>M.decode(a)).filter(m=>(m.kind&127)===kind)};
}

test('actual C FINISH keeps audio leased until matching pe4, accepts planned motor/audio CANCELLED and returns real DONE',async t=>{
  const f=await rig(t),id=1,other=2;
  await f.pc.action(1,0x11,[0,1],{invocationId:id});const playing=f.pc.action(1,0x50,[1],{invocationId:id});
  await until(()=>f.b.latest.asr.op===112&&f.b.latest.asr.kind===0);const play=f.requests(K.ACTION).at(-1);assert.equal(f.b.latest.asr.item,54);
  await f.b.asr(15,play.task,54,1);await playing;assert.equal(f.pc.records.get(play.task).lease,true);const before=f.b.wire.length;
  const finishing=f.pc.finishGroup(1,id);let done=false;finishing.then(()=>done=true);await until(()=>f.responses(K.GROUP_FINISH).some(m=>m.state===S.ACCEPTED));
  await f.b.advance(700);assert.equal(done,false);assert.equal(f.pc.invocations.get(1).phase,'finishing');assert.equal(f.aborts.length,0);assert.ok(f.b.latest.asr.stopCount>0);
  // Real-format but wrong ASR identities cannot release the retained lease.
  await f.b.asr(15,play.task+1,54,4);await f.b.asr(15,play.task,55,4);await f.b.asr(15,play.task,54,4,{hi:f.pc.sessionHi^1});await f.b.advance(200);assert.equal(done,false);assert.equal(f.pc.records.get(play.task).lease,true);
  await f.pc.action(2,0x41,[9],{invocationId:other});assert.equal(f.pc.invocations.get(1).phase,'finishing','other group progress does not finish this group');
  await f.b.asr(15,play.task,54,4);const result=await finishing;assert.equal(result.state,S.DONE);assert.equal(result.task,id);await f.b.settle();
  const after=f.b.wire.slice(before).filter(a=>a[4]===0xd4).map(a=>M.decode(a));
  assert.ok(after.some(m=>(m.kind&127)===K.ACTION&&m.opcode===0x11&&m.state===S.CANCELLED));
  assert.ok(after.some(m=>(m.kind&127)===K.ACTION&&m.opcode===0x50&&m.task===play.task&&m.state===S.CANCELLED));assert.equal(f.aborts.length,0);
  const next=await f.pc.beginGroup(1);assert.ok(next>play.task);await f.pc.action(1,0x41,[3],{invocationId:next});await f.pc.finishGroup(1,next);await f.pc.finishGroup(2,other);await f.pc.close();
  assert.equal(f.requests(K.GROUP_END).length,0);assert.ok(f.requests(K.GROUP_FINISH).filter(m=>m.group===1&&m.task===id).length>=2);
});

test('actual C scoped observers preserve IDs across BEGIN and reject oldrun; Clear old18B cannot abort a new valid client',async t=>{
  const f=await rig(t),faults=[],observers=new C.ObserverClient(f.link,{session:{lo:f.pc.sessionLo,hi:f.pc.sessionHi},reusable:true,onFault:e=>faults.push(e),timing:{replyMs:500}});t.after(()=>observers.dispose());
  const oldRun=1,h=await observers.arm(1,{kind:C.CONDITION.IR_GT,args:[50]},{runId:oldRun});assert.equal(h.matched,false);const oldArm=f.requests(12).at(-1);
  await h.close();await f.pc.finishGroup(1,oldRun);observers.retireGroup(1,oldRun);const nextRun=await f.pc.beginGroup(1),next=await observers.arm(1,{kind:C.CONDITION.IR_GT,args:[50]},{runId:nextRun});assert.ok(next.id>h.id);
  const nextArm=f.requests(12).at(-1);await f.b.frame(C.encode({...oldArm,kind:13,args:M.u32(oldRun)}));await f.b.settle();
  const stale=f.responses(13).at(-1);assert.equal(stale.state,S.FAILED);assert.equal(stale.reason,R.EXPIRED);assert.equal(stale.extra.length,4);assert.equal(M.read32(stale.extra),oldRun);assert.equal(next.matched,false);assert.equal(faults.length,0);
  await f.b.command('sensor 75 1 1 0 0 0 0 0');await f.b.settle();assert.equal(next.matched,true);await next.close();await f.pc.finishGroup(1,nextRun);observers.retireGroup(1,nextRun);
  // Capture a genuine post-Clear 18-byte rejection, without synthesizing D4.
  await f.pc.stop();await f.b.frame(C.encode({...oldArm,kind:14,args:M.u32(oldRun)}));await f.b.settle();const rejection=f.b.wire.filter(a=>a[4]===0xd4&&(a[6]&127)===14).at(-1);assert.equal(rejection[3],18);
  // Start a new real SID/session and feed the old device-produced rejection.
  f.pc.dispose();const pc=new M.SessionClient(f.link,{crypto:crypto.webcrypto,timing:{controlMs:500}});t.after(()=>pc.dispose());f.b.pc=pc;await pc.open(1);await f.b.asr(14);const run=1;
  const current=new C.ObserverClient(f.link,{session:{lo:pc.sessionLo,hi:pc.sessionHi},reusable:true,onFault:e=>faults.push(e)});t.after(()=>current.dispose());
  await f.b.command('sensor 0 1 1 0 0 0 0 0');const live=await current.arm(1,{kind:C.CONDITION.IR_GT,args:[50]},{runId:run});f.link.receive(rejection);live.check();assert.equal(live.matched,false);assert.equal(faults.length,0);
  assert.notEqual(nextArm.args.slice(0,4).join(),oldArm.args.slice(0,4).join());await live.close();await pc.finishGroup(1,run);await pc.close();
});


test('actual release compact START activates initial groups once, first task is5 and old registration traffic is absent',async t=>{
  const f=await rig(t),version=f.b.wire.find(bytes=>bytes[4]===0xd3&&bytes[5]===0x0a);
  assert(version,'real C ENTER_PROGRAM version event');assert.equal(Buffer.from(version).readUInt32LE(7),releaseVersion);
  assert.equal(f.requests(K.START).length,1);const start=f.requests(K.START)[0];assert.equal(start.task,0);assert.deepEqual(start.args,[3]);
  assert.equal(start.sessionLo,1);assert.equal(start.sessionHi,f.link.programLinkToken);assert(start.sessionHi>0);
  for(const kind of [K.CAPS,K.OPEN,K.GROUP_OPEN,K.COMMIT])assert.equal(f.requests(kind).length,0,'no per-run registration kind '+kind);
  const replay=await f.b.frame(M.encode(start));await f.b.settle();assert.equal(replay.motor.length,0,'duplicate START does not brake or restart groups');
  assert(f.responses(K.START).some(m=>m.state===S.READY&&m.sessionLo===start.sessionLo));
  const done=await f.pc.action(1,0x41,[7],{invocationId:1});assert.equal(done.state,S.APPLIED);
  assert.equal(f.requests(K.ACTION)[0].task,5);await f.pc.finishGroup(1,1);await f.pc.finishGroup(2,2);await f.pc.close();
});

test('actual C STOP before pending START retires that serial and cannot start any hardware work later',async t=>{
  const f=await rig(t,{open:false}),serial=f.link.nextProgramRunSerial(),token=f.link.programLinkToken;
  const start={kind:K.START,sessionLo:serial,sessionHi:token,task:0,args:[1]};
  const stopped=await f.b.frame(M.encode({...start,kind:K.STOP,args:[]}));assert.equal(stopped.multi,0);assert.equal(stopped.motor.length,0);
  await f.b.frame(M.encode(start));await f.b.settle();const result=f.responses(K.START).at(-1);
  assert.equal(result.state,S.FAILED);assert.equal(result.reason,R.STALE);assert.equal(f.b.latest.multi,0);
  await f.pc.open(1);assert(f.pc.sessionLo>serial);assert.equal(f.pc.sessionHi,token);await f.pc.finishGroup(1,1);await f.pc.close();
});

test('actual C two gesture waits need distinct events; accepted, wrong task and replayed real DONE cannot advance the second task',async t=>{
  const f=await rig(t),first=f.pc.action(1,0x34,[3],{invocationId:1});first.catch(()=>{});
  await until(()=>f.requests(K.ACTION).length===1);const old=f.requests(K.ACTION)[0];let firstDone=false;first.then(()=>firstDone=true);
  await f.b.advance(60);assert.equal(firstDone,false,'ACCEPTED is not task completion');
  await f.b.command('sensor 0 1 1 1 0 3 1 '+f.b.latest.now);await f.b.settle();assert.equal((await first).state,S.DONE);
  const oldDone=f.b.wire.find(bytes=>bytes[4]===0xd4&&(bytes[6]&127)===K.ACTION&&M.decode(bytes).task===old.task&&M.decode(bytes).state===S.DONE);assert(oldDone);
  const second=f.pc.action(1,0x34,[3],{invocationId:1});second.catch(()=>{});let secondDone=false;second.then(()=>secondDone=true);
  await until(()=>f.requests(K.ACTION).length===2);assert(f.requests(K.ACTION)[1].task>old.task);f.link.receive(oldDone);
  await f.b.advance(60);assert.equal(secondDone,false,'actual old task DONE and old gesture serial cannot hit the next task');
  await f.b.command('sensor 0 1 1 1 0 3 2 '+f.b.latest.now);await f.b.settle();assert.equal((await second).state,S.DONE);
  await f.pc.finishGroup(1,1);await f.pc.finishGroup(2,2);await f.pc.close();
});

function nextClient(t,f){
  const pc=new M.SessionClient(f.link,{timing:{controlMs:500,acceptMs:500,queryMs:20000,statusMs:30000}});
  t.after(()=>pc.dispose());f.b.pc=pc;return pc;
}
test('actual C suspend and immediate re-entry reuse the physical Link token with a greater run serial',async t=>{
  const f=await rig(t),old={lo:f.pc.sessionLo,hi:f.pc.sessionHi};await f.pc.stop();f.pc.dispose();
  const stop=f.link.suspendProgram(),enter=f.link.enterProgram();await Promise.all([stop,enter]);
  assert.equal(f.link.programLinkToken,old.hi);const pc=nextClient(t,f);await pc.open(1);assert(pc.sessionLo>old.lo);assert.equal(pc.sessionHi,old.hi);
  const stale=await f.b.frame(M.encode({kind:K.ACTION,group:1,opcode:0x11,task:5,args:[0,1],sessionLo:old.lo,sessionHi:old.hi}));await f.b.settle();
  assert.equal(stale.motor.length,0,'old run motor ACTION cannot mutate the new session');assert.equal(pc.phase,'active');
  await pc.action(1,0x41,[3],{invocationId:1});await pc.finishGroup(1,1);await pc.close();
});
test('actual C heartbeat timeout and true mode exit require a fresh token and run serial1 on re-entry',async t=>{
  const f=await rig(t),old={lo:f.pc.sessionLo,hi:f.pc.sessionHi},wait=f.pc.action(1,0x34,[3],{invocationId:1});wait.catch(()=>{});
  await until(()=>f.requests(K.ACTION).length===1);f.link.stopHeartbeat();await f.b.command('step 2300');await f.b.settle();await assert.rejects(wait);
  assert.equal(f.b.latest.mode,0);assert.equal(f.b.latest.multi,0);f.pc.dispose();await f.link.enterProgram();assert.notEqual(f.link.programLinkToken,old.hi);
  const pc=nextClient(t,f);await pc.open(1);assert.equal(pc.sessionLo,1);assert.equal(pc.sessionHi,f.link.programLinkToken);
  await f.b.frame(M.encode({kind:K.START,sessionLo:old.lo,sessionHi:old.hi,task:0,args:[1]}));await f.b.settle();
  assert.equal(f.responses(K.START).at(-1).reason,R.STALE,'old token cannot restart or displace the new session');assert.equal(pc.phase,'active');
  await pc.action(1,0x41,[4],{invocationId:1});await pc.finishGroup(1,1);await pc.close();
});

test('actual C remote mode clears programming token; re-entry rejects a delayed old START',async t=>{
  const f=await rig(t),old=f.requests(K.START)[0];await f.pc.stop();f.pc.dispose();await f.link.enterRemote();assert.equal(f.b.latest.mode,3);
  await f.link.enterProgram();assert.notEqual(f.link.programLinkToken,old.sessionHi);const pc=nextClient(t,f);await pc.open(1);assert.equal(pc.sessionLo,1);
  await f.b.frame(M.encode(old));await f.b.settle();const stale=f.responses(K.START).at(-1);assert.equal(stale.state,S.FAILED);assert.equal(stale.reason,R.STALE);
  assert.equal(pc.phase,'active');await pc.action(1,0x41,[6],{invocationId:1});await pc.finishGroup(1,1);await pc.close();
});

test('actual C lost exit event after long suspend is resolved by a fresh status query before ENTER',async t=>{
  const f=await rig(t),old=f.requests(K.START)[0];await f.pc.stop();f.pc.dispose();await f.link.suspendProgram();
  const deliver=f.b.onWire;f.b.onWire=bytes=>{if(bytes[4]!==0xd3||![1,2].includes(bytes[5]))deliver(bytes);};
  await f.b.command('step 2300');await f.b.settle();assert.equal(f.b.latest.mode,0);await sleep(1050);
  const before=f.sent.length;await f.link.enterProgram();f.b.onWire=deliver;const entering=f.sent.slice(before).filter(bytes=>bytes[4]===0xc2);
  assert.equal(entering.filter(bytes=>bytes[6]===P.OP.QUERY_STATUS).length,1,'one actual fresh status query for ambiguous re-entry');
  assert(entering.findIndex(bytes=>bytes[6]===P.OP.QUERY_STATUS)<entering.findIndex(bytes=>bytes[6]===P.OP.ENTER_PROGRAM));
  assert.notEqual(f.link.programLinkToken,old.sessionHi);const pc=nextClient(t,f);await pc.open(1);assert.equal(pc.sessionLo,1);await pc.finishGroup(1,1);await pc.close();
});

test('actual C sensor abort keeps PROGRAM mode and the token while a later run advances serial',async t=>{
  const f=await rig(t),old={lo:f.pc.sessionLo,hi:f.pc.sessionHi},wait=f.pc.action(1,0x34,[3],{invocationId:1});wait.catch(()=>{});
  await until(()=>f.requests(K.ACTION).length===1);await f.b.command('sensor 0 1 0 0 0 0 0 0');await f.b.settle();await assert.rejects(wait);
  assert.equal(f.b.latest.mode,4);assert.equal(f.link.programLinkToken,old.hi);await f.pc.stop();f.pc.dispose();await f.b.command('sensor 0 1 1 0 0 0 0 0');
  await f.link.enterProgram();assert.equal(f.link.programLinkToken,old.hi);const pc=nextClient(t,f);await pc.open(1);assert(pc.sessionLo>old.lo);
  await pc.action(1,0x41,[2],{invocationId:1});await pc.finishGroup(1,1);await pc.close();
});

test('actual C STOP while START READY is pending cancels open and late real READY cannot resume it',async t=>{
  const f=await rig(t,{open:false}),deliver=f.b.onWire;let held;
  f.b.onWire=bytes=>{if(bytes[4]===0xd4&&(bytes[6]&127)===K.START&&M.decode(bytes).state===S.READY)held=bytes;else deliver(bytes);};
  const opening=f.pc.open(1);opening.catch(()=>{});await until(()=>held);await f.pc.stop();deliver(held);await assert.rejects(opening);
  assert.equal(f.b.latest.multi,0);assert.equal(f.requests(K.ACTION).length,0);assert.notEqual(f.pc.phase,'active');f.b.onWire=deliver;f.pc.dispose();
  const pc=nextClient(t,f);await pc.open(1);assert(pc.sessionLo>1);await pc.finishGroup(1,1);await pc.close();
});

test('actual C old ACTION and FINISH in a reused group cannot actuate or finish its new invocation',async t=>{
  const f=await rig(t);await f.pc.action(1,0x11,[0,1],{invocationId:1});const oldAction=f.requests(K.ACTION)[0];await f.pc.finishGroup(1,1);
  const oldFinish=f.requests(K.GROUP_FINISH).find(m=>m.group===1&&m.task===1),next=await f.pc.beginGroup(1);assert(next>oldAction.task);
  const replay=await f.b.frame(M.encode(oldAction));await f.b.frame(M.encode(oldFinish));await f.b.settle();
  assert.equal(replay.motor.length,0,'retired motor ACTION does not actuate in the new invocation');assert.equal(f.pc.invocations.get(1).id,next);
  assert.equal(f.pc.invocations.get(1).phase,'running');assert.equal(f.aborts.length,0);await f.pc.action(1,0x41,[2],{invocationId:next});
  await f.pc.finishGroup(1,next);await f.pc.finishGroup(2,2);await f.pc.close();
});

test('real Coordinator sends local wait and messages without registration, ignores busy receiver and preserves ACTION/BEGIN first-send ID order',async t=>{
  const f=await rig(t,{open:false});f.pc.dispose();let activeClient;
  // Version-gate fixture only; this case exercises production scheduling and
  // all completion/resource frames still originate from the actual C executor.
  const connection={firmware:{snapshot:()=>({ready:true,targetVersion:releaseVersion,currentVersion:releaseVersion,epoch:'actual-c',actual:{epoch:'actual-c',info:{version:releaseVersion,mode:0,imageValid:true}}})},enterProgram:()=>f.link.enterProgram(),ensureFirmware:async()=>true};
  const coordinator=new SessionCoordinator(connection,{createClient:options=>(activeClient=f.b.pc=new M.SessionClient(f.link,{...options,timing:{controlMs:500,acceptMs:500,queryMs:20000,statusMs:30000}}))});
  t.after(()=>coordinator.stop().catch(()=>{}));const done=coordinator.run({modelId:'xiaobai',projectId:'actual-222-messages',groups:[
    {groupId:'a',startId:'a-head',items:[{uid:'wait-local',id:'wait-time',params:{duration:.02}},{uid:'send-one',id:'send-message',params:{message:1}},{uid:'send-busy',id:'send-message',params:{message:1}},{uid:'motor',id:'motor-forward-continuous',params:{port:'L/M1'}}]},
    {groupId:'b',startId:'b-head',trigger:{type:'message',message:1},items:[{uid:'wait-new-gesture',id:'motion-wait',params:{state:'up'}},{uid:'display',id:'display-number',params:{value:8}}]}
  ]});done.catch(()=>{});
  await until(()=>f.requests(K.ACTION).some(m=>m.opcode===0x34));await f.b.asr(14);const dispatched=f.sent.filter(b=>b[4]===0xc4).map(b=>M.decode(b)).filter(m=>m.kind===K.ACTION||m.kind===K.GROUP_BEGIN);
  assert.deepEqual(dispatched.map(m=>m.task),[...dispatched.map(m=>m.task)].sort((a,b)=>a-b));assert(dispatched.every(m=>m.task>=5));
  assert.equal(f.requests(K.START).length,1);assert.deepEqual(f.requests(K.START)[0].args,[1]);assert.equal(f.requests(K.GROUP_BEGIN).filter(m=>m.group===2).length,1,'second message sees STARTING/RUNNING receiver and is ignored');
  for(const kind of [K.CAPS,K.OPEN,K.GROUP_OPEN,K.COMMIT])assert.equal(f.requests(kind).length,0);
  assert.equal(coordinator.messageRecords.get('b').invocations,1);await f.b.command('sensor 0 1 1 1 0 3 1 '+f.b.latest.now);await f.b.settle();await done;
  assert.equal(coordinator.messageRecords.get('b').invocations,1);assert.equal(activeClient.phase,'closed');assert.equal(f.b.latest.multi,0);
});
