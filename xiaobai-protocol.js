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
    WAIT_IR:0x30, READ_IR:0x31, SHOW_EYE:0x40, SHOW_NUM:0x41, SHOW_OFF:0x42,
    PLAY_VOICE:0x50, WAIT_VOICE:0x51});
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
    constructor(transport,{onEvent=()=>{},onError=()=>{},minWriteMs=30,heartbeatMs=400}={}) {
      this.transport=transport;this.onEvent=onEvent;this.onError=onError;this.minWriteMs=minWriteMs;this.heartbeatMs=heartbeatMs;
      this.receiver=new Receiver(packet=>this.receive(packet));this.pending=new Map();this.seq=0;this.queue=Promise.resolve();
      this.lastWrite=0;this.mode=null;this.closed=false;this.heartbeatTimer=null;this.heartbeatBusy=false;
    }
    async start() {await this.transport.start(bytes=>this.receiver.feed(bytes));}
    async write(bytes,guard=()=>true) {
      const task=this.queue.then(async()=>{
        if(this.closed) throw new Error('蓝牙连接已断开。');
        if(!guard()) return false;
        const pause=Math.max(0,this.minWriteMs-(Date.now()-this.lastWrite));
        if(pause) await new Promise(resolve=>setTimeout(resolve,pause));
        if(this.closed||!guard()) return false;
        // Count the protocol interval from the start of the previous write.
        // A write-with-response already consumes part (or all) of that gap.
        this.lastWrite=Date.now();await this.transport.write(bytes);return true;
      });
      this.queue=task.catch(()=>{});return task;
    }
    send(bytes,guard) {return this.write(bytes,guard);}
    receive(packet) {
      const data=packet.slice(5,15);
      if(packet[4]===0xd3) {
        const event={code:data[0],counter:data[1],data:data.slice(2)};
        if(event.code===2||(event.code===1&&event.data[0]!==MODE.PROGRAM&&this.mode===MODE.PROGRAM)) {
          this.mode=event.code===1?event.data[0]:null;this.stopHeartbeat();this.rejectPending(new Error('设备已退出编程模式，程序已停止。'));
        } else if(event.code===1) this.mode=event.data[0];
        this.onEvent(event);return;
      }
      const [seq,opcode,result]=data,key=`${seq}:${opcode}`,pending=this.pending.get(key);
      if(!pending) return;
      this.pending.delete(key);clearTimeout(pending.timer);
      if(result) pending.reject(new Error(`设备拒绝指令 ${opcode.toString(16)}（错误 ${result}）。`));
      else pending.resolve(data.slice(3));
    }
    rejectPending(error) {for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();}
    nextSeq() {this.seq=this.seq%255+1;return this.seq;}
    async request(seq,opcode,args=[],timeout=0) {
      const key=`${seq}:${opcode}`;
      if(this.pending.has(key)) throw new Error('同一设备指令仍在等待回报。');
      let timer;
      const answer=new Promise((resolve,reject)=>{this.pending.set(key,{resolve,reject,timer:null});});
      if(timeout) {timer=setTimeout(()=>{const pending=this.pending.get(key);if(pending){this.pending.delete(key);pending.reject(new Error('设备未返回指令完成消息。'));}},timeout);this.pending.get(key).timer=timer;}
      try {await this.write(command(seq,opcode,args));return await answer;}
      catch(error) {const pending=this.pending.get(key);if(pending){this.pending.delete(key);clearTimeout(timer);pending.reject(error);}answer.catch(()=>{});throw error;}
    }
    async probe() {return this.request(0,OP.QUERY_STATUS,[],1200);}
    startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatTimer=setInterval(()=>{
        if(this.closed||this.mode!==MODE.PROGRAM||this.heartbeatBusy)return;
        this.heartbeatBusy=true;
        this.write(command(0,OP.HEARTBEAT)).catch(error=>{this.stopHeartbeat();this.rejectPending(error);this.onError(error);}).finally(()=>{this.heartbeatBusy=false;});
      },this.heartbeatMs);
    }
    stopHeartbeat(){clearInterval(this.heartbeatTimer);this.heartbeatTimer=null;}
    async enterProgram(){if(this.mode===MODE.PROGRAM&&this.heartbeatTimer)return;await this.write(command(0,OP.ENTER_PROGRAM));this.mode=MODE.PROGRAM;this.startHeartbeat();}
    async enterRemote(){if(this.mode===MODE.REMOTE)return;this.stopHeartbeat();this.rejectPending(new Error('已切换到遥控模式。'));await this.write(command(0,OP.ENTER_REMOTE));this.mode=MODE.REMOTE;}
    async stopProgram(){this.rejectPending(new Error('程序已停止。'));if(this.mode===MODE.PROGRAM)await this.write(command(0,OP.STOP_PROGRAM));}
    async action(opcode,args=[],blocking=false,timeout=0){
      if(this.mode!==MODE.PROGRAM) throw new Error('设备未处于编程模式。');
      const seq=this.nextSeq();
      if(blocking)return this.request(seq,opcode,args,timeout);
      return this.write(command(seq,opcode,args));
    }
    close(){this.closed=true;this.stopHeartbeat();this.rejectPending(new Error('蓝牙连接已断开。'));this.transport.close();}
  }
  return {MODE,OP,frame,command,milliseconds,Receiver,Link};
});
