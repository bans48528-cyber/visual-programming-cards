const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const M=require('../device-models.js'),protocol=require('../spark-protocol.js'),{Link}=require('../spark-ai-adapter.js');
const {remoteFrame}=require('../spark-ai-adapter.js');
const codegen=require('../program-codegen.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const bytes=new Uint8Array(300);bytes.set([15,112,121,111]);
function fixture(options={}){
 const writes=[];let receive;const control={writes,prepared:0,finished:0,state:'stop',ack:true,...options};
 const feed=p=>receive(p),state=v=>feed(new TextEncoder().encode(JSON.stringify({WillAiState:v})));
 const transport={properties:{notify:true,write:true},start:async fn=>receive=fn,close(){},disconnect(){},
  async prepareUpload(){control.prepared++;return{mtu:control.mtu||247};},async finishUpload(){control.finished++;},
  async write(b){
   writes.push(b);const cmd=b[4];
   if(cmd===0xd0&&control.state)state(control.state);
   if(cmd===0xb9&&control.stopReplies!==false){control.state='stop';state('stop');}
   if([0xda,0xaa,0xbc].includes(cmd)){
    if(cmd===0xbc){control.state='run';state('run');}
    if(control.ack)queueMicrotask(()=>feed(protocol.frame(0xfd,[1])));
   }
  }};
 const link=new Link(transport);const controller=new AbortController();
 return {link,control,feed,state,controller,options:{signal:controller.signal,isCurrent:()=>!controller.signal.aborted,onProgress:()=>{}}};
}
(async()=>{
 assert.deepEqual(Array.from(remoteFrame(['A','L']).slice(5,15)),[0,0,0,0,1,0,0,0,1,0]);
 // Every visible Spark card compiles with its own schema defaults.
 const registry=M.createRegistry(),context={CardModels:registry,CardProgramCodegen:codegen,window:{}};
 vm.runInNewContext(fs.readFileSync('spark-ai-model.js','utf8'),context);
 const model=registry.get('spark-ai'),cards=Object.values(model.catalog).flatMap(g=>g.cards);
 assert.equal(cards.length,23);assert.equal(model.execution.kind,'compiled');
 for(const card of cards){const node={id:card.id,params:Object.fromEntries(Object.entries(card.paramsSchema||{}).map(([k,p])=>[k,p.default]))};if(card.kind==='loop')node.children=[];assert.ok(codegen([node]));}
 assert.throws(()=>model.execution.validate([{id:'speech-play',params:{phrase:'P01'}}]));
 // Existing desktop-generated source stays byte-for-byte identical.
 const baseline=JSON.parse(fs.readFileSync('tests/fixtures/compiler-baseline/report.json'));
 for(const c of baseline.cases){const source=fs.readFileSync(`tests/fixtures/compiler-baseline/${c.name}.py`,'utf8');const program=JSON.parse(fs.readFileSync(`tests/fixtures/compiler-baseline/${c.name}.json`));assert.equal(codegen(program),source);}
 const a=fixture();await a.link.start();await a.link.uploadProgram(bytes,a.options);
 assert.deepEqual(a.control.writes.map(b=>b[4]),[0xd0,0xda,0xaa,0xaa,0xbc,0xd0]);assert.equal(a.link.executionPhase,'running');assert.equal(a.link.busy,true);
 await assert.rejects(a.link.uploadProgram(bytes,a.options),/正在运行/);
 await a.link.stopProgram();assert.equal(a.control.writes.filter(b=>b[4]===0xb9).length,5);assert.equal(a.link.executionPhase,'idle');
 const before=a.control.writes.length;await a.link.stopProgram();assert.equal(a.control.writes.length,before);
 const low=fixture({mtu:23});await low.link.start();await assert.rejects(low.link.uploadProgram(bytes,low.options),/MTU/);assert.equal(low.control.writes.length,1);assert.equal(low.control.finished,1);
 const cancelled=fixture({ack:false});await cancelled.link.start();const pending=cancelled.link.uploadProgram(bytes,cancelled.options);await sleep(20);cancelled.controller.abort();await assert.rejects(pending,/取消/);assert.equal(cancelled.link.requiresReconnect,true);cancelled.feed(protocol.frame(0xfd,[1]));assert.equal(cancelled.control.writes.filter(b=>b[4]===0xaa).length,0);
 const stale=fixture();await stale.link.start();stale.controller.abort();await assert.rejects(stale.link.uploadProgram(bytes,stale.options),/取消/);assert.equal(stale.control.prepared,0);
 const closed=fixture();await closed.link.start();closed.link.close();closed.state('run');assert.notEqual(closed.link.executionPhase,'running');
 const storage=new Map([['cardProjectsV1',JSON.stringify([{id:'old',name:'Spark 旧作品',state:{program:[{id:'wait-time',params:{duration:1}}]}}])],['cardActiveProjectV1','old']]);
 const store={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 M.migrateSpark(store);assert.equal(M.createStore(store,'spark-ai').read()[0].modelId,'spark-ai');assert.equal(M.createStore(store,'spark-ai').getActive(),'old');assert.equal(M.createStore(store,'xiaobai').read().length,0);M.migrateSpark(store);assert.equal(M.createStore(store,'spark-ai').read().length,1);assert.ok(storage.has('cardProjectsV1'));
 console.log('PASS Spark AI: 23 cards, 29 source baselines, chunk/ACK upload, reported run/stop, duplicate lock, low MTU, cancellation, stale replies and legacy project migration.');
})().catch(e=>{console.error(e);process.exitCode=1;});
