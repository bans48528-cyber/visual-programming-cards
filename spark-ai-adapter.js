// Spark AI owns compiled uploads. Shared Android UI owns discovery and preferences.
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./spark-protocol.js'):root.SparkProtocol);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SparkAIAdapter=api;
})(globalThis,function(protocol){
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const MODE={PROGRAM:'program',REMOTE:'remote'};
  class Link {
    constructor(transport,{onError=()=>{},onState=()=>{},onTrace=()=>{}}={}){
      this.transport=transport;this.closed=false;this.deviceState=null;this.job=null;this.stopping=null;
      this.phase='idle';this.requiresReconnect=false;this.onState=onState;this.epoch=0;
      this.wire=new protocol.Link(null,{transport,onTrace,
        acceptAck:p=>p.length===8&&p[4]===0xfd&&p[5]===1,
        onStatus:report=>this.receiveStatus(report),
        onProgress:(done,total)=>{
          if(!this.job)return;
          this.job.terminal=done>=total-1;
          this.job.options.onProgress?.(`正在上传 ${done}/${total} 包`);
        },
        onError:error=>{if(this.closed)return;this.deviceState=null;this.phase='unknown';this.changed('通讯异常，设备状态待确认。');onError(error);}
      });
    }
    get busy(){return Boolean(this.job||this.stopping||this.requiresReconnect||['running','unknown','awaiting-start'].includes(this.phase));}
    get executionPhase(){return this.phase;}
    get stopNeedsConfirmation(){return true;}
    get status(){
      const text={idle:'已连接',uploading:'正在上传',running:'设备运行中',stopping:'等待停止回报','awaiting-start':'等待运行回报',unknown:'设备状态待确认'}[this.phase];
      return {id:this.phase==='running'?'run':this.phase==='idle'?'stop':'waiting',text:this.requiresReconnect?'上传已中断，请重新连接':text};
    }
    changed(message){
      if(this.closed)return;
      this.onState();
      if(message&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('device-execution-state',{detail:{modelId:'spark-ai',message}}));
    }
    receiveStatus(report){
      if(this.closed||!['run','stop'].includes(report?.WillAiState))return;
      this.deviceState={value:report.WillAiState,time:Date.now()};
      if(this.job){
        if(report.WillAiState==='run'&&!this.job.terminal){this.job.cancelled=true;this.requiresReconnect=true;this.wire.cancelUpload();}
        if(this.job.terminal)this.job.report=report.WillAiState;
        return;
      }
      this.phase=report.WillAiState==='run'?'running':'idle';
      this.changed(report.WillAiState==='run'?'Spark AI 回报：程序运行中。':'Spark AI 回报：程序已停止。');
    }
    async start(){await this.wire.start();}
    async probe(){} // GATT + D0, never send Xiaobai C2.
    async enterProgram(){}
    async enterRemote(){if(this.busy)await this.stopProgram();if(this.busy)throw new Error('请先确认 Spark AI 已停止，必要时重新连接。');}
    stopHeartbeat(){}
    send(bytes,guard=()=>true){
      return this.wire.write(bytes,undefined,()=>{
        if(!guard()||this.closed)return false;
        if(this.busy&&bytes.slice(5,15).some(Boolean))throw new Error('主机程序尚未停止，暂不能遥控。');
        return true;
      });
    }
    async prepareState(check){
      if(!this.deviceState){await this.wire.write(protocol.frame(protocol.CMD.WATCH),undefined,()=>{check();return true;});await sleep(500);check();}
      const allowWaiting=!this.deviceState;
      if(this.deviceState&&(this.deviceState.value!=='stop'||Date.now()-this.deviceState.time>2000)){
        this.deviceState=null;
        await this.wire.stop(()=>{check();return true;});
        const deadline=Date.now()+5000;
        while(this.deviceState?.value!=='stop'&&Date.now()<deadline){check();await sleep(50);}
        check();if(this.deviceState?.value!=='stop')throw new Error('等待主机停止超时，未发送程序。');
      }
      return allowWaiting;
    }
    async uploadProgram(bytes,options){
      if(this.busy)throw new Error(this.requiresReconnect?'上次上传未完成，请重新连接后重试。':'设备正在运行或状态待确认，请先停止。');
      const job={options,cancelled:false,terminal:false,prepared:false,started:false};
      this.job=job;this.phase='uploading';this.changed();
      const check=()=>{if(this.closed||this.job!==job||job.cancelled||!options.isCurrent()||options.signal.aborted)throw new Error('上传已取消或连接已变化。');};
      const cancel=()=>{job.cancelled=true;this.wire.cancelUpload();};
      options.signal.addEventListener('abort',cancel,{once:true});
      try{
        check();const allowWaiting=await this.prepareState(check);check();
        await this.wire.queue;check();
        // Full 135-byte frames must fit the negotiated MTU; never split them blindly.
        job.prepared=true;const prepared=await this.transport.prepareUpload(bytes.length);check();
        if(prepared.mtu<138)throw new Error('蓝牙 MTU 不足，未发送程序。');
        if(!(allowWaiting&&!this.deviceState)&&(!this.deviceState||this.deviceState.value!=='stop'||Date.now()-this.deviceState.time>2000))throw new Error('设备状态已变化，未发送程序。');
        job.started=true;
        await this.wire.upload(bytes,{slot:0,run:true,allowUnverifiedAck:true});check();
        this.phase=job.report==='run'?'running':job.report==='stop'?'idle':'awaiting-start';
        this.changed(job.report==='run'?'Spark AI 回报：程序运行中。':job.report==='stop'?'Spark AI 回报：程序已停止。':'程序已上传，等待设备运行回报。');
        return {state:job.report||'unknown'};
      }catch(error){
        if(job.started)this.requiresReconnect=true; // ACK has no sequence ID: do not reuse a cancelled upload session.
        if(!this.closed)this.phase=job.started?'unknown':this.deviceState?.value==='stop'?'idle':'unknown';
        throw error;
      }finally{
        options.signal.removeEventListener('abort',cancel);
        await this.wire.queue.catch(()=>{});
        if(job.prepared)await this.transport.finishUpload().catch(()=>{});
        if(this.job===job)this.job=null;
        this.changed();
      }
    }
    stopProgram(){
      if(this.stopping)return this.stopping;
      if(this.closed)return Promise.resolve();
      if(this.job){this.job.cancelled=true;if(this.job.started)this.requiresReconnect=true;}
      this.wire.cancelUpload();
      const ticket=++this.epoch,status=this.deviceState;
      const guard=()=>!this.closed&&this.epoch===ticket;
      this.stopping=(async()=>{
        if(status?.value==='stop'&&Date.now()-status.time<=2000&&!this.job?.started){this.phase='idle';this.changed('Spark AI 已回报停止。');return;}
        this.phase='stopping';this.deviceState=null;this.changed();
        if(!status){
          await this.wire.write(protocol.frame(protocol.CMD.WATCH),undefined,guard);await sleep(200);
          if(guard()&&this.deviceState?.value!=='stop')await this.wire.write(protocol.frame(protocol.CMD.STOP),undefined,guard);
        }else await this.wire.stop(guard);
        if(!guard())return;
        this.phase=this.deviceState?.value==='stop'?'idle':'unknown';
        this.changed(this.phase==='idle'?'Spark AI 回报：程序已停止。':'已发送暂停请求，设备是否停止仍待回报。');
      })().finally(()=>{this.stopping=null;this.changed();});
      return this.stopping;
    }
    rejectPending(){if(this.job)this.job.cancelled=true;this.wire.cancelUpload();}
    close(){this.closed=true;this.epoch++;this.rejectPending();this.wire.close();}
  }
  const remoteKeys=['up','down','left','right','A','B','X','Y','L','R'];
  function remoteFrame(pressed=[]){
    if(!Array.isArray(pressed)||pressed.some(k=>!remoteKeys.includes(k))||pressed.filter(k=>remoteKeys.indexOf(k)<4).length>1)throw new Error('Spark AI 遥控按键无效。');
    return protocol.frame(0xc1,remoteKeys.map(key=>pressed.includes(key)?1:0));
  }
  return {MODE,Link,remoteFrame};
});
