/** Keep weekly review cards tied to original material, avoiding recursive weekly-report chains. */
export function weeklyReviewReferences(report, learning) {
  const references = [];
  const add = (value) => {
    const sourceId = value.sourceId || (value.kind ? value.id : null);
    const anchor = sourceId ? { sourceId } : {};
    if (value.weeklyReportId) references.push({ weeklyReportId: value.weeklyReportId });
    else if (value.reportId) references.push({ reportId: value.reportId, ...anchor });
    else if (value.materialId) references.push({ materialId: value.materialId, ...anchor });
    else if (value.boardId)
      references.push({
        boardId: value.boardId,
        ...(value.summaryId ? { summaryId: value.summaryId } : {}),
        ...anchor,
      });
  };
  for (const source of report.sources.filter((source) => source.kind !== 'review')) add(source);
  const reviews = new Set(report.scope.reviewIds || []);
  for (const event of learning.data.reviews) {
    if (!reviews.has(event.eventId)) continue;
    const card = learning.data.cards[event.cardId];
    if (!card) continue;
    if (card.origin?.feature === 'weekly') {
      add({ weeklyReportId: card.origin.id });
      (card.sourceRefs || []).forEach(add);
    } else if (card.origin) add({ reportId: card.origin.id });
    else add({ boardId: card.boardId, summaryId: card.summaryId });
  }
  return [...new Map(references.map((ref) => [JSON.stringify(ref), ref])).values()];
}

export async function weeklyCardAvailable(card, { reports, sources, store, learning }) {
  const report = await reports.repository.get(card.origin.id, { optional: true });
  if (
    !report ||
    report.feature !== 'weekly' ||
    report.deletedAt ||
    !report.value.reviewQuestions?.[card.origin.questionIndex]
  )
    return false;
  if (!card.sourceRefs?.length) return false;
  for (const ref of card.sourceRefs) {
    if (ref.weeklyReportId) {
      const ancestor = await reports.repository.get(ref.weeklyReportId, { optional: true });
      if (!ancestor || ancestor.deletedAt) return false;
    } else if (ref.reportId) {
      const original = await reports.repository.get(ref.reportId, { optional: true });
      if (!original || original.feature === 'weekly' || (await reports.get(ref.reportId)).unavailable)
        return false;
      if (
        ref.sourceId &&
        !(await sources.reportRecords(ref.reportId)).some((source) => source.id === ref.sourceId)
      )
        return false;
    } else if (ref.materialId) {
      const records = await sources.materialRecords(ref.materialId);
      if (!records.length || (ref.sourceId && !records.some((source) => source.id === ref.sourceId)))
        return false;
    } else if (ref.summaryId) await learning.source(ref.boardId, ref.summaryId);
    else if ((await store.read(ref.boardId)).deletedAt) return false;
    if (
      ref.boardId &&
      ref.sourceId &&
      !(await sources.noteRecords(ref.boardId, { allSummaries: true })).some(
        (source) => source.id === ref.sourceId,
      )
    )
      return false;
  }
  return true;
}
