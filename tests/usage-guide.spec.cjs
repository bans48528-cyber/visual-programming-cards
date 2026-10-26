const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.CARD_TEST_URL||'http://127.0.0.1:4173/dist/';
const projectsKey='cardModel:xiaobai:projects:v1';

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
    await context.addInitScript(()=>{
      localStorage.setItem('cardDefaultModelV1','xiaobai');
      // Native media decoding is retained; only pause invocations are observed.
      const nativePause=HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.pause=function(){
        this.testPauseCount=(this.testPauseCount||0)+1;
        return nativePause.call(this);
      };
    });
    const page=await context.newPage(),errors=[],bad=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.status()>=400)bad.push(response.url());});
    page.on('request',request=>requests.push(request.url()));
    const idle=()=>page.waitForFunction(()=>!CardPageTransition.busy);
    const readerReady=()=>page.locator('#buildingBooksReader[data-phase=open]').waitFor();
    const guideReady=()=>page.waitForFunction(()=>{
      const guide=CardUsageGuide.getState();
      return guide.state==='expanded'&&!guide.pending&&guide.visible&&!guide.suspended;
    });
    const bookPage=()=>page.locator('#bb-spread').getAttribute('data-page');
    const guideState=()=>page.evaluate(()=>CardUsageGuide.getState());
    const videoRequests=()=>requests.filter(url=>/\.mp4(?:\?|$)/i.test(url));
    const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'[]'),projectsKey);
    async function selectBookPage(number){
      await readerReady();
      while(Number(await bookPage())<number){await page.locator('#bb-next-page').tap();await readerReady();}
      while(Number(await bookPage())>number){await page.locator('#bb-prev-page').tap();await readerReady();}
    }
    async function openFinalBuilding(name){
      await page.getByRole('button',{name:'去搭建'+name,exact:true}).tap();
      const viewer=page.frameLocator('.building-viewer iframe');
      await viewer.locator('body[data-ready=true]').waitFor({timeout:60000});
      const frame=page.frames().find(frame=>frame.url().includes('/instructions.html'));
      assert(frame,'real instruction manager loaded');
      const total=await frame.evaluate(()=>{
        const total=manager.stepHandler.totalNumberOfSteps;
        manager.goToStep(total);return total;
      });
      await frame.waitForFunction(total=>manager.currentStep===total,total);
      const complete=viewer.getByRole('button',{name:/^完成搭建/});
      await complete.waitFor({state:'visible'});
      return {total,complete,frame};
    }
    async function completeBuilding(name){
      const {total,complete}=await openFinalBuilding(name);await complete.tap();
      await page.locator('.building-viewer').waitFor({state:'hidden'});await idle();
      return total;
    }
    async function verifyGuideGeometry(){
      const size=page.viewportSize();
      const controls=await page.locator('#usageGuidePanel,.usage-guide-prev,.usage-guide-next,.usage-guide-toggle').evaluateAll(elements=>elements.map(element=>{
        const r=element.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};
      }));
      assert(controls.every(r=>r.x>=0&&r.y>=0&&r.right<=size.width+.5&&r.bottom<=size.height+.5),'guide fits '+JSON.stringify(size)+' '+JSON.stringify(controls));
      assert.equal(await page.locator('.usage-guide-media').isVisible(),true);
      assert.equal(await page.locator('.usage-guide-copy').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.evaluate(()=>{
        const button=document.querySelector('.usage-guide-toggle');
        for(let i=0;i<8;i++)button.click();
      });
      await page.waitForTimeout(340);
      assert.equal((await guideState()).state,'expanded','rapid toggles settle on the final state');
      assert.equal(await page.locator('#usageGuidePanel').getAttribute('aria-hidden'),null);
    }

    await page.goto(base+'#home');
    await page.waitForFunction(()=>window.CardCompanionCatalog&&window.CardUsageGuide&&window.CardCompanionPrograms);
    assert.equal(videoRequests().length,0,'home does not preload guide videos');
    const initial=await stored();
    const definitions=await page.evaluate(async()=>{
      const robot=await CardCompanionCatalog.get('guide-robot-intro','xiaobai');
      const swing=await CardCompanionCatalog.get('guide-swing-intro','xiaobai');
      return {robot,swing,robotGuide:await CardCompanionCatalog.getGuide(robot.guideId),swingGuide:await CardCompanionCatalog.getGuide(swing.guideId)};
    });
    assert.deepEqual(definitions.robot.state.program.map(item=>item.id),['eye-expression','speech-play']);
    assert.deepEqual(definitions.swing.state.program.map(item=>item.id),['eye-matrix','tilt-wait','eye-expression']);
    assert.deepEqual(definitions.robotGuide.pages.map(page=>page.media.type),['images','video','video','video','video']);
    assert.deepEqual(definitions.swingGuide.pages.map(page=>page.media.type),['image','image','video','image']);
    assert.equal(videoRequests().length,0,'catalog lookup reads metadata without preloading videos');
    await page.getByRole('tab',{name:'搭建图',exact:true}).tap();
    await page.getByRole('button',{name:'打开入门指南，6页',exact:true}).tap();await readerReady();
    const robotSteps=await completeBuilding('小白机器人');
    assert(robotSteps>1);await guideReady();
    assert.equal(await page.evaluate(()=>location.hash),'#editor');
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isTemplate),true);
    assert.deepEqual(await stored(),initial,'finishing a model never inserts the built-in template in My Works');
    assert.deepEqual(await page.evaluate(()=>program.map(item=>item.id)),['eye-expression','speech-play']);
    assert.equal((await guideState()).pageCount,5);assert.equal((await guideState()).pageIndex,0);
    assert.equal(await page.locator('.usage-guide-media img').count(),2);
    assert.equal(videoRequests().length,0,'only first-page media is loaded');
    await verifyGuideGeometry();

    await page.locator('.usage-guide-next').tap();
    await page.waitForFunction(()=>document.querySelector('.usage-guide-media video')?.getAttribute('src'));
    assert.equal((await guideState()).pageIndex,1);
    const firstVideo=await page.evaluate(()=>{
      window.retiredGuideVideo=document.querySelector('.usage-guide-media video');
      return {src:retiredGuideVideo.getAttribute('src'),pauses:retiredGuideVideo.testPauseCount||0};
    });
    assert.equal(await page.locator('.usage-guide-media video').getAttribute('preload'),'metadata');
    assert.equal(await page.locator('.usage-guide-media video').getAttribute('playsinline'),'');
    await page.locator('.usage-guide-toggle').tap();
    assert.equal((await guideState()).state,'collapsed');
    assert.equal(await page.evaluate(()=>retiredGuideVideo.getAttribute('src')),firstVideo.src,'collapse preserves the current video position');
    assert.equal(await page.evaluate(()=>retiredGuideVideo.testPauseCount>0),true,'collapse pauses media');
    assert.equal(await page.locator('#usageGuidePanel').evaluate(element=>element.inert),true);
    await page.locator('.usage-guide-toggle').tap();assert.equal((await guideState()).pageIndex,1);
    await page.locator('.usage-guide-next').tap();
    assert.equal((await guideState()).pageIndex,2);
    assert.equal(await page.evaluate(()=>retiredGuideVideo.getAttribute('src')),null,'turning pages clears the retired media source');
    assert.equal(await page.evaluate(()=>retiredGuideVideo.paused),true);
    const assignedVideos=videoRequests();
    assert(assignedVideos.every(url=>[definitions.robotGuide.pages[1].media.src,definitions.robotGuide.pages[2].media.src].some(src=>url.endsWith(src)||url.includes(encodeURI(src)))),'later videos remain lazy');

    const beforeBluetooth=await guideState();
    await page.evaluate(()=>{
      window.retiredGuideVideo=document.querySelector('.usage-guide-media video');
      CardOpenBluetooth('#editor');
    });
    await page.waitForURL('**/#bluetooth');
    await page.locator('.bluetooth-page:not([hidden])').waitFor({state:'visible'});
    assert.equal(await page.locator('#usageGuideLayer').isVisible(),false,'Bluetooth is not covered by the guide');
    assert.equal(await page.evaluate(()=>retiredGuideVideo.paused),true,'Bluetooth routing pauses the current video');
    assert.equal(await page.evaluate(()=>retiredGuideVideo.testPauseCount>0),true);
    await page.locator('.bluetooth-page:not([hidden]) .bt-back').tap();
    await page.waitForURL('**/#editor');await idle();await guideReady();
    assert.equal((await guideState()).pageIndex,beforeBluetooth.pageIndex,'Bluetooth back preserves the guide page');
    assert.equal((await guideState()).resumeKey,beforeBluetooth.resumeKey);
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isTemplate),true,'Bluetooth back preserves the template session');
    assert.equal(await page.evaluate(()=>document.querySelector('.usage-guide-media video').paused),true,'Bluetooth return does not autoplay media');

    await page.evaluate(()=>document.getElementById('saveBtn').click());
    await page.locator('.home-dialog input').fill('我的小白入门练习');
    await page.locator('.home-dialog [type=submit]').click();
    const copies=await stored(),copy=copies.find(project=>project.name==='我的小白入门练习');
    assert(copy);assert.equal(copies.length,initial.length+1);assert.equal(copy.companionId,'guide-robot-intro');
    assert.equal(copy.guideId,definitions.robot.guideId);assert.equal((await guideState()).pageIndex,2,'Save As retains the current guide page');
    await page.evaluate(()=>{
      window.retiredGuideVideo=document.querySelector('.usage-guide-media video');
      document.getElementById('homeBtn').click();
    });await idle();await readerReady();
    assert.equal(await bookPage(),'1');assert.equal(await page.locator('#bb-reader-title').textContent(),'入门指南');
    assert.equal((await guideState()).state,'closed');
    assert.equal(await page.evaluate(()=>retiredGuideVideo?.getAttribute('src')),null,'leaving the editor releases guide media');
    await page.locator('#bb-close-reader').tap();await page.locator('#buildingBooksReader').waitFor({state:'hidden'});
    await page.getByRole('tab',{name:'我的作品',exact:true}).tap();
    await page.getByRole('button',{name:'打开：我的小白入门练习',exact:true}).tap();await idle();await guideReady();
    assert.equal((await guideState()).pageIndex,2,'reopening the saved copy automatically restores its guide');
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isTemplate),false);
    await page.reload();await idle();await guideReady();
    assert.equal((await guideState()).guideId,definitions.robot.guideId,'reloading an active saved copy also opens its guide');
    assert.deepEqual(await page.evaluate(()=>program.map(item=>item.id)),['eye-expression','speech-play']);
    await page.evaluate(()=>document.getElementById('homeBtn').click());await idle();

    await page.setViewportSize({width:751,height:360});
    await page.getByRole('tab',{name:'搭建图',exact:true}).tap();
    await page.getByRole('button',{name:'打开入门指南，6页',exact:true}).tap();await readerReady();
    await selectBookPage(2);await completeBuilding('摇摆模型');await guideReady();
    assert.equal((await guideState()).pageCount,4);assert.equal((await guideState()).pageIndex,0);
    assert.deepEqual(await page.evaluate(()=>program.map(item=>item.id)),['eye-matrix','tilt-wait','eye-expression']);
    assert.equal(await page.evaluate(()=>program[1].params.direction),'forward');
    await verifyGuideGeometry();
    await page.locator('.usage-guide-dots button').nth(2).tap();
    await page.waitForFunction(()=>document.querySelector('.usage-guide-media video')?.getAttribute('src'));
    await page.evaluate(()=>{window.retiredGuideVideo=document.querySelector('.usage-guide-media video');});
    await page.locator('.usage-guide-next').tap();
    assert.equal((await guideState()).pageIndex,3);assert.equal(await page.locator('.usage-guide-media img').count(),1);
    assert.equal(await page.evaluate(()=>retiredGuideVideo.getAttribute('src')),null);
    await page.evaluate(()=>document.getElementById('homeBtn').click());await idle();await readerReady();
    assert.equal(await bookPage(),'2','the second model returns to its original album page');
    assert.equal((await stored()).length,initial.length+1,'unsaved second-model template does not create a user work');

    await selectBookPage(3);await completeBuilding('小风扇');await readerReady();
    assert.equal(await bookPage(),'3','a model without a companion program keeps the existing completion return');
    assert.equal(await page.evaluate(()=>location.hash),'#home');
    assert.equal((await guideState()).state,'closed');
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isActive),false);

    // A canceled catalog request must not open a stale template after the viewer has returned.
    await selectBookPage(1);
    let final=await openFinalBuilding('小白机器人');
    await page.evaluate(()=>{
      window.originalGuideCatalogGet=CardCompanionCatalog.get;window.guideCatalogCalls=0;
      CardCompanionCatalog.get=(...args)=>{
        guideCatalogCalls++;
        return new Promise(resolve=>window.finishGuideCatalog=async()=>resolve(await originalGuideCatalogGet(...args)));
      };
    });
    await final.complete.tap();await page.waitForFunction(()=>typeof finishGuideCatalog==='function');
    await final.frame.evaluate(()=>viewerExit('complete'));
    assert.equal(await page.evaluate(()=>guideCatalogCalls),1,'duplicate completion notifications share one request');
    await page.locator('.building-loading-back').tap();
    await page.locator('.building-viewer').waitFor({state:'hidden'});await idle();await readerReady();
    await page.evaluate(async()=>{CardCompanionCatalog.get=originalGuideCatalogGet;await finishGuideCatalog();});
    await page.waitForTimeout(80);
    assert.equal(await bookPage(),'1');
    assert.equal(await page.evaluate(()=>location.hash),'#home');
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isActive),false,'late catalog results are ignored');

    // The second stop belongs to opening the companion, after the album has been suspended.
    await selectBookPage(2);final=await openFinalBuilding('摇摆模型');
    await page.evaluate(()=>{
      window.originalGuideProgramStop=CardProgram.stop;
      CardProgram.stop=()=>new Promise(resolve=>window.finishGuideProgramStop=resolve);
    });
    await final.complete.tap();await page.waitForFunction(()=>typeof finishGuideProgramStop==='function');
    assert.equal(await page.locator('#buildingBooksReader').isVisible(),false);
    await page.locator('.building-loading-back').tap();
    await page.locator('.building-viewer').waitFor({state:'hidden'});await idle();
    await page.evaluate(()=>{CardProgram.stop=originalGuideProgramStop;finishGuideProgramStop();});
    await readerReady();await idle();
    assert.equal(await bookPage(),'2','canceling after album suspension restores the same model page');
    assert.equal(await page.evaluate(()=>location.hash),'#home');
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isActive),false,'a canceled delayed stop cannot open the template later');

    // Opening errors stay in the viewer until explicit return, with one top-layer dialog.
    await selectBookPage(1);final=await openFinalBuilding('小白机器人');
    await page.evaluate(()=>{
      window.originalGuideCompanionOpen=CardCompanionPrograms.open;
      CardCompanionPrograms.open=async()=>{throw new Error('测试：配套程序暂时无法打开');};
    });
    await final.complete.tap();
    await page.getByText('测试：配套程序暂时无法打开',{exact:true}).waitFor();await idle();
    assert.equal(await page.locator('.building-viewer').isVisible(),true);
    assert.equal(await page.locator('#buildingBooksReader').isVisible(),false,'the restored album must not cover the error');
    assert.equal(await page.locator('dialog[open]').count(),1);
    await page.locator('.building-loading-back').tap();
    await page.locator('.building-viewer').waitFor({state:'hidden'});await idle();await readerReady();
    await page.evaluate(()=>{CardCompanionPrograms.open=originalGuideCompanionOpen;});
    assert.equal(await bookPage(),'1','returning from a failed open restores the suspended album');
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isActive),false);
    assert.equal((await stored()).length,initial.length+1,'failed and canceled opens never save template rows');
    assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);
    await context.close();
    console.log('PASS usage guide: real building completion, two supplied guides/programs, lazy native media lifecycle, Save As/reload and Bluetooth return, album/page return, no-program completion, delayed/duplicate/canceled/failed opens, rapid toggles and 844×390 / 751×360 layouts.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
