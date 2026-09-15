const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
// Requires the usual 4173 repository server. dist is the actual Android asset build.
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:892,height:412},hasTouch:true});
    await context.addInitScript(require('./mock-android.cjs'));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:4173/dist/#bluetooth');
    await page.waitForFunction(()=>!document.querySelector('.bt-search').disabled);
    assert.equal(await page.locator('.bt-top h1').textContent(),'手机蓝牙');
    assert.equal(await page.locator('.bt-content').count(),0,'No browser pairing page on Android');
    // A denied runtime permission must not start native scanning.
    await page.evaluate(()=>{mockBle.grantPermission=false;mockBle.state.permissionsGranted=false;});
    await page.locator('.bt-search').click();
    await page.waitForFunction(()=>document.querySelector('.bt-message').textContent.includes('权限未获允许'));
    assert.equal(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='startScan').length),0);
    await page.evaluate(()=>{mockBle.grantPermission=true;mockBle.state.bluetoothEnabled=false;});
    await page.locator('.bt-search').click();
    await page.waitForFunction(()=>document.querySelector('.bt-message').textContent.includes('未开启'));
    await page.locator('#btSystemSettings').click();
    assert.equal(await page.evaluate(()=>mockBle.calls.at(-1).target),'bluetooth');
    await page.evaluate(()=>{mockBle.state.bluetoothEnabled=true;mockBle.state.locationEnabled=false;});
    await page.locator('.bt-search').click();
    await page.waitForFunction(()=>document.querySelector('.bt-message').textContent.includes('系统定位'));
    await page.evaluate(()=>{
      mockBle.state.locationEnabled=true;
      mockBle.devices=[{name:'Spark_AI',deviceId:'AA:BB:CC:DD:EE:01',rssi:-49},{name:'Spark_AI',deviceId:'AA:BB:CC:DD:EE:02',rssi:-82}];
    });
    await page.locator('.bt-search').click();
    await page.locator('.bt-device').nth(1).waitFor();
    assert.equal(await page.locator('.bt-device').count(),2);
    const oldScan=await page.evaluate(()=>mockBle.scanId);
    await page.locator('.bt-search').click();
    await page.evaluate(id=>mockBle.emit('scanResult',{scanId:id,deviceId:'late',name:'Spark_AI',rssi:-10}),oldScan);
    assert.equal(await page.locator('[data-device-id=late]').count(),0);
    await page.locator('.bt-device .bt-button').first().click();
    await page.waitForFunction(()=>window.CardBluetooth.connected);
    assert.match(await page.locator('.bt-current p').textContent(),/已停止/);
    const sequence=await page.evaluate(()=>mockBle.calls.filter(c=>['connect','subscribe','write'].includes(c.method)).map(c=>c.method));
    assert.deepEqual(sequence,['connect','subscribe','write']);
    const oldConnection=await page.evaluate(()=>mockBle.connectionId);
    await page.evaluate(()=>mockBle.feed('{"WillAiState":"run"}'));
    assert.match(await page.locator('.bt-current p').textContent(),/运行中/);
    await page.waitForFunction(()=>document.getElementById('deviceStatus').dataset.state==='stale');
    await page.evaluate(()=>mockBle.feed('{"WillAiState":"stop"}'));
    fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});
    await page.screenshot({path:path.resolve(__dirname,'../artifacts/android-bluetooth-connected.png')});
    await page.locator('#btDisconnect').click();
    await page.waitForFunction(()=>!window.CardBluetooth.connected);
    await page.evaluate(id=>mockBle.feed('{"WillAiState":"run"}',id),oldConnection);
    assert.equal(await page.locator('#deviceStatus').getAttribute('data-state'),'disconnected');
    // Cancel an in-flight native connect; late success must be closed without D0.
    await page.evaluate(()=>{mockBle.connectionDelay=250;mockBle.calls=[];});
    await page.locator('.bt-device .bt-button').first().click();
    await page.waitForFunction(()=>mockBle.calls.some(c=>c.method==='connect'));
    await page.locator('#btDisconnect').click();
    await page.waitForFunction(()=>mockBle.calls.some(c=>c.method==='disconnect'));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>window.CardBluetooth.connected),false);
    assert.equal(await page.evaluate(()=>mockBle.calls.some(c=>c.method==='write')),false);
    // An actual disconnect event invalidates run/stop, including GATT failure.
    await page.evaluate(()=>{mockBle.connectionDelay=10;});
    await page.locator('.bt-device .bt-button').first().click();
    await page.waitForFunction(()=>window.CardBluetooth.connected);
    await page.evaluate(()=>mockBle.emit('disconnected',{connectionId:mockBle.connectionId,reason:'GATT 133'}));
    assert.equal(await page.evaluate(()=>window.CardBluetooth.connected),false);
    assert.match(await page.locator('.bt-message').textContent(),/GATT 133/);
    await page.locator('.bt-device .bt-button').first().click();
    await page.waitForFunction(()=>window.CardBluetooth.connected);
    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(()=>!window.CardBluetooth.connected);
    assert.equal(await page.locator('#deviceStatus').getAttribute('data-state'),'disconnected');
    const commands=await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='write').map(c=>atob(c.data).charCodeAt(4)));
    assert.ok(commands.length>0 && commands.every(cmd=>cmd===0xd0));
    assert.deepEqual(errors,[]);
    console.log('PASS Android BLE: permission/radio/location, scan/stop, RSSI list, subscribe-before-D0, fragmented status, stale status, cancel/late callback, disconnect/background');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
