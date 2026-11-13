'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm');
const root=path.resolve(process.env.CARD_APP_ROOT||path.join(__dirname,'..'));
const {Gate}=require(path.join(root,'xiaobai-firmware.js')),P=require(path.join(root,'xiaobai-protocol.js')),{Session}=require(path.join(root,'xiaobai-learned-commands.js'));
const {requireFeatureFirmware}=require(path.join(root,'xiaobai-runner.js'));
const target=0x020202,uid='00112233445566778899aabb',hash='b'.repeat(64);
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture({version=target,imageValid=true,pending=false}={}){
 const c={epoch:'one',deviceId:'device-a',enterVersion:1,programMode:4,version,imageValid,normal:0,full:0,loads:0,starts:0,choose:0};
 const full=()=>({epoch:c.epoch,deviceId:c.deviceId,uid,productMode:4,info:{version:c.version,imageValid:c.imageValid,mode:0,boardId:258,protocol:1,schemaVersion:2,layoutId:2,activeAppBase:0x08003000,erasePage:128,imageSha256:hash,imageSize:320}});
 const pkg={signatureVerified:true,boardId:258,version:target,format:2,layoutId:2,appBase:0x08003000,erasePage:128,minBoot:0x20000,minBootVersion:0x20000,imageSha256:hash,imageSize:320,bytes:Uint8Array.of(1),name:'test.ota'};
 const adapter={identity:()=>c.epoch?{epoch:c.epoch,deviceId:c.deviceId,enterVersion:c.enterVersion,programMode:c.programMode}:null,
  async readProgramVersion({guard,signal}){c.normal++;if(c.hold)await c.hold;if(!guard())throw Object.assign(Error('stale version'),{code:'STALE'});return{epoch:c.epoch,deviceId:c.deviceId,enterVersion:c.enterVersion,productMode:4,info:{version:c.version,mode:0,imageValid:c.imageValid}};},
  async readApp(){c.full++;return c.badUid?{...full(),uid:null}:full();},async enterProgramRaw(){},async release(){}};
 const session={binding:pending?{uid,deviceId:c.deviceId,pending:{boardId:258,version:target,layoutId:2,imageSize:320,imageSha256:hash}}:null,state:{},snapshot(){return{busy:false};},async choose(){c.choose++;},async start(){c.starts++;throw Object.assign(Error('test stops before transport'),{code:'TEST_STOP'});},async dispose(){}};
 const gate=new Gate(adapter,{targetVersion:target,loadBundle:async()=>{c.loads++;return{pkg};},sessionFactory:()=>session});gate.attachEpoch(c.epoch);
 return{gate,c,adapter,session,pkg};
}
test('ordinary check uses only one application-version read and no bundle/full identity',async()=>{
 const {gate,c}=fixture();assert.equal(await gate.onProgramEntered(c.epoch),true);
 const state=gate.snapshot();assert.equal(state.checkKind,'program-version');assert.equal(state.currentVersion,target);assert.equal(state.actual.uid,undefined);assert.deepEqual(state.actual.info,{version:target,mode:0,imageValid:true});
 for(let i=0;i<12;i++){assert.equal(await gate.ensureReady(),true);assert.equal(await gate.onProgramEntered(c.epoch),true);}
 assert.deepEqual({normal:c.normal,full:c.full,loads:c.loads},{normal:1,full:0,loads:0});await gate.dispose();
});
test('same connection reuses version after mode entry; disconnect/new epoch must requery',async()=>{
 const {gate,c}=fixture();await gate.onProgramEntered(c.epoch);gate.leaveProgram();assert.equal(gate.snapshot().ready,false);c.enterVersion++;await gate.onProgramEntered(c.epoch);assert.equal(c.normal,1);assert.equal(gate.snapshot().actual.enterVersion,2);assert.equal(gate.snapshot().ready,true);
 gate.disconnected(c.epoch);c.epoch='two';gate.attachEpoch(c.epoch);assert.equal(gate.snapshot().ready,false);await gate.onProgramEntered(c.epoch);assert.equal(c.normal,2);await gate.dispose();
});
for(const [name,opts]of [['old',{version:target-1}],['future',{version:target+1}],['invalid',{imageValid:false}]])test(name+' application is not ready and never silently upgrades',async()=>{
 const {gate,c}=fixture(opts);assert.equal(await gate.onProgramEntered(c.epoch),false);assert.equal(gate.snapshot().canUpgrade,true);assert.equal(c.starts,0);assert.equal(c.full,0);assert.equal(c.loads,0);await gate.dispose();
});
test('late ordinary read cannot overwrite a replacement connection and its current entry',async()=>{
 const {gate,c}=fixture();let release;c.hold=new Promise(r=>release=r);const old=gate.onProgramEntered(c.epoch);await tick();c.epoch='two';c.enterVersion=4;gate.attachEpoch(c.epoch);c.hold=null;assert.equal(await gate.onProgramEntered(c.epoch),true);release();assert.equal(await old,false);assert.equal(gate.snapshot().actual.epoch,'two');assert.equal(gate.snapshot().actual.enterVersion,4);await gate.dispose();
});
test('ordinary mode generation invalidates readiness; a version hint does not establish it',async()=>{
 const {gate,c}=fixture();gate.onVersionEvent({code:10,data:[2,2,2,0,2,1,2,1]},c.epoch);assert.equal(gate.snapshot().ready,false);await gate.onProgramEntered(c.epoch);c.enterVersion++;assert.equal(gate.snapshot().ready,false);await gate.onProgramEntered(c.epoch);assert.equal(gate.snapshot().ready,true);assert.equal(c.normal,1);await gate.dispose();
});
test('explicit update obtains complete UID/image evidence before original consent Session',async()=>{
 const {gate,c}=fixture({version:target-1});await gate.onProgramEntered(c.epoch);const a=gate.confirmUpgrade(),b=gate.confirmUpgrade();assert.equal(a,b);await assert.rejects(a,e=>e.code==='TEST_STOP');assert.equal(c.full,1);assert.equal(c.loads,1);assert.equal(c.choose,1);assert.equal(c.starts,1);assert.equal(gate.consent.uid,uid);await gate.dispose();
});
test('missing UID during explicit full preflight cannot enter original Session',async()=>{
 const {gate,c}=fixture({version:target-1});await gate.onProgramEntered(c.epoch);c.badUid=true;await assert.rejects(gate.confirmUpgrade(),e=>e.code==='IDENTITY');assert.equal(c.full,1);assert.equal(c.starts,0);assert.equal(c.choose,0);await gate.dispose();
});
test('a full read that discovers the current target refreshes the ordinary connection cache',async()=>{
 const {gate,c}=fixture({version:target-1});await gate.onProgramEntered(c.epoch);c.version=target;assert.deepEqual(await gate.confirmUpgrade(),{state:'current'});assert.equal(c.full,1);assert.equal(c.starts,0);gate.leaveProgram();c.enterVersion++;assert.equal(await gate.onProgramEntered(c.epoch),true);assert.equal(c.normal,1);assert.equal(gate.snapshot().currentVersion,target);await gate.dispose();
});
test('cancelling an ordinary query aborts its owned signal and suppresses late readiness',async()=>{
 const {gate,c,adapter}=fixture();let finish,signal;adapter.readProgramVersion=async options=>{signal=options.signal;await new Promise(r=>finish=r);return{epoch:c.epoch,deviceId:c.deviceId,enterVersion:c.enterVersion,productMode:4,info:{version:target,mode:0,imageValid:true}};};
 const waiting=gate.onProgramEntered(c.epoch);await tick();await gate.cancel();assert.equal(signal.aborted,true);finish();assert.equal(await waiting,false);assert.equal(gate.snapshot().ready,false);assert.equal(gate.snapshot().prompt,false);await gate.dispose();
});
test('pending recovery continues to require complete App identity instead of lightweight version',async()=>{
 const {gate,c}=fixture({pending:true,version:target-1});await gate.onProgramEntered(c.epoch);assert.equal(c.normal,0);assert.equal(c.full,1);assert.equal(c.loads,1);assert.equal(gate.snapshot().checkKind,'full-identity');await gate.dispose();
});
function learnedFixture(){
 const writes=[],store=new Map();let n=0;
 const link={mode:4,desiredMode:4,modeVersion:1,subscribed:true,heartbeatTimer:1,closed:false,programEnteredAt:Date.now()-1000,programModeObservedAt:Date.now()-1000,
  firmwareGate:{snapshot:()=>({ready:true})},subscribe:()=>()=>{},onLifecycle:()=>()=>{},nextSeq:()=>++n,
  async request(seq,op,args){writes.push({op,args});if(op===P.OP.QUERY_STATUS)return[4,0,0,0,0,0,0];if(op===P.OP.READ_UID)return[args[0],...Buffer.from(uid,'hex').subarray(args[0]*6,args[0]*6+6)];if(op===P.OP.QUERY_LEARNED)return[...args,255,3,15];throw Error('unexpected learned opcode '+op);},stopProgram:async()=>{}};
 const service=new Session(link,{storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},settleMs:0});return{link,service,writes};
}
test('background learned status reads ten real slots without UID; opening feature lazily obtains UID',async()=>{
 const {service,writes}=learnedFixture();await service.initializeStatus();assert.equal(service.getSnapshot().query,'ready');assert.equal(service.getSnapshot().uid,null);assert.equal(service.getSnapshot().slots.filter(s=>s.state==='learned').length,10);assert.equal(writes.filter(w=>w.op===P.OP.READ_UID).length,0);
 await service.initialize();assert.equal(service.uid,uid);assert.equal(writes.filter(w=>w.op===P.OP.READ_UID).length,2);service.dispose();
});
test('a program without learned waits immediately reserves local mutex with zero learned IO',async()=>{
 const {service,writes}=learnedFixture();await service.prepareRun([{id:'wait-time',params:{duration:4}}]);assert.equal(service.preparingRun,true);assert.equal(service.busy,true);assert.deepEqual(writes,[]);await assert.rejects(service.learn(1),e=>e.code==='BUSY');await service.initializeStatus();assert.deepEqual(writes,[]);service.stop();assert.equal(service.busy,false);service.dispose();
});
test('real learning/preparing/wait tasks still reject normal-run reservation',async()=>{
 for(const key of ['preparingLearn','learning','waiting']){const {service,writes}=learnedFixture();service[key]=key==='preparingLearn'?true:{terminal:false};await assert.rejects(service.prepareRun([]),e=>e.code==='BUSY');assert.deepEqual(writes,[]);service[key]=key==='preparingLearn'?false:null;service.dispose();}
});
test('programs using a learned slot still read UID and verify real slot state',async()=>{
 const {service,writes}=learnedFixture();await service.prepareRun([{id:'self-learned-wait',params:{slot:1}}]);assert.equal(service.uid,uid);assert.equal(service.preparingRun,true);assert.equal(writes.filter(w=>w.op===P.OP.READ_UID).length,2);service.stop();service.dispose();
});
test('motion and conditional features accept lightweight current 2.2.2 evidence without package/hash/UID',()=>{
 const state={ready:true,targetVersion:target,currentVersion:target,epoch:'one',actual:{epoch:'one',info:{version:target,mode:0,imageValid:true}}};const connection={firmware:{snapshot:()=>state}};
 requireFeatureFirmware([{id:'motion-wait',uid:'m',params:{state:'still'}}],connection);requireFeatureFirmware([{id:'loop-time',uid:'l',params:{duration:5},children:[]}],connection);
 state.actual.epoch='old';assert.throws(()=>requireFeatureFirmware([{id:'motion-wait',uid:'m',params:{state:'still'}}],connection),e=>e.code==='CONTROL_FIRMWARE');
});
test('production Android ordinary adapter sends exactly INFO part2 and rejects malformed / stale replies',async()=>{
 const code=fs.readFileSync(require.resolve(path.join(root,'android-bluetooth.js')),'utf8'),first=code.indexOf('    async readProgramVersion('),last=code.indexOf('    async readApp(',first);assert(first>=0&&last>first);
 const writes=[],context={current:{connectionId:'one',deviceId:'a'},protocol:P};
 context.link={closed:false,modeVersion:3,mode:4,desiredMode:4,nextSeq:()=>7,async request(seq,op,args,ms,match,options){writes.push({seq,op,args,ms});assert(options.guard());const data=[2,2,2,2,0,0,1];assert(match(data,0));assert(!match([3,2,2,2,0,0,1],0));return data;}};
 const read=vm.runInNewContext('({'+code.slice(first,last)+'}).readProgramVersion',context);const actual=await read();assert.deepEqual(JSON.parse(JSON.stringify(actual)),{epoch:'one',deviceId:'a',enterVersion:3,productMode:4,info:{version:target,mode:0,imageValid:true}});assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{seq:7,op:0x60,args:[2],ms:1800}]);
 context.link.request=async()=>[2,2,2,2,0,0,2];await assert.rejects(read(),e=>e.code==='VERSION');context.link.request=async()=>{context.current.connectionId='two';return[2,2,2,2,0,0,1];};await assert.rejects(read(),e=>e.code==='STALE');
});
test('production Android ordinary adapter uses the real Link receiver/sequence filter for one part2 request',async()=>{
 const code=fs.readFileSync(require.resolve(path.join(root,'android-bluetooth.js')),'utf8'),first=code.indexOf('    async readProgramVersion('),last=code.indexOf('    async readApp(',first),writes=[];let receive;
 const response=(seq,part)=>{const b=P.frame(0xd2,[seq,0x60,0,part,2,2,2,0,0,1]);b[1]=0x98;b[2]=0x97;b[15]=b.subarray(0,15).reduce((a,n)=>a+n,0)&255;return b;};
 const link=new P.Link({async start(fn){receive=fn;},close(){},async write(bytes){writes.push(Array.from(bytes));assert.equal(bytes[6],0x60);assert.equal(bytes[7],2);receive(response((bytes[5]+1)&255,2));receive(response(bytes[5],3));receive(response(bytes[5],2));}},{minWriteMs:0});
 await link.start();link.mode=4;link.desiredMode=4;link.modeVersion=2;
 try{const context={link,current:{connectionId:'wire',deviceId:'wire-device'},protocol:P},read=vm.runInNewContext('({'+code.slice(first,last)+'}).readProgramVersion',context);const actual=await read();assert.equal(actual.info.version,target);assert.equal(actual.enterVersion,2);assert.equal(writes.length,1);assert.equal(actual.uid,undefined);assert.equal(actual.info.imageSha256,undefined);}finally{link.close();}
});

