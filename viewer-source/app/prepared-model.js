import {getModel,saveModel} from './store.js';
const root=new URL('../../',import.meta.url);
export function preparedId(device,entry){
 const data=entry.prepared;
 if(!/^[\w-]+$/.test(device)||!/^[\w-]+$/.test(entry.id)||!data||!/^[a-f0-9]{64}$/.test(data.version)
    ||!/^assets\/building-models\/[\w-]+\.json$/.test(data.file))throw Error('搭建图资源信息无效。');
 return 'catalog-'+device+'-'+entry.id+'-'+data.version;
}
function cancelled(signal){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');}
export async function prepareModel(device,entry,{signal}={}){
 const id=preparedId(device,entry);
 const cached=await getModel(id);cancelled(signal);
 if(cached?.preparedVersion===entry.prepared.version&&cached.text&&cached.parts)return cached;
 const response=await fetch(new URL(entry.prepared.file,root),{signal});
 if(!response.ok)throw Error('搭建图文件暂不可用。');
 const data=await response.json();cancelled(signal);
 if(data.format!==1||typeof data.text!=='string'||!data.parts||typeof data.parts!=='object'||typeof data.hasSteps!=='boolean')throw Error('搭建图数据无效。');
 const record={id,modelId:id+'.ldr',name:entry.name,text:data.text,parts:data.parts,hasSteps:data.hasSteps,preparedVersion:entry.prepared.version,createdAt:Date.now()};
 await saveModel(record);cancelled(signal);return record;
}
