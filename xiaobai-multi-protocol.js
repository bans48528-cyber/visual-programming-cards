/* Xiaobai program v1: explicit session/group/task identities. No UI or firmware bypass. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.XiaobaiMultiProtocol=api;
})(globalThis,function(){
  'use strict';
  const KIND=Object.freeze({CAPS:1,OPEN:2,GROUP_OPEN:3,ACTION:4,QUERY:5,GROUP_END:6,CLOSE:7,STOP:8,HEARTBEAT:9,ACK:10,COMMIT:11,
    OBSERVER_ARM:12,OBSERVER_QUERY:13,OBSERVER_CLOSE:14,OBSERVER_ACK:15,GROUP_BEGIN:16,GROUP_FINISH:17,START:18});
  const STATE=Object.freeze({ACCEPTED:1,READY:2,DONE:3,APPLIED:4,FAILED:5,CANCELLED:6,RELEASED:7,ABORTED:8});
  const REASON=Object.freeze({NONE:0,PARAM:1,MODE:2,BUSY:3,STALE:4,CONFLICT:5,ASR:6,SENSOR:7,TIMEOUT:8,EXPIRED:9});
  const reasons=['','参数无效','设备模式不符','设备忙碌','任务已失效','程序组资源冲突','语音模块不可用','传感器不可用','任务超时','任务记录已过期'];
  const failure=(message,code='PROTOCOL')=>Object.assign(new Error(message),{code});
  const u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
  const read32=(a,i=0)=>(a[i]|a[i+1]<<8|a[i+2]<<16|a[i+3]<<24)>>>0;
  const integer=(n,max)=>Number.isInteger(n)&&n>=0&&n<=max;
  const bytes=a=>Array.isArray(a)||a instanceof Uint8Array;
  function actionArgs(op,a){
    if(!bytes(a)||a.length>16||Array.from(a).some(n=>!integer(n,255)))return false;
    const size={16:6,17:2,18:1,19:1,32:5,33:1,34:0,35:1,48:3,50:1,52:1,64:1,65:1,66:0,67:16,80:1,81:1,85:1}[op];
    if(size===undefined||a.length!==size)return false;
    if([0x10,0x11,0x12].includes(op)&&a[0]>1)return false;
    if([0x10,0x11].includes(op)&&![1,2].includes(a[1]))return false;
    if([0x13,0x23].includes(op)&&![1,2,3].includes(a[0]))return false;
    if([0x20,0x21].includes(op)&&(a[0]<1||a[0]>4))return false;
    if(op===0x10&&(read32(a,2)<1||read32(a,2)>0x7fffffff))return false;
    if(op===0x20&&(read32(a,1)<1||read32(a,1)>0x7fffffff))return false;
    if(op===0x30&&(a[0]>2||a[1]>1||a[2]>100))return false;
    if(op===0x32&&(a[0]<1||a[0]>5))return false;
    if(op===0x34&&(a[0]<1||a[0]>4))return false;
    if([0x40,0x50,0x51,0x55].includes(op)&&(a[0]<1||a[0]>10))return false;
    return op!==0x41||a[0]<=100;
  }
  function encode(message,response=false){
    const {kind,group=0,opcode=0,task=0,args=[]}=message;
    const lo=message.sessionLo??message.session?.lo,hi=message.sessionHi??message.session?.hi;
    const reply=response||kind>=0x80;
    if(!integer(kind,255)||!(kind&0x7f)||((kind&0x7f)>18)||!integer(group,4)||!integer(opcode,255)||
      !integer(lo,0xffffffff)||!integer(hi,0xffffffff)||!(lo||hi)||!integer(task,0xffffffff)||!bytes(args)||
      args.length>(reply?24:16)||Array.from(args).some(n=>!integer(n,255)))throw failure('无效的多程序组消息。');
    const payload=[1,reply?(kind|0x80):kind,group,opcode,...u32(lo),...u32(hi),...u32(task),...args];
    const result=[0x5a,reply?0x98:0x97,reply?0x97:0x98,payload.length,reply?0xd4:0xc4,...payload];
    result.push(result.reduce((sum,n)=>sum+n,0)&255,0xa5);return Uint8Array.from(result);
  }
  function decode(input){
    const a=Uint8Array.from(input||[]),n=a[3],reply=a[4]===0xd4;
    if(a.length<23||n<16||n>40||a.length!==n+7||a[0]!==0x5a||a[1]!== (reply?0x98:0x97)||
      a[2]!== (reply?0x97:0x98)||(!reply&&a[4]!==0xc4)||a[a.length-1]!==0xa5||
      (a.slice(0,-2).reduce((sum,v)=>sum+v,0)&255)!==a[a.length-2]||a[5]!==1)throw failure('多程序组帧校验失败。');
    const result={version:1,kind:a[6],group:a[7],opcode:a[8],sessionLo:read32(a,9),sessionHi:read32(a,13),task:read32(a,17),args:Array.from(a.slice(21,-2)),response:reply};
    if(!(result.sessionLo||result.sessionHi)||result.group>4||(result.kind&0x7f)<1||(result.kind&0x7f)>18||Boolean(result.kind&0x80)!==reply)throw failure('多程序组身份无效。');
    if(reply){if(result.args.length<2||result.args[0]<1||result.args[0]>8||result.args[1]>9)throw failure('多程序组状态无效。');result.state=result.args[0];result.reason=result.args[1];result.extra=result.args.slice(2);}
    return result;
  }
  class Receiver{
    constructor(onFrame,{now=()=>Date.now(),partialMs=500}={}){this.onFrame=onFrame;this.now=now;this.partialMs=partialMs;this.buffer=[];this.lastChunk=0;}
    feed(data){
      const now=this.now();if(this.buffer.length&&now-this.lastChunk>this.partialMs)this.buffer=[];this.lastChunk=now;
      for(const byte of data){
        this.buffer.push(byte);
        while(this.buffer.length>=5){
          const b=this.buffer;
          if(b[0]!==0x5a||b[1]!==0x98||b[2]!==0x97||b[4]!==0xd4||b[3]<16||b[3]>40){b.shift();continue;}
          if(b.length<b[3]+7)break;
          const packet=Uint8Array.from(b.splice(0,b[3]+7));try{decode(packet);this.onFrame(packet);}catch(_){}
        }
      }
    }
    reset(){this.buffer=[];this.lastChunk=0;}
  }
  const leaseOps=new Set([0x11,0x21,0x50]),speechOps=new Set([0x50,0x51,0x55]),voiceWaitOps=new Set([0x51,0x55]);
  const key=m=>`${m.kind&0x7f}:${m.group}:${m.opcode}:${m.task}`;
  function responseError(m){return Object.assign(failure(reasons[m.reason]||'设备已中止程序。',m.reason===REASON.ASR?'ASR_UNSUPPORTED':m.reason===REASON.EXPIRED?'EXPIRED':m.state===STATE.CANCELLED?'CANCELLED':'DEVICE'),{group:m.group,task:m.task,opcode:m.opcode,state:m.state,reason:m.reason});}
  function doneState(state){return [STATE.DONE,STATE.APPLIED,STATE.RELEASED].includes(state);}
  function clearTimers(entry){for(const timer of entry.timers.values())clearTimeout(timer);entry.timers.clear();}
  class SessionClient{
    constructor(link,{crypto=globalThis.crypto,timing={},onState=()=>{},onAbort=()=>{}}={}){
      if(!link?.subscribeMulti||!link?.write)throw failure('连接不支持多程序组传输。','UNSUPPORTED');
      this.link=link;this.crypto=crypto;this.timing={queueMs:2500,acceptMs:1200,retryMs:1000,controlMs:1200,retries:2,readyMs:8000,taskMs:60000,queryMs:1000,statusMs:5000,...timing};
      this.onState=onState;this.onAbort=onAbort;this.phase='idle';this.epoch=0;this.disposed=false;this.abortNotified=false;
      this.sessionLo=0;this.sessionHi=0;this.counter=0;this.mask=0;this.controls=new Map();this.records=new Map();this.pcBusy=new Set();this.ended=new Set();this.ending=new Set();this.actionQueue=[];this.accepting=null;this.acks=new Map();this.stopPromise=null;
      this.reusable=false;this.invocations=new Map();
      // The device may spend eight seconds confirming real audio cleanup.
      // Reserve transport headroom; an ACCEPTED reply never starts a new limit.
      this.timing.finishMs=Math.max(10000,this.timing.finishMs||10000);
      this.timing.finishPollMs=Math.max(1,this.timing.finishPollMs||Math.min(500,this.timing.queryMs));
      this.unsub=link.subscribeMulti(packet=>this.receive(packet));
      this.offLifecycle=link.onLifecycle?.(reason=>this.invalidate(reason));
      this.offMulti=link.onMultiLifecycle?.(reason=>this.invalidate(reason));
    }
    get active(){return ['opening','active','closing'].includes(this.phase);}
    current(epoch=this.epoch){return !this.disposed&&!this.link.closed&&epoch===this.epoch;}
    nextTask(){if(this.counter>=0xffffffff)throw failure('程序任务编号已耗尽，请重新运行。','EXHAUSTED');return ++this.counter;}
    message(kind,group=0,opcode=0,task=0,args=[]){return {kind,group,opcode,task,args,sessionLo:this.sessionLo,sessionHi:this.sessionHi};}
    arm(entry,name,ms,fn){clearTimeout(entry.timers.get(name));entry.timers.delete(name);if(ms>0){const timer=setTimeout(()=>{entry.timers.delete(name);fn();},ms);entry.timers.set(name,timer);}}
    disarm(entry,name){clearTimeout(entry.timers.get(name));entry.timers.delete(name);}
    cancelAll(error){
      for(const entry of this.controls.values()){clearTimers(entry);entry.reject(error);}this.controls.clear();
      for(const entry of new Set([...this.records.values(),...this.actionQueue,...(this.accepting?[this.accepting]:[])])){clearTimers(entry);if(!entry.pcDone){entry.pcDone=true;entry.reject(error);}}
      this.actionQueue=[];this.accepting=null;this.pcBusy.clear();
      for(const state of this.invocations.values())state.phase='cancelled';
    }
    notifyAbort(error){if(this.abortNotified)return;this.abortNotified=true;try{this.onAbort(error);}catch(_) {}}
    invalidate(reason='连接或设备模式已变化。'){
      if(this.disposed||['closed','idle','failed','stopping'].includes(this.phase))return;
      const error=reason instanceof Error?reason:failure(String(reason),'CANCELLED');this.phase='failed';this.epoch++;this.cancelAll(error);this.notifyAbort(error);
    }
    fatal(error,sendStop=true){
      if(this.disposed||['closed','failed','stopping'].includes(this.phase))return;
      this.phase='failed';this.epoch++;this.cancelAll(error);
      if(sendStop&&this.sessionLo+this.sessionHi&&this.openSent)this.stop(error).catch(()=>{});
      this.notifyAbort(error);
    }
    write(message,guard,beforeWrite=()=>{},priority=10){return this.link.write(encode(message),guard,beforeWrite,{priority});}
    queueTimeout(message,text){
      return Object.assign(failure(text,'QUEUE_TIMEOUT'),{kind:message.kind,group:message.group,task:message.task,opcode:message.opcode,
        queueDepth:this.link.writeJobs?.length??0,writerActive:Boolean(this.link.writerRunning)});
    }
    request(message,expected,{priority=5,timeout=this.timing.controlMs,waitFinish=false,onPending=()=>{}}={}){
      const k=key(message);if(this.controls.has(k))return this.controls.get(k).promise;
      const epoch=this.epoch,entry={...message,timers:new Map(),attempts:0,sent:false};
      entry.promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});entry.promise.catch(()=>{});this.controls.set(k,entry);
      const finishError=error=>{if(this.controls.get(k)!==entry)return;this.controls.delete(k);clearTimers(entry);entry.reject(error);};
      entry.expected=expected;entry.finishError=finishError;
      const valid=()=>this.current(epoch)&&this.controls.get(k)===entry;
      const attempt=()=>{
        if(!valid())return;entry.attempts++;
        this.arm(entry,'queue',this.timing.queueMs,()=>finishError(this.queueTimeout(message,'程序消息排队超时。')));
        this.write(message,valid,()=>{
          if(!valid())return;entry.sent=true;this.disarm(entry,'queue');
          if(message.kind===KIND.START)this.openSent=true;
          if(waitFinish&&!entry.started){entry.started=true;this.arm(entry,'overall',this.timing.finishMs,()=>finishError(failure('程序组结束未确认，已请求停止。','FINISH_TIMEOUT')));}
          this.arm(entry,'response',timeout,()=>{
            if(entry.attempts<=this.timing.retries)attempt();else finishError(failure('设备未确认多程序组请求。','TIMEOUT'));
          });
        },priority).then(sent=>{if(!sent&&valid())finishError(failure('程序消息已取消。','CANCELLED'));},finishError);
      };
      if(waitFinish)entry.pending=()=>{
        this.disarm(entry,'response');this.disarm(entry,'queue');entry.attempts=0;
        try{onPending();}catch(error){finishError(error);return;}
        this.arm(entry,'poll',this.timing.finishPollMs,attempt);
      };
      attempt();return entry.promise;
    }
    async open(groupCount,{initialGroups=Array.from({length:groupCount},(_,index)=>index+1)}={}){
      if(this.phase!=='idle'||this.disposed)throw failure('运行会话不能重复打开。','BUSY');
      if(!integer(groupCount,4)||groupCount<1)throw failure('最多可运行4个带开始头的程序组。','LIMIT');
      if(!Array.isArray(initialGroups)||!initialGroups.length||initialGroups.length>groupCount||
          new Set(initialGroups).size!==initialGroups.length||initialGroups.some(group=>!integer(group,groupCount)||group<1))
        throw failure('初始程序组身份无效。','PARAM');
      const linkToken=this.link.programLinkToken;
      if(!integer(linkToken,0xffffffff)||!linkToken||typeof this.link.nextProgramRunSerial!=='function')
        throw failure('编程连接尚未准备好，请重新进入编程模式。','MODE');
      const runSerial=this.link.nextProgramRunSerial();
      if(!integer(runSerial,0xffffffff)||!runSerial)throw failure('无法创建新的运行编号，请重新连接设备。','EXHAUSTED');
      this.sessionLo=runSerial;this.sessionHi=linkToken;this.counter=4;this.phase='opening';this.mask=(1<<groupCount)-1;
      this.reusable=true;const epoch=this.epoch,initialMask=initialGroups.reduce((mask,group)=>mask|(1<<(group-1)),0);
      try{
        const reply=await this.request(this.message(KIND.START,0,0,0,[initialMask]),[STATE.READY]);
        if(!this.current(epoch))throw failure('运行已取消。','CANCELLED');
        if(reply.extra.length!==0)throw failure('设备启动反馈长度无效。','PROTOCOL');
        for(let group=1;group<=groupCount;group++)this.invocations.set(group,{phase:initialGroups.includes(group)?'running':'idle',id:initialGroups.includes(group)?group:0,lastFinishedId:0});
        this.phase='active';return {reusable:true,initialGroups:initialGroups.slice()};
      }catch(error){this.fatal(error,Boolean(this.openSent));throw error;}
    }
    action(group,opcode,args=[],options={}){
      if(this.phase!=='active'||this.disposed)return Promise.reject(failure('多程序组尚未准备好。','MODE'));
      if(!integer(group,4)||group<1||!(this.mask&(1<<(group-1)))||this.ended.has(group)||this.ending.has(group))return Promise.reject(failure('程序组身份无效。'));
      if(this.pcBusy.has(group))return Promise.reject(failure('此程序组仍在等待上一任务。','BUSY'));
      const invocation=this.invocations.get(group);
      if(this.reusable&&(!invocation||invocation.phase!=='running'||options.invocationId!==invocation.id))return Promise.reject(failure('积木所属程序组运行已失效。','STALE'));
      if(!actionArgs(opcode,args))return Promise.reject(failure('积木参数不能转换为多程序组动作。','PARAM'));
      const rec={...this.message(KIND.ACTION,group,opcode,0,Array.from(args)),options,invocationId:invocation?.id||0,epoch:this.epoch,timers:new Map(),sent:false,attempts:0,state:0,accepted:false,pcDone:false,lease:false,terminal:false,lastReply:0};
      rec.promise=new Promise((resolve,reject)=>{rec.resolve=resolve;rec.reject=reject;});rec.promise.catch(()=>{});
      this.pcBusy.add(group);this.actionQueue.push(rec);
      if(!this.waitingForAudio(rec))this.arm(rec,'queue',this.timing.queueMs,()=>this.fatal(this.queueTimeout(rec,'程序动作排队超时。')));
      this.pumpActions();return rec.promise;
    }
    waitingForAudio(rec){return rec.opcode===0x50&&[...this.records.values()].some(other=>other.group===rec.group&&other.opcode===0x50&&other.lease&&!other.terminal);}
    pumpActions(){
      if(this.accepting||this.phase!=='active'||this.disposed)return;
      // Audio replacement is resource-blocked until the old lease releases.
      // It has no dispatch identity yet and must not starve another group.
      // The first eligible entry still owns the single acceptance permit and
      // receives its globally increasing identity only here, never at enqueue.
      const index=this.actionQueue.findIndex((rec,at)=>!this.ending.has(rec.group)&&!this.ended.has(rec.group)&&!this.waitingForAudio(rec)&&
        (!this.reusable||!this.actionQueue.slice(0,at).some(older=>older.group===rec.group)));if(index<0)return;
      const rec=this.actionQueue.splice(index,1)[0];
      try{if(rec.kind!==KIND.GROUP_FINISH)rec.task=this.nextTask();}catch(error){this.actionQueue.push(rec);this.fatal(error);return;}
      this.accepting=rec;
      if(rec.kind!==KIND.ACTION){this.dispatchLifecycle(rec);return;}
      this.records.set(rec.task,rec);this.accepting=rec;
      if(!rec.timers.has('queue'))this.arm(rec,'queue',this.timing.queueMs,()=>this.fatal(this.queueTimeout(rec,'程序动作排队超时。')));
      this.sendAction(rec);
    }
    validRecord(rec){const state=this.invocations.get(rec.group);return this.current(rec.epoch)&&this.records.get(rec.task)===rec&&!rec.terminal&&this.phase==='active'&&
      (!this.reusable||state?.id===rec.invocationId&&['running','finishing'].includes(state.phase));}
    lifecycleJob(kind,group,state){
      const rec={...this.message(kind,group,0,kind===KIND.GROUP_FINISH?state.id:0),epoch:this.epoch,timers:new Map(),pcDone:false,stateRef:state};
      rec.promise=new Promise((resolve,reject)=>{rec.resolve=resolve;rec.reject=reject;});rec.promise.catch(()=>{});
      this.actionQueue.push(rec);
      this.arm(rec,'queue',this.timing.queueMs,()=>this.fatal(this.queueTimeout(rec,'程序组生命周期消息排队超时。')));
      this.pumpActions();return rec.promise;
    }
    releaseDispatch(rec){if(this.accepting===rec){this.accepting=null;this.pumpActions();}}
    dispatchLifecycle(rec){
      const state=rec.stateRef;if(rec.kind===KIND.GROUP_BEGIN)state.id=rec.task;
      clearTimers(rec);
      const pending=()=>this.releaseDispatch(rec);
      this.request(this.message(rec.kind,rec.group,0,rec.task),rec.kind===KIND.GROUP_BEGIN?[STATE.READY]:[STATE.DONE],
        {priority:10,waitFinish:rec.kind===KIND.GROUP_FINISH,onPending:pending}).then(message=>{
        if(rec.pcDone||!this.current(rec.epoch)||this.invocations.get(rec.group)!==state||state.id!==rec.task)return;
        if(rec.kind===KIND.GROUP_BEGIN)state.phase='running';
        else{
          for(const action of this.records.values())if(action.group===rec.group&&action.invocationId===rec.task){
            clearTimers(action);action.terminal=true;action.lease=false;
            if(!action.pcDone){action.pcDone=true;action.reject(failure('程序组运行已结束。','CANCELLED'));}
          }
          this.pcBusy.delete(rec.group);state.phase='idle';state.lastFinishedId=rec.task;state.lastResult=message;state.id=0;
        }
        rec.pcDone=true;this.releaseDispatch(rec);rec.resolve(rec.kind===KIND.GROUP_BEGIN?rec.task:message);
      },error=>{if(!rec.pcDone){rec.pcDone=true;rec.reject(error);}if(this.current(rec.epoch))this.fatal(error);});
    }
    beginGroup(group){
      if(!this.reusable||this.phase!=='active'||this.disposed)return Promise.reject(failure('会话未启用可复用程序组。','UNSUPPORTED'));
      const state=this.invocations.get(group);
      if(!state)return Promise.reject(failure('程序组身份无效。','PARAM'));
      if(state.phase!=='idle')return Promise.reject(failure('程序组仍在运行或结束中。','BUSY'));
      state.phase='beginning';return this.lifecycleJob(KIND.GROUP_BEGIN,group,state);
    }
    finishGroup(group,id){
      if(!this.reusable||this.phase!=='active'||this.disposed)return Promise.reject(failure('会话未启用可复用程序组。','UNSUPPORTED'));
      const state=this.invocations.get(group);
      if(!state||!integer(id,0xffffffff)||!id)return Promise.reject(failure('程序组运行身份无效。','PARAM'));
      if(state.phase==='idle'&&state.lastFinishedId===id)return Promise.resolve(state.lastResult);
      if(state.id!==id)return Promise.reject(failure('程序组运行已失效。','STALE'));
      if(state.phase==='finishing')return state.finishPromise;
      if(state.phase!=='running')return Promise.reject(failure('程序组尚未开始。','MODE'));
      state.phase='finishing';state.finishPromise=this.lifecycleJob(KIND.GROUP_FINISH,group,state);return state.finishPromise;
    }
    sendAction(rec){
      if(!this.validRecord(rec)||rec.accepted)return;
      rec.attempts++;
      this.write(rec,()=>this.validRecord(rec)&&!rec.accepted,()=>{
        if(!this.validRecord(rec))return;rec.sent=true;this.disarm(rec,'queue');
        rec.options.onDispatched?.(rec);
        if(!rec.firstSent){rec.firstSent=Date.now();if(speechOps.has(rec.opcode))this.arm(rec,'ready',this.timing.readyMs,()=>this.fatal(Object.assign(failure('语音任务准备超时。','READY_TIMEOUT'),{group:rec.group,task:rec.task})));}
        this.arm(rec,'accept',this.timing.acceptMs,()=>{
          if(rec.accepted||!this.validRecord(rec))return;
          if(rec.attempts<=this.timing.retries)this.sendAction(rec);else this.fatal(Object.assign(failure('设备未受理程序动作。','ACCEPT_TIMEOUT'),{group:rec.group,task:rec.task}));
        });
      }).then(sent=>{if(!sent&&this.validRecord(rec)&&!rec.accepted)this.fatal(failure('程序动作尚未发送便已取消。','CANCELLED'));},error=>this.fatal(error));
    }
    accepted(rec,message){
      if(rec.accepted)return;rec.accepted=true;this.disarm(rec,'accept');
      if(this.accepting===rec){this.accepting=null;this.pumpActions();}
      try{rec.options.onAccepted?.(message);}catch(error){this.fatal(error);return;}
      if(!speechOps.has(rec.opcode))this.armCompletion(rec);
      this.poll(rec);
    }
    armCompletion(rec){
      if(rec.completionArmed)return;rec.completionArmed=true;
      const motorMs=rec.opcode===0x10?read32(rec.args,2):rec.opcode===0x20?read32(rec.args,1):0;
      const timeout=rec.options.timeoutMs??(voiceWaitOps.has(rec.opcode)?this.timing.taskMs:motorMs?motorMs+5000:0);
      this.arm(rec,'task',timeout,()=>this.fatal(Object.assign(failure('程序等待超时，已请求停止。','TASK_TIMEOUT'),{group:rec.group,task:rec.task,opcode:rec.opcode})));
    }
    poll(rec){
      if(!this.validRecord(rec)||rec.terminal||rec.pcDone&&!rec.lease)return;
      this.arm(rec,'poll',this.timing.queryMs,()=>{
        if(!this.validRecord(rec))return;
        if(Date.now()-rec.lastReply>this.timing.statusMs){this.fatal(Object.assign(failure('设备任务状态无法确认。','STATUS_TIMEOUT'),{group:rec.group,task:rec.task}));return;}
        this.write(this.message(KIND.QUERY,rec.group,0,rec.task),()=>this.validRecord(rec),()=>{},5).catch(error=>this.fatal(error));this.poll(rec);
      });
    }
    ack(message){
      const id=`${message.group}:${message.opcode}:${message.task}:${message.state}`;if(this.acks.has(id)||this.disposed||this.link.closed)return;
      const epoch=this.epoch;
      const promise=this.write(this.message(KIND.ACK,message.group,message.opcode,message.task,[message.state]),()=>message.state===STATE.ABORTED&&message.group===0?this.current():this.current(epoch),()=>{},2);
      this.acks.set(id,promise);promise.catch(error=>{if(this.phase==='active')this.fatal(error);}).finally(()=>{if(this.acks.get(id)===promise)this.acks.delete(id);});
    }
    receive(packet){
      if(this.disposed||this.phase==='closed'||this.phase==='idle')return;
      let message;try{message=decode(packet);}catch(_){return;}
      if(!message.response||message.sessionLo!==this.sessionLo||message.sessionHi!==this.sessionHi)return;
      const kind=message.kind&0x7f;
      // Independent observers have a separate identity/owner and must never
      // satisfy, cancel or fault a group's current PC action.
      if(kind>=KIND.OBSERVER_ARM&&kind<=KIND.OBSERVER_ACK)return;
      if(kind===KIND.STOP&&message.group===0&&message.opcode===0&&message.task===0&&message.state===STATE.ABORTED){
        this.ack(message);const error=responseError(message);if(message.extra.length===5){error.group=message.extra[0];error.task=read32(message.extra,1);const original=this.records.get(error.task);if(original?.group===error.group)error.opcode=original.opcode;}this.fatal(error,false);return;
      }
      const control=this.controls.get(key(message));
      if(control&&control.sent){
        if(control.pending&&(message.state===STATE.ACCEPTED&&message.reason===0||message.state===STATE.FAILED&&message.reason===REASON.BUSY)){control.pending();return;}
        if([STATE.FAILED,STATE.CANCELLED,STATE.ABORTED].includes(message.state)&&!control.expected.includes(message.state)){control.finishError(responseError(message));return;}
        if(control.expected.includes(message.state)&&message.reason===0){this.controls.delete(key(message));clearTimers(control);control.resolve(message);}return;
      }
      if(![KIND.ACTION,KIND.QUERY].includes(kind)||this.phase!=='active')return;
      const rec=this.records.get(message.task);if(!rec||!rec.sent||rec.group!==message.group||rec.opcode!==message.opcode)return;
      rec.lastReply=Date.now();this.ack(message);
      if(rec.terminal)return;
      if([STATE.FAILED,STATE.CANCELLED,STATE.ABORTED].includes(message.state)){
        const invocation=this.invocations.get(rec.group);
        const finishing=this.reusable&&invocation?.phase==='finishing'&&invocation.id===rec.invocationId&&message.reason===0;
        if(message.state===STATE.CANCELLED&&(this.ending.has(rec.group)||this.ended.has(rec.group)||finishing)){
          this.completeRecord(rec,message,true);return;
        }
        this.fatal(responseError(message));return;
      }
      if(message.reason!==0){this.fatal(responseError(message));return;}
      if(rec.terminal||message.state===rec.state)return;
      if(rec.state===STATE.APPLIED&&message.state!==STATE.RELEASED||rec.state===STATE.READY&&message.state===STATE.ACCEPTED)return;
      const valid=message.state===STATE.ACCEPTED||message.state===STATE.READY&&voiceWaitOps.has(rec.opcode)||
        message.state===STATE.DONE&&!leaseOps.has(rec.opcode)||message.state===STATE.APPLIED&&!voiceWaitOps.has(rec.opcode)&&![0x10,0x20,0x30,0x32,0x34].includes(rec.opcode)||message.state===STATE.RELEASED&&leaseOps.has(rec.opcode);
      if(!valid){this.fatal(Object.assign(failure('设备返回了动作不支持的完成状态。'),{group:rec.group,task:rec.task}));return;}
      rec.state=message.state;this.accepted(rec,message);
      if(message.state===STATE.READY){this.disarm(rec,'ready');this.armCompletion(rec);}
      try{rec.options.onState?.(message);this.onState(message);}catch(error){this.fatal(error);return;}
      if(doneState(message.state))this.completeRecord(rec,message);
    }
    completeRecord(rec,message,cancelled=false){
      this.disarm(rec,'ready');this.disarm(rec,'task');this.disarm(rec,'accept');
      rec.lease=!cancelled&&message.state===STATE.APPLIED&&leaseOps.has(rec.opcode);
      rec.terminal=!rec.lease;
      if(!rec.pcDone){rec.pcDone=true;this.pcBusy.delete(rec.group);if(cancelled)rec.reject(responseError(message));else rec.resolve(message);}
      if(rec.terminal)clearTimers(rec);else this.poll(rec);
      // Keep terminal identities long enough to ACK repeats without advancing PC.
      const removable=[...this.records.values()].filter(item=>item.terminal);
      while(this.records.size>16&&removable.length)this.records.delete(removable.shift().task);
      this.pumpActions();
    }
    endGroup(group){
      const state=this.invocations.get(group);
      if(!state)return Promise.reject(failure('程序组身份无效。','PARAM'));
      if(state.phase==='idle'&&state.lastFinishedId)return Promise.resolve(state.lastResult);
      return this.finishGroup(group,state.id);
    }
    async close(){
      if(this.phase==='closed')return;
      if(this.phase!=='active'||(this.reusable?[...this.invocations.values()].some(state=>state.phase!=='idle'):this.ended.size!==this.mask.toString(2).replace(/0/g,'').length))throw failure('仍有程序组未结束。','BUSY');
      this.phase='closing';
      try{const result=await this.request(this.message(KIND.CLOSE),[STATE.DONE]);this.phase='closed';this.detach();return result;}catch(error){this.fatal(error);throw error;}
    }
    stop(reason='程序已停止。'){
      if(this.stopPromise)return this.stopPromise;
      if(this.disposed||this.phase==='closed')return Promise.resolve();
      const error=reason instanceof Error?reason:failure(String(reason),'CANCELLED');
      this.phase='stopping';this.epoch++;this.cancelAll(error);
      if(!this.openSent||this.link.closed){this.phase='closed';this.detach();return Promise.resolve();}
      this.stopPromise=this.request(this.message(KIND.STOP),[STATE.CANCELLED,STATE.DONE],{priority:0}).then(result=>{this.phase='closed';this.detach();return result;},async cause=>{
        // No STOP receipt means we cannot report that the outputs stopped. Fence
        // this SID, stop the one heartbeat and retire the physical connection
        // before the coordinator releases its run mutex. Never keep a live legacy
        // heartbeat feeding an orphaned continuous motor/audio lease.
        const error=Object.assign(failure('设备停止未确认，已关闭本地连接，请检查设备是否停止。','STOP_UNCONFIRMED'),{cause,stopConfirmed:false,connectionInvalidated:true});
        this.phase='failed';this.epoch++;this.detach();this.cancelAll(error);
        try{this.link.stopHeartbeat?.();if(!this.link.closed){if(typeof this.link.close==='function')this.link.close();else this.link.closed=true;}}
        catch(closeError){this.link.closed=true;error.closeError=closeError;}
        if(!this.disconnectPromise){this.disconnectPromise=Promise.resolve().then(()=>this.link.transport?.disconnect?.());this.disconnectPromise.catch(()=>{});}
        try{await this.disconnectPromise;}catch(disconnectError){error.disconnectError=disconnectError;}
        throw error;
      });
      this.stopPromise.catch(()=>{});return this.stopPromise;
    }
    detach(){this.unsub?.();this.offLifecycle?.();this.offMulti?.();this.unsub=this.offLifecycle=this.offMulti=null;}
    dispose(reason='运行会话已释放。'){
      if(this.disposed)return;this.disposed=true;this.epoch++;this.cancelAll(failure(String(reason),'CANCELLED'));this.phase='closed';this.detach();this.records.clear();this.acks.clear();
    }
  }
  return {KIND,STATE,REASON,encode,decode,Receiver,SessionClient,actionArgs,read32,u32};
});
