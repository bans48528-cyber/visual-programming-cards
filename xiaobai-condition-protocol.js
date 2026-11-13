/* Independent device-latched loop conditions. No PC actions or sampled predicates. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./xiaobai-multi-protocol.js'):root.XiaobaiMultiProtocol);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.XiaobaiConditionProtocol=api;
})(globalThis,function(M){
  'use strict';
  const KIND=Object.freeze({ARM:12,QUERY:13,CLOSE:14,ACK:15});
  const CONDITION=Object.freeze({IR_GT:1,IR_LT:2,TILT:3,TIME:4});
  const STATE=Object.freeze({READY:2,DONE:3,FAILED:5,CANCELLED:6});
  const REASON=Object.freeze({NONE:0,PARAM:1,MODE:2,BUSY:3,STALE:4,CONFLICT:5,SENSOR:7,EXPIRED:9});
  const states=new Set(Object.values(STATE)),reasons=new Set(Object.values(REASON));
  const descriptions={1:'观察条件参数无效。',2:'设备模式不符，观察已取消。',3:'设备条件观察槽已满。',4:'观察所属运行已失效。',5:'观察身份或参数冲突。',7:'传感器不可用，程序已中止。',9:'条件观察任务已过期。'};
  const fail=(message,code='CONDITION_PROTOCOL')=>Object.assign(new Error(message),{code});
  const uint=(value,max=0xffffffff)=>Number.isInteger(value)&&value>=0&&value<=max;
  const array=value=>Array.isArray(value)||value instanceof Uint8Array;
  function parameters(kind,args){
    if(!array(args)||Array.from(args).some(n=>!uint(n,255)))return false;
    if(kind===CONDITION.IR_GT||kind===CONDITION.IR_LT)return args.length===1&&args[0]<=100;
    if(kind===CONDITION.TILT)return args.length===1&&args[0]>=2&&args[0]<=5;
    return kind===CONDITION.TIME&&args.length===4&&M.read32(args)<=0x7fffffff;
  }
  function identity(m){
    return uint(m.group,4)&&uint(m.opcode,4)&&m.opcode>=1&&uint(m.task)&&m.task>0&&
      uint(m.sessionLo)&&uint(m.sessionHi)&&(m.sessionLo||m.sessionHi)&&
      (m.group!==0||m.sessionLo>0&&m.sessionHi===0);
  }
  function normalize(m,response=false){
    const value={...m,group:m.group??0,opcode:m.opcode??m.condition,
      task:m.task??m.observerId,sessionLo:m.sessionLo??m.session?.lo,sessionHi:m.sessionHi??m.session?.hi,args:m.args??[]};
    const kind=value.kind&0x7f,reply=response||Boolean(value.kind&0x80);
    if(!uint(value.kind,255)||kind<KIND.ARM||kind>KIND.ACK||!identity(value)||!array(value.args))throw fail('条件观察身份无效。');
    const reusable=reply?value.args.length===6:kind===KIND.ARM?value.args.length===(value.opcode===CONDITION.TIME?8:5):kind===KIND.ACK?value.args.length===5:value.args.length===4;
    const runId=reusable?M.read32(value.args,reply?2:0):0;
    if(reusable&&(!value.group||!runId))throw fail('条件观察缺少有效程序组运行身份。','IDENTITY');
    const args=reusable&&!reply?value.args.slice(4):value.args;
    if(reply){
      if(value.args.length!==(reusable?6:2)||!states.has(value.args[0])||!reasons.has(value.args[1])||
        ([STATE.READY,STATE.DONE].includes(value.args[0])&&value.args[1]!==0))throw fail('条件观察反馈无效。');
    }else if(kind===KIND.ARM?!parameters(value.opcode,args):kind===KIND.ACK?
      args.length!==1||!states.has(args[0]):args.length!==0)throw fail('条件观察参数无效。','PARAM');
    return {...value,reusable,...(reusable?{runId}:{})};
  }
  function encode(message,response=false){const value=normalize(message,response);return M.encode(value,response);}
  function decode(bytes){
    const m=M.decode(bytes),value=normalize(m,m.response);
    return {...m,observerId:m.task,condition:m.opcode,reusable:value.reusable,...(value.reusable?{runId:value.runId}:{})};
  }
  function condition(item){
    const p=item?.params||{};let descriptor;
    if(item?.id==='loop-infrared'&&['greater','less'].includes(p.comparison))descriptor={kind:p.comparison==='greater'?CONDITION.IR_GT:CONDITION.IR_LT,args:[p.threshold]};
    else if(item?.id==='loop-tilt')descriptor={kind:CONDITION.TILT,args:[{forward:2,backward:3,left:4,right:5}[p.direction]]};
    else if(item?.id==='loop-time'&&Number.isFinite(p.duration)&&p.duration>=0){
      const ms=Math.round(p.duration*1000);if(uint(ms,0x7fffffff))descriptor={kind:CONDITION.TIME,args:M.u32(ms)};
    }
    if(!descriptor||!parameters(descriptor.kind,descriptor.args))throw fail('无法转换条件循环参数。','PARAM');
    return descriptor;
  }
  const key=(group,id)=>`${group}:${id}`;
  function context(error,rec){return Object.assign(error,{group:rec.group,observerId:rec.id,condition:rec.kind,...(rec.runId?{runId:rec.runId}:{})});}
  function clear(entry){clearTimeout(entry.queueTimer);clearTimeout(entry.replyTimer);}
  class ObserverClient{
    constructor(link,{session,sessionLo=session?.lo,sessionHi=session?.hi,isCurrent=()=>true,onFault=()=>{},timing={},reusable=false}={}){
      if(!link?.subscribeMulti||!link?.write)throw fail('连接不支持独立条件观察器。','UNSUPPORTED');
      if(!uint(sessionLo)||!uint(sessionHi)||!(sessionLo||sessionHi))throw fail('缺少当前真实运行身份。','IDENTITY');
      this.link=link;this.session=Object.freeze({lo:sessionLo,hi:sessionHi});this.isCurrent=isCurrent;this.onFault=onFault;
      this.timing={queueMs:2500,replyMs:1200,retries:2,...timing};
      this.records=new Map();this.counters=new Map();this.acks=new Map();this.binding=null;
      this.reusable=Boolean(reusable);this.groupRuns=new Map();
      this.disposed=false;this.error=null;this.epoch=0;this.faultNotified=false;
      this.unsub=link.subscribeMulti(packet=>this.receive(packet));
      this.offLifecycle=link.onLifecycle?.(reason=>this.fatal(reason instanceof Error?reason:fail(String(reason),'CANCELLED')));
      this.offMulti=link.onMultiLifecycle?.(reason=>this.fatal(reason instanceof Error?reason:fail(String(reason),'CANCELLED')));
    }
    get sessionLo(){return this.session.lo;}
    get sessionHi(){return this.session.hi;}
    current(epoch=this.epoch){
      if(this.disposed||this.error||this.link.closed||epoch!==this.epoch)return false;
      try{return Boolean(this.isCurrent());}catch(_){return false;}
    }
    check(){
      if(this.error)throw this.error;
      if(!this.current()){const error=fail('运行或连接已变化，条件观察已取消。','CANCELLED');this.fatal(error);throw error;}
    }
    message(kind,rec,args=[]){return {kind,group:rec.group,opcode:rec.kind,task:rec.id,session:this.session,args:this.reusable?[...M.u32(rec.runId),...args]:args};}
    sameRun(rec){return !rec.retired&&(!this.reusable||this.groupRuns.get(rec.group)===rec.runId);}
    valid(rec){return this.current(rec.epoch)&&this.sameRun(rec)&&this.records.get(key(rec.group,rec.id))===rec;}
    rejectPending(rec,error){for(const entry of rec.pending.values()){clear(entry);entry.reject(error);}rec.pending.clear();}
    detach(){this.unsub?.();this.offLifecycle?.();this.offMulti?.();this.unsub=this.offLifecycle=this.offMulti=null;}
    cleanup(error){
      this.error=error;this.epoch++;
      for(const rec of this.records.values()){rec.error=error;rec.closed=true;this.rejectPending(rec,error);}
      this.records.clear();this.acks.clear();this.groupRuns.clear();this.detach();
    }
    fatal(error){
      if(this.disposed||this.error)return;
      if(!(error instanceof Error))error=fail(String(error));this.cleanup(error);
      if(!this.faultNotified){this.faultNotified=true;try{Promise.resolve(this.onFault(error)).catch(()=>{});}catch(_) {}}
    }
    cancel(reason='运行已取消。'){
      if(this.disposed)return;this.disposed=true;
      this.cleanup(reason instanceof Error?reason:fail(String(reason),'CANCELLED'));
    }
    dispose(reason='条件观察会话已释放。'){this.cancel(reason);}
    request(rec,kind){
      if(rec.pending.has(kind))return rec.pending.get(kind).promise;
      const entry={kind,attempts:0,sent:false};
      entry.promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});entry.promise.catch(()=>{});
      rec.pending.set(kind,entry);
      const owned=()=>this.records.get(key(rec.group,rec.id))===rec&&rec.pending.get(kind)===entry;
      const valid=()=>this.valid(rec)&&owned();
      const failure=error=>{if(!owned())return;this.fatal(context(error,rec));};
      const attempt=()=>{
        if(!owned())return;
        if(!valid()){failure(fail('条件观察所属运行已取消。','CANCELLED'));return;}
        entry.attempts++;
        clear(entry);entry.queueTimer=setTimeout(()=>failure(fail('条件观察消息排队超时。','QUEUE_TIMEOUT')),this.timing.queueMs);
        let write;
        try{write=this.link.write(encode(this.message(kind,rec,kind===KIND.ARM?rec.args:[])),valid,()=>{
          if(!valid())return;entry.sent=true;rec.sentKinds.add(kind);clearTimeout(entry.queueTimer);
          entry.replyTimer=setTimeout(()=>{
            if(!owned())return;
            if(!valid()){failure(fail('条件观察所属运行已取消。','CANCELLED'));return;}
            if(entry.attempts<=this.timing.retries)attempt();else failure(fail('设备未确认条件观察。','CONDITION_TIMEOUT'));
          },this.timing.replyMs);
        },{priority:5});}catch(error){failure(error);return;}
        Promise.resolve(write).then(sent=>{if(sent===false&&owned())failure(fail('条件观察消息已取消。','CANCELLED'));},failure);
      };
      attempt();return entry.promise;
    }
    finish(rec,kind,message){
      const entry=rec.pending.get(kind);if(!entry)return;
      clear(entry);rec.pending.delete(kind);entry.resolve(message);
    }
    ack(rec,message){
      const id=`${rec.group}:${rec.runId||0}:${rec.id}:${message.state}`;if(this.acks.has(id)||!this.current())return;
      const epoch=this.epoch,guard=()=>this.current(epoch)&&this.sameRun(rec)&&rec.state===message.state;
      let promise;
      try{promise=Promise.resolve(this.link.write(encode(this.message(KIND.ACK,rec,[message.state])),guard,()=>{},{priority:2}));}
      catch(error){this.fatal(context(error,rec));return;}
      this.acks.set(id,promise);
      promise.catch(error=>{if(guard())this.fatal(context(error,rec));}).finally(()=>{if(this.acks.get(id)===promise)this.acks.delete(id);});
    }
    receive(packet){
      if(!this.current())return;
      let m;try{m=decode(packet);}catch(_){return;}
      if(!m.response||m.sessionLo!==this.sessionLo||m.sessionHi!==this.sessionHi||m.reusable!==this.reusable)return;
      const kind=m.kind&0x7f;if(kind===KIND.ACK)return;
      const rec=this.records.get(key(m.group,m.observerId));
      if(!rec||rec.kind!==m.condition||!rec.sentKinds.has(kind)||!this.sameRun(rec)||this.reusable&&m.runId!==rec.runId)return;
      if(kind===KIND.CLOSE){
        if(!rec.closing)return;
        if(m.state!==STATE.CANCELLED||m.reason!==0){this.fatal(context(fail(descriptions[m.reason]||'设备未确认观察器关闭。','CONDITION_DEVICE'),rec));return;}
        rec.state=STATE.CANCELLED;this.ack(rec,m);this.finish(rec,KIND.CLOSE,m);rec.closed=true;
        this.records.delete(key(rec.group,rec.id));return;
      }
      if(m.state===STATE.FAILED||m.state===STATE.CANCELLED||m.reason!==0){
        rec.state=m.state;this.ack(rec,m);
        this.fatal(context(Object.assign(fail(descriptions[m.reason]||'设备已取消条件观察。','CONDITION_DEVICE'),{state:m.state,reason:m.reason}),rec));return;
      }
      if(rec.closing)return;
      if(m.state===STATE.DONE)rec.latched=true;
      rec.state=rec.latched?STATE.DONE:STATE.READY;this.ack(rec,m);
      if(kind===KIND.ARM)this.finish(rec,KIND.ARM,m);
      // An unsolicited real DONE is sufficient to satisfy an in-flight QUERY.
      // Old repeated READY from ARM must not stand in for a fresh boundary QUERY.
      if(kind===KIND.QUERY||rec.latched)this.finish(rec,KIND.QUERY,m);
    }
    retireGroup(group,runId){
      if(!this.reusable||!uint(group,4)||group<1||!uint(runId)||!runId)throw fail('条件观察运行身份无效。','PARAM');
      for(const [id,rec]of this.records)if(rec.group===group&&rec.runId===runId){
        rec.retired=true;rec.closed=true;rec.error=fail('条件观察所属程序组运行已结束。','CANCELLED');
        this.rejectPending(rec,rec.error);this.records.delete(id);
      }
      for(const id of this.acks.keys())if(id.startsWith(`${group}:${runId}:`))this.acks.delete(id);
      if(this.groupRuns.get(group)===runId)this.groupRuns.delete(group);
    }
    async arm(group,descriptor,{runId}={}){
      this.check();
      if(!uint(group,4)||!descriptor||!parameters(descriptor.kind,descriptor.args)||
        (group===0&&this.sessionHi!==0)||this.reusable&&(!group||!uint(runId)||!runId))throw fail('条件观察参数或运行身份无效。','PARAM');
      if(this.reusable&&this.groupRuns.has(group)&&this.groupRuns.get(group)!==runId)throw fail('条件观察所属程序组运行已变化。','STALE');
      const binding=group===0?'legacy':'multi';
      if(this.binding&&this.binding!==binding)throw fail('不能混用单组和多组观察身份。','IDENTITY');
      const count=[...this.records.values()].filter(rec=>rec.group===group).length;
      if(count>=4||this.records.size>=16)throw fail('每组最多同时观察4个循环条件。','OBSERVER_LIMIT');
      const previous=this.counters.get(group)||0;
      if(previous>=0xffffffff)throw fail('条件观察编号已耗尽，请重新运行。','EXHAUSTED');
      this.binding=binding;const id=previous+1;this.counters.set(group,id);
      if(this.reusable)this.groupRuns.set(group,runId);
      const rec={group,id,runId:this.reusable?runId:0,kind:descriptor.kind,args:Array.from(descriptor.args),epoch:this.epoch,
        latched:false,state:0,error:null,closing:false,closed:false,pending:new Map(),sentKinds:new Set()};
      this.records.set(key(group,id),rec);
      await this.request(rec,KIND.ARM);this.check();
      if(rec.error)throw rec.error;
      if(rec.closed||!this.sameRun(rec))throw fail('条件观察所属程序组运行已结束。','CANCELLED');
      const client=this;
      const handle={group,id,kind:rec.kind,...(rec.runId?{runId:rec.runId}:{}),
        get matched(){return rec.latched;},
        check(){client.check();if(rec.error)throw rec.error;if(rec.closed)throw fail('条件观察已关闭。','CANCELLED');},
        async refresh(){
          this.check();if(rec.latched)return true;
          await client.request(rec,KIND.QUERY);this.check();return rec.latched;
        },
        close({cancelled=false}={}){
          if(cancelled){
            if(rec.closed||rec.closing||!client.valid(rec))return Promise.resolve();
            rec.closing=true;rec.closed=true;client.rejectPending(rec,fail('条件观察已取消。','CANCELLED'));
            client.records.delete(key(group,id));
            // Best effort only: global STOP/mode/disconnect clears the binding.
            // Never delay that STOP or surface another fault from this cleanup.
            if(client.current()){
              try{Promise.resolve(client.link.write(encode(client.message(KIND.CLOSE,rec)),()=>client.current(rec.epoch)&&client.sameRun(rec),()=>{},{priority:5})).catch(()=>{});}catch(_) {}
            }
            return Promise.resolve();
          }
          if(rec.closePromise)return rec.closePromise;
          if(rec.closed)return Promise.resolve();
          try{this.check();}catch(error){return Promise.reject(error);}
          rec.closing=true;client.rejectPending(rec,fail('条件观察正在关闭。','CANCELLED'));
          rec.closePromise=client.request(rec,KIND.CLOSE).then(()=>{});rec.closePromise.catch(()=>{});return rec.closePromise;
        }
      };
      return Object.freeze(handle);
    }
  }
  return {KIND,CONDITION,STATE,REASON,parameters,condition,encode,decode,ObserverClient};
});
