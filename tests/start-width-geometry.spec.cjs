'use strict';
// Real shipping renderer + pointer handlers, disposable browser storage. No hardware.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {staticServer}=require('./editor-start-palette.spec.cjs');
const artifacts=path.resolve(__dirname,'../artifacts');
const viewports=[{name:'phone',width:844,height:390},{name:'tablet',width:1280,height:800}];
const card=uid=>({uid,id:'wait-time',params:{duration:1}});
const documentState=(groups,scale=1)=>({schemaVersion:2,kind:'free-canvas',groups,viewport:{x:0,y:0,scale},selectedGroupId:groups[0]?.id||null});
const headed=(id,kind,x,y,items)=>({id,startId:id+'-head',x,y,items,...(kind==='message'?{trigger:{type:'message',message:3}}:{})});
const idle=page=>page.waitForFunction(()=>window.CardEditor&&window.CardCanvas&&!window.CardPageTransition?.busy);
const frame=page=>page.evaluate(()=>new Promise(requestAnimationFrame));
async function load(page,value){await page.evaluate(value=>CardEditor.setWorkspace(value),value);await frame(page);}
async function metrics(locator){return locator.evaluate(el=>{
  let scale=1;
  for(let n=el;n;n=n.parentElement){const s=getComputedStyle(n),z=parseFloat(s.zoom);scale*=Number.isFinite(z)?z:1;if(s.transform!=='none'){const m=new DOMMatrixReadOnly(s.transform);scale*=Math.hypot(m.a,m.b);}}
  const r=el.getBoundingClientRect(),svg=el.querySelector(':scope > .block-outline'),p=svg?.firstElementChild,b=p?.getBBox(),sr=svg?.getBoundingClientRect();
  return {x:r.x,y:r.y,width:r.width,height:r.height,scale,normalizedWidth:r.width/scale,advance:Number(el.dataset.advance),anchor:Number(el.dataset.connectorY),
    svgViewBox:svg?.getAttribute('viewBox'),normalizedOutlineWidth:sr&&sr.width/scale,
    path:b&&{x:b.x,y:b.y,width:b.width,height:b.height},bubbles:el.querySelectorAll(':scope > .param-bubble').length};
});}
const near=(a,b,message,tolerance=.15)=>assert.ok(Math.abs(a-b)<tolerance,`${message}: ${a} != ${b}`);
function sameWidth(actual,reference,label){
  near(actual.normalizedWidth,84,label+' actual bbox normalized by ancestor transforms/zoom');
  assert.equal(actual.advance,76,label+' connector advance');
  assert.equal(actual.svgViewBox,'-1 -1 86 74',label+' outline viewBox');
  near(actual.normalizedOutlineWidth,86,label+' SVG bbox');
  near(actual.path.x,0,label+' path left');near(actual.path.y,0,label+' path top');
  near(actual.path.width,84,label+' path width');near(actual.path.height,72,label+' path height');
  if(reference){near(actual.normalizedWidth,reference.normalizedWidth,label+' ordinary block width');assert.equal(actual.svgViewBox,reference.svgViewBox);assert.deepEqual(actual.path,reference.path);}
}
async function exercise(browser,base,viewport){
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},hasTouch:true,reducedMotion:'reduce'});
  await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
  const page=await context.newPage(),errors=[],cases=[];let maxProjectionError=0;
  page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(base+'#home');await idle(page);await page.locator('#newProject').click();await idle(page);
    const ordinaryPalette=await metrics(page.locator('#palette > [data-card-id="motor-forward"]'));
    for(const [kind,id] of [['ordinary','__start__'],['message','__message_start__']]){
      const m=await metrics(page.locator(`#palette > [data-card-id="${id}"]`));sameWidth(m,ordinaryPalette,kind+' palette');
      if(kind==='ordinary')assert.equal(m.bubbles,0);cases.push({case:'palette-width',kind,geometry:m});
    }
    for(const scale of [.6,1,1.8])for(const kind of ['ordinary','message']){
      const source=headed('source',kind,180/scale,150/scale,[card('source-body')]);
      const target={id:'target',startId:null,x:600/scale,y:110/scale,items:[card('target-body')]};
      await load(page,documentState([source,target],scale));
      const head=page.locator('#chain [data-group-id="source"] > .free-canvas-start');
      const hm=await metrics(head),regular=await metrics(page.locator('#chain [data-node-uid="source-body"]'));
      sameWidth(hm,regular,`${kind} canvas @${scale}`);near(regular.x-hm.x,76*scale,'canvas connection step');
      if(kind==='ordinary')assert.equal(hm.bubbles,0);else assert.equal(hm.bubbles,1);
      cases.push({case:'canvas-width-and-step',kind,scale,geometry:hm});
      // A real pointer drag transports the same full head + action payload.
      const down={x:hm.x+20*scale,y:hm.y+hm.anchor*scale};
      await page.mouse.move(down.x,down.y);await page.mouse.down();await page.mouse.move(down.x+14,down.y,{steps:3});await frame(page);
      assert.equal(await page.evaluate(()=>CardCanvas.getGesture()?.active),true);
      const ghost=page.locator('.free-canvas-ghost > .free-canvas-start'),gm=await metrics(ghost);
      sameWidth(gm,await metrics(page.locator('.free-canvas-ghost > .program-block')),`${kind} ghost @${scale}`);
      if(kind==='ordinary')assert.equal(gm.bubbles,0);
      cases.push({case:'real-drag-ghost-width',kind,scale,geometry:gm});
      if(scale===1&&kind==='message')await page.screenshot({path:path.join(artifacts,`start-width-${viewport.name}-ghost.png`)});
      const slot=await page.evaluate(()=>CardCanvas.getSlots().find(s=>s.groupId==='target'&&s.side==='front'));
      assert.ok(slot,'headless target exposes the front port');
      const destination={x:slot.x-152*scale+20*scale,y:slot.y};
      await page.mouse.move(destination.x,destination.y,{steps:8});await frame(page);
      assert.equal((await page.evaluate(()=>CardCanvas.getGesture()?.target))?.side,'front');
      const projectedHead=await metrics(page.locator('.free-canvas-projection > .free-canvas-start'));
      sameWidth(projectedHead,await metrics(page.locator('.free-canvas-projection > .program-block')),`${kind} projection @${scale}`);
      const projectedBody=await metrics(page.locator('.free-canvas-projection > .program-block'));
      await page.mouse.up();await frame(page);
      assert.equal(await page.locator('.free-canvas-projection,.free-canvas-ghost').count(),0);
      const committedHead=await metrics(page.locator('#chain .free-canvas-start')),committedBody=await metrics(page.locator('#chain [data-node-uid="source-body"]'));
      for(const [name,before,after] of [['head',projectedHead,committedHead],['body',projectedBody,committedBody]])for(const key of ['x','y','width','height']){
        const error=Math.abs(before[key]-after[key]);maxProjectionError=Math.max(maxProjectionError,error);assert.ok(error<.5,`${kind}/${scale} projected ${name}.${key} changed ${error}px`);
      }
      const committed=await page.evaluate(()=>CardEditor.getWorkspace());assert.equal(committed.groups.length,1);assert.equal(committed.groups[0].startId,'source-head');
      assert.deepEqual(committed.groups[0].trigger||null,kind==='message'?{type:'message',message:3}:null);
      near(committedBody.x-committedHead.x,76*scale,'committed connection step');
      cases.push({case:'front-snap-projection-matches-commit',kind,scale,maxError:maxProjectionError});
      // A leading loop keeps its outside connection baseline aligned with the head.
      const loop={uid:'loop',id:'loop-count',params:{count:2},children:[card('inside')]};
      await load(page,documentState([headed('loop-group',kind,180/scale,150/scale,[loop])],scale));
      const lh=await metrics(page.locator('#chain .free-canvas-start')),lm=await metrics(page.locator('#chain [data-node-uid="loop"]'));
      sameWidth(lh,null,`${kind} before loop @${scale}`);near(lm.x-lh.x,76*scale,'loop follows head at full advance');
      near(lh.y+lh.anchor*scale,lm.y+lm.anchor*scale,'external connectors of head and loop align');
      cases.push({case:'first-loop-connector-alignment',kind,scale});
    }
    const pair=[headed('ordinary','ordinary',75,125,[card('ordinary-body')]),headed('message','message',350,125,[card('message-body')])];
    await load(page,documentState(pair));
    await page.locator('#chain .message-start .head-param-trigger').click();
    assert.equal(await page.locator('#paramEditor .message-option').count(),6);assert.equal(await page.locator('#paramEditor [data-trigger-type]').count(),0);
    await page.evaluate(()=>document.getElementById('paramEditor').hidden=true);cases.push({case:'message-retains-six-color-editor'});
    await page.screenshot({path:path.join(artifacts,`start-width-${viewport.name}-canvas.png`)});
    await page.locator('#editorToolsToggle').click();await page.locator('#saveBtn').click();
    await page.locator('.home-dialog input').fill('开始头宽度回归');await page.locator('.home-dialog [type=submit]').click();
    await page.locator('#homeBtn').click();await idle(page);
    const project=page.getByRole('button',{name:'打开：开始头宽度回归',exact:true});await project.scrollIntoViewIfNeeded();await frame(page);
    for(const kind of ['ordinary','message']){
      const sequence=project.locator(`.home-preview-chain[data-group-id="${kind}"]`);
      const hm=await metrics(sequence.locator(':scope > .start')),regular=await metrics(sequence.locator(':scope > .program-block'));
      sameWidth(hm,regular,kind+' home thumbnail');near(regular.x-hm.x,76*hm.scale,'thumbnail connection step');
      assert.equal(hm.bubbles,0);cases.push({case:'home-thumbnail-width',kind,geometry:hm});
    }
    await page.screenshot({path:path.join(artifacts,`start-width-${viewport.name}-home.png`)});
    assert.deepEqual(errors,[]);return{viewport:viewport.name,pass:true,cases,maxProjectionError};
  }finally{await context.close();}
}
(async()=>{fs.mkdirSync(artifacts,{recursive:true});const server=await staticServer(),browser=await chromium.launch({channel:'msedge',headless:true});try{const results=[];for(const v of viewports)results.push(await exercise(browser,server.url,v));console.log(JSON.stringify({pass:true,contexts:results.length,cases:results.reduce((n,r)=>n+r.cases.length,0),maxProjectionError:Math.max(...results.map(r=>r.maxProjectionError)),results},null,2));}finally{await browser.close();await server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
