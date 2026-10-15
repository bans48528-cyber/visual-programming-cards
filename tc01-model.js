(() => {
  const original=CardModels.get('xiaobai'),copy=x=>JSON.parse(JSON.stringify(x));
  CardModels.register({id:'tc01',singlePalette:true,name:'幼儿小方块 TC-01',image:'assets/devices/tc01.svg',description:'独立控制左右电机，用等待和循环组合动作。蓝牙名称 Drluc。',
    features:[{id:'files',label:'我的作品',icon:'assets/home-icon-file.png'},{id:'remote',label:'遥控',icon:'assets/devices/remote.svg'}],
    catalog:{motor:{label:'电机',color:'var(--motor)',cards:[...original.catalog.motor.cards.filter(c=>c.id!=='motor-power').map(copy),{id:'combo-stop',label:'全部停止',artIcon:'tc01-stop',type:'motor',color:'var(--motor)'}]},
      combo:{label:'组合电机',color:'var(--combo)',cards:original.catalog.combo.cards.filter(c=>!['combo-power','combo-stop'].includes(c.id)).map(copy)},
      logic:{label:'逻辑',color:'var(--logic)',cards:original.catalog.logic.cards.filter(c=>['wait-time','loop-count','loop'].includes(c.id)).map(copy)}},
    examples:[{name:'左电机往返',color:'#edf5ff',items:[{id:'motor-forward'},{id:'wait-time'},{id:'motor-reverse'}]},
      {name:'双电机与停止',color:'#f3edff',items:[{id:'motor-forward-continuous',params:{port:'L/M1'}},{id:'motor-forward-continuous',params:{port:'R/M2'}},{id:'wait-time'},{id:'combo-stop'}]}],
    bluetooth:{create:options=>createXiaobaiBluetooth(options),protocol:()=>TC01Protocol,profile:()=>TC01Profile,nativeProfile:'tc01',
      connectionOptions:()=>TC01Protocol.connectionOptions(TC01Profile),timing:{firstScanMs:3000,defaultScanMs:10000},accepts:d=>Boolean(d.deviceId&&d.name==='Drluc'),
      connectionHint:'打开 TC-01 电源，扫描名称为 Drluc 的设备。',configurationNotice:()=>{const missing=TC01Protocol.issues(TC01Profile);return missing.length?'连接参数待确认：'+missing.join('、'):'';}},
    execution:{kind:'stream',completionMessage:'程序指令发送完成，已发送全部停止；设备没有执行状态回报。',validate:p=>TC01Runner.validate(p),createRunner:(c,o)=>new TC01Runner.Runner(c,o)},
    remote:{open:()=>TC01UI.open(),close:()=>TC01UI.close(),reset:()=>TC01UI.close()}
  });
})();
