'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const test=require('node:test'),P=require('../xiaobai-ota-protocol.js');
// Independent ephemeral test-only signer. Nothing is written to assets or .ota files.
const keys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=keys.publicKey.export({format:'jwk'});
const publicKey=Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
function signed({format=2,version=0x20000,size=320,seed=3,minBoot=format===2?0x20000:0x10000,...patch}={}){
 const image=Buffer.alloc(size,seed),layout=P.LAYOUTS[format];
 image.writeUInt32LE(P.C.OTA_RAM_LIMIT,0);image.writeUInt32LE(layout.appBase+193,4);
 const manifest=Buffer.alloc(128);manifest.writeUInt32LE(P.C.OTA_MANIFEST_MAGIC,0);manifest.writeUInt16LE(format,4);
 manifest.writeUInt16LE(258,6);manifest.writeUInt32LE(version,8);manifest.writeUInt32LE(size,12);
 manifest.writeUInt32LE(patch.appBase??layout.appBase,16);manifest.writeUInt32LE(minBoot,20);
 crypto.createHash('sha256').update(image).digest().copy(manifest,24);
 if(format===2){manifest.writeUInt32LE(patch.layoutId??2,56);manifest.writeUInt32LE(patch.erasePage??128,60);}
 crypto.sign('sha256',manifest.subarray(0,64),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).copy(manifest,64);
 return Buffer.concat([manifest,image]);
}
const verify=bytes=>P.verifyPackage(bytes,{name:'layout-fixture.ota',publicKey});
function infoBytes(pkg,{schema=2,mode=1,boardId=258,bootVersion=0x20000,capabilities=15,...patch}={}){
 const b=Buffer.alloc(schema===1?60:72),layout=P.layoutOf(pkg);
 b.writeUInt32LE(P.C.OTA_INFO_MAGIC,0);b.writeUInt16LE(schema,4);b.writeUInt16LE(boardId,6);
 b.writeUInt32LE(bootVersion,8);b.writeUInt32LE(pkg.version,12);b.set([mode,1,0,0],16);
 b.writeUInt32LE(pkg.imageSize,20);Buffer.from(pkg.imageSha256,'hex').copy(b,28);
 if(schema!==1){b.writeUInt32LE(patch.layoutId??layout.id,60);b.writeUInt32LE(patch.appBase??layout.appBase,64);b.writeUInt16LE(patch.erasePage??128,68);b.writeUInt16LE(capabilities,70);}
 return b;
}
const info=(pkg,options)=>P.parseInfo(infoBytes(pkg,options));
const rejectsCode=(fn,code)=>assert.rejects(fn,e=>e.code===code);
const throwsCode=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('real signatures preserve legacy base and accept compact signed layout without rewriting bytes',async()=>{
 const legacyBytes=signed({format:1}),compactBytes=signed(),legacy=await verify(legacyBytes),compact=await verify(compactBytes);
 assert.equal(legacy.layoutId,1);assert.equal(legacy.appBase,0x08004000);assert.equal(legacy.format,1);
 assert.equal(compact.layoutId,2);assert.equal(compact.appBase,0x08003000);assert.equal(compact.erasePage,128);assert.equal(compact.format,2);
 assert.deepEqual(Buffer.from(legacy.bytes),legacyBytes);assert.deepEqual(Buffer.from(compact.bytes),compactBytes);
 assert.equal(P.LAYOUTS[1].capacity,45056);assert.equal(P.LAYOUTS[2].capacity,52992);
 const large=await verify(signed({size:52992}));assert.equal(large.imageSize,52992);
 await rejectsCode(()=>verify(signed({format:1,size:45057})),'MANIFEST_BOUNDS');
 await rejectsCode(()=>verify(signed({appBase:0x08004000})),'MANIFEST');
 await rejectsCode(()=>verify(signed({erasePage:4096})),'MANIFEST');
 await rejectsCode(()=>verify(signed({layoutId:1})),'MANIFEST');
 await rejectsCode(()=>verify(signed({minBoot:0x10001})),'VERSION');
 const changed=Buffer.from(compactBytes);changed[56]=1;await rejectsCode(()=>verify(changed),'MANIFEST');
 const wrongSignature=Buffer.from(compactBytes);wrongSignature[90]^=1;await rejectsCode(()=>verify(wrongSignature),'SIGNATURE');
 const wrongImage=Buffer.from(compactBytes);wrongImage[250]^=1;await rejectsCode(()=>verify(wrongImage),'IMAGE_HASH');
});

