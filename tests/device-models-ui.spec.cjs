const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const mockAndroid=require('./mock-android.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// A test-only second model exercises extension points; never shipped in the app catalog.
function fixture(){
 const original=CardModels.get('xiaobai');
 CardModels.register({id:'fixture',name:'测试夹具',image:original.image,description:'仅测试使用',
  features:[original.features[0]],catalog:{logic:{label:'逻辑',color:'var(--logic)',cards:[{...original.catalog.logic.cards[0],paramsSchema:{duration:{label:'时间',type:'number',default:2,min:1,max:2,step:1}}}]}},
  examples:[],bluetooth:{create:()=>({connected:false,remoteConnection:()=>({id:'fixture-connection',stopProgram:async()=>{}}),dispose:async()=>{window.fixtureDisposed=true;}})},
  execution:{kind:'compiled',validate:p=>JSON.parse(JSON.stringify(p)),compile:()=>new Promise(r=>window.finishFixtureCompile=r),sendProgram:async()=>{window.fixtureSent=true;}}
 });
}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:844,height:390},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/');
  assert.equal(await page.locator('.model-picker').isVisible(),true);assert.equal(await page.locator('.model-card').count(),5);assert.equal(await page.locator('[data-model-id=xiaobai] strong').textContent(),'小白');
  await page.keyboard.press('Escape');assert.equal(await page.locator('.model-picker').isVisible(),true);
  assert.equal(await page.locator('.model-cancel').isVisible(),false);
  await page.screenshot({path:'artifacts/model-picker-preview.png'});
  await page.locator('[data-model-id=xiaobai]').click();assert.equal(await page.locator('.home-screen').isVisible(),true);
  await page.reload();assert.equal(await page.locator('.model-picker').isVisible(),false);
  const navBounds=await page.locator('.home-nav').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {top:b.top,bottom:b.bottom,height:b.height};}));
  assert.ok(navBounds.every(b=>b.top>=0&&b.bottom<=390&&b.height>=44));
  await page.locator('.home-model-entry').click();await page.locator('.model-cancel').click();assert.equal(await page.evaluate(()=>localStorage.getItem('cardDefaultModelV1')),'xiaobai');
  await page.screenshot({path:'artifacts/model-home-preview.png'});
  await page.evaluate(fixture);
  await page.locator('#newProject').click();await page.locator('#saveBtn').click();assert.equal(await page.locator('.home-dialog').isVisible(),false);
  await page.locator('#palette [data-card-id=motor-forward]').click();await page.locator('#homeBtn').click();
  const old=await page.evaluate(()=>JSON.parse(localStorage.getItem('cardModel:xiaobai:projects:v1')));assert.equal(old.length,1);assert.equal(old[0].needsName,true);assert.equal(old[0].modelId,'xiaobai');
  await page.locator('.home-model-entry').click();await page.locator('[data-model-id=fixture]').click();
  assert.equal(await page.locator('.home-card').count(),0);assert.equal(await page.locator('.home-nav').count(),2);assert.equal(await page.locator('.home-model-entry strong').textContent(),'测试夹具');
  await page.locator('#newProject').click();assert.equal(await page.locator('#palette [data-card-id]').count(),1);await page.locator('#palette [data-card-id=wait-time]').click();
  assert.equal(await page.evaluate(()=>program[0].params.duration),2);
  await page.locator('#runProgramBtn').click();await page.waitForFunction(()=>window.finishFixtureCompile);
  await page.evaluate(()=>CardModelSession.select('xiaobai'));
  const notice=await page.locator('#executionNotice').textContent();await page.evaluate(()=>finishFixtureCompile('late'));await sleep(50);
  assert.equal(await page.evaluate(()=>Boolean(window.fixtureSent)),false);assert.equal(await page.locator('#executionNotice').textContent(),notice);
  await page.locator('#resumeProject').click();assert.equal(await page.locator('#chain .program-block[data-card-id=motor-forward]').count(),1);
  await page.locator('#saveBtn').click();assert.equal(await page.locator('.home-dialog').isVisible(),true);await page.locator('.home-dialog [type=button]').click();
  await page.locator('#homeBtn').click();await page.locator('.home-model-entry').click();await page.locator('[data-model-id=fixture]').click();await page.locator('#resumeProject').click();assert.equal(await page.evaluate(()=>program[0].id),'wait-time');
  assert.deepEqual(errors,[]);await page.close();
  const migrated=await browser.newPage();await migrated.addInitScript(()=>{
    if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');
    localStorage.setItem('xiaobaiProjectsV1',JSON.stringify([{id:'old',name:'原来的作品',state:{program:[{id:'motor-forward',params:{port:'L/M1',duration:1}}],stagedGroups:[]}}]));
    localStorage.setItem('xiaobaiActiveProjectV1','old');localStorage.setItem('xiaobaiDefaultDeviceV1','OLD-BLE');localStorage.setItem('xiaobaiDeviceNamesV1',JSON.stringify({'OLD-BLE':'教室小白'}));
  });
  await migrated.goto('http://127.0.0.1:4173/');await migrated.locator('[data-model-id=xiaobai]').click();assert.equal(await migrated.getByRole('button',{name:'打开：原来的作品',exact:true}).count(),1);
  assert.equal(await migrated.evaluate(()=>XiaobaiDevicePreferences.create(localStorage,'xiaobai').getDefault()),'OLD-BLE');assert.equal(await migrated.evaluate(()=>XiaobaiDevicePreferences.create(localStorage).customName('OLD-BLE')),'教室小白');await migrated.close();
  const context=await browser.newContext({viewport:{width:844,height:390}});await context.addInitScript(mockAndroid);await context.addInitScript(()=>{localStorage.setItem('cardDefaultModelV1','xiaobai');window.__XIAOBAI_BLE_TIMING={firstScanMs:60,defaultScanMs:100};});
  const android=await context.newPage();const nativeErrors=[];android.on('pageerror',e=>nativeErrors.push(e.message));
  await android.goto('http://127.0.0.1:4173/dist/#home');await android.evaluate(fixture);
  await android.evaluate(()=>{mockBle.connectionDelay=700;mockBle.devices=[{name:'小白',deviceId:'LATE',rssi:-40}];});
  await android.locator('#newProject').click();await android.waitForFunction(()=>mockBle.calls.some(c=>c.method==='connect'));
  await android.evaluate(()=>CardModelSession.select('fixture'));await android.evaluate(()=>CardModelSession.select('xiaobai'));
  await sleep(850);assert.equal(await android.evaluate(()=>CardBluetooth.connected),false);assert.equal(await android.evaluate(()=>CardBluetooth.defaultDeviceId),'');
  assert.equal(await android.locator('.home-model-entry strong').textContent(),'小白');
  await android.evaluate(()=>{mockBle.emit('scanResult',{scanId:'retired-scan',deviceId:'GHOST',name:'旧设备',rssi:-10});});
  assert.equal(await android.locator('[data-device-id=GHOST]').count(),0);
  await android.evaluate(()=>{mockBle.connectionDelay=10;mockBle.devices=[{name:'小白',deviceId:'LIVE',rssi:-40}];location.hash='editor';});
  await android.waitForFunction(()=>CardBluetooth.connected);
  await android.evaluate(()=>{program=[{id:'combo-continuous',params:{direction:'advance'}},{id:'wait-time',params:{duration:30}}];renderProgram();commitHistory();document.getElementById('runProgramBtn').click();});
  await android.waitForFunction(()=>mockBle.calls.some(c=>c.method==='write'&&atob(c.data).charCodeAt(6)===0x21));
  const liveId=await android.evaluate(()=>CardBluetooth.remoteConnection().id);
  await android.evaluate(()=>CardModelSession.select('fixture'));
  assert.equal(await android.evaluate(()=>CardProgram.running),false);
  assert.equal(await android.evaluate(id=>mockBle.calls.some(c=>c.method==='disconnect'&&c.connectionId===id),liveId),true);
  assert.equal(await android.evaluate(()=>mockBle.calls.some(c=>c.method==='write'&&atob(c.data).charCodeAt(6)===XiaobaiProtocol.OP.STOP_PROGRAM)),true);
  const writes=await android.evaluate(()=>mockBle.calls.filter(c=>c.method==='write').length);await sleep(100);
  assert.equal(await android.evaluate(()=>mockBle.calls.filter(c=>c.method==='write').length),writes);
  assert.deepEqual(nativeErrors,[]);await context.close();
  console.log('PASS model UI: first choice, restart, cancel, landscape targets, model catalogs/parameters, draft isolation, deferred naming, migration, late compile and native connect results.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

