// Creates one separate test project on an explicitly selected, unlocked phone.
// Requires an installed debug APK; retains all existing app data.
const {chromium} = require('playwright');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const serial = process.argv[2];
if (!serial) throw new Error('Pass the adb serial of an unlocked phone.');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(),'.cache/cards-android/sdk');
const adb = path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
const run = (...args) => execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000});
const app = 'com.cardprogramming.app';
const artifacts = path.resolve(__dirname,'../artifacts');
let browser, port;
(async () => {
  assert.doesNotMatch(run('shell','dumpsys','window'),/isKeyguardShowing=true/,'Unlock the phone before testing.');
  run('shell','am','start','-W','-n',`${app}/.MainActivity`);
  const pid = run('shell','pidof',app).trim();
  port = run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).trim();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});
  const page = browser.contexts()[0].pages().find(p=>p.url().startsWith('https://localhost'));
  assert.ok(page);
  page.setDefaultTimeout(12000);
  const cdp = await page.context().newCDPSession(page);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  async function tap(selector) {
    const el=page.locator(selector);
    await el.waitFor({state:'visible'});
    const r=await el.boundingBox();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  function assertNoIme() {
    const ime=run('shell','dumpsys','window').split(/\r?\n/).filter(line=>line.includes('InsetsSource type=ITYPE_IME'));
    assert.ok(ime.length,'Android must report IME visibility for this check');
    assert.ok(ime.every(line=>line.includes('visible=false')),ime.join('\n'));
  }
  if(await page.locator('dialog[open]').count()) await page.locator('dialog[open] [type=button]').click();
  if(new URL(page.url()).hash==='#bluetooth') {run('shell','input','keyevent','4');await page.waitForURL('**/#editor');}
  if(new URL(page.url()).hash==='#editor') await page.locator('#homeBtn').click();
  const name=`小键盘验证 ${new Date().toISOString().slice(11,19)}`;
  await tap('#newProject');
  await page.locator('.home-dialog input').fill(name);
  await page.locator('.home-dialog [type=submit]').click();
  await page.waitForURL('**/#editor');
  await page.waitForFunction(()=>!document.activeElement?.matches('input'));
  // Wait for layout stability while the name dialog's IME finishes closing.
  await page.locator('#palette [data-card-id=motor-forward]').click();
  assertNoIme();
  const height=await page.evaluate(()=>innerHeight);
  async function press(value) {
    await tap(`.number-key[data-key="${value}"]`);
    assertNoIme();
    assert.equal(await page.evaluate(()=>innerHeight),height,'IME must not resize the editor');
  }
  await tap('#chain .param-bubble');
  await tap('#paramEditor .param-current');
  assertNoIme();
  assert.equal(await page.locator('#paramEditor input').count(),0);
  await press('2');await press('.');await press('5');
  assert.equal(await page.evaluate(()=>program[0].params.duration),1);
  await press('confirm');
  assert.equal(await page.evaluate(()=>program[0].params.duration),2.5);
  await tap('#paramEditor .param-current');await press('9');
  run('shell','input','keyevent','4');
  await page.locator('.number-keypad').waitFor({state:'hidden'});
  assert.equal(await page.locator('#paramEditor').isVisible(),true);
  assert.equal(await page.evaluate(()=>program[0].params.duration),2.5);
  run('shell','input','keyevent','4');
  await page.locator('#paramEditor').waitFor({state:'hidden'});
  await tap('#undoBtn');
  assert.equal(await page.evaluate(()=>program[0].params.duration),1);
  await tap('#redoBtn');
  assert.equal(await page.evaluate(()=>program[0].params.duration),2.5);
  await page.reload();
  assert.equal(await page.evaluate(()=>program[0].params.duration),2.5);
  await tap('#tab-logic');
  await tap('#palette [data-card-id=loop-count]');
  await tap('#chain .loop-tail .param-bubble');
  await tap('#paramEditor .param-current');
  assert.equal(await page.locator('.number-key[data-key="."]').isDisabled(),true);
  await press('4');await press('confirm');
  assert.equal(await page.evaluate(()=>program[1].params.count),4);
  run('shell','input','keyevent','4');
  await page.locator('#paramEditor').waitFor({state:'hidden'});
  await tap('#chain > [data-card-id=motor-forward] .param-bubble');
  await tap('#paramEditor .param-current');
  await press('3');await press('.');await press('5');
  await press('delete');await press('5');await press('clear');
  assert.equal(await page.locator('.number-key[data-key=confirm]').isDisabled(),true);
  await press('3');await press('.');await press('5');
  const r=await page.locator('#paramEditor').boundingBox();
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  assert.ok(r.x>=0 && r.y>=0 && r.x+r.width<=viewport.width && r.y+r.height<=viewport.height);
  fs.mkdirSync(artifacts,{recursive:true});
  await page.screenshot({path:path.join(artifacts,'android-keypad-webview.png')});
  run('shell','screencap','-p','/data/local/tmp/cards-keypad.png');
  run('pull','/data/local/tmp/cards-keypad.png',path.join(artifacts,'android-keypad-phone.png'));
  await press('confirm');
  assert.equal(await page.evaluate(()=>program[0].params.duration),3.5);
  // Leave the keypad visible with the committed value for the user to try.
  await tap('#paramEditor .param-current');
  assertNoIme();
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(artifacts,'android-keypad-report.json'),JSON.stringify({date:new Date().toISOString(),project:name,viewport,imeVisible:false,decimal:3.5,count:4,checks:['native touch','decimal and integer','delete and clear','native back cancellation','undo and redo','autosave reload','full keypad in viewport'],errors},null,2));
  console.log('PASS real Android keypad: native touch, no IME or resize, decimals, integer, delete/clear, back cancellation, undo/redo and persistence');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser) await browser.close();
  if(port) run('forward','--remove',`tcp:${port}`);
});
