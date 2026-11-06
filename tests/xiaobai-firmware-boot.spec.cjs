// Future 1.0.4 metadata fixtures only; no new signed firmware is assumed or built.
'use strict';
const assert=require('node:assert/strict');
const {Gate}=require('../xiaobai-firmware.js');
const uid='00112233445566778899aabb',otherUid='00112233445566778899aabc';
const oldMac='DC:B0:DC:30:78:0E',newMac='EC:B0:DC:30:78:0E',key='xiaobai:ota:binding:v1';
const target={signatureVerified:true,version:65540,boardId:258,minBoot:65537,minBootVersion:65537,imageSize:320,imageSha256:'b'.repeat(64)};
const oldTarget={boardId:258,version:65539,imageSize:320,imageSha256:'a'.repeat(64)};
const pending=({historical=false,written=true,foreign=false}={})=>({uid:foreign?otherUid:uid,deviceId:oldMac,pending:historical?oldTarget:target,written});
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
function fixture({bootVersion=65536,infoPatch={},pkgPatch={},binding=null}={}){
 const pkg={...target,...pkgPatch},data=new Map(binding?[[key,JSON.stringify(binding)]]:[]),log=[],hooks={};let seq=0;
 const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>{log.push('persist');data.set(k,v);}};
 const state={epoch:'fresh-app-1',deviceId:newMac,connected:true};
 const info={protocol:1,boardId:258,bootVersion,mode:0,imageValid:true,version:65540,imageSize:320,imageSha256:target.imageSha256,...infoPatch};
 const actual=()=>({uid,deviceId:state.deviceId,epoch:state.epoch,productMode:4,info:{...info}});
 const adapter={
  identity:()=>state.connected?{epoch:state.epoch,deviceId:state.deviceId}:null,
  async readApp({guard=()=>true}={}){log.push('read');const result=actual();await hooks.read?.();if(!guard())throw Object.assign(new Error('stale read'),{code:'STALE'});return result;},
  async queryStatus(){log.push('status');const at=performance.now();return{epoch:state.epoch,seq:++seq,opcode:4,result:0,sentAt:at,receivedAt:at,data:[4,30,30,30,0x74,0x0e,0]};},
  async enterProgramRaw(){log.push('program');},async initializeLearned(){log.push('learned');},
  async prepare(){log.push('prepare');},async release(){log.push('release');},async disconnect(){log.push('disconnect');},
  async connectApp(){log.push('connectApp');return actual();},async enterBoot(){log.push('enterBoot');},
  async connectBoot(){log.push('connectBoot');},async raw(){log.push('raw');},adoptConfirmedLocator(){log.push('adopt');}
 };
 const gate=new Gate(adapter,{storage,loadBundle:async()=>({pkg}),timing:{healthGapMs:510,healthDeadlineMs:3000}});
 gate.attachEpoch(state.epoch);
 return{gate,state,info,pkg,log,storage,hooks,actual};
}
async function noSideEffects(f,before){
 eq(f.storage.getItem(key),before,'blocked Boot must preserve pending and locator byte-for-byte');
 eq(f.log.filter(x=>x!=='read'),[],'blocked Boot must not start health, restore, migration or update');
 eq(await f.gate.ensureReady({interactive:false}),false);
 await assert.rejects(()=>f.gate.confirmUpgrade(),e=>['BOOT_VERSION','BOOT_UNKNOWN'].includes(e.code));checks++;
 eq(f.log.filter(x=>x!=='read'),[],'written pending cannot bypass the Boot gate');
}
async function belowMinimum(){
 for(const binding of [null,pending({written:false}),pending(),pending({historical:true}),pending({foreign:true})]){
  for(const infoPatch of [{},{version:65539,imageSha256:oldTarget.imageSha256},{version:65539,imageValid:false}]){
   const f=fixture({binding,infoPatch}),before=f.storage.getItem(key);
   eq(await f.gate.onProgramEntered(f.state.epoch),false);const s=f.gate.snapshot();
   eq(s.phase,'boot-update-required');eq(s.code,'BOOT_VERSION');eq(s.ready,false);eq(s.canUpgrade,false);eq(s.confirmationOnly,false);
   assert.match(s.message,/通过 DAP 更新主控引导程序/);checks++;
   eq(s.actual.info.bootVersion,65536,'message follows fresh INFO rather than a cached version hint');
   await noSideEffects(f,before);
  }
 }
}
async function unknownBoot(){
 for(const bootVersion of [undefined,null,NaN,'65537',0,-1,65536.5,Infinity,0x100000000]){
  const f=fixture({binding:pending(),infoPatch:{bootVersion}}),before=f.storage.getItem(key);
  eq(await f.gate.onProgramEntered(f.state.epoch),false);eq(f.gate.snapshot().code,'BOOT_UNKNOWN');eq(f.gate.snapshot().canUpgrade,false);
  await noSideEffects(f,before);
 }
}
async function validBoot(){
 for(const bootVersion of [65537,65538]){
  const f=fixture({bootVersion});eq(await f.gate.onProgramEntered(f.state.epoch),true);eq(f.gate.snapshot().phase,'ready');
  const update=fixture({bootVersion,infoPatch:{version:65539,imageSha256:oldTarget.imageSha256}});
  eq(await update.gate.onProgramEntered(update.state.epoch),false);eq(update.gate.snapshot().phase,'update-required');eq(update.gate.snapshot().canUpgrade,true);
 }
 for(const pkgPatch of [{minBoot:undefined},{minBootVersion:undefined}]){
  const f=fixture({bootVersion:65537,pkgPatch});eq(await f.gate.onProgramEntered(f.state.epoch),true,'either documented package alias works');
 }
 const f=fixture({bootVersion:65537,binding:pending()});eq(await f.gate.onProgramEntered(f.state.epoch),true);
 eq(JSON.parse(f.storage.getItem(key)).pending,null,'compatible Boot retains installed-target cleanup');eq(f.log.filter(x=>x==='status').length,2);
 eq(f.log.includes('program'),true);eq(f.log.includes('learned'),true);eq(f.log.includes('enterBoot'),false);
}
async function invalidMinimum(){
 for(const pkgPatch of [{minBoot:undefined,minBootVersion:undefined},{minBoot:65536},{minBootVersion:0},{minBoot:null,minBootVersion:null},{minBoot:0x100000000,minBootVersion:0x100000000}]){
  const f=fixture({bootVersion:65537,pkgPatch,binding:pending()}),before=f.storage.getItem(key);
  eq(await f.gate.onProgramEntered(f.state.epoch),false);eq(f.gate.snapshot().code,'BUNDLE');eq(f.gate.snapshot().canUpgrade,false);
  eq(f.storage.getItem(key),before);eq(f.log,['read']);
 }
}
async function guardedRecovery(){
 for(const kind of ['readApp','connectApp']){
  const f=fixture({binding:pending()});await f.gate.bundleReady();
  f.gate.consent={uid,deviceId:kind==='connectApp'?oldMac:newMac,epoch:null,token:f.gate.generation,entry:f.gate.entry,stage:'confirmation-only',confirmationOnly:true};
  const before=f.storage.getItem(key),oldLocator=f.gate.consent.deviceId;
  const call=kind==='connectApp'?()=>f.gate.session.adapter.connectApp(pending(),{confirmationOnly:true,target}):()=>f.gate.session.adapter.readApp();
  await assert.rejects(call,e=>e.code==='BOOT_VERSION');checks++;
  eq(f.gate.consent.deviceId,oldLocator,'incompatible Boot cannot migrate recovery consent');eq(f.storage.getItem(key),before);
  eq(f.log.some(x=>['enterBoot','connectBoot','raw','status','program','learned','adopt'].includes(x)),false);
 }
}
async function staleBoot(){
 const f=fixture();let done,started;
 const entered=new Promise(r=>started=r),held=new Promise(r=>done=r);f.hooks.read=async()=>{started();await held;};
 const first=f.gate.onProgramEntered(f.state.epoch);await entered;
 f.hooks.read=null;f.info.bootVersion=65537;f.state.epoch='fresh-app-2';f.gate.attachEpoch(f.state.epoch);
 eq(await f.gate.onProgramEntered(f.state.epoch),true);done();await first;
 eq(f.gate.snapshot().phase,'ready');eq(f.gate.snapshot().code,'READY');
}
(async()=>{for(const fn of [belowMinimum,unknownBoot,validBoot,invalidMinimum,guardedRecovery,staleBoot]){await fn();console.log('PASS minimum Boot gate '+fn.name);}console.log(`${checks} minimum Boot checks passed; future metadata fixtures only, no signed 1.0.4 package, hardware or APK build.`);})().catch(e=>{console.error(e);process.exitCode=1;});
