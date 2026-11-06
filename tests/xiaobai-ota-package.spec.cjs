'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const P=require('../xiaobai-ota-protocol.js');
const vectors=require('./fixtures/py32-ota-vectors.json');
let assertions=0;
const ok=(condition,message)=>{assert.ok(condition,message);assertions++;};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);assertions++;};
const throws=(fn,code)=>{assert.throws(fn,error=>error.code===code);assertions++;};
const rejected=async(fn,code,status)=>{await assert.rejects(fn,error=>error.code===code&&(status===undefined||error.status===status));assertions++;};
const h=P.unhex;
const fixture=P.concat(h(vectors.manifest_hex),h(vectors.payload_hex));
const verify=(bytes=fixture,extra={})=>P.verifyPackage(bytes,{name:'fixture.ota',publicKey:h(vectors.public_key_raw_hex),...extra});
function infoBytes(extra={}){
 const bytes=new Uint8Array(60),d=new DataView(bytes.buffer),v={protocol:1,boardId:0x102,bootVersion:0x10000,version:0x10000,mode:0,imageValid:true,state:0,lastError:0,imageSize:320,nextOffset:0,imageSha256:vectors.manifest_hex.slice(48,112),...extra};
 d.setUint32(0,P.C.OTA_INFO_MAGIC,true);d.setUint16(4,v.protocol,true);d.setUint16(6,v.boardId,true);d.setUint32(8,v.bootVersion,true);d.setUint32(12,v.version,true);
 bytes[16]=v.mode;bytes[17]=Number(v.imageValid);bytes[18]=v.state;bytes[19]=v.lastError;
 d.setUint32(20,v.imageSize,true);d.setUint32(24,v.nextOffset,true);bytes.set(h(v.imageSha256),28);return bytes;
}
function codec(){
 eq(P.crc32(Buffer.from('123456789')),0xcbf43926,'IEEE/zlib CRC32 independent known vector');
 eq(P.crc32([]),0,'empty CRC');
 eq(P.hex([0,1,254,255]),'0001feff');eq(P.unhex('0001FeFF'),Uint8Array.of(0,1,254,255));
 throws(()=>P.unhex('xyz'),'HEX');throws(()=>P.encodeFrame(-1,1),'FRAME');throws(()=>P.encodeFrame(256,1),'FRAME');
 throws(()=>P.encodeFrame(96,0x100000000),'FRAME');throws(()=>P.encodeFrame(96,1,new Uint8Array(161)),'FRAME');
 for(const v of vectors.frames){
  if(v.valid_frame){
   const encoded=P.encodeFrame(v.command,v.request_id,h(v.payload_hex)),decoded=P.decodeFrame(h(v.frame_hex));
   eq(P.hex(encoded),v.frame_hex,v.name+' golden bytes');eq(decoded.command,v.command);eq(decoded.requestId,v.request_id);eq(P.hex(decoded.payload),v.payload_hex);
   for(let split=1;split<encoded.length;split++){
    const received=[],receiver=new P.Receiver(f=>received.push(f));
    receiver.feed(encoded.subarray(0,split));eq(received.length,0,v.name+' partial frame');receiver.feed(encoded.subarray(split));eq(received.length,1,v.name+' any boundary');
    eq(P.hex(received[0].bytes),v.frame_hex);
   }
  }else{assert.throws(()=>P.decodeFrame(h(v.frame_hex)));assertions++;}
 }
 const valid=P.encodeFrame(0xe3,0xffffffff,[0,128,0,0,0]),received=[];let time=0;
 const receiver=new P.Receiver(f=>received.push(f),{now:()=>time});
 const corrupt=valid.slice();corrupt[12]^=1;
 receiver.feed(P.concat(new Uint8Array(20000).fill(0xff),corrupt,valid,valid));
 eq(received.length,2,'stream noise bad CRC plus coalesced frames');eq(receiver.buffer.length,0,'buffer emptied');
 receiver.feed(valid.subarray(0,10));time=1000;receiver.feed(valid);eq(received.length,3,'stale partial expires at 1 second');
 receiver.feed(valid.subarray(0,7));receiver.reset();receiver.feed(valid.subarray(7));eq(received.length,3,'reset does not reuse prior fragments');
 receiver.feed(new Uint8Array(100000).fill(0x58));ok(receiver.buffer.length<=176,'noise buffer bounded');
 const mixed=P.concat(P.encodeFrame(0x60,0),P.encodeFrame(0x63,3,new Uint8Array(132)),P.encodeFrame(0x64,4));
 const fragmented=[],r=new P.Receiver(f=>fragmented.push(f));for(let i=0;i<mixed.length;i+=20)r.feed(mixed.subarray(i,i+20));eq(fragmented.map(f=>f.command),[0x60,0x63,0x64],'real 20-byte chunk sizes');
 const payload=[1,2,3],encoded=P.encodeFrame(99,7,payload);payload[0]=9;eq(P.decodeFrame(encoded).payload[0],1,'caller payload not aliased');
}
async function packages(){
 const pkg=await verify();eq(pkg.versionText,'1.0.0');eq(pkg.imageSize,320);eq(pkg.packageSha256,vectors.package_sha256);eq(pkg.minBoot,0x10000);eq(pkg.minBootVersion,pkg.minBoot);ok(pkg.signatureVerified,'verified source');
 eq(P.hex(pkg.manifest),vectors.manifest_hex);eq(P.hex(pkg.image),vectors.payload_hex);
 eq(P.versionText(0xffffffff),'65535.255.255');throws(()=>P.versionText(-1),'VERSION');
 await rejected(()=>verify(fixture,{name:'固件.ota'}),'FILENAME');await rejected(()=>verify(fixture,{name:'firmware.hex'}),'FILENAME');
 await rejected(()=>verify(fixture,{name:'../../firmware.ota'}),'FILENAME');await rejected(()=>verify(fixture,{name:'a.ota\n'}),'FILENAME');
 await rejected(()=>verify(new Uint8Array(319)),'PACKAGE_SIZE',2);await rejected(()=>verify(new Uint8Array(P.C.OTA_APP_CAPACITY+129)),'PACKAGE_SIZE',2);
 await rejected(()=>verify(fixture.subarray(0,-1)),'PACKAGE_LENGTH',2);await rejected(()=>verify(P.concat(fixture,[0])),'PACKAGE_LENGTH',2);
 await rejected(()=>verify(fixture,{crypto:{}}),'CRYPTO_UNAVAILABLE');await rejected(()=>P.verifyPackage(fixture),'SIGNATURE',5);
 for(const v of vectors.manifest_cases){
  const data=P.concat(h(v.manifest_hex),h(v.payload_hex||vectors.payload_hex));
  if(v.name==='valid'){eq((await verify(data)).packageSha256,vectors.package_sha256);continue;}
  if(v.name==='future_boot'){
   const future=await verify(data);throws(()=>P.checkCompatibility(future,P.parseInfo(infoBytes())),'BOOT_VERSION');continue;
  }
  await assert.rejects(()=>verify(data),error=>error.status===v.expected_status,`${v.name} status ${v.expected_status}`);assertions++;
 }
 // Verify the platform receives the original 64-byte header and raw 64-byte r||s.
 let observed;
 const real=crypto.webcrypto.subtle,spy={subtle:{digest:(...a)=>real.digest(...a),importKey:(...a)=>real.importKey(...a),verify:(algorithm,key,signature,data)=>{observed={algorithm,signatureLength:signature.length,data:P.hex(data)};return real.verify(algorithm,key,signature,data);}}};
 await verify(fixture,{crypto:spy});eq(observed,{algorithm:{name:'ECDSA',hash:'SHA-256'},signatureLength:64,data:vectors.manifest_hex.slice(0,128)});
 // Mutating the caller's original Buffer while crypto awaits cannot alter verified output.
 const source=Buffer.from(fixture),promise=verify(source);source.fill(0);const owned=await promise;eq(owned.packageSha256,vectors.package_sha256);eq(P.hex(owned.manifest),vectors.manifest_hex);
}
async function infoAndPolicy(){
 const pkg=await verify(),raw=infoBytes(),info=P.parseInfo60(raw);
 eq(info.version,65536);eq(info.boardId,258);eq(info.imageValid,true);eq(info.mode,0);eq(info.supported,true);eq(info.imageSha256,pkg.imageSha256);
 const parts=Array.from({length:10},(_,i)=>P.concat([i],raw.subarray(i*6,i*6+6)));
 eq(P.assembleAppInfo([...parts].reverse()),info,'part assembly honors indices');
 throws(()=>P.assembleAppInfo(parts.slice(0,9)),'INFO_PART');throws(()=>P.assembleAppInfo([...parts,parts[0]]),'INFO_PART');
 const bad=parts.map(p=>p.slice());bad[0][0]=10;throws(()=>P.assembleAppInfo(bad),'INFO_PART');
 throws(()=>P.parseInfo60(raw.subarray(1)),'INFO_LENGTH');const magic=raw.slice();magic[0]=0;throws(()=>P.parseInfo60(magic),'INFO_MAGIC');
 for(const [offset,value] of [[16,2],[17,2],[18,3]]){const b=raw.slice();b[offset]=value;throws(()=>P.parseInfo60(b),'INFO_STATE');}
 const bounds=raw.slice();new DataView(bounds.buffer).setUint32(20,P.C.OTA_APP_CAPACITY+1,true);throws(()=>P.parseInfo60(bounds),'INFO_BOUNDS');
 eq(P.checkCompatibility(pkg,info),{alreadyPresent:true,needsWrite:false});eq(P.checkCompatibility(pkg,info,{repair:true}),{alreadyPresent:true,needsWrite:true});
 eq(P.checkCompatibility(pkg,{...info,version:pkg.version-1}),{alreadyPresent:false,needsWrite:true});
 eq(P.checkCompatibility(pkg,{...info,imageValid:false,version:pkg.version+1}),{alreadyPresent:false,needsWrite:true},'invalid recovery Boot has no persistent antirollback floor');
 throws(()=>P.checkCompatibility(pkg,{...info,version:pkg.version+1}),'DOWNGRADE');
 throws(()=>P.checkCompatibility(pkg,{...info,imageSha256:'0'.repeat(64)}),'VERSION_COLLISION');
 throws(()=>P.checkCompatibility(pkg,{...info,imageSize:321}),'VERSION_COLLISION');
 throws(()=>P.checkCompatibility(pkg,{...info,bootVersion:0}),'BOOT_VERSION');
 for(const extra of [{boardId:259},{protocol:2}]){const unsupported=P.parseInfo60(infoBytes(extra));eq(unsupported.supported,false);throws(()=>P.checkCompatibility(pkg,unsupported),'COMPATIBILITY');}
}
async function candidates(){
 const firmware=process.env.XIAOBAI_OTA_FIRMWARE_ROOT||path.resolve(__dirname,'../../../../5月/小白机器人/LBS-XIAOBAI-AI');
 if(!fs.existsSync(path.join(firmware,'Shared/Ota_Layout.h'))){console.log('External firmware checkout unavailable; fixed public fixtures passed.');return;}
 const {contract}=require('../scripts/sync-ota-contract.cjs'),authoritative=contract(firmware);
 eq(P.C,authoritative.values,'numeric snapshot equals authoritative C header');eq(P.PUBLIC_KEY_HEX,authoritative.key,'compiled public key equals firmware public key');
 const results=[];
 for(const version of ['1.0.0','1.0.1']){
  const target=path.join(firmware,'dist/ota',`py32_${version}`,`xiaobai_py32_${version}.ota`);
  if(!fs.existsSync(target))continue;
  const bytes=fs.readFileSync(target),verified=await P.verifyPackage(bytes,{name:path.basename(target)});
  eq(verified.versionText,version);eq(verified.imageSha256,crypto.createHash('sha256').update(bytes.subarray(128)).digest('hex'));eq(verified.packageSha256,crypto.createHash('sha256').update(bytes).digest('hex'));
  results.push({path:target,bytes:bytes.length,version,boardId:verified.boardId,imageSize:verified.imageSize,imageSha256:verified.imageSha256,packageSha256:verified.packageSha256,publicKey:P.PUBLIC_KEY_HEX,signatureVerified:true});
 }
 ok(results.length>=1,'actual signed candidate verified against the fixed firmware public key');
 console.log(JSON.stringify({signedCandidates:results},null,2));
}
(async()=>{codec();await packages();await infoAndPolicy();await candidates();console.log(`OTA package/codec: ${assertions} assertions passed (software only, no device access).`);})().catch(error=>{console.error(error);process.exitCode=1;});
