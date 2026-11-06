(() => {
 const books=CardBuildingBooks;
 const modal=document.createElement('dialog');modal.className='building-viewer';modal.innerHTML='<iframe title="搭建图查看器"></iframe><div class="building-loading"><button class="building-loading-back" type="button">‹ 返回图册</button><span class="building-loading-spinner" aria-hidden="true"><span class="building-loading-grid"><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span><span class="building-loading-dot"></span></span></span><p role="status">正在加载搭建图…</p></div>';document.body.append(modal);
 CardPageTransition.bindDialog(modal,{surface:()=>books.isOpen?books.element:document.querySelector('.home-screen'),onCancel:()=>back()});
 const loading=modal.querySelector('.building-loading'),frame=modal.querySelector('iframe');
 modal.querySelector('.building-loading-back').onclick=()=>closeViewer();
 let catalogPromise,bookConfigPromise,viewerTicket=0,listTicket=0,visit=null,opening=false,listOwner=null,viewerOwner=null,pendingRestore=null,programOpening=null;
 let preloadTimer,preloadJob;
 function stopPreload(){clearTimeout(preloadTimer);preloadJob?.controller.abort();preloadJob=null;}
 function prepare(model,entry){
  if(!entry.prepared)return Promise.resolve();
  const key=model.id+'/'+entry.id+'/'+entry.prepared.version;
  if(preloadJob?.key===key&&!preloadJob.controller.signal.aborted)return preloadJob.promise;
  stopPreload();const controller=new AbortController();
  const promise=import('./viewer/app/prepared-model.js').then(m=>m.prepareModel(model.id,entry,{signal:controller.signal})).then(()=>{});
  preloadJob={key,controller,promise};promise.catch(()=>{if(preloadJob?.promise===promise)preloadJob=null;});return promise;
 }
 const catalog=()=>catalogPromise||(catalogPromise=fetch('building-catalog.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('搭建图列表暂不可用');return r.json();}).catch(e=>{catalogPromise=null;throw e;}));
 const bookConfig=()=>bookConfigPromise||(bookConfigPromise=fetch('building-books.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('图册列表暂不可用');return r.json();}).catch(e=>{bookConfigPromise=null;throw e;}));
 function closeViewer(immediate=false){
  if(viewerOwner?.completing){viewerOwner.cancelled=true;window.CardCompanionPrograms?.cancel();}
  pendingRestore=viewerOwner?.restoreOnClose||pendingRestore;
  viewerTicket++;visit=null;opening=false;viewerOwner=null;stopPreload();
  if(immediate){CardPageTransition.settle();if(modal.open)HTMLDialogElement.prototype.close.call(modal);frame.removeAttribute('src');}
  else if(modal.open)return modal.close();else frame.removeAttribute('src');
 }
 async function complete(){
  const owner=viewerOwner;if(!owner||owner.completing)return;
  if(!owner.entry.companionProgram){closeViewer();return;}
  owner.completing=true;const ticket=viewerTicket;let restore=null,started=false;
  try{
   loading.hidden=false;loading.querySelector('p').textContent='正在打开配套程序…';loading.querySelector('.building-loading-spinner').hidden=false;
   const template=await CardCompanionCatalog.get(owner.entry.companionProgram,owner.model.id);
   if(ticket!==viewerTicket||viewerOwner!==owner||!owner.scope.isCurrent()||!modal.open)return;
   restore=books.suspend();
   started=await CardCompanionPrograms.open({...template,onReturn:restore});
   if(ticket!==viewerTicket||owner.cancelled||!owner.scope.isCurrent())return;
   owner.completing=false;
   if(started)closeViewer(true);
   else closeViewer();
  }catch(error){
   if(ticket===viewerTicket&&owner.scope.isCurrent()&&modal.open){loading.querySelector('p').textContent=error.message||'配套程序打开失败，请返回重试';loading.querySelector('.building-loading-spinner').hidden=true;}
  }finally{
   owner.completing=false;
   if(!started&&restore&&owner.scope.isCurrent()){
    await CardPageTransition.idle();
    if(modal.open&&viewerOwner===owner)owner.restoreOnClose=restore;
    else if(!modal.open)await restore();
   }
  }
 }
 function close(){programOpening=null;listTicket++;listOwner=null;pendingRestore=null;if(viewerOwner)viewerOwner.restoreOnClose=null;closeViewer(true);books.close({immediate:true});}
 modal.addEventListener('close',()=>{if(!modal.open){frame.removeAttribute('src');const restore=pendingRestore;pendingRestore=null;restore?.();}});
 function back(){if(modal.open){if(!loading.hidden)closeViewer();else frame.contentWindow?.postMessage({source:'building-host',type:'back'},location.origin);return true;}if(opening){closeViewer();return true;}return books.back();}
 window.addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin||e.data?.source!=='building-viewer'||e.data.visit!==visit||!modal.open)return;if(e.data.type==='close')closeViewer();else if(e.data.type==='complete')complete();else if(e.data.type==='ready')loading.hidden=true;else if(e.data.type==='error'){loading.querySelector('p').textContent=e.data.message||'模型加载失败，请返回重试';loading.querySelector('.building-loading-spinner').hidden=true;}});
 async function open(model,entry){if(modal.open||opening||programOpening||CardModelSession.current.id!==model.id)return;opening=true;const turn=++viewerTicket,scope=CardModelSession.capture(),bookCurrent=books.capture();try{
  clearTimeout(preloadTimer);await window.CardProgram?.stop();if(turn!==viewerTicket||!scope.isCurrent()||!bookCurrent())return;
  viewerOwner={model,entry,scope,completing:false,cancelled:false};visit=String(turn);loading.hidden=false;loading.querySelector('p').textContent='正在加载搭建图…';loading.querySelector('.building-loading-spinner').hidden=false;
  await modal.showModal();if(turn!==viewerTicket||!scope.isCurrent()||!modal.open)return;
  if(document.hidden){closeViewer(true);return;}
  await prepare(model,entry);if(turn!==viewerTicket||!scope.isCurrent()||!modal.open)return;
  frame.src='viewer/open.html?device='+encodeURIComponent(model.id)+'&id='+encodeURIComponent(entry.id)+'&visit='+encodeURIComponent(visit);
 }catch(e){if(turn===viewerTicket&&scope.isCurrent()&&e.name!=='AbortError'){loading.querySelector('p').textContent=e.message;loading.querySelector('.building-loading-spinner').hidden=true;}}finally{if(turn===viewerTicket)opening=false;}}
 // Keep the album visible while stopping a program/loading metadata. Suspend only at the editor handoff.
 async function openProgram(model,entry){
  if(programOpening||modal.open||opening||!entry.companionProgram||CardModelSession.current.id!==model.id)return;
  const owner={},scope=CardModelSession.capture(),bookCurrent=books.capture();programOpening=owner;let restore=null,started=false;
  const current=()=>programOpening===owner&&scope.isCurrent()&&bookCurrent()&&location.hash==='#home'&&!document.hidden;
  try{
   stopPreload();const template=await CardCompanionCatalog.get(entry.companionProgram,model.id);if(!current())return;
   started=await CardCompanionPrograms.open({...template,onReturn:()=>restore?.(),beforeOpen:()=>{
    if(!current())return false;restore=books.suspend();return Boolean(restore);
   }});
  }catch(error){if(scope.isCurrent()&&(bookCurrent()||restore))throw error;}
  finally{
   if(programOpening===owner)programOpening=null;
   if(!started&&restore&&scope.isCurrent()&&location.hash==='#home'){await CardPageTransition.idle();await restore();}
  }
 }
 async function render(home,model){
  const grid=home.querySelector('.home-grid');
  // Home re-renders on rotation. The same shelf must not cancel a viewer or lose its book.
  if(listOwner?.model===model.id&&listOwner.grid===grid&&grid.firstElementChild===listOwner.content)return;
  const turn=++listTicket;stopPreload();const empty=home.querySelector('.home-empty');grid.replaceChildren();empty.hidden=true;home.querySelector('.home-section-heading h2').textContent='搭建图册';const count=home.querySelector('.home-section-heading span');count.textContent='正在读取…';
  try{const [all,config]=await Promise.all([catalog(),bookConfig()]);if(turn!==listTicket||CardModelSession.current.id!==model.id)return;const entries=all[model.id]||[],albums=books.booksFor(model,entries,config);count.textContent=albums.length+' 本图册 · '+albums.reduce((total,book)=>total+book.pages.length,0)+' 页';
   if(!albums.length){const message=document.createElement('p');message.className='building-empty';message.textContent='暂无搭建图';grid.append(message);}else books.mount(grid,model,albums,open,openProgram);
   listOwner={model:model.id,grid,content:grid.firstElementChild};
   // Warm only one existing prepared model after the shelf and route transition have painted.
   if(entries.length)preloadTimer=setTimeout(async()=>{await CardPageTransition.idle();if(turn===listTicket&&CardModelSession.current.id===model.id&&!document.hidden&&!modal.open&&!opening)prepare(model,albums[0].pages[0]).catch(()=>{});},200);
  }catch(e){if(turn!==listTicket)return;count.textContent='';const p=document.createElement('p');p.className='building-empty';p.textContent=e.message;grid.append(p);}
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden){if(modal.open&&!loading.hidden)closeViewer(true);else stopPreload();}});
 window.CardBuildings={render,close,back,cancel:()=>{if(listOwner||books.isOpen||modal.open||opening)close();else{listTicket++;stopPreload();}}};
})();
