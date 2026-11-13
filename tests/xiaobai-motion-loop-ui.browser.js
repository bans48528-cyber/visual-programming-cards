/* Run as Runtime.evaluate through CUA on an isolated local QA origin with the
 * Xiaobai model active. Uses the shipping renderer and parameter button handlers.
 * Restores the workspace/category; never opens a transport or runs a program.
 */
(async function verifyMotionLoopUi(){
  const saved=CardEditor.getWorkspace(),results=[];
  const palette=document.getElementById('palette'),savedScroll=palette.scrollLeft;
  const savedTab=document.querySelector('.tabs [aria-selected="true"]')?.id;
  const frame=()=>new Promise(requestAnimationFrame),copy=value=>JSON.parse(JSON.stringify(value));
  const check=(value,message)=>{if(!value)throw Error(message);};
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const equal=(a,b,message)=>check(JSON.stringify(canonical(a))===JSON.stringify(canonical(b)),message);
  const wait=uid=>({uid,id:'wait-time',params:{duration:1}});
  const item=(id,params,children)=>({id,uid:'ui-'+id,params,...(children?{children}:{})});
  const direct=(el,selector)=>[...el.children].find(e=>e.matches(selector));
  const bubble=el=>direct(el,'.param-bubble')||direct(direct(el,'.loop-tail'),'.param-bubble');
  const node=uid=>CardEditor.findBlockByUid(uid);
  const current=()=>CardEditor.getWorkspace().groups[0].items[0];
  const panel=()=>document.getElementById('paramEditor');
  function fits(){
    const r=panel().getBoundingClientRect();
    check(r.left>=5&&r.top>=5&&r.right<=innerWidth-5&&r.bottom<=innerHeight-5,'parameter panel outside viewport');
    for(const button of panel().querySelectorAll('.param-option-btn')){
      const b=button.getBoundingClientRect();
      check(b.height>=40&&b.left>=r.left&&b.right<=r.right,'option clipped or touch target too short');
    }
    return {width:r.width,height:r.height};
  }
  async function load(value,scale=1){
    CardCanvas.cancel();
    CardEditor.setWorkspace({schemaVersion:2,kind:'free-canvas',groups:[{id:'ui-group',startId:'ui-head',x:80,y:125,items:[value]}],
      viewport:{x:0,y:0,scale},selectedGroupId:'ui-group'});
    await frame();
  }
  async function open(uid){bubble(node(uid)).click();await frame();check(!panel().hidden,'parameter panel did not open');return fits();}
  async function option(label){
    const control=[...panel().querySelectorAll('.param-option-btn')].find(b=>b.getAttribute('aria-label')===label);
    check(control,'missing option '+label);control.click();await frame();
  }
  try{
    check(CardModelSession.current.id==='xiaobai','Xiaobai model must be active on the QA origin');
    document.getElementById('tab-logic').click();await frame();await frame();
    const expected=['wait-time','tilt-wait','motion-wait','loop-count','loop','loop-infrared','loop-tilt','loop-time','infrared-wait'];
    check(palette.querySelector('[data-card-id="__start__"]'),'start head missing from palette');
    equal([...palette.querySelectorAll(':scope > [data-palette-category="logic"]')].map(el=>el.dataset.cardId),expected,'logic palette order/catalog changed');
    for(const id of ['loop-infrared','loop-tilt','loop-time'])check(palette.querySelector(`[data-card-id="${id}"]`).classList.contains('loop-palette-card'),'new loop lacks palette C shape');
    results.push({case:'logic-catalog-and-three-C-shapes',pass:true});

    await load(item('tilt-wait',{direction:'forward'}));await open('ui-tilt-wait');
    equal([...panel().querySelectorAll('.param-option-btn')].map(b=>b.textContent),['向前','向后','向左','向右'],'tilt still exposes a motion state');
    results.push({case:'tilt-only-four-directions',pass:true});

    await load(item('motion-wait',{state:'still'}));const motionBounds=await open('ui-motion-wait');
    equal([...panel().querySelectorAll('.param-option-btn')].map(b=>b.textContent),['平稳','持续晃动','向上抬一下','向下放一下'],'motion labels/options incorrect');
    const motionHelp=panel().querySelector('.param-help')?.textContent||'';
    for(const text of ['机身Z轴','无需先静止或停稳','制动','持续超阈值只触发一次','新反向事件'])
      check(motionHelp.includes(text),'acceleration guidance missing: '+text);
    check(!motionHelp.includes('动作后再停稳'),'old complete-gesture guidance remains');
    for(const [label,state] of [['平稳','still'],['持续晃动','shaking'],['向上抬一下','up'],['向下放一下','down']]){
      await option(label);check(current().params.state===state,'motion state not saved: '+state);
      check(bubble(node('ui-motion-wait')).textContent===label,'motion bubble incorrect: '+label);fits();
    }
    const motionCommitted=copy(CardEditor.getWorkspace());CardEditor.undo();await frame();
    check(current().params.state==='up','undo did not restore previous motion parameter');CardEditor.redo();await frame();
    equal(CardEditor.getWorkspace(),motionCommitted,'redo did not restore motion parameter and UID/layout');
    results.push({case:'motion-four-states-help-undo-redo',bounds:motionBounds,pass:true});

    for(const [id,params] of [['loop-infrared',{comparison:'greater',threshold:50}],['loop-tilt',{direction:'forward'}],['loop-time',{duration:5}]]){
      await load(item(id,params,[wait('ui-child')]),.8);
      const el=node('ui-'+id);check(el.classList.contains('loop-block'),'program loop lost C shape');
      check(direct(el,'.loop-inner').querySelector('[data-node-uid="ui-child"]'),'loop child missing');
      const bounds=await open('ui-'+id),help=panel().querySelector('.param-help')?.textContent||'';
      check(help.includes('重复直到')&&help.includes('整轮')&&help.includes('无限内循环')&&help.includes('停止立即生效'),'repeat-until/whole-round/permanent-inner/stop explanation missing: '+id);
      check(bubble(el).querySelector('.conditional-loop-prefix')?.textContent==='重复直到','visible repeat-until bubble prefix missing');
      if(id==='loop-infrared'){
        check(help.includes('等于阈值不满足'),'strict comparison guidance missing');await option('小于');
        panel().querySelector('[aria-label="增加数值"]').click();await frame();
        equal(current().params,{comparison:'less',threshold:51},'IR loop parameters not edited independently');
      }else if(id==='loop-tilt'){
        await option('向右');check(current().params.direction==='right','tilt loop did not save target');
      }else{
        check(help.includes('进入本循环开始计时'),'entry-time explanation missing');
        panel().querySelector('[aria-label="增加累计时间"]').click();await frame();
        // Existing +/- buttons change one unit; decimal entry uses the keypad.
        check(current().params.duration===6&&bubble(node('ui-'+id)).textContent==='重复直到6秒','time loop numeric edit/bubble incorrect');
      }
      fits();results.push({case:id+'-C-parameters-help',bounds,pass:true});
    }

    await load(item('loop-time',{duration:86400},[wait('max-time-child')]));
    check(bubble(node('ui-loop-time')).textContent==='重复直到86400秒','time loop bubble truncates the actual duration');
    await load(item('loop-time',{duration:0},[wait('zero-time-child')]));
    check(current().params.duration===0&&bubble(node('ui-loop-time')).textContent==='重复直到0秒','zero-second entry condition cannot be represented');
    results.push({case:'time-boundaries-visible',pass:true});

    const nested=item('loop-infrared',{comparison:'less',threshold:0},[
      item('loop-tilt',{direction:'right'},[item('loop-time',{duration:5.5},[
        ...['still','shaking','up','down'].map((state,i)=>({uid:'nested-motion-'+i,id:'motion-wait',params:{state}}))])])]);
    await load(nested,.6);
    const nestedDoc=copy(CardEditor.getWorkspace());
    CardEditor.setWorkspace(copy(nestedDoc));await frame();equal(CardEditor.getWorkspace(),nestedDoc,'nested save/load changed parameters, UIDs or layout');
    for(const uid of ['ui-loop-infrared','ui-loop-tilt','ui-loop-time'])check(node(uid)?.classList.contains('loop-block'),'nested loop renderer missing '+uid);
    for(let i=0;i<4;i++)check(node('nested-motion-'+i),'nested motion node missing');
    results.push({case:'nested-loop-layout-and-roundtrip',pass:true});
    return {pass:true,input:'DOM parameter button handlers, shipping renderer and workspace load/save',viewport:{width:innerWidth,height:innerHeight},results};
  }finally{
    CardCanvas.cancel();CardEditor.setWorkspace(saved);
    if(savedTab)document.getElementById(savedTab)?.click();palette.scrollLeft=savedScroll;
  }
})();
