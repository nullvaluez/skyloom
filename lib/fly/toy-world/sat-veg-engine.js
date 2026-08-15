import { COMMIT_BUDGET, LEAD_SAFE, RING_HOLD, SAT_VEG, STREAM_KEEPER } from '../fly-constants';

// --- Round 24 (B STREAM) — LEAD_SAFE + RING_HOLD ----------------------------
// File-local copies of the three helpers. The CANONICAL commentary — the
// mechanism, the measured bisection table that produced the caps, why the rank
// hysteresis preserves the hard draw bound and why the residency hold is
// bounded twice — lives ONCE, in the block of the same name in
// sat-building-engine.js. Copies rather than a shared module because that is
// already this directory's idiom (bendMarginM / _trackVel / _leadCenter are one
// copy per engine) and a sixth file would be unowned.
//
// THIS RING IS THE WORST CASE OF THE TWO THINGS LEAD_SAFE FIXES. `SAT_VEG`'s
// own constants block asserts, in prose, that "endM is inside the
// guaranteed-coverage radius above, so canopies always die of THIS and never of
// a missing chunk" (fly-constants.js:3155). Measured: with no lead the
// guaranteed radius is 2417 u against a `distFade.endM` of 2400 — true, by 17 u.
// With R21's lead at its 0.35·r maximum it is 1164 u, i.e. 1236 u short, and
// every canopy in that band is cut by an absent chunk at FULL SCALE. That is
// the user's "shrubs keep appearing and disappearing", and it is proportional
// to speed, which is why it is invisible to a fleet of frozen poses.
//
// Flag off ⇒ every expression below is the verbatim pre-R24 one.

/**
 * R24 (B) — the DEV A/B ARMS, the `__flyDepthArm` / `__flyFlashPin` idiom.
 * `window.__flyRingHold` / `window.__flyLeadSafe`: 1 forces the family ON, 0
 * forces it OFF, absent ⇒ the constant decides. They exist so scripts/
 * r24-b-probe-live.js can take a RED and a GREEN arm in ONE session on the
 * user's machine without editing a constant and rebuilding — which is the only
 * way this round's central claim (re-entries collapse under motion) can be
 * measured where a real world streams. NEVER set by the app or by
 * scripts/_boot.js, and compiled out of production by the NODE_ENV test.
 */
function ringHoldOn() {
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    const v = window.__flyRingHold;
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return RING_HOLD.enabled;
}

function leadSafeOn() {
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    const v = window.__flyLeadSafe;
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return LEAD_SAFE.enabled;
}

function leadCapM(name, ringR) {
  const base = STREAM_KEEPER.lookahead.maxLeadFrac * ringR;
  if (!leadSafeOn()) return base;
  const cap = LEAD_SAFE.capByEngine?.[name];
  return typeof cap === 'number' ? Math.min(base, cap) : base;
}

function ringHoldKeep(desired, maxChunks, chunks, keyOf, isLive) {
  const kept = desired.slice(0, maxChunks);
  if (!ringHoldOn()) return kept;
  const H = RING_HOLD.keepHysteresis;
  if (!(H > 0) || desired.length <= maxChunks) return kept;
  let w = kept.length - 1;
  const end = Math.min(desired.length, maxChunks + H);
  let swapped = false;
  for (let i = maxChunks; i < end; i++) {
    const e = desired[i];
    const c = chunks.get(keyOf(e));
    if (!c || !isLive(c)) continue;
    while (w >= 0 && chunks.has(keyOf(kept[w]))) w -= 1;
    if (w < 0) break;
    kept[w] = e;
    w -= 1;
    swapped = true;
  }
  if (swapped) kept.sort((a, b) => a.distSq - b.distSq);
  return kept;
}

