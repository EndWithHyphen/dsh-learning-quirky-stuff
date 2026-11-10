import React, { useEffect, useRef, useState } from 'react';
import { useLearning } from './context.jsx';
import {
  Action,
  Claim,
  Evidence,
  ErrorNotice,
  ModelPicker,
  ReportStatus,
  TaskProgress,
  useTask,
} from './shared.jsx';
import { timestampUrl } from '../../shared/material-text.js';
import { highlightText } from './source-focus.js';

const time = (seconds) => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
export default function PreviewView({ context = {} }) {
  const learning = useLearning(),
    [materials, setMaterials] = useState([]),
    [selected, setSelected] = useState(context.materialId || ''),
    [sourceReportId, setSourceReportId] = useState(context.reportId || ''),
    [detail, setDetail] = useState(null),
    [url, setUrl] = useState(''),
    [title, setTitle] = useState(''),
    [text, setText] = useState(''),
    [mode, setMode] = useState('url'),
    [error, setError] = useState(''),
    reader = useRef(),
    requestVersion = useRef(0);
  const refresh = async (id = selected, reportId = sourceReportId) => {
    const version = ++requestVersion.current;
    setMaterials(await learning.api('execute', { action: 'materials.list' }));
    if (id) {
      const data = await learning.api('execute', { action: 'materials.get', id });
      const report = reportId ? await learning.api('execute', { action: 'reports.get', id: reportId }) : null;
      if (version === requestVersion.current)
        setDetail(report?.key === id ? { ...data, report, sourceVersion: true } : data);
    }
  };
  const task = useTask('preview', async (result) => {
    if (result.materialId) {
      setSelected(result.materialId);
      setSourceReportId('');
      await refresh(result.materialId, '');
    }
  });
  useEffect(() => {
    refresh().catch((error) => setError(error.message));
  }, [selected, sourceReportId]);
  useEffect(() => {
    if (context.materialId) setSelected(context.materialId);
    if (context.reportId)
      learning
        .api('execute', { action: 'reports.get', id: context.reportId })
        .then((report) => {
          setSourceReportId(report.id);
          setSelected(report.key);
        })
        .catch((error) => setError(error.message));
  }, [context.materialId, context.reportId]);
  useEffect(() => {
    if (detail?.report?.id === context.reportId)
      requestAnimationFrame(() =>
        highlightText(document.querySelector('.sb-module-report'), context.textQuote),
      );
  }, [detail?.report?.id, context.reportId, context.textQuote]);
  useEffect(() => {
    if (detail && context.blockId) {
      const node = [...(reader.current?.querySelectorAll('[data-material-block]') || [])].find(
        (node) => node.dataset.materialBlock === context.blockId,
      );
      node?.scrollIntoView({ block: 'center' });
    }
  }, [detail?.material.id, context.blockId]);
  async function capture() {
    try {
      const material = await learning.api('execute', {
        action: 'materials.capture',
        title,
        text,
        ...(url.trim() ? { url: url.trim() } : {}),
      });
      setText('');
      setTitle('');
      setSelected(material.id);
      await refresh(material.id);
    } catch (error) {
      setError(error.message);
    }
  }
  async function importFile(event) {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 1000000) throw new Error('文本文件过大，请分段导入');
      setText(await file.text());
      setTitle(file.name);
      setMode('text');
    } catch (error) {
      setError(error.message);
    }
    event.target.value = '';
  }
  const material = detail?.material,
    report = detail?.report,
    value = report?.value;
  return (
    <section className="sb-module-page">
      <header className="sb-module-header">
        <h1>材料预览</h1>
        <p>读取正文或字幕后，对照已有笔记，找出新内容和重点阅读位置。</p>
      </header>
      <ErrorNotice error={error} />
      <div className="sb-module-tabs">
        <button aria-pressed={mode === 'url'} onClick={() => setMode('url')}>
          读取网址
        </button>
        <button aria-pressed={mode === 'text'} onClick={() => setMode('text')}>
          粘贴正文 / 字幕
        </button>
        <label className="sb-button">
          导入 TXT / SRT / VTT
          <input type="file" accept=".txt,.srt,.vtt" onChange={importFile} hidden />
        </label>
      </div>
      <div className="sb-module-form">
        {mode === 'url' ? (
          <>
            <label>
              文章网址
              <input
                aria-label="材料网址"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…"
              />
            </label>
            <Action
              disabled={!url.trim() || task.busy}
              onClick={() => task.start({ action: 'materials.fetch', url })}
            >
              读取正文
            </Action>
            <p className="sb-muted">
              需要登录的文章可从 Chrome 扩展导入；视频可导入网页中可读取的字幕或字幕文件。
            </p>
          </>
        ) : (
          <>
            <label>
              材料名称
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="给材料起个名字"
              />
            </label>
            <label>
              来源链接（可选）
              <input
                aria-label="字幕或正文来源链接"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="可填原文章或视频网址，便于回到原位置"
              />
            </label>
            <label>
              正文或字幕
              <textarea
                aria-label="材料正文或字幕"
                rows={7}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <Action disabled={!text.trim() || task.busy} onClick={capture}>
              导入材料
            </Action>
          </>
        )}
      </div>
      <TaskProgress controller={task} />
      {materials.length > 0 && (
        <label className="sb-module-history">
          已导入材料
          <select
            aria-label="已导入材料"
            value={selected}
            onChange={(event) => {
              setSourceReportId('');
              setSelected(event.target.value);
              setDetail(null);
            }}
          >
            <option value="">选择材料</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {material && (
        <>
          <div className="sb-module-titleline">
            <div>
              <h2>{material.title}</h2>
              <p>
                {material.blocks.length} 段内容 · 预计阅读 {material.estimatedMinutes} 分钟
                {material.completeness === 'partial' ? ' · 当前为部分内容' : ''}
              </p>
            </div>
            {material.url && (
              <a className="sb-button" href={material.url} target="_blank" rel="noreferrer">
                打开原网页 ↗
              </a>
            )}
          </div>
          <ModelPicker feature="preview" />
          <Action
            primary
            disabled={task.busy}
            onClick={() => task.start({ action: 'materials.preview', id: material.id })}
          >
            生成材料预览
          </Action>
          <ReportStatus report={report} />
          {detail.sourceVersion && (
            <p className="sb-notice">
              当前显示所引用的预览版本。<Action onClick={() => setSourceReportId('')}>查看最新预览</Action>
            </p>
          )}
          {value && (
            <section className="sb-module-report">
              <h2>{value.question}</h2>
              <Claim value={value.overview} />
              {value.newPoints.length > 0 && (
                <section>
                  <h2>值得关注的新增内容</h2>
                  {value.newPoints.map((claim, index) => (
                    <Claim key={index} value={claim} />
                  ))}
                </section>
              )}
              {value.alreadyRecorded.length > 0 && (
                <section>
                  <h2>笔记中已有记录</h2>
                  {value.alreadyRecorded.map((claim, index) => (
                    <Claim key={index} value={claim} />
                  ))}
                </section>
              )}
              {value.differences.length > 0 && (
                <section>
                  <h2>需要对照的差异</h2>
                  {value.differences.map((claim, index) => (
                    <Claim key={index} value={claim} />
                  ))}
                </section>
              )}
              {value.readingPlan.length > 0 && (
                <section>
                  <h2>建议细读的位置</h2>
                  {value.readingPlan.map((step, index) => (
                    <article key={index}>
                      <h3>{step.title}</h3>
                      <p>{step.reason}</p>
                      <Evidence sources={step.sources} />
                      <Action
                        onClick={() => {
                          const blockId = step.sources[0]?.locator.blockId;
                          const target = [...reader.current.querySelectorAll('[data-material-block]')].find(
                            (node) => node.dataset.materialBlock === blockId,
                          );
                          target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }}
                      >
                        查看这一段
                      </Action>
                    </article>
                  ))}
                </section>
              )}
              {value.limitations && <p className="sb-module-muted">{value.limitations}</p>}
            </section>
          )}
          <section className="sb-material-reader" ref={reader}>
            <h2>材料原文</h2>
            {material.blocks.map((block) => (
              <article
                key={block.id}
                data-material-block={block.id}
                className={context.blockId === block.id ? 'is-target' : ''}
              >
                <div>
                  {block.seconds != null && material.url ? (
                    <a
                      href={timestampUrl(material.url || '', block.seconds)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {time(block.seconds)} ↗
                    </a>
                  ) : (
                    <small>
                      {block.seconds != null
                        ? time(block.seconds)
                        : block.page
                          ? '第 ' + block.page + ' 页'
                          : '段落 ' + (block.position + 1)}
                    </small>
                  )}
                </div>
                <p>{block.text}</p>
              </article>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
