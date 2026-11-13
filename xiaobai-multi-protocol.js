/* XiaoBai frame codecs and version 2 streamed programming client. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.XiaobaiMultiProtocol=api;
})(globalThis,function(){
  'use strict';
  const KIND=Object.freeze({CAPS:1,OPEN:2,GROUP_OPEN:3,ACTION:4,QUERY:5,GROUP_END:6,CLOSE:7,STOP:8,HEARTBEAT:9,ACK:10,COMMIT:11,
    OBSERVER_ARM:12,OBSERVER_QUERY:13,OBSERVER_CLOSE:14,OBSERVER_ACK:15,GROUP_BEGIN:16,GROUP_FINISH:17,START:18,SENSOR:21});
  const STATE=Object.freeze({ACCEPTED:1,READY:2,DONE:3,APPLIED:4,FAILED:5,CANCELLED:6,RELEASED:7,ABORTED:8});
  const REASON=Object.freeze({NONE:0,PARAM:1,MODE:2,BUSY:3,STALE:4,CONFLICT:5,ASR:6,SENSOR:7,TIMEOUT:8,EXPIRED:9});
  const reasons=['','参数无效','设备模式不符','设备忙碌','任务已失效','程序组资源冲突','语音模块不可用','传感器不可用','任务超时','任务记录已过期'];
  const failure=(message,code='PROTOCOL')=>Object.assign(new Error(message),{code});
  const u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
  const read32=(a,i=0)=>(a[i]|a[i+1]<<8|a[i+2]<<16|a[i+3]<<24)>>>0;
  const integer=(n,max)=>Number.isInteger(n)&&n>=0&&n<=max;
  const bytes=a=>Array.isArray(a)||a instanceof Uint8Array;
  function actionArgs(op,a,version=1){
    if(version===2&&([0x30,0x32].includes(op)||(op===0x34&&a?.[0]<3)))return false;
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
    const reply=response||kind>=0x80,version=message.version??1;
    if(!integer(kind,255)||!(kind&0x7f)||((kind&0x7f)>(version===2?21:18))||![1,2].includes(version)||version===2&&(!lo||!hi)||!integer(group,4)||!integer(opcode,255)||
      !integer(lo,0xffffffff)||!integer(hi,0xffffffff)||!(lo||hi)||!integer(task,0xffffffff)||!bytes(args)||
      args.length>(reply?24:16)||Array.from(args).some(n=>!integer(n,255)))throw failure('无效的多程序组消息。');
    const payload=[version,reply?(kind|0x80):kind,group,opcode,...u32(lo),...u32(hi),...u32(task),...args];
    const result=[0x5a,reply?0x98:0x97,reply?0x97:0x98,payload.length,reply?0xd4:0xc4,...payload];
    result.push(result.reduce((sum,n)=>sum+n,0)&255,0xa5);return Uint8Array.from(result);
  }
  function decode(input){
    const a=Uint8Array.from(input||[]),n=a[3],reply=a[4]===0xd4;
    if(a.length<23||n<16||n>40||a.length!==n+7||a[0]!==0x5a||a[1]!== (reply?0x98:0x97)||
      a[2]!== (reply?0x97:0x98)||(!reply&&a[4]!==0xc4)||a[a.length-1]!==0xa5||
      (a.slice(0,-2).reduce((sum,v)=>sum+v,0)&255)!==a[a.length-2]||![1,2].includes(a[5]))throw failure('多程序组帧校验失败。');
    const result={version:a[5],kind:a[6],group:a[7],opcode:a[8],sessionLo:read32(a,9),sessionHi:read32(a,13),task:read32(a,17),args:Array.from(a.slice(21,-2)),response:reply};
    if(!(result.sessionLo||result.sessionHi)||result.version===2&&(!result.sessionLo||!result.sessionHi)||result.group>4||(result.kind&0x7f)<1||(result.kind&0x7f)>(result.version===2?21:18)||Boolean(result.kind&0x80)!==reply)throw failure('多程序组身份无效。');
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
  // Version 2 sends ordinary controls once. Only START, STOP and actual
  // recognition tasks need device results. The shared Link owns physical pacing.
  class SessionClient {
    constructor(link, {timing={},onState=()=>{},onAbort=()=>{},onSensor=()=>{}}={}) {
      if(!link?.subscribeMulti||!link?.write)throw failure('连接不支持小白程序传输。','UNSUPPORTED');
      this.link=link;this.onState=onState;this.onAbort=onAbort;this.onSensor=onSensor;
      this.timing={controlMs:1500,retries:2,taskMs:60000,queryMs:700,...timing};
      this.phase='idle';this.counter=4;this.epoch=0;this.controls=new Map();this.records=new Map();this.actions=new Map();this.invocations=new Map();
      this.sensor=null;this.sensorListeners=new Set();this.disposed=false;this.openSent=false;
      this.unsub=link.subscribeMulti(packet=>this.receive(packet));
      this.offLifecycle=link.onLifecycle?.(reason=>this.invalidate(reason));
      this.offMulti=link.onMultiLifecycle?.(reason=>this.invalidate(reason));
    }
    get active(){return this.phase==='active';}
    current(epoch=this.epoch){return !this.disposed&&!this.link.closed&&this.epoch===epoch;}
    nextTask(){if(this.counter>=0xffffffff)throw failure('程序编号已耗尽，请重新运行。','EXHAUSTED');return ++this.counter;}
    message(kind,group=0,opcode=0,task=0,args=[]){return {version:2,kind,group,opcode,task,args,sessionLo:this.sessionLo,sessionHi:this.sessionHi};}
    async write(message,guard=()=>true,priority=10,before=()=>{}){
      const epoch=this.epoch;
      const sent=await this.link.write(encode(message),()=>this.current(epoch)&&guard(),before,{priority});
      if(!sent)throw failure('指令已取消。','CANCELLED');
      return sent;
    }
    request(message,expected){
      const key=message.kind+':'+message.group+':'+message.task,epoch=this.epoch;
      const entry={message,expected,attempts:0,sent:false,timer:null};
      const result=new Promise((resolve,reject)=>Object.assign(entry,{resolve,reject}));
      result.catch(()=>{});this.controls.set(key,entry);
      const reject=error=>{if(this.controls.get(key)!==entry)return;this.controls.delete(key);clearTimeout(entry.timer);entry.reject(error);};
      const send=()=>{
        entry.attempts++;
        this.write(message,()=>this.controls.get(key)===entry,message.kind===KIND.STOP?0:10,()=>{entry.sent=true;this.openSent ||= message.kind===KIND.START;})
          .then(()=>{
            if(this.controls.get(key)!==entry)return;
            entry.timer=setTimeout(()=>{
              if(entry.attempts<=this.timing.retries&&this.current(epoch))send();
              else reject(failure('设备未确认程序启动或停止。','TIMEOUT'));
            },this.timing.controlMs);
          },reject);
      };
      send();return result;
    }
    async open(groupCount,{initialGroups=Array.from({length:groupCount},(_,i)=>i+1)}={}){
      if(this.phase!=='idle'||this.disposed)throw failure('程序会话已经打开。','BUSY');
      if(!integer(groupCount,4)||groupCount<1||!Array.isArray(initialGroups)||
         new Set(initialGroups).size!==initialGroups.length||initialGroups.some(g=>!integer(g,groupCount)||g<1))
        throw failure('程序组无效。','GROUP');
      const token=this.link.programLinkToken,serial=this.link.nextProgramRunSerial?.();
      if(!integer(token,0xffffffff)||!token||!integer(serial,0xffffffff)||!serial)
        throw failure('请重新进入编程模式。','MODE');
      this.sessionLo=serial;this.sessionHi=token;this.groupCount=groupCount;this.phase='opening';
      for(let g=1;g<=groupCount;g++)this.invocations.set(g,{id:initialGroups.includes(g)?g:0,phase:initialGroups.includes(g)?'running':'idle'});
      const openEpoch=this.epoch;
      try{
        await this.request(this.message(KIND.START,0,0,0,[initialGroups.reduce((mask,g)=>mask|1<<(g-1),0)]),[STATE.READY]);
        if(!this.current(openEpoch)||this.phase!=='opening')throw failure('程序启动已取消。','CANCELLED');
        this.phase='active';return {reusable:true,initialGroups:initialGroups.slice()};
      }catch(error){if(this.current(openEpoch)&&this.phase==='opening')this.invalidate(error);throw error;}
    }
    checkGroup(group){if(this.phase!=='active'||!this.invocations.has(group))throw failure('程序组尚未启动。','MODE');}
    cancelRecords(group,reason='本组脚本已停止。'){
      for(const [id,rec] of this.records)if(rec.message.group===group){this.records.delete(id);clearTimeout(rec.timer);clearInterval(rec.poll);rec.reject(failure(reason,'CANCELLED'));}
    }
    async beginGroup(group){
      this.checkGroup(group);this.cancelRecords(group);
      const id=this.nextTask(),state={id,phase:'running'};this.invocations.set(group,state);
      await this.write(this.message(KIND.GROUP_BEGIN,group,0,id),()=>this.invocations.get(group)===state);
      return id;
    }
    async endGroup(group){
      this.checkGroup(group);this.cancelRecords(group);
      const id=this.nextTask(),state={id,phase:'idle'};this.invocations.set(group,state);
      await this.write(this.message(KIND.GROUP_END,group,0,id),()=>this.invocations.get(group)===state);
    }
    async finishGroup(group,id){
      this.checkGroup(group);const state=this.invocations.get(group);
      if(state.id!==id)throw failure('脚本已经重新开始。','CANCELLED');
      await this.write(this.message(KIND.GROUP_FINISH,group,0,id),()=>this.invocations.get(group)===state);
      if(this.invocations.get(group)===state)state.phase='idle';
      return {state:STATE.DONE,group,task:id};
    }
    async action(group,opcode,args=[],options={}){
      this.checkGroup(group);const state=this.invocations.get(group);
      if(state.phase!=='running'||options.invocationId!==state.id)throw failure('脚本轮次已经改变。','CANCELLED');
      if(!actionArgs(opcode,args,2))throw failure('积木参数无效。','PARAM');
      const message=this.message(KIND.ACTION,group,opcode,this.nextTask(),Array.from(args));
      const guard=()=>this.invocations.get(group)===state&&state.phase==='running'&&(!options.guard||options.guard());
      this.actions.set(message.task,{...message,invocationId:state.id,sent:false});
      for(const [oldId,old] of this.actions){
        if(this.actions.size<=64)break;
        if(!this.records.has(oldId)&&oldId!==this.audioTask)this.actions.delete(oldId);
      }
      const dispatched=()=>{if(opcode===0x50)this.audioTask=message.task;const action=this.actions.get(message.task);if(action)action.sent=true;options.onDispatched?.(message);};
      const realResult=[0x51,0x55].includes(opcode)||(opcode===0x34&&args[0]>=3);
      if(!realResult){
        await this.write(message,guard,10,dispatched);
        return {...message,state:STATE.APPLIED,localWrite:true};
      }
      const rec={message,sent:false,timer:null,poll:null};
      const result=new Promise((resolve,reject)=>Object.assign(rec,{resolve,reject}));
      result.catch(()=>{});this.records.set(message.task,rec);
      try{
        await this.write(message,guard,10,()=>{rec.sent=true;dispatched();});
        if(this.records.get(message.task)===rec){
          rec.timer=setTimeout(()=>this.finishRecord(rec,failure('等待口令或动作超时。','TIMEOUT')),options.timeoutMs||this.timing.taskMs);
          rec.poll=setInterval(()=>{
            if(!guard())return;
            this.write(this.message(KIND.QUERY,group,0,message.task),guard,5).catch(error=>this.invalidate(error));
          },this.timing.queryMs);
        }
        return await result;
      }catch(error){this.finishRecord(rec,error);throw error;}
    }
    finishRecord(rec,error,message){
      if(this.records.get(rec.message.task)!==rec)return;
      this.records.delete(rec.message.task);clearTimeout(rec.timer);clearInterval(rec.poll);
      if(error)rec.reject(error);else rec.resolve(message);
    }
    receive(packet){
      let m;try{m=decode(packet);}catch(_){return;}
      if(m.version!==2||!m.response||m.sessionLo!==this.sessionLo||m.sessionHi!==this.sessionHi)return;
      const kind=m.kind&127;
      if(kind===KIND.SENSOR){
        if(m.group||m.opcode||m.state!==STATE.APPLIED||m.reason||m.extra.length!==22||
           this.sensor&&((m.task-this.sensor.sequence)>>>0)>=0x80000000||this.sensor?.sequence===m.task)return;
        const a=m.extra,signed=i=>{const v=a[i]|a[i+1]<<8;return v&0x8000?v-0x10000:v;};
        if(a[0]>100||a[2]>6||(a[1]&0x80)||a[9]>4)return;
        this.sensor={sequence:m.task,receivedAt:Date.now(),ir:a[0],flags:a[1],tilt:a[2],
          x:signed(3),y:signed(5),z:signed(7),gesture:a[9],gestureSerial:read32(a,10),
          gestureStartedAt:read32(a,14),deviceMs:read32(a,18)};
        this.onSensor(this.sensor);for(const fn of this.sensorListeners)fn(this.sensor);return;
      }
      const controlKey=kind+':'+m.group+':'+m.task,entry=this.controls.get(controlKey);
      if(entry?.sent&&entry.message.opcode===m.opcode){
        if(entry.expected.includes(m.state)&&m.reason===0){
          this.controls.delete(controlKey);clearTimeout(entry.timer);entry.resolve(m);
        }else if([STATE.FAILED,STATE.CANCELLED,STATE.ABORTED].includes(m.state)){
          this.controls.delete(controlKey);clearTimeout(entry.timer);entry.reject(this.responseError(m));
        }
        return;
      }
      if(kind===KIND.STOP&&m.state===STATE.ABORTED){this.invalidate(this.responseError(m));return;}
      if(![KIND.ACTION,KIND.QUERY].includes(kind))return;
      const action=this.actions.get(m.task);
      if(!action?.sent||action.group!==m.group||action.opcode!==m.opcode)return;
      // Result ACKs also retire repeated real playback terminals, while they
      // never advance a script whose invocation has already been replaced.
      this.write(this.message(KIND.ACK,m.group,m.opcode,m.task,[m.state]),()=>this.phase==='active',2).catch(error=>this.invalidate(error));
      if(this.invocations.get(m.group)?.id!==action.invocationId)return;
      const rec=this.records.get(m.task);
      if(rec?.sent&&rec.message.group===m.group&&rec.message.opcode===m.opcode){
        if(m.reason||[STATE.FAILED,STATE.CANCELLED,STATE.ABORTED].includes(m.state))this.finishRecord(rec,this.responseError(m));
        else if(m.state===STATE.DONE)this.finishRecord(rec,null,m);
        this.onState(m);return;
      }
      if(m.reason||m.state===STATE.FAILED)this.invalidate(this.responseError(m));
      else this.onState(m);
    }
    responseError(m){return Object.assign(failure('主机执行异常，请检查设备后重新运行。','DEVICE'),{group:m.group,task:m.task,opcode:m.opcode,state:m.state,reason:m.reason});}
    subscribeSensor(fn){this.sensorListeners.add(fn);return()=>this.sensorListeners.delete(fn);}
    invalidate(reason){
      if(this.disposed||['closed','failed'].includes(this.phase))return;
      const error=reason instanceof Error?reason:failure(String(reason||'设备连接已变化。'),'CANCELLED');
      this.phase='failed';this.epoch++;this.sensor=null;
      for(const entry of this.controls.values()){clearTimeout(entry.timer);entry.reject(error);}this.controls.clear();
      for(const rec of [...this.records.values()])this.finishRecord(rec,error);
      this.onAbort(error);
    }
    stop(reason='程序已停止。'){
      if(this.stopPromise)return this.stopPromise;
      if(this.disposed||this.phase==='closed')return Promise.resolve();
      this.phase='stopping';this.epoch++;this.sensor=null;
      const error=failure(reason instanceof Error?reason.message:String(reason),'CANCELLED');
      for(const entry of this.controls.values()){clearTimeout(entry.timer);entry.reject(error);}this.controls.clear();
      for(const rec of [...this.records.values()])this.finishRecord(rec,error);
      this.stopPromise=(this.openSent?this.request(this.message(KIND.STOP),[STATE.DONE,STATE.CANCELLED]):Promise.resolve())
        .then(()=>{this.phase='closed';this.dispose();},async cause=>{
          this.link.stopHeartbeat?.();this.link.rejectPending?.(cause);this.link.close?.();
          await this.link.transport?.disconnect?.();this.dispose();throw cause;
        });
      this.stopPromise.catch(()=>{});return this.stopPromise;
    }
    close(){return this.stop();}
    dispose(){
      if(this.disposed)return;this.disposed=true;this.phase='closed';this.sensor=null;this.epoch++;
      for(const group of this.invocations.keys())this.cancelRecords(group);
      for(const entry of this.controls.values()){clearTimeout(entry.timer);entry.reject(failure('程序会话已关闭。','CANCELLED'));}this.controls.clear();
      this.unsub?.();this.offLifecycle?.();this.offMulti?.();this.sensorListeners.clear();
    }
  }
  return {KIND,STATE,REASON,encode,decode,Receiver,SessionClient,actionArgs,read32,u32};
});
