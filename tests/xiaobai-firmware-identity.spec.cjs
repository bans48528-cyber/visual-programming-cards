// Production Session/Gate negative identity checks. Signed bundled input; no devices.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const P=require('../xiaobai-ota-protocol.js'),Ota=require('../xiaobai-ota.js'),{Gate}=require('../xiaobai-firmware.js');
const root=path.resolve(__dirname,'..'),release=JSON.parse(fs.readFileSync(path.join(root,'assets/firmware/release.json'),'utf8'));
const uid='00112233445566778899aabb',deviceId='EC:B0:DC:10:B4:43';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const observed=p=>p.then(value=>({value}),error=>({error}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const storage=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))};};
let checks=0;
function eq(a,b,message){assert.deepEqual(a,b,message);checks++;}
function fixture(pkg){
 const log=[],state={epoch:'epoch-1',deviceId};
 const current={info:{protocol:1,boardId:pkg.boardId,bootVersion:pkg.minBootVersion,version:pkg.version-1,mode:0,imageValid:false,state:0,lastError:0,imageSize:pkg.imageSize,nextOffset:0,imageSha256:'0'.repeat(64),supported:true},uid,deviceId,epoch:state.epoch,productMode:4};
 const adapter={
  identity:()=>({...state}),
  async prepare(){log.push('prepare');},async release(){log.push('release');},
  async connectApp(){log.push('connectApp');},async connectBoot(){log.push('connectBoot');throw Object.assign(new Error('stop after raw Boot fallback'),{code:'BOOT_PROBE_STARTED'});},
  async readApp(){log.push('readApp');return{...current,epoch:state.epoch,deviceId:state.deviceId};},
  async queryStatus(){log.push('status');return{epoch:state.epoch,data:[4,20,20,20,0x74,0x0e,0]};},
  async enterBoot(){log.push('enterBoot');throw new Error('must not enter');},
  async disconnect(){log.push('disconnect');},async enterProgramRaw(){log.push('program');},async initializeLearned(){log.push('learned');}
 };
 return{log,state,adapter,current};
}
async function recoveryHardErrors(pkg){
 for(const code of ['IDENTITY','STALE','CANCELLED','UNSUPPORTED']){
  const f=fixture(pkg);f.adapter.readApp=async()=>{f.log.push('readApp');throw Object.assign(new Error('definite hard failure'),{code});};
  const session=new Ota.Session(f.adapter,{storage:storage()});session.saveBinding({uid,deviceId,pending:Ota.targetOf(pkg)});await session.choose(pkg.bytes,pkg.name);
  await assert.rejects(()=>session.start({recovery:true}),e=>e.code===code,`propagate ${code} instead of inferring Boot`);checks++;
  eq(f.log.includes('connectBoot'),false,`${code}: no raw Boot attempt after concrete failure`);eq(f.log.includes('enterBoot'),false);
 }
 for(const result of [1,2,3,4]){
  const f=fixture(pkg);f.adapter.readApp=async()=>{throw Object.assign(new Error('device explicitly rejected App query'),{result});};
  const session=new Ota.Session(f.adapter,{storage:storage()});session.saveBinding({uid,deviceId,pending:Ota.targetOf(pkg)});await session.choose(pkg.bytes,pkg.name);
  await assert.rejects(()=>session.start({recovery:true}),e=>e.result===result);checks++;eq(f.log.includes('connectBoot'),false,'device reply is not a Boot timeout');
 }
 // A normal App that is unavailable can really be in recovery Boot. Keep that fallback.
 const f=fixture(pkg);f.adapter.readApp=async()=>{f.log.push('readApp');throw Object.assign(new Error('C2 App query timed out'),{code:'TIMEOUT'});};
 const session=new Ota.Session(f.adapter,{storage:storage()});session.saveBinding({uid,deviceId,pending:Ota.targetOf(pkg)});await session.choose(pkg.bytes,pkg.name);
 await assert.rejects(()=>session.start({recovery:true}),e=>e.code==='BOOT_PROBE_STARTED');checks++;
 eq(f.log.filter(x=>x==='connectBoot').length,1,'real App timeout permits one bound Boot fallback');eq(f.log.includes('enterBoot'),false);
}
async function staleConsent(pkg){
 for(const midPrepare of [false,true]){
  const f=fixture(pkg),hold=deferred(),started=deferred();
  if(midPrepare)f.adapter.prepare=async()=>{f.log.push('prepare');started.resolve();await hold.promise;};
  const gate=new Gate(f.adapter,{storage:storage(),loadBundle:async()=>({pkg,release})});
  await gate.onProgramEntered(f.state.epoch);eq(gate.snapshot().canUpgrade,true);
  let task;
  if(midPrepare){task=observed(gate.confirmUpgrade());await started.promise;f.state.epoch='replacement-epoch';hold.resolve();}
  else{f.state.epoch='replacement-epoch';task=observed(gate.confirmUpgrade());}
  const done=await task;assert(done.error&&['STALE','IDENTITY'].includes(done.error.code),`stale consent ${midPrepare}: ${done.error?.code}`);checks++;
  eq(f.log.includes('enterBoot'),false,'stale consent cannot enter Boot');eq(f.log.includes('connectBoot'),false,'stale consent cannot raw-connect Boot');
  if(!midPrepare)eq(f.log.includes('prepare'),false,'pre-check epoch changes must stop before takeover');
  await gate.dispose();
 }
}
async function liveWrongUid(pkg){
 const f=fixture(pkg),gate=new Gate(f.adapter,{storage:storage(),loadBundle:async()=>({pkg,release})});
 await gate.onProgramEntered(f.state.epoch);
 gate.session.saveBinding({uid,deviceId,pending:Ota.targetOf(pkg)});
 f.adapter.readApp=async()=>{f.log.push('readApp');return{...f.current,uid:'ffeeddccbbaa998877665544',epoch:f.state.epoch};};
 const done=await observed(gate.confirmUpgrade());eq(done.error?.code,'IDENTITY');
 eq(f.log.includes('connectBoot'),false,'a guarded read with the wrong real UID must not fall back Boot');eq(f.log.includes('enterBoot'),false);
 await gate.dispose();
}
(async()=>{
 const pkg=await P.verifyPackage(fs.readFileSync(path.join(root,release.firmware.asset)),{name:path.basename(release.firmware.asset)});
 await recoveryHardErrors(pkg);await staleConsent(pkg);await liveWrongUid(pkg);
 console.log(`PASS firmware identity/consent: ${checks} checks; bundled signed ${pkg.versionText}; no real BLE/hardware.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
