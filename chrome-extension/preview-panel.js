import { request } from './bridge.js';
const call = async (action) => (await request('/module', action)).value;
const versionLabel = (template) => {
  const name =
    template?.revision > 1 ? template.name + ' · v' + template.revision : template?.name || '默认模板';
  return template?.common?.revision ? name + ' · 共用提示词 v' + template.common.revision : name;
};
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
};
export function createPreviewPanel(root, studyPage, templateSelect) {
  let context = null,
    epoch = 0,
    material = null,
    report = null,
    studyReport = null,
    versions = [],
    working = false,
    task = null,
    timer = null;
  const idleText = '可直接总结当前网页，也可读取材料与已有笔记对照。';
  const status = node('p', idleText, 'preview-status'),
    read = node('button', '读取当前页面'),
    generate = node('button', '生成预览'),
    model = document.createElement('select'),
    manual = document.createElement('textarea'),
    importButton = node('button', '导入正文 / 字幕'),
    studyPasted = node('button', '总结粘贴内容'),
    output = node('div', null, 'preview-output'),
    cancel = node('button', '取消任务');
  read.type = generate.type = importButton.type = studyPasted.type = cancel.type = 'button';
  generate.disabled = true;
  cancel.hidden = true;
  manual.placeholder = '网页无法读取正文或字幕时，可粘贴在这里。';
  manual.setAttribute('aria-label', '粘贴正文或字幕');
  model.setAttribute('aria-label', '网页学习模型');
  const defaultOption = node('option', '沿用默认模型');
  defaultOption.value = '';
  model.append(defaultOption);
  model.onchange = () => chrome.storage.local.set({ studyboardPreviewModel: model.value });
  const controls = node('div', null, 'preview-controls');
  controls.append(read, generate, cancel);
  const details = node('details'),
    summary = node('summary', '手动导入正文或字幕');
  details.append(summary, manual, importButton, studyPasted);
  root.append(status, controls, model, details, output);
  const busy = (value) => {
    working = value;
    studyPage.disabled = value || !context?.id;
    read.disabled = value || !context?.id;
    generate.disabled = value || !material;
    importButton.disabled = value || !context?.id;
    studyPasted.disabled = value || !context?.id;
    model.disabled = value;
    if (templateSelect) templateSelect.disabled = value;
    const history = output.querySelector('select');
    if (history) history.disabled = value;
    cancel.hidden = !value || !task?.id;
  };
  function error(error) {
    status.textContent = error.message || String(error);
    status.classList.add('is-error');
  }
  async function persist() {
    if (context)
      await chrome.storage.local.set({
        ['material-preview:' + context.id]: {
          materialId: material?.id || null,
          studyId: studyReport?.id || null,
          taskId: ['queued', 'running'].includes(task?.status) ? task.id : null,
        },
      });
  }
  function sourceButton(source) {
    const button = node('button', '查看来源 · ' + source.title, 'preview-source');
    const token = epoch;
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
        if (token === epoch) error(e);
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
    if (versions.length > 1) {
      const label = node('label', '已生成的网页总结');
      const history = document.createElement('select');
      for (const item of [...versions].reverse()) {
        const option = node(
          'option',
          [
            versionLabel(item.template),
            item.model,
            item.createdAt && new Date(item.createdAt).toLocaleString(),
          ]
            .filter(Boolean)
            .join(' · '),
        );
        option.value = item.id;
        history.append(option);
      }
      history.value = studyReport?.id || '';
      history.disabled = working;
      history.onchange = async () => {
        const token = ++epoch;
        busy(true);
        try {
          await load(material.id, token, history.value);
          if (epoch === token) await persist();
        } catch (e) {
          if (epoch === token) error(e);
        } finally {
          if (epoch === token) busy(false);
        }
      };
      label.append(history);
      output.append(label);
    }
    if (studyReport?.unavailable) output.append(node('p', '这份网页学习总结的来源已不可用。'));
    if (studyReport?.value) {
      const study = studyReport.value,
        enrollment = {
          action: 'materials.enrollStudy',
          id: material.id,
          reportId: studyReport.id,
          boardId: context.id,
          url: context.url,
        },
        section = node('section', '', 'page-study');
      section.setAttribute('aria-label', '网页学习总结');
      section.append(
        node('h2', study.title),
        node('p', '总结模板 · ' + versionLabel(studyReport.template), 'preview-muted'),
        node('h3', '文章主旨'),
        claim(study.overview),
      );
      if (study.partial) section.append(node('p', '本次总结仅覆盖已读取的部分正文或字幕。', 'preview-muted'));
      section.append(node('h3', '要点与记忆提示'));
      for (const point of study.points) {
        const item = claim(point.body);
        item.prepend(node('strong', point.title));
        item.append(node('p', '记忆提示 · ' + point.cue, 'preview-cue'));
        section.append(item);
      }
      section.append(node('h3', '回忆自测'));
      for (const question of study.reviewQuestions) {
        const item = node('details');
        item.append(
          node('summary', question.prompt),
          claim({ text: question.answer, evidence: question.evidence }),
        );
        section.append(item);
      }
      const enroll = node('button', '将自测题加入今日复习'),
        notice = node('p');
      notice.setAttribute('role', 'status');
      enroll.onclick = async () => {
        enroll.disabled = true;
        try {
          const result = await call(enrollment);
          notice.textContent = result.suspended
            ? `已加入 ${result.total - result.suspended} 道，${result.suspended} 道已停用。`
            : `${result.total} 道自测题已加入今日复习。`;
        } catch (e) {
          notice.textContent = e.message;
          enroll.disabled = false;
        }
      };
      section.append(enroll, notice);
      output.append(section);
    }
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
  async function load(id, token = epoch, studyId) {
    const result = await call({
      action: 'materials.get',
      id,
      studyId,
      boardId: context.id,
      url: context.url,
    });
    if (token !== epoch) return;
    material = result.material;
    report = result.report;
    studyReport = result.studyReport;
    versions = result.studyVersions || [];
    status.textContent =
      (studyReport?.value ? '已保存网页学习总结 · ' : '已读取：') +
      material.title +
      (material.completeness === 'partial' ? '（部分内容）' : '');
    status.classList.remove('is-error');
    render();
  }
  async function watch(next, token = epoch) {
    if (token !== epoch) return;
    task = next;
    if (next.status !== 'done') await persist();
    if (token !== epoch) return;
    if (timer) clearTimeout(timer);
    if (['queued', 'running'].includes(task.status)) {
      busy(true);
      status.textContent = task.phase;
      status.classList.remove('is-error');
      timer = setTimeout(async () => {
        try {
          const updated = await call({ action: 'tasks.get', id: next.id });
          if (token === epoch) await watch(updated, token);
        } catch (e) {
          if (token === epoch) {
            busy(false);
            error(e);
          }
        }
      }, 1200);
    } else if (task.status === 'done') {
      if (next.result?.materialId)
        await load(
          next.result.materialId,
          token,
          next.result.kind === 'pageStudy' ? next.result.reportId : undefined,
        );
      if (token === epoch) {
        await persist();
        busy(false);
      }
    } else {
      busy(false);
      if (task.error) error(task.error);
    }
  }
  async function capture({ study = false, pasted = false, openPanel } = {}) {
    if (!context?.id || working) return;
    const token = ++epoch,
      current = { ...context };
    const templateId = templateSelect?.value || 'default';
    task = null;
    busy(true);
    status.classList.remove('is-error');
    try {
      if (openPanel) await openPanel();
      if (token !== epoch) return;
      let document;
      if (pasted) {
        if (!manual.value.trim()) throw new Error('请先粘贴正文或字幕');
        document = {
          title: current.title,
          url: current.url,
          text: manual.value,
          ...(study ? { completeness: 'partial' } : {}),
        };
      } else {
        status.textContent = '正在读取页面正文或字幕…';
        const result = await chrome.runtime.sendMessage({ action: 'extract-material', context: current });
        if (token !== epoch) return;
        if (!result?.ok) {
          details.open = true;
          throw new Error(result?.error || '无法读取当前页面，可在下方粘贴正文');
        }
        document = result.document;
        if (document.url !== current.url) throw new Error('网页已切换，请重新读取');
        if (!document.blocks?.length) {
          details.open = true;
          manual.focus();
          status.textContent = document.needsTranscript
            ? '没有可读取的字幕，请在下方粘贴字幕后总结。'
            : '没有读取到正文，请在下方粘贴正文后总结。';
          return;
        }
      }
      const saved = await call({ action: 'materials.capture', ...document, boardId: current.id });
      if (token !== epoch) return;
      await load(saved.id, token);
      if (token !== epoch) return;
      await persist();
      if (token !== epoch) return;
      if (pasted) {
        manual.value = '';
        details.open = false;
      }
      if (study) {
        status.textContent = '正在生成网页学习总结…';
        const [provider, selected] = model.value.split('\n');
        const next = await call({
          action: 'materials.study',
          templateId,
          id: saved.id,
          boardId: current.id,
          url: current.url,
          route: provider ? { provider, model: selected } : undefined,
        });
        await watch(next, token);
      }
    } catch (e) {
      if (token === epoch) {
        busy(false);
        error(e);
      }
    } finally {
      if (token === epoch && !['queued', 'running'].includes(task?.status)) busy(false);
    }
  }
  read.onclick = () => capture();
  importButton.onclick = () => capture({ pasted: true });
  studyPasted.onclick = () => capture({ study: true, pasted: true });
  generate.onclick = async () => {
    if (!material || working) return;
    const token = ++epoch;
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
  cancel.onclick = async () => {
    const token = epoch;
    try {
      if (task?.id) await watch(await call({ action: 'tasks.cancel', id: task.id }), token);
    } catch (e) {
      if (token === epoch) error(e);
    }
  };
  return {
    setTemplates(items = [{ id: 'default', name: '默认模板' }]) {
      if (!templateSelect) return;
      const selected = templateSelect.value || 'default';
      templateSelect.replaceChildren(
        ...items.map((item) => {
          const option = node('option', item.name);
          option.value = item.id;
          return option;
        }),
      );
      if (!items.some((item) => item.id === selected)) {
        const missing = node('option', '模板已删除，请重新选择');
        missing.value = selected;
        missing.disabled = true;
        templateSelect.append(missing);
      }
      templateSelect.value = selected;
    },
    summarizePage(openPanel) {
      return capture({ study: true, openPanel });
    },
    async setContext(value) {
      if (context?.id === value?.id && context?.url === value?.url && context?.tabId === value?.tabId) {
        context = value;
        return;
      }
      context = value;
      const token = ++epoch;
      clearTimeout(timer);
      material = report = studyReport = task = null;
      versions = [];
      manual.value = '';
      details.open = false;
      output.replaceChildren();
      busy(false);
      status.textContent = idleText;
      status.classList.remove('is-error');
      if (!context?.id) return;
      try {
        const key = 'material-preview:' + context.id,
          saved = (await chrome.storage.local.get(key))[key];
        if (token !== epoch) return;
        if (saved?.materialId) await load(saved.materialId, token, saved.studyId);
        if (token !== epoch) return;
        if (saved?.taskId) {
          const current = await call({ action: 'tasks.get', id: saved.taskId });
          if (token === epoch) await watch(current, token);
        } else busy(false);
      } catch {
        if (token === epoch) busy(false);
      }
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
