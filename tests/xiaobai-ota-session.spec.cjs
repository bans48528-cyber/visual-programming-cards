// Session orchestration tests: real signed input, synthetic adapter/Boot ACKs. No hardware.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const P=require('../xiaobai-ota-protocol.js');
const {Session,validateStatus,targetOf}=require('../xiaobai-ota.js');
const firmware=process.env.XIAOBAI_FIRMWARE_ROOT;
const targetFile=process.env.XIAOBAI_OTA_TEST_PACKAGE||path.join(__dirname,'..',require('../assets/firmware/release.json').firmware.asset);
const oldFile=firmware?path.join(firmware,'dist/ota/py32_1.0.0/xiaobai_py32_1.0.0.ota'):path.join(__dirname,'fixtures/firmware/xiaobai_py32_1.0.0.ota');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const observed=p=>p.then(value=>({ok:true,value}),error=>({ok:false,error}));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const clock=()=>performance.now();
const timing={requestMs:15,beginMs:25,finishMs:25,retries:1,bootWaitMs:150,bootPollMs:5,restartMs:1,healthGapMs:510,healthDeadlineMs:1200};
const uid='00112233445566778899aabb',deviceId='AA:BB:CC:11:22:33',newDeviceId='AA:BB:CC:44:55:66',otherUid='ffeeddccbbaa998877665544';
const dataStatus=()=>Uint8Array.of(0,40,40,40,0x74,0x0e,0);
const le32=n=>Uint8Array.of(n&255,n>>>8&255,n>>>16&255,n>>>24&255);
const get32=b=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(0,true);
async function until(fn,label='condition',ms=2000){const end=clock()+ms;while(!fn()&&clock()<end)await sleep(1);assert.ok(fn(),label);}
function storage(){const items=new Map();return{items,getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,String(v))};}
function infoFor(pkg,mode=0,extra={}){return{protocol:1,boardId:258,bootVersion:Math.max(P.C.OTA_BOOT_VERSION,pkg.minBootVersion??pkg.minBoot??0),version:pkg.version,mode,imageValid:true,state:0,lastError:0,imageSize:pkg.imageSize,nextOffset:0,imageSha256:pkg.imageSha256,supported:true,...extra};}
function infoBytes(info){const b=new Uint8Array(60),d=new DataView(b.buffer);d.setUint32(0,P.C.OTA_INFO_MAGIC,true);d.setUint16(4,info.protocol,true);d.setUint16(6,info.boardId,true);d.setUint32(8,info.bootVersion,true);d.setUint32(12,info.version,true);b.set([info.mode,+info.imageValid,info.state,info.lastError],16);d.setUint32(20,info.imageSize,true);d.setUint32(24,info.nextOffset,true);b.set(P.unhex(info.imageSha256),28);return b;}
class MemoryBoot {
  constructor(adapter){this.adapter=adapter;this.listeners=new Set();this.disconnectListeners=new Set();this.frames=[];this.offset=0;this.receiving=false;this.info=infoFor(adapter.current,1);}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  onDisconnect(fn){this.disconnectListeners.add(fn);return()=>this.disconnectListeners.delete(fn);}
  disconnected(){for(const fn of this.disconnectListeners)fn();if(this.nativePending&&this.adapter.options.dropFirstInfoChannel)this.adapter.options.infoChannelDropped=true;this.nativePending=null;this.receiving=false;this.offset=0;this.info.nextOffset=0;this.info.state=0;}
  reply(frame,payload){this.nativePending=null;const raw=P.encodeFrame(frame.command|0x80,frame.requestId,payload);for(const fn of this.listeners)fn(raw);}
  async write(bytes){
    const f=P.decodeFrame(bytes);if(this.adapter.options.strictGate){if(this.nativePending&&!Buffer.from(this.nativePending).equals(Buffer.from(bytes)))throw Object.assign(new Error('native pending request ID must finish or disconnect'),{code:'NATIVE_BUSY'});this.nativePending=Uint8Array.from(bytes);}this.frames.push(f);this.adapter.log.push('boot:'+f.command.toString(16));
    let payload;
    if(f.command===P.OP.INFO)payload=P.concat([0],infoBytes(this.info));
    else if(f.command===P.OP.BEGIN){
      const fields=P.parseManifest(f.payload);this.info.imageValid=false;this.info.state=1;this.info.nextOffset=0;
      this.receiving=true;this.offset=0;this.target=fields;payload=P.concat([0],le32(0));
    }else if(f.command===P.OP.DATA){
      const offset=get32(f.payload),next=offset+f.payload.length-4;
      if(offset!==this.offset&&next!==this.offset)payload=P.concat([7],le32(this.offset));
      else{this.offset=next;this.info.nextOffset=next;payload=P.concat([0],le32(next));}
    }else if(f.command===P.OP.FINISH){
      if(this.adapter.options.noFinishCommit)return;
      if(this.receiving){this.info=infoFor(this.adapter.target,1);this.receiving=false;this.adapter.current=this.adapter.target;}
      this.adapter.appAvailable=true;payload=P.concat([0],le32(this.info.imageSize));
    }else throw new Error('unexpected command');
    if(f.command===P.OP.INFO&&this.adapter.options.dropFirstInfoChannel&&!this.adapter.options.infoChannelDropped)return;
    if(this.adapter.options.disconnectAt===f.command){this.adapter.options.disconnectAt=null;this.disconnected();throw Object.assign(new Error('synthetic BLE disconnect'),{code:'DISCONNECTED'});}
    if(this.adapter.options.plainWriteErrorAt===f.command&&(f.command!==P.OP.DATA||get32(f.payload)>=(this.adapter.options.disconnectFromOffset||0))){
      this.adapter.options.plainWriteErrorAt=null;await this.adapter.options.plainWriteErrorGate?.promise;
      if(this.adapter.options.plainWriteErrorOrder==='disconnect-first')this.disconnected();
      else if(this.adapter.options.plainWriteErrorOrder==='reject-first')setTimeout(()=>this.disconnected(),0);
      throw new Error('GATT 19: connection closed');
    }
    if(this.adapter.options.disconnectEventAt===f.command&&(f.command!==P.OP.DATA||get32(f.payload)>=(this.adapter.options.disconnectFromOffset||0))){this.adapter.options.disconnectEventAt=null;this.disconnected();return;}
    if(this.adapter.options.holdAt===f.command){this.adapter.options.holdAt=null;return;}
    if(f.command===P.OP.FINISH&&this.adapter.options.dropFinish)return;
    if(f.command===P.OP.FINISH&&this.adapter.options.finishGate){await this.adapter.options.finishGate.promise;this.adapter.log.push('finishAck');}
    this.reply(f,payload);
  }
}
function adapterFixture(previous,target,options={}){
  const a={current:previous,target,options,log:[],owned:false,epoch:'initial-app',seq:0,post:false,connected:true,appAvailable:true,deviceId};
  a.boot=new MemoryBoot(a);
  a.prepare=async()=>{a.log.push('prepare');a.owned=true;await options.prepareGate?.promise;};
  a.release=async()=>{a.log.push('release');a.owned=false;};
  a.traces=[];a.traceOta=(stage,detail)=>a.traces.push({stage,detail});
  a.readApp=async()=>{
    a.log.push('readApp:'+a.epoch);
    if(options.oldFirmware)throw Object.assign(new Error('unsupported OTA opcode'),{result:2});
    if(!a.connected)throw Object.assign(new Error('not connected App'),{code:'DISCONNECTED'});
    return{uid:a.post&&options.wrongUid?otherUid:(options.initialUid||uid),deviceId:a.deviceId,epoch:a.epoch,name:'小白',
      info:infoFor(a.current,0,a.post?(options.finalInfo||{}):(options.initialInfo||{}))};
  };
  a.queryStatus=async()=>{
    a.log.push(a.post?'health':'preflight');const sentAt=clock();await sleep(1);
    const data=dataStatus();if(!a.post&&options.lowPower){data[4]=0x54;data[5]=0x0b;}
    if(!a.post&&options.busy)data[6]=0x10;
    if(a.post&&options.healthFault)data[6]=8;
    return{epoch:options.staleEpoch&&a.post?'initial-app':a.epoch,seq:++a.seq,opcode:4,result:0,sentAt,receivedAt:clock(),data};
  };
  a.enterBoot=async()=>{
    a.log.push('enterBoot');
    if(options.enterRejected)throw Object.assign(new Error('ENTER refused'),{result:4,notEntered:true});
    a.connected=false;a.appAvailable=false;if(options.enterAckLost)a.log.push('enter-ack-lost:probe-boot');
    if(options.enterDisconnectUnknown)throw Object.assign(new Error('ENTER ACK lost then native disconnected'),{code:'DISCONNECTED',notEntered:true});
    return a.boot;
  };
  a.connectBoot=async binding=>{a.log.push('connectBoot');if(options.connectBootUnavailable)throw Object.assign(new Error('bound Boot unavailable'),{code:'CONNECTION_FAILED'});assert.equal(binding.deviceId,deviceId);assert.equal(binding.uid,uid);a.connected=false;return a.boot;};
  a.connectApp=async(binding,settings)=>{a.log.push('connectApp');(a.connectSettings??=[]).push(settings);if(!a.appAvailable)throw Object.assign(new Error('Boot does not answer App requests'),{code:'TIMEOUT'});assert.ok([deviceId,newDeviceId].includes(binding.deviceId));assert.equal(binding.uid,uid);a.epoch='new-app-'+(a.seq+1);a.deviceId=options.newMac||binding.deviceId;a.connected=true;a.post=true;if(options.connectAppReturnsActual)return a.readApp();};
  a.adoptConfirmedLocator=async(actual,previousDeviceId)=>{a.log.push('adoptLocator');(a.adopted??=[]).push({actual,previousDeviceId});};
  a.disconnect=async()=>{a.log.push('disconnect');a.connected=false;a.boot.disconnected();};
  return a;
}
async function fixture(previous,target,options={}){
  const adapter=adapterFixture(previous,target,options),store=storage(),snapshots=[];
  const session=new Session(adapter,{storage:store,timing,onChange:state=>{snapshots.push({...state});options.onChange?.(state,session,adapter);}});
  await session.choose(target.bytes,path.basename(targetFile));return{adapter,session,store,snapshots};
}
const count=(a,cmd)=>a.boot.frames.filter(frame=>frame.command===cmd).length;
async function normal(previous,target){
  const f=await fixture(previous,target,{enterAckLost:true});
  const actual=await f.session.inspect();assert.equal(actual.info.version,previous.version);assert.equal(f.session.snapshot().supported,true);
  f.adapter.log=[];
  const result=await f.session.start();assert.equal(result.written,true);assert.equal(result.applicationStartVerified,false);
  const state=f.session.snapshot();assert.equal(state.phase,'success');assert.equal(state.busy,false);assert.equal(state.recovery,false);assert.equal(f.adapter.owned,false);
  assert.equal(state.info.version,target.version);assert.equal(state.info.imageSha256,target.imageSha256);
  assert.equal(count(f.adapter,P.OP.BEGIN),1);assert.equal(count(f.adapter,P.OP.FINISH),1);
  assert.equal(count(f.adapter,P.OP.DATA),Math.ceil(target.imageSize/128));
  const log=f.adapter.log,begin=log.indexOf('boot:62'),finish=log.indexOf('boot:64');
  assert.ok(log.indexOf('prepare')<log.indexOf('readApp:initial-app'));
  assert.ok(log.indexOf('preflight')<log.indexOf('enterBoot')&&log.indexOf('enterBoot')<begin);
  assert.ok(log.indexOf('enter-ack-lost:probe-boot')<begin);
  assert.ok(finish<log.indexOf('disconnect')&&log.indexOf('disconnect')<log.indexOf('connectApp'));
  assert.equal(log.filter(value=>value==='health').length,2);
  assert.ok(f.adapter.traces.some(t=>t.stage==='BEGIN 已受理'));
  const progress=f.adapter.traces.filter(t=>t.stage==='提交进度');assert.ok(progress.length>=1&&progress.length<=11,'progress traces are bounded by ten-percent buckets');

  assert.notEqual(f.adapter.epoch,'initial-app');
  const success=f.snapshots.findIndex(s=>s.phase==='success'),written=f.snapshots.findIndex(s=>s.phase==='written');
  assert.ok(written>=0&&written<success);assert.ok(f.snapshots.slice(0,success).every(s=>s.phase!=='success'));
}
async function currentAndPolicy(previous,target){
  let f=await fixture(target,target);const result=await f.session.start();assert.equal(result.alreadyPresent,true);assert.equal(f.session.snapshot().phase,'current');assert.equal(count(f.adapter,P.OP.BEGIN),0);assert.ok(!f.adapter.log.includes('enterBoot'));
  for(const options of [{lowPower:true},{busy:true},{initialInfo:{version:target.version,imageSha256:'0'.repeat(64)}},{initialInfo:{boardId:259,supported:false}}]){
    f=await fixture(previous,target,options);const outcome=await observed(f.session.start());assert.equal(outcome.ok,false);assert.equal(count(f.adapter,P.OP.BEGIN),0);assert.ok(!f.adapter.log.includes('enterBoot'));assert.equal(f.session.snapshot().busy,false);assert.equal(f.adapter.owned,false);
  }
  f=await fixture(previous,target,{oldFirmware:true});await assert.rejects(f.session.inspect(),error=>error.result===2);assert.equal(f.session.snapshot().supported,false);assert.match(f.session.snapshot().message,/DAP/);await assert.rejects(f.session.start());assert.ok(!f.adapter.log.includes('enterBoot'));
  f=await fixture(previous,target,{enterRejected:true});await assert.rejects(f.session.start());assert.equal(f.session.snapshot().recovery,false);assert.equal(f.session.snapshot().phase,'error');
  f=await fixture(previous,target,{initialInfo:{protocol:2,supported:false}});await f.session.inspect();assert.equal(f.session.snapshot().supported,false);
}
async function cancelAndRecover(previous,target){
  const gate=defer();let f=await fixture(previous,target,{prepareGate:gate});let pending=observed(f.session.start());
  await until(()=>f.adapter.owned,'prepare reached');await assert.rejects(f.session.start(),/尚未结束/);await assert.rejects(f.session.choose(target.bytes,'new.ota'),/先结束/);
  await f.session.cancel();gate.resolve();let result=await pending;assert.equal(result.ok,false);assert.ok(!f.adapter.log.includes('enterBoot'));assert.equal(f.session.snapshot().phase,'cancelled');assert.equal(f.session.snapshot().busy,false);assert.equal(f.adapter.boot.info.imageValid,true);
  f=await fixture(previous,target,{holdAt:P.OP.BEGIN});pending=observed(f.session.start());
  await until(()=>count(f.adapter,P.OP.BEGIN)===1,'BEGIN actually accepted');await f.session.cancel();result=await pending;assert.equal(result.ok,false);assert.equal(f.session.snapshot().phase,'cancelled');assert.equal(f.session.snapshot().recovery,true);assert.equal(count(f.adapter,P.OP.FINISH),0);assert.equal(count(f.adapter,P.OP.DATA),0);assert.equal(f.adapter.boot.info.imageValid,false,'cancel after BEGIN cannot promise rollback');
  const firstId=f.adapter.boot.frames.find(frame=>frame.command===P.OP.BEGIN).requestId;
  f.adapter.options.holdAt=null;await f.session.start({recovery:true});assert.equal(f.session.snapshot().phase,'success');assert.ok(f.adapter.log.includes('connectBoot'));
  const begins=f.adapter.boot.frames.filter(frame=>frame.command===P.OP.BEGIN);assert.notEqual(begins.at(-1).requestId,firstId);assert.equal(get32(f.adapter.boot.frames.find(frame=>frame.command===P.OP.DATA).payload),0);
  f=await fixture(previous,target,{disconnectAt:P.OP.DATA});await assert.rejects(f.session.start());assert.equal(f.session.snapshot().phase,'recovery');assert.equal(f.session.snapshot().busy,false);assert.equal(count(f.adapter,P.OP.FINISH),0);assert.equal(f.session.snapshot().written,false);
  const copied=JSON.parse(f.store.getItem('xiaobai:ota:binding:v1'));assert.equal(copied.uid,uid);assert.equal(copied.deviceId,deviceId);assert.ok(copied.pending);
}
async function confirmation(previous,target){
  let f=await fixture(previous,target,{wrongUid:true});await assert.rejects(f.session.start(),error=>error.code==='IDENTITY');assert.equal(f.session.snapshot().phase,'unconfirmed');assert.equal(f.session.snapshot().written,true);assert.equal(f.session.snapshot().recovery,true);assert.equal(f.adapter.connected,false);
  const frames=f.adapter.boot.frames.length;f.adapter.options.wrongUid=false;await f.session.retryConfirmation();assert.equal(f.session.snapshot().phase,'success');assert.equal(f.adapter.boot.frames.length,frames,'retry confirmation never retransmits firmware');
  f=await fixture(previous,target,{healthFault:true});await assert.rejects(f.session.start(),error=>error.code==='UNCONFIRMED');assert.equal(f.session.snapshot().phase,'unconfirmed');assert.equal(f.session.snapshot().written,true);assert.ok(f.session.snapshot().recovery);const prior=count(f.adapter,P.OP.BEGIN);f.adapter.options.healthFault=false;await f.session.retryConfirmation();assert.equal(f.session.snapshot().phase,'success');assert.equal(count(f.adapter,P.OP.BEGIN),prior);
  f=await fixture(previous,target,{dropFinish:true});const result=await observed(f.session.start());
  // A lost FINISH ACK may have committed successfully. Confirm the actual new App without reflashing.
  assert.equal(result.ok,true,result.error?.message);assert.equal(f.session.snapshot().phase,'success');assert.equal(count(f.adapter,P.OP.BEGIN),1);assert.equal(count(f.adapter,P.OP.FINISH),2);assert.equal(f.adapter.log.filter(v=>v==='connectApp').length,1);
  f=await fixture(previous,target,{dropFinish:true,healthFault:true});await assert.rejects(f.session.start(),error=>error.code==='UNCONFIRMED');
  assert.equal(f.session.snapshot().phase,'unconfirmed');assert.equal(f.session.snapshot().written,true);assert.ok(f.session.snapshot().recovery);assert.equal(count(f.adapter,P.OP.BEGIN),1);
  f=await fixture(previous,target,{noFinishCommit:true});await assert.rejects(f.session.start(),error=>error.code==='UNCONFIRMED');
  assert.equal(f.session.snapshot().written,false,'an attempted FINISH and pending intent cannot prove writing completed');
  assert.notEqual(f.session.snapshot().phase,'success');assert.ok(f.session.snapshot().recovery);assert.equal(JSON.parse(f.store.getItem('xiaobai:ota:binding:v1')).written,false);
  const noCommitFrames=f.adapter.boot.frames.length;await assert.rejects(f.session.retryConfirmation(),error=>error.code==='UNCONFIRMED');
  assert.equal(f.session.snapshot().written,false,'retry confirmation must not upgrade intent into evidence');
  assert.equal(count(f.adapter,P.OP.BEGIN),1,'failed confirmation must never silently start a new download');assert.ok(f.adapter.boot.frames.length>=noCommitFrames);
}
async function cancellationBoundaries(previous,target){
  const gate=defer();let cancelPromise,cancelCount=0;
  let f=await fixture(previous,target,{finishGate:gate,onChange(state,session){if(state.phase==='boot'&&!cancelCount++){cancelPromise=session.cancel();}}});
  let pending=observed(f.session.start());
  await until(()=>count(f.adapter,P.OP.FINISH)===1,'cancel issued FINISH while valid idle Boot');
  await sleep(5);assert.equal(count(f.adapter,P.OP.BEGIN),0);assert.equal(count(f.adapter,P.OP.DATA),0);
  assert.equal(f.session.snapshot().busy,true,'session keeps ownership while safe Boot exit ACK is pending');
  assert.ok(!f.adapter.log.includes('disconnect'),'perform finally must await cancellation FINISH before disconnect');
  assert.equal(f.adapter.boot.info.imageValid,true,'cancel before BEGIN preserves original App');
  gate.resolve();await cancelPromise;let result=await pending;assert.equal(result.ok,false);
  assert.equal(f.session.snapshot().phase,'cancelled');assert.equal(f.session.snapshot().busy,false);assert.equal(f.adapter.current.version,previous.version);
  assert.ok(f.adapter.log.indexOf('finishAck')<f.adapter.log.indexOf('disconnect'));
  cancelCount=0;cancelPromise=null;
  f=await fixture(previous,target,{onChange(state,session){if(state.phase==='written'&&!cancelCount++){cancelPromise=session.cancel();}}});
  result=await observed(f.session.start());await cancelPromise;assert.equal(result.ok,false);
  assert.equal(f.session.snapshot().phase,'unconfirmed');assert.equal(f.session.snapshot().written,true);assert.match(f.session.snapshot().message,/固件已写入/);
  assert.equal(f.adapter.log.filter(v=>v==='health').length,0,'cancel before startup confirmation does not fabricate health');
  const begins=count(f.adapter,P.OP.BEGIN),pages=count(f.adapter,P.OP.DATA);
  await f.session.retryConfirmation();assert.equal(f.session.snapshot().phase,'success');assert.equal(count(f.adapter,P.OP.BEGIN),begins);assert.equal(count(f.adapter,P.OP.DATA),pages);
}
async function bootInfoReconnectGate(previous,target){
  const f=await fixture(previous,target,{strictGate:true,dropFirstInfoChannel:true});
  await f.session.start();assert.equal(f.session.snapshot().phase,'success');
  const infos=f.adapter.boot.frames.filter(frame=>frame.command===P.OP.INFO);
  assert.equal(infos.length,3,'first INFO exhausts same-ID retry, second channel INFO succeeds');
  assert.equal(infos[0].requestId,infos[1].requestId);assert.deepEqual(infos[0].bytes,infos[1].bytes);
  assert.notEqual(infos[2].requestId,infos[0].requestId,'new connection uses a new request ID');
  assert.ok(f.adapter.options.infoChannelDropped);assert.ok(f.adapter.log.includes('connectBoot'));
  const bootEntries=f.adapter.log.reduce((all,value,index)=>{if(value==='boot:60')all.push(index);return all;},[]);
  const cut=f.adapter.log.indexOf('disconnect');assert.ok(bootEntries[1]<cut&&cut<bootEntries[2]);
  assert.equal(count(f.adapter,P.OP.BEGIN),1,'INFO retries/reconnects never erase until support is confirmed');
}

