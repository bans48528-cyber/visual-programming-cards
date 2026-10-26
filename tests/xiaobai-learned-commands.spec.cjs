const assert=require('node:assert/strict');
const vectors=require('./fixtures/xiaobai-learned-command-vectors.json').vectors;
const {Link,Receiver,command,frame,OP,MODE}=require('../xiaobai-protocol.js');
const {Session,u32,read32}=require('../xiaobai-learned-commands.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let activeLink;
// Wait for actual queued writes, including the 40 ms production guard. Do not
// assume that one event-loop turn means a request has reached the transport.
const tick=async()=>{
  await sleep(0);
  for(let i=0;i<20&&activeLink&&!activeLink.closed;i++){
    const queued=activeLink.queue;await queued;await sleep(0);
    if(queued===activeLink.queue)return;
  }
};
const storage=()=>{const values=new Map();return{getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),values};};
function incoming(type,data){const bytes=frame(type,data);bytes[1]=0x98;bytes[2]=0x97;bytes[15]=bytes.slice(0,15).reduce((a,b)=>a+b,0)&255;return bytes;}
async function setup(options={}){
  const store=options.storage||storage(),writes=[],pendingQueries=[];
  let callback,counter=0,statusReads=0;
  const config={mask:0,caps:15,uid:Array.from({length:12},(_,i)=>(i+1)*16),...options};
  const reply=(packet,result,data)=>callback(incoming(0xd2,[packet[5],packet[6],result,...data]));
  const transport={async start(fn){callback=fn;},close(){},async write(bytes){
    const packet=Array.from(bytes);writes.push(packet);const op=packet[6],args=packet.slice(7,15);
    if(config.silent?.has(op))return;
    if(config.unsupported?.has(op)){reply(packet,2,Array(7).fill(0));return;}
    if(op===OP.QUERY_STATUS){
      statusReads++;if(statusReads<=(config.dropStatus||0))return;
      reply(packet,config.statusResult||0,[config.statusMode??MODE.PROGRAM,0,0,0,0,0,0]);
    }else if(op===OP.READ_UID)reply(packet,0,[args[0],...config.uid.slice(args[0]*6,args[0]*6+6)]);
    else if(op===OP.QUERY_LEARNED){
      if(config.deferQueries){pendingQueries.push(packet);return;}
      reply(packet,config.queryResult||0,[...args.slice(0,4),config.mask&255,config.mask>>8,config.caps]);
    }else if([OP.LEARN_COMMAND,OP.WAIT_LEARNED,OP.CANCEL_LEARNING].includes(op)){
      if(config.rejectLearn&&op===OP.LEARN_COMMAND)reply(packet,config.rejectLearn,[...args.slice(0,4),args[4],2,0]);
      else reply(packet,0,[...args.slice(0,4),op===OP.CANCEL_LEARNING?(session.learning?.slot||1):args[4],(config.mask&(1<<((args[4]||1)-1)))?1:0,0]);
    }else if(op===OP.DECLARE_RUN)reply(packet,0,[...args.slice(0,5),0,0]);
  }};
  const link=new Link(transport,{minWriteMs:0,heartbeatMs:options.heartbeatMs||100000});
  activeLink=link;
  const session=new Session(link,{storage:store,queryMs:500,prepareMs:1000,taskMs:5000,cancelMs:500,settleMs:0,...options.timing});
  await link.start();await link.enterProgram();
  const event=(task,slot,stage,state=2,reason=0,eventCounter)=>callback(incoming(0xd3,[8,eventCounter??++counter,...u32(task),slot,stage,state,reason]));
  const hit=(task,slot,eventCounter)=>callback(incoming(0xd3,[9,eventCounter??++counter,...u32(task),slot,0,0,0]));
  const close=()=>{link.close();session.dispose();};
  return{session,link,config,store,writes,event,hit,close,pendingQueries,reply,callback,async ready(){await session.initialize();return this;}};
}
const block=slot=>({id:'self-learned-wait',params:{slot}});
async function startLearn(h,slot=1,replace=false){
  const promise=h.session.learn(slot,{replace});await tick();
  assert(h.session.learning&&!h.session.learning.terminal,'a single task starts');
  return{promise,task:h.session.learning.task};
}
async function run(h,slot=1){await h.session.prepareRun([block(slot)]);await h.session.beginRun();}

