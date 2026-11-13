// Shared run/stop controls. The selected model supplies validation and execution.
(() => {
  let active=null,starting=false,generation=0,stopping=0,activeGroupId=null,activeBlockUid=null;
  const groupMarks=new Map();
  let multiRunning=false;
  const run=document.getElementById('runProgramBtn'),stop=document.getElementById('pauseProgramBtn');
  const notice=text=>window.showExecutionNotice(text);
  function executionBlock(path,groupId=activeGroupId,blockUid=activeBlockUid) {
    if(blockUid&&window.CardEditor?.findBlockByUid)return window.CardEditor.findBlockByUid(blockUid);
    if (window.CardEditor) return window.CardEditor.findBlock(path,groupId);
    return [...document.querySelectorAll('.program-block[data-node-path]')].find(node=>node.dataset.nodePath===path.join('.'));
  }
  function highlight(path,groupId=activeGroupId,blockUid=activeBlockUid) {
    if(!path){document.querySelectorAll('.program-block.is-executing').forEach(block=>block.classList.remove('is-executing'));groupMarks.clear();return;}
    if(!multiRunning)document.querySelectorAll('.program-block.is-executing').forEach(block=>block.classList.remove('is-executing'));
    groupMarks.get(groupId)?.classList.remove('is-executing');
    const block=executionBlock(path,groupId,blockUid);
    block?.classList.add('is-executing');
    if(block)groupMarks.set(groupId,block);
  }
  function checkingFirmware() {
    if(window.CardModelSession?.current?.id!=='xiaobai')return null;
    const firmware=window.CardBluetooth?.firmware,state=firmware?.snapshot?.();
    // A passive identity read may explain its status, but cannot start a program.
    // Upgrade/confirmation and learned-command tasks keep their existing locks.
    if(state?.phase!=='checking'||!state.busy||firmware.upgradeOwned||state.session?.busy||
        window.CardBluetooth?.remoteConnection?.()?.learned?.getSnapshot?.().busy)return null;
    return firmware;
  }
  function render() {
    window.CardEditor?.setExecutionLocked?.(Boolean(active||starting||stopping));
    window.CardCanvas?.setRunControlsEnabled?.(Boolean(active?.initialized&&!active.cancelled&&!stopping));
    const checking=checkingFirmware();
    const ownRunBusy=Boolean(active?.toggleGroup&&active.preparedLearned&&
      window.CardBluetooth?.remoteConnection?.()?.id===active.connection?.id);
    run.disabled=Boolean((active&&!active.toggleGroup)||starting||stopping||(!checking&&(window.CardOta?.busy||(window.CardBluetooth?.busy&&!ownRunBusy)))||window.CardModelSession?.switching);
    document.body.classList.toggle('program-running',Boolean(active));
    const reported=window.CardModelSession?.current.execution.reportsLifecycle;
    const phase=window.CardBluetooth?.executionPhase;
    const connected=window.CardBluetooth?.connected!==false;
    const running=reported?connected&&phase==='running':Boolean(active?.toggleGroup?active.running:active);
    const stopActive=running||Boolean(active?.initialized)||Boolean(stopping)||Boolean(reported&&connected&&['stopping','unknown'].includes(phase));
    run.classList.toggle('is-running',running);
    stop.classList.toggle('is-program-active',stopActive);
    run.setAttribute('aria-label',checking?'查看主控核对状态':'运行程序');run.title=checking?'正在核对主控固件，点击查看状态':'运行程序';
    stop.setAttribute('aria-label','停止程序');stop.title=window.CardModelSession?.current.execution.kind==='compiled'?'取消上传并请求设备暂停':'停止程序并刹停电机';
    run.classList.add('execution-compile');
    window.dispatchEvent(new Event('card-program-state'));
    run.querySelector('span').textContent=checking&&!active&&!starting&&!stopping?'核对中':reported?({uploading:'发送中','awaiting-start':'待确认',running:'运行中',stopping:'待停止',unknown:'待确认'}[phase]||(active||starting?'准备中':'运行')):(active?.toggleGroup?(active.running?'运行中':'重新运行'):active?'运行中':starting?'准备中':'运行');
  }
  async function halt(reason='程序已停止') {
    stopping++;generation++;const previous=active;active=null;starting=false;highlight(null);render();
    try{
    if(previous)await previous.stop();
    else if(window.CardBluetooth?.remoteConnection?.()?.learned?.getSnapshot().busy)await window.CardBluetooth.remoteConnection().stopProgram();
    else if(window.CardModelSession?.current.execution.kind==='compiled'&&window.CardBluetooth?.busy)await window.CardBluetooth.remoteConnection()?.stopProgram();
    }finally{stopping--;render();}
  }
  async function start(groupId=null) {
    if(typeof groupId!=='string')groupId=null;
    if(starting||stopping||window.CardModelSession?.switching||window.CardModelSession?.selected===false)return;
    if(active){
      if(!active.toggleGroup)return;
      try{
        if(groupId){await active.toggleGroup(groupId);render();return;}
        await halt('重新开始程序。');
      }catch(error){notice(error.message||'程序操作失败。');return;}
    }
    const checking=checkingFirmware();
    if(checking){
      notice('正在核对主控应用版本。完成后请再次点击运行。');
      try{await checking.ensureReady({interactive:true,reason:'run-status'});}catch(error){notice(error.message||'主控核对未完成，请重试。');}
      return;
    }
    if(window.CardOta?.busy||window.CardBluetooth?.busy)return;
    const scope=window.CardModelSession?.capture();
    const model=scope?.model;
    const ticket=++generation;
    const valid=()=>ticket===generation&&(!scope||scope.isCurrent());
    let failedPath=null,failedGroupId=null,failedBlockUid=null,sessionOpen=false;
    activeBlockUid=null;multiRunning=false;
    highlight(null);starting=true;render();
    try {
      if(model&&window.CardHome?.activeModelId!==model.id)throw new Error('当前作品不属于此设备型号，请重新打开作品。');
      const spec=model?.execution;
      const pin=window.XiaobaiFirmwareBundle?.METADATA;
      const multiPinned=model?.id==='xiaobai'&&window.XiaobaiMultiProgram?.releaseSupports(pin);
      if(model?.id==='xiaobai' && !multiPinned && pin?.bound && window.CardEditor?.getRunSnapshot) {
        if(!window.XiaobaiMultiProgram?.releaseUsesLegacy(pin))
          throw new Error('本 App 尚未支持该主控的程序运行协议，请核对 App 和主控版本。');
        const requested = window.CardEditor.getRunSnapshot({groupId,all:!groupId});
        if(requested.groups.length > 1 || window.XiaobaiMultiProgram?.hasMessages(requested))
          throw new Error('本 App 对应的主控版本尚未支持多组或消息程序。');
      }
      multiRunning=Boolean(multiPinned);
      const selected=multiPinned?null:window.CardEditor?.getExecutionGroup(groupId);
      activeGroupId=selected?.groupId||null;
      const snapshot=multiPinned?XiaobaiMultiProgram.validateSnapshot(window.CardEditor.getRunSnapshot({groupId,all:!groupId})):(spec||XiaobaiRunner).validate(selected?.items||program);
      await (model ? model.remote?.close?.() : window.CardRemote?.close());
      if(!valid()||document.hidden||location.hash!=='#editor')return;
      const firmware=window.CardBluetooth?.firmware;
      if(firmware?.hasRecovery?.()&&!window.CardBluetooth?.connected&&!await firmware.ensureReady({interactive:true,reason:'run'}))return;
      const connection=window.CardBluetooth?.remoteConnection?.();
      if(!connection){notice('请先连接'+(model?.name||'小白')+'。');location.hash='bluetooth';return;}
      if(connection.ensureFirmware&&!await connection.ensureFirmware({interactive:true,reason:'run'}))return;
      if(!valid()||document.hidden||location.hash!=='#editor')return;
      if(multiPinned&&(!connection.multiProgram||!XiaobaiMultiProgram.releaseAllows(pin,connection.firmware||firmware)))throw new Error('请先进入编程模式并核对本 App 对应的主控版本。');
      const options={connection,signal:scope?.signal,
        isCurrent:()=>(!scope||scope.isCurrent())&&window.CardBluetooth?.remoteConnection?.()?.id===connection.id,
        onActivity:()=>{if(valid()){
          if(active?.cancelled){const error=active.error;active=null;highlight(null);if(error)notice(error.message);}
          render();
        }},
        onProgress:text=>{if(valid()){run.querySelector('span').textContent=text;notice(text+'…');}},
        onStep:(item,path,runningGroupId=activeGroupId)=>{if(valid()){activeBlockUid=item.uid||null;run.title='正在执行：'+(cardById[item.id]?.label||item.id);highlight(path,runningGroupId,activeBlockUid);}},
        onGroupState:(id,state)=>{if(valid()&&(state==='DONE'||state==='IDLE')){groupMarks.get(id)?.classList.remove('is-executing');groupMarks.delete(id);}}
      };
      const execution=multiPinned?new XiaobaiMultiProgram.SessionCoordinator(connection,options):spec?DeviceModels.createExecution(spec,options):new XiaobaiRunner.Runner(connection,options);
      active=execution;starting=false;render();notice(spec?.reportsLifecycle?'正在准备上传完整程序。':'正在运行'+(model?.name||'小白')+'程序。');
      const result=await execution.run(snapshot);
      sessionOpen=Boolean(result?.sessionOpen);
      if(sessionOpen&&valid())notice('脚本已执行完，可以继续触发消息或点击程序组。');
      else if(valid())notice(spec?.completionMessage || (spec?.reportsLifecycle?(result?.state==='completed'?'设备执行完成':'设备已停止'):spec?.kind&&spec.kind!=='stream'?'程序已发送到设备，请查看设备运行状态。':'程序执行完成，电机已停止。'));
    }catch(error){if(valid()){
      failedPath=error.path||null;failedGroupId=error.groupId||activeGroupId;failedBlockUid=error.blockUid||null;notice(error.message||'运行失败');
      if(failedPath){
        const block=executionBlock(failedPath,failedGroupId,failedBlockUid);
        if(window.CardCanvas&&block?.dataset.nodeUid)window.CardCanvas.focusNode(block.dataset.nodeUid);
        else block?.scrollIntoView?.({block:'nearest',inline:'nearest'});
      }
    }}
    finally{if(valid()){if(!sessionOpen)active=null;starting=false;highlight(null);if(failedPath)highlight(failedPath,failedGroupId,failedBlockUid);render();}}
  }
  window.addEventListener('device-execution-state',event=>{
    if(event.detail.modelId!==window.CardModelSession?.current.id||window.CardModelSession.switching)return;
    render();notice(event.detail.message);
  });
  run.onclick=start;
  stop.onclick=async()=>{
    const scope=window.CardModelSession?.capture();
    const connection=window.CardBluetooth?.remoteConnection?.();
    const alreadyStopping=Boolean(active||connection?.learned?.getSnapshot().busy||window.CardBluetooth?.busy);
    stopping++;render();
    try {
      // Only the user's stop button cancels OTA. CardProgram.stop() is also used
      // internally when OTA quiesces the existing program before taking the link.
      if(window.CardOta?.busy)await window.CardBluetooth?.firmware?.cancel({reason:'程序已停止，升级已取消。'});
      await halt();await (scope?scope.model.remote?.close?.():window.CardRemote?.close());
      if(scope&&!scope.isCurrent())return;
      if(connection&&connection.id===window.CardBluetooth?.remoteConnection?.()?.id){if(!alreadyStopping)await connection.stopProgram();if((!scope||scope.isCurrent())&&!connection.stopNeedsConfirmation)notice('已发送停止程序指令。');}
      else notice('设备未连接，请检查设备是否停止。');
    }catch(error){if(!scope||scope.isCurrent())notice(error.message);}
    finally{stopping--;render();}
  };
  const cancel=reason=>{
    const wasBusy=Boolean(active||starting||window.CardLearnedCommands?.open);
    halt(reason).then(()=>{if(wasBusy)notice(reason);}).catch(error=>{if(wasBusy)notice(error.message||reason);});
  };
  window.addEventListener('hashchange',()=>{if(location.hash!=='#editor')cancel('已离开编程页，程序停止');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel('应用进入后台，程序停止');});
  window.addEventListener('pagehide',()=>cancel('程序停止'));
  window.addEventListener('xiaobai-disconnected',()=>cancel('连接断开，程序已取消'));
  window.addEventListener('xiaobai-program-abort',event=>{
    const detail=event?.detail||{};
    const reasons={1:'设备心跳中断，程序已停止。',2:'蓝牙已断开，程序已停止。',3:'设备按键中止了程序。',
      4:'设备模式已切换，程序已停止。',5:'收到语音停止口令，程序已停止。',6:'语音设备异常或等待超时，程序已停止。',7:'加速度传感器不可用，程序已停止。'};
    cancel(detail.reason || (detail.code===2&&reasons[detail.data?.[0]]) || '设备已退出编程模式，程序已停止。');
  });
  window.CardProgram={stop:halt,runGroup:groupId=>start(groupId),refresh:render,get canToggleGroups(){return Boolean(active?.initialized&&!active.cancelled&&!stopping);},get running(){return Boolean(active||starting||stopping);}};
  render();
})();
