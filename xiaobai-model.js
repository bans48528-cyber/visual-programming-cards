// Xiaobai's catalog, parameters and hardware adapters live together.
(() => {
    const portParam = () => ({ label: "电机", type: "select", default: "L/M1", options: ["L/M1", "R/M2"] });
    const durationParam = label => ({ label, type: "number", default: 1, min: 0.1, max: 86400, step: 0.1, unit: "秒" });
    const powerParam = (kind = "motor") => ({
      label: "功率", type: "select", default: 3,
      options: [1, 2, 3].map(value => ({ value, label: `${value}档`, icon: `assets/blocks/xiaobai-20261112/${kind}-power-${value}.svg` }))
    });
    const expressions = ["待机", "开心", "生气", "伤心", "惊讶", "眨眼", "喜欢", "晕眩", "困倦", "好奇"];
    const speechLines = [
      "小白开始行动啦", "跟我一起出发吧", "前方道路畅通", "我发现前面有东西", "让我想一想",
      "小心一点哦", "太棒了，继续加油", "我找到目标啦", "挑战成功", "我的表演结束啦"
    ];
    const recognizedLines = ["开始", "下一步", "再来一次", "你好", "再见", "谢谢", "打开", "关闭", "前进", "后退"];
    const tiltDirection = () => ({ label: "倾倒方向", type: "select", default: "forward", options: [
      { value: "forward", label: "向前", bubble: "向前倾倒", icon: "assets/blocks/xiaobai-20261112/tilt-wait-forward.svg" },
      { value: "backward", label: "向后", bubble: "向后倾倒", icon: "assets/blocks/xiaobai-20261112/tilt-wait-backward.svg" },
      { value: "left", label: "向左", bubble: "向左倾倒", icon: "assets/blocks/xiaobai-20261112/tilt-wait-left.svg" },
      { value: "right", label: "向右", bubble: "向右倾倒", icon: "assets/blocks/xiaobai-20261112/tilt-wait-right.svg" }
    ] });
    const infraredCondition = () => ({
      comparison: { label: "条件", type: "select", default: "greater", options: [{ value: "greater", label: "大于" }, { value: "less", label: "小于" }] },
      threshold: { label: "数值", type: "number", default: 50, min: 0, max: 100, step: 1, integer: true }
    });
    const conditionalLoopHelp = "进入时先检查，已满足则跳过；轮中满足后会记住。完成当前整轮再退出；当前等待或无限内循环不结束则继续等待；停止立即生效。";
    const messageColors = [
      {value:1,label:"红色",color:"#e50012",openIcon:"assets/blocks/xiaobai-20261112/message-open-red.svg",closedIcon:"assets/blocks/xiaobai-20261112/message-closed-red.svg"},
      {value:2,label:"棕色",color:"#804f21",openIcon:"assets/blocks/xiaobai-20261112/message-open-brown.svg",closedIcon:"assets/blocks/xiaobai-20261112/message-closed-brown.svg"},
      {value:3,label:"黄色",color:"#f29600",openIcon:"assets/blocks/xiaobai-20261112/message-open-yellow.svg",closedIcon:"assets/blocks/xiaobai-20261112/message-closed-yellow.svg"},
      {value:4,label:"绿色",color:"#009844",openIcon:"assets/blocks/xiaobai-20261112/message-open-green.svg",closedIcon:"assets/blocks/xiaobai-20261112/message-closed-green.svg"},
      {value:5,label:"蓝色",color:"#009fe8",openIcon:"assets/blocks/xiaobai-20261112/message-open-blue.svg",closedIcon:"assets/blocks/xiaobai-20261112/message-closed-blue.svg"},
      {value:6,label:"粉色",color:"#e51373",openIcon:"assets/blocks/xiaobai-20261112/message-open-pink.svg",closedIcon:"assets/blocks/xiaobai-20261112/message-closed-pink.svg"}
    ];

    // Confirmed by the user on 2026-10-16: 8 x 8 per eye, with four corner LEDs absent.
    const emptyEyePattern = () => Array(64).fill(0);
    const eyeParam = label => ({label, type: "matrix", rows: 8, columns: 8, disabledIndexes: [0, 7, 56, 63], default: emptyEyePattern()});

    const categories = {
      motor: {
        color: "var(--motor)",
        cards: [
          { id: "motor-forward", label: "电机正转", type: "motor", paramsSchema: { port: portParam(), duration: durationParam("运行时间") } },
          { id: "motor-reverse", label: "电机反转", type: "motor", paramsSchema: { port: portParam(), duration: durationParam("运行时间") } },
          { id: "motor-forward-continuous", label: "持续正转", type: "motor", paramsSchema: { port: portParam() } },
          { id: "motor-reverse-continuous", label: "持续反转", type: "motor", paramsSchema: { port: portParam() } },
          { id: "motor-stop", label: "电机停止", type: "motor", paramsSchema: { port: portParam() } },
          { id: "motor-power", label: "电机功率", type: "motor", paramsSchema: { power: powerParam() } }
        ]
      },
      combo: {
        color: "var(--combo)",
        cards: [
          { id: "combo-forward", label: "前进", type: "combo", paramsSchema: { duration: durationParam("运行时间") } },
          { id: "combo-backward", label: "后退", type: "combo", paramsSchema: { duration: durationParam("运行时间") } },
          { id: "combo-turn-left", label: "左转", type: "combo", paramsSchema: { duration: durationParam("运行时间") } },
          { id: "combo-turn-right", label: "右转", type: "combo", paramsSchema: { duration: durationParam("运行时间") } },
          {
            id: "combo-continuous", label: "持续移动", type: "combo",
            paramsSchema: { direction: { label: "方向", type: "select", default: "advance", options: [
              { value: "advance", label: "前进" }, { value: "retreat", label: "后退" },
              { value: "left", label: "左转" }, { value: "right", label: "右转" }
            ] } }
          },
          { id: "combo-stop", label: "组合停止", type: "combo" },
          { id: "combo-power", label: "组合功率", type: "combo", paramsSchema: { power: powerParam("combo") } }
        ]
      },
      logic: {
        color: "var(--logic)",
        cards: [
          { id: "send-message", label: "发送消息", type: "logic", paramsSchema: { message: {
            label:"消息",type:"select",default:1,options:messageColors.map(option=>({
              value:option.value,label:`${option.label}消息 ${option.value}`,bubble:`${option.label}${option.value}`,color:option.color
            }))
          } } },
          { id: "send-message-wait", label: "发送消息并等待", type: "logic", paramsSchema: { message: {
            label:"消息",type:"select",default:1,options:messageColors.map(option=>({
              value:option.value,label:`${option.label}消息 ${option.value}`,bubble:`等待 · ${option.label}${option.value}`,color:option.color
            }))
          } } },
          { id: "wait-time", label: "等待时间", type: "logic", kind: "action", paramsSchema: { duration: durationParam("等待时间") } },
          {
            id: "infrared-wait", label: "等待红外", type: "logic",
            paramsSchema: infraredCondition()
          },
          { id: "tilt-wait", label: "等待倾倒", type: "logic", paramsSchema: { direction: tiltDirection() } },
          { id: "motion-wait", label: "等待运动状态", type: "logic", paramsSchema: {
            state: { label: "运动状态", type: "select", default: "still", options: [
              { value: "still", label: "平稳", icon: "assets/blocks/xiaobai-20261112/motion-wait-still.svg" }, { value: "shaking", label: "持续晃动", icon: "assets/blocks/xiaobai-20261112/motion-wait-shaking.svg" },
              { value: "up", label: "向上抬一下", icon: "assets/blocks/xiaobai-20261112/motion-wait-up.svg" }, { value: "down", label: "向下放一下", icon: "assets/blocks/xiaobai-20261112/motion-wait-down.svg" }
            ] }
          }, paramHelp: "平稳不限放置方向；持续晃动需持续摇动。上下按机身Z轴加速度触发：正面朝上时对应物理上下，侧放或倒置仍按机身Z轴判断。扣除重力参考后达到对应阈值即触发，无需先静止或停稳，制动也可能触发反向。持续超阈值只触发一次；新等待需解除后再次越阈值，或出现对应的新反向事件。" },
          { id: "loop-count", label: "循环次数", type: "logic", kind: "loop", paramsSchema: { count: { label: "次数", type: "number", default: 1, min: 1, max: 1000000, step: 1, integer: true } } },
          { id: "loop", label: "一直循环", type: "logic", kind: "loop" },
          { id: "loop-infrared", label: "重复直到红外条件满足", type: "logic", kind: "loop", conditionalLoop: true, paramsSchema: infraredCondition(),
            paramHelp: "重复直到红外值严格大于或小于阈值；等于阈值不满足。" + conditionalLoopHelp },
          { id: "loop-tilt", label: "重复直到倾倒", type: "logic", kind: "loop", conditionalLoop: true, paramsSchema: { direction: tiltDirection() },
            paramHelp: "重复直到主机向指定方向倾倒。" + conditionalLoopHelp },
          { id: "loop-time", label: "重复直到时间达到", type: "logic", kind: "loop", conditionalLoop: true, paramsSchema: {
            duration: { label: "累计时间", type: "number", default: 5, min: 0, max: 86400, step: 0.1, unit: "秒" }
          }, paramHelp: "从进入本循环开始计时，重复直到达到所选时间。" + conditionalLoopHelp },
        ]
      },
      dynamic: {
        color: "#9867E8",
        cards: [
          { id: "eye-expression", label: "显示表情", type: "dynamic", paramsSchema: { expression: { label: "表情", type: "select", default: "EYE_01", options: expressions.map((label, index) => ({ value: `EYE_${String(index + 1).padStart(2, "0")}`, label })) } } },
          { id: "eye-matrix", label: "点阵表情", type: "dynamic", paramsSchema: {
            leftPattern: eyeParam("左眼（L）"), rightPattern: eyeParam("右眼（R）")
          } },
          { id: "display-number", label: "显示数字", type: "dynamic", paramsSchema: { value: { label: "数字", type: "number", default: 0, min: 0, max: 100, step: 1, integer: true } } },
          { id: "display-off", label: "关闭显示", type: "dynamic" },
          { id: "speech-play", label: "语音播报", type: "dynamic", paramsSchema: { phrase: { label: "播报词条", type: "select", default: "P01", options: speechLines.map((label, index) => ({ value: `P${String(index + 1).padStart(2, "0")}`, label, bubble: `P${String(index + 1).padStart(2, "0")}` })) } } },
          { id: "speech-wait", label: "等待词条", type: "dynamic", paramsSchema: { phrase: { label: "识别词条", type: "select", default: "ASR_01", options: recognizedLines.map((label, index) => ({ value: `ASR_${String(index + 1).padStart(2, "0")}`, label })) } } },
          { id: "self-learned-wait", label: "自学习口令", type: "dynamic", paramsSchema: { slot: { label: "指令编号", type: "number", default: 1, min: 1, max: 10, step: 1, integer: true } } }
        ]
      }
    };

    // Keep old saved programs readable while removing these superseded cards from the palette.
    const legacyCards = [
      { id: "speed-up", label: "速度加一档", type: "combo" },
      { id: "speed-down", label: "速度减一档", type: "combo" }
    ];

  // Artwork belongs to the model, not to catalog cards shared by other models.
  const artwork = "xiaobai-20261112/";
  const artworkByCard = {};
  const conditionArtwork = { "tilt-wait": "tilt-wait-forward", "motion-wait": "motion-wait-still", "loop-infrared": "infrared-wait", "loop-tilt": "tilt-wait-forward", "loop-time": "wait-time", "self-learned-wait": "speech-wait" };
  Object.values(categories).forEach(group => group.cards.forEach(card => {
    const entry = { artStyle: "fitted" };
    if (["eye-expression", "display-number"].includes(card.id)) entry.paletteArtIcon = artwork + card.id;
    else if (!["eye-matrix", "send-message", "send-message-wait"].includes(card.id)) entry.artIcon = artwork + (conditionArtwork[card.id] || (card.kind === "loop" ? "loop" : card.id));
    if (card.id === "combo-continuous") {
      entry.artIcons = Object.fromEntries(
        ["advance", "retreat", "left", "right"].map(direction => [direction, artwork + "combo-continuous-" + direction]));
      entry.artIcon = entry.artIcons[card.paramsSchema.direction.default];
      entry.optionIcons = { direction: Object.fromEntries(Object.entries(entry.artIcons).map(([value, icon]) =>
        [value, `assets/blocks/${icon}.svg`])) };
    }
    if (["motor-forward", "motor-reverse", "motor-forward-continuous", "motor-reverse-continuous", "motor-stop"].includes(card.id)) {
      entry.artParam = "port";
      entry.artIcons = { "L/M1": artwork + card.id + "-left", "R/M2": artwork + card.id + "-right" };
      entry.artIcon = entry.artIcons[card.paramsSchema.port.default];
    }
    if (card.id === "tilt-wait" || card.id === "motion-wait" || card.id === "loop-tilt") {
      entry.artParam = card.id === "motion-wait" ? "state" : "direction";
      entry.artIcons = Object.fromEntries(card.paramsSchema[entry.artParam].options.map(option =>
        [option.value, artwork + `${card.id === "loop-tilt" ? "tilt-wait" : card.id}-${option.value}`]));
      entry.artIcon = entry.artIcons[card.paramsSchema[entry.artParam].default];
    }
    if (card.id === 'motor-power' || card.id === 'combo-power') {
      entry.artParam = 'power';
      entry.artIcons = Object.fromEntries([1,2,3].map(level => [level,
        artwork + `${card.id}-${level}`]));
      entry.artIcon = entry.artIcons[card.paramsSchema.power.default];
    }
    artworkByCard[card.id] = entry;
  }));

  const labels={motor:'电机',combo:'组合电机',logic:'逻辑',dynamic:'动态'};
  Object.entries(categories).forEach(([id,group])=>group.label=labels[id]);
  window.CardModels=DeviceModels.createRegistry();
  CardModels.register({
    id:'xiaobai',homeAnimation:true,name:'小白',image:'assets/devices/xiaobai-product.webp',description:'让小白动起来，用积木控制电机、眼睛和语音。',
    features:[
      {id:'files',label:'我的作品',icon:'assets/home-icon-file.png'},
      
      {id:'remote',label:'遥控',icon:'assets/devices/remote.svg'}
    ],
    catalog:categories,legacyCards,artworkByCard,startIcon:'assets/blocks/xiaobai-20261016/start.svg',artStyle:'fitted',
    messageColors,messageStartIcon:'assets/blocks/xiaobai-20261112/message-open-red.svg',
    messageSendIcon:'assets/blocks/xiaobai-20261112/message-closed-red.svg',
    examples:[
      {name:'电机往返',color:'#edf5ff',items:[{id:'motor-forward'},{id:'wait-time'},{id:'motor-reverse'}]},
      {name:'重复转向',color:'#fff5dc',items:[{id:'loop-count',params:{count:4},children:[{id:'combo-forward'},{id:'combo-turn-right'}]}]},
      {name:'持续移动与停止',color:'#f3edff',items:[{id:'combo-continuous'},{id:'wait-time',params:{duration:2}},{id:'combo-stop'}]}
    ],
    bluetooth:{
      create:options=>window.createXiaobaiBluetooth(options),
      protocol:()=>window.XiaobaiProtocol,
      timing:{firstScanMs:3000,defaultScanMs:10000},
      // Compatibility is confirmed by the existing service discovery and C2 probe.
      accepts:device=>Boolean(device.deviceId&&device.name)
    },
    execution:{kind:'stream',validate:program=>XiaobaiRunner.validate(program),
      createRunner:(connection,options)=>new XiaobaiRunner.Runner(connection,options)},
    remote:{layout:'physical-ten-key',open:()=>window.CardRemote?.open(),close:()=>window.CardRemote?.close(),reset:()=>window.CardRemote?.reset()}
  });
})();
