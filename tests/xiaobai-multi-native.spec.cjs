'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(process.env.CARD_APP_ROOT||path.join(__dirname,'..')),native=path.join(root,'android/app/src/main/java/com/cardprogramming/app');
const multiProgramSource=process.env.CARD_MULTI_PROGRAM_SOURCE||path.join(native,'MultiProgramFrame.java');
const firmware=process.env.XIAOBAI_FIRMWARE_ROOT||path.resolve(root,'../../../5月/小白机器人/LBS-XIAOBAI-AI');
const fixture=path.join(root,'tests/fixtures/multi_group_vectors_v1.json');
const gold=JSON.parse(fs.readFileSync(fs.existsSync(fixture)?fixture:path.join(firmware,'docs/multi_group_vectors_v1.json'),'utf8'));
const cases=[];
const check=(yes,bytes,label)=>cases.push(`${yes?'accept':'reject'}\t${Buffer.from(bytes).toString('hex')}\t${label}`);
function frame(kind,group=0,op=0,task=0,args=[]){
  const b=[0x5a,0x97,0x98,16+args.length,0xc4,1,kind,group,op,0x78,0x56,0x34,0x12,0xf0,0xde,0xbc,0x9a,
    task&255,task>>>8&255,task>>>16&255,task>>>24&255,...args];
  b.push(b.reduce((s,n)=>s+n,0)&255,0xa5);return b;
}
function mutate(b,index,value){const copy=[...b];copy[index]=value;copy[copy.length-2]=copy.slice(0,-2).reduce((s,n)=>s+n,0)&255;return copy;}
for(const vector of gold.vectors){const b=Buffer.from(vector.hex.replace(/\s/g,''),'hex');check(b[4]===0xc4,b,'gold '+vector.name);}
const messageFixture=path.join(root,'tests/fixtures/message_group_vectors_v1.json');
if(fs.existsSync(messageFixture))for(const vector of JSON.parse(fs.readFileSync(messageFixture,'utf8')).vectors){
 const b=Buffer.from(vector.hex.replace(/\s/g,''),'hex');check(b[4]===0xc4,b,'message golden '+vector.name);
}
for(const vector of require(path.join(root,'tests/fixtures/motion_condition_vectors_v1.json')).vectors){
 const b=Buffer.from(vector.wire_hex,'hex');check(b[4]===0xc4,b,'motion/observer golden '+vector.name);
}
function observer(kind,group,condition,id,args=[]){
 let b=frame(kind,group,condition,id,args);
 if(group===0)for(let i=13;i<17;i++)b=mutate(b,i,0);
 return b;
}
const valid=[frame(1,0,0,1),frame(2,0,0,1,[1,2,3,4,5,6,7,8,15]),frame(3,1),frame(5,4,0,100),frame(6,4),frame(7),frame(8),frame(9),frame(10,0,0,0,[8]),frame(10,4,0x43,0xffffffff,[7]),frame(11,0,0,0,[15])];
valid.push(frame(2,0,0,1,[1,2,3,4,5,6,7,8,15,1]));
for(let mask=1;mask<=15;mask++)valid.push(frame(18,0,0,0,[mask]));
for(const bytes of [frame(18,1,0,0,[1]),frame(18,0,1,0,[1]),frame(18,0,0,1,[1]),frame(18),frame(18,0,0,0,[1,0])])check(false,bytes,'START exact session-only shape');
for(const half of [9,13]){let bytes=frame(18,0,0,0,[1]);for(let i=half;i<half+4;i++)bytes=mutate(bytes,i,0);check(false,bytes,'START both SID words must be nonzero');}
for(const kind of [16,17])for(const group of [1,4])for(const id of [1,0xffffffff])valid.push(frame(kind,group,0,id));
for(const group of [1,4])for(const runId of [1,0xffffffff]){
 const prefix=[runId&255,runId>>>8&255,runId>>>16&255,runId>>>24&255];
 for(const [condition,args] of [[1,[0]],[2,[100]],[3,[5]],[4,[0,0,0,0]],[4,[255,255,255,127]]]){
  valid.push(frame(12,group,condition,1,[...prefix,...args]));
  valid.push(frame(13,group,condition,1,prefix),frame(14,group,condition,1,prefix));
  for(const state of [2,3,5,6])valid.push(frame(15,group,condition,1,[...prefix,state]));
 }
}
for(const kind of [16,17]){
 for(const group of [0,5,255])check(false,frame(kind,group,0,1),'lifecycle group');
 check(false,frame(kind,1,1,1),'lifecycle opcode');check(false,frame(kind,1,0,0),'lifecycle zero invocation');
 check(false,frame(kind,1,0,1,[0]),'lifecycle no padding');
}
for(const flags of [0,2,255])check(false,frame(2,0,0,1,[1,2,3,4,5,6,7,8,15,flags]),'OPEN unknown reuse flags');
for(const kind of [12,13,14,15]){
 const tail=kind===12?[50]:kind===15?[2]:[];
 check(false,frame(kind,1,1,1,[0,0,0,0,...tail]),'observer zero runId');
 check(false,observer(kind,0,1,1,[1,0,0,0,...tail]),'group zero cannot reuse');
}
const actions=[
 [0x10,[0,1,1,0,0,0]],[0x10,[1,2,255,255,255,127]],[0x11,[0,1]],[0x11,[1,2]],[0x12,[0]],[0x12,[1]],
 [0x13,[1]],[0x13,[3]],[0x20,[1,1,0,0,0]],[0x20,[4,255,255,255,127]],[0x21,[1]],[0x21,[4]],
 [0x22,[]],[0x23,[1]],[0x23,[3]],[0x30,[0,0,0]],[0x30,[1,1,100]],[0x30,[2,1,100]],
 [0x32,[1]],[0x32,[2]],[0x32,[3]],[0x32,[4]],[0x32,[5]],[0x34,[1]],[0x34,[2]],[0x34,[3]],[0x34,[4]],[0x40,[1]],[0x40,[10]],[0x41,[0]],[0x41,[100]],[0x42,[]],
 [0x43,Array.from({length:16},(_,i)=>i*17)],[0x50,[1]],[0x50,[10]],[0x51,[1]],[0x51,[10]],[0x55,[1]],[0x55,[10]]
];
for(const [op,args] of actions)for(const group of [1,4])for(const task of [1,0xffffffff])valid.push(frame(4,group,op,task,args));
for(const group of [0,1,4])for(const id of [1,0xffffffff]){
 for(const [condition,args] of [[1,[0]],[1,[100]],[2,[0]],[2,[100]],[3,[2]],[3,[5]],[4,[0,0,0,0]],[4,[255,255,255,127]]]){
  valid.push(observer(12,group,condition,id,args));
  valid.push(observer(13,group,condition,id),observer(14,group,condition,id));
  for(const state of [2,3,5,6])valid.push(observer(15,group,condition,id,[state]));
 }
}
// V2 controls are validated independently from the published V1 vocabulary.
const frameV2=(kind,group=0,op=0,task=0,args=[])=>mutate(frame(kind,group,op,task,args),5,2);
for(let mask=0;mask<=15;mask++)valid.push(frameV2(18,0,0,0,[mask]));
for(const kind of [7,8,9])valid.push(frameV2(kind));
valid.push(frameV2(10,0,0,0,[8]));
for(const group of [1,4])for(const task of [1,0xffffffff]) {
 for(const kind of [5,6,16,17])valid.push(frameV2(kind,group,0,task));
 for(const [op,args] of actions) {
  if(op===0x30 || op===0x32 || op===0x34 && args[0]<3)continue;
  valid.push(frameV2(4,group,op,task,args));
 }
 for(const op of [0x34,0x50,0x51,0x55])for(const state of [1,2,3,4,5,6,7,8])
  valid.push(frameV2(10,group,op,task,[state]));
}
for(const kind of [1,2,3,11,12,13,14,15,19,20,21,255]) {
 check(false,frameV2(kind),'V2 unsupported request kind '+kind);
 check(false,frameV2(kind,1,0,1),'V2 unsupported script kind '+kind);
}
for(const [op,args] of actions) {
 const supported=op!==0x30 && op!==0x32 && !(op===0x34 && args[0]<3);
 check(supported,frameV2(4,1,op,1,args),'V2 action vocabulary '+op+' '+args);
 check(false,frameV2(4,1,op,0,args),'V2 zero action task');
 check(false,frameV2(4,1,op,1,[...args,0]),'V2 action padding');
 if(args.length)check(false,frameV2(4,1,op,1,args.slice(0,-1)),'V2 short action');
}
for(const kind of [5,6,16,17]) {
 for(const group of [0,5,255])check(false,frameV2(kind,group,0,1),'V2 script group fence');
 check(false,frameV2(kind,1,0,0),'V2 nonzero script fence');
 check(false,frameV2(kind,1,1,1),'V2 fence opcode');
 check(false,frameV2(kind,1,0,1,[0]),'V2 fence padding');
}
check(false,frame(6,1,0,1),'V1 END has no task fence');
check(false,frameV2(6,1),'V2 END requires a task fence');
check(false,frame(18,0,0,0,[0]),'V1 START requires an initial script');
for(let kind=0;kind<256;kind++)check([7,8,9].includes(kind),frameV2(kind),'V2 zero-field control kind '+kind);
for(let value=0;value<256;value++) {
 check(value<=15,frameV2(18,0,0,0,[value]),'V2 START mask '+value);
 check(value===3 || value===4,frameV2(4,1,0x34,1,[value]),'V2 real motion wait '+value);
 check(value>=1 && value<=8,frameV2(10,1,0x51,1,[value]),'V2 true wait ACK state '+value);
 check(value===8,frameV2(10,0,0,0,[value]),'V2 global ACK only ABORT '+value);
 check(value>=1 && value<=8,frameV2(10,1,0x41,1,[value]),'V2 asynchronous action error can be ACKed '+value);
 check(false,frameV2(10,1,0x30,1,[value]),'V2 removed device condition has no ACK '+value);
}
for(const bytes of [frameV2(18,1,0,0,[0]),frameV2(18,0,1,0,[0]),frameV2(18,0,0,1,[0]),
 frameV2(18),frameV2(18,0,0,0,[0,0]),frameV2(7,1),frameV2(8,0,1),frameV2(9,0,0,1)])
 check(false,bytes,'V2 exact session shape');
