(() => {
  const icon='<svg viewBox="0 0 32 24" aria-hidden="true"><path d="M9 4h14c5 0 8 15 4 17-2 1-5-4-7-4h-8c-2 0-5 5-7 4C1 19 4 4 9 4Z"/><path d="M10 8v7m-3-3.5h6M23 9v1m-4 3v1"/></svg>';
  const entry=document.createElement('button');entry.className='btn remote-entry';entry.type='button';entry.title='遥控';entry.setAttribute('aria-label','遥控');entry.innerHTML=icon;
  document.querySelector('.toolbar').prepend(entry);
  const dialog=document.createElement('dialog');dialog.className='remote-dialog';dialog.id='remoteControl';
  dialog.innerHTML=`<nav class="remote-header" aria-label="遥控导航"><button type="button" class="remote-back" aria-label="关闭遥控">‹</button><button type="button" class="remote-connect" aria-label="蓝牙未连接"></button></nav>
    <div class="remote-shoulders"><button data-remote-key="L" aria-label="速度加一档">速度 +</button><div class="remote-connection" role="status">未连接</div><button data-remote-key="R" aria-label="速度减一档">速度 −</button></div>
    <main class="remote-controls"><div class="remote-dpad" aria-label="方向键"><button data-remote-key="up" aria-label="向上">▲</button><button data-remote-key="left" aria-label="向左">◀</button><span class="remote-dpad-center"></span><button data-remote-key="right" aria-label="向右">▶</button><button data-remote-key="down" aria-label="向下">▼</button></div>
    <div class="remote-actions" aria-label="功能键"><button data-remote-key="Y" aria-label="左电机正转">左正</button><button data-remote-key="A" aria-label="左电机反转">左反</button><button data-remote-key="X" aria-label="右电机正转">右正</button><button data-remote-key="B" aria-label="右电机反转">右反</button></div></main>
    <footer>主机需处于遥控模式<span>左电机 Y/A · 右电机 X/B</span></footer>`;
  document.body.append(dialog);
  CardBindBluetoothButton(dialog.querySelector('.remote-connect'));
  CardPageTransition.bindDialog(dialog,{beforeClose:()=>release()});
  const buttons=[...dialog.querySelectorAll('[data-remote-key]')];
  const status=dialog.querySelector('.remote-connection');
  const skin=createXiaobaiRemoteSkin(dialog,buttons,status);
  let session=null,connectionId=null,poll=null,failedId=null,lastStop=Promise.resolve(),opening=false,activating=null;
  let generation=0,failureMessage='';
  const pointers=new Map(),keyboard=new Map(),directionPointers=new Set();
  const allowLocalPress=()=>window.CardModelSession?.current.remote?.layout==='physical-ten-key'&&!window.CardModelSession.switching;
  const canPress=()=>dialog.open&&(Boolean(session&&!session.closed)||allowLocalPress());
  function state() {
    const all=[...pointers.values(),...keyboard.values()];
    for(const pair of (window.CardModelSession?.current.remote?.pairs||[['Y','A'],['X','B'],['L','R']])) {const selected=all.filter(k=>pair.includes(k)).slice(-1)[0];for(let i=all.length-1;i>=0;i--) if(pair.includes(all[i])&&all[i]!==selected) all.splice(i,1);}
    const directions=all.filter(k=>CardRemoteControl.keys.indexOf(k)<4);
    return [...new Set([...all.filter(k=>CardRemoteControl.keys.indexOf(k)>=4),...directions.slice(-1)])];
  }
  function changed() {
    const pressed=state();
    buttons.forEach(b=>{const down=pressed.includes(b.dataset.remoteKey);b.classList.toggle('is-pressed',down);b.setAttribute('aria-pressed',String(down));});
    skin.update(pressed);
    session?.update(pressed);
  }
  function release() {directionPointers.clear();pointers.clear();keyboard.clear();changed();}
  function stop() {release();const old=session;session=null;connectionId=null;if(old) lastStop=old.stop();return lastStop;}
  function refresh() {
    if(!dialog.open) return;
    const connection=window.CardBluetooth?.remoteConnection?.();
    if(connectionId!==(connection?.id??null)) {
      if(session||connectionId!==null)stop();
      if(connection && failedId!==connection.id && !activating) {
        const ticket=generation;
        const task=connection.enterRemote().then(()=>{
          if(ticket!==generation||!dialog.open||window.CardBluetooth?.remoteConnection?.()?.id!==connection.id)return;
          connectionId=connection.id;failureMessage='';
          // Offline presses never carry over when a real control session starts.
          release();
          const candidate=new CardRemoteControl.Session(connection.send,error=>{
          if(session!==candidate) return;
          failedId=connection.id;release();session=null;connectionId=null;
          failureMessage=error.message||'发送失败，请重新连接';refresh();
          },window.CardModelSession?.current.remote?.encode);
          session=candidate;session.start();refresh();
        }).catch(error=>{if(ticket!==generation||!dialog.open||window.CardBluetooth?.remoteConnection?.()?.id!==connection.id)return;failedId=connection.id;failureMessage=error.message||'无法进入遥控模式';refresh();}).finally(()=>{if(activating===task)activating=null;});
        activating=task;
      }
    }
    const ready=Boolean(session&&!session.closed);
    buttons.forEach(b=>b.disabled=!ready&&!allowLocalPress());
    status.textContent=ready?(window.CardModelSession?.current.name||'小白')+'已连接':failureMessage||'未连接遥控';status.classList.toggle('is-connected',ready);status.classList.toggle('is-error',!ready&&Boolean(failureMessage));
  }
  buttons.forEach(button=>{
    const key=button.dataset.remoteKey;
    button.addEventListener('pointerdown',event=>{
      if(skin.enabled&&skin.directionSurface.contains(button))return;
      if(button.disabled||event.button>0||!canPress()) return;
      event.preventDefault();pointers.set(event.pointerId,key);button.setPointerCapture(event.pointerId);changed();
      if(session&&!session.closed&&window.CardModelSession?.current.remote?.shoulderPulse!==false&&(key==='L'||key==='R')) setTimeout(()=>{if(pointers.get(event.pointerId)===key){pointers.delete(event.pointerId);changed();}},100);
    });
    const up=event=>{if(pointers.delete(event.pointerId)) changed();};
    button.addEventListener('pointerup',up);button.addEventListener('pointercancel',up);button.addEventListener('lostpointercapture',up);
    button.addEventListener('contextmenu',event=>event.preventDefault());
  });
  function moveDirection(event){
    if(!directionPointers.has(event.pointerId))return;
    const previous=pointers.get(event.pointerId)||'';
    const next=canPress()?skin.directionAt(event.clientX,event.clientY,previous):'';
    if(next===previous)return;
    pointers.delete(event.pointerId);
    if(next)pointers.set(event.pointerId,next);
    changed();
  }
  // One capture for the whole gesture: a finger may leave, return, or change direction.
  skin.directionSurface.addEventListener('pointerdown',event=>{
    if(!skin.enabled||event.button>0||!canPress())return;
    event.preventDefault();directionPointers.add(event.pointerId);
    skin.directionSurface.setPointerCapture(event.pointerId);moveDirection(event);
  });
  skin.directionSurface.addEventListener('pointermove',moveDirection);
  const endDirection=event=>{
    if(!directionPointers.delete(event.pointerId))return;
    if(pointers.delete(event.pointerId))changed();
  };
  for(const type of ['pointerup','pointercancel','lostpointercapture'])skin.directionSurface.addEventListener(type,endDirection);
  skin.directionSurface.addEventListener('contextmenu',event=>event.preventDefault());
  const keyMap={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',KeyA:'A',KeyB:'B',KeyX:'X',KeyY:'Y',KeyL:'L',KeyR:'R'};
  dialog.addEventListener('keydown',event=>{
    if(!keyMap[event.code]||!canPress()||event.repeat||event.target.closest('.remote-connect,.remote-back')) return;
    event.preventDefault();keyboard.set(event.code,keyMap[event.code]);changed();
    if(session&&!session.closed&&window.CardModelSession?.current.remote?.shoulderPulse!==false&&['L','R'].includes(keyMap[event.code])) setTimeout(()=>{keyboard.delete(event.code);changed();},100);
  });
  dialog.addEventListener('keyup',event=>{if(keyboard.delete(event.code)){event.preventDefault();changed();}});
  dialog.addEventListener('close',()=>{if(dialog.open)return;clearInterval(poll);stop();if(location.hash==='#editor'&&!window.CardModelSession?.switching)window.CardBluetooth?.enterProgram?.().catch(error=>window.showExecutionNotice?.(error.message));});
  dialog.querySelector('.remote-back').onclick=()=>dialog.close();
  dialog.querySelector('.remote-connect').onclick=()=>{
    window.CardOpenBluetoothFromRemote(returnHash,close,open);
  };
  window.addEventListener('blur',release);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open) dialog.close();});
  let returnHash='#home';
  async function open(options={}) {
    if(dialog.open||opening||window.CardModelSession?.switching||window.CardModelSession?.selected===false) return;
    const scope=window.CardModelSession?.capture();
    if(scope&&!scope.model.features.some(feature=>feature.id==='remote'))return;
    const config=scope?.model.remote;
    const physicalLayout=config?.layout==='physical-ten-key';
    skin.activate(physicalLayout,scope?.model);
    const labels=config?.labels||{Y:'左正',A:'左反',X:'右正',B:'右反',L:'速度 +',R:'速度 −'};
    buttons.forEach(button=>{const label=labels[button.dataset.remoteKey];if(label){if(!physicalLayout)button.textContent=label;button.setAttribute('aria-label',label);}});
    dialog.querySelector('footer').textContent=config?.footer||'主机需处于遥控模式 · 左电机 Y/A · 右电机 X/B';
    dialog.setAttribute('aria-label',`${scope?.model.name||'小白'}遥控`);
    returnHash=options.returnHash||(location.hash==='#editor'?'#editor':'#home');
    const ticket=++generation;
    opening=true;
    try {await window.CardProgram?.stop("已切换到手动遥控");await lastStop;} catch(error) {if(ticket===generation){window.showExecutionNotice(error.message);opening=false;}return;}
    if(ticket!==generation)return;
    opening=false;if(document.hidden||(scope&&!scope.isCurrent())||(options.isCurrent&&!options.isCurrent())) return;
    cancelDrag();closeParamEditor();failedId=null;failureMessage='';CardShowRemoteDialog(dialog,options,returnHash);window.CardBluetooth?.enterRemote?.().catch(error=>{if(ticket===generation)window.showExecutionNotice?.(error.message);});refresh();
    window.CardBluetooth?.ensureConnected?.().catch(error=>{if(ticket===generation)window.showExecutionNotice?.(error.message);});
    poll=setInterval(refresh,200);
  }
  entry.onclick=()=>window.CardModelSession?.current.remote?.open();
  function close() {generation++;opening=false;activating=null;if(dialog.open)dialog.close();clearInterval(poll);return stop();}
  window.CardRemote={open,close,release,reset:()=>{const pending=close();lastStop=Promise.resolve();failedId=null;return pending;}};
})();
