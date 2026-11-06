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

  const sameTarget=(a,b)=>Boolean(a&&b&&a.boardId===b.boardId&&a.version===b.version&&a.imageSize===b.imageSize&&a.imageSha256===b.imageSha256);
  function requireBootVersion(pkg,info){
    const required=pkg?.minBootVersion??pkg?.minBoot;
    const valid=value=>Number.isInteger(value)&&value>0&&value<=0xffffffff;
    if(!valid(required)||(pkg.minBoot!==undefined&&pkg.minBoot!==required)||(pkg.minBootVersion!==undefined&&pkg.minBootVersion!==required))throw fail('BUNDLE','内置固件缺少有效的最低引导版本，请更新 App。');
    if(!valid(info?.bootVersion))throw fail('BOOT_UNKNOWN','尚未读取有效的主控引导版本，请重新连接后核对。');
    if(info.bootVersion<required)throw fail('BOOT_VERSION','当前主控引导程序版本过低，需要通过 DAP 更新主控引导程序及配套固件，再重新连接。');
  }
  class Gate{
    constructor(adapter,{loadBundle=()=>globalThis.XiaobaiFirmwareBundle.load(),storage=null,onChange=()=>{},sessionFactory=(a,o)=>new Ota.Session(a,o),timing={}}={}){
      this.adapter=adapter;this.loadBundle=loadBundle;this.storage=storage;this.onChange=onChange;
      this.epoch=null;this.generation=0;this.entry=0;this.programRequested=false;this.disposed=false;
      this.bundle=null;this.bundlePromise=null;this.checkPromise=null;this.checkedEpoch=null;this.upgradePromise=null;
      this.prompted=new Set();this.hints=new Set();this.hint=null;this.upgradeOwned=false;this.cancelled=false;this.activePromptKey=null;
      this.state={phase:'unknown',ready:false,busy:false,prompt:false,canUpgrade:false,confirmationOnly:false,message:'连接小白并进入编程后核对主控固件。',code:'DISCONNECTED',actual:null,currentVersion:null,targetVersion:null};
      const guarded=new Proxy(adapter,{get:(target,key)=>{
        const value=target[key];if(typeof value!=='function')return value;
        if(!['prepare','readApp','queryStatus','enterBoot','connectApp','connectBoot','raw'].includes(key))return value.bind(target);
        return async(...args)=>{
          this.guardConsent(key,args);
          if(key==='enterBoot')this.consent.stage='boot';
          if(key==='connectApp'||key==='connectBoot')this.consent.stage=args[1]?.confirmationOnly?'confirmation-only':'reconnect';
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
      if(c.confirmationOnly&&['enterBoot','connectBoot','raw'].includes(method))throw fail('NOT_ALLOWED','固件已写入，当前仅允许确认启动状态，不能重新刷写。');
      if(c.confirmationOnly&&method==='connectApp'&&args[1]?.confirmationOnly!==true)throw fail('NOT_ALLOWED','仅允许重新连接并确认已安装固件。');
      if(method==='connectApp'||method==='connectBoot'||method==='enterBoot'){
        const binding=args[0];if(binding?.deviceId!==c.deviceId||binding?.uid!==c.uid)throw fail('IDENTITY','恢复连接不是用户确认的主机，已停止升级。');
      }else if(['prepare','readApp','queryStatus','enterBoot','raw'].includes(method)&&live){
        if(live.deviceId!==c.deviceId||c.stage==='before-enter'&&c.epoch&&live.epoch!==c.epoch)throw fail('IDENTITY','设备连接已变化，原升级确认已失效。');
      }else if(!live&&c.stage==='before-enter'&&c.epoch)throw fail('DISCONNECTED','升级前设备已断开，请重新连接并确认。');
      if(result&&method==='connectApp'&&args[1]?.confirmationOnly){
        const info=result.info,pkg=this.bundle?.pkg;
        if(!pkg||result.uid!==c.uid||!result.deviceId||!result.epoch||live?.epoch!==result.epoch||live.deviceId!==result.deviceId||!info||info.protocol!==P.C.OTA_PROTOCOL_VERSION||info.mode!==0||!info.imageValid||!sameTarget(info,pkg))throw fail('IDENTITY','重新连接的主机身份或已安装固件与确认目标不一致。');
        requireBootVersion(pkg,info);
        c.deviceId=result.deviceId;c.epoch=result.epoch;c.stage='confirmation-only';c.confirmationOnly=true;
      }
      if(result&&method==='readApp'&&(result.uid!==c.uid||result.deviceId!==c.deviceId))throw fail('IDENTITY','主机身份与用户确认不一致，已停止升级。');
      if(result&&method==='readApp')requireBootVersion(this.bundle?.pkg,result.info);
    }
    current(token,epoch=this.epoch){if(this.disposed||token!==this.generation||!epoch||this.live()?.epoch!==epoch)throw fail('STALE','当前设备连接已变化，请重新核对。');}
    bindingPending(){return Boolean(this.session.binding?.pending);}
    confirmationPending(){return Boolean(this.bindingPending()&&(this.state.confirmationOnly||this.session.binding.written===true&&(!this.bundle?.pkg||sameTarget(this.session.binding.pending,this.bundle.pkg))));}
    hasRecovery(){return !this.disposed&&this.bindingPending();}
    async bundleReady(){
      if(this.bundle)return this.bundle;
      if(!this.bundlePromise)this.bundlePromise=Promise.resolve().then(()=>this.loadBundle()).then(value=>{
        if(!value?.pkg?.signatureVerified)throw fail('BUNDLE','内置固件未通过签名校验，请更新 App。');
        this.bundle=value;
        // Before the target loads, written is only a provisional offline display hint.
        if(this.state.confirmationOnly&&!this.state.actual)this.state.confirmationOnly=false;
        this.state.targetVersion=value.pkg.version;return value;
      }).finally(()=>{this.bundlePromise=null;});
      return this.bundlePromise;
    }
    attachEpoch(epoch,{owned=false}={}){
      if(this.disposed||!epoch)return;
      if(epoch===this.epoch)return;
      this.epoch=epoch;this.checkedEpoch=null;this.hint=null;this.hints.clear();
      if(owned&&this.upgradeOwned){this.state.ready=false;return;}
      this.generation++;this.entry++;this.checkPromise=null;this.programRequested=false;this.cancelled=false;
      this.set({phase:'unknown',ready:false,busy:false,prompt:false,canUpgrade:false,confirmationOnly:false,actual:null,currentVersion:null,code:'UNCHECKED',message:'进入编程后核对主控固件。'});
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
        const confirmationOnly=this.confirmationPending();
        this.set({phase:confirmationOnly?'unconfirmed':'recovery',ready:false,busy:false,prompt,canUpgrade:!confirmationOnly,confirmationOnly,code:confirmationOnly?'UNCONFIRMED':'RECOVERY',message:confirmationOnly?'固件已写入，启动状态尚未确认。点击“重试确认”后仅检查原主机，不重新刷写。':'有一条尚未确认的更新记录。当前尚未建立升级连接。点击“连接并恢复”后，将先检查原主机状态，再恢复更新。'});
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
      const epoch=this.epoch,token=this.generation,entry=this.entry;
      let confirmingUid=null;
      const guard=()=>!this.disposed&&!this.cancelled&&token===this.generation&&entry===this.entry&&this.programRequested&&this.live()?.epoch===epoch&&(!confirmingUid||this.session.binding?.uid===confirmingUid);
      const requireCurrent=()=>{this.current(token,epoch);if(!guard())throw fail('STALE','当前编程连接已变化，已停止启动确认。');};
      let confirmingInstalled=false,actual=null;
      this.set({phase:'checking',ready:false,busy:true,prompt:false,canUpgrade:false,confirmationOnly:false,code:'CHECKING',message:'正在核对主控固件…'});
      const pending=(async()=>{
        try{
          const {pkg}=await this.bundleReady();this.current(token,epoch);
          actual=await this.adapter.readApp({guard:()=>!this.disposed&&token===this.generation&&this.live()?.epoch===epoch});this.current(token,epoch);
          if(duringUpgrade&&(actual.uid!==this.consent?.uid||actual.deviceId!==this.consent?.deviceId))throw fail('IDENTITY','恢复编程时主机身份与升级前不一致。');
          if(actual.epoch!==epoch||!actual.deviceId||!/^[0-9a-f]{24}$/.test(actual.uid||''))throw fail('IDENTITY','主机身份反馈不完整，请重新连接。');
          if(actual.info.mode!==0||actual.info.protocol!==P.C.OTA_PROTOCOL_VERSION||actual.info.boardId!==pkg.boardId)throw fail('UNSUPPORTED','当前硬件或升级协议不受此 App 支持。');
          requireBootVersion(pkg,actual.info);
          if(actual.productMode!==undefined&&actual.productMode!==4)throw fail('MODE','主机尚未确认编程模式，请重新进入编程后重试。');
          const info=actual.info,key=`${actual.uid}:${pkg.imageSha256}`,binding=this.session.binding;
          const common={actual,currentVersion:info.version,targetVersion:pkg.version,ready:false,busy:duringUpgrade,prompt:false,confirmationOnly:false};
          const show=()=>{const prompt=interactive||this.activePromptKey===key||!this.prompted.has(key);this.prompted.add(key);if(prompt)this.activePromptKey=key;return prompt;};
          const confirmPendingTarget=async target=>{
            confirmingInstalled=true;confirmingUid=actual.uid;requireCurrent();
            this.set({...common,phase:'confirming',busy:true,canUpgrade:false,confirmationOnly:true,code:'CONFIRMING',message:'主控镜像已匹配，正在确认启动状态，不重新刷写…'});
            await this.session.confirmInstalled(actual,target,{guard,queryStatus:async()=>{requireCurrent();const value=await this.adapter.queryStatus();requireCurrent();return value;},restore:async()=>{requireCurrent();await this.adapter.enterProgramRaw();requireCurrent();await this.adapter.initializeLearned?.({confirmationEpoch:actual.epoch});requireCurrent();}});
            requireCurrent();
          };
          this.checkedEpoch=epoch;
          // Finish a proven historical installation read-only before offering this App's newer target.
          if(!duringUpgrade&&info.version<pkg.version&&info.imageValid&&binding?.pending&&binding.written===true&&binding.uid===actual.uid&&sameTarget(info,binding.pending))await confirmPendingTarget(binding.pending);
          if(info.version>pkg.version){this.set({...common,phase:'newer',canUpgrade:false,prompt:show(),code:'NEWER',message:'主控固件比此 App 更新，请更新 App 后再学习或运行。'});return false;}
          if(info.version===pkg.version&&info.imageValid&&!sameTarget(info,pkg)){
            this.set({...common,phase:'unknown',canUpgrade:false,prompt:show(),code:'VERSION_COLLISION',message:'主控同版本的镜像内容与 App 不一致，已停止升级。请更新 App 或联系支持。'});return false;
          }
          if(info.version===pkg.version&&info.imageValid&&sameTarget(info,pkg)){
            if(binding?.pending&&binding.uid===actual.uid&&!duringUpgrade)await confirmPendingTarget(pkg);
            this.set({...common,phase:'ready',ready:true,canUpgrade:false,code:'READY',message:'主控固件已匹配，可以学习和运行。'});return true;
          }
          this.set({...common,phase:'update-required',canUpgrade:true,prompt:show(),code:info.version===pkg.version?'REPAIR_REQUIRED':'UPDATE_REQUIRED',message:info.version===pkg.version?'主控镜像状态无效，需要修复后才能学习和运行。点确定即可自动修复。':'主控固件需要更新。点确定后自动升级，完成后可继续编程。'});return false;
        }catch(e){
          if(!this.disposed&&token===this.generation&&this.live()?.epoch===epoch){const bootBlocked=['BOOT_VERSION','BOOT_UNKNOWN'].includes(e.code),confirmationOnly=!bootBlocked&&(confirmingInstalled||this.confirmationPending());this.checkedEpoch=epoch;this.set({phase:e.code==='BOOT_VERSION'?'boot-update-required':confirmationOnly?'unconfirmed':'unknown',confirmationOnly,ready:false,busy:duringUpgrade,prompt:interactive||this.programRequested,canUpgrade:false,code:e.result===2?'UNSUPPORTED':e.code||'QUERY',...(bootBlocked?{actual,currentVersion:actual?.info?.version??null}:{}),message:confirmationOnly?'主控镜像或启动状态尚未确认。请重试确认，不会重新刷写。 '+e.message:e.result===2?'此固件没有蓝牙升级能力，需先安装新版 Boot 与主控固件。':e.message});}
          return false;
        }finally{if(this.checkPromise===pending)this.checkPromise=null;}
      })();
      this.checkPromise=pending;return pending;
    }
    async retry({interactive=true}={}){
      if(this.upgradeOwned)return false;
      this.cancelled=false;
      if(!this.live()?.epoch){await this.onProgramRequested({interactive});if(interactive)this.set({prompt:true});if(interactive&&this.confirmationPending())return this.confirmUpgrade();return false;}
      try{if(!this.confirmationPending())await this.adapter.enterProgramRaw?.();}catch(e){this.set({phase:'unknown',ready:false,busy:false,prompt:interactive,canUpgrade:false,message:e.message,code:e.code||'MODE'});return false;}
      return this.check({force:true,interactive});
    }
    sessionChanged(snapshot){
      if(!this.upgradeOwned)return;
      const confirmationOnly=Boolean(this.consent?.confirmationOnly||snapshot.confirmationOnly||snapshot.written);
      this.set({phase:confirmationOnly?'confirming':'upgrading',confirmationOnly,ready:false,busy:true,prompt:true,message:snapshot.message,code:confirmationOnly?'CONFIRMING':'UPGRADING'});
    }
    confirmUpgrade(){
      if(this.disposed)return Promise.reject(fail('DISPOSED','设备会话已关闭。'));
      if(this.upgradePromise)return this.upgradePromise;
      if(['BOOT_VERSION','BOOT_UNKNOWN'].includes(this.state.code))return Promise.reject(fail(this.state.code,this.state.message));
      const confirmationOnly=this.confirmationPending();
      if((!this.state.canUpgrade&&!confirmationOnly)||!this.state.prompt)return Promise.reject(fail('NOT_ALLOWED','请先核对主控固件并重新确认。'));
      const live=this.live(),cached=this.state.actual,binding=this.session.binding;
      // An earlier App epoch is evidence of identity, never a live consent epoch after OTA.
      const actual=live&&cached&&cached.epoch===live.epoch&&cached.deviceId===live.deviceId?cached:null;
      const historicalTarget=Boolean(actual&&binding?.pending&&binding.uid===actual.uid&&this.bundle?.pkg&&!sameTarget(binding.pending,this.bundle.pkg));
      const recovery=!historicalTarget&&this.bindingPending()&&(actual?binding?.uid===actual.uid&&(confirmationOnly||binding.deviceId===actual.deviceId):this.state.phase==='recovery'||confirmationOnly);
      // Losing the live device cannot silently turn an old update prompt into Boot consent.
      // Only a newly presented recovery state may use its pinned binding without a live epoch.
      if(!actual&&!recovery)return Promise.reject(fail('STALE','设备连接已变化，请重新核对并确认恢复。'));
      const consent=actual?{uid:actual.uid,deviceId:actual.deviceId,epoch:actual.epoch}:{uid:binding?.uid,deviceId:binding?.deviceId,epoch:null};
      const token=++this.generation,entry=this.entry;
      this.consent={...consent,token,entry,confirmationOnly,stage:confirmationOnly?'confirmation-only':recovery?'reconnect':'before-enter'};
      this.upgradeOwned=true;this.cancelled=false;
      this.set({phase:confirmationOnly?'confirming':'upgrading',confirmationOnly,ready:false,busy:true,prompt:true,canUpgrade:false,code:confirmationOnly?'CONFIRMING':'UPGRADING',message:confirmationOnly?'正在重新确认已安装的主控固件，不重新刷写…':'正在准备内置主控固件…'});
      const pending=(async()=>{
        try{
          const {pkg}=await this.bundleReady();
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
          if(consent.epoch&&this.live()?.epoch!==consent.epoch)throw fail('STALE','设备连接已变化，请重新确认升级。');
          if(!consent.deviceId||!/^[0-9a-f]{24}$/.test(consent.uid||''))throw fail('IDENTITY','缺少原主机的绑定身份，不能升级。');
          // Historical pending records carry identity only. They cannot redefine this App's target.
          // Preserve pending until the Session accepts fresh identity, compatibility and power.
          await this.session.choose(pkg.bytes,pkg.name||'xiaobai_firmware.ota');
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
          let restored=false,restoredActual=null;
          const requireConfirmed=(actual)=>{
            const live=this.live(),c=this.consent;
            if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry||!this.programRequested||!actual?.epoch||live?.epoch!==actual.epoch||live.deviceId!==actual.deviceId)throw fail('STALE','启动确认期间连接已变化，请重新检查。');
            if(actual.uid!==c?.uid||actual.deviceId!==c.deviceId||!actual.info||actual.info.protocol!==P.C.OTA_PROTOCOL_VERSION||actual.info.mode!==0||!actual.info.imageValid||!sameTarget(actual.info,pkg))throw fail('IDENTITY','启动确认的主机身份或目标镜像不一致。');
          };
          const result=await this.session.start({recovery,confirmationOnly,restoreConfirmation:async actual=>{
            requireConfirmed(actual);
            this.epoch=actual.epoch;this.checkedEpoch=null;
            this.set({phase:'confirming',actual,currentVersion:actual.info.version,confirmationOnly:true,ready:false,busy:true,canUpgrade:false,code:'CONFIRMING',message:'主控状态已确认，正在恢复编程连接与口令状态…'});
            await this.adapter.enterProgramRaw();requireConfirmed(actual);
            await this.adapter.initializeLearned?.({confirmationEpoch:actual.epoch});requireConfirmed(actual);
            restoredActual=actual;restored=true;
          }});
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
          if(!['success','current'].includes(this.session.state.phase))throw fail('UNCONFIRMED','主控升级尚未确认，请重试。');
          if(restored){
            requireConfirmed(restoredActual);
            if(this.session.state.healthVerifiedEpoch!==restoredActual.epoch)throw fail('UNCONFIRMED','未取得当前连接的完整启动状态，请重新确认。');
            this.checkedEpoch=restoredActual.epoch;
          }else{
            // The Session may return current without a pending record; preserve its normal readiness check.
            this.set({message:'主控已确认，正在恢复编程连接与口令状态…'});
            await this.adapter.enterProgramRaw();
            const identity=this.live();if(!identity?.epoch)throw fail('DISCONNECTED','恢复编程连接失败。');
            this.epoch=identity.epoch;this.checkedEpoch=null;
            const ready=await this.check({force:true,duringUpgrade:true});
            if(!ready)throw fail('UNCONFIRMED',this.state.message);
            if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
            await this.adapter.initializeLearned?.();
          }
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry)throw fail('CANCELLED','升级已取消。');
          this.set({phase:'success',ready:true,busy:false,prompt:true,canUpgrade:false,confirmationOnly:false,code:'READY',message:'升级完成，编程连接已恢复。请点击运行执行作品。'});
          return result;
        }catch(e){
          if(!this.disposed){const bootBlocked=['BOOT_VERSION','BOOT_UNKNOWN'].includes(e.code),recover=this.bindingPending(),confirmationOnly=!bootBlocked&&Boolean(recover&&(this.consent?.confirmationOnly||this.session.state.written||this.session.binding.written&&sameTarget(this.session.binding.pending,this.bundle?.pkg)));this.set({phase:e.code==='BOOT_VERSION'?'boot-update-required':confirmationOnly?'unconfirmed':recover&&!bootBlocked?'recovery':'unknown',confirmationOnly,ready:false,busy:false,prompt:!this.cancelled,canUpgrade:recover&&!confirmationOnly&&!bootBlocked,code:e.code||'UPGRADE',message:this.cancelled?confirmationOnly?'启动确认已停止，可稍后重试确认，不重新刷写。':'升级已停止，可在编程界面重新确认恢复。':e.message});}
          throw e;
        }finally{this.upgradeOwned=false;if(this.upgradePromise===pending)this.upgradePromise=null;}
      })();
      this.upgradePromise=pending;return pending;
    }
    async cancel({background=false,reason='已取消升级'}={}){
      if(this.disposed)return;this.cancelled=true;this.state.prompt=false;this.activePromptKey=null;
      if(this.upgradeOwned){await this.session.cancel({background});this.set({ready:false,prompt:false,message:reason});return;}
      if(this.checkPromise){const confirmationOnly=this.confirmationPending();this.generation++;this.checkPromise=null;this.checkedEpoch=this.epoch;this.set({phase:confirmationOnly?'unconfirmed':'unknown',confirmationOnly,ready:false,busy:false,prompt:false,canUpgrade:false,code:'CANCELLED',message:'已停止核对，可继续编辑。学习或运行前需重新核对。'});return;}
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
      const confirmationOnly=this.confirmationPending();
      this.set({phase:confirmationOnly?'unconfirmed':recovery?'recovery':'unknown',confirmationOnly,ready:false,busy:false,prompt,canUpgrade:recovery&&!confirmationOnly,code:'DISCONNECTED',actual:null,currentVersion:null,message:confirmationOnly?'固件已写入，连接已断开。请重试确认启动状态，不重新刷写。':recovery?'升级连接已断开。请保持原主机供电，点确定后检查并恢复更新。':'设备已断开，可继续编辑作品。'});
    }
    async dispose(){if(this.disposed)return;await this.cancel({background:true});this.disposed=true;this.generation++;await this.session.dispose();this.listeners?.clear();}
  }
  return{Gate,parseVersionEvent,TARGET_EVENT,sameTarget};
});
