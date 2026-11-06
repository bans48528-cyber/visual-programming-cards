// Production Gate + Session: a fresh normal App proves installed firmware without rewriting it.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.XIAOBAI_APP_ROOT||path.resolve(__dirname,'..');
const P=require(path.join(root,'xiaobai-ota-protocol.js')),Ota=require(path.join(root,'xiaobai-ota.js')),{Gate}=require(path.join(root,'xiaobai-firmware.js'));
const release=JSON.parse(fs.readFileSync(path.join(root,'assets/firmware/release.json'),'utf8'));
const uid='00112233445566778899aabb',otherUid='ffeeddccbbaa998877665544',oldMac='EC:B0:DC:10:B4:43',newMac='AA:BB:CC:11:22:33';
const key='xiaobai:ota:binding:v1',tick=()=>new Promise(r=>setTimeout(r,0));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
let checks=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
function fixture(pkg,{mac=newMac,written=false,pendingTarget=Ota.targetOf(pkg),bindingUid=uid}={}){
 const entries=new Map(),log=[],state={epoch:'live-app-1',deviceId:mac,connected:true},hooks={};let gate,seq=10;
 const initial={uid:bindingUid,deviceId:oldMac,name:'original robot',pending:pendingTarget,written};
 entries.set(key,JSON.stringify(initial));
 const storage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v))};
 const actual={uid,deviceId:mac,epoch:state.epoch,productMode:4,info:{protocol:P.C.OTA_PROTOCOL_VERSION,boardId:pkg.boardId,bootVersion:pkg.minBootVersion,mode:0,imageValid:true,version:pkg.version,imageSize:pkg.imageSize,imageSha256:pkg.imageSha256,state:0,lastError:0,nextOffset:0}};
 const adapter={
  identity:()=>state.connected?{epoch:state.epoch,deviceId:state.deviceId}:null,
  async readApp(){log.push('readApp');await hooks.readApp?.();return{...actual,deviceId:state.deviceId,epoch:state.epoch,info:{...actual.info}};},
  async queryStatus(){const sentAt=performance.now(),n=log.filter(x=>x==='status').length+1;log.push('status');await hooks.status?.(n);return{epoch:state.epoch,seq:++seq,opcode:4,result:0,sentAt,receivedAt:performance.now(),data:[4,20,20,20,0x74,0x0e,0],...hooks.sample?.(n)};},
  async enterProgramRaw(){log.push('program');await hooks.program?.();},
  async initializeLearned(options){log.push('learned');if(options?.confirmationEpoch){eq(options.confirmationEpoch,state.epoch,'learned initialization pins current epoch');eq(gate.snapshot().ready,false,'readiness stays closed during learned restoration');eq(gate.session.state.healthVerifiedEpoch,state.epoch,'two STATUS establish explicit health evidence');ok(gate.session.binding.pending,'pending remains until learned restoration completes');}await hooks.learned?.();},
  async prepare(){log.push('prepare');},async release(){log.push('release');},
  async connectApp(binding,options){log.push('connectApp');eq(binding.uid,uid,'read-only reconnect remains UID pinned');if(options?.confirmationOnly){eq(options.target.imageSha256,pkg.imageSha256,'confirmation reconnect pins full target');}state.connected=true;state.epoch='reconnected-app-'+log.filter(x=>x==='connectApp').length;state.deviceId=newMac;gate.attachEpoch(state.epoch,{owned:true});return{...actual,epoch:state.epoch,deviceId:state.deviceId,info:{...actual.info}};},
  async disconnect(){log.push('disconnect');state.connected=false;gate.disconnected(state.epoch,{owned:true});},
  async enterBoot(){log.push('enterBoot');throw new Error('Unexpected ENTER');},async connectBoot(){log.push('connectBoot');throw new Error('Unexpected Boot connection');},async raw(){log.push('raw');throw new Error('Unexpected Boot transaction');},
  adoptConfirmedLocator(value){log.push('adoptLocator');eq(value.uid,uid);}
 };
 gate=new Gate(adapter,{storage,loadBundle:async()=>({pkg,release}),timing:{healthGapMs:510,healthDeadlineMs:5000,restartMs:1}});gate.attachEpoch(state.epoch);
 return{gate,state,actual,adapter,storage,initial,log,hooks,stored:()=>JSON.parse(storage.getItem(key))};
}
function noTransfer(f,{allowReconnect=false}={}){
 for(const method of ['enterBoot','connectBoot','raw'])eq(f.log.includes(method),false,`${method} forbidden after a fresh installed-image proof`);
 if(!allowReconnect)for(const method of ['prepare','connectApp','disconnect','release'])eq(f.log.includes(method),false,`${method} not needed for the existing App epoch`);
}
async function matched(pkg){
 for(const mac of [oldMac,newMac])for(const written of [false,true]){
  const f=fixture(pkg,{mac,written,pendingTarget:{...Ota.targetOf(pkg),version:pkg.version-1,imageSha256:'a'.repeat(64)}});
  const ready=await f.gate.onProgramEntered(f.state.epoch);
  eq(ready,true,'full target identity reconciles same-UID stale pending regardless of MAC/written/history');eq(f.gate.snapshot().phase,'ready');eq(f.gate.snapshot().busy,false);eq(f.gate.snapshot().confirmationOnly,false);
  eq(f.stored().pending,null);eq(f.stored().uid,uid);eq(f.stored().deviceId,mac,'fresh MAC is adopted only for the same real UID');eq(f.gate.hasRecovery(),false);
  eq(f.log.filter(x=>x==='status').length,2);ok(f.log.indexOf('program')>f.log.lastIndexOf('status'),'program follows two health samples');ok(f.log.indexOf('learned')>f.log.indexOf('program'),'learned follows program');noTransfer(f);
 }
 const f=fixture(pkg),hold=deferred(),started=deferred();f.hooks.status=async n=>{if(n===1){started.resolve();await hold.promise;}};
 const first=f.gate.onProgramEntered(f.state.epoch);await started.promise;
 eq(f.gate.snapshot().ready,false);eq(f.gate.snapshot().confirmationOnly,true);eq(f.gate.snapshot().busy,true);
 const second=f.gate.onProgramEntered(f.state.epoch);eq(first,second,'duplicate entry shares current verification task');hold.resolve();eq(await first,true);eq(await second,true);eq(f.log.filter(x=>x==='readApp').length,1);eq(f.log.filter(x=>x==='status').length,2);noTransfer(f);
}
async function foreignRecord(pkg){
 const f=fixture(pkg,{bindingUid:otherUid,written:true}),before=f.storage.getItem(key);
 eq(await f.gate.onProgramEntered(f.state.epoch),true,'another normal up-to-date robot may run');eq(f.storage.getItem(key),before,'a different UID pending record remains byte-for-byte untouched');eq(f.log.filter(x=>x==='status').length,0);noTransfer(f);
}
async function targetMismatches(pkg){
 const changes=[{boardId:pkg.boardId+1},{protocol:2},{version:pkg.version+1},{version:pkg.version-1},{imageSha256:'0'.repeat(64)},{imageSize:pkg.imageSize+4},{imageValid:false},{mode:1}];
 for(const patch of changes){const f=fixture(pkg),before=f.storage.getItem(key);Object.assign(f.actual.info,patch);eq(await f.gate.onProgramEntered(f.state.epoch),false,`mismatch ${JSON.stringify(patch)} blocks readiness`);eq(f.storage.getItem(key),before,'incomplete target proof cannot clear pending');eq(f.log.includes('status'),false);eq(f.log.includes('program'),false);noTransfer(f);}
}
async function failures(pkg){
 for(const kind of ['fault','wrong-epoch','duplicate-seq','restore','learned']){
  const f=fixture(pkg);
  if(kind==='fault')f.hooks.sample=n=>n===2?{data:[4,20,20,20,0x74,0x0e,1]}:{};
  if(kind==='wrong-epoch')f.hooks.sample=n=>n===2?{epoch:'retired-epoch'}:{};
  if(kind==='duplicate-seq')f.hooks.sample=()=>({seq:42});
  if(kind==='restore')f.hooks.program=()=>{throw Object.assign(new Error('mode unavailable'),{code:'MODE'});};
  if(kind==='learned')f.hooks.learned=()=>{throw new Error('learned unavailable');};
  eq(await f.gate.onProgramEntered(f.state.epoch),false,`${kind} cannot become ready`);eq(f.gate.snapshot().phase,'unconfirmed');eq(f.gate.snapshot().confirmationOnly,true);eq(f.gate.snapshot().canUpgrade,false);eq(f.gate.snapshot().ready,false);ok(f.stored().pending,'failure retains pending for verification retry');noTransfer(f);
 }
 for(const kind of ['cancel','background','new-epoch','disconnect','foreign-binding']){
  const f=fixture(pkg),hold=deferred(),started=deferred();f.hooks.status=async n=>{if(n===1){started.resolve();await hold.promise;}};
  const task=f.gate.onProgramEntered(f.state.epoch);await started.promise;
  if(kind==='cancel')await f.gate.cancel();
  if(kind==='background')f.gate.leaveProgram('background');
  if(kind==='new-epoch'){f.state.epoch='replacement-epoch';f.gate.attachEpoch(f.state.epoch);}
  if(kind==='disconnect'){f.state.connected=false;f.gate.disconnected(f.state.epoch);}
  if(kind==='foreign-binding')f.gate.session.saveBinding({...f.stored(),uid:otherUid});
  hold.resolve();eq(await task,false,`${kind} invalidates the current confirmation`);eq(f.gate.snapshot().ready,false);ok(f.stored().pending,'invalidated task cannot clear pending');eq(f.log.includes('learned'),false,'late task cannot initialize learned state');noTransfer(f);
 }
}
async function retryWritten(pkg){
 const f=fixture(pkg,{written:true});f.state.connected=false;f.gate.disconnected(f.state.epoch);await f.gate.onProgramRequested({interactive:true});
 eq(f.gate.snapshot().phase,'unconfirmed');eq(f.gate.snapshot().confirmationOnly,true);eq(f.gate.snapshot().canUpgrade,false);
 const result=await f.gate.retry();ok(result.applicationStartVerified);eq(f.gate.snapshot().ready,true);eq(f.stored().pending,null);eq(f.stored().deviceId,newMac);eq(f.log.filter(x=>x==='connectApp').length,1,'explicit offline confirmation reconnects once');eq(f.log.filter(x=>x==='status').length,2);noTransfer(f,{allowReconnect:true});
}
async function retryLive(pkg){
 const f=fixture(pkg);f.hooks.sample=n=>n===2?{data:[4,20,20,20,0x74,0x0e,1]}:{};
 eq(await f.gate.onProgramEntered(f.state.epoch),false);eq(f.gate.snapshot().confirmationOnly,true);f.hooks.sample=null;f.log.length=0;
 eq(await f.gate.retry(),true);eq(f.stored().pending,null);eq(f.log.filter(x=>x==='status').length,2);ok(f.log.indexOf('program')>f.log.lastIndexOf('status'),'live retry verifies health before restoring program');noTransfer(f);
}
async function historicalUpgrade(pkg){
 for(const mac of [oldMac,newMac]){
  const historical={...Ota.targetOf(pkg),version:pkg.version-1,imageSha256:'a'.repeat(64)},f=fixture(pkg,{mac,written:true,pendingTarget:historical});Object.assign(f.actual.info,historical);
  eq(await f.gate.onProgramEntered(f.state.epoch),false);eq(f.gate.snapshot().phase,'update-required');eq(f.gate.snapshot().confirmationOnly,false);eq(f.gate.snapshot().canUpgrade,true);eq(f.gate.snapshot().ready,false,'historical image does not authorize running under the newer App target');eq(f.log.includes('prepare'),false,'a newer target still requires explicit consent');
  eq(f.log.filter(x=>x==='status').length,2,'historical complete image has its own read-only health confirmation');eq(f.stored().pending,null,'old pending clears only after restoring the old verified App');eq(f.stored().deviceId,mac,'new locator is adopted through complete old-target confirmation');noTransfer(f);
  await assert.rejects(()=>f.gate.confirmUpgrade());checks++;
  eq(f.log.includes('connectApp'),false,'old written marker does not force read-only reconnect');eq(f.log.filter(x=>x==='enterBoot').length,1,'separate explicit newer-target consent may enter normal upgrade after historical confirmation');eq(f.stored().pending.imageSha256,pkg.imageSha256,'new write intent pins the current signed target');eq(f.stored().written,false);
 }
 const oldTarget={...Ota.targetOf(pkg),version:pkg.version-1,imageSha256:'a'.repeat(64)},offline=fixture(pkg,{written:true,pendingTarget:oldTarget});offline.state.connected=false;offline.gate.disconnected(offline.state.epoch);
 eq(offline.gate.snapshot().confirmationOnly,true,'before target loads, written gives a provisional offline hint');await offline.gate.onProgramRequested({interactive:true});eq(offline.gate.snapshot().phase,'recovery');eq(offline.gate.snapshot().confirmationOnly,false,'canonical target load removes obsolete read-only lock');eq(offline.gate.snapshot().canUpgrade,true);eq(offline.log.length,0,'target reconciliation makes no device call');
 const unmatched=fixture(pkg,{written:true,pendingTarget:oldTarget});Object.assign(unmatched.actual.info,{version:pkg.version-2,imageSha256:'c'.repeat(64)});eq(await unmatched.gate.onProgramEntered(unmatched.state.epoch),false);eq(unmatched.log.includes('status'),false,'an unmatched historical record is not proof of installation');await assert.rejects(()=>unmatched.gate.confirmUpgrade(),error=>error.code==='IDENTITY');checks++;eq(unmatched.log.includes('enterBoot'),false,'unconfirmed historical target and same UID alone cannot migrate a writer');eq(unmatched.stored().deviceId,oldMac);eq(unmatched.stored().pending,oldTarget);
}
(async()=>{const pkg=await P.verifyPackage(fs.readFileSync(path.join(root,release.firmware.asset)),{name:path.basename(release.firmware.asset)});for(const test of [matched,foreignRecord,targetMismatches,failures,retryWritten,retryLive,historicalUpgrade]){await test(pkg);console.log('PASS installed firmware gate '+test.name);}console.log(`PASS ${checks} installed-image Gate checks; current App epochs and same-UID locator recovery, no hardware.`);})().catch(error=>{console.error(error);process.exitCode=1;});
