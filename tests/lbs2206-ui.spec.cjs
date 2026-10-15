const {chromium}=require('playwright'),assert=require('node:assert/strict');
const mock=require('./mock-android.cjs'),lbsMock=require('./mock-lbs2206.cjs');
const verified={serviceUuid:'11111111-1111-1111-1111-111111111111',writeUuid:'22222222-2222-2222-2222-222222222222',notifyUuid:'33333333-3333-3333-3333-333333333333',gattVerified:true,writeMode:'response',atomicFrameVerified:true,maxFrameBytes:20,frameGapMs:61,safeActions:4,programVerified:true,evidence:'TEST FIXTURE ONLY'};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  async function setup(profile){
   const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});await context.addInitScript(mock);await context.addInitScript(lbsMock);
   await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','lbs2206'));
   if(profile)await context.route('**/lbs2206-profile.js*',route=>route.fulfill({contentType:'text/javascript',body:'window.Lbs2206Profile=Object.freeze('+JSON.stringify(profile)+');'}));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4173/dist/#home');return {page,context,errors};
  }
  {
   const {page,context,errors}=await setup({});assert.equal(await page.locator('.home-model-entry strong').textContent(),'LBS2206 V1.02');
   await page.evaluate(()=>Lbs2206UI.open());await page.locator('#lbsRemoteControl .remote-connect').click();await page.locator('.lbs-page .bt-back').click();assert.equal(await page.evaluate(()=>location.hash),'#home');
   await page.locator('#newProject').click();assert.equal(await page.locator('#palette [data-card-id]').count(),9);assert.equal(await page.locator('#tab-dynamic').count(),0);
   await page.locator('#palette [data-card-id=combo-forward]').click();assert.equal(await page.locator('#chain .param-bubble').textContent(),'1秒');
   assert.equal(await page.locator('#tab-logic').count(),0);assert.equal(await page.locator('#tab-combo').count(),0);assert.equal(await page.locator('#palette [data-card-id=wait-time]').count(),1);assert.equal(await page.locator('#palette [data-card-id=loop-count]').count(),1);
   await page.locator('#runProgramBtn').click();await page.locator('.lbs-page').waitFor();assert.equal(await page.locator('.lbs-page').isVisible(),true);assert.equal(await page.getByRole('button',{name:'检查 GATT',exact:true}).count(),0);
   await page.evaluate(()=>{mockBle.devices=[{deviceId:'LBS',name:'Unknown module',rssi:-45}];});await page.locator('.lbs-scan').click();await page.locator('[data-device-id=LBS]').waitFor();
   assert.equal(await page.getByRole('button',{name:'连接',exact:true}).isDisabled(),true);
   assert.equal(await page.evaluate(()=>mockBle.calls.filter(c=>c.method==='write').length),0);assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'');
   await page.locator('.lbs-page .bt-back').click();await page.locator('#homeBtn').click();await page.locator('.home-model-entry').click();await page.locator('[data-model-id=xiaobai]').click();
   await page.locator('#newProject').click();assert.equal(await page.locator('#palette [data-card-id=motor-forward]').count(),1);
   assert.deepEqual(errors,[]);await context.close();
  }
  {
   const {page,context,errors}=await setup(verified);
   await page.evaluate(()=>{mockBle.devices=[{deviceId:'LBS',name:'Bench Car',rssi:-45}];location.hash='bluetooth';});await page.locator('.lbs-scan').click();await page.locator('[data-device-id=LBS]').waitFor();await page.getByRole('button',{name:'连接',exact:true}).click();await page.waitForFunction(()=>CardBluetooth.connected);
   const params=await page.evaluate(()=>mockBle.calls.find(c=>c.method==='connect'));assert.equal(params.serviceUuid,verified.serviceUuid);assert.equal(params.profile,'lbs2206');assert.equal(await page.evaluate(()=>CardBluetooth.defaultDeviceId),'LBS');
   await page.locator('.lbs-page .bt-back').click();await page.waitForFunction(()=>CardHome.activeModelId==='lbs2206');
   await page.evaluate(()=>{program=[{id:'combo-power',params:{power:5}},{id:'combo-forward',params:{duration:10}}];renderProgram();commitHistory();});
   await page.locator('#runProgramBtn').click();await page.waitForFunction(()=>mockBle.lbsWrites?.some(b=>b[1]===0x15));assert.equal(await page.locator('#runProgramBtn').isDisabled(),true);
   await page.locator('#pauseProgramBtn').click();await page.waitForFunction(()=>!CardProgram.running);await page.waitForFunction(()=>mockBle.lbsWrites.some(b=>b[1]===0x35));
   assert.equal(await page.evaluate(()=>mockBle.lbsWrites.some(b=>b[1]===123)),false,'remote programs must never upload or send program-mode stop');
   await page.evaluate(()=>{program=[{id:'lbs-forward',params:{steps:1}}];});await page.locator('#runProgramBtn').click();await page.waitForFunction(()=>document.getElementById('executionNotice').textContent.includes('旧版步数'));
   await page.evaluate(()=>Lbs2206UI.open());await page.locator('#lbsRemoteControl').waitFor();assert.equal(await page.locator('[data-speed]').count(),5);await page.locator('[data-speed="5"]').click();
   const f=await page.locator('[data-lbs-direction=forward]').boundingBox();await page.mouse.move(f.x+20,f.y+20);await page.mouse.down();await page.waitForFunction(()=>mockBle.lbsWrites.some(b=>b.length===4&&b[1]===0x15));await page.mouse.up();await page.waitForFunction(()=>mockBle.lbsWrites.some(b=>b.length===4&&b[1]===0x35));
   await page.screenshot({path:'artifacts/lbs2206-remote.png'});await page.locator('#lbsRemoteControl .remote-back').click();
   await page.evaluate(()=>Lbs2206UI.settings());await page.locator('[data-read=version]').click();await page.waitForFunction(()=>document.querySelector('.lbs-setting-result').textContent==='Ver=1.02');
   assert.equal(await page.evaluate(()=>mockBle.calls.some(c=>c.method==='compile'||c.method==='prepareUpload')),false);
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS LBS Android bridge: no writes with unverified profile, no GATT inspection UI, isolated defaults/catalogs, phone remote execution, duplicate lock, remote stop, legacy-step rejection, five speeds/release, maintenance and no compiler.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

