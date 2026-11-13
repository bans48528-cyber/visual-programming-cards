'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {staticServer}=require('./editor-start-palette.spec.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const server=await staticServer(),browser=await chromium.launch({headless:true});
  try{
    for(const [modelId,width,height] of [['xiaobai',1280,800],['xiaobai',844,390],['tc01',844,390]]){
      const context=await browser.newContext({viewport:{width,height},hasTouch:true,reducedMotion:'reduce'});
      await context.addInitScript(id=>localStorage.setItem('cardDefaultModelV1',id),modelId);
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(server.url+'#home');
      await page.waitForFunction(()=>window.CardEditor&&window.CardCanvas&&!window.CardPageTransition?.busy);
      assert.equal(await page.evaluate(()=>CardModelSession.current.id),modelId);
      await page.locator('#newProject').click();
      await page.waitForFunction(()=>location.hash==='#editor'&&!window.CardPageTransition?.busy);
      if(modelId==='xiaobai'){
        await page.locator('#tab-logic').click();
        const waitSend=page.locator('#palette [data-card-id="send-message-wait"]');
        await waitSend.dispatchEvent('keydown',{key:'Enter',bubbles:true});
        const programCard=page.locator('#chain [data-card-id="send-message-wait"]');
        assert.equal(await programCard.count(),1);
        assert.match(await programCard.locator('.param-bubble').textContent(),/等待/);
        await page.evaluate(()=>CardHome.save());
        await page.locator('.home-dialog input').fill('WeDo消息等待测试');
        await page.locator('.home-dialog [type=submit]').click();
        const snapshot=await page.evaluate(()=>CardEditor.getWorkspace());
        await page.reload();await page.waitForFunction(()=>window.CardEditor&&window.CardCanvas&&!window.CardPageTransition?.busy);
        if(await page.locator('#resumeProject').isVisible())await page.locator('#resumeProject').click();
        await page.waitForFunction(()=>location.hash==='#editor'&&!window.CardPageTransition?.busy);
        assert.equal(await page.locator('#chain [data-card-id="send-message-wait"]').count(),1);
        const restored=await page.evaluate(()=>CardEditor.getWorkspace());
        assert.deepEqual(restored.groups,snapshot.groups);
      }
      const lockedState=await page.evaluate(()=>{
        window.groupHeadCalls=[];
        CardProgram.runGroup=id=>window.groupHeadCalls.push(id);
        CardEditor.setExecutionLocked(true);
        return {enabled:CardCanvas.setRunControlsEnabled(true),model:CardModelSession.current.id,locked:CardEditor.executionLocked,aria:document.querySelector('#chain .free-canvas-start')?.getAttribute('aria-disabled')};
      });
      assert.equal(lockedState.model,modelId);assert.equal(lockedState.enabled,modelId==='xiaobai');
      if(modelId!=='xiaobai'){
        assert.equal(lockedState.locked,true);assert.equal(lockedState.aria,'true');
        assert.deepEqual(errors,[]);console.log('PASS WeDo editor '+modelId+' locked-head capability');
        await context.close();continue;
      }
      const head=page.locator('#chain .free-canvas-start').first();
      await head.tap({force:modelId!=='xiaobai'});await pause(80);
      const calls=await page.evaluate(()=>window.groupHeadCalls.length);
      assert.equal(calls,modelId==='xiaobai'?1:0,'locked head must run only for XiaoBai v2');
      assert.equal(await head.getAttribute('aria-disabled'),modelId==='xiaobai'?'false':'true');
      const ordinaryDrop=await page.evaluate(()=>CardEditor.executionLocked);
      assert.equal(ordinaryDrop,true);
      await page.evaluate(()=>CardCanvas.setRunControlsEnabled(false));
      await head.tap({force:true});await pause(80);
      assert.equal(await page.evaluate(()=>window.groupHeadCalls.length),calls,'disabled head must remain locked');
      assert.deepEqual(errors,[]);
      console.log('PASS WeDo editor '+modelId+' '+width+'x'+height);
      await context.close();
    }
  }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
