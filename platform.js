// Capacitor injects its bridge before these shared scripts run. Desktop stays unchanged.
(() => {
  const isAndroid = window.Capacitor?.getPlatform() === 'android';
  window.CardPlatform = Object.freeze({isAndroid, hardwareAvailable: !isAndroid});
  if (!isAndroid) return;
  document.documentElement.classList.add('android-app');

  function save() {
    // Do not overwrite an active project while its home thumbnail is being viewed.
    if (!document.body.classList.contains('home-open')) {
      if (window.CardHome?.autosave) window.CardHome.autosave();
      else window.CardHome?.save();
    }
  }
  function suspend() {
    window.CardProgram?.stop("应用进入后台，程序停止").catch(()=>{});
    window.CardRemote?.close();
    cancelDrag();
    finishParameters();
    save();
  }
  function finishParameters() {
    // Only confirmed numbers are saved; unfinished keypad drafts are discarded.
    if (document.activeElement?.closest('#paramEditor')) document.activeElement.blur();
    if (matrixPaintState) endMatrixPaint({pointerId: matrixPaintState.pointerId});
    closeParamEditor();
  }
  async function back(app) {
    const dialog = document.querySelector('dialog[open]');
    if (dialog) { dialog.close(); return; }
    if (closeNumberKeypad()) return;
    if (!document.getElementById('paramEditor').hidden) { finishParameters(); return; }
    cancelDrag();
    const menu = document.querySelector('.home-menu[open]');
    if (menu) { menu.open = false; return; }
    if (location.hash === '#bluetooth') { location.hash = 'editor'; return; }
    if (location.hash === '#editor') {
      document.getElementById('homeBtn').click();
      return;
    }
    await app.minimizeApp();
  }
  // Save each completed edit, including undo/redo, before Android can kill the process.
  document.addEventListener('card-workspace-changed', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
  window.addEventListener('pagehide', save);
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const app = window.Capacitor.registerPlugin('App');
      await app.addListener('backButton', () => { back(app).catch(console.error); });
      await app.addListener('appStateChange', ({isActive}) => { if (!isActive) suspend(); });
      await app.addListener('pause', suspend);
    } catch (error) {
      console.error('Android lifecycle setup failed', error);
      window.showExecutionNotice?.('系统返回键初始化失败，请使用界面上的返回按钮。');
    }
  });
})();
