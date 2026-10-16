// Whole-page transitions only. Popup dialogs and palette/tab changes are untouched.
(() => {
  let active=null,pending=null;
  const retired=[];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const base=()=>document.body.classList.contains('home-open')?document.querySelector('.home-screen'):document.querySelector('.app');
  function run(from,to,update=()=>{},complete=()=>{},direction=1){
    return new Promise(resolve=>{
      const request={from,to,update,complete,direction,resolve};
      if(active){
        if(pending){retired.push(pending.complete);pending.resolve(false);}
        pending=request;
      }else start(request);
    });
  }
  function start(request){
    const {from,to,update,complete,direction,resolve}=request;
    if(!from||!to||from===to||document.hidden||reduced.matches){update();complete();resolve(true);drain();return;}
    const surfaces=[from,to];
    surfaces.forEach(el=>el.classList.add('page-transition-surface'));
    from.classList.add('page-transition-out');to.classList.add('page-transition-in');
    document.body.classList.add('page-transition-running');
    let animations=[],timer;
    let done=false;
    function finish(ok=true){
      if(done)return;done=true;clearTimeout(timer);
      animations.forEach(a=>a.cancel());
      surfaces.forEach(el=>el.classList.remove('page-transition-surface','page-transition-out','page-transition-in'));
      document.body.classList.remove('page-transition-running');
      active=null;complete();resolve(ok);drain();
    }
    active={finish,to};
    try{
      update();
      animations=[
        from.animate([{transform:'translate3d(0,0,0)'},{transform:`translate3d(${-direction*100}%,0,0)`}],{duration:300,easing:'ease-in-out',fill:'both'}),
        to.animate([{transform:`translate3d(${direction*100}%,0,0)`},{transform:'translate3d(0,0,0)'}],{duration:280,easing:'ease',fill:'both'})
      ];
      Promise.all(animations.map(a=>a.finished)).then(()=>finish(),()=>finish(false));
      timer=setTimeout(finish,420); // Also clean up if the WebView drops animation events.
    }catch(error){finish(false);console.error(error);}
  }
  function drain(){retired.splice(0).forEach(complete=>complete());if(pending){const next=pending;pending=null;start(next);}}
  function settle(){if(pending){retired.push(pending.complete);pending.resolve(false);pending=null;}if(active)active.finish(false);else drain();}
  function idle(){return new Promise(resolve=>{const check=()=>active||pending?setTimeout(check,20):resolve();check();});}
  function bindDialog(dialog,{beforeClose=()=>{},surface=base,onCancel=()=>dialog.close()}={}){
    dialog.classList.add('page-dialog');
    let closing=null;
    dialog.showModal=function(){
      if(dialog.open)return Promise.resolve(false);
      const from=surface();
      return run(from,dialog,()=>HTMLDialogElement.prototype.showModal.call(dialog));
    };
    dialog.close=function(value){
      beforeClose();
      if(closing)return closing;
      if(!dialog.open)return Promise.resolve(false);
      const closeNow=()=>{if(dialog.open)HTMLDialogElement.prototype.close.call(dialog,value);};
      // Bluetooth routing, model changes and background suspension keep their existing immediate semantics.
      if(location.hash==='#bluetooth'||document.hidden||window.CardModelSession?.switching){settle();closeNow();return Promise.resolve(true);}
      closing=run(dialog,surface(),()=>{},closeNow,-1).finally(()=>{closing=null;});return closing;
    };
    dialog.addEventListener('cancel',event=>{event.preventDefault();onCancel();});
  }
  // Avoid duplicate actions while two full pages are on screen. Return remains available.
  for(const type of ['click','pointerdown','keydown'])document.addEventListener(type,event=>{
    if(!active)return;
    if(event.target.closest?.('#homeBtn,.remote-back,.building-loading-back')||event.key==='Escape')return;
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)settle();});
  window.addEventListener('resize',settle);
  window.addEventListener('card-bluetooth-route',settle);
  window.CardPageTransition={run,bindDialog,idle,settle,get busy(){return !!active||!!pending;}};
})();
