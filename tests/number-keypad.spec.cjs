// Shared web keypad: actual pointer input, validation, atomic edits and small screens.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    for (const viewport of [{width:1280,height:800},{width:844,height:390},{width:390,height:844},{width:568,height:320}]) {
      const context = await browser.newContext({viewport,hasTouch:true});
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(process.env.CARDS_URL || 'http://127.0.0.1:4173/#editor');
      const key = value => page.locator(`.number-key[data-key="${value}"]`);
      const type = async value => {for (const digit of value) await key(digit).tap();};
      const read = () => page.locator('.number-keypad-value').textContent();
      const open = async id => {
        await page.evaluate(id => {closeParamEditor(); program=[]; renderProgram(); addCard(id);}, id);
        await page.locator('#chain .param-bubble').tap();
        await page.locator('#paramEditor .param-current').tap();
      };
      const assertFits = async () => {
        const rect = await page.locator('#paramEditor').boundingBox();
        assert.ok(rect.x>=0 && rect.y>=0 && rect.x+rect.width<=viewport.width && rect.y+rect.height<=viewport.height, JSON.stringify(rect));
        assert.equal(await page.locator('#paramEditor input, #paramEditor textarea, #paramEditor [contenteditable=true]').count(),0);
        assert.ok(await page.locator('.number-keypad').evaluate(el=>el.scrollHeight<=el.clientHeight+1), 'All keys fit without scrolling');
        for (const button of await page.locator('.number-key').all()) {
          const r = await button.boundingBox();
          assert.ok(r.width>=44 && r.height>=44, 'Touch targets must be at least 44px');
        }
      };
      await open('motor-forward');
      await assertFits();
      const before = await page.evaluate(()=>historyIndex);
      await type('2.5');
      assert.equal(await read(),'2.5');
      assert.equal(await page.evaluate(()=>program[0].params.duration),1);
      await key('9').tap(); // Step is 0.1; a second fractional digit is ignored.
      assert.equal(await read(),'2.5');
      assert.equal(await key('.').isDisabled(),true);
      await key('delete').tap();
      assert.equal(await read(),'2.');
      await key('7').tap();
      await key('confirm').tap();
      assert.equal(await page.evaluate(()=>program[0].params.duration),2.7);
      assert.equal(await page.evaluate(()=>historyIndex),before+1);
      assert.equal(await page.evaluate(()=>program[0].params.port),'E');
      await page.locator('#undoBtn').tap();
      assert.equal(await page.evaluate(()=>program[0].params.duration),1);
      await page.locator('#redoBtn').tap();
      assert.equal(await page.evaluate(()=>program[0].params.duration),2.7);
      await page.locator('#chain .param-bubble').tap();
      await page.locator('#paramEditor .param-current').tap();
      await key('clear').tap();
      assert.equal(await key('confirm').isDisabled(),true);
      await key('0').tap();
      assert.equal(await key('confirm').isDisabled(),true);
      await type('.1');
      await key('confirm').tap();
      assert.equal(await page.evaluate(()=>program[0].params.duration),0.1);
      await page.locator('#paramEditor .param-current').tap();
      await type('9');
      await key('cancel').tap();
      assert.equal(await page.evaluate(()=>program[0].params.duration),0.1);
      await page.locator('#paramEditor .param-current').tap();
      await type('8');
      await page.touchscreen.tap(viewport.width-4,60); // Blank canvas outside the popover.
      assert.equal(await page.locator('#paramEditor').isVisible(),false);
      assert.equal(await page.evaluate(()=>program[0].params.duration),0.1);
      await open('ultrasonic-sensor');
      await assertFits();
      assert.equal(await key('.').isDisabled(),true);
      await type('101');
      assert.equal(await key('confirm').isDisabled(),true);
      assert.match(await page.locator('.number-keypad-hint').textContent(),/0–100/);
      await key('delete').tap();
      await key('0').tap();
      await key('confirm').tap();
      assert.equal(await page.evaluate(()=>program[0].params.distance),100);
      await page.locator('#paramEditor .param-current').tap();
      await type('000');
      assert.equal(await read(),'0');
      await key('confirm').tap();
      assert.equal(await page.evaluate(()=>program[0].params.distance),0);
      await open('loop-count');
      await assertFits();
      await page.keyboard.type('12');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>program[0].params.count),12);
      await page.locator('#paramEditor .param-current').tap();
      await page.keyboard.type('4.');
      assert.equal(await read(),'4');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>program[0].params.count),12);
      // Confirming an unchanged value does not add an undo step.
      const unchanged = await page.evaluate(()=>historyIndex);
      await page.locator('#paramEditor .param-current').tap();
      await key('confirm').tap();
      assert.equal(await page.evaluate(()=>historyIndex),unchanged);
      const ids = await page.evaluate(()=>Object.values(cardById).filter(card=>Object.values(card.paramsSchema||{}).some(p=>p.type==='number')).map(card=>card.id));
      for (const id of ids) {
        await open(id);
        await assertFits();
        await key('cancel').tap();
      }
      await open('wait-time');
      await type('3.5');
      fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});
      await page.screenshot({path:path.resolve(__dirname,`../artifacts/number-keypad-${viewport.width}.png`)});
      assert.deepEqual(errors,[]);
      console.log(`PASS keypad ${viewport.width}x${viewport.height}: ${ids.length} numeric cards, decimals, bounds, cancel, undo, touch and physical keys`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
