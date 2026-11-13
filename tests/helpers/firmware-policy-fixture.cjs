'use strict';
// Real Gate/Session/protocol and real signed targets. Only the device adapter,
// raw Boot responses and monotonic clock are synthetic; no device I/O.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const P=require('../../xiaobai-ota-protocol.js'),Ota=require('../../xiaobai-ota.js'),{Gate}=require('../../xiaobai-firmware.js');
const root=path.resolve(__dirname,'../..'),key='xiaobai:ota:binding:v1';
const uid='00112233445566778899aabb',deviceId='EC:B0:DC:30:78:0E',copy=v=>JSON.parse(JSON.stringify(v));
async function signedCurrent(){const r=JSON.parse(fs.readFileSync(path.join(root,'assets/firmware/release.json'),'utf8'));return P.verifyPackage(fs.readFileSync(path.join(root,r.firmware.asset)),{name:path.basename(r.firmware.asset)});}
async function signedHistorical(){const file=path.join(root,'tests/fixtures/firmware/xiaobai_py32_1.0.3.ota');return P.verifyPackage(fs.readFileSync(file),{name:path.basename(file)});}
function infoFor(target,patch={}){
  const layout=P.layoutOf(target);
  return {protocol:1,schemaVersion:layout.id,boardId:target.boardId,bootVersion:target.minBootVersion??target.minBoot??layout.minBootVersion,version:target.version,mode:0,imageValid:true,
    state:0,lastError:0,imageSize:target.imageSize,nextOffset:0,imageSha256:target.imageSha256,layoutId:layout.id,activeAppBase:layout.appBase,erasePage:layout.erasePage,
    capabilities:layout.id===2?P.CAP.LEGACY|P.CAP.COMPACT|P.CAP.DOWNGRADE|P.CAP.REWRITE:P.CAP.LEGACY,...patch};
}
function infoBytes(i){
  const schema=i.schemaVersion??1,b=new Uint8Array(schema===2?72:60),d=new DataView(b.buffer);
  d.setUint32(0,P.C.OTA_INFO_MAGIC,true);d.setUint16(4,schema,true);d.setUint16(6,i.boardId,true);
  d.setUint32(8,i.bootVersion??0,true);d.setUint32(12,i.version,true);b.set([i.mode,+i.imageValid,i.state,i.lastError],16);
  d.setUint32(20,i.imageSize,true);d.setUint32(24,i.nextOffset,true);b.set(P.unhex(i.imageSha256),28);
  if(schema===2){d.setUint32(60,i.layoutId,true);d.setUint32(64,i.activeAppBase,true);d.setUint16(68,i.erasePage,true);d.setUint16(70,i.capabilities,true);}
  return b;
}
function fixture({pkg,deviceTarget=pkg,appPatch={},bootPatch={},binding=null,connected=true,statusFault=0,loadBundle=null}={}){
  let clock=1000,seq=0,connection=0,gate;
  const events=[],frames=[],values=new Map(binding?[[key,JSON.stringify(binding)]]:[]),state={epoch:connected?'initial-app':null,deviceId,connected};
  // Actual Boot answers are independent of any stale compile-time App fields.
  const appInfo=infoFor(deviceTarget,appPatch),bootInfo={...infoFor(deviceTarget),mode:1,...bootPatch};
  const store={getItem:k=>values.get(k)||null,setItem:(k,v)=>{values.set(k,v);events.push({type:'persist',binding:JSON.parse(v)});}};
  const actual=()=>({uid,deviceId:state.deviceId,epoch:state.epoch,productMode:4,info:{...appInfo}});
  const listeners=new Set(),raw={connectionId:'authoritative-boot',subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},onDisconnect:()=>()=>{},
    async write(bytes){
      const frame=P.decodeFrame(bytes);frames.push(frame);events.push({type:'raw',command:frame.command});
      let payload;
      if(frame.command===P.OP.INFO)payload=P.concat([0],infoBytes(bootInfo));
      else if(frame.command===P.OP.FINISH){assert.equal(frame.payload.length,0,'idle return is an empty FINISH');const b=new Uint8Array(5);new DataView(b.buffer).setUint32(1,bootInfo.imageSize,true);payload=b;}
      else throw Error('This policy fixture forbids every BEGIN/DATA write');
      for(const fn of listeners)fn(P.encodeFrame(frame.command|0x80,frame.requestId,payload));
    }};
  const adapter={identity:()=>state.connected?{epoch:state.epoch,deviceId:state.deviceId}:null,
    async readApp({guard=()=>true}={}){events.push({type:'app-info',bootVersion:appInfo.bootVersion});if(!guard())throw Object.assign(Error('stale App info'),{code:'STALE'});return actual();},
    async queryStatus(){clock+=600;events.push({type:'status',seq:seq+1,pending:copy(gate.session.binding?.pending??null)});return{epoch:state.epoch,seq:++seq,opcode:4,result:0,sentAt:clock,receivedAt:clock,data:[4,30,30,30,0x74,0x0e,statusFault]};},
    async prepare(){events.push({type:'prepare'});},async release(){events.push({type:'release'});},
    async enterProgramRaw(){events.push({type:'program'});},async initializeLearned(){events.push({type:'learned'});},async adoptConfirmedLocator(){events.push({type:'adopt'});},
    async connectApp(){events.push({type:'connect-app'});state.connected=true;state.epoch='reconnected-app-'+(++connection);gate.attachEpoch(state.epoch,{owned:true});return adapter.readApp();},
    async enterBoot(){events.push({type:'enter-boot'});state.connected=false;return raw;},async connectBoot(){events.push({type:'connect-boot'});state.connected=false;return raw;},
    async disconnect(){events.push({type:'disconnect'});state.connected=false;}
  };
  gate=new Gate(adapter,{storage:store,loadBundle:loadBundle||(async()=>({pkg})),timing:{healthGapMs:0,healthDeadlineMs:5000,requestMs:50,retries:0,restartMs:0},sessionFactory:(a,o)=>new Ota.Session(a,{...o,clock:()=>clock})});
  if(connected)gate.attachEpoch(state.epoch);
  return {gate,adapter,state,appInfo,bootInfo,events,frames,store,values,actual};
}
module.exports={P,Ota,Gate,uid,deviceId,key,copy,signedCurrent,signedHistorical,infoFor,fixture};