async function eventDisconnectBoundaries(previous,target){
  // The bridge may resolve write before notifying disconnect. The real client must
  // distinguish that transport loss from explicit user cancellation.
  let f=await fixture(previous,target,{disconnectEventAt:P.OP.INFO});
  let result=await observed(f.session.start());
  assert.equal(result.ok,true,result.error?.message);
  assert.equal(f.session.snapshot().phase,'success');
  assert.equal(count(f.adapter,P.OP.INFO),2,'pre-BEGIN transport loss reconnects only the bound Boot');
  assert.equal(count(f.adapter,P.OP.BEGIN),1);
  for(const offset of [0,512]){
    f=await fixture(previous,target,{disconnectEventAt:P.OP.DATA,disconnectFromOffset:offset});
    result=await observed(f.session.start());
    assert.equal(result.ok,false);assert.equal(result.error.code,'DISCONNECTED');
    assert.equal(f.session.snapshot().phase,'recovery');assert.equal(f.session.snapshot().busy,false);
    assert.equal(f.session.snapshot().written,false);assert.equal(f.session.snapshot().committed,offset);
    assert.equal(f.session.binding.deviceId,deviceId);assert.equal(f.session.binding.uid,uid);
    assert.deepEqual(f.session.binding.pending,targetOf(target));
    assert.equal(count(f.adapter,P.OP.BEGIN),1);
    const frames=f.adapter.boot.frames.length;await sleep(40);
    assert.equal(f.adapter.boot.frames.length,frames,'data loss requires renewed user consent, never an automatic BEGIN or DATA');
  }
  f=await fixture(previous,target,{enterDisconnectUnknown:true});
  result=await observed(f.session.start());assert.equal(result.ok,true,result.error?.message);
  assert.equal(f.session.snapshot().phase,'success');assert.equal(count(f.adapter,P.OP.BEGIN),1);
  assert.equal(f.adapter.log.filter(v=>v==='enterBoot').length,1,'lost ENTER ACK never causes a second ENTER');
  assert.ok(f.adapter.log.includes('connectBoot'));
  f=await fixture(previous,target,{enterDisconnectUnknown:true,connectBootUnavailable:true});
  result=await observed(f.session.start());assert.equal(result.ok,false);
  assert.equal(f.session.snapshot().phase,'recovery');assert.ok(f.session.binding.pending,'unknown ENTER outcome cannot erase pending intent');
  assert.equal(count(f.adapter,P.OP.BEGIN),0);
  f=await fixture(previous,target,{holdAt:P.OP.INFO});const pending=observed(f.session.start());
  await until(()=>count(f.adapter,P.OP.INFO)===1,'first INFO pending');await f.session.cancel();
  result=await pending;assert.equal(result.ok,false);assert.equal(f.session.snapshot().phase,'cancelled');
  await sleep(40);assert.equal(f.adapter.log.filter(v=>v==='connectBoot').length,0,'explicit cancel does not reconnect initial INFO');
  assert.equal(count(f.adapter,P.OP.BEGIN),0);
}

