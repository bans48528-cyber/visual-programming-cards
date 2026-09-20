const assert=require('node:assert/strict');
const {Runner,validate,mapping}=require('../xiaobai-runner.js');
const {keys}=require('../remote-control.js');
const block=(id,params={},children)=>({id,params,...(children?{children}:{})});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(options={}) {
  const writes=[];
  const runner=new Runner({send:async(bytes,guard)=>{if(!guard())return false;writes.push({time:Date.now(),keys:keys.filter((_,i)=>bytes[5+i])});return true;}},options);
  return {runner,writes};
}
(async()=>{
  assert.equal(mapping.speedUp,'L');assert.equal(mapping.speedDown,'R');
  for(const invalid of [[],[block('matrix-display')],[block('motor-forward',{port:'E',duration:1})],[block('wait-time',{duration:-1})],[block('loop',{},[])],[block('combo-continuous',{direction:'__proto__'})]]) assert.throws(()=>validate(invalid));
  const f=fixture();
  await f.runner.run([block('combo-continuous',{direction:'advance'}),block('motor-reverse-continuous',{port:'L/M1'}),block('motor-stop',{port:'R/M2'}),block('wait-time',{duration:.1})]);
  assert.deepEqual(f.writes.map(w=>w.keys),[[],['B','X'],['B','X'],['B'],[]]);
  assert.ok(f.writes.at(-1).time-f.writes.at(-2).time>=85);
  const timed=fixture();await timed.runner.run([block('motor-forward-continuous',{port:'R/M2'}),block('motor-reverse',{port:'L/M1',duration:.1})]);
  assert.deepEqual(timed.writes.map(w=>w.keys),[[],['X'],['B','X'],['X'],[]]);
  const turns=fixture();await turns.runner.run([block('combo-turn-left',{duration:.1}),block('combo-turn-right',{duration:.1}),block('combo-backward',{duration:.1})]);
  assert.deepEqual(turns.writes.map(w=>w.keys),[[],['X'],[],['B'],[],['A','Y'],[],[]]);
  const speed=fixture({heartbeatMs:20});await speed.runner.run([block('combo-continuous',{direction:'advance'}),block('speed-up'),block('speed-down')]);
  assert.equal(speed.writes.filter(w=>w.keys.includes('L')).length,1);assert.equal(speed.writes.filter(w=>w.keys.includes('R')).length,1);
  assert.ok(speed.writes.filter(w=>w.keys.includes('L')||w.keys.includes('R')).every(w=>w.keys.includes('B')&&w.keys.includes('X')));
  for(const [direction,expected] of [['advance',['B','X']],['retreat',['A','Y']],['left',['X']],['right',['B']]]) {
    const combo=fixture({heartbeatMs:20});
    await combo.runner.run([block('combo-continuous',{direction}),block('wait-time',{duration:.1}),block('combo-stop')]);
    assert.deepEqual(combo.writes[1].keys,expected);
    assert.ok(combo.writes.filter(w=>w.keys.length).every(w=>JSON.stringify(w.keys)===JSON.stringify(expected)));
    assert.deepEqual(combo.writes.at(-1).keys,[]);
  }
  const forward=fixture();await forward.runner.run([block('combo-forward',{duration:.1}),block('motor-forward-continuous',{port:'L/M1'})]);
  assert.deepEqual(forward.writes.map(w=>w.keys),[[],['B','X'],[],['A'],[]]);
  const loops=fixture();await loops.runner.run([block('loop-count',{count:2},[block('loop-count',{count:2},[block('motor-forward-continuous',{port:'L/M1'})])])]);
  assert.equal(loops.writes.filter(w=>w.keys.includes('A')).length,4);
  const cancel=fixture({heartbeatMs:20});const running=cancel.runner.run([block('loop',{},[block('combo-continuous',{direction:'advance'}),block('wait-time',{duration:30})])]);
  await sleep(65);const t=Date.now();await cancel.runner.stop();await running;assert.ok(Date.now()-t<150);assert.deepEqual(cancel.writes.at(-1).keys,[]);
  const length=cancel.writes.length;await sleep(60);assert.equal(cancel.writes.length,length);
  let connected=true;const lost=fixture({heartbeatMs:20,isCurrent:()=>connected});const promise=lost.runner.run([block('wait-time',{duration:30})]);
  await sleep(30);connected=false;await assert.rejects(promise,/连接/);connected=true;const n=lost.writes.length;await sleep(50);assert.equal(lost.writes.length,n);
  let unlock,called=0;const queue=[];
  const blocked=new Runner({send:async(bytes,guard)=>{if(++called===2)await new Promise(resolve=>unlock=resolve);if(!guard())return false;queue.push(keys.filter((_,i)=>bytes[5+i]));return true;}},{heartbeatMs:1000});
  const blockedRun=blocked.run([block('combo-continuous',{direction:'advance'}),block('combo-continuous',{direction:'retreat'})]);
  await sleep(10);const stopped=blocked.stop();unlock();await stopped;await blockedRun;assert.deepEqual(queue,[[],[]]);
  let calls=0;const broken=new Runner({send:async()=>{if(++calls===2)throw new Error('write failed');return true;}});
  await assert.rejects(broken.run([block('combo-continuous',{direction:'advance'})]),/write failed/);assert.equal(calls,3);
  console.log('PASS Xiaobai: validation, motor composition, timed release, turns, shoulder pulses, nested loops, cancel, heartbeat, disconnect, queued-write cancellation, failure release.');
})().catch(error=>{console.error(error);process.exitCode=1;});
