// Direct NDK driver: also works where Windows CMake tool discovery crashes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'native/card-compiler');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), '.cache/cards-android/sdk');
const ndk = process.env.ANDROID_NDK_HOME || path.join(sdk, 'ndk/28.2.13676358');
const host = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
const bin = path.join(ndk, 'toolchains/llvm/prebuilt', host, 'bin');
const ext = process.platform === 'win32' ? '.exe' : '';
const targets = {'arm64-v8a': 'aarch64-linux-android24', 'armeabi-v7a': 'armv7a-linux-androideabi24', 'x86_64': 'x86_64-linux-android24'};
const abis = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(targets);
const files = ['vendor/pika-core', 'vendor/pika-stdlib'].flatMap(dir => fs.readdirSync(path.join(source, dir))
  .filter(f => f.endsWith('.c')).map(f => `${dir}/${f}`)).concat('vendor/pika-api/__pikaBinding.c', 'compiler_context.c');
const run = (tool, args) => execFileSync(path.join(bin, tool + ext), args, {stdio: 'inherit'});
for (const abi of abis) {
  if (!targets[abi]) throw new Error(`Unsupported ABI: ${abi}`);
  const out = path.join(source, `build-${abi}`);
  fs.mkdirSync(out, {recursive: true});
  const flags = [`--target=${targets[abi]}`, '-O2', '-std=c11', '-fPIC', '-ffunction-sections', '-fdata-sections', '-fvisibility=hidden',
    '-DPIKA_CONFIG_ENABLE', '-DCROSS_BUILD', '-D_FORTIFY_SOURCE=2', '-fstack-protector-strong',
    ...['.', 'vendor/pika-core', 'vendor/pika-api'].flatMap(dir => ['-I', path.join(source, dir)])];
  const objects = [];
  for (const file of [...files, 'jni.c', 'cli.c']) {
    const object = path.join(out, file.replace(/[/\\]/g, '_') + '.o');
    run('clang', [...flags, '-c', path.join(source, file), '-o', object]);
    objects.push(object);
  }
  const core = objects.slice(0, -2);
  const link = ['-Wl,--gc-sections', '-Wl,-z,max-page-size=16384', '-Wl,-z,relro,-z,now', '-Wl,--no-undefined'];
  run('clang', [flags[0], ...link, '-shared', ...core, objects.at(-2), '-lm', '-o', path.join(out, 'libcard_compiler.so')]);
  run('clang', [flags[0], ...link, ...core, objects.at(-1), '-lm', '-o', path.join(out, 'card-compiler')]);
  run('llvm-strip', ['--strip-unneeded', path.join(out, 'libcard_compiler.so')]);
  const dest = path.join(root, 'android/app/src/main/jniLibs', abi);
  fs.mkdirSync(dest, {recursive: true});
  fs.copyFileSync(path.join(out, 'libcard_compiler.so'), path.join(dest, 'libcard_compiler.so'));
  console.log(`Built ${abi}: ${fs.statSync(path.join(dest, 'libcard_compiler.so')).size} bytes`);
}
