import { createHash } from 'node:crypto';
import { legacyStudy } from './study-schema.js';
import { graphSummaries, summaryScopeKey } from './summary-selection.js';
import { originalSummaryElements } from './summary-sources.js';
export const graphHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 20);
export const quoteText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '');
export function buildGraphInput(boards, { includeHistory = false } = {}) {
  const sources = [],
    topics = [];
  let hiddenHistory = 0,
    totalSources = 0,
    chars = 0;
  for (const b of [...boards]
    .filter((b) => !b.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const summaries = graphSummaries(b, includeHistory);
    hiddenHistory += b.summaries.filter((s) => !s.deletedAt).length - summaries.length;
    const groups = new Map();
    for (const s of summaries) {
      const key = summaryScopeKey(s, b.summaries),
        list = groups.get(key) || [];
      list.push(s);
      groups.set(key, list);
    }
    const localTopics = [];
    for (const [key, list] of groups) {
      const main = list.filter((s) => s.kind !== 'expand').at(-1) || list.at(-1),
        study = legacyStudy(main),
        topic = {
          id: 't-' + graphHash(b.id + '/' + key),
          boardId: b.id,
          boardTitle: b.title,
          summaryId: main.id,
          title: study.title,
          overview: study.overview,
          summaryIds: list.map((s) => s.id),
        };
      topics.push(topic);
      localTopics.push({ ...topic, scopeKey: key });
    }
    const add = (value) => {
      totalSources++;
      const text = String(value.text || '')
        .trim()
        .slice(0, 2200);
      if (!text || sources.length >= 180 || chars + text.length > 90000) return;
      chars += text.length;
      sources.push({ ...value, text, textHash: graphHash(text) });
    };
    for (const s of summaries) {
      const study = legacyStudy(s),
        topic = localTopics.find((t) => t.summaryIds.includes(s.id)),
        base = {
          boardId: b.id,
          boardTitle: b.title,
          url: b.source?.url || null,
          materialTitle: b.source?.title || null,
          summaryId: s.id,
          summaryTitle: study.title || b.title,
          summaryModel: s.model || null,
          summaryProvider: s.provider || null,
          elementId: null,
          kind: 'summary',
          topicIds: topic ? [topic.id] : [],
          createdAt: s.createdAt,
        };
      if (study.overview)
        add({
          ...base,
          id: b.id + '/' + s.id + '/overview',
          conceptId: null,
          title: study.title,
          text: study.overview,
        });
      for (const c of study.concepts)
        add({
          ...base,
          id: b.id + '/' + s.id + '/' + c.id,
          conceptId: c.id,
          title: c.title,
          text: c.explanation,
        });
    }
    if (localTopics.length)
      for (const e of originalSummaryElements(b.scene.elements, b.summaries).filter(
        (e) => e.type === 'text',
      )) {
        const topicIds = localTopics
          .filter(
            (t) =>
              t.scopeKey === 'board' ||
              summaries.some((s) => t.summaryIds.includes(s.id) && s.elementIds?.includes(e.id)),
          )
          .map((t) => t.id);
        if (topicIds.length)
          add({
            id: b.id + '/canvas/' + e.id,
            boardId: b.id,
            boardTitle: b.title,
            url: b.source?.url || null,
            materialTitle: b.source?.title || null,
            summaryId: null,
            conceptId: null,
            elementId: e.id,
            kind: 'canvas',
            topicIds,
            title: '画布笔记',
            text: e.text,
          });
      }
  }
  const included = new Set(sources.flatMap((s) => s.topicIds)),
    visibleTopics = topics.filter((t) => included.has(t.id)),
    fingerprint = graphHash(JSON.stringify(sources.map((s) => [s.id, s.textHash, s.topicIds])));
  return {
    fingerprint,
    topics: visibleTopics,
    sources,
    coverage: {
      notes: new Set(sources.map((s) => s.boardId)).size,
      summaries: new Set(sources.map((s) => s.summaryId).filter(Boolean)).size,
      sourceBlocks: sources.length,
      totalSourceBlocks: totalSources,
      hiddenHistory,
    },
    includeHistory,
  };
}
function reportReferences(report) {
  return [
    ...new Map(
      [
        ...(report?.entities || []).flatMap((entity) => entity.sources || []),
        ...(report?.triples || []).flatMap((triple) => triple.evidence || []),
        ...(report?.maps || []).flatMap((map) =>
          [map.takeaway, ...(map.branches || []).map((branch) => branch.summary)].flatMap(
            (claim) => claim?.evidence || [],
          ),
        ),
      ].map((source) => [source.id, source]),
    ).values(),
  ];
}

/** Validate the saved graph against the versions it cited, independently of the next generation's scope. */
export function graphReferenceSources(boards, report) {
  const available = new Map(boards.filter((board) => !board.deletedAt).map((board) => [board.id, board])),
    caches = new Map(),
    result = [];
  for (const reference of reportReferences(report)) {
    const board = available.get(reference.boardId);
    if (!board) continue;
    if (!caches.has(board.id))
      caches.set(board.id, {
        summaries: new Map(
          board.summaries.filter((summary) => !summary.deletedAt).map((summary) => [summary.id, summary]),
        ),
        current: new Set(graphSummaries(board).map((summary) => summary.id)),
        text: new Map(
          originalSummaryElements(board.scene.elements, board.summaries)
            .filter((element) => element.type === 'text')
            .map((element) => [element.id, element]),
        ),
        studies: new Map(),
      });
    const cache = caches.get(board.id),
      { quote: _quote, ...source } = reference;
    let text, extra;
    if (reference.summaryId) {
      const summary = cache.summaries.get(reference.summaryId);
      if (!summary) continue;
      if (!cache.studies.has(summary.id)) cache.studies.set(summary.id, legacyStudy(summary));
      const study = cache.studies.get(summary.id),
        concept = reference.conceptId ? study.concepts.find((item) => item.id === reference.conceptId) : null;
      text = reference.conceptId
        ? concept?.explanation
        : reference.id === board.id + '/' + summary.id + '/overview'
          ? study.overview
          : null;
      extra = {
        kind: 'summary',
        title: concept?.title || study.title,
        summaryTitle: study.title,
        summaryModel: summary.model || null,
        summaryProvider: summary.provider || null,
        createdAt: summary.createdAt || null,
        superseded: !cache.current.has(summary.id),
      };
    } else {
      const elementId = reference.elementId || reference.id.split('/canvas/')[1],
        element = cache.text.get(elementId);
      text = element?.text;
      extra = { kind: 'canvas', title: '画布笔记', elementId: elementId || null, superseded: false };
    }
    if (typeof text !== 'string' || !text.trim()) continue;
    text = text.trim().slice(0, 2200);
    result.push({
      ...source,
      ...extra,
      text,
      textHash: graphHash(text),
      topicIds: source.topicIds || [],
      boardTitle: board.title,
      url: board.source?.url || null,
      materialTitle: board.source?.title || null,
    });
  }
  return result;
}

export function currentGraph(report, input, links = [], referenceSources = input.sources) {
  const live = new Map(referenceSources.map((s) => [s.id, s])),
    valid = (s) => live.get(s.id)?.textHash === s.textHash,
    refreshSource = (s) => ({ ...s, ...live.get(s.id) });
  if (![2, 3].includes(report?.schemaVersion))
    return { nodes: [], edges: [], topics: input.topics, needsExtraction: true };
  const nodes = report.entities
      .map((e) => ({ ...e, sources: e.sources.filter(valid).map(refreshSource) }))
      .filter((e) => e.sources.length)
      .map((e) => ({
        ...e,
        title: e.name,
        key: e.name,
        topicIds: [...new Set(e.sources.flatMap((s) => live.get(s.id).topicIds))],
      })),
    ids = new Set(nodes.map((n) => n.id));
  const edges = report.triples
    .filter((t) => ids.has(t.from) && ids.has(t.to) && t.evidence.length && t.evidence.every(valid))
    .map((t) => ({
      ...t,
      evidence: t.evidence.map(refreshSource),
      sources: [{ kind: 'ai', reportId: report.id, explanation: t.explanation, inferred: t.inferred }],
    }));
  for (const link of links)
    if (ids.has(link.from) && ids.has(link.to))
      edges.push({
        ...link,
        predicate: link.label,
        evidence: [],
        inferred: false,
        sources: [{ kind: 'manual', id: link.id }],
      });
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const liveGroups = (groups, members) =>
    (groups || [])
      .map((group) => ({ ...group, entityIds: group.entityIds.filter((id) => members.has(id)) }))
      .filter((group) => group.entityIds.length);
  const liveClaim = (claim) =>
    claim?.evidence?.length && claim.evidence.every(valid)
      ? { ...claim, evidence: claim.evidence.map(refreshSource) }
      : null;
  const maps = (report.maps || [])
    .map((map) => {
      const coreTripleIds = map.coreTripleIds.filter((id) => edgeIds.has(id));
      const connected = new Set(
        edges.filter((edge) => coreTripleIds.includes(edge.id)).flatMap((edge) => [edge.from, edge.to]),
      );
      const coreEntityIds = map.coreEntityIds.filter((id) => connected.has(id));
      const branches = map.branches
        .map((branch) => {
          const tripleIds = branch.tripleIds.filter((id) => edgeIds.has(id));
          const members = new Set(
            edges.filter((edge) => tripleIds.includes(edge.id)).flatMap((edge) => [edge.from, edge.to]),
          );
          return {
            ...branch,
            tripleIds,
            summary: liveClaim(branch.summary),
            groups: liveGroups(branch.groups, members),
          };
        })
        .filter((branch) => branch.tripleIds.length);
      return {
        ...map,
        coreEntityIds,
        coreTripleIds,
        branches,
        takeaway: liveClaim(map.takeaway),
        groups: liveGroups(map.groups, connected),
        stale: coreTripleIds.length !== map.coreTripleIds.length || !liveClaim(map.takeaway),
      };
    })
    .filter((map) => map.coreTripleIds.length);
  return {
    nodes,
    edges,
    topics: input.topics,
    maps,
    needsCuration: report.schemaVersion !== 3 || !maps.length,
    needsExtraction: false,
    supersededSummaryCount: new Set(
      reportReferences(report)
        .filter((source) => valid(source) && live.get(source.id)?.superseded)
        .map((source) => source.summaryId),
    ).size,
    invalidSourceCount: reportReferences(report).filter((source) => !valid(source)).length,
  };
}
