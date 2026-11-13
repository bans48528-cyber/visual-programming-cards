'use strict';
// Real touch gestures in an isolated browser profile; never touches user projects.
// Covers all five loop types, 25%-150% zoom, trailing blocks, capture, cancel and undo/redo.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const root=path.resolve(process.env.CARD_APP_ROOT||path.join(__dirname,'..'));
const {chromium}=createRequire(path.join(root,'package.json'))('playwright');
async function staticServer(){const http=require('node:http'),web=path.join(root,'dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.json':'application/json'};const server=http.createServer((req,res)=>{const file=path.resolve(web,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(web+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));return{url:'http://127.0.0.1:'+server.address().port+'/',close:()=>new Promise(r=>server.close(r))};}
const M=require(path.join(root,'canvas-workspace.js'));
const loops=[['loop-count',{count:2}],['loop',{}],['loop-infrared',{comparison:'greater',threshold:50}],['loop-tilt',{direction:'left'}],['loop-time',{duration:5}]];
const candidate=true,shipping=false,source=process.env.CARD_CANVAS_SOURCE,override=Boolean(source),out=path.resolve(process.env.CARD_TEST_OUT||path.join(root,'artifacts/test-results/loop-front'));
const item=(uid,id='motor-forward',params={port:'L/M1',duration:2.5},children)=>({uid,id,params,...(children?{children}:{})});
const group=(id,x,y,items,startId=null)=>({id,x,y,items,startId});
const doc=(groups,scale=1)=>({schemaVersion:2,kind:'free-canvas',groups,viewport:{x:scale<.5?120:0,y:scale<.5?110:0,scale},selectedGroupId:'source'});
const frame=page=>page.evaluate(()=>new Promise(requestAnimationFrame));
const byId=(page,uid)=>page.locator('#chain [data-node-uid="'+uid+'"]');
async function load(page,value){assert.equal(await page.evaluate(value=>CardEditor.setWorkspace(value),value),true);await frame(page);}
async function drag(page,context,{state,uid='incoming',targetSide='front',capture=false,mouthInsert=false,paletteId=null,commit=true,label,expectTarget=true}){
 await load(page,state);const cdp=await context.newCDPSession(page);let active=false;
 const send=(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y,radiusX:1,radiusY:1}]:[]});
 try{
  const initial=await page.evaluate(()=>CardEditor.getWorkspace());
  const target=await page.evaluate(({targetSide,capture,mouthInsert})=>CardCanvas.getSlots().find(s=>s.groupId==='target'&&s.parentUid===null&&s.index===0&&((capture||mouthInsert)?!s.side:s.side===targetSide)),{targetSide,capture,mouthInsert});assert(target,'target port exists');
  let down,offset,offsetY=0;
  if(paletteId){const source=page.locator('#palette > [data-card-id="'+paletteId+'"]');await source.scrollIntoViewIfNeeded();const box=await source.boundingBox();down={x:box.x+10,y:box.y+box.height/2};offset=26*state.viewport.scale;await send('touchStart',down);active=true;await send('touchMove',{x:down.x,y:down.y-50});}
  else{const source=byId(page,uid),box=await source.boundingBox(),anchor=await source.evaluate(el=>Number(el.dataset.connectorY));offset=12*state.viewport.scale;down={x:box.x+offset,y:box.y+anchor*state.viewport.scale};if(await source.locator(':scope > .loop-top').count()){down={x:box.x+box.width*.5,y:box.y+4*state.viewport.scale};offset=box.width*.5;offsetY=(4-anchor)*state.viewport.scale;}await send('touchStart',down);active=true;await send('touchMove',{x:down.x+25,y:down.y-3});}
  await frame(page);assert.equal(await page.evaluate(()=>CardCanvas.getGesture()?.active),true,label+' drag active');
  const metrics=await page.evaluate(()=>{const g=document.querySelector('.free-canvas-ghost');return{advance:g._metrics.advance,innerLeft:parseFloat(g.querySelector(':scope > .loop-block > .loop-inner')?.style.left)||0};});
  const distance=capture||mouthInsert?metrics.innerLeft:metrics.advance;
  const destination={x:target.x+offset-distance*state.viewport.scale,y:target.y+offsetY};
  await send('touchMove',destination);await frame(page);
  const selected=await page.evaluate(()=>CardCanvas.getGesture()?.target);
  if(!expectTarget){assert.equal(selected,null,label+' baseline must reproduce missing front target');await send('touchCancel');active=false;await frame(page);assert.deepEqual(await page.evaluate(()=>CardEditor.getWorkspace()),initial);return{label,selected,baselineReproduced:true};}
  assert.equal(selected?.groupId,'target',label+' target group');
  if(mouthInsert){assert.equal(selected?.mode,undefined,label+' filled mouth never captures');assert.equal(selected?.side,undefined,label+' ordinary insertion remains available');assert.equal(selected?.index,0);}
  else assert.equal(capture?selected?.mode:selected?.side,capture?'wrap':'front',label+' target mode');
  const projection=capture?page.locator('#chain .free-canvas-wrap-incoming'):page.locator('.free-canvas-projection > .program-block').first();
  const projected=await projection.boundingBox();assert(projected,label+' projection exists');
  const targetBefore=await byId(page,'target-a').boundingBox();
  if(label.endsWith('-loop-count-empty-z1')||label==='reverse-target-loop')await page.screenshot({path:path.join(out,label+'.png')});
  if(!commit){await send('touchCancel');active=false;await frame(page);assert.deepEqual(await page.evaluate(()=>CardEditor.getWorkspace()),initial);return{label,selected,cancelRestored:true};}
  const beforeEnd=await page.evaluate(()=>({gesture:CardCanvas.getGesture(),view:CardEditor.getWorkspace().viewport,ghost:(()=>{const el=document.querySelector('.free-canvas-ghost');return{rect:el.getBoundingClientRect().toJSON(),metrics:el._metrics};})()}));
  await send('touchEnd');active=false;await frame(page);
  const result=await page.evaluate(()=>CardEditor.getWorkspace());if(result.groups.length!==1){console.log(JSON.stringify({label,selected,destination,beforeEnd,result}));await page.screenshot({path:path.join(out,'failed-commit.png')});}assert.equal(result.groups.length,1,label+' one committed group');assert.deepEqual(M.validate(result),{ok:true,errors:[]});
  const incoming=capture?result.groups[0].items[0]:M.findNode(result,uid)?.item;
  if(!paletteId)assert.equal(incoming?.uid,uid,label+' stable incoming uid');
  if(capture){assert.deepEqual(incoming.children.map(n=>n.uid),['target-a','target-b']);assert.equal(result.groups[0].items.length,1);}
  else{const originalIncoming=M.findNode(initial,uid)?.item;const prefixLength=initial.groups.find(g=>g.id==='source')?.items.length||1;if(originalIncoming)assert.deepEqual(M.findNode(result,uid).item,originalIncoming,label+' incoming children and params retained');assert.equal(result.groups[0].items[prefixLength].uid,'target-a',label+' suffix retained outside loop');assert.equal(result.groups[0].items[prefixLength+1].uid,'target-b');}
  const committed=capture?byId(page,incoming.uid):paletteId?byId(page,result.groups[0].items[0].uid):byId(page,uid),actual=await committed.boundingBox();
  for(const key of ['x','y','width','height'])assert(Math.abs(actual[key]-projected[key])<.5,label+' preview/commit '+key);
  if(!capture){const targetAfter=await byId(page,'target-a').boundingBox();for(const key of ['x','y','width','height'])assert(Math.abs(targetBefore[key]-targetAfter[key])<.5,label+' target position '+key);}
  assert.equal(await page.locator('.free-canvas-ghost,.free-canvas-projection,.free-canvas-wrap-incoming').count(),0,label+' no stale drag visuals');
  const committedState=await page.evaluate(()=>CardEditor.getWorkspace());await page.evaluate(()=>CardEditor.undo());await frame(page);assert.deepEqual(await page.evaluate(()=>CardEditor.getWorkspace()),initial,label+' undo restores both groups and structure');await page.evaluate(()=>CardEditor.redo());await frame(page);assert.deepEqual(await page.evaluate(()=>CardEditor.getWorkspace()),committedState,label+' redo restores one merge');return{label,selected,previewCommitAgrees:true,childStructurePreserved:true,undoRedo:true};
 }finally{if(active)await send('touchCancel');await cdp.detach();}
}
async function main(){
 fs.mkdirSync(out,{recursive:true});const server=await staticServer();let browser;
 try{browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true,reducedMotion:'reduce'});const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));let loadedScriptSha,candidateLoads=0;
  page.on('response',response=>{if(/\/free-canvas\.js(?:\?|$)/.test(response.url()))loadedScriptSha=response.body().then(bytes=>crypto.createHash('sha256').update(bytes).digest('hex'));});
  if(override)await page.route(/\/free-canvas\.js(?:\?|$)/,route=>{candidateLoads++;return route.fulfill({path:source,contentType:'text/javascript'});});
  await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));await page.goto(server.url+'#home');await page.waitForFunction(()=>Boolean(window.CardEditor&&window.CardCanvas)&&!window.CardPageTransition?.busy);await page.locator('#newProject').tap();await page.waitForFunction(()=>!window.CardPageTransition?.busy);
  assert.equal(candidateLoads,override?1:0,'candidate override must only run in candidate mode');
  const servedSha256=await loadedScriptSha;if(candidate)assert.equal(servedSha256,crypto.createHash('sha256').update(fs.readFileSync(source||path.join(root,'free-canvas.js'))).digest('hex'),'actual loaded script bytes');const results=[];
  for(const [id,params]of (shipping?loops.slice(0,1):loops)){for(const filled of (shipping?[false]:[false,true]))for(const scale of (shipping?[1]:[.25,.4,.5,1,1.5])){
   const incoming=item('incoming',id,params,filled?[item('own-child')]:[]),state=doc([group('target',600,220,[item('target-a'),item('target-b')]),group('source',80,330,[incoming])],scale),label=`canvas-${id}-${filled?'filled':'empty'}-z${scale}`;
   results.push(await drag(page,context,{state,label,expectTarget:candidate||filled}));
  }}
  for(const [id,params]of loops)for(const filled of [false,true])for(const scale of [.25,.4,1]){const state=doc([group('target',600,220,[item('target-a'),item('target-b')]),group('source',80,330,[item('incoming',id,params,filled?[item('own-child')]:[]),item('dragged-tail')])],scale);results.push(await drag(page,context,{state,label:`tail-${id}-${filled?'filled':'empty'}-z${scale}`}));}
  for(const filled of [false,true])for(const scale of [.25,.4,1])results.push(await drag(page,context,{state:doc([group('target',600,220,[item('target-a','loop-count',{count:2},filled?[item('target-child')]:[]),item('target-b')]),group('source',80,330,[item('incoming')])],scale),label:`ordinary-before-${filled?'filled':'empty'}-loop-z${scale}`}));
  // Ordinary blocks must also join in front of a loop, without entering it.
  if(!shipping)results.push(await drag(page,context,{state:doc([group('target',600,220,[item('target-a','loop-count',{count:2},[item('target-child')]),item('target-b')]),group('source',80,330,[item('incoming')])]),label:'reverse-target-loop'}));
  if(candidate){
   for(const [id,params]of (shipping?loops.slice(0,1):loops)){const state=doc([group('target',600,220,[item('target-a'),item('target-b')])]);state.selectedGroupId=null;results.push(await drag(page,context,{state,paletteId:id,label:`palette-${id}-empty-z1`}));}
   if(!shipping){
   results.push(await drag(page,context,{state:doc([group('target',600,220,[item('target-a'),item('target-b')]),group('source',80,330,[item('incoming','loop',{},[])])]),label:'mouth-still-prioritizes-wrap',capture:true}));
   results.push(await drag(page,context,{state:doc([group('target',600,220,[item('target-a'),item('target-b')]),group('source',80,330,[item('incoming','loop-count',{count:2},[item('own-child')])])]),label:'filled-mouth-inserts-without-capture',mouthInsert:true}));
   for(const filled of [false,true])results.push(await drag(page,context,{state:doc([group('target',600,220,[item('target-a','loop',{},filled?[item('target-child')]:[]),item('target-b')]),group('source',80,330,[item('incoming','loop-count',{count:2},[])])]),label:`loop-to-${filled?'filled':'empty'}-loop-front`}));
   results.push(await drag(page,context,{state:doc([group('target',600,220,[item('target-a'),item('target-b')]),group('source',80,330,[item('incoming','loop-count',{count:2},[item('nested','loop',{},[item('deep')])])])]),label:'nested-filled-loop-front-cancel',commit:false}));
   }
  }
  const dual=doc([group('target',500,220,[item('target-a')],'target-head')]);dual.selectedGroupId='target';const rejected=M.drop(dual,{startId:'incoming-head',items:[item('incoming','loop',{},[])]},{groupId:'target',index:0});assert.equal(rejected.ok,false);assert.equal(rejected.reason,'two-starts');
  assert.deepEqual(errors,[]);const report={pass:true,candidate,shipping,scriptOverrideCount:candidateLoads,servedSha256,cases:results.length,emptyLoopBaselineReproductions:results.filter(r=>r.baselineReproduced).length,twoStartsRejected:true,pageErrors:errors,results};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:true,candidate,shipping,cases:results.length,scriptOverrideCount:candidateLoads,servedSha256,baselineFailuresReproduced:report.emptyLoopBaselineReproductions,pageErrors:errors}));await context.close();
 }finally{await browser?.close();await server.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
