// Fixed offline App -> signed PY32 release binding. Never reads private signing material.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const canonical=value=>Buffer.from(JSON.stringify(sorted(value),null,2)+'\n');
const same=(a,b)=>canonical(a).equals(canonical(b));
const die=message=>{throw new Error(message);};
const hash=/^[0-9a-f]{64}$/;
function actualApp(repo=root){
 const gradle=fs.readFileSync(path.join(repo,'android/app/build.gradle'),'utf8');
 const app={applicationId:gradle.match(/\bapplicationId\s+["']([^"']+)["']/)?.[1],versionName:gradle.match(/\bversionName\s+["']([^"']+)["']/)?.[1],versionCode:Number(gradle.match(/\bversionCode\s+(\d+)/)?.[1])};
 if(!app.applicationId||!app.versionName||!Number.isSafeInteger(app.versionCode)||app.versionCode<1)die('无法读取实际 Android App 版本。');
 const cap=JSON.parse(fs.readFileSync(path.join(repo,'capacitor.config.json'),'utf8'));
 if(cap.appId!==app.applicationId)die('Android applicationId 与 Capacitor appId 不一致。');
 return app;
}
function readJson(file,missing){if(!fs.existsSync(file))die(missing||`发布文件缺失：${file}`);try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{die(`发布文件不是有效 JSON：${file}`);}}
function plan(repo=root){
 const p=readJson(path.join(repo,'firmware-release-plan.json'),'缺少 App 固定固件发布计划。');
 if(p.schemaVersion!==1||!p.app||!p.firmware||!same(p.app,actualApp(repo)))die('固定固件发布计划与实际 App 包名/版本不一致。');
 if(p.firmware.boardId!==0x102||p.firmware.protocol!==1||!Number.isInteger(p.firmware.version)||p.firmware.version<1)die('固定固件计划板型/协议/版本无效。');
 return p;
}
function modules(repo=root){
 const target=path.join(repo,'xiaobai-firmware-bundle.js');delete require.cache[require.resolve(target)];
 return{P:require(path.join(repo,'xiaobai-ota-protocol.js')),B:require(target)};
}
function metadataFor(release,manifestSha256){return{bound:true,app:release.app,firmware:{boardId:release.firmware.boardId,protocol:release.firmware.protocol,version:release.firmware.version},manifestSha256};}
function versionParts(version){if(!/^\d+\.\d+\.\d+$/.test(version))die('App 版本必须为 major.minor.patch。');return version.split('.').map(Number);}
function compareVersion(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function validateHistory(history,B){
 if(history.schemaVersion!==1||!Array.isArray(history.releases))die('固件发布历史格式无效。');
 const names=new Set(),codes=new Set(),latestApp=new Map(),firmware=new Map();
 for(const entry of history.releases){
  const release=entry.release,raw=canonical(release),manifestSha256=sha(raw);
  B.validateRelease(release,metadataFor(release,manifestSha256));
  if(entry.manifestSha256!==manifestSha256)die('固件发布记录与其固定映射不一致。');
  const app=release.app,n=app.applicationId+':'+app.versionName,c=app.applicationId+':'+app.versionCode;
  if(names.has(n)||codes.has(c))die('同一个 App 版本已有固件绑定，禁止重复或偷偷替换。');
  const prior=latestApp.get(app.applicationId);
  if(prior&&(app.versionCode<=prior.versionCode||compareVersion(app.versionName,prior.versionName)<=0))die('新 App 发布版本必须递增。');
  const f=release.firmware,board=f.boardId+':'+f.protocol,key=board+':'+f.version,old=firmware.get(key),last=firmware.get(board);
  if(old&&(old.imageSha256!==f.imageSha256||old.imageSize!==f.imageSize))die('同一固件版本不能绑定不同镜像。');
  if(last&&f.version<last.version)die('新的 App 发布不能绑定降级固件。');
  firmware.set(key,f);firmware.set(board,f);latestApp.set(app.applicationId,app);names.add(n);codes.add(c);
 }
 return history;
}
function onlyPackage(repo,assetRoot=repo){
 const folder=path.join(assetRoot,'assets/firmware');
 if(!fs.existsSync(folder))die('内置签名固件缺失，拒绝构建。请先绑定最终签名包。');
 const files=fs.readdirSync(folder).filter(n=>n.toLowerCase().endsWith('.ota'));
 if(files.length!==1)die('App 必须且只能内置一个 .ota 固件包。');
 return files[0];
}
async function checkRelease({repo=root,assetRoot=repo}={}){
 const expected=plan(repo),{P,B}=modules(repo),releaseFile=path.join(assetRoot,B.MANIFEST_ASSET),release=readJson(releaseFile,'内置固件发布映射缺失，拒绝构建；等待最终签名包绑定。');
 const raw=fs.readFileSync(releaseFile),manifestSha256=sha(raw),metadata=metadataFor(release,manifestSha256);
 if(!raw.equals(canonical(release)))die('内置固件发布映射必须采用规范序列化。');
 B.validateRelease(release,metadata);
 if(!same(release.app,expected.app)||!same(metadata.firmware,expected.firmware))die('内置固件与固定发布计划不一致。');
 if(!same(B.METADATA,metadata))die('App 内置固件固定指纹与发布映射不一致。');
 const history=validateHistory(readJson(path.join(repo,'firmware-releases.json'),'固件发布历史缺失，拒绝构建。'),B);
 const record=history.releases.find(e=>same(e.release.app,release.app));
 if(!record||record.manifestSha256!==manifestSha256||!same(record.release,release))die('当前 App 的固定固件未登记，或同版本固件被替换。');
 if(onlyPackage(repo,assetRoot)!==path.basename(release.firmware.asset))die('内置固件文件与发布映射不一致。');
 const packageBytes=fs.readFileSync(path.join(assetRoot,release.firmware.asset));
 const verified=await B.verify(raw,packageBytes,{metadata,appInfo:actualApp(repo)});
 return{...verified,releaseFile,packageFile:path.join(assetRoot,release.firmware.asset),packageBytes,app:release.app};
}
async function bindPackage({repo=root,packageFile,expectedSha256}={}){
 if(!packageFile||!hash.test(expectedSha256||''))die('绑定需要 --package <最终签名包> 与 --sha256 <主线程冻结哈希>，不能使用占位包。');
 const expected=plan(repo),{P,B}=modules(repo),bytes=fs.readFileSync(packageFile);
 if(sha(bytes)!==expectedSha256)die('最终签名包与指定冻结 SHA256 不一致。');
 const pkg=await P.verifyPackage(bytes,{name:path.basename(packageFile)});
 if(pkg.boardId!==expected.firmware.boardId||P.C.OTA_PROTOCOL_VERSION!==expected.firmware.protocol||pkg.version!==expected.firmware.version)die('最终签名包版本/板型与固定计划不一致。');
 const release={schemaVersion:1,app:expected.app,firmware:{boardId:pkg.boardId,protocol:P.C.OTA_PROTOCOL_VERSION,version:pkg.version,versionName:pkg.versionText,minBootVersion:pkg.minBootVersion,imageSize:pkg.imageSize,imageSha256:pkg.imageSha256,packageSize:bytes.length,packageSha256:pkg.packageSha256,asset:`assets/firmware/xiaobai_py32_${pkg.versionText}.ota`}};
 const raw=canonical(release),manifestSha256=sha(raw),historyFile=path.join(repo,'firmware-releases.json'),history=validateHistory(readJson(historyFile,'缺少发布历史，不能绑定。'),B);
 const prior=history.releases.find(e=>e.release.app.applicationId===release.app.applicationId&&(e.release.app.versionName===release.app.versionName||e.release.app.versionCode===release.app.versionCode));
 if(prior&&!same(prior.release,release))die('这个 App 版本已绑定其他固件，禁止同版本替换。请递增 App 版本。');
 if(!prior){
  history.releases.push({manifestSha256,release});validateHistory(history,B);
 }
 const folder=path.join(repo,'assets/firmware'),asset=path.join(repo,release.firmware.asset);fs.mkdirSync(folder,{recursive:true});
 const others=fs.readdirSync(folder).filter(n=>n.endsWith('.ota')&&n!==path.basename(asset));
 if(others.length)die('活动固件目录存在历史 .ota；请将历史包存于 assets 外，再绑定新版本。');
 if(fs.existsSync(asset)&&!fs.readFileSync(asset).equals(bytes))die('同名活动固件已存在且内容不同，拒绝覆盖。');
 const loader=path.join(repo,'xiaobai-firmware-bundle.js'),source=fs.readFileSync(loader,'utf8'),marker=/\/\/ BEGIN GENERATED FIRMWARE RELEASE PIN[\s\S]*?\/\/ END GENERATED FIRMWARE RELEASE PIN/;
 if(!marker.test(source))die('内置固件加载器固定指纹标记缺失。');
 const metadata=metadataFor(release,manifestSha256);
 const pin=`// BEGIN GENERATED FIRMWARE RELEASE PIN\n  const METADATA=immutable(${JSON.stringify(metadata)});\n  // END GENERATED FIRMWARE RELEASE PIN`;
 // All validation precedes these writes; this is the sole allowed one-time binding operation.
 fs.writeFileSync(asset,bytes);fs.writeFileSync(path.join(folder,'release.json'),raw);fs.writeFileSync(historyFile,canonical(history));fs.writeFileSync(loader,source.replace(marker,pin));
 return checkRelease({repo});
}
function zipEntries(file){
 const bytes=fs.readFileSync(file),end=Math.max(0,bytes.length-65557);let eocd=-1;
 for(let i=bytes.length-22;i>=end;i--)if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 if(eocd<0)die('APK ZIP 目录缺失。');
 const count=bytes.readUInt16LE(eocd+10),offset=bytes.readUInt32LE(eocd+16),entries=new Map();let at=offset;
 for(let i=0;i<count;i++){
  if(at+46>bytes.length||bytes.readUInt32LE(at)!==0x02014b50)die('APK ZIP 目录损坏。');
  const method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42),name=bytes.toString('utf8',at+46,at+46+nameLength);
  if(entries.has(name))die('APK 中有重复资源。');entries.set(name,()=>{
   if(local+30>bytes.length||bytes.readUInt32LE(local)!==0x04034b50)die('APK ZIP 本地记录损坏。');
   const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);if(start+compressed>bytes.length)die('APK ZIP 长度越界。');
   const data=method===0?bytes.subarray(start,start+compressed):method===8?zlib.inflateRawSync(bytes.subarray(start,start+compressed)):die('APK ZIP 压缩格式不受支持。');
   if(data.length!==size)die('APK ZIP 资源大小错误。');return data;
  });at+=46+nameLength+extra+comment;
 }
 return entries;
}
function aaptTool(env=process.env){
 const sdk=env.ANDROID_HOME||env.ANDROID_SDK_ROOT||path.join(require('node:os').homedir(),'.cache/cards-android/sdk'),folder=path.join(sdk,'build-tools');
 if(!fs.existsSync(folder))die('缺少 Android SDK，无法核验 APK 实际版本。');
 const executable=process.platform==='win32'?'aapt2.exe':'aapt2',version=fs.readdirSync(folder).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).find(v=>fs.existsSync(path.join(folder,v,executable)));
 if(!version)die('缺少 aapt2，无法核验 APK 实际版本。');return path.join(folder,version,executable);
}
async function checkApk(apk,{repo=root,env=process.env}={}){
 const verified=await checkRelease({repo}),entries=zipEntries(apk),app=verified.release.app;
 const expected={['assets/public/assets/firmware/release.json']:fs.readFileSync(verified.releaseFile),['assets/public/'+verified.release.firmware.asset]:verified.packageBytes,'assets/public/xiaobai-firmware-bundle.js':fs.readFileSync(path.join(repo,'xiaobai-firmware-bundle.js'))};
 for(const[name,data]of Object.entries(expected))if(!entries.has(name)||!entries.get(name)().equals(data))die(`实际 APK 内置固件资源与最终源文件不一致：${name}`);
 if([...entries.keys()].filter(n=>n.toLowerCase().endsWith('.ota')).length!==1)die('实际 APK 必须只包含一个内置固件。');
 const result=spawnSync(aaptTool(env),['dump','badging',apk],{encoding:'utf8',windowsHide:true,env});
 if(result.error||result.status!==0)die('无法读取实际 APK 包名与版本：'+(result.error?.message||result.stderr));
 const actual=result.stdout.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);
 if(!actual||actual[1]!==app.applicationId||Number(actual[2])!==app.versionCode||actual[3]!==app.versionName)die('APK 实际包名/版本与固定固件发布映射不一致。');
 return{...verified,apk,apkSha256:sha(fs.readFileSync(apk))};
}
if(require.main===module){
 const args=process.argv.slice(2),value=name=>{const n=args.indexOf(name);return n>=0?args[n+1]:undefined;};
 (async()=>{
  const repo=value('--root')?path.resolve(value('--root')):root;
  const result=args.includes('--bind')?await bindPackage({repo,packageFile:value('--package'),expectedSha256:value('--sha256')}):value('--apk')?await checkApk(value('--apk'),{repo}):await checkRelease({repo,assetRoot:value('--assets-root')?path.resolve(value('--assets-root')):repo});
  console.log(JSON.stringify({app:result.app,firmware:result.release.firmware,manifestSha256:result.manifestSha256,apkSha256:result.apkSha256},null,2));
 })().catch(error=>{console.error('固定内置固件发布门禁：'+error.message);process.exitCode=1;});
}
module.exports={sha,canonical,actualApp,plan,metadataFor,validateHistory,checkRelease,bindPackage,zipEntries,checkApk};
