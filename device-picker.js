(() => {
  const picker=document.createElement('dialog');picker.className='model-picker';picker.setAttribute('aria-labelledby','modelPickerTitle');
  picker.innerHTML=`<header><h1 id="modelPickerTitle">选择设备</h1><button class="model-cancel" type="button" aria-label="取消选择">✕</button></header><div class="model-options" aria-label="设备型号"></div><p class="model-error" role="alert" hidden></p>`;
  document.body.append(picker);
  const entry=document.createElement('button');entry.className='home-model-entry';entry.type='button';
  entry.innerHTML='<img alt=""><span><strong></strong><small>切换设备⌄</small></span>';
  document.querySelector('.home-sidebar').prepend(entry);
  let choosing=false;
  // Keep the modal in the top layer until its exit animation finishes.
  const nativeClose=picker.close.bind(picker);
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let motion=null,motionTimer=null,motionVersion=0,closing=false,fromEntry=false;
  function entryTransform(){
    const box=entry.getBoundingClientRect();
    if(!fromEntry||!box.width||!box.height||box.bottom<=0||box.right<=0||box.top>=innerHeight||box.left>=innerWidth)return 'scale(.96)';
    // The fixed dialog's offsets describe its final, untransformed viewport bounds.
    const dx=box.left+box.width/2-picker.offsetLeft-picker.offsetWidth/2;
    const dy=box.top+box.height/2-picker.offsetTop-picker.offsetHeight/2;
    return `translate(${dx}px,${dy}px) scale(${box.width/picker.offsetWidth},${box.height/picker.offsetHeight})`;
  }
  function animatePicker(opening,returnValue){
    const version=++motionVersion;
    const style=getComputedStyle(picker);
    const from={opacity:style.opacity,transform:style.transform};
    const backdropOpacity=getComputedStyle(picker,'::backdrop').opacity;
    motion?.cancel();clearTimeout(motionTimer);
    closing=!opening;
    picker.classList.toggle('model-closing',closing);
    picker.style.setProperty('--model-backdrop-from',backdropOpacity);
    picker.classList.remove('model-entering','model-leaving');
    void picker.offsetWidth;
    picker.classList.add(opening?'model-entering':'model-leaving');
    const finish=()=>{
      if(version!==motionVersion)return;
      clearTimeout(motionTimer);motion?.cancel();motion=null;
      picker.classList.remove('model-entering','model-leaving','model-closing');
      picker.style.removeProperty('--model-backdrop-from');
      closing=false;
      if(!opening&&picker.open)nativeClose(returnValue);
    };
    if(reducedMotion.matches||document.hidden||!picker.animate){finish();return;}
    motion=picker.animate([from,opening?{opacity:1,transform:'none'}:{opacity:0,transform:entryTransform()}],{
      duration:opening?320:240,easing:opening?'cubic-bezier(.2,.8,.2,1)':'cubic-bezier(.4,0,.8,.2)',fill:'both'
    });
    motion.finished.then(finish,()=>{});
    motionTimer=setTimeout(finish,420);
  }
  picker.close=(returnValue)=>{if(picker.open&&!closing)animatePicker(false,returnValue);};
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden||!motion)return;
    motion.finish();
  });
  window.addEventListener('resize',()=>motion?.finish());
  const options=picker.querySelector('.model-options');
  let drag=null,suppressClickUntil=0;
  options.addEventListener('dragstart',event=>event.preventDefault());
  options.addEventListener('pointerdown',event=>{
    if(choosing||closing||!event.isPrimary||event.button!==0)return;
    suppressClickUntil=0;drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:options.scrollLeft,moved:false};
  });
  options.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moved){
      if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){drag=null;return;}
      if(Math.abs(dx)<6)return;
      drag.moved=true;options.classList.add('model-dragging');options.setPointerCapture(event.pointerId);
    }
    event.preventDefault();options.scrollLeft=drag.left-dx;
  });
  function endDrag(event){
    if(!drag||drag.id!==event.pointerId)return;
    const moved=drag.moved;drag=null;
    if(options.hasPointerCapture(event.pointerId))options.releasePointerCapture(event.pointerId);
    if(!moved)return;
    suppressClickUntil=performance.now()+500;
    const left=options.scrollLeft,cards=options.children,step=cards.length>1?cards[1].offsetLeft-cards[0].offsetLeft:1;
    options.classList.remove('model-dragging');
    options.scrollTo({left:Math.round(left/step)*step,behavior:reducedMotion.matches?'instant':'smooth'});
  }
  options.addEventListener('pointerup',endDrag);options.addEventListener('pointercancel',endDrag);
  options.addEventListener('lostpointercapture',event=>{if(event.target===options)endDrag(event);});
  options.addEventListener('click',event=>{if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
  const shortDescriptions={xiaobai:'电机 · 点阵 · 语音',lbs2206:'双电机编程小车','spark-ai':'电机 · 传感器 · 点阵',tc01:'双电机独立控制',receiver2226:'组合电机 · 第三路电机'};
  function error(text){const p=picker.querySelector('.model-error');p.textContent=text;p.hidden=false;}
  function renderEntry(){
    const model=CardModelSession.current;
    entry.querySelector('img').src=model.image;entry.querySelector('strong').textContent=model.name;
    entry.setAttribute('aria-label',`当前设备型号：${model.name}，切换设备`);
    document.querySelector('.remote-entry').hidden=!model.features.some(f=>f.id==='remote');
    document.body.dataset.deviceModel=model.id;
  }
  function show(){
    if(choosing)return;
    if(picker.open){if(closing)animatePicker(true);return;}
    const selected=CardModelSession.selected;
    picker.querySelector('.model-cancel').hidden=!selected;
    picker.querySelector('.model-error').hidden=true;
    fromEntry=selected;
    drag=null;suppressClickUntil=0;options.classList.remove('model-dragging');
    options.replaceChildren(...CardModels.list().map(model=>{
      const button=document.createElement('button');button.type='button';button.className='model-card';button.dataset.modelId=model.id;
      const art=document.createElement('div');art.className='model-card-art';const img=document.createElement('img');img.src=model.image;img.alt=model.name;art.append(img);
      const info=document.createElement('div');info.className='model-card-info';
      const title=document.createElement('strong');title.textContent=model.name;
      const desc=document.createElement('p');desc.textContent=model.pickerDescription||shortDescriptions[model.id]||model.description;
      const action=document.createElement('span');action.className='model-card-action';
      const current=selected&&model===CardModelSession.current;
      button.setAttribute('aria-pressed',String(current));
      action.textContent='当前设备';
      const check=document.createElement('span');check.className='model-card-check';check.textContent='✓';check.setAttribute('aria-hidden','true');
      info.append(title,desc,action);button.append(check,art,info);
      button.onclick=async()=>{
        if(choosing)return;choosing=true;picker.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{
          if(window.cardMigrationError)throw new Error(window.cardMigrationError);
          await CardModelSession.select(model.id);
          renderEntry();picker.close();
          location.hash='home';CardHome.useModel(CardModelSession.current);
        }catch(e){error(e.message||'设备切换失败，请重试。');}
        finally{choosing=false;picker.querySelectorAll('button').forEach(b=>b.disabled=false);CardProgram.refresh();}
      };
      return button;
    }));
    picker.style.opacity='0';
    picker.classList.add('model-opening');
    picker.showModal();
    picker.style.transform=entryTransform();
    const currentCard=options.querySelector('[aria-pressed="true"]');
    options.scrollLeft=currentCard?currentCard.offsetLeft-options.firstElementChild.offsetLeft:0;
    animatePicker(true);
    picker.style.removeProperty('opacity');picker.style.removeProperty('transform');
    picker.classList.remove('model-opening');
    if(window.cardMigrationError)error(window.cardMigrationError);
  }
  picker.querySelector('.model-cancel').onclick=()=>{if(!choosing)picker.close();};
  picker.addEventListener('cancel',event=>{event.preventDefault();if(CardModelSession.selected&&!choosing)picker.close();});
  picker.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    event.preventDefault();
    if(CardModelSession.selected&&!choosing)picker.close();
  });
  entry.onclick=show;
  Object.assign(CardModelHooks,{
    checkpoint:()=>CardHome.checkpoint(),
    async deactivate(old){
      cancelDrag();closeParamEditor();old.deactivate?.();
      const bluetooth=window.CardBluetooth,connection=bluetooth?.remoteConnection?.();
      // Stop/cancel first, then retire the transport. Each old connection retains its own ID.
      const wasRunning=CardProgram.running;
      const stopped=Promise.allSettled([bluetooth?.cancelAuto?.(),CardProgram.stop(),old.remote?.reset ? old.remote.reset() : old.remote?.close?.(),(!wasRunning||!old.execution.reportsLifecycle)?connection?.stopProgram?.():undefined]);
      await Promise.race([stopped,new Promise(resolve=>setTimeout(resolve,1500))]);
      await bluetooth?.dispose?.();
    },
    async activate(model){
      CardEditor.configure(model);CardHome.useModel(model);
      window.CardBluetooth=await model.bluetooth.create({model});
    },
    changed(){renderEntry();CardProgram.refresh();location.hash='home';}
  });
  // Creation is synchronous for Xiaobai. Future factories may finish setup internally.
  window.CardBluetooth=CardModelSession.current.bluetooth.create({model:CardModelSession.current});
  renderEntry();
  if(!CardModelSession.selected){location.hash='home';CardHome.useModel(CardModelSession.current);show();}
  window.CardDevicePicker={open:show};
})();
