const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');

const root=path.resolve(__dirname,'../dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.wav':'audio/wav','.mp3':'audio/mpeg'};
const server=http.createServer((request,response)=>{
  const file=path.resolve(root,'.'+new URL(request.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
  response.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(response);
});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
    await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','lbs2206'));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#home`);
    await page.evaluate(()=>{
      window.lbsRemoteCalls=[];
      window.lbsTestConnection=null;
      window.CardBluetooth={
        remoteConnection:()=>window.lbsTestConnection,
        ensureConnected:()=>Promise.resolve(),
        connected:false
      };
      window.makeLbsConnection=(id,busy=false)=>({
        id,busy,
        remote:(direction,speed,guard=()=>true)=>{
          if(guard())window.lbsRemoteCalls.push({id,direction,speed});
          return Promise.resolve();
        }
      });
    });
    await page.evaluate(()=>Lbs2206UI.open());
    await page.waitForFunction(()=>document.getElementById('lbsRemoteControl').open&&!CardPageTransition.busy);
    const cdp=await context.newCDPSession(page);
    const touch=async(type,points)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
    const pointIn=async(selector,id,x=.5,y=.5)=>{
      const rect=await page.locator(selector).boundingBox();
      return {id,x:rect.x+rect.width*x,y:rect.y+rect.height*y};
    };
    const pressed=direction=>page.locator(`[data-lbs-direction="${direction}"]`).getAttribute('aria-pressed');

    assert.equal(await page.locator('[data-speed]').count(),5);
    assert.equal(await page.locator('.lbs-explicit-stop,.lbs-control-heading').count(),0,'direction uses release-to-stop without a separate heading or stop button');
    assert.equal(await page.locator('[data-lbs-direction]:disabled').count(),0,'offline controls remain interactive');
    assert.match(await page.locator('.lbs-remote-status').textContent(),/未连接/);
    assert.equal(await page.locator('.lbs-gear.lit').count(),1);

    const scene=await page.locator('#lbs-dpad-demo .scene').boundingBox();
    const around=(id,x,y)=>({id,x:scene.x+scene.width*(.5+x*.5),y:scene.y+scene.height*(.5+y*.5)});
    let directionFinger=around(1,0,0);
    await touch('touchStart',[directionFinger]);
    assert.equal(await pressed('forward'),'false','center is neutral');
    directionFinger=around(1,0,-.65);await touch('touchMove',[directionFinger]);
    assert.equal(await pressed('forward'),'true');
    assert.match(await page.locator('#lbs-dpad-demo .rocker').getAttribute('style'),/rotateX\(14deg\)/);
    directionFinger=around(1,.45,-.45);await touch('touchMove',[directionFinger]);
    assert.equal(await pressed('forward'),'true','diagonal boundary preserves previous direction without a stop gap');
    directionFinger=around(1,.65,0);await touch('touchMove',[directionFinger]);
    assert.equal(await pressed('right'),'true','direction follows one captured finger');
    directionFinger=around(1,1.15,0);await touch('touchMove',[directionFinger]);
    assert.equal(await page.locator('.hit[aria-pressed="true"]').count(),0,'outside is neutral');
    directionFinger=around(1,-.65,0);await touch('touchMove',[directionFinger]);
    assert.equal(await pressed('left'),'true','finger can re-enter without lifting');
    await touch('touchEnd',[]);
    assert.equal(await page.locator('.hit[aria-pressed="true"]').count(),0);
    assert.deepEqual(await page.evaluate(()=>lbsRemoteCalls),[],'offline gestures never reach the transport');

    // Connecting while an offline finger is still down clears ownership immediately;
    // the move that observes the new connection must not replay the held direction.
    directionFinger=around(1,0,-.65);await touch('touchStart',[directionFinger]);
    await page.evaluate(()=>{lbsTestConnection=makeLbsConnection('first');});
    directionFinger=around(1,.65,0);await touch('touchMove',[directionFinger]);
    assert.deepEqual(await page.evaluate(()=>lbsRemoteCalls),[]);
    assert.equal(await page.locator('.hit[aria-pressed="true"]').count(),0);
    await touch('touchEnd',[]);

    // A new connected gesture may steer while a second finger changes gear.
    directionFinger=around(1,0,-.65);await touch('touchStart',[directionFinger]);
    await page.waitForFunction(()=>lbsRemoteCalls.some(call=>call.direction==='forward'&&call.speed===1));
    const speedBottom=await pointIn('.speed-input',2,.45,.88);
    let speedFinger=speedBottom;
    await touch('touchStart',[directionFinger,speedFinger]);
    speedFinger=await pointIn('.speed-input',2,.45,.12);
    await touch('touchMove',[directionFinger,speedFinger]);
    await page.waitForFunction(()=>document.querySelector('.readout strong').textContent==='5');
    assert.equal(await page.locator('.lbs-gear.lit').count(),5,'gear lamps light cumulatively');
    assert.equal(await page.locator('.lbs-gear.green.lit').count(),2);
    assert.equal(await page.locator('.lbs-gear.yellow.lit').count(),2);
    assert.equal(await page.locator('.lbs-gear.red.lit').count(),1);
    assert.equal(await pressed('forward'),'true','speed pointer is independent');
    await page.waitForFunction(()=>lbsRemoteCalls.some(call=>call.direction==='forward'&&call.speed===5));
    await touch('touchEnd',[speedFinger]);
    assert.equal(await pressed('forward'),'true','releasing speed keeps direction held');
    await touch('touchEnd',[]);
    await page.waitForFunction(()=>lbsRemoteCalls.at(-1)?.direction==='stop');

    await page.locator('[data-speed="3"]').click();
    assert.equal(await page.locator('.readout strong').textContent(),'3');
    assert.equal(await page.locator('.lbs-gear.lit').count(),3);
    assert.equal(await page.locator('[data-speed="3"]').getAttribute('aria-pressed'),'true');

    // Keyboard adjustment belongs to the slider and must never drive the car.
    const beforeKey=await page.evaluate(()=>lbsRemoteCalls.length);
    await page.locator('.speed-input').focus();await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('.readout strong').textContent(),'4');
    assert.equal(await page.evaluate(()=>lbsRemoteCalls.length),beforeKey);
    assert.equal(await page.locator('#lbs-dpad-demo .hit[aria-pressed="true"]').count(),0);
    directionFinger=around(1,0,-.65);await touch('touchStart',[directionFinger]);
    await page.waitForFunction(()=>lbsRemoteCalls.at(-1)?.direction==='forward');
    await touch('touchCancel',[]);
    await page.waitForFunction(()=>lbsRemoteCalls.at(-1)?.direction==='stop');
    assert.equal(await page.locator('#lbs-dpad-demo .hit[aria-pressed="true"]').count(),0);

    // Busy links reject new movement locally.
    await page.evaluate(()=>{lbsTestConnection=makeLbsConnection('busy',true);lbsRemoteCalls.length=0;});
    directionFinger=around(1,0,-.65);await touch('touchStart',[directionFinger]);
    assert.equal(await pressed('forward'),'false');
    assert.deepEqual(await page.evaluate(()=>lbsRemoteCalls),[]);
    await touch('touchEnd',[]);

    // Closing a held control invokes the stop pipeline exactly once.
    await page.evaluate(()=>{lbsTestConnection=makeLbsConnection('close');lbsRemoteCalls.length=0;});
    directionFinger=around(1,0,-.65);await touch('touchStart',[directionFinger]);
    await page.waitForFunction(()=>lbsRemoteCalls.some(call=>call.direction==='forward'));
    await page.evaluate(()=>Lbs2206UI.close());
    await page.waitForFunction(()=>!document.getElementById('lbsRemoteControl').open&&!CardPageTransition.busy);
    assert.equal(await page.evaluate(()=>lbsRemoteCalls.filter(call=>call.direction==='stop').length),1,'close must not cancel or duplicate stop');
    await touch('touchEnd',[]);

    // Both target landscape sizes fit in one viewport without horizontal overflow.
    await page.evaluate(()=>Lbs2206UI.open());
    await page.waitForFunction(()=>document.getElementById('lbsRemoteControl').open&&!CardPageTransition.busy);
    for(const viewport of [{width:844,height:390},{width:568,height:280},{width:320,height:640}]){
      await page.setViewportSize(viewport);
      const fit=await page.locator('#lbsRemoteControl').evaluate(dialog=>({
        horizontal:dialog.scrollWidth<=dialog.clientWidth+1,
        vertical:dialog.scrollHeight<=dialog.clientHeight+1,
        shell:document.querySelector('#lbs-controller-prototype .controller-shell').getBoundingClientRect().toJSON(),
        pad:document.querySelector('#lbs-dpad-demo').getBoundingClientRect().toJSON(),
        speed:document.querySelector('#lbs-controller-speed').getBoundingClientRect().toJSON()
      }));
      assert.equal(fit.horizontal,true,`${viewport.width} has no horizontal overflow`);
      assert.equal(fit.vertical,true,`${viewport.height} keeps the controller on one screen`);
      assert.ok(fit.shell.width<=viewport.width&&fit.shell.height<=viewport.height);
      if(viewport.width>viewport.height){
        assert.ok(fit.pad.left-fit.shell.left<=45,'direction pad sits at the left edge of the base');
        assert.ok(fit.pad.right<fit.speed.left,'direction and speed do not overlap');
      }
    }
    await page.setViewportSize({width:844,height:390});
    await page.screenshot({path:'artifacts/lbs2206-physical-remote.png'});
    assert.deepEqual(errors,[]);
    await context.close();
    console.log('PASS LBS2206 physical remote: offline preview, continuous d-pad, independent two-finger gear slider, cumulative seven-segment lamps, busy/stop safety, connection clearing, single close stop and landscape fit.');
  }finally{
    await browser.close();server.close();
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
