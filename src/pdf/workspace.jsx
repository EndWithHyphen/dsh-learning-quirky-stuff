import React, { useEffect, useImperativeHandle, useRef, useState, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { PDF_MAX_BYTES } from '../../shared/pdf.js';
import css from './pdf.css';
const Reader = React.lazy(() => import('./reader.jsx'));
class PdfBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="sb-pdf-error" role="alert">
        PDF 阅读组件未能完成显示：{this.state.error.message}
        <button onClick={() => this.setState({ error: null })}>重新打开</button>
        <button onClick={this.props.onClose}>收起 PDF</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
const PdfWorkspace = React.forwardRef(function PdfWorkspace(
  { noteId, execute, onExtract, onMeta, onVisibility, onBusy, initialFile, initialFocus, onError },
  ref,
) {
  const [data, setData] = useState({ documents: [], notebook: { annotations: [], positions: {} } }),
    [active, setActive] = useState(''),
    [focus, setFocus] = useState(null),
    [manager, setManager] = useState(false),
    [catalog, setCatalog] = useState([]),
    [error, setError] = useState(''),
    [upload, setUpload] = useState(null),
    [progress, setProgress] = useState(''),
    [busy, setBusy] = useState(false);
  const reader = useRef(),
    fileInput = useRef(),
    services = useRef(),
    alive = useRef(true),
    cancelled = useRef(false),
    flight = useRef(),
    started = useRef(false),
    dataRef = useRef(data);
  services.current = { execute, onMeta, onError };
  dataRef.current = data;
  const call = (request) => services.current.execute({ ...request, noteId });
  async function reload() {
    const next = await call({ action: 'pdf.list' });
    if (alive.current) setData(next);
    return next;
  }
  async function manage() {
    setManager(true);
    setError('');
    try {
      await reload();
      const choices = await call({ action: 'pdf.catalog' });
      if (alive.current) setCatalog(choices);
    } catch (e) {
      setError(e.message);
    }
  }
  async function open(reference) {
    await reader.current?.flush();
    let next = await reload();
    if (!next.documents.some((d) => d.id === reference.documentId)) {
      await call({ action: 'pdf.link', documentId: reference.documentId });
      next = await reload();
      onMeta?.();
    }
    setFocus({ ...reference, token: Date.now() });
    setActive(reference.documentId);
    setManager(false);
  }
  async function importFile(file, retry = false) {
    if (!file) return;
    if (file.size > PDF_MAX_BYTES) {
      setManager(true);
      setError('PDF 最大支持 128 MB');
      return;
    }
    const current = retry && upload?.file === file ? upload : { file, requestId: crypto.randomUUID() };
    setManager(true);
    setUpload(current);
    setBusy(true);
    onBusy?.(true);
    setError('');
    cancelled.current = false;
    const work = (async () => {
      const transfer = await call({
          action: 'pdf.beginUpload',
          name: file.name,
          size: file.size,
          requestId: current.requestId,
        }),
        count = Math.ceil(file.size / transfer.chunkSize);
      for (let index = 0; index < count; index++) {
        if (cancelled.current) throw new Error('导入已取消');
        if (!transfer.received.includes(index))
          await call({
            action: 'pdf.uploadChunk',
            uploadId: transfer.id,
            index,
            data: base64(
              await file.slice(index * transfer.chunkSize, (index + 1) * transfer.chunkSize).arrayBuffer(),
            ),
          });
        if (alive.current) setProgress(`正在导入 PDF · ${Math.round(((index + 1) / count) * 100)}%`);
      }
      if (cancelled.current) throw new Error('导入已取消');
      const document = await call({ action: 'pdf.finishUpload', uploadId: transfer.id });
      if (!alive.current) return;
      setUpload(null);
      setProgress('');
      await reload();
      onMeta?.();
      setActive(document.id);
      setFocus({ page: 1, token: Date.now() });
      setManager(false);
    })()
      .catch(async (e) => {
        if (cancelled.current)
          await call({ action: 'pdf.cancelUpload', uploadId: current.requestId }).catch(() => {});
        if (alive.current) setError(e.message);
        throw e;
      })
      .finally(() => {
        flight.current = null;
        if (alive.current) {
          setBusy(false);
          onBusy?.(false);
        }
      });
    flight.current = work;
    return work;
  }
  useImperativeHandle(ref, () => ({
    manage,
    open,
    flush: async () => {
      await flight.current;
      await reader.current?.flush();
    },
  }));
  useEffect(() => {
    alive.current = true;
    reload()
      .then((next) => {
        if (!alive.current) return;
        if (initialFile && !started.current) {
          started.current = true;
          importFile(initialFile).catch(() => {});
        } else if (initialFocus?.documentId)
          open(initialFocus).catch((e) => {
            setError(e.message);
            setManager(true);
          });
        else if (next.documents.length) {
          setActive(next.documents[0].id);
        }
      })
      .catch((e) => {
        setError(e.message);
        services.current.onError?.(e);
      });
    return () => {
      alive.current = false;
      cancelled.current = true;
    };
  }, [noteId]);
  useEffect(() => {
    onVisibility?.(!!active);
    return () => onVisibility?.(false);
  }, [!!active]);
  useEffect(() => {
    if (initialFocus?.documentId)
      open(initialFocus).catch((e) => {
        setError(e.message);
        setManager(true);
      });
  }, [initialFocus?.token]);
  const activeDocument = data.documents.find((d) => d.id === active);
  return (
    <>
      <style>{css}</style>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="导入笔记 PDF"
        hidden
        onChange={(e) => {
          const file = e.target.files[0];
          e.target.value = '';
          importFile(file).catch(() => {});
        }}
      />
      {active && activeDocument && (
        <div className="sb-pdf-workspace">
          <Suspense fallback={<div className="sb-pdf-loading">正在准备 PDF 阅读器…</div>}>
            <PdfBoundary onClose={() => setActive('')}>
              <Reader
                key={noteId + active}
                ref={reader}
                noteId={noteId}
                document={activeDocument}
                notebook={data.notebook}
                execute={execute}
                onExtract={onExtract}
                onManage={manage}
                onClose={() => setActive('')}
                focus={focus}
                onBusy={onBusy}
                onMeta={() => {
                  reload().catch(() => {});
                  onMeta?.();
                }}
              />
            </PdfBoundary>
          </Suspense>
        </div>
      )}
      {manager &&
        createPortal(
          <div className="sb-pdf-manager-mask">
            <section className="sb-pdf-manager" role="dialog" aria-modal="true" aria-label="笔记中的 PDF">
              <header>
                <h2>笔记中的 PDF</h2>
                <button aria-label="关闭 PDF 管理" disabled={busy} onClick={() => setManager(false)}>
                  ×
                </button>
              </header>
              <p>导入 PDF，或关联其他笔记已经使用的文件。原件共用，批注保存在当前笔记。</p>
              <button
                className="sb-button sb-primary"
                disabled={busy}
                onClick={() => fileInput.current.click()}
              >
                从本机导入 PDF
              </button>
              <div
                className="sb-pdf-drop"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy) importFile(e.dataTransfer.files[0]).catch(() => {});
                }}
              >
                也可以将 PDF 文件拖到这里
              </div>
              {busy && (
                <p role="status">
                  {progress || '正在准备导入…'}{' '}
                  <button
                    onClick={() => {
                      cancelled.current = true;
                    }}
                  >
                    取消导入
                  </button>
                </p>
              )}
              {error && (
                <p role="alert" className="sb-pdf-error">
                  {error}
                  {upload && !busy && (
                    <button onClick={() => importFile(upload.file, true).catch(() => {})}>重试导入</button>
                  )}
                </p>
              )}
              <h3>已关联到本篇笔记</h3>
              {!data.documents.length && <p>还没有关联 PDF。</p>}
              {data.documents.map((d) => (
                <div className="sb-pdf-document-row" key={d.id}>
                  <button onClick={() => open({ documentId: d.id }).catch((e) => setError(e.message))}>
                    <strong>{d.name}</strong>
                    <small>
                      {d.pageCount ? d.pageCount + ' 页 · ' : ''}
                      {(d.size / 1024 / 1024).toFixed(1)} MB
                    </small>
                  </button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await reader.current?.flush();
                        await call({ action: 'pdf.unlink', documentId: d.id });
                        if (active === d.id) setActive('');
                        await manage();
                        onMeta?.();
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    移除关联
                  </button>
                </div>
              ))}
              <h3>从已有笔记关联</h3>
              {catalog
                .filter((d) => !data.documents.some((link) => link.id === d.id))
                .map((d) => (
                  <div className="sb-pdf-document-row" key={d.id}>
                    <span>
                      <strong>{d.name}</strong>
                      <small>来自 {d.notes.map((n) => n.title).join('、')}</small>
                    </span>
                    <button
                      disabled={busy}
                      onClick={() => open({ documentId: d.id, page: 1 }).catch((e) => setError(e.message))}
                    >
                      关联并打开
                    </button>
                  </div>
                ))}
              <footer>
                <button disabled={busy} onClick={() => setManager(false)}>
                  完成
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
});
export default PdfWorkspace;
