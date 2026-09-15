// Compare complete files against fixtures captured from the installed desktop addon.
// node scripts/verify-native-compiler.cjs host <executable>
// node scripts/verify-native-compiler.cjs android <executable> <adb> <serial>
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const [mode, executable, adb, serial] = process.argv.slice(2);
assert(['host', 'android'].includes(mode) && executable, 'Specify host/android and executable');
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'tests/fixtures/compiler-baseline');
const baseline = JSON.parse(fs.readFileSync(path.join(fixtures, 'report.json')));
const output = path.join(root, 'artifacts', `compiler-native-${mode}`);
fs.mkdirSync(output, {recursive: true});
const run = (command, args) => cp.execFileSync(command, args, {timeout: 15000, stdio: 'pipe'});
const device = (...args) => run(adb, ['-s', serial, ...args]);
const remote = '/data/local/tmp/card-compiler-verification';
if (mode === 'android') {
  assert(adb && serial, 'Specify adb path and device serial');
  device('shell', 'mkdir', '-p', remote);
  device('push', path.resolve(executable), `${remote}/compiler`);
  device('shell', 'chmod', '700', `${remote}/compiler`);
}
const results = [];
try {
  for (const fixture of baseline.cases) {
    const source = path.join(fixtures, `${fixture.name}.py`);
    const expected = fs.readFileSync(path.join(fixtures, `${fixture.name}.py.o`));
    assert.equal(crypto.createHash('sha256').update(expected).digest('hex'), fixture.sha256);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), fixture.sourceSha256);
    const file = path.join(output, `${fixture.name}.py.o`);
    for (let repeat = 0; repeat < 2; repeat++) {
      if (mode === 'host') run(path.resolve(executable), [source, file]);
      else {
        device('push', source, `${remote}/input.py`);
        device('shell', `${remote}/compiler`, `${remote}/input.py`, `${remote}/output.py.o`);
        device('pull', `${remote}/output.py.o`, file);
      }
      assert.deepEqual(fs.readFileSync(file), expected, `${fixture.name}, repetition ${repeat + 1}`);
    }
    results.push({name: fixture.name, bytes: expected.length, sha256: fixture.sha256, repeatEqual: true});
  }
} finally {
  if (mode === 'android') device('shell', 'rm', '-f', `${remote}/compiler`, `${remote}/input.py`, `${remote}/output.py.o`);
}
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({date: new Date().toISOString(), mode,
  serial: mode === 'android' ? serial : undefined, desktopAddonSha256: baseline.desktopAddonSha256,
  executableSha256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'), cases: results}, null, 2));
console.log(`PASS: ${results.length} complete bytecode files, twice each (${mode}).`);
