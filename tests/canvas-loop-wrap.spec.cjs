'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../canvas-workspace.js');

// Pure document contract: only an empty first loop can capture a same-level
// continuous range. Preview and commit use this exact operation; no device seam.
const node = (uid, params = { duration: 1 }) => ({ uid, id: 'wait-time', params });
const loop = (uid, children = [], id = 'loop-count') => ({ uid, id, params: { count: 3 }, children });
const group = (id, items, startId = null, x = 80, y = 160) => ({ id, x, y, startId, items });
const document = (...groups) => ({ ...M.create(), groups });
const payload = (...items) => ({ startId: null, items });
const target = (groupId, index, endIndex, parentUid = null) => ({ mode: 'wrap', groupId, parentUid, index, endIndex });
const ids = items => items.map(item => item.uid);
function freeze(value, seen = new Set()) {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value); Object.values(value).forEach(child => freeze(child, seen)); Object.freeze(value);
  }
  return value;
}
function nodeIds(doc) {
  const all = [];
  const visit = items => items.forEach(item => { all.push(item.uid); if (Array.isArray(item.children)) visit(item.children); });
  doc.groups.forEach(g => visit(g.items));
  return all.sort();
}
function valid(result) { assert.equal(result.ok, true, result.reason); assert.deepEqual(M.validate(result.doc), { ok: true, errors: [] }); }
function rejected(doc, incoming, destination) {
  const result = M.drop(doc, incoming, destination);
  assert.equal(result.ok, false, JSON.stringify(destination));
  assert.equal(result.doc, doc, 'a rejected operation returns the unchanged original document');
}

test('wrap replaces only the chosen range and keeps the target head, position, viewport and other groups', () => {
  const original = freeze({ ...document(
    group('target', [node('prefix'), node('a'), node('b'), node('suffix')], 'head', -12.5, 240.25),
    group('untouched', [node('other')], 'other-head', 650, -20)
  ), viewport: { x: -35, y: 12.5, scale: .65 }, selectedGroupId: 'untouched' });
  const incoming = freeze(payload(loop('wrapper')));
  const result = M.drop(original, incoming, target('target', 1, 3)); valid(result);
  const wrapped = M.findGroup(result.doc, 'target');
  assert.equal(result.groupId, 'target'); assert.equal(result.doc.selectedGroupId, 'target');
  assert.deepEqual(ids(wrapped.items), ['prefix', 'wrapper', 'suffix']);
  assert.deepEqual(ids(wrapped.items[1].children), ['a', 'b']);
  assert.deepEqual([wrapped.startId, wrapped.x, wrapped.y], ['head', -12.5, 240.25]);
  assert.deepEqual(result.doc.viewport, original.viewport);
  assert.deepEqual(M.findGroup(result.doc, 'untouched'), original.groups[1]);
  assert.deepEqual(ids(original.groups[0].items), ['prefix', 'a', 'b', 'suffix']);
  assert.deepEqual(incoming.items[0].children, []);
  assert.deepEqual(nodeIds(result.doc), ['a', 'b', 'other', 'prefix', 'suffix', 'wrapper']);
});

test('an empty loop can capture nested target nodes while dragged following siblings stay outside', () => {
  const original = freeze(document(group('target', [node('before'), loop('captured-loop', [node('deep')]), node('captured-tail'), node('after')], 'head')));
  const incoming = freeze(payload(loop('wrapper'), node('dragged-tail'), loop('dragged-loop', [node('dragged-inner')])));
  const result = M.drop(original, incoming, target('target', 1, 3)); valid(result);
  const items = result.doc.groups[0].items;
  assert.deepEqual(ids(items), ['before', 'wrapper', 'dragged-tail', 'dragged-loop', 'after']);
  assert.deepEqual(ids(items[1].children), ['captured-loop', 'captured-tail']);
  assert.deepEqual(items[1].children[0], original.groups[0].items[1]);
  assert.deepEqual(items[3], incoming.items[2], 'a filled following sibling remains outside and unchanged');
  assert.deepEqual(items[1].params, { count: 3 });
  assert.deepEqual(nodeIds(result.doc), [...nodeIds(original), 'wrapper', 'dragged-tail', 'dragged-loop', 'dragged-inner'].sort());
});

