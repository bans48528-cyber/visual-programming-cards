// Tests the packaged assets with a mocked native lifecycle bridge, not a real WebView.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../dist');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png'};
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const context = await browser.newContext({viewport:{width:844, height:390}, hasTouch:true});
    await context.addInitScript(require('./mock-android.cjs'));
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    const back = () => page.evaluate(() => window.nativeListeners.backButton({canGoBack:true}));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => Boolean(window.nativeListeners.pause));
    await page.locator('#newProject').tap();
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await page.locator('.home-screen').isVisible(), false);
    await back();
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await page.locator('.home-screen').isVisible(), true);
    await page.locator('#newProject').tap();
    await page.locator('#palette [data-card-id=motor-forward]').tap();
    await page.locator('#saveBtn').tap();
    await page.locator('.home-dialog input').fill('安卓触摸测试');
    await page.locator('.home-dialog [type=submit]').tap();
    await page.evaluate(() => { program = []; renderProgram(); commitHistory(); });
    assert.equal(await page.locator('#palette [data-palette-label]').count(), 0);
    assert.equal(await page.locator('#palette [data-card-id=motor-forward] .param-bubble').textContent(), 'L正转1秒');
    assert.deepEqual(await page.evaluate(() => {
      const definition = cardById['motor-forward'].paramsSchema.port;
      return definition.options.map(value => getParamOptionDisplay(definition, value));
    }), ['L', 'R']);
    await page.locator('#tab-logic').tap();
    await page.locator('#palette [data-card-id=loop-count]').tap();
    await page.locator('#chain .loop-tail .param-bubble').tap();
    await page.locator('#paramEditor .param-current').tap();
    await page.locator('.number-key[data-key="4"]').tap();
    assert.equal(await page.evaluate(() => program[0].params.count), 4);
    // Values apply immediately; Back closes the keypad without reverting them.
    await back();
    assert.equal(await page.evaluate(() => program[0].params.count), 4);
    assert.equal(await page.locator('#paramEditor').isVisible(), false);
    await page.locator('#chain .loop-tail .param-bubble').tap();
    await page.locator('#paramEditor .param-current').tap();
    await page.locator('.number-key[data-key="9"]').tap();
    assert.equal(await page.evaluate(() => program[0].params.count), 9);
    await page.evaluate(() => window.nativeListeners.pause());
    assert.equal(await page.evaluate(() => program[0].params.count), 9);
    await page.locator('#chain .loop-tail .param-bubble').tap();
    await back();
    assert.equal(await page.evaluate(() => program[0].params.count), 9);
    assert.equal(await page.locator('#paramEditor').isVisible(), false);
    assert.equal(new URL(page.url()).hash, '#editor');
    await page.locator('#tab-motor').tap();
    const source = await page.locator('#palette [data-card-id=motor-forward]').boundingBox();
    const target = await page.locator('#chain .loop-inner').boundingBox();
    const cdp = await context.newCDPSession(page);
    const x = source.x + source.width / 2, y = source.y + source.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y}]});
    for (let i=1; i<=15; i++) await cdp.send('Input.dispatchTouchEvent', {
      type:'touchMove', touchPoints:[{x:x+(target.x+25-x)*i/15, y:y+(target.y+25-y)*i/15}]
    });
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    assert.equal(await page.evaluate(() => program[0].children[0].id), 'motor-forward');
    const snapshot = await page.evaluate(() => getProgramSnapshot());
    // Completed edits survive a reload without clicking Save.
    await page.reload();
    assert.equal(await page.evaluate(() => getProgramSnapshot()), snapshot);
    assert.equal(await page.locator('#undoBtn').isDisabled(), true); // history resets at launch
    await page.locator('#palette [data-card-id=motor-stop]').tap();
    await page.evaluate(() => document.getElementById('undoBtn').click());
    await page.reload();
    assert.equal(await page.evaluate(() => getProgramSnapshot()), snapshot);
    await page.locator('#runProgramBtn').tap();
    await page.waitForFunction(()=>document.querySelector('#executionNotice').textContent.includes('请先连接'));
    assert.match(await page.locator('#executionNotice').textContent(), /请先连接/);
    assert.equal(new URL(page.url()).hash, '#bluetooth');
    await page.locator('.bluetooth-page').waitFor({state:'visible'});
    assert.match(await page.locator('.bt-stage-note').textContent(), /不能同时连接/);
    await page.waitForFunction(()=>!document.querySelector('.bt-search').disabled);
    await back();
    await page.waitForURL('**/#editor');
    await page.evaluate(() => window.nativeListeners.pause());
    await back();
    await page.waitForURL('**/#home');
    await back();
    assert.equal(await page.evaluate(() => window.minimized), true);
    await page.getByRole('button', {name:'打开：安卓触摸测试', exact:true}).tap();
    await page.waitForURL('**/#editor');
    assert.equal(await page.evaluate(() => getProgramSnapshot()), snapshot);
    fs.mkdirSync(path.resolve(__dirname, '../artifacts'), {recursive:true});
    await page.screenshot({path:path.resolve(__dirname, '../artifacts/android-ui-browser.png')});
    assert.deepEqual(errors, []);
    assert.equal(requests.some(url => url.includes(':4180') || /https:\/\//.test(url)), false);
    for (const file of ['compiler-server.cjs', 'compiler-worker.cjs', 'node_modules']) {
      assert.equal(fs.existsSync(path.join(root, file)), false);
    }
    console.log('PASS Android packaged UI: touch nesting, parameters, autosave, undo persistence, back routing, lifecycle, offline hardware gating');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode=1;}).finally(() => server.close());
