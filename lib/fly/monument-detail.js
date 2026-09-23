/** Landmark-only budgets; no changes to the world's quality ladder. */
export const MONUMENT_DETAIL = Object.freeze({
  prefetchM: 4000,
  enterM: 2000,
  exitM: 2500,
  maxDetailed: 2,
  concurrency: 2,
  cacheLandmarks: 4,
  retryMs: 30000,
  high: { triangles: 60000, bytes: 4 * 1024 * 1024 },
  medium: { triangles: 20000, bytes: 2 * 1024 * 1024 },
});

// Mercator is conformal, not metric. At Paris a map-unit kilometre is only 658m.
export function landmarkDistanceM(poi, position) {
  const horizontal =
    Math.hypot(poi.wx - position.x, poi.wz - position.z) *
    Math.cos((poi.lat * Math.PI) / 180);
  return Math.hypot(horizontal, position.y - (poi.groundY ?? position.y));
}

export function selectMonumentDetails(candidates, previous, tier) {
  if (tier === "low") return new Map();
  const level = tier === "high" ? "high" : "medium";
  const eligible = candidates.filter(
    (c) =>
      c.entry.detail?.[level] &&
      c.distanceM <=
        (previous.has(c.name) ? MONUMENT_DETAIL.exitM : MONUMENT_DETAIL.enterM),
  );
  // Incumbents hold their slot until the exit boundary: no nearest-two rank flap.
  eligible.sort(
    (a, b) =>
      Number(previous.has(b.name)) - Number(previous.has(a.name)) ||
      a.distanceM - b.distanceM ||
      a.name.localeCompare(b.name),
  );
  return new Map(
    eligible.slice(0, MONUMENT_DETAIL.maxDetailed).map((c) => [c.name, level]),
  );
}

/** Owns unmerged detail geometry. Merged scene copies never borrow these buffers. */
export class MonumentDetailCache {
  constructor(load, now = () => Date.now()) {
    this.load = load;
    this.now = now;
    this.items = new Map();
    this.wanted = new Map();
    this.pending = new Map();
    this.failed = new Map();
    this.active = 0;
    this.closed = false;
    this.revision = 0;
  }
  request(candidates, tier) {
    const level = tier === "high" ? "high" : "medium";
    const near =
      tier === "low"
        ? []
        : candidates
            .filter(
              (c) =>
                c.distanceM <= MONUMENT_DETAIL.prefetchM &&
                c.entry.detail?.[level],
            )
            .sort((a, b) => a.distanceM - b.distanceM)
            .slice(0, MONUMENT_DETAIL.cacheLandmarks);
    this.wanted = new Map(near.map((c) => [c.name, { entry: c.entry, level }]));
    for (const c of near) {
      const hit = this.items.get(c.name);
      if (hit) hit.used = this.now();
    }
    this.pump();
  }
  pump() {
    if (this.closed) return;
    for (const [name, request] of this.wanted) {
      if (this.active >= MONUMENT_DETAIL.concurrency) break;
      const { entry, level } = request,
        key = name + ":" + level;
      if (
        this.items.get(name)?.level === level ||
        this.pending.has(name) ||
        (this.failed.get(key) ?? -Infinity) + MONUMENT_DETAIL.retryMs >
          this.now()
      )
        continue;
      this.active++;
      this.pending.set(name, level);
      Promise.resolve()
        .then(() => this.load(entry, level))
        .then((geometry) => {
          if (this.closed || this.wanted.get(name)?.level !== level) {
            geometry.dispose();
            return;
          }
          this.items.get(name)?.geometry.dispose();
          this.items.set(name, { geometry, level, used: this.now() });
          this.failed.delete(key);
          this.revision++;
          while (this.items.size > MONUMENT_DETAIL.cacheLandmarks) {
            const oldest = [...this.items]
              .filter(([n]) => !this.wanted.has(n))
              .sort((a, b) => a[1].used - b[1].used)[0];
            if (!oldest) break;
            oldest[1].geometry.dispose();
            this.items.delete(oldest[0]);
          }
        })
        .catch(() => {
          this.failed.set(key, this.now());
        })
        .finally(() => {
          this.active--;
          this.pending.delete(name);
          this.pump();
        });
    }
  }
  get(name, level) {
    const hit = this.items.get(name);
    return hit?.level === level ? hit.geometry : null;
  }
  dispose() {
    this.closed = true;
    for (const hit of this.items.values()) hit.geometry.dispose();
    this.items.clear();
    this.wanted.clear();
  }
}
