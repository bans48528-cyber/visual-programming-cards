const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '../dist');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.mp3':'audio/mpeg'};
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const context = await browser.newContext({viewport:{width:844, height:390}, hasTouch:true});
    await context.addInitScript(() => {
      window.__playedBlockSounds = [];
      window.Audio = class MockAudio {
        constructor(src) { this.src = src; this.currentTime = 0; this.volume = 1; }
        pause() {}
        play() { window.__playedBlockSounds.push(this.src); return Promise.resolve(); }
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#editor`);
    await page.locator('#palette [data-card-id="motor-forward"]').click();
    assert.deepEqual(await page.evaluate(() => __playedBlockSounds), ['assets/sounds/block-place.wav']);
    const block = await page.locator('#chain > [data-card-id="motor-forward"]').boundingBox();
    const palette = await page.locator('#palette').boundingBox();
    await page.mouse.move(block.x + block.width / 2, block.y + block.height / 2);
    await page.mouse.down();
    await page.mouse.move(palette.x + palette.width / 2, palette.y + palette.height / 2, {steps:12});
    await page.mouse.up();
    assert.equal(await page.locator('#chain > [data-card-id="motor-forward"]').count(), 0);
    assert.deepEqual(await page.evaluate(() => __playedBlockSounds), [
      'assets/sounds/block-place.wav', 'assets/sounds/block-delete.mp3'
    ]);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS block sounds: placement and drag deletion.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
