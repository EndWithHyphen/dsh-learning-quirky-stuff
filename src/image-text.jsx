import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  convertToExcalidrawElements,
  CaptureUpdateAction,
  getCommonBounds,
  newElementWith,
} from '@excalidraw/excalidraw';
import { findLearningSpace, wrapLearningText } from './learning-layout.js';
import { focusCanvas } from './canvas-shortcuts.js';
const meta = (e) => e?.customData?.studyboard || {};
const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const fingerprint = (image, file) => JSON.stringify([image.fileId, image.crop || null, file?.dataURL || '']);
function linkedText(image, elements) {
  const owner = meta(image).imageTextOwnerId || image.id;
  return elements.filter(
    (e) =>
      !e.isDeleted &&
      (meta(e).imageTextFor === image.id ||
        (owner !== image.id &&
          meta(e).imageTextFor === owner &&
          image.groupIds.some((id) => e.groupIds.includes(id)))),
  );
}
export default function ImageText({ apiRef, rootRef, noteId, execute, flush }) {
  const [imageId, setImageId] = useState(null),
    [target, setTarget] = useState(null),
    [enabled, setEnabled] = useState(true),
    [capability, setCapability] = useState(null),
    [form, setForm] = useState(null);
  const services = useRef({ execute, flush }),
    epoch = useRef(0),
    task = useRef(null),
    dialog = useRef(null),
    saving = useRef(false);
  services.current = { execute, flush };
  useEffect(() => {
    let frame,
      off,
      observer,
      stopped = false;
    const load = () =>
      services.current
        .execute({ action: 'features.get' })
        .then((s) => {
          if (!stopped) setEnabled(s.features?.search === true);
        })
        .catch(() => {});
    services.current
      .execute({ action: 'system.capabilities' })
      .then((value) => {
        if (!stopped) setCapability(value.ocr);
      })
      .catch(() => {});
    load();
    window.addEventListener('focus', load);
    const attach = () => {
      if (stopped) return;
      const api = apiRef.current,
        root = rootRef.current;
      if (!api || !root) {
        frame = requestAnimationFrame(attach);
        return;
      }
      const update = () => {
        const selected = api.getAppState().selectedElementIds;
        const images = api
          .getSceneElements()
          .filter((e) => !e.isDeleted && e.type === 'image' && selected[e.id]);
        setImageId(images.length === 1 ? images[0].id : null);
      };
      const panel = () =>
        setTarget(root.querySelector('.selected-shape-actions .panelColumn, .App-mobile-menu .panelColumn'));
      update();
      panel();
      off = api.onChange(update);
      observer = new MutationObserver(panel);
      observer.observe(root, { childList: true, subtree: true });
    };
    frame = requestAnimationFrame(attach);
    return () => {
      stopped = true;
      epoch.current++;
      cancelAnimationFrame(frame);
      off?.();
      observer?.disconnect();
      window.removeEventListener('focus', load);
      if (task.current)
        services.current.execute({ action: 'tasks.cancel', id: task.current }).catch(() => {});
    };
  }, [noteId]);
  useEffect(() => {
    if (form) dialog.current?.querySelector('textarea,button')?.focus({ preventScroll: true });
  }, [!!form]);
  function source(id) {
    const api = apiRef.current,
      image = api?.getSceneElements().find((e) => e.id === id && !e.isDeleted && e.type === 'image');
    const file = image && api.getFiles()[image.fileId];
    if (!image || !file?.dataURL) throw new Error('图片尚未保存完整，请稍后重试');
    return { image, file, stamp: fingerprint(image, file) };
  }
  function close() {
    if (saving.current) return;
    epoch.current++;
    if (task.current) services.current.execute({ action: 'tasks.cancel', id: task.current }).catch(() => {});
    task.current = null;
    setForm(null);
    focusCanvas(rootRef.current);
  }
  async function recognize(id, force = false) {
    const token = ++epoch.current;
    if (task.current) services.current.execute({ action: 'tasks.cancel', id: task.current }).catch(() => {});
    task.current = null;
    let snapshot;
    try {
      snapshot = source(id);
      setForm({ id, snapshot, text: '', busy: true, phase: '正在保存画布…', error: '' });
      await tick();
      await services.current.flush();
      if (token !== epoch.current) return;
      if (source(id).stamp !== snapshot.stamp) throw new Error('图片已变化，请重新识别');
      let job = await services.current.execute({
        action: 'search.recognizeImage',
        id: noteId,
        imageId: id,
        force,
      });
      if (token !== epoch.current) {
        if (job.id && ['queued', 'running'].includes(job.status))
          await services.current.execute({ action: 'tasks.cancel', id: job.id });
        return;
      }
      task.current = job.id || null;
      while (['queued', 'running'].includes(job.status)) {
        setForm((old) => old && { ...old, phase: job.phase || '正在识别图中文字…' });
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (token !== epoch.current) return;
        job = await services.current.execute({ action: 'tasks.get', id: job.id });
      }
      if (token !== epoch.current) return;
      if (job.status !== 'done') throw new Error(job.error || '识别未完成，请重试');
      const current = source(id);
      if (current.stamp !== snapshot.stamp) throw new Error('图片已变化，请重新识别');
      const existing = linkedText(current.image, apiRef.current.getSceneElements()).find(
        (e) => meta(e).role === 'image-text-body' && meta(e).sourceHash === job.result.hash,
      );
      let text = job.result.text;
      if (!force && existing)
        text =
          existing.text === meta(existing).renderedText
            ? meta(existing).rawText
            : (existing.originalText ?? existing.text);
      task.current = null;
      setForm({ id, snapshot, hash: job.result.hash, text, busy: false, error: '' });
    } catch (error) {
      if (token === epoch.current)
        setForm((old) => ({ ...old, id, snapshot, busy: false, error: error.message }));
    }
  }
  async function confirm() {
    if (saving.current || !form?.text?.trim() || !form.hash) return;
    const token = epoch.current,
      currentForm = form;
    saving.current = true;
    setForm((old) => ({ ...old, saving: true, error: '' }));
    try {
      await tick();
      await services.current.flush();
      if (token !== epoch.current) return;
      let current = source(currentForm.id);
      if (current.stamp !== currentForm.snapshot.stamp) throw new Error('图片已变化，请重新识别');
      await services.current.execute({
        action: 'search.confirmImage',
        id: noteId,
        imageId: currentForm.id,
        hash: currentForm.hash,
        text: currentForm.text,
      });
      if (token !== epoch.current) return;
      current = source(currentForm.id);
      if (current.stamp !== currentForm.snapshot.stamp) throw new Error('图片已变化，请重新识别');
      const api = apiRef.current,
        elements = api.getSceneElementsIncludingDeleted(),
        old = linkedText(current.image, elements),
        oldBody = old.find((e) => meta(e).role === 'image-text-body');
      const scale = oldBody
        ? oldBody.fontSize / 17
        : 1 / Math.max(0.25, Math.min(4, api.getAppState().zoom.value));
      const width = 380 * scale,
        gap = 24 * scale,
        ctx = document.createElement('canvas').getContext('2d');
      const text = wrapLearningText(currentForm.text, width, 17 * scale, (value, size) => {
        ctx.font = size + 'px Helvetica, Arial, sans-serif';
        return ctx.measureText(value).width;
      });
      const height = text.split('\n').length * 17 * scale * 1.35 + 34 * scale;
      const [x1, y1, x2] = getCommonBounds([current.image]);
      const oldIds = new Set(old.map((e) => e.id)),
        oldLabel = old.find((e) => meta(e).role === 'image-text-label');
      const obstacles = elements
        .filter((e) => !e.isDeleted && e.type !== 'frame' && !oldIds.has(e.id))
        .map((e) => {
          const [x, y, r, b] = getCommonBounds([e]);
          return { x, y, width: r - x, height: b - y };
        });
      const origin = oldLabel
        ? { x: oldLabel.x, y: oldLabel.y }
        : oldBody
          ? { x: oldBody.x, y: oldBody.y - 30 * scale }
          : findLearningSpace({ x: x2 + gap, y: y1, width, height }, obstacles, gap);
      const groups = current.image.groupIds.length ? current.image.groupIds : [crypto.randomUUID()];
      const skeleton = [
        { role: 'image-text-label', id: oldLabel?.id, text: '图中文字', size: 12, y: 0, color: '#718276' },
        { role: 'image-text-body', id: oldBody?.id, text, size: 17, y: 30 * scale, color: '#24382c' },
      ].map((item) => ({
        id: item.id || crypto.randomUUID(),
        type: 'text',
        x: origin.x,
        y: origin.y + item.y,
        width,
        text: item.text,
        fontSize: item.size * scale,
        fontFamily: 2,
        lineHeight: 1.35,
        textAlign: 'left',
        verticalAlign: 'top',
        strokeColor: item.color,
        groupIds: groups,
        customData: {
          studyboard: {
            imageTextFor: current.image.id,
            role: item.role,
            sourceHash: currentForm.hash,
            rawText: currentForm.text,
            renderedText: item.text,
          },
        },
      }));
      const created = convertToExcalidrawElements(skeleton, { regenerateIds: false }),
        changes = new Map(created.map((e) => [e.id, e]));
      const result = elements.map((e) => {
        if (changes.has(e.id)) {
          const { id, version, versionNonce, index, updated, ...patch } = changes.get(e.id);
          changes.delete(e.id);
          return newElementWith(e, patch);
        }
        if (e.id === current.image.id)
          return newElementWith(e, {
            groupIds: groups,
            customData: { ...e.customData, studyboard: { ...meta(e), imageTextOwnerId: e.id } },
          });
        if (oldIds.has(e.id)) return newElementWith(e, { isDeleted: true });
        return e;
      });
      result.push(...changes.values());
      api.updateScene({
        elements: result,
        appState: { selectedElementIds: Object.fromEntries(created.map((e) => [e.id, true])) },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      api.setActiveTool({ type: 'selection' });
      await tick();
      await services.current.flush();
      if (token !== epoch.current) return;
      setForm(null);
      api.scrollToContent(created, { animate: false });
      api.setToast({ message: '核对后的文字已放入画布并保存，可双击文字继续编辑' });
      focusCanvas(rootRef.current);
    } catch (error) {
      if (token === epoch.current) setForm((old) => ({ ...old, saving: false, error: error.message }));
    } finally {
      saving.current = false;
    }
  }
  const action = enabled && imageId && (
    <fieldset className="study-image-text-action">
      <legend>图中文字</legend>
      <button
        type="button"
        disabled={capability?.available === false}
        title={capability?.reason || ''}
        onClick={() => recognize(imageId)}
      >
        识别文字
      </button>
    </fieldset>
  );
  return (
    <>
      {action && (target ? createPortal(action, target) : action)}
      {form &&
        createPortal(
          <div className="study-widget-mask">
            <section
              className="study-widget-dialog study-image-text-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="核对图中文字"
              ref={dialog}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }
                if (e.key === 'Tab') {
                  const nodes = [
                    ...dialog.current.querySelectorAll('button:not(:disabled),textarea:not(:disabled)'),
                  ];
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
                <h2>核对图中文字</h2>
                <button disabled={form.saving} aria-label="关闭文字识别" onClick={close}>
                  ×
                </button>
              </header>
              {form.snapshot && (
                <details className="study-image-text-preview" open>
                  <summary>对照原图</summary>
                  {form.snapshot.image.crop ? (
                    <svg
                      viewBox={[
                        form.snapshot.image.crop.x,
                        form.snapshot.image.crop.y,
                        form.snapshot.image.crop.width,
                        form.snapshot.image.crop.height,
                      ].join(' ')}
                    >
                      <image
                        href={form.snapshot.file.dataURL}
                        width={form.snapshot.image.crop.naturalWidth}
                        height={form.snapshot.image.crop.naturalHeight}
                      />
                    </svg>
                  ) : (
                    <img src={form.snapshot.file.dataURL} alt="正在识别的原图" />
                  )}
                </details>
              )}
              {form.busy ? (
                <p role="status">{form.phase}</p>
              ) : (
                <div className="study-widget-fields">
                  <label>
                    核对并编辑文字
                    <textarea
                      aria-label="核对并编辑文字"
                      rows={9}
                      maxLength={50000}
                      disabled={form.saving}
                      value={form.text || ''}
                      onChange={(e) => setForm({ ...form, text: e.target.value })}
                    />
                  </label>
                  <p>请检查错字和阅读顺序。确认后放到图片旁边；再次确认会更新已有文字。</p>
                </div>
              )}
              {form.error && (
                <p className="study-widget-error" role="alert">
                  {form.error}
                </p>
              )}
              <footer>
                <button disabled={form.saving} onClick={close}>
                  取消
                </button>
                <button disabled={form.busy || form.saving} onClick={() => recognize(form.id, true)}>
                  重新识别
                </button>
                <button
                  className="study-widget-submit"
                  disabled={form.busy || form.saving || !form.hash || !form.text?.trim()}
                  onClick={confirm}
                >
                  {form.saving ? '正在保存…' : '确认并放入画布'}
                </button>
              </footer>
            </section>
          </div>,
          rootRef.current,
        )}
    </>
  );
}
