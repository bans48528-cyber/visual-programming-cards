'use strict';
// Shipping Web renderer and real browser input in disposable contexts. No native/radio transport.
// When staged outside App/tests, set CARD_APP_ROOT and CARD_TEST_OUT explicitly.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createRequire} = require('node:module');
const root = path.resolve(process.env.CARD_APP_ROOT || path.resolve(__dirname, '..'));
const out = path.resolve(process.env.CARD_TEST_OUT || path.join(root, 'artifacts/accelerometer-icons-20261111'));
const {chromium} = createRequire(path.join(root, 'package.json'))('playwright');
const PREFIX = 'assets/blocks/xiaobai-accelerometer-20261111/';
const OLD_LOOP = 'assets/blocks/xiaobai-20261016/tilt-wait.svg';
const viewports = [{name:'phone',width:844,height:390},{name:'tablet',width:1280,height:800}];
const specs = [
  {id:'tilt-wait',key:'direction',default:'forward',options:[
    ['forward','向前','向前倾倒'],['backward','向后','向后倾倒'],['left','向左','向左倾倒'],['right','向右','向右倾倒']
  ]},
  {id:'motion-wait',key:'state',default:'still',options:[
    ['still','平稳','平稳'],['shaking','持续晃动','持续晃动'],['up','向上抬一下','向上抬一下'],['down','向下放一下','向下放一下']
  ]}
];
const combos = [['advance','前进'],['retreat','后退'],['left','左转'],['right','右转']];
const copy = value => JSON.parse(JSON.stringify(value));
const item = (uid,id,params,children) => ({uid,id,...(params?{params}:{}),...(children?{children}:{})});
const group = (id,x,y,items,head=true) => ({id,startId:head?id+'-head':null,x,y,items});
const workspace = groups => ({schemaVersion:2,kind:'free-canvas',groups,viewport:{x:0,y:0,scale:1},selectedGroupId:groups[0]?.id||null});
const mainDocument = () => workspace([group('accelerometer',60,135,[
  item('tilt','tilt-wait',{direction:'forward'}),item('motion','motion-wait',{state:'still'}),
  item('loop-tilt','loop-tilt',{direction:'forward'},[item('loop-child','wait-time',{duration:1})])
])]);
const idle = page => page.waitForFunction(() => Boolean(window.CardEditor && window.CardCanvas) && !window.CardPageTransition?.busy);
const frame = page => page.evaluate(() => new Promise(requestAnimationFrame));
const current = page => page.evaluate(() => CardEditor.getWorkspace());
const block = (page,uid) => page.locator(`#chain [data-node-uid="${uid}"]`);
const image = locator => locator.locator(':scope > .card-icon img, :scope > .loop-tail > .card-icon img');
const expectedArt = (id,value) => PREFIX+id+'-'+value+'.svg';

