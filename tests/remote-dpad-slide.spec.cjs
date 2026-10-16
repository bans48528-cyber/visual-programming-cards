const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'msedge'});try{
 for(const model of ['xiaobai','spark-ai']) for(const android of [false,true]){
  const c=await b.newContext({viewport:{width:844,height:390},hasTouch:true});
  await c.addInitScript(id=>{localStorage.setItem('cardDefaultModelV1',id);window.__XIAOBAI_BLE_TIMING={firstScanMs:80,defaultScanMs:180};},model);
  if(android)await c.addInitScript(require('./mock-android.cjs'));
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4173/dist/#home');
  if(android)await p.evaluate(id=>mockBle.devices=[{name:id==='spark-ai'?'Spark_AI':'Xiaobai',deviceId:'slide-car',rssi:-40}],model);
  await p.getByRole('tab',{name:'遥控',exact:true}).click();await p.waitForFunction(()=>document.getElementById('remoteControl').open&&!CardPageTransition.busy);
  if(android)await p.waitForFunction(()=>document.querySelector('#remoteControl .remote-connection').classList.contains('is-connected'));
  const cdp=await c.newCDPSession(p);
  const check=async expected=>{
   await p.waitForFunction(keys=>JSON.stringify([...document.querySelectorAll('#remoteControl [aria-pressed=true]')].map(e=>e.dataset.remoteKey).sort())===JSON.stringify([...keys].sort()),expected,{timeout:2000});
   if(android)await p.waitForFunction(({keys,model})=>{const last=mockBle.calls.filter(c=>c.method==='write'&&atob(c.data).charCodeAt(4)===0xc1).at(-1);const order=model==='spark-ai'?['up','down','left','right','A','B','X','Y','L','R']:['up','down','left','right','Y','A','X','B','R','L'];return last&&order.every((key,i)=>atob(last.data).charCodeAt(i+5)===Number(keys.includes(key)));},{keys:expected,model});
  };
  for(const viewport of [{width:844,height:390},{width:568,height:280},{width:320,height:568}]){
   await p.setViewportSize(viewport);
   const r=await p.locator('#xb-dpad-demo .scene').boundingBox(),radius=r.width/2;
   const at=(x,y,id=1)=>({id,x:r.x+radius+x*radius,y:r.y+radius+y*radius});
   const y=await p.locator('[data-remote-key=Y]').boundingBox(),yellow={id:2,x:y.x+y.width/2,y:y.y+y.height/2};
   let finger=at(0,-.65);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[yellow]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger,yellow]});await check(['up','Y']);
   const move=async(x,y,keys)=>{finger=at(x,y);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger,yellow]});await check(keys);};
   await move(.65,0,['right','Y']);await move(0,.65,['down','Y']);await move(-.65,0,['left','Y']);
   await move(0,-.65,['up','Y']);
   // Small drift on the diagonal keeps the previous direction, then switches promptly.
   await move(.45,-.45,['up','Y']);await move(.45+1/radius,-.45,['up','Y']);
   await move(.65,-.38,['right','Y']);await move(.45,-.45,['right','Y']);
   await move(0,0,['Y']);await move(0,-.65,['up','Y']);
   await move(-1.15,0,['Y']);await move(-.65,0,['left','Y']);
   assert.match(await p.locator('#xb-dpad-demo .rocker').getAttribute('style'),/rotateY\(-14deg\)/);
   if(!android&&viewport.width===844)await p.screenshot({path:`artifacts/${model}-direction-slide.png`});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[finger]});await check(['Y']);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await check([]);
   // Starting in the neutral center can slide into a direction without lifting.
   finger=at(0,0);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});await check([]);
   finger=at(.65,0);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger]});await check(['right']);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await check([]);
  }
  const r=await p.locator('#xb-dpad-demo .scene').boundingBox();
  let touch={id:1,x:r.x+r.width/2,y:r.y+r.height*.2};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});await check(['up']);
  await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await check([]);
  touch={...touch,x:r.x+r.width*.8,y:r.y+r.height/2};await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch]});await check([]);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.locator('#xb-dpad-demo .scene').evaluate(e=>e.addEventListener('gotpointercapture',event=>window.capturedDirectionPointer=event.pointerId,{once:true}));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});await check(['right']);
  touch={...touch,x:touch.x-1};await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch]});
  await p.waitForFunction(()=>typeof capturedDirectionPointer==='number');
  await p.locator('#xb-dpad-demo .scene').evaluate(e=>e.releasePointerCapture(window.capturedDirectionPointer));
  touch={...touch,x:r.x+r.width/2,y:r.y+r.height*.8};await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch]});await check([]);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  if(model==='spark-ai'){
   // Same physical controller, but preserve Spark's own bit order and held shoulder keys.
   for(const key of ['A','B','X','Y','L','R']){
    const box=await p.locator(`[data-remote-key=${key}]`).boundingBox();
    await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await check([key]);
    await p.waitForTimeout(160);await check([key]);await p.mouse.up();await check([]);
   }
  }
  assert.deepEqual(errors,[]);await c.close();
 }
 console.log('PASS Xiaobai/Spark offline/connected d-pad sliding: continuous four-way changes, diagonal tolerance, center/outside release and re-entry, multi-touch isolation, cancel/blur/capture loss, two landscape sizes and compact portrait, C1 frames.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
