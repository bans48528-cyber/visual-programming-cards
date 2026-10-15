import {disableStudLogos} from './viewer-policy.js';
disableStudLogos();
const form=document.getElementById('settings-form');
const status=document.getElementById('save-status');
const back=document.getElementById('settings-back');
const choices={lineContrast:[0,1],studHighContrast:[0,1],showOldColors:[0,1,2,3],showStepRotationAnimations:[0,1,2]};
const defaults={lineContrast:0,studHighContrast:0,showOldColors:0,showStepRotationAnimations:1};
const params=new URLSearchParams(location.search);
const id=params.get('id');
const requestedStep=Number(params.get('step'));
const step=Number.isSafeInteger(requestedStep)&&requestedStep>0?requestedStep:1;
if(id){
  const url=new URL('/instructions.html',location.origin);
  url.searchParams.set('id',id);url.searchParams.set('step',step);back.href=url.pathname+url.search;
}else back.textContent='← 返回首页';
// Replacing this history entry avoids a settings -> viewer -> settings loop.
back.addEventListener('click',event=>{
  if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();if(params.get('embedded')==='1'){parent.postMessage({source:'viewer-settings',type:'close'},location.origin);}else location.replace(back.href);
});
for(const input of form.querySelectorAll('input')){
  let value=LDR.Options[input.name];
  if(!choices[input.name].includes(value))value=defaults[input.name];
  input.checked=input.type==='checkbox'?value===1:Number(input.value)===value;
}
form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('change',event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement)||!choices[input.name])return;
  const value=input.type==='checkbox'?Number(input.checked):Number(input.value);
  if(!choices[input.name].includes(value))return;
  LDR.Options[input.name]=value;
  if(input.name==='lineContrast')LDR.Options.lineColor=value===0?0:0x333333;
  // Use the same options and cookie writer as the upstream viewer.
  LDR.Options.onChange(input.name==='studHighContrast');
  status.textContent='已保存';
});
document.body.dataset.ready='true';

// Reuse the upstream option illustrations, including the animated rotation previews.
for(const input of form.querySelectorAll('input')){
 const options=Object.assign(Object.create(LDR.Options),{listeners:[],topOptionsGroup:null});
 window.options=options; // Upstream stud preview reads this legacy global.
 const holder=document.createElement('div');let index=0;
 if(input.name==='lineContrast'){options.lineContrast=Number(input.value);options.appendContrastOptions(holder);}
 else if(input.name==='studHighContrast'){options.appendStudHighContrastOptions(holder);}
 else if(input.name==='showOldColors'){options.appendOldBrickColorOptions(holder);index=Number(input.value);}
 else {options.appendAnimationOptions(holder);index=Number(input.value);}
 const svg=holder.querySelectorAll('td.option>svg,td.option_selected>svg')[index];
 if(svg){svg.classList.add('choice-preview');svg.setAttribute('aria-hidden','true');input.closest('label').insertBefore(svg,input.nextSibling);}
}
function selected(){for(const label of form.querySelectorAll('label'))label.classList.toggle('is-selected',label.querySelector('input').checked);}
selected();form.addEventListener('change',()=>{
 selected();if(params.get('embedded')==='1')parent.postMessage({source:'viewer-settings',type:'change',values:Object.fromEntries(Object.keys(choices).map(k=>[k,LDR.Options[k]]))},location.origin);
});
