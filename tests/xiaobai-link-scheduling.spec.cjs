'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const localCandidate=path.join(__dirname,'staged/xiaobai-protocol.js');
const file=process.env.LINK_SOURCE||(fs.existsSync(localCandidate)?localCandidate:path.join(__dirname,'../xiaobai-protocol.js'));
class Clock{
 now=10000;next=1;jobs=new Map();
 add(fn,ms=0,repeat=0){const id=this.next++;this.jobs.set(id,{fn,at:this.now+Math.max(0,ms),repeat});return id;}
 async flush(){for(let i=0;i<40;i++)await Promise.resolve();}
 async advance(ms){const end=this.now+ms;await this.flush();for(let i=0;;i++){assert(i<10000);const next=[...this.jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;const[id,j]=next;this.jobs.delete(id);this.now=j.at;if(j.repeat)this.jobs.set(id,{...j,at:this.now+j.repeat});j.fn();await this.flush();}this.now=end;await this.flush();}
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function fixture(onWrite,seed=0x12345677){
 const clock=new Clock();let token=seed,receive;
 const ctx={module:{exports:{}},AbortController,Date:class extends Date{static now(){return clock.now;}},crypto:{getRandomValues(words){words[0]=++token;return words;}},
  setTimeout:(fn,ms)=>clock.add(fn,ms),clearTimeout:id=>clock.jobs.delete(id),setInterval:(fn,ms)=>clock.add(fn,ms,ms),clearInterval:id=>clock.jobs.delete(id)};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),ctx);const P=ctx.module.exports,writes=[];
 const link=new P.Link({start:async fn=>{receive=fn;},close(){},write:async bytes=>{writes.push({bytes:Array.from(bytes),at:clock.now});return onWrite?.(bytes,writes); }},{minWriteMs:0});await link.start();
 return{P,link,clock,writes,rx:bytes=>receive(bytes)};
}
const multi=(kind,task)=>Uint8Array.from([0x5a,0x97,0x98,16,0xc4,1,kind,1,0x40,1,0,0,0,2,0,0,0,task,0,0,0,0,0xa5]);
test('STOP, heartbeat and ACK overtake ordinary FIFO only after the complete native write boundary',async()=>{
 const hold=deferred(),f=await fixture((b,w)=>w.length===1?hold.promise:undefined);
 const first=f.link.write(multi(4,4));await f.clock.flush();
 const action=f.link.write(multi(4,5),undefined,undefined,{priority:10}),begin=f.link.write(multi(16,6),undefined,undefined,{priority:10});
 const ack=f.link.write(multi(10,4),undefined,undefined,{priority:2}),hb=f.link.write(f.P.command(0,3)),stop=f.link.write(f.P.command(0,5));
 await f.clock.advance(500);assert.equal(f.writes.length,1,'no priority job splits an in-flight frame');
 hold.resolve();await f.clock.advance(240);await Promise.all([first,action,begin,ack,hb,stop]);
 assert.deepEqual(f.writes.map(w=>w.bytes[4]===0xc4?[w.bytes[6],w.bytes[17]]:[w.bytes[6],0]),[[4,4],[5,0],[3,0],[10,4],[4,5],[16,6]]);
 f.link.close();
});
test('continuous RX cannot renew normal write eligibility; urgent safety does not wait for RX quiet',async()=>{
 const f=await fixture(),tick=f.clock.add(()=>f.rx(Uint8Array.of(0)),10,10);f.rx(Uint8Array.of(0));
 const normal=f.link.write(f.P.command(1,0x41,[1]));await f.clock.advance(40);assert.equal(await normal,true);assert.equal(f.writes[0].at,10040);
 const ack=f.link.write(multi(10,5),undefined,undefined,{priority:2});await f.clock.advance(40);await ack;assert.equal(f.writes[1].at,10080);
 f.clock.jobs.delete(tick);f.link.close();
});
test('ACK burst yields one ordinary frame while preserving first ACTION/BEGIN task order',async()=>{
 const hold=deferred(),f=await fixture((b,w)=>w.length===1?hold.promise:undefined),all=[f.link.write(multi(4,4))];await f.clock.flush();
 all.push(f.link.write(multi(4,5),undefined,undefined,{priority:10}),f.link.write(multi(16,6),undefined,undefined,{priority:10}));
 for(let i=0;i<8;i++)all.push(f.link.write(multi(10,7+i),undefined,undefined,{priority:2}));
 hold.resolve();await f.clock.advance(500);await Promise.all(all);
 assert.equal(f.writes[5].bytes[6],4,'after four ACK frames one waiting action gets the radio');
 assert.deepEqual(f.writes.filter(w=>[4,16].includes(w.bytes[6])).map(w=>w.bytes[17]),[4,5,6]);f.link.close();
});
test('full ordinary queue admits ACK and STOP and invalidates evicted unsent work',async()=>{
 const hold=deferred(),f=await fixture((b,w)=>w.length===1?hold.promise:undefined),first=f.link.write(multi(4,1));await f.clock.flush();f.link.maxQueuedWrites=3;
 const normal=[2,3,4].map(id=>f.link.write(multi(4,id),undefined,undefined,{priority:10}));
 const ack=f.link.write(multi(10,1),undefined,undefined,{priority:2});assert.equal(await normal[0],false);
 const stop=f.link.write(f.P.command(0,5));assert.equal(await normal[1],false);
 hold.resolve();await f.clock.advance(200);await Promise.all([first,ack,stop,...normal]);
 assert.deepEqual(f.writes.map(w=>w.bytes[4]===0xc4?w.bytes[6]:w.bytes[6]),[4,5,10,4]);f.link.close();
});
test('ENTER token and run serial span STOP and short suspend, and reset on a new physical Link',async()=>{
 const f=await fixture(),a=f.link.enterProgram(),b=f.link.enterProgram();assert.equal(a,b);await f.clock.flush();await a;
 assert.deepEqual(f.writes[0].bytes.slice(7,15),[0x78,0x56,0x34,0x12,0,0,0,0]);
 assert.equal(f.link.programLinkToken,0x12345678);assert.equal(f.link.nextProgramRunSerial(),1);assert.equal(f.link.nextProgramRunSerial(),2);
 await f.link.enterProgram();assert.equal(f.writes.length,1);
 const stop=f.link.stopProgram();await f.clock.advance(40);await stop;assert.equal(f.link.programLinkToken,0x12345678);assert.equal(f.link.nextProgramRunSerial(),3);
 const suspended=f.link.suspendProgram();await f.clock.advance(40);await suspended;assert.equal(f.link.programLinkToken,0x12345678);assert.throws(()=>f.link.nextProgramRunSerial(),e=>e.code==='CANCELLED');
 const resume=f.link.enterProgram();await f.clock.advance(40);await resume;assert.equal(f.link.programLinkToken,0x12345678);assert.equal(f.link.nextProgramRunSerial(),4);
 f.link.programRunSerial=0xffffffff;assert.throws(()=>f.link.nextProgramRunSerial(),e=>e.code==='EXHAUSTED');f.link.close();assert.equal(f.link.programLinkToken,0);assert.equal(f.clock.jobs.size,0);
 const fresh=await fixture(undefined,0xabcdef22);const freshEntry=fresh.link.enterProgram();await fresh.clock.flush();await freshEntry;assert.equal(fresh.link.programLinkToken,0xabcdef23);assert.equal(fresh.link.nextProgramRunSerial(),1);fresh.link.close();
});
test('cancelled program entry cannot publish its token or revive heartbeat after a newer mode request',async()=>{
 const hold=deferred(),f=await fixture((b,w)=>w.length===1?hold.promise:undefined),blocked=f.link.write(f.P.command(0,3));await f.clock.flush();
 const old=f.link.enterProgram(),remote=f.link.enterRemote();hold.resolve();await f.clock.advance(120);await Promise.all([blocked,old,remote]);
 assert.deepEqual(f.writes.map(w=>w.bytes[6]),[3,2]);assert.equal(f.link.programLinkToken,0);assert.equal(f.link.heartbeatTimer,null);f.link.close();
});

