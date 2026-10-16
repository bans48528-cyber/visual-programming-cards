const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {openBuildingBook,closeBuildingBook}=require('./building-helpers.cjs');
const fixture=Array.from({length:4},(_,i)=>({id:'book-fixture-'+i,name:'测试造型 '+(i+1),description:i===2?'长描述。'.repeat(100):'仅用于测试的造型，不发布到产品目录。',cover:'assets/building-books/duck.webp',file:'assets/building-models/book-fixture.ldr'}));
const config={xiaobai:[{id:'test',title:'测试图册',entries:fixture.slice(0,3).map(e=>e.id)},{id:'second',title:'另一本图册',entries:[fixture[3].id]}]};
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
 const p=await context.newPage(),errors=[],requests=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));
 await p.route('**/building-catalog.json',r=>r.fulfill({json:{xiaobai:fixture,tc01:[]}}));await p.route('**/building-books.json',r=>r.fulfill({json:config}));
 await p.route('**/assets/building-models/book-fixture.ldr',r=>r.fulfill({body:'0 Test\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n0 STEP\n1 1 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat\n',contentType:'text/plain'}));
 await p.goto('http://127.0.0.1:4173/dist/#home');assert.equal(requests.filter(u=>u.includes('/viewer/')).length,0);
 await p.getByRole('tab',{name:'搭建图',exact:true}).click();await p.locator('.book-button').first().waitFor();assert.equal(await p.locator('.book-button').count(),2);
 const ready=()=>p.locator('#buildingBooksReader[data-phase=open]').waitFor(),page=()=>p.locator('#bb-spread').getAttribute('data-page');
 await openBuildingBook(p);assert.equal(await page(),'1');assert.equal(requests.filter(u=>u.includes('/viewer/')).length,0,'books do not create the renderer');
 const cdp=await context.newCDPSession(p),touch=async(type,points)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));};
 const box=()=>p.locator('#bb-book-shell').boundingBox();
 async function swipe(dx,dy=0){const b=await box(),from={x:b.x+b.width*.7,y:b.y+b.height*.6,id:1};await touch('touchStart',[from]);for(let i=1;i<=6;i++)await touch('touchMove',[{...from,x:from.x+dx*i/6,y:from.y+dy*i/6}]);await touch('touchEnd',[]);}
 await swipe(-85);await ready();assert.equal(await page(),'2');
 await swipe(5);assert.equal(await page(),'2');await swipe(0,-35);assert.equal(await page(),'2');
 await p.locator('#bb-next-page').click();await ready();assert.equal(await page(),'3');assert.equal(await p.locator('#bb-next-page').isDisabled(),true);
 await swipe(-80);assert.equal(await page(),'3','last page does not leave album');
 const r=await p.locator('#bb-page-range').boundingBox();await touch('touchStart',[{x:r.x+12,y:r.y+22,id:1}]);assert.equal(await p.locator('#bb-current-page').textContent(),'1');assert.equal(await page(),'3','slider previews without replacing spread');await touch('touchCancel',[]);assert.equal(await p.locator('#bb-current-page').textContent(),'3');
 await touch('touchStart',[{x:r.x+12,y:r.y+22,id:1}]);await touch('touchEnd',[]);await ready();assert.equal(await page(),'1');
 // A second finger cancels the first gesture, rather than turning after lift.
 const b=await box(),a={x:b.x+b.width*.7,y:b.y+b.height*.5,id:1};await touch('touchStart',[a]);await touch('touchMove',[{...a,x:a.x-50}]);await touch('touchStart',[{...a,x:a.x-50},{x:a.x+30,y:a.y,id:2}]);await touch('touchEnd',[]);assert.equal(await page(),'1');
 await p.evaluate(()=>{document.querySelector('#bb-next-page').click();document.querySelector('#bb-next-page').click();document.querySelector('#bb-prev-page').click();});await ready();assert.equal(await page(),'2','rapid changes settle on final requested page');
 await p.locator('.build-cta').click();await p.waitForFunction(()=>document.querySelector('.building-viewer').open);assert.equal(await p.locator('.building-viewer iframe').getAttribute('src'),null,'viewer work follows page transition');
 await p.setViewportSize({width:751,height:360});const vf=p.frameLocator('.building-viewer iframe');await vf.locator('body[data-ready=true]').waitFor({timeout:30000});
 await vf.getByRole('link',{name:'查看设置',exact:true}).click();await vf.frameLocator('#viewer-settings-panel').locator('body[data-ready=true]').waitFor();
 await p.evaluate(()=>document.querySelector('.building-viewer').dispatchEvent(new Event('cancel',{cancelable:true})));await vf.locator('#viewer-settings-panel').waitFor({state:'detached'});assert.equal(await p.locator('.building-viewer').isVisible(),true,'Escape in settings only closes settings');
 await p.evaluate(()=>CardBuildings.back());await p.locator('.building-viewer').waitFor({state:'hidden'});assert.equal(await page(),'2');await ready();
 await closeBuildingBook(p);await p.locator('[data-book-id=second]').click();await ready();assert.equal(await page(),'1');await closeBuildingBook(p);await openBuildingBook(p);assert.equal(await page(),'2');
 // Reflow must not close the reader, lose the page or put a control beyond the viewport.
 for(const [width,height] of [[844,390],[751,360],[568,280],[390,844],[1366,768]]){await p.setViewportSize({width,height});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await ready();assert.equal(await page(),'2');const bounds=await p.locator('#bb-close-reader,#bb-prev-page,#bb-next-page,#bb-page-range,.build-cta').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height};}));assert(bounds.every(b=>b.x>=0&&b.y>=0&&b.right<=width+.5&&b.bottom<=height+.5&&b.height>=44),'controls inside '+width+'×'+height+' '+JSON.stringify(bounds));}
 // Abort cover opening, closing and page turns without leaving animated layers behind.
 await closeBuildingBook(p);await p.evaluate(()=>{document.querySelector('.book-button').click();CardBuildings.back();});await p.locator('#buildingBooksReader').waitFor({state:'hidden'});assert.equal(await p.locator('.cover-flight,.opening-cover,.turning-sheet').count(),0);
 await openBuildingBook(p);await p.evaluate(()=>{document.querySelector('#bb-next-page').click();CardBuildings.back();});await p.locator('#buildingBooksReader').waitFor({state:'hidden'});
 // A slow program stop must not reopen a book after the user has closed it.
 await openBuildingBook(p);await p.evaluate(()=>{window.originalBookStop=CardProgram.stop;CardProgram.stop=()=>new Promise(resolve=>window.finishBookStop=resolve);});await p.locator('.build-cta').click();await closeBuildingBook(p);await p.evaluate(()=>finishBookStop());await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await p.locator('.building-viewer').isVisible(),false);assert.equal(await p.locator('.building-viewer iframe').getAttribute('src'),null);
 // Rotation alone keeps the same book session and should allow the pending open.
 await openBuildingBook(p);await p.locator('.build-cta').click();await p.setViewportSize({width:844,height:390});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.evaluate(()=>{finishBookStop();CardProgram.stop=originalBookStop;});await vf.locator('body[data-ready=true]').waitFor({timeout:30000});await p.evaluate(()=>CardBuildings.back());await p.locator('.building-viewer').waitFor({state:'hidden'});await ready();
 await p.evaluate(()=>CardModelSession.select('tc01'));await p.getByRole('tab',{name:'搭建图',exact:true}).click();await p.getByText('暂无搭建图',{exact:true}).waitFor();assert.equal(await p.locator('.book-button').count(),0);assert.equal(await p.locator('#buildingBooksReader').isVisible(),false);assert.equal(await p.locator('.building-viewer iframe').getAttribute('src'),null);
 assert.deepEqual(errors,[]);
 const production=JSON.parse(fs.readFileSync('building-catalog.json','utf8')),productionBooks=JSON.parse(fs.readFileSync('building-books.json','utf8'));assert.equal(productionBooks.xiaobai.length,6);assert.equal(new Set(productionBooks.xiaobai.map(book=>book.id)).size,6);for(const book of productionBooks.xiaobai)assert.deepEqual(book.entries,Array(8).fill('duck-v2-test'));assert.equal(production.xiaobai.length,1,'repeated pages reuse one actual model');for(const [id,entries] of Object.entries(production))if(id!=='xiaobai')assert.equal(entries.length,0);
 console.log('PASS real touch swipe, vertical/jitter/multitouch cancel, slider preview/cancel/commit, rapid turns, album/page return, settings/back, resize during viewer load, 5 viewports, isolation and production catalog.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
