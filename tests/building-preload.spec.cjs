const {openBuildingBook,openBuilding}=require('./building-helpers.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const catalog=JSON.parse(fs.readFileSync('dist/building-catalog.json','utf8')),entry=catalog.xiaobai[0];
assert.ok(entry.prepared);assert.ok(!fs.existsSync('dist/'+entry.file));
const bundle=JSON.parse(fs.readFileSync('dist/'+entry.prepared.file,'utf8'));
assert.equal(bundle.format,1);assert.equal(bundle.hasSteps,true);assert.ok(Object.keys(bundle.parts).length>100);
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:751,height:360}}),requests=[],errors=[];
 page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
 await page.route('**/building-catalog.json',r=>r.fulfill({json:{...catalog,xiaobai:[entry,{...entry,id:'not-selected',name:'其他测试搭建图'}]}}));
 const go=()=>page.goto('http://127.0.0.1:4173/dist/#home');
 const cached=()=>page.evaluate(async({device,entry})=>{const m=await import('./viewer/app/prepared-model.js');const s=await import('./viewer/app/store.js');return !!await s.getModel(m.preparedId(device,entry));},{device:'xiaobai',entry});
 await go();await page.waitForTimeout(600);
 assert.equal(requests.filter(u=>/viewer\/|building-models\//.test(u)).length,0,'startup must not preload models or create a renderer');
 await page.getByRole('tab',{name:'搭建图',exact:true}).click();
 await page.waitForResponse(r=>r.url().endsWith(entry.prepared.file));
 for(let i=0;i<100&&!await cached();i++)await page.waitForTimeout(100);
 assert.equal(await cached(),true);assert.equal(await page.locator('.building-viewer iframe').getAttribute('src'),null);
 assert.equal(requests.filter(u=>u.includes('/viewer/js/')).length,0,'preload must not load 3D scripts');
 assert.equal(requests.filter(u=>u.includes('/assets/building-models/')).length,1,'preload exactly one model');
 
 await openBuildingBook(page);
 assert.equal(requests.filter(u=>u.includes('/viewer/js/')).length,0,'opening an album must not create a renderer');
 const start=Date.now();await openBuilding(page,/机器鸭 v2/);
 const frame=page.frameLocator('.building-viewer iframe');await frame.locator('body[data-ready=true]').waitFor({timeout:60000});
 const elapsed=Date.now()-start;const model=page.frames().find(f=>f.url().includes('instructions.html'));
 assert.equal(await model.evaluate(()=>manager.stepHandler.totalNumberOfSteps),42);
 assert.equal(await model.evaluate(()=>viewerDiagnostics.lastRender.triangles),2920);
 assert.equal(requests.filter(u=>/\.io(?:\?|$)|\/zip-full|\.dat(?:\?|$)/.test(u)).length,0,'no runtime unzip or individual part requests');
 await page.evaluate(()=>CardBuildings.close());await go();await page.getByRole('tab',{name:'搭建图',exact:true}).click();
 await openBuilding(page,/机器鸭 v2/);await frame.locator('body[data-ready=true]').waitFor({timeout:60000});
 assert.equal(requests.filter(u=>u.endsWith(entry.prepared.file)).length,1,'reuse persistent prepared data after reload');
 await page.evaluate(()=>CardBuildings.close());
 await page.locator('.building-viewer').waitFor({state:'hidden'});await page.locator('#buildingBooksReader').waitFor({state:'hidden'});
 await page.locator('.home-model-entry').click();await page.locator('[data-model-id=tc01]').click();await page.getByRole('tab',{name:'搭建图',exact:true}).click();
 await page.getByText('暂无搭建图',{exact:true}).waitFor();assert.equal(await page.locator('.building-viewer iframe').getAttribute('src'),null);
 assert.deepEqual(errors,[]);
 
 // Cancel an in-flight prefetch by switching model; its late response cannot open a viewer.
 const p=await browser.newPage({viewport:{width:751,height:360}});await p.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
 let release,startedResolve;const started=new Promise(r=>startedResolve=r),held=new Promise(r=>release=r);
 await p.route('**/'+entry.prepared.file,async route=>{startedResolve();await held;await route.fulfill({json:bundle}).catch(()=>{});});
 await p.goto('http://127.0.0.1:4173/dist/#home');await p.getByRole('tab',{name:'搭建图',exact:true}).click();await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('prefetch did not start')),10000))]);
 await p.locator('.home-model-entry').click();await p.locator('[data-model-id=tc01]').click();release();
 await p.getByRole('tab',{name:'搭建图',exact:true}).click();await p.getByText('暂无搭建图',{exact:true}).waitFor();
 assert.equal(await p.locator('.building-viewer').isVisible(),false);
 assert.equal(await p.locator('.building-viewer iframe').getAttribute('src'),null);
 
 // A new content version has a different cache identity and must be prepared again.
 const updated={...entry,prepared:{...entry.prepared,version:'f'.repeat(64)}};
 await page.route('**/building-catalog.json',r=>r.fulfill({json:{...catalog,xiaobai:[updated]}}));
 await page.evaluate(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));await page.reload();
 await page.getByRole('tab',{name:'搭建图',exact:true}).click();await openBuilding(page,/机器鸭 v2/);
 await frame.locator('body[data-ready=true]').waitFor({timeout:60000});
 assert.ok(page.frames().some(f=>f.url().includes('f'.repeat(64))));
 assert.equal(requests.filter(u=>u.endsWith(entry.prepared.file)).length,2,'changed model invalidates cache');
 console.log('PASS prepared builds; startup has no model work; one-model preload without WebGL; 42 steps/2920 triangles; no IO unzip or part requests; persistent cache/version isolation/cancellation. Preloaded open: '+elapsed+' ms (desktop).');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
