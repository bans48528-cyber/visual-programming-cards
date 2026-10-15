(() => {
  const dialog=document.createElement('dialog');dialog.className='remote-dialog lbs-remote';dialog.id='lbsRemoteControl';
  dialog.innerHTML=`<header class="remote-header"><button class="remote-back" type="button" aria-label="关闭遥控">‹</button><div><h1>LBS2206 遥控</h1><p>按住方向 · 松手停止</p></div><button class="remote-connect" type="button">蓝牙连接</button></header><div class="lbs-speed" aria-label="五档速度"><span>速度</span>${[1,2,3,4,5].map(n=>`<button data-speed="${n}" type="button" aria-pressed="${n===1}">${n}档</button>`).join('')}</div><main class="lbs-remote-main"><div class="remote-dpad"><button data-lbs-direction="forward" aria-label="前进">▲</button><button data-lbs-direction="left" aria-label="左转">◀</button><button data-lbs-direction="stop" aria-label="停止">■</button><button data-lbs-direction="right" aria-label="右转">▶</button><button data-lbs-direction="backward" aria-label="后退">▼</button></div><div><p class="lbs-remote-status" role="status"></p><small>五档编码与原手持遥控器一致。<br>无响应写入 · 最大档前进与停止已验证。<br>其他方向与档位待实物复核。</small></div></main>`;
  document.body.append(dialog);
  let speed=1,direction='stop',generation=0,pointer=null,poll=null,scope=null,opening=0,heldConnection=null;
  const status=dialog.querySelector('.lbs-remote-status');
  function conn(){return CardModelSession.current.id==='lbs2206'?window.CardBluetooth?.remoteConnection?.():null;}
  function draw(){if(!dialog.open)return;const c=conn(),issues=Lbs2206Protocol.profileIssues(Lbs2206Profile);
    dialog.querySelectorAll('[data-lbs-direction]').forEach(b=>{b.disabled=!c||(Boolean(c.busy)&&b.dataset.lbsDirection!=='stop');b.classList.toggle('is-pressed',b.dataset.lbsDirection===direction&&direction!=='stop');});
    dialog.querySelectorAll('[data-speed]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.speed===speed)));
    status.textContent=issues.length?'直连参数待确认，请先在设备设置中查看':!c?'尚未连接小车':c.busy?'等待设备停止确认，暂不能遥控':'已连接 · 请选择方向';
  }
  function send(next){direction=next;const ticket=++generation,c=next==='stop'?(heldConnection||conn()):conn();
    if(next!=='stop')heldConnection=c;
    draw();if(!c)return Promise.resolve();
    return c.remote(next,speed,()=>ticket===generation&&(next==='stop'||Boolean(scope?.isCurrent()&&dialog.open))).catch(e=>{if(ticket===generation&&dialog.open)status.textContent=e.message;});
  }
  function release(){pointer=null;const wasMoving=direction!=='stop';direction='stop';if(wasMoving)return send('stop');generation++;return Promise.resolve();}
  function close(){opening++;const result=release();clearInterval(poll);if(dialog.open)dialog.close();heldConnection=null;return result;}
  let returnHash='#home';
  async function open(){if(dialog.open||CardModelSession.current.id!=='lbs2206'||CardModelSession.switching)return;
    returnHash=location.hash==='#editor'?'#editor':'#home';
    const ticket=++opening;scope=CardModelSession.capture();await CardProgram.stop();if(ticket!==opening||!scope.isCurrent())return;
    dialog.showModal();draw();await CardBluetooth.ensureConnected?.();if(ticket!==opening||!dialog.open)return;poll=setInterval(draw,200);
  }
  dialog.querySelector('.remote-back').onclick=close;
  dialog.querySelector('.remote-connect').onclick=()=>window.CardOpenBluetoothFromRemote(returnHash,close);
  dialog.addEventListener('close',()=>{clearInterval(poll);release();});
  dialog.querySelectorAll('[data-speed]').forEach(button=>button.onclick=()=>{speed=+button.dataset.speed;draw();if(direction!=='stop')send(direction);});
  dialog.querySelectorAll('[data-lbs-direction]').forEach(button=>{
    button.onpointerdown=e=>{if(e.button>0||pointer!==null)return;e.preventDefault();pointer=e.pointerId;button.setPointerCapture(e.pointerId);send(button.dataset.lbsDirection);};
    button.onpointerup=button.onpointercancel=button.onlostpointercapture=e=>{if(pointer===e.pointerId)release();};
  });
  const keys={ArrowUp:'forward',ArrowDown:'backward',ArrowLeft:'left',ArrowRight:'right'};
  dialog.onkeydown=e=>{if(keys[e.code]&&!e.repeat){e.preventDefault();send(keys[e.code]);}};dialog.onkeyup=e=>{if(keys[e.code])release();};
  window.addEventListener('blur',()=>{if(dialog.open)release();});document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});

  const settings=document.createElement('dialog');settings.className='lbs-settings-dialog';
  settings.innerHTML=`<header><div><h2>LBS2206 设备设置</h2><p>连接验证与设备信息</p></div><button type="button" class="lbs-settings-close" aria-label="关闭设备设置">✕</button></header><p class="lbs-validation"></p><button class="bt-button primary lbs-settings-connect" type="button">蓝牙连接</button><section><h3>读取设备信息</h3><div class="lbs-read-buttons">${Object.entries({version:'固件版本',voltage:'电池电压',mac:'蓝牙地址',straight:'直行校准值',turn:'转向校准值'}).map(([key,text])=>`<button class="bt-button" data-read="${key}" type="button">${text}</button>`).join('')}</div><output class="lbs-setting-result" role="status">连接后可读取。</output></section><section><h3>校准</h3><p>直行和转向参数写入、恢复默认、程序间隔及步进速度设置尚未开放。参数范围和实物效果确认后，在这里接入。</p></section>`;
  document.body.append(settings);let settingsTicket=0,readTimer=null,expected=null;
  const result=settings.querySelector('.lbs-setting-result');
  function settingsDraw(){const issues=Lbs2206Protocol.profileIssues(Lbs2206Profile);settings.querySelector('.lbs-validation').textContent=issues.length?'待确认：'+issues.join('；'):'手机执行编程逻辑，通过遥控指令控制小车；不上传固件程序。';settings.querySelectorAll('[data-read]').forEach(b=>b.disabled=!conn()||conn().busy||Boolean(expected));}
  function showSettings(){if(CardModelSession.current.id!=='lbs2206')return;settingsTicket++;expected=null;settingsDraw();
    result.textContent=conn()?'选择要读取的信息。':'连接后可读取。';settings.showModal();}
  function dismissSettings(){settingsTicket++;clearTimeout(readTimer);expected=null;if(settings.open)settings.close();}
  settings.querySelector('.lbs-settings-close').onclick=dismissSettings;settings.addEventListener('close',()=>{settingsTicket++;clearTimeout(readTimer);expected=null;});
  settings.querySelector('.lbs-settings-connect').onclick=()=>{dismissSettings();location.hash='bluetooth';};
  settings.querySelectorAll('[data-read]').forEach(button=>button.onclick=async()=>{
    const ticket=settingsTicket,modelScope=CardModelSession.capture(),c=conn();if(!c||expected)return;
    const prefixes={version:'Ver=',voltage:'Voltage=',mac:'MAC=',straight:'STPL=',turn:'STPR='};expected=prefixes[button.dataset.read];result.textContent='正在读取…';settingsDraw();
    readTimer=setTimeout(()=>{if(ticket===settingsTicket&&modelScope.isCurrent()){expected=null;result.textContent='未收到设备回复，请重试；未推断读取结果。';settingsDraw();}},4000);
    try{await c.readSetting(button.dataset.read);}catch(e){if(ticket===settingsTicket&&modelScope.isCurrent()){clearTimeout(readTimer);expected=null;result.textContent=e.message;settingsDraw();}}
  });
  window.addEventListener('lbs-setting-reply',event=>{if(!settings.open||CardModelSession.current.id!=='lbs2206'||!expected||!event.detail.startsWith(expected))return;clearTimeout(readTimer);expected=null;result.textContent=event.detail;settingsDraw();});
  window.Lbs2206UI={open,close,settings:showSettings,dismissSettings};
})();
