/* App-only r139 compatibility layer. Keep the bundled upstream files unchanged. */
const sizedRenderers=new WeakMap(),mainStates=new WeakMap(),previewStates=new WeakMap();
const managers=new Set(),previews=new Set(),ownedPipelines=new Set();
let installed=false,closed=false;
function metrics(){return window.viewerDiagnostics.performance ||= {sizeRequests:0,sizeChanges:0,sizeSkips:0,batchRestores:0,composerBuilds:0,composerDisposals:0,passDisposals:0,renderRequests:0,frames:0};}

export function optimizeViewerRenderer(renderer){
 if(sizedRenderers.has(renderer))return;
 const state={batch:0,restore:null},original=renderer.setSize.bind(renderer),size=new THREE.Vector2();
 sizedRenderers.set(renderer,state);
 renderer.setSize=function(width,height,updateStyle){
  const stats=metrics();stats.sizeRequests++;
  if(state.batch&&updateStyle===true){
   const [w,h]=LDR.getScreenSize();
   if(width===w&&height===h){state.restore=[width,height,updateStyle];stats.sizeSkips++;return;}
  }
  renderer.getSize(size);const ratio=renderer.getPixelRatio(),canvas=renderer.domElement;
  if(size.x===width&&size.y===height&&canvas.width===Math.floor(width*ratio)&&canvas.height===Math.floor(height*ratio)
   &&(updateStyle===false||(canvas.style.width===width+'px'&&canvas.style.height===height+'px'))){stats.sizeSkips++;return;}
  stats.sizeChanges++;return original(width,height,updateStyle);
 };
}

