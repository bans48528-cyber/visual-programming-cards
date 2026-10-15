(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Lbs2206Protocol=api;})(globalThis,()=>{
  'use strict';
  const movement=Object.freeze({'lbs-forward':0x10,'lbs-backward':0x20,'lbs-left':0x40,'lbs-right':0x50});
  const directions=Object.freeze({forward:0x10,backward:0x20,stop:0x30,left:0x40,right:0x50});
  const maintenance=Object.freeze({version:'sys.GetVer()',voltage:'sys.GetVoltage()',mac:'sys.GetBTMAC()',straight:'sys.GetSTPL()',turn:'sys.GetSTPR()'});
  function encode(bytes){if(!Array.isArray(bytes)&&!(bytes instanceof Uint8Array))throw new Error('无效帧');return Uint8Array.from(Array.from(bytes).flatMap(b=>{if(!Number.isInteger(b)||b<0||b>255)throw new Error('无效字节');return [255-b,b];}));}
  function decode(bytes){if(bytes.length%2)throw new Error('反码帧长度无效');const result=[];for(let i=0;i<bytes.length;i+=2){if(bytes[i]+bytes[i+1]!==255)throw new Error('反码校验失败');result.push(bytes[i+1]);}return result;}
  function remote(direction,speed){if(!Object.prototype.hasOwnProperty.call(directions,direction)||!Number.isInteger(speed)||speed<1||speed>5)throw new Error('方向或五档速度无效');return encode([directions[direction]|speed,10]);}
  const stopProgram=()=>encode([0x7b,10]),enterRemote=()=>encode([10,10]);
  // This budget is only an editor resource limit, never a verified device capacity.
  function plan(program){let nodes=0;const max=100000;
    function visit(items,depth=0){if(!Array.isArray(items)||depth>16)throw new Error('程序结构无效或嵌套过深');let count=0;
      for(const item of items){if(!item||++nodes>1000)throw new Error('程序过于复杂');let n;
        if(item.id==='loop-count'){const times=item.params?.count;if(!Number.isInteger(times)||times<1)throw new Error('循环次数须为正整数');const body=visit(item.children,depth+1);if(!body)throw new Error('循环内没有动作');n=times*body;}
        else {if(!Object.prototype.hasOwnProperty.call(movement,item.id))throw new Error('LBS2206 暂不支持此积木：'+item.id);n=item.params?.steps;if(!Number.isInteger(n)||n<1)throw new Error('运动步数须为正整数');}
        count+=n;if(!Number.isSafeInteger(count)||count>max)throw new Error('展开后的程序超过 APP 编辑预算，请减少步数或循环次数');
      }return count;
    }
    const actions=visit(program);if(!actions)throw new Error('请先放入运动积木');return {program:JSON.parse(JSON.stringify(program)),actions,wireBytes:2*(actions+2)};
  }
  function profileIssues(profile,program=false){const p=profile||{},issues=[];
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(!p.gattVerified||!['serviceUuid','writeUuid','notifyUuid'].every(k=>uuid.test(p[k]||'')))issues.push('GATT UUID 和读写属性未确认');
    if(!['response','no-response'].includes(p.writeMode))issues.push('BLE 写入方式未确认');
    if((!p.atomicFrameVerified&&(program||!p.remoteVerified))||!Number.isInteger(p.maxFrameBytes)||p.maxFrameBytes<4||p.maxFrameBytes>20||!Number.isInteger(p.frameGapMs)||p.frameGapMs<=60||p.frameGapMs>10000)issues.push('单次写入到串口的完整帧时序未验证');
    if(!p.evidence?.trim())issues.push('缺少实物验证记录');
    if(program&&(!p.programVerified||!Number.isInteger(p.safeActions)||p.safeActions<1))issues.push('安全程序动作数尚未验证');
    return issues;
  }
  function requireProfile(p,program=false){const issues=profileIssues(p,program);if(issues.length)throw new Error(issues.join('；'));}
  function programFrame(program,profile){const result=plan(program);requireProfile(profile,true);
    if(result.actions>profile.safeActions)throw new Error(`展开后 ${result.actions} 个动作，超过本机已验证的 ${profile.safeActions} 个动作`);
    if(result.wireBytes>profile.maxFrameBytes)throw new Error(`编码后 ${result.wireBytes} 字节，超过已验证的单帧 ${profile.maxFrameBytes} 字节；暂不分包`);
    const actions=[];function expand(items){for(const item of items){if(item.id==='loop-count'){for(let i=0;i<item.params.count;i++)expand(item.children);}else for(let i=0;i<item.params.steps;i++)actions.push(movement[item.id]);}}
    expand(result.program);return encode([0x7b,...actions,0x7d]);
  }
  class Receiver {
    constructor(onStatus,onText=()=>{}){this.bytes=[];this.text='';this.onStatus=onStatus;this.onText=onText;}
    feed(bytes){for(const b of bytes){this.bytes.push(b);if(b===10){if(/^(Ver=|Voltage=|MAC=|STPL=|STPR=)/.test(this.text))this.onText(this.text.trim());this.text='';}else if(b>=32&&b<=126)this.text=(this.text+String.fromCharCode(b)).slice(-100);else if(b!==13)this.text='';}
      while(this.bytes.length>=8){const data=this.bytes.slice(0,8);let values;try{values=decode(data);}catch{this.bytes.shift();continue;}
        const status={'0,0,1,1':'connected','0,0,0,7':'moving','0,0,0,8':'turning','0,0,0,6':'started','0,0,0,13':'stopped','0,0,2,0':'completed'}[values.join(',')];
        if(status){this.bytes.splice(0,8);this.onStatus(status);}else this.bytes.shift();
      }
    }
  }
  class Link {
    constructor(transport,profile,{onState=()=>{},onText=()=>{},startTimeoutMs=4000}={}){
      requireProfile(profile);this.transport=transport;this.profile={...profile};this.onState=onState;this.startTimeoutMs=startTimeoutMs;
      this.closed=false;this.phase='idle';this.mode=null;this.queue=Promise.resolve();this.lastEnd=0;this.epoch=0;this.pending=null;
      this.receiver=new Receiver(s=>this.receive(s),onText);
    }
    get busy(){return ['uploading','awaiting-start','running','stopping','unknown'].includes(this.phase);}
    state(phase,message){if(this.closed)return;this.phase=phase;this.onState({phase,message,busy:this.busy});}
    receive(status){if(this.closed)return;
      if(status==='started'&&['uploading','awaiting-start','unknown'].includes(this.phase)){clearTimeout(this.timer);this.state('running','设备已开始执行');}
      else if(status==='stopped'&&this.busy){clearTimeout(this.timer);this.state('stopped','设备已停止');this.pending?.resolve({state:'stopped'});this.pending=null;}
      else if(status==='completed'&&['running','stopping'].includes(this.phase)){clearTimeout(this.timer);this.state('completed','设备执行完成');this.pending?.resolve({state:'completed'});this.pending=null;}
    }
    write(bytes,guard=()=>true){if(bytes.length>this.profile.maxFrameBytes)return Promise.reject(new Error('超出已验证的单帧长度，未发送'));
      const task=this.queue.then(async()=>{if(this.closed||!guard())return false;
        const wait=this.profile.frameGapMs-(Date.now()-this.lastEnd);if(wait>0)await new Promise(r=>setTimeout(r,wait));
        if(this.closed||!guard())return false;try{await this.transport.write(bytes);return true;}finally{this.lastEnd=Date.now();}
      });this.queue=task.catch(()=>{});return task;
    }
    async remote(direction,speed,guard=()=>true){if(this.busy&&direction!=='stop')throw new Error('程序尚未确认停止，不能遥控');
      if(this.busy&&direction==='stop')return this.stopProgram();
      if(this.mode!=='remote'){if(this.profile.remoteModeCommand!==false&&!await this.write(enterRemote(),guard))return;this.mode='remote';}
      const repeats=direction==='stop'?Math.max(1,Math.min(3,this.profile.remoteStopRepeats||1)):1;
      for(let i=0;i<repeats;i++)if(!await this.write(remote(direction,speed),guard))return;
    }
    async upload(program,context={isCurrent:()=>true}){
      if(this.closed||this.busy)throw new Error('设备正在执行或状态未知，不能重复上传');
      const bytes=programFrame(program,this.profile),ticket=++this.epoch;
      const guard=()=>ticket===this.epoch&&!context.signal?.aborted&&context.isCurrent();
      let resolve,reject;const done=new Promise((a,b)=>{resolve=a;reject=b;});done.catch(()=>{});this.pending={resolve,reject};
      this.mode='program';this.state('uploading','正在上传完整程序');
      try {if(!await this.write(bytes,guard))throw new Error('上传已取消');
        if(ticket===this.epoch&&this.phase==='uploading')this.state('awaiting-start','已发送，等待设备开始回报');
        if(ticket===this.epoch&&this.phase==='awaiting-start')this.timer=setTimeout(()=>this.state('unknown','未收到开始回报，状态未知；请停止或断开连接'),this.startTimeoutMs);
      }catch(e){if(!this.closed){this.state('unknown','发送未确认，设备状态未知；请停止或断开连接');}reject(e);}
      return done;
    }
    async stopProgram(){if(this.closed||this.phase==='stopping')return;this.mode='program';this.epoch++;clearTimeout(this.timer);this.state('stopping','正在发送停止指令');
      try{await this.write(stopProgram());if(this.phase==='stopping'){this.state('stopping','停止指令已发送，等待设备确认');this.timer=setTimeout(()=>{if(this.phase==='stopping')this.state('unknown','未收到停止回报，状态未知；请断开连接');},this.startTimeoutMs);}}
      catch(e){if(!this.closed)this.state('unknown','停止发送失败，请断开连接并检查小车');throw e;}
    }
    async readSetting(name){if(this.busy)throw new Error('请先停止程序');if(!maintenance[name])throw new Error('维护命令未开放');return this.write(Uint8Array.from(maintenance[name],c=>c.charCodeAt(0)));}
    close(){if(this.closed)return;this.closed=true;this.epoch++;clearTimeout(this.timer);this.pending?.reject(new Error('连接已断开，设备运行状态未知'));this.pending=null;}
  }
  return {encode,decode,remote,enterRemote,stopProgram,plan,programFrame,profileIssues,requireProfile,Receiver,Link,maintenance};
});
