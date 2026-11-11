export function sourceImageCatalog(elements) {
  const texts = elements.filter((e) => !e.isDeleted && e.type === 'text');
  return elements
    .filter((e) => !e.isDeleted && e.type === 'image')
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
    .map((image, i) => ({
      id: 'S' + String(i + 1).padStart(2, '0'),
      elementId: image.id,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      note: image.customData?.studyboard?.imageNote || '',
      ...(image.customData?.studyboard?.pdfSource
        ? { pdfSource: image.customData.studyboard.pdfSource }
        : {}),
      nearbyText: texts
        .filter((t) => Math.abs(t.y - image.y) < 250 && Math.abs(t.x - image.x) < Math.max(500, image.width))
        .map((t) => t.text)
        .join(' / ')
        .slice(0, 700),
    }));
}
export function originalSummaryElements(elements, summaries = []) {
  const normalized = (text) =>
    String(text || '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\s/g, '');
  const generated = new Set(summaries.map((s) => normalized(s.text)).filter(Boolean));
  const excluded = new Set(
    elements
      .filter(
        (e) =>
          e.customData?.studyboard?.summaryId ||
          (e.type === 'text' && generated.has(normalized(e.originalText || e.text))),
      )
      .flatMap((e) => [e.id, e.containerId].filter(Boolean)),
  );
  return elements.filter(
    (e) =>
      !e.isDeleted &&
      !excluded.has(e.id) &&
      !excluded.has(e.containerId) &&
      e.customData?.studyboard?.role !== 'pdf-source',
  );
}
export function sourceAssets(study, board, elements) {
  const catalog = new Map(sourceImageCatalog(elements).map((x) => [x.id, x])),
    byId = new Map(board.scene.elements.map((e) => [e.id, e])),
    assets = {};
  const imageRefs = [
    ...new Set(
      (study.infographics || [])
        .flatMap((f) => [
          ...(f.sourceIds || []),
          ...f.nodes.flatMap((n) => [...n.sourceIds, n.imageSourceId].filter(Boolean)),
          ...f.edges.flatMap((e) => e.sourceIds),
        ])
        .filter((id) => catalog.has(id)),
    ),
  ];
  for (const figure of [...(study.sourceFigures || []), ...imageRefs.map((sourceId) => ({ sourceId }))]) {
    const source = catalog.get(figure.sourceId),
      image = source && byId.get(source.elementId),
      file = image && board.scene.files[image.fileId];
    if (!file?.dataURL || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(file.dataURL))
      throw new Error('模型引用了不存在或不支持的原图：' + figure.sourceId);
    assets[figure.sourceId] = {
      elementId: image.id,
      ...(image.customData?.studyboard?.pdfSource
        ? { pdfSource: image.customData.studyboard.pdfSource }
        : {}),
      dataURL: file.dataURL,
      width: image.width,
      height: image.height,
      crop: image.crop || null,
      scale: image.scale || [1, 1],
      angle: image.angle || 0,
    };
  }
  return assets;
}
