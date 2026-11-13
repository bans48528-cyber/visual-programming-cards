'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const root=process.env.CARD_APP_ROOT||require('node:path').resolve(__dirname,'..');
const P=require(root+'/xiaobai-multi-protocol.js');
const R=require(root+'/xiaobai-multi-runner.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const block=(uid,id,params={})=>({uid,id,params});
const group=(id,items,trigger)=>({groupId:id,startId:'head-'+id,items,...(trigger?{trigger}:{})});
const snapshot=(groups,manualGroupId)=>({modelId:'xiaobai',groups,...(manualGroupId?{manualGroupId}:{})});
const show=(uid,value)=>block(uid,'display-number',{value});
const wait=(uid,duration)=>block(uid,'wait-time',{duration});

function fixture(){
  let listener,client,serial=0,sample=0;
  const frames=[],applied=[],jobs=[],state={ir:20,flags:9,tilt:1};
  const link={
    programLinkToken:123,closed:false,nextProgramRunSerial:()=>++serial,
    subscribeMulti(fn){listener=fn;return()=>{listener=null;};},
    async write(bytes,guard,before){
      const m=P.decode(bytes);
      if(!guard())return false;
      before();frames.push(m);
      if(m.kind===P.KIND.START)queueMicrotask(()=>reply(m,P.STATE.READY));
      if(m.kind===P.KIND.STOP)queueMicrotask(()=>reply(m,P.STATE.CANCELLED));
      if(m.kind===P.KIND.ACTION)applied.push({at:Date.now(),group:m.group,opcode:m.opcode,args:m.args,task:m.task});
      return true;
    }
  };
  function reply(message,value,reason=0){
    listener?.(P.encode({...message,kind:(message.kind&127)|128,args:[value,reason]},true));
  }
  function sensor(patch={}){
    Object.assign(state,patch);
    if(!client?.sessionLo)return;
    const extra=[state.ir,state.flags,state.tilt,0,0,0,0,0,4,0,...P.u32(0),...P.u32(0),...P.u32(++sample*200)];
    listener?.(P.encode(client.message(P.KIND.SENSOR,0,0,sample,[P.STATE.APPLIED,0,...extra]),true));
  }
  const version=0x020300;
  const connection={enterProgram:async()=>{},ensureFirmware:async()=>true,
    firmware:{snapshot:()=>({ready:true,targetVersion:version,currentVersion:version,epoch:'e',actual:{epoch:'e',info:{version,mode:0,imageValid:true}}})},
    multiProgram:{createClient(options){client=new P.SessionClient(link,{...options,timing:{controlMs:40,queryMs:30,taskMs:1000}});return client;}}
  };
  const timer=setInterval(()=>sensor(),25);
  return {connection,link,frames,applied,state,sensor,reply,get client(){return client;},cleanup(){clearInterval(timer);client?.dispose();}};
}
async function until(fn,ms=1000){
  const end=Date.now()+ms;
  while(!fn()&&Date.now()<end)await delay(3);
  assert.ok(fn(),'condition did not become true');
}

test('ordinary controls advance on local write without any device action acknowledgement',async()=>{
  const f=fixture();const session=new R.SessionCoordinator(f.connection);
  try{
    const result=await session.run(snapshot([group('a',[show('a1',1),show('a2',2)]),group('b',[show('b1',3)])]));
    assert.equal(result.sessionOpen,true);assert.equal(f.applied.length,3);
    assert.equal(f.frames.filter(m=>m.kind===P.KIND.START).length,1);
    assert.equal(f.frames.some(m=>m.kind===P.KIND.STOP||m.kind===P.KIND.CLOSE),false);
    await session.stop();
  }finally{await session.stop().catch(()=>{});f.cleanup();}
});

test('timed motor waits run on the phone independently, not on a firmware DONE',async()=>{
  const f=fixture(),steps=[];const session=new R.SessionCoordinator(f.connection,{onStep:(item,p,id)=>steps.push([id,item.uid,Date.now()])});
  try{
    await session.run(snapshot([group('a',[block('motor-a','motor-forward',{port:'L',duration:.03}),show('eye-a',1)]),
      group('b',[block('motor-b','motor-forward',{port:'R',duration:.06}),show('eye-b',2)])]));
    const at=id=>steps.find(s=>s[1]===id)[2];
    assert.ok(at('motor-b')-at('motor-a')<25);
    assert.ok(at('eye-a')-at('motor-a')>=25);
    assert.ok(at('eye-b')>at('eye-a'));
    assert.equal(f.applied.filter(m=>m.opcode===0x10).length,2);
  }finally{await session.stop();f.cleanup();}
});

test('manual A still dispatches to B, repeated messages restart only B, broadcast wait awaits its new invocation',async()=>{
  const f=fixture(),steps=[];const session=new R.SessionCoordinator(f.connection,{onStep:(item,p,id)=>steps.push([id,item.uid])});
  try{
    const done=session.run(snapshot([
      group('a',[block('send1','send-message',{message:1}),wait('gap',.02),block('send2','send-message-wait',{message:1}),show('done-a',9)]),
      group('b',[wait('wait-b',.06),show('done-b',8)],{type:'message',message:1})
    ],'a'));
    await done;
    assert.equal(steps.filter(x=>x[1]==='wait-b').length,2);
    assert.equal(steps.filter(x=>x[1]==='done-b').length,1);
    assert.ok(steps.findIndex(x=>x[1]==='done-a')>steps.findIndex(x=>x[1]==='done-b'));
    assert.equal(f.frames.filter(m=>m.kind===P.KIND.GROUP_BEGIN&&m.group===2).length,2);
  }finally{await session.stop();f.cleanup();}
});

test('single head can join and cancel while another group keeps running',async()=>{
  const f=fixture(),steps=[];const session=new R.SessionCoordinator(f.connection,{onStep:item=>steps.push(item.uid)});
  try{
    const started=Date.now();
    const running=session.run(snapshot([group('a',[wait('long-a',.12),show('end-a',1)]),
      group('b',[wait('long-b',.08),show('end-b',2)])],'a'));
    await until(()=>steps.includes('long-a'));
    await session.toggleGroup('b');await until(()=>steps.includes('long-b'));
    await session.toggleGroup('b');await running;
    assert.ok(Date.now()-started>=110,'cancel B must not shorten A timer');
    assert.ok(steps.includes('end-a'));assert.equal(steps.includes('end-b'),false);
    assert.equal(f.frames.filter(m=>m.kind===P.KIND.STOP).length,0);
    assert.equal(f.frames.filter(m=>m.kind===P.KIND.GROUP_END&&m.group===2).length,1);
  }finally{await session.stop();f.cleanup();}
});

test('condition loops re-read current values at the boundary rather than latching an earlier hit',async()=>{
  const f=fixture(),steps=[];const session=new R.SessionCoordinator(f.connection,{onStep:item=>steps.push(item.uid)});
  try{
    const loop={uid:'until',id:'loop-infrared',params:{comparison:'greater',threshold:50},children:[wait('round',.07)]};
    const result=session.run(snapshot([group('a',[loop,show('after',1)])]));
    await until(()=>steps.includes('round'));
    f.sensor({ir:80});await delay(12);f.sensor({ir:20});
    await until(()=>steps.filter(s=>s==='round').length===2);
    assert.equal(steps.includes('after'),false);
    f.sensor({ir:80});await result;
    assert.equal(steps.filter(s=>s==='round').length,2);assert.ok(steps.includes('after'));
    assert.equal(f.frames.some(m=>m.kind>=12&&m.kind<=15),false);
  }finally{await session.stop();f.cleanup();}
});

test('voice wait advances only for its exact device task and a new wait requires a new result',async()=>{
  const f=fixture();const session=new R.SessionCoordinator(f.connection);
  try{
    const result=session.run(snapshot([group('a',[block('listen1','speech-wait',{phrase:'ASR_01'}),block('listen2','speech-wait',{phrase:'ASR_01'}),show('after',1)])]));
    await until(()=>f.applied.length===1);
    const first=f.frames.find(m=>m.kind===P.KIND.ACTION);
    f.reply({...first,task:first.task+99},P.STATE.DONE);await delay(12);assert.equal(f.applied.length,1);
    f.reply(first,P.STATE.DONE);await until(()=>f.applied.length===2);
    f.reply(first,P.STATE.DONE);await delay(12);assert.equal(f.applied.length,2);
    const second=f.frames.filter(m=>m.kind===P.KIND.ACTION)[1];
    f.reply(second,P.STATE.DONE);await result;assert.equal(f.applied.length,3);
  }finally{await session.stop();f.cleanup();}
});

test('v2 telemetry is shared, ignores old sequence and is invalidated with the connection',async()=>{
  const f=fixture();const session=new R.SessionCoordinator(f.connection);
  try{
    await session.run(snapshot([group('a',[show('one',1)])]));
    f.sensor({ir:43});const sample=f.client.sensor;assert.equal(sample.ir,43);
    const old=P.encode(f.client.message(P.KIND.SENSOR,0,0,sample.sequence-1,[P.STATE.APPLIED,0,...Array(22).fill(0)]),true);
    f.client.receive(old);assert.equal(f.client.sensor,sample);
    await session.stop();assert.equal(f.client.sensor,null);
  }finally{f.cleanup();}
});

test('the v2 release gate cannot be enabled by an old/future or wrong-epoch application',()=>{
  const f=fixture(),pin={bound:true,firmware:{boardId:258,protocol:1,version:0x020300}};
  try{
    assert.equal(R.releaseAllows(pin,f.connection.firmware),true);
    assert.equal(R.releaseSupports({...pin,firmware:{...pin.firmware,version:0x020203}}),false);
    assert.equal(R.releaseSupports({...pin,firmware:{...pin.firmware,version:0x020301}}),false);
    assert.equal(R.releaseAllows(pin,{...f.connection.firmware.snapshot(),epoch:'old'}),false);
    assert.equal(P.actionArgs(0x30,[1,0,50],2),false);
    assert.equal(P.actionArgs(0x34,[1],2),false);
  }finally{f.cleanup();}
});

test('STOP remains dispatchable while an in-flight START is waiting for native completion',async()=>{
  let receive,releaseStart;
  const frames=[],aborts=[];
  let tail=Promise.resolve();
  const link={closed:false,programLinkToken:19,nextProgramRunSerial:()=>1,subscribeMulti(fn){receive=fn;return()=>{};},
    write(bytes,guard,before){
      const m=P.decode(bytes);
      const writing=tail.then(async()=>{
        if(!guard())return false;
        before();frames.push(m);
        if(m.kind===P.KIND.START)await new Promise(resolve=>{releaseStart=resolve;});
        if(m.kind===P.KIND.STOP)receive(P.encode({...m,kind:m.kind|128,args:[P.STATE.CANCELLED,0]},true));
        return true;
      });
      tail=writing.catch(()=>{});return writing;
    }};
  const client=new P.SessionClient(link,{onAbort:e=>aborts.push(e),timing:{controlMs:30,retries:0}});
  const opening=client.open(1);opening.catch(()=>{});
  await until(()=>Boolean(releaseStart));
  const stopping=client.stop();await assert.rejects(opening,{code:'CANCELLED'});
  releaseStart();await stopping;
  assert.deepEqual(frames.map(m=>m.kind),[P.KIND.START,P.KIND.STOP]);
  assert.equal(aborts.length,0);assert.equal(client.phase,'closed');
});

test('a waiting voice task survives more than 64 actions in a different group',async()=>{
  const f=fixture();const session=new R.SessionCoordinator(f.connection);
  try{
    const result=session.run(snapshot([group('a',[block('voice','speech-wait',{phrase:'ASR_01'}),show('end-a',1)]),
      group('b',Array.from({length:70},(_,i)=>show('b-'+i,i%100)))]));
    await until(()=>f.applied.length>=71);
    const voice=f.frames.find(m=>m.kind===P.KIND.ACTION&&m.opcode===0x51);
    assert.ok(f.client.actions.has(voice.task));assert.ok(f.client.records.has(voice.task));
    f.reply(voice,P.STATE.DONE);await result;
    assert.equal(f.applied.at(-1).args[0],1);
  }finally{await session.stop();f.cleanup();}
});

test('an initial sender finishing cannot finish the work before its dynamic receiver',async()=>{
  const f=fixture(),steps=[];const session=new R.SessionCoordinator(f.connection,{onStep:item=>steps.push(item.uid)});
  try{
    const started=Date.now();
    await session.run(snapshot([group('a',[block('send','send-message',{message:1})]),
      group('b',[wait('long-b',.08),show('end-b',2)],{type:'message',message:1})]));
    assert.ok(Date.now()-started>=75);assert.ok(steps.includes('end-b'));assert.equal(session.running,false);
  }finally{await session.stop();f.cleanup();}
});

test('broadcast-and-wait tracks the invocation it started, including when a later broadcast replaces it',async()=>{
  const f=fixture(),steps=[];const session=new R.SessionCoordinator(f.connection,{onStep:item=>steps.push([item.uid,Date.now()])});
  try{
    await session.run(snapshot([
      group('a',[block('wait-send','send-message-wait',{message:1}),show('after-a',1)]),
      group('b',[wait('long-b',.08),show('after-b',2)],{type:'message',message:1}),
      group('c',[wait('pause',.025),block('again','send-message',{message:1})])
    ]));
    const at=id=>steps.find(s=>s[0]===id)[1];
    assert.equal(steps.filter(s=>s[0]==='long-b').length,2);
    assert.ok(at('after-a')<at('after-b')-30,'A waits for replaced old B, not the later B invocation');
  }finally{await session.stop();f.cleanup();}
});

test('single and combined power blocks update the same shared setting for speed changes',()=>{
  const shared={comboPower:3};
  assert.deepEqual(R.command(block('p','motor-power',{power:1}),shared).args,[1]);
  assert.deepEqual(R.command(block('u','speed-up'),shared).args,[2]);
  assert.deepEqual(R.command(block('q','combo-power',{power:3}),shared).args,[3]);
  assert.deepEqual(R.command(block('d','speed-down'),shared).args,[2]);
});

test('an unrelated empty group is a harmless script when another head is run',async()=>{
  const f=fixture();const session=new R.SessionCoordinator(f.connection);
  try{
    await session.run(snapshot([group('a',[show('a1',1)]),group('b',[])],'a'));
    assert.equal(f.applied.length,1);assert.equal(session.records.size,2);
  }finally{await session.stop();f.cleanup();}
});

test('all v2 groups share the real Link 100ms logical-frame pace and FIFO task order',async()=>{
  const {Link}=require(root+'/xiaobai-protocol.js'),writes=[];
  const link=new Link({close(){},async write(bytes){writes.push({m:P.decode(bytes),at:Date.now()});}},{minWriteMs:1});
  const message=(task,group)=>P.encode({version:2,kind:4,group,opcode:0x41,task,sessionLo:1,sessionHi:2,args:[task]});
  try{
    await Promise.all([link.write(message(5,1)),link.write(message(6,2)),link.write(message(7,1)),link.write(message(8,2))]);
    assert.deepEqual(writes.map(row=>row.m.task),[5,6,7,8]);
    for(let i=1;i<writes.length;i++)assert.ok(writes[i].at-writes[i-1].at>=90,'100ms pace is per frame, shared across groups');
  }finally{link.close();}
});

test('STOP overtakes a v2 flood and canceled queued actions cannot run afterward',async()=>{
  const {Link}=require(root+'/xiaobai-protocol.js'),writes=[];let allowed=true;
  const link=new Link({close(){},async write(bytes){writes.push({m:P.decode(bytes),at:Date.now()});}},{minWriteMs:1});
  link.maxQueuedWrites=4;
  const message=(kind,task,args=[])=>P.encode({version:2,kind,group:kind===4?1:0,opcode:kind===4?0x41:0,task,sessionLo:1,sessionHi:2,args});
  try{
    const pending=Array.from({length:5},(_,i)=>link.write(message(4,i+5,[i]),()=>allowed).catch(error=>error.code));
    await delay(5);
    const started=Date.now();
    await link.write(message(8,0),()=>true,()=>{allowed=false;},{priority:0});
    await Promise.all(pending);
    assert.ok(Date.now()-started<90,'STOP does not wait for the 100ms ordinary-action pacing slot');
    const stopAt=writes.findIndex(row=>row.m.kind===8);
    assert.ok(stopAt>=0);assert.equal(writes.slice(stopAt+1).some(row=>row.m.kind===4),false);
  }finally{link.close();}
});
