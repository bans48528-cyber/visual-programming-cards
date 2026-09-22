const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const mockAndroid=require('./mock-android.cjs');
const BASE='http://127.0.0.1:4173/dist/';
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:892,height:412},hasTouch:true});
    await context.addInitScript(()=>{window.__XIAOBAI_BLE_TIMING={firstScanMs:80,defaultScanMs:180};});
    await context.addInitScript(mockAndroid);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${BASE}#home`);
    await page.evaluate(()=>{mockBle.devices=[{name:'Spark_AI',deviceId:'ROBOT',rssi:-40}];location.hash='editor';});
    await page.waitForFunction(()=>CardBluetooth.connected);
    await page.waitForFunction(()=>mockBle.calls.some(call=>call.method==='write'&&atob(call.data).charCodeAt(6)===1));
    const initial=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').map(call=>Array.from(atob(call.data),c=>c.charCodeAt(0))));
    assert.deepEqual(initial.slice(0,2).map(frame=>frame[6]),[4,1],'probe then enter programming');
    await page.evaluate(()=>{program=[{id:'motor-forward',params:{port:'L/M1',duration:.1}},{id:'infrared-wait',params:{comparison:'greater',threshold:30}},{id:'display-off',params:{}}];document.getElementById('runProgramBtn').click();});
    await page.waitForFunction(()=>!document.getElementById('runProgramBtn').disabled);
    const actions=await page.evaluate(()=>mockBle.calls.filter(call=>call.method==='write').map(call=>Array.from(atob(call.data),c=>c.charCodeAt(0))).filter(frame=>frame[4]===0xc2&&frame[5]));
    assert.deepEqual(actions.map(frame=>frame[6]),[0x10,0x30,0x42]);
    assert.deepEqual(actions[1].slice(7,10),[1,0,30],'IR uses middle channel');
    await page.evaluate(()=>CardRemote.open());await page.waitForFunction(()=>mockBle.calls.some(call=>call.method==='write'&&atob(call.data).charCodeAt(6)===2));
    await page.locator('[data-remote-key=Y]').click();
    await page.waitForFunction(()=>mockBle.calls.some(call=>call.method==='write'&&atob(call.data).charCodeAt(4)===0xc1&&atob(call.data).charCodeAt(9)===1));
    await page.locator('.remote-back').click();
    await page.waitForFunction(()=>mockBle.calls.filter(call=>call.method==='write'&&atob(call.data).charCodeAt(6)===1).length>=2);
    await page.evaluate(()=>{program=[{id:'wait-time',params:{duration:30}}];document.getElementById('runProgramBtn').click();});
    await page.waitForFunction(()=>document.body.classList.contains('program-running'));
    await page.evaluate(()=>{
      const frame=[0x5a,0x98,0x97,10,0xd3,2,1,3,...Array(7).fill(0)];
      frame.push(frame.reduce((sum,value)=>sum+value,0)&255,0xa5);
      mockBle.feed(String.fromCharCode(...frame));
    });
    await page.waitForFunction(()=>!document.body.classList.contains('program-running'));
    assert.deepEqual(errors,[]);await context.close();
    console.log('PASS Android app C2 entry, block execution, middle IR, C1 remote and device abort.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
