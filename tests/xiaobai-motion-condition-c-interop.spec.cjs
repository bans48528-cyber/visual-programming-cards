'use strict';
/* Real shipping JS -> actual C parser/executor/observer -> actual encoder.
 * Only BSP sensor outputs, the host tick and Flash record/Boot-version inputs
 * are test seams. This bridge cannot validate physical Boot descriptors.
 * The explicit clock bridge feeds real wire heartbeats; production timers and
 * condition predicates are never replaced or completed by JavaScript.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),readline=require('node:readline');
const P=require('../xiaobai-protocol.js'),M=require('../xiaobai-multi-protocol.js');
const C=require('../xiaobai-condition-protocol.js'),F=require('../xiaobai-control-flow.js');
const Legacy=require('../xiaobai-runner.js'),Multi=require('../xiaobai-multi-runner.js');
const Ota=require('../xiaobai-ota-protocol.js');
const firmwareRoot=process.env.XIAOBAI_FIRMWARE_ROOT||path.resolve(__dirname,'../../../../5月/小白机器人/LBS-XIAOBAI-AI');
const executable=path.join(firmwareRoot,'tests/host/build/motion_condition_transport.exe');
const sidecar=JSON.parse(fs.readFileSync(executable.replace(/\.exe$/,'.json'),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sidecar.sources,16);
for(const [file,hash] of Object.entries(sidecar.production_source_sha256))assert.equal(sha(fs.readFileSync(path.join(firmwareRoot,file))),hash,'actual-C host is stale: '+file);
const packageBytes=fs.readFileSync(path.join(firmwareRoot,'dist/ota/py32_2.1.5/xiaobai_py32_2.1.5.ota'));
assert.equal(packageBytes.length,50372);
assert.equal(sha(packageBytes),'f1d78b75a756ac6d8f0d7e75b144c1f5f3156557210e54d27f5615c3c7d02055');
const signed=Ota.verifyPackage(packageBytes);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label='expected actual-C state'){
  for(let n=0;n<600&&!predicate();n++)await sleep(2);assert.ok(predicate(),label);
}
const item=(id,params={},children,uid=id)=>({id,uid,params,...(children?{children}:{})});
const ir=(children,uid='ir-loop')=>item('loop-infrared',{comparison:'greater',threshold:50},children,uid);
const time=(duration,children,uid='time-loop')=>item('loop-time',{duration},children,uid);
class Bridge{
  constructor(){
    this.child=spawn(executable,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.pending=[];this.tail=Promise.resolve();this.stderr='';this.states=[];this.wire=[];this.now=10000;
    this.child.stderr.on('data',b=>this.stderr+=b);
    this.lines=readline.createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{
      const pending=this.pending.shift();if(!pending)return;
      try{
        const result=JSON.parse(line);if(result.error)throw Error(result.error);
        this.now=result.now;this.latest=result;this.states.push(result);
        for(const hex of result.tx){const bytes=Uint8Array.from(Buffer.from(hex,'hex'));this.wire.push(bytes);this.onWire?.(bytes);}
        pending.resolve(result);
      }catch(error){pending.reject(error);}
    });
    this.child.once('error',error=>{for(const p of this.pending.splice(0))p.reject(error);});
    this.child.once('exit',code=>{for(const p of this.pending.splice(0))p.reject(Error(`actual C exited ${code}: ${this.stderr}`));});
  }
  raw(line){return new Promise((resolve,reject)=>{this.pending.push({resolve,reject});this.child.stdin.write(line+'\n');});}
  batch(fn){const work=this.tail.then(fn);this.tail=work.catch(()=>{});return work;}
  command(line){return this.batch(()=>this.raw(line));}
  frame(bytes){
    // Entire logical frame owns this batch; clock/HB cannot split GATT chunks.
    return this.batch(async()=>{let result;for(let at=0;at<bytes.length;at+=20)result=await this.raw('frame '+Buffer.from(bytes.slice(at,at+20)).toString('hex'));return result;});
  }
  async settle(){for(let n=0;n<3;n++){await new Promise(setImmediate);await this.link?.queue;await this.tail;}}
  async advance(ms,{heartbeat=true}={}){
    do{
      const step=Math.min(ms,200);
      if(heartbeat){
        const pc=this.pc;
        await this.frame(pc?.sessionLo||pc?.sessionHi?M.encode({kind:M.KIND.HEARTBEAT,sessionLo:pc.sessionLo,sessionHi:pc.sessionHi}):P.command(0,P.OP.HEARTBEAT));
      }
      await this.command('step '+step);ms-=step;await this.settle();
    }while(ms>0);
  }
  async sensor(values={}){
    this.sensorValues={ir:0,pose:1,ready:1,still:0,shaking:0,gesture:0,serial:0,startedAt:0,...this.sensorValues,...values};
    const s=this.sensorValues;const result=await this.command(`sensor ${s.ir} ${s.pose} ${s.ready} ${s.still} ${s.shaking} ${s.gesture} ${s.serial} ${s.startedAt}`);
    await this.settle();return result;
  }
  async close(){
    this.link?.close();await this.tail;this.child.stdin.end();
    if(this.child.exitCode===null)await new Promise(resolve=>{this.child.once('exit',resolve);setTimeout(()=>{if(this.child.exitCode===null)this.child.kill();resolve();},1000).unref();});
    this.lines.close();
  }
}
async function rig(t,{direct=true}={}){
  const b=new Bridge();t.after(()=>b.close());await b.command('reset');
  const sent=[];let receive;
  const link=new P.Link({async start(fn){receive=fn;},async write(bytes){sent.push(Uint8Array.from(bytes));await b.frame(bytes);},close(){}},{minWriteMs:0});
  // This test's virtual clock sends explicit real HB packets every <=200ms.
  link.startHeartbeat=()=>{};await link.start();b.link=link;b.onWire=bytes=>receive(bytes);
  const pkg=await signed;assert.equal(pkg.signatureVerified,true);assert.equal(pkg.version,0x020105);
  assert.equal(pkg.minBootVersion,0x020000);assert.equal(pkg.layoutId,2);
  assert.equal(pkg.imageSize,50244);assert.equal(pkg.imageSha256,'0fd6583317cd76e2ea98e6b77c9c0cb6ec6fca28a8ba9019c82f59f98d103fd1');
  const firmware={bundle:{pkg},snapshot:()=>({ready:true,currentVersion:pkg.version,epoch:'actual-c-fixture',actual:{epoch:'actual-c-fixture',info:{
    boardId:pkg.boardId,protocol:1,version:pkg.version,mode:0,imageValid:true,schemaVersion:2,layoutId:pkg.layoutId,
    activeAppBase:pkg.appBase,erasePage:pkg.erasePage,imageSize:pkg.imageSize,imageSha256:pkg.imageSha256}}})};
  const runId=99;
  const begin=async()=>{await link.action(P.OP.DECLARE_RUN,[...M.u32(runId),1],true,1000);return {id:runId,legacy:false};};
  const connection={firmware,enterProgram:()=>link.enterProgram(),ensureFirmware:async()=>true,action:(...args)=>link.action(...args),stopProgram:()=>link.stopProgram(),cancelPending:()=>link.rejectPending(Error('stopped')),
    conditionObservers:{createClient:options=>new C.ObserverClient(link,{...options,timing:{replyMs:200,retries:1}})},
    learned:{getSnapshot:()=>({busy:false}),async prepareRun(){},beginRun:begin,async endRun(){await link.action(P.OP.DECLARE_RUN,[...M.u32(runId),0],true,1000);},stop(){}}};
  let observers;
  if(direct){await link.enterProgram();await begin();observers=new C.ObserverClient(link,{session:{lo:runId,hi:0},timing:{replyMs:200,retries:1}});t.after(()=>observers.dispose());}
  return {b,link,sent,connection,observers,
    hooks:{check:()=>observers.check(),delay:ms=>b.advance(ms),observe:node=>observers.arm(0,C.condition(node))},
    c2:op=>sent.filter(bytes=>bytes[4]===0xc2&&bytes[6]===op),
    c4:kind=>sent.filter(bytes=>bytes[4]===0xc4).map(bytes=>M.decode(bytes)).filter(m=>m.kind===kind)};
}
function runnerFor(f,mode,onStep=()=>{}){
  if(mode==='single'){
    const runner=new Legacy.Runner(f.connection,{onStep});
    runner.delay=async ms=>{runner.check();await f.b.advance(ms);runner.check();};
    return {run:items=>runner.run(items),stop:()=>runner.stop(),runner};
  }
  const runner=new Multi.SessionCoordinator(f.connection,{onStep,createClient:options=>{
    const pc=new M.SessionClient(f.link,{...options,crypto:crypto.webcrypto,timing:{controlMs:500,acceptMs:500,queryMs:10000,statusMs:20000}});f.b.pc=pc;return pc;
  }});
  runner.delay=async ms=>{runner.check();await f.b.advance(ms);runner.check();};
  return {run:items=>runner.run({modelId:'xiaobai',projectId:'actual-c',groups:[{groupId:'a',startId:'head',items}]}),stop:()=>runner.stop(),runner};
}

test('actual C compiled App version matches the original signed 2.1.5 package',async t=>{
  const f=await rig(t),version=f.b.wire.find(bytes=>bytes[4]===0xd3&&bytes[5]===0x0a);
  assert.ok(version,'ENTER_PROGRAM must report the compiled App version through the real encoder');
  assert.equal(Buffer.from(version).readUInt32LE(7),0x020105,'stale Shared/Ota_Layout.h must not pass the final package gate');
  assert.equal(Buffer.from(version).readUInt16LE(11),258);
});

test('realC initial true skips body; transient real sample latches while complete body keeps running',async t=>{
  const f=await rig(t);await f.b.sensor({ir:75});let bodies=0;
  await F.runLoop(ir([item('display-off')]),async()=>{bodies++;},f.hooks);assert.equal(bodies,0);
  await f.b.sensor({ir:0});const events=[];
  await F.runLoop(ir([item('display-off')]),async()=>{
    events.push('first');await f.b.sensor({ir:75});await f.b.sensor({ir:0});await f.b.advance(200);events.push('last');
  },f.hooks);
  assert.deepEqual(events,['first','last']);assert.equal(f.b.latest.observing,0);
  const frames=f.b.wire.filter(b=>b[4]===0xd4).map(b=>C.decode(b));assert.ok(frames.some(m=>m.state===C.STATE.DONE));
});
test('actualC IR comparison is strict at equality; TIME0 is an authoritative immediate skip',async t=>{
  const f=await rig(t);await f.b.sensor({ir:50});
  const greater=await f.observers.arm(0,{kind:C.CONDITION.IR_GT,args:[50]});assert.equal(greater.matched,false);
  await f.b.sensor({ir:51});assert.equal(greater.matched,true);await greater.close();
  await f.b.sensor({ir:50});const less=await f.observers.arm(0,{kind:C.CONDITION.IR_LT,args:[50]});assert.equal(less.matched,false);
  await f.b.sensor({ir:49});assert.equal(less.matched,true);await less.close();
  let bodies=0;await F.runLoop(time(0,[item('display-off')]),async()=>{bodies++;},f.hooks);assert.equal(bodies,0);
  assert.equal(f.b.latest.observing,0);
});
test('replaying actualC READY cannot clear a real device latch and closed observer feedback cannot affect a new ID',async t=>{
  const f=await rig(t);const old=await f.observers.arm(0,{kind:C.CONDITION.IR_GT,args:[50]});
  const ready=f.b.wire.find(b=>b[4]===0xd4&&C.decode(b).observerId===old.id&&C.decode(b).state===C.STATE.READY);assert.ok(ready);
  await f.b.sensor({ir:75});const done=f.b.wire.find(b=>b[4]===0xd4&&C.decode(b).observerId===old.id&&C.decode(b).state===C.STATE.DONE);assert.ok(done);
  await f.b.sensor({ir:0});f.link.receive(ready);assert.equal(old.matched,true);
  await old.close();const next=await f.observers.arm(0,{kind:C.CONDITION.IR_GT,args:[50]});assert.ok(next.id>old.id);
  f.link.receive(done);assert.equal(next.matched,false);await next.close();
});
test('realC TIME5s with3s whole rounds exits about6s, with explicit wireHB and no phone conditiontimer',async t=>{
  const f=await rig(t);const start=f.b.now;let rounds=0;
  await F.runLoop(time(5,[item('wait-time',{duration:3})]),async()=>{rounds++;await f.b.advance(3000);},f.hooks);
  assert.equal(rounds,2);assert.ok(f.b.now-start>=6000&&f.b.now-start<=6050);assert.equal(f.b.latest.observing,0);
  assert.ok(f.b.states.every(s=>s.mode===4||s===f.b.states[0]));
});
test('nested real observers keep outer hit latched while inner whole rounds and remaining siblings finish',async t=>{
  const f=await rig(t);let innerRounds=0,outerRounds=0;const events=[];
  const nested=time(1,[item('wait-time',{duration:.6})]);const outer=ir([nested,item('display-off')]);
  await F.runLoop(outer,async()=>{
    outerRounds++;events.push('outer-first');
    await F.runLoop(nested,async()=>{
      innerRounds++;await f.b.advance(200);await f.b.sensor({ir:75});await f.b.sensor({ir:0});await f.b.advance(400);
    },f.hooks);events.push('outer-last');
  },f.hooks);
  assert.equal(outerRounds,1);assert.equal(innerRounds,2);assert.deepEqual(events,['outer-first','outer-last']);assert.equal(f.b.latest.observing,0);
});
test('stale oldMP STOP after its CLOSE cannot clear a new legacy-run observer',async t=>{
  const f=await rig(t,{direct:false});await f.link.enterProgram();
  const pc=new M.SessionClient(f.link,{crypto:crypto.webcrypto});t.after(()=>pc.dispose());
  await pc.open(1);await pc.endGroup(1);await pc.close();
  const oldStop=M.encode({kind:M.KIND.STOP,sessionLo:pc.sessionLo,sessionHi:pc.sessionHi});
  await f.connection.learned.beginRun();const observers=new C.ObserverClient(f.link,{session:{lo:99,hi:0}});t.after(()=>observers.dispose());
  const handle=await observers.arm(0,{kind:C.CONDITION.IR_GT,args:[50]});assert.equal(handle.matched,false);
  await f.b.frame(oldStop);await f.b.settle();assert.equal(f.b.latest.observing,1);assert.equal(f.b.latest.mode,4);handle.check();
  await f.b.sensor({ir:75});assert.equal(handle.matched,true);await handle.close();
});
test('actual two-group coordinator keeps otherPC and whole-body wait intact when a sensor observer latches',async t=>{
  const f=await rig(t,{direct:false}),visited=[];
  const run=runnerFor(f,'multi',(node,_path,group)=>visited.push(`${group}:${node.uid}`));
  const done=run.runner.run({modelId:'xiaobai',projectId:'actual-c-groups',groups:[
    {groupId:'a',startId:'a-head',items:[ir([item('motion-wait',{state:'up'},undefined,'motion'),item('display-off',{},undefined,'a-tail')])]},
    {groupId:'b',startId:'b-head',items:[item('motor-forward',{port:'R',duration:1},undefined,'b-motor'),item('display-number',{value:8},undefined,'b-tail')]}
  ]});done.catch(()=>{});
  await until(()=>visited.includes('a:motion')&&visited.includes('b:b-motor'));await f.b.settle();
  await f.b.sensor({ir:75});await f.b.sensor({ir:0});await f.b.advance(1000);
  await until(()=>visited.includes('b:b-tail'));await f.b.settle();
  await until(()=>f.c4(M.KIND.GROUP_END).some(m=>m.group===2));
  assert.equal(visited.includes('a:a-tail'),false);assert.ok(f.c4(M.KIND.GROUP_END).some(m=>m.group===2));
  assert.equal(f.c4(M.KIND.STOP).length,0,'group2 ending must not stop waiting group1');
  await f.b.sensor({still:1,gesture:3,serial:1,startedAt:f.b.now});await done;
  assert.equal(visited.filter(x=>x==='a:a-tail').length,1);assert.equal(f.b.latest.observing,0);
});
for(const mode of ['single','multi']){
  test(`actual ${mode} runner: shaking is independent from not-still; inverted stillness needs its own true state`,async t=>{
    const f=await rig(t,{direct:false}),run=runnerFor(f,mode);
    const done=run.run([item('motion-wait',{state:'shaking'},undefined,'shake'),item('motion-wait',{state:'still'},undefined,'still'),item('display-off')]);done.catch(()=>{});
    const motions=()=>mode==='single'?f.c2(P.OP.WAIT_MOTION):f.c4(M.KIND.ACTION).filter(m=>m.opcode===P.OP.WAIT_MOTION);
    const off=()=>mode==='single'?f.c2(P.OP.SHOW_OFF):f.c4(M.KIND.ACTION).filter(m=>m.opcode===P.OP.SHOW_OFF);
    await until(()=>motions().length===1);await f.b.settle();
    await f.b.sensor({pose:2,still:0,shaking:0});await f.b.advance(60);assert.equal(motions().length,1,'ordinary motion/tilt is not sustained shaking');
    await f.b.sensor({shaking:1});await f.b.advance(100);await until(()=>motions().length===2);await f.b.settle();
    await f.b.sensor({pose:6,still:0,shaking:0});assert.equal(off().length,0);
    await f.b.sensor({pose:6,still:1});await f.b.advance(100);await done;assert.equal(off().length,1);
  });
  test(`actual ${mode} runner: one physical gesture cannot complete the following new motion wait`,async t=>{
    const f=await rig(t,{direct:false});await f.b.sensor({still:1,gesture:3,serial:5,startedAt:9990});
    const run=runnerFor(f,mode),done=run.run([item('motion-wait',{state:'up'},undefined,'up1'),item('motion-wait',{state:'up'},undefined,'up2'),item('display-off')]);done.catch(()=>{});
    const motions=()=>mode==='single'?f.c2(P.OP.WAIT_MOTION):f.c4(M.KIND.ACTION).filter(m=>m.opcode===P.OP.WAIT_MOTION);
    const off=()=>mode==='single'?f.c2(P.OP.SHOW_OFF):f.c4(M.KIND.ACTION).filter(m=>m.opcode===P.OP.SHOW_OFF);
    await until(()=>motions().length===1);await f.b.settle();const firstArm=f.b.now;
    await f.b.sensor({gesture:3,serial:6,startedAt:firstArm-1});await f.b.advance(60);assert.equal(motions().length,1,'fresh serial with pre-arm start cannot complete');
    await f.b.sensor({gesture:3,serial:7,startedAt:firstArm});await until(()=>motions().length===2);
    await f.b.advance(60);assert.equal(off().length,0,'same completed gesture cannot serve the second wait');
    await f.b.sensor({gesture:3,serial:8,startedAt:firstArm-1});assert.equal(off().length,0);
    await f.b.sensor({gesture:3,serial:9,startedAt:f.b.now});await done;assert.equal(off().length,1);
    if(mode==='single')assert.notEqual(motions()[0][5],motions()[1][5]);else assert.notEqual(motions()[0].task,motions()[1].task);
  });
  test(`actual ${mode} runner: outer latch does not finish a body waiting on real motion; STOP wins immediately`,async t=>{
    const f=await rig(t,{direct:false});const visited=[];const run=runnerFor(f,mode,item=>visited.push(item.uid));
    const done=run.run([ir([item('motor-forward-continuous',{port:'L'},undefined,'motor'),item('motion-wait',{state:'up'},undefined,'wait'),item('display-off',{},undefined,'tail')])]);done.catch(()=>{});
    await until(()=>visited.includes('wait'));await f.b.settle();await f.b.sensor({ir:75});await f.b.sensor({ir:0});
    assert.equal(visited.includes('tail'),false);await run.stop().catch(()=>{});await done.catch(()=>{});await f.b.settle();
    assert.equal(visited.includes('tail'),false);assert.equal(f.b.latest.observing,0);assert.equal(f.b.latest.task,0);
    assert.ok(f.b.states.some(s=>s.motor.some(m=>m.op!==0)),'actual BSP motor seam recorded commands including stop');
  });
  test(`actual ${mode} runner: latched tilt observer still aborts immediately on real sensor fault inside forever/wait`,async t=>{
    const f=await rig(t,{direct:false});const visited=[],run=runnerFor(f,mode,item=>visited.push(item.uid));
    const forever=item('loop',{},[item('motion-wait',{state:'up'},undefined,'wait')],'forever');
    const program=[item('loop-tilt',{direction:'forward'},[forever,item('display-off',{},undefined,'tail')],'tilt-loop')];
    const done=run.run(program);done.catch(()=>{});await until(()=>visited.includes('wait'));await f.b.settle();
    await f.b.sensor({pose:2,ready:1});assert.equal(visited.includes('tail'),false);
    await f.b.sensor({ready:0});await assert.rejects(done,/传感器|sensor|不可用/);
    assert.equal(visited.includes('tail'),false);assert.equal(f.b.latest.observing,0);assert.equal(f.b.latest.task,0);
  });
}
test('real heartbeat loss aborts C2 wait and observations; no loop tail executes after old DONE',async t=>{
  const f=await rig(t,{direct:false});const visited=[],run=runnerFor(f,'single',item=>visited.push(item.uid));
  const done=run.run([ir([item('motion-wait',{state:'down'},undefined,'wait'),item('display-off',{},undefined,'tail')])]);done.catch(()=>{});
  await until(()=>visited.includes('wait'));await f.b.settle();await f.b.advance(1200,{heartbeat:false});await assert.rejects(done);
  assert.equal(f.b.latest.mode,0);assert.equal(f.b.latest.task,0);assert.equal(f.b.latest.observing,0);assert.equal(visited.includes('tail'),false);
});
