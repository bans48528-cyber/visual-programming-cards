const assert=require('node:assert/strict');
const {frame,uploadFrames,Receiver,Link,CMD}=require('../spark-protocol.js');
const generate=require('../program-codegen.cjs');
const hex=b=>Buffer.from(b).toString('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Characteristic extends EventTarget {
  constructor(){super();this.properties={notify:true,writeWithoutResponse:true};this.writes=[];this.ack=true;}
  async startNotifications() {return this;}
  async writeValueWithoutResponse(b) {
    this.writes.push(b);
    if(this.ack && [0xda,0xaa,0xbb,0xbc].includes(b[4])) queueMicrotask(()=>this.receive(frame(0x01)));
  }
  receive(b) {this.value=new DataView(b.buffer,b.byteOffset,b.byteLength);this.dispatchEvent(new Event('characteristicvaluechanged'));}
}
(async()=>{
  assert.equal(hex(frame(CMD.RUN)),'5a979801b60141a5');
  assert.equal(hex(frame(CMD.STOP)),'5a979801b90144a5');
  assert.equal(hex(frame(CMD.WATCH)),'5a979801d0015ba5');
  assert.equal(hex(uploadFrames(new Uint8Array(1))[0]),'5a979803da302e6f33a5');
  for(const size of [1,128,129,256,257]) {
    const frames=uploadFrames(new Uint8Array(size));
    assert.equal(frames.length,1+Math.ceil(size/128));assert.equal(frames.at(-1)[4],CMD.END_RUN);
    assert.ok(frames.every(f=>f.length<=135));
    assert.equal(uploadFrames(new Uint8Array(size),10,false).at(-1)[4],CMD.END);
  }
  assert.throws(()=>uploadFrames(new Uint8Array(0)));
  let packets=[],statuses=[],errors=[];
  const receiver=new Receiver(p=>packets.push(p),s=>statuses.push(s),e=>errors.push(e));
  const stream=Buffer.concat([frame(CMD.RUN),Buffer.from('{"deviceList":[{"name":"中{文}\\\""}]}{"will_ai":{}}'),frame(CMD.STOP)]);
  for(const b of stream) receiver.feed([b]);
  assert.equal(packets.length,2);assert.equal(statuses.length,2);assert.equal(errors.length,0);
  for(const split of [1,4,7,8]) {
    const replies=[],reports=[];
    const recovery=new Receiver(p=>replies.push(p),s=>reports.push(s),e=>{throw e;});
    recovery.feed(Buffer.from('{"deviceList":[],"Wi'));
    const ack=frame(0xfd);
    recovery.feed(ack.slice(0,split));recovery.feed(ack.slice(split));
    assert.equal(replies.length,1);assert.equal(recovery.buffer.length,0);
    recovery.feed(Buffer.from('{"deviceList":[],"Wi{"WillAiState":"stop"}\r\n'));
    recovery.feed(Buffer.from('{"WillAiState":"run"}\r\n'));
    assert.deepEqual(reports,[{WillAiState:'run'}]);
    recovery.feed(Buffer.concat([Buffer.from('{"WillAiState":"stop"}\r\n'),ack]));
    assert.equal(reports.at(-1).WillAiState,'stop');assert.equal(replies.length,2);
  }
  const corrupt=frame(CMD.RUN);corrupt[6]++;
  receiver.feed([...corrupt,...frame(CMD.STOP)]);assert.equal(errors.length,1);assert.equal(packets.length,3);
  const c=new Characteristic(),link=new Link(c,{timeout:35});await link.start();
  await link.upload(new Uint8Array(129),{allowUnverifiedAck:true});
  c.receive(Buffer.from('{"deviceList":[],"Wi'));
  await link.upload(new Uint8Array(1),{allowUnverifiedAck:true});
  assert.equal(link.receiver.buffer.length,0);
  assert.deepEqual(c.writes.map(f=>f[4]),[0xd0,0xda,0xaa,0xbc,0xd0,0xda,0xbc,0xd0]);
  const mixed=new Characteristic(),monitored=[];
  const mixedLink=new Link(mixed,{onStatus:s=>monitored.push(s)});await mixedLink.start();
  mixed.receive(Buffer.from('{"WillAiState":'));
  mixed.writeValueWithoutResponse=async b=>{
    mixed.writes.push(b);
    if(b[4]===CMD.NAME) mixed.receive(Buffer.from('"stop"}\r\n'));
    if([CMD.NAME,CMD.END_RUN].includes(b[4])) mixed.receive(frame(1));
  };
  await mixedLink.upload(new Uint8Array(1),{allowUnverifiedAck:true});
  assert.deepEqual(monitored,[{WillAiState:'stop'}]);
  assert.ok(mixed.writes.every(b=>b[4]!==CMD.UNWATCH));mixedLink.close();
  const silent=new Characteristic(),silentLink=new Link(silent);
  await silentLink.start();
  await silentLink.upload(new Uint8Array(1),{allowUnverifiedAck:true});
  const initial=silent.writes.length;
  await sleep(450);
  assert.deepEqual(silent.writes.map(b=>b[4]),[CMD.WATCH,CMD.NAME,CMD.END_RUN,CMD.WATCH]);
  assert.equal(silent.writes.length,initial);
  silent.receive(frame(0xfd));
  silent.receive(Buffer.from('{"version":110}\r\n'));
  await sleep(210);
  assert.equal(silent.writes.length,initial);
  silent.receive(Buffer.from('{"WillAiState":"run"}\r\n'));
  const reported=silent.writes.length;
  await sleep(250);assert.equal(silent.writes.length,reported);
  await silentLink.upload(new Uint8Array(1),{allowUnverifiedAck:true});
  await silentLink.stop();
  const stopped=silent.writes.length;
  await sleep(250);assert.equal(silent.writes.length,stopped);
  await silentLink.upload(new Uint8Array(1),{allowUnverifiedAck:true});
  silentLink.close();const closed=silent.writes.length;
  await sleep(250);assert.equal(silent.writes.length,closed);
  c.ack=false;
  await assert.rejects(link.upload(new Uint8Array(1),{allowUnverifiedAck:true}),/超时/);
  const sending=link.upload(new Uint8Array(257),{allowUnverifiedAck:true});
  const cancelled=assert.rejects(sending,/取消/);
  await sleep(10);await link.stop();await cancelled;
  assert.deepEqual(c.writes.slice(-6).map(b=>b[4]),[CMD.NAME,...Array(5).fill(CMD.STOP)]);
  const disconnected=link.upload(new Uint8Array(1),{allowUnverifiedAck:true});
  const failed=assert.rejects(disconnected,/断开/);await sleep(10);link.close();await failed;
  assert.throws(()=>generate([{id:'ultrasonic-sensor'}]),/传感器端口/);
  const responseOnly=new Characteristic();
  responseOnly.properties={indicate:true,write:true};
  responseOnly.writeValueWithResponse=responseOnly.writeValueWithoutResponse;
  const fallback=new Link(responseOnly);await fallback.start();await fallback.stop();fallback.close();
  assert.deepEqual(responseOnly.writes.map(b=>b[4]),[CMD.WATCH,...Array(5).fill(CMD.STOP)]);
  const dual=new Characteristic(),modes=[],traces=[];
  dual.properties.write=true;
  const originalWrite=dual.writeValueWithoutResponse.bind(dual);
  dual.writeValueWithoutResponse=async b=>{modes.push(['withoutResponse',b[4],performance.now()]);await originalWrite(b);};
  dual.writeValueWithResponse=async b=>{modes.push(['withResponse',b[4],performance.now()]);await originalWrite(b);};
  const dualLink=new Link(dual,{onTrace:(kind,bytes,detail)=>traces.push({kind,detail})});
  await dualLink.start();await dualLink.upload(new Uint8Array(129),{allowUnverifiedAck:true});await dualLink.stop();
  assert.deepEqual(modes.map(m=>m.slice(0,2)),[
    ['withoutResponse',CMD.WATCH],['withoutResponse',CMD.NAME],['withoutResponse',CMD.DATA],
    ['withoutResponse',CMD.END_RUN],['withoutResponse',CMD.WATCH],
    ...Array.from({length:5},()=>['withoutResponse',CMD.STOP])
  ]);
  assert.ok(traces.some(t=>t.kind==='WRITE_OK' && t.detail.includes('CMD=B9') && t.detail.includes('不代表设备ACK')));
  const stopWrites=modes.filter(m=>m[1]===CMD.STOP);
  for(let i=1;i<stopWrites.length;i++) assert.ok(stopWrites[i][2]-stopWrites[i-1][2]>=75);
  dual.writeValueWithoutResponse=async b=>{
    modes.push(['withoutResponse',b[4]]);
    if(b[4]===CMD.STOP) throw Error('BLE write rejected');
    await originalWrite(b);
  };
  const beforeRejected=modes.length;
  await assert.rejects(dualLink.stop(),/BLE write rejected/);
  await sleep(150);
  assert.deepEqual(modes.slice(beforeRejected).map(m=>m.slice(0,2)),[['withoutResponse',CMD.STOP]]);
  dualLink.close();
  const guarded=new Characteristic(),guardLink=new Link(guarded);await guardLink.start();
  let release,allowed=true;
  guardLink.queue=new Promise(resolve=>{release=resolve;});
  const guardedStop=guardLink.stop(()=>allowed);
  allowed=false;release();assert.equal(await guardedStop,false);
  assert.deepEqual(guarded.writes.map(b=>b[4]),[CMD.WATCH]);guardLink.close();
  const direct=new Characteristic(),directStatuses=[];
  const directLink=new Link(direct,{onStatus:s=>directStatuses.push(s)});
  await directLink.start();
  const beforeDirect=direct.writes.length;
  const directStop=directLink.stop();
  await Promise.resolve();
  assert.deepEqual(direct.writes.slice(beforeDirect).map(b=>b[4]),[CMD.STOP]);
  await directStop;
  direct.receive(Buffer.from('{"WillAiState":"stop"}\r\n'));
  assert.deepEqual(directStatuses,[{WillAiState:'stop'}]);
  await sleep(250);
  assert.deepEqual(direct.writes.slice(beforeDirect).map(b=>b[4]),Array(5).fill(CMD.STOP));
  directLink.close();
  const partial=new Characteristic(),partialLink=new Link(partial);
  partial.writeValueWithoutResponse=async b=>{partial.writes.push(b);partialLink.close();};
  await assert.rejects(partialLink.stop(),/断开/);
  assert.deepEqual(partial.writes.map(b=>b[4]),[CMD.STOP]);
  const changed=new Characteristic(),changedLink=new Link(changed);
  let stillAllowed=true;
  const changingStop=changedLink.stop(()=>stillAllowed);
  await Promise.resolve();stillAllowed=false;
  assert.equal(await changingStop,false);
  assert.deepEqual(changed.writes.map(b=>b[4]),[CMD.STOP]);changedLink.close();
  const interrupted=new Characteristic(),interruptedLink=new Link(interrupted);
  let releaseInterrupted;
  interruptedLink.queue=new Promise(resolve=>{releaseInterrupted=resolve;});
  const stopping=interruptedLink.stop();
  const stopFailure=assert.rejects(stopping,/断开/);
  interruptedLink.close();releaseInterrupted();await stopFailure;
  assert.deepEqual(interrupted.writes,[]);
  const invalid=new Characteristic();invalid.ack=false;
  const invalidLink=new Link(invalid,{timeout:100});await invalidLink.start();
  const invalidUpload=invalidLink.upload(new Uint8Array(1),{allowUnverifiedAck:true});
  const invalidResult=assert.rejects(invalidUpload,/校验失败/);
  await sleep(10);invalid.receive(corrupt);await invalidResult;invalidLink.close();
  assert.throws(()=>generate([{id:'motor-forward',params:{port:'E',duration:'1);evil()'}}]));
  const source=generate([{id:'loop-count',params:{count:2},children:[{id:'motor-reverse',params:{port:'H',duration:1}}]}]);
  assert.match(source,/_motor.run_for_power_seconds\(7, -motor_power, 1\)/);
  assert.match(source,/motor_power = 50/);
  const powered=generate([{id:'motor-power',params:{power:'75'}},...['E','F','G','H'].map(port=>({id:'motor-forward',params:{port,duration:1}}))]);
  assert.match(powered,/motor_power = 75\n_motor.run_for_power_seconds\(4, motor_power, 1\)/);
  for (let port=4;port<=7;port++) assert.ok(powered.includes(`_motor.run_for_power_seconds(${port}, motor_power, 1)`));
  assert.throws(()=>generate([{id:'motor-power',params:{port:'E',power:'101'}}]));
  const independent=generate([{id:'motor-power',params:{power:'25'}},{id:'combo-power',params:{power:'100'}},{id:'motor-forward',params:{port:'F',duration:1}}]);
  assert.match(independent,/motor_power = 25\ncombo_power = 100\n_motor.run_for_power_seconds\(5, motor_power, 1\)/);
  assert.match(generate([{id:'combo-power',params:{power:'100'}},{id:'combo-forward',params:{duration:1}}]),/_motor.mov_dir_power_seconds\("advance", combo_power, 1\)/);
  for(const [index,port] of ['E','F','G','H'].entries()) {
    assert.equal(generate([{id:'motor-stop',params:{port}}]),`_motor.stop(${index+4})\n`);
  }
  assert.throws(()=>generate([{id:'motor-stop',params:{port:'A'}}]),/E–H/);
  console.log('PASS protocol vectors, chunks, mixed notifications, checksum, timeout, cancellation, disconnect, code generation');
})().catch(e=>{console.error(e);process.exitCode=1;});