test('a filled loop refuses automatic capture while ordinary insertion preserves its children and nesting', () => {
  const original = freeze(document(group('target', [node('a'), node('b')], 'head')));
  const incoming = freeze(payload(loop('wrapper', [node('own'), loop('own-loop', [node('own-deep')])]), node('dragged-tail')));
  const saved = M.clone(incoming), savedDocument = M.clone(original);
  rejected(original, incoming, target('target', 0, 2));
  assert.deepEqual(incoming, saved); assert.deepEqual(original, savedDocument);
  const inserted = M.drop(original, incoming, { groupId: 'target', parentUid: null, index: 1 }); valid(inserted);
  assert.deepEqual(ids(inserted.doc.groups[0].items), ['a', 'wrapper', 'dragged-tail', 'b']);
  assert.deepEqual(M.findNode(inserted.doc, 'wrapper').item, incoming.items[0]);
  assert.deepEqual(nodeIds(inserted.doc), [...nodeIds(original), 'wrapper', 'own', 'own-loop', 'own-deep', 'dragged-tail'].sort());
});

test('all C-shaped loop cards can capture only when empty, without a two-card whitelist', () => {
  for (const id of ['loop', 'loop-count', 'loop-infrared', 'loop-tilt', 'loop-time', 'future-c-shape']) {
    const original = freeze(document(group('g', [node('captured')])));
    const incoming = freeze(payload(loop('wrapper', [], id)));
    const result = M.drop(original, incoming, target('g', 0, 1)); valid(result);
    assert.equal(result.doc.groups[0].items[0].id, id);
    assert.deepEqual(ids(result.doc.groups[0].items[0].children), ['captured']);
    const filled = freeze(payload(loop('wrapper', [node('own')], id)));
    rejected(original, filled, target('g', 0, 1));
    assert.deepEqual(ids(filled.items[0].children), ['own']);
  }
});

test('a nested wrap operates only in the specified inner sequence and preserves outside siblings', () => {
  const original = freeze(document(group('g', [node('root-before'), loop('outer', [node('inner-before'), node('a'), node('b'), node('inner-after')]), node('root-after')], 'head')));
  const result = M.drop(original, freeze(payload(loop('wrapper'))), target('g', 1, 3, 'outer')); valid(result);
  assert.deepEqual(ids(result.doc.groups[0].items), ['root-before', 'outer', 'root-after']);
  assert.deepEqual(ids(M.findNode(result.doc, 'outer').item.children), ['inner-before', 'wrapper', 'inner-after']);
  assert.deepEqual(ids(M.findNode(result.doc, 'wrapper').item.children), ['a', 'b']);
  assert.deepEqual(M.findNode(result.doc, 'a').path, [1, 1, 0]);
  assert.deepEqual(M.findNode(result.doc, 'b').path, [1, 1, 1]);
  assert.equal(result.doc.groups[0].startId, 'head');
});

test('an empty loop extracted from the same group can wrap its former preceding range without duplicate UIDs', () => {
  const original = freeze(document(group('g', [node('a'), node('b'), loop('wrapper'), node('dragged-tail')], 'head', 24, 140)));
  const extracted = M.extract(original, { groupId: 'g', nodeId: 'wrapper' });
  assert.equal(extracted.ok, true); assert.deepEqual(ids(extracted.doc.groups[0].items), ['a', 'b']);
  assert.deepEqual(ids(extracted.payload.items), ['wrapper', 'dragged-tail']);
  const result = M.drop(freeze(extracted.doc), freeze(extracted.payload), target('g', 0, 2)); valid(result);
  assert.deepEqual(ids(result.doc.groups[0].items), ['wrapper', 'dragged-tail']);
  assert.deepEqual(ids(result.doc.groups[0].items[0].children), ['a', 'b']);
  assert.deepEqual(nodeIds(result.doc), nodeIds(original));
  assert.deepEqual([result.doc.groups[0].id, result.doc.groups[0].startId, result.doc.groups[0].x, result.doc.groups[0].y], ['g', 'head', 24, 140]);
});

test('a moved filled loop does not absorb its former preceding blocks or change nested children', () => {
  const original = freeze(document(group('g', [node('a'), node('b'), loop('wrapper', [node('own'), loop('nested', [node('deep')])]), node('tail')], 'head')));
  const saved = M.clone(original), extracted = M.extract(original, { groupId: 'g', nodeId: 'wrapper' });
  assert.equal(extracted.ok, true); freeze(extracted.doc); freeze(extracted.payload);
  const savedPayload = M.clone(extracted.payload), savedRemainder = M.clone(extracted.doc);
  rejected(extracted.doc, extracted.payload, target('g', 0, 2));
  assert.deepEqual(extracted.payload, savedPayload); assert.deepEqual(extracted.doc, savedRemainder);
  assert.deepEqual(original, saved, 'cancellation can restore the complete pre-extraction snapshot');
  const inserted = M.drop(extracted.doc, extracted.payload, { groupId: 'g', parentUid: null, index: 0 }); valid(inserted);
  assert.deepEqual(ids(inserted.doc.groups[0].items), ['wrapper', 'tail', 'a', 'b']);
  assert.deepEqual(M.findNode(inserted.doc, 'wrapper').item, original.groups[0].items[2]);
  assert.deepEqual(nodeIds(inserted.doc), nodeIds(original));
});

