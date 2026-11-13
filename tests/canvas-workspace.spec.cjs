'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const workspace = require('../canvas-workspace.js');

function node(uid, id = 'wait-time', params = { duration: 1 }) {
  return { uid, id, params };
}
function loop(uid, children = []) {
  return { uid, id: 'loop-count', params: { count: 2 }, children };
}
function group(id, items = [], startId = null, x = 80, y = 100) {
  return { id, x, y, startId, items };
}
function doc(...groups) {
  return { ...workspace.create(), groups };
}
function ids(items) { return items.map(item => item.uid); }
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('creates an empty serializable v2 canvas and loads without DOM in a browser', () => {
  const empty = workspace.create();
  assert.deepEqual(empty, {
    schemaVersion: 2, kind: 'free-canvas', groups: [],
    viewport: { x: 0, y: 0, scale: 1 }, selectedGroupId: null
  });
  assert.equal(Object.hasOwn(empty, 'stagedGroups'), false);
  assert.equal(workspace.validate(empty).ok, true);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../canvas-workspace.js'), 'utf8'), context);
  assert.equal(context.CanvasWorkspace.create().kind, 'free-canvas');
  assert.equal(context.CanvasWorkspace.validate(context.CanvasWorkspace.create()).ok, true);
});

test('supports multiple independent starts, selection, and movement without proximity merging', () => {
  const original = freeze(doc(group('a', [node('a1')], 'sa'), group('b', [node('b1')], 'sb', 200, -30)));
  let result = workspace.select(original, 'b');
  result = workspace.move(result, 'b', { x: 81, y: 100 });
  assert.equal(result.groups.length, 2);
  assert.equal(result.selectedGroupId, 'b');
  assert.equal(result.groups[1].startId, 'sb');
  assert.deepEqual(result.groups[1].items, original.groups[1].items);
  assert.deepEqual([result.groups[1].x, result.groups[1].y], [81, 100]);
  assert.equal(original.groups[1].x, 200);
  assert.equal(workspace.validate(result).ok, true);
});

test('moving a start extracts the entire group and preserves every identity and connector origin', () => {
  const original = freeze(doc(group('a', [node('a1'), loop('l1', [node('l1a')]), node('a2')], 'sa')));
  const extracted = workspace.extract(original, { groupId: 'a', nodeId: 'sa' });
  assert.equal(extracted.ok, true);
  assert.equal(extracted.doc.groups.length, 0);
  assert.equal(extracted.payload.startId, 'sa');
  assert.deepEqual(ids(extracted.payload.items), ['a1', 'l1', 'a2']);
  const dropped = workspace.drop(extracted.doc, extracted.payload, { x: -120.5, y: 240.25 });
  assert.equal(dropped.ok, true);
  assert.equal(dropped.groupId, 'a');
  assert.deepEqual(dropped.doc.groups[0], { ...original.groups[0], x: -120.5, y: 240.25 });
  assert.equal(original.groups.length, 1);
});

test('detaches an ordinary suffix, keeps whole nested loops, then merges at a root middle slot', () => {
  const nested = loop('outer', [node('c1'), loop('inner', [node('deep')]), node('c2')]);
  const original = freeze(doc(
    group('a', [node('a1'), nested, node('tail')], 'sa'),
    group('b', [node('b1'), node('b2')], 'sb')
  ));
  const extracted = workspace.extract(original, { groupId: 'a', nodeId: 'outer' });
  assert.equal(extracted.ok, true);
  assert.deepEqual(ids(extracted.doc.groups[0].items), ['a1']);
  assert.equal(extracted.doc.groups[0].startId, 'sa');
  assert.equal(extracted.payload.startId, null);
  assert.deepEqual(extracted.payload.items[0], nested);
  const detached = workspace.drop(extracted.doc, extracted.payload, { x: 500, y: 350 });
  assert.equal(detached.ok, true);
  assert.notEqual(detached.groupId, 'a');
  assert.equal(workspace.findGroup(detached.doc, detached.groupId).startId, null);
  const again = workspace.extract(detached.doc, { groupId: detached.groupId, nodeId: 'outer' });
  assert.equal(again.doc.groups.length, 2);
  const merged = workspace.drop(again.doc, again.payload, { groupId: 'b', parentUid: null, index: 1 });
  assert.equal(merged.ok, true);
  assert.deepEqual(ids(workspace.findGroup(merged.doc, 'b').items), ['b1', 'outer', 'tail', 'b2']);
  assert.deepEqual(workspace.findNode(merged.doc, 'deep').path, [1, 1, 0]);
  assert.deepEqual(original.groups[0].items[1], nested);
  assert.equal(workspace.validate(merged.doc).ok, true);
});

