// Only the native BLE/firmware boundary is synthetic. All App/controller/UI code is real.
module.exports=function mockFirmware(options){
  const control=window.mockBle,bridge=window.Capacitor,original=bridge.nativePromise.bind(bridge),target=options.target;
  window.__XIAOBAI_BLE_TIMING={firstScanMs:80,defaultScanMs:160};
  control.state.otaTransportVersion=1;control.devices=[{deviceId:'FW-BOUND',name:'Spark_AI',advertisedName:'Spark_AI',cachedName:'Old Android Cache',rssi:-38}];
  control.otaCalls=[];control.c2=[];control.mode=0;control.counter=0;control.otaUid='0102030405060708090a0b0c';
  control.emitVersion=options.emitVersion!==false;control.rejectInfo=Boolean(options.rejectInfo);control.dropInfo=Boolean(options.dropInfo);
  control.badPostUid=Boolean(options.badPostUid);control.holdDataAck=Boolean(options.holdDataAck);control.didFinish=false;control.rawActive=false;control.nativePending=null;
  control.writeFailures=[];control.infoWriteDisconnect=options.infoWriteDisconnect;control.bootInfoRequests=0;control.dataRequests=0;control.enterRequests=0;control.nativeDisconnects=[];
  control.dropBootInfoCount=options.dropBootInfoCount||0;control.disconnectBootInfoAt=options.disconnectBootInfoAt||0;
  control.disconnectDataAt=options.disconnectDataAt||0;control.disconnectEnterAt=options.disconnectEnterAt||0;
  control.dropConnection=(reason='native GATT disconnected',id=control.connectionId)=>{
    control.nativeDisconnects.push({id,reason,at:performance.now()});
    if(id===control.connectionId){control.connectionId=null;control.subscribed=false;control.rawActive=false;control.nativePending=null;}
    control.emit('disconnected',{connectionId:id,reason});
  };
  control.appAvailable=options.appAvailable!==false;control.appIdentity={protocol:1,boardId:258,bootVersion:65536,version:options.version??target.version,mode:0,imageValid:options.imageValid!==false,state:0,lastError:0,imageSize:target.imageSize,nextOffset:0,imageSha256:target.imageSha256};
  if(control.appIdentity.version!==target.version){control.appIdentity.imageSize=320;control.appIdentity.imageSha256='1'.repeat(64);}
  if(options.collision)control.appIdentity.imageSha256='2'.repeat(64);
  if(!control.appAvailable)control.appIdentity.mode=1;
  if(options.pending)localStorage.setItem('xiaobai:ota:binding:v1',JSON.stringify({deviceId:'FW-BOUND',uid:control.otaUid,name:'Spark_AI',pending:options.pending,written:Boolean(options.pendingWritten)}));
  for(const header of bridge.PluginHeaders)if(header.name==='SparkBle')for(const name of ['beginOta','writeOta','endOta'])if(!header.methods.some(m=>m.name===name))header.methods.push({name,rtype:'promise'});
  function packet(type,data,id=control.connectionId){const b=[0x5a,0x98,0x97,10,type,...data];while(b.length<15)b.push(0);b.push(b.reduce((s,v)=>s+v,0)&255,0xa5);if(b.length!==17)throw new Error('mock packet length');control.feed(String.fromCharCode(...b),id);}
  function d2(seq,op,result,data,id=control.connectionId){const delay=op===0x60||op===0x56?control.infoDelay||4:4;setTimeout(()=>packet(0xd2,[seq,op,result,...data],id),delay);}
  function infoBytes(){const i=control.appIdentity,b=new Uint8Array(60),d=new DataView(b.buffer);d.setUint32(0,0x31494258,true);d.setUint16(4,i.protocol,true);d.setUint16(6,i.boardId,true);d.setUint32(8,i.bootVersion,true);d.setUint32(12,i.version,true);b.set([i.mode,+i.imageValid,i.state,i.lastError],16);d.setUint32(20,i.imageSize,true);d.setUint32(24,i.nextOffset,true);b.set(XiaobaiOtaProtocol.unhex(i.imageSha256),28);return b;}
  control.versionEvent=(version=control.appIdentity.version,id=control.connectionId)=>{const b=new Uint8Array(8),d=new DataView(b.buffer);d.setUint32(0,version,true);d.setUint16(4,control.appIdentity.boardId,true);b[6]=control.appIdentity.protocol;b[7]=+control.appIdentity.imageValid;packet(0xd3,[10,++control.counter&255,...b],id);};
  control.respondC2=bytes=>{
    const seq=bytes[5],op=bytes[6],part=bytes[7],id=control.connectionId;
    control.c2.push({seq,op,part,bytes:Array.from(bytes),id,at:performance.now()});
    if(!control.appAvailable)return true;
    if(op===1){control.mode=4;if(control.emitVersion)setTimeout(()=>control.versionEvent(control.appIdentity.version,id),2);return true;}
    if(op===2){control.mode=3;return true;}
    if(op===3){control.lastHeartbeat=performance.now();return true;}
    if(op===4){d2(seq,op,0,[control.mode,25,25,25,60,15,control.healthFault||0],id);return true;}
    if(op===5)return true;
    if(op===0x60){if(!control.dropInfo){const b=infoBytes();d2(seq,op,control.rejectInfo?2:0,[part,...b.slice(part*6,part*6+6)],id);}return true;}
    if(op===0x56){const uid=XiaobaiOtaProtocol.unhex(control.badPostUid&&control.didFinish?'0102030405060708090a0b0d':control.otaUid);d2(seq,op,0,[part,...uid.slice(part*6,part*6+6)],id);return true;}
    if(op===0x52){d2(seq,op,0,[...bytes.slice(7,11),0,0,15],id);return true;}
    if(op===0x57){d2(seq,op,0,[...bytes.slice(7,11),bytes[11],0,0],id);return true;}
    if(op===0x61){control.enterRequests++;control.appAvailable=false;control.appIdentity.mode=1;
      if(control.disconnectEnterAt===control.enterRequests){setTimeout(()=>control.dropConnection('ENTER ACK lost and native disconnected',id),1);return true;}
      if(!control.dropEnterAck)d2(seq,op,0,[],id);return true;}
    return false;
  };
  bridge.nativePromise=async(plugin,method,opts={})=>{
    if(plugin==='SparkBle'&&method==='connect'){
      const result=await original(plugin,method,opts);return{...result,advertisedName:'Spark_AI',cachedName:'Old Android Cache',name:'Spark_AI',otaTransportVersion:1};
    }
    if(plugin==='SparkBle'&&method==='disconnect'){control.rawActive=false;control.nativePending=null;return original(plugin,method,opts);}
    if(plugin==='SparkBle'&&method==='endOta'){control.rawActive=false;control.nativePending=null;return original(plugin,'disconnect',opts);}
    if(plugin==='SparkBle'&&method==='beginOta'){
      if(opts.connectionId!==control.connectionId||!control.subscribed)throw new Error('raw bridge must use subscribed current epoch');
      control.rawActive=true;control.otaCalls.push({method,id:opts.connectionId,at:performance.now()});return{chunkBytes:20,chunkIntervalMs:40,rxQuietMs:40,otaTransportVersion:1};
    }
    if(plugin==='SparkBle'&&method==='writeOta'){
      if(!control.rawActive||opts.connectionId!==control.connectionId||!control.subscribed)throw new Error('stale raw OTA write');
      const P=XiaobaiOtaProtocol,bytes=Uint8Array.from(atob(opts.data),c=>c.charCodeAt(0)),frame=P.decodeFrame(bytes),op=frame.command;
      if(control.nativePending&&P.hex(control.nativePending)!==P.hex(bytes))throw new Error('native pending request ID not retired');
      control.nativePending=bytes.slice();control.otaCalls.push({method,op,requestId:frame.requestId,id:opts.connectionId,bytes:bytes.length,at:performance.now()});
      if(op===P.OP.INFO){control.bootInfoRequests++;
        if(control.bootInfoRequests===1&&control.infoWriteDisconnect){
          const reject=()=>{control.writeFailures.push({op,id:opts.connectionId,at:performance.now()});return new Error('BLE connection closed');};
          if(control.infoWriteDisconnect==='disconnect-first'){control.dropConnection('INFO native write close',opts.connectionId);throw reject();}
          const failure=reject();setTimeout(()=>control.dropConnection('INFO native write close',opts.connectionId),1);throw failure;
        }

        if(control.disconnectBootInfoAt===control.bootInfoRequests){setTimeout(()=>control.dropConnection('first Boot INFO native disconnect',opts.connectionId),1);return{};}
        if(control.bootInfoRequests<=control.dropBootInfoCount)return{};
      }
      if(op===P.OP.DATA){control.dataRequests++;
        if(control.disconnectDataAt===control.dataRequests){setTimeout(()=>control.dropConnection('DATA native disconnect',opts.connectionId),1);return{};}
        if(control.holdDataAck)return{};
      }
      let response;
      const offsetBytes=n=>{const b=new Uint8Array(5);new DataView(b.buffer).setUint32(1,n,true);return b;};
      if(op===P.OP.INFO)response=P.concat([0],infoBytes());
      else if(op===P.OP.BEGIN){control.uploadTarget=P.parseManifest(frame.payload);control.committed=0;control.appIdentity.imageValid=false;control.appIdentity.state=options.stateAfterBegin??1;control.appIdentity.nextOffset=0;response=offsetBytes(0);}
      else if(op===P.OP.DATA){const d=new DataView(frame.payload.buffer,frame.payload.byteOffset,frame.payload.byteLength),offset=d.getUint32(0,true);if(offset!==control.committed)throw new Error('nonsequential DATA');control.committed+=frame.payload.length-4;control.appIdentity.nextOffset=control.committed;response=offsetBytes(control.committed);}
      else if(op===P.OP.FINISH){if(control.uploadTarget){const t=control.uploadTarget;if(control.committed!==t.imageSize)throw new Error('unfinished image');Object.assign(control.appIdentity,{version:t.version,imageSize:t.imageSize,imageSha256:t.imageSha256,imageValid:true,state:0,nextOffset:0,mode:0});control.didFinish=true;}control.appAvailable=true;control.mode=0;response=offsetBytes(control.appIdentity.imageSize);}
      else throw new Error('unknown raw opcode');
      if(op===P.OP.FINISH&&control.dropFinishAck)return{};
      const encoded=P.encodeFrame(op|0x80,frame.requestId,response),id=opts.connectionId;
      setTimeout(()=>{if(id!==control.connectionId)return;control.nativePending=null;for(let i=0;i<encoded.length;i+=20)control.emit('otaNotification',{connectionId:id,data:btoa(String.fromCharCode(...encoded.slice(i,i+20)))});},4);
      return{};
    }
    return original(plugin,method,opts);
  };
};
