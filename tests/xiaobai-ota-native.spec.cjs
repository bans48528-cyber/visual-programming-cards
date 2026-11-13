'use strict';
// Candidate replacement: preserve the production OTA suite; delegate the obsolete
// ACL-only close harness to the actual-method local recovery regression.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(process.env.CARD_APP_ROOT||path.resolve(__dirname,'..'));
const firmware=process.env.XIAOBAI_FIRMWARE_ROOT||path.resolve(root,'../../../5月/小白机器人/LBS-XIAOBAI-AI');
const local=path.join(root,'tests/fixtures/py32-ota-vectors.json');
const fixture=fs.existsSync(local)?local:path.join(firmware,'tests/ota_vectors.json');
const vectors=JSON.parse(fs.readFileSync(fixture,'utf8'));
const contractSync=require(path.join(root,'scripts/sync-ota-contract.cjs'));
const snapshot=require(path.join(root,'xiaobai-ota-protocol.js')).C;
const nativeLayout=fs.readFileSync(path.join(root,'android/app/src/main/java/com/cardprogramming/app/OtaLayout.java'),'utf8');
assert.equal(nativeLayout,contractSync.javaSource(snapshot),'every generated native constant equals the JS firmware-contract snapshot');
const actualMacros=Object.fromEntries([...nativeLayout.matchAll(/static final (?:int|long) (OTA_\w+)=0x([a-f0-9]+)L?;/g)].map(m=>[m[1],parseInt(m[2],16)]));
assert.deepEqual(actualMacros,snapshot,'all native protocol constants are present without omissions');
if(fs.existsSync(path.join(firmware,'Shared/Ota_Layout.h')))assert.equal(nativeLayout,contractSync.generatedJava(firmware),'all native constants match the authoritative C header');
const cache=path.join(os.homedir(),'.cache/cards-android/jdk-ms');
const homes=[process.env.JAVA_HOME,...(fs.existsSync(cache)?fs.readdirSync(cache).map(n=>path.join(cache,n)):[])].filter(Boolean);
const ext=process.platform==='win32'?'.exe':'';
const jdks=homes.map(home=>({javac:path.join(home,'bin/javac'+ext),java:path.join(home,'bin/java'+ext)}));jdks.push({javac:'javac'+ext,java:'java'+ext});
const jdk=jdks.find(d=>[d.javac,d.java].every(cmd=>spawnSync(cmd,['-version'],{encoding:'utf8',windowsHide:true}).status===0));
assert(jdk,'JDK required for the production native transport tests');
// Generated harnesses never write into the published tests tree.
const tempRoot=path.resolve(process.env.CARD_NATIVE_TMP||os.tmpdir());
fs.mkdirSync(tempRoot,{recursive:true});
const temp=fs.mkdtempSync(path.join(tempRoot,'xiaobai-ota-native-'));
function run(cmd,args,input){const r=spawnSync(cmd,args,{cwd:root,input,encoding:'utf8',windowsHide:true});if(r.error)throw r.error;assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;}
try{
  run(jdk.javac,['-encoding','UTF-8','-d',temp,path.join(root,'android/app/src/main/java/com/cardprogramming/app/OtaLayout.java'),path.join(root,'android/app/src/main/java/com/cardprogramming/app/OtaTransport.java'),path.join(root,'tests/OtaTransportTest.java')]);
  const input=vectors.frames.map(f=>[f.valid_frame?'valid':'invalid',f.frame_hex,f.name].join('\t')).join('\n')+'\n';
  process.stdout.write(run(jdk.java,['-cp',temp,'com.cardprogramming.app.OtaTransportTest'],input));
  const plugin=fs.readFileSync(process.env.CARD_NATIVE_PLUGIN||path.join(root,'android/app/src/main/java/com/cardprogramming/app/SparkBlePlugin.java'),'utf8');
  // Actual request/connect/close/client-state/ACL/radio/background methods, 14
  // scenarios + RED controls for the reported permanent client/timeout barriers.
  require('./android-gatt-recovery.spec.cjs').main();
  assert(plugin.includes('filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)')&&plugin.includes('radioReceiver,filter,ContextCompat.RECEIVER_EXPORTED'),'system ACL diagnostics remain registered exported');
  assert(plugin.includes('final BluetoothGatt expected=closingGatt;')&&plugin.includes('final String epoch=closingEpoch;')&&plugin.includes('final long generation=closingGeneration;')&&plugin.includes('main.post(()->handleAclDisconnected(expected,epoch,generation,address))'),'ACL captures only retired local context before asynchronous dispatch');
  for(const name of ['beginOta','writeOta','endOta'])assert(plugin.includes('@PluginMethod public void '+name+'(PluginCall call)'),name+' is exposed by production Capacitor plugin');
  assert(plugin.includes('ota.prepare(')&&plugin.includes('ota.receive(')&&plugin.includes('ota.delay('),'production GATT path uses tested framing, parser and pacing');
  assert(plugin.includes('if(ota.active()) {call.reject("固件升级期间不能发送普通控制指令。"'),'ordinary GATT writes locked out');
  assert(plugin.includes('if(ota.active()) {call.reject("固件升级期间请先结束当前升级。"'),'ordinary connection replacement is locked during raw OTA');
  assert(plugin.includes('beginOperation(call,"otaWrite")')&&plugin.includes('main.postDelayed(operationTimeout,5000)')&&plugin.includes('pendingOperation.reject(reason,"DISCONNECTED")'),'raw GATT write promise has a native bounded failure path');
  assert(plugin.includes('if(expected!=gatt||!epoch.equals(connectionId)'),'scheduled chunks cannot cross connection epoch');
  assert(plugin.includes('probeOnly || ota.active() || !remoteUsed'),'background/disconnect never sends ordinary release frame into Boot');
  assert(plugin.includes('main.removeCallbacks(otaPump)')&&plugin.includes('ota.close()'),'close cancels queued native fragments');
  assert(plugin.includes('notifyListeners("otaNotification",event)'),'matched raw response reaches JS');
  assert(plugin.includes('BluetoothAdapter.checkBluetoothAddress(id)')&&plugin.includes('call.getBoolean("boundDevice",false)'),'recovery explicitly uses bound address');
  console.log('Native bridge API/exclusivity/epoch wiring checks passed; real Android GATT callbacks remain for hardware test.');
}finally{const target=path.resolve(temp);assert.equal(path.dirname(target),tempRoot);assert(path.basename(target).startsWith('xiaobai-ota-native-'));fs.rmSync(target,{recursive:true,force:true});}
