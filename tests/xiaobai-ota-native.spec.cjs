const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const firmware=process.env.XIAOBAI_FIRMWARE_ROOT||path.resolve(root,'../../../5月/小白机器人/LBS-XIAOBAI-AI');
const local=path.join(__dirname,'fixtures/py32-ota-vectors.json');
const fixture=fs.existsSync(local)?local:path.join(firmware,'tests/ota_vectors.json');
const vectors=JSON.parse(fs.readFileSync(fixture,'utf8'));
const contractSync=require('../scripts/sync-ota-contract.cjs');
const snapshot=require('../xiaobai-ota-protocol.js').C;
const nativeLayout=fs.readFileSync(path.join(root,'android/app/src/main/java/com/cardprogramming/app/OtaLayout.java'),'utf8');
assert.equal(nativeLayout,contractSync.javaSource(snapshot),'every generated native constant equals the JS firmware-contract snapshot');
const actualMacros=Object.fromEntries([...nativeLayout.matchAll(/static final (?:int|long) (OTA_\w+)=0x([a-f0-9]+)L?;/g)].map(m=>[m[1],parseInt(m[2],16)]));
assert.deepEqual(actualMacros,snapshot,'all native protocol constants are present without omissions');
if(fs.existsSync(path.join(firmware,'Shared/Ota_Layout.h')))assert.equal(nativeLayout,contractSync.generatedJava(firmware),'all native constants match the authoritative C header');

