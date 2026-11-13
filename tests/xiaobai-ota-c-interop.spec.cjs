// Real offline C Core/Codec/P256 interoperability. Does not open BLE, USB or serial.
// Optional: XIAOBAI_FIRMWARE_ROOT, XIAOBAI_OTA_PYTHON, --package <english.ota>.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const {spawn}=require('node:child_process');
const P=require('../xiaobai-ota-protocol.js');
const {BootClient}=require('../xiaobai-ota.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const firmware=process.env.XIAOBAI_FIRMWARE_ROOT||'D:/BaiduSyncdisk/2026/5月/小白机器人/LBS-XIAOBAI-AI';
const python=process.env.XIAOBAI_OTA_PYTHON||'C:/Users/64264/AppData/Local/XiaoBaiDev/automation-venv/Scripts/python.exe';
function simulatorBootVersion(){
  // The simulator compiles this header. Its actual Boot can be newer than the
  // signed App's minimum compatible Boot; compare the two identities separately.
  const source=fs.readFileSync(path.join(firmware,'Shared/Ota_Layout.h'),'utf8');
  const match=source.match(/^\s*#define\s+OTA_BOOT_VERSION\s+(0x[0-9a-fA-F]+|\d+)[uUlL]*\b/m);
  assert.ok(match,'authoritative simulator OTA_BOOT_VERSION must be a literal');
  const version=Number(match[1]);
  assert.ok(Number.isInteger(version)&&version>0&&version<=0xffffff,'simulator Boot version is bounded');
  return version;
}
const timing={requestMs:250,beginMs:1500,finishMs:1500,retries:2};
const C=P.CMD;
const get32=(bytes,at=0)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(at,true);
const le32=value=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,value,true);return b;};

