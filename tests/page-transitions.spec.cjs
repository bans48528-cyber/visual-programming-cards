const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {openBuildingBook,openBuilding,closeBuildingBook}=require('./building-helpers.cjs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:844,height:390}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
 await p.goto('http://127.0.0.1:4173/dist/#home');
 const idle=()=>p.waitForFunction(()=>!CardPageTransition.busy&&!document.querySelector('.page-transition-surface'));
 assert.equal(await p.evaluate(()=>CardPageTransition.busy),false,'startup has no transition');
 await p.evaluate(()=>document.querySelector('#newProject').click());
 const forward=await p.evaluate(()=>[...document.querySelectorAll('.page-transition-surface')].map(el=>({name:el.className,keyframes:el.getAnimations()[0]?.effect.getKeyframes(),duration:el.getAnimations()[0]?.effect.getTiming().duration})));
 assert.equal(forward.length,2);assert.deepEqual(forward.map(a=>a.duration).sort(),[280,300]);
 assert.ok(forward.some(a=>a.keyframes.at(-1).transform==='translate3d(-100%, 0px, 0px)'||a.keyframes.at(-1).transform==='translate3d(-100%,0,0)'));
 await p.evaluate(()=>{document.querySelector('#homeBtn').click();document.querySelector('#homeBtn').click();});
 await idle();assert.equal(await p.locator('.home-screen').isVisible(),true);assert.equal(await p.locator('.app').isVisible(),false);
 await p.getByRole('tab',{name:'遥控',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#remoteControl').open);
 await p.evaluate(()=>document.querySelector('#remoteControl .remote-back').click());await idle();
 assert.equal(await p.locator('#remoteControl').isVisible(),false);assert.equal(await p.locator('.home-screen').isVisible(),true);
 // Remote opened from the editor must return there, with the entire editor moving.
 await p.locator('#newProject').click();await idle();await p.evaluate(()=>CardRemote.open());await idle();
 await p.locator('#remoteControl .remote-back').click();await idle();assert.equal(await p.locator('.home-screen').isVisible(),false);
 // Multiple back sources during remote entry must not strand a modal on top of home.
 await p.evaluate(async()=>{await CardRemote.open();CardRemote.close();location.hash='home';});
 await p.locator('.home-screen').waitFor({state:'visible'});await idle();
 assert.equal(await p.locator('#remoteControl').isVisible(),false);
 // Popups are unchanged and do not start page transitions.
 await p.locator('.home-model-entry').click();assert.equal(await p.evaluate(()=>CardPageTransition.busy),false);await p.locator('.model-cancel').click();
 await p.getByRole('tab',{name:'搭建图',exact:true}).click();assert.equal(await p.evaluate(()=>CardPageTransition.busy),false);
 await openBuildingBook(p);assert.equal(await p.evaluate(()=>CardPageTransition.busy),false,'book opening uses its own animation');
 await openBuilding(p,/机器鸭 v2/);
 await p.waitForFunction(()=>document.querySelector('.building-viewer').open);
 assert.equal(await p.locator('#buildingBooksReader.page-transition-surface').count(),1,'the whole book reader exits when the viewer enters');
 assert.equal(await p.locator('.building-viewer.page-transition-surface').count(),1,'the whole viewer enters from the book');
 assert.equal(await p.locator('.building-viewer iframe').getAttribute('src'),null,'do not load the model while the page is sliding');
 await p.evaluate(()=>CardBuildings.back());await idle();assert.equal(await p.locator('.building-viewer').isVisible(),false);
 assert.equal(await p.locator('#buildingBooksReader').isVisible(),true,'quick back restores the book reader');
 assert.equal(await p.locator('.building-viewer iframe').getAttribute('src'),null,'quick back cancels late model loading');
 await openBuilding(p,/机器鸭 v2/);await idle();
 const f=p.frameLocator('.building-viewer iframe');await f.locator('body[data-ready=true]').waitFor({timeout:60000});await p.locator('.building-loading').waitFor({state:'hidden'});
 await p.frames().find(f=>f.url().includes('instructions.html')).evaluate(()=>parent.postMessage({source:'building-viewer',type:'close',visit:'retired'},location.origin));
 await p.waitForTimeout(50);assert.equal(await p.locator('.building-viewer').isVisible(),true,'old viewer message must not close a new visit');
 await f.getByRole('link',{name:'查看设置',exact:true}).click();assert.equal(await p.evaluate(()=>CardPageTransition.busy),false);
 await f.frameLocator('#viewer-settings-panel').locator('#settings-back').click();
 await f.getByRole('link',{name:'返回首页',exact:true}).click();await p.locator('.building-viewer').waitFor({state:'hidden'});await idle();assert.equal(await p.locator('.building-viewer').isVisible(),false);
 assert.equal(await p.locator('#buildingBooksReader').isVisible(),true,'loaded viewer returns to the book reader');
 await closeBuildingBook(p);await p.getByRole('tab',{name:'我的作品',exact:true}).click();
 // Pause mid-animation to verify the two live page surfaces and capture the composition.
 await p.evaluate(()=>{document.querySelector('#newProject').click();document.querySelectorAll('.page-transition-surface').forEach(el=>el.getAnimations().forEach(a=>{a.pause();a.currentTime=140}));});
 const bounds=await p.locator('.page-transition-surface').evaluateAll(es=>es.map(e=>({name:e.className,x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right,visibility:getComputedStyle(e).visibility})));
 assert.ok(bounds.every(b=>b.visibility==='visible'));assert.ok(bounds.some(b=>b.x<0));assert.ok(bounds.some(b=>b.x>0));
 await p.screenshot({path:'artifacts/page-transition-midpoint.png'});await p.evaluate(()=>CardPageTransition.settle());await idle();
 await p.emulateMedia({reducedMotion:'reduce'});await p.locator('#homeBtn').click();assert.equal(await p.evaluate(()=>CardPageTransition.busy),false);
 assert.deepEqual(errors,[]);console.log('PASS whole-page direction/timing, rapid enter/back, remote return targets, deferred model render/cancellation, unchanged popups/tabs, live-page composition, reduced motion.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
