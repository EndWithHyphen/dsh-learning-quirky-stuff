import React from 'react';
import guide from './generated/user-guide.js';
import { download } from './export.js';

const embeddedGuide = guide.replace('<head>', '<head><base href="about:srcdoc">');
export default function HelpView() {
  return (
    <section className="sb-guide-page" aria-label="学习画板使用说明">
      <div className="sb-guide-actions">
        <span>点击目录查找功能；也可下载到本机，随时阅读。</span>
        <button
          className="sb-button"
          onClick={() =>
            download(new Blob([guide], { type: 'text/html;charset=utf-8' }), '学习画板使用说明.html')
          }
        >
          下载离线说明
        </button>
      </div>
      <iframe title="学习画板使用说明" sandbox="" srcDoc={embeddedGuide} />
    </section>
  );
}
