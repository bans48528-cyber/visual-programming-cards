'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=process.env.XIAOBAI_APP_ROOT||path.resolve(__dirname,'..');
const mockAndroid=require(path.join(root,'tests/mock-android.cjs')),mockFirmware=require(path.join(root,'tests/mock-firmware.cjs'));
const target=require(path.join(root,'assets/firmware/release.json')).firmware;
const base=process.env.XIAOBAI_OTA_UI_BASE||'http://127.0.0.1:4173/dist/';
const out=process.env.XIAOBAI_RECOVERY_UI_OUTPUT||path.join(root,'artifacts/recovery-connection-ui');
let checks=0,currentCase='';const results=[];
function ok(v,m){assert.ok(v,m);checks++;}function eq(a,b,m){assert.deepEqual(a,b,m);checks++;}
async function create(browser){
 const c=await browser.newContext({viewport:{width:751,height:360},hasTouch:true});
 await c.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
 await c.addInitScript(mockAndroid);
 await c.addInitScript(mockFirmware,{target,appAvailable:false,imageValid:false,holdDataAck:true,pending:{boardId:target.boardId,version:target.version,imageSize:target.imageSize,imageSha256:target.imageSha256}});
 await c.addInitScript(()=>{
  const bridge=Capacitor,previous=bridge.nativePromise.bind(bridge),emit=mockBle.emit.bind(mockBle);let count=0;
  window.recoveryUiHooks={info:[],blockInfo:true,rawConnecting:false,beginPending:false,calls:[],events:[],failAt:''};
  window.addEventListener('xiaobai-ota-connection-change',event=>recoveryUiHooks.events.push({...event.detail}));
  mockBle.emit=(name,data)=>{if(name==='otaNotification'&&recoveryUiHooks.blockInfo){recoveryUiHooks.info.push({name,data});return;}return emit(name,data);};
  recoveryUiHooks.emitNative=emit;
  recoveryUiHooks.releaseInfo=()=>{recoveryUiHooks.blockInfo=false;for(const e of recoveryUiHooks.info.splice(0))emit(e.name,e.data);};
  bridge.nativePromise=async(plugin,method,opts={})=>{
   recoveryUiHooks.calls.push({plugin,method,opts,at:performance.now()});
   if(plugin==='SparkBle'&&method==='connect'&&opts.boundDevice&&++count===2){recoveryUiHooks.rawConnecting=true;await new Promise(r=>recoveryUiHooks.releaseConnect=r);if(recoveryUiHooks.failAt==='connect')throw Object.assign(new Error('mock native connect failure'),{code:'DISCONNECTED'});}
   if(plugin==='SparkBle'&&method==='beginOta'){recoveryUiHooks.beginPending=true;await new Promise(r=>recoveryUiHooks.releaseBegin=r);if(recoveryUiHooks.failAt==='begin')throw Object.assign(new Error('mock native begin failure'),{code:'DISCONNECTED'});}
   return previous(plugin,method,opts);
  };
 });
 const page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'#home');await page.waitForFunction(()=>CardBluetooth?.firmware);
 await page.locator('#newProject').tap();await page.waitForFunction(()=>location.hash==='#editor'&&!CardPageTransition.busy);await page.locator('#xiaobaiFirmwareDialog').waitFor({state:'visible'});
 await page.waitForFunction(()=>CardBluetooth.firmware.snapshot().canUpgrade&&!CardBluetooth.firmware.snapshot().busy);
 return{c,page,errors};
}
async function inspect(page){return page.evaluate(()=>({connection:CardBluetooth.ota.connectionState(),businessConnected:CardBluetooth.connected,identity:CardBluetooth.ota.identity(),ready:CardBluetooth.firmware.snapshot().ready,phase:CardBluetooth.firmware.snapshot().phase,bootInfoEpoch:CardBluetooth.firmware.snapshot().session.bootInfoEpoch,text:document.querySelector('.firmware-connection').textContent,status:document.getElementById('deviceStatus').textContent,begin:mockBle.otaCalls.filter(c=>c.op===0x62).length,rawWrites:mockBle.otaCalls.length,binding:JSON.parse(localStorage.getItem('xiaobai:ota:binding:v1'))}));}
async function diagnostic(page,label){
 const value=await page.evaluate(()=>({snapshot:CardBluetooth?.firmware?.snapshot(),cancelled:CardBluetooth?.firmware?.cancelled,connection:CardBluetooth?.ota?.connectionState(),calls:mockBle?.calls,ota:mockBle?.otaCalls,c2:mockBle?.c2,hooks:{rawConnecting:recoveryUiHooks?.rawConnecting,beginPending:recoveryUiHooks?.beginPending,info:recoveryUiHooks?.info,calls:recoveryUiHooks?.calls},trace:document.querySelector('.bt-trace')?.textContent,dialog:{open:document.getElementById('xiaobaiFirmwareDialog')?.open,text:document.querySelector('.firmware-connection')?.textContent,message:document.getElementById('firmwareMessage')?.textContent}}));
 if(value.snapshot?.session?.pkg){const p=value.snapshot.session.pkg;value.snapshot.session.pkg={version:p.version,imageSize:p.imageSize,imageSha256:p.imageSha256};}
 fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(value,null,2));
 console.log(JSON.stringify({diagnostic:label,connection:value.connection,phase:value.snapshot?.phase,message:value.snapshot?.message,sessionPhase:value.snapshot?.session?.phase,cancelled:value.cancelled,hookCalls:value.hooks.calls,calls:value.calls},null,2));
}
async function stages(browser){
 const{c,page,errors}=await create(browser);
 try{
  eq(await page.locator('.firmware-confirm').textContent(),'连接并恢复','explicit action label');
  const pending=await inspect(page);eq(pending.connection.phase,'idle');ok(pending.text.includes('尚未建立'));eq(pending.rawWrites,0,'no Boot request before confirmation');
  await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>recoveryUiHooks.rawConnecting,null,{timeout:15000});
  const connecting=await inspect(page);eq(connecting.connection.phase,'connecting');ok(connecting.text.includes('正在连接'));eq(connecting.businessConnected,false);eq(connecting.ready,false);eq(connecting.connection.deviceId,'FW-BOUND');ok(connecting.connection.epoch,'connecting carries its native epoch');
  ok(await page.evaluate(()=>Object.isFrozen(CardBluetooth.ota.connectionState())),'connection DTO is immutable');
  await page.evaluate(()=>recoveryUiHooks.releaseConnect());await page.waitForFunction(()=>recoveryUiHooks.beginPending);
  eq((await inspect(page)).connection.phase,'connecting','subscribe alone is not raw ready');
  await page.evaluate(()=>recoveryUiHooks.releaseBegin());await page.waitForFunction(()=>recoveryUiHooks.info.length>0);
  const connected=await inspect(page);eq(connected.connection.phase,'connected');ok(connected.text.includes('升级通道已连接'));eq(connected.businessConnected,false);eq(connected.identity,null);eq(connected.begin,0,'no BEGIN before real INFO');eq(connected.ready,false);eq(await page.evaluate(()=>CardBluetooth.ota.raw().connectionId),connected.connection.epoch,'raw transport exposes exact epoch');
  eq(await page.evaluate(()=>Reflect.set(CardBluetooth.ota.raw(),'connectionId','tampered')),false,'raw connectionId has no setter');
  eq(await page.evaluate(()=>recoveryUiHooks.events.map(e=>e.phase)),['connecting','connected'],'native phases emit in order');
  await page.evaluate(()=>mockBle.emit('disconnected',{connectionId:'old-disposed-epoch',reason:'late old'}));
    eq((await inspect(page)).connection.epoch,connected.connection.epoch,'old loss cannot change display');
  await page.evaluate(()=>{for(const event of recoveryUiHooks.info)recoveryUiHooks.emitNative(event.name,{...event.data,connectionId:'old-disposed-epoch'});});
  eq((await inspect(page)).begin,0,'old-epoch INFO cannot reach BEGIN');eq((await inspect(page)).bootInfoEpoch,null,'old INFO is not verified');
  await page.evaluate(()=>recoveryUiHooks.releaseInfo());await page.waitForFunction(()=>mockBle.dataRequests>0);
  const verified=await inspect(page);eq(verified.bootInfoEpoch,verified.connection.epoch);eq(verified.text,'已读取引导状态');ok(verified.status.includes('引导状态'));eq(verified.businessConnected,false);eq(verified.ready,false);eq(verified.begin,1,'one prior confirmation retains one BEGIN');
  for(const size of [{width:751,height:360},{width:568,height:280}]){
   await page.setViewportSize(size);const fit=await page.locator('#xiaobaiFirmwareDialog').evaluate(el=>{const r=el.getBoundingClientRect(),content=el.querySelector('.firmware-content');return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,scroll:content.scrollWidth,client:content.clientWidth};});
   ok(fit.x>=0&&fit.y>=0&&fit.right<=size.width+1&&fit.bottom<=size.height+1,'dialog fits '+size.width);ok(fit.scroll<=fit.client+1,'no horizontal overflow');
   await page.screenshot({path:path.join(out,'read-state-'+size.width+'x'+size.height+'.png')});
  }
  await page.evaluate(()=>mockBle.dropConnection('real native loss'));await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);
  const failed=await inspect(page);eq(failed.connection.phase,'idle');eq(failed.phase,'recovery');ok(failed.text.includes('尚未建立'));eq(failed.binding.uid,'0102030405060708090a0b0c');eq(failed.binding.pending.imageSha256,target.imageSha256);eq(failed.begin,1);
  await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>!document.getElementById('xiaobaiFirmwareDialog').open);eq((await inspect(page)).connection.phase,'idle');eq(errors,[]);
 }catch(e){await diagnostic(page,'failure-'+(currentCase||'unknown'));throw e;}finally{await c.close();}
}
async function cancelConnecting(browser){
 const{c,page,errors}=await create(browser);
 try{
  await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>recoveryUiHooks.rawConnecting,null,{timeout:15000});
  await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>CardBluetooth.ota.connectionState().phase==='idle');
  await page.evaluate(()=>recoveryUiHooks.releaseConnect());await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);
  const s=await inspect(page);eq(s.connection.phase,'idle');eq(s.begin,0);eq(s.businessConnected,false);eq(s.ready,false);eq(errors,[]);
 }catch(e){await diagnostic(page,'failure-'+(currentCase||'unknown'));throw e;}finally{await c.close();}
}

