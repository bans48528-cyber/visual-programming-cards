'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../xiaobai-ota-protocol.js'),{BootClient,Session}=require('../xiaobai-ota.js');
const uid='a0a1a2a3a4a5a6a7a8a9aaab',other='b0b1b2b3b4b5b6b7b8b9babb',oldMac='DC:B0:DC:30:78:0E',newMac='EC:B0:DC:30:78:0E';
function setup(t,{payload=P.concat([0],P.unhex(uid)),requestId,corrupt=false,disconnect=false,deviceId=newMac,beforeReply=()=>{}}={}){
 let receive,lost;const sent=[];
 const transport={connectionId:'fresh-write',deviceId,subscribe(fn){receive=fn;return()=>{};},onDisconnect(fn){lost=fn;return()=>{};},async write(bytes){const req=P.decodeFrame(bytes);sent.push(req);if(disconnect){lost();return;}let frame=P.encodeFrame(req.command|128,requestId??req.requestId,payload);if(corrupt){frame=frame.slice();frame[12]^=1;}beforeReply();receive(frame);}};
 const client=new BootClient(transport,{firstRequestId:511,timing:{requestMs:12,retries:0}});t.after(()=>client.close());return {client,sent,transport};
}
test('GET_UID matches authoritative current C request/reply511 and raw UID byte order',async t=>{
 assert.equal(P.OP.GET_UID,0x65);assert.equal(P.hex(P.encodeFrame(P.OP.GET_UID,511)),'58424f5401650000ff010000fe096a45');
 const raw=P.unhex('58424f5401e50d00ff010000e2935aa100a0a1a2a3a4a5a6a7a8a9aaab'),decoded=P.decodeFrame(raw);
 assert.equal(decoded.command,0xe5);assert.equal(decoded.requestId,511);assert.equal(P.hex(decoded.payload), '00'+uid);
 const f=setup(t);assert.equal(await f.client.uid(),uid);assert.equal(f.sent.length,1);assert.equal(f.sent[0].payload.length,0);
});
test('matched old unknown-op reply is UID_UNSUPPORTED only as an offline negative codec vector',async t=>{
 const negative=P.decodeFrame(P.unhex('58424f5401e50500ff010000df3330ef0200000000'));
 const f=setup(t,{payload:negative.payload});await assert.rejects(f.client.uid(),e=>e.code==='UID_UNSUPPORTED'&&e.status===2);
});
for(const length of [1,2,12,14,16])test('UID status0 length '+length+' cannot establish device identity',async t=>{
 const f=setup(t,{payload:new Uint8Array(length)});await assert.rejects(f.client.uid(),{code:'UID_LENGTH'});
});
for(const [name,options]of [['old request ID',{requestId:510}],['bad CRC',{corrupt:true}],['empty response',{payload:new Uint8Array()}]])test(name+' cannot satisfy current UID request',async t=>{
 const f=setup(t,options);await assert.rejects(f.client.uid(),{code:'TIMEOUT'});assert.equal(f.sent.length,1);
});
test('channel disconnect cancels UID; transport acceptance is never identity success',async t=>{
 const f=setup(t,{disconnect:true});await assert.rejects(f.client.uid(),{code:'DISCONNECTED'});
});
const binding={uid,deviceId:oldMac},proof={kind:'boot',deviceId:newMac,epoch:'retired-probe',uid,uidSupported:true,verifiedLocator:true,verification:'boot-uid',retired:true,info:{mode:1,bootVersion:0x020002}};
function verifier(t,options){const f=setup(t,options),session=new Session({});session.generation=1;session.client=f.client;return {...f,session};}
test('fresh write connection rechecks UID on Boot2.0.2 even for a formerly verified locator',async t=>{
 const f=verifier(t);await f.session.verifyBootIdentity(1,binding,proof,{bootVersion:0x020002});assert.deepEqual(f.sent.map(x=>x.command),[0x65]);
});
test('wrong fresh UID rejects before any BEGIN DATA or FINISH',async t=>{
 const f=verifier(t,{payload:P.concat([0],P.unhex(other))});await assert.rejects(f.session.verifyBootIdentity(1,binding,proof,{bootVersion:0x020002}),{code:'IDENTITY'});
 assert.deepEqual(f.sent.map(x=>x.command),[0x65]);
});
test('new Boot unsupported UID never falls back to old bound-address or history trust',async t=>{
 for(const verification of ['bound-address','historical-app-uid']){const f=verifier(t,{payload:[2,0,0,0,0]});
  await assert.rejects(f.session.verifyBootIdentity(1,binding,{...proof,uidSupported:false,uid:null,verification},{bootVersion:0x020002}),{code:'UID_UNSUPPORTED'});assert.deepEqual(f.sent.map(x=>x.command),[0x65]);}
});
test('old Boot original-address and established historical aliases send zero GET_UID requests',async t=>{
 for(const verification of ['bound-address','historical-app-uid']){const f=verifier(t);await f.session.verifyBootIdentity(1,binding,{...proof,uidSupported:false,uid:null,verification},{bootVersion:0x020001});assert.equal(f.sent.length,0);}
});
test('fresh App C2 UID proof does not claim Boot GET_UID capability on old Boot',async t=>{
 const f=verifier(t);await f.session.verifyBootIdentity(1,binding,{...proof,kind:'app',verification:'app-uid'},{bootVersion:0x020001});assert.equal(f.sent.length,0);
});
test('new UID-capable probe cannot downgrade to old Boot on fresh connection',async t=>{
 const f=verifier(t);await assert.rejects(f.session.verifyBootIdentity(1,binding,proof,{bootVersion:0x020001}),{code:'UID_DOWNGRADE'});assert.equal(f.sent.length,0);
});
test('unretired proof and unknown new-address old Boot never authorize recovery',()=>{
 const s=new Session({});assert.throws(()=>s.recoveryProof(binding,{...proof,retired:false}),{code:'UNVERIFIED_DEVICE'});
 assert.throws(()=>s.recoveryProof(binding,{...proof,uidSupported:false,uid:null,verification:'bound-address'}),{code:'IDENTITY'});
 assert.throws(()=>s.recoveryProof(binding,{...proof,uid:other}),{code:'IDENTITY'});
});
test('fresh write connection cannot reuse the retired probe epoch',async t=>{
 const f=verifier(t);f.transport.connectionId=proof.epoch;await assert.rejects(f.session.verifyBootIdentity(1,binding,proof,{bootVersion:0x020002}),{code:'STALE'});assert.equal(f.sent.length,0);
});
test('legacy preparation uses exact retired App locator then rereads full identity on a fresh connection',async()=>{
 const calls=[],pending={version:7},actual={uid,deviceId:oldMac,epoch:'original-app',info:{mode:0,bootVersion:0x020001}},prepared={...proof,kind:'app',verification:'app-uid',prepared:true};
 const adapter={async prepareRecoveryIdentity(base,options){calls.push('prepare');assert.equal(base.pending,pending);assert.equal(options.actual,actual);return prepared;},async connectApp(base,options){calls.push('fresh-connect');assert.equal(base.deviceId,newMac);assert.equal(options.probe,prepared);},async readApp(){calls.push('full-info');return {...actual,deviceId:newMac,epoch:'fresh-app'};}};
 const s=new Session(adapter);s.generation=1;s.binding={...binding,pending,written:false};
 const fresh=await s.prepareAppRecoveryIdentity(1,actual,{format:2,layoutId:2,boardId:258,version:8,imageSize:192,imageSha256:'a'.repeat(64)});
 assert.equal(fresh.epoch,'fresh-app');assert.equal(s.binding.deviceId,newMac);assert.equal(s.binding.pending,pending);assert.deepEqual(calls,['prepare','fresh-connect','full-info']);
});
test('legacy preparation noop cannot introduce a second disconnect or connection',async()=>{
 const actual={uid,deviceId:oldMac,epoch:'original-app',info:{mode:0,bootVersion:0x020002}},s=new Session({async prepareRecoveryIdentity(){return null;},connectApp(){throw Error('unnecessary reconnect');}});s.generation=1;
 assert.equal(await s.prepareAppRecoveryIdentity(1,actual,{}),actual);
});
test('legacy preparation must reject a different fresh App UID before ENTER or erase',async()=>{
 const actual={uid,deviceId:oldMac,epoch:'original-app',info:{mode:0}},prepared={...proof,kind:'app',verification:'app-uid',prepared:true};let connects=0;
 const s=new Session({async prepareRecoveryIdentity(){return prepared;},async connectApp(){connects++;return {...actual,uid:other,deviceId:newMac,epoch:'fresh-app'};},enterBoot(){throw Error('must not ENTER');}});s.generation=1;s.binding={...binding,pending:{version:9},written:false};
 await assert.rejects(s.prepareAppRecoveryIdentity(1,actual,{}),{code:'IDENTITY'});assert.equal(connects,1);assert.equal(s.binding.pending.version,9);assert.equal(s.binding.written,false);
});
function stored(){const data=new Map();return{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v))};}
const pending={boardId:258,version:0x020202,imageSize:192,imageSha256:'a'.repeat(64),format:2,layoutId:2,appBase:0x08003000,erasePage:128};
const legacyProof={...proof,deviceId:oldMac,uidSupported:false,uid:null,verification:'bound-address',info:{mode:1,bootVersion:0x020001}};
test('raw UID trust persists across Sessions and cannot be cleared by later stale binding saves',()=>{
 const storage=stored(),s=new Session({},{storage});s.saveBinding({...binding,pending,written:false});const stale=s.binding;
 s.adoptRecoveryProof(s.binding,s.recoveryProof(s.binding,proof));assert.equal(s.binding.requireBootUid,true);s.saveBinding(stale);
 const again=new Session({},{storage});assert.equal(again.binding.requireBootUid,true);assert.equal(again.binding.written,false);assert.equal(again.binding.pending.imageSha256,pending.imageSha256);
 assert.throws(()=>again.recoveryProof(again.binding,{...legacyProof,deviceId:again.binding.deviceId}),{code:'UID_REQUIRED'});
});
test('fresh UID conflict persists a guard so a later old-Boot retry cannot downgrade to bound-address',async t=>{
 const storage=stored(),f=verifier(t,{payload:P.concat([0],P.unhex(other))});f.session.storage=storage;f.session.saveBinding({...binding,pending,written:false});
 f.session.adoptRecoveryProof(f.session.binding,proof);await assert.rejects(f.session.verifyBootIdentity(1,f.session.binding,proof,{bootVersion:0x020002}),{code:'IDENTITY'});
 const again=new Session({},{storage});assert.equal(again.binding.requireBootUid,true);assert.equal(again.binding.identityNeedsUid,true);assert(again.binding.pending);
 assert.throws(()=>again.recoveryProof(again.binding,{...legacyProof,deviceId:again.binding.deviceId}),{code:'UID_REQUIRED'});assert.deepEqual(f.sent.map(x=>x.command),[0x65]);
 const app={...proof,kind:'app',verification:'app-uid'};again.adoptRecoveryProof(again.binding,again.recoveryProof(again.binding,app));
 assert.equal(again.binding.identityNeedsUid,false);assert.equal(again.binding.requireBootUid,true,'fresh App identity never removes minimum Boot UID ability');
 assert.throws(()=>again.recoveryProof(again.binding,{...legacyProof,deviceId:again.binding.deviceId}),{code:'UID_REQUIRED'});
});
test('an identity conflict cannot overwrite another binding owner established during the UID response',async t=>{
 let f;const newer={...binding,pending,written:true,identityNeedsUid:false};f=verifier(t,{payload:P.concat([0],P.unhex(other)),beforeReply:()=>{f.session.binding=newer;}});
 f.session.saveBinding({...binding,pending,written:false});await assert.rejects(f.session.verifyBootIdentity(1,f.session.binding,proof,{bootVersion:0x020002}),{code:'BINDING'});
 assert.equal(f.session.binding,newer);assert.equal(newer.identityNeedsUid,false);assert.equal(newer.written,true);
});
function bootInfoBytes(){const b=new Uint8Array(72),d=new DataView(b.buffer);d.setUint32(0,P.C.OTA_INFO_MAGIC,true);d.setUint16(4,2,true);d.setUint16(6,258,true);d.setUint32(8,0x020002,true);d.setUint32(12,0x020202,true);b[16]=1;b[17]=1;d.setUint32(20,192,true);b.fill(0xa0,28,60);d.setUint32(60,2,true);d.setUint32(64,0x08003000,true);d.setUint16(68,128,true);d.setUint16(70,15,true);return b;}
function cancellationFixture(t){let receive;const sent=[],transport={connectionId:'cancel-write',subscribe(fn){receive=fn;return()=>{};},async write(bytes){const r=P.decodeFrame(bytes);sent.push(r.command);const payload=r.command===P.OP.INFO?P.concat([0],bootInfoBytes()):r.command===P.OP.GET_UID?P.concat([0],P.unhex(uid)):P.concat([0],[192,0,0,0]);receive(P.encodeFrame(r.command|128,r.requestId,payload));}};
 const s=new Session({async disconnect(){}});s.generation=1;s.state.busy=true;s.saveBinding({...binding,pending,written:false});s.client=new BootClient(transport,{timing:{requestMs:12,retries:0}});t.after(()=>s.client?.close());return{s,sent};}
