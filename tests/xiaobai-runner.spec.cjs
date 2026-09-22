const assert=require('node:assert/strict');
const {Runner,validate}=require('../xiaobai-runner.js');
const {OP}=require('../xiaobai-protocol.js');
const block=(id,params={},children)=>({id,params,...(children?{children}:{})});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(){
  const calls=[];let release;
  const connection={
    async enterProgram(){calls.push(['enter']);},
    async action(op,args,blocking){calls.push([op,args,blocking]);if(blocking&&op===OP.WAIT_IR)await new Promise(resolve=>release=resolve);},
    async stopProgram(){calls.push(['stop']);},
    cancelPending(){release?.();}
  };
  return {runner:new Runner(connection),calls,release:()=>release?.()};
}
(async()=>{
  for(const invalid of [[],[block('unknown')],[block('motor-forward',{port:'E',duration:1})],
    [block('infrared-wait',{comparison:'equal',threshold:50})],[block('speech-wait',{phrase:'ASR_99'})],
    [block('loop',{},[])]]) assert.throws(()=>validate(invalid));
  const f=fixture();await f.runner.run([
    block('motor-forward',{port:'L/M1',duration:1}),block('motor-reverse-continuous',{port:'R/M2'}),
    block('motor-stop',{port:'L/M1'}),block('motor-power',{power:2}),
    block('combo-turn-right',{duration:2}),block('combo-continuous',{direction:'retreat'}),
    block('wait-time',{duration:.1}),block('combo-stop'),block('combo-power',{power:1}),block('eye-expression',{expression:'EYE_10'}),
    block('display-number',{value:100}),block('display-off'),block('speech-play',{phrase:'P03'}),
    block('speech-wait',{phrase:'ASR_02'})
  ]);
  assert.deepEqual(f.calls,[['enter'],[OP.MOTOR_TIME,[0,1,232,3,0,0],true],[OP.MOTOR_RUN,[1,2],false],
    [OP.MOTOR_STOP,[0],false],[OP.MOTOR_POWER,[2],false],[OP.MOVE_TIME,[3,208,7,0,0],true],
    [OP.MOVE_RUN,[4],false],[OP.MOVE_STOP,[],false],[OP.MOVE_POWER,[1],false],
    [OP.SHOW_EYE,[10],false],[OP.SHOW_NUM,[100],false],[OP.SHOW_OFF,[],false],
    [OP.PLAY_VOICE,[3],false],[OP.WAIT_VOICE,[2],true],['stop']]);
  const wait=fixture();const task=wait.runner.run([block('infrared-wait',{comparison:'less',threshold:30}),block('display-off')]);
  await sleep(0);assert.deepEqual(wait.calls,[['enter'],[OP.WAIT_IR,[1,1,30],true]]);
  wait.release();await task;assert.deepEqual(wait.calls.at(-2),[OP.SHOW_OFF,[],false]);
  const immediate=fixture();await immediate.runner.run([
    block('motor-reverse-continuous',{port:'L/M1'}),block('motor-stop',{port:'L'})]);
  assert.deepEqual(immediate.calls,[['enter'],[OP.MOTOR_RUN,[0,2],false],[OP.MOTOR_STOP,[0],false],['stop']]);
  const different=fixture();await different.runner.run([
    block('motor-reverse-continuous',{port:'L/M1'}),block('motor-stop',{port:'R/M2'})]);
  assert.deepEqual(different.calls.slice(1,3),[[OP.MOTOR_RUN,[0,2],false],[OP.MOTOR_STOP,[1],false]]);
  const comboImmediate=fixture();await comboImmediate.runner.run([
    block('combo-continuous',{direction:'advance'}),block('combo-stop')]);
  assert.deepEqual(comboImmediate.calls,[['enter'],[OP.MOVE_RUN,[1],false],[OP.MOVE_STOP,[],false],['stop']]);
  const repeatedPower=fixture();await repeatedPower.runner.run([
    block('motor-forward-continuous',{port:'L'}),...Array.from({length:8},()=>block('motor-power',{power:3})),
    block('motor-stop',{port:'L'})]);
  assert.deepEqual(repeatedPower.calls.slice(1,-1).map(call=>call[0]),
    [OP.MOTOR_RUN,...Array(8).fill(OP.MOTOR_POWER),OP.MOTOR_STOP]);
  const withWait=fixture();await withWait.runner.run([
    block('motor-reverse-continuous',{port:'L'}),block('wait-time',{duration:.1}),block('motor-stop',{port:'L'})]);
  assert.deepEqual(withWait.calls.slice(1,3),[[OP.MOTOR_RUN,[0,2],false],[OP.MOTOR_STOP,[0],false]]);
  const cancel=fixture();const running=cancel.runner.run([block('loop',{},[block('wait-time',{duration:30})])]);
  await sleep(10);await cancel.runner.stop();await running;assert.equal(cancel.calls.filter(x=>x[0]==='stop').length>=1,true);
  console.log('PASS Xiaobai C2 block mapping, middle IR, blocking DONE, ordered continuous/power/stop commands, loop cancellation and stop.');
})().catch(error=>{console.error(error);process.exitCode=1;});
