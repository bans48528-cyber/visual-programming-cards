// Production Android adapter + Gate + Session + real dialog. Only native BLE is synthetic.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mockAndroid=require('./mock-android.cjs'),mockFirmware=require('./mock-firmware.cjs');
const target=require('../assets/firmware/release.json').firmware;
const BASE=process.env.XIAOBAI_OTA_UI_BASE||'http://127.0.0.1:4173/dist/';
const OUT=process.env.XIAOBAI_OTA_LIFECYCLE_OUTPUT||path.resolve(__dirname,'../artifacts/ota-lifecycle');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let checks=0,currentCase='';const results=[];
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
async function evidence(page,label){
 const value=await page.evaluate(()=>{const s=CardBluetooth.firmware.snapshot();if(s.session.pkg){const p=s.session.pkg;s.session.pkg={version:p.version,imageSize:p.imageSize,imageSha256:p.imageSha256,signatureVerified:p.signatureVerified};}return{snapshot:s,cancelled:CardBluetooth.firmware.cancelled,
  open:document.getElementById('xiaobaiFirmwareDialog').open,message:document.getElementById('firmwareMessage').textContent,
  binding:JSON.parse(localStorage.getItem('xiaobai:ota:binding:v1')||'null'),currentId:mockBle.connectionId,
  app:mockBle.appIdentity,committed:mockBle.committed,calls:mockBle.calls,ota:mockBle.otaCalls,c2:mockBle.c2,disconnects:mockBle.nativeDisconnects,writeFailures:mockBle.writeFailures,trace:document.querySelector('.bt-trace')?.textContent};});
 fs.writeFileSync(path.join(OUT,label+'.json'),JSON.stringify(value,null,2));return value;
}
async function finish(context,page){await evidence(page,'last-'+currentCase).catch(()=>{});await context.close();}
async function create(browser,scenario={}){
 const context=await browser.newContext({viewport:{width:751,height:360},hasTouch:true});
 await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
 await context.addInitScript(mockAndroid);await context.addInitScript(mockFirmware,{target,version:0x10000,emitVersion:false,...scenario});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE+'#home');await page.waitForFunction(()=>CardBluetooth?.firmware&&!CardPageTransition?.busy);
 const bundle=await page.evaluate(async()=>{const b=await XiaobaiFirmwareBundle.load();return{signature:b.pkg.signatureVerified,sha:b.pkg.packageSha256,version:b.pkg.version};});
 eq(bundle,{signature:true,sha:'a4951259ca4ca31cf0ec1acad5ea6e1b1f232d1989e93b86170e074d3a7178d9',version:0x10003},'actual frozen signed 1.0.3 package loaded');
 return{context,page,errors};
}
async function enter(page){await page.locator('#newProject').tap();await page.waitForFunction(()=>location.hash==='#editor'&&!CardPageTransition.busy);await page.locator('#xiaobaiFirmwareDialog').waitFor({state:'visible'});await page.waitForFunction(()=>CardBluetooth.firmware.snapshot().canUpgrade&&!CardBluetooth.firmware.snapshot().busy);}
async function noSilentResume(page){const before=await page.evaluate(()=>({data:mockBle.otaCalls.filter(c=>c.op===0x63).length,begin:mockBle.otaCalls.filter(c=>c.op===0x62).length,connects:mockBle.calls.filter(c=>c.method==='connect').length}));await sleep(350);const after=await page.evaluate(()=>({data:mockBle.otaCalls.filter(c=>c.op===0x63).length,begin:mockBle.otaCalls.filter(c=>c.op===0x62).length,connects:mockBle.calls.filter(c=>c.method==='connect').length}));eq(after,before,'no automatic reconnect/BEGIN/DATA after task ends');}
async function bootInfoDrop(browser){
 const {context,page,errors}=await create(browser,{disconnectBootInfoAt:1,holdDataAck:true});
 try{
  await enter(page);await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>mockBle.nativeDisconnects.length>0);await sleep(250);
  const e=await evidence(page,'boot-info-native-drop');await page.screenshot({path:path.join(OUT,'boot-info-native-drop.png')});
  eq(e.cancelled,false,'native OTA disconnect must not be reclassified as user cancellation');
  ok(e.open&&e.snapshot.prompt,'initial Boot INFO disconnect retains real upgrade/recovery dialog');
  ok(e.binding?.pending,'fixed target recovery record preserved');
  eq(e.binding.pending.imageSha256,target.imageSha256);eq(e.binding.written,false);
  ok(e.calls.filter(c=>c.method==='connect').every(c=>c.deviceId==='FW-BOUND'),'only original bound MAC');
  eq(e.c2.filter(c=>c.op===0x10||c.op===0x57).length,0,'never auto-run program');
  if(e.snapshot.busy)await page.locator('.firmware-cancel').tap();
  await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);eq(errors,[]);
 }finally{await finish(context,page);}
}

