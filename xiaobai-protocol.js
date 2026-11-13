(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XiaobaiProtocol = api;
})(globalThis, function () {
  'use strict';
  const MODE = Object.freeze({VOICE:0, POWER:1, SENSING:2, REMOTE:3, PROGRAM:4});
  const OP = Object.freeze({ENTER_PROGRAM:1, ENTER_REMOTE:2, HEARTBEAT:3, QUERY_STATUS:4, STOP_PROGRAM:5,
    MOTOR_TIME:0x10, MOTOR_RUN:0x11, MOTOR_STOP:0x12, MOTOR_POWER:0x13,
    MOVE_TIME:0x20, MOVE_RUN:0x21, MOVE_STOP:0x22, MOVE_POWER:0x23,
    WAIT_IR:0x30, READ_IR:0x31, WAIT_TILT:0x32, READ_TILT:0x33, WAIT_MOTION:0x34, SHOW_EYE:0x40, SHOW_NUM:0x41, SHOW_OFF:0x42, SHOW_MATRIX:0x43,
    PLAY_VOICE:0x50, WAIT_VOICE:0x51, QUERY_LEARNED:0x52, LEARN_COMMAND:0x53,
    CANCEL_LEARNING:0x54, WAIT_LEARNED:0x55, READ_UID:0x56, DECLARE_RUN:0x57});
  const TILT = Object.freeze({UNKNOWN:0, UPRIGHT:1, FORWARD:2, BACKWARD:3, LEFT:4, RIGHT:5, INVERTED:6});
  // Keep deployed WAIT_TILT target1 on the wire; new editor cards use WAIT_MOTION.
  const TILT_TARGETS = Object.freeze({still:1, forward:2, backward:3, left:4, right:5});
  const TILT_DIRECTIONS = Object.freeze({forward:2,backward:3,left:4,right:5});
  const MOTION_TARGETS = Object.freeze({still:1,shaking:2,up:3,down:4});
  function instructionError(opcode,result) {
    if(opcode===OP.WAIT_TILT||opcode===OP.READ_TILT||opcode===OP.WAIT_MOTION){
      if(result===0x02)return opcode===OP.WAIT_MOTION?'设备暂不支持运动状态指令，请更新小白主控固件。':'设备暂不支持倾倒指令，请更新小白主控固件。';
      if(opcode===OP.WAIT_TILT&&result===0x03)return '设备拒绝此姿态条件，请核对积木参数并更新小白主控固件。';
      if(opcode===OP.WAIT_MOTION&&result===0x03)return '设备拒绝此运动条件，请核对积木参数并更新小白主控固件。';
      if(result===0x0a)return '加速度传感器不可用，请检查主机传感器和接线。';
    }
    return `设备拒绝指令 ${opcode.toString(16)}（错误 ${result}）。`;
  }
  function frame(type, data) {
    if (!Number.isInteger(type) || type<0 || type>255 || !Array.isArray(data) || data.length>10 ||
        data.some(value=>!Number.isInteger(value)||value<0||value>255)) throw new Error('无效的小白指令。');
    const bytes=[0x5a,0x97,0x98,0x0a,type,...data,...Array(10-data.length).fill(0)];
    bytes.push(bytes.reduce((sum,value)=>sum+value,0)&255,0xa5);
    return Uint8Array.from(bytes);
  }
  function command(seq,opcode,args=[]) {
    if(!Number.isInteger(seq)||seq<0||seq>255||!Number.isInteger(opcode)||opcode<0||opcode>255||args.length>8) throw new Error('无效的小白指令。');
    return frame(0xc2,[seq,opcode,...args]);
  }
  function milliseconds(seconds) {
    const ms=Math.round(seconds*1000);
    if(!Number.isSafeInteger(ms)||ms<1||ms>0xffffffff) throw new Error('运行时间超出设备支持范围。');
    return [ms&255,(ms>>>8)&255,(ms>>>16)&255,(ms>>>24)&255];
  }
  // Editor: row-major 64 bits. Wire: 8 columns per eye, bit0 = top row.
  function matrixChunks(transfer,left,right) {
    if(!Number.isInteger(transfer)||transfer<0||transfer>255)throw new Error('点阵传输编号无效。');
    const columns=[];
    for(const pattern of [left,right]) {
      if(!Array.isArray(pattern)||pattern.length!==64||Array.from(pattern).some(bit=>bit!==0&&bit!==1))
        throw new Error('每只眼睛须包含 64 个 0/1 像素。');
      for(let x=0;x<8;x++) {
        let column=0;
        for(let y=0;y<8;y++)if(pattern[y*8+x]&&!((x===0||x===7)&&(y===0||y===7)))column|=1<<y;
        columns.push(column);
      }
    }
    return [0,1,2].map(part=>[transfer,part,...Array.from({length:6},(_,i)=>columns[part*6+i]??0)]);
  }
  class Receiver {
    constructor(onFrame,{now=()=>Date.now(),partialMs=500}={}) {this.onFrame=onFrame;this.buffer=[];this.now=now;this.partialMs=partialMs;this.lastChunk=0;}
    feed(data) {
      const now=this.now();
      if(this.buffer.length&&now-this.lastChunk>this.partialMs)this.buffer=[];
      this.lastChunk=now;this.buffer.push(...data);
      while(this.buffer.length>=5) {
        if(this.buffer[0]!==0x5a||this.buffer[1]!==0x98||this.buffer[2]!==0x97) {this.buffer.shift();continue;}
        const multi=this.buffer[4]===0xd4,len=this.buffer[3];
        if(multi?(len<16||len>40):(len!==10||![0xd2,0xd3].includes(this.buffer[4]))) {this.buffer.shift();continue;}
        const size=len+7;if(this.buffer.length<size)break;
        const good=this.buffer[size-1]===0xa5&&(this.buffer.slice(0,size-2).reduce((sum,value)=>sum+value,0)&255)===this.buffer[size-2];
        // Once a bounded D4 header is recognized, consume its whole envelope even
        // when corrupt. Never reinterpret bytes inside it as legacy D2/D3.
        if(!good){this.buffer.splice(0,multi?size:1);continue;}
        this.onFrame(Uint8Array.from(this.buffer.splice(0,size)));
      }
      if(this.buffer.length>47)this.buffer=[];
    }
    reset(){this.buffer=[];this.lastChunk=0;}
  }
  class Link {
    constructor(transport,{onEvent=()=>{},onError=()=>{},minWriteMs=40,heartbeatMs=300,crypto=globalThis.crypto}={}) {
      this.transport=transport;this.onEvent=onEvent;this.onError=onError;this.minWriteMs=minWriteMs;this.heartbeatMs=heartbeatMs;
      this.receiver=new Receiver(packet=>this.receive(packet));this.pending=new Map();this.seq=0;this.queue=Promise.resolve();
      this.eventListeners=new Set();this.lifecycleListeners=new Set();this.multiListeners=new Set();this.multiLifecycleListeners=new Set();this.subscribed=false;
      this.writeJobs=[];this.writerRunning=false;this.writeEpoch=0;this.writeSerial=0;this.lastWritePriority=10;this.maxQueuedWrites=32;this.drainResolve=null;this.wakeWriter=null;
      this.actionVersion=0;this.lastWrite=0;this.lastReceive=0;this.mode=null;this.closed=false;this.heartbeatTimer=null;this.heartbeatBusy=false;
      this.modeVersion=0;this.desiredMode=null;this.modeEntry=null;
      this.programEnteredAt=0;this.programModeObservedAt=0;
      this.programKeepaliveAt=null;this.programPausedAt=null;this.programModeUncertain=false;
      this.crypto=crypto;this.programLinkToken=0;this.lastIssuedProgramToken=0;this.programRunSerial=0;this.programTokenModeVersion=0;
      this.controlWriteBurst=0;
    }
    async start() {await this.transport.start(bytes=>{this.lastReceive=Date.now();this.receiver.feed(bytes);});if(!this.closed)this.subscribed=true;}
    subscribe(listener){this.eventListeners.add(listener);return()=>this.eventListeners.delete(listener);}
    onLifecycle(listener){this.lifecycleListeners.add(listener);return()=>this.lifecycleListeners.delete(listener);}
    lifecycle(reason){for(const listener of this.lifecycleListeners)listener(reason);}
    subscribeMulti(listener){this.multiListeners.add(listener);return()=>this.multiListeners.delete(listener);}
    onMultiLifecycle(listener){this.multiLifecycleListeners.add(listener);return()=>this.multiLifecycleListeners.delete(listener);}
    write(bytes,guard=()=>true,beforeWrite=()=>{},{priority}={}) {
      if(this.closed)return Promise.reject(new Error('蓝牙连接已断开。'));
      const c2=bytes[4]===0xc2,c4=bytes[4]===0xc4;
      if(priority===undefined)priority=c2&&bytes[6]===OP.STOP_PROGRAM||c4&&bytes[6]===8?0:c2&&bytes[6]===OP.HEARTBEAT||c4&&bytes[6]===9?1:10;
      if(this.writeJobs.length>=this.maxQueuedWrites){
        // A full normal queue cannot exclude STOP, heartbeat or ACK. Evict one unsent
        // normal job; it has not touched the radio and must never be retried.
        let index=-1;
        if(priority<=2)for(let i=0;i<this.writeJobs.length;i++){
          if(this.writeJobs[i].priority>priority&&(index<0||this.writeJobs[i].priority>this.writeJobs[index].priority))index=i;
        }
        if(index<0)return Promise.reject(Object.assign(new Error('蓝牙发送队列已满。'),{code:'QUEUE_FULL'}));
        this.writeJobs.splice(index,1)[0].resolve(false);
      }
      if(!this.writerRunning&&!this.writeJobs.length)this.queue=new Promise(resolve=>{this.drainResolve=resolve;});
      const task=new Promise((resolve,reject)=>this.writeJobs.push({bytes:Uint8Array.from(bytes),guard,beforeWrite,priority,epoch:this.writeEpoch,serial:++this.writeSerial,enqueuedAt:Date.now(),resolve,reject}));
      this.wakeWriter?.();this.pumpWrites();return task;
    }
    async pumpWrites(){
      if(this.writerRunning)return;this.writerRunning=true;
      try{
        while(this.writeJobs.length){
          for(let i=this.writeJobs.length-1;i>=0;i--){const job=this.writeJobs[i];if(this.closed||(job.priority!==0&&job.epoch!==this.writeEpoch)||!job.guard()){this.writeJobs.splice(i,1);job.resolve(false);}}
          if(!this.writeJobs.length)break;
          this.writeJobs.sort((a,b)=>a.priority-b.priority||a.serial-b.serial);
          // Heartbeat has priority without starving normal commands when a test or
          // device requests a heartbeat interval shorter than the physical gap.
          if(this.writeJobs[0].priority===1&&this.lastWritePriority===1){const normal=this.writeJobs.findIndex(job=>job.priority>1);if(normal>=0)this.writeJobs.unshift(this.writeJobs.splice(normal,1)[0]);}
          // Urgent ACK/query bursts may overtake actions, but a bounded burst
          // yields one normal frame. First ACTION/BEGIN jobs retain FIFO at 10.
          if(this.writeJobs[0].priority>=2&&this.controlWriteBurst>=4){
            const normal=this.writeJobs.findIndex(job=>job.priority>=10);
            if(normal>=0)this.writeJobs.unshift(this.writeJobs.splice(normal,1)[0]);
          }
          const candidate=this.writeJobs[0],programming=[0xc2,0xc4].includes(candidate.bytes[4]);
          // Streamed programming shares one logical-frame budget across groups.
          // Urgent STOP/heartbeat/ACK keep the short physical frame guard.
          const streamed=candidate.bytes[4]===0xc4&&candidate.bytes[5]===2&&candidate.priority>2;
          const gap=programming?Math.max(streamed?100:40,this.minWriteMs):this.minWriteMs;
          const now=Date.now();
          // RX quiet is only a courtesy bounded by enqueue time, never an
          // indefinitely renewed prerequisite. Urgent safety/ACK skips it.
          const rxPause=programming&&candidate.priority>2?Math.min(
            Math.max(0,gap-(now-this.lastReceive)),Math.max(0,candidate.enqueuedAt+gap-now)):0;
          const pause=Math.max(0,gap-(now-this.lastWrite),rxPause);
          if(pause){await new Promise(resolve=>{let timer;const wake=()=>{clearTimeout(timer);if(this.wakeWriter===wake)this.wakeWriter=null;resolve();};this.wakeWriter=wake;timer=setTimeout(wake,pause);});continue;}
          const job=this.writeJobs.shift();
          if(this.closed||(job.priority!==0&&job.epoch!==this.writeEpoch)||!job.guard()){job.resolve(false);continue;}
          // transport.write resolves only after the entire logical frame, including
          // all native GATT chunks. Priority traffic cannot split that frame.
          try{job.beforeWrite();await this.transport.write(job.bytes);job.resolve(true);}catch(error){job.reject(error);}finally{this.lastWrite=Date.now();this.lastWritePriority=job.priority;
            if(job.priority>=2&&job.priority<10)this.controlWriteBurst++;
            else if(job.priority>=10)this.controlWriteBurst=0;}
        }
      }finally{
        this.writerRunning=false;const resolve=this.drainResolve;this.drainResolve=null;resolve?.();
        if(this.writeJobs.length)this.pumpWrites();
      }
    }
    send(bytes,guard) {return this.write(bytes,guard);}
    receive(packet) {
      this.lastReceive=Date.now();
      if(packet[4]===0xd4){for(const listener of this.multiListeners)listener(packet);return;}
      const data=packet.slice(5,15);
      if(packet[4]===0xd3) {
        const event={code:data[0],counter:data[1],data:data.slice(2)};
        if(event.code===1&&event.data[0]===MODE.PROGRAM&&this.desiredMode===MODE.PROGRAM)this.programModeObservedAt=Date.now();
        // An abort carries the MCU's actual mode in data[1]. Sensor/ASR aborts
        // that leave mode PROGRAM cancel the task, but retain its token high-water.
        const actualMode=event.code===1?event.data[0]:event.code===2?event.data[1]:null;
        if(event.code===2||(event.code===1&&actualMode!==MODE.PROGRAM)) {
          this.modeVersion++;this.desiredMode=null;this.modeEntry=null;
          this.programTokenModeVersion=0;this.pauseProgramOwnership();
          if(actualMode!==MODE.PROGRAM)this.clearProgramOwnership();
          this.mode=actualMode;this.stopHeartbeat();this.rejectPending(new Error(event.code===2&&event.data[0]===7?'加速度传感器不可用，程序已停止。':'设备已退出编程模式，程序已停止。'));
        } else if(event.code===1) this.mode=actualMode;
        for(const listener of this.eventListeners)listener(event);
        this.onEvent(event);return;
      }
      const [seq,opcode,result]=data,key=`${seq}:${opcode}`,pending=this.pending.get(key);
      if(!pending||!pending.sent||pending.match&&!pending.match(data.slice(3),result)) return;
      this.pending.delete(key);clearTimeout(pending.timer);
      if(result){const error=new Error(instructionError(opcode,result));error.result=result;error.opcode=opcode;error.data=Array.from(data.slice(3));pending.reject(error);}
      else pending.resolve(data.slice(3));
    }
    rejectPending(error) {this.actionVersion++;this.writeEpoch++;this.wakeWriter?.();for(const listener of this.multiLifecycleListeners)listener(error);for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();}
    nextSeq() {this.seq=this.seq%255+1;return this.seq;}
    async request(seq,opcode,args=[],timeout=0,match=null,options={}) {
      const key=`${seq}:${opcode}`;
      if(this.pending.has(key)) throw new Error('同一设备指令仍在等待回报。');
      options=options||{};
      const deadlineAt=options.deadlineAt;
      if(deadlineAt!==undefined&&!Number.isFinite(deadlineAt))throw new Error('设备请求截止时间无效。');
      let entry,deadlineTimer,rejectBound;
      const answer=new Promise((resolve,reject)=>{entry={resolve,reject,timer:null,match,sent:false};this.pending.set(key,entry);});
      answer.catch(()=>{});
      const bounded=new Promise((_,reject)=>{rejectBound=reject;});
      bounded.catch(()=>{});
      const failure=(code,message)=>Object.assign(new Error(message),{code,seq,opcode});
      const discard=error=>{
        if(this.pending.get(key)!==entry)return;
        this.pending.delete(key);clearTimeout(entry.timer);entry.reject(error);
      };
      // The outer bound also covers a native write whose Promise has not settled.
      // A response timeout must not wait behind that same Promise before rejecting.
      const end=error=>{discard(error);rejectBound(error);this.wakeWriter?.();};
      const cancelled=()=>end(failure('CANCELLED','设备请求已取消，连接或读取任务已变化。'));
      const deadline=()=>end(failure('DEADLINE','设备请求已超过等待上限，请重试确认。'));
      const current=()=>{
        if(this.pending.get(key)!==entry)return false;
        if(options.signal?.aborted){cancelled();return false;}
        if(deadlineAt!==undefined&&Date.now()>=deadlineAt){deadline();return false;}
        try{if(options.guard&&!options.guard()){cancelled();return false;}}
        catch(error){end(error);return false;}
        return true;
      };
      if(deadlineAt!==undefined)deadlineTimer=setTimeout(deadline,Math.max(0,deadlineAt-Date.now()));
      options.signal?.addEventListener('abort',cancelled,{once:true});
      try {
        if(!current())return await bounded;
        const writing=this.write(command(seq,opcode,args),current,()=>{
          entry.sent=true;
          // Queueing and earlier native GATT operations consume the total bound,
          // not the response budget for this newly transmitted request.
          if(timeout)entry.timer=setTimeout(()=>discard(failure('TIMEOUT','设备未返回指令完成消息。')),timeout);
        }).then(sent=>{
          // STOP/heartbeat may evict an unsent normal job from a full queue.
          // It has no response timer yet, so reject before waiting for an answer.
          if(!sent)throw failure('CANCELLED','设备请求未发送，读取任务已取消。');
          return sent;
        });
        const completed=Promise.all([writing,answer]).then(([,data])=>data);
        return await Promise.race([completed,bounded]);
      } catch(error) {discard(error);throw error;}
      finally {
        clearTimeout(entry.timer);clearTimeout(deadlineTimer);
        options.signal?.removeEventListener('abort',cancelled);
      }
    }
    async probe() {return this.request(0,OP.QUERY_STATUS,[],1200);}
    startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatTimer=setInterval(()=>{
        if(this.closed||this.mode!==MODE.PROGRAM||this.desiredMode!==MODE.PROGRAM||this.heartbeatBusy)return;
        const version=this.modeVersion;
        this.heartbeatBusy=true;let sentAt=null;
        this.write(command(0,OP.HEARTBEAT),()=>version===this.modeVersion&&this.desiredMode===MODE.PROGRAM,()=>{sentAt=Date.now();}).then(sent=>{
          if(sent&&version===this.modeVersion&&this.desiredMode===MODE.PROGRAM)this.programKeepaliveAt=sentAt;
        }).catch(error=>{
          if(version!==this.modeVersion||this.closed)return;
          this.pauseProgramOwnership();this.stopHeartbeat();this.rejectPending(error);this.lifecycle(error.message);this.onError(error);
        }).finally(()=>{this.heartbeatBusy=false;});
      },this.heartbeatMs);
    }
    stopHeartbeat(){clearInterval(this.heartbeatTimer);this.heartbeatTimer=null;}
    pauseProgramOwnership(){if(this.programLinkToken&&this.programPausedAt===null)this.programPausedAt=Date.now();}
    clearProgramOwnership(){
      this.programLinkToken=0;this.programRunSerial=0;this.programTokenModeVersion=0;
      this.programKeepaliveAt=null;this.programPausedAt=null;this.programModeUncertain=false;
    }
    needsProgramModeProbe(){
      // The MCU's watchdog is 1 second. A paused/blocked app may have missed its
      // exit D3; only a new, correlated status reply can resolve that uncertainty.
      return !!this.programLinkToken&&(this.programModeUncertain||this.programKeepaliveAt===null||Date.now()-this.programKeepaliveAt>=1000);
    }
    freshProgramToken(){
      if(!this.crypto?.getRandomValues)throw Object.assign(new Error('无法生成编程连接标识，请重新打开应用。'),{code:'RANDOM_UNAVAILABLE'});
      for(let i=0;i<8;i++){const words=new Uint32Array(1);this.crypto.getRandomValues(words);const value=words[0]>>>0;if(value&&value!==this.lastIssuedProgramToken){this.lastIssuedProgramToken=value;return value;}}
      throw Object.assign(new Error('无法生成新的编程连接标识，请重试。'),{code:'RANDOM_UNAVAILABLE'});
    }
    nextProgramRunSerial(){
      if(this.closed||this.mode!==MODE.PROGRAM||this.desiredMode!==MODE.PROGRAM||!this.heartbeatTimer||
         !this.programLinkToken||this.programTokenModeVersion!==this.modeVersion||this.needsProgramModeProbe())
        throw Object.assign(new Error('编程连接已变化，请重新进入编程界面。'),{code:'CANCELLED'});
      if(this.programRunSerial>=0xffffffff)throw Object.assign(new Error('运行编号已用尽，请断开后重新连接。'),{code:'EXHAUSTED'});
      return ++this.programRunSerial;
    }
    enterProgram(){return this.enterMode(MODE.PROGRAM);}
    enterRemote(){return this.enterMode(MODE.REMOTE);}
    enterMode(target){
      if(this.closed)return Promise.reject(new Error('蓝牙连接已断开。'));
      if(this.modeEntry?.target===target&&this.desiredMode===target)return this.modeEntry.promise;
      if(!this.modeEntry&&this.mode===target&&(target!==MODE.PROGRAM||this.heartbeatTimer&&!this.needsProgramModeProbe())){
        this.desiredMode=target;return Promise.resolve();
      }
      const version=++this.modeVersion,entry={target,promise:null};this.desiredMode=target;
      if(target===MODE.PROGRAM){this.programModeObservedAt=0;this.programTokenModeVersion=0;this.stopHeartbeat();}
      if(target===MODE.REMOTE){
        this.programTokenModeVersion=0;this.pauseProgramOwnership();
        this.lifecycle('已切换到遥控模式。');this.stopHeartbeat();this.rejectPending(new Error('已切换到遥控模式。'));
      }
      const current=()=>!this.closed&&this.modeVersion===version&&this.desiredMode===target;
      // Publish the entry promise before any write/probe can synchronously emit D3
      // or re-enter this method. Only this entry may publish readiness afterward.
      entry.promise=Promise.resolve().then(async()=>{
        let probed=false;
        while(current()){
          if(target===MODE.PROGRAM&&this.needsProgramModeProbe()){
            if(probed)throw Object.assign(new Error('编程模式确认已过期，请重新进入编程界面。'),{code:'MODE_UNCERTAIN'});
            probed=true;const probeAt=Date.now();
            const status=await this.request(this.nextSeq(),OP.QUERY_STATUS,[],1200,null,{guard:current,deadlineAt:probeAt+1500});
            if(!current())return;
            if(status.length!==7||status[0]>MODE.PROGRAM)throw new Error('设备返回的运行模式无效。');
            if(status[0]!==MODE.PROGRAM)this.clearProgramOwnership();
            else{
              // QUERY_STATUS is read-only. Use its enqueue time conservatively;
              // receiving the reply is not a heartbeat and cannot extend ownership.
              this.programModeUncertain=false;this.programKeepaliveAt=probeAt;
            }
            this.mode=status[0];
          }
          const reuse=target===MODE.PROGRAM&&!!this.programLinkToken;
          const token=target===MODE.PROGRAM?(this.programLinkToken||this.freshProgramToken()):0;
          const args=target===MODE.PROGRAM?[token&255,(token>>>8)&255,(token>>>16)&255,(token>>>24)&255,0,0,0,0]:[];
          let sentAt=null;
          const sent=await this.write(command(0,target===MODE.PROGRAM?OP.ENTER_PROGRAM:OP.ENTER_REMOTE,args),
            ()=>current()&&(!reuse||!this.needsProgramModeProbe()),()=>{
              sentAt=Date.now();
              if(target===MODE.PROGRAM){this.programLinkToken=token;this.programModeUncertain=true;}
              else if(this.programLinkToken)this.programModeUncertain=true;
            });
          if(!current())return;
          // A queued resume can cross the watchdog boundary before touching the
          // radio. Re-evaluate once, rather than sending an old token blindly.
          if(!sent){if(reuse&&this.needsProgramModeProbe())continue;return;}
          this.mode=target;
          if(target===MODE.PROGRAM){
            if(Date.now()-sentAt>=1000)throw Object.assign(new Error('编程连接确认已过期，请重新进入编程界面。'),{code:'MODE_UNCERTAIN'});
            this.programEnteredAt=Date.now();this.programKeepaliveAt=sentAt;this.programPausedAt=null;
            this.programModeUncertain=false;this.programTokenModeVersion=version;this.startHeartbeat();
          }
          return;
        }
      }).finally(()=>{if(this.modeEntry===entry)this.modeEntry=null;});
      this.modeEntry=entry;return entry.promise;
    }
    suspendProgram(reason='已离开编程页。'){
      const shouldStop=this.mode===MODE.PROGRAM||this.desiredMode===MODE.PROGRAM||this.modeEntry?.target===MODE.PROGRAM;
      if(this.modeEntry?.target===MODE.PROGRAM)this.mode=null;
      this.modeVersion++;this.desiredMode=null;this.modeEntry=null;
      this.programTokenModeVersion=0;this.pauseProgramOwnership();
      this.stopHeartbeat();this.lifecycle(reason);this.rejectPending(new Error(reason));
      // The in-flight write cannot be recalled. Queue a stop behind it, before any later mode entry.
      return !this.closed&&shouldStop?this.write(command(0,OP.STOP_PROGRAM)):Promise.resolve();
    }
    async stopProgram(){
      const entering=this.modeEntry?.target===MODE.PROGRAM;
      if(entering){this.modeVersion++;this.desiredMode=null;this.modeEntry=null;this.mode=null;this.programTokenModeVersion=0;this.pauseProgramOwnership();this.stopHeartbeat();}
      this.lifecycle('程序已停止。');this.rejectPending(new Error('程序已停止。'));
      if(this.mode===MODE.PROGRAM||entering)await this.write(command(0,OP.STOP_PROGRAM));
    }
    async action(opcode,args=[],blocking=false,timeout=0){
      if(this.mode!==MODE.PROGRAM) throw new Error('设备未处于编程模式。');
      if(this.firmwareGate&&!this.firmwareGate.snapshot().ready&&![OP.MOTOR_STOP,OP.MOVE_STOP,OP.STOP_PROGRAM].includes(opcode))throw new Error('请先完成主控固件核对。');
      const seq=this.nextSeq();
      if(blocking)return this.request(seq,opcode,args,timeout);
      const version=this.actionVersion;
      return this.write(command(seq,opcode,args),()=>version===this.actionVersion);
    }
    // Explicit diagnostics only: execution waits for WAIT_TILT DONE, never polls posture.
    async readTilt(){
      const data=await this.action(OP.READ_TILT,[],true,1500);
      if(data.length!==7||data[0]>TILT.INVERTED||data[1]>1||data[2]!==1||data.slice(3).some(Boolean))
        throw new Error('设备返回的倾倒状态无效。');
      if(!data[1])throw new Error('加速度传感器不可用，请检查主机传感器和接线。');
      return {state:data[0],ready:true,physicalIrCount:data[2]};
    }
    close(){this.closed=true;this.subscribed=false;this.clearProgramOwnership();this.modeVersion++;this.desiredMode=null;this.modeEntry=null;this.lifecycle('蓝牙连接已断开。');this.stopHeartbeat();this.rejectPending(new Error('蓝牙连接已断开。'));this.receiver.reset();this.transport.close();}
  }
  return {MODE,OP,TILT,TILT_TARGETS,TILT_DIRECTIONS,MOTION_TARGETS,frame,command,milliseconds,matrixChunks,Receiver,Link};
});
