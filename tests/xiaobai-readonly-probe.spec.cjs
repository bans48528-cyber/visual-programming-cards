'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const stage=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(stage,'android-bluetooth.js'),'utf8');
const P=require(path.join(stage,'xiaobai-ota-protocol.js')),O=require(path.join(stage,'xiaobai-ota.js')),C=require(path.join(process.env.CARD_APP_ROOT||stage,'xiaobai-protocol.js')),{Gate}=require(path.join(stage,'xiaobai-firmware.js'));
const uid='0102030405060708090a0b0c',other='1112131415161718191a1b1c',binding={deviceId:'original',uid,pending:{version:0x020202},written:true};
function info(version=0x020002){const b=Buffer.alloc(72);b.writeUInt32LE(0x31494258);b.writeUInt16LE(2,4);b.writeUInt16LE(258,6);b.writeUInt32LE(version,8);b.writeUInt32LE(0x020202,12);b[16]=1;b[17]=1;b.writeUInt32LE(320,20);b.fill(0x11,28,60);b.writeUInt32LE(2,60);b.writeUInt32LE(0x08003000,64);b.writeUInt16LE(128,68);b.writeUInt16LE(15,70);return b;}
function fixture(opts={}){
 const calls=[],listeners=new Set(),storage=new Map();let live=null,connectSerial=0,fallback=false;
 const emit=(name,data)=>{for(const l of [...listeners])if(l.name===name)l.fn(data);};
 const native={async addListener(name,fn){const entry={name,fn};listeners.add(entry);return{remove:async()=>listeners.delete(entry)};},
  async connect(args){calls.push({method:'connect',...args});const result={probeOnly:opts.bridge!==false,properties:{fallbackWrite:Boolean(opts.needsFallback)}};if(opts.holdConnect)await opts.holdConnect;live=args.connectionId;return result;},
  async useFallbackWrite(args){fallback=true;calls.push({method:'fallback',...args});},async subscribe(args){calls.push({method:'subscribe',...args});},async beginOta(args){calls.push({method:'beginOta',...args});},
  async endOta(args){calls.push({method:'endOta',...args});if(live===args.connectionId)live=null;},async disconnect(args){calls.push({method:'disconnect',...args});if(live===args.connectionId)live=null;},
  async writeOta(args){const f=P.decodeFrame(Buffer.from(args.data,'base64'));calls.push({method:'raw',id:args.connectionId,op:f.command});if(opts.app)return;
   let data;if(f.command===0x60)data=Buffer.concat([Buffer.of(0),info(opts.bootVersion)]);else if(f.command===0x65)data=opts.noUid?Buffer.of(2):Buffer.concat([Buffer.of(0),Buffer.from(opts.uid||uid,'hex'),opts.extraUid?Buffer.of(0):Buffer.alloc(0)]);else throw Error('unexpected write');
   if(f.command===0x65&&opts.dropUid)return;const bytes=P.encodeFrame(f.command|128,f.requestId,data);queueMicrotask(()=>emit('otaNotification',{connectionId:args.connectionId,data:Buffer.from(bytes).toString('base64')}));},
  async write(args){const b=Buffer.from(args.data,'base64'),seq=b[5],op=b[6],part=b[7];calls.push({method:'c2',id:args.connectionId,op,part});if(opts.dropC2||opts.needsFallback&&!fallback)return;let data;
   if(op===4)data=[0,25,25,25,60,15,0];else if(op===0x56)data=[part,...Buffer.from(opts.uid||uid,'hex').subarray(part*6,part*6+6)];else throw Error('unexpected C2');
   const bytes=C.frame(0xd2,[seq,op,0,...data]);bytes[1]=0x98;bytes[2]=0x97;bytes[15]=Array.from(bytes.slice(0,15)).reduce((s,v)=>s+v,0)&255;queueMicrotask(()=>emit('notification',{connectionId:args.connectionId,data:Buffer.from(bytes).toString('base64')}));}
 };
 const context={native,protocol:C,XiaobaiOtaProtocol:P,XiaobaiOta:O,crypto:crypto.webcrypto,performance,setTimeout,clearTimeout,setInterval,clearInterval,Uint8Array,Date,Math,Set,Map,Promise,console,render(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64')};
 const history=source.slice(source.indexOf("  const uidHistoryKey="),source.indexOf('  const lifecycle='));
 const helpers=source.slice(source.indexOf('  async function readOnlyDeviceChannel('),source.indexOf('  async function connectAppForConfirmation('));
 vm.runInNewContext('let readOnlyProbe=null,connecting=null;'+history+helpers+';globalThis.api={probeDeviceReadOnly,rememberAppUid,verifiedAppAlias};',context);
 const first=source.indexOf('    async prepareRecoveryIdentity('),last=source.indexOf('    async probeRecovery(',first);context.firmware={session:{generation:1},consent:{}};context.otaActive=()=>true;context.requireOta=()=>{};context.current={deviceId:'original',connectionId:'live-original'};context.freshBoundOtaAdvertisement=async()=>{calls.push({method:'scan'});return{device:{deviceId:opts.scanId||'original'},candidates:[]};};vm.runInNewContext('globalThis.api.prepareRecoveryIdentity=({'+source.slice(first,last)+'}).prepareRecoveryIdentity;',context);
 return{api:context.api,calls,listeners,storage,context,get live(){return live;}};
}
function clean(f){assert.equal(f.listeners.size,0);assert.equal(f.live,null);assert(f.calls.filter(c=>c.method==='connect').every(c=>c.probeOnly===true));assert(f.calls.filter(c=>c.method==='raw').every(c=>[0x60,0x65].includes(c.op)));assert(f.calls.filter(c=>c.method==='c2').every(c=>[4,0x56,0x60].includes(c.op)));}
test('fresh Boot UID proves changed locator; isolated epoch is retired and only INFO/UID are sent',async()=>{
 const f=fixture(),p=await f.api.probeDeviceReadOnly({deviceId:'changed'},{binding});assert.equal(p.uid,uid);assert.equal(p.verification,'boot-uid');assert.equal(p.retired,true);assert.equal(p.deviceId,'changed');assert.deepEqual(f.calls.filter(c=>c.method==='raw').map(c=>c.op),[0x60,0x65]);assert(!f.calls.some(c=>c.method==='c2'));clean(f);
});
test('legacy Boot has no invented UID; only original or actually recorded App UID alias is accepted',async()=>{
 for(const kind of ['original','alias','unknown']){const f=fixture({bootVersion:0x020001,noUid:true});if(kind==='alias')f.api.rememberAppUid(uid,'alias');const task=f.api.probeDeviceReadOnly({deviceId:kind},{binding});if(kind==='unknown')await assert.rejects(task,e=>e.code==='UNVERIFIED_DEVICE');else{const p=await task;assert.equal(p.uid,null);assert.equal(p.uidSupported,false);assert.equal(p.verification,kind==='original'?'bound-address':'historical-app-uid');}assert.equal(f.calls.filter(c=>c.method==='raw'&&c.op===0x65).length,0,'old Boot receives no unsupported UID command');clean(f);}
});
test('a real conflicting UID overrides original locator and a historical alias',async()=>{
 for(const id of ['original','alias']){const f=fixture({uid:other});f.api.rememberAppUid(uid,id);await assert.rejects(f.api.probeDeviceReadOnly({deviceId:id},{binding}),e=>e.code==='IDENTITY');assert(!f.calls.some(c=>c.method==='c2'));clean(f);}
});
for(const [label,opts]of [['unsupported',{noUid:true}],['bad length',{extraUid:true}],['timeout',{dropUid:true}]])test('new Boot UID '+label+' cannot downgrade to address/history or App',async()=>{
 const f=fixture(opts);f.api.rememberAppUid(uid,'original');await assert.rejects(f.api.probeDeviceReadOnly({deviceId:'original'},{binding}),e=>e.bootDetected===true);assert(!f.calls.some(c=>c.method==='c2'));clean(f);
});
test('App fallback creates a separate probe epoch and reads real UID without ENTER/heartbeat',async()=>{
 const f=fixture({app:true}),p=await f.api.probeDeviceReadOnly({deviceId:'changed'},{binding});assert.equal(p.verification,'app-uid');assert.equal(p.uid,uid);const ids=f.calls.filter(c=>c.method==='connect').map(c=>c.connectionId);assert.equal(ids.length,2);assert.notEqual(...ids);assert.deepEqual(f.calls.filter(c=>c.method==='c2').map(c=>c.op),[4,0x56,0x56]);assert.equal(f.api.verifiedAppAlias(uid,'changed'),true);clean(f);
});
test('recovery App UID conflict does not add an alias or replace the old binding',async()=>{
 const f=fixture({app:true,uid:other});await assert.rejects(f.api.probeDeviceReadOnly({deviceId:'changed'},{binding}),e=>e.code==='IDENTITY');assert.equal(f.storage.size,0);assert.equal(binding.deviceId,'original');assert.equal(binding.written,true);clean(f);
});
test('unsupported native isolation fails before sending any protocol bytes',async()=>{
 const f=fixture({bridge:false});await assert.rejects(f.api.probeDeviceReadOnly({deviceId:'changed'},{binding}),e=>e.code==='UNSUPPORTED_BRIDGE');assert(!f.calls.some(c=>['raw','c2'].includes(c.method)));clean(f);
});
test('cancelled native connect cannot revive a retired probe epoch',async()=>{
 let release;const holdConnect=new Promise(r=>release=r),f=fixture({holdConnect});let current=true;const task=f.api.probeDeviceReadOnly({deviceId:'original'},{binding,guard:()=>current});await new Promise(r=>setTimeout(r,5));current=false;await assert.rejects(task,e=>e.code==='CANCELLED');release();await new Promise(r=>setTimeout(r,5));assert(!f.calls.some(c=>['raw','c2'].includes(c.method)));clean(f);
});
function gated(proof,{confirmationOnly=false}={}){
 let guarded;const gate=new Gate({identity:()=>null,probeRecovery:async()=>proof,prepareRecoveryIdentity:async()=>proof,connectBoot:async()=>({}),raw:()=>({})},{sessionFactory:a=>(guarded=a,{binding:null,snapshot:()=>({}),state:{}})});
 gate.generation=1;gate.entry=1;gate.consent={token:1,entry:1,deviceId:'original',uid,epoch:null,stage:'reconnect',confirmationOnly};return{gate,guarded};
}
test('Gate consent locator changes only after a retired UID proof and preserves confirmation-only write prohibition',async()=>{
 const proof={kind:'boot',deviceId:'changed',epoch:'retired',uid,uidSupported:true,verifiedLocator:true,verification:'boot-uid',retired:true};
 const {gate,guarded}=gated(proof,{confirmationOnly:true});await guarded.probeRecovery(binding);assert.equal(gate.consent.deviceId,'changed');assert.equal(gate.consent.epoch,null);await assert.rejects(guarded.connectBoot({...binding,deviceId:'changed'},{probe:proof}),e=>e.code==='NOT_ALLOWED');await assert.rejects(guarded.raw(),e=>e.code==='NOT_ALLOWED');
 for(const patch of [{retired:false},{uid:other},{verifiedLocator:false},{uidSupported:false},{verification:'hash-match'},{verification:'bound-address',uid:null,uidSupported:false}]){const x=gated({...proof,...patch});await assert.rejects(x.guarded.probeRecovery(binding),e=>e.code==='IDENTITY');assert.equal(x.gate.consent.deviceId,'original');}
});

const actual={deviceId:'original',epoch:'live-original',uid,info:{bootVersion:0x020001}};
async function preparation(f,identity=actual){return f.api.prepareRecoveryIdentity.call({async disconnect(){f.calls.push({method:'business-disconnect'});f.context.current=null;}},binding,{actual:identity});}
test('legacy explicit OTA preparation accepts an exact same-address UID reconnect and records only that address',async()=>{
 const f=fixture({app:true}),p=await preparation(f);assert.equal(p.prepared,true);assert.equal(p.deviceId,'original');assert.equal(p.verification,'app-uid');assert.equal(p.uid,uid);assert(p.retired);
 assert.equal(f.calls.filter(c=>c.method==='scan').length,1);assert.equal(f.calls.filter(c=>c.method==='business-disconnect').length,1);assert.deepEqual(f.calls.filter(c=>c.method==='c2').map(c=>c.op),[4,0x56,0x56]);assert(!f.calls.some(c=>c.method==='raw'));
 const history=JSON.parse(f.storage.get('xiaobai:uid-locators:v1'));assert.equal(history.length,1);assert.equal(history[0].deviceId,'original');assert.equal(history[0].recoveryReconnect,true);clean(f);
 f.context.current={deviceId:'original',connectionId:'live-original'};assert.equal(await preparation(f),null);assert.equal(f.calls.filter(c=>c.method==='business-disconnect').length,1,'verified exact reconnect avoids unconditional repeats');
});
test('App-compiled Boot202 alone cannot skip preparation; an existing real App alias can',async()=>{
 const fresh=fixture({app:true,bootVersion:0x020001});const proof=await preparation(fresh,{...actual,info:{bootVersion:0x020002}});assert.equal(proof.prepared,true);assert.equal(fresh.calls.filter(c=>c.method==='business-disconnect').length,1);
 const alias=fixture({app:true});alias.api.rememberAppUid(uid,'observed-alias');assert.equal(await preparation(alias),null);assert.equal(alias.calls.length,0);
});
test('legacy preparation UID conflict or silent protocol stops before any mode transition or image write',async()=>{
 for(const opts of [{app:true,uid:other},{dropC2:true}]){const f=fixture(opts);await assert.rejects(preparation(f),e=>e.code==='LEGACY_RECOVERY_IDENTITY');assert.equal(f.storage.size,0);assert(!f.calls.some(c=>c.method==='raw'||c.method==='c2'&&![4,0x56].includes(c.op)));assert.equal(binding.written,true);clean(f);}
});

test('legacy preparation preserves the existing read-only fallback characteristic support',async()=>{
 const f=fixture({app:true,needsFallback:true}),p=await preparation(f);assert.equal(p.uid,uid);assert.equal(f.calls.filter(c=>c.method==='fallback').length,1);assert.deepEqual(f.calls.filter(c=>c.method==='c2').map(c=>c.op),[4,4,0x56,0x56]);clean(f);
});
test('Gate accepts only a prepared, retired App UID proof for legacy pre-ENTER locator changes',async()=>{
 const proof={kind:'app',deviceId:'changed',epoch:'retired-app',uid,uidSupported:true,verifiedLocator:true,verification:'app-uid',retired:true,prepared:true};
 const valid=gated(proof);await valid.guarded.prepareRecoveryIdentity(binding);assert.equal(valid.gate.consent.deviceId,'changed');
 for(const patch of [{prepared:false},{kind:'boot',verification:'boot-uid'},{uid:other},{retired:false}]){const bad=gated({...proof,...patch});await assert.rejects(bad.guarded.prepareRecoveryIdentity(binding),e=>e.code==='IDENTITY');assert.equal(bad.gate.consent.deviceId,'original');}
});

test('two silent protocols produce a wired-recovery diagnostic without inventing identity',async()=>{
 const f=fixture({app:true,dropC2:true});await assert.rejects(f.api.probeDeviceReadOnly({deviceId:'original'},{binding}),e=>e.code==='PROTOCOL_UNAVAILABLE'&&e.message.includes('有线恢复'));assert.equal(f.storage.size,0);clean(f);
});

test('persisted UID-required or identity-conflict state cannot downgrade to legacy address/alias trust',async()=>{
 for(const flag of ['requireBootUid','identityNeedsUid']){const f=fixture({bootVersion:0x020001});f.api.rememberAppUid(uid,'original');await assert.rejects(f.api.probeDeviceReadOnly({deviceId:'original'},{binding:{...binding,[flag]:true}}),e=>e.code==='UID_REQUIRED');assert.equal(f.calls.filter(c=>c.method==='raw'&&c.op===0x65).length,0);assert(!f.calls.some(c=>c.method==='c2'));clean(f);}
});
