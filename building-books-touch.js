/* Phone interaction only. Pointer Events share one path for finger input and preview taps.
   No hover, wheel, keyboard shortcut, drag-and-drop, or platform-specific branch. */
(() => {
  'use strict';
  const interactive = 'a,button,input,select,textarea';
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  function release(element,id) {
    if(element.hasPointerCapture(id)) element.releasePointerCapture(id);
  }

  function bindSwipe(element,{enabled,onTurn}) {
    let gesture=null, suppressClick=false;
    const cancel=()=>{
      if(!gesture) return;
      const id=gesture.id; gesture=null;
      release(element,id);
    };
    element.addEventListener('pointerdown',event=>{
      suppressClick=false;
      if(!event.isPrimary) {cancel();return;}
      if(!enabled()||event.target.closest(interactive)) return;
      gesture={id:event.pointerId,x:event.clientX,y:event.clientY,horizontal:false};
    });
    element.addEventListener('pointermove',event=>{
      if(!gesture||gesture.id!==event.pointerId) return;
      const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
      // Leave vertical movement to native scrolling; do not capture until intent is clear.
      if(!gesture.horizontal) {
        if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)) {cancel();return;}
        if(Math.abs(dx)<10||Math.abs(dx)<Math.abs(dy)*1.25) return;
        gesture.horizontal=true; element.setPointerCapture(event.pointerId);
      }
    });
    element.addEventListener('pointerup',event=>{
      if(!gesture||gesture.id!==event.pointerId) return;
      const current=gesture;
      const dx=event.clientX-current.x,dy=event.clientY-current.y;
      const threshold=clamp(element.clientWidth*.07,28,50);
      suppressClick=current.horizontal;
      cancel();
      if(current.horizontal&&Math.abs(dx)>=threshold&&Math.abs(dx)>Math.abs(dy)*1.25&&enabled()) onTurn(dx<0?1:-1);
    });
    element.addEventListener('pointercancel',cancel);
    // Touch initially captures the child under the finger. Taking capture here
    // emits a bubbling loss on that child; only losing our own capture cancels.
    element.addEventListener('lostpointercapture',event=>{if(event.target===element)cancel();});
    // Consume the synthetic tap after a swipe; a fresh touch resets this guard.
    element.addEventListener('click',event=>{
      if(!suppressClick) return;
      suppressClick=false; event.preventDefault(); event.stopPropagation();
    },true);
    return {cancel};
  }

  function bindScrubber(input,{enabled,onPreview,onCommit,onCancel}) {
    let active=null;
    const valueAt=(x)=>{
      const r=input.getBoundingClientRect(),min=Number(input.min),max=Number(input.max);
      const inset=12,travel=Math.max(1,r.width-inset*2);
      return Math.round(min+clamp((x-r.left-inset)/travel,0,1)*(max-min));
    };
    const preview=(x)=>{input.value=valueAt(x);onPreview(Number(input.value));};
    const cancel=()=>{
      if(active===null) return;
      const id=active; active=null; release(input,id); onCancel();
    };
    input.addEventListener('pointerdown',event=>{
      if(!event.isPrimary) {cancel();return;}
      if(!enabled()) {event.preventDefault();return;}
      active=event.pointerId;
      input.setPointerCapture(active);
      // The full 44px-high track responds to a finger, including taps away from the thumb.
      event.preventDefault(); preview(event.clientX);
    });
    input.addEventListener('pointermove',event=>{
      if(active===event.pointerId) preview(event.clientX);
    });
    input.addEventListener('pointerup',event=>{
      if(active!==event.pointerId) return;
      preview(event.clientX);
      const value=Number(input.value),id=active;
      active=null; release(input,id); onCommit(value);
    });
    input.addEventListener('pointercancel',cancel);
    input.addEventListener('lostpointercapture',cancel);
    // Native range events remain for assistive input; no custom desktop shortcuts.
    input.addEventListener('input',()=>{if(active===null&&enabled()) onPreview(Number(input.value));});
    input.addEventListener('change',()=>{if(active===null&&enabled()) onCommit(Number(input.value));});
    return {cancel,get active(){return active!==null;}};
  }
  window.BookTouchControls={bindSwipe,bindScrubber};
})();
