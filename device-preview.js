// Browser preview intentionally never uses the legacy Spark upload protocol.
window.createModelBluetoothPreview = model => {
  const page=document.createElement('section');page.className='bluetooth-page model-bluetooth-preview';page.hidden=true;
  page.innerHTML='<header class="bt-top"><button class="bt-back" type="button">‹ 返回</button><h1></h1></header><main><img alt=""><h2>在手机上连接设备</h2><p>当前是网页预览，可以查看界面和编辑作品。<br>蓝牙连接、遥控和程序执行请在 Android APP 中验证。</p></main>';
  page.querySelector('h1').textContent='连接'+model.name;page.querySelector('img').src=model.image;
  document.body.append(page);
  const route=()=>{page.hidden=location.hash!=='#bluetooth';document.body.classList.toggle('bluetooth-open',!page.hidden);};
  page.querySelector('button').onclick=()=>{location.hash='editor';};
  document.getElementById('bluetoothBtn').onclick=()=>{location.hash='bluetooth';};
  window.addEventListener('hashchange',route);window.addEventListener('card-bluetooth-route',route);route();
  return {ensureConnected:async()=>false,enterProgram:async()=>{},enterRemote:async()=>{},remoteConnection:()=>null,connected:false,
    async dispose(){page.remove();window.removeEventListener('hashchange',route);window.removeEventListener('card-bluetooth-route',route);document.body.classList.remove('bluetooth-open');}};
};
