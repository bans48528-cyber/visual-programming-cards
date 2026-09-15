const assert=require('node:assert/strict');
const {Link,frame,CMD}=require('../spark-protocol.js');
class Transport {
  properties={notify:true,writeWithoutResponse:true};
  writes=[];active=0;maxActive=0;closed=false;disconnected=false;
  async start(receive) {this.receive=receive;}
  async write(bytes) {
    this.active++;this.maxActive=Math.max(this.active,this.maxActive);this.writes.push(bytes);
    await new Promise(resolve=>setTimeout(resolve,5));this.active--;
  }
  close() {this.closed=true;}
  disconnect() {this.disconnected=true;}
}
(async()=>{
  const t=new Transport(),statuses=[];
  const link=new Link(null,{transport:t,onStatus:s=>statuses.push(s)});
  await link.start();
  assert.deepEqual(t.writes,[frame(CMD.WATCH)]);
  t.receive(Buffer.from('{"WillAiState":'));t.receive(Buffer.from('"stop"}'));
  assert.deepEqual(statuses,[{WillAiState:'stop'}]);
  await Promise.all([link.write(frame(CMD.WATCH)),link.write(frame(CMD.WATCH))]);
  assert.equal(t.maxActive,1);
  link.close();t.receive(Buffer.from('{"WillAiState":"run"}'));
  assert.equal(statuses.length,1,'Ignore notification after close');
  await assert.rejects(()=>link.write(frame(CMD.WATCH)),/断开/);
  let finishStart;
  const pending=new Transport();pending.start=()=>new Promise(resolve=>finishStart=resolve);
  const cancelled=new Link(null,{transport:pending});const start=cancelled.start();cancelled.close();finishStart();
  await assert.rejects(()=>start,/取消/);assert.equal(pending.writes.length,0);
  const stuck=new Transport();stuck.write=()=>new Promise(()=>{});
  const timed=new Link(null,{transport:stuck,timeout:20});
  await assert.rejects(()=>timed.start(),/超时/);
  assert.equal(stuck.disconnected,true);assert.equal(timed.closed,true);
  console.log('PASS shared transport: subscribe/D0, fragmented status, serialized writes, stale notification, cancelled start, timeout disconnect');
})().catch(error=>{console.error(error);process.exitCode=1;});
