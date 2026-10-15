window.CardBluetoothBack=()=>{const target=window.CardBluetoothReturnHash||'#editor';window.CardBluetoothReturnHash=null;location.hash=target;};
(() => {
  const icon='<svg viewBox="0 0 32 24" aria-hidden="true"><path d="M9 4h14c5 0 8 15 4 17-2 1-5-4-7-4h-8c-2 0-5 5-7 4C1 19 4 4 9 4Z"/><path d="M10 8v7m-3-3.5h6M23 9v1m-4 3v1"/></svg>';
  const entry=document.createElement('button');entry.className='btn remote-entry';entry.type='button';entry.title='遥控';entry.setAttribute('aria-label','遥控');entry.innerHTML=icon;
  document.querySelector('.toolbar').prepend(entry);
  const dialog=document.createElement('dialog');dialog.className='remote-dialog';dialog.id='remoteControl';
  dialog.innerHTML=`<header class="remote-header"><button type="button" class="remote-back" aria-label="关闭遥控">‹</button><div><h1>遥控</h1><p>按住操作 · 松手释放</p></div><button type="button" class="remote-connect">连接主机</button></header>
    <div class="remote-shoulders"><button data-remote-key="L" aria-label="速度加一档">速度 +</button><div class="remote-connection" role="status">未连接</div><button data-remote-key="R" aria-label="速度减一档">速度 −</button></div>
    <main class="remote-controls"><div class="remote-dpad" aria-label="方向键"><button data-remote-key="up" aria-label="向上">▲</button><button data-remote-key="left" aria-label="向左">◀</button><span class="remote-dpad-center"></span><button data-remote-key="right" aria-label="向右">▶</button><button data-remote-key="down" aria-label="向下">▼</button></div>
    <div class="remote-middle">${icon}<p class="remote-message" role="status">连接小白后即可操作</p><button type="button" class="remote-release">释放全部按键</button></div>
    <div class="remote-actions" aria-label="功能键"><button data-remote-key="Y" aria-label="左电机正转">左正</button><button data-remote-key="A" aria-label="左电机反转">左反</button><button data-remote-key="X" aria-label="右电机正转">右正</button><button data-remote-key="B" aria-label="右电机反转">右反</button></div></main>
    <footer>主机需处于遥控模式<span>左电机 Y/A · 右电机 X/B</span></footer>`;
  document.body.append(dialog);
  const buttons=[...dialog.querySelectorAll('[data-remote-key]')];
  const message=dialog.querySelector('.remote-message'),status=dialog.querySelector('.remote-connection');
  let session=null,connectionId=null,poll=null,failedId=null,lastStop=Promise.resolve(),opening=false,activating=null;
  let generation=0;
  const pointers=new Map(),keyboard=new Map();
  function state() {
    const all=[...pointers.values(),...keyboard.values()];
    for(const pair of (window.CardModelSession?.current.remote?.pairs||[['Y','A'],['X','B'],['L','R']])) {const selected=all.filter(k=>pair.includes(k)).slice(-1)[0];for(let i=all.length-1;i>=0;i--) if(pair.includes(all[i])&&all[i]!==selected) all.splice(i,1);}
    const directions=all.filter(k=>CardRemoteControl.keys.indexOf(k)<4);
    return [...new Set([...all.filter(k=>CardRemoteControl.keys.indexOf(k)>=4),...directions.slice(-1)])];
  }
  function changed() {
    const pressed=state();
    buttons.forEach(b=>{const down=pressed.includes(b.dataset.remoteKey);b.classList.toggle('is-pressed',down);b.setAttribute('aria-pressed',String(down));});
    session?.update(pressed);
  }
  function release() {pointers.clear();keyboard.clear();changed();}
  function stop() {release();const old=session;session=null;connectionId=null;if(old) lastStop=old.stop();return lastStop;}
  function refresh() {
    if(!dialog.open) return;
    const connection=window.CardBluetooth?.remoteConnection?.();
    if(connectionId!==connection?.id) {
      stop();
      if(connection && failedId!==connection.id && !activating) {
        const ticket=generation;
        const task=connection.enterRemote().then(()=>{
          if(ticket!==generation||!dialog.open||window.CardBluetooth?.remoteConnection?.()?.id!==connection.id)return;
          connectionId=connection.id;
          const candidate=new CardRemoteControl.Session(connection.send,error=>{
          if(session!==candidate) return;
          failedId=connection.id;release();session=null;connectionId=null;
          message.textContent=error.message||'发送失败，请重新连接';refresh();
          },window.CardModelSession?.current.remote?.encode);
          session=candidate;session.start();refresh();
        }).catch(error=>{if(ticket!==generation||!dialog.open||window.CardBluetooth?.remoteConnection?.()?.id!==connection.id)return;failedId=connection.id;message.textContent=error.message||'无法进入遥控模式';}).finally(()=>{if(activating===task)activating=null;});
        activating=task;
      }
    }
    const ready=Boolean(session&&!session.closed);
    buttons.forEach(b=>b.disabled=!ready);
    status.textContent=ready?(window.CardModelSession?.current.name||'小白')+'已连接':'未连接遥控';status.classList.toggle('is-connected',ready);
    dialog.querySelector('.remote-connect').textContent=ready?'蓝牙连接':'连接主机';
    if(ready) message.textContent='支持同时按住多个按键';
    else if(!failedId) message.textContent=window.CardPlatform?.isAndroid?`连接${window.CardModelSession?.current.name||'小白'}后即可操作`:'请在安卓应用中连接主机';
  }
  buttons.forEach(button=>{
    const key=button.dataset.remoteKey;
    button.addEventListener('pointerdown',event=>{
      if(button.disabled||event.button>0||!session) return;
      event.preventDefault();pointers.set(event.pointerId,key);button.setPointerCapture(event.pointerId);changed();
      if(window.CardModelSession?.current.remote?.shoulderPulse!==false&&(key==='L'||key==='R')) setTimeout(()=>{if(pointers.get(event.pointerId)===key){pointers.delete(event.pointerId);changed();}},100);
    });
    const up=event=>{if(pointers.delete(event.pointerId)) changed();};
    button.addEventListener('pointerup',up);button.addEventListener('pointercancel',up);button.addEventListener('lostpointercapture',up);
    button.addEventListener('contextmenu',event=>event.preventDefault());
  });
  const keyMap={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',KeyA:'A',KeyB:'B',KeyX:'X',KeyY:'Y',KeyL:'L',KeyR:'R'};
  dialog.addEventListener('keydown',event=>{
    if(!keyMap[event.code]||!session||event.repeat||event.target.closest('.remote-connect,.remote-back,.remote-release')) return;
    event.preventDefault();keyboard.set(event.code,keyMap[event.code]);changed();
    if(window.CardModelSession?.current.remote?.shoulderPulse!==false&&['L','R'].includes(keyMap[event.code])) setTimeout(()=>{keyboard.delete(event.code);changed();},100);
  });
  dialog.addEventListener('keyup',event=>{if(keyboard.delete(event.code)){event.preventDefault();changed();}});
  dialog.addEventListener('close',()=>{if(dialog.open)return;clearInterval(poll);stop();if(location.hash==='#editor'&&!window.CardModelSession?.switching)window.CardBluetooth?.enterProgram?.().catch(error=>window.showExecutionNotice?.(error.message));});
  dialog.querySelector('.remote-back').onclick=()=>dialog.close();
  dialog.querySelector('.remote-release').onclick=release;
  dialog.querySelector('.remote-connect').onclick=()=>{
    if(window.CardPlatform?.isAndroid) window.CardOpenBluetoothFromRemote(returnHash,close);
    else window.showExecutionNotice?.('请在安卓应用中使用手机蓝牙遥控。');
  };
  window.addEventListener('blur',release);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open) dialog.close();});
  let returnHash='#home';
  async function open() {
    if(dialog.open||opening||window.CardModelSession?.switching||window.CardModelSession?.selected===false) return;
    const scope=window.CardModelSession?.capture();
    if(scope&&!scope.model.features.some(feature=>feature.id==='remote'))return;
    const config=scope?.model.remote;
    const labels=config?.labels||{Y:'左正',A:'左反',X:'右正',B:'右反',L:'速度 +',R:'速度 −'};
    buttons.forEach(button=>{const label=labels[button.dataset.remoteKey];if(label){button.textContent=label;button.setAttribute('aria-label',label);}});
    dialog.querySelector('footer').textContent=config?.footer||'主机需处于遥控模式 · 左电机 Y/A · 右电机 X/B';
    dialog.querySelector('.remote-header p').textContent=config?.hint||'按住操作 · 松手释放';
    returnHash=location.hash==='#editor'?'#editor':'#home';
    const ticket=++generation;
    opening=true;
    try {await window.CardProgram?.stop("已切换到手动遥控");await lastStop;} catch(error) {if(ticket===generation){window.showExecutionNotice(error.message);opening=false;}return;}
    if(ticket!==generation)return;
    opening=false;if(document.hidden||(scope&&!scope.isCurrent())) return;
    cancelDrag();closeParamEditor();failedId=null;dialog.showModal();window.CardBluetooth?.enterRemote?.().catch(error=>{if(ticket===generation)window.showExecutionNotice?.(error.message);});refresh();
    window.CardBluetooth?.ensureConnected?.().catch(error=>{if(ticket===generation)window.showExecutionNotice?.(error.message);});
    poll=setInterval(refresh,200);
  }
  entry.onclick=()=>window.CardModelSession?.current.remote?.open();
  function close() {generation++;opening=false;activating=null;if(dialog.open)dialog.close();clearInterval(poll);return stop();}
  window.CardRemote={open,close,release,reset:()=>{const pending=close();lastStop=Promise.resolve();failedId=null;return pending;}};
})();
