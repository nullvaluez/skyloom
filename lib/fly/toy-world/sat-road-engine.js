import { markPhase } from '../frame-stats';
import { budgetK } from '../harness-budget';
import { mayFinalize } from '../finalize-pace';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { BEND_LEAD, GLOBE, SAT_ROADS, STREAM_KEEPER, SUBURB_NIGHT } from '../fly-constants';
import {
  applyBendRoadSat,
  getSatRoadNight,
  groundOverlayOffset,
  setSatRoadClock,
  setSatRoadMix,
} from './world-bend';

// Must match vector-tile.worker.js WORKER_PROTOCOL (round 16 → 13). Round 16
// ADDED the 'sat-roads' detail; a stale protocol-12 worker has no such branch,
// so the string falls through its dispatch to the FULL TOY pipeline and it
// answers with a land/water/building toy bundle that has no `satRoads` key at
// all. Reading a toy bundle as roads is meaningless, so ANY v-mismatch is
// DROPPED here (dev-warn once, render nothing) — the R15 sat-building sentinel
// contract, for the same reason: no crash, no wrong pixels, and the warn tells
// the dev to hard-reload.
// Round 18 → 14: the worker gained 'sat-skyline'/'sat-veg' + new sat-buildings
// output keys. Roads are byte-unchanged; this pin moves in lockstep so a v13
// worker (which cannot answer the new details at all) is still correctly read
// as stale here.
// Round 19 → 15: scaffolding lockstep (six pin sites, one diff). Roads are
// byte-unchanged at bump time; C GROUNDTRUTH adds day terms later in-round.
// Round 21 → 17: scaffolding lockstep (six pin sites, one diff). Roads are
// byte-unchanged at bump time; D PIPELINE adds empty-reason codes in-round.
const EXPECTED_WORKER_PROTOCOL = 18;
let _warnedProtocol = false;

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

// Chunk GPU uploads per frame (spike guard — the SAT_BUILDINGS.finalizePerFrame
// discipline; a road chunk is one merged geometry, so one per frame is plenty).
const FINALIZE_PER_FRAME = 1;

// --- Round 21 (B STREAMKEEPER) ---------------------------------------------
// P1: world-bend's vertex shader drops every vertex by d²·k (world-bend.js
// :298-309) and the CPU bounding sphere is computed on the UNBENT buffer, so an
// on-screen chunk gets frustum-culled as the camera turns. Measured here: the
// z13 road ring's worst-case drop is ~21% of a chunk's sphere radius. k is the
// MAXIMUM (GLOBE.altFlatten only flattens it with altitude), so the margin errs
// toward keeping geometry. Precedent: SatParcelHomes.jsx:29/683.
// Every helper is inert with STREAM_KEEPER.enabled false (margin exactly 0,
// retryAt Infinity ⇒ today's sticky-empty behaviour).
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

function bendMarginM(ringAliveR, chunkHalfDiagM) {
  const B = STREAM_KEEPER.bendMargin;
  if (!STREAM_KEEPER.enabled || !B.enabled) return 0;
  // R24 B (BEND_LEAD, recon WB-6) — the residual R21 left. The desired set is
  // centred on the LOOKAHEAD point, so a chunk stays alive out to
  // (1 + maxLeadFrac)·ringR from the player, while this pad was computed from
  // plain ringR. The shader's drop is quadratic in that distance, so a 35%
  // radius excess is ~82% more drop than the sphere was padded for — an
  // on-screen chunk frustum-culled while turning AT SPEED. R21's census ran on
  // the ORBIT phase (speed 0 ⇒ lead 0) and could not see it. Flag-off the
  // multiplier is exactly 1 and this line is the R21 body verbatim.
  const leadMul = BEND_LEAD.enabled ? 1 + (STREAM_KEEPER.lookahead?.maxLeadFrac ?? 0) : 1;
  const d = ringAliveR * leadMul + chunkHalfDiagM;
  return d * d * MAX_BEND_K * B.pad;
}

function jitter1() {
  const j = STREAM_KEEPER.retry.jitter;
  return 1 + (Math.random() * 2 - 1) * j;
}

