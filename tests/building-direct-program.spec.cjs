const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.CARD_TEST_URL||'http://127.0.0.1:4173/dist/';
const key='cardModel:xiaobai:projects:v1';

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  for(const viewport of [{width:844,height:390},{width:751,height:360}]){
   const context=await browser.newContext({viewport,hasTouch:true});
   await context.addInitScript(()=>{
    localStorage.setItem('cardDefaultModelV1','xiaobai');
    localStorage.setItem('cardModel:xiaobai:projects:v1',JSON.stringify([{
     id:'direct-program-existing',modelId:'xiaobai',name:'已有作品',updated:1,
     state:{program:[{id:'wait-time',params:{duration:2}}],stagedGroups:[]},needsName:false
    }]));
    localStorage.setItem('cardModel:xiaobai:active:v1','direct-program-existing');
   });
   const page=await context.newPage(),errors=[],viewerRequests=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('request',r=>{if(/\/viewer\/(?:open|instructions)\.html/.test(r.url()))viewerRequests.push(r.url());});
   const idle=()=>page.waitForFunction(()=>!CardPageTransition.busy);
   const readerReady=()=>page.locator('#buildingBooksReader[data-phase=open]').waitFor();
   const stored=()=>page.evaluate(k=>localStorage.getItem(k),key);
   const bookPage=()=>page.locator('#bb-spread').getAttribute('data-page');
   const guideReady=()=>page.waitForFunction(()=>{const s=CardUsageGuide.getState();return s.state==='expanded'&&s.visible&&!s.pending&&!s.suspended;});
   async function openBook(){await page.getByRole('button',{name:'打开入门指南，6页',exact:true}).tap();await readerReady();}
   async function select(number){
    await readerReady();
    while(Number(await bookPage())<number){await page.locator('#bb-next-page').tap();await readerReady();}
    while(Number(await bookPage())>number){await page.locator('#bb-prev-page').tap();await readerReady();}
   }
   async function closeBook(){await page.locator('#bb-close-reader').tap();await page.locator('#buildingBooksReader').waitFor({state:'hidden'});}
   async function geometry(){
    const rects=await page.locator('#bb-spread .build-cta,#bb-spread .program-cta').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};}));
    assert.equal(rects.length,2);const [build,code]=rects;
    assert(code.y>=build.bottom-0.5,'去编程 sits below 去搭建');
    assert(Math.abs((build.x+build.width/2)-(code.x+code.width/2))<1,'buttons share a horizontal center');
    for(const r of rects){assert(r.height>=43.5&&r.width>=44,'minimum 44px touch target');assert(r.x>=0&&r.y>=0&&r.right<=viewport.width+.5&&r.bottom<=viewport.height+.5,'buttons fit '+JSON.stringify(viewport));}
   }
   async function backToBook(number){
    await page.evaluate(()=>document.getElementById('homeBtn').click());await idle();await readerReady();
    assert.equal(await bookPage(),String(number),'return restores album page');
    assert.equal(await stored(),initial,'template use leaves existing user works unchanged');
   }
   async function delayCatalog(){
    await page.evaluate(()=>{
     window.realDirectCatalogGet=CardCompanionCatalog.get;window.directCatalogCalls=0;window.releaseDirectCatalog=null;
     CardCompanionCatalog.get=(...args)=>{directCatalogCalls++;return new Promise((resolve,reject)=>{window.releaseDirectCatalog=()=>realDirectCatalogGet(...args).then(resolve,reject);});};
    });
   }
   async function releaseCatalog(){await page.evaluate(async()=>{CardCompanionCatalog.get=realDirectCatalogGet;await releaseDirectCatalog();});}
   async function noLateOpen(){
    await page.waitForTimeout(450);await idle();
    assert.equal(await page.evaluate(()=>location.hash),'#home');
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isActive),false,'cancelled request must not open a stale program');
    assert.equal(await stored(),initial);
   }

   await page.goto(base+'#home');await page.waitForFunction(()=>window.CardCompanionPrograms&&window.CardCompanionCatalog);
   const initial=await stored();
   await page.getByRole('tab',{name:'搭建图',exact:true}).tap();await openBook();
   await geometry();
   await page.locator('#bb-spread .program-cta').tap();await guideReady();await idle();
   assert.equal(await page.evaluate(()=>location.hash),'#editor');
   assert.equal(await page.evaluate(()=>CardCompanionPrograms.current.id),'guide-robot-intro');
   assert.equal(await page.evaluate(()=>CardUsageGuide.getState().guideId),'guide-robot-usage');
   assert.deepEqual(await page.evaluate(()=>program.map(item=>item.id)),['eye-expression','speech-play']);
   assert.equal(await page.evaluate(()=>CardCompanionPrograms.isTemplate),true);
   assert.equal(await page.locator('.building-viewer').isVisible(),false);
   assert.equal(await page.locator('.building-viewer iframe').getAttribute('src'),null);
   await backToBook(1);
   await select(2);await geometry();
   await page.locator('#bb-spread .program-cta').tap();await guideReady();await idle();
   assert.equal(await page.evaluate(()=>CardCompanionPrograms.current.id),'guide-swing-intro');
   assert.equal(await page.evaluate(()=>CardUsageGuide.getState().guideId),'guide-swing-usage');
   assert.deepEqual(await page.evaluate(()=>program.map(item=>item.id)),['eye-matrix','tilt-wait','eye-expression']);
   await backToBook(2);
   await select(3);assert.equal(await page.locator('#bb-spread .program-cta').count(),0,'no companion program means no inactive programming action');
   assert.equal(await page.locator('#bb-spread .build-cta').count(),1,'existing build remains available');
   console.log('PASS direct robot/swing, return, project isolation and layout '+viewport.width+'x'+viewport.height);

   if(viewport.width===844){
    await select(1);await delayCatalog();
    await page.locator('#bb-spread .program-cta').evaluate(button=>{button.click();button.click();});
    await page.waitForFunction(()=>typeof releaseDirectCatalog==='function');
    assert.equal(await page.evaluate(()=>directCatalogCalls),1,'double tap launches one catalog request');
    await releaseCatalog();await guideReady();await idle();await backToBook(1);

    await delayCatalog();await page.locator('#bb-spread .program-cta').tap();await page.waitForFunction(()=>typeof releaseDirectCatalog==='function');
    await closeBook();await releaseCatalog();await noLateOpen();
    assert.equal(await page.locator('#buildingBooksReader').isVisible(),false,'cancelled open must not reopen a closed album');
    await openBook();

    await delayCatalog();await page.locator('#bb-spread .program-cta').tap();await page.waitForFunction(()=>typeof releaseDirectCatalog==='function');
    await select(2);await releaseCatalog();await noLateOpen();
    assert.equal(await bookPage(),'2','late request preserves newly selected album page');
    await select(1);

    await page.evaluate(()=>{window.realDirectProgramStop=CardProgram.stop;window.releaseDirectStop=null;CardProgram.stop=()=>new Promise(resolve=>window.releaseDirectStop=resolve);});
    await page.locator('#bb-spread .program-cta').tap();await page.waitForFunction(()=>typeof releaseDirectStop==='function');
    assert.equal(await page.locator('#buildingBooksReader').isVisible(),true,'album remains visible while the old program stops');
    await closeBook();
    await page.evaluate(()=>{CardProgram.stop=realDirectProgramStop;releaseDirectStop();});await noLateOpen();
    assert.equal(await page.locator('#buildingBooksReader').isVisible(),false);
    console.log('PASS duplicate click, pending catalog close/turn and pending stop close cancellation');
   }
   assert.deepEqual(viewerRequests,[],'direct programming never creates or navigates a building viewer');
   assert.deepEqual(errors,[],'no browser exceptions');
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
