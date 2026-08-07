import { CLUTTER, STREAM_KEEPER } from '../fly-constants';

// Must match vector-tile.worker.js WORKER_PROTOCOL. Round 22 ADDED the two
// ground-life keys to the 'sat-roads' answer; a stale worker has neither, and a
// pre-'sat-roads' worker falls through its dispatch to the FULL TOY pipeline and
// answers with a land/water/building toy bundle. Reading either as road paths is
// meaningless, so ANY v-mismatch is DROPPED here (dev-warn once, place nothing)
// — the R15 sat-building sentinel contract, for the same reason: no crash, no
// wrong pixels, and the warn tells the dev to hard-reload.
const EXPECTED_WORKER_PROTOCOL = 18;
let _warnedProtocol = false;

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

// --- R21 (B STREAMKEEPER) idioms, copied verbatim from SatVegEngine ---------
// This engine owns no GPU object, so P1's bend margin does not apply. What does
// apply is the sticky-empty / infinite-retry pair, and all of it is inert with
// STREAM_KEEPER.enabled false.
function jitter1() {
  const j = STREAM_KEEPER.retry.jitter;
  return 1 + (Math.random() * 2 - 1) * j;
}

function emptyRetryAt(nowSec, reason) {
  const R = STREAM_KEEPER.retry;
  if (!STREAM_KEEPER.enabled || !R.enabled || reason !== 'no-data') return Infinity;
  return nowSec + R.noDataTtlSec * jitter1();
}

function errorNextTryAt(nowSec, attempts) {
  const R = STREAM_KEEPER.retry;
  const secs = Math.min(R.errorCapSec, R.errorBaseSec * 2 ** Math.max(0, attempts - 1));
  return nowSec + secs * jitter1();
}

function emptyByReason(chunks) {
  const out = { noData: 0, zero: 0, legacy: 0 };
  for (const c of chunks.values()) {
    if (c.state !== 'empty') continue;
    if (c.reason === 'no-data') out.noData += 1;
    else if (c.reason === 'zero') out.zero += 1;
    else out.legacy += 1;
  }
  return out;
}

/**
 * ROUND 22 (C "CLUTTER") — the SATELLITE ground-life chunk streamer: road
 * centerlines for the movers and the lamp posts, parking anchors for the parked
 * cars, and one bilinear RAW-DEM grid per chunk to stand all three on.
 *
 * WHY IT STREAMS ITS OWN z13 RING INSTEAD OF READING SatRoadEngine'S.
 * The road ring already fetches exactly these tiles — but it MUTATES the
 * worker's position array in place at finalize (draping it), builds a
 * BufferGeometry out of it, and drops every other key on the bundle. The paths
 * this layer needs never survive that function, and SatRoadEngine is not C's
 * file this round (§2). So: same z13 tile URLs, own worker, own ring. Three
 * things make that cheap rather than a doubling —
 *   • R21's persistent tile cache (`fly-tiles-v1`) is a Cache API store, which
 *     is per-ORIGIN and not per-worker, so the second ask for a tile the road
 *     ring already pulled is a cache hit, not a fetch.
 *   • `api.setClutterOnly(true)` puts this engine's worker in ground-life mode:
 *     the ribbon tessellation (~90% of buildSatRoads, and ~500 KB of transfer
 *     per tile) never runs for these builds.
 *   • r 3600 / maxChunks 6 against the road ring's r 12000 / 16 — cars and lamp
 *     posts are a low-AGL read, so this ring is a third of the radius.
 *
 * THE OWENS INVARIANT IS NOT ENFORCED HERE. It is enforced in the worker (see
 * buildClutter's header): an Owens tile answers with neither key, so it reaches
 * 'empty' here through the ordinary path and the three pools have literally
 * nothing to place. This class contains no threshold at all — which is the
 * point, because a threshold in a client filter is a thing that can be
 * misconfigured, and an absent key is not.
 *
 * PUBLIC CONTRACT (SatClutterLayer consumes exactly this):
 *   new SatClutterEngine({ groundAt })
 *   setWorker(api) · update(nowSec, px, pz, eyeAglM) ·
 *   nearest(px, pz) → ready chunk records nearest-first ·
 *   groundAtLocal(chunk, lx, lz) → bilinear RAW-DEM height ·
 *   get ringOn · get stats · dispose()
 *
 * A ready chunk record is { key, cx, cz, span, paths, parking, grid, d } where
 * cx/cz are the ABSOLUTE tile centre and everything in `paths`/`parking` is
 * TILE-LOCAL (add cx/cz for world).
 */
