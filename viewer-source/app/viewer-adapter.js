import {getModel} from './store.js';
const normalize=s=>s.trim().replace(/\\/g,'/').toLowerCase();
import {loadLibrary} from './library.js';
import {applyCustomParts} from './custom-assemblies.mjs';
import {prepareSettingsPage,connectSettingsPage} from './settings-navigation.js';
import {disableStudLogos} from './viewer-policy.js';
import {applyToolbarIcons} from './toolbar.js';
disableStudLogos();
const overlay=document.createElement('div');overlay.id='viewer-message';overlay.textContent='正在读取本地模型…';document.body.append(overlay);
window.viewerDiagnostics={ready:false,errors:[],warnings:[],loads:0};
function failure(message){window.parent.postMessage({source:'building-viewer',type:'error',visit:window.viewerVisit,message},location.origin);overlay.hidden=false;overlay.replaceChildren();const box=document.createElement('div');box.className='viewer-failure';const p=document.createElement('p');p.textContent=message;const back=document.createElement('a');back.href='/';back.textContent='返回选择模型';box.append(p,back);overlay.append(box);window.viewerDiagnostics.errors.push(String(message));}
try{
  const params=new URLSearchParams(location.search),record=await getModel(params.get('id'));
  if(!record)throw new Error('模型不在本浏览器中，请返回首页重新选择文件。');
  const manifest=await loadLibrary();
  if(!record.preparedVersion){
   const {inspectModel}=await import('./importer.js');
   record.text=applyCustomParts(record.text,manifest.custom);
   const info=inspectModel(record.text,manifest);if(info.missing.length)throw new Error('本地库缺少零件：\n'+info.missing.join('\n'));
  }
  window.viewerRecord=record;document.title=record.name+' · 积木查看器';
  const RealLoader=THREE.LDRLoader,originalLoad=RealLoader.prototype.load;
  function LocalLoader(onLoad,storage,options={}){
    const config={...options,idToUrl:id=>{
      const name=normalize(id);if(!manifest.parts[name])throw new Error('零件库缺少依赖：'+name);
      return [manifest.parts[name].url||'/library/'+name.split('/').map(encodeURIComponent).join('/')];
    },idToTextureUrl:id=>'/library/textures/'+normalize(id).split('/').map(encodeURIComponent).join('/'),
    onError:error=>failure('模型加载失败：'+(error.subModel||'')+' '+(error.message||'')),
    onWarning:warning=>window.viewerDiagnostics.warnings.push(warning.message||String(warning))};
    RealLoader.call(this,()=>{if(window.viewerDiagnostics.errors.length)return;onLoad();window.viewerDiagnostics.ready=true;overlay.hidden=true;document.body.dataset.ready='true';window.parent.postMessage({source:'building-viewer',type:'ready',visit:window.viewerVisit},location.origin);},null,config);
  }
  LocalLoader.prototype=Object.create(RealLoader.prototype);LocalLoader.prototype.constructor=LocalLoader;Object.assign(LocalLoader,RealLoader);
  LocalLoader.prototype.load=function(id){
    window.viewerDiagnostics.loads++;
    const text=id===record.modelId?record.text:record.parts?.[normalize(id)];
    if(typeof text!=='string')return originalLoad.call(this,id);
    if(this.partTypes[id])return;
    this.partTypes[id]=true;this.unloadedFiles++;
    queueMicrotask(()=>{try{this.parse(text,id);this.unloadedFiles--;this.reportProgress(id);}catch(error){failure(error.message||String(error));}});
  };
  THREE.LDRLoader=LocalLoader;
  // Keep the upstream rendering/UI. Limit backing-store size on high-DPI phones.
  const RealRenderer=THREE.WebGLRenderer;
  THREE.WebGLRenderer=function(...args){
    const renderer=new RealRenderer(...args),setRatio=renderer.setPixelRatio.bind(renderer),render=renderer.render.bind(renderer);
    renderer.setPixelRatio=ratio=>setRatio(Math.min(2,ratio||1));
    renderer.render=(scene,camera)=>{render(scene,camera);if(scene.type==='Scene')window.viewerDiagnostics.lastRender={triangles:renderer.info.render.triangles,camera:camera.position.toArray(),zoom:camera.zoom,width:renderer.domElement.width,height:renderer.domElement.height};};
    renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();failure('图形上下文已中断，请返回首页重新打开模型。');});return renderer;
  };
  THREE.WebGLRenderer.prototype=RealRenderer.prototype;
  window.addEventListener('error',event=>failure(event.message));
  if(location.pathname==='/instructions.html'){
    prepareSettingsPage();window.model=record.modelId;window.main();connectSettingsPage(window.manager,record);applyToolbarIcons(window.manager);
  }
  else window.startOriginalViewer();
}catch(error){failure(error.message||String(error));}
