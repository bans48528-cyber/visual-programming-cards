/* Deterministic transport/session regressions. No browser, BLE or hardware. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

class Clock {
  now = 10000;
  next = 1;
  jobs = new Map();
  set(fn, delay = 0, repeat = 0) {
    const id = this.next++;
    this.jobs.set(id, {at: this.now + Math.max(0, delay), fn, repeat});
    return id;
  }
  clear(id) { this.jobs.delete(id); }
  async flush() { for (let i = 0; i < 32; i++) await Promise.resolve(); }
  async advance(ms) {
    const target = this.now + ms;
    await this.flush();
    for (let steps = 0; ; steps++) {
      assert(steps < 20000, 'timer loop is bounded');
      const next = [...this.jobs].filter(([, job]) => job.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, job] = next;
      this.jobs.delete(id);
      this.now = job.at;
      if (job.repeat) this.jobs.set(id, {...job, at: this.now + job.repeat});
      job.fn();
      await this.flush();
    }
    this.now = target;
    await this.flush();
  }
  async until(predicate, limit = 20000) {
    const end = this.now + limit;
    await this.flush();
    while (!predicate() && this.now < end) await this.advance(Math.min(10, end - this.now));
    assert(predicate(), 'condition reached before virtual deadline');
  }
  async settle(promise, limit) {
    const result = observe(promise);
    await this.until(() => result.done, limit);
    if (result.error) throw result.error;
    return result.value;
  }
}

function observe(promise) {
  const result = {done: false};
  promise.then(value => Object.assign(result, {done: true, value}),
    error => Object.assign(result, {done: true, error}));
  return result;
}

function modules(clock) {
  const loaded = {};
  for (const name of ['xiaobai-protocol.js', 'xiaobai-learned-commands.js']) {
    const module = {exports: {}};
    const context = {
      module, console,
      require: key => loaded[key.replace('./', '')],
      Date: class extends Date { static now() { return clock.now; } },
      setTimeout: (fn, ms) => clock.set(fn, ms), clearTimeout: id => clock.clear(id),
      setInterval: (fn, ms) => clock.set(fn, ms, ms), clearInterval: id => clock.clear(id),
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context, {filename: name});
    loaded[name] = module.exports;
  }
  return {p: loaded['xiaobai-protocol.js'], Session: loaded['xiaobai-learned-commands.js'].Session};
}

function inbound(p, type, data) {
  const bytes = p.frame(type, data);
  bytes[1] = 0x98; bytes[2] = 0x97;
  bytes[15] = bytes.slice(0, 15).reduce((sum, byte) => sum + byte, 0) & 255;
  return bytes;
}

async function fixture(options = {}) {
  const clock = new Clock(), {p, Session} = modules(clock);
  const writes = [], values = new Map();
  let receive, eventCounter = 0, waitCount = 0;
  const h = {clock, p, writes, options, waitCount: () => waitCount, holdNext: false};
  const reply = (packet, data, result = 0) => receive(inbound(p, 0xd2, [packet[5], packet[6], result, ...data]));
  h.event = (id, slot, stage, state = 1, reason = 0) => receive(inbound(p, 0xd3,
    [8, ++eventCounter, id & 255, id >>> 8 & 255, id >>> 16 & 255, id >>> 24, slot, stage, state, reason]));
  h.hit = (id, slot = 1) => receive(inbound(p, 0xd3,
    [9, ++eventCounter, id & 255, id >>> 8 & 255, id >>> 16 & 255, id >>> 24, slot, 0, 0, 0]));
  h.mode = mode => receive(inbound(p, 0xd3, [1, ++eventCounter, mode, 4, 0, 0, 0, 0, 0, 0]));
  const transport = {
    start: async fn => { receive = fn; }, close() {},
    async write(bytes) {
      const packet = Array.from(bytes), op = packet[6], args = packet.slice(7, 15);
      const item = {packet, at: clock.now}; writes.push(item);
      if (h.holdNext) {
        h.holdNext = false;
        await new Promise(resolve => { h.releaseWrite = resolve; });
      }
      item.finished = clock.now;
      if (op === p.OP.QUERY_STATUS) reply(packet, [4, 0, 0, 0, 0, 0, 0]);
      else if (op === p.OP.READ_UID) reply(packet, [args[0], 1, 2, 3, 4, 5, 6]);
      else if (op === p.OP.QUERY_LEARNED) reply(packet, [...args.slice(0, 4), 1, 0, 15]);
      else if (op === p.OP.DECLARE_RUN) reply(packet, [...args.slice(0, 5), 0, 0]);
      else if (op === p.OP.WAIT_LEARNED) {
        waitCount++;
        const id = args[0] + args[1] * 256 + args[2] * 65536 + args[3] * 16777216;
        const ready = () => h.event(id, args[4], 11);
        if (options.readyOn === waitCount && waitCount > 1) ready(); // MCU replay sends D3 before D2.
        if (!options.silentAck) {
          if (options.ackDelay && waitCount === 1) clock.set(() => reply(packet, [...args.slice(0, 5), 1, 0]), options.ackDelay);
          else reply(packet, [...args.slice(0, 5), 1, 0]);
        }
        if (options.readyOn === waitCount && waitCount === 1) ready();
      }
    },
  };
  const link = new p.Link(transport, {minWriteMs: 0}); // C2 floor must survive an old caller's override.
  const storage = {getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value))};
  const session = new Session(link, {storage, settleMs: 0});
  Object.assign(h, {link, session, values});
  await clock.settle(link.start());
  await clock.settle(link.enterProgram());
  await clock.settle(session.prepareRun([{id: 'self-learned-wait', params: {slot: 1}}]));
  await clock.settle(session.beginRun());
  h.close = () => { link.close(); session.dispose(); };
  h.waits = () => writes.filter(item => item.packet[6] === p.OP.WAIT_LEARNED);
  h.start = async () => {
    const result = observe(session.wait(1));
    await clock.until(() => h.waits().length > 0);
    return {result, task: session.waiting};
  };
  return h;
}

test('all C2 frames honor 40 ms after completed writes and raw notification fragments', async () => {
  const clock = new Clock(), {p} = modules(clock), writes = [];
  let rx;
  const link = new p.Link({start: async fn => { rx = fn; }, close() {}, async write(bytes) {
    const item = {at: clock.now, op: bytes[6]}; writes.push(item);
    await new Promise(resolve => clock.set(resolve, 125)); item.end = clock.now;
  }}, {minWriteMs: 0});
  await clock.settle(link.start());
  let previousEnd = 0;
  for (const op of [p.OP.HEARTBEAT, p.OP.QUERY_STATUS, p.OP.LEARN_COMMAND, p.OP.WAIT_LEARNED, p.OP.SHOW_MATRIX, p.OP.STOP_PROGRAM]) {
    const notified = clock.now;
    rx(Uint8Array.of(0x5a)); // Not enough for a complete frame, still an RX turn.
    const startCount = writes.length;
    const sending = link.send(p.command(1, op));
    await clock.advance(39); assert.equal(writes.length, startCount);
    await clock.settle(sending);
    const current = writes.at(-1);
    assert(current.at - notified >= 40, `RX guard for ${op}`);
    if (previousEnd) assert(current.at - previousEnd >= 40, `TX guard for ${op}`);
    previousEnd = current.end;
  }
  link.close();
});

test('failed write also keeps 40 ms before the queued safety STOP', async () => {
  const clock = new Clock(), {p} = modules(clock), writes = [];
  let failAt;
  const link = new p.Link({start: async () => {}, close() {}, async write(bytes) {
    writes.push({at: clock.now, op: bytes[6]});
    if (writes.length === 1) {
      await new Promise(resolve => clock.set(resolve, 125)); failAt = clock.now;
      throw new Error('GATT response lost after possible transmit');
    }
  }});
  const failed = observe(link.send(p.command(1, p.OP.WAIT_LEARNED)));
  await clock.until(() => failed.done); assert(failed.error);
  await clock.settle(link.send(p.command(0, p.OP.STOP_PROGRAM)));
  assert(writes[1].at - failAt >= 40); link.close();
});

test('lost stage11 recovers from identical request replay; one hit completes only once', async () => {
  const h = await fixture({readyOn: 2});
  try {
    const {result, task} = await h.start();
    const firstDeadline = h.clock.jobs.get(task.timer).at;
    assert.equal(task.ready, false, 'D2 acceptance does not invent readiness');
    h.hit(task.task); await h.clock.flush(); assert.equal(result.done, false);
    await h.clock.until(() => task.ready, 2000);
    assert.equal(h.waits().length, 2);
    assert.deepEqual(h.waits()[1].packet, h.waits()[0].packet, 'seq, task, slot and full frame remain identical');
    assert.equal(h.values.get(`xiaobai:${h.session.uid}:counter:task`), '1');
    assert(h.waits()[1].at < firstDeadline);
    const deadline = h.clock.jobs.get(task.timer).at;
    h.event(task.task, 1, 11); assert.equal(h.clock.jobs.get(task.timer).at, deadline, 'duplicate ready cannot extend recognition');
    h.hit(task.task); h.hit(task.task); await h.clock.flush();
    assert.equal(result.done, true); assert.equal(result.error, undefined); assert.equal(h.session.waiting, null);
    await h.clock.advance(2500); assert.equal(h.waits().length, 2, 'no queued retry after hit');
    const next = observe(h.session.wait(1)); const task2 = h.session.waiting;
    assert(task2.task > task.task);
    h.event(task2.task, 1, 11); h.hit(task.task); await h.clock.flush(); assert.equal(next.done, false);
    h.hit(task2.task); await h.clock.flush(); assert.equal(next.done, true);
  } finally { h.close(); }
});

test('timely real stage11 sends no recovery request', async () => {
  const h = await fixture({readyOn: 1});
  try {
    const {task, result} = await h.start();
    assert(task.ready); await h.clock.advance(3000); assert.equal(h.waits().length, 1);
    h.hit(task.task); await h.clock.flush(); assert(result.done && !result.error);
  } finally { h.close(); }
});

test('two retries neither exceed their limit nor extend the original prepare deadline', async () => {
  const h = await fixture();
  try {
    const {task, result} = await h.start();
    const deadline = h.clock.jobs.get(task.timer).at;
    await h.clock.advance(3500);
    assert.equal(h.waits().length, 3, 'one initial request plus at most two replays');
    assert.equal(h.clock.jobs.get(task.timer).at, deadline);
    assert.equal(task.ready, false);
    await h.clock.advance(deadline - h.clock.now - 1); assert.equal(result.done, false);
    await h.clock.advance(1); assert(result.done); assert.equal(result.error.code, 'TIMEOUT');
    await h.clock.advance(3000); assert.equal(h.waits().length, 3);
    assert(h.writes.some(item => item.packet[6] === h.p.OP.STOP_PROGRAM));
  } finally { h.close(); }
});

for (const ending of ['stop', 'mode', 'disconnect']) {
  test(`${ending} clears recovery; no late WAIT_LEARNED can leave the queue`, async () => {
    const h = await fixture();
    try {
      const {result} = await h.start();
      // Hold a preceding write open until the retry timer has queued its frame.
      h.holdNext = true;
      const held = h.link.send(h.p.command(77, h.p.OP.SHOW_OFF));
      await h.clock.until(() => Boolean(h.releaseWrite));
      await h.clock.advance(1100);
      assert.equal(h.session.waiting.readyRetries, 1);
      let stopped;
      if (ending === 'stop') stopped = h.link.stopProgram();
      else if (ending === 'mode') h.mode(0);
      else h.link.close();
      h.releaseWrite(); await h.clock.settle(held);
      if (stopped) await h.clock.settle(stopped);
      await h.clock.advance(3000);
      assert.equal(h.waits().length, 1, 'guard drops an already queued retry after cancellation');
      assert(result.done && result.error);
    } finally { h.close(); }
  });
}

test('real stage11 arriving while retry is queued suppresses that retry', async () => {
  const h = await fixture();
  try {
    const {task} = await h.start();
    h.holdNext = true;
    const held = h.link.send(h.p.command(77, h.p.OP.SHOW_OFF));
    await h.clock.until(() => Boolean(h.releaseWrite)); await h.clock.advance(1100);
    h.event(task.task, 1, 11); h.releaseWrite(); await h.clock.settle(held);
    await h.clock.advance(2500); assert(task.ready); assert.equal(h.waits().length, 1);
  } finally { h.close(); }
});

test('late acceptance does not postpone prepare timeout and heartbeat remains alive', async () => {
  const h = await fixture({ackDelay: 7900});
  try {
    const {task, result} = await h.start();
    const deadline = h.clock.jobs.get(task.timer).at, start = h.clock.now;
    await h.clock.advance(deadline - h.clock.now);
    assert(result.done && result.error.code === 'TIMEOUT');
    assert(h.waits().length >= 2 && h.waits().length <= 3);
    const beats = h.writes.filter(item => item.packet[6] === h.p.OP.HEARTBEAT && item.at >= start);
    assert(beats.length >= 25, 'heartbeat continues during real ASR preparation');
    for (let i = 1; i < beats.length; i++) assert(beats[i].at - beats[i - 1].at < 1000);
  } finally { h.close(); }
});

test('without D2 acceptance there is no speculative recovery', async () => {
  const h = await fixture({silentAck: true});
  try {
    const {result} = await h.start();
    await h.clock.advance(11000);
    assert(result.done && result.error.code === 'TIMEOUT'); assert.equal(h.waits().length, 1);
  } finally { h.close(); }
});
