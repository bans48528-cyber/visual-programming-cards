import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {applyCustomParts,parseReference} from '../viewer-source/app/custom-assemblies.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist'), viewer=path.join(root,'viewer-source');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'building-catalog.json'),'utf8'));
const standard=JSON.parse(fs.readFileSync(path.join(viewer,'library/manifest.json'),'utf8'));
const custom=JSON.parse(fs.readFileSync(path.join(viewer,'custom-library/manifest.json'),'utf8'));
const library={...standard.parts,...custom.parts};
let zip;
for(const [device,entries]of Object.entries(catalog))for(const entry of entries){
 if(!/^[\w-]+$/.test(device)||!/^[\w-]+$/.test(entry.id))throw Error('Invalid building identity');
 if(!/^assets\/building-models\/[\w./-]+\.(io|ldr|mpd|dat)$/i.test(entry.file)||entry.file.includes('..'))throw Error('Invalid building path');
 const source=fs.readFileSync(path.join(root,entry.file));
 let text;
 if(/\.io$/i.test(entry.file)){
  zip ||= await import('data:text/javascript;base64,'+fs.readFileSync(path.join(viewer,'app/zip-full.min.js')).toString('base64'));
  const reader=new zip.ZipReader(new zip.Uint8ArrayReader(source),{useWebWorkers:false});
  try{
   const item=(await reader.getEntries()).find(e=>e.filename.toLowerCase()==='model.ldr'&&!e.directory);
   if(!item)throw Error('No model.ldr: '+entry.file);
   text=await item.getData(new zip.TextWriter(),{password:'soho0909',checkSignature:true});
  }finally{await reader.close();}
 }else text=source.toString('utf8');
 text=applyCustomParts(text.replace(/^\uFEFF/,''),custom);
 const embedded=new Set([...text.matchAll(/^0\s+FILE\s+(.+)$/gim)].map(m=>m[1].trim().replace(/\\/g,'/').toLowerCase()));
 const parts={};
 function collect(source){
  for(const line of source.split(/\r?\n/)){
   const ref=parseReference(line);if(!ref||embedded.has(ref.id)||Object.hasOwn(parts,ref.id))continue;
   const part=library[ref.id];if(!part)throw Error('Missing part '+ref.id+' in '+entry.file);
   const url=part.url||'/library/'+ref.id;
   if(!/^\/(custom-library|library)\/[\w./-]+$/.test(url)||url.includes('..'))throw Error('Invalid part path: '+url);
   parts[ref.id]=fs.readFileSync(path.join(viewer,url.slice(1)),'utf8');collect(parts[ref.id]);
  }
 }
 collect(text);
 const payload={format:1,text,parts,hasSteps:/^\s*0\s+(STEP|ROTSTEP)\b/im.test(text)};
 const json=JSON.stringify(payload),version=createHash('sha256').update(json).digest('hex');
 const file='assets/building-models/'+device+'-'+entry.id+'-'+version.slice(0,16)+'.json';
 fs.writeFileSync(path.join(out,file),json);
 entry.prepared={file,version,hasSteps:payload.hasSteps};
 // The original .io remains source evidence; the app only needs its prepared form.
 if(fs.existsSync(path.join(out,entry.file)))fs.unlinkSync(path.join(out,entry.file));
 console.log(`Prepared ${device}/${entry.id}: ${Object.keys(parts).length} dependencies, ${Buffer.byteLength(json)} bytes`);
}
fs.writeFileSync(path.join(out,'building-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