async function writeDisconnectBoundaries(previous,target){
  // Older native bridges reject a write without a code and dispatch disconnect
  // separately. Both callback orders must use actual close evidence, never text.
  for(const order of ['disconnect-first','reject-first']){
    let f=await fixture(previous,target,{plainWriteErrorAt:P.OP.INFO,plainWriteErrorOrder:order});
    let result=await observed(f.session.start());
    assert.equal(result.ok,true,order+': '+result.error?.message);
    assert.equal(f.session.snapshot().phase,'success');
    assert.equal(count(f.adapter,P.OP.INFO),2);assert.equal(count(f.adapter,P.OP.BEGIN),1);
    assert.equal(f.adapter.log.filter(v=>v==='connectBoot').length,1);
    for(const [cmd,offset] of [[P.OP.BEGIN,0],[P.OP.DATA,0],[P.OP.DATA,512]]){
      f=await fixture(previous,target,{plainWriteErrorAt:cmd,plainWriteErrorOrder:order,disconnectFromOffset:offset});
      result=await observed(f.session.start());
      assert.equal(result.ok,false);assert.equal(result.error.code,'DISCONNECTED',order);
      assert.equal(f.session.snapshot().phase,'recovery');assert.equal(f.session.snapshot().busy,false);
      assert.equal(f.session.snapshot().written,false);assert.equal(f.session.snapshot().committed,offset);
      assert.equal(f.session.binding.deviceId,deviceId);assert.equal(f.session.binding.uid,uid);
      assert.deepEqual(f.session.binding.pending,targetOf(target));
      assert.equal(count(f.adapter,P.OP.BEGIN),1);assert.equal(count(f.adapter,P.OP.FINISH),0);
      assert.equal(f.adapter.log.filter(v=>v==='connectBoot').length,0,'BEGIN/DATA loss must require explicit recovery');
      const frames=f.adapter.boot.frames.length;await sleep(40);assert.equal(f.adapter.boot.frames.length,frames);
    }
  }
  let f=await fixture(previous,target,{plainWriteErrorAt:P.OP.INFO});
  let result=await observed(f.session.start());
  assert.equal(result.ok,false);assert.equal(result.error.code,undefined,'an unknown write failure alone is not proof of disconnection');
  assert.equal(result.error.message,'GATT 19: connection closed');
  assert.equal(f.adapter.log.filter(v=>v==='connectBoot').length,0);assert.equal(count(f.adapter,P.OP.BEGIN),0);
  assert.deepEqual(f.session.binding.pending,targetOf(target));
  const gate=defer();f=await fixture(previous,target,{plainWriteErrorAt:P.OP.INFO,plainWriteErrorGate:gate});
  const pending=observed(f.session.start());await until(()=>count(f.adapter,P.OP.INFO)===1,'native write pending');
  await f.session.cancel();gate.resolve();result=await pending;
  assert.equal(result.ok,false);assert.equal(result.error.code,'CANCELLED','explicit cancel wins over the native write rejection');
  assert.equal(f.session.snapshot().phase,'cancelled');assert.equal(f.session.snapshot().busy,false);
  assert.equal(f.adapter.log.filter(v=>v==='connectBoot').length,0);assert.equal(count(f.adapter,P.OP.BEGIN),0);
}

