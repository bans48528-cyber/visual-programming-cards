// Gate orchestration only. The real Session/C/native transfer has independent suites.
const assert=require('node:assert/strict');
const {Gate,parseVersionEvent}=require('../xiaobai-firmware.js');
const {Receiver}=require('../xiaobai-protocol.js');
const target={signatureVerified:true,name:'xiaobai_py32_1.0.2.ota',version:0x10002,boardId:0x102,minBoot:65536,minBootVersion:65536,imageSize:320,imageSha256:'b'.repeat(64),bytes:Uint8Array.of(1,2,3)};
const uid='00112233445566778899aabb',deviceId='AA:BB:CC:11:22:33';
const tick=()=>new Promise(r=>setTimeout(r,0));
const storage=()=>{const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
function fixture({version=target.version,imageValid=true,hash=target.imageSha256,stored=null,loadError=null}={}){
 const context={epoch:'epoch-1',deviceId,uid,connected:true,reads:0,load:0,prepare:0,enter:0,restore:0,learned:0,starts:0,readWait:null,prepareWait:null,upgradeWait:null};
 context.info={version,imageValid,imageSha256:hash,imageSize:320,protocol:1,boardId:258,bootVersion:65536,mode:0};
 const store=stored||storage();let gate;
 const adapter={
  identity:()=>context.connected?{epoch:context.epoch,deviceId:context.deviceId}:null,
  async readApp({guard=()=>true}={}){context.reads++;if(context.readWait)await context.readWait;if(!guard())throw Object.assign(new Error('stale read'),{code:'STALE'});return{info:{...context.info},uid:context.uid,deviceId:context.deviceId,epoch:context.epoch,productMode:4};},
  async prepare(){context.prepare++;if(context.onPrepare)await context.onPrepare();},
  async queryStatus(){return{data:[4,30,30,30,0x74,0x0e,0],epoch:context.epoch};},
  async enterBoot(){context.enter++;},
  async disconnect(){const old=context.epoch;context.connected=false;gate.disconnected(old,{owned:true});},
  async connectApp(binding){assert.equal(binding.deviceId,deviceId);assert.equal(binding.uid,uid);context.connected=true;context.epoch='post-'+context.starts;gate.attachEpoch(context.epoch,{owned:true});},
  async connectBoot(binding){assert.equal(binding.deviceId,deviceId);assert.equal(binding.uid,uid);},
  async enterProgramRaw(){context.restore++;},
  async initializeLearned(options){assert.equal(gate.snapshot().ready,options?.confirmationEpoch?false:true);context.learned++;},async release(){}
 };
 class FakeSession{
  constructor(a,o){this.adapter=a;this.onChange=o.onChange;this.store=o.storage;this.binding=JSON.parse(this.store.getItem('xiaobai:ota:binding:v1')||'null');this.state={phase:'idle',busy:false,written:false,total:0,committed:0};}
  snapshot(){return{...this.state,recovery:Boolean(this.binding?.pending),binding:this.binding};}
  saveBinding(b){this.binding={...b};this.store.setItem('xiaobai:ota:binding:v1',JSON.stringify(b));}
  async choose(bytes,name){assert.deepEqual(bytes,target.bytes);this.state.pkg=target;}
  async start({recovery,confirmationOnly=false,restoreConfirmation}){
   context.starts++;this.state.busy=true;await this.adapter.prepare();
   if(confirmationOnly){this.state.busy=false;throw Object.assign(new Error('Installed-image confirmation does not rewrite an unmatched current App'),{code:'UNCONFIRMED'});}
   if(recovery){assert.equal(this.binding.pending.imageSha256,target.imageSha256);assert.equal(this.binding.pending.version,target.version);await this.adapter.connectApp(this.binding);}
   const actual=await this.adapter.readApp();this.saveBinding({deviceId:actual.deviceId,uid:actual.uid,pending:{...target}});
   await this.adapter.enterBoot(this.binding);this.state.phase='transfer';this.onChange(this.snapshot());
   if(context.upgradeWait)await context.upgradeWait;
   if(context.failUpgrade)throw Object.assign(new Error('offline cancellation'),{code:'CANCELLED'});
   await this.adapter.disconnect();context.info={...context.info,version:target.version,imageValid:true,imageSha256:target.imageSha256};
   await this.adapter.connectApp(this.binding);const post=await this.adapter.readApp();this.state.healthVerifiedEpoch=post.epoch;if(restoreConfirmation)await restoreConfirmation(post);this.saveBinding({...this.binding,pending:null});
   this.state.phase='success';this.state.busy=false;this.state.written=true;await this.adapter.release();return{written:true};
  }
  async cancel(){context.failUpgrade=true;if(context.releaseUpgrade)context.releaseUpgrade();await this.adapter.disconnect();this.state.busy=false;}
  async dispose(){await this.adapter.release();}
 }
 gate=new Gate(adapter,{storage:store,loadBundle:async()=>{context.load++;if(loadError)throw loadError;return{pkg:target,release:{}};},sessionFactory:(a,o)=>new FakeSession(a,o)});
 gate.attachEpoch(context.epoch);return{gate,context,adapter,store};
}
async function basic(){
 const {gate:g,context:c}=fixture();const entries=[];g.subscribe(s=>entries.push(s));
 assert.equal(await g.onProgramEntered(c.epoch),true);assert.equal(g.snapshot().phase,'ready');assert.equal(c.reads,1);assert.equal(c.load,1);
 for(let i=0;i<10;i++){await g.onProgramEntered(c.epoch);assert.equal(await g.ensureReady(),true);}
 assert.equal(c.reads,1,'one authoritative task per epoch');
 const e={code:10,data:[2,0,1,0,2,1,1,1]};for(let i=0;i<20;i++)g.onVersionEvent(e,c.epoch);assert.equal(c.reads,1);
 g.onVersionEvent({code:10,data:[0,0,1,0,2,1,1,1]},'old-epoch');assert.equal(c.reads,1,'old event cannot query or change readiness');
 c.epoch='epoch-2';g.attachEpoch(c.epoch);assert.equal(g.snapshot().ready,false);assert.equal(await g.onProgramEntered(c.epoch),true);assert.equal(c.reads,2);await g.dispose();
}
async function policies(){
 for(const opts of [{version:0x10000},{imageValid:false}]){
  const {gate:g,context:c}=fixture(opts);assert.equal(await g.onProgramEntered(c.epoch),false);assert.equal(g.snapshot().canUpgrade,true);assert.equal(g.snapshot().prompt,true);
  await g.cancel();assert.equal(g.snapshot().prompt,false);for(let i=0;i<10;i++)await g.onProgramEntered(c.epoch);assert.equal(g.snapshot().prompt,false);assert.equal(c.reads,1);
  assert.equal(await g.ensureReady({interactive:true}),false);assert.equal(g.snapshot().prompt,true);assert.equal(c.reads,1);await g.dispose();
 }
 for(const [opts,phase,code] of [[{version:0x10003},'newer','NEWER'],[{hash:'c'.repeat(64)},'unknown','VERSION_COLLISION']]){
  const {gate:g,context:c}=fixture(opts);assert.equal(await g.onProgramEntered(c.epoch),false);assert.equal(g.snapshot().phase,phase);assert.equal(g.snapshot().code,code);assert.equal(g.snapshot().canUpgrade,false);await assert.rejects(()=>g.confirmUpgrade());assert.equal(c.enter,0);await g.dispose();
 }
 const {gate:g,context:c}=fixture({loadError:new Error('missing builtin')});assert.equal(await g.onProgramEntered(c.epoch),false);assert.equal(c.reads,0);assert.equal(g.snapshot().ready,false);assert.match(g.snapshot().message,/missing/);await g.dispose();
}
async function stale(){
 const {gate:g,context:c}=fixture({version:0x10000});let release;c.readWait=new Promise(r=>release=r);const pending=g.onProgramEntered(c.epoch);await tick();c.epoch='second';g.attachEpoch(c.epoch);release();await pending;assert.equal(g.snapshot().ready,false);assert.equal(g.snapshot().prompt,false);c.readWait=null;await g.onProgramEntered(c.epoch);assert.equal(g.snapshot().prompt,true);
 g.leaveProgram();assert.equal(g.snapshot().prompt,false);await g.dispose();
 const cancelled=fixture({version:0x10000});let finish;cancelled.context.readWait=new Promise(r=>finish=r);const check=cancelled.gate.onProgramEntered(cancelled.context.epoch);await tick();await cancelled.gate.cancel();finish();await check;assert.equal(cancelled.gate.snapshot().prompt,false,'late cancelled check cannot re-open a prompt');assert.equal(cancelled.gate.snapshot().ready,false);await assert.rejects(()=>cancelled.gate.confirmUpgrade());await cancelled.gate.dispose();
}
async function upgrades(){
 const {gate:g,context:c}=fixture({version:0x10000});await g.onProgramEntered(c.epoch);const a=g.confirmUpgrade(),b=g.confirmUpgrade();assert.equal(a,b,'same confirmation owns only one task');await a;
 assert.equal(c.starts,1);assert.equal(c.enter,1);assert.equal(c.restore,1);assert.equal(c.learned,1);assert.equal(g.snapshot().phase,'success');assert.equal(g.snapshot().ready,true);assert.equal(c.reads,3,'precheck and Session pre/post; confirmed epoch needs no duplicate final INFO');
 assert.equal(await g.ensureReady(),true);await g.dispose();
 const race=fixture({version:0x10000});await race.gate.onProgramEntered(race.context.epoch);race.context.onPrepare=()=>{race.context.uid='111122223333444455556666';race.context.deviceId='AA:BB:CC:11:22:44';race.context.epoch='alien';};
 await assert.rejects(()=>race.gate.confirmUpgrade(),/变化|确认/);assert.equal(race.context.enter,0,'no ENTER for a device swapped during prepare');assert.equal(race.gate.snapshot().ready,false);await race.gate.dispose();
 const entry=fixture({version:0x10000});await entry.gate.onProgramEntered(entry.context.epoch);entry.context.onPrepare=()=>entry.gate.leaveProgram('mode changed');
 await assert.rejects(()=>entry.gate.confirmUpgrade());assert.equal(entry.context.enter,0);await entry.gate.dispose();
}
async function recovery(){
 const s=storage();s.setItem('xiaobai:ota:binding:v1',JSON.stringify({uid,deviceId,pending:{boardId:target.boardId,version:target.version,imageSize:target.imageSize,imageSha256:target.imageSha256},written:true}));
 const {gate:g,context:c}=fixture({stored:s,version:0x10000});c.connected=false;g.disconnected(c.epoch);await Promise.all([g.onProgramRequested(),g.onProgramRequested()]);assert.equal(g.snapshot().phase,'unconfirmed');assert.equal(g.snapshot().confirmationOnly,true);assert.equal(g.snapshot().canUpgrade,false);assert.equal(g.snapshot().prompt,true,'duplicate offline entry keeps the one pending confirmation prompt');assert.equal(c.enter,0);
 await assert.rejects(()=>g.confirmUpgrade(),e=>e.code==='UNCONFIRMED');assert.equal(g.snapshot().ready,false);assert.equal(g.snapshot().phase,'unconfirmed');assert.equal(c.starts,1);assert.equal(c.enter,0,'written pending may only retry confirmation, never start another write');await g.dispose();
}
async function recoveryTransportLoss(){
 const {gate:g,context:c}=fixture({version:0x10000});
 await g.onProgramEntered(c.epoch);
 assert.equal(g.prompted.size,1,'real precheck already deduplicated this UID/target');
 g.session.saveBinding({uid,deviceId,pending:{boardId:target.boardId,version:target.version,imageSize:target.imageSize,imageSha256:target.imageSha256},written:false});
 c.connected=false;g.disconnected(c.epoch);
 assert.equal(g.snapshot().phase,'recovery');
 assert.equal(g.snapshot().prompt,true,'unexpected loss with pending must retain visible recovery despite an existing prompted key');
 await g.onProgramRequested();assert.equal(g.snapshot().prompt,true);
 await g.cancel();assert.equal(g.snapshot().prompt,false);
 for(let i=0;i<3;i++)await g.onProgramRequested();
 assert.equal(g.snapshot().prompt,false,'explicit cancel is not reopened by duplicate route callbacks');
 await g.onProgramRequested({interactive:true});
 assert.equal(g.snapshot().prompt,true,'an explicit same-device recovery action reopens the prompt');
 await g.dispose();
}
function events(){
 const fs=require('fs'),path=require('path');const vectors=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/automatic-firmware-update-vectors.json'),'utf8'));
 for(const item of vectors.cases){let event;new Receiver(packet=>{const data=packet.slice(5,15);event={code:data[0],counter:data[1],data:data.slice(2)};}).feed(Buffer.from(item.frame,'hex'));const value=parseVersionEvent(event);assert.equal(value.version,item.version);assert.equal(value.boardId,item.board_id);assert.equal(value.protocol,item.protocol);assert.equal(value.imageValid,item.image_valid);}
 assert.equal(parseVersionEvent({code:10,data:[2,0,1,0,2,1,1,2]}),null);assert.equal(parseVersionEvent({code:10,data:[0,0,0,0,2,1,1,1]}),null);assert.equal(parseVersionEvent({code:9,data:Array(8).fill(0)}),null);assert.equal(parseVersionEvent({code:10,data:[1]}),null);
}
(async()=>{events();for(const fn of [basic,policies,stale,upgrades,recovery,recoveryTransportLoss]){await fn();console.log('PASS builtin firmware gate '+fn.name);}console.log('PASS gate dedupe, authoritative fallback, policies, consent pinning and fixed-target recovery; offline only.');})().catch(e=>{console.error(e);process.exitCode=1;});
