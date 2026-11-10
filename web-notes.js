import { randomUUID, randomInt } from 'node:crypto';
import { atomicWrite, validateScene } from './core.js';

const imageCompanion = (element, imageId) =>
  [element.customData?.studyboard?.imageNoteFor, element.customData?.studyboard?.imageTextFor].includes(
    imageId,
  );

function source(board, url) {
  if (board.deletedAt) {
    const e = new Error('这篇笔记已在回收站，请先恢复');
    e.code = 'NOTE_TRASHED';
    throw e;
  }
  if (!board.source?.url) throw new Error('这篇笔记没有关联网页');
  if (url && new URL(url).href !== board.source.url)
    throw new Error('当前网页与笔记来源不一致，请重新打开侧边笔记');
}
export async function webNote(store, r) {
  const b = await store.read(r.id);
  source(b, r.url);
  return {
    id: b.id,
    title: b.title,
    source: b.source,
    webNotes: b.webNotes || { text: '', version: 0, updatedAt: b.createdAt },
    ...imageLists(b),
    revision: b.revision,
  };
}
function imageLists(b) {
  const active = new Set(b.scene.elements.filter((e) => !e.isDeleted).map((e) => e.id));
  const images = (b.webImages || []).map(({ element, noteElements, noteRestoreIds, ...i }) => ({
    ...i,
    note: element?.customData?.studyboard?.imageNote || '',
    deletedAt: active.has(i.id) ? null : i.deletedAt || b.updatedAt,
    preview: i.preview || b.scene.files[i.fileId]?.dataURL || '',
  }));
  return { images: images.filter((i) => !i.deletedAt), deletedImages: images.filter((i) => i.deletedAt) };
}
// Keep enough information to restore a screenshot even after the drawing engine drops tombstones.
export function reconcileWebImages(b, scene) {
  const elements = new Map(scene.elements.map((e) => [e.id, e])),
    previous = new Map(b.scene.elements.map((e) => [e.id, e]));
  for (const image of b.webImages || []) {
    const next = elements.get(image.id);
    image.element = next || image.element || previous.get(image.id);
    const priorNotes = b.scene.elements.filter((e) => imageCompanion(e, image.id));
    const currentNotes = scene.elements.filter((e) => imageCompanion(e, image.id));
    if (next?.isDeleted && !previous.get(image.id)?.isDeleted)
      image.noteRestoreIds = priorNotes.filter((e) => !e.isDeleted).map((e) => e.id);
    if (currentNotes.length) image.noteElements = currentNotes;
    else if (!image.noteElements?.length && priorNotes.length) image.noteElements = priorNotes;
    if (next) image.order = scene.elements.indexOf(next);
    else image.order ??= b.scene.elements.findIndex((e) => e.id === image.id);
    image.deletedAt = next && !next.isDeleted ? null : image.deletedAt || new Date().toISOString();
    if (!scene.files[image.fileId] && b.scene.files[image.fileId])
      scene.files[image.fileId] = b.scene.files[image.fileId];
  }
  return scene;
}
export async function setWebImageDeleted(store, r) {
  return store.serial(async () => {
    const b = await store.read(r.id);
    source(b, r.url);
    const image = (b.webImages || []).find((i) => i.id === r.imageId);
    if (!image || typeof r.deleted !== 'boolean') throw new Error('截图不存在或操作不正确');
    const old = b.scene.elements.find((e) => e.id === image.id) || image.element;
    if (!old || !b.scene.files[image.fileId]) throw new Error('截图数据不完整');
    if (!!old.isDeleted === r.deleted && b.scene.elements.some((e) => e.id === image.id))
      return { ...imageLists(b), revision: b.revision };
    const element = {
      ...old,
      isDeleted: r.deleted,
      version: (old.version || 0) + 1,
      versionNonce: randomInt(1, 2147483647),
      updated: Date.now(),
    };
    const elements = [...b.scene.elements],
      position = elements.findIndex((e) => e.id === image.id);
    if (position >= 0) elements[position] = element;
    else {
      const next = old.index ? elements.findIndex((e) => e.index && e.index > old.index) : -1;
      elements.splice(
        next >= 0 ? next : Math.min(Math.max(0, image.order ?? elements.length), elements.length),
        0,
        element,
      );
    }
    if (r.deleted) {
      const notes = elements.filter((e) => !e.isDeleted && imageCompanion(e, image.id));
      image.noteRestoreIds = notes.map((e) => e.id);
      for (const note of notes) {
        const at = elements.findIndex((e) => e.id === note.id);
        elements[at] = {
          ...note,
          isDeleted: true,
          version: (note.version || 0) + 1,
          versionNonce: randomInt(1, 2147483647),
          updated: Date.now(),
        };
      }
    } else {
      for (const noteId of image.noteRestoreIds || []) {
        const at = elements.findIndex((e) => e.id === noteId),
          note = at >= 0 ? elements[at] : image.noteElements?.find((e) => e.id === noteId);
        if (note) {
          const restored = {
            ...note,
            isDeleted: false,
            version: (note.version || 0) + 1,
            versionNonce: randomInt(1, 2147483647),
            updated: Date.now(),
          };
          if (at >= 0) elements[at] = restored;
          else elements.push(restored);
        }
      }
    }
    const scene = { ...b.scene, elements };
    b.scene = reconcileWebImages(b, validateScene(scene));
    b.revision++;
    b.updatedAt = new Date().toISOString();
    await atomicWrite(store.boardPath(b.id), b);
    return { ...imageLists(b), revision: b.revision };
  });
}
export async function webCanvas(store, r) {
  const b = await store.read(r.id);
  source(b, r.url);
  return { id: b.id, title: b.title, scene: b.scene, revision: b.revision };
}
export async function saveWebCanvas(store, r) {
  return store.serial(async () => {
    const b = await store.read(r.id);
    source(b, r.url);
    if (typeof r.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(r.requestId))
      throw new Error('保存编号不正确');
    if (b.lastWebCanvasSave?.id === r.requestId)
      return { revision: b.lastWebCanvasSave.revision, ...imageLists(b) };
    if (r.baseRevision !== b.revision) {
      const e = new Error('画布已在另一处更新。你的笔迹已保留在本机草稿，可另存或载入最新画布');
      e.code = 'CANVAS_CONFLICT';
      e.latest = { revision: b.revision };
      throw e;
    }
    b.scene = reconcileWebImages(b, validateScene(r.scene));
    b.revision++;
    b.updatedAt = new Date().toISOString();
    b.lastWebCanvasSave = { id: r.requestId, revision: b.revision };
    await atomicWrite(store.boardPath(b.id), b);
    return { revision: b.revision, ...imageLists(b) };
  });
}
export async function webImage(store, r) {
  const b = await store.read(r.id);
  source(b, r.url);
  const image = (b.webImages || []).find((i) => i.id === r.imageId),
    file = image && b.scene.files[image.fileId];
  if (!image || !file) throw new Error('截图不存在');
  return { dataURL: file.dataURL, width: image.width, height: image.height };
}
export async function saveWebNotes(store, r) {
  return store.serial(async () => {
    const b = await store.read(r.id);
    source(b, r.url);
    if (typeof r.text !== 'string' || r.text.length > 50000) throw new Error('随手记最多 50,000 字');
    const current = b.webNotes || { text: '', version: 0, updatedAt: b.createdAt };
    if (r.text === current.text) return { webNotes: current };
    if (r.baseVersion !== current.version) {
      const e = new Error('这篇随手记已在另一处更新，你的草稿已保留');
      e.code = 'NOTE_CONFLICT';
      e.latest = current;
      throw e;
    }
    b.webNotes = { text: r.text, version: current.version + 1, updatedAt: new Date().toISOString() };
    b.updatedAt = b.webNotes.updatedAt;
    await atomicWrite(store.boardPath(b.id), b);
    return { webNotes: b.webNotes };
  });
}
export async function addWebImage(store, r) {
  return store.serial(async () => {
    const b = await store.read(r.id);
    source(b, r.url);
    if (typeof r.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(r.requestId))
      throw new Error('截图请求编号不正确');
    const existing = (b.webImages || []).find((i) => i.requestId === r.requestId);
    if (existing) return { image: existing, duplicate: true };
    if (
      typeof r.dataURL !== 'string' ||
      r.dataURL.length > 22_000_000 ||
      !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(r.dataURL)
    )
      throw new Error('截图格式不正确或超过大小限制');
    if (
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height) ||
      r.width < 1 ||
      r.height < 1 ||
      r.width > 16000 ||
      r.height > 16000 ||
      r.width * r.height > 40_000_000
    )
      throw new Error('截图尺寸超出限制');
    const bytes = Buffer.from(r.dataURL.split(',')[1], 'base64');
    const png = r.dataURL.startsWith('data:image/png');
    if (
      png
        ? !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes[0] !== 255 || bytes[1] !== 216
    )
      throw new Error('截图数据损坏');
    const id = randomUUID(),
      fileId = randomUUID(),
      time = Date.now(),
      elements = b.scene.elements.filter((e) => !e.isDeleted);
    const width = Math.min(900, r.width),
      height = (width * r.height) / r.width,
      x = elements.length ? Math.min(...elements.map((e) => e.x)) : 0,
      y = elements.length ? Math.max(...elements.map((e) => e.y + Math.abs(e.height || 0))) + 70 : 0;
    const element = {
      id,
      type: 'image',
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      index: null,
      seed: randomInt(1, 2147483647),
      version: 1,
      versionNonce: randomInt(1, 2147483647),
      isDeleted: false,
      boundElements: null,
      updated: time,
      link: b.source.url,
      locked: false,
      fileId,
      status: 'saved',
      scale: [1, 1],
      crop: null,
    };
    const files = {
      ...b.scene.files,
      [fileId]: {
        id: fileId,
        mimeType: png ? 'image/png' : 'image/jpeg',
        dataURL: r.dataURL,
        created: time,
        lastRetrieved: time,
      },
    };
    b.scene = validateScene({ ...b.scene, elements: [...b.scene.elements, element], files });
    b.revision++;
    b.updatedAt = new Date().toISOString();
    const preview =
      typeof r.preview === 'string' &&
      r.preview.length < 220000 &&
      /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(r.preview)
        ? r.preview
        : '';
    const image = {
      id,
      fileId,
      requestId: r.requestId,
      width: r.width,
      height: r.height,
      caption: typeof r.caption === 'string' ? r.caption.slice(0, 500) : '',
      videoTime: Number.isFinite(r.videoTime) && r.videoTime >= 0 ? r.videoTime : null,
      createdAt: b.updatedAt,
      preview,
    };
    b.webImages = [...(b.webImages || []), { ...image, element }];
    await atomicWrite(store.boardPath(b.id), b);
    return { image, duplicate: false };
  });
}
