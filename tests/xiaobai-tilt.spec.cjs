const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {Link,OP,MODE,TILT,frame,command}=require('../xiaobai-protocol.js');
const {Runner,validate}=require('../xiaobai-runner.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const block=(id,params={},children)=>({id,params,...(children?{children}:{})});
const tilt=direction=>block('tilt-wait',{direction});
async function until(check,label='condition',timeout=3000){
 const end=Date.now()+timeout;
 while(!check()&&Date.now()<end)await sleep(5);
 assert.ok(check(),label);
}
function incoming(type,payload){
 const bytes=frame(type,payload);bytes[1]=0x98;bytes[2]=0x97;
 bytes[15]=bytes.slice(0,15).reduce((sum,value)=>sum+value,0)&255;
 return bytes;
}
const observed=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
async function fixture({onWrite}={}){
 let receive;const writes=[],events=[];
 const link=new Link({async start(fn){receive=fn;},close(){},async write(bytes){writes.push({bytes:Uint8Array.from(bytes),at:Date.now()});await onWrite?.(bytes,data=>receive(data));}},
  {minWriteMs:0,onEvent:event=>events.push(event)});
 link.cancelPending=()=>link.rejectPending(new Error('程序已停止。'));
 await link.start();
 const runner=new Runner(link,{isCurrent:()=>!link.closed});
 const sent=op=>writes.filter(item=>item.bytes[6]===op);
 return {link,runner,writes,events,sent,receive:bytes=>receive(bytes),
  reply:(sent,result=0,data=[])=>receive(incoming(0xd2,[sent.bytes[5],sent.bytes[6],result,...data])),
  event:(code,data=[])=>receive(incoming(0xd3,[code,1,...data])),close:()=>link.close()};
}

async function directionAndValidation(){
 assert.equal(OP.WAIT_TILT,0x32);assert.equal(OP.READ_TILT,0x33);
 assert.deepEqual(TILT,{UNKNOWN:0,UPRIGHT:1,FORWARD:2,BACKWARD:3,LEFT:4,RIGHT:5,INVERTED:6});
 assert.equal(Buffer.from(command(7,OP.WAIT_TILT,[2])).toString('hex'),'5a97980ac20732020000000000000090a5');
 assert.equal(Buffer.from(command(9,OP.READ_TILT)).toString('hex'),'5a97980ac20933000000000000000091a5');
 for(const [direction,value] of [['forward',2],['backward',3],['left',4],['right',5]]){
  const calls=[];
  const runner=new Runner({async enterProgram(){calls.push('enter');},cancelPending(){},async stopProgram(){calls.push('stop');},
   async action(op,args,blocking,timeout){calls.push([op,args,blocking,timeout]);}});
  await runner.run([tilt(direction)]);
  assert.deepEqual(calls,['enter',[OP.WAIT_TILT,[value],true,0],'stop']);
 }
 for(const direction of [undefined,null,'front','up','',2,0,'2',{},'FORWARD'])for(const nested of [false,true]){
  const invalid=tilt(direction),calls=[];
  const program=[block('motor-forward-continuous',{port:'L'}),nested?block('loop-count',{count:2},[invalid]):invalid];
  const runner=new Runner({enterProgram(){calls.push('enter');},action(){calls.push('action');},stopProgram(){calls.push('stop');}});
  assert.throws(()=>validate(program),/倾倒|方向/);
  assert.throws(()=>runner.run(program),/倾倒|方向/);
  assert.deepEqual(calls,[],'invalid tilt must reject the entire program before entering a mode');
 }
}

// The connected M5 tablet runs WebView 92, which has no Object.hasOwn.
// Load the actual browser bundles in that environment without changing Node globals.
async function legacyWebViewCompatibility(){
 const context=vm.createContext({setTimeout,clearTimeout,setInterval,clearInterval});
 vm.runInContext('Object.hasOwn=undefined;',context);
 for(const file of ['xiaobai-protocol.js','xiaobai-runner.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
 assert.equal(vm.runInContext('typeof Object.hasOwn',context),'undefined');
 const legacy=context.XiaobaiRunner;
 const cases=[
  ...[['forward',2],['backward',3],['left',4],['right',5]].map(([direction,value])=>
   ({id:'tilt-wait',direction,opcode:OP.WAIT_TILT,value,blocking:true})),
  ...[['advance',1],['left',2],['right',3],['retreat',4]].map(([direction,value])=>
   ({id:'combo-continuous',direction,opcode:OP.MOVE_RUN,value,blocking:false}))
 ];
 for(const {id,direction,opcode,value,blocking} of cases){
  const calls=[];
  const runner=new legacy.Runner({async enterProgram(){calls.push('enter');},cancelPending(){},
   async stopProgram(){calls.push('stop');},
   async action(op,args,wait,timeout){calls.push([op,Array.from(args),wait,timeout]);}});
  await runner.run([block(id,{direction})]);
  assert.deepEqual(calls,['enter',[opcode,[value],blocking,0],'stop'],
   `${id}/${direction} must reach the hardware action on WebView without Object.hasOwn`);
 }
 for(const id of ['tilt-wait','combo-continuous'])for(const direction of
  ['constructor','toString','valueOf','hasOwnProperty','__proto__','sideways',undefined,null,2]){
  for(const nested of [false,true]){
   const calls=[],invalid=block(id,{direction});
   const program=[block('motor-forward-continuous',{port:'L'}),nested?block('loop-count',{count:2},[invalid]):invalid];
   const runner=new legacy.Runner({enterProgram(){calls.push('enter');},
    action(){calls.push('action');},stopProgram(){calls.push('stop');}});
   assert.throws(()=>legacy.validate(program),/倾倒|方向/);
   assert.throws(()=>runner.run(program),/倾倒|方向/);
   assert.deepEqual(calls,[],`${id}/${String(direction)} cannot inherit a direction or send preceding motor actions`);
  }
 }
}

async function doneAndHeartbeat(){
 const f=await fixture();
 try{
  assert.equal(f.link.heartbeatMs,300,'tilt retains the production 300 ms heartbeat');
  f.link.seq=254;
  const result=observed(f.runner.run([tilt('forward'),tilt('forward'),block('display-off')]));
  await until(()=>f.sent(OP.WAIT_TILT).length===1,'first WAIT_TILT sent');
  const first=f.sent(OP.WAIT_TILT)[0];assert.equal(first.bytes[5],255);
  assert.deepEqual(Array.from(first.bytes.slice(7,15)),[2,0,0,0,0,0,0,0]);
  await sleep(730);
  assert.ok(f.sent(OP.HEARTBEAT).length>=2,'heartbeats continue while waiting for physical DONE');
  assert.equal(f.sent(OP.WAIT_TILT).length,1,'no timer can simulate tilt completion');
  assert.equal(f.sent(OP.SHOW_OFF).length,0);
  assert.equal(f.sent(OP.READ_TILT).length,0,'execution never polls READ_TILT to simulate DONE');
  f.receive(incoming(0xd2,[254,OP.WAIT_TILT,0]));
  f.receive(incoming(0xd2,[first.bytes[5],OP.READ_TILT,0,2,1,1,0,0,0,0]));
  await sleep(55);assert.equal(f.sent(OP.WAIT_TILT).length,1,'wrong sequence or opcode cannot finish WAIT_TILT');
  f.reply(first);f.reply(first);
  await until(()=>f.sent(OP.WAIT_TILT).length===2,'second same-direction wait starts after DONE');
  const second=f.sent(OP.WAIT_TILT)[1];assert.equal(second.bytes[5],1,'sequence wraps 255 to 1 without zero');
  assert.deepEqual(Array.from(second.bytes.slice(7,15)),[2,0,0,0,0,0,0,0]);
  f.reply(first);await sleep(60);
  assert.equal(f.sent(OP.SHOW_OFF).length,0,'replayed first DONE cannot finish the second wait');
  f.reply(second);f.reply(second);
  assert.equal((await result).ok,true);
  assert.equal(f.sent(OP.SHOW_OFF).length,1,'duplicate current DONE advances exactly once');
  assert.equal(f.sent(OP.READ_TILT).length,0);
 }finally{f.close();}
}

async function cancellation(){
 for(const kind of ['stop','disconnect','remote','mode-event','sensor-abort']){
  const f=await fixture();
  try{
   const result=observed(f.runner.run([tilt('left'),block('display-off')]));
   await until(()=>f.sent(OP.WAIT_TILT).length===1,kind+' wait sent');
   const wait=f.sent(OP.WAIT_TILT)[0];
   if(kind==='stop')await observed(f.runner.stop());
   else if(kind==='disconnect')f.link.close();
   else if(kind==='remote')await f.link.enterRemote();
   else if(kind==='mode-event')f.event(1,[MODE.VOICE]);
   else f.event(2,[7,MODE.PROGRAM,0,0,0,0,0,6]);
   const outcome=await result;
   if(kind!=='stop')assert.equal(outcome.ok,false,kind+' must abort instead of continuing');
   if(kind==='sensor-abort')assert.match(outcome.error.message,/加速度传感器不可用/);
   assert.equal(f.link.pending.size,0,kind+' clears pending actions');
   f.reply(wait);await sleep(60);
   assert.equal(f.sent(OP.SHOW_OFF).length,0,kind+' ignores late DONE and never executes the next block');
   if(kind!=='stop')assert.equal(f.link.heartbeatTimer,null,kind+' cannot retain program heartbeat');
   if(kind==='stop')assert.ok(f.sent(OP.STOP_PROGRAM).length>=1,'manual stop sends STOP_PROGRAM');
  }finally{f.close();}
 }
}

async function rejection(){
 for(const [code,pattern] of [[0x02,/更新.*主控|主控.*更新/],[0x0a,/加速度传感器不可用/],[0x03,/拒绝|错误/]]){
  const f=await fixture();
  try{
   const result=observed(f.runner.run([tilt('right'),block('display-off')]));
   await until(()=>f.sent(OP.WAIT_TILT).length===1,'error-case WAIT sent');
   f.reply(f.sent(OP.WAIT_TILT)[0],code);
   const outcome=await result;assert.equal(outcome.ok,false);assert.match(outcome.error.message,pattern);
   assert.equal(outcome.error.result,code);assert.equal(outcome.error.opcode,OP.WAIT_TILT);
   assert.equal(f.sent(OP.SHOW_OFF).length,0,'an error is never treated as successful DONE');
   assert.ok(f.sent(OP.STOP_PROGRAM).length>=1,'failure requests a safety stop');
  }finally{f.close();}
 }
}

async function queuedReplyGuard(){
 let releaseQueue,holdOnce=true;
 const f=await fixture({onWrite:async bytes=>{
  if(bytes[6]===OP.HEARTBEAT&&holdOnce){holdOnce=false;await new Promise(resolve=>releaseQueue=resolve);}
 }});
 try{
  await f.link.enterProgram();f.link.seq=255;
  const held=f.link.write(command(0,OP.HEARTBEAT));
  await until(()=>Boolean(releaseQueue),'transport queue occupied');
  let settled=false;
  const result=observed(f.link.action(OP.WAIT_TILT,[3],true)).then(outcome=>{settled=true;return outcome;});
  await until(()=>f.link.pending.size===1,'new wrapped sequence registered');
  assert.equal(f.link.seq,1);
  f.receive(incoming(0xd2,[1,OP.WAIT_TILT,0]));
  await sleep(55);assert.equal(settled,false,'a matching old DONE before write cannot finish the new task');
  assert.equal(f.sent(OP.WAIT_TILT).length,0);
  releaseQueue();await held;
  await until(()=>f.sent(OP.WAIT_TILT).length===1,'old DONE cannot suppress the queued new write');
  assert.equal(settled,false);f.reply(f.sent(OP.WAIT_TILT)[0]);assert.equal((await result).ok,true);
 }finally{releaseQueue?.();f.close();}

 // Real BLE mock/native transports may synchronously deliver DONE during their write call.
 const synchronous=await fixture({onWrite:async(bytes,receive)=>{
  if(bytes[6]===OP.WAIT_TILT)receive(incoming(0xd2,[bytes[5],OP.WAIT_TILT,0]));
 }});
 try{
  const result=observed(synchronous.runner.run([tilt('backward'),block('display-off')]));
  const outcome=await Promise.race([result,sleep(2000).then(()=>({ok:false,error:Error('synchronous DONE was lost')}))]);
  assert.equal(outcome.ok,true,outcome.error?.message);
  assert.equal(synchronous.sent(OP.SHOW_OFF).length,1,'mark sent before invoking transport.write');
 }finally{synchronous.close();}
}

async function readTilt(){
 const f=await fixture();
 try{
  await f.link.enterProgram();
  async function query(data,result=0){
   const before=f.sent(OP.READ_TILT).length,promise=f.link.readTilt(),answer=observed(promise);
   await until(()=>f.sent(OP.READ_TILT).length===before+1,'READ_TILT sent');
   const request=f.sent(OP.READ_TILT).at(-1);
   assert.deepEqual(Array.from(request.bytes.slice(7,15)),Array(8).fill(0),'READ_TILT reserved args are zero');
   f.reply(request,result,data);return answer;
  }
  for(const state of [0,1,2,3,4,5,6]){
   const answer=await query([state,1,1,0,0,0,0]);
   assert.equal(answer.ok,true);assert.deepEqual(answer.value,{state,ready:true,physicalIrCount:1});
  }
  for(const [code,pattern] of [[0x02,/更新.*主控|主控.*更新/],[0x0a,/加速度传感器不可用/]]){
   const answer=await query(Array(7).fill(0),code);assert.equal(answer.ok,false);assert.match(answer.error.message,pattern);
  }
  for(const data of [[7,1,1,0,0,0,0],[2,2,1,0,0,0,0],[2,1,2,0,0,0,0],[2,1,1,1,0,0,0],[2,1,1,0,0,0,1]]){
   const answer=await query(data);assert.equal(answer.ok,false,'malformed READ_TILT data cannot masquerade as real attitude');
  }
 }finally{f.close();}
}

(async()=>{
 await legacyWebViewCompatibility();
 await directionAndValidation();
 await doneAndHeartbeat();
 await cancellation();
 await rejection();
 await queuedReplyGuard();
 await readTilt();
 console.log('PASS tilt: legacy WebView without Object.hasOwn, own-key preflight, four directions and invalid preflight, real seq/op DONE, 300ms heartbeat/no polling, duplicate/wrapped/consecutive waits, stop/disconnect/mode/fault cancellation, old firmware and sensor errors, READ_TILT state validation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
