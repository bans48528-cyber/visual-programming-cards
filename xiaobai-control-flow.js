/* Shared single/multi loop semantics. Device observers own sampling and latches. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.XiaobaiControlFlow=api;
})(globalThis,function(){
  'use strict';
  const LOOP_IDS=Object.freeze(['loop','loop-count','loop-infrared','loop-tilt','loop-time']);
  const CONDITIONAL_IDS=Object.freeze(['loop-infrared','loop-tilt','loop-time']);
  const loops=new Set(LOOP_IDS),conditional=new Set(CONDITIONAL_IDS);
  const directions=new Set(['forward','backward','left','right']);
  const unbounded=new Set(['loop','infrared-wait','tilt-wait','motion-wait','speech-wait','self-learned-wait','loop-infrared','loop-tilt']);
  const isLoop=item=>loops.has(typeof item==='string'?item:item?.id);
  const isConditionalLoop=item=>conditional.has(typeof item==='string'?item:item?.id);
  function failure(message,code,item,path){
    return Object.assign(new Error(message),{code,path:path.slice(),blockUid:item?.uid});
  }
  function validateLoop(item,path=[]){
    const p=item.params||{};
    if(!Array.isArray(item.children)||!item.children.length)throw failure('请在循环中放入积木。','LOOP_EMPTY',item,path);
    if(item.id==='loop-count'&&(!Number.isInteger(p.count)||p.count<1||p.count>1000000))throw failure('循环次数无效。','LOOP_PARAMETER',item,path);
    if(item.id==='loop-time'&&(!Number.isFinite(p.duration)||p.duration<0||p.duration>86400))throw failure('时间条件须在 0 至 86400 秒之间。','LOOP_PARAMETER',item,path);
    if(item.id==='loop-infrared'&&(!['greater','less'].includes(p.comparison)||!Number.isInteger(p.threshold)||p.threshold<0||p.threshold>100))throw failure('红外循环条件无效，请选择严格大于或小于阈值。','LOOP_PARAMETER',item,path);
    if(item.id==='loop-tilt'&&!directions.has(p.direction))throw failure('倾倒循环条件无效，请选择向前、向后、向左或向右。','LOOP_PARAMETER',item,path);
  }
  function validateLoops(items,{maxDepth=20,maxObservers=4}={}){
    if(!Number.isInteger(maxDepth)||maxDepth<1||!Number.isInteger(maxObservers)||maxObservers<0)throw new Error('循环预检限制无效。');
    const result={maxDepth:0,maxObserverDepth:0,observerLoops:0};
    function visit(sequence,path,depth,observerDepth,ancestors){
      if(!Array.isArray(sequence))throw failure('程序结构无效。','STRUCTURE',null,path);
      for(let index=0;index<sequence.length;index++){
        const item=sequence[index],current=[...path,index];
        if(!item||typeof item!=='object'||Array.isArray(item)||ancestors.has(item))throw failure('程序结构无效或包含环。','STRUCTURE',item,current);
        if(!isLoop(item)){
          if(item.children!==undefined)throw failure('只有循环积木可以包含内部积木。','STRUCTURE',item,current);
          continue;
        }
        validateLoop(item,current);
        const nextDepth=depth+1,nextObservers=observerDepth+(isConditionalLoop(item)?1:0);
        if(nextDepth>maxDepth)throw failure(`程序最多支持 ${maxDepth} 层控制嵌套。`,'LOOP_DEPTH',item,current);
        if(nextObservers>maxObservers)throw failure(`每组最多同时启用 ${maxObservers} 层条件循环，请减少嵌套后再运行。`,'OBSERVER_LIMIT',item,current);
        result.maxDepth=Math.max(result.maxDepth,nextDepth);
        result.maxObserverDepth=Math.max(result.maxObserverDepth,nextObservers);
        if(isConditionalLoop(item))result.observerLoops++;
        const nextAncestors=new Set(ancestors);nextAncestors.add(item);
        visit(item.children,current,nextDepth,nextObservers,nextAncestors);
      }
    }
    visit(items,[],0,0,new Set());return result;
  }
  function warnings(items){
    const result=[];
    function visit(sequence,path,ancestors){
      const causes=[];
      if(!Array.isArray(sequence))return causes;
      sequence.forEach((item,index)=>{
        if(!item||typeof item!=='object'||ancestors.has(item))return;
        const current=[...path,index],next=new Set(ancestors);next.add(item);
        const nested=visit(item.children,current,next);
        if(isConditionalLoop(item)&&nested.length)result.push({
          code:'ROUND_MAY_NOT_FINISH',path:current,blockUid:item.uid,causes:nested,
          message:'条件满足后仍需完成本轮全部积木；内部的一直循环或未结束的等待可能使本轮无法结束。'
        });
        if(unbounded.has(item.id))causes.push({id:item.id,path:current,blockUid:item.uid});
        causes.push(...nested);
      });
      return causes;
    }
    visit(items,[],new Set());return result;
  }
  async function runLoop(item,body,hooks){
    if(!isLoop(item))throw failure('这不是可执行的循环积木。','LOOP_KIND',item,[]);
    validateLoop(item);
    if(typeof body!=='function'||typeof hooks?.check!=='function'||typeof hooks.delay!=='function')throw new Error('循环执行接口无效。');
    let handle=null,rounds=0,latched=false;
    const check=()=>{hooks.check();handle?.check?.();};
    function matched(){
      check();const value=handle.matched;
      if(typeof value!=='boolean')throw failure('设备未返回有效的条件观察状态。','OBSERVER_STATE',item,[]);
      latched=latched||value;return latched;
    }
    function closeAfterFailure(error){
      if(!handle||typeof handle.close!=='function')return;
      // STOP/fault cancellation must not wait for another radio acknowledgement.
      // The adapter retires this handle locally and may send a guarded best-effort
      // CLOSE. Catch both sync/async cleanup failures without masking the cause.
      try{Promise.resolve(handle.close({cancelled:true})).catch(()=>{});}catch(cleanupError){
        try{error.cleanupError=cleanupError;}catch(_){}
      }
    }
    try{
      check();
      if(isConditionalLoop(item)){
        if(typeof hooks.observe!=='function')throw failure('设备未提供条件观察功能，请更新小白主控固件。','OBSERVER_UNSUPPORTED',item,[]);
        // This includes TIME: no phone deadline, sampling, or simulated latch.
        // observe resolves only after the device's authoritative initial state.
        handle=await hooks.observe(item);check();
        if(!handle||typeof handle.refresh!=='function'||typeof handle.close!=='function')throw failure('设备条件观察接口无效。','OBSERVER_UNSUPPORTED',item,[]);
        while(!matched()){
          check();await body(rounds);rounds++;check();
          // A condition never breaks a body midway, including nested loops/waits.
          // QUERY reconciles the independently sampled/latching device observer.
          if(matched())break;
          await handle.refresh();check();if(matched())break;
          await hooks.delay(10);check();
        }
        check();await handle.close({cancelled:false});handle=null;check();
        return {rounds,matched:true};
      }
      const count=item.id==='loop-count'?item.params.count:Infinity;
      while(rounds<count){
        check();await body(rounds);rounds++;check();
        if(rounds<count){await hooks.delay(10);check();}
      }
      return {rounds,matched:false};
    }catch(error){closeAfterFailure(error);throw error;}
  }
  return {LOOP_IDS,CONDITIONAL_IDS,isLoop,isConditionalLoop,isObserverLoop:isConditionalLoop,validateLoops,warnings,runLoop};
});
