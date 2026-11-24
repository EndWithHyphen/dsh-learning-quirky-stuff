import React, { useEffect, useRef, useState } from 'react';
import { summaryStrategy } from '../summary-prompt.js';
import { SUMMARY_PRESETS, summaryTemplates } from '../shared/summary-templates.js';
import { useLearning } from './features/context.jsx';

export default function SummaryTemplatePicker({ value, onChange, surface, disabled }) {
  const { settings, update } = useLearning();
  const templates = summaryTemplates(settings?.summaryTemplates);
  const selected = templates.find((item) => item.id === value);
  const [draft, setDraft] = useState(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [confirmDelete, setConfirmDelete] = useState(false);
  const dialog = useRef(null);
  const open = !!draft;
  useEffect(() => {
    if (open) dialog.current.showModal();
  }, [open]);

  function manage() {
    setError('');
    setConfirmDelete(false);
    setDraft({ ...selected, prompt: summaryStrategy(selected, surface), readOnly: true });
  }
  function create(copy) {
    setError('');
    setDraft({
      id: crypto.randomUUID(),
      revision: 0,
      name: copy ? draft.name.slice(0, 77) + ' 副本' : '',
      prompt: copy ? draft.prompt : '',
      readOnly: false,
    });
  }
  function editCommon() {
    setError('');
    const common = settings.summaryTemplateCommon || { prompt: '', revision: 0 };
    setDraft({ ...common, common: true });
  }
  async function save(remove = false) {
    setSaving(true);
    setError('');
    try {
      const { id, revision, name, prompt } = draft;
      if (draft.common) await update({ summaryTemplateCommon: { revision, prompt } });
      else {
        await update({ summaryTemplate: { id, revision, name, prompt, remove } });
        onChange(remove ? 'default' : id);
      }
      setDraft(null);
    } catch (e) {
      setError(e.message || '模板未保存');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="sb-template-picker">
      <label>
        总结模板
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {!selected && (
            <option value={value} disabled>
              模板已删除，请重新选择
            </option>
          )}
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="sb-button"
        disabled={disabled || !selected || !settings}
        onClick={manage}
      >
        管理模板
      </button>
      {draft && (
        <dialog
          className="sb-template-dialog"
          aria-label="管理总结模板"
          ref={dialog}
          onCancel={(e) => {
            e.preventDefault();
            if (!saving) setDraft(null);
          }}
        >
          <header>
            <h3>
              {draft.common
                ? '编辑共用提示词'
                : draft.readOnly
                  ? '管理总结模板'
                  : draft.revision
                    ? '编辑模板'
                    : '新建模板'}
            </h3>
            <button type="button" className="sb-button" disabled={saving} onClick={() => setDraft(null)}>
              关闭
            </button>
          </header>
          {!draft.common && (
            <label>
              模板名称
              <input
                value={draft.name}
                maxLength={80}
                readOnly={draft.readOnly}
                disabled={saving}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
          )}
          <label>
            {draft.common ? '共用提示词' : '模板提示词'}
            <textarea
              rows={8}
              placeholder={draft.common ? '例如，首次出现关键术语时附上英文名称。' : undefined}
              value={draft.prompt}
              maxLength={12000}
              readOnly={draft.readOnly}
              disabled={saving}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
          </label>
          <p className="sb-muted">
            {draft.common
              ? '这段要求会用于所有模板新生成的画布和网页总结。清空并保存即可移除。'
              : '模板提示词决定总结的侧重点和写法。生成时会自动附上本次材料和输出要求。'}
          </p>
          {error && (
            <p className="sb-notice" role="alert">
              {error}
            </p>
          )}
          {confirmDelete ? (
            <>
              <p>删除「{draft.name}」？已生成的总结仍可查看。</p>
              <footer>
                <button className="sb-button" disabled={saving} onClick={() => setConfirmDelete(false)}>
                  取消
                </button>
                <button className="sb-button" disabled={saving} onClick={() => save(true)}>
                  确认删除
                </button>
              </footer>
            </>
          ) : (
            <footer>
              {draft.readOnly ? (
                <>
                  <button className="sb-button" onClick={() => create(false)}>
                    新建模板
                  </button>
                  <button className="sb-button" onClick={() => create(true)}>
                    复制为新模板
                  </button>
                  <button className="sb-button" onClick={editCommon}>
                    编辑共用提示词
                  </button>
                  {!SUMMARY_PRESETS.some((item) => item.id === draft.id) && (
                    <>
                      <button className="sb-button" onClick={() => setDraft({ ...draft, readOnly: false })}>
                        编辑模板
                      </button>
                      <button className="sb-button" onClick={() => setConfirmDelete(true)}>
                        删除模板
                      </button>
                    </>
                  )}
                </>
              ) : (
                <button
                  className="sb-button sb-primary"
                  disabled={saving || (!draft.common && (!draft.name.trim() || !draft.prompt.trim()))}
                  onClick={() => save()}
                >
                  {saving ? '正在保存…' : draft.common ? '保存共用提示词' : '保存模板'}
                </button>
              )}
            </footer>
          )}
        </dialog>
      )}
    </div>
  );
}
