'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {SessionCoordinator,validateSnapshot,command,releaseSupports,releaseAllows}=require('../xiaobai-multi-runner.js');
const {OP}=require('../xiaobai-protocol.js');
const flush=()=>new Promise(resolve=>setTimeout(resolve,5));
function snapshot(groups) {return {schemaVersion:1,modelId:'xiaobai',projectId:'test',groups:groups.map(([id,items])=>({groupId:id,startId:'start-'+id,items:items.map((item,i)=>({uid:id+'-'+i,...item}))}))};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};}
function setup({hold=()=>false,reject=()=>null,learned=null}={}) {
  const calls=[],pending=[],states=[];let task=1,options;
  const client={
    async beginGroup(){return ++task;},
    async finishGroup(group,id){calls.push(['finish',group,id]);return {state:3,group,task:id};},
    async open(n){calls.push(['open',n]);return {maxGroups:4,maxPcTasks:4};},
    action(group,opcode,args){const record={group,opcode,args,task:task++};calls.push(['action',record]);const error=reject(record);if(error)return Promise.reject(error);if(hold(record)){const d=deferred();pending.push({...record,...d});return d.promise;}return Promise.resolve({...record,state:4});},
    async endGroup(group){calls.push(['end',group]);},async close(){calls.push(['close']);},
    async stop(){calls.push(['stop']);for(const d of pending)d.reject(Object.assign(new Error('cancelled'),{code:'CANCELLED'}));},
    dispose(){calls.push(['dispose']);},
  };
  const connection={firmware:releaseFixture().firmware,learned,async enterProgram(){calls.push(['enter']);},async ensureFirmware(){return true;},async stopProgram(){calls.push(['legacy-stop']);}};
  const coordinator=new SessionCoordinator(connection,{createClient:o=>{options=o;return client;},onGroupState:(...s)=>states.push(s)});
  return {coordinator,connection,client,calls,pending,states,get options(){return options;}};
}
test('snapshot freezes stable lexicographic order, nested UIDs and parameters without mutating the editor',()=>{
  const input=snapshot([['z',[{id:'wait-time',params:{duration:1}}]],['a',[{id:'loop-count',params:{count:2},children:[{uid:'child',id:'wait-time',params:{duration:1}}]}]]]);
  const copy=validateSnapshot(input);assert.deepEqual(copy.launchOrder,['a','z']);assert.equal(input.groups[0].groupId,'z');assert.ok(Object.isFrozen(copy.groups[0].items[0].children[0].params));
  assert.throws(()=>validateSnapshot(snapshot(Array.from({length:5},(_,i)=>['g'+i,[{id:'wait-time',params:{duration:1}}]]))),{code:'GROUP_LIMIT'});
  const dup=snapshot([['a',[{uid:'duplicate',id:'wait-time',params:{duration:1}}]],['b',[{uid:'duplicate',id:'wait-time',params:{duration:1}}]]]);assert.throws(()=>validateSnapshot(dup),/身份/);
});
function releaseFixture() {
  const hash='c'.repeat(64),version=0x020202;
  const metadata={bound:true,firmware:{boardId:258,protocol:1,version,layoutId:2,imageSha256:hash}};
  const pkg={signatureVerified:true,boardId:258,version,format:2,layoutId:2,appBase:0x08003000,erasePage:128,imageSize:48716,imageSha256:hash};
  const state={ready:true,targetVersion:version,currentVersion:version,epoch:'epoch',actual:{epoch:'epoch',info:{protocol:1,schemaVersion:2,boardId:258,version,mode:0,imageValid:true,layoutId:2,activeAppBase:0x08003000,erasePage:128,imageSize:pkg.imageSize,imageSha256:hash}}};
  const firmware={bundle:{pkg},snapshot:()=>state};
  return {metadata,pkg,state,firmware};
}
test('2.2.2 requires the explicit release pin and current lightweight application readiness',()=>{
  const f=releaseFixture();assert.equal(releaseSupports(f.metadata),true);assert.equal(releaseAllows(f.metadata,f.firmware),true);
  assert.equal(releaseAllows(f.metadata,{ready:true,currentVersion:0x020202}),false,'readiness without current connection evidence is not enough');
  for(const patch of [{ready:false},{currentVersion:0x010101},{epoch:'stale'}]){const t=releaseFixture();Object.assign(t.state,patch);assert.equal(releaseAllows(t.metadata,t.firmware),false);}
  for(const patch of [{mode:1},{imageValid:false},{version:0x020201},{version:0x020203}]){const t=releaseFixture();Object.assign(t.state.actual.info,patch);assert.equal(releaseAllows(t.metadata,t.firmware),false);}
  delete f.firmware.bundle;for(const key of ['boardId','protocol','layoutId','activeAppBase','erasePage','schemaVersion','imageSize','imageSha256'])delete f.state.actual.info[key];
  assert.equal(releaseAllows(f.metadata,f.firmware),true,'full OTA evidence is not an ordinary programming prerequisite');
});