async function staticServer() {
  const dist = path.join(root,'dist');
  assert.ok(fs.existsSync(path.join(dist,'index.html')),'Build the shipping Web dist before this regression.');
  const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json','.wav':'audio/wav','.mp3':'audio/mpeg'};
  const server = http.createServer((req,res) => {
    let file;
    try { file=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html')); }
    catch {res.writeHead(400);res.end();return;}
    if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function load(page,value) {await page.evaluate(value=>CardEditor.setWorkspace(value),value);await frame(page);}
async function art(locator,expected,label) {
  await locator.waitFor({state:'attached'});
  const result=await locator.evaluate(async img=>{
    await img.decode();return {src:img.getAttribute('src'),complete:img.complete,width:img.naturalWidth,height:img.naturalHeight};
  });
  assert.equal(result.src,expected,label+' source');
  assert.ok(result.complete&&result.width>0&&result.height>0,label+' must decode to a nonempty image');
  return result;
}
async function assertBlock(page,uid,spec,value,label=uid) {
  await art(image(block(page,uid)),expectedArt(spec.id,value),label);
  assert.equal((await block(page,uid).locator(':scope > .param-bubble').textContent()).trim(),spec.options.find(option=>option[0]===value)[2],label+' bubble');
  const result=await current(page),node=result.groups.flatMap(g=>g.items).find(n=>n.uid===uid);
  assert.deepEqual(node.params,{[spec.key]:value},label+' stored params');
}
async function openOptions(page,uid) {
  await block(page,uid).locator(':scope > .param-bubble').tap();
  await page.locator('#paramEditor').waitFor({state:'visible'});
}
async function toolbar(page) {
  if(await page.locator('#editorToolsToggle').getAttribute('aria-expanded')!=='true')await page.locator('#editorToolsToggle').tap();
}
async function screenshot(page,viewport,kind) {
  await page.screenshot({path:path.join(out,`accelerometer-${viewport.name}-${kind}.png`)});
}
async function comboRegression(page,modelId,cases) {
  await load(page,workspace([group('combo',70,135,[item('combo-card','combo-continuous',{direction:'advance'})])]));
  await openOptions(page,'combo-card');
  for(const [value,label] of combos) {
    await page.locator('#paramEditor').getByRole('button',{name:label,exact:true}).tap();
    const prefix=modelId==='xiaobai'?'xiaobai-20261016/':'';
    await art(image(block(page,'combo-card')),`assets/blocks/${prefix}combo-continuous-${value}.svg`,modelId+' combo '+value);
    assert.deepEqual((await current(page)).groups[0].items[0].params,{direction:value});
  }
  await page.keyboard.press('Escape');cases.push({case:'combo-continuous-direction-art-preserved',values:combos.map(option=>option[0])});
}
async function touchPreview(page,context,viewport,cases) {
  const document=workspace([
    group('target',340,125,[item('target-wait','wait-time',{duration:1})]),
    group('source',70,215,[item('drag-tilt','tilt-wait',{direction:'right'}),item('drag-motion','motion-wait',{state:'down'})],false)
  ]);
  await load(page,document);
  const cdp=await context.newCDPSession(page);
  let pressed=false;
  const send=(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y}]:[]});
  try {
    const box=await block(page,'drag-tilt').boundingBox();
    const down={x:box.x+20,y:box.y+36};await send('touchStart',down);pressed=true;
    await send('touchMove',{x:down.x+45,y:down.y-5});await frame(page);
    assert.equal(await page.evaluate(()=>CardCanvas.getGesture()?.active),true,'real touch must activate a suffix drag');
    await art(image(page.locator('.free-canvas-ghost > [data-node-uid="drag-tilt"]')),expectedArt('tilt-wait','right'),'touch ghost tilt');
    await art(image(page.locator('.free-canvas-ghost > [data-node-uid="drag-motion"]')),expectedArt('motion-wait','down'),'touch ghost motion');
    const slot=await page.evaluate(()=>CardCanvas.getSlots().find(s=>s.groupId==='target'&&s.parentUid===null&&s.index===1&&!s.side));
    assert.ok(slot,'target must expose its trailing connector');
    const destination={x:slot.x+20,y:slot.y};
    await send('touchMove',destination);await frame(page);
    const target=await page.evaluate(()=>CardCanvas.getGesture()?.target);
    assert.equal(target?.groupId,'target');assert.equal(target?.index,1);
    const projected={};
    for(const [uid,id,value] of [['drag-tilt','tilt-wait','right'],['drag-motion','motion-wait','down']]) {
      const node=page.locator(`.free-canvas-projection > [data-node-uid="${uid}"]`);
      await art(image(node),expectedArt(id,value),'projection '+uid);projected[uid]=await node.boundingBox();
    }
    await screenshot(page,viewport,'ghost');
    await send('touchEnd');pressed=false;await frame(page);
    assert.equal(await page.locator('.free-canvas-ghost,.free-canvas-projection').count(),0);
    for(const [uid,spec,value] of [['drag-tilt',specs[0],'right'],['drag-motion',specs[1],'down']]) {
      await assertBlock(page,uid,spec,value,'committed '+uid);
      const committed=await block(page,uid).boundingBox();
      for(const key of ['x','y','width','height'])assert.ok(Math.abs(committed[key]-projected[uid][key])<.5,uid+' preview/commit '+key);
    }
    const result=await current(page);assert.equal(result.groups.length,1);
    assert.deepEqual(result.groups[0].items.map(n=>n.uid),['target-wait','drag-tilt','drag-motion']);
    cases.push({case:'real-touch-suffix-ghost-projection-and-commit-retain-selected-art',values:['right','down']});
  } finally {if(pressed)await send('touchCancel');await cdp.detach();}
}
async function exercise(browser,base,viewport,modelId='xiaobai') {
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},hasTouch:true,reducedMotion:'reduce'});
  await context.addInitScript(model=>localStorage.setItem('cardDefaultModelV1',model),modelId);
  const page=await context.newPage(),errors=[],badAssets=[],requested=new Set(),cases=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/'+PREFIX))requested.add(new URL(request.url()).pathname.slice(1));});
  page.on('response',response=>{if(response.url().includes('/'+PREFIX)&&response.status()>=400)badAssets.push({url:response.url(),status:response.status()});});
  page.on('requestfailed',request=>{if(request.url().includes('/'+PREFIX))badAssets.push({url:request.url(),failure:request.failure()?.errorText});});
  try {
    await page.goto(base+'#home');await idle(page);await page.locator('#newProject').tap();await idle(page);
    assert.equal(await page.evaluate(()=>CardModelSession.current.id),modelId);
    if(modelId!=='xiaobai') {
      assert.equal(await page.locator('#palette [data-card-id="tilt-wait"],#palette [data-card-id="motion-wait"]').count(),0);
      assert.equal(await page.evaluate(()=>Boolean(CardModelSession.current.artworkByCard?.['tilt-wait']||CardModelSession.current.artworkByCard?.['motion-wait'])),false);
      await comboRegression(page,modelId,cases);
      assert.equal(requested.size,0,'other models must not request Xiaobai accelerometer artwork');
      assert.deepEqual(errors,[]);assert.deepEqual(badAssets,[]);
      cases.push({case:'other-model-catalog-artwork-and-request-isolation'});
      return {modelId,viewport:viewport.name,pass:true,cases};
    }
    for(const spec of specs) {
      const palette=page.locator(`#palette > [data-card-id="${spec.id}"]`);
      await art(image(palette),expectedArt(spec.id,spec.default),spec.id+' palette default');
      assert.equal((await palette.locator(':scope > .param-bubble').textContent()).trim(),spec.options[0][2]);
    }
    cases.push({case:'both-palette-defaults-decode',values:['forward','still']});
    const catalog=await page.evaluate(()=>Object.fromEntries(Object.values(CardModelSession.current.catalog).flatMap(category=>category.cards).filter(card=>['tilt-wait','motion-wait'].includes(card.id)).map(card=>[card.id,card.paramsSchema])));
    assert.deepEqual(catalog['tilt-wait'].direction.options.map(option=>option.value),specs[0].options.map(option=>option[0]));
    assert.deepEqual(catalog['motion-wait'].state.options.map(option=>option.value),specs[1].options.map(option=>option[0]));
    assert.equal(catalog['tilt-wait'].direction.default,'forward');assert.equal(catalog['motion-wait'].state.default,'still');
    await load(page,mainDocument());
    await art(image(block(page,'loop-tilt')),OLD_LOOP,'conditional loop retains old artwork');
    const history=[];
    for(const [index,spec] of specs.entries()) {
      const uid=index?'motion':'tilt';await openOptions(page,uid);
      assert.equal(await page.locator('#paramEditor .param-option-btn').count(),4,spec.id+' has four existing options');
      for(const [value,label] of spec.options) {
        const before=await current(page),expected=copy(before);
        expected.groups[0].items[index].params[spec.key]=value;
        await page.locator('#paramEditor').getByRole('button',{name:label,exact:true}).tap();
        await assertBlock(page,uid,spec,value,spec.id+' '+value);
        assert.deepEqual(await current(page),expected,'only the selected existing parameter may change');
        history.push(expected);
        await art(image(block(page,'loop-tilt')),OLD_LOOP,'loop-tilt stays unchanged after '+value);
      }
      const rect=await page.locator('#paramEditor').boundingBox();
      assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+.5&&rect.y+rect.height<=viewport.height+.5,'options fit viewport');
      await screenshot(page,viewport,index?'states':'options');
      await page.keyboard.press('Escape');
      cases.push({case:'real-option-taps-update-art-bubble-and-only-existing-params',id:spec.id,values:spec.options.map(option=>option[0])});
    }
    await toolbar(page);await page.locator('#undoBtn').tap();
    assert.deepEqual(await current(page),history.at(-2),'one undo restores exactly the preceding option');
    await assertBlock(page,'motion',specs[1],'up','single undo');
    await page.locator('#redoBtn').tap();assert.deepEqual(await current(page),history.at(-1),'one redo restores the selected option');
    await assertBlock(page,'motion',specs[1],'down','single redo');cases.push({case:'single-option-single-undo-redo'});
    const stored=await current(page),name='加速度图标回归 '+viewport.name;
    await page.locator('#saveBtn').tap();await page.locator('.home-dialog input').fill(name);await page.locator('.home-dialog [type=submit]').tap();
    await page.locator('#homeBtn').tap();await idle(page);
    const project=page.getByRole('button',{name:'打开：'+name,exact:true});
    await project.scrollIntoViewIfNeeded();await frame(page);
    await art(project.locator('[data-card-id="tilt-wait"] > .card-icon img'),expectedArt('tilt-wait','right'),'saved home tilt');
    await art(project.locator('[data-card-id="motion-wait"] > .card-icon img'),expectedArt('motion-wait','down'),'saved home motion');
    await art(project.locator('[data-card-id="loop-tilt"] .loop-tail > .card-icon img'),OLD_LOOP,'saved home loop');
    await screenshot(page,viewport,'home');
    await project.tap();await idle(page);assert.deepEqual(await current(page),stored,'save/home/reopen retains layout and parameters');
    await page.reload();await idle(page);assert.deepEqual(await current(page),stored,'reload retains layout and parameters');
    await assertBlock(page,'tilt',specs[0],'right','reloaded tilt');await assertBlock(page,'motion',specs[1],'down','reloaded motion');
    cases.push({case:'real-save-home-selected-thumbnail-reopen-and-reload'});
    await touchPreview(page,context,viewport,cases);
    await comboRegression(page,'xiaobai',cases);
    for(const spec of specs)await art(image(page.locator(`#palette > [data-card-id="${spec.id}"]`)),expectedArt(spec.id,spec.default),spec.id+' palette remains default');
    assert.deepEqual([...requested].sort(),specs.flatMap(spec=>spec.options.map(option=>expectedArt(spec.id,option[0]))).sort(),'all eight actual assets were requested');
    assert.deepEqual(badAssets,[],'no accelerometer image request may fail or return 404');assert.deepEqual(errors,[]);
    return {modelId,viewport:viewport.name,pass:true,cases,decodedAssets:[...requested].sort(),pageErrors:errors,badAssets};
  } catch(error) {
    try {await page.screenshot({path:path.join(out,`accelerometer-${viewport.name}-${modelId}-failure.png`)});}catch{}
    error.context={modelId,viewport:viewport.name,cases,pageErrors:errors,badAssets};throw error;
  } finally {await context.close();}
}
async function main() {
  fs.mkdirSync(out,{recursive:true});
  const server=await staticServer();let browser;
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    const results=[];
    for(const viewport of viewports)results.push(await exercise(browser,server.url,viewport));
    for(const model of ['spark-ai','lbs2206','tc01','receiver2226'])results.push(await exercise(browser,server.url,viewports[0],model));
    const report={pass:true,input:'Real browser tap + CDP touch drag',root,out,contexts:results.length,cases:results.reduce((sum,result)=>sum+result.cases.length,0),results};
    fs.writeFileSync(path.join(out,'accelerometer-icons-results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally {await browser?.close();await server.close();}
}
if(require.main===module)main().catch(error=>{
  const report={pass:false,message:error.message,stack:error.stack,...error.context};
  try {fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'accelerometer-icons-results.json'),JSON.stringify(report,null,2)+'\n');}catch{}
  console.error(JSON.stringify(report,null,2));process.exitCode=1;
});
module.exports={main,staticServer};
