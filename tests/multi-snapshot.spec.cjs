'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const M = require('../canvas-workspace.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const item = (uid, children) => ({uid, id: children ? 'loop-count' : 'wait-time', params: children ? {count: 2} : {duration: 1}, ...(children ? {children} : {})});
const group = (id, items = [item(`${id}-node`)], startId = `${id}-head`) => ({id, startId, x: 120, y: -45, items});
const state = groups => ({schemaVersion: 2, kind: 'free-canvas', groups, selectedGroupId: groups[0]?.id || null, viewport: {x: -20, y: 55, scale: .8}});

// Execute the shipping functions and public CardEditor object in a VM. The
// fixture substitutes only their host integration, never the snapshot/lock logic.
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `production source markers: ${start}`);
  return source.slice(a, b);
}
function appFixture(documentState = state([group('g-b'), group('g-a')])) {
  let doc = documentState;
  const calls = [], elements = new Map();
  const controller = {
    getDocument: () => doc,
    setEditingLocked: locked => calls.push(['controller-lock', locked]),
    load(value) { doc = M.normalize(value); calls.push(['load']); },
    cancel() {calls.push(['cancel']);},
    findElement: uid => elements.get(uid) || null,
    getSelectedGroup: () => doc.groups.find(g => g.id === doc.selectedGroupId),
    select(id) {doc.selectedGroupId = id;}
  };
  const context = {
    CanvasWorkspace: M, canvasController: controller, window: {CardHome: {activeProjectId: 'project-id'}},
    CardModelSession: {current: {id: 'xiaobai'}, switching: false},
    cardById: {'wait-time': {}, 'loop-count': {kind: 'loop'}},
    executionLocked: false, activeParamEditor: {nodeUid: 'test'}, program: [],
    undoBtn: {}, redoBtn: {}, historySnapshots: ['old'], historyIndex: 0, HISTORY_LIMIT: 80,
    normalizeItem: value => value,
    cancelMatrixPaint: () => calls.push(['cancel-paint']),
    closeParamEditor: () => calls.push(['close-param']),
    syncCanvasProgram: () => calls.push(['sync']),
    renderPalette: () => calls.push(['palette']), renderProgram: () => calls.push(['render']),
    appElement: {classList: {toggle: (...args) => calls.push(['class', ...args])}},
    setStatus: text => calls.push(['status', text]),
    commitHistory: () => calls.push(['history']),
    document: {dispatchEvent() {}}, Event: class {constructor(type) {this.type = type;}}
  };
  context.window.window = context.window;
  vm.createContext(context);
  const code = [
    section('    function getRunSnapshot(', '    function getProgramSnapshot('),
    section('    function serializeWorkspaceState(', '    // Run data is detached'),
    section('    function undoProgram(', '    function saveProgram('),
    section('    function setActiveParamValue(', '    function refreshProgramAfterLoopParamChange('),
    section('    window.CardEditor = {', '    CardEditor.configure(')
  ].join('\n');
  vm.runInContext(code, context, {filename: 'app.js:shipping-snapshot-and-lock'});
  return {context, editor: context.window.CardEditor, calls, elements, get doc() {return doc;}, set doc(value) {doc = value;}};
}

test('all headed groups use immutable UID snapshots sorted by code-unit group identity', () => {
  const f = appFixture(state([group('g-z'), group('g-A', [item('loop-a', [item('inner-a')])]), group('g-a'), group('detached', [item('loose')], null)]));
  const snapshot = f.editor.getRunSnapshot();
  assert.deepEqual(copy(snapshot.launchOrder), ['g-A', 'g-a', 'g-z']);
  assert.equal(snapshot.modelId, 'xiaobai'); assert.equal(snapshot.projectId, 'project-id');
  assert.equal(snapshot.groups[0].items[0].children[0].uid, 'inner-a');
  assert.equal(snapshot.groups[0].items[0].params.count, 2);
  assert.equal('x' in snapshot.groups[0], false); assert.equal('viewport' in snapshot, false);
  for (const value of [snapshot, snapshot.groups, snapshot.launchOrder, snapshot.groups[0], snapshot.groups[0].items[0].params, snapshot.groups[0].items[0].children]) assert.equal(Object.isFrozen(value), true);
  f.doc.groups[1].items[0].children[0].params.duration = 7;
  f.doc.groups.reverse(); f.doc.groups[0].x = 999;
  assert.equal(snapshot.groups[0].items[0].children[0].params.duration, 1);
  assert.deepEqual(copy(f.editor.getRunSnapshot().launchOrder), ['g-A', 'g-a', 'g-z'], 'array reorder and coordinates never determine launch order');
});

