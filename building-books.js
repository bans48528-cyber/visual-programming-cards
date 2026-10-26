// Book presentation only. Catalog ownership, prepared models and viewer live in buildings.js.
(() => {
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const arrow='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
 const reader=document.createElement('dialog');reader.id='buildingBooksReader';reader.className='building-books-reader';reader.setAttribute('aria-labelledby','bb-reader-title');
 reader.innerHTML=`<div class="reader-layout"><header class="reader-header"><div class="reader-series"><span class="series-mark" id="bb-series-mark"></span><span id="bb-reader-title"></span></div><button type="button" class="close-reader" id="bb-close-reader" aria-label="合上图册，返回书架">收起图册<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="book-shell" id="bb-book-shell" aria-label="造型图册，可左右滑动翻页"><div class="spread" id="bb-spread"></div><div class="book-gutter" aria-hidden="true"></div><div class="book-ribbon" aria-hidden="true"></div></div><nav class="reader-controls" aria-label="翻页和快速定位"><button type="button" class="page-arrow" id="bb-prev-page" aria-label="上一页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><div class="page-scrubber"><div class="page-info"><span id="bb-page-name"></span><span class="page-number"><strong id="bb-current-page"></strong><span>/</span><span id="bb-total-pages"></span></span></div><label class="sr-only" for="bb-page-range">拖动选择页码</label><input id="bb-page-range" type="range" min="1" max="1" value="1" step="1"></div><button type="button" class="page-arrow" id="bb-next-page" aria-label="下一页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg></button></nav><p id="bb-reader-announcement" class="sr-only" aria-live="polite"></p></div>`;
 document.body.append(reader);
 const $=id=>reader.querySelector('#bb-'+id),shell=$('book-shell'),spread=$('spread'),range=$('page-range'),prev=$('prev-page'),next=$('next-page');
 const memory=new Map(),animations=new Set(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 // The same sheet is reattached for each turn; cached page nodes move between its faces and the spread.
 const turnSheet=document.createElement('div');turnSheet.className='turning-sheet';turnSheet.setAttribute('aria-hidden','true');
 turnSheet.innerHTML='<div class="sheet-face front"></div><div class="sheet-face back"></div>';
 const sheetFront=turnSheet.firstElementChild,sheetBack=turnSheet.lastElementChild;
 const cacheStage=document.createElement('div');cacheStage.className='book-cache-stage';cacheStage.setAttribute('aria-hidden','true');shell.append(cacheStage);
 let warmHandle=null,warmIdle=false,warmRevision=0;
 function cancelWarm(){warmRevision++;if(warmHandle!==null){if(warmIdle)window.cancelIdleCallback?.(warmHandle);else clearTimeout(warmHandle);}warmHandle=null;}
 function pagePair(index){
  let pair=session.pageCache.get(index);if(pair)return pair;
  const host=document.createElement('div');host.className='book-cached-spread';host.innerHTML=left(index)+right(index);
  pair={host,left:host.firstElementChild,right:host.lastElementChild};session.pageCache.set(index,pair);return pair;
 }
 function parkPages(){if(session)for(const pair of session.pageCache.values())pair.host.replaceChildren(pair.left,pair.right);}
 function discardPair(pair){pair.host.remove();pair.left.querySelectorAll('img').forEach(img=>img.removeAttribute('src'));}
 function trimPages(keep){if(session)for(const [index,pair] of session.pageCache)if(!keep.has(index)){discardPair(pair);session.pageCache.delete(index);}}
 function disposePages(){if(session){for(const pair of session.pageCache.values())discardPair(pair);session.pageCache.clear();}cacheStage.replaceChildren();sheetFront.replaceChildren();sheetBack.replaceChildren();}
 function mountPages(leftIndex,rightIndex){
  parkPages();const a=pagePair(leftIndex),b=pagePair(rightIndex);a.left.style.visibility='';b.right.style.visibility='';spread.replaceChildren(a.left,b.right);
 }
 function warmNeighbors(){
  cancelWarm();if(!session||phase!=='open'||closeRequested||document.hidden)return;
  const owner=session,token=epoch,revision=warmRevision,center=owner.index;
  const neighbors=[center+1,center-1].filter(index=>index>=0&&index<owner.book.pages.length);
  trimPages(new Set([center,...neighbors]));
  const current=()=>session===owner&&epoch===token&&warmRevision===revision&&phase==='open'&&!closeRequested&&!document.hidden;
  function queue(){
   if(!current()||!neighbors.length)return;
   const run=()=>{
    warmHandle=null;if(!current())return;const index=neighbors.shift();
    if(owner.pageCache.has(index)){queue();return;}
    const pair=pagePair(index);
    // Lay out one hidden spread only in idle time, then detach it before yielding to input.
    cacheStage.append(pair.host);pair.host.getBoundingClientRect();pair.host.remove();
    const img=pair.left.querySelector('img');
    Promise.resolve().then(()=>img?.decode?.()).catch(()=>{}).finally(queue);
   };
   warmIdle=typeof window.requestIdleCallback==='function';
   warmHandle=warmIdle?window.requestIdleCallback(run,{timeout:500}):setTimeout(run,80);
  }
  queue();
 }
 let epoch=0,session=null,phase='closed',turning=false,closeRequested=false;
 const setPhase=value=>{phase=value;reader.dataset.phase=value;};setPhase('closed');
 const alive=token=>token===epoch&&reader.open;
 const key=()=>session.model.id+'/'+session.book.id;
 const image=entry=>escape(entry.cover||session?.model.image||'');
 const theme=book=>book.theme==='mint'?'mint':'blue';
 // A single cover coordinate system keeps type and artwork proportional at every card size.
 // SVG viewBox scaling also works on Android WebViews without container query units.
 function cover(book,model){
  const titleSize=Math.min(30,166/Math.max(1,Array.from(book.title||'').length));
  return `<div class="cover-art"><svg class="cover-composition" viewBox="0 0 224 311" aria-hidden="true" focusable="false">
   <text class="cover-imprint" x="33" y="31">${escape(model.name)} · 搭建图册</text><text class="cover-number" x="202" y="31" text-anchor="end">${book.number}</text>
   <text class="cover-title" x="32" y="74" font-size="${titleSize}">${escape(book.title)}</text>
   <text class="cover-subtitle" x="34" y="94">${escape(book.description)}</text>
   <circle class="cover-orbit" cx="117" cy="187" r="83"/>
   <ellipse class="cover-ground" cx="120" cy="269" rx="40" ry="4"/>
   <image class="cover-model" href="${escape(book.cover||book.pages[0].cover||model.image)}" x="23" y="103" width="188" height="172" preserveAspectRatio="xMidYMid meet"/>
   <text class="cover-motto" x="34" y="291">${escape(book.motto||'把想象，搭成模样')}</text><text class="cover-arrow" x="202" y="292" text-anchor="end">↗</text>
  </svg></div>`;
 }
 function left(i){const {book,model}=session,e=book.pages[i];return `<section class="paper visual-page"><div class="page-topline"><span>${escape(model.name)} · 造型收藏</span><span>${i+1} / ${book.pages.length}</span></div><div class="drawing-stage"><img src="${image(e)}" decoding="async" alt="${escape(e.name)}积木造型" draggable="false"></div><div class="visual-footer"><div class="visual-caption">${escape(book.title)}</div><button type="button" class="build-cta" aria-label="去搭建${escape(e.name)}"><span>去搭建</span>${arrow}</button>${e.companionProgram&&session.onProgram?`<button type="button" class="program-cta" aria-label="去编程${escape(e.name)}"><span>去编程</span>${arrow}</button><p class="program-open-error" role="alert" hidden></p>`:''}</div></section>`;}
 function right(i){
  const {book,model}=session,e=book.pages[i],tags=Array.isArray(e.tags)&&e.tags.length?e.tags:[model.name];
  return `<section class="paper story-page"><div class="story-index">${escape(book.title)}</div><h2>${escape(e.name)}</h2><p class="story-description">${escape(e.description||book.introduction||'跟随搭建步骤，把造型一点点搭出来。')}</p><div class="story-tags">${tags.map(tag=>`<span>${escape(tag)}</span>`).join('')}</div><div class="story-bottom"><span>${escape(book.closingNote||'一块一块，把灵感变成作品')}</span><strong>${String(i+1).padStart(2,'0')}</strong></div></section>`;
 }
 function position(i){const pages=session.book.pages;range.setAttribute('aria-valuetext',`第 ${i+1} 页，共 ${pages.length} 页，${pages[i].name}`);$('current-page').textContent=i+1;$('page-name').textContent=pages[i].name;range.style.setProperty('--progress',`${i/Math.max(1,pages.length-1)*100}%`);}
 // The thumb tracks the requested page immediately; the paper may still be turning.
 function controls(){if(!session)return;const n=session.book.pages.length;range.max=n;range.disabled=n<=1;prev.disabled=session.desired<=0;next.disabled=session.desired>=n-1;$('total-pages').textContent=n;if(!scrubber.active){range.value=session.desired+1;position(session.desired);} $('reader-announcement').textContent=`${session.book.title}，第 ${session.index+1} 页，共 ${n} 页`;}
 function render(){mountPages(session.index,session.index);spread.dataset.page=session.index+1;spread.dataset.entry=session.book.pages[session.index].id;memory.set(key(),session.index);controls();}
 async function animate(element,frames,options){const token=epoch,animation=element.animate(frames,{...options,duration:reduced.matches?1:options.duration,fill:'forwards'});animations.add(animation);try{await animation.finished;}catch(_){}finally{if(token===epoch)Object.assign(element.style,frames[frames.length-1]);animations.delete(animation);animation.cancel();}}
 function leaf(){const el=document.createElement('div');el.className='opening-cover';el.setAttribute('aria-hidden','true');el.innerHTML=`<div class="sheet-face front">${cover(session.book,session.model)}</div><div class="sheet-face back">${left(session.index)}</div>`;shell.append(el);return el;}
 function flight(source,reverse=false){const r=shell.getBoundingClientRect(),el=document.createElement('div');el.className='cover-flight';el.setAttribute('aria-hidden','true');el.style.cssText=`left:${r.left+r.width/2}px;top:${r.top}px;width:${r.width/2}px;height:${r.height}px`;el.innerHTML=cover(session.book,session.model);reader.append(el);const start=`translate(${source.left-r.left-r.width/2}px,${source.top-r.top}px) scale(${source.width/(r.width/2)},${source.height/r.height})`,end='translate(0,0) scale(1,1)';return {el,from:reverse?end:start,to:reverse?start:end};}
 function cleanAnimation(){for(const a of animations)a.cancel();animations.clear();reader.querySelectorAll('.opening-cover,.turning-sheet,.cover-flight').forEach(e=>e.remove());turnSheet.style.transform='';}
 function cancelTouch(){swipe.cancel();scrubber.cancel();}
 function closeNow(){cancelWarm();epoch++;cancelTouch();cleanAnimation();if(session)memory.set(key(),session.index);disposePages();if(reader.open)reader.close();reader.classList.remove('is-ready','is-closing');shell.classList.remove('has-paper');spread.replaceChildren();turning=false;closeRequested=false;setPhase('closed');}
 async function open(book,model,opener,onBuild,onProgram){if(phase!=='closed')return;const token=++epoch;session={book,model,opener,onBuild,onProgram,pageCache:new Map(),index:Math.min(memory.get(model.id+'/'+book.id)||0,book.pages.length-1)};session.desired=session.index;closeRequested=false;reader.dataset.theme=theme(book);setPhase('opening');$('reader-title').textContent=book.title;$('series-mark').textContent=book.number;reader.classList.remove('is-ready','is-closing');shell.classList.remove('has-paper');render();const source=opener.getBoundingClientRect();reader.showModal();
  const f=flight(source);await animate(f.el,[{transform:f.from},{transform:f.to}],{duration:300,easing:'cubic-bezier(.2,.75,.25,1)'});if(!alive(token))return;
  const l=leaf();shell.classList.add('has-paper');f.el.remove();spread.firstElementChild.style.visibility='hidden';await animate(l,[{transform:'rotateY(0deg)'},{transform:'rotateY(-180deg)'}],{duration:420,easing:'cubic-bezier(.25,.7,.25,1)'});if(!alive(token))return;
  l.remove();render();setPhase('open');reader.classList.add('is-ready');$('close-reader').focus({preventScroll:true});if(closeRequested)close();else warmNeighbors();
 }
 async function close({immediate=false}={}){if(immediate){closeNow();return;}if(phase==='closed'||phase==='closing')return;cancelWarm();cancelTouch();closeRequested=true;if(phase==='opening'||phase==='turning')return;const token=epoch;setPhase('closing');reader.classList.remove('is-ready');reader.classList.add('is-closing');const l=leaf();spread.firstElementChild.style.visibility='hidden';await animate(l,[{transform:'rotateY(-180deg)'},{transform:'rotateY(0deg)'}],{duration:300,easing:'ease-in-out'});if(!alive(token))return;
  // The shelf can be rerendered on resize. Find the current cover, not a detached opener.
  const opener=[...document.querySelectorAll('.book-button')].find(e=>e.dataset.bookId===session.book.id&&e.dataset.modelId===session.model.id)||session.opener;
  const source=opener.getBoundingClientRect();if(source.width){const f=flight(source,true);l.remove();shell.classList.remove('has-paper');await animate(f.el,[{transform:f.from},{transform:f.to}],{duration:260,easing:'ease-in-out'});if(!alive(token))return;}closeNow();if(opener.isConnected)opener.focus({preventScroll:true});
 }
 async function turnTo(target){if(!['open','turning'].includes(phase)||closeRequested||scrubber.active)return;session.desired=Math.max(0,Math.min(session.book.pages.length-1,Math.round(target)));controls();if(turning||session.index===session.desired)return;cancelWarm();turning=true;const token=epoch;
  while(alive(token)&&session.index!==session.desired&&!closeRequested){
   const from=session.index,to=session.desired,forward=to>from;setPhase('turning');
   trimPages(new Set([from,to]));mountPages(forward?from:to,forward?to:from);
   const previous=pagePair(from),target=pagePair(to);
   turnSheet.className='turning-sheet '+(forward?'forward':'backward');turnSheet.style.transform='rotateY(0deg)';
   sheetFront.replaceChildren(forward?previous.right:previous.left);sheetBack.replaceChildren(forward?target.left:target.right);
   shell.append(turnSheet);
   await animate(turnSheet,[{transform:'rotateY(0deg)'},{transform:`rotateY(${forward?-180:180}deg)`}],{duration:400,easing:'cubic-bezier(.35,.05,.25,1)'});
   if(!alive(token))return;session.index=to;turnSheet.remove();render();
  }
  if(!alive(token))return;turning=false;setPhase('open');controls();if(closeRequested)close();else warmNeighbors();
 }
 const swipe=BookTouchControls.bindSwipe(shell,{enabled:()=>phase==='open'&&!closeRequested&&!scrubber.active,onTurn:d=>turnTo(session.desired+d)});
 const scrubber=BookTouchControls.bindScrubber(range,{enabled:()=>['open','turning'].includes(phase)&&!closeRequested&&!range.disabled,onPreview:page=>position(page-1),onCommit:page=>turnTo(page-1),onCancel:controls});
 prev.onclick=()=>turnTo(session.desired-1);next.onclick=()=>turnTo(session.desired+1);$('close-reader').onclick=()=>close();
 reader.addEventListener('cancel',e=>{e.preventDefault();close();});reader.addEventListener('click',e=>{if(e.target===reader)close();});
 spread.addEventListener('click',async e=>{
  const button=e.target.closest('.build-cta,.program-cta');if(!button||button.disabled||phase!=='open'||closeRequested)return;
  cancelTouch();memory.set(key(),session.index);
  if(button.matches('.build-cta')){session.onBuild(session.model,session.book.pages[session.index]);return;}
  const current=window.CardBuildingBooks.capture(),error=button.parentElement.querySelector('.program-open-error');
  button.disabled=true;button.setAttribute('aria-busy','true');button.querySelector('span').textContent='正在打开…';error.hidden=true;
  try{await session.onProgram(session.model,session.book.pages[session.index]);}
  catch(cause){if(current()){error.textContent=cause.message||'配套程序打开失败，请重试';error.hidden=false;}}
  finally{button.disabled=false;button.removeAttribute('aria-busy');button.querySelector('span').textContent='去编程';}
 });
 function settle(){if(phase==='closed')return;const closing=closeRequested||phase==='closing';cancelWarm();epoch++;cancelTouch();cleanAnimation();turning=false;if(closing){closeNow();return;}if(phase==='turning')session.index=session.desired;render();shell.classList.add('has-paper');reader.classList.add('is-ready');setPhase('open');warmNeighbors();}
 document.addEventListener('pointerdown',e=>{if(!e.isPrimary)cancelTouch();},{capture:true,passive:true});document.addEventListener('visibilitychange',()=>{if(document.hidden)settle();else if(phase==='open')warmNeighbors();});window.addEventListener('resize',settle);window.addEventListener('pagehide',()=>closeNow());
 // Each configured occurrence is a page; repeated pages share the same catalog model/cache.
 function booksFor(model,entries,config){const used=new Set(),lookup=new Map(entries.map(e=>[e.id,e])),books=[];for(const item of config?.[model.id]||[]){if(!item.id||books.some(b=>b.id===item.id))continue;const pages=(item.entries||[]).map(id=>lookup.get(id)).filter(Boolean);if(!pages.length)continue;pages.forEach(e=>used.add(e.id));books.push({...item,pages});}const remaining=entries.filter(e=>!used.has(e.id));if(remaining.length)books.push({id:'unassigned',title:books.length?'未分组图册':'测试图册',description:model.name+' · 搭建造型',pages:remaining});return books.map((b,i)=>({...b,number:String(i+1).padStart(2,'0')}));}
 function mount(grid,model,books,onBuild,onProgram){const shelf=document.createElement('div');shelf.className='building-books-shelf';for(const book of books){const article=document.createElement('article');article.className='book-item';article.dataset.theme=theme(book);article.innerHTML=`<button type="button" class="book-button" data-book-id="${escape(book.id)}" data-model-id="${escape(model.id)}" aria-label="打开${escape(book.title)}，${book.pages.length}页">${cover(book,model)}</button><div class="book-caption"><h2>${escape(book.title)}</h2><p>${escape(book.description||model.name)} · ${book.pages.length} 页</p></div>`;const button=article.querySelector('button');button.onclick=()=>open(book,model,button,onBuild,onProgram);shelf.append(article);}grid.replaceChildren(shelf);}
 // Temporarily leave the reader for its companion program, keeping album/page ownership.
 function suspend(){
  if(!reader.open||!session)return null;
  const owner=session,scope=CardModelSession.capture();let used=false;
  closeNow();
  return async()=>{
   if(used||!scope.isCurrent()||phase!=='closed')return false;
   const opener=[...document.querySelectorAll('.book-button')].find(button=>button.dataset.bookId===owner.book.id&&button.dataset.modelId===owner.model.id);
   if(!opener)return false;used=true;
   await open(owner.book,owner.model,opener,owner.onBuild,owner.onProgram);return true;
  };
 }
 window.CardBuildingBooks={element:reader,booksFor,mount,close,suspend,capture(){const owner=session,index=session?.index;return ()=>reader.open&&session===owner&&session.index===index&&phase==='open'&&!closeRequested;},get isOpen(){return reader.open;},back(){if(!reader.open)return false;close();return true;}};
})();
