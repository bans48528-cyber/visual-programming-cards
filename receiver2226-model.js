(() => {
  const original=CardModels.get('xiaobai'),copy=x=>JSON.parse(JSON.stringify(x));
  const motor=original.catalog.motor.cards.filter(c=>c.id!=='motor-power').map(c=>{
    const card=copy(c);card.label='M3 '+card.label;
    card.paramsSchema.port={label:'电机',type:'select',default:'M3',options:['M3']};return card;
  });
  const combo=original.catalog.combo.cards.map(copy);
  const power=combo.find(c=>c.id==='combo-power');power.label='三路共用档位';
  power.paramsSchema.power={label:'三路共用档位',type:'select',default:3,options:[1,2,3,4,5].map(value=>({value,label:value+'档'}))};
  CardModels.register({id:'receiver2226',name:'小方块 2226',singlePalette:true,image:'assets/devices/receiver2226.svg',
    description:'1、2 路组合运动，第三路独立控制，三路共用五档速度。蓝牙连接待配置。',
    features:[{id:'files',label:'我的作品',icon:'assets/home-icon-file.png'},],
    catalog:{combo:{label:'组合电机',color:'var(--combo)',cards:combo},motor:{label:'第三路电机',color:'var(--motor)',cards:motor},logic:{label:'逻辑',color:'var(--logic)',cards:original.catalog.logic.cards.filter(c=>['wait-time','loop-count','loop'].includes(c.id)).map(copy)}},
    examples:[{name:'组合运动与第三路',color:'#edf5ff',items:[{id:'combo-power',params:{power:3}},{id:'motor-forward-continuous',params:{port:'M3'}},{id:'combo-forward',params:{duration:1}},{id:'motor-stop',params:{port:'M3'}}]}],
    bluetooth:{create:options=>createXiaobaiBluetooth(options),protocol:()=>Receiver2226Protocol,nativeProfile:'receiver2226',timing:{firstScanMs:3000,defaultScanMs:10000},accepts:()=>false,
      connectionOptions:()=>Receiver2226Protocol.connectionOptions(),configurationNotice:()=>Receiver2226Protocol.notice,connectionHint:Receiver2226Protocol.notice},
    execution:{kind:'stream',completionMessage:'程序指令发送完成，已发送三路停止。',validate:p=>Receiver2226Runner.validate(p),createRunner:(c,o)=>new Receiver2226Runner.Runner(c,o)}
  });
})();
