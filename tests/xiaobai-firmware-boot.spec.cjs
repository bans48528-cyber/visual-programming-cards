'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {parseVersionEvent}=require('../xiaobai-firmware.js');
const {P,Ota,uid,deviceId,key,signedCurrent,fixture}=require('./helpers/firmware-policy-fixture.cjs');
test('matching complete target stays ready despite low or unknown App-compiled Boot version',async()=>{
 const pkg=await signedCurrent();
 for(const bootVersion of [0x020000,0x020001,65536,undefined,null,0]){
  const f=fixture({pkg,appPatch:{bootVersion}});
  assert.equal(await f.gate.onProgramEntered(f.state.epoch),true);assert.equal(f.gate.snapshot().phase,'ready');
  assert.equal(f.gate.snapshot().canUpgrade,false);assert.deepEqual(f.events.map(e=>e.type),['app-info']);
  assert.equal(f.frames.length,0);await f.gate.dispose();
 }
});

test('signed target remains compatible with actual Boot 2.0.0 and 2.0.1; unknown actual Boot cannot BEGIN',async()=>{
 const pkg=await signedCurrent();assert.equal(pkg.minBootVersion,0x020000);
 for(const bootVersion of [0x020000,0x020001]){
  const f=fixture({pkg,bootPatch:{bootVersion,version:pkg.version-1,imageSha256:'a'.repeat(64)}});
  assert.deepEqual(P.checkCompatibility(pkg,f.bootInfo),{alreadyPresent:false,needsWrite:true});
  assert.equal(f.frames.length,0,'compatibility check itself never writes');await f.gate.dispose();
 }
 const f=fixture({pkg,appPatch:{version:pkg.version-1,imageSha256:'a'.repeat(64),bootVersion:0},bootPatch:{bootVersion:0}});
 await f.gate.onProgramEntered(f.state.epoch);assert.equal(f.gate.snapshot().canUpgrade,true,'unknown App-reported Boot does not guess the actual Boot');
 await assert.rejects(()=>f.gate.confirmUpgrade(),{code:'BOOT_UNKNOWN'});
 assert.equal(f.gate.snapshot().ready,false);assert.equal(f.gate.snapshot().canUpgrade,false);
 assert.equal(f.frames.some(frame=>frame.command===P.OP.BEGIN||frame.command===P.OP.DATA),false);
 await f.gate.dispose();
});
test('older, newer and same-version different images require consent without automatic ENTER',async()=>{
 const pkg=await signedCurrent();
 for(const version of [pkg.version-1,pkg.version,pkg.version+1])for(const bootVersion of [65536,undefined]){
  const f=fixture({pkg,appPatch:{bootVersion,version,imageSha256:'a'.repeat(64)}});
  assert.equal(await f.gate.onProgramEntered(f.state.epoch),false);const s=f.gate.snapshot();
  assert.equal(s.phase,'update-required');assert.equal(s.canUpgrade,true);assert.equal(s.prompt,true);
  assert.equal(f.events.some(e=>e.type==='enter-boot'),false);assert.equal(f.frames.length,0);
  assert.equal(f.store.getItem(key),null,'an update prompt does not change pending records');await f.gate.dispose();
 }
});
test('only actual Boot INFO after consent can reject minBoot; idle FINISH returns without BEGIN or DATA',async()=>{
 const pkg=await signedCurrent();assert(pkg.minBootVersion>=P.layoutOf(pkg).minBootVersion);
 for(const compileBoot of [65536,undefined]){
  const f=fixture({pkg,appPatch:{bootVersion:compileBoot,version:pkg.version-1,imageSha256:'a'.repeat(64)},bootPatch:{bootVersion:pkg.minBootVersion-1}});
  await f.gate.onProgramEntered(f.state.epoch);assert.equal(f.gate.snapshot().canUpgrade,true);
  await assert.rejects(()=>f.gate.confirmUpgrade(),e=>e.code==='BOOT_VERSION'&&e.bootExited===true);
  const s=f.gate.snapshot();assert.equal(s.phase,'boot-update-required');assert.equal(s.canUpgrade,false);assert.match(s.message,/DAP/);
  assert.deepEqual(f.frames.map(f=>f.command),[P.OP.INFO,P.OP.FINISH]);
  assert(f.events.findIndex(e=>e.type==='enter-boot')<f.events.findIndex(e=>e.type==='raw'&&e.command===P.OP.INFO));
  assert.equal(f.gate.session.binding.pending,null,'non-writing return does not leave a false pending target');
  const count=f.frames.length;await assert.rejects(()=>f.gate.confirmUpgrade(),{code:'BOOT_VERSION'});assert.equal(f.frames.length,count);
  await f.gate.dispose();
 }
});
test('schema 2 notifications remain wire 1 hints and never establish image readiness',async()=>{
 const pkg=await signedCurrent(),f=fixture({pkg});
 const b=new Uint8Array(8),d=new DataView(b.buffer);d.setUint32(0,pkg.version,true);d.setUint16(4,pkg.boardId,true);b[6]=2;b[7]=1;
 const hint=parseVersionEvent({code:10,data:b});assert.equal(hint.schemaVersion,2);assert.equal(hint.protocol,1);
 assert.equal(f.gate.onVersionEvent({code:10,data:b},f.state.epoch),true);assert.equal(f.gate.snapshot().ready,false);
 assert.equal(f.gate.snapshot().actual,null);assert.equal(f.events.length,0);assert.equal(f.frames.length,0);await f.gate.dispose();
});

