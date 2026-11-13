'use strict';
// Execute the shipping controller in a VM. Controlled promises exercise its
// session boundaries without a browser, hardware, transport, or wall-clock waits.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require.resolve('../xiaobai-ui.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function events() {
  const listeners = new Map();
  return {
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
    dispatchEvent(event) { this.emit(event.type, event); },
    emit(name, event = {}) { for (const handler of listeners.get(name) || []) handler(event); }
  };
}
function classList() {
  const names = new Set();
  return {
    add(name) { names.add(name); }, remove(name) { names.delete(name); },
    contains(name) { return names.has(name); },
    toggle(name, force) {
      const enabled = force === undefined ? !names.has(name) : Boolean(force);
      if (enabled) names.add(name); else names.delete(name);
      return enabled;
    }
  };
}

function setup({ model = false, closeGate = null, stopGate = null } = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      classList: classList(), setAttribute() {}, querySelector() { return this; }
    });
    return elements.get(id);
  }
  const groups = new Map([
    ['g1', { id: 'g1', startId: 'head1', items: [{ uid: 'g1-node', id: 'wait-time', params: { duration: 1 } }] }],
    ['g2', { id: 'g2', startId: 'head2', items: [{ uid: 'g2-node', id: 'wait-time', params: { duration: 2 } }] }],
    ['detached', { id: 'detached', startId: null, items: [{ uid: 'loose-node', id: 'wait-time', params: { duration: 3 } }] }]
  ]);
  const blocks = [...groups.values()].map(group => ({
    dataset: { groupId: group.id, nodePath: '0', nodeUid: group.items[0].uid }, classList: classList()
  }));
  const document = {
    ...events(), hidden: false, body: { classList: classList() }, getElementById: element,
    querySelectorAll(selector) {
      return selector.includes('.is-executing') ? blocks.filter(block => block.classList.contains('is-executing')) : blocks;
    }
  };
  const selections = [], highlights = [], validations = [], runners = [], notices = [], writes = [], focused = [];
  let selectedGroupId = 'g2', connected = true, epoch = 0;
  const signal = new AbortController();
  const connection = { id: 'connection-1', async stopProgram() { writes.push('connection-stop'); } };
  const remote = { async close() { writes.push('remote-close'); if (closeGate) await closeGate.promise; } };
  function validate(items) { validations.push(copy(items)); return copy(items); }
  class Runner {
    constructor(link, options) {
      this.connection = link; this.options = options; this.done = deferred(); this.stopCalls = 0;
      runners.push(this);
    }
    run(snapshot) {
      this.snapshot = snapshot;
      writes.push({ run: copy(snapshot), connectionId: this.connection.id });
      return this.done.promise;
    }
    async stop() {
      this.stopCalls += 1;
      writes.push('runner-stop');
      if (stopGate) await stopGate.promise;
      this.done.resolve({ state: 'stopped' });
    }
    step(path = '0') { this.options.onStep(this.snapshot[0], path); }
    finish() { this.done.resolve({ state: 'completed' }); }
  }
  const editor = {
    getExecutionGroup(groupId) {
      selections.push(groupId);
      const group = groups.get(groupId || selectedGroupId);
      if (!group) throw new Error('找不到要运行的卡片组。');
      if (!group.startId) throw new Error('这组没有开始卡，请连接开始卡后再运行。');
      return { groupId: group.id, items: copy(group.items) };
    },
    findBlock(path, groupId) {
      const key = Array.isArray(path) ? path.join('.') : String(path);
      highlights.push({ path: key, groupId });
      return blocks.find(block => block.dataset.groupId === groupId && block.dataset.nodePath === key) || null;
    }
  };
  const window = {
    ...events(), CardEditor: editor, CardRemote: remote,
    showExecutionNotice(message) { notices.push(message); },
    CardCanvas: { focusNode(uid) { focused.push(uid); } },
    CardBluetooth: {
      get connected() { return connected; },
      remoteConnection() { return connected ? connection : null; }
    }
  };
  if (model) {
    const device = { id: 'xiaobai', name: '小白', execution: { kind: 'stream', validate }, remote };
    window.CardHome = { activeModelId: device.id };
    window.CardModelSession = {
      current: device, selected: true, switching: false,
      capture() {
        const capturedEpoch = epoch;
        return { model: device, signal: signal.signal, isCurrent: () => epoch === capturedEpoch && !window.CardModelSession.switching };
      }
    };
  }
  const context = {
    window, document, location: { hash: '#editor' },
    Event: class { constructor(type) { this.type = type; } },
    XiaobaiRunner: { validate, Runner },
    DeviceModels: { createExecution(spec, options) { return new Runner(options.connection, options); } },
    // This fallback intentionally differs from both canvas groups.
    program: [{ uid: 'fallback', id: 'motor-stop', params: { port: 'E' } }],
    cardById: { 'wait-time': { label: '等待' } }
  };
  vm.runInNewContext(source, context, { filename: 'xiaobai-ui.js' });
  return {
    window, document, location: context.location, connection, groups, blocks, selections,
    highlights, validations, runners, notices, writes, focused, element,
    block(groupId) { return blocks.find(block => block.dataset.groupId === groupId); },
    select(groupId) { selectedGroupId = groupId; },
    disconnect() { connected = false; window.emit('xiaobai-disconnected'); },
    invalidateModel() { epoch += 1; window.CardModelSession.switching = true; signal.abort(); }
  };
}

