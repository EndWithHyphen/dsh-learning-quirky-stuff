import { elementPdfReference } from '../shared/pdf.js';
import { sourceImageCatalog } from '../summary-sources.js';

/** Snapshot source identities, so a later canvas edit cannot silently change a figure's evidence. */
export function visualSourceSnapshot(board, elements, scope = 'board') {
  const images = sourceImageCatalog(elements).map((image) => ({
    id: image.id,
    kind: 'image',
    title: image.note || '画布原图 ' + image.id,
    elementId: image.elementId,
    text: image.note || image.nearbyText || '',
    revision: board.revision,
    ...(image.pdfSource ? { pdfSource: image.pdfSource } : {}),
  }));
  const texts = elements
    .filter((e) => e.type === 'text' && !e.isDeleted)
    .slice(0, 120)
    .map((e, i) => ({
      id: `T${String(i + 1).padStart(2, '0')}`,
      kind: 'text',
      title: '画布文字',
      elementId: e.id,
      ...(e.customData?.studyboard?.pdfSource ? { pdfSource: elementPdfReference(e) } : {}),
      text: String(e.text || '').slice(0, 6000),
      revision: board.revision,
    }));
  if (scope !== 'selection' && board.webNotes?.text?.trim())
    texts.unshift({
      id: 'W01',
      kind: 'text',
      title: '网页随手记',
      text: board.webNotes.text.slice(0, 30000),
      revision: board.webNotes.version,
    });
  let budget = 38000;
  return [...images, ...texts].flatMap((source) => {
    if (budget <= 0) return [];
    const clean = { ...source, text: source.text.slice(0, Math.max(0, budget - 300)) };
    budget -= JSON.stringify(clean).length;
    return [clean];
  });
}

export function infographicSourceIds(figures) {
  return [
    ...new Set(
      (figures || []).flatMap((f) => [
        ...(f.sourceIds || []),
        ...f.nodes.flatMap((n) => [...n.sourceIds, n.imageSourceId].filter(Boolean)),
        ...f.edges.flatMap((e) => e.sourceIds),
      ]),
    ),
  ];
}

export function manualVisualSources(summary) {
  const study = summary.study;
  const original =
    summary.visualSources ||
    Object.keys(summary.assets || {}).map((id) => ({
      id,
      kind: 'image',
      title: '总结保存的原图 ' + id,
      text: '',
      elementId: summary.assets[id].elementId,
    }));
  return [
    ...original,
    {
      id: 'A-overview',
      kind: 'summary',
      title: '本次 AI 总结概览',
      text: study?.overview || summary.text || '',
    },
    ...(study?.concepts || []).map((c) => ({
      id: 'A-' + c.id,
      kind: 'summary',
      title: c.title,
      text: c.explanation + (c.example ? '\n' + c.example : ''),
    })),
  ];
}
