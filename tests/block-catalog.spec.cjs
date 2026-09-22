const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '../dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#editor`);

    assert.equal(await page.locator('.workspace').evaluate(el => el.getBoundingClientRect().top), 0);
    for (const selector of ['.brand-title', '#deviceStatus', '#undoBtn', '#redoBtn', '#clearBtn', '.topbar .remote-entry']) {
      assert.equal(await page.locator(selector).isVisible(), false, `${selector} should be hidden in the editor`);
    }
    const controls = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect().toJSON();
      return { left: ['homeBtn', 'saveBtn', 'bluetoothBtn'].map(rect), right: ['pauseProgramBtn', 'runProgramBtn'].map(rect) };
    });
    assert.ok(controls.left[0].left < controls.left[1].left && controls.left[1].left < controls.left[2].left);
    assert.ok(controls.left.every(rect => rect.top <= 10));
    assert.ok(controls.right.every(rect => rect.top <= 10 && Math.abs(rect.width - 46.4) < 1));
    assert.ok(controls.right[1].right > 832);

    const expected = {
      motor: ['motor-forward', 'motor-reverse', 'motor-forward-continuous', 'motor-reverse-continuous', 'motor-stop', 'motor-power'],
      combo: ['combo-forward', 'combo-backward', 'combo-turn-left', 'combo-turn-right', 'combo-continuous', 'combo-stop', 'combo-power'],
      logic: ['wait-time', 'loop-count', 'loop', 'infrared-wait'],
      dynamic: ['eye-expression', 'display-number', 'display-off', 'speech-play', 'speech-wait']
    };
    for (const [category, ids] of Object.entries(expected)) {
      await page.locator(`#tab-${category}`).click();
      assert.deepEqual(await page.locator('#palette > [data-card-id]').evaluateAll(nodes => nodes.map(node => node.dataset.cardId)), ids);
    }

    assert.match(await page.locator('#startBlock .start-art-icon').getAttribute('src'), /assets\/blocks\/start\.svg$/);
    await page.locator('#tab-logic').click();
    const logicFill = await page.locator('#palette [data-card-id=wait-time] > .block-outline > path').evaluate(path => getComputedStyle(path).fill);
    const startFill = await page.locator('#startBlock > .block-outline > path').evaluate(path => getComputedStyle(path).fill);
    assert.equal(startFill, logicFill);

    await page.locator('#tab-motor').click();
    await page.waitForTimeout(340);
    const paletteGeometry = await page.locator('#palette').evaluate(palette => {
      const outer = palette.getBoundingClientRect();
      const boxes = [...palette.children].filter(node => node.matches('[data-card-id]')).map(node => node.getBoundingClientRect());
      return {
        firstInset: boxes[0].left - outer.left,
        tops: boxes.map(box => box.top),
        gaps: boxes.slice(1).map((box, index) => box.left - boxes[index].right)
      };
    });
    assert.ok(paletteGeometry.firstInset < 20, 'palette should begin at the left edge');
    assert.ok(Math.max(...paletteGeometry.tops) - Math.min(...paletteGeometry.tops) < .2, 'palette blocks should align at the top');
    assert.ok(Math.max(...paletteGeometry.gaps) - Math.min(...paletteGeometry.gaps) < .2, 'palette gaps should be equal');

    await page.locator('#tab-combo').click();
    assert.equal(await page.locator('#palette').getAttribute('data-slide-direction'), 'forward');
    assert.ok(await page.locator('.tab-slider').evaluate(slider => slider.getAnimations().length > 0), 'category selection should animate');
    await page.waitForTimeout(340);
    const sliderAlignment = await page.evaluate(() => {
      const tab = document.querySelector('#tab-combo').getBoundingClientRect();
      const slider = document.querySelector('.tab-slider').getBoundingClientRect();
      return { delta: Math.abs((tab.left + tab.width / 2) - (slider.left + slider.width / 2)) };
    });
    assert.ok(sliderAlignment.delta < 1, 'category slider should sit behind the selected tab');
    await page.locator('#tab-motor').click();
    assert.equal(await page.locator('#palette').getAttribute('data-slide-direction'), 'backward');

    await page.locator('#tab-combo').click();
    for (const id of ['combo-forward', 'combo-backward', 'combo-continuous', 'combo-power']) {
      const centers = await page.locator(`#palette [data-card-id=${id}]`).evaluate(block => {
        const icon = block.querySelector('.ai-art-icon').getBoundingClientRect();
        const bubble = block.querySelector('.param-bubble').getBoundingClientRect();
        return [icon.left + icon.width / 2, bubble.left + bubble.width / 2];
      });
      assert.ok(Math.abs(centers[0] - centers[1]) < .1, `${id} icon and parameter centers differ`);
    }

    await page.locator('#tab-logic').click();
    await page.locator('#palette [data-card-id=infrared-wait]').click();
    assert.equal(await page.locator('#chain [data-card-id=infrared-wait] .param-bubble').textContent(), '大于50');
    await page.locator('#chain [data-card-id=infrared-wait] .param-bubble').click();
    assert.deepEqual(await page.locator('#paramEditor .param-option-btn').allTextContents(), ['大于', '小于']);

    await page.locator('#tab-dynamic').click();
    assert.equal(await page.locator('#palette [data-card-id=eye-expression] img').getAttribute('src'), 'assets/eyes/eye-01.svg');
    assert.equal(await page.locator('#palette [data-card-id=display-number] .number-dot-matrix').getAttribute('data-value'), '0');
    assert.equal(await page.locator('#palette [data-card-id=display-number] .ai-art-icon').count(), 0);
    assert.match(await page.locator('#palette [data-card-id=display-off] img').getAttribute('src'), /assets\/blocks\/display-off\.svg$/);
    const scale = await page.locator('#palette [data-card-id=speech-play] img').evaluate(img => getComputedStyle(img).transform);
    assert.match(scale, /1\.638/);
    const offset = await page.locator('#palette [data-card-id=speech-play] .ai-art-icon').evaluate(icon => getComputedStyle(icon).transform);
    assert.match(offset, /matrix\(1, 0, 0, 1, 0, -2\.8\)/);

    await page.locator('#palette [data-card-id=display-number]').click();
    await page.locator('#chain [data-card-id=display-number] .param-bubble').click();
    await page.locator('#paramEditor .param-current').click();
    await page.locator('.number-key[data-key="4"]').click();
    await page.locator('.number-key[data-key="8"]').click();
    assert.equal(await page.locator('#chain [data-card-id=display-number] .number-dot-matrix').getAttribute('data-value'), '48');
    await page.locator('#startBlock').click();

    await page.locator('#tab-dynamic').click();
    await page.locator('#palette [data-card-id=eye-expression]').click();
    await page.locator('#chain [data-card-id=eye-expression] .param-bubble').click();
    assert.equal(await page.locator('#paramEditor .eye-option-btn').count(), 10);
    await page.locator('#paramEditor .eye-option-btn').nth(1).click();
    assert.match(await page.locator('#chain [data-card-id=eye-expression] img').getAttribute('src'), /eye-02\.svg$/);

    await page.locator('#startBlock').click();
    await page.locator('#tab-dynamic').click();
    await page.locator('#palette [data-card-id=speech-play]').click();
    await page.locator('#chain [data-card-id=speech-play] .param-bubble').click();
    assert.equal(await page.locator('#paramEditor .phrase-option-btn').count(), 10);
    await page.locator('#paramEditor .phrase-option-btn').nth(1).click();
    assert.equal(await page.locator('#chain [data-card-id=speech-play] .param-bubble').textContent(), 'P02');
    assert.equal(await page.locator('#paramEditor').isVisible(), false);

    await page.locator('#tab-dynamic').click();
    await page.locator('#palette [data-card-id=speech-wait]').click();
    await page.locator('#chain [data-card-id=speech-wait] .param-bubble').click();
    await page.locator('#paramEditor .phrase-option-btn').nth(2).click();
    assert.equal(await page.locator('#chain [data-card-id=speech-wait] .param-bubble').textContent(), '再来一次');
    assert.equal(await page.locator('#paramEditor').isVisible(), false);
    await page.locator('#tab-logic').click();
    const loopScale = await page.locator('#palette [data-card-id=loop] img').evaluate(img => getComputedStyle(img).transform);
    assert.match(loopScale, /1\.1466/);
    const waitOffset = await page.locator('#palette [data-card-id=wait-time] .ai-art-icon').evaluate(icon => getComputedStyle(icon).transform);
    assert.match(waitOffset, /matrix\(1, 0, 0, 1, 0\.8, 1\.2\)/);
    assert.deepEqual(errors, []);
    console.log('PASS block catalog: spreadsheet categories, infrared placement, dynamic palette, parameters, and tuned AI icons.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
