// Real viewer host and loading lifecycle; the heavy iframe is the controlled boundary.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {openBuildingBook,openBuilding}=require('./building-helpers.cjs');
const base=process.env.CARD_TEST_URL||'http://127.0.0.1:4173/dist/';
const entry={id:'grid-loading-test',name:'加载测试模型',file:'assets/building-models/grid-loading-test.ldr',cover:'assets/building-books/guide-robot.webp',description:'仅验证查看器加载反馈，不创建三维渲染器。'};
const catalog={xiaobai:[entry]},books={xiaobai:[{id:'grid-loading',title:'加载测试图册',description:'加载状态测试',theme:'blue',entries:[entry.id,entry.id]}]};
const artifact=process.env.CARD_ARTIFACT_DIR;
if(artifact)fs.mkdirSync(artifact,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:751,height:360},hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/building-catalog.json',r=>r.fulfill({json:catalog}));
  await page.route('**/building-books.json',r=>r.fulfill({json:books}));
  await page.route('**/viewer/open.html?*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body data-loader-fixture>Controlled viewer boundary</body></html>'}));
  await page.goto(base+'#home');await page.getByRole('tab',{name:'搭建图',exact:true}).tap();
  await openBuildingBook(page);await page.locator('#bb-next-page').tap();await page.locator('#buildingBooksReader[data-phase="open"]').waitFor();
  assert.equal(await page.locator('#bb-spread').getAttribute('data-page'),'2');
  const modal=page.locator('.building-viewer'),loading=modal.locator('.building-loading'),spinner=loading.locator('.building-loading-spinner');
  const frame=()=>page.frames().find(f=>f.url().includes('/viewer/open.html?'));
  async function open(){await openBuilding(page,entry.name);await page.frameLocator('.building-viewer iframe').locator('body[data-loader-fixture]').waitFor();await spinner.waitFor({state:'visible'});}
  async function post(type,visit=null){return frame().evaluate(({type,visit})=>{const current=new URL(location.href).searchParams.get('visit');parent.postMessage({source:'building-viewer',type,visit:visit??current,message:type==='error'?'受控模型加载失败':undefined},location.origin);return current;},{type,visit});}
  async function stopped(){await page.waitForFunction(()=>Array.from(document.querySelectorAll('.building-loading-dot')).every(dot=>getComputedStyle(dot).animationName==='none'));}
  async function bookRestored(){await modal.waitFor({state:'hidden'});await page.locator('#buildingBooksReader[data-phase="open"]').waitFor();assert.equal(await page.locator('#bb-spread').getAttribute('data-page'),'2');await page.waitForFunction(()=>document.querySelector('.building-viewer iframe').getAttribute('src')===null);assert.equal(await modal.locator('iframe').getAttribute('src'),null);await stopped();}
  await open();
  assert.equal(await spinner.locator('.building-loading-dot').count(),16,'LDRS Grid is a sixteen-dot perspective grid');
  const style=await spinner.evaluate(el=>{const dot=el.querySelector('.building-loading-dot'),s=getComputedStyle(el),d=getComputedStyle(dot),r=el.getBoundingClientRect();return{size:s.getPropertyValue('--building-grid-size').trim(),duration:d.animationDuration,color:getComputedStyle(dot,'::before').backgroundColor,background:s.backgroundColor,width:r.width,height:r.height,animation:d.animationName,transform:d.transform,delays:Array.from(el.querySelectorAll('.building-loading-dot'),n=>getComputedStyle(n).animationDelay)};});
  assert.equal(style.size,'75px');assert.equal(style.duration,'1.5s');assert.equal(style.color,'rgb(255, 255, 255)');assert.equal(style.background,'rgb(8, 114, 204)');assert.equal(style.width,111);assert.equal(style.height,96);assert.equal(style.animation,'building-grid-jump');assert.equal(new Set(style.delays).size,7,'seven diagonal wave phases');
  await page.waitForTimeout(140);assert.notEqual(await spinner.locator('.building-loading-dot').first().evaluate(dot=>getComputedStyle(dot).transform),style.transform,'the visible grid must actually animate');
  if(artifact)await page.screenshot({path:path.join(artifact,'grid-loading-751x360.png')});
  const firstVisit=await post('ready');await loading.waitFor({state:'hidden'});await stopped();
  await post('close');await bookRestored();
  await open();await post('ready',firstVisit);await page.waitForTimeout(50);assert.equal(await loading.isVisible(),true,'late ready from the previous visit cannot dismiss current loading');
  await post('error');await page.getByText('受控模型加载失败',{exact:true}).waitFor();assert.equal(await spinner.isVisible(),false,'failed loading keeps error/back UI and hides the grid');await stopped();
  await loading.getByRole('button',{name:'‹ 返回图册',exact:true}).tap();await bookRestored();
  await open();await loading.getByRole('button',{name:'‹ 返回图册',exact:true}).tap();await bookRestored();
  await page.emulateMedia({reducedMotion:'reduce'});await open();assert.equal(await spinner.isVisible(),true);await stopped();await loading.getByRole('button',{name:'‹ 返回图册',exact:true}).tap();await bookRestored();
  assert.deepEqual(errors,[]);await context.close();
  console.log('PASS LDRS Grid: offline 16-dot/75px/1.5s white wave, contrast backing, real host ready/error/cancel cleanup, stale-visit protection, preserved album page and reduced motion; iframe boundary mocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
