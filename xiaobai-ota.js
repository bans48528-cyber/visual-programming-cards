(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./xiaobai-ota-protocol.js'):root.XiaobaiOtaProtocol);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.XiaobaiOta=api;
})(globalThis,function(P){
  'use strict';
  const TIMING=Object.freeze({requestMs:2500,beginMs:12000,finishMs:15000,retries:2,bootWaitMs:16000,bootPollMs:600,restartMs:3300,healthDeadlineMs:30000,healthGapMs:600});
  const messages={1:'升级数据帧无效。',2:'升级参数无效。',3:'升级包与主板型号不匹配。',4:'版本或 Boot 不兼容。',5:'升级包来源签名无效。',6:'主控 Flash 写入失败，请重新升级。',7:'设备提交位置不一致，请从头重新升级。',8:'镜像校验失败，请重新选择升级包。',9:'设备升级状态不正确。',10:'镜像启动地址无效。',11:'设备正忙，请停止运行和学习后重试。',12:'主机电量不足，请充电后重试。'};
  const now=()=>globalThis.performance?.now?.()??Date.now();
  function error(code,message){return Object.assign(new Error(message),{code});}
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const u32=n=>Uint8Array.of(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255);
  const read32=b=>(b[0]|b[1]<<8|b[2]<<16|b[3]<<24)>>>0;
  function randomId(){const a=new Uint32Array(1);globalThis.crypto.getRandomValues(a);return a[0]||1;}
  class BootClient{
    constructor(transport,{timing={},onProgress=()=>{},onTrace=()=>{},firstRequestId=randomId()}={}){
      this.transport=transport;this.timing={...TIMING,...timing};this.onProgress=onProgress;this.onTrace=onTrace;
      this.nextId=firstRequestId>>>0||1;this.pending=null;this.closed=false;this.closeError=null;this.began=false;
      this.receiver=new P.Receiver(frame=>this.receive(frame));
      this.unsubscribe=transport.subscribe(bytes=>{if(!this.closed)this.receiver.feed(bytes);});
      this.offDisconnect=transport.onDisconnect?.(()=>this.close('升级连接已断开，请重新连接恢复。','DISCONNECTED'));
    }
    receive(frame){
      const p=this.pending;
      if(!p||!p.sent||frame.command!==(p.cmd|0x80)||frame.requestId!==p.id)return;
      if(!frame.payload.length)return;
      p.resolve(frame.payload);
    }
    async request(cmd,payload=new Uint8Array(),{timeoutMs}={}){
      if(this.closed)throw this.closeError;
      if(this.pending)throw error('BUSY','上一条升级数据尚未确认。');
      this.stage=cmd;
      const id=this.nextId;this.nextId=(id+1)>>>0||1;
      const bytes=P.encodeFrame(cmd,id,payload),p={id,cmd,sent:false,resolve:null,reject:null};
      const answer=new Promise((resolve,reject)=>{p.resolve=resolve;p.reject=reject;});answer.catch(()=>{});
      this.pending=p;
      const ms=timeoutMs??(cmd===P.OP.BEGIN?this.timing.beginMs:cmd===P.OP.FINISH?this.timing.finishMs:this.timing.requestMs);
      try{
        for(let attempt=0;attempt<=this.timing.retries;attempt++){
          if(this.closed)throw this.closeError;
          p.sent=true;
          // A retry uses the identical frame and request ID; the native bridge serializes chunks.
          try{await this.transport.write(bytes);}catch(e){
            // Older bridges may reject GATT write before dispatching the matching
            // disconnect callback. Yield one task; only an actual channel close
            // can classify an uncoded write failure as DISCONNECTED or CANCELLED.
            if(!this.closed&&!e?.code)await pause(0);
            if(this.closed)throw this.closeError;
            throw e;
          }
          let timer;
          const response=await Promise.race([answer,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms);})]).finally(()=>clearTimeout(timer));
          if(response){
            if(response[0])throw Object.assign(error('DEVICE',messages[response[0]]||`设备拒绝升级（${response[0]}）。`),{status:response[0]});
            return response;
          }
        }
        throw error('TIMEOUT','设备未确认升级数据，已停止发送。请保持主机供电后重新连接。');
      }finally{if(this.pending===p)this.pending=null;}
    }
    async info(){const bytes=await this.request(P.OP.INFO);if(bytes.length!==61)throw error('PROTOCOL','Boot 身份反馈长度无效。');const info=P.parseInfo60(bytes.slice(1));if(info.mode!==1)throw error('MODE','设备尚未进入升级模式。');this.lastInfo=info;return info;}
    async ack(cmd,payload,expected){const response=await this.request(cmd,payload);if(response.length!==5||read32(response.slice(1))!==expected)throw error('OFFSET','设备已提交的位置与当前数据不一致，升级已停止。');return expected;}
    async upload(pkg,{repair=false,info=null}={}){
      info=info||await this.info();const compatible=P.checkCompatibility(pkg,info,{repair});
      if(compatible.alreadyPresent&&!repair){
        this.finishAttempted=true;
        this.onProgress({phase:'finish',committed:pkg.imageSize,total:pkg.imageSize});
        await this.ack(P.OP.FINISH,new Uint8Array(),pkg.imageSize);
        return{info,written:false,alreadyPresent:true,applicationStartVerified:false};
      }
      this.began=true;this.onProgress({phase:'begin',committed:0,total:pkg.imageSize});
      await this.ack(P.OP.BEGIN,pkg.manifest,0);
      this.onTrace('BEGIN 已受理',`committed=0 total=${pkg.imageSize}`);
      for(let offset=0;offset<pkg.imageSize;offset+=P.LAYOUT.OTA_DATA_MAX){
        const block=pkg.image.slice(offset,offset+P.LAYOUT.OTA_DATA_MAX),payload=new Uint8Array(4+block.length);
        payload.set(u32(offset));payload.set(block,4);
        await this.ack(P.OP.DATA,payload,offset+block.length);
        this.onProgress({phase:'transfer',committed:offset+block.length,total:pkg.imageSize});
      }
      this.onProgress({phase:'finish',committed:pkg.imageSize,total:pkg.imageSize});
      this.finishAttempted=true;
      await this.ack(P.OP.FINISH,new Uint8Array(),pkg.imageSize);
      return{info,written:true,alreadyPresent:false,applicationStartVerified:false};
    }
    close(reason='升级已取消。',code='CANCELLED'){
      if(this.closed)return;this.closed=true;this.closeError=error(code,reason);this.pending?.reject(this.closeError);this.unsubscribe?.();this.offDisconnect?.();
    }
  }
  function validateStatus(samples,{epoch,startedAt,endedAt=now(),gapMs=500,deadlineMs=30000}={}){
    if(!epoch||!Number.isFinite(startedAt)||!Number.isFinite(endedAt)||endedAt<startedAt||endedAt-startedAt>deadlineMs)throw error('TIMING','启动检查时间无效或已超时。');
    if(!Array.isArray(samples)||samples.length<2)throw error('STATUS','尚未取得两次真实状态反馈。');
    const seen=new Set();let previous=-1;
    for(const s of samples){
      if(s.epoch!==epoch)throw error('SESSION','状态反馈来自旧连接，请重新检查。');
      if(!Number.isInteger(s.seq)||s.seq<1||s.seq>255||seen.has(s.seq)||s.opcode!==4||s.result!==0)throw error('STATUS','状态反馈未匹配新的查询编号。');
      if(!Number.isFinite(s.sentAt)||!Number.isFinite(s.receivedAt)||s.sentAt<startedAt||s.receivedAt<s.sentAt||s.receivedAt>endedAt||s.receivedAt<=previous)throw error('TIMING','状态反馈不属于本次启动检查。');
      const b=s.data;
      if(!b||b.length!==7||Array.from(b).some(n=>!Number.isInteger(n)||n<0||n>255)||b[0]>4||Math.max(b[1],b[2],b[3])>100||b[1]!==b[2]||b[2]!==b[3])throw error('STATUS','主机模式或单红外状态反馈异常。');
      if((b[4]|b[5]<<8)<3000)throw error('POWER','主机电量不足，请充电后重试检查。');
      if(b[6]>>4)throw error('BUSY','主机任务尚未停止。');
      if(b[6]&15)throw error('FAULT','主机报告硬件故障，启动检查未通过。');
      seen.add(s.seq);previous=s.receivedAt;
    }
    if(samples.at(-1).receivedAt-samples[0].receivedAt<gapMs)throw error('TIMING','两次启动状态检查间隔不足。');
    return true;
  }
  function confirmIdentity(actual,binding,pkg){
    const i=actual.info;
    if(!actual.epoch||!binding.deviceId||!/^[0-9a-f]{24}$/.test(binding.uid||'')||actual.uid!==binding.uid||actual.deviceId!==binding.deviceId)throw error('IDENTITY','重连设备与升级前不是同一台主机，已停止确认。');
    if(!i||i.protocol!==P.C.OTA_PROTOCOL_VERSION||i.mode!==0||!i.imageValid||i.boardId!==pkg.boardId||i.version!==pkg.version||i.imageSize!==pkg.imageSize||i.imageSha256!==pkg.imageSha256)throw error('IDENTITY','主机运行镜像与升级目标不一致，写入状态尚未确认。');
  }
  class Session{
    constructor(adapter,{storage=null,timing={},onChange=()=>{},clock=now}={}){
      this.adapter=adapter;this.storage=storage;this.timing={...TIMING,...timing};this.onChange=onChange;this.clock=clock;
      this.state={phase:'idle',busy:false,message:'连接小白后将自动核对本 App 对应的主控固件。',info:null,uid:null,pkg:null,committed:0,total:0,written:false,supported:null};
      this.generation=0;this.client=null;this.file=null;this.binding=this.loadBinding();this.operation=null;this.cancelRequested=false;this.cancelling=null;
    }
    loadBinding(){try{const b=JSON.parse(this.storage?.getItem('xiaobai:ota:binding:v1')||'null');if(!b||typeof b.deviceId!=='string'||!b.deviceId||!/^[0-9a-f]{24}$/.test(b.uid))return null;if(b.pending&&(b.pending.boardId!==P.C.OTA_BOARD_ID||!Number.isInteger(b.pending.version)||!b.pending.version||!Number.isInteger(b.pending.imageSize)||b.pending.imageSize<192||b.pending.imageSize>P.C.OTA_APP_CAPACITY||!/^[0-9a-f]{64}$/.test(b.pending.imageSha256)))return null;return b;}catch{return null;}}
    saveBinding(binding){this.binding={...binding};try{this.storage?.setItem('xiaobai:ota:binding:v1',JSON.stringify(this.binding));}catch{throw error('STORAGE','无法保存升级设备身份，已停止升级。');}}
    snapshot(){return{...this.state,recovery:Boolean(this.binding?.pending),binding:this.binding?{deviceId:this.binding.deviceId,uid:this.binding.uid,name:this.binding.name}:null};}
    set(patch){Object.assign(this.state,patch);this.onChange(this.snapshot());}
    current(ticket){if(ticket!==this.generation||this.cancelRequested)throw error('CANCELLED','升级已中止。');}
    async choose(bytes,name){
      if(this.state.busy)throw error('BUSY','请先结束当前升级。');
      const ticket=++this.generation;this.cancelRequested=false;this.file=null;this.set({phase:'validating',busy:true,pkg:null,message:'正在校验升级包来源和镜像…'});
      try{const copy=Uint8Array.from(bytes),pkg=await P.verifyPackage(copy,{name});this.current(ticket);this.file={bytes:copy,name};this.set({phase:'ready',pkg,message:'内置固件校验通过，正在准备主控更新。',total:pkg.imageSize,committed:0});return pkg;}
      catch(e){if(ticket===this.generation)this.set({phase:'error',message:e.message});throw e;}
      finally{if(ticket===this.generation)this.set({busy:false});}
    }
    async inspect(){
      if(this.state.busy)return;const ticket=++this.generation;this.cancelRequested=false;this.set({busy:true,phase:'reading',message:'正在读取主机身份与版本…'});
      try{const actual=await this.adapter.readApp();this.current(ticket);if(actual.info.mode!==0)throw error('MODE','主机处于恢复模式，请使用“重新连接检查”。');
        this.saveBinding({...this.binding,...actual,pending:this.binding?.deviceId===actual.deviceId?this.binding.pending:null,info:undefined,epoch:undefined});
        this.set({info:actual.info,uid:actual.uid,supported:actual.info.supported,phase:'ready',message:actual.info.supported?'已读取实际主控版本。':'当前主板或升级协议不在支持范围，请确认硬件版本。'});return actual;
      }catch(e){if(ticket===this.generation)this.set({phase:'error',supported:e.result===2?false:null,message:e.result===2?'此固件不支持蓝牙升级。首次需通过 DAP 安装新版 Boot 与主控固件。':e.message});throw e;}
      finally{if(ticket===this.generation)this.set({busy:false});}
    }
    async start({repair=false,recovery=false}={}){
      if(this.state.busy)throw error('BUSY','当前操作尚未结束。');
      if(!this.file)throw error('PACKAGE','内置固件尚未就绪，请重试或更新 App。');
      const ticket=++this.generation;this.cancelRequested=false;
      this.operation=this.perform(ticket,{repair,recovery});
      return this.operation;
    }
    trace(stage,detail=''){this.diagnosticStage=stage;this.adapter.traceOta?.(stage,detail);}
    async enterBoot(ticket,binding){
      this.trace('进入 Boot','发送一次 ENTER，等待原主机切换');
      try{return await this.adapter.enterBoot(binding);}
      catch(e){
        // ENTER may already have reset the controller before its ACK was delivered.
        // Reconnect through the consent-guarded adapter, never repeat ENTER or bypass cancellation.
        if(e.result!==undefined||!['TIMEOUT','DISCONNECTED'].includes(e.code))throw e;
        this.current(ticket);this.trace('Boot 重连',`ENTER ${e.code}; original binding only`);
        return this.adapter.connectBoot(binding);
      }
    }
    async perform(ticket,{repair,recovery}){
      let entered=false,progressBucket=-1;this.trace('准备','停止原程序与学习任务');this.set({busy:true,phase:'preparing',message:'正在停止程序、学习与电机，准备升级…',written:false,committed:0});
      try{
        const pkg=await P.verifyPackage(this.file.bytes,{name:this.file.name});this.current(ticket);this.state.pkg=pkg;
        await this.adapter.prepare();this.current(ticket);
        let binding=this.binding,bootTransport;
        if(recovery){
          if(!binding)throw error('BINDING','缺少这台主机的原始身份。请先连接正常主机并读取版本。');
          // Recovery may already be running the target after a lost FINISH ACK.
          // Probe only this pinned App first; a Boot-only device will not answer C2.
          let actual=null;
          try{await this.adapter.connectApp(binding);actual=await this.adapter.readApp();}
          catch(e){
            await this.adapter.disconnect().catch(()=>{});
            // A known wrong identity is not evidence of recovery Boot. Only transport
            // unavailability may fall back to the pinned raw channel without a UID.
            if(e.result!==undefined||(e.code&&!['TIMEOUT','DISCONNECTED','CONNECTION_FAILED','UNAVAILABLE','GATT_ERROR'].includes(e.code)))throw e;
          }
          this.current(ticket);
          if(actual){
            if(actual.uid!==binding.uid||actual.deviceId!==binding.deviceId)throw error('IDENTITY','绑定主机身份不匹配，已停止恢复。');
            const match=P.checkCompatibility(pkg,actual.info,{repair});
            if(match.alreadyPresent&&!repair){await this.confirm(ticket,binding,pkg);return{written:false,alreadyPresent:true,applicationStartVerified:true};}
            const status=await this.adapter.queryStatus();
            if(status.data.length!==7||(status.data[4]|status.data[5]<<8)<3000||status.data[6])throw error('POWER','主机电量或任务状态不允许升级，请检查后重试。');
            entered=true;this.saveBinding({...binding,pending:targetOf(pkg),written:false});bootTransport=await this.enterBoot(ticket,binding);
          }else{entered=true;bootTransport=await this.adapter.connectBoot(binding);}
          this.current(ticket);
        }else{
          const actual=await this.adapter.readApp();this.current(ticket);
          const compatible=P.checkCompatibility(pkg,actual.info,{repair});
          binding={deviceId:actual.deviceId,uid:actual.uid,name:actual.name};this.saveBinding(binding);
          this.set({info:actual.info,uid:actual.uid,supported:true});
          if(compatible.alreadyPresent&&!repair){this.set({phase:'current',message:'已是当前版本，镜像校验一致。'});return{alreadyPresent:true,written:false};}
          const status=await this.adapter.queryStatus();this.current(ticket);
          if(status.data.length!==7||(status.data[4]|status.data[5]<<8)<3000)throw error('POWER','主机电量不足或电量状态未知，请充电后重试。');
          if(status.data[6])throw error('BUSY','主机仍有运行任务或故障，未进入升级。');
          this.saveBinding({...binding,pending:targetOf(pkg),written:false});entered=true;
          this.set({phase:'entering',message:'正在切换主控升级模式…'});
          // Even an ENTER timeout may mean its ACK was lost after reset. Probe Boot, never loop C2.
          bootTransport=await this.enterBoot(ticket,binding);this.current(ticket);
        }
        const progress=p=>{
          this.current(ticket);
          if(p.phase==='begin')this.trace('BEGIN',`total=${p.total}`);
          else if(p.phase==='finish')this.trace('FINISH',`committed=${p.committed} total=${p.total}`);
          else if(p.phase==='transfer'){const bucket=Math.floor(p.committed*10/p.total);if(bucket!==progressBucket){progressBucket=bucket;this.trace('提交进度',`committed=${p.committed} total=${p.total}`);}}
          this.set({...p,message:p.phase==='begin'?'正在校验并擦除主控存储…':p.phase==='finish'?'数据已传完，正在校验完整镜像…':'正在传输升级包，请保持主机供电与手机在前台。'});
        };
        this.client=new BootClient(bootTransport,{timing:this.timing,onProgress:progress,onTrace:(stage,detail)=>this.trace(stage,detail)});
        const deadline=this.clock()+this.timing.bootWaitMs;let info;
        while(this.clock()<deadline){
          this.current(ticket);
          try{this.trace('Boot INFO','等待原主机身份与升级状态');info=await this.client.info();break;}catch(e){
            if(!['TIMEOUT','DISCONNECTED'].includes(e.code))throw e;
            this.current(ticket);
            // Before BEGIN only, a reset/lost INFO may use a fresh pinned channel.
            // A timed-out native request ID must be retired by disconnect first.
            this.trace('Boot 重连',`INFO ${e.code}; original binding only`);
            this.client.close();this.client=null;await this.adapter.disconnect();this.current(ticket);
            if(this.clock()>=deadline)break;
            await pause(this.timing.bootPollMs);this.current(ticket);
            bootTransport=await this.adapter.connectBoot(binding);this.current(ticket);
            this.client=new BootClient(bootTransport,{timing:this.timing,onProgress:progress,onTrace:(stage,detail)=>this.trace(stage,detail)});
          }
        }
        if(!info)throw error('BOOT_UNKNOWN','切换升级模式未确认。请保持主机供电，使用恢复入口重新连接检查。');
        this.set({info,phase:'boot',message:'已确认主控升级模式。'});this.current(ticket);
        this.saveBinding({...binding,pending:targetOf(pkg),written:false});
        const result=await this.client.upload(pkg,{repair,info});this.current(ticket);
        this.set({written:true,phase:'written',message:'固件已写入，等待主机启动并重新核对…'});
        this.saveBinding({...binding,pending:targetOf(pkg),written:true});
        this.client.close();this.client=null;
        await this.adapter.disconnect();await pause(this.timing.restartMs);this.current(ticket);
        await this.confirm(ticket,binding,pkg);
        return result;
      }catch(e){
        const stage=this.client?({[P.OP.INFO]:'Boot INFO',[P.OP.BEGIN]:'BEGIN',[P.OP.DATA]:'DATA',[P.OP.FINISH]:'FINISH'})[this.client.stage]:this.diagnosticStage;
        this.trace('失败',`stage=${stage||this.state.phase} code=${e.code||e.result||''} committed=${this.state.committed} ${e.message}`);
        // FINISH can commit and boot even when every wireless ACK is lost.
        if(!this.cancelRequested&&this.client?.finishAttempted&&e.status===undefined&&e.code!=='OFFSET'){
          this.client.close();this.client=null;await this.adapter.disconnect().catch(()=>{});
          await pause(this.timing.restartMs);this.current(ticket);
          try{await this.confirm(ticket,this.binding,this.state.pkg);return{written:true,applicationStartVerified:true,afterLostFinishAck:true};}
          catch(checkError){e=checkError;}
        }
        // Only an explicit device rejection proves that ENTER was not accepted.
        if(e.notEntered&&(e.deviceRejected===true||Number.isInteger(e.result)&&e.result!==0)){entered=false;if(this.binding)this.saveBinding({...this.binding,pending:null});}
        if(ticket===this.generation){const recovery=entered||this.client?.began;
          this.set({phase:this.cancelRequested?(this.state.written?'unconfirmed':'cancelled'):this.state.written?'unconfirmed':recovery?'recovery':'error',message:this.cancelRequested?(this.state.written?'固件已写入，启动检查已停止。可稍后重试确认。':this.client?.began?'升级已停止。主机可能留在恢复模式，下次需从头重新传输。':'升级已取消。若主机停留在升级模式，请重新连接检查。'):e.message});}
        throw e;
      }finally{
        if(this.cancelling)await this.cancelling;
        this.client?.close();this.client=null;
        if(entered&&this.state.phase!=='success')await this.adapter.disconnect().catch(()=>{});
        await this.adapter.release();if(ticket===this.generation)this.set({busy:false});this.operation=null;
      }
    }
    async confirm(ticket,binding,pkg){
      const startedAt=this.clock(),deadline=startedAt+this.timing.healthDeadlineMs;let last;
      this.trace('启动确认','新连接核对原主机、目标镜像及两次真实状态');
      this.set({phase:'confirming',message:this.state.written?'固件已写入，正在确认同一主机的启动与状态…':'正在确认写入状态、原主机身份与启动状态…'});
      let triedBootExit=false;
      // Every attempt creates a fresh native connection ID/epoch. No old Link or cached UID is reused.
      while(this.clock()<deadline){
        this.current(ticket);
        try{
          await this.adapter.connectApp(binding);this.current(ticket);
          const actual=await this.adapter.readApp();this.current(ticket);confirmIdentity(actual,binding,pkg);
          this.saveBinding({...binding,pending:targetOf(pkg),written:true});this.set({written:true});
          const first=await this.adapter.queryStatus();await pause(this.timing.healthGapMs);this.current(ticket);
          const second=await this.adapter.queryStatus();this.current(ticket);
          validateStatus([first,second],{epoch:actual.epoch,startedAt,endedAt:this.clock()});
          this.saveBinding({...binding,pending:null});
          this.set({phase:'success',info:actual.info,uid:actual.uid,written:true,message:'升级成功。主控身份与基本启动状态检查通过。'});return true;
        }catch(e){
          last=e;if(e.code==='IDENTITY')throw e;await this.adapter.disconnect().catch(()=>{});
          // If still in Boot with the complete target image, FINISH exits without erasing it.
          if(!triedBootExit&&this.adapter.connectBoot&&this.clock()<deadline&&!this.cancelRequested){
            triedBootExit=true;
            try{
              const transport=await this.adapter.connectBoot(binding);this.current(ticket);
              this.client=new BootClient(transport,{timing:this.timing});const boot=await this.client.info();this.current(ticket);
              if(boot.imageValid&&boot.state===0&&boot.boardId===pkg.boardId&&boot.version===pkg.version&&boot.imageSize===pkg.imageSize&&boot.imageSha256===pkg.imageSha256){
                this.set({written:true});this.saveBinding({...binding,pending:targetOf(pkg),written:true});
                this.client.finishAttempted=true;await this.client.ack(P.OP.FINISH,new Uint8Array(),pkg.imageSize);
              }
            }catch(bootError){last=bootError;}
            finally{this.client?.close();this.client=null;await this.adapter.disconnect().catch(()=>{});}
            await pause(this.timing.restartMs);
          }
          if(this.clock()<deadline)await pause(Math.min(700,Math.max(0,deadline-this.clock())));
        }
      }
      throw error('UNCONFIRMED',`${this.state.written?'固件已写入，启动检查尚未通过':'写入状态与启动状态尚未确认'}：${last?.message||'未取得完整状态反馈'} 请重试检查。`);
    }
    async retryConfirmation(){
      if(this.state.busy)return;if(!this.binding?.pending)throw error('BINDING','没有待确认的升级记录。');
      const ticket=++this.generation;this.cancelRequested=false;this.set({busy:true,written:this.binding.written===true});
      try{await this.adapter.prepare();this.current(ticket);await this.confirm(ticket,this.binding,this.binding.pending);}
      catch(e){await this.adapter.disconnect().catch(()=>{});if(ticket===this.generation)this.set({phase:'unconfirmed',message:e.message});throw e;}
      finally{await this.adapter.release();if(ticket===this.generation)this.set({busy:false});}
    }
    async cancel({background=false}={}){
      if(!this.state.busy)return;
      if(this.cancelling)return this.cancelling;
      this.cancelRequested=true;this.trace('取消',background?'background/leave':'explicit user cancellation');
      this.cancelling=(async()=>{
        // Before BEGIN, an idle valid App can leave Boot without erasure. Never do this after BEGIN.
        if(!background&&this.client&&!this.client.pending&&!this.client.began&&this.client.lastInfo?.state===0&&this.client.lastInfo.imageValid){
          try{const result=await this.client.request(P.OP.FINISH,new Uint8Array(),{timeoutMs:1000});if(result.length!==5||read32(result.slice(1))!==this.client.lastInfo.imageSize)throw error('OFFSET','退出升级模式反馈无效。');}catch{}
        }
        this.client?.close('用户取消了升级。');await this.adapter.disconnect().catch(()=>{});
      })();
      try{await this.cancelling;}finally{this.cancelling=null;}
    }
    async dispose(){const operation=this.operation;await this.cancel({background:true});this.generation++;this.client?.close('升级界面已关闭。');await operation?.catch(()=>{});await this.adapter.release();}
  }
  function targetOf(p){return{boardId:p.boardId,version:p.version,imageSize:p.imageSize,imageSha256:p.imageSha256};}
  return{TIMING,BootClient,Session,validateStatus,confirmIdentity,targetOf};
});
