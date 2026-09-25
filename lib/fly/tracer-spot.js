import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Vector4,
  ZeroFactor,
} from 'three';
import { GLOBE, SKY_OVERLAYS, TRACERS } from '@/lib/fly/fly-constants';
import { airDrop, applyBendAir, applyBendAirTracer, applyOverlayCloudGate } from '@/lib/fly/toy-world/world-bend';
import { immersiveLighting } from '@/lib/fly/immersive';
import { expApproach } from '@/lib/fly/coords';

/**
 * SPOTTER TRAILS — the satellite traffic-trail look (TRACERS.spot).
 *
 * Pure helpers + the ONE geometry/material construction path, shared by
 * TrafficTracers' <SpotTracers> and by prewarm.js (so a warmed program can
 * never differ from the drawn one), and importable by the node gate
 * (scripts/verify-tracer-spot.mjs). Nothing here runs at module scope beyond
 * constant tables.
 *
 * One mesh, one draw, 512 rank slots: 96 NEAR slots (33 ribbon pairs + a
 * 4-vertex head glint) then 416 FAR slots (13 pairs + glint), filled by
 * priority so the draw range is always contiguous. Vertex colour rgb is
 * ADDITIVE light and alpha is VAPOUR opacity; the material blends
 * premultiplied (ONE, ONE_MINUS_SRC_ALPHA), so alpha 0 is exactly additive.
 */

const S = TRACERS.spot;

// Altitude bands — the SAME hex list as TrafficTracers' BANDS (node-gated).
export const BAND_HEX = ['#4ade80', '#fde047', '#fb923c', '#22d3ee'];
const lumaOf = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const normalised = (hex) => {
  const c = new Color(hex); // sRGB hex → linear working space
  const l = lumaOf(c) || 1;
  return { r: c.r / l, g: c.g / l, b: c.b / l };
};
/** Linear band colours normalised to luma 1: hue never changes brightness. */
export const BAND_N = BAND_HEX.map(normalised);
export const GOLD_N = normalised('#ffc896');
export const WHITE = { r: 1, g: 1, b: 1 };

/** NaN-safe band index (a NaN altitude reads as cruise). */
export function spotBandIndex(ry) {
  if (ry < 500) return 0;
  if (ry < 2500) return 1;
  if (ry < 6500) return 2;
  return 3;
}

