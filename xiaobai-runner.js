(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./xiaobai-protocol.js'):root.XiaobaiProtocol);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.XiaobaiRunner=api;
})(globalThis,function(protocol){
  'use strict';
  const {OP,milliseconds}=protocol;
  const motorIds=new Set(['motor-forward','motor-reverse','motor-forward-continuous','motor-reverse-continuous','motor-stop']);
  const comboIds=new Set(['combo-forward','combo-backward','combo-turn-left','combo-turn-right','combo-continuous','combo-stop']);
  const supported=new Set([...motorIds,...comboIds,'motor-power','combo-power','wait-time','loop','loop-count','infrared-wait',
    'eye-expression','display-number','display-off','speech-play','speech-wait','speed-up','speed-down']);
  const move={advance:1,left:2,right:3,retreat:4};
  const motorIndex=port=>['L/M1','L'].includes(port)?0:1;
  function validate(program){
    const copy=JSON.parse(JSON.stringify(program));let count=0;
    function sequence(items,depth=0){
      if(!Array.isArray(items)||depth>20)throw new Error('程序结构无效或循环嵌套过深。');
      for(const item of items){
        if(!item||++count>1000)throw new Error('程序最多支持 1000 块积木。');
        const {id,params:p={}}=item;
        if(!supported.has(id))throw new Error('小白不支持此积木：'+id);
        if(motorIds.has(id)&&!['L/M1','R/M2','L','R'].includes(p.port))throw new Error('请选择左或右电机。');
        if(id==='combo-continuous'&&!Object.hasOwn(move,p.direction))throw new Error('移动方向无效。');
        if(['motor-forward','motor-reverse','combo-forward','combo-backward','combo-turn-left','combo-turn-right','wait-time'].includes(id)){
          if(!Number.isFinite(p.duration)||p.duration<0.001||p.duration>86400)throw new Error('时间须在 0.001 至 86400 秒之间。');
        }
        if(['motor-power','combo-power'].includes(id)&&![1,2,3].includes(Number(p.power)))throw new Error('功率档位无效。');
        if(id==='infrared-wait'&&(!['greater','less'].includes(p.comparison)||!Number.isInteger(p.threshold)||p.threshold<0||p.threshold>100))throw new Error('红外等待条件无效。');
        if(id==='display-number'&&(!Number.isInteger(p.value)||p.value<0||p.value>100))throw new Error('显示数字须在 0 至 100 之间。');
        if(id==='eye-expression'&&!/^EYE_(0[1-9]|10)$/.test(p.expression))throw new Error('眼睛表情无效。');
        if(id==='speech-play'&&!/^P(0[1-9]|10)$/.test(p.phrase))throw new Error('播报词条无效。');
        if(id==='speech-wait'&&!/^ASR_(0[1-9]|10)$/.test(p.phrase))throw new Error('识别词条无效。');
        if(id==='loop'||id==='loop-count'){
          if(id==='loop-count'&&(!Number.isInteger(p.count)||p.count<1||p.count>1000000))throw new Error('循环次数无效。');
          if(!Array.isArray(item.children)||!item.children.length)throw new Error('请在循环中放入积木。');
          sequence(item.children,depth+1);
        }
      }
    }
    sequence(copy);if(!copy.length)throw new Error('请先放入积木。');return copy;
  }
  class Cancelled extends Error{}
  class Runner{
    constructor(connection,{isCurrent=()=>true,onStep=()=>{}}={}){
      this.connection=connection;this.isCurrent=isCurrent;this.onStep=onStep;
      this.cancelled=false;this.waiters=new Set();this.done=null;this.comboPower=3;
    }
    check(){if(this.cancelled)throw new Cancelled();if(!this.isCurrent())throw new Error('连接已断开，程序已取消。');}
    delay(ms){this.check();return new Promise((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);this.waiters.delete(finish);try{this.check();resolve();}catch(error){reject(error);}};
      const timer=setTimeout(finish,ms);this.waiters.add(finish);
    });}
    cancel(){this.cancelled=true;for(const wake of [...this.waiters])wake();this.connection.cancelPending?.();}
    async action(op,args=[],blocking=false,timeout=0){this.check();await this.connection.action(op,args,blocking,timeout);this.check();}
    async sequence(items){
      for(const item of items){
        this.check();this.onStep(item);const {id,params:p={}}=item;
        if(id==='loop'||id==='loop-count'){
          for(let n=0;id==='loop'||n<p.count;n++){await this.sequence(item.children);await this.delay(10);}
        }else if(id==='wait-time')await this.delay(p.duration*1000);
        else if(motorIds.has(id)){
          const motor=motorIndex(p.port);
          if(id==='motor-stop')await this.action(OP.MOTOR_STOP,[motor]);
          else{
            const direction=id.includes('reverse')?2:1;
            if(id.endsWith('continuous'))await this.action(OP.MOTOR_RUN,[motor,direction]);
            else await this.action(OP.MOTOR_TIME,[motor,direction,...milliseconds(p.duration)],true,p.duration*1000+5000);
          }
        }else if(id==='motor-power')await this.action(OP.MOTOR_POWER,[Number(p.power)]);
        else if(comboIds.has(id)){
          if(id==='combo-stop')await this.action(OP.MOVE_STOP);
          else{
            const direction=id==='combo-continuous'?move[p.direction]:
              {'combo-forward':1,'combo-turn-left':2,'combo-turn-right':3,'combo-backward':4}[id];
            if(id==='combo-continuous')await this.action(OP.MOVE_RUN,[direction]);
            else await this.action(OP.MOVE_TIME,[direction,...milliseconds(p.duration)],true,p.duration*1000+5000);
          }
        }else if(id==='combo-power'){this.comboPower=Number(p.power);await this.action(OP.MOVE_POWER,[this.comboPower]);}
        else if(id==='speed-up'||id==='speed-down'){
          this.comboPower=Math.max(1,Math.min(3,this.comboPower+(id==='speed-up'?1:-1)));
          await this.action(OP.MOVE_POWER,[this.comboPower]);
        }else if(id==='infrared-wait')await this.action(OP.WAIT_IR,[1,p.comparison==='greater'?0:1,p.threshold],true);
        else if(id==='eye-expression')await this.action(OP.SHOW_EYE,[Number(p.expression.slice(-2))]);
        else if(id==='display-number')await this.action(OP.SHOW_NUM,[p.value]);
        else if(id==='display-off')await this.action(OP.SHOW_OFF);
        else if(id==='speech-play')await this.action(OP.PLAY_VOICE,[Number(p.phrase.slice(-2))]);
        else if(id==='speech-wait')await this.action(OP.WAIT_VOICE,[Number(p.phrase.slice(-2))],true);
      }
    }
    run(program){
      if(this.done)throw new Error('此执行会话不能重复使用。');
      const copy=validate(program);
      this.done=(async()=>{
        let failure=null;
        try{await this.connection.enterProgram();await this.sequence(copy);}
        catch(error){if(!(error instanceof Cancelled))failure=error;}
        finally{this.cancel();try{if(this.isCurrent())await this.connection.stopProgram();}catch(error){failure=failure||error;}}
        if(failure)throw failure;
      })();return this.done;
    }
    async stop(){this.cancel();if(this.isCurrent())await this.connection.stopProgram();if(this.done)await this.done;}
  }
  return {Runner,validate};
});
