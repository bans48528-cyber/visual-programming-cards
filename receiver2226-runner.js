(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./receiver2226-protocol.js'):root.Receiver2226Protocol);if(typeof module==='object'&&module.exports)module.exports=api;else root.Receiver2226Runner=api;})(globalThis,(Protocol)=>{
  const motors=['motor-forward','motor-reverse','motor-forward-continuous','motor-reverse-continuous','motor-stop'];
  const directions={advance:1,retreat:2,left:3,right:4};
  const timedCombos={'combo-forward':'advance','combo-backward':'retreat','combo-turn-left':'left','combo-turn-right':'right'};
  function validate(program){const copy=JSON.parse(JSON.stringify(program));let count=0;
    function visit(items,depth=0){if(!Array.isArray(items)||depth>20)throw new Error('程序结构或嵌套深度无效。');for(const item of items){if(!item||++count>1000)throw new Error('程序最多支持 1000 块积木。');const p=item.params||{};
      if(motors.includes(item.id)){if(p.port!=='M3')throw new Error('2226 仅支持独立控制第三路电机。');}
      else if(item.id==='combo-power'){if(!Number.isInteger(p.power)||p.power<1||p.power>5)throw new Error('档位须为 1 至 5。');}
      else if(item.id==='combo-continuous'){if(!Object.prototype.hasOwnProperty.call(directions,p.direction))throw new Error('请选择有效的移动方向。');}
      else if(Object.prototype.hasOwnProperty.call(timedCombos,item.id)){}
      else if(item.id==='loop'||item.id==='loop-count'){
        if(!item.children?.length)throw new Error('循环内请放入积木。');
        if(item.id==='loop-count'&&(!Number.isInteger(p.count)||p.count<1||p.count>1000000))throw new Error('循环次数无效。');visit(item.children,depth+1);
      }else if(!['wait-time','combo-stop'].includes(item.id))throw new Error('2226 不支持该积木：'+item.id);
      if((['motor-forward','motor-reverse','wait-time'].includes(item.id)||Object.prototype.hasOwnProperty.call(timedCombos,item.id))&&(!Number.isFinite(p.duration)||p.duration<0.1||p.duration>86400))throw new Error('时间须在 0.1 至 86400 秒之间。');
    }}visit(copy);if(!copy.length)throw new Error('请先放入积木。');return copy;
  }
  class Cancelled extends Error{}
  class Runner{
    constructor(connection,{isCurrent=()=>true,onStep=()=>{}}={}){this.connection=connection;this.isCurrent=isCurrent;this.onStep=onStep;this.motors=[0,0];this.power=3;this.cancelled=false;this.waiters=new Set();this.done=null;this.stopping=null;}
    check(){if(this.cancelled)throw new Cancelled();if(!this.isCurrent())throw new Error('连接已变化，程序已取消。');}
    cancel(){if(this.cancelled)return;this.cancelled=true;for(const wake of [...this.waiters])wake();this.connection.cancelPending?.();}
    delay(ms){this.check();return new Promise((resolve,reject)=>{const wake=()=>{clearTimeout(timer);this.waiters.delete(wake);try{this.check();resolve();}catch(e){reject(e);}};const timer=setTimeout(wake,ms);this.waiters.add(wake);});}
    async send(){this.check();await this.connection.send(Protocol.encode(this.power,...this.motors),()=>!this.cancelled&&this.isCurrent());this.check();}
    async sequence(items,parent=[]){for(const [i,item]of items.entries()){this.check();const path=[...parent,i],p=item.params||{};this.onStep(item,path);
      if(item.id==='wait-time')await this.delay(p.duration*1000);
      else if(item.id==='loop'||item.id==='loop-count'){for(let n=0;item.id==='loop'||n<p.count;n++){await this.sequence(item.children,path);await this.delay(10);}}
      else if(item.id==='combo-power'){this.power=p.power;await this.send();}
      else if(item.id==='combo-stop'){this.motors[0]=0;await this.send();}
      else if(item.id==='combo-continuous'||Object.prototype.hasOwnProperty.call(timedCombos,item.id)){
        this.motors[0]=directions[item.id==='combo-continuous'?p.direction:timedCombos[item.id]];await this.send();
        if(item.id!=='combo-continuous'){await this.delay(p.duration*1000);this.motors[0]=0;await this.send();}
      }
      else{const port=1;this.motors[port]=item.id==='motor-stop'?0:item.id.includes('reverse')?2:1;await this.send();
        if(item.id==='motor-forward'||item.id==='motor-reverse'){await this.delay(p.duration*1000);this.motors[port]=0;await this.send();}
      }
    }}
    stopMotor(){if(!this.stopping)this.stopping=(async()=>{if(this.isCurrent())await this.connection.send(Protocol.encode(this.power,0,0),()=>this.isCurrent());this.motors=[0,0];})();return this.stopping;}
    run(program){if(this.done)throw new Error('不能重复使用执行会话。');const copy=validate(program);this.done=(async()=>{let error;try{await this.send();await this.sequence(copy);}catch(e){if(!(e instanceof Cancelled))error=e;}finally{this.cancel();try{await this.stopMotor();}catch(e){error=error||e;}}if(error)throw error;})();return this.done;}
    async stop(){this.cancel();await this.stopMotor();if(this.done)await this.done;}
  }
  return {validate,Runner};
});
