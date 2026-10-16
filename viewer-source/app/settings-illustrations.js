// Small local illustrations, independent of the model's renderer and settings.
const TAU = Math.PI * 2;
const STATIC_ANGLE = .67;
const ELEVATION = .62;
const scenes = {
  lineContrast: ['contrast', 'standard'],
  studHighContrast: ['stud'],
  showOldColors: ['red', 'green', 'original', 'fade'],
  showStepRotationAnimations: ['slow', 'normal', 'off'],
};
const isAnimated = scene => scene === 'slow' || scene === 'normal';
const mix = (hex, target, amount) => {
  const a = hex.slice(1).match(/../g).map(v => parseInt(v, 16));
  const b = target.slice(1).match(/../g).map(v => parseInt(v, 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
};
function roundedPerimeter(x, y, w, d, radius) {
  const result = [];
  for (const [cx, cy, start] of [[x+w-radius,y+d-radius,0], [x+radius,y+d-radius,Math.PI/2], [x+radius,y+radius,Math.PI], [x+w-radius,y+radius,Math.PI*1.5]]) {
    for (let i=0; i<=6; i++) {
      const angle = start+i*Math.PI/12;
      result.push([cx+radius*Math.cos(angle), cy+radius*Math.sin(angle)]);
    }
  }
  return result;
}
const bodyLoops = {
  square: roundedPerimeter(0, 0, 2, 2, .12),
  upper: roundedPerimeter(0, 1, 2, 1, .12),
};
function circle(x, y) {
  return Array.from({length: 32}, (_, i) => [x+.255*Math.cos(i*TAU/32), y+.255*Math.sin(i*TAU/32)]);
}
const studs = [[.5,.5],[1.5,.5],[.5,1.5],[1.5,1.5]].map(([x,y]) => ({x,y,loop:circle(x,y)}));
function surface(ctx, points, fill, stroke, lineWidth) {
  ctx.beginPath();
  points.forEach((p,i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=lineWidth; ctx.lineJoin='round'; ctx.stroke(); }
}
function makeLayer(width, height, ratio) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width*ratio); canvas.height = Math.round(height*ratio);
  return canvas;
}

export function drawBrickScene(canvas, scene, {angle=STATIC_ANGLE, scale=20, baseline, darkStud=false, ratio=2, layers}={}) {
  const width=canvas.width/ratio, height=canvas.height/ratio;
  const ctx=canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height);
  const sin=Math.sin(angle), cos=Math.cos(angle), elev=Math.sin(ELEVATION), up=Math.cos(ELEVATION);
  // Every model shares a physical unit and sits on the same baseline. Rotation
  // changes the view only; it never refits/zooms the model on each animation frame.
  const offsetX=width/2, offsetY=(baseline ?? height-7)-(sin+cos)*elev*scale;
  const pt=(x,y,z)=>[(x-1)*cos*scale-(y-1)*sin*scale+offsetX, ((x-1)*sin+(y-1)*cos)*elev*scale-z*up*scale+offsetY];
  const high=scene==='contrast', edge=high?'#29485b':'#8ca9bf', edgeWidth=high?1.35:.45;
  const material=(color,light)=>mix(color, light>=0?'#ffffff':'#274766', Math.abs(light));
  function extrude(target, loop, z, h, color, darkSide=false, stud=false) {
    const sides=[];
    for (let i=0; i<loop.length; i++) {
      const a=loop[i],b=loop[(i+1)%loop.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
      const nx=dy/len,ny=-dx/len;
      if (nx*sin+ny*cos<-.001) continue;
      const shade=-.11-.12*Math.max(0,nx)+.05*Math.max(0,ny);
      sides.push({a,b,depth:(a[0]+b[0])*sin+(a[1]+b[1])*cos,color:material(darkSide?'#172c3d':color,shade)});
    }
    sides.sort((a,b)=>a.depth-b.depth);
    for(const side of sides) surface(target,[pt(...side.a,z),pt(...side.b,z),pt(...side.b,z+h),pt(...side.a,z+h)],side.color);
    // High contrast belongs to the cylinder wall. The stud cap keeps its blue.
    const top=target.createLinearGradient(offsetX-scale,offsetY-scale,offsetX+scale,offsetY+scale);
    top.addColorStop(0,material(color,.28));top.addColorStop(1,color);
    surface(target,loop.map(p=>pt(...p,z+h)),top,edge,edgeWidth);
    target.beginPath();
    for(const side of sides){target.moveTo(...pt(...side.a,z));target.lineTo(...pt(...side.b,z));}
    target.strokeStyle=darkSide?'#172c3d':edge;target.lineWidth=edgeWidth;target.stroke();
    if(stud){
      const cx=loop.reduce((v,p)=>v+p[0],0)/loop.length,cy=loop.reduce((v,p)=>v+p[1],0)/loop.length;
      target.beginPath();
      loop.slice(8,17).forEach((p,i)=>{const q=pt(cx+(p[0]-cx)*.77,cy+(p[1]-cy)*.77,z+h+.003);i?target.lineTo(...q):target.moveTo(...q);});
      target.strokeStyle='rgba(255,255,255,.65)';target.lineWidth=.8;target.lineCap='round';target.stroke();
    }
  }
  function brick(target,{upper=false,z=0,h=.72,color,darkSide=false}) {
    extrude(target,upper?bodyLoops.upper:bodyLoops.square,z,h,color);
    const ordered=studs.filter(s=>!upper||s.y>1).slice().sort((a,b)=>(a.x-b.x)*sin+(a.y-b.y)*cos);
    for(const stud of ordered)extrude(target,stud.loop,z+h,.16,color,darkSide,true);
  }
  const shadowCenter=pt(1,1,0);
  ctx.save();ctx.translate(shadowCenter[0],shadowCenter[1]+4);ctx.scale(1,.32);
  const shadow=ctx.createRadialGradient(0,0,1,0,0,scale*1.35);
  shadow.addColorStop(0,'rgba(58,87,116,.15)');shadow.addColorStop(1,'rgba(58,87,116,0)');
  ctx.fillStyle=shadow;ctx.beginPath();ctx.arc(0,0,scale*1.35,0,TAU);ctx.fill();ctx.restore();
  if(['contrast','standard','stud'].includes(scene)) {
    brick(ctx,{color:scene==='stud'?'#5faeeb':'#e8eff5',darkSide:scene==='stud'&&darkStud});
  } else {
    brick(ctx,{h:.52,color:scene==='fade'?'#f4e9b9':'#d3e3eb'});
    const upper={upper:true,z:.52,h:.56,color:'#51a7ed'};
    if(scene==='red'||scene==='green') {
      const art=layers?.art||makeLayer(width,height,ratio), mask=layers?.mask||makeLayer(width,height,ratio);
      const a=art.getContext('2d'),m=mask.getContext('2d');
      a.setTransform(ratio,0,0,ratio,0,0);a.clearRect(0,0,width,height);brick(a,upper);
      m.setTransform(1,0,0,1,0,0);m.clearRect(0,0,mask.width,mask.height);m.drawImage(art,0,0);
      m.globalCompositeOperation='source-in';m.fillStyle=scene==='red'?'#e94f61':'#16a56c';m.fillRect(0,0,mask.width,mask.height);m.globalCompositeOperation='source-over';
      // Dilate the opaque silhouette, then cover its interior with the original
      // artwork. No face seams or stud edges receive the colored outline.
      const stroke=1.8;
      for(let i=0;i<20;i++)ctx.drawImage(mask,stroke*Math.cos(i*TAU/20),stroke*Math.sin(i*TAU/20),width,height);
      ctx.drawImage(art,0,0,width,height);
    } else brick(ctx,upper);
  }
}

export function mountSettingsIllustrations(form) {
  const views=[];
  for(const input of form.querySelectorAll('input')) {
    const names=scenes[input.name];if(!names)continue;
    const scene=names[input.type==='checkbox'?0:Number(input.value)];
    const canvas=document.createElement('canvas');canvas.className='choice-preview';canvas.dataset.scene=scene;canvas.setAttribute('aria-hidden','true');
    input.after(canvas);
    views.push({canvas,input,scene,fieldset:input.closest('fieldset'),width:0,height:0,scale:0,ratio:2});
  }
  let frame=0,lastFrame=0,elapsed=0,previousTime=0,visible=true,disposed=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function angleAt(scene) {
    if(!isAnimated(scene)||reduced.matches)return STATIC_ANGLE;
    const duration=scene==='slow'?3200:1600;
    // Smooth back-and-forth rotation keeps the preview moving without a jump.
    return .35+(1-Math.cos(elapsed/duration*TAU))*.42;
  }
  function draw(view) {
    if(!view.scale)return;
    drawBrickScene(view.canvas,view.scene,{angle:angleAt(view.scene),scale:view.scale,baseline:view.height-7,darkStud:view.input.checked,ratio:view.ratio,layers:view.layers});
  }
  function layout() {
    if(disposed)return;
    for(const view of views) {
      const r=view.canvas.getBoundingClientRect();view.width=r.width;view.height=r.height;
      view.ratio=Math.min(devicePixelRatio||1,2);
      view.canvas.width=Math.max(1,Math.round(r.width*view.ratio));view.canvas.height=Math.max(1,Math.round(r.height*view.ratio));
      if(view.scene==='red'||view.scene==='green')view.layers={art:makeLayer(r.width,r.height,view.ratio),mask:makeLayer(r.width,r.height,view.ratio)};
    }
    // Use the same scale for groups that share a screen row, including the
    // four highlight examples and three animation examples of the same model.
    const rows=[];
    for(const view of views){
      const y=view.fieldset.getBoundingClientRect().top;
      let row=rows.find(r=>Math.abs(r.y-y)<2);if(!row){row={y,views:[]};rows.push(row);}row.views.push(view);
    }
    for(const row of rows){
      const scale=Math.max(0,Math.min(33,...row.views.map(v=>Math.min((v.width-12)/2.84,(v.height-12)/2.75))));
      for(const view of row.views){view.scale=scale;draw(view);}
    }
  }
  function tick(now) {
    frame=0;if(disposed||document.hidden||!visible||reduced.matches)return;
    if(previousTime)elapsed+=Math.min(now-previousTime,100);previousTime=now;
    if(now-lastFrame>=1000/30){views.filter(v=>isAnimated(v.scene)).forEach(draw);lastFrame=now;}
    frame=requestAnimationFrame(tick);
  }
  function sync() {
    if(frame)cancelAnimationFrame(frame);frame=0;previousTime=0;
    if(disposed)return;
    views.forEach(draw);
    if(!document.hidden&&visible&&!reduced.matches)frame=requestAnimationFrame(tick);
  }
  const resize=new ResizeObserver(layout);views.forEach(v=>resize.observe(v.canvas));
  const intersection=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);sync();});intersection.observe(form);
  function changed(){views.filter(v=>v.scene==='stud').forEach(draw);}
  function dispose(){disposed=true;if(frame)cancelAnimationFrame(frame);resize.disconnect();intersection.disconnect();form.removeEventListener('change',changed);document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);}
  form.addEventListener('change',changed);document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
  window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();else{if(frame)cancelAnimationFrame(frame);frame=0;previousTime=0;}});
  window.addEventListener('pageshow',sync);
  layout();sync();return dispose;
}
