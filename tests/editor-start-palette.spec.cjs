'use strict';
// Focused, isolated-context browser regression. Never uses the user's browser,
// storage, BLE/native adapters or a fixed preview port. Build dist first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const models = ['xiaobai', 'spark-ai', 'lbs2206', 'tc01', 'receiver2226'];
const viewports = [{name:'phone',width:844,height:390},{name:'tablet',width:1280,height:800}];
const artifacts = path.join(root, 'artifacts');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml',
  '.png':'image/png','.webp':'image/webp','.json':'application/json','.wav':'audio/wav','.mp3':'audio/mpeg'};

async function staticServer() {
  const dist = path.join(root, 'dist');
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'run npm run build:web first');
  const server = http.createServer((req,res) => {
    let file;
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      file = path.resolve(dist, '.' + pathname.replace(/\/$/, '/index.html'));
    } catch { res.writeHead(400);res.end();return; }
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);res.end();return;
    }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(resolve=>server.close(resolve))};
}
const idle = page => page.waitForFunction(() => Boolean(window.CardEditor && window.CardCanvas) && !window.CardPageTransition?.busy);
const workspace = page => page.evaluate(() => CardEditor.getWorkspace());
const paletteIds = page => page.locator('#palette > [data-card-id]').evaluateAll(nodes => nodes.map(n=>n.dataset.cardId));
async function capture(page,file) {
  await page.waitForFunction(()=>!document.querySelector('.tab-slider')?.getAnimations().some(animation=>animation.playState==='running'||animation.pending));
  await page.screenshot({path:path.join(artifacts,file)});
}
async function tab(page,id) {
  await page.locator('#tab-'+id).click();
  await page.waitForFunction(id => {
    const palette=document.getElementById('palette'),first=palette.querySelector(`[data-palette-category="${id}"]`);
    return document.getElementById('tab-'+id)?.getAttribute('aria-selected')==='true'&&first&&
      Math.abs(first.getBoundingClientRect().left-palette.getBoundingClientRect().left-parseFloat(getComputedStyle(palette).paddingLeft))<1;
  }, id);
}

