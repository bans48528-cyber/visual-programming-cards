const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const mockAndroid=require('./mock-android.cjs');
const BASE='http://127.0.0.1:4173/dist/';
async function makePage(browser,hash='editor'){
  const context=await browser.newContext({viewport:{width:892,height:412},hasTouch:true});
  await context.addInitScript(()=>{window.__XIAOBAI_BLE_TIMING={firstScanMs:80,defaultScanMs:180};});
  await context.addInitScript(mockAndroid);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${BASE}#${hash}`);await page.waitForFunction(()=>window.CardBluetooth);
  return {context,page,errors};
}
async function setDevices(page,devices,connectErrors={}){await page.evaluate(({devices,connectErrors})=>{mockBle.devices=devices;mockBle.connectErrors=connectErrors;},{devices,connectErrors});}
async function stopNative(page){await page.evaluate(async()=>{if(CardBluetooth.connected)await Capacitor.Plugins.SparkBle.disconnect({connectionId:mockBle.connectionId});});}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    // No default: scan for three-second-equivalent window, reject incompatible strongest, connect next strongest and save it.
    {
      const {context,page,errors}=await makePage(browser,'home');
      await setDevices(page,[
        {name:'Other BLE',deviceId:'BAD',rssi:-35},
        {name:'Xiaobai Weak',deviceId:'GOOD',rssi:-58},
        {name:'Xiaobai Far',deviceId:'FAR',rssi:-86}
      ],{BAD:'未找到 FFF0 / FFF1'});
      await page.evaluate(()=>location.hash='editor');
      await page.waitForFunction(()=>document.getElementById('bluetoothBtn').classList.contains('is-connecting'));
      await page.waitForFunction(()=>CardBluetooth.connected,null,{timeout:3000});
      await page.waitForFunction(()=>CardBluetooth.defaultDeviceId==='GOOD');
      assert.deepEqual(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='connect').map(c=>c.deviceId)),['BAD','GOOD']);
      assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'GOOD');
      assert.equal(await page.locator('#deviceStatus').getAttribute('data-state'),'stop');
      assert.ok(await page.locator('#bluetoothBtn').evaluate(el=>el.classList.contains('is-connected')));
      await page.evaluate(()=>mockBle.emit('scanResult',{scanId:mockBle.scanId,name:'Late Strong',deviceId:'LATE',rssi:-1}));
      await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='connect').length),2,'connected device must not be replaced');
      assert.deepEqual(errors,[]);await context.close();
    }
    // A default device restricts auto-connect. A stronger non-default result is ignored.
    {
      const {context,page,errors}=await makePage(browser,'bluetooth');
      await page.evaluate(()=>localStorage.setItem('xiaobaiDefaultDeviceV1','DEFAULT'));
      await setDevices(page,[{name:'Stronger',deviceId:'OTHER',rssi:-20},{name:'Remembered',deviceId:'DEFAULT',rssi:-70}]);
      await page.evaluate(()=>location.hash='editor');await page.waitForFunction(()=>CardBluetooth.connected);
      assert.deepEqual(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='connect').map(c=>c.deviceId)),['DEFAULT']);
      assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'DEFAULT');assert.deepEqual(errors,[]);await context.close();
    }
    // Missing default: wait to deadline, do not fall back to another device.
    {
      const {context,page,errors}=await makePage(browser,'bluetooth');
      await page.evaluate(()=>localStorage.setItem('xiaobaiDefaultDeviceV1','MISSING'));
      await setDevices(page,[{name:'Available',deviceId:'OTHER',rssi:-15}]);
      await page.evaluate(()=>location.hash='editor');
      await page.waitForFunction(()=>document.getElementById('executionNotice').textContent.includes('10 秒内未找到默认设备'));
      assert.equal(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='connect').length),0);
      assert.equal(await page.locator('#deviceStatus').getAttribute('data-state'),'disconnected');assert.deepEqual(errors,[]);await context.close();
    }
    // Manual selection cancels an automatic connect; its late success cannot replace the manual device.
    {
      const {context,page,errors}=await makePage(browser,'home');
      await setDevices(page,[{name:'Auto',deviceId:'AUTO',rssi:-30},{name:'Manual',deviceId:'MANUAL',rssi:-60}]);
      await page.evaluate(()=>{mockBle.connectionDelay=250;location.hash='editor';});
      await page.waitForFunction(()=>mockBle.calls.some(c=>c.method==='connect'&&c.deviceId==='AUTO'));
      await page.evaluate(()=>location.hash='bluetooth');await page.locator('[data-device-id=MANUAL] .bt-connect').click();
      await page.waitForFunction(()=>CardBluetooth.connected,null,{timeout:3000});
      await page.waitForFunction(()=>CardBluetooth.defaultDeviceId==='MANUAL');
      assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'MANUAL');
      assert.equal(await page.locator('.bt-current h2').textContent(),'Manual');
      await page.waitForTimeout(300);assert.equal(await page.locator('.bt-current h2').textContent(),'Manual');assert.deepEqual(errors,[]);await context.close();
    }
    // Failed manual choice keeps the old default.
    {
      const {context,page,errors}=await makePage(browser,'bluetooth');
      await page.evaluate(()=>localStorage.setItem('xiaobaiDefaultDeviceV1','OLD'));
      await setDevices(page,[{name:'Broken',deviceId:'BROKEN',rssi:-40}],{BROKEN:'连接失败'});
      await page.locator('.bt-search').click();await page.locator('[data-device-id=BROKEN]').waitFor();await page.locator('[data-device-id=BROKEN] .bt-connect').click();
      await page.waitForFunction(()=>document.querySelector('.bt-message').textContent.includes('连接 Broken 失败'));
      assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'OLD');assert.deepEqual(errors,[]);await context.close();
    }
    // Rename is local, shown in list/current status, independent from default, and survives reload.
    {
      const {context,page,errors}=await makePage(browser,'bluetooth');
      await setDevices(page,[{name:'Factory Name',deviceId:'RENAMED',rssi:-45}]);
      await page.locator('.bt-search').click();await page.locator('[data-device-id=RENAMED]').waitFor();await page.locator('[data-device-id=RENAMED] .bt-rename').click();
      await page.locator('.bt-rename-dialog input').fill('教室一号');await page.locator('.bt-rename-dialog button[value=confirm]').click();
      await page.waitForFunction(()=>document.querySelector('[data-device-id=RENAMED] strong').textContent.includes('教室一号'));
      assert.match(await page.locator('[data-device-id=RENAMED] strong').textContent(),/教室一号/);assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'');
      await page.reload();await page.waitForFunction(()=>window.CardBluetooth);await setDevices(page,[{name:'Factory Name',deviceId:'RENAMED',rssi:-45}]);
      await page.locator('.bt-search').click();await page.locator('[data-device-id=RENAMED]').waitFor();assert.match(await page.locator('[data-device-id=RENAMED] strong').textContent(),/教室一号/);
      await page.locator('[data-device-id=RENAMED] .bt-connect').click();await page.waitForFunction(()=>CardBluetooth.connected);assert.equal(await page.locator('.bt-current h2').textContent(),'教室一号');assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'RENAMED');
      assert.deepEqual(errors,[]);await context.close();
    }
    // Repeated entry points share one flow; remote entry also starts auto-connect.
    {
      const {context,page,errors}=await makePage(browser,'home');await setDevices(page,[{name:'Remote Device',deviceId:'REMOTE',rssi:-45}]);
      await page.locator('.home-remote-entry').click();await page.evaluate(()=>CardBluetooth.ensureConnected());await page.evaluate(()=>CardBluetooth.ensureConnected());
      await page.waitForFunction(()=>CardBluetooth.connected);assert.equal(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='startScan').length),1);
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log('PASS Android BLE auto/default/manual/rename: strongest compatible, default-only timeout, manual priority, late-result guard, failure preservation, persistence, single flow.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
