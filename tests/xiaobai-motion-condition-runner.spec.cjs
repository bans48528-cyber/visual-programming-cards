'use strict';
// All phone-side implementations are real. Only radio/device samples and the
// current connection application-version boundary are synthetic; no browser or hardware.
// Ordinary programming uses the 2.2.2 ready/version result, without OTA identity.
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const P=require('../xiaobai-protocol.js'),M=require('../xiaobai-multi-protocol.js');
const C=require('../xiaobai-condition-protocol.js'),Learned=require('../xiaobai-learned-commands.js');
const Legacy=require('../xiaobai-runner.js'),Multi=require('../xiaobai-multi-runner.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const observed=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
async function until(predicate,label='wire state',ms=5000){const end=Date.now()+ms;while(!predicate()&&Date.now()<end)await sleep(2);assert.ok(predicate(),label);}
let uid=0;
const block=(id,params={},children)=>({uid:'motion-condition-'+(++uid),id,params,...(children?{children}:{})});
const timed=()=>block('motor-forward',{port:'L',duration:3});
const motion=state=>block('motion-wait',{state});
const off=()=>block('display-off');
const number=value=>block('display-number',{value});
const ir=(children,comparison='greater',threshold=50)=>block('loop-infrared',{comparison,threshold},children);
const time=(children,duration=5)=>block('loop-time',{duration},children);
const snapshot=groups=>({modelId:'xiaobai',projectId:'motion-conditions',groups:groups.map(([id,items])=>({groupId:id,startId:'head-'+id,items}))});
function firmware(version=0x020202){
  const state={ready:true,targetVersion:version,currentVersion:version,epoch:'current-link',actual:{epoch:'current-link',info:{version,mode:0,imageValid:true}}};
  return {snapshot:()=>state};
}
async function fixture(t,options={}){
  const writes=[],observers=new Map(),pcStates=new Map(),observerClients=[],multiClients=[],steps=[];
  let receive,order=0,clock=0,physicalIR=options.initialIR??0,physicalTilt=options.initialTilt??0,peakObservers=0;
  const identity=req=>`${req.sessionLo}:${req.sessionHi}:${req.group}:${req.runId||0}:${req.task}`;
  const feed=bytes=>{receive(bytes.slice(0,4));receive(bytes.slice(4,11));receive(bytes.slice(11));};
  function c2Reply(req,result=0,data=[]){const b=P.frame(0xd2,[req.seq,req.opcode,result,...data]);b[1]=0x98;b[2]=0x97;b[15]=b.slice(0,15).reduce((s,v)=>s+v,0)&255;feed(b);}
  function reply(req,state,reason=0,extra=[]){feed(M.encode({...req,kind:req.kind|0x80,args:[state,reason,...extra]},true));}
  function conditionReply(req,state,reason=0,patch={}){feed(C.encode({...req,...patch,kind:req.kind|0x80,args:[state,reason,...(req.reusable?M.u32(patch.runId??req.runId):[])]},true));}
  function matches(rec){
    if(rec.opcode===C.CONDITION.IR_GT)return physicalIR>rec.args[0];
    if(rec.opcode===C.CONDITION.IR_LT)return physicalIR<rec.args[0];
    if(rec.opcode===C.CONDITION.TILT)return physicalTilt===rec.args[0];
    return clock-rec.started>=M.read32(rec.args);
  }
  function sample(){for(const rec of observers.values())if(!rec.latched&&matches(rec)){rec.latched=true;conditionReply(rec,C.STATE.DONE);}}
  function finishPC(req,state=M.STATE.DONE){
    if(req.type==='c2')c2Reply(req);
    else{pcStates.set(identity(req),state);reply(req,state);}
  }
  const link=new P.Link({async start(fn){receive=fn;},close(){},async write(bytes){
    if(bytes[4]===0xc2){
      const req={type:'c2',seq:bytes[5],opcode:bytes[6],args:Array.from(bytes.slice(7,15)),order:++order,at:Date.now()};writes.push(req);
      if(req.opcode===P.OP.DECLARE_RUN){c2Reply(req,options.declareResult??0,[...req.args.slice(0,5),0,0]);return;}
      if(req.opcode===P.OP.STOP_PROGRAM){observers.clear();return;}
      if(options.onPC)await options.onPC(req,api);
      if([P.OP.MOTOR_TIME,P.OP.MOVE_TIME,P.OP.WAIT_IR,P.OP.WAIT_TILT,P.OP.WAIT_MOTION,P.OP.WAIT_VOICE].includes(req.opcode)&&!options.holdPC?.(req))finishPC(req);
      return;
    }
    const decoded=M.decode(bytes),observer=decoded.kind>=C.KIND.ARM&&decoded.kind<=C.KIND.ACK;
    const scoped=observer?C.decode(bytes):decoded;
    // Expose descriptor args to these sampling assertions; retain the actual
    // transmitted runId prefix separately and return it in every scoped reply.
    const req={...scoped,wireArgs:scoped.args.slice(),args:observer&&scoped.reusable?scoped.args.slice(4):scoped.args.slice(),type:'c4',order:++order,at:Date.now()};writes.push(req);
    if(observer){
      if(req.kind===C.KIND.ARM){
        const rec={...req,started:clock,latched:false};rec.latched=options.initialCondition?.(rec)??matches(rec);observers.set(identity(rec),rec);
        peakObservers=Math.max(peakObservers,observers.size);conditionReply(rec,rec.latched?C.STATE.DONE:C.STATE.READY);
      }else if(req.kind===C.KIND.QUERY){const rec=observers.get(identity(req));if(rec)conditionReply(req,rec.latched?C.STATE.DONE:C.STATE.READY);}
      else if(req.kind===C.KIND.CLOSE&&!options.dropObserverClose){observers.delete(identity(req));conditionReply(req,C.STATE.CANCELLED);}
      return;
    }
    switch(req.kind){
      case M.KIND.START:reply(req,M.STATE.READY);break;
      case M.KIND.GROUP_BEGIN:reply(req,M.STATE.READY);break;
      case M.KIND.CAPS:reply(req,M.STATE.READY,0,[4,4,3,1,3,0,1,2,3,4,5,6,7,8]);break;
      case M.KIND.OPEN:case M.KIND.GROUP_OPEN:reply(req,M.STATE.ACCEPTED);break;
      case M.KIND.COMMIT:reply(req,M.STATE.READY);break;
      case M.KIND.ACTION:
        pcStates.set(identity(req),M.STATE.ACCEPTED);reply(req,M.STATE.ACCEPTED);
        if(options.onPC)await options.onPC(req,api);
        if(!options.holdPC?.(req))finishPC(req,[P.OP.MOTOR_TIME,P.OP.MOVE_TIME,P.OP.WAIT_IR,P.OP.WAIT_TILT,P.OP.WAIT_MOTION,P.OP.WAIT_VOICE,P.OP.WAIT_LEARNED].includes(req.opcode)?M.STATE.DONE:M.STATE.APPLIED);
        break;
      case M.KIND.QUERY:reply(req,pcStates.get(identity(req))||M.STATE.ACCEPTED);break;
      case M.KIND.GROUP_FINISH:case M.KIND.GROUP_END:case M.KIND.CLOSE:reply(req,M.STATE.DONE);break;
      case M.KIND.STOP:observers.clear();reply(req,M.STATE.CANCELLED);break;
    }
  }},{minWriteMs:0});
  await link.start();
  const store=new Map(),learned=new Learned.Session(link,{storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},queryMs:500,settleMs:0});
  learned.initialized=true;learned.uid='motion-condition-device';learned.capability='supported';learned.states.fill('learned');
  const fw=firmware(options.version??0x020202);link.firmwareGate=fw;
  const connection={firmware:fw,learned,async ensureFirmware(){return true;},enterProgram:()=>link.enterProgram(),
    stopProgram:()=>link.stopProgram(),action:(...args)=>link.action(...args),cancelPending:()=>link.rejectPending(Error('program stopped')),
    conditionObservers:{createClient(args){const client=new C.ObserverClient(link,{...args,timing:{queueMs:2500,replyMs:1200,retries:0}});observerClients.push(client);return client;}}};
  const api={link,connection,learned,writes,observers,steps,observerClients,multiClients,
    c2:opcode=>writes.filter(w=>w.type==='c2'&&w.opcode===opcode),c4:kind=>writes.filter(w=>w.type==='c4'&&w.kind===kind),
    actions:()=>writes.filter(w=>w.type==='c4'&&w.kind===M.KIND.ACTION),
    sampleIR(value){physicalIR=value;sample();},sampleTilt(value){physicalTilt=value;sample();},advance(ms){clock+=ms;sample();},
    get clock(){return clock;},get peakObservers(){return peakObservers;},finishPC,c2Reply,reply,conditionReply,
    legacy(){return new Legacy.Runner(connection,{isCurrent:()=>!link.closed,onStep:(item,path)=>steps.push({uid:item.uid,path})});},
    multi(){return new Multi.SessionCoordinator(connection,{isCurrent:()=>!link.closed,createClient:args=>{
      const client=new M.SessionClient(link,{...args,crypto:webcrypto,timing:{acceptMs:500,controlMs:500,retries:0,queryMs:100,statusMs:1000,taskMs:10000}});multiClients.push(client);return client;
    },onStep:(item,path,groupId)=>steps.push({uid:item.uid,path,groupId})});}
  };
  t.after(()=>{for(const client of observerClients)client.dispose();for(const client of multiClients)client.dispose();learned.dispose();link.close();});
  return api;
}

