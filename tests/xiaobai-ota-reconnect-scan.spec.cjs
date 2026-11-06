// Real source adapter/Gate/Session/UI. Only native scan/connect boundaries are synthetic.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.XIAOBAI_APP_ROOT||path.resolve(__dirname,'..');
const mockAndroid=require(path.join(root,'tests/mock-android.cjs')),mockFirmware=require(path.join(root,'tests/mock-firmware.cjs'));
const target=require(path.join(root,'assets/firmware/release.json')).firmware;
const base=process.env.XIAOBAI_OTA_UI_BASE||'http://127.0.0.1:4173/dist/';
const out=process.env.XIAOBAI_OTA_SCAN_OUTPUT||path.join(root,'artifacts/ota-reconnect-scan');
let checks=0,currentCase='';const results=[];
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
async function create(browser){
 const context=await browser.newContext({viewport:{width:751,height:360},hasTouch:true});
 await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
 await context.addInitScript(mockAndroid);
 await context.addInitScript(mockFirmware,{target,appAvailable:false,imageValid:false,holdDataAck:true,pending:{boardId:target.boardId,version:target.version,imageSize:target.imageSize,imageSha256:target.imageSha256}});
 await context.addInitScript(()=>{
  const bridge=Capacitor,previous=bridge.nativePromise.bind(bridge),callback=bridge.nativeCallback.bind(bridge);
  const hooks=window.scanHooks={scans:[],events:[],added:[],removed:[],holdStop:false,stopPending:false};
  bridge.nativeCallback=(plugin,method,opts,fn)=>{const id=callback(plugin,method,opts,fn);if(plugin==='SparkBle'&&method==='addListener'&&['scanResult','scanStopped'].includes(opts.eventName))hooks.added.push({id,event:opts.eventName});return id;};
  bridge.nativePromise=async(plugin,method,opts={})=>{
   if(plugin==='SparkBle'&&method==='removeListener')hooks.removed.push(opts.callbackId);
   if(plugin==='SparkBle'&&method==='startScan'&&opts.includeUnnamed){
    hooks.scans.push({...opts,at:performance.now()});hooks.events.push({kind:'scan',id:opts.scanId,at:performance.now()});
    const devices=mockBle.devices;mockBle.devices=[];try{return await previous(plugin,method,opts);}finally{mockBle.devices=devices;}
   }
   if(plugin==='SparkBle'&&method==='stopScan'){
    hooks.events.push({kind:'stop-request',id:mockBle.scanId,at:performance.now()});
    if(hooks.holdStop){hooks.stopPending=true;await new Promise(resolve=>hooks.releaseStop=resolve);hooks.holdStop=false;}
    const result=await previous(plugin,method,opts);hooks.events.push({kind:'stop-done',id:mockBle.scanId,at:performance.now()});return result;
   }
   if(plugin==='SparkBle'&&method==='connect')hooks.events.push({kind:'connect',deviceId:opts.deviceId,id:opts.connectionId,boundDevice:opts.boundDevice,at:performance.now()});
   return previous(plugin,method,opts);
  };
  hooks.ad=(scanId,deviceId='FW-BOUND',name='')=>mockBle.emit('scanResult',{scanId,deviceId,name,advertisedName:name,rssi:deviceId==='FW-BOUND'?-99:-1});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'#home');await page.waitForFunction(()=>CardBluetooth?.firmware);
 await page.locator('#newProject').tap();await page.waitForFunction(()=>location.hash==='#editor'&&!CardPageTransition.busy);
 await page.locator('#xiaobaiFirmwareDialog').waitFor({state:'visible'});
 await page.waitForFunction(()=>CardBluetooth.firmware.snapshot().canUpgrade&&!CardBluetooth.firmware.snapshot().busy);
 const baseline=await page.evaluate(()=>scanHooks.added.map(x=>x.id));
 return{context,page,errors,baseline};
}
async function inspect(page){return page.evaluate(()=>({
 snapshot:(()=>{const s=CardBluetooth.firmware.snapshot();if(s.session.pkg){const p=s.session.pkg;s.session.pkg={version:p.version,imageSize:p.imageSize,imageSha256:p.imageSha256};}return s;})(),
 connection:CardBluetooth.ota.connectionState(),businessConnected:CardBluetooth.connected,cancelled:CardBluetooth.firmware.cancelled,
 scans:scanHooks.scans,events:scanHooks.events,added:scanHooks.added,removed:scanHooks.removed,
 connects:mockBle.calls.filter(c=>c.method==='connect'),ota:mockBle.otaCalls,c2:mockBle.c2,
 binding:JSON.parse(localStorage.getItem('xiaobai:ota:binding:v1')),trace:document.querySelector('.bt-trace')?.textContent
}));}
async function evidence(page,label){const s=await inspect(page);fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(s,null,2));return s;}
async function begin(page){await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>scanHooks.scans.length===1);return page.evaluate(()=>scanHooks.scans[0].scanId);}
async function settled(page){await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);}
async function removed(page,baseline){const s=await inspect(page);ok(s.added.filter(x=>!baseline.includes(x.id)).every(x=>s.removed.includes(x.id)),'temporary scan listeners removed');}
async function unchangedAfterLate(page,id){const before=await inspect(page);await page.evaluate(id=>{scanHooks.ad(id);mockBle.emit('scanStopped',{scanId:id,reason:'finished'});},id);await page.waitForTimeout(80);const after=await inspect(page);eq(after.connects.length,before.connects.length,'late event cannot connect');eq(after.ota.length,before.ota.length,'late event cannot send OTA');}
async function freshExactBlank(browser){
 const{context,page,errors,baseline}=await create(browser);
 try{
  const first=await begin(page),start=await inspect(page);eq(start.connects.length,0);eq(start.scans[0].includeUnnamed,true);eq(start.ota.length,0);
  await page.evaluate(id=>{scanHooks.ad('old-scan','FW-BOUND','Spark_AI');scanHooks.ad(id,'OTHER','Spark_AI');},first);await page.waitForTimeout(80);
  eq((await inspect(page)).connects.length,0,'old scan ID and stronger wrong MAC do not connect');
  await page.evaluate(id=>{scanHooks.holdStop=true;scanHooks.ad(id,'FW-BOUND','');},first);await page.waitForFunction(()=>scanHooks.stopPending);
  eq((await inspect(page)).connects.length,0,'matching advertisement still waits for stopScan completion');
  await page.evaluate(()=>scanHooks.releaseStop());await page.waitForFunction(()=>scanHooks.scans.length===2);
  const second=await page.evaluate(()=>scanHooks.scans[1].scanId);ok(first!==second,'every existing reconnect requires a fresh scan ID');
  eq((await inspect(page)).connects.length,1,'App probe occurs only after its matching scan');
  await page.evaluate(({first,second})=>{scanHooks.ad(first);scanHooks.ad(second,'OTHER','Spark_AI');}, {first,second});await page.waitForTimeout(80);
  eq((await inspect(page)).connects.length,1,'retired App scan cannot open Boot channel');
  await page.evaluate(id=>scanHooks.ad(id,'FW-BOUND',''),second);await page.waitForFunction(()=>mockBle.dataRequests>0);
  const s=await evidence(page,'fresh-exact-blank-success');eq(s.connects.length,2);ok(s.connects.every(c=>c.deviceId==='FW-BOUND'&&c.boundDevice),'original bound MAC only');
  eq(s.ota.filter(x=>x.op===0x62).length,1);eq(s.businessConnected,false);eq(s.snapshot.ready,false);eq(s.binding.uid,'0102030405060708090a0b0c');
  for(let index=0;index<2;index++){const scan=s.scans[index],connect=s.events.filter(x=>x.kind==='connect')[index];ok(s.events.some(x=>x.kind==='stop-done'&&x.id===scan.scanId&&x.at<=connect.at),'scan stopped before native connect '+index);}
  await removed(page,baseline);await page.locator('.firmware-cancel').tap();await settled(page);eq(errors,[]);
 }catch(e){await evidence(page,'failure-'+currentCase);throw e;}finally{await context.close();}
}
async function abortScan(browser,kind){
 const{context,page,errors,baseline}=await create(browser);
 try{
  const id=await begin(page);
  if(kind==='cancel')await page.locator('.firmware-cancel').tap();
  else if(kind==='background')await page.evaluate(()=>nativeListeners.pause({}));
  else await page.evaluate(()=>location.hash='home');
  await settled(page);const s=await evidence(page,'scan-'+kind);eq(s.connects.length,0);eq(s.ota.length,0);eq(s.connection.phase,'idle');eq(s.cancelled,true);eq(s.binding.pending.imageSha256,target.imageSha256);
  ok(s.events.some(x=>x.kind==='stop-done'&&x.id===id),'cancelled scan stopped');await removed(page,baseline);await unchangedAfterLate(page,id);eq(errors,[]);
 }catch(e){await evidence(page,'failure-'+currentCase);throw e;}finally{await context.close();}
}
async function cancelled(browser){return abortScan(browser,'cancel');}
async function background(browser){return abortScan(browser,'background');}
async function leftProgram(browser){return abortScan(browser,'leave');}
async function endedScan(browser,kind){
 const{context,page,errors,baseline}=await create(browser);
 try{
  const id=await begin(page);
  await page.evaluate(()=>mockBle.emit('scanStopped',{scanId:'old-scan',reason:'finished'}));await page.waitForTimeout(50);eq(await page.evaluate(()=>CardBluetooth.firmware.snapshot().busy),true,'old scanStopped ignored');
  if(kind!=='local-timeout')await page.evaluate(({id,kind})=>mockBle.emit('scanStopped',{scanId:id,reason:kind==='timeout'?'finished':'failed'}),{id,kind});
  await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy,null,{timeout:15000});
  const s=await evidence(page,'scan-'+kind);eq(s.connects.length,0);eq(s.ota.length,0);eq(s.scans.length,1,'scan failure does not fall into another C2/Boot connection attempt');eq(s.snapshot.code,kind==='failed'?'SCAN_FAILED':'SCAN_TIMEOUT');eq(s.cancelled,false);eq(s.connection.phase,'idle');eq(s.binding.pending.imageSha256,target.imageSha256);
  if(kind==='local-timeout'){const stop=s.events.find(x=>x.kind==='stop-done'&&x.id===id);ok(stop.at-s.scans[0].at>=9900&&stop.at-s.scans[0].at<15000,'fallback scanner bound is ten seconds');}
  await removed(page,baseline);await unchangedAfterLate(page,id);eq(errors,[]);
 }catch(e){await evidence(page,'failure-'+currentCase);throw e;}finally{await context.close();}
}
async function timedOut(browser){return endedScan(browser,'timeout');}
async function scanFailed(browser){return endedScan(browser,'failed');}
async function localTimeout(browser){return endedScan(browser,'local-timeout');}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 try{for(const fn of [freshExactBlank,cancelled,background,leftProgram,timedOut,scanFailed,localTimeout]){currentCase=fn.name;try{await fn(browser);results.push({name:fn.name,passed:true});console.log('PASS OTA reconnect fresh scan '+fn.name);}catch(e){results.push({name:fn.name,passed:false,error:e.message});throw e;}}console.log(checks+' checks passed');}
 finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,results,boundary:'Real source adapter/Gate/Session/UI; only native scan events and promises synthetic. No hardware or APK build.'},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
