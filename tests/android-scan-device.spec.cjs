// Real phone scan checks without a Spark peripheral; never connect or send commands.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const serial=process.argv[2];
if(!serial) throw new Error('Pass the serial of an unlocked Android phone.');
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||path.join(os.homedir(),'.cache/cards-android/sdk');
const adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000});
let browser,port;
(async()=>{
  assert.doesNotMatch(run('shell','dumpsys','window'),/isKeyguardShowing=true/,'Unlock the phone first');
  const pid=run('shell','pidof','com.cardprogramming.app').trim();
  port=run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).trim();
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});
  const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('https://localhost'));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(()=>location.hash='bluetooth');
  await page.waitForFunction(()=>!document.querySelector('.bt-search').disabled);
  const initial=await page.evaluate(()=>Capacitor.Plugins.SparkBle.getState());
  assert.ok(initial.permissionsGranted && initial.bluetoothEnabled && initial.locationEnabled,'Allow scanning and enable Bluetooth/location first');
  assert.equal(initial.connected,false,'Disconnect any active Spark device before running this scan-only test');
  if(initial.scanning) await page.locator('.bt-search').click();
  await page.locator('.bt-search').click();
  await page.waitForFunction(async()=> (await Capacitor.Plugins.SparkBle.getState()).scanning);
  await page.locator('.bt-search').click();
  await page.waitForFunction(async()=> !(await Capacitor.Plugins.SparkBle.getState()).scanning);
  await page.locator('.bt-search').click();
  await page.waitForFunction(async()=> (await Capacitor.Plugins.SparkBle.getState()).scanning);
  const started=Date.now();
  await page.waitForFunction(()=>document.querySelector('.bt-search').textContent==='重新扫描',null,{timeout:15000});
  const elapsed=Date.now()-started;
  assert.ok(elapsed>=7000 && elapsed<15000,'Native scan should expire around ten seconds');
  const deviceCount=await page.locator('.bt-device').count();
  assert.equal((await page.evaluate(()=>Capacitor.Plugins.SparkBle.getState())).connected,false);
  // Going to the editor stops discovery, but does not request any hardware command.
  await page.locator('.bt-search').click();
  await page.waitForFunction(async()=> (await Capacitor.Plugins.SparkBle.getState()).scanning);
  run('shell','input','keyevent','4');await page.waitForURL('**/#editor');
  await page.waitForFunction(async()=> !(await Capacitor.Plugins.SparkBle.getState()).scanning);
  await page.locator('#bluetoothBtn').click();
  await page.locator('.bluetooth-page').waitFor({state:'visible'});
  await page.locator('.bt-search').click();
  await page.waitForFunction(async()=> (await Capacitor.Plugins.SparkBle.getState()).scanning);
  run('shell','input','keyevent','KEYCODE_HOME');
  run('shell','am','start','-W','-n','com.cardprogramming.app/.MainActivity');
  await page.waitForFunction(async()=> !(await Capacitor.Plugins.SparkBle.getState()).scanning);
  assert.deepEqual(errors,[]);
  const report={device:run('shell','getprop','ro.product.model').trim(),android:run('shell','getprop','ro.build.version.release').trim(),
    webview:await page.evaluate(()=>navigator.userAgent),testedAt:new Date().toISOString(),scanDurationMs:elapsed,deviceCount,
    checks:['native permission state','native scanner start/stop','10-second expiry','editor back stops scan','background stops scan'],
    peripheralConnectionTested:false,errors};
  const out=path.resolve(__dirname,'../artifacts');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'android-scan-device-report.json'),JSON.stringify(report,null,2)+'\n');
  await page.screenshot({path:path.join(out,'android-bluetooth-phone.png')});
  console.log('PASS native Android scan:',JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser) await browser.close();
  if(port) run('forward','--remove',`tcp:${port}`);
});