test('single IR/tilt/time loops use real RUN_CONTROL identity and each skip an initially satisfied condition',async t=>{
  const f=await fixture(t,{initialIR:51,initialTilt:2}),runner=f.legacy(),inside=off(),after=number(9);
  await runner.run([ir([inside]),block('loop-tilt',{direction:'forward'},[off()]),time([off()],0),after]);
  assert.equal(f.c2(P.OP.SHOW_OFF).length,0);assert.equal(f.c2(P.OP.SHOW_NUM).length,1);
  const declarations=f.c2(P.OP.DECLARE_RUN),arm=f.c4(C.KIND.ARM)[0];
  assert.equal(declarations.length,2);assert.equal(declarations[0].args[4],1);assert.equal(declarations[1].args[4],0);
  assert.equal(arm.group,0);assert.equal(arm.sessionLo,M.read32(declarations[0].args));assert.equal(arm.sessionHi,0);
  assert.ok(arm.order>declarations[0].order);assert.equal(f.c4(C.KIND.CLOSE).length,3);assert.equal(f.c4(C.KIND.ARM).length,3);
});

test('legacy RUN_CONTROL fallback cannot activate conditional loops or preceding motor blocks',async t=>{
  const f=await fixture(t,{declareResult:2}),runner=f.legacy();
  await assert.rejects(runner.run([block('motor-forward-continuous',{port:'L'}),ir([off()])]),/运行身份/);
  assert.equal(f.c2(P.OP.MOTOR_RUN).length,0);assert.equal(f.c4(C.KIND.ARM).length,0);
  assert.equal(f.c2(P.OP.STOP_PROGRAM).length,1);
});

