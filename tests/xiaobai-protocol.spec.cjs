const assert=require('node:assert/strict');
const {command,frame,milliseconds,Receiver,Link,OP,MODE}=require('../xiaobai-protocol.js');
const hex=bytes=>Buffer.from(bytes).toString('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(condition){const deadline=Date.now()+1000;while(!condition()&&Date.now()<deadline)await sleep(5);assert(condition(),'expected transport write within timeout');}
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
  await until(()=>writes.some(bytes=>bytes[6]===OP.MOTOR_TIME));const sent=writes.find(bytes=>bytes[6]===OP.MOTOR_TIME);
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
  assert(paced.lastWrite-starts[0]>=39,'guard begins after the delayed write completes');
  const completed= paced.lastWrite;
  await paced.write(command(0,OP.HEARTBEAT));assert(starts[1]-completed>=40);
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
  // Mode navigation must follow the latest intent even when BLE write-with-response is delayed.
  let releaseProgram;const modeWrites=[];
  const modes=new Link({async start(){},close(){},async write(bytes){modeWrites.push(bytes[6]);if(bytes[6]===OP.ENTER_PROGRAM)await new Promise(r=>releaseProgram=r);}},{minWriteMs:0});
  await modes.start();modes.mode=MODE.REMOTE;
  const oldProgram=modes.enterProgram();await sleep(0);
  const latestRemote=modes.enterRemote();releaseProgram();await Promise.all([oldProgram,latestRemote]);
  assert.deepEqual(modeWrites,[OP.ENTER_PROGRAM,OP.ENTER_REMOTE]);assert.equal(modes.mode,MODE.REMOTE);assert.equal(modes.heartbeatTimer,null,'superseded program entry cannot restart heartbeat');modes.close();

  let releaseQueue;const latestWrites=[];
  const latest=new Link({async start(){},close(){},async write(bytes){latestWrites.push(bytes[6]);if(bytes[6]===OP.HEARTBEAT)await new Promise(r=>releaseQueue=r);}},{minWriteMs:0});
  await latest.start();latest.mode=MODE.REMOTE;
  const heldWrite=latest.write(command(0,OP.HEARTBEAT));await sleep(0);
  const queuedProgram=latest.enterProgram(),queuedRemote=latest.enterRemote();releaseQueue();await Promise.all([heldWrite,queuedProgram,queuedRemote]);
  assert.deepEqual(latestWrites,[OP.HEARTBEAT,OP.ENTER_REMOTE],'obsolete queued mode command never reaches the device');assert.equal(latest.mode,MODE.REMOTE);latest.close();

  let releaseLeaving;const leaveWrites=[],leaves=[];
  const leaving=new Link({async start(){},close(){},async write(bytes){leaveWrites.push(bytes[6]);if(bytes[6]===OP.ENTER_PROGRAM)await new Promise(r=>releaseLeaving=r);}},{minWriteMs:0});
  await leaving.start();leaving.onLifecycle(reason=>leaves.push(reason));
  const lateEnter=leaving.enterProgram();await sleep(0);
  const left=leaving.suspendProgram('left editor');assert.equal(leaving.heartbeatTimer,null);assert.deepEqual(leaves,['left editor']);
  releaseLeaving();await Promise.all([lateEnter,left]);assert.deepEqual(leaveWrites,[OP.ENTER_PROGRAM,OP.STOP_PROGRAM]);assert.equal(leaving.heartbeatTimer,null,'leaving during entry cannot revive program heartbeat');leaving.close();

  let releaseSwitch;const switchedWrites=[];
  const switched=new Link({async start(){},close(){},async write(bytes){switchedWrites.push(bytes[6]);if(bytes[6]===OP.ENTER_PROGRAM)await new Promise(r=>releaseSwitch=r);}},{minWriteMs:0});
  switched.mode=MODE.REMOTE;const enteringThenLeaving=switched.enterProgram();await sleep(0);
  const suspended=switched.suspendProgram(),remoteAfterSuspend=switched.enterRemote();releaseSwitch();
  await Promise.all([enteringThenLeaving,suspended,remoteAfterSuspend]);
  assert.deepEqual(switchedWrites,[OP.ENTER_PROGRAM,OP.STOP_PROGRAM,OP.ENTER_REMOTE],'suspension cannot leave the old reported REMOTE mode eligible for an early return');assert.equal(switched.mode,MODE.REMOTE);switched.close();

  let releaseStopped;const stoppedWrites=[];
  const stoppingEntry=new Link({async start(){},close(){},async write(bytes){stoppedWrites.push(bytes[6]);if(bytes[6]===OP.ENTER_PROGRAM)await new Promise(r=>releaseStopped=r);}},{minWriteMs:0});
  const pendingEnter=stoppingEntry.enterProgram();await sleep(0);const earlyStop=stoppingEntry.stopProgram();releaseStopped();await Promise.all([pendingEnter,earlyStop]);
  assert.deepEqual(stoppedWrites,[OP.ENTER_PROGRAM,OP.STOP_PROGRAM]);assert.equal(stoppingEntry.heartbeatTimer,null);stoppingEntry.close();
  console.log('PASS Xiaobai frames, notifications, DONE/abort, 40ms write pacing and delayed mode/navigation cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
