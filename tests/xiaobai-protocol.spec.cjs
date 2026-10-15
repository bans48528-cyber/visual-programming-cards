const assert=require('node:assert/strict');
const {command,frame,milliseconds,Receiver,Link,OP,MODE}=require('../xiaobai-protocol.js');
const hex=bytes=>Buffer.from(bytes).toString('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  assert.equal(hex(command(0,OP.ENTER_PROGRAM)),'5a97980ac20001000000000000000056a5');
  assert.equal(hex(command(1,OP.MOTOR_TIME,[0,1,...milliseconds(1)])),'5a97980ac201100001e8030000000052a5');
  assert.equal(hex(command(7,OP.WAIT_IR,[1,0,30])),'5a97980ac2073001001e0000000000aba5');
  assert.equal(hex(command(9,OP.SHOW_NUM,[100])),'5a97980ac20941640000000000000003a5');
  const received=[],parser=new Receiver(packet=>received.push(packet));
  const incoming=frame(0xd2,[1,OP.MOTOR_TIME,0]);incoming[1]=0x98;incoming[2]=0x97;
  incoming[15]=incoming.slice(0,15).reduce((sum,value)=>sum+value,0)&255;
  parser.feed(Uint8Array.from([0,1,...incoming.slice(0,7)]));assert.equal(received.length,0);
  parser.feed(Uint8Array.from([...incoming.slice(7),...incoming]));assert.equal(received.length,2);
  const bad=Uint8Array.from(incoming);bad[15]^=1;parser.feed(Uint8Array.from([...bad,...incoming]));assert.equal(received.length,3);
  let receive,writes=[],abort;
  const transport={async start(fn){receive=fn;},async write(bytes){writes.push(bytes);},close(){}};
  const link=new Link(transport,{minWriteMs:0,heartbeatMs:20,onEvent:event=>abort=event});await link.start();await link.enterProgram();
  const blocked=link.action(OP.MOTOR_TIME,[0,1,...milliseconds(.1)],true,1000);
  await sleep(0);const sent=writes.find(bytes=>bytes[6]===OP.MOTOR_TIME);
  receive(Uint8Array.from([...incoming.slice(0,5),sent[5],OP.MOTOR_TIME,0,...Array(7).fill(0),0,0xa5].map((value,index,array)=>index===15?array.slice(0,15).reduce((sum,n)=>sum+n,0)&255:value)));
  await blocked;assert.equal(writes.filter(bytes=>bytes[6]===OP.HEARTBEAT).length>=0,true);
  const event=frame(0xd3,[2,1,3]);event[1]=0x98;event[2]=0x97;event[15]=event.slice(0,15).reduce((sum,value)=>sum+value,0)&255;
  receive(event);assert.equal(abort.code,2);assert.notEqual(link.mode,MODE.PROGRAM);link.close();
  let finishFirst;const starts=[];
  const paced=new Link({
    async start(){},close(){},
    async write(){starts.push(Date.now());if(starts.length===1)await new Promise(resolve=>finishFirst=resolve);}
  },{minWriteMs:5});
  const first=paced.write(command(0,OP.HEARTBEAT));await sleep(40);finishFirst();await first;
  assert.equal(paced.lastWrite,starts[0],'write interval begins when transmission starts, not after its ACK');
  await paced.write(command(0,OP.HEARTBEAT));assert(starts[1]-starts[0]>=5);
  paced.close();
  let release;const queuedWrites=[];
  const queued=new Link({start:async()=>{},close(){},write:async bytes=>{
    queuedWrites.push(bytes[6]);if(bytes[6]===OP.HEARTBEAT)await new Promise(r=>release=r);
  }},{minWriteMs:0});queued.mode=MODE.PROGRAM;
  const busy=queued.write(command(0,OP.HEARTBEAT));await sleep(0);
  const staleAction=queued.action(OP.MOTOR_RUN,[0,1]);
  const staleWait=queued.action(OP.WAIT_IR,[1,0,30],true).catch(e=>e.message);
  queued.rejectPending(new Error('切换型号'));release();await busy;await staleAction;await staleWait;
  assert.deepEqual(queuedWrites,[OP.HEARTBEAT],'cancelled queued commands never reach the transport');queued.close();
  let releaseMode;const retiring=new Link({start:async()=>{},close(){},write:()=>new Promise(r=>releaseMode=r)},{minWriteMs:0});
  const entering=retiring.enterProgram();await sleep(0);retiring.close();releaseMode();await entering;assert.equal(retiring.heartbeatTimer,null,'late mode result cannot restart heartbeat');
  console.log('PASS Xiaobai frames, notifications, DONE/abort and 5ms start-to-start write pacing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
