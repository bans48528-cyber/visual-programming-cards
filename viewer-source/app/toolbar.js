export function applyToolbarIcons(manager){
  const buttons=manager.ldrButtons;
  // The upstream demo uses modelID as its home link; our home is the launcher.
  buttons.homeButton.href='/';
  const items=[
    [buttons.backButton,'previous','上一步',()=>manager.prevStep()],
    [buttons.homeButton,'return','返回首页'],
    [buttons.optionsButton.querySelector('a'),'settings','查看设置'],
    [buttons.nextButton,'next','下一步',()=>manager.nextStep()],
    [buttons.nextButtonLarge,'next-large','下一步',()=>manager.nextStep()],
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
    if(action){
      element.setAttribute('role','button');element.tabIndex=0;
      // Do not also trigger the upstream document-level Enter/page-number jump.
      element.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(!event.repeat)action();}
      });
    }
  }
  buttons.stepInput.setAttribute('aria-label','跳转到步骤');
  buttons.stepInput.setAttribute('inputmode','numeric');
}
