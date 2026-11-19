import React, { useState, useSyncExternalStore } from 'react';
import { canvasQuotes } from '../shared/canvas-quotes.js';

function useQuotes(api) {
  const elements = useSyncExternalStore(api.onChange, api.getSceneElements);
  return canvasQuotes(elements);
}

export function QuotePracticeEntry({ api, selectedId, onStart }) {
  const quotes = useQuotes(api);
  if (!quotes.length) return null;
  return (
    <button onClick={() => onStart(quotes.find((quote) => quote.id === selectedId)?.id || quotes[0].id)}>
      <strong>背诵摘录</strong>
      <span>复习这张画布上的 {quotes.length} 条原文</span>
    </button>
  );
}

export default function QuotePractice({ api, startId, onClose }) {
  const cards = useQuotes(api);
  const [currentId, setCurrentId] = useState(startId);
  const [shown, setShown] = useState(null);
  const index = Math.max(
    0,
    cards.findIndex((card) => card.id === currentId),
  );
  const card = cards[index];
  if (!card) return <p>这张画布还没有金句摘录。</p>;

  const { text, source } = card;
  const revealed = shown?.id === card.id && shown.text === text;
  function goTo(next) {
    setShown(null);
    setCurrentId(cards[next].id);
  }

  return (
    <>
      <div className="study-quote-position" aria-live="polite">
        第 {index + 1} 条，共 {cards.length} 条
      </div>
      {source && (
        <p className="study-quote-source" dir="auto">
          {source}
        </p>
      )}
      <div className="study-quote-passage" aria-live="polite">
        {revealed ? <blockquote dir="auto">{text}</blockquote> : <p>试着背出这段原文。</p>}
      </div>
      <footer>
        {cards.length > 1 && (
          <button disabled={index === 0} onClick={() => goTo(index - 1)}>
            上一条
          </button>
        )}
        <button
          autoFocus
          className="study-widget-submit"
          aria-expanded={revealed}
          onClick={() => setShown(revealed ? null : { id: card.id, text })}
        >
          {revealed ? '遮住原文' : '显示原文'}
        </button>
        {index < cards.length - 1 ? (
          <button onClick={() => goTo(index + 1)}>下一条</button>
        ) : (
          <button onClick={onClose}>结束背诵</button>
        )}
      </footer>
    </>
  );
}
