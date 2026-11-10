import React, { useEffect, useState } from 'react';
import { CANVAS_TOOLS, focusCanvas } from './canvas-shortcuts.js';
import CanvasTextWrap from './canvas-text-wrap.jsx';
const paths = {
  selection: 'M5 3l14 8-7 2-3 7z M12 13l5 7',
  hand: 'M8 12V6a1.5 1.5 0 013 0v6-8a1.5 1.5 0 013 0v8-6a1.5 1.5 0 013 0v6-3a1.5 1.5 0 013 0v6c0 4-3 7-7 7h-1c-2 0-4-1-5-3l-3-5a1.5 1.5 0 012-2l2 2',
  freedraw: 'M4 20l1-5L16 4l4 4L9 19z M14 6l4 4',
  eraser: 'M4 13L14 3l7 7-10 10H7z M9 8l7 7 M11 20h10',
  rectangle: 'M4 4h16v16H4z',
  diamond: 'M12 2l10 10-10 10L2 12z',
  ellipse: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0',
  arrow: 'M3 12h18 M15 6l6 6-6 6',
  line: 'M3 12h18',
  text: 'M4 5h16 M12 5v15 M8 20h8',
  image: 'M3 3h18v18H3z M3 16l5-5 5 5 3-3 5 5 M16 7h.01',
  frame: 'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',
  lock: 'M6 10h12v11H6z M8 10V6a4 4 0 018 0v4',
  fit: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
  pen: 'M7 20l3-8 7-9 4 4-9 7z M10 12l2 2',
};
const hints = {
  selection: '单击选择，拖选多个对象；双击学习卡片编辑内容。',
  hand: '拖动画布；也可按住空格拖动。',
  freedraw: '按住鼠标或触控笔绘制笔迹。',
  eraser: '拖过要擦除的笔迹或对象。',
  rectangle: '拖动绘制方框，按住 Shift 画正方形。',
  diamond: '拖动绘制菱形。',
  ellipse: '拖动绘制椭圆，按住 Shift 画圆。',
  arrow: '拖动画箭头；单击添加拐点，再次按 A 切换箭头类型。',
  line: '拖动画直线，单击添加拐点。',
  text: '单击空白处输入；双击已有文字或卡片进行编辑。',
  image: '选择本机图片，也可直接粘贴图片。',
  frame: '圈定一组内容，方便整理和一起移动。',
  lock: '锁定当前工具，绘制后继续使用。',
  fit: '显示画布里的全部内容。',
  pen: '触控笔负责绘制，手指用于移动画布。',
};
export default function CanvasTools({ apiRef, rootRef, onFit, children }) {
  const [state, setState] = useState({ type: 'selection', locked: false, penMode: false }),
    [hover, setHover] = useState(null);
  useEffect(() => {
    const clear = () => setHover(null);
    const leaveFrame = (event) => {
      if (!event.relatedTarget) clear();
    };
    window.addEventListener('blur', clear);
    document.addEventListener('mouseout', leaveFrame);
    document.addEventListener('pointerout', leaveFrame);
    return () => {
      window.removeEventListener('blur', clear);
      document.removeEventListener('mouseout', leaveFrame);
      document.removeEventListener('pointerout', leaveFrame);
    };
  }, []);
  useEffect(() => {
    let frame,
      off,
      stopped = false;
    const attach = () => {
      if (stopped) return;
      const api = apiRef.current;
      if (!api) {
        frame = requestAnimationFrame(attach);
        return;
      }
      const update = () => {
        const s = api.getAppState(),
          next = { type: s.activeTool.type, locked: !!s.activeTool.locked, penMode: !!s.penMode };
        setState((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      };
      update();
      off = api.onChange(update);
    };
    frame = requestAnimationFrame(attach);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      off?.();
    };
  }, []);
  const buttons = [
    ['lock', '锁定工具', 'Q'],
    ...CANVAS_TOOLS,
    ['pen', '触控笔模式', ''],
    ['fit', '全览', 'Shift + 1'],
  ];
  return (
    <div className="study-tools" role="toolbar" aria-label="画布工具" onPointerLeave={() => setHover(null)}>
      <div className="study-tools-buttons">
        {buttons.map(([type, label, key]) => (
          <button
            type="button"
            key={type}
            aria-label={label}
            aria-keyshortcuts={key.split(' / ')[0] || undefined}
            aria-pressed={
              type === 'lock' ? state.locked : type === 'pen' ? state.penMode : state.type === type
            }
            onMouseEnter={() => setHover(type)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(type)}
            onBlur={() => setHover(null)}
            onClick={() => {
              const api = apiRef.current;
              if (!api) return;
              if (type === 'lock')
                api.updateScene({
                  appState: { activeTool: { ...api.getAppState().activeTool, locked: !state.locked } },
                });
              else if (type === 'pen') api.updateScene({ appState: { penMode: !state.penMode } });
              else if (type === 'fit')
                onFit
                  ? onFit()
                  : api.scrollToContent(api.getSceneElements(), {
                      fitToViewport: true,
                      viewportZoomFactor: 0.85,
                      maxZoom: 1,
                    });
              else api.setActiveTool({ type });
              setHover(null);
              focusCanvas(rootRef.current);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="19"
              height="19"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={paths[type]} />
            </svg>
          </button>
        ))}
      </div>
      <CanvasTextWrap apiRef={apiRef} />
      {children}
      {hover && (
        <div className="study-tools-tip" role="tooltip">
          <strong>
            {buttons
              .find((v) => v[0] === hover)
              ?.slice(1)
              .filter(Boolean)
              .join(' · ')}
          </strong>
          <span>{hints[hover]}</span>
        </div>
      )}
    </div>
  );
}
