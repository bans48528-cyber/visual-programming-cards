(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DeviceModels = api;
})(globalThis, function() {
  'use strict';
  const MODEL_KEY = 'cardDefaultModelV1';
  const key = (modelId, part) => `cardModel:${modelId}:${part}:v1`;
  const blank = state => Array.isArray(state) ? !state.length : !(state?.program?.length || state?.stagedGroups?.length);
  function createStore(storage, modelId) {
    const read = (part, fallback) => {
      const raw = storage.getItem(key(modelId, part));
      return raw === null ? fallback : JSON.parse(raw);
    };
    return {
      read() {
        const rows = read('projects', []);
        if (!Array.isArray(rows)) throw new Error('作品列表格式无效，原数据已保留。');
        return rows.filter(p => p && p.modelId === modelId && typeof p.id === 'string' && typeof p.name === 'string' && p.state);
      },
      write(projects) {
        if (projects.some(p => p.modelId !== modelId)) throw new Error('不能将作品保存到其他设备型号。');
        storage.setItem(key(modelId, 'projects'), JSON.stringify(projects.filter(p => !blank(p.state))));
      },
      getActive: () => storage.getItem(key(modelId, 'active')),
      setActive: id => id ? storage.setItem(key(modelId, 'active'), id) : storage.removeItem(key(modelId, 'active'))
    };
  }
  function migrate(storage) {
    // Write destinations before marking migration complete; keep all legacy keys as backup.
    if (storage.getItem(key('xiaobai', 'migrated'))) return;
    if (storage.getItem(key('xiaobai', 'projects')) === null) {
      const raw = storage.getItem('xiaobaiProjectsV1');
      let rows = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(rows)) throw new Error('旧作品列表读取失败，原数据已保留。');
      if (!raw) {
        const legacy = storage.getItem('xiaobaiVisualProgramV1') || storage.getItem('xiaobaiVisualProgramLegacy');
        if (legacy) rows = [{id: 'migrated-workspace', name: '原有作品', updated: Date.now(), state: JSON.parse(legacy)}];
      }
      const projects = rows.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.state)
        .map(p => ({...p, modelId: 'xiaobai'}));
      createStore(storage, 'xiaobai').write(projects);
    }
    if (storage.getItem(key('xiaobai', 'active')) === null) {
      const active = storage.getItem('xiaobaiActiveProjectV1');
      if (active) createStore(storage, 'xiaobai').setActive(active);
    }
    if (storage.getItem(key('xiaobai', 'bluetooth')) === null) {
      const device = storage.getItem('xiaobaiDefaultDeviceV1');
      if (device) storage.setItem(key('xiaobai', 'bluetooth'), device);
    }
    storage.setItem(key('xiaobai', 'migrated'), '1');
  }
  function migrateSpark(storage) {
    if(storage.getItem(key('spark-ai','migrated')))return;
    if(storage.getItem(key('spark-ai','projects'))===null){
      const raw=storage.getItem('cardProjectsV1');
      let rows=raw?JSON.parse(raw):[];
      if(!Array.isArray(rows))throw new Error('原 Spark AI 作品读取失败，原数据已保留。');
      if(!raw){
        const workspace=storage.getItem('visualProgramV2')||storage.getItem('visualProgramV1');
        if(workspace)rows=[{id:'spark-workspace',name:'原有作品',updated:Date.now(),state:JSON.parse(workspace)}];
      }
      createStore(storage,'spark-ai').write(rows.filter(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&p.state).map(p=>({...p,modelId:'spark-ai'})));
      const active=storage.getItem('cardActiveProjectV1');
      if(active&&storage.getItem(key('spark-ai','active'))===null)createStore(storage,'spark-ai').setActive(active);
    }
    storage.setItem(key('spark-ai','migrated'),'1');
  }
  function createRegistry() {
    const models = new Map();
    return {
      register(model) {
        if (!/^[a-z][a-z0-9-]*$/.test(model.id) || models.has(model.id)) throw new Error('设备型号标识无效或重复。');
        if (!model.catalog || !model.execution || !model.bluetooth) throw new Error('设备型号配置不完整。');
        models.set(model.id, model);
      },
      get: id => models.get(id), list: () => [...models.values()]
    };
  }
  function createSession(registry, storage, hooks = {}) {
    let current = registry.get(storage.getItem(MODEL_KEY)) || registry.list()[0];
    let selected = Boolean(registry.get(storage.getItem(MODEL_KEY))), switching = false, revision = 0;
    let controller = new AbortController();
    return {
      get current() { return current; }, get selected() { return selected; }, get switching() { return switching; },
      capture() {
        const version = revision, model = current, signal = controller.signal;
        return {model, signal, isCurrent: () => !signal.aborted && version === revision && model === current && !switching};
      },
      async select(id) {
        const next = registry.get(id);
        if (!next) throw new Error('此设备型号尚未接入。');
        if (switching) return false;
        if (current === next) { storage.setItem(MODEL_KEY, id); selected = true; return true; }
        // Checkpoint before invalidation; a storage failure must not lose the draft.
        switching = true;
        try { await hooks.checkpoint?.(current); } catch(error) { switching = false; throw error; }
        revision++; controller.abort();
        const old = current;
        try {
          await hooks.deactivate?.(old);
          await hooks.activate?.(next);
          storage.setItem(MODEL_KEY, id); current = next; selected = true;
        } catch (error) {
          await hooks.deactivate?.(next);
          await hooks.activate?.(old);
          throw error;
        } finally { controller = new AbortController(); switching = false; }
        hooks.changed?.(current);
        return true;
      }
    };
  }
  function createExecution(spec, context) {
    const controller = new AbortController(); let runner = null;
    const valid = () => !controller.signal.aborted && context.isCurrent();
    const check = () => { if (!valid()) throw new Error('执行已取消。'); };
    const report = text => { if (valid()) context.onProgress?.(text); };
    const options = {...context, signal: controller.signal, isCurrent: valid, onProgress: report,
      onStep: (...args) => { if (valid()) context.onStep?.(...args); }};
    const cancel = () => { controller.abort(); runner?.cancel?.(); };
    context.signal?.addEventListener('abort', cancel, {once: true});
    if (context.signal?.aborted) cancel();
    return {
      async run(program) {
        try {
          check(); const snapshot = spec.validate(program); check();
          if (spec.kind === 'stream') {
            report('正在运行'); runner = spec.createRunner(context.connection, {...options, isCurrent: context.isCurrent}); check(); await runner.run(snapshot);
          } else {
            let payload = snapshot;
            if (spec.kind === 'compiled') { report('正在编译'); payload = await spec.compile(snapshot, options); check(); }
            else if (spec.kind !== 'upload') throw new Error('设备执行方式未配置。');
            report('正在发送程序'); const result=await spec.sendProgram(payload, options); check();
            if(!spec.startsOnUpload){report('正在启动设备程序');await spec.startProgram?.(options);}
            return result;
          }
          check();
        } finally { context.signal?.removeEventListener('abort', cancel); }
      },
      cancel,
      async stop() { cancel(); if (runner) await runner.stop(); else await spec.stop?.(options); }
    };
  }
  return {MODEL_KEY, key, blank, createStore, migrate, migrateSpark, createRegistry, createSession, createExecution};
});
