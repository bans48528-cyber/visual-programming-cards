(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.XiaobaiOtaProtocol=api;
})(globalThis,function(){
  'use strict';
  // Generated from firmware Shared/Ota_Layout.h and Shared/Ota_PublicKey.h.
  // Run node scripts/sync-ota-contract.cjs --firmware <firmware-root> [--check].
  // BEGIN GENERATED OTA CONTRACT
  const LAYOUT=Object.freeze({
    "OTA_FLASH_BASE": 134217728,
    "OTA_BOOT_SIZE": 16384,
    "OTA_APP_BASE": 134234112,
    "OTA_APP_LIMIT": 134279168,
    "OTA_APP_CAPACITY": 45056,
    "OTA_META_BASE": 134279168,
    "OTA_FLASH_END": 134283264,
    "OTA_PAGE_SIZE": 128,
    "OTA_SECTOR_SIZE": 4096,
    "OTA_RAM_BASE": 536870912,
    "OTA_RAM_LIMIT": 536879040,
    "OTA_HANDOFF_BASE": 536879040,
    "OTA_BOARD_ID": 258,
    "OTA_PROTOCOL_VERSION": 1,
    "OTA_MANIFEST_SIZE": 128,
    "OTA_MANIFEST_HEADER_SIZE": 64,
    "OTA_INFO_SIZE": 60,
    "OTA_INFO_PARTS": 10,
    "OTA_INFO_PART_BYTES": 6,
    "OTA_FRAME_HEADER_SIZE": 16,
    "OTA_MAX_PAYLOAD": 160,
    "OTA_FRAME_MAX": 176,
    "OTA_DATA_MAX": 128,
    "OTA_APP_VERSION": 65540,
    "OTA_BOOT_VERSION": 65537,
    "OTA_MANIFEST_MAGIC": 827146840,
    "OTA_INFO_MAGIC": 826884696,
    "OTA_RECORD_MAGIC": 827736664,
    "OTA_HANDOFF_MAGIC": 826819160,
    "OTA_HANDOFF_REQUEST": 1,
    "OTA_HANDOFF_POWERED": 2,
    "OTA_HANDOFF_CHECK": 3074464451,
    "OTA_OP_INFO": 96,
    "OTA_OP_ENTER": 97,
    "OTA_OP_BEGIN": 98,
    "OTA_OP_DATA": 99,
    "OTA_OP_FINISH": 100,
    "OTA_RESPONSE_FLAG": 128,
    "OTA_MODE_APP": 0,
    "OTA_MODE_BOOT": 1,
    "OTA_STATE_IDLE": 0,
    "OTA_STATE_RECEIVING": 1,
    "OTA_STATE_VERIFYING": 2,
    "OTA_OK": 0,
    "OTA_ERR_FRAME": 1,
    "OTA_ERR_PARAM": 2,
    "OTA_ERR_BOARD": 3,
    "OTA_ERR_VERSION": 4,
    "OTA_ERR_SIGNATURE": 5,
    "OTA_ERR_FLASH": 6,
    "OTA_ERR_OFFSET": 7,
    "OTA_ERR_HASH": 8,
    "OTA_ERR_STATE": 9,
    "OTA_ERR_VECTOR": 10,
    "OTA_ERR_BUSY": 11,
    "OTA_ERR_POWER": 12
  });
  const PUBLIC_KEY_HEX='c3709282870d7868beaf60fcd9ebdbc13f58a5aec9120daef1a1cb8b7422de6b0878fae066557512ddd0b01de64f6094b0fa79e9b142fb3d9eaa4a3e033e134a';
  // END GENERATED OTA CONTRACT
  const OP=Object.freeze({INFO:LAYOUT.OTA_OP_INFO,ENTER:LAYOUT.OTA_OP_ENTER,
    BEGIN:LAYOUT.OTA_OP_BEGIN,DATA:LAYOUT.OTA_OP_DATA,FINISH:LAYOUT.OTA_OP_FINISH});
  const MAGIC=Uint8Array.of(0x58,0x42,0x4f,0x54);
  function fail(code,message,status){const error=new Error(message);error.code=code;if(status!==undefined)error.status=status;throw error;}
  function asBytes(value){
    if(value instanceof ArrayBuffer)return new Uint8Array(value);
    if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    if(Array.isArray(value)&&value.every(v=>Number.isInteger(v)&&v>=0&&v<=255))return Uint8Array.from(value);
    fail('BYTES','升级数据格式无效。');
  }
  const copy=value=>Uint8Array.from(asBytes(value));
  const view=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const hex=bytes=>Array.from(asBytes(bytes),v=>v.toString(16).padStart(2,'0')).join('');
  function unhex(value){
    if(typeof value!=='string'||value.length%2||!/^[a-f0-9]*$/i.test(value))fail('HEX','升级数据十六进制格式无效。');
    return Uint8Array.from(value.match(/../g)||[],v=>parseInt(v,16));
  }
  function uint(value,max=0xffffffff){return Number.isInteger(value)&&value>=0&&value<=max;}
  function concat(...values){
    const arrays=values.map(asBytes),result=new Uint8Array(arrays.reduce((sum,b)=>sum+b.length,0));
    let offset=0;for(const bytes of arrays){result.set(bytes,offset);offset+=bytes.length;}return result;
  }
  const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  function crc32(bytes){let c=0xffffffff;for(const byte of asBytes(bytes))c=crcTable[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
  function encodeFrame(command,requestId,payload=[]){
    const data=asBytes(payload);
    if(!uint(command,255)||!uint(requestId)||data.length>LAYOUT.OTA_MAX_PAYLOAD)fail('FRAME','升级帧的指令、编号或长度无效。');
    const bytes=new Uint8Array(LAYOUT.OTA_FRAME_HEADER_SIZE+data.length),dv=view(bytes);
    bytes.set(MAGIC);bytes[4]=LAYOUT.OTA_PROTOCOL_VERSION;bytes[5]=command;
    dv.setUint16(6,data.length,true);dv.setUint32(8,requestId,true);bytes.set(data,16);
    dv.setUint32(12,crc32(concat(bytes.subarray(0,12),data)),true);return bytes;
  }
  function decodeFrame(input){
    const bytes=asBytes(input);
    if(bytes.length<LAYOUT.OTA_FRAME_HEADER_SIZE)fail('FRAME_LENGTH','升级反馈尚不完整。');
    const dv=view(bytes),length=dv.getUint16(6,true);
    if(MAGIC.some((byte,i)=>bytes[i]!==byte)||bytes[4]!==LAYOUT.OTA_PROTOCOL_VERSION)fail('FRAME_PROTOCOL','升级反馈协议无效。');
    if(length>LAYOUT.OTA_MAX_PAYLOAD||bytes.length!==LAYOUT.OTA_FRAME_HEADER_SIZE+length)fail('FRAME_LENGTH','升级反馈长度无效。');
    if(dv.getUint32(12,true)!==crc32(concat(bytes.subarray(0,12),bytes.subarray(16))))fail('FRAME_CRC','升级反馈校验失败。');
    return {command:bytes[5],requestId:dv.getUint32(8,true),payload:copy(bytes.subarray(16)),bytes:copy(bytes)};
  }
  class Receiver{
    constructor(onFrame,{staleMs=1000,now=()=>Date.now()}={}){
      if(typeof onFrame!=='function'||typeof now!=='function'||!Number.isFinite(staleMs)||staleMs<=0)fail('RECEIVER','升级接收器配置无效。');
      this.onFrame=onFrame;this.staleMs=staleMs;this.now=now;this.buffer=[];this.lastReceive=null;
    }
    reset(){this.buffer.length=0;this.lastReceive=null;}
    feed(input){
      const data=asBytes(input),time=this.now();
      if(!data.length)return;
      if(this.lastReceive!==null&&time-this.lastReceive>=this.staleMs)this.buffer.length=0;
      this.lastReceive=time;
      // Incremental consumption bounds storage even for a hostile multi-megabyte notification.
      for(const byte of data){this.buffer.push(byte);this.drain();}
    }
    drain(){
      const b=this.buffer;
      for(;;){
        while(b.length&&b[0]!==MAGIC[0])b.shift();
        if(b.length<4)return;
        if(MAGIC.some((byte,i)=>b[i]!==byte)){b.shift();continue;}
        if(b.length<8)return;
        const n=b[6]|b[7]<<8;
        if(b[4]!==LAYOUT.OTA_PROTOCOL_VERSION||n>LAYOUT.OTA_MAX_PAYLOAD){b.shift();continue;}
        if(b.length<16+n)return;
        let frame;try{frame=decodeFrame(b.slice(0,16+n));}catch(_){b.shift();continue;}
        b.splice(0,16+n);this.onFrame(frame);
      }
    }
  }
  function versionText(value){
    if(!uint(value))fail('VERSION','固件版本格式无效。');
    return `${value>>>16}.${value>>>8&255}.${value&255}`;
  }
  function parseInfo60(input){
    const bytes=asBytes(input);
    if(bytes.length!==LAYOUT.OTA_INFO_SIZE)fail('INFO_LENGTH','主控升级信息不完整。');
    const d=view(bytes);
    if(d.getUint32(0,true)!==LAYOUT.OTA_INFO_MAGIC)fail('INFO_MAGIC','设备没有返回有效的主控升级信息。');
    const info={protocol:d.getUint16(4,true),boardId:d.getUint16(6,true),bootVersion:d.getUint32(8,true),
      version:d.getUint32(12,true),mode:bytes[16],imageValid:!!bytes[17],state:bytes[18],lastError:bytes[19],
      imageSize:d.getUint32(20,true),nextOffset:d.getUint32(24,true),imageSha256:hex(bytes.subarray(28,60))};
    if(info.mode>1||bytes[17]>1||info.state>2)fail('INFO_STATE','设备返回的升级状态无效。');
    if(info.imageSize>LAYOUT.OTA_APP_CAPACITY||info.nextOffset>LAYOUT.OTA_APP_CAPACITY)fail('INFO_BOUNDS','设备返回的镜像范围无效。');
    // Keep unsupported board/protocol visible to Settings, never silently claim compatibility.
    info.supported=info.protocol===LAYOUT.OTA_PROTOCOL_VERSION&&info.boardId===LAYOUT.OTA_BOARD_ID;
    return Object.freeze(info);
  }
  function assembleAppInfo(parts){
    const collected=new Map();
    for(const value of parts){
      const bytes=asBytes(value),part=bytes[0];
      if(bytes.length!==7||part>=LAYOUT.OTA_INFO_PARTS||collected.has(part))fail('INFO_PART','主控升级信息包含重复或无效分段，请重新读取。');
      collected.set(part,copy(bytes.subarray(1)));
    }
    if(collected.size!==LAYOUT.OTA_INFO_PARTS)fail('INFO_PART','主控升级信息缺少分段，请重新读取。');
    return parseInfo60(concat(...Array.from({length:LAYOUT.OTA_INFO_PARTS},(_,i)=>collected.get(i))));
  }
  function parseManifest(input){
    const manifest=asBytes(input);
    if(manifest.length!==LAYOUT.OTA_MANIFEST_SIZE)fail('MANIFEST_LENGTH','固件清单长度必须为 128 字节。',LAYOUT.OTA_ERR_PARAM);
    const d=view(manifest);
    if(d.getUint32(0,true)!==LAYOUT.OTA_MANIFEST_MAGIC||d.getUint16(4,true)!==1||manifest.subarray(56,64).some(Boolean))
      fail('MANIFEST','固件包头格式无效。',LAYOUT.OTA_ERR_PARAM);
    const fields={format:d.getUint16(4,true),boardId:d.getUint16(6,true),version:d.getUint32(8,true),
      imageSize:d.getUint32(12,true),appBase:d.getUint32(16,true),minBoot:d.getUint32(20,true),imageSha256:hex(manifest.subarray(24,56))};
    fields.minBootVersion=fields.minBoot;
    if(fields.boardId!==LAYOUT.OTA_BOARD_ID)fail('BOARD','固件不适用于这款主板。',LAYOUT.OTA_ERR_BOARD);
    if(fields.appBase!==LAYOUT.OTA_APP_BASE||fields.imageSize<192||fields.imageSize>LAYOUT.OTA_APP_CAPACITY)
      fail('MANIFEST_BOUNDS','固件大小或目标地址无效。',LAYOUT.OTA_ERR_PARAM);
    if(!fields.version)fail('VERSION','固件版本无效。',LAYOUT.OTA_ERR_VERSION);
    return fields;
  }
  function validateVectors(image){
    const data=asBytes(image);
    if(data.length<192||data.length>LAYOUT.OTA_APP_CAPACITY)fail('IMAGE_SIZE','固件镜像大小无效。',LAYOUT.OTA_ERR_PARAM);
    const d=view(data),stack=d.getUint32(0,true),reset=d.getUint32(4,true),entry=(reset&0xfffffffe)>>>0;
    if(stack%8||stack<=LAYOUT.OTA_RAM_BASE+192||stack>LAYOUT.OTA_RAM_LIMIT||!(reset&1)||entry<LAYOUT.OTA_APP_BASE||entry>=LAYOUT.OTA_APP_BASE+data.length)
      fail('IMAGE_VECTOR','固件启动向量无效。',LAYOUT.OTA_ERR_VECTOR);
  }
  async function verifyPackage(input,{name='firmware.ota',publicKey=PUBLIC_KEY_HEX,crypto=globalThis.crypto}={}){
    // Copy before any await: a caller cannot change the verified package mid-validation/upload.
    const bytes=copy(input);
    if(typeof name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._ -]*\.ota$/i.test(name))fail('FILENAME','请选择英文文件名的 .ota 固件包。');
    if(bytes.length<LAYOUT.OTA_MANIFEST_SIZE+192||bytes.length>LAYOUT.OTA_MANIFEST_SIZE+LAYOUT.OTA_APP_CAPACITY)
      fail('PACKAGE_SIZE','固件包大小超出主板支持范围。',LAYOUT.OTA_ERR_PARAM);
    const manifest=bytes.slice(0,LAYOUT.OTA_MANIFEST_SIZE),image=bytes.slice(LAYOUT.OTA_MANIFEST_SIZE),fields=parseManifest(manifest);
    if(image.length!==fields.imageSize)fail('PACKAGE_LENGTH','固件声明长度与文件大小不一致。',LAYOUT.OTA_ERR_PARAM);
    if(!crypto?.subtle)fail('CRYPTO_UNAVAILABLE','此系统无法执行固件来源校验，请更新 Android 系统组件。');
    const digest=hex(await crypto.subtle.digest('SHA-256',image));
    if(digest!==fields.imageSha256)fail('IMAGE_HASH','固件内容校验失败，请重新选择完整文件。',LAYOUT.OTA_ERR_HASH);
    let valid=false;
    try{
      const key=typeof publicKey==='string'?unhex(publicKey):asBytes(publicKey);
      if(key.length!==64)throw new Error('key length');
      const imported=await crypto.subtle.importKey('raw',concat([4],key),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      // WebCrypto hashes these 64 original bytes ONCE. Pass raw r||s, never DER or a pre-hashed digest.
      valid=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},imported,manifest.subarray(64,128),manifest.subarray(0,64));
    }catch(error){if(error.code==='CRYPTO_UNAVAILABLE')throw error;}
    if(!valid)fail('SIGNATURE','固件来源签名无效，请使用可信固件包。',LAYOUT.OTA_ERR_SIGNATURE);
    validateVectors(image);
    const packageSha256=hex(await crypto.subtle.digest('SHA-256',bytes));
    return Object.freeze({...fields,name,manifest,image,bytes,packageSha256,versionText:versionText(fields.version),signatureVerified:true});
  }
  function checkCompatibility(pkg,info,{repair=false}={}){
    if(!info||info.protocol!==LAYOUT.OTA_PROTOCOL_VERSION||info.boardId!==LAYOUT.OTA_BOARD_ID||pkg.boardId!==info.boardId)
      fail('COMPATIBILITY','当前硬件或升级协议不支持此固件。',LAYOUT.OTA_ERR_BOARD);
    if(pkg.minBoot>info.bootVersion)fail('BOOT_VERSION','当前升级引导版本过低，需要通过 DAP 更新。',LAYOUT.OTA_ERR_VERSION);
    if(info.imageValid){
      if(pkg.version<info.version)fail('DOWNGRADE','不支持降级到较旧固件。',LAYOUT.OTA_ERR_VERSION);
      if(pkg.version===info.version){
        if(pkg.imageSha256!==info.imageSha256||pkg.imageSize!==info.imageSize)
          fail('VERSION_COLLISION','同一版本的固件内容不一致，已拒绝升级。',LAYOUT.OTA_ERR_VERSION);
        return Object.freeze({alreadyPresent:true,needsWrite:!!repair});
      }
    }
    return Object.freeze({alreadyPresent:false,needsWrite:true});
  }
  return Object.freeze({LAYOUT,C:LAYOUT,PUBLIC_KEY_HEX,OP,CMD:OP,asBytes,concat,hex,unhex,crc32,
    encodeFrame,decodeFrame,Receiver,versionText,parseInfo60,parseInfo:parseInfo60,assembleAppInfo,
    parseManifest,validateVectors,verifyPackage,checkCompatibility});
});