test('manual head snapshots retain all listeners while selecting one initial group', () => {
  const f = appFixture();
  assert.deepEqual(copy(f.editor.getRunSnapshot({groupId: 'g-a'}).launchOrder), ['g-a']);
  assert.deepEqual(copy(f.editor.getRunSnapshot({all: false}).launchOrder), ['g-b']);
  f.context.window.CardHome = {};
  assert.equal(f.editor.getRunSnapshot().projectId, null, 'no project identity is guessed from storage');
  assert.throws(() => f.editor.getRunSnapshot({groupId: 'absent'}), /开始头/);
  f.doc = state([group('loose', [item('loose-node')], null)]);
  assert.throws(() => f.editor.getRunSnapshot(), /开始头/);
  assert.throws(() => f.editor.getRunSnapshot({groupId: 'loose'}), /开始头/);
});

test('preflight enforces the whole run budget and accepts empty script bodies', () => {
  const f = appFixture(state([group('empty', [])]));
  assert.equal(f.editor.getRunSnapshot().groups[0].items.length, 0);
  f.doc = state(Array.from({length: 5}, (_, i) => group(`g${i}`)));
  assert.throws(() => f.editor.getRunSnapshot(), /4/);
  const nodes = n => Array.from({length: n}, (_, i) => item(`n${i}`));
  f.doc = state([group('a', nodes(1000))]); assert.equal(f.editor.getRunSnapshot().groups[0].items.length, 1000);
  f.doc.groups.push(group('b')); assert.throws(() => f.editor.getRunSnapshot(), /1000/);
  let nested = item('leaf'); for (let i = 0; i < 20; i++) nested = item(`loop${i}`, [nested]);
  f.doc = state([group('a', [nested])]); assert.equal(f.editor.getRunSnapshot().groups.length, 1);
  f.doc.groups[0].items = [item('loop21', [nested])]; assert.throws(() => f.editor.getRunSnapshot(), /20/);
  f.doc = state([group('a'), group('b', [item('a-node')])]); assert.throws(() => f.editor.getRunSnapshot(), /标识/);
  const cyclic = item('cycle', []); cyclic.children.push(cyclic);
  f.doc = state([group('a', [cyclic])]); assert.throws(() => f.editor.getRunSnapshot(), /结构/);
});