// P2 — D PIPELINE's reason contract: 'no-data' (upstream 404/204) may be asked
// again after a TTL; 'zero' (parsed, admitted nothing) is deterministic and
// never is; undefined is a LEGACY worker ⇒ sticky, exactly as today.
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
 * Round 16 (A2 "GND-W") — the SATELLITE ground-light network chunk manager.
 *
 * Structurally a SatBuildingEngine: a lean single-ring streamer around the
 * player that is PURPOSE-BUILT (never ToyWorldEngine — that class is what
 * ToyWorldLayer publishes as window.__toyWorld, which verify-round11 gate A
 * asserts stays undefined in satellite). SatRoadLayer publishes this one as
 * window.__satRoads.
 *
 * Each streamed z13 tile → one worker 'sat-roads' build → ONE merged additive
 * mesh (one draw) carrying the whole local road web AND its airports' runway
 * edge lights. The worker emits flat ribbons at y=0; this class drapes them on
 * a per-chunk bilinear RAW-DEM grid (the toy drape pattern — a road network
 * spans kilometres and must follow the relief; the per-building exact-centroid
 * sampling the building engine uses has no meaning for a polyline) plus a small
 * `liftM` so the ribbons sit over the imagery instead of z-fighting it.
 *
 * Everything that MOVES on those ribbons — the steady night glow, streetlight
 * dots, headlight dash trains, the day glint, runway lights — is a fragment
 * term on the ONE shared material (world-bend `applyBendRoadSat`), driven by
 * uniforms this class writes each frame. The sun therefore never changes the
 * draw count: the same geometry is submitted at noon and at midnight.
 *
 * Differences from the building ring that are deliberate:
 *   • z13 / r12000 (≈9.6 km at Owens Valley) — no tile-URL overlap with the
 *     z14 building ring, and one z13 tile holds a whole town's grid.
 *   • cullAglOnM 4200 / cullAglOffM 5200 — the light NETWORK stays legible far
 *     above the altitude at which individual buildings stop reading.
 *   • depthWrite off / depthTest ON + renderOrder 3: additive glow that still
 *     hides behind terrain it is genuinely behind.
 *
 * PUBLIC CONTRACT (frozen — SatRoadLayer, Wave 2, consumes exactly this):
 *   new SatRoadEngine({ groundAt })
 *   setWorker(api) · notifyWarp(nowSec) ·
 *   update(nowSec, playerX, playerZ, eyeAglM, sunFrac) ·
 *   get stats · .object · dispose()
 */
