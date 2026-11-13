'use strict';
// Shipping renderer and touch handlers in a fresh, disposable browser context.
// No existing browser profile, IAB session, device connection or APK is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

const webRoot = path.resolve(__dirname, '../dist');
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.json':'application/json'};
const server = http.createServer((req, res) => {
  const file = path.resolve(webRoot, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(webRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

async function exercise() {
  const results = [], viewport = document.querySelector('.free-canvas-viewport');
  const frame = () => new Promise(requestAnimationFrame);
  const copy = value => JSON.parse(JSON.stringify(value));
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const check = (value, message) => {if (!value) throw Error(message);};
  const equal = (a, b, message) => check(JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)), message);
  const node = uid => ({uid, id:'motor-reverse', params:{port:'L', duration:1}});
  const loop = (uid, children = []) => ({uid, id:'loop-count', params:{count:3}, children});
  const groupElement = id => document.querySelector(`.free-canvas-world > [data-group-id="${id}"]`);
  const direct = (el, selector) => [...el.children].filter(child => child.matches(selector));
  const rect = el => {const r = el.getBoundingClientRect(); return {x:r.left, y:r.top, width:r.width, height:r.height};};
  const geometry = () => Object.fromEntries([...document.querySelectorAll('.free-canvas-world [data-node-uid], .free-canvas-world [data-start-id]')]
    .map(el => [el.dataset.nodeUid || '@' + el.dataset.startId, rect(el)]));
  const event = (type, p, pointerId = 94) => new PointerEvent(type, {
    bubbles:true, cancelable:true, pointerId, pointerType:'touch', button:0,
    buttons:/pointerup|pointercancel/.test(type) ? 0 : 1, clientX:p.x, clientY:p.y, isPrimary:pointerId === 94
  });
  let current;
  async function move(p) {current = p; document.dispatchEvent(event('pointermove', p)); await frame();}
  async function visiblePaletteLoop() {
    const palette = document.querySelector('#palette');
    document.querySelector('#tab-logic').click();
    const first = palette.querySelector('[data-palette-category="logic"]');
    const card = palette.querySelector('[data-card-id="loop-count"]');
    check(first && card, 'loop missing from logic palette');
    // End the category's native smooth scroll at its real destination. Resetting
    // scrollLeft to zero would put the loop offscreen in the combined palette.
    const padding = parseFloat(getComputedStyle(palette).paddingLeft) || 0;
    palette.scrollTo({left:Math.max(0, palette.scrollLeft + first.getBoundingClientRect().left - palette.getBoundingClientRect().left - padding), behavior:'instant'});
    let previous = palette.scrollLeft, stable = 0;
    for (let turn = 0; turn < 30 && stable < 3; turn++) {
      await frame();
      stable = Math.abs(palette.scrollLeft - previous) < .1 ? stable + 1 : 0;
      previous = palette.scrollLeft;
    }
    check(stable >= 3, 'palette scroll did not settle before pointerdown');
    const r = card.getBoundingClientRect(), p = palette.getBoundingClientRect();
    check(r.left >= Math.max(0, p.left) && r.right <= Math.min(innerWidth, p.right) &&
      r.top >= Math.max(0, p.top) && r.bottom <= Math.min(innerHeight, p.bottom), 'loop card is clipped/offscreen before pointerdown');
    const tail = card.querySelector('.loop-tail').getBoundingClientRect();
    const start = {x:tail.left + tail.width / 2, y:tail.top + tail.height / 2};
    check(start.x >= Math.max(0, p.left) && start.x < Math.min(innerWidth, p.right) &&
      start.y >= Math.max(0, p.top) && start.y < Math.min(innerHeight, p.bottom), 'pointerdown is outside the visible palette');
    check(document.elementFromPoint(start.x, start.y)?.closest('[data-card-id]') === card,
      'visible pointerdown point does not hit the loop card');
    return {card, start};
  }
  function noGhosts() {
    check(!CardCanvas.getGesture() && !document.querySelector('.free-canvas-ghost, .free-canvas-projection, .free-canvas-wrap-incoming'), 'gesture/preview remained after completion');
  }
  function noDuplicates() {
    const keys = [...document.querySelectorAll('.free-canvas-world [data-node-uid], .free-canvas-world [data-start-id]')]
      .map(el => el.dataset.nodeUid || '@' + el.dataset.startId);
    check(keys.length === new Set(keys).size, 'duplicate rendered identities');
  }
  function visibleWrapPair() {
    const floating = document.querySelector('.free-canvas-ghost');
    const projected = document.querySelector('.free-canvas-wrap-incoming');
    check(floating && projected && !floating.contains(projected), 'floating loop and wrap preview must both exist');
    for (const [name, el] of [['floating loop', floating], ['wrap preview', projected]]) {
      const style = getComputedStyle(el), r = el.getBoundingClientRect();
      check(Number(style.opacity) > 0 && style.visibility !== 'hidden' && style.display !== 'none' && r.width > 0 && r.height > 0,
        name + ' was hidden during wrap');
    }
  }
  function compare(expected) {
    const actual = geometry(); let maxError = 0;
    equal(Object.keys(actual).sort(), Object.keys(expected).sort(), 'preview/drop identity sets differ');
    for (const [uid, bounds] of Object.entries(expected)) for (const key of ['x','y','width','height']) {
      const error = Math.abs(actual[uid][key] - bounds[key]); maxError = Math.max(maxError, error);
      check(error < .5, `preview/drop mismatch ${uid}.${key}: ${error}px`);
    }
    return maxError;
  }
  async function load(shape, scale) {
    CardCanvas.cancel();
    const h = viewport.clientHeight, x = Math.min(260, innerWidth * .22);
    const targetItems = shape.singleTarget ? [node('t0')] : shape.nested ? [loop('target-outer', [node('t0'), loop('t1', [node('t1-child')]), node('t2')]), node('outside')]
      : [node('t0'), node('t1'), node('t2')];
    const old = shape.filled ? (shape.singleOld ? [node('old0')] : [node('old0'), loop('old1', [node('old1-child')])]) : [];
    const payload = shape.ordinary ? [node('ordinary')] : [loop('incoming', old), ...(shape.siblings ? [node('after')] : [])];
    const groups = [{id:'target', startId:shape.unheaded ? null : 'target-head', x:x / scale, y:Math.min(180, h * .45) / scale, items:targetItems}];
    if (!shape.palette) groups.push({id:'source', startId:shape.head ? 'source-head' : null,
      x:80 / scale, y:Math.min(350, h * .79) / scale, items:[...(shape.prefix ? [node('source-prefix')] : []), ...payload]});
    CardEditor.setWorkspace({schemaVersion:2, kind:'free-canvas', groups,
      selectedGroupId:shape.palette ? 'target' : 'source', viewport:{x:0, y:0, scale}});
    await frame();
    const baseline = copy(CardEditor.getWorkspace()), parentUid = shape.nested ? 'target-outer' : null;
    return {shape, scale, baseline, parentUid, index:shape.index ?? 1, old, payload};
  }
  async function activate(f) {
    let el;
    if (f.shape.palette) {
      const visible = await visiblePaletteLoop(); el = visible.card; current = visible.start;
      el.dispatchEvent(event('pointerdown', current)); await move({x:current.x, y:current.y - 35});
    } else {
      el = f.shape.head ? groupElement('source').querySelector('.free-canvas-start')
        : CardEditor.findBlockByUid(f.shape.ordinary ? 'ordinary' : 'incoming');
      const r = el.getBoundingClientRect();
      current = f.shape.grabLeft ? {x:r.left + 6 * f.scale, y:r.top + 6 * f.scale}
        : {x:f.shape.head || f.shape.ordinary ? r.left + 6 * f.scale : r.right - 30 * f.scale,
          y:r.top + Number(el.dataset.connectorY) * f.scale};
      el.dispatchEvent(event('pointerdown', current)); await move({x:current.x + 14, y:current.y});
    }
    check(CardCanvas.getGesture()?.active, 'drag did not activate');
    const ghost = document.querySelector('.free-canvas-ghost'); check(ghost, 'drag ghost missing');
    check(getComputedStyle(ghost).filter.includes('drop-shadow'), 'drag shadow missing');
    f.uid = ghost.querySelector('.loop-block')?.dataset.nodeUid;
    return f;
  }
  async function aimWrap(f) {
    await activate(f);
    const slot = CardCanvas.getSlots().find(s => s.groupId === 'target' && s.parentUid === f.parentUid && s.index === f.index && !s.side);
    check(slot, 'target insertion port missing');
    const ghost = document.querySelector('.free-canvas-ghost'), incoming = ghost.querySelector('.loop-block');
    const inner = direct(incoming, '.loop-inner')[0], innerRect = inner.getBoundingClientRect(), loopRect = incoming.getBoundingClientRect();
    const mouth = {x:innerRect.left + (direct(inner, '.program-block').length ? innerRect.width : 0),
      y:loopRect.top + Number(incoming.dataset.connectorY) * f.scale};
    f.destination = {x:current.x + slot.x - mouth.x, y:current.y + slot.y - mouth.y};
    await move(f.destination);
    const target = CardCanvas.getGesture()?.target;
    const sequence = f.parentUid ? f.baseline.groups[0].items[0].children : f.baseline.groups[0].items;
    check(target?.mode === 'wrap' && target.groupId === 'target' && target.parentUid === f.parentUid && target.index === f.index && target.endIndex === sequence.length,
      'incorrect wrap target: ' + JSON.stringify({target, expected:{parentUid:f.parentUid,index:f.index,endIndex:sequence.length},destination:f.destination}));
    check(document.querySelector('.free-canvas-wrap-incoming'), 'wrap preview missing');
    visibleWrapPair();
    f.sequence = sequence; return f;
  }
  async function commit(f) {
    const projected = geometry(); noDuplicates();
    document.dispatchEvent(event('pointerup', f.destination)); await frame(); noGhosts(); noDuplicates();
    const maxError = compare(projected), merged = copy(CardEditor.getWorkspace());
    const target = merged.groups.find(g => g.id === 'target'); check(target?.startId === 'target-head', 'target head moved inside the loop');
    const sequence = f.parentUid ? target.items[0].children : target.items;
    const incoming = sequence[f.index]; check(incoming.uid === f.uid && incoming.id === 'loop-count', 'incoming loop lost/replaced');
    const oldChildren = f.shape.palette ? [] : f.baseline.groups.find(g => g.id === 'source').items.find(n => n.uid === 'incoming').children;
    check(oldChildren.length === 0, 'this fixture must wrap using an empty loop');
    equal(incoming.children, f.sequence.slice(f.index), 'empty loop did not capture the continuous target suffix');
    equal(sequence.slice(0, f.index), f.sequence.slice(0, f.index), 'target prefix changed');
    const sourceItems = f.baseline.groups.find(g => g.id === 'source')?.items || [], sourceIndex = sourceItems.findIndex(n => n.uid === 'incoming');
    equal(sequence.slice(f.index + 1), sourceItems.slice(sourceIndex + 1), 'payload siblings were put inside the loop');
    if (f.shape.nested) equal(target.items.slice(1), f.baseline.groups[0].items.slice(1), 'capture escaped its target depth');
    if (f.shape.prefix) equal(merged.groups.find(g => g.id === 'source').items, sourceItems.slice(0, sourceIndex), 'source prefix was dragged/deleted');
    CardEditor.undo(); await frame(); equal(CardEditor.getWorkspace(), f.baseline, 'one undo did not restore the entire drag');
    CardEditor.redo(); await frame(); equal(CardEditor.getWorkspace(), merged, 'redo did not restore the exact drop'); noGhosts();
    return {maxError, comparedNodes:Object.keys(projected).length, undoRedo:true};
  }
  const shapes = [
    {name:'palette-all', palette:true, index:0},
    {name:'palette-suffix', palette:true},
    {name:'existing-empty-and-sibling', siblings:true, prefix:true},
    {name:'nested-target', nested:true, siblings:true}
  ];
  for (const scale of [.5, 1, 1.8]) for (const shape of shapes) {
    try {
      const f = await aimWrap(await load(shape, scale));
      if (scale === 1 && shape.name === 'palette-suffix') await window.captureWrapStage?.('preview');
      const committed = await commit(f);
      if (scale === 1 && shape.name === 'palette-suffix') await window.captureWrapStage?.('committed');
      results.push({case:shape.name, scale, ...committed});
    }
    catch (e) {e.message = `${shape.name}@${scale}: ${e.message}`; throw e;}
  }
  for (const scale of [.5, 1, 1.8]) {
    for (const cancel of ['pointercancel','second-touch']) {
      const f = await aimWrap(await load(shapes[2], scale));
      if (cancel === 'pointercancel') document.dispatchEvent(event('pointercancel', current));
      else {
        const second = {x:current.x + 65, y:current.y + 30};
        viewport.dispatchEvent(event('pointerdown', second, 95));
        check(CardCanvas.getGesture()?.type === 'pinch', 'second touch did not switch from drag to pinch');
        document.dispatchEvent(event('pointerup', current)); document.dispatchEvent(event('pointerup', second, 95));
      }
      await frame(); noGhosts(); equal(CardEditor.getWorkspace(), f.baseline, cancel + ' did not restore structure/positions/selection');
      results.push({case:cancel, scale, pass:true});
    }
    const blocked = await activate(await load({head:true}, scale));
    const slot = CardCanvas.getSlots().find(s => s.groupId === 'target' && s.index === 1 && !s.side);
    const loopEl = document.querySelector('.free-canvas-ghost .loop-block'), inner = direct(loopEl, '.loop-inner')[0], r = inner.getBoundingClientRect();
    const lr = loopEl.getBoundingClientRect();
    await move({x:current.x + slot.x - r.right, y:current.y + slot.y - lr.top - Number(loopEl.dataset.connectorY) * scale});
    check(!CardCanvas.getGesture()?.target && !document.querySelector('.free-canvas-wrap-incoming'), 'headed payload was allowed to join another headed group');
    document.dispatchEvent(event('pointercancel', current)); await frame(); equal(CardEditor.getWorkspace(), blocked.baseline, 'illegal-head cancel changed document');
    results.push({case:'illegal-headed-payload', scale, pass:true});

    const f = await activate(await load({ordinary:true}, scale));
    const end = CardCanvas.getSlots().find(s => s.groupId === 'target' && s.parentUid === null && s.index === 3 && !s.side);
    const ghost = document.querySelector('.free-canvas-ghost'), gr = ghost.getBoundingClientRect();
    const connector = {x:gr.left, y:gr.top + ghost._metrics.anchor * scale};
    const aligned = {x:current.x + end.x - connector.x, y:current.y + end.y - connector.y};
    await move({x:aligned.x, y:aligned.y + 60}); check(!CardCanvas.getGesture()?.target, 'new snap entered outside the 50.4px radius');
    await move({x:aligned.x, y:aligned.y + 40}); check(CardCanvas.getGesture()?.target?.index === 3, '40 screen px did not snap');
    await move({x:aligned.x, y:aligned.y + 60}); check(CardCanvas.getGesture()?.target?.index === 3, '60px hysteresis did not retain snap');
    await move({x:aligned.x, y:aligned.y + 75}); check(!CardCanvas.getGesture()?.target, '75px did not release snap');
    document.dispatchEvent(event('pointercancel', current)); await frame(); equal(CardEditor.getWorkspace(), f.baseline, 'normal snap cancel changed document'); noGhosts();
    results.push({case:'screen-pixel-radius-and-hysteresis', scale, pass:true});
  }
  for (const scale of [.5, 1, 1.8]) for (const unheaded of [false, true]) for (const palette of [false, true]) {
    const f = await activate(await load({palette, singleTarget:true, unheaded, index:0}, scale));
    const slot = CardCanvas.getSlots().find(s => s.groupId === 'target' && s.parentUid === null && s.index === 0 && !s.side);
    const ghost = document.querySelector('.free-canvas-ghost'), incoming = ghost.querySelector('.loop-block'), inner = direct(incoming, '.loop-inner')[0];
    const gr = ghost.getBoundingClientRect(), ir = inner.getBoundingClientRect(), lr = incoming.getBoundingClientRect();
    const mouthOffset = ir.left - gr.left;
    const pointerOffset = {x:current.x - gr.left, y:current.y - (lr.top + Number(incoming.dataset.connectorY) * scale)};
    const initial = rect(CardEditor.findBlockByUid('t0'));
    // Move right-to-left through the outer connector's old insertion radius
    // while the loop mouth is still too far away to wrap the occupied port.
    const deltas = [50.4 - Math.min(4, mouthOffset / 2), 49.4 - mouthOffset, 45 - mouthOffset];
    for (let delta = 55; delta > 45 - mouthOffset; delta -= 2) deltas.push(delta);
    deltas.sort((a,b) => b-a);
    let beforeCapture = 0, wrapped = 0;
    for (const delta of deltas) {
      const p = {x:slot.x + delta + pointerOffset.x, y:slot.y + pointerOffset.y}, vr = viewport.getBoundingClientRect();
      check(p.x >= Math.max(0,vr.left) && p.x < Math.min(innerWidth,vr.right) && p.y >= Math.max(0,vr.top) && p.y < Math.min(innerHeight,vr.bottom), 'approach pointer left the visible canvas');
      await move(p);
      const target = CardCanvas.getGesture()?.target;
      check(!(target?.groupId === 'target' && target.parentUid === null && target.index === 0 && target.mode !== 'wrap'),
        'occupied normal/front insert appeared before the loop mouth captured it');
      if (delta + mouthOffset > 50.4 + .1) {
        check(!document.querySelector('.free-canvas-wrap-incoming'), 'wrap appeared before its mouth reached capture range');
        const actual = rect(CardEditor.findBlockByUid('t0'));
        for (const key of ['x','y','width','height']) check(Math.abs(actual[key] - initial[key]) < .5, 'first captured block was pushed outside the loop before wrapping');
        if (Math.abs(delta) < 50.4) beforeCapture++;
      } else {
        check(target?.mode === 'wrap' && target.index === 0 && target.endIndex === 1, 'loop mouth failed to capture the single occupied target');
        visibleWrapPair(); wrapped++;
      }
    }
    check(beforeCapture > 0 && wrapped > 0, 'approach did not sample both premature-insert and valid-wrap zones');
    if (scale === 1 && !palette && !unheaded) await window.captureWrapStage?.('approach-preview');
    document.dispatchEvent(event('pointercancel', current)); await frame(); noGhosts();
    equal(CardEditor.getWorkspace(), f.baseline, 'right-to-left approach cancel changed the document');
    results.push({case:'empty-loop-right-to-left-no-premature-insert', scale, unheaded, palette, frames:deltas.length, beforeCapture, wrapped, pass:true});
  }
  for (const scale of [.5, 1, 1.8]) {
    const f = await activate(await load({filled:true, siblings:true, prefix:true, grabLeft:true}, scale));
    const source = f.baseline.groups.find(g => g.id === 'source'), at = source.items.findIndex(n => n.uid === 'incoming');
    const movedItems = source.items.slice(at), targetBefore = f.baseline.groups.find(g => g.id === 'target');
    const slot = CardCanvas.getSlots().find(s => s.groupId === 'target' && s.parentUid === null && s.index === 1 && !s.side);
    const ghost = document.querySelector('.free-canvas-ghost'), gr = ghost.getBoundingClientRect();
    const offset = {x:current.x - gr.left, y:current.y - gr.top - ghost._metrics.anchor * scale};
    f.destination = {x:slot.x + offset.x, y:slot.y + offset.y}; await move(f.destination);
    const target = CardCanvas.getGesture()?.target;
    check(target?.groupId === 'target' && target.index === 1 && target.mode !== 'wrap', 'filled loop must use an ordinary occupied insertion port');
    check(!document.querySelector('.free-canvas-wrap-incoming') && document.querySelector('.free-canvas-projection'), 'filled loop generated a wrap preview');
    const projected = geometry();
    document.dispatchEvent(event('pointerup', current)); await frame(); noGhosts(); noDuplicates();
    const merged = copy(CardEditor.getWorkspace()), normalMaxError = compare(projected);
    equal(merged.groups.find(g => g.id === 'target').items, [...targetBefore.items.slice(0,1), ...movedItems, ...targetBefore.items.slice(1)],
      'filled loop ate target siblings or changed its existing children');
    equal(merged.groups.find(g => g.id === 'source').items, source.items.slice(0, at), 'filled drag lost the source prefix');
    CardEditor.undo(); await frame(); equal(CardEditor.getWorkspace(), f.baseline, 'filled ordinary join undo lost original structure');
    CardEditor.redo(); await frame(); equal(CardEditor.getWorkspace(), merged, 'filled ordinary join redo differs');
    CardEditor.undo(); await frame();

    const free = await activate(await load({filled:true, siblings:true, prefix:true, grabLeft:true}, scale));
    const vr = viewport.getBoundingClientRect(), point = {x:vr.left + vr.width * .75, y:vr.top + vr.height * .78};
    await move(point); check(!CardCanvas.getGesture()?.target && !document.querySelector('.free-canvas-wrap-incoming'), 'filled free move unexpectedly captured a run');
    document.dispatchEvent(event('pointerup', point)); await frame(); noGhosts(); noDuplicates();
    const freeDoc = copy(CardEditor.getWorkspace()), owner = freeDoc.groups.find(g => g.items.some(n => n.uid === 'incoming'));
    equal(owner.items, movedItems, 'filled free move changed its children or outer suffix');
    equal(freeDoc.groups.find(g => g.id === 'target').items, targetBefore.items, 'filled free move ate target blocks');
    CardEditor.undo(); await frame(); equal(CardEditor.getWorkspace(), free.baseline, 'filled free move undo differs');
    CardEditor.redo(); await frame(); equal(CardEditor.getWorkspace(), freeDoc, 'filled free move redo differs');
    CardEditor.undo(); await frame();

    const cancel = await activate(await load({filled:true, siblings:true, prefix:true, grabLeft:true}, scale));
    await move(f.destination); check(!document.querySelector('.free-canvas-wrap-incoming'), 'filled cancel drag generated wrap preview');
    document.dispatchEvent(event('pointercancel', current)); await frame(); noGhosts();
    equal(CardEditor.getWorkspace(), cancel.baseline, 'filled cancellation lost structure or layout');
    results.push({case:'filled-loop-normal-join-free-move-cancel', scale, normalMaxError, childrenPreserved:true, targetSiblingsOutside:true, undoRedo:true, pass:true});
  }
  const browse = await load({palette:true}, 1), visible = await visiblePaletteLoop(), card = visible.card;
  current = visible.start; card.dispatchEvent(event('pointerdown', current));
  await move({x:current.x - 65, y:current.y});
  check(!CardCanvas.getGesture()?.active && !document.querySelector('.free-canvas-ghost'), 'horizontal palette browse created a drag');
  document.dispatchEvent(event('pointerup', current)); await frame();
  equal(CardEditor.getWorkspace(), browse.baseline, 'horizontal palette browse created a block'); noGhosts();
  results.push({case:'palette-browse-does-not-create', pass:true});
  return {pass:true, viewport:{width:innerWidth,height:innerHeight}, input:'touch PointerEvent simulation on shipping renderer', results};
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({channel:'msedge', headless:true});
    const reports = [];
    for (const viewport of [{width:844,height:390}, {width:1280,height:800}]) {
      const context = await browser.newContext({viewport, hasTouch:true});
      try {
        await context.addInitScript(() => localStorage.setItem('cardDefaultModelV1', 'xiaobai'));
        const page = await context.newPage(), errors = [];
        if (process.env.CARD_WRAP_SCREENSHOTS) {
          fs.mkdirSync(process.env.CARD_WRAP_SCREENSHOTS, {recursive:true});
          await page.exposeBinding('captureWrapStage', async ({page:source}, stage) => {
            await source.screenshot({path:path.join(process.env.CARD_WRAP_SCREENSHOTS, `${viewport.width}x${viewport.height}-${stage}.png`)});
          });
        }
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/#home`);
        await page.locator('#newProject').click(); await page.waitForFunction(() => !CardPageTransition.busy);
        await page.locator('#tab-logic').click(); await page.waitForFunction(() => !document.querySelector('.palette-transition-layer'));
        const report = await page.evaluate(exercise); assert.deepEqual(errors, []); reports.push(report);
      } finally {await context.close();}
    }
    console.log(JSON.stringify({pass:true, scenarios:reports.reduce((n,r) => n + r.results.length, 0), reports}));
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
