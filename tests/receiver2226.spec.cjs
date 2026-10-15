const assert=require('node:assert/strict'),P=require('../receiver2226-protocol.js'),R=require('../receiver2226-runner.js');
const b=(id,params={},children)=>({id,params,...(children?{children}:{})});
const fixture=()=>{const frames=[];let current=true;const runner=new R.Runner({send:async(bytes,guard=()=>true)=>{if(guard())frames.push([...bytes]);}},{isCurrent:()=>current});return{runner,frames,expire:()=>current=false};};
(async()=>{
for(let speed=1;speed<=5;speed++)for(let combo=0;combo<=4;combo++)for(let motor=0;motor<=2;motor++)assert.deepEqual([...P.encode(speed,combo,motor)],[170,187,speed,combo,motor]);
assert.throws(()=>P.encode(0,1,1));assert.throws(()=>P.connectionOptions(),/待确认/);
const f=fixture();await f.runner.run([b('motor-forward-continuous',{port:'M3'}),b('combo-continuous',{direction:'advance'}),b('combo-power',{power:5}),b('combo-stop'),b('combo-continuous',{direction:'left'}),b('motor-stop',{port:'M3'})]);
assert.deepEqual(f.frames.map(x=>x.slice(2)),[[3,0,0],[3,0,1],[3,1,1],[5,1,1],[5,0,1],[5,3,1],[5,3,0],[5,0,0]]);
const timed=fixture();await timed.runner.run([b('motor-reverse-continuous',{port:'M3'}),b('combo-backward',{duration:.1}),b('combo-continuous',{direction:'right'}),b('motor-forward',{port:'M3',duration:.1})]);
assert.deepEqual(timed.frames.map(x=>x.slice(2)),[[3,0,0],[3,0,2],[3,2,2],[3,0,2],[3,4,2],[3,4,1],[3,4,0],[3,0,0]]);
const cancel=fixture();const pending=cancel.runner.run([b('loop',{},[b('combo-forward',{duration:10})])]);await new Promise(r=>setTimeout(r,20));await cancel.runner.stop();await pending;assert.deepEqual(cancel.frames.at(-1).slice(2),[3,0,0]);
const stale=fixture();stale.expire();await assert.rejects(stale.runner.run([b('combo-stop')]),/连接/);assert.equal(stale.frames.length,0);
for(const program of [[b('motor-stop',{port:'L/M1'})],[b('combo-power',{power:6})],[b('combo-continuous',{direction:'bad'})]])assert.throws(()=>R.validate(program));
console.log('PASS 2226: all 75 state encodings, independent state preservation, shared gear, timed movement, cancel/all-stop, stale connection and configuration gate.');
})().catch(e=>{console.error(e);process.exitCode=1;});
