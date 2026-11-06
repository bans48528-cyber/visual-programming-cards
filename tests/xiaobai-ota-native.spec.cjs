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
  // Compile the exact production close/queue/state handlers against deterministic
  // platform stubs. The native disconnect Promise must represent the real boundary.
  const closeMethod=plugin.match(/    private void closeConnection\(String reason\)[\s\S]*?(?=\r?\n    private void receive\()/)?.[0];
  const requestMethod=plugin.match(/    private void requestConnect\(PluginCall call\) \{[\s\S]*?(?=\r?\n    private void connectNow\()/)?.[0];
  const disconnectMethod=plugin.match(/    private void disconnectRequested\(PluginCall call\) \{[\s\S]*?(?=\r?\n    private void releaseAndClose\()/)?.[0];
  const aclTransportMethod=plugin.match(/    private static boolean acceptsAclTransport\(Intent intent\) \{[\s\S]*?\n    \}/)?.[0];
  const operationMethod=plugin.match(/    private void beginOperation\(PluginCall call,String name\) \{[\s\S]*?(?=\r?\n    private void finishOperation\()/)?.[0];
  const connectTimer=plugin.match(/            final BluetoothGatt expected=gatt;final String epoch=connectionId;\r?\n            connectTimeout=\(\)->\{[\s\S]*?main.postDelayed\(connectTimeout,15000\);/)?.[0];
  const releaseTimer=plugin.match(/        final BluetoothGatt expected=gatt;final String epoch=connectionId;\r?\n        operationTimeout=\(\)->\{\r?\n            if\(gatt==expected&&epoch.equals\(connectionId\)&&operation.equals\("release"\)\)[\s\S]*?main.postDelayed\(operationTimeout,1000\);/)?.[0];
  assert(closeMethod&&requestMethod&&disconnectMethod&&operationMethod&&connectTimer&&releaseTimer&&aclTransportMethod,'actual physical close/queue/disconnect/timer handlers are present');
  const disconnectHarness=`package com.cardprogramming.app;
import java.util.*;
public final class NativeDisconnectTest {
  static final class PluginCall {
    String reason,code,id,deviceId="AA:BB:CC:DD:EE:FF",profile="xiaobai";int resolves,rejects;
    final Map<String,String> values=new HashMap<>();
    PluginCall(String id){this.id=id;}
    String getString(String key,String fallback){if(key.equals("connectionId"))return id==null?fallback:id;if(key.equals("deviceId"))return deviceId;if(key.equals("profile"))return profile;return values.getOrDefault(key,fallback);}
    boolean getBoolean(String key,boolean fallback){return fallback;}
    int getInt(String key,int fallback){return fallback;}
    void resolve(){resolves++;}
    void reject(String value){reject(value,null);}
    void reject(String value,String errorCode){reason=value;code=errorCode;rejects++;}
  }
  static final class JSObject extends HashMap<String,Object>{}
  static final class Handler {
    final Map<Runnable,Long> tasks=new LinkedHashMap<>();
    void removeCallbacks(Runnable value){tasks.remove(value);}
    void postDelayed(Runnable value,long ms){tasks.put(value,ms);}
    void advance(long ms){for(Map.Entry<Runnable,Long> task:new ArrayList<>(tasks.entrySet()))if(task.getValue()<=ms&&tasks.remove(task.getKey())!=null)task.getKey().run();}
  }
  static final class Ota {boolean closed;boolean active(){return false;}void close(){closed=true;}}
  static final class UploadGate {void reset(){}}
  static final class BluetoothGatt {
    static final int GATT_SUCCESS=0;int disconnects,closes;
    void disconnect(){disconnects++;}void close(){closes++;}boolean discoverServices(){return true;}
  }
  static final class BluetoothProfile {static final int STATE_DISCONNECTED=0,STATE_CONNECTED=2;}
  static final class BluetoothDevice {static final String EXTRA_TRANSPORT="transport";static final int TRANSPORT_AUTO=0,TRANSPORT_BREDR=1,TRANSPORT_LE=2;}
  static final class Intent {final Map<String,Integer> extras=new HashMap<>();boolean hasExtra(String k){return extras.containsKey(k);}int getIntExtra(String k,int d){return extras.getOrDefault(k,d);}}
  static final class Log {static int i(String tag,String message){return 0;}}
  static final class SystemClock {static long elapsedRealtime(){return 0;}}
  static final class BluetoothAdapter {static boolean checkBluetoothAddress(String s){return s!=null&&s.matches("([A-F0-9]{2}:){5}[A-F0-9]{2}");}BluetoothDevice getRemoteDevice(String id){return new BluetoothDevice();}}
  static final class Tc01Frame {static boolean validEnding(String s){return s.equals("lf");}}
  static final UUID SERVICE=UUID.randomUUID(),CHARACTERISTIC=UUID.randomUUID(),WRITE_CHARACTERISTIC=UUID.randomUUID();
  final Map<String,BluetoothDevice> found=new HashMap<>();final BluetoothAdapter adapter=new BluetoothAdapter();
  NativeDisconnectTest(){found.put("AA:BB:CC:DD:EE:FF",new BluetoothDevice());}
  final Handler main=new Handler();final Ota ota=new Ota();final UploadGate uploadGate=new UploadGate();
  Runnable otaPump=()->{},connectTimeout=()->{},operationTimeout=()->{};
  byte[][] otaChunks=new byte[][]{{1}};int otaChunkIndex=1,negotiatedMtu=247;
  String closingReason="",connectionId="old-epoch",deviceId="AA:BB:CC:DD:EE:FF",connectionName="bound",connectionNameObservation="scan",operation="otaWrite";
  long connectionNameObservedAt=1;boolean remoteUsed=true,subscribed=true,foreground=true,radioOn=true;
  BluetoothGatt gatt=new BluetoothGatt(),closingGatt;
  String closingEpoch="",closingDeviceId="";long gattGeneration=1,closingGeneration=0;boolean closingTimedOut=false,closingClientClosed=false,closingAclDisconnected=false;Runnable disconnectTimeout;
  PluginCall queuedConnect;final List<PluginCall> disconnectCalls=new ArrayList<>();
  static final long DISCONNECT_TIMEOUT_MS=5000;
  Object characteristic=new Object(),writeCharacteristic=new Object(),fallbackCharacteristic=new Object();
  PluginCall connectCall=new PluginCall("old-epoch"),operationCall=new PluginCall("old-epoch");
  int disconnectEvents,connectStarts;JSObject lastEvent;
  void notifyListeners(String name,JSObject event){check(name.equals("disconnected"),"event type");disconnectEvents++;lastEvent=event;}
  boolean ready(PluginCall call,boolean scan){if(!foreground){call.reject("background","CANCELLED");return false;}if(!radioOn){call.reject("off","BLUETOOTH_OFF");return false;}return true;}
  void connectNow(PluginCall call){connectStarts++;connectionId=call.id;deviceId=call.deviceId;gattGeneration++;gatt=new BluetoothGatt();}
  void releaseAndClose(String reason){closeConnection(reason);}
  static void check(boolean v,String m){if(!v)throw new AssertionError(m);}
${aclTransportMethod}
${requestMethod}
${disconnectMethod}
${operationMethod}
  void scheduleConnectTimeout(PluginCall call){${connectTimer}}
  void scheduleReleaseTimeout(String reason){${releaseTimer}}
${closeMethod}
  public static void main(String[] args){
    NativeDisconnectTest a=new NativeDisconnectTest();BluetoothGatt old=a.gatt;
    PluginCall op=a.operationCall,conn=a.connectCall,d=new PluginCall("old-epoch");
    a.disconnectRequested(d);
    check(d.resolves==0&&d.rejects==0,"disconnect Promise must wait for physical callback");
    check(old.disconnects==1&&old.closes==0&&a.closingGatt==old&&a.gatt==null,"retire without closing early");
    check("DISCONNECTED".equals(op.code)&&"DISCONNECTED".equals(conn.code),"closed pending operations preserve typed loss");
    check(a.ota.closed&&a.otaChunks==null&&a.operationCall==null,"logical send pipeline stops immediately");
    check(a.disconnectEvents==1&&"old-epoch".equals(a.lastEvent.get("connectionId")),"logical event retains old epoch once");
    PluginCall next=new PluginCall("new-epoch");a.requestConnect(next);
    check(a.connectStarts==0&&a.queuedConnect==next,"new GATT cannot race retired ACL");
    PluginCall duplicate=new PluginCall("third");a.requestConnect(duplicate);check("BUSY".equals(duplicate.code),"only one queued connect");
    Runnable retiredTimeout=a.disconnectTimeout;
    a.handleConnectionStateChange(old,0,BluetoothProfile.STATE_CONNECTED);check(a.connectStarts==0,"connected callback is not disconnect proof");
    a.handleConnectionStateChange(old,0,BluetoothProfile.STATE_DISCONNECTED);
    check(d.resolves==0&&a.connectStarts==0&&a.closingGatt==old&&old.closes==1,"client callback must not stand in for ACL");
    a.handleAclDisconnected(old,"old-epoch",1,"DIFFERENT-MAC");check(a.connectStarts==0,"different MAC ACL cannot release queue");
    a.handleAclDisconnected(old,"old-epoch",0,"AA:BB:CC:DD:EE:FF");check(a.connectStarts==0,"old captured generation cannot release queue");
    a.handleAclDisconnected(old,"old-epoch",1,"AA:BB:CC:DD:EE:FF");
    check(d.resolves==1&&old.closes==1&&a.connectStarts==1&&"new-epoch".equals(a.connectionId),"actual disconnect closes old then releases new");
    BluetoothGatt fresh=a.gatt;retiredTimeout.run();a.handleConnectionStateChange(old,22,0);
    a.disconnectRequested(new PluginCall("old-epoch"));a.handleAclDisconnected(old,"old-epoch",1,"AA:BB:CC:DD:EE:FF");
    check(a.gatt==fresh&&fresh.closes==0&&fresh.disconnects==0&&a.connectStarts==1,"old timer/callback/cleanup cannot affect new epoch");
    NativeDisconnectTest b=new NativeDisconnectTest();BluetoothGatt stuck=b.gatt;
    PluginCall bd=new PluginCall("old-epoch"),bn=new PluginCall("new");b.disconnectRequested(bd);b.requestConnect(bn);b.main.advance(5000);
    check("DISCONNECT_TIMEOUT".equals(bd.code)&&"DISCONNECT_TIMEOUT".equals(bn.code),"bounded close failure rejects both waiters");
    check(b.connectStarts==0&&b.closingGatt==stuck&&stuck.closes==0,"timeout does not invent a physical boundary");
    PluginCall retry=new PluginCall("retry");b.requestConnect(retry);check("DISCONNECT_TIMEOUT".equals(retry.code),"uncertain link remains blocked");
    b.handleConnectionStateChange(stuck,0,0);check(b.connectStarts==0&&b.closingGatt==stuck,"late client callback is still not ACL proof");
    b.handleAclDisconnected(stuck,"old-epoch",1,"AA:BB:CC:DD:EE:FF");check(b.connectStarts==0,"late real ACL must not revive failed queue");
    b.requestConnect(new PluginCall("explicit-retry"));check(b.connectStarts==1,"new explicit request works after actual late boundary");
    NativeDisconnectTest c=new NativeDisconnectTest();BluetoothGatt cold=c.gatt;c.disconnectRequested(new PluginCall("old-epoch"));
    PluginCall cn=new PluginCall("cancel-me"),cancel=new PluginCall("cancel-me");c.requestConnect(cn);c.disconnectRequested(cancel);
    check("CANCELLED".equals(cn.code)&&cancel.resolves==1,"explicit queued cancellation settles exactly that task");
    c.handleConnectionStateChange(cold,0,0);c.handleAclDisconnected(cold,"old-epoch",1,"AA:BB:CC:DD:EE:FF");check(c.connectStarts==0,"cancelled queued connect never starts");
    for(boolean radio:new boolean[]{true,false}){
      NativeDisconnectTest x=new NativeDisconnectTest();BluetoothGatt retired=x.gatt;x.disconnectRequested(new PluginCall("old-epoch"));
      PluginCall q=new PluginCall("new");x.requestConnect(q);x.foreground=!radio;x.radioOn=radio;x.handleConnectionStateChange(retired,0,0);x.handleAclDisconnected(retired,"old-epoch",1,"AA:BB:CC:DD:EE:FF");
      check(x.connectStarts==0&&q.rejects==1,"foreground/radio rechecked immediately before connect");
    }
    NativeDisconnectTest e=new NativeDisconnectTest();BluetoothGatt lost=e.gatt;e.handleConnectionStateChange(lost,22,0);
    check(lost.disconnects==0&&lost.closes==1&&e.closingGatt==lost,"client loss closes resources but waits for actual ACL");
    e.handleAclDisconnected(lost,"old-epoch",1,"AA:BB:CC:DD:EE:FF");check(e.closingGatt==null&&lost.closes==1,"subsequent ACL completes once");
    NativeDisconnectTest f=new NativeDisconnectTest();BluetoothGatt replaced=f.gatt;f.requestConnect(new PluginCall("replace"));
    check(f.connectStarts==0&&f.closingGatt==replaced,"direct connection replacement also uses physical boundary");f.handleConnectionStateChange(replaced,0,0);f.handleAclDisconnected(replaced,"old-epoch",1,"AA:BB:CC:DD:EE:FF");check(f.connectStarts==1,"replacement starts once");
    for(int invalidKind:new int[]{0,1,2}){
      NativeDisconnectTest invalid=new NativeDisconnectTest();BluetoothGatt live=invalid.gatt;
      PluginCall bad=new PluginCall("invalid");
      if(invalidKind==0)bad.profile="not-a-profile";
      else if(invalidKind==1){bad.profile="tc01";bad.values.put("serviceUuid","invalid-uuid");}
      else bad.deviceId="EXPIRED-CANDIDATE";
      invalid.requestConnect(bad);
      check(bad.rejects==1&&invalid.gatt==live&&live.disconnects==0&&live.closes==0&&invalid.queuedConnect==null,"invalid/expired request does not disturb valid current GATT");
    }
    NativeDisconnectTest expiry=new NativeDisconnectTest();BluetoothGatt expires=expiry.gatt;PluginCall expired=new PluginCall("expires-while-queued");
    expiry.disconnectRequested(new PluginCall("old-epoch"));expiry.requestConnect(expired);expiry.found.clear();expiry.handleConnectionStateChange(expires,0,0);expiry.handleAclDisconnected(expires,"old-epoch",1,"AA:BB:CC:DD:EE:FF");
    check(expired.rejects==1&&expiry.connectStarts==0,"queued device is validated again at actual disconnect boundary");
    for(int timerKind:new int[]{0,1,2}){
      NativeDisconnectTest t=new NativeDisconnectTest();BluetoothGatt retired=t.gatt;
      if(timerKind==0)t.scheduleConnectTimeout(t.connectCall);
      else if(timerKind==1)t.beginOperation(t.operationCall,"otaWrite");
      else{t.operation="release";t.scheduleReleaseTimeout("release");}
      Runnable stale=timerKind==0?t.connectTimeout:t.operationTimeout;
      t.closeConnection("old closing");t.requestConnect(new PluginCall("timer-new"));t.handleConnectionStateChange(retired,0,0);t.handleAclDisconnected(retired,"old-epoch",1,"AA:BB:CC:DD:EE:FF");
      BluetoothGatt active=t.gatt;stale.run();
      check(t.gatt==active&&active.disconnects==0&&active.closes==0,"old connect/write/release Runnable must not affect fresh epoch");
    }
    NativeDisconnectTest opSame=new NativeDisconnectTest();opSame.beginOperation(opSame.operationCall,"otaWrite");Runnable oldCallTimer=opSame.operationTimeout;
    PluginCall newerCall=new PluginCall("old-epoch");opSame.beginOperation(newerCall,"otaWrite");oldCallTimer.run();check(opSame.gatt!=null,"old operation timer must also be fenced by PluginCall within same epoch");
    NativeDisconnectTest aclFirst=new NativeDisconnectTest();BluetoothGatt beforeClient=aclFirst.gatt;
    PluginCall aclWait=new PluginCall("old-epoch");aclFirst.disconnectRequested(aclWait);aclFirst.requestConnect(new PluginCall("acl-first"));
    aclFirst.handleAclDisconnected(beforeClient,"old-epoch",1,"AA:BB:CC:DD:EE:FF");
    check(aclWait.resolves==1&&aclFirst.connectStarts==1&&beforeClient.closes==1,"ACL first settles old client without waiting for another ACL");
    BluetoothGatt afterAcl=aclFirst.gatt;aclFirst.handleConnectionStateChange(beforeClient,22,0);check(aclFirst.gatt==afterAcl,"late old client callback after ACL cannot hurt new GATT");
    NativeDisconnectTest activeAcl=new NativeDisconnectTest();BluetoothGatt activeSource=activeAcl.gatt;activeAcl.handleAclDisconnected(activeSource,"old-epoch",1,"AA:BB:CC:DD:EE:FF");
    check(activeAcl.gatt==null&&activeAcl.closingGatt==null&&activeSource.closes==1,"ACL before active client callback is consumed for that captured source");
    NativeDisconnectTest off=new NativeDisconnectTest();BluetoothGatt offOld=off.gatt;off.disconnectRequested(new PluginCall("old-epoch"));PluginCall offQueued=new PluginCall("off-queue");off.requestConnect(offQueued);off.cancelQueuedConnect("off","BLUETOOTH_OFF");off.closingAclDisconnected=true;off.completeGattClose(offOld);check(off.connectStarts==0&&"BLUETOOTH_OFF".equals(offQueued.code),"actual radio OFF settles close without starting cancelled queue");
    Intent missing=new Intent();check(acceptsAclTransport(missing),"legacy Android9 missing transport must be accepted");
    Intent le=new Intent();le.extras.put("transport",2);check(acceptsAclTransport(le),"explicit LE ACL accepted");
    Intent classic=new Intent();classic.extras.put("transport",1);check(!acceptsAclTransport(classic),"explicit BR/EDR ignored");
    System.out.println("Production native actual ACL barrier: client-first/ACL-first, legacy broadcast, generation, queue, timeout, cancel and stale timer checks passed.");
  }
}`;
  // RED control replays the previous production disconnect/close semantics:
  // the Promise resolves immediately and the old GATT closes before its callback.
  const legacyMethod=`    private void disconnectRequested(PluginCall call) {
        String expected=call.getString("connectionId",connectionId);
        if(expected.equals(connectionId))releaseAndClose("已断开连接");
        call.resolve();
    }`;
  const legacyHarness=disconnectHarness.replace(disconnectMethod,legacyMethod).replace(
    'if(previous!=null)beginGattClose(previous,ticket,address,generation,clientDisconnected,aclDisconnected);',
    'if(previous!=null){try {previous.disconnect();}catch(Exception ignored){} try {previous.close();}catch(Exception ignored){}}');
  assert.notEqual(legacyHarness,disconnectHarness,'RED control really restores legacy closure behavior');
  const redFolder=path.join(temp,'legacy-red');fs.mkdirSync(redFolder);
  const redSource=path.join(redFolder,'NativeDisconnectTest.java');fs.writeFileSync(redSource,legacyHarness);
  run(jdk.javac,['-encoding','UTF-8','-d',redFolder,redSource]);
  const red=spawnSync(jdk.java,['-cp',redFolder,'com.cardprogramming.app.NativeDisconnectTest'],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.notEqual(red.status,0,'legacy immediate close must fail the physical boundary regression');
  assert((red.stdout+red.stderr).includes('disconnect Promise must wait for physical callback'),'RED fails at the reported bug, not an unrelated compilation error');
  console.log('RED confirmed: legacy immediate-close Promise violates the actual-disconnect boundary.');
  const clientOnlyHarness=disconnectHarness.replace('traceGattClose("clientDown",closingEpoch,closingDeviceId);closeRetiredClient(source);','traceGattClose("clientDown",closingEpoch,closingDeviceId);closingAclDisconnected=true;completeGattClose(source);');
  assert.notEqual(clientOnlyHarness,disconnectHarness,'client-only RED control changes its actual release boundary');
  fs.writeFileSync(redSource,clientOnlyHarness);run(jdk.javac,['-encoding','UTF-8','-d',redFolder,redSource]);
  const clientRed=spawnSync(jdk.java,['-cp',redFolder,'com.cardprogramming.app.NativeDisconnectTest'],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.notEqual(clientRed.status,0,'client-only state callback must fail actual ACL regression');
  assert((clientRed.stdout+clientRed.stderr).includes('client callback must not stand in for ACL'),'client-only RED fails at confirmed physical-boundary bug');
  console.log('RED confirmed: client STATE_DISCONNECTED alone releases too early.');
  const harnessFile=path.join(temp,'NativeDisconnectTest.java');fs.writeFileSync(harnessFile,disconnectHarness);
  run(jdk.javac,['-encoding','UTF-8','-d',temp,harnessFile]);
  process.stdout.write(run(jdk.java,['-cp',temp,'com.cardprogramming.app.NativeDisconnectTest']));
  assert(plugin.includes('filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)')&&plugin.includes('radioReceiver,filter,ContextCompat.RECEIVER_EXPORTED'),'system ACL broadcast remains registered exported');
  assert(plugin.includes('final long generation=closingGatt!=null?closingGeneration:gattGeneration')&&plugin.includes('main.post(()->handleAclDisconnected(expected,epoch,generation,address))'),'receiver captures context before asynchronous dispatch');
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