test('unverified real Boot INFO followed by explicit cancel sends no FINISH BEGIN or DATA',async t=>{
 const f=cancellationFixture(t);await f.s.client.info();assert.equal(f.s.client.identityVerified,false);await f.s.cancel();assert.deepEqual(f.sent,[P.OP.INFO]);
});
test('verified current Boot permits explicit idle cancellation exit; fresh client starts unverified again',async t=>{
 const f=cancellationFixture(t),client=f.s.client,info=await client.info();await f.s.verifyBootIdentity(1,f.s.binding,proof,info);assert.equal(client.identityVerified,true);await f.s.cancel();
 assert.deepEqual(f.sent,[P.OP.INFO,P.OP.GET_UID,P.OP.FINISH]);assert.equal(client.identityVerified,false,'closed identity cannot cross reconnect');
 const fresh=setup(t).client;assert.equal(fresh.identityVerified,false);
});
test('cancellation during UID verification cannot later arm the identityVerified flag',async t=>{
 let f,cancelling;f=verifier(t,{beforeReply:()=>{cancelling=f.session.cancel();}});f.session.state.busy=true;f.session.saveBinding({...binding,pending,written:false});
 f.session.adapter.disconnect=async()=>{};
 await assert.rejects(f.session.verifyBootIdentity(1,f.session.binding,proof,{bootVersion:0x020002}),{code:'CANCELLED'});await cancelling;assert.equal(f.client.identityVerified,false);assert.deepEqual(f.sent.map(x=>x.command),[P.OP.GET_UID]);
});
test('unknown Boot version retains BOOT_UNKNOWN classification without arming identity or cancellation FINISH',async t=>{
 const f=verifier(t);f.session.state.busy=true;f.session.adapter.disconnect=async()=>{};f.client.lastInfo={state:0,imageValid:true,imageSize:192};
 await assert.rejects(f.session.verifyBootIdentity(1,binding,proof,{bootVersion:0}),{code:'BOOT_UNKNOWN'});assert.equal(f.client.identityVerified,false);await f.session.cancel();assert.equal(f.sent.length,0);
});
