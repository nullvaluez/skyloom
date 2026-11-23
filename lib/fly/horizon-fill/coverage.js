/**
 * HORIZON FILL (FLY_HORIZON_FILL.md) stream C: the mapped-cell census.
 *
 * The skyline worker reports, for every stand-in tile it builds while the
 * request carries `horizonFill.cells`, a Uint8Array(256): the 16 x 16 survey
 * cells of that z14 tile, row-major (j * 16 + i, i east, j south), each the
 * number of mapped building footprints whose centre falls in the cell. This
 * class gathers those blocks into one 128 x 128 mask per z11 survey tile, the
 * grid the procedural carpet is generated on.
 *
 *   z14 tile (x14, y14) -> z11 tile (x14 >> 3, y14 >> 3), its block starting
 *   at cell ((x14 & 7) * 16, (y14 & 7) * 16) of that tile's 128 x 128 mask.
 *
 * The skyline engine owns one instance (runtime.satSkyline.fillCoverage); the
 * carpet engine polls epochOf at its refresh cadence and asks maskFor only when
 * an epoch moved. Masks are allocated per z11 tile on its first report, and at
 * most `maxTiles` z11 tiles are tracked (the least recently reported is
 * forgotten first). epochOf allocates nothing.
 */

const TILE = 128;
const BLOCK = 16;
const CELLS = TILE * TILE;

export class FillCoverage {
  /** @param {{ maxTiles?: number }} [opts] */
  constructor({ maxTiles = 256 } = {}) {
    this.maxTiles = Math.max(1, maxTiles | 0);
    this._tiles = new Map(); // tx * 2048 + ty -> { mask, known: Uint8Array(64), knownCount, epoch }
    this._clock = 0; // global, so a forgotten and re-reported tile never reuses an epoch
    this.stats = { reports: 0, changes: 0, forgets: 0, dropped: 0 };
  }

  /** Number of z11 tiles with at least one reported z14 tile. */
  get size() {
    return this._tiles.size;
  }

  /** Numeric key (z11 has 2048 tiles a side): no string is built on a lookup. */
  _key(tx, ty) {
    return tx * 2048 + ty;
  }

  /**
   * Record the census of one z14 tile, or forget it (`cells` null: the tile was
   * evicted or failed). The tile's epoch moves only when its mask changes.
   */
  setTile(x14, y14, cells) {
    const tx = x14 >> 3;
    const ty = y14 >> 3;
    const sub = (x14 & 7) + (y14 & 7) * 8;
    const key = this._key(tx, ty);
    let t = this._tiles.get(key);
    if (cells == null) {
      if (!t || !t.known[sub]) return;
      t.known[sub] = 0;
      t.knownCount -= 1;
      this.stats.forgets += 1;
      if (t.knownCount === 0) {
        this._tiles.delete(key);
        return;
      }
      clearBlock(t.mask, x14, y14);
      t.epoch = ++this._clock;
      return;
    }
    if (!(cells instanceof Uint8Array) || cells.length !== BLOCK * BLOCK) return;
    this.stats.reports += 1;
    if (!t) {
      while (this._tiles.size >= this.maxTiles) {
        // Map order is report order (a report re-inserts), so the head is the least recent.
        this._tiles.delete(this._tiles.keys().next().value);
        this.stats.dropped += 1;
      }
      t = { mask: new Uint8Array(CELLS), known: new Uint8Array(64), knownCount: 0, epoch: 0 };
      this._tiles.set(key, t);
    } else {
      this._tiles.delete(key);
      this._tiles.set(key, t);
    }
    const ox = (x14 & 7) * BLOCK;
    const oy = (y14 & 7) * BLOCK;
    let changed = !t.known[sub];
    for (let j = 0; j < BLOCK; j++) {
      const row = (oy + j) * TILE + ox;
      for (let i = 0; i < BLOCK; i++) {
        const v = cells[j * BLOCK + i];
        if (t.mask[row + i] !== v) {
          t.mask[row + i] = v;
          changed = true;
        }
      }
    }
    if (!t.known[sub]) {
      t.known[sub] = 1;
      t.knownCount += 1;
    }
    if (changed) {
      t.epoch = ++this._clock;
      this.stats.changes += 1;
    }
  }

  /** 0 while nothing is known about (tx, ty); otherwise changes whenever a z14 tile inside it changes. */
  epochOf(tx, ty) {
    const t = this._tiles.get(this._key(tx, ty));
    return t ? t.epoch : 0;
  }

  /** A fresh copy of the tile's 128 x 128 mask (nonzero = mapped footprints in the cell), or null. */
  maskFor(tx, ty) {
    const t = this._tiles.get(this._key(tx, ty));
    return t ? t.mask.slice() : null;
  }

  /** Share of the tile's 64 z14 tiles that have reported, 0..1. */
  knownFraction(tx, ty) {
    const t = this._tiles.get(this._key(tx, ty));
    return t ? t.knownCount / 64 : 0;
  }

  /** Forget everything (a warp to another continent, a teardown). */
  clear() {
    this._tiles.clear();
  }
}

function clearBlock(mask, x14, y14) {
  const ox = (x14 & 7) * BLOCK;
  const oy = (y14 & 7) * BLOCK;
  for (let j = 0; j < BLOCK; j++) mask.fill(0, (oy + j) * TILE + ox, (oy + j) * TILE + ox + BLOCK);
}
