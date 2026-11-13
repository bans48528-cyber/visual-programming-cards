'use strict';
// Shipping Link with a virtual clock and a held native-write boundary; no device.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
class Clock{
  now=10000;next=1;jobs=new Map();
  add(fn,delay=0,repeat=0){const id=this.next++;this.jobs.set(id,{fn,at:this.now+Math.max(0,delay),repeat});return id;}
  async flush(){for(let i=0;i<24;i++)await Promise.resolve();}
  async advance(ms){
    const end=this.now+ms;await this.flush();
    for(let n=0;;n++){
      assert(n<10000,'bounded timer processing');
      const next=[...this.jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(!next)break;
      const[id,j]=next;this.jobs.delete(id);this.now=j.at;
      if(j.repeat)this.jobs.set(id,{...j,at:this.now+j.repeat});j.fn();await this.flush();
    }
    this.now=end;await this.flush();
  }
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const outcome=promise=>{const result={settled:false};result.done=promise.then(value=>Object.assign(result,{settled:true,value}),error=>Object.assign(result,{settled:true,error}));return result;};
async function fixture(onWrite){
  const clock=new Clock(),context={module:{exports:{}},AbortController,
    Date:class extends Date{static now(){return clock.now;}},
    setTimeout:(fn,ms)=>clock.add(fn,ms),clearTimeout:id=>clock.jobs.delete(id),
    setInterval:(fn,ms)=>clock.add(fn,ms,ms),clearInterval:id=>clock.jobs.delete(id)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../xiaobai-protocol.js'),'utf8'),context);
  const P=context.module.exports,writes=[];let receive;
  const reply=(seq,opcode,args=[])=>{
    const bytes=P.frame(0xd2,[seq,opcode,0,...args]);bytes[1]=0x98;bytes[2]=0x97;
    bytes[15]=bytes.slice(0,15).reduce((sum,b)=>sum+b,0)&255;receive(bytes);
  };
  const link=new P.Link({start:async fn=>{receive=fn;},close(){},write:async bytes=>{
    writes.push({seq:bytes[5],op:bytes[6],part:bytes[7],at:clock.now});
    return onWrite?.({bytes,reply,clock,writes});
  }},{minWriteMs:0});
  await link.start();return{clock,P,link,writes,reply};
}
test('response budget starts at transmission, after a queue delay longer than that budget',async()=>{
  const hold=deferred();const f=await fixture(({bytes,reply,clock})=>{
    if(bytes[6]===3)return hold.promise;
    clock.add(()=>reply(bytes[5],bytes[6],[bytes[7]]),80);
  });
  const first=f.link.write(f.P.command(0,f.P.OP.HEARTBEAT));
  const result=outcome(f.link.request(1,0x60,[11],100,data=>data[0]===11,{deadlineAt:f.clock.now+2000}));
  await f.clock.advance(500);assert.equal(result.settled,false);assert.equal(f.writes.length,1);
  hold.resolve();await f.clock.flush();await first;await f.clock.advance(40);
  assert.equal(f.writes[1].at,10540);await f.clock.advance(79);assert.equal(result.settled,false);
  await f.clock.advance(1);await result.done;assert.equal(result.value[0],11);assert.equal(f.link.pending.size,0);f.link.close();
});
test('response timeout rejects even while the current native write Promise is held',async()=>{
  const hold=deferred(),f=await fixture(()=>hold.promise);
  const result=outcome(f.link.request(2,0x60,[11],100));
  await f.clock.advance(100);await result.done;assert.equal(result.error.code,'TIMEOUT');assert.equal(f.link.pending.size,0);
  hold.resolve();await f.clock.flush();f.reply(2,0x60,[11]);assert.equal(result.error.code,'TIMEOUT');f.link.close();
});
test('total deadline rejects and invalidates a request still waiting in the write queue',async()=>{
  const hold=deferred(),f=await fixture(()=>hold.promise);
  const first=f.link.write(f.P.command(0,f.P.OP.HEARTBEAT));
  const result=outcome(f.link.request(3,0x60,[11],1000,null,{deadlineAt:f.clock.now+200}));
  await f.clock.advance(200);await result.done;assert.equal(result.error.code,'DEADLINE');assert.equal(f.link.pending.size,0);
  hold.resolve();await f.clock.advance(100);await first;assert.equal(f.writes.length,1);f.link.close();
});
test('total deadline also bounds native completion after an early valid response',async()=>{
  const hold=deferred(),f=await fixture(({bytes,reply})=>{reply(bytes[5],bytes[6],[11]);return hold.promise;});
  const result=outcome(f.link.request(4,0x60,[11],100,null,{deadlineAt:f.clock.now+150}));
  await f.clock.advance(149);assert.equal(result.settled,false);
  await f.clock.advance(1);await result.done;assert.equal(result.error.code,'DEADLINE');
  hold.resolve();await f.clock.flush();assert.equal(f.clock.jobs.size,0);f.link.close();
});
test('abort removes a queued request immediately and it never reaches the transport',async()=>{
  const hold=deferred(),f=await fixture(()=>hold.promise),controller=new AbortController();
  const first=f.link.write(f.P.command(0,f.P.OP.HEARTBEAT));
  const result=outcome(f.link.request(5,0x60,[11],100,null,{signal:controller.signal,deadlineAt:f.clock.now+1000}));
  controller.abort();await f.clock.flush();await result.done;assert.equal(result.error.code,'CANCELLED');
  assert.equal(f.link.pending.size,0);hold.resolve();await f.clock.advance(100);await first;
  assert.equal(f.writes.length,1);assert.equal(f.clock.jobs.size,0);f.link.close();
});
test('late and duplicate replies after abort cannot complete a fresh sequence',async()=>{
  const f=await fixture(),controller=new AbortController();
  const old=outcome(f.link.request(6,0x60,[11],100,null,{signal:controller.signal}));await f.clock.flush();
  controller.abort();await f.clock.flush();await old.done;assert.equal(old.error.code,'CANCELLED');
  const fresh=outcome(f.link.request(7,0x60,[11],100));await f.clock.advance(40);
  f.reply(6,0x60,[11]);f.reply(6,0x60,[11]);await f.clock.flush();assert.equal(fresh.settled,false);
  f.reply(7,0x60,[11]);await f.clock.flush();await fresh.done;assert.equal(fresh.value[0],11);
  assert.equal(f.link.pending.size,0);f.link.close();
});
test('stale guard cancels before transmission without leaving timers or a pending request',async()=>{
  const f=await fixture();const result=outcome(f.link.request(8,0x60,[0],100,null,{guard:()=>false,deadlineAt:f.clock.now+1000}));
  await f.clock.flush();await result.done;assert.equal(result.error.code,'CANCELLED');
  assert.equal(f.writes.length,0);assert.equal(f.link.pending.size,0);assert.equal(f.clock.jobs.size,0);f.link.close();
});
test('native write rejection is preserved and cleans the reply deadline',async()=>{
  const error=Object.assign(new Error('native GATT rejected'),{code:'GATT_ERROR'}),f=await fixture(()=>{throw error;});
  const result=outcome(f.link.request(9,0x60,[0],100,null,{deadlineAt:f.clock.now+1000}));
  await f.clock.flush();await result.done;assert.equal(result.error,error);
  assert.equal(f.link.pending.size,0);assert.equal(f.clock.jobs.size,0);f.link.close();
});
test('heartbeat eviction rejects an unsent request even without a total deadline',async()=>{
  const hold=deferred(),f=await fixture(()=>hold.promise);
  const first=f.link.write(f.P.command(0,f.P.OP.HEARTBEAT));
  const result=outcome(f.link.request(10,0x60,[11],100));
  const queued=Array.from({length:31},()=>f.link.write(f.P.command(0,f.P.OP.QUERY_STATUS)));
  assert.equal(f.link.writeJobs.length,32);
  const urgent=f.link.write(f.P.command(0,f.P.OP.HEARTBEAT));
  await f.clock.flush();await result.done;assert.equal(result.error.code,'CANCELLED');
  assert.equal(f.link.pending.size,0);assert.equal(f.writes.length,1);
  f.link.close();hold.resolve();await f.clock.flush();await Promise.all([first,urgent,...queued]);
  assert.equal(f.writes.length,1);assert.equal(f.clock.jobs.size,0);
});