export class SatClutterEngine {
  constructor({ groundAt }) {
    this.groundAt = groundAt; // (lonDeg, latDeg) => {elev, tileZ} | null
    this.worker = null;

    this.chunks = new Map(); // key "z/x/y" -> chunk record
    this.queue = [];
    this.building = 0;
    this.pendingSample = [];
    this._ready = []; // scratch, re-sorted by nearest() — never retained
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
    this._ringOn = false;
    this._parked = false;
    this._disposed = false;
    this._now = 0;
    this._heal = new Map();
    this._reqId = 0;
    this._stat = { errorRetries: 0, evictions: 0, heals: 0 };
    this._vx = 0;
    this._vz = 0;
    this._velT = undefined;
    this._velPx = undefined;
    this._velPz = undefined;
    this._leadHoldUntil = 0;
  }

  /** R21 (§3.4) — per-frame velocity EMA; a teleport resets it, never feeds it. */
  _trackVel(nowSec, px, pz) {
    const L = STREAM_KEEPER.lookahead;
    const dt = nowSec - (this._velT ?? nowSec);
    this._velT = nowSec;
    if (this._velPx === undefined) {
      this._velPx = px;
      this._velPz = pz;
      return;
    }
    const dx = px - this._velPx;
    const dz = pz - this._velPz;
    this._velPx = px;
    this._velPz = pz;
    if (dt <= 1e-4 || dt > 0.5) return;
    if (dx * dx + dz * dz > L.teleportM * L.teleportM) {
      this._vx = 0;
      this._vz = 0;
      this._leadHoldUntil = nowSec + L.warpHoldSec;
      return;
    }
    const a = Math.min(1, dt / L.tauSec);
    this._vx += (dx / dt - this._vx) * a;
    this._vz += (dz / dt - this._vz) * a;
  }

  /** R21 (§3.4) — ring centre pushed ahead of the player; 0 speed ⇒ unchanged. */
  _leadCenter(nowSec, px, pz, ringR) {
    const L = STREAM_KEEPER.lookahead;
    if (!STREAM_KEEPER.enabled || nowSec < this._leadHoldUntil) return [px, pz];
    const sp = Math.hypot(this._vx, this._vz);
    if (sp < 1) return [px, pz];
    const lead = Math.min(sp * L.leadSec, L.maxLeadFrac * ringR);
    return [px + (this._vx / sp) * lead, pz + (this._vz / sp) * lead];
  }

  /** R21 (P2) — re-admit an 'empty'/'error' record once its TTL/backoff is up. */
  _readmit(chunk, nowSec) {
    if (!STREAM_KEEPER.enabled || !STREAM_KEEPER.retry.enabled) return false;
    if (chunk.state === 'empty') return nowSec >= (chunk.retryAt ?? Infinity);
    if (chunk.state === 'error') return nowSec >= (chunk.nextTryAt ?? Infinity);
    return false;
  }

  setWorker(workerApi) {
    this.worker = workerApi;
    this._disposed = false;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
  }

  get ringOn() {
    return this._ringOn;
  }

