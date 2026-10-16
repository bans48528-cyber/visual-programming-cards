const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(__dirname+'/../building-books-touch.js','utf8'),context);
const controls=context.window.BookTouchControls;
class Surface extends EventTarget {
  constructor(){super();this.clientWidth=500;this.captured=new Set();this.min='1';this.max='8';this.value='1';this.interactive=false;}
  closest(){return this.interactive?this:null;}
  setPointerCapture(id){this.captured.add(id);}
  hasPointerCapture(id){return this.captured.has(id);}
  releasePointerCapture(id){this.captured.delete(id);send(this,'lostpointercapture',{pointerId:id});}
  getBoundingClientRect(){return {left:0,width:240};}
}
function send(element,type,data={}) {
  const event=new Event(type,{cancelable:true});
  Object.assign(event,{pointerId:1,pointerType:'touch',isPrimary:true,clientX:200,clientY:100,...data});
  element.dispatchEvent(event);return event;
}
function swipeFixture(){const surface=new Surface(),turns=[];const binding=controls.bindSwipe(surface,{enabled:()=>true,onTurn:direction=>turns.push(direction)});return {surface,turns,binding};}
test('finger swipe emits one turn and consumes only its synthetic tap',()=>{
  const {surface,turns}=swipeFixture();
  send(surface,'pointerdown');send(surface,'pointermove',{clientX:100});send(surface,'pointerup',{clientX:100});
  assert.deepEqual(turns,[1]);assert.equal(surface.captured.size,0);
  assert.equal(send(surface,'click').defaultPrevented,true);
  send(surface,'pointerdown');send(surface,'pointerup');
  assert.equal(send(surface,'click').defaultPrevented,false);
});
test('vertical scrolling and small finger jitter do not turn a page',()=>{
  const {surface,turns}=swipeFixture();
  send(surface,'pointerdown');send(surface,'pointermove',{clientY:140});send(surface,'pointerup',{clientX:110,clientY:170});
  send(surface,'pointerdown');send(surface,'pointermove',{clientX:188});send(surface,'pointerup',{clientX:188});
  assert.deepEqual(turns,[]);
});
test('building link owns its touch; it is not interpreted as a page gesture',()=>{
  const {surface,turns}=swipeFixture();surface.interactive=true;
  send(surface,'pointerdown');send(surface,'pointermove',{clientX:80});send(surface,'pointerup',{clientX:80});
  assert.deepEqual(turns,[]);assert.equal(send(surface,'click').defaultPrevented,false);
});
for(const interruption of ['pointercancel','lostpointercapture','second-finger','lifecycle']) {
  test(`swipe aborts safely after ${interruption}`,()=>{
    const {surface,turns,binding}=swipeFixture();
    send(surface,'pointerdown');send(surface,'pointermove',{clientX:100});
    if(interruption==='second-finger')send(surface,'pointerdown',{pointerId:2,isPrimary:false});
    else if(interruption==='lifecycle')binding.cancel();
    else send(surface,interruption);
    send(surface,'pointerup',{clientX:50});
    assert.deepEqual(turns,[]);assert.equal(surface.captured.size,0);
  });
}
function scrubFixture(){
  const surface=new Surface(),previews=[],commits=[],cancels=[];
  const binding=controls.bindScrubber(surface,{enabled:()=>true,onPreview:page=>previews.push(page),onCommit:page=>commits.push(page),onCancel:()=>cancels.push(true)});
  return {surface,binding,previews,commits,cancels};
}
test('slider follows the finger and commits once on lift, including outside its bounds',()=>{
  const {surface,binding,previews,commits,cancels}=scrubFixture();
  send(surface,'pointerdown',{clientX:12});send(surface,'pointermove',{clientX:105});
  assert.equal(binding.active,true);assert.deepEqual(previews,[1,4]);assert.deepEqual(commits,[]);
  send(surface,'pointerup',{clientX:800});
  assert.deepEqual(commits,[8]);assert.deepEqual(cancels,[]);assert.equal(binding.active,false);
});
test('a tap anywhere on the slider selects that page',()=>{
  const {surface,commits}=scrubFixture();
  send(surface,'pointerdown',{clientX:135});send(surface,'pointerup',{clientX:135});
  assert.deepEqual(commits,[5]);
});
test('cancelled or interrupted slider drag never commits a stale page',()=>{
  for(const stop of ['pointercancel','lostpointercapture','second-finger','lifecycle']) {
    const {surface,binding,commits,cancels}=scrubFixture();
    send(surface,'pointerdown',{clientX:12});send(surface,'pointermove',{clientX:180});
    if(stop==='second-finger')send(surface,'pointerdown',{pointerId:2,isPrimary:false});
    else if(stop==='lifecycle')binding.cancel();
    else send(surface,stop);
    send(surface,'pointerup',{clientX:228});
    assert.deepEqual(commits,[]);assert.equal(cancels.length,1);assert.equal(surface.captured.size,0);
  }
});
