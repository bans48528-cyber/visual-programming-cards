const assert=require('node:assert/strict');
const {matrixChunks,command,frame,Link,MODE,OP}=require('../xiaobai-protocol.js');
const {Runner,validate}=require('../xiaobai-runner.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const left=Array(64).fill(0),right=Array(64).fill(0);
for(const i of [0,1,62,31])left[i]=1;
for(const i of [16,55])right[i]=1;
const block={id:'eye-matrix',params:{leftPattern:left,rightPattern:right}};
(async()=>{
  assert.equal(OP.SHOW_MATRIX,0x43);
  const chunks=matrixChunks(33,left,right);
  assert.deepEqual(chunks,[[33,0,0,1,0,0,0,0],[33,1,128,8,4,0,0,0],[33,2,0,0,0,64,0,0]]);
  assert.deepEqual(chunks.map((args,i)=>Buffer.from(command(i+1,OP.SHOW_MATRIX,args)).toString('hex')),[
    '5a97980ac201432100000100000000bba5',
    '5a97980ac20243210180080400000048a5',
    '5a97980ac203432102000000400000fea5']);
  assert.equal(left[0],1,'packing does not mutate saved patterns');
  for(const bad of [[],Array(63).fill(0),Array(64).fill(2),Array(64).fill(null),new Array(64)]){
    assert.throws(()=>matrixChunks(1,bad,right));
    assert.throws(()=>validate([{...block,params:{leftPattern:bad,rightPattern:right}}]));
  }
  assert.doesNotThrow(()=>validate([{id:'tilt-wait',params:{direction:'left'}}]));
  assert.throws(()=>validate([{id:'tilt-wait',params:{direction:'sideways'}}]),/倾倒方向无效/);
  const calls=[];let release;
  const connection={async enterProgram(){},cancelPending(){release?.();},async stopProgram(){calls.push('stop');},
    async action(op,args,blocking,timeout){calls.push([op,args,blocking,timeout]);if(args[1]===0)await new Promise(r=>release=r);}};
  const runner=new Runner(connection),running=runner.run([block]);
  await sleep(0);assert.equal(calls.length,1,'next chunk waits for MCU acknowledgement');
  release();await running;
  assert.deepEqual(calls.slice(0,3).map(c=>[c[0],c[1][1],c[2],c[3]]),[[0x43,0,true,1500],[0x43,1,true,1500],[0x43,2,true,1500]]);
  assert.equal(calls.at(-1),'stop');
  calls.length=0;
  const cancelled=new Runner(connection),task=cancelled.run([block]);await sleep(0);await cancelled.stop();await task;
  assert.equal(calls.filter(Array.isArray).length,1,'stop during upload never sends later chunks');
  const rejected=[];
  await assert.rejects(new Runner({async enterProgram(){},cancelPending(){},async stopProgram(){},
    async action(op,args){rejected.push(args[1]);throw new Error('old firmware');}}).run([block]),/old firmware/);
  assert.deepEqual(rejected,[0],'rejection never advances the upload');

  const writes=[];let receive;
  const link=new Link({async start(fn){receive=fn;},close(){},async write(bytes){writes.push({bytes,time:Date.now()});}}, {minWriteMs:0});
  await link.start();link.mode=MODE.PROGRAM;
  await link.write(command(0,OP.HEARTBEAT));
  const ack=link.action(OP.SHOW_MATRIX,chunks[0],true,1000);
  const sentBy=Date.now()+1000;
  while(writes.length<2&&Date.now()<sentBy)await sleep(5);
  assert.equal(writes.length,2);assert(writes[1].time-writes[0].time>=40);
  const response=frame(0xd2,[writes[1].bytes[5],0x43,0,33,0]);response[1]=0x98;response[2]=0x97;
  receive(response);await ack;
  const before=Date.now();await link.write(command(2,OP.SHOW_MATRIX,chunks[1]));
  assert(Date.now()-before>=40,'matrix chunks retain the stronger receive-to-write guard');link.close();
  console.log('PASS custom eye packing, three ACKs, cancellation, rejection, validation and pacing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
