const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const M = require('../canvas-workspace.js');

// Expose the actual private production function only in this VM. No DOM or
// controller gesture is mocked, and the predicate is never copied into this test.
const productionSource = fs.readFileSync(path.join(__dirname, '../free-canvas.js'), 'utf8');
const exportMarker = 'global.FreeCanvas = { create };';
assert.equal(productionSource.split(exportMarker).length, 2, 'production export marker must be unique');
const sandbox = {};
vm.runInNewContext(productionSource.replace(exportMarker,
  'global.FreeCanvas = { create, previewLegalSlots };'), sandbox, { filename: 'free-canvas.js' });
const previewLegalSlots = sandbox.FreeCanvas.previewLegalSlots;
assert.equal(typeof previewLegalSlots, 'function', 'the production checker must exist');

test('empty-loop capture preview and model agree on nesting, range and payload legality', () => {
  const item = uid => ({uid, id: 'motor-forward', params: {}});
  const doc = M.normalize({...M.create(), groups: [{id: 'g', x: 10, y: 20, startId: 'head', items: [
    item('a'), {uid: 'outer', id: 'loop-count', params: {count: 2}, children: [item('b'), item('c')]}, item('d')
  ]}]});
  const payloads = [
    {startId: null, items: [{uid: 'incoming', id: 'loop', params: {}, children: []}]},
    {startId: null, items: [{uid: 'incoming', id: 'loop', params: {}, children: []}, item('tail')]},
    {startId: null, items: [{uid: 'incoming', id: 'loop', params: {}, children: [item('old-child')]}, item('tail')]},
    {startId: null, items: [{uid: 'incoming', id: 'loop', params: {}, children: [{uid: 'nested-incoming', id: 'loop', params: {}, children: [item('deep-incoming')]}]}]},
    {startId: 'new-head', items: [{uid: 'incoming', id: 'loop', params: {}, children: []}]},
    {startId: null, items: [item('ordinary')]}, {startId: null, items: []},
    {startId: null, items: [{uid: 'incoming', id: 'loop', params: {}, children: [item('b')]}]}
  ];
  const targets = [];
  for (const parentUid of [null, 'outer', 'absent', 'a', 'incoming']) {
    for (const index of [-1, 0, 1, 2, 3]) for (const endIndex of [0, 1, 2, 3, 4, 1.5])
      targets.push({key: String(targets.length), mode: 'wrap', groupId: 'g', parentUid, index, endIndex});
  }
  for (const payload of payloads) {
    const legal = previewLegalSlots(M, doc, payload, targets);
    if (payload.items[0]?.children?.length) assert.equal(legal.size, 0, 'a filled first loop must offer no automatic capture preview');
    for (const target of targets) assert.equal(legal.has(target.key), M.drop(doc, payload, target).ok,
      JSON.stringify({payload, target}));
  }
});

test('filled loops keep ordinary insertion previews but never capture or alter their children', () => {
  const item = uid => ({uid, id: 'motor-forward', params: {}});
  const doc = M.normalize({...M.create(), groups: [{id: 'g', x: 10, y: 20, startId: 'head', items: [
    item('a'), {uid: 'outer', id: 'loop-count', params: {count: 2}, children: [item('b'), item('c')]}, item('d')
  ]}]});
  const targets = [
    {key: 'capture-root', mode: 'wrap', groupId: 'g', parentUid: null, index: 0, endIndex: 3},
    {key: 'capture-inner', mode: 'wrap', groupId: 'g', parentUid: 'outer', index: 0, endIndex: 2},
    {key: 'insert-root', groupId: 'g', parentUid: null, index: 1},
    {key: 'insert-inner', groupId: 'g', parentUid: 'outer', index: 1}
  ];
  for (const children of [[item('own')], [{uid: 'own-loop', id: 'loop', params: {}, children: [item('own-deep')]}]]) {
    const payload = {startId: null, items: [{uid: 'incoming', id: 'loop', params: {}, children}, item('tail')]};
    const savedDoc = M.clone(doc), savedPayload = M.clone(payload);
    assert.deepEqual([...previewLegalSlots(M, doc, payload, targets)].sort(), ['insert-inner', 'insert-root']);
    for (const target of targets) {
      const result = M.drop(doc, payload, target);
      if (target.mode === 'wrap') { assert.equal(result.ok, false); assert.equal(result.doc, doc); }
      else {
        assert.equal(result.ok, true, result.reason);
        assert.deepEqual(M.findNode(result.doc, 'incoming').item.children, children);
        assert.deepEqual(M.validate(result.doc), {ok: true, errors: []});
      }
    }
    assert.deepEqual(doc, savedDoc); assert.deepEqual(payload, savedPayload);
  }
});