function pinned(e){
 ok(e.calls.filter(c=>c.method==='connect').every(c=>c.deviceId==='FW-BOUND'),'every native reconnect uses bound MAC');
 eq(e.binding?.deviceId,'FW-BOUND','binding MAC preserved');eq(e.binding?.uid,'0102030405060708090a0b0c','binding UID preserved');
 eq(e.c2.filter(c=>c.op===0x10||c.op===0x57).length,0,'no program run sent automatically');
}
async function infoWriteDrop(browser,order){
 const {context,page,errors}=await create(browser,{infoWriteDisconnect:order,holdDataAck:true});
 try{
  await enter(page);await page.locator('.firmware-confirm').tap();
  await page.waitForFunction(()=>mockBle.dataRequests>0,null,{timeout:20000});
  const e=await evidence(page,'boot-info-write-'+order);
  eq(e.cancelled,false,'native write closure is not user cancellation');ok(e.open&&e.snapshot.busy,'native write loss keeps real dialog');
  eq(e.writeFailures.length,1);eq(e.disconnects.length,1);
  if(order==='reject-first')ok(e.writeFailures[0].at<=e.disconnects[0].at,'plain native write rejection arrives first');
  else ok(e.disconnects[0].at<=e.writeFailures[0].at,'disconnected event arrives first');
  eq(e.ota.filter(c=>c.op===0x62).length,1,'INFO close reconnects before one BEGIN');pinned(e);
  await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);await noSilentResume(page);eq(errors,[]);
 }finally{await finish(context,page);}
}
async function infoWriteRejectFirst(browser){return infoWriteDrop(browser,'reject-first');}
async function infoDisconnectFirst(browser){return infoWriteDrop(browser,'disconnect-first');}
async function initialInfoRetry(browser){
 const {context,page,errors}=await create(browser,{dropBootInfoCount:3,holdDataAck:true});
 try{
  await enter(page);const firstEpoch=await page.evaluate(()=>mockBle.connectionId);
  await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>mockBle.dataRequests>0,null,{timeout:20000});
  const e=await evidence(page,'boot-info-timeout-owned-retry');
  ok(e.open&&e.snapshot.busy&&e.snapshot.prompt,'owned INFO retry stays in real active dialog');eq(e.cancelled,false);
  ok(await page.evaluate(()=>mockBle.bootInfoRequests>=4),'real INFO retry budget exhausted before reconnect');
  eq(e.ota.filter(c=>c.op===0x62).length,1,'owned reconnect does not duplicate BEGIN');pinned(e);
  const current=e.currentId;ok(firstEpoch!==current,'Boot INFO retry uses a fresh epoch');
  await page.evaluate(id=>{mockBle.emit('disconnected',{connectionId:id,reason:'late old epoch disconnect'});mockBle.versionEvent(0x10000,id);},firstEpoch);await sleep(150);
  eq(await page.evaluate(()=>mockBle.connectionId),current,'stale native disconnect cannot clear current connection');
  eq(await page.evaluate(()=>CardBluetooth.firmware.cancelled),false,'old-epoch handler cannot cancel current OTA');
  eq(await page.locator('#xiaobaiFirmwareDialog').evaluate(n=>n.open),true,'stale event does not close real dialog');
  await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);await noSilentResume(page);eq(errors,[]);
 }finally{await finish(context,page);}
}
async function dataDrop(browser,at){
 const {context,page,errors}=await create(browser,{disconnectDataAt:at,stateAfterBegin:0});
 const label=at===1?'data-zero-ack-lost-erased':'data-mid-transfer-drop';
 try{
  await enter(page);await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>mockBle.nativeDisconnects.length>0);
  await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);
  const e=await evidence(page,label);await page.screenshot({path:path.join(OUT,label+'.png')});
  eq(e.snapshot.phase,'recovery');eq(e.cancelled,false,'real drop is not user cancel');ok(e.open&&e.snapshot.prompt,'recovery remains visible after old confirmation key was already registered');
  ok(e.binding?.pending,'erased App keeps pending target');eq(e.binding.pending.imageSha256,target.imageSha256);eq(e.binding.written,false);
  eq(e.app.imageValid,false,'BEGIN erased active image');eq(e.app.state,0,'real board idle/erased metadata reproduced');
  if(at===1){eq(e.snapshot.progress.committed,0,'DATA without ACK counts zero');eq(e.app.nextOffset,0);eq(await page.locator('.firmware-progress').getAttribute('value'),'0');}
  else ok(e.snapshot.progress.committed>0,'only previously acknowledged DATA counted');
  eq(e.ota.filter(c=>c.op===0x62).length,1,'drop never triggers a second BEGIN');pinned(e);await noSilentResume(page);
  await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!document.getElementById('xiaobaiFirmwareDialog').open);await noSilentResume(page);
  await page.evaluate(()=>{mockBle.emit('disconnected',{connectionId:'stale-native-epoch'});});await sleep(100);
  eq(await page.locator('#xiaobaiFirmwareDialog').evaluate(n=>n.open),false,'dismissed recovery does not reopen');eq(errors,[]);
 }finally{await finish(context,page);}
}
async function dataDropZero(browser){return dataDrop(browser,1);}
async function dataDropMiddle(browser){return dataDrop(browser,3);}
async function enterLostAckDisconnect(browser){
 const {context,page,errors}=await create(browser,{disconnectEnterAt:1,holdDataAck:true});
 try{
  await enter(page);await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>mockBle.nativeDisconnects.length>0);
  await page.waitForFunction(()=>mockBle.dataRequests>0||!CardBluetooth.firmware.snapshot().busy,null,{timeout:20000});
  const e=await evidence(page,'enter-ack-lost-native-drop');eq(e.cancelled,false);ok(e.open&&e.snapshot.prompt,'ambiguous ENTER retains active dialog');
  ok(e.binding?.pending,'lost ENTER ACK does not prove rejection or clear pending');eq(e.binding.pending.imageSha256,target.imageSha256);eq(e.binding.written,false);
  eq(e.c2.filter(c=>c.op===0x61).length,1,'never repeat C2 ENTER after ambiguous ACK');pinned(e);
  if(e.snapshot.busy)await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);await noSilentResume(page);eq(errors,[]);
 }finally{await finish(context,page);}
}
async function explicitCancellation(browser){
 for(const mode of ['cancel','info-retry-cancel','stop','back','pause','leave']){
  const {context,page,errors}=await create(browser,{holdDataAck:true,...(mode==='info-retry-cancel'?{disconnectBootInfoAt:1}:{})});
  try{
   await enter(page);const initial=await page.evaluate(()=>mockBle.connectionId);await page.locator('.firmware-confirm').tap();
   if(mode==='info-retry-cancel')await page.waitForFunction(()=>mockBle.nativeDisconnects.length>0&&!mockBle.connectionId);else await page.waitForFunction(()=>mockBle.dataRequests>0);
   const old=mode==='info-retry-cancel'?initial:await page.evaluate(()=>mockBle.connectionId);
   if(mode==='cancel'||mode==='info-retry-cancel')await page.locator('.firmware-cancel').tap();
   else if(mode==='stop')await page.locator('#pauseProgramBtn').evaluate(n=>n.click()); // Real user handler; the modal covers the toolbar.
   else if(mode==='back')await page.evaluate(()=>nativeListeners.backButton({canGoBack:false}));
   else if(mode==='pause')await page.evaluate(()=>nativeListeners.pause({}));
   else await page.evaluate(()=>location.hash='home');
   await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy&&!document.getElementById('xiaobaiFirmwareDialog').open);
   const e=await evidence(page,'cancel-'+mode);ok(e.binding?.pending,'cancel retains pending target');eq(e.binding.written,false);eq(e.cancelled,true,mode+' is explicit cancellation');pinned(e);
   await noSilentResume(page);await page.evaluate(id=>{mockBle.emit('disconnected',{connectionId:id,reason:'late'});mockBle.versionEvent(0x10000,id);},old);await sleep(150);
   eq(await page.locator('#xiaobaiFirmwareDialog').evaluate(n=>n.open),false,mode+' does not reopen from late events');
   if(mode==='cancel'){
    await page.locator('#palette [data-card-id="motor-forward"]').tap();await page.locator('#runProgramBtn').tap();await page.locator('#xiaobaiFirmwareDialog').waitFor({state:'visible'});
    ok((await page.locator('#firmwareMessage').textContent()).includes('恢复'),'a fresh explicit run can offer recovery');
    eq(await page.evaluate(()=>mockBle.otaCalls.filter(c=>c.op===0x62).length),1,'new prompt alone cannot send BEGIN');
   }
   eq(errors,[]);
  }finally{await finish(context,page);}
 }
}
async function boundBootAfterProbeTimeout(browser){
 const pending={boardId:target.boardId,version:target.version,imageSize:target.imageSize,imageSha256:target.imageSha256};
 const {context,page,errors}=await create(browser,{appAvailable:false,imageValid:false,pending});
 try{
  await enter(page);await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!document.getElementById('xiaobaiFirmwareDialog').open);
  await page.locator('#palette [data-card-id="motor-forward"]').tap();
  await page.locator('#bluetoothBtn').tap();await page.waitForFunction(()=>location.hash==='#bluetooth'&&!CardPageTransition.busy);
  await page.evaluate(()=>{mockBle.devices=[{deviceId:'OTHER-HOST',name:'Stronger other',rssi:-10},{deviceId:'FW-BOUND',name:'BT_ECB0DC10B443',rssi:-38}];});
  await page.locator('.bt-search').tap();await page.locator('[data-device-id="FW-BOUND"] .bt-connect').tap();
  await page.waitForFunction(()=>location.hash==='#editor'&&document.getElementById('xiaobaiFirmwareDialog').open,null,{timeout:15000});
  const before=await evidence(page,'ordinary-c2-timeout-bound-boot-entry');pinned(before);
  eq(before.snapshot.phase,'recovery');ok(before.snapshot.prompt,'ordinary C2 timeout exposes real programming recovery prompt');
  eq(before.ota.length,0,'no raw Boot request or write before a fresh explicit confirmation');
  eq(await page.locator('#xiaobaiOtaSettings,.ota-file,.home-ota-entry').count(),0,'no independent old OTA settings workflow');
  await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>CardBluetooth.firmware.snapshot().phase==='success'&&!CardBluetooth.firmware.snapshot().busy,null,{timeout:40000});
  const e=await evidence(page,'ordinary-c2-timeout-bound-boot-success');pinned(e);eq(e.ota.filter(c=>c.op===0x62).length,1);
  eq(e.snapshot.ready,true,'fresh App identity and health gate unlock after explicit recovery');eq(e.app.version,target.version);
  eq(e.binding.pending,null,'verified boot clears pending');eq(e.binding.uid,'0102030405060708090a0b0c');eq(errors,[]);
 }finally{await finish(context,page);}
}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const fn of [bootInfoDrop,infoWriteRejectFirst,infoDisconnectFirst,initialInfoRetry,dataDropZero,dataDropMiddle,enterLostAckDisconnect,explicitCancellation,boundBootAfterProbeTimeout]){
  if(process.env.XIAOBAI_OTA_LIFECYCLE_CASES&&!process.env.XIAOBAI_OTA_LIFECYCLE_CASES.split(',').includes(fn.name))continue;
  try{currentCase=fn.name;await fn(browser);results.push({case:fn.name,passed:true});console.log('PASS production OTA lifecycle '+fn.name);}
  catch(e){results.push({case:fn.name,passed:false,error:e.message});throw e;}
 }
 }finally{fs.writeFileSync(path.join(OUT,'joint-results.json'),JSON.stringify({checks,results,boundary:'Only native BLE is mocked; production Android handler, Gate, Session, signed package and dialog execute.'},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
