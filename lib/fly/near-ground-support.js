/** Exact near-object terrain contacts; no geometry, worker or physics writes. */
export const NEAR_SUPPORT = Object.freeze({ radiusM: 600, maxAglM: 700, capacity: 512,
  queriesPerFrame: 8, budgetMs: 0.5, checksPerFrame: 64, refreshSec: 1,
  retrySec: 0.5, retireSec: 8, blendSec: 0.65, maxRiseMps: 18,
  matrixSlotsPerFrame: 32, canopyPoints: 256, minZoom: { high: 16, medium: 15, low: 14 } });

const finite = Number.isFinite;
const smooth = (value) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
function height(entry, now) {
  const t = Math.min(1, Math.max(0, (now - entry.changedAt) / entry.duration));
  return entry.from + (entry.target - entry.from) * t * t * (3 - 2 * t);
}

export class NearGroundSupport {
  constructor(sample, clock = () => performance.now(), cfg = NEAR_SUPPORT) {
    this.sample = sample; this.clock = clock; this.cfg = cfg;
    // Numeric X/Z keys avoid building strings in the per-frame contact pass.
    this.points = new Map(); this.slots = new Array(cfg.capacity).fill(null);
    this.free = []; this.cursor = 0; this.active = false; this.epoch = null;
    this.now = 0; this.x = this.z = 0; this.radius2 = 0;
    this.stats = { active: false, cached: 0, queries: 0, work: 0, ms: 0,
      accepted: 0, misses: 0, revision: 0, saturated: 0, minZoom: 16,
      byKind: { canopy: 0, detail: 0 } };
    this.clear();
  }
  clear() {
    this.points.clear(); this.slots.fill(null); this.free.length = 0;
    for (let i = this.slots.length - 1; i >= 0; i--) this.free.push(i);
    this.cursor = 0; this.stats.cached = 0;
    this.stats.byKind.canopy = this.stats.byKind.detail = 0;
  }
  release(entry) {
    const column = this.points.get(entry.x);
    column.delete(entry.z); if (!column.size) this.points.delete(entry.x);
    this.slots[entry.slot] = null; this.free.push(entry.slot); this.stats.cached--;
    this.stats.byKind[entry.kind]--;
  }
  /** Called once per engine frame. Absolute XZ makes origin rebases a no-op. */
  step(now, x, z, aglM, mercatorK = 1, tier = 'high', epoch = 0, enabled = true) {
    const cfg = this.cfg, stats = this.stats;
    const active = enabled && finite(now + x + z + aglM) && aglM < cfg.maxAglM;
    const scale = finite(mercatorK) ? Math.max(1, mercatorK) : 1;
    const jumped = (x - this.x) ** 2 + (z - this.z) ** 2 > (2000 * scale) ** 2;
    if (this.epoch !== epoch || jumped || (!active && this.active)) this.clear();
    this.epoch = epoch; this.active = stats.active = active;
    this.now = now; this.x = x; this.z = z;
    this.radius2 = (cfg.radiusM * scale) ** 2;
    this.radius = cfg.radiusM * scale; this.edgeWidth = 80 * scale;
    this.altitudeK = 1 - smooth((aglM - (cfg.maxAglM - 100)) / 100);
    stats.minZoom = cfg.minZoom[tier] ?? cfg.minZoom.medium;
    stats.queries = stats.work = stats.ms = 0;
    if (!active || !stats.cached) return;
    const started = this.clock(), retire2 = ((cfg.radiusM + 200) * scale) ** 2;
    // A persistent cursor finishes the whole bounded cache; newly requested
    // points never restart a scan or starve older contacts.
    while (stats.work < cfg.checksPerFrame && stats.queries < cfg.queriesPerFrame) {
      if (this.clock() - started >= cfg.budgetMs) break;
      const entry = this.slots[this.cursor++ % this.slots.length]; stats.work++;
      if (!entry) continue;
      const d2 = (entry.x - x) ** 2 + (entry.z - z) ** 2;
      if (now - entry.usedAt > cfg.retireSec || d2 > retire2) { this.release(entry); continue; }
      if (d2 > this.radius2 || now < entry.nextAt) continue;
      stats.queries++;
      const result = this.sample(entry.x, entry.z);
      const trusted = finite(result?.elev) && finite(result?.tileZ) && result.tileZ >= stats.minZoom;
      // Never replace an accepted detailed contact with a coarser LOD answer.
      if (trusted && result.tileZ >= entry.zoom) {
        const current = height(entry, now);
        if (Math.abs(result.elev - entry.target) > 0.01 || entry.zoom < 0) {
          entry.from = current; entry.target = result.elev; entry.changedAt = now;
          // Smoothstep's peak speed is 1.5 times its mean speed.
          entry.duration = Math.max(cfg.blendSec, Math.abs(result.elev - current) * 1.5 / cfg.maxRiseMps);
          stats.revision++;
        }
        entry.zoom = result.tileZ; entry.failures = 0; stats.accepted++;
        entry.nextAt = now + cfg.refreshSec * (result.tileZ >= 18 ? 4 : 1);
      } else {
        stats.misses++; entry.failures = Math.min(4, entry.failures + 1);
        entry.nextAt = now + cfg.retrySec * 2 ** entry.failures;
      }
    }
    stats.ms = Math.max(0, this.clock() - started);
  }
  /** No terrain query here. Consumers only register a point or read its blend. */
  heightAt(x, z, fallbackY, kind = 'canopy') {
    if (!this.active || !finite(x + z + fallbackY) ||
      (x - this.x) ** 2 + (z - this.z) ** 2 > this.radius2) return fallbackY;
    let column = this.points.get(x), entry = column?.get(z);
    if (!entry) {
      kind = kind === 'canopy' ? 'canopy' : 'detail';
      const quota = kind === 'canopy' ? this.cfg.canopyPoints : this.cfg.capacity - this.cfg.canopyPoints;
      if (!this.free.length || this.stats.byKind[kind] >= quota) { this.stats.saturated++; return fallbackY; }
      if (!column) { column = new Map(); this.points.set(x, column); }
      const slot = this.free.pop();
      entry = { slot, x, z, kind, from: fallbackY, target: fallbackY, zoom: -1, failures: 0,
        changedAt: this.now, duration: this.cfg.blendSec, usedAt: this.now, nextAt: this.now };
      column.set(z, entry); this.slots[slot] = entry; this.stats.cached++;
      this.stats.byKind[kind]++;
    }
    if (entry.zoom < 0 && Math.abs(fallbackY - entry.target) > 0.01) {
      entry.from = height(entry, this.now); entry.target = fallbackY; entry.changedAt = this.now;
      entry.duration = Math.max(this.cfg.blendSec, Math.abs(fallbackY - entry.from) * 1.5 / this.cfg.maxRiseMps);
    }
    entry.usedAt = this.now;
    const distance = Math.hypot(x - this.x, z - this.z);
    const weight = (1 - smooth((distance - this.radius + this.edgeWidth) / this.edgeWidth)) * this.altitudeK;
    return fallbackY + (height(entry, this.now) - fallbackY) * weight;
  }
  dispose() { this.clear(); this.active = this.stats.active = false; }
}

