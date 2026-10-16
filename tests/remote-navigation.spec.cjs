const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const model of ['xiaobai','spark-ai','tc01','lbs2206']){
  const c=await browser.newContext({viewport:{width:844,height:390}}),errors=[];
  await c.addInitScript(id=>localStorage.setItem('cardDefaultModelV1',id),model);
  await c.addInitScript(require('./mock-android.cjs'));
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4173/dist/#home');await p.waitForFunction(()=>window.CardBluetooth&&window.CardModelSession?.current?.remote);
  const idle=()=>p.waitForFunction(()=>!CardPageTransition.busy);
  for(const origin of ['home','editor']){
   if(origin==='editor'){await p.locator('#newProject').click();await idle();}
   await p.evaluate(()=>CardModelSession.current.remote.open());await idle();
   for(const viewport of [{width:844,height:390},{width:568,height:280}]){
    await p.setViewportSize(viewport);
    const layout=await p.locator('.remote-dialog[open]').evaluate(dialog=>{
     const nav=dialog.querySelector('.remote-header'),style=getComputedStyle(nav);
     return {position:style.position,background:style.backgroundColor,border:style.borderBottomWidth,
      headings:nav.querySelectorAll('h1,p').length,
      buttons:[...nav.querySelectorAll('button')].map(button=>{
       const r=button.getBoundingClientRect();
       return {...r.toJSON(),hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
      })};
    });
    assert.equal(layout.position,'absolute',model+' navigation floats above the page');
    assert.equal(layout.background,'rgba(0, 0, 0, 0)');assert.equal(layout.border,'0px');assert.equal(layout.headings,0);
    assert.equal(layout.buttons.length,2);
    assert.ok(layout.buttons.every(b=>b.hit&&b.width>=44&&b.height>=44&&b.top>=0&&b.top<20),model+' corner buttons are reachable');
    assert.ok(layout.buttons[0].left<24&&layout.buttons[1].right>viewport.width-24);
   }
   await p.setViewportSize({width:844,height:390});
   await p.evaluate(()=>{
    window.homeFlash=false;
    const original=HTMLDialogElement.prototype.close;
    if(!window.recordedClose){window.recordedClose=true;HTMLDialogElement.prototype.close=function(...args){if(this.classList.contains('remote-dialog')&&location.hash==='#bluetooth')window.destinationReadyOnClose=!!document.querySelector('.bluetooth-page:not([hidden])')&&document.body.classList.contains('bluetooth-open');return original.apply(this,args);};}
   });
   await p.locator('dialog[open] .remote-connect').click();
   await p.waitForURL('**/#bluetooth');assert.equal(await p.evaluate(()=>destinationReadyOnClose),true,model);
   await p.locator('dialog.remote-dialog[open]').waitFor({state:'detached'});
   await p.evaluate(()=>{
    window.returnObserver=new MutationObserver(()=>{if(!document.querySelector('.bluetooth-page:not([hidden])')&&!document.querySelector('.remote-dialog[open]'))window.homeFlash=true;});
    document.querySelectorAll('.bluetooth-page').forEach(e=>returnObserver.observe(e,{attributes:true,attributeFilter:['hidden']}));
   });
   if(origin==='home')await p.locator('.bluetooth-page:not([hidden]) .bt-back').click();
   else await p.evaluate(()=>{nativeListeners.backButton();nativeListeners.backButton();});
   await p.locator('.remote-dialog[open]').waitFor({state:'visible'});await p.waitForURL('**/#'+origin);await idle();
   assert.equal(await p.locator('.bluetooth-page:not([hidden])').count(),0);
   assert.equal(await p.locator('.remote-dialog[open]').count(),1,'only one restored remote');
   assert.equal(await p.evaluate(()=>homeFlash),false,'remote visible before Bluetooth disappears');
   await p.evaluate(()=>returnObserver.disconnect());
   await p.locator('dialog[open] .remote-back').click();await idle();
   assert.equal(await p.locator('.home-screen').isVisible(),origin==='home');
   assert.equal(new URL(p.url()).hash,'#'+origin);
  }
  // Direct editor Bluetooth navigation must not inherit a stale remote return.
  await p.locator('#bluetoothBtn').click();await p.locator('.bluetooth-page:not([hidden]) .bt-back').click();
  await p.waitForURL('**/#editor');assert.equal(await p.locator('.remote-dialog[open]').count(),0);
  // A newer navigation invalidates an old asynchronous remote reopen.
  await p.evaluate(()=>CardModelSession.current.remote.open());await idle();await p.locator('dialog[open] .remote-connect').click();
  await p.evaluate(()=>{window.originalStop=CardProgram.stop;CardProgram.stop=()=>new Promise(r=>window.finishReturnStop=r);CardBluetoothBack();});
  await p.waitForFunction(()=>typeof finishReturnStop==='function');
  await p.evaluate(()=>{CardOpenBluetooth('#editor');CardProgram.stop=originalStop;finishReturnStop();});
  await p.waitForTimeout(100);assert.equal(await p.locator('.remote-dialog[open]').count(),0);assert.equal(new URL(p.url()).hash,'#bluetooth');
  assert.deepEqual(errors,[]);await c.close();
 }
 console.log('PASS four models: home/editor → remote → Bluetooth → remote; UI/native/double back; no home flash; direct editor return; stale asynchronous reopen cancelled.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
