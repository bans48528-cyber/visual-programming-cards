'use strict';
// Shipping readApp + real Link/receiver. Only the radio replies and clock edge
// are synthetic; no Android bridge, hardware, firmware signing or program DONE.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const P=require('../xiaobai-protocol.js'),Ota=require('../xiaobai-ota-protocol.js');
const code=fs.readFileSync(require.resolve('../android-bluetooth.js'),'utf8');
const first=code.indexOf('    async readApp('),last=code.indexOf('    async queryStatus(){',first);
assert(first>=0&&last>first);
const method=code.slice(first,last);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const observed=p=>p.then(value=>({value}),error=>({error}));
async function until(predicate){for(let i=0;i<300&&!predicate();i++)await sleep(2);assert(predicate(),'expected wire request');}
const uid='00112233445566778899aabb';
function infoBytes(schema=2){
  const b=Buffer.alloc(schema===1?60:72),release=JSON.parse(fs.readFileSync(require.resolve('../assets/firmware/release.json'),'utf8')).firmware;
  b.writeUInt32LE(Ota.C.OTA_INFO_MAGIC,0);b.writeUInt16LE(schema,4);b.writeUInt16LE(258,6);
  b.writeUInt32LE(0x20000,8);b.writeUInt32LE(release.version,12);b[16]=0;b[17]=1;
  b.writeUInt32LE(schema===1?320:release.imageSize,20);Buffer.from(release.imageSha256,'hex').copy(b,28);
  if(schema!==1){b.writeUInt32LE(2,60);b.writeUInt32LE(0x08003000,64);b.writeUInt16LE(128,68);b.writeUInt16LE(15,70);}
  return b;
}
function response(req,data=[],result=0){
  const frame=P.frame(0xd2,[req.seq,req.op,result,...data]);frame[1]=0x98;frame[2]=0x97;
  frame[15]=frame.subarray(0,15).reduce((sum,n)=>sum+n,0)&255;return frame;
}
async function fixture(t,options={}){
  const raw=infoBytes(options.schema||2),writes=[],traces=[];let receive;
  const link=new P.Link({async start(fn){receive=fn;},close(){},async write(bytes){
    const req={seq:bytes[5],op:bytes[6],part:bytes[7],bytes:Array.from(bytes),at:Date.now()};writes.push(req);
    const reply=(data,result=0,original=req)=>receive(response(original,data,result));
    if(options.onRequest&&await options.onRequest(req,{reply,raw,link,context,writes})===false)return;
    if(req.op===P.OP.QUERY_STATUS)reply([4,50,50,50,0x74,0x0e,0]);
    else if(req.op===0x60)reply([req.part,...raw.subarray(req.part*6,req.part*6+6)]);
    else if(req.op===P.OP.READ_UID)reply([req.part,...Buffer.from(uid,'hex').subarray(req.part*6,req.part*6+6)]);
    else throw Error('unexpected identity opcode '+req.op);
  }},{minWriteMs:0});
  await link.start();link.mode=4;link.desiredMode=4;
  const context={current:{connectionId:'epoch-1',deviceId:'EC:B0:DC:30:78:0E',name:'BT_ECB0DC30780E'},link,protocol:P,XiaobaiOtaProtocol:Ota,
    nameOf:device=>device.name,trace:(...args)=>traces.push(args),Date:options.Date||Date};
  const read=vm.runInNewContext(`({${method}}).readApp`,context,{filename:'android-bluetooth.js:readApp'});
  t.after(()=>link.close());
  return {read:args=>read(args),link,context,writes,traces,raw,infoRequests:()=>writes.filter(r=>r.op===0x60),uidRequests:()=>writes.filter(r=>r.op===P.OP.READ_UID)};
}

test('lost INFO11 retries only that part with a new seq; late/duplicate replies never complete the retry',async t=>{
  let first11,retried=false;
  const f=await fixture(t,{onRequest(req,{reply,raw}){
    if(req.op===0x60&&req.part===3){reply([3,...raw.subarray(18,24)]);reply([3,...raw.subarray(18,24)]);return false;}
    if(req.op!==0x60||req.part!==11)return;
    if(!first11){first11=req;return false;}
    retried=true;assert.notEqual(req.seq,first11.seq);
    // Same part index with the old sequence is deliberately invalid content.
    reply([11,9,9,9,9,9,9],0,first11);reply([11,9,9,9,9,9,9],0,first11);
  }});
  const result=await f.read();
  assert(retried);assert.deepEqual(f.infoRequests().map(r=>r.part),[0,1,2,3,4,5,6,7,8,9,10,11,11]);
  assert.equal(f.uidRequests().length,2);assert.equal(result.uid,uid);assert.equal(result.info.schemaVersion,2);
  assert.equal(result.info.activeAppBase,0x08003000);assert.equal(result.info.erasePage,128);assert.equal(result.name,'BT_ECB0DC30780E');
  assert.equal(f.traces.length,1);assert.equal(f.link.pending.size,0);
});

