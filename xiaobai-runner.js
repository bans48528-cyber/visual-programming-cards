(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./remote-control.js') : root.CardRemoteControl);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XiaobaiRunner = api;
})(globalThis, function(remote) {
  'use strict';
  const motorIds = ['motor-forward','motor-reverse','motor-forward-continuous','motor-reverse-continuous','motor-stop'];
  const comboIds = ['combo-forward','combo-backward','combo-turn-left','combo-turn-right','combo-continuous','combo-stop'];
  const directions = {advance:[1,1],retreat:[-1,-1],left:[0,1],right:[1,0]};
  const mapping = Object.freeze({leftForward:'A',leftReverse:'B',rightForward:'X',rightReverse:'Y',speedUp:'L',speedDown:'R'});
  function validate(program) {
    const copy = JSON.parse(JSON.stringify(program));
    let count = 0;
    function sequence(items,depth=0) {
      if (!Array.isArray(items) || depth>20) throw new Error('程序结构无效或循环嵌套过深。');
      for (const item of items) {
        if (!item || ++count>1000) throw new Error('程序最多支持 1000 块积木。');
        const {id,params:p={}}=item;
        if (motorIds.includes(id)) {
          if (!['L/M1','R/M2'].includes(p.port)) throw new Error('请选择 L/M1 或 R/M2 电机。');
        } else if (!comboIds.includes(id) && !['speed-up','speed-down','wait-time','loop','loop-count'].includes(id)) {
          throw new Error('小白不支持此积木：'+id);
        }
        if (id==='combo-continuous' && !Object.prototype.hasOwnProperty.call(directions,p.direction)) throw new Error('移动方向无效。');
        if (['motor-forward','motor-reverse','combo-forward','combo-backward','combo-turn-left','combo-turn-right','wait-time'].includes(id)) {
          if (!Number.isFinite(p.duration) || p.duration<0.1 || p.duration>86400) throw new Error('时间须在 0.1 至 86400 秒之间。');
        }
        if (id==='loop' || id==='loop-count') {
          if (id==='loop-count' && (!Number.isInteger(p.count) || p.count<1 || p.count>1000000)) throw new Error('循环次数须为 1 至 1000000 的整数。');
          if (!Array.isArray(item.children) || !item.children.length) throw new Error('请在循环中放入积木。');
          sequence(item.children,depth+1);
        }
      }
    }
    sequence(copy);
    if (!copy.length) throw new Error('请先放入积木。');
    return copy;
  }
  class Cancelled extends Error {}
  class Runner {
    constructor(connection,{isCurrent=()=>true,onStep=()=>{},heartbeatMs=1000}={}) {
      this.connection=connection;this.isCurrent=isCurrent;this.onStep=onStep;this.heartbeatMs=heartbeatMs;
      this.motors=[0,0];this.queue=Promise.resolve();this.waiters=new Set();this.cancelled=false;this.pulsing=false;
      this.error=null;this.done=null;this.timer=null;
    }
    keys() {return [this.motors[0]>0?'A':this.motors[0]<0?'B':null,this.motors[1]>0?'X':this.motors[1]<0?'Y':null].filter(Boolean);}
    check() {
      if (this.error) throw this.error;
      if (this.cancelled) throw new Cancelled();
      if (!this.isCurrent()) throw new Error('连接已断开，程序已取消。请检查小白是否停止。');
    }
    write(keys,release=false) {
      const bytes=remote.frame(keys);
      const job=this.queue.then(async()=>{
        if (!release) this.check();
        if (!this.isCurrent()) throw new Error('连接已断开，无法确认停止。');
        const sent=await this.connection.send(bytes,()=>release || (!this.cancelled && !this.error && this.isCurrent()));
        if (sent===false && !release) this.check();
        if (sent===false) throw new Error('遥控指令未发送。');
      });
      this.queue=job.catch(()=>{});return job;
    }
    delay(ms) {
      this.check();
      return new Promise((resolve,reject)=>{
        const finish=()=>{clearTimeout(timer);this.waiters.delete(finish);try{this.check();resolve();}catch(error){reject(error);}};
        const timer=setTimeout(finish,ms);this.waiters.add(finish);
      });
    }
    cancel() {this.cancelled=true;clearTimeout(this.timer);for(const wake of [...this.waiters]) wake();}
    heartbeat() {
      this.timer=setTimeout(async()=>{
        try {this.check();if(!this.pulsing) await this.write(this.keys());this.heartbeat();}
        catch(error) {if(!(error instanceof Cancelled)){this.error=error;this.cancel();}}
      },this.heartbeatMs);
    }
    async sequence(items) {
      for (const item of items) {
        this.check();this.onStep(item);
        const {id,params:p={}}=item;
        if(id==='loop'||id==='loop-count') {
          for(let n=0;id==='loop'||n<p.count;n++) {await this.sequence(item.children);await this.delay(10);}
        } else if(id==='wait-time') await this.delay(p.duration*1000);
        else if(id==='speed-up'||id==='speed-down') {
          this.pulsing=true;
          try {await this.write([...this.keys(),id==='speed-up'?mapping.speedUp:mapping.speedDown]);await this.delay(100);await this.write(this.keys());await this.delay(100);}
          finally {this.pulsing=false;}
        } else if(motorIds.includes(id)) {
          const index=p.port==='L/M1'?0:1;
          this.motors[index]=id==='motor-stop'?0:id.includes('reverse')?-1:1;
          await this.write(this.keys());
          if(id==='motor-forward'||id==='motor-reverse') {await this.delay(p.duration*1000);this.motors[index]=0;await this.write(this.keys());}
        } else {
          const dir=id==='combo-continuous'?p.direction:({'combo-forward':'advance','combo-backward':'retreat','combo-turn-left':'left','combo-turn-right':'right'})[id];
          this.motors=id==='combo-stop'?[0,0]:[...directions[dir]];
          await this.write(this.keys());
          if(id!=='combo-continuous'&&id!=='combo-stop') {await this.delay(p.duration*1000);this.motors=[0,0];await this.write([]);}
        }
      }
    }
    run(program) {
      if(this.done) throw new Error('此执行会话不能重复使用。');
      const copy=validate(program);
      this.done=(async()=>{
        let failure=null;
        try {await this.write([]);this.heartbeat();await this.sequence(copy);}
        catch(error) {if(!(error instanceof Cancelled)) failure=error;}
        finally {
          this.cancel();this.motors=[0,0];
          try {await this.write([],true);} catch(error) {failure=failure||error;}
        }
        if(failure) throw failure;
      })();
      return this.done;
    }
    async stop() {this.cancel();if(this.done) await this.done;}
  }
  return {Runner,validate,mapping};
});
