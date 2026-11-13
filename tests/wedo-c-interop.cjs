'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const readline=require('node:readline'),{spawn}=require('node:child_process');
const root=process.env.CARD_APP_ROOT||path.resolve(__dirname,'..');
const executable=process.env.XIAOBAI_C_BRIDGE;
if(!executable)throw Error('Set XIAOBAI_C_BRIDGE to a freshly built tools/build_motion_condition_host.py bridge.');
const P=require(root+'/xiaobai-protocol.js'),M=require(root+'/xiaobai-multi-protocol.js'),R=require(root+'/xiaobai-multi-runner.js');
const release=require(root+'/assets/firmware/release.json'),version=0x020300;
assert.equal(release.firmware.version,version);
const block=(uid,id,params={})=>({uid,id,params}),wait=(uid,duration)=>block(uid,'wait-time',{duration});
const show=(uid,value)=>block(uid,'display-number',{value});
const group=(id,items,trigger)=>({groupId:id,startId:'head-'+id,items,...(trigger?{trigger}:{})});
const shot=(groups,manualGroupId)=>({modelId:'xiaobai',groups,...(manualGroupId?{manualGroupId}:{})});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,waiter,tail=Promise.resolve(),receive,link,coordinator,ticker,now=10000,firmwareEvent;
let namespace='',asr,scenario='setup';
const rows=[],steps=[];
function command(line){
  const pending=tail.then(()=>new Promise((resolve,reject)=>{waiter={resolve,reject,line};child.stdin.write(line+'\n');}));
  tail=pending.catch(()=>{});return pending;
}
function record(response){
  now=response.now;asr=response.asr;
  if(response.motor.length)rows.push({scenario,now,motor:response.motor});
  for(const raw of response.tx){
    const frame=Uint8Array.from(Buffer.from(raw,'hex'));
    if(frame[4]===0xd4)rows.push({scenario,now,rx:M.decode(frame)});
    receive?.(frame);
  }
  const fresh=asr.lo+'/'+asr.hi;
  if(asr.namespaceCount&&(asr.lo||asr.hi)&&fresh!==namespace){
    namespace=fresh;command('asr 14 '+asr.lo+' '+asr.hi+' 0 0 0 0 0').catch(()=>{});
  }
}
async function until(fn,limit=2500){const end=Date.now()+limit;while(!fn()&&Date.now()<end)await pause(8);assert.ok(fn(),'actual-C condition not reached: '+scenario);}
function makeCoordinator(){
  return new R.SessionCoordinator(connection,{onStep:item=>steps.push({scenario,uid:item.uid,now,at:Date.now()})});
}
const connection={id:'actual-c',enterProgram:()=>link.enterProgram(),ensureFirmware:async()=>true,
  firmware:{snapshot:()=>({ready:!!firmwareEvent,currentVersion:firmwareEvent?.version,targetVersion:version,epoch:'actual-c',
    actual:{epoch:'actual-c',info:{version:firmwareEvent?.version,mode:0,imageValid:firmwareEvent?.valid}}})},
  multiProgram:{createClient:options=>new M.SessionClient(link,options)}};
