'use strict';
// Production Gate + Session with signed targets and synthetic device responses.
const assert=require('node:assert/strict'),test=require('node:test');
const {P,Ota,uid,deviceId,key,copy,signedCurrent,signedHistorical,fixture}=require('./helpers/firmware-policy-fixture.cjs');
async function offlineThenConfirm({pkg,previous,written,compileBoot,bootVersion,statusFault=0,pendingPatch={}}){
 const pending={...Ota.targetOf(previous),...pendingPatch},binding={deviceId,uid,name:'Spark_AI',pending,written};
 const bootLayout=P.layoutOf(bootVersion>=0x20000?previous:{layoutId:1});
 // Deliberately omit the optional rewrite/downgrade capability bits in this
 // rejection fixture; actual compact Boot can still describe either active layout.
 const bootPatch={bootVersion,schemaVersion:bootVersion>=0x20000?2:1,layoutId:bootLayout.id,activeAppBase:bootLayout.appBase,erasePage:bootLayout.erasePage,
  capabilities:bootVersion>=0x20000?P.CAP.LEGACY|P.CAP.COMPACT:P.CAP.LEGACY};
 const f=fixture({pkg,deviceTarget:previous,appPatch:{bootVersion:compileBoot},bootPatch,binding,connected:false,statusFault});
 await f.gate.onProgramRequested({interactive:true});assert.equal(f.gate.snapshot().phase,'recovery');assert.equal(f.gate.snapshot().canUpgrade,true);
 assert.deepEqual(f.events,[],'offline recovery is a prompt, not permission to send or clear data');return f;
}
test('offline completed historical records are confirmed and cleared before deciding newer, older or same-version target writes',async()=>{
 const current=await signedCurrent(),older=await signedHistorical(),sameVersionOther={...current,imageSha256:'e'.repeat(64)};
 for(const [pkg,previous,bootVersion]of [[current,older,65536],[older,current,current.minBootVersion],[current,sameVersionOther,current.minBootVersion]])for(const written of [false,true]){
  const f=await offlineThenConfirm({pkg,previous,bootVersion,written,compileBoot:undefined});
  await assert.rejects(()=>f.gate.confirmUpgrade(),e=>['BOOT_VERSION','BOOT_CAPABILITY'].includes(e.code)&&e.bootExited===true);
  const health=f.events.filter(e=>e.type==='status'&&e.pending?.imageSha256===previous.imageSha256);
  assert.equal(health.length,2,'old image has two fresh health responses before record cleanup');
  const cleared=f.events.findIndex(e=>e.type==='persist'&&e.binding.pending===null),entered=f.events.findIndex(e=>e.type==='enter-boot');
  assert(cleared>=0&&entered>cleared,'historical pending must clear before entering Boot for the next target');
  assert(f.events.slice(0,cleared).some(e=>e.type==='adopt'),'fresh identity is adopted before cleanup');
  assert.deepEqual(f.frames.map(f=>f.command),[P.OP.INFO,P.OP.FINISH],'incompatible actual Boot receives no BEGIN/DATA');
  assert.equal(f.gate.snapshot().phase,'boot-update-required');assert.match(f.gate.snapshot().message,/DAP/);
  assert.equal(f.gate.session.binding.pending,null);await f.gate.dispose();
 }
});
test('historical health failure preserves pending and cannot reach ENTER or raw writes',async()=>{
 const pkg=await signedCurrent(),previous=await signedHistorical();
 const f=await offlineThenConfirm({pkg,previous,written:false,compileBoot:65536,bootVersion:0x20000,statusFault:8});
 await assert.rejects(()=>f.gate.confirmUpgrade(),{code:'FAULT'});assert(P.sameTarget(f.gate.session.binding.pending,previous));
 assert.equal(f.events.some(e=>e.type==='persist'&&e.binding.pending===null),false);assert.equal(f.events.some(e=>e.type==='enter-boot'),false);
 assert.equal(f.frames.length,0);await f.gate.dispose();
});
test('offline pending with another layout is not considered an installed historical image',async()=>{
 const pkg=await signedCurrent(),previous=await signedHistorical();
 const f=await offlineThenConfirm({pkg,previous,written:false,compileBoot:undefined,bootVersion:65536,pendingPatch:{layoutId:2,format:2,appBase:0x08003000,erasePage:128}});
 const expected=copy(f.gate.session.binding.pending);
 f.state.connected=true;f.state.epoch='fresh-manual-app';f.gate.attachEpoch(f.state.epoch);
 assert.equal(await f.gate.onProgramEntered(f.state.epoch),false);assert.deepEqual(f.gate.session.binding.pending,expected);
 assert.equal(f.events.some(e=>e.type==='status'),false);assert.equal(f.events.some(e=>e.type==='persist'),false);
 assert.equal(f.events.some(e=>e.type==='enter-boot'),false);assert.equal(f.frames.length,0);await f.gate.dispose();
});
