// Production Gate + Session recovery after a written-image UID failure. No hardware.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const P=require('../xiaobai-ota-protocol.js'),Ota=require('../xiaobai-ota.js'),{Gate}=require('../xiaobai-firmware.js');
const root=path.resolve(__dirname,'..'),release=JSON.parse(fs.readFileSync(path.join(root,'assets/firmware/release.json'),'utf8'));
const uid='00112233445566778899aabb',deviceId='EC:B0:DC:10:B4:43';
const storage=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))};};
function fixture(pkg){
 let connected=true,gate,connections=0,seq=20;
 const state={epoch:'upgrade-before-1',deviceId},log=[];
 const actual={uid,deviceId,epoch:state.epoch,productMode:4,info:{protocol:1,boardId:pkg.boardId,bootVersion:pkg.minBootVersion,version:pkg.version-1,mode:0,imageValid:true,state:0,lastError:0,imageSize:pkg.imageSize,nextOffset:0,imageSha256:'a'.repeat(64),supported:true}};
 const adapter={identity:()=>connected?{...state}:null,
  async prepare(){log.push('prepare');},async release(){log.push('release');},
  async readApp(){log.push('readApp');return{...actual,epoch:state.epoch,info:{...actual.info}};},
  async queryStatus(){const at=performance.now();log.push('status');return{epoch:state.epoch,seq:++seq,opcode:4,result:0,sentAt:at,receivedAt:at,data:[4,20,20,20,0x74,0x0e,0]};},
  async disconnect(){log.push('disconnect');connected=false;gate.disconnected(state.epoch,{owned:true});},
  async connectApp(binding){assert.equal(binding.uid,uid);assert.equal(binding.deviceId,deviceId);log.push('connectApp');connected=true;state.epoch='recovery-new-'+(++connections);gate.attachEpoch(state.epoch,{owned:true});},
  async connectBoot(){log.push('connectBoot');throw new Error('No Boot transfer expected for an already written target image');},
  async enterBoot(){log.push('enterBoot');throw new Error('No new write expected');},
  async enterProgramRaw(){log.push('program');},async initializeLearned(){log.push('learned');}
 };
 gate=new Gate(adapter,{storage:storage(),loadBundle:async()=>({pkg,release}),timing:{healthGapMs:510,healthDeadlineMs:5000,restartMs:1}});
 return{gate,adapter,state,actual,log,loseConnection(){connected=false;}};
}
(async()=>{
 const pkg=await P.verifyPackage(fs.readFileSync(path.join(root,release.firmware.asset)),{name:path.basename(release.firmware.asset)});
 const f=fixture(pkg);await f.gate.onProgramEntered(f.state.epoch);
 assert.equal(f.gate.snapshot().canUpgrade,true);assert.equal(f.gate.state.actual.epoch,'upgrade-before-1');
 // Reproduce the real failed-confirmation state: old pre-upgrade actual retained,
 // image committed, original UID binding retained, and no live App connection.
 f.gate.session.saveBinding({uid,deviceId,pending:Ota.targetOf(pkg),written:true});
 f.gate.session.state.written=true;f.gate.session.state.phase='unconfirmed';f.loseConnection();
 f.gate.set({phase:'recovery',ready:false,busy:false,prompt:true,canUpgrade:true,code:'IDENTITY',message:'previous confirmation had wrong UID'});
 Object.assign(f.actual.info,{version:pkg.version,imageSize:pkg.imageSize,imageSha256:pkg.imageSha256,imageValid:true});
 const result=await f.gate.confirmUpgrade();
 assert.equal(result.alreadyPresent,true);assert.equal(result.applicationStartVerified,true);
 assert.equal(f.gate.snapshot().ready,true);assert.equal(f.gate.snapshot().phase,'success');
 assert.equal(f.gate.session.binding.pending,null);
 assert.equal(f.log.filter(v=>v==='status').length,2,'two actual production status queries');
 assert.equal(f.log.includes('connectBoot'),false,'written image recovery performs no raw Boot transaction');
 assert.equal(f.log.includes('enterBoot'),false,'written image recovery cannot re-enter a write');
 assert.ok(f.log.includes('program')&&f.log.includes('learned'),'program and learned state restored');
 assert.equal(f.gate.consent.epoch,null,'recovery pins original UID/device, never the expired pre-upgrade epoch');
 await f.gate.dispose();
 // An old visible update prompt that simply lost transport is not recovery consent.
 const old=fixture(pkg);await old.gate.onProgramEntered(old.state.epoch);
 old.gate.session.saveBinding({uid,deviceId,pending:Ota.targetOf(pkg),written:false});old.loseConnection();
 assert.equal(old.gate.snapshot().phase,'update-required');
 await assert.rejects(()=>old.gate.confirmUpgrade(),e=>e.code==='STALE');
 assert.equal(old.log.includes('prepare'),false);assert.equal(old.log.includes('connectBoot'),false);assert.equal(old.log.includes('enterBoot'),false);
 await old.gate.dispose();
 console.log('PASS production firmware recovery: expired actual epoch ignored, already-written target verified without new Boot/BEGIN, old disconnected prompt cannot become recovery consent.');
})().catch(e=>{console.error(e);process.exitCode=1;});
