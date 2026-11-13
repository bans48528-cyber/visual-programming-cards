'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const root=process.env.CARD_APP_ROOT||path.resolve(__dirname,'..');
const Multi=require(root+'/xiaobai-multi-runner.js'),source=fs.readFileSync(root+'/xiaobai-ui.js','utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const elements=new Map(),runs=[],notices=[],headControls=[],locks=[];
  const classes=()=>({add(){},remove(){},toggle(){}});
  const element=id=>{if(!elements.has(id))elements.set(id,{classList:classes(),setAttribute(){},querySelector(){return this;}});return elements.get(id);};
  const document={hidden:false,body:{classList:classes()},getElementById:element,querySelectorAll:()=>[],addEventListener(){}};
  const groups=['a','b'].map(id=>({groupId:id,startId:'start-'+id,items:[{id:'wait-time',uid:'wait-'+id,params:{duration:1}}]}));
  const version=0x020300,pin={bound:true,firmware:{boardId:258,protocol:1,version}};
  const state={ready:true,targetVersion:version,currentVersion:version,epoch:'e',actual:{epoch:'e',info:{version,mode:0,imageValid:true}}};
  const connection={id:'c',firmware:{snapshot:()=>state},multiProgram:{},ensureFirmware:async()=>true};
  class Coordinator{
    constructor(link,options){this.connection=link;this.options=options;this.toggles=[];runs.push(this);}
    run(snapshot){
      this.snapshot=snapshot;this.initialized=true;this.preparedLearned=true;this.options.onActivity?.({active:['a','b']});
      return new Promise(resolve=>{this.finish=()=>resolve({sessionOpen:true,state:'idle'});});
    }
    async toggleGroup(id){this.toggles.push(id);}
    async stop(){this.stopped=true;this.cancelled=true;this.initialized=false;this.finish?.();}
  }
  const api={...Multi,SessionCoordinator:Coordinator},window={
    CardEditor:{setExecutionLocked:flag=>locks.push(flag),getRunSnapshot:({groupId})=>({modelId:'xiaobai',groups,...(groupId?{manualGroupId:groupId}:{})})},
    CardCanvas:{setRunControlsEnabled:flag=>headControls.push(flag)},
    CardHome:{activeModelId:'xiaobai'},CardBluetooth:{connected:true,remoteConnection:()=>connection,
      get busy(){return runs.some(run=>run.preparedLearned&&!run.stopped);}},
    CardModelSession:{current:{id:'xiaobai',name:'小白',execution:{kind:'stream'},remote:{close:async()=>{}}},
      selected:true,capture(){return{model:this.current,isCurrent:()=>true};}},
    XiaobaiMultiProgram:api,XiaobaiFirmwareBundle:{METADATA:pin},showExecutionNotice:notice=>notices.push(notice),
    addEventListener(){},dispatchEvent(){}};
  const context={window,document,location:{hash:'#editor'},Event:class{},cardById:{},program:[],XiaobaiMultiProgram:api,XiaobaiRunner:{},DeviceModels:{}};
  vm.runInNewContext(source,context);
  return {window,runs,notices,headControls,locks,element,state};
}
test('prepared learned-run ownership does not disable v2 global rerun, and idle sessions keep head controls',async()=>{
  const f=fixture(),first=f.element('runProgramBtn').onclick();await flush();
  assert.equal(f.runs.length,1);assert.equal(f.element('runProgramBtn').disabled,false);
  assert.equal(f.headControls.at(-1),true);
  f.runs[0].finish();await first;
  assert.equal(f.window.CardProgram.running,true);assert.equal(f.element('runProgramBtn').disabled,false);
  assert.equal(f.locks.at(-1),true);
  await f.window.CardProgram.runGroup('b');assert.deepEqual(f.runs[0].toggles,['b']);
  await f.window.CardProgram.stop();
  assert.equal(f.headControls.at(-1),false);assert.equal(f.window.CardProgram.running,false);
});
test('global rerun stops the prior session before creating a new one',async()=>{
  const f=fixture(),first=f.element('runProgramBtn').onclick();await flush();
  const second=f.element('runProgramBtn').onclick();await flush();await flush();
  assert.equal(f.runs.length,2);assert.equal(f.runs[0].stopped,true);
  assert.equal(f.runs[1].snapshot.groups.length,2);
  await f.window.CardProgram.stop();await Promise.all([first,second]);
});
test('manual head keeps all receivers in the snapshot but launches only the chosen group',async()=>{
  const f=fixture(),result=f.window.CardProgram.runGroup('b');await flush();
  assert.equal(f.runs[0].snapshot.groups.length,2);
  assert.deepEqual(Array.from(f.runs[0].snapshot.launchOrder),['b']);
  await f.window.CardProgram.stop();await result;
});
test('a mismatched device cannot start a v2 multi session',async()=>{
  const f=fixture();f.state.currentVersion=0x020203;
  await f.element('runProgramBtn').onclick();assert.equal(f.runs.length,0);
  assert.ok(f.notices.some(message=>/主控版本/.test(message)));
});