test('only reviewed release versions select START; legacy or future pins never guess wire compatibility',()=>{
  const legacy={bound:true,firmware:{boardId:258,protocol:1,version:0x010101}};assert.equal(releaseSupports(legacy),false);assert.equal(releaseAllows(legacy,{ready:true,currentVersion:0x010101}),false);
  const f=releaseFixture(),pin223={...f.metadata,firmware:{...f.metadata.firmware,version:0x020203}};
  assert.equal(releaseSupports(pin223),true);assert.equal(releaseAllows(pin223,f.firmware),false);
  for(const patch of [{version:0x010004},{version:0x020105},{version:0x020201},{version:0x020204},{version:0x030000},{boardId:259},{protocol:2}])assert.equal(releaseSupports({...f.metadata,firmware:{...f.metadata.firmware,...patch}}),false,JSON.stringify(patch));
  assert.equal(releaseSupports({...f.metadata,bound:false}),false);assert.equal(releaseAllows(legacy,f.firmware),false);assert.equal(releaseAllows(f.metadata,{...f.firmware,bundle:null}),true);
});

test('one waiting group does not block another; normal group end does not send global stop',async()=>{
  const s=setup({hold:a=>a.opcode===OP.WAIT_TILT});
  const done=s.coordinator.run(snapshot([['a',[{id:'tilt-wait',params:{direction:'forward'}}]],['b',[{id:'display-number',params:{value:7}}]]]));
  await flush();assert.ok(s.calls.some(c=>c[0]==='finish'&&c[1]===2));assert.equal(s.calls.filter(c=>c[0]==='stop').length,0);
  assert.equal(s.pending.length,1);s.pending[0].resolve({state:3});await done;
  assert.deepEqual(s.calls.filter(c=>c[0]==='finish').map(c=>c[1]),[2,1]);assert.equal(s.calls.filter(c=>c[0]==='close').length,1);
});
test('single-session protection rejects another coordinator without touching it',async()=>{
  const first=setup({hold:()=>true}),second=setup();
  const done=first.coordinator.run(snapshot([['a',[{id:'display-number',params:{value:7}}]]]));await flush();
  assert.throws(()=>second.coordinator.run(snapshot([['b',[{id:'wait-time',params:{duration:1}}]]])),/已有运行会话/);assert.equal(second.calls.length,0);
  await first.coordinator.stop();await assert.rejects(done,{code:'CANCELLED'});
});
test('action failure stops all groups once and reports stable group/block identity',async()=>{
  const s=setup({hold:a=>a.group===1,reject:a=>a.group===2?new Error('port conflict'):null});
  const done=s.coordinator.run(snapshot([['a',[{id:'tilt-wait',params:{direction:'left'}}]],['b',[{id:'motor-forward',params:{port:'L',duration:1}}]]]));
  await assert.rejects(done,e=>e.message==='port conflict'&&e.groupId==='b'&&e.blockUid==='b-0');
  assert.equal(s.calls.filter(c=>c[0]==='stop').length,1);assert.equal(s.calls.filter(c=>c[0]==='close').length,0);
});
test('late failure of a PLAY lease aborts a group already advanced to a phone timer',async()=>{
  const s=setup();const done=s.coordinator.run(snapshot([['a',[{id:'speech-play',params:{phrase:'P01'}},{id:'wait-time',params:{duration:100}}]]]));
  await flush();assert.equal(s.calls.filter(c=>c[0]==='action').length,1);
  await s.options.onAbort(Object.assign(new Error('audio failed'),{groupId:'a',blockUid:'a-0'}));
  await assert.rejects(done,/audio failed/);assert.equal(s.calls.filter(c=>c[0]==='stop').length,1);
});
test('consecutive voice waits require two separate action submissions',async()=>{
  const s=setup({hold:a=>a.opcode===OP.WAIT_VOICE});
  const done=s.coordinator.run(snapshot([['a',[{id:'speech-wait',params:{phrase:'ASR_01'}},{id:'speech-wait',params:{phrase:'ASR_01'}}]]]));
  await flush();assert.equal(s.pending.length,1);s.pending[0].resolve({state:3});await flush();
  assert.equal(s.pending.length,2);assert.notEqual(s.pending[0].task,s.pending[1].task);s.pending[1].resolve({state:3});await done;
});
test('all learned positions preflight before START, preserving group path mapping and local mutex',async()=>{
  const events=[];
  const learned={getSnapshot:()=>({busy:false}),async prepareRun(items){events.push(items);throw Object.assign(new Error('unlearned'),{path:[1]});},stop(){events.push('local-end');}};
  const s=setup({learned});
  await assert.rejects(s.coordinator.run(snapshot([['a',[{id:'wait-time',params:{duration:1}}]],['b',[{id:'self-learned-wait',params:{slot:2}}]]])),e=>e.groupId==='b'&&e.blockUid==='b-0'&&e.path[0]===0);
  assert.equal(s.calls.some(c=>c[0]==='open'),false);assert.equal(events.length,2);
  const busyEvents=[];const t=setup({learned:{getSnapshot:()=>({busy:true}),stop(){busyEvents.push('bad-stop');}}});
  await assert.rejects(t.coordinator.run(snapshot([['a',[{id:'wait-time',params:{duration:1}}]]])),{code:'BUSY'});assert.deepEqual(busyEvents,[]);assert.deepEqual(t.calls,[]);
});
test('successful multi run never calls legacy begin/endRun or shared stopProgram',async()=>{
  const events=[],s=setup({learned:{getSnapshot:()=>({busy:false}),async prepareRun(){events.push('prepare');},async beginRun(){throw new Error('legacy begin');},async endRun(){throw new Error('legacy end');},stop(){events.push('local-end');}}});
  await s.coordinator.run(snapshot([['a',[{id:'wait-time',params:{duration:0.001}}]]]));assert.deepEqual(events,['prepare','local-end']);assert.equal(s.calls.some(c=>c[0]==='legacy-stop'),false);
});
test('new command mapping preserves full independent eyes and per-group power',()=>{
  const ctx={comboPower:3};assert.deepEqual(command({id:'speed-down'},ctx).args,[2]);assert.deepEqual(command({id:'speed-up'},{comboPower:1}).args,[2]);
  const eye=command({id:'eye-matrix',params:{leftPattern:Array(64).fill(0),rightPattern:Array(64).fill(1)}},ctx);assert.equal(eye.args.length,16);assert.deepEqual(eye.args.slice(0,8),Array(8).fill(0));assert.equal(eye.args[8],126);assert.equal(eye.args[9],255);
  assert.deepEqual(command({id:'infrared-wait',params:{comparison:'greater',threshold:50}},ctx).args,[1,0,50]);
});
