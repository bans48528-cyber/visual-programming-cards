/* Phone-side program counters; hardware ownership lives in the C4 device session. */
(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./xiaobai-runner.js') : root.XiaobaiRunner,
    typeof module === 'object' && module.exports ? require('./xiaobai-protocol.js') : root.XiaobaiProtocol,
    typeof module === 'object' && module.exports ? require('./xiaobai-condition-protocol.js') : root.XiaobaiConditionProtocol);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XiaobaiMultiProgram = api;
})(globalThis, function(Legacy, P, Conditions) {
  'use strict';
  let owner = null;
  const Flow=Legacy.controlFlow;
  function failure(message, code = 'PROGRAM') { return Object.assign(new Error(message), {code}); }
  function immutable(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
    return value;
  }
  const messageNumber = value => Number.isInteger(value) && value >= 1 && value <= 6;
  function hasMessages(snapshot) {
    const seen = new Set();
    const visit = items => Array.isArray(items) && items.some(item => {
      if (!item || typeof item !== 'object' || seen.has(item)) return false;
      seen.add(item); return item.id === 'send-message' || visit(item.children);
    });
    return (snapshot?.groups || []).some(group => group.trigger?.type === 'message' || visit(group.items));
  }
  function validationItem(item) {
    const copy = {...item};
    if (item.id === 'send-message') { copy.id = 'wait-time'; copy.params = {duration: .001}; }
    if (Array.isArray(item.children)) copy.children = item.children.map(validationItem);
    return copy;
  }
  function validateSnapshot(input) {
    let snapshot;
    try { snapshot = JSON.parse(JSON.stringify(input)); } catch (_) { throw failure('运行快照无效。', 'SNAPSHOT'); }
    if (!snapshot || snapshot.modelId !== 'xiaobai' || !Array.isArray(snapshot.groups) ||
        !snapshot.groups.length || snapshot.groups.length > 4) throw failure('小白一次最多运行4个带开始头的程序组。', 'GROUP_LIMIT');
    if(snapshot.groups.some(group=>!group||typeof group!=='object'||Array.isArray(group)))throw failure('运行快照的程序组结构无效。','SNAPSHOT');
    const ids = new Set(); let count = 0,observerBudget=0;
    function unique(id) { if (typeof id !== 'string' || !id || ids.has(id)) throw failure('运行快照包含缺失或重复的积木身份。', 'IDENTITY'); ids.add(id); }
    snapshot.groups.sort((a,b) => a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0);
    for (const group of snapshot.groups) {
      unique(group.groupId); unique(group.startId);
      if (group.trigger !== undefined && (!group.trigger || group.trigger.type !== 'message' || !messageNumber(group.trigger.message)))
        throw Object.assign(failure('消息开始头请选择消息1至6。','MESSAGE'),{groupId:group.groupId});
      function visit(items, path = [], depth = 0) {
        if(!Array.isArray(items)||depth>20)throw Object.assign(failure('程序结构无效或循环嵌套过深。','STRUCTURE'),{groupId:group.groupId,path});
        items.forEach((item,index) => {
          const current = [...path,index];
          try {
            unique(item?.uid); if (++count > 1000) throw failure('本次运行合计最多1000块积木。', 'BLOCK_LIMIT');
            if (item.children) visit(item.children,current,depth+1);
            if (item.id === 'send-message' && !messageNumber(item.params?.message)) throw failure('发送消息请选择消息1至6。','MESSAGE');
            // Validation-only substitution; the immutable executable snapshot
            // still contains send-message, and never executes this wait.
            Legacy.validate([validationItem(item)]);
          } catch(error) { if(!error.groupId)Object.assign(error,{groupId:group.groupId,blockUid:error.blockUid||item?.uid,path:[...current,...(error.path?.slice(1)||[])]}); throw error; }
        });
      }
      visit(group.items);
      observerBudget+=Flow.validateLoops(group.items).maxObserverDepth;
      if(observerBudget>16)throw failure('本次运行最多同时启用16个条件观察器。','OBSERVER_LIMIT');
      if(!group.items.length)throw Object.assign(failure('请先在开始头后连接积木。','EMPTY'),{groupId:group.groupId});
    }
    if (snapshot.manualGroupId !== undefined && (typeof snapshot.manualGroupId !== 'string' || !snapshot.groups.some(group=>group.groupId===snapshot.manualGroupId)))
      throw failure('手动运行的程序组不存在。','MANUAL_GROUP');
    snapshot.launchOrder = snapshot.manualGroupId !== undefined ? [snapshot.manualGroupId]
      : snapshot.groups.filter(group=>!group.trigger).map(group=>group.groupId);
    if (!snapshot.launchOrder.length) throw failure('没有普通开始头，请添加普通开始头或单独点击消息开始头测试。','NO_NORMAL_GROUP');
    return immutable(snapshot);
  }
  function releaseSupports(metadata) {
    const target = metadata?.firmware;
    return Boolean(metadata?.bound && target?.boardId === 258 && target.protocol === 1 &&
      Legacy.supportsCompactStart(target.version));
  }
  function releaseUsesLegacy(metadata) {
    const target = metadata?.firmware;
    return Boolean(metadata?.bound && target?.boardId === 258 && target.protocol === 1 &&
      Number.isInteger(target.version) && target.version > 0 && target.version < Legacy.FIRST_COMPACT_START_VERSION);
  }
  function releaseAllows(metadata, firmware) {
    const state = typeof firmware?.snapshot === 'function' ? firmware.snapshot() : firmware;
    return releaseSupports(metadata) && Legacy.compactProgramReady(state, metadata.firmware.version);
  }
  function requireProgramReady(connection) {
    if (!Legacy.compactProgramReady(connection?.firmware?.snapshot?.()))
      throw failure('请先进入编程模式并核对本 App 对应的主控版本。', 'FIRMWARE');
    return true;
  }
  function command(item, context) {
    const p = item.params || {}, id = item.id, O = P.OP;
    const motor = ['L','L/M1'].includes(p.port) ? 0 : 1;
    const move = {'combo-forward':1,'combo-turn-left':2,'combo-turn-right':3,'combo-backward':4};
    const milliseconds = seconds => {
      const value = Math.round(seconds * 1000);
      if (!Number.isInteger(value) || value < 1 || value > 0x7fffffff) throw failure('动作时长超出多组协议范围。','DURATION');
      return P.milliseconds(seconds);
    };
    let opcode, args, timeoutMs;
    if (['motor-forward','motor-reverse'].includes(id)) { opcode=O.MOTOR_TIME;args=[motor,id.includes('reverse')?2:1,...milliseconds(p.duration)];timeoutMs=p.duration*1000+5000; }
    else if (['motor-forward-continuous','motor-reverse-continuous'].includes(id)) { opcode=O.MOTOR_RUN;args=[motor,id.includes('reverse')?2:1]; }
    else if (id==='motor-stop') { opcode=O.MOTOR_STOP;args=[motor]; }
    else if (id==='motor-power') { opcode=O.MOTOR_POWER;args=[Number(p.power)]; }
    else if (move[id]) { opcode=O.MOVE_TIME;args=[move[id],...milliseconds(p.duration)];timeoutMs=p.duration*1000+5000; }
    else if (id==='combo-continuous') { opcode=O.MOVE_RUN;args=[{advance:1,left:2,right:3,retreat:4}[p.direction]]; }
    else if (id==='combo-stop') { opcode=O.MOVE_STOP;args=[]; }
    else if (id==='combo-power'||id==='speed-up'||id==='speed-down') {
      context.comboPower=id==='combo-power'?Number(p.power):Math.max(1,Math.min(3,context.comboPower+(id==='speed-up'?1:-1)));
      opcode=O.MOVE_POWER;args=[context.comboPower];
    } else if (id==='infrared-wait') { opcode=O.WAIT_IR;args=[1,p.comparison==='greater'?0:1,p.threshold]; }
    else if (id==='tilt-wait') { opcode=O.WAIT_TILT;args=[P.TILT_DIRECTIONS[p.direction]]; }
    else if (id==='motion-wait') { opcode=O.WAIT_MOTION;args=[P.MOTION_TARGETS[p.state]]; }
    else if (id==='eye-expression') { opcode=O.SHOW_EYE;args=[Number(p.expression.slice(-2))]; }
    else if (id==='display-number') { opcode=O.SHOW_NUM;args=[p.value]; }
    else if (id==='display-off') { opcode=O.SHOW_OFF;args=[]; }
    else if (id==='eye-matrix') { opcode=O.SHOW_MATRIX;args=P.matrixChunks(0,p.leftPattern,p.rightPattern).flatMap(chunk=>chunk.slice(2)).slice(0,16); }
    else if (id==='speech-play') { opcode=O.PLAY_VOICE;args=[Number(p.phrase.slice(-2))]; }
    else if (id==='speech-wait') { opcode=O.WAIT_VOICE;args=[Number(p.phrase.slice(-2))]; }
    else if (id==='self-learned-wait') { opcode=O.WAIT_LEARNED;args=[p.slot]; }
    else throw failure('多组执行不支持此积木：'+id,'BLOCK');
    return {opcode,args,timeoutMs};
  }
  class SessionCoordinator {
    constructor(connection, {createClient,isCurrent=()=>true,onStep=()=>{},onGroupState=()=>{},signal} = {}) {
      this.connection=connection;this.createClient=createClient || (options=>connection.multiProgram.createClient(options));
      this.isCurrent=isCurrent;this.onStep=onStep;this.onGroupState=onGroupState;this.signal=signal;
      this.cancelled=false;this.error=null;this.client=null;this.waiters=new Set();this.states=new Map();
      this.done=null;this.stopPromise=null;this.preparedLearned=false;
      this.taskContexts=new Map();this.leaseContexts=new Map();this.finished=false;this.observers=null;this.observerContexts=new Map();
      this.messageRecords=new Map();this.messageWorkers=new Set();this.messageScheduling=false;
    }
    check() {
      if (this.error) throw this.error;
      if (this.cancelled||this.signal?.aborted||!this.isCurrent()) throw failure('多组程序已取消，不能在重连后续跑。','CANCELLED');
    }
    state(group, state) { this.states.set(group.groupId,state);if(!this.cancelled&&this.isCurrent())this.onGroupState(group.groupId,state); }
    delay(ms) {
      this.check();return new Promise((resolve,reject)=>{
        const wake=()=>{clearTimeout(timer);this.waiters.delete(wake);try{this.check();resolve();}catch(error){reject(error);}};
        const timer=setTimeout(wake,ms);this.waiters.add(wake);
      });
    }
    awaitControl(promise) {
      const pending=Promise.resolve(promise);pending.catch(()=>{});
      this.check();
      return new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(fn,value)=>{if(settled)return;settled=true;this.waiters.delete(wake);fn(value);};
        const wake=()=>{try{this.check();}catch(error){finish(reject,error);}};
        this.waiters.add(wake);
        pending.then(value=>finish(resolve,value),error=>finish(reject,error));
      });
    }
    fail(error) {
      if(this.finished)return Promise.resolve();
      if(error && !error.blockUid) {
        const key=`${error.group ?? error.groupToken}:${error.task}`;
        const original=this.leaseContexts.get(key)||this.taskContexts.get(key);
        if(original)Object.assign(error,original);
      }
      if (!this.error) this.error=error instanceof Error?error:failure(String(error));
      this.cancelled=true;this.observers?.cancel(this.error);for(const wake of [...this.waiters])wake();
      return this.stopDevice();
    }
    stopDevice() {
      if (!this.stopPromise) this.stopPromise=Promise.resolve().then(()=>this.client?.stop(this.error?.message||'程序已停止。'));
      // Every caller may observe the rejection; prevent unhandled late failures.
      this.stopPromise.catch(()=>{});return this.stopPromise;
    }
    async stop(reason='程序已停止。') {
      await this.fail(failure(reason,'CANCELLED')).catch(error=>{this.stopError=error;});
      if(this.done)await this.done.catch(()=>{});
      if(this.stopError)throw this.stopError;
    }
    async observe(group,context,item,path){
      try{
        const handle=await this.observers.arm(context.token,Conditions.condition(item),context.invocationId ? {runId:context.invocationId} : undefined);
        const key=context.invocationId ? `${context.token}:${context.invocationId}:${handle.id}` : `${context.token}:${handle.id}`;
        this.observerContexts.set(key,{groupId:group.groupId,blockUid:item.uid,path:path.slice()});
        return {get matched(){return handle.matched;},check:()=>handle.check(),refresh:()=>handle.refresh(),close:async options=>{
          try{return await handle.close(options);}finally{this.observerContexts.delete(key);}
        }};
      }catch(error){if(!error.groupId)Object.assign(error,{groupId:group.groupId,blockUid:item.uid,path:path.slice()});throw error;}
    }
    async sequence(group, context, items, parentPath=[]) {
      for (let index=0;index<items.length;index++) {
        this.check();const item=items[index],path=[...parentPath,index];context.current={item,path};
        this.onStep(item,path,group.groupId);
        const p=item.params||{};
        try {
          if(Flow.isLoop(item)) {
            await Flow.runLoop(item,()=>this.sequence(group,context,item.children,path),{check:()=>this.check(),delay:ms=>this.delay(ms),observe:loop=>this.observe(group,context,loop,path)});
          } else if(item.id==='wait-time') { this.state(group,'WAIT_TIMER');await this.delay(p.duration*1000); }
          else if(item.id==='send-message') this.dispatchMessage(p.message);
          else {
            const action=command(item,context);this.state(group,'WAIT_DEVICE');
            const remember=info=>{
              if(!info?.task||this.finished)return;
              const key=`${context.token}:${info.task}`,original={groupId:group.groupId,blockUid:item.uid,path:path.slice()};
              this.taskContexts.set(key,original);
              if(info.state===4&&[P.OP.MOTOR_RUN,P.OP.MOVE_RUN,P.OP.PLAY_VOICE].includes(action.opcode))this.leaseContexts.set(key,original);
              if([3,5,6,7,8].includes(info.state))this.leaseContexts.delete(key);
              while(this.taskContexts.size>64)this.taskContexts.delete(this.taskContexts.keys().next().value);
            };
            const pending=this.client.action(context.token,action.opcode,action.args,{timeoutMs:action.timeoutMs,onDispatched:remember,onAccepted:remember,onState:remember,
              ...(context.invocationId ? {invocationId:context.invocationId} : {})});
            if(context.invocationId)await this.awaitControl(pending);else await pending;
          }
          this.check();this.state(group,'RUNNING');await this.delay(0);
        } catch(error) {
          if(!error.groupId&&!Object.prototype.hasOwnProperty.call(error,'group'))Object.assign(error,{groupId:group.groupId,blockUid:item.uid,path});throw error;
        }
      }
    }
    dispatchMessage(message) {
      this.check();
      if(!messageNumber(message))throw failure('消息编号须为1至6。','MESSAGE');
      if(!this.messageScheduling)throw failure('消息运行尚未准备或已结束。','UNSUPPORTED');
      const recipients=[...this.messageRecords.values()].filter(record=>record.group.trigger?.message===message && record.phase==='IDLE');
      this.reserveGroups(recipients); return recipients.length;
    }
    reserveGroups(records) {
      this.check();
      const claimed=records.filter(record=>record.phase==='IDLE');
      // Reserve every matching listener before callbacks, BEGIN or another
      // sender can execute. Busy messages never create a queued copy.
      for(const record of claimed){record.phase='STARTING';record.queued=true;this.states.set(record.group.groupId,'STARTING');}
      for(const record of claimed){
        const work=Promise.resolve().then(()=>this.invokeGroup(record)).catch(async error=>{
          await this.fail(error).catch(()=>{});throw error;
        }).finally(()=>this.messageWorkers.delete(work));
        this.messageWorkers.add(work);work.catch(()=>{});
      }
      return claimed.length;
    }
    async invokeGroup(record) {
      const group=record.group,context={token:record.token,comboPower:3};record.queued=false;
      try{
        this.check();this.state(group,'STARTING');
        // START already activated initial groups. Only later message dispatches send BEGIN.
        const initialInvocationId=record.initialInvocationId;record.initialInvocationId=0;
        const invocationId=initialInvocationId||await this.awaitControl(this.client.beginGroup(context.token));this.check();
        if(!Number.isInteger(invocationId)||invocationId<1||invocationId>0xffffffff||invocationId<=record.lastInvocationId)
          throw failure('主控返回了无效或重复的程序组运行编号。','INVOCATION');
        record.lastInvocationId=invocationId;context.invocationId=invocationId;record.context=context;record.invocations++;
        record.phase='RUNNING';this.state(group,'RUNNING');
        await this.sequence(group,context,group.items);this.check();
        record.phase='FINISHING';this.state(group,'FINISHING');
        const reply=await this.awaitControl(this.client.finishGroup(context.token,invocationId));this.check();
        if(reply?.state!==3 || (reply.group!==undefined&&reply.group!==context.token) || (reply.task!==undefined&&reply.task!==invocationId))
          throw failure('主控尚未确认本轮程序组完成。','FINISH_UNCONFIRMED');
        if(this.observers){
          if(typeof this.observers.retireGroup!=='function')throw failure('条件观察器尚不支持按运行轮次清理。','OBSERVER_UNSUPPORTED');
          await this.observers.retireGroup(context.token,invocationId);
        }
        for(const [key,value] of this.observerContexts)if(value.groupId===group.groupId)this.observerContexts.delete(key);
        for(const [key,value] of this.leaseContexts)if(value.groupId===group.groupId)this.leaseContexts.delete(key);
        this.check();record.context=null;record.phase='IDLE';this.state(group,'IDLE');
      }catch(error){if(!error.groupId)Object.assign(error,{groupId:group.groupId});throw error;}
    }
    async runMessageGroups(snapshot) {
      this.messageRecords=new Map(snapshot.groups.map((group,index)=>[group.groupId,{group,token:index+1,phase:'IDLE',queued:false,lastInvocationId:0,initialInvocationId:snapshot.launchOrder.includes(group.groupId)?index+1:0,invocations:0,context:null}]));
      for(const record of this.messageRecords.values())this.state(record.group,'IDLE');
      this.messageScheduling=true;
      this.reserveGroups(snapshot.launchOrder.map(id=>this.messageRecords.get(id)));
      while(this.messageWorkers.size){
        const results=await Promise.allSettled([...this.messageWorkers]);
        const rejected=results.find(result=>result.status==='rejected');if(rejected)throw this.error||rejected.reason;
        this.check();
      }
      this.messageScheduling=false;this.check();
      return [...this.messageRecords.values()].filter(record=>record.invocations).map(record=>record.group.groupId);
    }
    run(input) {
      if(this.done)throw failure('此运行快照已使用，请重新运行。','USED');
      const snapshot=validateSnapshot(input);this.snapshot=snapshot;
      if(owner)throw failure('已有运行会话，不能追加或重启程序组。','BUSY');
      owner=this;this.done=this.execute(snapshot);return this.done;
    }
    async execute(snapshot) {
      const abort=()=>{this.fail(failure('设备或型号连接已变化，全部程序停止。','CANCELLED')).catch(()=>{});};
      this.signal?.addEventListener('abort',abort,{once:true});
      let workers=[];
      const executionGroups=snapshot.groups;
      try {
        if(this.connection.learned?.getSnapshot?.().busy || this.connection.learned?.busy)throw failure('请先结束口令学习或其他运行任务。','BUSY');
        this.check();await this.connection.enterProgram();this.check();
        if(this.connection.ensureFirmware&&!await this.connection.ensureFirmware({interactive:false,reason:'run'}))throw failure('主控固件尚未匹配。','FIRMWARE');
        this.check();
        requireProgramReady(this.connection);
        for(const group of snapshot.groups){
          try { Legacy.requireFeatureFirmware(group.items,this.connection); }
          catch(error){Object.assign(error,{groupId:group.groupId});throw error;}
        }
        // Reserve learning/run ownership before START; query only referenced learned slots.
        // Retain the existing
        // local learning/run mutex without sending the legacy DECLARE_RUN opcode.
        if(this.connection.learned) {
          if(this.connection.learned.getSnapshot?.().busy || this.connection.learned.busy)throw failure('请先结束口令学习或其他运行任务。','BUSY');
          const items=snapshot.groups.flatMap(group=>group.items);
          this.preparedLearned=true;
          try { await this.connection.learned.prepareRun(items); }
          catch(error) {
            if(error.path?.length) {
              let offset=error.path[0];
              for(const group of snapshot.groups) { if(offset<group.items.length){const path=[offset,...error.path.slice(1)];let item;let list=group.items;for(const i of path){item=list[i];list=item?.children||[];}Object.assign(error,{groupId:group.groupId,blockUid:item?.uid,path});break;}offset-=group.items.length; }
            }
            throw error;
          }
        } else if(snapshot.groups.some(group=>hasLearned(group.items)))throw failure('设备未提供学习状态查询，不能运行自学习口令块。','UNSUPPORTED');
        this.check();this.client=this.createClient({onAbort:error=>{if(!this.finished)this.fail(error).catch(()=>{});}});
        if(typeof this.client.beginGroup!=='function'||typeof this.client.finishGroup!=='function')throw failure('当前连接未提供多组运行所需的程序任务。','UNSUPPORTED');
        const initialGroups=snapshot.launchOrder.map(id=>snapshot.groups.findIndex(group=>group.groupId===id)+1);
        await this.client.open(executionGroups.length,{initialGroups});this.check();
        if(snapshot.groups.some(group=>Legacy.hasConditional(group.items))){
          if(!this.connection.conditionObservers?.createClient)throw failure('连接未提供独立条件观察器。','OBSERVER_UNSUPPORTED');
          this.observers=this.connection.conditionObservers.createClient({sessionLo:this.client.sessionLo,sessionHi:this.client.sessionHi,reusable:true,isCurrent:()=>!this.cancelled&&this.isCurrent(),onFault:error=>{
            const original=this.observerContexts.get(`${error.group}:${error.runId}:${error.observerId??error.id??error.task}`);
            if(original)Object.assign(error,original);this.fail(error).catch(()=>{});
          }});
        }
        const ran=await this.runMessageGroups(snapshot);this.check();await this.client.close();this.check();
        return {state:'completed',groups:ran};
      } catch(error) {
        await this.fail(error).catch(stopError=>{
          const original=this.error||error;original.stopError=stopError;original.stopUnconfirmed=true;
          original.message+='；停止尚未确认，已关闭本地连接，请检查设备是否停止。';
        });
        await Promise.allSettled([...workers,...this.messageWorkers]);throw this.error||error;
      } finally {
        this.finished=true;this.messageScheduling=false;
        for(const record of this.messageRecords.values()){record.queued=false;record.context=null;if(this.cancelled)record.phase='CANCELLED';}
        this.messageWorkers.clear();
        this.signal?.removeEventListener('abort',abort);
        for(const wake of [...this.waiters])wake();
        this.observers?.dispose();this.observerContexts.clear();
        this.client?.dispose?.('运行会话已结束。');
        this.taskContexts.clear();this.leaseContexts.clear();
        if(this.preparedLearned)this.connection.learned?.stop('运行会话已结束。');
        if(owner===this)owner=null;
      }
    }
  }
  function hasLearned(items) { return items.some(item=>item.id==='self-learned-wait'||hasLearned(item.children||[])); }
  return {validateSnapshot,hasMessages,requireProgramReady,releaseSupports,releaseUsesLegacy,releaseAllows,command,SessionCoordinator};
});
