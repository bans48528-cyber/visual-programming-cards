(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TC01Protocol=api;})(globalThis,()=>{
  const MODE={PROGRAM:'program',REMOTE:'remote'};
  const endings=['','\r','\n','\r\n'];
  function state(left,right){if(![-1,0,1].includes(left)||![-1,0,1].includes(right))throw new Error('TC-01 电机方向无效。');return [left===1?1:0,left===-1?1:0,right===1?1:0,right===-1?1:0];}
  function encode(left,right,lineEnding){
    if(!endings.includes(lineEnding))throw new Error('TC-01 字符串结束符尚未确认。');
    const value='KEY_DATA='+state(left,right).join('')+lineEnding;
    return Uint8Array.from(value,c=>c.charCodeAt(0));
  }
  function issues(p){const missing=[];const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
    if(p.transport!=='ble')missing.push('蓝牙类型（BLE 或经典蓝牙）');
    if(!uuid(p.serviceUuid)||!uuid(p.writeUuid))missing.push('BLE 服务与写入特征 UUID');
    if(p.notifyUuid&&!uuid(p.notifyUuid))missing.push('通知特征 UUID');
    if(!['response','no-response'].includes(p.writeMode))missing.push('蓝牙写入方式');
    if(!endings.includes(p.lineEnding))missing.push('字符串结束符');return missing;
  }
  function connectionOptions(p){const missing=issues(p);if(missing.length)throw new Error('TC-01 待确认：'+missing.join('、')+'。');return {serviceUuid:p.serviceUuid,writeUuid:p.writeUuid,notifyUuid:p.notifyUuid||'',writeMode:p.writeMode,lineEnding:p.lineEnding};}
  class Link{
    constructor(transport,{profile,onError=()=>{}}={}){this.transport=transport;this.profile=profile;this.onError=onError;this.closed=false;this.queue=Promise.resolve();this.revision=0;this.stopNeedsConfirmation=false;}
    async start(){connectionOptions(this.profile);await this.transport.start(()=>{});if(this.closed)throw new Error('连接已取消。');await this.setMotors(0,0);}
    async probe(){} // This protocol has no query/ACK command.
    async enterProgram(){} async enterRemote(){} stopHeartbeat(){}
    setMotors(left,right,guard=()=>true){
      const bytes=encode(left,right,this.profile.lineEnding),ticket=++this.revision;
      const operation=this.queue.then(async()=>{
        if(this.closed||ticket!==this.revision||!guard())return false;
        let timer;try{
          await Promise.race([this.transport.write(bytes),new Promise((_,reject)=>{timer=setTimeout(()=>{this.close();this.transport.disconnect().catch(()=>{});reject(new Error('TC-01 写入超时，连接已关闭，请检查设备。'));},5000);})]);
          return true;
        }finally{clearTimeout(timer);}
      });this.queue=operation.catch(()=>{});return operation;
    }
    stopProgram(){return this.setMotors(0,0);}
    rejectPending(){this.revision++;}
    close(){this.closed=true;this.revision++;this.transport.close();}
  }
  return {MODE,state,encode,issues,connectionOptions,Link};
});
