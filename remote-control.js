(function(root) {
  'use strict';
  const protocol=typeof module==='object'&&module.exports?require('./spark-protocol.js'):root.SparkProtocol;
  const keys=Object.freeze(['up','down','left','right','A','B','X','Y','L','R']);
  function frame(pressed=[]) {
    if(!Array.isArray(pressed)||pressed.some(key=>!keys.includes(key))) throw new Error('未知遥控按键。');
    if(pressed.filter(key=>keys.indexOf(key)<4).length>1) throw new Error('方向键一次只能选择一个方向。');
    return protocol.frame(0xc1,Uint8Array.from(keys,key=>pressed.includes(key)?1:0));
  }
  // Only one write is in flight. Pending state is replaced, never replayed as old presses.
  class Session {
    constructor(send,onError=()=>{}) {this.send=send;this.onError=onError;this.pressed=[];this.pending=null;this.running=null;this.closed=false;this.timer=null;}
    start() {this.update([]);this.timer=setInterval(()=>this.update(this.pressed),1000);}
    update(pressed) {
      if(this.closed) return;
      const bytes=frame(pressed);this.pressed=[...pressed];this.pending=bytes;
      this.drain();
    }
    drain() {
      if(this.running) return this.running;
      this.running=(async()=>{
        while(this.pending) {
          const next=this.pending;this.pending=null;
          try {await this.send(next);}
          catch(error) {this.pending=null;this.closed=true;clearInterval(this.timer);this.onError(error);break;}
        }
      })().finally(()=>{this.running=null;if(this.pending) this.drain();});
      return this.running;
    }
    async stop() {
      clearInterval(this.timer);
      if(this.closed) return;
      this.closed=true;this.pressed=[];this.pending=frame();
      await this.drain();
    }
  }
  const api={keys,frame,Session};
  if(typeof module==='object'&&module.exports) module.exports=api;else root.CardRemoteControl=api;
})(globalThis);
