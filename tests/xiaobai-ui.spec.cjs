const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const runner=require('../xiaobai-runner.js'),remote=require('../remote-control.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function target(){const listeners={};return {addEventListener(name,fn){(listeners[name]??=[]).push(fn);},emit(name){for(const fn of listeners[name]||[])fn();}};}
function setup(){
  const elements=new Map();
  function element(id){if(!elements.has(id))elements.set(id,{classList:{add(){},toggle(){}},setAttribute(){},querySelector(){return this;}});return elements.get(id);}
  const document={...target(),hidden:false,getElementById:element,body:{classList:{toggle(){}}}};
  const writes=[],notices=[];
  const connection={id:'test',send:async(bytes,guard=()=>true)=>{if(!guard())return false;writes.push(Array.from(bytes));return true;}};
  const window={...target(),showExecutionNotice:text=>notices.push(text),CardRemote:{close:async()=>{}},CardBluetooth:{remoteConnection:()=>connection}};
  const context={document,window,location:{hash:'#editor'},XiaobaiRunner:runner,CardRemoteControl:remote,program:[{id:'combo-continuous',params:{direction:'advance'}},{id:'wait-time',params:{duration:30}}],cardById:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../xiaobai-ui.js'),'utf8'),context);
  return {...context,writes,notices,element};
}
(async()=>{
  const f=setup();const task=f.element('runProgramBtn').onclick();await sleep(15);
  assert.equal(f.window.CardProgram.running,true);assert.equal(f.element('runProgramBtn').disabled,true);
  await f.element('stopProgramBtn')?.onclick?.();
  await f.element('pauseProgramBtn').onclick();await task;
  assert.equal(f.window.CardProgram.running,false);assert.ok(f.writes.length>=3);assert.ok(f.writes.every(w=>w[4]===0xc1));assert.ok(f.writes.at(-1).slice(5,15).every(x=>x===0));
  const away=setup();const running=away.element('runProgramBtn').onclick();await sleep(15);away.location.hash='#home';away.window.emit('hashchange');await running;assert.equal(away.window.CardProgram.running,false);
  const background=setup();const bg=background.element('runProgramBtn').onclick();await sleep(15);background.document.hidden=true;background.document.emit('visibilitychange');await bg;assert.ok(background.writes.at(-1).slice(5,15).every(x=>x===0));
  const pending=setup();let close;pending.window.CardRemote.close=()=>new Promise(r=>close=r);
  const start=pending.element('runProgramBtn').onclick();await pending.window.CardProgram.stop();close();await start;assert.equal(pending.writes.length,0);
  const offline=setup();offline.window.CardBluetooth.remoteConnection=()=>null;await offline.element('runProgramBtn').onclick();assert.equal(offline.location.hash,'bluetooth');assert.equal(offline.writes.length,0);
  console.log('PASS phone controller: run/stop, C1-only writes, navigation, background, cancel during handoff, offline redirect.');
})().catch(error=>{console.error(error);process.exitCode=1;});
