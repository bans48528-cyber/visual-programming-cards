(() => {
 const books=CardBuildingBooks;
 const modal=document.createElement('dialog');modal.className='building-viewer';modal.innerHTML='<iframe title="搭建图查看器"></iframe><div class="building-loading"><button class="building-loading-back" type="button">‹ 返回图册</button><span class="building-loading-spinner"></span><p role="status">正在加载搭建图…</p></div>';document.body.append(modal);
 CardPageTransition.bindDialog(modal,{surface:()=>books.isOpen?books.element:document.querySelector('.home-screen'),onCancel:()=>back()});
 const loading=modal.querySelector('.building-loading'),frame=modal.querySelector('iframe');
 modal.querySelector('.building-loading-back').onclick=()=>closeViewer();
 let catalogPromise,bookConfigPromise,viewerTicket=0,listTicket=0,visit=null,opening=false,listOwner=null;
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
 function closeViewer(immediate=false){viewerTicket++;visit=null;opening=false;stopPreload();if(immediate){CardPageTransition.settle();if(modal.open)HTMLDialogElement.prototype.close.call(modal);frame.removeAttribute('src');}else if(modal.open)modal.close();else frame.removeAttribute('src');}
 function close(){listTicket++;listOwner=null;closeViewer(true);books.close({immediate:true});}
 modal.addEventListener('close',()=>{if(!modal.open)frame.removeAttribute('src');});
 function back(){if(modal.open){if(!loading.hidden)closeViewer();else frame.contentWindow?.postMessage({source:'building-host',type:'back'},location.origin);return true;}if(opening){closeViewer();return true;}return books.back();}
 window.addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin||e.data?.source!=='building-viewer'||e.data.visit!==visit||!modal.open)return;if(e.data.type==='close')closeViewer();else if(e.data.type==='ready')loading.hidden=true;else if(e.data.type==='error'){loading.querySelector('p').textContent=e.data.message||'模型加载失败，请返回重试';loading.querySelector('.building-loading-spinner').hidden=true;}});
 async function open(model,entry){if(modal.open||opening||CardModelSession.current.id!==model.id)return;opening=true;const turn=++viewerTicket,scope=CardModelSession.capture(),bookCurrent=books.capture();try{
  clearTimeout(preloadTimer);await window.CardProgram?.stop();if(turn!==viewerTicket||!scope.isCurrent()||!bookCurrent())return;
  visit=String(turn);loading.hidden=false;loading.querySelector('p').textContent='正在加载搭建图…';loading.querySelector('.building-loading-spinner').hidden=false;
  await modal.showModal();if(turn!==viewerTicket||!scope.isCurrent()||!modal.open)return;
  if(document.hidden){closeViewer(true);return;}
  await prepare(model,entry);if(turn!==viewerTicket||!scope.isCurrent()||!modal.open)return;
  frame.src='viewer/open.html?device='+encodeURIComponent(model.id)+'&id='+encodeURIComponent(entry.id)+'&visit='+encodeURIComponent(visit);
 }catch(e){if(turn===viewerTicket&&scope.isCurrent()&&e.name!=='AbortError'){loading.querySelector('p').textContent=e.message;loading.querySelector('.building-loading-spinner').hidden=true;}}finally{if(turn===viewerTicket)opening=false;}}
 async function render(home,model){
  const grid=home.querySelector('.home-grid');
  // Home re-renders on rotation. The same shelf must not cancel a viewer or lose its book.
  if(listOwner?.model===model.id&&listOwner.grid===grid&&grid.firstElementChild===listOwner.content)return;
  const turn=++listTicket;stopPreload();const empty=home.querySelector('.home-empty');grid.replaceChildren();empty.hidden=true;home.querySelector('.home-section-heading h2').textContent='搭建图册';const count=home.querySelector('.home-section-heading span');count.textContent='正在读取…';
  try{const [all,config]=await Promise.all([catalog(),bookConfig()]);if(turn!==listTicket||CardModelSession.current.id!==model.id)return;const entries=all[model.id]||[],albums=books.booksFor(model,entries,config);count.textContent=albums.length+' 本图册 · '+albums.reduce((total,book)=>total+book.pages.length,0)+' 页';
   if(!albums.length){const message=document.createElement('p');message.className='building-empty';message.textContent='暂无搭建图';grid.append(message);}else books.mount(grid,model,albums,open);
   listOwner={model:model.id,grid,content:grid.firstElementChild};
   // Warm only one existing prepared model after the shelf and route transition have painted.
   if(entries.length)preloadTimer=setTimeout(async()=>{await CardPageTransition.idle();if(turn===listTicket&&CardModelSession.current.id===model.id&&!document.hidden&&!modal.open&&!opening)prepare(model,albums[0].pages[0]).catch(()=>{});},200);
  }catch(e){if(turn!==listTicket)return;count.textContent='';const p=document.createElement('p');p.className='building-empty';p.textContent=e.message;grid.append(p);}
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden){if(modal.open&&!loading.hidden)closeViewer(true);else stopPreload();}});
 window.CardBuildings={render,close,back,cancel:()=>{if(listOwner||books.isOpen||modal.open||opening)close();else{listTicket++;stopPreload();}}};
})();
