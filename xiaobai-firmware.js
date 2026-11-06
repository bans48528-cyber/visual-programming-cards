(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./xiaobai-ota-protocol.js'):root.XiaobaiOtaProtocol,
    typeof module==='object'&&module.exports?require('./xiaobai-ota.js'):root.XiaobaiOta);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.XiaobaiFirmware=api;
})(globalThis,function(P,Ota){
  'use strict';
  const fail=(code,message)=>Object.assign(new Error(message),{code});
  const TARGET_EVENT=0x0a;
  function parseVersionEvent(event){
    if(event?.code!==TARGET_EVENT||!event.data||event.data.length!==8)return null;
    const b=Array.from(event.data);
    if(b.some(n=>!Number.isInteger(n)||n<0||n>255)||b[7]>1)return null;
    const version=(b[0]|b[1]<<8|b[2]<<16|b[3]<<24)>>>0;
    if(!version)return null;
    return Object.freeze({version,boardId:b[4]|b[5]<<8,protocol:b[6],imageValid:Boolean(b[7]&1)});
  }
  function targetOf(pkg){return Ota.targetOf(pkg);}
  const sameTarget=(a,b)=>Boolean(a&&b&&a.boardId===b.boardId&&a.version===b.version&&a.imageSize===b.imageSize&&a.imageSha256===b.imageSha256);
  class Gate{
    constructor(adapter,{loadBundle=()=>globalThis.XiaobaiFirmwareBundle.load(),storage=null,onChange=()=>{},sessionFactory=(a,o)=>new Ota.Session(a,o),timing={}}={}){
      this.adapter=adapter;this.loadBundle=loadBundle;this.storage=storage;this.onChange=onChange;
      this.epoch=null;this.generation=0;this.entry=0;this.programRequested=false;this.disposed=false;
      this.bundle=null;this.bundlePromise=null;this.checkPromise=null;this.checkedEpoch=null;this.upgradePromise=null;
      this.prompted=new Set();this.hints=new Set();this.hint=null;this.upgradeOwned=false;this.cancelled=false;this.activePromptKey=null;
      this.state={phase:'unknown',ready:false,busy:false,prompt:false,canUpgrade:false,message:'连接小白并进入编程后核对主控固件。',code:'DISCONNECTED',actual:null,currentVersion:null,targetVersion:null};
      const guarded=new Proxy(adapter,{get:(target,key)=>{
        const value=target[key];if(typeof value!=='function')return value;
        if(!['prepare','readApp','queryStatus','enterBoot','connectApp','connectBoot','raw'].includes(key))return value.bind(target);
        return async(...args)=>{
          this.guardConsent(key,args);
          if(key==='enterBoot')this.consent.stage='boot';
          if(key==='connectApp'||key==='connectBoot')this.consent.stage='reconnect';
          const result=await value.apply(target,args);this.guardConsent(key,args,result);
          return result;
        };
      }});
      this.session=sessionFactory(guarded,{storage,timing,onChange:s=>this.sessionChanged(s)});
    }
    snapshot(){const s=this.session.snapshot();return{...this.state,epoch:this.epoch,progress:{phase:s.phase,committed:s.committed,total:s.total,written:s.written},session:s};}
    subscribe(fn){(this.listeners??=new Set()).add(fn);return()=>this.listeners.delete(fn);}
    emit(){const value=this.snapshot();this.onChange(value);for(const fn of this.listeners||[])fn(value);}
    set(patch){Object.assign(this.state,patch);this.emit();}
    live(){return this.adapter.identity?.()||null;}
    guardConsent(method,args,result){
      const c=this.consent;if(!c||this.disposed||this.cancelled||c.token!==this.generation||c.entry!==this.entry)throw fail('CANCELLED','升级确认已失效，请重新确认。');
      const live=this.live();
      if(method==='connectApp'||method==='connectBoot'||method==='enterBoot'){
        const binding=args[0];if(binding?.deviceId!==c.deviceId||binding?.uid!==c.uid)throw fail('IDENTITY','恢复连接不是用户确认的主机，已停止升级。');
      }else if(['prepare','readApp','queryStatus','enterBoot','raw'].includes(method)&&live){
        if(live.deviceId!==c.deviceId||c.stage==='before-enter'&&c.epoch&&live.epoch!==c.epoch)throw fail('IDENTITY','设备连接已变化，原升级确认已失效。');
      }else if(!live&&c.stage==='before-enter'&&c.epoch)throw fail('DISCONNECTED','升级前设备已断开，请重新连接并确认。');
      if(result&&method==='readApp'&&(result.uid!==c.uid||result.deviceId!==c.deviceId))throw fail('IDENTITY','主机身份与用户确认不一致，已停止升级。');
    }
    current(token,epoch=this.epoch){if(this.disposed||token!==this.generation||!epoch||this.live()?.epoch!==epoch)throw fail('STALE','当前设备连接已变化，请重新核对。');}
    bindingPending(){return Boolean(this.session.binding?.pending);}
    hasRecovery(){return !this.disposed&&this.bindingPending();}
    async bundleReady(){
      if(this.bundle)return this.bundle;
      if(!this.bundlePromise)this.bundlePromise=Promise.resolve().then(()=>this.loadBundle()).then(value=>{
        if(!value?.pkg?.signatureVerified)throw fail('BUNDLE','内置固件未通过签名校验，请更新 App。');
        this.bundle=value;this.state.targetVersion=value.pkg.version;return value;
      }).finally(()=>{this.bundlePromise=null;});
      return this.bundlePromise;
    }
    attachEpoch(epoch,{owned=false}={}){
      if(this.disposed||!epoch)return;
      if(epoch===this.epoch)return;
      this.epoch=epoch;this.checkedEpoch=null;this.hint=null;this.hints.clear();
      if(owned&&this.upgradeOwned){this.state.ready=false;return;}
      this.generation++;this.entry++;this.checkPromise=null;this.programRequested=false;
      this.set({phase:'unknown',ready:false,busy:false,prompt:false,canUpgrade:false,actual:null,currentVersion:null,code:'UNCHECKED',message:'进入编程后核对主控固件。'});
    }
    onVersionEvent(event,epoch){
      if(this.disposed||epoch!==this.epoch)return false;
      const hint=parseVersionEvent(event);if(!hint)return false;
      const key=[hint.version,hint.boardId,hint.protocol,+hint.imageValid].join(':');
      if(this.hints.has(key))return true;this.hints.add(key);this.hint=hint;
      // A fresh event is a hint only. UID, hash and readiness still require fresh INFO.
      if(!this.state.actual)this.state.currentVersion=hint.version;
      if(!this.upgradeOwned&&this.programRequested&&this.checkedEpoch===epoch&&this.state.actual&&
         (hint.version!==this.state.actual.info.version||hint.boardId!==this.state.actual.info.boardId||hint.protocol!==this.state.actual.info.protocol||hint.imageValid!==this.state.actual.info.imageValid)){
        this.checkedEpoch=null;this.check({force:true}).catch(()=>{});
      }
      return true;
    }
    async onProgramRequested({interactive=false}={}){
      if(this.disposed||this.upgradeOwned)return false;
      const newlyRequested=!this.programRequested;if(newlyRequested)this.entry++;this.programRequested=true;
      if(interactive)this.cancelled=false;
      if(this.live()?.epoch)return this.onProgramEntered(this.live().epoch);
      if(!this.bindingPending())return false;
      const entry=this.entry;
      try{await this.bundleReady();if(this.disposed||!this.programRequested||entry!==this.entry)return false;
        const binding=this.session.binding,key=`${binding.uid}:${this.bundle.pkg.imageSha256}`;
        // Recovery after transport loss needs attention even if the version prompt was
        // already seen. Explicit cancellation alone suppresses duplicate route callbacks.
        const prompt=interactive||(this.state.phase==='recovery'&&this.state.prompt)||(!this.cancelled&&(newlyRequested||this.activePromptKey===key||!this.prompted.has(key)));
        this.prompted.add(key);if(prompt)this.activePromptKey=key;
        this.set({phase:'recovery',ready:false,busy:false,prompt,canUpgrade:true,code:'RECOVERY',message:'上次主控升级尚未确认。可重新连接原主机，使用 App 内置固件继续恢复。'});
      }catch(e){if(!this.disposed)this.set({phase:'unknown',ready:false,busy:false,prompt:true,canUpgrade:false,code:e.code||'BUNDLE',message:e.message});}
      return false;
    }
    onProgramEntered(epoch){
      if(this.disposed)return Promise.resolve(false);
      if(epoch!==this.epoch)this.attachEpoch(epoch);
      this.programRequested=true;
      return this.check();
    }
    async ensureReady({interactive=true,reason='run'}={}){
      if(this.disposed||this.upgradeOwned)return false;
      if(!this.live()?.epoch){await this.onProgramRequested({interactive});if(interactive)this.set({prompt:true});return false;}
      if(this.state.ready&&this.checkedEpoch===this.epoch)return true;
      if(this.state.phase==='unknown'&&this.checkedEpoch===this.epoch&&!this.checkPromise)return this.retry({interactive});
      const ready=await this.check({interactive});
      if(!ready&&interactive&&!this.disposed)this.set({prompt:true});
      return ready;
    }
    check({interactive=false,force=false,duringUpgrade=false}={}){
      if(this.disposed||this.upgradeOwned&&!duringUpgrade)return Promise.resolve(false);
      const identity=this.live();if(!identity?.epoch)return Promise.resolve(false);
      if(identity.epoch!==this.epoch)this.attachEpoch(identity.epoch,{owned:duringUpgrade});
      if(this.checkPromise)return this.checkPromise;
      if(!force&&this.checkedEpoch===this.epoch){if(interactive&&!this.state.ready)this.set({prompt:true});return Promise.resolve(this.state.ready);}
      const epoch=this.epoch,token=this.generation;
      this.set({phase:'checking',ready:false,busy:true,prompt:false,canUpgrade:false,code:'CHECKING',message:'正在核对主控固件…'});
      const pending=(async()=>{
        try{
          const {pkg}=await this.bundleReady();this.current(token,epoch);
          const actual=await this.adapter.readApp({guard:()=>!this.disposed&&token===this.generation&&this.live()?.epoch===epoch});this.current(token,epoch);
          if(duringUpgrade&&(actual.uid!==this.consent?.uid||actual.deviceId!==this.consent?.deviceId))throw fail('IDENTITY','恢复编程时主机身份与升级前不一致。');
          if(actual.epoch!==epoch||!actual.deviceId||!/^[0-9a-f]{24}$/.test(actual.uid||''))throw fail('IDENTITY','主机身份反馈不完整，请重新连接。');
          if(actual.info.mode!==0||actual.info.protocol!==P.C.OTA_PROTOCOL_VERSION||actual.info.boardId!==pkg.boardId)throw fail('UNSUPPORTED','当前硬件或升级协议不受此 App 支持。');
          if(actual.productMode!==undefined&&actual.productMode!==4)throw fail('MODE','主机尚未确认编程模式，请重新进入编程后重试。');
          const info=actual.info,key=`${actual.uid}:${pkg.imageSha256}`,binding=this.session.binding;
          const common={actual,currentVersion:info.version,targetVersion:pkg.version,ready:false,busy:duringUpgrade,prompt:false};
          const show=()=>{const prompt=interactive||this.activePromptKey===key||!this.prompted.has(key);this.prompted.add(key);if(prompt)this.activePromptKey=key;return prompt;};
          this.checkedEpoch=epoch;
          if(info.version>pkg.version){this.set({...common,phase:'newer',canUpgrade:false,prompt:show(),code:'NEWER',message:'主控固件比此 App 更新，请更新 App 后再学习或运行。'});return false;}
          if(info.version===pkg.version&&info.imageValid&&!sameTarget(info,pkg)){
            this.set({...common,phase:'unknown',canUpgrade:false,prompt:show(),code:'VERSION_COLLISION',message:'主控同版本的镜像内容与 App 不一致，已停止升级。请更新 App 或联系支持。'});return false;
          }
          if(info.version===pkg.version&&info.imageValid&&sameTarget(info,pkg)){
            if(binding?.pending&&binding.deviceId===actual.deviceId&&binding.uid===actual.uid&&!duringUpgrade){
              this.set({...common,phase:'recovery',canUpgrade:true,prompt:show(),code:'RECOVERY',message:'主控镜像已匹配，还需重新确认启动状态。点确定后自动检查，不重复刷写。'});return false;
            }
            this.set({...common,phase:'ready',ready:true,canUpgrade:false,code:'READY',message:'主控固件已匹配，可以学习和运行。'});return true;
          }
          this.set({...common,phase:'update-required',canUpgrade:true,prompt:show(),code:info.version===pkg.version?'REPAIR_REQUIRED':'UPDATE_REQUIRED',message:info.version===pkg.version?'主控镜像状态无效，需要修复后才能学习和运行。点确定即可自动修复。':'主控固件需要更新。点确定后自动升级，完成后可继续编程。'});return false;
        }catch(e){
          if(!this.disposed&&token===this.generation&&this.live()?.epoch===epoch){this.checkedEpoch=epoch;this.set({phase:'unknown',ready:false,busy:duringUpgrade,prompt:interactive||this.programRequested,canUpgrade:false,code:e.result===2?'UNSUPPORTED':e.code||'QUERY',message:e.result===2?'此固件没有蓝牙升级能力，需先安装新版 Boot 与主控固件。':e.message});}
          return false;
        }finally{if(this.checkPromise===pending)this.checkPromise=null;}
      })();
      this.checkPromise=pending;return pending;
    }
    async retry({interactive=true}={}){
      if(this.upgradeOwned)return false;
      if(!this.live()?.epoch){await this.onProgramRequested({interactive});if(interactive)this.set({prompt:true});return false;}
      try{await this.adapter.enterProgramRaw?.();}catch(e){this.set({phase:'unknown',ready:false,busy:false,prompt:interactive,canUpgrade:false,message:e.message,code:e.code||'MODE'});return false;}
      return this.check({force:true,interactive});
    }
    sessionChanged(snapshot){
      if(!this.upgradeOwned)return;
      this.set({phase:'upgrading',ready:false,busy:true,prompt:true,message:snapshot.message,code:'UPGRADING'});
    }
    confirmUpgrade(){
      if(this.disposed)return Promise.reject(fail('DISPOSED','设备会话已关闭。'));
      if(this.upgradePromise)return this.upgradePromise;
      if(!this.state.canUpgrade||!this.state.prompt)return Promise.reject(fail('NOT_ALLOWED','请先核对主控固件并重新确认。'));
      const live=this.live(),cached=this.state.actual,binding=this.session.binding;
      // An earlier App epoch is evidence of identity, never a live consent epoch after OTA.
      const actual=live&&cached&&cached.epoch===live.epoch&&cached.deviceId===live.deviceId?cached:null;
      const recovery=this.bindingPending()&&(actual?binding?.deviceId===actual.deviceId&&binding?.uid===actual.uid:this.state.phase==='recovery');
      // Losing the live device cannot silently turn an old update prompt into Boot consent.
      // Only a newly presented recovery state may use its pinned binding without a live epoch.
      if(!actual&&!recovery)return Promise.reject(fail('STALE','设备连接已变化，请重新核对并确认恢复。'));
      const consent=actual?{uid:actual.uid,deviceId:actual.deviceId,epoch:actual.epoch}:{uid:binding?.uid,deviceId:binding?.deviceId,epoch:null};
      const token=++this.generation,entry=this.entry;
      this.consent={...consent,token,entry,stage:recovery?'reconnect':'before-enter'};
      this.upgradeOwned=true;this.cancelled=false;
      this.set({phase:'upgrading',ready:false,busy:true,prompt:true,canUpgrade:false,code:'UPGRADING',message:'正在准备内置主控固件…'});
      const pending=(async()=>{
        try{
          const {pkg}=await this.bundleReady();
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
          if(consent.epoch&&this.live()?.epoch!==consent.epoch)throw fail('STALE','设备连接已变化，请重新确认升级。');
          if(!consent.deviceId||!/^[0-9a-f]{24}$/.test(consent.uid||''))throw fail('IDENTITY','缺少原主机的绑定身份，不能升级。');
          // Historical pending records carry identity only. They cannot redefine this App's target.
          if(recovery){this.session.saveBinding({...binding,deviceId:consent.deviceId,uid:consent.uid,pending:targetOf(pkg),written:sameTarget(binding.pending,pkg)&&binding.written===true});}
          await this.session.choose(pkg.bytes,pkg.name||'xiaobai_firmware.ota');
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
          const result=await this.session.start({recovery});
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
          if(!['success','current'].includes(this.session.state.phase))throw fail('UNCONFIRMED','主控升级尚未确认，请重试。');
          this.set({message:'主控已确认，正在恢复编程连接与口令状态…'});
          await this.adapter.enterProgramRaw();
          const identity=this.live();if(!identity?.epoch)throw fail('DISCONNECTED','恢复编程连接失败。');
          this.epoch=identity.epoch;this.checkedEpoch=null;
          const ready=await this.check({force:true,duringUpgrade:true});
          if(!ready)throw fail('UNCONFIRMED',this.state.message);
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
          await this.adapter.initializeLearned?.();
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
          this.set({phase:'success',ready:true,busy:false,prompt:true,canUpgrade:false,code:'READY',message:'升级完成，编程连接已恢复。请点击运行执行作品。'});
          return result;
        }catch(e){
          if(!this.disposed){const recover=this.bindingPending();this.set({phase:recover?'recovery':'unknown',ready:false,busy:false,prompt:!this.cancelled,canUpgrade:recover,code:e.code||'UPGRADE',message:this.cancelled?'升级已停止，可在编程界面重新确认恢复。':e.message});}
          throw e;
        }finally{this.upgradeOwned=false;if(this.upgradePromise===pending)this.upgradePromise=null;}
      })();
      this.upgradePromise=pending;return pending;
    }
    async cancel({background=false,reason='已取消升级'}={}){
      if(this.disposed)return;this.cancelled=true;this.state.prompt=false;this.activePromptKey=null;
      if(this.upgradeOwned){await this.session.cancel({background});this.set({ready:false,prompt:false,message:reason});return;}
      if(this.checkPromise){this.generation++;this.checkPromise=null;this.checkedEpoch=this.epoch;this.set({phase:'unknown',ready:false,busy:false,prompt:false,canUpgrade:false,code:'CANCELLED',message:'已停止核对，可继续编辑。学习或运行前需重新核对。'});return;}
      this.set({prompt:false});
    }
    leaveProgram(reason='已离开编程界面。'){
      this.programRequested=false;this.entry++;this.generation++;this.checkPromise=null;this.state.prompt=false;this.activePromptKey=null;
      if(this.upgradeOwned){this.cancel({background:true,reason}).catch(()=>{});return;}
      this.state.busy=false;this.emit();
    }
    disconnected(epoch,{owned=false}={}){
      if(this.disposed||epoch&&this.epoch&&epoch!==this.epoch)return;
      // A native transport event is not user cancellation. The owning Session
      // distinguishes a bounded Boot reconnect from a failed DATA transfer.
      if(this.upgradeOwned){this.epoch=null;this.checkedEpoch=null;this.state.ready=false;return;}
      this.epoch=null;this.checkedEpoch=null;this.checkPromise=null;this.generation++;this.state.ready=false;
      const recovery=this.bindingPending(),prompt=Boolean(recovery&&this.programRequested&&!this.cancelled);
      this.set({phase:recovery?'recovery':'unknown',ready:false,busy:false,prompt,canUpgrade:recovery,code:'DISCONNECTED',actual:null,currentVersion:null,message:recovery?'升级连接已断开。请保持原主机供电，点确定后检查并恢复更新。':'设备已断开，可继续编辑作品。'});
    }
    async dispose(){if(this.disposed)return;await this.cancel({background:true});this.disposed=true;this.generation++;await this.session.dispose();this.listeners?.clear();}
  }
  return{Gate,parseVersionEvent,TARGET_EVENT,sameTarget};
});
