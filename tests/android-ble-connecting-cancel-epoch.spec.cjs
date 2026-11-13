'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
// Native BLE alone is synthetic; App adapter, Gate and OTA checks are real.
const repo=path.resolve(process.env.CARD_APP_ROOT||path.resolve(__dirname,'..'));
const out=path.resolve(process.env.CARD_TEST_OUT||path.join(repo,'artifacts','ble-local-recovery-20261111'));
const evidenceName="connecting-cancel-epoch";
const save=value=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,evidenceName+'.json'),JSON.stringify(value,null,2)+'\n');};
const {chromium}=require(path.join(repo,'node_modules/playwright'));
const mockAndroid=require(path.join(repo,'tests/mock-android.cjs')),mockFirmware=require(path.join(repo,'tests/mock-firmware.cjs'));
const target=require(path.join(repo,'assets/firmware/release.json')).firmware;
const mime={'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1'),file=path.resolve(repo,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(path.resolve(repo)+path.sep)){res.writeHead(403).end();return;}
  const bytes=await fs.promises.readFile(file);res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(bytes);
}catch{res.writeHead(404).end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:892,height:412},hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));await context.addInitScript(mockAndroid);
  await context.addInitScript(mockFirmware,{target,schemaVersion:2,layoutId:target.layoutId,appBase:target.appBase,capabilities:15,emitVersion:false});
  await context.addInitScript(()=>{
   const original=Capacitor.nativePromise.bind(Capacitor),h=window.releaseHook={held:false,releases:[]};
   Capacitor.nativePromise=async(plugin,method,options={})=>{
    if(plugin==='SparkBle'&&method==='connect'&&!h.initialConnect){
     h.initialConnect=options.connectionId;h.holdEpoch=options.connectionId;const result=await original(plugin,method,options);
     h.connectHeld=true;await new Promise(resolve=>h.releaseConnect=resolve);return result;
    }
    if(plugin==='SparkBle'&&method==='disconnect'&&options.connectionId&&options.connectionId===h.holdEpoch){
     await original(plugin,method,options);h.held=true;await new Promise(resolve=>h.release=resolve);
     h.releases.push(options.connectionId);return{localReleased:true,remoteDisconnectionConfirmed:false};
    }
    return original(plugin,method,options);
   };
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const file of ['android-bluetooth.js','bluetooth.js','xiaobai-ota.js','xiaobai-firmware.js'])assert.deepEqual(fs.readFileSync(path.join(repo,file)),fs.readFileSync(path.join(repo,'dist',file)),file+' source equals tested dist');
  await page.goto(`http://127.0.0.1:${server.address().port}/dist/index.html#home`);await page.waitForFunction(()=>window.CardBluetooth);
  await page.locator('#newProject').click();await page.waitForFunction(()=>releaseHook.connectHeld);
  const first=await page.evaluate(()=>{window.oldDisconnect=CardBluetooth.disconnect();return releaseHook.initialConnect;});
  await page.waitForFunction(()=>releaseHook.held&&!CardBluetooth.connected);
  await page.evaluate(()=>CardBluetooth.ensureConnected());await page.waitForFunction(()=>CardBluetooth.connected&&CardBluetooth.firmware.snapshot().ready);
  const second=await page.evaluate(()=>mockBle.connectionId);assert.notEqual(first,second);
  const before=await page.evaluate(()=>({id:mockBle.connectionId,actual:CardBluetooth.firmware.snapshot().actual?.epoch,ready:CardBluetooth.firmware.snapshot().ready,connects:mockBle.calls.filter(c=>c.method==='connect').length}));
  await page.evaluate(async old=>{releaseHook.release();await oldDisconnect;releaseHook.releaseConnect();},first);
  await page.waitForTimeout(60);const after=await page.evaluate(()=>({id:mockBle.connectionId,actual:CardBluetooth.firmware.snapshot().actual?.epoch,ready:CardBluetooth.firmware.snapshot().ready,connects:mockBle.calls.filter(c=>c.method==='connect').length}));
  console.log(JSON.stringify({before,after,errors,case:'cancel connecting A while disconnect awaits; B ready before old promise completes'}));assert.deepEqual(after,before);assert.deepEqual(errors,[]);
  const message=await page.locator('.bt-message').textContent();assert.notEqual(message,'已断开连接。','retired completion cannot overwrite new connection message');
  const evidence={case:evidenceName,pass:true,first,second,before,after,message,hardware:false};save(evidence);console.log(JSON.stringify(evidence));
  await context.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{save({case:evidenceName,pass:false,error:e.stack||String(e),hardware:false});console.error(e);server.close();process.exitCode=1;});
