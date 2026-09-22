const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '../dist');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png'};
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

async function swipe(page, start, deltaX) {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[start]});
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{
      x: start.x + deltaX * step / 8,
      y: start.y
    }]});
  }
  await session.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await session.detach();
}

async function swipeElement(page, selector, deltaX) {
  const rect = await page.locator(selector).first().boundingBox();
  await swipe(page, {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2}, deltaX);
}

async function followFingerWhileDown(page, selector) {
  const rect = await page.locator(selector).first().boundingBox();
  const start = {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2};
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[start]});
    const offsets = [];
    for (const deltaX of [-35, -95]) {
      await session.send('Input.dispatchTouchEvent', {
        type:'touchMove', touchPoints:[{x:start.x + deltaX, y:start.y}]
      });
      await page.waitForTimeout(35);
      offsets.push(await page.evaluate(() => {
        const track = document.querySelector('.palette-gesture-track');
        return track && parseFloat(track.style.transform.match(/translate3d\((-?[\d.]+)px/)?.[1]);
      }));
    }
    assert.equal(await page.locator('#tab-motor').getAttribute('aria-selected'), 'true');
    assert.ok(offsets.every(Number.isFinite), `missing live gesture track: ${offsets}`);
    assert.ok(Math.abs((offsets[1] - offsets[0]) + 60) < 1, `track did not follow 60px of finger movement: ${offsets}`);
    await session.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  } finally {
    await session.detach();
  }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const context = await browser.newContext({viewport:{width:844, height:390}, hasTouch:true});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#editor`);
    await page.locator('#palette [data-card-id="motor-forward"]').waitFor();

    await followFingerWhileDown(page, '#palette [data-card-id="motor-forward"]');
    await page.waitForFunction(() => document.querySelector('#tab-combo').getAttribute('aria-selected') === 'true');
    assert.equal(await page.evaluate(() => program.length), 0);
    await swipeElement(page, '#palette > .block', 90);
    await page.waitForFunction(() => document.querySelector('#tab-motor').getAttribute('aria-selected') === 'true');
    await swipeElement(page, '#palette [data-card-id="motor-forward"]', -30);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#tab-motor').getAttribute('aria-selected'), 'true');

    await page.evaluate(() => {
      stagedGroups = [{id:'swipe-stage', items:[createProgramItem('motor-forward'), createProgramItem('motor-stop')]}];
      renderPalette();
      selectCategory('dynamic');
    });
    await page.waitForTimeout(350);
    const stagedSnapshot = await page.evaluate(() => JSON.stringify(stagedGroups));
    await swipeElement(page, '#palette > .block', -90);
    await page.waitForFunction(() => document.querySelector('#tab-staging').getAttribute('aria-selected') === 'true');
    assert.equal(await page.locator('#palette > .staged-group').count(), 1);
    assert.equal(await page.locator('#stagingCount').textContent(), '1');

    // Horizontal interaction on a staged group remains its own pan gesture.
    await swipeElement(page, '#palette > .staged-group', -90);
    assert.equal(await page.locator('#tab-staging').getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => JSON.stringify(stagedGroups)), stagedSnapshot);

    // Swiping the empty part of the staging palette returns to the prior category.
    const emptyPoint = await page.evaluate(() => {
      const rect = palette.getBoundingClientRect();
      for (let y = rect.bottom - 4; y > rect.top + 4; y -= 8) {
        for (let x = rect.right - 100; x > rect.left + 20; x -= 20) {
          if (document.elementFromPoint(x, y) === palette) return {x, y};
        }
      }
      throw new Error('No empty staging palette point');
    });
    await swipe(page, emptyPoint, 80);
    await page.waitForFunction(() => document.querySelector('#tab-dynamic').getAttribute('aria-selected') === 'true');
    assert.equal(await page.evaluate(() => JSON.stringify(stagedGroups)), stagedSnapshot);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS palette touch swipe: adjacent categories, boundaries, staging preservation, staged-group gesture isolation.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
