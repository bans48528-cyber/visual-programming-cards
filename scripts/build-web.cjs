// Explicit allowlist: never ship compiler services, desktop binaries or source evidence.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
const files = ['index.html', 'styles.css', 'blocks.css', 'home.css', 'bluetooth.css',
  'toolbar.css', 'block-layout.js', 'app.js', 'home.js', 'spark-protocol.js',
  'bluetooth.js', 'platform.js', 'unsupported.html', 'android-bluetooth.js', 'android-bluetooth.css',
  'xiaobai-runner.js', 'xiaobai-ui.js', 'remote-control.js', 'remote-ui.js', 'remote.css'];
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(out, file));
fs.cpSync(path.join(root, 'assets'), path.join(out, 'assets'), {recursive: true});
fs.mkdirSync(path.join(out, 'licenses'), {recursive: true});
fs.copyFileSync(path.join(root, 'native/card-compiler/vendor/LICENSE-PikaPython'), path.join(out, 'licenses/PikaPython.txt'));
// The injected native bridge does not include core's registerPlugin implementation.
// Load the official runtime only in the APK build, before platform.js uses plugins.
fs.copyFileSync(path.join(root, 'node_modules/@capacitor/core/dist/capacitor.js'), path.join(out, 'capacitor-core.js'));
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
fs.writeFileSync(path.join(out, 'index.html'), html.replace('<script src="platform.js"></script>',
  '<script src="capacitor-core.js"></script>\n  <script src="platform.js"></script>'));
console.log(`Built shared web UI: ${files.length} files + assets -> dist`);
