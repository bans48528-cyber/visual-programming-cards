// Shared presentation only. Model adapters retain ownership of BLE and connection lifecycles.
window.CardBluetoothPage = (() => {
  const icons = {
    back:'<path d="m14 6-6 6 6 6"/>',
    settings:'<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  function create(model,{diagnostics=false,className=''}={}) {
    const page=document.createElement('section');
    page.className=`bluetooth-page android-bluetooth bt-landscape ${className}`;page.dataset.modelId=model.id;page.hidden=true;
    page.innerHTML=`<header class="bt-top"><button class="bt-back" type="button" aria-label="返回">${icon('back')}</button><h1>连接主机</h1>
      <button class="bt-phone-state" type="button" aria-label="手机连接设置"><span class="bt-ready"><span aria-hidden="true"></span><strong id="btReadySummary">正在检查手机状态</strong></span>${icon('settings')}</button></header>
      <main class="bt-mobile-layout"><aside class="bt-phone-panel"><div class="bt-product-art"><img alt=""></div><h2 class="bt-model-name"></h2>
        <div class="bt-hero-state" role="status"><i aria-hidden="true"></i><span>尚未连接</span></div><p class="bt-hero-note">打开主机电源，保持在手机附近</p></aside>
      <section class="bt-device-panel" aria-label="蓝牙设备"><div class="bt-section-header"><div><h2>附近设备 <span class="bt-device-count"></span></h2><span class="bt-scan-description">优先连接你的默认设备</span></div><button class="bt-button bt-search" type="button">扫描设备</button></div>
        <p class="bt-message" role="status" aria-live="polite">有默认设备时，APP 会优先自动连接。</p>
        <div class="bt-results"><section class="bt-current" hidden aria-label="当前连接"><div><span class="bt-eyebrow">当前设备</span><h2></h2><p role="status"></p></div><div class="bt-device-actions"><button class="bt-button bt-rename-current" type="button" aria-label="重命名当前设备" title="重命名">⋯</button><button class="bt-button" id="btDisconnect" type="button">断开</button></div></section>
        <ul class="bt-list" aria-label="扫描结果"></ul><div class="bt-empty"><span class="bt-radar" aria-hidden="true"></span><strong>尚未扫描</strong><span>打开主机电源后开始扫描</span></div></div>
      </section></main>
      <footer class="bt-footer"><p class="bt-stage-note"></p><button type="button" class="bt-help">连接帮助 <span aria-hidden="true">›</span></button></footer>
      <dialog class="bt-sheet bt-settings-dialog" aria-label="手机连接设置"><header><h2>手机连接设置</h2><button type="button" class="bt-sheet-close" aria-label="关闭设置">${icon('close')}</button></header>
        <details class="bt-settings" open><summary>手机连接设置</summary><div class="bt-setting-list">
          <div class="bt-setting-row"><div><span>手机蓝牙</span><strong id="btRadioState">检查中</strong></div><button class="bt-button" id="btSystemSettings" type="button">蓝牙设置</button></div>
          <div class="bt-setting-row"><div><span>扫描权限</span><strong id="btPermissionState">检查中</strong></div><button class="bt-button" id="btAccess" type="button">允许扫描</button></div>
          <div class="bt-location" hidden><p>旧版 Android 扫描需要开启系统定位，APP 不读取地理位置。</p><button class="bt-button" id="btLocationSettings" type="button">定位设置</button></div>
        </div></details><p class="bt-sheet-note">允许蓝牙扫描后，返回列表选择要连接的主机。</p></dialog>
      <dialog class="bt-sheet bt-help-dialog" aria-label="连接帮助"><header><h2>连接帮助</h2><button type="button" class="bt-sheet-close" aria-label="关闭帮助">${icon('close')}</button></header>
        <ol><li>确认主机已开机，保持在手机附近。</li><li>先断开其他手机或实体遥控器，再重新扫描。</li><li>仍找不到设备时，检查手机蓝牙与扫描权限。</li></ol><p class="bt-model-help"></p>
        ${diagnostics?'<details class="bt-diagnostics"><summary>查看连接诊断</summary><pre class="bt-trace" tabindex="0"></pre><button class="bt-button bt-copy" type="button">复制诊断信息</button></details>':''}
        <button type="button" class="bt-button bt-help-settings">手机连接设置</button></dialog>
      <dialog class="bt-rename-dialog"><form method="dialog"><h2>设备名称</h2><p>名称只保存在这台手机，不会修改设备广播名称。</p><input maxlength="24" autocomplete="off" aria-label="自定义设备名称"><div><button value="cancel" type="submit">取消</button><button value="confirm" type="submit" class="primary">保存</button></div></form></dialog>`;
    const $=s=>page.querySelector(s);
    $('.bt-product-art img').src=model.image;$('.bt-product-art img').alt=model.name;$('.bt-model-name').textContent=model.name;
    const note=model.bluetooth.configurationNotice?.();
    const hint=note?note+'。确认后可连接；暂可编辑程序。':model.bluetooth.connectionHint||`手机与实体遥控器不能同时连接${model.name}。`;
    $('.bt-stage-note').textContent=hint;$('.bt-model-help').textContent=hint;
    $('.bt-phone-state').onclick=()=>$('.bt-settings-dialog').showModal();
    $('.bt-help').onclick=()=>$('.bt-help-dialog').showModal();
    $('.bt-help-settings').onclick=()=>{$('.bt-help-dialog').close();$('.bt-settings-dialog').showModal();};
    page.querySelectorAll('.bt-sheet').forEach(dialog=>dialog.querySelector('.bt-sheet-close').onclick=()=>dialog.close());
    return page;
  }
  function status(page,{connected=false,connecting=false,scanning=false,count=0}={}) {
    const hero=page.querySelector('.bt-hero-state');
    hero.classList.toggle('is-connected',connected);hero.classList.toggle('is-busy',connecting||scanning);
    hero.querySelector('span').textContent=connected?'已连接':connecting?'正在连接…':scanning?'正在扫描…':'尚未连接';
    page.querySelector('.bt-hero-note').textContent=connected?'已记为默认设备，下次优先连接':'打开主机电源，保持在手机附近';
    page.querySelector('.bt-device-count').textContent=count||'';
    page.querySelector('.bt-current').classList.toggle('is-pending',connecting&&!connected);
  }
  function device(row,entry,{name,isDefault=false}={}) {
    row.classList.toggle('is-default',isDefault);
    const title=row.querySelector('strong');title.textContent=name;
    if(isDefault){const badge=document.createElement('span');badge.className='bt-default-badge';badge.textContent='默认';title.append(badge);}
    const level=entry.rssi>=-60?4:entry.rssi>=-75?3:entry.rssi>=-90?2:1;
    let signal=row.querySelector('.bt-signal');
    if(!signal){signal=document.createElement('span');signal.className='bt-signal';row.prepend(signal);}
    signal.replaceChildren(...Array.from({length:4},(_,i)=>{const bar=document.createElement('i');bar.style.height=`${5+i*4}px`;bar.classList.toggle('lit',i<level);return bar;}));
    signal.setAttribute('aria-label',`信号${['','较弱','一般','良好','很强'][level]}`);
    row.querySelector('small').textContent=`${entry.name||entry.deviceId.slice(-8)} · 信号${['','较弱','一般','良好','很强'][level]}`;
    row.title=`${entry.name||''} · ${entry.deviceId} · ${entry.rssi} dBm`;
    const rename=row.querySelector('.bt-rename');
    if(rename){rename.textContent='⋯';rename.setAttribute('aria-label',`重命名 ${name}`);rename.title='重命名';row.querySelector('.bt-device-actions').append(rename);}
  }
  function closePanels(page){page.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close('cancel'));}
  return {create,status,device,closePanels};
})();
