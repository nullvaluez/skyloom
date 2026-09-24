// Fill resident Classic tiles without replacing their geometry or imagery.
// At most two DEM decodes run in the background. A profile/style/engine change
// invalidates their results; pending work still occupies its concurrency slot.
export class ResidentReliefBackfill {
  constructor({ concurrency = 2, retryMs = 30000, now = () => performance.now() } = {}) {
    this.limit = concurrency;
    this.retryMs = retryMs;
    this.now = now;
    this.generation = 0;
    this.active = new Set();
    this.retryAt = new WeakMap();
    this.stats = { started: 0, completed: 0, discarded: 0, failed: 0, active: 0, peak: 0 };
  }

  reset() {
    this.generation++;
    this.retryAt = new WeakMap();
  }

  request(tile, load, commit) {
    const geometry = tile?.model?.geometry;
    if (!geometry || geometry.userData.r25Relief || this.active.has(tile) ||
        this.active.size >= this.limit || (this.retryAt.get(geometry) || 0) > this.now()) return false;
    const generation = this.generation;
    const model = tile.model;
    this.active.add(tile);
    this.stats.started++;
    this.stats.active = this.active.size;
    this.stats.peak = Math.max(this.stats.peak, this.active.size);
    Promise.resolve().then(() => load(tile)).then((bytes) => {
      if (generation !== this.generation || tile.model !== model || model.geometry !== geometry) {
        this.stats.discarded++;
        return;
      }
      if (!bytes?.length) throw new Error('DEM returned no relief');
      // commit owns the final residency check (a tile may have been evicted).
      if (commit(tile, geometry, bytes)) this.stats.completed++;
      else this.stats.discarded++;
    }).catch(() => {
      this.stats.failed++;
      if (generation === this.generation) this.retryAt.set(geometry, this.now() + this.retryMs);
    }).finally(() => {
      this.active.delete(tile);
      this.stats.active = this.active.size;
    });
    return true;
  }
}
