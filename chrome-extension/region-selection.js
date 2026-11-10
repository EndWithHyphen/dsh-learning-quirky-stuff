// Serialized by chrome.scripting: keep this function self-contained.
export function selectRegion(captureId = '') {
  return new Promise((resolve) => {
    const eventName = 'studyboard:cancel-capture';
    if (window.__studyboardCancelledCapture === captureId && captureId) return resolve(null);
    document.dispatchEvent(new CustomEvent(eventName));
    document.getElementById('__studyboard_capture')?.remove();
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.id = '__studyboard_capture';
    overlay.tabIndex = -1;
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      cursor: 'crosshair',
      background: 'rgba(25,35,30,.12)',
      touchAction: 'none',
      outline: 'none',
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'absolute',
      display: 'none',
      border: '2px solid #47745d',
      background: 'rgba(255,255,255,.12)',
      boxShadow: '0 0 0 99999px rgba(10,20,15,.28)',
      pointerEvents: 'none',
    });
    overlay.appendChild(box);
    const hint = document.createElement('div');
    hint.textContent = '拖动选择截图区域 · Esc 取消';
    Object.assign(hint.style, {
      position: 'absolute',
      top: '18px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '10px 18px',
      background: '#fff',
      color: '#24392c',
      borderRadius: '8px',
      font: '14px system-ui',
      pointerEvents: 'none',
    });
    overlay.appendChild(hint);
    const cancel = document.createElement('button');
    cancel.textContent = '取消截图';
    cancel.type = 'button';
    Object.assign(cancel.style, {
      position: 'absolute',
      top: '18px',
      right: '18px',
      padding: '10px 14px',
      background: '#fff',
      color: '#24392c',
      border: '1px solid #ccd8cd',
      borderRadius: '8px',
      cursor: 'pointer',
      font: '14px system-ui',
    });
    overlay.appendChild(cancel);
    let start = null,
      done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener(eventName, cancelEvent);
      window.removeEventListener('pagehide', abort);
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
      if (!result) {
        resolve(null);
        return;
      }
      // A hidden tab may stop animation frames; cancellation must never wait for one.
      const fallback = setTimeout(() => resolve(result), 200);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          clearTimeout(fallback);
          resolve(result);
        }),
      );
    };
    const abort = () => finish(null),
      cancelEvent = (e) => {
        if (!e.detail || e.detail === captureId) finish(null);
      };
    const key = (e) => {
      if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(null);
      }
    };
    const timer = setTimeout(abort, 45000);
    document.addEventListener('keydown', key, true);
    document.addEventListener(eventName, cancelEvent);
    window.addEventListener('pagehide', abort);
    overlay.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    cancel.onpointerdown = (e) => e.stopPropagation();
    cancel.onclick = (e) => {
      e.stopPropagation();
      finish(null);
    };
    overlay.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      overlay.setPointerCapture(e.pointerId);
      box.style.display = 'block';
    };
    overlay.onpointermove = (e) => {
      if (!start) return;
      Object.assign(box.style, {
        left: Math.min(start.x, e.clientX) + 'px',
        top: Math.min(start.y, e.clientY) + 'px',
        width: Math.abs(start.x - e.clientX) + 'px',
        height: Math.abs(start.y - e.clientY) + 'px',
      });
    };
    overlay.onpointercancel = abort;
    overlay.onpointerup = (e) => {
      if (!start) return;
      const left = Math.min(start.x, e.clientX),
        top = Math.min(start.y, e.clientY),
        width = Math.abs(start.x - e.clientX),
        height = Math.abs(start.y - e.clientY);
      const video =
        [...document.querySelectorAll('video')].find((v) => !v.paused) || document.querySelector('video');
      finish(
        width < 5 || height < 5
          ? null
          : {
              left,
              top,
              width,
              height,
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
              videoTime: video && Number.isFinite(video.currentTime) ? video.currentTime : null,
            },
      );
    };
    document.documentElement.appendChild(overlay);
    overlay.focus({ preventScroll: true });
  });
}

export function cancelRegion(captureId) {
  window.__studyboardCancelledCapture = captureId;
  document.dispatchEvent(new CustomEvent('studyboard:cancel-capture', { detail: captureId }));
}