class PipeDevice {
  static async open({vectors,initialHex}={}){
    const args=['-u',path.join(firmware,'tools/ota_simulator.py')];
    if(vectors)args.push('--vectors',vectors);
    if(initialHex)args.push('--initial-hex',initialHex);
    const device=new PipeDevice(spawn(python,args,{cwd:firmware,windowsHide:true,stdio:['pipe','pipe','pipe']}));
    assert.equal(await device.nextLine(60000),'READY','actual C simulator must compile and start');
    return device;
  }
  constructor(process){
    this.process=process;this.readyLines=[];this.waiters=[];this.stderr='';this.stopped=false;
    this.listeners=new Set();this.frames=[];this.fragments=[];this.responses=[];this.drop=new Set();
    this.dropped=new Map();this.retried=new Set();this.injectNoise=false;this.inFlight=false;
    this.lineQueue=Promise.resolve();
    readline.createInterface({input:process.stdout}).on('line',line=>{
      const waiter=this.waiters.shift();if(waiter){clearTimeout(waiter.timer);waiter.resolve(line.trim());}
      else this.readyLines.push(line.trim());
    });
    process.stderr.on('data',data=>{this.stderr=(this.stderr+data).slice(-12000);});
    process.on('error',error=>this.fail(error));
    process.on('exit',(code,signal)=>{this.stopped=true;this.exitCode=code;this.fail(new Error(`offline simulator exited ${code}/${signal}: ${this.stderr}`));});
  }
  fail(error){for(const waiter of this.waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(error);}}
  nextLine(timeout=10000){
    if(this.readyLines.length)return Promise.resolve(this.readyLines.shift());
    if(this.stopped)return Promise.reject(new Error(`offline simulator ended: ${this.stderr}`));
    return new Promise((resolve,reject)=>{
      const waiter={resolve,reject,timer:null};
      waiter.timer=setTimeout(()=>{const at=this.waiters.indexOf(waiter);if(at>=0)this.waiters.splice(at,1);reject(new Error(`offline C response timeout: ${this.stderr}`));},timeout);
      this.waiters.push(waiter);
    });
  }
  line(value){
    const task=this.lineQueue.then(async()=>{
      const answer=this.nextLine();this.process.stdin.write(value+'\n');return answer;
    });
    this.lineQueue=task.catch(()=>{});return task;
  }
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  emit(bytes){for(const listener of this.listeners)listener(Uint8Array.from(bytes));}
  async write(value){
    assert.equal(this.inFlight,false,'transport must not write two frames concurrently');
    this.inFlight=true;
    try{
      const raw=Uint8Array.from(value),frame=P.decodeFrame(raw);
      const id=frame.requestId,command=frame.command;
      this.frames.push({id,command,bytes:Buffer.from(raw),offset:command===C.DATA?get32(frame.payload):null});
      if(this.dropped.has(id)){
        assert.deepEqual(Buffer.from(raw),this.dropped.get(id),'lost ACK retry must retain the exact request ID and bytes');
        this.retried.add(id);
      }
      let answer='-';
      for(let offset=0;offset<raw.length;offset+=20){
        const fragment=raw.slice(offset,offset+20);this.fragments.push(fragment.length);
        answer=await this.line(Buffer.from(fragment).toString('hex'));
        if(offset+20<raw.length)assert.equal(answer,'-','real C codec must not execute an incomplete request');
      }
      assert.notEqual(answer,'-','a full valid request must produce real C response');
      const response=Buffer.from(answer,'hex'),decoded=P.decodeFrame(response);
      assert.equal(decoded.command,command|0x80);assert.equal(decoded.requestId,id);
      this.responses.push(decoded);
      if(this.drop.delete(command)){
        this.dropped.set(id,Buffer.from(raw));return;
      }
      if(this.injectNoise){
        // Wrong request, wrong command and corrupt CRC never satisfy the current request.
        const wrongId=P.encodeFrame(decoded.command,(id+71)>>>0,decoded.payload);
        const wrongCmd=P.encodeFrame(decoded.command^1,id,decoded.payload);
        const corrupt=Uint8Array.from(response);corrupt[12]^=1;
        this.emit(Uint8Array.from([0x00,0xff,0x58,0x42]));
        this.emit(wrongId);this.emit(wrongCmd);this.emit(corrupt);
      }
      // Also exercise JavaScript notification reassembly, independently of 20-byte TX.
      for(let offset=0,index=0;offset<response.length;index++){
        const length=[1,7,20,3,11][index%5];this.emit(response.slice(offset,offset+length));offset+=length;
      }
    }finally{this.inFlight=false;}
  }
  async disconnect(){assert.equal(await this.line('DISCONNECT'),'OK');}
  async reset(){assert.equal(await this.line('RESET'),'OK');}
  async close(){
    if(this.stopped)return;
    this.process.stdin.write('QUIT\n');this.process.stdin.end();
    const timeout=setTimeout(()=>this.process.kill(),10000);
    await new Promise(resolve=>this.process.once('exit',resolve));clearTimeout(timeout);
    assert.equal(this.exitCode,0,this.stderr);
  }
}
const client=(device,firstRequestId=101,onProgress=()=>{})=>new BootClient(device,{timing,firstRequestId,onProgress});
const begin=async(c,p)=>c.ack(C.BEGIN,p.manifest,0);
const page=async(c,p)=>c.ack(C.DATA,P.concat(le32(0),p.image.slice(0,128)),128);
async function loadPackage(file,publicKey){return P.verifyPackage(fs.readFileSync(file),{name:path.basename(file),...(publicKey?{publicKey}:{})});}
function identity(info,pkg){
  assert.equal(info.mode,1,'C simulator only represents Boot; never fake App health');
  assert.equal(info.imageValid,true);assert.equal(info.version,pkg.version);
  assert.equal(info.imageSize,pkg.imageSize);assert.equal(info.imageSha256,pkg.imageSha256);
  assert.equal(info.layoutId,P.layoutIdOf(pkg),'running identity includes the signed layout');
  assert.equal(info.activeAppBase,P.layoutOf(pkg).appBase,'the image remains at its original signed base');
  assert.ok(P.sameTarget(info,pkg),'actual C INFO must match the complete target identity');
}

