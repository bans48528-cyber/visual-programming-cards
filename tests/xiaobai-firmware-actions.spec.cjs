// Execute the production learned service and runner without any radio or native device.
const assert=require('node:assert/strict');
const P=require('../xiaobai-protocol.js'),{Session}=require('../xiaobai-learned-commands.js'),{Runner}=require('../xiaobai-runner.js');
const entries=new Map(),writes=[];
const link={mode:P.MODE.PROGRAM,subscribed:true,heartbeatTimer:1,closed:false,
 firmwareGate:{snapshot:()=>({ready:false})},subscribe:()=>()=>{},onLifecycle:()=>()=>{},
 request(...args){writes.push(args);throw new Error('Unexpected learning write');},stopProgram:async()=>{}};
const service=new Session(link,{storage:{getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)}});
(async()=>{
 for(const operation of [()=>service.learn(1),()=>service.prepareRun([]),()=>service.beginRun()])await assert.rejects(operation,e=>e.code==='FIRMWARE_REQUIRED');
 assert.throws(()=>service.wait(1),e=>e.code==='FIRMWARE_REQUIRED');
 assert.throws(()=>service.request(P.OP.LEARN_COMMAND,[1,0,0,0,1,0],500),e=>e.code==='FIRMWARE_REQUIRED');
 assert.throws(()=>service.request(P.OP.DECLARE_RUN,[1,0,0,0,1],500),e=>e.code==='FIRMWARE_REQUIRED');
 assert.equal(writes.length,0,'blocked old service reference cannot write any learning/run command');
 let actions=0,stops=0;
 const connection={enterProgram:async()=>{},ensureFirmware:async()=>false,action:async()=>{actions++;},stopProgram:async()=>{stops++;}};
 const runner=new Runner(connection,{isCurrent:()=>true});
 await assert.rejects(()=>runner.run([{id:'motor-forward',params:{port:'L',duration:1}}]),/固件尚未就绪/);
 assert.equal(actions,0);assert.equal(stops,1,'safety stop remains allowed');service.dispose();
 console.log('PASS firmware action gates: stale learned service, direct run/learn/wait, direct Runner and safe stop; no hardware.');
})().catch(e=>{console.error(e);process.exitCode=1;});