for(const b of valid.filter(b=>b[5]===2)) {
 for(const half of [9,13]) {
  let zero=[...b];for(let i=half;i<half+4;i++)zero=mutate(zero,i,0);
  check(false,zero,'V2 both identity words must be nonzero');
 }
 check(false,mutate(b,5,3),'V2 rejects future wire version');
}

for(const b of valid){
  check(true,b,'valid exact request');
  for(const [index,value] of [[0,0],[1,0x98],[2,0x97],[3,15],[4,0xd4],[5,0],[b.length-1,0]])check(false,mutate(b,index,value),'invalid envelope '+index);
  const checksum=[...b];checksum[checksum.length-2]^=1;check(false,checksum,'bad checksum');
  check(false,b.slice(0,-1),'truncated');check(false,[...b,0],'trailing byte');
  let zero=[...b];for(let i=9;i<17;i++)zero=mutate(zero,i,0);check(false,zero,'zero session');
}
for(let kind=0;kind<256;kind++)check(kind===7||kind===8||kind===9,frame(kind),'zero-field control kind '+kind);
for(let group=0;group<256;group++){
 check(group>=1&&group<=4,frame(4,group,0x42,1),'ACTION group '+group);
 check(group>=1&&group<=4,frame(3,group),'GROUP_OPEN group '+group);
}
for(let value=0;value<256;value++){
 check(value>=1&&value<=15,frame(11,0,0,0,[value]),'COMMIT mask '+value);
 check(value>=1&&value<=15,frame(18,0,0,0,[value]),'START mask '+value);
 check(value>=1&&value<=5,frame(4,1,0x32,1,[value]),'tilt range '+value);
 check(value>=1&&value<=4,frame(4,1,0x34,1,[value]),'motion range '+value);
 check(value<=100,frame(4,1,0x41,1,[value]),'number range '+value);
 check(value>=1&&value<=10,frame(4,1,0x55,1,[value]),'learned slot '+value);
 check(value>=1&&value<=3,frame(4,1,0x13,1,[value]),'power '+value);
 check(value>=1&&value<=8,frame(10,1,0x50,1,[value]),'ACK state '+value);
}
for(const op of [0x10,0x11,0x12,0x13,0x20,0x21,0x22,0x23,0x30,0x32,0x34,0x40,0x41,0x42,0x43,0x50,0x51,0x55]){
 const args=actions.find(a=>a[0]===op)[1];check(false,frame(4,1,op,0,args),'ACTION zero task');
 check(false,frame(4,1,op,1,[...args,0]),'ACTION no padding');
 if(args.length)check(false,frame(4,1,op,1,args.slice(0,-1)),'ACTION short args');
}
for(const [op,args] of [[0x10,[0,0,1,0,0,0]],[0x10,[2,1,1,0,0,0]],[0x10,[0,1,0,0,0,0]],[0x10,[0,1,0,0,0,128]],
 [0x20,[0,1,0,0,0]],[0x20,[5,1,0,0,0]],[0x20,[1,0,0,0,0]],[0x30,[3,0,20]],[0x30,[1,2,20]],[0x30,[1,0,101]]])check(false,frame(4,1,op,1,args),'ACTION bad value');