async function recoveryAndRetry(pkg){
  const device=await PipeDevice.open();let c=client(device);
  try{
    assert.equal((await c.info()).imageValid,false);
    await begin(c,pkg);await page(c,pkg);
    await device.reset();let info=await c.info();
    assert.equal(info.nextOffset,0);assert.equal(info.imageValid,false,'RESET cannot retain partial download as valid');
    c.close('fresh connection');
    const progress=[];c=client(device,10001,event=>progress.push({...event}));
    device.drop=new Set([C.BEGIN,C.DATA,C.FINISH]);device.injectNoise=true;
    const result=await c.upload(pkg);
    assert.equal(result.written,true);assert.equal(result.alreadyPresent,false);
    assert.equal(result.applicationStartVerified,false,'FINISH ACK cannot claim running App health');
    assert.equal(device.dropped.size,3);assert.equal(device.retried.size,3,'all lost ACKs retried with same ID and bytes');
    const begins=device.frames.filter(frame=>frame.command===C.BEGIN);
    assert.equal(begins.at(-1).id,10002,'new upload INFO consumes ID10001 then fresh BEGIN10002 starts at zero');
    assert.ok(progress.some(event=>event.phase==='transfer'&&event.committed===pkg.imageSize),'progress reaches total only from committed ACKs');
    let prior=0;
    for(const event of progress.filter(event=>event.phase==='transfer')){
      assert.ok(event.committed>=prior&&event.committed<=pkg.imageSize);prior=event.committed;
      assert.ok(device.responses.some(frame=>frame.command===(C.DATA|0x80)&&frame.payload[0]===0&&get32(frame.payload,1)===event.committed),
        'every transfer progress position must have a matching actual C committed offset');
    }
    identity(await c.info(),pkg);await device.reset();identity(await c.info(),pkg);
    const oldBegins=device.frames.filter(frame=>frame.command===C.BEGIN).length;
    const skipped=await c.upload(pkg);
    assert.equal(skipped.alreadyPresent,true);assert.equal(skipped.written,false);
    assert.equal(skipped.applicationStartVerified,false);
    assert.equal(device.frames.filter(frame=>frame.command===C.BEGIN).length,oldBegins,'identical valid image exits Boot without erase');
    const corrupt=Uint8Array.from(pkg.manifest);corrupt[70]^=1;
    await assert.rejects(c.request(C.BEGIN,corrupt,{timeoutMs:1500}),error=>error.status===5,'actual C rejects bad P256 signature');
    await device.reset();identity(await c.info(),pkg);
    const badCrc=P.encodeFrame(C.INFO,0x747474);badCrc[12]^=1;
    assert.equal(await device.line(Buffer.from(badCrc).toString('hex')),'-','real C rejects CRC before executing');
    identity(await c.info(),pkg);
    assert.ok(device.fragments.every(length=>length>=1&&length<=20));
    return {requests:device.frames.length,fragments:device.fragments.length,retries:device.retried.size};
  }finally{c.close('test finished');await device.close();}
}

async function genuineUpgrade(pkg){
  const oldDir=path.join(firmware,'dist/ota/py32_1.0.0');
  const oldFile=path.join(oldDir,'xiaobai_py32_1.0.0.ota');
  assert.ok(fs.existsSync(oldFile),'genuine signed legacy package is required for interoperability');
  const previous=await loadPackage(oldFile);
  assert.equal(previous.format,1);assert.equal(previous.layoutId,1);
  // This is a simulated *new Boot* environment, not a Boot migration procedure.
  // Old factory HEX only has the F000 record, which new Boot correctly cannot
  // treat as its canonical FF00 commit. First real Boot migration still uses DAP.
  const device=await PipeDevice.open();let c=client(device,20001);
  try{
    const blank=await c.info();assert.equal(blank.schemaVersion,2);assert.equal(blank.imageValid,false);
    assert.equal(blank.bootVersion,simulatorBootVersion(),'actual Boot INFO must match the compiled authoritative header');
    if(pkg.layoutId===2)assert.equal(pkg.minBootVersion,0x020000,'compact App minimum stays Boot2.0.0 even when actual Boot is newer');
    assert.equal(blank.capabilities&15,15);
    const initial=await c.upload(previous);assert.equal(initial.written,true);
    await device.reset();
    identity(await c.info(),previous);
    const result=await c.upload(pkg);assert.equal(result.written,true);assert.equal(result.applicationStartVerified,false);
    await device.reset();identity(await c.info(),pkg);
    const downgrade=await c.upload(previous);assert.equal(downgrade.written,true,'actual C permits a genuinely signed compatible downgrade');
    await device.reset();identity(await c.info(),previous);
    const oldBegins=device.frames.filter(f=>f.command===C.BEGIN).length;
    const current=await c.upload(previous);assert.equal(current.alreadyPresent,true);assert.equal(current.written,false);
    assert.equal(device.frames.filter(f=>f.command===C.BEGIN).length,oldBegins,'exact legacy target is confirmed without BEGIN');
    const repairs=await c.upload(previous,{repair:true});assert.equal(repairs.written,true);assert.equal(repairs.applicationStartVerified,false);
    await device.reset();identity(await c.info(),previous);
    // Explicit cancel after BEGIN loses valid image, does not roll back. Reconnection starts at zero.
    await begin(c,pkg);await page(c,pkg);await device.disconnect();
    const interrupted=await c.info();assert.equal(interrupted.nextOffset,0);assert.equal(interrupted.imageValid,false);
    c.close('disconnected session');c=client(device,30001);
    const fresh=await c.upload(pkg);assert.equal(fresh.written,true);assert.equal(fresh.applicationStartVerified,false);
    const firstBegin=device.frames.find(frame=>frame.id>=30001&&frame.command===C.BEGIN);
    assert.equal(firstBegin.id,30002,'recovery creates a fresh BEGIN ID, never resumes old offset');
    await device.reset();identity(await c.info(),pkg);
    return{initialFlash:'erased simulation, with new Boot compiled from current C',actualBootVersion:blank.bootVersion,minimumBootVersion:pkg.minBootVersion,from:previous.versionText,fromLayout:previous.layoutId,to:pkg.versionText,toLayout:pkg.layoutId,
      signedDowngrade:true,exactTargetSkipsBegin:true,requests:device.frames.length,repair:true,disconnectRecovery:true};
  }finally{c.close('test finished');await device.close();}
}