function queueMatrixRun(attribute, first, last) {
  let start = first * 16, end = (last + 1) * 16;
  const ranges = attribute.updateRanges;
  // Preserve an existing full placement upload, including all its XZ/scale.
  for (const range of ranges) if (range.start <= start && range.start + range.count >= end) return;
  // Merge overlapping/adjacent pending runs in-place; hidden meshes therefore
  // cannot accumulate duplicate ranges. Never bridge untouched instance slots.
  let kept = 0;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i], rangeEnd = range.start + range.count;
    if (rangeEnd >= start && range.start <= end) {
      start = Math.min(start, range.start); end = Math.max(end, rangeEnd);
    } else ranges[kept++] = range;
  }
  ranges.length = kept;
  attribute.addUpdateRange(start, end - start);
}

/** Update only bounded, already-placed near indices; the shared depth material
 * reads the same matrix buffer. Pending range uploads remain intact. */
export function updateNearContactMatrices(mesh, contacts, support) {
  if (!contacts.count || !support?.active || !mesh?.instanceMatrix) return 0;
  const attribute = mesh.instanceMatrix, data = attribute.array;
  let changed = 0, runFirst = -1, runLast = -1;
  const visits = Math.min(contacts.count, NEAR_SUPPORT.matrixSlotsPerFrame);
  for (let n = 0; n < visits; n++) {
    const at = contacts.cursor++ % contacts.count, index = contacts.indices[at];
    if (index >= mesh.count) continue;
    const offset = index * 16 + 13;
    const sink = contacts.offset ?? 0;
    const next = support.heightAt(contacts.x[at], contacts.z[at], contacts.ground[at]) + sink;
    if (!finite(next) || Math.abs(data[offset] - next) < 0.005) continue;
    data[offset] = next;
    if (index !== runLast + 1 || runFirst < 0) {
      if (runFirst >= 0) queueMatrixRun(attribute, runFirst, runLast);
      runFirst = index;
    }
    runLast = index;
    changed++;
    contacts.maxOffset = Math.max(contacts.maxOffset ?? 0, Math.abs(next - sink - contacts.ground[at]));
  }
  if (runFirst >= 0) queueMatrixRun(attribute, runFirst, runLast);
  if (changed) {
    attribute.needsUpdate = true;
    if (mesh.boundingSphere && finite(contacts.baseRadius)) mesh.boundingSphere.radius = contacts.baseRadius + contacts.maxOffset;
  }
  return changed;
}
