import {prepareModel} from './app/prepared-model.js';
import {saveModel} from './app/store.js';
try{
 const params=new URLSearchParams(location.search),device=params.get('device'),id=params.get('id');
 const catalog=await fetch('../building-catalog.json').then(r=>{if(!r.ok)throw Error('搭建图列表读取失败');return r.json();});
 const entry=Object.prototype.hasOwnProperty.call(catalog,device)&&catalog[device].find(e=>e.id===id);
 if(!entry)throw Error('此设备没有这份搭建图，请返回列表。');
 if(!/^assets\/building-models\/[a-zA-Z0-9_./-]+\.(io|ldr|mpd|dat)$/i.test(entry.file)||entry.file.includes('..'))throw Error('搭建图资源路径无效。');
 if(entry.prepared){
  const record=await prepareModel(device,entry);
  location.replace((record.hasSteps?'instructions.html':'view.html')+'?id='+encodeURIComponent(record.id));
 }else{
 const {readModel,inspectModel}=await import('./app/importer.js');
 const {loadLibrary}=await import('./app/library.js');
 const response=await fetch('../'+entry.file);if(!response.ok)throw Error('搭建图文件暂不可用。');
 const record=await readModel(new File([await response.arrayBuffer()],entry.file.split('/').pop()));
 const result=inspectModel(record.text,await loadLibrary());if(result.missing.length)throw Error('缺少零件：'+result.missing.join('、'));
 record.id='catalog-'+device+'-'+id;record.modelId=record.id+'.ldr';record.name=entry.name;
 await saveModel(record);
 location.replace((result.hasSteps?'instructions.html':'view.html')+'?id='+encodeURIComponent(record.id));
 }
}catch(error){document.getElementById('status').textContent=error.message;}
