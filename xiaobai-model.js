// Xiaobai's catalog, parameters and hardware adapters live together.
(() => {
    const portParam = () => ({ label: "电机", type: "select", default: "L/M1", options: ["L/M1", "R/M2"] });
    const durationParam = label => ({ label, type: "number", default: 1, min: 0.1, max: 86400, step: 0.1, unit: "秒" });
    const powerParam = () => ({
      label: "功率", type: "select", default: 3,
      options: [1, 2, 3].map(value => ({ value, label: `${value}档` }))
    });
    const expressions = ["待机", "开心", "生气", "伤心", "惊讶", "眨眼", "喜欢", "晕眩", "困倦", "好奇"];
    const speechLines = [
      "小白开始行动啦", "跟我一起出发吧", "前方道路畅通", "我发现前面有东西", "让我想一想",
      "小心一点哦", "太棒了，继续加油", "我找到目标啦", "挑战成功", "我的表演结束啦"
    ];
    const recognizedLines = ["开始", "下一步", "再来一次", "你好", "再见", "谢谢", "打开", "关闭", "前进", "后退"];

    // Confirmed by the user on 2026-10-16: 8 x 8 per eye, with four corner LEDs absent.
    const eyePattern = () => ["00111100", "01111110", "11000011", "11000011", "11000011", "11000011", "01111110", "00111100"].join("").split("").map(Number);
    const eyeParam = label => ({label, type: "matrix", rows: 8, columns: 8, disabledIndexes: [0, 7, 56, 63], default: eyePattern()});

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
          { id: "combo-power", label: "组合功率", type: "combo", paramsSchema: { power: powerParam() } }
        ]
      },
      logic: {
        color: "var(--logic)",
        cards: [
          { id: "wait-time", label: "等待时间", type: "logic", kind: "action", paramsSchema: { duration: durationParam("等待时间") } },
          { id: "tilt-wait", label: "等待倾倒", type: "logic", paramsSchema: {
            direction: { label: "倾倒方向", type: "select", default: "forward", options: [
              {value: "forward", label: "向前", bubble: "先前倾倒"},
              {value: "backward", label: "向后", bubble: "向后倾倒"},
              {value: "left", label: "向左", bubble: "向左倾倒"},
              {value: "right", label: "向右", bubble: "向右倾倒"}
            ] }
          } },
          { id: "loop-count", label: "循环次数", type: "logic", kind: "loop", paramsSchema: { count: { label: "次数", type: "number", default: 1, min: 1, max: 1000000, step: 1, integer: true } } },
          { id: "loop", label: "一直循环", type: "logic", kind: "loop" },
          {
            id: "infrared-wait", label: "等待红外", type: "logic",
            paramsSchema: {
              comparison: { label: "条件", type: "select", default: "greater", options: [{ value: "greater", label: "大于" }, { value: "less", label: "小于" }] },
              threshold: { label: "数值", type: "number", default: 50, min: 0, max: 100, step: 1, integer: true }
            }
          }
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
          { id: "speech-wait", label: "等待词条", type: "dynamic", paramsSchema: { phrase: { label: "识别词条", type: "select", default: "ASR_01", options: recognizedLines.map((label, index) => ({ value: `ASR_${String(index + 1).padStart(2, "0")}`, label })) } } }
        ]
      }
    };

    // Keep old saved programs readable while removing these superseded cards from the palette.
    const legacyCards = [
      { id: "speed-up", label: "速度加一档", type: "combo" },
      { id: "speed-down", label: "速度减一档", type: "combo" }
    ];

  // Artwork belongs to the model, not to catalog cards shared by other models.
  const artwork = "xiaobai-20261016/";
  const artworkByCard = {};
  Object.values(categories).forEach(group => group.cards.forEach(card => {
    const entry = { artStyle: "fitted" };
    if (["eye-expression", "display-number"].includes(card.id)) entry.paletteArtIcon = artwork + card.id;
    else if (card.id !== "eye-matrix") entry.artIcon = artwork + (card.kind === "loop" ? "loop" : card.id);
    if (card.id === "combo-continuous") entry.artIcons = Object.fromEntries(
      ["advance", "retreat", "left", "right"].map(direction => [direction, artwork + "combo-continuous-" + direction]));
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