async function cancelAtStage(browser,stage){
 const{c,page,errors}=await create(browser);
 try{
  await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>recoveryUiHooks.rawConnecting);
  await page.evaluate(()=>recoveryUiHooks.releaseConnect());await page.waitForFunction(()=>recoveryUiHooks.beginPending);
  if(stage==='info'){await page.evaluate(()=>recoveryUiHooks.releaseBegin());await page.waitForFunction(()=>recoveryUiHooks.info.length>0);eq((await inspect(page)).connection.phase,'connected');}
  else eq((await inspect(page)).connection.phase,'connecting');
  await page.locator('.firmware-cancel').tap();await page.waitForFunction(()=>CardBluetooth.ota.connectionState().phase==='idle');
  if(stage==='begin')await page.evaluate(()=>recoveryUiHooks.releaseBegin());else await page.evaluate(()=>recoveryUiHooks.releaseInfo());
  await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);
  const s=await inspect(page);eq(s.connection.phase,'idle');eq(s.begin,0,'cancel before valid INFO cannot send BEGIN');eq(s.businessConnected,false);eq(s.ready,false);eq(s.binding.pending.imageSha256,target.imageSha256);eq(errors,[]);
 }catch(e){await diagnostic(page,'failure-'+currentCase);throw e;}finally{await c.close();}
}
async function cancelBegin(browser){return cancelAtStage(browser,'begin');}
async function cancelInfo(browser){return cancelAtStage(browser,'info');}
async function failAtStage(browser,stage){
 const{c,page,errors}=await create(browser);
 try{
  await page.evaluate(stage=>recoveryUiHooks.failAt=stage,stage);
  await page.locator('.firmware-confirm').tap();await page.waitForFunction(()=>recoveryUiHooks.rawConnecting);
  await page.evaluate(()=>recoveryUiHooks.releaseConnect());
  if(stage==='begin'){await page.waitForFunction(()=>recoveryUiHooks.beginPending);await page.evaluate(()=>recoveryUiHooks.releaseBegin());}
  await page.waitForFunction(()=>!CardBluetooth.firmware.snapshot().busy);
  const s=await inspect(page);eq(s.connection.phase,'idle');eq(s.phase,'recovery');eq(s.begin,0);eq(s.businessConnected,false);eq(s.ready,false);eq(s.binding.pending.imageSha256,target.imageSha256);eq(await page.evaluate(()=>CardBluetooth.firmware.cancelled),false,'native failure is not cancellation');eq(errors,[]);
 }catch(e){await diagnostic(page,'failure-'+currentCase);throw e;}finally{await c.close();}
}
async function failedConnect(browser){return failAtStage(browser,'connect');}
async function failedBegin(browser){return failAtStage(browser,'begin');}

(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});try{for(const fn of [stages,cancelConnecting,cancelBegin,cancelInfo,failedConnect,failedBegin]){currentCase=fn.name;try{await fn(browser);}catch(error){results.push({name:fn.name,passed:false,error:error.message});throw error;}results.push({name:fn.name,passed:true});console.log('PASS recovery connection UI '+fn.name);}console.log(checks+' checks passed');}finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,results,boundary:'Production source UI, adapter, Gate and Session; only native BLE held at actual Promise/notification boundaries. No APK build or hardware.'},null,2));await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