// These bundled passes do not have a complete dispose(). Never dispose the shared fsQuad geometry.
function disposePass(pass){
 if(!pass)return;const resources=new Set();
 for(const value of Object.values(pass))if(value?.isWebGLRenderTarget||value?.isMaterial)resources.add(value);
 for(const resource of resources)resource.dispose();metrics().passDisposals++;
}
function disposePipeline(pipe){
 if(!pipe)return;const passes=new Set([...pipe.composer.passes,pipe.composer.copyPass,pipe.outline,...pipe.glow.values()]);
 passes.forEach(disposePass);pipe.composer.renderTarget1.dispose();pipe.composer.renderTarget2.dispose();
 pipe.glow.clear();pipe.composer.passes.length=0;ownedPipelines.delete(pipe);metrics().composerDisposals++;
}
function pipeline(renderer,scene,camera,{fxaa=false}={}){
 const pipe={renderer,scene,camera,composer:new THREE.EffectComposer(renderer),scenePass:new THREE.RenderPass(scene,camera),outline:null,glow:new Map(),width:null,height:null,ratio:renderer.getPixelRatio()};
 if(fxaa)pipe.fxaa=new THREE.ShaderPass(new THREE.FXAAShader());
 ownedPipelines.add(pipe);metrics().composerBuilds++;return pipe;
}
function updateGlow(pipe,map,width,height){
 for(const [color,pass] of pipe.glow)if(!Object.prototype.hasOwnProperty.call(map,color)){disposePass(pass);pipe.glow.delete(color);}
 for(const color of Object.keys(map)){
  let pass=pipe.glow.get(color);
  if(!pass){
   LDR.attachGlowPassesForObjects({[color]:map[color]},width,height,pipe.scene,pipe.camera,{addPass(value){pass=value;}});
   pass.setSize(width*pipe.renderer.getPixelRatio(),height*pipe.renderer.getPixelRatio());pipe.glow.set(color,pass);
  }
  pass.selectedObjects=map[color];
 }
}
function resizePipeline(pipe,width,height){
 const ratio=pipe.renderer.getPixelRatio();
 if(pipe.ratio!==ratio){pipe.composer.setPixelRatio(ratio);pipe.ratio=ratio;}
 if(pipe.width!==width||pipe.height!==height){pipe.composer.setSize(width,height);pipe.width=width;pipe.height=height;}
 if(pipe.fxaa)pipe.fxaa.uniforms.resolution.value.set(1/(width*ratio),1/(height*ratio));
}
function getMainState(manager){
 let state=mainStates.get(manager);if(!state){state={manager,frame:null,pipe:null,dirty:true,option:null};mainStates.set(manager,state);managers.add(state);}return state;
}
function syncMain(manager,state){
 const [width,screenHeight]=LDR.getScreenSize(),height=Math.max(1,screenHeight-manager.adPeek),map={};
 manager.stepHandler?.getGlowObjects(map);
 const highlight=Boolean(LDR.Options&&LDR.Options.showOldColors<=1);
 state.option=LDR.Options?.showOldColors;state.dirty=false;
 if(!highlight&&!Object.keys(map).length){disposePipeline(state.pipe);state.pipe=null;manager.composer=null;manager.outlinePass=null;return;}
 const pipe=state.pipe ||= pipeline(manager.renderer,manager.scene,manager.camera,{fxaa:true});
 if(highlight){
  if(!pipe.outline){manager.buildOutlinePass(width,height);pipe.outline=manager.outlinePass;pipe.outline.setSize(width*manager.renderer.getPixelRatio(),height*manager.renderer.getPixelRatio());}
  pipe.outline.visibleEdgeColor.set(LDR.Options.showOldColors===0?'#200000':'#20F000');
  pipe.outline.selectedObjects=manager.selectedObjects;
 }else if(pipe.outline){disposePass(pipe.outline);pipe.outline=null;}
 updateGlow(pipe,map,width,height);
 pipe.composer.passes=[pipe.scenePass,...(pipe.outline?[pipe.outline]:[]),pipe.fxaa,...pipe.glow.values()];
 resizePipeline(pipe,width,height);manager.composer=pipe.composer;manager.outlinePass=pipe.outline;
}
let originalMainRender,originalPreviewRender;
export function flushViewerFrame(manager){
 if(!manager||closed)return;const state=getMainState(manager);
 if(state.frame!==null){cancelAnimationFrame(state.frame);state.frame=null;}
 if(state.dirty||state.option!==LDR.Options?.showOldColors)syncMain(manager,state);
 originalMainRender.call(manager);metrics().frames++;
}
function requestMain(manager){
 if(closed)return;const state=getMainState(manager);metrics().renderRequests++;
 if(state.frame!==null||document.hidden)return;
 state.frame=requestAnimationFrame(()=>{state.frame=null;flushViewerFrame(manager);});
}
function requestPreview(preview){
 if(closed)return;let state=previewStates.get(preview);
 if(!state){state={preview,frame:null,pipe:null};previewStates.set(preview,state);previews.add(state);}
 if(state.frame!==null||document.hidden)return;
 state.frame=requestAnimationFrame(()=>{state.frame=null;if(!closed)originalPreviewRender.call(preview);});
}

