// Firmware compatibility lives in the programming flow. No settings page or file picker.
(() => {
  'use strict';
  const dialog=document.createElement('dialog');dialog.id='xiaobaiFirmwareDialog';dialog.className='firmware-dialog';
  dialog.setAttribute('aria-labelledby','firmwareTitle');dialog.setAttribute('aria-describedby','firmwareMessage');
  dialog.innerHTML=`<div class="firmware-content"><img class="firmware-robot" src="assets/devices/xiaobai-product.webp" alt="小白主机"><div class="firmware-copy"><h2 id="firmwareTitle">正在核对小白</h2><p id="firmwareMessage" role="status" aria-live="polite"></p></div>
    <dl class="firmware-versions"><div><dt>主机版本</dt><dd class="firmware-current">未确认</dd></div><div><dt>本 App 对应版本</dt><dd class="firmware-target">—</dd></div></dl>
    <div class="firmware-progress-wrap" hidden><progress class="firmware-progress" value="0" max="1" aria-label="设备已提交固件进度"></progress><output class="firmware-progress-text"></output></div>
    <p class="firmware-help" hidden></p></div>
    <footer class="firmware-actions"><button type="button" class="firmware-cancel">暂不更新</button><button type="button" class="firmware-retry" hidden>重新检查</button><button type="button" class="firmware-confirm">确定</button></footer>`;
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector),textVersion=value=>Number.isInteger(value)?XiaobaiOtaProtocol.versionText(value):'未确认';
  let current=null,off=null,state=null,cancelling=false,rendering=false,followUpgrade=false,managedCloses=0;
  const titles={checking:'正在核对小白',ready:'小白已就绪','update-required':'小白需要更新',newer:'请更新 App',unknown:'主机版本尚未确认',upgrading:'正在更新小白',recovery:'需要恢复更新',success:'小白更新完成'};
  function service(){return window.CardModelSession?.current.id==='xiaobai'?window.CardBluetooth?.firmware:null;}
  function bind(){
    const next=service();if(next===current)return;
    off?.();off=null;current=next;followUpgrade=false;state=next?.snapshot?.()||null;
    if(current)off=current.subscribe(render);
    render(state);
  }
  function render(s=state){
    if(rendering)return;rendering=true;
    try{
      state=s;if(s?.phase==='upgrading')followUpgrade=true;else if(!s?.busy)followUpgrade=false;
      const visibleScope=location.hash==='#editor'&&!document.hidden&&service()===current;
      const open=visibleScope&&s&&(s.prompt||s.phase==='upgrading'||(followUpgrade&&s.busy)||(dialog.open&&s.busy&&s.phase==='checking'));
      if(!open){if(dialog.open){managedCloses++;dialog.close();}return;}
      const session=s.session||{},progress=s.progress||session;
      const busy=Boolean(s.busy&&s.phase!=='checking')||Boolean(session.busy),written=Boolean(session.written);
      dialog.dataset.phase=s.phase;dialog.dataset.written=String(written);
      $('#firmwareTitle').textContent=written&&['recovery','unknown'].includes(s.phase)?'固件已写入，启动尚未确认':titles[s.phase]||'小白固件';
      $('#firmwareMessage').textContent=s.message||'小白需更新到本 App 对应版本，才能学习和运行作品。';
      $('.firmware-current').textContent=textVersion(s.currentVersion??s.actual?.info?.version??s.actual?.version);
      $('.firmware-target').textContent=textVersion(s.targetVersion??s.target?.version??s.target?.firmware?.version);
      const total=progress.total||session.total||0,committed=progress.committed??session.committed??0;
      $('.firmware-progress-wrap').hidden=!(total>0&&(busy||written||s.phase==='recovery'));
      $('.firmware-progress').max=total||1;$('.firmware-progress').value=Math.min(total,Math.max(0,committed));
      $('.firmware-progress-text').textContent=`已提交 ${Math.floor(committed/Math.max(1,total)*100)}%`;
      const help=$('.firmware-help');help.hidden=!(busy||s.phase==='recovery'||written);
      help.textContent=written?'启动检查通过后才会解除限制。无需重复写入，作品不会自动运行。':s.phase==='recovery'?'保持原主机供电。恢复时会先确认写入状态，未完成的传输从头开始。':'请保持主机供电、手机在附近并停留前台。更新后不会自动运行作品。';
      const confirm=$('.firmware-confirm');confirm.hidden=busy||(!s.canUpgrade&&s.phase!=='success'&&s.phase!=='ready');
      confirm.disabled=busy||cancelling;confirm.textContent=s.phase==='success'||s.phase==='ready'?'完成':'确定';
      const retry=$('.firmware-retry');retry.hidden=busy||s.canUpgrade||!['unknown','recovery'].includes(s.phase);retry.disabled=cancelling;
      retry.textContent=written?'重试启动检查':s.phase==='recovery'?'恢复更新':'重新检查';
      const cancel=$('.firmware-cancel');cancel.hidden=s.phase==='success'||s.phase==='ready';cancel.disabled=cancelling;
      cancel.textContent=cancelling?'正在取消…':busy?'取消更新':'稍后再说';
      if(!dialog.open){window.closeParamEditor?.();dialog.showModal();}
    }finally{rendering=false;window.CardProgram?.refresh();window.CardLearnedCommands?.refresh?.();}
  }
  async function cancel(background=false){
    if(!current||cancelling)return;
    cancelling=true;render();
    try{if(background)await current.cancel({background:true,reason:'应用进入后台或离开编程，升级已停止。'});else await current.cancel();}
    finally{cancelling=false;render(current?.snapshot?.());}
  }
  $('.firmware-confirm').onclick=()=>{
    if(!current)return;
    if(state?.phase==='success'||state?.phase==='ready'){current.cancel();return;}
    Promise.resolve(current.confirmUpgrade()).catch(()=>{});
  };
  $('.firmware-retry').onclick=()=>Promise.resolve(current?.retry()).catch(()=>{});
  $('.firmware-cancel').onclick=()=>cancel().catch(()=>{});
  dialog.addEventListener('cancel',event=>{event.preventDefault();cancel().catch(()=>{});});
  dialog.addEventListener('close',()=>{if(managedCloses){managedCloses--;return;}if(!dialog.open&&(state?.busy||state?.prompt))cancel(true).catch(()=>{});});
  const scopeChanged=()=>{
    bind();if(location.hash!=='#editor'&&current?.snapshot?.().busy)cancel(true).catch(()=>{});else render(current?.snapshot?.());
  };
  window.addEventListener('xiaobai-firmware-change',()=>{bind();render(current?.snapshot?.());});
  window.addEventListener('hashchange',scopeChanged);
  window.addEventListener('card-bluetooth-route',scopeChanged);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel(true).catch(()=>{});else scopeChanged();});
  window.addEventListener('pagehide',()=>cancel(true).catch(()=>{}));
  window.CardOta={get busy(){return Boolean(service()?.snapshot?.().busy);},back(){if(!dialog.open)return false;cancel().catch(()=>{});return true;},
    cancelForBackground:()=>cancel(true).catch(()=>{}),async cancelForModelChange(){const previous=current;off?.();off=null;current=null;state=null;if(dialog.open)dialog.close();await previous?.dispose?.();}};
  bind();
})();
