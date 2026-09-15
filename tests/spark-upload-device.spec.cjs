// REAL HARDWARE WRITE: replaces slot 0, runs a wait-only program, then pauses.
// Explicit invocation: node tests/spark-upload-device.spec.cjs <serial> <deviceId> --overwrite-slot0-and-run
const {chromium}=require('playwright'),{execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const [serial,deviceId,confirmation]=process.argv.slice(2);
assert(serial&&deviceId&&confirmation==='--overwrite-slot0-and-run','Explicit slot 0 replacement required');
const adb=path.join(process.env.ANDROID_HOME||path.join(os.homedir(),'.cache/cards-android/sdk'),'platform-tools/adb.exe');
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:20000}).trim();
let browser,port,page;
(async()=>{
 assert(!/isKeyguardShowing=true/.test(run('shell','dumpsys','window')),'Unlock phone first');
 const pid=run('shell','pidof','com.cardprogramming.app');
 port=run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`);
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});
 page=browser.contexts()[0].pages().find(p=>p.url().startsWith('https://localhost'));page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());location.hash='home';});
 await page.locator('#newProject').click();
 await page.locator('.home-dialog input').fill('发送验证 · 仅等待');
 await page.locator('.home-dialog [type=submit]').click();
 await page.evaluate(()=>{for(let i=0;i<32;i++) addCard('wait-time');});
 const input=await page.evaluate(()=>JSON.parse(JSON.stringify(program)));
 assert.equal(input.length,32);assert(input.every(item=>item.id==='wait-time'));
 await page.evaluate(()=>location.hash='bluetooth');
 await page.waitForFunction(()=>!document.querySelector('.bt-search').disabled||CardBluetooth.connected);
 if(!await page.evaluate(()=>CardBluetooth.connected)) {
  await page.locator('.bt-search').click();
  await page.locator(`.bt-device[data-device-id="${deviceId}"] .bt-button`).waitFor();
  await page.locator(`.bt-device[data-device-id="${deviceId}"] .bt-button`).click();
  await page.waitForFunction(()=>CardBluetooth.connected,null,{timeout:20000});
 }
 const native=await page.evaluate(()=>Capacitor.registerPlugin('SparkBle').getState());
 assert.equal(native.deviceId,deviceId);
 await page.evaluate(()=>{
  window.uploadEvidence={lines:new Set(),statuses:[],started:new Date().toISOString()};
  const trace=document.querySelector('.bt-trace');
  const capture=()=>trace.textContent.split('\n').filter(line=>/ TX | FRAME |WRITE_OK|发送准备|TIMEOUT|ERROR/.test(line)).forEach(line=>uploadEvidence.lines.add(line));
  window.uploadObserver=new MutationObserver(capture);uploadObserver.observe(trace,{childList:true,characterData:true,subtree:true});
  window.uploadStatusListener=e=>{uploadEvidence.statuses.push({time:Date.now(),...e.detail});if(uploadEvidence.statuses.length>100)uploadEvidence.statuses.shift();};
  window.addEventListener('spark-status',uploadStatusListener);
 });
 await page.locator('.bt-back').click();await page.locator('#runProgramBtn').click();
 await page.waitForFunction(()=>!document.getElementById('runProgramBtn').disabled,null,{timeout:60000});
 await page.waitForFunction(()=>uploadEvidence.statuses.some(s=>s.WillAiState==='run'),null,{timeout:10000});
 const runNotice=await page.locator('#executionNotice').textContent();
 await page.locator('#pauseProgramBtn').click();
 await page.waitForFunction(()=>!document.getElementById('runProgramBtn').disabled);
 await page.waitForFunction(()=>document.getElementById('deviceStatus').dataset.state==='stop',null,{timeout:10000});
 const result=await page.evaluate(()=>({started:uploadEvidence.started,lines:[...uploadEvidence.lines],statuses:uploadEvidence.statuses,
  notice:document.getElementById('executionNotice').textContent,connected:CardBluetooth.connected}));
 fs.writeFileSync('artifacts/spark-upload-live.json',JSON.stringify({serial,deviceId,input,runNotice,...result,errors},null,2));
 await page.screenshot({path:'artifacts/spark-upload-live.png'});
 console.log(JSON.stringify({notice:result.notice,connected:result.connected,lines:result.lines,lastStatus:result.statuses.at(-1),errors},null,2));
 assert.match(runNotice,/已完成 \d+ 字节发送/);
 assert(result.lines.some(line=>line.includes('TX')&&line.includes(' 0a ')===false&&/ 98 80 aa /.test(line)),'At least one intermediate AA frame');
 assert(result.lines.some(line=>/ TX .* 98 [0-9a-f]{2} bc /.test(line)), 'BC final packet');
 assert.equal(result.lines.filter(line=>/ TX .* 98 01 b9 /.test(line)).length,5,'Five pause requests');
 assert.deepEqual(errors,[]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(page) await page.evaluate(()=>{window.uploadObserver?.disconnect();if(window.uploadStatusListener)window.removeEventListener('spark-status',uploadStatusListener);}).catch(()=>{});
 if(browser) await browser.close();if(port) run('forward','--remove',`tcp:${port}`);
});
