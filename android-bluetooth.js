// Android owns discovery and GATT. This file owns one cancellable connection flow.
window.createXiaobaiBluetooth = ({model=CardModels.get('xiaobai')}={}) => {
  if (!window.CardPlatform?.isAndroid) return window.createModelBluetoothPreview(model);
  if(model.id==='xiaobai'&&!window.XiaobaiFirmware)throw new Error('主控固件核对组件未加载，请重新打开或更新 App。');
  const native=window.Capacitor.registerPlugin('SparkBle'),protocol=model.bluetooth.protocol();
  const prefs=window.XiaobaiDevicePreferences.create(localStorage,model.id);
  const timing=window.__XIAOBAI_BLE_TIMING||model.bluetooth.timing;
  let disposed=false,otaExclusive=false,firmware=null;
  let otaConnection=Object.freeze({phase:'idle',epoch:null,deviceId:null});
  const otaConnectionState=()=>Object.freeze({...otaConnection});
  function showOtaConnection(phase,epoch=null,deviceId=null,{expectedEpoch=null}={}){
    if(expectedEpoch!==null&&otaConnection.epoch!==expectedEpoch)return;
    if(disposed&&phase!=='idle')return;
    if(phase==='idle'){epoch=null;deviceId=null;}
    if(otaConnection.phase===phase&&otaConnection.epoch===epoch&&otaConnection.deviceId===deviceId)return;
    otaConnection=Object.freeze({phase,epoch,deviceId});
    window.dispatchEvent(new CustomEvent('xiaobai-ota-connection-change',{detail:otaConnectionState()}));
    renderStatus();
  }
  const clearOtaConnection=epoch=>showOtaConnection('idle',null,null,{expectedEpoch:epoch??null});
  const otaReceivers=new Set(),otaDisconnectListeners=new Set();
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
  const nameOf=device=>prefs.displayName(device);
  const withNativeName=(device,result)=>{const value={...device};for(const key of ['name','advertisedName','cachedName','nameSource','nameObservedAt','nameObservation'])if(result[key]!==undefined)value[key]=result[key];return value;};
  const valid=ticket=>!disposed&&ticket===version&&!document.hidden;
  function status(){
    if(otaConnection.phase==='connecting')return{id:'connecting',text:'正在连接升级主机…'};
    if(otaConnection.phase==='connected')return{id:'stop',text:firmware?.session?.state?.bootInfoEpoch===otaConnection.epoch?'已读取主控引导状态':'升级通道已连接，正在读取引导状态…'};
    if(connecting)return{id:'connecting',text:`正在连接 ${nameOf(connecting)}`};if(!current||!link||link.closed)return{id:scanning?'connecting':'disconnected',text:scanning?'正在搜索设备':'设备未连接'};return link.status ? {id:link.status.id,text:`${nameOf(current)} · ${link.status.text}`} : {id:'stop',text:`${nameOf(current)} 已连接`};}
  function renderStatus(){
    if(disposed)return;
    const value=status(),connected=Boolean(current&&link&&!link.closed),otaConnected=otaConnection.phase==='connected',otaConnecting=otaConnection.phase==='connecting';
    statusOutput.dataset.state=value.id;statusOutput.textContent=value.text;$('.bt-current p').textContent=value.text;
    CardBluetoothPage.status(page,{connected,connecting:Boolean(connecting),scanning,count:rows.size,otaConnection:{...otaConnectionState(),bootInfoVerified:otaConnected&&firmware?.session?.state?.bootInfoEpoch===otaConnection.epoch}});
    CardBluetoothPage.nameDetails?.(page,current||connecting||{},prefs.describeName?.(current||connecting||{}));
    trigger.classList.toggle('is-connected',connected||otaConnected);trigger.classList.toggle('is-connecting',Boolean(connecting||scanning||requesting||otaConnecting));
    trigger.title=trigger.ariaLabel=otaConnection.phase!=='idle'?value.text:current?`蓝牙已连接：${nameOf(current)}`:connecting?`正在连接：${nameOf(connecting)}`:scanning?'正在搜索设备':'蓝牙未连接';
  }
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
      CardBluetoothPage.device(row,device,{name:nameOf(device),isDefault:device.deviceId===defaultId,nameInfo:prefs.describeName?.(device)});
      const button=row.querySelector('.bt-connect');button.textContent=connecting?.deviceId===device.deviceId?'连接中…':'连接';button.disabled=Boolean(current||connecting?.manual);
    });
    $('.bt-empty').hidden=Boolean(list.childElementCount||current||connecting);$('.bt-empty strong').textContent=scanning?'正在扫描…':hasScanned?'暂未发现主机':'尚未扫描';$('.bt-empty > span:last-child').textContent=scanning?'请保持主机在手机附近':hasScanned?'请重试或手动选择设备':'打开主机电源后开始扫描';
  }
  function scheduleRender(){if(renderQueued)return;renderQueued=true;setTimeout(()=>{renderQueued=false;render();},80);}
  async function refresh(){const value=await native.getState();if(disposed)return;state=value;render();return state;}
  function clearTimer(target=flow){if(target?.timer){clearTimeout(target.timer);target.timer=null;}}
  async function cancelFlow(reason='cancelled'){const previous=flow;flow=null;version++;clearTimer(previous);requesting=false;const connectionId=connecting?.connectionId;connecting=null;if(scanning){scanning=false;await native.stopScan().catch(()=>{});}if(connectionId)await native.disconnect({connectionId}).catch(()=>{});trace('流程取消',null,reason);render();}
  async function ensureAccess(ticket){await ready;if(!valid(ticket))return false;const value=await native.requestAccess();if(!valid(ticket))return false;state=value;if(!state.permissionsGranted)throw new Error('请允许蓝牙扫描权限后重试。');if(!state.bluetoothEnabled)throw new Error('手机蓝牙未开启，请打开后重试。');if(state.requiresLocation&&!state.locationEnabled)throw new Error('请开启系统定位后重试，APP 不读取地理位置。');return true;}
  async function beginScan(kind,durationMs,targetId=''){
    if(disposed||otaExclusive)return;
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
  async function establish(device,ticket,manual,{boundDevice=false,quiet=false,confirmationOnly=false,guard=()=>true,onConnect=()=>{}}={}){
    const alive=()=>valid(ticket)&&guard();
    if(!device)throw new Error('设备已离开扫描列表，请重新扫描。');clearTimer();scanning=false;await native.stopScan().catch(()=>{});if(!alive())return;
    const connectionId=crypto.randomUUID();connecting={...device,connectionId,manual};render();tell(`正在连接 ${nameOf(device)}…`);trace('连接开始',null,device.deviceId);let candidateTransport,candidate;
    onConnect(connectionId);
    try{
      const result=await native.connect({deviceId:device.deviceId,connectionId,profile:model.bluetooth.nativeProfile||'xiaobai',boundDevice,...model.bluetooth.connectionOptions?.()});
      if(!alive()){await native.disconnect({connectionId}).catch(()=>{});return;}
      candidateTransport=new AndroidBleTransport(connectionId,result.properties);
      candidate=new protocol.Link(candidateTransport,{profile:model.bluetooth.profile?.(),onTrace:trace,onState:()=>{if(!disposed){renderStatus();window.CardProgram?.refresh();}},onEvent:event=>{
        if(disposed||transport!==candidateTransport)return;
        trace('EVENT',null,`code=${event.code} data=${Array.from(event.data).join(',')}`);
        if(candidate?.confirmationProbe)return;
        if(model.id==='xiaobai')firmware?.onVersionEvent(event,connectionId);
        if(event.code===1&&event.data[0]!==protocol.MODE.PROGRAM)firmware?.leaveProgram('主机已切换模式。');
        if(event.code===2||(event.code===1&&event.data[0]!==protocol.MODE.PROGRAM))window.dispatchEvent(new CustomEvent('xiaobai-program-abort',{detail:event}));
      },onError:error=>{
        if(valid(ticket))failure(error);
        if(!disposed&&link===candidate&&model.id==='xiaobai')
          window.dispatchEvent(new CustomEvent('xiaobai-program-abort',{detail:{reason:error.message}}));
      }});
      candidate.confirmationProbe=confirmationOnly;
      if(model.id==='xiaobai')candidate.firmwareGate=firmware;
      if(model.id==='xiaobai' && !confirmationOnly && window.XiaobaiLearnedCommands) {
        new XiaobaiLearnedCommands.Session(candidate,{storage:localStorage,onChange:()=>{
          if(disposed || link!==candidate)return;
          window.dispatchEvent(new Event('xiaobai-learned-change'));
          window.CardProgram?.refresh();
        }});
      }
      transport=candidateTransport;link=candidate;
      await candidate.start();
      if(!alive())throw new Error("连接已取消。");
      try{await candidate.probe();}
      catch(error){if(!alive()||!result.properties.fallbackWrite)throw error;trace('备用写入',null,'FFF2 无状态回报，改用 FFF1');await candidateTransport.useFallbackWrite();if(!alive())throw Object.assign(new Error('连接确认已取消。'),{code:'CANCELLED'});await candidate.probe();}
      if(!alive()){candidate.close();candidate.learned?.dispose();await native.disconnect({connectionId}).catch(()=>{});return;}
      link=candidate;current={...withNativeName(device,result),connectionId};connecting=null;
      firmware?.attachEpoch(connectionId,{owned:quiet&&otaExclusive});
      if(!quiet&&!otaExclusive&&desiredMode===protocol.MODE.PROGRAM)await enterProgram();
      else if(!quiet&&!otaExclusive&&desiredMode===protocol.MODE.REMOTE)await candidate.enterRemote();
      if(!alive())return;
      tell(`已连接 ${nameOf(current)}。`);trace('连接就绪',null,`${device.deviceId} ${prefs.describeName?.(current)?.description||''}`);render();
    }
    catch(error){candidate?.close();candidate?.learned?.dispose();candidateTransport?.close();if(transport===candidateTransport)transport=null;if(link===candidate)link=null;if(current?.connectionId===connectionId)current=null;if(connecting?.connectionId===connectionId)connecting=null;await native.disconnect({connectionId}).catch(()=>{});render();throw error;}
  }
  async function offerBoundRecovery(device,error){
    const binding=firmware?.session.binding;
    if(disposed||otaExclusive||document.hidden||!firmware?.hasRecovery()||binding?.deviceId!==device?.deviceId||
       !/^[0-9a-f]{24}$/.test(binding.uid||'')||error.result!==undefined||
       !['TIMEOUT','DISCONNECTED','CONNECTION_FAILED','UNAVAILABLE','GATT_ERROR'].includes(error.code))return false;
    // A C2 timeout is not identity evidence and never starts a transfer. The existing
    // binding only opens an explicit, fixed-target recovery choice in the editor.
    trace('OTA 恢复入口',null,`${device.deviceId} C2 ${error.code}`);
    desiredMode=protocol.MODE.PROGRAM;location.hash='editor';
    await firmware.onProgramRequested({interactive:true});return true;
  }
  async function manualConnect(device){if(disposed||otaExclusive)return;await cancelFlow('用户手动选择');const ticket=++version;flow={ticket,kind:'manual-connect',timer:null};try{await establish(device,ticket,true);if(!valid(ticket))return;prefs.setDefault(device.deviceId);flow=null;tell(`已连接并设为默认设备：${nameOf(device)}`);render();}catch(error){if(valid(ticket)){flow=null;if(await offerBoundRecovery(device,error)){render();return;}failure(new Error(`连接 ${nameOf(device)} 失败：${error.message}`));}render();}}
  async function manualScan(){if(otaExclusive)return;await cancelFlow('用户手动扫描');await beginScan('manual-scan',10000);}
  async function ensureConnected(){if(otaExclusive||disposed||!CardModelSession.selected||CardModelSession.switching)return false;if(current&&link&&!link.closed)return true;if(firmware?.hasRecovery()){firmware.onProgramRequested().catch(()=>{});return false;}if(autoPromise||flow||connecting||scanning||requesting)return autoPromise||false;autoPromise=(async()=>{const id=prefs.getDefault();await beginScan(id?'auto-default':'auto-first',id?timing.defaultScanMs:timing.firstScanMs,id);})().finally(()=>{autoPromise=null;});return autoPromise;}
  function clearConnection({otaOwned=false}={}){firmware?.disconnected(current?.connectionId||transport?.connectionId,{owned:otaOwned});if(current&&!otaOwned)window.dispatchEvent(new Event('xiaobai-disconnected'));link?.close();link?.learned?.dispose();transport?.close();link=null;transport=null;current=null;connecting=null;clearOtaConnection();render();}
  async function disconnect(){await firmware?.cancel({background:true,reason:'用户已断开升级连接。'});await cancelFlow('用户断开');const connectionId=transport?.connectionId;clearConnection();if(connectionId)await native.disconnect({connectionId});tell('已断开连接。');}
  function renameDevice(device){if(!device)return;const dialog=$('.bt-rename-dialog'),input=dialog.querySelector('input');dialog.returnValue='';dialog.dataset.deviceId=device.deviceId;input.value=prefs.customName(device.deviceId)||'';dialog.showModal();setTimeout(()=>{input.focus();input.select();},0);}
  $('.bt-rename-dialog').addEventListener('close',event=>{const dialog=event.currentTarget;if(dialog.returnValue!=='confirm')return;try{prefs.rename(dialog.dataset.deviceId,dialog.querySelector('input').value);render();tell('设备名称已保存在本机。');}catch(error){failure(error);}});
  const ready=(async()=>{
    await listen('scanResult',device=>{if(!scanning||device.scanId!==scanId||!model.bluetooth.accepts(device))return;rows.set(device.deviceId,device);scheduleRender();if(flow?.kind==='auto-default'&&device.deviceId===flow.targetId){const active=flow;active.kind='auto-connecting';clearTimer(active);establish(device,active.ticket,false).then(()=>{if(valid(active.ticket)){flow=null;render();}}).catch(error=>{if(valid(active.ticket)){flow=null;failure(new Error(`默认设备连接失败：${error.message}`));}});}});
    await listen('scanStopped',event=>{if(event.scanId!==scanId)return;scanning=false;if(event.reason==='finished'&&flow?.kind==='auto-default')finishScan(flow.ticket).catch(failure);else if(event.reason==='finished'&&flow?.kind==='manual-scan'){flow=null;tell(rows.size?'扫描完成，请选择设备。':'未发现设备，请重试。',!rows.size);}render();});
    await listen('notification',event=>{if(event.connectionId===transport?.connectionId)transport.notification(event.data);});
    await listen('otaNotification',event=>{if(event.connectionId!==transport?.connectionId)return;const bytes=Uint8Array.from(atob(event.data),c=>c.charCodeAt(0));for(const receiver of otaReceivers)receiver(bytes);});
    await listen('disconnected',event=>{
      if(event.connectionId&&event.connectionId===otaConnection.epoch)clearOtaConnection(event.connectionId);
      if(event.connectionId===connecting?.connectionId&&!current){
        trace('连接未完成',null,event.reason);
        if(event.connectionId===transport?.connectionId)link?.rejectPending(Object.assign(new Error(event.reason||'蓝牙连接已断开。'),{code:'DISCONNECTED'}));
        return;
      }
      if(event.connectionId!==transport?.connectionId)return;
      const owned=otaExclusive;
      // OTA lifecycle belongs to Session. A raw transport loss must reject its current
      // request, not be converted by the ordinary page handler into user cancellation.
      for(const listener of [...otaDisconnectListeners])listener(event);
      link?.rejectPending(Object.assign(new Error(event.reason||'蓝牙连接已断开。'),{code:'DISCONNECTED'}));
      version++;flow=null;clearConnection({otaOwned:owned});
      tell(event.reason||'连接已断开。',true);trace(owned?'OTA 连接断开':'连接断开',null,event.reason);
    });
    await listen('adapterState',value=>{state=value;render();});initialized=true;await refresh();
  })().catch(error=>failure(new Error('手机蓝牙初始化失败：'+error.message)));
  $('.bt-search').onclick=()=>{if(scanning||connecting)cancelFlow('用户停止').then(()=>tell('已停止搜索或连接。'));else manualScan().catch(failure);};$('#btDisconnect').onclick=()=>disconnect().catch(failure);$('.bt-rename-current').onclick=()=>renameDevice(current);
  $('#btAccess').onclick=async()=>{try{if(state?.permissionsGranted||state?.permissionState==='denied')await native.openSettings({target:'app'});else{state=await native.requestAccess();render();}}catch(error){failure(error);}};$('#btSystemSettings').onclick=()=>native.openSettings({target:'bluetooth'}).catch(failure);$('#btLocationSettings').onclick=()=>native.openSettings({target:'location'}).catch(failure);
  $('.bt-copy').onclick=async()=>{try{await navigator.clipboard.writeText('Xiaobai Android BLE diagnostics\n'+logs.join('\n'));tell('诊断已复制。');}catch{tell('复制失败，可展开诊断并长按选中文字。',true);}};
  function route(){if(disposed)return;const show=location.hash==='#bluetooth';page.hidden=!show;document.body.classList.toggle('bluetooth-open',show);if(show){closeParamEditor();document.title='手机蓝牙 · Drluck CodeLab';ready.then(refresh).catch(failure);}else{CardBluetoothPage.closePanels(page);if(flow?.kind==='manual-scan')cancelFlow('离开蓝牙界面').catch(()=>{});if(location.hash==='#editor'){document.title=document.querySelector('.brand-title').textContent+' · Drluck CodeLab';updateProgramAnchor();if(!document.getElementById('remoteControl')?.open)enterProgram().catch(failure);ready.then(ensureConnected).catch(failure);}}if(location.hash!=='#editor')firmware?.leaveProgram('已离开编程界面。');if(!otaExclusive&&location.hash!=='#editor'&&!document.getElementById('remoteControl')?.open){desiredMode=null;programEntry=null;const target=link;if(target?.suspendProgram)target.suspendProgram().catch(failure);else target?.stopHeartbeat();}}
  trigger.onclick=()=>window.CardOpenBluetooth('#editor');$('.bt-back').onclick=()=>window.CardBluetoothBack();window.addEventListener('hashchange',route,{signal:lifecycle.signal});window.addEventListener('card-bluetooth-route',route,{signal:lifecycle.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){firmware?.cancel({background:true,reason:'应用进入后台，升级已停止。'}).catch(()=>{});const connectionId=transport?.connectionId;cancelFlow('应用进入后台').catch(()=>{});clearConnection();if(connectionId)native.disconnect({connectionId}).catch(()=>{});}else ready.then(refresh).catch(failure);},{signal:lifecycle.signal});const statusTimer=setInterval(renderStatus,250);
  let programEntry=null;
  async function enterProgram(){
    if(disposed||otaExclusive)return;desiredMode=protocol.MODE.PROGRAM;
    const target=link;if(!target||target.closed){await firmware?.onProgramRequested();return false;}
    if(programEntry?.link===target)return programEntry.promise;
    const entry={link:target,promise:null};
    entry.promise=(async()=>{
      await target.enterProgram();
      const matched=firmware?await firmware.onProgramEntered(current?.connectionId):true;
      if(matched&&link===target&&!disposed&&desiredMode===protocol.MODE.PROGRAM)await target.learned?.initialize().catch(()=>{});
      return matched;
    })().finally(()=>{if(programEntry===entry)programEntry=null;});
    programEntry=entry;return entry.promise;
  }
  async function enterRemote(){if(disposed||otaExclusive)return;firmware?.leaveProgram('已切换到遥控界面。');desiredMode=protocol.MODE.REMOTE;programEntry=null;if(link&&!link.closed)await link.enterRemote();}
  // OTA owns this exact native device, not a scan result with a matching name.
  const otaActive=()=>!disposed&&otaExclusive&&!document.hidden&&!firmware?.cancelled&&!firmware?.session.cancelRequested;
  const requireOta=()=>{if(!otaActive())throw Object.assign(new Error('升级连接已取消。'),{code:'CANCELLED'});};
  let otaBoundScan=null;
  const cancelOtaBoundScan=()=>otaBoundScan?.cancel();
  async function freshBoundOtaAdvertisement(binding,{confirmationOnly=false,deadlineAt=Infinity}={}){
    requireOta();
    if(otaBoundScan)throw Object.assign(new Error('原主机广播检查尚未结束。'),{code:'BUSY'});
    const owner={scanId:crypto.randomUUID(),generation:firmware?.session.generation,consent:firmware?.consent,started:false,cancelled:false,stopPromise:null};
    const handles=[],removals=[],candidates=new Map();let timer,settled=false,resolveMatch,rejectMatch,device;
    const match=new Promise((resolve,reject)=>{resolveMatch=resolve;rejectMatch=reject;});match.catch(()=>{});
    const finish=(error,device)=>{if(settled)return;settled=true;error?rejectMatch(error):resolveMatch(device);};
    const check=()=>{requireOta();if(otaBoundScan!==owner||owner.cancelled||firmware?.session.generation!==owner.generation||firmware?.consent!==owner.consent)throw Object.assign(new Error('升级连接准备已取消。'),{code:'CANCELLED'});};
    const stop=()=>{
      if(otaBoundScan!==owner||!owner.started)return Promise.resolve();
      if(!owner.stopPromise)owner.stopPromise=Promise.resolve(native.stopScan()).catch(error=>{owner.stopError=error;});
      return owner.stopPromise;
    };
    const cleanup=async()=>{await stop();for(const handle of handles.splice(0))removals.push(Promise.resolve(handle.remove()));await Promise.allSettled(removals);};
    owner.cancel=()=>{owner.cancelled=true;finish(Object.assign(new Error('升级连接准备已取消。'),{code:'CANCELLED'}));cleanup().catch(()=>{});};
    otaBoundScan=owner;
    try{
      const scanEnded=()=>confirmationOnly?finish(null,null):finish(Object.assign(new Error('10 秒内未收到原主机的新广播，请保持主机供电并在附近，稍后重试确认。'),{code:'SCAN_TIMEOUT'}));
      check();handles.push(await native.addListener('scanResult',device=>{
        if(settled||device.scanId!==owner.scanId)return;
        try{
          check();
          if(device.deviceId===binding.deviceId){finish(null,device);return;}
          // Radio names only shortlist a bounded set. Service/C2, fresh UID and
          // exact INFO below are required before accepting any different locator.
          const radioName=XiaobaiDevicePreferences.cleanRadioName(device.name)||XiaobaiDevicePreferences.cleanRadioName(device.advertisedName);
          if(confirmationOnly&&device.deviceId&&candidates.size<3&&/^(?:Spark[_ ]?AI|BT_[0-9a-f]{12}|XiaoBai(?:[_ -].*)?|小白(?:[_ -].*)?)$/i.test(radioName))candidates.set(device.deviceId,device);
        }catch(error){finish(error);}
      }));check();
      handles.push(await native.addListener('scanStopped',event=>{
        if(settled||event.scanId!==owner.scanId)return;
        try{check();if(event.reason==='finished')scanEnded();else finish(Object.assign(new Error('原主机广播检查已停止，请重试确认。'),{code:'SCAN_FAILED'}));}catch(error){finish(error);}
      }));check();
      trace('OTA 广播检查',null,`${binding.deviceId} scan=${owner.scanId}`);
      owner.started=true;check();await native.startScan({scanId:owner.scanId,includeUnnamed:true});check();
      timer=setTimeout(scanEnded,Math.max(0,Math.min(10000,deadlineAt-performance.now())));
      device=await match;check();
      trace(device?'OTA 原主机广播已确认':'OTA 确认候选扫描完成',null,`${binding.deviceId} scan=${owner.scanId}`);
    }catch(error){
      if(!otaActive()||owner.cancelled||firmware?.session.generation!==owner.generation||firmware?.consent!==owner.consent)throw Object.assign(new Error('升级连接准备已取消。'),{code:'CANCELLED'});
      if(!error.code)error.code='SCAN_FAILED';throw error;
    }finally{
      clearTimeout(timer);await cleanup();if(otaBoundScan===owner)otaBoundScan=null;
    }
    requireOta();
    if(owner.cancelled||firmware?.session.generation!==owner.generation||firmware?.consent!==owner.consent)throw Object.assign(new Error('升级连接准备已取消。'),{code:'CANCELLED'});
    if(owner.stopError)throw Object.assign(new Error('原主机广播检查未能停止，请重新确认恢复。'),{code:'SCAN_FAILED'});
    return confirmationOnly?{device,candidates:[...candidates.values()]}:device;
  }

  async function connectAppForConfirmation(binding,target,deadlineAt){
    requireOta();
    const owner={generation:firmware?.session.generation,consent:firmware?.consent,epoch:null,expired:false,reused:Boolean(current&&link&&!link.closed)};
    const deadline=Number.isFinite(deadlineAt)?deadlineAt:performance.now()+30000;
    const check=()=>{
      requireOta();
      if(owner.expired||performance.now()>=deadline)throw Object.assign(new Error('主机启动尚待连接确认，请重试确认。'),{code:'UNCONFIRMED'});
      if(firmware?.session.generation!==owner.generation||firmware?.consent!==owner.consent)throw Object.assign(new Error('启动确认已取消。'),{code:'CANCELLED'});
    };
    const exact=actual=>{
      check();const i=actual?.info;
      if(actual?.uid!==binding.uid||!actual.deviceId||actual.epoch!==current?.connectionId)throw Object.assign(new Error('候选主机不是原绑定主机，已停止确认。'),{code:'IDENTITY'});
      if(!target||!i||i.mode!==0||i.protocol!==XiaobaiOtaProtocol.C.OTA_PROTOCOL_VERSION||!i.imageValid||i.boardId!==target.boardId||i.version!==target.version||i.imageSize!==target.imageSize||i.imageSha256!==target.imageSha256)throw Object.assign(new Error('原主机镜像尚未匹配，请重新核对固件。'),{code:'IMAGE_MISMATCH'});
      return actual;
    };
    const closeCandidate=async()=>{
      const id=owner.epoch;if(!id)return;
      if(transport?.connectionId===id||current?.connectionId===id||connecting?.connectionId===id)clearConnection({otaOwned:true});
      await native.disconnect({connectionId:id}).catch(()=>{});
      if(owner.epoch===id)owner.epoch=null;
    };
    const readUid=async()=>{
      const candidate=link,id=current?.connectionId;const bytes=[];
      for(let part=0;part<2;part++){
        check();if(!candidate||candidate!==link||candidate.closed||id!==current?.connectionId)throw Object.assign(new Error('候选主机连接已变化。'),{code:'DISCONNECTED'});
        const data=await candidate.request(candidate.nextSeq(),protocol.OP.READ_UID,[part],Math.max(1,Math.min(1800,deadline-performance.now())),(data,result)=>result!==0||data[0]===part);
        check();if(candidate!==link||candidate.closed||id!==current?.connectionId)throw Object.assign(new Error('候选主机连接已变化。'),{code:'DISCONNECTED'});
        if(data.length!==7||data[0]!==part)throw Object.assign(new Error('候选主机没有有效的小白身份反馈。'),{code:'IDENTITY'});
        bytes.push(...data.slice(1));
      }
      return bytes.map(n=>n.toString(16).padStart(2,'0')).join('');
    };
    let timer;
    const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{
      owner.expired=true;if(owner.scan&&otaBoundScan===owner.scan)owner.scan.cancel();
      if(!owner.reused)closeCandidate().catch(()=>{});
      reject(Object.assign(new Error('主机启动尚待连接确认，请重试确认。'),{code:'UNCONFIRMED'}));
    },Math.max(0,deadline-performance.now()));});
    const operation=(async()=>{
      check();
      // A valid current App is never disconnected merely to confirm it again.
      if(owner.reused)return exact(await otaAdapter.readApp({guard:()=>{check();return true;}}));
      await otaAdapter.disconnect();check();
      const scanning=freshBoundOtaAdvertisement(binding,{confirmationOnly:true,deadlineAt:deadline});owner.scan=otaBoundScan;
      const scan=await scanning;check();
      const candidates=scan.device?[scan.device]:scan.candidates;let last;
      for(const device of candidates){
        check();
        try{
          const ticket=++version;
          await establish(device,ticket,false,{boundDevice:device.deviceId===binding.deviceId,quiet:true,confirmationOnly:true,guard:()=>{check();return true;},onConnect:id=>{owner.epoch=id;}});check();
          if(await readUid()!==binding.uid)throw Object.assign(new Error('候选 UID 与原主机不符。'),{code:'IDENTITY'});
          const actual=await otaAdapter.readApp({guard:()=>{check();return true;}});check();
          return exact(actual);
        }catch(error){
          last=error;
          // Keep the real original App available for a new explicit version check.
          if(error.code==='IMAGE_MISMATCH')throw error;
          await closeCandidate();check();
          if(device.deviceId===binding.deviceId&&error.code==='IDENTITY')throw error;
          trace('OTA 确认候选已拒绝',null,`${device.deviceId} ${error.code||error.message}`);
        }
      }
      throw Object.assign(new Error(`原主机启动尚待连接确认${last?`：${last.message}`:''}。请保持主机供电后重试确认。`),{code:'UNCONFIRMED'});
    })();
    operation.catch(()=>{});
    try{return await Promise.race([operation,timeout]);}finally{clearTimeout(timer);}
  }

  const otaAdapter=model.id!=='xiaobai'?null:{
    traceOta(stage,detail=''){if(!disposed)trace('OTA '+stage,null,typeof detail==='string'?detail:JSON.stringify(detail));},
    async prepare(){
      if(disposed)throw new Error('设备会话已关闭。');
      otaExclusive=true;await cancelFlow('主控升级接管连接');
      await ready;
      await window.CardProgram?.stop();await model.remote?.reset?.();
      const target=link;
      if(target&&!target.closed){
        target.learned?.stop('即将升级主控。');
        await target.write(protocol.command(0,protocol.OP.STOP_PROGRAM));
        target.learned?.dispose();target.rejectPending(new Error('即将升级主控。'));
      }
      otaExclusive=true;desiredMode=null;programEntry=null;
      window.CardProgram?.refresh();
    },
    async release(){
      cancelOtaBoundScan();clearOtaConnection();otaExclusive=false;
      if(link&&!link.closed&&link.learned?.disposed&&window.XiaobaiLearnedCommands){
        new XiaobaiLearnedCommands.Session(link,{storage:localStorage,onChange:()=>{window.dispatchEvent(new Event('xiaobai-learned-change'));window.CardProgram?.refresh();}});
      }
      window.CardProgram?.refresh();render();
    },
    async readApp({guard=()=>true}={}){
      if(!current||!link||link.closed)throw Object.assign(new Error('请先通过蓝牙连接小白，再读取主控版本。'),{code:'DISCONNECTED'});
      const target=link,device={...current};
      const active=()=>{if(!guard()||target!==link||target.closed||current?.connectionId!==device.connectionId)throw new Error('读取过程中设备连接已变化。');};
      const read=async()=>{const parts=[],uid=[];
      // INFO/UID do not renew the firmware's one-second program watchdog.
      // A real global status query between pairs keeps the read coherent at 9600 baud.
      const keepAlive=async()=>{active();const status=await target.request(target.nextSeq(),protocol.OP.QUERY_STATUS,[],1800);active();if(status.length!==7||status[0]>4)throw new Error('主机状态反馈无效。');target.mode=status[0];};
      await keepAlive();
      // All ten parts and both UID halves are freshly requested in this connection epoch.
      for(let part=0;part<10;part++){
        if(part>0&&part%2===0)await keepAlive();
        active();const data=await target.request(target.nextSeq(),0x60,[part],1800,(data,result)=>result!==0||data[0]===part);active();parts.push(data);
      }
      await keepAlive();
      for(let part=0;part<2;part++){
        const data=await target.request(target.nextSeq(),protocol.OP.READ_UID,[part],1800,(data,result)=>result!==0||data[0]===part);active();
        if(data.length!==7||data[0]!==part)throw new Error('主机身份反馈无效。');uid.push(...data.slice(1));
      }
      return{info:XiaobaiOtaProtocol.assembleAppInfo(parts),uid:uid.map(n=>n.toString(16).padStart(2,'0')).join(''),deviceId:device.deviceId,name:nameOf(device),epoch:device.connectionId,productMode:target.mode};
      };
      try{return await read();}
      catch(error){
        // A mode event already in flight can cancel the first query. Re-read the whole
        // identity once in the observed stable mode, never stitch partial generations.
        if(error.result!==undefined||target!==link||target.closed||current?.connectionId!==device.connectionId)throw error;
        return read();
      }
    },
    async queryStatus(){
      const target=link,epoch=current?.connectionId;if(!target||target.closed||!epoch)throw new Error('主机连接已断开。');
      const seq=target.nextSeq(),sentAt=performance.now();
      const data=await target.request(seq,protocol.OP.QUERY_STATUS,[],1800);
      if(target!==link||current?.connectionId!==epoch)throw new Error('状态反馈来自旧连接。');
      return{epoch,seq,opcode:4,result:0,data:Array.from(data),sentAt,receivedAt:performance.now()};
    },
    raw(){
      const id=transport?.connectionId;if(!id)throw Object.assign(new Error('主控升级连接已断开。'),{code:'DISCONNECTED'});
      return{get connectionId(){return id;},subscribe(fn){otaReceivers.add(fn);return()=>otaReceivers.delete(fn);},onDisconnect(fn){const listener=event=>{if(event.connectionId===id)fn(event);};otaDisconnectListeners.add(listener);return()=>otaDisconnectListeners.delete(listener);},write(bytes){if(id!==transport?.connectionId||!otaExclusive)throw Object.assign(new Error('升级连接已变化。'),{code:'DISCONNECTED'});return native.writeOta({connectionId:id,data:btoa(String.fromCharCode(...bytes))});}};
    },
    async enterBoot(){
      requireOta();
      const target=link,id=transport?.connectionId;if(!target||!id)throw Object.assign(new Error('主机连接已断开。'),{code:'DISCONNECTED'});
      // Quiesced tasks no longer need a heartbeat. Fence its queued writes before ENTER,
      // including the case where the ACK is lost but the controller already reset.
      target.stopHeartbeat();target.modeVersion++;target.desiredMode=null;target.modeEntry=null;
      target.rejectPending(new Error('正在切换主控升级模式。'));await target.queue;
      trace('OTA ENTER',null,`epoch=${id}`);
      try{await target.request(target.nextSeq(),0x61,[],2500);trace('OTA ENTER 受理',null,`epoch=${id}`);}
      catch(error){
        if(Number.isInteger(error.result)&&error.result!==0){
          if(error.result===4)throw Object.assign(new Error(error.data?.[0]===12?'主机电量不足，请充电后重试。':'主机仍忙，未接受升级请求。'),{code:'BUSY',result:error.result,data:error.data,deviceRejected:true,notEntered:true});
          error.deviceRejected=true;error.notEntered=true;throw error;
        }
        requireOta();
        if(id!==transport?.connectionId||error.code==='DISCONNECTED')throw Object.assign(error,{code:'DISCONNECTED'});
        if(error.code!=='TIMEOUT')throw error;
        trace('OTA ENTER ACK 未确认',null,'仅尝试原绑定主机的 Boot INFO，不重发 C2');
      }
      // A reset can drop GATT after a successful or lost ACK. Session must recheck
      // cancellation/consent before reconnecting the original bound device.
      requireOta();
      if(id!==transport?.connectionId)throw Object.assign(new Error('主机已切换升级连接，需重新读取 Boot。'),{code:'DISCONNECTED'});
      target.close();await target.queue;if(link===target)link=null;
      showOtaConnection('connecting',id,current?.deviceId||null);
      try{await native.beginOta({connectionId:id});}
      catch(error){clearOtaConnection(id);if(id!==transport?.connectionId)error.code='DISCONNECTED';throw error;}
      try{requireOta();}catch(error){clearOtaConnection(id);throw error;}
      showOtaConnection('connected',id,current?.deviceId||null,{expectedEpoch:id});return this.raw();
    },
    async connectBoot(binding){
      if(!binding?.uid||!binding.deviceId)throw new Error('缺少原主机绑定身份。');
      requireOta();await this.disconnect();requireOta();await ready;requireOta();
      await freshBoundOtaAdvertisement(binding);requireOta();
      const id=crypto.randomUUID();trace('OTA Boot 重连',null,`${binding.deviceId} epoch=${id}`);
      showOtaConnection('connecting',id,binding.deviceId);
      try{
        const result=await native.connect({deviceId:binding.deviceId,connectionId:id,profile:'xiaobai',boundDevice:true});
        if(!otaActive()){await native.disconnect({connectionId:id});requireOta();}
        transport=new AndroidBleTransport(id,result.properties);current={...withNativeName({deviceId:binding.deviceId,name:binding.name},result),connectionId:id};firmware?.attachEpoch(id,{owned:true});
        await native.subscribe({connectionId:id});requireOta();await native.beginOta({connectionId:id});requireOta();
        showOtaConnection('connected',id,binding.deviceId,{expectedEpoch:id});trace('OTA Boot 通道就绪',null,`epoch=${id}`);return this.raw();
      }catch(error){clearOtaConnection(id);throw error;}
    },
    async connectApp(binding,{confirmationOnly=false,target=null,deadlineAt}={}){
      if(!binding?.uid||!binding.deviceId)throw new Error('缺少升级前的主机身份。');
      if(confirmationOnly)return connectAppForConfirmation(binding,target,deadlineAt);
      requireOta();await this.disconnect();requireOta();
      const device=await freshBoundOtaAdvertisement(binding);requireOta();
      const ticket=++version;trace('OTA App 重连',null,`${binding.deviceId} ticket=${ticket}`);
      await establish(device,ticket,false,{boundDevice:true,quiet:true});requireOta();
    },
    async disconnect(){cancelOtaBoundScan();const id=transport?.connectionId||connecting?.connectionId;clearConnection({otaOwned:true});otaReceivers.clear();if(id)await native.disconnect({connectionId:id}).catch(()=>{});},
    connectionState:otaConnectionState,
    get connected(){return Boolean(current&&link&&!link.closed);},
    get nativeSupported(){return state?.otaTransportVersion===1;},
    identity(){return current&&link&&!link.closed?{epoch:current.connectionId,deviceId:current.deviceId}:null;},
    async enterProgramRaw(){if(!current||!link||link.closed)throw new Error('编程连接已断开。');const candidate=link,id=current.connectionId;desiredMode=protocol.MODE.PROGRAM;await candidate.enterProgram();if(link!==candidate||candidate.closed||current?.connectionId!==id)throw new Error('编程连接已变化。');candidate.confirmationProbe=false;},
    adoptConfirmedLocator(actual,previousDeviceId){
      if(!current||!link||link.closed||actual.epoch!==current.connectionId||actual.deviceId!==current.deviceId||firmware?.session.binding?.uid!==actual.uid||firmware?.session.binding?.deviceId!==actual.deviceId)throw new Error('主机确认连接已变化。');
      const saved=prefs.getDefault();
      if(saved===previousDeviceId||saved===actual.deviceId)prefs.setDefault(actual.deviceId);
    },
    async initializeLearned({confirmationEpoch=null}={}){
      const snapshot=firmware?.snapshot(),confirmed=confirmationEpoch&&confirmationEpoch===current?.connectionId&&confirmationEpoch===snapshot?.actual?.epoch&&confirmationEpoch===firmware?.session.state.healthVerifiedEpoch&&snapshot.busy;
      if(!link||link.closed||(!snapshot?.ready&&!confirmed))throw new Error('固件尚未核对。');
      if(!link.learned&&window.XiaobaiLearnedCommands){const candidate=link;new XiaobaiLearnedCommands.Session(candidate,{storage:localStorage,onChange:()=>{if(!disposed&&link===candidate){window.dispatchEvent(new Event('xiaobai-learned-change'));window.CardProgram?.refresh();}}});}
      await link.learned?.initialize();
    }

  };
  if(model.id==='xiaobai'&&window.XiaobaiFirmware)firmware=new XiaobaiFirmware.Gate(otaAdapter,{storage:localStorage,onChange:snapshot=>{
    window.dispatchEvent(new CustomEvent('xiaobai-firmware-change',{detail:snapshot}));window.CardProgram?.refresh();renderStatus();
  }});
  const api={ota:otaAdapter,firmware,disconnect,cancelAuto:()=>cancelFlow('切换设备型号'),async dispose(){
    if(disposed)return;await firmware?.dispose();clearOtaConnection();disposed=true;lifecycle.abort();clearInterval(statusTimer);
    const pending=cancelFlow('切换设备型号');
    const connectionId=transport?.connectionId;link?.close();link?.learned?.dispose();transport?.close();link=null;transport=null;current=null;
    page.remove();trigger.classList.remove('is-connected','is-connecting');statusOutput.dataset.state='disconnected';statusOutput.textContent='设备未连接';
    await Promise.allSettled([pending,...listeners.map(handle=>handle.remove()),connectionId?native.disconnect({connectionId}):Promise.resolve()]);
  },ensureConnected,enterProgram,enterRemote,remoteConnection(){
    if(otaExclusive||!current||!link||link.closed)return null;const target=link,id=current.connectionId;
    const guard=()=>Boolean(!disposed&&!otaExclusive&&current&&current.connectionId===id&&target===link&&!target.closed);
    return{id,learned:target.learned,firmware,ensureFirmware:options=>firmware?firmware.ensureReady(options):Promise.resolve(true),setMotors:(left,right,shouldWrite=()=>true)=>{if(!guard())return Promise.reject(new Error('连接已取消。'));return target.setMotors(left,right,()=>guard()&&shouldWrite());},stopNeedsConfirmation:Boolean(target.stopNeedsConfirmation),uploadProgram:(bytes,options)=>{if(!guard())throw new Error('连接已取消。');return target.uploadProgram(bytes,options);},send(bytes,shouldWrite=()=>true){if(!guard())return Promise.reject(new Error('蓝牙连接已断开，请重新连接。'));if(firmware&&!firmware.snapshot().ready&&bytes[4]===0xc2&&bytes[6]>5&&![protocol.OP.MOTOR_STOP,protocol.OP.MOVE_STOP].includes(bytes[6]))return Promise.reject(new Error('请先完成主控固件核对。'));return target.send(bytes,()=>guard()&&shouldWrite());},
      enterProgram:()=>{if(!guard())throw new Error('蓝牙连接已断开。');return enterProgram();},
      enterRemote:()=>{if(!guard())throw new Error('蓝牙连接已断开。');return enterRemote();},
      ...(typeof target.readTilt==='function'?{readTilt:()=>{if(!guard())throw new Error('连接已取消。');return target.readTilt();}}:{}),
      action:(opcode,args,blocking,timeout)=>{if(!guard())throw new Error("连接已取消。");return target.action(opcode,args,blocking,timeout);},
      stopProgram:()=>{if(!guard())return Promise.resolve();return target.stopProgram();},cancelPending:()=>target.rejectPending(new Error('程序已停止。'))};
  },get busy(){return Boolean(otaExclusive||firmware?.snapshot().busy||link?.busy || link?.learned?.getSnapshot().busy);},get executionPhase(){return link?.executionPhase;},get connected(){return Boolean(current&&link&&!link.closed);},get defaultDeviceId(){return prefs.getDefault();}};
  route();render();return api;
};
