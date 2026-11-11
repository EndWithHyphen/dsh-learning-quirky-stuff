/** Operation queue: failed saves survive reload, and retries retain their request IDs. */
export class PdfAnnotationSession {
  constructor({ execute, persist, load, onChange = () => {} }) {
    Object.assign(this, { execute, persist, load, onChange });
    this.queue = [];
    this.annotations = [];
    this.flight = null;
    this.error = '';
  }
  async init(annotations) {
    this.annotations = annotations;
    const saved = await this.load();
    this.queue = saved?.queue || [];
    this.emit();
    return this;
  }
  value() {
    const map = new Map(this.annotations.map((a) => [a.id, a]));
    for (const r of this.queue)
      map.set(r.id, {
        ...map.get(r.id),
        ...r,
        version: r.baseVersion + 1,
        deletedAt: r.deleted ? 'pending' : null,
      });
    return [...map.values()];
  }
  emit() {
    this.onChange({ annotations: this.value(), pending: this.queue.length, error: this.error });
  }
  async add(request) {
    const prior = this.value().find((a) => a.id === request.id),
      next = { ...request, baseVersion: prior?.version || 0, requestId: crypto.randomUUID() };
    this.queue.push(next);
    try {
      await this.persist({ queue: this.queue });
    } catch (e) {
      this.error = '批注草稿保存失败：' + e.message;
      this.emit();
      throw e;
    }
    this.emit();
    return this.flush();
  }
  flush() {
    if (this.flight) return this.flight;
    this.flight = (async () => {
      while (this.queue.length) {
        const request = this.queue[0],
          saved = await this.execute(request);
        this.annotations = this.annotations.some((a) => a.id === saved.id)
          ? this.annotations.map((a) => (a.id === saved.id ? saved : a))
          : [...this.annotations, saved];
        this.queue.shift();
        await this.persist({ queue: this.queue });
        this.error = '';
        this.emit();
      }
      this.error = '';
      this.emit();
    })()
      .catch((e) => {
        this.error = e.message;
        this.emit();
        throw e;
      })
      .finally(() => {
        this.flight = null;
      });
    return this.flight;
  }
  async discard(annotations) {
    if (this.flight) await this.flight.catch(() => {});
    await this.persist({ queue: [] });
    this.queue = [];
    this.annotations = annotations;
    this.error = '';
    this.emit();
  }
}
