import { markPhase } from '../frame-stats';
import { mayFinalize } from '../finalize-pace';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { BEND_LEAD, CHUNK_FADE, GLOBE, SAT_BLDG_FADE, SAT_BUILDINGS, SAT_SKYLINE, STREAM_KEEPER } from '../fly-constants';
import { applyBendAnchorSatSkyline, setSatSkyline } from './world-bend';
// R24 (E CERT): harness-only per-frame budget scaler — exactly 1 in production.
import { budgetK } from '../harness-budget';
// R24 B (FLASH_GUARD, recon WB-1/A1b) — zero-area triangle filter at finalize.
import { censusDegenerate, guardIndex } from './flash-guard';
// R24 B (CHUNK_FADE, recon WB-2/A6) — per-mesh birth / deferred-evict ramps.
import { TwinPool, chunkFadeOn, fadeRamp } from './chunk-fade';

// Must match vector-tile.worker.js WORKER_PROTOCOL. A1 froze the 'sat-skyline'
// branch at protocol 14; a v13 worker (a stale HMR/dev-restart pairing) has no
// such branch at all and would answer `{empty:true}` forever, so the drop is
// belt-and-braces — but it is the SAME drop-and-warn contract the other three
// satellite engines take, and it is the honest read of "stale worker": render
// nothing, never wrong pixels, one dev warn telling the dev to hard-reload.
// Round 19 → 15: scaffolding lockstep (six pin sites, one diff). A HOMESTEAD
// re-arms the area hatch this round; a v14 worker predates it.
// Round 21 → 17: scaffolding lockstep (six pin sites, one diff). D PIPELINE
// re-orders skyline selection (hash shuffle + hatch ramp) this round — a v16
// bundle's members were picked by the R20 rule and must not mix.
const EXPECTED_WORKER_PROTOCOL = 18;
let _warnedProtocol = false;

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

const smoothstep01 = (v) => {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
};

// --- Round 21 (B STREAMKEEPER) ---------------------------------------------
// P1: this engine is the ONLY one that already padded its bounding sphere for
// the shader-side bend (SK.cullMarginM 1200, with the comment right below).
// That constant is not derived from anything: the real worst case is
// (ring evict radius + group half-diagonal)² · k, which for the shipped z14 ×
// groupN 2 ring is ~1.5 km — i.e. 1200 is an UNDERSHOOT and far groups can
// still false-cull at the screen edge. Under the flag the computed value takes
// over; with it off the frozen 1200 rules exactly as before.
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

function bendMarginM(ringAliveR, chunkHalfDiagM) {
  const B = STREAM_KEEPER.bendMargin;
  if (!STREAM_KEEPER.enabled || !B.enabled) return SAT_SKYLINE.cullMarginM;
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
  return Math.max(SAT_SKYLINE.cullMarginM, d * d * MAX_BEND_K * B.pad);
}

function jitter1() {
  const j = STREAM_KEEPER.retry.jitter;
  return 1 + (Math.random() * 2 - 1) * j;
}

/**
 * P2 — a group whose children failed earns a capped, jittered rebuild. Every
 * typed throw from D PIPELINE lands here and is retryable in this one class:
 * `http-<code>` (5xx/429) and `http-timeout` (D's 12 s AbortController — a
 * stalled connection previously held an in-flight slot for minutes, leaving a
 * quarter of a merged city block missing with no error to retry against).
 */
