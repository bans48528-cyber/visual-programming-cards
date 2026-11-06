'use strict';
// Real program entry, UI, gate, Session and native bridge adapter; only BLE boundary is mocked.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mockAndroid=require('./mock-android.cjs'),mockFirmware=require('./mock-firmware.cjs');
const root=path.resolve(__dirname,'..'),release=require('../assets/firmware/release.json');
const BASE=process.env.XIAOBAI_OTA_UI_BASE||'http://127.0.0.1:4173/dist/';
const OUT=process.env.XIAOBAI_OTA_UI_OUTPUT||path.resolve(__dirname,'../artifacts/ota-ui');
const target=release.firmware;let checks=0;const reports=[];
const viewports=[{width:751,height:360},{width:568,height:280},{width:1024,height:640},{width:390,height:844}];
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function create(browser,viewport,scenario={}){
 const context=await browser.newContext({viewport,hasTouch:true});
 await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
 await context.addInitScript(mockAndroid);await context.addInitScript(mockFirmware,{target,...scenario});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE+'#home');await page.waitForFunction(()=>window.CardOta&&window.CardBluetooth?.firmware&&!window.CardPageTransition?.busy);
 eq(await page.locator('.home-ota-entry').count(),0,'no independent settings entry');eq(await page.locator('#xiaobaiOtaSettings,.ota-file').count(),0,'no old picker/page');
 return{context,page,errors};
}
async function enter(page){await page.locator('#newProject').tap();await page.waitForFunction(()=>location.hash==='#editor'&&!window.CardPageTransition?.busy);}
async function phase(page,value,timeout=18000){try{await page.waitForFunction(value=>CardBluetooth?.firmware?.snapshot().phase===value&&!CardBluetooth.firmware.snapshot().busy,value,{timeout});}catch(e){console.error('FIRMWARE DEBUG',await page.evaluate(()=>{const s=CardBluetooth.firmware.snapshot();return{phase:s.phase,busy:s.busy,ready:s.ready,code:s.code,message:s.message,current:s.currentVersion,actual:s.actual?.info,mock:mockBle.appIdentity,mode:mockBle.mode,calls:mockBle.c2.slice(-22).map(c=>({op:c.op,part:c.part,seq:c.seq}))};}));await page.screenshot({path:path.join(OUT,'firmware-debug-'+value+'.png')});throw e;}}
async function screenshot(page,name){await page.screenshot({path:path.join(OUT,name+'.png')});}
async function fits(page,viewport,label){
 const r=await page.locator('#xiaobaiFirmwareDialog').evaluate(dialog=>{
  const box=dialog.getBoundingClientRect(),content=dialog.querySelector('.firmware-content'),c=content.getBoundingClientRect(),footer=dialog.querySelector('.firmware-actions').getBoundingClientRect();
  const bad=[...dialog.querySelectorAll('button,h2,p,dd,dt')].filter(n=>n.getClientRects().length).map(n=>({text:n.textContent,...n.getBoundingClientRect().toJSON()})).filter(b=>b.left<box.left-1||b.right>box.right+1);
  return{box:box.toJSON(),content:c.toJSON(),footer:footer.toJSON(),bad,scrollWidth:content.scrollWidth,clientWidth:content.clientWidth};
 });
 ok(r.box.left>=0&&r.box.top>=0&&r.box.right<=viewport.width+1&&r.box.bottom<=viewport.height+1,label+' modal fits');
 ok(r.scrollWidth<=r.clientWidth+1,label+' no horizontal overflow');eq(r.bad,[],label+' text and controls fit');ok(r.content.bottom<=r.footer.top+1,label+' content/controls do not overlap');
 for(const name of ['.firmware-cancel','.firmware-confirm','.firmware-retry'])if(await page.locator(name).isVisible()){const b=await page.locator(name).boundingBox();ok(b.y>=r.box.top&&b.y+b.height<=r.box.bottom+1,label+' action visible '+name);}
 eq(await page.locator('#xiaobaiFirmwareDialog input[type=file]').count(),0,'modal never asks for a package');reports.push({label,viewport,...r});
}
async function matched(browser){
 const {context,page,errors}=await create(browser,{width:751,height:360});
 try{
  await enter(page);await phase(page,'ready');await page.waitForFunction(()=>CardBluetooth.remoteConnection()?.learned?.getSnapshot().initialized||CardBluetooth.remoteConnection()?.learned?.getSnapshot().query==='ready');
  ok(!await page.locator('#xiaobaiFirmwareDialog').isVisible(),'exact bundle target does not prompt');
  const initial=await page.evaluate(()=>mockBle.c2.filter(c=>c.op===0x60).length);eq(initial,10,'one authoritative query per epoch');
  await page.evaluate(()=>{for(let i=0;i<5;i++)mockBle.versionEvent();mockBle.versionEvent(0x10000,'old-epoch');});await sleep(200);
  eq(await page.evaluate(()=>mockBle.c2.filter(c=>c.op===0x60).length),initial,'duplicate/current and old-epoch hints do not requery');
  eq(await page.evaluate(()=>mockBle.otaCalls.length),0,'matched device never enters OTA');ok(await page.evaluate(()=>mockBle.mode===4),'program mode active');
  const learns=await page.evaluate(()=>mockBle.c2.filter(c=>c.op===0x52));ok(learns.length>0,'learned states read after matching');
  eq(errors,[],'matched no page errors');
 }finally{await context.close();}
}
async function confirmationLayouts(browser){
 for(const viewport of viewports){
  const {context,page,errors}=await create(browser,viewport,{version:0x10000,emitVersion:false});
  try{
   await enter(page);await phase(page,'update-required');await page.locator('#xiaobaiFirmwareDialog').waitFor({state:'visible'});
   eq(await page.locator('.firmware-current').textContent(),'1.0.0','old device fallback reads actual version');eq(await page.locator('.firmware-target').textContent(),target.versionName,'fixed App target');
   ok(await page.locator('.firmware-confirm').isVisible(),'one confirm starts automatic update');eq(await page.locator('.firmware-confirm').textContent(),'确定');ok(!await page.locator('.firmware-retry').isVisible(),'no extra package workflow');
   eq(await page.evaluate(()=>mockBle.otaCalls.length),0,'no OTA before consent');
   await fits(page,viewport,'confirm-'+viewport.width+'x'+viewport.height);await screenshot(page,'firmware-confirm-'+viewport.width+'x'+viewport.height);
   await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!document.getElementById('xiaobaiFirmwareDialog').open);
   await page.evaluate(()=>{for(let i=0;i<5;i++)mockBle.versionEvent(0x10000);mockBle.versionEvent(0x10000,'stale-epoch');});await sleep(450);
   ok(!await page.locator('#xiaobaiFirmwareDialog').isVisible(),'cancel survives duplicate hints and heartbeats');
   await page.locator('#palette [data-card-id="motor-forward"]').tap();ok(await page.locator('#chain [data-card-id="motor-forward"]').count()>0,'editing remains available');
   await page.locator('#runProgramBtn').tap();await page.locator('#xiaobaiFirmwareDialog').waitFor({state:'visible'});eq(await page.evaluate(()=>mockBle.c2.filter(c=>c.op===0x10||c.op===0x57).length),0,'run blocked before matching');
   await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!document.getElementById('xiaobaiFirmwareDialog').open);
   if(viewport.width===751){
    await page.locator('#tab-dynamic').tap();await page.locator('#palette [data-card-id="self-learned-wait"]').tap();
    await page.locator('#chain [data-card-id="self-learned-wait"] .param-bubble').tap();await page.locator('.learned-command-action').waitFor({state:'visible'});await page.locator('.learned-command-action').tap();
    await page.locator('#xiaobaiFirmwareDialog').waitFor({state:'visible'});eq(await page.evaluate(()=>mockBle.c2.filter(c=>c.op===0x53).length),0,'learning is blocked and re-prompts');
   }
   eq(errors,[],'confirmation no page errors');
  }finally{await context.close();}
 }
}
async function upgrade(browser){
 const viewport={width:751,height:360},{context,page,errors}=await create(browser,viewport,{version:0x10000,emitVersion:false,holdDataAck:true});
 try{
  await enter(page);await phase(page,'update-required');await page.locator('#palette [data-card-id="motor-forward"]').count();
  // Keep a real program in the editor; successful firmware update must not run it.
  await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!document.getElementById('xiaobaiFirmwareDialog').open);await page.locator('#palette [data-card-id="motor-forward"]').tap();await page.locator('#runProgramBtn').tap();await page.locator('#xiaobaiFirmwareDialog').waitFor({state:'visible'});
  await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>mockBle.otaCalls.some(c=>c.op===0x63));
  eq(await page.evaluate(()=>mockBle.otaCalls.filter(c=>c.op===0x62).length),1,'one confirm means one BEGIN');
  ok(await page.locator('.firmware-progress-wrap').isVisible(),'progress in programming modal');eq(await page.locator('.firmware-progress').getAttribute('value'),'0','unacknowledged DATA cannot count as submitted');
  await fits(page,viewport,'updating');await screenshot(page,'firmware-progress');
  for(const v of viewports){await page.setViewportSize(v);await fits(page,v,'progress-'+v.width+'x'+v.height);await screenshot(page,'firmware-progress-'+v.width+'x'+v.height);}
  await page.setViewportSize(viewport);
  await page.evaluate(()=>{mockBle.holdDataAck=false;});
  await phase(page,'success',35000);await screenshot(page,'firmware-success');
  for(const v of viewports){await page.setViewportSize(v);await fits(page,v,'success-'+v.width+'x'+v.height);await screenshot(page,'firmware-success-'+v.width+'x'+v.height);}
  await page.setViewportSize(viewport);
  ok(await page.evaluate(()=>CardBluetooth.firmware.snapshot().ready),'new target verified and permitted');
  eq(await page.locator('.firmware-current').textContent(),target.versionName);eq(await page.locator('.firmware-confirm').textContent(),'完成');
  const evidence=await page.evaluate(()=>({ota:mockBle.otaCalls,c2:mockBle.c2,connects:mockBle.calls.filter(c=>c.method==='connect').map(c=>({device:c.deviceId,id:c.connectionId})),current:mockBle.connectionId,mode:mockBle.mode,learned:CardBluetooth.remoteConnection()?.learned?.getSnapshot()}));
  eq(evidence.ota.filter(c=>c.op===0x62).length,1,'no second upgrade');ok(evidence.connects.length>=2,'post-write fresh epoch');eq(new Set(evidence.connects.map(c=>c.id)).size,evidence.connects.length,'unique epoch IDs');ok(evidence.connects.every(c=>c.device==='FW-BOUND'),'only original bound device');
  const last=evidence.current;ok(evidence.c2.some(c=>c.id===last&&c.op===1),'restored ENTER_PROGRAM');ok(evidence.c2.some(c=>c.id===last&&c.op===0x52),'actual learned-state query in restored epoch');eq(evidence.mode,4,'programming restored');
  const health=evidence.c2.filter(c=>c.id===last&&c.op===4&&c.seq!==0);ok(health.length>=2,'real fresh health queries');ok(new Set(health.map(c=>c.seq)).size>=2,'health seqs distinct');
  eq(evidence.c2.filter(c=>c.op===0x10||c.op===0x57).length,0,'firmware update never auto-runs the program');
  const enters=evidence.c2.filter(c=>c.op===0x61);eq(enters.length,1,'one ENTER');const oldId=enters[0].id,old=evidence.c2.filter(c=>c.id===oldId),at=old.findIndex(c=>c.op===0x61);eq(old.slice(at+1),[],'no old-epoch C2 after ENTER');
  await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>!document.getElementById('xiaobaiFirmwareDialog').open);await sleep(350);ok(await page.evaluate(()=>mockBle.c2.some(c=>c.id===mockBle.connectionId&&c.op===3)),'heartbeats restored');
  await page.evaluate(id=>{for(let i=0;i<5;i++)mockBle.versionEvent(0x10000,id);mockBle.versionEvent();},oldId);await sleep(200);ok(!await page.locator('#xiaobaiFirmwareDialog').isVisible(),'late old hints do not repeat upgrade');
  fs.writeFileSync(path.join(OUT,'firmware-browser-native-path.json'),JSON.stringify(evidence,null,2));eq(errors,[],'upgrade no page errors');
 }finally{await context.close();}
}
async function newerUnknown(browser){
 for(const scenario of [{version:target.version+1},{version:target.version,collision:true},{version:0x10000,emitVersion:false,rejectInfo:true}]){
  const {context,page,errors}=await create(browser,{width:751,height:360},scenario);
  try{
   await enter(page);await page.waitForFunction(()=>['newer','unknown'].includes(CardBluetooth.firmware.snapshot().phase)&&!CardBluetooth.firmware.snapshot().busy);
   ok(await page.locator('#xiaobaiFirmwareDialog').isVisible(),'blocked state visible');ok(!await page.locator('.firmware-confirm').isVisible(),'no update confirmation for newer/unknown/collision');eq(await page.evaluate(()=>mockBle.c2.filter(c=>c.op===0x61).length),0,'blocked state never enters OTA');
   if(scenario.rejectInfo){eq(await page.locator('.firmware-current').textContent(),'未确认','unknown is not a fabricated older version');await screenshot(page,'firmware-version-unknown');await page.evaluate(t=>{mockBle.rejectInfo=false;Object.assign(mockBle.appIdentity,{version:t.version,imageValid:true,imageSize:t.imageSize,imageSha256:t.imageSha256});},target);await page.locator('.firmware-retry').tap();await phase(page,'ready');ok(!await page.locator('#xiaobaiFirmwareDialog').isVisible(),'explicit retry discovers real matching version');}
   else if(scenario.version>target.version)ok((await page.locator('#firmwareMessage').textContent()).includes('更新 App'),'newer device asks for a newer App');
   eq(errors,[],'blocked version no page errors');
  }finally{await context.close();}
 }
}
async function wrongUid(browser){
 const {context,page,errors}=await create(browser,{width:1024,height:640},{version:0x10000,badPostUid:true});
 try{
  await enter(page);await phase(page,'update-required');await page.locator('.firmware-confirm').tap();await phase(page,'recovery',35000);
  ok(!await page.evaluate(()=>CardBluetooth.firmware.snapshot().ready),'wrong UID does not succeed');ok(await page.locator('#xiaobaiFirmwareDialog').isVisible(),'real failure message visible');await screenshot(page,'firmware-startup-identity-error');
  for(const v of viewports){await page.setViewportSize(v);await fits(page,v,'identity-error-'+v.width+'x'+v.height);await screenshot(page,'firmware-error-'+v.width+'x'+v.height);}
  await page.setViewportSize({width:1024,height:640});
  const before=await page.evaluate(()=>mockBle.otaCalls.filter(c=>c.op===0x62).length);eq(before,1);
  await page.evaluate(()=>{mockBle.badPostUid=false;});await page.locator('.firmware-confirm').tap();await phase(page,'success',30000);
  eq(await page.evaluate(()=>mockBle.otaCalls.filter(c=>c.op===0x62).length),before,'confirmation recovery does not reflash a written image');eq(errors,[],'wrong UID recovery no page errors');
 }finally{await context.close();}
}
async function cancelledRecovery(browser){
 for(const mode of ['pause','close']){
  const {context,page,errors}=await create(browser,{width:751,height:360},{version:0x10000,holdDataAck:true});
  try{
   await enter(page);await phase(page,'update-required');await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>mockBle.otaCalls.some(c=>c.op===0x63));
   if(mode==='pause')await page.evaluate(()=>nativeListeners.pause({}));else await page.locator('#xiaobaiFirmwareDialog').evaluate(n=>n.close());
   await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy&&!document.getElementById('xiaobaiFirmwareDialog').open);
   const data=await page.evaluate(()=>mockBle.otaCalls.filter(c=>c.op===0x63).length),connects=await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='connect').length);await sleep(350);
   eq(await page.evaluate(()=>mockBle.otaCalls.filter(c=>c.op===0x63).length),data,'cancel has no later DATA');eq(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='connect').length),connects,'cancel never auto reconnects');
   await page.evaluate(()=>{mockBle.holdDataAck=false;});await page.locator('#palette [data-card-id="motor-forward"]').tap();await page.locator('#runProgramBtn').tap();await page.locator('#xiaobaiFirmwareDialog').waitFor({state:'visible'});
   ok((await page.locator('#firmwareMessage').textContent()).includes('恢复'),'program entry offers explicit recovery');await screenshot(page,'firmware-cancel-'+mode);
   await page.locator('.firmware-confirm').tap();await phase(page,'success',35000);const e=await page.evaluate(()=>({calls:mockBle.otaCalls,connects:mockBle.calls.filter(c=>c.method==='connect')}));
   eq(e.calls.filter(c=>c.op===0x62).length,2,'cancelled download uses fresh BEGIN from zero');ok(e.connects.every(c=>c.deviceId==='FW-BOUND'),'recovery is pinned to original device');eq(errors,[],'cancel recovery no page errors');
  }finally{await context.close();}
 }
}
async function historicalPending(browser){
 const old={boardId:258,version:0x10001,imageSize:320,imageSha256:'1'.repeat(64)};
 const {context,page,errors}=await create(browser,{width:751,height:360},{version:0x10001,pending:old,pendingWritten:true,holdDataAck:true});
 try{
  await enter(page);await phase(page,'recovery');ok(!await page.evaluate(()=>CardBluetooth.firmware.snapshot().ready),'old pending hash never counts as target ready');eq(await page.locator('.firmware-target').textContent(),target.versionName);
  await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>mockBle.otaCalls.some(c=>c.op===0x63));
  eq(await page.evaluate(()=>mockBle.uploadTarget.version),target.version,'recovery always uses the built-in target');eq(await page.evaluate(()=>CardBluetooth.firmware.snapshot().session.pkg.imageSha256),target.imageSha256);
  const binding=await page.evaluate(()=>JSON.parse(localStorage.getItem('xiaobai:ota:binding:v1')));eq(binding.pending.version,target.version);eq(binding.pending.imageSha256,target.imageSha256);ok(!binding.written,'old write evidence does not apply to new target');
  await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);eq(errors,[],'historical pending no page errors');
 }finally{await context.close();}
}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});try{for(const fn of [matched,confirmationLayouts,upgrade,newerUnknown,wrongUid,cancelledRecovery,historicalPending]){if(process.env.XIAOBAI_FIRMWARE_UI_CASES&&!process.env.XIAOBAI_FIRMWARE_UI_CASES.split(',').includes(fn.name))continue;await fn(browser);console.log('PASS program firmware UI '+fn.name);}fs.writeFileSync(path.join(OUT,'firmware-browser-layout.json'),JSON.stringify(reports,null,2));console.log(`Program-entry fixed firmware browser: ${checks} checks passed; real UI/adapter, mock BLE only; captures ${OUT}.`);}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
