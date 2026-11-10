import { missingImageFiles, withKnownFiles, sameSceneContent } from './scene-sync.js';
export const sceneSignature = (scene) => JSON.stringify(scene);

// Saving is serialized; every unsent scene also lives in IndexedDB.
export class CanvasSession {
  constructor({ context, request, drafts, onStatus = () => {}, onImages = () => {} }) {
    Object.assign(this, { context, request, drafts, onStatus, onImages });
    this.key = 'chrome:' + context.id;
    this.dirty = false;
    this.conflict = false;
    this.blocked = false;
    this.pending = null;
    this.generation = 0;
    this.draftTail = Promise.resolve();
    this.disposed = false;
  }
  payload() {
    return { id: this.context.id, url: this.context.url };
  }
  async load() {
    const remote = await this.request('/note/canvas/get', this.payload()),
      draft = await this.drafts.read(this.key);
    this.scene = remote.scene;
    this.revision = remote.revision;
    if (draft?.scene && !sameSceneContent(withKnownFiles(draft.scene, remote.scene), remote.scene)) {
      this.scene = withKnownFiles(draft.scene, remote.scene);
      this.revision = draft.baseRevision;
      this.pending = draft.pending || null;
      this.generation = draft.generation || 0;
      this.dirty = true;
      if (this.pending && missingImageFiles(this.pending.scene).length) this.pending = null;
      if (this.pending && this.pending.generation === undefined)
        this.pending.generation = sameSceneContent(this.scene, this.pending.scene) ? this.generation : -1;
      this.conflict = this.revision !== remote.revision && !this.pending;
      this.onStatus(this.conflict ? 'conflict' : 'recovered');
    } else {
      await this.drafts.delete(this.key);
      this.onStatus('saved');
    }
    return this.scene;
  }
  persist() {
    clearTimeout(this.draftTimer);
    this.lastDraftAt = Date.now();
    const value = this.dirty
      ? structuredClone({
          scene: this.scene,
          baseRevision: this.revision,
          pending: this.pending,
          generation: this.generation,
          updatedAt: Date.now(),
        })
      : null;
    const p = this.draftTail.then(() =>
      value ? this.drafts.put(this.key, value) : this.drafts.delete(this.key),
    );
    this.draftTail = p.catch(() => {});
    return p;
  }
  change(scene) {
    if (this.disposed || scene === this.scene) return;
    this.scene = withKnownFiles(scene, this.scene);
    this.generation++;
    this.dirty = true;
    this.blocked = false;
    this.onStatus(this.conflict ? 'conflict' : 'waiting');
    // Avoid cloning every image on every pen movement. Save during long strokes,
    // shortly after a pause, and always before a network save or disposal.
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(
      () => this.persist().catch((e) => this.onStatus('local-error', e)),
      Date.now() - (this.lastDraftAt || 0) > 750 ? 0 : 100,
    );
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(() => {}), 700);
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.disposed) return;
    if (this.saving) return this.saving;
    if (this.conflict) {
      const e = new Error('请先处理画布版本冲突，你的笔迹已保存在本机草稿');
      e.code = 'CANVAS_CONFLICT';
      throw e;
    }
    this.saving = (async () => {
      try {
        while (this.dirty && !this.disposed) {
          if (this.pending && missingImageFiles(this.pending.scene).length) this.pending = null;
          if (!this.pending && missingImageFiles(this.scene).length) {
            this.blocked = true;
            await this.persist();
            const e = new Error('图片仍在准备中，读取完成后会自动继续保存');
            e.code = 'IMAGE_DATA_PENDING';
            throw e;
          }
          this.pending ||= {
            requestId: crypto.randomUUID(),
            baseRevision: this.revision,
            scene: this.scene,
            generation: this.generation,
          };
          await this.persist();
          this.onStatus('saving');
          const result = await this.request('/note/canvas/save', {
            ...this.payload(),
            requestId: this.pending.requestId,
            baseRevision: this.pending.baseRevision,
            scene: this.pending.scene,
          });
          if (this.disposed) return;
          this.revision = result.revision;
          this.dirty = this.generation !== this.pending.generation;
          this.pending = null;
          this.blocked = false;
          await this.persist();
          this.onImages(result);
        }
        this.onStatus('saved');
      } catch (e) {
        this.conflict = e.code === 'CANVAS_CONFLICT';
        if (
          ['IMAGE_DATA_PENDING', 'INVALID_SCENE', 'INVALID_IMAGE_DATA', 'SCENE_TOO_LARGE'].includes(e.code)
        ) {
          this.pending = null;
          await this.persist();
        }
        this.blocked = !!e.code && e.code !== 'NOTE_PURGED';
        this.onStatus(
          e.code === 'NOTE_PURGED'
            ? 'purged'
            : this.conflict
              ? 'conflict'
              : e.code === 'IMAGE_DATA_PENDING'
                ? 'waiting-image'
                : 'error',
          e,
        );
        throw e;
      }
    })();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }
  async reload() {
    await this.flush();
    const original = this.scene,
      revision = this.revision;
    const r = await this.request('/note/canvas/get', this.payload());
    if (this.dirty || this.scene !== original || this.revision !== revision) return null;
    this.scene = r.scene;
    this.revision = r.revision;
    return r.scene;
  }
  async useRemote() {
    if (this.dirty)
      await this.drafts.put(this.key + ':backup:' + Date.now(), {
        scene: this.scene,
        baseRevision: this.revision,
      });
    const r = await this.request('/note/canvas/get', this.payload());
    this.scene = r.scene;
    this.revision = r.revision;
    this.pending = null;
    this.dirty = false;
    this.conflict = false;
    this.blocked = false;
    this.generation++;
    await this.persist();
    this.onStatus('saved');
    return r.scene;
  }
  async saveCopy() {
    const copy = await this.request('/capture', {
      requestId: crypto.randomUUID(),
      url: this.context.url,
      title: this.context.title + '（画布草稿）',
      reuse: false,
    });
    await this.request('/note/canvas/save', {
      id: copy.id,
      url: this.context.url,
      requestId: crypto.randomUUID(),
      baseRevision: 0,
      scene: this.scene,
    });
    return copy;
  }
  async dispose() {
    clearTimeout(this.timer);
    clearTimeout(this.draftTimer);
    this.disposed = true;
    if (this.dirty) await this.persist();
    await this.draftTail;
  }
  async discard() {
    clearTimeout(this.timer);
    clearTimeout(this.draftTimer);
    this.disposed = true;
    this.dirty = false;
    await this.saving?.catch(() => {});
    await this.draftTail;
    if (this.drafts.purge) await this.drafts.purge([this.context.id]);
    else await this.drafts.delete(this.key);
  }
}
