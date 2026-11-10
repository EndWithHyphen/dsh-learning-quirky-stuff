import { request } from './bridge.js';
const call = async (action) => (await request('/module', action)).value;
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
};
export function createPreviewPanel(root) {
  let context = null,
    epoch = 0,
    material = null,
    report = null,
    task = null,
    timer = null;
  const status = node('p', '先读取当前文章或字幕，再查看新增内容。', 'preview-status'),
    read = node('button', '读取当前页面'),
    generate = node('button', '生成预览'),
    model = document.createElement('select'),
    manual = document.createElement('textarea'),
    importButton = node('button', '导入正文 / 字幕'),
    output = node('div', null, 'preview-output'),
    cancel = node('button', '取消任务');
  read.type = generate.type = importButton.type = cancel.type = 'button';
  generate.disabled = true;
  cancel.hidden = true;
  manual.placeholder = '网页无法读取正文或字幕时，可粘贴在这里。';
  manual.setAttribute('aria-label', '粘贴正文或字幕');
  model.setAttribute('aria-label', '材料预览模型');
  const defaultOption = node('option', '沿用默认模型');
  defaultOption.value = '';
  model.append(defaultOption);
  model.onchange = () => chrome.storage.local.set({ studyboardPreviewModel: model.value });
  const controls = node('div', null, 'preview-controls');
  controls.append(read, generate, cancel);
  const details = node('details'),
    summary = node('summary', '手动导入正文或字幕');
  details.append(summary, manual, importButton);
  root.append(status, controls, model, details, output);
  const busy = (value) => {
    read.disabled = value || !context?.id;
    generate.disabled = value || !material;
    importButton.disabled = value || !context?.id;
    cancel.hidden = !value || !task?.id;
  };
  function error(error) {
    status.textContent = error.message || String(error);
    status.classList.add('is-error');
  }
  async function persist() {
    if (context)
      await chrome.storage.local.set({
        ['material-preview:' + context.id]: { materialId: material?.id || null, taskId: task?.id || null },
      });
  }
  function sourceButton(source) {
    const button = node('button', '查看来源 · ' + source.title, 'preview-source');
    button.onclick = async () => {
      try {
        if (source.materialId === material?.id) {
          const result = await chrome.runtime.sendMessage({
            action: 'focus-material',
            context,
            locator: { ...source.locator, quote: source.quote || source.text },
          });
          if (!result?.ok) throw new Error(result?.error || '无法定位');
        } else {
          const note = node('blockquote', source.quote || source.text);
          button.after(note);
          button.disabled = true;
        }
      } catch (e) {
        error(e);
      }
    };
    return button;
  }
  function claim(value) {
    const card = node('div', null, 'preview-claim');
    card.append(node('p', value.text));
    for (const source of [...new Map(value.evidence.map((source) => [source.id, source])).values()])
      card.append(sourceButton(source));
    return card;
  }
  function render() {
    output.replaceChildren();
    if (report?.unavailable) {
      output.append(node('p', '来源已删除，请重新读取材料。'));
      return;
    }
    if (!report?.value) return;
    const value = report.value;
    output.append(node('h2', value.question), claim(value.overview));
    for (const [key, title] of [
      ['newPoints', '新增内容'],
      ['alreadyRecorded', '笔记中已有记录'],
      ['differences', '值得对照的差异'],
    ]) {
      if (!value[key].length) continue;
      output.append(node('h3', title));
      for (const item of value[key]) output.append(claim(item));
    }
    if (value.readingPlan.length) {
      output.append(node('h3', '建议细读的位置'));
      for (const step of value.readingPlan) {
        const item = node('div', null, 'preview-step');
        item.append(node('strong', step.title), node('p', step.reason));
        for (const source of step.sources) item.append(sourceButton(source));
        output.append(item);
      }
    }
    if (value.limitations) output.append(node('p', value.limitations, 'preview-muted'));
  }
  async function load(id, token = epoch) {
    const result = await call({ action: 'materials.get', id });
    if (token !== epoch) return;
    material = result.material;
    report = result.report;
    status.textContent =
      '已读取：' + material.title + (material.completeness === 'partial' ? '（部分内容）' : '');
    status.classList.remove('is-error');
    generate.disabled = false;
    render();
  }
  async function watch(next, token = epoch) {
    if (token !== epoch) return;
    task = next;
    busy(['queued', 'running'].includes(task.status));
    await persist();
    if (timer) clearTimeout(timer);
    if (['queued', 'running'].includes(task.status)) {
      status.textContent = task.phase;
      status.classList.remove('is-error');
      timer = setTimeout(async () => {
        try {
          const updated = await call({ action: 'tasks.get', id: task.id });
          if (token === epoch) await watch(updated, token);
        } catch (e) {
          if (token === epoch) {
            busy(false);
            error(e);
          }
        }
      }, 1200);
    } else if (task.status === 'done') {
      busy(false);
      if (task.result?.materialId) await load(task.result.materialId, token);
    } else {
      busy(false);
      if (task.error) error(task.error);
    }
  }
  read.onclick = async () => {
    if (!context) return;
    const token = epoch,
      current = { ...context };
    busy(true);
    status.textContent = '正在读取页面正文或字幕…';
    try {
      const result = await chrome.runtime.sendMessage({ action: 'extract-material', context: current });
      if (token !== epoch) return;
      if (!result?.ok) throw new Error(result?.error || '无法读取当前页面');
      if (!result.document.blocks.length) {
        details.open = true;
        status.textContent = result.document.needsTranscript
          ? '没有读取到可访问的字幕，请粘贴字幕或在 DSH 导入 SRT / VTT 文件。'
          : '没有读取到正文，请在下方粘贴。';
        return;
      }
      const saved = await call({ action: 'materials.capture', ...result.document, boardId: current.id });
      if (token !== epoch) return;
      await load(saved.id, token);
      await persist();
    } catch (e) {
      if (token === epoch) error(e);
    } finally {
      if (token === epoch) busy(false);
    }
  };
  generate.onclick = async () => {
    if (!material) return;
    const token = epoch;
    busy(true);
    try {
      const [provider, selected] = model.value.split('\n');
      const next = await call({
        action: 'materials.preview',
        id: material.id,
        route: provider ? { provider, model: selected } : undefined,
      });
      await watch(next, token);
    } catch (e) {
      if (token === epoch) {
        busy(false);
        error(e);
      }
    }
  };
  importButton.onclick = async () => {
    if (!manual.value.trim() || !context) return;
    const token = epoch,
      current = { ...context };
    busy(true);
    try {
      const saved = await call({
        action: 'materials.capture',
        title: current.title,
        url: current.url,
        boardId: current.id,
        text: manual.value,
      });
      if (token !== epoch) return;
      manual.value = '';
      await load(saved.id, token);
      await persist();
      details.open = false;
    } catch (e) {
      if (token === epoch) error(e);
    } finally {
      if (token === epoch) busy(false);
    }
  };
  cancel.onclick = async () => {
    const token = epoch;
    try {
      if (task?.id) await watch(await call({ action: 'tasks.cancel', id: task.id }), token);
    } catch (e) {
      if (token === epoch) error(e);
    }
  };
  return {
    async setContext(value) {
      if (context?.id === value?.id) {
        context = value;
        return;
      }
      context = value;
      const token = ++epoch;
      clearTimeout(timer);
      material = report = task = null;
      manual.value = '';
      output.replaceChildren();
      busy(false);
      status.textContent = '先读取当前文章或字幕，再查看新增内容。';
      if (!context?.id) return;
      try {
        const key = 'material-preview:' + context.id,
          saved = (await chrome.storage.local.get(key))[key];
        if (saved?.materialId) await load(saved.materialId, token);
        if (saved?.taskId) {
          const current = await call({ action: 'tasks.get', id: saved.taskId });
          if (token === epoch && ['queued', 'running'].includes(current.status)) await watch(current, token);
        }
      } catch {}
    },
    async refreshModels() {
      try {
        const models = await call({ action: 'features.models' });
        const current =
          model.value ||
          (await chrome.storage.local.get('studyboardPreviewModel')).studyboardPreviewModel ||
          '';
        model.replaceChildren(defaultOption);
        for (const item of models) {
          const option = node('option', item.name);
          option.value = item.provider + '\n' + item.id;
          model.append(option);
        }
        model.value = [...model.options].some((option) => option.value === current) ? current : '';
      } catch {}
    },
    dispose() {
      clearTimeout(timer);
      epoch++;
    },
  };
}
