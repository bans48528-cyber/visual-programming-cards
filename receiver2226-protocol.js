(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Receiver2226Protocol=api;})(globalThis,()=>{
  function encode(power,combo,motor){
    if(!Number.isInteger(power)||power<1||power>5||!Number.isInteger(combo)||combo<0||combo>4||!Number.isInteger(motor)||motor<0||motor>2)throw new Error('2226 电机状态无效。');
    return Uint8Array.of(0xAA,0xBB,power,combo,motor);
  }
  const notice='2226 蓝牙名称、连接通道和写入方式待确认';
  function connectionOptions(){throw new Error(notice+'，暂不能连接设备。');}
  return {encode,MODE:{PROGRAM:'program',REMOTE:'remote'},connectionOptions,notice};
});
