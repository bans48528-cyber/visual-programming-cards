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
    const appElement = document.querySelector(".app");
    const topbar = document.querySelector(".topbar");
    const libraryArea = document.querySelector(".library-area");
    const tabs = document.querySelector(".tabs");
    const startBlock = document.getElementById("startBlock");
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    const paramEditor = document.getElementById("paramEditor");
    const grabTool = document.getElementById("grabTool");
    const stagingTab = document.getElementById("tab-staging");
    const stagingScrollStrip = document.getElementById("stagingScrollStrip");

    let activeCategory = "action";
    let program = [];
    let stagedGroups = [];
    let dragState = null;
    let grabToolState = null;
    let grabMarkedPaths = new Set();
    let stagingHoverTimer = null;
    let stagingPanState = null;
    let blankGrabPending = null;
    let programAnchorFrame = null;
    let activeParamEditor = null;
    let historySnapshots = [];
    let historyIndex = -1;
    const HISTORY_LIMIT = 80;
    const STAGING_HOVER_DELAY = 1000;
    const BLANK_GRAB_HOLD_DELAY = 500;
    const BLANK_GRAB_MOVE_LIMIT = 10;

    function renderPalette() {
      palette.innerHTML = "";
      palette.classList.toggle("is-staging", activeCategory === "staging");
      libraryArea.classList.toggle("is-staging", activeCategory === "staging");
      if (activeCategory === "staging") {
        stagedGroups.forEach(group => palette.appendChild(createStagedGroupElement(group)));
        return;
      }

      categories[activeCategory].cards.forEach(card => {
        const block = createBlock(card, "palette");
        palette.appendChild(block);
      });
    }

    function selectCategory(category) {
      activeCategory = category;
      document.querySelectorAll(".tab").forEach(tab => {
        tab.setAttribute("aria-selected", String(tab.id === `tab-${category}`));
      });
      renderPalette();
    }

    function createStagedGroupElement(group) {
      const element = document.createElement("div");
      element.className = "staged-group";
      element.dataset.mode = "staging";
      element.dataset.stagedGroupId = group.id;
      element.dataset.dragged = "false";
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", `暂存组合，${countProgramItems(group.items)}张卡片`);
      const preview = document.createElement("div");
      preview.className = "staged-group-preview";
      group.items.forEach(item => preview.appendChild(createStagedPreviewNode(item)));
      element.appendChild(preview);
      element.addEventListener("pointerdown", startDrag);
      return element;
    }

    function createStagedPreviewNode(item) {
      const preview = createProgramNode(item, []).cloneNode(true);
      cleanupClonedProgramBlock(preview);
      preview.setAttribute("aria-hidden", "true");
      delete preview.dataset.mode;
      delete preview.dataset.nodePath;
      preview.querySelectorAll(".sequence-zone").forEach(zone => {
        zone.classList.remove("sequence-zone", "drag-over");
        delete zone.dataset.sequencePath;
      });
      return preview;
    }

    function createStagedGroupDragGhost(items) {
      const ghost = document.createElement("div");
      ghost.className = "staged-group staged-group-drag-preview";
      const preview = document.createElement("div");
      preview.className = "staged-group-preview";
      items.forEach(item => preview.appendChild(createStagedPreviewNode(item)));
      ghost.appendChild(preview);
      return ghost;
    }

    function renderProgram() {
      closeParamEditor();
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
          const isProgramControl = mode === "program";
          const bubble = document.createElement(isProgramControl ? "button" : "span");
          bubble.className = "param-bubble";
          bubble.classList.toggle("matrix-param-trigger", card.id === "matrix-display");
          bubble.textContent = getParamBubbleText(card, item);

          if (isProgramControl) {
            bubble.type = "button";
            bubble.setAttribute("aria-label", `编辑${card.actionName || card.label}参数`);
            let lastTouchOpenTime = 0;
            bubble.addEventListener("pointerdown", event => {
              event.stopPropagation();
            });
            bubble.addEventListener("pointerup", event => {
              event.stopPropagation();
              if (event.pointerType === "mouse") return;
              event.preventDefault();
              lastTouchOpenTime = performance.now();
              openParamEditor(nodePath, bubble);
            });
            bubble.addEventListener("click", event => {
              event.preventDefault();
              event.stopPropagation();
              if (performance.now() - lastTouchOpenTime < 700) return;
              openParamEditor(nodePath, bubble);
            });
          } else {
            bubble.setAttribute("aria-hidden", "true");
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
        return "";
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
      paramEditor.classList.toggle("is-matrix", card.id === "matrix-display");

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

      const current = document.createElement("label");
      current.className = "param-current";
      const input = document.createElement("input");
      input.className = "param-value-input";
      input.type = "text";
      input.inputMode = definition.integer ? "numeric" : "decimal";
      input.value = formatParamNumber(value);
      input.setAttribute("aria-label", definition.label || "参数值");
      input.autocomplete = "off";
      input.spellcheck = false;

      const unit = document.createElement("span");
      unit.className = "param-unit";
      unit.textContent = definition.unit || "";
      current.append(input, unit);

      const plus = document.createElement("button");
      plus.className = "param-step-btn";
      plus.type = "button";
      plus.textContent = "+";
      plus.setAttribute("aria-label", increaseLabel);
      plus.disabled = value >= definition.max;
      plus.addEventListener("click", () => adjustActiveNumberParam(key, 1));

      const commitInput = () => {
        if (!activeParamEditor) return;
        const rawValue = input.value.trim();
        const nextValue = normalizeParamValue(
          definition,
          rawValue === "" ? definition.default : rawValue.replace(",", ".")
        );
        const currentValue = getParamValue(card, getNodeAtPath(activeParamEditor.nodePath), key);
        input.value = formatParamNumber(nextValue);
        minus.disabled = nextValue <= definition.min;
        plus.disabled = nextValue >= definition.max;
        if (nextValue === currentValue) return;
        setActiveParamValue(key, nextValue, false);
      };

      input.addEventListener("blur", commitInput);
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        } else if (event.key === "Escape") {
          input.value = formatParamNumber(getParamValue(card, getNodeAtPath(activeParamEditor.nodePath), key));
          input.blur();
        }
      });

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

    function setActiveParamValue(key, value, rerenderEditor = true) {
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
      if (rerenderEditor) {
        renderParamEditor(block);
      } else {
        positionParamEditor(block);
      }
      commitHistory();
      setStatus(`${getCardDisplayLabel(card, item)}`);
      return next;
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

      const block = anchor.closest?.(".program-block") || anchor;
      const control = anchor.matches?.(".param-bubble")
        ? anchor
        : block.querySelector?.(".param-bubble") || anchor;
      const anchorRect = control.getBoundingClientRect();
      const editorRect = paramEditor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const gap = 14;
      const margin = 8;
      let left = anchorRect.left + anchorRect.width / 2 - editorRect.width / 2;
      const belowTop = anchorRect.bottom + gap;
      const aboveTop = anchorRect.top - editorRect.height - gap;
      const fitsBelow = belowTop + editorRect.height <= viewportBottom - margin;
      const fitsAbove = aboveTop >= viewportTop + margin;
      const placeAbove = !fitsBelow && (fitsAbove || anchorRect.top - viewportTop > viewportBottom - anchorRect.bottom);
      let top = placeAbove ? aboveTop : belowTop;

      left = Math.max(viewportLeft + margin, Math.min(
        left,
        viewportRight - editorRect.width - margin
      ));
      const maxTop = Math.max(viewportTop + margin, viewportBottom - editorRect.height - margin);
      top = Math.max(viewportTop + margin, Math.min(top, maxTop));

      paramEditor.classList.toggle("is-above-anchor", placeAbove);
      const arrowLeft = Math.max(16, Math.min(
        anchorRect.left + anchorRect.width / 2 - left,
        editorRect.width - 16
      ));
      paramEditor.style.setProperty("--param-arrow-left", `${Math.round(arrowLeft)}px`);

      paramEditor.style.left = `${Math.round(left)}px`;
      paramEditor.style.top = `${Math.round(top)}px`;
    }

    function closeParamEditor() {
      activeParamEditor = null;
      paramEditor.hidden = true;
      paramEditor.classList.remove("is-matrix", "is-above-anchor");
      paramEditor.style.removeProperty("--param-arrow-left");
      paramEditor.replaceChildren();
    }

    function setDeleteOverlayVisible(visible) {
      deleteOverlay.classList.toggle("is-visible", visible);
      deleteOverlay.classList.remove("is-hot", "is-staging");
      deleteOverlay.textContent = "在此松手进行删除";
      deleteOverlay.setAttribute("aria-hidden", String(!visible));
    }

    function setLibraryOverlayMode(mode) {
      const isStaging = mode === "staging";
      deleteOverlay.classList.toggle("is-staging", isStaging);
      deleteOverlay.textContent = isStaging ? "暂存组合" : "在此松手进行删除";
    }

    function canStageCurrentDrag() {
      if (!dragState?.fromProgram || !dragState.grabMovePaths?.length) return false;
      const items = dragState.grabMovePaths.map(getNodeAtPath).filter(Boolean);
      return items.length === dragState.grabMovePaths.length && countProgramItems(items) > 1;
    }

    function isPointOverLibraryArea(x, y) {
      return [libraryArea, tabs].some(element => (
        isPointInRect(x, y, element.getBoundingClientRect())
      ));
    }

    function isPointInStagingZone(x, y) {
      return canStageCurrentDrag()
        && activeCategory === "staging"
        && isPointOverLibraryArea(x, y);
    }

    function updateStagingAreaHover(x, y) {
      const overLibrary = isPointOverLibraryArea(x, y);
      if (!canStageCurrentDrag()) {
        clearStagingAreaHover();
        return;
      }

      if (dragState.autoSwitchedToStaging) {
        if (!overLibrary) restoreCategoryAfterStagingExit();
        clearStagingAreaHover();
        return;
      }

      if (activeCategory === "staging" || !overLibrary) {
        clearStagingAreaHover();
        return;
      }

      stagingTab.classList.add("is-drop-hover");
      if (stagingHoverTimer) return;
      stagingHoverTimer = setTimeout(() => {
        stagingHoverTimer = null;
        if (!dragState || !canStageCurrentDrag()) return;
        if (!isPointOverLibraryArea(dragState.lastX, dragState.lastY)) return;
        stagingTab.classList.remove("is-drop-hover");
        dragState.stagingReturnCategory = activeCategory;
        dragState.autoSwitchedToStaging = true;
        selectCategory("staging");
        setLibraryOverlayMode("staging");
      }, STAGING_HOVER_DELAY);
    }

    function restoreCategoryAfterStagingExit() {
      if (!dragState?.autoSwitchedToStaging) return;
      const returnCategory = dragState.stagingReturnCategory;
      dragState.autoSwitchedToStaging = false;
      dragState.stagingReturnCategory = null;
      if (returnCategory && returnCategory !== "staging") selectCategory(returnCategory);
      setLibraryOverlayMode("delete");
    }

    function clearStagingAreaHover() {
      if (stagingHoverTimer) {
        clearTimeout(stagingHoverTimer);
        stagingHoverTimer = null;
      }
      stagingTab.classList.remove("is-drop-hover");
    }

    function startDrag(event) {
      if (event.button > 0) return;
      event.preventDefault();
      event.stopPropagation();

      if (dragState || grabToolState || (event.pointerType === "touch" && event.isPrimary === false)) {
        return;
      }

      closeParamEditor();
      removeOrphanGhosts();

      const source = event.currentTarget;
      source.dataset.dragged = "false";
      const rect = source.getBoundingClientRect();
      const cardId = source.dataset.cardId;
      const fromProgram = source.dataset.mode === "program";
      const fromStaging = source.dataset.mode === "staging";
      const stagedGroup = fromStaging
        ? stagedGroups.find(group => group.id === source.dataset.stagedGroupId)
        : null;
      if (fromStaging && !stagedGroup) return;
      const sourcePath = fromProgram ? keyToPath(source.dataset.nodePath) : null;
      const grabMovePaths = getGrabMovePathsForSource(sourcePath);
      const isGroupDrag = grabMovePaths.length > 1;
      const placeholderSources = fromProgram
        ? (isGroupDrag ? getBlocksByPaths(grabMovePaths) : [source])
        : [];
      if (fromProgram && grabMarkedPaths.size) {
        clearGrabSelection(false);
      }
      const ghost = fromStaging
        ? createStagedGroupDragGhost(stagedGroup.items)
        : (isGroupDrag ? createGrabGroupGhost(grabMovePaths) : source.cloneNode(true));
      const ghostRect = isGroupDrag ? getElementsUnionRect(placeholderSources) : rect;

      if (fromProgram) {
        placeholderSources.forEach(block => block.classList.add("drag-source-placeholder"));
        setDeleteOverlayVisible(true);
      }

      ghost.classList.add("ghost");
      if (!fromStaging) {
        ghost.style.width = `${ghostRect.width}px`;
        ghost.style.height = `${ghostRect.height}px`;
      }
      document.body.appendChild(ghost);

      dragState = {
        source,
        cardId,
        fromProgram,
        fromStaging,
        stagedGroupId: stagedGroup?.id || null,
        stagedItems: stagedGroup?.items || null,
        sourcePath,
        grabMovePaths,
        placeholderSources,
        ghost,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        autoSwitchedToStaging: false,
        stagingReturnCategory: null,
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
      dragState.lastX = event.clientX;
      dragState.lastY = event.clientY;
      moveGhost(event.clientX, event.clientY);

      updateStagingAreaHover(event.clientX, event.clientY);
      const overStaging = isPointInStagingZone(event.clientX, event.clientY);
      const overDelete = dragState.fromProgram && !overStaging
        && isPointInDeleteZone(event.clientX, event.clientY);
      setLibraryOverlayMode(!overDelete && canStageCurrentDrag() && activeCategory === "staging"
        ? "staging"
        : "delete");
      deleteOverlay.classList.toggle("is-hot", overDelete);

      if (overStaging || overDelete) {
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

      if (dragState.autoSwitchedToStaging && !isPointOverLibraryArea(event.clientX, event.clientY)) {
        restoreCategoryAfterStagingExit();
      }

      const movedEnough = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 8;
      const inStagingZone = isPointInStagingZone(event.clientX, event.clientY);
      const inDeleteZone = dragState.fromProgram && !inStagingZone
        && isPointInDeleteZone(event.clientX, event.clientY);
      const target = (inStagingZone || inDeleteZone)
        ? null
        : findDropTarget(event.clientX, event.clientY);
      const {
        cardId,
        fromProgram,
        fromStaging,
        stagedGroupId,
        stagedItems,
        source,
        sourcePath,
        grabMovePaths
      } = dragState;

      cleanupDrag(event);

      if (!movedEnough) {
        setTimeout(() => { source.dataset.dragged = "false"; }, 0);
        return;
      }

      if (fromProgram && inStagingZone) {
        const items = takeProgramNodes(grabMovePaths);
        const itemCount = countProgramItems(items);
        if (itemCount > 1) {
          stagedGroups.push({
            id: `staged-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            items
          });
          renderProgram();
          renderPalette();
          commitHistory();
          setStatus(`已暂存 ${itemCount} 张卡片`);
        }
        setTimeout(() => { source.dataset.dragged = "false"; }, 0);
        return;
      }

      if (fromProgram && inDeleteZone) {
        const pathsToRemove = grabMovePaths?.length ? grabMovePaths : [sourcePath];
        const removedItems = [...pathsToRemove]
          .sort(comparePathsForRemoval)
          .map(removeNodeAtPath)
          .filter(Boolean);
        if (removedItems.length) {
          renderProgram();
          commitHistory();
          setStatus(removedItems.length > 1
            ? `已删除 ${removedItems.length} 张卡片`
            : `已删除：${getNodeLabel(removedItems[0])}`);
        }
        setTimeout(() => { source.dataset.dragged = "false"; }, 0);
        return;
      }

      if (fromStaging) {
        if (target && insertNodesAtPath(target.sequencePath, target.index, stagedItems)) {
          stagedGroups = stagedGroups.filter(group => group.id !== stagedGroupId);
          renderProgram();
          renderPalette();
          commitHistory();
          setStatus(`已放回 ${countProgramItems(stagedItems)} 张卡片`);
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
      clearStagingAreaHover();
      clearDropHints();
      restoreDragScroll();
      setDragScrollLocked(false);
      dragState = null;
    }

    function isProgramBlankTarget(target) {
      return target instanceof Element
        && programArea.contains(target)
        && !target.closest(".program-block, #startBlock, #grabTool, button");
    }

    function startBlankGrabHold(event) {
      if (!isProgramBlankTarget(event.target)) return;
      if (event.button > 0 || dragState || grabToolState || blankGrabPending) return;
      if (event.pointerType === "touch" && event.isPrimary === false) return;

      blankGrabPending = {
        pointerId: event.pointerId,
        pointerEvent: event,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        scrollLeft: programCanvas.scrollLeft,
        scrollTop: programCanvas.scrollTop,
        moved: false,
        timer: setTimeout(() => activateBlankGrab(event.pointerId), BLANK_GRAB_HOLD_DELAY)
      };

      document.addEventListener("pointermove", moveBlankGrabHold);
      document.addEventListener("pointerup", endBlankGrabHold);
      document.addEventListener("pointercancel", cancelBlankGrabHold);
    }

    function moveBlankGrabHold(event) {
      if (!blankGrabPending || event.pointerId !== blankGrabPending.pointerId) return;
      blankGrabPending.lastX = event.clientX;
      blankGrabPending.lastY = event.clientY;
      const distance = Math.hypot(
        event.clientX - blankGrabPending.startX,
        event.clientY - blankGrabPending.startY
      );
      if (!blankGrabPending.moved) {
        if (distance <= BLANK_GRAB_MOVE_LIMIT) return;
        blankGrabPending.moved = true;
        clearTimeout(blankGrabPending.timer);
        blankGrabPending.timer = null;
        programCanvas.classList.add("is-panning");
      }

      event.preventDefault();
      programCanvas.scrollLeft = blankGrabPending.scrollLeft
        + blankGrabPending.startX - event.clientX;
      programCanvas.scrollTop = blankGrabPending.scrollTop
        + blankGrabPending.startY - event.clientY;
    }

    function endBlankGrabHold(event) {
      if (!blankGrabPending || event.pointerId !== blankGrabPending.pointerId) return;
      const wasTap = !blankGrabPending.moved;
      cleanupBlankGrabHold();
      if (wasTap && grabMarkedPaths.size) clearGrabSelection();
    }

    function cancelBlankGrabHold(event) {
      if (!blankGrabPending || event.pointerId !== blankGrabPending.pointerId) return;
      cleanupBlankGrabHold();
    }

    function activateBlankGrab(pointerId) {
      if (!blankGrabPending || blankGrabPending.pointerId !== pointerId) return;
      const { pointerEvent, lastX, lastY } = blankGrabPending;
      cleanupBlankGrabHold();
      startGrabToolDrag(pointerEvent, true, { x: lastX, y: lastY });
      if (grabToolState) setStatus("合并抓手已启动，拖过卡片进行合并");
    }

    function cleanupBlankGrabHold() {
      if (!blankGrabPending) return;
      clearTimeout(blankGrabPending.timer);
      document.removeEventListener("pointermove", moveBlankGrabHold);
      document.removeEventListener("pointerup", endBlankGrabHold);
      document.removeEventListener("pointercancel", cancelBlankGrabHold);
      programCanvas.classList.remove("is-panning");
      blankGrabPending = null;
    }

    function startGrabToolDrag(event, startAtPointer = false, pointerPosition = null) {
      if (event.button > 0) return;
      event.preventDefault();
      event.stopPropagation();

      if (dragState || grabToolState || (event.pointerType === "touch" && event.isPrimary === false)) {
        return;
      }

      closeParamEditor();

      const rect = grabTool.getBoundingClientRect();
      const pointerSource = startAtPointer ? programArea : grabTool;
      const pointerX = pointerPosition?.x ?? event.clientX;
      const pointerY = pointerPosition?.y ?? event.clientY;
      const left = startAtPointer ? pointerX - rect.width / 2 : rect.left;
      const top = startAtPointer ? pointerY - rect.height / 2 : rect.top;
      grabToolState = {
        pointerId: event.pointerId,
        startX: pointerX,
        startY: pointerY,
        offsetX: pointerX - left,
        offsetY: pointerY - top,
        pointerSource,
        moved: false,
        touchedPathKeys: new Set()
      };

      grabTool.classList.add("is-dragging");
      grabTool.style.position = "fixed";
      grabTool.style.left = `${left}px`;
      grabTool.style.top = `${top}px`;
      grabTool.style.right = "auto";
      grabTool.style.width = `${rect.width}px`;
      grabTool.style.height = `${rect.height}px`;

      setDragScrollLocked(true);
      pointerSource.setPointerCapture?.(event.pointerId);
      pointerSource.addEventListener("pointermove", moveGrabToolDrag);
      pointerSource.addEventListener("pointerup", endGrabToolDrag);
      pointerSource.addEventListener("pointercancel", cancelGrabToolDrag);
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

      const { pointerSource } = grabToolState;
      pointerSource.removeEventListener("pointermove", moveGrabToolDrag);
      pointerSource.removeEventListener("pointerup", endGrabToolDrag);
      pointerSource.removeEventListener("pointercancel", cancelGrabToolDrag);
      if (pointerSource.hasPointerCapture?.(grabToolState.pointerId)) {
        pointerSource.releasePointerCapture(grabToolState.pointerId);
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

    function startStagingPan(event) {
      if (event.button > 0 || activeCategory !== "staging" || dragState || grabToolState) return;
      event.preventDefault();
      event.stopPropagation();

      stagingPanState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        scrollLeft: palette.scrollLeft
      };
      stagingScrollStrip.classList.add("is-panning");
      stagingScrollStrip.setPointerCapture?.(event.pointerId);
      stagingScrollStrip.addEventListener("pointermove", moveStagingPan);
      stagingScrollStrip.addEventListener("pointerup", endStagingPan);
      stagingScrollStrip.addEventListener("pointercancel", endStagingPan);
    }

    function moveStagingPan(event) {
      if (!stagingPanState || event.pointerId !== stagingPanState.pointerId) return;
      event.preventDefault();
      palette.scrollLeft = stagingPanState.scrollLeft + stagingPanState.startX - event.clientX;
    }

    function endStagingPan(event) {
      if (!stagingPanState || event.pointerId !== stagingPanState.pointerId) return;
      stagingScrollStrip.removeEventListener("pointermove", moveStagingPan);
      stagingScrollStrip.removeEventListener("pointerup", endStagingPan);
      stagingScrollStrip.removeEventListener("pointercancel", endStagingPan);
      if (stagingScrollStrip.hasPointerCapture?.(stagingPanState.pointerId)) {
        stagingScrollStrip.releasePointerCapture(stagingPanState.pointerId);
      }
      stagingScrollStrip.classList.remove("is-panning");
      stagingPanState = null;
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

      getGrabbableBlocks().forEach(block => {
        if (!isBlockTouchedByGrabTool(block, grabRect)) return;

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

    function getGrabbableBlocks() {
      return [...document.querySelectorAll(".program-block:not(.drop-projection)")];
    }

    function isBlockTouchedByGrabTool(block, grabRect) {
      if (block.classList.contains("loop-block")) {
        const loopFrameParts = [...block.children].filter(child => (
          child.classList.contains("loop-top") ||
          child.classList.contains("loop-left") ||
          child.classList.contains("loop-tail")
        ));
        return loopFrameParts.some(part => rectsIntersect(grabRect, part.getBoundingClientRect()));
      }

      return rectsIntersect(grabRect, block.getBoundingClientRect());
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

    function clearGrabSelectionOnOutsidePointerDown(event) {
      if (!grabMarkedPaths.size) return;
      if (dragState || grabToolState) return;
      if (event.button > 0) return;
      if (event.pointerType === "touch" && event.isPrimary === false) return;

      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest(".program-block.grab-marked")) return;
      if (target.closest("#grabTool, #paramEditor")) return;
      if (isProgramBlankTarget(target)) return;

      clearGrabSelection();
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
      clone.classList.remove("grab-marked", "drag-source-placeholder", "ghost", "drop-projection");
      clone.querySelectorAll(".grab-marked, .drag-source-placeholder, .ghost, .drop-projection").forEach(item => {
        item.classList.remove("grab-marked", "drag-source-placeholder", "ghost", "drop-projection");
      });
      clone.querySelectorAll("[id]").forEach(item => item.removeAttribute("id"));
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
      if (dragState || grabToolState) event.preventDefault();
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
      const projection = dragState.fromStaging
        ? createStagedItemsProjection(dragState.stagedItems)
        : (dragState.grabMovePaths?.length > 1
          ? createGrabGroupProjection(dragState.grabMovePaths)
          : createProjectionSourceElement().cloneNode(true));
      projection.classList.remove("ghost", "drag-source-placeholder", "grab-marked");
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
      projection.querySelectorAll(".grab-marked").forEach(item => {
        item.classList.remove("grab-marked");
      });
      projection.querySelectorAll(".sequence-zone").forEach(item => {
        item.classList.remove("sequence-zone", "drag-over");
        delete item.dataset.sequencePath;
      });

      return projection;
    }

    function createStagedItemsProjection(items) {
      const group = document.createElement("div");
      group.className = "grab-group-projection program-block";
      items.forEach(item => group.appendChild(createStagedPreviewNode(item)));
      return group;
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

    function takeProgramNodes(sourcePaths) {
      if (!sourcePaths?.length) return [];
      const sortedPaths = [...sourcePaths].sort(comparePathsAscending);
      const items = sortedPaths.map(getNodeAtPath).filter(Boolean);
      if (items.length !== sortedPaths.length) return [];

      [...sortedPaths].sort(comparePathsForRemoval).forEach(removeNodeAtPath);
      return items;
    }

    function insertNodesAtPath(sequencePath, index, items) {
      const sequence = getSequenceByPath(sequencePath);
      if (!sequence || !items?.length) return false;
      sequence.splice(clampIndex(index, sequence.length), 0, ...items);
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

    function serializeWorkspaceState() {
      return {
        program: serializeSequence(program),
        stagedGroups: stagedGroups.map(group => ({
          id: group.id,
          items: serializeSequence(group.items)
        }))
      };
    }

    function applyWorkspaceState(rawState) {
      if (Array.isArray(rawState)) {
        program = normalizeSequence(rawState);
        stagedGroups = [];
        return;
      }

      program = normalizeSequence(rawState?.program);
      stagedGroups = Array.isArray(rawState?.stagedGroups)
        ? rawState.stagedGroups.map((group, index) => ({
            id: group?.id || `staged-restored-${index}`,
            items: normalizeSequence(group?.items)
          })).filter(group => group.items.length)
        : [];
    }

    function getProgramSnapshot() {
      return JSON.stringify(serializeWorkspaceState());
    }

    function restoreProgramSnapshot(snapshot) {
      try {
        applyWorkspaceState(JSON.parse(snapshot));
        renderProgram();
        renderPalette();
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeWorkspaceState()));
      setStatus("已保存");
    }

    function loadProgram() {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) {
        setStatus("没有保存内容");
        return;
      }

      try {
        applyWorkspaceState(JSON.parse(raw));
        renderProgram();
        renderPalette();
        commitHistory();
        setStatus("已读取");
      } catch {
        setStatus("读取失败");
      }
    }

    function getNodeLabel(item) {
      return cardById[item.id]?.label || "卡片";
    }

    function countProgramItems(items) {
      if (!Array.isArray(items)) return 0;
      return items.reduce((count, item) => (
        count + 1 + countProgramItems(item?.children)
      ), 0);
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
        selectCategory(tab.id.replace("tab-", ""));
      });
    });

    document.getElementById("saveBtn").addEventListener("click", saveProgram);
    document.getElementById("loadBtn").addEventListener("click", loadProgram);
    undoBtn.addEventListener("click", undoProgram);
    redoBtn.addEventListener("click", redoProgram);
    document.getElementById("clearBtn").addEventListener("click", () => {
      closeParamEditor();
      program = [];
      stagedGroups = [];
      renderProgram();
      renderPalette();
      commitHistory();
      setStatus("已清空");
    });

    grabTool.addEventListener("pointerdown", startGrabToolDrag);
    programArea.addEventListener("pointerdown", startBlankGrabHold);
    programArea.addEventListener("contextmenu", event => {
      event.preventDefault();
    });
    stagingScrollStrip.addEventListener("pointerdown", startStagingPan);

    appElement.addEventListener("selectstart", event => {
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
    });
    appElement.addEventListener("contextmenu", event => {
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
    });

    paramEditor.addEventListener("pointerdown", event => {
      event.stopPropagation();
    });

    document.addEventListener("pointerdown", event => {
      clearGrabSelectionOnOutsidePointerDown(event);
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
