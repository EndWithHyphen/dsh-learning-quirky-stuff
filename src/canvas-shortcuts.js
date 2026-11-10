export const CANVAS_TOOLS = [
  ['selection', '选择', 'V / 1'],
  ['hand', '拖动', 'H'],
  ['freedraw', '画笔', 'P / 7'],
  ['eraser', '橡皮', 'E / 0'],
  ['rectangle', '方框', 'R / 2'],
  ['diamond', '菱形', 'D / 3'],
  ['ellipse', '圆形', 'O / 4'],
  ['arrow', '箭头', 'A / 5'],
  ['line', '直线', 'L / 6'],
  ['text', '文字', 'T / 8'],
  ['image', '插入图片', '9'],
  ['frame', '画框', 'F'],
];
export const focusCanvas = (root) => root?.querySelector('.excalidraw')?.focus({ preventScroll: true });
export function isEditingCanvasText(target) {
  return !!target?.closest?.(
    'textarea,select,[contenteditable="true"],[role="textbox"],input:not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"])',
  );
}
export function bindCanvasShortcuts(
  root,
  { getApi, onSave, onExport, onCapture, onHelp, onFit, onWidget, onError = () => {} },
) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || ''),
    forwarded = new WeakSet();
  root.classList.add('study-canvas-surface');
  const consume = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const run = (fn) => {
    try {
      Promise.resolve(fn?.()).catch(onError);
    } catch (e) {
      onError(e);
    }
  };
  function native(e, changes = {}) {
    const engine = root.querySelector('.excalidraw');
    if (!engine) return;
    const next = new KeyboardEvent('keydown', {
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      bubbles: true,
      cancelable: true,
      ...changes,
    });
    forwarded.add(next);
    focusCanvas(root);
    engine.dispatchEvent(next);
  }
  const primary = (key, code, shiftKey = false) => ({
    key,
    code,
    ctrlKey: !mac,
    metaKey: mac,
    altKey: false,
    shiftKey,
  });
  function zoom(factor, reset = false) {
    const api = getApi(),
      s = api.getAppState(),
      old = s.zoom.value,
      value = reset ? 1 : Math.max(0.1, Math.min(30, Math.round(old * factor * 100) / 100));
    api.updateScene({
      appState: {
        zoom: { value },
        scrollX: s.scrollX + (s.width / 2) * (1 / value - 1 / old),
        scrollY: s.scrollY + (s.height / 2) * (1 / value - 1 / old),
      },
    });
  }
  function fit(selected) {
    const api = getApi(),
      s = api.getAppState(),
      elements = api.getSceneElements().filter((e) => !selected || s.selectedElementIds[e.id]);
    if (!elements.length) {
      api.setToast({ message: selected ? '请先选中要聚焦的内容' : '画布还是空的' });
      return;
    }
    onFit
      ? onFit(elements)
      : api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.8, maxZoom: 1 });
  }
  function keydown(e) {
    if (
      forwarded.has(e) ||
      root.dataset.learningPlacement ||
      e.isComposing ||
      e.keyCode === 229 ||
      isEditingCanvasText(e.target) ||
      e.target.closest?.('[role="dialog"]')
    )
      return;
    const api = getApi();
    if (!api || api.getAppState().editingTextElement) return;
    const primaryPressed = e.ctrlKey || e.metaKey,
      engine = root.querySelector('.excalidraw'),
      inside = engine?.contains(e.target);
    if (primaryPressed) {
      // Keep browser navigation, find, page zoom, save/print and tab shortcuts.
      const edit =
        !e.altKey &&
        (['KeyZ', 'KeyV'].includes(e.code) ||
          (!e.shiftKey && ['KeyA', 'KeyC', 'KeyX'].includes(e.code)) ||
          (!mac && !e.shiftKey && e.code === 'KeyY'));
      if (!edit) {
        e.stopImmediatePropagation();
        return;
      }
      if (!inside) {
        if (['KeyC', 'KeyV', 'KeyX'].includes(e.code)) focusCanvas(root);
        else {
          consume(e);
          native(e);
        }
      }
      return;
    }
    if (
      e.key === 'F1' ||
      e.code === 'F1' ||
      (e.altKey && ['ArrowLeft', 'ArrowRight', 'Home', 'F4', 'Space'].includes(e.code)) ||
      (e.shiftKey && e.code === 'Escape')
    ) {
      e.stopImmediatePropagation();
      return;
    }
    if (e.altKey) {
      const widget =
        e.shiftKey &&
        { KeyQ: 'question', KeyK: 'concept', KeyC: 'comparison', KeyL: 'steps', KeyM: 'image-note' }[e.code];
      if (widget && onWidget) {
        consume(e);
        if (!e.repeat) run(() => onWidget(widget));
        return;
      }
      let action;
      if (e.code === 'KeyS') action = e.shiftKey ? onCapture && (() => onCapture('region')) : onSave;
      if (e.code === 'KeyV' && e.shiftKey && onCapture) action = () => onCapture('full');
      if (e.code === 'KeyP' && e.shiftKey) action = onExport;
      if (action) {
        consume(e);
        if (!e.repeat) run(action);
        return;
      }
      if (e.code === 'KeyD') {
        if (e.shiftKey) {
          consume(e);
          if (!e.repeat) native(e, primary('d', 'KeyD'));
        } else e.stopImmediatePropagation();
        return;
      }
      const alternatives = {
        KeyG: ['g', 'KeyG'],
        KeyK: ['k', 'KeyK'],
        BracketLeft: ['[', 'BracketLeft'],
        BracketRight: [']', 'BracketRight'],
      };
      if (alternatives[e.code]) {
        consume(e);
        if (!e.repeat) native(e, primary(...alternatives[e.code], e.shiftKey));
        return;
      }
      e.stopImmediatePropagation();
      return;
    }
    if (e.code === 'KeyK') {
      consume(e);
      return;
    }
    if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) {
      consume(e);
      if (!e.repeat) onHelp?.();
      return;
    }
    if (e.shiftKey && ['Digit0', 'Digit1', 'Digit2'].includes(e.code)) {
      consume(e);
      if (e.code === 'Digit0') zoom(1, true);
      else fit(e.code === 'Digit2');
      return;
    }
    if (
      ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(e.code) &&
      (!e.shiftKey || ['Equal', 'NumpadAdd'].includes(e.code))
    ) {
      consume(e);
      zoom(['Equal', 'NumpadAdd'].includes(e.code) ? 1.25 : 0.8);
      return;
    }
    const local =
      /^(Key[VHRDOALPTEFQSGI]|Digit[0-9]|Space|Delete|Backspace|Escape|Arrow(Left|Right|Up|Down))$/.test(
        e.code,
      );
    if (local && !inside) {
      consume(e);
      native(e);
    }
  }
  function click(e) {
    if (e.target.closest?.('.help-icon')) {
      consume(e);
      onHelp?.();
    }
  }
  root.addEventListener('keydown', keydown, true);
  root.addEventListener('click', click, true);
  return () => {
    root.removeEventListener('keydown', keydown, true);
    root.removeEventListener('click', click, true);
    root.classList.remove('study-canvas-surface');
  };
}
