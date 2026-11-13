'use strict';
// Production Session + protocol, real signatures using an ephemeral test key.
// The adapter/Boot and monotonic device status clock are synthetic; no hardware.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const P=require('../xiaobai-ota-protocol.js');
const keys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk=keys.publicKey.export({format:'jwk'});
const publicKey=Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('hex');
const verifiedProtocol={...P,verifyPackage:(bytes,options)=>P.verifyPackage(bytes,{...options,publicKey,crypto:crypto.webcrypto})};
const sandbox={module:{exports:{}},require:()=>verifiedProtocol,performance,crypto:crypto.webcrypto,setTimeout,clearTimeout,Uint8Array,Uint32Array};
vm.runInNewContext(fs.readFileSync(require.resolve('../xiaobai-ota.js'),'utf8'),sandbox,{filename:'xiaobai-ota.js:dual-layout-test'});
const {Session,targetOf,confirmIdentity}=sandbox.module.exports;
const uid='0102030405060708090a0b0c',deviceId='original-device';
const copy=value=>JSON.parse(JSON.stringify(value));
const le32=n=>Uint8Array.of(n&255,n>>>8&255,n>>>16&255,n>>>24&255);
const number=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0,true);

async function pkg({layoutId=1,version=0x10004,seed=5,size=256}={}){
  const layout=P.LAYOUTS[layoutId],image=new Uint8Array(size).fill(seed),m=new Uint8Array(128);
  const iv=new DataView(image.buffer),d=new DataView(m.buffer);
  iv.setUint32(0,0x20001000,true);iv.setUint32(4,layout.appBase+193,true);
  d.setUint32(0,P.C.OTA_MANIFEST_MAGIC,true);d.setUint16(4,layout.format,true);d.setUint16(6,258,true);
  d.setUint32(8,version,true);d.setUint32(12,size,true);d.setUint32(16,layout.appBase,true);d.setUint32(20,layout.minBootVersion,true);
  m.set(crypto.createHash('sha256').update(image).digest(),24);
  if(layoutId===2){d.setUint32(56,2,true);d.setUint32(60,128,true);}
  m.set(crypto.sign('sha256',m.subarray(0,64),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}),64);
  return verifiedProtocol.verifyPackage(P.concat(m,image),{name:'fixture.ota'});
}
function infoOf(p,mode,extra={}){
  const layout=P.layoutOf(p);
  return {protocol:1,schemaVersion:2,boardId:258,version:p.version,bootVersion:0x20000,mode,imageValid:true,state:0,lastError:0,
    imageSize:p.imageSize,nextOffset:0,imageSha256:p.imageSha256,layoutId:layout.id,activeAppBase:layout.appBase,erasePage:128,capabilities:15,supported:true,...extra};
}
function encodedInfo(i){
  const b=new Uint8Array(i.schemaVersion===1?60:72),d=new DataView(b.buffer);
  d.setUint32(0,P.C.OTA_INFO_MAGIC,true);d.setUint16(4,i.schemaVersion,true);d.setUint16(6,i.boardId,true);
  d.setUint32(8,i.bootVersion,true);d.setUint32(12,i.version,true);b.set([i.mode,+i.imageValid,i.state,i.lastError],16);
  d.setUint32(20,i.imageSize,true);d.setUint32(24,i.nextOffset,true);b.set(P.unhex(i.imageSha256),28);
  if(b.length===72){d.setUint32(60,i.layoutId,true);d.setUint32(64,i.activeAppBase,true);d.setUint16(68,i.erasePage,true);d.setUint16(70,i.capabilities,true);}
  return b;
}
function fixture(current,target,{boot={},app={},pending=null,written=false}={}){
  let clock=1000,epoch='initial',seq=0,connected=true,appAvailable=true,currentPkg=current,mode=0,receiving=false,offset=0;
  let bootInfo=infoOf(current,1,boot);
  const log=[],records=[],values=new Map(),listeners=new Set(),disconnects=new Set();
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>{values.set(k,v);records.push({at:log.length,record:JSON.parse(v)});}};
  if(pending)storage.setItem('xiaobai:ota:binding:v1',JSON.stringify({uid,deviceId,pending,written}));
  const transport={connectionId:'boot-channel',subscribe:fn=>(listeners.add(fn),()=>listeners.delete(fn)),onDisconnect:fn=>(disconnects.add(fn),()=>disconnects.delete(fn)),async write(bytes){
    const f=P.decodeFrame(bytes);log.push({op:f.command});let response;
    if(f.command===P.OP.INFO)response=P.concat([0],encodedInfo(bootInfo));
    else if(f.command===P.OP.BEGIN){receiving=true;offset=0;bootInfo={...bootInfo,imageValid:false,state:1};response=P.concat([0],le32(0));}
    else if(f.command===P.OP.DATA){assert.equal(number(f.payload),offset);offset+=f.payload.length-4;response=P.concat([0],le32(offset));}
    else if(f.command===P.OP.FINISH){
      assert.ok(receiving||bootInfo.state===0&&bootInfo.imageValid,'empty FINISH is safe only before BEGIN or after a complete transfer');
      if(receiving){assert.equal(offset,target.imageSize);currentPkg=target;bootInfo=infoOf(target,1,boot);receiving=false;}
      appAvailable=true;mode=0;response=P.concat([0],le32(currentPkg.imageSize));
    }else throw Error('unexpected Boot operation');
    const encoded=P.encodeFrame(f.command|128,f.requestId,response);for(const fn of listeners)fn(encoded);
  }};
  const adapter={async prepare(){log.push({kind:'prepare'});},async release(){log.push({kind:'release'});},
    async readApp(){assert.ok(connected);assert.ok(appAvailable);return {uid,deviceId,epoch,name:'fixture',info:infoOf(currentPkg,0,currentPkg===current?app:{})};},
    async queryStatus(){log.push({kind:'status'});const sentAt=clock;clock+=600;return {epoch,seq:++seq,opcode:4,result:0,sentAt,receivedAt:sentAt+1,data:[0,40,40,40,60,15,0]};},
    async enterBoot(){log.push({kind:'enter'});connected=false;appAvailable=false;mode=1;return transport;},
    async connectBoot(){log.push({kind:'connectBoot'});mode=1;return transport;},
    async connectApp(){log.push({kind:'connectApp'});if(!appAvailable)throw Object.assign(Error('Boot only'),{code:'TIMEOUT'});connected=true;epoch='reconnected-'+seq;mode=0;return this.readApp();},
    async disconnect(){connected=false;log.push({kind:'disconnect'});for(const fn of disconnects)fn();},traceOta(){}
  };
  const session=new Session(adapter,{storage,clock:()=>clock,timing:{requestMs:20,beginMs:20,finishMs:20,retries:0,bootWaitMs:100,healthGapMs:0,restartMs:0,healthDeadlineMs:10000}});
  return {session,adapter,log,records,storage,count:op=>log.filter(e=>e.op===op).length,get current(){return currentPkg;},get mode(){return mode;}};
}
async function start(f,target,options){await f.session.choose(target.bytes,'fixture.ota');return f.session.start(options);}

