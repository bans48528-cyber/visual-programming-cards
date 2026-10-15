const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage({viewport:{width:751,height:360}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));await p.goto('http://127.0.0.1:4173/dist/#home');await p.getByRole('tab',{name:'搭建图',exact:true}).click();await p.getByRole('button',{name:/机器鸭 v2/}).click();const f=p.frameLocator('.building-viewer iframe');await f.locator('body[data-ready=true]').waitFor({timeout:60000});const model=p.frames().find(x=>x.url().includes('instructions.html'));await model.evaluate(()=>{window.retainedManager=manager;manager.goToStep(3)});await f.getByRole('link',{name:'查看设置',exact:true}).click();const settings=f.frameLocator('#viewer-settings-panel');await settings.locator('.choice-preview').first().waitFor();assert.equal(await settings.locator('.choice-preview').count(),10);
for(const [width,height]of [[751,360],[640,320],[568,280]]){await p.setViewportSize({width,height});const rects=await settings.locator('label').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));assert.ok(rects.every(r=>r.y>=0&&r.bottom<=height&&r.x>=0&&r.right<=width));}
await p.setViewportSize({width:751,height:360});await settings.locator('label').filter({has:settings.locator('input[name=showOldColors][value="1"]')}).click();await settings.locator('#settings-back').click();await f.locator('#viewer-settings-panel').waitFor({state:'detached'});assert.equal(await model.evaluate(()=>retainedManager===manager&&manager.currentStep===3&&LDR.Options.showOldColors===1),true);
for(const step of [3,42,3]){
 await model.evaluate(step=>{manager.goToStep(step);window.geometryPart=Object.values(manager.ldrLoader.partTypes).find(pt=>pt.geometry&&pt.mesh);window.oldGeometry=geometryPart.geometry;window.savedView=JSON.stringify([manager.camera.position,manager.camera.quaternion,manager.camera.zoom,manager.baseObject.position,manager.baseObject.quaternion]);},step);
 const previous=await model.evaluate(()=>LDR.Options.studHighContrast);
 await f.getByRole('link',{name:'查看设置',exact:true}).click();
 await settings.locator('label').filter({has:settings.locator('input[name=studHighContrast]')}).click();
 assert.equal(await settings.locator('input[name=studHighContrast]').isChecked(),!previous);
 await settings.locator('#settings-back').click();
 await f.locator('#viewer-settings-panel').waitFor({state:'detached'});
 await model.waitForFunction(()=>geometryPart.geometry&&geometryPart.geometry!==window.oldGeometry);
 assert.equal(await model.evaluate(step=>retainedManager===manager&&manager.currentStep===step,step),true);
 assert.equal(await model.evaluate(()=>JSON.stringify([manager.camera.position,manager.camera.quaternion,manager.camera.zoom,manager.baseObject.position,manager.baseObject.quaternion])===savedView),true);
}
await f.getByRole('link',{name:'查看设置',exact:true}).click();await settings.locator('.choice-preview').first().waitFor();await p.screenshot({path:'artifacts/viewer-settings-illustrated.png'});assert.deepEqual(errors,[]);console.log('PASS 10 upstream illustrations, three landscape sizes, live option update, retained manager and step on return; repeated stud rebuild at steps 3/42/3 preserves camera and zoom.');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});


