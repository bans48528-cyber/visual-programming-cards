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

// Measure painted pixels, not the SVG artboard: transparent padding previously
// made icons look small even though their <img> element had the expected size.
async function checkArtworkSize(page, selector, minRatio, maxRatio) {
  const ratio = await page.locator(selector).evaluate(async image => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] <= 16) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const block = image.closest('[data-card-id]');
    const zoom = block.getBoundingClientRect().width / (Number(block.dataset.advance) + 8);
    const rect = image.getBoundingClientRect();
    return Math.max((right-left+1) / canvas.width * rect.width,
      (bottom-top+1) / canvas.height * rect.height) / (Number(block.dataset.bodyHeight) * zoom);
  });
  assert.ok(ratio >= minRatio && ratio <= maxRatio, `${selector}: visible artwork/body ratio ${ratio}`);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true });
      await page.addInitScript(()=>localStorage.setItem('cardDefaultModelV1','xiaobai'));
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
    assert.ok(controls.left.every(rect => rect.top >= 10 && rect.top <= 16), 'editor buttons should sit inside the padded floating toolbar');
    assert.ok(controls.right.every(rect => rect.top <= 10 && Math.abs(rect.width - 46.4) < 1));
    assert.ok(controls.right[1].right > 832);

    const expected = {
      motor: ['motor-forward', 'motor-reverse', 'motor-forward-continuous', 'motor-reverse-continuous', 'motor-stop', 'motor-power'],
      combo: ['combo-forward', 'combo-backward', 'combo-turn-left', 'combo-turn-right', 'combo-continuous', 'combo-stop', 'combo-power'],
      logic: ['wait-time', 'tilt-wait', 'loop-count', 'loop', 'infrared-wait'],
      dynamic: ['eye-expression', 'eye-matrix', 'display-number', 'display-off', 'speech-play', 'speech-wait', 'self-learned-wait']
    };
    for (const [category, ids] of Object.entries(expected)) {
      await page.locator(`#tab-${category}`).click();
      assert.deepEqual(await page.locator('#palette > [data-card-id]').evaluateAll(nodes => nodes.map(node => node.dataset.cardId)), ids);
    }

    assert.match(await page.locator('#startBlock .start-art-icon').getAttribute('src'), /assets\/blocks\/xiaobai-20261016\/start\.svg$/);
    await page.locator('#tab-logic').click();
    const logicFill = await page.locator('#palette [data-card-id=wait-time] > .block-outline > path').evaluate(path => getComputedStyle(path).fill);
    const startFill = await page.locator('#startBlock > .block-outline > path').evaluate(path => getComputedStyle(path).fill);
    assert.equal(startFill, logicFill);

    await page.locator('#tab-motor').click();
    await page.waitForTimeout(340);
    await checkArtworkSize(page, '#palette [data-card-id=motor-forward] img', .65, .8);
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

    assert.equal(await page.locator('#palette [data-card-id=motor-forward-continuous] .param-bubble').textContent(), 'L持续正转');
    assert.equal(await page.locator('#palette [data-card-id=motor-reverse-continuous] .param-bubble').textContent(), 'L持续反转');

    await page.locator('#tab-combo').click();
    assert.equal(await page.locator('#palette').getAttribute('data-slide-direction'), 'forward');
    assert.ok(await page.locator('.tab-slider').evaluate(slider => slider.getAnimations().length > 0), 'category selection should animate');
    await page.waitForTimeout(340);
    const sliderAlignment = await page.evaluate(() => {
      const tabs = document.querySelector('.tabs').getBoundingClientRect();
      const tab = document.querySelector('#tab-combo').getBoundingClientRect();
      const slider = document.querySelector('.tab-slider').getBoundingClientRect();
      return {
        delta: Math.abs((tab.left + tab.width / 2) - (slider.left + slider.width / 2)),
        heightDelta: Math.abs(tab.height - slider.height),
        topDelta: Math.abs((tab.top - tabs.top) - (slider.top - tabs.top))
      };
    });
    assert.ok(sliderAlignment.delta < 1, 'category slider should sit behind the selected tab');
    assert.ok(sliderAlignment.heightDelta < 1, `category slider should match the tab height (${sliderAlignment.heightDelta})`);
    assert.ok(sliderAlignment.topDelta < 1, `category slider should match the tab top (${sliderAlignment.topDelta})`);
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

    assert.equal(await page.locator('#palette [data-card-id=combo-continuous] .param-bubble').textContent(), '持续前进');

    await page.locator('#tab-logic').click();
    await page.locator('#palette [data-card-id=infrared-wait]').click();
    assert.equal(await page.locator('#chain [data-card-id=infrared-wait] .param-bubble').textContent(), '大于50');
    await page.locator('#chain [data-card-id=infrared-wait] .param-bubble').click();
    assert.deepEqual(await page.locator('#paramEditor .param-option-btn').allTextContents(), ['大于', '小于']);

    await page.locator('#tab-dynamic').click();
    assert.equal(await page.locator('#palette [data-card-id=eye-expression] img').getAttribute('src'), 'assets/blocks/xiaobai-20261016/eye-expression.svg');
    assert.equal(await page.locator('#palette [data-card-id=display-number] img').getAttribute('src'), 'assets/blocks/xiaobai-20261016/display-number.svg');
    assert.equal(await page.locator('#palette [data-card-id=display-number] .model-art-icon').count(), 1);
    assert.match(await page.locator('#palette [data-card-id=display-off] img').getAttribute('src'), /assets\/blocks\/xiaobai-20261016\/display-off\.svg$/);
    await checkArtworkSize(page, '#palette [data-card-id=speech-play] img', .55, .7);
    const offset = await page.locator('#palette [data-card-id=speech-play] .ai-art-icon').evaluate(icon => getComputedStyle(icon).transform);
    assert.equal(offset, 'none');

    await page.locator('#palette [data-card-id=display-number]').click();
    await page.locator('#chain [data-card-id=display-number] .param-bubble').click();
    await page.locator('#paramEditor .param-current').click();
    await page.locator('.number-key[data-key="4"]').click();
    await page.locator('.number-key[data-key="8"]').click();
    assert.equal(await page.locator('#chain [data-card-id=display-number] .number-dot-matrix').getAttribute('data-value'), '48');
    await page.locator('.program-canvas').click({position:{x:400,y:20}});

    await page.locator('#tab-dynamic').click();
    await page.locator('#palette [data-card-id=eye-expression]').click();
    await page.locator('#chain [data-card-id=eye-expression] .param-bubble').click();
    assert.equal(await page.locator('#paramEditor .eye-option-btn').count(), 10);
    await page.locator('#paramEditor .eye-option-btn').nth(1).click();
    assert.match(await page.locator('#chain [data-card-id=eye-expression] img').getAttribute('src'), /eye-02\.svg$/);

    await page.locator('.program-canvas').click({position:{x:400,y:20}});
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
    await checkArtworkSize(page, '#palette [data-card-id=loop] img', .4, .55);
    await checkArtworkSize(page, '#palette [data-card-id=wait-time] img', .5, .7);
    const waitOffset = await page.locator('#palette [data-card-id=wait-time] .ai-art-icon').evaluate(icon => getComputedStyle(icon).transform);
    assert.equal(waitOffset, 'none');

    await page.locator('#tab-combo').click();
    await page.locator('#palette [data-card-id=combo-continuous]').click();
    assert.equal(await page.locator('#chain [data-card-id=combo-continuous] .param-bubble').textContent(), '持续前进');
    await page.locator('#chain [data-card-id=combo-continuous] .param-bubble').click();
    await page.locator('#paramEditor .param-option-btn').nth(1).click();
    assert.equal(await page.locator('#chain [data-card-id=combo-continuous] .param-bubble').textContent(), '持续后退');
    assert.deepEqual(errors, []);
    console.log('PASS block catalog: spreadsheet categories, infrared placement, dynamic palette, parameters, and tuned AI icons.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