function rxFrame(f,type,data){const bytes=f.P.frame(type,data);bytes[1]=0x98;bytes[2]=0x97;bytes[15]=Array.from(bytes.slice(0,15)).reduce((a,b)=>a+b,0)&255;f.rx(bytes);}
function status(f,seq,mode){rxFrame(f,0xd2,[seq,f.P.OP.QUERY_STATUS,0,mode,0,0,0,0,0,0]);}
function modeEvent(f,mode,counter=1){rxFrame(f,0xd3,[1,counter,mode]);}
function abortEvent(f,mode,reason=1,counter=1){rxFrame(f,0xd3,[2,counter,reason,mode]);}
async function entered(f){const task=f.link.enterProgram();await f.clock.advance(80);await task;return f.link.programLinkToken;}

test('confirmed D3 watchdog exit retires token and resets serial before the next program entry',async()=>{
 const f=await fixture(),old=await entered(f);assert.equal(f.link.nextProgramRunSerial(),1);
 abortEvent(f,f.P.MODE.VOICE,1);assert.equal(f.link.programLinkToken,0);assert.equal(f.link.programRunSerial,0);assert.equal(f.link.heartbeatTimer,null);
 assert.throws(()=>f.link.nextProgramRunSerial(),e=>e.code==='CANCELLED');
 await entered(f);assert.notEqual(f.link.programLinkToken,old);assert.equal(f.link.nextProgramRunSerial(),1);
 assert.equal(f.writes.filter(w=>w.bytes[6]===f.P.OP.QUERY_STATUS).length,0,'reliable exit requires no probe');f.link.close();
});

