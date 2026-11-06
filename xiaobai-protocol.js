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
    WAIT_IR:0x30, READ_IR:0x31, WAIT_TILT:0x32, READ_TILT:0x33, SHOW_EYE:0x40, SHOW_NUM:0x41, SHOW_OFF:0x42, SHOW_MATRIX:0x43,
    PLAY_VOICE:0x50, WAIT_VOICE:0x51, QUERY_LEARNED:0x52, LEARN_COMMAND:0x53,
    CANCEL_LEARNING:0x54, WAIT_LEARNED:0x55, READ_UID:0x56, DECLARE_RUN:0x57});
  const TILT = Object.freeze({UNKNOWN:0, UPRIGHT:1, FORWARD:2, BACKWARD:3, LEFT:4, RIGHT:5, INVERTED:6});
  function instructionError(opcode,result) {
    if(opcode===OP.WAIT_TILT||opcode===OP.READ_TILT){
      if(result===0x02)return '设备暂不支持倾倒指令，请更新小白主控固件。';
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
    constructor(onFrame) {this.onFrame=onFrame;this.buffer=[];}
    feed(data) {
      this.buffer.push(...data);
      while(this.buffer.length>=17) {
        if(this.buffer[0]!==0x5a||this.buffer[1]!==0x98||this.buffer[2]!==0x97||this.buffer[3]!==10||
           ![0xd2,0xd3].includes(this.buffer[4])||this.buffer[16]!==0xa5||
           (this.buffer.slice(0,15).reduce((sum,value)=>sum+value,0)&255)!==this.buffer[15]) {this.buffer.shift();continue;}
        this.onFrame(Uint8Array.from(this.buffer.splice(0,17)));
      }
      if(this.buffer.length>256) this.buffer.splice(0,this.buffer.length-16);
    }
  }
  class Link {
    constructor(transport,{onEvent=()=>{},onError=()=>{},minWriteMs=40,heartbeatMs=300}={}) {
      this.transport=transport;this.onEvent=onEvent;this.onError=onError;this.minWriteMs=minWriteMs;this.heartbeatMs=heartbeatMs;
      this.receiver=new Receiver(packet=>this.receive(packet));this.pending=new Map();this.seq=0;this.queue=Promise.resolve();
      this.eventListeners=new Set();this.lifecycleListeners=new Set();this.subscribed=false;
      this.actionVersion=0;this.lastWrite=0;this.lastReceive=0;this.mode=null;this.closed=false;this.heartbeatTimer=null;this.heartbeatBusy=false;
      this.modeVersion=0;this.desiredMode=null;this.modeEntry=null;
      this.programEnteredAt=0;this.programModeObservedAt=0;
    }
    async start() {await this.transport.start(bytes=>{this.lastReceive=Date.now();this.receiver.feed(bytes);});if(!this.closed)this.subscribed=true;}
    subscribe(listener){this.eventListeners.add(listener);return()=>this.eventListeners.delete(listener);}
    onLifecycle(listener){this.lifecycleListeners.add(listener);return()=>this.lifecycleListeners.delete(listener);}
    lifecycle(reason){for(const listener of this.lifecycleListeners)listener(reason);}
    async write(bytes,guard=()=>true,beforeWrite=()=>{}) {
      const task=this.queue.then(async()=>{
        if(this.closed) throw new Error('蓝牙连接已断开。');
        if(!guard()) return false;
        const c2=bytes[4]===0xc2;
        const gap=c2?Math.max(40,this.minWriteMs):this.minWriteMs;
        for(;;){
          const pause=Math.max(0,gap-(Date.now()-this.lastWrite),
            c2?gap-(Date.now()-this.lastReceive):0);
          if(!pause)break;
          await new Promise(resolve=>setTimeout(resolve,pause));
          if(this.closed||!guard())return false;
        }
        if(this.closed||!guard()) return false;
        // Leave a full turn-around gap after each completed write and notification.
        // Partial notifications also reset lastReceive; no request bypasses the guard.
        try{beforeWrite();await this.transport.write(bytes);}finally{this.lastWrite=Date.now();}
        return true;
      });
      this.queue=task.catch(()=>{});return task;
    }
    send(bytes,guard) {return this.write(bytes,guard);}
    receive(packet) {
      this.lastReceive=Date.now();
      const data=packet.slice(5,15);
      if(packet[4]===0xd3) {
        const event={code:data[0],counter:data[1],data:data.slice(2)};
        if(event.code===1&&event.data[0]===MODE.PROGRAM&&this.desiredMode===MODE.PROGRAM)this.programModeObservedAt=Date.now();
        if(event.code===2||(event.code===1&&event.data[0]!==MODE.PROGRAM&&(this.mode===MODE.PROGRAM||this.desiredMode===MODE.PROGRAM))) {
          this.modeVersion++;this.desiredMode=null;this.modeEntry=null;
          this.mode=event.code===1?event.data[0]:null;this.stopHeartbeat();this.rejectPending(new Error(event.code===2&&event.data[0]===7?'加速度传感器不可用，程序已停止。':'设备已退出编程模式，程序已停止。'));
        } else if(event.code===1) this.mode=event.data[0];
        for(const listener of this.eventListeners)listener(event);
        this.onEvent(event);return;
      }
      const [seq,opcode,result]=data,key=`${seq}:${opcode}`,pending=this.pending.get(key);
      if(!pending||!pending.sent||pending.match&&!pending.match(data.slice(3),result)) return;
      this.pending.delete(key);clearTimeout(pending.timer);
      if(result){const error=new Error(instructionError(opcode,result));error.result=result;error.opcode=opcode;error.data=Array.from(data.slice(3));pending.reject(error);}
      else pending.resolve(data.slice(3));
    }
    rejectPending(error) {this.actionVersion++;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();}
    nextSeq() {this.seq=this.seq%255+1;return this.seq;}
    async request(seq,opcode,args=[],timeout=0,match=null) {
      const key=`${seq}:${opcode}`;
      if(this.pending.has(key)) throw new Error('同一设备指令仍在等待回报。');
      let timer,entry;
      const answer=new Promise((resolve,reject)=>{entry={resolve,reject,timer:null,match,sent:false};this.pending.set(key,entry);});
      answer.catch(()=>{});
      if(timeout) {timer=setTimeout(()=>{const pending=this.pending.get(key);if(pending===entry){this.pending.delete(key);const error=new Error('设备未返回指令完成消息。');error.code='TIMEOUT';pending.reject(error);}},timeout);entry.timer=timer;}
      try {await this.write(command(seq,opcode,args),()=>this.pending.get(key)===entry,()=>{entry.sent=true;});return await answer;}
      catch(error) {const pending=this.pending.get(key);if(pending===entry){this.pending.delete(key);clearTimeout(timer);pending.reject(error);}answer.catch(()=>{});throw error;}
    }
    async probe() {return this.request(0,OP.QUERY_STATUS,[],1200);}
    startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatTimer=setInterval(()=>{
        if(this.closed||this.mode!==MODE.PROGRAM||this.desiredMode!==MODE.PROGRAM||this.heartbeatBusy)return;
        const version=this.modeVersion;
        this.heartbeatBusy=true;
        this.write(command(0,OP.HEARTBEAT),()=>version===this.modeVersion&&this.desiredMode===MODE.PROGRAM).catch(error=>{
          if(version!==this.modeVersion||this.closed)return;
          this.stopHeartbeat();this.rejectPending(error);this.lifecycle(error.message);this.onError(error);
        }).finally(()=>{this.heartbeatBusy=false;});
      },this.heartbeatMs);
    }
    stopHeartbeat(){clearInterval(this.heartbeatTimer);this.heartbeatTimer=null;}
    enterProgram(){return this.enterMode(MODE.PROGRAM);}
    enterRemote(){return this.enterMode(MODE.REMOTE);}
    enterMode(target){
      if(this.closed)return Promise.reject(new Error('蓝牙连接已断开。'));
      if(this.modeEntry?.target===target&&this.desiredMode===target)return this.modeEntry.promise;
      if(!this.modeEntry&&this.mode===target&&(target!==MODE.PROGRAM||this.heartbeatTimer)){
        this.desiredMode=target;return Promise.resolve();
      }
      const version=++this.modeVersion,entry={target,promise:null};this.desiredMode=target;
      if(target===MODE.PROGRAM)this.programModeObservedAt=0;
      if(target===MODE.REMOTE){
        this.lifecycle('已切换到遥控模式。');this.stopHeartbeat();this.rejectPending(new Error('已切换到遥控模式。'));
      }
      const current=()=>!this.closed&&this.modeVersion===version&&this.desiredMode===target;
      entry.promise=(async()=>{
        const sent=await this.write(command(0,target===MODE.PROGRAM?OP.ENTER_PROGRAM:OP.ENTER_REMOTE),current);
        if(!sent||!current())return;
        this.mode=target;if(target===MODE.PROGRAM){this.programEnteredAt=Date.now();this.startHeartbeat();}
      })().finally(()=>{if(this.modeEntry===entry)this.modeEntry=null;});
      this.modeEntry=entry;return entry.promise;
    }
    suspendProgram(reason='已离开编程页。'){
      const shouldStop=this.mode===MODE.PROGRAM||this.desiredMode===MODE.PROGRAM||this.modeEntry?.target===MODE.PROGRAM;
      if(this.modeEntry?.target===MODE.PROGRAM)this.mode=null;
      this.modeVersion++;this.desiredMode=null;this.modeEntry=null;
      this.stopHeartbeat();this.lifecycle(reason);this.rejectPending(new Error(reason));
      // The in-flight write cannot be recalled. Queue a stop behind it, before any later mode entry.
      return !this.closed&&shouldStop?this.write(command(0,OP.STOP_PROGRAM)):Promise.resolve();
    }
    async stopProgram(){
      const entering=this.modeEntry?.target===MODE.PROGRAM;
      if(entering){this.modeVersion++;this.desiredMode=null;this.modeEntry=null;this.mode=null;this.stopHeartbeat();}
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
    close(){this.closed=true;this.subscribed=false;this.modeVersion++;this.desiredMode=null;this.modeEntry=null;this.lifecycle('蓝牙连接已断开。');this.stopHeartbeat();this.rejectPending(new Error('蓝牙连接已断开。'));this.transport.close();}
  }
  return {MODE,OP,TILT,frame,command,milliseconds,matrixChunks,Receiver,Link};
});
