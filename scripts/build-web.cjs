// Explicit allowlist: never ship compiler services, desktop binaries or source evidence.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
const files = ['buildings.js','buildings.css','building-catalog.json','receiver2226-protocol.js','receiver2226-runner.js','receiver2226-model.js','tc01-profile.js','tc01-protocol.js','tc01-runner.js','tc01-model.js','tc01-ui.js','tc01.css','spark-ai-model.js', 'spark-ai-adapter.js', 'program-codegen.js', 'card-compiler.js', 'device-context.js', 'lbs2206-protocol.js', 'lbs2206-profile.js', 'lbs2206-model.js', 'lbs2206-runner.js', 'lbs2206-bluetooth.js', 'lbs2206-ui.js', 'lbs2206.css', 'device-models.js', 'xiaobai-model.js', 'device-models.css', 'device-picker.js', 'device-preview.js', 'index.html', 'styles.css', 'blocks.css', 'home.css', 'bluetooth.css',
  'toolbar.css', 'block-layout.js', 'app.js', 'home.js', 'spark-protocol.js', 'xiaobai-protocol.js', 'xiaobai-device-preferences.js',
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
fs.writeFileSync(path.join(out, 'index.html'), html.replace(/<script src="platform\.js[^"]*"><\/script>/,
  match => `<script src="capacitor-core.js"></script>\n  ${match}`));
// Content hashes invalidate cached scripts/styles when the preview is rebuilt.
const indexPath = path.join(out, 'index.html');
const versioned = fs.readFileSync(indexPath, 'utf8').replace(/(src|href)="([^"?]+\.(?:js|css))(?:\?[^"]*)?"/g, (match, attr, file) => {
  const source = path.join(out, file);
  if (!fs.existsSync(source)) return match;
  const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0,12);
  return `${attr}="${file}?v=${hash}"`;
});
fs.writeFileSync(indexPath, versioned);
console.log(`Built shared web UI: ${files.length} files + assets -> dist`);

require('./build-viewer.cjs');
