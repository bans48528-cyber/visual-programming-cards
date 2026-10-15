(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Lbs2206Runner=api;})(globalThis,()=>{
  const timed={'combo-forward':'forward','combo-backward':'backward','combo-turn-left':'left','combo-turn-right':'right'};
  const directions={advance:'forward',retreat:'backward',left:'left',right:'right'};
  const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  function validate(program){const copy=JSON.parse(JSON.stringify(program));let count=0;
    function visit(items,depth=0){if(!Array.isArray(items)||depth>20)throw new Error('程序结构无效');
      for(const item of items){if(!item||++count>1000)throw new Error('程序最多支持 1000 块积木');const {id,params:p={}}=item;
        if(id.startsWith('lbs-'))throw new Error('此作品包含旧版步数积木，请替换为按时间或持续运动积木；步数不会自动转换为秒数。');
        if(has(timed,id)||id==='wait-time'){if(!Number.isFinite(p.duration)||p.duration<0.1||p.duration>86400)throw new Error('时间须在 0.1 至 86400 秒之间');}
        else if(id==='combo-continuous'){if(!has(directions,p.direction))throw new Error('移动方向无效');}
        else if(id==='combo-power'){if(!Number.isInteger(p.power)||p.power<1||p.power>5)throw new Error('功率须为 1～5 档');}
        else if(id==='loop-count'){if(!Number.isInteger(p.count)||p.count<1||p.count>1000000||!item.children?.length)throw new Error('循环次数或内容无效');visit(item.children,depth+1);}
        else if(id!=='combo-stop')throw new Error('此型号不支持该积木：'+id);
      }}visit(copy);if(!copy.length)throw new Error('请先放入积木');return copy;}
  class Cancelled extends Error{}
  class Runner{
    constructor(connection,{isCurrent=()=>true,onStep=()=>{}}={}){this.connection=connection;this.isCurrent=isCurrent;this.onStep=onStep;this.cancelled=false;this.waiters=new Set();this.power=3;this.direction='stop';this.done=null;this.stopping=null;}
    check(){if(this.cancelled)throw new Cancelled();if(!this.isCurrent())throw new Error('连接已变化，程序已取消');}
    delay(ms){this.check();return new Promise((resolve,reject)=>{const wake=()=>{clearTimeout(timer);this.waiters.delete(wake);try{this.check();resolve();}catch(e){reject(e);}};const timer=setTimeout(wake,ms);this.waiters.add(wake);});}
    cancel(){this.cancelled=true;for(const wake of [...this.waiters])wake();}
    async move(direction){this.check();await this.connection.remote(direction,this.power,()=>!this.cancelled&&this.isCurrent());this.check();this.direction=direction;}
    stopMotor(){if(!this.stopping)this.stopping=(async()=>{if(this.isCurrent())await this.connection.remote('stop',this.power);this.direction='stop';})();return this.stopping;}
    async sequence(items,parent=[]){for(const [i,item]of items.entries()){this.check();const path=[...parent,i],p=item.params||{};this.onStep(item,path);
      if(item.id==='loop-count'){for(let n=0;n<p.count;n++){await this.sequence(item.children,path);await this.delay(10);}}
      else if(item.id==='wait-time')await this.delay(p.duration*1000);
      else if(item.id==='combo-power'){this.power=p.power;if(this.direction!=='stop')await this.move(this.direction);}
      else if(item.id==='combo-stop')await this.move('stop');
      else if(item.id==='combo-continuous')await this.move(directions[p.direction]);
      else {await this.move(timed[item.id]);await this.delay(p.duration*1000);await this.move('stop');}
    }}
    run(program){if(this.done)throw new Error('执行会话不能重复使用');const copy=validate(program);this.done=(async()=>{let error;try{await this.sequence(copy);}catch(e){if(!(e instanceof Cancelled))error=e;}finally{this.cancel();try{await this.stopMotor();}catch(e){error=error||e;}}if(error)throw error;})();return this.done;}
    async stop(){this.cancel();await this.stopMotor();if(this.done)await this.done;}
  }
  return {validate,Runner};
});
