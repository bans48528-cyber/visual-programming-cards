'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../xiaobai-ui.js'),'utf8');
const Multi=require('../xiaobai-multi-runner.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const release=require('../assets/firmware/release.json');
const bundled=require('../xiaobai-firmware-bundle.js').METADATA;
function setup(version=release.firmware.version){
  const listeners=new Map(),elements=new Map(),locks=[],requests=[],runs=[],notices=[];
  const classes=()=>{const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v),toggle(v,on){if(on)values.add(v);else values.delete(v);}};};
  const element=id=>{if(!elements.has(id))elements.set(id,{id,classList:classes(),setAttribute(){},querySelector(){return this;}});return elements.get(id);};
  const blocks=['a','b'].map(id=>({dataset:{nodeUid:id+'-block'},classList:classes()}));
  const document={hidden:false,body:{classList:classes()},getElementById:element,querySelectorAll:selector=>selector.includes('is-executing')?blocks.filter(b=>b.classList.contains('is-executing')):blocks,addEventListener(){}};
  const groups=['b','a'].map(id=>({groupId:id,startId:id+'-head',items:[{uid:id+'-block',id:'wait-time',params:{duration:1}}]}));
  const editor={setExecutionLocked:on=>locks.push(on),getRunSnapshot(options){requests.push(options);return {modelId:'xiaobai',projectId:'p',groups:options.groupId?groups.filter(g=>g.groupId===options.groupId):groups};},getExecutionGroup:id=>({groupId:id||'a',items:groups.find(g=>g.groupId===(id||'a')).items}),findBlockByUid:uid=>blocks.find(b=>b.dataset.nodeUid===uid),findBlock:()=>{throw new Error('must locate new UI by uid');}};
  const device={id:'xiaobai',name:'小白',execution:{kind:'stream',validate:x=>x},remote:{close:async()=>{}}};
  const compact=Multi.releaseSupports({bound:true,firmware:{version,boardId:258,protocol:1}}),layoutId=compact?2:1,appBase=compact?0x08003000:0x08004000,hash='c'.repeat(64);
  const pkg={signatureVerified:true,boardId:258,version,format:layoutId,layoutId,appBase,erasePage:128,imageSize:320,imageSha256:hash};
  const firmwareState={ready:true,targetVersion:version,currentVersion:version,epoch:'c',actual:{epoch:'c',info:{protocol:1,schemaVersion:layoutId,boardId:258,version,mode:0,imageValid:true,layoutId,activeAppBase:appBase,erasePage:128,imageSize:320,imageSha256:hash}}};
  const firmware={bundle:{pkg},snapshot:()=>firmwareState},connection={id:'c',firmware,multiProgram:{},ensureFirmware:async()=>true,stopProgram:async()=>{}};
  const pin={bound:true,firmware:{boardId:258,protocol:1,version,...(compact?{layoutId:2,imageSha256:hash}:{})}};
  class Coordinator{
    constructor(c,options){this.options=options;this.connection=c;runs.push(this);}
    run(snapshot){this.snapshot=snapshot;this.done=new Promise(resolve=>{this.finish=resolve;});return this.done;}
    async stop(){this.stopped=true;this.finish?.({state:'cancelled'});}
  }
  const api={...Multi,SessionCoordinator:Coordinator};
  const window={CardEditor:editor,CardHome:{activeModelId:'xiaobai'},CardBluetooth:{remoteConnection:()=>connection,firmware,connected:true},CardModelSession:{current:device,selected:true,capture:()=>({model:device,isCurrent:()=>true})},XiaobaiMultiProgram:api,XiaobaiFirmwareBundle:{METADATA:pin},showExecutionNotice:x=>notices.push(x),addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent(){}};
  const context={window,document,location:{hash:'#editor'},Event:class{},cardById:{},program:[],XiaobaiMultiProgram:api,XiaobaiRunner:{validate:x=>x},DeviceModels:{createExecution:(s,o)=>new Coordinator(connection,o)}};
  vm.runInNewContext(source,context);return {window,element,blocks,locks,requests,runs,notices,firmwareState,firmware,pin,groups};
}
test('future matched release: global run freezes all groups, head runs one, UID marks coexist and editing stays locked',async()=>{
  const f=setup();assert.equal(bundled.bound,true);assert.equal(bundled.firmware.version,release.firmware.version);
  f.window.XiaobaiFirmwareBundle.METADATA=bundled;
  const done=f.element('runProgramBtn').onclick({type:'click'});await flush();
  assert.equal(f.requests[0].all,true);assert.deepEqual(Array.from(f.runs[0].snapshot.launchOrder),['a','b']);assert.equal(f.locks[f.locks.length-1],true);
  for(const group of f.runs[0].snapshot.groups)f.runs[0].options.onStep(group.items[0],[0],group.groupId);
  assert.ok(f.blocks.every(b=>b.classList.contains('is-executing')));
  await f.window.CardProgram.runGroup('b');assert.equal(f.runs.length,1);
  f.runs[0].finish({state:'completed'});await done;assert.equal(f.locks[f.locks.length-1],false);
  const second=f.window.CardProgram.runGroup('b');await flush();assert.equal(f.requests[1].groupId,'b');assert.equal(f.runs[1].snapshot.groups.length,1);await f.window.CardProgram.stop();await second;
});
test('current 1.0.4 pin preserves legacy single group and does not negotiate C4',async()=>{
  const f=setup(0x010004);const done=f.window.CardProgram.runGroup('a');await flush();
  assert.equal(f.requests.length,1);assert.equal(f.runs[0].snapshot[0].uid,'a-block');await f.window.CardProgram.stop();await done;
});

