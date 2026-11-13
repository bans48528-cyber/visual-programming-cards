'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('../xiaobai-protocol.js'),Legacy=require('../xiaobai-runner.js');
const Multi=require('../xiaobai-multi-runner.js'),DeviceModels=require('../device-models.js');
const Canvas=require('../canvas-workspace.js');
const still=()=>({uid:'still',id:'motion-wait',params:{state:'still'}});
const loop=()=>({uid:'loop',id:'loop-count',params:{count:2},children:[still()]});
const firmware=require('./helpers/motion-condition-fixture.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let n=0;n<100&&!predicate();n++)await sleep(5);assert.ok(predicate(),'expected protocol state');}
const snapshot=items=>({modelId:'xiaobai',projectId:'still-test',groups:[{groupId:'group',startId:'head',items}]});

test('motion catalog has four independent states; tilt retains only four directions and old wire target1',()=>{
  const context={DeviceModels};context.window=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../xiaobai-model.js'),'utf8'),context);
  const cards=context.CardModels.get('xiaobai').catalog.logic.cards;
  assert.deepEqual(Array.from(cards.find(c=>c.id==='motion-wait').paramsSchema.state.options,o=>o.value),['still','shaking','up','down']);
  const tilt=cards.find(c=>c.id==='tilt-wait').paramsSchema.direction;
  assert.deepEqual(Array.from(tilt.options,o=>o.value),['forward','backward','left','right']);assert.equal(tilt.legacyValues,undefined);
  assert.equal(P.TILT_TARGETS.still,1,'retain deployed low-level wire protocol');
  for(const [state,value] of Object.entries(P.MOTION_TARGETS)){
    const item={...still(),params:{state}};assert.doesNotThrow(()=>Legacy.validate([item]));
    assert.deepEqual(Multi.command(item,{}),{opcode:0x34,args:[value],timeoutMs:undefined});
  }
});

test('still parameter, UID, nested structure and position survive canvas/store round trip',()=>{
  const doc=Canvas.normalize({...Canvas.create(),groups:[{id:'g',startId:'s',x:-192.5,y:216.25,items:[loop()]}],
    viewport:{x:13,y:-50,scale:.75},selectedGroupId:'g'});
  const storage=new Map(),store=DeviceModels.createStore({getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},'xiaobai');
  store.write([{id:'project',name:'等待平稳测试',modelId:'xiaobai',state:doc}]);
  const restored=Canvas.normalize(store.read()[0].state);assert.deepEqual(restored,doc);
  assert.equal(restored.groups[0].items[0].children[0].params.state,'still');
  assert.equal(Multi.validateSnapshot(snapshot(restored.groups[0].items)).groups[0].items[0].children[0].params.state,'still');
});

test('old tilt still/level and invalid motion values are rejected without migration',()=>{
  for(const direction of ['still','level'])assert.throws(()=>Legacy.validate([{id:'tilt-wait',params:{direction}}]),/倾倒方向/);
  for(const state of ['level','moving','constructor',undefined])assert.throws(()=>Legacy.validate([{id:'motion-wait',params:{state}}]),/运动状态/);
});

test('all motion states compile on the tablet WebView without Object.hasOwn',async()=>{
  const context=vm.createContext({setTimeout,clearTimeout,setInterval,clearInterval});vm.runInContext('Object.hasOwn=undefined;',context);
  for(const file of ['xiaobai-protocol.js','xiaobai-multi-protocol.js','xiaobai-condition-protocol.js','xiaobai-control-flow.js','xiaobai-runner.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  for(const [state,value] of Object.entries(P.MOTION_TARGETS)){
    const calls=[],connection={firmware:firmware(),async enterProgram(){},async stopProgram(){},async action(op,args,blocking){calls.push([op,Array.from(args),blocking]);}};
    await new context.XiaobaiRunner.Runner(connection).run([{id:'motion-wait',params:{state}}]);assert.deepEqual(calls,[[P.OP.WAIT_MOTION,[value],true]]);
  }
});

test('still requires fresh verified 2.1.1+ App identity; old/unknown/stale boards cannot start preceding motors',async()=>{
  assert.equal(Legacy.FEATURE_MIN_FIRMWARE,0x020101,'feature minimum is independent of the exact current multi release');
  const good=firmware().snapshot();
  const bad=[undefined,firmware(0x020000),firmware(0x020001),firmware(0x020002),firmware(0x020100),firmware(0x010101),{snapshot:()=>({...good,ready:false})},
    {snapshot:()=>({...good,actual:{...good.actual,epoch:'old'}})},
    {snapshot:()=>({...good,currentVersion:0x020000})},
    {snapshot:()=>({...good,actual:{...good.actual,info:{...good.actual.info,mode:1}}})}];
  for(const fw of bad){
    const calls=[],connection={firmware:fw,async enterProgram(){calls.push('enter');},async ensureFirmware(){return true;},
      async action(){calls.push('action');},async stopProgram(){calls.push('stop');}};
    const program=[{id:'motor-forward-continuous',params:{port:'L'}},loop()];
    await assert.rejects(new Legacy.Runner(connection).run(program),e=>e.code==='CONTROL_FIRMWARE'&&e.blockUid==='still'&&e.path.join('.')==='1.0');
    assert.deepEqual(calls,['enter','stop']);
  }
  assert.doesNotThrow(()=>Legacy.requireFeatureFirmware([loop()],{firmware:firmware()}));
  assert.doesNotThrow(()=>Legacy.requireFeatureFirmware([loop()],{firmware:firmware(0x020101)}),'a synthetic ready 2.1.1 identity satisfies the feature minimum, not the current release pin');
  assert.doesNotThrow(()=>Legacy.requireFeatureFirmware([{id:'tilt-wait',params:{direction:'forward'}}],{}));
});

test('still requires the signed compact package to match every live image identity field',()=>{
  const check=fw=>assert.throws(()=>Legacy.requireFeatureFirmware([still()],{firmware:fw}),{code:'CONTROL_FIRMWARE'});
  for(const patch of [{signatureVerified:false},{boardId:259},{version:0x020003},{format:1},{layoutId:1},
    {appBase:0x08004000},{erasePage:4096},{imageSize:45184},{imageSha256:'0'.repeat(64)}]){
    const fw=firmware();Object.assign(fw.bundle.pkg,patch);check(fw);
  }
  for(const patch of [{boardId:259},{protocol:2},{schemaVersion:1},{layoutId:1},{activeAppBase:0x08004000},
    {erasePage:4096},{imageSize:45184},{imageSha256:'0'.repeat(64)},{imageValid:false}]){
    const fw=firmware();Object.assign(fw.snapshot().actual.info,patch);check(fw);
  }
  const missing=firmware();delete missing.bundle;check(missing);
});

test('arbitrary orientation stillness uses real target1 DONE; diagnostic UPRIGHT and duplicate DONE cannot advance',async t=>{
  let receive;const writes=[];
  const link=new P.Link({async start(fn){receive=fn;},async write(bytes){writes.push(Uint8Array.from(bytes));},close(){}},{minWriteMs:0});
  await link.start();link.firmware=firmware();t.after(()=>link.close());
  const receiveDone=(seq,opcode,result=0,posture=1)=>{const b=P.frame(0xd2,[seq,opcode,result,posture,1,1]);b[1]=0x98;b[2]=0x97;b[15]=b.slice(0,15).reduce((s,v)=>s+v,0)&255;receive(b);};
  const sent=op=>writes.filter(b=>b[6]===op);
  const done=new Legacy.Runner(link).run([still(),{...still(),uid:'still2'},{id:'display-off'}]);
  await until(()=>sent(P.OP.WAIT_MOTION).length===1);const first=sent(P.OP.WAIT_MOTION)[0];
  assert.deepEqual(Array.from(first.slice(7,15)),[1,0,0,0,0,0,0,0]);
  for(const posture of [1,2,3,4,5,6])receiveDone(first[5],P.OP.READ_TILT,0,posture);
  await sleep(340);
  assert.ok(sent(P.OP.HEARTBEAT).length>=1);assert.equal(sent(P.OP.WAIT_MOTION).length,1);
  assert.equal(sent(P.OP.SHOW_OFF).length,0);assert.equal(sent(P.OP.READ_TILT).length,0);
  // No phone-side orientation restriction: the device may complete target1
  // while inverted. The opaque DONE is authoritative, not diagnostic state1.
  receiveDone(first[5],P.OP.WAIT_MOTION,0,6);receiveDone(first[5],P.OP.WAIT_MOTION,0,6);
  await until(()=>sent(P.OP.WAIT_MOTION).length===2);const second=sent(P.OP.WAIT_MOTION)[1];
  assert.notEqual(second[5],first[5]);assert.equal(second[7],1);
  receiveDone(first[5],P.OP.WAIT_MOTION);await sleep(15);assert.equal(sent(P.OP.SHOW_OFF).length,0);
  receiveDone(second[5],P.OP.WAIT_MOTION);await done;assert.equal(sent(P.OP.SHOW_OFF).length,1);
});

test('old firmware is rejected before multi START even with a nested motion wait',async()=>{
  let opened=false;
  const connection={firmware:firmware(0x020000),async enterProgram(){},async ensureFirmware(){return true;}};
  const coordinator=new Multi.SessionCoordinator(connection,{createClient:()=>{opened=true;throw Error('must not open');}});
  await assert.rejects(coordinator.run(snapshot([loop()])),{code:'FIRMWARE'});
  assert.equal(opened,false);
});

test('multi still sends target1 and keeps its own PC blocked until device completion',async()=>{
  const calls=[],pending=[];
  const connection={firmware:firmware(require('../assets/firmware/release.json').firmware.version),async enterProgram(){},async ensureFirmware(){return true;}};
  const coordinator=new Multi.SessionCoordinator(connection,{createClient:()=>({
    async open(){return {maxGroups:4,maxPcTasks:4};},
    action(group,opcode,args){calls.push({group,opcode,args});if(opcode===P.OP.WAIT_MOTION)return new Promise(resolve=>pending.push(resolve));return Promise.resolve({state:4});},
    async beginGroup(){throw Error('the ordinary group is already started');},async finishGroup(group,task){return {state:3,group,task};},async close(){},async stop(){},dispose(){}
  })});
  const done=coordinator.run(snapshot([still(),{uid:'off',id:'display-off'}]));
  await until(()=>pending.length===1);assert.deepEqual(calls,[{group:1,opcode:P.OP.WAIT_MOTION,args:[1]}]);
  await sleep(30);assert.equal(calls.length,1);pending[0]({state:3});await done;
  assert.equal(calls[1].opcode,P.OP.SHOW_OFF);
});
