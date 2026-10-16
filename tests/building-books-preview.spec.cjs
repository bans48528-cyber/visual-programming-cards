// Exercise the current six-album configuration without replacing any catalog response.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {closeBuildingBook}=require('./building-helpers.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4173/dist/#home');
  await p.getByRole('tab',{name:'搭建图',exact:true}).click();
  await p.locator('.book-button[data-book-id="test-06"]').waitFor();
  assert.equal(await p.locator('.book-button').count(),6);
  await p.getByText('6 本图册 · 48 页',{exact:true}).waitFor();
  await p.screenshot({path:'artifacts/building-books-six-shelf-844x390.png'});
  const layout=await p.locator('.building-books-shelf').evaluate(s=>({columns:getComputedStyle(s).gridTemplateColumns.split(' ').length,items:[...s.children].map(e=>({top:e.offsetTop,left:e.offsetLeft})),scrollWidth:s.scrollWidth,width:s.clientWidth}));
  assert.equal(layout.columns,3);assert.equal(new Set(layout.items.map(e=>e.top)).size,2);
  assert.equal(layout.items[0].top,layout.items[2].top);assert.equal(layout.items[3].top,layout.items[5].top);
  assert(layout.items[3].top>layout.items[0].top);assert(layout.scrollWidth<=layout.width+1,'shelf scrolls vertically only');
  const cdp=await context.newCDPSession(p);
  const touch=async(type,points)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));};
  async function swipe(from,dx,dy){await touch('touchStart',[{...from,id:1}]);for(let i=1;i<=8;i++)await touch('touchMove',[{x:from.x+dx*i/8,y:from.y+dy*i/8,id:1}]);await touch('touchEnd',[]);}
  const scroller=p.locator('.home-main'),before=await scroller.evaluate(e=>e.scrollTop);
  for(let i=0;i<6;i++){
   const b=await p.locator('[data-book-id="test-06"]').boundingBox();
   if(b.y>=0&&b.y+b.height<370)break;
   await swipe({x:744,y:330},0,-230);
  }
  await p.waitForFunction(()=>document.querySelector('.home-main').scrollTop>0);
  assert((await scroller.evaluate(e=>e.scrollTop))>before,'real touch reaches the second row');
  const last=await p.locator('[data-book-id="test-06"]').boundingBox();assert(last.y>=0&&last.y+last.height<390,'last cover reachable by vertical touch');
  await p.screenshot({path:'artifacts/building-books-six-second-row-844x390.png'});
  assert.equal(await p.locator('#buildingBooksReader').isVisible(),false,'scrolling a cover does not open it');
  await p.touchscreen.tap(last.x+last.width/2,last.y+last.height/2);
  const ready=()=>p.locator('#buildingBooksReader[data-phase="open"]').waitFor();
  const page=()=>p.locator('#bb-spread').getAttribute('data-page');
  await ready();assert.equal(await p.locator('#bb-reader-title').textContent(),'测试六册');assert.equal(await page(),'1');assert.equal(await p.locator('#bb-total-pages').textContent(),'8');
  const book=await p.locator('#bb-book-shell').boundingBox();await swipe({x:book.x+book.width*.7,y:book.y+book.height*.5},-95,0);await ready();assert.equal(await page(),'2');
  await p.locator('#bb-next-page').tap();await ready();assert.equal(await page(),'3');
  const slider=await p.locator('#bb-page-range').boundingBox();
  const point=n=>({x:slider.x+12+(slider.width-24)*(n-1)/7,y:slider.y+slider.height/2,id:1});
  const scrubberState=()=>p.evaluate(()=>({phase:document.querySelector('#buildingBooksReader').dataset.phase,value:document.querySelector('#bb-page-range').value,current:document.querySelector('#bb-current-page').textContent,progress:parseFloat(document.querySelector('#bb-page-range').style.getPropertyValue('--progress'))}));
  const assertTarget=(state,n)=>{assert.equal(state.value,String(n),'thumb immediately follows committed target');assert.equal(state.current,String(n),'page number immediately follows committed target');assert(Math.abs(state.progress-(n-1)/7*100)<.001,'progress immediately follows committed target');};
  await touch('touchStart',[point(3)]);await touch('touchMove',[point(8)]);await touch('touchEnd',[]);
  let state=await scrubberState();assert.equal(state.phase,'turning');assertTarget(state,8);
  // Change the destination before the previous sheet finishes turning.
  await touch('touchStart',[point(8)]);await touch('touchMove',[point(3)]);await touch('touchEnd',[]);
  state=await scrubberState();assert.equal(state.phase,'turning');assertTarget(state,3);
  // Cancel a new preview while the committed turn is pending: restore its target, not the old page.
  await touch('touchStart',[point(5)]);assertTarget(await scrubberState(),5);await touch('touchCancel',[]);assertTarget(await scrubberState(),3);
  await ready();assert.equal(await page(),'3');assertTarget(await scrubberState(),3);
  await touch('touchStart',[point(3)]);await touch('touchMove',[point(8)]);await touch('touchEnd',[]);assertTarget(await scrubberState(),8);
  await ready();assert.equal(await page(),'8');assert.equal(await p.locator('#bb-next-page').isDisabled(),true);
  await p.screenshot({path:'artifacts/building-books-six-page8-844x390.png'});
  await p.locator('.build-cta').tap();
  await p.frameLocator('.building-viewer iframe').locator('body[data-ready=true]').waitFor({timeout:45000});
  await p.evaluate(()=>CardBuildings.back());await p.locator('.building-viewer').waitFor({state:'hidden'});await ready();assert.equal(await page(),'8');assert.equal(await p.locator('#bb-reader-title').textContent(),'测试六册');
  await closeBuildingBook(p);await p.locator('[data-book-id="test-06"]').tap();await ready();assert.equal(await page(),'8','reopening the last album remembers its page');
  await p.evaluate(()=>CardModelSession.select('tc01'));await p.getByRole('tab',{name:'搭建图',exact:true}).click();await p.getByText('暂无搭建图',{exact:true}).waitFor();assert.equal(await p.locator('.book-button').count(),0);assert.equal(await p.locator('#buildingBooksReader').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS actual six albums × eight repeated pages: 3 columns / 2 rows, vertical touch scroll, touch page turn, arrows, immediate slider thumb/page/progress, retarget and cancel during animation, page 8 viewer/album return, and device isolation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