test('original 1.1.1 pin stays legacy rather than guessing 2.2.2 START compatibility',async()=>{
  for(const version of [0x010101,0x020204]){
   const f=setup(version);await f.element('runProgramBtn').onclick({type:'click'});
   assert.equal(f.runs.length,0);assert(f.notices.some(text=>text.includes('尚未支持')));
   if(version===0x020204){await f.window.CardProgram.runGroup('a');assert.equal(f.runs.length,0);}
 }
});

test('compact pin cannot construct a runner with stale entry/version; ordinary run does not need full OTA proof',async()=>{
  for(const patch of [{mode:1},{imageValid:false},{version:0x020201}]){const f=setup();Object.assign(f.firmwareState.actual.info,patch);await f.element('runProgramBtn').onclick({type:'click'});await flush();assert.equal(f.runs.length,0);assert.equal(f.locks.at(-1),false);}
  const stale=setup();stale.firmwareState.actual.epoch='old';await stale.element('runProgramBtn').onclick({type:'click'});assert.equal(stale.runs.length,0);
  const f=setup();delete f.firmware.bundle;for(const key of ['uid','deviceId'])delete f.firmwareState.actual[key];for(const key of ['layoutId','imageSha256','imageSize','activeAppBase'])delete f.firmwareState.actual.info[key];
  const done=f.element('runProgramBtn').onclick({type:'click'});await flush();assert.equal(f.runs.length,1);f.runs[0].finish({state:'completed'});await done;
});

test('stop fences late callbacks and releases structure lock only after cleanup',async()=>{
  const f=setup();const done=f.window.CardProgram.runGroup('a');await flush();const old=f.runs[0];await f.window.CardProgram.stop();await done;
  old.options.onStep(old.snapshot.groups[0].items[0],[0],'a');assert.equal(f.blocks.some(b=>b.classList.contains('is-executing')),false);assert.equal(f.locks[f.locks.length-1],false);
});

test('message editing remains possible while current application version is unknown, but UI cannot START',async()=>{
 const f=setup();f.firmwareState.ready=false;f.groups[0].trigger={type:'message',message:5};
 await f.element('runProgramBtn').onclick({type:'click'});
 assert.equal(f.runs.length,0);assert(f.notices.some(text=>text.includes('核对')));
 assert.equal(f.locks.at(-1),false);
});

test('an invocation returning to idle clears only its own last executing mark',async()=>{
 const f=setup(),done=f.element('runProgramBtn').onclick({type:'click'});await flush();
 const runner=f.runs[0];
 for(const group of runner.snapshot.groups)runner.options.onStep(group.items[0],[0],group.groupId);
 runner.options.onGroupState('a','IDLE');
 assert.equal(f.blocks[0].classList.contains('is-executing'),false);
 assert.equal(f.blocks[1].classList.contains('is-executing'),true);
 await f.window.CardProgram.stop();await done;
});

test('current release permits a message snapshot through the UI gate',async()=>{
 const f=setup();f.window.XiaobaiFirmwareBundle.METADATA=bundled;
 Object.assign(f.firmwareState.actual,{uid:'01'.repeat(12),deviceId:'synthetic-current-device'});
 f.groups[0].trigger={type:'message',message:5};
 const done=f.element('runProgramBtn').onclick({type:'click'});await flush();
 assert.equal(f.runs.length,1);assert.equal(f.runs[0].snapshot.groups.find(g=>g.groupId==='b').trigger.message,5);
 assert.deepEqual(Array.from(f.runs[0].snapshot.launchOrder),['a']);assert.equal(f.locks.at(-1),true);
 f.runs[0].finish({state:'completed'});await done;assert.equal(f.locks.at(-1),false);
});

test('different device versions cannot run message programs under a 2.2.2 pin',async()=>{
 for(const version of [0x020105,0x020200,0x020201,0x020203]){
  const f=setup(0x020202);Object.assign(f.firmwareState.actual,{uid:'01'.repeat(12),deviceId:'synthetic-current-device'});
  f.firmwareState.currentVersion=version;f.firmwareState.actual.info.version=version;f.firmware.bundle.pkg.version=version;
  f.groups[0].trigger={type:'message',message:5};await f.element('runProgramBtn').onclick({type:'click'});
  assert.equal(f.runs.length,0);assert(f.notices.some(text=>text.includes('核对')));assert.equal(f.locks.at(-1),false);
 }
});