function residencyHeld(chunks, keep, nowSec, cx, cz, ringR) {
  const out = new Set();
  if (!ringHoldOn()) return out;
  const H = RING_HOLD.keepHysteresis;
  const T = RING_HOLD.minResidencySec;
  if (!(H > 0) || !(T > 0)) return out;
  const farR2 = (ringR * 1.25) ** 2;
  let cand = null;
  for (const [key, chunk] of chunks) {
    if (keep.has(key)) continue;
    const born = chunk.readyAt;
    if (born === undefined || nowSec - born >= T) continue;
    if (chunk.cx === undefined || chunk.cz === undefined) continue;
    const dx = chunk.cx - cx;
    const dz = chunk.cz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > farR2) continue;
    (cand ??= []).push([d2, key]);
  }
  if (!cand) return out;
  cand.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < cand.length && i < H; i++) out.add(cand[i][1]);
  return out;
}

// Must match vector-tile.worker.js WORKER_PROTOCOL (round 18 → 14). Round 18
// ADDED the 'sat-veg' detail; a stale protocol-13 worker has no such branch, so
// the string falls through its dispatch to the FULL TOY pipeline and it answers
// with a land/water/building toy bundle that has no `satVeg`/`satPts` keys at
// all. Reading a toy bundle as vegetation is meaningless, so ANY v-mismatch is
// DROPPED here (dev-warn once, render nothing) — the R15 sat-building sentinel
// contract, for the same reason: no crash, no wrong pixels, and the warn tells
// the dev to hard-reload.
// Round 19 → 15: scaffolding lockstep (six pin sites, one diff). A HOMESTEAD
// adds per-class scatter rows this round; a v14 bundle has no class ids.
// Round 21 → 17: scaffolding lockstep (six pin sites, one diff). D PIPELINE
// makes vegMeta opt-in (api.setDiag) + adds empty-reason codes this round.
const EXPECTED_WORKER_PROTOCOL = 18; // R22 W0: lockstep bump
let _warnedProtocol = false;

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

// --- Round 21 (B STREAMKEEPER) ---------------------------------------------
// This engine owns no GPU object, so it has no bounding sphere to pad (P1 does
// not apply here). What it does own is the AGL cull that used to `chunks.clear()`
// — see _refreshDesired — and the same sticky-empty/infinite-retry pair as its
// siblings. All of it is inert with STREAM_KEEPER.enabled false.
function jitter1() {
  const j = STREAM_KEEPER.retry.jitter;
  return 1 + (Math.random() * 2 - 1) * j;
}

// D PIPELINE's reason contract: 'no-data' ⇒ TTL re-ask, 'zero' ⇒ deterministic
// (never), undefined ⇒ LEGACY worker ⇒ sticky exactly as today.
function emptyRetryAt(nowSec, reason) {
  const R = STREAM_KEEPER.retry;
  if (!STREAM_KEEPER.enabled || !R.enabled || reason !== 'no-data') return Infinity;
  return nowSec + R.noDataTtlSec * jitter1();
}