  update(nowSec, playerX, playerZ, eyeAglM) {
    if (this._disposed || !this.worker) return;
    this._now = nowSec;
    this._trackVel(nowSec, playerX, playerZ);
    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > CLUTTER.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > CLUTTER.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ, eyeAglM, nowSec);
    }
    this._pumpQueue();
    this._samplePending();
    this._commitPending(nowSec);
  }

  // --- desired set: single z13 ring, altitude-gated with hysteresis -----------
  _refreshDesired(px0, pz0, eyeAglM, nowSec = 0) {
    if (this._ringOn) {
      if (eyeAglM > CLUTTER.cullAglOffM) this._ringOn = false;
    } else if (eyeAglM < CLUTTER.cullAglOnM) {
      this._ringOn = true;
    }
    if (!this._ringOn) {
      // R21 (P5) PARK, DON'T CLEAR — the SatVegEngine ruling. A touch-and-go
      // otherwise re-fetches and re-DEM-samples the whole neighbourhood every
      // circuit. `nearest()` reports nothing while parked, so the rendered
      // result above the cull is unchanged (all three pools count 0).
      if (STREAM_KEEPER.enabled && STREAM_KEEPER.parkVeg) {
        this._parked = true;
        this.queue.length = 0;
        this.pendingSample.length = 0;
        return;
      }
      this.chunks.clear();
      this.queue.length = 0;
      this.pendingSample.length = 0;
      return;
    }
    this._parked = false;

    const z = CLUTTER.ring.z;
    const r = CLUTTER.ring.r;
    const [px, pz] = this._leadCenter(nowSec, px0, pz0, r);
    const span = WORLD_SIZE / 2 ** z;
    const half = WORLD_SIZE / 2;
    const nTiles = 2 ** z;
    const txMin = Math.floor((px - r + half) / span);
    const txMax = Math.floor((px + r + half) / span);
    const tyMin = Math.floor((pz - r + half) / span);
    const tyMax = Math.floor((pz + r + half) / span);
    const desired = [];
    for (let ty = Math.max(0, tyMin); ty <= Math.min(nTiles - 1, tyMax); ty++) {
      for (let tx = Math.max(0, txMin); tx <= Math.min(nTiles - 1, txMax); tx++) {
        const minX = -half + tx * span;
        const minZ = -(half - ty * span);
        const dx = Math.max(minX - px, 0, px - (minX + span));
        const dz = Math.max(minZ - pz, 0, pz - (minZ + span));
        if (dx * dx + dz * dz > r * r) continue;
        const cx = minX + span / 2;
        const cz = minZ + span / 2;
        desired.push({ z, x: tx, y: ty, distSq: (cx - px) ** 2 + (cz - pz) ** 2 });
      }
    }
    desired.sort((a, b) => a.distSq - b.distSq);
    const kept = desired.slice(0, CLUTTER.maxChunks);
    const keep = new Set(kept.map((e) => `${e.z}/${e.x}/${e.y}`));

    for (const key of [...this.chunks.keys()]) {
      if (!keep.has(key)) {
        this.chunks.delete(key);
        this._heal.delete(key);
        this._stat.evictions += 1;
      }
    }
    // Heal a coarse-sampled chunk IN PLACE once a finer DEM tile answers under
    // it (SatVegEngine's pattern, not the road/building evict-and-refetch: a
    // refetch here would blink a whole block's cars out for a second), capped
    // per key by STREAM_KEEPER.healCap.
    let healed = 0;
    for (const chunk of this.chunks.values()) {
      if (healed >= 2) break;
      if (!chunk.coarse || chunk.state !== 'ready' || chunk.healing) continue;
      if (STREAM_KEEPER.enabled && (this._heal.get(chunk.key) ?? 0) >= STREAM_KEEPER.healCap)
        continue;
      const s = this._sampleWorld(chunk.cx, chunk.cz);
      if (s && s.tileZ >= CLUTTER.demZ) {
        chunk.healing = true;
        this._heal.set(chunk.key, (this._heal.get(chunk.key) ?? 0) + 1);
        this._stat.heals += 1;
        this.pendingSample.push({ key: chunk.key, chunk, grid: null, gi: 0 });
        healed += 1;
      }
    }
    this.queue = kept.filter((e) => {
      const chunk = this.chunks.get(`${e.z}/${e.x}/${e.y}`);
      if (!chunk) return true;
      if (!this._readmit(chunk, nowSec)) {
        chunk._readmit = false;
        return false;
      }
      chunk._readmit = true;
      return true;
    });
    this.pendingSample = this.pendingSample.filter((p) => keep.has(p.key));
  }

  /** RAW-DEM sample at an absolute world XZ (mercator → lon/lat). */
  _sampleWorld(wx, wz) {
    const lon = (wx / EARTH_R) * RAD2DEG;
    const lat = (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG;
    return this.groundAt(lon, lat);
  }

  _pumpQueue() {
    while (this.building < CLUTTER.maxBuilds && this.queue.length > 0) {
      const e = this.queue.shift();
      const key = `${e.z}/${e.x}/${e.y}`;
      const prev = this.chunks.get(key);
      if (prev && !prev._readmit) continue;
      const span = WORLD_SIZE / 2 ** e.z;
      const cx = -WORLD_SIZE / 2 + e.x * span + span / 2;
      const cz = -(WORLD_SIZE / 2 - e.y * span) + span / 2;
      this._reqId += 1;
      const reqId = this._reqId;
      if (prev?.state === 'error') this._stat.errorRetries += 1;
      this.chunks.set(key, {
        key,
        state: 'building',
        cx,
        cz,
        span,
        tile: e,
        attempts: prev?.attempts ?? 0,
        reqId,
      });
      this.building += 1;
      this.worker
        .buildTile(e.z, e.x, e.y, 'sat-roads')
        .then((result) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (this._disposed || !chunk || chunk.state !== 'building' || chunk.reqId !== reqId)
            return;
          if (result && result.v !== EXPECTED_WORKER_PROTOCOL) {
            if (process.env.NODE_ENV === 'development' && !_warnedProtocol) {
              _warnedProtocol = true;
              console.warn(
                `[sat-clutter] worker protocol ${result.v} != expected ${EXPECTED_WORKER_PROTOCOL} ` +
                  '(stale worker after HMR/dev-server restart?) — clutter skipped; hard-reload to refresh.'
              );
            }
            chunk.state = 'empty';
            chunk.reason = 'zero';
            chunk.retryAt = Infinity;
            return;
          }
          const paths = result?.satRoadPaths ?? null;
          const parking = result?.satParking ?? null;
          // NEITHER key = ocean, an all-tunnel tile, or — the case this round
          // exists to make unmistakable — a tile UNDER THE DENSITY FLOOR. All
          // three mean the same thing here: this chunk costs zero of
          // everything, and there is no client-side branch that can undo it.
          if (!result || (!paths && !parking)) {
            chunk.state = 'empty';
            chunk.reason = result?.reason;
            chunk.emptyAt = this._now;
            chunk.retryAt = emptyRetryAt(this._now, chunk.reason);
            return;
          }
          chunk.state = 'sampling';
          chunk.paths = paths && paths.cls?.length ? paths : null;
          chunk.parking = parking && parking.length >= 4 ? parking : null;
          chunk.streetKmPerKm2 = paths?.streetKmPerKm2 ?? 0;
          this.pendingSample.push({ key, chunk, grid: null, gi: 0 });
        })
        .catch((err) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (chunk && chunk.state === 'building' && chunk.reqId === reqId) {
            if (!STREAM_KEEPER.enabled || !STREAM_KEEPER.retry.enabled) {
              this.chunks.delete(key);
            } else {
              const R = STREAM_KEEPER.retry;
              const n = (chunk.attempts ?? 0) + 1;
              chunk.attempts = n;
              if (n >= R.maxAttempts) {
                chunk.state = 'empty';
                chunk.reason = 'no-data';
                chunk.emptyAt = this._now;
                chunk.retryAt = this._now + R.noDataTtlSec * jitter1();
              } else {
                chunk.state = 'error';
                chunk.nextTryAt = errorNextTryAt(this._now, n);
              }
            }
          }
          if (process.env.NODE_ENV === 'development')
            console.warn(`[sat-clutter] build ${key} failed:`, err?.message ?? err);
        });
    }
  }

  // --- ground: budgeted per-CHUNK bilinear RAW-DEM grid ----------------------
  // gridSegments 16 and the bilinear formula below are SAT_ROADS' — deliberately
  // identical, so a car's ground height and the ribbon it parks on are the same
  // number to the last bit. RAW DEM (no toy exaggeration, no lift).
  _samplePending() {
    if (this.pendingSample.length === 0) return;
    const t0 = performance.now();
    const G = CLUTTER.gridSegments;
    const N = (G + 1) * (G + 1);
    for (const p of this.pendingSample) {
      if (!p.grid) {
        p.grid = new Float32Array(N);
        p.gi = 0;
        p.miss = 0;
        p.coarse = 0;
      }
      const { cx, cz, span } = p.chunk;
      while (p.gi < N) {
        const gx = p.gi % (G + 1);
        const gz = (p.gi / (G + 1)) | 0;
        const s = this._sampleWorld(
          cx - span / 2 + (gx / G) * span,
          cz - span / 2 + (gz / G) * span
        );
        if (!s) p.miss += 1;
        else if (s.tileZ < CLUTTER.demZ) p.coarse += 1;
        p.grid[p.gi] = s?.elev ?? 0;
        p.gi += 1;
        if (performance.now() - t0 > CLUTTER.sampleBudgetMs) return;
      }
    }
  }

  _commitPending(nowSec) {
    const N = (CLUTTER.gridSegments + 1) * (CLUTTER.gridSegments + 1);
    for (let i = 0; i < this.pendingSample.length; i++) {
      const p = this.pendingSample[i];
      if (!p.grid || p.gi < N) continue; // still sampling
      // HOLD only on genuinely ABSENT DEM (a null sample would park a car park
      // at sea level); a merely COARSE grid commits and heals in place.
      if (p.miss / N > 0.05 && (p.tries ?? 0) < CLUTTER.missMaxTries) {
        if (nowSec >= (p.retryAt ?? 0)) {
          p.tries = (p.tries ?? 0) + 1;
          p.retryAt = nowSec + CLUTTER.missRetrySec;
          p.gi = 0;
          p.miss = 0;
          p.coarse = 0;
        }
        continue;
      }
      this.pendingSample.splice(i, 1);
      i -= 1;
      const chunk = p.chunk;
      if (this.chunks.get(p.key) !== chunk) continue; // evicted mid-sample
      chunk.grid = p.grid;
      chunk.coarse = p.coarse + p.miss > 0;
      chunk.healing = false;
      chunk.state = 'ready';
      // First time this chunk became placeable — B SETTLE's birth ramp reads it.
      if (chunk.bornAt === undefined) chunk.bornAt = nowSec;
    }
  }

  /**
   * Ready chunks, NEAREST-FIRST, each stamped with its centre distance `d`.
   * Engine-owned scratch: read it inside the caller's pass, never retain it.
   */
  nearest(px, pz) {
    const out = this._ready;
    out.length = 0;
    if (this._parked) return out;
    for (const chunk of this.chunks.values()) {
      if (chunk.state !== 'ready') continue;
      chunk.d = Math.hypot(chunk.cx - px, chunk.cz - pz);
      out.push(chunk);
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /** Bilinear RAW-DEM height for a TILE-LOCAL point of a ready chunk. */
  groundAtLocal(chunk, lx, lz) {
    const grid = chunk.grid;
    if (!grid) return 0;
    const G = CLUTTER.gridSegments;
    const w = G + 1;
    const span = chunk.span;
    const fx = Math.min(Math.max(((lx + span / 2) / span) * G, 0), G - 1e-6);
    const fz = Math.min(Math.max(((lz + span / 2) / span) * G, 0), G - 1e-6);
    const x0 = fx | 0;
    const z0 = fz | 0;
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = grid[z0 * w + x0];
    const h10 = grid[z0 * w + x0 + 1];
    const h01 = grid[(z0 + 1) * w + x0];
    const h11 = grid[(z0 + 1) * w + x0 + 1];
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  }

  /** Dev telemetry (window.__satClutter.stats / __flyStats.satClutter). */
  get stats() {
    if (this._parked) {
      return {
        chunks: this.chunks.size,
        ready: 0,
        empty: 0,
        queued: 0,
        building: this.building,
        sampling: 0,
        ringOn: false,
        parked: true,
        parkPts: 0,
        paths: 0,
        pathPts: 0,
        junctions: 0,
        emptyByReason: { noData: 0, zero: 0, legacy: 0 },
        errorRetries: this._stat.errorRetries,
        evictions: this._stat.evictions,
        heals: this._stat.heals,
      };
    }
    let ready = 0;
    let empty = 0;
    let parkPts = 0;
    let paths = 0;
    let pathPts = 0;
    let junctions = 0;
    for (const c of this.chunks.values()) {
      if (c.state === 'ready') {
        ready += 1;
        parkPts += (c.parking?.length ?? 0) / 4;
        paths += c.paths?.cls?.length ?? 0;
        pathPts += (c.paths?.pts?.length ?? 0) / 2;
        junctions += (c.paths?.junctions?.length ?? 0) / 2;
      }
      if (c.state === 'empty') empty += 1;
    }
    return {
      chunks: this.chunks.size,
      ready,
      empty,
      queued: this.queue.length,
      building: this.building,
      sampling: this.pendingSample.length,
      ringOn: this._ringOn,
      parked: false,
      parkPts,
      paths,
      pathPts,
      junctions,
      emptyByReason: emptyByReason(this.chunks),
      errorRetries: this._stat.errorRetries,
      evictions: this._stat.evictions,
      heals: this._stat.heals,
    };
  }

  dispose() {
    this._disposed = true;
    this.chunks.clear();
    this.queue.length = 0;
    this.pendingSample.length = 0;
    this._ready.length = 0;
    this._heal.clear();
    this._parked = false;
  }
}
