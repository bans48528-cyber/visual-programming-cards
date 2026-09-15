(function (root) {
  "use strict";
  const SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
  const CHARACTERISTIC = "0000fff1-0000-1000-8000-00805f9b34fb";
  const CMD = Object.freeze({RUN:0xb6, STOP:0xb9, WATCH:0xd0, UNWATCH:0xba,
    FILES:0xe7, VERSION:0xea, NAME:0xda, DATA:0xaa, END:0xbb, END_RUN:0xbc});
  const encoder = new TextEncoder();
  function frame(command, data = [1]) {
    const bytes = Array.from(data);
    if (!Number.isInteger(command) || command < 0 || command > 255 || bytes.length > 255 ||
        bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error("Invalid frame data");
    const result = [0x5a,0x97,0x98,bytes.length,command,...bytes];
    result.push(result.reduce((sum,b) => sum+b,0)&255,0xa5);
    return Uint8Array.from(result);
  }
  function uploadFrames(bytecode, slot = 0, run = true) {
    if (!(bytecode instanceof Uint8Array) || !bytecode.length) throw new Error("字节码文件为空或格式无效。");
    if (!Number.isInteger(slot) || slot < 0 || slot > 10) throw new Error("程序槽位必须为 0–10。");
    const frames = [frame(CMD.NAME,encoder.encode(`${slot}.o`))];
    for (let i=0;i<bytecode.length;i+=128) {
      const last = i+128 >= bytecode.length;
      frames.push(frame(last ? (run ? CMD.END_RUN : CMD.END) : CMD.DATA,bytecode.slice(i,i+128)));
    }
    return frames;
  }
  // Binary packets and brace-delimited JSON share the notification stream.
  class Receiver {
    constructor(onFrame, onStatus, onError, onRecover=()=>{}) {this.onFrame=onFrame;this.onStatus=onStatus;this.onError=onError;this.onRecover=onRecover;this.reset();}
    reset() {this.buffer=[];}
    feed(data) {
      this.buffer.push(...data);
      if(this.buffer.length>65536) {this.reset();this.onError(new Error("接收缓存超限。"));return;}
      while(this.buffer.length) {
        const b=this.buffer;
        if(b[0]===0x5a) {
          if(b.length<4) return;
          if(![0x97,0x98].includes(b[1]) || ![0x97,0x98].includes(b[2])) {b.shift();continue;}
          const length=b[3]+7;
          if(b.length<length) return;
          const packet=b.slice(0,length);
          const sum=packet.slice(0,-2).reduce((s,v)=>s+v,0)&255;
          if(packet[length-1]!==0xa5 || packet[length-2]!==sum) {
            b.shift();this.onError(new Error("设备回包校验失败，上传已中止。"));continue;
          }
          b.splice(0,length);this.onFrame(Uint8Array.from(packet));
        } else if(b[0]===123) {
          // A validated binary header cannot occur in valid UTF-8 JSON. Recover
          // at that boundary if a truncated status packet precedes a reply.
          let reply=-1;
          for(let i=1;i+7<=b.length;i++) {
            if(b[i]!==0x5a || ![0x97,0x98].includes(b[i+1]) || ![0x97,0x98].includes(b[i+2])) continue;
            const size=b[i+3]+7;
            if(i+size>b.length || b[i+size-1]!==0xa5) continue;
            const sum=b.slice(i,i+size-2).reduce((s,v)=>s+v,0)&255;
            if(sum===b[i+size-2]) {reply=i;break;}
          }
          let depth=0,quoted=false,escaped=false,end=-1;
          for(let i=0;i<b.length;i++) {
            const c=b[i];
            if(quoted) {if(escaped) escaped=false;else if(c===92) escaped=true;else if(c===34) quoted=false;}
            else if(c===34) quoted=true;
            else if(c===123) depth++;
            else if(c===125 && --depth===0) {end=i+1;break;}
          }
          if(reply>=0 && (end<0 || reply<end)) {
            b.splice(0,reply);this.onRecover(`丢弃残缺状态数据 ${reply} 字节，恢复二进制回包解析。`);continue;
          }
          if(end<0) {
            // Firmware status reports are CRLF-delimited; an unfinished report
            // must not retain every later report after a missing BLE fragment.
            const newline=b.findIndex((c,i)=>c===13 && b[i+1]===10);
            if(newline<0) return;
            b.splice(0,newline+2);this.onRecover(`丢弃残缺状态数据 ${newline+2} 字节，等待下一条上报。`);continue;
          }
          const text=new TextDecoder().decode(Uint8Array.from(b.splice(0,end)));
          try {this.onStatus(JSON.parse(text));} catch {this.onError(new Error("设备状态 JSON 无效。"));}
        } else b.shift();
      }
    }
  }
  class WebBluetoothTransport {
    constructor(characteristic) {this.characteristic=characteristic;}
    get properties() {return this.characteristic.properties;}
    async start(receive) {
      this.notification=event=>{
        const value=event.target.value;
        receive(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
      };
      this.characteristic.addEventListener('characteristicvaluechanged',this.notification);
      await this.characteristic.startNotifications();
    }
    write(bytes) {
      return this.properties.writeWithoutResponse
        ? this.characteristic.writeValueWithoutResponse(bytes)
        : this.characteristic.writeValueWithResponse(bytes);
    }
    close() {this.characteristic.removeEventListener('characteristicvaluechanged',this.notification);}
    disconnect() {this.characteristic.service?.device?.gatt?.disconnect();}
  }
  class Link {
    constructor(characteristic, {transport, acceptAck=()=>true, onStatus=()=>{}, onProgress=()=>{}, onError=()=>{}, onTrace=()=>{}, timeout=5000}={}) {
      this.characteristic=characteristic;this.timeout=timeout;this.onProgress=onProgress;
      this.transport=transport || new WebBluetoothTransport(characteristic);
      this.trace=onTrace;this.receivedBytes=0;
      this.closed=false;this.queue=Promise.resolve();this.pending=null;this.session=null;
      this.receiver=new Receiver(packet=>{
        this.trace("FRAME",packet);
        // Desktop retains APK compatibility; Android filters the observed upload reply.
        if(this.pending) {
          if(acceptAck(packet)) this.pending.resolve(packet);
          else this.trace("ACK_IGNORED",packet,"非文件发送确认，继续等待。");
        }
      },onStatus,error=>{this.trace("ERROR",null,error.message);this.pending?.reject(error);onError(error);},detail=>this.trace("RECOVER",null,detail));
      this.notification=bytes=>{
        if(this.closed) return;
        this.receivedBytes+=bytes.length;
        this.trace("RX",bytes);
        this.receiver.feed(bytes);
      };
    }
    async start() {
      const p=this.transport.properties;
      if(!(p.notify||p.indicate) || !(p.writeWithoutResponse||p.write)) throw new Error("FFF1 不支持所需的写入和通知能力。");
      await this.transport.start(this.notification);
      if(this.closed) {this.transport.close();throw new Error("连接已取消。");}
      this.trace("READY",null,`notify=${p.notify}, indicate=${p.indicate}, write=${p.write}, withoutResponse=${p.writeWithoutResponse}`);
      await this.write(frame(CMD.WATCH));
    }
    write(bytes, session, shouldWrite=()=>true) {
      const operation=this.queue.then(async()=>{
        if(this.closed) throw new Error("蓝牙连接已断开。");
        if(session?.cancelled) throw new Error("上传已取消。");
        if(!shouldWrite()) return false;
        const c=this.transport;
        const withResponse=!c.properties.writeWithoutResponse;
        let timer;
        try {
          this.trace("TX",bytes,withResponse ? "withResponse" : "withoutResponse");
          await Promise.race([
            c.write(bytes),
            new Promise((_,reject)=>{timer=setTimeout(()=>{
              this.close();c.disconnect();
              reject(new Error("蓝牙写入超时，连接已关闭，请检查设备。"));
            },this.timeout);})
          ]);
          this.trace("WRITE_OK",null,`CMD=${bytes[4].toString(16).toUpperCase()}（${withResponse ? "有响应写入完成，不代表指令已执行或设备已停止" : "系统写入完成，不代表设备ACK"}）`);
          return true;
        } finally {clearTimeout(timer);}
      });
      this.queue=operation.catch(()=>{});return operation;
    }
    async exchange(bytes,session) {
      let timer;
      const before=this.receivedBytes;
      const command=bytes[4].toString(16).toUpperCase();
      const ack=new Promise((resolve,reject)=>{
        this.pending={resolve,reject};
        timer=setTimeout(()=>{
          const received=this.receivedBytes-before;
          const detail=`${command}帧等待上传回包超时；期间收到${received}字节，缓存${this.receiver.buffer.length}字节。未自动重传。`;
          this.trace("TIMEOUT",Uint8Array.from(this.receiver.buffer.slice(0,256)),detail);
          reject(new Error(detail+"请查看蓝牙页通讯诊断。"));
        },this.timeout);
      });
      try {await Promise.all([ack,this.write(bytes,session)]);}
      finally {clearTimeout(timer);this.pending=null;}
    }
    async upload(bytes,{slot=0,run=true,allowUnverifiedAck=false}={}) {
      if(!allowUnverifiedAck) throw new Error("需要确认 APK 兼容 ACK 模式的实机验证限制。");
      if(this.session) throw new Error("已有上传任务，请等待或停止。");
      const frames=uploadFrames(bytes,slot,run);
      const session={cancelled:false};this.session=session;
      try {
        for(let i=0;i<frames.length;i++) {
          if(session.cancelled) throw new Error("上传已取消。");
          this.onProgress(i,frames.length);
          await this.exchange(frames[i],session);
        }
        this.onProgress(frames.length,frames.length);
      } finally {
        this.session=null;
        if(!this.closed && !session.cancelled) await this.write(frame(CMD.WATCH));
      }
    }
    cancelUpload() {
      if(this.session) this.session.cancelled=true;
      this.pending?.reject(new Error("上传已取消。"));
    }
    async stop(shouldSend=()=>true) {
      this.cancelUpload();
      for(let i=0;i<5;i++) {
        if(i>0) await new Promise(resolve=>setTimeout(resolve,80));
        if(!await this.write(frame(CMD.STOP),undefined,shouldSend)) return false;
      }
      return true;
    }
    close() {
      this.closed=true;
      if(this.session) this.session.cancelled=true;
      this.pending?.reject(new Error("蓝牙连接已断开，上传中止。"));
      this.transport.close();
      this.receiver.reset();
    }
  }
  const api={SERVICE,CHARACTERISTIC,CMD,frame,uploadFrames,Receiver,Link,WebBluetoothTransport};
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  else root.SparkProtocol=api;
})(globalThis);