test('sensor or ASR abort still in PROGRAM retains token high-water but cannot leave a running session',async()=>{
 const f=await fixture(),old=await entered(f);assert.equal(f.link.nextProgramRunSerial(),1);
 abortEvent(f,f.P.MODE.PROGRAM,7);assert.equal(f.link.programLinkToken,old);assert.equal(f.link.programRunSerial,1);assert.equal(f.link.mode,f.P.MODE.PROGRAM);
 assert.equal(f.link.heartbeatTimer,null);assert.throws(()=>f.link.nextProgramRunSerial(),e=>e.code==='CANCELLED');
 await entered(f);assert.equal(f.link.programLinkToken,old);assert.equal(f.link.nextProgramRunSerial(),2);
 assert.equal(f.writes.filter(w=>w.bytes[6]===f.P.OP.QUERY_STATUS).length,0);f.link.close();
});

test('an actually written REMOTE without D3 requires one fresh status and retires token only after confirming exit',async()=>{
 let f;f=await fixture(bytes=>{if(bytes[6]===4)status(f,bytes[5],f.P.MODE.REMOTE);});
 const old=await entered(f);assert.equal(f.link.nextProgramRunSerial(),1);
 const remote=f.link.enterRemote();await f.clock.advance(80);await remote;
 assert.equal(f.link.programLinkToken,old,'native completion is not proof that the MCU exited');
 await entered(f);assert.notEqual(f.link.programLinkToken,old);assert.equal(f.link.nextProgramRunSerial(),1);
 assert.deepEqual(f.writes.map(w=>w.bytes[6]),[1,2,4,1]);assert.notEqual(f.writes[2].bytes[5],0);f.link.close();
});

test('REMOTE whose status is still PROGRAM preserves token and monotonic serial',async()=>{
 let f;f=await fixture(bytes=>{if(bytes[6]===4)status(f,bytes[5],f.P.MODE.PROGRAM);});
 const old=await entered(f);f.link.nextProgramRunSerial();const remote=f.link.enterRemote();await f.clock.advance(80);await remote;
 await entered(f);assert.equal(f.link.programLinkToken,old);assert.equal(f.link.nextProgramRunSerial(),2);
 assert.deepEqual(f.writes.map(w=>w.bytes[6]),[1,2,4,1]);f.link.close();
});

test('reliable REMOTE mode D3 clears token even after optimistic native completion changed link.mode',async()=>{
 const f=await fixture(),old=await entered(f);f.link.nextProgramRunSerial();const remote=f.link.enterRemote();await f.clock.advance(80);await remote;
 assert.equal(f.link.mode,f.P.MODE.REMOTE);assert.equal(f.link.programLinkToken,old);
 modeEvent(f,f.P.MODE.REMOTE);assert.equal(f.link.programLinkToken,0);await entered(f);assert.notEqual(f.link.programLinkToken,old);
 assert.equal(f.link.nextProgramRunSerial(),1);assert.equal(f.writes.filter(w=>w.bytes[6]===4).length,0);f.link.close();
});