test('cancelled version prompt can be reopened by an explicit run request without a full identity read',async()=>{
 const {gate,c}=fixture({version:target-1});await gate.onProgramEntered(c.epoch);await gate.cancel();
 assert.equal(gate.snapshot().prompt,false);assert.equal(gate.snapshot().canUpgrade,true);
 // Editing is local and does not grant upgrade consent or change the live epoch.
 assert.equal(c.starts,0);assert.equal(await gate.ensureReady({interactive:true,reason:'run'}),false);
 assert.equal(gate.snapshot().phase,'update-required');assert.equal(gate.snapshot().prompt,true);assert.equal(gate.snapshot().canUpgrade,true);
 assert.deepEqual({normal:c.normal,full:c.full,starts:c.starts},{normal:1,full:0,starts:0});await gate.dispose();
});
test('explicit request after cancel cannot let the old query publish readiness or overwrite the new prompt',async()=>{
 const {gate,c,adapter}=fixture();const reads=[];
 adapter.readProgramVersion=options=>new Promise(resolve=>{c.normal++;reads.push({options,resolve});});
 const reply=version=>({epoch:c.epoch,deviceId:c.deviceId,enterVersion:c.enterVersion,productMode:4,info:{version,mode:0,imageValid:true}});
 const old=gate.onProgramEntered(c.epoch);await tick();await gate.cancel();assert.equal(reads[0].options.signal.aborted,true);
 const fresh=gate.ensureReady({interactive:true,reason:'run'});await tick();assert.equal(reads.length,2);
 reads[1].resolve(reply(target-1));assert.equal(await fresh,false);assert.equal(gate.snapshot().phase,'update-required');assert.equal(gate.snapshot().prompt,true);
 reads[0].resolve(reply(target));assert.equal(await old,false);assert.equal(gate.snapshot().ready,false);assert.equal(gate.snapshot().currentVersion,target-1);
 assert.equal(gate.snapshot().phase,'update-required');assert.equal(gate.snapshot().prompt,true);assert.equal(c.full,0);assert.equal(c.starts,0);await gate.dispose();
});
