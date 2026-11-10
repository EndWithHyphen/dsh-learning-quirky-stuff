import React, { useEffect, useLayoutEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import {
  convertToExcalidrawElements,
  CaptureUpdateAction,
  getCommonBounds,
  newElementWith,
} from '@excalidraw/excalidraw';
import { LEARNING_TYPES, layoutLearningCard, findLearningSpace } from './learning-layout.js';
import {
  ownedCardElements as owned,
  readCardValues as currentValues,
  cardAtPoint,
} from './learning-card-data.js';
import { focusCanvas, isEditingCanvasText } from './canvas-shortcuts.js';
const meta = (e) => e?.customData?.studyboard || {};
const live = (elements) => elements.filter((e) => !e.isDeleted);
const box = (e) => {
  const [x1, y1, x2, y2] = getCommonBounds([e]);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};
const contains = (a, b) =>
  b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
function selected(api) {
  if (!api) return { image: null, widget: null };
  const all = live(api.getSceneElements()),
    state = api.getAppState(),
    picked = all.filter((e) => state.selectedElementIds[e.id]),
    images = picked.filter((e) => e.type === 'image');
  const direct = picked.filter((e) => meta(e).role === 'background' && meta(e).widget && e.groupIds.length);
  if (direct.length)
    return { image: images.length === 1 ? images[0] : null, widget: direct.length === 1 ? direct[0] : null };
  const owners = all.filter(
    (e) =>
      meta(e).role === 'background' &&
      meta(e).widget &&
      e.groupIds.length &&
      picked.some((p) => p.id === e.id || p.groupIds.some((g) => e.groupIds.includes(g))),
  );
  return { image: images.length === 1 ? images[0] : null, widget: owners.length === 1 ? owners[0] : null };
}
export default forwardRef(function LearningWidgets({ apiRef, rootRef, onError }, ref) {
  const [menu, setMenu] = useState(false),
    [form, setForm] = useState(null),
    [placement, setPlacement] = useState(null),
    [drag, setDrag] = useState(null),
    [error, setError] = useState(''),
    [choice, setChoice] = useState({ image: null, widget: null });
  const overlay = useRef(),
    dialog = useRef(),
    start = useRef(),
    measureContext = useRef(),
    drafts = useRef({});
  const api = () => apiRef.current,
    root = () => rootRef.current;
  function measure(text, size) {
    const ctx = (measureContext.current ??= document.createElement('canvas').getContext('2d'));
    ctx.font = size + 'px Helvetica, Arial, sans-serif';
    return ctx.measureText(text).width;
  }
  useEffect(() => {
    let stop = false,
      frame,
      off;
    const attach = () => {
      if (stop) return;
      const value = api();
      if (!value) {
        frame = requestAnimationFrame(attach);
        return;
      }
      const update = () => {
        const next = selected(value);
        setChoice((old) =>
          old.image?.id === next.image?.id && old.widget?.id === next.widget?.id ? old : next,
        );
      };
      update();
      off = value.onChange(update);
    };
    frame = requestAnimationFrame(attach);
    return () => {
      stop = true;
      cancelAnimationFrame(frame);
      off?.();
    };
  }, []);
  useEffect(() => {
    if (menu || form) dialog.current?.querySelector('input,textarea,button')?.focus({ preventScroll: true });
  }, [menu, form?.kind, form?.ownerId, form?.imageId]);
  useLayoutEffect(() => {
    const r = root();
    if (!r) return;
    if (placement) {
      r.dataset.learningPlacement = 'true';
      overlay.current?.focus({ preventScroll: true });
    } else delete r.dataset.learningPlacement;
    return () => {
      delete r.dataset.learningPlacement;
    };
  }, [placement]);
  function open(kind) {
    setError('');
    setMenu(false);
    if (kind === 'image-note') {
      const image = selected(api()).image;
      if (!image) {
        api().setToast({ message: '先选中一张图片，再添加备注' });
        return;
      }
      editImage(image.id);
      return;
    }
    if (!LEARNING_TYPES[kind]) {
      setMenu(true);
      return;
    }
    const values = Object.fromEntries(
      LEARNING_TYPES[kind].fields.map(([key]) => [key, drafts.current[kind]?.[key] || '']),
    );
    if (kind === 'concept')
      values.items =
        drafts.current[kind]?.items ||
        Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), title: '', body: '' }));
    setForm({ kind, values });
  }
  function editImage(id) {
    const image = api()
      ?.getSceneElements()
      .find((e) => e.id === id && e.type === 'image');
    if (!image) {
      api()?.setToast({ message: '请先选中一张图片' });
      return;
    }
    setMenu(false);
    setError('');
    setForm({ kind: 'image-note', imageId: id, values: { note: meta(image).imageNote || '' } });
  }
  function editCard(owner = selected(api()).widget) {
    if (!owner?.id) owner = selected(api()).widget;
    if (!owner) return;
    setMenu(false);
    setError('');
    setForm({
      kind: meta(owner).widget,
      ownerId: owner.id,
      values: currentValues(owner, api().getSceneElementsIncludingDeleted()),
    });
  }
  const interaction = useRef({});
  interaction.current = { form, menu, placement, editCard };
  useEffect(() => {
    const element = root();
    if (!element) return;
    const consume = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const edit = (event) => {
      const current = interaction.current,
        value = api();
      if (
        !value ||
        current.form ||
        current.menu ||
        current.placement ||
        event.isComposing ||
        isEditingCanvasText(event.target) ||
        event.target.closest?.('[role="dialog"]')
      )
        return;
      const state = value.getAppState();
      if (state.viewModeEnabled || state.editingTextElement) return;
      let owner;
      if (event.type === 'keydown') {
        if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        owner = selected(value).widget;
      } else {
        if (event.button !== 0 || event.target.tagName !== 'CANVAS') return;
        if (
          event.type === 'pointerdown'
            ? state.activeTool.type !== 'text'
            : !['selection', 'text'].includes(state.activeTool.type)
        )
          return;
        const rect = element.querySelector('.excalidraw').getBoundingClientRect(),
          z = state.zoom.value;
        owner = cardAtPoint(value.getSceneElements(), {
          x: (event.clientX - rect.left) / z - state.scrollX,
          y: (event.clientY - rect.top) / z - state.scrollY,
        });
      }
      if (!owner || owner.locked) return;
      consume(event);
      current.editCard(owner);
    };
    for (const type of ['dblclick', 'pointerdown', 'keydown']) element.addEventListener(type, edit, true);
    return () => {
      for (const type of ['dblclick', 'pointerdown', 'keydown'])
        element.removeEventListener(type, edit, true);
    };
  }, []);
  useImperativeHandle(ref, () => ({
    open,
    openMenu: () => {
      setChoice(selected(api()));
      setMenu(true);
    },
    editImage,
    get placing() {
      return !!placement;
    },
  }));
  function close() {
    if (form && !form.ownerId && !form.imageId) drafts.current[form.kind] = form.values;
    setForm(null);
    setMenu(false);
    setError('');
    focusCanvas(root());
  }
  function patchScene(created, removeIds = [], extra = []) {
    const current = api().getSceneElementsIncludingDeleted(),
      changes = new Map([...created, ...extra].map((e) => [e.id, e])),
      removed = new Set(removeIds),
      ids = new Set(current.map((e) => e.id));
    const result = current.map((e) => {
      if (changes.has(e.id)) {
        const { id, version, versionNonce, updated, index, ...updates } = changes.get(e.id);
        return newElementWith(e, updates);
      }
      return removed.has(e.id) ? newElementWith(e, { isDeleted: true }) : e;
    });
    for (const e of [...created, ...extra]) if (!ids.has(e.id)) result.push(e);
    api().updateScene({
      elements: result,
      appState: {
        selectedElementIds: Object.fromEntries(
          [...created, ...extra].filter((e) => !e.isDeleted).map((e) => [e.id, true]),
        ),
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api().setActiveTool({ type: 'selection' });
    focusCanvas(root());
  }
  function reveal(elements) {
    if (!elements.length) return;
    const [x1, y1, x2, y2] = getCommonBounds(elements),
      state = api().getAppState(),
      rect = root().querySelector('.excalidraw').getBoundingClientRect(),
      left = rect.width >= 740 ? 230 : 22,
      top = 70,
      bottom = 90,
      w = Math.max(100, rect.width - left - 22),
      h = Math.max(100, rect.height - top - bottom);
    const z = Math.max(0.1, Math.min(2, w / Math.max(1, x2 - x1), h / Math.max(1, y2 - y1)) * 0.92);
    api().updateScene({
      appState: {
        zoom: { value: z },
        scrollX: (left + w / 2) / z - (x1 + x2) / 2,
        scrollY: (top + h / 2) / z - (y1 + y2) / 2,
      },
    });
  }
  function makeElements(layout, origin, data, groupId, old = []) {
    const roles = new Map(old.map((e) => [meta(e).role, e])),
      ownerId = data.ownerId || crypto.randomUUID();
    const skeleton = layout.items.map((item) => {
      const { role, field, ...shape } = item,
        id = role === 'background' ? ownerId : roles.get(role)?.id || crypto.randomUUID();
      return {
        ...shape,
        id,
        x: origin.x + shape.x,
        y: origin.y + shape.y,
        groupIds: [groupId],
        customData: {
          studyboard: {
            widgetId: ownerId,
            role,
            field: field || null,
            renderedText: shape.text || '',
            ...(data.imageId ? { imageNoteFor: data.imageId } : {}),
            ...(role === 'background' && !data.imageId
              ? {
                  widget: data.kind,
                  values: data.values,
                  groupId,
                  scale: data.scale,
                  layoutWidth: layout.width,
                }
              : {}),
          },
        },
      };
    });
    return JSON.parse(JSON.stringify(convertToExcalidrawElements(skeleton, { regenerateIds: false })));
  }
  function place(formData, area) {
    const all = api().getSceneElementsIncludingDeleted(),
      owner = formData.ownerId ? all.find((e) => e.id === formData.ownerId && !e.isDeleted) : null;
    if (formData.ownerId && !owner) throw new Error('这张卡片已不存在');
    const old = owner ? owned(owner, all) : [],
      scale = owner
        ? ((meta(owner).scale || 1) * owner.width) / (meta(owner).layoutWidth || owner.width)
        : 1 / Math.max(0.25, Math.min(4, api().getAppState().zoom.value));
    const groupId =
        owner?.groupIds.find((g) => g === meta(owner).groupId) || owner?.groupIds[0] || crypto.randomUUID(),
      layout = layoutLearningCard(formData.kind, formData.values, area, scale, measure);
    const ignore = new Set(old.map((e) => e.id)),
      obstacles = live(all)
        .filter((e) => e.type !== 'frame' && !ignore.has(e.id))
        .map(box);
    const origin = owner
      ? { x: owner.x, y: owner.y }
      : findLearningSpace(
          { x: area.x, y: area.y, width: layout.width, height: layout.height },
          obstacles,
          20 * scale,
        );
    const created = makeElements(
      layout,
      origin,
      { kind: formData.kind, values: formData.values, scale, ownerId: owner?.id },
      groupId,
      old,
    );
    if (owner) for (const e of created) e.groupIds = owner.groupIds;
    const parent = live(all)
      .filter(
        (e) =>
          e.type === 'frame' && contains(box(e), { ...origin, width: layout.width, height: layout.height }),
      )
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    if (parent) for (const e of created) e.frameId = parent.id;
    patchScene(
      created,
      old.map((e) => e.id),
    );
    reveal(created);
    drafts.current[formData.kind] = null;
    api().setToast({ message: owner ? '卡片已更新并重新排版' : '已按所选区域自动排版' });
  }
  function saveImageNote() {
    const all = api().getSceneElementsIncludingDeleted(),
      image = all.find((e) => e.id === form.imageId && !e.isDeleted),
      note = form.values.note.trim();
    if (!image) throw new Error('图片已不存在');
    const linked = meta(image).imageNoteOwnerId || image.id,
      old = all.filter(
        (e) =>
          meta(e).imageNoteFor === image.id ||
          (linked !== image.id &&
            meta(e).imageNoteFor === linked &&
            image.groupIds[0] &&
            e.groupIds.includes(image.groupIds[0])),
      ),
      scale = 1 / Math.max(0.25, Math.min(4, api().getAppState().zoom.value)),
      groups = image.groupIds.length ? image.groupIds : [crypto.randomUUID()];
    const data = {
      ...(image.customData || {}),
      studyboard: { ...meta(image), imageNote: note, imageNoteOwnerId: image.id },
    };
    if (!note) {
      patchScene(
        [],
        old.map((e) => e.id),
        [newElementWith(image, { customData: data })],
      );
      api().setToast({ message: '图片备注已移除' });
      return;
    }
    const layout = layoutLearningCard(
        'image-note',
        { note },
        { width: Math.max(270 * scale, Math.min(image.width, 540 * scale)), height: 0 },
        scale,
        measure,
      ),
      bounds = box(image),
      gap = 20 * scale,
      oldIds = new Set(old.map((e) => e.id));
    const obstacles = live(all)
        .filter((e) => e.type !== 'frame' && !oldIds.has(e.id))
        .map(box),
      candidates = [
        { x: bounds.x, y: bounds.y + bounds.height + gap },
        { x: bounds.x + bounds.width + gap, y: bounds.y },
        { x: bounds.x - layout.width - gap, y: bounds.y },
        { x: bounds.x, y: bounds.y - layout.height - gap },
      ];
    let origin = candidates.find(
      (p) =>
        !obstacles.some(
          (o) =>
            p.x < o.x + o.width &&
            p.x + layout.width > o.x &&
            p.y < o.y + o.height &&
            p.y + layout.height > o.y,
        ),
    );
    origin =
      origin ||
      findLearningSpace({ ...candidates[0], width: layout.width, height: layout.height }, obstacles, gap);
    const created = makeElements(
      layout,
      origin,
      { imageId: image.id, ownerId: old.find((e) => meta(e).role === 'background')?.id },
      groups[0],
      old,
    );
    for (const e of created) e.groupIds = groups;
    patchScene(
      created,
      old.map((e) => e.id),
      [newElementWith(image, { customData: data, groupIds: groups })],
    );
    reveal([image, ...created]);
    api().setToast({ message: '图片备注已保存并自动摆放' });
  }
  function submit() {
    try {
      if (form.kind === 'image-note') {
        saveImageNote();
        setForm(null);
        return;
      }
      if (form.kind === 'concept') {
        form.values.items = form.values.items.filter((item) => item.title.trim() || item.body.trim());
        if (!form.values.items.length) throw new Error('至少填写一个知识点');
        if (form.values.items.length > 20) throw new Error('每张卡片最多 20 个知识点');
      }
      const missing = LEARNING_TYPES[form.kind].fields.find(
        ([key, , required]) => required && !String(form.values[key] || '').trim(),
      );
      if (missing) throw new Error('请填写' + missing[1]);
      if (form.kind === 'steps' && form.values.steps.split('\n').filter((v) => v.trim()).length > 20)
        throw new Error('每张步骤卡最多 20 步，请分成多张卡片');
      if (form.ownerId) {
        const owner = api()
          .getSceneElements()
          .find((e) => e.id === form.ownerId);
        place(form, { x: owner.x, y: owner.y, width: owner.width, height: owner.height });
        setForm(null);
        return;
      }
      setPlacement(form);
      setDrag(null);
      setForm(null);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  function cancelPlacement() {
    setForm(placement);
    setPlacement(null);
    setDrag(null);
    start.current = null;
  }
  function pointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    start.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
  }
  function pointerMove(e) {
    if (start.current)
      setDrag({
        x: Math.min(start.current.x, e.clientX),
        y: Math.min(start.current.y, e.clientY),
        width: Math.abs(e.clientX - start.current.x),
        height: Math.abs(e.clientY - start.current.y),
      });
  }
  function pointerUp(e) {
    if (!start.current) return;
    e.preventDefault();
    e.stopPropagation();
    const first = start.current;
    start.current = null;
    const rect = root().querySelector('.excalidraw').getBoundingClientRect(),
      state = api().getAppState(),
      z = state.zoom.value,
      click = Math.abs(e.clientX - first.x) < 8 && Math.abs(e.clientY - first.y) < 8;
    const area = {
      x: (Math.min(first.x, e.clientX) - rect.left) / z - state.scrollX,
      y: (Math.min(first.y, e.clientY) - rect.top) / z - state.scrollY,
      width: (click ? Math.min(460, rect.width - 45) : Math.abs(e.clientX - first.x)) / z,
      height: (click ? 260 : Math.abs(e.clientY - first.y)) / z,
    };
    try {
      place(placement, area);
      setPlacement(null);
      setDrag(null);
    } catch (error) {
      setError(error.message);
      setForm(placement);
      setPlacement(null);
    }
  }
  const placementTarget = root()?.querySelector('.canvas-engine') || root();
  const fields =
    form?.kind === 'image-note'
      ? [['note', '图片备注（清空可移除）', false, 7]]
      : form
        ? LEARNING_TYPES[form.kind].fields
        : [];
  return (
    <>
      {(menu || form) && (
        <div className="study-widget-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <section
            className="study-widget-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              menu ? '学习控件' : form.kind === 'image-note' ? '图片备注' : LEARNING_TYPES[form.kind].name
            }
            ref={dialog}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
              if (e.key === 'Tab') {
                const nodes = [...dialog.current.querySelectorAll('button:not(:disabled),input,textarea')];
                if (e.shiftKey && document.activeElement === nodes[0]) {
                  e.preventDefault();
                  nodes.at(-1)?.focus();
                } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
                  e.preventDefault();
                  nodes[0]?.focus();
                }
              }
            }}
          >
            <header>
              <h2>
                {menu ? '学习控件' : form.kind === 'image-note' ? '图片备注' : LEARNING_TYPES[form.kind].name}
              </h2>
              <button aria-label="关闭学习控件" onClick={close}>
                ×
              </button>
            </header>
            {menu ? (
              <>
                <div className="study-widget-choices">
                  {Object.entries(LEARNING_TYPES).map(([kind, item]) => (
                    <button key={kind} onClick={() => open(kind)}>
                      <strong>{item.name}</strong>
                      <span>{item.hint}</span>
                    </button>
                  ))}
                  <button disabled={!choice.image} onClick={() => editImage(choice.image.id)}>
                    <strong>图片备注</strong>
                    <span>{choice.image ? '给选中的图片写说明' : '先选中一张图片'}</span>
                  </button>
                  <button disabled={!choice.widget} onClick={editCard}>
                    <strong>编辑选中卡片</strong>
                    <span>修改内容并重新排版</span>
                  </button>
                </div>
                <p>填写后拖选摆放区域，松开即可自动排版。内容较多时会自动向下展开，并避开已有内容。</p>
              </>
            ) : (
              <>
                <div className={'study-widget-fields ' + (form.kind === 'comparison' ? 'is-comparison' : '')}>
                  {form.kind === 'concept' && (
                    <p className="study-points-hint">
                      知识点自动按顺序编号；空项会忽略。双击卡片即可再次编辑。
                    </p>
                  )}
                  {fields.map(([key, label, required, rows]) => (
                    <label key={key} className={key === 'title' ? 'full' : ''}>
                      {label}
                      {required && <span className="study-widget-required"> *</span>}
                      {rows === 1 ? (
                        <input
                          value={form.values[key] || ''}
                          maxLength={120}
                          onChange={(e) =>
                            setForm({ ...form, values: { ...form.values, [key]: e.target.value } })
                          }
                        />
                      ) : (
                        <textarea
                          rows={rows}
                          maxLength={6000}
                          value={form.values[key] || ''}
                          onChange={(e) =>
                            setForm({ ...form, values: { ...form.values, [key]: e.target.value } })
                          }
                        />
                      )}
                    </label>
                  ))}
                  {form.kind === 'concept' && (
                    <div className="study-points">
                      {form.values.items.map((item, index) => (
                        <section className="study-point" key={item.id}>
                          <header>
                            <strong>知识点 {index + 1}</strong>
                            <div>
                              <button
                                type="button"
                                aria-label={'上移知识点 ' + (index + 1)}
                                disabled={!index}
                                onClick={() => {
                                  const items = [...form.values.items];
                                  [items[index - 1], items[index]] = [items[index], items[index - 1]];
                                  setForm({ ...form, values: { ...form.values, items } });
                                }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={'下移知识点 ' + (index + 1)}
                                disabled={index === form.values.items.length - 1}
                                onClick={() => {
                                  const items = [...form.values.items];
                                  [items[index + 1], items[index]] = [items[index], items[index + 1]];
                                  setForm({ ...form, values: { ...form.values, items } });
                                }}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                aria-label={'移除知识点 ' + (index + 1)}
                                onClick={() =>
                                  setForm({
                                    ...form,
                                    values: {
                                      ...form.values,
                                      items: form.values.items.filter((v) => v.id !== item.id),
                                    },
                                  })
                                }
                              >
                                移除
                              </button>
                            </div>
                          </header>
                          <label>
                            知识点内容
                            <input
                              aria-label={'知识点 ' + (index + 1)}
                              maxLength={300}
                              value={item.title}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  values: {
                                    ...form.values,
                                    items: form.values.items.map((v) =>
                                      v.id === item.id ? { ...v, title: e.target.value } : v,
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            解释与要点（可留空）
                            <textarea
                              aria-label={'知识点 ' + (index + 1) + ' 的解释'}
                              rows={2}
                              maxLength={6000}
                              value={item.body}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  values: {
                                    ...form.values,
                                    items: form.values.items.map((v) =>
                                      v.id === item.id ? { ...v, body: e.target.value } : v,
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                        </section>
                      ))}
                      <button
                        type="button"
                        disabled={form.values.items.length >= 20}
                        onClick={() =>
                          setForm({
                            ...form,
                            values: {
                              ...form.values,
                              items: [...form.values.items, { id: crypto.randomUUID(), title: '', body: '' }],
                            },
                          })
                        }
                      >
                        ＋ 添加知识点
                      </button>
                    </div>
                  )}
                </div>
                {error && (
                  <p className="study-widget-error" role="alert">
                    {error}
                  </p>
                )}
                <footer>
                  <button onClick={close}>取消</button>
                  <button className="study-widget-submit" onClick={submit}>
                    {form.kind === 'image-note' ? '保存备注' : form.ownerId ? '更新并排版' : '选择摆放区域'}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
      {placement &&
        placementTarget &&
        createPortal(
          <div
            className="study-widget-placement"
            ref={overlay}
            tabIndex={0}
            role="application"
            aria-label="选择学习控件摆放区域"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={cancelPlacement}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                cancelPlacement();
              }
            }}
          >
            <div className="study-widget-placement-hint">
              拖选摆放区域，或单击使用默认大小
              <button onPointerDown={(e) => e.stopPropagation()} onClick={cancelPlacement}>
                取消 · Esc
              </button>
            </div>
            {drag && (
              <div
                className="study-widget-region"
                style={{
                  position: 'fixed',
                  left: drag.x,
                  top: drag.y,
                  width: drag.width,
                  height: drag.height,
                }}
              />
            )}
          </div>,
          placementTarget,
        )}
    </>
  );
});