/**
 * P2 — capped, jittered exponential backoff for a FAILED build (was: none).
 * D PIPELINE's typed throws all land here and are ALL retryable in this one
 * class: `http-<code>` (5xx/429 upstream) and `http-timeout` (D's 12 s
 * AbortController — a stalled connection used to hold an in-flight slot for
 * minutes, i.e. a permanent hole with no error to retry against). An empty
 * TILE never throws: it comes back as { empty:true, reason } and is handled by
 * emptyRetryAt, where 'zero' — the ORDINARY open-ocean answer (OFM serves
 * empty ground as 200 + ~57 bytes, not 404) — is never re-asked, which is what
 * keeps oceans free. 'no-data' is the rare genuine-404 path.
 */
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
 * Round 18 (A3 "GROUNDSKEEPER") — the SATELLITE ground-life chunk streamer.
 *
 * The leanest member of the satellite streamer family (SatBuildingEngine,
 * SatRoadEngine): it owns NO Object3D and uploads NOTHING to the GPU. Its whole
 * job is to keep a small z14 ring of `sat-veg` worker bundles resident around
 * the player, each with a cached bilinear RAW-DEM ground grid, and to hand the
 * layers their point lists nearest-first. SatVegLayer draws the canopies as ONE
 * pooled global InstancedMesh (+1 draw for the whole world) and SatAmbientLife
 * draws the movers, so a per-chunk mesh — the thing every other streamer here
 * does — would be exactly the wrong shape.
 *
 * PURPOSE-BUILT, never ToyWorldEngine (that class is what ToyWorldLayer
 * publishes as window.__toyWorld, which verify-round11 gate A asserts stays
 * undefined in satellite). SatVegLayer publishes this one as window.__satVeg.
 *
 * Deliberate differences from the two sibling rings:
 *   • z14 / r 3600 — the SAME tile grid and radius as the building ring, so the
 *     carpet and the things standing on it arrive and leave together.
 *   • maxChunks is a TIER knob, and the layer's per-chunk placement cap is
 *     floor(pool / maxChunks): maxChunks × cap ≤ pool, which is what makes a
 *     pool overflow (a hard radius cut that pops as the player moves)
 *     impossible by construction.
 *   • The ground grid is per-CHUNK bilinear (25 samples), not per-object exact
 *     like the buildings: a 5 m canopy tolerates a metre of slope error, and
 *     400 getGroundAt per tile × 9 tiles would not.
 *   • cullAglOnM 2000 / cullAglOffM 2600 — the ring evicts only ABOVE the
 *     altitude at which the layer has already scaled every canopy to zero.
 *
 * PUBLIC CONTRACT (SatVegLayer + SatAmbientLife consume exactly this):
 *   new SatVegEngine({ groundAt, maxChunks })
 *   setWorker(api) · update(nowSec, px, pz, eyeAglM) ·
 *   nearest(px, pz) → ready chunk records nearest-first ·
 *   groundAtLocal(chunk, lx, lz) → bilinear RAW-DEM height ·
 *   get ringOn · get stats · dispose()
 *
 * A ready chunk record is { cx, cz, veg, cls, tint, parcel, water, ind, grid,
 * span, d }
 * — cx/cz are the ABSOLUTE tile centre, and veg/cls/tint/water/ind hold the
 * worker's rows in TILE-LOCAL coordinates (add cx/cz for world).
 *
 * Round 19 (C GROUNDTRUTH) added two consumers to the same chunk records, and
 * that sharing is the point: SatTintLayer drapes the landcover polys on the
 * SAME bilinear grid the canopy stands on, and SatHouseLights anchors its
 * residential-parcel lights on the SAME scatter points — so the carpet, its
 * colour and its porch lights can never disagree about where the ground is.
 */