test('unknown actual Boot layout blocks retry writes and never guesses a safe FINISH',async()=>{
 const pkg=await signedCurrent();
 const f=fixture({pkg,appPatch:{version:pkg.version-1,imageSha256:'a'.repeat(64)},bootPatch:{schemaVersion:2,bootVersion:0x20000,layoutId:99,capabilities:15}});
 await f.gate.onProgramEntered(f.state.epoch);
 await assert.rejects(()=>f.gate.confirmUpgrade(),{code:'LAYOUT_UNKNOWN'});
 const s=f.gate.snapshot();assert.equal(s.phase,'boot-update-required');assert.equal(s.canUpgrade,false);assert.equal(s.ready,false);
 assert.deepEqual(f.frames.map(frame=>frame.command),[P.OP.INFO]);
 assert.ok(f.gate.session.binding.pending,'unreadable actual layout retains recovery evidence');
 await assert.rejects(()=>f.gate.confirmUpgrade(),{code:'LAYOUT_UNKNOWN'});
 assert.equal(f.frames.length,1);await f.gate.dispose();
});
test('layout is part of identity; same version/hash in another layout never clears pending or becomes ready',async()=>{
 const pkg=await signedCurrent(),pending=Ota.targetOf(pkg),binding={uid,deviceId,pending,written:false};
 const otherLayout=P.layoutOf({layoutId:P.layoutOf(pkg).id===1?2:1});
 const f=fixture({pkg,binding,appPatch:{schemaVersion:2,layoutId:otherLayout.id,activeAppBase:otherLayout.appBase,erasePage:otherLayout.erasePage,capabilities:15,bootVersion:0x20000}});
 const stored=f.store.getItem(key);assert.equal(await f.gate.onProgramEntered(f.state.epoch),false);
 assert.equal(f.gate.snapshot().canUpgrade,true);assert.equal(f.gate.snapshot().ready,false);
 assert.equal(f.store.getItem(key),stored);assert.equal(f.events.some(e=>e.type==='status'),false);assert.equal(f.frames.length,0);await f.gate.dispose();
});
test('matching pending completes read-only with low compiled Boot and lost FINISH ACK evidence',async()=>{
 const pkg=await signedCurrent();
 for(const written of [false,true]){
  const f=fixture({pkg,binding:{uid,deviceId,pending:Ota.targetOf(pkg),written},appPatch:{bootVersion:undefined}});
  assert.equal(await f.gate.onProgramEntered(f.state.epoch),true);assert.equal(f.gate.session.binding.pending,null);
  assert.equal(f.events.filter(e=>e.type==='status').length,2);assert(f.events.some(e=>e.type==='program'));assert(f.events.some(e=>e.type==='learned'));
  assert.equal(f.frames.length,0);assert.equal(f.events.some(e=>e.type==='enter-boot'),false);await f.gate.dispose();
 }
});
test('malformed target minimum metadata still blocks before device or pending mutations',async()=>{
 const original=await signedCurrent();
 for(const patch of [{minBoot:undefined,minBootVersion:undefined},{minBoot:65536},{minBootVersion:0},{minBoot:null,minBootVersion:null},{minBoot:0x100000000,minBootVersion:0x100000000}]){
  const pkg={...original,...patch},binding={uid,deviceId,pending:Ota.targetOf(original),written:false},f=fixture({pkg,binding});
  const stored=f.store.getItem(key);assert.equal(await f.gate.onProgramEntered(f.state.epoch),false);
  assert.equal(f.gate.snapshot().code,'BUNDLE');assert.equal(f.gate.snapshot().canUpgrade,false);assert.equal(f.store.getItem(key),stored);
  assert.deepEqual(f.events,[]);assert.equal(f.frames.length,0);await f.gate.dispose();
 }
});
test('a late prior App epoch cannot replace a newly verified target or its readiness',async()=>{
 const pkg=await signedCurrent(),f=fixture({pkg,appPatch:{imageSha256:'a'.repeat(64)}}),original=f.adapter.readApp;
 let entered,release;const started=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 f.adapter.readApp=async()=>{const stale=f.actual();entered();await held;return stale;};
 const first=f.gate.onProgramEntered(f.state.epoch);await started;
 f.adapter.readApp=original;f.appInfo.imageSha256=pkg.imageSha256;f.state.epoch='fresh-app-2';f.gate.attachEpoch(f.state.epoch);
 assert.equal(await f.gate.onProgramEntered(f.state.epoch),true);release();await first;
 assert.equal(f.gate.snapshot().ready,true);assert.equal(f.gate.snapshot().actual.epoch,'fresh-app-2');
 assert.equal(f.events.some(e=>e.type==='enter-boot'),false);assert.equal(f.frames.length,0);await f.gate.dispose();
});
