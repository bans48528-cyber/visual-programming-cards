const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');

const root=path.resolve(__dirname,'../dist'),changedStyles=new Set();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((request,response)=>{
 const file=path.resolve(root,'.'+new URL(request.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
 response.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
 if(path.extname(file)==='.css'){
  // Unknown units remain valid custom-property tokens but fail at use sites.
  // This also disables the dvh @supports branch, like an older WebView.
  const css=fs.readFileSync(file,'utf8'),legacy=css.replace(/dvh\b/gi,'unknown-viewport-unit');
  if(legacy!==css)changedStyles.add(file);
  response.end(legacy);
 }else fs.createReadStream(file).pipe(response);
});
const sizes=[{width:844,height:390},{width:568,height:280}];
const models=['xiaobai','spark-ai','lbs2206','tc01'];

(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const model of models){
   const context=await browser.newContext({viewport:sizes[0],hasTouch:true});
   try{
    await context.addInitScript(id=>localStorage.setItem('cardDefaultModelV1',id),model);
    changedStyles.clear();
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.goto(base+'#home');
    await page.waitForFunction(()=>window.CardModelSession&&window.CardBluetooth);
    await page.evaluate(id=>{
     window.legacyWrites=[];
     const transport={write:async bytes=>legacyWrites.push(new TextDecoder().decode(bytes)),close(){},disconnect:async()=>{}};
     const tcLink=id==='tc01'?new TC01Protocol.Link(transport,{profile:{lineEnding:''}}):null;
     const connection={
      id:'legacy-viewport-'+id,busy:false,enterRemote:async()=>{},enterProgram:async()=>{},stopProgram:async()=>{},
      send:async bytes=>legacyWrites.push(Array.from(bytes)),
      remote:(direction,speed,guard=()=>true)=>{if(guard())legacyWrites.push({direction,speed});return Promise.resolve();},
      setMotors:(left,right,guard)=>tcLink.setMotors(left,right,guard)
     };
     CardBluetooth.remoteConnection=()=>connection;
     CardBluetooth.ensureConnected=async()=>false;
     CardBluetooth.enterRemote=async()=>{};
     CardBluetooth.enterProgram=async()=>{};
    },model);
    await page.evaluate(()=>CardModelSession.current.remote.open());
    await page.waitForFunction(()=>document.querySelector('.remote-dialog[open]')&&!CardPageTransition.busy);
    const dialog=model==='tc01'?'#tc01Remote':model==='lbs2206'?'#lbsRemoteControl':'#remoteControl';
    if(model==='xiaobai'||model==='spark-ai')await page.waitForFunction(()=>document.querySelector('#remoteControl .remote-connection').classList.contains('is-connected'));
    assert.ok(changedStyles.has(path.join(root,'remote.css')),'remote.css must contain the dvh @supports gate; rebuild dist first');
    assert.equal(await page.locator(dialog).evaluate(element=>getComputedStyle(element).getPropertyValue('--remote-vh').trim()),'1vh',model+' must retain vh when the dvh support condition is false');
    assert.equal(await page.evaluate(()=>CSS.supports('height','100unknown-viewport-unit')),false);
    assert.equal(await page.evaluate(()=>CSS.supports('--probe','100unknown-viewport-unit')),true,'unknown units remain valid custom-property tokens');

    const cdp=await context.newCDPSession(page);
    const touch=async(type,touchPoints)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
    const point=async(selector,id,x=.5,y=.5)=>{
     const r=await page.locator(selector).boundingBox();assert(r&&r.width>0&&r.height>0,model+' measurable target '+selector);
     return {id,x:r.x+r.width*x,y:r.y+r.height*y};
    };
    const expectTenKeys=async wanted=>{
     await page.waitForFunction(keys=>{
      const actual=[...document.querySelectorAll('#remoteControl [data-remote-key][aria-pressed=true]')].map(e=>e.dataset.remoteKey).sort();
      return JSON.stringify(actual)===JSON.stringify([...keys].sort());
     },wanted);
     await page.waitForFunction(({keys,id})=>{
      const last=legacyWrites.filter(value=>Array.isArray(value)&&value[4]===0xc1).at(-1);
      const order=id==='spark-ai'?['up','down','left','right','A','B','X','Y','L','R']:['up','down','left','right','Y','A','X','B','R','L'];
      return last&&order.every((key,index)=>last[5+index]===Number(keys.includes(key)));
     },{keys:wanted,id:model});
    };
    const expectTc=async(left,right,frame)=>{
     await page.waitForFunction(wanted=>[...document.querySelectorAll('#tc01-twin-stick .motor')].every((element,index)=>element.dataset.direction===wanted[index]),[left,right]);
     await page.waitForFunction(value=>legacyWrites.at(-1)===value,frame);
    };
    const expectLbs=async direction=>{
     await page.waitForFunction(value=>{
      const pressed=[...document.querySelectorAll('#lbs-dpad-demo .hit[aria-pressed=true]')];
      return value==='stop'?pressed.length===0:pressed.length===1&&pressed[0].dataset.lbsDirection===value;
     },direction);
     await page.waitForFunction(value=>legacyWrites.at(-1)?.direction===value,direction);
    };

    for(const viewport of sizes){
     await page.setViewportSize(viewport);
     await page.waitForFunction(()=>!CardPageTransition.busy);
     const geometry=await page.evaluate(({id,dialogSelector})=>{
      const root=document.querySelector(dialogSelector);
      const rect=selector=>{
       const element=document.querySelector(selector),r=element.getBoundingClientRect(),css=getComputedStyle(element);
       return {selector,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,cssWidth:css.width,cssHeight:css.height};
      };
      const buttonSelector=id==='tc01'?'[data-tc-key],.tc01-stop':id==='lbs2206'?'.hit[data-lbs-direction],[data-speed]':'[data-remote-key]';
      const targets=[...root.querySelectorAll(buttonSelector+',.remote-back,.remote-connect')].map(element=>{
       const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
       return {key:element.dataset.remoteKey||element.dataset.tcKey||element.dataset.lbsDirection||element.dataset.speed||element.className,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,hit:Boolean(hit&&(hit===element||element.contains(hit)))};
      });
      const selectors=id==='tc01'?['#tc01-twin-stick .controller','[data-motor=left] .well','[data-motor=right] .well']:
       id==='lbs2206'?['#lbs-controller-prototype .controller-shell','#lbs-dpad-demo .scene','#lbs-controller-speed .slider-area']:
       ['#xb-controller .controller-shell','#xb-dpad-demo .scene','#xb-color-pad .pad'];
      return {parts:selectors.map(rect),targets,scrollWidth:root.scrollWidth,clientWidth:root.clientWidth,scrollHeight:root.scrollHeight,clientHeight:root.clientHeight};
     },{id:model,dialogSelector:dialog});
     const label=model+' '+viewport.width+'x'+viewport.height;
     assert.ok(geometry.scrollWidth<=geometry.clientWidth+1,label+' no horizontal overflow');
     assert.ok(geometry.scrollHeight<=geometry.clientHeight+1,label+' no vertical overflow');
     for(const part of geometry.parts){
      assert.ok(part.width>80&&part.height>100,label+' noncollapsed part '+JSON.stringify(part));
      assert.ok(part.x>=-.5&&part.y>=-.5&&part.right<=viewport.width+.5&&part.bottom<=viewport.height+.5,label+' part inside viewport '+JSON.stringify(part));
      assert.ok(Number.isFinite(parseFloat(part.cssWidth))&&Number.isFinite(parseFloat(part.cssHeight)),label+' resolved dimensions '+JSON.stringify(part));
     }
     for(const target of geometry.targets){
      assert.ok(target.width>0&&target.height>0,label+' nonzero target '+JSON.stringify(target));
      assert.ok(target.x>=-.5&&target.y>=-.5&&target.right<=viewport.width+.5&&target.bottom<=viewport.height+.5,label+' target inside viewport '+JSON.stringify(target));
      assert.equal(target.hit,true,label+' center must hit its own control '+JSON.stringify(target));
     }
     const [shell,left,right]=geometry.parts;
     assert.ok(left.right<right.x-1,label+' left and right control surfaces remain separated');
     if(model==='xiaobai'||model==='spark-ai'){
      const expected=Math.min(viewport.width*.29,viewport.height-150,330);
      for(const pad of [left,right]){assert.ok(Math.abs(pad.width-expected)<1,label+' vh-sized pad '+JSON.stringify(pad));assert.ok(Math.abs(pad.width-pad.height)<1,label+' square pad');}
      assert.ok(shell.height>=left.height+50,label+' shell contains pads plus shoulders');
      assert.equal(geometry.targets.filter(t=>['up','down','left','right','Y','A','X','B','L','R'].includes(t.key)).length,10);
      const color=await point('[data-remote-key=Y]',2),up=await point('#xb-dpad-demo .scene',1,.5,.175);
      await touch('touchStart',[color]);await touch('touchStart',[up,color]);await expectTenKeys(['up','Y']);
      const rightTouch=await point('#xb-dpad-demo .scene',1,.825,.5);
      await touch('touchMove',[rightTouch,color]);await expectTenKeys(['right','Y']);
      await touch('touchEnd',[rightTouch]);await expectTenKeys(['Y']);
      await touch('touchEnd',[]);await expectTenKeys([]);
     }else if(model==='tc01'){
      const expected=Math.max(112,Math.min(244,viewport.height-148));
      assert.ok(Math.abs(left.height-expected)<1&&Math.abs(right.height-expected)<1,label+' wells use the vh fallback');
      const leftTouch=await point('[data-motor=left] .well',1,.5,.18),rightTouch=await point('[data-motor=right] .well',2,.5,.82);
      await touch('touchStart',[leftTouch]);await touch('touchStart',[leftTouch,rightTouch]);await expectTc('forward','reverse','KEY_DATA=1001');
      await touch('touchEnd',[leftTouch]);await expectTc('stop','reverse','KEY_DATA=0001');
      await touch('touchEnd',[]);await expectTc('stop','stop','KEY_DATA=0000');
     }else{
      const expected=viewport.height<=330?Math.min(viewport.width*.27,viewport.height-135,175):Math.min(viewport.width*.28,viewport.height-112,220);
      assert.ok(Math.abs(left.width-expected)<1&&Math.abs(left.width-left.height)<1,label+' LBS breakpoint keeps a valid square pad');
      assert.ok(left.x+left.width/2<shell.x+shell.width/2,label+' direction pad remains on the left');
      const finger=await point('#lbs-dpad-demo .scene',1,.5,.175);
      await touch('touchStart',[finger]);await expectLbs('forward');
      const next=await point('#lbs-dpad-demo .scene',1,.825,.5);
      await touch('touchMove',[next]);await expectLbs('right');
      await touch('touchEnd',[]);await expectLbs('stop');
      await page.locator('[data-speed="5"]').click();assert.equal(await page.locator('.lbs-gear.lit').count(),5,label+' all five gear lamps remain separate and reachable');
     }
     console.log('PASS '+label+': legacy vh dimensions, separated surfaces, touch hits and release-to-stop');
    }
    await page.evaluate(()=>CardModelSession.current.remote.close());
    await page.waitForFunction(()=>!document.querySelector('.remote-dialog[open]')&&!CardPageTransition.busy);
    assert.deepEqual(errors,[],model+' page errors');
   }finally{await context.close();}
  }
  console.log('PASS all four remotes with unsupported dvh CSS simulation at 844x390 and 568x280.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