export class SatVegEngine {
  constructor({ groundAt, maxChunks }) {
    this.groundAt = groundAt; // (lonDeg, latDeg) => {elev, tileZ} | null
    this.maxChunks = maxChunks;
    this.worker = null;

    this.chunks = new Map(); // key "z/x/y" -> chunk record
    this.queue = [];
    this.building = 0;
    this.pendingSample = [];
    this._ready = []; // scratch, re-sorted by nearest() — never retained by callers
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
    this._ringOn = false; // altitude hysteresis (armed = veg streaming)
    this._disposed = false;
    // --- Round 21 (B STREAMKEEPER) ------------------------------------------
    this._now = 0; // frame clock, readable from async build callbacks
    this._parked = false; // P5: ring culled but the records KEPT (see below)
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
    // This engine has no notifyWarp (see the NOTE above) — the teleport test IS
    // its warp detector, and it is the same one the siblings rely on anyway.
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
    // R24 (B) — LEAD_SAFE. See the header block: this ring's fade constant sits
    // 17 u inside its own lead-free coverage guarantee, so its cap is small.
    const lead = Math.min(sp * L.leadSec, leadCapM('satVeg', ringR));
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

  // NOTE: no notifyWarp(). The sibling engines need one because they HOLD a
  // finished chunk until the DEM is good enough, and a warp has to shorten that
  // hold or the destination arrives empty. This engine only holds on genuinely
  // ABSENT DEM, which a warp does not make worse, and the jump itself trips the
  // refreshMoveM threshold on the very next frame.

  get ringOn() {
    return this._ringOn;
  }

  /** Per-frame. playerX/Z absolute world; eyeAglM = eye altitude above ground. */
  update(nowSec, playerX, playerZ, eyeAglM) {
    if (this._disposed || !this.worker) return;
    this._now = nowSec;
    this._trackVel(nowSec, playerX, playerZ);
    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > SAT_VEG.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > SAT_VEG.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ, eyeAglM, nowSec);
    }
    this._pumpQueue();
    this._samplePending();
    this._commitPending(nowSec);
  }

  // --- desired set: single z14 ring, altitude-gated with hysteresis -----------
  _refreshDesired(px0, pz0, eyeAglM, nowSec = 0) {
    const S = SAT_VEG;
    if (this._ringOn) {
      if (eyeAglM > S.cullAglOffM) this._ringOn = false;
    } else if (eyeAglM < S.cullAglOnM) {
      this._ringOn = true;
    }
    if (!this._ringOn) {
      // ROUND 21 (P5) — PARK, DON'T CLEAR. `chunks.clear()` threw away every
      // streamed bundle AND its sampled DEM grid the moment the player climbed
      // past 2,600 m AGL, so every descent re-fetched and re-sampled the whole
      // ring from scratch — and the layers that read those chunks (canopy,
      // tint, house lights and, since R20, the parcel homes) replayed their
      // whole first-placement race on each one. A touch-and-go therefore
      // rebuilt the neighbourhood every circuit. Parking keeps at most
      // maxChunks records (no GPU objects — this engine owns none) and
      // `nearest()` reports NOTHING while parked, so the rendered result above
      // the cull is unchanged: `placed === 0`, exactly what verify-veg (D)
      // asserts. Stale records cannot survive the re-arm: the very refresh
      // that unparks recomputes `keep` at the new position and deletes them.
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

    const z = S.ring.z;
    const r = S.ring.r;
    // R21 (§3.4): ring centred slightly ahead at speed; identical at rest.
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
        // tile square [minX,maxX]×[minZ,maxZ] vs circle(px,pz,r)
        const dx = Math.max(minX - px, 0, px - (minX + span));
        const dz = Math.max(minZ - pz, 0, pz - (minZ + span));
        if (dx * dx + dz * dz > r * r) continue;
        const cx = minX + span / 2;
        const cz = minZ + span / 2;
        desired.push({ z, x: tx, y: ty, distSq: (cx - px) ** 2 + (cz - pz) ** 2 });
      }
    }
    // Nearest win — this is the hard bound on how many chunks the layers can
    // ever draw from, and therefore (with the per-chunk cap) on the pool.
    desired.sort((a, b) => a.distSq - b.distSq);
    // R24 (B) — RING_HOLD. `kept` is still at most `this.maxChunks` and still
    // rank-sorted. A chunk is worth protecting once it is 'ready', which for
    // this engine (which owns no GPU objects) is exactly when `nearest()` will
    // report it and the pooled layers will draw from it.
    const keyOf = (e) => `${e.z}/${e.x}/${e.y}`;
    const kept = ringHoldKeep(desired, this.maxChunks, this.chunks, keyOf, (c) => c.state === 'ready');
    const keep = new Set(kept.map(keyOf));
    const held = residencyHeld(this.chunks, keep, nowSec, px0, pz0, r);

    for (const key of [...this.chunks.keys()]) {
      if (!keep.has(key)) {
        if (held.has(key)) continue; // R24 (B) — RING_HOLD (2), min residency
        this.chunks.delete(key);
        this._heal.delete(key);
        this._stat.evictions += 1;
      }
    }
    // Heal coarse-accepted chunks once a finer DEM tile answers at their
    // centre. IN PLACE: a second grid is sampled alongside the live one and
    // swapped in when it completes, so the chunk stays 'ready' and its trees
    // stay on screen throughout (the road/building engines evict and REFETCH
    // the whole tile here — which for a canopy would trade a small height
    // error for a hole in the forest).
    let healed = 0;
    for (const chunk of this.chunks.values()) {
      if (healed >= SAT_VEG.healPerRefresh) break;
      if (!chunk.coarse || chunk.state !== 'ready' || chunk.healing) continue;
      // R21 (P6): the in-place re-grid is the RIGHT pattern (no hole, no
      // refetch) but it is still unbounded — a chunk whose centre reads demZ
      // while its corners never will re-samples 25 points every 2 s for the
      // whole session. Capped by the same per-key counter as its siblings.
      if (STREAM_KEEPER.enabled && (this._heal.get(chunk.key) ?? 0) >= STREAM_KEEPER.healCap)
        continue;
      const s = this._sampleWorld(chunk.cx, chunk.cz);
      if (s && s.tileZ >= SAT_VEG.demZ) {
        chunk.healing = true;
        this._heal.set(chunk.key, (this._heal.get(chunk.key) ?? 0) + 1);
        this._stat.heals += 1;
        this.pendingSample.push({ key: chunk.key, chunk, regrid: true, grid: null, gi: 0 });
        healed += 1;
      }
    }
    // R21 (P2): an 'empty'/'error' record is re-admitted once its TTL/backoff
    // expires. Flag off, `_readmit` is always false ⇒ the unchanged filter.
    this.queue = kept.filter((e) => {
      const chunk = this.chunks.get(`${e.z}/${e.x}/${e.y}`);
      if (!chunk) return true;
      if (!this._readmit(chunk, nowSec)) {
        chunk._readmit = false; // never leave a stale re-admission flag behind
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
    while (this.building < SAT_VEG.maxBuilds && this.queue.length > 0) {
      const e = this.queue.shift();
      const key = `${e.z}/${e.x}/${e.y}`;
      const prev = this.chunks.get(key);
      // R21 (P2): flag off, `_readmit` never fires ⇒ the unchanged `has` guard.
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
        .buildTile(e.z, e.x, e.y, 'sat-veg')
        .then((result) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (this._disposed || !chunk || chunk.state !== 'building' || chunk.reqId !== reqId)
            return;
          if (result && result.v !== EXPECTED_WORKER_PROTOCOL) {
            if (process.env.NODE_ENV === 'development' && !_warnedProtocol) {
              _warnedProtocol = true;
              console.warn(
                `[sat-veg] worker protocol ${result.v} != expected ${EXPECTED_WORKER_PROTOCOL} ` +
                  '(stale worker after HMR/dev-server restart?) — vegetation skipped; hard-reload to refresh.'
              );
            }
            chunk.state = 'empty';
            chunk.reason = 'zero'; // R21: stale-worker is deterministic, never re-asked
            chunk.retryAt = Infinity;
            return;
          }
          // No satVeg AND no satPts AND no satTint = ocean, desert, bare rock,
          // or a tile whose park/landcover/water/industrial layers are all
          // absent. Nothing to draw, nothing to sample: this chunk costs zero
          // of everything.
          const veg = result?.satVeg ?? null;
          const pts = result?.satPts ?? null;
          // Round 19 (C GROUNDTRUTH) — A HOMESTEAD's two frozen v15 additions,
          // both read with `?? null` because BOTH are absent (not empty) when
          // their feature flag is off or the tile has none of that data:
          //   cls  — Uint8Array, ONE entry per satVeg ROW (stride stays 4).
          //          1 park · 2 wood · 3 grass · 4 residential · 5 farmland ·
          //          6 orchard; 0 reserved. Length-checked against the row
          //          count here so a mismatched bundle degrades to "no
          //          classes" instead of mis-tagging every canopy.
          //   tint — {pos, col, idx, cls} merged landcover polys, TILE-LOCAL
          //          and flat at y=0 (the satWater layout) → SatTintLayer
          //          drapes them on THIS chunk's grid.
          // A tint-only tile is a real case (farmland with no scatter budget
          // left), and it still needs the ground grid — hence tint joining the
          // emptiness test rather than riding along with it.
          const tint = result?.satTint ?? null;
          // Round 20 (B PARCEL-HOMES): the dedicated residential parcel anchors
          // (Float32Array of TILE-LOCAL [x, z] pairs). It joins the emptiness
          // test for the same reason `tint` did: a tile can legitimately be
          // ALL subdivision — no park, no wood, no water, no industry, and
          // therefore no veg rows, no ambient points and no tint — and dropping
          // it as "empty" would blank exactly the suburb this round is for.
          const parcel = result?.satParcel ?? null;
          if (!result || (!veg && !pts && !tint && !parcel)) {
            chunk.state = 'empty';
            // R21 (P2): keep the record + stamp WHY. 'no-data' (upstream
            // 404/204) earns a TTL re-ask; a genuinely bare tile ('zero') and
            // any legacy bundle stay sticky, exactly as today.
            chunk.reason = result?.reason;
            chunk.emptyAt = this._now;
            chunk.retryAt = emptyRetryAt(this._now, chunk.reason);
            return;
          }
          chunk.state = 'sampling';
          chunk.parcel = parcel;
          chunk.veg = veg;
          const cls = result?.satVegCls ?? null;
          chunk.cls = veg && cls && cls.length === veg.length / 4 ? cls : null;
          chunk.tint = tint && tint.idx?.length ? tint : null;
          chunk.water = pts?.water?.length ? pts.water : null;
          chunk.ind = pts?.ind?.length ? pts.ind : null;
          this.pendingSample.push({ key, chunk, regrid: false, grid: null, gi: 0 });
        })
        .catch((err) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (chunk && chunk.state === 'building' && chunk.reqId === reqId) {
            if (!STREAM_KEEPER.enabled || !STREAM_KEEPER.retry.enabled) {
              this.chunks.delete(key); // legacy: re-requested every refresh
            } else {
              // R21 (P2): capped jittered backoff — five engines re-asking a
              // failing upstream every 2 s is how a wobble becomes an outage.
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
            console.warn(`[sat-veg] build ${key} failed:`, err?.message ?? err);
        });
    }
  }

  // --- ground: budgeted per-CHUNK bilinear RAW-DEM grid ----------------------
  // (G+1)² samples over the tile, amortized across frames on a ms budget — the
  // sat-road drape idiom at a twentieth of the sample count. RAW DEM: no toy
  // ×1.7 exaggeration and no lift (the R11 monuments lesson).
  //
  // Two failure modes, deliberately treated as DIFFERENT things:
  //   miss   — groundAt returned null: no tile covers this point at all, and
  //            the fallback elevation 0 would park a forest at sea level.
  //            This is the one that HOLDS.
  //   coarse — a tile answered below demZ: the elevation is real, just
  //            low-resolution. Commit it and heal in place later.
  _samplePending() {
    if (this.pendingSample.length === 0) return;
    const t0 = performance.now();
    const G = SAT_VEG.gridSegments;
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
        else if (s.tileZ < SAT_VEG.demZ) p.coarse += 1;
        p.grid[p.gi] = s?.elev ?? 0;
        p.gi += 1;
        if (performance.now() - t0 > SAT_VEG.sampleBudgetMs) return;
      }
    }
  }

  _commitPending(nowSec) {
    const S = SAT_VEG;
    const N = (S.gridSegments + 1) * (S.gridSegments + 1);
    // R24 (B) — COMMIT_BUDGET (closes the R22.1 close-ledger F3). This engine
    // and SatClutterEngine were the only streaming engines with NO per-frame
    // finalize cap, so a refresh that resolved four chunks together flipped all
    // four to 'ready' in ONE frame — and every pooled layer downstream keys its
    // static-skip signature on this engine's `ready` count, so four arrivals
    // became one frame in which the canopy, the tint, the house lights and the
    // parcel homes all re-derived their whole pool at once. Nothing here builds
    // geometry, so this was never the stutter; it is what made several
    // independent pops land on the same frame. `enabled:false` ⇒ `budget` is
    // Infinity and the loop is the verbatim pre-R24 one.
    const budget =
      COMMIT_BUDGET.enabled && COMMIT_BUDGET.finalizePerFrame > 0
        ? COMMIT_BUDGET.finalizePerFrame
        : Infinity;
    let done = 0;
    for (let i = 0; i < this.pendingSample.length; i++) {
      if (done >= budget) break;
      const p = this.pendingSample[i];
      if (!p.grid || p.gi < N) continue; // still sampling
      if (p.miss / N > 0.05 && (p.tries ?? 0) < S.missMaxTries) {
        if (nowSec >= (p.retryAt ?? 0)) {
          p.tries = (p.tries ?? 0) + 1;
          p.retryAt = nowSec + S.missRetrySec;
          p.gi = 0;
          p.miss = 0;
          p.coarse = 0;
        }
        continue;
      }
      this.pendingSample.splice(i, 1);
      i -= 1;
      done += 1;
      const chunk = p.chunk;
      if (this.chunks.get(p.key) !== chunk) continue; // evicted mid-sample
      // A re-grid swaps the array under a chunk that never stopped drawing.
      chunk.grid = p.grid;
      chunk.coarse = p.coarse + p.miss > 0;
      chunk.healing = false;
      const wasReady = chunk.state === 'ready';
      chunk.state = 'ready';
      // R24 (B) — RING_HOLD (2) reads this. A HEAL re-grids a chunk that never
      // stopped drawing, so it must NOT re-arm the residency clock: the stamp
      // means "this is when the pilot first saw it", not "when it was last
      // touched". Re-arming would let a chunk healing every few seconds sit
      // permanently un-evictable.
      if (!wasReady) chunk.readyAt = nowSec;
    }
  }

  /**
   * Ready chunks, NEAREST-FIRST, each stamped with its centre distance `d`.
   * The returned array is engine-owned scratch: read it inside the caller's
   * placement pass and never retain it.
   */
  nearest(px, pz) {
    const out = this._ready;
    out.length = 0;
    // R21 (P5): PARKED means the AGL cull is active — the records are retained
    // for the descent, but as far as every consumer is concerned the ring is
    // gone. This is the line that keeps parking invisible: verify-veg (D)
    // asserts `placed === 0` above altFade.offM and it still is.
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
    const G = SAT_VEG.gridSegments;
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

  /** Dev telemetry (window.__satVeg.stats / __flyStats.satVeg). */
  get stats() {
    let ready = 0;
    let empty = 0;
    let vegPts = 0;
    let waterPts = 0;
    let indPts = 0;
    let tintChunks = 0; // round 19: chunks carrying landcover tint geometry
    let tintVerts = 0;
    let clsChunks = 0; // …and chunks whose canopy rows carry class ids
    let parcelPts = 0; // round 20 (B): residential parcel anchors resident
    // R21 (P5): while PARKED the ring is culled and the layers place nothing —
    // report it as such (the records are a warm cache, not a live ring) so no
    // consumer or gate can read a parked count as live vegetation.
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
        vegPts: 0,
        waterPts: 0,
        indPts: 0,
        tintChunks: 0,
        tintVerts: 0,
        clsChunks: 0,
        parcelPts: 0,
        emptyByReason: { noData: 0, zero: 0, legacy: 0 },
        errorRetries: this._stat.errorRetries,
        evictions: this._stat.evictions,
        heals: this._stat.heals,
      };
    }
    for (const c of this.chunks.values()) {
      if (c.state === 'ready') {
        ready += 1;
        parcelPts += (c.parcel?.length ?? 0) / 2;
        vegPts += (c.veg?.length ?? 0) / 4;
        waterPts += (c.water?.length ?? 0) / 2;
        indPts += (c.ind?.length ?? 0) / 2;
        if (c.tint) {
          tintChunks += 1;
          tintVerts += c.tint.pos.length / 3;
        }
        if (c.cls) clsChunks += 1;
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
      vegPts,
      waterPts,
      indPts,
      tintChunks,
      tintVerts,
      clsChunks,
      parcelPts,
      // Round 21 (B) — streaming telemetry for E CERT. Additive, unflagged.
      parked: false,
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
