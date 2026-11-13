'use strict';
// Real Gate/Session + shipping run/dialog code in a VM. Only radio results and
// the eventual program executor are controlled; this never opens a device.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Gate}=require('../xiaobai-firmware.js'),P=require('../xiaobai-ota-protocol.js');
const Multi=require('../xiaobai-multi-runner.js'),B=require('../xiaobai-firmware-bundle.js');
const release=require('../assets/firmware/release.json');
const pkgPromise=P.verifyPackage(fs.readFileSync(path.resolve(__dirname,'..',release.firmware.asset)));
const runSource=fs.readFileSync(require.resolve('../xiaobai-ui.js'),'utf8');
const dialogSource=fs.readFileSync(require.resolve('../xiaobai-ota-ui.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){for(let n=0;n<40&&!fn();n++)await flush();assert.ok(fn());}
const store=()=>{const data=new Map();return{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};};

async function fixture({honorAbort=true}={}){
  const pkg=await pkgPromise,listeners=new Map(),elements=new Map(),reads=[],executions=[],notices=[];
  const ctx={epoch:'check-epoch-1',connected:true,learnedBusy:false,rawEntries:0,rawWait:null,snapshotCalls:0};
  const fire=(type,event={})=>{for(const fn of listeners.get(type)||[])fn({type,...event});};
  const classes=()=>{const values=new Set();return{add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v),toggle(v,on){if(on)values.add(v);else values.delete(v);}};};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,open:false,dataset:{},classList:classes(),attributes:{},
      setAttribute(k,v){this.attributes[k]=String(v);},querySelector(s){return element(this.id+' '+s);},
      addEventListener(type,fn){this.handlers??={};(this.handlers[type]??=[]).push(fn);},
      showModal(){this.open=true;},close(){this.open=false;for(const fn of this.handlers?.close||[])fn();}});
    return elements.get(id);
  };
  const document={hidden:false,body:{classList:classes(),append(node){elements.set(node.id,node);}},
    getElementById:element,createElement:()=>element('dialog'),querySelectorAll:()=>[],addEventListener(){}};
  const window={addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},dispatchEvent:e=>fire(e.type),showExecutionNotice:t=>notices.push(t),closeParamEditor(){}};
  const adapter={identity:()=>ctx.connected?{epoch:ctx.epoch,deviceId:'EC:B0:DC:30:78:0E'}:null,
    readApp({guard,signal}={}){const wait=deferred(),read={...wait,signal,guard};reads.push(read);
      if(honorAbort&&signal){const abort=()=>wait.reject(signal.reason||Object.assign(new Error('cancelled'),{code:'CANCELLED'}));
        if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
        return wait.promise.finally(()=>signal.removeEventListener('abort',abort));}
      return wait.promise;
    },
    async enterProgramRaw(){ctx.rawEntries++;if(ctx.rawWait)await ctx.rawWait;},async release(){},
    async queryStatus(){return{epoch:ctx.epoch,data:[4,20,20,20,0x74,0x0e,0]};}
  };
  const gate=new Gate(adapter,{storage:store(),loadBundle:async()=>({pkg,release}),onChange(){fire('xiaobai-firmware-change');window.CardProgram?.refresh();}});
  gate.attachEpoch(ctx.epoch);
  const connection={id:'connection',firmware:gate,learned:{getSnapshot:()=>({busy:ctx.learnedBusy})},multiProgram:{},ensureFirmware:o=>gate.ensureReady(o),stopProgram:async()=>{}};
  window.CardBluetooth={firmware:gate,connected:true,remoteConnection:()=>connection,get busy(){return gate.snapshot().busy||ctx.learnedBusy;}};
  const model={id:'xiaobai',name:'小白',execution:{kind:'stream',validate:x=>x},remote:{close:async()=>{}}};
  window.CardModelSession={current:model,selected:true,switching:false,capture:()=>({model,isCurrent:()=>true})};
  window.CardHome={activeModelId:model.id};window.XiaobaiFirmwareBundle=B;
  window.CardEditor={setExecutionLocked(){},getRunSnapshot(){ctx.snapshotCalls++;return{modelId:'xiaobai',projectId:'p',groups:[{groupId:'g',startId:'s',items:[{uid:'block',id:'wait-time',params:{duration:1}}]}]};}};
  class Executor{constructor(){this.wait=deferred();executions.push(this);}run(){return this.wait.promise;}async stop(){this.wait.resolve({state:'cancelled'});}}
  window.XiaobaiMultiProgram={...Multi,SessionCoordinator:Executor};
  const context={window,document,location:{hash:'#editor'},Event:class{constructor(type){this.type=type;}},XiaobaiOtaProtocol:P,
    XiaobaiMultiProgram:window.XiaobaiMultiProgram,cardById:{},program:[]};
  vm.runInNewContext(runSource,context,{filename:'xiaobai-ui.js'});
  vm.runInNewContext(dialogSource,context,{filename:'xiaobai-ota-ui.js'});
  const dialog=element('xiaobaiFirmwareDialog'),run=element('runProgramBtn');
  const actual=()=>({info:{...pkg,protocol:1,schemaVersion:pkg.layoutId,mode:0,imageValid:true,activeAppBase:pkg.appBase},
    uid:'00112233445566778899aabb',deviceId:'EC:B0:DC:30:78:0E',epoch:ctx.epoch,productMode:4});
  const begin=async()=>{const pending=gate.onProgramEntered(ctx.epoch);await until(()=>reads.length>0);return{pending};};
  return{gate,ctx,adapter,window,element,dialog,run,reads,executions,notices,actual,begin};
}

