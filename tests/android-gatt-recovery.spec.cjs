'use strict';
// Compile the actual shipping native connection/close methods against deterministic
// Android platform doubles. No radio, Android package, device, or firmware is used.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(process.env.CARD_APP_ROOT||path.resolve(__dirname,'..'));
const source=path.resolve(process.env.CARD_NATIVE_PLUGIN||path.join(root,'android/app/src/main/java/com/cardprogramming/app/SparkBlePlugin.java'));
const plugin=fs.readFileSync(source,'utf8');
function range(first,last){const a=plugin.indexOf(first),b=plugin.indexOf(last,a);assert(a>=0&&b>a,'production region: '+first);return plugin.slice(a,b);}
function member(first){
  const a=plugin.indexOf(first);assert(a>=0,'production member: '+first);
  const begin=plugin.indexOf('{',a);let depth=0,quote=null,escape=false,line=false,comment=false;
  for(let i=begin;i<plugin.length;i++){
    const c=plugin[i],n=plugin[i+1];
    if(line){if(c==='\n')line=false;continue;}
    if(comment){if(c==='*'&&n==='/'){comment=false;i++;}continue;}
    if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}if(c==='/'&&n==='*'){comment=true;i++;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='{')depth++;else if(c==='}'&&!--depth)return plugin.slice(a,i+1);
  }
  throw Error('unterminated production member: '+first);
}
const extracted={
  radio:member('    private final BroadcastReceiver radioReceiver='),
  aclTransport:member('    private static boolean acceptsAclTransport('),
  connect:range('    private void requestConnect(PluginCall call) {','    private boolean matches('),
  disconnect:member('    private void disconnectRequested('),
  release:member('    private void releaseAndClose('),
  close:range('    private void closeConnection(String reason)','    private void receive('),
  operation:member('    private void beginOperation('),
  stop:member('    @Override protected void handleOnStop()').replace('@Override protected','private')
};
const java=String.raw`package com.cardprogramming.app;
import java.util.*;
public final class NativeGattRecoveryTest {
  static final String ADDRESS="AA:BB:CC:DD:EE:FF",OTHER="11:22:33:44:55:66";
  static final class PluginCall {
    final String id;String deviceId=ADDRESS,profile="xiaobai",reason,code;int resolves,rejects;JSObject result;
    final Map<String,String> values=new HashMap<>();
    PluginCall(String id){this.id=id;}
    String getString(String key,String fallback){if(key.equals("connectionId"))return id==null?fallback:id;if(key.equals("deviceId"))return deviceId;if(key.equals("profile"))return profile;return values.getOrDefault(key,fallback);}
    boolean getBoolean(String key,boolean fallback){return fallback;}int getInt(String key,int fallback){return fallback;}
    void resolve(){resolves++;}void resolve(JSObject value){result=value;resolves++;}
    void reject(String value){reject(value,null);}void reject(String value,String valueCode){reason=value;code=valueCode;rejects++;}
  }
  static final class JSObject extends HashMap<String,Object>{}
  static final class Handler {
    long now;final Map<Runnable,Long> tasks=new LinkedHashMap<>();
    void post(Runnable r){postDelayed(r,0);}void postDelayed(Runnable r,long ms){tasks.put(r,now+ms);}void removeCallbacks(Runnable r){tasks.remove(r);}
    void advance(long ms){long until=now+ms;while(true){Map.Entry<Runnable,Long> next=null;for(Map.Entry<Runnable,Long> e:tasks.entrySet())if(e.getValue()<=until&&(next==null||e.getValue()<next.getValue()))next=e;
      if(next==null)break;Runnable r=next.getKey();now=next.getValue();tasks.remove(r);r.run();}now=until;}
  }
  static final class Ota {boolean running,closed;int closes;boolean active(){return running;}void close(){closed=true;running=false;closes++;}}
  static final class UploadGate {int resets;void reset(){resets++;}}
  static final class BluetoothGatt {
    static final int GATT_SUCCESS=0;int disconnects,closes,writes;boolean failDisconnect,failClose;
    void disconnect(){disconnects++;if(failDisconnect)throw new IllegalStateException("no callback");}
    void close(){closes++;if(failClose)throw new IllegalStateException("platform close error");}
    boolean discoverServices(){return true;}int writeCharacteristic(BluetoothGattCharacteristic c,byte[] bytes,int kind){writes++;return 0;}
    boolean writeCharacteristic(BluetoothGattCharacteristic c){writes++;return true;}
  }
  static final class BluetoothGattCharacteristic {
    static final int PROPERTY_WRITE=8,WRITE_TYPE_DEFAULT=2,WRITE_TYPE_NO_RESPONSE=1;
    int getProperties(){return PROPERTY_WRITE;}void setWriteType(int value){}void setValue(byte[] value){}
  }
  static final class BluetoothProfile {static final int STATE_DISCONNECTED=0,STATE_CONNECTED=2;}
  static final class BluetoothDevice {
    static final String EXTRA_TRANSPORT="transport",ACTION_ACL_DISCONNECTED="acl",EXTRA_DEVICE="device";static final int TRANSPORT_AUTO=0,TRANSPORT_BREDR=1,TRANSPORT_LE=2;
    final NativeGattRecoveryTest owner;final String address;BluetoothDevice(NativeGattRecoveryTest owner,String address){this.owner=owner;this.address=address;}
    String getAddress(){return address;}String getName(){return "test host";}
    BluetoothGatt connectGatt(Object context,boolean auto,Object callback,int transport){check(!auto&&transport==2,"connect remains foreground LE");owner.allocations++;return new BluetoothGatt();}
  }
  static final class BluetoothAdapter {
    static final String EXTRA_STATE="state",ACTION_STATE_CHANGED="adapter";static final int STATE_OFF=10,STATE_TURNING_OFF=13;
    final NativeGattRecoveryTest owner;BluetoothAdapter(NativeGattRecoveryTest owner){this.owner=owner;}
    static boolean checkBluetoothAddress(String value){return value!=null&&value.matches("([A-F0-9]{2}:){5}[A-F0-9]{2}");}
    BluetoothDevice getRemoteDevice(String address){return new BluetoothDevice(owner,address);}
  }
  static final class Intent {
    final String action;final Map<String,Object> extra=new HashMap<>();Intent(String action){this.action=action;}
    String getAction(){return action;}boolean hasExtra(String key){return extra.containsKey(key);}
    int getIntExtra(String key,int fallback){return extra.get(key)instanceof Integer?(Integer)extra.get(key):fallback;}
    BluetoothDevice getParcelableExtra(String key){return (BluetoothDevice)extra.get(key);}<T>T getParcelableExtra(String key,Class<T> type){return type.cast(extra.get(key));}
  }
  static final class Context {}static abstract class BroadcastReceiver {abstract void onReceive(Context c,Intent i);}
  static final class Build {static final class VERSION {static int SDK_INT=33;}}
  static final class BluetoothStatusCodes {static final int SUCCESS=0;}
  static final class Log {static int i(String tag,String text){return 0;}}
  static final class SystemClock {static long elapsedRealtime(){return 0;}}
  static final class Tc01Frame {static boolean validEnding(String value){return "lf".equals(value);}static byte[] stopped(String value){return new byte[]{1};}}
  static final class RemoteFrame {static byte[] released(){return new byte[]{2};}}
  static final class BleDeviceName {String advertisedName,name;static BleDeviceName resolve(String advertised,String cached){BleDeviceName n=new BleDeviceName();n.advertisedName=advertised;n.name=cached;return n;}}
  static final UUID SERVICE=UUID.randomUUID(),CHARACTERISTIC=UUID.randomUUID(),WRITE_CHARACTERISTIC=UUID.randomUUID();
  final Handler main=new Handler();final Ota ota=new Ota();final UploadGate uploadGate=new UploadGate();
  final BluetoothAdapter adapter=new BluetoothAdapter(this);final Map<String,BluetoothDevice> found=new HashMap<>();
  final Map<String,BleDeviceName> foundNames=new HashMap<>();final Map<String,Long> foundNameTimes=new HashMap<>();
  final Object callback=new Object();boolean foreground=true,radioOn=true,permitted=true,subscribed=true,remoteUsed=false,probeOnly=false;
  BluetoothGatt gatt=new BluetoothGatt(),closingGatt;BluetoothGattCharacteristic characteristic=new BluetoothGattCharacteristic(),writeCharacteristic=characteristic,fallbackCharacteristic=characteristic;
  String connectionId="old-epoch",deviceId=ADDRESS,closingReason="",closingEpoch="",closingDeviceId="",operation="",profile="xiaobai",lbsWriteMode="",tcWriteMode="",tcLineEnding="";
  long gattGeneration=1,closingGeneration,connectionNameObservedAt=1;String connectionNameObservation="scan";BleDeviceName connectionName=BleDeviceName.resolve(null,"old host");
  boolean closingTimedOut,closingClientClosed,closingAclDisconnected;Runnable disconnectTimeout,connectTimeout,operationTimeout,otaPump=()->{};
  byte[][] otaChunks=new byte[][]{{1,2}};int otaChunkIndex=1,negotiatedMtu=247,lbsMaxBytes,lbsSafeActions,allocations,programCancellations,scanStops;
  Object programWrite;UUID selectedService=SERVICE,selectedNotify=CHARACTERISTIC,selectedWrite=WRITE_CHARACTERISTIC;
  PluginCall queuedConnect,connectCall,operationCall;final List<PluginCall> disconnectCalls=new ArrayList<>();final List<JSObject> events=new ArrayList<>();
  static final long DISCONNECT_TIMEOUT_MS=5000;
  NativeGattRecoveryTest(){found.put(ADDRESS,new BluetoothDevice(this,ADDRESS));found.put(OTHER,new BluetoothDevice(this,OTHER));}
  Object getContext(){return null;}boolean enabled(){return radioOn;}
  boolean ready(PluginCall c,boolean scanning){if(!foreground){c.reject("background","CANCELLED");return false;}if(!radioOn){c.reject("radio off","BLUETOOTH_OFF");return false;}if(!permitted){c.reject("permission","PERMISSION_DENIED");return false;}return true;}
  JSObject state(){return new JSObject();}void notifyListeners(String name,JSObject event){if(name.equals("disconnected"))events.add(event);}
  void stopScanInternal(String reason){scanStops++;}void cancelProgramWrite(){programCancellations++;programWrite=null;}
  static void check(boolean ok,String label){if(!ok)throw new AssertionError(label);}
  static void localResult(PluginCall call,String label){check(call.resolves==1&&call.rejects==0&&call.result!=null&&Boolean.TRUE.equals(call.result.get("localReleased"))&&Boolean.FALSE.equals(call.result.get("remoteDisconnectionConfirmed")),label);}
  static final List<String> passed=new ArrayList<>();static void scenario(String name,Runnable code){code.run();passed.add(name);System.out.println("PASS "+name);}
  static void assertFresh(NativeGattRecoveryTest x,BluetoothGatt current,int starts,String label){check(x.gatt==current&&current.closes==0&&current.disconnects==0&&x.allocations==starts,label);}
${extracted.aclTransport}
${extracted.radio};
${extracted.connect}
${extracted.disconnect}
${extracted.release}
${extracted.operation}
${extracted.close}
${extracted.stop}
  public static void main(String[] args){
    scenario("client-disconnected-without-ACL-unblocks-one-reconnect",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;
      PluginCall operation=new PluginCall("old-epoch");x.beginOperation(operation,"otaWrite");PluginCall disconnect=new PluginCall("old-epoch");x.disconnectRequested(disconnect);
      check(x.gatt==null&&x.closingGatt==old&&old.disconnects==1&&old.closes==0,"disconnect intent waits before local close");
      check("DISCONNECTED".equals(operation.code)&&x.ota.closed&&x.otaChunks==null,"outgoing pipelines stop immediately");
      PluginCall next=new PluginCall("new-epoch");x.requestConnect(next);PluginCall duplicate=new PluginCall("duplicate");x.requestConnect(duplicate);
      check("BUSY".equals(duplicate.code)&&x.allocations==0,"single pending connect while old client still live");
      Runnable oldTimer=x.disconnectTimeout;x.handleConnectionStateChange(old,0,0);
      check(x.closingGatt==null&&old.closes==1&&x.allocations==1&&x.connectionId.equals("new-epoch"),"client STATE_DISCONNECTED must retire locally without ACL");
      localResult(disconnect,"client disconnect settles local-only caller once; never claims remote confirmation");
      check(x.events.size()==1&&x.events.get(0).get("connectionId").equals("old-epoch"),"logical event retains old identity exactly once");
      BluetoothGatt fresh=x.gatt;oldTimer.run();x.handleConnectionStateChange(old,22,0);x.handleAclDisconnected(old,"old-epoch",1,ADDRESS);PluginCall staleCleanup=new PluginCall("old-epoch");x.disconnectRequested(staleCleanup);
      localResult(staleCleanup,"no-match old cleanup reports local-only result");
      assertFresh(x,fresh,1,"late old callback/timer/cleanup cannot close new GATT");
    });
    scenario("missing-both-events-five-second-local-retirement-is-bounded",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;
      PluginCall disconnect=new PluginCall("old-epoch"),next=new PluginCall("new-epoch");x.disconnectRequested(disconnect);x.requestConnect(next);Runnable stale=x.disconnectTimeout;
      x.main.advance(4999);check(x.closingGatt==old&&old.closes==0&&x.allocations==0,"do not retire before bounded timeout");
      x.main.advance(1);check(x.closingGatt==null&&old.closes==1,"five seconds releases local resources without requiring missing broadcasts");
      localResult(disconnect,"timeout confirms local retirement only, never a remote disconnect");
      check(x.allocations==1&&next.rejects==0&&x.connectionId.equals("new-epoch"),"one queued connect resumes after local retirement");
      BluetoothGatt fresh=x.gatt;stale.run();x.handleConnectionStateChange(old,0,0);x.handleAclDisconnected(old,"old-epoch",1,ADDRESS);assertFresh(x,fresh,1,"late timeout and ACL do not alter resumed connection");
      check(disconnect.resolves==1&&disconnect.rejects==0,"timeout caller settles once");
    });
    scenario("unsolicited-client-loss-never-needs-second-ACL",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;x.handleConnectionStateChange(old,22,0);
      check(x.gatt==null&&x.closingGatt==null&&old.closes==1&&old.disconnects==0,"actual client loss is sufficient for local retirement");
      x.requestConnect(new PluginCall("explicit"));BluetoothGatt fresh=x.gatt;x.handleConnectionStateChange(old,22,0);assertFresh(x,fresh,1,"old loss after explicit retry is ignored");
      NativeGattRecoveryTest failure=new NativeGattRecoveryTest();BluetoothGatt failed=failure.gatt;failure.handleConnectionStateChange(failed,133,BluetoothProfile.STATE_CONNECTED);failure.main.advance(5000);
      check(failure.gatt==null&&failure.closingGatt==null&&failed.closes==1,"GATT status failure without disconnect callback is bounded locally");
    });
    scenario("ACL-is-observation-not-authority-to-close-current-or-retiring",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;PluginCall d=new PluginCall("old-epoch");x.disconnectRequested(d);x.requestConnect(new PluginCall("after-acl"));
      x.handleAclDisconnected(old,"old-epoch",0,ADDRESS);x.handleAclDisconnected(old,"wrong",1,ADDRESS);x.handleAclDisconnected(old,"old-epoch",1,OTHER);
      check(x.allocations==0&&x.closingGatt==old,"wrong generation/epoch/MAC cannot release close");
      x.handleAclDisconnected(old,"old-epoch",1,ADDRESS);check(x.allocations==0&&old.closes==0&&x.closingGatt==old,"even matching ACL cannot authorize local lifecycle");
      x.handleConnectionStateChange(old,0,0);localResult(d,"actual client state completes local close after ACL observation");
      BluetoothGatt fresh=x.gatt;x.handleAclDisconnected(old,"old-epoch",1,ADDRESS);x.handleAclDisconnected(fresh,"after-acl",x.gattGeneration,ADDRESS);assertFresh(x,fresh,1,"ACL without GATT generation proof cannot close fresh active client");
    });
    scenario("already-received-ACL-captures-old-generation-before-post",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;x.disconnectRequested(new PluginCall("old-epoch"));x.requestConnect(new PluginCall("same-address-new"));
      Intent event=new Intent(BluetoothDevice.ACTION_ACL_DISCONNECTED);event.extra.put(BluetoothDevice.EXTRA_DEVICE,x.found.get(ADDRESS));x.radioReceiver.onReceive(null,event);
      x.handleConnectionStateChange(old,0,0);BluetoothGatt fresh=x.gatt;x.main.advance(0);assertFresh(x,fresh,1,"posted old ACL cannot adopt later same-MAC generation");
    });
    scenario("queued-connect-cancellation-and-subsequent-switch",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;x.disconnectRequested(new PluginCall("old-epoch"));PluginCall cancelled=new PluginCall("cancel"),stop=new PluginCall("cancel");x.requestConnect(cancelled);x.disconnectRequested(stop);
      check(cancelled.rejects==1&&"CANCELLED".equals(cancelled.code)&&stop.resolves==1&&x.queuedConnect==null,"only named queued request cancelled");
      localResult(stop,"queued cancellation reports local-only result");
      PluginCall next=new PluginCall("replacement");next.deviceId=OTHER;x.requestConnect(next);x.handleConnectionStateChange(old,0,0);
      check(x.allocations==1&&x.deviceId.equals(OTHER)&&next.rejects==0,"one replacement starts; cancelled request is never replayed");
    });
    scenario("radio-OFF-cleans-close-but-never-starts-cancelled-pending",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;x.disconnectRequested(new PluginCall("old-epoch"));PluginCall next=new PluginCall("new");x.requestConnect(next);x.radioOn=false;
      Intent off=new Intent(BluetoothAdapter.ACTION_STATE_CHANGED);off.extra.put(BluetoothAdapter.EXTRA_STATE,BluetoothAdapter.STATE_OFF);x.radioReceiver.onReceive(null,off);x.main.advance(0);
      check(x.closingGatt==null&&old.closes==1&&x.allocations==0&&"BLUETOOTH_OFF".equals(next.code),"actual OFF closes locally and rejects pending");x.main.advance(5000);check(x.allocations==0,"OFF timeout never resurrects pending");
      x.radioOn=true;x.requestConnect(new PluginCall("manual-after-on"));check(x.allocations==1,"explicit retry works when Bluetooth returns");
    });
    scenario("foreground-radio-permission-rechecked-at-retirement",()->{
      for(int mode=0;mode<3;mode++){
        NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;x.disconnectRequested(new PluginCall("old-epoch"));PluginCall next=new PluginCall("next");x.requestConnect(next);
        if(mode==0)x.foreground=false;else if(mode==1)x.radioOn=false;else x.permitted=false;x.handleConnectionStateChange(old,0,0);
        check(x.allocations==0&&next.rejects==1,"readiness rechecked for mode "+mode);
      }
    });
    scenario("background-stops-OTA-fragments-and-cancels-reconnect",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;x.ota.running=true;x.remoteUsed=true;x.programWrite=new Object();x.handleOnStop();x.main.advance(0);
      check(!x.foreground&&x.gatt==null&&x.ota.closed&&x.otaChunks==null&&x.programWrite==null&&old.writes==0,"background OTA never sends normal release frame");
      x.main.advance(5000);check(x.closingGatt==null&&old.closes==1&&x.allocations==0,"background gets bounded cleanup without reconnect");x.foreground=true;x.requestConnect(new PluginCall("after-resume"));check(x.allocations==1,"explicit foreground retry permitted");
      NativeGattRecoveryTest queued=new NativeGattRecoveryTest();queued.disconnectRequested(new PluginCall("old-epoch"));PluginCall pending=new PluginCall("pending");queued.requestConnect(pending);queued.handleOnStop();queued.main.advance(5000);
      check("CANCELLED".equals(pending.code)&&queued.allocations==0&&queued.queuedConnect==null&&queued.closingGatt==null,"actual background hook cancels queued connect and never replays it");
    });
    scenario("active-OTA-is-exclusive-until-error-closes-transport",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;x.ota.running=true;PluginCall denied=new PluginCall("not-during-ota");x.requestConnect(denied);
      check("OTA_EXCLUSIVE".equals(denied.code)&&x.gatt==old&&old.disconnects==0,"OTA switch rejection preserves current link");
      PluginCall write=new PluginCall("old-epoch");x.beginOperation(write,"otaWrite");x.main.advance(5000);
      check("DISCONNECTED".equals(write.code)&&x.ota.closed&&x.otaChunks==null&&x.gatt==null,"OTA operation timeout cancels native pipeline");
      x.main.advance(5000);check(x.closingGatt==null&&old.closes==1,"OTA abnormal close releases local resources after bounded cleanup");x.requestConnect(new PluginCall("after-ota-error"));check(x.allocations==1,"OTA error does not permanently block normal connection");
    });
    scenario("old-connect-operation-and-release-timeouts-are-identity-fenced",()->{
      for(int kind=0;kind<3;kind++){
        NativeGattRecoveryTest x=new NativeGattRecoveryTest();Runnable stale;
        if(kind==0){x.gatt=null;x.connectionId="";x.requestConnect(new PluginCall("old-epoch"));stale=x.connectTimeout;}
        else if(kind==1){x.beginOperation(new PluginCall("old-epoch"),"otaWrite");stale=x.operationTimeout;}
        else{x.remoteUsed=true;x.operation="";x.releaseAndClose("release");stale=x.operationTimeout;}
        BluetoothGatt old=x.gatt;x.closeConnection("retire");x.requestConnect(new PluginCall("new-epoch"));x.handleConnectionStateChange(old,0,0);BluetoothGatt fresh=x.gatt;int count=x.allocations;stale.run();assertFresh(x,fresh,count,"old timer cannot close new connection kind "+kind);
      }
      NativeGattRecoveryTest same=new NativeGattRecoveryTest();same.beginOperation(new PluginCall("old-epoch"),"otaWrite");Runnable stale=same.operationTimeout;same.beginOperation(new PluginCall("old-epoch"),"otaWrite");stale.run();check(same.gatt!=null,"same-epoch replacement PluginCall also fences stale timeout");
    });
    scenario("invalid-and-expired-request-never-tears-down-valid-current",()->{
      for(int kind=0;kind<3;kind++){
        NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt live=x.gatt;PluginCall invalid=new PluginCall("invalid");if(kind==0)invalid.profile="unknown";else if(kind==1)invalid.profile="tc01";else invalid.deviceId="expired";
        x.requestConnect(invalid);check(invalid.rejects==1&&x.gatt==live&&live.closes==0&&live.disconnects==0&&x.queuedConnect==null,"invalid switch leaves current intact kind "+kind);
      }
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;x.disconnectRequested(new PluginCall("old-epoch"));PluginCall expires=new PluginCall("expires");x.requestConnect(expires);x.found.clear();x.handleConnectionStateChange(old,0,0);check(expires.rejects==1&&x.allocations==0,"candidate validity rechecked at actual local cleanup");
    });
    scenario("platform-disconnect-close-exceptions-still-bounded",()->{
      NativeGattRecoveryTest x=new NativeGattRecoveryTest();BluetoothGatt old=x.gatt;old.failDisconnect=true;old.failClose=true;x.disconnectRequested(new PluginCall("old-epoch"));x.requestConnect(new PluginCall("after-platform-error"));x.main.advance(5000);
      check(x.closingGatt==null&&old.closes==1&&x.allocations==1,"platform exceptions cannot leave permanent native barrier");
    });
    scenario("ACL-transport-filter-keeps-legacy-and-LE-only",()->{
      Intent legacy=new Intent("acl"),le=new Intent("acl"),classic=new Intent("acl");le.extra.put("transport",2);classic.extra.put("transport",1);
      check(acceptsAclTransport(legacy)&&acceptsAclTransport(le)&&!acceptsAclTransport(classic),"Android legacy/LE accepted; BR/EDR cannot retire LE");
    });
    System.out.println("Production native local GATT recovery passed "+passed.size()+" scenarios. Remote disconnect confirmation is not inferred from local timeout.");
  }
}
`;
function findJdk(){
  const cache=path.join(os.homedir(),'.cache/cards-android/jdk-ms'),ext=process.platform==='win32'?'.exe':'';
  const homes=[process.env.JAVA_HOME,...(fs.existsSync(cache)?fs.readdirSync(cache).map(name=>path.join(cache,name)):[])].filter(Boolean);
  const candidates=[...homes.map(home=>({javac:path.join(home,'bin/javac'+ext),java:path.join(home,'bin/java'+ext)})),{javac:'javac'+ext,java:'java'+ext}];
  const found=candidates.find(jdk=>Object.values(jdk).every(cmd=>spawnSync(cmd,['-version'],{encoding:'utf8',windowsHide:true}).status===0));
  assert(found,'JDK is required to execute actual native-method regression');return found;
}
function main(){
  const jdk=findJdk(),tempRoot=path.resolve(process.env.CARD_NATIVE_TMP||os.tmpdir());
  fs.mkdirSync(tempRoot,{recursive:true});
  const temp=fs.mkdtempSync(path.join(tempRoot,'gatt-recovery-harness-'));
  try{
    const file=path.join(temp,'NativeGattRecoveryTest.java');fs.writeFileSync(file,java);
    const compile=spawnSync(jdk.javac,['-encoding','UTF-8','-d',temp,file],{encoding:'utf8',windowsHide:true});
    assert.equal(compile.status,0,'actual native-method harness compilation failed\n'+compile.stdout+'\n'+compile.stderr);
    const run=spawnSync(jdk.java,['-cp',temp,'com.cardprogramming.app.NativeGattRecoveryTest'],{encoding:'utf8',windowsHide:true});
    process.stdout.write(run.stdout||'');assert.equal(run.status,0,'native recovery regression failed\n'+run.stdout+'\n'+run.stderr);
    const count=(run.stdout.match(/^PASS /gm)||[]).length;assert.equal(count,14);
    // Reverse the obsolete ACL-only RED control: either retaining the client
    // barrier after STATE_DISCONNECTED or retaining it after five seconds must fail.
    const controls=[
      {name:'client-callback-permanent-barrier',from:'traceGattClose("clientDown",closingEpoch,closingDeviceId);completeGattClose(source);',to:'traceGattClose("clientDown",closingEpoch,closingDeviceId);closeRetiredClient(source);',failure:'client STATE_DISCONNECTED must retire locally without ACL'},
      {name:'five-second-permanent-barrier',from:'traceGattClose("local close timeout",epoch,address);\n            completeGattClose(previous);',to:'traceGattClose("local close timeout",epoch,address);\n            /* defective: retain local barrier forever */',failure:'five seconds releases local resources without requiring missing broadcasts'}
    ];
    for(const control of controls){
      const baseline=java.replace(/\r\n/g,'\n'),mutant=baseline.replace(control.from,control.to);assert.notEqual(mutant,baseline,'RED mutation must alter production handler: '+control.name);
      const red=path.join(temp,control.name);fs.mkdirSync(red);const file=path.join(red,'NativeGattRecoveryTest.java');fs.writeFileSync(file,mutant);
      const compile=spawnSync(jdk.javac,['-encoding','UTF-8','-d',red,file],{encoding:'utf8',windowsHide:true});assert.equal(compile.status,0,'RED compilation failed\n'+compile.stdout+'\n'+compile.stderr);
      const result=spawnSync(jdk.java,['-cp',red,'com.cardprogramming.app.NativeGattRecoveryTest'],{encoding:'utf8',windowsHide:true});
      assert.notEqual(result.status,0,'RED permanent barrier must fail: '+control.name);assert((result.stdout+result.stderr).includes(control.failure),'RED must fail at the reported recovery boundary: '+control.name);
      console.log('RED confirmed: '+control.name);
    }
    console.log(JSON.stringify({pass:true,source,scenarios:count,redControls:controls.length,methodSource:'Exact production methods; only Android platform dependencies are doubles.',hardware:false}));
  }finally{
    const target=path.resolve(temp);assert.equal(path.dirname(target),tempRoot);assert(path.basename(target).startsWith('gatt-recovery-harness-'));fs.rmSync(target,{recursive:true,force:true});
  }
}
if(require.main===module)main();
module.exports={main,java,extracted};
