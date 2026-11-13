'use strict';
// Public fixture/source gates only. Test signatures use a disposable test key,
// never the production signer, and no candidate firmware or APK is produced.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const test=require('node:test'),P=require('../xiaobai-ota-protocol.js'),B=require('../xiaobai-firmware-bundle.js'),G=require('../scripts/check-firmware-release.cjs');
const root=path.resolve(__dirname,'..'),copy=v=>JSON.parse(JSON.stringify(v));
const pair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'});
const publicKey=Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
const sandbox={module:{exports:{}},require:name=>{
  assert.equal(name,'./xiaobai-ota-protocol.js');
  return {...P,verifyPackage:(bytes,options)=>P.verifyPackage(bytes,{...options,publicKey})};
},crypto:crypto.webcrypto,TextDecoder,URL,Uint8Array,Object};
vm.runInNewContext(fs.readFileSync(path.join(root,'xiaobai-firmware-bundle.js'),'utf8'),sandbox,{filename:'bundle:real-protocol-test-key'});
const testBundle=sandbox.module.exports;
function signedFixture({layoutId=2,version=0x20000,size=320,fill=0x35}={}){
  const layout=P.layoutOf({layoutId}),image=Buffer.alloc(size,fill),manifest=Buffer.alloc(128);
  image.writeUInt32LE(0x20001fc0,0);image.writeUInt32LE(layout.appBase+193,4);
  manifest.writeUInt32LE(P.C.OTA_MANIFEST_MAGIC,0);manifest.writeUInt16LE(layout.format,4);manifest.writeUInt16LE(0x102,6);
  manifest.writeUInt32LE(version,8);manifest.writeUInt32LE(size,12);manifest.writeUInt32LE(layout.appBase,16);manifest.writeUInt32LE(layout.minBootVersion,20);
  crypto.createHash('sha256').update(image).digest().copy(manifest,24);
  if(layoutId===2){manifest.writeUInt32LE(2,56);manifest.writeUInt32LE(128,60);}
  crypto.sign('sha256',manifest.subarray(0,64),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).copy(manifest,64);
  return Buffer.concat([manifest,image]);
}
async function verified(bytes){return P.verifyPackage(bytes,{name:'public-test-fixture.ota',publicKey,crypto:crypto.webcrypto});}
function releaseFor(pkg,app={applicationId:'com.xiaobai.remote',versionName:'9.0.0',versionCode:900}){
  const f={boardId:pkg.boardId,protocol:1,version:pkg.version,versionName:pkg.versionText,minBootVersion:pkg.minBootVersion,
    imageSize:pkg.imageSize,imageSha256:pkg.imageSha256,packageSize:pkg.bytes.length,packageSha256:pkg.packageSha256,
    layoutId:pkg.layoutId,format:pkg.format,appBase:pkg.appBase,erasePage:pkg.erasePage};
  return {schemaVersion:2,app,firmware:{...f,asset:B.packageAsset(f)}};
}
async function verifyRelease(release,bytes,extra={}){
  const raw=G.canonical(release),metadata=G.metadataFor(release,G.sha(raw));
  return testBundle.verify(raw,bytes,{metadata,crypto:crypto.webcrypto,...extra});
}
test('schema 2 release verifies legacy and compact signatures against their own bounds',async()=>{
  for(const [layoutId,size]of [[1,320],[2,320],[2,50000],[2,52992]]){
    const bytes=signedFixture({layoutId,size}),pkg=await verified(bytes),release=releaseFor(pkg),result=await verifyRelease(release,bytes);
    assert.equal(result.pkg.layoutId,layoutId);assert.equal(result.pkg.imageSize,size);
    assert.equal(result.pkg.appBase,layoutId===1?0x08004000:0x08003000);
    assert.equal(result.release.firmware.erasePage,128);
    assert.equal(result.pkg.imageSha256,release.firmware.imageSha256);
  }
});
test('release mappings and pins reject missing, inconsistent and substituted layout identities',async()=>{
  const bytes=signedFixture(),pkg=await verified(bytes),release=releaseFor(pkg);
  const mutations=[f=>delete f.layoutId,f=>f.layoutId=1,f=>f.format=1,f=>f.appBase=0x08004000,f=>f.erasePage=4096,
    f=>f.minBootVersion=0x10001,f=>f.imageSize=52993,f=>f.asset='assets/firmware/xiaobai_py32_2.0.0.ota'];
  for(const change of mutations){
    const wrong=copy(release);change(wrong.firmware);
    assert.throws(()=>B.validateRelease(wrong,G.metadataFor(wrong,'a'.repeat(64))),{code:'RELEASE_FIRMWARE'});
  }
  const identity=G.metadataFor(release,'a'.repeat(64));
  for(const change of [f=>f.layoutId=1,f=>f.imageSha256='c'.repeat(64),f=>delete f.layoutId]){
    const wrong=copy(identity);change(wrong.firmware);assert.throws(()=>B.validateRelease(release,wrong),{code:'RELEASE_IDENTITY'});
  }
  const legacyMapping=copy(release);
  Object.assign(legacyMapping.firmware,{layoutId:1,format:1,appBase:0x08004000,erasePage:128});
  legacyMapping.firmware.asset=B.packageAsset(legacyMapping.firmware);
  await assert.rejects(()=>verifyRelease(legacyMapping,bytes),{code:'BUNDLE_IDENTITY'},'valid legacy map cannot substitute a signed compact package');
});
test('same-version image changes and a re-sign use distinct non-overwriting archive names',async()=>{
  const first=await verified(signedFixture({fill:0x35})),other=await verified(signedFixture({fill:0x36}));
  assert.equal(first.version,other.version);assert.notEqual(first.imageSha256,other.imageSha256);
  assert.notEqual(B.packageAsset(first),B.packageAsset(other));
  assert(B.packageAsset(first).includes('_l2_'+first.imageSha256));
  const signedAgain=await verified(signedFixture({fill:0x35}));
  assert.equal(first.imageSha256,signedAgain.imageSha256);assert.notEqual(first.packageSha256,signedAgain.packageSha256);
  assert.notEqual(B.packageAsset(first),B.packageAsset(signedAgain));
  const release=releaseFor(first),next=releaseFor(other,{...release.app,versionName:'9.0.1',versionCode:901});
  const entries=[release,next].map(release=>({release,manifestSha256:G.sha(G.canonical(release))}));
  assert.equal(G.validateHistory({schemaVersion:1,releases:entries},B).releases.length,2);
  assert.throws(()=>G.validateHistory({schemaVersion:1,releases:[entries[0],{release:releaseFor(other),manifestSha256:G.sha(G.canonical(releaseFor(other)))}]},B),/同一个 App/);
});
test('schema 2 loader requests only its one pinned compact package and enforces its layout limit',async()=>{
  const bytes=signedFixture({size:50000}),pkg=await verified(bytes),release=releaseFor(pkg),raw=G.canonical(release),calls=[];
  const loader=testBundle.createLoader({metadata:G.metadataFor(release,G.sha(raw)),crypto:crypto.webcrypto,baseUrl:'http://localhost/',
    fetch:async url=>{calls.push(url);return{ok:true,arrayBuffer:async()=>Uint8Array.from(url.endsWith('/release.json')?raw:bytes).buffer};}});
  const result=await loader.load();assert.equal(result.pkg.imageSize,50000);
  assert.deepEqual(calls,['http://localhost/assets/firmware/release.json','http://localhost/'+release.firmware.asset]);
});
async function temporaryRepo(fn){
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),'xiaobai-layout-release-'));
  try{
    for(const name of ['xiaobai-firmware-bundle.js','xiaobai-ota-protocol.js','firmware-releases.json','capacitor.config.json'])fs.copyFileSync(path.join(root,name),path.join(repo,name));
    const folder=path.join(repo,'android/app');fs.mkdirSync(folder,{recursive:true});
    const gradle=fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8').replace(/\bversionCode\s+\d+/,'versionCode 900').replace(/\bversionName\s+"[^"]+"/,'versionName "9.0.0"');
    fs.writeFileSync(path.join(folder,'build.gradle'),gradle);
    fs.mkdirSync(path.join(repo,'assets/firmware'),{recursive:true});
    return await fn(repo);
  }finally{
    const resolved=path.resolve(repo);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('xiaobai-layout-release-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
test('future new-App binding may target a signed older image but requires full planned identity',async()=>{
  const file=path.join(root,'tests/fixtures/firmware/xiaobai_py32_1.0.3.ota'),bytes=fs.readFileSync(file),pkg=await P.verifyPackage(bytes,{name:path.basename(file)});
  await temporaryRepo(async repo=>{
    const app=G.actualApp(repo),base={boardId:pkg.boardId,protocol:1,version:pkg.version},planFile=path.join(repo,'firmware-release-plan.json');
    const loaderFile=path.join(repo,'xiaobai-firmware-bundle.js'),before=fs.readFileSync(loaderFile);
    fs.writeFileSync(planFile,G.canonical({schemaVersion:1,app,firmware:base}));
    await assert.rejects(()=>G.bindPackage({repo,packageFile:file,expectedSha256:pkg.packageSha256}),/schema 2/);
    assert.deepEqual(fs.readFileSync(loaderFile),before);assert.equal(fs.readdirSync(path.join(repo,'assets/firmware')).length,0);
    const plan={schemaVersion:2,app,firmware:{...base,layoutId:1,imageSha256:'c'.repeat(64)}};
    fs.writeFileSync(planFile,G.canonical(plan));
    await assert.rejects(()=>G.bindPackage({repo,packageFile:file,expectedSha256:pkg.packageSha256}),/完全匹配/);
    assert.deepEqual(fs.readFileSync(loaderFile),before);assert.equal(fs.readdirSync(path.join(repo,'assets/firmware')).length,0);
    plan.firmware.imageSha256=pkg.imageSha256;fs.writeFileSync(planFile,G.canonical(plan));
    const result=await G.bindPackage({repo,packageFile:file,expectedSha256:pkg.packageSha256});
    assert.equal(result.release.schemaVersion,2);assert.equal(result.pkg.version,65539,'new App can deliberately bind older 1.0.3 after 1.0.4 history');
    assert.equal(result.release.firmware.layoutId,1);assert(result.release.firmware.asset.includes('_l1_'+pkg.imageSha256));
    const files=fs.readdirSync(path.join(repo,'assets/firmware'));assert.equal(files.filter(n=>n.endsWith('.ota')).length,1);
    const mapping=fs.readFileSync(result.releaseFile),pin=fs.readFileSync(loaderFile),history=fs.readFileSync(path.join(repo,'firmware-releases.json'));
    await G.bindPackage({repo,packageFile:file,expectedSha256:pkg.packageSha256});
    assert.deepEqual(fs.readFileSync(result.releaseFile),mapping);assert.deepEqual(fs.readFileSync(loaderFile),pin);assert.deepEqual(fs.readFileSync(path.join(repo,'firmware-releases.json')),history);
  });
});
