const {openBuilding,closeBuildingBook}=require('./building-helpers.cjs');
const assert=require('node:assert/strict');

// Use native touch input so scrolling, gesture cancellation and synthetic clicks
// are exercised in Chromium and in the connected Android WebView alike.
async function checkBuildingTouch({evaluate,call}){
 const viewer=expression=>evaluate(`document.querySelector('.building-viewer iframe').contentWindow.eval(${JSON.stringify(expression)})`);
 const touch=async(type,points)=>{
  await call('Input.dispatchTouchEvent',{type,touchPoints:points});
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 };
 const center=async selector=>viewer(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:1}})()`);
 const swipe=async(from,to)=>{
  await touch('touchStart',[from]);
  for(let i=1;i<=8;i++)await touch('touchMove',[{x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8,id:1}]);
  await touch('touchEnd',[]);
 };
 const fixed=async()=>{
  const state=await viewer(`(()=>{const e=document.getElementById('home_button'),r=e.getBoundingClientRect();return {scroll:[scrollX,scrollY,document.body.scrollTop,document.getElementById('main_canvas_holder').scrollTop],height:document.documentElement.scrollHeight,viewport:innerHeight,home:[r.x,r.y,r.width,r.height],reachable:r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
  assert.deepEqual(state.scroll,[0,0,0,0]);assert.equal(state.height,state.viewport);assert(state.reachable,'Return must remain on screen and reachable');
  assert.deepEqual(await evaluate(`({page:scrollY,dialog:document.querySelector('.building-viewer').scrollTop})`),{page:0,dialog:0});
  return state.home;
 };
 const home=await fixed();
 const before=await viewer('({step:manager.currentStep,zoom:manager.camera.zoom})');
 await viewer('window.touchTestManager=manager;LDR.Options.showStepRotationAnimations=2');
 for(const selector of ['#next_button_large','#zoom_in_button_large','#reset_camera_button','#next_button','#optionsButton a','#home_button']){
  const from=await center(selector);await swipe(from,{x:from.x,y:Math.max(2,from.y-150)});
  assert.deepEqual(await fixed(),home,'toolbar must not move after '+selector);
  assert.deepEqual(await viewer('({step:manager.currentStep,zoom:manager.camera.zoom})'),before,'dragging is not tapping '+selector);
  assert.equal(await viewer('!!document.getElementById("viewer-settings-panel")'),false);
 }
 // Model gestures are still handled by OrbitControls, not by the document.
 const size=await viewer('({w:innerWidth,h:innerHeight})');
 const from={x:size.w*.65,y:size.h*.52,id:1};
 const position=await viewer('manager.camera.position.toArray()');
 await swipe(from,{x:from.x+50,y:from.y+25});
 assert.notDeepEqual(await viewer('manager.camera.position.toArray()'),position,'model rotation');await fixed();
 const zoom=await viewer('manager.camera.zoom');
 await touch('touchStart',[{...from,x:from.x-20},{...from,x:from.x+20,id:2}]);
 await touch('touchMove',[{...from,x:from.x-55},{...from,x:from.x+55,id:2}]);
 await touch('touchEnd',[]);
 assert.notEqual(await viewer('manager.camera.zoom'),zoom,'pinch zoom');await fixed();
 // A regular tap must still work after a cancelled button drag.
 const tap=async selector=>{await touch('touchStart',[await center(selector)]);await touch('touchEnd',[])};
 await tap('#next_button');assert.equal(await viewer('manager.currentStep'),before.step+1);
 await tap('#prev_button');assert.equal(await viewer('manager.currentStep'),before.step);
 await tap('#reset_camera_button');
 await tap('#optionsButton a');
 for(let i=0;i<100&&!await viewer('document.querySelector("#viewer-settings-panel")?.contentDocument?.body?.dataset.ready==="true"');i++)await new Promise(r=>setTimeout(r,50));
 assert.equal(await viewer('document.querySelector("#viewer-settings-panel")?.contentDocument?.body?.dataset.ready==="true"'),true,'settings opens and binds its controls');
 await viewer('document.querySelector("#viewer-settings-panel").contentDocument.querySelector("#settings-back").click()');
 for(let i=0;i<30&&await viewer('!!document.querySelector("#viewer-settings-panel")');i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(await viewer('!document.getElementById("viewer-settings-panel")&&manager===touchTestManager&&manager.currentStep==='+before.step),true,'settings return preserves loaded model');
 await fixed();
 console.log('PASS button swipes do not scroll or activate; return stays reachable; model orbit/pinch, page taps and settings return work.');
}
module.exports={checkBuildingTouch};

if(require.main===module)(async()=>{
 const {chromium}=require('playwright');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:751,height:360},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
  await page.goto('http://127.0.0.1:4173/dist/#home');
  await page.getByRole('tab',{name:'搭建图',exact:true}).click();await openBuilding(page,/机器鸭 v2/);
  await page.frameLocator('.building-viewer iframe').locator('body[data-ready=true]').waitFor({timeout:60000});
  const cdp=await page.context().newCDPSession(page),evaluate=e=>page.evaluate(e),call=(m,p)=>cdp.send(m,p);
  for(const [width,height]of [[751,360],[568,280]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(150);
   await checkBuildingTouch({evaluate,call});
  }
  // Settings owns its scrolling in portrait, independently of the locked model.
  await page.setViewportSize({width:320,height:568});
  const frame=page.frameLocator('.building-viewer iframe');
  await frame.getByRole('link',{name:'查看设置',exact:true}).click();
  const settings=frame.frameLocator('#viewer-settings-panel');await settings.locator('#settings-back').waitFor();
  const scrolled=await settings.locator('body').evaluate(()=>{scrollTo(0,100);return {y:scrollY,top:document.querySelector('#settings-back').getBoundingClientRect().top}});
  assert(scrolled.y>0&&scrolled.top>=0,'portrait settings can scroll with its return still visible');
  await settings.locator('#settings-back').click();
  await frame.getByRole('link',{name:'返回首页',exact:true}).click();
  await page.locator('.building-viewer').waitFor({state:'hidden'});
  assert.equal(await page.locator('#buildingBooksReader').isVisible(),true,'viewer return restores the album');
  await closeBuildingBook(page);
  assert.deepEqual(errors,[]);console.log('PASS small landscape, portrait settings scrolling, return to album and building shelf.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