function assertStopped(fixture) {
  assert.equal(fixture.window.CardProgram.running, false);
  assert.equal(fixture.element('runProgramBtn').disabled, false);
  assert.equal(fixture.element('runProgramBtn').classList.contains('is-running'), false);
  assert.equal(fixture.element('pauseProgramBtn').classList.contains('is-program-active'), false);
  assert.equal(fixture.blocks.some(block => block.classList.contains('is-executing')), false);
}

test('runGroup chooses the requested canvas group, validates its snapshot, and scopes the same path to that group', async () => {
  const f = setup();
  const task = f.window.CardProgram.runGroup('g1');
  await flush();
  assert.deepEqual(f.selections, ['g1']);
  assert.deepEqual(f.validations, [f.groups.get('g1').items]);
  assert.equal(f.runners.length, 1);
  assert.deepEqual(f.runners[0].snapshot, f.groups.get('g1').items);
  assert.equal(f.runners[0].connection, f.connection);
  f.block('g2').classList.add('is-executing');
  f.runners[0].step('0');
  assert.equal(f.block('g1').classList.contains('is-executing'), true);
  assert.equal(f.block('g2').classList.contains('is-executing'), false);
  assert.deepEqual(f.highlights.at(-1), { path: '0', groupId: 'g1' });
  f.runners[0].finish();
  await task;
  assertStopped(f);
});

test('starting, active and stopping reject a second group without creating a runner or replacing the execution scope', async () => {
  const closeGate = deferred(), stopGate = deferred();
  const f = setup({ closeGate, stopGate });
  const task = f.window.CardProgram.runGroup('g1');
  assert.equal(f.window.CardProgram.running, true, 'remote close keeps the first run in starting');
  assert.equal(f.runners.length, 0);
  await f.window.CardProgram.runGroup('g2');
  assert.deepEqual(f.selections, ['g1']);
  assert.equal(f.runners.length, 0);
  closeGate.resolve();
  await flush();
  assert.equal(f.runners.length, 1);
  await f.window.CardProgram.runGroup('g2');
  assert.equal(f.runners.length, 1, 'active run owns the single execution session');
  f.select('g2');
  f.runners[0].step('0');
  assert.deepEqual(f.highlights.at(-1), { path: '0', groupId: 'g1' }, 'changing UI selection cannot retarget an active run');
  assert.equal(f.block('g2').classList.contains('is-executing'), false);
  const stopping = f.window.CardProgram.stop();
  assert.equal(f.window.CardProgram.running, true, 'slow cleanup keeps execution locked');
  assert.equal(f.element('runProgramBtn').disabled, true);
  await f.window.CardProgram.runGroup('g2');
  assert.deepEqual(f.selections, ['g1'], 'all three rejected requests return before selecting another group');
  assert.equal(f.validations.length, 1);
  assert.equal(f.runners.length, 1);
  assert.equal(f.runners[0].stopCalls, 1);
  f.runners[0].step('0');
  assert.equal(f.blocks.some(block => block.classList.contains('is-executing')), false, 'late steps during stopping are ignored');
  stopGate.resolve();
  await Promise.all([task, stopping]);
  assertStopped(f);
  const next = f.window.CardProgram.runGroup('g2');
  await flush();
  assert.equal(f.runners.length, 2, 'a new group can run after cleanup completes');
  assert.deepEqual(f.selections, ['g1', 'g2']);
  f.runners[1].step('0');
  assert.equal(f.block('g2').classList.contains('is-executing'), true);
  assert.equal(f.block('g1').classList.contains('is-executing'), false);
  f.runners[1].finish();
  await next;
  assertStopped(f);
});