export function installViewerPerformance(){
 if(installed)return;installed=true;
 const proto=LDR.InstructionsManager.prototype;
 originalMainRender=proto.render;originalPreviewRender=LDR.PliPreviewer.prototype.render;
 proto.render=function(){requestMain(this);};
 const updateUI=proto.updateUIComponents;
 proto.updateUIComponents=function(...args){getMainState(this).dirty=true;return updateUI.apply(this,args);};
 proto.onWindowResize=function(){
  this.topButtonsHeight=document.getElementById('top_buttons').offsetHeight;
  const [w,screenHeight]=LDR.getScreenSize(),h=Math.max(1,screenHeight-this.adPeek);
  this.renderer.setSize(w,h,true);syncMain(this,getMainState(this));
  // Preserve the upstream framing and camera/step behavior; only the expensive allocations change.
  this.camera.left=-this.canvas.clientWidth*.95;this.camera.right=this.canvas.clientWidth*.95;
  this.camera.top=this.canvas.clientHeight*.95;this.camera.bottom=-this.canvas.clientHeight*.95;
  this.updateViewPort();this.updateCameraZoom();
  if(this.stepHandler){this.realignModel(0);this.updateUIComponents(false);}
 };

 const pli=LDR.PLIBuilder.prototype,drawPLI=pli.drawPLIForStep;
 pli.drawPLIForStep=function(...args){
  const state=sizedRenderers.get(this.renderer);if(!state)return drawPLI.apply(this,args);
  state.batch++;
  try{return drawPLI.apply(this,args);}finally{
   state.batch--;
   if(!state.batch&&state.restore){const args=state.restore;state.restore=null;metrics().batchRestores++;this.renderer.setSize(...args);}
  }
 };
 pli.renderIcon=function(partID,color,width,height){
  const pt=this.getPartType(partID);pt.pliMC.overwriteColor(color);pt.pliMC.draw(false);this.scene.add(pt.mesh);
  try{
   this.renderer.setSize(width+1,height+1);this.updateCamera(pt.dx,pt.dy);
   const map={};pt.pliMC.getGlowObjects(map);
   if(Object.keys(map).length){
    const pipe=this.appIconPipeline ||= pipeline(this.renderer,this.scene,this.camera);
    updateGlow(pipe,map,width,height);
    // The original icon renderer applies glow before its final scene pass.
    pipe.composer.passes=[...pipe.glow.values(),pipe.scenePass];resizePipeline(pipe,width+1,height+1);pipe.composer.render();
   }else this.renderer.render(this.scene,this.camera);
  }finally{this.scene.remove(pt.mesh);}
 };

 const preview=LDR.PliPreviewer.prototype,clearPreview=preview.clear;
 preview.render=function(){requestPreview(this);};
 preview.onResize=function(){
  if(!this.renderer)return;const [allW,allH]=LDR.getScreenSize(),w=allW*.8,h=Math.max(1,allH-180);
  this.renderer.setSize(w,h);const holder=this.renderer.domElement.parentElement;holder.style.width=w+'px';holder.style.height=h+'px';
  this.camera.left=-w;this.camera.right=w;this.camera.top=h;this.camera.bottom=-h;
  const state=previewStates.get(this)||{preview:this,frame:null,pipe:null};previewStates.set(this,state);previews.add(state);
  const map={};if(this.showsSomething())this.pliHighlighted.pliMC.getGlowObjects(map);
  if(Object.keys(map).length){const pipe=state.pipe ||= pipeline(this.renderer,this.scene,this.camera);updateGlow(pipe,map,w,h);pipe.composer.passes=[pipe.scenePass,...pipe.glow.values()];resizePipeline(pipe,w,h);this.composer=pipe.composer;}
  else{disposePipeline(state.pipe);state.pipe=null;this.composer=null;}
  this.resetCameraZoom();this.render();
 };
 preview.clear=function(){
  clearPreview.call(this);const state=previewStates.get(this);
  if(state?.pipe){disposePipeline(state.pipe);state.pipe=null;}this.composer=null;
 };
 document.addEventListener('visibilitychange',()=>{
  for(const state of managers){if(document.hidden&&state.frame!==null){cancelAnimationFrame(state.frame);state.frame=null;}else if(!document.hidden)requestMain(state.manager);}
  for(const state of previews){if(document.hidden&&state.frame!==null){cancelAnimationFrame(state.frame);state.frame=null;}else if(!document.hidden&&state.preview.showsSomething())requestPreview(state.preview);}
 });
 window.addEventListener('pagehide',event=>{
  for(const state of [...managers,...previews])if(state.frame!==null){cancelAnimationFrame(state.frame);state.frame=null;}
  if(event.persisted)return;closed=true;for(const pipe of [...ownedPipelines])disposePipeline(pipe);
 });
}
