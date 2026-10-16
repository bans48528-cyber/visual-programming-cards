const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const mockAndroid=require('./mock-android.cjs');
const BASE='http://127.0.0.1:4173/dist/';
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:892,height:412},hasTouch:true});
      await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
    await context.addInitScript(()=>{window.__XIAOBAI_BLE_TIMING={firstScanMs:80,defaultScanMs:180};});
    await context.addInitScript(mockAndroid);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${BASE}#home`);
    await page.evaluate(()=>{mockBle.devices=[{name:'Spark_AI',deviceId:'ROBOT',rssi:-40}];location.hash='editor';});
    await page.waitForFunction(()=>CardBluetooth.connected&&!CardPageTransition.busy);
    await page.waitForFunction(()=>mockBle.calls.some(call=>call.method==='write'&&atob(call.data).charCodeAt(6)===1));
    const initial=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').map(call=>Array.from(atob(call.data),c=>c.charCodeAt(0))));
    assert.deepEqual(initial.slice(0,2).map(frame=>frame[6]),[4,1],'probe then enter programming');
    await page.evaluate(()=>{program=[{id:'motor-forward',params:{port:'L/M1',duration:.1}},{id:'infrared-wait',params:{comparison:'greater',threshold:30}},{id:'display-off',params:{}}];renderProgram();});
    await page.getByRole('button',{name:'程序开始，运行程序',exact:true}).tap();
    await page.waitForFunction(()=>!document.getElementById('runProgramBtn').disabled);
    const actions=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').map(call=>Array.from(atob(call.data),c=>c.charCodeAt(0))).filter(frame=>frame[4]===0xc2&&frame[5]));
    assert.deepEqual(actions.map(frame=>frame[6]),[0x10,0x30,0x42]);
    assert.deepEqual(actions[1].slice(7,10),[1,0,30],'IR uses middle channel');
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
    // Keyboard activation shares validation and the offline connection route.
    await page.evaluate(()=>{program=[{id:'tilt-wait',params:{direction:'forward'}}];renderProgram();});
    await page.locator('#startBlock').press('Enter');
    assert.match(await page.locator('#executionNotice').textContent(),/尚未提供.*通信协议/);
    await page.evaluate(()=>{CardBluetooth.remoteConnection=()=>null;program=[{id:'wait-time',params:{duration:1}}];renderProgram();});
    await page.locator('#startBlock').press('Space');
    await page.waitForFunction(()=>location.hash==='#bluetooth');
    assert.deepEqual(errors,[]);await context.close();
    console.log('PASS Android app C2 entry, start-block tap/keyboard, repeat and slide guards, validation/offline routing, middle IR, C1 remote and device abort.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