test('single observer latches while C2 PC is blocked, then waits for the whole round including a later permanent wait',async t=>{
  const f=await fixture(t,{holdPC:req=>[P.OP.MOTOR_TIME,P.OP.WAIT_MOTION].includes(req.opcode)}),runner=f.legacy();
  const done=observed(runner.run([ir([timed(),motion('up')]),number(7)]));
  await until(()=>f.c2(P.OP.MOTOR_TIME).length===1);const motor=f.c2(P.OP.MOTOR_TIME)[0],arm=f.c4(C.KIND.ARM)[0];
  for(const patch of [{sessionLo:arm.sessionLo+1},{sessionHi:1,group:1},{task:arm.task+1},{group:1},{opcode:C.CONDITION.TILT}])f.conditionReply(arm,C.STATE.DONE,0,patch);
  await sleep(5);assert.equal(f.c4(C.KIND.ACK).some(req=>req.args[0]===C.STATE.DONE),false,'foreign SID/group/observer/type cannot latch this condition');
  assert.equal(f.c2(P.OP.WAIT_MOTION).length,0);f.sampleIR(51);f.sampleIR(0);
  await sleep(320);assert.ok(f.c2(P.OP.HEARTBEAT).length>=1,'existing heartbeat survives independent observation');
  assert.equal(f.c2(P.OP.WAIT_MOTION).length,0);assert.equal(f.c2(P.OP.SHOW_NUM).length,0);
  assert.ok(f.c4(C.KIND.ACK).some(req=>req.task===arm.task&&req.args[0]===C.STATE.DONE));
  f.c2Reply({...motor,seq:motor.seq+20});await sleep(5);assert.equal(f.c2(P.OP.WAIT_MOTION).length,0);
  f.finishPC(motor);await until(()=>f.c2(P.OP.WAIT_MOTION).length===1);
  assert.equal(f.c2(P.OP.SHOW_NUM).length,0,'matching condition cannot finish the still-pending round tail');
  f.finishPC(f.c2(P.OP.WAIT_MOTION)[0]);assert.equal((await done).ok,true);
  assert.equal(f.c2(P.OP.MOTOR_TIME).length,1);assert.equal(f.c2(P.OP.SHOW_NUM).length,1);
});

