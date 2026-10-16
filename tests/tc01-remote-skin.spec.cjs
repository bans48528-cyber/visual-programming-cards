const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge'});try{
 for(const android of [false,true]){
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','tc01'));
  if(android)await context.addInitScript(require('./mock-android.cjs'));
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4173/dist/#home');
  await p.waitForFunction(()=>window.TC01UI&&window.CardBluetooth);
  // Exercise the real TC-01 encoder/queue with a local transport; no hardware assumptions.
  await p.evaluate(()=>{
   window.tcWrites=[];window.tcConnection=null;
   CardBluetooth.remoteConnection=()=>tcConnection;CardBluetooth.ensureConnected=async()=>false;
   window.tcConnect=id=>{
    const link=new TC01Protocol.Link({write:async bytes=>tcWrites.push(new TextDecoder().decode(bytes)),close(){},disconnect:async()=>{}},{profile:{lineEnding:''}});
    tcConnection={id,setMotors:(...args)=>link.setMotors(...args),stopProgram:()=>link.stopProgram()};
   };
   document.querySelectorAll('#tc01Remote [data-tc-key]').forEach(e=>e.addEventListener('pointerdown',event=>{window.tcLastPointer=event.pointerId;window.tcLastInput=e;}));
  });
  const open=async()=>{await p.evaluate(()=>TC01UI.open());await p.waitForFunction(()=>document.getElementById('tc01Remote').open&&!CardPageTransition.busy);};
  const idle=()=>p.waitForFunction(()=>!CardPageTransition.busy);
  const directions=()=>p.locator('#tc01-twin-stick .motor').evaluateAll(es=>es.map(e=>e.dataset.direction));
  const expectDirections=async(left,right)=>p.waitForFunction(wanted=>[...document.querySelectorAll('#tc01-twin-stick .motor')].every((e,i)=>e.dataset.direction===wanted[i]),[left,right]);
  const point=async(side,fraction,id=1)=>{const b=await p.locator('#tc01-twin-stick [data-motor='+side+'] .well').boundingBox();return {id,x:b.x+b.width/2,y:b.y+b.height*fraction};};
  const moveMouse=at=>p.mouse.move(at.x,at.y);
  const expectFrame=frame=>p.waitForFunction(expected=>tcWrites.at(-1)===expected,frame);
  await open();
  assert.equal(await p.locator('#tc01-twin-stick .direction-lamp svg').count(),8,'local rim/lens SVG lamps');
  assert.equal(await p.locator('#tc01Remote [data-tc-key]:disabled').count(),0,'offline controls enabled');
  for(const viewport of [{width:844,height:390},{width:568,height:280}]){
   await p.setViewportSize(viewport);await idle();
   const bounds=await p.locator('#tc01Remote [data-tc-key],#tc01Remote .tc01-stop').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {key:e.dataset.tcKey||'stop',x:r.x,y:r.y,w:r.width,h:r.height};}));
   for(const b of bounds){assert(b.w>=44&&b.h>=44,JSON.stringify(b));assert(b.x>=0&&b.y>=0&&b.x+b.w<=viewport.width+.5&&b.y+b.h<=viewport.height+.5,JSON.stringify({viewport,b}));}
   assert.equal(await p.locator('#tc01Remote').evaluate(e=>e.scrollHeight<=e.clientHeight+1),true,'whole remote fits without scrolling');
  }
  await p.setViewportSize({width:844,height:390});await idle();
  let left=await point('left',.18),center=await point('left',.5),reverse=await point('left',.82);
  await moveMouse(left);await p.mouse.down();await p.waitForTimeout(650);await expectDirections('forward','stop');
  await moveMouse(center);await expectDirections('stop','stop');
  await moveMouse(reverse);await expectDirections('reverse','stop');await p.mouse.up();await expectDirections('stop','stop');
  // Grabbing the neutral thumb does not jump, and its position follows the finger.
  await moveMouse(center);await p.mouse.down();await expectDirections('stop','stop');
  const travel=await p.locator('[data-motor=left]').evaluate(e=>Math.max(8,Math.min(54,(e.querySelector('.well').clientHeight-e.querySelector('.thumb').offsetHeight)/2-30)));
  await p.mouse.move(center.x,center.y-travel*.6);await expectDirections('forward','stop');
  const displacement=await p.locator('[data-motor=left] .thumb').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m42);
  assert(Math.abs(displacement+travel*.6)<1,'thumb follows pointer without snapping to full travel');
  await p.mouse.up();await expectDirections('stop','stop');
  assert.deepEqual(await p.evaluate(()=>tcWrites),[],'offline gestures never send');
  if(android)assert.equal(await p.evaluate(()=>mockBle.calls.filter(c=>c.method==='write').length),0,'offline has no native BLE writes');

  // A connection becoming available between draw ticks invalidates the old gesture immediately.
  await moveMouse(left);await p.mouse.down();await expectDirections('forward','stop');
  await p.evaluate(()=>{
   tcConnect('test-first');
   tcLastInput.dispatchEvent(new PointerEvent('pointermove',{pointerId:tcLastPointer,clientY:0,bubbles:true}));
  });
  await expectDirections('stop','stop');
  await moveMouse(reverse);await p.waitForTimeout(250);assert.deepEqual(await p.evaluate(()=>tcWrites),[],'old offline finger is never replayed on connection');
  await p.mouse.up();await moveMouse(left);await p.mouse.down();await expectFrame('KEY_DATA=1000');await p.mouse.up();await expectFrame('KEY_DATA=0000');

  // Start this gesture at the neutral thumb; grabbing it mid-return intentionally
  // preserves a different finger offset and would change the following center test.
  await p.waitForFunction(()=>[...document.querySelectorAll('#tc01-twin-stick .thumb')].every(e=>Math.abs(new DOMMatrix(getComputedStyle(e).transform).m42)<.1));
  const cdp=await context.newCDPSession(p);left=await point('left',.18,11);let right=await point('right',.82,12);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[left]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[left,right]});await expectFrame('KEY_DATA=1001');await expectDirections('forward','reverse');
  const neutral=await point('left',.5,11);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[neutral,right]});await expectFrame('KEY_DATA=0001');
  const leftReverse=await point('left',.82,11);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[leftReverse,right]});await expectFrame('KEY_DATA=0101');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[leftReverse]});await expectFrame('KEY_DATA=0001');await expectDirections('stop','reverse');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await expectFrame('KEY_DATA=0000');await expectDirections('stop','stop');

  await p.locator('[data-tc-key=leftForward]').focus();await p.keyboard.down('KeyW');await p.keyboard.down('ArrowDown');await expectFrame('KEY_DATA=1001');
  await p.keyboard.up('KeyW');await expectFrame('KEY_DATA=0001');await p.keyboard.up('ArrowDown');await expectFrame('KEY_DATA=0000');
  await p.keyboard.down('KeyS');await expectFrame('KEY_DATA=0100');await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await expectFrame('KEY_DATA=0000');await p.keyboard.up('KeyS');

  await moveMouse(left);await p.mouse.down();await expectFrame('KEY_DATA=1000');
  await p.mouse.move(left.x+1,left.y);
  await p.evaluate(()=>tcLastInput.releasePointerCapture(tcLastPointer));await p.mouse.move(left.x+2,left.y);
  await expectDirections('stop','stop');await expectFrame('KEY_DATA=0000');await p.mouse.up();
  await moveMouse(left);await p.mouse.down();await expectFrame('KEY_DATA=1000');
  await p.evaluate(()=>document.querySelector('#tc01Remote .tc01-stop').click());await expectFrame('KEY_DATA=0000');
  await moveMouse(reverse);await expectDirections('stop','stop');await p.mouse.up();

  // Disconnect and reconnect while held, without waiting for the poll interval.
  await moveMouse(left);await p.mouse.down();await expectFrame('KEY_DATA=1000');
  const beforeDisconnect=await p.evaluate(()=>tcWrites.length);
  await p.evaluate(()=>{tcConnection=null;tcLastInput.dispatchEvent(new PointerEvent('pointermove',{pointerId:tcLastPointer,clientY:0,bubbles:true}));});
  await expectDirections('stop','stop');assert.equal(await p.evaluate(()=>tcWrites.length),beforeDisconnect);
  await p.evaluate(()=>{tcConnect('test-second');tcLastInput.dispatchEvent(new PointerEvent('pointermove',{pointerId:tcLastPointer,clientY:0,bubbles:true}));});
  await moveMouse(reverse);await expectDirections('stop','stop');assert.equal(await p.evaluate(()=>tcWrites.length),beforeDisconnect);
  await p.mouse.up();await moveMouse(left);await p.mouse.down();await expectFrame('KEY_DATA=1000');
  await p.evaluate(()=>TC01UI.close());await expectFrame('KEY_DATA=0000');await idle();await p.mouse.up();await open();assert.deepEqual(await directions(),['stop','stop']);
  await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('[data-motor=left] .thumb').evaluate(e=>getComputedStyle(e).transitionDuration.split(',')[0].trim()),'0s');
  if(!android)await p.screenshot({path:'artifacts/tc01-twin-stick.png'});
  await p.locator('#tc01Remote .remote-back').click();await idle();
  await p.evaluate(()=>CardModelSession.select('xiaobai'));assert.equal(await p.locator('#tc01Remote').evaluate(e=>e.open),false);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS TC-01 twin sticks: offline/online, neutral zone and continuous travel, independent motors and exact KEY_DATA, keyboard/cancel/capture/blur/stop, immediate reconnect invalidation, two landscape sizes.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