async function publicFixture(){
  const vectorsFile=path.join(firmware,'tests/ota_vectors.json');
  const vectors=JSON.parse(fs.readFileSync(vectorsFile,'utf8'));
  const bytes=Buffer.from(vectors.manifest_hex+vectors.payload_hex,'hex');
  const pkg=await P.verifyPackage(bytes,{name:'public_fixture.ota',publicKey:vectors.public_key_raw_hex});
  const device=await PipeDevice.open({vectors:vectorsFile}),c=client(device,40001);
  try{
    const result=await c.upload(pkg);assert.equal(result.written,true);assert.equal(result.applicationStartVerified,false);
    await device.reset();identity(await c.info(),pkg);
    const alternate=vectors.manifest_cases.find(v=>v.name==='same_version_other_image'&&v.expected_status===0);
    assert.ok(alternate?.payload_hex,'published disposable same-version/different-image vector is required');
    const other=await P.verifyPackage(Buffer.from(alternate.manifest_hex+alternate.payload_hex,'hex'),{name:'same_version_other_image.ota',publicKey:vectors.public_key_raw_hex});
    assert.equal(other.version,pkg.version);assert.equal(other.layoutId,pkg.layoutId);assert.notEqual(other.imageSha256,pkg.imageSha256);
    const rewritten=await c.upload(other);assert.equal(rewritten.written,true);assert.equal(rewritten.alreadyPresent,false);
    await device.reset();identity(await c.info(),other);
    const restored=await c.upload(pkg);assert.equal(restored.written,true,'same-version original image can be restored');
    await device.reset();identity(await c.info(),pkg);
    const begins=device.frames.filter(f=>f.command===C.BEGIN).length;
    assert.equal((await c.upload(pkg)).written,false);assert.equal(device.frames.filter(f=>f.command===C.BEGIN).length,begins);
    return{requests:device.frames.length,imageSize:pkg.imageSize,layoutId:pkg.layoutId,sameVersionDifferentImage:true,restoreOriginalImage:true,exactTargetSkipsBegin:true};
  }finally{c.close('test finished');await device.close();}
}
async function main(){
  assert.ok(fs.existsSync(python),'offline Python environment must exist');
  assert.ok(fs.existsSync(path.join(firmware,'tools/ota_simulator.py')),'authoritative real-C simulator must exist');
  const cli=process.argv.indexOf('--package');
  const latest=path.join(firmware,'dist/ota/py32_2.0.0/xiaobai_py32_2.0.0.ota');
  const file=cli>=0?path.resolve(process.argv[cli+1]):fs.existsSync(latest)?latest:path.join(firmware,'dist/ota/py32_1.0.0/xiaobai_py32_1.0.0.ota');
  const pkg=await loadPackage(file);
  const result={scope:'OFFLINE real C Core/Codec/P256 + simulated Flash; no hardware, no App startup claimed',
    package:path.resolve(file),version:pkg.versionText,imageSize:pkg.imageSize,packageSha256:pkg.packageSha256,
    recovery:await recoveryAndRetry(pkg),upgrade:await genuineUpgrade(pkg),fixture:await publicFixture()};
  console.log('PASS '+JSON.stringify(result,null,2));
}
module.exports={PipeDevice};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