export function smoothstep(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Trail length in TRUE metres for a head `distM` away flying at `speed`:
 * grows sub-linearly with distance so far craft stay long lines on screen.
 */
export function spotLengthM(distM, speed) {
  const Lc = S.length;
  const d = Number.isFinite(distM) ? Math.max(0, distM) : 0;
  const L = clamp(Lc.nearM * Math.pow(d / Lc.refDistM, Lc.exp), Lc.nearM, Lc.maxM);
  const sk = clamp((Number.isFinite(speed) ? speed : 0) / Lc.speedRefMps, Lc.speedMinK, 1);
  return L * sk;
}

/**
 * Time-of-day weights from the TRUE sun elevation (never the clamped
 * hillshade el): n = night (0 day → 1 night), g = golden (the same
 * immersiveLighting().golden the cloud key uses), both damped so crossing the
 * terminator — or warping across it — eases instead of stepping.
 */
export function stepSpotLook(state, runtime, dt) {
  const sinEl = clamp(runtime?.sun?.sinEl ?? 1, -1, 1);
  const el = (Math.asin(sinEl) * 180) / Math.PI;
  const wx = runtime?.weather?.wx;
  const oc = clamp(wx?.overcastT ?? 0, 0, 1);
  const nT = 1 - smoothstep(S.look.nightElDeg, S.look.dayElDeg, el);
  const gT = runtime?.sun ? immersiveLighting(runtime.sun, wx ?? {}).golden : 0;
  const lam = TRACERS.sun.lerpPerSec;
  state.n = state.n == null ? nT : expApproach(state.n, nT, lam, dt);
  state.g = state.g == null ? gT : expApproach(state.g, gT, lam, dt);
  const L = (state.look ??= { n: 0, v: 1, g: 0, oc: 0 });
  L.n = state.n;
  L.v = 1 - state.n;
  L.g = state.g;
  L.oc = oc;
  return L;
}

/** Preallocated palette (filled per frame by spotPalette; no per-frame objects). */
export function makeSpotPalette() {
  return {
    alphaPeak: 0, emitPeak: 0, headBoost: 0, coreWhite: 0, goldGlow: 0,
    glintGain: 0, spike: 0, hazeB: 0, hazeG: 0, sheen: 0,
    bodyEmit: BAND_N.map(() => ({ r: 0, g: 0, b: 0 })),
    glintCol: BAND_N.map(() => ({ r: 0, g: 0, b: 0 })),
    vapor: { r: 0, g: 0, b: 0 },
  };
}

const mix3 = (out, a, b, t) => {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  return out;
};
const _tmp = { r: 0, g: 0, b: 0 };
const VAPOR = { r: S.look.vapor[0], g: S.look.vapor[1], b: S.look.vapor[2] };
const GOLD_V = { r: S.look.gold[0], g: S.look.gold[1], b: S.look.gold[2] };

export function spotPalette(L, P) {
  const B = S.body;
  const G = S.glint;
  const K = S.look;
  const { n, v, g, oc } = L;
  P.alphaPeak = B.vaporAlpha * v;
  P.emitPeak = B.emitDay + (B.emitNight - B.emitDay) * n + K.overcastGlow * oc * v;
  P.headBoost = B.headBoostNight * n;
  P.coreWhite = B.coreWhiteNight * n;
  P.goldGlow = B.goldGlow * g;
  P.glintGain = G.dayGain + (G.nightGain - G.dayGain) * n;
  P.spike = G.spikeNight * n;
  P.hazeB = B.hazeDay * v;
  P.hazeG = G.hazeDay * v;
  P.sheen = K.sunForward * v;
  const bandK = G.satDay + (1 - G.satDay) * n;
  for (let b = 0; b < BAND_N.length; b++) {
    mix3(P.bodyEmit[b], BAND_N[b], WHITE, B.whiteDay * v);
    mix3(P.glintCol[b], mix3(_tmp, WHITE, BAND_N[b], bandK), GOLD_N, G.goldMix * g);
  }
  mix3(P.vapor, VAPOR, GOLD_V, K.goldVapor * g);
  const dim = 1 - K.overcastVaporDim * oc;
  P.vapor.r *= dim;
  P.vapor.g *= dim;
  P.vapor.b *= dim;
  return P;
}

// ---- geometry --------------------------------------------------------------

const PN = S.points + 1; // near pairs: every recorded point + the live head
const VN = 2 * PN + 4; // near slot verts (70)
const VF = 2 * S.farPairs + 4; // far slot verts (30)
const IN = (PN - 1) * 6 + 6; // near slot indices (198)
const IF = (S.farPairs - 1) * 6 + 6; // far slot indices (78)
export const SPOT_SLOTS = S.nearSlots + S.farSlots;
export const SPOT_VERTS = S.nearSlots * VN + S.farSlots * VF;
export const SPOT_INDICES = S.nearSlots * IN + S.farSlots * IF;

export function spotSlotBase(r) {
  return r < S.nearSlots ? r * VN : S.nearSlots * VN + (r - S.nearSlots) * VF;
}
export function spotDrawCount(n) {
  return n <= S.nearSlots ? n * IN : S.nearSlots * IN + (n - S.nearSlots) * IF;
}
export function spotUsedVerts(n) {
  return n <= S.nearSlots ? n * VN : S.nearSlots * VN + (n - S.nearSlots) * VF;
}

// Glint diamond L, B, R, T in units of the glint radius; z = 1 marks a glint.
const GLINT_Q = [
  [-1.6, 0],
  [0, -1.6],
  [1.6, 0],
  [0, 1.6],
];

export function buildSpotGeometry() {
  const geo = new BufferGeometry();
  const pos = new BufferAttribute(new Float32Array(SPOT_VERTS * 3), 3).setUsage(DynamicDrawUsage);
  const col = new BufferAttribute(new Float32Array(SPOT_VERTS * 4), 4).setUsage(DynamicDrawUsage);
  const tr = new Float32Array(SPOT_VERTS * 3);
  // The legacy self-selecting idiom: never throws (the node gate asserts Uint16).
  const idx = new (SPOT_VERTS > 65535 ? Uint32Array : Uint16Array)(SPOT_INDICES);
  let w = 0;
  for (let r = 0; r < SPOT_SLOTS; r++) {
    const base = spotSlotBase(r);
    const pairs = r < S.nearSlots ? PN : S.farPairs;
    for (let j = 0; j < pairs; j++) {
      tr[(base + 2 * j) * 3] = 1;
      tr[(base + 2 * j + 1) * 3] = -1;
    }
    for (let q = 0; q < pairs - 1; q++) {
      const a = base + 2 * q;
      idx[w++] = a;
      idx[w++] = a + 1;
      idx[w++] = a + 2;
      idx[w++] = a + 1;
      idx[w++] = a + 3;
      idx[w++] = a + 2;
    }
    const g = base + 2 * pairs;
    for (let k = 0; k < 4; k++) {
      tr[(g + k) * 3] = GLINT_Q[k][0];
      tr[(g + k) * 3 + 1] = GLINT_Q[k][1];
      tr[(g + k) * 3 + 2] = 1;
    }
    idx[w++] = g;
    idx[w++] = g + 1;
    idx[w++] = g + 2;
    idx[w++] = g;
    idx[w++] = g + 2;
    idx[w++] = g + 3;
  }
  geo.setAttribute('position', pos);
  geo.setAttribute('color', col);
  geo.setAttribute('aTracer', new BufferAttribute(tr, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  return geo;
}

/** Per-program uniforms, shared by reference by every spot material. */
export const TRACER_SPOT_UNIFORMS = {
  uTrPx: { value: new Vector4(5, 1, 1, 0.7) }, // glint radius px, 2/W, 2/H, far radius scale
  uTrGlint: { value: new Vector4(20000, 120000, 90, 0.25) }, // far band (world), pull max, pull frac
  uTrFade: { value: new Vector4(150000, 185000, -2000, -500) }, // sky band (world), ground ramp on y − eye
  uTrVapor: { value: new Vector4(0.78, 0.8, 0.84, 0.95) }, // vapour rgb, luminance cap
  uTrSun: { value: new Vector4(0, 1, 0, 0) }, // sun dir, forward-sheen gain
  uTrShape: { value: new Vector4(0.3, 10, 0.55, 0) }, // profile edge, core k, halo, spike
  uTrMarkFloor: { value: 0.2 }, // glint floor under the cloud gate
};

/** The ONE construction path for the spot material (component + prewarm). */
export function makeSpotTracerMaterial() {
  const m = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    fog: false,
    // Premultiplied optical blend: out = src.rgb + dst·(1 − src.a). Day vapour
    // carries alpha; night neon and every glint write alpha 0 = additive.
    // Blending is not part of three's program key. Destination alpha is kept.
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendEquationAlpha: AddEquation,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  applyBendAirTracer(m, GLOBE.trafficBend, TRACER_SPOT_UNIFORMS);
  return m;
}

export function buildSpotMesh() {
  const geo = buildSpotGeometry();
  const mesh = new Mesh(geo, makeSpotTracerMaterial());
  mesh.name = 'traffic-tracers-spot';
  mesh.frustumCulled = false;
  // Inside the overlay holder the glints composite AFTER the normal-blend
  // billboards and plumes. This mesh never exists in toy.
  mesh.renderOrder = 1;
  return { mesh, pos: geo.getAttribute('position'), col: geo.getAttribute('color') };
}

/** Plume material patch (TrafficContrails + player Contrail): air bend + the overlay cloud gate. */
export function patchAirWake(m) {
  applyBendAir(m, GLOBE.trafficBend);
  if (SKY_OVERLAYS.cloudGate.enabled && SKY_OVERLAYS.cloudGate.wakes) applyOverlayCloudGate(m);
}

/**
 * Air-bend compensation at a trail head (the airDrop CPU mirror; no new GPU
 * surface). Far above the eye the air bend's far-lift renders heights scaled
 * by vS = d(rendered y)/dy (up to ×2.5), and moves the head to a rendered
 * distance rho × the unbent one. The vertical side offset is divided by vS
 * and the pixel floor multiplied by rho, so the floor is what RENDERS.
 * Inputs are rebased (x − anchor.x, absolute y, z − anchor.z); `bend` is
 * world-bend's getBend().
 */
export function spotAirComp(out, hx, hy, hz, cx, cy, cz, bend) {
  const W = S.width;
  const dB = Math.hypot(hx - bend.cx, hz - bend.cz);
  const e = W.vScaleProbeM;
  const vRaw = (hy + e - airDrop(dB, hy + e) - (hy - e - airDrop(dB, hy - e))) / (2 * e);
  out.vS = clamp(Number.isFinite(vRaw) ? vRaw : 1, W.vScaleClamp[0], W.vScaleClamp[1]);
  const dRend = Math.hypot(hx - cx, hy - airDrop(dB, hy) - cy, hz - cz);
  const dFlat = Math.max(1, Math.hypot(hx - cx, hy - cy, hz - cz));
  const rhoRaw = dRend / dFlat;
  out.rho = clamp(Number.isFinite(rhoRaw) ? rhoRaw : 1, W.distScaleClamp[0], W.distScaleClamp[1]);
  return out;
}

/** Sun direction the cloud pass uses: (−sin az·c, sinEl, cos az·c). */
export function sunDirInto(out, sun) {
  const s = clamp(sun?.sinEl ?? 1, -1, 1);
  const az = sun?.az || 0;
  const c = Math.sqrt(1 - s * s);
  out.x = -Math.sin(az) * c;
  out.y = s;
  out.z = Math.cos(az) * c;
  return out;
}

/** Satellite (and only when enabled). `__flySpotTracers = false` is a dev A/B pin; this is its ONE reader. */
export function spotTracersOn(style) {
  if (!S.enabled || S.styles[style] !== true) return false;
  return !(process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && window.__flySpotTracers === false);
}

// ---- rings -----------------------------------------------------------------
// ABSOLUTE float64 positions, rebased only at vertex-write time (floating-
// origin safe by construction). `seq` counts appends and is never reset, so the
// far tier's decimation (absSeq % farStride) never slides as points arrive.

const RP = S.points;

/** FNV-1a of the hex → a stable per-craft phase in [0, 2π). */
export function hexPhase(hex) {
  let h = 2166136261;
  const s = String(hex ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

export function newSpotRec(pool, hex) {
  return {
    buf: pool.pop() ?? new Float64Array(RP * 3),
    head: 0,
    cnt: 0,
    seq: 0,
    phase: hexPhase(hex),
    slot: false,
    near: false,
    missingSince: 0,
  };
}

/**
 * Instant trail (the Round 6 user-approved fake): fill the ring backwards
 * along the track's velocity at the distance-scaled spacing, so a newly seen
 * plane carries its full-length trail at once. The synthetic climb slope is
 * clamped so a hard climber never foreshortens into a vertical streak.
 * Returns false (ring untouched) for a track with no horizontal velocity.
 */
export function backfillSpot(rec, fix, hx, hy, hz, spacingW, kT, lengthM) {
  const h = Math.hypot(fix.vE, fix.vN);
  if (!(h >= 1)) return false;
  const ux = (-fix.vE / h) * spacingW;
  const uz = (fix.vN / h) * spacingW; // world +z = south
  const sMax = Math.min(0.12, S.backfillVertM / Math.max(1, lengthM));
  const slope = clamp(fix.vUp / h, -sMax, sMax);
  const uy = -slope * (spacingW / (kT || 1));
  const buf = rec.buf;
  for (let j = 0; j < RP; j++) {
    const back = RP - j; // oldest (j = 0) is farthest behind the head
    buf[j * 3] = hx + ux * back;
    buf[j * 3 + 1] = Math.max(0, hy + uy * back);
    buf[j * 3 + 2] = hz + uz * back;
  }
  rec.head = 0;
  rec.cnt = RP;
  rec.seq += RP;
  return true;
}

export function appendSpot(rec, x, y, z) {
  const o = rec.head * 3;
  rec.buf[o] = x;
  rec.buf[o + 1] = y;
  rec.buf[o + 2] = z;
  rec.head = (rec.head + 1) % RP;
  if (rec.cnt < RP) rec.cnt += 1;
  rec.seq += 1;
}

/** Index (×3) of the newest recorded point. */
export function lastSpotIndex(rec) {
  return ((rec.head - 1 + RP) % RP) * 3;
}

/**
 * Gather oldest → newest into `out` (absolute), every point (stride 1) or the
 * seq-anchored far subset (the oldest + absSeq % stride === 0), then append
 * the live head. Returns the point count m (2 ≤ m ≤ cap when cnt ≥ 1).
 */
export function gatherSpot(rec, stride, hx, hy, hz, out) {
  const buf = rec.buf;
  let m = 0;
  for (let j = 0; j < rec.cnt; j++) {
    if (stride > 1 && j !== 0 && (rec.seq - rec.cnt + j) % stride !== 0) continue;
    const bi = ((rec.head - rec.cnt + j + RP) % RP) * 3;
    out[m * 3] = buf[bi];
    out[m * 3 + 1] = buf[bi + 1];
    out[m * 3 + 2] = buf[bi + 2];
    m += 1;
  }
  out[m * 3] = hx;
  out[m * 3 + 1] = hy;
  out[m * 3 + 2] = hz;
  return m + 1;
}

/**
 * Return dead tracks' rings to the pool after a ~10 s grace, so a briefly
 * dropped track RESUMES its trail (the cut check guards any jump on revival).
 */
export function sweepSpot(state, tracks) {
  if (!tracks) return;
  for (const [hex, rec] of state.recs) {
    if (tracks.has(hex)) {
      rec.missingSince = 0;
    } else if (!rec.missingSince) {
      rec.missingSince = state.frame;
    } else if (state.frame - rec.missingSince > 600) {
      state.pool.push(rec.buf);
      state.recs.delete(hex);
      state.gates.delete(hex);
    }
  }
}
