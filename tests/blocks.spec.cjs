// Run with NODE_PATH pointing to a Playwright installation; uses installed Edge.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

async function checkGeometry(page) {
  const errors = await page.evaluate(() => {
    const errors = [];
    const rect = el => el.getBoundingClientRect();
    const near = (a,b,label) => { if(Math.abs(a-b)>1) errors.push(`${label}: ${a} != ${b}`); };
    for(const zone of document.querySelectorAll('#chain, #chain .loop-inner')) {
      const nodes = [...zone.children].filter(el => el.matches('.program-block, .start'));
      nodes.forEach((el,i) => {
        const r=rect(el);
        if(i) {
          const prev=nodes[i-1], p=rect(prev);
          near(p.left+Number(prev.dataset.advance),r.left,'mating x');
          near(p.top+Number(prev.dataset.connectorY),r.top+Number(el.dataset.connectorY),'mating y');
        }
      });
      if(zone.matches('.loop-inner')) {
        const loop=zone.parentElement, lr=rect(loop), zr=rect(zone);
        near(Number(loop.dataset.connectorY),Number(loop.dataset.internalConnectorY),'inside/outside baseline');
        if(nodes.length) {
          near(rect(nodes[0]).left,zr.left,'left arm');
          const last=nodes.at(-1);
          near(rect(last).left+Number(last.dataset.advance),zr.right,'right arm');
          near(rect(nodes[0]).top+Number(nodes[0].dataset.connectorY),lr.top+Number(loop.dataset.internalConnectorY),'internal y');
        }
        for(const el of nodes) {
          const cr=rect(el);
          if(cr.top<lr.top+14 || cr.bottom>lr.bottom+1) errors.push('child clipped');
        }
        if(nodes.length) near(Math.min(...nodes.map(el=>rect(el).top)),lr.top+14,'no gap below beam');
      }
    }
    const bubbles=[...document.querySelectorAll('#chain .param-bubble')];
    bubbles.forEach((a,i)=>bubbles.slice(i+1).forEach(b=>{
      const ar=rect(a),br=rect(b);
      if(Math.min(ar.right,br.right)>Math.max(ar.left,br.left)+1 && Math.min(ar.bottom,br.bottom)>Math.max(ar.top,br.top)+1) errors.push('parameter overlap');
    }));
    return errors;
  });
  assert.deepEqual(errors,[]);
}
async function drag(page, selector, point) {
  const source=page.locator(selector);
  await source.scrollIntoViewIfNeeded();
  const r=await source.boundingBox();
  await page.mouse.move(r.x+20,r.y+20);
  await page.mouse.down();
  await page.mouse.move(point.x,point.y,{steps:12});
  await page.mouse.up();
}
async function touchDrag(page, selector, point) {
  const source=page.locator(selector);
  await source.scrollIntoViewIfNeeded();
  const r=await source.boundingBox();
  const session=await page.context().newCDPSession(page);
  const x=r.x+20,y=r.y+20;
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=12;i++) await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(point.x-x)*i/12,y:y+(point.y-y)*i/12}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await session.detach();
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    for(const viewport of [{width:1280,height:800},{width:844,height:390},{width:390,height:844}]) {
      const context=await browser.newContext({viewport,hasTouch:viewport.width<1000});
      const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(process.env.CARDS_URL || 'http://127.0.0.1:4173/#editor');
      await page.locator('#palette [data-card-id="motor-forward"]').click();
      await page.locator('#palette [data-card-id="motor-reverse"]').click();
      await checkGeometry(page);
      await page.evaluate(()=>{
        program=[];
        addCard('motor-forward'); addCard('loop-count'); addCard('motor-stop');
      });
      await checkGeometry(page);
      await page.evaluate(()=>{
        addCard('motor-reverse',[1]); addCard('loop-count',[1]);
        addCard('loop',[1,1]); addCard('wait-time',[1,1,0]);
        addCard('ultrasonic-sensor',[1,1]); addCard('motor-stop',[1]);
      });
      await checkGeometry(page);
      await page.screenshot({path:path.join(os.tmpdir(),`cards-nested-${viewport.width}.png`)});
      await page.locator('#saveBtn').click();
      const saved=await page.evaluate(()=>getProgramSnapshot());
      await page.locator('#clearBtn').click();
      assert.equal(await page.locator('#loadBtn').count(),0);
      await page.evaluate(()=>loadProgram());
      assert.equal(await page.evaluate(()=>getProgramSnapshot()),saved);
      await checkGeometry(page);
      await page.evaluate(()=>{program=[];renderProgram();addCard('loop-count');});
      // Drop into the cavity, then drop a following instruction outside the right arm.
      let r=await page.locator('#chain > .loop-block > .loop-inner').boundingBox();
      await drag(page,'#palette [data-card-id="motor-forward"]',{x:r.x+20,y:r.y+25});
      assert.equal(await page.evaluate(()=>program[0].children.length),1);
      await checkGeometry(page);
      r=await page.locator('#chain > .loop-block').boundingBox();
      if(r.x+r.width+12<viewport.width) {
        await drag(page,'#palette [data-card-id="motor-stop"]',{x:r.x+r.width+12,y:r.y+r.height-38});
        assert.equal(await page.evaluate(()=>program.length),2);
        assert.equal(await page.evaluate(()=>program[0].children.length),1);
      }
      await checkGeometry(page);
      const param=page.locator('#chain > .loop-block > .loop-tail > .param-bubble');
      if(viewport.width<1000) await param.tap(); else await param.click();
      assert.equal(await page.locator('#paramEditor').isVisible(),true);
      const input=page.locator('#paramEditor input');
      await input.fill('4');await input.press('Tab');
      assert.equal(await page.evaluate(()=>program[0].params.count),4);
      await page.locator('#startBlock').click();
      await checkGeometry(page);
      await page.screenshot({path:path.join(os.tmpdir(),`cards-interaction-${viewport.width}.png`)});
      // Move an existing child out of the loop with a real touch stream on mobile.
      const doDrag=viewport.width<1000 ? touchDrag : drag;
      r=await page.locator('#startBlock').boundingBox();
      await doDrag(page,'#chain .loop-inner > .program-block',{x:r.x+r.width+4,y:r.y-30});
      assert.equal(await page.evaluate(()=>program[0].id),'motor-forward');
      assert.equal(await page.evaluate(()=>program[1].children.length),0);
      await checkGeometry(page);
      await page.locator('#undoBtn').click();
      assert.equal(await page.evaluate(()=>program[0].children.length),1);
      await page.locator('#redoBtn').click();
      assert.equal(await page.evaluate(()=>program[1].children.length),0);
      // Reinsert that instruction, verifying touch drop into the original cavity.
      r=await page.locator('#chain > .loop-block > .loop-inner').boundingBox();
      await doDrag(page,'#chain > [data-card-id="motor-forward"]',{x:r.x+20,y:r.y+25});
      assert.equal(await page.evaluate(()=>program[0].children.length),1);
      await checkGeometry(page);
      if(viewport.width===1280) {
        await page.evaluate(()=>{program=[];renderProgram();addCard('loop-count');});
        await page.locator('#tab-logic').click();
        r=await page.locator('#chain > .loop-block > .loop-inner').boundingBox();
        await drag(page,'#palette [data-card-id="loop-count"] > .loop-left',{x:r.x+20,y:r.y+25});
        assert.equal(await page.evaluate(()=>program[0].children[0].id),'loop-count');
        await checkGeometry(page);
        r=await page.locator('#chain .loop-inner .loop-inner').boundingBox();
        await drag(page,'#palette [data-card-id="wait-time"]',{x:r.x+20,y:r.y+25});
        assert.equal(await page.evaluate(()=>program[0].children[0].children[0].id),'wait-time');
        await checkGeometry(page);
        // A loop cannot be moved into its own subtree.
        assert.equal(await page.evaluate(()=>{
          const before=getProgramSnapshot();
          moveProgramNode([0],[0,0],0);
          return getProgramSnapshot()===before;
        }),true);
        await page.evaluate(()=>{
          const group=document.createElement('div');
          group.className='grab-group-projection program-block';
          group.append(createStagedPreviewNode(program[0]),createStagedPreviewNode(createProgramItem('motor-stop')));
          BlockLayout.measure(group);
          const [a,b]=group.children;
          if(parseFloat(b.style.left)!==Number(a.dataset.advance)) throw Error('group connections');
        });
        await page.evaluate(()=>{
          program=[];renderProgram();
          addCard('loop');addCard('loop-count');addCard('motor-forward',[1]);
          program[1].children[0].params.duration=123456789;
          renderProgram();
        });
        assert.equal(await page.locator('#chain > [data-card-id="loop"] > .loop-tail > .param-bubble').count(),0);
        await checkGeometry(page);
      }
      await page.evaluate(()=>{
        program=[];renderProgram();
        addCard('motor-forward');addCard('ultrasonic-sensor');addCard('motor-reverse');
      });
      // A directly dragged filled loop can be staged without prior multi-selection.
      await page.evaluate(()=>{
        program=[];stagedGroups=[];renderProgram();
        addCard('loop-count');addCard('combo-backward',[0]);
        program[0].params.count=4;program[0].children[0].params.duration=3;
        renderProgram();selectCategory('staging');
        programCanvas.scrollTop=0;programCanvas.scrollLeft=0;
      });
      const loopBeforeStage=await page.evaluate(()=>JSON.stringify(program));
      const libraryRect=await page.locator('#palette').boundingBox();
      await doDrag(page,'#chain > .loop-block > .loop-tail',{x:100,y:libraryRect.y+35});
      assert.equal(await page.evaluate(()=>program.length),0);
      assert.equal(await page.evaluate(()=>stagedGroups.length),1);
      assert.equal(await page.evaluate(()=>JSON.stringify(stagedGroups[0].items)),loopBeforeStage);
      r=await page.locator('#startBlock').boundingBox();
      await doDrag(page,'#palette > .staged-group',{x:r.x+r.width+20,y:r.y+30});
      assert.equal(await page.evaluate(()=>stagedGroups.length),0);
      assert.equal(await page.evaluate(()=>JSON.stringify(program)),loopBeforeStage);
      await checkGeometry(page);
      await page.evaluate(()=>{
        program=[];renderProgram();
        addCard('motor-forward');addCard('ultrasonic-sensor');addCard('motor-reverse');
      });
      const beforeDrag=await page.evaluate(()=>getProgramSnapshot());
      const sourceRect=await page.locator('#chain > [data-card-id="ultrasonic-sensor"]').boundingBox();
      r=await page.locator('#chain > [data-card-id="motor-reverse"]').boundingBox();
      await page.mouse.move(sourceRect.x+20,sourceRect.y+20);
      await page.mouse.down();
      await page.mouse.move(Math.min(viewport.width-10,r.x+r.width+4),r.y+25,{steps:12});
      const dragCheck=await page.evaluate(()=>{
        const source=chain.querySelector('.drag-source-placeholder');
        const visible=[...chain.children].filter(el=>el.matches('.start,.program-block,.drop-projection')&&!el.matches('.drag-source-placeholder'));
        return {
          hidden:getComputedStyle(source).visibility==='hidden',
          projections:chain.querySelectorAll('.drop-projection').length,
          contiguous:visible.every((el,i)=>!i || Math.abs(el.getBoundingClientRect().left-visible[i-1].getBoundingClientRect().left-Number(visible[i-1].dataset.advance))<1)
        };
      });
      assert.deepEqual(dragCheck,{hidden:true,projections:1,contiguous:true});
      await page.screenshot({path:path.join(os.tmpdir(),`cards-single-projection-${viewport.width}.png`)});
      await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      await page.mouse.up();
      assert.equal(await page.evaluate(()=>getProgramSnapshot()),beforeDrag);
      assert.equal(await page.locator('.drag-source-placeholder,.drop-projection,.ghost').count(),0);
      await checkGeometry(page);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${viewport.width}x${viewport.height}: geometry, 3-level nesting, drag in/out, parameters, save/load, undo/redo`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