for(const mode of ['single','multi'])test(`real device TIME observer in ${mode}: 5 seconds with 3-second rounds completes two whole rounds`,async t=>{
  const f=await fixture(t,{onPC(req,api){if(req.opcode===P.OP.MOTOR_TIME)api.advance(3000);}});
  const program=[time([timed()],5),number(8)];
  if(mode==='single')await f.legacy().run(program);else await f.multi().run(snapshot([['a',program]]));
  assert.equal(f.clock,6000);assert.equal(mode==='single'?f.c2(P.OP.MOTOR_TIME).length:f.actions().filter(x=>x.opcode===P.OP.MOTOR_TIME).length,2);
  const arm=f.c4(C.KIND.ARM)[0];assert.equal(arm.opcode,C.CONDITION.TIME);assert.equal(M.read32(arm.args),5000);
  assert.equal(f.c4(C.KIND.QUERY).length,1);assert.equal(f.c2(P.OP.READ_IR).length+f.c2(P.OP.READ_TILT).length,0);
});

test('nested observers retain separate identities; an outer latch cannot truncate the inner loop or outer tail',async t=>{
  const f=await fixture(t,{onPC(req,api){if(req.opcode===P.OP.MOTOR_TIME){api.advance(3000);api.sampleIR(51);api.sampleIR(0);}}}),runner=f.legacy();
  await runner.run([ir([time([timed()],5),off()]),number(4)]);
  const arms=f.c4(C.KIND.ARM);assert.equal(arms.length,2);assert.notEqual(arms[0].task,arms[1].task);
  assert.equal(f.peakObservers,2);assert.equal(f.c2(P.OP.MOTOR_TIME).length,2);assert.equal(f.c2(P.OP.SHOW_OFF).length,1);
  const closes=f.c4(C.KIND.CLOSE);assert.deepEqual(closes.map(x=>x.task),[arms[1].task,arms[0].task]);
  assert.ok(f.c2(P.OP.SHOW_OFF)[0].order<closes[1].order);assert.equal(f.c2(P.OP.SHOW_NUM).length,1);
});

test('strict IR greater/less descriptors and fresh observer IDs survive separate complete rounds',async t=>{
  const f=await fixture(t,{initialIR:50,holdPC:req=>req.opcode===P.OP.MOTOR_TIME}),runner=f.legacy();
  const done=observed(runner.run([ir([timed()],'greater',50),ir([timed()],'less',50)]));
  await until(()=>f.c2(P.OP.MOTOR_TIME).length===1);f.sampleIR(50);await sleep(5);
  assert.equal(f.c4(C.KIND.ACK).filter(x=>x.args[0]===C.STATE.DONE).length,0);
  f.sampleIR(51);f.finishPC(f.c2(P.OP.MOTOR_TIME)[0]);await until(()=>f.c2(P.OP.MOTOR_TIME).length===2);
  const arms=f.c4(C.KIND.ARM);assert.deepEqual(arms.map(x=>[x.opcode,x.args]),[[C.CONDITION.IR_GT,[50]],[C.CONDITION.IR_LT,[50]]]);assert.notEqual(arms[0].task,arms[1].task);
  f.conditionReply(arms[0],C.STATE.DONE);f.sampleIR(50);await sleep(5);assert.equal(f.c4(C.KIND.CLOSE).length,1);
  assert.equal(f.c4(C.KIND.ACK).some(x=>x.task===arms[1].task&&x.args[0]===C.STATE.DONE),false,'previous observer DONE cannot satisfy this fresh condition');
  f.sampleIR(49);f.finishPC(f.c2(P.OP.MOTOR_TIME)[1]);assert.equal((await done).ok,true);
});

