// Production Gate and Session with real signed current/historical packages.
// Only the normal App adapter boundary is synthetic; no native BLE or hardware.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const P=require('../xiaobai-ota-protocol.js'),Ota=require('../xiaobai-ota.js'),{Gate}=require('../xiaobai-firmware.js');
const repo=path.resolve(__dirname,'..'),release=require('../assets/firmware/release.json');
const uid='00112233445566778899aabb',deviceId='EC:B0:DC:30:78:0E',key='xiaobai:ota:binding:v1';
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
async function run(pkg,old,bootVersion){
 const historical={deviceId,uid,name:'Spark_AI',pending:Ota.targetOf(old),written:true};
 const before=JSON.stringify(historical),data=new Map([[key,before]]),log=[],writes=[],connectBindings=[];
 let gate,connected=false;const state={epoch:null,deviceId};
 const adapter={
  identity:()=>connected?{...state}:null,
  async prepare(){log.push('prepare');},async release(){log.push('release');},
  async connectApp(binding){log.push('connectApp');connectBindings.push(JSON.parse(JSON.stringify(binding)));connected=true;state.epoch='fresh-probe-app';gate.attachEpoch(state.epoch,{owned:true});},
  async readApp(){log.push('readApp');return{uid,deviceId,epoch:state.epoch,productMode:4,info:{protocol:1,boardId:old.boardId,bootVersion,version:old.version,mode:0,imageValid:true,state:0,lastError:0,imageSize:old.imageSize,nextOffset:0,imageSha256:old.imageSha256}};},
  async disconnect(){log.push('disconnect');connected=false;},
  async queryStatus(){log.push('queryStatus');throw new Error('Unexpected health/write preflight');},
  async enterProgramRaw(){log.push('program');throw new Error('Unexpected restore');},
  async initializeLearned(){log.push('learned');throw new Error('Unexpected initialization');},
  async enterBoot(){log.push('enterBoot');throw new Error('Unexpected ENTER_BOOT');},
  async connectBoot(){log.push('connectBoot');throw new Error('Unexpected raw connection');},
  async raw(){log.push('raw');throw new Error('Unexpected raw channel');}
 };
 gate=new Gate(adapter,{storage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>{writes.push([k,v]);data.set(k,v);}},loadBundle:async()=>({pkg,release})});
 await gate.onProgramRequested({interactive:true});
 eq(gate.snapshot().phase,'recovery');eq(gate.snapshot().canUpgrade,true);
 const code=bootVersion===undefined?'BOOT_UNKNOWN':'BOOT_VERSION';
 await assert.rejects(()=>gate.confirmUpgrade(),e=>e.code===code);checks++;
 eq(data.get(key),before,'offline historical pending and written evidence must remain byte-for-byte unchanged');
 eq(gate.session.binding,historical,'in-memory historical record must not be normalized before fresh compatibility');
 eq(writes,[],'no persistence before fresh UID/Boot/version/power acceptance');
 eq(connectBindings,[historical],'probe must receive the original record');
 eq(log,['prepare','connectApp','readApp','release'],'Boot refusal keeps the newly readable normal App connected');
 eq(connected,true);eq(gate.live(),state);eq(gate.snapshot().ready,false);eq(gate.snapshot().canUpgrade,false);eq(gate.snapshot().code,code);
 if(code==='BOOT_VERSION'){eq(gate.snapshot().phase,'boot-update-required');assert.match(gate.snapshot().message,/DAP/);checks++;}
 else eq(gate.snapshot().phase,'unknown');
 await assert.rejects(()=>gate.confirmUpgrade(),e=>e.code===code);checks++;
 eq(log,['prepare','connectApp','readApp','release'],'repeated direct confirmation cannot bypass Boot refusal');
}
(async()=>{
 const pkg=await P.verifyPackage(fs.readFileSync(path.join(repo,release.firmware.asset)),{name:path.basename(release.firmware.asset)});
 const old=await P.verifyPackage(fs.readFileSync(path.join(repo,'tests/fixtures/firmware/xiaobai_py32_1.0.3.ota')),{name:'xiaobai_py32_1.0.3.ota'});
 assert.equal(pkg.version,65540);assert.equal(pkg.minBootVersion,65537);assert.equal(old.version,65539);
 for(const boot of [65536,undefined]){await run(pkg,old,boot);console.log('PASS offline historical pending Boot rejection '+String(boot));}
 console.log(`${checks} production Gate/Session offline historical pending checks passed; signed1.0.3 -> signed1.0.4, no hardware.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
