const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const env = {...process.env};
// Optional local tool cache; standard JAVA_HOME/ANDROID_HOME always take priority.
const cache = path.join(os.homedir(), '.cache', 'cards-android');
if (!env.JAVA_HOME && fs.existsSync(path.join(cache, 'jdk-ms'))) {
  const jdk = fs.readdirSync(path.join(cache, 'jdk-ms')).find(name =>
    fs.existsSync(path.join(cache, 'jdk-ms', name, 'bin', 'java.exe')));
  if (jdk) env.JAVA_HOME = path.join(cache, 'jdk-ms', jdk);
}
if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && fs.existsSync(path.join(cache, 'sdk'))) {
  env.ANDROID_HOME = path.join(cache, 'sdk');
}
const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
  ['assembleDebug', '--console=plain'], {
    cwd: path.join(root, 'android'), env, stdio: 'inherit', shell: process.platform === 'win32'
  });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const output = path.join(root, 'artifacts');
fs.mkdirSync(output, {recursive: true});
const name = 'xiaobai-1.0.0-debug.apk';
fs.copyFileSync(path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), path.join(output, name));
const hash = createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex');
fs.writeFileSync(path.join(output, `${name}.sha256`), `${hash}  ${name}\n`);
console.log(`APK: ${path.join(output, name)}\nSHA256: ${hash}`);
