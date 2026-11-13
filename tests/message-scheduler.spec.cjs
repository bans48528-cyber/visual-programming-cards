'use strict';
// Shipping scheduler with a controlled reusable-group API. The verified firmware
// identity is synthetic: no radio, protocol emulator, device or browser is used.
const test=require('node:test'),assert=require('node:assert/strict');
const Multi=require('../xiaobai-multi-runner.js'),P=require('../xiaobai-protocol.js');
const firmwareFixture=require('./helpers/motion-condition-fixture.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label='scheduler state'){const end=Date.now()+1500;while(!fn()&&Date.now()<end)await sleep(2);assert.ok(fn(),label);}
const observed=promise=>promise.then(value=>({value}),error=>({error}));
const item=(uid,id,params={},children)=>({uid:'node-'+uid,id,params,...(children?{children}:{})});
const send=(uid,message)=>item(uid,'send-message',{message});
const off=uid=>item(uid,'display-off');
const number=(uid,value)=>item(uid,'display-number',{value});
const repeat=(uid,count,children)=>item(uid,'loop-count',{count},children);
const condition=uid=>item(uid,'loop-time',{duration:0},[off(uid+'-inside')]);
const group=(groupId,items,message)=>({groupId,startId:'head-'+groupId,items,...(message===undefined?{}:{trigger:{type:'message',message}})});
const snapshot=(...groups)=>({modelId:'xiaobai',projectId:'messages',groups});
function firmware(version=0x020202){
  const f=firmwareFixture(version);Object.assign(f.snapshot().actual,{uid:'ab'.repeat(12),deviceId:'synthetic-message-device'});return f;
}
function fixture(options={}){
  const calls=[],pending={begin:[],action:[],finish:[]},counts=new Map(),states=[],observerCalls=[];
  let serial=4,task=4,clientOptions,observerOptions;
  function call(kind,data){const record={kind,...data};calls.push(record);return record;}
  function controlled(kind,record,value){
    const hold=options['hold'+kind[0].toUpperCase()+kind.slice(1)];
    if(!hold?.(record))return Promise.resolve(value);
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
    pending[kind].push({...record,promise,resolve,reject,defaultValue:value});return promise;
  }
  const client={sessionLo:7,sessionHi:8,
    async open(count,opts){call('open',{count,options:opts});if(options.startError)throw options.startError;return {reusable:true};},
    beginGroup(token){
      const ordinal=(counts.get(token)||0)+1;counts.set(token,ordinal);
      const invocationId=options.invocationId?.(token,ordinal)??++serial;
      const record=call('begin',{token,ordinal,invocationId});options.onBegin?.(record);
      return controlled('begin',record,invocationId);
    },
    action(token,opcode,args,opts){
      const record=call('action',{token,opcode,args,invocationId:opts?.invocationId,task:++task});
      opts?.onDispatched?.({group:token,task:record.task,state:1});
      if(options.actionError?.(record))return Promise.reject(Error('action failure'));
      return controlled('action',record,{state:4}).then(reply=>{opts?.onState?.({group:token,task:record.task,...reply});return reply;});
    },
    finishGroup(token,invocationId){const record=call('finish',{token,invocationId});return controlled('finish',record,{state:3,group:token,task:invocationId});},
    async endGroup(token){call('legacy-end',{token});},async close(){call('close',{});},async stop(){call('stop',{});},dispose(){call('dispose',{});}
  };
  if(options.missingMethods){delete client.beginGroup;delete client.finishGroup;}
  const observer={
    async arm(token,descriptor,{runId}={}){
      observerCalls.push({kind:'arm',token,runId,descriptor});
      return {group:token,id:1,matched:true,check(){},async refresh(){return true;},async close(){observerCalls.push({kind:'observer-close',token,runId});}};
    },
    retireGroup(token,runId){observerCalls.push({kind:'retire',token,runId});},
    cancel(){observerCalls.push({kind:'cancel-all'});},dispose(){observerCalls.push({kind:'dispose-all'});}
  };
  const connection={firmware:options.firmware||firmware(),async enterProgram(){call('enter',{});},async ensureFirmware(){return true;},
    conditionObservers:{createClient(opts){observerOptions=opts;return observer;}}};
  const coordinator=new Multi.SessionCoordinator(connection,{signal:options.signal,createClient:opts=>{clientOptions=opts;return client;},
    onGroupState:(id,state)=>{states.push({id,state});options.onState?.(id,state);}});
  return {coordinator,client,connection,calls,pending,states,observerCalls,counts,
    get clientOptions(){return clientOptions;},get observerOptions(){return observerOptions;},
    records:()=>coordinator.messageRecords,
    release(kind,index=0,value){const entry=pending[kind][index];assert.ok(entry,'pending '+kind);entry.resolve(value??entry.defaultValue);},
    count:(kind,token)=>calls.filter(c=>c.kind===kind&&(token===undefined||c.token===token)).length};
}

test('message snapshots preserve triggers and loop sends, freeze identities and choose only ordinary launch heads',()=>{
  const input=snapshot(group('z',[off('z')],6),group('a',[repeat('loop',2,[send('send',6)])]));
  const result=Multi.validateSnapshot(input);
  assert.deepEqual(result.launchOrder,['a']);assert.equal(result.groups[1].trigger.message,6);
  assert.equal(result.groups[0].items[0].children[0].id,'send-message','validation wait must never enter executable data');
  assert.ok(Object.isFrozen(result.groups[1].trigger));assert.ok(Object.isFrozen(result.groups[0].items[0].children[0].params));
  assert.equal(input.groups[0].groupId,'z');assert.equal(Multi.hasMessages(result),true);
  for(const value of [0,7,1.5,'1',null]){
    assert.throws(()=>Multi.validateSnapshot(snapshot(group('a',[send('s',value)]))),e=>e.code==='MESSAGE'&&e.blockUid==='node-s'&&e.path[0]===0);
    assert.throws(()=>Multi.validateSnapshot(snapshot(group('a',[off('a')],value))),{code:'MESSAGE'});
  }
  const only=snapshot(group('b',[off('b')],1));assert.throws(()=>Multi.validateSnapshot(only),{code:'NO_NORMAL_GROUP'});
  assert.deepEqual(Multi.validateSnapshot({...only,manualGroupId:'b'}).launchOrder,['b']);
  assert.throws(()=>Multi.validateSnapshot({...only,manualGroupId:'missing'}),{code:'MANUAL_GROUP'});
  assert.throws(()=>Multi.validateSnapshot(snapshot(...Array.from({length:5},(_,i)=>group('g'+i,[off('n'+i)],i%6+1)))),{code:'GROUP_LIMIT'});
});

test('message support requires current 2.2.2 application readiness and no ordinary image/UID proof',()=>{
  assert.equal(Multi.requireProgramReady({firmware:firmware(0x020203)}),true);
  const f=firmware();assert.equal(Multi.requireProgramReady({firmware:f}),true);
  for(const version of [0x020105,0x020106,0x020200,0x020201,0x020204])assert.throws(()=>Multi.requireProgramReady({firmware:firmware(version)}),{code:'FIRMWARE'});
  const patches=[f=>{f.snapshot().actual.epoch='old';},f=>{f.snapshot().actual.info.mode=1;},f=>{f.snapshot().actual.info.imageValid=false;},f=>{f.snapshot().ready=false;}];
  for(const patch of patches){const fw=firmware();patch(fw);assert.throws(()=>Multi.requireProgramReady({firmware:fw}),{code:'FIRMWARE'});}
  delete f.bundle;delete f.snapshot().actual.uid;delete f.snapshot().actual.info.imageSha256;delete f.snapshot().actual.info.layoutId;
  assert.equal(Multi.requireProgramReady({firmware:f}),true,'ordinary readiness does not need full OTA evidence');
  const pin={bound:true,firmware:{boardId:258,protocol:1,version:0x020202}};assert.equal(Multi.releaseSupports(pin),true);
  for(const version of [0x020105,0x020200,0x020201,0x020204])assert.equal(Multi.releaseSupports({...pin,firmware:{...pin.firmware,version}}),false);
});

test('old firmware, absent runtime methods and rejected START fail before worker actions',async()=>{
  const input=snapshot(group('a',[send('send',1)]),group('b',[off('b')],1));
  const old=fixture({firmware:firmware(0x020105)});await assert.rejects(old.coordinator.run(input),{code:'FIRMWARE'});assert.equal(old.count('open'),0);
  const absent=fixture({missingMethods:true});await assert.rejects(absent.coordinator.run(input),{code:'UNSUPPORTED'});assert.equal(absent.count('open'),0);
  const rejected=fixture({startError:Object.assign(new Error('START rejected'),{code:'UNSUPPORTED'})});await assert.rejects(rejected.coordinator.run(input),{code:'UNSUPPORTED'});assert.equal(rejected.count('begin')+rejected.count('action'),0);
});

test('all listeners register before initial starts; a local send starts every match without waiting for their bodies',async()=>{
  let f;
  f=fixture({holdAction:r=>r.token===2||r.token===3,onState:(id,state)=>{if(id==='a'&&state==='STARTING')assert.deepEqual([...f.records().values()].map(v=>v.phase),['STARTING','IDLE','IDLE','IDLE']);},onBegin:r=>{
    if(r.token===2)assert.equal(f.records().get('c').phase,'STARTING','all matching listeners must already be reserved');
  }});
  const run=observed(f.coordinator.run(snapshot(group('a',[send('s',1),number('sender-next',99)]),group('b',[off('b')],1),group('c',[off('c')],1),group('d',[off('d')],2))));
  await until(()=>f.count('action',1)===1&&f.pending.action.length===2);
  assert.equal(f.count('begin',4),0);assert.deepEqual(f.calls.find(c=>c.kind==='open').options.initialGroups,[1]);
  assert.equal(f.calls.find(c=>c.kind==='action'&&c.token===1).args[0],99);
  assert.equal(f.count('action'),3,'send itself must not be an ACTION');
  f.release('action',0);f.release('action',1);assert.equal((await run).error,undefined);
  assert.equal(f.count('close'),1);assert.equal(f.count('legacy-end'),0);
});

test('STARTING RUNNING and FINISHING ignore duplicate sends with no copied work or history replay',async()=>{
  const f=fixture({holdBegin:r=>r.token===2&&r.ordinal===1,holdAction:r=>r.token===1||r.token===2&&r.invocationId===5,
    holdFinish:r=>r.token===2&&r.invocationId===5});
  const run=observed(f.coordinator.run(snapshot(group('a',[send('send',1),off('sender-hold')]),group('b',[off('receiver')],1))));
  await until(()=>f.pending.begin.length===1&&f.count('action',1)===1);
  assert.equal(f.records().get('b').phase,'STARTING');assert.equal(f.coordinator.dispatchMessage(1),0);
  f.release('begin');await until(()=>f.pending.action.some(r=>r.token===2));
  assert.equal(f.records().get('b').phase,'RUNNING');assert.equal(f.coordinator.dispatchMessage(1),0);
  f.release('action',f.pending.action.findIndex(r=>r.token===2));await until(()=>f.pending.finish.length===1);
  assert.equal(f.records().get('b').phase,'FINISHING');assert.equal(f.coordinator.dispatchMessage(1),0);
  f.release('finish');await until(()=>f.records().get('b').phase==='IDLE');
  assert.equal(f.count('begin',2),1);assert.equal(f.coordinator.dispatchMessage(1),1);
  await until(()=>f.count('finish',2)===2&&f.records().get('b').phase==='IDLE');
  f.release('action',f.pending.action.findIndex(r=>r.token===1));assert.equal((await run).error,undefined);
  assert.equal(f.count('begin',2),2);assert.equal(f.count('finish',2),2);
});

test('two ordinary senders cannot duplicate a receiver already synchronously reserved',async()=>{
  const f=fixture({holdBegin:r=>r.token===2});
  const run=observed(f.coordinator.run(snapshot(group('a',[send('s1',1)]),group('b',[off('b')],1),group('c',[send('s2',1)]))));
  await until(()=>f.pending.begin.length===1);assert.equal(f.count('begin',2),1);
  f.release('begin');assert.equal((await run).error,undefined);assert.equal(f.count('begin',2),1);
});

test('loop-local messages with no listeners are no-ops and do not add wire actions',async()=>{
  const f=fixture();await f.coordinator.run(snapshot(group('a',[repeat('r',3,[send('s',6)])])));
  assert.equal(f.count('action'),0);assert.equal(f.count('begin'),0);assert.equal(f.count('finish'),1);assert.equal(f.count('close'),1);
});

test('manual message-head testing runs it once without auto-starting ordinary heads or replaying its own send',async()=>{
  const f=fixture();const input={...snapshot(group('a',[off('a')]),group('b',[send('self',1),off('b')],1)),manualGroupId:'b'};
  await f.coordinator.run(input);assert.equal(f.count('begin',1),0);assert.equal(f.count('begin',2),0);assert.deepEqual(f.calls.find(c=>c.kind==='open').options.initialGroups,[2]);assert.equal(f.count('action'),1);
  const alone=fixture();await alone.coordinator.run({...snapshot(group('b',[off('only')],1)),manualGroupId:'b'});assert.equal(alone.count('begin'),0);
});

test('a receiver can send another message while busy cyclic sends are ignored',async()=>{
  const f=fixture({holdAction:r=>r.token===2});
  const run=observed(f.coordinator.run(snapshot(group('a',[send('a-send',1)]),group('b',[send('b-send',2),off('b-hold')],1),group('c',[send('c-send',1),off('c')],2))));
  await until(()=>f.count('action',2)===1&&f.count('action',3)===1);assert.equal(f.count('begin',2),1);
  f.release('action');assert.equal((await run).error,undefined);assert.equal(f.count('begin',2),1);assert.equal(f.count('begin',3),1);
});

test('later BEGIN readiness is awaited and non-DONE FINISH cannot make a group IDLE',async()=>{
  const f=fixture({holdBegin:r=>r.token===2,holdFinish:r=>r.token===2});
  const run=observed(f.coordinator.run(snapshot(group('a',[send('start',1)]),group('b',[off('b')],1))));
  await until(()=>f.pending.begin.length===1);assert.equal(f.count('action'),0);f.release('begin');await until(()=>f.pending.finish.length===1);assert.equal(f.records().get('b').phase,'FINISHING');
  f.release('finish',0,{state:1,group:2,task:5});assert.equal((await run).error.code,'FINISH_UNCONFIRMED');assert.equal(f.count('stop'),1);assert.equal(f.count('close'),0);
});

test('invalid or reused invocation identities fail before actions for that invocation',async()=>{
  const bad=fixture({invocationId:()=>0});await assert.rejects(bad.coordinator.run(snapshot(group('a',[send('s',1)]),group('b',[off('bad')],1))),{code:'INVOCATION'});assert.equal(bad.count('action'),0);
  const f=fixture({invocationId:()=>5,holdAction:r=>r.token===1});
  const run=observed(f.coordinator.run(snapshot(group('a',[send('s',1),off('hold')]),group('b',[off('b')],1))));
  await until(()=>f.count('finish',2)===1&&f.records().get('b')?.phase==='IDLE');
  assert.equal(f.coordinator.dispatchMessage(1),1);const result=await run;assert.equal(result.error.code,'INVOCATION');assert.equal(f.count('action',2),1);
});

test('STOP cancels pending BEGIN ACTION or FINISH locally and late resolutions cannot continue',async()=>{
  for(const stage of ['begin','action','finish']){
    const f=fixture({['hold'+stage[0].toUpperCase()+stage.slice(1)]:()=>true});
    const input=stage==='begin'?snapshot(group('a',[send('s',1)]),group('b',[off('b')],1)):snapshot(group('a',[off('a'),send('s',6)]));
    const run=observed(f.coordinator.run(input));
    await until(()=>f.pending[stage].length===1);const at=Date.now();await f.coordinator.stop();
    assert.equal((await run).error.code,'CANCELLED');assert.ok(Date.now()-at<500);assert.equal(f.count('stop'),1);assert.equal(f.count('close'),0);
    assert.equal(f.coordinator.messageWorkers.size,0);assert.ok([...f.records().values()].every(r=>!r.queued&&r.context===null));
    const before=f.count('action');f.release(stage);await sleep(5);assert.equal(f.count('action'),before);
  }
});

test('each receiver invocation uses its own condition runId and retires only that group after real FINISH DONE',async()=>{
  const f=fixture({holdAction:r=>r.token===1});
  const run=observed(f.coordinator.run(snapshot(group('a',[send('s',1),off('a-hold')]),group('b',[condition('condition')],1))));
  await until(()=>f.count('finish',2)===1&&f.records().get('b').phase==='IDLE');
  assert.equal(f.observerOptions.reusable,true);assert.equal(f.observerCalls.some(c=>c.kind==='dispose-all'),false);
  f.coordinator.dispatchMessage(1);await until(()=>f.count('finish',2)===2&&f.records().get('b').phase==='IDLE');
  const arms=f.observerCalls.filter(c=>c.kind==='arm'),retired=f.observerCalls.filter(c=>c.kind==='retire'&&c.token===2);
  assert.equal(arms.length,2);assert.notEqual(arms[0].runId,arms[1].runId);assert.deepEqual(retired.map(c=>c.runId),arms.map(c=>c.runId));
  assert.equal(f.observerCalls.some(c=>c.kind==='cancel-all'),false);
  f.release('action');assert.equal((await run).error,undefined);assert.equal(f.observerCalls.filter(c=>c.kind==='dispose-all').length,1);
});

test('receiver failure stops all workers once and an overlapping coordinator cannot start',async()=>{
  const f=fixture({holdBegin:r=>r.token===2,actionError:r=>r.token===2});
  const run=observed(f.coordinator.run(snapshot(group('a',[send('s',1)]),group('b',[off('bad')],1))));
  await until(()=>f.pending.begin.length===1);
  const other=fixture();assert.throws(()=>other.coordinator.run(snapshot(group('other',[off('other')]))),{code:'BUSY'});assert.equal(other.calls.length,0);
  f.release('begin');const result=await run;assert.match(result.error.message,/action failure/);assert.equal(result.error.groupId,'b');assert.equal(f.count('stop'),1);
  const next=fixture();await next.coordinator.run(snapshot(group('next',[off('next')])));assert.equal(next.count('legacy-end'),0);assert.equal(next.count('finish'),1,'ordinary START execution still works after cleanup');
});