test('a second missing INFO11 ends without rereading INFO0 or accepting a partial identity',async t=>{
  const f=await fixture(t,{onRequest:req=>req.op===0x60&&req.part===11?false:undefined});
  await assert.rejects(f.read(),error=>error.code==='TIMEOUT'&&error.opcode===0x60&&error.part===11&&/第12段.*重试确认/.test(error.message));
  assert.deepEqual(f.infoRequests().map(r=>r.part),[0,1,2,3,4,5,6,7,8,9,10,11,11]);
  assert.equal(f.uidRequests().length,0);assert.equal(f.link.pending.size,0);
});

test('legacy INFO schema1 requests ten parts, keeps keepalive, then reads both UID parts',async t=>{
  const f=await fixture(t,{schema:1}),result=await f.read();
  assert.deepEqual(f.infoRequests().map(r=>r.part),Array.from({length:10},(_,i)=>i));
  assert.deepEqual(f.uidRequests().map(r=>r.part),[0,1]);assert.equal(result.info.schemaVersion,1);assert.equal(result.uid,uid);
  assert(f.writes.filter(r=>r.op===P.OP.QUERY_STATUS).length>=6);
});

test('device rejection of UID is final, not a timeout retry or fabricated identity',async t=>{
  const f=await fixture(t,{onRequest(req,{reply}){if(req.op===P.OP.READ_UID){reply([],2);return false;}}});
  await assert.rejects(f.read(),error=>error.result===2&&error.opcode===P.OP.READ_UID);
  assert.deepEqual(f.uidRequests().map(r=>r.part),[0]);assert.equal(f.infoRequests().length,12);
});

test('a missing UID1 retries only UID1 and retains the required complete UID',async t=>{
  let missed=false;
  const f=await fixture(t,{onRequest(req){if(req.op===P.OP.READ_UID&&req.part===1&&!missed){missed=true;return false;}}});
  const result=await f.read();
  assert.deepEqual(f.uidRequests().map(r=>r.part),[0,1,1]);assert.equal(f.infoRequests().length,12);assert.equal(result.uid,uid);
});

test('epoch replacement during INFO cannot combine old parts with the new connection',async t=>{
  const f=await fixture(t,{onRequest(req,{context}){if(req.op===0x60&&req.part===6)context.current={...context.current,connectionId:'epoch-2'};}});
  await assert.rejects(f.read(),{code:'STALE'});
  assert.deepEqual(f.infoRequests().map(r=>r.part),[0,1,2,3,4,5,6]);assert.equal(f.uidRequests().length,0);
  // An explicit retry after the replacement builds a completely fresh snapshot.
  const second=await f.read();assert.equal(second.epoch,'epoch-2');
  assert.deepEqual(f.infoRequests().slice(7).map(r=>r.part),Array.from({length:12},(_,i)=>i));
});

test('mode generation changes fail immediately and never trigger a whole-identity retry',async t=>{
  const f=await fixture(t,{onRequest(req,{link}){if(req.op===0x60&&req.part===2)link.modeVersion++;}});
  await assert.rejects(f.read(),{code:'STALE'});assert.deepEqual(f.infoRequests().map(r=>r.part),[0,1,2]);assert.equal(f.uidRequests().length,0);
});

test('replacement Link cannot adopt a late response from the old Link',async t=>{
  const f=await fixture(t,{onRequest(req,{context}){if(req.op===0x60&&req.part===3)context.link={closed:false};}});
  await assert.rejects(f.read(),{code:'STALE'});assert.deepEqual(f.infoRequests().map(r=>r.part),[0,1,2,3]);assert.equal(f.uidRequests().length,0);
});

test('QUERY_STATUS mode change is rejected even if the mode event was missed',async t=>{
  let statuses=0;
  const f=await fixture(t,{onRequest(req,{reply}){if(req.op===P.OP.QUERY_STATUS&&++statuses===2){reply([0,50,50,50,0x74,0x0e,0]);return false;}}});
  await assert.rejects(f.read(),{code:'MODE'});assert.deepEqual(f.infoRequests().map(r=>r.part),[0,1]);assert.equal(f.uidRequests().length,0);
});

test('abort exits a hung native write promptly and invalidates the uncommitted snapshot',async t=>{
  let release;const held=new Promise(resolve=>release=resolve),controller=new AbortController();
  const f=await fixture(t,{onRequest:async req=>{if(req.op===P.OP.QUERY_STATUS){await held;return false;}}});
  const done=observed(f.read({signal:controller.signal}));await until(()=>f.writes.length===1);
  const began=Date.now();controller.abort();const result=await done;release();
  assert.equal(result.error.code,'CANCELLED');assert(Date.now()-began<400);assert.equal(f.link.pending.size,0);assert.equal(f.infoRequests().length,0);
});

