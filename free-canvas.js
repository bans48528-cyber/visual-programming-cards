/* Independent two-dimensional workspace. Group x/y is its outside connector baseline. */
(function (global) {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const SNAP_RADIUS = 28 * 1.8, SNAP_RELEASE_RADIUS = 38 * 1.8;
  const direct = (el, selector) => [...el.children].filter(child => child.matches(selector));
  // Validate the two identity graphs once. Each existing connection can then be
  // checked without cloning the whole workspace; the final drop still uses M.drop.
  function previewLegalSlots(M, doc, payload, slots) {
    const legal = new Set();
    if (!M.validate(doc).ok || !payload || !Array.isArray(payload.items)) return legal;
    const head = payload.startId == null ? null : payload.startId;
    const probe = M.create();
    probe.groups = [{ id: M.uid('preview-validation'), x: 0, y: 0, startId: head, items: payload.items,
      ...(payload.trigger === undefined ? {} : {trigger:payload.trigger}) }];
    if (!M.validate(probe).ok) return legal;
    const existing = new Set(), incoming = new Set(), groups = new Map(), owners = new Map();
    function visit(items, identities, group, indexNodes) {
      for (const item of items) {
        identities.add(item.uid);
        if (indexNodes) owners.set(item.uid, { group, item });
        if (Array.isArray(item.children)) visit(item.children, identities, group, indexNodes);
      }
    }
    for (const group of doc.groups) {
      groups.set(group.id, group); existing.add(group.id);
      if (group.startId != null) existing.add(group.startId);
      visit(group.items, existing, group, true);
    }
    visit(payload.items, incoming, null, false); if (head !== null) incoming.add(head);
    for (const id of incoming) if (existing.has(id)) return legal;
    for (const slot of slots) {
      const group = groups.get(slot.groupId); if (!group) continue;
      let sequence = group.items;
      if (slot.parentUid != null) {
        const parent = owners.get(slot.parentUid);
        if (incoming.has(slot.parentUid) || !parent || parent.group.id !== group.id || !Array.isArray(parent.item.children)) continue;
        sequence = parent.item.children;
      }
      const index = slot.index == null ? sequence.length : slot.index;
      if (!Number.isInteger(index) || index < 0 || index > sequence.length) continue;
      if (head !== null && (slot.parentUid != null || index !== 0 || group.startId !== null)) continue;
      if (slot.mode === 'wrap' && (head !== null || !Array.isArray(payload.items[0]?.children) ||
        payload.items[0].children.length !== 0 ||
        !Number.isInteger(slot.endIndex) || slot.endIndex <= index || slot.endIndex > sequence.length)) continue;
      legal.add(slot.key);
    }
    return legal;
  }
  function create(adapter) {
    const M = global.CanvasWorkspace;
    if (!M) throw new Error('CanvasWorkspace must load before FreeCanvas');
    const area = adapter.area, viewport = adapter.viewport, chain = adapter.chain;
    const palette = adapter.palette, library = adapter.library;
    let doc = M.create(), gesture = null, frame = 0, destroyed = false, suppressClick = 0, protectControlsUntil = 0, editingLocked = false;
    let selected = new Set(), pointers = new Map(), elements = new Map(), groupElements = new Map();
    let slots = [], liveSlot = null, projection = null, wrapPreview = null;
    const subscriptions = [];
    const controls = adapter.controls;
    const resetControl = controls?.querySelector('[data-canvas-action="reset"]');
    const dropzones = document.createElement('div');
    dropzones.className = 'free-canvas-dropzones'; dropzones.hidden = true;
    dropzones.innerHTML = '<div data-canvas-drop="delete">删除</div>';
    library.append(dropzones);
    const empty = document.createElement('div'); empty.className = 'free-canvas-empty';
    empty.textContent = '把卡片拖到画布，自由拼接程序'; area.append(empty);
    area.classList.add('free-canvas-area'); viewport.classList.add('free-canvas-viewport');
    chain.classList.add('free-canvas-world'); chain.classList.remove('sequence-zone');
    delete chain.dataset.sequencePath;
    palette?.classList.add('free-canvas-palette');
    function listen(el, type, fn, opts) { el.addEventListener(type, fn, opts); subscriptions.push(() => el.removeEventListener(type, fn, opts)); }
    function emit(reason, viewOnly = false) {
      adapter.onChange?.(doc, { reason, viewOnly });
    }
    function syncSelection() {
      selected = new Set([...selected].filter(id => M.findGroup(doc, id)));
      if (doc.selectedGroupId && !selected.size) selected.add(doc.selectedGroupId);
      for (const [id, el] of groupElements) {
        el.classList.toggle('is-selected', selected.has(id));
        el.setAttribute('aria-selected', String(selected.has(id)));
      }
      adapter.onSelect?.(doc.selectedGroupId || null);
      adapter.onSelection?.([...selected]);
    }
    function select(id, options = {}) {
      if (id && !M.findGroup(doc, id)) return;
      if (options.toggle) {
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        doc.selectedGroupId = selected.has(id) ? id : [...selected].slice(-1)[0] || null;
      } else {
        selected = new Set(id ? [id] : []); doc.selectedGroupId = id || null;
      }
      syncSelection();
      if (!options.silent) emit('selection', true);
    }
    function annotate(container, items, groupId, parentUid = null, prefix = []) {
      direct(container, '.program-block').forEach((el, index) => {
        const item = items[index]; if (!item) return;
        const path = [...prefix, index];
        el.dataset.nodeUid = item.uid; el.dataset.groupId = groupId;
        el.dataset.parentUid = parentUid || ''; el.dataset.nodePath = path.join('.');
        elements.set(item.uid, el);
        const inner = direct(el, '.loop-inner')[0];
        if (inner) { inner.dataset.parentUid = item.uid; inner.dataset.groupId = groupId; annotate(inner, item.children || [], groupId, item.uid, path); }
      });
    }
    function startElement(startId, groupId, trigger) {
      const el = document.createElement('div');
      el.className = 'block start free-canvas-start';
      el.dataset.startId = startId; el.dataset.groupId = groupId;
      el.tabIndex = 0; el.setAttribute('role', 'button');
      el.setAttribute('aria-label', '运行这组程序'); el.title = '点击运行，拖动整组';
      const icon = document.createElement('img'); icon.className = 'start-art-icon';
      const model = adapter.model?.() || {};
      const message = trigger?.type === 'message' && model.id === 'xiaobai';
      const option = model.messageColors?.find(value=>value.value === trigger?.message);
      icon.src = message ? option?.openIcon || model.messageStartIcon : model.startIcon || 'assets/blocks/start.svg'; icon.alt = ''; icon.draggable = false;
      icon.classList.toggle('model-art-icon', !message && model.artStyle === 'fitted');
      if (message) {
        el.classList.add('message-start'); el.dataset.message = trigger.message;

        el.setAttribute('aria-label',`${option?.label || ''}消息 ${trigger.message} 开始，点击测试运行这组程序`);
      }
      el.append(icon);
      if (message) {
        el.classList.add('has-param-bubble');
        const button = document.createElement('button'); button.type = 'button'; button.className = 'param-bubble head-param-trigger option-dropdown-trigger';
        button.setAttribute('aria-label','编辑消息颜色');
        button.title = `${option?.label || '消息'}${trigger.message}`;
        const dropdown = adapter.createDropdownArtwork?.();
        if (dropdown) button.append(dropdown); else button.textContent = `${option?.label || '消息'}${trigger.message}`;
        el.append(button);
      }
      return el;
    }
    function buildGroup(group) {
      const el = document.createElement('div'); el.className = 'free-canvas-group';
      el.dataset.groupId = group.id || ''; el.setAttribute('role', 'group');
      el.setAttribute('aria-label', group.startId ? '可运行程序组' : '卡片组');
      if (group.startId) el.append(startElement(group.startId, group.id, group.trigger));
      (group.items || []).forEach((item, index) => el.append(adapter.createNode(item, [index])));
      const metrics = BlockLayout.sequence(el); el._metrics = metrics;
      return el;
    }
    function transformView() {
      const v = doc.viewport;
      chain.style.transform = `translate3d(${v.x}px,${v.y}px,0) scale(${v.scale})`;
      viewport.style.backgroundPosition = `${v.x}px ${v.y}px`;
      viewport.style.backgroundSize = `${28 * v.scale}px ${28 * v.scale}px`;
      if (resetControl) resetControl.title = `恢复100%（当前缩放 ${Math.round(v.scale * 100)}%）`;
    }
    function layout() {
      for (const group of doc.groups) {
        const el = groupElements.get(group.id); if (!el) continue;
        const m = BlockLayout.sequence(el); el._metrics = m;
        // A front join grows leftward, keeping the existing stack under its
        // original connector instead of pushing it away from the dragged tail.
        const frontAdvance = projection && liveSlot?.side === 'front' && liveSlot.groupId === group.id
          ? Number(projection.dataset.advance) : 0;
        el.style.transform = `translate3d(${group.x - frontAdvance}px,${group.y - m.anchor}px,0)`;
      }
      transformView();
      slots = collectSlots();
    }
    function render() {
      elements.clear(); groupElements.clear(); chain.replaceChildren();
      for (const group of doc.groups) {
        const el = buildGroup(group); groupElements.set(group.id, el); chain.append(el);
        annotate(el, group.items, group.id);
      }
      empty.hidden = doc.groups.length > 0; layout(); syncSelection(); syncEditingLock();
    }
    function syncEditingLock() {
      area.classList.toggle('is-editing-locked', editingLocked);
      palette?.setAttribute('aria-disabled', String(editingLocked));
      for (const el of chain.querySelectorAll('.free-canvas-start, .param-bubble')) {
        el.setAttribute('aria-disabled', String(editingLocked));
        if (el.matches('button')) el.disabled = editingLocked;
        else if (el.classList.contains('free-canvas-start')) el.tabIndex = editingLocked ? -1 : 0;
      }
    }
    function setEditingLocked(locked) {
      // Roll back extraction before the immutable run snapshot can be executed.
      const next = Boolean(locked);
      if (editingLocked === next) return editingLocked;
      cancel();
      if (next) doc = M.clone(doc);
      editingLocked = next; syncEditingLock(); return editingLocked;
    }
    function rect(el) { return BlockLayout.clientRect ? BlockLayout.clientRect(el) : el.getBoundingClientRect(); }
    function world(point) {
      const r = rect(viewport), v = doc.viewport;
      return { x: (point.x - r.left - v.x) / v.scale, y: (point.y - r.top - v.y) / v.scale };
    }
    function screen(point) {
      const r = rect(viewport), v = doc.viewport;
      return { x: r.left + v.x + point.x * v.scale, y: r.top + v.y + point.y * v.scale };
    }
    function collectSlots() {
      const result = [], scale = doc.viewport.scale;
      function collect(group, container, sequence, parentUid = null) {
        const nodes = direct(container, '.program-block').filter(el => !el.classList.contains('free-canvas-projection'));
        const containerRect = rect(container), head = direct(container, '.start')[0];
        for (let i = 0; i <= nodes.length; i++) {
          const node = nodes[i], previous = nodes[i - 1]; let x, y;
          if (node) { const r = rect(node); x = r.left; y = r.top + Number(node.dataset.connectorY) * scale; }
          else if (previous) { const r = rect(previous); x = r.left + Number(previous.dataset.advance) * scale; y = r.top + Number(previous.dataset.connectorY) * scale; }
          else if (head) { const r = rect(head); x = r.left + Number(head.dataset.advance) * scale; y = r.top + Number(head.dataset.connectorY) * scale; }
          else { const m = BlockLayout.sequence(container); x = containerRect.left; y = containerRect.top + m.anchor * scale; }
          result.push({ key: `${group.id}:${parentUid || ''}:${i}`, groupId: group.id, parentUid, index: i, x, y, container });
          // Only an unheaded root has an exposed left socket. Inner sequences
          // and headed roots retain their explicit insertion slots.
          if (i === 0 && parentUid === null && group.startId === null && nodes.length) {
            result.push({ key: `${group.id}::0:front`, groupId: group.id, parentUid: null, index: 0, x, y, container, side: 'front' });
          }
        }
        nodes.forEach((el, i) => { const inner = direct(el, '.loop-inner')[0]; if (inner) collect(group, inner, sequence[i]?.children || [], sequence[i]?.uid); });
      }
      for (const group of doc.groups) { const el = groupElements.get(group.id); if (el) collect(group, el, group.items); }
      return result;
    }
    function getSelectedGroup() { const group = M.findGroup(doc, doc.selectedGroupId); return editingLocked && group ? M.clone(group) : group; }
    function commitExternal(value, options = {}) {
      if (editingLocked && !options.force) return M.clone(doc);
      cancel(); doc = typeof value === 'function' ? value(doc) || doc : value || doc;
      if (options.render !== false) render(); else layout();
      if (options.notify !== false) emit(options.reason || 'external', !!options.viewOnly);
      return doc;
    }
    function add(cardId) {
      if (editingLocked) return false;
      cancel();
      const head = cardId === '__start__' || cardId === '__message_start__';
      if (cardId === '__message_start__' && adapter.model?.()?.id !== 'xiaobai') return false;
      if (head && adapter.model?.()?.id === 'xiaobai' && doc.groups.filter(group=>group.startId).length >= 4) {
        adapter.onStatus?.('小白作品最多支持 4 个开始头。'); return false;
      }
      const item = head ? null : adapter.createItem(cardId); if (!item && !head) return false;
      if (item && !item.params) item.params = {};
      const payload = { startId: item ? null : M.uid('start'), items: item ? [item] : [],
        ...(cardId === '__message_start__' ? {trigger:{type:'message',message:1}} : {}) };
      const group = getSelectedGroup();
      const middle = world({ x: rect(viewport).left + viewport.clientWidth * .35, y: rect(viewport).top + viewport.clientHeight * .45 });
      let result = group && item ? M.drop(doc, payload, { groupId: group.id, parentUid: null, index: group.items.length }) : M.drop(doc, payload, { x: middle.x, y: middle.y });
      if (!result.ok) return false;
      doc = result.doc; selected = new Set([result.groupId]); render(); emit('add');
      if (item) focusNode(item.uid);
      return result.groupId;
    }
    function fit() {
      cancel(); if (!doc.groups.length) { doc.viewport = { x: 0, y: 0, scale: 1 }; transformView(); emit('viewport', true); return; }
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const group of doc.groups) {
        const m = groupElements.get(group.id)._metrics;
        left = Math.min(left, group.x); top = Math.min(top, group.y - m.anchor);
        right = Math.max(right, group.x + m.advance + 8); bottom = Math.max(bottom, group.y - m.anchor + m.height);
      }
      const scale = Math.max(Number.EPSILON, Math.min(Math.max(1, viewport.clientWidth - 80) / Math.max(1, right - left), Math.max(1, viewport.clientHeight - 100) / Math.max(1, bottom - top), 1.25));
      doc.viewport = { scale, x: (viewport.clientWidth - (right - left) * scale) / 2 - left * scale, y: (viewport.clientHeight - (bottom - top) * scale) / 2 - top * scale };
      transformView(); slots = collectSlots(); emit('viewport', true);
    }
    function resetZoom() {
      cancel(); const center = { x: rect(viewport).left + viewport.clientWidth / 2, y: rect(viewport).top + viewport.clientHeight / 2 };
      const anchor = world(center), r = rect(viewport);
      doc.viewport = { x: center.x - r.left - anchor.x, y: center.y - r.top - anchor.y, scale: 1 };
      transformView(); slots = collectSlots(); emit('viewport', true);
    }
    function focusNode(uid) {
      const el = elements.get(uid); if (!el) return false;
      const r = rect(el), vr = rect(viewport); select(el.dataset.groupId);
      if (r.left < vr.left + 20 || r.right > vr.right - 20 || r.top < vr.top + 20 || r.bottom > vr.bottom - 20) {
        doc.viewport.x += vr.left + viewport.clientWidth / 2 - (r.left + r.width / 2);
        doc.viewport.y += vr.top + viewport.clientHeight / 2 - (r.top + r.height / 2);
        transformView(); slots = collectSlots(); emit('viewport', true);
      }
      el.classList.add('free-canvas-focused'); setTimeout(() => el.classList.remove('free-canvas-focused'), 900); return true;
    }
    function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); }
    function point(event) { return { x: event.clientX, y: event.clientY }; }
    function capture(event) { try { viewport.setPointerCapture(event.pointerId); } catch (_) {} }
    function release() { const ids = [...pointers.keys()]; pointers.clear(); for (const id of ids) { try { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); } catch (_) {} } }
    function clearPreview() {
      liveSlot = null;
      restoreWrapPreview();
      if (projection) { projection.remove(); projection = null; layout(); }
      for (const el of dropzones.children) el.classList.remove('is-hot');
    }
    function restoreWrapPreview() {
      if (!wrapPreview) return;
      const {groupId, original, preview} = wrapPreview;
      preview.replaceWith(original); groupElements.set(groupId, original);
      wrapPreview = null; layout();
    }
    function cleanupVisuals() {
      cancelAnimationFrame(frame); frame = 0;
      gesture?.ghost?.remove(); dropzones.hidden = true;
      area.classList.remove('is-canvas-dragging', 'is-canvas-panning');
      document.body.classList.remove('is-free-canvas-dragging');
      clearPreview(); release();
    }
    function cancel() {
      if (!gesture) return;
      const previous = gesture; cleanupVisuals(); gesture = null; pointers.clear();
      if (previous.snapshot && previous.active) { doc = previous.snapshot; selected = new Set(previous.selectionSnapshot || []); render(); }
    }
    function ghostFromPayload(payload) {
      const ghost = buildGroup({ startId: payload.startId, items: payload.items, trigger:payload.trigger });
      ghost.classList.add('free-canvas-ghost'); document.body.append(ghost);
      ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      return ghost;
    }
    function activateDrag(g) {
      if (editingLocked) return false;
      if (g.active) return true;
      if (g.source === 'palette' && ['__start__','__message_start__'].includes(g.cardId) &&
          adapter.model?.()?.id === 'xiaobai' && doc.groups.filter(group=>group.startId).length >= 4) {
        adapter.onStatus?.('小白作品最多支持 4 个开始头。'); return false;
      }
      adapter.cancelLegacy?.();
      g.snapshot = doc; g.selectionSnapshot = [...selected]; g.active = true; suppressClick = performance.now() + 500;
      if (g.source === 'canvas') {
        if (selected.size > 1 && selected.has(g.groupId)) {
          g.multi = [...selected].map(id => M.findGroup(doc, id)).filter(Boolean).map(group => M.clone(group));
          const chosen = new Set(g.multi.map(group => group.id));
          doc = { ...M.clone(doc), groups: M.clone(doc.groups.filter(group => !chosen.has(group.id))), selectedGroupId: null };
          g.payload = { groups: g.multi }; g.anchor = { x: g.start.x, y: g.start.y };
          const origin = world(g.start); g.origin = origin;
          const ghost = document.createElement('div'); ghost.className = 'free-canvas-multi-ghost';
          const scale = doc.viewport.scale;
          for (const group of g.multi) {
            const child = buildGroup(group), m = child._metrics;
            child.style.transform = `translate3d(${(group.x - origin.x) * scale}px,${(group.y - m.anchor - origin.y) * scale}px,0) scale(${scale})`;
            ghost.append(child);
          }
          document.body.append(ghost); g.ghost = ghost; g.offset = { x: 0, y: 0 };
        } else {
          const extracted = M.extract(doc, { groupId: g.groupId, nodeId: g.nodeId, head: g.whole });
          if (!extracted.ok) { gesture = null; return false; }
          doc = extracted.doc; g.payload = extracted.payload;
        }
      } else {
        const head = g.cardId === '__start__' || g.cardId === '__message_start__';
        if (g.cardId === '__message_start__' && adapter.model?.()?.id !== 'xiaobai') { gesture = null; return false; }
        const item = head ? null : adapter.createItem(g.cardId);
        if (!item && !head) { gesture = null; return false; }
        if (item && !item.params) item.params = {};
        g.payload = { startId: item ? null : M.uid('start'), items: item ? [item] : [],
          ...(g.cardId === '__message_start__' ? {trigger:{type:'message',message:1}} : {}) };
        doc = M.clone(doc);
      }
      render();
      if (!g.multi) {
        g.ghost = ghostFromPayload(g.payload); const m = g.ghost._metrics;
        if (!g.offset) g.offset = { x: 26 * doc.viewport.scale, y: m.anchor * doc.viewport.scale };
        else g.offset.y += (m.anchor - g.sourceAnchor) * doc.viewport.scale;
        g.ghostAnchor = m.anchor;
        const first = g.payload.items[0], loop = direct(g.ghost, '.loop-block')[0];
        if (!g.payload.startId && Array.isArray(first?.children) && first.children.length === 0 && loop === g.ghost.firstElementChild) {
          const inner = direct(loop, '.loop-inner')[0];
          g.wrapOffsetX = parseFloat(inner.style.left);
        }
      }
      area.classList.add('is-canvas-dragging'); document.body.classList.add('is-free-canvas-dragging');
      dropzones.hidden = g.source === 'palette';
      g.baseSlots = slots.map(slot => ({ ...slot, world: world(slot) }));
      if (g.wrapOffsetX !== undefined) {
        // A loop mouth captures the remaining connected run, never an adjacent
        // group or a sequence at another depth merely inside its large outline.
        const wraps = g.baseSlots.filter(slot => !slot.side).flatMap(slot => {
          const count = direct(slot.container, '.program-block').length;
          return slot.index < count ? [{...slot, key: slot.key + ':wrap', mode: 'wrap', endIndex: count}] : [];
        });
        g.baseSlots.push(...wraps);
      }
      g.legalKeys = g.multi ? new Set() : previewLegalSlots(M, doc, g.payload, g.baseSlots);
      // An occupied port that a loop can capture belongs to its inner mouth.
      // Do not first preview an empty loop inserted in front of the same run.
      g.wrapPorts = new Set(g.baseSlots.filter(slot => slot.mode === 'wrap' && g.legalKeys.has(slot.key))
        .map(slot => `${slot.groupId}:${slot.parentUid || ''}:${slot.index}`));
      schedule(); return true;
    }
    function hitDrop(p) {
      if (dropzones.hidden) return null;
      const r = rect(library);
      if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return 'delete';
      return null;
    }
    function canvasDropAllowed(p) {
      const r = rect(viewport);
      if (p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom) return false;
      const target = document.elementFromPoint(p.x, p.y);
      return !!target && !target.closest('.topbar, .execution-controls, .execution-notice, .param-popover');
    }
    function showSlot(slot, g) {
      if (slot?.key === liveSlot?.key) return;
      restoreWrapPreview();
      if (projection) { projection.remove(); projection = null; layout(); }
      liveSlot = slot;
      if (!slot) return;
      if (slot.mode === 'wrap') {
        const result = M.drop(doc, g.payload, slot);
        if (!result.ok) { liveSlot = null; return; }
        const original = groupElements.get(slot.groupId), preview = buildGroup(M.findGroup(result.doc, slot.groupId));
        [...preview.querySelectorAll('[data-node-uid]')].find(el => el.dataset.nodeUid === g.payload.items[0].uid)
          ?.classList.add('free-canvas-wrap-incoming');
        original.replaceWith(preview); groupElements.set(slot.groupId, preview);
        wrapPreview = {groupId: slot.groupId, original, preview};
        layout(); return;
      }
      // Preview is the exact same payload and target passed to the model on drop.
      const preview = buildGroup({ startId: g.payload.startId, items: g.payload.items, trigger:g.payload.trigger });
      // The sequence engine measures the same direct nodes as a committed group.
      projection = document.createElement('div'); projection.className = 'drop-projection free-canvas-projection';
      const m = preview._metrics; projection.dataset.advance = m.advance; projection.dataset.connectorY = m.anchor;
      projection.style.width = `${m.advance}px`; projection.style.height = `${m.height}px`;
      projection.append(...preview.children); projection._payloadMetrics = m;
      const nodes = direct(slot.container, '.program-block');
      slot.container.insertBefore(projection, nodes[slot.index] || direct(slot.container, '.loop-empty-note')[0] || null);
      layout();
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(tick); }
    function tick() {
      frame = 0; const g = gesture; if (!g || !g.active || !g.ghost) return;
      const p = g.current, scale = doc.viewport.scale;
      const connector = { x: p.x - g.offset.x, y: g.multi ? p.y : p.y - g.offset.y + g.ghostAnchor * scale };
      const outgoing = { x: connector.x + (g.ghost._metrics?.advance || 0) * scale, y: connector.y };
      const sourceConnector = slot => slot.mode === 'wrap'
        ? {x: connector.x + g.wrapOffsetX * scale, y: connector.y}
        : slot.side === 'front' ? outgoing : connector;
      if (g.multi) g.ghost.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
      else g.ghost.style.transform = `translate3d(${p.x - g.offset.x}px,${p.y - g.offset.y}px,0) scale(${scale})`;
      const drop = hitDrop(p); g.dropzone = drop;
      for (const el of dropzones.children) el.classList.toggle('is-hot', el.dataset.canvasDrop === drop);
      const inside = canvasDropAllowed(p);
      if (!g.baseSlots) g.baseSlots = slots.map(slot => ({ ...slot, world: world(slot) }));
      // The outer trailing plug can join an exposed front socket independently
      // of an empty loop's inner mouth. Only its incoming insertion port is
      // reserved for capture, so normal wrapping keeps its existing priority.
      const eligibleSlot = slot => g.legalKeys.has(slot.key) && (slot.mode === 'wrap' || slot.side === 'front' ||
        !g.wrapPorts.has(`${slot.groupId}:${slot.parentUid || ''}:${slot.index}`));
      let nearest = null, nearestDistance = SNAP_RADIUS, capturePriority = false;
      if (!drop && inside && !g.multi) {
        // Layout preview can move neighbours; hit testing always uses committed geometry.
        for (const mode of ['wrap', 'insert']) {
          if (mode === 'insert') capturePriority = nearest?.mode === 'wrap';
          for (const slot of g.baseSlots) {
            // Only an exposed front socket competes with a loop mouth; other
            // insert/append ports retain the established capture priority.
            if (capturePriority && slot.side !== 'front') continue;
            if ((slot.mode === 'wrap') !== (mode === 'wrap') || !eligibleSlot(slot)) continue;
            const now = screen(slot.world || world(slot));
            const d = distance(sourceConnector(slot), now);
            if (d < nearestDistance) { nearestDistance = d; nearest = slot; }
          }
          // Compare the outer front port even when a mouth is in range. At
          // small zoom their screen-space radii overlap; ties still favor wrap.
        }
        if (liveSlot && eligibleSlot(liveSlot) &&
            (!capturePriority || liveSlot.mode === 'wrap' || liveSlot.side === 'front')) {
          const old = screen(liveSlot.world || world(liveSlot));
          const oldDistance = distance(sourceConnector(liveSlot), old);
          if (oldDistance <= SNAP_RELEASE_RADIUS && (!nearest ||
            ((nearest.mode === 'wrap') === (liveSlot.mode === 'wrap') && nearest.key !== liveSlot.key && nearestDistance > oldDistance - 5))) nearest = liveSlot;
        }
      }
      showSlot(nearest, g);
    }
    function beginPinch() {
      const list = [...pointers.values()].slice(0, 2); if (list.length < 2) return;
      const currentPointers = new Map(pointers); cancel(); pointers = currentPointers;
      for (const id of pointers.keys()) { try { viewport.setPointerCapture(id); } catch (_) {} }
      const center = { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2 };
      gesture = { type: 'pinch', distance: Math.max(1, distance(...list)), scale: doc.viewport.scale, anchor: world(center) };
      suppressClick = performance.now() + 500;
    }
    function down(event) {
      if (destroyed || event.button > 0) return;
      // A second finger belongs to the active canvas gesture even over a toolbar.
      // Restore any extracted payload before it can activate a control underneath.
      if (gesture && event.pointerType === 'touch' && pointers.size && !pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, point(event)); stop(event); capture(event);
        protectControlsUntil = performance.now() + 1000; beginPinch(); return;
      }
      if (event.target.closest('.param-popover, .execution-controls, .topbar')) return;
      const inCanvas = viewport.contains(event.target), inPalette = palette?.contains(event.target);
      if (!inCanvas && !inPalette) return;
      const p = point(event); pointers.set(event.pointerId, p);
      if (pointers.size > 1) { stop(event); capture(event); beginPinch(); return; }
      stop(event); capture(event); adapter.cancelLegacy?.(); adapter.onGesture?.();
      const node = event.target.closest('[data-node-uid]'), head = event.target.closest('.free-canvas-start');
      const card = inPalette ? event.target.closest('[data-card-id]') : null;
      const g = { pointerId: event.pointerId, start: p, current: p, target: event.target, active: false, type: 'pending' };
      gesture = g;
      if (inPalette) {
        g.source = 'palette'; g.cardId = card?.dataset.cardId;
        g.scrollStart = palette.scrollLeft; if (!card || editingLocked) g.browse = true;
      } else if (node || head) {
        if (editingLocked) { g.type = 'locked'; return; }
        g.source = 'canvas'; g.groupId = (head || node).dataset.groupId;
        g.nodeId = node?.dataset.nodeUid; g.whole = !!head;
        if (event.ctrlKey || event.metaKey || event.shiftKey) { select(g.groupId, { toggle: true }); g.selectionOnly = true; return; }
        if (!selected.has(g.groupId)) select(g.groupId);
        const sourceEl = g.whole ? groupElements.get(g.groupId) : node, r = rect(sourceEl);
        const anchor = g.whole ? sourceEl._metrics.anchor : Number(sourceEl.dataset.connectorY);
        g.offset = { x: p.x - r.left, y: p.y - r.top };
        g.sourceAnchor = anchor;
      } else {
        g.type = 'blank'; g.panView = { ...doc.viewport };
      }
    }
    function move(event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, point(event)); stop(event);
      const g = gesture; if (!g) return;
      if (g.type === 'pinch') {
        const list = [...pointers.values()].slice(0, 2); if (list.length < 2) return;
        const center = { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2 }, r = rect(viewport);
        const scale = clamp(g.scale * distance(...list) / g.distance, .25, 2.5);
        doc.viewport = { scale, x: center.x - r.left - g.anchor.x * scale, y: center.y - r.top - g.anchor.y * scale };
        transformView(); return;
      }
      if (event.pointerId !== g.pointerId || g.selectionOnly) return;
      if (g.type === 'locked') return;
      g.current = point(event); const dx = g.current.x - g.start.x, dy = g.current.y - g.start.y;
      if (g.type === 'blank' || g.type === 'pan') {
        if (g.type === 'blank' && Math.hypot(dx, dy) <= 7) return;
        g.type = 'pan'; suppressClick = performance.now() + 500;
        doc.viewport.x = g.panView.x + dx; doc.viewport.y = g.panView.y + dy;
        area.classList.add('is-canvas-panning'); transformView(); return;
      }
      if (!g.active) {
        if (g.source === 'palette') {
          if (!g.browse && dy < -10 && -dy > Math.abs(dx) * 1.15) { if (!activateDrag(g)) return; }
          else if (Math.abs(dx) > 9 || g.browse) { g.browse = true; palette.scrollLeft = g.scrollStart - dx; suppressClick = performance.now() + 500; return; }
          else return;
        } else if (Math.hypot(dx, dy) >= 7) { if (!activateDrag(g)) return; } else return;
      }
      schedule();
    }
    function up(event) {
      if (!pointers.has(event.pointerId)) return;
      stop(event); const g = gesture; pointers.delete(event.pointerId);
      try { viewport.releasePointerCapture(event.pointerId); } catch (_) {}
      if (!g) return;
      if (g.type === 'pinch') { protectControlsUntil = performance.now() + 500; if (!pointers.size) { gesture = null; slots = collectSlots(); emit('viewport', true); } return; }
      if (event.pointerId !== g.pointerId) return;
      if (g.type === 'locked') { cleanupVisuals(); gesture = null; return; }
      if (g.active) {
        g.current = point(event); tick(); const target = liveSlot, drop = g.dropzone;
        const connector = { x: g.current.x - g.offset.x, y: g.multi ? g.current.y : g.current.y - g.offset.y + g.ghostAnchor * doc.viewport.scale };
        const position = world(connector); const view = { ...doc.viewport };
        const targetGroup = target?.side === 'front' ? M.findGroup(doc, target.groupId) : null;
        const frontPosition = targetGroup ? { x: targetGroup.x - g.ghost._metrics.advance, y: targetGroup.y } : null;
        cleanupVisuals(); gesture = null; suppressClick = performance.now() + 550;
        const inCanvas = canvasDropAllowed(g.current);
        if (drop === 'delete') { render(); emit('delete'); adapter.onStatus?.('已删除所选卡片'); return; }
        if (!inCanvas) { doc = g.snapshot; selected = new Set(g.selectionSnapshot || []); render(); return; }
        if (g.multi) {
          const delta = { x: position.x - g.origin.x, y: position.y - g.origin.y };
          doc.groups.push(...g.multi.map(group => ({ ...group, x: group.x + delta.x, y: group.y + delta.y })));
          doc.viewport = view; selected = new Set(g.multi.map(group => group.id)); doc.selectedGroupId = g.groupId;
        } else {
          const result = M.drop(doc, g.payload, target || position);
          if (!result.ok) { doc = g.snapshot; render(); adapter.onStatus?.('这里无法连接，请拖到空白处'); return; }
          doc = frontPosition ? M.move(result.doc, result.groupId, frontPosition) : result.doc;
          doc.viewport = view; selected = new Set([result.groupId]);
        }
        render(); emit(target ? 'connect' : 'move'); return;
      }
      cleanupVisuals(); gesture = null;
      if (g.type === 'pan') { slots = collectSlots(); emit('viewport', true); }
      else if (g.type === 'blank') select(null);
      else if (!g.browse && !g.selectionOnly) {
        suppressClick = performance.now() + 400;
        if (g.source === 'palette') add(g.cardId);
        else if (g.source === 'canvas') {
          select(g.groupId);
          if (g.whole && g.target.closest('.head-param-trigger')) adapter.onHeadParam?.(g.groupId,g.target.closest('.head-param-trigger'));
          else if (g.whole && g.target.closest('.free-canvas-start')) adapter.onRun?.(g.groupId);
          else if (g.nodeId && elements.get(g.nodeId)?.classList.contains('has-param-bubble')) adapter.onParam?.(g.nodeId, g.target.closest('.param-bubble') || elements.get(g.nodeId));
        }
      }
    }
    function click(event) {
      if (performance.now() < protectControlsUntil && event.target.closest('.topbar, .execution-controls')) { stop(event); return; }
      if (!viewport.contains(event.target) && !palette?.contains(event.target)) return;
      if (event.target.closest('.param-popover')) return;
      stop(event);
      if (editingLocked) return;
      if (event.detail !== 0 || performance.now() < suppressClick) return;
      const node = event.target.closest('[data-node-uid]'), head = event.target.closest('.free-canvas-start');
      if (head) {
        select(head.dataset.groupId);
        if (event.target.closest('.head-param-trigger')) adapter.onHeadParam?.(head.dataset.groupId,event.target.closest('.head-param-trigger'));
        else adapter.onRun?.(head.dataset.groupId);
      }
      else if (node) { select(node.dataset.groupId); if (node.classList.contains('has-param-bubble')) adapter.onParam?.(node.dataset.nodeUid, event.target.closest('.param-bubble') || node); }
      else { const card = event.target.closest('[data-card-id]'); if (card && palette.contains(card)) add(card.dataset.cardId); }
    }
    function wheel(event) {
      if (!viewport.contains(event.target)) return;
      stop(event); cancel();
      if (event.ctrlKey || event.metaKey) {
        const p = point(event), anchor = world(p), r = rect(viewport), scale = clamp(doc.viewport.scale * Math.exp(-event.deltaY * .002), .25, 2.5);
        doc.viewport = { scale, x: p.x - r.left - anchor.x * scale, y: p.y - r.top - anchor.y * scale };
      } else { doc.viewport.x -= event.deltaX; doc.viewport.y -= event.deltaY; }
      transformView(); slots = collectSlots(); emit('viewport', true);
    }
    listen(document, 'pointerdown', down, { capture: true, passive: false });
    listen(document, 'pointermove', move, { capture: true, passive: false });
    listen(document, 'pointerup', up, { capture: true, passive: false });
    listen(document, 'pointercancel', event => { if (pointers.has(event.pointerId)) { stop(event); cancel(); } }, true);
    listen(viewport, 'lostpointercapture', event => { if (pointers.has(event.pointerId) && gesture) cancel(); });
    listen(document, 'click', click, true); listen(document, 'wheel', wheel, { capture: true, passive: false });
    listen(global, 'blur', cancel); listen(global, 'resize', () => { cancel(); layout(); });
    listen(global, 'hashchange', cancel);
    listen(document, 'visibilitychange', () => { if (document.hidden) cancel(); });
    listen(document, 'keydown', event => {
      if (event.key === 'Escape') cancel();
      if (event.target.closest('input,textarea,select,[contenteditable="true"],.param-popover')) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size) {
        if (editingLocked) { event.preventDefault(); return; }
        event.preventDefault(); cancel(); const ids = new Set(selected);
        doc.groups = doc.groups.filter(group => !ids.has(group.id)); doc.selectedGroupId = null; selected.clear(); render(); emit('delete');
      }
      if (!editingLocked && (event.key === 'Enter' || event.key === ' ') && event.target.closest('.free-canvas-start')) {
        stop(event); const head = event.target.closest('.free-canvas-start');
        if (event.target.closest('.head-param-trigger')) adapter.onHeadParam?.(head.dataset.groupId,event.target.closest('.head-param-trigger'));
        else adapter.onRun?.(head.dataset.groupId);
      }
    });
    if (controls) listen(controls, 'click', event => { const action = event.target.closest('[data-canvas-action]')?.dataset.canvasAction; if (action === 'fit') fit(); if (action === 'reset') resetZoom(); });
    const api = {
      getDocument: () => editingLocked ? M.clone(doc) : doc,
      load(value, options = {}) { if (editingLocked && !options.force) return M.clone(doc); cancel(); doc = M.normalize(value); selected = new Set(doc.selectedGroupId ? [doc.selectedGroupId] : []); if (options.render !== false) render(); return doc; },
      render, layout, add, select, cancel, fit, resetZoom, focusNode, getSelectedGroup, commitExternal,
      setEditingLocked,
      get editingLocked() { return editingLocked; },
      findElement: uid => elements.get(uid) || null,
      getSelection: () => [...selected],
      getSlots: () => collectSlots().map(({ key, groupId, parentUid, index, x, y, side }) => ({ key, groupId, parentUid, index, x, y, ...(side ? { side } : {}) })),
      getGesture: () => gesture ? { type: gesture.type, source: gesture.source, active: !!gesture.active, target: liveSlot ? { groupId: liveSlot.groupId, parentUid: liveSlot.parentUid, index: liveSlot.index, ...(liveSlot.mode ? {mode: liveSlot.mode, endIndex: liveSlot.endIndex} : {}), ...(liveSlot.side ? { side: liveSlot.side } : {}) } : null } : null,
      destroy() { cancel(); destroyed = true; subscriptions.forEach(remove => remove()); dropzones.remove(); empty.remove(); },
    };
    render(); return api;
  }
  global.FreeCanvas = { create };
})(globalThis);
