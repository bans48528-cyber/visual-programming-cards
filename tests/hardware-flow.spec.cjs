const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    for(const [width,height] of [[1280,800],[844,390],[390,844]]) {
      const page=await browser.newPage({viewport:{width,height}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      page.on('dialog',dialog=>{errors.push(`Unexpected dialog: ${dialog.message()}`);void dialog.dismiss();});
      await page.addInitScript(()=>{
        const device=new EventTarget();device.id='mock-spark';device.name='Spark_AI';
        const characteristic=new EventTarget();window.testWrites=[];window.testAck=true;window.testFailDiscovery=false;
        window.testStopReport=true;window.testStopReportDelay=30;window.stopTimes=[];window.stopReportAt=0;
        window.testUploadReport=null;
        window.reportState=state=>{
          const b=new TextEncoder().encode(JSON.stringify({WillAiState:state})+'\r\n');
          characteristic.value=new DataView(b.buffer);characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
        };
        window.floodTelemetry=()=>{
          const bytes=new TextEncoder().encode('{"WillAiState":"stop"}\r\n');
          for(let i=0;i<150;i++) {
            characteristic.value=new DataView(bytes.buffer);
            characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
          }
        };
        characteristic.properties={notify:true,write:true,writeWithoutResponse:true};
        characteristic.startNotifications=async()=>characteristic;
        characteristic.writeValueWithoutResponse=async bytes=>{
          window.testWrites.push(Array.from(bytes));
          if(bytes[4]===0xd0 && window.testUploadReport) window.reportState(window.testUploadReport);
          if(bytes[4]===0xb9) {
            window.stopTimes.push(performance.now());
            if(window.testStopReport || window.stopTimes.length===window.stopReportAt) setTimeout(()=>window.reportState('stop'),window.testStopReportDelay);
          }
          if(window.testAck && [0xda,0xaa,0xbb,0xbc].includes(bytes[4])) queueMicrotask(()=>{
            const b=window.SparkProtocol.frame(1);
            characteristic.value=new DataView(b.buffer);characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
          });
        };
        characteristic.writeValueWithResponse=characteristic.writeValueWithoutResponse;
        const service={getCharacteristic:async uuid=>{
          if(uuid!=='0000fff1-0000-1000-8000-00805f9b34fb')throw Error('bad characteristic');return characteristic;
        }};
        device.gatt={connected:false,async connect(){this.connected=true;return this;},
          async getPrimaryService(uuid){if(window.testFailDiscovery)throw Error('FFF0 unavailable');if(uuid!=='0000fff0-0000-1000-8000-00805f9b34fb')throw Error('bad service');return service;},
          disconnect(){this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
        characteristic.service={device};
        window.disconnectTestDevice=()=>device.gatt.disconnect();
        Object.defineProperty(navigator,'bluetooth',{value:{getDevices:async()=>[],requestDevice:async()=>device}});
      });
      await page.goto('http://127.0.0.1:4173/#editor');
      await page.evaluate(()=>Object.values(categories).forEach(category=>category.cards.forEach(card=>addCard(card.id))));
      await page.locator('#runProgramBtn').click();
      await page.locator('.bt-search').waitFor({state:'visible'});
      await page.evaluate(()=>window.testFailDiscovery=true);
      await page.locator('.bt-search').click();
      await page.waitForFunction(()=>document.querySelector('.bt-message').textContent.includes('FFF0 unavailable'));
      assert.equal(await page.evaluate(()=>CardBluetooth.connected),false);
      await page.evaluate(()=>window.testFailDiscovery=false);
      await page.locator('.bt-search').click();
      await page.waitForFunction(()=>CardBluetooth.connected);
      await page.locator('.bt-back').click();
      let compileCount=0;
      page.on('request',req=>{if(req.url().includes(':4180/compile'))compileCount++;});
      if(width===1280) {
        const beforeWaitingRun=await page.evaluate(()=>testWrites.length);
        const waitingRunStarted=Date.now();
        const waitingCompile=page.waitForRequest('http://127.0.0.1:4180/compile');
        await page.locator('#runProgramBtn').click();
        await waitingCompile;
        assert.ok(Date.now()-waitingRunStarted>=450);
        await page.waitForFunction(()=>document.querySelector('#executionNotice').textContent.includes('程序已发送'),{},{timeout:25000});
        const waitingRunWrites=await page.evaluate(n=>testWrites.slice(n),beforeWaitingRun);
        assert.equal(waitingRunWrites[0][4],0xd0);
        assert.equal(waitingRunWrites.filter(b=>b[4]===0xb9).length,0);
        assert.ok(waitingRunWrites.some(b=>b[4]===0xda));
        await page.evaluate(()=>{testStopReport=false;reportState('run');});
        const beforeUpload=await page.evaluate(()=>testWrites.length);
        const beforeCompile=compileCount;
        await page.locator('#runProgramBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runProgramBtn').disabled,{},{timeout:7000});
        assert.deepEqual(await page.evaluate(n=>testWrites.slice(n).map(b=>b[4]),beforeUpload),Array(5).fill(0xb9));
        assert.equal(compileCount,beforeCompile);
        assert.match(await page.locator('#executionNotice').textContent(),/等待设备停止超时.*使用软件或硬件暂停程序/);
      }
      await page.route('http://127.0.0.1:4180/compile',async route=>{await page.evaluate(()=>reportState('run'));await route.continue();});
      await page.evaluate(()=>reportState('stop'));
      await page.locator('#runProgramBtn').click();
      await page.waitForFunction(()=>!document.querySelector('#runProgramBtn').disabled);
      assert.match(await page.locator('#executionNotice').textContent(),/未发送程序/);
      await page.unroute('http://127.0.0.1:4180/compile');
      await page.evaluate(()=>reportState('stop'));
      const beforeSuccessful=await page.evaluate(()=>testWrites.length);
      await page.locator('#runProgramBtn').click();
      await page.waitForFunction(()=>document.querySelector('#executionNotice').textContent.includes('程序已发送'),{},{timeout:25000});
      const writes=await page.evaluate(n=>testWrites.slice(n),beforeSuccessful);
      assert.equal(writes[0][4],0xda);
      assert.ok(writes.every(b=>b[4]!==0xba));
      assert.equal(writes.at(-2)[4],0xbc);
      const bytecode=writes.filter(b=>[0xaa,0xbc].includes(b[4])).flatMap(b=>b.slice(5,-2));
      assert.deepEqual(bytecode.slice(0,4),[0x0f,0x70,0x79,0x6f]);
      await page.evaluate(()=>{testStopReport=false;testStopReportDelay=700;stopReportAt=5;stopTimes=[];reportState('run');});
      const beforePreflight=await page.evaluate(()=>testWrites.length);
      const preflightCompile=page.waitForRequest('http://127.0.0.1:4180/compile');
      await page.locator('#runProgramBtn').click();
      await preflightCompile;
      await page.waitForFunction(()=>document.querySelector('#executionNotice').textContent.includes('程序已发送'),{},{timeout:25000});
      const preflightWrites=await page.evaluate(n=>testWrites.slice(n),beforePreflight);
      assert.equal(preflightWrites[0][4],0xb9);
      assert.equal(preflightWrites.filter(b=>b[4]===0xb9).length,5);
      assert.ok(preflightWrites.some(b=>b[4]===0xda));
      assert.equal(preflightWrites.at(-2)[4],0xbc);
      await page.evaluate(()=>{stopReportAt=0;testStopReportDelay=30;});
      for(const state of ['run','stop',null]) {
        await page.evaluate(async state=>{
          testUploadReport=state;reportState('stop');
          await CardBluetooth.runProgram(program);
          testUploadReport=null;
        },state);
        assert.match(await page.locator('#executionNotice').textContent(),/程序已发送/);
        assert.equal(await page.locator('#deviceStatus').getAttribute('data-state'),state || 'waiting');
        assert.deepEqual(await page.evaluate(()=>testWrites.slice(-2).map(b=>b[4])),[0xbc,0xd0]);
      }
      await page.evaluate(()=>testStopReport=false);
      for(const state of [null,'run','stop','unknown','stale']) {
        if(state) await page.evaluate(s=>reportState(s==='stale'?'run':s),state);
        if(state==='stale') await page.waitForTimeout(2100);
        const beforeStop=await page.evaluate(()=>testWrites.length);
        await page.evaluate(()=>stopTimes=[]);
        await page.locator('#pauseProgramBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runProgramBtn').disabled);
        await page.waitForTimeout(1100);
        const expected=state==='stop' ? [] : state===null || state==='unknown' ? [0xd0,0xb9] : Array(5).fill(0xb9);
        assert.deepEqual(await page.evaluate(n=>testWrites.slice(n).map(b=>b[4]),beforeStop),expected);
        const times=await page.evaluate(()=>stopTimes);
        if(expected.length===5) for(let i=1;i<times.length;i++) assert.ok(times[i]-times[i-1]>=75);
        if(state==='stop') assert.match(await page.locator('#executionNotice').textContent(),/设备已停止，未发送暂停指令/);
      }
      await page.evaluate(async()=>{stopTimes=[];await Promise.all([CardBluetooth.stopProgram(),CardBluetooth.stopProgram()]);});
      assert.equal(await page.evaluate(()=>stopTimes.length),2);
      assert.match(await page.locator('#executionNotice').textContent(),/间隔0.2秒后发送一次暂停请求（B9）/);
      await page.evaluate(()=>testStopReport=true);
      await page.evaluate(()=>reportState('run'));
      await page.locator('#pauseProgramBtn').click();
      await page.waitForFunction(()=>!document.querySelector('#runProgramBtn').disabled);
      await page.waitForTimeout(50);
      await page.waitForFunction(()=>document.querySelector('#executionNotice').textContent.includes('B9'));
      assert.equal(await page.evaluate(()=>testWrites.at(-1)[4]),0xb9);
      assert.match(await page.locator('#executionNotice').textContent(),/已连续发送5次暂停请求（B9）/);
      assert.match(await page.locator('#executionNotice').textContent(),/间隔0.08秒/);
      await page.evaluate(()=>program.push({id:'unknown-card'}));
      await page.evaluate(()=>reportState('stop'));
      const before=await page.evaluate(()=>testWrites.length);
      await page.locator('#runProgramBtn').click();
      await page.waitForFunction(()=>document.querySelector('#executionNotice').textContent.includes('暂不支持'));
      assert.deepEqual(await page.evaluate(n=>testWrites.slice(n).map(b=>b[4]),before),[]);
      await page.evaluate(()=>{program.pop();renderProgram();testAck=false;});
      await page.locator('#runProgramBtn').click();
      await page.waitForFunction(()=>testWrites.length>0 && testWrites.at(-1)[4]===0xda);
      const cancelWrites=await page.evaluate(()=>testWrites.length);
      await page.locator('#pauseProgramBtn').click();
      await page.waitForFunction(()=>!document.querySelector('#runProgramBtn').disabled);
      await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate(n=>testWrites.slice(n).map(b=>b[4]),cancelWrites),[0xd0,0xb9]);
      await page.route('http://127.0.0.1:4180/compile',async route=>{
        await new Promise(resolve=>setTimeout(resolve,350));await route.continue();
      });
      const compiling=page.waitForRequest('http://127.0.0.1:4180/compile');
      await page.evaluate(()=>reportState('stop'));
      const preCompile=await page.evaluate(()=>testWrites.length);
      await page.locator('#runProgramBtn').click();await compiling;
      await page.locator('#pauseProgramBtn').click();
      await page.waitForFunction(()=>!document.querySelector('#runProgramBtn').disabled);
      await page.waitForTimeout(450);
      assert.deepEqual(await page.evaluate(n=>testWrites.slice(n).map(b=>b[4]),preCompile),[]);
      assert.match(await page.locator('#executionNotice').textContent(),/设备已停止，未发送暂停指令/);
      if(width===1280) {
        const beforeFlood=await page.evaluate(()=>testWrites.length);
        await page.evaluate(()=>{
          reportState('run');reportState('stop');
          for(let i=0;i<10;i++) floodTelemetry();
          location.hash='bluetooth';
        });
        await page.locator('.bt-diagnostics summary').click();
        const downloaded=page.waitForEvent('download');
        await page.locator('.bt-export').click();
        const download=await downloaded;
        const log=fs.readFileSync(await download.path(),'utf8');
        assert.match(log,/Spark BLE diagnostics v2/);
        assert.match(log,/STOP_REQUEST connected=true/);
        assert.match(log,/STOP_WRITE_RESULT sent=true/);
        assert.match(log,/STATUS WillAiState=run/);
        assert.match(log,/STATUS WillAiState=stop/);
        assert.match(log,/TX withoutResponse \[8 bytes\] 5A 97 98 01 B9/);
        const rows=log.split('\n').filter(row=>/^\d{4}-/.test(row));
        assert.equal(rows.filter(row=>/TX withoutResponse \[8 bytes\] 5A 97 98 01 B9/.test(row)).length,
          await page.evaluate(()=>testWrites.filter(bytes=>bytes[4]===0xb9).length));
        assert.ok(rows.length<=3000);
        assert.equal(await page.evaluate(()=>testWrites.length),beforeFlood);
      }
      await page.screenshot({path:path.join(os.tmpdir(),`cards-hardware-${width}.png`)});
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}: real native compile, mocked GATT upload, stop/cancel, unsupported blocks, discovery failure`);
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
