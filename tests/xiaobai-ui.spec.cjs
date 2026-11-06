const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const runner=require('../xiaobai-runner.js'),{OP}=require('../xiaobai-protocol.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function target(){const listeners={};return {dispatchEvent(event){this.emit(event.type,event);},addEventListener(name,fn){(listeners[name]??=[]).push(fn);},emit(name,event){for(const fn of listeners[name]||[])fn(event);}};}
function classList(){const names=new Set();return {add:name=>names.add(name),remove:name=>names.delete(name),contains:name=>names.has(name),toggle(name,force){const on=force===undefined?!names.has(name):Boolean(force);if(on)names.add(name);else names.delete(name);return on;}};}
function feedback(f,running,stopActive=running){assert.equal(f.element('runProgramBtn').classList.contains('is-running'),running,'run motion follows execution');assert.equal(f.element('pauseProgramBtn').classList.contains('is-program-active'),stopActive,'stop emphasis follows execution/cleanup');}
function setup(){
  const elements=new Map();
  function element(id){if(!elements.has(id))elements.set(id,{classList:classList(),setAttribute(){},querySelector(){return this;}});return elements.get(id);}
  const blocks=['0','1'].map(path=>{
    const classes=new Set();return {dataset:{nodePath:path},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)}};
  });
  const document={...target(),hidden:false,getElementById:element,body:{classList:classList()},
    querySelectorAll:selector=>selector.includes('.is-executing')?blocks.filter(block=>block.classList.contains('is-executing')):blocks};
  const calls=[],notices=[];
  const connection={id:'test',async enterProgram(){calls.push('enter');},async action(op,args){calls.push([op,args]);},
    async stopProgram(){calls.push('stop');},cancelPending(){}};
  const window={...target(),showExecutionNotice:text=>notices.push(text),CardRemote:{close:async()=>{}},CardBluetooth:{connected:true,remoteConnection:()=>connection}};
  const context={Event:class{constructor(type){this.type=type;}},document,window,location:{hash:'#editor'},XiaobaiRunner:runner,
    program:[{id:'combo-continuous',params:{direction:'advance'}},{id:'wait-time',params:{duration:30}}],cardById:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../xiaobai-ui.js'),'utf8'),context);
  return {...context,calls,notices,element,blocks};
}
(async()=>{
  const f=setup();feedback(f,false);const task=f.element('runProgramBtn').onclick();await sleep(15);feedback(f,true);
  assert.equal(f.window.CardProgram.running,true);assert.equal(f.element('runProgramBtn').disabled,true);
  assert.deepEqual(f.calls.slice(0,2),['enter',[OP.MOVE_RUN,[1]]]);
  assert.equal(f.blocks[1].classList.contains('is-executing'),true);
  assert.equal(f.blocks[0].classList.contains('is-executing'),false);
  await f.element('pauseProgramBtn').onclick();await task;
  assert.equal(f.window.CardProgram.running,false);assert.equal(f.calls.at(-1),'stop');
  assert.equal(f.blocks.some(block=>block.classList.contains('is-executing')),false);feedback(f,false);
  const away=setup();const running=away.element('runProgramBtn').onclick();await sleep(15);away.location.hash='#home';away.window.emit('hashchange');await running;assert.equal(away.window.CardProgram.running,false);await sleep(0);feedback(away,false);
  const background=setup();const bg=background.element('runProgramBtn').onclick();await sleep(15);background.document.hidden=true;background.document.emit('visibilitychange');await bg;assert.equal(background.calls.at(-1),'stop');await sleep(0);feedback(background,false);
  const pending=setup();let close;pending.window.CardRemote.close=()=>new Promise(r=>close=r);
  const start=pending.element('runProgramBtn').onclick();await pending.window.CardProgram.stop();close();await start;assert.equal(pending.calls.length,0);
  const offline=setup();offline.window.CardBluetooth.remoteConnection=()=>null;await offline.element('runProgramBtn').onclick();assert.equal(offline.location.hash,'bluetooth');assert.equal(offline.calls.length,0);
  // A slow native stop must keep run/learn locked until ALL old cleanup writes finish.
  const stopping=setup(),releases=[];
  stopping.window.CardBluetooth.remoteConnection().stopProgram=()=>new Promise(resolve=>{
    stopping.calls.push('slow-stop');releases.push(resolve);
  });
  const oldRun=stopping.element('runProgramBtn').onclick();await sleep(10);
  const stopTask=stopping.element('pauseProgramBtn').onclick();await sleep(0);
  assert.equal(stopping.element('runProgramBtn').disabled,true);
  assert.equal(stopping.window.CardProgram.running,true,'stop in flight locks learned controls too');
  feedback(stopping,false,true);
  await stopping.element('runProgramBtn').onclick();
  assert.equal(stopping.calls.filter(call=>call==='enter').length,1,'no new run while the old stop is pending');
  for(let i=0;i<5&&stopping.window.CardProgram.running;i++){
    for(const release of releases.splice(0))release();
    await sleep(0);
  }
  await stopTask;await oldRun;
  assert.equal(stopping.window.CardProgram.running,false);
  assert.equal(stopping.element('runProgramBtn').disabled,false);feedback(stopping,false);
  // Natural completion and failures must clear visual state without another click.
  const completed=setup();completed.program.splice(0,completed.program.length,{id:'wait-time',params:{duration:.04}});
  const completion=completed.element('runProgramBtn').onclick();await sleep(10);feedback(completed,true);await completion;feedback(completed,false);
  const failed=setup();failed.window.CardBluetooth.remoteConnection().action=async()=>{throw new Error('write rejected');};
  await failed.element('runProgramBtn').onclick();feedback(failed,false);assert.ok(failed.notices.includes('write rejected'));
  const disconnected=setup();const disconnectRun=disconnected.element('runProgramBtn').onclick();await sleep(10);feedback(disconnected,true);
  disconnected.window.CardBluetooth.connected=false;disconnected.window.CardBluetooth.remoteConnection=()=>null;
  disconnected.window.emit('xiaobai-disconnected');await disconnectRun;await sleep(0);feedback(disconnected,false);
  // Reported devices must not animate upload/unknown as if hardware were running.
  const reported=setup();reported.window.CardModelSession={current:{id:'spark-ai',execution:{kind:'compiled',reportsLifecycle:true}},switching:false};
  for(const [phase,motion,emphasis] of [['idle',false,false],['uploading',false,false],['awaiting-start',false,false],['running',true,true],['stopping',false,true],['unknown',false,true],['completed',false,false],['stopped',false,false]]){
    reported.window.CardBluetooth.executionPhase=phase;
    reported.window.emit('device-execution-state',{detail:{modelId:'spark-ai',message:phase}});
    feedback(reported,motion,emphasis);
  }
  reported.window.CardBluetooth.executionPhase='running';reported.window.CardBluetooth.connected=false;reported.window.CardBluetooth.remoteConnection=()=>null;
  reported.window.CardProgram.refresh();feedback(reported,false);
  console.log('PASS phone controller: C2 run/stop, execution feedback through completion/failure/cleanup, reported lifecycle, navigation, background and offline handling.');
})().catch(error=>{console.error(error);process.exitCode=1;});
