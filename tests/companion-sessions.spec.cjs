const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.CARD_TEST_URL||'http://127.0.0.1:4173/';
const projectsKey='cardModel:xiaobai:projects:v1',activeKey='cardModel:xiaobai:active:v1';

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
    await context.addInitScript(()=>{
      if (!localStorage.getItem('companion-seeded')) {
        localStorage.setItem('companion-seeded','1');
        localStorage.setItem('cardDefaultModelV1','xiaobai');
        localStorage.setItem('cardModel:xiaobai:projects:v1',JSON.stringify([{
          id:'existing-user-work',modelId:'xiaobai',name:'原有用户作品',updated:1,
          state:{program:[{id:'motor-forward',params:{port:'L/M1',duration:1}}],stagedGroups:[]},needsName:false
        }]));
        localStorage.setItem('cardModel:xiaobai:active:v1','existing-user-work');
      }
      window.companionEvents=[];
      for(const type of ['opened','closed','saved']) document.addEventListener('card-companion-'+type,event=>{
        companionEvents.push({type,detail:event.detail});
      });
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'#home');
    await page.waitForFunction(()=>window.CardCompanionPrograms);
    const stored=()=>page.evaluate(key=>localStorage.getItem(key),projectsKey);
    const initial=await stored();
    const original=JSON.parse(initial)[0];
    const idle=()=>page.waitForFunction(()=>!CardPageTransition.busy);
    const open=async()=>{
      await page.evaluate(async()=>{
        window.fixtureTemplate={id:'companion-fixture',name:'造型配套程序',modelId:'xiaobai',guideId:'companion-fixture-guide',
          state:{program:[{id:'wait-time',params:{duration:2}}],stagedGroups:[]}};
        window.templateSource=JSON.stringify(fixtureTemplate);
        await CardCompanionPrograms.open(fixtureTemplate);
      });
      await idle();
    };

    await open();
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isTemplate),true);
    assert.equal(await page.evaluate(()=>CardHome.activeModelId),'xiaobai');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),activeKey),'existing-user-work');
    await page.evaluate(()=>{
      program.push(createProgramItem('wait-time'));renderProgram();commitHistory();
      CardHome.autosave();CardHome.checkpoint();window.dispatchEvent(new Event('beforeunload'));
    });
    assert.equal(await stored(),initial,'edits and autosave cannot write a template or overwrite the previous user work');
    assert.equal(await page.evaluate(()=>JSON.stringify(fixtureTemplate)===templateSource),true,'template source is immutable');
    await page.evaluate(()=>document.getElementById('saveBtn').click());
    assert.equal(await page.locator('.home-dialog h2').textContent(),'另存作品');
    await page.locator('.home-dialog [type=button]').click();
    assert.equal(await stored(),initial,'canceling Save As does not create a project');
    await page.evaluate(()=>CardHome.load());
    assert.equal(await page.evaluate(()=>program.length),1,'reload of a built-in program does not load the previous user work');
    assert.equal(await page.evaluate(()=>program[0].id),'wait-time');

    // A failed save leaves the built-in session editable and does not promote an unsaved copy.
    await page.evaluate(()=>{
      window.originalStorageWrite=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(key==='cardModel:xiaobai:projects:v1')throw new DOMException('quota','QuotaExceededError');
        return originalStorageWrite.call(this,key,value);
      };
      document.getElementById('saveBtn').click();
    });
    await page.locator('.home-dialog input').fill('保存失败的副本');
    await page.locator('.home-dialog [type=submit]').click();
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isTemplate),true);
    assert.equal(await stored(),initial);
    await page.evaluate(()=>{Storage.prototype.setItem=originalStorageWrite;});

    await page.evaluate(()=>document.getElementById('saveBtn').click());
    await page.locator('.home-dialog input').fill('我的入门练习');
    await page.locator('.home-dialog [type=submit]').click();
    const saved=JSON.parse(await stored()),copy=saved.find(project=>project.id!=='existing-user-work');
    assert.equal(saved.length,2);assert.deepEqual(saved.find(project=>project.id===original.id),original);
    assert.equal(copy.name,'我的入门练习');assert.equal(copy.companionId,'companion-fixture');
    assert.equal(copy.guideId,'companion-fixture-guide');assert.equal(copy.needsName,false);
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isTemplate),false);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),activeKey),copy.id);
    const savedEvent=await page.evaluate(()=>companionEvents.find(event=>event.type==='saved').detail);
    assert.equal(savedEvent.previousResumeKey,'companion-fixture');assert.equal(savedEvent.resumeKey,copy.id);
    await page.evaluate(()=>{program[0].params.duration=7;renderProgram();commitHistory();});
    assert.equal(JSON.parse(await stored()).find(project=>project.id===copy.id).state.program[0].params.duration,7);
    assert.deepEqual(JSON.parse(await stored()).find(project=>project.id===original.id),original);
    await page.evaluate(()=>document.getElementById('homeBtn').click());await idle();
    await page.getByRole('button',{name:'打开：我的入门练习',exact:true}).click();await idle();
    let event=await page.evaluate(()=>companionEvents.filter(event=>event.type==='opened').at(-1).detail);
    assert.equal(event.guideId,'companion-fixture-guide');assert.equal(event.resumeKey,copy.id);assert.equal(event.template,false);
    await page.reload();await page.waitForFunction(()=>CardCompanionPrograms.isActive);await idle();
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.current.projectId),copy.id);
    assert.equal(await page.evaluate(()=>program[0].params.duration),7);
    event=await page.evaluate(()=>companionEvents.filter(event=>event.type==='opened').at(-1).detail);
    assert.equal(event.guideId,'companion-fixture-guide','reopening a saved copy announces its guide');

    await open();
    await page.evaluate(()=>{program[0].params.duration=9;renderProgram();commitHistory();});
    await page.reload();await idle();
    assert.equal(await page.evaluate(()=>CardCompanionPrograms.isTemplate),false,'unsaved templates are never restored as user works');
    assert.equal(await page.evaluate(()=>program[0].params.duration),7,'restart restores the preceding user copy');
    assert.equal(JSON.parse(await stored()).length,2);

    await page.evaluate(()=>{
      window.originalCompanionStop=CardProgram.stop;
      CardProgram.stop=()=>new Promise(resolve=>window.finishCompanionStop=resolve);
      window.pendingCompanion=CardCompanionPrograms.open({id:'late-template',name:'迟到模板',modelId:'xiaobai',
        state:{program:[{id:'wait-time',params:{duration:1}}],stagedGroups:[]}});
      CardCompanionPrograms.cancel();
    });
    await idle();
    assert.equal(await page.evaluate(async()=>{finishCompanionStop();const result=await pendingCompanion;CardProgram.stop=originalCompanionStop;return result;}),false);
    assert.equal(await page.locator('.home-screen').isVisible(),true,'canceling a pending open cannot reopen the editor later');

    await page.evaluate(async()=>{
      window.returnedToAlbum=0;
      await CardCompanionPrograms.open({id:'return-template',name:'返回图册模板',modelId:'xiaobai',
        state:{program:[{id:'wait-time',params:{duration:1}}],stagedGroups:[]},onReturn:()=>returnedToAlbum++});
    });await idle();
    await page.evaluate(()=>document.getElementById('homeBtn').click());await idle();
    await page.waitForFunction(()=>returnedToAlbum===1);
    assert.equal(await page.evaluate(()=>returnedToAlbum),1,'the return hook is called once after home is revealed');

    const beforeRapidReturn=await stored();
    await page.evaluate(async()=>{
      await CardCompanionPrograms.open({id:'rapid-return-template',name:'快速返回模板',modelId:'xiaobai',
        state:{program:[{id:'wait-time',params:{duration:13}}],stagedGroups:[]}});
      document.getElementById('homeBtn').click();
      CardHome.autosave();
    });await idle();
    assert.equal(await stored(),beforeRapidReturn,'returning during the enter transition never saves template blocks into the prior user copy');

    assert.equal(await page.evaluate(async()=>{
      try {await CardCompanionPrograms.open({id:'wrong-model',name:'错误型号',modelId:'tc01',state:{program:[],stagedGroups:[]}});return false;}
      catch(error){return /当前设备型号/.test(error.message);}
    }),true);
    assert.deepEqual(JSON.parse(await stored()).find(project=>project.id===original.id),original);
    assert.deepEqual(errors,[]);
    await context.close();
    console.log('PASS companion sessions: template isolation, Save As cancel/failure/success, copy autosave and guide reopening, restart safety, late-open cancellation, return hook and model guard.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