test('production snap preview matches complete model drops for normalized canvas groups', () => {
  const item = (uid, children) => ({ uid, id: children ? 'loop' : 'motor-forward', params: {}, ...(children ? { children } : {}) });
  let base = M.create();
  for (let groupIndex = 0; groupIndex < 10; groupIndex++) {
    base.groups.push({
      id: `g${groupIndex}`, x: groupIndex * 10, y: groupIndex * 10,
      startId: groupIndex % 2 ? `s${groupIndex}` : null,
      items: Array.from({ length: 10 }, (_, index) => item(`n${groupIndex}-${index}`,
        index === 3 ? [item(`child${groupIndex}`)] : undefined))
    });
  }
  base.groups.push({ id: 'detached', x: 0, y: 300, startId: null, items: [item('detached-node')] });
  base = M.normalize(base);
  const payloads = [
    { startId: null, items: [item('fresh')] },
    { startId: 'fresh-head', items: [item('fresh')] },
    { startId: 'fresh-head', items: [] },
    { startId: null, items: [] },
    { startId: null, items: [item('n0-1')] },
    { startId: 's1', items: [item('fresh')] },
    { startId: null, items: [item('detached-node')] },
    { startId: null, items: [{ uid: 'fresh', id: 'motor-forward' }] },
    { startId: null, items: [item('fresh'), item('fresh')] },
    { startId: null, items: [item('loop-incoming', [item('fresh')])] }
  ];
  function targetsFor(doc) {
    const targets = [];
    for (const group of doc.groups) {
      const parentIds = [null, 'absent', 'n1-1', ...group.items.map(node => node.uid),
        ...group.items.filter(node => node.children?.length).map(node => node.children[0].uid), 'loop-incoming'];
      for (const parentUid of parentIds) {
        for (const index of [-1, 0, 1, 2, 9, 10, 11, 1.5, null]) {
          targets.push({ key: String(targets.length), groupId: group.id, parentUid, index });
        }
      }
    }
    targets.push({ key: 'unknown-group', groupId: 'unknown', parentUid: null, index: 0 });
    return targets;
  }
  let comparedTargets = 0;
  function compare(doc, payload) {
    const targets = targetsFor(doc);
    const actual = previewLegalSlots(M, doc, payload, targets);
    for (const target of targets) {
      assert.equal(actual.has(target.key), M.drop(doc, payload, target).ok,
        `preview/model mismatch: ${JSON.stringify({ payload, target })}`);
      comparedTargets++;
    }
  }
  for (const payload of payloads) compare(base, payload);
  for (const nodeId of ['n0-2', 'n0-3', 'child0', 'n1-9']) {
    const extracted = M.extract(base, { groupId: nodeId.includes('1-') ? 'g1' : 'g0', nodeId });
    assert.ok(extracted.ok, `extract ${nodeId}`);
    compare(extracted.doc, extracted.payload);
  }
  for (const groupId of ['g0', 'g1']) {
    const extracted = M.extract(base, { groupId, head: true });
    assert.ok(extracted.ok, `extract whole ${groupId}`);
    compare(extracted.doc, extracted.payload);
  }
  const invalidDocument = M.clone(base);
  invalidDocument.groups[0].items[0].uid = 'n0-1';
  compare(invalidDocument, payloads[0]);
  assert.equal(comparedTargets, 23291, 'keep the reported comparison coverage explicit');
});
