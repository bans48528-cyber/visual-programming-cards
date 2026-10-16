const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge'});
 try {
  const context=await browser.newContext({viewport:{width:892,height:412},hasTouch:true});
    await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
  await context.addInitScript(require('./mock-android.cjs'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/dist/#bluetooth');
  await page.waitForFunction(()=>!document.querySelector('.bt-search').disabled);
  const sameBluetoothState=async(expected)=>{
   await page.waitForFunction(state=>{
    const source=document.getElementById('bluetoothBtn');
    return (!state||source.classList.contains(state))&&[...document.querySelectorAll('.remote-connect')].every(button=>
     button.querySelector('.bluetooth-icon')&&button.textContent===''&&
     ['is-connected','is-connecting'].every(c=>button.classList.contains(c)===source.classList.contains(c))&&
     button.getAttribute('aria-label')===source.getAttribute('aria-label'));
   },expected);
  };
  await sameBluetoothState();
  await page.evaluate(()=>{mockBle.devices=[{name:'Spark_AI',deviceId:'AA:BB:CC:DD:EE:01',rssi:-45}];});
  await page.locator('.bt-search').click();await sameBluetoothState('is-connecting');
  await page.locator('.bt-device .bt-connect').click();
  await page.waitForFunction(()=>CardBluetooth.connected);
  await sameBluetoothState('is-connected');
  await page.locator('.bt-back').click();await page.evaluate(()=>CardRemote.open());
  await page.waitForFunction(()=>document.querySelector('#remoteControl .remote-connection').classList.contains('is-connected'));
  await page.waitForFunction(()=>!CardPageTransition.busy);
  await sameBluetoothState('is-connected');
  const appearance=await page.evaluate(()=>{
   const style=button=>{const s=getComputedStyle(button);return [s.width,s.height,s.borderRadius,s.color,s.backgroundColor,s.boxShadow];};
   return [style(document.getElementById('bluetoothBtn')),style(document.querySelector('#remoteControl .remote-connect'))];
  });
  assert.deepEqual(appearance[1],appearance[0],'remote Bluetooth uses the editor appearance');
  assert.equal(await page.locator('.remote-middle,.remote-release').count(),0);
  const cdp=await context.newCDPSession(page);
  const point=async(key,id)=>{const r=await page.locator(`[data-remote-key=${key}]`).boundingBox();return {id,x:r.x+r.width/2,y:r.y+r.height/2};};
  const up=await point('up',1),a=await point('Y',2);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[up]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[up,a]});
  await page.waitForFunction(()=>mockBle.calls.some(c=>c.method==='write'&&atob(c.data).charCodeAt(4)===193&&atob(c.data).charCodeAt(5)===1&&atob(c.data).charCodeAt(9)===1));
  assert.equal(await page.locator('.remote-dialog .is-pressed').count(),2);
  await page.screenshot({path:'artifacts/remote-multitouch.png'});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>{const c=mockBle.calls.filter(c=>c.method==='write').at(-1);return atob(c.data).slice(5,15)==='\0'.repeat(10);});
  const connectionBefore=await page.evaluate(()=>mockBle.connectionId);
  await page.locator('#remoteControl .remote-connect').click();
  await page.locator('.bluetooth-page:not([hidden]) .bt-back').click();
  await page.waitForFunction(()=>document.querySelector('#remoteControl').open&&document.querySelector('#remoteControl .remote-connection').classList.contains('is-connected'));
  assert.equal(await page.evaluate(()=>mockBle.connectionId),connectionBefore,'Bluetooth return retains the current connection');
  assert.equal(await page.locator('.remote-dialog .is-pressed').count(),0,'return never resumes old held buttons');
  await page.locator('[data-remote-key=L]').focus();await page.keyboard.down('KeyL');await page.keyboard.down('KeyX');
  assert.equal(await page.locator('.remote-dialog .is-pressed').count(),2);
  await page.keyboard.up('KeyL');await page.keyboard.up('KeyX');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[up]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  assert.equal(await page.locator('.remote-dialog .is-pressed').count(),0);
  await page.evaluate(()=>window.nativeListeners.backButton());
  await page.waitForFunction(()=>!document.getElementById('remoteControl').open);
  await page.waitForTimeout(100);const count=await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='write'&&atob(c.data).charCodeAt(4)===0xc1).length);
  await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='write'&&atob(c.data).charCodeAt(4)===0xc1).length),count);
  await page.evaluate(()=>CardRemote.open());
  await page.waitForFunction(()=>document.querySelector('#remoteControl .remote-connection').classList.contains('is-connected')&&!CardPageTransition.busy);
  await page.evaluate(()=>{mockBle.writeError='测试发送失败';});
  await page.locator('[data-remote-key=up]').click();
  await page.waitForFunction(()=>document.querySelector('.remote-connection').textContent==='测试发送失败');
  assert.equal(await page.locator('[data-remote-key=up]').isDisabled(),false,'Xiaobai keeps local press feedback after send failure');
  await page.evaluate(()=>mockBle.emit('disconnected',{connectionId:mockBle.connectionId,reason:'test disconnect'}));
  await page.waitForFunction(()=>!document.getElementById('bluetoothBtn').classList.contains('is-connected'));
  await sameBluetoothState();
  await page.waitForFunction(()=>!CardBluetooth.connected);
  assert.equal(await page.locator('.remote-dialog .is-pressed').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS remote UI + BLE bridge: multitouch C1, release, keyboard, pointer cancel, native back, no post-close writes, disconnect');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
