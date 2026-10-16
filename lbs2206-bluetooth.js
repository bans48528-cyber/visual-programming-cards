// LBS2206 transport with the shared Bluetooth page layout; no user-facing protocol diagnostics.
window.createLbs2206Bluetooth=({model})=>{
  if(!window.CardPlatform?.isAndroid)return window.createModelBluetoothPreview(model);
  const profile=window.Lbs2206Profile,P=Lbs2206Protocol;
  const native=window.CardPlatform?.isAndroid?Capacitor.registerPlugin('SparkBle'):null;
  const prefs=XiaobaiDevicePreferences.create(localStorage,model.id),life=new AbortController(),listeners=[];
  let disposed=false,epoch=0,scanId='',scanning=false,timer=null,pendingId=null,current=null,link=null,flow=null,scanTicket=0;
  let phoneState=null,pendingDevice=null;
  const rows=new Map();
  const page=CardBluetoothPage.create(model,{className:'lbs-page'});
  page.querySelector('.bt-search').classList.add('lbs-scan');
  page.querySelector('#btDisconnect').classList.add('lbs-disconnect');
  page.querySelector('.bt-message').classList.add('lbs-message');
  document.body.append(page);const $=s=>page.querySelector(s),trigger=document.getElementById('bluetoothBtn');
  const tell=text=>{if(!disposed)$('.lbs-message').textContent=text;};
  const valid=t=>!disposed&&t===epoch&&!document.hidden;
  function draw(){if(disposed)return;
    const issues=P.profileIssues(profile),state=phoneState;
    const readyForScan=!!(state?.available&&state?.permissionsGranted&&state?.bluetoothEnabled&&(!state.requiresLocation||state.locationEnabled));
    $('#btReadySummary').textContent=!native?'请在手机 APP 中连接':!state?'正在检查手机状态':readyForScan?'手机已准备好':!state.bluetoothEnabled?'请开启手机蓝牙':!state.permissionsGranted?'请允许扫描权限':'请开启系统定位';
    $('.bt-ready').classList.toggle('is-ready',readyForScan);
    $('#btRadioState').textContent=state?.bluetoothEnabled?'已开启':'未开启';$('#btPermissionState').textContent=state?.permissionsGranted?'已允许':'待授权';
    $('.bt-location').hidden=!state?.requiresLocation||state.locationEnabled;
    $('.bt-current').hidden=!current&&!pendingId;$('.bt-current h2').textContent=prefs.displayName(current||pendingDevice||{});$('.bt-current p').textContent=current?'已连接':'正在连接…';
    $('.bt-rename-current').hidden=!current;CardBluetoothPage.status(page,{connected:Boolean(current),connecting:Boolean(pendingId),scanning,count:rows.size});
    $('.bt-empty').hidden=Boolean(rows.size||current);$('.bt-empty strong').textContent=scanning?'正在扫描…':'尚未发现设备';
    $('.bt-scan-description').textContent=scanning?'正在查找附近设备…':'选择你的 LBS2206 主机';page.classList.toggle('is-scanning',scanning);
    $('.lbs-disconnect').hidden=!current&&!pendingId;$('.lbs-disconnect').textContent=pendingId?'取消连接':'断开';$('.lbs-scan').disabled=!native||Boolean(current)||Boolean(pendingId);$('.lbs-scan').textContent=scanning?'停止扫描':'扫描设备';
    trigger.classList.toggle('is-connected',Boolean(current));trigger.classList.toggle('is-connecting',scanning||Boolean(pendingId));
    const output=document.getElementById('deviceStatus');output.dataset.state=current?'stop':scanning||pendingId?'connecting':'disconnected';
    output.textContent=current?prefs.displayName(current)+' 已连接':pendingId?'正在连接':scanning?'正在搜索设备':'设备未连接';
    trigger.setAttribute('aria-label',current?'蓝牙已连接：'+prefs.displayName(current):scanning?'正在搜索设备':'蓝牙未连接');
    $('.bt-list').replaceChildren(...[...rows.values()].filter(device=>device.deviceId!==current?.deviceId).map(device=>{
      const row=document.createElement('li');row.className='bt-device';row.dataset.deviceId=device.deviceId;
      const label=document.createElement('div');label.className='bt-device-info';const title=document.createElement('strong');title.textContent=prefs.displayName(device)+(prefs.getDefault()===device.deviceId?' · 默认':'');
      const sub=document.createElement('small');sub.textContent=device.deviceId+' · '+device.rssi+' dBm';label.append(title,sub);row.append(label);
      const actions=document.createElement('div');actions.className='bt-device-actions';
      for(const [text,handler]of [['连接',()=>connect(device)]]){
        const b=document.createElement('button');b.className='bt-button bt-connect';b.textContent=text;b.disabled=Boolean(pendingId||current)||(!native)||(text==='连接'&&issues.length>0);b.onclick=()=>handler().catch(e=>tell(e.message));actions.append(b);
      }
      const rename=document.createElement('button');rename.className='bt-button bt-rename';rename.textContent='重命名';rename.onclick=()=>renameDevice(device);
      actions.prepend(rename);row.append(actions);CardBluetoothPage.device(row,device,{name:prefs.displayName(device),isDefault:prefs.getDefault()===device.deviceId});return row;
    }));
  }
  function renameDevice(device){if(!device)return;const dialog=$('.bt-rename-dialog');dialog.returnValue='';dialog.dataset.deviceId=device.deviceId;dialog.querySelector('input').value=prefs.customName(device.deviceId);dialog.showModal();}
  $('.bt-rename-dialog').onclose=()=>{const dialog=$('.bt-rename-dialog');if(disposed||dialog.returnValue!=='confirm')return;try{prefs.rename(dialog.dataset.deviceId,dialog.querySelector('input').value);draw();}catch(e){tell(e.message);}};
  function update(state){if(disposed)return;tell(state.message);window.dispatchEvent(new CustomEvent('device-execution-state',{detail:{modelId:model.id,...state}}));}
  async function cancelAuto(){epoch++;clearTimeout(timer);flow=null;const previous=pendingId;pendingId=null;pendingDevice=null;const hadScan=scanning;scanning=false;
    await Promise.allSettled([hadScan&&native?native.stopScan():Promise.resolve(),previous&&native?native.disconnect({connectionId:previous}):Promise.resolve()]);draw();
  }
  async function disconnect(){await cancelAuto();const old=current;current=null;link?.close();link=null;draw();if(old&&native)await native.disconnect({connectionId:old.connectionId});}
  async function connect(device,automatic=false,ticket){
    if(!native)throw new Error('请在 Android APP 中检查设备');
    P.requireProfile(profile);
    if(!automatic){await cancelAuto();ticket=++epoch;}if(!valid(ticket))return;
    await native.stopScan();scanning=false;if(!valid(ticket))return;
    const id=crypto.randomUUID();pendingId=id;pendingDevice=device;draw();tell('正在连接…');
    try{
      const result=await native.connect({deviceId:device.deviceId,connectionId:id,profile:'lbs2206',
        serviceUuid:profile.serviceUuid,writeUuid:profile.writeUuid,notifyUuid:profile.notifyUuid,writeMode:profile.writeMode,maxFrameBytes:profile.maxFrameBytes,safeActions:profile.programVerified?profile.safeActions:0});
      if(!valid(ticket)){await native.disconnect({connectionId:id});return;}
      await native.subscribe({connectionId:id});if(!valid(ticket)){await native.disconnect({connectionId:id});return;}
      const target=new P.Link({write:bytes=>native.write({connectionId:id,data:btoa(String.fromCharCode(...bytes))})},profile,{onState:update,onText:text=>{if(!disposed&&link===target){window.dispatchEvent(new CustomEvent('lbs-setting-reply',{detail:text}));}}});
      link=target;current={...device,connectionId:id};prefs.setDefault(device.deviceId);tell('已连接 '+prefs.displayName(device));
    }catch(e){if(current?.connectionId===id){current=null;link?.close();link=null;}await native.disconnect({connectionId:id}).catch(()=>{});if(valid(ticket))tell(e.message);}
    finally{if(pendingId===id){pendingId=null;pendingDevice=null;}if(valid(ticket)){flow=null;draw();}}
  }
  async function scan(auto=false){if(disposed||current||pendingId||scanning||flow)return;
    if(!native){tell('网页只能预览，请在 Android APP 中连接设备');return;}
    if(auto&&P.profileIssues(profile).length){tell('连接配置不可用，请更新 APP');return;}
    const ticket=++epoch;flow={ticket,auto};scanTicket=ticket;
    try{await ready;if(!valid(ticket))return;const state=await native.requestAccess();phoneState=state;if(!valid(ticket))return;
      if(!state.permissionsGranted||!state.bluetoothEnabled||(state.requiresLocation&&!state.locationEnabled))throw new Error('请开启蓝牙并允许扫描权限（旧版 Android 还需开启定位）');
      rows.clear();scanId=crypto.randomUUID();scanning=true;draw();tell('正在扫描…');await native.startScan({scanId,includeUnnamed:true});if(!valid(ticket))return;
      const defaultId=prefs.getDefault();timer=setTimeout(async()=>{
        if(!valid(ticket)||!scanning)return;scanning=false;await native.stopScan().catch(()=>{});if(!valid(ticket))return;
        if(auto){const candidates=[...rows.values()].filter(d=>defaultId?d.deviceId===defaultId:(profile.namePrefixes||[]).some(p=>d.name.startsWith(p))).sort((a,b)=>b.rssi-a.rssi);
          if(candidates.length)await connect(candidates[0],true,ticket);else{flow=null;tell(defaultId?'10 秒内未发现默认设备，请重试或手动选择':'尚未发现已确认兼容的设备，请手动选择');}}
        else{flow=null;tell('请选择要连接的设备');}draw();
      },auto&&!defaultId?3000:10000);
    }catch(e){if(valid(ticket)){flow=null;scanning=false;tell(e.message);draw();}}
  }
  const ready=(async()=>{if(!native)return;
    async function on(name,fn){const handle=await native.addListener(name,e=>{if(!disposed)fn(e);});if(disposed)await handle.remove();else listeners.push(handle);}
    await on('scanResult',d=>{if(!scanning||d.scanId!==scanId||!valid(scanTicket))return;rows.set(d.deviceId,d);draw();
      if(flow?.auto&&prefs.getDefault()===d.deviceId){clearTimeout(timer);scanning=false;connect(d,true,flow.ticket).catch(e=>tell(e.message));}});
    await on('notification',e=>{if(e.connectionId===current?.connectionId)link?.receiver.feed(Uint8Array.from(atob(e.data),c=>c.charCodeAt(0)));});
    await on('disconnected',e=>{if(e.connectionId!==current?.connectionId)return;current=null;link?.close();link=null;update({phase:'disconnected',busy:false,message:'连接已断开，设备实际停止情况请检查小车'});draw();});
    await on('scanStopped',e=>{if(e.scanId===scanId&&e.reason!=='cancelled'&&e.reason!=='finished'&&e.reason!=='connecting'){scanning=false;flow=null;tell(e.reason);draw();}});
  })().catch(e=>tell(e.message));
  function route(){if(disposed)return;page.hidden=location.hash!=='#bluetooth';document.body.classList.toggle('bluetooth-open',!page.hidden);if(page.hidden)CardBluetoothPage.closePanels(page);
    if(location.hash==='#editor'&&CardModelSession.selected&&!CardModelSession.switching)scan(true).catch(e=>tell(e.message));
  }
  $('.bt-back').onclick=()=>window.CardBluetoothBack();
  $('.lbs-scan').onclick=()=>{if(scanning)cancelAuto();else scan(false);};$('.lbs-disconnect').onclick=()=>disconnect().catch(e=>tell(e.message));
  trigger.onclick=()=>window.CardOpenBluetooth('#editor');window.addEventListener('hashchange',route,{signal:life.signal});window.addEventListener('card-bluetooth-route',route,{signal:life.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect().catch(()=>{});else native?.getState().then(s=>{if(!disposed){phoneState=s;draw();}}).catch(e=>tell(e.message));},{signal:life.signal});
  function connection(){if(!current||!link||link.closed)return null;const target=link,id=current.connectionId;
    const guard=()=>!disposed&&link===target&&current?.connectionId===id;
    const check=()=>{if(!guard())throw new Error('LBS2206 连接已变化');};
    return {id,get busy(){return target.busy;},upload:(program,ctx)=>{check();return target.upload(program,{...ctx,isCurrent:()=>guard()&&ctx.isCurrent()});},
      remote:(dir,speed,valid=()=>true)=>{check();return target.remote(dir,speed,()=>guard()&&valid());},
      stopProgram:()=>{if(guard())return target.remote('stop',3);},readSetting:name=>{check();return target.readSetting(name);},stopNeedsConfirmation:false};
  }
  const api={remoteConnection:connection,ensureConnected:()=>scan(true),cancelAuto,disconnect,get connected(){return Boolean(current);},get busy(){return Boolean(link?.busy);},get executionPhase(){return link?.phase||'idle';},get defaultDeviceId(){return prefs.getDefault();},
    async dispose(){if(disposed)return;disposed=true;life.abort();await disconnect();await Promise.allSettled(listeners.map(h=>h.remove()));page.remove();trigger.classList.remove('is-connected','is-connecting');document.getElementById('deviceStatus').textContent='设备未连接';document.getElementById('deviceStatus').dataset.state='disconnected';document.body.classList.remove('bluetooth-open');}};
  $('.bt-rename-current').onclick=()=>renameDevice(current);
  $('#btAccess').onclick=async()=>{if(!native)return;try{if(phoneState?.permissionsGranted||phoneState?.permissionState==='denied')await native.openSettings({target:'app'});else{phoneState=await native.requestAccess();draw();}}catch(e){tell(e.message);}};
  $('#btSystemSettings').onclick=()=>native?.openSettings({target:'bluetooth'}).catch(e=>tell(e.message));
  $('#btLocationSettings').onclick=()=>native?.openSettings({target:'location'}).catch(e=>tell(e.message));
  if(native)native.getState().then(s=>{phoneState=s;draw();}).catch(e=>tell(e.message));
  draw();route();return api;
};