test('preview and commit produce the same stable graph; discarding a preview leaves the drag snapshot intact', () => {
  const original = freeze(document(group('source', [loop('wrapper'), node('outside')]), group('target', [node('a'), node('b')], 'head')));
  const saved = M.clone(original), extracted = M.extract(original, { groupId: 'source', nodeId: 'wrapper' });
  assert.equal(extracted.ok, true); freeze(extracted.doc); freeze(extracted.payload);
  const remaining = M.clone(extracted.doc), destination = freeze(target('target', 0, 2));
  const preview = M.drop(extracted.doc, extracted.payload, destination); valid(preview);
  const committed = M.drop(extracted.doc, extracted.payload, destination); valid(committed);
  assert.deepEqual(committed.doc, preview.doc, 'no fresh document identity may appear between preview and drop');
  assert.deepEqual(extracted.doc, remaining); assert.deepEqual(original, saved);
  assert.deepEqual(M.normalize(committed.doc), committed.doc, 'save/reload keeps every UID, child and position');
  // Undo/cancellation belongs to the controller: its original immutable snapshot
  // must remain available; this test does not pretend to exercise DOM history.
});

test('normal insertion still leaves the target range outside the incoming loop', () => {
  const original = freeze(document(group('g', [node('a'), node('b')], 'head')));
  const result = M.drop(original, freeze(payload(loop('wrapper'))), { groupId: 'g', parentUid: null, index: 0, endIndex: 2 }); valid(result);
  assert.deepEqual(ids(result.doc.groups[0].items), ['wrapper', 'a', 'b']);
  assert.deepEqual(result.doc.groups[0].items[0].children, []);
});

test('wrap requires a first loop and rejects any incoming start head', () => {
  const original = freeze(document(group('g', [node('a')], 'head'))), destination = target('g', 0, 1);
  for (const incoming of [payload(node('ordinary')), payload(node('ordinary'), loop('later-loop')), payload(),
    { startId: 'incoming-head', items: [loop('wrapper')] }, { startId: 'incoming-head', items: [] }]) {
    rejected(original, freeze(incoming), destination);
  }
});

test('wrap rejects missing, empty, reversed, fractional, out-of-bounds and non-numeric ranges', () => {
  const original = freeze(document(group('g', [node('a'), node('b'), node('c')]))), incoming = freeze(payload(loop('wrapper')));
  for (const [index, endIndex] of [[-1, 1], [0, 0], [1, 1], [2, 1], [0, 4], [3, 4], [.5, 2], [0, 1.5], [0, undefined], [0, null], [0, '2'], [0, NaN], [0, Infinity]]) {
    rejected(original, incoming, target('g', index, endIndex));
  }
});

test('wrap rejects absent groups, absent/non-loop parents, and a free-position target', () => {
  const original = freeze(document(group('g', [node('a'), loop('outer', [node('inner')])]))), incoming = freeze(payload(loop('wrapper')));
  for (const destination of [target('missing', 0, 1), target('g', 0, 1, 'missing'), target('g', 0, 1, 'a'),
    { mode: 'wrap', x: 400, y: 200, index: 0, endIndex: 1 }]) rejected(original, incoming, destination);
});

test('wrap rejects duplicate identities and connections to the dragged loop or its own descendants', () => {
  const original = freeze(document(group('g', [node('a'), loop('outer', [node('inside')])], 'head')));
  for (const incoming of [payload(loop('wrapper'), node('a')), payload(loop('wrapper'), node('duplicate'), node('duplicate')),
    payload(loop('g')), payload(loop('head'))]) rejected(original, freeze(incoming), target('g', 0, 1));
  const incoming = freeze(payload(loop('wrapper', [loop('dragged-child', [node('dragged-deep')])])));
  for (const parentUid of ['wrapper', 'dragged-child', 'dragged-deep']) rejected(original, incoming, target('g', 0, 1, parentUid));
});

test('cyclic payloads and cyclic source documents fail without recursion overflow or mutation', () => {
  const original = freeze(document(group('g', [node('a')]))), cyclic = loop('cyclic'); cyclic.children.push(cyclic);
  rejected(original, freeze(payload(cyclic)), target('g', 0, 1));
  const sourceCycle = loop('source-cycle'); sourceCycle.children.push(sourceCycle);
  const badDocument = freeze(document(group('g', [sourceCycle])));
  rejected(badDocument, freeze(payload(loop('wrapper'))), target('g', 0, 1));
});
