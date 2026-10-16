// Run from the app's tests directory after building dist. This uses real touch
// events and persisted programs; no Bluetooth commands are sent.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {Runner,validate}=require('../xiaobai-runner.js');
const root=path.resolve(__dirname,'../dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
const corners=[0,7,56,63];
const unsupported=/尚未提供.*通信协议/;
const block=(id,params={},children)=>({id,params,...(children?{children}:{})});
function protocolGuard(){
  const additions=[block('tilt-wait',{direction:'forward'}),block('eye-matrix',{leftPattern:Array(64).fill(0),rightPattern:Array(64).fill(0)})];
  for(const addition of additions)for(const nested of [false,true]){
    const calls=[];
    const connection={enterProgram(){calls.push('enter');},action(){calls.push('action');},stopProgram(){calls.push('stop');},cancelPending(){calls.push('cancel');}};
    // A valid motor block ahead of the new block must not start either.
    const program=[block('motor-forward-continuous',{port:'L'}),nested?block('loop-count',{count:2},[addition]):addition];
    assert.throws(()=>validate(program),unsupported);
    assert.throws(()=>new Runner(connection).run(program),unsupported);
    assert.deepEqual(calls,[],'preflight rejects before entering a mode or sending a device action');
  }
}
const idle=page=>page.waitForFunction(()=>!window.CardPageTransition?.busy);
const eyeState=page=>page.evaluate(()=>JSON.parse(JSON.stringify(program.find(item=>item.id==='eye-matrix').params)));
const gridSelector=key=>`#paramEditor .matrix-editor-grid[data-param-key="${key}"]`;
async function openEyes(page, afterHistoryRestore=false){
  if(!await page.locator(gridSelector('leftPattern')).isVisible()){
    const trigger=page.locator('#chain [data-card-id="eye-matrix"] .matrix-param-trigger');
    // History controls are invoked programmatically because this UI hides them.
    // Use normal click activation after that synthetic restore; all user touch flows use tap.
    if(afterHistoryRestore)await trigger.click();else await trigger.tap();
  }
  await page.locator(gridSelector('leftPattern')).waitFor({state:'visible'});
}
async function cellPoint(page,key,index){
  const box=await page.locator(`${gridSelector(key)} .matrix-cell[data-matrix-index="${index}"]`).boundingBox();
  assert.ok(box&&box.width>0&&box.height>0,'matrix cell has a touch region');
  return {x:box.x+box.width/2,y:box.y+box.height/2};
}
async function stroke(page,cdp,key,indexes){
  const points=[];for(const index of indexes)points.push(await cellPoint(page,key,index));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});
  for(let n=1;n<points.length;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[n]]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});

}
async function checkFits(page,viewport){
  const boxes=await page.locator('#paramEditor, #paramEditor .matrix-editor-grid').evaluateAll(nodes=>nodes.map(node=>({name:node.className,...node.getBoundingClientRect().toJSON()})));
  for(const box of boxes){
    assert.ok(box.left>=-1&&box.top>=-1&&box.right<=viewport.width+1&&box.bottom<=viewport.height+1,`${viewport.width}x${viewport.height} ${box.name} fits: ${JSON.stringify(box)}`);
  }
  const widths=await page.evaluate(()=>({view:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(widths.scroll<=widths.view+1,'matrix editor does not create horizontal page overflow');
}
async function xiaobaiTouch(browser,base,viewport){
  const context=await browser.newContext({viewport,hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(base+'/#editor');await idle(page);
    await page.locator('#tab-logic').tap();
    await page.locator('#palette [data-card-id="tilt-wait"]').tap();
    const tilt=page.locator('#chain [data-card-id="tilt-wait"] .param-bubble');
    await tilt.tap();
    assert.deepEqual(await page.locator('#paramEditor .param-option-btn').allTextContents(),['向前','向后','向左','向右']);
    for(const [label,bubble] of [['向前','先前倾倒'],['向后','向后倾倒'],['向左','向左倾倒'],['向右','向右倾倒']]){
      await page.locator('#paramEditor').getByRole('button',{name:label,exact:true}).tap();
      assert.equal(await tilt.textContent(),bubble);
    }
    await page.evaluate(()=>closeParamEditor());
    await page.locator('#tab-dynamic').tap();
    await page.locator('#palette [data-card-id="eye-matrix"]').tap();
    await openEyes(page);
    const schemas=await page.evaluate(()=>cardById['eye-matrix'].paramsSchema);
    for(const key of ['leftPattern','rightPattern']){
      assert.equal(schemas[key].rows,8);assert.equal(schemas[key].columns,8);assert.deepEqual(schemas[key].disabledIndexes,corners);
      assert.equal(await page.locator(`${gridSelector(key)} .matrix-cell`).count(),64);
      assert.equal(await page.locator(`${gridSelector(key)} .matrix-cell:enabled`).count(),60);
      assert.deepEqual(await page.locator(`${gridSelector(key)} .matrix-cell:disabled`).evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.matrixIndex))),corners);
    }
    const isolation=await page.evaluate(()=>CardModels.list().map(model=>({id:model.id,extra:Object.values(model.catalog).flatMap(group=>group.cards).filter(card=>['tilt-wait','eye-matrix'].includes(card.id)).map(card=>card.id)})));
    assert.deepEqual(isolation.find(model=>model.id==='xiaobai').extra,['tilt-wait','eye-matrix']);
    assert.ok(isolation.filter(model=>model.id!=='xiaobai').every(model=>model.extra.length===0),'new blocks belong only to Xiaobai');
    await checkFits(page,viewport);
    // Imported/on-wire-like arrays must never light physically missing corners.
    const normalized=await page.evaluate(()=>normalizeParamValue(cardById['eye-matrix'].paramsSchema.leftPattern,Array(64).fill(1)));
    assert.equal(normalized.reduce((sum,value)=>sum+value,0),60);
    corners.forEach(index=>assert.equal(normalized[index],0));
    await page.evaluate(()=>{
      setActiveParamValue('leftPattern',Array(64).fill(0));
      setActiveParamValue('rightPattern',Array(64).fill(0));
    });
    const cdp=await context.newCDPSession(page);
    const before=await eyeState(page),historyBefore=await page.evaluate(()=>historyIndex);
    await stroke(page,cdp,'leftPattern',[17,18,19,20,21]);
    const leftDrawn=await eyeState(page);
    assert.equal(leftDrawn.leftPattern.filter(Boolean).length,5,'touch drag draws all crossed pixels');
    [17,18,19,20,21].forEach(index=>assert.equal(leftDrawn.leftPattern[index],1));
    assert.deepEqual(leftDrawn.rightPattern,before.rightPattern,'drawing the left eye preserves the right eye');
    assert.equal(await page.evaluate(()=>historyIndex),historyBefore+1,'one stroke is one undo action');
    await page.evaluate(()=>document.getElementById('undoBtn').click());
    assert.deepEqual(await eyeState(page),before,'one undo reverts the complete stroke');
    await page.evaluate(()=>document.getElementById('redoBtn').click());
    assert.deepEqual(await eyeState(page),leftDrawn,'redo restores the complete stroke');
    assert.equal(await page.locator('#paramEditor').isVisible(),false,'undo/redo dismisses the parameter editor without leaving an empty popup');
    await openEyes(page,true);
    await stroke(page,cdp,'rightPattern',[33,34,35]);
    const bothDrawn=await eyeState(page);
    assert.deepEqual(bothDrawn.leftPattern,leftDrawn.leftPattern);
    [33,34,35].forEach(index=>assert.equal(bothDrawn.rightPattern[index],1));
    assert.equal(bothDrawn.rightPattern.filter(Boolean).length,3);
    // Touching absent LEDs must leave both the data and undo history unchanged.
    for(const key of ['leftPattern','rightPattern'])for(const index of corners){
      await openEyes(page);
      const oldHistory=await page.evaluate(()=>historyIndex),point=await cellPoint(page,key,index);
      await page.touchscreen.tap(point.x,point.y);
      assert.deepEqual(await eyeState(page),bothDrawn);
      assert.equal(await page.evaluate(()=>historyIndex),oldHistory);
    }
    await openEyes(page);await checkFits(page,viewport);
    const artifacts=path.resolve(__dirname,'../artifacts');fs.mkdirSync(artifacts,{recursive:true});
    await page.screenshot({path:path.join(artifacts,`xiaobai-eye-editor-${viewport.width}x${viewport.height}.png`)});
    await page.evaluate(()=>closeParamEditor());
    await page.locator('#saveBtn').tap();
    const name=`双眼编辑测试 ${viewport.width}`;
    if(await page.locator('.home-dialog input').isVisible()){
      await page.locator('.home-dialog input').fill(name);await page.locator('.home-dialog [type=submit]').tap();
    }
    const snapshot=await page.evaluate(()=>getProgramSnapshot());
    await page.reload();await idle(page);
    if(await page.locator('.home-screen').isVisible()){
      await page.getByRole('button',{name:'打开：'+name,exact:true}).tap();await idle(page);
    }
    assert.equal(await page.evaluate(()=>getProgramSnapshot()),snapshot,'named program persists after reload');
    assert.deepEqual(await eyeState(page),bothDrawn,'independent eye patterns persist');
    assert.equal(await page.locator('#chain [data-card-id="tilt-wait"] .param-bubble').textContent(),'向右倾倒');
    await openEyes(page);await checkFits(page,viewport);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function sparkRegression(browser,base){
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','spark-ai'));
  const page=await context.newPage();
  try{
    await page.goto(base+'/#editor');await idle(page);
    await page.locator('#tab-light').tap();await page.locator('#palette [data-card-id="matrix-display"]').tap();
    await page.locator('#chain .matrix-param-trigger').tap();
    assert.equal(await page.locator('#paramEditor .matrix-cell').count(),25);
    assert.equal(await page.locator('#paramEditor .matrix-cell:disabled').count(),0);
    const before=await page.evaluate(()=>program[0].params.pattern.slice());
    await page.locator('#paramEditor .matrix-cell').first().tap();
    const after=await page.evaluate(()=>program[0].params.pattern.slice());
    assert.equal(after.length,25);assert.equal(after[0],before[0]?0:1);assert.deepEqual(after.slice(1),before.slice(1));
  }finally{await context.close();}
}
(async()=>{
  protocolGuard();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const viewport of [{width:844,height:390},{width:568,height:280}])await xiaobaiTouch(browser,base,viewport);
    await sparkRegression(browser,base);
    console.log('PASS Xiaobai tilt choices, independent 8x8 eyes, absent corners, touch strokes, one-stroke undo, save/reload, phone fit, Spark 5x5 and pre-send protocol guard.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
