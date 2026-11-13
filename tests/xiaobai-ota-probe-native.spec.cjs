'use strict';
// Exact shipping plugin methods and production validators, compiled against the
// existing deterministic Android doubles. No Android device or radio is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(process.env.CARD_APP_ROOT||path.join(__dirname,'..')),source=path.join(root,'android/app/src/main/java/com/cardprogramming/app/SparkBlePlugin.java'),plugin=fs.readFileSync(source,'utf8');
const {java:base}=require('./android-gatt-recovery.spec.cjs');
function member(text,first){const a=text.indexOf(first);assert(a>=0,first);const begin=text.indexOf('{',a);let depth=0,quote=null,escape=false,line=false,comment=false;
 for(let i=begin;i<text.length;i++){const c=text[i],n=text[i+1];if(line){if(c==='\n')line=false;continue;}if(comment){if(c==='*'&&n==='/'){comment=false;i++;}continue;}if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue;}if(c==='/'&&n==='/'){line=true;i++;continue;}if(c==='/'&&n==='*'){comment=true;i++;continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='{')depth++;else if(c==='}'&&!--depth)return text.slice(a,i+1);}throw Error(first);
}
let java=base.replace(/NativeGattRecoveryTest/g,'NativeProbeOnlyTest');
java=java.replace(member(java,'  public static void main(String[] args)'),String.raw`  public static void main(String[] args){
    NativeProbeOnlyTest p=new NativeProbeOnlyTest();p.gatt=null;p.probeOnly=false;PluginCall connect=new PluginCall("probe");connect.values.put("probeOnly","true");p.requestConnect(connect);
    check(p.probeOnly&&p.gatt!=null,"readonly property bound by actual connect owner");p.subscribed=true;
    PluginCall enter=packet("probe",1,new byte[8]);p.write(enter);p.main.advance(0);check(enter.rejects==1&&"PROBE_READ_ONLY".equals(enter.code)&&p.gatt.writes==0,"ENTER rejected before GATT");
    for(int opcode:new int[]{2,3,5,0x10,0x11,0x20,0x50,0x53,0x57,0x61}){PluginCall bad=packet("probe",opcode,new byte[8]);p.write(bad);p.main.advance(0);check(bad.rejects==1&&p.gatt.writes==0,"control opcode rejected "+opcode);}
    for(int opcode:new int[]{4,0x56,0x60})check(OtaProbeGate.validProgramRead(c2(opcode,new byte[8])),"read whitelist "+opcode);
    check(!OtaProbeGate.validProgramRead(c2(0x56,new byte[]{2,0,0,0,0,0,0,0})),"UID part2 forbidden");
    check(!OtaProbeGate.validProgramRead(c2(0x60,new byte[]{12,0,0,0,0,0,0,0})),"INFO out-of-range part forbidden");
    check(!OtaProbeGate.validProgramRead(c2(0x60,new byte[]{0,1,0,0,0,0,0,0})),"INFO reserved byte forbidden");
    PluginCall raw=new PluginCall("probe");raw.values.put("probeOnly","false");p.beginOta(raw);p.main.advance(0);check(raw.resolves==1&&p.ota.active(),"readonly raw probe starts");
    boolean blocked=false;try{p.ota.prepare(xbot(0x64,7));}catch(IllegalStateException ex){blocked=true;}check(blocked,"beginOta false parameter cannot promote readonly connection");
    BluetoothGatt old=p.gatt;p.remoteUsed=true;PluginCall end=new PluginCall("probe");p.endOta(end);p.main.advance(0);check(old.writes==0,"endOta never emits cleanup control");p.main.advance(5000);
    PluginCall normal=new PluginCall("normal");p.requestConnect(normal);check(!p.probeOnly&&p.gatt!=null,"only fresh connection changes lease");BluetoothGatt fresh=p.gatt;
    p.handleConnectionStateChange(old,0,0);p.handleAclDisconnected(old,"probe",1,ADDRESS);check(p.gatt==fresh&&!p.probeOnly,"old probe callbacks cannot alter fresh normal lease");
    PluginCall nextProbe=new PluginCall("next-probe");nextProbe.values.put("probeOnly","true");p.requestConnect(nextProbe);p.handleConnectionStateChange(fresh,0,0);BluetoothGatt newest=p.gatt;check(p.probeOnly&&newest!=fresh,"fresh probe obtains independent readonly lease");
    p.handleConnectionStateChange(fresh,0,0);p.handleAclDisconnected(fresh,"normal",2,ADDRESS);check(p.probeOnly&&p.gatt==newest,"old normal callbacks cannot remove fresh readonly lease");
    NativeProbeOnlyTest q=new NativeProbeOnlyTest();q.probeOnly=true;q.remoteUsed=true;BluetoothGatt quiet=q.gatt;q.disconnectRequested(new PluginCall("old-epoch"));check(quiet.writes==0,"probe disconnect cannot release remote even if stale flag set");
    NativeProbeOnlyTest read=new NativeProbeOnlyTest();read.probeOnly=true;PluginCall uidRead=packet("old-epoch",0x56,new byte[8]);read.write(uidRead);read.main.advance(0);check(uidRead.rejects==0&&read.gatt.writes==1,"actual readonly UID request reaches GATT");
    NativeProbeOnlyTest reject=new NativeProbeOnlyTest();PluginCall wrong=new PluginCall("wrong");wrong.profile="spark-ai";wrong.values.put("probeOnly","true");reject.requestConnect(wrong);check(wrong.rejects==1&&reject.gatt!=null&&reject.allocations==0,"probe flag cannot enter another model");
    System.out.println("PASS actual plugin probeOnly write/beginOta/endOta/close epoch gates and production read validator");
  }
  static PluginCall packet(String id,int opcode,byte[] args){PluginCall call=new PluginCall(id);call.values.put("data",java.util.Base64.getEncoder().encodeToString(c2(opcode,args)));return call;}
  static byte[] c2(int op,byte[] args){byte[] b=new byte[17];b[0]=0x5a;b[1]=(byte)0x97;b[2]=(byte)0x98;b[3]=10;b[4]=(byte)0xc2;b[5]=1;b[6]=(byte)op;System.arraycopy(args,0,b,7,8);for(int i=0;i<15;i++)b[15]+=b[i];b[16]=(byte)0xa5;return b;}
  static byte[] xbot(int op,int id){byte[] b=new byte[16];b[0]='X';b[1]='B';b[2]='O';b[3]='T';b[4]=1;b[5]=(byte)op;b[8]=(byte)id;java.util.zip.CRC32 crc=new java.util.zip.CRC32();crc.update(b,0,12);long n=crc.getValue();for(int i=0;i<4;i++)b[12+i]=(byte)(n>>(8*i));return b;}`);
