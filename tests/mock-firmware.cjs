module.exports = function mockFirmware(options){

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
  control.appAvailable=options.appAvailable!==false;control.appIdentity={protocol:1,schemaVersion:options.schemaVersion??target.format??1,layoutId:options.layoutId??target.layoutId??1,activeAppBase:options.appBase??target.appBase??0x08004000,erasePage:128,capabilities:options.capabilities??(target.format===2?15:1),boardId:258,bootVersion:options.bootVersion??target.minBootVersion,version:options.version??target.version,mode:0,imageValid:options.imageValid!==false,state:0,lastError:0,imageSize:target.imageSize,nextOffset:0,imageSha256:target.imageSha256};
  // Model the actual Boot independently: legacy Apps report their compiled Boot.
  control.bootIdentity={bootVersion:options.actualBootVersion??control.appIdentity.bootVersion,schemaVersion:options.bootSchemaVersion??control.appIdentity.schemaVersion,capabilities:options.bootCapabilities??control.appIdentity.capabilities};
  if(control.appIdentity.version!==target.version){control.appIdentity.imageSize=320;control.appIdentity.imageSha256='1'.repeat(64);}
  if(options.collision)control.appIdentity.imageSha256='2'.repeat(64);
  if(!control.appAvailable)control.appIdentity.mode=1;
  if(options.pending)localStorage.setItem('xiaobai:ota:binding:v1',JSON.stringify({deviceId:'FW-BOUND',uid:control.otaUid,name:'Spark_AI',pending:options.pending,written:Boolean(options.pendingWritten)}));
  for(const header of bridge.PluginHeaders)if(header.name==='SparkBle')for(const name of ['beginOta','writeOta','endOta'])if(!header.methods.some(m=>m.name===name))header.methods.push({name,rtype:'promise'});
  function packet(type,data,id=control.connectionId){const b=[0x5a,0x98,0x97,10,type,...data];while(b.length<15)b.push(0);b.push(b.reduce((s,v)=>s+v,0)&255,0xa5);if(b.length!==17)throw new Error('mock packet length');control.feed(String.fromCharCode(...b),id);}
  function d2(seq,op,result,data,id=control.connectionId){const delay=op===0x60||op===0x56?control.infoDelay||4:4;setTimeout(()=>packet(0xd2,[seq,op,result,...data],id),delay);}
  function infoBytes(boot=false){const i=boot?{...control.appIdentity,...control.bootIdentity,mode:1}:control.appIdentity,b=new Uint8Array(i.schemaVersion===2?72:60),d=new DataView(b.buffer);d.setUint32(0,0x31494258,true);d.setUint16(4,i.schemaVersion,true);d.setUint16(6,i.boardId,true);d.setUint32(8,i.bootVersion,true);d.setUint32(12,i.version,true);b.set([i.mode,+i.imageValid,i.state,i.lastError],16);d.setUint32(20,i.imageSize,true);d.setUint32(24,i.nextOffset,true);b.set(XiaobaiOtaProtocol.unhex(i.imageSha256),28);if(i.schemaVersion===2){d.setUint32(60,i.layoutId,true);d.setUint32(64,i.activeAppBase,true);d.setUint16(68,i.erasePage,true);d.setUint16(70,i.capabilities,true);}return b;}
  control.versionEvent=(version=control.appIdentity.version,id=control.connectionId)=>{const b=new Uint8Array(8),d=new DataView(b.buffer);d.setUint32(0,version,true);d.setUint16(4,control.appIdentity.boardId,true);b[6]=control.appIdentity.schemaVersion;b[7]=+control.appIdentity.imageValid;packet(0xd3,[10,++control.counter&255,...b],id);};
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
      if(op===P.OP.INFO)response=P.concat([0],infoBytes(true));
      else if(op===P.OP.BEGIN){control.uploadTarget=P.parseManifest(frame.payload);control.committed=0;control.appIdentity.imageValid=false;control.appIdentity.state=options.stateAfterBegin??1;control.appIdentity.nextOffset=0;response=offsetBytes(0);}
      else if(op===P.OP.DATA){const d=new DataView(frame.payload.buffer,frame.payload.byteOffset,frame.payload.byteLength),offset=d.getUint32(0,true);if(offset!==control.committed)throw new Error('nonsequential DATA');control.committed+=frame.payload.length-4;control.appIdentity.nextOffset=control.committed;response=offsetBytes(control.committed);}
      else if(op===P.OP.FINISH){if(control.uploadTarget){const t=control.uploadTarget;if(control.committed!==t.imageSize)throw new Error('unfinished image');Object.assign(control.appIdentity,{version:t.version,imageSize:t.imageSize,imageSha256:t.imageSha256,layoutId:t.layoutId,activeAppBase:t.appBase,schemaVersion:t.format,erasePage:t.erasePage,imageValid:true,state:0,nextOffset:0,mode:0});control.didFinish=true;}else if(!control.appIdentity.imageValid||control.appIdentity.state!==0){response=Uint8Array.of(9);}if(!response){control.appIdentity.mode=0;control.appAvailable=true;control.mode=0;response=offsetBytes(control.appIdentity.imageSize);}}
      else throw new Error('unknown raw opcode');
      if(op===P.OP.FINISH&&control.dropFinishAck)return{};
      const encoded=P.encodeFrame(op|0x80,frame.requestId,response),id=opts.connectionId;
      setTimeout(()=>{if(id!==control.connectionId)return;control.nativePending=null;for(let i=0;i<encoded.length;i+=20)control.emit('otaNotification',{connectionId:id,data:btoa(String.fromCharCode(...encoded.slice(i,i+20)))});},4);
      return{};
    }
    return original(plugin,method,opts);
  };

  // App 128 native contract additions. No App, Gate, adapter, proof, or Session stubs.
  const lower=bridge.nativePromise.bind(bridge),spec=options.topology;
  control.boundary={calls:[],frames:[],connections:{},listeners:[],removed:[]};
  const priorCallback=bridge.nativeCallback.bind(bridge);
  bridge.nativeCallback=(plugin,method,opts,callback)=>{const id=priorCallback(plugin,method,opts,callback);if(plugin==='SparkBle'&&method==='addListener')control.boundary.listeners.push({id,event:opts.eventName});return id;};
  const peers=new Map();
  if(spec){
    for(const value of spec.peers){const peer={...value};peer.identity={...control.appIdentity,...peer.identity,bootVersion:peer.bootVersion??control.appIdentity.bootVersion,mode:peer.kind==='app'?0:1};peer.boot={...control.bootIdentity,bootVersion:peer.bootVersion??control.bootIdentity.bootVersion};peers.set(peer.deviceId,peer);}
    control.devices=spec.peers.filter(p=>p.advertise!==false).map(p=>({deviceId:p.deviceId,name:p.name??'',advertisedName:p.name??'',rssi:p.rssi??-40}));
    if(spec.binding)localStorage.setItem('xiaobai:ota:binding:v1',JSON.stringify(spec.binding));
    if(spec.aliases)localStorage.setItem('xiaobai:uid-locators:v1',JSON.stringify(spec.aliases));
  }
  function activePeer(){const epoch=control.boundary.connections[control.connectionId];return epoch?.peer;}
  control.configureNativePeer=(deviceId,changes)=>{const p=peers.get(deviceId);if(!p)throw new Error('unknown mock peer');Object.assign(p,changes);if(changes.bootVersion)p.boot={...p.boot,bootVersion:changes.bootVersion};if(changes.identity)p.identity={...p.identity,...changes.identity};};
  function applyPeer(peer,probeOnly){if(!peer)return;control.appIdentity=peer.identity;control.bootIdentity={...peer.boot,bootVersion:(!probeOnly?peer.writeBootVersion:null)??peer.boot.bootVersion};control.appAvailable=peer.kind==='app';control.otaUid=(probeOnly?peer.probeUid:peer.writeUid)??peer.uid??'0102030405060708090a0b0c';control.infoDelay=probeOnly?peer.probeAppDelay??4:4;}
  const originalC2=control.respondC2;
  control.respondC2=bytes=>{const peer=activePeer(),epoch=control.boundary.connections[control.connectionId];if(peer?.probeAppTimeout&&epoch?.probeOnly){control.c2.push({seq:bytes[5],op:bytes[6],part:bytes[7],id:control.connectionId,at:performance.now()});return true;}const result=originalC2(bytes);if(bytes[6]===0x61&&peer)peer.kind='boot';return result;};
  function rawReply(frame,payload,id,delay=4){const encoded=XiaobaiOtaProtocol.encodeFrame(frame.command|0x80,frame.requestId,payload);setTimeout(()=>{if(id!==control.connectionId)return;control.nativePending=null;for(let i=0;i<encoded.length;i+=20)control.emit('otaNotification',{connectionId:id,data:btoa(String.fromCharCode(...encoded.slice(i,i+20)))});},delay);}
  bridge.nativePromise=async(plugin,method,opts={})=>{
    if(plugin!=='SparkBle')return lower(plugin,method,opts);
    control.boundary.calls.push({method,...opts,at:performance.now()});
    if(method==='removeListener')control.boundary.removed.push(opts.callbackId);
    if(method==='connect'){
      const peer=peers.get(opts.deviceId);if(spec&&!peer)throw new Error('No native peer for '+opts.deviceId);
      applyPeer(peer,opts.probeOnly);
      const result=await lower(plugin,method,opts);
      control.boundary.connections[opts.connectionId]={peer,deviceId:opts.deviceId,probeOnly:Boolean(opts.probeOnly)};
      return{...result,...(peer?{name:peer.name??'',advertisedName:peer.name??'',cachedName:peer.cachedName??''}:{}),...(opts.probeOnly&&!peer?.omitProbeAck?{probeOnly:true}:{})};
    }
    if(method==='startScan'&&spec){const result=await lower(plugin,method,opts);if(spec.autoScanEnd!==0)setTimeout(()=>{if(control.scanId===opts.scanId)control.emit('scanStopped',{scanId:opts.scanId,reason:'finished'});},spec.autoScanEnd??100);return result;}
    if(method==='disconnect'&&spec?.swapAfterFirstDisconnect&&!control.swappedDiscovery){control.swappedDiscovery=true;control.devices=spec.swapAfterFirstDisconnect.map(deviceId=>{const p=peers.get(deviceId);return{deviceId,name:p.name??'',advertisedName:p.name??'',rssi:p.rssi??-50};});}
    if(method==='writeOta'){
      const P=XiaobaiOtaProtocol,bytes=Uint8Array.from(atob(opts.data),c=>c.charCodeAt(0)),frame=P.decodeFrame(bytes),peer=activePeer(),epoch=control.boundary.connections[opts.connectionId];
      control.boundary.frames.push({id:opts.connectionId,deviceId:epoch?.deviceId,probeOnly:epoch?.probeOnly,op:frame.command,requestId:frame.requestId,payload:Array.from(frame.payload),wire:Array.from(bytes),at:performance.now()});
      if(frame.command===0x65){
        if(!control.rawActive||opts.connectionId!==control.connectionId||!control.subscribed)throw new Error('stale GET_UID native request');
        if(control.nativePending&&P.hex(control.nativePending)!==P.hex(bytes))throw new Error('pending native request not retired');
        control.nativePending=bytes.slice();control.otaCalls.push({method,op:0x65,id:opts.connectionId,requestId:frame.requestId,bytes:bytes.length,at:performance.now()});
        const version=peer?.bootVersion??control.bootIdentity.bootVersion,mode=peer?.uidMode??(version>=0x020002?'match':'unsupported');
        if(mode==='drop')return{};
        const uid=P.unhex(control.otaUid),payload=mode==='unsupported'?Uint8Array.of(2):mode==='error'?Uint8Array.of(7):mode==='bad-length'?P.concat([0],uid.slice(0,11)):P.concat([0],uid);
        rawReply(frame,payload,opts.connectionId,peer?.uidDelay??4);return{};
      }
      if(frame.command===0x60&&(peer?.kind==='app'||(!peer&&epoch?.probeOnly&&control.appAvailable))){
        // A running App never invents a Boot response. The owner must retire and use a new C2 probe epoch.
        if(!control.rawActive||!control.subscribed)throw new Error('unsubscribed read-only App raw probe');
        control.nativePending=bytes.slice();control.bootInfoRequests++;control.otaCalls.push({method,op:0x60,id:opts.connectionId,requestId:frame.requestId,bytes:bytes.length,at:performance.now()});return{};
      }
      const result=await lower(plugin,method,opts);
      if(frame.command===0x64&&peer&&control.appAvailable){peer.kind='app';peer.identity=control.appIdentity;}
      return result;
    }
    return lower(plugin,method,opts);
  };

};