test('extracts a suffix inside a loop without pulling siblings outside that loop', () => {
  const original = freeze(doc(group('a', [
    loop('outer', [node('c1'), loop('inner', [node('deep1'), node('deep2')]), node('c3')]),
    node('root-tail')
  ], 'sa')));
  const extracted = workspace.extract(original, { groupId: 'a', nodeId: 'inner' });
  assert.equal(extracted.ok, true);
  assert.deepEqual(ids(extracted.payload.items), ['inner', 'c3']);
  assert.equal(extracted.payload.sourceParentUid, 'outer');
  assert.deepEqual(ids(workspace.findNode(extracted.doc, 'outer').item.children), ['c1']);
  assert.deepEqual(ids(extracted.doc.groups[0].items), ['outer', 'root-tail']);
  const location = workspace.findNode(original, 'deep2');
  assert.equal(location.group.id, 'a');
  assert.equal(location.parentUid, 'inner');
  assert.equal(location.index, 1);
  assert.equal(location.sequence, original.groups[0].items[0].children[1].children);
  assert.deepEqual(location.path, [0, 1, 1]);
});

test('inserts ordinary suffixes into nested loop middles and preserves two-level containment', () => {
  const original = freeze(doc(group('a', [
    loop('outer', [loop('inner', [node('c1'), node('c2')])]), node('tail')
  ], 'sa'), group('detached', [node('new1'), node('new2')])));
  const extracted = workspace.extract(original, { groupId: 'detached', nodeId: 'new1' });
  const result = workspace.drop(extracted.doc, extracted.payload, { groupId: 'a', parentUid: 'inner', index: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(ids(workspace.findNode(result.doc, 'inner').item.children), ['c1', 'new1', 'new2', 'c2']);
  assert.deepEqual(ids(result.doc.groups[0].items), ['outer', 'tail']);
  assert.equal(result.doc.groups.length, 1);
  assert.deepEqual(workspace.findNode(result.doc, 'new2').path, [0, 0, 2]);
  assert.equal(workspace.validate(result.doc).ok, true);
});

test('a headed group may prepend to a headless root and may not enter a loop, follow another card, or join another head', () => {
  const original = freeze(doc(group('a', [loop('outer', [node('inside')]), node('a1')], 'sa'), group('plain', [node('p1'), node('p2')])));
  const payload = freeze({ startId: 'sb', items: [node('b1')], sourceGroupId: 'b' });
  const targets = [
    [{ groupId: 'a', parentUid: 'outer', index: 0 }, 'start-in-loop'],
    [{ groupId: 'plain', parentUid: null, index: 1 }, 'start-not-first'],
    [{ groupId: 'a', parentUid: null, index: 0 }, 'two-starts']
  ];
  for (const [target, reason] of targets) {
    const rejected = workspace.drop(original, payload, target);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, reason);
    assert.equal(rejected.doc, original);
  }
  const accepted = workspace.drop(original, payload, { groupId: 'plain', parentUid: null, index: 0 });
  assert.equal(accepted.ok, true);
  assert.equal(workspace.findGroup(accepted.doc, 'plain').startId, 'sb');
  assert.deepEqual(ids(workspace.findGroup(accepted.doc, 'plain').items), ['b1', 'p1', 'p2']);
});

test('rejects drops into a dragged descendant, duplicate existing nodes, duplicate payload nodes, and cyclic loops', () => {
  const original = freeze(doc(group('a', [loop('outer', [node('a1')]), node('a2')], 'sa')));
  const extracted = workspace.extract(original, { groupId: 'a', nodeId: 'outer' });
  const self = workspace.drop(extracted.doc, extracted.payload, { groupId: 'a', parentUid: 'outer', index: 0 });
  assert.equal(self.ok, false);
  assert.equal(self.reason, 'self-descendant');
  assert.equal(self.doc, extracted.doc);
  const duplicate = workspace.drop(original, { startId: null, items: [node('a1')] }, { x: 1, y: 2 });
  assert.equal(duplicate.reason, 'duplicate-identity');
  assert.equal(duplicate.doc, original);
  const internalDuplicate = workspace.drop(original, { items: [node('same'), loop('new-loop', [node('same')])] }, { x: 1, y: 2 });
  assert.equal(internalDuplicate.reason, 'duplicate-identity');
  const cyclic = loop('cyclic');
  cyclic.children.push(cyclic);
  const cycle = workspace.drop(original, { items: [cyclic] }, { x: 1, y: 2 });
  assert.equal(cycle.reason, 'cyclic-items');
  assert.equal(cycle.doc, original);
});

test('rejects unknown parents, invalid slots and malformed starts without altering documents', () => {
  const original = freeze(doc(group('a', [node('a1'), loop('l1')], 'sa')));
  const payload = freeze({ items: [node('new')] });
  for (const target of [
    { groupId: 'missing', index: 0 },
    { groupId: 'a', parentUid: 'missing', index: 0 },
    { groupId: 'a', parentUid: 'a1', index: 0 },
    { groupId: 'a', index: -1 },
    { groupId: 'a', index: 0.5 },
    { groupId: 'a', index: 30 },
    { x: Number.NaN, y: 20 }
  ]) {
    const result = workspace.drop(original, payload, target);
    assert.equal(result.ok, false);
    assert.equal(result.doc, original);
  }
  assert.equal(workspace.drop(original, { items: [node('invalid-start', 'start')] }, { x: 1, y: 1 }).reason, 'start-in-sequence');
  assert.equal(workspace.extract(original, { groupId: 'a', nodeId: 'missing' }).doc, original);
});

test('normalization preserves identities, repairs repeats in recovered groups, and filters with a catalog callback', () => {
  const raw = doc(group('a', [
    node('stable', 'wait-time', { duration: 3 }),
    loop('l1', [node('stable'), node('unknown', 'not-in-catalog')]),
    { id: 'wait-time', params: { duration: 8 } }
  ], 'sa'), group('a', [node('n2')], 'sa'));
  raw.stagedGroups = [{ id: 'staged', items: [node('stable', 'wait-time', { duration: 9 })] }];
  raw.selectedGroupId = 'a';
  const before = JSON.stringify(raw);
  const result = workspace.normalize(raw, {
    normalizeItem(item) { return item.id === 'not-in-catalog' ? null : item; }
  });
  assert.equal(JSON.stringify(raw), before);
  assert.equal(result.groups[0].id, 'a');
  assert.equal(result.groups[0].startId, 'sa');
  assert.equal(result.groups[0].items[0].uid, 'stable');
  assert.equal(result.groups[0].items[1].uid, 'l1');
  assert.equal(result.groups[0].items[1].children.length, 1);
  assert.notEqual(result.groups[0].items[1].children[0].uid, 'stable');
  assert.notEqual(result.groups[1].id, 'a');
  assert.notEqual(result.groups[1].startId, 'sa');
  assert.equal(result.groups[2].id, 'staged');
  assert.notEqual(result.groups[2].items[0].uid, 'stable');
  assert.equal(result.groups[2].items[0].params.duration, 9);
  assert.equal(Object.hasOwn(result, 'stagedGroups'), false);
  assert.equal(result.selectedGroupId, 'a');
  assert.equal(workspace.validate(result).ok, true);
  assert.deepEqual(workspace.normalize(result), result);
});

test('JSON save/reopen preserves canvas coordinates, scale, selection, parameters, stable IDs and nested edits', () => {
  let original = doc(
    group('a', [loop('l1', [node('n1')])], 'sa', -80.25, 241.5),
    group('plain', [node('p1')]),
    group('matrix-group', [node('s1', 'matrix-display', { pattern: [0, 1, 0] })], null, 640, 480)
  );
  original = workspace.select(workspace.view(original, { x: 53.5, y: -46.25, scale: 0.75 }), 'a');
  original = freeze(original);
  const pattern = [1, 0, 1];
  const updated = workspace.setParam(original, 'n1', 'pattern', pattern);
  pattern[0] = 0;
  assert.deepEqual(workspace.findNode(updated, 'n1').item.params.pattern, [1, 0, 1]);
  assert.equal(workspace.findNode(original, 'n1').item.params.pattern, undefined);
  const reopened = workspace.normalize(JSON.parse(JSON.stringify(updated)));
  assert.deepEqual(reopened, updated);
  assert.equal(Object.hasOwn(reopened, 'stagedGroups'), false);
  assert.equal(workspace.validate(reopened).ok, true);
});

test('single-node removal keeps suffix cards; removing the last detached node prunes its empty group', () => {
  const original = freeze(doc(group('a', [node('first'), loop('l1', [node('inside')]), node('tail')], 'sa'), group('plain', [node('only')])));
  const single = workspace.remove(original, { groupId: 'a', nodeId: 'l1' });
  assert.deepEqual(ids(single.groups[0].items), ['first', 'tail']);
  assert.equal(workspace.findNode(single, 'inside'), null);
  const empty = workspace.remove(workspace.select(single, 'plain'), { groupId: 'plain', nodeId: 'only' });
  assert.equal(empty.groups.length, 1);
  assert.equal(empty.selectedGroupId, null);
  const head = workspace.remove(empty, { groupId: 'a', head: true });
  assert.equal(head.groups.length, 0);
  assert.equal(original.groups[0].items.length, 3);
});

test('legacy template conversion restores old shelf contents as ordinary canvas groups without changing its source', () => {
  const legacy = freeze({
    program: [node('a1'), loop('l1', [node('inside')])],
    stagedGroups: [{ id: 'stage', startId: 'stage-head', items: [loop('stage-loop', [node('s1', 'wait-time', { duration: 4.5 })])] }]
  });
  const before = JSON.stringify(legacy);
  assert.deepEqual(workspace.normalize(legacy), workspace.create());
  assert.deepEqual(workspace.normalize(legacy.program), workspace.create());
  const converted = workspace.fromLegacy(legacy);
  assert.equal(converted.groups.length, 2);
  assert.equal(typeof converted.groups[0].startId, 'string');
  assert.equal(converted.groups[0].items[0].uid, 'a1');
  assert.equal(converted.groups[1].id, 'stage');
  assert.equal(converted.groups[1].startId, 'stage-head');
  assert.equal(converted.groups[1].items[0].uid, 'stage-loop');
  assert.equal(workspace.findNode(converted, 's1').item.params.duration, 4.5);
  assert.ok(converted.groups[1].y > converted.groups[0].y);
  assert.equal(Object.hasOwn(converted, 'stagedGroups'), false);
  assert.equal(converted.selectedGroupId, converted.groups[0].id);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(workspace.validate(converted).ok, true);
});

test('old v2 shelf groups recover IDs, heads, parameters and nested loops while existing positions stay fixed', () => {
  const raw = doc(
    group('main', [loop('main-loop', [node('main-node')])], 'main-head', 220.25, -150.5),
    group('lower', [node('lower-node')], null, -220, 720)
  );
  raw.selectedGroupId = 'main';
  raw.stagedGroups = [
    { id: 'old-tail', items: [loop('saved-loop', [
      node('saved-matrix', 'matrix-display', { pattern: [1, 0, 1, 0] }),
      loop('nested-loop', [node('nested-note', 'play-note', { note: '3', beats: '0.5' })])
    ])] },
    { id: 'old-headed', startId: 'old-head', x: 1250.5, y: 640.25, items: [node('saved-action', 'wait-time', { duration: 12.5 })] },
    { id: 'empty-headed', startId: 'empty-head', items: [] }
  ];
  const before = JSON.stringify(raw);
  freeze(raw);
  const result = workspace.normalize(raw);
  assert.equal(JSON.stringify(raw), before, 'recovery never writes into the original saved state');
  assert.equal(result.groups.length, 5);
  assert.deepEqual(result.groups.slice(0, 2), raw.groups);
  assert.equal(result.selectedGroupId, 'main');
  const recovered = workspace.findGroup(result, 'old-tail');
  assert.equal(recovered.startId, null);
  assert.deepEqual(recovered.items, raw.stagedGroups[0].items);
  assert.ok(recovered.y > 816, 'missing positions place recovered content below the existing canvas');
  assert.deepEqual(workspace.findNode(result, 'nested-note').path, [0, 1, 0]);
  const headed = workspace.findGroup(result, 'old-headed');
  assert.equal(headed.startId, 'old-head');
  assert.deepEqual([headed.x, headed.y], [1250.5, 640.25]);
  assert.deepEqual(headed.items, raw.stagedGroups[1].items);
  assert.ok(workspace.findGroup(result, 'empty-headed').y > recovered.y);
  assert.equal(Object.hasOwn(result, 'stagedGroups'), false);
  assert.equal(workspace.validate(result).ok, true);
});

test('recovered old shelf groups are ordinary editable groups and repeated normalize or save/reopen adds nothing', () => {
  const raw = { ...workspace.create(), stagedGroups: [
    { id: 'recovered-a', items: [node('saved-a1'), loop('saved-a-loop', [node('saved-child')])] },
    { id: 'recovered-b', items: [node('saved-b1')] }
  ] };
  const once = workspace.normalize(raw);
  assert.equal(once.groups.length, 2);
  assert.deepEqual(workspace.normalize(once), once);
  const serialized = JSON.stringify(once);
  assert.equal(serialized.includes('stagedGroups'), false);
  assert.deepEqual(workspace.normalize(JSON.parse(serialized)), once);
  const edited = workspace.setParam(once, 'saved-child', 'duration', 9);
  assert.equal(workspace.findNode(edited, 'saved-child').item.params.duration, 9);
  const extracted = workspace.extract(edited, { groupId: 'recovered-a', nodeId: 'saved-a-loop' });
  const merged = workspace.drop(extracted.doc, extracted.payload, { groupId: 'recovered-b', index: 1 });
  assert.equal(merged.ok, true);
  assert.deepEqual(ids(workspace.findGroup(merged.doc, 'recovered-b').items), ['saved-b1', 'saved-a-loop']);
  assert.equal(Object.hasOwn(merged.doc, 'stagedGroups'), false);
  assert.deepEqual(workspace.normalize(JSON.parse(JSON.stringify(merged.doc))), merged.doc);
  assert.equal(workspace.validate(merged.doc).ok, true);
});

test('recovery repairs colliding group, head and node identities without losing any old cards', () => {
  const raw = doc(group('existing', [node('stable-node')], 'stable-head'));
  raw.stagedGroups = [
    { id: 'existing', startId: 'stable-head', items: [loop('stable-node', [node('nested-stable')])] },
    { id: 'nested-stable', items: [node('stable-node'), node('last-node')] }
  ];
  const recovered = workspace.normalize(raw);
  assert.equal(recovered.groups.length, 3);
  assert.deepEqual(recovered.groups[0], raw.groups[0]);
  assert.notEqual(recovered.groups[1].id, 'existing');
  assert.notEqual(recovered.groups[1].startId, 'stable-head');
  assert.equal(recovered.groups[1].items[0].id, 'loop-count');
  assert.equal(recovered.groups[1].items[0].children[0].uid, 'nested-stable');
  assert.notEqual(recovered.groups[2].id, 'nested-stable');
  const identities = [];
  let count = 0;
  function collect(items) {
    for (const item of items) {
      count += 1;
      identities.push(item.uid);
      if (item.children) collect(item.children);
    }
  }
  for (const item of recovered.groups) {
    identities.push(item.id);
    if (item.startId) identities.push(item.startId);
    collect(item.items);
  }
  assert.equal(count, 5, 'recovery keeps every card, including duplicate-UID input cards');
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(workspace.validate(recovered).ok, true);
  assert.deepEqual(workspace.normalize(recovered), recovered);
});
