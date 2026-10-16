// Upstream buttons activate on touchend even after a drag. Keep taps working,
// but do not turn a swipe into a page change, zoom or navigation.
function ignoreDraggedTouch(element){
  const touches=new Map();
  element.addEventListener('touchstart',event=>{
    for(const touch of event.changedTouches)touches.set(touch.identifier,{x:touch.clientX,y:touch.clientY,moved:false});
  },{passive:true});
  const update=event=>{
    for(const touch of event.changedTouches){
      const start=touches.get(touch.identifier);
      if(start&&Math.hypot(touch.clientX-start.x,touch.clientY-start.y)>8)start.moved=true;
    }
  };
  element.addEventListener('touchmove',update,{passive:true});
  element.addEventListener('touchend',event=>{
    update(event);let dragged=false;
    for(const touch of event.changedTouches){dragged=touches.get(touch.identifier)?.moved||dragged;touches.delete(touch.identifier);}
    if(dragged){event.preventDefault();event.stopImmediatePropagation();}
  },{capture:true,passive:false});
  element.addEventListener('touchcancel',event=>{for(const touch of event.changedTouches)touches.delete(touch.identifier);},{passive:true});
}

export function applyToolbarIcons(manager){
  const buttons=manager.ldrButtons;
  // The upstream demo uses modelID as its home link; our home is the launcher.
  buttons.homeButton.href='/';
  // Completion follows the same host return route, preserving the open album/page.
  // The upstream touch/mouse handlers call this method dynamically.
  manager.clickDone=()=>buttons.homeButton.click();
  const items=[
    [buttons.backButton,'previous','上一步',()=>manager.prevStep()],
    [buttons.homeButton,'return','返回首页'],
    [buttons.optionsButton.querySelector('a'),'settings','查看设置'],
    [buttons.nextButton,'next','下一步',()=>manager.nextStep()],
    [buttons.nextButtonLarge,'next-large','下一步',()=>manager.nextStep()],
    [buttons.doneButton,'complete','完成搭建，返回上一页',()=>manager.clickDone()],
    [buttons.zoomOutButtonLarge,'zoom-out','缩小',()=>manager.zoomOut()],
    [buttons.zoomOutButton,'zoom-out','缩小',()=>manager.zoomOut()],
    [buttons.resetCameraButton,'reset-view','视角复位',()=>manager.resetCameraPosition()],
    [buttons.zoomInButtonLarge,'zoom-in','放大',()=>manager.zoomIn()],
    [buttons.zoomInButton,'zoom-in','放大',()=>manager.zoomIn()]
  ];
  for(const [element,name,label,action] of items){
    const image=document.createElement('img');
    image.src='/app/icons/'+name+'.svg';image.alt='';image.draggable=false;
    image.className='toolbar-icon';image.setAttribute('aria-hidden','true');
    element.replaceChildren(image);element.title=label;element.setAttribute('aria-label',label);
    ignoreDraggedTouch(element);
    if(action){
      element.setAttribute('role','button');element.tabIndex=0;
      // Do not also trigger the upstream document-level Enter/page-number jump.
      element.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(!event.repeat)action();}
      });
    }
  }
  // Keep the live page badge editable, including a numeric keyboard on phones.
  const badge=document.createElement('div');badge.className='step-badge';
  buttons.stepToButton.before(badge);
  badge.append(buttons.stepToButton,document.getElementById('numberOfSteps'));
  const pageInput=buttons.stepInput;
  pageInput.readOnly=false;pageInput.tabIndex=0;
  pageInput.removeAttribute('onclick');
  pageInput.setAttribute('aria-label','当前步骤');
  pageInput.setAttribute('inputmode','numeric');
  pageInput.setAttribute('enterkeyhint','go');
  pageInput.setAttribute('autocomplete','off');
  pageInput.title='输入页码，按前往或回车跳转';
  const setShownStep=buttons.setShownStep.bind(buttons);
  buttons.setShownStep=step=>{
    setShownStep(step);
    const total=manager.stepHandler?.totalNumberOfSteps||step;
    buttons.stepToButton.style.width=(Math.max(1,String(total).length)+.5)+'ch';
  };
  buttons.setShownStep(buttons.stepInput.value||manager.currentStep||1);
  const restorePage=()=>buttons.setShownStep(manager.currentStep||1);
  const commitPage=()=>{
    const value=pageInput.value.trim(),requested=Number(value);
    const total=manager.stepHandler?.totalNumberOfSteps;
    if(total&&/^\d+$/.test(value)&&Number.isSafeInteger(requested)){
      const target=Math.max(1,Math.min(total,requested));
      if(target!==manager.currentStep)manager.goToStep(target);
    }
    restorePage();
  };
  pageInput.addEventListener('focus',()=>pageInput.select());
  // The whole badge is a tap target, not just the narrow current-page digits.
  badge.addEventListener('click',event=>{
    if(event.target!==pageInput){pageInput.focus();pageInput.select();}
  });
  pageInput.addEventListener('keydown',event=>{
    // Editing/caret keys must not reach the viewer's page-navigation shortcuts.
    event.stopPropagation();
    if(event.key==='Enter'&&!event.isComposing){
      event.preventDefault();commitPage();pageInput.blur();
    }else if(event.key==='Escape'){
      event.preventDefault();restorePage();pageInput.blur();
    }
  });
  // Also support mobile keyboards that dismiss without sending Enter.
  pageInput.addEventListener('blur',commitPage);
  for(const [id,label] of [['pli_icon_left','收起零件栏'],['pli_icon_right','展开零件栏'],['pli_icon_up','收起零件栏'],['pli_icon_down','展开零件栏']]){
    const element=document.getElementById(id),image=document.createElement('img');
    image.src='/app/icons/'+'collapse-parts.svg';image.alt='';image.draggable=false;image.className='toolbar-icon';
    element.replaceChildren(image);element.title=label;element.setAttribute('aria-label',label);
  }
}