async function installedConfirmation(previous,target){
  const bind=(f,extra={})=>f.session.saveBinding({deviceId,uid,name:'original',pending:targetOf(target),written:false,...extra});
  const noControl=f=>{for(const op of ['prepare','connectApp','disconnect','release','enterBoot','connectBoot'])assert.ok(!f.adapter.log.includes(op),'live confirmation must not '+op);assert.equal(f.adapter.boot.frames.length,0);};
  // Historical written intent is not the canonical target of an explicit new upgrade.
  let f=await fixture(previous,target);bind(f,{pending:targetOf(previous),written:true});
  await f.session.start({recovery:true});assert.equal(f.session.snapshot().phase,'success');assert.equal(count(f.adapter,P.OP.BEGIN),1,'an old pending target must not permanently lock an explicitly confirmed newer upgrade into read-only mode');assert.equal(f.session.binding.pending,null);
  f=await fixture(previous,target);bind(f,{pending:targetOf(previous),written:true});
  await assert.rejects(f.session.start({recovery:true,confirmationOnly:true}),e=>e.code==='IDENTITY');assert.equal(f.session.snapshot().phase,'unconfirmed');assert.equal(count(f.adapter,P.OP.BEGIN),0);assert.deepEqual(f.session.binding.pending,targetOf(previous),'explicit read-only failure must not fall through to a write');
  f=await fixture(target,target);bind(f);let actual=await f.adapter.readApp();let restoreCalled=false;f.adapter.log=[];
  await f.session.confirmInstalled(actual,target,{restore:async()=>{restoreCalled=true;assert.ok(f.session.binding.pending);assert.equal(f.session.snapshot().healthVerifiedEpoch,actual.epoch);}});
  assert.equal(restoreCalled,true);assert.equal(f.session.binding.pending,null);assert.equal(f.session.snapshot().phase,'success');assert.equal(f.session.snapshot().written,true);noControl(f);assert.equal(f.session.snapshot().confirmationOnly,false);
  assert.equal(f.adapter.seq,2);assert.equal(f.adapter.epoch,actual.epoch);
  f=await fixture(target,target);bind(f);f.adapter.deviceId=newDeviceId;actual=await f.adapter.readApp();f.adapter.log=[];
  await f.session.confirmInstalled(actual,target);noControl(f);assert.equal(f.session.binding.deviceId,newDeviceId);assert.equal(f.session.binding.uid,uid);
  assert.equal(f.adapter.adopted[0].previousDeviceId,deviceId);assert.equal(f.session.binding.pending,null);
  for(const patch of [{uid:otherUid},{info:infoFor(target,0,{boardId:259})},{info:infoFor(target,0,{protocol:2})},{info:infoFor(target,0,{imageSize:target.imageSize+1})},{info:infoFor(target,0,{imageSha256:'0'.repeat(64)})},{info:infoFor(target,1)}]){
    f=await fixture(target,target);bind(f);actual={...await f.adapter.readApp(),deviceId:newDeviceId,...patch};const original=f.session.binding;
    await assert.rejects(f.session.confirmInstalled(actual,target),e=>['IDENTITY','BINDING'].includes(e.code));assert.equal(f.session.binding,original);assert.equal(f.adapter.seq,0);assert.equal(f.adapter.adopted,undefined);
  }
  f=await fixture(target,target);bind(f,{uid:otherUid});actual=await f.adapter.readApp();let original=f.session.binding;
  await assert.rejects(f.session.confirmInstalled(actual,target),e=>e.code==='BINDING');assert.equal(f.session.binding,original);
  f=await fixture(target,target);bind(f);actual=await f.adapter.readApp();let live=true;
  await assert.rejects(f.session.confirmInstalled(actual,target,{guard:()=>live,restore:async()=>{live=false;}}),e=>e.code==='CANCELLED');assert.ok(f.session.binding.pending);assert.equal(f.session.snapshot().phase,'unconfirmed');assert.equal(f.session.snapshot().healthVerifiedEpoch,null);noControl({...f,adapter:{...f.adapter,log:f.adapter.log.filter(v=>v!=='readApp:initial-app')}});
  f=await fixture(target,target);bind(f);actual=await f.adapter.readApp();
  await assert.rejects(f.session.confirmInstalled(actual,target,{restore:async()=>{f.session.saveBinding({...f.session.binding,name:'replaced-by-task'});}}),e=>e.code==='BINDING');assert.equal(f.session.binding.name,'replaced-by-task');assert.ok(f.session.binding.pending);
  f=await fixture(target,target);bind(f);actual=await f.adapter.readApp();
  await assert.rejects(f.session.confirmInstalled(actual,target,{queryStatus:async()=>({...await f.adapter.queryStatus(),epoch:'obsolete'})}),e=>e.code==='SESSION');assert.ok(f.session.binding.pending);assert.equal(f.session.snapshot().healthVerifiedEpoch,null);
  f=await fixture(target,target);bind(f);actual=await f.adapter.readApp();let restored=0;
  await assert.rejects(f.session.confirmInstalled(actual,target,{queryStatus:async()=>{const status=await f.adapter.queryStatus();f.session.saveBinding({...f.session.binding,uid:otherUid});return status;},restore:async()=>{restored++;}}),e=>e.code==='BINDING');
  assert.equal(f.session.binding.uid,otherUid);assert.ok(f.session.binding.pending);assert.equal(restored,0);assert.equal(f.adapter.seq,1,'replaced task must not keep querying or restore program mode');
  f=await fixture(target,target);bind(f);original=f.session.binding;f.store.setItem=()=>{throw new Error('disk full');};
  assert.throws(()=>f.session.saveBinding({...original,deviceId:newDeviceId}),e=>e.code==='STORAGE');assert.equal(f.session.binding,original,'failed persistence must not replace live binding');
  // Recovery and normal exact-target paths reuse the just-read App epoch.
  for(const recovery of [false,true]){
    f=await fixture(target,target);bind(f);await f.session.start({recovery});
    assert.equal(f.session.snapshot().phase,'success');assert.equal(f.session.binding.pending,null);assert.equal(count(f.adapter,P.OP.BEGIN),0);
    assert.equal(f.adapter.log.filter(v=>v==='connectApp').length,recovery?1:0);assert.equal(f.adapter.log.filter(v=>v.startsWith('readApp:')).length,1);
    assert.equal(f.adapter.log.filter(v=>v==='disconnect').length,0,'an already verified live App must not be torn down');
  }
  // A written pending retry is read-only even if App confirmation cannot connect.
  f=await fixture(target,target,{connectAppReturnsActual:true,newMac:newDeviceId});bind(f,{written:true});
  await f.session.start({recovery:true,confirmationOnly:true});assert.equal(f.session.snapshot().phase,'success');assert.equal(f.session.binding.deviceId,newDeviceId);
  assert.equal(f.adapter.log.filter(v=>v==='connectApp').length,1);assert.equal(f.adapter.log.filter(v=>v.startsWith('readApp:')).length,1);assert.equal(f.adapter.boot.frames.length,0);
  assert.equal(f.adapter.connectSettings[0].confirmationOnly,true);assert.deepEqual(f.adapter.connectSettings[0].target,targetOf(target));
  f=await fixture(previous,target);bind(f,{written:true});f.adapter.appAvailable=false;
  await assert.rejects(f.session.start({recovery:true}),e=>e.code==='UNCONFIRMED');assert.equal(f.session.snapshot().phase,'unconfirmed');assert.equal(f.session.snapshot().written,true);assert.equal(f.session.snapshot().confirmationOnly,true);assert.ok(f.session.binding.pending);
  assert.equal(f.adapter.log.filter(v=>v==='connectBoot'||v==='enterBoot').length,0);assert.equal(f.adapter.boot.frames.length,0);
  f=await fixture(previous,target);f.adapter.connectApp=async()=>{f.adapter.log.push('connectApp');f.adapter.connected=true;throw Object.assign(new Error('same UID, different App image'),{code:'IMAGE_MISMATCH'});};
  await assert.rejects(f.session.start(),e=>e.code==='IMAGE_MISMATCH');assert.equal(f.session.snapshot().phase,'unconfirmed');assert.ok(f.session.binding.pending);assert.equal(f.adapter.connected,true);
  assert.equal(f.adapter.log.filter(v=>v==='disconnect').length,1,'only pre-confirmation Boot disconnect is allowed; keep mismatching App connected');assert.equal(count(f.adapter,P.OP.BEGIN),1);assert.equal(f.adapter.log.filter(v=>v==='connectBoot').length,0);
  for(const confirmationOnly of [false,true]){
    f=await fixture(confirmationOnly?target:previous,target,{connectAppReturnsActual:true});
    if(confirmationOnly)bind(f,{written:true});let restoredActual=null;
    await assert.rejects(f.session.start({recovery:confirmationOnly,confirmationOnly,restoreConfirmation:async fresh=>{restoredActual=fresh;assert.equal(f.session.snapshot().healthVerifiedEpoch,fresh.epoch);assert.ok(f.session.binding.pending);throw new Error('program/learned restore failed');}}),e=>e.code==='UNCONFIRMED');
    assert.equal(restoredActual.uid,uid);assert.equal(restoredActual.info.imageSha256,target.imageSha256);assert.equal(f.session.snapshot().phase,'unconfirmed');assert.equal(f.session.snapshot().confirmationOnly,true);assert.equal(f.session.snapshot().healthVerifiedEpoch,null);assert.ok(f.session.binding.pending);
    assert.equal(count(f.adapter,P.OP.BEGIN),confirmationOnly?0:1);assert.equal(f.adapter.log.filter(v=>v==='connectBoot').length,0,'restore failure must never trigger raw recovery or another BEGIN');
  }
  // Inspection cannot erase a different UID's record or migrate an unverified locator.
  f=await fixture(previous,target);bind(f);f.adapter.deviceId=newDeviceId;await f.session.inspect();assert.equal(f.session.binding.deviceId,deviceId);assert.ok(f.session.binding.pending);
  f=await fixture(previous,target,{initialUid:otherUid});bind(f);original=f.session.binding;await assert.rejects(f.session.inspect(),e=>e.code==='BINDING');assert.equal(f.session.binding,original);
  await assert.rejects(f.session.start(),e=>e.code==='BINDING');assert.equal(f.session.binding,original);assert.equal(f.adapter.boot.frames.length,0);
}

