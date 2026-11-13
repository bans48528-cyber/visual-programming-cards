/* Run through the browser development tool on an isolated local QA origin.
 * Uses the shipping renderer, CSS and pointer handlers; restores the workspace.
 * The returned promise compares live insertion geometry with the committed drop.
 */
(async function verifyFreeCanvasProjection() {
  const saved = CardEditor.getWorkspace(), results = [];
  const frame = () => new Promise(requestAnimationFrame);
  const copy = value => JSON.parse(JSON.stringify(value));
  const node = uid => ({ uid, id: 'motor-reverse', params: { port: 'L', duration: 1 } });
  const loop = (uid, children) => ({ uid, id: 'loop-count', params: { count: 2 }, children });
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const bounds = element => {
    const r = element.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  const geometry = root => Object.fromEntries([...root.querySelectorAll('[data-node-uid]')]
    .map(el => [el.dataset.nodeUid, bounds(el)]));
  const event = (type, p, id = 91) => new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
    button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: p.x, clientY: p.y, isPrimary: true
  });
  const move = async p => { document.dispatchEvent(event('pointermove', p)); await frame(); };
  const shapes = [
    { name: 'tail', items: () => [node('t1'), node('t2')], parentUid: null, index: 2 },
    { name: 'middle', items: () => [node('t1'), node('t2'), node('t3')], parentUid: null, index: 1 },
    { name: 'loop-inner', items: () => [loop('outer', [node('t1'), node('t2')])], parentUid: 'outer', index: 1 },
    { name: 'nested-loop-inner', items: () => [loop('outer', [loop('inner', [node('t1'), node('t2')])])], parentUid: 'inner', index: 1 },
    { name: 'nested-payload', items: () => [node('t1'), node('t2')], parentUid: null, index: 1, nested: true }
  ];
  async function begin(shape, scale) {
    CardCanvas.cancel();
    const height = document.querySelector('.free-canvas-viewport').clientHeight;
    const payload = shape.nested
      ? [node('s1'), loop('s-loop', [node('s-inner1'), loop('s-loop2', [node('s-inner2')])]), node('s3')]
      : [node('s1'), node('s2'), node('s3')];
    CardEditor.setWorkspace({ schemaVersion: 2, kind: 'free-canvas',
      groups: [
        { id: 'target', startId: 'target-head', x: 70 / scale, y: Math.min(150, height * .45) / scale, items: shape.items() },
        { id: 'source', startId: null, x: 100 / scale, y: Math.min(340, height * .8) / scale, items: payload }
      ], selectedGroupId: 'source', viewport: { x: 0, y: 0, scale } });
    await frame();
    const original = copy(CardEditor.getWorkspace());
    const el = CardEditor.findBlockByUid('s1'), r = el.getBoundingClientRect();
    const p = { x: r.left + 20 * scale, y: r.top + Number(el.dataset.connectorY) * scale };
    el.dispatchEvent(event('pointerdown', p));
    await move({ x: p.x + 14, y: p.y });
    check(CardCanvas.getGesture()?.active, 'touch did not activate the suffix drag');
    const slot = CardCanvas.getSlots().find(s => s.groupId === 'target' && s.parentUid === shape.parentUid && s.index === shape.index);
    check(slot, `missing target port: ${shape.name}`);
    const destination = { x: slot.x + 20 * scale, y: slot.y };
    await move(destination);
    check(CardCanvas.getGesture()?.target?.parentUid === shape.parentUid &&
      CardCanvas.getGesture()?.target?.index === shape.index, `wrong snap target: ${shape.name}`);
    return { original, destination };
  }
  try {
    for (const scale of [.5, 1, 1.5]) {
      for (const shape of shapes) {
        const { destination } = await begin(shape, scale);
        const projection = document.querySelector('.free-canvas-projection');
        check(projection, `missing projection: ${shape.name} @ ${scale}`);
        const projected = geometry(projection);
        const target = document.querySelector('.free-canvas-world > [data-group-id="target"]');
        const neighbours = geometry(target);
        let maxError = 0;
        document.dispatchEvent(event('pointerup', destination));
        await frame();
        for (const [uid, expected] of Object.entries({ ...neighbours, ...projected })) {
          const el = CardEditor.findBlockByUid(uid);
          check(el, `lost node ${uid}`);
          const actual = bounds(el);
          for (const key of ['x', 'y', 'width', 'height']) {
            const error = Math.abs(actual[key] - expected[key]);
            maxError = Math.max(maxError, error);
            check(error < .5, `${shape.name} @ ${scale}: ${uid}.${key} moved ${error}px after drop`);
          }
        }
        const workspace = CardEditor.getWorkspace();
        check(workspace.groups.length === 1, 'drop did not merge source and target');
        const uids = [...document.querySelectorAll('.free-canvas-world [data-node-uid]')].map(el => el.dataset.nodeUid);
        check(uids.length === new Set(uids).size, 'duplicate nodes after drop');
        check(!document.querySelector('.free-canvas-projection, .free-canvas-ghost'), 'drop left a preview behind');
        results.push({ case: shape.name, scale, compared: Object.keys(neighbours).length, maxError });
      }
    }
    const pending = await begin(shapes[0], 1);
    const area = document.querySelector('.free-canvas-viewport').getBoundingClientRect();
    await move({ x: area.left + area.width * .65, y: area.top + area.height * .65 });
    check(!document.querySelector('.free-canvas-projection'), 'leaving snap range left a projection');
    document.dispatchEvent(event('pointercancel', pending.destination));
    await frame();
    check(JSON.stringify(CardEditor.getWorkspace()) === JSON.stringify(pending.original), 'cancel did not restore the original structure and layout');
    check(!CardCanvas.getGesture() && !document.querySelector('.free-canvas-projection, .free-canvas-ghost'), 'cancel left an active drag');
    results.push({ case: 'leave-range-and-cancel', pass: true });
    return { pass: true, input: 'DOM touch PointerEvent simulation', viewport: { width: innerWidth, height: innerHeight }, results };
  } finally {
    CardCanvas.cancel();
    CardEditor.setWorkspace(saved);
  }
})();
