(() => {
  const picker=document.createElement('dialog');picker.className='model-picker';picker.setAttribute('aria-labelledby','modelPickerTitle');
  picker.innerHTML=`<header><div><span class="model-eyebrow">设备型号</span><h1 id="modelPickerTitle">选择你的设备</h1><p>选择型号后，开始编程或遥控。</p></div><button class="model-cancel" type="button" aria-label="取消选择">✕</button></header><div class="model-options"></div><p class="model-error" role="alert" hidden></p><footer>型号用于匹配功能。蓝牙连接时，再选择具体的设备。</footer>`;
  document.body.append(picker);
  const entry=document.createElement('button');entry.className='home-model-entry';entry.type='button';
  entry.innerHTML='<img alt=""><span><strong></strong><small>切换设备⌄</small></span>';
  document.querySelector('.home-sidebar').prepend(entry);
  let choosing=false;
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
    const selected=CardModelSession.selected;
    picker.querySelector('.model-cancel').hidden=!selected;
    picker.querySelector('.model-error').hidden=true;
    picker.querySelector('.model-options').replaceChildren(...CardModels.list().map(model=>{
      const button=document.createElement('button');button.type='button';button.className='model-card';button.dataset.modelId=model.id;
      const art=document.createElement('div');art.className='model-card-art';const img=document.createElement('img');img.src=model.image;img.alt=model.name;art.append(img);
      const info=document.createElement('div');info.className='model-card-info';
      const title=document.createElement('strong');title.textContent=model.name;
      const desc=document.createElement('p');desc.textContent=model.description;
      const action=document.createElement('span');action.className='model-card-action';
      action.textContent=selected&&model===CardModelSession.current?'当前型号 · 继续使用 →':'选择设备 →';
      info.append(title,desc,action);button.append(art,info);
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
    picker.showModal();
    if(window.cardMigrationError)error(window.cardMigrationError);
  }
  picker.querySelector('.model-cancel').onclick=()=>{if(!choosing)picker.close();};
  picker.addEventListener('cancel',event=>{if(!CardModelSession.selected||choosing)event.preventDefault();});
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
