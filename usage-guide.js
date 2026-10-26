/* Companion guides stay outside the dialog top layer so existing Bluetooth,
 * parameter and save dialogs keep their normal focus and navigation behavior. */
(() => {
  'use strict';
  if (window.CardUsageGuide) return;

  const rememberedPages = new Map();
  let guide = null, resumeKey = '', ownerModelId = '', pageIndex = 0;
  let state = 'closed', pending = false, requestRevision = 0, mediaRevision = 0;
  let activeMedia = null, returnFocus = null, suspended = false;
  const layer = document.createElement('div');
  layer.id = 'usageGuideLayer';
  layer.className = 'usage-guide-layer';
  layer.hidden = true;
  layer.dataset.state = 'closed';
  layer.innerHTML = `
    <section id="usageGuidePanel" class="usage-guide-panel" role="region" aria-labelledby="usageGuideHeading">
      <header class="usage-guide-header">
        <span class="usage-guide-header-line" aria-hidden="true"></span>
        <div><span class="usage-guide-eyebrow"></span><h2 id="usageGuideHeading">使用指南</h2></div>
        <span class="usage-guide-header-line" aria-hidden="true"></span>
      </header>
      <div class="usage-guide-body">
        <div class="usage-guide-visual"><div class="usage-guide-media"></div><p class="usage-guide-caption"></p></div>
        <div class="usage-guide-copy" tabindex="0" aria-label="指南说明"><h3></h3><div class="usage-guide-description"></div><div class="usage-guide-icons" role="group" aria-label="操作图标说明"></div><div class="usage-guide-tips"></div></div>
      </div>
      <footer class="usage-guide-footer">
        <button type="button" class="usage-guide-arrow usage-guide-prev" aria-label="指南上一页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button>
        <div class="usage-guide-pagination"><div class="usage-guide-dots" role="group" aria-label="指南页码"></div><span class="usage-guide-page-number" aria-live="polite" aria-atomic="true"></span></div>
        <button type="button" class="usage-guide-arrow usage-guide-next" aria-label="指南下一页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5 7 7-7 7"/></svg></button>
      </footer>
    </section>
    <button type="button" class="usage-guide-toggle" aria-controls="usageGuidePanel" aria-expanded="true" aria-label="收起使用指南"><span class="usage-guide-toggle-label">收起</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 7-7 7 7Z"/></svg></button>`;
  document.body.append(layer);

  const panel = layer.querySelector('.usage-guide-panel');
  const toggle = layer.querySelector('.usage-guide-toggle');
  const mediaBox = layer.querySelector('.usage-guide-media');
  const copy = layer.querySelector('.usage-guide-copy');
  const previous = layer.querySelector('.usage-guide-prev');
  const next = layer.querySelector('.usage-guide-next');
  const dots = layer.querySelector('.usage-guide-dots');
  const modelId = () => window.CardModelSession?.current?.id || document.body.dataset.deviceModel || '';
  const isEditor = () => location.hash === '#editor';
  const isGuideRoute = () => isEditor() || location.hash === '#bluetooth';
  const keyFor = (value, options) => String(options.resumeKey || value.id || value.modelId || 'guide');
  const snapshot = () => ({
    id: guide?.id || null, guideId: guide?.id || null, resumeKey,
    pageIndex, pageCount: guide?.pages?.length || 0, state,
    isOpen: Boolean(guide), pending, suspended, visible: Boolean(guide) && !layer.hidden,
    mediaType: activeMedia ? (guide?.pages[pageIndex]?.media?.type || activeMedia.tagName.toLowerCase()) : null
  });
  const announce = () => window.dispatchEvent(new CustomEvent('card-usage-guide-state', {detail: snapshot()}));
  function remember() {
    if (!guide || !resumeKey) return;
    rememberedPages.set(resumeKey, pageIndex);
    if (rememberedPages.size > 100) rememberedPages.delete(rememberedPages.keys().next().value);
  }
  function pauseMedia() {
    if (activeMedia instanceof HTMLVideoElement) activeMedia.pause();
  }
  function releaseMedia() {
    ++mediaRevision;
    const retired = activeMedia;
    activeMedia = null;
    if (retired instanceof HTMLVideoElement) {
      retired.pause();
      retired.removeAttribute('src');
      retired.removeAttribute('poster');
      retired.querySelectorAll('source').forEach(source => source.removeAttribute('src'));
      retired.load();
    } else if (retired instanceof HTMLImageElement) {
      retired.removeAttribute('src');
    } else if (retired) {
      retired.querySelectorAll('img').forEach(image => image.removeAttribute('src'));
    }
    mediaBox.replaceChildren();
    delete mediaBox.dataset.status;
  }
  function validSource(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, document.baseURI);
      return ['http:', 'https:', 'file:', 'capacitor:', 'blob:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }
  function mediaFallback(message) {
    const note = document.createElement('p');
    note.className = 'usage-guide-media-fallback';
    note.textContent = message;
    mediaBox.replaceChildren(note);
    mediaBox.dataset.status = 'unavailable';
  }
  function renderMedia(page) {
    releaseMedia();
    const source = page.media;
    if (source?.type === 'images' && Array.isArray(source.items) && source.items.length) {
      const version = mediaRevision;
      const gallery = document.createElement('div');
      gallery.className = 'usage-guide-image-pair';
      activeMedia = gallery;
      for (const item of source.items) {
        const figure = document.createElement('figure');
        figure.className = 'usage-guide-image-item';
        const frame = document.createElement('div');
        frame.className = 'usage-guide-image-frame';
        const image = document.createElement('img');
        image.alt = item.alt || page.title || '指南图片';
        image.decoding = 'async'; image.draggable = false;
        const src = validSource(item.src);
        const fail = () => {
          if (version !== mediaRevision || activeMedia !== gallery) return;
          image.removeAttribute('src');
          const note = document.createElement('p');
          note.className = 'usage-guide-media-fallback'; note.textContent = '图片暂时无法打开';
          frame.replaceChildren(note);
        };
        image.addEventListener('error', fail, {once: true});
        frame.append(image); figure.append(frame);
        if (item.caption) {
          const caption = document.createElement('figcaption');
          caption.textContent = item.caption; figure.append(caption);
        }
        gallery.append(figure);
        if (src) image.src = src; else fail();
      }
      mediaBox.append(gallery);
      return;
    }
    const src = validSource(source?.src);
    if (!src) {
      mediaFallback(source?.src ? '暂时无法显示这份媒体，请继续阅读右侧说明。' : '请按右侧说明进行操作');
      return;
    }
    const version = mediaRevision;
    const media = document.createElement(source.type === 'video' ? 'video' : 'img');
    activeMedia = media;
    media.className = 'usage-guide-media-content';
    if (media instanceof HTMLVideoElement) {
      media.preload = 'metadata';
      media.playsInline = true;
      media.controls = true;
      media.setAttribute('playsinline', '');
      media.setAttribute('aria-label', source.alt || page.title || '指南视频');
      const poster = validSource(source.poster);
      if (poster) media.poster = poster;
      // A native modal, collapsed guide or hidden app must never leave audio
      // playing behind the controls, including a delayed play() completion.
      media.addEventListener('play', () => {
        if (version !== mediaRevision || state !== 'expanded' || suspended || layer.hidden || document.hidden || document.querySelector('dialog[open]')) media.pause();
      });
    } else {
      media.alt = source.alt || page.title || '指南图片';
      media.decoding = 'async';
      media.draggable = false;
    }
    media.addEventListener('error', () => {
      if (version !== mediaRevision || media !== activeMedia || !guide) return;
      // Retire before replacing so failed/late decoders cannot mutate the next page.
      releaseMedia();
      mediaFallback('媒体暂时无法打开，请继续阅读右侧说明。');
    }, {once: true});
    media.src = src;
    mediaBox.append(media);
  }
  function paragraphs(target, value) {
    const chunks = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
    target.replaceChildren(...chunks.filter(text => String(text).trim()).map(text => {
      const p = document.createElement('p'); p.textContent = String(text); return p;
    }));
  }
  function renderIcons(page) {
    const target = copy.querySelector('.usage-guide-icons');
    target.querySelectorAll('img').forEach(image => image.removeAttribute('src'));
    target.replaceChildren();
    const version = mediaRevision;
    for (const item of Array.isArray(page.icons) ? page.icons : []) {
      const src = validSource(item.src);
      if (!src) continue;
      const entry = document.createElement('span'); entry.className = 'usage-guide-icon-entry';
      const image = document.createElement('img');
      image.alt = item.alt || item.label || '操作图标'; image.decoding = 'async'; image.draggable = false;
      image.addEventListener('error', () => {
        if (version !== mediaRevision) return;
        image.removeAttribute('src'); image.remove();
      }, {once: true});
      const label = document.createElement('span'); label.textContent = item.label || item.alt || '';
      entry.append(image, label); target.append(entry); image.src = src;
    }
  }
  function renderPage() {
    if (!guide) return;
    const page = guide.pages[pageIndex];
    layer.querySelector('.usage-guide-eyebrow').textContent = guide.title || '配套程序';
    copy.querySelector('h3').textContent = page.title || `第 ${pageIndex + 1} 页`;
    paragraphs(copy.querySelector('.usage-guide-description'), page.text ?? page.description);
    paragraphs(copy.querySelector('.usage-guide-tips'), page.tips);
    const caption = layer.querySelector('.usage-guide-caption');
    caption.textContent = page.caption || page.media?.caption || '';
    caption.hidden = !caption.textContent;
    copy.scrollTop = 0;
    previous.disabled = pageIndex === 0;
    next.disabled = pageIndex === guide.pages.length - 1;
    layer.querySelector('.usage-guide-page-number').textContent = `${pageIndex + 1} / ${guide.pages.length}`;
    dots.replaceChildren(...guide.pages.map((entry, index) => {
      const dot = document.createElement('button');
      dot.type = 'button'; dot.className = 'usage-guide-dot';
      dot.setAttribute('aria-label', `第 ${index + 1} 页${entry.title ? `：${entry.title}` : ''}`);
      if (index === pageIndex) dot.setAttribute('aria-current', 'page');
      dot.onclick = () => goTo(index);
      return dot;
    }));
    renderMedia(page);
    renderIcons(page);
    remember();
    announce();
  }
  function goTo(index) {
    if (!guide || state !== 'expanded' || suspended) return false;
    const target = Math.max(0, Math.min(guide.pages.length - 1, Math.floor(index)));
    if (!Number.isFinite(target) || target === pageIndex) return false;
    pageIndex = target; renderPage(); return true;
  }
  function collapse() {
    if (!guide || state !== 'expanded' || suspended) return false;
    pauseMedia();
    state = 'collapsed'; layer.dataset.state = state;
    panel.inert = true;
    panel.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '展开使用指南');
    toggle.querySelector('.usage-guide-toggle-label').textContent = '展开';
    if (panel.contains(document.activeElement)) toggle.focus({preventScroll: true});
    announce(); return true;
  }
  function expand() {
    if (!guide || state !== 'collapsed' || suspended) return false;
    state = 'expanded'; layer.dataset.state = state;
    panel.inert = false;
    panel.removeAttribute('aria-hidden');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', '收起使用指南');
    toggle.querySelector('.usage-guide-toggle-label').textContent = '收起';
    announce(); return true;
  }
  function close(options = {}) {
    ++requestRevision;
    pending = false;
    if (options.forget) rememberedPages.delete(resumeKey); else remember();
    const focusWasInside = layer.contains(document.activeElement);
    releaseMedia();
    copy.querySelectorAll('.usage-guide-icons img').forEach(image => image.removeAttribute('src'));
    copy.querySelector('.usage-guide-icons').replaceChildren();
    guide = null; state = 'closed'; resumeKey = ''; ownerModelId = ''; pageIndex = 0;
    suspended = false;
    layer.hidden = true; layer.dataset.state = state;
    if (focusWasInside && returnFocus?.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus({preventScroll: true});
    returnFocus = null;
    announce();
  }
  function open(value, options = {}) {
    if (!value || !Array.isArray(value.pages) || !value.pages.length) { close(); return false; }
    ++requestRevision; pending = false;
    remember();
    if (!layer.contains(document.activeElement)) returnFocus = document.activeElement;
    guide = value;
    resumeKey = keyFor(value, options);
    ownerModelId = modelId();
    const desired = options.initialPage ?? rememberedPages.get(resumeKey) ?? 0;
    pageIndex = Math.max(0, Math.min(value.pages.length - 1, Number.isFinite(Number(desired)) ? Math.floor(Number(desired)) : 0));
    state = 'expanded'; layer.dataset.state = state;
    suspended = location.hash === '#bluetooth'; layer.hidden = suspended;
    panel.inert = false; panel.removeAttribute('aria-hidden');
    toggle.setAttribute('aria-expanded', 'true'); toggle.setAttribute('aria-label', '收起使用指南');
    toggle.querySelector('.usage-guide-toggle-label').textContent = '收起';
    renderPage();
    return true;
  }
  async function openCompanion(event) {
    const detail = event.detail || {};
    if (!detail.guide && !detail.guideId) { close(); return; }
    if (detail.guide) { open(detail.guide, detail); return; }
    // No guide media is requested until an associated program actually opens.
    close();
    const revision = requestRevision, owner = modelId();
    ownerModelId = owner; pending = true; announce();
    try {
      const value = await window.CardCompanionCatalog?.getGuide(detail.guideId);
      if (revision !== requestRevision || modelId() !== owner || !isGuideRoute()) return;
      pending = false;
      if (value) open(value, detail); else { pending = false; announce(); }
    } catch {
      if (revision !== requestRevision) return;
      pending = false; announce();
      // A guide failure must not replace or block the already loaded program.
      window.setStatus?.('使用指南暂时无法读取，请稍后重新打开配套程序');
    }
  }

  previous.onclick = () => goTo(pageIndex - 1);
  next.onclick = () => goTo(pageIndex + 1);
  toggle.onclick = () => state === 'expanded' ? collapse() : expand();
  panel.addEventListener('keydown', event => {
    if (event.target.closest('video') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowLeft' && goTo(pageIndex - 1)) event.preventDefault();
    if (event.key === 'ArrowRight' && goTo(pageIndex + 1)) event.preventDefault();
    if (event.key === 'Escape') { event.preventDefault(); collapse(); }
  });
  layer.addEventListener('dragstart', event => event.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseMedia(); });
  window.addEventListener('pagehide', () => close());
  window.addEventListener('hashchange', () => {
    if (!guide && !pending) return;
    if (!isGuideRoute()) { close(); return; }
    // Bluetooth is a temporary detour from the same program. Keep the page,
    // collapsed state, video position and identity; never resume video on return.
    suspended = !isEditor();
    if (suspended) pauseMedia();
    layer.hidden = suspended || !guide;
    announce();
  });
  window.addEventListener('card-companion-opened', openCompanion);
  window.addEventListener('card-companion-closed', () => close());
  window.addEventListener('card-companion-saved', event => {
    if (!guide) return;
    const detail = event.detail || {};
    if (detail.guideId && detail.guideId !== guide.id) { close(); return; }
    if (!detail.guideId) { close(); return; }
    remember();
    if (detail.resumeKey) resumeKey = String(detail.resumeKey);
    remember(); announce();
  });
  new MutationObserver(records => {
    if (!guide && !pending) return;
    if (records.some(record => record.target === document.body && record.attributeName === 'data-device-model') && ownerModelId && modelId() !== ownerModelId) close();
    if (records.some(record => record.target instanceof HTMLDialogElement && record.target.open)) pauseMedia();
  }).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['open', 'data-device-model']});

  window.CardUsageGuide = {open, close, collapse, expand, goTo, back: () => isEditor() && !layer.hidden ? collapse() : false, getState: snapshot};
})();