test('multi group observation neither occupies a PC permit nor stops another group',async t=>{
  const f=await fixture(t,{holdPC:req=>req.opcode===P.OP.MOTOR_TIME}),runner=f.multi();
  const done=observed(runner.run(snapshot([['a',[ir([timed(),off()])]],['b',[number(3)]]])));
  await until(()=>f.actions().some(x=>x.group===1&&x.opcode===P.OP.MOTOR_TIME)&&f.c4(M.KIND.GROUP_FINISH).some(x=>x.group===2));
  const arm=f.c4(C.KIND.ARM)[0],motor=f.actions().find(x=>x.opcode===P.OP.MOTOR_TIME);
  assert.equal(arm.sessionLo,f.multiClients[0].sessionLo);assert.equal(arm.sessionHi,f.multiClients[0].sessionHi);assert.equal(arm.group,1);
  assert.equal(f.c2(P.OP.DECLARE_RUN).length,0,'multi observers bind C4 START, not a separate legacy run');
  assert.equal(f.c4(M.KIND.START).length,1);assert.deepEqual(f.c4(M.KIND.START)[0].args,[3]);
  assert.equal(arm.reusable,true);assert.equal(arm.runId,1);assert.equal(M.read32(arm.wireArgs),1);
  for(const kind of [M.KIND.CAPS,M.KIND.OPEN,M.KIND.GROUP_OPEN,M.KIND.COMMIT])assert.equal(f.c4(kind).length,0);
  f.sampleIR(51);f.sampleIR(0);await sleep(5);assert.equal(f.actions().some(x=>x.opcode===P.OP.SHOW_OFF),false);
  f.finishPC(motor);assert.equal((await done).ok,true);
  assert.equal(f.actions().filter(x=>x.opcode===P.OP.SHOW_OFF).length,1);assert.equal(f.c4(M.KIND.STOP).length,0);
});

test('observer fault interrupts a permanent single-PC wait immediately and ignores late PC DONE',async t=>{
  const f=await fixture(t,{holdPC:req=>req.opcode===P.OP.WAIT_MOTION}),runner=f.legacy(),conditional=ir([motion('up'),off()]);
  const done=observed(runner.run([conditional,number(5)]));await until(()=>f.c2(P.OP.WAIT_MOTION).length===1);
  const wait=f.c2(P.OP.WAIT_MOTION)[0],arm=f.c4(C.KIND.ARM)[0],faultAt=Date.now();f.conditionReply(arm,C.STATE.FAILED,C.REASON.SENSOR);
  await until(()=>f.c2(P.OP.STOP_PROGRAM).length===1,'immediate STOP after observer fault');
  assert.ok(f.c2(P.OP.STOP_PROGRAM)[0].at-faultAt<1000,'STOP cannot wait for the 1200ms observer reply timeout');
  const outcome=await done;assert.equal(outcome.ok,false);assert.equal(f.link.pending.size,0);assert.equal(outcome.error.blockUid,conditional.uid);assert.deepEqual(outcome.error.path,[0]);
  f.finishPC(wait);await sleep(5);assert.equal(f.c2(P.OP.SHOW_OFF).length+f.c2(P.OP.SHOW_NUM).length,0);
});