test('legacy App compiled Boot 1.0.1 can enter actual Boot 2 and install compact layout only after fresh INFO',async()=>{
  const old=await pkg(),target=await pkg({layoutId:2,version:0x20000});
  const f=fixture(old,target,{app:{schemaVersion:1,bootVersion:0x10001}});
  await start(f,target);
  assert.equal(f.session.state.phase,'success');assert.equal(f.session.state.info.layoutId,2);assert.equal(f.session.binding.pending,null);
  assert.equal(f.count(P.OP.BEGIN),1);assert.ok(f.log.findIndex(e=>e.op===P.OP.INFO)<f.log.findIndex(e=>e.op===P.OP.BEGIN));
});
test('new Boot permits downgrade across compact-to-legacy layouts',async()=>{
  const old=await pkg({layoutId:2,version:0x20001}),target=await pkg({version:0x10004});const f=fixture(old,target);
  await start(f,target);assert.equal(f.current.version,target.version);assert.equal(f.current.layoutId,1);assert.equal(f.count(P.OP.BEGIN),1);
});
test('same version different hash is a real write rather than already installed',async()=>{
  const old=await pkg({layoutId:2,version:0x20000,seed:3}),target=await pkg({layoutId:2,version:0x20000,seed:8});const f=fixture(old,target);
  const result=await start(f,target);assert.equal(result.written,true);assert.equal(f.count(P.OP.BEGIN),1);assert.equal(f.current.imageSha256,target.imageSha256);
});
test('old Boot rejects compact target before BEGIN and safely returns its valid App',async()=>{
  const old=await pkg(),target=await pkg({layoutId:2,version:0x20000});const f=fixture(old,target,{boot:{schemaVersion:1,bootVersion:0x10001}});
  await assert.rejects(start(f,target),e=>['BOOT_VERSION','BOOT_LAYOUT','LAYOUT_MIGRATION_REQUIRED'].includes(e.code)&&e.bootExited===true);
  assert.equal(f.count(P.OP.BEGIN),0);assert.equal(f.count(P.OP.DATA),0);assert.equal(f.count(P.OP.FINISH),1);assert.equal(f.current,old);assert.equal(f.session.binding.pending,null);assert.equal(f.mode,0);
});
test('actual Boot capabilities govern same-version rewrite, never App-reported caps',async()=>{
  const old=await pkg({version:0x10004,seed:3}),target=await pkg({version:0x10004,seed:8});const f=fixture(old,target,{boot:{capabilities:1},app:{capabilities:15}});
  await assert.rejects(start(f,target),e=>e.code==='BOOT_CAPABILITY'&&e.bootExited===true);
  assert.equal(f.count(P.OP.BEGIN),0);assert.equal(f.count(P.OP.DATA),0);assert.equal(f.count(P.OP.FINISH),1);
});
test('incompatible Boot with an invalid active image never sends empty FINISH as a false cancellation',async()=>{
  const old=await pkg(),target=await pkg({layoutId:2,version:0x20000});const f=fixture(old,target,{boot:{schemaVersion:1,bootVersion:0x10001,imageValid:false}});
  await assert.rejects(start(f,target),e=>['BOOT_VERSION','BOOT_LAYOUT'].includes(e.code)&&!e.bootExited);
  assert.equal(f.count(P.OP.BEGIN),0);assert.equal(f.count(P.OP.DATA),0);assert.equal(f.count(P.OP.FINISH),0);assert.ok(f.session.binding.pending);assert.equal(f.session.state.phase,'recovery');
});
test('historical higher-version pending is confirmed and cleared before an explicitly selected downgrade',async()=>{
  const old=await pkg({layoutId:2,version:0x20005}),target=await pkg({version:0x10004});const f=fixture(old,target,{pending:targetOf(old),written:false});
  await start(f,target,{recovery:true});const begin=f.log.findIndex(e=>e.op===P.OP.BEGIN);
  assert.ok(f.records.some(r=>r.record.pending===null&&r.at<begin));assert.ok(f.log.slice(0,begin).filter(e=>e.kind==='status').length>=2);
  assert.equal(f.count(P.OP.BEGIN),1);assert.equal(f.session.binding.pending,null);
});
test('matching actual target clears lost-ACK written=false pending through health confirmation without Boot',async()=>{
  const target=await pkg({layoutId:2,version:0x20000}),f=fixture(target,target,{pending:targetOf(target),written:false});
  await start(f,target,{recovery:true});assert.equal(f.session.binding.pending,null);assert.equal(f.count(P.OP.INFO),0);assert.equal(f.count(P.OP.BEGIN),0);assert.equal(f.log.filter(e=>e.kind==='status').length,2);
});
test('unhealthy historical completion retains its record and cannot fall through to a new download',async()=>{
  const old=await pkg({layoutId:2,version:0x20005}),target=await pkg({version:0x10004}),pending=targetOf(old);const f=fixture(old,target,{pending,written:false});
  const original=f.adapter.queryStatus;f.adapter.queryStatus=async()=>{const value=await original();value.data[6]=8;return value;};
  await assert.rejects(start(f,target,{recovery:true}),e=>e.code==='FAULT');assert.equal(f.count(P.OP.BEGIN),0);assert.equal(f.count(P.OP.INFO),0);assert.deepEqual(copy(f.session.binding.pending),copy(pending));
});
test('legacy schema-1 Boot still installs an original format-1 upgrade',async()=>{
  const old=await pkg({version:0x10000}),target=await pkg({version:0x10004});const f=fixture(old,target,{boot:{schemaVersion:1,bootVersion:0x10001}});
  await start(f,target);assert.equal(f.count(P.OP.BEGIN),1);assert.equal(f.current.layoutId,1);
});
test('pending capacity and identity distinguish old unlabeled legacy records and compact records',async()=>{
  const target=await pkg(),record=copy(targetOf(target));delete record.layoutId;
  let f=fixture(target,target,{pending:record});assert.equal(f.session.binding.pending.layoutId,1);
  f=fixture(target,target,{pending:{...record,imageSize:46000}});assert.equal(f.session.binding,null,'unlabeled old record cannot borrow compact capacity');
  f=fixture(target,target,{pending:{...record,layoutId:2,imageSize:46000}});assert.equal(f.session.binding.pending.layoutId,2);
  f=fixture(target,target,{pending:{...record,layoutId:3}});assert.equal(f.session.binding,null);
});
test('startup proof cannot identify equal version/hash/size at a different layout as the target',async()=>{
  const target=await pkg({layoutId:2,version:0x20000});const actual={uid,deviceId,epoch:'live',info:infoOf(target,0,{layoutId:1,activeAppBase:P.LAYOUTS[1].appBase})};
  assert.throws(()=>confirmIdentity(actual,{uid,deviceId},target),e=>e.code==='IDENTITY');
});
