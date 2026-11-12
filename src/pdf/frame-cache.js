/** Bounded raster cache. Invisible/evicted renders are cancelled, never painted into the live canvas. */
export class PdfFrameCache {
  constructor({ maxEntries = 3, maxPixels = 16_000_000 } = {}) {
    this.maxEntries = maxEntries;
    this.maxPixels = maxPixels;
    this.entries = new Map();
    this.current = null;
  }
  get(key, build, current = false) {
    if (current) this.current = key;
    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.promise;
    }
    entry = { controller: new AbortController(), value: null };
    this.entries.set(key, entry);
    entry.promise = Promise.resolve()
      .then(() => {
        entry.controller.signal.throwIfAborted();
        return build(entry.controller.signal);
      })
      .then((value) => {
        if (entry.controller.signal.aborted) {
          value.canvas.width = value.canvas.height = 0;
          throw entry.controller.signal.reason;
        }
        entry.value = value;
        this.trim();
        return value;
      })
      .catch((error) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      });
    entry.promise.catch(() => {});
    this.trim();
    return entry.promise;
  }
  remove(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.controller.abort();
    if (entry.value) entry.value.canvas.width = entry.value.canvas.height = 0;
  }
  trim() {
    const pixels = () =>
      [...this.entries.values()].reduce(
        (n, e) => n + (e.value ? e.value.canvas.width * e.value.canvas.height : 0),
        0,
      );
    while (this.entries.size > this.maxEntries || (this.entries.size > 1 && pixels() > this.maxPixels)) {
      const candidate = [...this.entries.keys()].find((key) => key !== this.current);
      if (candidate === undefined) break;
      this.remove(candidate);
    }
  }
  clear() {
    for (const key of this.entries.keys()) this.remove(key);
    this.current = null;
  }
}
