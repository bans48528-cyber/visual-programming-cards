/* Free-canvas document operations. No DOM, layout, transport or device state. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CanvasWorkspace = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var serial = 0;
  var MAX_DEPTH = 100;
  var own = function (value, key) { return Object.prototype.hasOwnProperty.call(value, key); };
  var object = function (value) { return value !== null && typeof value === 'object' && !Array.isArray(value); };
  var identity = function (value) { return typeof value === 'string' && value.trim().length > 0; };
  var finite = function (value) { return typeof value === 'number' && Number.isFinite(value); };
  var messageTrigger = function (value) {
    return object(value) && value.type === 'message' && Number.isInteger(value.message) &&
      value.message >= 1 && value.message <= 6 && Object.keys(value).every(function (key) { return key === 'type' || key === 'message'; });
  };
  var loop = function (item) { return Array.isArray(item.children) || item.id === 'loop' || item.id === 'loop-count'; };
  var start = function (item) {
    return item.kind === 'start' || item.id === 'start' || item.id === 'program-start' || item.id === 'start-block' ||
      item.id === '__start__' || item.id === '__message_start__' || item.id === 'message-start';
  };

  function uid(prefix) {
    serial += 1;
    var random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + serial.toString(36);
    return (prefix || 'node') + '-' + random;
  }

  // Retain a graph while cloning so validation can report cycles instead of overflowing.
  function clone(value, seen) {
    if (value === null || typeof value !== 'object') return value;
    seen = seen || new Map();
    if (seen.has(value)) return seen.get(value);
    var result = Array.isArray(value) ? [] : {};
    seen.set(value, result);
    Object.keys(value).forEach(function (key) {
      Object.defineProperty(result, key, { value: clone(value[key], seen), enumerable: true, configurable: true, writable: true });
    });
    return result;
  }

  function create() {
    return {
      schemaVersion: 2, kind: 'free-canvas', groups: [],
      viewport: { x: 0, y: 0, scale: 1 }, selectedGroupId: null
    };
  }

  function normalize(raw, options) {
    var doc = create();
    if (!object(raw) || raw.schemaVersion !== 2 || raw.kind !== 'free-canvas') return doc;
    options = options || {};
    var used = new Set();
    function unique(value, prefix) {
      if (!identity(value) || used.has(value)) {
        do { value = uid(prefix); } while (used.has(value));
      }
      used.add(value);
      return value;
    }
    function sequence(rawItems, ancestors, depth) {
      if (!Array.isArray(rawItems) || depth > MAX_DEPTH) return [];
      var result = [];
      rawItems.forEach(function (rawItem) {
        if (!object(rawItem) || ancestors.has(rawItem)) return;
        var nextAncestors = new Set(ancestors);
        nextAncestors.add(rawItem);
        var item = clone(rawItem);
        if (typeof options.normalizeItem === 'function') item = options.normalizeItem(item);
        if (!object(item) || !identity(item.id) || start(item)) return;
        var clean = {
          uid: unique(identity(rawItem.uid) ? rawItem.uid : item.uid, 'node'),
          id: item.id,
          params: object(item.params) ? clone(item.params) : {}
        };
        if (loop(item)) clean.children = sequence(item.children, nextAncestors, depth + 1);
        result.push(clean);
      });
      return result;
    }
    function groups(rawGroups) {
      if (!Array.isArray(rawGroups)) return [];
      return rawGroups.filter(object).map(function (rawGroup) {
        var group = {
          id: unique(rawGroup.id, 'group'),
          x: finite(rawGroup.x) ? rawGroup.x : 0,
          y: finite(rawGroup.y) ? rawGroup.y : 0,
          startId: identity(rawGroup.startId) ? unique(rawGroup.startId, 'start') : null,
          items: sequence(rawGroup.items, new Set(), 0)
        };
        // Keep a malformed saved trigger visible to validation instead of
        // silently turning a listener into an immediately running normal head.
        if (own(rawGroup, 'trigger') && rawGroup.trigger != null) group.trigger = clone(rawGroup.trigger);
        return group;
      }).filter(function (group) { return group.startId !== null || group.items.length > 0; });
    }
    doc.groups = groups(raw.groups);
    // Read-only compatibility: old shelf contents become ordinary canvas groups.
    // Approximate nested block heights only to place unpositioned recovered groups
    // below existing content; existing canvas coordinates are never changed.
    if (Array.isArray(raw.stagedGroups)) {
      function sequenceHeight(items) {
        return items.reduce(function (height, item) {
          return Math.max(height, Array.isArray(item.children) ? 40 + sequenceHeight(item.children) : 96);
        }, 96);
      }
      function groupHeight(group) { return sequenceHeight(group.items); }
      var restoreX = doc.groups.length ? Math.min.apply(null, doc.groups.map(function (group) { return group.x; })) : 80;
      var restoreY = doc.groups.length ? Math.max.apply(null, doc.groups.map(function (group) {
        return group.y + groupHeight(group);
      })) + 120 : 80;
      raw.stagedGroups.forEach(function (rawGroup) {
        var recovered = groups([rawGroup])[0];
        if (!recovered) return;
        if (!finite(rawGroup.x)) recovered.x = restoreX;
        if (!finite(rawGroup.y)) recovered.y = restoreY;
        doc.groups.push(recovered);
        restoreY = Math.max(restoreY, recovered.y + groupHeight(recovered) + 120);
      });
    }
    var viewport = object(raw.viewport) ? raw.viewport : {};
    doc.viewport = {
      x: finite(viewport.x) ? viewport.x : 0,
      y: finite(viewport.y) ? viewport.y : 0,
      scale: finite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1
    };
    doc.selectedGroupId = doc.groups.some(function (group) { return group.id === raw.selectedGroupId; })
      ? raw.selectedGroupId : null;
    return doc;
  }

  // Explicit conversion is reserved for built-in companion templates. normalize
  // deliberately does not silently convert legacy saved user works.
  function fromLegacy(raw, options) {
    var doc = create();
    var items = Array.isArray(raw) ? raw : raw && raw.program;
    if (Array.isArray(items) && items.length) {
      doc.groups.push({ id: uid('group'), x: 80, y: 80, startId: uid('start'), items: clone(items) });
      doc.selectedGroupId = doc.groups[0].id;
    }
    return normalize(Object.assign({}, doc, { stagedGroups: raw && raw.stagedGroups }), options);
  }

  function findGroup(doc, groupId) {
    return doc && Array.isArray(doc.groups) ? doc.groups.find(function (group) { return group.id === groupId; }) || null : null;
  }

  function findNode(doc, nodeId) {
    if (!doc || !Array.isArray(doc.groups)) return null;
    function search(group, items, parentUid, path) {
      for (var index = 0; index < items.length; index += 1) {
        var item = items[index];
        var itemPath = path.concat(index);
        if (item.uid === nodeId) return { group: group, sequence: items, index: index, item: item, parentUid: parentUid, path: itemPath };
        if (Array.isArray(item.children)) {
          var found = search(group, item.children, item.uid, itemPath);
          if (found) return found;
        }
      }
      return null;
    }
    for (var index = 0; index < doc.groups.length; index += 1) {
      var group = doc.groups[index];
      var found = search(group, group.items, null, []);
      if (found) return found;
    }
    return null;
  }

  function validate(doc) {
    var errors = [];
    var ids = new Set();
    var active = new Set();
    function error(code) { if (errors.indexOf(code) < 0) errors.push(code); }
    function addId(value, kind) {
      if (!identity(value)) error('invalid-' + kind + '-id');
      else if (ids.has(value)) error('duplicate-identity');
      else ids.add(value);
    }
    function sequence(items, depth) {
      if (!Array.isArray(items)) { error('invalid-sequence'); return; }
      if (depth > MAX_DEPTH) { error('nesting-too-deep'); return; }
      items.forEach(function (item) {
        if (!object(item)) { error('invalid-item'); return; }
        if (active.has(item)) { error('cyclic-items'); return; }
        active.add(item);
        addId(item.uid, 'node');
        if (!identity(item.id)) error('invalid-card-id');
        if (start(item)) error('start-in-sequence');
        if (!object(item.params)) error('invalid-params');
        if (own(item, 'children')) sequence(item.children, depth + 1);
        else if (loop(item)) error('invalid-loop-children');
        active.delete(item);
      });
    }
    function groups(list) {
      if (!Array.isArray(list)) { error('invalid-groups'); return; }
      list.forEach(function (group) {
        if (!object(group)) { error('invalid-group'); return; }
        addId(group.id, 'group');
        if (!finite(group.x) || !finite(group.y)) error('invalid-position');
        if (group.startId !== null && group.startId !== undefined) addId(group.startId, 'start');
        if (group.startId === undefined) error('invalid-start-id');
        if (own(group, 'trigger') && (!group.startId || !messageTrigger(group.trigger))) error('invalid-trigger');
        sequence(group.items, 0);
        if (!group.startId && Array.isArray(group.items) && !group.items.length) error('empty-detached-group');
      });
    }
    if (!object(doc) || doc.schemaVersion !== 2 || doc.kind !== 'free-canvas') return { ok: false, errors: ['invalid-document'] };
    groups(doc.groups);
    if (!object(doc.viewport) || !finite(doc.viewport.x) || !finite(doc.viewport.y) || !finite(doc.viewport.scale) || doc.viewport.scale <= 0) error('invalid-viewport');
    if (doc.selectedGroupId !== null && !findGroup(doc, doc.selectedGroupId)) error('invalid-selection');
    return { ok: errors.length === 0, errors: errors };
  }

  function failure(doc, reason) { return { ok: false, doc: doc, reason: reason }; }

  function pruneEmpty(doc, group) {
    if (group.startId === null && !group.items.length) {
      doc.groups = doc.groups.filter(function (candidate) { return candidate.id !== group.id; });
      if (doc.selectedGroupId === group.id) doc.selectedGroupId = null;
    }
  }

  function extract(doc, source) {
    if (!validate(doc).ok) return failure(doc, 'invalid-document');
    source = source || {};
    var group = findGroup(doc, source.groupId);
    if (!group) return failure(doc, 'group-not-found');
    var whole = source.head === true || !source.nodeId || source.nodeId === group.startId;
    var next = clone(doc);
    var nextGroup = findGroup(next, group.id);
    var payload = {
      startId: whole ? group.startId : null, items: [], sourceGroupId: group.id,
      x: group.x, y: group.y
    };
    if (whole) {
      payload.items = clone(group.items);
      if (own(group, 'trigger')) payload.trigger = clone(group.trigger);
      next.groups = next.groups.filter(function (candidate) { return candidate.id !== group.id; });
      if (next.selectedGroupId === group.id) next.selectedGroupId = null;
    } else {
      var location = findNode(next, source.nodeId);
      if (!location || location.group.id !== group.id) return failure(doc, 'node-not-found');
      payload.sourceNodeId = source.nodeId;
      payload.sourceParentUid = location.parentUid;
      payload.items = location.sequence.splice(location.index);
      pruneEmpty(next, nextGroup);
    }
    return { ok: true, doc: next, payload: payload };
  }

  function itemIdentities(items, result) {
    result = result || new Set();
    items.forEach(function (item) {
      result.add(item.uid);
      if (Array.isArray(item.children)) itemIdentities(item.children, result);
    });
    return result;
  }

  function drop(doc, payload, target) {
    if (!validate(doc).ok) return failure(doc, 'invalid-document');
    if (!object(payload) || !Array.isArray(payload.items)) return failure(doc, 'invalid-payload');
    var head = payload.startId == null ? null : payload.startId;
    var probe = create();
    // Use a fresh wrapper identity so real group IDs do not mask payload errors.
    var wrapperId = uid('validation');
    probe.groups = [{ id: wrapperId, x: 0, y: 0, startId: head, items: payload.items }];
    if (own(payload, 'trigger')) probe.groups[0].trigger = clone(payload.trigger);
    var payloadValidation = validate(probe);
    if (!payloadValidation.ok) return failure(doc, payloadValidation.errors[0] || 'invalid-payload');
    var incoming = itemIdentities(payload.items);
    if (head !== null) incoming.add(head);
    target = target || {};
    if (target.parentUid != null && incoming.has(target.parentUid)) return failure(doc, 'self-descendant');
    var existing = new Set();
    doc.groups.forEach(function (group) {
      existing.add(group.id);
      if (group.startId != null) existing.add(group.startId);
      itemIdentities(group.items, existing);
    });
    var duplicate = false;
    incoming.forEach(function (id) { if (existing.has(id)) duplicate = true; });
    if (duplicate) return failure(doc, 'duplicate-identity');
    var next = clone(doc);
    var group;
    if (target.groupId != null) {
      group = findGroup(next, target.groupId);
      if (!group) return failure(doc, 'group-not-found');
      var sequence = group.items;
      if (target.parentUid != null) {
        var parent = findNode(next, target.parentUid);
        if (!parent || parent.group.id !== group.id) return failure(doc, 'parent-not-found');
        if (!Array.isArray(parent.item.children)) return failure(doc, 'parent-not-loop');
        sequence = parent.item.children;
      }
      var index = target.index == null ? sequence.length : target.index;
      if (!Number.isInteger(index) || index < 0 || index > sequence.length) return failure(doc, 'invalid-index');
      if (head !== null) {
        if (target.parentUid != null) return failure(doc, 'start-in-loop');
        if (index !== 0) return failure(doc, 'start-not-first');
        if (group.startId !== null) return failure(doc, 'two-starts');
        group.startId = head;
        if (own(payload, 'trigger')) group.trigger = clone(payload.trigger);
        else delete group.trigger;
      }
      if (target.mode === 'wrap') {
        // Capture one continuous range at the same nesting level. Start heads
        // are group metadata and can never become loop children.
        if (head !== null || !payload.items.length || !Array.isArray(payload.items[0].children))
          return failure(doc, 'wrap-requires-loop');
        if (payload.items[0].children.length !== 0) return failure(doc, 'wrap-requires-empty-loop');
        var endIndex = target.endIndex;
        if (!Number.isInteger(endIndex) || endIndex <= index || endIndex > sequence.length)
          return failure(doc, 'invalid-wrap-range');
        var captured = sequence.splice(index, endIndex - index);
        var wrapped = clone(payload.items);
        wrapped[0].children.push.apply(wrapped[0].children, captured);
        sequence.splice.apply(sequence, [index, 0].concat(wrapped));
      } else sequence.splice.apply(sequence, [index, 0].concat(clone(payload.items)));
    } else {
      if (target.mode === 'wrap') return failure(doc, 'wrap-requires-target');
      if (!finite(target.x) || !finite(target.y)) return failure(doc, 'invalid-position');
      var groupId = identity(payload.sourceGroupId) && !existing.has(payload.sourceGroupId) && !incoming.has(payload.sourceGroupId)
        ? payload.sourceGroupId : uid('group');
      while (existing.has(groupId) || incoming.has(groupId)) groupId = uid('group');
      group = { id: groupId, x: target.x, y: target.y, startId: head, items: clone(payload.items) };
      if (own(payload, 'trigger')) group.trigger = clone(payload.trigger);
      next.groups.push(group);
    }
    next.selectedGroupId = group.id;
    var result = validate(next);
    if (!result.ok) return failure(doc, result.errors[0]);
    return { ok: true, doc: next, groupId: group.id };
  }

  function move(doc, groupId, position) {
    if (!findGroup(doc, groupId) || !position || !finite(position.x) || !finite(position.y)) return doc;
    var next = clone(doc);
    var group = findGroup(next, groupId);
    group.x = position.x;
    group.y = position.y;
    return next;
  }

  function remove(doc, source) {
    source = source || {};
    var group = findGroup(doc, source.groupId);
    if (!group) return doc;
    if (source.head || !source.nodeId || source.nodeId === group.startId) {
      var extracted = extract(doc, { groupId: group.id, head: true });
      return extracted.ok ? extracted.doc : doc;
    }
    var next = clone(doc);
    var location = findNode(next, source.nodeId);
    if (!location || location.group.id !== group.id) return doc;
    location.sequence.splice(location.index, 1);
    pruneEmpty(next, location.group);
    return next;
  }

  function setParam(doc, nodeId, key, value) {
    if (!findNode(doc, nodeId) || !identity(key)) return doc;
    var next = clone(doc);
    var item = findNode(next, nodeId).item;
    Object.defineProperty(item.params, key, { value: clone(value), enumerable: true, configurable: true, writable: true });
    return next;
  }

  function setTrigger(doc, groupId, trigger) {
    var group = findGroup(doc, groupId);
    if (!group || !group.startId || (trigger != null && !messageTrigger(trigger))) return doc;
    var next = clone(doc), target = findGroup(next, groupId);
    if (trigger == null) delete target.trigger;
    else target.trigger = clone(trigger);
    return next;
  }

  function view(doc, viewport) {
    viewport = viewport || {};
    var next = clone(doc);
    ['x', 'y'].forEach(function (key) { if (finite(viewport[key])) next.viewport[key] = viewport[key]; });
    if (finite(viewport.scale) && viewport.scale > 0) next.viewport.scale = viewport.scale;
    return next;
  }

  function select(doc, groupId) {
    if (groupId !== null && !findGroup(doc, groupId)) return doc;
    var next = clone(doc);
    next.selectedGroupId = groupId;
    return next;
  }

  return {
    create: create, normalize: normalize, fromLegacy: fromLegacy, clone: clone, uid: uid,
    findGroup: findGroup, findNode: findNode, validate: validate, extract: extract, drop: drop,
    move: move, remove: remove, setParam: setParam, setTrigger: setTrigger, view: view, select: select
  };
});
