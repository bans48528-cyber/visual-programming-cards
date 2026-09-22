(() => {
  let active=null,starting=false,stopReason='',generation=0;
  const run=document.getElementById('runProgramBtn'),stop=document.getElementById('pauseProgramBtn');
  const notice=text=>window.showExecutionNotice(text);
  function render() {
    run.disabled=Boolean(active||starting);
    document.body.classList.toggle('program-running',Boolean(active));
    run.setAttribute('aria-label','运行小白程序');run.title='在手机上运行程序';
    stop.setAttribute('aria-label','停止程序');stop.title='停止程序并刹停电机';
    run.classList.add('execution-compile');run.querySelector('span').textContent=active?'运行中':'运行';
  }
  async function halt(reason='程序已停止') {
    generation++;
    stopReason=reason;
    if(active) {
      try {await active.stop();} catch(error) {notice(error.message);throw error;}
    }
  }
  async function start() {
    if(active||starting) return;
    const ticket=++generation;
    starting=true;render();
    try {
      const snapshot=XiaobaiRunner.validate(program);
      await window.CardRemote?.close();
      if(ticket!==generation || document.hidden || location.hash!=='#editor') return;
      const connection=window.CardBluetooth?.remoteConnection?.();
      if(!connection) {notice('请先连接小白。');location.hash='bluetooth';return;}
      stopReason='';
      const runner=new XiaobaiRunner.Runner(connection,{
        isCurrent:()=>window.CardBluetooth?.remoteConnection?.()?.id===connection.id,
        onStep:item=>{run.title='正在执行：'+(cardById[item.id]?.label||item.id);}
      });
      active=runner;render();notice('正在运行小白程序。');
      try {await runner.run(snapshot);notice(stopReason||'程序执行完成，电机已停止。');}
      finally {if(active===runner) active=null;}
    } catch(error) {notice(error.message||'运行失败');}
    finally {starting=false;render();}
  }
  run.onclick=start;
  stop.onclick=async()=>{
    try {
      await halt();await window.CardRemote?.close();
      const connection=window.CardBluetooth?.remoteConnection?.();
      if(connection) {await connection.stopProgram();notice('已发送停止程序指令。');}
      else notice('设备未连接，请检查小白是否停止。');
    } catch(error) {notice(error.message);}
  };
  const cancel=reason=>halt(reason).catch(()=>{});
  window.addEventListener('hashchange',()=>{if(location.hash!=='#editor') cancel('已离开编程页，程序停止');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden) cancel('应用进入后台，程序停止');});
  window.addEventListener('pagehide',()=>cancel('程序停止'));
  window.addEventListener('xiaobai-disconnected',()=>cancel('连接断开，程序已取消'));
  window.addEventListener('xiaobai-program-abort',()=>cancel('设备已退出编程模式，程序停止'));
  window.CardProgram={stop:halt,get running(){return Boolean(active||starting);}};
  render();
})();
