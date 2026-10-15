// Shared run/stop controls. The selected model supplies validation and execution.
(() => {
  let active=null,starting=false,generation=0;
  const run=document.getElementById('runProgramBtn'),stop=document.getElementById('pauseProgramBtn');
  const notice=text=>window.showExecutionNotice(text);
  function highlight(path) {
    document.querySelectorAll('.program-block.is-executing').forEach(block=>block.classList.remove('is-executing'));
    if(!path)return;
    const block=[...document.querySelectorAll('.program-block[data-node-path]')].find(node=>node.dataset.nodePath===path.join('.'));
    block?.classList.add('is-executing');
  }
  function render() {
    run.disabled=Boolean(active||starting||window.CardBluetooth?.busy||window.CardModelSession?.switching);
    document.body.classList.toggle('program-running',Boolean(active));
    run.setAttribute('aria-label','运行程序');run.title='运行程序';
    stop.setAttribute('aria-label','停止程序');stop.title=window.CardModelSession?.current.execution.kind==='compiled'?'取消上传并请求设备暂停':'停止程序并刹停电机';
    run.classList.add('execution-compile');
    const reported=window.CardModelSession?.current.execution.reportsLifecycle;
    const phase=window.CardBluetooth?.executionPhase;
    run.querySelector('span').textContent=reported?({uploading:'发送中','awaiting-start':'待确认',running:'运行中',stopping:'待停止',unknown:'待确认'}[phase]||(active||starting?'准备中':'运行')):(active?'运行中':starting?'准备中':'运行');
  }
  async function halt(reason='程序已停止') {
    generation++;const previous=active;active=null;starting=false;highlight(null);render();
    if(previous)await previous.stop();
    else if(window.CardModelSession?.current.execution.kind==='compiled'&&window.CardBluetooth?.busy)await window.CardBluetooth.remoteConnection()?.stopProgram();
  }
  async function start() {
    if(active||starting||window.CardBluetooth?.busy||window.CardModelSession?.switching||window.CardModelSession?.selected===false)return;
    const scope=window.CardModelSession?.capture();
    const model=scope?.model;
    const ticket=++generation;
    const valid=()=>ticket===generation&&(!scope||scope.isCurrent());
    starting=true;render();
    try {
      if(model&&window.CardHome?.activeModelId!==model.id)throw new Error('当前作品不属于此设备型号，请重新打开作品。');
      const spec=model?.execution;
      const snapshot=(spec||XiaobaiRunner).validate(program);
      await (model ? model.remote?.close?.() : window.CardRemote?.close());
      if(!valid()||document.hidden||location.hash!=='#editor')return;
      const connection=window.CardBluetooth?.remoteConnection?.();
      if(!connection){notice('请先连接'+(model?.name||'小白')+'。');location.hash='bluetooth';return;}
      const options={connection,signal:scope?.signal,
        isCurrent:()=>(!scope||scope.isCurrent())&&window.CardBluetooth?.remoteConnection?.()?.id===connection.id,
        onProgress:text=>{if(valid()){run.querySelector('span').textContent=text;notice(text+'…');}},
        onStep:(item,path)=>{if(valid()){run.title='正在执行：'+(cardById[item.id]?.label||item.id);highlight(path);}}
      };
      const execution=spec?DeviceModels.createExecution(spec,options):new XiaobaiRunner.Runner(connection,options);
      active=execution;starting=false;render();notice(spec?.reportsLifecycle?'正在准备上传完整程序。':'正在运行'+(model?.name||'小白')+'程序。');
      const result=await execution.run(snapshot);
      if(valid())notice(spec?.completionMessage || (spec?.reportsLifecycle?(result?.state==='completed'?'设备执行完成':'设备已停止'):spec?.kind&&spec.kind!=='stream'?'程序已发送到设备，请查看设备运行状态。':'程序执行完成，电机已停止。'));
    }catch(error){if(valid())notice(error.message||'运行失败');}
    finally{if(valid()){active=null;starting=false;highlight(null);render();}}
  }
  window.addEventListener('device-execution-state',event=>{
    if(event.detail.modelId!==window.CardModelSession?.current.id||window.CardModelSession.switching)return;
    render();notice(event.detail.message);
  });
  run.onclick=start;
  stop.onclick=async()=>{
    const scope=window.CardModelSession?.capture();
    const alreadyStopping=Boolean(active)&&scope?.model.execution.reportsLifecycle;
    try {
      await halt();await (scope?scope.model.remote?.close?.():window.CardRemote?.close());
      if(scope&&!scope.isCurrent())return;
      const connection=window.CardBluetooth?.remoteConnection?.();
      if(connection){if(!alreadyStopping)await connection.stopProgram();if((!scope||scope.isCurrent())&&!connection.stopNeedsConfirmation)notice('已发送停止程序指令。');}
      else notice('设备未连接，请检查设备是否停止。');
    }catch(error){if(!scope||scope.isCurrent())notice(error.message);}
  };
  const cancel=reason=>halt(reason).catch(()=>{});
  window.addEventListener('hashchange',()=>{if(location.hash!=='#editor')cancel('已离开编程页，程序停止');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel('应用进入后台，程序停止');});
  window.addEventListener('pagehide',()=>cancel('程序停止'));
  window.addEventListener('xiaobai-disconnected',()=>cancel('连接断开，程序已取消'));
  window.addEventListener('xiaobai-program-abort',()=>cancel('设备已退出编程模式，程序停止'));
  window.CardProgram={stop:halt,refresh:render,get running(){return Boolean(active||starting);}};
  render();
})();