test('observer fault in one group stops all groups including an unrelated permanent PC wait',async t=>{
  const f=await fixture(t,{holdPC:req=>req.opcode===P.OP.WAIT_MOTION||req.opcode===P.OP.WAIT_IR}),runner=f.multi(),conditional=ir([motion('down')]);
  const done=observed(runner.run(snapshot([['a',[conditional,number(1)]],['b',[block('infrared-wait',{comparison:'greater',threshold:70}),number(2)]]])));
  await until(()=>f.actions().length===2);const arm=f.c4(C.KIND.ARM)[0],faultAt=Date.now();f.conditionReply(arm,C.STATE.FAILED,C.REASON.SENSOR);
  await until(()=>f.c4(M.KIND.STOP).length===1);const result=await done;assert.equal(result.ok,false);
  assert.ok(f.c4(M.KIND.STOP)[0].at-faultAt<1000,'global STOP cannot wait for an observer exchange');
  assert.equal(result.error.groupId,'a');assert.equal(result.error.blockUid,conditional.uid);
  assert.equal(f.actions().some(x=>x.opcode===P.OP.SHOW_NUM),false);
});

test('manual STOP does not wait for an unacknowledged normal observer CLOSE', {timeout:1500},async t=>{
  const f=await fixture(t,{initialIR:60,dropObserverClose:true}),runner=f.legacy();const done=observed(runner.run([ir([off()]),number(9)]));
  await until(()=>f.c4(C.KIND.CLOSE).length===1);const stopAt=Date.now(),stopped=observed(runner.stop());
  await until(()=>f.c2(P.OP.STOP_PROGRAM).length===1);await stopped;await done;
  assert.ok(f.c2(P.OP.STOP_PROGRAM)[0].at-stopAt<1000,'unconfirmed CLOSE cannot hold manual STOP');
  assert.equal(f.c2(P.OP.SHOW_NUM).length,0);assert.equal(f.observerClients[0].records.size,0);
});

test('an inner forever loop keeps its outer latched round open until manual STOP',async t=>{
  const f=await fixture(t),runner=f.legacy(),inner=block('loop',{},[block('wait-time',{duration:.001})]);
  const done=observed(runner.run([ir([inner,off()]),number(8)]));
  await until(()=>f.steps.some(step=>step.uid===inner.uid));f.sampleIR(51);await sleep(35);
  assert.equal(f.c4(C.KIND.CLOSE).length,0);assert.equal(f.c2(P.OP.SHOW_OFF).length+f.c2(P.OP.SHOW_NUM).length,0);
  await observed(runner.stop());await done;assert.equal(f.c2(P.OP.STOP_PROGRAM).length,1);
});

test('four active observers per each of four real multi groups fit; fifth nesting rejects before any device mode/action',async t=>{
  const nested=depth=>{let value=off();for(let i=0;i<depth;i++)value=ir([value]);return value;};
  const bad=await fixture(t),badSingle=bad.legacy(),badMulti=bad.multi();
  assert.throws(()=>badSingle.run([block('motor-forward-continuous',{port:'L'}),nested(5)]),error=>error.code==='OBSERVER_LIMIT'&&error.path.join('.')==='1.0.0.0.0');
  assert.throws(()=>badMulti.run(snapshot([['bad',[nested(5)]]])),error=>error.code==='OBSERVER_LIMIT'&&error.groupId==='bad'&&error.path.join('.')==='0.0.0.0.0');assert.equal(bad.writes.length,0);
  const f=await fixture(t,{holdPC:req=>req.type==='c4'&&req.opcode===P.OP.SHOW_OFF}),runner=f.multi();
  let earlyResult;
  const done=observed(runner.run(snapshot(['a','b','c','d'].map(id=>[id,[nested(4)]])))).then(value=>{earlyResult=value;return value;});
  // The production writer retains its minimum paced radio interval. Sixteen
  // ARMs plus their ACKs and four PC actions legitimately take over 1.2s.
  await until(()=>f.actions().length===4||earlyResult,'four groups reached their deepest body',5000);
  assert.equal(earlyResult,undefined,JSON.stringify({error:earlyResult?.error?.message,code:earlyResult?.error?.code,arms:f.c4(C.KIND.ARM).map(x=>[x.group,x.task]),actions:f.actions().map(x=>[x.group,x.opcode]),peak:f.peakObservers}));
  assert.equal(f.peakObservers,16);assert.equal(f.c4(C.KIND.ARM).length,16);
  f.sampleIR(51);for(const action of f.actions())f.finishPC(action,M.STATE.APPLIED);
  assert.equal((await done).ok,true);assert.equal(f.c4(C.KIND.CLOSE).length,16);
});

