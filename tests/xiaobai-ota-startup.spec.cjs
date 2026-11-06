'use strict';
const assert=require('node:assert/strict');
const {validateStatus,confirmIdentity,Session}=require('../xiaobai-ota.js');
const fixture=require('./fixtures/py32-ota-startup-vectors.json');
const clone=value=>JSON.parse(JSON.stringify(value));
let checks=0;
function rejects(fn,label){assert.throws(fn,undefined,label);checks++;}
function statusContext(overrides={}){const c={...fixture.context,...overrides};return{epoch:c.session_id,startedAt:c.started_ms,endedAt:c.now_ms};}
function mapSample(s){return{epoch:s.session_id,seq:s.seq,opcode:s.opcode,result:s.result,sentAt:s.monotonic_ms,receivedAt:s.monotonic_ms,data:Uint8Array.from(s.data)};}
const canonical=()=>fixture.cases[0].samples.map(mapSample);
function golden(){
 assert.equal(fixture.cases.length,17);checks++;
 for(const vector of fixture.cases){
  const samples=vector.samples.map(mapSample),context=statusContext(vector.context);
  if(vector.expected.ok){assert.equal(validateStatus(samples,context),true,vector.name);checks++;}
  else rejects(()=>validateStatus(samples,context),vector.name);
 }
}
function extraStatus(){
 const context=statusContext();
 for(const mutate of [
  s=>{s[0].sentAt=899;},
  s=>{s[0].receivedAt=s[0].sentAt-1;},
  s=>{s[1].receivedAt=1601;},
  s=>{s[1].epoch='old-epoch';},
  s=>{s[1].seq=0;},
  s=>{s[1].seq=256;},
  s=>{s[1].seq=1.5;},
  s=>{s[1].seq=s[0].seq;},
  s=>{s[1].opcode=3;},
  s=>{s[1].result=1;},
  s=>{s[1].data=new Uint8Array(6);},
  s=>{s[1].data=[0,25,25,25,60,15,-1];},
  s=>{s[1].data=[0,25,25,25,60,15,256];},
  s=>{s[1].data=[0,25,25,25,60,15,0.1];}
 ]){const samples=canonical();mutate(samples);rejects(()=>validateStatus(samples,context),'invalid status evidence');}
 for(const c of [{epoch:''},{startedAt:NaN},{endedAt:Infinity},{startedAt:1601}])rejects(()=>validateStatus(canonical(),{...context,...c}),'bad context');
 rejects(()=>validateStatus([],context),'no samples');
 // Exact 30-second deadline and exact500ms span remain valid; a later deadline does not.
 const exact=canonical();exact[0].sentAt=exact[0].receivedAt=30400;exact[1].sentAt=exact[1].receivedAt=30900;
 assert.equal(validateStatus(exact,{...context,endedAt:30900}),true);checks++;
 rejects(()=>validateStatus(exact,{...context,endedAt:30900.001}),'deadline exceeded');
 const three=canonical();three.push({...three[1],seq:23,sentAt:1600,receivedAt:1600});
 assert.equal(validateStatus(three,context),true);checks++;
 // A fresh matching notification must not be relabelled from cached old data.
 const stale=canonical();stale[0].sentAt=800;rejects(()=>validateStatus(stale,context),'old request with fresh receive time');
}
const pkg={boardId:0x102,version:0x10001,imageSize:32220,imageSha256:'a'.repeat(64)};
const binding={uid:'0102030405060708090a0b0c',deviceId:'AA:BB:CC:DD:EE:01',name:'小白'};
const actual=()=>({uid:binding.uid,deviceId:binding.deviceId,epoch:'connection-2',info:{protocol:1,mode:0,imageValid:true,...pkg}});
function identity(){
 confirmIdentity(actual(),binding,pkg);checks++;
 for(const change of [
  a=>{a.uid='0102030405060708090a0b0d';},a=>{a.deviceId='AA:BB:CC:DD:EE:02';},
  a=>{a.info.version++;},a=>{a.info.imageSize++;},a=>{a.info.imageSha256='b'.repeat(64);},
  a=>{a.info.boardId++;},a=>{a.info.mode=1;},a=>{a.info.imageValid=false;}
 ]){const a=actual();change(a);rejects(()=>confirmIdentity(a,binding,pkg),'wrong running device/image');}
 // INFO protocol is independently verified; matching version/hash cannot override a different protocol.
 const protocol=actual();protocol.info.protocol=2;rejects(()=>confirmIdentity(protocol,binding,pkg),'wrong INFO protocol');
}
async function freshSession(){
 let clock=1000,epoch='connection-old';const log=[],storageValues=new Map();
 const storage={getItem:key=>storageValues.get(key)||null,setItem:(key,value)=>storageValues.set(key,value)};
 const adapter={
  async connectApp(b){log.push(['connect',b.deviceId]);epoch='connection-new';},
  async readApp(){log.push(['identity',epoch]);return{...actual(),epoch};},
  async queryStatus(){log.push(['status',epoch]);const receivedAt=clock;clock+=600;return{epoch,seq:log.filter(e=>e[0]==='status').length+20,opcode:4,result:0,sentAt:receivedAt,receivedAt,data:[0,30,30,30,60,15,0]};},
  async disconnect(){log.push(['disconnect']);},async release(){}
 };
 const session=new Session(adapter,{storage,timing:{healthGapMs:0},clock:()=>clock});session.saveBinding({...binding,pending:pkg});
 assert.equal(await session.confirm(session.generation,binding,pkg),true);checks++;
 assert.equal(session.state.phase,'success');checks++;
 assert.equal(log[0][0],'connect','confirmation first creates a fresh connection');checks++;
 assert.equal(log[1][0],'identity');checks++;
 assert.equal(log[1][1],'connection-new');checks++;
 assert.equal(log.filter(e=>e[0]==='status').length,2);checks++;
 assert.equal(session.binding.pending,null,'clear pending only after identity and real healthy samples');checks++;
 // Reject status evidence from the previous native session instead of relabelling it.
 clock=1000;log.length=0;const staleAdapter={...adapter,async queryStatus(){clock+=700;return{epoch:'connection-old',seq:clock%255+1,opcode:4,result:0,sentAt:clock-1,receivedAt:clock,data:[0,30,30,30,60,15,0]};}};
 const badSession=new Session(staleAdapter,{storage,timing:{healthGapMs:0,healthDeadlineMs:5},clock:()=>clock});badSession.saveBinding({...binding,pending:pkg});
 await assert.rejects(()=>badSession.confirm(badSession.generation,binding,pkg));checks++;
 assert.notEqual(badSession.state.phase,'success');checks++;
 assert.ok(badSession.binding.pending,'unconfirmed state retains retry identity');checks++;
}
(async()=>{golden();extraStatus();identity();await freshSession();console.log(`OTA startup: ${fixture.cases.length} shared golden cases, ${checks} total checks passed (software only; no motor/audio/SC7 acceptance).`);})().catch(error=>{console.error(error);process.exitCode=1;});
