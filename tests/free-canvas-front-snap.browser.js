/* Execute as an async Runtime.evaluate expression through CUA on an isolated
 * local QA origin. Exercises shipping CSS, layout, model and pointer handlers.
 * No browser launcher or transport/hardware mock is required.
 */
(async function verifyFreeCanvasFrontSnap() {
  const saved = CardEditor.getWorkspace(), results = [];
  const viewport = document.querySelector('.free-canvas-viewport');
  const palette = document.getElementById('palette');
  const savedTab = document.querySelector('.tabs [aria-selected="true"]')?.id;
  const savedPaletteScroll = palette.scrollLeft;
  const copy = value => JSON.parse(JSON.stringify(value));
  const frame = () => new Promise(requestAnimationFrame);
  const check = (value, message) => { if (!value) throw Error(message); };
  // Workspace hydration normalizes object property order; array order and all
  // values still have to survive a single undo/redo exactly.
  const canonical = value => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const equal = (a, b, message) => check(JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)), message);
  const node = uid => ({ uid, id: 'motor-reverse', params: { port: 'L', duration: 1 } });
  const loop = (uid, children) => ({ uid, id: 'loop-count', params: { count: 2 }, children });
  const nested = prefix => [node(prefix + '1'), loop(prefix + '-loop', [node(prefix + '-inner1'),
    loop(prefix + '-loop2', [node(prefix + '-inner2')])]), node(prefix + '3')];
  const groupElement = id => document.querySelector(`.free-canvas-world > [data-group-id="${id}"]`);
  const bounds = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  const geometry = root => Object.fromEntries([...root.querySelectorAll('[data-node-uid], [data-start-id]')]
    .map(el => [el.dataset.nodeUid || '@start:' + el.dataset.startId, bounds(el)]));
  function compareGeometry(expected, actual, label) {
    let maxError = 0;
    for (const [uid, box] of Object.entries(expected)) {
      check(actual[uid], `${label}: missing ${uid}`);
      for (const key of ['x', 'y', 'width', 'height']) {
        const error = Math.abs(actual[uid][key] - box[key]);
        maxError = Math.max(maxError, error);
        check(error < .5, `${label}: ${uid}.${key} moved ${error}px`);
      }
    }
    return maxError;
  }
  const event = (type, p) => new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 94, pointerType: 'touch', button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: p.x, clientY: p.y, isPrimary: true
  });
  const move = async p => { document.dispatchEvent(event('pointermove', p)); await frame(); };
  const noPreviews = () => check(!document.querySelector('.free-canvas-projection, .free-canvas-ghost') &&
    !CardCanvas.getGesture(), 'drag/preview remained after completion');
  const cases = [
    { name: 'single', payload: () => [node('s1')] },
    { name: 'multiple', payload: () => [node('s1'), node('s2'), node('s3')] },
    { name: 'headed-payload', head: 'source-head', payload: () => [node('s1'), node('s2')] },
    { name: 'start-only', head: 'source-head', payload: () => [] },
    { name: 'two-level-payload', payload: () => nested('s') },
    { name: 'two-level-target', payload: () => [node('s1'), node('s2')], target: () => nested('t') },
    { name: 'two-level-both', payload: () => nested('s'), target: () => nested('t') }
  ];
  async function fixture(shape, scale, options = {}) {
    CardCanvas.cancel();
    const height = viewport.clientHeight;
    const targetY = Math.min(170, height * .46), sourceY = Math.min(350, height * .76);
    const data = { schemaVersion: 2, kind: 'free-canvas', groups: [
      { id: 'target', startId: options.targetHead || null, x: 200 / scale, y: targetY / scale,
        items: shape.target ? shape.target() : [node('t1'), node('t2')] },
      { id: 'source', startId: shape.head || null, x: 80 / scale, y: sourceY / scale, items: shape.payload() }
    ], selectedGroupId: 'source', viewport: { x: 0, y: 0, scale } };
    CardEditor.setWorkspace(data); await frame();
    const advance = groupElement('source')._metrics.advance;
    // The touch stays on-screen even when a long payload/target extends outside
    // a phone viewport. This leaves at least 80 screen px before the payload.
    data.groups[0].x = (options.targetX ?? Math.max(200, advance * scale + 80)) / scale;
    CardEditor.setWorkspace(data); await frame();
    const baseline = copy(CardEditor.getWorkspace());
    const targetGeometry = geometry(groupElement('target'));
    const frontSlots = CardCanvas.getSlots().filter(s => s.side === 'front');
    check(frontSlots.every(s => s.parentUid === null && s.index === 0 &&
      baseline.groups.find(g => g.id === s.groupId)?.startId === null), 'front socket exposed before a head or inside a loop');
    return { baseline, targetGeometry, advance, scale, sourceY };
  }
  async function activate(shape, scale, options) {
    const f = await fixture(shape, scale, options);
    const el = shape.head ? groupElement('source').querySelector('.free-canvas-start') :
      CardEditor.findBlockByUid(f.baseline.groups[1].items[0].uid);
    const r = el.getBoundingClientRect();
    const p = { x: r.left + 20 * scale, y: r.top + Number(el.dataset.connectorY) * scale };
    el.dispatchEvent(event('pointerdown', p));
    await move({ x: p.x + 14, y: p.y });
    check(CardCanvas.getGesture()?.active, `${shape.name}: drag did not activate`);
    const slot = CardCanvas.getSlots().find(s => s.groupId === 'target' && s.side === 'front');
    return { ...f, slot };
  }
  async function snap(shape, scale, options) {
    const f = await activate(shape, scale, options);
    check(f.slot, `${shape.name}: no front socket`);
    // The right connector excludes the SVG's eight-pixel protruding plug.
    const ghost = document.querySelector('.free-canvas-ghost');
    check(ghost._metrics.advance === f.advance, 'payload advance changed while dragging');
    const destination = { x: f.slot.x - f.advance * scale + 20 * scale, y: f.slot.y };
    await move(destination);
    check(CardCanvas.getGesture()?.target?.side === 'front', `${shape.name} @ ${scale}: did not use front snap`);
    return { ...f, destination };
  }
  async function commitAndCompare(shape, f, { undo = true, stableTarget = true } = {}) {
    const projected = geometry(document.querySelector('.free-canvas-projection'));
    let maxError = stableTarget ? compareGeometry(f.targetGeometry,
      geometry(document.querySelector('.free-canvas-world')), `${shape.name}: target moved during preview`) : 0;
    document.dispatchEvent(event('pointerup', f.destination)); await frame();
    noPreviews();
    const actual = geometry(document.querySelector('.free-canvas-world'));
    maxError = Math.max(maxError, compareGeometry(projected, actual, `${shape.name}: projection/drop mismatch`));
    if (stableTarget) maxError = Math.max(maxError, compareGeometry(f.targetGeometry, actual, `${shape.name}: target moved after drop`));
    const merged = copy(CardEditor.getWorkspace()), target = merged.groups[0];
    check(merged.groups.length === 1 && target.id === 'target', `${shape.name}: target group identity changed`);
    equal(target.items, [...f.baseline.groups[1].items, ...f.baseline.groups[0].items], `${shape.name}: sequence/nesting/parameters changed`);
    check(target.startId === (shape.head || null), `${shape.name}: start relationship changed`);
    check(Math.abs(target.x - (f.baseline.groups[0].x - f.advance)) < 1e-8 &&
      target.y === f.baseline.groups[0].y, `${shape.name}: committed coordinates differ from front preview`);
    const identities = [...document.querySelectorAll('.free-canvas-world [data-node-uid], .free-canvas-world [data-start-id]')]
      .map(el => el.dataset.nodeUid || '@start:' + el.dataset.startId);
    check(identities.length === new Set(identities).size, `${shape.name}: duplicate identities`);
    if (undo) {
      CardEditor.undo(); await frame();
      equal(CardEditor.getWorkspace(), f.baseline, `${shape.name}: one undo did not restore pre-drag state`);
      CardEditor.redo(); await frame();
      equal(CardEditor.getWorkspace(), merged, `${shape.name}: redo did not replay the same merge`);
    }
    return { maxError, comparedPayloadNodes: Object.keys(projected).length, undoRedo: undo };
  }
  try {
    for (const scale of [.5, 1, 1.5]) for (const shape of cases) {
      const f = await snap(shape, scale);
      results.push({ case: shape.name, scale, ...await commitAndCompare(shape, f) });
    }
    for (const scale of [.5, 1, 1.5]) {
      const f = await snap(cases[1], scale), vr = viewport.getBoundingClientRect();
      await move({ x: f.destination.x, y: vr.top + f.sourceY });
      check(!document.querySelector('.free-canvas-projection'), 'leaving front range left a projection');
      compareGeometry(f.targetGeometry, geometry(document.querySelector('.free-canvas-world')), 'leaving range moved target');
      await move(f.destination);
      check(CardCanvas.getGesture()?.target?.side === 'front', 'could not re-enter front snap after leaving it');
      document.dispatchEvent(event('pointercancel', f.destination)); await frame();
      equal(CardEditor.getWorkspace(), f.baseline, 'pointercancel did not restore groups and positions');
      noPreviews(); results.push({ case: 'leave-reenter-pointercancel', scale, pass: true });
    }
    const blockedShape = { name: 'two-heads', head: 'source-head', payload: () => [node('s1')] };
    const blocked = await activate(blockedShape, 1, { targetHead: 'target-head' });
    check(!blocked.slot && !CardCanvas.getSlots().some(s => s.groupId === 'target' && s.side === 'front'), 'headed group exposed a front socket');
    const afterHead = CardCanvas.getSlots().find(s => s.groupId === 'target' && s.parentUid === null && s.index === 0);
    await move({ x: afterHead.x + 20, y: afterHead.y });
    check(!CardCanvas.getGesture()?.target && !document.querySelector('.free-canvas-projection'), 'two started groups were offered an illegal merge');
    CardCanvas.cancel(); equal(CardEditor.getWorkspace(), blocked.baseline, 'blocked headed drop did not cancel cleanly');
    noPreviews(); results.push({ case: 'headed-target-and-two-head-rejection', pass: true });

    // Edge pan moves the viewport, not the target's document coordinates. Freeze
    // the touch just outside the edge band before taking the final geometry.
    const edge = await snap(cases[0], 1, { targetX: 74 });
    await frame();
    const edgeView = CardEditor.getWorkspace().viewport;
    check(edgeView.x > edge.baseline.viewport.x, 'front drag did not pan at the left edge');
    const edgeBounds = viewport.getBoundingClientRect();
    edge.destination = { x: edgeBounds.left + 50, y: edge.destination.y };
    await move(edge.destination);
    check(CardCanvas.getGesture()?.target?.side === 'front', 'front hysteresis was lost while leaving the edge band');
    results.push({ case: 'edge-pan-front', scale: 1, ...await commitAndCompare(cases[0], edge, { stableTarget: false }) });

    // Palette drag keeps the palette's own size while its ghost uses canvas scale.
    CardCanvas.cancel();
    document.getElementById('tab-motor')?.click(); await frame(); await frame();
    const vr = viewport.getBoundingClientRect(), targetY = Math.min(170, vr.height * .46);
    CardEditor.setWorkspace({ schemaVersion: 2, kind: 'free-canvas', groups: [
      { id: 'target', startId: null, x: 200, y: targetY, items: [node('t1'), node('t2')] }
    ], selectedGroupId: 'target', viewport: { x: 0, y: 0, scale: 1 } });
    palette.scrollLeft = 0; await frame();
    const paletteBaseline = copy(CardEditor.getWorkspace()), targetBefore = geometry(groupElement('target'));
    const card = palette.querySelector('[data-card-id="motor-reverse"]');
    check(card, 'motor palette card is missing');
    const pr = card.getBoundingClientRect(), p = { x: pr.left + pr.width / 2, y: pr.top + pr.height / 3 };
    card.dispatchEvent(event('pointerdown', p)); await move({ x: p.x, y: p.y - 24 });
    check(CardCanvas.getGesture()?.active && CardCanvas.getGesture().source === 'palette', 'palette did not create a drag');
    const port = CardCanvas.getSlots().find(s => s.groupId === 'target' && s.side === 'front');
    const payloadAdvance = document.querySelector('.free-canvas-ghost')._metrics.advance;
    const drop = { x: port.x - payloadAdvance + 26, y: port.y };
    await move(drop); check(CardCanvas.getGesture()?.target?.side === 'front', 'palette failed to front-snap');
    const paletteProjection = geometry(document.querySelector('.free-canvas-projection'));
    document.dispatchEvent(event('pointerup', drop)); await frame(); noPreviews();
    compareGeometry(targetBefore, geometry(document.querySelector('.free-canvas-world')), 'palette front moved target');
    const paletteMaxError = compareGeometry(paletteProjection, geometry(document.querySelector('.free-canvas-world')), 'palette projection/drop');
    check(CardEditor.getWorkspace().groups[0].items[0].id === 'motor-reverse' &&
      CardEditor.getWorkspace().groups[0].items.length === 3, 'palette block did not prepend exactly once');
    const paletteMerged = copy(CardEditor.getWorkspace());
    CardEditor.undo(); await frame(); equal(CardEditor.getWorkspace(), paletteBaseline, 'palette undo was not one operation');
    CardEditor.redo(); await frame(); equal(CardEditor.getWorkspace(), paletteMerged, 'palette redo changed merge');
    results.push({ case: 'palette-front', scale: 1, maxError: paletteMaxError, undoRedo: true });
    return { pass: true, input: 'DOM touch PointerEvent simulation', viewport: { width: innerWidth, height: innerHeight }, results };
  } finally {
    CardCanvas.cancel(); CardEditor.setWorkspace(saved);
    if (savedTab) document.getElementById(savedTab)?.click();
    palette.scrollLeft = savedPaletteScroll;
  }
})();
