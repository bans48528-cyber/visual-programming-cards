(() => {
  const dialog=document.createElement('dialog');dialog.className='remote-dialog tc01-remote';dialog.id='tc01Remote';
  dialog.innerHTML=`<header class="remote-header"><button class="remote-back" type="button" aria-label="关闭遥控">‹</button><div><h1>幼儿小方块 TC-01</h1><p>按住转动 · 松手停止 · 支持双手操作</p></div><button class="remote-connect" type="button">蓝牙连接</button></header>
    <main class="tc01-controls"><section><h2>左电机 <small>L</small></h2><button data-tc-key="leftForward" type="button">↻<span>正转</span></button><button data-tc-key="leftReverse" type="button">↺<span>反转</span></button></section>
    <div class="tc01-center"><img src="assets/devices/tc01.svg" alt=""><p class="tc01-status" role="status"></p><button class="tc01-stop" type="button">全部停止</button></div>
    <section><h2>右电机 <small>R</small></h2><button data-tc-key="rightForward" type="button">↻<span>正转</span></button><button data-tc-key="rightReverse" type="button">↺<span>反转</span></button></section></main>
    <footer>蓝牙名称 Drluc<span>左电机 W / S · 右电机 ↑ / ↓</span></footer>`;
  document.body.append(dialog);
  const status=dialog.querySelector('.tc01-status'),buttons=[...dialog.querySelectorAll('[data-tc-key]')];
  const held=new Map(),keyMap={KeyW:'leftForward',KeyS:'leftReverse',ArrowUp:'rightForward',ArrowDown:'rightReverse'};
  let scope=null,opening=0,revision=0,poll=null,heldConnection=null,returnHash='#home',error='';
  const connection=()=>CardModelSession.current.id==='tc01'?window.CardBluetooth?.remoteConnection?.():null;
  function motors(){const values=[...held.values()];return ['left','right'].map(side=>{const latest=values.filter(key=>key.startsWith(side)).pop();return latest?latest.endsWith('Forward')?1:-1:0;});}
  function draw(){if(!dialog.open)return;const c=connection();if(held.size&&heldConnection&&heldConnection.id!==c?.id){held.clear();revision++;heldConnection=null;}const state=motors();buttons.forEach(b=>{b.disabled=!c;const left=b.dataset.tcKey.startsWith('left'),dir=b.dataset.tcKey.endsWith('Forward')?1:-1;const down=state[left?0:1]===dir;b.classList.toggle('is-pressed',down);b.setAttribute('aria-pressed',String(down));});
    status.textContent=error||(!c?(TC01Protocol.issues(TC01Profile).length?'连接参数待确认，暂不能控制设备':'未连接设备'):'已连接 · 按住按钮转动');dialog.querySelector('.tc01-stop').disabled=!c;
  }
  function send(stop=false){const ticket=++revision,c=stop?(heldConnection||connection()):connection();const state=stop?[0,0]:motors();if(!stop)heldConnection=c;draw();if(!c)return Promise.resolve();
    return c.setMotors(...state,()=>ticket===revision&&(stop||Boolean(dialog.open&&scope?.isCurrent()))).catch(e=>{if(ticket===revision&&dialog.open){error=e.message;held.clear();draw();}});
  }
  function release(){held.clear();return send(true);}
  function close(){opening++;const pending=held.size?release():Promise.resolve();held.clear();clearInterval(poll);if(dialog.open)dialog.close();heldConnection=null;return pending;}
  async function open(){if(dialog.open||CardModelSession.current.id!=='tc01'||CardModelSession.switching)return;const ticket=++opening;scope=CardModelSession.capture();returnHash=location.hash==='#editor'?'#editor':'#home';await CardProgram.stop();if(ticket!==opening||!scope.isCurrent())return;error='';dialog.showModal();draw();await CardBluetooth.ensureConnected?.();if(ticket===opening&&dialog.open)poll=setInterval(draw,200);}
  buttons.forEach(button=>{button.onpointerdown=e=>{if(button.disabled||e.button>0)return;e.preventDefault();error='';held.delete(e.pointerId);held.set(e.pointerId,button.dataset.tcKey);button.setPointerCapture(e.pointerId);send();};
    const up=e=>{if(held.delete(e.pointerId))send();};button.onpointerup=button.onpointercancel=button.onlostpointercapture=up;
    button.oncontextmenu=e=>e.preventDefault();
  });
  dialog.onkeydown=e=>{if(!keyMap[e.code]||e.repeat||!connection())return;e.preventDefault();held.set(e.code,keyMap[e.code]);send();};dialog.onkeyup=e=>{if(held.delete(e.code)){e.preventDefault();send();}};
  dialog.querySelector('.tc01-stop').onclick=release;
  dialog.querySelector('.remote-back').onclick=close;
  dialog.querySelector('.remote-connect').onclick=()=>window.CardOpenBluetoothFromRemote(returnHash,close);
  dialog.addEventListener('close',()=>{clearInterval(poll);if(held.size)release();});
  window.addEventListener('blur',()=>{if(dialog.open&&held.size)release();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
  window.TC01UI={open,close};
})();
