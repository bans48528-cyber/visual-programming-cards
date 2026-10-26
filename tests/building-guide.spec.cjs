const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {closeBuildingBook}=require('./building-helpers.cjs');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'dist/building-catalog.json'),'utf8'));
const books=JSON.parse(fs.readFileSync(path.join(root,'dist/building-books.json'),'utf8'));
const ids=['guide-robot','guide-swing','guide-fan','guide-crawler','guide-simple-car','guide-turnaround-car'];
const names=['小白机器人','摇摆模型','小风扇','爬行者','简易小车','掉头小车'];
const entries=ids.map(id=>catalog.xiaobai.find(entry=>entry.id===id));
assert.deepEqual(books.xiaobai[0].entries,ids);
assert.equal(books.xiaobai[0].title,'入门指南');
assert.equal(books.xiaobai[0].theme,'mint');
assert.equal(books.xiaobai[0].cover,entries[0].cover);
for(const [index,entry] of entries.entries()){
  assert.equal(entry.name,names[index]);assert(entry.description.length>50);assert(entry.tags.length>1);
  assert(fs.statSync(path.join(root,'dist',entry.cover)).size<1_000_000);
  assert(!fs.existsSync(path.join(root,'dist',entry.file)),'raw Studio files are build inputs only');
  assert(entry.prepared.hasSteps);
  const payload=JSON.parse(fs.readFileSync(path.join(root,'dist',entry.prepared.file),'utf8'));
  assert(payload.parts['xiaobai_controller_multicolor_v1.dat']?.length>100000,'bundled original controller geometry');
  if(index>=2)assert(payload.parts['m3f5402ce_20261015_010130.dat']?.length>100000,'bundled motor geometry');
  if(index===4)assert(payload.parts['racing_drive_belt_formed.dat']?.length>10000,'bundled formed belt geometry');
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
    await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
    const page=await context.newPage(),errors=[],bad=[],requests=[],steps=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.status()>=400)bad.push(response.url());});
    page.on('request',request=>requests.push(request.url()));
    await page.goto('http://127.0.0.1:4173/dist/#home');
    await page.getByRole('tab',{name:'搭建图',exact:true}).click();
    await page.getByRole('button',{name:'打开入门指南，6页',exact:true}).click();
    const ready=()=>page.locator('#buildingBooksReader[data-phase="open"]').waitFor();
    const viewer=page.frameLocator('.building-viewer iframe');
    for(const [index,entry] of entries.entries()){
      await ready();
      assert.equal(await page.locator('#bb-spread').getAttribute('data-page'),String(index+1));
      assert.equal(await page.locator('#bb-total-pages').textContent(),'6');
      assert.equal(await page.locator('.story-page h2').textContent(),entry.name);
      assert.equal(await page.locator('.story-description').textContent(),entry.description);
      assert.deepEqual(await page.locator('.story-tags span').allTextContents(),entry.tags);
      const picture=page.locator('.drawing-stage img');
      await picture.evaluate(image=>image.decode());
      assert.equal(await picture.getAttribute('src'),entry.cover);
      await page.getByRole('button',{name:'去搭建'+entry.name,exact:true}).tap();
      await viewer.locator('body[data-ready=true]').waitFor({timeout:60000});
      const frame=page.frames().find(frame=>frame.url().includes('/instructions.html'));
      const actual=await frame.evaluate(()=>({name:viewerRecord.name,steps:manager.stepHandler.totalNumberOfSteps,triangles:viewerDiagnostics.lastRender.triangles,errors:viewerDiagnostics.errors}));
      assert.equal(actual.name,entry.name);assert(actual.steps>1);assert(actual.triangles>1000);assert.deepEqual(actual.errors,[]);
      steps.push({name:actual.name,steps:actual.steps,triangles:actual.triangles});
      await viewer.getByRole('button',{name:'下一步',exact:true}).last().tap();
      await viewer.getByRole('link',{name:'返回首页',exact:true}).click();
      await page.locator('.building-viewer').waitFor({state:'hidden'});await ready();
      assert.equal(await page.locator('#bb-spread').getAttribute('data-page'),String(index+1),'viewer return keeps guide page');
      if(index<entries.length-1)await page.locator('#bb-next-page').tap();
    }
    assert(await page.locator('#bb-next-page').isDisabled());
    await closeBuildingBook(page);
    await page.getByRole('button',{name:'打开测试二册，8页',exact:true}).click();await ready();
    assert.equal(await page.locator('#buildingBooksReader').getAttribute('data-theme'),'blue','guide theme does not leak');
    assert.equal(await page.locator('.story-page h2').textContent(),'机器鸭 v2');
    assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);
    assert(!requests.some(url=>/\.io(?:\?|$)|\/zip-full|\.dat(?:\?|$)/.test(url)),'no runtime unzip or custom part fetch');
    console.log('PASS six real guide models in requested order, source descriptions/tags, transparent small covers, packed custom geometry, step viewing and album/page return; legacy album/theme retained.');
    console.log(JSON.stringify(steps));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