function groupRetryAt(nowSec, attempts) {
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
 * Round 18 (A2 "SKYLINE") — the DISTANT BLOCK-MASS streamer.
 *
 * WHY IT EXISTS. The satellite city ended at the detail ring's 3.6 km-unit
 * bubble and then vanished outright above ~2.4 km AGL (SAT_BLDG_FADE dithers
 * SatBuildingEngine's chunks away and evicts them). Both reads are "the world
 * is a small disc I am standing on". This engine draws the SAME city as
 * untextured block mass, far out and high up, and hands the near field back to
 * the detail ring through a dither hole that CLOSES exactly as the detail ring
 * fades — so climbing out of a city turns it into a skyline instead of deleting
 * it.
 *
 * WHAT IT IS. SatBuildingEngine's skeleton minus everything near-field: no
 * water, no facade atlas, no night windows, no collision columns, no per-
 * building DEM sampling. Two structural differences:
 *
 *  1. A CHUNK IS A GROUP OF TILES. One z14 tile is 2446 world units across, so
 *     a 10-draw ring of single tiles would reach 4.4 km — barely past the
 *     detail bubble it is supposed to rescue. A chunk here is a
 *     groupN×groupN block of z14 tiles MERGED into one geometry: same draw
 *     budget, groupN× the reach (SAT_SKYLINE.groupN documents the arithmetic).
 *     The z14 source is not a choice — A1 measured z13's `building` layer as a
 *     single pre-merged blob per tile that the mega-block guard discards.
 *  2. THE DRAPE IS A PER-GROUP BILINEAR DEM GRID, not one getGroundAt per
 *     building. 40 tiles × up to 300 blocks is 12,000 exact samples for
 *     geometry whose nearest pixel is 4 km away; a (drapeGridN+1)² grid over
 *     the group is ~169 samples for the same visual answer (its worst error is
 *     the relief inside one ~400 m cell, sub-pixel at this range). The near
 *     ring's exact-centroid drape stays exact — it is the one that has to sit
 *     level on an SF hill you can see out the window.
 *
 * INVARIANTS (both pinned by scripts/verify-skyline.js):
 *  • An EMPTY group ISSUES NO MESH. Owens Valley must stay flat at its measured
 *    draw count — no zero-triangle meshes, no zero-count instancing.
 *  • Off-satellite / low tier / SAT_SKYLINE.enabled false, this class is never
 *    constructed (the FlyScene mount gate) — the flag is a true byte-noop.
 */
export class SatSkylineEngine {
  constructor({ groundAt }) {
    this.object = new Group();
    this.object.name = 'sat-skyline';
    this.groundAt = groundAt; // (lonDeg, latDeg) => {elev, tileZ} | null
    this.worker = null;

    // ONE material for every group. Vertex colours carry the worker's pre-hazed
    // tone (aerial perspective baked at build time — no per-fragment fog term
    // needed), DoubleSide covers the source data's inconsistent ring winding,
    // and the scene's day sun/hemi/env shade it exactly like the near ring so
    // the two cities agree across the crossfade.
    //
    // NO `map`, EVER: the 'sat-skyline' bundle carries no uv array, and a
    // missing attribute reads (0,0) on the GPU — the R15 window-on-every-roof
    // trap. The facade atlas is a near-field read anyway; at 8 km a window grid
    // is aliasing noise.
    this.material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    applyBendAnchorSatSkyline(this.material);

    // --- R24 B (CHUNK_FADE) — see chunk-fade.js. A ramping group wears a
    // POOLED TWIN of the material above with its OWN uSkyFade; uSkyHole stays
    // module-shared (the hole is one geometric law for every group). Same
    // parameters, no `map` on either, same cache key ⇒ same program, refcounted.
    this._fadePool = new TwinPool(() => {
      const uniform = { value: 1 };
      const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
      applyBendAnchorSatSkyline(material, uniform);
      return { material, uniform };
    });
    this._births = [];
    this._dying = [];
    this._skyFade = 1; // the ring's own altitude cull this frame
    this._hardEvict = false;

    this.chunks = new Map(); // key "z/gx/gy" -> group record
    this.queue = [];
    this.building = 0; // in-flight TILE builds (a group issues groupN² of them)
    this._gen = 0; // monotonic chunk id — see the evict-then-requeue race below
    this.pendingFinalize = [];
    this.maxChunks = 0; // tier-driven (SatSkylineLayer sets it before the first update)
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
    this._ringOn = false;
    this._warpCoarseUntil = 0;
    this._disposed = false;
    // --- Round 21 (B STREAMKEEPER) ------------------------------------------
    this._now = 0;
    this._gRetry = new Map(); // P2: per-group rebuild attempts (survives evict)
    // R24 B: degenerateDropped is additive telemetry (0 with FLASH_GUARD off).
    this._stat = { errorRetries: 0, evictions: 0, heals: 0, degenerateDropped: 0, fadeBudgetMiss: 0 };
    // P10: `mesh.visible` used to be recomputed EVERY frame from a live
    // AGL-driven hole radius, so pitch noise around the crossfade blinked
    // 4.9 km blocks on and off. These damp the re-evaluation.
    this._visHole = -1;
    this._visT = -1;
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

  /** Tier gate (SatSkylineLayer): SAT_SKYLINE.maxChunksByTier → group cap. */
  setMaxChunks(n) {
    if (n === this.maxChunks || this._disposed) return;
    this.maxChunks = n;
    if (n <= 0) {
      for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
      this.queue.length = 0;
      this.pendingFinalize.length = 0;
    }
    this._lastRefreshPos = { x: Infinity, z: Infinity }; // re-evaluate next update
  }

  setWorker(workerApi) {
    this.worker = workerApi;
    this._disposed = false;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
  }

  notifyWarp(nowSec) {
    this._flushFades(); // R24 B: a warp is a cut, never a crossfade
    this._warpCoarseUntil = nowSec + SAT_SKYLINE.warpCoarseWindowSec;
    this._lastRefreshPos = { x: Infinity, z: Infinity }; // stream the destination now
    this._leadHoldUntil = nowSec + STREAM_KEEPER.lookahead.warpHoldSec; // R21 §3.4
    this._visHole = -1; // …and re-evaluate visibility at the destination at once
  }

  /**
   * Per-frame, from SatSkylineLayer's useFrame. playerX/Z absolute world;
   * eyeAglM = eye altitude above ground; refGroundY = the player's ground
   * elevation, used as the fallback when a far DEM sample has not streamed yet
   * (0 would sink Denver's skyline 1.6 km underground).
   */
  update(nowSec, playerX, playerZ, eyeAglM, refGroundY = 0) {
    if (this._disposed) return;
    this._now = nowSec;
    const { holeRadiusM, fade } = this._writeChoreography(eyeAglM);
    this._updateVisibility(playerX, playerZ, holeRadiusM, fade, nowSec);
    this._stepFades(nowSec); // R24 B (CHUNK_FADE) — before the worker guard so
    // a ramp always completes even if the worker handle is gone.
    if (!this.worker) return;
    this._trackVel(nowSec, playerX, playerZ);
    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > SAT_SKYLINE.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > SAT_SKYLINE.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ, eyeAglM, nowSec);
    }
    this._pumpQueue();
    this._drapePending(refGroundY);
    this._finalizePending(nowSec);
  }

  // --- the crossfade choreography (two uniform writes) ------------------------
  // HOLE: full radius while the detail ring is solid, easing to EXACTLY 0 across
  // the detail ring's OWN dissolve band — read live from SAT_BLDG_FADE so the
  // two can never drift apart (with that block disabled the detail ring hard-
  // evicts across SAT_BUILDINGS.cullAgl*, so the hole follows that band
  // instead). At 0 the shader's hole branch is skipped entirely.
  // FADE: this ring's own altitude cull, 1 → 0 across SAT_SKYLINE.fade.
  _writeChoreography(eyeAglM) {
    const SK = SAT_SKYLINE;
    const F = SAT_BLDG_FADE;
    const lo = F.enabled ? F.fadeStartAglM : SAT_BUILDINGS.cullAglOnM;
    const hi = F.enabled ? F.fadeEndAglM : SAT_BUILDINGS.cullAglOffM;
    const open = smoothstep01((eyeAglM - lo) / Math.max(1, hi - lo));
    const fade = 1 - smoothstep01((eyeAglM - SK.fade.startM) / Math.max(1, SK.fade.endM - SK.fade.startM));
    const holeRadiusM = SK.hole.radiusM * (1 - open);
    setSatSkyline(holeRadiusM, SK.hole.featherM, fade);
    this._skyFade = fade; // R24 B: per-mesh ramps MULTIPLY this, never replace it
    return { holeRadiusM, fade };
  }

  /**
   * A group whose FARTHEST corner still sits inside the hole has every one of
   * its anchors discarded — it is a draw call, a vertex shader pass and a full
   * fragment-kill for zero pixels. Park it. Same for the whole ring once the
   * far cull has dithered it away but before the eviction hysteresis fires.
   * One hypot per streamed group per frame, and `visible` is the cheapest
   * possible lever (three skips the mesh entirely). Conservative by
   * construction: at exactly holeRadiusM the shader's smoothstep is already 0.
   */
  _updateVisibility(px, pz, holeRadiusM, fade, nowSec = 0) {
    const g = Math.max(1, SAT_SKYLINE.groupN);
    // ROUND 21 (P10) — DAMP THE RE-EVALUATION. `holeRadiusM` is derived from
    // the LIVE eye-AGL, so inside the crossfade band it moves with every pitch
    // wobble and every metre of terrain under the aircraft — and a group whose
    // farthest corner sits within a few metres of the hole edge therefore
    // toggled `visible` at frame rate. A 4.9 km block of city blinking on and
    // off is the single most literal reading of the user's "everything will
    // flash, reappear, disappear". Re-evaluate only when the hole has actually
    // MOVED (visReevalM) or after visReevalSec — the crossfade band sweeps the
    // radius 4000 → 0, so it still re-evaluates ~27 times across the climb.
    // The two terminal states (fade 0 / hole closed) are exact and always
    // applied, so nothing can be left visible after the ring is culled.
    const H = STREAM_KEEPER.skylineHysteresis;
    if (
      STREAM_KEEPER.enabled &&
      fade > 0 &&
      holeRadiusM > 0 &&
      this._visHole >= 0 &&
      Math.abs(holeRadiusM - this._visHole) < H.visReevalM &&
      nowSec - this._visT < H.visReevalSec
    )
      return;
    this._visHole = holeRadiusM;
    this._visT = nowSec;
    for (const chunk of this.chunks.values()) {
      const mesh = chunk.mesh;
      if (!mesh) continue;
      if (fade <= 0) {
        mesh.visible = false;
        continue;
      }
      if (holeRadiusM <= 0) {
        mesh.visible = true;
        continue;
      }
      const gspan = (WORLD_SIZE / 2 ** chunk.group.z) * g;
      const dx = Math.max(Math.abs(px - (mesh.position.x - gspan / 2)), Math.abs(px - (mesh.position.x + gspan / 2)));
      const dz = Math.max(Math.abs(pz - (mesh.position.z - gspan / 2)), Math.abs(pz - (mesh.position.z + gspan / 2)));
      mesh.visible = Math.hypot(dx, dz) > holeRadiusM;
    }
  }

  // --- desired set: groups of z14 tiles, nearest-win, altitude hysteresis -----
  _refreshDesired(px0, pz0, eyeAglM, nowSec = 0) {
    const SK = SAT_SKYLINE;
    // ROUND 21 (P10) — WIDER EVICT/REARM HYSTERESIS, as a read-through override
    // (SAT_SKYLINE.fade is untouched and rules with the flag off). 9500/9200 is
    // a 300 m band at cruise: a shallow phugoid straddling ~9.35 km evicted and
    // re-streamed the ENTIRE ring — up to 40 tile fetches per crossing —
    // repeatedly. Both ends stay ABOVE fade.endM (9000), so all of that
    // streaming still happens while the ring is fully faded out and nothing
    // pops. NOTE: evictM is 10000, not the charter's 10500, because
    // verify-skyline pins the AGL cull with a FROZEN probe at 10,200 m
    // ("skyline evicts past its own AGL cull": ready === 0 && ringOn === false)
    // — 10500 would have moved a frozen assertion, which this round does not do.
    // 9200 → 10000 is still a 3.3× wider band.
    const evictM = STREAM_KEEPER.enabled ? STREAM_KEEPER.skylineHysteresis.evictM : SK.fade.evictM;
    const rearmM = STREAM_KEEPER.enabled ? STREAM_KEEPER.skylineHysteresis.rearmM : SK.fade.rearmM;
    if (this._ringOn) {
      if (eyeAglM > evictM) this._ringOn = false;
    } else if (eyeAglM < rearmM) {
      this._ringOn = true;
    }
    if (!this._ringOn || this.maxChunks <= 0) {
      for (const [key, chunk] of this.chunks) this._evict(key, chunk);
      this.queue.length = 0;
      this.pendingFinalize.length = 0;
      return;
    }

    const z = SK.ring.z;
    const r = SK.ring.r;
    // R21 (§3.4): ring centred slightly ahead at speed; identical at rest.
    const [px, pz] = this._leadCenter(nowSec, px0, pz0, r);
    const g = Math.max(1, SK.groupN);
    const span = WORLD_SIZE / 2 ** z;
    const gspan = span * g;
    const half = WORLD_SIZE / 2;
    const nGroups = Math.ceil(2 ** z / g);
    const gxMin = Math.floor((px - r + half) / gspan);
    const gxMax = Math.floor((px + r + half) / gspan);
    const gyMin = Math.floor((pz - r + half) / gspan);
    const gyMax = Math.floor((pz + r + half) / gspan);
    const desired = [];
    for (let gy = Math.max(0, gyMin); gy <= Math.min(nGroups - 1, gyMax); gy++) {
      for (let gx = Math.max(0, gxMin); gx <= Math.min(nGroups - 1, gxMax); gx++) {
        const minX = -half + gx * gspan;
        const minZ = -(half - gy * gspan);
        // group square [minX,maxX]×[minZ,maxZ] vs circle(px,pz,r). The SORT key
        // is that same closest-point distance, not the center distance: a
        // 4.9 km group whose near edge touches the player must stream before a
        // diagonal neighbour whose center happens to be nearer.
        const dx = Math.max(minX - px, 0, px - (minX + gspan));
        const dz = Math.max(minZ - pz, 0, pz - (minZ + gspan));
        const distSq = dx * dx + dz * dz;
        if (distSq > r * r) continue;
        desired.push({ z, gx, gy, distSq });
      }
    }
    desired.sort((a, b) => a.distSq - b.distSq);
    const kept = desired.slice(0, this.maxChunks);
    const keep = new Set(kept.map((e) => `${e.z}/${e.gx}/${e.gy}`));

    for (const [key, chunk] of this.chunks) {
      if (!keep.has(key)) {
        this._evict(key, chunk);
        this._gRetry.delete(key); // R21: the attempt counter dies with the ring
      }
    }
    // ROUND 21 (P2) — A GROUP'S HOLE IS NO LONGER PERMANENT. `_childDone` used
    // to treat a failed child as "one fewer pending" and nothing else: the
    // group merged whatever arrived and the missing tile's quarter of the city
    // was gone until the player flew out of the ring and back. One stale child
    // was worse still — it killed the whole 2×2 group forever. Both now carry a
    // `retryAt`, and this is where it is honoured: evict the record so the
    // ordinary queue filter below rebuilds the WHOLE group (the parts are
    // merged into one buffer, so there is no partial repair to make). The
    // attempt count survives the eviction in `_gRetry`, which is what keeps the
    // backoff monotone across rebuilds.
    if (STREAM_KEEPER.enabled && STREAM_KEEPER.retry.enabled) {
      for (const e of kept) {
        const key = `${e.z}/${e.gx}/${e.gy}`;
        const c = this.chunks.get(key);
        if (!c || c.state === 'building' || c.state === 'draping') continue;
        if (nowSec < (c.retryAt ?? Infinity)) continue;
        this._gRetry.set(key, (this._gRetry.get(key) ?? 0) + 1);
        this._stat.errorRetries += 1;
        this._evict(key, c);
      }
    }
    this.queue = kept.filter((e) => !this.chunks.has(`${e.z}/${e.gx}/${e.gy}`));
    this.pendingFinalize = this.pendingFinalize.filter((p) => keep.has(p.key));
  }

  // --- build: one group = groupN² worker tiles, collected then merged --------
  _pumpQueue() {
    const SK = SAT_SKYLINE;
    const g = Math.max(1, SK.groupN);
    while (this.building < SK.maxBuilds && this.queue.length > 0) {
      const e = this.queue.shift();
      const key = `${e.z}/${e.gx}/${e.gy}`;
      if (this.chunks.has(key)) continue;
      // `gen` closes the evict-then-requeue race: fly out of a group and back
      // inside one build's latency and the SAME key gets a NEW chunk record
      // while the old tiles are still in flight. Without the stamp those late
      // results decrement the new chunk's `pending` to zero early and it
      // finalizes with a fraction of its tiles — a quarter of a city block
      // missing, permanently, and only when the player doubles back.
      this._gen += 1;
      const gen = this._gen;
      const chunk = {
        state: 'building',
        mesh: null,
        group: e,
        pending: g * g,
        parts: [],
        stale: false,
        gen,
        // R21 (P2): per-group failure bookkeeping — see _childDone.
        failed: 0,
        sawNoData: false,
        retryAt: Infinity,
      };
      this.chunks.set(key, chunk);
      this.building += g * g;
      const span = WORLD_SIZE / 2 ** e.z;
      const nTiles = 2 ** e.z;
      for (let j = 0; j < g; j++) {
        for (let i = 0; i < g; i++) {
          const tx = e.gx * g + i;
          const ty = e.gy * g + j;
          // Tile-local geometry lands at the tile center; the merged mesh sits
          // at the GROUP center, so every part carries that constant offset.
          const dx = (i - (g - 1) / 2) * span;
          const dz = (j - (g - 1) / 2) * span;
          if (tx >= nTiles || ty >= nTiles) {
            this._childDone(key, gen, null, 0, 0, false); // off the world, not a failure
            continue;
          }
          this.worker
            .buildTile(e.z, tx, ty, 'sat-skyline')
            .then((result) => this._childDone(key, gen, result, dx, dz, false))
            .catch((err) => {
              this._childDone(key, gen, null, dx, dz, true); // R21: a REAL failure
              if (process.env.NODE_ENV === 'development')
                console.warn(`[sat-skyline] build ${e.z}/${tx}/${ty} failed:`, err?.message ?? err);
            });
        }
      }
    }
  }

  /** One tile of a group came back (or failed). Merge-time starts at pending 0. */
  _childDone(key, gen, result, dx, dz, failed = false) {
    this.building -= 1;
    const chunk = this.chunks.get(key);
    if (this._disposed || !chunk || chunk.gen !== gen || chunk.state !== 'building') return;
    if (failed) chunk.failed += 1; // R21 (P2)
    // R21 (P2): remember whether any child's emptiness was a recoverable
    // upstream 404/204 (D PIPELINE's 'no-data') rather than a real absence.
    if (result?.empty && result.reason === 'no-data') chunk.sawNoData = true;
    if (result && result.v !== undefined && result.v !== EXPECTED_WORKER_PROTOCOL) {
      chunk.stale = true;
      if (process.env.NODE_ENV === 'development' && !_warnedProtocol) {
        _warnedProtocol = true;
        console.warn(
          `[sat-skyline] worker protocol ${result.v} != expected ${EXPECTED_WORKER_PROTOCOL} ` +
            '(stale worker after HMR/dev-server restart?) — skyline skipped; hard-reload to refresh.'
        );
      }
    } else if (result && !result.empty && result.satSkyline) {
      chunk.parts.push({ sk: result.satSkyline, dx, dz });
    }
    chunk.pending -= 1;
    if (chunk.pending > 0) return;
    // R21 (P2) — WHEN MAY THIS GROUP BE ASKED AGAIN? Flag off, every branch
    // resolves to Infinity and the behaviour below is R18's exactly.
    const SKON = STREAM_KEEPER.enabled && STREAM_KEEPER.retry.enabled;
    const attempts = (this._gRetry.get(key) ?? 0) + 1;
    if (SKON) {
      if (chunk.stale) {
        // A stale worker is a dev/HMR pairing, not a data fact — and ONE stale
        // child used to kill the whole 2×2 group for the rest of the session.
        // Treat it as 'zero' with a SHORT ttl so a hard reload heals it.
        chunk.retryAt = this._now + 60 * jitter1();
      } else if (chunk.failed > 0) {
        chunk.retryAt = groupRetryAt(this._now, attempts); // capped backoff
      } else if (chunk.parts.length === 0 && chunk.sawNoData) {
        chunk.retryAt = this._now + STREAM_KEEPER.retry.noDataTtlSec * jitter1();
      } else {
        chunk.retryAt = Infinity; // deterministic 'zero' — THE OWENS CASE
      }
    }
    // THE OWENS INVARIANT: a group with nothing in it becomes 'empty' and never
    // gets a mesh — not an empty one, not a zero-triangle one. Desert tiles
    // therefore cost exactly zero draws. (R21 changes only WHEN it may be asked
    // again, never whether an empty group issues geometry.)
    if (chunk.stale || chunk.parts.length === 0) {
      chunk.state = 'empty';
      chunk.reason = chunk.stale ? 'zero' : chunk.sawNoData ? 'no-data' : 'zero';
      chunk.parts.length = 0;
      return;
    }
    chunk.state = 'draping';
    this.pendingFinalize.push({ key, gen, group: chunk.group, parts: chunk.parts, grid: null, gi: 0 });
  }

  // --- drape: budgeted (drapeGridN+1)² DEM grid per group --------------------
  _drapePending(refGroundY) {
    if (this.pendingFinalize.length === 0) return;
    const SK = SAT_SKYLINE;
    const t0 = performance.now();
    const g = Math.max(1, SK.groupN);
    const N = SK.drapeGridN;
    const total = (N + 1) * (N + 1);
    for (const p of this.pendingFinalize) {
      if (p.grid && p.gi >= total) continue; // this group's grid is complete
      const span = WORLD_SIZE / 2 ** p.group.z;
      const gspan = span * g;
      const half = WORLD_SIZE / 2;
      const minX = -half + p.group.gx * gspan;
      const minZ = -(half - p.group.gy * gspan);
      if (!p.grid) {
        p.grid = new Float32Array(total);
        p.gi = 0;
        p.bad = 0;
      }
      const step = gspan / N;
      while (p.gi < total) {
        const ix = p.gi % (N + 1);
        const iy = (p.gi / (N + 1)) | 0;
        const wx = minX + ix * step;
        const wz = minZ + iy * step;
        const s = this.groundAt(
          (wx / EARTH_R) * RAD2DEG,
          (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG
        );
        if (!s || s.tileZ < SK.demZ) {
          p.bad += 1;
          p.grid[p.gi] = refGroundY; // the player's own ground, never sea level
        } else {
          p.grid[p.gi] = s.elev; // RAW DEM — no toy exaggeration (the R11 rule)
        }
        p.gi += 1;
        if (performance.now() - t0 > SK.drapeBudgetMs * budgetK()) return;
      }
    }
  }

  // --- finalize: merge the group's tiles, apply the drape, upload one mesh ----
  _finalizePending(nowSec = 0) {
    const SK = SAT_SKYLINE;
    const g = Math.max(1, SK.groupN);
    const N = SK.drapeGridN;
    const total = (N + 1) * (N + 1);
    if (this.pendingFinalize.length) markPhase('finalize:sat-skyline'); // R24 B
    let done = 0;
    for (let i = 0; i < this.pendingFinalize.length && done < SK.finalizePerFrame * budgetK(); i++) {
      // R24 A (FINALIZE_PACE, recon WB-3): the shared per-frame brake. A
      // SEPARATE guard, deliberately not folded into the loop bound, so it
      // composes with any other multiplier on that expression.
      if (!mayFinalize(done)) break;
      markPhase('finalize:sat-skyline'); // R24 A: E's FRAME_STATS attribution
      const p = this.pendingFinalize[i];
      if (!p.grid || p.gi < total) continue; // still sampling
      // A mostly-unstreamed DEM means the whole group would sit at the player's
      // elevation — hold and re-sample rather than commit a floating city. The
      // warp window accepts a coarse answer fast so a destination pops in.
      const badFrac = p.bad / total;
      const maxTries =
        nowSec < (this._warpCoarseUntil ?? 0) ? SK.warpCoarseTries : SK.drapeMaxTries;
      if (badFrac > 0.5 && (p.tries ?? 0) < maxTries) {
        if (nowSec >= (p.retryAt ?? 0)) {
          p.tries = (p.tries ?? 0) + 1;
          p.retryAt = nowSec + 1.5;
          p.gi = 0;
          p.bad = 0;
        }
        continue;
      }
      this.pendingFinalize.splice(i, 1);
      i -= 1;
      done += 1;
      const chunk = this.chunks.get(p.key);
      if (!chunk || chunk.gen !== p.gen || chunk.state !== 'draping') continue;

      const span = WORLD_SIZE / 2 ** p.group.z;
      const gspan = span * g;
      const half = WORLD_SIZE / 2;
      const minX = -half + p.group.gx * gspan;
      const minZ = -(half - p.group.gy * gspan);
      const cx = minX + gspan / 2;
      const cz = minZ + gspan / 2;
      const step = gspan / N;

      let totalV = 0;
      let totalI = 0;
      for (const part of p.parts) {
        totalV += part.sk.pos.length / 3;
        totalI += part.sk.idx.length;
      }
      const pos = new Float32Array(totalV * 3);
      const col = new Float32Array(totalV * 3);
      const anchor = new Float32Array(totalV * 2);
      const idx = totalV > 65535 ? new Uint32Array(totalI) : new Uint16Array(totalI);
      let vOff = 0;
      let iOff = 0;
      for (const part of p.parts) {
        const sk = part.sk;
        const n = sk.pos.length / 3;
        // Tile → group frame, then drape. Every vertex of a building shares its
        // footprint-centroid anchor, so one bilinear lookup per ANCHOR RUN puts
        // the whole block on one level ground height (a per-vertex lookup would
        // tilt it — the bend shader assumes rigid blocks).
        let runAx = NaN;
        let runAz = NaN;
        let runY = 0;
        for (let v = 0; v < n; v++) {
          const ax = sk.anchor[v * 2] + part.dx;
          const az = sk.anchor[v * 2 + 1] + part.dz;
          if (ax !== runAx || az !== runAz) {
            runAx = ax;
            runAz = az;
            // bilinear over the group grid (clamped at the edges)
            const fx = Math.min(N, Math.max(0, (ax + gspan / 2) / step));
            const fy = Math.min(N, Math.max(0, (az + gspan / 2) / step));
            const x0 = Math.min(N - 1, fx | 0);
            const y0 = Math.min(N - 1, fy | 0);
            const tx = fx - x0;
            const ty = fy - y0;
            const g00 = p.grid[y0 * (N + 1) + x0];
            const g10 = p.grid[y0 * (N + 1) + x0 + 1];
            const g01 = p.grid[(y0 + 1) * (N + 1) + x0];
            const g11 = p.grid[(y0 + 1) * (N + 1) + x0 + 1];
            runY = (g00 * (1 - tx) + g10 * tx) * (1 - ty) + (g01 * (1 - tx) + g11 * tx) * ty;
          }
          const o = (vOff + v) * 3;
          pos[o] = sk.pos[v * 3] + part.dx;
          pos[o + 1] = sk.pos[v * 3 + 1] + runY;
          pos[o + 2] = sk.pos[v * 3 + 2] + part.dz;
          col[o] = sk.col[v * 3];
          col[o + 1] = sk.col[v * 3 + 1];
          col[o + 2] = sk.col[v * 3 + 2];
          anchor[(vOff + v) * 2] = ax;
          anchor[(vOff + v) * 2 + 1] = az;
        }
        for (let k = 0; k < sk.idx.length; k++) idx[iOff + k] = sk.idx[k] + vOff;
        vOff += n;
        iOff += sk.idx.length;
      }

      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(col, 3));
      geo.setAttribute('aBendAnchor', new BufferAttribute(anchor, 2));
      // R24 B (FLASH_GUARD) — the skyline's walls are fed by simplifyRing, which
      // already discards the closing clone (recon A1b), so the population here
      // is the roof-earcut COLLINEAR kind (~2 per chunk), not the coincident
      // wall kind. Filter anyway: same helper, before normals, byte-identical
      // when the flag is off.
      const fg = guardIndex(idx, pos);
      this._stat.degenerateDropped += fg.dropped;
      geo.setIndex(new BufferAttribute(fg.idx, 1));
      geo.computeVertexNormals(); // walls are vertex-independent → crisp faces
      geo.computeBoundingSphere();
      // The bend drops geometry in the SHADER, so the computed sphere is the
      // unbent one — inflate it or a far group false-culls at the screen edge.
      // R21 (P1): the flat 1200 is an undershoot for this ring — the worst-case
      // drop is (SK.ring.r + group half-diagonal)² · k ≈ 1.5 km. bendMarginM
      // returns max(1200, computed), so the flag can only ever widen it.
      const spad = bendMarginM(SK.ring.r, (gspan * Math.SQRT2) / 2);
      if (geo.boundingSphere) geo.boundingSphere.radius += spad;
      const mesh = new Mesh(geo, this.material);
      mesh.userData.bendMarginM = spad; // R21 SANCTIONED INSTRUMENT (E CERT)
      mesh.position.set(cx, 0, cz);
      mesh.frustumCulled = true;
      this.object.add(mesh);
      chunk.mesh = mesh;
      this._startBirth(mesh, nowSec);
      // R21 (P10): a brand-new group must have its hole visibility resolved on
      // the very next frame, even if the damping would otherwise skip it.
      this._visHole = -1;
      chunk.tris = fg.idx.length / 3; // R24 B: honest post-filter count (=== totalI/3 flag-off)
      chunk.verts = totalV;
      chunk.parts = null; // the transferred buffers are merged — let them go
      chunk.state = 'ready';
    }
  }

  // --- R24 B (CHUNK_FADE) — per-mesh birth / deferred eviction ---------------

  _startBirth(mesh, nowSec) {
    if (!chunkFadeOn() || CHUNK_FADE.birthSec <= 0) return;
    // Budget spent ⇒ degrade to today's behaviour (an instant arrival) rather
    // than starve. Counted, because a pop that survives the feature must be
    // ATTRIBUTABLE: the engine proof asserts pops <= fadeBudgetMiss.
    if (this._births.length >= CHUNK_FADE.maxConcurrent) {
      this._stat.fadeBudgetMiss += 1;
      return;
    }
    const tw = this._fadePool.acquire();
    tw.uniform.value = 0;
    mesh.material = tw.material;
    this._births.push({ mesh, tw, t0: nowSec, k0: 0 });
  }

  _startDeath(mesh, nowSec) {
    if (this._hardEvict || !chunkFadeOn() || CHUNK_FADE.evictSec <= 0) return false;
    if (this._dying.length >= CHUNK_FADE.maxDying) {
      this._stat.fadeBudgetMiss += 1;
      return false;
    }
    const bi = this._births.findIndex((b) => b.mesh === mesh);
    let tw;
    let k0 = 1;
    if (bi >= 0) {
      const b = this._births[bi];
      k0 = b.k0 + (1 - b.k0) * fadeRamp((nowSec - b.t0) / CHUNK_FADE.birthSec);
      tw = b.tw;
      this._births.splice(bi, 1);
    } else {
      tw = this._fadePool.acquire();
      tw.uniform.value = this._skyFade;
      mesh.material = tw.material;
    }
    this._dying.push({ mesh, tw, t0: nowSec, k0 });
    return true;
  }

  _stepFades(nowSec) {
    if (this._births.length || this._dying.length) markPhase('fade:sat-skyline'); // R24 B
    const alt = this._skyFade;
    for (let i = this._births.length - 1; i >= 0; i--) {
      const b = this._births[i];
      const r = fadeRamp((nowSec - b.t0) / CHUNK_FADE.birthSec);
      b.tw.uniform.value = alt * (b.k0 + (1 - b.k0) * r);
      if (r >= 1) {
        b.mesh.material = this.material;
        this._fadePool.release(b.tw);
        this._births.splice(i, 1);
      }
    }
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      const r = fadeRamp((nowSec - d.t0) / CHUNK_FADE.evictSec);
      d.tw.uniform.value = alt * d.k0 * (1 - r);
      if (r >= 1) {
        this.object.remove(d.mesh);
        d.mesh.geometry.dispose();
        this._fadePool.release(d.tw);
        this._dying.splice(i, 1);
      }
    }
  }

  /** Land every ramp NOW (warp, style flip, dispose): a cut is not a crossfade. */
  _flushFades() {
    for (const b of this._births) {
      b.mesh.material = this.material;
      this._fadePool.release(b.tw);
    }
    this._births.length = 0;
    for (const d of this._dying) {
      this.object.remove(d.mesh);
      d.mesh.geometry.dispose();
      this._fadePool.release(d.tw);
    }
    this._dying.length = 0;
  }

  _evict(key, chunk) {
    if (chunk.mesh) {
      // R24 B (CHUNK_FADE): leave `this.chunks` NOW (every count unchanged),
      // keep drawing while it dims. Bounded by maxDying; Owens has no group to
      // fade ⇒ exactly 0 extra draws.
      if (this._startDeath(chunk.mesh, this._now ?? 0)) {
        chunk.mesh = null;
      } else {
        this.object.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        chunk.mesh = null;
      }
    }
    chunk.parts = null;
    this._stat.evictions += 1; // R21: E CERT reads this off engine.stats
    this.chunks.delete(key);
  }

  /** Dev telemetry (window.__satSkyline.stats / __flyStats.satSkyline). */
  /** R24 B (FLASH_GUARD) — E CERT census hook over resident, draped meshes. */
  censusDegenerate() {
    const meshes = [];
    for (const c of this.chunks.values()) if (c.mesh) meshes.push(c.mesh);
    return censusDegenerate(meshes);
  }

  get stats() {
    let ready = 0; // merged meshes held (one per non-empty group)
    let drawn = 0; // …of which actually issued (the rest sit inside the hole)
    let empty = 0;
    let tris = 0;
    let verts = 0;
    for (const c of this.chunks.values()) {
      if (c.mesh) {
        ready += 1;
        if (c.mesh.visible) drawn += 1;
        tris += c.tris ?? 0;
        verts += c.verts ?? 0;
      }
      if (c.state === 'empty') empty += 1;
    }
    return {
      chunks: this.chunks.size,
      ready,
      drawn,
      empty,
      tris,
      verts,
      queued: this.queue.length,
      building: this.building,
      draping: this.pendingFinalize.length,
      ringOn: this._ringOn,
      maxChunks: this.maxChunks,
      // Round 21 (B) — streaming telemetry for E CERT. Additive, unflagged.
      emptyByReason: emptyByReason(this.chunks),
      errorRetries: this._stat.errorRetries,
      evictions: this._stat.evictions,
      heals: this._stat.heals,
      degenerateDropped: this._stat.degenerateDropped, // R24 B (FLASH_GUARD)
      // R24 B (CHUNK_FADE) — additive; 0 with the flag off. Only `dying` draws.
      births: this._births.length,
      dying: this._dying.length,
      fadeTwins: this._fadePool.size,
      fadeBudgetMiss: this._stat.fadeBudgetMiss,
    };
  }

  dispose() {
    this._disposed = true;
    // R24 B: BEFORE the evict loop below — a teardown must not defer anything.
    this._hardEvict = true;
    this._flushFades();
    // The choreography uniforms are module-shared: hand them back at identity
    // so a re-mount (style flip / StrictMode) never starts inside a dissolve.
    setSatSkyline(0, SAT_SKYLINE.hole.featherM, 1);
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this.pendingFinalize.length = 0;
    this._gRetry.clear(); // R21
    this._fadePool.dispose();
    this.material.dispose();
  }
}
