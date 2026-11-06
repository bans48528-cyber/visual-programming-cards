const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {create,describeName,cleanRadioName,NAMES_KEY}=require('../xiaobai-device-preferences.js');
let count=0;
const same=(a,b)=>{assert.deepEqual(a,b);count++;};
const items=new Map(),storage={getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,String(v))};
const device={deviceId:'EC:B0:DC:10:B4:43',name:'Spark_AI',advertisedName:'Spark_AI',cachedName:'BT_ECB0DC10B443',nameSource:'advertisement',nameObservation:'scan'};
const prefs=create(storage);
same(prefs.displayName(device),'Spark_AI');same(prefs.describeName(device).source,'advertisement');same(prefs.describeName(device).radioLabel,'广播名');
same(prefs.describeName({...device,nameObservation:'last-scan'}).radioLabel,'最近扫描广播名');
prefs.rename(device.deviceId,'教室小白');const before=items.get(NAMES_KEY);
same(prefs.displayName(device),'教室小白');same(prefs.describeName(device).source,'alias');same(prefs.describeName(device).sourceLabel,'本机备注');same(prefs.describeName(device).description,'本机备注 · 广播名：Spark_AI');
same(prefs.displayName({...device,name:'New firmware name',advertisedName:'New firmware name'}),'教室小白');same(items.get(NAMES_KEY),before);
same(prefs.displayName({...device,name:'BT_ECB0DC10B443',advertisedName:'',nameSource:'system-cache'}),'教室小白');same(items.get(NAMES_KEY),before);
same(describeName({...device,name:'BT_ECB0DC10B443',advertisedName:'',nameSource:'system-cache'}).radioLabel,'系统缓存名');
same(describeName({name:'BT_ECB0DC10B443'}).source,'unknown');
same(describeName({name:'Other device',nameSource:'advertisement'}).name,'Other device');
same(cleanRadioName('Spark_AI\0garbage'),'Spark_AI');same(cleanRadioName('  Spark_AI\r\n'),'Spark_AI');
same(prefs.describeName({deviceId:device.deviceId,...device,name:'Spark_AI\0bad'}).name,'教室小白');
prefs.rename(device.deviceId,'Spark_AI');same(prefs.describeName(device).source,'alias');
same(items.get(NAMES_KEY),JSON.stringify({[device.deviceId]:'Spark_AI'}));
prefs.rename(device.deviceId,'');same(prefs.displayName(device),'Spark_AI');same(prefs.describeName(device).source,'advertisement');

// Actual incoming path has no D3 event-subtype whitelist. This new event is not a C2 write.
const P=require('../xiaobai-protocol.js');
const golden=Buffer.from('5a98970ad30a0202000100020101017aa5','hex');
for(let split=1;split<golden.length;split++){
 const frames=[],receiver=new P.Receiver(frame=>frames.push(frame));
 receiver.feed(golden.subarray(0,split));same(frames.length,0);receiver.feed(golden.subarray(split));same(frames.length,1);
 same(frames[0][4],0xd3);same(frames[0][5],0x0a);same(frames[0][6],2);same(Array.from(frames[0].slice(7,15)),[2,0,1,0,2,1,1,1]);
}
const plugin=fs.readFileSync(path.join(root,'android/app/src/main/java/com/cardprogramming/app/SparkBlePlugin.java'),'utf8');
assert(plugin.includes('BleDeviceName.resolve(advertised,cached)'));count++;
for(const field of ['advertisedName','cachedName','nameSource','nameObservedAt','nameObservation']){assert(plugin.includes('put("'+field+'"'));count++;}
assert(plugin.includes('putName(row,name,observedAt,"scan")'));count++;
assert(plugin.includes('putConnectionName(result)'));count++;
assert(plugin.includes('if(source!=gatt || !selectedNotify.equals(item.getUuid()) || value==null) return;'));count++;
assert(plugin.includes('notifyListeners("notification",event)'));count++;
assert(!plugin.includes('"BT_"'));count++;
assert(!plugin.includes('"Spark_AI"'));count++;

const cache=path.join(os.homedir(),'.cache/cards-android/jdk-ms'),ext=process.platform==='win32'?'.exe':'';
const homes=[process.env.JAVA_HOME,...(fs.existsSync(cache)?fs.readdirSync(cache).map(n=>path.join(cache,n)):[])].filter(Boolean);
const jdk=homes.map(home=>({javac:path.join(home,'bin/javac'+ext),java:path.join(home,'bin/java'+ext)})).find(d=>spawnSync(d.javac,['-version'],{encoding:'utf8',windowsHide:true}).status===0);
assert(jdk,'JDK needed for actual production Java name-source test');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xiaobai-bt-name-'));
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;}
try{
 run(jdk.javac,['-encoding','UTF-8','-d',temp,path.join(root,'android/app/src/main/java/com/cardprogramming/app/BleDeviceName.java'),path.join(__dirname,'BleDeviceNameTest.java')]);
 process.stdout.write(run(jdk.java,['-cp',temp,'com.cardprogramming.app.BleDeviceNameTest']));
}finally{const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('xiaobai-bt-name-'));fs.rmSync(target,{recursive:true,force:true});}
console.log(`PASS Bluetooth name sources: ${count} JS/native wiring/D3 fragment checks; local alias preserved, advertisement preferred, cached source explicit. No real BLE tested.`);
