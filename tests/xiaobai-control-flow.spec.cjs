'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Flow=require('../xiaobai-control-flow.js');
const action=uid=>({id:'display-off',uid,params:{}});
const loop=(id,params={},children=[action('body')],uid=id)=>({id,uid,params,children});
const ir=()=>loop('loop-infrared',{comparison:'greater',threshold:50});
const tilt=()=>loop('loop-tilt',{direction:'forward'});
const time=()=>loop('loop-time',{duration:5});
const count=(n,children)=>loop('loop-count',{count:n},children);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
function device(initial=false){
  let latch=initial,fault=null;
  const calls=[];
  const handle={get matched(){return latch;},check(){if(fault)throw fault;},
    async refresh(){calls.push('refresh');return latch;},async close(options){calls.push(['close',options]);}};
  return {handle,calls,sample:value=>{latch=latch||value;},fail:error=>{fault=error;}};
}
const hooks=observer=>({check(){},async delay(){},async observe(){return observer.handle;}});

test('loop identities, strict parameters and empty bodies validate before execution',()=>{
  for(const id of ['loop','loop-count','loop-infrared','loop-tilt','loop-time'])assert.equal(Flow.isLoop({id}),true);
  assert.equal(Flow.isLoop(action('x')),false);
  for(const item of [ir(),tilt(),time()])assert.equal(Flow.isObserverLoop(item),true);
  assert.equal(Flow.isConditionalLoop(count(2)),false);
  assert.deepEqual(Flow.validateLoops([ir(),tilt(),time(),count(2)]),{maxDepth:1,maxObserverDepth:1,observerLoops:3});
  for(const bad of [loop('loop-count',{count:0}),loop('loop-time',{duration:-1}),loop('loop-time',{duration:Infinity}),
    loop('loop-time',{duration:86401}),loop('loop-infrared',{comparison:'equal',threshold:50}),
    loop('loop-infrared',{comparison:'greater',threshold:50.5}),loop('loop-infrared',{comparison:'less',threshold:101}),
    loop('loop-tilt',{direction:'still'}),loop('loop',{},[])])assert.throws(()=>Flow.validateLoops([bad]));
  assert.doesNotThrow(()=>Flow.validateLoops([loop('loop-time',{duration:0}),loop('loop-infrared',{comparison:'less',threshold:0})]));
});

test('observer budget counts simultaneous nesting including time; sequential observers do not accumulate',()=>{
  let nested=action('last');
  for(let n=4;n>=1;n--)nested=loop(['loop-time','loop-infrared','loop-tilt','loop-time'][n-1],
    n===2?{comparison:'less',threshold:20}:n===3?{direction:'left'}:{duration:5},[nested],'o'+n);
  assert.deepEqual(Flow.validateLoops([nested]),{maxDepth:4,maxObserverDepth:4,observerLoops:4});
  assert.equal(Flow.validateLoops([nested,nested]).maxObserverDepth,4);
  const fifth=loop('loop-time',{duration:1},[nested],'outer');
  assert.throws(()=>Flow.validateLoops([action('before'),fifth]),e=>e.code==='OBSERVER_LIMIT'&&e.blockUid==='o4'&&e.path.join('.')==='1.0.0.0.0');
  assert.equal(Flow.validateLoops(Array.from({length:30},ir)).maxObserverDepth,1);
});

test('control nesting stays bounded independently from observers; errors locate the offending UID/path',()=>{
  let nested=action('last');
  for(let n=20;n>=1;n--)nested=loop('loop-count',{count:1},[nested],'count'+n);
  assert.equal(Flow.validateLoops([nested]).maxDepth,20);
  assert.throws(()=>Flow.validateLoops([count(1,[nested])]),e=>e.code==='LOOP_DEPTH'&&e.blockUid==='count20'&&e.path.length===21);
  const cyclic=loop('loop');cyclic.children=[cyclic];assert.throws(()=>Flow.validateLoops([cyclic]),{code:'STRUCTURE'});
  assert.throws(()=>Flow.validateLoops([{...action('ordinary'),children:[ir()]}]),{code:'STRUCTURE'});
});

