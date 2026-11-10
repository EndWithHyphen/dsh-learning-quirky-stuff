import React, { useEffect, useRef, useState } from 'react';
export default function SourceFigure({ figure, asset, caption }) {
  const [open, setOpen] = useState(false),
    close = useRef(),
    trigger = useRef();
  useEffect(() => {
    if (open) close.current?.focus({ preventScroll: true });
  }, [open]);
  function dismiss() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  if (!asset) return null;
  return (
    <figure className="sb-source-figure">
      <div className="sb-source-figure-heading">
        <h3>{figure.title}</h3>
        <span>画布原图</span>
      </div>
      <button
        className="sb-source-figure-image"
        ref={trigger}
        onClick={() => setOpen(true)}
        aria-label={'放大原图：' + figure.title}
      >
        <img src={asset.dataURL} alt={figure.title} loading="lazy" />
        <span>点击放大</span>
      </button>
      {caption}
      {open && (
        <div
          className="sb-figure-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) dismiss();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={figure.title}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                dismiss();
              }
              if (e.key === 'Tab') {
                e.preventDefault();
                close.current?.focus();
              }
            }}
          >
            <header>
              <h2>{figure.title}</h2>
              <button ref={close} aria-label="关闭原图" onClick={dismiss}>
                ×
              </button>
            </header>
            <div>
              <img src={asset.dataURL} alt={figure.title} />
            </div>
          </section>
        </div>
      )}
    </figure>
  );
}