test('passive check is explained on click; repeated clicks reuse one check and never start a program',async()=>{
  const f=await fixture(),{pending}=await f.begin();
  assert.equal(f.gate.snapshot().prompt,false);assert.equal(f.dialog.open,false,'automatic entry does not steal focus');
  assert.equal(f.run.disabled,false);assert.equal(f.run.querySelector('span').textContent,'核对中');
  const clicks=[f.run.onclick(),f.run.onclick()];
  assert.equal(f.dialog.open,true);assert.equal(f.gate.snapshot().prompt,true);assert.equal(f.reads.length,1);
  assert.match(f.element('xiaobaiFirmwareDialog #firmwareMessage').textContent,/主机身份.*镜像/);
  assert.match(f.element('xiaobaiFirmwareDialog .firmware-help').textContent,/再次点击运行/);
  assert.equal(f.element('xiaobaiFirmwareDialog .firmware-retry').hidden,true);
  assert.equal(f.element('xiaobaiFirmwareDialog .firmware-confirm').hidden,true);
  assert.equal(f.element('xiaobaiFirmwareDialog .firmware-cancel').textContent,'取消核对');
  await f.element('xiaobaiFirmwareDialog .firmware-retry').onclick();
  f.element('xiaobaiFirmwareDialog .firmware-confirm').onclick();
  assert.equal(f.reads.length,1);assert.equal(f.ctx.rawEntries,0);
  f.reads[0].resolve(f.actual());await pending;await Promise.all(clicks);
  assert.equal(f.gate.snapshot().ready,true);assert.equal(f.gate.snapshot().busy,false);assert.equal(f.run.disabled,false);
  assert.equal(f.run.querySelector('span').textContent,'运行');assert.equal(f.ctx.snapshotCalls,0);assert.equal(f.executions.length,0);
  const execution=f.run.onclick();await until(()=>f.executions.length===1);assert.equal(f.run.disabled,true,'running lock retained');
  f.executions[0].wait.resolve({state:'completed'});await execution;await f.gate.dispose();
});

test('failed identity clears busy and offers one explicit retry without parallel mode entry or auto-run',async()=>{
  const f=await fixture(),{pending}=await f.begin();const click=f.run.onclick();
  f.reads[0].resolve({...f.actual(),uid:'invalid'});await pending;await click;
  assert.equal(f.gate.snapshot().phase,'unknown');assert.equal(f.gate.snapshot().ready,false);assert.equal(f.gate.snapshot().busy,false);
  assert.equal(f.run.disabled,false);const retry=f.element('xiaobaiFirmwareDialog .firmware-retry');assert.equal(retry.hidden,false);
  const raw=deferred();f.ctx.rawWait=raw.promise;
  const a=retry.onclick(),b=retry.onclick();assert.equal(f.ctx.rawEntries,1);assert.equal(retry.disabled,true);
  raw.resolve();await until(()=>f.reads.length===2);assert.equal(f.gate.snapshot().phase,'checking');
  f.reads[1].resolve(f.actual());await Promise.all([a,b]);assert.equal(f.gate.snapshot().ready,true);
  assert.equal(f.executions.length,0);assert.equal(f.ctx.snapshotCalls,0);await f.gate.dispose();
});

