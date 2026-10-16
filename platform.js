// Capacitor injects its bridge before these shared scripts run. Desktop stays unchanged.
(() => {
  const isAndroid = window.Capacitor?.getPlatform() === 'android';
  window.CardPlatform = Object.freeze({isAndroid, hardwareAvailable: !isAndroid});
  // Remote entries share the editor's icon and transport state, across all models.
  const bluetoothSource=document.getElementById('bluetoothBtn'),bluetoothButtons=new Set();
  function syncBluetoothButton(button){
    for(const state of ['is-connected','is-connecting'])button.classList.toggle(state,bluetoothSource.classList.contains(state));
    const label=bluetoothSource.getAttribute('aria-label')||bluetoothSource.title||'蓝牙未连接';
    button.title=label;button.setAttribute('aria-label',label);
  }
  window.CardBindBluetoothButton=button=>{
    button.classList.add('bluetooth-button');
    button.replaceChildren(bluetoothSource.querySelector('.bluetooth-icon').cloneNode(true));
    bluetoothButtons.add(button);syncBluetoothButton(button);
  };
  new MutationObserver(()=>bluetoothButtons.forEach(syncBluetoothButton)).observe(bluetoothSource,{attributes:true,attributeFilter:['class','title','aria-label']});
  let remoteReturn=null,navigationVersion=0;
  function routeBluetooth(){window.dispatchEvent(new Event('card-bluetooth-route'));}
  window.CardOpenBluetooth=(returnHash='#editor')=>{
    remoteReturn=null;navigationVersion++;
    window.CardBluetoothReturnHash=returnHash;
    location.hash='bluetooth';routeBluetooth();
    document.querySelectorAll('.bt-back').forEach(button=>button.setAttribute('aria-label',returnHash==='#home'?'返回主页':'返回编程'));
  };
  // Remember the remote page separately from the home/editor underneath it.
  window.CardOpenBluetoothFromRemote=(returnHash,close,reopen)=>{
    window.CardOpenBluetooth(returnHash);
    const entry={returnHash,reopen,scope:window.CardModelSession?.capture(),version:navigationVersion,returning:false};
    remoteReturn=entry;
    document.querySelectorAll('.bt-back').forEach(button=>button.setAttribute('aria-label','返回遥控'));
    entry.stopped=Promise.resolve(close()).catch(error=>window.showExecutionNotice?.(error.message));
  };
  window.CardBluetoothBack=async()=>{
    if(location.hash!=='#bluetooth')return;
    const entry=remoteReturn;
    if(!entry||!entry.scope?.isCurrent()){
      remoteReturn=null;navigationVersion++;
      const target=window.CardBluetoothReturnHash||'#editor';window.CardBluetoothReturnHash=null;
      location.hash=target;routeBluetooth();return;
    }
    if(entry.returning)return;
    entry.returning=true;
    const isCurrent=()=>remoteReturn===entry&&entry.version===navigationVersion&&entry.scope.isCurrent()&&location.hash==='#bluetooth'&&!document.hidden;
    try{
      await entry.stopped;
      if(isCurrent())await entry.reopen({returnHash:entry.returnHash,fromBluetooth:true,isCurrent});
    }catch(error){window.showExecutionNotice?.(error.message);}
    finally{entry.returning=false;}
  };
  window.CardShowRemoteDialog=(dialog,options,returnHash)=>{
    if(!options.fromBluetooth){dialog.showModal();return;}
    // Show the restored remote before hiding Bluetooth, so home never flashes.
    HTMLDialogElement.prototype.showModal.call(dialog);
    remoteReturn=null;window.CardBluetoothReturnHash=null;
    location.hash=returnHash;routeBluetooth();
  };
  if (!isAndroid) return;
  document.documentElement.classList.add('android-app');

  function save() {
    // Do not overwrite an active project while its home thumbnail is being viewed.
    if (!document.body.classList.contains('home-open')) {
      if (window.CardHome?.autosave) window.CardHome.autosave();
      else window.CardHome?.save();
    }
  }
  function suspend() {
    window.CardProgram?.stop("应用进入后台，程序停止").catch(()=>{});
    (window.CardModelSession ? window.CardModelSession.current.remote?.close?.() : window.CardRemote?.close());
    cancelDrag();
    finishParameters();
    save();
  }
  function finishParameters() {
    // Only confirmed numbers are saved; unfinished keypad drafts are discarded.
    if (document.activeElement?.closest('#paramEditor')) document.activeElement.blur();
    if (matrixPaintState) endMatrixPaint({pointerId: matrixPaintState.pointerId});
    closeParamEditor();
  }
  async function back(app) {
    if(window.CardBuildings?.back())return;
    const dialog = document.querySelector('dialog[open]');
    if (dialog) {
      if(dialog.classList.contains('model-picker')&&(!window.CardModelSession?.selected||window.CardModelSession?.switching))return;
      dialog.close(); return;
    }
    if (closeNumberKeypad()) return;
    if (!document.getElementById('paramEditor').hidden) { finishParameters(); return; }
    cancelDrag();
    const menu = document.querySelector('.home-menu[open]');
    if (menu) { menu.open = false; return; }
    if (location.hash === '#bluetooth') { window.CardBluetoothBack(); return; }
    if (location.hash === '#editor') {
      document.getElementById('homeBtn').click();
      return;
    }
    await app.minimizeApp();
  }
  // Save each completed edit, including undo/redo, before Android can kill the process.
  document.addEventListener('card-workspace-changed', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
  window.addEventListener('pagehide', save);
  // Returning to the launcher keeps the last file open for a moment only.
  // After that the app rests on the home screen, so a later launch starts there.
  let homeTimer = null;
  const restOnHome = () => {
    // If the user already returned, keep their file open; rest only in background.
    if (!document.hidden || location.hash !== '#editor') return;
    document.getElementById('homeBtn').click();
  };
  const scheduleRestOnHome = () => {
    clearTimeout(homeTimer);
    homeTimer = setTimeout(restOnHome, 2500);
  };
  const cancelRestOnHome = () => clearTimeout(homeTimer);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) scheduleRestOnHome(); else cancelRestOnHome();
  });
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const app = window.Capacitor.registerPlugin('App');
      await app.addListener('backButton', () => { back(app).catch(console.error); });
      await app.addListener('appStateChange', ({isActive}) => { if (!isActive) suspend(); });
      await app.addListener('pause', suspend);
    } catch (error) {
      console.error('Android lifecycle setup failed', error);
      window.showExecutionNotice?.('系统返回键初始化失败，请使用界面上的返回按钮。');
    }
  });
})();
