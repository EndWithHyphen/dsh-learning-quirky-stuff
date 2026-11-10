// Runs in the tab's isolated extension world. The notebook remains in an
// extension iframe, so the webpage cannot read its contents or connection data.
export function mountBottomDrawer({ src, height }) {
  document.getElementById('__studyboard_bottom')?.remove();
  const host = document.createElement('div');
  host.id = '__studyboard_bottom';
  Object.assign(host.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '2147483646',
    height: '0',
    border: '0',
    transition: 'height 180ms ease',
    boxShadow: '0 -4px 30px #0002',
    borderRadius: '14px 14px 0 0',
    overflow: 'hidden',
    background: '#fff',
  });
  const shadow = host.attachShadow({ mode: 'closed' }),
    style = document.createElement('style');
  style.textContent =
    ':host{color-scheme:light}*{box-sizing:border-box}.handle{height:14px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;background:#f4f6f4;touch-action:none;border-top:1px solid #dfe5df}.handle:after{content:"";width:46px;height:4px;border-radius:3px;background:#a5afa7}iframe{display:block;border:0;width:100%;height:calc(100% - 14px);background:#fff}.shield{position:absolute;inset:14px 0 0;display:none;cursor:ns-resize}';
  const handle = document.createElement('div');
  handle.className = 'handle';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', '拖动调整笔记面板高度');
  handle.tabIndex = 0;
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = '学习画板 · 底部笔记';
  frame.setAttribute('allow', 'clipboard-read; clipboard-write');
  window.__studyboardBottomFrame = frame;
  const shield = document.createElement('div');
  shield.className = 'shield';
  shadow.append(style, handle, frame, shield);
  document.documentElement.appendChild(host);
  const clamp = (h) => Math.min(Math.max(240, h), Math.max(240, innerHeight - 70));
  let current = clamp(height || Math.max(400, innerHeight * 0.5)),
    start = null;
  const setHeight = (h) => {
    current = clamp(h);
    host.style.height = current + 'px';
    handle.setAttribute('aria-valuenow', String(Math.round(current)));
  };
  requestAnimationFrame(() => setHeight(current));
  handle.onpointerdown = (e) => {
    e.preventDefault();
    start = { y: e.clientY, height: current };
    host.style.transition = 'none';
    shield.style.display = 'block';
    handle.setPointerCapture(e.pointerId);
  };
  handle.onpointermove = (e) => {
    if (start) setHeight(start.height + start.y - e.clientY);
  };
  const end = () => {
    if (!start) return;
    start = null;
    shield.style.display = 'none';
    chrome.runtime.sendMessage({ action: 'dock-height', height: current }).catch(() => {});
  };
  handle.onpointerup = end;
  handle.onpointercancel = end;
  handle.onkeydown = (e) => {
    if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      setHeight(current + (e.key === 'ArrowUp' ? 40 : -40));
      chrome.runtime.sendMessage({ action: 'dock-height', height: current }).catch(() => {});
    }
  };
  return { mounted: true };
}
export function revealBottomDrawer() {
  const host = document.getElementById('__studyboard_bottom');
  if (!host) return false;
  host.style.visibility = '';
  window.__studyboardBottomFrame?.contentWindow?.focus();
  return true;
}
export function removeBottomDrawer() {
  document.getElementById('__studyboard_bottom')?.remove();
  delete window.__studyboardBottomFrame;
}
export function hideBottomDrawer(hidden) {
  const host = document.getElementById('__studyboard_bottom');
  if (host) host.style.visibility = hidden ? 'hidden' : '';
  return new Promise((resolve) => {
    if (!hidden) return resolve();
    const timeout = setTimeout(resolve, 180);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timeout);
        resolve();
      }),
    );
  });
}
