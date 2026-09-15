// Exercises the installed APK/JNI without editing or deleting any user project.
const {chromium} = require('playwright');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const serial = process.argv[2];
assert(serial, 'Specify adb serial');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), '.cache/cards-android/sdk');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const run = (...args) => execFileSync(adb, ['-s', serial, ...args], {encoding: 'utf8', timeout: 20000});
const fixtures = path.resolve(__dirname, 'fixtures/compiler-baseline');
const report = JSON.parse(fs.readFileSync(path.join(fixtures, 'report.json')));
let browser, port;
(async () => {
  const pid = run('shell', 'pidof', 'com.cardprogramming.app').trim();
  assert(pid, 'Launch the installed APK first');
  port = run('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`).trim();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {noDefaults: true});
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('https://localhost'));
  assert(page);
  const before = await page.evaluate(() => JSON.stringify(localStorage));
  const results = [];
  for (const fixture of report.cases) {
    const program = JSON.parse(fs.readFileSync(path.join(fixtures, fixture.name + '.json')));
    const expected = fs.readFileSync(path.join(fixtures, fixture.name + '.py.o'));
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = await page.evaluate(async program => {
        const start = performance.now();
        const result = await CardCompiler.compile(program);
        return {source: result.source, bytecode: Array.from(result.bytecode), ms: performance.now() - start};
      }, program);
      assert.equal(result.source, fs.readFileSync(path.join(fixtures, fixture.name + '.py'), 'utf8'));
      assert.deepEqual(Buffer.from(result.bytecode), expected, fixture.name);
      results.push({name: fixture.name, repeat, bytes: expected.length, ms: result.ms});
    }
  }
  const errors = await page.evaluate(async () => {
    const native = Capacitor.registerPlugin('CardCompiler');
    const errors = [];
    for (const source of ['', 'x'.repeat(65537), 'a\0b', 'a = (\n']) {
      try { await native.compile({source}); errors.push('UNEXPECTED_SUCCESS'); }
      catch (e) { errors.push(e.message); }
    }
    return errors;
  });
  assert.equal(errors.length, 4);
  assert(!errors.includes('UNEXPECTED_SUCCESS'), JSON.stringify(errors));
  const cancellation = await page.evaluate(async () => {
    const native = Capacitor.registerPlugin('CardCompiler');
    const task = native.compile({source: '_os.delay_ms(1000)\n'.repeat(2500)}).then(() => 'completed', e => e.message);
    await native.cancel();
    const cancelled = await task;
    const recovered = await CardCompiler.compile([{id: 'motor-stop', params: {port: 'E'}}]);
    return {cancelled, bytes: recovered.bytecode.length};
  });
  assert.match(cancellation.cancelled, /取消/);
  assert(cancellation.bytes > 16);
  assert.equal(run('shell', 'pidof', 'com.cardprogramming.app').trim(), pid, 'Editor survived cancellation');
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), before, 'Projects unchanged');
  const output = path.resolve(__dirname, '../artifacts/compiler-native-jni-report.json');
  fs.writeFileSync(output, JSON.stringify({date: new Date().toISOString(), serial, results, errors, cancellation}, null, 2));
  console.log(`PASS APK/JNI: ${report.cases.length} byte-identical fixtures twice, validation, syntax error, cancellation/recovery; projects preserved.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (port) run('forward', '--remove', `tcp:${port}`);
});