test('new motion and condition features reject 2.0.2 and 2.1.0 before any preceding motor, run identity or multi START',async t=>{
  const features=[...Object.keys(P.MOTION_TARGETS).map(state=>()=>motion(state)),
    ()=>ir([off()]),()=>block('loop-tilt',{direction:'forward'},[off()]),()=>time([off()])];
  for(const version of [0x020002,0x020100])for(const mode of ['single','multi'])for(const feature of features){
    const f=await fixture(t,{version}),target=feature(),items=[block('motor-forward-continuous',{port:'L'}),target];
    const done=mode==='single'?f.legacy().run(items):f.multi().run(snapshot([['g',items]]));
    await assert.rejects(done,e=>mode==='single'
      ? e.code==='CONTROL_FIRMWARE'&&e.blockUid===target.uid&&e.path.join('.')==='1'&&e.message.includes('2.1.1')
      : e.code==='FIRMWARE'&&e.message.includes('核对'));
    // The exact current-version gate precedes per-block feature checking in
    // multi mode. Older boards still cannot send START, observers or motors.
    assert.equal(f.c2(P.OP.MOTOR_RUN).length+f.actions().length,0);
    assert.equal(f.c2(P.OP.DECLARE_RUN).length,0);
    assert.equal(f.c4(M.KIND.START).length+f.c4(M.KIND.CAPS).length+f.c4(M.KIND.OPEN).length+f.c4(C.KIND.ARM).length,0);
  }
});

test('C2 consecutive up/down motion waits require fresh sequences and corresponding real DONE',async t=>{
  const f=await fixture(t,{holdPC:req=>req.opcode===P.OP.WAIT_MOTION}),runner=f.legacy();
  const done=observed(runner.run([motion('up'),motion('down'),number(6)]));
  await until(()=>f.c2(P.OP.WAIT_MOTION).length===1);const first=f.c2(P.OP.WAIT_MOTION)[0];assert.equal(first.args[0],3);
  f.c2Reply({...first,opcode:P.OP.READ_TILT});await sleep(5);assert.equal(f.c2(P.OP.WAIT_MOTION).length,1);
  f.finishPC(first);f.finishPC(first);await until(()=>f.c2(P.OP.WAIT_MOTION).length===2);
  const second=f.c2(P.OP.WAIT_MOTION)[1];assert.equal(second.args[0],4);assert.notEqual(first.seq,second.seq);
  f.finishPC(first);await sleep(5);assert.equal(f.c2(P.OP.SHOW_NUM).length,0);f.finishPC(second);
  assert.equal((await done).ok,true);assert.equal(f.c2(P.OP.SHOW_NUM).length,1);
});

test('C4 consecutive motion waits need new task identities; ACCEPTED and previous DONE do not advance',async t=>{
  const f=await fixture(t,{holdPC:req=>req.opcode===P.OP.WAIT_MOTION}),runner=f.multi();
  const done=observed(runner.run(snapshot([['a',[motion('up'),motion('up'),number(7)]]])));
  await until(()=>f.actions().length===1);const first=f.actions()[0];assert.equal(first.opcode,P.OP.WAIT_MOTION);assert.deepEqual(first.args,[3]);
  await sleep(5);assert.equal(f.actions().length,1);f.finishPC(first);f.finishPC(first);
  await until(()=>f.actions().length===2);const second=f.actions()[1];assert.notEqual(second.task,first.task);
  f.finishPC(first);await sleep(5);assert.equal(f.actions().length,2);f.finishPC(second);
  assert.equal((await done).ok,true);assert.equal(f.actions().length,3);
});

test('APPLIED cannot pretend a new C4 motion gesture completed',async t=>{
  const f=await fixture(t,{holdPC:req=>req.opcode===P.OP.WAIT_MOTION}),runner=f.multi();
  const done=observed(runner.run(snapshot([['a',[motion('down'),number(8)]]])));
  await until(()=>f.actions().length===1);f.finishPC(f.actions()[0],M.STATE.APPLIED);
  const result=await done;assert.equal(result.ok,false);assert.equal(f.actions().length,1);assert.ok(f.c4(M.KIND.STOP).length>=1);
});
