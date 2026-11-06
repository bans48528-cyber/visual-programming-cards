// Production UI/Gate/Session/adapter; only native BLE boundary is synthetic.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mockAndroid=require('./mock-android.cjs'),mockFirmware=require('./mock-firmware.cjs');
const target=require('../assets/firmware/release.json').firmware;
const base=process.env.XIAOBAI_OTA_UI_BASE||'http://127.0.0.1:4181/';
const out=process.env.XIAOBAI_BOOT_UI_OUTPUT||path.resolve(__dirname,'../artifacts/boot-ui');
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const viewport of [{width:751,height:360},{width:568,height:280}]){
   const context=await browser.newContext({viewport,hasTouch:true});
   try{
    await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
    await context.addInitScript(mockAndroid);
    await context.addInitScript(mockFirmware,{target});
    // Seed the preserved record once the normal App connection exists. A record
    // at startup intentionally disables auto-connect and tests a different route.
    await context.addInitScript(target=>{
      mockBle.appIdentity.bootVersion=target.minBootVersion-1;const bridge=Capacitor,previous=bridge.nativePromise.bind(bridge);let seeded=false;
      bridge.nativePromise=async(plugin,method,opts)=>{
        const result=await previous(plugin,method,opts);
        if(plugin==='SparkBle'&&method==='connect'&&!seeded){seeded=true;const gate=CardBluetooth.firmware;gate.session.saveBinding({deviceId:'FW-BOUND',uid:mockBle.otaUid,name:'Spark_AI',pending:target,written:true});gate.session.state.written=true;}
        return result;
      };
    },target);
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'#home');await page.waitForFunction(()=>CardBluetooth?.firmware&&!CardPageTransition.busy);
    await page.locator('#newProject').tap();await page.waitForFunction(()=>!CardPageTransition.busy&&location.hash==='#editor');
    const dialog=page.locator('#xiaobaiFirmwareDialog');await dialog.waitFor({state:'visible'});
    await page.waitForFunction(()=>CardBluetooth.firmware.snapshot().code==='BOOT_VERSION'&&!CardBluetooth.firmware.snapshot().busy);
    eq(await page.locator('#firmwareTitle').textContent(),'需要更新主控引导程序');
    assert.match(await page.locator('#firmwareMessage').textContent(),/通过 DAP 更新主控引导程序/);checks++;
    eq(await page.locator('.firmware-confirm').isVisible(),false,'no normal Bluetooth upgrade confirmation');
    eq(await page.locator('.firmware-retry').isVisible(),false,'no installed-image retry offered for an obsolete Boot');
    eq(await page.locator('.firmware-progress-wrap').isVisible(),false,'no write percentage in DAP-only state');
    eq(await page.locator('.firmware-help').isVisible(),false,'no stale pending recovery instructions');
    const result=await page.evaluate(()=>({
      phase:CardBluetooth.firmware.snapshot().phase,ready:CardBluetooth.firmware.snapshot().ready,
      canUpgrade:CardBluetooth.firmware.snapshot().canUpgrade,raw:mockBle.otaCalls,enter:mockBle.enterRequests,
      binding:JSON.parse(localStorage.getItem('xiaobai:ota:binding:v1')),
      box:(()=>{const d=document.querySelector('#xiaobaiFirmwareDialog'),f=d.querySelector('footer');return{dialog:d.getBoundingClientRect().toJSON(),footer:f.getBoundingClientRect().toJSON(),scroll:d.querySelector('.firmware-content').scrollWidth,client:d.querySelector('.firmware-content').clientWidth};})()
    }));
    eq(result.phase,'boot-update-required');eq(result.ready,false);eq(result.canUpgrade,false);eq(result.raw,[]);eq(result.enter,0);
    eq(result.binding.deviceId,'FW-BOUND');eq(result.binding.pending.imageSha256,target.imageSha256);eq(result.binding.written,true);
    assert.ok(result.box.dialog.left>=0&&result.box.dialog.top>=0&&result.box.dialog.right<=viewport.width+1&&result.box.dialog.bottom<=viewport.height+1);checks++;
    assert.ok(result.box.footer.bottom<=result.box.dialog.bottom+1&&result.box.scroll<=result.box.client+1);checks++;
    await page.screenshot({path:path.join(out,`dap-required-${viewport.width}x${viewport.height}.png`)});
    fs.writeFileSync(path.join(out,`dap-required-${viewport.width}.json`),JSON.stringify(result,null,2));
    eq(errors,[]);console.log(`PASS DAP-only Boot UI ${viewport.width}x${viewport.height}`);
   }finally{await context.close();}
  }
  console.log(`${checks} DAP-only Boot UI checks passed; real signed target remains unchanged, native BLE only synthetic.`);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,passed:true,target:{version:target.version,packageSha256:target.packageSha256,minBootVersion:target.minBootVersion},boundary:'Actual production UI and Gate with the current signed release bundle; synthetic native reports Boot one below its minimum. No hardware.'},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
