const {chromium}=require('playwright'),assert=require('node:assert/strict');
const mock=require('./mock-android.cjs');
const BASE='http://127.0.0.1:4173/dist/';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
  await context.addInitScript(mock);
  await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+'#bluetooth');await page.waitForFunction(()=>window.CardBluetooth);
  await page.evaluate(()=>{mockBle.devices=Array.from({length:8},(_,i)=>({deviceId:'DEV'+i,name:'Xiaobai '+i,rssi:-40-i*7}));});
  await page.locator('.bt-search').click();await page.locator('[data-device-id=DEV7]').waitFor();
  await page.locator('.bt-search').click();
  for(const size of [{width:844,height:390},{width:667,height:320},{width:568,height:280},{width:320,height:640}]){
   await page.setViewportSize(size);
   const bounds=await page.locator('.bt-landscape').evaluate(el=>{
    const panel=el.querySelector('.bt-results'),art=el.querySelector('.bt-product-art').getBoundingClientRect(),img=el.querySelector('.bt-product-art img').getBoundingClientRect();
    return {width:el.scrollWidth,viewport:innerWidth,scrolls:panel.scrollHeight>panel.clientHeight,artBottom:art.bottom,imgBottom:img.bottom,nameTop:el.querySelector('.bt-model-name').getBoundingClientRect().top,clip:getComputedStyle(el.querySelector('.bt-product-art')).overflow,backHit:el.querySelector('.bt-back').contains(document.elementFromPoint(38,27))};
   });
   assert.ok(bounds.width<=bounds.viewport,'no horizontal overflow');assert.equal(bounds.clip,'hidden','artwork stays within its panel');if(size.width>540)assert.ok(bounds.artBottom<=bounds.nameTop,'artwork does not cover model name');assert.ok(bounds.backHit,'return control is reachable');
   if(size.width>540)assert.ok(bounds.scrolls,'only device results scroll in landscape');
  }
  await page.setViewportSize({width:844,height:390});
  await page.locator('[data-device-id=DEV0] .bt-rename').click();await page.locator('.bt-rename-dialog input').fill('教室小白');await page.locator('.bt-rename-dialog [value=confirm]').click();
  await page.waitForFunction(()=>document.querySelector('[data-device-id=DEV0] strong').textContent.includes('教室小白'));
  await page.locator('[data-device-id=DEV0] .bt-rename').click();await page.locator('.bt-rename-dialog input').fill('不应保存');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('.bt-rename-dialog').open);
  assert.match(await page.locator('[data-device-id=DEV0] strong').textContent(),/教室小白/,'cancel after an earlier save must not rename');
  await page.evaluate(()=>{mockBle.connectionDelay=800;});
  await page.locator('[data-device-id=DEV0] .bt-connect').click();await page.locator('#btDisconnect').click();await page.waitForTimeout(900);
  assert.equal(await page.evaluate(()=>CardBluetooth.connected),false,'late cancelled connection cannot reconnect');
  await page.evaluate(()=>{mockBle.connectionDelay=15;});await page.locator('[data-device-id=DEV0] .bt-connect').click();await page.waitForFunction(()=>CardBluetooth.connected);
  assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'DEV0');assert.equal(await page.locator('.bt-hero-state span').textContent(),'已连接');
  assert.equal(await page.locator('.bt-current h2').textContent(),'教室小白');
  assert.equal(await page.locator('[data-device-id=DEV1] .bt-connect').isDisabled(),true,'connected device is not replaced implicitly');
  await page.screenshot({path:'artifacts/bluetooth-landscape-connected.png'});
  await page.locator('#btDisconnect').click();await page.waitForFunction(()=>!CardBluetooth.connected);
  await page.locator('.bt-phone-state').click();await page.locator('#btSystemSettings').click();
  assert.ok(await page.evaluate(()=>mockBle.calls.some(c=>c.method==='openSettings'&&c.target==='bluetooth')));
  await page.locator('.bt-settings-dialog .bt-sheet-close').click();
  await page.evaluate(()=>{mockBle.state.bluetoothEnabled=false;mockBle.emit('adapterState',mockBle.state);});
  assert.match(await page.locator('#btReadySummary').textContent(),/开启手机蓝牙/);
  await page.locator('.bt-help').click();await page.locator('.bt-help-settings').click();assert.equal(await page.locator('.bt-settings-dialog').evaluate(e=>e.open),true);
  await page.evaluate(()=>location.hash='home');await page.waitForFunction(()=>!document.querySelector('.bt-settings-dialog').open);
  assert.deepEqual(errors,[]);await context.close();
  {
   const c=await browser.newContext({viewport:{width:844,height:390}});await c.addInitScript(mock);await c.addInitScript(require('./mock-lbs2206.cjs'));
   await c.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','lbs2206'));
   const p=await c.newPage();await p.goto(BASE+'#bluetooth');await p.waitForFunction(()=>window.CardBluetooth);
   await p.evaluate(()=>{mockBle.devices=[{deviceId:'LBS',name:'K_motor',rssi:-40}];mockBle.connectionDelay=700;});
   await p.locator('.lbs-scan').click();await p.locator('[data-device-id=LBS] .bt-connect').click();
   await p.locator('.lbs-disconnect').click();await p.waitForTimeout(800);
   assert.equal(await p.evaluate(()=>CardBluetooth.connected),false,'LBS pending cancel ignores late success');
   assert.equal(await p.locator('.bt-current').isVisible(),false);assert.equal(await p.locator('.bt-diagnostics').count(),0);
   await c.close();
  }
  // All browser previews use real model artwork and an honest empty state; no simulated devices ship.
  for(const model of ['xiaobai','lbs2206','spark-ai','tc01','receiver2226']){
   const c=await browser.newContext({viewport:{width:844,height:390}});await c.addInitScript(id=>localStorage.setItem('cardDefaultModelV1',id),model);
   const p=await c.newPage();await p.goto(BASE+'#bluetooth');await p.waitForFunction(()=>window.CardBluetooth);
   assert.equal(await p.locator('.bt-browser-preview .bt-search').isDisabled(),true,model);
   assert.equal(await p.locator('.bt-list .bt-device').count(),0,model);
   assert.ok(await p.locator('.bt-product-art img').evaluate(e=>e.complete&&e.naturalWidth>0),model+' artwork');
   await c.close();
  }
  console.log('PASS Bluetooth landscape: four viewport sizes, scroll containment, model images, scan/stop, rename, connect/cancel/late results, disconnect/default, settings/help and browser preview.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
