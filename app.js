    const STORAGE_KEY = "visualProgramV2";
    const LEGACY_STORAGE_KEY = "visualProgramV1";

    const categories = {
      action: {
        color: "var(--action)",
        cards: [
          { id: "move-forward", label: "卡片A1", type: "action", actionName: "前进" },
          { id: "move-back", label: "卡片A2", type: "action", actionName: "后退" },
          { id: "turn-left", label: "卡片A3", type: "action", actionName: "左转" },
          { id: "turn-right", label: "卡片A4", type: "action", actionName: "右转" }
        ]
      },
      look: {
        color: "var(--look)",
        cards: [
          { id: "color-yellow", label: "卡片B1", type: "look", actionName: "变黄色" },
          { id: "color-blue", label: "卡片B2", type: "look", actionName: "变蓝色" },
          { id: "say-hi", label: "卡片B3", type: "look", actionName: "说你好" },
          {
            id: "matrix-display",
            label: "点阵屏",
            type: "look",
            actionName: "点阵屏",
            icon: "matrix",
            color: "var(--matrix)",
            paramsSchema: {
              pattern: {
                label: "点阵图案",
                type: "matrix",
                size: 5,
                default: [
                  0, 0, 0, 0, 0,
                  0, 0, 0, 0, 0,
                  0, 0, 1, 0, 0,
                  0, 0, 0, 0, 0,
                  0, 0, 0, 0, 0
                ]
              }
            }
          }
        ]
      },
      sound: {
        color: "var(--sound)",
        cards: [
          { id: "beep", label: "卡片C1", type: "sound", actionName: "播放声音" },
          { id: "ding", label: "卡片C2", type: "sound", actionName: "提示音" }
        ]
      },
      control: {
        color: "var(--control)",
        cards: [
          {
            id: "wait",
            label: "等待",
            type: "control",
            actionName: "等待",
            icon: "hourglass",
            color: "var(--loop)",
            paramsSchema: {
              seconds: {
                label: "等待时间",
                type: "number",
                default: 1,
                min: 0.5,
                max: 60,
                step: 0.5,
                unit: "秒"
              }
            }
          },
          {
            id: "ultrasonic-compare",
            label: "超声波",
            type: "control",
            actionName: "超声波检测",
            icon: "ultrasonic",
            color: "var(--look)",
            paramsSchema: {
              operator: {
                label: "比较符号",
                type: "select",
                default: ">",
                options: [
                  { label: "大于", value: ">", display: ">" },
                  { label: "小于", value: "<", display: "<" },
                  { label: "等于", value: "==", display: "=" }
                ]
              },
              distance: {
                label: "距离",
                type: "number",
                default: 20,
                min: 0,
                max: 200,
                step: 1,
                unit: "cm",
                integer: true
              }
            }
          },
          { id: "loop", label: "循环", type: "control", actionName: "循环", kind: "loop", color: "var(--loop)" },
          { id: "repeat-prev", label: "卡片D2", type: "control", actionName: "重复上张" },
          { id: "stop", label: "卡片D3", type: "control", actionName: "停止" }
        ]
      }
    };

    const flatCards = Object.values(categories).flatMap(group => group.cards);
    const cardById = Object.fromEntries(flatCards.map(card => [card.id, card]));
    const chain = document.getElementById("chain");
    const palette = document.getElementById("palette");
    const deleteOverlay = document.getElementById("deleteOverlay");
    const emptyNote = document.getElementById("emptyNote");
    const statusEl = document.getElementById("status");
    const programArea = document.querySelector(".program-area");
    const programCanvas = document.querySelector(".program-canvas");
    const topbar = document.querySelector(".topbar");
    const libraryArea = document.querySelector(".library-area");
    const tabs = document.querySelector(".tabs");
    const startBlock = document.getElementById("startBlock");
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    const paramEditor = document.getElementById("paramEditor");
    const grabTool = document.getElementById("grabTool");
    const eraserTool = document.getElementById("eraserTool");
    const eraseConfirm = document.getElementById("eraseConfirm");
    const eraseConfirmText = document.getElementById("eraseConfirmText");
    const eraseOkBtn = document.getElementById("eraseOkBtn");
    const eraseCancelBtn = document.getElementById("eraseCancelBtn");

    let activeCategory = "action";
    let program = [];
    let dragState = null;
    let grabToolState = null;
    let grabMarkedPaths = new Set();
    let eraserState = null;
    let eraserMarkedPaths = new Set();
    let programAnchorFrame = null;
    let activeParamEditor = null;
    let historySnapshots = [];
    let historyIndex = -1;
    const HISTORY_LIMIT = 80;

    function renderPalette() {
      palette.innerHTML = "";
      categories[activeCategory].cards.forEach(card => {
        const block = createBlock(card, "palette");
        palette.appendChild(block);
      });
    }

    function renderProgram() {
      closeParamEditor();
      hideEraseConfirm();
      clearGrabSelection(false);
      clearEraserMarks();
      clearGrabSelection(false);
      clearDropHints();
      chain.querySelectorAll(".program-block").forEach(el => el.remove());
      emptyNote.style.display = program.length ? "none" : "grid";
      renderSequence(program, chain, [], emptyNote);
      scheduleProgramAnchorUpdate();
    }

    function renderSequence(sequence, container, sequencePath, beforeElement = null) {
      sequence.forEach((item, index) => {
        const nodePath = [...sequencePath, index];
        const block = createProgramNode(item, nodePath);
        container.insertBefore(block, beforeElement);
      });
    }

    function createProgramNode(item, nodePath) {
      const card = cardById[item.id];
      if (card?.kind === "loop") return createLoopBlock(item, nodePath);
      return createBlock(card, "program", nodePath, item);
    }

    function createBlock(card, mode, nodePath = [], item = null) {
      if (mode === "palette" && card.kind === "loop") {
        return createPaletteLoopBlock(card);
      }

      const block = document.createElement("div");
      block.className = mode === "program" ? "block program-block" : "block";
      block.style.setProperty("--block-color", getCardColor(card));
      block.dataset.cardId = card.id;
      block.dataset.mode = mode;
      if (mode === "program") block.dataset.nodePath = pathToKey(nodePath);
      renderBlockContent(block, card, mode, item, nodePath);
      block.setAttribute("role", mode === "palette" ? "button" : "listitem");
      block.setAttribute("aria-label", mode === "palette" ? `添加${getCardDisplayLabel(card)}` : getCardDisplayLabel(card, item));

      block.addEventListener("pointerdown", startDrag);
      if (mode === "palette") {
        block.addEventListener("click", event => {
          if (dragState) return;
          if (event.detail === 0 || block.dataset.dragged === "true") return;
          addCard(card.id);
        });
      }
      if (mode === "program" && card.paramsSchema && card.id !== "matrix-display") {
        block.addEventListener("click", () => {
          if (dragState || block.dataset.dragged === "true") return;
          openParamEditor(nodePath, block);
        });
      }

      return block;
    }

    function renderBlockContent(block, card, mode, item = null, nodePath = []) {
      block.replaceChildren();
      block.classList.toggle("icon-card", Boolean(card.icon));
      block.classList.toggle("wait-card", card.id === "wait");
      block.classList.toggle("sensor-card", card.id === "ultrasonic-compare");
      block.classList.toggle("matrix-card", card.id === "matrix-display");

      if (card.icon) {
        const icon = createCardIcon(card, item);
        block.appendChild(icon);

        if (card.paramsSchema) {
          const bubble = document.createElement("span");
          bubble.className = "param-bubble";
          bubble.textContent = getParamBubbleText(card, item);
          bubble.setAttribute("aria-hidden", "true");

          if (mode === "program") {
            bubble.addEventListener("pointerdown", event => {
              event.preventDefault();
              event.stopPropagation();
            });
            bubble.addEventListener("click", event => {
              event.preventDefault();
              event.stopPropagation();
              openParamEditor(nodePath, block);
            });
          }

          block.appendChild(bubble);
        }

        return;
      }

      block.textContent = card.label;
    }

    function createCardIcon(card, item = null) {
      const icon = document.createElement("span");
      icon.className = "card-icon";

      if (card.icon === "hourglass") {
        icon.innerHTML = `
          <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <path d="M21 10h22M21 54h22M24 12v8c0 5 4 9 8 12 4-3 8-7 8-12v-8M24 52v-8c0-5 4-9 8-12 4 3 8 7 8 12v8M27 26h10M27 42h10" />
          </svg>
        `;
        return icon;
      }

      if (card.icon === "ultrasonic") {
        icon.innerHTML = `
          <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <path d="M16 20v24M24 15v34M36 22c4 2 6 6 6 10s-2 8-6 10M45 15c6 4 10 10 10 17s-4 13-10 17" />
          </svg>
        `;
        return icon;
      }

      if (card.icon === "matrix") {
        icon.appendChild(createMatrixPreview(getMatrixPattern(card, item)));
        return icon;
      }

      icon.textContent = card.label;
      return icon;
    }

    function createMatrixPreview(pattern) {
      const preview = document.createElement("span");
      preview.className = "matrix-preview";
      pattern.forEach(value => {
        const dot = document.createElement("span");
        dot.className = "matrix-dot";
        dot.classList.toggle("is-on", Boolean(value));
        preview.appendChild(dot);
      });
      return preview;
    }

    function createPaletteLoopBlock(card) {
      const loop = document.createElement("div");
      loop.className = "loop-block loop-palette-card";
      loop.style.setProperty("--loop-color", getCardColor(card));
      loop.dataset.cardId = card.id;
      loop.dataset.mode = "palette";
      loop.setAttribute("role", "button");
      loop.setAttribute("aria-label", `添加${card.label}`);
      loop.addEventListener("pointerdown", startDrag);
      loop.addEventListener("click", event => {
        if (dragState) return;
        if (event.detail === 0 || loop.dataset.dragged === "true") return;
        addCard(card.id);
      });

      const top = document.createElement("div");
      top.className = "loop-top";
      top.setAttribute("aria-hidden", "true");

      const left = document.createElement("div");
      left.className = "loop-left";
      left.setAttribute("aria-hidden", "true");

      const inner = document.createElement("div");
      inner.className = "loop-inner";
      inner.setAttribute("aria-hidden", "true");

      const tail = document.createElement("div");
      tail.className = "loop-tail";
      tail.textContent = card.label;

      loop.append(top, left, inner, tail);
      return loop;
    }

    function createLoopBlock(item, nodePath) {
      const card = cardById[item.id];
      const children = Array.isArray(item.children) ? item.children : [];
      const hasNestedLoop = children.some(child => cardById[child.id]?.kind === "loop");
      item.children = children;

      const loop = document.createElement("div");
      loop.className = "loop-block program-block";
      if (hasNestedLoop) {
        loop.classList.add("has-nested-loop");
      }
      loop.style.setProperty("--loop-color", getCardColor(card));
      loop.dataset.cardId = card.id;
      loop.dataset.mode = "program";
      loop.dataset.nodePath = pathToKey(nodePath);
      loop.setAttribute("role", "listitem");
      loop.setAttribute("aria-label", `循环卡，内部${children.length}张卡片`);
      loop.addEventListener("pointerdown", startDrag);

      const top = document.createElement("div");
      top.className = "loop-top";
      top.setAttribute("aria-hidden", "true");

      const left = document.createElement("div");
      left.className = "loop-left";
      left.setAttribute("aria-hidden", "true");

      const inner = document.createElement("div");
      inner.className = "loop-inner sequence-zone";
      if (hasNestedLoop) {
        inner.classList.add("has-nested-loop");
      }
      inner.dataset.sequencePath = pathToKey(nodePath);

      const note = document.createElement("div");
      note.className = "loop-empty-note";
      note.textContent = "拖入卡片";
      note.style.display = children.length ? "none" : "grid";
      inner.appendChild(note);

      renderSequence(children, inner, nodePath, note);

      const tail = document.createElement("div");
      tail.className = "loop-tail";
      tail.textContent = card.label;

      loop.append(top, left, inner, tail);
      return loop;
    }

    function addCard(cardId, sequencePath = [], insertIndex) {
      const card = cardById[cardId];
      const sequence = getSequenceByPath(sequencePath);
      if (!card || !sequence) return;

      const item = createProgramItem(cardId);
      const targetIndex = Number.isInteger(insertIndex) ? insertIndex : sequence.length;
      sequence.splice(clampIndex(targetIndex, sequence.length), 0, item);
      renderProgram();
      commitHistory();
      setStatus(`已添加：${card.label}`);
    }

    function createProgramItem(cardId) {
      const card = cardById[cardId];
      if (!card) return null;
      const item = {
        id: card.id,
        uid: `${card.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      };
      if (card.paramsSchema) item.params = createDefaultParams(card.paramsSchema);
      if (card.kind === "loop") item.children = [];
      return item;
    }

    function getCardColor(card) {
      return card.color || categories[card.type].color;
    }

    function createDefaultParams(schema = {}) {
      const params = {};
      Object.entries(schema).forEach(([key, definition]) => {
        params[key] = normalizeParamValue(definition, definition.default);
      });
      return params;
    }

    function normalizeParams(card, rawParams = {}) {
      if (!card?.paramsSchema) return undefined;
      const params = {};
      Object.entries(card.paramsSchema).forEach(([key, definition]) => {
        params[key] = normalizeParamValue(definition, rawParams?.[key]);
      });
      return params;
    }

    function normalizeParamValue(definition, rawValue) {
      if (definition.type === "number") {
        const defaultValue = Number(definition.default ?? 0);
        let value = Number(rawValue);
        if (!Number.isFinite(value)) value = defaultValue;

        if (Number.isFinite(definition.min)) value = Math.max(definition.min, value);
        if (Number.isFinite(definition.max)) value = Math.min(definition.max, value);

        if (Number.isFinite(definition.step) && definition.step > 0) {
          const base = Number.isFinite(definition.min) ? definition.min : 0;
          value = base + Math.round((value - base) / definition.step) * definition.step;
        }

        if (definition.integer) value = Math.round(value);
        if (Number.isFinite(definition.min)) value = Math.max(definition.min, value);
        if (Number.isFinite(definition.max)) value = Math.min(definition.max, value);

        return Number(value.toFixed(getNumberPrecision(definition)));
      }

      if (definition.type === "select") {
        const values = (definition.options || []).map(option => (
          typeof option === "object" ? option.value : option
        ));
        return values.includes(rawValue) ? rawValue : definition.default;
      }

      if (definition.type === "matrix") {
        const size = definition.size || 5;
        const length = size * size;
        const source = Array.isArray(rawValue) ? rawValue : definition.default;
        const values = Array.isArray(source) ? source : [];
        return Array.from({ length }, (_, index) => values[index] ? 1 : 0);
      }

      return rawValue ?? definition.default;
    }

    function getParamValue(card, item, key) {
      const definition = card.paramsSchema?.[key];
      if (!definition) return "";
      return normalizeParamValue(definition, item?.params?.[key]);
    }

    function getNumberPrecision(definition) {
      if (Number.isInteger(definition.precision)) return definition.precision;
      const step = String(definition.step ?? "");
      return step.includes(".") ? step.split(".")[1].length : 0;
    }

    function formatParamNumber(value) {
      return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
    }

    function getParamBubbleText(card, item = null) {
      if (card.id === "wait") {
        return formatParamNumber(getParamValue(card, item, "seconds"));
      }

      if (card.id === "ultrasonic-compare") {
        const operator = getParamOptionDisplay(card.paramsSchema.operator, getParamValue(card, item, "operator"));
        const distance = formatParamNumber(getParamValue(card, item, "distance"));
        return `${operator}${distance}`;
      }

      if (card.id === "matrix-display") {
        return "⌄";
      }

      return "";
    }

    function getMatrixPattern(card, item = null) {
      return getParamValue(card, item, "pattern");
    }

    function getParamOptionDisplay(definition, value) {
      const option = (definition.options || []).find(candidate => (
        (typeof candidate === "object" ? candidate.value : candidate) === value
      ));
      if (!option) return value;
      return typeof option === "object" ? (option.display || option.label || option.value) : option;
    }

    function getCardDisplayLabel(card, item = null) {
      if (card.id === "wait") {
        const seconds = formatParamNumber(getParamValue(card, item, "seconds"));
        return `等待 ${seconds} 秒`;
      }
      if (card.id === "ultrasonic-compare") {
        const operator = getParamOptionDisplay(card.paramsSchema.operator, getParamValue(card, item, "operator"));
        const distance = formatParamNumber(getParamValue(card, item, "distance"));
        return `超声波 ${operator} ${distance} 厘米`;
      }
      if (card.id === "matrix-display") {
        return "点阵屏图案";
      }
      return card.label;
    }

    function openParamEditor(nodePath, anchor) {
      const item = getNodeAtPath(nodePath);
      const card = cardById[item?.id];
      if (!item || !card?.paramsSchema) return;

      activeParamEditor = {
        nodePath: [...nodePath]
      };
      renderParamEditor(anchor);
    }

    function renderParamEditor(anchor) {
      if (!activeParamEditor) return;
      const item = getNodeAtPath(activeParamEditor.nodePath);
      const card = cardById[item?.id];
      if (!item || !card?.paramsSchema) {
        closeParamEditor();
        return;
      }

      paramEditor.replaceChildren();
      paramEditor.hidden = false;

      const icon = createParamEditorIcon(card, item);
      paramEditor.appendChild(icon);

      if (card.id === "wait") {
        paramEditor.appendChild(createNumberStepper(card, item, "seconds", "减少等待时间", "增加等待时间"));
      } else if (card.id === "ultrasonic-compare") {
        paramEditor.appendChild(createUltrasonicParamEditor(card, item));
      } else if (card.id === "matrix-display") {
        paramEditor.appendChild(createMatrixParamEditor(card, item));
      } else {
        closeParamEditor();
        return;
      }

      positionParamEditor(anchor || findProgramBlockByPath(activeParamEditor.nodePath));
    }

    function createParamEditorIcon(card, item = null) {
      const icon = document.createElement("span");
      icon.className = "param-editor-icon";
      icon.style.background = getCardColor(card);
      icon.appendChild(createCardIcon(card, item).firstElementChild.cloneNode(true));
      return icon;
    }

    function createUltrasonicParamEditor(card, item) {
      const panel = document.createElement("div");
      panel.className = "param-editor-panel";

      const operatorDefinition = card.paramsSchema.operator;
      const currentOperator = getParamValue(card, item, "operator");
      const optionRow = document.createElement("div");
      optionRow.className = "param-option-row";

      operatorDefinition.options.forEach(option => {
        const value = typeof option === "object" ? option.value : option;
        const button = document.createElement("button");
        button.className = "param-option-btn";
        button.classList.toggle("is-selected", value === currentOperator);
        button.type = "button";
        button.textContent = typeof option === "object" ? (option.display || option.label || option.value) : option;
        button.setAttribute("aria-label", typeof option === "object" ? option.label : option);
        button.addEventListener("click", () => setActiveParamValue("operator", value));
        optionRow.appendChild(button);
      });

      panel.append(
        optionRow,
        createNumberStepper(card, item, "distance", "减少检测距离", "增加检测距离")
      );
      return panel;
    }

    function createMatrixParamEditor(card, item) {
      const panel = document.createElement("div");
      panel.className = "matrix-editor-panel";

      const pattern = getMatrixPattern(card, item);
      const grid = document.createElement("div");
      grid.className = "matrix-editor-grid";

      pattern.forEach((value, index) => {
        const button = document.createElement("button");
        button.className = "matrix-cell";
        button.classList.toggle("is-on", Boolean(value));
        button.type = "button";
        button.setAttribute("aria-label", `点阵第${index + 1}格`);
        button.addEventListener("click", () => toggleMatrixCell(index));
        grid.appendChild(button);
      });

      panel.appendChild(grid);
      return panel;
    }

    function toggleMatrixCell(index) {
      if (!activeParamEditor) return;
      const item = getNodeAtPath(activeParamEditor.nodePath);
      const card = cardById[item?.id];
      if (!item || card?.id !== "matrix-display") return;

      const pattern = [...getMatrixPattern(card, item)];
      pattern[index] = pattern[index] ? 0 : 1;
      setActiveParamValue("pattern", pattern);
    }

    function createNumberStepper(card, item, key, decreaseLabel, increaseLabel) {
      const definition = card.paramsSchema[key];
      const value = getParamValue(card, item, key);
      const stepper = document.createElement("div");
      stepper.className = "param-stepper";

      const minus = document.createElement("button");
      minus.className = "param-step-btn";
      minus.type = "button";
      minus.textContent = "−";
      minus.setAttribute("aria-label", decreaseLabel);
      minus.disabled = value <= definition.min;
      minus.addEventListener("click", () => adjustActiveNumberParam(key, -1));

      const current = document.createElement("div");
      current.className = "param-current";
      current.innerHTML = `${formatParamNumber(value)}<span class="param-unit">${definition.unit || ""}</span>`;

      const plus = document.createElement("button");
      plus.className = "param-step-btn";
      plus.type = "button";
      plus.textContent = "+";
      plus.setAttribute("aria-label", increaseLabel);
      plus.disabled = value >= definition.max;
      plus.addEventListener("click", () => adjustActiveNumberParam(key, 1));

      stepper.append(minus, current, plus);
      return stepper;
    }

    function adjustActiveNumberParam(key, direction) {
      if (!activeParamEditor) return;
      const item = getNodeAtPath(activeParamEditor.nodePath);
      const card = cardById[item?.id];
      const definition = card?.paramsSchema?.[key];
      if (!item || !definition) return;

      const current = getParamValue(card, item, key);
      setActiveParamValue(key, current + direction * (definition.step || 1));
    }

    function setActiveParamValue(key, value) {
      if (!activeParamEditor) return;
      const item = getNodeAtPath(activeParamEditor.nodePath);
      const card = cardById[item?.id];
      const definition = card?.paramsSchema?.[key];
      if (!item || !definition) return;

      const next = normalizeParamValue(definition, value);
      item.params = {
        ...(item.params || {}),
        [key]: next
      };

      const block = refreshProgramBlock(activeParamEditor.nodePath);
      renderParamEditor(block);
      commitHistory();
      setStatus(`${getCardDisplayLabel(card, item)}`);
    }

    function refreshProgramBlock(nodePath) {
      const block = findProgramBlockByPath(nodePath);
      const item = getNodeAtPath(nodePath);
      const card = cardById[item?.id];
      if (!block || !item || !card) return null;

      renderBlockContent(block, card, "program", item, nodePath);
      block.setAttribute("aria-label", getCardDisplayLabel(card, item));
      scheduleProgramAnchorUpdate();
      return block;
    }

    function findProgramBlockByPath(nodePath) {
      return document.querySelector(`.program-block[data-node-path="${pathToKey(nodePath)}"]`);
    }

    function positionParamEditor(anchor) {
      if (!anchor || paramEditor.hidden) return;

      const anchorRect = anchor.getBoundingClientRect();
      const editorRect = paramEditor.getBoundingClientRect();
      const gap = 14;
      const margin = 8;
      let left = anchorRect.left + anchorRect.width / 2 - editorRect.width / 2;
      let top = anchorRect.bottom + gap;

      left = Math.max(margin, Math.min(left, window.innerWidth - editorRect.width - margin));
      if (top + editorRect.height > window.innerHeight - margin) {
        top = anchorRect.top - editorRect.height - gap;
      }
      top = Math.max(margin, top);

      paramEditor.style.left = `${Math.round(left)}px`;
      paramEditor.style.top = `${Math.round(top)}px`;
    }

    function closeParamEditor() {
      activeParamEditor = null;
      paramEditor.hidden = true;
      paramEditor.replaceChildren();
    }

    function setDeleteOverlayVisible(visible) {
      deleteOverlay.classList.toggle("is-visible", visible);
      deleteOverlay.classList.remove("is-hot");
      deleteOverlay.setAttribute("aria-hidden", String(!visible));
    }

    function startDrag(event) {
      if (event.button > 0) return;
      event.preventDefault();
      event.stopPropagation();

      if (dragState || grabToolState || eraserState || (event.pointerType === "touch" && event.isPrimary === false)) {
        return;
      }

      closeParamEditor();
      removeOrphanGhosts();

      const source = event.currentTarget;
      source.dataset.dragged = "false";
      const rect = source.getBoundingClientRect();
      const cardId = source.dataset.cardId;
      const fromProgram = source.dataset.mode === "program";
      const sourcePath = fromProgram ? keyToPath(source.dataset.nodePath) : null;
      const grabMovePaths = getGrabMovePathsForSource(sourcePath);
      const isGrabSelectionDrag = fromProgram && grabMovePaths.length > 0;
      const isGroupDrag = grabMovePaths.length > 1;
      const placeholderSources = fromProgram
        ? (isGroupDrag ? getBlocksByPaths(grabMovePaths) : [source])
        : [];
      if (fromProgram && grabMarkedPaths.size) {
        clearGrabSelection(false);
      }
      cancelEraseSelection(false);
      const ghost = isGroupDrag ? createGrabGroupGhost(grabMovePaths) : source.cloneNode(true);
      const ghostRect = isGroupDrag ? getElementsUnionRect(placeholderSources) : rect;

      if (fromProgram) {
        placeholderSources.forEach(block => block.classList.add("drag-source-placeholder"));
        setDeleteOverlayVisible(true);
      }

      ghost.classList.add("ghost");
      ghost.style.width = `${ghostRect.width}px`;
      ghost.style.height = `${ghostRect.height}px`;
      document.body.appendChild(ghost);

      dragState = {
        source,
        cardId,
        fromProgram,
        sourcePath,
        grabMovePaths,
        placeholderSources,
        ghost,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        canvasScrollLeft: programCanvas.scrollLeft,
        canvasScrollTop: programCanvas.scrollTop,
        windowScrollX: window.scrollX,
        windowScrollY: window.scrollY,
        lastTarget: null
      };

      setDragScrollLocked(true);
      if (source.setPointerCapture) source.setPointerCapture(event.pointerId);
      moveGhost(event.clientX, event.clientY);
      source.addEventListener("pointermove", moveDrag);
      source.addEventListener("pointerup", endDrag);
      source.addEventListener("pointercancel", cancelDrag);
    }

    function moveDrag(event) {
      if (!dragState) return;
      if (!isActiveDragPointer(event)) return;
      event.preventDefault();
      restoreDragScroll();

      const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
      if (distance > 8) dragState.source.dataset.dragged = "true";
      moveGhost(event.clientX, event.clientY);

      const overDelete = dragState.fromProgram && isPointInDeleteZone(event.clientX, event.clientY);
      deleteOverlay.classList.toggle("is-hot", overDelete);

      if (overDelete) {
        if (dragState.lastTarget) clearDropHints();
        dragState.lastTarget = null;
        return;
      }

      const target = findDropTarget(event.clientX, event.clientY);
      if (isSameDropTarget(dragState.lastTarget, target)) return;
      clearDropHints();
      dragState.lastTarget = target;
      if (target) showDropMarker(target);
    }

    function endDrag(event) {
      if (!dragState) return;
      if (!isActiveDragPointer(event)) return;
      event.preventDefault();
      restoreDragScroll();

      const movedEnough = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 8;
      const inDeleteZone = dragState.fromProgram && isPointInDeleteZone(event.clientX, event.clientY);
      const target = inDeleteZone ? null : findDropTarget(event.clientX, event.clientY);
      const { cardId, fromProgram, source, sourcePath, grabMovePaths } = dragState;

      cleanupDrag(event);

      if (!movedEnough) {
        setTimeout(() => { source.dataset.dragged = "false"; }, 0);
        return;
      }

      if (fromProgram && inDeleteZone) {
        const removed = removeNodeAtPath(sourcePath);
        if (removed) {
          renderProgram();
          commitHistory();
          setStatus(`已删除：${getNodeLabel(removed)}`);
        }
        setTimeout(() => { source.dataset.dragged = "false"; }, 0);
        return;
      }

      if (!target) {
        setTimeout(() => { source.dataset.dragged = "false"; }, 0);
        return;
      }

      if (fromProgram) {
        if (grabMovePaths?.length > 1) {
          const moved = moveProgramNodes(grabMovePaths, target.sequencePath, target.index);
          setStatus(moved ? `已同时移动 ${grabMovePaths.length} 张卡片` : "未能同时移动");
        } else {
          moveProgramNode(sourcePath, target.sequencePath, target.index);
          setStatus("已调整位置");
        }
      } else {
        insertNodeAtPath(target.sequencePath, target.index, createProgramItem(cardId));
        setStatus(`已添加：${cardById[cardId].label}`);
      }

      renderProgram();
      commitHistory();
      setTimeout(() => { source.dataset.dragged = "false"; }, 0);
    }

    function cancelDrag(event) {
      if (dragState && event && !isActiveDragPointer(event)) return;
      cleanupDrag(event);
    }

    function cleanupDrag(event) {
      if (!dragState) return;

      dragState.source.removeEventListener("pointermove", moveDrag);
      dragState.source.removeEventListener("pointerup", endDrag);
      dragState.source.removeEventListener("pointercancel", cancelDrag);
      (dragState.placeholderSources || [dragState.source]).forEach(block => {
        block.classList.remove("drag-source-placeholder");
      });
      if (dragState.source.hasPointerCapture?.(dragState.pointerId)) {
        dragState.source.releasePointerCapture(dragState.pointerId);
      }
      dragState.ghost.remove();
      setDeleteOverlayVisible(false);
      clearDropHints();
      restoreDragScroll();
      setDragScrollLocked(false);
      dragState = null;
    }

    function startGrabToolDrag(event) {
      if (event.button > 0) return;
      event.preventDefault();
      event.stopPropagation();

      if (dragState || grabToolState || eraserState || (event.pointerType === "touch" && event.isPrimary === false)) {
        return;
      }

      closeParamEditor();
      cancelEraseSelection(false);

      const rect = grabTool.getBoundingClientRect();
      grabToolState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false,
        touchedPathKeys: new Set()
      };

      grabTool.classList.add("is-dragging");
      grabTool.style.position = "fixed";
      grabTool.style.left = `${rect.left}px`;
      grabTool.style.top = `${rect.top}px`;
      grabTool.style.right = "auto";
      grabTool.style.width = `${rect.width}px`;
      grabTool.style.height = `${rect.height}px`;

      setDragScrollLocked(true);
      grabTool.setPointerCapture?.(event.pointerId);
      grabTool.addEventListener("pointermove", moveGrabToolDrag);
      grabTool.addEventListener("pointerup", endGrabToolDrag);
      grabTool.addEventListener("pointercancel", cancelGrabToolDrag);
      markCardsTouchedByGrabTool();
    }

    function moveGrabToolDrag(event) {
      if (!isActiveGrabToolPointer(event)) return;
      event.preventDefault();

      const distance = Math.hypot(event.clientX - grabToolState.startX, event.clientY - grabToolState.startY);
      if (distance > 6) grabToolState.moved = true;

      moveGrabTool(event.clientX, event.clientY);
      markCardsTouchedByGrabTool();
    }

    function endGrabToolDrag(event) {
      if (!isActiveGrabToolPointer(event)) return;
      event.preventDefault();

      cleanupGrabToolDrag(event);
      updateGrabMarkStatus();
    }

    function cancelGrabToolDrag(event) {
      if (grabToolState && event && !isActiveGrabToolPointer(event)) return;
      cleanupGrabToolDrag(event);
      updateGrabMarkStatus();
    }

    function cleanupGrabToolDrag(event) {
      if (!grabToolState) return;

      grabTool.removeEventListener("pointermove", moveGrabToolDrag);
      grabTool.removeEventListener("pointerup", endGrabToolDrag);
      grabTool.removeEventListener("pointercancel", cancelGrabToolDrag);
      if (grabTool.hasPointerCapture?.(grabToolState.pointerId)) {
        grabTool.releasePointerCapture(grabToolState.pointerId);
      }

      grabTool.classList.remove("is-dragging");
      grabTool.style.position = "";
      grabTool.style.left = "";
      grabTool.style.top = "";
      grabTool.style.right = "";
      grabTool.style.width = "";
      grabTool.style.height = "";
      setDragScrollLocked(false);
      grabToolState = null;
    }

    function isActiveGrabToolPointer(event) {
      return grabToolState && (!event || event.pointerId === grabToolState.pointerId);
    }

    function moveGrabTool(x, y) {
      if (!grabToolState) return;
      grabTool.style.left = `${x - grabToolState.offsetX}px`;
      grabTool.style.top = `${y - grabToolState.offsetY}px`;
    }

    function markCardsTouchedByGrabTool() {
      if (!grabToolState) return;

      const grabRect = grabTool.getBoundingClientRect();
      const touchedPathKeys = new Set();
      let changed = false;

      getErasableBlocks().forEach(block => {
        if (!isBlockTouchedByEraser(block, grabRect)) return;

        const pathKey = block.dataset.nodePath;
        if (!pathKey) return;

        touchedPathKeys.add(pathKey);
        if (grabToolState.touchedPathKeys.has(pathKey)) return;

        toggleGrabMark(block, pathKey);
        changed = true;
      });

      grabToolState.touchedPathKeys = touchedPathKeys;
      if (changed) updateGrabMarkStatus();
    }

    function toggleGrabMark(block, pathKey) {
      if (grabMarkedPaths.has(pathKey)) {
        grabMarkedPaths.delete(pathKey);
        block.classList.remove("grab-marked");
      } else {
        grabMarkedPaths.add(pathKey);
        block.classList.add("grab-marked");
      }
    }

    function clearGrabSelection(updateStatus = true) {
      document.querySelectorAll(".program-block.grab-marked").forEach(block => {
        block.classList.remove("grab-marked");
      });
      grabMarkedPaths.clear();
      if (updateStatus) setStatus("已清除抓取标记");
    }

    function updateGrabMarkStatus() {
      const count = getEffectiveGrabPaths().length;
      setStatus(count ? `已抓取标记 ${count} 张卡片` : "没有抓取标记");
    }

    function getEffectiveGrabPaths() {
      const paths = [...grabMarkedPaths].map(keyToPath).filter(path => path.length);
      return paths.filter(path => (
        !paths.some(otherPath => otherPath !== path && startsWithPath(path, otherPath))
      ));
    }

    function getGrabMovePathsForSource(sourcePath) {
      if (!sourcePath?.length) return [];
      const effectivePaths = getEffectiveGrabPaths();
      if (!effectivePaths.some(path => pathsEqual(path, sourcePath))) return [];

      const sourceParentPath = sourcePath.slice(0, -1);
      return effectivePaths
        .filter(path => pathsEqual(path.slice(0, -1), sourceParentPath))
        .sort(comparePathsAscending);
    }

    function comparePathsAscending(a, b) {
      const length = Math.min(a.length, b.length);
      for (let index = 0; index < length; index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
      }
      return a.length - b.length;
    }

    function getBlocksByPaths(paths) {
      return paths.map(findProgramBlockByPath).filter(Boolean);
    }

    function getElementsUnionRect(elements) {
      const rects = elements.map(element => element.getBoundingClientRect());
      if (!rects.length) return { width: 1, height: 1 };

      const left = Math.min(...rects.map(rect => rect.left));
      const right = Math.max(...rects.map(rect => rect.right));
      const top = Math.min(...rects.map(rect => rect.top));
      const bottom = Math.max(...rects.map(rect => rect.bottom));
      return {
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
      };
    }

    function createGrabGroupGhost(paths) {
      const group = document.createElement("div");
      group.className = "grab-group-ghost";
      appendCleanClonedBlocks(group, paths);
      return group;
    }

    function createGrabGroupProjection(paths) {
      const group = document.createElement("div");
      group.className = "grab-group-projection program-block";
      appendCleanClonedBlocks(group, paths);
      return group;
    }

    function appendCleanClonedBlocks(container, paths) {
      getBlocksByPaths(paths).forEach(block => {
        const clone = block.cloneNode(true);
        cleanupClonedProgramBlock(clone);
        container.appendChild(clone);
      });
    }

    function cleanupClonedProgramBlock(clone) {
      clone.classList.remove("grab-marked", "erase-marked", "drag-source-placeholder", "ghost", "drop-projection");
      clone.querySelectorAll(".grab-marked, .erase-marked, .drag-source-placeholder, .ghost, .drop-projection").forEach(item => {
        item.classList.remove("grab-marked", "erase-marked", "drag-source-placeholder", "ghost", "drop-projection");
      });
      clone.querySelectorAll("[id]").forEach(item => item.removeAttribute("id"));
    }

    function startEraserDrag(event) {
      if (event.button > 0) return;
      event.preventDefault();
      event.stopPropagation();

      if (dragState || eraserState || (event.pointerType === "touch" && event.isPrimary === false)) {
        return;
      }

      closeParamEditor();
      hideEraseConfirm();
      clearEraserMarks();

      const rect = eraserTool.getBoundingClientRect();
      eraserState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false,
        touchedPathKeys: new Set()
      };

      eraserTool.classList.add("is-dragging");
      eraserTool.style.position = "fixed";
      eraserTool.style.left = `${rect.left}px`;
      eraserTool.style.top = `${rect.top}px`;
      eraserTool.style.right = "auto";
      eraserTool.style.width = `${rect.width}px`;
      eraserTool.style.height = `${rect.height}px`;

      setDragScrollLocked(true);
      eraserTool.setPointerCapture?.(event.pointerId);
      eraserTool.addEventListener("pointermove", moveEraserDrag);
      eraserTool.addEventListener("pointerup", endEraserDrag);
      eraserTool.addEventListener("pointercancel", cancelEraserDrag);
      markCardsTouchedByEraser();
    }

    function moveEraserDrag(event) {
      if (!isActiveEraserPointer(event)) return;
      event.preventDefault();

      const distance = Math.hypot(event.clientX - eraserState.startX, event.clientY - eraserState.startY);
      if (distance > 6) eraserState.moved = true;

      moveEraser(event.clientX, event.clientY);
      markCardsTouchedByEraser();
    }

    function endEraserDrag(event) {
      if (!isActiveEraserPointer(event)) return;
      event.preventDefault();

      const moved = eraserState.moved;
      cleanupEraserDrag(event);

      const markedPaths = getEffectiveMarkedPaths();
      if (moved && markedPaths.length) {
        showEraseConfirm(markedPaths.length);
      } else {
        clearEraserMarks();
        setStatus("未标记卡片");
      }
    }

    function cancelEraserDrag(event) {
      if (eraserState && event && !isActiveEraserPointer(event)) return;
      cleanupEraserDrag(event);
      cancelEraseSelection();
    }

    function cleanupEraserDrag(event) {
      if (!eraserState) return;

      eraserTool.removeEventListener("pointermove", moveEraserDrag);
      eraserTool.removeEventListener("pointerup", endEraserDrag);
      eraserTool.removeEventListener("pointercancel", cancelEraserDrag);
      if (eraserTool.hasPointerCapture?.(eraserState.pointerId)) {
        eraserTool.releasePointerCapture(eraserState.pointerId);
      }

      eraserTool.classList.remove("is-dragging");
      eraserTool.style.position = "";
      eraserTool.style.left = "";
      eraserTool.style.top = "";
      eraserTool.style.right = "";
      eraserTool.style.width = "";
      eraserTool.style.height = "";
      setDragScrollLocked(false);
      eraserState = null;
    }

    function isActiveEraserPointer(event) {
      return eraserState && (!event || event.pointerId === eraserState.pointerId);
    }

    function moveEraser(x, y) {
      if (!eraserState) return;
      eraserTool.style.left = `${x - eraserState.offsetX}px`;
      eraserTool.style.top = `${y - eraserState.offsetY}px`;
    }

    function markCardsTouchedByEraser() {
      if (!eraserState) return;

      const eraserRect = eraserTool.getBoundingClientRect();
      const touchedPathKeys = new Set();
      let changed = false;

      getErasableBlocks().forEach(block => {
        if (!isBlockTouchedByEraser(block, eraserRect)) return;

        const pathKey = block.dataset.nodePath;
        if (!pathKey) return;

        touchedPathKeys.add(pathKey);
        if (eraserState.touchedPathKeys.has(pathKey)) return;

        toggleEraserMark(block, pathKey);
        changed = true;
      });

      eraserState.touchedPathKeys = touchedPathKeys;
      if (changed) updateEraserMarkStatus();
    }

    function toggleEraserMark(block, pathKey) {
      if (eraserMarkedPaths.has(pathKey)) {
        eraserMarkedPaths.delete(pathKey);
        block.classList.remove("erase-marked");
      } else {
        eraserMarkedPaths.add(pathKey);
        block.classList.add("erase-marked");
      }
    }

    function updateEraserMarkStatus() {
      const count = getEffectiveMarkedPaths().length;
      setStatus(count ? `已标记 ${count} 张卡片` : "没有标记卡片");
    }

    function getErasableBlocks() {
      return [...document.querySelectorAll(".program-block:not(.drop-projection)")];
    }

    function isBlockTouchedByEraser(block, eraserRect) {
      if (block.classList.contains("loop-block")) {
        const loopFrameParts = [...block.children].filter(child => (
          child.classList.contains("loop-top") ||
          child.classList.contains("loop-left") ||
          child.classList.contains("loop-tail")
        ));
        return loopFrameParts.some(part => rectsIntersect(eraserRect, part.getBoundingClientRect()));
      }

      return rectsIntersect(eraserRect, block.getBoundingClientRect());
    }

    function showEraseConfirm(count) {
      eraseConfirmText.textContent = `是否删除已标记的 ${count} 张卡片？`;
      eraseConfirm.hidden = false;
    }

    function hideEraseConfirm() {
      eraseConfirm.hidden = true;
    }

    function cancelEraseSelection(updateStatus = true) {
      hideEraseConfirm();
      clearEraserMarks();
      if (updateStatus) setStatus("已取消删除");
    }

    function clearEraserMarks() {
      document.querySelectorAll(".program-block.erase-marked").forEach(block => {
        block.classList.remove("erase-marked");
      });
      eraserMarkedPaths.clear();
    }

    function deleteMarkedCards() {
      const markedPaths = getEffectiveMarkedPaths();
      if (!markedPaths.length) {
        cancelEraseSelection(false);
        return;
      }

      const sortedPaths = markedPaths.sort(comparePathsForRemoval);
      let removedCount = 0;
      sortedPaths.forEach(path => {
        if (removeNodeAtPath(path)) removedCount += 1;
      });

      hideEraseConfirm();
      clearEraserMarks();
      renderProgram();
      commitHistory();
      setStatus(`已删除 ${removedCount} 张标记卡片`);
    }

    function getEffectiveMarkedPaths() {
      const paths = [...eraserMarkedPaths].map(keyToPath).filter(path => path.length);
      return paths.filter(path => (
        !paths.some(otherPath => otherPath !== path && startsWithPath(path, otherPath))
      ));
    }

    function comparePathsForRemoval(a, b) {
      const length = Math.min(a.length, b.length);
      for (let index = 0; index < length; index += 1) {
        if (a[index] !== b[index]) return b[index] - a[index];
      }
      return b.length - a.length;
    }

    function isActiveDragPointer(event) {
      return !event || event.pointerId === dragState.pointerId;
    }

    function removeOrphanGhosts() {
      document.querySelectorAll(".ghost").forEach(ghost => {
        if (!dragState || ghost !== dragState.ghost) ghost.remove();
      });
    }

    function setDragScrollLocked(locked) {
      document.body.classList.toggle("is-dragging", locked);
      if (locked) {
        document.addEventListener("touchmove", preventDragTouchScroll, { passive: false });
      } else {
        document.removeEventListener("touchmove", preventDragTouchScroll);
      }
    }

    function preventDragTouchScroll(event) {
      if (dragState || grabToolState || eraserState) event.preventDefault();
    }

    function restoreDragScroll() {
      if (!dragState) return;
      if (programCanvas.scrollLeft !== dragState.canvasScrollLeft) {
        programCanvas.scrollLeft = dragState.canvasScrollLeft;
      }
      if (programCanvas.scrollTop !== dragState.canvasScrollTop) {
        programCanvas.scrollTop = dragState.canvasScrollTop;
      }
      if (window.scrollX !== dragState.windowScrollX || window.scrollY !== dragState.windowScrollY) {
        window.scrollTo(dragState.windowScrollX, dragState.windowScrollY);
      }
    }

    function findDropTarget(clientX, clientY) {
      const nestedZones = [...document.querySelectorAll(".loop-inner.sequence-zone")]
        .map(zone => ({ zone, rect: zone.getBoundingClientRect() }))
        .filter(({ rect }) => isPointInRect(clientX, clientY, rect))
        .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));

      for (const { zone } of nestedZones) {
        const sequencePath = keyToPath(zone.dataset.sequencePath);
        if (isSequenceInsideDraggedItem(sequencePath)) continue;
        return {
          zone,
          sequencePath,
          index: getDropIndex(zone, clientX)
        };
      }

      if (!isPointInRootDropArea(clientX, clientY)) return null;

      return {
        zone: chain,
        sequencePath: [],
        index: getDropIndex(chain, clientX)
      };
    }

    function showDropMarker(target) {
      target.zone.classList.add("drag-over");

      const marker = createDropProjection();

      const blocks = getDirectProgramBlocks(target.zone);
      const before = blocks[target.index] || getDirectEmptyNote(target.zone);
      target.zone.insertBefore(marker, before || null);
    }

    function createDropProjection() {
      const projection = dragState.grabMovePaths?.length > 1
        ? createGrabGroupProjection(dragState.grabMovePaths)
        : createProjectionSourceElement().cloneNode(true);
      projection.classList.remove("ghost", "drag-source-placeholder", "grab-marked", "erase-marked");
      projection.classList.add("drop-projection");
      projection.removeAttribute("id");
      projection.setAttribute("aria-hidden", "true");
      projection.style.left = "";
      projection.style.top = "";
      projection.style.position = "";
      projection.style.transform = "";
      projection.style.zIndex = "";

      projection.querySelectorAll("[id]").forEach(item => item.removeAttribute("id"));
      projection.querySelectorAll(".ghost, .drag-source-placeholder").forEach(item => {
        item.classList.remove("ghost", "drag-source-placeholder");
      });
      projection.querySelectorAll(".grab-marked, .erase-marked").forEach(item => {
        item.classList.remove("grab-marked", "erase-marked");
      });
      projection.querySelectorAll(".sequence-zone").forEach(item => {
        item.classList.remove("sequence-zone", "drag-over");
        delete item.dataset.sequencePath;
      });

      return projection;
    }

    function createProjectionSourceElement() {
      if (dragState.fromProgram) return dragState.source;

      const item = createProgramItem(dragState.cardId);
      return createProgramNode(item, []);
    }

    function isSameDropTarget(a, b) {
      if (!a && !b) return true;
      if (!a || !b) return false;
      return a.zone === b.zone && a.index === b.index && pathsEqual(a.sequencePath, b.sequencePath);
    }

    function clearDropHints() {
      document.querySelectorAll(".sequence-zone.drag-over").forEach(zone => {
        zone.classList.remove("drag-over");
      });
      removeMarker();
    }

    function removeMarker() {
      document.querySelectorAll(".drop-projection").forEach(el => el.remove());
    }

    function moveGhost(x, y) {
      if (!dragState) return;
      dragState.ghost.style.left = `${x}px`;
      dragState.ghost.style.top = `${y}px`;
    }

    function getDropIndex(zone, pointerX) {
      const blocks = getDirectProgramBlocks(zone);
      for (let i = 0; i < blocks.length; i++) {
        const rect = blocks[i].getBoundingClientRect();
        if (pointerX < rect.left + rect.width / 2) return i;
      }
      return blocks.length;
    }

    function getDirectProgramBlocks(zone) {
      return [...zone.children].filter(child => (
        child.classList.contains("program-block") &&
        !child.classList.contains("drop-projection")
      ));
    }

    function getDirectEmptyNote(zone) {
      return [...zone.children].find(child => (
        child.classList.contains("empty-note") ||
        child.classList.contains("loop-empty-note")
      ));
    }

    function scheduleProgramAnchorUpdate() {
      if (dragState || programAnchorFrame) return;
      programAnchorFrame = requestAnimationFrame(() => {
        programAnchorFrame = null;
        updateProgramAnchor();
      });
    }

    function updateProgramAnchor() {
      if (dragState) return;
      const programHeight = programArea.clientHeight;
      if (!programHeight) return;

      const startHeight = startBlock.offsetHeight || 72;
      const layoutItems = [...chain.children].filter(child => (
        !child.classList.contains("drop-projection") &&
        getComputedStyle(child).display !== "none"
      ));
      const maxItemHeight = Math.max(
        startHeight,
        ...layoutItems.map(item => item.offsetHeight || item.getBoundingClientRect().height)
      );
      const anchorY = programHeight * 0.6;
      const minTopSpace = 16;
      const minBottomSpace = 48;
      const topSpace = Math.max(minTopSpace, anchorY - maxItemHeight + startHeight / 2);
      const bottomSpace = Math.max(minBottomSpace, programHeight - topSpace - maxItemHeight);

      chain.style.setProperty("--chain-pad-top", `${Math.round(topSpace)}px`);
      chain.style.setProperty("--chain-pad-bottom", `${Math.round(bottomSpace)}px`);
    }

    function isPointInDeleteZone(x, y) {
      const rect = deleteOverlay.getBoundingClientRect();
      return isPointInRect(x, y, rect);
    }

    function isPointInRootDropArea(x, y) {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
      return ![topbar, libraryArea, tabs].some(element => (
        element && isPointInRect(x, y, element.getBoundingClientRect())
      ));
    }

    function isPointInRect(x, y, rect) {
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function rectsIntersect(a, b) {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    function moveProgramNode(sourcePath, targetSequencePath, targetIndex) {
      if (!sourcePath) return;

      const sourceParentPath = sourcePath.slice(0, -1);
      const sourceIndex = sourcePath[sourcePath.length - 1];
      const sameSequence = pathsEqual(sourceParentPath, targetSequencePath);
      const item = removeNodeAtPath(sourcePath);
      if (!item) return;

      const nextTargetPath = sameSequence
        ? targetSequencePath
        : adjustSequencePathAfterRemoval(targetSequencePath, sourcePath);
      const nextIndex = sameSequence && targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
      insertNodeAtPath(nextTargetPath, nextIndex, item);
    }

    function moveProgramNodes(sourcePaths, targetSequencePath, targetIndex) {
      if (!sourcePaths?.length) return false;

      const sortedSourcePaths = [...sourcePaths].sort(comparePathsAscending);
      const sourceParentPath = sortedSourcePaths[0].slice(0, -1);
      const sameSourceSequence = sortedSourcePaths.every(path => pathsEqual(path.slice(0, -1), sourceParentPath));
      if (!sameSourceSequence) return false;

      const sourceSequence = getSequenceByPath(sourceParentPath);
      if (!sourceSequence) return false;

      const sourceIndices = sortedSourcePaths.map(path => path[path.length - 1]);
      const items = sourceIndices
        .map(index => sourceSequence[index])
        .filter(Boolean);
      if (!items.length) return false;

      [...sourceIndices].sort((a, b) => b - a).forEach(index => {
        sourceSequence.splice(index, 1);
      });

      const sameTargetSequence = pathsEqual(sourceParentPath, targetSequencePath);
      const nextTargetPath = sameTargetSequence
        ? targetSequencePath
        : adjustSequencePathAfterMultipleRemoval(targetSequencePath, sortedSourcePaths);
      const removedBeforeTarget = sameTargetSequence
        ? sourceIndices.filter(index => index < targetIndex).length
        : 0;
      const nextIndex = targetIndex - removedBeforeTarget;
      const targetSequence = getSequenceByPath(nextTargetPath);
      if (!targetSequence) return false;

      targetSequence.splice(clampIndex(nextIndex, targetSequence.length), 0, ...items);
      return true;
    }

    function insertNodeAtPath(sequencePath, index, item) {
      const sequence = getSequenceByPath(sequencePath);
      if (!sequence || !item) return false;
      sequence.splice(clampIndex(index, sequence.length), 0, item);
      return true;
    }

    function removeNodeAtPath(nodePath) {
      if (!nodePath?.length) return null;
      const parentSequence = getSequenceByPath(nodePath.slice(0, -1));
      const index = nodePath[nodePath.length - 1];
      if (!parentSequence || index < 0 || index >= parentSequence.length) return null;
      return parentSequence.splice(index, 1)[0];
    }

    function getSequenceByPath(sequencePath) {
      if (!sequencePath?.length) return program;
      const container = getNodeAtPath(sequencePath);
      if (!container || cardById[container.id]?.kind !== "loop") return null;
      if (!Array.isArray(container.children)) container.children = [];
      return container.children;
    }

    function getNodeAtPath(nodePath) {
      let sequence = program;
      let node = null;

      for (const index of nodePath) {
        node = sequence[index];
        if (!node) return null;
        sequence = Array.isArray(node.children) ? node.children : [];
      }

      return node;
    }

    function isSequenceInsideDraggedItem(sequencePath) {
      if (!dragState?.fromProgram || !dragState.sourcePath) return false;
      const draggedPaths = dragState.grabMovePaths?.length
        ? dragState.grabMovePaths
        : [dragState.sourcePath];
      return draggedPaths.some(path => startsWithPath(sequencePath, path));
    }

    function adjustSequencePathAfterRemoval(sequencePath, removedNodePath) {
      const adjusted = [...sequencePath];
      const removedParentPath = removedNodePath.slice(0, -1);
      const removedIndex = removedNodePath[removedNodePath.length - 1];

      if (
        adjusted.length > removedParentPath.length &&
        pathsEqual(adjusted.slice(0, removedParentPath.length), removedParentPath) &&
        adjusted[removedParentPath.length] > removedIndex
      ) {
        adjusted[removedParentPath.length] -= 1;
      }

      return adjusted;
    }

    function adjustSequencePathAfterMultipleRemoval(sequencePath, removedNodePaths) {
      return [...removedNodePaths]
        .sort(comparePathsForRemoval)
        .reduce((adjustedPath, removedPath) => adjustSequencePathAfterRemoval(adjustedPath, removedPath), [...sequencePath]);
    }

    function normalizeSequence(rawSequence) {
      if (!Array.isArray(rawSequence)) return [];
      return rawSequence.map(normalizeItem).filter(Boolean);
    }

    function normalizeItem(rawItem) {
      const card = cardById[rawItem?.id];
      if (!card) return null;

      const item = {
        id: card.id,
        uid: rawItem.uid || `${card.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      };
      if (card.paramsSchema) item.params = normalizeParams(card, rawItem.params);
      if (card.kind === "loop") item.children = normalizeSequence(rawItem.children);
      return item;
    }

    function serializeSequence(sequence) {
      return sequence.map(item => {
        const card = cardById[item.id];
        const stored = { id: item.id, uid: item.uid };
        if (card?.paramsSchema) stored.params = normalizeParams(card, item.params);
        if (card?.kind === "loop") {
          stored.children = serializeSequence(item.children || []);
        }
        return stored;
      });
    }

    function getProgramSnapshot() {
      return JSON.stringify(serializeSequence(program));
    }

    function restoreProgramSnapshot(snapshot) {
      try {
        program = normalizeSequence(JSON.parse(snapshot));
        renderProgram();
      } catch {
        setStatus("历史记录恢复失败");
      }
    }

    function commitHistory() {
      const snapshot = getProgramSnapshot();
      if (historySnapshots[historyIndex] === snapshot) {
        updateHistoryButtons();
        return;
      }

      historySnapshots = historySnapshots.slice(0, historyIndex + 1);
      historySnapshots.push(snapshot);

      if (historySnapshots.length > HISTORY_LIMIT) {
        historySnapshots.shift();
      }

      historyIndex = historySnapshots.length - 1;
      updateHistoryButtons();
    }

    function undoProgram() {
      if (historyIndex <= 0) return;
      historyIndex -= 1;
      restoreProgramSnapshot(historySnapshots[historyIndex]);
      updateHistoryButtons();
      setStatus("已撤销");
    }

    function redoProgram() {
      if (historyIndex < 0 || historyIndex >= historySnapshots.length - 1) return;
      historyIndex += 1;
      restoreProgramSnapshot(historySnapshots[historyIndex]);
      updateHistoryButtons();
      setStatus("已前进");
    }

    function updateHistoryButtons() {
      undoBtn.disabled = historyIndex <= 0;
      redoBtn.disabled = historyIndex < 0 || historyIndex >= historySnapshots.length - 1;
    }

    function saveProgram() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSequence(program)));
      setStatus("已保存");
    }

    function loadProgram() {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) {
        setStatus("没有保存内容");
        return;
      }

      try {
        program = normalizeSequence(JSON.parse(raw));
        renderProgram();
        commitHistory();
        setStatus("已读取");
      } catch {
        setStatus("读取失败");
      }
    }

    function getNodeLabel(item) {
      return cardById[item.id]?.label || "卡片";
    }

    function pathToKey(path) {
      return path.join(".");
    }

    function keyToPath(key = "") {
      if (!key) return [];
      return key.split(".").map(Number).filter(Number.isInteger);
    }

    function pathsEqual(a, b) {
      return a.length === b.length && a.every((value, index) => value === b[index]);
    }

    function startsWithPath(path, prefix) {
      return path.length >= prefix.length && prefix.every((value, index) => value === path[index]);
    }

    function clampIndex(index, length) {
      return Math.max(0, Math.min(index, length));
    }

    function setStatus(text) {
      statusEl.textContent = text;
    }

    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        activeCategory = tab.id.replace("tab-", "");
        document.querySelectorAll(".tab").forEach(item => item.setAttribute("aria-selected", "false"));
        tab.setAttribute("aria-selected", "true");
        renderPalette();
      });
    });

    document.getElementById("saveBtn").addEventListener("click", saveProgram);
    document.getElementById("loadBtn").addEventListener("click", loadProgram);
    undoBtn.addEventListener("click", undoProgram);
    redoBtn.addEventListener("click", redoProgram);
    document.getElementById("clearBtn").addEventListener("click", () => {
      closeParamEditor();
      cancelEraseSelection(false);
      program = [];
      renderProgram();
      commitHistory();
      setStatus("已清空");
    });

    grabTool.addEventListener("pointerdown", startGrabToolDrag);
    eraserTool.addEventListener("pointerdown", startEraserDrag);
    eraseOkBtn.addEventListener("click", deleteMarkedCards);
    eraseCancelBtn.addEventListener("click", () => cancelEraseSelection());
    eraseConfirm.addEventListener("pointerdown", event => {
      event.stopPropagation();
    });

    paramEditor.addEventListener("pointerdown", event => {
      event.stopPropagation();
    });

    document.addEventListener("pointerdown", event => {
      if (paramEditor.hidden) return;
      if (paramEditor.contains(event.target)) return;
      if (event.target.closest(".icon-card.program-block")) return;
      closeParamEditor();
    }, true);

    window.addEventListener("resize", () => {
      scheduleProgramAnchorUpdate();
      if (activeParamEditor) {
        positionParamEditor(findProgramBlockByPath(activeParamEditor.nodePath));
      }
    });
    if ("ResizeObserver" in window) {
      new ResizeObserver(scheduleProgramAnchorUpdate).observe(programArea);
    }

    renderPalette();
    renderProgram();
    commitHistory();