test('a detached group without a start throws at group selection and sends nothing', async () => {
  const f = setup();
  await f.window.CardProgram.runGroup('detached');
  assert.deepEqual(f.selections, ['detached']);
  assert.equal(f.validations.length, 0);
  assert.equal(f.runners.length, 0);
  assert.deepEqual(f.writes, [], 'no remote close, runner, or device write after the start-head guard throws');
  assert.match(f.notices.at(-1), /没有开始卡/);
  assertStopped(f);
});

test('the toolbar uses the selected group and does not use the legacy program fallback', async () => {
  const f = setup();
  const task = f.element('runProgramBtn').onclick({ type: 'click' });
  await flush();
  assert.deepEqual(f.selections, [null]);
  assert.deepEqual(f.runners[0].snapshot, f.groups.get('g2').items);
  f.runners[0].step('0');
  assert.equal(f.block('g2').classList.contains('is-executing'), true);
  assert.equal(f.block('g1').classList.contains('is-executing'), false);
  await f.window.CardProgram.stop();
  await task;
  assertStopped(f);
});

test('run errors locate and focus the failing node inside the active group only', async () => {
  const f = setup();
  const task = f.window.CardProgram.runGroup('g1');
  await flush();
  const error = new Error('测试运行错误');
  error.path = '0';
  f.runners[0].done.reject(error);
  await task;
  assert.equal(f.window.CardProgram.running, false);
  assert.equal(f.block('g1').classList.contains('is-executing'), true);
  assert.equal(f.block('g2').classList.contains('is-executing'), false);
  assert.deepEqual(f.focused, ['g1-node']);
  assert.ok(f.highlights.every(call => call.groupId === 'g1'));
  assert.equal(f.notices.at(-1), error.message);
  await f.window.CardProgram.stop();
  assertStopped(f);
});

test('the stop button stops the active group and discards late steps before another group can run', async () => {
  const f = setup();
  const task = f.window.CardProgram.runGroup('g1');
  await flush();
  f.runners[0].step('0');
  await f.element('pauseProgramBtn').onclick();
  await task;
  assert.equal(f.runners[0].stopCalls, 1);
  assert.equal(f.writes.filter(write => write === 'runner-stop').length, 1);
  f.runners[0].step('0');
  assertStopped(f);
});

test('disconnect cancels the active group and stale callbacks cannot highlight either group', async () => {
  const f = setup();
  const task = f.window.CardProgram.runGroup('g1');
  await flush();
  f.runners[0].step('0');
  f.disconnect();
  await task;
  await flush();
  assert.equal(f.runners[0].stopCalls, 1);
  assert.equal(f.runners[0].options.isCurrent(), false, 'the runner sees its connection identity expire');
  f.runners[0].step('0');
  assertStopped(f);
  assert.ok(f.notices.includes('连接断开，程序已取消'));
});

test('switching model cancels a pending start before constructing an execution', async () => {
  const closeGate = deferred();
  const f = setup({ model: true, closeGate });
  const task = f.window.CardProgram.runGroup('g1');
  assert.equal(f.window.CardProgram.running, true);
  f.invalidateModel();
  // CardModelSession.select quiesces the controller via CardProgram.stop.
  await f.window.CardProgram.stop();
  closeGate.resolve();
  await task;
  assert.equal(f.runners.length, 0);
  assert.equal(f.writes.some(write => typeof write === 'object' && write.run), false);
  assert.equal(f.notices.some(message => message.includes('执行完成')), false);
  assert.equal(f.window.CardProgram.running, false);
  assert.equal(f.blocks.some(block => block.classList.contains('is-executing')), false);
});

test('model scope invalidation ignores old steps and progress and blocks new runs while switching', async () => {
  const f = setup({ model: true });
  const task = f.window.CardProgram.runGroup('g1');
  await flush();
  assert.equal(f.runners.length, 1);
  const execution = f.runners[0];
  execution.step('0');
  f.invalidateModel();
  assert.equal(execution.options.signal.aborted, true);
  assert.equal(execution.options.isCurrent(), false);
  await f.window.CardProgram.stop();
  await task;
  const previousNotices = [...f.notices];
  execution.step('0');
  execution.options.onProgress('旧型号迟到消息');
  await f.window.CardProgram.runGroup('g2');
  assert.deepEqual(f.selections, ['g1']);
  assert.equal(f.runners.length, 1);
  assert.deepEqual(f.notices, previousNotices);
  assert.equal(f.blocks.some(block => block.classList.contains('is-executing')), false);
  assert.equal(f.window.CardProgram.running, false);
  assert.equal(f.element('runProgramBtn').disabled, true, 'model switching still locks the run control');
});
