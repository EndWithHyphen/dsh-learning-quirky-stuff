import React from 'react';
import { graphSourceKind, graphSourceDate, graphSourceUrl } from './graph-provenance.js';
export default function GraphSourceCard({ source, onSource, quote = true }) {
  const kind = graphSourceKind(source),
    url = graphSourceUrl(source),
    date = graphSourceDate(source);
  return (
    <section className="sb-spo-evidence sb-graph-source-card">
      <div className="sb-graph-source-type">
        引用层级：{kind}
        {date ? ' · ' + date : ''}
      </div>
      <h4>{source.boardTitle || '未命名笔记'}</h4>
      {kind === 'AI 总结' && (
        <p>
          总结：{source.summaryTitle || source.title}
          {source.title && source.title !== source.summaryTitle ? ' · ' + source.title : ''}
          {source.summaryModel ? ' · ' + source.summaryModel : ''}
        </p>
      )}
      {source.superseded && (
        <p className="sb-graph-version-note">这篇笔记已有新版总结；此处保留图谱生成时引用的旧版本。</p>
      )}
      {quote && (
        <>
          <div className="sb-graph-quote-label">{kind}中的引用片段</div>
          <blockquote>{source.quote || source.text}</blockquote>
        </>
      )}
      <div className="sb-graph-source-actions">
        <button onClick={() => onSource(source)}>
          {kind === 'AI 总结' ? '定位到这版总结' : '定位到画布文字'} ↗
        </button>
        {url && (
          <a href={url} target="_blank" rel="noreferrer noopener">
            打开来源网页 ↗
          </a>
        )}
      </div>
      {url ? (
        <small className="sb-graph-material-origin">
          关联材料：{source.materialTitle || source.boardTitle} · {new URL(url).hostname}
        </small>
      ) : (
        <small>这篇笔记没有关联网页链接。</small>
      )}
    </section>
  );
}
