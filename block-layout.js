/* Geometry is in CSS pixels: advance excludes the plug, height includes parameters. */
const BlockLayout = (() => {
  const NS = "http://www.w3.org/2000/svg";
  let legacyZoom;
  function clientRect(element) {
    if (legacyZoom === undefined) {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px;zoom:0.5;visibility:hidden;pointer-events:none';
      document.body.append(probe);
      legacyZoom = Math.abs(probe.getBoundingClientRect().width - 20) < 0.1;
      probe.remove();
    }
    const rect = element.getBoundingClientRect();
    if (!legacyZoom) return rect;
    let zoom = 1;
    // Old Android WebView exposes device scaling as the root's computed zoom;
    // DOM rects already use CSS pixels, so only include application element zoom.
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) zoom *= parseFloat(getComputedStyle(node).zoom) || 1;
    return new DOMRect(rect.x * zoom, rect.y * zoom, rect.width * zoom, rect.height * zoom);
  }
  const plug = 8, bodyHeight = 72, radius = 5;
  const connectorY = bodyHeight/2, iconSize = 40, paramOverhang = 20;
  const textContext = document.createElement("canvas").getContext("2d");
  textContext.font = '600 12px "Microsoft YaHei", sans-serif';
  const parameterWidth = bubble => bubble ? Math.ceil(textContext.measureText(bubble.textContent).width)+12 : 0;
  const direct = (el, selector) => [...el.children].filter(child => child.matches(selector));
  function box(el, x, y, width, height) {
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  }
  // The same curve, traversed in opposite directions, makes both mating edges.
  function edge(x, y, down) {
    return down
      ? `V${y-17} C${x} ${y-12} ${x+plug} ${y-11} ${x+plug} ${y-6} V${y+6} C${x+plug} ${y+11} ${x} ${y+12} ${x} ${y+17}`
      : `V${y+17} C${x} ${y+12} ${x+plug} ${y+11} ${x+plug} ${y+6} V${y-6} C${x+plug} ${y-11} ${x} ${y-12} ${x} ${y-17}`;
  }
  function outline(el, width, height, d) {
    let svg = direct(el, ".block-outline")[0];
    if (!svg) {
      svg = document.createElementNS(NS, "svg");
      svg.classList.add("block-outline");
      svg.setAttribute("aria-hidden", "true");
      svg.appendChild(document.createElementNS(NS, "path"));
      el.prepend(svg);
    }
    svg.setAttribute("viewBox", `-1 -1 ${width+plug+2} ${height+2}`);
    svg.style.width = `${width+plug+2}px`;
    svg.style.height = `${height+2}px`;
    svg.firstChild.setAttribute("d", d);
  }
  function remember(el, m) {
    el.dataset.advance = m.advance;
    el.dataset.connectorY = m.anchor;
    el.dataset.visualHeight = m.height;
    el.dataset.bodyHeight = m.body;
    el.style.width = `${m.advance+plug}px`;
    el.style.height = `${m.height}px`;
    return m;
  }
  function measure(el) {
    if (el.matches(".loop-block")) return measureLoop(el);
    if (!el.matches(".block")) {
      const m = sequence(el);
      return remember(el, {...m, body: m.height});
    }
    const start = el.classList.contains("start");
    const bubble = direct(el, ".param-bubble")[0];
    const width = start ? 68 : 76;
    if (bubble) {
      const bubbleWidth = Math.max(width-16, parameterWidth(bubble));
      bubble.style.width = `${bubbleWidth}px`;
      bubble.style.left = `${(width-bubbleWidth)/2}px`;
      bubble.style.top = `${bodyHeight-8}px`;
      bubble.style.setProperty("--param-shift", "0px");
    }
    const icon = direct(el, ".card-icon")[0];
    if (icon) {
      icon.style.left = `${(width-iconSize)/2}px`;
      icon.style.top = `${(bodyHeight-iconSize)/2}px`;
    }
    const h = bodyHeight, r = radius;
    const d = start
      ? `M${connectorY} 0 H${width-r} Q${width} 0 ${width} ${r} ${edge(width,connectorY,true)} V${h-r} Q${width} ${h} ${width-r} ${h} H${connectorY} A${connectorY} ${connectorY} 0 0 1 ${connectorY} 0 Z`
      : `M${r} 0 H${width-r} Q${width} 0 ${width} ${r} ${edge(width,connectorY,true)} V${h-r} Q${width} ${h} ${width-r} ${h} H${r} Q0 ${h} 0 ${h-r} ${edge(0,connectorY,false)} V${r} Q0 0 ${r} 0 Z`;
    outline(el, width, h, d);
    return remember(el, {advance: width, anchor: connectorY, body: h, height: h+(bubble ? paramOverhang : 0)});
  }
  function sequence(container) {
    const nodes = direct(container, ".program-block, .start, .drop-projection")
      .filter(el => !el.classList.contains("drag-source-placeholder"));
    const sizes = nodes.map(measure);
    const anchor = Math.max(connectorY, ...sizes.map(m => m.anchor));
    const below = Math.max(nodes.length ? connectorY : 24, ...sizes.map(m => m.height-m.anchor));
    let x = 0;
    nodes.forEach((el, i) => {
      const m = sizes[i];
      box(el, x, anchor-m.anchor, m.advance+plug, m.height);
      x += m.advance;
    });
    const m = {advance: x || 56, anchor, height: anchor+below};
    container.style.width = `${m.advance}px`;
    container.style.height = `${m.height}px`;
    const note = direct(container, ".loop-empty-note, .empty-note")[0];
    if (note) {
      note.style.display = nodes.length ? "none" : "grid";
      box(note, 12, 18, 32, 36);
    }
    return m;
  }
  function measureLoop(el) {
    const inner = direct(el, ".loop-inner")[0];
    const child = sequence(inner);
    const tail = direct(el, ".loop-tail")[0];
    const bubble = direct(tail, ".param-bubble")[0];
    const tailWidth = 60;
    const left = 26, right = left+child.advance, width = right+tailWidth;
    const beam = 14, innerTop = beam;
    // Nested beams grow upward; all instruction connections share one baseline.
    const internalY = innerTop+child.anchor, externalY = internalY, r = radius;
    const h = internalY+bodyHeight/2;
    const d = `M${r} 0 H${width-r} Q${width} 0 ${width} ${r} ${edge(width,externalY,true)} V${h-r} Q${width} ${h} ${width-r} ${h} H${right+r} Q${right} ${h} ${right} ${h-r} ${edge(right,internalY,false)} V${beam+r} Q${right} ${beam} ${right-r} ${beam} H${left+r} Q${left} ${beam} ${left} ${beam+r} ${edge(left,internalY,true)} V${h-r} Q${left} ${h} ${left-r} ${h} H${r} Q0 ${h} 0 ${h-r} ${edge(0,externalY,false)} V${r} Q0 0 ${r} 0 Z`;
    outline(el, width, h, d);
    box(inner, left, innerTop, child.advance, child.height);
    box(direct(el,".loop-top")[0], 0, 0, width, beam);
    box(direct(el,".loop-left")[0], 0, beam, left, h-beam);
    box(tail, right, beam, tailWidth, h-beam);
    if (bubble) {
      const bubbleWidth = Math.max(tailWidth-16, parameterWidth(bubble));
      bubble.style.width = `${bubbleWidth}px`;
      bubble.style.left = `${(tailWidth-bubbleWidth)/2}px`;
      bubble.style.setProperty("--param-shift", "0px");
    }
    const icon = direct(tail, ".card-icon")[0];
    if (icon) icon.style.left = `${(tailWidth-iconSize)/2}px`;
    el.style.setProperty("--loop-icon-top", `${externalY-beam-iconSize/2}px`);
    el.dataset.internalConnectorY = internalY;
    const height = Math.max(innerTop+child.height, h+(bubble ? paramOverhang : 0));
    return remember(el, {advance: width, anchor: externalY, body: h, height});
  }
  function root(container, viewportHeight) {
    const m = sequence(container);
    const y = Math.max(24, viewportHeight*0.52-m.anchor);
    direct(container, ".program-block, .start, .drop-projection").forEach(el => {
      if (el.classList.contains("drag-source-placeholder")) return;
      el.style.left = `${parseFloat(el.style.left)+24}px`;
      el.style.top = `${parseFloat(el.style.top)+y}px`;
    });
    container.style.width = `${m.advance+plug+72}px`;
    container.style.height = `${m.height+y+48}px`;
    // Long parameter labels never change connection spacing. Only conflicting
    // labels move to a lower row; include their overflow in the scrollable area.
    const occupied = [];
    const bounds = clientRect(container);
    let right = m.advance+plug+72, bottom = m.height+y+48;
    container.querySelectorAll(".param-bubble").forEach(bubble => {
      if (bubble.closest(".drag-source-placeholder, .drop-projection")) return;
      const rect = clientRect(bubble);
      let top = rect.top;
      for (const other of occupied) {
        if (rect.left < other.right+4 && rect.right+4 > other.left
          && top < other.bottom+4 && top+rect.height+4 > other.top) top = other.bottom+4;
      }
      bubble.style.setProperty("--param-shift", `${top-rect.top}px`);
      occupied.push({left: rect.left, right: rect.right, top, bottom: top+rect.height});
      occupied.sort((a,b) => a.top-b.top);
      right = Math.max(right, rect.right-bounds.left+24);
      bottom = Math.max(bottom, top+rect.height-bounds.top+24);
    });
    container.style.width = `${right}px`;
    container.style.height = `${bottom}px`;
  }
  return {measure, sequence, root, clientRect};
})();
