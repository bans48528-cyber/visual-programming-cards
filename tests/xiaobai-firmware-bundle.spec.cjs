'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const B=require('../xiaobai-firmware-bundle.js'),P=require('../xiaobai-ota-protocol.js'),G=require('../scripts/check-firmware-release.cjs');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),copy=v=>JSON.parse(JSON.stringify(v));
let checks=0;
const ok=(b,m)=>{assert.ok(b,m);checks++;};
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const throws=(fn,pattern)=>{assert.throws(fn,pattern);checks++;};
const read=f=>fs.readFileSync(path.join(root,f));
const releaseBytes=read('assets/firmware/release.json'),release=JSON.parse(releaseBytes),packageBytes=read(release.firmware.asset);
const app=G.actualApp(root),firmware=G.plan(root).firmware,nextCode=app.versionCode+1;
const nextParts=app.versionName.split('.').map(Number);nextParts[2]++;const nextVersion=nextParts.join('.');
function minimal(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'xiaobai-release-'));
 for(const name of ['xiaobai-firmware-bundle.js','xiaobai-ota-protocol.js','firmware-release-plan.json','firmware-releases.json','capacitor.config.json','android/app/build.gradle','assets/firmware/release.json',release.firmware.asset]){
  const target=path.join(folder,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,name),target);
 }
 return folder;
}
async function inRepo(fn){const repo=minimal();try{return await fn(repo);}finally{const resolved=path.resolve(repo);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('xiaobai-release-'));fs.rmSync(resolved,{recursive:true,force:true});}}
function mutateJson(repo,name,fn){const target=path.join(repo,name),v=JSON.parse(fs.readFileSync(target,'utf8'));fn(v);fs.writeFileSync(target,G.canonical(v));}
function entryFor(r){return{manifestSha256:G.sha(G.canonical(r)),release:r};}
async function runtime(){
 eq(B.METADATA.app,app,'runtime release pin matches actual Android identity');
 eq(B.METADATA.firmware,firmware,'runtime firmware pin matches independent release plan');
 ok(Object.isFrozen(B.METADATA)&&Object.isFrozen(B.METADATA.app)&&Object.isFrozen(B.METADATA.firmware),'release pin immutable');
 const v=await B.verify(releaseBytes,packageBytes);eq(v.pkg.version,firmware.version,'signed package matches planned target firmware');eq(v.pkg.signatureVerified,true);eq(v.manifestSha256,B.METADATA.manifestSha256);ok(Object.isFrozen(v.release.app),'release metadata immutable');
 const actual={id:app.applicationId,version:app.versionName,build:String(app.versionCode)};await B.verify(releaseBytes,packageBytes,{appInfo:actual});checks++;
 await rejects(()=>B.verify(releaseBytes,packageBytes,{appInfo:{...actual,version:nextVersion}}),{code:'RELEASE_IDENTITY'});
 await rejects(()=>B.verify(releaseBytes,packageBytes,{appInfo:{...actual,build:String(nextCode)}}),{code:'RELEASE_IDENTITY'});
 await rejects(()=>B.verify(releaseBytes,packageBytes,{appInfo:{...actual,id:'com.other.app'}}),{code:'RELEASE_IDENTITY'});
 await rejects(()=>B.verify(releaseBytes,packageBytes.slice(1)),{code:'BUNDLE_SIZE'});
 const broken=Buffer.from(packageBytes);broken[broken.length-1]^=1;await rejects(()=>B.verify(releaseBytes,broken),{code:'IMAGE_HASH'});
 const badSignature=Buffer.from(packageBytes);badSignature[100]^=1;await rejects(()=>B.verify(releaseBytes,badSignature),{code:'SIGNATURE'});
 await rejects(()=>B.verify(Buffer.concat([releaseBytes,Buffer.from(' ')]),packageBytes),{code:'RELEASE_HASH'});
 const wrong=copy(release);wrong.firmware.packageSha256='a'.repeat(64);const wrongBytes=G.canonical(wrong);
 await rejects(()=>B.verify(wrongBytes,packageBytes,{metadata:{...B.METADATA,manifestSha256:G.sha(wrongBytes)}}),{code:'BUNDLE_IDENTITY'});
 const fields=[r=>r.schemaVersion=2,r=>r.app.versionCode=nextCode,r=>r.firmware.version=65537,r=>r.firmware.boardId=259,r=>r.firmware.protocol=2,r=>r.firmware.asset='../evil.ota',r=>r.firmware.asset='https://other/firmware.ota',r=>r.firmware.asset='assets/firmware/固件.ota',r=>r.firmware.imageSize=999999,r=>r.firmware.packageSize++,r=>r.firmware.additionalAsset='other.ota'];
 for(const mutate of fields){const r=copy(release);mutate(r);throws(()=>B.validateRelease(r));}
 const calls=[];const fetch=async url=>{calls.push(url);const bytes=url.endsWith('/release.json')?releaseBytes:packageBytes;return{ok:true,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};};
 const loader=B.createLoader({fetch,baseUrl:'https://localhost/index.html'});const [a,b]=await Promise.all([loader.load(),loader.load()]);eq(calls.length,2,'one map plus one firmware fetch');eq(a.pkg.packageSha256,b.pkg.packageSha256);
 a.pkg.bytes[0]=0;a.pkg.image[1]=0;a.pkg.manifest[1]=0;
 const c=await loader.load();eq(c.pkg.packageSha256,release.firmware.packageSha256,'returned mutable byte arrays cannot corrupt cached source');eq(calls.length,2);
 let count=0;const missing=B.createLoader({fetch:async()=>{count++;return{ok:false};}});
 await rejects(()=>missing.load(),{code:'FIRMWARE_MISSING'});await rejects(()=>missing.load(),{code:'FIRMWARE_MISSING'});eq(count,2,'failed reads retry explicitly');
 const unbound=B.createLoader({metadata:{bound:false},fetch});await rejects(()=>unbound.load(),{code:'FIRMWARE_MISSING'});
}
async function buildGate(){
 const original=await G.checkRelease();eq(original.release.firmware.packageSha256,release.firmware.packageSha256);eq(original.app.versionName,app.versionName);
 await inRepo(async repo=>{fs.unlinkSync(path.join(repo,release.firmware.asset));await rejects(()=>G.checkRelease({repo}),/只能内置一个/);});
 await inRepo(async repo=>{fs.unlinkSync(path.join(repo,'assets/firmware/release.json'));await rejects(()=>G.checkRelease({repo}),/发布映射缺失/);});
 await inRepo(async repo=>{const f=path.join(repo,'android/app/build.gradle');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\bversionCode\s+\d+/,`versionCode ${nextCode}`));await rejects(()=>G.checkRelease({repo}),/实际 App/);});
 await inRepo(async repo=>{mutateJson(repo,'capacitor.config.json',v=>v.appId='com.other.app');await rejects(()=>G.checkRelease({repo}),/applicationId/);});
 await inRepo(async repo=>{mutateJson(repo,'firmware-release-plan.json',v=>v.firmware.version=65537);await rejects(()=>G.checkRelease({repo}),/发布计划/);});
 await inRepo(async repo=>{const f=path.join(repo,release.firmware.asset),b=fs.readFileSync(f);b[b.length-1]^=1;fs.writeFileSync(f,b);await rejects(()=>G.checkRelease({repo}),/校验失败/);});
 await inRepo(async repo=>{mutateJson(repo,'assets/firmware/release.json',v=>v.firmware.packageSha256='b'.repeat(64));await rejects(()=>G.checkRelease({repo}),/固定指纹/);});
 await inRepo(async repo=>{mutateJson(repo,'firmware-releases.json',v=>v.releases=[]);await rejects(()=>G.checkRelease({repo}),/未登记/);});
 await inRepo(async repo=>{mutateJson(repo,'firmware-releases.json',v=>v.releases[0].manifestSha256='0'.repeat(64));await rejects(()=>G.checkRelease({repo}),/发布记录/);});
 await inRepo(async repo=>{fs.writeFileSync(path.join(repo,'assets/firmware/extra.ota'),packageBytes);await rejects(()=>G.checkRelease({repo}),/只能内置一个/);});
 await inRepo(async repo=>{const before=fs.readFileSync(path.join(repo,'assets/firmware/release.json'));await rejects(()=>G.bindPackage({repo,packageFile:path.join(repo,release.firmware.asset),expectedSha256:'a'.repeat(64)}),/冻结 SHA256/);eq(fs.readFileSync(path.join(repo,'assets/firmware/release.json')),before,'failed bind never writes release');});
 await inRepo(async repo=>{const before=JSON.parse(fs.readFileSync(path.join(repo,'firmware-releases.json')));await G.bindPackage({repo,packageFile:path.join(repo,release.firmware.asset),expectedSha256:release.firmware.packageSha256});const history=JSON.parse(fs.readFileSync(path.join(repo,'firmware-releases.json')));eq(history,before,'same exact bind is idempotent and preserves every historical release');});
 await rejects(()=>G.bindPackage({}),/不能使用占位包/);
 const first=entryFor(copy(release));const duplicate=entryFor(copy(release));
 throws(()=>G.validateHistory({schemaVersion:1,releases:[first,duplicate]},B),/禁止重复/);
 const other=copy(release);other.app.versionCode=nextCode;other.firmware.imageSha256='c'.repeat(64);
 throws(()=>G.validateHistory({schemaVersion:1,releases:[first,entryFor(other)]},B),/同一个 App/);
 const collision=copy(release);collision.app.versionCode=nextCode;collision.app.versionName=nextVersion;collision.firmware.imageSha256='c'.repeat(64);
 throws(()=>G.validateHistory({schemaVersion:1,releases:[first,entryFor(collision)]},B),/同一固件版本/);
}
async function missingBuildsStopBeforeMutation(){
 for(const script of ['build-web.cjs','build-android.cjs'])await inRepo(async repo=>{
  const scripts=path.join(repo,'scripts');fs.mkdirSync(scripts,{recursive:true});
  for(const name of [script,'check-firmware-release.cjs'])fs.copyFileSync(path.join(root,'scripts',name),path.join(scripts,name));
  fs.unlinkSync(path.join(repo,release.firmware.asset));
  const sentinel=path.join(repo,'dist/sentinel');fs.mkdirSync(path.dirname(sentinel));fs.writeFileSync(sentinel,'preserved');
  const result=spawnSync(process.execPath,[path.join(scripts,script)],{encoding:'utf8',windowsHide:true});
  eq(result.status,1,script+' rejects missing signed firmware');ok((result.stderr+result.stdout).includes('只能内置一个'),script+' reports real release gate failure');eq(fs.readFileSync(sentinel,'utf8'),'preserved',script+' gate runs before output mutation or native compiler');
 });
}
function zipFixture(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'xiaobai-release-'));
 try{
  const name=Buffer.from('assets/public/test.txt'),data=Buffer.from('fixed release bytes'),packed=zlib.deflateRawSync(data),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(P.crc32(data),14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(P.crc32(data),16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  const f=path.join(folder,'fixture.apk');fs.writeFileSync(f,Buffer.concat([local,name,packed,central,name,end]));eq(G.zipEntries(f).get(name.toString())(),data,'APK gate reads real deflated ZIP bytes');
  fs.writeFileSync(f,Buffer.from('not an APK'));throws(()=>G.zipEntries(f),/ZIP 目录缺失/);
 }finally{const resolved=path.resolve(folder);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('xiaobai-release-'));fs.rmSync(resolved,{recursive:true,force:true});}
}
(async()=>{await runtime();await buildGate();await missingBuildsStopBeforeMutation();zipFixture();console.log(`Fixed firmware bundle/release gate: ${checks} checks passed; actual App ${app.versionName} (${app.versionCode}) -> signed PY32 ${release.firmware.versionName}, no hardware.`);})().catch(e=>{console.error(e);process.exitCode=1;});
