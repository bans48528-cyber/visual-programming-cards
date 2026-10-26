const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const mockAndroid=require('./mock-android.cjs');
const root=path.resolve(process.env.XIAOBAI_TEST_ROOT||path.join(__dirname,'../dist'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});

// A deterministic test device at the native BLE boundary. Production code must
// never create these events: the test controls each recording, save and hit.
function installLearnedDevice(){
  const u32=value=>[value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255];
  const readId=bytes=>(bytes[7]+bytes[8]*256+bytes[9]*65536+bytes[10]*16777216)>>>0;
  const device=window.learnedDevice={
    uid:[0x10,0x20,0x30,0x40,0x50,0x60,0x70,0x80,0x90,0xa0,0xb0,0xc0],
    mask:0,caps:15,counter:0,requests:[],tasks:{},queries:[],queryDelay:20,autoQuery:true,autoCancel:true,
    holdEnter:false,blockedEnters:0,enterReleases:[],
    releaseEnter(){this.holdEnter=false;for(const release of this.enterReleases.splice(0))release();},
    packet(type,data){
      const bytes=[0x5a,0x98,0x97,10,type,...data];
      while(bytes.length<15)bytes.push(0);
      bytes.push(bytes.reduce((sum,value)=>sum+value,0)&255,0xa5);
      if(bytes.length!==17)throw new Error('Test device produced a malformed frame');
      mockBle.feed(String.fromCharCode(...bytes));
    },
    ack(request,result=0,data=[]){request.acked=true;this.packet(0xd2,[request.seq,request.op,result,...data]);},
    query(request){this.ack(request,0,[...u32(request.id),this.mask&255,this.mask>>>8,this.caps]);},
    stage(task,stage,state=2,reason=0,slot=this.tasks[task]?.slot){
      if(slot===undefined)throw new Error('Unknown test task');
      if(stage>=4&&stage<=8&&state!==2){
        if(state===1)this.mask|=1<<(slot-1);else this.mask&=~(1<<(slot-1));
      }
      this.packet(0xd3,[8,++this.counter&255,...u32(task),slot,stage,state,reason]);
    },
    hit(task,slot=this.tasks[task]?.slot){this.packet(0xd3,[9,++this.counter&255,...u32(task),slot,0,0,0]);},
    latest(op){return this.requests.filter(request=>request.op===op).at(-1);},
    count(op){return this.requests.filter(request=>request.op===op).length;}
  };
  mockBle.respondC2=bytes=>{
    const op=bytes[6];
    if(op<0x52||op>0x57)return false;
    const request={bytes:Array.from(bytes),seq:bytes[5],op,id:readId(bytes),slot:bytes[11],flag:bytes[12]};
    device.requests.push(request);
    if(op===0x52){
      device.queries.push(request);
      if(device.autoQuery)setTimeout(()=>device.query(request),device.queryDelay);
    }else if(op===0x56){
      setTimeout(()=>device.ack(request,0,[bytes[7],...device.uid.slice(bytes[7]*6,bytes[7]*6+6)]),5);
    }else if(op===0x57){
      setTimeout(()=>device.ack(request,0,[...u32(request.id),bytes[11],0,0]),5);
    }else if(op===0x53||op===0x55){
      device.tasks[request.id]=request;
      setTimeout(()=>device.ack(request,0,[...u32(request.id),request.slot,(device.mask>>(request.slot-1))&1,0]),5);
    }else if(op===0x54){
      const slot=device.tasks[request.id]?.slot||1,state=(device.mask>>(slot-1))&1;
      setTimeout(()=>{
        device.ack(request,0,[...u32(request.id),slot,state,0]);
        if(device.autoCancel)device.stage(request.id,7,state,6,slot);
      },5);
    }
    return true;
  };
  const nativePromise=Capacitor.nativePromise;
  Capacitor.nativePromise=async function(plugin,method,options={}){
    if(plugin==='SparkBle'&&method==='write'&&device.holdEnter){
      const bytes=Uint8Array.from(atob(options.data),character=>character.charCodeAt(0));
      if(bytes.length===17&&bytes[4]===0xc2&&bytes[6]===1){
        device.blockedEnters++;
        await new Promise(resolve=>device.enterReleases.push(resolve));
      }
    }
    return nativePromise.call(this,plugin,method,options);
  };
}
const idle=page=>page.waitForFunction(()=>!window.CardPageTransition?.busy);
const dialog=page=>page.locator('#xiaobaiLearnedDialog');
const count=(page,op)=>page.evaluate(op=>learnedDevice.count(op),op);
const latest=(page,op)=>page.evaluate(op=>learnedDevice.latest(op),op);
const stage=(page,task,value,state=2,reason=0)=>page.evaluate(args=>learnedDevice.stage(...args),[task,value,state,reason]);
const block=(slot=1)=>({id:'self-learned-wait',params:{slot}});
async function setProgram(page,items){
  await page.evaluate(items=>{closeParamEditor();program=items;renderProgram();},items);
}
async function openEditor(page,index=0){
  if(!await page.locator('#paramEditor.is-learned-command').isVisible())
    await page.locator('#chain [data-card-id="self-learned-wait"] .param-bubble').nth(index).tap();
  await page.locator('.learned-command-editor').waitFor({state:'visible'});
}
async function checkFits(page,viewport){
  await dialog(page).evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  const style=await dialog(page).evaluate(node=>({opacity:getComputedStyle(node).opacity,background:getComputedStyle(node).backgroundColor}));
  assert.equal(style.opacity,'1');assert.equal(style.background,'rgb(255, 255, 255)','modal has an opaque white surface');
  const boxes=await dialog(page).locator('button,input,.learned-dialog-phase').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length).map(node=>({text:node.textContent,...node.getBoundingClientRect().toJSON()})));
  boxes.unshift(await dialog(page).evaluate(node=>({...node.getBoundingClientRect().toJSON()})));
  for(const box of boxes)assert.ok(box.left>=-1&&box.top>=-1&&box.right<=viewport.width+1&&box.bottom<=viewport.height+1,`modal fits ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`);
}
async function checkPopoverFits(page,viewport){
  const box=await page.locator('#paramEditor').boundingBox();
  assert.ok(box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,`learned parameter popover fits after its content grows: ${JSON.stringify(box)}`);
}
async function checkLongMemoScroll(page,viewport){
  await checkPopoverFits(page,viewport);
  const scroll=await page.locator('#paramEditor').evaluate(node=>{
    const panel=node.querySelector('.learned-command-editor'),memo=node.querySelector('.learned-command-memo'),hint=node.querySelector('.learned-command-hint');
    memo.scrollTop=memo.scrollHeight;
    panel.scrollTop=panel.scrollHeight;
    return {memoEnd:memo.scrollTop+memo.clientHeight>=memo.scrollHeight-1,panelEnd:panel.scrollTop+panel.clientHeight>=panel.scrollHeight-1,hint:hint.getBoundingClientRect().toJSON()};
  });
  assert.equal(scroll.memoEnd,true,'long memo text can scroll to its final character');
  assert.equal(scroll.panelEnd,true,'parameter panel can reach its final row');
  assert(scroll.hint.top>=-1&&scroll.hint.bottom<=viewport.height+1,'popover hint remains reachable inside the viewport');
}
async function screenshot(page,name){
  await dialog(page).evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  const folder=path.resolve(__dirname,'../artifacts');
  fs.mkdirSync(folder,{recursive:true});
  await page.screenshot({path:path.join(folder,name)});
}
async function newPage(browser,base,viewport={width:844,height:390},connected=true){
  const context=await browser.newContext({viewport,hasTouch:true});
  await context.addInitScript({content:`(${mockAndroid.toString()})();(${installLearnedDevice.toString()})();localStorage.setItem('cardDefaultModelV1','xiaobai');window.__XIAOBAI_BLE_TIMING={firstScanMs:60,defaultScanMs:100};`});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/#home');
  await page.evaluate(connected=>{mockBle.devices=connected?[{name:'Spark_AI',deviceId:'ROBOT',rssi:-40}]:[];location.hash='editor';},connected);
  await idle(page);
  if(connected){
    await page.waitForFunction(()=>CardBluetooth.connected);
    await page.waitForFunction(()=>learnedDevice.count(0x52)>0&&learnedDevice.count(0x56)>=2);
    await page.waitForFunction(()=>CardBluetooth.remoteConnection()?.learned?.getSnapshot().query==='ready');
  }
  return {context,page,errors};
}
async function learningFlow(browser,base,viewport){
  const {context,page,errors}=await newPage(browser,base,viewport);
  try{
    await page.locator('#tab-dynamic').tap();
    await page.locator('#palette [data-card-id="self-learned-wait"]').tap();
    await openEditor(page);
    await page.waitForFunction(()=>document.querySelector('.learned-command-action')?.textContent.includes('学习'));
    const beforeRefresh=await count(page,0x52);
    await page.evaluate(()=>{learnedDevice.autoQuery=false;CardBluetooth.remoteConnection().learned.refresh().catch(()=>{});});
    await page.waitForFunction(n=>learnedDevice.count(0x52)===n+1,beforeRefresh);
    assert.equal(await page.locator('.learned-command-state').textContent(),'读取中','unknown is not displayed as an empty slot while querying');
    await page.evaluate(()=>{learnedDevice.query(learnedDevice.latest(0x52));learnedDevice.autoQuery=true;});
    await page.waitForFunction(()=>document.querySelector('.learned-command-state')?.textContent==='未学习');
    const initialQueries=await count(page,0x52);
    await page.getByRole('button',{name:'下一个指令',exact:true}).tap();
    assert.equal(await page.evaluate(()=>program[0].params.slot),2,'selection changes the saved block parameter');
    await page.getByRole('button',{name:'上一个指令',exact:true}).tap();
    assert.equal(await count(page,0x52),initialQueries,'slot arrows use the shared ten-slot query cache');
    await page.locator('.learned-command-action').tap();
    await dialog(page).waitFor({state:'visible'});
    await page.waitForFunction(()=>learnedDevice.count(0x53)===1);
    const request=await latest(page,0x53),task=request.id;
    assert.equal(request.slot,1);assert.equal(request.flag,0);assert(task>0);
    await checkFits(page,viewport);
    assert.equal(await dialog(page).getAttribute('data-view'),'learning','request acceptance is not saved');
    assert.equal(await page.locator('#xiaobaiLearnedMemo').isVisible(),false);
    await page.waitForFunction(()=>learnedDevice.latest(0x53).acked);
    assert.equal(await page.locator('.learned-dialog-phase').textContent(),'请跟随小白语音提示','acceptance does not announce recording readiness');
    await stage(page,task,0);
    assert.equal(await page.locator('.learned-dialog-phase').textContent(),'请跟随小白语音提示');
    await stage(page,task,1);
    await page.waitForFunction(()=>document.querySelector('.learned-dialog-phase')?.textContent==='请说第一遍');
    await stage(page,task,2);
    await page.waitForFunction(()=>document.querySelector('.learned-dialog-phase')?.textContent.includes('第一遍已收到'));
    assert.equal(await dialog(page).getAttribute('data-view'),'learning','first valid recording does not open memo');
    await screenshot(page,`xiaobai-learned-learning-${viewport.width}x${viewport.height}.png`);
    await stage(page,task,3);
    assert.equal(await page.locator('.learned-dialog-phase').textContent(),'请再说一遍','stage3 reports the real second recording request, not detected speech');
    await stage(page,task,10);
    await page.waitForFunction(()=>document.querySelector('.learned-dialog-phase')?.textContent==='第二遍需要重试');
    assert.match(await page.locator('#xiaobaiLearnedDescription').textContent(),/等待/,'second retry waits for the next real readiness event');
    await stage(page,task,9);
    await page.waitForFunction(()=>document.querySelector('.learned-dialog-phase')?.textContent==='第一遍需要重新录入');
    assert.match(await page.locator('#xiaobaiLearnedDescription').textContent(),/等待/,'first retry waits for the next real readiness event');
    await stage(page,task,1);await stage(page,task,2);await stage(page,task,3);await stage(page,task,4,1);
    await page.waitForFunction(()=>document.querySelector('#xiaobaiLearnedDialog')?.dataset.view==='memo');
    await checkFits(page,viewport);
    await screenshot(page,`xiaobai-learned-memo-${viewport.width}x${viewport.height}.png`);
    await page.locator('#xiaobaiLearnedMemo').fill('第一次填写');
    await stage(page,task,4,1);
    assert.equal(await page.locator('#xiaobaiLearnedMemo').inputValue(),'第一次填写','duplicate success cannot reset or reopen memo input');
    await page.locator('#xiaobaiLearnedMemo').fill('');
    await dialog(page).getByRole('button',{name:'完成',exact:true}).tap();
    await dialog(page).waitFor({state:'hidden'});
    await stage(page,task,4,1);
    assert.equal(await dialog(page).isVisible(),false,'duplicate success after dismissal stays closed');
    await openEditor(page);
    await checkPopoverFits(page,viewport);
    const learnedCount=await count(page,0x53);
    await page.getByRole('button',{name:'修改指令1备忘',exact:true}).tap();
    await page.locator('#xiaobaiLearnedMemo').fill('启动电机');
    await dialog(page).getByRole('button',{name:'完成',exact:true}).tap();
    assert.equal(await count(page,0x53),learnedCount,'memo-only edit never relearns');
    assert.equal(await page.evaluate(()=>CardBluetooth.remoteConnection().learned.getMemo(1)),'启动电机');
    await openEditor(page);
    await checkPopoverFits(page,viewport);
    await page.getByRole('button',{name:'修改指令1备忘',exact:true}).tap();
    const longMemo='这是一段用于测试长备忘滚动的文字'.repeat(10).slice(0,80);
    await page.locator('#xiaobaiLearnedMemo').fill(longMemo);
    await dialog(page).getByRole('button',{name:'完成',exact:true}).tap();
    await dialog(page).waitFor({state:'hidden'});
    await openEditor(page);
    assert.equal(await page.getByRole('button',{name:'修改指令1备忘',exact:true}).textContent(),longMemo);
    assert.equal(await count(page,0x53),learnedCount,'long memo editing also stays phone-only');
    await checkLongMemoScroll(page,viewport);
    await page.locator('.learned-command-action').tap();
    assert.equal(await dialog(page).getAttribute('data-view'),'confirm');
    assert.match(await dialog(page).textContent(),/所有使用这个指令编号的积木和作品都会使用新口令/);
    assert.equal(await count(page,0x53),learnedCount,'relearning waits for explicit confirmation');
    await dialog(page).getByRole('button',{name:'重新学习',exact:true}).tap();
    await page.waitForFunction(n=>learnedDevice.count(0x53)===n+1,learnedCount);
    const relearn=await latest(page,0x53);
    assert(relearn.id>task);assert.equal(relearn.flag,1);
    await stage(page,relearn.id,5,0,9);
    await dialog(page).getByRole('button',{name:'重试',exact:true}).waitFor({state:'visible'});
    await dialog(page).getByRole('button',{name:'重试',exact:true}).tap();
    await page.waitForFunction(n=>learnedDevice.count(0x53)===n+2,learnedCount);
    const retry=await latest(page,0x53);
    assert(retry.id>relearn.id,'retry gets a fresh persistent task ID');
    await page.evaluate(()=>{learnedDevice.autoCancel=false;});
    await dialog(page).getByRole('button',{name:'取消学习',exact:true}).tap();
    await page.waitForFunction(()=>learnedDevice.count(0x54)>0);
    await page.waitForFunction(()=>learnedDevice.latest(0x54).acked);
    assert.equal((await latest(page,0x54)).id,retry.id);
    assert.equal(await dialog(page).isVisible(),true,'cancel acceptance is not a terminal state');
    assert.match(await dialog(page).locator('.learned-dialog-phase').textContent(),/正在取消/);
    await stage(page,retry.id,7,0,6);
    await dialog(page).waitFor({state:'hidden'});
    await openEditor(page);
    assert.match(await page.locator('.learned-command-action').textContent(),/未学习/,'failed replacement and cancel use actual empty state');
    const beforeRejected=await count(page,0x53);
    await page.locator('.learned-command-action').tap();
    await page.waitForFunction(n=>learnedDevice.count(0x53)===n+1,beforeRejected);
    const rejected=await latest(page,0x53);
    await stage(page,rejected.id,8,0,10);
    await page.waitForFunction(()=>document.querySelector('.learned-dialog-phase')?.textContent==='设备未接受学习');
    const rejectedReason=await page.evaluate(()=>CardBluetooth.remoteConnection().learned.getSnapshot().learning.error);
    assert.match(rejectedReason,/协议|格式/,'protocol reason is preserved by the service');
    assert.equal(await page.locator('#xiaobaiLearnedDescription').textContent(),rejectedReason,'the actual rejection reason is visible below the title');
    assert.equal(await page.locator('#xiaobaiLearnedDescription').isVisible(),true);
    assert.match(await page.locator('#xiaobaiLearnedTitle').textContent(),/学习未完成/);
    assert.equal(await page.locator('#xiaobaiLearnedMemo').isVisible(),false,'rejection never opens the saved memo');
    await dialog(page).getByRole('button',{name:'返回',exact:true}).tap();
    await dialog(page).waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function executionFlow(browser,base){
  const {context,page,errors}=await newPage(browser,base);
  try{
    await setProgram(page,[{id:'display-off',params:{}},block(2)]);
    await page.locator('#runProgramBtn').tap();
    await page.waitForFunction(()=>!CardProgram.running);
    assert.match(await page.locator('#executionNotice').textContent(),/指令2.*未学习|未学习.*指令2/);
    assert.equal(await count(page,0x55),0);assert.equal(await count(page,0x57),0,'unlearned preflight sends no running declaration');
    assert.equal(await page.locator('#chain [data-node-path="1"].is-executing').count(),1,'preflight identifies the offending block');
    await page.evaluate(async()=>{learnedDevice.mask=1;await CardBluetooth.remoteConnection().learned.refresh();});
    await setProgram(page,[block(1),block(1)]);
    await page.locator('#runProgramBtn').tap();
    await page.waitForFunction(()=>learnedDevice.count(0x55)===1);
    const first=await latest(page,0x55);
    const declarations=await page.evaluate(()=>learnedDevice.requests.filter(request=>request.op===0x57));
    assert.equal(declarations.length,1);assert.equal(declarations[0].bytes[11],1,'program claims mutual exclusion before waiting');
    await page.evaluate(task=>learnedDevice.hit(task,1),first.id);
    assert.equal(await count(page,0x55),1,'hit before ready cannot advance');
    await stage(page,first.id,11,1);
    await page.evaluate(task=>learnedDevice.hit(task,2),first.id);
    assert.equal(await count(page,0x55),1,'another slot cannot advance');
    await page.evaluate(task=>learnedDevice.hit(task,1),first.id);
    await page.waitForFunction(()=>learnedDevice.count(0x55)===2);
    const second=await latest(page,0x55);
    assert(second.id>first.id,'consecutive same-slot waits require a fresh task');
    await stage(page,second.id,11,1);
    await page.evaluate(task=>{learnedDevice.hit(task,1);learnedDevice.hit(task,1);},first.id);
    assert.equal(await page.evaluate(()=>CardProgram.running),true,'duplicate stale hits cannot finish the next block');
    await page.evaluate(task=>learnedDevice.hit(task,1),second.id);
    await page.waitForFunction(()=>!CardProgram.running);
    const endings=await page.evaluate(()=>learnedDevice.requests.filter(request=>request.op===0x57&&request.bytes[11]===0));
    assert.equal(endings.length,1);assert.equal(endings[0].id,declarations[0].id);
    const writes=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').map(call=>Array.from(atob(call.data),c=>c.charCodeAt(0))).filter(bytes=>bytes[4]===0xc2&&bytes[6]>=0x52&&bytes[6]<=0x57));
    for(const bytes of writes){
      assert.equal(bytes.length,17);assert.equal(bytes[15],bytes.slice(0,15).reduce((sum,value)=>sum+value,0)&255);
      assert(bytes[5]>0,'new opcodes use action sequence numbers');
    }
    await setProgram(page,[block(1)]);
    await page.locator('#runProgramBtn').tap();
    await page.waitForFunction(()=>learnedDevice.count(0x55)===3);
    await page.locator('#pauseProgramBtn').tap();
    await page.waitForFunction(()=>!CardProgram.running);
    const stopped=await latest(page,0x55);
    await stage(page,stopped.id,11,1);await page.evaluate(task=>learnedDevice.hit(task,1),stopped.id);
    assert.equal(await page.evaluate(()=>CardProgram.running),false,'stop never becomes a normal hit or resume');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function offlineAndIsolation(browser,base){
  const {context,page,errors}=await newPage(browser,base,{width:844,height:390},false);
  try{
    await setProgram(page,[block(1)]);await openEditor(page);
    await page.getByRole('button',{name:'下一个指令',exact:true}).tap();
    assert.equal(await page.evaluate(()=>program[0].params.slot),2,'offline program editing remains available');
    const action=page.locator('.learned-command-action');
    if(await action.isEnabled())await action.tap();
    assert.equal(await count(page,0x53),0,'offline learning sends nothing');
    await page.evaluate(()=>closeParamEditor());
    await page.locator('#runProgramBtn').tap();
    await page.waitForFunction(()=>location.hash==='#bluetooth'||!CardProgram.running);
    assert.equal(await count(page,0x55),0);assert.equal(await count(page,0x57),0,'offline execution sends nothing');
    const isolation=await page.evaluate(()=>CardModels.list().map(model=>({id:model.id,has:Object.values(model.catalog).some(group=>group.cards.some(card=>card.id==='self-learned-wait'))})));
    assert(isolation.find(model=>model.id==='xiaobai').has);
    assert(isolation.filter(model=>model.id!=='xiaobai').every(model=>!model.has),'only Xiaobai exposes the new block');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function reconnectAndMemoIdentity(browser,base){
  const {context,page,errors}=await newPage(browser,base);
  try{
    const originalUid='102030405060708090a0b0c0';
    await page.evaluate(async()=>{
      learnedDevice.mask=1;
      await CardBluetooth.remoteConnection().learned.refresh();
      CardBluetooth.remoteConnection().learned.setMemo(1,'原设备备忘');
    });
    await setProgram(page,[block(1)]);
    await page.locator('#runProgramBtn').tap();
    await page.waitForFunction(()=>learnedDevice.count(0x55)===1);
    const oldTask=await latest(page,0x55);
    const oldConnection=await page.evaluate(()=>mockBle.connectionId);
    await page.evaluate(()=>{
      const connectionId=mockBle.connectionId;
      mockBle.connectionId=null;mockBle.subscribed=false;
      mockBle.emit('disconnected',{connectionId,reason:'测试设备断连'});
    });
    await page.waitForFunction(()=>!CardBluetooth.connected&&!CardProgram.running);
    const beforeQuery=await count(page,0x52),beforeUid=await count(page,0x56);
    await page.evaluate(()=>CardBluetooth.ensureConnected());
    await page.waitForFunction(()=>CardBluetooth.connected&&CardBluetooth.remoteConnection()?.learned?.getSnapshot().query==='ready');
    assert.equal(await count(page,0x52),beforeQuery+1,'reconnect refreshes all ten actual slot states');
    assert.equal(await count(page,0x56),beforeUid+2,'reconnect rereads stable device identity');
    assert.equal(await count(page,0x55),1,'reconnect never reissues an old wait task');
    assert.equal(await page.evaluate(()=>CardBluetooth.remoteConnection().learned.getMemo(1)),'原设备备忘');
    await stage(page,oldTask.id,11,1);
    await page.evaluate(args=>{
      const [task,connectionId]=args;
      learnedDevice.hit(task,1);
      const bytes=[0x5a,0x98,0x97,10,0xd3,9,99,task&255,(task>>>8)&255,(task>>>16)&255,(task>>>24)&255,1,0,0,0];
      bytes.push(bytes.reduce((sum,value)=>sum+value,0)&255,0xa5);
      mockBle.feed(String.fromCharCode(...bytes),connectionId);
    },[oldTask.id,oldConnection]);
    assert.equal(await page.evaluate(()=>CardProgram.running),false,'stale notifications from either connection cannot resume');
    // A second physical controller can reuse a scan display name/address in the
    // test; only its stable UID determines memo and task allocation identity.
    await page.evaluate(async()=>{await CardBluetooth.disconnect();learnedDevice.uid=Array(12).fill(0xab);await CardBluetooth.ensureConnected();});
    await page.waitForFunction(()=>CardBluetooth.connected&&CardBluetooth.remoteConnection()?.learned?.getSnapshot().query==='ready');
    assert.equal(await page.evaluate(()=>CardBluetooth.remoteConnection().learned.getMemo(1)),'','different device has an independent memo');
    await openEditor(page);
    assert.equal(await page.getByRole('button',{name:'修改指令1备忘',exact:true}).textContent(),'指令1','empty memo falls back to slot label');
    await page.getByRole('button',{name:'修改指令1备忘',exact:true}).tap();
    await page.locator('#xiaobaiLearnedMemo').fill('第二设备备忘');
    await dialog(page).getByRole('button',{name:'完成',exact:true}).tap();
    assert.equal(await page.evaluate(uid=>localStorage.getItem(`xiaobai:${uid}:1`),originalUid),'原设备备忘');
    await page.evaluate(async()=>{
      closeParamEditor();await CardBluetooth.disconnect();
      learnedDevice.uid=[0x10,0x20,0x30,0x40,0x50,0x60,0x70,0x80,0x90,0xa0,0xb0,0xc0];
      await CardBluetooth.ensureConnected();
    });
    await page.waitForFunction(()=>CardBluetooth.connected&&CardBluetooth.remoteConnection()?.learned?.getSnapshot().query==='ready');
    assert.equal(await page.evaluate(()=>CardBluetooth.remoteConnection().learned.getMemo(1)),'原设备备忘','returning to original controller restores only its memo');
    await page.locator('#runProgramBtn').tap();
    await page.waitForFunction(()=>learnedDevice.count(0x55)===2);
    assert((await latest(page,0x55)).id>oldTask.id,'a new run after reconnect allocates a new wait ID');
    await page.locator('#pauseProgramBtn').tap();
    await page.waitForFunction(()=>!CardProgram.running);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function delayedModeEntry(browser,base){
  const {context,page,errors}=await newPage(browser,base);
  try{
    await page.evaluate(()=>{location.hash='home';});
    await idle(page);
    await page.waitForFunction(()=>!CardBluetooth.remoteConnection().learned.link.heartbeatTimer);
    await page.evaluate(()=>{learnedDevice.holdEnter=true;location.hash='editor';});
    await page.waitForFunction(()=>learnedDevice.blockedEnters===1);
    await page.evaluate(()=>{location.hash='home';});
    await idle(page);
    const queryBefore=await count(page,0x52);
    const heartbeatBefore=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write'&&atob(call.data).charCodeAt(4)===0xc2&&atob(call.data).charCodeAt(6)===3).length);
    await page.evaluate(()=>learnedDevice.releaseEnter());
    // Two heartbeat periods prove that completion of an abandoned native write
    // cannot restart the old editor's heartbeat or initialize a stale query.
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(()=>Boolean(CardBluetooth.remoteConnection().learned.link.heartbeatTimer)),false,'leaving during ENTER_PROGRAM does not resurrect heartbeat');
    assert.equal(await count(page,0x52),queryBefore,'leaving during ENTER_PROGRAM cannot issue a later learned-state query');
    assert.equal(await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write'&&atob(call.data).charCodeAt(4)===0xc2&&atob(call.data).charCodeAt(6)===3).length),heartbeatBefore);

    await page.evaluate(()=>{learnedDevice.holdEnter=true;location.hash='editor';});
    await page.waitForFunction(()=>learnedDevice.blockedEnters===2);
    // Cross two real hashchange tasks before the old native write resolves.
    await page.evaluate(()=>{location.hash='home';});
    await page.waitForFunction(()=>location.hash==='#home');
    await page.evaluate(()=>{location.hash='editor';});
    await page.waitForFunction(()=>location.hash==='#editor');
    await page.evaluate(()=>learnedDevice.releaseEnter());
    await page.waitForFunction(()=>{
      const service=CardBluetooth.remoteConnection()?.learned;
      return location.hash==='#editor'&&service?.link.mode===4&&service.link.heartbeatTimer&&service.getSnapshot().query==='ready';
    });
    await idle(page);
    const resumedAt=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write'&&atob(call.data).charCodeAt(4)===0xc2&&atob(call.data).charCodeAt(6)===3).length);
    await page.waitForFunction(n=>mockBle.calls.filter(call=>call.method==='write'&&atob(call.data).charCodeAt(4)===0xc2&&atob(call.data).charCodeAt(6)===3).length>n,resumedAt);
    assert.equal(await page.evaluate(()=>CardProgram.running),false,'returning to editor restores the session, not an old program');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const viewport of [{width:844,height:390},{width:667,height:375}])await learningFlow(browser,base,viewport);
    await executionFlow(browser,base);await offlineAndIsolation(browser,base);await reconnectAndMemoIdentity(browser,base);await delayedModeEntry(browser,base);
    console.log('PASS learned command native BLE UI, real-event progress, memo/relearn/cancel/retry, preflight, task-matched ready/hits, reconnect/no-resume/UID isolation, delayed mode-entry races and two landscape sizes.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