function statusValidation(){
  const base={epoch:'fresh',seq:7,opcode:4,result:0,sentAt:100,receivedAt:110,data:dataStatus()},last={...base,seq:8,sentAt:620,receivedAt:630};
  const opts={epoch:'fresh',startedAt:90,endedAt:650};assert.equal(validateStatus([base,last],opts),true);
  const cases=[{epoch:'old'},{seq:7},{opcode:3},{result:1},{sentAt:80},{receivedAt:700},
    {data:[5,40,40,40,0x74,0x0e,0]},{data:[0,40,39,40,0x74,0x0e,0]},
    {data:[0,101,101,101,0x74,0x0e,0]},{data:[0,40,40,40,0,0,0]},
    {data:[0,40,40,40,0x74,0x0e,0x10]},{data:[0,40,40,40,0x74,0x0e,8]}];
  for(const patch of cases)assert.throws(()=>validateStatus([base,{...last,...patch}],opts));
  assert.throws(()=>validateStatus([base,{...last,sentAt:120,receivedAt:121}],opts));assert.throws(()=>validateStatus([base,last],{...opts,endedAt:30100}));
}
async function main(){
  const target=await P.verifyPackage(fs.readFileSync(targetFile),{name:path.basename(targetFile)}),previous=await P.verifyPackage(fs.readFileSync(oldFile),{name:path.basename(oldFile)});
  assert.ok(target.version>previous.version,'requires a genuinely signed newer test package');
  statusValidation();
  for(const test of [installedConfirmation,writeDisconnectBoundaries,eventDisconnectBoundaries,normal,currentAndPolicy,cancelAndRecover,confirmation,cancellationBoundaries,bootInfoReconnectGate]){await test(previous,target);console.log('PASS OTA session '+test.name);}
  console.log(`PASS Session orchestration; signed ${previous.versionText} -> ${target.versionText}; mock adapter/Boot only, no hardware`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