const cache=path.join(os.homedir(),'.cache/cards-android/jdk-ms');
const homes=[process.env.JAVA_HOME,...(fs.existsSync(cache)?fs.readdirSync(cache).map(n=>path.join(cache,n)):[])].filter(Boolean);
const ext=process.platform==='win32'?'.exe':'';
const jdks=homes.map(home=>({javac:path.join(home,'bin/javac'+ext),java:path.join(home,'bin/java'+ext)}));
jdks.push({javac:'javac'+ext,java:'java'+ext});
const jdk=jdks.find(d=>[d.javac,d.java].every(cmd=>spawnSync(cmd,['-version'],{encoding:'utf8',windowsHide:true}).status===0));
assert(jdk,'JDK required for the production native transport tests');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xiaobai-ota-native-'));
function run(cmd,args,input){const r=spawnSync(cmd,args,{cwd:root,input,encoding:'utf8',windowsHide:true});if(r.error)throw r.error;assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;}
try{
  run(jdk.javac,['-encoding','UTF-8','-d',temp,path.join(root,'android/app/src/main/java/com/cardprogramming/app/OtaLayout.java'),path.join(root,'android/app/src/main/java/com/cardprogramming/app/OtaTransport.java'),path.join(__dirname,'OtaTransportTest.java')]);
  const input=vectors.frames.map(f=>[f.valid_frame?'valid':'invalid',f.frame_hex,f.name].join('\t')).join('\n')+'\n';
  process.stdout.write(run(jdk.java,['-cp',temp,'com.cardprogramming.app.OtaTransportTest'],input));
  // Integration ownership checks pin the actual bridge using the tested implementation.
  const plugin=fs.readFileSync(path.join(root,'android/app/src/main/java/com/cardprogramming/app/SparkBlePlugin.java'),'utf8');
  // Execute the production close handler, including Capacitor's error-code boundary.
  // An in-flight write must report a closed transport even if its Promise rejects
  // before the JS disconnected event is delivered.
  const closeMethod=plugin.match(/    private void closeConnection\(String reason\) \{[\s\S]*?(?=\r?\n    private void receive\()/)?.[0];
  assert(closeMethod,'production native close handler is present');
  const disconnectHarness=`package com.cardprogramming.app;
import java.util.*;
public final class NativeDisconnectTest {
  static final class PluginCall {
    String reason,code;
    void reject(String value) {reject(value,null);}
    void reject(String value,String errorCode) {reason=value;code=errorCode;}
  }
  static final class JSObject extends HashMap<String,Object> {}
  static final class Handler {void removeCallbacks(Object value) {}}
  static final class Ota {boolean closed;void close(){closed=true;}}
  static final class UploadGate {void reset(){}}
  static final class BluetoothGatt {boolean disconnected,closed;void disconnect(){disconnected=true;}void close(){closed=true;}}
  final Handler main=new Handler();final Ota ota=new Ota();final UploadGate uploadGate=new UploadGate();
  Object otaPump=new Object(),connectTimeout=new Object(),operationTimeout=new Object();
  byte[][] otaChunks=new byte[][]{{1}};int otaChunkIndex=1,negotiatedMtu=247;
  String closingReason="closing",connectionId="old-epoch",deviceId="AA:BB:CC:DD:EE:FF",connectionName="bound",connectionNameObservation="scan",operation="otaWrite";
  long connectionNameObservedAt=1;boolean remoteUsed=true,subscribed=true;
  BluetoothGatt gatt=new BluetoothGatt();Object characteristic=new Object(),writeCharacteristic=new Object(),fallbackCharacteristic=new Object();
  PluginCall connectCall=new PluginCall(),operationCall=new PluginCall();
  int disconnectEvents;JSObject lastEvent;
  void notifyListeners(String name,JSObject event){check(name.equals("disconnected"),"event type");disconnectEvents++;lastEvent=event;}
  static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
${closeMethod}
  public static void main(String[] args){
    NativeDisconnectTest bridge=new NativeDisconnectTest();
    PluginCall connect=bridge.connectCall,write=bridge.operationCall;BluetoothGatt previous=bridge.gatt;
    String reason="GATT 19 during OTA INFO";bridge.closeConnection(reason);
    check("DISCONNECTED".equals(write.code),"closed native write must reject with DISCONNECTED, got "+write.code);
    check("DISCONNECTED".equals(connect.code),"closed native connect must reject with DISCONNECTED");
    check(reason.equals(write.reason)&&reason.equals(connect.reason),"native diagnostic reason is preserved");
    check(bridge.gatt==null&&bridge.connectionId.isEmpty()&&bridge.operationCall==null&&bridge.connectCall==null,"closed operation cannot survive");
    check(bridge.otaPump==null&&bridge.otaChunks==null&&bridge.ota.closed&&previous.disconnected&&previous.closed,"fragments and GATT are closed");
    check(bridge.disconnectEvents==1&&"old-epoch".equals(bridge.lastEvent.get("connectionId"))&&reason.equals(bridge.lastEvent.get("reason")),"native event preserves the closed epoch");
    bridge.closeConnection("late close");check(bridge.disconnectEvents==1,"empty epoch does not duplicate disconnect event");
    System.out.println("Production native close handler rejects in-flight calls with DISCONNECTED and preserves reason/epoch.");
  }
}`;
  const harnessFile=path.join(temp,'NativeDisconnectTest.java');fs.writeFileSync(harnessFile,disconnectHarness);
  run(jdk.javac,['-encoding','UTF-8','-d',temp,harnessFile]);
  process.stdout.write(run(jdk.java,['-cp',temp,'com.cardprogramming.app.NativeDisconnectTest']));
  for(const name of ['beginOta','writeOta','endOta'])assert(plugin.includes('@PluginMethod public void '+name+'(PluginCall call)'),name+' is exposed by production Capacitor plugin');
  assert(plugin.includes('ota.prepare(')&&plugin.includes('ota.receive(')&&plugin.includes('ota.delay('),'production GATT path uses tested framing, parser and pacing');
  assert(plugin.includes('if(ota.active()) {call.reject("固件升级期间不能发送普通控制指令。"'),'ordinary GATT writes locked out');
  assert(plugin.includes('if(ota.active()) {call.reject("固件升级期间请先结束当前升级。"'), 'ordinary connection replacement is locked during raw OTA');
  assert(plugin.includes('beginOperation(call,"otaWrite")')&&plugin.includes('main.postDelayed(operationTimeout,5000)')&&plugin.includes('pendingOperation.reject(reason,"DISCONNECTED")'), 'raw GATT write promise has a native bounded failure path');
  assert(plugin.includes('if(expected!=gatt||!epoch.equals(connectionId)'),'scheduled chunks cannot cross connection epoch');
  assert(plugin.includes('ota.active() || !remoteUsed'),'background/disconnect never sends ordinary release frame into Boot');
  assert(plugin.includes('main.removeCallbacks(otaPump)')&&plugin.includes('ota.close()'),'close cancels queued native fragments');
  assert(plugin.includes('notifyListeners("otaNotification",event)'),'matched raw response reaches JS');
  assert(plugin.includes('BluetoothAdapter.checkBluetoothAddress(id)')&&plugin.includes('call.getBoolean("boundDevice",false)'),'recovery explicitly uses bound address');
  console.log('Native bridge API/exclusivity/epoch wiring checks passed; real Android GATT callbacks remain for hardware test.');
}finally{const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('xiaobai-ota-native-'));fs.rmSync(target,{recursive:true,force:true});}
