// Xiaobai self-learning command controls. Recording progress is device driven.
(() => {
  'use strict';
  const RELEARN_WARNING = '所有使用这个指令编号的积木和作品都会使用新口令。';
  const completedPrompts = new WeakMap();
  let active = null;
  let dialog = null;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, className, handler, label) => {
    const node = element('button', className, text);
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', handler);
    return node;
  };
  function context() {
    const link = window.CardBluetooth?.remoteConnection?.();
    const service = link && !link.closed ? link.learned : null;
    return {service, snapshot: service?.getSnapshot?.() || null};
  }
  const slotInfo = (snapshot, slot) => snapshot?.slots?.[slot - 1] || {slot, state: 'unknown', memo: '', label: `指令${slot}`};
  const locked = snapshot => Boolean(window.CardProgram?.running || snapshot?.busy || snapshot?.run || (snapshot?.learning && !snapshot.learning.terminal));
  const notice = message => window.showExecutionNotice?.(message);
  const errorText = error => typeof error === 'string' ? error : error?.message || '设备未确认操作，请重试。';

  function permission(service, slot) {
    const current = context();
    if (!service || current.service !== service) return '请先连接小白后再学习口令。';
    const snapshot = service.getSnapshot();
    if (window.CardProgram?.running || snapshot.run) return '请先停止程序，再学习口令。';
    if (snapshot.learning && !snapshot.learning.terminal) return '当前口令还在学习中。';
    if (snapshot.busy) return '设备正在处理任务，请稍候。';
    if (snapshot.capability === 'unsupported') return '设备暂不支持自学习口令。';
    if (snapshot.query === 'loading') return '正在读取设备状态，请稍候。';
    if (snapshot.capability !== 'supported' || !snapshot.uid || slotInfo(snapshot, slot).state === 'unknown') return '请先重新读取设备学习状态。';
    return '';
  }

  function createEditor({slot = 1, onSlotChange, onLayout} = {}) {
    let currentSlot = Math.min(10, Math.max(1, Math.round(Number(slot) || 1)));
    const panel = element('div', 'learned-command-editor');
    panel.dataset.learnedEditor = '';
    panel.setAttribute('aria-label', '自学习口令设置');
    const selector = element('div', 'learned-command-selector');
    const title = element('strong', 'learned-command-slot');
    const previous = button('‹', 'learned-command-arrow', () => change(-1), '上一个指令');
    const next = button('›', 'learned-command-arrow', () => change(1), '下一个指令');
    selector.append(previous, title, next);
    const status = element('div', 'learned-command-state');
    status.setAttribute('aria-live', 'polite');
    const memo = button('', 'learned-command-memo', () => {
      const {service, snapshot} = context();
      if (!service || locked(snapshot) || !snapshot.uid) return;
      openMemo(service, currentSlot, false);
    });
    const action = button('', 'learned-command-action', () => {
      const {service, snapshot} = context();
      if (!service) { notice('请先连接小白后再学习口令。'); return; }
      if (locked(snapshot)) return;
      if (slotInfo(snapshot, currentSlot).state === 'unknown' || snapshot.capability === 'unknown') {
        Promise.resolve().then(() => service.refresh()).catch(error => notice(errorText(error)));
        return;
      }
      if (slotInfo(snapshot, currentSlot).state === 'learned') openRelearn(service, currentSlot);
      else beginLearning(service, currentSlot, false);
    });
    const hint = element('p', 'learned-command-hint');
    panel.append(selector, status, memo, action, hint);
    function change(delta) {
      if (locked(context().snapshot)) return;
      const value = Math.min(10, Math.max(1, currentSlot + delta));
      if (value === currentSlot) return;
      currentSlot = value;
      onSlotChange?.(value);
      refresh();
    }
    function refresh() {
      const {service, snapshot} = context();
      const info = slotInfo(snapshot, currentSlot);
      const busy = locked(snapshot);
      const reading = snapshot?.query === 'loading';
      const unsupported = snapshot?.capability === 'unsupported';
      const known = !reading && info.state !== 'unknown';
      title.textContent = `指令${currentSlot}`;
      previous.disabled = busy || currentSlot === 1;
      next.disabled = busy || currentSlot === 10;
      status.textContent = reading ? '读取中' : !known ? '状态未知' : info.state === 'learned' ? '已学习' : '未学习';
      status.dataset.state = reading ? 'loading' : info.state;
      memo.hidden = !known || info.state !== 'learned';
      memo.textContent = info.memo || `指令${currentSlot}`;
      memo.setAttribute('aria-label', `修改指令${currentSlot}备忘`);
      memo.disabled = busy || !snapshot?.uid;
      action.textContent = reading ? '读取中' : !known ? '重新读取' : info.state === 'learned' ? '重新学习' : '未学习 · 点击学习';
      action.disabled = !service || busy || reading || unsupported;
      if (!service) hint.textContent = '连接小白后可学习，指令编号可先编辑。';
      else if (unsupported) hint.textContent = '设备暂不支持自学习口令';
      else if (window.CardProgram?.running || snapshot.run) hint.textContent = '程序运行中，请先停止程序。';
      else if (snapshot.learning && !snapshot.learning.terminal) hint.textContent = `正在学习指令${snapshot.learning.slot}`;
      else if (reading) hint.textContent = '正在读取十个指令的学习状态。';
      else if (!known) hint.textContent = '暂未取得设备状态，请重新读取。';
      else if (info.state === 'learned') hint.textContent = '点击文字可修改备忘，不会重新学习。';
      else hint.textContent = '跟随小白提示说两遍口令。';
    }
    panel.refresh = refresh;
    refresh();
    // Status and memo arrive after this popover was positioned. Reuse the
    // editor's anchor placement only when its actual size changes; keep its
    // DOM, focus and scroll position intact during ordinary device updates.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        if (!panel.isConnected) { observer.disconnect(); return; }
        if (panel.closest('#paramEditor')?.hidden) return;
        onLayout?.();
      });
      observer.observe(panel);
    }
    return panel;
  }

  function getDialog() {
    if (dialog) return dialog;
    dialog = element('dialog', 'xiaobai-learned-dialog');
    dialog.id = 'xiaobaiLearnedDialog';
    dialog.setAttribute('aria-labelledby', 'xiaobaiLearnedTitle');
    dialog.setAttribute('aria-describedby', 'xiaobaiLearnedDescription');
    dialog.addEventListener('cancel', event => { event.preventDefault(); back(); });
    dialog.addEventListener('close', () => {
      // All in-app closes use back()/finish(); an external native close must
      // still cancel the bound task, never turn it into a successful hit.
      // close is queued: confirm -> learn and retry can reopen this same node
      // before the previous close event arrives.
      if (dialog.open || !active) return;
      const flow = active;
      active = null;
      if (flow.kind === 'learning' && !flow.service.getSnapshot().learning?.terminal) {
        Promise.resolve().then(() => flow.service.cancelLearning()).catch(() => {});
      }
    });
    document.body.appendChild(dialog);
    return dialog;
  }
  function open(flow) {
    if (active) return false;
    active = {...flow, signature: '', error: '', cancelling: false};
    const node = getDialog();
    renderDialog(true);
    if (!node.open) node.showModal();
    return true;
  }
  function finish() {
    if (!active) return;
    const flow = active;
    active = null;
    const learning = flow.service.getSnapshot().learning;
    if ((flow.kind === 'learning' || flow.success) && learning?.terminal &&
        (flow.task === null || flow.task === undefined || flow.task === learning.task)) flow.service.dismissLearning?.();
    if (dialog?.open) dialog.close();
  }
  function openRelearn(service, slot) {
    const denied = permission(service, slot);
    if (denied) { notice(denied); return; }
    open({kind: 'confirm', service, slot});
  }
  function openMemo(service, slot, success) {
    open({kind: 'memo', service, slot, success, draft: service.getMemo(slot) || ''});
  }
  function beginLearning(service, slot, replace) {
    const denied = permission(service, slot);
    if (denied) { notice(denied); return; }
    if (active) finish();
    // A terminal snapshot can outlive a closed editor. Clear it before the
    // async preparation gap so it cannot be mistaken for this new task.
    if (service.getSnapshot().learning?.terminal) service.dismissLearning();
    if (!open({kind: 'learning', service, slot, replace, task: null})) return;
    const flow = active;
    try {
      const pending = service.learn(slot, {replace});
      flow.task = service.getSnapshot().learning?.task ?? null;
      syncDialog();
      Promise.resolve(pending).then(() => {
        if (active === flow) syncDialog();
      }, error => {
        if (active !== flow) return;
        flow.error = errorText(error);
        syncDialog();
      });
    } catch (error) {
      flow.error = errorText(error);
      renderDialog(true);
    }
  }

  function syncDialog() {
    const flow = active;
    if (!flow || flow.kind !== 'learning') return;
    const learning = flow.service.getSnapshot().learning;
    if (learning && learning.slot === flow.slot && (flow.task === null || learning.task === flow.task)) {
      flow.task = learning.task;
      if (learning.terminal && learning.stage === 4) {
        let prompted = completedPrompts.get(flow.service);
        if (!prompted) { prompted = new Set(); completedPrompts.set(flow.service, prompted); }
        if (prompted.has(learning.task)) return;
        prompted.add(learning.task);
        flow.kind = 'memo';
        flow.success = true;
        flow.draft = flow.service.getMemo(flow.slot) || '';
        flow.error = '';
        renderDialog(true);
        return;
      }
      if (learning.terminal && learning.stage === 7) { finish(); return; }
      if (learning.terminal) flow.cancelling = false;
    }
    renderDialog();
  }
  async function cancel() {
    const flow = active;
    if (!flow || flow.kind !== 'learning' || flow.cancelling) return;
    const learning = flow.service.getSnapshot().learning;
    if (learning?.terminal || (!learning && flow.error)) { finish(); return; }
    flow.cancelling = true;
    flow.error = '';
    renderDialog(true);
    try {
      await flow.service.cancelLearning();
      if (active === flow) {
        const final = flow.service.getSnapshot().learning;
        // A success racing with cancel is still a real save; keep its memo UI.
        if (final?.terminal) syncDialog();
        // D2 only confirms the cancel request; stay open until the device's
        // terminal event tells us the slot's actual state.
        else if (!final && !flow.service.getSnapshot().busy) finish();
      }
    } catch (error) {
      if (active !== flow) return;
      flow.cancelling = false;
      flow.error = errorText(error);
      syncDialog();
    }
  }
  function back() {
    if (!active) return false;
    if (active.kind === 'learning') cancel();
    else finish();
    return true;
  }
  async function retry() {
    const flow = active;
    if (!flow || flow.retrying) return;
    flow.retrying = true;
    flow.error = '';
    renderDialog(true);
    try {
      if (context().service !== flow.service) throw new Error('连接已断开，请返回并重新连接小白。');
      const snapshot = flow.service.getSnapshot();
      if (snapshot.learning && !snapshot.learning.terminal) throw new Error('设备仍在处理学习任务，请先取消。');
      if (slotInfo(snapshot, flow.slot).state === 'unknown') await flow.service.refresh();
      if (active !== flow) return;
      flow.retrying = false;
      if (!flow.replace && slotInfo(flow.service.getSnapshot(), flow.slot).state === 'learned') {
        finish();
        openRelearn(flow.service, flow.slot);
      } else beginLearning(flow.service, flow.slot, flow.replace);
    } catch (error) {
      if (active !== flow) return;
      flow.retrying = false;
      flow.error = errorText(error);
      renderDialog(true);
    }
  }
  function phaseText(learning) {
    if (learning?.stage === null && learning.phase === 'accepted') {
      return ['请跟随小白语音提示', '等待小白准备好录制，再按提示说出口令。'];
    }
    switch (learning?.stage) {
      case 0: return ['请跟随小白语音提示', '等待小白准备好录制，再按提示说出口令。'];
      case 1: return ['请说第一遍', '请靠近小白，完整说出你想让它记住的口令。'];
      case 2: return ['第一遍已收到', '等待小白提示，再准备录入第二遍。'];
      case 3: return ['请再说一遍', '请说出与第一遍相同的口令。'];
      case 9: return ['第一遍需要重新录入', '请等待小白语音提示，准备好后再说。'];
      case 10: return ['第二遍需要重试', '请等待小白语音提示，准备好后再说。'];
      case 5: return ['学习未完成', '设备没有确认口令保存成功，请重试。'];
      case 6: return ['学习超时', '未在时间内完成录入，可以重新尝试。'];
      case 8: return ['设备未接受学习', '请检查设备状态后重试。'];
      default: return ['正在准备学习', '等待小白确认，请跟随设备语音提示。'];
    }
  }
  function renderDialog(force = false) {
    const flow = active;
    if (!flow) return;
    const snapshot = flow.service.getSnapshot();
    const learning = snapshot.learning?.task === flow.task ? snapshot.learning : null;
    const failed = flow.kind === 'learning' && Boolean(learning?.terminal || flow.error);
    const signature = JSON.stringify([flow.kind, learning?.stage, learning?.phase, learning?.error, flow.error, flow.cancelling, flow.retrying]);
    if (!force && flow.signature === signature) return;
    flow.signature = signature;
    const node = getDialog();
    node.dataset.view = flow.kind;
    const content = element('div', 'learned-dialog-content');
    const eyebrow = element('div', 'learned-dialog-eyebrow', '自学习口令');
    const heading = element('h2', '', flow.kind === 'confirm' ? `重新学习指令${flow.slot}` : flow.kind === 'memo' ? (flow.success ? '学习完成，填写备忘' : `修改指令${flow.slot}备忘`) : failed ? `指令${flow.slot}学习未完成` : `正在学习指令${flow.slot}`);
    heading.id = 'xiaobaiLearnedTitle';
    const description = element('p', 'learned-dialog-description');
    description.id = 'xiaobaiLearnedDescription';
    const actions = element('div', 'learned-dialog-actions');
    content.append(eyebrow, heading);

    if (flow.kind === 'confirm') {
      description.textContent = RELEARN_WARNING;
      const note = element('p', 'learned-dialog-note', '文字备忘可单独修改，无需重新学习。');
      actions.append(button('返回', 'learned-dialog-secondary', finish), button('重新学习', 'learned-dialog-primary', () => beginLearning(flow.service, flow.slot, true)));
      content.append(description, note, actions);
    } else if (flow.kind === 'memo') {
      description.textContent = '文字仅用作备忘，不参与语音识别。可以留空。';
      const label = element('label', 'learned-memo-label', `指令${flow.slot}的文字备忘`);
      label.htmlFor = 'xiaobaiLearnedMemo';
      const input = element('input', 'learned-memo-input');
      input.id = 'xiaobaiLearnedMemo';
      input.type = 'text';
      input.maxLength = 80;
      input.placeholder = `指令${flow.slot}`;
      input.autocomplete = 'off';
      input.value = flow.draft || '';
      input.addEventListener('input', () => { flow.draft = input.value; });
      const save = () => {
        try {
          flow.service.setMemo(flow.slot, input.value);
          finish();
        } catch (error) {
          flow.error = errorText(error);
          renderDialog(true);
        }
      };
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); save(); }
      });
      const error = element('p', 'learned-dialog-error', flow.error);
      error.setAttribute('role', 'alert');
      error.hidden = !flow.error;
      actions.append(button(flow.success ? '暂不填写' : '取消', 'learned-dialog-secondary', finish), button('完成', 'learned-dialog-primary', save));
      content.append(description, label, input, error, actions);
    } else {
      const image = element('img', 'learned-dialog-robot');
      image.src = 'assets/devices/xiaobai-product.webp';
      image.alt = '';
      image.width = 132;
      image.height = 112;
      let [phase, detail] = phaseText(learning);
      if (flow.error) { phase = '学习未完成'; detail = flow.error; }
      else if (learning?.error) detail = errorText(learning.error);
      if (flow.cancelling) { phase = '正在取消学习'; detail = '等待设备结束录入并确认最终状态。'; }
      const progress = element('div', 'learned-dialog-progress');
      progress.setAttribute('role', 'status');
      progress.setAttribute('aria-live', 'polite');
      const phaseNode = element('strong', 'learned-dialog-phase', phase);
      description.textContent = detail;
      progress.append(phaseNode, description);
      content.append(image, progress);
      if (failed && !flow.cancelling) {
        const finalState = slotInfo(snapshot, flow.slot).state;
        const state = element('p', 'learned-dialog-note', `指令${flow.slot}：${finalState === 'learned' ? '已学习' : finalState === 'unlearned' ? '未学习' : '状态未知'}`);
        content.append(state);
        const retryButton = button(flow.retrying ? '读取中' : '重试', 'learned-dialog-primary', retry);
        retryButton.disabled = Boolean(flow.retrying || context().service !== flow.service);
        actions.append(button('返回', 'learned-dialog-secondary', back), retryButton);
      } else {
        const cancelButton = button(flow.cancelling ? '取消中' : '取消学习', 'learned-dialog-secondary', cancel);
        cancelButton.disabled = flow.cancelling;
        actions.append(cancelButton);
      }
      content.append(actions);
    }
    node.replaceChildren(content);
  }

  function refresh() {
    document.querySelectorAll('[data-learned-editor]').forEach(panel => panel.refresh?.());
    syncDialog();
  }
  window.addEventListener('xiaobai-learned-change', refresh);
  window.addEventListener('card-program-state', refresh);
  window.addEventListener('xiaobai-disconnected', refresh);
  window.addEventListener('xiaobai-program-abort', refresh);
  window.addEventListener('hashchange', () => {
    if (location.hash === '#editor') return;
    // Mode changes terminate the device task via the connection service.
    // Cancel as well if the modal initiated a request before that hook ran.
    if (active?.kind === 'learning' && !active.service.getSnapshot().learning?.terminal) {
      const service = active.service;
      Promise.resolve().then(() => service.cancelLearning()).catch(() => {});
    }
    finish();
  });
  window.CardLearnedCommands = {createEditor, refresh, back, get open() { return Boolean(dialog?.open); }};
})();
