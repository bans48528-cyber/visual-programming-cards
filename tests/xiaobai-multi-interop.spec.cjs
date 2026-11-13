'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../xiaobai-multi-protocol.js'),{SessionCoordinator}=require('../xiaobai-multi-runner.js');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}throw new Error('test state did not arrive');}
function setup(heldOp,failGroup=0){
  const observers=new Set(),writes=[],live=new Map(),states=[];let client;
  function reply(req,state,reason=0,extra=[]){const bytes=P.encode({...req,kind:req.kind|0x80,args:[state,reason,...extra]},true);for(const listener of observers)listener(bytes);}
  const link={closed:false,subscribeMulti(fn){observers.add(fn);return()=>observers.delete(fn);},onLifecycle(){return()=>{};},onMultiLifecycle(){return()=>{};},async write(bytes,guard=()=>true,before=()=>{}){
    if(!guard())return false;before();const req=P.decode(bytes);writes.push(req);
    switch(req.kind){
      case P.KIND.CAPS:reply(req,P.STATE.READY,0,[4,4,3,1,3,0,1,2,3,4,5,6,7,8]);break;
      case P.KIND.OPEN:case P.KIND.GROUP_OPEN:reply(req,P.STATE.ACCEPTED);break;
      case P.KIND.COMMIT:reply(req,P.STATE.READY);break;
      case P.KIND.ACTION:live.set(req.task,req);if(req.group===failGroup){reply(req,P.STATE.FAILED,P.REASON.CONFLICT);break;}reply(req,P.STATE.ACCEPTED);if(req.opcode!==heldOp)reply(req,P.STATE.APPLIED);break;
      case P.KIND.GROUP_END:case P.KIND.CLOSE:reply(req,P.STATE.DONE);break;
      case P.KIND.STOP:reply(req,P.STATE.CANCELLED);break;
    }
    return true;
  }};
  const connection={async enterProgram(){},async ensureFirmware(){return true;}};
  const coordinator=new SessionCoordinator(connection,{createClient:options=>(client=new P.SessionClient(link,options)),onGroupState:(...args)=>states.push(args)});
  const snapshot=groups=>({modelId:'xiaobai',projectId:'fixture',groups:groups.map(([id,items])=>({groupId:id,startId:id+'-head',items:items.map((item,i)=>({uid:id+'-'+i,...item}))}))});
  return {coordinator,connection,writes,states,live,reply,snapshot,get client(){return client;}};
}
test('real Coordinator -> real SessionClient -> D4: two prepared groups progress independently and close only after both END',async t=>{
  const f=setup(0x32);const done=f.coordinator.run(f.snapshot([['z',[{id:'display-number',params:{value:8}}]],['a',[{id:'tilt-wait',params:{direction:'forward'}}]]]));
  done.catch(()=>{});t.after(()=>f.coordinator.stop().catch(()=>{}));
  await until(()=>f.writes.some(r=>r.kind===P.KIND.GROUP_END&&r.group===2));const actions=f.writes.filter(r=>r.kind===P.KIND.ACTION);assert.equal(actions.length,2);assert.ok(actions[0].task<actions[1].task);
  assert.ok(f.writes.some(r=>r.kind===P.KIND.GROUP_END&&r.group===2));assert.equal(f.writes.some(r=>r.kind===P.KIND.CLOSE),false);
  assert.equal(f.writes.some(r=>r.kind===P.KIND.STOP),false);assert.equal(f.writes.filter(r=>r.kind===P.KIND.GROUP_OPEN).length,2);
  const wait=actions.find(r=>r.opcode===0x32);f.reply(wait,P.STATE.DONE);f.reply(wait,P.STATE.DONE);await done;
  assert.equal(f.writes.filter(r=>r.kind===P.KIND.CLOSE).length,1);assert.equal(f.writes.filter(r=>r.kind===P.KIND.GROUP_END).length,2);
  assert.equal(f.writes.filter(r=>r.kind===P.KIND.ACTION).length,2);assert.equal(f.coordinator.taskContexts.size,0);
});
test('real retained PLAY failure locates original UID after PC advanced, sends one STOP and never closes successfully',async t=>{
  const f=setup(-1);const done=f.coordinator.run(f.snapshot([['a',[{id:'speech-play',params:{phrase:'P01'}},{id:'wait-time',params:{duration:100}}]]]));
  done.catch(()=>{});t.after(()=>f.coordinator.stop().catch(()=>{}));
  await until(()=>f.states.some(s=>s[1]==='WAIT_TIMER'));const audio=f.writes.find(r=>r.kind===P.KIND.ACTION);assert.equal(audio.opcode,0x50);
  f.reply(audio,P.STATE.FAILED,P.REASON.ASR);
  await assert.rejects(done,error=>error.groupId==='a'&&error.blockUid==='a-0'&&error.task===audio.task);
  assert.equal(f.writes.filter(r=>r.kind===P.KIND.STOP).length,1);assert.equal(f.writes.some(r=>r.kind===P.KIND.CLOSE),false);
});

test('any-orientation still target uses real C4/D4 task completion; ACCEPTED and old task DONE do not advance the next wait',async t=>{
  const f=setup(0x34);
  f.connection.firmware=require('./helpers/motion-condition-fixture.cjs')();
  const done=f.coordinator.run(f.snapshot([['a',[{id:'motion-wait',params:{state:'still'}},{id:'motion-wait',params:{state:'still'}},{id:'display-off'}]]]));
  done.catch(()=>{});t.after(()=>f.coordinator.stop().catch(()=>{}));
  const actions=()=>f.writes.filter(r=>r.kind===P.KIND.ACTION);
  await until(()=>actions().length===1);const first=actions()[0];assert.deepEqual(first.args,[1]);
  await tick();assert.equal(actions().length,1,'ACCEPTED cannot finish still wait');
  f.reply(first,P.STATE.DONE);f.reply(first,P.STATE.DONE);
  await until(()=>actions().length===2);const second=actions()[1];assert.deepEqual(second.args,[1]);assert.notEqual(second.task,first.task);
  f.reply(first,P.STATE.DONE);await tick();assert.equal(actions().length,2);
  f.reply(second,P.STATE.DONE);await done;
  assert.equal(actions().length,3);assert.equal(actions()[2].opcode,0x42);
});
test('failure before ACCEPTED keeps the offending group UID when it rejects every other pending group',async t=>{
  const f=setup(0x32,2);const done=f.coordinator.run(f.snapshot([['a',[{id:'tilt-wait',params:{direction:'forward'}}]],['b',[{id:'tilt-wait',params:{direction:'left'}}]]]));
  done.catch(()=>{});t.after(()=>f.coordinator.stop().catch(()=>{}));
  await until(()=>f.writes.filter(r=>r.kind===P.KIND.ACTION).length===2);
  const bad=f.writes.filter(r=>r.kind===P.KIND.ACTION)[1];
  await assert.rejects(done,error=>error.groupId==='b'&&error.blockUid==='b-0'&&error.task===bad.task);
});
