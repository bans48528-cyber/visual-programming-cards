(() => {
  const segmentMap = {1:'bc',2:'abged',3:'abgcd',4:'fgbc',5:'afgcd'};
  const digit = level => [...segmentMap[level]].map(part => `<i class="lamp ${part}"></i>`).join('');
  const gears = [5,4,3,2,1].map(level => {
    const color = level === 5 ? 'red' : level >= 3 ? 'yellow' : 'green';
    return `<button class="lbs-gear ${color}${level === 1 ? ' selected lit' : ''}" data-speed="${level}" type="button" aria-label="${level}档" aria-pressed="${level === 1}">
      <i class="bar lamp" aria-hidden="true"></i><span class="digit" aria-hidden="true">${digit(level)}</span>
    </button>`;
  }).join('');

  const dialog = document.createElement('dialog');
  dialog.className = 'remote-dialog lbs-remote';
  dialog.id = 'lbsRemoteControl';
  dialog.setAttribute('aria-label','LBS2206 遥控');
  dialog.innerHTML = `<nav class="remote-header" aria-label="遥控导航">
    <button class="remote-back" type="button" aria-label="关闭遥控">‹</button>
    <button class="remote-connect" type="button" aria-label="蓝牙未连接"></button>
  </nav>
  <main class="lbs-controller-stage">
    <section id="lbs-controller-prototype" aria-label="LBS2206 方向与五档调速遥控器">
      <div class="controller-shell">
        <div class="direction-column">
          <div id="lbs-dpad-demo" data-active="false">
            <div class="scene" role="group" aria-label="一体式十字方向键">
              <div class="socket" aria-hidden="true"></div>
              <div class="cast-shadow" aria-hidden="true"><div class="cross"></div></div>
              <div class="assembly" aria-hidden="true"><div class="rocker"><div class="cross face"><div class="cross face-inner"><div class="shine"></div>
                <div class="engraved up"><div class="chevron"></div></div><div class="engraved down"><div class="chevron"></div></div>
                <div class="engraved left"><div class="chevron"></div></div><div class="engraved right"><div class="chevron"></div></div><div class="nub"></div>
              </div></div></div></div>
              <div class="hitbox">
                <button class="hit" type="button" data-dir="up" data-lbs-direction="forward" aria-label="前进，松手停止" aria-pressed="false"></button>
                <button class="hit" type="button" data-dir="down" data-lbs-direction="backward" aria-label="后退，松手停止" aria-pressed="false"></button>
                <button class="hit" type="button" data-dir="left" data-lbs-direction="left" aria-label="左转，松手停止" aria-pressed="false"></button>
                <button class="hit" type="button" data-dir="right" data-lbs-direction="right" aria-label="右转，松手停止" aria-pressed="false"></button>
              </div>
            </div>
          </div>
        </div>
        <div class="speed-column" id="lbs-controller-speed">
          <section class="speed-panel" aria-label="五档速度">
            <header><span class="caption">速度</span><output class="readout" aria-live="polite"><strong>1</strong><span>档</span></output></header>
            <div class="slider-area">
              <div class="slider-bed" aria-hidden="true"></div>
              <div class="travel">${gears}<div class="knob" aria-hidden="true"><div class="knob-face"><i></i><i></i><i></i></div></div></div>
              <input class="speed-input" type="range" min="1" max="5" step="1" value="1" aria-label="速度档位，上滑加档，下滑减档" aria-orientation="vertical" aria-valuetext="1档">
            </div>
          </section>
        </div>
        <output class="lbs-remote-status" role="status" aria-live="polite"></output>
      </div>
    </section>
  </main>`;
  document.body.append(dialog);
  CardBindBluetoothButton(dialog.querySelector('.remote-connect'));

  const root = dialog.querySelector('#lbs-controller-prototype');
  const scene = dialog.querySelector('#lbs-dpad-demo .scene');
  const dpad = dialog.querySelector('#lbs-dpad-demo');
  const rocker = dialog.querySelector('.rocker');
  const face = dialog.querySelector('.face-inner');
  const shadow = dialog.querySelector('.cast-shadow');
  const directionButtons = [...dialog.querySelectorAll('.hit[data-lbs-direction]')];
  const speedRoot = dialog.querySelector('#lbs-controller-speed');
  const speedInput = dialog.querySelector('.speed-input');
  const speedButtons = [...dialog.querySelectorAll('[data-speed]')];
  const speedTravel = dialog.querySelector('.travel');
  const speedKnob = dialog.querySelector('.knob');
  const speedReadout = dialog.querySelector('.readout strong');
  const status = dialog.querySelector('.lbs-remote-status');

  for(let z=0;z<13;z++) {
    const layer=document.createElement('div');
    layer.className='cross side';
    layer.style.transform=`translateZ(${z}px)`;
    rocker.prepend(layer);
  }

  const tilts = {
    forward:[14,0,50,85,0,14],backward:[-14,0,50,10,0,-2],
    left:[0,-14,85,30,12,8],right:[0,14,10,30,-10,8]
  };
  let speed=1, committedSpeed=1, speedPosition=1, speedPointer=null, speedOffset=0;
  let direction='stop', directionPointer=null, keyboardDirection=null;
  let generation=0, poll=null, scope=null, opening=0, heldConnection=null;
  let observedConnectionId=null, observedConnectionReady=false;
  let closingStop=null;

  function conn(){return CardModelSession.current.id==='lbs2206'?window.CardBluetooth?.remoteConnection?.():null;}
  const clampSpeed=value=>Math.max(1,Math.min(5,value));

  function drawDirection(){
    const tilt=tilts[direction];
    dpad.dataset.active=String(Boolean(tilt));
    rocker.classList.toggle('held',Boolean(tilt));
    rocker.style.transform=tilt?`rotateX(${tilt[0]}deg) rotateY(${tilt[1]}deg) translateZ(-1px)`:'rotateX(0deg) rotateY(0deg) translateZ(0)';
    face.style.setProperty('--light-x',`${tilt?tilt[2]:32}%`);
    face.style.setProperty('--light-y',`${tilt?tilt[3]:20}%`);
    shadow.style.transform=`translate(${tilt?tilt[4]:1}px,${tilt?tilt[5]:9}px)`;
    directionButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.lbsDirection===direction)));
  }

  function drawSpeed(position=speed){
    speedPosition=clampSpeed(position);
    speed=Math.round(speedPosition);
    speedInput.value=String(speed);
    speedInput.setAttribute('aria-valuetext',`${speed}档`);
    speedReadout.textContent=String(speed);
    speedKnob.style.top=`${(5-speedPosition)/4*100}%`;
    speedButtons.forEach(button=>{
      const level=+button.dataset.speed;
      button.classList.toggle('selected',level===speed);
      button.classList.toggle('lit',level<=speed);
      button.setAttribute('aria-pressed',String(level===speed));
    });
  }

  function drawStatus(connection=conn()){
    const issues=Lbs2206Protocol.profileIssues(Lbs2206Profile);
    status.classList.toggle('is-connected',Boolean(connection));
    status.classList.toggle('is-error',Boolean(issues.length));
    status.textContent=issues.length?'直连参数待确认，请先在设备设置中查看':
      !connection?'尚未连接小车 · 可预览操作':connection.busy?'设备运行中 · 暂不可遥控':'已连接';
  }

  function syncConnection(connection=conn()){
    const connectionId=connection?.id??null;
    if(!observedConnectionReady){observedConnectionReady=true;observedConnectionId=connectionId;return false;}
    if(connectionId===observedConnectionId)return false;
    observedConnectionId=connectionId;
    clearHeldInput(false);
    return true;
  }

  function draw(){
    if(!dialog.open)return;
    const connection=conn();
    syncConnection(connection);
    drawDirection();drawSpeed(speedPosition);drawStatus(connection);
  }

  function send(next){
    const liveConnection=conn();
    const connectionChanged=syncConnection(liveConnection);
    if(connectionChanged&&next!=='stop'){drawStatus(liveConnection);return Promise.resolve();}
    if(next!=='stop'&&liveConnection?.busy){direction='stop';drawDirection();drawStatus(liveConnection);return Promise.resolve();}
    direction=next;
    const ticket=++generation;
    const connection=next==='stop'?(heldConnection||liveConnection):liveConnection;
    if(next!=='stop')heldConnection=connection;
    drawDirection();drawStatus(connection);
    if(!connection)return Promise.resolve();
    return Promise.resolve().then(()=>connection.remote(next,speed,()=>ticket===generation&&(next==='stop'||Boolean(scope?.isCurrent()&&dialog.open))))
      .catch(error=>{if(ticket===generation&&dialog.open){status.textContent=error.message;status.classList.add('is-error');}});
  }
  function changeDirection(next){if(next!==direction)return send(next||'stop');}

  function releaseDirection(sendStop=true){
    const oldPointer=directionPointer;
    directionPointer=null;keyboardDirection=null;
    if(oldPointer!==null&&scene.hasPointerCapture?.(oldPointer))scene.releasePointerCapture(oldPointer);
    const wasMoving=direction!=='stop';direction='stop';drawDirection();
    if(sendStop&&wasMoving)return send('stop');
    if(wasMoving||!sendStop){generation++;heldConnection=null;}
    return Promise.resolve();
  }

  function cancelSpeed(revert=true,notifyDevice=true){
    const oldPointer=speedPointer;
    speedPointer=null;speedRoot.dataset.dragging='false';
    if(oldPointer!==null&&speedInput.hasPointerCapture?.(oldPointer))speedInput.releasePointerCapture(oldPointer);
    const previous=speed;drawSpeed(revert?committedSpeed:speed);committedSpeed=speed;
    if(notifyDevice&&previous!==speed&&direction!=='stop')send(direction);
  }
  function clearHeldInput(sendStop=false){releaseDirection(sendStop);cancelSpeed(true,false);}

  function directionAt(clientX,clientY,previous='stop'){
    // Continuous sectors match the shared controller: only the center and outside stop.
    const rect=scene.getBoundingClientRect(),radius=Math.min(rect.width,rect.height)/2;
    if(!radius)return 'stop';
    const x=clientX-rect.left-rect.width/2,y=clientY-rect.top-rect.height/2,distance=Math.hypot(x,y);
    const deadZone=Math.max(8,Math.min(15,radius*.12));
    if(distance<=deadZone||distance>radius)return 'stop';
    const horizontal=x<0?'left':'right',vertical=y<0?'forward':'backward';
    const diagonalSlop=Math.max(3,Math.min(6,radius*.05));
    if(Math.abs(Math.abs(x)-Math.abs(y))<=diagonalSlop&&(previous===horizontal||previous===vertical))return previous;
    return Math.abs(x)>Math.abs(y)?horizontal:vertical;
  }
  function moveDirection(event){if(event.pointerId===directionPointer)changeDirection(directionAt(event.clientX,event.clientY,direction));}
  scene.addEventListener('pointerdown',event=>{
    if(event.button>0||directionPointer!==null)return;
    const connection=conn();
    syncConnection(connection);
    if(connection?.busy)return;
    event.preventDefault();directionPointer=event.pointerId;keyboardDirection=null;scene.setPointerCapture?.(event.pointerId);moveDirection(event);
  });
  scene.addEventListener('pointermove',moveDirection);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])scene.addEventListener(type,event=>{if(event.pointerId===directionPointer)releaseDirection(true);});
  scene.addEventListener('contextmenu',event=>event.preventDefault());


  function speedAt(clientY){const rect=speedTravel.getBoundingClientRect();return clampSpeed(5-((clientY-speedOffset-rect.top)/rect.height)*4);}
  function changeSpeedPosition(position,sendChange=true){
    if(sendChange&&syncConnection(conn()))return;
    const previous=speed;drawSpeed(position);if(sendChange&&speed!==previous&&direction!=='stop')send(direction);
  }
  speedInput.addEventListener('pointerdown',event=>{
    if(event.button>0||speedPointer!==null)return;
    syncConnection(conn());
    event.preventDefault();speedInput.focus({preventScroll:true});committedSpeed=speed;speedPointer=event.pointerId;speedInput.setPointerCapture?.(event.pointerId);
    const knobRect=speedKnob.getBoundingClientRect();speedOffset=event.clientY>=knobRect.top&&event.clientY<=knobRect.bottom?event.clientY-(knobRect.top+knobRect.height/2):0;
    speedRoot.dataset.dragging='true';changeSpeedPosition(speedAt(event.clientY));
  });
  speedInput.addEventListener('pointermove',event=>{if(event.pointerId===speedPointer)changeSpeedPosition(speedAt(event.clientY));});
  speedInput.addEventListener('pointerup',event=>{if(event.pointerId===speedPointer){changeSpeedPosition(speedAt(event.clientY));committedSpeed=speed;cancelSpeed(false,false);}});
  speedInput.addEventListener('pointercancel',()=>cancelSpeed(true,true));
  speedInput.addEventListener('lostpointercapture',()=>{if(speedPointer!==null)cancelSpeed(true,true);});
  speedInput.addEventListener('keydown',event=>{
    const delta={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1};
    if(!(event.key in delta)&&event.key!=='Home'&&event.key!=='End')return;
    event.preventDefault();event.stopPropagation();cancelSpeed(true,false);
    const value=event.key==='Home'?1:event.key==='End'?5:speed+delta[event.key];
    changeSpeedPosition(Math.round(clampSpeed(value)));committedSpeed=speed;
  });
  speedButtons.forEach(button=>button.addEventListener('click',()=>{syncConnection(conn());cancelSpeed(false,false);changeSpeedPosition(+button.dataset.speed);committedSpeed=speed;}));

  const keyboardDirections={ArrowUp:'forward',ArrowDown:'backward',ArrowLeft:'left',ArrowRight:'right'};
  dialog.addEventListener('keydown',event=>{
    const focused=event.target.closest?.('[data-lbs-direction]');
    const next=keyboardDirections[event.code]||((event.code==='Space'||event.code==='Enter')&&focused?.dataset.lbsDirection);
    if(!next||keyboardDirection||event.repeat||event.target.closest('.remote-connect,.remote-back,#lbs-controller-speed'))return;
    const connection=conn();
    syncConnection(connection);
    if(connection?.busy)return;
    event.preventDefault();keyboardDirection=event.code;changeDirection(next);
  });
  dialog.addEventListener('keyup',event=>{if(event.code===keyboardDirection){event.preventDefault();releaseDirection(true);}});

  let returnHash='#home';
  function stopForClose(){
    if(closingStop)return closingStop;
    cancelSpeed(true,false);
    closingStop=releaseDirection(true);
    return closingStop;
  }
  CardPageTransition.bindDialog(dialog,{beforeClose:stopForClose});
  function close(){
    opening++;clearInterval(poll);
    const result=stopForClose();
    if(dialog.open)dialog.close();
    observedConnectionReady=false;heldConnection=null;return result;
  }
  async function open(options={}){
    if(dialog.open||CardModelSession.current.id!=='lbs2206'||CardModelSession.switching)return;
    returnHash=options.returnHash||(location.hash==='#editor'?'#editor':'#home');
    const ticket=++opening;scope=CardModelSession.capture();await CardProgram.stop();
    if(ticket!==opening||!scope.isCurrent()||document.hidden||(options.isCurrent&&!options.isCurrent()))return;
    observedConnectionReady=false;closingStop=null;CardShowRemoteDialog(dialog,options,returnHash);draw();clearInterval(poll);poll=setInterval(draw,200);
    CardBluetooth.ensureConnected?.().catch(error=>{if(ticket===opening&&dialog.open){status.textContent=error.message;status.classList.add('is-error');}});
  }
  dialog.querySelector('.remote-back').onclick=close;
  dialog.querySelector('.remote-connect').onclick=()=>window.CardOpenBluetoothFromRemote(returnHash,close,open);
  dialog.addEventListener('close',()=>{if(dialog.open)return;clearInterval(poll);cancelSpeed(true,false);observedConnectionReady=false;Promise.resolve(closingStop).finally(()=>{if(!dialog.open)closingStop=null;});});
  window.addEventListener('blur',()=>{if(dialog.open)clearHeldInput(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open)close();});

  const settings=document.createElement('dialog');settings.className='lbs-settings-dialog';
  settings.innerHTML=`<header><div><h2>LBS2206 设备设置</h2><p>连接验证与设备信息</p></div><button type="button" class="lbs-settings-close" aria-label="关闭设备设置">✕</button></header><p class="lbs-validation"></p><button class="bt-button primary lbs-settings-connect" type="button">蓝牙连接</button><section><h3>读取设备信息</h3><div class="lbs-read-buttons">${Object.entries({version:'固件版本',voltage:'电池电压',mac:'蓝牙地址',straight:'直行校准值',turn:'转向校准值'}).map(([key,text])=>`<button class="bt-button" data-read="${key}" type="button">${text}</button>`).join('')}</div><output class="lbs-setting-result" role="status">连接后可读取。</output></section><section><h3>校准</h3><p>直行和转向参数写入、恢复默认、程序间隔及步进速度设置尚未开放。参数范围和实物效果确认后，在这里接入。</p></section>`;
  document.body.append(settings);let settingsTicket=0,readTimer=null,expected=null;
  const result=settings.querySelector('.lbs-setting-result');
  function settingsDraw(){const issues=Lbs2206Protocol.profileIssues(Lbs2206Profile);settings.querySelector('.lbs-validation').textContent=issues.length?'待确认：'+issues.join('；'):'手机执行编程逻辑，通过遥控指令控制小车；不上传固件程序。';settings.querySelectorAll('[data-read]').forEach(b=>b.disabled=!conn()||conn().busy||Boolean(expected));}
  function showSettings(){if(CardModelSession.current.id!=='lbs2206')return;settingsTicket++;expected=null;settingsDraw();result.textContent=conn()?'选择要读取的信息。':'连接后可读取。';settings.showModal();}
  function dismissSettings(){settingsTicket++;clearTimeout(readTimer);expected=null;if(settings.open)settings.close();}
  settings.querySelector('.lbs-settings-close').onclick=dismissSettings;settings.addEventListener('close',()=>{settingsTicket++;clearTimeout(readTimer);expected=null;});
  settings.querySelector('.lbs-settings-connect').onclick=()=>{dismissSettings();location.hash='bluetooth';};
  settings.querySelectorAll('[data-read]').forEach(button=>button.onclick=async()=>{
    const ticket=settingsTicket,modelScope=CardModelSession.capture(),connection=conn();if(!connection||expected)return;
    const prefixes={version:'Ver=',voltage:'Voltage=',mac:'MAC=',straight:'STPL=',turn:'STPR='};expected=prefixes[button.dataset.read];result.textContent='正在读取…';settingsDraw();
    readTimer=setTimeout(()=>{if(ticket===settingsTicket&&modelScope.isCurrent()){expected=null;result.textContent='未收到设备回复，请重试；未推断读取结果。';settingsDraw();}},4000);
    try{await connection.readSetting(button.dataset.read);}catch(error){if(ticket===settingsTicket&&modelScope.isCurrent()){clearTimeout(readTimer);expected=null;result.textContent=error.message;settingsDraw();}}
  });
  window.addEventListener('lbs-setting-reply',event=>{if(!settings.open||CardModelSession.current.id!=='lbs2206'||!expected||!event.detail.startsWith(expected))return;clearTimeout(readTimer);expected=null;result.textContent=event.detail;settingsDraw();});
  window.Lbs2206UI={open,close,settings:showSettings,dismissSettings};
})();
