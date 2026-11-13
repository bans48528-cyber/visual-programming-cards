'use strict';
// Uses the production Web build in isolated contexts, with no radio/native transport.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {staticServer}=require('./editor-start-palette.spec.cjs');
const out=path.resolve(__dirname,'../artifacts');
const viewports=[{name:'phone',width:844,height:390},{name:'tablet',width:1280,height:800}];
const state=groups=>({schemaVersion:2,kind:'free-canvas',groups,viewport:{x:0,y:0,scale:1},selectedGroupId:groups[0]?.id||null});
const group=(id,trigger,items=[{uid:id+'-wait',id:'wait-time',params:{duration:1}}])=>({id,startId:id+'-head',x:75,y:125,items,...(trigger?{trigger}:{})});
const current=page=>page.evaluate(()=>CardEditor.getWorkspace());
const idle=page=>page.waitForFunction(()=>window.CardEditor&&window.CardCanvas&&!window.CardPageTransition?.busy);
async function load(page,value){await page.evaluate(value=>CardEditor.setWorkspace(value),value);}
async function run(browser,url,viewport,modelId='xiaobai'){
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},hasTouch:true,reducedMotion:'reduce'});
  await context.addInitScript(model=>localStorage.setItem('cardDefaultModelV1',model),modelId);
  const page=await context.newPage(),errors=[],cases=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(url+'#home');await idle(page);await page.locator('#newProject').click();await idle(page);
    const ids=await page.locator('#palette > [data-card-id]').evaluateAll(els=>els.map(el=>el.dataset.cardId));
    if(modelId!=='xiaobai'){
      assert.equal(ids.includes('__message_start__'),false);assert.equal(ids.includes('send-message'),false);
      assert.equal(await page.locator('#chain .head-param-trigger').count(),0);
      return{modelId,viewport:viewport.name,cases:['model-isolation'],pass:true};
    }
    assert.deepEqual(ids.slice(0,2),['__start__','__message_start__']);assert.equal(ids.filter(id=>id==='__message_start__').length,1);
    assert.equal(await page.locator('#palette [data-card-id="send-message"]').getAttribute('data-palette-category'),'logic');cases.push('single-message-palette-entry-and-logic-send');
    assert.equal(await page.locator('#palette [data-card-id="__start__"] .param-bubble').count(),0);
    assert.equal(await page.locator('#chain .free-canvas-start .param-bubble').count(),0);
    await load(page,state([group('ordinary')]));
    const ordinaryBox=await page.locator('#chain .free-canvas-start').boundingBox();
    await page.mouse.move(ordinaryBox.x+32,ordinaryBox.y+28);await page.mouse.down();
    await page.mouse.move(ordinaryBox.x+122,ordinaryBox.y+63,{steps:8});
    assert.equal(await page.locator('.free-canvas-ghost > .free-canvas-start .param-bubble').count(),0);
    assert.equal(await page.locator('.free-canvas-ghost > .free-canvas-start .head-param-trigger').count(),0);
    await page.mouse.up();assert.equal(Object.hasOwn((await current(page)).groups[0],'trigger'),false);
    cases.push('ordinary-head-real-drag-ghost-has-no-parameters');
    await page.evaluate(()=>{window.messageHeadOriginalProgram=CardProgram;window.messageHeadRunCalls=[];window.CardProgram={...CardProgram,runGroup:id=>messageHeadRunCalls.push(id)};});
    await page.locator('#chain .free-canvas-start').click({position:{x:32,y:28}});
    assert.deepEqual(await page.evaluate(()=>messageHeadRunCalls),['ordinary']);
    assert.equal(await page.locator('#paramEditor').isVisible(),false);
    await page.evaluate(()=>{window.CardProgram=window.messageHeadOriginalProgram;delete window.messageHeadOriginalProgram;delete window.messageHeadRunCalls;});
    cases.push('normal-head-has-no-param-and-tap-runs-group');
    await page.locator('#palette [data-card-id="__start__"]').click();
    assert.equal((await current(page)).groups.filter(g=>g.startId&&!Object.hasOwn(g,'trigger')).length,2);
    assert.equal(await page.locator('#chain .free-canvas-start .param-bubble').count(),0);
    await page.locator('#palette [data-card-id="__message_start__"]').click();
    let doc=await current(page),message=doc.groups.find(g=>g.trigger);assert.deepEqual(message.trigger,{type:'message',message:1});
    assert.equal(doc.groups.length,3);assert.equal(doc.groups.filter(g=>g.trigger?.type==='message').length,1);cases.push('normal-and-message-heads-created-independently');
    await load(page,state([group('message',{type:'message',message:1})]));
    await page.evaluate(()=>{window.messageHeadOriginalProgram=CardProgram;window.messageHeadRunCalls=[];window.CardProgram={...CardProgram,runGroup:id=>messageHeadRunCalls.push(id)};});
    await page.locator('#chain .free-canvas-start.message-start').click({position:{x:32,y:28}});
    assert.deepEqual(await page.evaluate(()=>messageHeadRunCalls),['message']);
    await page.evaluate(()=>{window.CardProgram=window.messageHeadOriginalProgram;delete window.messageHeadOriginalProgram;delete window.messageHeadRunCalls;});
    cases.push('message-envelope-body-tap-runs-only-requested-group');
    await page.locator('#chain .head-param-trigger').click();
    const dialog=page.locator('#paramEditor');await dialog.waitFor({state:'visible'});
    assert.equal(await dialog.locator('.message-option').count(),6);
    assert.equal(await dialog.locator('[data-trigger-type], .head-trigger-types').count(),0,'message heads must offer colors only');
    const options=await dialog.locator('.message-option').evaluateAll(els=>els.map(el=>({message:Number(el.dataset.message),label:el.getAttribute('aria-label')})));
    assert.deepEqual(options.map(o=>o.message),[1,2,3,4,5,6]);assert.deepEqual(options.map(o=>o.label),['红色消息 1','橙色消息 2','黄色消息 3','绿色消息 4','蓝色消息 5','紫色消息 6']);
    await dialog.locator('[data-message="6"]').click();assert.deepEqual((await current(page)).groups[0].trigger,{type:'message',message:6});
    await page.evaluate(()=>CardEditor.undo());assert.equal((await current(page)).groups[0].trigger.message,1);
    await page.evaluate(()=>CardEditor.redo());assert.equal((await current(page)).groups[0].trigger.message,6);cases.push('six-colors-head-edit-one-undo-redo');
    await page.locator('#chain .head-param-trigger').click();
    const rect=await dialog.boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+.5&&rect.y+rect.height<=viewport.height+.5);
    await page.screenshot({path:path.join(out,`message-heads-separate-${viewport.name}-head-options.png`)});cases.push('responsive-head-options');
    await page.evaluate(()=>document.getElementById('paramEditor').hidden=true);
    await page.locator('#tab-logic').click();await page.locator('#palette [data-card-id="send-message"]').click();
    await page.locator('#chain [data-card-id="send-message"] > .param-bubble').click();
    await dialog.locator('[data-message="5"]').click();doc=await current(page);
    assert.equal(doc.groups[0].items.at(-1).params.message,5);assert.match(await page.locator('#chain [data-card-id="send-message"] > .param-bubble').textContent(),/蓝色5/);
    cases.push('send-message-color-parameter');
    const snapshot=await page.evaluate(()=>CardEditor.getRunSnapshot({groupId:'message'}));assert.equal(snapshot.manualGroupId,'message');assert.equal(snapshot.groups.length,1);assert.deepEqual(snapshot.groups[0].trigger,{type:'message',message:6});
    assert.match(await page.evaluate(()=>{try{CardEditor.getRunSnapshot();return''}catch(e){return e.message}}),/普通开始头/);cases.push('manual-single-group-and-global-normal-required');
    const normal=group('normal',null,[{uid:'normal-send',id:'send-message',params:{message:3}}]);normal.x=350;await load(page,state([group('message',{type:'message',message:3}),normal]));
    const global=await page.evaluate(()=>CardEditor.getRunSnapshot());assert.equal(global.groups.length,2);assert.equal(Object.hasOwn(global,'manualGroupId'),false);assert.equal(Object.hasOwn(global.groups.find(g=>g.groupId==='normal'),'trigger'),false);cases.push('global-trigger-snapshot');
    assert.equal(await page.locator('#chain .free-canvas-start:not(.message-start) .param-bubble').count(),0);
    await page.screenshot({path:path.join(out,`message-heads-separate-${viewport.name}-canvas.png`)});
    // Exercise the actual Save/Home/Open path and its rendered miniature heads.
    const stored=await current(page);
    await page.locator('#editorToolsToggle').click();await page.locator('#saveBtn').click();
    await page.locator('.home-dialog input').fill('消息积木回归');await page.locator('.home-dialog [type=submit]').click();
    await page.locator('#homeBtn').click();await idle(page);
    const project=page.getByRole('button',{name:'打开：消息积木回归',exact:true});
    assert.equal(await project.locator('.home-preview-chain .start').count(),2);
    const miniature=project.locator('.home-preview-chain .message-start');assert.equal(await miniature.count(),1);
    assert.match(await miniature.locator('img').getAttribute('src'),/message-envelope\.svg/);
    const thumbnailColor=await miniature.evaluate(el=>getComputedStyle(el).getPropertyValue('--block-color').trim());
    assert.equal(thumbnailColor,await page.evaluate(()=>CardModelSession.current.messageColors[2].color));
    await page.screenshot({path:path.join(out,`message-heads-separate-${viewport.name}-home.png`)});
    await project.locator('..').locator('.home-menu > summary').click();
    await project.locator('..').getByRole('button',{name:'复制',exact:true}).click();
    const copy=page.getByRole('button',{name:'打开：消息积木回归 副本',exact:true});
    assert.equal(await copy.locator('.home-preview-chain .message-start').count(),1);
    assert.equal(await copy.locator('.home-preview-chain .message-start').evaluate(el=>getComputedStyle(el).getPropertyValue('--block-color').trim()),thumbnailColor);
    await copy.click();await idle(page);assert.deepEqual(await current(page),stored);
    assert.equal(await page.locator('#chain .free-canvas-start:not(.message-start) .param-bubble').count(),0);
    assert.deepEqual((await current(page)).groups.find(g=>g.id==='message').trigger,{type:'message',message:3});
    assert.equal(Object.hasOwn((await current(page)).groups.find(g=>g.id==='normal'),'trigger'),false);
    await page.locator('#homeBtn').click();await idle(page);cases.push('existing-project-copy-retains-both-head-types');
    await project.click();await idle(page);assert.deepEqual(await current(page),stored);
    assert.equal(await page.locator('#chain .free-canvas-start:not(.message-start) .head-param-trigger').count(),0);
    await page.reload();await idle(page);assert.deepEqual(await current(page),stored);
    assert.equal(await page.locator('#chain .free-canvas-start:not(.message-start) .param-bubble').count(),0);cases.push('save-home-message-thumbnail-reopen');
    // Drag a suffix away from each kind of head. The detached group has no trigger,
    // while the source retains exactly its original ordinary/message start type.
    for(const kind of ['ordinary','message']){
      const id='split-'+kind,trigger=kind==='message'?{type:'message',message:2}:null;
      const items=[{uid:id+'-first',id:'wait-time',params:{duration:1}},{uid:id+'-tail',id:'wait-time',params:{duration:2}}];
      await load(page,state([group(id,trigger,items)]));
      const tail=await page.locator(`#chain [data-node-uid="${id}-tail"]`).boundingBox();
      await page.mouse.move(tail.x+32,tail.y+28);await page.mouse.down();await page.mouse.move(tail.x+110,tail.y+100,{steps:8});await page.mouse.up();
      const split=await current(page),source=split.groups.find(g=>g.id===id),detached=split.groups.find(g=>g.id!==id);
      assert.equal(split.groups.length,2);assert.equal(source.items.length,1);assert.deepEqual(source.trigger||null,trigger);
      assert.equal(detached.startId,null);assert.equal(Object.hasOwn(detached,'trigger'),false);assert.equal(detached.items[0].uid,id+'-tail');
      cases.push(kind+'-head-split-retains-type');
    }
    // A real drag of a message head preserves its trigger, and cancellation restores it.
    await load(page,state([group('drag',{type:'message',message:4})]));
    const head=page.locator('#chain .free-canvas-start'),box=await head.boundingBox();
    await page.mouse.move(box.x+32,box.y+28);await page.mouse.down();await page.mouse.move(box.x+122,box.y+63,{steps:8});await page.mouse.up();
    doc=await current(page);assert.deepEqual(doc.groups[0].trigger,{type:'message',message:4});assert.ok(doc.groups[0].x>100);cases.push('head-drag-preserves-trigger');
    const before=await current(page),moved=await head.boundingBox();await page.mouse.move(moved.x+32,moved.y+28);await page.mouse.down();await page.mouse.move(moved.x+92,moved.y+43,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await current(page),before);cases.push('cancel-restores-message-head');
    const four=Array.from({length:4},(_,i)=>({...group('limit'+i),x:50+i*150}));await load(page,state(four));
    assert.equal(await page.evaluate(()=>CardCanvas.add('__message_start__')),false);assert.equal((await current(page)).groups.length,4);
    await load(page,state([...four,group('fifth')]));assert.match(await page.evaluate(()=>{try{CardEditor.getRunSnapshot({groupId:'limit0'});return''}catch(e){return e.message}}),/4 个开始头/);cases.push('four-head-limit-cannot-be-bypassed');
    assert.deepEqual(errors,[]);return{modelId,viewport:viewport.name,cases,pass:true,copyCoverage:'Existing home project menu Copy path verified; no new canvas duplicate feature.'};
  }finally{await context.close();}
}
(async()=>{fs.mkdirSync(out,{recursive:true});const server=await staticServer(),browser=await chromium.launch({channel:'msedge',headless:true});try{const results=[];for(const v of viewports)results.push(await run(browser,server.url,v));for(const id of ['spark-ai','lbs2206','tc01','receiver2226'])results.push(await run(browser,server.url,viewports[0],id));console.log(JSON.stringify({pass:true,contexts:results.length,cases:results.reduce((n,r)=>n+r.cases.length,0),results},null,2));}finally{await browser.close();await server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