java=java.replace('boolean getBoolean(String key,boolean fallback){return fallback;}','boolean getBoolean(String key,boolean fallback){return values.containsKey(key)?Boolean.parseBoolean(values.get(key)):fallback;}');
java=java.replace(/  static final class Ota \{[^\n]+\}\n/,'').replace('final Ota ota=new Ota();','final OtaTransport ota=new OtaTransport();');
java=java.replace('static final class UploadGate {int resets;void reset(){resets++;}}','static final class UploadGate {int resets;boolean active(){return false;}boolean accept(byte[] b){return false;}void reset(){resets++;}}');
java=java.replace('static final class RemoteFrame {static byte[] released(){return new byte[]{2};}}','static final class RemoteFrame {static boolean valid(byte[] b){return false;}static byte[] released(){return new byte[]{2};}}');
java=java.replace('static boolean validEnding(String value)', 'static boolean valid(byte[] b,String ending){return false;}static boolean validEnding(String value)');
const methods=['    private boolean matches(','    @PluginMethod public void write(','    @PluginMethod public void beginOta(','    @PluginMethod public void endOta('].map(first=>member(plugin,first).replace('@PluginMethod ',''));
const extras=String.raw`
  long lastNotificationAt=-1000;
  static final class Base64 {static final int NO_WRAP=0;static byte[] decode(String s,int flags){return java.util.Base64.getDecoder().decode(s);}}
  static final class LbsFrame {static boolean valid(byte[] b,int max,int actions){return false;}}
  static final class SparkControlFrame {static boolean valid(byte[] b){return false;}}
  void beginProgramWrite(PluginCall call,byte[] bytes){throw new AssertionError("probe cannot dispatch C4");}
`+methods.join('\n');
java=java.slice(0,java.lastIndexOf('}'))+extras+'\n}\n';
assert(plugin.includes('result.put("probeOnly",probeOnly)'),'actual service callback exposes immutable native lease');
const jdk=process.env.JAVA_HOME||'C:/Users/64264/.cache/cards-android/jdk-ms/jdk-21.0.12.1+1',temp=fs.mkdtempSync(path.join(os.tmpdir(),'xiaobai-probe-')),pkg='android/app/src/main/java/com/cardprogramming/app/';
try{const file=path.join(temp,'NativeProbeOnlyTest.java');fs.writeFileSync(file,java);
 const compile=spawnSync(path.join(jdk,'bin/javac.exe'),['-encoding','UTF-8','-d',temp,...['OtaLayout.java','OtaTransport.java','OtaProbeGate.java','ProgramFrame.java','MultiProgramFrame.java'].map(n=>path.join(root,pkg,n)),file],{encoding:'utf8',windowsHide:true});assert.equal(compile.status,0,compile.stdout+compile.stderr);
 const result=spawnSync(path.join(jdk,'bin/java.exe'),['-cp',temp,'com.cardprogramming.app.NativeProbeOnlyTest'],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stdout+result.stderr);process.stdout.write(result.stdout);
 for(const [name,old,next,reason]of [
  ['no-readonly-ordinary-gate','if(probeOnly&&!OtaProbeGate.validProgramRead(bytes))','if(false&&!OtaProbeGate.validProgramRead(bytes))','ENTER rejected before GATT'],
  ['promotable-raw-lease','ota.begin(probeOnly)','ota.begin(false)','beginOta false parameter cannot promote readonly connection']
 ]){
  assert(java.includes(old),name);fs.writeFileSync(file,java.replace(old,next));const compiled=spawnSync(path.join(jdk,'bin/javac.exe'),['-encoding','UTF-8','-cp',temp,'-d',temp,file],{encoding:'utf8',windowsHide:true});assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
  const red=spawnSync(path.join(jdk,'bin/java.exe'),['-cp',temp,'com.cardprogramming.app.NativeProbeOnlyTest'],{encoding:'utf8',windowsHide:true});assert.notEqual(red.status,0,name+' must fail');assert((red.stdout+red.stderr).includes(reason),name+': '+red.stdout+red.stderr);console.log('RED confirmed: '+name);
 }
}finally{const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('xiaobai-probe-'));fs.rmSync(target,{recursive:true,force:true});}
