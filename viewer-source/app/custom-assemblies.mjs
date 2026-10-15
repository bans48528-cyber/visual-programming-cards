// Adapt known user assemblies at import time; all original mesh data stays intact.
const norm = id => id.trim().replace(/\\/g, '/').toLowerCase();
const epsilon = 0.001;
const add = (a,b) => a.map((v,i)=>v+b[i]);
const subtract = (a,b) => a.map((v,i)=>v-b[i]);
const vector = (m,p) => [0,1,2].map(i=>m[3*i]*p[0]+m[3*i+1]*p[1]+m[3*i+2]*p[2]);
const multiply = (a,b) => a.map((_,i)=>[0,1,2].reduce((sum,k)=>sum+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0));
const close = (a,b) => a.every((v,i)=>Math.abs(v-b[i])<epsilon);
function inverse(m) {
  const [a,b,c,d,e,f,g,h,i]=m;
  const values=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const det=a*values[0]+b*values[3]+c*values[6];
  return Math.abs(det)<1e-8 ? null : values.map(v=>v/det);
}
export function parseReference(line) {
  const f=line.trim().split(/\s+/);
  if(f[0]!=='1'||f.length<15)return null;
  const values=f.slice(2,14).map(Number);
  if(!values.every(Number.isFinite))return null;
  return {color:f[1],position:values.slice(0,3),matrix:values.slice(3),id:norm(f.slice(14).join(' '))};
}
export function compose(parent,child) {
  return {id:child.id,color:child.color==='16'?parent.color:child.color,
    position:add(parent.position,vector(parent.matrix,child.position)),matrix:multiply(parent.matrix,child.matrix)};
}
export function referenceLine(part) {
  const numbers=[...part.position,...part.matrix].map(v=>Number(v.toFixed(6)));
  return ['1',part.color,...numbers,part.id].join(' ');
}
function assembleStep(lines,assemblies) {
  const refs=lines.map((line,index)=>{const r=parseReference(line);return r&&{...r,index};}).filter(Boolean);
  const removed=new Set(), replacements=new Map();
  for(const assembly of assemblies) {
    const canonical=assembly.components, anchor=canonical[0], inv=inverse(anchor.matrix);
    if(!inv)continue;
    for(const actual of refs.filter(r=>r.id===anchor.id)) {
      if(removed.has(actual.index))continue;
      const matrix=multiply(actual.matrix,inv);
      const position=subtract(actual.position,vector(matrix,anchor.position));
      const matched=[];
      for(const component of canonical) {
        const match=refs.find(r=>!removed.has(r.index)&&!matched.includes(r)&&r.id===component.id&&r.color===component.color
          &&close(r.matrix,multiply(matrix,component.matrix))&&close(r.position,add(position,vector(matrix,component.position))));
        if(!match)break;
        matched.push(match);
      }
      if(matched.length!==canonical.length)continue;
      const first=Math.min(...matched.map(r=>r.index));
      matched.forEach(r=>removed.add(r.index));
      replacements.set(first,referenceLine({id:assembly.id,color:'16',position,matrix}));
    }
  }
  return lines.flatMap((line,index)=>replacements.has(index)?[replacements.get(index)]:removed.has(index)?[]:[line]);
}
export function applyCustomParts(text,catalog) {
  if(!catalog)return text;
  text=text.replace(/^\uFEFF/,'');
  const sections=[];let current={name:null,lines:[]};
  for(const line of text.split(/\r?\n/)) {
    const match=line.match(/^0\s+FILE\s+(.+)$/i);
    if(match){if(current.name!==null||current.lines.some(s=>s.trim()))sections.push(current);current={name:match[1].trim(),lines:[]};}
    else if(!/^0\s+NOFILE\s*$/i.test(line))current.lines.push(line);
  }
  if(current.name!==null||current.lines.length)sections.push(current);
  const firstModel=sections.findIndex(s=>s.name!==null);
  const root=firstModel<0?0:firstModel;
  for(const section of sections) {
    if(catalog.parts[norm(section.name||'')])continue;
    const result=[];let step=[];
    for(const line of section.lines) {
      if(/^0\s+(STEP|ROTSTEP)\b/i.test(line)){result.push(...assembleStep(step,catalog.assemblies),line);step=[];}
      else step.push(line);
    }
    section.lines=[...result,...assembleStep(step,catalog.assemblies)].map(line=>{
      const r=parseReference(line),alias=r&&catalog.aliases[r.id];
      return alias?referenceLine({...r,id:alias}):line;
    });
  }
  // Remove incidental Studio submodel wrappers around complete hub parts.
  // Compose their transforms into each placement so position and rotation stay exact.
  const hubIds=new Set(catalog.assemblies.map(a=>a.id)),wrappers=new Map();
  let changed=true;
  while(changed){changed=false;
    sections.forEach((section,index)=>{
      const name=norm(section.name||'');
      if(index===root||!name||wrappers.has(name)||catalog.parts[name])return;
      if(section.lines.some(l=>/^0\s+(STEP|ROTSTEP)\b|^[2-5]\s/i.test(l.trim())))return;
      const refs=section.lines.map(parseReference).filter(Boolean);
      if(refs.length!==1)return;
      const ref=wrappers.has(refs[0].id)?compose(refs[0],wrappers.get(refs[0].id)):refs[0];
      if(hubIds.has(ref.id)){wrappers.set(name,ref);changed=true;}
    });
  }
  return sections.filter((s,index)=>index===root||!wrappers.has(norm(s.name||''))).map(section=>{
    const lines=section.lines.map(line=>{const r=parseReference(line);return r&&wrappers.has(r.id)?referenceLine(compose(r,wrappers.get(r.id))):line;});
    return section.name===null?lines.join('\n'):['0 FILE '+section.name,...lines,'0 NOFILE'].join('\n');
  }).join('\n');
}
