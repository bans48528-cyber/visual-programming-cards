    const STORAGE_KEY = "xiaobaiVisualProgramV1";
    const LEGACY_STORAGE_KEY = "xiaobaiVisualProgramLegacy";

    const portParam = () => ({ label: "电机", type: "select", default: "L/M1", options: ["L/M1", "R/M2"] });
    const durationParam = label => ({ label, type: "number", default: 1, min: 0.1, max: 86400, step: 0.1, unit: "秒" });
    const powerParam = () => ({
      label: "功率", type: "select", default: 3,
      options: [1, 2, 3].map(value => ({ value, label: `${value}档` }))
    });
    const expressions = ["待机", "开心", "生气", "伤心", "惊讶", "眨眼", "喜欢", "晕眩", "困倦", "好奇"];
    const speechLines = [
      "小白开始行动啦", "跟我一起出发吧", "前方道路畅通", "我发现前面有东西", "让我想一想",
      "小心一点哦", "太棒了，继续加油", "我找到目标啦", "挑战成功", "我的表演结束啦"
    ];
    const recognizedLines = ["开始", "下一步", "再来一次", "你好", "再见", "谢谢", "打开", "关闭", "前进", "后退"];

    const categories = {
      motor: {
        color: "var(--motor)",
        cards: [
          { id: "motor-forward", label: "电机正转", type: "motor", paramsSchema: { port: portParam(), duration: durationParam("运行时间") } },
          { id: "motor-reverse", label: "电机反转", type: "motor", paramsSchema: { port: portParam(), duration: durationParam("运行时间") } },
          { id: "motor-forward-continuous", label: "持续正转", type: "motor", paramsSchema: { port: portParam() } },
          { id: "motor-reverse-continuous", label: "持续反转", type: "motor", paramsSchema: { port: portParam() } },
          { id: "motor-stop", label: "电机停止", type: "motor", paramsSchema: { port: portParam() } },
          { id: "motor-power", label: "电机功率", type: "motor", paramsSchema: { power: powerParam() } }
        ]
      },
      combo: {
        color: "var(--combo)",
        cards: [
          { id: "combo-forward", label: "前进", type: "combo", paramsSchema: { duration: durationParam("运行时间") } },
          { id: "combo-backward", label: "后退", type: "combo", paramsSchema: { duration: durationParam("运行时间") } },
          { id: "combo-turn-left", label: "左转", type: "combo", paramsSchema: { duration: durationParam("运行时间") } },
          { id: "combo-turn-right", label: "右转", type: "combo", paramsSchema: { duration: durationParam("运行时间") } },
          {
            id: "combo-continuous", label: "持续移动", type: "combo",
            paramsSchema: { direction: { label: "方向", type: "select", default: "advance", options: [
              { value: "advance", label: "前进" }, { value: "retreat", label: "后退" },
              { value: "left", label: "左转" }, { value: "right", label: "右转" }
            ] } }
          },
          { id: "combo-stop", label: "组合停止", type: "combo" },
          { id: "combo-power", label: "组合功率", type: "combo", paramsSchema: { power: powerParam() } }
        ]
      },
      logic: {
        color: "var(--logic)",
        cards: [
          { id: "wait-time", label: "等待时间", type: "logic", kind: "action", paramsSchema: { duration: durationParam("等待时间") } },
          { id: "loop-count", label: "循环次数", type: "logic", kind: "loop", paramsSchema: { count: { label: "次数", type: "number", default: 1, min: 1, max: 1000000, step: 1, integer: true } } },
          { id: "loop", label: "一直循环", type: "logic", kind: "loop" },
          {
            id: "infrared-wait", label: "等待红外", type: "logic",
            paramsSchema: {
              comparison: { label: "条件", type: "select", default: "greater", options: [{ value: "greater", label: "大于" }, { value: "less", label: "小于" }] },
              threshold: { label: "数值", type: "number", default: 50, min: 0, max: 100, step: 1, integer: true }
            }
          }
        ]
      },
      dynamic: {
        color: "#9867E8",
        cards: [
          { id: "eye-expression", label: "显示表情", type: "dynamic", paramsSchema: { expression: { label: "表情", type: "select", default: "EYE_01", options: expressions.map((label, index) => ({ value: `EYE_${String(index + 1).padStart(2, "0")}`, label })) } } },
          { id: "display-number", label: "显示数字", type: "dynamic", paramsSchema: { value: { label: "数字", type: "number", default: 0, min: 0, max: 100, step: 1, integer: true } } },
          { id: "display-off", label: "关闭显示", type: "dynamic" },
          { id: "speech-play", label: "语音播报", type: "dynamic", paramsSchema: { phrase: { label: "播报词条", type: "select", default: "P01", options: speechLines.map((label, index) => ({ value: `P${String(index + 1).padStart(2, "0")}`, label, bubble: `P${String(index + 1).padStart(2, "0")}` })) } } },
          { id: "speech-wait", label: "等待词条", type: "dynamic", paramsSchema: { phrase: { label: "识别词条", type: "select", default: "ASR_01", options: recognizedLines.map((label, index) => ({ value: `ASR_${String(index + 1).padStart(2, "0")}`, label })) } } }
        ]
      }
    };

    // Keep old saved programs readable while removing these superseded cards from the palette.
    const legacyCards = [
      { id: "speed-up", label: "速度加一档", type: "combo" },
      { id: "speed-down", label: "速度减一档", type: "combo" }
    ];
    const flatCards = [...Object.values(categories).flatMap(group => group.cards), ...legacyCards];
    const cardById = Object.fromEntries(flatCards.map(card => [card.id, card]));
    const chain = document.getElementById("chain");
    const palette = document.getElementById("palette");
    const deleteOverlay = document.getElementById("deleteOverlay");
    const emptyNote = document.getElementById("emptyNote");
    const statusEl = document.getElementById("status");
    const programArea = document.querySelector(".program-area");
    const programCanvas = document.querySelector(".program-canvas");
    programCanvas.style.overflowAnchor = "none";
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
    const tabSlider = document.querySelector(".tab-slider");
    const blockSounds = {
      place: new Audio("assets/sounds/block-place.wav"),
      delete: new Audio("assets/sounds/block-delete.mp3")
    };
    Object.values(blockSounds).forEach(audio => {
      audio.preload = "auto";
      audio.volume = 0.7;
    });
    const categoryOrder = ["motor", "combo", "logic", "dynamic", "staging"];
    const categorySliderColors = {
      motor: "#e9f4ff", combo: "#fce9f6", logic: "#fff0de", dynamic: "#eee7ff", staging: "#eef2f7"
    };

    let activeCategory = "motor";
    let program = [];
    let stagedGroups = [];
    let dragState = null;
    let grabToolState = null;
    let grabSelectionBoxState = null;
    let grabMarkedPaths = new Set();
    let stagingHoverTimer = null;
    let stagedGroupPointerState = null;
    let matrixPaintState = null;
    let blankGrabPending = null;
    let programAnchorFrame = null;
    let activeParamEditor = null;
    let activeNumberKeypad = null;
    let paletteTransitionCleanup = null;
    let tabSliderAnimation = null;
    let historySnapshots = [];
    let historyIndex = -1;
    const HISTORY_LIMIT = 80;
    const STAGING_HOVER_DELAY = 1000;
    const BLANK_GRAB_HOLD_DELAY = 500;
    const BLANK_GRAB_MOVE_LIMIT = 10;
    const STAGED_GROUP_PAN_THRESHOLD = 6;
    const STAGED_GROUP_PULL_THRESHOLD = 9;
    const PALETTE_SWIPE_LOCK_DISTANCE = 10;
    let paletteSwipeState = null;
    let paletteGestureCleanup = null;

    function playBlockSound(type) {
      const audio = blockSounds[type];
      if (!audio) return;
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.play()?.catch(() => {});
      } catch (_) {}
    }

    function renderPalette() {
      finishPaletteTransition();
      document.getElementById('stagingCount').textContent = stagedGroups.length;
      stagingTab.setAttribute('aria-label', `暂存，${stagedGroups.length} 组`);
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

    function selectCategory(category, animate = true) {
      if (category !== "staging" && !categories[category]) return;
      paletteGestureCleanup?.();
      finishPaletteTransition();
      const previousCategory = activeCategory;
      const previousVisual = animate ? [...palette.children].map(createPaletteVisualClone) : [];
      activeCategory = category;
      document.querySelectorAll(".tab").forEach(tab => {
        tab.setAttribute("aria-selected", String(tab.id === `tab-${category}`));
      });
      renderPalette();
      updateCategorySlider(animate);
      const direction = Math.sign(categoryOrder.indexOf(category) - categoryOrder.indexOf(previousCategory));
      if (animate && direction) animatePaletteCategory(direction, previousVisual);
    }

    function startPaletteSwipe(event) {
      if (event.pointerType !== "touch" || event.isPrimary === false || event.button > 0) return;
      if (event.target.closest(".staged-group")) return;
      paletteGestureCleanup?.();
      paletteSwipeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        source: event.target.closest(".block, .loop-block"),
        locked: false,
        width: palette.clientWidth,
        offset: 0,
        layer: null,
        track: null
      };
    }

    function createPaletteGesturePanel(category) {
      const panel = document.createElement("div");
      panel.className = "palette-transition-panel";
      if (!category) return panel;
      if (category === activeCategory) {
        [...palette.children].forEach(child => panel.appendChild(createPaletteVisualClone(child)));
        return panel;
      }
      if (category === "staging") {
        stagedGroups.forEach(group => panel.appendChild(createStagedGroupElement(group)));
      } else {
        categories[category].cards.forEach(card => panel.appendChild(createBlock(card, "palette")));
      }
      return panel;
    }

    function beginPaletteGesture(state) {
      finishPaletteTransition();
      const index = categoryOrder.indexOf(activeCategory);
      const layer = document.createElement("div");
      layer.className = "palette-transition-layer palette-gesture-layer";
      const track = document.createElement("div");
      track.className = "palette-gesture-track";
      track.style.width = `${state.width * 3}px`;
      [categoryOrder[index - 1], activeCategory, categoryOrder[index + 1]]
        .forEach(category => track.appendChild(createPaletteGesturePanel(category)));
      layer.appendChild(track);
      palette.appendChild(layer);
      track.children[1].scrollLeft = palette.scrollLeft;
      [...palette.children].forEach(child => {
        if (child !== layer) child.style.opacity = "0";
      });
      state.layer = layer;
      state.track = track;
      state.locked = true;
      palette.classList.add("is-scrubbing");
      paletteGestureCleanup = () => {
        track.getAnimations().forEach(animation => animation.cancel());
        layer.remove();
        [...palette.children].forEach(child => { child.style.opacity = ""; });
        palette.classList.remove("is-scrubbing");
        paletteGestureCleanup = null;
      };
    }

    function movePaletteSwipe(event) {
      if (!paletteSwipeState || event.pointerId !== paletteSwipeState.pointerId) return;
      const state = paletteSwipeState;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      if (dragState?.active || stagedGroupPointerState) { cancelPaletteSwipe(event); return; }
      if (!state.locked) {
        if (Math.abs(deltaX) < PALETTE_SWIPE_LOCK_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
        beginPaletteGesture(state);
        if (state.source) state.source.dataset.dragged = "true";
      }
      event.preventDefault();
      const index = categoryOrder.indexOf(activeCategory);
      const hasNeighbor = deltaX < 0 ? index < categoryOrder.length - 1 : index > 0;
      state.offset = Math.max(-state.width, Math.min(state.width, hasNeighbor ? deltaX : deltaX * .22));
      state.track.style.transform = `translate3d(${state.offset - state.width}px,0,0)`;
    }

    function finishPaletteSwipe(event) {
      if (!paletteSwipeState || event.pointerId !== paletteSwipeState.pointerId) return;
      const state = paletteSwipeState;
      paletteSwipeState = null;
      if (!state.locked) return;
      const index = categoryOrder.indexOf(activeCategory);
      const direction = state.offset < 0 ? 1 : -1;
      const nextIndex = index + direction;
      const change = nextIndex >= 0 && nextIndex < categoryOrder.length
        && Math.abs(state.offset) >= Math.min(80, state.width * .22);
      const finalOffset = change ? direction * -state.width : 0;
      const from = state.offset - state.width;
      const to = finalOffset - state.width;
      const finish = () => {
        if (!state.layer.isConnected) return;
        paletteGestureCleanup?.();
        if (change) {
          selectCategory(categoryOrder[nextIndex], false);
          document.getElementById(`tab-${activeCategory}`)?.scrollIntoView({
            behavior: "auto", block: "nearest", inline: "center"
          });
        }
      };
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || Math.abs(to - from) < 1) {
        finish();
        return;
      }
      const animation = state.track.animate(
        [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` }],
        { duration: 180, easing: "cubic-bezier(.2,.7,.2,1)" }
      );
      animation.addEventListener("finish", finish, { once: true });
    }

    function cancelPaletteSwipe(event) {
      if (!paletteSwipeState || (event && event.pointerId !== paletteSwipeState.pointerId)) return;
      paletteSwipeState = null;
      paletteGestureCleanup?.();
    }

    function updateCategorySlider(animate = true) {
      const selected = document.getElementById(`tab-${activeCategory}`);
      if (!tabSlider || !selected) return;
      const targetX = selected.offsetLeft;
      const targetWidth = selected.offsetWidth;
      const targetColor = categorySliderColors[activeCategory];
      const targetOpacity = activeCategory === "staging" ? 0 : 1;
      const tabs = tabSlider.parentElement;
      const tabsRect = tabs.getBoundingClientRect();
      const sliderRect = tabSlider.getBoundingClientRect();
      const currentX = sliderRect.left - tabsRect.left + tabs.scrollLeft;
      const currentWidth = sliderRect.width || targetWidth;
      const currentStyle = getComputedStyle(tabSlider);
      const currentColor = currentStyle.backgroundColor;
      const currentOpacity = Number(currentStyle.opacity);
      tabSliderAnimation?.cancel();
      tabSliderAnimation = null;
      Object.assign(tabSlider.style, {
        width: `${targetWidth}px`,
        transform: `translateX(${targetX}px)`,
        background: targetColor,
        opacity: String(targetOpacity)
      });
      if (!animate || Math.abs(currentX - targetX) < .5) return;
      tabSliderAnimation = tabSlider.animate([
        { transform: `translateX(${currentX}px)`, width: `${currentWidth}px`, backgroundColor: currentColor, opacity: currentOpacity },
        { transform: `translateX(${targetX}px)`, width: `${targetWidth}px`, backgroundColor: targetColor, opacity: targetOpacity }
      ], { duration: 220, easing: "cubic-bezier(.4,0,.2,1)" });
      tabSliderAnimation.addEventListener("finish", () => { tabSliderAnimation = null; }, { once: true });
    }

    function finishPaletteTransition() {
      if (!paletteTransitionCleanup) return;
      const cleanup = paletteTransitionCleanup;
      paletteTransitionCleanup = null;
      cleanup();
    }

    function createPaletteVisualClone(source) {
      const clone = source.cloneNode(true);
      clone.removeAttribute("data-card-id");
      clone.removeAttribute("data-staged-group-id");
      clone.style.opacity = "";
      clone.setAttribute("aria-hidden", "true");
      const sourceNodes = [source, ...source.querySelectorAll("*")];
      const cloneNodes = [clone, ...clone.querySelectorAll("*")];
      sourceNodes.forEach((node, index) => {
        const copy = cloneNodes[index];
        const computed = getComputedStyle(node);
        if (computed.transform !== "none") copy.style.transform = computed.transform;
        for (const property of ["--block-color", "--block-secondary", "--block-edge", "--loop-icon-top"]) {
          const value = computed.getPropertyValue(property);
          if (value) copy.style.setProperty(property, value);
        }
      });
      return clone;
    }

    function animatePaletteCategory(direction, previousVisual) {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      palette.dataset.slideDirection = direction > 0 ? "forward" : "backward";
      const liveBlocks = [...palette.children];
      liveBlocks.forEach(block => { block.style.opacity = "0"; });

      const layer = document.createElement("div");
      layer.className = "palette-transition-layer";
      const track = document.createElement("div");
      track.className = "palette-transition-track";
      const oldPanel = document.createElement("div");
      const newPanel = document.createElement("div");
      oldPanel.className = newPanel.className = "palette-transition-panel";
      previousVisual.forEach(node => oldPanel.appendChild(node));
      liveBlocks.forEach(node => newPanel.appendChild(createPaletteVisualClone(node)));
      if (direction > 0) track.append(oldPanel, newPanel);
      else track.append(newPanel, oldPanel);
      layer.appendChild(track);
      palette.appendChild(layer);

      let animation;
      const cleanup = () => {
        animation?.cancel();
        layer.remove();
        liveBlocks.forEach(block => { block.style.opacity = ""; });
      };
      paletteTransitionCleanup = cleanup;
      animation = track.animate(
        direction > 0
          ? [{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }]
          : [{ transform: "translateX(-50%)" }, { transform: "translateX(0)" }],
        { duration: 280, easing: "cubic-bezier(.4,0,.2,1)" }
      );
      animation.addEventListener("finish", () => {
        if (paletteTransitionCleanup !== cleanup) return;
        paletteTransitionCleanup = null;
        cleanup();
      }, { once: true });
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
      BlockLayout.sequence(preview);
      element.appendChild(preview);
      element.addEventListener("pointerdown", startStagedGroupPointer);
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
      BlockLayout.sequence(preview);
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
      updateProgramAnchor();
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
      block.classList.toggle("has-param-bubble", Boolean(card.paramsSchema));
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
      block.classList.add("icon-card");
      block.classList.toggle("wait-card", card.icon === "hourglass");
      block.classList.toggle("sensor-card", card.icon === "ultrasonic");
      block.classList.toggle("matrix-card", card.id === "matrix-display");

      block.title = card.label;
      const icon = createCardIcon(card, item);
      const label = document.createElement("span");
      label.className = "block-label icon-label";
      label.textContent = card.label;
      block.append(icon, label);
      if (card.paramsSchema) {
        block.appendChild(createParamBubble(card, mode, item, nodePath));
      }
      BlockLayout.measure(block);
    }

    function createParamBubble(card, mode, item, nodePath) {
      const isProgramControl = mode === "program";
      const bubble = document.createElement(isProgramControl ? "button" : "span");
      bubble.className = "param-bubble";
      bubble.classList.toggle("matrix-param-trigger", card.id === "matrix-display");
      bubble.textContent = getParamBubbleText(card, item);

      if (!isProgramControl) {
        bubble.setAttribute("aria-hidden", "true");
        return bubble;
      }

      bubble.type = "button";
      bubble.setAttribute("aria-label", `编辑${card.actionName || card.label}参数`);
      bubble.addEventListener("pointerdown", event => {
        event.stopPropagation();
      });
      bubble.addEventListener("pointerup", event => {
        event.stopPropagation();
      });
      // Open after the complete tap. Opening on pointerup can retarget the
      // following compatibility click to a newly displayed parameter control.
      bubble.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openParamEditor(nodePath, bubble);
      });
      return bubble;
    }

    function createCardIcon(card, item = null) {
      const icon = document.createElement("span");
      icon.className = "card-icon";
      if (card.id === "eye-expression") {
        icon.classList.add("eye-thumbnail-icon");
        const image = document.createElement("img");
        const expression = getParamValue(card, item, "expression") || "EYE_01";
        image.src = `assets/eyes/eye-${expression.slice(-2)}.svg`;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        icon.appendChild(image);
        return icon;
      }
      if (card.id === "display-number") {
        icon.classList.add("number-matrix-card-icon");
        icon.appendChild(createNumberDotMatrix(getParamValue(card, item, "value")));
        return icon;
      }
      if (card.id === "display-off") {
        icon.classList.add("display-off-art-icon");
        const image = document.createElement("img");
        image.src = "assets/blocks/display-off.svg";
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        icon.appendChild(image);
        return icon;
      }
      const artIcons = {
        "motor-forward": "motor-forward",
        "motor-reverse": "motor-reverse",
        "motor-forward-continuous": "motor-forward-continuous",
        "motor-reverse-continuous": "motor-reverse-continuous",
        "motor-stop": "motor-stop",
        "motor-power": "motor-power",
        "combo-forward": "combo-forward",
        "combo-backward": "combo-backward",
        "combo-turn-left": "combo-turn-left",
        "combo-turn-right": "combo-turn-right",
        "combo-stop": "combo-stop",
        "combo-power": "combo-power",
        "wait-time": "wait-time",
        "loop-count": "loop",
        "loop": "loop",
        "infrared-wait": "infrared-wait",
        "speech-play": "speech-play",
        "speech-wait": "speech-wait"
      };
      if (card.id === "combo-continuous") {
        artIcons[card.id] = `combo-continuous-${getParamValue(card, item, "direction")}`;
      }
      if (artIcons[card.id]) {
        icon.classList.add("ai-art-icon");
        if (card.id === "motor-power" || card.id === "combo-power") icon.classList.add("motor-power-icon");
        const image = document.createElement("img");
        image.src = `assets/blocks/${artIcons[card.id]}.svg`;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        icon.appendChild(image);
        return icon;
      }
      if (card.id === "motor-power" || card.id === "combo-power") {
        icon.classList.add("motor-power-icon");
        icon.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="27" r="23" fill="white" stroke="none"/><g fill="#0062a6" stroke="none"><circle cx="32" cy="12" r="6"/><circle cx="47" cy="27" r="6"/><circle cx="32" cy="42" r="6"/><circle cx="17" cy="27" r="6"/><circle cx="32" cy="27" r="4"/></g></svg>`;
        if (card.id === "combo-power") {
          const svg = icon.querySelector("svg");
          svg.querySelector("g").setAttribute("fill", "#b2248a");
          const second = document.createElementNS("http://www.w3.org/2000/svg", "g");
          second.setAttribute("transform", "translate(-7 22) scale(.75)");
          second.append(...Array.from(svg.children, child => child.cloneNode(true)));
          svg.append(second);
        }
        icon.appendChild(createPowerBars(Number(getParamValue(card, item, "power"))));
        return icon;
      }

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

      const paths = {
        "speed-up": "M12 46h8V34h-8z M28 46h8V25h-8z M44 46h8V16h-8z M12 16h16 M20 8v16",
        "speed-down": "M12 46h8V34h-8z M28 46h8V25h-8z M44 46h8V16h-8z M12 16h16",
        "motor-forward": "M20 23h24v24H20z M26 23v-5h12v5 M44 31h7v8h-7 M14 19A22 22 0 0 1 49 13 M42 11l8 2-2 8",
        "motor-reverse": "M20 23h24v24H20z M26 23v-5h12v5 M44 31h7v8h-7 M50 19A22 22 0 0 0 15 13 M22 11l-8 2 2 8",
        "motor-stop": "M18 19h28v28H18z M25 19v-5h14v5 M46 28h7v10h-7 M28 28h8v10h-8z",
        "combo-forward": "M22 48V18 M13 27l9-9 9 9 M44 48V18 M35 27l9-9 9 9",
        "combo-backward": "M22 16v30 M13 37l9 9 9-9 M44 16v30 M35 37l9 9 9-9",
        "combo-turn-left": "M46 49V31q0-12-12-12H15 M25 9L15 19l10 10",
        "combo-turn-right": "M18 49V31q0-12 12-12h19 M39 9l10 10-10 10",
        "combo-stop": "M17 17h30v30H17z M26 25v14 M38 25v14",
        "grayscale-sensor": "M14 17h36v30H14z M26 17v30 M38 17v30 M38 24h12 M38 33h12 M38 41h12",
        "button-sensor": "M17 38h30v12H17z M24 38V27h16v11 M32 10v10 M18 16l5 5 M46 16l-5 5",
        "host-button": "M12 17h40v32H12z M21 29v9 M17 33h8 M40 29v9 M36 33h8",
        "play-note": "M26 43V17l23-5v25 M26 22l23-5 M26 43c0 9-16 10-16 2s16-10 16-2 M49 37c0 9-16 10-16 2s16-10 16-2",
        "loop": "M18 22h20a15 15 0 0 1 0 30 M26 12L16 22l10 10",
        "loop-count": "M18 22h20a15 15 0 0 1 0 30 M26 12L16 22l10 10"
      };
      let iconId = card.id;
      if (card.id === "combo-direction") {
        const mode = getParamValue(card, item, "mode");
        const arrow = "M0 13V-13 M-7-6L0-13 7-6";
        icon.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="19" cy="32" r="16"/><circle cx="45" cy="32" r="16"/><path transform="translate(19 32) rotate(${["0","2"].includes(mode) ? 180 : 0})" d="${arrow}"/><path transform="translate(45 32) rotate(${["1","2"].includes(mode) ? 180 : 0})" d="${arrow}"/></svg>`;
        return icon;
      }
      const continuous = card.id.endsWith("-continuous");
      if (card.id === "combo-continuous") iconId = {advance:"combo-forward",retreat:"combo-backward",left:"combo-turn-left",right:"combo-turn-right"}[getParamValue(card,item,"direction")];
      else if (continuous) iconId = card.id.replace("-continuous", "");
      icon.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${paths[iconId] || paths.loop}"/></svg>`;
      if (continuous) {
        icon.classList.add("continuous-icon");
        const badge = document.createElement("span");
        badge.className = "continuous-badge";badge.textContent = "∞";badge.setAttribute("aria-hidden", "true");
        icon.appendChild(badge);
      }
      return icon;
    }

    function createNumberDotMatrix(rawValue) {
      const glyphs = {
        "0": ["111", "101", "101", "101", "111"],
        "1": ["010", "110", "010", "010", "111"],
        "2": ["111", "001", "111", "100", "111"],
        "3": ["111", "001", "111", "001", "111"],
        "4": ["101", "101", "111", "001", "001"],
        "5": ["111", "100", "111", "001", "111"],
        "6": ["111", "100", "111", "101", "111"],
        "7": ["111", "001", "001", "001", "001"],
        "8": ["111", "101", "111", "101", "111"],
        "9": ["111", "101", "111", "001", "111"]
      };
      const value = String(Math.max(0, Math.min(100, Math.round(Number(rawValue) || 0))));
      const columns = value.length * 3 + Math.max(0, value.length - 1);
      const matrix = document.createElement("span");
      matrix.className = "number-dot-matrix";
      matrix.dataset.value = value;
      matrix.style.setProperty("--dot-columns", columns);
      for (let row = 0; row < 5; row += 1) {
        value.split("").forEach((digit, digitIndex) => {
          glyphs[digit][row].split("").forEach(bit => {
            const dot = document.createElement("i");
            dot.classList.toggle("is-on", bit === "1");
            matrix.appendChild(dot);
          });
          if (digitIndex < value.length - 1) matrix.appendChild(document.createElement("i"));
        });
      }
      return matrix;
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
      loop.classList.toggle("has-param-bubble", Boolean(card.paramsSchema));
      loop.style.setProperty("--loop-color", getCardColor(card));
      loop.style.setProperty("--block-color", getCardColor(card));
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
      tail.appendChild(createCardIcon(card));
      if (card.paramsSchema) {
        tail.appendChild(createParamBubble(card, "palette", null, []));
      }

      loop.append(top, left, inner, tail);
      loop.title = card.label;
      BlockLayout.measure(loop);
      return loop;
    }

    function createLoopBlock(item, nodePath) {
      const card = cardById[item.id];
      const children = Array.isArray(item.children) ? item.children : [];
      const hasNestedLoop = children.some(child => cardById[child.id]?.kind === "loop");
      item.children = children;

      const loop = document.createElement("div");
      loop.className = "loop-block program-block";
      loop.classList.toggle("has-param-bubble", Boolean(card.paramsSchema));
      if (hasNestedLoop) {
        loop.classList.add("has-nested-loop");
      }
      loop.style.setProperty("--loop-color", getCardColor(card));
      loop.style.setProperty("--block-color", getCardColor(card));
      loop.dataset.cardId = card.id;
      loop.dataset.mode = "program";
      loop.dataset.nodePath = pathToKey(nodePath);
      loop.setAttribute("role", "listitem");
      loop.setAttribute("aria-label", `${getCardDisplayLabel(card, item)}，内部${children.length}张卡片`);
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
      note.textContent = "+";
      note.style.display = children.length ? "none" : "grid";
      inner.appendChild(note);

      renderSequence(children, inner, nodePath, note);

      const tail = document.createElement("div");
      tail.className = "loop-tail";
      tail.appendChild(createCardIcon(card));
      if (card.paramsSchema) {
        tail.appendChild(createParamBubble(card, "program", item, nodePath));
      }

      loop.append(top, left, inner, tail);
      loop.title = card.label;
      BlockLayout.measure(loop);
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
      playBlockSound("place");
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
        if (Object.prototype.hasOwnProperty.call(definition.legacyValues || {}, rawValue)) rawValue = definition.legacyValues[rawValue];
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
      if (card.id.endsWith("-continuous")) {
        if (card.id === "combo-continuous") return `${getParamOptionDisplay(card.paramsSchema.direction,getParamValue(card,item,"direction"))}∞`;
        return `${getParamOptionDisplay(card.paramsSchema.port,getParamValue(card,item,"port"))}${card.id === "motor-forward-continuous" ? "正转" : "反转"}∞`;
      }
      if (card.id === "play-note") return `${getParamValue(card, item, "note")}·${getParamValue(card, item, "beats")}拍`;
      if (card.id === "matrix-display") {
        return "";
      }

      const parts = Object.entries(card.paramsSchema || {})
        .filter(([, definition]) => definition.type !== "matrix")
        .map(([key, definition]) => formatParamBubblePart(card, item, key, definition))
        .filter(Boolean);
      const motorAction = { "motor-forward": "正转", "motor-reverse": "反转", "motor-stop": "停止" }[card.id];
      if (motorAction) parts.splice(1, 0, motorAction);
      return parts.join("");
    }

    function formatParamBubblePart(card, item, key, definition) {
      const value = getParamValue(card, item, key);
      if (definition.type === "select") {
        const option = (definition.options || []).find(candidate => (
          (typeof candidate === "object" ? candidate.value : candidate) === value
        ));
        return typeof option === "object" && option.bubble
          ? option.bubble
          : getParamOptionDisplay(definition, value);
      }
      if (definition.type === "number") {
        const fullText = formatParamNumber(value);
        const shortText = (fullText.match(/^-?(?:\d\.?){1,3}/)?.[0] || fullText).replace(/\.$/, "");
        return `${shortText}${definition.unit || ""}`;
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
      const display = typeof option === "object" ? (option.display || option.label || option.value) : option;
      return display === "L/M1" ? "L" : display === "R/M2" ? "R" : display;
    }

    function getCardDisplayLabel(card, item = null) {
      if (card.paramsSchema && item) return `${card.label} ${getParamBubbleText(card, item)}`.trim();
      return card.label;
    }

    function openParamEditor(nodePath, anchor) {
      const item = getNodeAtPath(nodePath);
      const card = cardById[item?.id];
      if (!item || !card?.paramsSchema) return;

      activeNumberKeypad = null;
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
      const owner = findProgramBlockByPath(activeParamEditor.nodePath);
      const colors = owner ? getComputedStyle(owner) : null;
      paramEditor.style.setProperty("--editor-color", getCardColor(card));
      paramEditor.style.setProperty("--editor-edge", colors?.getPropertyValue("--block-edge") || "#0062A6");
      paramEditor.style.setProperty("--editor-secondary", colors?.getPropertyValue("--block-secondary") || "#0078CC");
      paramEditor.setAttribute("role", "dialog");
      paramEditor.setAttribute("aria-label", `${card.label}参数`);
      paramEditor.hidden = false;
      paramEditor.classList.toggle("is-matrix", card.id === "matrix-display");
      paramEditor.classList.toggle("is-number-keypad", Boolean(activeNumberKeypad));
      paramEditor.appendChild(activeNumberKeypad
        ? createNumberKeypad(card)
        : createGenericParamEditor(card, item));

      positionParamEditor(anchor || findProgramBlockByPath(activeParamEditor.nodePath));
    }

    function createGenericParamEditor(card, item) {
      const panel = document.createElement("div");
      panel.className = "param-editor-panel";
      if (card.id === "motor-power" || card.id === "combo-power") {
        panel.classList.add("motor-power-editor");
        panel.appendChild(createCardIcon(card, item));
        panel.appendChild(createSelectParamEditor(card, item, "power", card.paramsSchema.power));
        return panel;
      }
      if (card.id === "eye-expression") {
        panel.classList.add("eye-expression-editor");
        panel.appendChild(createEyeExpressionEditor(card, item));
        return panel;
      }

      Object.entries(card.paramsSchema || {}).forEach(([key, definition]) => {
        if (card.id === "play-note") {
          const caption = document.createElement("div");
          caption.className = "param-field-caption";
          caption.textContent = definition.label;
          panel.appendChild(caption);
        }
        if (definition.type === "select") {
          panel.appendChild(["speech-play", "speech-wait"].includes(card.id)
            ? createPhraseListEditor(card, item, key, definition)
            : createSelectParamEditor(card, item, key, definition));
        } else if (definition.type === "number") {
          panel.appendChild(createNumberStepper(card, item, key, `减少${definition.label || "数值"}`, `增加${definition.label || "数值"}`));
        } else if (definition.type === "matrix") {
          panel.appendChild(createMatrixParamEditor(card, item, key));
        }
      });

      return panel;
    }

    function createEyeExpressionEditor(card, item) {
      const definition = card.paramsSchema.expression;
      const currentValue = getParamValue(card, item, "expression");
      const grid = document.createElement("div");
      grid.className = "eye-option-grid";
      definition.options.forEach(option => {
        const button = document.createElement("button");
        button.className = "eye-option-btn";
        button.classList.toggle("is-selected", option.value === currentValue);
        button.type = "button";
        button.setAttribute("aria-pressed", String(option.value === currentValue));
        button.setAttribute("aria-label", option.label);
        const image = document.createElement("img");
        image.src = `assets/eyes/eye-${option.value.slice(-2)}.svg`;
        image.alt = "";
        const label = document.createElement("span");
        label.textContent = option.label;
        button.append(image, label);
        button.addEventListener("click", () => setActiveParamValue("expression", option.value));
        grid.appendChild(button);
      });
      return grid;
    }

    function createPhraseListEditor(card, item, key, definition) {
      const panel = document.createElement("div");
      panel.className = "phrase-list-editor";
      const title = document.createElement("div");
      title.className = "phrase-list-title";
      title.textContent = definition.label;
      const list = document.createElement("div");
      list.className = "phrase-option-grid";
      const currentValue = getParamValue(card, item, key);
      definition.options.forEach(option => {
        const value = typeof option === "object" ? option.value : option;
        const label = typeof option === "object" ? option.label : option;
        const button = document.createElement("button");
        button.className = "phrase-option-btn";
        button.classList.toggle("is-selected", value === currentValue);
        button.type = "button";
        button.setAttribute("aria-pressed", String(value === currentValue));
        button.setAttribute("aria-label", label);
        const code = document.createElement("span");
        code.className = "phrase-option-code";
        code.textContent = value.replace("ASR_", "A");
        const text = document.createElement("span");
        text.className = "phrase-option-text";
        text.textContent = label;
        button.append(code, text);
        button.addEventListener("click", () => {
          setActiveParamValue(key, value);
          closeParamEditor();
        });
        list.appendChild(button);
      });
      panel.append(title, list);
      return panel;
    }

    function createSelectParamEditor(card, item, key, definition) {
      const optionRow = document.createElement("div");
      optionRow.className = "param-option-row";
      if (card.id === "play-note" && key === "note") optionRow.classList.add("note-options");
      if (card.id === "combo-direction" && key === "mode") optionRow.classList.add("direction-options");
      const currentValue = getParamValue(card, item, key);

      definition.options.forEach(option => {
        const value = typeof option === "object" ? option.value : option;
        const button = document.createElement("button");
        button.className = "param-option-btn";
        button.classList.toggle("is-selected", value === currentValue);
        button.setAttribute("aria-pressed", String(value === currentValue));
        button.type = "button";
        button.textContent = getParamOptionDisplay(definition, value);
        button.setAttribute("aria-label", typeof option === "object" ? option.label : value === "L/M1" ? "左电机 L" : value === "R/M2" ? "右电机 R" : option);
        if ((card.id === "motor-power" || card.id === "combo-power") && key === "power") {
          button.classList.add("power-option");
          button.title = `功率 ${value}%`;
          button.replaceChildren(createPowerBars(Number(value)));
        }
        button.addEventListener("click", () => setActiveParamValue(key, value));
        optionRow.appendChild(button);
      });

      return optionRow;
    }

    function createPowerBars(power) {
      const bars = document.createElement("span");
      bars.className = "power-bars";
      bars.setAttribute("aria-hidden", "true");
      const level = power <= 3 ? power : Math.round(power / 25);
      for (let i = 1; i <= 3; i++) {
        const bar = document.createElement("i");
        bar.style.height = `${5 + i * 4}px`;
        bar.classList.toggle("is-on", i <= level);
        bars.appendChild(bar);
      }
      return bars;
    }

    function createMatrixParamEditor(card, item, key = "pattern") {
      const panel = document.createElement("div");
      panel.className = "matrix-editor-panel";

      const pattern = getParamValue(card, item, key);
      const grid = document.createElement("div");
      grid.className = "matrix-editor-grid";
      grid.addEventListener("pointerdown", startMatrixPaint);
      grid.dataset.paramKey = key;

      pattern.forEach((value, index) => {
        const button = document.createElement("button");
        button.className = "matrix-cell";
        button.classList.toggle("is-on", Boolean(value));
        button.type = "button";
        button.dataset.matrixIndex = String(index);
        button.setAttribute("aria-label", `点阵第${index + 1}格`);
        grid.appendChild(button);
      });

      panel.appendChild(grid);
      return panel;
    }

    function startMatrixPaint(event) {
      if (event.button > 0) return;
      const cell = event.target.closest(".matrix-cell");
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();

      const grid = event.currentTarget;
      const item = getNodeAtPath(activeParamEditor.nodePath);
      const card = cardById[item?.id];
      const paramKey = grid.dataset.paramKey || "pattern";
      const definition = card?.paramsSchema?.[paramKey];
      if (!item || definition?.type !== "matrix") return;

      matrixPaintState = {
        pointerId: event.pointerId,
        grid,
        paramKey,
        paintedIndexes: new Set(),
        pattern: [...getParamValue(card, item, paramKey)],
        lastX: event.clientX,
        lastY: event.clientY
      };
      grid.setPointerCapture?.(event.pointerId);
      paintMatrixCell(Number(cell.dataset.matrixIndex));
      grid.addEventListener("pointermove", moveMatrixPaint);
      grid.addEventListener("pointerup", endMatrixPaint);
      grid.addEventListener("pointercancel", endMatrixPaint);
    }

    function moveMatrixPaint(event) {
      if (!matrixPaintState || event.pointerId !== matrixPaintState.pointerId) return;
      event.preventDefault();

      paintMatrixCellsAlongPath(
        matrixPaintState.lastX,
        matrixPaintState.lastY,
        event.clientX,
        event.clientY
      );
      matrixPaintState.lastX = event.clientX;
      matrixPaintState.lastY = event.clientY;
    }

    function endMatrixPaint(event) {
      if (!matrixPaintState || event.pointerId !== matrixPaintState.pointerId) return;
      const { grid, pointerId, pattern, paramKey } = matrixPaintState;
      grid.removeEventListener("pointermove", moveMatrixPaint);
      grid.removeEventListener("pointerup", endMatrixPaint);
      grid.removeEventListener("pointercancel", endMatrixPaint);
      if (grid.hasPointerCapture?.(pointerId)) {
        grid.releasePointerCapture(pointerId);
      }
      setActiveParamValue(paramKey, pattern);
      matrixPaintState = null;
    }

    function paintMatrixCell(index) {
      if (!activeParamEditor) return;
      if (!Number.isInteger(index) || index < 0) return;
      if (matrixPaintState?.paintedIndexes.has(index)) return;

      const pattern = matrixPaintState?.pattern;
      if (!pattern) return;
      if (index >= pattern.length) return;
      matrixPaintState?.paintedIndexes.add(index);
      pattern[index] = pattern[index] ? 0 : 1;
      matrixPaintState?.grid
        .querySelector(`.matrix-cell[data-matrix-index="${index}"]`)
        ?.classList.toggle("is-on", Boolean(pattern[index]));
    }

    function paintMatrixCellsAlongPath(fromX, fromY, toX, toY) {
      const distance = Math.hypot(toX - fromX, toY - fromY);
      const steps = Math.max(1, Math.ceil(distance / 6));
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps;
        const x = fromX + (toX - fromX) * progress;
        const y = fromY + (toY - fromY) * progress;
        const target = document.elementFromPoint(x, y);
        const cell = target?.closest?.(".matrix-cell");
        if (!cell || !matrixPaintState?.grid.contains(cell)) continue;
        paintMatrixCell(Number(cell.dataset.matrixIndex));
      }
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

      // A button cannot summon the phone IME, including on older WebViews.
      const current = document.createElement("button");
      current.className = "param-current";
      current.type = "button";
      current.dataset.numberParam = key;
      current.setAttribute("aria-label", `${definition.label || "参数值"}：${formatParamNumber(value)}${definition.unit || ""}，打开小键盘`);
      current.setAttribute("aria-haspopup", "dialog");
      current.addEventListener("click", () => {
        activeNumberKeypad = {key, draft: formatParamNumber(value), replaceNext: true};
        renderParamEditor();
        paramEditor.querySelector(".number-keypad").focus({preventScroll: true});
      });
      const display = document.createElement("span");
      display.className = "param-value-display";
      display.textContent = formatParamNumber(value);

      const unit = document.createElement("span");
      unit.className = "param-unit";
      unit.textContent = definition.unit || "";
      current.append(display, unit);

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

    function closeNumberKeypad() {
      if (!activeNumberKeypad) return false;
      closeParamEditor();
      return true;
    }

    function createNumberKeypad(card) {
      const state = activeNumberKeypad;
      const definition = card.paramsSchema[state.key];
      const precision = definition.integer ? 0 : getNumberPrecision(definition);
      const panel = document.createElement("div");
      panel.className = "number-keypad";
      panel.tabIndex = -1;
      paramEditor.setAttribute("aria-label", `${definition.label || "数值"}小键盘`);
      const output = document.createElement("output");
      output.className = "number-keypad-value";
      output.setAttribute("aria-label", "输入值");
      const grid = document.createElement("div");
      grid.className = "number-keypad-grid";
      const buttons = {};
      function update(applyValue = true) {
        const value = Number(state.draft);
        const valid = state.draft !== "" && Number.isFinite(value)
          && (!Number.isFinite(definition.min) || value >= definition.min)
          && (!Number.isFinite(definition.max) || value <= definition.max);
        output.textContent = state.draft || "—";
        output.classList.toggle("is-selected", state.replaceNext);
        output.setAttribute("aria-invalid", String(!valid));
        buttons["."].disabled = !precision || (!state.replaceNext && state.draft.includes("."));
        buttons.delete.disabled = state.draft === "";
        if (applyValue && valid && activeNumberKeypad === state && activeParamEditor) {
          const item = getNodeAtPath(activeParamEditor.nodePath);
          const previous = getParamValue(card, item, state.key);
          const next = normalizeParamValue(definition, value);
          if (next !== previous) setActiveParamValue(state.key, next, false);
        }
      }
      function press(key) {
        if (activeNumberKeypad !== state || !activeParamEditor) return;
        if (key === "delete") state.draft = state.draft.slice(0, -1);
        else if (key === ".") {
          if (!precision || (!state.replaceNext && state.draft.includes("."))) return;
          state.draft = state.replaceNext || state.draft === "" ? "0." : state.draft + ".";
        } else if (/^\d$/.test(key)) {
          let next = state.replaceNext ? key : state.draft + key;
          next = next.replace(/^0+(?=\d)/, "");
          if (next.replace(".", "").length > 15 || (next.split(".")[1]?.length || 0) > precision) return;
          state.draft = next;
        } else return;
        state.replaceNext = false;
        update();
      }
      for (const key of ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "delete"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `number-key${key === "delete" ? " number-key-action" : ""}`;
        button.dataset.key = key;
        if (key === "delete") button.innerHTML = '<svg viewBox="0 0 48 32" aria-hidden="true"><path d="M17 4h25v24H17L5 16 17 4Z M25 11l10 10 M35 11 25 21"/></svg>';
        else button.textContent = key;
        if (key === ".") button.setAttribute("aria-label", "小数点");
        if (key === "delete") button.setAttribute("aria-label", "删除一位");
        button.addEventListener("click", () => press(key));
        buttons[key] = button;
        grid.appendChild(button);
      }
      // Physical keyboards still work on desktop without using an editable field.
      panel.addEventListener("keydown", event => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeParamEditor();
          return;
        }
        const key = ({Backspace: "delete", Delete: "delete", ",": "."})[event.key] || event.key;
        if (!Object.prototype.hasOwnProperty.call(buttons, key)) return;
        event.preventDefault();
        event.stopPropagation();
        press(key);
      });
      panel.append(output, grid);
      update(false);
      return panel;
    }

    function adjustActiveNumberParam(key, direction) {
      if (!activeParamEditor) return;
      const item = getNodeAtPath(activeParamEditor.nodePath);
      const card = cardById[item?.id];
      const definition = card?.paramsSchema?.[key];
      if (!item || !definition) return;

      const current = getParamValue(card, item, key);
      // Button increments are independent of the keypad's decimal precision.
      setActiveParamValue(key, current + direction);
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

      const editorPath = [...activeParamEditor.nodePath];
      const block = card.kind === "loop"
        ? refreshProgramAfterLoopParamChange(editorPath)
        : refreshProgramBlock(editorPath);
      if (rerenderEditor || card.kind === "loop") {
        renderParamEditor(block);
      } else {
        positionParamEditor(block);
      }
      commitHistory();
      setStatus(`${getCardDisplayLabel(card, item)}`);
      return next;
    }

    function refreshProgramAfterLoopParamChange(nodePath) {
      const numberKeypad = activeNumberKeypad;
      renderProgram();
      activeParamEditor = { nodePath };
      activeNumberKeypad = numberKeypad;
      return findProgramBlockByPath(nodePath);
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
        : block.querySelector?.(":scope > .param-bubble, :scope > .loop-tail > .param-bubble") || anchor;
      const anchorRect = BlockLayout.clientRect(control);
      const editorRect = BlockLayout.clientRect(paramEditor);
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const gap = 14;
      const margin = 8;
      if (activeNumberKeypad) {
        const rightLeft = anchorRect.right + gap;
        const leftLeft = anchorRect.left - editorRect.width - gap;
        const fitsRight = rightLeft + editorRect.width <= viewportRight - margin;
        const fitsLeft = leftLeft >= viewportLeft + margin;
        if (fitsRight || fitsLeft) {
          const onRight = fitsRight;
          const left = onRight ? rightLeft : leftLeft;
          const maxTop = Math.max(viewportTop + margin, viewportBottom - editorRect.height - margin);
          const top = Math.max(viewportTop + margin, Math.min(
            anchorRect.top + anchorRect.height / 2 - editorRect.height / 2,
            maxTop
          ));
          const arrowTop = Math.max(18, Math.min(
            anchorRect.top + anchorRect.height / 2 - top,
            editorRect.height - 18
          ));
          paramEditor.classList.remove("is-above-anchor");
          paramEditor.classList.add("is-side-anchor");
          paramEditor.classList.toggle("is-right-of-anchor", onRight);
          paramEditor.classList.toggle("is-left-of-anchor", !onRight);
          paramEditor.style.setProperty("--param-arrow-top", `${Math.round(arrowTop)}px`);
          paramEditor.style.left = `${Math.round(left)}px`;
          paramEditor.style.top = `${Math.round(top)}px`;
          return;
        }
      }
      paramEditor.classList.remove("is-side-anchor", "is-right-of-anchor", "is-left-of-anchor");
      paramEditor.style.removeProperty("--param-arrow-top");
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
      activeNumberKeypad = null;
      paramEditor.hidden = true;
      paramEditor.classList.remove("is-matrix", "is-above-anchor", "is-number-keypad", "is-side-anchor", "is-right-of-anchor", "is-left-of-anchor");
      paramEditor.style.removeProperty("--param-arrow-left");
      paramEditor.style.removeProperty("--param-arrow-top");
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
        isPointInRect(x, y, BlockLayout.clientRect(element))
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

      if (dragState || grabToolState || grabSelectionBoxState || (event.pointerType === "touch" && event.isPrimary === false)) {
        return;
      }

      closeParamEditor();
      removeOrphanGhosts();

      const source = event.currentTarget;
      source.dataset.dragged = "false";
      const rect = BlockLayout.clientRect(source);
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

      ghost.classList.add("ghost");
      if (fromProgram) {
        ghost.style.width = `${ghostRect.width}px`;
        ghost.style.height = `${ghostRect.height}px`;
      }

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
        pointerType: event.pointerType,
        active: false,
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

      if (source.setPointerCapture) source.setPointerCapture(event.pointerId);
      source.addEventListener("pointermove", moveDrag);
      source.addEventListener("pointerup", endDrag);
      source.addEventListener("pointercancel", cancelDrag);
      source.addEventListener("lostpointercapture", cancelDrag);
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", cancelDrag);
      window.addEventListener("blur", cancelDrag);
    }

    function moveDrag(event) {
      if (!dragState) return;
      if (!isActiveDragPointer(event)) return;
      event.preventDefault();

      const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
      const threshold = dragState.pointerType === "touch" ? 5 : 4;
      if (!dragState.active) {
        if (distance <= threshold) return;
        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;
        if (dragState.pointerType === "touch" && !dragState.fromProgram && !dragState.fromStaging
          && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) return;
        activateDrag();
      }
      restoreDragScroll();
      dragState.source.dataset.dragged = "true";
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
      const preservedStartTop = target ? BlockLayout.clientRect(startBlock).top : null;
      clearDropHints({ updateAnchor: !target });
      dragState.lastTarget = target;
      if (target) showDropMarker(target, preservedStartTop);
    }

    function endDrag(event) {
      if (!dragState) return;
      if (!isActiveDragPointer(event)) return;
      event.preventDefault();
      const wasActive = dragState.active;
      restoreDragScroll();

      if (dragState.autoSwitchedToStaging && !isPointOverLibraryArea(event.clientX, event.clientY)) {
        restoreCategoryAfterStagingExit();
      }

      const movedEnough = wasActive;
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
          playBlockSound("delete");
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
          playBlockSound("place");
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
          if (moved) playBlockSound("place");
          setStatus(moved ? `已同时移动 ${grabMovePaths.length} 张卡片` : "未能同时移动");
        } else {
          const moved = moveProgramNode(sourcePath, target.sequencePath, target.index);
          if (moved) playBlockSound("place");
          setStatus(moved ? "已调整位置" : "未能调整位置");
        }
      } else {
        const added = insertNodeAtPath(target.sequencePath, target.index, createProgramItem(cardId));
        if (added) playBlockSound("place");
        setStatus(added ? `已添加：${cardById[cardId].label}` : "未能添加积木");
      }

      renderProgram();
      commitHistory();
      setTimeout(() => { source.dataset.dragged = "false"; }, 0);
    }

    function cancelDrag(event) {
      if (dragState && event && "pointerId" in event && !isActiveDragPointer(event)) return;
      cleanupDrag(event);
    }

    function activateDrag() {
      if (!dragState || dragState.active) return;
      dragState.active = true;
      // Preview insertion must not move the hit targets under a stationary pointer.
      dragState.dropGeometry = new Map([chain, ...chain.querySelectorAll(".loop-inner.sequence-zone")].map(zone => [zone, {
        rect: BlockLayout.clientRect(zone),
        boundaries: getDirectProgramBlocks(zone).map(block => {
          const rect = BlockLayout.clientRect(block);
          return rect.left + Number(block.dataset.advance) / 2;
        })
      }]));
      dragState.lastX = dragState.startX;
      dragState.lastY = dragState.startY;
      if (dragState.fromProgram) {
        const preserveStartTop = BlockLayout.clientRect(startBlock).top;
        dragState.placeholderSources.forEach(block => block.classList.add("drag-source-placeholder"));
        updateProgramAnchor({ allowDuringDrag: true, preserveStartTop });
        setDeleteOverlayVisible(true);
      }
      document.body.appendChild(dragState.ghost);
      setDragScrollLocked(true);
      moveGhost(dragState.startX, dragState.startY);
    }

    function cleanupDrag(event) {
      if (!dragState) return;

      dragState.source.removeEventListener("pointermove", moveDrag);
      dragState.source.removeEventListener("pointerup", endDrag);
      dragState.source.removeEventListener("pointercancel", cancelDrag);
      dragState.source.removeEventListener("lostpointercapture", cancelDrag);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", cancelDrag);
      window.removeEventListener("blur", cancelDrag);
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
      updateProgramAnchor();
    }

    function isProgramBlankTarget(target) {
      return target instanceof Element
        && programArea.contains(target)
        && !target.closest(".program-block, #startBlock, #grabTool, button");
    }

    function startBlankGrabHold(event) {
      if (!isProgramBlankTarget(event.target)) return;
      if (event.button > 0 || dragState || grabToolState || grabSelectionBoxState || blankGrabPending) return;
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
        timer: setTimeout(() => activateBlankGrabSelection(event.pointerId), BLANK_GRAB_HOLD_DELAY)
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

    function activateBlankGrabSelection(pointerId) {
      if (!blankGrabPending || blankGrabPending.pointerId !== pointerId) return;
      const { startX, startY, lastX, lastY } = blankGrabPending;
      cleanupBlankGrabHold();
      startGrabSelectionBox(pointerId, startX, startY, lastX, lastY);
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

      if (dragState || grabToolState || grabSelectionBoxState || (event.pointerType === "touch" && event.isPrimary === false)) {
        return;
      }

      closeParamEditor();

      const rect = BlockLayout.clientRect(grabTool);
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

    function startGrabSelectionBox(pointerId, startX, startY, currentX = startX, currentY = startY) {
      if (dragState || grabToolState || grabSelectionBoxState) return;

      const box = document.createElement("div");
      box.className = "grab-selection-box";
      box.setAttribute("aria-hidden", "true");
      document.body.appendChild(box);

      grabSelectionBoxState = {
        pointerId,
        startX,
        startY,
        currentX,
        currentY,
        box,
        initialMarkedPathKeys: new Set(grabMarkedPaths)
      };

      setDragScrollLocked(true);
      document.addEventListener("pointermove", moveGrabSelectionBox);
      document.addEventListener("pointerup", endGrabSelectionBox);
      document.addEventListener("pointercancel", cancelGrabSelectionBox);
      updateGrabSelectionBox(currentX, currentY);
      setStatus("框选卡片，松手完成标记");
    }

    function moveGrabSelectionBox(event) {
      if (!isActiveGrabSelectionBoxPointer(event)) return;
      event.preventDefault();
      updateGrabSelectionBox(event.clientX, event.clientY);
    }

    function endGrabSelectionBox(event) {
      if (!isActiveGrabSelectionBoxPointer(event)) return;
      event.preventDefault();
      cleanupGrabSelectionBox();
      updateGrabMarkStatus();
    }

    function cancelGrabSelectionBox(event) {
      if (grabSelectionBoxState && event && !isActiveGrabSelectionBoxPointer(event)) return;
      cleanupGrabSelectionBox();
      updateGrabMarkStatus();
    }

    function cleanupGrabSelectionBox() {
      if (!grabSelectionBoxState) return;

      document.removeEventListener("pointermove", moveGrabSelectionBox);
      document.removeEventListener("pointerup", endGrabSelectionBox);
      document.removeEventListener("pointercancel", cancelGrabSelectionBox);
      grabSelectionBoxState.box.remove();
      setDragScrollLocked(false);
      grabSelectionBoxState = null;
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

    function startStagedGroupPointer(event) {
      if (event.button > 0 || activeCategory !== "staging" || dragState || grabToolState || grabSelectionBoxState || stagedGroupPointerState) return;
      if (event.pointerType === "touch" && event.isPrimary === false) return;
      event.preventDefault();
      event.stopPropagation();

      const source = event.currentTarget;
      source.dataset.dragged = "false";
      stagedGroupPointerState = {
        source,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: palette.scrollLeft,
        mode: "pending"
      };
      source.setPointerCapture?.(event.pointerId);
      source.addEventListener("pointermove", moveStagedGroupPointer);
      source.addEventListener("pointerup", endStagedGroupPointer);
      source.addEventListener("pointercancel", endStagedGroupPointer);
    }

    function moveStagedGroupPointer(event) {
      if (!stagedGroupPointerState || event.pointerId !== stagedGroupPointerState.pointerId) return;
      event.preventDefault();
      event.stopPropagation();

      const state = stagedGroupPointerState;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (state.mode === "pending") {
        if (deltaY < -STAGED_GROUP_PULL_THRESHOLD && absY > absX * 0.7) {
          const source = state.source;
          const startX = state.startX;
          const startY = state.startY;
          cleanupStagedGroupPointer();
          startDrag(event);
          if (dragState) {
            dragState.startX = startX;
            dragState.startY = startY;
            dragState.source.dataset.dragged = "true";
            moveDrag(event);
          } else {
            source.dataset.dragged = "false";
          }
          return;
        }

        if (absX <= STAGED_GROUP_PAN_THRESHOLD || absX < absY) return;
        state.mode = "panning";
        state.source.classList.add("is-panning");
      }

      if (state.mode === "panning") {
        palette.scrollLeft = state.scrollLeft + state.startX - event.clientX;
        if (absX > 8) state.source.dataset.dragged = "true";
      }
    }

    function endStagedGroupPointer(event) {
      if (!stagedGroupPointerState || event.pointerId !== stagedGroupPointerState.pointerId) return;
      const source = stagedGroupPointerState.source;
      cleanupStagedGroupPointer();
      setTimeout(() => { source.dataset.dragged = "false"; }, 0);
    }

    function cleanupStagedGroupPointer() {
      if (!stagedGroupPointerState) return;
      const { source, pointerId } = stagedGroupPointerState;
      source.removeEventListener("pointermove", moveStagedGroupPointer);
      source.removeEventListener("pointerup", endStagedGroupPointer);
      source.removeEventListener("pointercancel", endStagedGroupPointer);
      if (source.hasPointerCapture?.(pointerId)) {
        source.releasePointerCapture(pointerId);
      }
      source.classList.remove("is-panning");
      stagedGroupPointerState = null;
    }

    function isActiveGrabToolPointer(event) {
      return grabToolState && (!event || event.pointerId === grabToolState.pointerId);
    }

    function isActiveGrabSelectionBoxPointer(event) {
      return grabSelectionBoxState && (!event || event.pointerId === grabSelectionBoxState.pointerId);
    }

    function moveGrabTool(x, y) {
      if (!grabToolState) return;
      grabTool.style.left = `${x - grabToolState.offsetX}px`;
      grabTool.style.top = `${y - grabToolState.offsetY}px`;
    }

    function markCardsTouchedByGrabTool() {
      if (!grabToolState) return;

      const grabRect = BlockLayout.clientRect(grabTool);
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

    function updateGrabSelectionBox(currentX, currentY) {
      if (!grabSelectionBoxState) return;

      grabSelectionBoxState.currentX = currentX;
      grabSelectionBoxState.currentY = currentY;

      const rect = getRectFromPoints(
        grabSelectionBoxState.startX,
        grabSelectionBoxState.startY,
        currentX,
        currentY
      );
      Object.assign(grabSelectionBoxState.box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      });

      const selectedPathKeys = new Set();
      getGrabbableBlocks().forEach(block => {
        const pathKey = block.dataset.nodePath;
        if (!pathKey) return;
        if (isBlockTouchedByGrabTool(block, rect)) selectedPathKeys.add(pathKey);
      });

      grabMarkedPaths = new Set([
        ...grabSelectionBoxState.initialMarkedPathKeys,
        ...selectedPathKeys
      ]);

      getGrabbableBlocks().forEach(block => {
        const pathKey = block.dataset.nodePath;
        block.classList.toggle("grab-marked", Boolean(pathKey && grabMarkedPaths.has(pathKey)));
      });
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
        return loopFrameParts.some(part => rectsIntersect(grabRect, BlockLayout.clientRect(part)));
      }

      return rectsIntersect(grabRect, BlockLayout.clientRect(block));
    }

    function getRectFromPoints(x1, y1, x2, y2) {
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const right = Math.max(x1, x2);
      const bottom = Math.max(y1, y2);
      return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
      };
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
      if (dragState || grabToolState || grabSelectionBoxState) return;
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
      if (!effectivePaths.some(path => pathsEqual(path, sourcePath))) return [sourcePath];

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
      const rects = elements.map(element => BlockLayout.clientRect(element));
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
      BlockLayout.sequence(container);
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
      if (dragState || grabToolState || grabSelectionBoxState) event.preventDefault();
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
      const nestedZones = [...chain.querySelectorAll(".loop-inner.sequence-zone")]
        .map(zone => ({ zone, rect: dragState?.dropGeometry?.get(zone)?.rect || BlockLayout.clientRect(zone) }))
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

    function showDropMarker(target, preserveStartTop = BlockLayout.clientRect(startBlock).top) {
      target.zone.classList.add("drag-over");

      const marker = createDropProjection();

      const blocks = getDirectProgramBlocks(target.zone);
      const before = blocks[target.index] || getDirectEmptyNote(target.zone);
      target.zone.insertBefore(marker, before || null);
      updateProgramAnchor({ allowDuringDrag: true, includeDropProjection: true, preserveStartTop });
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

    function clearDropHints({ updateAnchor = true } = {}) {
      document.querySelectorAll(".sequence-zone.drag-over").forEach(zone => {
        zone.classList.remove("drag-over");
      });
      removeMarker({ updateAnchor });
    }

    function removeMarker({ updateAnchor = true } = {}) {
      const markers = document.querySelectorAll(".drop-projection");
      const preserveStartTop = updateAnchor && markers.length
        ? BlockLayout.clientRect(startBlock).top
        : null;
      markers.forEach(el => el.remove());
      if (markers.length && updateAnchor) {
        updateProgramAnchor({ allowDuringDrag: true, preserveStartTop });
      }
    }

    function moveGhost(x, y) {
      if (!dragState) return;
      dragState.ghost.style.left = `${x}px`;
      dragState.ghost.style.top = `${y}px`;
    }

    function getDropIndex(zone, pointerX) {
      const boundaries = dragState?.dropGeometry?.get(zone)?.boundaries;
      if (boundaries) {
        const index = boundaries.findIndex(x => pointerX < x);
        return index < 0 ? boundaries.length : index;
      }
      const blocks = getDirectProgramBlocks(zone);
      for (let i = 0; i < blocks.length; i++) {
        const rect = BlockLayout.clientRect(blocks[i]);
        const advance = Number(blocks[i].dataset.advance) || rect.width;
        if (pointerX < rect.left + advance / 2) return i;
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

    function updateProgramAnchor({ allowDuringDrag = false, includeDropProjection = false, preserveStartTop = null } = {}) {
      if (dragState && !allowDuringDrag) return;
      const programHeight = programArea.clientHeight;
      if (!programHeight) return;

      const preserveStartPosition = Number.isFinite(preserveStartTop);
      const startTopBefore = preserveStartPosition ? preserveStartTop : 0;
      const scrollTopBefore = programCanvas.scrollTop;
      BlockLayout.root(chain, programHeight);

      if (!preserveStartPosition) return;
      const scrollTopAfterLayout = programCanvas.scrollTop;
      const startTopAfter = BlockLayout.clientRect(startBlock).top;
      const startShift = startTopAfter - startTopBefore;
      if (Math.abs(startShift) < 0.5) return;

      programCanvas.scrollTop = scrollTopAfterLayout + startShift;
      const totalScrollShift = programCanvas.scrollTop - scrollTopBefore;
      if (dragState && allowDuringDrag && totalScrollShift) {
        dragState.canvasScrollTop += totalScrollShift;
      }
    }

    function isPointInDeleteZone(x, y) {
      const rect = BlockLayout.clientRect(deleteOverlay);
      return isPointInRect(x, y, rect);
    }

    function isPointInRootDropArea(x, y) {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
      return ![topbar, libraryArea, tabs].some(element => (
        element && isPointInRect(x, y, BlockLayout.clientRect(element))
      ));
    }

    function isPointInRect(x, y, rect) {
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function rectsIntersect(a, b) {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    function moveProgramNode(sourcePath, targetSequencePath, targetIndex) {
      if (!sourcePath || startsWithPath(targetSequencePath, sourcePath)
        || !getSequenceByPath(targetSequencePath)) return false;

      const sourceParentPath = sourcePath.slice(0, -1);
      const sourceIndex = sourcePath[sourcePath.length - 1];
      const sameSequence = pathsEqual(sourceParentPath, targetSequencePath);
      const item = removeNodeAtPath(sourcePath);
      if (!item) return false;

      const nextTargetPath = sameSequence
        ? targetSequencePath
        : adjustSequencePathAfterRemoval(targetSequencePath, sourcePath);
      const nextIndex = sameSequence && targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
      return insertNodeAtPath(nextTargetPath, nextIndex, item);
    }

    function moveProgramNodes(sourcePaths, targetSequencePath, targetIndex) {
      if (!sourcePaths?.length) return false;
      if (sourcePaths.some(path => startsWithPath(targetSequencePath, path))
        || !getSequenceByPath(targetSequencePath)) return false;

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
        document.dispatchEvent(new Event("card-workspace-changed"));
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
      document.dispatchEvent(new Event("card-workspace-changed"));
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
      if (window.CardHome?.save()) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeWorkspaceState()));
      setStatus("已保存");
    }

    function loadProgram() {
      if (window.CardHome?.load()) return;
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
      if (statusEl) statusEl.textContent = text;
    }

    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        selectCategory(tab.id.replace("tab-", ""));
      });
    });
    palette.addEventListener("pointerdown", startPaletteSwipe, true);
    document.addEventListener("pointermove", movePaletteSwipe, true);
    document.addEventListener("pointerup", finishPaletteSwipe, true);
    document.addEventListener("pointercancel", cancelPaletteSwipe, true);

    document.getElementById("saveBtn").addEventListener("click", saveProgram);
    const executionControls = document.querySelector(".execution-controls");
    const executionNotice = document.getElementById("executionNotice");
    let executionNoticeTimer;
    executionControls.addEventListener("pointerdown", event => event.stopPropagation());
    window.showExecutionNotice = text => {
      executionNotice.textContent = text;
      executionNotice.hidden = false;
      clearTimeout(executionNoticeTimer);
      executionNoticeTimer = setTimeout(() => { executionNotice.hidden = true; }, 7000);
    };
    undoBtn.addEventListener("click", undoProgram);
    redoBtn.addEventListener("click", redoProgram);
    document.getElementById("clearBtn").addEventListener("click", () => {
      closeParamEditor();
      const hadContent = program.length > 0 || stagedGroups.length > 0;
      program = [];
      stagedGroups = [];
      renderProgram();
      renderPalette();
      commitHistory();
      if (hadContent) playBlockSound("delete");
      setStatus("已清空");
    });

    grabTool?.addEventListener("pointerdown", startGrabToolDrag);
    programArea.addEventListener("pointerdown", startBlankGrabHold);
    programArea.addEventListener("contextmenu", event => {
      event.preventDefault();
    });

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
      updateCategorySlider(false);
      if (activeParamEditor) {
        positionParamEditor(findProgramBlockByPath(activeParamEditor.nodePath));
      }
    });
    if ("ResizeObserver" in window) {
      new ResizeObserver(scheduleProgramAnchorUpdate).observe(programArea);
    }

    renderPalette();
    updateCategorySlider(false);
    renderProgram();
    commitHistory();
