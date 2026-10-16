// Shared physical controller visuals and hit geometry. Input and BLE stay in remote-ui.
(() => {
  window.createXiaobaiRemoteSkin=(dialog,buttons,status)=>{
    const originals=buttons.map(button=>{const anchor=document.createComment('remote button');button.before(anchor);return {button,anchor,html:button.innerHTML,classes:button.className};});
    const statusAnchor=document.createComment('remote status');status.before(statusAnchor);
    const root=document.createElement('section');root.id='xb-controller';root.hidden=true;root.setAttribute('aria-label','小白遥控器');
    root.innerHTML=`<div class="controller-shell">
      <div id="xb-shoulders"><div class="keys" role="group" aria-label="速度肩键"></div></div>
      <div class="controller-body">
        <div id="xb-dpad-demo"><div class="scene" role="group" aria-label="方向键">
          <div class="socket" aria-hidden="true"></div><div class="cast-shadow" aria-hidden="true"><div class="cross"></div></div>
          <div class="assembly" aria-hidden="true"><div class="rocker"><div class="cross face"><div class="cross face-inner"><div class="shine"></div>
            <div class="engraved up"><div class="chevron"></div></div><div class="engraved down"><div class="chevron"></div></div>
            <div class="engraved left"><div class="chevron"></div></div><div class="engraved right"><div class="chevron"></div></div><div class="nub"></div>
          </div></div></div></div><div class="hitbox"></div>
        </div></div>
        <div id="xb-color-pad"><div class="pad" role="group" aria-label="电机控制"><div class="channel a" aria-hidden="true"></div><div class="channel b" aria-hidden="true"></div></div></div>
      </div></div>`;
    dialog.querySelector('.remote-controls').before(root);
    const rocker=root.querySelector('.rocker'),face=root.querySelector('.face-inner'),shadow=root.querySelector('.cast-shadow');
    for(let z=0;z<13;z++){const layer=document.createElement('div');layer.className='cross side';layer.style.transform=`translateZ(${z}px)`;rocker.prepend(layer);}
    // Position preserves the existing Y/A/X/B protocol mapping, irrespective of color.
    const colors={Y:'yellow',X:'red',B:'green',A:'blue'};
    const tilt={up:[14,0,50,85,0,14],down:[-14,0,50,10,0,-2],left:[0,-14,85,30,12,8],right:[0,14,10,30,-10,8]};
    let enabled=false,active='';
    function update(pressed){
      if(!enabled)return;
      const direction=pressed.find(key=>tilt[key])||'';
      if(direction===active)return;
      active=direction;const s=tilt[direction];rocker.classList.toggle('held',!!s);
      rocker.style.transform=s?`rotateX(${s[0]}deg) rotateY(${s[1]}deg) translateZ(-1px)`:'rotateX(0deg) rotateY(0deg) translateZ(0)';
      face.style.setProperty('--light-x',`${s?s[2]:32}%`);face.style.setProperty('--light-y',`${s?s[3]:20}%`);
      shadow.style.transform=`translate(${s?s[4]:1}px,${s?s[5]:9}px)`;
    }
    function activate(value,model){
      root.setAttribute('aria-label',`${model?.name||'小白'}遥控器`);
      root.querySelector('#xb-shoulders .keys').setAttribute('aria-label',model?.id==='spark-ai'?'功能肩键':'速度肩键');
      root.querySelector('#xb-color-pad .pad').setAttribute('aria-label',model?.id==='spark-ai'?'功能按键':'电机控制');
      if(value===enabled)return;
      if(!value)update([]);
      enabled=value;dialog.classList.toggle('xiaobai-remote',enabled);root.hidden=!enabled;
      if(enabled){
        for(const {button} of originals){
          const key=button.dataset.remoteKey;
          if(key==='L'||key==='R'){
            button.classList.add('key',key==='L'?'left':'right');
            button.innerHTML=`<span class="key-face"><span class="letter">${key}</span></span>`;
            root.querySelector('#xb-shoulders .keys').append(button);
          }else if(colors[key]){
            button.classList.add('key',colors[key]);button.innerHTML='<span class="key-face"></span>';
            root.querySelector('#xb-color-pad .pad').append(button);
          }else{
            button.classList.add('hit');button.dataset.dir=key;button.textContent='';root.querySelector('.hitbox').append(button);
          }
        }
        root.querySelector('.controller-shell').append(status);
      }else{
        for(const original of originals){
          const {button,anchor,html,classes}=original;button.className=classes;button.innerHTML=html;delete button.dataset.dir;
          anchor.after(button);button.setAttribute('aria-pressed','false');
        }
        statusAnchor.after(status);
      }
    }
    const directionSurface=root.querySelector('#xb-dpad-demo .scene');
    function directionAt(clientX,clientY,previous=''){
      if(!enabled)return '';
      // Use the stationary circular base, never the tilting rocker or overlapping buttons.
      const r=directionSurface.getBoundingClientRect(),radius=Math.min(r.width,r.height)/2;
      if(!radius)return '';
      const x=clientX-r.left-r.width/2,y=clientY-r.top-r.height/2,distance=Math.hypot(x,y);
      const deadZone=Math.max(8,Math.min(14,radius*.12));
      if(distance<=deadZone||distance>radius)return '';
      const horizontal=x<0?'left':'right',vertical=y<0?'up':'down';
      const diagonalSlop=Math.max(3,Math.min(6,radius*.05));
      if(Math.abs(Math.abs(x)-Math.abs(y))<=diagonalSlop&&(previous===horizontal||previous===vertical))return previous;
      return Math.abs(x)>Math.abs(y)?horizontal:vertical;
    }
    return {activate,update,directionSurface,directionAt,get enabled(){return enabled;}};
  };
})();