test('the overall 18s deadline also bounds time spent waiting on native write',async t=>{
  let firstClock=true,release;const held=new Promise(resolve=>release=resolve);
  // The VM clock advances 17.9s between snapshot start and dispatch; real Link
  // gets the same absolute deadline with ~100ms remaining, including queue time.
  const clock={now(){if(firstClock){firstClock=false;return Date.now()-17900;}return Date.now();}};
  const f=await fixture(t,{Date:clock,onRequest:async req=>{if(req.op===P.OP.QUERY_STATUS){await held;return false;}}});
  const began=Date.now(),result=await observed(f.read());release();
  assert.equal(result.error.code,'IDENTITY_TIMEOUT');assert(Date.now()-began<600);assert.equal(f.link.pending.size,0);assert.equal(f.infoRequests().length,0);
});

test('the overall deadline bounds a status query queued behind a previous native write',async t=>{
  let firstClock=true,release;const held=new Promise(resolve=>release=resolve);
  const clock={now(){if(firstClock){firstClock=false;return Date.now()-17900;}return Date.now();}};
  const f=await fixture(t,{Date:clock,onRequest:async req=>{if(req.op===P.OP.READ_TILT){await held;return false;}}});
  const previous=f.link.write(P.command(99,P.OP.READ_TILT));await until(()=>f.writes.length===1);
  const began=Date.now(),result=await observed(f.read());
  assert.equal(result.error.code,'IDENTITY_TIMEOUT');assert(Date.now()-began<600);assert.equal(f.link.pending.size,0);
  release();await previous;await sleep(70);
  assert.deepEqual(f.writes.map(r=>r.op),[P.OP.READ_TILT],'expired queued identity request must never transmit later');
});

test('slow native completion with 300ms heartbeat recovers lost INFO11 inside the 18s identity budget',{timeout:25000},async t=>{
  let lost11;const pendingTimers=new Set();
  const later=(fn,ms)=>{const timer=setTimeout(()=>{pendingTimers.delete(timer);fn();},ms);pendingTimers.add(timer);};
  t.after(()=>{for(const timer of pendingTimers)clearTimeout(timer);});
  const f=await fixture(t,{async onRequest(req,{reply,raw}){
    if(req.op===0x60&&req.part===11&&!lost11)lost11=req;
    else if(req.op===P.OP.QUERY_STATUS)later(()=>reply([4,50,50,50,0x74,0x0e,0]),40);
    else if(req.op===0x60){
      const data=[req.part,...raw.subarray(req.part*6,req.part*6+6)];
      if(req.part===11){
        assert.notEqual(req.seq,lost11.seq);
        later(()=>reply([11,9,9,9,9,9,9],0,lost11),10);
        later(()=>reply([11,9,9,9,9,9,9],0,lost11),25);
      }
      later(()=>reply(data),40);later(()=>reply(data),75);
    }else if(req.op===P.OP.READ_UID)later(()=>reply([req.part,...Buffer.from(uid,'hex').subarray(req.part*6,req.part*6+6)]),40);
    else assert.equal(req.op,P.OP.HEARTBEAT);
    await sleep(200);return false;
  }});
  f.link.startHeartbeat();const began=Date.now(),result=await f.read(),elapsed=Date.now()-began;
  assert.equal(result.uid,uid);assert.equal(result.info.schemaVersion,2);assert.equal(result.info.activeAppBase,0x08003000);
  assert.equal(result.info.erasePage,128);assert.equal(result.info.imageSha256,Buffer.from(f.raw.subarray(28,60)).toString('hex'));
  assert.equal(result.epoch,'epoch-1');assert.equal(result.deviceId,'EC:B0:DC:30:78:0E');
  assert.deepEqual(f.infoRequests().map(r=>r.part),[0,1,2,3,4,5,6,7,8,9,10,11,11]);
  assert.deepEqual(f.uidRequests().map(r=>r.part),[0,1]);
  const firstInfo=f.infoRequests()[0],infoSpan=lost11.at-firstInfo.at,heartbeats=f.writes.filter(r=>r.op===P.OP.HEARTBEAT).length;
  assert(infoSpan>=6000,'must exercise the observed multi-second identity collection, not a fast radio');
  assert(elapsed<18000,'successful retry must fit the production whole-identity deadline');assert(heartbeats>=15);
  assert.equal(f.link.pending.size,0);
  t.diagnostic(JSON.stringify({nativeCompletionMs:200,notificationDelayMs:40,heartbeatMs:300,firstInfoToLost11Ms:infoSpan,totalIdentityMs:elapsed,heartbeats,infoRequests:13,uidRequests:2}));
});
