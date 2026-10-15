export function prepareSettingsPage(){
 LDR.InstructionsManager.prototype.setUpOptions=function(){};
 document.getElementById('options')?.remove();
 LDR.Options.lineColor=LDR.Options.lineContrast===0?0:0x333333;
}
export function connectSettingsPage(manager,record){
 const link=manager.ldrButtons.optionsButton.querySelector('a');link.setAttribute('aria-label','查看设置');link.title='查看设置';
 let panel=null;
 let appliedStud=LDR.Options.studHighContrast;
 let updating=false;

 function close(){if(!panel)return;panel.remove();panel=null;window.viewerSettingsBack=null;
   updateStuds();
 }
 // Keep the parsed source and regenerate only the render caches. The document,
 // controls and instruction manager remain alive, including their current view.
 function updateStuds(){
   if(updating||appliedStud===LDR.Options.studHighContrast)return;
   updating=true;
   const value=LDR.Options.studHighContrast, loader=manager.ldrLoader;
   const oldParts=Object.values(loader.partTypes);
   LDR.Studs.makeGenerators('',value,LDR.Options.studLogo);
   LDR.Studs.setStuds(loader,value,LDR.Options.studLogo,()=>{
     const step=manager.currentStep;
     const resources=new Set();
     function collect(object){object?.traverse(node=>{
       if(node.geometry)resources.add(node.geometry);
       const materials=Array.isArray(node.material)?node.material:[node.material];
       materials.forEach(m=>{if(m)resources.add(m)});
     });}
     collect(manager.opaqueObject);collect(manager.sixteenObject);collect(manager.transObject);
     oldParts.forEach(pt=>collect(pt.mesh));
     manager.stepHandler.removeGeometries();
     for(const pt of new Set([...oldParts,...Object.values(loader.partTypes)])){
       const g=pt.geometry;
       if(g){
         for(const key of ['lineGeometries','conditionalLineGeometries','triangleGeometries'])
           Object.values(g[key]||{}).forEach(v=>resources.add(v));
         Object.values(g.texmapGeometries||{}).flat().forEach(v=>resources.add(v.g));
       }
       delete pt.geometry;delete pt.mesh;delete pt.pliMC;
     }
     resources.forEach(resource=>resource?.dispose());
     manager.stepHandler.rebuild();
     manager.stepHandler.nextStep(false);
     manager.stepHandler.moveTo(step);
     manager.stepHandler.updateMeshCollectors();
     manager.updateUIComponents(true);manager.render();
     appliedStud=value;updating=false;updateStuds();
   });
 }
 link.addEventListener('click',event=>{event.preventDefault();if(panel)return;
   const url=new URL('settings.html',window.viewerBase);url.searchParams.set('id',record.id);url.searchParams.set('step',manager.currentStep);url.searchParams.set('embedded','1');
   panel=document.createElement('iframe');panel.title='查看设置';panel.id='viewer-settings-panel';panel.src=url.href;
   panel.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:20000;background:#f5f6f8';document.body.append(panel);window.viewerSettingsBack=close;
 });
 window.addEventListener('message',event=>{
   if(!panel||event.source!==panel.contentWindow||event.origin!==location.origin||event.data?.source!=='viewer-settings')return;
   if(event.data.type==='close'){close();return;}
   if(event.data.type!=='change')return;
   const allowed={lineContrast:[0,1],studHighContrast:[0,1],showOldColors:[0,1,2,3],showStepRotationAnimations:[0,1,2]};
   for(const [key,values]of Object.entries(allowed)){const v=event.data.values?.[key];if(values.includes(v))LDR.Options[key]=v;}

   LDR.Options.lineColor=LDR.Options.lineContrast===0?0:0x333333;
   LDR.Options.saveOptionsToCookie();manager.stepHandler.updateMeshCollectors();manager.updateUIComponents(true);manager.render();
 });
}

