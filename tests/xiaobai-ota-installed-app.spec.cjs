// Production UI + Android adapter + Gate + Session. Only the native BLE boundary is synthetic.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.XIAOBAI_APP_ROOT||path.resolve(__dirname,'..');
const {chromium}=require(path.join(root,'node_modules/playwright'));
const mockAndroid=require(path.join(root,'tests/mock-android.cjs')),mockFirmware=require(path.join(root,'tests/mock-firmware.cjs'));
const target=require(path.join(root,'assets/firmware/release.json')).firmware;
const base=process.env.XIAOBAI_OTA_UI_BASE||'http://127.0.0.1:4181/';
const out=process.env.XIAOBAI_OTA_INSTALLED_OUTPUT||path.join(root,'artifacts/ota-installed-app');
const uid='0102030405060708090a0b0c',otherUid='1112131415161718191a1b1c',oldMac='DC:B0:DC:10:B4:43',newMac='EC:B0:DC:10:B4:43',thirdMac='AA:BB:CC:00:00:33';
let checks=0,currentCase='';const results=[];
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
async function create(browser,{foreign=false,boot=false}={}){
 const context=await browser.newContext({viewport:{width:751,height:360},hasTouch:true});
 await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
 await context.addInitScript(mockAndroid);await context.addInitScript(mockFirmware,{target,pendingWritten:true,pending:{boardId:target.boardId,version:target.version,imageSize:target.imageSize,imageSha256:target.imageSha256}});
 await context.addInitScript(({oldMac,newMac,thirdMac,uid,otherUid,foreign,boot})=>{
  const binding=JSON.parse(localStorage.getItem('xiaobai:ota:binding:v1'));binding.deviceId=oldMac;localStorage.setItem('xiaobai:ota:binding:v1',JSON.stringify(binding));
  localStorage.setItem('cardModel:xiaobai:bluetooth:v1',thirdMac);
  const previous=Capacitor.nativePromise.bind(Capacitor),respond=mockBle.respondC2;
  const hooks=window.installedHooks={scans:[],events:[],abort:[],holdConnect:false,held:false,modeDuringUid:true,modeCount:0,foreign,boot};
  window.addEventListener('xiaobai-program-abort',event=>hooks.abort.push(event.detail));
  hooks.mode=(id,value)=>{const packet=[0x5a,0x98,0x97,10,0xd3,1,++mockBle.counter&255,value];while(packet.length<15)packet.push(0);packet.push(packet.reduce((s,v)=>s+v,0)&255,0xa5);mockBle.feed(String.fromCharCode(...packet),id);};
  mockBle.devices=[{deviceId:newMac,name:'Spark_AI',advertisedName:'Spark_AI',rssi:-40}];
  mockBle.respondC2=bytes=>{
   if(bytes[6]===0x56&&hooks.modeDuringUid&&hooks.modeCount++===0){const id=mockBle.connectionId;setTimeout(()=>hooks.mode(id,0),1);}
   return respond(bytes);
  };
  Capacitor.nativePromise=async(plugin,method,options={})=>{
   if(plugin==='SparkBle'&&method==='startScan'&&options.includeUnnamed){hooks.scans.push({...options,at:performance.now()});const devices=mockBle.devices;mockBle.devices=[];try{return await previous(plugin,method,options);}finally{mockBle.devices=devices;}}
   if(plugin==='SparkBle'&&method==='connect'){
    hooks.events.push({kind:'connect',...options,at:performance.now()});
    if(hooks.holdConnect){hooks.held=true;await new Promise(resolve=>hooks.releaseConnect=resolve);hooks.holdConnect=false;}
    mockBle.otaUid=hooks.foreign?otherUid:uid;mockBle.appAvailable=!hooks.boot;
   }
   return previous(plugin,method,options);
  };
  hooks.ad=(id,deviceId=newMac,name='Spark_AI',raw=name)=>mockBle.emit('scanResult',{scanId:id,deviceId,name,advertisedName:raw,rssi:-40});
  hooks.finish=id=>mockBle.emit('scanStopped',{scanId:id,reason:'finished'});
 },{oldMac,newMac,thirdMac,uid,otherUid,foreign,boot});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'#home');await page.waitForFunction(()=>CardBluetooth?.firmware&&!CardPageTransition.busy);
 return{context,page,errors};
}
async function enter(page){await page.locator('#newProject').tap();await page.waitForFunction(()=>location.hash==='#editor'&&!CardPageTransition.busy);}
async function settle(page,phase,timeout=35000){await page.waitForFunction(phase=>CardBluetooth.firmware.snapshot().phase===phase&&!CardBluetooth.firmware.snapshot().busy,phase,{timeout});}
async function inspect(page){return page.evaluate(()=>{
 const s=CardBluetooth.firmware.snapshot();if(s.session.pkg){const p=s.session.pkg;s.session.pkg={version:p.version,imageSha256:p.imageSha256,imageSize:p.imageSize};}
 return{snapshot:s,identity:CardBluetooth.ota.identity(),connected:CardBluetooth.connected,binding:JSON.parse(localStorage.getItem('xiaobai:ota:binding:v1')),defaultId:CardBluetooth.defaultDeviceId,calls:mockBle.calls,c2:mockBle.c2,ota:mockBle.otaCalls,hooks:installedHooks,trace:document.querySelector('.bt-trace')?.textContent,dialog:{open:document.getElementById('xiaobaiFirmwareDialog').open,title:document.getElementById('firmwareTitle').textContent,message:document.getElementById('firmwareMessage').textContent,progressHidden:document.querySelector('.firmware-progress-wrap').hidden}};
 });}