check(false,frame(4,1,0x52,1,[1]),'learning not a multi action');
check(false,frame(10,0,0,0,[3]),'global ACK only ABORT');check(false,frame(10,1,0,1,[3]),'group ACK needs action opcode');
check(false,[], 'empty');check(false,frame(4,1,0x43,1,Array(24).fill(0)),'oversized matrix');
for(const group of [0,1,4]){
 for(let value=0;value<256;value++){
  check(value<=100,observer(12,group,1,1,[value]),'IR_GT threshold '+value);
  check(value<=100,observer(12,group,2,1,[value]),'IR_LT threshold '+value);
  check(value>=2&&value<=5,observer(12,group,3,1,[value]),'observer tilt '+value);
  check([2,3,5,6].includes(value),observer(15,group,4,1,[value]),'observer state ACK '+value);
 }
 for(const kind of [12,13,14,15]){
  const args=kind===12?[50]:kind===15?[2]:[];
  check(false,observer(kind,group,1,0,args),'observer zero ID');
  check(false,observer(kind,group,0,1,args),'observer zero condition');
  check(false,observer(kind,group,5,1,args),'observer unknown condition');
  check(false,observer(kind,group,1,1,[...args,0]),'observer extra args');
 }
 check(false,observer(12,group,4,1,[0,0,0,128]),'observer TIME outside signed range');
 check(false,observer(12,group,4,1,[0,0,0]),'observer short TIME');
}
check(false,frame(12,0,1,1,[50]),'legacy observer requires SID high word zero');
for(const kind of [12,13,14,15])check(false,observer(kind,5,1,1,kind===12?[50]:kind===15?[2]:[]),'observer group limit');

