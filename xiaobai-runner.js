(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./xiaobai-protocol.js'):root.XiaobaiProtocol,
    typeof module==='object'&&module.exports?require('./xiaobai-control-flow.js'):root.XiaobaiControlFlow,
    typeof module==='object'&&module.exports?require('./xiaobai-condition-protocol.js'):root.XiaobaiConditionProtocol);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.XiaobaiRunner=api;
})(globalThis,function(protocol,Flow,Conditions){
  'use strict';
  const {OP,TILT_DIRECTIONS:tilt,MOTION_TARGETS:motion,milliseconds,matrixChunks}=protocol;
  const motorIds=new Set(['motor-forward','motor-reverse','motor-forward-continuous','motor-reverse-continuous','motor-stop']);
  const comboIds=new Set(['combo-forward','combo-backward','combo-turn-left','combo-turn-right','combo-continuous','combo-stop']);
  const supported=new Set([...motorIds,...comboIds,'motor-power','combo-power','wait-time','loop','loop-count','infrared-wait',
    'tilt-wait','motion-wait','loop-infrared','loop-tilt','loop-time','eye-expression','eye-matrix','display-number','display-off','speech-play','speech-wait','self-learned-wait','speed-up','speed-down']);
  const move={advance:1,left:2,right:3,retreat:4};
  const FEATURE_MIN_FIRMWARE=0x020101;
  const FIRST_COMPACT_START_VERSION = 0x020202;
  const compactVersions = new Set([FIRST_COMPACT_START_VERSION, 0x020203]);
  function supportsCompactStart(version) { return compactVersions.has(version); }
  function compactProgramReady(state, target = state?.targetVersion) {
    const actual = state?.actual, info = actual?.info;
    return Boolean(supportsCompactStart(target) && state?.ready && state.targetVersion === target &&
      state.currentVersion === target && state.epoch && actual?.epoch === state.epoch &&
      info?.version === target && info.mode === 0 && info.imageValid === true);
  }
  const motorIndex=port=>['L/M1','L'].includes(port)?0:1;
  function validate(program){
    const copy=JSON.parse(JSON.stringify(program));let count=0;Flow.validateLoops(copy);
    function sequence(items,depth=0){
      if(!Array.isArray(items)||depth>20)throw new Error('程序结构无效或循环嵌套过深。');
      for(const item of items){
        if(!item||++count>1000)throw new Error('程序最多支持 1000 块积木。');
        const {id,params:p={}}=item;
        // Validate the whole program before entering program mode.
        if(id==='tilt-wait'){
          if(!Object.prototype.hasOwnProperty.call(tilt,p.direction))throw new Error('倾倒方向无效，请选择向前、向后、向左或向右。');
        }
        if(id==='motion-wait'&&!Object.prototype.hasOwnProperty.call(motion,p.state))throw new Error('运动状态无效，请选择平稳、持续晃动、向上抬一下或向下放一下。');
        if(id==='eye-matrix')matrixChunks(0,p.leftPattern,p.rightPattern);
        if(!supported.has(id))throw new Error('小白不支持此积木：'+id);
        if(motorIds.has(id)&&!['L/M1','R/M2','L','R'].includes(p.port))throw new Error('请选择左或右电机。');
        if(id==='combo-continuous'&&!Object.prototype.hasOwnProperty.call(move,p.direction))throw new Error('移动方向无效。');
        if(['motor-forward','motor-reverse','combo-forward','combo-backward','combo-turn-left','combo-turn-right','wait-time'].includes(id)){
          if(!Number.isFinite(p.duration)||p.duration<0.001||p.duration>86400)throw new Error('时间须在 0.001 至 86400 秒之间。');
        }
        if(['motor-power','combo-power'].includes(id)&&![1,2,3].includes(Number(p.power)))throw new Error('功率档位无效。');
        if(id==='infrared-wait'&&(!['greater','less'].includes(p.comparison)||!Number.isInteger(p.threshold)||p.threshold<0||p.threshold>100))throw new Error('红外等待条件无效。');
        if(id==='display-number'&&(!Number.isInteger(p.value)||p.value<0||p.value>100))throw new Error('显示数字须在 0 至 100 之间。');
        if(id==='eye-expression'&&!/^EYE_(0[1-9]|10)$/.test(p.expression))throw new Error('眼睛表情无效。');
        if(id==='self-learned-wait'&&(!Number.isInteger(p.slot)||p.slot<1||p.slot>10))throw new Error('请选择指令1至指令10。');
        if(id==='speech-play'&&!/^P(0[1-9]|10)$/.test(p.phrase))throw new Error('播报词条无效。');
        if(id==='speech-wait'&&!/^ASR_(0[1-9]|10)$/.test(p.phrase))throw new Error('识别词条无效。');
        if(Flow.isLoop(item)){
          if(id==='loop-count'&&(!Number.isInteger(p.count)||p.count<1||p.count>1000000))throw new Error('循环次数无效。');
          if(!Array.isArray(item.children)||!item.children.length)throw new Error('请在循环中放入积木。');
          sequence(item.children,depth+1);
        }
      }
    }
    sequence(copy);if(!copy.length)throw new Error('请先放入积木。');return copy;
  }
  class Cancelled extends Error{}
  function requireFeatureFirmware(items,connection){
    let found;
    function visit(sequence,path=[]){
      for(let index=0;index<sequence.length&&!found;index++){
        const item=sequence[index],current=[...path,index];
        if(item.id==='motion-wait'||Flow.isConditionalLoop(item))found={item,path:current};
        else if(item.children)visit(item.children,current);
      }
    }
    visit(items);if(!found)return;
    // The ordinary connection gate proves the exact application version.
    // Archived adapters retain their full-identity compatibility fallback below.
    const state=connection.firmware?.snapshot?.(),info=state?.actual?.info,pkg=connection.firmware?.bundle?.pkg;
    // Normal programming is pinned by the current connection's application
    // version. Full UID/image/Boot evidence belongs to explicit OTA only.
    if(compactProgramReady(state))return;
    if(state?.ready&&(!state.targetVersion||state.targetVersion===info?.version)&&info?.boardId===258&&info.protocol===1&&info.mode===0&&info.imageValid&&
      Number.isInteger(info.version)&&info.version>=FEATURE_MIN_FIRMWARE&&info.version===state.currentVersion&&
      (!state.epoch||state.actual.epoch===state.epoch)&&pkg?.signatureVerified&&pkg.boardId===info.boardId&&
      pkg.version===info.version&&pkg.format===2&&pkg.layoutId===2&&info.layoutId===2&&
      (info.schemaVersion??info.infoVersion)===2&&pkg.appBase===0x08003000&&info.activeAppBase===pkg.appBase&&
      pkg.erasePage===128&&info.erasePage===128&&Number.isInteger(pkg.imageSize)&&pkg.imageSize>=192&&pkg.imageSize<=52992&&
      info.imageSize===pkg.imageSize&&/^[0-9a-f]{64}$/.test(pkg.imageSha256)&&info.imageSha256===pkg.imageSha256)return;
    throw Object.assign(new Error('运动状态和条件循环需要小白主控固件 2.1.1 或更新版本，请先更新主控。'),
      {code:'CONTROL_FIRMWARE',path:found.path,blockUid:found.item.uid});
  }
  class Runner{
    constructor(connection,{isCurrent=()=>true,onStep=()=>{}}={}){
      this.connection=connection;this.isCurrent=isCurrent;this.onStep=onStep;
      this.cancelled=false;this.waiters=new Set();this.done=null;this.comboPower=3;this.matrixTransfer=0;this.error=null;this.observers=null;this.stopPromise=null;this.observerContexts=new Map();
    }
    check(){if(this.error)throw this.error;if(this.cancelled)throw new Cancelled();if(!this.isCurrent())throw new Error('连接已断开，程序已取消。');}
    delay(ms){this.check();return new Promise((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);this.waiters.delete(finish);try{this.check();resolve();}catch(error){reject(error);}};
      const timer=setTimeout(finish,ms);this.waiters.add(finish);
    });}
    cancel(){if(this.cancelled)return;this.cancelled=true;this.observers?.cancel('程序已停止。');this.connection.learned?.stop('程序已停止。');for(const wake of [...this.waiters])wake();this.connection.cancelPending?.();}
    requestStop(){if(!this.stopPromise)this.stopPromise=Promise.resolve().then(()=>this.isCurrent()?this.connection.stopProgram():undefined);this.stopPromise.catch(()=>{});return this.stopPromise;}
    observationFailed(error){if(this.cancelled)return;const original=this.observerContexts.get(error.observerId);if(original)Object.assign(error,original);this.error=error;this.cancel();this.requestStop();}
    async observe(item,path){
      try{
        const handle=await this.observers.arm(0,Conditions.condition(item));
        this.observerContexts.set(handle.id,{blockUid:item.uid,path:path.slice()});
        return {get matched(){return handle.matched;},check:()=>handle.check(),refresh:()=>handle.refresh(),close:async options=>{
          try{return await handle.close(options);}finally{this.observerContexts.delete(handle.id);}
        }};
      }catch(error){if(!error.blockUid)Object.assign(error,{blockUid:item.uid,path:path.slice()});throw error;}
    }
    async action(op,args=[],blocking=false,timeout=0){this.check();await this.connection.action(op,args,blocking,timeout);this.check();}
    async sequence(items,parentPath=[]){
      for(const [index,item] of items.entries()){
        this.check();const path=[...parentPath,index];this.onStep(item,path);const {id,params:p={}}=item;
        if(Flow.isLoop(item)){
          await Flow.runLoop(item,()=>this.sequence(item.children,path),{check:()=>this.check(),delay:ms=>this.delay(ms),
            observe:loop=>this.observe(loop,path)});
        }else if(id==='wait-time')await this.delay(p.duration*1000);
        else if(motorIds.has(id)){
          const motor=motorIndex(p.port);
          if(id==='motor-stop')await this.action(OP.MOTOR_STOP,[motor]);
          else{
            const direction=id.includes('reverse')?2:1;
            if(id.endsWith('continuous'))await this.action(OP.MOTOR_RUN,[motor,direction]);
            else await this.action(OP.MOTOR_TIME,[motor,direction,...milliseconds(p.duration)],true,p.duration*1000+5000);
          }
        }else if(id==='motor-power')await this.action(OP.MOTOR_POWER,[Number(p.power)]);
        else if(comboIds.has(id)){
          if(id==='combo-stop')await this.action(OP.MOVE_STOP);
          else{
            const direction=id==='combo-continuous'?move[p.direction]:
              {'combo-forward':1,'combo-turn-left':2,'combo-turn-right':3,'combo-backward':4}[id];
            if(id==='combo-continuous')await this.action(OP.MOVE_RUN,[direction]);
            else await this.action(OP.MOVE_TIME,[direction,...milliseconds(p.duration)],true,p.duration*1000+5000);
          }
        }else if(id==='combo-power'){this.comboPower=Number(p.power);await this.action(OP.MOVE_POWER,[this.comboPower]);}
        else if(id==='speed-up'||id==='speed-down'){
          this.comboPower=Math.max(1,Math.min(3,this.comboPower+(id==='speed-up'?1:-1)));
          await this.action(OP.MOVE_POWER,[this.comboPower]);
        }else if(id==='infrared-wait')await this.action(OP.WAIT_IR,[1,p.comparison==='greater'?0:1,p.threshold],true); // Compatibility selector 1 is the single PA1 IR on the new board.
        else if(id==='tilt-wait')await this.action(OP.WAIT_TILT,[tilt[p.direction]],true);
        else if(id==='motion-wait')await this.action(OP.WAIT_MOTION,[motion[p.state]],true);
        else if(id==='eye-expression')await this.action(OP.SHOW_EYE,[Number(p.expression.slice(-2))]);
        else if(id==='eye-matrix'){
          this.matrixTransfer=(this.matrixTransfer+1)&255;
          for(const args of matrixChunks(this.matrixTransfer,p.leftPattern,p.rightPattern))
            await this.action(OP.SHOW_MATRIX,args,true,1500);
        }
        else if(id==='display-number')await this.action(OP.SHOW_NUM,[p.value]);
        else if(id==='display-off')await this.action(OP.SHOW_OFF);
        else if(id==='speech-play')await this.action(OP.PLAY_VOICE,[Number(p.phrase.slice(-2))]);
        else if(id==='self-learned-wait'){this.check();await this.connection.learned.wait(p.slot);this.check();}
        else if(id==='speech-wait')await this.action(OP.WAIT_VOICE,[Number(p.phrase.slice(-2))],true);
      }
    }
    run(program){
      if(this.done)throw new Error('此执行会话不能重复使用。');
      const copy=validate(program);
      this.done=(async()=>{
        let failure=null;
        try{
          await this.connection.enterProgram();this.check();
          if(this.connection.ensureFirmware&&!await this.connection.ensureFirmware({interactive:false,reason:'run'}))throw new Error('主控固件尚未就绪，程序未运行。');
          this.check();
          requireFeatureFirmware(copy,this.connection);
          let runIdentity;
          if(this.connection.learned){
            await this.connection.learned.prepareRun(copy);this.check();
            runIdentity=await this.connection.learned.beginRun();this.check();
          }else{
            const containsLearned=items=>items.some(item=>item.id==='self-learned-wait'||containsLearned(item.children||[]));
            if(containsLearned(copy))throw new Error('设备暂不支持自学习口令。');
          }
          if(hasConditional(copy)){
            if(!runIdentity?.id||runIdentity.legacy||!this.connection.conditionObservers?.createClient)throw new Error('设备未确认条件循环的运行身份，程序未运行。');
            this.observers=this.connection.conditionObservers.createClient({sessionLo:runIdentity.id,sessionHi:0,isCurrent:()=>!this.cancelled&&this.isCurrent(),onFault:error=>this.observationFailed(error)});
          }
          await this.sequence(copy);this.check();
          if(this.connection.learned)await this.connection.learned.endRun();
        }
        catch(error){if(!(error instanceof Cancelled))failure=this.error||error;}
        finally{this.cancel();this.observers?.dispose();this.observerContexts.clear();try{await this.requestStop();}catch(error){failure=failure||error;}}
        if(failure)throw failure;
      })();return this.done;
    }
    async stop(){this.cancel();await this.requestStop();if(this.done)await this.done;}
  }
  function hasConditional(items){return items.some(item=>Flow.isConditionalLoop(item)||hasConditional(item.children||[]));}
  return {Runner,validate,FIRST_COMPACT_START_VERSION,supportsCompactStart,compactProgramReady,requireFeatureFirmware,FEATURE_MIN_FIRMWARE,hasConditional,controlFlow:Flow};
});