test('checking explanation does not override upgrade, learned task or model-switch locks',async()=>{
  const f=await fixture(),{pending}=await f.begin();
  for(const change of [()=>{f.ctx.learnedBusy=true;},()=>{f.gate.session.state.busy=true;},()=>{f.gate.upgradeOwned=true;},()=>{f.window.CardModelSession.switching=true;}]){
    change();f.window.CardProgram.refresh();assert.equal(f.run.disabled,true);await f.run.onclick();assert.equal(f.gate.snapshot().prompt,false);
    f.ctx.learnedBusy=false;f.gate.session.state.busy=false;f.gate.upgradeOwned=false;f.window.CardModelSession.switching=false;
  }
  f.gate.set({phase:'upgrading',busy:true});assert.equal(f.run.disabled,true);await f.run.onclick();assert.equal(f.ctx.snapshotCalls,0);
  f.gate.set({phase:'checking',busy:true});f.reads[0].resolve(f.actual());await pending;await f.gate.dispose();
});

test('cancelling while explicit retry enters program mode does not start a late identity check',async()=>{
  const f=await fixture(),{pending}=await f.begin();f.reads[0].reject(Object.assign(new Error('read timed out'),{code:'TIMEOUT'}));await pending;
  const raw=deferred();f.ctx.rawWait=raw.promise;const retry=f.element('xiaobaiFirmwareDialog .firmware-retry').onclick();
  assert.equal(f.ctx.rawEntries,1);await f.gate.cancel();raw.resolve();await retry;
  assert.equal(f.reads.length,1);assert.equal(f.gate.snapshot().busy,false);assert.equal(f.gate.snapshot().ready,false);
  assert.equal(f.gate.snapshot().prompt,false);assert.equal(f.executions.length,0);await f.gate.dispose();
});

for(const action of ['cancel','leave','newEpoch','disconnect','dispose'])test(action+' aborts the owned identity read immediately and cannot make an old identity ready',async()=>{
  const f=await fixture(),{pending}=await f.begin(),signal=f.reads[0].signal;assert.ok(signal);assert.equal(signal.aborted,false);
  if(action==='cancel')await f.gate.cancel();
  if(action==='leave')f.gate.leaveProgram();
  if(action==='newEpoch'){f.ctx.epoch='check-epoch-2';f.gate.attachEpoch(f.ctx.epoch);}
  if(action==='disconnect'){f.ctx.connected=false;f.gate.disconnected('check-epoch-1');}
  if(action==='dispose')await f.gate.dispose();
  assert.equal(signal.aborted,true);assert.equal(await pending,false);assert.equal(f.gate.snapshot().ready,false);assert.equal(f.gate.snapshot().busy,false);
  if(action!=='dispose')await f.gate.dispose();
});

test('late finally from an aborted generation cannot clear or abort the replacement check',async()=>{
  const f=await fixture({honorAbort:false}),{pending:old}=await f.begin(),oldSignal=f.reads[0].signal;
  f.ctx.epoch='check-epoch-2';f.gate.attachEpoch(f.ctx.epoch);assert.equal(oldSignal.aborted,true);
  const next=f.gate.onProgramEntered(f.ctx.epoch);await until(()=>f.reads.length===2);const signal=f.reads[1].signal;
  f.reads[0].resolve({...f.actual(),epoch:'check-epoch-1'});await old;
  assert.equal(f.gate.checkController.signal,signal);assert.equal(signal.aborted,false);assert.equal(f.gate.snapshot().busy,true);
  f.reads[1].resolve(f.actual());assert.equal(await next,true);assert.equal(f.gate.checkController,null);await f.gate.dispose();
});
