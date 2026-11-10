import React, { useEffect, useRef } from 'react';
import { CANVAS_TOOLS, focusCanvas } from './canvas-shortcuts.js';
export default function CanvasShortcutHelp({ root, onClose, capture = false, pdf = false }) {
  const dialog = useRef(),
    mac = /Mac|iPhone|iPad/.test(navigator.platform || ''),
    cmd = mac ? '⌘' : 'Ctrl',
    alt = mac ? '⌥' : 'Alt';
  useEffect(() => {
    dialog.current.querySelector('button').focus();
    return () => focusCanvas(root);
  }, []);
  const groups = [
    ['绘图工具', CANVAS_TOOLS.map(([, name, key]) => [name, key])],
    [
      '编辑与样式',
      [
        ['撤销', cmd + ' Z'],
        ['重做', cmd + ' ⇧ Z'],
        ['复制 / 剪切 / 粘贴', cmd + ' C / X / V'],
        ['全选', cmd + ' A'],
        ['删除选中', 'Delete / Backspace'],
        ['移动 / 较大步移动', '方向键 / ⇧ 方向键'],
        ['复制选中元素', alt + ' ⇧ D'],
        ['组合 / 取消组合', alt + ' G / ' + alt + ' ⇧ G'],
        ['添加链接', alt + ' K'],
        ['上移 / 下移一层', alt + ' ] / ['],
        ['置顶 / 置底', alt + ' ⇧ ] / ['],
        ['连续使用当前工具', 'Q'],
        ['线条颜色 / 填充颜色', 'S / G'],
        ['取线条色 / 取填充色', '⇧ S / I'],
      ],
    ],
    [
      '学习控件',
      [
        ['提问卡', alt + ' ⇧ Q'],
        ['知识点', alt + ' ⇧ K'],
        ['对比卡', alt + ' ⇧ C'],
        ['步骤卡', alt + ' ⇧ L'],
        ['图片备注', alt + ' ⇧ M'],
      ],
    ],
    [
      '视图与保存',
      [
        ['临时拖动画布', '按住空格并拖动'],
        ['画布放大 / 缩小', '+ / −'],
        ['显示全部内容', '⇧ 1'],
        ['聚焦选中内容', '⇧ 2'],
        ['画布恢复 100%', '⇧ 0'],
        ['立即保存', alt + ' S'],
        ...(pdf ? [['导出 PDF', alt + ' ⇧ P']] : []),
        ['退出当前操作', 'Esc'],
        ['查看快捷键', '?'],
      ],
    ],
    ...(capture
      ? [
          [
            '截图',
            [
              ['区域截图', alt + ' ⇧ S'],
              ['可见页截图', alt + ' ⇧ V'],
              ['专注画布 / 退出', alt + ' ⇧ F / Esc'],
              ['取消区域截图', 'Esc'],
            ],
          ],
        ]
      : []),
  ];
  return (
    <div className="study-shortcuts-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={dialog}
        className="study-shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="画布快捷键"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            dialog.current.querySelector('button').focus();
          }
        }}
      >
        <header>
          <div>
            <h2>画布快捷键</h2>
            <p>
              {capture
                ? '绘图键需画布聚焦；截图组合键在整个插件面板内可用。'
                : '点击画布后生效；输入文字时暂停绘图快捷键。'}
            </p>
            <p>{mac ? '⌥ 为 Option，⇧ 为 Shift。' : '⇧ 为 Shift。'}</p>
          </div>
          <button onClick={onClose} aria-label="关闭快捷键">
            ×
          </button>
        </header>
        <div className="study-shortcuts-groups">
          {groups.map(([title, items]) => (
            <section key={title}>
              <h3>{title}</h3>
              <dl>
                {items.map(([name, key]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      <kbd>{key}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="study-shortcuts-note">
          ⌘ / Ctrl 的地址栏、标签页、刷新、查找、打印和网页缩放组合键交给浏览器处理。
        </p>
      </section>
    </div>
  );
}
