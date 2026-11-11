import { elementPdfReference } from '../shared/pdf.js';
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { legacyStudy } from '../study-schema.js';
import { graphSummaries } from '../summary-selection.js';
import { originalSummaryElements } from '../summary-sources.js';
import { digest, normalized, unique } from './lib/values.js';
import { inkSignature } from '../shared/ink.js';

export function imageFingerprint(element, file) {
  return digest([file?.dataURL || '', element.crop || null]);
}

/** Stable source records are shared by synthesis, search, preview and feedback. */
export class SourceRepository {
  constructor(store, materials, index) {
    this.store = store;
    this.materials = materials;
    this.index = index;
    this.cache = new Map();
    this.recordCache = new Map();
  }
  async note(id) {
    const path = this.store.boardPath(id),
      info = await stat(path),
      signature = info.mtimeMs + ':' + info.size;
    const prior = this.cache.get(id);
    if (prior?.signature === signature) return prior.board;
    const board = await this.store.read(id);
    this.cache.set(id, { signature, board });
    while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    return board;
  }
  async noteIds() {
    return (await readdir(join(this.store.root, 'boards')))
      .filter((name) => name.endsWith('.json') && !this.store.purged.has(name.slice(0, -5)))
      .map((name) => name.slice(0, -5));
  }
  async noteRecords(id, options = {}) {
    const records = await this.baseNoteRecords(id, options);
    return this.pdf ? [...records, ...(await this.pdf.records(id))] : records;
  }
  async baseNoteRecords(id, { allSummaries = false } = {}) {
    const fileInfo = await stat(this.store.boardPath(id)),
      indexInfo = await stat(this.index.path(id)).catch(() => ({ mtimeMs: 0, size: 0 })),
      cacheKey = id + ':' + allSummaries,
      signature = [fileInfo.mtimeMs, fileInfo.size, indexInfo.mtimeMs, indexInfo.size].join(':');
    const cached = this.recordCache.get(cacheKey);
    if (cached?.signature === signature) return structuredClone(cached.records);
    const board = await this.note(id);
    if (board.deletedAt) return [];
    const savedIndex = await this.index.get(id, { optional: true }),
      records = [],
      url = board.source?.url || null;
    const add = (suffix, text, kind, title, locator = {}) => {
      if (!String(text || '').trim()) return;
      records.push({
        id: id + '/' + suffix,
        boardId: id,
        materialId: null,
        summaryId: locator.summaryId || null,
        title,
        boardTitle: board.title,
        kind,
        text: String(text).trim(),
        hash: digest(String(text).trim()),
        url,
        locator: { elementIds: [], blockId: null, seconds: null, ...locator },
      });
    };
    add('meta', [board.title, ...board.tags].join('\n'), 'metadata', board.title);
    add('web-notes', board.webNotes?.text, 'notes', '网页随手记');
    const elements = originalSummaryElements(board.scene.elements, board.summaries);
    for (const element of elements) {
      if (element.type === 'text' && !element.customData?.studyboard?.imageNoteFor)
        add('canvas/' + element.id, element.originalText || element.text, 'canvas', board.title, {
          elementIds: [element.id],
          ...(element.customData?.studyboard?.pdfSource
            ? {
                pdf: elementPdfReference(element),
                page: elementPdfReference(element).page,
              }
            : {}),
        });
      if (element.type === 'image') {
        const shot = (board.webImages || []).find((image) => image.id === element.id),
          cached = savedIndex?.images?.[element.id],
          valid = cached?.hash === imageFingerprint(element, board.scene.files[element.fileId]);
        const note = element.customData?.studyboard?.imageNote || '';
        add(
          'image/' + element.id,
          [note, shot?.caption, valid ? (cached.manualText ?? cached.text) : ''].filter(Boolean).join('\n'),
          'image',
          note.slice(0, 60) || shot?.caption || '画布图片',
          {
            elementIds: [element.id],
            seconds: shot?.videoTime ?? null,
            ...(elementPdfReference(element) ? { pdf: elementPdfReference(element) } : {}),
          },
        );
      }
    }
    if (savedIndex?.ink?.signature === inkSignature(board.scene))
      for (const chunk of savedIndex.ink.chunks)
        add('ink/' + chunk.id, chunk.manualText ?? chunk.text, 'handwriting', '画布手写', {
          elementIds: chunk.elementIds,
        });
    const summaries = allSummaries
      ? board.summaries.filter((summary) => !summary.deletedAt)
      : graphSummaries(board);
    for (const summary of summaries) {
      const study = legacyStudy(summary),
        loc = { summaryId: summary.id };
      add(summary.id + '/overview', study.overview, 'summary', study.title, { ...loc, blockId: 'overview' });
      for (const [i, value] of (study.takeaways || []).entries())
        add(summary.id + '/takeaway-' + i, value, 'summary', study.title, {
          ...loc,
          blockId: 'takeaway:' + i,
        });
      for (const concept of study.concepts) {
        add(summary.id + '/' + concept.id, concept.explanation, 'summary', concept.title, {
          ...loc,
          blockId: 'concept:' + concept.id + ':explanation',
        });
        if (concept.example)
          add(
            summary.id + '/' + concept.id + '/example',
            concept.example,
            'summary',
            '案例 · ' + concept.title,
            { ...loc, blockId: 'concept:' + concept.id + ':example' },
          );
      }
      for (const insight of study.insights || [])
        add(summary.id + '/insight-' + insight.id, insight.text, 'summary', insight.title, {
          ...loc,
          blockId: 'insight:' + insight.id,
        });
      for (const question of study.questions)
        add(
          summary.id + '/question-' + question.id,
          [question.prompt, question.context, ...(question.tasks || []), question.answer]
            .filter(Boolean)
            .join('\n'),
          'question',
          question.prompt,
          { ...loc, blockId: 'question:' + question.id + ':answer', questionId: question.id },
        );
      for (const annotation of summary.annotations || [])
        add(
          summary.id + '/annotation-' + annotation.id,
          annotation.note,
          'annotation',
          annotation.quote || '我的备注',
          { ...loc, blockId: annotation.blockId },
        );
    }
    this.recordCache.set(cacheKey, { signature, records: structuredClone(records) });
    while (this.recordCache.size > 1000) this.recordCache.delete(this.recordCache.keys().next().value);
    return records;
  }
  async materialRecords(id) {
    const material = await this.materials.get(id, { optional: true });
    if (!material || material.deletedAt) return [];
    if (material.boardId) {
      try {
        if ((await this.note(material.boardId)).deletedAt) return [];
      } catch {
        return [];
      }
    }
    return material.blocks.map((block) => ({
      id: 'material/' + id + '/' + block.id,
      boardId: material.boardId || null,
      materialId: id,
      summaryId: null,
      title: material.title,
      boardTitle: material.title,
      kind: 'material',
      text: block.text,
      hash: digest(block.text),
      url: material.url || null,
      publishedAt: material.publishedAt || null,
      locator: {
        elementIds: [],
        blockId: block.id,
        seconds: block.seconds ?? null,
        page: block.page ?? null,
        domId: block.domId || null,
      },
    }));
  }
  async visualRecords(id, elementIds = null) {
    const board = await this.note(id);
    if (board.deletedAt) return [];
    const elements = originalSummaryElements(board.scene.elements, board.summaries).filter(
      (e) => !elementIds || elementIds.includes(e.id),
    );
    if (!elements.length) return [];
    const imageFiles = unique(elements.map((e) => e.fileId).filter(Boolean)).map(
      (key) => board.scene.files[key]?.dataURL || '',
    );
    return [
      {
        id: id + '/visual',
        boardId: id,
        materialId: null,
        summaryId: null,
        title: board.title + ' · 白板图像',
        boardTitle: board.title,
        kind: 'visual',
        text: '本次附送的白板图像，包含原图、手写与空间关系。图像解读需回到原图核对。',
        hash: digest([elements, imageFiles]),
        url: board.source?.url || null,
        locator: { elementIds: elements.map((e) => e.id), blockId: null, seconds: null },
      },
    ];
  }
  async collect({
    noteIds = null,
    materialIds = [],
    allSummaries = false,
    visualNoteId = null,
    visualElementIds = null,
    reportIds = [],
    reviewIds = [],
  } = {}) {
    const records = [];
    for (const id of noteIds ?? (await this.noteIds())) {
      try {
        records.push(...(await this.noteRecords(id, { allSummaries })));
      } catch (error) {
        if (!['ENOENT', 'NOTE_PURGED'].includes(error.code)) throw error;
      }
    }
    const selectedNotes = new Set(noteIds ?? (await this.noteIds()));
    const linked = (await this.materials.list())
      .filter((material) => material.boardId && selectedNotes.has(material.boardId) && !material.deletedAt)
      .map((material) => material.id);
    for (const id of unique([...materialIds, ...linked])) records.push(...(await this.materialRecords(id)));
    if (visualNoteId) records.push(...(await this.visualRecords(visualNoteId, visualElementIds)));
    for (const id of unique(reportIds)) records.push(...(await this.reportRecords(id)));
    if (reviewIds.length) records.push(...(await this.reviewRecords(reviewIds)));
    return [...new Map(records.map((record) => [record.id, record])).values()];
  }
  budget(records, maxCharacters = 45000) {
    const groups = new Map(),
      priority = {
        summary: 0,
        notes: 1,
        canvas: 1,
        material: 1,
        annotation: 2,
        image: 2,
        handwriting: 2,
        visual: 0,
        review: 0,
        question: 3,
      };
    for (const source of records.filter(
      (source) =>
        source.kind !== 'metadata' &&
        !(
          source.kind === 'image' &&
          ['区域截图', '可见页截图', '页面截图', '粘贴的截图'].includes(source.text)
        ),
    )) {
      const key = source.reportId
        ? 'r:' + source.reportId
        : source.reviewId
          ? 'review:' + source.reviewId
          : source.materialId
            ? 'm:' + source.materialId
            : source.boardId;
      const list = groups.get(key) || [];
      list.push(source);
      groups.set(key, list);
    }
    for (const list of groups.values())
      list.sort((a, b) => (priority[a.kind] ?? 4) - (priority[b.kind] ?? 4));
    const selected = [];
    let length = 0,
      position = 0,
      remaining = true;
    while (remaining && selected.length < 100) {
      remaining = false;
      for (const list of groups.values()) {
        const source = list[position];
        if (!source) continue;
        remaining = true;
        const text = source.text.slice(0, 4500);
        if (length + text.length > maxCharacters) continue;
        length += text.length;
        selected.push({ ...source, text, ref: 'R' + String(selected.length + 1).padStart(3, '0') });
      }
      position++;
    }
    if (!selected.length) throw new Error('没有可分析的内容，请先记录文字、生成总结或导入材料');
    return selected;
  }
  modelData(records) {
    return records.map((source) => ({
      id: source.ref,
      title: source.title,
      kind: source.kind,
      text: source.text,
    }));
  }
  references(evidence, records, { required = true } = {}) {
    if (!Array.isArray(evidence) || (required && !evidence.length)) throw new Error('模型遗漏了原文依据');
    const map = new Map(records.map((source) => [source.ref, source]));
    return (evidence || []).map((item) => {
      const source = map.get(item.sourceId),
        quote = String(item.quote || '').trim();
      if (!source || quote.length < 2 || !normalized(source.text).includes(normalized(quote)))
        throw new Error('模型引用的依据与原文不一致，请重试');
      const { ref, ...reference } = source;
      return { ...reference, quote };
    });
  }
  sourceIds(ids, records) {
    const map = new Map(records.map((source) => [source.ref, source]));
    return unique(ids || []).map((id) => {
      const source = map.get(id);
      if (!source) throw new Error('模型引用了不存在的来源');
      const { ref, ...value } = source;
      return value;
    });
  }
  fingerprint(records) {
    return digest(records.map((source) => [source.id, source.hash]));
  }
  async reportRecords(onlyId = null) {
    if (!this.reportRepository) return [];
    const reports = onlyId
        ? [await this.reportRepository.get(onlyId, { optional: true })].filter(Boolean)
        : await this.reportRepository.list(),
      result = [];
    for (const report of reports) {
      const status = await this.status(report);
      if (status.unavailable) continue;
      const title =
        report.value.title ||
        report.value.focus ||
        report.value.promptQuestion ||
        report.value.question ||
        '学习整理';
      const walk = (value, path = []) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
          if (['evidence', 'sources', 'sourceIds', 'answerQuote', 'plan', 'failures'].includes(key)) continue;
          const next = [...path, key];
          if (
            typeof item === 'string' &&
            item.trim().length >= 8 &&
            !['id', 'title', 'mode', 'boardId', 'summaryId', 'direction', 'kind'].includes(key)
          ) {
            result.push({
              id: 'report/' + report.id + '/' + next.join('.'),
              boardId: null,
              materialId: null,
              summaryId: null,
              reportId: report.id,
              recordedAt: report.createdAt,
              feature: report.feature,
              topicId: report.feature === 'topics' ? report.key : null,
              previewMaterialId: report.feature === 'preview' ? report.key : null,
              title,
              boardTitle: title,
              kind:
                {
                  topics: 'topic-report',
                  feedback: 'feedback-report',
                  preview: 'preview-report',
                  explore: 'explore-report',
                }[report.feature] || 'summary',
              text: item,
              hash: digest(item),
              url: null,
              stale: status.stale,
              locator: { elementIds: [], blockId: null, seconds: null },
            });
          } else if (item && typeof item === 'object') walk(item, next);
        }
      };
      walk(report.value);
      const canvas =
        this.canvasRepository && (await this.canvasRepository.get(report.id, { optional: true }));
      if (canvas) {
        const edits = canvas.scene.elements
          .filter((element) => element.type === 'text' && !element.isDeleted)
          .flatMap((element) => {
            const meta = element.customData?.systemStudy,
              current = element.originalText || element.text || '';
            if (!current.trim() || (meta && !meta.itemId)) return [];
            const original = meta?.originalText || '';
            if (original && normalized(original) === normalized(current)) return [];
            return [original ? '生成时：' + original + '\n我的修改：' + current : '我的补充：' + current];
          })
          .join('\n\n');
        if (edits)
          result.push({
            id: 'report/' + report.id + '/canvas-edits',
            boardId: null,
            materialId: null,
            summaryId: null,
            reportId: report.id,
            feature: report.feature,
            kind: 'learning-edit',
            title: title + ' · 我的白板修改',
            boardTitle: title,
            recordedAt: canvas.updatedAt,
            text: edits,
            hash: digest(edits),
            url: null,
            locator: { elementIds: [], blockId: null, seconds: null },
          });
      }
    }
    return result;
  }
  async reviewRecords(ids = null) {
    if (!this.learning) return [];
    const wanted = ids ? new Set(ids) : null,
      result = [],
      available = new Map();
    for (const event of this.learning.data.reviews || []) {
      if (wanted && !wanted.has(event.eventId)) continue;
      const card = this.learning.data.cards[event.cardId];
      if (!card) continue;
      if (!available.has(card.id))
        available.set(
          card.id,
          await this.learning
            .validateCardSource(card)
            .then(() => true)
            .catch(() => false),
        );
      if (!available.get(card.id)) continue;
      const grade = { 1: '忘记', 2: '困难', 3: '记得', 4: '轻松' }[event.grade] || '未记录';
      const text = [
        '问题：' + card.question,
        '参考答案（来自已保存复习卡）：' + card.answer,
        event.answer ? '我的作答：' + event.answer : '本次没有保存文字作答',
        '复习自评：' + grade,
      ].join('\n');
      result.push({
        id: 'review/' + digest(event.eventId).slice(0, 24),
        reviewId: event.eventId,
        reviewedAt: event.at,
        recordedAt: event.at,
        boardId: card.boardId || null,
        materialId: null,
        summaryId: card.summaryId || null,
        title: card.question,
        boardTitle: card.boardTitle,
        kind: 'review',
        referenceAnswer: card.answer,
        text,
        hash: digest([event, card.answer]),
        url: null,
        locator: {
          elementIds: [],
          blockId: card.questionId ? 'question:' + card.questionId + ':answer' : null,
          seconds: null,
        },
      });
    }
    return result;
  }
  async status(report) {
    if (report.deletedAt) return { unavailable: true, stale: false };
    if (report.feature === 'topics' && this.topicRepository) {
      const topic = await this.topicRepository.get(report.key, { optional: true });
      if (!topic || topic.deletedAt) return { unavailable: true, stale: false };
    }
    const current = await this.collect({ ...report.scope, allSummaries: true }),
      byId = new Map(current.map((source) => [source.id, source]));
    const used = report.sources || [];
    return {
      unavailable: used.some((source) => !byId.has(source.id)),
      stale: used.some((source) => byId.get(source.id)?.hash !== source.hash),
    };
  }
}