test('count and forever use the same whole-body framework and cancellable between-round yield',async()=>{
  const events=[],h={check(){},async delay(ms){events.push(['delay',ms]);}};
  assert.deepEqual(await Flow.runLoop(count(3),async n=>events.push(['round',n]),h),{rounds:3,matched:false});
  assert.deepEqual(events,[['round',0],['delay',10],['round',1],['delay',10],['round',2]]);
  const stop=Object.assign(Error('stop'),{code:'CANCELLED'});let n=0;
  await assert.rejects(Flow.runLoop(loop('loop'),async()=>{if(++n===3)throw stop;},h),e=>e===stop);
  assert.equal(n,3);
});

test('all conditional loops wait for authoritative entry and skip their body if already satisfied',async()=>{
  for(const item of [ir(),tilt(),time()]){
    const gate=deferred(),d=device(true),events=[];
    const run=Flow.runLoop(item,async()=>events.push('body'),{...hooks(d),observe:()=>gate.promise});
    await Promise.resolve();assert.deepEqual(events,[]);
    gate.resolve(d.handle);assert.deepEqual(await run,{rounds:0,matched:true});
    assert.deepEqual(d.calls,[['close',{cancelled:false}]]);
  }
});

test('a real transient device latch during the first block preserves every remaining block in that whole round',async()=>{
  const d=device(),events=[];
  const result=await Flow.runLoop(ir(),async()=>{
    events.push('block1-start');d.sample(true);d.sample(false);events.push('block1-real-done');
    await Promise.resolve();events.push('block2-real-done');events.push('block3-real-done');
  },hooks(d));
  assert.deepEqual(result,{rounds:1,matched:true});
  assert.deepEqual(events,['block1-start','block1-real-done','block2-real-done','block3-real-done']);
  assert.deepEqual(d.calls,[['close',{cancelled:false}]],'latched event needs no tail QUERY');
});

test('query only reconciles between rounds, without interrupting the current body',async()=>{
  const d=device(),events=[];let first=true;
  d.handle.refresh=async()=>{events.push('query');if(first){first=false;d.sample(true);}return d.handle.matched;};
  const result=await Flow.runLoop(tilt(),async()=>{events.push('motor-real-done');events.push('wait-real-done');},hooks(d));
  assert.deepEqual(result,{rounds:1,matched:true});assert.deepEqual(events,['motor-real-done','wait-real-done','query']);
});

test('time condition is device-owned: five seconds with three-second whole rounds exits at six seconds',async()=>{
  const d=device();let deviceElapsed=0,queries=0;
  d.handle.refresh=async()=>{queries++;return d.handle.matched;};
  const h=hooks(d);Object.defineProperty(h,'now',{get(){throw Error('phone time predicate is forbidden');}});
  const result=await Flow.runLoop(time(),async()=>{deviceElapsed+=3000;if(deviceElapsed>=5000)d.sample(true);},h);
  assert.equal(deviceElapsed,6000);assert.equal(result.rounds,2);assert.equal(queries,1);
});

test('an outer latch cannot break an inner observer loop or skip the outer round tail',async()=>{
  const outer=device(),inner=device(),events=[];let innerRounds=0;
  const h={check(){},async delay(){},async observe(item){events.push('open '+item.uid);return item.uid==='outer'?outer.handle:inner.handle;}};
  const outerLoop=loop('loop-infrared',{comparison:'greater',threshold:50},[time(),action('tail')],'outer');
  const innerLoop=loop('loop-time',{duration:5},[action('inner')],'inner');
  const result=await Flow.runLoop(outerLoop,async()=>{
    await Flow.runLoop(innerLoop,async()=>{events.push('inner-round');outer.sample(true);if(++innerRounds===2)inner.sample(true);},h);
    events.push('outer-tail-real-done');
  },h);
  assert.equal(result.rounds,1);assert.equal(innerRounds,2);
  assert.deepEqual(events,['open outer','open inner','inner-round','inner-round','outer-tail-real-done']);
  assert.deepEqual(inner.calls,[ 'refresh',['close',{cancelled:false}] ]);
  assert.deepEqual(outer.calls,[ ['close',{cancelled:false}] ]);
});