export class SatRoadEngine {
  constructor({ groundAt }) {
    this.object = new Group();
    this.object.name = 'sat-roads';
    this.groundAt = groundAt; // (lonDeg, latDeg) => {elev, tileZ} | null
    this.worker = null;

    // ONE material shared by every chunk. MeshBasic: the network is EMISSIVE
    // (street lighting), not lit — a scene light on it would make the glow
    // swing with the sun twice. Additive + depthWrite:false so overlapping
    // ribbons at a junction brighten instead of z-fighting, depthTest:true so a
    // ridge still occludes the town behind it. Vertex colors carry the baked
    // class hue; the fragment terms multiply it.
    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      // R24 C (SHADOW_CALM / recon T11): the ribbons are draped on a 16x16
      // bilinear grid at demZ 12 and depth-tested against the z15 tile mesh, so
      // on ground tilted away from the eye they lose the test and drop out.
      // Null (spread of nothing) with the flag off — this literal is then
      // byte-identical to R21.
      ...(groundOverlayOffset(-1, -1) ?? {}),
    });
    // Round 19 (C GROUNDTRUTH): SUBURB_NIGHT rides in as the third argument —
    // the cls 5-6 streetlight envelope and the daylight seam. Passing the
    // block (rather than reading it inside world-bend) keeps world-bend
    // constants-free, the horizonFade/roadNightRamp precedent. Disabled ⇒
    // world-bend leaves both uniforms at their additive identity.
    applyBendRoadSat(this.material, SAT_ROADS, SUBURB_NIGHT);

    this.chunks = new Map(); // key "z/x/y" -> chunk record
    this.queue = [];
    this.building = 0;
    this.pendingFinalize = [];
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
    this._ringOn = false; // altitude hysteresis (armed = roads streaming)
    this._warpCoarseUntil = 0;
    this._disposed = false;
    // --- Round 21 (B STREAMKEEPER) ------------------------------------------
    this._now = 0; // the frame clock, readable from async build callbacks
    this._heal = new Map(); // P6: per-key heal-evict attempts (was uncapped)
    this._reqId = 0; // build generation (kills the evict-then-requeue race)
    this._stat = { errorRetries: 0, evictions: 0, heals: 0 };
    this._vx = 0;
    this._vz = 0;
    this._velT = undefined;
    this._velPx = undefined;
    this._velPz = undefined;
    this._leadHoldUntil = 0;
  }

  setWorker(workerApi) {
    this.worker = workerApi;
    this._disposed = false;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
  }

  notifyWarp(nowSec) {
    this._warpCoarseUntil = nowSec + SAT_ROADS.warpCoarseWindowSec;
    this._leadHoldUntil = nowSec + STREAM_KEEPER.lookahead.warpHoldSec; // R21 §3.4
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

  /**
   * Per-frame. playerX/Z absolute world; eyeAglM = eye altitude above ground;
   * sunFrac = runtime.sun.frac (1 = noon, 0 = night). The two uniform writes are
   * unconditional (they are two scalar assignments — cheaper than the branch
   * that would skip them) and happen even while the ring is culled, so the very
   * first chunk that streams in is already at the right time of day.
   */
  update(nowSec, playerX, playerZ, eyeAglM, sunFrac) {
    if (this._disposed) return;
    setSatRoadClock(nowSec);
    setSatRoadMix(sunFrac);
    if (!this.worker) return;
    this._now = nowSec;
    this._trackVel(nowSec, playerX, playerZ);
    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > SAT_ROADS.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > SAT_ROADS.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ, eyeAglM, nowSec);
    }
    this._pumpQueue();
    this._drapePending();
    this._finalizePending(nowSec);
  }

  // --- desired set: single z13 ring, altitude-gated with hysteresis -----------
  _refreshDesired(px0, pz0, eyeAglM, nowSec = 0) {
    const S = SAT_ROADS;
    // R21 (§3.4): ring centred slightly ahead at speed; identical at rest.
    const [px, pz] = this._leadCenter(nowSec, px0, pz0, S.ring.r);
    if (this._ringOn) {
      if (eyeAglM > S.cullAglOffM) this._ringOn = false;
    } else if (eyeAglM < S.cullAglOnM) {
      this._ringOn = true;
    }
    if (!this._ringOn) {
      for (const [key, chunk] of this.chunks) this._evict(key, chunk);
      this.queue.length = 0;
      this.pendingFinalize.length = 0;
      return;
    }

    const z = S.ring.z;
    const r = S.ring.r;
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
        desired.push({
          z,
          x: tx,
          y: ty,
          detail: 'sat-roads',
          distSq: (cx - px) ** 2 + (cz - pz) ** 2,
        });
      }
    }
    desired.sort((a, b) => a.distSq - b.distSq);
    const kept = desired.slice(0, S.maxChunks); // nearest win — hard draw bound
    const keep = new Set(kept.map((e) => `${e.z}/${e.x}/${e.y}`));

    for (const [key, chunk] of this.chunks) {
      if (!keep.has(key)) {
        this._evict(key, chunk);
        this._heal.delete(key); // R21 (P6): the counter dies with the ring
      }
    }
    // Heal coarse-accepted chunks once real DEM answers at their center.
    // R21 (P6): CAPPED per key. The `coarse` flag is measured over the whole
    // (G+1)² drape grid but this test samples only the tile CENTRE, so a chunk
    // straddling a DEM-coverage boundary passes the test, rebuilds, comes back
    // coarse and evicts again — every 2 s, forever, on exactly the tiles at a
    // data seam. Bounding it is what stops a road network from re-streaming
    // under the player for the whole session.
    let healed = 0;
    for (const [key, chunk] of this.chunks) {
      if (healed >= 2 || !chunk.coarse || chunk.state !== 'ready' || !chunk.tile) continue;
      if (STREAM_KEEPER.enabled && (this._heal.get(key) ?? 0) >= STREAM_KEEPER.healCap) continue;
      const t = chunk.tile;
      const wx = -half + t.x * span + span / 2;
      const wz = -(half - t.y * span) + span / 2;
      const s = this.groundAt(
        (wx / EARTH_R) * RAD2DEG,
        (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG
      );
      if (s && s.tileZ >= S.demZ) {
        this._heal.set(key, (this._heal.get(key) ?? 0) + 1);
        this._stat.heals += 1;
        this._evict(key, chunk);
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
    this.pendingFinalize = this.pendingFinalize.filter((p) => keep.has(p.key));
  }

  _pumpQueue() {
    while (this.building < SAT_ROADS.maxBuilds && this.queue.length > 0) {
      const e = this.queue.shift();
      const key = `${e.z}/${e.x}/${e.y}`;
      const prev = this.chunks.get(key);
      // R21 (P2): flag off, `_readmit` never fires ⇒ this is the unchanged
      // `if (this.chunks.has(key)) continue;`.
      if (prev && !prev._readmit) continue;
      this._reqId += 1;
      const reqId = this._reqId;
      if (prev?.state === 'error') this._stat.errorRetries += 1;
      this.chunks.set(key, {
        state: 'building',
        mesh: null,
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
          // Sentinel: a stale worker predates the 'sat-roads' detail entirely
          // and answers with a TOY bundle (land/water/building keys, no
          // satRoads) — DROP it, never try to read those arrays as roads.
          if (result && result.v !== EXPECTED_WORKER_PROTOCOL) {
            if (process.env.NODE_ENV === 'development' && !_warnedProtocol) {
              _warnedProtocol = true;
              console.warn(
                `[sat-roads] worker protocol ${result.v} != expected ${EXPECTED_WORKER_PROTOCOL} ` +
                  '(stale worker after HMR/dev-server restart?) — roads skipped; hard-reload to refresh.'
              );
            }
            chunk.state = 'empty';
            // R21 (P2): a protocol-stale bundle is DETERMINISTIC for this
            // session (the worker cannot un-stale itself) ⇒ 'zero', never
            // re-asked — the same answer the legacy path gave, now labelled.
            chunk.reason = 'zero';
            chunk.retryAt = Infinity;
            return;
          }
          // No satRoads key = open ocean, an all-tunnel tile, or the worker's
          // minFeatures floor shedding a sparse rural tile. All three mean the
          // same thing here: this chunk costs zero draws.
          if (!result || result.empty || !result.satRoads) {
            chunk.state = 'empty';
            // R21 (P2): keep the record and stamp WHY. 'no-data' (upstream
            // 404/204) earns a TTL re-ask — a tile that 404'd during an
            // upstream wobble used to stay a permanent hole in the road web
            // for the rest of the session. 'zero' and legacy stay sticky.
            chunk.reason = result?.reason;
            chunk.emptyAt = this._now;
            chunk.retryAt = emptyRetryAt(this._now, chunk.reason);
            return;
          }
          chunk.state = 'draping';
          this.pendingFinalize.push({ key, tile: e, result, grid: null, gi: 0 });
        })
        .catch((err) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (chunk && chunk.state === 'building' && chunk.reqId === reqId) {
            if (!STREAM_KEEPER.enabled || !STREAM_KEEPER.retry.enabled) {
              this.chunks.delete(key); // legacy: re-requested every refresh
            } else {
              // R21 (P2): capped jittered backoff instead of an unbounded 2 s
              // hammer on an upstream that is already failing.
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
            console.warn(`[sat-roads] build ${key} failed:`, err?.message ?? err);
        });
    }
  }

  // --- drape: budgeted per-CHUNK bilinear RAW-DEM grid ------------------------
  // A road is a long polyline, not a footprint: it must FOLLOW the relief, so
  // this samples the toy-style (G+1)² grid over the tile and interpolates per
  // vertex at finalize (the worker already subdivided any run longer than
  // maxSegM so the interpolation has vertices to act on). RAW DEM — no toy
  // ×1.7 exaggeration (the R11 monuments lesson: satellite ground is raw).
  _drapePending() {
    if (this.pendingFinalize.length === 0) return;
    const t0 = performance.now();
    const G = SAT_ROADS.gridSegments;
    const N = (G + 1) * (G + 1);
    for (const p of this.pendingFinalize) {
      if (!p.grid) {
        p.grid = new Float32Array(N);
        p.gi = 0;
        p.nulls = 0;
      }
      const span = WORLD_SIZE / 2 ** p.tile.z;
      const minX = -WORLD_SIZE / 2 + p.tile.x * span;
      const minZ = -(WORLD_SIZE / 2 - p.tile.y * span);
      while (p.gi < N) {
        const gx = p.gi % (G + 1);
        const gz = (p.gi / (G + 1)) | 0;
        const wx = minX + (gx / G) * span;
        const wz = minZ + (gz / G) * span;
        const lon = (wx / EARTH_R) * RAD2DEG;
        const lat = (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG;
        const s = this.groundAt(lon, lat);
        // A low-zoom fallback tile "answers" with plateau garbage — count it as
        // a miss so the finalize gate holds until real DEM streams in.
        if (!s || s.tileZ < SAT_ROADS.demZ) p.nulls += 1;
        p.grid[p.gi] = s?.elev ?? 0;
        p.gi += 1;
        if (performance.now() - t0 > SAT_ROADS.drapeBudgetMs * budgetK()) return;
      }
    }
  }

  // --- finalize: apply drape + upload one merged additive mesh ----------------
  _finalizePending(nowSec = 0) {
    const S = SAT_ROADS;
    const G = S.gridSegments;
    const N = (G + 1) * (G + 1);
    let done = 0;
    // R24 A (for E CERT) — the SEVENTH harness-budget site, and the one the
    // scaler missed. Every other engine reads `perFrame * budgetK()`; this
    // bound was a bare module const, so at K=40/200 every other engine sped up
    // and roads did not. E's frame-pace row attributed the pass's longest stall
    // — 3660 ms under [finalize:sat-roads x16] — to exactly that starvation,
    // which is also why markPhase pointed here. `budgetK()` is exactly 1 unless
    // a harness sets FLY_FINALIZE_BUDGET_K, so the production arithmetic is
    // byte-identical; the `Math.max(1, ...)` mirrors the veg site (59b4e97).
    const perFrame = Math.max(1, FINALIZE_PER_FRAME * budgetK());
    for (let i = 0; i < this.pendingFinalize.length && done < perFrame; i++) {
      // R24 A (FINALIZE_PACE, recon WB-3): the shared per-frame brake. A
      // SEPARATE guard, deliberately not folded into the loop bound, so it
      // composes with any other multiplier on that expression.
      if (!mayFinalize(done)) break;
      markPhase('finalize:sat-roads'); // R24 A: E's FRAME_STATS attribution
      const p = this.pendingFinalize[i];
      if (!p.grid || p.gi < N) continue; // still sampling
      const badFrac = (p.nulls ?? 0) / N;
      const maxTries = nowSec < (this._warpCoarseUntil ?? 0) ? S.warpCoarseTries : S.drapeMaxTries;
      if (badFrac > 0.05 && (p.tries ?? 0) < maxTries) {
        if (nowSec >= (p.retryAt ?? 0)) {
          p.tries = (p.tries ?? 0) + 1;
          p.retryAt = nowSec + 1.5;
          p.gi = 0;
          p.nulls = 0;
        }
        continue;
      }
      const coarseAccepted = badFrac > 0.05;
      this.pendingFinalize.splice(i, 1);
      i -= 1;
      done += 1;
      const chunk = this.chunks.get(p.key);
      if (!chunk || chunk.state !== 'draping') continue;
      chunk.coarse = coarseAccepted; // healed later when real DEM arrives
      chunk.tile = p.tile;

      const span = WORLD_SIZE / 2 ** p.tile.z;
      const cx = -WORLD_SIZE / 2 + p.tile.x * span + span / 2;
      const cz = -(WORLD_SIZE / 2 - p.tile.y * span) + span / 2;
      const grid = p.grid;
      const w = G + 1;
      const height = (lx, lz) => {
        // bilinear over the chunk grid; local coords are tile-center origin
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
        return (
          h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz
        );
      };

      const rd = p.result.satRoads;
      const pos = rd.pos; // mutate in place (transferred, owned here)
      for (let v = 0; v < pos.length; v += 3) {
        // the worker wrote y = 0 exactly; this ASSIGNS the draped ground + lift
        pos[v + 1] = height(pos[v], pos[v + 2]) + S.liftM;
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(rd.col, 3));
      // FAIL DARK — what each attribute reads as if it ever went missing:
      //   aRoadCls absent → 0 → the shader's 8-entry class LUT index 0, which is
      //     RESERVED at weight 0 → every light term multiplies to black, and
      //     black on an ADDITIVE material is invisible. This is the guard that
      //     matters: no wrong pixels, no flat-lit slab over the imagery.
      //   aRoadArc absent → 0 → every dash/lamp phase pins at 0 (a static
      //     pattern), but it can never be seen because the cls gate above is
      //     what turns a fragment on at all.
      //   `color` absent → three's default white → would only matter if cls also
      //     survived, i.e. never.
      // A bundle without these arrays cannot reach here anyway: a protocol
      // mismatch is dropped in _pumpQueue, and a v13 bundle always carries all
      // five arrays or no satRoads key at all.
      geo.setAttribute('aRoadArc', new BufferAttribute(rd.arc, 1));
      geo.setAttribute('aRoadCls', new BufferAttribute(rd.cls, 1));
      geo.setIndex(new BufferAttribute(rd.idx, 1));
      geo.computeBoundingSphere();
      // R21 (P1) — THE BEND MARGIN. The shader drops these ribbons by d²·k and
      // the sphere above knows nothing about it, so a road chunk at the ring
      // edge false-culls as the camera turns (measured ~21% of its radius here).
      // Worst case for this ring = its evict radius + the tile's half-diagonal.
      const rpad = bendMarginM(S.ring.r, (span * Math.SQRT2) / 2);
      if (geo.boundingSphere) geo.boundingSphere.radius += rpad;
      const mesh = new Mesh(geo, this.material);
      mesh.userData.bendMarginM = rpad; // R21 SANCTIONED INSTRUMENT (E CERT)
      mesh.position.set(cx, 0, cz);
      mesh.frustumCulled = true;
      mesh.renderOrder = 3; // additive, after the opaque tiles/buildings
      this.object.add(mesh);
      chunk.mesh = mesh;
      chunk.state = 'ready';
    }
  }

  _evict(key, chunk) {
    if (chunk.mesh) {
      this.object.remove(chunk.mesh);
      chunk.mesh.geometry.dispose(); // shared material — geometry only
      chunk.mesh = null;
    }
    this._stat.evictions += 1; // R21: E CERT reads this off engine.stats
    this.chunks.delete(key);
  }

  /** Dev telemetry (window.__satRoads.stats / __flyStats.satRoads). */
  get stats() {
    let ready = 0; // = ROAD draw calls (one merged mesh per non-empty chunk)
    let empty = 0;
    for (const c of this.chunks.values()) {
      if (c.mesh) ready += 1;
      if (c.state === 'empty') empty += 1;
    }
    return {
      chunks: this.chunks.size,
      ready,
      empty,
      queued: this.queue.length,
      building: this.building,
      draping: this.pendingFinalize.length,
      ringOn: this._ringOn,
      // Round 19 (C): the live SUBURB_NIGHT road uniforms + the FINAL program
      // cache key, surfaced for verify-groundlife. Read back off the material
      // the GPU is using, not off the constants — that is what makes it a
      // wiring gate rather than a restatement of the config file.
      night: getSatRoadNight(),
      cacheKey: this.material.customProgramCacheKey?.() ?? null,
      // Round 21 (B) — streaming telemetry for E CERT. Additive, unflagged.
      emptyByReason: emptyByReason(this.chunks),
      errorRetries: this._stat.errorRetries,
      evictions: this._stat.evictions,
      heals: this._stat.heals,
    };
  }

  dispose() {
    this._disposed = true;
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this.pendingFinalize.length = 0;
    this._heal.clear();
    this.material.dispose();
  }
}
