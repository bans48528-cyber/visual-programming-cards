import {ZipReader,Uint8ArrayReader,TextWriter} from '/app/zip-full.min.js';
import {loadLibrary} from './library.js';
import {applyCustomParts} from './custom-assemblies.mjs';
export const normalize=s=>s.trim().replace(/\\/g,'/').toLowerCase();
export async function readModel(file){
  if(file.size>60_000_000)throw new Error('模型文件超过本验证版的 60 MB 导入上限。');
  let text;
  if(/\.io$/i.test(file.name)){
    // Snapshot the selected file once. WebKit can reject repeated slices of an
    // uploaded File (NotFoundError), even while its whole arrayBuffer is readable.
    const reader=new ZipReader(new Uint8ArrayReader(new Uint8Array(await file.arrayBuffer())),{useWebWorkers:false});
    try{
      const entries=await reader.getEntries();
      if(entries.length>20000)throw new Error('模型压缩包包含过多条目。');
      const entry=entries.find(e=>normalize(e.filename)==='model.ldr'&&!e.directory);
      if(!entry)throw new Error('此 .io 文件中没有可读取的 model.ldr。');
      if(entry.uncompressedSize>100_000_000)throw new Error('解压后的模型数据过大。');
      text=await entry.getData(new TextWriter(),{password:'soho0909',checkSignature:true});
    }catch(error){throw new Error('无法读取 Studio 文件：'+error.message);}
    finally{await reader.close();}
  }else if(/\.(ldr|mpd|dat)$/i.test(file.name)){text=await file.text();}
  else throw new Error('请选择 .io、.ldr、.mpd 或 .dat 文件。');
  text=text.replace(/^\uFEFF/,'');
  if(!/^\s*[1-5]\s+/m.test(text))throw new Error('模型没有可显示的 LDraw 几何或零件。');
  const manifest=await loadLibrary();
  text=applyCustomParts(text,manifest.custom);
  // crypto.randomUUID is unavailable on some non-HTTPS mobile development URLs.
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);const id=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return {id,name:file.name,text,modelId:'local-'+id+'.ldr',createdAt:Date.now()};
}
export function inspectModel(text,manifest){
  const files=new Set(),refs=new Set();let steps=0;
  for(const line of text.split(/\r?\n/)){
    const t=line.trim();const f=t.match(/^0\s+FILE\s+(.+)$/i);if(f)files.add(normalize(f[1]));
    if(/^0\s+(STEP|ROTSTEP)\b/i.test(t))steps++;
    const fields=t.split(/\s+/);if(fields[0]==='1'&&fields.length>=15)refs.add(normalize(fields.slice(14).join(' ')));
  }
  return {missing:[...refs].filter(id=>!files.has(id)&&!manifest.parts[id]).sort(),hasSteps:steps>0,embeddedFiles:files.size};
}