const cache=path.join(os.homedir(),'.cache/cards-android/jdk-ms');
const homes=[process.env.JAVA_HOME,...(fs.existsSync(cache)?fs.readdirSync(cache).map(n=>path.join(cache,n)):[])].filter(Boolean);
const ext=process.platform==='win32'?'.exe':'';
const jdk=homes.map(home=>({javac:path.join(home,'bin/javac'+ext),java:path.join(home,'bin/java'+ext)})).find(j=>[j.javac,j.java].every(p=>spawnSync(p,['-version'],{encoding:'utf8',windowsHide:true}).status===0));
assert(jdk,'cached JDK required');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xiaobai-multi-native-'));
function run(cmd,args,input){const p=spawnSync(cmd,args,{cwd:root,input,encoding:'utf8',windowsHide:true});if(p.error)throw p.error;assert.equal(p.status,0,p.stdout+'\n'+p.stderr);return p.stdout;}
const plugin=fs.readFileSync(path.join(native,'SparkBlePlugin.java'),'utf8');
const methods=plugin.match(/    private void beginProgramWrite\([\s\S]*?(?=    @PluginMethod public void beginOta\()/)?.[0];
assert(methods,'compile the production C4 writer, callback guard and cancellation methods');
const harness=`package com.cardprogramming.app;
import java.util.*;
public final class MultiProgramNativeTest {
 static int checks; static void check(boolean yes,String name){checks++;if(!yes)throw new AssertionError(name);}
 static final class PluginCall {int resolves,rejects;String reason;void reject(String r){rejects++;reason=r;}void resolve(){resolves++;}}
 static final class SystemClock {static long now;static long elapsedRealtime(){return now;}}
 static final class Handler {
  static final class Entry {Runnable r;long at;Entry(Runnable r,long at){this.r=r;this.at=at;}}
  final List<Entry> tasks=new ArrayList<>();void post(Runnable r){postDelayed(r,0);}void postDelayed(Runnable r,long d){tasks.add(new Entry(r,SystemClock.now+d));}
  void removeCallbacks(Runnable r){tasks.removeIf(t->t.r==r);}
  void advance(long ms){long end=SystemClock.now+ms;int budget=10000;while(true){Entry first=null;for(Entry t:tasks)if(t.at<=end&&(first==null||t.at<first.at))first=t;if(first==null)break;if(--budget==0)throw new AssertionError("pump spun");tasks.remove(first);SystemClock.now=first.at;first.r.run();}SystemClock.now=end;}
 }
 static final class Build {static final class VERSION {static int SDK_INT=33;}}
 static final class BluetoothStatusCodes {static final int SUCCESS=0;}
 static final class BluetoothGattCharacteristic {
  static final int PROPERTY_WRITE=8,WRITE_TYPE_DEFAULT=2,WRITE_TYPE_NO_RESPONSE=1;final UUID uuid=UUID.randomUUID();int properties=8,type;byte[] value;
  int getProperties(){return properties;}UUID getUuid(){return uuid;}void setWriteType(int t){type=t;}void setValue(byte[] b){value=b.clone();}
 }
 final class BluetoothGatt {
  static final int GATT_SUCCESS=0;boolean accepted=true,autoAck=true;int status=0;final List<byte[]> writes=new ArrayList<>();final List<Integer> types=new ArrayList<>();
  int writeCharacteristic(BluetoothGattCharacteristic ch,byte[] b,int type){send(ch,b,type);return accepted?0:1;}
  boolean writeCharacteristic(BluetoothGattCharacteristic ch){send(ch,ch.value,ch.type);return accepted;}
  void send(BluetoothGattCharacteristic ch,byte[] b,int type){if(!accepted)return;writes.add(b.clone());types.add(type);if(autoAck)callback(this,ch,status);}
 }
 static final class Ota {boolean active(){return false;}}
 final Handler main=new Handler();final Ota ota=new Ota();BluetoothGatt gatt=new BluetoothGatt();BluetoothGattCharacteristic writeCharacteristic=new BluetoothGattCharacteristic();
 String connectionId="epoch-a",operation="",profile="xiaobai";long gattGeneration=1,lastNotificationAt=-1000;boolean foreground=true,subscribed=true;int negotiatedMtu=23,closes;String closeReason="";
 PluginCall operationCall;MultiProgramFrame.Transfer programWrite;Runnable programPump;int beginCount;
 void beginOperation(PluginCall call,String name){check(operationCall==null,"one operation owns entire logical frame");beginCount++;operationCall=call;operation=name;}
 void finishOperation(int status){check(status==0,"success only");operationCall.resolve();operationCall=null;operation="";}
 void closeConnection(String reason){closes++;closeReason=reason;cancelProgramWrite();if(operationCall!=null)operationCall.reject(reason);operationCall=null;operation="";gatt=null;}
 void callback(BluetoothGatt source,BluetoothGattCharacteristic ch,int status){MultiProgramFrame.Transfer transfer=programWrite;long token=transfer==null?0:transfer.token();PluginCall call=operationCall;main.post(()->finishProgramChunk(source,ch,status,transfer,token,call));}
${methods}
 static byte[] fromHex(String value){byte[] b=new byte[value.length()/2];for(int i=0;i<b.length;i++)b[i]=(byte)Integer.parseInt(value.substring(i*2,i*2+2),16);return b;}
 static byte[] matrix(){return fromHex("${Buffer.from(frame(4,1,0x43,1,Array.from({length:16},(_,i)=>i*17))).toString('hex')}");}
 static byte[] matrix(int version){
  byte[] b=matrix();b[5]=(byte)version;int sum=0;
  for(int i=0;i<b.length-2;i++)sum+=b[i]&255;b[b.length-2]=(byte)sum;return b;
 }
 static void freshClock(){SystemClock.now=0;Build.VERSION.SDK_INT=33;}
 public static void main(String[] args)throws Exception {
  java.io.BufferedReader input=new java.io.BufferedReader(new java.io.InputStreamReader(System.in));String line;int frames=0;
  while((line=input.readLine())!=null){String[] c=line.split("\\t",-1);check(MultiProgramFrame.valid(fromHex(c[1]))==c[0].equals("accept"),c[2]);frames++;}
  check(!MultiProgramFrame.valid(null),"null frame");
  for(int version:new int[]{1,2})for(int api:new int[]{28,33})for(int properties:new int[]{0,8})for(int mtu:new int[]{23,24,40,247}){
   freshClock();Build.VERSION.SDK_INT=api;MultiProgramNativeTest t=new MultiProgramNativeTest();t.negotiatedMtu=mtu;t.writeCharacteristic.properties=properties;
   PluginCall call=new PluginCall();byte[] bytes=matrix(version);BluetoothGatt source=t.gatt;t.beginProgramWrite(call,bytes);bytes[0]=0; // immutable send copy
   check(call.resolves==0&&t.operationCall==call,"not resolved before any chunk");t.main.advance(0);
   if(mtu==23||mtu==24){check(call.resolves==0&&t.operationCall==call&&source.writes.size()==1,"first chunk retains operation");t.main.advance(39);check(source.writes.size()==1,"40ms guard preserved");}
   t.main.advance(80);check(call.resolves==1&&call.rejects==0&&t.operationCall==null&&t.beginCount==1,"one resolve after complete frame");
   java.io.ByteArrayOutputStream joined=new java.io.ByteArrayOutputStream();for(byte[] chunk:source.writes){check(chunk.length<=mtu-3,"negotiated MTU per chunk");joined.write(chunk);}
   check(Arrays.equals(joined.toByteArray(),matrix(version)),"both protocol versions stay contiguous and exact");
   for(int type:source.types)check(type==(properties==8?2:1),"response and NO_RESPONSE both use callback path");
   t.main.advance(500);check(call.resolves==1&&t.closes==0,"old watchdog cannot close completed transfer");
  }
  freshClock();MultiProgramNativeTest missing=new MultiProgramNativeTest();missing.gatt.autoAck=false;PluginCall missingCall=new PluginCall();missing.beginProgramWrite(missingCall,matrix());missing.main.advance(499);check(missingCall.resolves==0&&missing.closes==0,"no timer-fabricated NO_RESPONSE success");missing.main.advance(1);check(missing.closes==1&&missingCall.rejects==1,"callback timeout closes whole frame");
  freshClock();MultiProgramNativeTest quiet=new MultiProgramNativeTest();PluginCall quietCall=new PluginCall();quiet.beginProgramWrite(quietCall,matrix());quiet.main.advance(0);quiet.lastNotificationAt=20;quiet.main.advance(39);check(quiet.gatt.writes.size()==1,"40ms TX chunk guard retained during RX");quiet.main.advance(1);check(quiet.gatt.writes.size()==2&&quietCall.resolves==1,"RX cannot defer an already-started logical frame");
  freshClock();MultiProgramNativeTest flood=new MultiProgramNativeTest();PluginCall floodCall=new PluginCall();flood.beginProgramWrite(floodCall,matrix());flood.main.advance(0);for(int i=0;i<26;i++){flood.lastNotificationAt=SystemClock.now;flood.main.advance(20);}check(flood.closes==0&&floodCall.rejects==0&&floodCall.resolves==1,"continuous RX completes the whole logical frame without a fake timeout");
  for(int api:new int[]{28,33}){
   freshClock();Build.VERSION.SDK_INT=api;MultiProgramNativeTest firstRx=new MultiProgramNativeTest();PluginCall firstCall=new PluginCall();firstRx.lastNotificationAt=0;firstRx.beginProgramWrite(firstCall,matrix());BluetoothGatt firstSource=firstRx.gatt;firstRx.main.advance(0);check(firstSource.writes.size()==0,"first RX courtesy does not write immediately");
   for(int i=0;i<3;i++){firstRx.lastNotificationAt=SystemClock.now;firstRx.main.advance(10);}check(firstSource.writes.size()==0,"courtesy may yield before its fixed40ms bound");
   firstRx.lastNotificationAt=SystemClock.now;firstRx.main.advance(10);check(firstSource.writes.size()==1&&firstRx.operationCall==firstCall&&firstCall.resolves==0,"continuous RX cannot renew the first40ms courtesy deadline");
   for(int i=0;i<4;i++){firstRx.lastNotificationAt=SystemClock.now;firstRx.main.advance(10);}check(firstSource.writes.size()==2&&firstCall.resolves==1&&firstCall.rejects==0&&firstRx.closes==0,"full immutable frame completes by80ms despite continuous RX");
   java.io.ByteArrayOutputStream joined=new java.io.ByteArrayOutputStream();for(byte[] chunk:firstSource.writes)joined.write(chunk);check(Arrays.equals(joined.toByteArray(),matrix()),"RX courtesy never drops or interleaves frame bytes");
  }
  freshClock();MultiProgramNativeTest courtesyNoCallback=new MultiProgramNativeTest();courtesyNoCallback.gatt.autoAck=false;courtesyNoCallback.lastNotificationAt=0;PluginCall noCallbackCall=new PluginCall();courtesyNoCallback.beginProgramWrite(noCallbackCall,matrix());courtesyNoCallback.main.advance(40);check(courtesyNoCallback.gatt.writes.size()==1&&noCallbackCall.resolves==0,"bounded courtesy does not manufacture a GATT callback");courtesyNoCallback.main.advance(499);check(noCallbackCall.resolves==0&&courtesyNoCallback.closes==0,"original500ms callback budget is not shortened or faked");courtesyNoCallback.main.advance(1);check(courtesyNoCallback.closes==1&&noCallbackCall.rejects==1,"missing callback still closes at exactly500ms from actual dispatch");
  for(int protocolVersion:new int[]{1,2}){
  freshClock();MultiProgramNativeTest stale=new MultiProgramNativeTest();stale.gatt.autoAck=false;PluginCall oldCall=new PluginCall();stale.beginProgramWrite(oldCall,matrix(protocolVersion));stale.main.advance(0);BluetoothGatt oldGatt=stale.gatt;MultiProgramFrame.Transfer oldTransfer=stale.programWrite;long oldToken=oldTransfer.token();Runnable oldPump=stale.programPump;
  stale.closeConnection("cancel");stale.gatt=stale.new BluetoothGatt();stale.gatt.autoAck=false;stale.connectionId="epoch-b";stale.gattGeneration++;PluginCall current=new PluginCall();stale.beginProgramWrite(current,matrix(protocolVersion));stale.main.advance(0);
  oldPump.run();stale.finishProgramChunk(oldGatt,stale.writeCharacteristic,0,oldTransfer,oldToken,oldCall);check(stale.gatt.writes.size()==1&&current.resolves==0&&stale.operationCall==current,"old epoch/pump/callback cannot advance new transfer");
  MultiProgramFrame.Transfer currentTransfer=stale.programWrite;long firstToken=currentTransfer.token();stale.finishProgramChunk(stale.gatt,stale.writeCharacteristic,0,currentTransfer,firstToken,current);stale.main.advance(40);
  stale.finishProgramChunk(stale.gatt,stale.writeCharacteristic,0,currentTransfer,firstToken,current);stale.finishProgramChunk(stale.gatt,stale.writeCharacteristic,133,currentTransfer,firstToken,current);check(current.resolves==0&&stale.closes==1,"old chunk success/failure cannot affect later chunk");stale.finishProgramChunk(stale.gatt,stale.writeCharacteristic,0,currentTransfer,currentTransfer.token(),current);stale.main.advance(0);check(current.resolves==1,"current token completes frame once");
  }
  freshClock();MultiProgramNativeTest background=new MultiProgramNativeTest();PluginCall bgCall=new PluginCall();background.beginProgramWrite(bgCall,matrix());background.main.advance(0);background.foreground=false;background.main.advance(40);check(bgCall.rejects==1&&background.closes==1,"background aborts remaining chunks");
  freshClock();MultiProgramNativeTest reject=new MultiProgramNativeTest();reject.gatt.accepted=false;PluginCall rejected=new PluginCall();reject.beginProgramWrite(rejected,matrix());reject.main.advance(0);check(rejected.rejects==1&&reject.closes==1,"GATT rejection closes frame");
  freshClock();MultiProgramNativeTest fail=new MultiProgramNativeTest();fail.gatt.status=133;PluginCall failed=new PluginCall();fail.beginProgramWrite(failed,matrix());fail.main.advance(0);check(failed.rejects==1&&fail.closes==1,"GATT callback failure closes frame");
  System.out.println("Production C4 native gate: "+frames+" frame cases; production MTU pump/callback/lifecycle: "+checks+" assertions passed.");
 }
}
`;
try {
 const file=path.join(temp,'MultiProgramNativeTest.java');fs.writeFileSync(file,harness);
 run(jdk.javac,['-encoding','UTF-8','-d',temp,multiProgramSource,file]);
 process.stdout.write(run(jdk.java,['-cp',temp,'com.cardprogramming.app.MultiProgramNativeTest'],cases.join('\n')+'\n'));
 assert(plugin.includes('boolean multi=profile.equals("xiaobai") && MultiProgramFrame.valid(bytes)'),'only xiaobai profile gains C4');
 assert(plugin.includes('if(multi) {beginProgramWrite(call,bytes);return;}'),'real native.write uses tested pump');
 assert(plugin.includes('if(programWrite!=null) {closeConnection(reason);return;}'),'disconnect/background cannot continue fragments');
 assert(plugin.includes('final MultiProgramFrame.Transfer transfer=programWrite')&&plugin.includes('final long chunkToken=transfer==null?0:transfer.token();final PluginCall call=operationCall'),'callbacks capture ownership before main.post');
 assert(/cancelProgramWrite\(\);\r?\n\s+if\(otaPump/.test(plugin), 'real close cancels the program pump before retiring GATT');
 console.log('Native C4 profile/OTA/single-operation/close integration checked; hardware GATT delivery remains unvalidated.');
} finally {
 const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('xiaobai-multi-native-'));fs.rmSync(target,{recursive:true,force:true});
}