test('locked public editor mutations are no-ops, close pending parameters, and preserve UID lookup', () => {
  const f = appFixture();
  const before = copy(f.doc); f.elements.set('g-a-node', {identity: 'visible-a'});
  assert.equal(f.editor.findBlockByUid('g-a-node').identity, 'visible-a');
  assert.equal(f.editor.findBlockByUid('missing'), null);
  assert.equal(f.editor.setExecutionLocked(true), true);
  assert.equal(f.editor.executionLocked, true);
  assert.equal(f.context.undoBtn.disabled, true); assert.equal(f.context.redoBtn.disabled, true);
  assert(f.calls.some(call => call[0] === 'close-param')); assert(f.calls.some(call => call[0] === 'cancel-paint'));
  const callCount = f.calls.length;
  assert.equal(f.editor.setWorkspace(state([group('replacement')])), false);
  f.editor.undo(); f.editor.redo(); f.context.setActiveParamValue('duration', 99);
  assert.equal(f.editor.configure({}), false, 'arbitrary public configure cannot replace a running document');
  assert.deepEqual(f.calls.slice(callCount), []); assert.deepEqual(copy(f.doc), before);
  f.editor.setExecutionLocked(false);
  assert.equal(f.editor.setWorkspace(state([group('replacement')])), true);
  assert.equal(f.doc.groups[0].id, 'replacement');
});

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener);},
    removeEventListener(type, listener) {listeners.set(type, (listeners.get(type) || []).filter(fn => fn !== listener));},
    emit(type, event) {for (const fn of listeners.get(type) || []) fn(event);}
  };
}
function controllerFixture() {
  class Element {
    constructor(tag = 'div') {Object.assign(this, events()); this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.style = {}; this.clientWidth = 800; this.clientHeight = 500; this.scrollLeft = 0;
      const names = new Set(); this.classList = {add: (...list) => list.forEach(v => names.add(v)), remove: (...list) => list.forEach(v => names.delete(v)), contains: v => names.has(v), toggle(v, force) {const on = force === undefined ? !names.has(v) : !!force; if (on) names.add(v); else names.delete(v); return on;}};
    }
    set className(value) {for (const cls of value.split(' ')) this.classList.add(cls);}
    append(...els) {for (const el of els) {el.parentElement = this; this.children.push(el);}}
    replaceChildren(...els) {this.children = []; this.append(...els);}
    remove() {if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(el => el !== this);}
    setAttribute(name, value) {this.attrs[name] = value;}
    removeAttribute(name) {delete this.attrs[name];}
    matches(selector) {return selector.split(',').some(raw => {const s = raw.trim(); if (s === 'button') return this.tagName === 'button'; if (s.startsWith('.')) return this.classList.contains(s.slice(1)); if (s === '[data-node-uid]') return !!this.dataset.nodeUid; if (s === '[data-group-handle]') return !!this.dataset.groupHandle; return false;});}
    closest(selector) {return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
    contains(el) {return this === el || this.children.some(child => child.contains(el));}
    getBoundingClientRect() {return {x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500};}
    setPointerCapture() {} hasPointerCapture() {return false;} releasePointerCapture() {}
  }
  const document = {...events(), createElement: tag => new Element(tag), body: new Element('body'), elementFromPoint: () => viewport};
  const area = new Element(), viewport = new Element(), chain = new Element(), palette = new Element(), library = new Element();
  area.append(viewport); viewport.append(chain);
  const changes = [], runs = [], parameters = [];
  const sandbox = {...events(), CanvasWorkspace: M, document, performance: {now: () => 0}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout,
    BlockLayout: {sequence(el) {for (const child of el.children) {child.dataset.advance = 76; child.dataset.connectorY = 36;} return {advance: el.children.length * 76, anchor: 36, height: 92};}}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../free-canvas.js'), 'utf8'), sandbox);
  const controller = sandbox.FreeCanvas.create({area, viewport, chain, palette, library,
    createNode() {const el = new Element(); el.className = 'program-block'; return el;}, createItem: id => ({id, uid: 'added', params: {duration: 1}}),
    onChange: (...args) => changes.push(args), onRun: id => runs.push(id), onParam: id => parameters.push(id)});
  const pointer = (target, x, y, id = 1, type = 'touch') => ({target, clientX: x, clientY: y, pointerId: id, pointerType: type, button: 0, preventDefault() {}, stopImmediatePropagation() {}});
  return {controller, document, viewport, palette, chain, pointer, changes, runs, parameters};
}

test('controller lock cancels extracted drag and blocks add/load/commit/delete while view remains movable', () => {
  const f = controllerFixture(), original = state([group('a'), group('b')]);
  f.controller.load(original);
  const node = f.controller.findElement('a-node');
  f.document.emit('pointerdown', f.pointer(node, 40, 80));
  f.document.emit('pointermove', f.pointer(node, 60, 80));
  assert.equal(f.controller.getGesture().active, true);
  assert.equal(f.controller.getDocument().groups[0].items.length, 0, 'an in-flight drag has extracted its suffix, leaving the head');
  f.controller.setEditingLocked(true);
  assert.equal(f.controller.getGesture(), null);
  assert.deepEqual(copy(f.controller.getDocument()), original, 'lock rolls back the uncommitted drag');
  assert.equal(f.controller.add('wait-time'), false);
  f.controller.load(state([group('replacement')]));
  let committed = false; f.controller.commitExternal(doc => {committed = true; doc.groups = [];});
  assert.equal(committed, false);
  f.document.emit('keydown', {key: 'Delete', target: f.viewport, preventDefault() {}});
  assert.deepEqual(copy(f.controller.getDocument()), original);
  const leaked = f.controller.getDocument(); leaked.groups.length = 0;
  assert.equal(f.controller.getDocument().groups.length, 2, 'locked document query cannot mutate the live graph');
  f.document.emit('pointerdown', f.pointer(f.viewport, 400, 300));
  f.document.emit('pointermove', f.pointer(f.viewport, 440, 330));
  f.controller.setEditingLocked(true);
  assert.equal(f.controller.getGesture().type, 'pan', 'idempotent lock refresh does not cancel a view gesture');
  f.document.emit('pointerup', f.pointer(f.viewport, 440, 330));
  assert.equal(f.controller.getDocument().viewport.x, original.viewport.x + 40);
  f.controller.resetZoom(); assert.equal(f.controller.getDocument().viewport.scale, 1);
  f.controller.load(state([group('model-restored')]), {force: true});
  assert.equal(f.controller.getDocument().groups[0].id, 'model-restored', 'internal model switch restoration remains available');
  f.controller.setEditingLocked(false);
  assert.notEqual(f.controller.add('wait-time'), false, 'editing recovers after unlocking');
});

test('locked block touch cannot drag or edit, and a second finger may still start centered pinch', () => {
  const f = controllerFixture(), original = state([group('a')]);
  f.controller.load(original); f.controller.setEditingLocked(true);
  const node = f.controller.findElement('a-node');
  f.document.emit('pointerdown', f.pointer(node, 200, 200));
  f.document.emit('pointermove', f.pointer(node, 250, 200));
  assert.equal(f.controller.getGesture().type, 'locked');
  assert.deepEqual(copy(f.controller.getDocument().groups), original.groups);
  f.document.emit('pointerdown', f.pointer(f.viewport, 450, 200, 2));
  assert.equal(f.controller.getGesture().type, 'pinch');
  f.document.emit('pointermove', f.pointer(f.viewport, 550, 200, 2));
  assert.equal(f.controller.getDocument().viewport.scale, 1.2, 'pinch starts with the two current positions and preserves its center anchor');
  f.document.emit('pointerup', f.pointer(node, 250, 200));
  f.document.emit('pointerup', f.pointer(f.viewport, 550, 200, 2));
  assert.deepEqual(copy(f.controller.getDocument().groups), original.groups);
  assert.equal(f.controller.getGesture(), null);
  assert.deepEqual(f.runs, []); assert.deepEqual(f.parameters, []);
});

test('holding blank canvas stays idle, then pans or pinches without selecting or moving program groups', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = controllerFixture(), original = state([group('a'), group('b')]);
  f.controller.load(original);
  f.document.emit('pointerdown', f.pointer(f.viewport, 400, 300));
  t.mock.timers.tick(1500);
  assert.equal(f.controller.getGesture().type, 'blank', 'a long hold never switches to selection');
  assert.deepEqual([...f.controller.getSelection()], ['a']);
  f.document.emit('pointermove', f.pointer(f.viewport, 460, 330));
  assert.equal(f.controller.getGesture().type, 'pan');
  f.document.emit('pointerup', f.pointer(f.viewport, 460, 330));
  assert.equal(f.controller.getGesture(), null);
  assert.equal(f.controller.getDocument().viewport.x, original.viewport.x + 60);
  assert.equal(f.controller.getDocument().viewport.y, original.viewport.y + 30);
  assert.deepEqual(copy(f.controller.getDocument().groups), original.groups);
  assert.deepEqual([...f.controller.getSelection()], ['a']);
  assert.deepEqual(f.changes.map(([, options]) => options.reason), ['viewport']);

  f.document.emit('pointerdown', f.pointer(f.viewport, 200, 200));
  t.mock.timers.tick(1500);
  f.document.emit('pointerdown', f.pointer(f.viewport, 400, 200, 2));
  assert.equal(f.controller.getGesture().type, 'pinch');
  f.document.emit('pointermove', f.pointer(f.viewport, 500, 200, 2));
  assert.ok(Math.abs(f.controller.getDocument().viewport.scale - original.viewport.scale * 1.5) < 1e-12);
  f.document.emit('pointercancel', f.pointer(f.viewport, 500, 200, 2));
  assert.equal(f.controller.getGesture(), null);
  assert.deepEqual(copy(f.controller.getDocument().groups), original.groups);
  assert.deepEqual(f.runs, []); assert.deepEqual(f.parameters, []);
});
