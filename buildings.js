(() => {
 const modal=document.createElement('dialog');modal.className='building-viewer';modal.innerHTML='<iframe title="搭建图查看器"></iframe>';document.body.append(modal);
 const frame=modal.querySelector('iframe');let catalogPromise,ticket=0;
 let preloadTimer,preloadJob;
 function stopPreload(){clearTimeout(preloadTimer);preloadJob?.controller.abort();preloadJob=null;}
 function prepare(model,entry){
  if(!entry.prepared)return Promise.resolve();
  const key=model.id+'/'+entry.id+'/'+entry.prepared.version;
  if(preloadJob?.key===key&&!preloadJob.controller.signal.aborted)return preloadJob.promise;
  stopPreload();const controller=new AbortController();
  const promise=import('./viewer/app/prepared-model.js').then(m=>m.prepareModel(model.id,entry,{signal:controller.signal})).then(()=>{});
  preloadJob={key,controller,promise};
  promise.catch(()=>{if(preloadJob?.promise===promise)preloadJob=null;});
  return promise;
 }
 const catalog=()=>catalogPromise||(catalogPromise=fetch('building-catalog.json').then(r=>{if(!r.ok)throw Error('搭建图列表暂不可用');return r.json();}).catch(e=>{catalogPromise=null;throw e;}));
 function close(){ticket++;stopPreload();if(modal.open)modal.close();frame.removeAttribute('src');}
 modal.addEventListener('cancel',e=>{e.preventDefault();back();});modal.addEventListener('close',()=>{if(!modal.open)frame.removeAttribute('src');});
 function back(){if(!modal.open)return false;frame.contentWindow?.postMessage({source:'building-host',type:'back'},location.origin);return true;}
 window.addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin||e.data?.source!=='building-viewer')return;if(e.data.type==='close')close();});
 async function open(model,entry){const turn=++ticket,scope=CardModelSession.capture();try{clearTimeout(preloadTimer);await window.CardProgram?.stop();if(turn!==ticket||!scope.isCurrent())return;await prepare(model,entry);if(turn!==ticket||!scope.isCurrent())return;frame.src='viewer/open.html?device='+encodeURIComponent(model.id)+'&id='+encodeURIComponent(entry.id);modal.showModal();}catch(e){if(turn===ticket&&scope.isCurrent()&&e.name!=='AbortError')window.showExecutionNotice?.(e.message);}}
 async function render(home,model){stopPreload();const turn=++ticket,grid=home.querySelector('.home-grid'),empty=home.querySelector('.home-empty');grid.replaceChildren();empty.hidden=true;home.querySelector('.home-section-heading h2').textContent='搭建图';const count=home.querySelector('.home-section-heading span');count.textContent='正在读取…';
 try{const all=await catalog();if(turn!==ticket||CardModelSession.current.id!==model.id)return;const entries=all[model.id]||[];count.textContent=entries.length+' 份搭建图';if(!entries.length){const message=document.createElement('p');message.className='building-empty';message.textContent='暂无搭建图';grid.append(message);return;}
 for(const entry of entries){const button=document.createElement('button');button.className='building-card';const img=document.createElement('img');img.src=entry.cover||model.image;img.alt='';const title=document.createElement('strong');title.textContent=entry.name;button.append(img,title);if(entry.description){const p=document.createElement('p');p.textContent=entry.description;button.append(p);}button.onclick=()=>open(model,entry);grid.append(button);}
 // Let the list paint first; only warm one model, without a renderer or iframe.
 preloadTimer=setTimeout(()=>{if(turn===ticket&&CardModelSession.current.id===model.id&&!document.hidden)prepare(model,entries[0]).catch(()=>{});},200);
 }catch(e){if(turn!==ticket)return;count.textContent='';const p=document.createElement('p');p.className='building-empty';p.textContent=e.message;grid.append(p);}}
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPreload();});
 window.CardBuildings={render,close,back,cancel:()=>{ticket++;stopPreload();}};
})();
