// Android owns device discovery and GATT. Shared SparkProtocol owns framing and parsing.
(() => {
  if (!window.CardPlatform?.isAndroid) return;
  const native=window.Capacitor.registerPlugin('SparkBle');
  const protocol=window.SparkProtocol;
  class AndroidBleTransport {
    constructor(connectionId, properties) {this.connectionId=connectionId;this.properties=properties;this.receive=null;}
    async start(receive) {this.receive=receive;await native.subscribe({connectionId:this.connectionId});}
    write(bytes) {return native.write({connectionId:this.connectionId,data:btoa(String.fromCharCode(...bytes))});}
    close() {this.receive=null;}
    disconnect() {return native.disconnect({connectionId:this.connectionId}).catch(error=>trace('断开失败',null,error.message));}
    notification(data) {if(this.receive) this.receive(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));}
  }
  const page=document.createElement('section');
  page.className='bluetooth-page android-bluetooth';page.hidden=true;
  page.innerHTML=`<header class="bt-top"><button class="bt-back" type="button">← 返回编程</button><h1>手机蓝牙</h1><span class="bt-native-badge">小白</span></header>
    <main class="bt-mobile-layout"><aside class="bt-phone-panel">
      <div class="bt-phone-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 7 10 10-5 5V2l5 5L7 17"/></svg></div>
      <h2>连接你的主机</h2><p>主机开机后放在手机附近，点击扫描并选择设备。</p>
      <div class="bt-phone-setting"><span>手机蓝牙</span><strong id="btRadioState">检查中</strong></div>
      <button class="bt-button" id="btSystemSettings" type="button">打开系统蓝牙设置</button>
      <div class="bt-phone-setting"><span>扫描权限</span><strong id="btPermissionState">检查中</strong></div>
      <button class="bt-button" id="btAccess" type="button">允许扫描权限</button>
      <div class="bt-location" hidden><p>此手机扫描蓝牙需要定位权限及系统定位开关；应用不读取地理位置。</p><button class="bt-button" id="btLocationSettings" type="button">打开系统定位设置</button></div>
      <p class="bt-stage-note">请将小白切换到遥控模式。手机负责执行积木程序，运行期间请保持应用在前台。</p>
    </aside><section class="bt-device-panel" aria-label="蓝牙设备">
      <section class="bt-current" hidden aria-label="当前连接"><div><span class="bt-eyebrow">当前设备</span><h2></h2><p role="status"></p></div><button class="bt-button" id="btDisconnect" type="button">断开</button></section>
      <div class="bt-section-header"><div><h2>附近的主机</h2><span class="bt-scan-description">选择你的小白主机</span></div><button class="bt-button primary bt-search" type="button">扫描设备</button></div>
      <p class="bt-message" role="status" aria-live="polite">点击扫描，查找附近的小白主机。</p>
      <ul class="bt-list" aria-label="扫描结果"></ul>
      <div class="bt-empty"><span class="bt-radar" aria-hidden="true"></span><strong>尚未扫描</strong><span>打开主机电源后开始扫描</span></div>
      <p class="bt-mobile-help">找不到主机？请确认它没有连接其他手机或电脑，然后重新扫描。</p>
      <details class="bt-diagnostics"><summary>连接诊断</summary><pre class="bt-trace" tabindex="0"></pre><button class="bt-button bt-copy" type="button">复制诊断</button></details>
    </section></main>`;
  document.body.append(page);
  const $=selector=>page.querySelector(selector);
  const trigger=document.getElementById('bluetoothBtn'),statusOutput=document.getElementById('deviceStatus');
  const rows=new Map(),renderedRows=new Map(),logs=[];
  let state=null,scanning=false,requesting=false,scanId='',hasScanned=false;
  let connecting=null,current=null,transport=null,link=null,deviceState=null,version=0;
  let sending=null,stopping=false;
  let initialized=false,renderQueued=false;
  function trace(kind,bytes,detail='') {
    logs.push(`${new Date().toISOString()} ${kind} ${detail} ${bytes?Array.from(bytes.slice(0,256),b=>b.toString(16).padStart(2,'0')).join(' '):''}`.trim());
    if(logs.length>200) logs.shift();
    $('.bt-trace').textContent=logs.join('\n');
  }
  function tell(text,error=false) {$('.bt-message').textContent=text;$('.bt-message').classList.toggle('error',error);}
  function failure(error) {trace('错误',null,error.message);tell(error.message||'蓝牙操作失败，请重试。',true);}
  function status() {
    if(connecting) return {id:'connecting',text:'设备连接中'};
    if(!current || !link || link.closed) return {id:'disconnected',text:'设备未连接'};
    if(!deviceState) return {id:'stop',text:'小白已连接'};
    if(performance.now()-deviceState.time>2000) return {id:'stale',text:'已连接，状态已过期'};
    return {id:deviceState.value,text:deviceState.value==='run'?'设备运行中':'设备已停止'};
  }
  function renderStatus() {
    const value=status();statusOutput.dataset.state=value.id;statusOutput.textContent=value.text;
    $('.bt-current p').textContent=value.text;
  }
  function render() {
    renderStatus();
    $('#btRadioState').textContent=!state?'检查中':!state.available?'不可用':
      (!state.requiresLocation&&!state.permissionsGranted)?'待授权':state.bluetoothEnabled?'已开启':'已关闭';
    $('#btPermissionState').textContent=state?.permissionsGranted?'已允许':state?'待授权':'检查中';
    $('#btAccess').textContent=state?.permissionsGranted?'管理应用权限':'允许扫描权限';
    $('#btAccess').disabled=requesting || !initialized;
    $('.bt-location').hidden=!state?.requiresLocation || (state.permissionsGranted && state.locationEnabled);
    $('#btLocationSettings').textContent=state?.locationEnabled?'系统定位已开启':'开启系统定位';
    const search=$('.bt-search');
    search.disabled=!initialized || (state && !state.available) || Boolean(connecting||current) || requesting;
    search.textContent=requesting?'等待授权…':scanning?'停止扫描':hasScanned?'重新扫描':'扫描设备';
    $('.bt-scan-description').textContent=scanning?'正在查找附近主机，约 10 秒':`选择你的小白主机${rows.size?' · '+rows.size+' 台':''}`;
    page.classList.toggle('is-scanning',scanning);
    $('.bt-current').hidden=!current && !connecting;
    $('.bt-current h2').textContent=(current||connecting)?.name||'Spark_AI';
    $('#btDisconnect').textContent=connecting?'取消连接':'断开';
    const list=$('.bt-list');
    for(const [id,row] of renderedRows) {
      if(!rows.has(id)||id===current?.deviceId) {row.remove();renderedRows.delete(id);}
    }
    // Keep discovery order and DOM nodes stable while RSSI updates arrive during a tap.
    rows.forEach(device=>{
      if(device.deviceId===current?.deviceId) return;
      let row=renderedRows.get(device.deviceId);
      if(!row) {
        row=document.createElement('li');row.className='bt-device';row.dataset.deviceId=device.deviceId;
        row.innerHTML='<span class="bt-signal"></span><div class="bt-device-info"><strong></strong><small></small></div><button type="button" class="bt-button">连接</button>';
        for(let i=1;i<=4;i++) {const bar=document.createElement('i');bar.style.height=`${6+i*5}px`;row.querySelector('.bt-signal').append(bar);}
        row.querySelector('button').onclick=()=>connect(rows.get(device.deviceId));
        renderedRows.set(device.deviceId,row);list.append(row);
      }
      const signal=row.querySelector('.bt-signal');
      const level=device.rssi>=-60?4:device.rssi>=-75?3:device.rssi>=-90?2:1;
      signal.setAttribute('aria-label',`信号${['','较弱','一般','良好','很强'][level]}，${device.rssi} dBm`);
      [...signal.children].forEach((bar,i)=>bar.classList.toggle('lit',i<level));
      row.querySelector('strong').textContent=device.name;
      row.querySelector('small').textContent=`${device.deviceId.slice(-8)} · ${device.rssi} dBm`;
      const button=row.querySelector('button');
      button.textContent=connecting?.deviceId===device.deviceId?'连接中…':'连接';button.disabled=Boolean(connecting||current);
    });
    $('.bt-empty').hidden=Boolean(list.childElementCount||current||connecting);
    $('.bt-empty strong').textContent=scanning?'正在扫描…':hasScanned?'暂未发现主机':'尚未扫描';
    $('.bt-empty > span:last-child').textContent=scanning?'请保持主机在手机附近':hasScanned?'检查主机电源与连接状态后重试':'打开主机电源后开始扫描';
    trigger.classList.toggle('is-connected',Boolean(current&&link&&!link.closed));
    trigger.classList.toggle('is-connecting',Boolean(connecting||scanning));
    trigger.title=trigger.ariaLabel=current?'蓝牙已连接':connecting?'蓝牙正在连接':'手机蓝牙';
  }
  function scheduleRender() {
    if(renderQueued) return;renderQueued=true;
    setTimeout(()=>{renderQueued=false;render();},150);
  }
  async function refresh() {state=await native.getState();render();return state;}
  function valid(ticket) {return version===ticket && !document.hidden;}
  async function scan() {
    const ticket=++version;requesting=true;render();
    try {
      await ready;
      state=await native.requestAccess();
      if(!valid(ticket) || location.hash!=='#bluetooth') return;
      if(!state.permissionsGranted) throw new Error('扫描权限未获允许。请点击“允许扫描权限”，或在应用设置中授权。');
      if(!state.bluetoothEnabled) throw new Error('手机蓝牙未开启，请打开系统蓝牙设置。');
      if(!state.locationEnabled) throw new Error('此 Android 版本扫描蓝牙需要开启系统定位，请点击左侧按钮。');
      rows.clear();scanId=crypto.randomUUID();hasScanned=true;scanning=true;
      tell('正在扫描附近的小白主机 主机…');trace('扫描开始');render();
      await native.startScan({scanId});
    } catch(error) {if(valid(ticket)) {scanning=false;failure(error);}}
    finally {if(version===ticket) requesting=false;render();}
  }
  async function stopScan() {scanning=false;requesting=false;render();await native.stopScan();}
  function clearConnection() {window.dispatchEvent(new Event("xiaobai-disconnected"));link?.close();transport?.close();link=null;transport=null;current=null;connecting=null;deviceState=null;render();}
  async function disconnect() {
    version++;const connectionId=transport?.connectionId||connecting?.connectionId;
    clearConnection();
    if(connectionId) await native.disconnect({connectionId});
    tell('已断开连接。');
  }
  async function connect(device) {
    if(connecting||current) return;
    const ticket=++version,connectionId=crypto.randomUUID();
    connecting={...device,connectionId};deviceState=null;scanning=false;render();
    tell(`正在连接 ${device.name}…`);trace('连接开始',null,device.deviceId);
    try {
      await ready;await native.stopScan();
      if(!valid(ticket)) return;
      const result=await native.connect({deviceId:device.deviceId,connectionId});
      if(!valid(ticket)) {await native.disconnect({connectionId});return;}
      transport=new AndroidBleTransport(connectionId,result.properties);
      const candidate=new protocol.Link(null,{transport,onTrace:trace,
        acceptAck:packet=>packet.length===8 && packet[4]===0xfd && packet[5]===1,
        onStatus:report=>{
          if(!valid(ticket)) return;
          deviceState=['run','stop'].includes(report?.WillAiState)?{value:report.WillAiState,time:performance.now()}:null;
          if(sending?.phase==='upload' && report?.WillAiState==='run') {
            sending.cancelled=true;candidate.cancelUpload();
          }
          trace('主机状态',null,JSON.stringify(report).slice(0,500));renderStatus();
          window.dispatchEvent(new CustomEvent('spark-status',{detail:report}));
        },onError:error=>{deviceState=null;renderStatus();failure(error);},
        onProgress:(done,total)=>{
          if(sending?.target===candidate && done===total-1) sending.phase='starting';
          if(sending?.target===candidate) window.showExecutionNotice(`正在发送 ${done}/${total} 包…`);
        }
      });
      link=candidate;
      await candidate.start({watch:false});
      if(!valid(ticket)) {candidate.close();await native.disconnect({connectionId});return;}
      current={...device,connectionId};connecting=null;
      tell('已连接，请将小白切换到遥控模式。');trace('连接就绪');render();
    } catch(error) {
      if(version===ticket) {clearConnection();failure(error);}
      await native.disconnect({connectionId}).catch(()=>{});
    }
  }
  const ready=(async()=>{
    await native.addListener('scanResult',device=>{
      if(!scanning || device.scanId!==scanId) return;
      rows.set(device.deviceId,device);scheduleRender();
    });
    await native.addListener('scanStopped',event=>{
      if(event.scanId!==scanId) return;
      scanning=false;
      if(!connecting&&!current) tell(event.reason==='finished'?(rows.size?'扫描完成，请选择主机。':'未发现主机，可检查电源后重新扫描。'):
        event.reason==='cancelled'?'已停止扫描。':event.reason==='background'?'已进入后台，扫描停止。':event.reason==='bluetoothOff'?'手机蓝牙已关闭。':event.reason);
      render();
    });
    await native.addListener('notification',event=>{
      if(event.connectionId===transport?.connectionId) transport.notification(event.data);
    });
    await native.addListener('disconnected',event=>{
      if(event.connectionId!==(transport?.connectionId||connecting?.connectionId)) return;
      version++;clearConnection();tell(event.reason,true);trace('连接断开',null,event.reason);
    });
    await native.addListener('adapterState',value=>{state=value;render();});
    initialized=true;await refresh();
  })().catch(error=>{failure(new Error('手机蓝牙初始化失败：'+error.message));});
  $('.bt-search').onclick=()=>{if(scanning){version++;stopScan().catch(failure);}else scan();};
  $('#btDisconnect').onclick=()=>disconnect().catch(failure);
  $('#btAccess').onclick=async()=>{
    try {if(state?.permissionsGranted || state?.permissionState==='denied') await native.openSettings({target:'app'});
      else {state=await native.requestAccess();render();if(!state.permissionsGranted) tell('权限未获允许，可在应用设置中授权。',true);}}
    catch(error) {failure(error);}
  };
  $('#btSystemSettings').onclick=()=>native.openSettings({target:'bluetooth'}).catch(failure);
  $('#btLocationSettings').onclick=()=>native.openSettings({target:'location'}).catch(failure);
  $('.bt-copy').onclick=async()=>{
    try {await navigator.clipboard.writeText('Spark Android BLE diagnostics\n'+logs.join('\n'));tell('诊断已复制。');}
    catch {tell('复制失败，可展开诊断并长按选中文字。',true);}
  };
  function route() {
    const show=location.hash==='#bluetooth';page.hidden=!show;document.body.classList.toggle('bluetooth-open',show);
    if(show) {closeParamEditor();document.title='手机蓝牙 · 小白编程';ready.then(refresh).catch(failure);}
    else {
      if(scanning||requesting) {version++;stopScan().catch(failure);}
      if(location.hash==='#editor') {document.title=document.querySelector('.brand-title').textContent+' · 小白编程';updateProgramAnchor();}
    }
  }
  trigger.onclick=()=>{location.hash='bluetooth';};$('.bt-back').onclick=()=>{location.hash='editor';};
  window.addEventListener('hashchange',route);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden) {
      version++;stopScan().catch(()=>{});
      const connectionId=transport?.connectionId||connecting?.connectionId;
      clearConnection();if(connectionId) native.disconnect({connectionId}).catch(()=>{});
    } else ready.then(refresh).catch(failure);
  });
  setInterval(renderStatus,250);
  window.CardBluetooth={
    remoteConnection(){
      if(sending||stopping||!current||!link||link.closed) return null;
      const target=link,id=current.connectionId;
      return {id,send(bytes,guard=()=>true){
        if(((sending||stopping)&&bytes.slice(5,15).some(Boolean))||!window.CardRemoteControl||!current||current.connectionId!==id||target!==link||target.closed)
          return Promise.reject(new Error('遥控连接已断开，请重新连接。'));
        return target.write(bytes,undefined,()=>Boolean(current&&current.connectionId===id&&target===link&&guard()));
      }};
    },
    get connected(){return Boolean(current&&link&&!link.closed);}
  };
  route();render();
})();
