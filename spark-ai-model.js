// Spark AI uses its original hardware parameters and on-device Python execution.
(() => {
    const categories = {
      motor: {
        color: "var(--motor)",
        cards: [
          {
            id: "motor-power", label: "电机功率", type: "motor", actionName: "电机功率",
            paramsSchema: {
              power: { label: "功率", type: "select", default: "50", options: [25, 50, 75, 100].map(value => ({ value: String(value), label: `${value}%`, display: `${value}%` })) }
            }
          },
          {
            id: "motor-forward",
            label: "电机正转",
            type: "motor",
            actionName: "电机正转",
            paramsSchema: {
              port: { label: "电机端口", type: "select", default: "E", options: ["E", "F", "G", "H"], legacyValues: { A: "E", B: "F", C: "G", D: "H" } },
              duration: { label: "运行时间", type: "number", default: 1, min: 0.1, step: 0.1, unit: "秒" }
            }
          },
          {
            id: "motor-reverse",
            label: "电机反转",
            type: "motor",
            actionName: "电机反转",
            paramsSchema: {
              port: { label: "电机端口", type: "select", default: "E", options: ["E", "F", "G", "H"], legacyValues: { A: "E", B: "F", C: "G", D: "H" } },
              duration: { label: "运行时间", type: "number", default: 1, min: 0.1, step: 0.1, unit: "秒" }
            }
          },
          {
            id: "motor-forward-continuous", label: "持续正转", type: "motor", actionName: "持续正转",
            paramsSchema: { port: { label: "电机端口", type: "select", default: "E", options: ["E", "F", "G", "H"] } }
          },
          {
            id: "motor-reverse-continuous", label: "持续反转", type: "motor", actionName: "持续反转",
            paramsSchema: { port: { label: "电机端口", type: "select", default: "E", options: ["E", "F", "G", "H"] } }
          },
          {
            id: "motor-stop",
            label: "电机停止",
            type: "motor",
            actionName: "电机停止",
            paramsSchema: {
              port: { label: "电机端口", type: "select", default: "E", options: ["E", "F", "G", "H"], legacyValues: { A: "E", B: "F", C: "G", D: "H" } }
            }
          }
        ]
      },
      combo: {
        color: "var(--combo)",
        cards: [
          {
            id: "combo-direction", label: "组合电机方向", type: "combo", actionName: "组合电机方向",
            paramsSchema: {
              mode: { label: "旋转方向（左E·右F）", type: "select", default: "3", options: [
                { value: "3", label: "全部正向" }, { value: "0", label: "左电机反向" },
                { value: "1", label: "右电机反向" }, { value: "2", label: "全部反向" }
              ] }
            }
          },
          {
            id: "combo-power", label: "组合电机功率", type: "combo", actionName: "组合电机功率",
            paramsSchema: {
              power: { label: "功率", type: "select", default: "50", options: [25, 50, 75, 100].map(value => ({ value: String(value), label: `${value}%`, display: `${value}%` })) }
            }
          },
          {
            id: "combo-forward",
            label: "组合前进",
            type: "combo",
            actionName: "组合前进",
            paramsSchema: {
              duration: { label: "运行时间", type: "number", default: 1, min: 0.1, step: 0.1, unit: "秒" }
            }
          },
          {
            id: "combo-backward",
            label: "组合后退",
            type: "combo",
            actionName: "组合后退",
            paramsSchema: {
              duration: { label: "运行时间", type: "number", default: 1, min: 0.1, step: 0.1, unit: "秒" }
            }
          },
          {
            id: "combo-turn-left",
            label: "组合左转",
            type: "combo",
            actionName: "组合左转",
            paramsSchema: {
              duration: { label: "运行时间", type: "number", default: 1, min: 0.1, step: 0.1, unit: "秒" }
            }
          },
          {
            id: "combo-turn-right",
            label: "组合右转",
            type: "combo",
            actionName: "组合右转",
            paramsSchema: {
              duration: { label: "运行时间", type: "number", default: 1, min: 0.1, step: 0.1, unit: "秒" }
            }
          },
          {
            id: "combo-continuous", label: "组合持续移动", type: "combo", actionName: "组合持续移动",
            paramsSchema: {
              direction: { label: "方向", type: "select", default: "advance", options: [
                {value: "advance", label: "前进"}, {value: "retreat", label: "后退"},
                {value: "left", label: "左转"}, {value: "right", label: "右转"}
              ] }
            }
          },
          { id: "combo-stop", label: "组合停止", type: "combo", actionName: "组合停止" }
        ]
      },
      sensor: {
        color: "var(--sensor)",
        cards: [
          {
            id: "ultrasonic-sensor",
            label: "超声波传感器",
            type: "sensor",
            actionName: "超声波传感器",
            icon: "ultrasonic",
            color: "var(--sensor)",
            paramsSchema: {
              port: { label: "传感器端口", type: "select", default: "A", options: ["A", "B", "C", "D"] },
              operator: {
                label: "比较符号",
                type: "select",
                default: "<",
                options: [
                  { label: "小于", value: "<", display: "<" },
                  { label: "大于", value: ">", display: ">" },
                  { label: "等于", value: "==", display: "=" }
                ]
              },
              distance: { label: "距离", type: "number", default: 10, min: 0, max: 100, step: 1, unit: "cm", integer: true }
            }
          },
          {
            id: "grayscale-sensor",
            label: "灰度传感器",
            type: "sensor",
            actionName: "灰度传感器",
            paramsSchema: {
              port: { label: "传感器端口", type: "select", default: "A", options: ["A", "B", "C", "D"] },
              operator: {
                label: "比较符号",
                type: "select",
                default: "<",
                options: [
                  { label: "小于", value: "<", display: "<" },
                  { label: "大于", value: ">", display: ">" },
                  { label: "等于", value: "==", display: "=" }
                ]
              },
              value: { label: "数值", type: "number", default: 500, min: 0, max: 1000, step: 1, integer: true }
            }
          },
          {
            id: "button-sensor",
            label: "按键传感器",
            type: "sensor",
            actionName: "按键传感器",
            paramsSchema: {
              port: { label: "传感器端口", type: "select", default: "A", options: ["A", "B", "C", "D"] },
              state: { label: "按键状态", type: "select", default: "按下", options: ["按下", "松开"] }
            }
          },
          {
            id: "host-button",
            label: "主机按键",
            type: "sensor",
            actionName: "主机按键",
            paramsSchema: {
              button: { label: "按键", type: "select", default: "左键", options: ["左键", "右键"] }
            }
          }
        ]
      },
      logic: {
        color: "var(--logic)",
        cards: [
          {
            id: "wait-time",
            label: "等待时间",
            type: "logic",
            actionName: "等待时间",
            icon: "hourglass",
            color: "var(--logic)",
            paramsSchema: {
              duration: { label: "等待时间", type: "number", default: 1, min: 0.1, step: 0.1, unit: "秒" }
            }
          },
          {
            id: "loop-count",
            label: "循环次数",
            type: "logic",
            actionName: "循环次数",
            kind: "loop",
            color: "var(--loop)",
            paramsSchema: {
              count: { label: "次数", type: "number", default: 1, min: 1, step: 1, integer: true }
            }
          },
          { id: "loop", label: "循环", type: "logic", actionName: "循环", kind: "loop", color: "var(--loop)" }
        ]
      },
      light: {
        color: "var(--light)",
        cards: [
          {
            id: "play-note",
            color: "var(--sound)",
            label: "演奏音",
            type: "light",
            actionName: "演奏音",
            paramsSchema: {
              note: { label: "音符", type: "select", default: "1", options: ["1", "2", "3", "4", "5", "6", "7"] },
              beats: { label: "拍数", type: "select", default: "0.25", options: ["0.25", "0.5", "1", "2"].map(value => ({value, label: `${value}拍`})) }
            }
          },
          {
            id: "matrix-display",
            label: "点阵",
            type: "light",
            actionName: "点阵",
            icon: "matrix",
            color: "var(--matrix)",
            paramsSchema: {
              pattern: {
                label: "点阵图案",
                type: "matrix",
                size: 5,
                default: [
                  0, 0, 0, 0, 0,
                  0, 0, 0, 0, 0,
                  0, 0, 1, 0, 0,
                  0, 0, 0, 0, 0,
                  0, 0, 0, 0, 0
                ]
              }
            }
          }
        ]
      }
    };


  const labels={motor:'电机',combo:'组合电机',sensor:'传感器',logic:'逻辑',light:'声光'};
  Object.entries(categories).forEach(([id,group])=>{
    group.label=labels[id];
    group.cards.forEach(card=>Object.entries(card.paramsSchema||{}).forEach(([key,param])=>{
      if(key==='duration')param.max=86400;
      if(key==='count')param.max=1000000;
    }));
  });
  CardModels.register({
    id:'spark-ai',name:'Spark AI',image:'assets/devices/spark-ai.svg',description:'电机、传感器与点阵编程，上传完整程序后由主机执行。',
    features:[{id:'files',label:'我的作品',icon:'assets/home-icon-file.png'},{id:'remote',label:'遥控',icon:'assets/devices/remote.svg'}],
    catalog:categories,
    examples:[{name:'等待与音符',color:'#f3edff',items:[{id:'wait-time'},{id:'play-note'}]},
      {name:'电机往返',color:'#edf5ff',items:[{id:'motor-forward'},{id:'wait-time'},{id:'motor-reverse'}]}],
    bluetooth:{create:options=>window.createXiaobaiBluetooth(options),protocol:()=>window.SparkAIAdapter,
      nativeProfile:'spark-ai',timing:{firstScanMs:3000,defaultScanMs:10000},accepts:d=>Boolean(d.deviceId&&d.name==='Spark_AI')},
    execution:{kind:'compiled',reportsLifecycle:true,startsOnUpload:true,
      completionMessage:'程序已上传并请求运行；执行状态以主机回报为准。',
      validate(program){const snapshot=JSON.parse(JSON.stringify(program));CardProgramCodegen(snapshot);return snapshot;},
      async compile(program,context){
        if(!window.CardCompiler)throw new Error('请在 Android APP 中使用本地编译功能。');
        const cancel=()=>window.CardCompiler.cancel().catch(()=>{});
        context.signal.addEventListener('abort',cancel,{once:true});
        try {if(!context.isCurrent())throw new Error('编译已取消。');return await CardCompiler.compile(program);}
        finally{context.signal.removeEventListener('abort',cancel);}
      },
      sendProgram:(result,context)=>context.connection.uploadProgram(result.bytecode,context),
      stop:context=>context.connection.stopProgram()},
    remote:{layout:'physical-ten-key',open:()=>window.CardRemote?.open(),close:()=>window.CardRemote?.close(),reset:()=>window.CardRemote?.reset(),
      encode:pressed=>SparkAIAdapter.remoteFrame(pressed),pairs:[['A','B'],['X','Y'],['L','R']],shoulderPulse:false,
      labels:{Y:'Y',A:'A',X:'X',B:'B',L:'L',R:'R'},hint:'十键遥控 · 功能由主机程序决定',footer:'按键 Y / A / X / B / L / R'}
  });
})();