test('long suspend with lost exit D3 queries once with fresh seq before choosing a new token',async()=>{
 let f;f=await fixture(bytes=>{if(bytes[6]===4)status(f,bytes[5],f.P.MODE.VOICE);});
 const old=await entered(f);f.link.nextProgramRunSerial();const pause=f.link.suspendProgram();await f.clock.advance(80);await pause;
 await f.clock.advance(1200);await entered(f);
 assert.notEqual(f.link.programLinkToken,old);assert.equal(f.link.nextProgramRunSerial(),1);
 assert.deepEqual(f.writes.map(w=>w.bytes[6]),[1,5,4,1]);assert.notEqual(f.writes[2].bytes[5],0);f.link.close();
});

test('long suspend whose fresh status remains PROGRAM reuses token without any periodic status probes',async()=>{
 let f;f=await fixture(bytes=>{if(bytes[6]===4)status(f,bytes[5],f.P.MODE.PROGRAM);});
 const old=await entered(f);f.link.nextProgramRunSerial();const pause=f.link.suspendProgram();await f.clock.advance(80);await pause;
 await f.clock.advance(1200);assert.equal(f.writes.filter(w=>w.bytes[6]===4).length,0);
 await entered(f);assert.equal(f.link.programLinkToken,old);assert.equal(f.link.nextProgramRunSerial(),2);
 await f.clock.advance(1200);assert.equal(f.writes.filter(w=>w.bytes[6]===4).length,1,'normal heartbeat does not poll status');f.link.close();
});

test('old status seq and cancelled entry cannot revive token, mode ownership or heartbeat',async()=>{
 const f=await fixture(),old=await entered(f);const remote=f.link.enterRemote();await f.clock.advance(80);await remote;
 const entering=f.link.enterProgram();entering.catch(()=>{});await f.clock.advance(80);const request=f.writes.find(w=>w.bytes[6]===4);assert(request);
 status(f,request.bytes[5]%255+1,f.P.MODE.PROGRAM);await f.clock.flush();assert.equal(f.writes.filter(w=>w.bytes[6]===1).length,1);
 const cancel=f.link.suspendProgram();await f.clock.advance(80);await cancel;await assert.rejects(entering);
 status(f,request.bytes[5],f.P.MODE.PROGRAM);modeEvent(f,f.P.MODE.PROGRAM,9);await f.clock.flush();
 assert.equal(f.link.programLinkToken,old);assert.equal(f.link.heartbeatTimer,null);assert.equal(f.link.desiredMode,null);
 assert.throws(()=>f.link.nextProgramRunSerial(),e=>e.code==='CANCELLED');assert.equal(f.writes.filter(w=>w.bytes[6]===1).length,1);f.link.close();
});

test('cancelled queued REMOTE that never reaches the radio adds no probe to a short resume',async()=>{
 const hold=deferred();let blocking=false;const f=await fixture(bytes=>blocking&&bytes[6]===0x41?hold.promise:undefined),old=await entered(f);
 f.link.nextProgramRunSerial();blocking=true;const first=f.link.write(f.P.command(1,0x41,[1]));await f.clock.advance(40);
 const remote=f.link.enterRemote();await f.clock.flush();const resume=f.link.enterProgram();hold.resolve();await f.clock.advance(160);await Promise.all([first,remote,resume]);
 assert.equal(f.link.programLinkToken,old);assert.equal(f.link.nextProgramRunSerial(),2);
 assert.equal(f.writes.filter(w=>w.bytes[6]===2||w.bytes[6]===4).length,0);f.link.close();
});

test('a queued short resume crossing the watchdog fence probes before sending its reused token',async()=>{
 const hold=deferred();let f,blocking=false;f=await fixture(bytes=>{if(blocking&&bytes[6]===0x41)return hold.promise;if(bytes[6]===4)status(f,bytes[5],f.P.MODE.VOICE);});
 const old=await entered(f);f.link.nextProgramRunSerial();const pause=f.link.suspendProgram();await f.clock.advance(80);await pause;
 blocking=true;const first=f.link.write(f.P.command(1,0x41,[1]));await f.clock.advance(40);
 const resume=f.link.enterProgram();await f.clock.advance(1100);hold.resolve();await f.clock.advance(160);await Promise.all([first,resume]);
 assert.notEqual(f.link.programLinkToken,old);assert.equal(f.link.nextProgramRunSerial(),1);
 assert.deepEqual(f.writes.slice(-2).map(w=>w.bytes[6]),[4,1]);f.link.close();
});
