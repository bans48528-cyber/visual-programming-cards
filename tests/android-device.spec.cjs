// Explicitly target a connected, unlocked test phone. Creates one new test project;
// never clears app data. Run: node tests/android-device.spec.cjs <adb-serial>
const {chromium} = require('playwright');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const serial = process.argv[2];
if (!serial) throw new Error('Pass the adb serial of an unlocked test phone.');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), '.cache/cards-android/sdk');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const run = (...args) => execFileSync(adb, ['-s',serial,...args], {encoding:'utf8',timeout:30000});
const app = 'com.cardprogramming.app';
const artifacts = path.resolve(__dirname, '../artifacts');
fs.mkdirSync(artifacts, {recursive:true});
let browser, forwardPort;
async function connect() {
  const pid = run('shell','pidof',app).trim();
  assert.ok(pid, 'App must be running');
  forwardPort = run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).trim();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${forwardPort}`, {noDefaults:true});
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('https://localhost'));
  assert.ok(page, 'No packaged app WebView found');
  page.setDefaultTimeout(12000);
  const cdp = await page.context().newCDPSession(page);
  return {page, cdp};
}
async function disconnect() {
  if (browser) { await browser.close(); browser = null; }
  if (forwardPort) { run('forward','--remove',`tcp:${forwardPort}`); forwardPort=null; }
}
async function tap(page, cdp, selector) {
  const target = page.locator(selector);
  await target.waitFor({state:'visible'});
  // Use viewport DOM rects for CSS-zoomed blocks on older Chromium CDP versions.
  const r = await target.evaluate(el=>BlockLayout.clientRect(el).toJSON());
  assert.ok(r);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
}
(async () => {
  assert.doesNotMatch(run('shell','dumpsys','window'), /isKeyguardShowing=true/, 'Unlock the phone before testing.');
  run('shell','am','start','-W','-n',`${app}/.MainActivity`);
  let {page, cdp} = await connect();
  const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => typeof window.Capacitor?.registerPlugin === 'function');
  if (await page.locator('dialog[open]').count()) await page.locator('dialog[open] [type=button]').click();
  if (new URL(page.url()).hash === '#bluetooth') { run('shell','input','keyevent','4'); await page.waitForURL('**/#editor'); }
  if (new URL(page.url()).hash === '#editor') { await tap(page,cdp,'#homeBtn'); }
  const name = `安卓真机验证 ${new Date().toISOString().slice(11,19)}`;
  await tap(page,cdp,'#newProject');
  await page.locator('.home-dialog input').fill(name);
  // Playwright waits for layout stability while Android's IME resizes the WebView.
  await page.locator('.home-dialog [type=submit]').click();
  await page.waitForURL('**/#editor');
  await page.waitForFunction(() => document.querySelector('.library-area').getBoundingClientRect().bottom <= innerHeight+2);
  assert.ok(await page.evaluate(() => document.querySelector('.library-area').getBoundingClientRect().bottom <= innerHeight+2),
    'Palette must fit the real WebView height, including older engines without dvh support');
  await tap(page,cdp,'#tab-logic');
  await tap(page,cdp,'#palette [data-card-id=loop-count]');
  await tap(page,cdp,'#chain .loop-tail .param-bubble');
  const beforeCount = await page.evaluate(() => program[0].params.count);
  await tap(page,cdp,'#paramEditor .param-step-btn:last-child');
  assert.equal(await page.evaluate(() => program[0].params.count), beforeCount+1);
  run('shell','input','keyevent','4');
  await page.locator('#paramEditor').waitFor({state:'hidden'});
  assert.equal(new URL(page.url()).hash, '#editor');
  await tap(page,cdp,'#tab-motor');
  const from=await page.locator('#palette [data-card-id=motor-forward]').evaluate(el=>BlockLayout.clientRect(el).toJSON());
  const to=await page.locator('#chain .loop-inner').evaluate(el=>BlockLayout.clientRect(el).toJSON());
  const x=from.x+from.width/2,y=from.y+from.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=15;i++) await cdp.send('Input.dispatchTouchEvent',{
    type:'touchMove',touchPoints:[{x:x+(to.x+25-x)*i/15,y:y+(to.y+25-y)*i/15}]
  });
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await page.evaluate(() => program[0].children[0].id),'motor-forward');
  await tap(page,cdp,'#undoBtn');
  assert.equal(await page.evaluate(() => program[0].children.length),0);
  await tap(page,cdp,'#redoBtn');
  assert.equal(await page.evaluate(() => program[0].children.length),1);
  await tap(page,cdp,'#tab-light');
  await tap(page,cdp,'#palette [data-card-id=matrix-display]');
  await tap(page,cdp,'#chain .matrix-param-trigger');
  const pixel=await page.evaluate(() => program[1].params.pattern[0]);
  await tap(page,cdp,'.matrix-cell:first-child');
  assert.equal(await page.evaluate(() => program[1].params.pattern[0]),pixel?0:1);
  run('shell','input','keyevent','4');
  await page.locator('#paramEditor').waitFor({state:'hidden'});
  await tap(page,cdp,'#bluetoothBtn');
  await page.locator('.bluetooth-page').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('.bt-search').disabled);
  assert.equal(await page.locator('.bt-top h1').textContent(),'手机蓝牙');
  run('shell','input','keyevent','4');
  await page.waitForURL('**/#editor');
  const snapshot=await page.evaluate(() => getProgramSnapshot());
  const viewport=await page.evaluate(() => ({width:innerWidth,height:innerHeight}));
  assert.ok(viewport.width>viewport.height,'Phone editor must be landscape');
  await page.screenshot({path:path.join(artifacts,'android-phone-editor.png')});
  // Real native process termination: completed edits must survive without Save.
  await disconnect();
  run('shell','am','force-stop',app);
  run('shell','am','start','-W','-n',`${app}/.MainActivity`);
  ({page,cdp}=await connect());
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button',{name:`打开：${name}`,exact:true}).click();
  assert.equal(await page.evaluate(() => getProgramSnapshot()),snapshot);
  run('shell','input','keyevent','4');
  await page.waitForURL('**/#home');
  await page.getByRole('button',{name:`打开：${name}`,exact:true}).click();
  assert.deepEqual(errors,[]);
  const report={device:run('shell','getprop','ro.product.model').trim(),
    android:run('shell','getprop','ro.build.version.release').trim(),
    userAgent:await page.evaluate(() => navigator.userAgent), viewport, project:name,
    testedAt:new Date().toISOString(),
    checks:['cold launch','touch nesting','parameter stepper','native back closes parameters',
      'undo/redo','matrix touch','Bluetooth native back','editor native back',
      'landscape','force-stop/relaunch persistence'],errors};
  fs.writeFileSync(path.join(artifacts,'android-device-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS real Android WebView:',JSON.stringify(report));
})().catch(error => {console.error(error);process.exitCode=1;}).finally(disconnect);
