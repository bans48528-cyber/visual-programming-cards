(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./xiaobai-protocol.js'):root.XiaobaiProtocol);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.XiaobaiLearnedCommands=api;
})(globalThis,function(protocol){
  'use strict';
  const {OP,MODE}=protocol,MAX=0xffffffff;
  const PHASES=['accepted','recording-first','first-valid','recording-second','success','failed','timeout','cancelled','rejected','retry-first','retry-second','ready'];
  const REASONS=['','设备未处于编程模式','设备正在执行其他任务','指令编号无效','该指令尚未学习','该指令已有口令','学习已取消','设备任务超时','语音芯片暂不可用','口令保存失败','设备反馈格式错误'];
  const stateName=n=>n===0?'unlearned':n===1?'learned':'unknown';
  function u32(n){if(!Number.isInteger(n)||n<1||n>MAX)throw new Error('任务编号无效。');return[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];}
  const read32=data=>(data[0]+data[1]*256+data[2]*65536+data[3]*16777216)>>>0;
  function slotNumber(slot){if(!Number.isInteger(slot)||slot<1||slot>10)throw new Error('请选择指令1至指令10。');return slot;}
  function failure(message,code){const error=new Error(message);if(code)error.code=code;return error;}
  function references(program){
    const found=[];
    function visit(items,path=[]){for(const [index,item] of items.entries()){
      const current=[...path,index];
      if(item.id==='self-learned-wait'){try{slotNumber(item.params?.slot);}catch(error){error.path=current;throw error;}found.push({slot:item.params.slot,path:current});}
      if(Array.isArray(item.children))visit(item.children,current);
    }}
    visit(program);return found;
  }
  class Session{
    constructor(link,{storage,onChange=()=>{},queryMs=2000,prepareMs=10000,taskMs=60000,cancelMs=3000,settleMs=250}={}){
      this.link=link;this.storage=storage;this.onChange=onChange;this.timing={queryMs,prepareMs,taskMs,cancelMs,settleMs};
      this.uid=null;this.capability='unknown';this.query='idle';this.states=Array(10).fill('unknown');this.error='';
      this.learning=null;this.waiting=null;this.run=null;this.preparingRun=false;this.preparingLearn=false;this.preparedNeedsLearned=false;
      this.initialized=false;this.initializing=null;this.epoch=0;this.queryGeneration=0;this.currentQuery=0;
      this.legacy=false;this.listeners=new Set();this.disposed=false;this.timers=new Set();this.pauses=new Set();
      this.offEvent=link.subscribe(event=>this.receive(event));
      this.offLifecycle=link.onLifecycle?.(reason=>this.invalidate(reason));
      link.learned=this;
    }
    get busy(){return Boolean(this.preparingLearn||this.preparingRun||this.run||this.learning&&!this.learning.terminal||this.waiting);}
    subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
    getSnapshot(){
      return {uid:this.uid,capability:this.capability,query:this.query,busy:this.busy,error:this.error,
        slots:this.states.map((state,index)=>{const slot=index+1,memo=this.getMemo(slot);return{slot,state,memo,label:memo||`指令${slot}`};}),
        learning:this.learning?this.publicTask(this.learning):null,run:this.run?{...this.run}:null,
        waiting:this.waiting?{task:this.waiting.task,slot:this.waiting.slot,ready:this.waiting.ready}:null};
    }
    publicTask(task){return{task:task.task,slot:task.slot,replace:task.replace,stage:task.stage,phase:task.phase,terminal:task.terminal,error:task.error||'',state:task.state};}
    emit(){const snapshot=this.getSnapshot();this.onChange(snapshot);for(const listener of this.listeners)listener(snapshot);}
    session(){
      if(this.disposed||this.link.closed||!this.link.subscribed)throw failure('请先连接小白并订阅设备反馈。','DISCONNECTED');
      if(this.link.mode!==MODE.PROGRAM||!this.link.heartbeatTimer)throw failure('请先进入编程模式。','MODE');
    }
    assertEpoch(epoch){this.session();if(epoch!==this.epoch)throw failure('当前操作已取消。','CANCELLED');}
    allocate(key){
      if(!this.storage?.getItem||!this.storage?.setItem)throw failure('无法保存设备任务编号，请检查本机存储。','STORAGE');
      let previous;
      try{
        const raw=this.storage.getItem(key);
        if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))throw new Error('corrupt');
        previous=raw===null?0:Number(raw);
        if(previous<0||previous>=MAX)throw failure('设备任务编号已耗尽，不能复用旧编号。','EXHAUSTED');
        const next=previous+1;this.storage.setItem(key,String(next));
        if(this.storage.getItem(key)!==String(next))throw new Error('not persisted');
        return next;
      }catch(error){if(error.code==='EXHAUSTED')throw error;throw failure('无法可靠保存设备任务编号，已取消发送。','STORAGE');}
    }
    deviceNumber(kind){if(!this.uid)throw failure('尚未读取设备稳定标识。','UID');return this.allocate(`xiaobai:${this.uid}:counter:${kind}`);}
    request(op,args,ms,match){this.session();return this.link.request(this.link.nextSeq(),op,args,ms,match);}
    matchId(id,slot=null){return(data,result)=>result===2||(read32(data)===id&&(slot===null||data[4]===slot));}
    pause(ms,epoch){
      return new Promise((resolve,reject)=>{
        let timer;
        const cancel=()=>{clearTimeout(timer);this.timers.delete(timer);this.pauses.delete(cancel);reject(failure('当前操作已取消。','CANCELLED'));};
        this.pauses.add(cancel);
        timer=this.timer(()=>{this.pauses.delete(cancel);try{this.assertEpoch(epoch);resolve();}catch(error){reject(error);}},ms);
      });
    }
    async confirmProgram(epoch){
      const version=this.link.modeVersion;
      let retryNotBefore=0;
      for(let attempt=0;attempt<2;attempt++){
        for(;;){
          this.assertEpoch(epoch);
          if(version!==this.link.modeVersion)throw failure('设备模式已变化，请重新进入编程页。','MODE');
          const remaining=Math.max(this.link.programEnteredAt||0,this.link.programModeObservedAt||0)+this.timing.settleMs-Date.now();
          const wait=Math.max(remaining,retryNotBefore-Date.now());
          if(wait<=0)break;
          await this.pause(wait,epoch);
        }
        try{
          // The write of ENTER_PROGRAM is optimistic. Only a real QUERY_STATUS reply proves mode 4.
          const data=await this.link.request(0,OP.QUERY_STATUS,[],this.timing.queryMs);
          this.assertEpoch(epoch);
          if(version!==this.link.modeVersion||data.length!==7||data[0]!==MODE.PROGRAM)
            throw failure('设备未确认编程模式，请重新进入编程页。','MODE');
          return;
        }catch(error){
          this.assertEpoch(epoch);
          if(error.code!=='TIMEOUT'||attempt===1)throw error;
          retryNotBefore=Date.now()+this.timing.settleMs;
        }
      }
    }
    async readUid(epoch){
      if(this.uid)return this.uid;
      const bytes=[];
      for(const part of [0,1]){
        const data=await this.request(OP.READ_UID,[part],this.timing.queryMs,(data,result)=>result===2||data[0]===part);
        this.assertEpoch(epoch);
        if(data.length!==7||data[0]!==part)throw failure('设备标识反馈格式错误。','PROTOCOL');
        bytes.push(...data.slice(1));
      }
      this.uid=bytes.map(n=>n.toString(16).padStart(2,'0')).join('');return this.uid;
    }
    initialize(){if(this.initializing)return this.initializing;if(this.initialized)return Promise.resolve(this.getSnapshot());return this.refresh();}
    refresh(){
      if(this.initializing)return this.initializing;
      this.session();
      const epoch=this.epoch,generation=++this.queryGeneration;
      this.query='loading';this.states.fill('unknown');this.error='';this.emit();
      const promise=(async()=>{
        try{
          await this.confirmProgram(epoch);this.assertEpoch(epoch);
          try{await this.readUid(epoch);}catch(error){if(error.result!==2)throw error;this.legacy=true;}
          this.assertEpoch(epoch);
          const qid=this.allocate('xiaobai:query:counter');this.currentQuery=qid;
          const data=await this.request(OP.QUERY_LEARNED,u32(qid),this.timing.queryMs,this.matchId(qid));
          this.assertEpoch(epoch);
          if(generation!==this.queryGeneration)return this.getSnapshot();
          if(data.length!==7||read32(data)!==qid||(data[5]&0xfc)||(data[6]&0xf0))throw failure('口令状态反馈格式错误。','PROTOCOL');
          this.capability=(data[6]&15)===15&&!this.legacy?'supported':'unsupported';
          this.states=this.capability==='supported'?Array.from({length:10},(_,i)=>((data[4]|data[5]<<8)&1<<i)?'learned':'unlearned'):Array(10).fill('unknown');
          this.query='ready';this.initialized=true;this.emit();return this.getSnapshot();
        }catch(error){
          if(epoch!==this.epoch||generation!==this.queryGeneration)throw error;
          if(error.result===2&&error.opcode===OP.QUERY_LEARNED){this.legacy=true;this.capability='unsupported';this.query='ready';this.initialized=true;this.emit();return this.getSnapshot();}
          this.query='error';this.capability='unknown';this.states.fill('unknown');this.error=error.message;this.emit();throw error;
        }finally{if(this.initializing===promise)this.initializing=null;}
      })();
      this.initializing=promise;return promise;
    }
    invalidateQueries(){
      this.queryGeneration++;this.currentQuery=0;this.initializing=null;
      if(this.query==='loading')this.query='idle';
    }
    getMemo(slot){
      slotNumber(slot);if(!this.uid)return '';
      try{return this.storage?.getItem(`xiaobai:${this.uid}:${slot}`)||'';}catch{return '';}
    }
    setMemo(slot,text){
      slotNumber(slot);if(!this.uid)throw failure('尚未读取设备稳定标识，无法保存文字备忘。','UID');
      if(this.run||this.preparingRun)throw failure('程序运行期间不能编辑口令。','BUSY');
      const memo=String(text??'').trim().slice(0,80),key=`xiaobai:${this.uid}:${slot}`;
      try{this.storage.setItem(key,memo);if(this.storage.getItem(key)!==memo)throw new Error();}
      catch{throw failure('文字备忘未能保存，请重试。','STORAGE');}
      this.emit();return memo;
    }
    timer(callback,ms){const timer=setTimeout(()=>{this.timers.delete(timer);callback();},ms);this.timers.add(timer);return timer;}
    clearTimer(task){if(task)for(const key of ['timer','readyRetryTimer'])if(task[key]){clearTimeout(task[key]);this.timers.delete(task[key]);task[key]=null;}}
    arm(task,ms,message){
      this.clearTimer(task);
      task.timer=this.timer(()=>{
        if(task.terminal)return;
        this.invalidateQueries();this.states[task.slot-1]='unknown';
        if(task===this.learning)this.finishLearning(task,6,2,message);
        else if(task===this.waiting)this.finishWait(task,failure(message,'TIMEOUT'));
        // Timers only cancel unsafe work. They never fabricate recording progress or a successful save.
        this.link.stopProgram().catch(()=>{});
      },ms);
    }
    async learn(slot,{replace=false}={}){
      slotNumber(slot);this.session();
      if(this.busy)throw failure('学习与程序运行不能同时进行。','BUSY');
      this.preparingLearn=true;this.emit();const epoch=this.epoch;
      try{
        await this.initialize();this.assertEpoch(epoch);
        if(this.capability!=='supported')throw failure('设备暂不支持自学习口令。','UNSUPPORTED');
        if(this.states[slot-1]==='unknown'){await this.refresh();this.assertEpoch(epoch);}
        if(this.states[slot-1]==='unknown')throw failure('口令状态未知，请重新读取后再学习。','UNKNOWN');
        if(this.states[slot-1]==='learned'&&!replace)throw failure('该指令已有口令，请选择重新学习。','ALREADY_LEARNED');
        const task={task:this.deviceNumber('task'),slot,replace:Boolean(replace),stage:null,phase:'preparing',terminal:false,state:this.states[slot-1]};
        const done=new Promise(resolve=>task.resolve=resolve);task.done=done;this.learning=task;this.preparingLearn=false;this.arm(task,this.timing.prepareMs,'设备未确认学习准备，请重试。');this.emit();
        this.request(OP.LEARN_COMMAND,[...u32(task.task),slot,replace?1:0],this.timing.prepareMs,this.matchId(task.task,slot)).then(data=>{
          if(this.learning!==task||task.terminal||task.cancelRequested||epoch!==this.epoch)return;
          if(data[5]>2||data[6]!==0){this.finishLearning(task,5,2,'学习受理反馈格式错误。');this.link.stopProgram().catch(()=>{});return;}
          // D2 acceptance is not a recording event and does not change learned state.
          if(!task.accepted){task.accepted=true;this.arm(task,this.timing.taskMs,'学习已超时，口令状态未知。');}
          if(task.stage===null){task.phase='accepted';this.emit();}
        }).catch(error=>{
          if(this.learning!==task||task.terminal||epoch!==this.epoch)return;
          const state=error.data&&read32(error.data)===task.task&&error.data[4]===slot&&error.data[5]<=2?error.data[5]:2;
          this.finishLearning(task,error.code==='TIMEOUT'?6:8,state,error.message);
          if(error.code==='TIMEOUT')this.link.stopProgram().catch(()=>{});
        });
        return await done;
      }finally{if(epoch===this.epoch){this.preparingLearn=false;this.emit();}}
    }
    finishLearning(task,stage,state,message=''){
      if(task!==this.learning||task.terminal)return;
      this.clearTimer(task);this.invalidateQueries();
      if(stage===4&&state!==1){stage=5;state=2;message='设备未确认模板保存成功，请重新查询。';}
      task.stage=stage;task.phase=PHASES[stage];task.terminal=true;task.state=stateName(state);task.error=message;
      this.states[task.slot-1]=task.state;this.emit();task.resolve(this.publicTask(task));
    }
    async cancelLearning(){
      if(this.preparingLearn){
        // Learning can be cancelled during the initial UID/status query, before any task was sent.
        this.epoch++;for(const cancel of [...this.pauses])cancel();this.invalidateQueries();this.preparingLearn=false;this.initialized=false;this.emit();return;
      }
      const task=this.learning;if(!task||task.terminal)return;
      if(task.phase==='cancelling')return task.done;
      this.session();task.cancelRequested=true;task.phase='cancelling';this.arm(task,this.timing.cancelMs,'取消确认超时，口令状态未知。');this.emit();
      this.request(OP.CANCEL_LEARNING,u32(task.task),this.timing.cancelMs,this.matchId(task.task,task.slot)).catch(error=>{
        if(task!==this.learning||task.terminal)return;
        this.finishLearning(task,7,2,'未能确认取消结果，口令状态未知。');this.link.stopProgram().catch(()=>{});
      });
      // ACK alone is not terminal. Stay in the modal until real final state (or a cancelling timeout).
      return task.done;
    }
    dismissLearning(){if(this.learning&&!this.learning.terminal)throw failure('请先取消当前学习。','BUSY');this.learning=null;this.emit();}
    async prepareRun(program){
      this.session();if(this.busy)throw failure('请先完成或取消口令学习。','BUSY');
      const used=references(program),epoch=this.epoch;this.preparedNeedsLearned=used.length>0;this.preparingRun=true;this.emit();
      try{
        await this.initialize();this.assertEpoch(epoch);
        if(used.length&&this.capability!=='supported')throw failure('设备暂不支持自学习口令。','UNSUPPORTED');
        if(used.some(({slot})=>this.states[slot-1]==='unknown')){await this.refresh();this.assertEpoch(epoch);}
        for(const {slot,path} of used)if(this.states[slot-1]!=='learned'){
          const error=failure(this.states[slot-1]==='unlearned'?`指令${slot}尚未学习，请先学习此积木的口令。`:`指令${slot}状态未知，暂不能运行。`,'UNLEARNED');error.path=path;error.slot=slot;throw error;
        }
        return this.getSnapshot();
      }catch(error){if(epoch===this.epoch){this.preparingRun=false;this.emit();}throw error;}
    }
    async beginRun(){
      this.session();if(!this.preparingRun||this.run)throw failure('程序尚未通过口令检查。','BUSY');
      const epoch=this.epoch;
      try{
        if(this.legacy&&!this.uid){this.run={id:0,legacy:true};return this.run;}
        const id=this.deviceNumber('run');
        try{
          const data=await this.request(OP.DECLARE_RUN,[...u32(id),1],this.timing.queryMs,(data,result)=>result===2||(read32(data)===id&&data[4]===1));
          this.assertEpoch(epoch);
          if(data[4]!==1||data[5]||data[6])throw failure('设备未正确确认程序运行声明。','PROTOCOL');
          this.run={id,legacy:false};
        }catch(error){this.assertEpoch(epoch);if(error.result!==2||this.preparedNeedsLearned)throw error;this.run={id,legacy:true};}
        return this.run;
      }finally{if(epoch===this.epoch){this.preparingRun=false;this.emit();}}
    }
    async endRun(){
      const run=this.run;if(!run)return;this.session();
      try{if(!run.legacy){
        const data=await this.request(OP.DECLARE_RUN,[...u32(run.id),0],this.timing.queryMs,(data,result)=>result===2||(read32(data)===run.id&&data[4]===0));
        if(data[5]||data[6])throw failure('设备结束运行反馈格式错误。','PROTOCOL');
      }}
      finally{if(this.run===run){this.run=null;if(this.waiting)this.finishWait(this.waiting,failure('程序已结束。','CANCELLED'));this.emit();}}
    }
    retryWaitReady(task,bytes,epoch){
      const current=()=>this.waiting===task&&!task.terminal&&!task.ready&&epoch===this.epoch&&Boolean(this.run)&&
        !this.disposed&&!this.link.closed&&this.link.subscribed&&this.link.mode===MODE.PROGRAM&&Boolean(this.link.heartbeatTimer);
      if(!current()||task.readyRetries>=2)return;
      task.readyRetryTimer=this.timer(()=>{
        task.readyRetryTimer=null;
        if(!current())return;
        task.readyRetries++;
        // Replay the original identity, with a queue-time guard. Never reset either task deadline.
        this.link.send(bytes,current).then(sent=>{
          if(sent&&current())this.retryWaitReady(task,bytes,epoch);
        }).catch(error=>{
          if(!current())return;
          this.finishWait(task,error);this.link.stopProgram().catch(()=>{});
        });
      },1000);
    }
    wait(slot){
      slotNumber(slot);this.session();
      if(!this.run||this.run.legacy||this.capability!=='supported')return Promise.reject(failure('自学习口令等待尚未准备好。','UNSUPPORTED'));
      if(this.waiting)return Promise.reject(failure('已有口令等待任务。','BUSY'));
      if(this.states[slot-1]!=='learned')return Promise.reject(failure(`指令${slot}尚未学习。`,'UNLEARNED'));
      const task={task:this.deviceNumber('task'),slot,ready:false,terminal:false,readyRetries:0};
      const epoch=this.epoch,done=new Promise((resolve,reject)=>{task.resolve=resolve;task.reject=reject;});
      const seq=this.link.nextSeq(),args=[...u32(task.task),slot],bytes=protocol.command(seq,OP.WAIT_LEARNED,args);
      this.waiting=task;this.arm(task,this.timing.prepareMs,'口令等待准备超时。');this.emit();
      this.link.request(seq,OP.WAIT_LEARNED,args,this.timing.prepareMs,this.matchId(task.task,slot)).then(data=>{
        if(this.waiting!==task||task.terminal||epoch!==this.epoch)return;
        if(data[5]>2||data[6]){this.finishWait(task,failure('口令等待反馈格式错误。','PROTOCOL'));this.link.stopProgram().catch(()=>{});return;}
        // Remain unarmed until the real stage 11 event, even when D2 accepted it.
        this.retryWaitReady(task,bytes,epoch);
      }).catch(error=>{if(this.waiting===task&&!task.terminal&&epoch===this.epoch){this.finishWait(task,error);this.link.stopProgram().catch(()=>{});}});
      return done;
    }
    finishWait(task,error=null){
      if(this.waiting!==task||task.terminal)return;
      task.terminal=true;this.clearTimer(task);this.waiting=null;this.emit();if(error)task.reject(error);else task.resolve({task:task.task,slot:task.slot});
    }
    receive(event){
      if(event.code===2||(event.code===1&&event.data[0]!==MODE.PROGRAM)){this.invalidate('设备已中止程序或切换模式。');return;}
      if(![8,9].includes(event.code)||event.data.length!==8)return;
      const data=event.data,id=read32(data),slot=data[4];
      if(!id||slot<1||slot>10)return;
      if(event.code===9){
        const task=this.waiting;
        if(task&&task.task===id&&task.slot===slot&&task.ready&&!task.terminal&&data.slice(5).every(n=>n===0))this.finishWait(task);
        return;
      }
      const stage=data[5],state=data[6],reason=data[7];
      if(stage>11||state>2||reason>10)return;
      const task=this.learning;
      if(task&&task.task===id&&task.slot===slot&&!task.terminal&&stage!==11){
        if(stage>=4&&stage<=8){this.finishLearning(task,stage,state,REASONS[reason]||'');return;}
        if(task.cancelRequested)return;
        const signature=`${stage}:${state}:${reason}`;
        if(task.lastStage===signature)return;task.lastStage=signature;
        task.stage=stage;task.phase=PHASES[stage];
        if(!task.accepted){task.accepted=true;this.arm(task,this.timing.taskMs,'学习已超时，口令状态未知。');}
        this.emit();return;
      }
      const waiting=this.waiting;
      if(waiting&&waiting.task===id&&waiting.slot===slot&&!waiting.terminal){
        // eventCounter is global and only eight bits; task/slot/terminal are the correlation identity.
        if(stage===11&&state===1&&!waiting.ready){waiting.ready=true;this.arm(waiting,this.timing.taskMs,'等待口令超时，程序已停止。');this.emit();}
        else if(stage>=5&&stage<=8){this.states[slot-1]=stateName(state);this.finishWait(waiting,failure(REASONS[reason]||'口令等待已取消。','ABORTED'));}
      }
    }
    stop(reason='程序已停止。'){
      this.epoch++;for(const cancel of [...this.pauses])cancel();this.invalidateQueries();this.preparingRun=false;this.preparingLearn=false;
      if(this.learning&&!this.learning.terminal)this.finishLearning(this.learning,7,2,reason);
      if(this.waiting)this.finishWait(this.waiting,failure(reason,'CANCELLED'));
      this.run=null;this.emit();
    }
    invalidate(reason='连接已结束。'){
      this.stop(reason);this.initialized=false;this.query='idle';this.capability='unknown';this.states.fill('unknown');this.emit();
    }
    dispose(){if(this.disposed)return;this.invalidate('连接已断开。');this.disposed=true;this.offEvent();this.offLifecycle?.();for(const timer of this.timers)clearTimeout(timer);this.timers.clear();}
  }
  return{Session,u32,read32,references,PHASES};
});
