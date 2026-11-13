const assert = require('node:assert/strict');
const DeviceModels = require('../device-models.js');
const CanvasWorkspace = require('../canvas-workspace.js');
const memory = () => {
  const data = new Map();
  return {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key)};
};
const copy = value => JSON.parse(JSON.stringify(value));
function allModelCardChecks() {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const context = {DeviceModels, Receiver2226Protocol: {notice: 'test-only'}};
  context.window = context; vm.createContext(context);
  for (const filename of ['xiaobai-model.js', 'spark-ai-model.js', 'lbs2206-model.js', 'tc01-model.js', 'receiver2226-model.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), context, {filename});
  }
  const storage = memory(), counts = [];
  for (const model of context.CardModels.list()) {
    const cards = Object.values(model.catalog).flatMap(category => category.cards);
    const item = (card, uid) => ({uid, id: card.id, params: Object.fromEntries(Object.entries(card.paramsSchema || {}).map(([name, schema]) => [name, copy(schema.default ?? null)])), ...(card.kind === 'loop' ? {children: []} : {})});
    const ordinary = cards.find(card => card.kind !== 'loop');
    const items = cards.map((card, index) => {
      const result = item(card, `${model.id}-${index}`);
      if (card.kind === 'loop') result.children.push(item(ordinary, `${model.id}-${index}-child`));
      return result;
    });
    const state = {...documentState(), groups: [{id: 'all-types', x: -150.25, y: 84.5, startId: `${model.id}-start`, items}], selectedGroupId: 'all-types'};
    const project = {id: `${model.id}-fixture`, modelId: model.id, name: '全部卡片类型', state};
    const store = DeviceModels.createStore(storage, model.id); store.write([project]); store.setActive(project.id);
    assert.deepEqual(store.read(), [project], `every ${model.id} card and its native defaults round trip`);
    assert.equal(store.getActive(), project.id);
    counts.push(`${model.id}:${items.length}`);
  }
  console.log(`PASS free-canvas all model cards: ${counts.join(', ')}.`);
}
const documentState = () => ({
  schemaVersion: 2, kind: 'free-canvas',
  groups: [
    {id: 'started', x: -190.5, y: 35, startId: 'start-a', items: [
      {uid: 'motor-a', id: 'motor-forward', params: {port: 'R/M2', duration: 2.5}},
      {uid: 'repeat-a', id: 'loop-count', params: {count: 3}, children: [
        {uid: 'wait-a', id: 'wait-time', params: {duration: 0.2}},
        {uid: 'repeat-b', id: 'loop', params: {}, children: [{uid: 'stop-a', id: 'combo-stop', params: {}}]}
      ]}
    ]},
    {id: 'detached', x: 730, y: -80, startId: null, items: [
      {uid: 'matrix-a', id: 'eye-pattern', params: {left: Array.from({length: 64}, (_, i) => i % 3 === 0 ? 1 : 0), right: Array(64).fill(0)}},
      {uid: 'speech-a', id: 'speech-play', params: {text: '开始行动', enabled: true, gain: 0, channel: null}}
    ]},
    {id: 'start-only', x: 280, y: 470, startId: 'start-b', items: []}
  ],
  viewport: {x: -137.5, y: 258, scale: 0.75}, selectedGroupId: 'detached'
});

function storageChecks() {
  const storage = memory(), modelId = 'xiaobai', store = DeviceModels.createStore(storage, modelId);
  const legacyRows = [
    {id: 'legacy-a', modelId, name: '旧版作品', updated: 1, state: {program: [{uid: 'legacy-motor', id: 'motor-forward', params: {port: 'L/M1', duration: 1}}], stagedGroups: []}},
    {id: 'legacy-blank', modelId, name: '旧版空草稿', updated: 2, draft: true, state: {program: [], stagedGroups: []}},
    {id: 'legacy-array', modelId, name: '更早版本', updated: 3, state: [{id: 'wait-time', params: {duration: 8}}]}
  ];
  const oldV2 = {id: 'old-v2', modelId, name: '移除暂存前的作品', updated: 4, state: {
    schemaVersion: 2, kind: 'free-canvas', groups: [], viewport: {x: -22, y: 80, scale: 0.8}, selectedGroupId: null,
    stagedGroups: [
      {id: 'old-group', startId: 'old-start', items: [{uid: 'old-loop', id: 'loop-count', params: {count: 4}, children: [{uid: 'old-wait', id: 'wait-time', params: {duration: 3.25}}]}]},
      {id: 'old-head-group', startId: 'old-head', items: []}
    ]
  }};
  storage.setItem(DeviceModels.key(modelId, 'projects'), JSON.stringify([...legacyRows, oldV2]));
  const originalStored = storage.getItem(DeviceModels.key(modelId, 'projects'));
  const fixture = documentState(), project = {id: 'v2-document', modelId, name: '自由画布', updated: 100, state: fixture};
  assert.equal(Object.hasOwn(fixture, 'stagedGroups'), false, 'new documents contain only canvas groups');
  assert.deepEqual(store.read(), [...legacyRows, oldV2]);
  assert.equal(storage.getItem(DeviceModels.key(modelId, 'projects')), originalStored, 'reading never rewrites old data');
  store.write([...store.read(), project]);
  const restored = store.read();
  assert.deepEqual(restored.find(row => row.id === project.id), project, 'groups, positions, start identities, nested items, typed parameters, viewport and selection round trip');
  assert.deepEqual(restored.filter(row => row.id.startsWith('legacy')), legacyRows, 'saving v2 leaves legacy rows unchanged, including blank drafts');
  assert.deepEqual(restored.find(row => row.id === oldV2.id), oldV2, 'an untouched pre-removal v2 row stays in its original form');
  assert.equal(DeviceModels.blank(oldV2.state), false, 'content held only in the removed field cannot be filtered as empty');
  const originalOldV2 = copy(oldV2.state), recovered = CanvasWorkspace.normalize(oldV2.state);
  assert.equal(Object.hasOwn(recovered, 'stagedGroups'), false);
  assert.equal(recovered.groups.length, 2, 'old stored groups recover directly onto the canvas');
  assert.deepEqual(recovered.groups.map(group => group.id), ['old-group', 'old-head-group']);
  assert.deepEqual(recovered.groups.map(group => group.startId), ['old-start', 'old-head']);
  assert.deepEqual(recovered.groups[0].items, oldV2.state.stagedGroups[0].items, 'nested identities and parameters survive recovery');
  assert.deepEqual(recovered.viewport, oldV2.state.viewport);
  assert.deepEqual(oldV2.state, originalOldV2, 'normalizing a preview does not mutate its stored source');
  assert.equal(DeviceModels.blank(recovered), false);
  assert.deepEqual(CanvasWorkspace.normalize(recovered), recovered, 'reopening recovery does not create duplicate groups');
  const cloned = copy(fixture); cloned.groups[0].items[0].params.duration = 99;
  assert.equal(store.read().find(row => row.id === project.id).state.groups[0].items[0].params.duration, 2.5);
  const empty = {...copy(fixture), groups: [], selectedGroupId: null};
  const startOnly = {...copy(empty), groups: [{id: 'only-head', x: 12, y: 24, startId: 'only-start', items: []}]};
  const detached = {...copy(empty), groups: [{id: 'only-detached', x: 1, y: 2, startId: null, items: [{uid: 'only-item', id: 'combo-stop', params: {}}]}]};
  const noContent = {...copy(empty), groups: [{id: 'empty-group', x: 0, y: 0, startId: null, items: []}]};
  assert.equal(DeviceModels.blank(empty), true); assert.equal(DeviceModels.blank(noContent), true);
  for (const state of [startOnly, detached]) assert.equal(DeviceModels.blank(state), false);
  store.write([...restored, ...[empty, startOnly, detached].map((state, index) => ({id: `shape-${index}`, modelId, name: `形态${index}`, state}))]);
  assert.equal(store.read().some(row => row.id === 'shape-0'), false, 'a new empty v2 document is omitted');
  assert.deepEqual(store.read().filter(row => row.id.startsWith('shape-')).map(row => row.id), ['shape-1', 'shape-2']);
  assert.deepEqual(store.read().filter(row => row.id.startsWith('legacy')), legacyRows);
  assert.deepEqual(store.read().find(row => row.id === oldV2.id), oldV2);
  // Opening and saving replaces only that v2 row with its recovered canvas document.
  store.write(store.read().map(row => row.id === oldV2.id ? {...row, state: recovered} : row));
  assert.deepEqual(store.read().find(row => row.id === oldV2.id).state, recovered);
  assert.equal(Object.hasOwn(store.read().find(row => row.id === oldV2.id).state, 'stagedGroups'), false);
  assert.deepEqual(store.read().filter(row => row.id.startsWith('legacy')), legacyRows);
  store.setActive(project.id); assert.equal(store.getActive(), project.id);
  const other = DeviceModels.createStore(storage, 'tc01');
  assert.deepEqual(other.read(), []); assert.equal(other.getActive(), null);
  assert.throws(() => other.write([project]), /其他设备型号/);
  other.write([{...copy(project), id: 'tc01-copy', modelId: 'tc01'}]); other.setActive('tc01-copy');
  assert.equal(store.getActive(), project.id); assert.equal(store.read().find(row => row.id === project.id).modelId, modelId);
  // Explicit deletion remains available; retention never resurrects a removed legacy row.
  store.write(store.read().filter(row => row.id !== 'legacy-blank'));
  assert.equal(store.read().some(row => row.id === 'legacy-blank'), false);
  console.log('PASS free-canvas storage: canvas-only round trip, start-only/detached content, old-field recovery without deletion, legacy retention and model isolation.');
}

async function browserChecks() {
  const {chromium} = require('playwright');
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const base = process.env.CARD_TEST_URL || 'http://127.0.0.1:4173/';
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 844}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (localStorage.getItem('free-canvas-storage-seeded')) return;
      localStorage.setItem('free-canvas-storage-seeded', '1');
      localStorage.setItem('cardDefaultModelV1', 'xiaobai');
      localStorage.setItem('cardModel:xiaobai:projects:v1', JSON.stringify([
        {id: 'legacy-browser', modelId: 'xiaobai', name: '旧版浏览作品', updated: 1, needsName: false, state: {program: [{uid: 'old-a', id: 'wait-time', params: {duration: 7}}], stagedGroups: []}},
        {id: 'legacy-browser-blank', modelId: 'xiaobai', name: '旧版空草稿', updated: 2, draft: true, state: {program: [], stagedGroups: []}}
      ]));
      localStorage.setItem('cardModel:xiaobai:active:v1', 'legacy-browser-blank');
      localStorage.setItem('xiaobaiProjectsV1', '[{"id":"untouched-original","name":"旧源数据","state":[]}]');
    });
    const key = 'cardModel:xiaobai:projects:v1';
    const rows = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), key);
    const idle = () => page.waitForFunction(() => !CardPageTransition.busy);
    const current = () => page.evaluate(() => serializeWorkspaceState());
    await page.goto(base + '#home'); await idle();
    const legacy = await rows(), originalSource = await page.evaluate(() => localStorage.getItem('xiaobaiProjectsV1'));
    assert.equal(await page.locator('.home-card').count(), 2);
    await page.getByRole('button', {name: '打开：旧版浏览作品', exact: true}).click(); await idle();
    assert.equal(await page.locator('.home-screen').isVisible(), true);
    assert.match(await page.locator('.home-error').textContent(), /旧版作品.*原数据已保留/);
    assert.deepEqual(await rows(), legacy);
    assert.equal(await page.evaluate(() => CardHome.load()), false);
    assert.deepEqual(await rows(), legacy);
    await page.locator('#newProject').click(); await idle();
    const fresh = await current();
    assert.equal(fresh.groups.length, 1, 'new projects start with exactly one program head');
    assert.equal(typeof fresh.groups[0].startId, 'string');
    assert.equal(fresh.groups[0].startId.length > 0, true);
    assert.deepEqual(fresh.groups[0].items, []);
    assert.equal(fresh.selectedGroupId, fresh.groups[0].id, 'the initial head receives palette click additions');
    await page.locator('#editorToolsToggle').click();
    await page.locator('#palette [data-card-id="motor-forward"]').click();
    const appended = await current();
    assert.equal(appended.groups.length, 1);
    assert.equal(appended.groups[0].startId, fresh.groups[0].startId);
    assert.equal(appended.groups[0].items[0].id, 'motor-forward');
    await page.locator('#undoBtn').click();
    assert.deepEqual((await current()).groups, fresh.groups, 'undoing the first addition retains the default head');
    await page.locator('#saveBtn').click();
    assert.equal(await page.locator('.home-dialog').isVisible(), true, 'a default start head is savable content');
    await page.locator('.home-dialog [type=button]').click();
    const startOnly = {schemaVersion: 2, kind: 'free-canvas', groups: [{id: 'browser-head', x: 30, y: -70, startId: 'browser-start', items: []}], viewport: {x: -10, y: 20, scale: 0.8}, selectedGroupId: 'browser-head'};
    await page.evaluate(state => {applyWorkspaceState(state); renderProgram(); renderPalette(); commitHistory();}, startOnly);
    await page.locator('#saveBtn').click();
    await page.locator('.home-dialog input').fill('自由画布存储测试'); await page.locator('.home-dialog [type=submit]').click();
    assert.equal((await rows()).filter(row => row.id !== legacy[0].id && row.id !== legacy[1].id).length, 1, 'a start head alone saves a project');
    const savedStart = await current();
    await page.locator('#homeBtn').click(); await idle();
    const projectButton = page.getByRole('button', {name: '打开：自由画布存储测试', exact: true});
    assert.equal(await projectButton.locator('.home-preview-chain .start').count(), 1);
    assert.equal(await projectButton.locator('.home-preview-chain .program-block').count(), 0);
    await projectButton.click(); await idle(); assert.deepEqual(await current(), savedStart);
    await page.reload(); await idle(); assert.deepEqual(await current(), savedStart);
    // Populate every catalog card for every model with its native defaults and nested loop contents.
    const allTypes = await page.evaluate(() => {
      const results = [];
      for (const model of CardModels.list()) {
        const items = Object.values(model.catalog).flatMap(category => category.cards).map((card, index) => ({uid: `${model.id}-${index}`, id: card.id, params: Object.fromEntries(Object.entries(card.paramsSchema || {}).map(([name, schema]) => [name, JSON.parse(JSON.stringify(schema.default ?? null))])), ...(card.kind === 'loop' ? {children: [{uid: `${model.id}-child-${index}`, id: 'wait-time', params: {duration: 2}}]} : {})}));
        const state = {schemaVersion: 2, kind: 'free-canvas', groups: [{id: 'all-types', x: -15, y: 90, startId: 'all-types-start', items}], viewport: {x: 45, y: -25, scale: 1.25}, selectedGroupId: 'all-types'};
        const store = DeviceModels.createStore(localStorage, model.id), previous = store.read();
        const fixture = {id: 'all-type-fixture', modelId: model.id, name: '全类型存储夹具', state};
        store.write([...previous, fixture]);
        results.push({modelId: model.id, types: items.length, exact: JSON.stringify(store.read().find(project => project.id === fixture.id).state) === JSON.stringify(state)});
        store.write(previous);
      }
      return results;
    });
    assert.ok(allTypes.length >= 5); assert.ok(allTypes.every(result => result.types > 0 && result.exact), JSON.stringify(allTypes));
    const multiple = {schemaVersion: 2, kind: 'free-canvas', groups: [
      {id: 'browser-left', x: -150, y: 30, startId: 'left-start', items: [{uid: 'browser-wait', id: 'wait-time', params: {duration: 3}}]},
      {id: 'browser-right', x: 480, y: -90, startId: null, items: [{uid: 'browser-loop', id: 'loop-count', params: {count: 4}, children: [{uid: 'browser-nested', id: 'motor-forward', params: {port: 'R/M2', duration: 0.5}}]}]},
      {id: 'browser-only-start', x: 120, y: 420, startId: 'only-start', items: []},
      {id: 'browser-loose', x: 710, y: 480, startId: null, items: [{uid: 'browser-loose-wait', id: 'wait-time', params: {duration: 9}}]}
    ], viewport: {x: -110, y: 210, scale: 0.65}, selectedGroupId: 'browser-right'};
    await page.evaluate(state => {applyWorkspaceState(state); renderProgram(); renderPalette(); commitHistory(); CardHome.autosave();}, multiple);
    const saved = await current();
    assert.equal(Object.hasOwn(saved, 'stagedGroups'), false);
    await page.locator('#homeBtn').click(); await idle();
    const thumb = page.getByRole('button', {name: '打开：自由画布存储测试', exact: true}).locator('.home-preview-workspace');
    assert.equal(await thumb.locator('.home-preview-chain').count(), saved.groups.length, 'saved groups are rendered as separate chains');
    assert.equal(await thumb.locator('.home-preview-chain > .start').count(), saved.groups.filter(group => group.startId).length, 'detached groups gain no extra start head');
    const geometry = await thumb.evaluate(node => {
      const wrap = node.getBoundingClientRect(), chains = [...node.querySelectorAll('.home-preview-chain')].map(chain => {
        const rect = chain.getBoundingClientRect(); return {id: chain.dataset.groupId, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom};
      });
      return {wrap: {left: wrap.left, top: wrap.top, right: wrap.right, bottom: wrap.bottom}, chains};
    });
    for (const chain of geometry.chains) {
      assert.ok(chain.left >= geometry.wrap.left - 1 && chain.right <= geometry.wrap.right + 1, `thumbnail width fits: ${chain.id}`);
      assert.ok(chain.top >= geometry.wrap.top - 1 && chain.bottom <= geometry.wrap.bottom + 1, `thumbnail height fits: ${chain.id}`);
    }
    const left = geometry.chains.find(chain => chain.id === 'browser-left'), right = geometry.chains.find(chain => chain.id === 'browser-right');
    assert.ok(right.left > left.left && right.top < left.top, 'thumbnail preserves saved group positions');
    await page.getByRole('button', {name: '打开：自由画布存储测试', exact: true}).click(); await idle();
    assert.deepEqual(await current(), saved, 'reopening keeps the full document rather than joining groups');
    assert.deepEqual((await rows()).filter(row => row.id.startsWith('legacy')), legacy);
    assert.equal(await page.evaluate(() => localStorage.getItem('xiaobaiProjectsV1')), originalSource);
    assert.deepEqual(errors, []);
    console.log('PASS free-canvas home: legacy edit guard, start-only save, reload, all model card storage, layout-fitted multiple chains and full document reopen.');
  } finally {await browser.close();}
}

(async () => {storageChecks(); allModelCardChecks(); if (process.argv.includes('--ui')) await browserChecks();})().catch(error => {console.error(error); process.exitCode = 1;});
