export function highlightText(container, quote) {
  if (!container) return;
  for (let parent = container; parent; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') parent.open = true;
  container.classList.add('sb-source-target');
  container.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const text = String(quote || '').trim();
  if (text && typeof Highlight !== 'undefined' && globalThis.CSS?.highlights) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT),
      nodes = [];
    let node,
      full = '';
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: full.length });
      full += node.textContent;
    }
    const start = full.indexOf(text),
      end = start + text.length;
    if (start >= 0) {
      const a = nodes.findLast((item) => item.start <= start),
        b = nodes.findLast((item) => item.start < end);
      if (a && b) {
        for (let parent = a.node.parentElement; parent; parent = parent.parentElement)
          if (parent.tagName === 'DETAILS') parent.open = true;
        const range = document.createRange();
        range.setStart(a.node, start - a.start);
        range.setEnd(b.node, end - b.start);
        globalThis.CSS.highlights.set('studyboard-source', new Highlight(range));
        a.node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }
  setTimeout(() => {
    container.classList.remove('sb-source-target');
    globalThis.CSS?.highlights?.delete('studyboard-source');
  }, 5000);
}
