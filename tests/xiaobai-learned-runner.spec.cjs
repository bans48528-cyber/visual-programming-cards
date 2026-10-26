const assert=require('node:assert/strict');
const {Runner,validate}=require('../xiaobai-runner.js');
const {OP}=require('../xiaobai-protocol.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const block=(slot=1)=>({id:'self-learned-wait',params:{slot}});
const off={id:'display-off'};
function fixture(){
  const calls=[];let hit;
  const learned={
    async prepareRun(program){calls.push('preflight');},
    async beginRun(){calls.push('begin');},
    async endRun(){calls.push('end');},
    wait(slot){calls.push(['wait',slot]);return new Promise(resolve=>hit=resolve);},
    stop(){calls.push('cancel');hit?.();}
  };
  const connection={learned,async enterProgram(){calls.push('enter');},
    async action(op){calls.push(op);},async stopProgram(){calls.push('stop');},
    cancelPending(){}};
  const runner=new Runner(connection);
  return {runner,learned,calls,hit:()=>hit()};
}
(async()=>{
  for(const slot of [0,11,1.5,'1',null])assert.throws(()=>validate([block(slot)]),/指令1/);
  const f=fixture();
  const run=f.runner.run([block(3),off,block(3),off]);
  await sleep(0);assert.deepEqual(f.calls,['enter','preflight','begin',['wait',3]]);
  f.hit();await sleep(0);
  assert.deepEqual(f.calls,['enter','preflight','begin',['wait',3],OP.SHOW_OFF,['wait',3]]);
  f.hit();await run;
  assert.deepEqual(f.calls.slice(-4),[OP.SHOW_OFF,'end','cancel','stop']);
  const cancel=fixture();const pending=cancel.runner.run([block(),off]);
  await sleep(0);await cancel.runner.stop();await pending;
  assert(!cancel.calls.includes(OP.SHOW_OFF),'cancel cannot advance');
  const invalid=fixture();
  invalid.learned.prepareRun=async()=>{throw Object.assign(new Error('指令2未学习'),{path:[1,0]});};
  await assert.rejects(invalid.runner.run([off,{id:'loop-count',params:{count:2},children:[block(2)]}]),
    error=>error.path.join('.')==='1.0');
  assert(!invalid.calls.includes(OP.SHOW_OFF),'all references checked before any action');
  const race=fixture();let resume;
  race.learned.beginRun=()=>new Promise(resolve=>resume=resolve);
  const raced=race.runner.run([off]);await sleep(0);race.runner.cancel();resume();await raced;
  assert(!race.calls.includes(OP.SHOW_OFF),'stop during declaration cannot begin actions');
  const offline=new Runner({enterProgram:async()=>{},stopProgram:async()=>{},cancelPending(){}});
  await assert.rejects(offline.run([block()]),/不支持/);
  console.log('PASS learned-command runner: full preflight, run declaration, consecutive waits, stop and start race.');
})().catch(error=>{console.error(error);process.exitCode=1;});
