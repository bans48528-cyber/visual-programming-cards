// Android owns discovery and GATT. This file owns one cancellable connection flow.
window.createXiaobaiBluetooth = ({model=CardModels.get('xiaobai')}={}) => {
  if (!window.CardPlatform?.isAndroid) return window.createModelBluetoothPreview(model);
  const native=window.Capacitor.registerPlugin('SparkBle'),protocol=model.bluetooth.protocol();
  const prefs=window.XiaobaiDevicePreferences.create(localStorage,model.id);
  const timing=window.__XIAOBAI_BLE_TIMING||model.bluetooth.timing;
  let disposed=false;
  const lifecycle=new AbortController(),listeners=[];
  async function listen(name,fn){const handle=await native.addListener(name,event=>{if(!disposed)fn(event);});if(disposed)await handle.remove();else listeners.push(handle);}

  class AndroidBleTransport {
    constructor(connectionId,properties){this.connectionId=connectionId;this.properties=properties;this.receive=null;}
    async start(receive){this.receive=receive;await native.subscribe({connectionId:this.connectionId});}
    write(bytes){return native.write({connectionId:this.connectionId,data:btoa(String.fromCharCode(...bytes))});}
    prepareUpload(bytes){return native.prepareUpload({connectionId:this.connectionId,bytes,slot:0,run:true});}
    finishUpload(){return native.finishUpload({connectionId:this.connectionId});}
    useFallbackWrite(){return native.useFallbackWrite({connectionId:this.connectionId});}
    close(){this.receive=null;}
    disconnect(){return native.disconnect({connectionId:this.connectionId}).catch(error=>trace('断开失败',null,error.message));}
    notification(data){if(this.receive)this.receive(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));}
  }
  const page=CardBluetoothPage.create(model,{diagnostics:true});
  document.body.append(page);
  const $=selector=>page.querySelector(selector),trigger=document.getElementById('bluetoothBtn'),statusOutput=document.getElementById('deviceStatus');
  const rows=new Map(),renderedRows=new Map(),logs=[];
  let state=null,scanning=false,requesting=false,scanId='',hasScanned=false;
  let connecting=null,current=null,transport=null,link=null,initialized=false,renderQueued=false,version=0,flow=null,autoPromise=null,desiredMode=null;
  function trace(kind,bytes,detail=''){logs.push(`${new Date().toISOString()} ${kind} ${detail} ${bytes?Array.from(bytes.slice(0,256),b=>b.toString(16).padStart(2,'0')).join(' '):''}`.trim());if(logs.length>200)logs.shift();$('.bt-trace').textContent=logs.join('\n');}
  function tell(text,error=false){if(disposed)return;$('.bt-message').textContent=text;$('.bt-message').classList.toggle('error',error);}
  function notify(text){tell(text,true);window.showExecutionNotice?.(text);}
  function failure(error){if(disposed)return;trace('错误',null,error.message);notify(error.message||'蓝牙操作失败，请重试。');}
  const nameOf=device=>prefs.displayName(device),valid=ticket=>!disposed&&ticket===version&&!document.hidden;
  function status(){if(connecting)return{id:'connecting',text:`正在连接 ${nameOf(connecting)}`};if(!current||!link||link.closed)return{id:scanning?'connecting':'disconnected',text:scanning?'正在搜索设备':'设备未连接'};return link.status ? {id:link.status.id,text:`${nameOf(current)} · ${link.status.text}`} : {id:'stop',text:`${nameOf(current)} 已连接`};}
  function renderStatus(){if(disposed)return;const value=status();statusOutput.dataset.state=value.id;statusOutput.textContent=value.text;$('.bt-current p').textContent=value.text;CardBluetoothPage.status(page,{connected:Boolean(current&&link&&!link.closed),connecting:Boolean(connecting),scanning,count:rows.size});}
  function render(){
    if(disposed)return;
    renderStatus();$('#btRadioState').textContent=!state?'检查中':!state.available?'不可用':(!state.requiresLocation&&!state.permissionsGranted)?'待授权':state.bluetoothEnabled?'已开启':'已关闭';
    $('#btPermissionState').textContent=state?.permissionsGranted?'已允许':state?'待授权':'检查中';$('#btAccess').textContent=state?.permissionsGranted?'管理应用权限':'允许扫描权限';$('#btAccess').disabled=requesting||!initialized;
    $('.bt-location').hidden=!state?.requiresLocation||(state.permissionsGranted&&state.locationEnabled);$('#btLocationSettings').textContent=state?.locationEnabled?'系统定位已开启':'开启系统定位';
    const readyForScan=Boolean(state?.available&&state?.permissionsGranted&&state?.bluetoothEnabled&&(!state.requiresLocation||state.locationEnabled));
    const readySummary=$('#btReadySummary'),readyBox=$('.bt-ready'),settings=$('.bt-settings');
    readySummary.textContent=!state?'正在检查手机状态':readyForScan?'手机已准备好':!state.available?'此手机不支持蓝牙扫描':!state.bluetoothEnabled?'请开启手机蓝牙':!state.permissionsGranted?'请允许扫描权限':'请开启系统定位';
    readyBox.classList.toggle('is-ready',readyForScan);readyBox.classList.toggle('needs-action',Boolean(state&&!readyForScan));
    if(state&&!readyForScan)settings.open=true;
    const search=$('.bt-search');search.disabled=!initialized||(state&&!state.available)||Boolean(current)||requesting;search.textContent=requesting?'等待授权…':scanning?'停止扫描':hasScanned?'重新扫描':'扫描设备';
    $('.bt-scan-description').textContent=scanning?'正在查找附近设备…':`选择你的${model.name}主机${rows.size?' · '+rows.size+' 台':''}`;page.classList.toggle('is-scanning',scanning);
    $('.bt-current').hidden=!current&&!connecting;$('.bt-current h2').textContent=nameOf(current||connecting||{});$('#btDisconnect').textContent=connecting?'取消连接':'断开';$('.bt-rename-current').hidden=!current;
    const list=$('.bt-list'),defaultId=prefs.getDefault();
    for(const [id,row]of renderedRows){if(!rows.has(id)||id===current?.deviceId){row.remove();renderedRows.delete(id);}}
    rows.forEach(device=>{
      if(device.deviceId===current?.deviceId)return;let row=renderedRows.get(device.deviceId);
      if(!row){row=document.createElement('li');row.className='bt-device';row.dataset.deviceId=device.deviceId;row.innerHTML='<span class="bt-signal"></span><div class="bt-device-info"><strong></strong><small></small></div><div class="bt-device-actions"><button type="button" class="bt-button bt-rename">重命名</button><button type="button" class="bt-button bt-connect">连接</button></div>';for(let i=1;i<=4;i++){const bar=document.createElement('i');bar.style.height=`${6+i*5}px`;row.querySelector('.bt-signal').append(bar);}row.querySelector('.bt-connect').onclick=()=>manualConnect(rows.get(device.deviceId));row.querySelector('.bt-rename').onclick=()=>renameDevice(rows.get(device.deviceId));renderedRows.set(device.deviceId,row);list.append(row);}
      CardBluetoothPage.device(row,device,{name:nameOf(device),isDefault:device.deviceId===defaultId});
      const button=row.querySelector('.bt-connect');button.textContent=connecting?.deviceId===device.deviceId?'连接中…':'连接';button.disabled=Boolean(current||connecting?.manual);
    });
    $('.bt-empty').hidden=Boolean(list.childElementCount||current||connecting);$('.bt-empty strong').textContent=scanning?'正在扫描…':hasScanned?'暂未发现主机':'尚未扫描';$('.bt-empty > span:last-child').textContent=scanning?'请保持主机在手机附近':hasScanned?'请重试或手动选择设备':'打开主机电源后开始扫描';
    trigger.classList.toggle('is-connected',Boolean(current&&link&&!link.closed));trigger.classList.toggle('is-connecting',Boolean(connecting||scanning||requesting));trigger.title=trigger.ariaLabel=current?`蓝牙已连接：${nameOf(current)}`:connecting?`正在连接：${nameOf(connecting)}`:scanning?'正在搜索设备':'蓝牙未连接';
  }
  function scheduleRender(){if(renderQueued)return;renderQueued=true;setTimeout(()=>{renderQueued=false;render();},80);}
  async function refresh(){const value=await native.getState();if(disposed)return;state=value;render();return state;}
  function clearTimer(target=flow){if(target?.timer){clearTimeout(target.timer);target.timer=null;}}
  async function cancelFlow(reason='cancelled'){const previous=flow;flow=null;version++;clearTimer(previous);requesting=false;const connectionId=connecting?.connectionId;connecting=null;if(scanning){scanning=false;await native.stopScan().catch(()=>{});}if(connectionId)await native.disconnect({connectionId}).catch(()=>{});trace('流程取消',null,reason);render();}
  async function ensureAccess(ticket){await ready;if(!valid(ticket))return false;const value=await native.requestAccess();if(!valid(ticket))return false;state=value;if(!state.permissionsGranted)throw new Error('请允许蓝牙扫描权限后重试。');if(!state.bluetoothEnabled)throw new Error('手机蓝牙未开启，请打开后重试。');if(state.requiresLocation&&!state.locationEnabled)throw new Error('请开启系统定位后重试，APP 不读取地理位置。');return true;}
  async function beginScan(kind,durationMs,targetId=''){
    if(disposed)return;
    const ticket=++version;flow={ticket,kind,targetId,timer:null,candidates:[]};requesting=true;render();
    try{if(!await ensureAccess(ticket))return;rows.clear();scanId=crypto.randomUUID();hasScanned=true;scanning=true;requesting=false;tell(kind==='auto-default'?`正在查找默认设备“${prefs.customName(targetId)||model.name+'设备'}”…`:kind==='auto-first'?`正在自动查找${model.name}设备…`:'正在扫描附近设备…');trace('扫描开始',null,kind);render();await native.startScan({scanId});if(!valid(ticket))return;flow.timer=setTimeout(()=>finishScan(ticket).catch(failure),durationMs);}
    catch(error){if(valid(ticket)){flow=null;scanning=false;requesting=false;failure(error);}render();}
  }
  async function finishScan(ticket){
    if(!valid(ticket)||!flow)return;const active=flow;clearTimer(active);scanning=false;await native.stopScan().catch(()=>{});if(!valid(ticket)||flow!==active)return;
    if(active.kind==='auto-default'){flow=null;notify(`10 秒内未找到默认设备“${prefs.customName(active.targetId)||model.name+'设备'}”，请重试或进入蓝牙界面手动选择。`);render();return;}
    if(active.kind==='auto-first'){active.kind='auto-candidates';active.candidates=[...rows.values()].sort((a,b)=>b.rssi-a.rssi);if(!active.candidates.length){flow=null;notify(`未发现兼容的${model.name}设备，请重试或进入蓝牙界面手动选择。`);render();return;}await connectNextCandidate(active);return;}
    flow=null;tell(rows.size?'扫描完成，请选择设备。':'未发现设备，请重试。',!rows.size);render();
  }
  async function connectNextCandidate(active){while(valid(active.ticket)&&flow===active&&active.candidates.length){const device=active.candidates.shift();try{await establish(device,active.ticket,false);if(!valid(active.ticket)||flow!==active||current?.deviceId!==device.deviceId)return;prefs.setDefault(device.deviceId);flow=null;render();return;}catch(error){if(!valid(active.ticket)||flow!==active)return;trace('候选设备不兼容',null,`${device.deviceId} ${error.message}`);}}if(valid(active.ticket)&&flow===active){flow=null;notify(`未发现兼容的${model.name}设备，请重试或进入蓝牙界面手动选择。`);render();}}
  async function establish(device,ticket,manual){
    if(!device)throw new Error('设备已离开扫描列表，请重新扫描。');clearTimer();scanning=false;await native.stopScan().catch(()=>{});if(!valid(ticket))return;
    const connectionId=crypto.randomUUID();connecting={...device,connectionId,manual};render();tell(`正在连接 ${nameOf(device)}…`);trace('连接开始',null,device.deviceId);let candidateTransport,candidate;
    try{
      const result=await native.connect({deviceId:device.deviceId,connectionId,profile:model.bluetooth.nativeProfile||'xiaobai',...model.bluetooth.connectionOptions?.()});
      if(!valid(ticket)){await native.disconnect({connectionId}).catch(()=>{});return;}
      candidateTransport=new AndroidBleTransport(connectionId,result.properties);
      candidate=new protocol.Link(candidateTransport,{profile:model.bluetooth.profile?.(),onTrace:trace,onState:()=>{if(!disposed){renderStatus();window.CardProgram?.refresh();}},onEvent:event=>{
        if(disposed||transport!==candidateTransport)return;
        trace('EVENT',null,`code=${event.code} data=${Array.from(event.data).join(',')}`);
        if(event.code===2||(event.code===1&&event.data[0]!==protocol.MODE.PROGRAM))window.dispatchEvent(new CustomEvent('xiaobai-program-abort',{detail:event}));
      },onError:error=>{if(valid(ticket))failure(error);}});
      transport=candidateTransport;link=candidate;
      await candidate.start();
      if(!valid(ticket))throw new Error("连接已取消。");
      try{await candidate.probe();}
      catch(error){if(!valid(ticket)||!result.properties.fallbackWrite)throw error;trace('备用写入',null,'FFF2 无状态回报，改用 FFF1');await candidateTransport.useFallbackWrite();await candidate.probe();}
      if(!valid(ticket)){candidate.close();await native.disconnect({connectionId}).catch(()=>{});return;}
      link=candidate;current={...device,connectionId};connecting=null;
      if(desiredMode===protocol.MODE.PROGRAM)await candidate.enterProgram();
      else if(desiredMode===protocol.MODE.REMOTE)await candidate.enterRemote();
      if(!valid(ticket))return;
      tell(`已连接 ${nameOf(current)}。`);trace('连接就绪',null,device.deviceId);render();
    }
    catch(error){candidate?.close();candidateTransport?.close();if(transport===candidateTransport)transport=null;if(link===candidate)link=null;if(current?.connectionId===connectionId)current=null;if(connecting?.connectionId===connectionId)connecting=null;await native.disconnect({connectionId}).catch(()=>{});render();throw error;}
  }
  async function manualConnect(device){if(disposed)return;await cancelFlow('用户手动选择');const ticket=++version;flow={ticket,kind:'manual-connect',timer:null};try{await establish(device,ticket,true);if(!valid(ticket))return;prefs.setDefault(device.deviceId);flow=null;tell(`已连接并设为默认设备：${nameOf(device)}`);render();}catch(error){if(valid(ticket)){flow=null;failure(new Error(`连接 ${nameOf(device)} 失败：${error.message}`));}render();}}
  async function manualScan(){await cancelFlow('用户手动扫描');await beginScan('manual-scan',10000);}
  async function ensureConnected(){if(disposed||!CardModelSession.selected||CardModelSession.switching)return false;if(current&&link&&!link.closed)return true;if(autoPromise||flow||connecting||scanning||requesting)return autoPromise||false;autoPromise=(async()=>{const id=prefs.getDefault();await beginScan(id?'auto-default':'auto-first',id?timing.defaultScanMs:timing.firstScanMs,id);})().finally(()=>{autoPromise=null;});return autoPromise;}
  function clearConnection(){if(current)window.dispatchEvent(new Event('xiaobai-disconnected'));link?.close();transport?.close();link=null;transport=null;current=null;connecting=null;render();}
  async function disconnect(){await cancelFlow('用户断开');const connectionId=transport?.connectionId;clearConnection();if(connectionId)await native.disconnect({connectionId});tell('已断开连接。');}
  function renameDevice(device){if(!device)return;const dialog=$('.bt-rename-dialog'),input=dialog.querySelector('input');dialog.returnValue='';dialog.dataset.deviceId=device.deviceId;input.value=prefs.customName(device.deviceId)||'';dialog.showModal();setTimeout(()=>{input.focus();input.select();},0);}
  $('.bt-rename-dialog').addEventListener('close',event=>{const dialog=event.currentTarget;if(dialog.returnValue!=='confirm')return;try{prefs.rename(dialog.dataset.deviceId,dialog.querySelector('input').value);render();tell('设备名称已保存在本机。');}catch(error){failure(error);}});
  const ready=(async()=>{
    await listen('scanResult',device=>{if(!scanning||device.scanId!==scanId||!model.bluetooth.accepts(device))return;rows.set(device.deviceId,device);scheduleRender();if(flow?.kind==='auto-default'&&device.deviceId===flow.targetId){const active=flow;active.kind='auto-connecting';clearTimer(active);establish(device,active.ticket,false).then(()=>{if(valid(active.ticket)){flow=null;render();}}).catch(error=>{if(valid(active.ticket)){flow=null;failure(new Error(`默认设备连接失败：${error.message}`));}});}});
    await listen('scanStopped',event=>{if(event.scanId!==scanId)return;scanning=false;if(event.reason==='finished'&&flow?.kind==='auto-default')finishScan(flow.ticket).catch(failure);else if(event.reason==='finished'&&flow?.kind==='manual-scan'){flow=null;tell(rows.size?'扫描完成，请选择设备。':'未发现设备，请重试。',!rows.size);}render();});
    await listen('notification',event=>{if(event.connectionId===transport?.connectionId)transport.notification(event.data);});
    await listen('disconnected',event=>{if(event.connectionId===connecting?.connectionId&&!current){trace('连接未完成',null,event.reason);return;}if(event.connectionId!==transport?.connectionId)return;version++;flow=null;clearConnection();tell(event.reason||'连接已断开。',true);trace('连接断开',null,event.reason);});
    await listen('adapterState',value=>{state=value;render();});initialized=true;await refresh();
  })().catch(error=>failure(new Error('手机蓝牙初始化失败：'+error.message)));
  $('.bt-search').onclick=()=>{if(scanning||connecting)cancelFlow('用户停止').then(()=>tell('已停止搜索或连接。'));else manualScan().catch(failure);};$('#btDisconnect').onclick=()=>disconnect().catch(failure);$('.bt-rename-current').onclick=()=>renameDevice(current);
  $('#btAccess').onclick=async()=>{try{if(state?.permissionsGranted||state?.permissionState==='denied')await native.openSettings({target:'app'});else{state=await native.requestAccess();render();}}catch(error){failure(error);}};$('#btSystemSettings').onclick=()=>native.openSettings({target:'bluetooth'}).catch(failure);$('#btLocationSettings').onclick=()=>native.openSettings({target:'location'}).catch(failure);
  $('.bt-copy').onclick=async()=>{try{await navigator.clipboard.writeText('Xiaobai Android BLE diagnostics\n'+logs.join('\n'));tell('诊断已复制。');}catch{tell('复制失败，可展开诊断并长按选中文字。',true);}};
  function route(){if(disposed)return;const show=location.hash==='#bluetooth';page.hidden=!show;document.body.classList.toggle('bluetooth-open',show);if(show){closeParamEditor();document.title='手机蓝牙 · 小白编程';ready.then(refresh).catch(failure);}else{CardBluetoothPage.closePanels(page);if(flow?.kind==='manual-scan')cancelFlow('离开蓝牙界面').catch(()=>{});if(location.hash==='#editor'){document.title=document.querySelector('.brand-title').textContent+' · 小白编程';updateProgramAnchor();if(!document.getElementById('remoteControl')?.open)enterProgram().catch(failure);ready.then(ensureConnected).catch(failure);}}if(location.hash!=='#editor'&&!document.getElementById('remoteControl')?.open){desiredMode=null;link?.stopHeartbeat();}}
  trigger.onclick=()=>window.CardOpenBluetooth('#editor');$('.bt-back').onclick=()=>window.CardBluetoothBack();window.addEventListener('hashchange',route,{signal:lifecycle.signal});window.addEventListener('card-bluetooth-route',route,{signal:lifecycle.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){const connectionId=transport?.connectionId;cancelFlow('应用进入后台').catch(()=>{});clearConnection();if(connectionId)native.disconnect({connectionId}).catch(()=>{});}else ready.then(refresh).catch(failure);},{signal:lifecycle.signal});const statusTimer=setInterval(renderStatus,250);
  async function enterProgram(){if(disposed)return;desiredMode=protocol.MODE.PROGRAM;if(link&&!link.closed)await link.enterProgram();}
  async function enterRemote(){if(disposed)return;desiredMode=protocol.MODE.REMOTE;if(link&&!link.closed)await link.enterRemote();}
  const api={disconnect,cancelAuto:()=>cancelFlow('切换设备型号'),async dispose(){
    if(disposed)return;disposed=true;lifecycle.abort();clearInterval(statusTimer);
    const pending=cancelFlow('切换设备型号');
    const connectionId=transport?.connectionId;link?.close();transport?.close();link=null;transport=null;current=null;
    page.remove();trigger.classList.remove('is-connected','is-connecting');statusOutput.dataset.state='disconnected';statusOutput.textContent='设备未连接';
    await Promise.allSettled([pending,...listeners.map(handle=>handle.remove()),connectionId?native.disconnect({connectionId}):Promise.resolve()]);
  },ensureConnected,enterProgram,enterRemote,remoteConnection(){
    if(!current||!link||link.closed)return null;const target=link,id=current.connectionId;
    const guard=()=>Boolean(!disposed&&current&&current.connectionId===id&&target===link&&!target.closed);
    return{id,setMotors:(left,right,shouldWrite=()=>true)=>{if(!guard())return Promise.reject(new Error('连接已取消。'));return target.setMotors(left,right,()=>guard()&&shouldWrite());},stopNeedsConfirmation:Boolean(target.stopNeedsConfirmation),uploadProgram:(bytes,options)=>{if(!guard())throw new Error('连接已取消。');return target.uploadProgram(bytes,options);},send(bytes,shouldWrite=()=>true){if(!guard())return Promise.reject(new Error('蓝牙连接已断开，请重新连接。'));return target.send(bytes,()=>guard()&&shouldWrite());},
      enterProgram:()=>{if(!guard())throw new Error('蓝牙连接已断开。');return enterProgram();},
      enterRemote:()=>{if(!guard())throw new Error('蓝牙连接已断开。');return enterRemote();},
      action:(opcode,args,blocking,timeout)=>{if(!guard())throw new Error("连接已取消。");return target.action(opcode,args,blocking,timeout);},
      stopProgram:()=>{if(!guard())return Promise.resolve();return target.stopProgram();},cancelPending:()=>target.rejectPending(new Error('程序已停止。'))};
  },get busy(){return Boolean(link?.busy);},get executionPhase(){return link?.executionPhase;},get connected(){return Boolean(current&&link&&!link.closed);},get defaultDeviceId(){return prefs.getDefault();}};
  route();render();return api;
};