async function main(){
  const sidecar=JSON.parse(fs.readFileSync(executable.replace(/\.exe$/,'.json'),'utf8'));
  const firmware=process.env.XIAOBAI_FIRMWARE_ROOT;
  if(!firmware)throw Error('Set XIAOBAI_FIRMWARE_ROOT to the production embedded repository.');
  for(const [file,sha] of Object.entries(sidecar.production_source_sha256))
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(firmware,file))).digest('hex'),sha,'stale actual-C bridge: '+file);
  child=spawn(executable,[],{stdio:['pipe','pipe','inherit'],windowsHide:true});
  readline.createInterface({input:child.stdout}).on('line',line=>{
    const job=waiter;waiter=null;
    try{const result=JSON.parse(line);if(result.error)throw Error(result.error);record(result);job.resolve(result);}
    catch(error){job?.reject(error);}
  });
  child.on('error',error=>waiter?.reject(error));
  await command('reset');
  const transport={async start(fn){receive=fn;},close(){},async write(bytes){
    if(bytes[4]===0xc4)rows.push({scenario,at:Date.now(),tx:M.decode(bytes)});
    // Exercise the real production parser across physical GATT fragment boundaries.
    for(let i=0;i<bytes.length;i+=20)await command('frame '+Buffer.from(bytes.slice(i,i+20)).toString('hex'));
  }};
  link=new P.Link(transport,{onEvent:e=>{if(e.code===10)firmwareEvent={version:M.read32(e.data),valid:Boolean(e.data[7]&1)};}});
  await link.start();await link.enterProgram();
  assert.equal(firmwareEvent.version,version);assert.equal(firmwareEvent.valid,true);
  await command('asr 11 0 0 0 1 0 0 0');
  let stepping=false,last=Date.now();
  ticker=setInterval(()=>{if(stepping)return;stepping=true;const clock=Date.now(),ms=clock-last;last=clock;
    command('step '+ms).finally(()=>{stepping=false;}).catch(()=>{});
  },20);
  scenario='motor-takeover';coordinator=makeCoordinator();
  const result=await coordinator.run(shot([
    group('a',[block('forward','motor-forward',{port:'L',duration:.3}),show('a-done',1)]),
    group('b',[wait('before-b',.12),block('reverse','motor-reverse',{port:'L',duration:.35}),show('b-done',2)])
  ]));
  assert.equal(result.sessionOpen,true);
  const motorRows=rows.filter(row=>row.scenario===scenario&&row.motor);
  const starts=motorRows.flatMap(row=>row.motor.map(event=>({...event,now:row.now}))).filter(event=>event.op===0&&event.id===0);
  assert.equal(starts.length,2);assert.deepEqual(starts.map(event=>event.dir),[1,2]);
  const reversed=starts[1];
  assert.ok(!motorRows.some(row=>row.now>reversed.now&&row.now<reversed.now+330&&row.motor.some(event=>event.id===0&&event.op!==0)),'old A deadline must not brake B');
  assert.equal(rows.some(row=>row.scenario===scenario&&row.rx&&(row.rx.kind&127)===4),false,'ordinary motor/display commands do not need action replies');
  await coordinator.stop();

  scenario='shared-sensor';coordinator=makeCoordinator();
  await command('sensor 0 1 1 1 0 0 0 0');
  const loop={uid:'ir-loop',id:'loop-infrared',params:{comparison:'greater',threshold:50},children:[wait('round',.6)]};
  const loopDone=coordinator.run(shot([group('a',[loop,show('loop-done',4)]),
    group('b',[block('ir-wait','infrared-wait',{comparison:'greater',threshold:20}),show('wait-done',3)])]));
  loopDone.catch(()=>{});
  await until(()=>steps.some(step=>step.scenario===scenario&&step.uid==='round'));
  await command('sensor 70 1 1 1 0 0 0 0');await pause(260);
  await command('sensor 0 1 1 1 0 0 0 0');
  await until(()=>steps.filter(step=>step.scenario===scenario&&step.uid==='round').length>=2);
  assert.equal(steps.some(step=>step.scenario===scenario&&step.uid==='loop-done'),false);
  await command('sensor 80 1 1 1 0 0 0 0');await loopDone;
  assert.ok(steps.some(step=>step.scenario===scenario&&step.uid==='wait-done'));
  assert.equal(rows.some(row=>row.scenario===scenario&&row.tx&&(row.tx.opcode===0x30||row.tx.kind>=12&&row.tx.kind<=15)),false);
  await coordinator.stop();

  scenario='voice-hit';coordinator=makeCoordinator();
  const voiceDone=coordinator.run(shot([group('a',[block('voice','speech-wait',{phrase:'ASR_01'}),show('after-hit',5)])]));
  voiceDone.catch(()=>{});
  await until(()=>asr.op===119&&asr.kind===102&&asr.task>0);
  const voice={...asr};
  await command('asr 12 '+voice.lo+' '+voice.hi+' '+voice.task+' '+voice.item+' 11 0 0');
  await pause(80);assert.equal(steps.some(step=>step.scenario===scenario&&step.uid==='after-hit'),false);
  await command('asr 13 '+voice.lo+' '+voice.hi+' '+(voice.task+1)+' '+voice.item+' 0 0 0');
  await pause(60);assert.equal(steps.some(step=>step.scenario===scenario&&step.uid==='after-hit'),false);
  await command('asr 13 '+voice.lo+' '+voice.hi+' '+voice.task+' '+voice.item+' 0 0 0');
  await voiceDone;assert.ok(steps.some(step=>step.scenario===scenario&&step.uid==='after-hit'));
  await coordinator.stop();
  const report={hardware:false,app:release.app,firmwareVersion:version,sourceSha256:sidecar.production_source_sha256,
    checks:{productionCParser:true,realGattFragments:true,oneStartPerRun:rows.filter(row=>row.tx?.kind===18).length===3,
      noOrdinaryActionReplies:true,motorTakeover:true,oldTimerCannotStopNewMotor:true,
      sharedSensorValues:true,loopUsesCurrentSample:true,trueVoiceHit:true},
    scenarios:[...new Set(rows.map(row=>row.scenario))],steps,rows};
  const out=process.env.XIAOBAI_C_REPORT;
  if(out)fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checks:report.checks,steps:steps.length,wireRows:rows.length}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  clearInterval(ticker);await coordinator?.stop().catch(()=>{});link?.close();
  await tail.catch(()=>{});child?.stdin.end();
});
