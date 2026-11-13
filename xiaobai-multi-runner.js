/* Phone-side program counters; hardware ownership lives in the C4 device session. */
(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./xiaobai-runner.js') : root.XiaobaiRunner,
    typeof module === 'object' && module.exports ? require('./xiaobai-protocol.js') : root.XiaobaiProtocol);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XiaobaiMultiProgram = api;
})(globalThis, function(Legacy, P) {
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
      seen.add(item); return ['send-message','send-message-wait'].includes(item.id) || visit(item.children);
    });
    return (snapshot?.groups || []).some(group => group.trigger?.type === 'message' || visit(group.items));
  }
  function validationItem(item) {
    const copy = {...item};
    if (['send-message','send-message-wait'].includes(item.id)) { copy.id = 'wait-time'; copy.params = {duration: .001}; }
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
            if (['send-message','send-message-wait'].includes(item.id) && !messageNumber(item.params?.message)) throw failure('发送消息请选择消息1至6。','MESSAGE');
            // Validation-only substitution; the immutable executable snapshot
            // still contains send-message, and never executes this wait.
            Legacy.validate([validationItem(item)]);
          } catch(error) { if(!error.groupId)Object.assign(error,{groupId:group.groupId,blockUid:error.blockUid||item?.uid,path:[...current,...(error.path?.slice(1)||[])]}); throw error; }
        });
      }
      visit(group.items);
      observerBudget+=Flow.validateLoops(group.items).maxObserverDepth;
      if(observerBudget>16)throw failure('本次运行最多同时启用16个条件观察器。','OBSERVER_LIMIT');

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
      target.version === 0x020300);
  }
  function releaseUsesLegacy(metadata) {
    const target = metadata?.firmware;
    return Boolean(metadata?.bound && target?.boardId === 258 && target.protocol === 1 &&
      Number.isInteger(target.version) && target.version > 0 && target.version < Legacy.FIRST_COMPACT_START_VERSION);
  }
  function releaseAllows(metadata, firmware) {
    const state = typeof firmware?.snapshot === 'function' ? firmware.snapshot() : firmware;
    return releaseSupports(metadata) && streamReady(state, metadata.firmware.version);
  }
  function streamReady(state,target=state?.targetVersion) {
    const actual=state?.actual;
    return Boolean(target===0x020300&&state?.ready&&state.currentVersion===target&&state.targetVersion===target&&
      state.epoch&&actual?.epoch===state.epoch&&actual.info?.version===target&&actual.info.mode===0&&actual.info.imageValid);
  }
  function requireProgramReady(connection) {
    if (!streamReady(connection?.firmware?.snapshot?.()))
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
    else if (id==='motor-power') { context.comboPower=Number(p.power);opcode=O.MOTOR_POWER;args=[context.comboPower]; }
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
    constructor(connection,{createClient,isCurrent=()=>true,onStep=()=>{},onGroupState=()=>{},onActivity=()=>{},signal}={}){
      this.connection=connection;this.createClient=createClient||(options=>connection.multiProgram.createClient(options));
      this.isCurrent=isCurrent;this.onStep=onStep;this.onGroupState=onGroupState;this.onActivity=onActivity;this.signal=signal;
      this.cancelled=false;this.initialized=false;this.records=new Map();this.jobs=new Set();this.shared={comboPower:3};
      this.waiters=new Set();this.error=null;this.preparedLearned=false;this.taskContexts=new Map();
    }
    check(context){
      if(this.error)throw this.error;
      if(this.cancelled||this.signal?.aborted||!this.isCurrent()||context?.cancelled)
        throw failure('这次脚本运行已取消。','CANCELLED');
    }
    report(){
      const active=[...this.records.values()].filter(record=>record.context&&!record.context.finished&&!record.context.cancelled).map(record=>record.group.groupId);
      this.onActivity({active,outputs:this.client?.sensor?.flags?this.client.sensor.flags>>4&7:0,waiting:!active.length});
    }
    delay(ms,context){
      this.check(context);
      return new Promise((resolve,reject)=>{
        const cancel=()=>{
          try{this.check(context);}catch(error){clearTimeout(timer);this.waiters.delete(cancel);reject(error);}
        };
        const timer=setTimeout(()=>{
          this.waiters.delete(cancel);try{this.check(context);resolve();}catch(error){reject(error);}
        },ms);
        this.waiters.add(cancel);
      });
    }
    awaitCancellable(pending,context){
      return new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(callback,value)=>{if(settled)return;settled=true;this.waiters.delete(wake);callback(value);};
        const wake=()=>{try{this.check(context);}catch(error){finish(reject,error);}};
        this.waiters.add(wake);wake();
        Promise.resolve(pending).then(value=>finish(resolve,value),error=>finish(reject,error));
      });
    }
    sensor(context,condition){
      this.check(context);const sensor=this.client.sensor;
      if(!sensor||Date.now()-sensor.receivedAt>600)throw failure('传感器数据未就绪或已过期。','SENSOR_STALE');
      if(condition.kind==='infrared'){
        if(!(sensor.flags&8))throw failure('红外传感器未就绪。','SENSOR');
        return condition.comparison==='greater'?sensor.ir>condition.threshold:sensor.ir<condition.threshold;
      }
      if(!(sensor.flags&1))throw failure('加速度传感器未就绪。','SENSOR');
      if(condition.kind==='tilt')return sensor.tilt===P.TILT_DIRECTIONS[condition.direction];
      if(condition.state==='still')return Boolean(sensor.flags&2);
      if(condition.state==='shaking')return Boolean(sensor.flags&4);
      return false;
    }
    async awaitSensor(context,condition){
      while(!this.client.sensor){await this.delay(35,context);}
      while(!this.sensor(context,condition))await this.delay(35,context);
    }
    async loop(group,context,item,path){
      const p=item.params||{},started=Date.now();let rounds=0;
      while(true){
        this.check(context);
        if(item.id==='loop-count'&&rounds>=p.count)return;
        if(item.id==='loop-time'&&Date.now()-started>=p.duration*1000)return;
        if(item.id==='loop-infrared'&&this.sensor(context,{kind:'infrared',comparison:p.comparison,threshold:p.threshold}))return;
        if(item.id==='loop-tilt'&&this.sensor(context,{kind:'tilt',direction:p.direction}))return;
        await this.sequence(group,context,item.children,path);rounds++;
        await this.delay(0,context);
      }
    }
    async sequence(group,context,items,parent=[]){
      for(let index=0;index<items.length;index++){
        this.check(context);const item=items[index],path=[...parent,index],p=item.params||{};
        context.current={item,path};this.onStep(item,path,group.groupId);
        try{
          if(Flow.isLoop(item))await this.loop(group,context,item,path);
          else if(item.id==='wait-time')await this.delay(p.duration*1000,context);
          else if(item.id==='send-message'||item.id==='send-message-wait'){
            const pending=this.dispatchMessage(p.message);
            if(item.id==='send-message-wait')await this.awaitCancellable(Promise.all(pending),context);
          }else if(item.id==='infrared-wait')await this.awaitSensor(context,{kind:'infrared',comparison:p.comparison,threshold:p.threshold});
          else if(item.id==='tilt-wait')await this.awaitSensor(context,{kind:'tilt',direction:p.direction});
          else if(item.id==='motion-wait'&&['still','shaking'].includes(p.state))
            await this.awaitSensor(context,{kind:'motion',state:p.state});
          else{
            const action=command(item,this.shared);
            await this.client.action(context.token,action.opcode,action.args,{invocationId:context.invocationId,
              guard:()=>!context.cancelled&&this.records.get(group.groupId)?.context===context,
              timeoutMs:action.timeoutMs,onDispatched:message=>{
                this.taskContexts.set(message.task,{groupId:group.groupId,blockUid:item.uid,path:path.slice()});
                for(const [oldId] of this.taskContexts){
                  if(this.taskContexts.size<=64)break;
                  if(!this.client.records?.has(oldId)&&oldId!==this.client.audioTask)this.taskContexts.delete(oldId);
                }
              }});
            // Timed motor blocks wait locally; device timing protects each output
            // independently and cannot stop an output replaced by a newer command.
            if(['motor-forward','motor-reverse','combo-forward','combo-backward','combo-turn-left','combo-turn-right'].includes(item.id))
              await this.delay(p.duration*1000,context);
          }
          this.check(context);await this.delay(0,context);
        }catch(error){
          if(!error.groupId)Object.assign(error,{groupId:group.groupId,blockUid:item.uid,path});
          throw error;
        }
      }
    }
    cancelContext(record){
      if(!record.context||record.context.finished)return;
      record.context.cancelled=true;
      for(const wake of [...this.waiters])wake();
    }
    launch(record){
      this.check();this.cancelContext(record);
      const context={token:record.token,cancelled:false,finished:false,invocationId:0};
      record.context=context;this.onGroupState(record.group.groupId,'STARTING');this.report();
      const work=Promise.resolve().then(async()=>{
        this.check(context);
        context.invocationId=record.initialInvocationId||await this.client.beginGroup(record.token);
        record.initialInvocationId=0;this.check(context);
        this.onGroupState(record.group.groupId,'RUNNING');
        await this.sequence(record.group,context,record.group.items);this.check(context);
        await this.client.finishGroup(record.token,context.invocationId);
      }).catch(async error=>{
        if(context.cancelled||this.cancelled||error.code==='CANCELLED')return;
        await this.fail(error);throw error;
      }).finally(()=>{
        context.finished=true;this.jobs.delete(work);
        if(record.context===context){this.onGroupState(record.group.groupId,'IDLE');this.report();}
      });
      work.catch(()=>{});this.jobs.add(work);record.promise=work;return work;
    }
    dispatchMessage(message){
      this.check();if(!messageNumber(message))throw failure('消息编号无效。','MESSAGE');
      return [...this.records.values()].filter(record=>record.group.trigger?.type==='message'&&record.group.trigger.message===message)
        .map(record=>this.launch(record));
    }
    async toggleGroup(groupId){
      this.check();const record=this.records.get(groupId);
      if(!record)throw failure('找不到这个程序组。','GROUP');
      if(record.context&&!record.context.finished&&!record.context.cancelled){
        const previous=record.context;this.cancelContext(record);
        try{await this.client.endGroup(record.token);}catch(error){if(record.context===previous||error.code!=='CANCELLED')throw error;}
        if(record.context===previous)this.onGroupState(groupId,'IDLE');
        this.report();return {state:'stopped'};
      }
      this.launch(record);return {state:'running'};
    }
    async execute(snapshot){
      this.check();await this.connection.enterProgram();this.check();
      if(this.connection.ensureFirmware&&!await this.connection.ensureFirmware({interactive:false,reason:'run'}))throw failure('主控版本未匹配。','FIRMWARE');
      requireProgramReady(this.connection);
      if(this.connection.learned){
        this.preparedLearned=true;await this.connection.learned.prepareRun(snapshot.groups.flatMap(group=>group.items));
      }else if(snapshot.groups.some(group=>hasLearned(group.items)))throw failure('设备未提供口令学习状态。','UNSUPPORTED');
      this.check();
      this.client=this.createClient({onAbort:error=>this.fail(error).catch(()=>{}),onSensor:()=>this.report()});
      this.records=new Map(snapshot.groups.map((group,index)=>[group.groupId,{group,token:index+1,initialInvocationId:snapshot.launchOrder.includes(group.groupId)?index+1:0,context:null}]));
      const abort=()=>this.fail(failure('设备连接或型号已变化。','CANCELLED')).catch(()=>{});
      this.abort=abort;this.signal?.addEventListener('abort',abort,{once:true});
      await this.client.open(snapshot.groups.length,{initialGroups:snapshot.launchOrder.map(id=>this.records.get(id).token)});
      this.initialized=true;
      const needsSensor=snapshot.groups.some(group=>needsSensorValues(group.items));
      if(needsSensor){
        const until=Date.now()+1500;
        while(!this.client.sensor&&Date.now()<until)await this.delay(30);
        if(!this.client.sensor)throw failure('没有收到主机传感器数据。','SENSOR_STALE');
      }
      const initial=snapshot.launchOrder.map(id=>this.launch(this.records.get(id)));
      await Promise.all(initial);
      while(this.jobs.size){await Promise.all([...this.jobs]);this.check();}
      this.check();
      return {state:'idle',sessionOpen:true,groups:snapshot.launchOrder.slice()};
    }
    run(input){
      if(this.done)throw failure('这个运行会话已经启动。','USED');
      if(owner)throw failure('已有其他作品正在运行。','BUSY');
      const snapshot=validateSnapshot(input);this.snapshot=snapshot;owner=this;
      this.done=this.execute(snapshot).catch(async error=>{await this.fail(error);throw error;});return this.done;
    }
    async fail(error){
      if(this.error)return this.stopPromise;
      if(error.task&&!error.groupId)Object.assign(error,this.taskContexts.get(error.task)||{});
      this.error=error;this.cancelled=true;
      await this.stop(error.message);
    }
    stop(reason='程序已停止。'){
      if(this.stopPromise)return this.stopPromise;
      this.cancelled=true;for(const record of this.records.values())this.cancelContext(record);
      for(const wake of [...this.waiters])wake();
      this.stopPromise=(async()=>{
        try{await this.client?.stop(reason);}
        finally{
          this.initialized=false;this.client?.dispose();this.signal?.removeEventListener('abort',this.abort);
          if(this.preparedLearned)this.connection.learned?.stop(reason);
          for(const record of this.records.values())this.onGroupState(record.group.groupId,'IDLE');
          if(owner===this)owner=null;this.report();
        }
      })();
      this.stopPromise.catch(()=>{});return this.stopPromise;
    }
    get running(){return [...this.records.values()].some(record=>record.context&&!record.context.finished&&!record.context.cancelled);}
  }
  function hasLearned(items){return items.some(item=>item.id==='self-learned-wait'||hasLearned(item.children||[]));}
  function needsSensorValues(items){return items.some(item=>['infrared-wait','tilt-wait','loop-infrared','loop-tilt'].includes(item.id)||
    item.id==='motion-wait'&&['still','shaking'].includes(item.params.state)||needsSensorValues(item.children||[]));}
  return {validateSnapshot,hasMessages,requireProgramReady,releaseSupports,releaseUsesLegacy,releaseAllows,command,SessionCoordinator};
});
