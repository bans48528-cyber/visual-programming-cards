const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge'});
 try{
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
  await context.addInitScript(()=>{localStorage.setItem('cardDefaultModelV1','spark-ai');window.__XIAOBAI_BLE_TIMING={firstScanMs:80,defaultScanMs:180};});
  await context.addInitScript(require('./mock-android.cjs'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/dist/#home');
  assert.equal(await page.locator('.home-model-entry strong').textContent(),'Spark AI');
  await page.evaluate(()=>{mockBle.devices=[{name:'Spark_AI',deviceId:'spark-one',rssi:-40},{name:'K_motor',deviceId:'wrong',rssi:-20}];});
  await page.locator('#newProject').click();await page.waitForFunction(()=>CardBluetooth.connected);
  assert.equal(await page.evaluate(()=>mockBle.calls.find(c=>c.method==='connect').profile),'spark-ai');
  assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'spark-one');
  assert.equal(await page.locator('.tabs [role=tab]').count(),6);
  await page.locator('#tab-logic').click();await page.locator('#palette [data-card-id=wait-time]').click();
  await page.locator('#runProgramBtn').click();await page.waitForFunction(()=>CardBluetooth.executionPhase==='running');
  assert.equal(await page.evaluate(()=>mockCompilerSource),'_os.sleep_s(1)\n');
  assert.equal(await page.locator('#runProgramBtn').isDisabled(),true);
  assert.equal(await page.locator('.program-block.is-executing').count(),0);
  const commands=await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='write').map(c=>atob(c.data).charCodeAt(4)));
  assert.ok(commands.includes(0xda)&&commands.includes(0xbc));assert.ok(!commands.includes(0xc2));
  await page.locator('#pauseProgramBtn').click();await page.waitForFunction(()=>!CardBluetooth.busy);
  assert.match(await page.locator('#executionNotice').textContent(),/停止/);
  for(const category of ['motor','combo','sensor','logic','light']){
    await page.locator('#tab-'+category).click();await page.waitForTimeout(220);
    assert.deepEqual(await page.locator('#palette img').evaluateAll(images=>images.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src)),[]);
  }
  await page.locator('#tab-logic').click();await page.waitForTimeout(220);
  await page.screenshot({path:'artifacts/spark-ai-editor.png'});
  await page.evaluate(()=>CardModelSession.current.remote.open());await page.waitForFunction(()=>!document.querySelector('[data-remote-key=A]').disabled);
  const aButton=await page.locator('[data-remote-key=A]').boundingBox();await page.mouse.move(aButton.x+aButton.width/2,aButton.y+aButton.height/2);await page.mouse.down();await page.waitForTimeout(60);
  const c1=await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='write').map(c=>Array.from(atob(c.data),x=>x.charCodeAt(0))).filter(b=>b[4]===0xc1&&b[9]===1));assert.ok(c1.length>0);assert.equal(c1.at(-1)[10],0);
  await page.mouse.up();await page.locator('#remoteControl .remote-back').click();

  // Stale native compiler result must not send after a model switch.
  await page.evaluate(()=>{const original=Capacitor.nativePromise;window.compilerOriginal=original;Capacitor.nativePromise=async function(plugin,method,options){if(plugin==='CardCompiler'&&method==='compile')return new Promise(r=>window.finishLateCompiler=()=>r({bytecode:btoa('\x0fpyo'+'\0'.repeat(12)),bytes:16}));return original.call(this,plugin,method,options);};});
  await page.locator('#runProgramBtn').click();await page.waitForFunction(()=>window.finishLateCompiler);
  const uploadsBefore=await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='prepareUpload').length);
  await page.evaluate(()=>CardModelSession.select('xiaobai'));
  await page.evaluate(()=>finishLateCompiler());await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='prepareUpload').length),uploadsBefore);
  assert.equal(await page.evaluate(()=>CardModelSession.current.id),'xiaobai');
  assert.equal(await page.locator('#tab-dynamic').count(),1);
  await page.evaluate(()=>CardModelSession.select('spark-ai'));
  assert.equal(await page.evaluate(()=>DeviceModels.createStore(localStorage,'spark-ai').read()[0].state.program[0].id),'wait-time');
  await page.reload();assert.equal(await page.locator('.home-model-entry strong').textContent(),'Spark AI');
  await page.locator('.home-model-entry').click();await page.waitForFunction(()=>[...document.querySelectorAll('.model-picker img')].every(i=>i.complete&&i.naturalWidth>0));await page.screenshot({path:'artifacts/spark-ai-picker.png'});
  assert.equal(await page.locator('.model-card').count(),5);
  const bounds=await page.locator('.model-card').evaluateAll(nodes=>nodes.slice(0,3).map(n=>{const b=n.getBoundingClientRect();return {left:b.left,right:b.right};}));assert.ok(bounds.every(b=>b.left>=0&&b.right<=844));
  assert.deepEqual(errors,[]);
  console.log('PASS Spark AI Android UI: model/catalog, auto-connect profile/filter, compile/upload/run report, stop, no false block highlight, cancelled compile after switching, isolated draft and restart.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
