const {chromium}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:844,height:390}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:4173/dist/viewer/settings.html');
    await page.locator('canvas.choice-preview').first().waitFor();
    assert.equal(await page.locator('canvas.choice-preview').count(),10);
    assert.equal(await page.getByText('演示翻页').count(),0);
    const pixelChecks=await page.evaluate(async()=>{
      const {drawBrickScene}=await import('./app/settings-illustrations.js');
      const make=(scene,darkStud=false)=>{const c=document.createElement('canvas');c.width=220;c.height=180;drawBrickScene(c,scene,{scale:42,baseline:165,ratio:1,darkStud});return c;};
      const angle=.67,elev=Math.sin(.62),up=Math.cos(.62),sin=Math.sin(angle),cos=Math.cos(angle);
      const point=(x,y,z)=>[Math.round(110+((x-1)*cos-(y-1)*sin)*42),Math.round(165-(sin+cos)*elev*42+(((x-1)*sin+(y-1)*cos)*elev-z*up)*42)];
      const sample=(c,p)=>[...c.getContext('2d').getImageData(...p,1,1).data];
      const normal=make('stud'),high=make('stud',true);
      const cap=point(1.5,1.5,.88),wall=point(1.5+.255*sin,1.5+.255*cos,.8);
      const original=make('original'),red=make('red'),green=make('green');
      const interior=[point(.5,1.5,1.24),point(.95,1.5,1.08),point(1.5,2,.8)];
      const redPixels=red.getContext('2d').getImageData(0,0,220,180).data;
      let redCount=0;for(let i=0;i<redPixels.length;i+=4)if(redPixels[i]>180&&redPixels[i+1]<130&&redPixels[i+2]<150&&redPixels[i+3]>200)redCount++;
      return {capNormal:sample(normal,cap),capHigh:sample(high,cap),wallNormal:sample(normal,wall),wallHigh:sample(high,wall),interior:interior.map(p=>[sample(original,p),sample(red,p),sample(green,p)]),redCount};
    });
    assert.deepEqual(pixelChecks.capHigh,pixelChecks.capNormal,'Stud cap must retain its original color');
    assert.ok(pixelChecks.wallHigh[0]+pixelChecks.wallHigh[1]+pixelChecks.wallHigh[2]<pixelChecks.wallNormal.slice(0,3).reduce((a,b)=>a+b,0)/2,'Stud wall must darken');
    for(const [plain,red,green] of pixelChecks.interior){assert.deepEqual(red,plain,'No red inside the new brick');assert.deepEqual(green,plain,'No green inside the new brick');}
    assert.ok(pixelChecks.redCount>50,'Red silhouette must remain visible');
    for(const [width,height] of [[1280,800],[844,390],[751,360],[640,320],[568,280],[390,844]]){
      await page.setViewportSize({width,height});
      const boxes=await page.locator('.choice').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect(),c=e.querySelector('canvas').getBoundingClientRect(),t=e.querySelector('strong').getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height,canvasRight:c.right,canvasBottom:c.bottom,labelLeft:t.left,labelTop:t.top,labelBottom:t.bottom};}));
      assert.ok(boxes.every(b=>b.x>=0&&b.right<=width+.1&&b.width>=44&&b.height>=44&&b.labelBottom<=b.bottom+.1&&(b.canvasBottom<=b.labelTop+.1||b.canvasRight<=b.labelLeft+.1)),`Cards, figures and labels must not overlap at ${width}×${height}`);
      if(width>height){assert.ok(boxes.every(b=>b.bottom<=height+.1));assert.ok(Math.max(...boxes.slice(3).map(b=>b.canvasBottom))-Math.min(...boxes.slice(3).map(b=>b.canvasBottom))<1,'All lower-row drawings share a baseline');}
    }
    await page.setViewportSize({width:844,height:390});
    // Let responsive canvas buffers settle after the final viewport change.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const snapshots=()=>page.locator('canvas[data-scene="slow"],canvas[data-scene="normal"],canvas[data-scene="off"]').evaluateAll(es=>es.map(e=>e.toDataURL()));
    const first=await snapshots();
    await page.waitForTimeout(420);const moving=await snapshots();
    assert.ok(first[0]!==moving[0],'Slow preview must move');assert.ok(first[1]!==moving[1],'Normal preview must move');assert.ok(first[2]===moving[2],'Off preview must remain static');
    await page.waitForTimeout(3400);const later=await snapshots();await page.waitForTimeout(250);const stillMoving=await snapshots();
    assert.ok(later[0]!==stillMoving[0],'Slow preview must keep looping');assert.ok(later[1]!==stillMoving[1],'Normal preview must keep looping');assert.ok(later[2]===stillMoving[2],'Off preview must remain static between loops');
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(60);const reduced=await snapshots();await page.waitForTimeout(160);assert.deepEqual(await snapshots(),reduced);
    assert.deepEqual(errors,[]);
    console.log('PASS colored caps/dark stud walls, external silhouettes, aligned responsive illustrations, continuous slow/normal animation, static off and reduced motion.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
