    const STORAGE_KEY = "xiaobaiVisualProgramV1";
    const LEGACY_STORAGE_KEY = "xiaobaiVisualProgramLegacy";

    let categories = CardModelSession.current.catalog;
    let modelArtworkByCard = CardModelSession.current.artworkByCard || {};
    let legacyCards = CardModelSession.current.legacyCards || [];
    let flatCards = [...Object.values(categories).flatMap(group => group.cards), ...legacyCards];
    let cardById = Object.fromEntries(flatCards.map(card => [card.id, card]));
    const chain = document.getElementById("chain");
    const palette = document.getElementById("palette");
    const statusEl = document.getElementById("status");
    const programArea = document.querySelector(".program-area");
    const programCanvas = document.querySelector(".program-canvas");
    programCanvas.style.overflowAnchor = "none";
    const appElement = document.querySelector(".app");
    const canvasBackgroundBtn = document.getElementById("canvasBackgroundBtn");
    function setCanvasBackground(dark) {
      document.documentElement.dataset.editorBackground = dark ? "dark" : "light";
      canvasBackgroundBtn.setAttribute("aria-pressed", String(dark));
      canvasBackgroundBtn.title = dark ? "切换为浅色背景" : "切换为深色背景";
    }
    setCanvasBackground(document.documentElement.dataset.editorBackground === "dark");
    canvasBackgroundBtn.addEventListener("click", () => {
      const dark = document.documentElement.dataset.editorBackground !== "dark";
      setCanvasBackground(dark);
      try {
        localStorage.setItem("cardEditorBackgroundV1", dark ? "dark" : "light");
      } catch (_) { /* Keep switching available even without persistent storage. */ }
    });
    const libraryArea = document.querySelector(".library-area");
    const tabs = document.querySelector(".tabs");
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    const paramEditor = document.getElementById("paramEditor");
    const tabSlider = document.querySelector(".tab-slider");
    const blockSounds = {
      place: new Audio("assets/sounds/block-place.wav"),
      delete: new Audio("assets/sounds/block-delete.mp3")
    };
    Object.values(blockSounds).forEach(audio => {
      audio.preload = "auto";
      audio.volume = 0.7;
    });
    let categoryOrder = Object.keys(categories);
    const categorySliderColors = {
      motor: "#e9f4ff", combo: "#fce9f6", logic: "#fff0de", dynamic: "#eee7ff"
    };

    let activeCategory = Object.keys(categories)[0] || "";
    let program = [];
    // The document owns structure; `program` is only the selected group's view
    // for the existing parameter editors and device-specific integrations.
    let canvasController = null;
    let executionLocked = false;
    function syncCanvasProgram() {
      if (!canvasController) return;
      const doc = canvasController.getDocument();
      program = doc.groups.find(group => group.id === doc.selectedGroupId)?.items || [];
    }
    function activeEditorItem() {
      if (!activeParamEditor) return null;
      if (canvasController && activeParamEditor.nodeUid)
        return CanvasWorkspace.findNode(canvasController.getDocument(), activeParamEditor.nodeUid)?.item || null;
      return getNodeAtPath(activeParamEditor.nodePath);
    }
    function openCanvasParamEditor(nodeUid, anchor) {
      if (executionLocked) return;
      const found = CanvasWorkspace.findNode(canvasController.getDocument(), nodeUid);
      if (!found) return;
      canvasController.select(found.group.id);
      syncCanvasProgram();
      openParamEditor(found.path, anchor);
    }
    function createStartVisual(message = false) {
      const node = document.createElement('div');
      node.className = 'block start';
      node.dataset.cardId = message ? '__message_start__' : '__start__'; node.dataset.mode = 'palette';
      node.setAttribute('role','button'); node.setAttribute('aria-label',message ? '添加收到消息开始' : '添加程序开始');
      const icon = document.createElement('img');
      icon.className = 'start-art-icon'; icon.alt = ''; icon.draggable = false;
      icon.src = message ? CardModelSession.current.messageStartIcon : CardModelSession.current.startIcon || 'assets/blocks/start.svg';
      icon.classList.toggle('model-art-icon',!message && CardModelSession.current.artStyle === 'fitted');
      if (message) {
        node.classList.add('message-start');

      }
      node.append(icon);
      if (message) {
        const bubble = document.createElement('span'); bubble.className = 'param-bubble option-dropdown-trigger';
        bubble.setAttribute('aria-hidden','true'); bubble.append(createDropdownArtwork()); node.append(bubble);
        node.classList.add('has-param-bubble');
      }
      BlockLayout.measure(node); return node;
    }
    let matrixPaintState = null;
    let programAnchorFrame = null;
    let activeParamEditor = null;
    let activeNumberKeypad = null;
    let renderedPaletteCatalog = null;
    let renderedPaletteModel = null;
    let paletteScrollFrame = null;
    let paletteScrollTarget = null;
    let tabSliderAnimation = null;
    let historySnapshots = [];
    let historyIndex = -1;
    const HISTORY_LIMIT = 80;

    function playBlockSound(type) {
      const audio = blockSounds[type];
      if (!audio) return;
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.play()?.catch(() => {});
      } catch (_) {}
    }

    function renderPalette(force = false) {
      // Editing a canvas changes its document, not its catalog. Keep the actual
      // palette nodes (and the user's scroll/drag position) alive across edits.
      const modelId = CardModelSession.current.id;
      if (!force && renderedPaletteCatalog === categories && renderedPaletteModel === modelId) return;
      paletteScrollTarget = null;
      const fragment = document.createDocumentFragment();
      if (canvasController) {
        const start = createStartVisual();
        // The single start head leads the whole strip and shares its first
        // scroll stop, so opening the first category keeps it in view.
        start.dataset.paletteCategory = categoryOrder[0];
        start.tabIndex = 0;
        fragment.appendChild(start);
        if (modelId === 'xiaobai') {
          const messageStart = createStartVisual(true);
          messageStart.dataset.paletteCategory = categoryOrder[0]; messageStart.tabIndex = 0;
          fragment.appendChild(messageStart);
        }
      }
      for (const [category, group] of Object.entries(categories)) {
        const nodes = group.cards.map(card => createBlock(card, "palette"));
        nodes.forEach(node => {
          node.dataset.paletteCategory = category;
          node.tabIndex = 0;
          fragment.appendChild(node);
        });
      }
      palette.replaceChildren(fragment);
      palette.setAttribute("role", "group");
      palette.setAttribute("aria-label", "积木栏，左右浏览全部积木");
      renderedPaletteCatalog = categories;
      renderedPaletteModel = modelId;
      palette.scrollLeft = 0;
      updatePaletteTrailingSpace();
      schedulePaletteScrollSync();
    }

    function selectCategory(category, animate = true) {
      if (!categories[category]) return;
      renderPalette();
      setActiveCategory(category, animate);
      const first = palette.querySelector(`[data-palette-category="${category}"]`);
      if (!first) return;
      const left = paletteCategoryLeft(first);
      paletteScrollTarget = {category, left};
      const smooth = animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      palette.scrollTo({left, behavior: smooth ? "smooth" : "auto"});
      schedulePaletteScrollSync();
    }

    function setActiveCategory(category, animate = true) {
      activeCategory = category;
      tabs.querySelectorAll(".tab").forEach(tab => {
        const selected = tab.id === `tab-${category}`;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      updateCategorySlider(animate);
    }

    function paletteCategoryLeft(first) {
      const padding = parseFloat(getComputedStyle(palette).paddingLeft) || 0;
      return Math.max(0, palette.scrollLeft + BlockLayout.clientRect(first).left - BlockLayout.clientRect(palette).left - padding);
    }

    function updatePaletteTrailingSpace() {
      const lastCategory = categoryOrder[categoryOrder.length - 1];
      const first = palette.querySelector(`[data-palette-category="${lastCategory}"]`);
      const last = palette.lastElementChild;
      if (!first || !last) return;
      // Give the final category just enough trailing room to align its first
      // card, without dummy blocks or viewport-specific connection geometry.
      const width = BlockLayout.clientRect(last).right - BlockLayout.clientRect(first).left;
      const padding = parseFloat(getComputedStyle(palette).paddingLeft) || 0;
      palette.style.paddingRight = `${Math.max(padding, palette.clientWidth - width - padding)}px`;
    }

    function syncPaletteScroll() {
      paletteScrollFrame = null;
      if (paletteScrollTarget) {
        if (Math.abs(palette.scrollLeft - paletteScrollTarget.left) > 1) return;
        const category = paletteScrollTarget.category;
        paletteScrollTarget = null;
        if (category !== activeCategory) setActiveCategory(category, false);
        return;
      }
      let category = categoryOrder[0];
      for (const candidate of categoryOrder) {
        const first = palette.querySelector(`[data-palette-category="${candidate}"]`);
        if (first && paletteCategoryLeft(first) <= palette.scrollLeft + 2) category = candidate;
      }
      if (category && category !== activeCategory) setActiveCategory(category, false);
    }

    function schedulePaletteScrollSync() {
      if (paletteScrollFrame === null) paletteScrollFrame = requestAnimationFrame(syncPaletteScroll);
    }

    function updateCategorySlider(animate = true) {
      const selected = document.getElementById(`tab-${activeCategory}`);
      if (!tabSlider || !selected) return;
      const targetX = selected.offsetLeft;
      const targetWidth = selected.offsetWidth;
      const targetColor = categorySliderColors[activeCategory] || "#e9f4fc";
      const targetOpacity = 1;
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
      if (!animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || Math.abs(currentX - targetX) < .5) return;
      tabSliderAnimation = tabSlider.animate([
        { transform: `translateX(${currentX}px)`, width: `${currentWidth}px`, backgroundColor: currentColor, opacity: currentOpacity },
        { transform: `translateX(${targetX}px)`, width: `${targetWidth}px`, backgroundColor: targetColor, opacity: targetOpacity }
      ], { duration: 220, easing: "cubic-bezier(.4,0,.2,1)" });
      tabSliderAnimation.addEventListener("finish", () => { tabSliderAnimation = null; }, { once: true });
    }

    function createPreviewNode(item) {
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

    function renderProgram() {
      if (!canvasController) return;
      closeParamEditor(); syncCanvasProgram(); canvasController.render();
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
      const node = card?.kind === "loop" ? createLoopBlock(item, nodePath) : createBlock(card, "program", nodePath, item);
      node.dataset.nodeUid = item.uid;
      return node;
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

      return block;
    }

    function renderBlockContent(block, card, mode, item = null, nodePath = []) {
      block.replaceChildren();
      block.classList.add("icon-card");
      block.classList.toggle("wait-card", card.icon === "hourglass");
      block.classList.toggle("sensor-card", card.icon === "ultrasonic");
      block.classList.toggle("matrix-card", hasMatrixParams(card));

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

    function usesIconDropdown(card) {
      return CardModelSession.current.id === 'xiaobai' && [
        'eye-matrix','eye-expression','loop-tilt','motion-wait','tilt-wait','send-message','combo-continuous','motor-power','combo-power'
      ].includes(card.id);
    }

    function createDropdownArtwork() {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns,'svg');
      svg.classList.add('param-dropdown-art');
      svg.setAttribute('viewBox','32 108 436 284');
      svg.setAttribute('aria-hidden','true');
      const path = document.createElementNS(ns,'path');
      path.setAttribute('transform',"matrix(1,0,0,-1,451.7775,174.58621)");
      path.setAttribute('d',"M0 0C0-13.04-4.98-26.08-14.93-36.03L-165.75-186.86C-185.65-206.75-217.91-206.75-237.81-186.86L-388.63-36.03C-408.53-16.13-408.53 16.13-388.63 36.03-378.68 45.98-365.64 50.95-352.6 50.95-339.56 50.95-326.52 45.98-316.58 36.03L-201.78-78.77-86.98 36.03C-67.08 55.92-34.82 55.92-14.93 36.03-4.98 26.08 0 13.04 0 0");
      path.setAttribute('fill','#fff'); path.setAttribute('stroke','currentColor');
      path.setAttribute('stroke-width','20'); path.setAttribute('stroke-linejoin','round');
      svg.append(path); return svg;
    }

    function createParamBubble(card, mode, item, nodePath) {
      const isProgramControl = mode === "program";
      const bubble = document.createElement(isProgramControl ? "button" : "span");
      bubble.className = "param-bubble";
      bubble.classList.toggle("matrix-param-trigger", hasMatrixParams(card));
      const iconDropdown = usesIconDropdown(card);
      bubble.classList.toggle("option-dropdown-trigger",iconDropdown);
      if (iconDropdown) {
        bubble.title = getParamBubbleText(card,item) || card.label;
        bubble.append(createDropdownArtwork());
      } else bubble.textContent = getParamBubbleText(card, item);

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
      if (['send-message','send-message-wait'].includes(card.id)) {
        const icon = document.createElement('span'); icon.className = 'card-icon message-card-icon';
        const selected = CardModelSession.current.messageColors?.find(option => option.value === getParamValue(card,item,'message'));
        const image = document.createElement('img');
        image.src = selected?.closedIcon || CardModelSession.current.messageSendIcon;
        image.alt = ''; image.draggable = false; icon.append(image); return icon;
      }
      if (card.icon && !["hourglass", "ultrasonic", "matrix"].includes(card.icon)) {
        const icon=document.createElement('img');icon.className='card-icon';icon.src=card.icon;icon.alt='';icon.draggable=false;return icon;
      }
      const icon = document.createElement("span");
      icon.className = "card-icon";
      const artwork = modelArtworkByCard[card.id] || card;
      const modelArtwork = (!item && artwork.paletteArtIcon) ||
        artwork.artIcons?.[getParamValue(card, item, artwork.artParam || "direction")] || artwork.artIcon;
      if (modelArtwork && (!hasMatrixParams(card) || !item)) {
        icon.classList.add("ai-art-icon");
        icon.classList.toggle("model-art-icon", artwork.artStyle === "fitted");
        const image = document.createElement("img");
        image.src = `assets/blocks/${modelArtwork}.svg`;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        icon.appendChild(image);
        return icon;
      }
      if (card.id === "eye-matrix") {
        icon.classList.add("dual-eye-matrix-icon");
        ["leftPattern", "rightPattern"].forEach(key => {
          icon.appendChild(createMatrixPreview(getParamValue(card, item, key), card.paramsSchema[key]));
        });
        return icon;
      }
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
      if (card.artIcon) artIcons[card.id] = card.artIcon;
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
        icon.appendChild(createMatrixPreview(getMatrixPattern(card, item), card.paramsSchema.pattern));
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

    function createMatrixPreview(pattern, definition = {}) {
      const preview = document.createElement("span");
      preview.className = "matrix-preview";
      const { rows, columns, disabledIndexes } = matrixGeometry(definition);
      preview.style.setProperty("--matrix-rows", rows);
      preview.style.setProperty("--matrix-columns", columns);
      pattern.forEach((value, index) => {
        const dot = document.createElement("span");
        dot.className = "matrix-dot";
        dot.classList.toggle("is-on", Boolean(value));
        dot.classList.toggle("is-missing", disabledIndexes.has(index));
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
      tail.appendChild(createCardIcon(card, item));
      if (card.paramsSchema) {
        tail.appendChild(createParamBubble(card, "program", item, nodePath));
      }

      loop.append(top, left, inner, tail);
      loop.title = card.label;
      BlockLayout.measure(loop);
      return loop;
    }

    function addCard(cardId, sequencePath = [], insertIndex) {
      if (executionLocked) return;
      if (canvasController) { canvasController.add(cardId); return; }
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
      return card.color || categories[card.type]?.color || `var(--${card.type})`;
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

    function hasMatrixParams(card) {
      return Object.values(card?.paramsSchema || {}).some(definition => definition.type === "matrix");
    }

    function matrixGeometry(definition = {}) {
      const dimension = value => Number.isInteger(value) && value > 0 ? value : 5;
      const rows = dimension(definition.rows ?? definition.size);
      const columns = dimension(definition.columns ?? definition.size);
      const disabledIndexes = new Set((definition.disabledIndexes || []).filter(index =>
        Number.isInteger(index) && index >= 0 && index < rows * columns));
      return { rows, columns, disabledIndexes };
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
        const { rows, columns, disabledIndexes } = matrixGeometry(definition);
        const length = rows * columns;
        const source = Array.isArray(rawValue) ? rawValue : definition.default;
        const values = Array.isArray(source) ? source : [];
        return Array.from({ length }, (_, index) => !disabledIndexes.has(index) && values[index] ? 1 : 0);
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
      if (card.id === "self-learned-wait") return `指令${getParamValue(card, item, "slot")}`;
      if (card.id === "loop-time") return `${formatParamNumber(getParamValue(card, item, "duration"))}秒`;
      if (card.id.endsWith("-continuous")) {
        if (card.id === "combo-continuous") return `持续${getParamOptionDisplay(card.paramsSchema.direction,getParamValue(card,item,"direction"))}`;
        const port = card.paramsSchema?.port ? getParamOptionDisplay(card.paramsSchema.port, getParamValue(card, item, "port")) : "";
        return `${port}${card.id === "motor-forward-continuous" ? "持续正转" : "持续反转"}`;
      }
      if (card.id === "play-note") return `${getParamValue(card, item, "note")}·${getParamValue(card, item, "beats")}拍`;
      if (hasMatrixParams(card)) {
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

    function createMessageOptions(current, onChange, kind = 'closed') {
      const options = document.createElement('div'); options.className = 'message-options';
      options.setAttribute('role','group'); options.setAttribute('aria-label','消息颜色与编号');
      for (const message of CardModelSession.current.messageColors || []) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'message-option'; button.dataset.message = message.value;
        button.classList.toggle('is-selected',current === message.value);
        button.setAttribute('aria-pressed',String(current === message.value));
        button.setAttribute('aria-label',`${message.label}消息 ${message.value}`);
        button.style.setProperty('--message-color',message.color);
        const image = document.createElement('img'); image.className = 'message-option-art';
        image.src = kind === 'open' ? message.openIcon : message.closedIcon;
        image.alt = ''; image.draggable = false; button.title = `${message.label}消息 ${message.value}`;
        button.append(image); button.addEventListener('click',()=>onChange(message.value)); options.append(button);
      }
      return options;
    }

    function openCanvasHeadParamEditor(groupId, anchor) {
      if (executionLocked || CardModelSession.current.id !== 'xiaobai') return;
      const group = CanvasWorkspace.findGroup(canvasController.getDocument(),groupId);
      if (!group?.startId || group.trigger?.type !== 'message') return;
      closeParamEditor(); canvasController.select(groupId);
      activeParamEditor = {headGroupId:groupId,groupId,nodePath:[]};
      renderHeadParamEditor(anchor);
    }

    function setHeadMessage(message) {
      if (executionLocked || !activeParamEditor?.headGroupId) return;
      const groupId = activeParamEditor.headGroupId,doc = canvasController.getDocument();
      const group = CanvasWorkspace.findGroup(doc,groupId);
      if (!group?.startId || group.trigger?.type !== 'message' || group.trigger.message === message ||
          !CardModelSession.current.messageColors?.some(option=>option.value === message)) return;
      if (doc.groups.filter(candidate=>candidate.startId).length > 4) { setStatus('小白作品最多支持 4 个开始头，请先移除多余的开始头。'); return; }
      try {
        canvasController.commitExternal(current=>CanvasWorkspace.setTrigger(current,groupId,{type:'message',message}),{reason:'head-trigger'});
        renderHeadParamEditor();
      } catch (error) { setStatus(error.message || '无法修改消息颜色。'); }
    }

    function renderHeadParamEditor(anchor) {
      const groupId = activeParamEditor?.headGroupId;
      const group = CanvasWorkspace.findGroup(canvasController.getDocument(),groupId);
      if (!group?.startId || group.trigger?.type !== 'message' || executionLocked) { closeParamEditor(); return; }
      paramEditor.replaceChildren(); paramEditor.hidden = false;
      paramEditor.classList.add('is-head-trigger');
      paramEditor.setAttribute('role','dialog'); paramEditor.setAttribute('aria-label','消息颜色');
      paramEditor.style.setProperty('--editor-color','var(--logic)');
      paramEditor.style.setProperty('--editor-edge','#C98A01'); paramEditor.style.setProperty('--editor-secondary','#ECA100');
      const panel = document.createElement('div'); panel.className = 'param-editor-panel message-param-editor';
      panel.append(createMessageOptions(group.trigger.message,setHeadMessage,'open'));
      paramEditor.append(panel); positionParamEditor(anchor || findProgramBlockByPath([]));
    }

    function openParamEditor(nodePath, anchor) {
      if (executionLocked) return;
      const item = getNodeAtPath(nodePath);
      const card = cardById[item?.id];
      if (!item || !card?.paramsSchema) return;

      cancelMatrixPaint();
      activeNumberKeypad = null;
      activeParamEditor = {
        nodePath: [...nodePath], nodeUid: item.uid,
        groupId: canvasController?.getSelectedGroup()?.id || null
      };
      renderParamEditor(anchor);
    }

    function renderParamEditor(anchor) {
      if (executionLocked) { closeParamEditor(); return; }
      if (!activeParamEditor) return;
      if (activeParamEditor.headGroupId) { renderHeadParamEditor(anchor); return; }
      const item = activeEditorItem();
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
      paramEditor.classList.toggle("is-learned-command", card.id === "self-learned-wait");
      paramEditor.classList.toggle("is-matrix", hasMatrixParams(card));
      paramEditor.classList.toggle("is-dual-eye-matrix", card.id === "eye-matrix");
      paramEditor.classList.toggle("is-number-keypad", Boolean(activeNumberKeypad));
      paramEditor.classList.remove('is-head-trigger');
      paramEditor.appendChild(activeNumberKeypad
        ? createNumberKeypad(card)
        : createGenericParamEditor(card, item));

      positionParamEditor(anchor || findProgramBlockByPath(activeParamEditor.nodePath));
    }

    function createGenericParamEditor(card, item) {
      const panel = document.createElement("div");
      panel.className = "param-editor-panel";
      panel.classList.toggle("loop-param-editor", card.kind === "loop");
      if (['send-message','send-message-wait'].includes(card.id)) {
        panel.classList.add('message-param-editor');
        panel.append(createMessageOptions(getParamValue(card,item,'message'),value=>setActiveParamValue('message',value)));
        return panel;
      }
      if (card.id === "self-learned-wait" && window.CardLearnedCommands) {
        return window.CardLearnedCommands.createEditor({
          slot: getParamValue(card, item, "slot"),
          onSlotChange: slot => {
            if (executionLocked || window.CardProgram?.running || window.CardBluetooth?.remoteConnection?.()?.learned?.getSnapshot().busy) return;
            setActiveParamValue("slot", slot);
          },
          onLayout: () => {
            if (activeParamEditor && paramEditor.classList.contains("is-learned-command"))
              positionParamEditor(findProgramBlockByPath(activeParamEditor.nodePath));
          }
        });
      }
      if (card.id === "eye-matrix") {
        panel.classList.add("dual-eye-matrix-editor");
        ["leftPattern", "rightPattern"].forEach(key => panel.appendChild(createMatrixParamEditor(card, item, key)));
        return panel;
      }
      if (card.id === "motor-power" || card.id === "combo-power") {
        panel.classList.add("motor-power-editor");
        for (const key of ["port", "power"]) {
          const definition = card.paramsSchema[key];
          if (!definition) continue;
          const row = createSelectParamEditor(card, item, key, definition);
          row.setAttribute("role", "group");
          row.setAttribute("aria-label", definition.label || key);
          panel.appendChild(row);
        }
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

      if (card.paramHelp && card.kind !== "loop") {
        const help = document.createElement("p");
        help.className = "param-help";
        help.textContent = card.paramHelp;
        panel.appendChild(help);
      }

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
        const optionIcon = modelArtworkByCard[card.id]?.optionIcons?.[key]?.[value] ||
          (typeof option === "object" ? option.icon : null);
        if (optionIcon) {
          button.classList.add("has-option-art"); button.title = getParamOptionDisplay(definition, value);
          const image = document.createElement("img"); image.className = "param-option-art";
          image.src = optionIcon; image.alt = ""; image.draggable = false;
          button.replaceChildren(image);
        }
        button.setAttribute("aria-label", typeof option === "object" ? option.label : value === "L/M1" ? "左电机 L" : value === "R/M2" ? "右电机 R" : option);
        if ((card.id === "motor-power" || card.id === "combo-power") && key === "power") {
          button.classList.add("power-option");
          button.title = optionIcon ? `${value}档` : `功率 ${value}%`;
          if (!optionIcon) button.replaceChildren(createPowerBars(Number(value)));
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
      const definition = card.paramsSchema[key];
      const { rows, columns, disabledIndexes } = matrixGeometry(definition);
      if (card.id === "eye-matrix") {
        const title = document.createElement("div");
        title.className = "matrix-editor-title";
        title.textContent = definition.label;
        panel.appendChild(title);
      }
      const grid = document.createElement("div");
      grid.className = "matrix-editor-grid";
      grid.style.setProperty("--matrix-rows", rows);
      grid.style.setProperty("--matrix-columns", columns);
      grid.addEventListener("pointerdown", startMatrixPaint);
      grid.dataset.paramKey = key;
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", definition.label || "点阵图案");

      pattern.forEach((value, index) => {
        const button = document.createElement("button");
        button.className = "matrix-cell";
        button.classList.toggle("is-on", Boolean(value));
        button.classList.toggle("is-missing", disabledIndexes.has(index));
        button.disabled = disabledIndexes.has(index);
        button.type = "button";
        button.dataset.matrixIndex = String(index);
        button.setAttribute("aria-label", `${definition.label || "点阵"}第${Math.floor(index / columns) + 1}行第${index % columns + 1}列`);
        button.setAttribute("aria-pressed", String(Boolean(value)));
        grid.appendChild(button);
      });

      panel.appendChild(grid);
      return panel;
    }

    function startMatrixPaint(event) {
      if (executionLocked) return;
      if (event.button > 0 || matrixPaintState || !activeParamEditor) return;
      const cell = event.target.closest(".matrix-cell");
      if (!cell || cell.disabled) return;
      event.preventDefault();
      event.stopPropagation();

      const grid = event.currentTarget;
      const item = activeEditorItem();
      const card = cardById[item?.id];
      const paramKey = grid.dataset.paramKey || "pattern";
      const definition = card?.paramsSchema?.[paramKey];
      if (!item || definition?.type !== "matrix") return;

      matrixPaintState = {
        pointerId: event.pointerId,
        grid,
        paramKey,
        item,
        nodePath: [...activeParamEditor.nodePath],
        disabledIndexes: matrixGeometry(definition).disabledIndexes,
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
      grid.addEventListener("lostpointercapture", endMatrixPaint);
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
      const state = matrixPaintState;
      const valid = activeParamEditor && pathsEqual(activeParamEditor.nodePath, state.nodePath) &&
        getNodeAtPath(state.nodePath) === state.item;
      cancelMatrixPaint();
      // The grid already reflects the stroke; keep its touch target alive through touchend.
      if (valid) setActiveParamValue(state.paramKey, state.pattern, false);
    }

    function cancelMatrixPaint() {
      if (!matrixPaintState) return;
      const { grid, pointerId } = matrixPaintState;
      matrixPaintState = null;
      grid.removeEventListener("pointermove", moveMatrixPaint);
      grid.removeEventListener("pointerup", endMatrixPaint);
      grid.removeEventListener("pointercancel", endMatrixPaint);
      grid.removeEventListener("lostpointercapture", endMatrixPaint);
      if (grid.hasPointerCapture?.(pointerId)) {
        grid.releasePointerCapture(pointerId);
      }
    }

    function paintMatrixCell(index) {
      if (!activeParamEditor) return;
      if (!Number.isInteger(index) || index < 0) return;
      if (matrixPaintState?.paintedIndexes.has(index)) return;
      if (matrixPaintState?.disabledIndexes.has(index)) return;

      const pattern = matrixPaintState?.pattern;
      if (!pattern) return;
      if (index >= pattern.length) return;
      matrixPaintState?.paintedIndexes.add(index);
      pattern[index] = pattern[index] ? 0 : 1;
      const cell = matrixPaintState.grid.querySelector(`.matrix-cell[data-matrix-index="${index}"]`);
      cell?.classList.toggle("is-on", Boolean(pattern[index]));
      cell?.setAttribute("aria-pressed", String(Boolean(pattern[index])));
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
          const item = activeEditorItem();
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
      const item = activeEditorItem();
      const card = cardById[item?.id];
      const definition = card?.paramsSchema?.[key];
      if (!item || !definition) return;

      const current = getParamValue(card, item, key);
      // Button increments are independent of the keypad's decimal precision.
      setActiveParamValue(key, current + direction);
    }

    function setActiveParamValue(key, value, rerenderEditor = true) {
      if (executionLocked) return;
      if (!activeParamEditor) return;
      const item = activeEditorItem();
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
      const node = getNodeAtPath(nodePath);
      activeParamEditor = { nodePath, nodeUid: node?.uid, groupId: canvasController?.getSelectedGroup()?.id || null };
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
      if (canvasController) {
        if (activeParamEditor?.headGroupId) {
          const groupId = activeParamEditor.headGroupId;
          return [...chain.querySelectorAll('.free-canvas-start')].find(head=>head.dataset.groupId === groupId) || null;
        }
        const item = activeParamEditor?.nodeUid && pathsEqual(nodePath, activeParamEditor.nodePath)
          ? activeEditorItem() : getNodeAtPath(nodePath);
        return item ? canvasController.findElement(item.uid) : null;
      }
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
      cancelMatrixPaint();
      activeParamEditor = null;
      activeNumberKeypad = null;
      paramEditor.hidden = true;
      paramEditor.classList.remove("is-matrix", "is-dual-eye-matrix", "is-above-anchor", "is-number-keypad", "is-side-anchor", "is-right-of-anchor", "is-left-of-anchor", "is-head-trigger");
      paramEditor.style.removeProperty("--param-arrow-left");
      paramEditor.style.removeProperty("--param-arrow-top");
      paramEditor.replaceChildren();
    }

    function cleanupClonedProgramBlock(clone) {
      clone.classList.remove("grab-marked", "drag-source-placeholder", "ghost", "drop-projection");
      clone.querySelectorAll(".grab-marked, .drag-source-placeholder, .ghost, .drop-projection").forEach(item => {
        item.classList.remove("grab-marked", "drag-source-placeholder", "ghost", "drop-projection");
      });
      clone.querySelectorAll("[id]").forEach(item => item.removeAttribute("id"));
    }

    // Navigation, native lifecycle and model switching share this cancellation entry.
    function cancelDrag() {
      canvasController?.cancel();
      cancelMatrixPaint();
    }

    function scheduleProgramAnchorUpdate() {
      if (programAnchorFrame) return;
      programAnchorFrame = requestAnimationFrame(() => {
        programAnchorFrame = null;
        canvasController?.layout();
      });
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
      return canvasController ? CanvasWorkspace.clone(canvasController.getDocument()) : CanvasWorkspace.create();
    }

    function applyWorkspaceState(rawState, loadOptions = {}) {
      if (!canvasController || (executionLocked && !loadOptions.force)) return false;
      canvasController.cancel(); closeParamEditor();
      const options = { normalizeItem };
      const doc = rawState?.kind === 'free-canvas' && rawState.schemaVersion === 2
        ? CanvasWorkspace.normalize(rawState, options) : CanvasWorkspace.fromLegacy(rawState, options);
      canvasController.load(doc, loadOptions); syncCanvasProgram();
      return true;
    }

    // Run data is detached from the editable document. Array paths describe this
    // snapshot only; the stable uid is the identity used to locate a visible block.
    function getRunSnapshot(options = {}) {
      const doc = canvasController.getDocument();
      const xiaobai = CardModelSession.current.id === 'xiaobai';
      const headedGroups = doc.groups.filter(group => group.startId);
      const requestedGroupId = options.groupId ?? (options.all === false ? doc.selectedGroupId : undefined);
      if (xiaobai && headedGroups.length > 4) throw new Error('小白作品最多支持 4 个开始头，请先移除多余的开始头。');
      let groups;
      if (options.groupId !== undefined && options.groupId !== null) {
        const group = doc.groups.find(candidate => candidate.id === options.groupId);
        if (!group?.startId) throw new Error('请选择一个带开始头的程序组。');
        groups = xiaobai ? headedGroups : [group];
      } else if (options.all === false) {
        const group = doc.groups.find(candidate => candidate.id === doc.selectedGroupId);
        if (!group?.startId) throw new Error('请选择一个带开始头的程序组。');
        groups = xiaobai ? headedGroups : [group];
      } else groups = doc.groups.filter(group => group.startId);
      if (!groups.length) throw new Error('请先放入带开始头的程序组。');
      if (groups.length > 4) throw new Error('一次最多运行 4 个程序组。');
      if (xiaobai && options.groupId == null && options.all !== false && !groups.some(group=>group.trigger === undefined))
        throw new Error('请至少放入一个普通开始头，或点击消息开始头测试运行。');
      groups = [...groups].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const valid = CanvasWorkspace.validate({ ...doc, groups, selectedGroupId: null });
      if (!valid.ok) throw new Error('程序结构或积木标识无效，请检查程序组。');
      let count = 0;
      function copyValue(value, ancestors = new Set()) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('积木参数无效。');
        const next = new Set(ancestors); next.add(value);
        if (Array.isArray(value)) return value.map(entry => copyValue(entry, next));
        const result = {};
        for (const key of Object.keys(value)) Object.defineProperty(result, key, {
          value: copyValue(value[key], next), enumerable: true, configurable: true, writable: true
        });
        return result;
      }
      function items(sequence, depth = 0, groupId) {
        if (depth > 20) throw new Error('循环嵌套最多支持 20 层。');
        return sequence.map(item => {
          if (++count > 1000) throw new Error('一次运行合计最多支持 1000 块积木。');
          if (!cardById[item.id]) {
            const error = new Error('当前型号不支持此积木：' + item.id);
            error.groupId = groupId; error.blockUid = item.uid; throw error;
          }
          const stored = { uid: item.uid, id: item.id, params: copyValue(item.params) };
          if (Array.isArray(item.children)) stored.children = items(item.children, depth + 1, groupId);
          return stored;
        });
      }
      const snapshot = {
        schemaVersion: 1,
        modelId: CardModelSession.current.id,
        projectId: window.CardHome?.activeProjectId || null,
        launchOrder: requestedGroupId == null ? groups.map(group => group.id) : [requestedGroupId],
        groups: groups.map(group => {
          if (!group.items.length && !xiaobai) {
            const error = new Error('开始头后还没有积木，请先添加程序。');
            error.groupId = group.id; error.blockUid = group.startId; throw error;
          }
          return { groupId: group.id, startId: group.startId, items: items(group.items, 0, group.id),
            ...(group.trigger === undefined ? {} : {trigger:copyValue(group.trigger)}) };
        })
      };
      if (xiaobai && requestedGroupId != null) snapshot.manualGroupId = requestedGroupId;
      function freeze(value) {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
        return value;
      }
      return freeze(snapshot);
    }

    function setExecutionLocked(locked) {
      const next = Boolean(locked);
      if (executionLocked === next) return executionLocked;
      executionLocked = next;
      canvasController?.setEditingLocked(executionLocked);
      syncCanvasProgram();
      if (executionLocked) { cancelMatrixPaint(); closeParamEditor(); }
      appElement.classList.toggle('is-execution-locked', executionLocked);
      updateHistoryButtons();
      return executionLocked;
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
      if (executionLocked) return;
      if (historyIndex <= 0) return;
      historyIndex -= 1;
      restoreProgramSnapshot(historySnapshots[historyIndex]);
      updateHistoryButtons();
      setStatus("已撤销");
    }

    function redoProgram() {
      if (executionLocked) return;
      if (historyIndex < 0 || historyIndex >= historySnapshots.length - 1) return;
      historyIndex += 1;
      restoreProgramSnapshot(historySnapshots[historyIndex]);
      updateHistoryButtons();
      setStatus("已前进");
    }

    function updateHistoryButtons() {
      undoBtn.disabled = executionLocked || historyIndex <= 0;
      redoBtn.disabled = executionLocked || historyIndex < 0 || historyIndex >= historySnapshots.length - 1;
    }

    function saveProgram() {
      if (window.CardHome) { window.CardHome.save(); return; }
      if (window.CardHome?.save()) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeWorkspaceState()));
      setStatus("已保存");
    }

    function loadProgram() {
      if (executionLocked) return false;
      if (window.CardHome) { window.CardHome.load(); return; }
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

    tabs.addEventListener("click", event => {
      const tab = event.target.closest('.tab');
      if (tab) selectCategory(tab.id.replace('tab-', ''));
    });
    tabs.addEventListener("keydown", event => {
      const tab = event.target.closest('.tab');
      if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = categoryOrder.indexOf(tab.id.slice(4));
      const next = event.key === "Home" ? 0 : event.key === "End" ? categoryOrder.length - 1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + categoryOrder.length) % categoryOrder.length;
      selectCategory(categoryOrder[next]);
      document.getElementById(`tab-${categoryOrder[next]}`)?.focus({preventScroll:true});
    });
    palette.addEventListener("scroll", schedulePaletteScrollSync, {passive:true});
    palette.addEventListener("wheel", () => { paletteScrollTarget = null; }, {passive:true});
    // Register before the canvas pointer controller, which owns and captures
    // palette drag/browse gestures. A finger takes over any tab-initiated scroll.
    document.addEventListener("pointerdown", event => {
      if (event.target instanceof Element && palette.contains(event.target)) paletteScrollTarget = null;
    }, {capture:true, passive:true});
    palette.addEventListener("keydown", event => {
      const card = event.target.closest('[data-card-id][data-mode="palette"]');
      if (!card || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      canvasController?.add(card.dataset.cardId);
    });

    document.getElementById("saveBtn").addEventListener("click", saveProgram);
    const editorToolsToggle = document.getElementById("editorToolsToggle");
    const editorMoreTools = document.getElementById("editorMoreTools");
    let editorToolsExpanded = false;
    // Keep the strip measurable so its width can animate in both directions.
    editorMoreTools.hidden = false;
    function setEditorToolsExpanded(expanded) {
      closeParamEditor();
      editorToolsExpanded = expanded;
      if (!expanded && editorMoreTools.contains(document.activeElement)) editorToolsToggle.focus();
      editorMoreTools.inert = !expanded;
      editorMoreTools.setAttribute("aria-hidden", String(!expanded));
      if (expanded) editorMoreTools.scrollLeft = 0;
      editorToolsToggle.setAttribute("aria-expanded", String(expanded));
      editorToolsToggle.title = expanded ? "收起工具栏" : "展开工具栏";
      editorToolsToggle.setAttribute("aria-label", editorToolsToggle.title);
      editorToolsToggle.closest(".topbar").classList.toggle("is-expanded", expanded);
    }
    editorToolsToggle.addEventListener("click", () => setEditorToolsExpanded(!editorToolsExpanded));
    editorToolsToggle.closest(".topbar").addEventListener("keydown", event => {
      if (event.key === "Escape" && editorToolsExpanded) {
        event.preventDefault(); setEditorToolsExpanded(false); editorToolsToggle.focus();
      }
    });
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
      if (executionLocked) return;
      closeParamEditor();
      const hadContent = canvasController.getDocument().groups.length > 0;
      if (canvasController) { canvasController.load(CanvasWorkspace.create()); syncCanvasProgram(); }
      program = [];
      renderProgram();
      renderPalette();
      commitHistory();
      if (hadContent) playBlockSound("delete");
      setStatus("已清空");
    });

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
      if (paramEditor.hidden) return;
      if (paramEditor.contains(event.target)) return;
      if (event.target.closest(".icon-card.program-block")) return;
      closeParamEditor();
    }, true);

    window.addEventListener("resize", () => {
      scheduleProgramAnchorUpdate();
      paletteScrollTarget = null;
      updatePaletteTrailingSpace();
      schedulePaletteScrollSync();
      updateCategorySlider(false);
      if (activeParamEditor) {
        positionParamEditor(findProgramBlockByPath(activeParamEditor.nodePath));
      }
    });
    if ("ResizeObserver" in window) {
      new ResizeObserver(scheduleProgramAnchorUpdate).observe(programArea);
      new ResizeObserver(() => {
        updatePaletteTrailingSpace();
        schedulePaletteScrollSync();
      }).observe(palette);
    }

    canvasController = FreeCanvas.create({
      area: programArea, viewport: programCanvas, chain, palette, library: libraryArea,
      controls: editorMoreTools,
      model: () => CardModelSession.current,
      createNode: createProgramNode, createItem: createProgramItem,
      onChange: (doc, options = {}) => {
        syncCanvasProgram();
        if (options.viewOnly) {
          if (options.reason === 'viewport') closeParamEditor();
          document.dispatchEvent(new Event('card-workspace-changed'));
        }
        else { renderPalette(); commitHistory(); playBlockSound(options.reason === 'delete' ? 'delete' : 'place'); }
      },
      onSelect: () => syncCanvasProgram(),
      onParam: openCanvasParamEditor,
      onHeadParam: openCanvasHeadParamEditor,
      createDropdownArtwork,
      onRun: groupId => window.CardProgram?.runGroup(groupId),
      onStatus: setStatus,
      onGesture: () => closeParamEditor(),
      cancelLegacy: cancelMatrixPaint
    });
    window.CardCanvas = canvasController;
    document.body.classList.add('free-canvas-enabled');
    renderPalette();
    updateCategorySlider(false);
    renderProgram();
    commitHistory();

    window.CardEditor = {
      getWorkspace: serializeWorkspaceState,
      setWorkspace(state) {
        if (executionLocked || !applyWorkspaceState(state)) return false;
        renderPalette(); renderProgram(); commitHistory(); return true;
      },
      getRunSnapshot,
      setExecutionLocked,
      get executionLocked() { return executionLocked; },
      selectGroup(id) { canvasController.select(id); },
      getExecutionGroup(groupId) {
        const doc = canvasController.getDocument();
        const selected = groupId ? doc.groups.find(g => g.id === groupId) : doc.groups.find(g => g.id === doc.selectedGroupId);
        const headed = doc.groups.filter(g => g.startId);
        const group = selected || (headed.length === 1 ? headed[0] : null);
        if (!group) throw new Error('请先选择一个带开始头的程序组，或点它的开始头运行。');
        if (!group.startId) throw new Error('当前积木组没有开始头，请先连接一个开始头。');
        return {groupId: group.id, items: serializeSequence(group.items)};
      },
      findBlock(path, groupId) {
        const doc = canvasController.getDocument();
        let sequence = doc.groups.find(g => g.id === groupId)?.items || [];
        let item;
        for (const index of path) { item = sequence[index]; sequence = item?.children || []; }
        return item ? canvasController.findElement(item.uid) : null;
      },
      findBlockByUid(uid) { return canvasController.findElement(uid); },
      undo: undoProgram, redo: redoProgram,
      configure(model) {
        // DeviceModels invokes this only after its deactivate hook has stopped the
        // prior session. A public configure call cannot replace a running document.
        if (executionLocked && !CardModelSession.switching) return false;
        canvasController.cancel(); closeParamEditor();
        modelArtworkByCard = model.artworkByCard || {};
        // Device catalogs retain their own categories/order. Tabs locate those
        // sections in one continuous strip, including former single palettes.
        categories = model.catalog;
        legacyCards = model.legacyCards || [];
        flatCards = [...Object.values(categories).flatMap(group => group.cards), ...legacyCards];
        cardById = Object.fromEntries(flatCards.map(card => [card.id, card]));
        categoryOrder = Object.keys(categories);
        tabs.querySelectorAll('.tab').forEach(tab => tab.remove());
        Object.entries(categories).forEach(([id, group]) => {
          const tab = document.createElement('button'); tab.className='tab'; tab.id='tab-'+id;
          tab.type='button'; tab.setAttribute('role','tab'); tab.textContent=group.label || id;
          tab.setAttribute('aria-controls','palette');
          tab.style.setProperty('--tab-color',group.color); tabs.appendChild(tab);
        });
        applyWorkspaceState(CanvasWorkspace.create(), { force: true });
        historySnapshots=[];historyIndex=-1;
        activeCategory=categoryOrder[0];renderPalette(true);selectCategory(activeCategory,false);renderProgram();commitHistory();
      }
    };

    CardEditor.configure(CardModelSession.current);
