(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./xiaobai-ota-protocol.js'):root.XiaobaiOtaProtocol);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.XiaobaiFirmwareBundle=api;
})(globalThis,function(P){
  'use strict';
  const immutable=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;};
  // This pin is generated only when a signed package is bound to a new App release.
  // BEGIN GENERATED FIRMWARE RELEASE PIN
  const METADATA=immutable({"bound":true,"app":{"applicationId":"com.xiaobai.remote","versionName":"1.2.10","versionCode":16},"firmware":{"boardId":258,"protocol":1,"version":65539},"manifestSha256":"94ad4838bb1d29ceee8b03865e8a0ebfcb7744dd5882ed0ce051d5c50d7848f0"});
  // END GENERATED FIRMWARE RELEASE PIN
  const MANIFEST_ASSET='assets/firmware/release.json';
  const HASH=/^[0-9a-f]{64}$/;
  const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
  const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
  const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(value,k));
  const uint=(n,max=0xffffffff)=>Number.isInteger(n)&&n>=0&&n<=max;
  function validateApp(app){
    if(!exactKeys(app,['applicationId','versionName','versionCode'])||!/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(app.applicationId)||!/^\d+\.\d+\.\d+$/.test(app.versionName)||!uint(app.versionCode,0x7fffffff)||app.versionCode===0)
      fail('RELEASE_APP','App 发布身份格式无效。');
    return app;
  }
  function validateRelease(release,metadata=METADATA){
    if(!exactKeys(release,['schemaVersion','app','firmware'])||release.schemaVersion!==1)fail('RELEASE_SCHEMA','内置固件发布映射格式无效。');
    const app=validateApp(release.app),f=release.firmware;
    if(!exactKeys(f,['boardId','protocol','version','versionName','minBootVersion','imageSize','imageSha256','packageSize','packageSha256','asset'])||
       f.boardId!==P.C.OTA_BOARD_ID||f.protocol!==P.C.OTA_PROTOCOL_VERSION||!uint(f.version)||!f.version||f.versionName!==P.versionText(f.version)||!uint(f.minBootVersion)||
       !uint(f.imageSize,P.C.OTA_APP_CAPACITY)||f.imageSize<192||f.packageSize!==f.imageSize+P.C.OTA_MANIFEST_SIZE||!HASH.test(f.imageSha256)||!HASH.test(f.packageSha256)||
       f.asset!==`assets/firmware/xiaobai_py32_${f.versionName}.ota`)
      fail('RELEASE_FIRMWARE','内置固件发布信息不完整或不受支持。');
    if(!metadata?.bound||!HASH.test(metadata.manifestSha256||''))fail('FIRMWARE_MISSING','此 App 尚未绑定正式签名固件，请使用完整安装包。');
    if(Object.keys(app).some(k=>app[k]!==metadata.app?.[k])||f.boardId!==metadata.firmware?.boardId||f.protocol!==metadata.firmware?.protocol||f.version!==metadata.firmware?.version)
      fail('RELEASE_IDENTITY','内置固件不属于当前 App 版本。');
    return release;
  }
  async function verify(releaseBytes,packageBytes,{metadata=METADATA,crypto=globalThis.crypto,appInfo=null}={}){
    if(!crypto?.subtle)fail('CRYPTO_UNAVAILABLE','系统无法校验内置固件，请更新 Android 系统组件。');
    const raw=Uint8Array.from(P.asBytes(releaseBytes));
    if(!raw.length||raw.length>16384)fail('RELEASE_SIZE','内置固件发布映射大小无效。');
    const manifestSha256=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)));
    if(manifestSha256!==metadata.manifestSha256)fail('RELEASE_HASH','内置固件发布映射已变化，不能继续。');
    let release;try{release=JSON.parse(new TextDecoder().decode(raw));}catch{fail('RELEASE_SCHEMA','内置固件发布映射无法读取。');}
    validateRelease(release,metadata);
    if(appInfo){
      const actual={applicationId:appInfo.applicationId??appInfo.id,versionName:appInfo.versionName??appInfo.version,versionCode:Number(appInfo.versionCode??appInfo.build)};
      if(Object.keys(actual).some(k=>actual[k]!==release.app[k]))fail('RELEASE_IDENTITY','内置固件与实际安装的 App 版本不一致。');
    }
    const bytes=Uint8Array.from(P.asBytes(packageBytes)),f=release.firmware;
    if(bytes.length!==f.packageSize)fail('BUNDLE_SIZE','内置固件长度与发布映射不一致。');
    const pkg=await P.verifyPackage(bytes,{name:f.asset.split('/').at(-1),crypto});
    if(pkg.boardId!==f.boardId||pkg.version!==f.version||pkg.minBootVersion!==f.minBootVersion||pkg.imageSize!==f.imageSize||pkg.imageSha256!==f.imageSha256||pkg.packageSha256!==f.packageSha256)
      fail('BUNDLE_IDENTITY','内置固件内容与当前 App 发布映射不一致。');
    return{release:immutable(release),pkg,manifestSha256};
  }
  function createLoader({fetch:fetcher=globalThis.fetch,baseUrl=globalThis.document?.baseURI??'http://localhost/',crypto=globalThis.crypto,metadata=METADATA}={}){
    let inFlight=null;
    async function bytes(asset,max){
      const response=await fetcher(new URL(asset,baseUrl).href,{cache:'no-store',credentials:'same-origin'});
      if(!response?.ok)fail('FIRMWARE_MISSING','内置固件缺失，请重新安装完整 App。');
      const value=new Uint8Array(await response.arrayBuffer());if(!value.length||value.length>max)fail('BUNDLE_SIZE','内置固件资源大小无效。');return value;
    }
    return{async load({appInfo=null}={}){
      if(!metadata.bound)fail('FIRMWARE_MISSING','此 App 尚未绑定正式签名固件，请使用完整安装包。');
      if(!inFlight)inFlight=(async()=>{
        const releaseBytes=await bytes(MANIFEST_ASSET,16384);
        let release;try{release=JSON.parse(new TextDecoder().decode(releaseBytes));}catch{fail('RELEASE_SCHEMA','内置固件发布映射无法读取。');}
        validateRelease(release,metadata);
        const packageBytes=await bytes(release.firmware.asset,P.C.OTA_MANIFEST_SIZE+P.C.OTA_APP_CAPACITY);
        return{releaseBytes,packageBytes};
      })().catch(e=>{inFlight=null;throw e;});
      const cached=await inFlight;
      // Fresh copies and verification for each caller prevent edited Uint8Array data being reused.
      return verify(cached.releaseBytes,cached.packageBytes,{metadata,crypto,appInfo});
    }};
  }
  const defaultLoader=createLoader();
  return{METADATA,MANIFEST_ASSET,validateApp,validateRelease,verify,createLoader,load:options=>defaultLoader.load(options)};
});
