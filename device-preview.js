// Browser preview intentionally never uses the legacy Spark upload protocol.
window.createModelBluetoothPreview = model => {
  const page=CardBluetoothPage.create(model,{className:'bt-browser-preview'}),$=s=>page.querySelector(s);
  $('#btReadySummary').textContent='网页预览';
  $('.bt-message').textContent='蓝牙连接、遥控和程序执行请在 Android APP 中验证。';
  $('.bt-empty strong').textContent='在手机上连接设备';
  $('.bt-empty > span:last-child').textContent='手机 APP 会在这里显示附近的主机';
  for(const selector of ['.bt-search','#btSystemSettings','#btAccess','#btLocationSettings'])$(selector).disabled=true;
  $('#btRadioState').textContent='请在手机 APP 中查看';$('#btPermissionState').textContent='请在手机 APP 中查看';
  document.body.append(page);
  const route=()=>{page.hidden=location.hash!=='#bluetooth';document.body.classList.toggle('bluetooth-open',!page.hidden);if(page.hidden)CardBluetoothPage.closePanels(page);};
  page.querySelector('button').onclick=()=>window.CardBluetoothBack();
  document.getElementById('bluetoothBtn').onclick=()=>window.CardOpenBluetooth('#editor');
  window.addEventListener('hashchange',route);window.addEventListener('card-bluetooth-route',route);route();
  return {ensureConnected:async()=>false,enterProgram:async()=>{},enterRemote:async()=>{},remoteConnection:()=>null,connected:false,
    async dispose(){page.remove();window.removeEventListener('hashchange',route);window.removeEventListener('card-bluetooth-route',route);document.body.classList.remove('bluetooth-open');}};
};
