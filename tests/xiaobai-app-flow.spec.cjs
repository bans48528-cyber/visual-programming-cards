const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const mockAndroid=require('./mock-android.cjs');
const BASE='http://127.0.0.1:4173/dist/';
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:892,height:412},hasTouch:true});
    // Match the connected M5's WebView 92 feature gap before loading production scripts.
    await context.addInitScript(()=>{Object.hasOwn=undefined;localStorage.setItem('cardDefaultModelV1','xiaobai');});
    await context.addInitScript(()=>{window.__XIAOBAI_BLE_TIMING={firstScanMs:80,defaultScanMs:180};});
    await context.addInitScript(mockAndroid);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${BASE}#home`);
    assert.equal(await page.evaluate(()=>typeof Object.hasOwn),'undefined','the real editor flow runs without Object.hasOwn');
    await page.evaluate(()=>{mockBle.devices=[{name:'Spark_AI',deviceId:'ROBOT',rssi:-40}];location.hash='editor';});
    await page.waitForFunction(()=>CardBluetooth.connected&&!CardPageTransition.busy);
    await page.waitForFunction(()=>mockBle.calls.some(call=>call.method==='write'&&atob(call.data).charCodeAt(6)===1));
    await page.waitForFunction(()=>CardBluetooth.firmware.snapshot().ready&&!document.getElementById('runProgramBtn').disabled);
    const initial=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').map(call=>Array.from(atob(call.data),c=>c.charCodeAt(0))));
    assert.deepEqual(initial.slice(0,2).map(frame=>frame[6]),[4,1],'probe then enter programming');
    await page.evaluate(()=>{program=[{id:'motor-forward',params:{port:'L/M1',duration:.1}},{id:'infrared-wait',params:{comparison:'greater',threshold:30}},{id:'display-off',params:{}}];renderProgram();});
    await page.getByRole('button',{name:'程序开始，运行程序',exact:true}).tap();
    await page.waitForFunction(()=>!document.getElementById('runProgramBtn').disabled);
    const actions=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').map(call=>Array.from(atob(call.data),c=>c.charCodeAt(0))).filter(frame=>frame[4]===0xc2&&frame[5]&&frame[6]>=0x10&&frame[6]<0x52));
    assert.deepEqual(actions.map(frame=>frame[6]),[0x10,0x30,0x42]);
    assert.deepEqual(actions[1].slice(7,10),[1,0,30],'IR keeps compatibility selector 1 for the single PA1 sensor');
    await page.evaluate(()=>{
      const left=Array(64).fill(0),right=Array(64).fill(0);left[1]=1;right[55]=1;
      program=[{id:'eye-matrix',params:{leftPattern:left,rightPattern:right}}];renderProgram();
    });
    await page.getByRole('button',{name:'程序开始，运行程序',exact:true}).tap();
    await page.waitForFunction(()=>!document.getElementById('runProgramBtn').disabled);
    const matrix=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').map(call=>Array.from(atob(call.data),c=>c.charCodeAt(0))).filter(frame=>frame[6]===0x43));
    assert.deepEqual(matrix.map(frame=>frame.slice(7,15)),[[1,0,0,1,0,0,0,0],[1,1,0,0,0,0,0,0],[1,2,0,0,0,64,0,0]],'edited eyes reach all three native BLE writes');
    await page.evaluate(()=>CardRemote.open());await page.waitForFunction(()=>mockBle.calls.some(call=>call.method==='write'&&atob(call.data).charCodeAt(6)===2));
    await page.locator('[data-remote-key=Y]').click();
    await page.waitForFunction(()=>mockBle.calls.some(call=>call.method==='write'&&atob(call.data).charCodeAt(4)===0xc1&&atob(call.data).charCodeAt(9)===1));
    await page.locator('#remoteControl .remote-back').click();
    await page.waitForFunction(()=>mockBle.calls.filter(call=>call.method==='write'&&atob(call.data).charCodeAt(6)===1).length>=2);
    await page.evaluate(()=>{program=[{id:'wait-time',params:{duration:30}}];renderProgram();});
    const startBox=await page.locator('#startBlock').boundingBox();
    await page.mouse.move(startBox.x+20,startBox.y+25);await page.mouse.down();
    await page.mouse.move(startBox.x+45,startBox.y+25,{steps:4});await page.mouse.up();
    assert.equal(await page.evaluate(()=>CardProgram.running),false,'sliding on start does not run');
    await page.locator('#startBlock').tap();
    await page.waitForFunction(()=>document.body.classList.contains('program-running'));
    const writes=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').length);
    await page.locator('#startBlock').tap();
    assert.equal(await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').length),writes,'repeated start taps respect the run button disabled state');
    await page.evaluate(()=>{
      const frame=[0x5a,0x98,0x97,10,0xd3,2,1,3,...Array(7).fill(0)];
      frame.push(frame.reduce((sum,value)=>sum+value,0)&255,0xa5);
      mockBle.feed(String.fromCharCode(...frame));
    });
    await page.waitForFunction(()=>!document.body.classList.contains('program-running'));
    // The keyboard shares the real blocking tilt execution path.
    await page.evaluate(()=>{
      mockBle.deferTilt=true;
      program=[{id:'tilt-wait',params:{direction:'forward'}},{id:'display-off',params:{}}];renderProgram();
    });
    const beforeTilt=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').length);
    await page.locator('#startBlock').press('Enter');
    await page.waitForFunction(()=>mockBle.calls.some(call=>call.method==='write'&&atob(call.data).charCodeAt(6)===0x32));
    const tiltFrame=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').map(call=>Array.from(atob(call.data),c=>c.charCodeAt(0))).find(frame=>frame[6]===0x32));
    assert.deepEqual(tiltFrame.slice(7,15),[2,0,0,0,0,0,0,0]);
    assert.equal(await page.evaluate(()=>CardProgram.running),true);
    assert.equal(await page.evaluate(start=>mockBle.calls.filter(call=>call.method==='write').slice(start).some(call=>atob(call.data).charCodeAt(6)===0x42),beforeTilt),false);
    await page.evaluate(seq=>{
      const packet=[0x5a,0x98,0x97,10,0xd2,seq,0x32,0,...Array(7).fill(0)];
      packet.push(packet.reduce((sum,value)=>sum+value,0)&255,0xa5);mockBle.feed(String.fromCharCode(...packet));mockBle.deferTilt=false;
    },tiltFrame[5]);
    await page.waitForFunction(()=>!CardProgram.running);
    // Invalid imported parameters are still rejected before any hardware action.
    // Keyboard activation also shares the offline connection route.
    await page.evaluate(()=>{program=[{id:'tilt-wait',params:{direction:'sideways'}}];renderProgram();});
    await page.locator('#startBlock').press('Enter');
    assert.match(await page.locator('#executionNotice').textContent(),/倾倒方向无效/);
    await page.evaluate(()=>{CardBluetooth.remoteConnection=()=>null;program=[{id:'wait-time',params:{duration:1}}];renderProgram();});
    await page.locator('#startBlock').press('Space');
    await page.waitForFunction(()=>location.hash==='#bluetooth');
    assert.deepEqual(errors,[]);await context.close();
    console.log('PASS WebView 92 feature gap / Android app C2 entry, start-block tap/keyboard, repeat and slide guards, real tilt DONE, validation/offline routing, single IR, C1 remote and device abort.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
