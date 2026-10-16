const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:844,height:390},hasTouch:true}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4173/dist/#home');
 const picker=p.locator('.model-picker');
 await p.waitForFunction(()=>document.querySelector('.model-picker')?.open&&!document.querySelector('.model-entering'));
 await p.keyboard.press('Escape');assert.equal(await picker.isVisible(),true,'first choice remains required');
 await p.locator('[data-model-id=xiaobai]').click();await picker.waitFor({state:'hidden'});
 await p.evaluate(()=>CardDevicePicker.open());
 const motion=await picker.evaluate(el=>{
   const animation=el.getAnimations().find(a=>a.effect.target===el),frames=animation.effect.getKeyframes();
   const matrix=new DOMMatrix(frames[0].transform),entry=document.querySelector('.home-model-entry').getBoundingClientRect();
   return {duration:animation.effect.getTiming().duration,frames,pageBusy:CardPageTransition.busy,
     origin:{width:el.offsetWidth*matrix.a,height:el.offsetHeight*matrix.d,x:el.offsetLeft+el.offsetWidth/2+matrix.e,y:el.offsetTop+el.offsetHeight/2+matrix.f},
     entry:{width:entry.width,height:entry.height,x:entry.x+entry.width/2,y:entry.y+entry.height/2}};
 });
 assert.equal(motion.duration,320);assert.equal(motion.pageBusy,false);assert.equal(motion.frames[0].opacity,'0');
 for(const dimension of ['width','height','x','y'])assert.ok(Math.abs(motion.origin[dimension]-motion.entry[dimension])<1,'expands from entry '+dimension);
 // Close during entry, then reopen during exit: stale completion must not close the new opening.
 await p.evaluate(()=>{document.querySelector('.model-picker').close();CardDevicePicker.open();});
 await p.waitForTimeout(500);assert.equal(await picker.isVisible(),true);
 assert.equal(await picker.evaluate(el=>el.className),'model-picker');
 assert.equal(await picker.evaluate(el=>getComputedStyle(el).opacity),'1');
 const rail=p.locator('.model-options'),box=await rail.boundingBox();
 await p.mouse.move(box.x+550,box.y+70);await p.mouse.down();await p.mouse.move(box.x+290,box.y+70,{steps:12});
 assert.ok(await rail.evaluate(el=>el.scrollLeft)>200,'mouse drag follows before release');
 await p.mouse.up();await p.waitForTimeout(400);
 assert.equal(await picker.isVisible(),true,'drag does not select or close');
 assert.equal(await p.evaluate(()=>CardModelSession.current.id),'xiaobai');
 await rail.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));await p.waitForTimeout(200);
 const cdp=await p.context().newCDPSession(p);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+550,y:box.y+70}]});
 for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+550-i*22,y:box.y+70}]});
 assert.ok(await rail.evaluate(el=>el.scrollLeft)>200,'touch drag follows before release');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(400);
 assert.equal(await picker.isVisible(),true);assert.equal(await p.evaluate(()=>CardModelSession.current.id),'xiaobai');
 await p.keyboard.press('Escape');await picker.waitFor({state:'hidden'});
 assert.equal(await p.evaluate(()=>localStorage.getItem('cardDefaultModelV1')),'xiaobai');
 await p.evaluate(()=>{CardDevicePicker.open();const d=document.querySelector('.model-picker');d.close();d.close();});
 await picker.waitFor({state:'hidden'});await p.waitForTimeout(350);
 assert.equal(await p.evaluate(()=>document.querySelectorAll('dialog[open]').length),0);
 await p.emulateMedia({reducedMotion:'reduce'});await p.evaluate(()=>CardDevicePicker.open());
 assert.equal(await picker.evaluate(el=>el.getAnimations().length),0);
 await p.locator('.model-cancel').click();assert.equal(await picker.isVisible(),false);
 for(const viewport of [{width:667,height:320},{width:320,height:640}]){
   await p.setViewportSize(viewport);await p.evaluate(()=>CardDevicePicker.open());
   const layout=await picker.evaluate(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,overflow:el.scrollHeight>el.clientHeight+1};});
   assert.ok(layout.x>=0&&layout.y>=0&&layout.right<=viewport.width&&layout.bottom<=viewport.height);
   assert.equal(layout.overflow,false,'picker fits viewport without vertical scroll');
   await p.locator('.model-cancel').click();
 }
 await p.reload();assert.equal(await picker.isVisible(),false);
 assert.deepEqual(errors,[]);console.log('PASS picker expands from entry, first selection, mouse/touch drag without selection, cancel, rapid close/reopen, small viewports, reduced motion and persistence');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
