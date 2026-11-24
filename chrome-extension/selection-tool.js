// Chrome injects this function into the isolated world of the requested document.
export function pageSelection(action, expectedUrl, shortcuts = {}) {
  if (location.href !== expectedUrl) return null;
  const focusedElement = (doc) => {
    let focused = doc.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    return focused;
  };
  const selection = (doc = document) => {
    const selected = doc.getSelection();
    const field = (node) => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      return (
        element?.isContentEditable ||
        element?.closest('input, textarea, select, [role="textbox"], #__studyboard_bottom')
      );
    };
    if (field(focusedElement(doc)) || field(selected?.anchorNode) || field(selected?.focusNode))
      return { editable: true, text: '' };
    return { text: selected?.rangeCount && !selected.isCollapsed ? selected.toString() : '' };
  };
  if (action === 'read-focused') {
    let doc = document,
      focused = focusedElement(doc);
    while (focused?.matches('iframe,frame')) {
      if (!focused.contentDocument) return { unavailable: true, url: location.href };
      doc = focused.contentDocument;
      focused = focusedElement(doc);
    }
    return { ...selection(doc), url: location.href, sourceUrl: doc.URL };
  }
  if (action === 'read') return { ...selection(), url: location.href };
  if (action !== 'enable' || !document.body) return null;
  const previous = globalThis.__studyboardSelectionTool;
  if (previous?.url === expectedUrl && previous.version === 2) return;
  previous?.dispose();
  const host = document.createElement('span');
  host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent =
    '.actions{display:inline-flex;align-items:center;white-space:nowrap;border:1px solid #c4d5c9;border-radius:8px;background:#fff;color:#284d38;box-shadow:0 2px 9px #152e202e;font:600 13px/1.5 system-ui}.actions button{appearance:none;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;padding:5px 10px}.actions button+button{border-left:1px solid #d9e3db}.actions button:hover{background:#eef4f0}.actions button:focus-visible{outline:2px solid #315e43}.actions [role=status]:not(:empty){padding:5px 10px}';
  const actions = document.createElement('span');
  actions.className = 'actions';
  const buttons = [
    ['excerpt', '普通摘录', '保存原文到画布'],
    ['quote', '金句记录', '保存为金句卡，加入今日复习'],
  ].map(([kind, label, title]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = shortcuts[kind] ? title + ' · ' + shortcuts[kind] : title;
    button.addEventListener('pointerdown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => save(e, kind));
    actions.append(button);
    return button;
  });
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  actions.append(status);
  shadow.append(style, actions);
  let shown = '',
    dismissed = '',
    timer,
    hideTimer;
  function hide() {
    host.remove();
    shown = '';
    clearTimeout(hideTimer);
  }
  function render() {
    const text = selection().text;
    if (!text.trim() || location.href !== expectedUrl) {
      dismissed = '';
      hide();
      return;
    }
    if (text === dismissed) {
      hide();
      return;
    }
    dismissed = '';
    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    if ((!rect.width && !rect.height) || rect.bottom < 0 || rect.top > innerHeight) {
      hide();
      return;
    }
    if (!host.isConnected || shown !== text) {
      clearTimeout(hideTimer);
      for (const b of buttons) b.hidden = false;
      status.textContent = '';
      status.title = '';
      shown = text;
      document.body.append(host);
    }
    host.style.setProperty(
      'left',
      Math.max(4, Math.min(rect.right - host.offsetWidth, innerWidth - host.offsetWidth - 4)) + 'px',
      'important',
    );
    const y =
      rect.bottom + host.offsetHeight + 8 <= innerHeight ? rect.bottom + 4 : rect.top - host.offsetHeight - 4;
    host.style.setProperty(
      'top',
      Math.max(4, Math.min(y, innerHeight - host.offsetHeight - 4)) + 'px',
      'important',
    );
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 90);
  }
  function escape(event) {
    if (event.key === 'Escape' && host.isConnected) {
      dismissed = shown;
      hide();
    }
  }
  async function save(event, kind) {
    if (!event.isTrusted || status.textContent || !shown || location.href !== expectedUrl) return;
    const text = shown;
    if (selection().text !== text) {
      hide();
      return;
    }
    for (const b of buttons) b.hidden = true;
    status.textContent = '正在保存…';
    try {
      if (text.length > 6000) throw new Error('单条摘录最多 6000 个字符，请缩短选区');
      const result = await chrome.runtime.sendMessage({
        action: 'record-selection',
        kind,
        text,
        url: expectedUrl,
      });
      if (shown !== text) return;
      if (!result?.ok) throw new Error(result?.error || '摘录未保存，请重试');
      status.textContent = result.queued ? '已暂存，等待同步' : result.message;
      status.title = result.message || '';
    } catch (error) {
      if (shown !== text) return;
      status.textContent = error.message || '摘录未保存';
    }
    render();
    hideTimer = setTimeout(() => {
      if (shown === text) {
        dismissed = text;
        hide();
      }
    }, 2200);
  }
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('keydown', escape);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  globalThis.__studyboardSelectionTool = {
    version: 2,
    url: expectedUrl,
    dispose() {
      clearTimeout(timer);
      hide();
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    },
  };
  schedule();
}

// A context-menu clip also gives visible feedback when the extension icon is unpinned.
export function selectionNotice(expectedUrl, message) {
  if (location.href !== expectedUrl || !document.body) return;
  globalThis.__studyboardClipNotice?.remove();
  const host = document.createElement('span');
  host.style.cssText =
    'all:initial!important;position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;pointer-events:none!important;';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.style.cssText =
    'display:block;max-width:290px;background:#243b2c;color:white;padding:8px 14px;border-radius:8px;font:14px/1.5 system-ui;';
  host.attachShadow({ mode: 'open' }).append(status);
  document.body.append(host);
  status.textContent = message;
  globalThis.__studyboardClipNotice = host;
  setTimeout(() => host.remove(), 2500);
}
