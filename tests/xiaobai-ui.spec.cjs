const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const runner=require('../xiaobai-runner.js'),{OP}=require('../xiaobai-protocol.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function target(){const listeners={};return {dispatchEvent(event){this.emit(event.type);},addEventListener(name,fn){(listeners[name]??=[]).push(fn);},emit(name){for(const fn of listeners[name]||[])fn();}};}
function setup(){
  const elements=new Map();
  function element(id){if(!elements.has(id))elements.set(id,{classList:{add(){},toggle(){}},setAttribute(){},querySelector(){return this;}});return elements.get(id);}
  const blocks=['0','1'].map(path=>{
    const classes=new Set();return {dataset:{nodePath:path},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)}};
  });
  const document={...target(),hidden:false,getElementById:element,body:{classList:{toggle(){}}},
    querySelectorAll:selector=>selector.includes('.is-executing')?blocks.filter(block=>block.classList.contains('is-executing')):blocks};
  const calls=[],notices=[];
  const connection={id:'test',async enterProgram(){calls.push('enter');},async action(op,args){calls.push([op,args]);},
    async stopProgram(){calls.push('stop');},cancelPending(){}};
  const window={...target(),showExecutionNotice:text=>notices.push(text),CardRemote:{close:async()=>{}},CardBluetooth:{remoteConnection:()=>connection}};
  const context={Event:class{constructor(type){this.type=type;}},document,window,location:{hash:'#editor'},XiaobaiRunner:runner,
    program:[{id:'combo-continuous',params:{direction:'advance'}},{id:'wait-time',params:{duration:30}}],cardById:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../xiaobai-ui.js'),'utf8'),context);
  return {...context,calls,notices,element,blocks};
}
(async()=>{
  const f=setup();const task=f.element('runProgramBtn').onclick();await sleep(15);
  assert.equal(f.window.CardProgram.running,true);assert.equal(f.element('runProgramBtn').disabled,true);
  assert.deepEqual(f.calls.slice(0,2),['enter',[OP.MOVE_RUN,[1]]]);
  assert.equal(f.blocks[1].classList.contains('is-executing'),true);
  assert.equal(f.blocks[0].classList.contains('is-executing'),false);
  await f.element('pauseProgramBtn').onclick();await task;
  assert.equal(f.window.CardProgram.running,false);assert.equal(f.calls.at(-1),'stop');
  assert.equal(f.blocks.some(block=>block.classList.contains('is-executing')),false);
  const away=setup();const running=away.element('runProgramBtn').onclick();await sleep(15);away.location.hash='#home';away.window.emit('hashchange');await running;assert.equal(away.window.CardProgram.running,false);
  const background=setup();const bg=background.element('runProgramBtn').onclick();await sleep(15);background.document.hidden=true;background.document.emit('visibilitychange');await bg;assert.equal(background.calls.at(-1),'stop');
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
  await stopping.element('runProgramBtn').onclick();
  assert.equal(stopping.calls.filter(call=>call==='enter').length,1,'no new run while the old stop is pending');
  for(let i=0;i<5&&stopping.window.CardProgram.running;i++){
    for(const release of releases.splice(0))release();
    await sleep(0);
  }
  await stopTask;await oldRun;
  assert.equal(stopping.window.CardProgram.running,false);
  assert.equal(stopping.element('runProgramBtn').disabled,false);
  console.log('PASS phone controller: C2 run/stop, navigation, background and offline handling.');
})().catch(error=>{console.error(error);process.exitCode=1;});
