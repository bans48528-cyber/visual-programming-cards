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
    // The notification carries the INFO schema, not the XBOT wire version.
    return Object.freeze({version,boardId:b[4]|b[5]<<8,protocol:P.C.OTA_PROTOCOL_VERSION,schemaVersion:b[6],imageValid:Boolean(b[7]&1)});
  }

  const sameTarget=(a,b)=>P.sameTarget(a,b);
  const bootBlocked=code=>['BOOT_VERSION','BOOT_UNKNOWN','BOOT_LAYOUT','BOOT_CAPABILITY','LAYOUT_UNKNOWN'].includes(code);
  const targetKey=pkg=>`${pkg.boardId}:${pkg.version}:${P.layoutOf(pkg).id}:${pkg.imageSize}:${pkg.imageSha256}`;
  function requireBootVersion(pkg,info){
    const required=pkg?.minBootVersion??pkg?.minBoot;
    const valid=value=>Number.isInteger(value)&&value>0&&value<=0xffffffff;
    if(!valid(required)||(pkg.minBoot!==undefined&&pkg.minBoot!==required)||(pkg.minBootVersion!==undefined&&pkg.minBootVersion!==required))throw fail('BUNDLE','内置固件缺少有效的最低引导版本，请更新 App。');
    if(!P.layoutOf(pkg))throw fail('BUNDLE','内置固件的目标布局无效，请更新 App。');
    // App INFO can report the Boot version compiled into an old App binary.
    // Only the freshly connected Boot may reject an update on Boot capabilities.
    if(info?.mode===P.C.OTA_MODE_BOOT)P.checkCompatibility(pkg,info);
  }
  class Gate{
    constructor(adapter,{loadBundle=()=>globalThis.XiaobaiFirmwareBundle.load(),storage=null,onChange=()=>{},sessionFactory=(a,o)=>new Ota.Session(a,o),targetVersion=()=>globalThis.XiaobaiFirmwareBundle?.METADATA?.bound?globalThis.XiaobaiFirmwareBundle.METADATA.firmware.version:null,timing={}}={}){
      this.adapter=adapter;this.loadBundle=loadBundle;this.storage=storage;this.onChange=onChange;this.programTargetVersion=targetVersion;this.programCache=null;this.upgradePreflightPromise=null;
      this.epoch=null;this.generation=0;this.entry=0;this.programRequested=false;this.disposed=false;
      this.bundle=null;this.bundlePromise=null;this.checkPromise=null;this.checkController=null;this.checkedEpoch=null;this.upgradePromise=null;
      this.prompted=new Set();this.hints=new Set();this.hint=null;this.upgradeOwned=false;this.cancelled=false;this.activePromptKey=null;
      this.state={phase:'unknown',ready:false,busy:false,prompt:false,canUpgrade:false,confirmationOnly:false,message:'连接小白并进入编程后核对主控固件。',code:'DISCONNECTED',actual:null,currentVersion:null,targetVersion:null};
      const guarded=new Proxy(adapter,{get:(target,key)=>{
        const value=target[key];if(typeof value!=='function')return value;
        if(!['prepare','readApp','queryStatus','sendPreflightHeartbeat','enterBoot','connectApp','connectBoot','probeRecovery','prepareRecoveryIdentity','raw'].includes(key))return value.bind(target);
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
    snapshot(){
      const s=this.session.snapshot(),live=this.live(),actual=this.state.actual;
      const ready=this.state.ready&&(this.state.checkKind!=='program-version'||
        this.programRequested&&live?.epoch===this.epoch&&live.deviceId===actual?.deviceId&&
        live.programMode===4&&live.enterVersion===actual?.enterVersion);
      return{...this.state,ready,epoch:this.epoch,progress:{phase:s.phase,committed:s.committed,total:s.total,written:s.written},session:s};
    }
    subscribe(fn){(this.listeners??=new Set()).add(fn);return()=>this.listeners.delete(fn);}
    emit(){const value=this.snapshot();this.onChange(value);for(const fn of this.listeners||[])fn(value);}
    set(patch){Object.assign(this.state,patch);this.emit();}
    abortCheck(reason='主控核对已取消。'){
      const controller=this.checkController;this.checkController=null;
      controller?.abort(fail('CANCELLED',reason));
    }
    live(){return this.adapter.identity?.()||null;}
    guardConsent(method,args,result){
      const c=this.consent;if(!c||this.disposed||this.cancelled||c.token!==this.generation||c.entry!==this.entry)throw fail('CANCELLED','升级确认已失效，请重新确认。');
      const live=this.live();
      if(c.confirmationOnly&&['enterBoot','connectBoot','sendPreflightHeartbeat','raw'].includes(method))throw fail('NOT_ALLOWED','固件已写入，当前仅允许确认启动状态，不能重新刷写。');
      if(method==='sendPreflightHeartbeat'&&(!live||args[0]!==live.epoch||c.deviceId!==live.deviceId))throw fail('STALE','升级前心跳与当前主机连接不匹配。');
      if(c.confirmationOnly&&method==='connectApp'&&args[1]?.confirmationOnly!==true)throw fail('NOT_ALLOWED','仅允许重新连接并确认已安装固件。');
      if(method==='connectApp'||method==='connectBoot'||method==='enterBoot'||method==='probeRecovery'||method==='prepareRecoveryIdentity'){
        const binding=args[0];if(binding?.deviceId!==c.deviceId||binding?.uid!==c.uid)throw fail('IDENTITY','恢复连接不是用户确认的主机，已停止升级。');
      }else if(['prepare','readApp','queryStatus','enterBoot','raw'].includes(method)&&live){
        if(live.deviceId!==c.deviceId||c.stage==='before-enter'&&c.epoch&&live.epoch!==c.epoch)throw fail('IDENTITY','设备连接已变化，原升级确认已失效。');
      }else if(!live&&c.stage==='before-enter'&&c.epoch&&!(result&&method==='prepareRecoveryIdentity'))throw fail('DISCONNECTED','升级前设备已断开，请重新连接并确认。');
      if(result&&(method==='probeRecovery'||method==='prepareRecoveryIdentity')){
        const original=args[0],kind=result.verification;
        if(method==='prepareRecoveryIdentity'&&(result.prepared!==true||result.kind!=='app'||result.uidSupported!==true||kind!=='app-uid'))throw fail('IDENTITY','升级前恢复地址尚未取得真实应用 UID 核验。');
        if(result.retired!==true||result.verifiedLocator!==true||typeof result.epoch!=='string'||!result.epoch||typeof result.deviceId!=='string'||!result.deviceId||!['boot','app'].includes(result.kind)||
          typeof result.uidSupported!=='boolean'||result.uidSupported&&result.uid!==c.uid||
          !result.uidSupported&&(result.kind!=='boot'||result.uid!==null)||
          !['boot-uid','app-uid','bound-address','historical-app-uid'].includes(kind)||
          ['boot-uid','app-uid'].includes(kind)&&(!result.uidSupported||result.uid!==c.uid)||
          kind==='bound-address'&&result.deviceId!==original.deviceId)
          throw fail('IDENTITY','只读识别未证明当前设备为原主机，不能恢复写入。');
        // The probe epoch is retired. Consent moves the locator only; a fresh
        // write connection must independently recheck Boot INFO/UID in Session.
        c.originalDeviceId??=c.deviceId;c.deviceId=result.deviceId;c.epoch=null;c.stage='reconnect';
      }
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
        requireBootVersion(value.pkg);
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
      this.epoch=epoch;this.checkedEpoch=null;this.programCache=null;this.hint=null;this.hints.clear();
      if(owned&&this.upgradeOwned){this.state.ready=false;return;}
      this.generation++;this.entry++;this.checkPromise=null;this.abortCheck('设备连接已变化，已停止旧主控核对。');this.programRequested=false;this.cancelled=false;
      this.set({phase:'unknown',ready:false,busy:false,prompt:false,canUpgrade:false,confirmationOnly:false,actual:null,currentVersion:null,code:'UNCHECKED',message:'进入编程后核对主控固件。'});
    }
    onVersionEvent(event,epoch){
      if(this.disposed||epoch!==this.epoch)return false;
      const hint=parseVersionEvent(event);if(!hint)return false;
      const key=[hint.version,hint.boardId,hint.schemaVersion,+hint.imageValid].join(':');
      if(this.hints.has(key))return true;this.hints.add(key);this.hint=hint;
      // Ordinary readiness is established by a correlated part-2 reply, never
      // by a bare D3 notification from an earlier mode entry.
      if(typeof this.adapter.readProgramVersion==='function'&&!this.upgradeOwned&&!this.bindingPending()){
        if(this.programCache&&(hint.version!==this.programCache.info.version||hint.imageValid!==this.programCache.info.imageValid)){
          this.programCache=null;this.checkedEpoch=null;this.state.ready=false;
          if(this.programRequested)this.check({force:true}).catch(()=>{});
        }
        return true;
      }
      // A fresh event is a hint only. UID, hash and readiness still require fresh INFO.
      if(!this.state.actual)this.state.currentVersion=hint.version;
      if(!this.upgradeOwned&&this.programRequested&&this.checkedEpoch===epoch&&this.state.actual&&
         (hint.version!==this.state.actual.info.version||hint.boardId!==this.state.actual.info.boardId||hint.schemaVersion!==P.infoSchema(this.state.actual.info)||hint.imageValid!==this.state.actual.info.imageValid)){
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
        const binding=this.session.binding,key=`${binding.uid}:${targetKey(this.bundle.pkg)}`;
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
      if(interactive)this.cancelled=false;
      if(!this.live()?.epoch){await this.onProgramRequested({interactive});if(interactive)this.set({prompt:true});return false;}
      if(this.snapshot().ready&&this.checkedEpoch===this.epoch)return true;
      if(this.state.phase==='unknown'&&this.checkedEpoch===this.epoch&&!this.checkPromise)return this.retry({interactive});
      const ready=await this.check({interactive});
      if(!ready&&interactive&&!this.disposed)this.set({prompt:true});
      return ready;
    }
    checkProgram({interactive=false,force=false}={}){
      if(this.disposed||this.upgradeOwned)return Promise.resolve(false);
      const identity=this.live();if(!identity?.epoch||identity.programMode!==4)return Promise.resolve(false);
      if(identity.epoch!==this.epoch)this.attachEpoch(identity.epoch);
      if(this.checkPromise){if(interactive&&!this.state.prompt)this.set({prompt:true});return this.checkPromise;}
      const epoch=this.epoch,token=this.generation,entry=this.entry,enterVersion=identity.enterVersion;
      const target=typeof this.programTargetVersion==='function'?this.programTargetVersion():this.programTargetVersion;
      if(!Number.isInteger(target)||target<1){this.set({phase:'unknown',ready:false,busy:false,prompt:interactive,canUpgrade:false,code:'BUNDLE',message:'此 App 尚未绑定主控应用版本。'});return Promise.resolve(false);}
      const controller=new AbortController();this.checkController=controller;
      const guard=()=>!this.disposed&&!this.cancelled&&token===this.generation&&entry===this.entry&&this.programRequested&&
        this.live()?.epoch===epoch&&this.live()?.deviceId===identity.deviceId&&this.live()?.enterVersion===enterVersion&&this.live()?.programMode===4;
      const apply=actual=>{
        if(!guard())throw fail('STALE','当前编程连接已变化。');
        if(actual?.epoch!==epoch||actual.deviceId!==identity.deviceId||actual.enterVersion!==enterVersion||
          actual.productMode!==4||!Number.isInteger(actual.info?.version)||actual.info.version<1||
          ![0,1].includes(actual.info.mode)||typeof actual.info.imageValid!=='boolean')throw fail('VERSION','应用版本反馈不完整。');
        this.checkedEpoch=epoch;this.programCache={epoch,deviceId:actual.deviceId,info:{...actual.info}};
        const common={checkKind:'program-version',actual,currentVersion:actual.info.version,targetVersion:target,busy:false,confirmationOnly:false};
        if(actual.info.mode===0&&actual.info.imageValid&&actual.info.version===target){this.set({...common,phase:'ready',ready:true,prompt:false,canUpgrade:false,code:'READY',message:'主控应用版本已匹配，可以学习和运行。'});return true;}
        const key=identity.deviceId+':version:'+target,prompt=interactive||this.activePromptKey===key||!this.prompted.has(key);
        this.prompted.add(key);if(prompt)this.activePromptKey=key;
        this.set({...common,phase:'update-required',ready:false,prompt,canUpgrade:true,code:actual.info.imageValid?'UPDATE_REQUIRED':'REPAIR_REQUIRED',message:actual.info.imageValid?'主控应用版本与本 App 不一致。确认更新后将完整核验原主机、镜像与引导能力。':'主控应用镜像无效。确认修复后将完整核验原主机、镜像与引导能力。'});return false;
      };
      if(!force&&this.programCache?.epoch===epoch&&this.programCache.deviceId===identity.deviceId){
        try{return Promise.resolve(apply({...this.programCache,enterVersion,productMode:4}));}
        catch(e){this.set({phase:'unknown',ready:false,busy:false,prompt:interactive,canUpgrade:false,code:e.code||'VERSION',message:e.message});return Promise.resolve(false);}
        finally{if(this.checkController===controller)this.checkController=null;}
      }
      this.set({checkKind:'program-version',phase:'checking',ready:false,busy:true,prompt:interactive,canUpgrade:false,confirmationOnly:false,code:'CHECKING',targetVersion:target,message:'正在核对主控应用版本…'});
      const pending=(async()=>{
        try{return apply(await this.adapter.readProgramVersion({guard,signal:controller.signal}));}
        catch(e){if(!this.disposed&&token===this.generation&&this.live()?.epoch===epoch){this.checkedEpoch=epoch;this.set({phase:'unknown',ready:false,busy:false,prompt:interactive||this.programRequested,canUpgrade:false,code:e.code||'VERSION',message:e.message});}return false;}
        finally{if(this.checkPromise===pending)this.checkPromise=null;if(this.checkController===controller)this.checkController=null;}
      })();this.checkPromise=pending;return pending;
    }
    check({interactive=false,force=false,duringUpgrade=false,full=false}={}){
      if(!duringUpgrade&&!full&&!this.bindingPending()&&typeof this.adapter.readProgramVersion==='function')return this.checkProgram({interactive,force});
      if(this.disposed||this.upgradeOwned&&!duringUpgrade)return Promise.resolve(false);
      const identity=this.live();if(!identity?.epoch)return Promise.resolve(false);
      if(identity.epoch!==this.epoch)this.attachEpoch(identity.epoch,{owned:duringUpgrade});
      if(this.checkPromise){if(interactive&&!this.state.prompt)this.set({prompt:true});return this.checkPromise;}
      if(!force&&this.checkedEpoch===this.epoch){if(interactive&&!this.state.ready)this.set({prompt:true});return Promise.resolve(this.state.ready);}
      const epoch=this.epoch,token=this.generation,entry=this.entry;
      // This signal belongs only to the ordinary identity check. Upgrade Session
      // ownership and cancellation retain their separate consent/transport rules.
      const controller=duringUpgrade?null:new AbortController();
      if(controller)this.checkController=controller;
      let confirmingUid=null;
      const guard=()=>!this.disposed&&!this.cancelled&&token===this.generation&&entry===this.entry&&this.programRequested&&this.live()?.epoch===epoch&&(!confirmingUid||this.session.binding?.uid===confirmingUid);
      const requireCurrent=()=>{this.current(token,epoch);if(!guard())throw fail('STALE','当前编程连接已变化，已停止启动确认。');};
      let confirmingInstalled=false,actual=null;
      this.set({checkKind:'full-identity',phase:'checking',ready:false,busy:true,prompt:interactive,canUpgrade:false,confirmationOnly:false,code:'CHECKING',message:'正在核对主控固件，读取主机身份与镜像信息…'});
      const pending=(async()=>{
        try{
          const {pkg}=await this.bundleReady();this.current(token,epoch);
          actual=await this.adapter.readApp({guard:()=>!this.disposed&&token===this.generation&&this.live()?.epoch===epoch,signal:controller?.signal});this.current(token,epoch);
          if(duringUpgrade&&(actual.uid!==this.consent?.uid||actual.deviceId!==this.consent?.deviceId))throw fail('IDENTITY','恢复编程时主机身份与升级前不一致。');
          if(actual.epoch!==epoch||!actual.deviceId||!/^[0-9a-f]{24}$/.test(actual.uid||''))throw fail('IDENTITY','主机身份反馈不完整，请重新连接。');
          if(actual.info.mode!==0||!P.isSupportedInfo(actual.info)||actual.info.boardId!==pkg.boardId)throw fail('UNSUPPORTED','当前硬件或升级协议不受此 App 支持。');
          requireBootVersion(pkg,actual.info);
          if(actual.productMode!==undefined&&actual.productMode!==4)throw fail('MODE','主机尚未确认编程模式，请重新进入编程后重试。');
          const info=actual.info,key=`${actual.uid}:${targetKey(pkg)}`,binding=this.session.binding;
          if(typeof this.adapter.readProgramVersion==='function')this.programCache={epoch,deviceId:actual.deviceId,info:{version:info.version,mode:info.mode,imageValid:info.imageValid}};
          const common={actual,currentVersion:info.version,targetVersion:pkg.version,ready:false,busy:duringUpgrade,prompt:false,confirmationOnly:false};
          const show=()=>{const prompt=interactive||this.activePromptKey===key||!this.prompted.has(key);this.prompted.add(key);if(prompt)this.activePromptKey=key;return prompt;};
          const confirmPendingTarget=async target=>{
            confirmingInstalled=true;confirmingUid=actual.uid;requireCurrent();
            this.set({...common,phase:'confirming',busy:true,canUpgrade:false,confirmationOnly:true,code:'CONFIRMING',message:'主控镜像已匹配，正在确认启动状态，不重新刷写…'});
            await this.session.confirmInstalled(actual,target,{guard,queryStatus:async()=>{requireCurrent();const value=await this.adapter.queryStatus();requireCurrent();return value;},restore:async()=>{requireCurrent();await this.adapter.enterProgramRaw();requireCurrent();await this.adapter.initializeLearned?.({confirmationEpoch:actual.epoch});requireCurrent();}});
            requireCurrent();
          };
          this.checkedEpoch=epoch;
          // A lost completion ACK or a newer App target cannot turn a completed
          // historical installation into another write. Confirm its full identity first.
          if(!duringUpgrade&&info.imageValid&&!sameTarget(info,pkg)&&binding?.pending&&binding.uid===actual.uid&&sameTarget(info,binding.pending))await confirmPendingTarget(binding.pending);
          if(info.imageValid&&sameTarget(info,pkg)){
            if(binding?.pending&&binding.uid===actual.uid&&!duringUpgrade)await confirmPendingTarget(pkg);
            this.set({...common,phase:'ready',ready:true,canUpgrade:false,code:'READY',message:'主控固件已匹配，可以学习和运行。'});return true;
          }
          const repair=!info.imageValid;
          const message=repair?'主控镜像状态无效，需要修复到本 App 对应固件。确认后将先核对实际引导能力。':
            info.version>pkg.version?'主控当前版本高于本 App 对应版本。确认后将安装本 App 内置固件，并先核对引导程序是否兼容。':
            info.version===pkg.version?'主控版本号相同，但镜像内容或布局与本 App 不一致。确认后将重新写入本 App 内置固件，并先核对引导程序是否兼容。':
            '主控固件需要更新到本 App 对应版本。确认后将先核对实际引导能力，完成后可继续编程。';
          this.set({...common,phase:'update-required',canUpgrade:true,prompt:show(),code:repair?'REPAIR_REQUIRED':'UPDATE_REQUIRED',message});return false;
        }catch(e){
          if(!this.disposed&&token===this.generation&&this.live()?.epoch===epoch){const blocked=bootBlocked(e.code),confirmationOnly=!blocked&&(confirmingInstalled||this.confirmationPending());this.checkedEpoch=epoch;this.set({phase:blocked?'boot-update-required':confirmationOnly?'unconfirmed':'unknown',confirmationOnly,ready:false,busy:duringUpgrade,prompt:interactive||this.programRequested,canUpgrade:false,code:e.result===2?'UNSUPPORTED':e.code||'QUERY',...(blocked?{actual,currentVersion:actual?.info?.version??null}:{}),message:confirmationOnly?'主控镜像或启动状态尚未确认。请重试确认，不会重新刷写。 '+e.message:e.result===2?'此固件没有蓝牙升级能力，需先安装新版 Boot 与主控固件。':e.message});}
          return false;
        }finally{if(this.checkPromise===pending)this.checkPromise=null;if(this.checkController===controller)this.checkController=null;}
      })();
      this.checkPromise=pending;return pending;
    }
    async retry({interactive=true}={}){
      if(this.upgradeOwned)return false;
      this.cancelled=false;
      if(!this.live()?.epoch){await this.onProgramRequested({interactive});if(interactive)this.set({prompt:true});if(interactive&&this.confirmationPending())return this.confirmUpgrade();return false;}
      const token=this.generation,entry=this.entry,epoch=this.epoch;
      const current=()=>!this.disposed&&!this.cancelled&&token===this.generation&&entry===this.entry&&this.live()?.epoch===epoch;
      try{if(!this.confirmationPending())await this.adapter.enterProgramRaw?.();}catch(e){if(current())this.set({phase:'unknown',ready:false,busy:false,prompt:interactive,canUpgrade:false,message:e.message,code:e.code||'MODE'});return false;}
      if(!current())return false;
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
      if(this.upgradePreflightPromise)return this.upgradePreflightPromise;
      // User consent to update first upgrades lightweight version evidence to
      // the original complete App/UID identity. It never enters Boot on its own.
      if(this.state.checkKind==='program-version'&&!this.bindingPending()&&this.state.canUpgrade&&this.state.prompt){
        const token=this.generation,entry=this.entry,epoch=this.epoch;
        const pending=(async()=>{
          await this.check({force:true,interactive:true,full:true});
          if(this.disposed||this.cancelled||token!==this.generation||entry!==this.entry||this.live()?.epoch!==epoch)throw fail('STALE','升级前连接或确认已变化。');
          if(this.snapshot().ready)return{state:'current'};
          if(!this.state.canUpgrade||!this.state.actual?.uid)throw fail('IDENTITY',this.state.message||'未取得完整主机身份，不能升级。');
          if(this.upgradePreflightPromise===pending)this.upgradePreflightPromise=null;
          return this.confirmUpgrade();
        })().finally(()=>{if(this.upgradePreflightPromise===pending)this.upgradePreflightPromise=null;});
        this.upgradePreflightPromise=pending;return pending;
      }
      if(bootBlocked(this.state.code))return Promise.reject(fail(this.state.code,this.state.message));
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
      this.checkPromise=null;this.abortCheck('已切换到用户确认的固件更新任务。');
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
          if(!this.disposed){const blocked=bootBlocked(e.code),recover=this.bindingPending(),confirmationOnly=!blocked&&Boolean(recover&&(this.consent?.confirmationOnly||this.session.state.written||this.session.binding.written&&sameTarget(this.session.binding.pending,this.bundle?.pkg)));this.set({phase:blocked?'boot-update-required':confirmationOnly?'unconfirmed':recover&&!blocked?'recovery':'unknown',confirmationOnly,ready:false,busy:false,prompt:!this.cancelled,canUpgrade:recover&&!confirmationOnly&&!blocked,code:e.code||'UPGRADE',message:this.cancelled?confirmationOnly?'启动确认已停止，可稍后重试确认，不重新刷写。':'升级已停止，可在编程界面重新确认恢复。':e.message});}
          throw e;
        }finally{this.upgradeOwned=false;if(this.upgradePromise===pending)this.upgradePromise=null;}
      })();
      this.upgradePromise=pending;return pending;
    }
    async cancel({background=false,reason='已取消升级'}={}){
      if(this.disposed)return;this.cancelled=true;this.state.prompt=false;this.activePromptKey=null;
      if(this.upgradeOwned){await this.session.cancel({background});this.set({ready:false,prompt:false,message:reason});return;}
      if(this.checkPromise){const confirmationOnly=this.confirmationPending();this.generation++;this.checkPromise=null;this.abortCheck(reason);this.checkedEpoch=this.epoch;this.set({phase:confirmationOnly?'unconfirmed':'unknown',confirmationOnly,ready:false,busy:false,prompt:false,canUpgrade:false,code:'CANCELLED',message:'已停止核对，可继续编辑。学习或运行前需重新核对。'});return;}
      this.set({prompt:false});
    }
    leaveProgram(reason='已离开编程界面。'){
      this.programRequested=false;this.entry++;this.generation++;this.checkPromise=null;this.abortCheck(reason);this.state.prompt=false;this.activePromptKey=null;
      if(this.upgradeOwned){this.cancel({background:true,reason}).catch(()=>{});return;}
      this.state.busy=false;if(this.state.checkKind==='program-version')this.state.ready=false;this.emit();
    }
    disconnected(epoch,{owned=false}={}){
      if(this.disposed||epoch&&this.epoch&&epoch!==this.epoch)return;
      // A native transport event is not user cancellation. The owning Session
      // distinguishes a bounded Boot reconnect from a failed DATA transfer.
      if(this.upgradeOwned){this.epoch=null;this.checkedEpoch=null;this.state.ready=false;return;}
      this.epoch=null;this.checkedEpoch=null;this.programCache=null;this.checkPromise=null;this.generation++;this.abortCheck('蓝牙已断开，已停止主控核对。');this.state.ready=false;
      const recovery=this.bindingPending(),prompt=Boolean(recovery&&this.programRequested&&!this.cancelled);
      const confirmationOnly=this.confirmationPending();
      this.set({phase:confirmationOnly?'unconfirmed':recovery?'recovery':'unknown',confirmationOnly,ready:false,busy:false,prompt,canUpgrade:recovery&&!confirmationOnly,code:'DISCONNECTED',actual:null,currentVersion:null,message:confirmationOnly?'固件已写入，连接已断开。请重试确认启动状态，不重新刷写。':recovery?'升级连接已断开。请保持原主机供电，点确定后检查并恢复更新。':'设备已断开，可继续编辑作品。'});
    }
    async dispose(){if(this.disposed)return;await this.cancel({background:true});this.disposed=true;this.generation++;this.abortCheck('设备会话已关闭。');await this.session.dispose();this.listeners?.clear();}
  }
  return{Gate,parseVersionEvent,TARGET_EVENT,sameTarget};
});