async function checkModel(browser,base,viewport,modelId) {
  const context = await browser.newContext({viewport:{width:viewport.width,height:viewport.height},
    hasTouch:true,reducedMotion:viewport.reducedMotion||'reduce'});
  await context.addInitScript(model => localStorage.setItem('cardDefaultModelV1', model), modelId);
  const page = await context.newPage(), errors = [], results = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    const url = new URL(base);url.hash='home';
    await page.goto(url.href);await idle(page);
    assert.equal(await page.evaluate(()=>CardModelSession.current.id),modelId);
    await page.locator('#newProject').click();await idle(page);
    const initial = await workspace(page);
    assert.equal(initial.groups.length,1,`${modelId}: new document must have one group`);
    const group = initial.groups[0];
    assert.ok(group.startId,`${modelId}: missing default start`);
    assert.equal(group.items.length,0);
    assert.equal(initial.selectedGroupId,group.id,`${modelId}: default group is not selected`);
    assert.equal(await page.locator('#chain [data-start-id]').count(),1);
    const geometry = await page.locator('#chain [data-start-id]').evaluate(el => {
      const r=el.getBoundingClientRect(),v=document.querySelector('.program-canvas').getBoundingClientRect();
      return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,
        canvas:{left:v.left,top:v.top,right:v.right,bottom:v.bottom},screen:{width:innerWidth,height:innerHeight}};
    });
    assert.ok(geometry.width>0&&geometry.height>0&&geometry.left>=geometry.canvas.left-.5&&
      geometry.top>=geometry.canvas.top-.5&&geometry.right<=geometry.canvas.right+.5&&
      geometry.bottom<=geometry.canvas.bottom+.5&&geometry.left>=0&&geometry.top>=0&&
      geometry.right<=viewport.width&&geometry.bottom<=viewport.height,
      `${modelId}: initial head outside viewport: ${JSON.stringify(geometry)}`);
    results.push({case:'new-single-selected-visible-start',pass:true,geometry});

    const catalog = await page.evaluate(() => ({single:Boolean(CardModelSession.current.singlePalette),
      groups:Object.fromEntries(Object.entries(CardModelSession.current.catalog).map(([id,g])=>
        [id,{label:g.label||id,ids:g.cards.map(c=>c.id)}]))}));
    const expectedTabs = Object.keys(catalog.groups);
    const expectedPalette = ['__start__',...(modelId === 'xiaobai' ? ['__message_start__'] : []),...expectedTabs.flatMap(id => catalog.groups[id].ids)];
    const initialPalette = await paletteIds(page);
    assert.equal(initialPalette[0],'__start__',`${modelId}: start must be the leftmost palette entry`);
    assert.equal(initialPalette.filter(id=>id==='__start__').length,1,`${modelId}: palette must have exactly one start entry`);
    assert.deepEqual(await page.locator('.tabs > .tab').evaluateAll(nodes=>nodes.map(n=>n.id.slice(4))),expectedTabs,
      `${modelId}: category structure changed`);
    const firstPaletteNode=await page.locator('#palette > [data-card-id]').first().elementHandle();
    for(const category of expectedTabs) {
      await tab(page,category);
      assert.deepEqual(await paletteIds(page),expectedPalette,
        `${modelId}/${category}: locating a category replaced or hid cards`);
      assert.equal(await firstPaletteNode.evaluate(el=>el.isConnected),true);
      const alignment=await page.evaluate(category=>{
        const palette=document.getElementById('palette'),first=palette.querySelector(`[data-palette-category="${category}"]`);
        return {left:first.getBoundingClientRect().left-palette.getBoundingClientRect().left,
          padding:parseFloat(getComputedStyle(palette).paddingLeft),hidden:[...palette.children].some(el=>getComputedStyle(el).display==='none')};
      },category);
      assert.ok(Math.abs(alignment.left-alignment.padding)<1,`${modelId}/${category}: first card did not align: ${JSON.stringify(alignment)}`);
      assert.equal(alignment.hidden,false);
      results.push({case:'palette-'+category+'-locates-without-replacing-cards',pass:true});
    }
    await tab(page,expectedTabs[0]);
    const beforeBrowse=await workspace(page),paletteBox=await page.locator('#palette').boundingBox();
    const cdp=await context.newCDPSession(page);
    async function browse(from,to) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
      for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{
        type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*step/8,y:from.y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    const left={x:paletteBox.x+20,y:paletteBox.y+22},right={x:paletteBox.x+paletteBox.width-20,y:left.y};
    await browse(right,left);
    await page.waitForFunction(first=>document.querySelector('.tab[aria-selected="true"]')?.id!=='tab-'+first,expectedTabs[0]);
    assert.ok(await page.locator('#palette').evaluate(el=>el.scrollLeft)>100);
    assert.deepEqual(await workspace(page),beforeBrowse,'horizontal browse added or moved canvas blocks');
    await browse(left,right);
    await page.waitForFunction(first=>document.querySelector('.tab[aria-selected="true"]')?.id==='tab-'+first,expectedTabs[0]);
    await cdp.detach();
    assert.deepEqual(await workspace(page),beforeBrowse);
    assert.equal(await firstPaletteNode.evaluate(el=>el.isConnected),true);
    results.push({case:'manual-horizontal-browse-syncs-tabs-without-adding',pass:true});
    await tab(page,'logic');
    if(modelId==='xiaobai') {
      await capture(page,`editor-continuous-palette-${viewport.name}-logic.png`);
    }
    // One real click verifies that palette reorganization still appends to the
    // selected default group; broader storage/undo cases live in canvas tests.
    const scrollBeforeAdd=await page.locator('#palette').evaluate(el=>el.scrollLeft);
    await page.locator('#palette > [data-card-id="wait-time"]').click();
    const appended=await workspace(page);
    assert.equal(appended.groups.length,1);assert.equal(appended.groups[0].startId,group.startId);
    assert.deepEqual(appended.groups[0].items.map(i=>i.id),['wait-time']);
    assert.equal(await firstPaletteNode.evaluate(el=>el.isConnected),true,'canvas edit rebuilt the palette');
    assert.ok(Math.abs(await page.locator('#palette').evaluate(el=>el.scrollLeft)-scrollBeforeAdd)<1,'canvas edit reset palette scroll');
    await page.evaluate(()=>CardEditor.undo());
    assert.deepEqual(await workspace(page),initial,`${modelId}: one undo must restore only the initial head`);
    assert.equal(await firstPaletteNode.evaluate(el=>el.isConnected),true,'undo rebuilt the palette');
    assert.ok(Math.abs(await page.locator('#palette').evaluate(el=>el.scrollLeft)-scrollBeforeAdd)<1,'undo reset palette scroll');
    results.push({case:'click-append-and-single-undo',pass:true});

    const powerCards=await page.evaluate(()=>Object.values(CardModelSession.current.catalog).flatMap(g=>g.cards)
      .filter(c=>['motor-power','combo-power'].includes(c.id)).map(c=>({id:c.id,params:Object.fromEntries(
        Object.entries(c.paramsSchema).map(([key,s])=>[key,JSON.parse(JSON.stringify(s.default??null))])),
        keys:['port','power'].filter(key=>c.paramsSchema[key]),values:c.paramsSchema.power.options.map(o=>typeof o==='object'?o.value:o)})));
    for(const card of powerCards){
      await page.evaluate(card=>CardEditor.setWorkspace({schemaVersion:2,kind:'free-canvas',groups:[{
        id:'power-group',startId:'power-head',x:80,y:130,items:[{uid:'power-block',id:card.id,params:card.params}]}],
        viewport:{x:0,y:0,scale:1},selectedGroupId:'power-group'}),card);
      await page.locator('#chain [data-node-uid="power-block"] > .param-bubble').click();
      const panel=page.locator('#paramEditor .motor-power-editor');await panel.waitFor({state:'visible'});
      assert.equal(await panel.locator(':scope > .card-icon').count(),0,'power editor retained decoration');
      assert.equal(await panel.locator(':scope > .param-option-row').count(),card.keys.length);
      assert.ok(await panel.locator(':scope > .param-option-row').evaluateAll(nodes=>nodes.every(n=>parseFloat(getComputedStyle(n).borderTopWidth)===0)),'power editor retained a separator');
      assert.equal(await panel.locator('.power-option').count(),card.values.length);
      if(modelId==='xiaobai'&&card.id==='motor-power')await capture(page,`editor-continuous-palette-${viewport.name}-power.png`);
      await panel.locator('.power-option').last().click();
      assert.equal((await workspace(page)).groups[0].items[0].params.power,card.values[card.values.length-1]);
      await page.evaluate(()=>document.getElementById('paramEditor').hidden=true);
      results.push({case:card.id+'-compact-options-preserve-values',pass:true});
    }

    if(modelId==='xiaobai') {
      await tab(page,'dynamic');
      const dynamic = await page.evaluate(() => {
        const cards=CardModelSession.current.catalog.dynamic.cards;
        const items=cards.map(card=>({uid:'outline-'+card.id,id:card.id,
          params:Object.fromEntries(Object.entries(card.paramsSchema||{}).map(([key,schema])=>
            [key,JSON.parse(JSON.stringify(schema.default??null))]))}));
        CardEditor.setWorkspace({schemaVersion:2,kind:'free-canvas',groups:[{
          id:'outline-group',startId:'outline-start',x:45,y:125,items}],
          viewport:{x:0,y:0,scale:1},selectedGroupId:'outline-group'});
        return cards.map(c=>c.id);
      });
      const outlines = await page.evaluate(ids => ids.map(id => {
        const el=CardEditor.findBlockByUid('outline-'+id),p=el.querySelector(':scope > .block-outline > path');
        const style=getComputedStyle(p),bubble=el.querySelector(':scope > .param-bubble');
        const b=bubble&&getComputedStyle(bubble);
        return {id,stroke:style.stroke,width:style.strokeWidth,bubble:b&&{color:b.borderTopColor,width:b.borderTopWidth,style:b.borderTopStyle}};
      }),dynamic);
      assert.equal(outlines.length,dynamic.length);
      for(const outline of outlines) {
        assert.equal(outline.stroke,'rgb(92, 42, 181)',outline.id+' body border color');
        assert.equal(outline.width,outlines[0].width,outline.id+' body border width');
        if(outline.bubble)assert.deepEqual(outline.bubble,outlines.find(o=>o.bubble).bubble,outline.id+' parameter border');
      }
      const svg = await page.evaluate(async()=>{
        const image=CardEditor.findBlockByUid('outline-self-learned-wait').querySelector('.card-icon img');
        const response=await fetch(image.src);if(!response.ok)throw Error('self-learned SVG did not load');
        const doc=new DOMParser().parseFromString(await response.text(),'image/svg+xml');
        return {src:image.getAttribute('src'),stroke:doc.querySelector('g')?.getAttribute('stroke'),width:doc.querySelector('g')?.getAttribute('stroke-width')};
      });
      assert.equal(svg.width,'20');assert.equal(svg.stroke,'#691ff0');
      results.push({case:'all-dynamic-body-and-parameter-borders-match',pass:true,outlines,svg});
      await capture(page,`editor-continuous-palette-${viewport.name}-dynamic.png`);
    }
    assert.deepEqual(errors,[],`${modelId}: uncaught browser errors`);
    return {modelId,viewport:{width:viewport.width,height:viewport.height},pass:true,results};
  } finally { await context.close(); }
}

async function main() {
  fs.mkdirSync(artifacts,{recursive:true});
  const server=process.env.CARD_TEST_URL?null:await staticServer();
  let browser;
  try {
    browser=await chromium.launch({channel:process.env.CARD_TEST_BROWSER_CHANNEL||'msedge',headless:true});
    const results=[];
    for(const viewport of viewports)for(const modelId of models)
      results.push(await checkModel(browser,process.env.CARD_TEST_URL||server.url,viewport,modelId));
    const report={pass:true,scope:'Real headless browser, separate context/storage per model and viewport; no hardware',
      contexts:results.length,cases:results.reduce((n,r)=>n+r.results.length,0),results,
      screenshots:viewports.flatMap(v=>['logic','power','dynamic'].map(scene=>path.join(artifacts,`editor-continuous-palette-${v.name}-${scene}.png`)))};
    console.log('PASS '+JSON.stringify(report,null,2));
    return report;
  } finally { await browser?.close();await server?.close(); }
}
module.exports={main,checkModel,staticServer};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
