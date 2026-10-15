(() => {
  const steps={label:'步数',type:'number',default:1,min:1,max:1000,step:1,integer:true,unit:'步'};
  CardModels.register({
    id:'lbs2206',singlePalette:true,name:'LBS2206 V1.02',image:'assets/devices/lbs2206.svg',description:'双电机编程小车。手机编排遥控指令，支持按时间运动、持续运动与五档功率。',
    features:[{id:'files',label:'我的作品',icon:'assets/home-icon-file.png'},
      {id:'remote',label:'遥控',icon:'assets/devices/remote.svg'},{id:'settings',label:'设备设置',icon:'assets/devices/settings.svg',open:()=>Lbs2206UI.settings()}],
    catalog:{combo:{label:'运动',color:'var(--combo)',cards:CardModels.get('xiaobai').catalog.combo.cards.map(card=>{
      const result=JSON.parse(JSON.stringify(card));if(result.id==='combo-power')result.paramsSchema.power={label:'功率',type:'select',default:3,options:[1,2,3,4,5].map(value=>({value,label:value+'档'}))};return result;
    })},logic:{label:'逻辑',color:'var(--logic)',cards:CardModels.get('xiaobai').catalog.logic.cards.filter(c=>['wait-time','loop-count'].includes(c.id)).map(c=>JSON.parse(JSON.stringify(c))) }},
    legacyCards:['forward','backward','left','right'].map(dir=>({id:'lbs-'+dir,label:'旧版步数（请替换）',type:'motor',icon:'assets/blocks/lbs-'+dir+'.svg',paramsSchema:{steps:{...steps}}})),
    examples:[{name:'按时间往返',color:'#edf5ff',items:[{id:'combo-forward'},{id:'combo-backward'}]},
      {name:'持续移动与停止',color:'#f3edff',items:[{id:'combo-power',params:{power:3}},{id:'combo-continuous'},{id:'wait-time',params:{duration:2}},{id:'combo-stop'}]}],
    bluetooth:{create:options=>createLbs2206Bluetooth(options)},
    execution:{kind:'stream',completionMessage:'程序指令发送完成，已发送停止；设备未回报执行状态。',validate:program=>Lbs2206Runner.validate(program),createRunner:(connection,options)=>new Lbs2206Runner.Runner(connection,options)},
    remote:{open:()=>Lbs2206UI.open(),close:()=>Lbs2206UI.close(),reset:()=>Lbs2206UI.close()},
    deactivate:()=>Lbs2206UI.dismissSettings()
  });
})();