async function evidence(page,name){const s=await inspect(page);fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(s,null,2));return s;}
function noBoot(s){eq(s.ota.length,0,'no beginOta/raw Boot operation');eq(s.c2.filter(x=>x.op===0x61).length,0,'no ENTER_BOOT');eq(s.calls.filter(x=>['beginOta','writeOta','endOta'].includes(x.method)).length,0,'no native Boot API');}
function healthRestored(s){
 const lastInfo=s.c2.findLastIndex(x=>x.op===0x60),proof=s.c2.slice(lastInfo+1);let halves=0;const uidEnd=proof.findIndex(x=>x.op===0x56&&++halves===2),after=proof.slice(uidEnd+1);
 // enterProgram() reuses PROGRAM if already there, but still performs a fresh
 // seq-0 probe; a VOICE candidate writes ENTER_PROGRAM before that same probe.
 const program=after.findIndex(x=>x.op===1||(x.op===4&&x.seq===0));
 ok(lastInfo>=0&&uidEnd>=0&&program>=0,'normal App UID proof precedes program restoration');
 const health=after.slice(0,program).filter(x=>x.op===4);eq(health.length,2,'exactly two fresh STATUS after identity before restore');
 ok(health[0].seq!==health[1].seq&&health[1].at-health[0].at>=550,'fresh distinct health samples have real separation');
 ok(after.slice(program+1).some(x=>x.op===0x52),'learned state restored after program');
 eq(s.c2.filter(x=>[0x10,0x57].includes(x.op)).length,0,'confirmation never auto-runs program or learning');
}
async function beginOffline(page){await enter(page);await settle(page,'unconfirmed');const s=await inspect(page);eq(s.calls.filter(x=>x.method==='connect').length,0,'pending starts offline');ok(s.dialog.progressHidden,'confirmation does not display 0% transfer progress');ok(s.dialog.title.includes('待连接确认'));ok(!s.dialog.message.includes('从头'));await page.screenshot({path:path.join(out,currentCase+'-unconfirmed.png')});await page.locator('.firmware-retry').tap();await page.waitForFunction(()=>installedHooks.scans.length===1);return page.evaluate(()=>installedHooks.scans[0].scanId);}
async function ad(page,id,deviceId=newMac,name='Spark_AI',raw=name){await page.evaluate(({id,deviceId,name,raw})=>{installedHooks.ad(id,deviceId,name,raw);installedHooks.finish(id);},{id,deviceId,name,raw});}
async function liveReuse(browser,{foreign=false}={}){
 const{context,page,errors}=await create(browser,{foreign});
 try{
  // A fresh normal connection is established through the actual Bluetooth page,
  // without touching the OTA adapter. The old pending locator remains in storage.
  await page.evaluate(()=>location.hash='bluetooth');await page.locator('.bt-search').tap();await page.locator('.bt-device[data-device-id="'+newMac+'"] .bt-connect').tap();await page.waitForFunction(()=>CardBluetooth.connected);
  await page.evaluate(third=>{localStorage.setItem('cardModel:xiaobai:bluetooth:v1',third);installedHooks.modeDuringUid=false;},thirdMac);
  const before=await inspect(page);await page.evaluate(()=>location.hash='home');await page.waitForFunction(()=>!CardPageTransition.busy);await enter(page);await settle(page,'ready');const s=await evidence(page,foreign?'live-foreign-uid':'live-same-uid');
  eq(s.identity.deviceId,newMac);eq(s.calls.filter(x=>x.method==='connect').length,1,'existing normal App is reused');eq(s.calls.filter(x=>x.method==='disconnect').length,0,'existing App never disconnected');eq(s.defaultId,thirdMac,'unrelated default is preserved');noBoot(s);
  if(foreign){eq(s.binding,before.binding,'same hash on different UID preserves pending byte-for-byte');ok(!s.snapshot.session.healthVerifiedEpoch,'unrelated robot cannot validate original pending');}
  else{eq(s.binding.pending,null);eq(s.binding.deviceId,newMac);eq(s.binding.uid,uid);eq(s.snapshot.session.healthVerifiedEpoch,s.identity.epoch);healthRestored(s);const trace=s.trace;ok(trace.includes('读取两次真实状态'),'production Session confirmation path used');}
  eq(errors,[]);
 }catch(e){await evidence(page,'failure-'+currentCase);throw e;}finally{await context.close();}
}
async function liveSameUid(browser){return liveReuse(browser);}
async function liveForeignUid(browser){return liveReuse(browser,{foreign:true});}
async function offlineDiscovery(browser){
 const{context,page,errors}=await create(browser);
 try{const id=await beginOffline(page);await ad(page,id,newMac,'Spark_AI','Spark_AI\0tail');await settle(page,'success');const s=await evidence(page,'offline-new-mac-success');eq(s.binding.pending,null);eq(s.binding.deviceId,newMac);eq(s.binding.uid,uid);eq(s.defaultId,thirdMac);eq(s.calls.filter(x=>x.method==='connect').length,1);eq(s.calls.find(x=>x.method==='connect').boundDevice,false,'new MAC uses normal discovery authorization');ok(s.c2.some(x=>x.op===0x56));eq(s.c2.filter(x=>x.op===0x60).length,10,'fresh full INFO before binding and shared program restoration');eq(s.hooks.abort.length,0,'candidate MODE0 event cannot abort confirmation');eq(s.hooks.modeCount>0,true);healthRestored(s);noBoot(s);await page.screenshot({path:path.join(out,'offline-success.png')});await page.evaluate(()=>installedHooks.mode(mockBle.connectionId,0));await page.waitForFunction(()=>installedHooks.abort.length===1);eq((await inspect(page)).hooks.abort.length,1,'normal mode abort handling restored after ENTER_PROGRAM');eq(errors,[]);}catch(e){await evidence(page,'failure-'+currentCase);throw e;}finally{await context.close();}
}
async function rejectCandidate(browser,kind){
 const{context,page,errors}=await create(browser,{foreign:kind==='wrong-uid',boot:kind==='boot'});
 try{const id=await beginOffline(page),before=(await inspect(page)).binding;await ad(page,id);if(kind==='boot'){await page.waitForFunction(()=>mockBle.calls.some(x=>x.method==='connect'));await page.waitForTimeout(4300);await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);}else await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy,null,{timeout:35000});const s=await evidence(page,'candidate-'+kind);eq(s.binding,before,'candidate without proof cannot alter binding');eq(s.snapshot.ready,false);eq(s.defaultId,thirdMac);eq(s.c2.filter(x=>x.op===0x60).length,0,'UID mismatch/Boot never advances to full INFO');noBoot(s);eq(errors,[]);}catch(e){await evidence(page,'failure-'+currentCase);throw e;}finally{await context.close();}
}
async function wrongUid(browser){return rejectCandidate(browser,'wrong-uid');}
async function bootOnly(browser){return rejectCandidate(browser,'boot');}
async function oldMacConflict(browser){
 const{context,page,errors}=await create(browser,{foreign:true});
 try{const id=await beginOffline(page),before=(await inspect(page)).binding;await page.evaluate(({id,oldMac,newMac})=>{installedHooks.ad(id,newMac);installedHooks.ad(id,oldMac);},{id,oldMac,newMac});await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);const s=await evidence(page,'old-mac-uid-conflict');const connections=s.calls.filter(x=>x.method==='connect');eq(connections.length,1,'old MAC conflict cannot fall through to collected alternatives');eq(connections[0].deviceId,oldMac);eq(s.snapshot.code,'IDENTITY');eq(s.binding,before);noBoot(s);eq(errors,[]);}catch(e){await evidence(page,'failure-'+currentCase);throw e;}finally{await context.close();}
}
async function cancelLate(browser){
 const{context,page,errors}=await create(browser);
 try{const id=await beginOffline(page);await page.evaluate(()=>mockBle.infoDelay=650);await ad(page,id);await page.waitForFunction(()=>mockBle.c2.some(x=>x.op===0x56));await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);const before=await inspect(page);await page.evaluate(id=>{installedHooks.ad(id);installedHooks.finish(id);},id);await page.waitForTimeout(1500);const s=await evidence(page,'cancel-late-notifications');eq(s.binding,before.binding);ok(s.binding.pending);eq(s.snapshot.ready,false);eq(s.calls.filter(x=>x.method==='connect').length,before.calls.filter(x=>x.method==='connect').length,'late scan cannot reconnect');eq(s.c2.filter(x=>x.op===1).length,0,'late UID cannot restore program');eq(s.c2.filter(x=>x.op===0x60).length,0,'late UID cannot advance INFO');noBoot(s);eq(errors,[]);}catch(e){await evidence(page,'failure-'+currentCase);throw e;}finally{await context.close();}
}
async function deadlineLateConnect(browser){
 const{context,page,errors}=await create(browser);
 try{const id=await beginOffline(page);await page.evaluate(()=>installedHooks.holdConnect=true);await ad(page,id);await page.waitForFunction(()=>installedHooks.held);const started=await page.evaluate(()=>performance.now());await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy,null,{timeout:35000});const expired=await inspect(page);ok(expired.binding.pending);eq(expired.snapshot.ready,false);const elapsed=await page.evaluate(()=>performance.now())-started;ok(elapsed>=28000&&elapsed<33000,'whole confirmation bounded at real 30-second production budget');await page.evaluate(()=>installedHooks.releaseConnect());await page.waitForTimeout(300);const s=await evidence(page,'deadline-late-native-connect');eq(s.binding,expired.binding);eq(s.c2.length,0,'expired native connect cannot send C2');eq(s.identity,null,'expired candidate is closed');noBoot(s);eq(errors,[]);}catch(e){await evidence(page,'failure-'+currentCase);throw e;}finally{await context.close();}
}
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});try{for(const test of [liveSameUid,liveForeignUid,offlineDiscovery,wrongUid,bootOnly,oldMacConflict,cancelLate,deadlineLateConnect]){if(process.env.XIAOBAI_OTA_INSTALLED_CASES&&!process.env.XIAOBAI_OTA_INSTALLED_CASES.split(',').includes(test.name))continue;currentCase=test.name;try{await test(browser);results.push({name:test.name,passed:true});console.log('PASS installed App native boundary '+test.name);}catch(e){results.push({name:test.name,passed:false,error:e.message});throw e;}}console.log(checks+' checks passed');}finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,results,boundary:'Real source UI/Android adapter/Gate/Session; synthetic native BLE only; no hardware, APK build or Git.'},null,2));await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
