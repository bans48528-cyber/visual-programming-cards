const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge'});try{
 for(const model of ['xiaobai','spark-ai']) for(const android of [false,true]){
  const c=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
  await c.addInitScript(id=>{localStorage.setItem('cardDefaultModelV1',id);window.__XIAOBAI_BLE_TIMING={firstScanMs:80,defaultScanMs:180};},model);
  if(android)await c.addInitScript(require('./mock-android.cjs'));
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4173/dist/#home');await p.getByRole('tab',{name:'遥控',exact:true}).click();
  await p.waitForFunction(()=>document.getElementById('remoteControl').open&&!CardPageTransition.busy);
  assert.equal(await p.locator('#remoteControl [data-remote-key]:disabled').count(),0);
  const point=async key=>{const r=await p.locator(`[data-remote-key=${key}]`).boundingBox();return {x:r.x+r.width/2,y:r.y+r.height/2};};
  for(const key of ['up','down','left','right','Y','A','X','B','L','R']){
   const at=await point(key);await p.mouse.move(at.x,at.y);await p.mouse.down();await p.waitForTimeout(key==='up'?650:240);
   assert.equal(await p.locator(`[data-remote-key=${key}]`).getAttribute('aria-pressed'),'true',`${android?'Android':'web'} ${key} stays pressed across refresh`);
   if(key==='up')assert.equal(await p.locator('#xb-dpad-demo .rocker.held').count(),1);
   if(key==='Y'&&!android&&model==='xiaobai')await p.screenshot({path:'artifacts/xiaobai-offline-press.png'});
   await p.mouse.up();assert.equal(await p.locator('#remoteControl [aria-pressed=true]').count(),0);
  }
  await p.locator('[data-remote-key=up]').focus();await p.keyboard.down('ArrowUp');await p.waitForTimeout(650);
  assert.equal(await p.locator('#xb-dpad-demo .rocker.held').count(),1);await p.keyboard.up('ArrowUp');assert.equal(await p.locator('#xb-dpad-demo .rocker.held').count(),0);
  const cdp=await c.newCDPSession(p),up={id:1,...await point('up')},yellow={id:2,...await point('Y')};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[up]});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[up,yellow]});
  assert.equal(await p.locator('#remoteControl [aria-pressed=true]').count(),2);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[yellow]});assert.equal(await p.locator('[data-remote-key=up]').getAttribute('aria-pressed'),'true');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await p.locator('#remoteControl [aria-pressed=true]').count(),0);
  if(android){
   assert.equal(await p.evaluate(()=>mockBle.calls.filter(c=>c.method==='write').length),0,'offline input never writes BLE');
   // Start a real mock connection while an offline key remains physically held.
   await p.evaluate(id=>{mockBle.devices=[{name:id==='spark-ai'?'Spark_AI':'Xiaobai',deviceId:'late-connect',rssi:-40}];return CardBluetooth.ensureConnected();},model);
   const at=await point('up');await p.mouse.move(at.x,at.y);await p.mouse.down();
   await p.waitForFunction(()=>document.querySelector('#remoteControl .remote-connection').classList.contains('is-connected'));
   await p.waitForTimeout(450);
   const moved=await point('right');await p.mouse.move(moved.x,moved.y);await p.waitForTimeout(150);
   assert.equal(await p.locator('#remoteControl [aria-pressed=true]').count(),0,'connection clears offline held input');
   assert.equal(await p.evaluate(()=>mockBle.calls.filter(c=>c.method==='write').some(c=>{const d=atob(c.data);return d.charCodeAt(4)===0xc1&&Array.from(d.slice(5,15)).some(x=>x.charCodeAt(0)!==0);})),false,'connection does not replay offline commands');
   await p.mouse.up();await p.mouse.move(at.x,at.y);await p.mouse.down();await p.waitForFunction(()=>mockBle.calls.some(c=>c.method==='write'&&atob(c.data).charCodeAt(4)===0xc1&&atob(c.data).charCodeAt(5)===1));await p.mouse.up();
  }
  await p.locator('#remoteControl .remote-back').click();await p.waitForFunction(()=>!CardPageTransition.busy);
  assert.deepEqual(errors,[]);await c.close();
 }
 console.log('PASS web and Android offline: ten key animations, long holds, keyboard, independent touch release, cancel; no BLE writes; reconnect clears held input; both Xiaobai and Spark AI.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