test('INFO wire1 schema1/2 has exact dynamic lengths, ordered parts, signed layouts and bounds',async()=>{
 const legacy=await verify(signed({format:1})),compact=await verify(signed());
 for(const [pkg,schema]of [[legacy,1],[legacy,2],[compact,2]]){
  const raw=infoBytes(pkg,{schema}),parts=Array.from({length:raw.length/6},(_,i)=>P.concat([i],raw.subarray(i*6,i*6+6)));
  const actual=P.parseInfo(raw);assert.equal(actual.protocol,1);assert.equal(actual.schemaVersion,schema);assert.equal(actual.layoutId,pkg.layoutId);
  assert.equal(P.appInfoPartsFromFirstPart(parts[0]),schema===1?10:12);
  assert.deepEqual(P.assembleAppInfo(parts.slice().reverse()),actual);
  assert.equal(P.sameTarget(pkg,actual),true);
  throwsCode(()=>P.assembleAppInfo(parts.slice(0,-1)),'INFO_PART');
  throwsCode(()=>P.assembleAppInfo([...parts,parts[0]]),'INFO_PART');
  throwsCode(()=>P.parseInfo(raw.subarray(0,raw.length-1)),'INFO_LENGTH');
 }
 const malformed=infoBytes(compact);malformed.writeUInt32LE(1,60);throwsCode(()=>P.parseInfo(malformed),'LAYOUT_UNKNOWN');
 throwsCode(()=>P.parseInfo(infoBytes(compact,{erasePage:4096})),'LAYOUT_UNKNOWN');
 const unknown=infoBytes(compact);unknown.writeUInt16LE(3,4);throwsCode(()=>P.parseInfo(unknown),'INFO_SCHEMA');
 throwsCode(()=>P.appInfoPartsFromFirstPart(P.concat([0],unknown.subarray(0,6))),'INFO_SCHEMA');
 const oversized=infoBytes(legacy,{schema:1});oversized.writeUInt32LE(45057,20);throwsCode(()=>P.parseInfo(oversized),'INFO_BOUNDS');
 const v2=info(compact);assert.equal(P.sameTarget(compact,{...v2,layoutId:1}),false);
 assert.equal(P.sameTarget(compact,{...v2,imageSha256:'0'.repeat(64)}),false);
 assert.equal(P.sameTarget({},{}),false);assert.equal(P.sameTarget({...compact,imageSha256:undefined},{...compact,imageSha256:undefined}),false);
});

test('only actual Boot capabilities decide downgrade, same-version rewrite and layout migration before BEGIN',async()=>{
 const target=await verify(signed({version:0x20000})),old=await verify(signed({format:1,version:0x10004}));
 assert.deepEqual(P.checkCompatibility(target,info(target)),{alreadyPresent:true,needsWrite:false});
 assert.deepEqual(P.checkCompatibility(target,info(target),{repair:true}),{alreadyPresent:true,needsWrite:true});
 assert.deepEqual(P.checkCompatibility(target,{...info(target),version:0x30000}),{alreadyPresent:false,needsWrite:true});
 assert.deepEqual(P.checkCompatibility(target,{...info(target),imageSha256:'0'.repeat(64)}),{alreadyPresent:false,needsWrite:true});
 assert.deepEqual(P.checkCompatibility(old,info(target)),{alreadyPresent:false,needsWrite:true});
 const app={...info(old,{schema:1,mode:0,bootVersion:0x10000})};
 assert.deepEqual(P.checkCompatibility(target,app),{alreadyPresent:false,needsWrite:true},'compiled legacy App BootVersion cannot veto a real Boot probe');
 throwsCode(()=>P.checkCompatibility(target,{...app,mode:1}),'BOOT_VERSION');
 throwsCode(()=>P.checkCompatibility(target,info(target,{capabilities:1})),'BOOT_LAYOUT');
 throwsCode(()=>P.checkCompatibility(target,{...info(target),capabilities:undefined}),'BOOT_CAPABILITY');
 throwsCode(()=>P.checkCompatibility(target,{...info(target),activeAppBase:undefined}),'LAYOUT_UNKNOWN');
 assert.equal(P.sameTarget(target,{...info(target),activeAppBase:undefined}),false);
 throwsCode(()=>P.checkCompatibility(target,{...info(target),bootVersion:0}),'BOOT_UNKNOWN');
 throwsCode(()=>P.checkCompatibility(target,{...info(target,{capabilities:3}),version:0x30000}),'BOOT_CAPABILITY');
 throwsCode(()=>P.checkCompatibility(target,{...info(target,{capabilities:7}),imageSha256:'0'.repeat(64)}),'BOOT_CAPABILITY');
 throwsCode(()=>P.checkCompatibility(target,info(target,{boardId:259})),'COMPATIBILITY');
});

test('production App INFO reader probes part0 then requests exactly 10 or 12 fresh parts',async()=>{
 const code=fs.readFileSync(require.resolve('../android-bluetooth.js'),'utf8');
 const first=code.indexOf('    async readApp({guard=()=>true,signal}={}){'),last=code.indexOf('    async queryStatus(){',first);
 assert(first>=0&&last>first,'shipping readApp section');
 const method=code.slice(first,last),pkg=await verify(signed({format:1}));
 async function read(schema){
  const records=[],requests=[],raw=infoBytes(pkg,{schema}),current={connectionId:'epoch',deviceId:'device'},link={closed:false,mode:4,nextSeq:()=>1};
  link.request=async(seq,opcode,args)=>{
   if(opcode===4)return[4,50,50,50,0x74,0x0e,0];
   if(opcode===0x60){requests.push(args[0]);return P.concat([args[0]],raw.subarray(args[0]*6,args[0]*6+6));}
   if(opcode===0x56)return[args[0],1,2,3,4,5,6];throw Error('unexpected opcode');
  };
  const sandbox={current,link,protocol:{OP:{QUERY_STATUS:4,READ_UID:0x56}},XiaobaiOtaProtocol:P,nameOf:()=> 'fixture',rememberAppUid:(uid,deviceId)=>records.push({uid,deviceId})};
  const promise=vm.runInNewContext(`({${method}}).readApp()`,sandbox);
  try{return{requests,result:await promise,records};}catch(error){error.requests=requests;throw error;}
 }
 for(const schema of [1,2]){const r=await read(schema);assert.deepEqual(r.requests,Array.from({length:schema===1?10:12},(_,i)=>i));assert.equal(r.result.info.schemaVersion,schema);assert.deepEqual(r.records,[{uid:'010203040506010203040506',deviceId:'device'}]);}
 await assert.rejects(()=>read(3),e=>e.code==='INFO_SCHEMA'&&JSON.stringify(e.requests)==='[0]', 'unknown schema fails immediately without trailing parts or a whole-identity retry');
});
