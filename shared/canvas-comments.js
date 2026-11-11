// Shared by the editor and server. Layout movement does not change a comment's source.
export function commentSelection(elements, ids) {
  const wanted = new Set(ids),
    live = elements.filter((e) => !e.isDeleted);
  let size = -1;
  while (size !== wanted.size) {
    size = wanted.size;
    for (const e of live)
      if (wanted.has(e.id)) {
        for (const bound of e.boundElements || []) if (bound.type === 'text') wanted.add(bound.id);
        if (e.type === 'frame') for (const child of live) if (child.frameId === e.id) wanted.add(child.id);
      }
  }
  return live.filter((e) => wanted.has(e.id));
}
export function commentSourceContent(elements, files = {}) {
  return JSON.stringify(
    [...elements]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({
        id: e.id,
        type: e.type,
        text: e.originalText || e.text || '',
        points: e.points || null,
        angle: e.angle || 0,
        crop: e.crop || null,
        scale: e.scale || null,
        startBinding: e.startBinding?.elementId || null,
        endBinding: e.endBinding?.elementId || null,
        file: e.fileId ? files[e.fileId]?.dataURL || '' : '',
      })),
  );
}
export const commentCanvasKey = (canvas) =>
  JSON.stringify([canvas.kind || 'note', canvas.id || '', canvas.summaryId || '']);

export function visibleCommentMessages(messages = []) {
  const answered = new Set(messages.filter((m) => m.role === 'assistant').map((m) => m.replyTo)),
    questions = new Map(messages.filter((m) => m.role === 'question').map((m) => [m.id, m]));
  return messages.filter((m, index) => {
    if (m.role !== 'question' || !['error', 'cancelled', 'interrupted'].includes(m.task?.status)) return true;
    return !messages.slice(index + 1).some((next) => {
      if (next.role !== 'question' || !answered.has(next.id)) return false;
      let parent = next.retryOf;
      const seen = new Set();
      while (parent && !seen.has(parent)) {
        if (parent === m.id) return true;
        seen.add(parent);
        parent = questions.get(parent)?.retryOf;
      }
      // Older clients did not record retryOf. Match both the question and its source.
      return !next.retryOf && next.body === m.body && next.sourceHash === m.sourceHash;
    });
  });
}
