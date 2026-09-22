// Browser tests load the real Capacitor core and replace only its native bridge.
module.exports = function mockAndroid() {
  const callbacks=new Map();let callbackId=0;
  const control=window.mockBle={
    state:{available:true,permissionsGranted:true,permissionState:'granted',bluetoothEnabled:true,locationEnabled:true,requiresLocation:true,connected:false},
    devices:[],calls:[],connectionDelay:15,subscribed:false,connectionId:null,grantPermission:true,
    emit(name,data) {for(const entry of callbacks.values()) if(entry.plugin==='SparkBle'&&entry.eventName===name) entry.callback(data);},
    feed(text,connectionId=control.connectionId) {control.emit('notification',{connectionId,data:btoa(text)});}
  };
  window.nativeListeners={};window.minimized=false;window.androidBridge={};
  window.Capacitor={
    PluginHeaders:['App','SparkBle','CardCompiler'].map(name=>({name,methods:[
      {name:'addListener',rtype:'callback'},...['prepareUpload','finishUpload','compile','cancel','removeListener','minimizeApp','getState','requestAccess','startScan','stopScan','connect','subscribe','write','useFallbackWrite','disconnect','openSettings'].map(name=>({name,rtype:'promise'}))
    ]})),
    nativeCallback(plugin,method,options,callback) {
      const id=String(++callbackId);callbacks.set(id,{plugin,eventName:options.eventName,callback});
      if(plugin==='App') window.nativeListeners[options.eventName]=callback;
      return id;
    },
    async nativePromise(plugin,method,options={}) {
      if(method==='removeListener') {callbacks.delete(options.callbackId);return;}
      if(plugin==='App') {if(method==='minimizeApp') window.minimized=true;return;}
      if(plugin==='CardCompiler') {
        if(method==='cancel') return;
        window.mockCompilerSource=options.source;
        return {bytecode:btoa('\x0fpyo'+'\0'.repeat(12)),bytes:16,compilerVersion:'mock'};
      }
      control.calls.push({method,...options});
      if(method==='prepareUpload') {if(control.prepareError) throw new Error(control.prepareError);control.uploadPrepared=true;return {mtu:247};}
      if(method==='finishUpload') {control.uploadPrepared=false;return;}
      if(method==='getState') return {...control.state,connectionId:control.connectionId};
      if(method==='requestAccess') {control.state.permissionsGranted=control.grantPermission;return {...control.state};}
      if(method==='openSettings') return;
      if(method==='startScan') {
        control.scanId=options.scanId;
        for(const device of control.devices) setTimeout(()=>control.emit('scanResult',{scanId:options.scanId,...device}),20);
        return;
      }
      if(method==='stopScan') {control.emit('scanStopped',{scanId:control.scanId,reason:'cancelled'});return;}
      if(method==='connect') {
        await new Promise(resolve=>setTimeout(resolve,control.connectionDelay));
        const connectError=control.connectErrors?.[options.deviceId]||control.connectError;
        if(connectError) throw new Error(connectError);
        control.connectionId=options.connectionId;control.subscribed=false;
        return {connectionId:options.connectionId,properties:{notify:true,write:true,fallbackWrite:false,writeCharacteristic:'0000fff2-0000-1000-8000-00805f9b34fb'}};
      }
      if(method==='subscribe') {control.subscribed=true;return;}
      if(method==='useFallbackWrite') return;
      if(method==='write') {
        if(!control.subscribed) throw new Error('Write before CCCD subscription');
        const bytes=Uint8Array.from(atob(options.data),c=>c.charCodeAt(0));
        if([0xda,0xaa,0xbb,0xbc].includes(bytes[4])) {
          if(!control.uploadPrepared) throw new Error('Upload not prepared');
          if(control.uploadError) throw new Error(control.uploadError);
          if(!control.suppressAck) setTimeout(()=>control.feed(String.fromCharCode(...SparkProtocol.frame(0xfd,[1]))),control.ackDelay||5);
          if(bytes[4]===0xbc) {control.runState='run';control.feed('{"WillAiState":"run"}');}
          return;
        }
        if(bytes[4]===0xb9) {
          if(control.pauseStops!==false) {control.runState='stop';control.feed('{"WillAiState":"stop"}');}
          return;
        }
        if(bytes.length===17&&bytes[4]===0xc1) {
          if(bytes.slice(5,15).some(x=>x>1)||bytes[15]!==bytes.slice(0,15).reduce((a,b)=>(a+b)&255,0)) throw new Error('Invalid remote frame');
          if(control.writeError) throw new Error(control.writeError);
          return;
        }
        if(bytes.length===17&&bytes[4]===0xc2) {
          if(bytes[15]!==bytes.slice(0,15).reduce((a,b)=>(a+b)&255,0)) throw new Error('Invalid program frame');
          const seq=bytes[5],op=bytes[6];
          if(op===1) control.mode=4;
          if(op===2) control.mode=3;
          if(control.writeError) throw new Error(control.writeError);
          if(op===4||[0x10,0x20,0x30,0x51].includes(op)) {
            if(!control.suppressAck) setTimeout(()=>{
              const data=[seq,op,0,...(op===4?[control.mode||0,10,20,30,0x3c,0x0f,0]:[0,0,0,0,0,0,0])];
              const packet=[0x5a,0x98,0x97,0x0a,0xd2,...data];
              packet.push(packet.reduce((sum,value)=>sum+value,0)&255,0xa5);
              control.feed(String.fromCharCode(...packet));
            },control.ackDelay||5);
          }
          return;
        }
        if(atob(options.data)!=='\x5a\x97\x98\x01\xd0\x01\x5b\xa5') throw new Error('Unexpected command');
        if(control.writeError) throw new Error(control.writeError);
        if(!control.suppressStatus) {control.feed('{"WillAi');control.feed('State":"'+(control.runState||'stop')+'"}');}return;
      }
      if(method==='disconnect') {
        if(options.connectionId && options.connectionId!==control.connectionId) return;
        const id=control.connectionId;control.connectionId=null;control.subscribed=false;
        control.emit('disconnected',{connectionId:id,reason:'已断开连接'});return;
      }
      throw new Error('Unknown native method: '+method);
    }
  };
};
