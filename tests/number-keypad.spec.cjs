// Shared keypad: immediate application, 3×4 layout, bounds and outside dismissal.
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
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.CARDS_URL || 'http://127.0.0.1:4173/#editor');
      const key = value => page.locator(`.number-key[data-key="${value}"]`);
      const type = async value => { for (const digit of value) await key(digit).tap(); };
      const read = () => page.locator('.number-keypad-value').textContent();
      const open = async id => {
        await page.evaluate(id => { closeParamEditor(); program=[]; renderProgram(); addCard(id); }, id);
        await page.locator('#chain .param-bubble').tap();
        await page.locator('#paramEditor .param-current').tap();
      };
      const assertFits = async () => {
        const rect = await page.locator('#paramEditor').boundingBox();
        assert.ok(rect.x>=0 && rect.y>=0 && rect.x+rect.width<=viewport.width && rect.y+rect.height<=viewport.height, JSON.stringify(rect));
        assert.equal(await page.locator('.number-key').count(),12);
        assert.deepEqual(await page.locator('.number-key').evaluateAll(nodes=>nodes.map(node=>node.dataset.key)),['1','2','3','4','5','6','7','8','9','.','0','delete']);
        assert.equal(await page.locator('[data-key=confirm],[data-key=cancel]').count(),0);
        assert.ok(await page.locator('.number-keypad').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Keypad must not scroll');
        for (const button of await page.locator('.number-key').all()) {
          const bounds = await button.boundingBox();
          assert.ok(bounds.width>=44 && bounds.height>=44,'Touch targets must be at least 44px');
        }
      };

      await open('motor-forward');
      await assertFits();
      await type('2.5');
      assert.equal(await read(),'2.5');
      assert.equal(await page.evaluate(()=>program[0].params.duration),2.5,'valid input applies immediately');
      await key('delete').tap();
      assert.equal(await read(),'2.');
      assert.equal(await page.evaluate(()=>program[0].params.duration),2);
      await key('7').tap();
      assert.equal(await page.evaluate(()=>program[0].params.duration),2.7);
      await page.touchscreen.tap(viewport.width-4,60);
      assert.equal(await page.locator('#paramEditor').isVisible(),false,'outside tap closes the keypad');
      assert.equal(await page.evaluate(()=>program[0].params.duration),2.7);

      await page.locator('#chain .param-bubble').tap();
      await page.locator('#paramEditor .param-current').tap();
      await type('0.1');
      assert.equal(await page.evaluate(()=>program[0].params.duration),0.1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#paramEditor').isVisible(),false);

      await open('loop-count');
      await assertFits();
      assert.equal(await key('.').isDisabled(),true);
      await page.keyboard.type('12');
      assert.equal(await page.evaluate(()=>program[0].params.count),12);
      await page.locator('.number-keypad').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#paramEditor').isVisible(),false);
      assert.equal(await page.evaluate(()=>program[0].params.count),12);

      const ids = await page.evaluate(()=>Object.values(cardById).filter(card=>Object.values(card.paramsSchema||{}).some(param=>param.type==='number')).map(card=>card.id));
      for (const id of ids) {
        await open(id);
        await assertFits();
        await page.touchscreen.tap(viewport.width-4,60);
      }
      await open('wait-time');
      await type('3.5');
      fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});
      await page.screenshot({path:path.resolve(__dirname,`../artifacts/number-keypad-${viewport.width}.png`)});
      assert.deepEqual(errors,[]);
      console.log(`PASS keypad ${viewport.width}x${viewport.height}: immediate apply, 3x4 keys, outside close, ${ids.length} numeric cards`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