(async()=>{
  // The portable contract corpus must parse exactly; command payloads round-trip unchanged.
  for(const vector of vectors){
    const bytes=Uint8Array.from(vector.frame_hex.split(' ').map(n=>parseInt(n,16)));
    assert.equal(bytes.length,17,vector.name);
    assert.equal(bytes[15],bytes.slice(0,15).reduce((a,b)=>a+b,0)&255,vector.name);
    if(vector.direction==='phone_to_device')assert.deepEqual(command(bytes[5],bytes[6],Array.from(bytes.slice(7,15))),bytes,vector.name);
    else{let count=0;new Receiver(()=>count++).feed(bytes);assert.equal(count,1,vector.name);}
  }
  let h=await setup({mask:513});await h.ready();
  assert.equal(h.session.uid,'102030405060708090a0b0c0');
  assert.equal(h.session.getSnapshot().slots[0].state,'learned');assert.equal(h.session.states[9],'learned');
  assert.equal(h.session.states[1],'unlearned');assert.equal(h.session.capability,'supported');
  assert(h.writes.findIndex(p=>p[6]===OP.QUERY_STATUS)<h.writes.findIndex(p=>p[6]===OP.READ_UID),'real mode is confirmed before UID and learned slots');
  const reads=h.writes.filter(p=>p[6]===OP.QUERY_LEARNED).length;await Promise.all([h.session.initialize(),h.session.initialize()]);
  assert.equal(h.writes.filter(p=>p[6]===OP.QUERY_LEARNED).length,reads,'initialization is shared');
  const before=h.writes.length;h.session.setMemo(1,'启动电机');assert.equal(h.session.getMemo(1),'启动电机');
  h.session.setMemo(1,' ');assert.equal(h.session.getSnapshot().slots[0].label,'指令1');
  assert.equal(h.writes.length,before,'memo editing never writes to the device');
  h.session.setMemo(1,'仅设备一');const saved=h.store;h.close();
  h=await setup({storage:saved,uid:Array(12).fill(0xaa)});await h.ready();assert.equal(h.session.getMemo(1),'','memo is isolated by UID');h.close();

  // Real stages, invalid utterance restarts and successful-save boundary.
  h=await setup();await h.ready();let successes=0;
  h.session.subscribe(s=>{if(s.learning?.phase==='success')successes++;});
  let a=await startLearn(h);assert.equal(h.session.states[0],'unlearned');assert.equal(h.session.learning.phase,'accepted');
  h.event(a.task,1,0,0);h.event(a.task,1,1);h.event(a.task,1,9);assert.equal(h.session.learning.phase,'retry-first');
  h.event(a.task,1,1);h.event(a.task,1,2);assert.equal(h.session.states[0],'unlearned','first valid utterance is not saved');
  h.event(a.task,1,3);h.event(a.task,1,10);assert.equal(h.session.learning.phase,'retry-second');
  h.event(a.task,1,3);h.event(a.task,1,4,1);await a.promise;
  assert.equal(h.session.states[0],'learned');const seen=successes;
  h.event(a.task,1,4,1);assert.equal(successes,seen,'duplicate success is consumed once');
  h.config.mask=1;
  const oldTask=a.task;a=await startLearn(h,1,true);
  assert(a.task>oldTask,'relearn receives a new task');
  h.event(a.task,1,5,0,9);await a.promise;assert.equal(h.session.states[0],'unlearned','failed replace uses actual empty state');
  a=await startLearn(h);h.event(a.task,1,4,2);await a.promise;
  assert.equal(h.session.learning.phase,'failed');assert.equal(h.session.states[0],'unknown','unconfirmed save is not success');
  h.close();

  // Cancel acceptance alone cannot invent a final state. Device cancellation is not a hit.
  h=await setup({mask:1});await h.ready();a=await startLearn(h,1,true);
  let cancelComplete=false,cancel=h.session.cancelLearning().then(()=>cancelComplete=true);
  await tick();assert.equal(h.session.learning.terminal,false);assert.equal(cancelComplete,false,'D2 cancellation ACK does not close the modal');
  h.event(a.task,1,1);assert.equal(h.session.learning.phase,'cancelling','late recording events cannot undo cancellation');
  h.event(a.task,1,7,0,6);await Promise.all([a.promise,cancel]);assert.equal(h.session.states[0],'unlearned');
  a=await startLearn(h);cancel=h.session.cancelLearning();h.event(a.task,1,4,1);await Promise.all([a.promise,cancel]);
  assert.equal(h.session.states[0],'learned','a verified save winning the cancellation race keeps its real state');
  h.close();
  h=await setup({deferQueries:true});
  const preparing=h.session.learn(1).catch(e=>e);await tick();assert.equal(h.session.preparingLearn,true);assert.equal(h.session.learning,null);
  await h.session.cancelLearning();await tick();
  const pending=h.pendingQueries.shift();h.reply(pending,0,[...pending.slice(7,11),0,0,15]);await preparing;
  assert(!h.writes.some(p=>p[6]===OP.LEARN_COMMAND),'cancellation during initialization cannot send a later learn request');h.close();

  // A query started before a learning terminal must not overwrite the terminal.
  h=await setup();await h.ready();a=await startLearn(h);h.config.deferQueries=true;
  const staleQuery=h.session.refresh().catch(()=>{});await tick();assert.equal(h.pendingQueries.length,1);
  h.event(a.task,1,4,1);await a.promise;
  const stale=h.pendingQueries.shift();h.reply(stale,0,[...stale.slice(7,11),0,0,15]);await staleQuery;
  assert.equal(h.session.states[0],'learned');h.close();

  // Unlearned preflight points to the actual nested block and cannot declare a run.
  h=await setup();await h.ready();
  await assert.rejects(h.session.prepareRun([{id:'loop',children:[block(3)]}]),error=>error.slot===3&&error.path.join('.')==='0.0');
  assert(!h.writes.some(p=>p[6]===OP.DECLARE_RUN));
  h.config.mask=1;h.session.states[0]='unknown';await run(h);
  assert(h.writes.some(p=>p[6]===OP.DECLARE_RUN&&p[11]===1));
  await assert.rejects(h.session.learn(2),/不能同时/);
  assert.throws(()=>h.session.setMemo(1,'不能改'),/运行期间/);
  let complete=0,p=h.session.wait(1).then(()=>complete++);await tick();
  const task1=h.session.waiting.task;
  h.hit(task1,1);await tick();assert.equal(complete,0,'accepted wait is not armed');
  h.event(task1,1,11,1,0,240);const readyTimer=h.session.waiting.timer;
  h.event(task1,1,11,1,0,1);assert.equal(h.session.waiting.timer,readyTimer,'duplicate ready cannot extend the task deadline');
  h.hit(task1,2);h.hit(task1+100,1);await tick();assert.equal(complete,0,'other words and tasks cannot advance');
  h.hit(task1,1,200);await p;assert.equal(complete,1,'global event counter wrap/jumps do not reject a matching fresh task');
  p=h.session.wait(1).then(()=>complete++);await tick();const task2=h.session.waiting.task;assert(task2>task1);
  h.event(task2,1,11,1);h.hit(task1,1);await tick();assert.equal(complete,1,'next same-slot wait needs new speech');
  h.hit(task2,1);await p;h.hit(task2,1);assert.equal(complete,2,'duplicate hits cannot advance twice');
  await h.session.endRun();assert.equal(h.session.run,null);
  const countBefore=h.writes.length;
  await h.session.prepareRun([{id:'display-off'}]);await h.session.beginRun();assert(h.writes.slice(countBefore).some(p=>p[6]===OP.DECLARE_RUN),'old actions also declare runs');
  await h.session.endRun();const store=h.store,maxTask=task2,maxRun=Number(store.getItem(`xiaobai:${h.session.uid}:counter:run`));h.close();
  h=await setup({storage:store,mask:1});await h.ready();await run(h);assert(h.session.run.id>maxRun,'run IDs persist through reconnect');
  const interrupted=h.session.wait(1).catch(e=>e);await tick();assert(h.session.waiting.task>maxTask,'task IDs persist through app session');
  h.callback(incoming(0xd3,[2,90,5,4,0,0,0,0,0,0]));assert.equal((await interrupted).code,'CANCELLED');assert.equal(h.session.run,null);
  h.close();

  // Fresh query status after reconnect; capability refusal differs from timeout.
  h=await setup({caps:0});await h.ready();assert.equal(h.session.capability,'unsupported');assert(h.session.states.every(s=>s==='unknown'));
  await assert.rejects(h.session.prepareRun([block(1)]),/暂不支持/);
  await h.session.prepareRun([{id:'display-off'}]);await h.session.beginRun();assert.equal(h.session.run.legacy,false);await h.session.endRun();h.close();
  h=await setup({unsupported:new Set([OP.READ_UID,OP.QUERY_LEARNED,OP.DECLARE_RUN])});await h.ready();
  await h.session.prepareRun([{id:'display-off'}]);await h.session.beginRun();assert.equal(h.session.run.legacy,true);h.close();
  h=await setup({silent:new Set([OP.QUERY_LEARNED])});await assert.rejects(h.session.initialize(),e=>e.code==='TIMEOUT');
  assert.equal(h.session.query,'error');assert(h.session.states.every(s=>s==='unknown'));
  await assert.rejects(h.session.prepareRun([{id:'display-off'}]),e=>e.code==='TIMEOUT');assert.equal(h.session.run,null);h.close();
  h=await setup({mask:1,silent:new Set([OP.DECLARE_RUN])});await h.ready();await h.session.prepareRun([block(1)]);
  await assert.rejects(h.session.beginRun(),e=>e.code==='TIMEOUT');assert.equal(h.session.run,null);h.close();
  h=await setup({mask:1,unsupported:new Set([OP.DECLARE_RUN])});await h.ready();await h.session.prepareRun([block(1)]);
  await assert.rejects(h.session.beginRun(),e=>e.result===2);assert.equal(h.session.run,null,'new learned programs cannot use a legacy run fallback');h.close();
  h=await setup({queryResult:9});await assert.rejects(h.session.initialize(),e=>e.result===9);
  assert(h.session.states.every(s=>s==='unknown'));h.close();

  // Entering programming starts the heartbeat immediately; delays are never a substitute for mode proof.
  h=await setup({dropStatus:1,heartbeatMs:100});await h.ready();
  assert.equal(h.writes.filter(p=>p[6]===OP.QUERY_STATUS).length,2,'one lost status reply permits exactly one read-only retry');
  assert.equal(h.writes.filter(p=>p[6]===OP.ENTER_PROGRAM).length,1,'status retry never replays a mode action');
  assert(h.writes.some(p=>p[6]===OP.HEARTBEAT),'heartbeat continues while confirmation is pending');h.close();
  h=await setup({dropStatus:2});await assert.rejects(h.session.initialize(),e=>e.code==='TIMEOUT');
  assert.equal(h.writes.filter(p=>p[6]===OP.QUERY_STATUS).length,2);assert(!h.writes.some(p=>p[6]===OP.READ_UID||p[6]===OP.QUERY_LEARNED));assert.equal(h.session.query,'error');h.close();
  h=await setup({statusMode:MODE.VOICE});await assert.rejects(h.session.initialize(),e=>e.code==='MODE');
  assert(!h.writes.some(p=>p[6]===OP.QUERY_LEARNED),'an optimistic local mode cannot authorize slot queries');h.close();
  h=await setup({statusResult:2});await assert.rejects(h.session.initialize(),e=>e.result===2);
  assert.equal(h.session.legacy,false,'unsupported mode query cannot unlock legacy execution');h.close();
  h=await setup({timing:{settleMs:40}});const settling=h.session.initialize().catch(e=>e);
  await tick();h.session.stop('cancel settling');assert.equal((await settling).code,'CANCELLED');
  assert(!h.writes.some(p=>p[6]===OP.QUERY_STATUS||p[6]===OP.QUERY_LEARNED),'cancelled settle cannot restart querying');h.close();
  h=await setup({timing:{settleMs:20}});let observedAt=0;
  const stabilizing=h.session.initialize();
  await new Promise(r=>setTimeout(r,10));observedAt=Date.now();h.callback(incoming(0xd3,[1,99,MODE.PROGRAM,0,0,0,0,0,0,0]));
  await stabilizing;assert(Date.now()-observedAt>=19,'a later real mode event receives its own stability window');h.close();

  // Local timeouts only cancel; they never fabricate progress/success.
  h=await setup({timing:{taskMs:20}});await h.ready();a=await startLearn(h);await a.promise;
  assert.equal(h.session.learning.phase,'timeout');assert.equal(h.session.states[0],'unknown');await tick();assert(h.writes.some(p=>p[6]===OP.STOP_PROGRAM));h.close();
  h=await setup();await h.ready();h.store.setItem(`xiaobai:${h.session.uid}:counter:task`,String(0xffffffff));
  await assert.rejects(h.session.learn(1),e=>e.code==='EXHAUSTED');assert(!h.writes.some(p=>p[6]===OP.LEARN_COMMAND));h.close();
  h=await setup();await h.ready();h.link.subscribed=false;await assert.rejects(h.session.learn(1),e=>e.code==='DISCONNECTED');h.close();

  // Link reply matching protects against sequence wrap and reports structured rejection.
  h=await setup();h.config.silent=new Set([OP.LEARN_COMMAND]);
  const req=h.link.request(77,OP.LEARN_COMMAND,[...u32(700),1,0],60,(data)=>read32(data)===700);
  await tick();const packet=h.writes.at(-1);h.reply(packet,0,[...u32(699),1,0,0]);
  assert(h.link.pending.has('77:83'),'same seq/op stale task cannot satisfy current request');
  h.reply(packet,7,[...u32(700),1,2,0]);await assert.rejects(req,e=>e.result===7&&e.opcode===OP.LEARN_COMMAND);h.close();
  assert.equal(new Link({close(){}},{minWriteMs:0}).heartbeatMs,300);
  console.log('PASS learned command contract vectors, UID-scoped memo/counters, real progress/save, cancellation, stale queries/replies, run exclusivity, armed hits, reconnect and fail-closed timeouts.');
})().catch(error=>{console.error(error);process.exitCode=1;});
