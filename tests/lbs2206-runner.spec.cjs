const assert=require('node:assert/strict'),{Runner,validate}=require('../lbs2206-runner.js');
const block=(id,params={},children)=>({id,params,children});
(async()=>{
 const calls=[],c={remote:async(d,s,g=()=>true)=>{if(g())calls.push([d,s,Date.now()]);}};
 await new Runner(c).run([block('combo-power',{power:5}),block('combo-forward',{duration:.1}),block('combo-continuous',{direction:'left'}),block('combo-power',{power:2}),block('wait-time',{duration:.1}),block('combo-stop')]);
 assert.deepEqual(calls.map(x=>x.slice(0,2)),[['forward',5],['stop',5],['left',5],['left',2],['stop',2],['stop',2]]);assert.ok(calls[1][2]-calls[0][2]>=90);
 calls.length=0;await new Runner(c).run([block('loop-count',{count:2},[block('combo-backward',{duration:.1})])]);assert.equal(calls.filter(x=>x[0]==='backward').length,2);
 calls.length=0;const r=new Runner(c);const done=r.run([block('combo-forward',{duration:30}),block('combo-backward',{duration:1})]);await new Promise(x=>setTimeout(x,10));await r.stop();await done;assert.deepEqual(calls.map(x=>x[0]),['forward','stop']);
 calls.length=0;let current=true;const stale=new Runner(c,{isCurrent:()=>current});const task=stale.run([block('wait-time',{duration:.1}),block('combo-forward',{duration:1})]);current=false;await assert.rejects(task,/连接已变化/);assert.equal(calls.length,0);
 for(const p of [[block('lbs-forward',{steps:1})],[block('combo-power',{power:6})],[block('combo-forward',{duration:0})],[block('loop')]])assert.throws(()=>validate(p));
 console.log('PASS LBS remote runner: timed/continuous motion, five-speed changes, finite loops, stop, cancellation and old-step rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});