test('cancellation during a permanent body wait propagates immediately without waiting for observer CLOSE', {timeout:1000},async()=>{
  const d=device(),bodyWait=deferred(),closeWait=deferred(),entered=deferred();
  d.handle.close=options=>{d.calls.push(['close',options]);return closeWait.promise;};
  const stop=Object.assign(Error('manual STOP'),{code:'CANCELLED'});
  const run=Flow.runLoop(time(),async()=>{entered.resolve();await bodyWait.promise;},hooks(d));
  await entered.promise;bodyWait.reject(stop);
  await assert.rejects(run,e=>e===stop);assert.deepEqual(d.calls,[['close',{cancelled:true}]]);
  closeWait.reject(Error('radio unavailable'));
});

test('device fault and refresh failure abort, preserve original cause, and release the observer locally',async()=>{
  const fault=Object.assign(Error('sensor stale'),{code:'SENSOR'}),d=device();d.fail(fault);
  let body=0;await assert.rejects(Flow.runLoop(ir(),async()=>body++,hooks(d)),e=>e===fault);
  assert.equal(body,0);assert.deepEqual(d.calls,[['close',{cancelled:true}]]);
  const queryError=Error('observer task lost'),q=device();q.handle.refresh=async()=>{throw queryError;};
  await assert.rejects(Flow.runLoop(tilt(),async()=>{},hooks(q)),e=>e===queryError);
  assert.deepEqual(q.calls,[['close',{cancelled:true}]]);
});

test('normal CLOSE is confirmed before continuing and its failure is not mistaken for loop success',async()=>{
  const d=device(true),close=deferred();let finished=false;
  d.handle.close=options=>{d.calls.push(['close',options]);return close.promise;};
  const run=Flow.runLoop(time(),async()=>{},hooks(d)).then(()=>{finished=true;});
  await Promise.resolve();await Promise.resolve();assert.equal(finished,false);
  const error=Error('close not confirmed');close.reject(error);await assert.rejects(run,e=>e===error);
  assert.equal(finished,false);
});

test('a cleanup error cannot mask the real body failure or delay failure propagation',async()=>{
  const d=device(),bodyError=Error('motor fault'),cleanupError=Error('observer close failed');
  d.handle.close=()=>{throw cleanupError;};
  await assert.rejects(Flow.runLoop(ir(),async()=>{throw bodyError;},hooks(d)),e=>e===bodyError&&e.cleanupError===cleanupError);
});

test('missing or malformed observer state never falls back to a phone predicate',async()=>{
  let ran=false;
  await assert.rejects(Flow.runLoop(time(),async()=>{ran=true;},{check(){},async delay(){}}),{code:'OBSERVER_UNSUPPORTED'});
  const d=device();Object.defineProperty(d.handle,'matched',{get:()=>undefined});
  await assert.rejects(Flow.runLoop(ir(),async()=>{ran=true;},hooks(d)),{code:'OBSERVER_STATE'});
  assert.equal(ran,false);assert.deepEqual(d.calls,[['close',{cancelled:true}]]);
});

test('warnings name the whole-round boundary and locate inner infinite loops or indefinite waits',()=>{
  const item=loop('loop-time',{duration:5},[count(2,[loop('loop',{},[action('forever')],'never')]),
    {id:'motion-wait',uid:'wait-new-motion',params:{state:'lift-up'}}],'outer-time');
  const result=Flow.warnings([action('before'),item]);assert.equal(result.length,1);
  assert.equal(result[0].code,'ROUND_MAY_NOT_FINISH');assert.equal(result[0].blockUid,'outer-time');assert.deepEqual(result[0].path,[1]);
  assert.deepEqual(result[0].causes.map(c=>[c.id,c.path]),[['loop',[1,0,0]],['motion-wait',[1,1]]]);
  assert.match(result[0].message,/本轮全部积木/);assert.deepEqual(Flow.warnings([loop('loop-time',{duration:1},[count(3)])]),[]);
});
