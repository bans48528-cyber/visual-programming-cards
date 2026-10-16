(() => {
  // Local rotate-cw / rotate-ccw paths; lamps never depend on a preview host.
  const lamp=direction=>{
    const paths=direction==='forward'?'<path d="M21 11a9 9 0 1 0-2.39 6.09"/><path d="M21 4v7h-7"/>':'<path d="M3 11a9 9 0 1 1 2.39 6.09"/><path d="M3 4v7h7"/>';
    return '<span class="direction-lamp '+direction+'" aria-hidden="true">'+['rim','lens'].map(layer=>'<svg class="'+layer+'" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>').join('')+'</span>';
  };
  const motor=(side,label,letter)=>'<section class="motor" data-motor="'+side+'" data-direction="stop" data-held="false"><header><strong>'+letter+'</strong><span>'+label+'电机</span></header><div class="well">'+lamp('forward')+lamp('reverse')+'<div class="slot" aria-hidden="true"></div><div class="center-mark" aria-hidden="true"></div><div class="lever" aria-hidden="true"><div class="stem"></div><div class="thumb"><div class="thumb-top"><i></i><i></i><i></i></div></div></div><button class="stick-input forward-input" data-tc-key="'+side+'Forward" type="button" aria-label="'+label+'电机摇杆，上推正转" aria-pressed="false"></button><button class="stick-input reverse-input" data-tc-key="'+side+'Reverse" type="button" aria-label="'+label+'电机摇杆，下拉反转" aria-pressed="false"></button></div><output class="motor-status" aria-live="polite">停止</output></section>';
  const dialog=document.createElement('dialog');dialog.className='remote-dialog tc01-remote';dialog.id='tc01Remote';dialog.setAttribute('aria-label','幼儿小方块 TC-01 遥控');
  dialog.innerHTML='<nav class="remote-header" aria-label="遥控导航"><button class="remote-back" type="button" aria-label="关闭遥控">‹</button><button class="remote-connect" type="button" aria-label="蓝牙未连接"></button></nav><main class="tc01-controls"><div id="tc01-twin-stick"><section class="controller" aria-label="TC-01 双电机遥控"><div class="sticks">'+motor('left','左','L')+motor('right','右','R')+'</div><div class="tc01-toolbar"><p class="tc01-status" role="status"></p><button class="tc01-stop" type="button">全部停止</button></div></section></div></main><footer>蓝牙名称 Drluc<span>输入状态 · 左 W / S · 右 ↑ / ↓</span></footer>';
  document.body.append(dialog);
  CardBindBluetoothButton(dialog.querySelector('.remote-connect'));
  CardPageTransition.bindDialog(dialog,{beforeClose:()=>release()});
  const status=dialog.querySelector('.tc01-status'),buttons=[...dialog.querySelectorAll('[data-tc-key]')];
  const held=new Map(),keyMap={KeyW:'leftForward',KeyS:'leftReverse',ArrowUp:'rightForward',ArrowDown:'rightReverse'};
  const controls=[...dialog.querySelectorAll('.motor')].map(element=>({element,side:element.dataset.motor,well:element.querySelector('.well'),thumb:element.querySelector('.thumb'),stem:element.querySelector('.stem'),status:element.querySelector('.motor-status'),pointer:null,input:null,offset:0}));
  let scope=null,opening=0,revision=0,poll=null,heldConnection=null,observedConnectionId=null,returnHash='#home',error='';
  const connection=()=>CardModelSession.current.id==='tc01'?window.CardBluetooth?.remoteConnection?.():null;
  const canPress=()=>dialog.open&&CardModelSession.current.id==='tc01'&&!CardModelSession.switching&&Boolean(scope?.isCurrent());
  const clamp=value=>Math.max(-1,Math.min(1,value));
  const direction=value=>Math.abs(value)<.18?0:value>0?1:-1;
  const travel=control=>Math.max(8,Math.min(54,(control.well.clientHeight-control.thumb.offsetHeight)/2-30));
  const latest=side=>[...held.values()].filter(value=>value.side===side).pop();
  const motors=()=>controls.map(control=>latest(control.side)?.direction||0);
  function clearInputs(){
    held.clear();
    for(const control of controls){const id=control.pointer,input=control.input;control.pointer=null;control.input=null;control.offset=0;if(id!==null&&input?.hasPointerCapture(id))input.releasePointerCapture(id);}
  }
  function synchronize(){
    const c=connection(),id=c?.id??null;
    if(id!==observedConnectionId){
      // Offline and previous-device gestures must be started again on a new link.
      observedConnectionId=id;revision++;heldConnection=null;clearInputs();
    }
    return c;
  }
  function draw(){
    if(!dialog.open)return;
    const c=synchronize(),state=motors();
    controls.forEach((control,index)=>{
      const input=latest(control.side),value=input?.position||0,distance=-value*travel(control),dir=state[index];
      control.element.dataset.direction=dir===0?'stop':dir>0?'forward':'reverse';control.element.dataset.held=String(Boolean(input));
      control.thumb.style.transform='translateY('+distance+'px) rotateX('+(value*12)+'deg)';
      control.stem.style.height=Math.abs(distance)+'px';control.stem.style.top='calc(50% + '+Math.min(distance,0)+'px)';
      const text=dir===0?'停止':dir>0?'正转':'反转';if(control.status.textContent!==text)control.status.textContent=text;
    });
    buttons.forEach(button=>{const key=button.dataset.tcKey,down=state[key.startsWith('left')?0:1]===(key.endsWith('Forward')?1:-1);button.disabled=!canPress();button.classList.toggle('is-pressed',down);button.setAttribute('aria-pressed',String(down));});
    status.textContent=error||(!c?(TC01Protocol.issues(TC01Profile).length?'连接参数待确认':'未连接设备'):'已连接 · 松手停止');dialog.querySelector('.tc01-stop').disabled=!canPress();
  }
  function send(stop=false){
    const current=synchronize(),c=stop?(heldConnection||current):current,ticket=++revision,state=stop?[0,0]:motors();
    if(!stop)heldConnection=c;draw();if(!c)return Promise.resolve();
    return c.setMotors(...state,()=>ticket===revision&&(stop||Boolean(dialog.open&&scope?.isCurrent()))).catch(e=>{if(ticket===revision&&dialog.open){error=e.message;clearInputs();draw();}});
  }
  function release(){clearInputs();return send(true);}
  function close(){opening++;const pending=held.size?release():Promise.resolve();clearInputs();clearInterval(poll);if(dialog.open)dialog.close();heldConnection=null;return pending;}
  async function open(options={}){
    if(dialog.open||CardModelSession.current.id!=='tc01'||CardModelSession.switching)return;
    const ticket=++opening;scope=CardModelSession.capture();returnHash=options.returnHash||(location.hash==='#editor'?'#editor':'#home');
    await CardProgram.stop();if(ticket!==opening||!scope.isCurrent()||document.hidden||(options.isCurrent&&!options.isCurrent()))return;
    error='';clearInputs();observedConnectionId=connection()?.id??null;CardShowRemoteDialog(dialog,options,returnHash);draw();
    await CardBluetooth.ensureConnected?.();if(ticket===opening&&dialog.open)poll=setInterval(draw,200);
  }
  function position(control,y){const bounds=control.well.getBoundingClientRect();return clamp((bounds.top+bounds.height/2-y+control.offset)/travel(control));}
  function move(control,y){
    const value=position(control,y),before=motors().join(','),previous=held.get(control.pointer),next={side:control.side,direction:direction(value),position:value};
    if(!previous||previous.direction!==next.direction)held.delete(control.pointer);
    held.set(control.pointer,next);
    if(motors().join(',')!==before)send();else draw();
  }
  buttons.forEach(button=>{
    const control=controls.find(item=>button.dataset.tcKey.startsWith(item.side));
    button.onpointerdown=e=>{
      synchronize();if(e.button>0||!canPress()||control.pointer!==null)return;e.preventDefault();error='';
      control.pointer=e.pointerId;control.input=button;button.focus({preventScroll:true});button.setPointerCapture(e.pointerId);
      const r=control.thumb.getBoundingClientRect();control.offset=e.clientY>=r.top&&e.clientY<=r.bottom?e.clientY-(r.top+r.height/2):0;
      move(control,e.clientY);
    };
    button.onpointermove=e=>{synchronize();if(control.pointer!==e.pointerId||!canPress())return;e.preventDefault();move(control,e.clientY);};
    const up=e=>{synchronize();if(control.pointer!==e.pointerId)return;const id=control.pointer,input=control.input;control.pointer=null;control.input=null;held.delete(id);if(input?.hasPointerCapture(id))input.releasePointerCapture(id);send();};
    button.onpointerup=button.onpointercancel=button.onlostpointercapture=up;button.oncontextmenu=e=>e.preventDefault();
  });
  dialog.onkeydown=e=>{
    synchronize();if(!keyMap[e.code]||e.repeat||!canPress()||e.target.closest('.remote-connect,.remote-back,.tc01-stop'))return;
    e.preventDefault();error='';const key=keyMap[e.code],value=key.endsWith('Forward')?1:-1;held.delete(e.code);held.set(e.code,{side:key.startsWith('left')?'left':'right',direction:value,position:value});send();
  };
  dialog.onkeyup=e=>{synchronize();if(held.delete(e.code)){e.preventDefault();send();}};
  dialog.querySelector('.tc01-stop').onclick=release;
  dialog.querySelector('.remote-back').onclick=close;
  dialog.querySelector('.remote-connect').onclick=()=>window.CardOpenBluetoothFromRemote(returnHash,close,open);
  dialog.addEventListener('close',()=>{if(dialog.open)return;clearInterval(poll);if(held.size)release();else clearInputs();});
  window.addEventListener('blur',()=>{if(dialog.open&&held.size)release();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
  window.TC01UI={open,close};
})();
