// AIRFIELD APRON DETAIL — Play Pass APRON (FLY_PLAY_PASS.md, flag APRON_DETAIL,
// read only through lib/fly/play-pass.js; tunables in its block at the end of
// lib/fly/fly-constants.js).
//
// The view from the lounge window is the airfield ground; this file makes it
// read as a working airport instead of a flat grey plain:
//   - concrete in paving lanes and construction phases, rectangular slabs with
//     thin sealed joints, sealed cracks, weathering that survives distance;
//     asphalt that oxidises grey, with patches and crack sealant;
//   - the taxi paths worn in: main-gear rubber either side of every taxiway
//     centreline, exhaust soot down the middle, streaks along the direction of
//     travel; oil and hydraulic stains on the stands under the parked
//     aircraft's gear, engines and APU; dirt along pavement edges;
//   - yellow markings with the black border light pavement carries;
//   - grass with tonal patches that survive distance, mowing stripes that
//     catch the light by viewing direction (as real ones do), a worn, dusty
//     verge where it meets the pavement, and paved shoulders along the big
//     taxiways; runways worn down the centre by every take-off roll.
//
// Two halves, both pure (no three, no DOM):
//   1. apronFieldJob() — a generator the ground set pumps a few milliseconds a
//      frame: one RGBA8 DETAIL FIELD over a square around the lounge,
//        R  distance to the nearest taxiway centreline   (0..FIELD_RANGE m)
//        G  signed distance to the drawn pavement edge   (0.5 = the edge, inside < 0.5)
//        B  stand stain density (the airport set's stands: gear, engines, APU)
//        A  apron weight (mapped aprons and the set's apron, softened)
//      every value a distance or a smooth density, so linear filtering at a
//      ~3 m texel is exact enough and the shaders do the fine detail.
//   2. the shader text: anchored substitutions into airfield-materials.js's
//      GLSL (each throws when its anchor is missing). Flag off, none of this
//      runs and the materials' text is byte-identical to before.
//
// Every pattern is box-filtered by its own pixel footprint (fwidth), so from a
// 22 m eye at 0.3–3 km and through the binoculars nothing shimmers: lines
// resolve to their average tone, gaussian bands widen by the footprint
// (afGaussAA), noise fades to its mean (afNoiseAA).
import { SURF } from './airfield-geometry.js';

/** Metres the R and G channels span (R: 0..range, G: -range..+range). */
export const FIELD_RANGE = 32;

// --- the detail field ---------------------------------------------------------

/**
 * Stain blobs of one parked aircraft, in the stand's own frame: (across,
 * along) as fractions of (span, length) from the nose stop, sigma metres,
 * weight. Nose gear stop, main gear, both engines, the APU, the cargo side's
 * service area and a faint wash down the centreline.
 */
const STAND_BLOBS = [
  [0, -0.12, 1.6, 1.0],
  [0.085, -0.47, 1.9, 0.75], [-0.085, -0.47, 1.9, 0.75],
  [0.16, -0.38, 2.3, 0.9], [-0.16, -0.38, 2.3, 0.9],
  [0, -0.95, 2.4, 0.6],
  [-0.1, -0.24, 4.2, 0.35],
];

/** Stand list (airportLayout) in room-local metres -> stain blobs in LOCAL metres. */
export function standBlobs(site, layout, standClass) {
  const out = [];
  if (!site || !layout?.stands?.length) return out;
  const c = Math.cos(site.heading), s = Math.sin(site.heading);
  // room-local (lx, lz) -> airfield local metres ((scene - site) / k)
  const toLocal = (lx, lz) => [lx * c + lz * s, -lx * s + lz * c];
  for (const st of layout.stands) {
    const cls = standClass[st.cls] ?? standClass.narrow;
    if (!cls) continue;
    // Nose-in: the front stands face +z (the pier); the back stands -z.
    const dir = st.side === 'back' ? -1 : 1;
    for (const [fx, fz, sigma, w] of STAND_BLOBS) {
      const lx = st.x + fx * cls.span * dir;
      const lz = st.noseZ + fz * cls.length * dir;
      const [x, z] = toLocal(lx, lz);
      out.push({ x, z, sigma, w });
    }
    // The centreline wash: a chain of faint blobs nose to tail.
    for (let f = 0.05; f <= 0.9; f += 0.12) {
      const [x, z] = toLocal(st.x, st.noseZ - f * cls.length * dir);
      out.push({ x, z, sigma: 0.12 * cls.span, w: 0.22 });
    }
  }
  return out;
}

/**
 * The airport set's own taxi paths (the apron taxilane and every stand's
 * lead-in turns and straight, airport-set/decals.js standLeadIn) as polylines
 * in LOCAL metres: the aircraft that park at the set's stands wear these, not
 * the OSM taxiways, which rarely run under a synthetic apron. A pier's rear
 * side is built in the front frame and turned 180 degrees about zc, as the
 * set plan builds it.
 */
export function setTaxiLines(site, layout, leadIn) {
  const out = [];
  if (!site || !layout?.sides?.length || !layout.lanes || typeof leadIn !== 'function') return out;
  const c = Math.cos(site.heading), s = Math.sin(site.heading);
  const lanes = layout.lanes, apron = layout.apron;
  for (const side of layout.sides) {
    const rot = !!side.xform?.rot180, zc = side.xform?.zc ?? layout.zc ?? 0;
    const line = (pts) => {
      const flat = [];
      for (const [x0, z0] of pts) {
        const x = rot ? -x0 : x0, z = rot ? 2 * zc - z0 : z0;
        flat.push(x * c + z * s, -x * s + z * c);
      }
      if (flat.length >= 4) out.push({ pts: flat });
    };
    if (apron && Number.isFinite(lanes.taxilaneZ)) line([[apron.x0 + 4, lanes.taxilaneZ], [apron.x1 - 4, lanes.taxilaneZ]]);
    for (const st of side.stands ?? []) {
      const canon = rot ? { ...st, ...st.canon } : st;
      const a = leadIn(canon, lanes, -1), b = leadIn(canon, lanes, 1);
      line(a.arc);
      line(b.arc);
      line(a.straight);
    }
  }
  return out;
}

/** Point-to-segment distance. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px, ez = az + dz * t - pz;
  return Math.sqrt(ex * ex + ez * ez);
}

/**
 * One 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher)
 * of f (length n, stride st from o) in place, with scratch v, z, d.
 */
function edt1(f, o, st, n, v, z, d) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[o + q * st];
    let s;
    for (;;) {
      const p = v[k];
      s = (fq + q * q - (f[o + p * st] + p * p)) / (2 * q - 2 * p);
      if (s > z[k]) break;
      k--;
      if (k < 0) { k = 0; s = -Infinity; break; }
    }
    if (s === -Infinity) { v[0] = q; z[0] = -Infinity; z[1] = Infinity; k = 0; continue; }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[o + p * st];
  }
  for (let q = 0; q < n; q++) f[o + q * st] = d[q];
}

/** Rasterise triangles (flat local x,z per vertex) into `mask` with `value` at texel centres. */
function rasterTris(mask, N, x0, z0, step, P, I, keep, value) {
  for (let t = 0; t < I.length; t += 3) {
    const ia = I[t], ib = I[t + 1], ic = I[t + 2];
    if (keep && !keep(ia)) continue;
    const ax = (P[ia * 3] - x0) / step - 0.5, az = (P[ia * 3 + 2] - z0) / step - 0.5;
    const bx = (P[ib * 3] - x0) / step - 0.5, bz = (P[ib * 3 + 2] - z0) / step - 0.5;
    const cx = (P[ic * 3] - x0) / step - 0.5, cz = (P[ic * 3 + 2] - z0) / step - 0.5;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1 = Math.min(N - 1, Math.floor(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.ceil(Math.min(az, bz, cz))), j1 = Math.min(N - 1, Math.floor(Math.max(az, bz, cz)));
    if (i0 > i1 || j0 > j1) continue;
    const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const sgn = area > 0 ? 1 : -1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w0 = ((bx - i) * (cz - j) - (bz - j) * (cx - i)) * sgn;
        const w1 = ((cx - i) * (az - j) - (cz - j) * (ax - i)) * sgn;
        const w2 = ((ax - i) * (bz - j) - (az - j) * (bx - i)) * sgn;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[j * N + i] = value;
      }
    }
  }
}

/**
 * The detail field, built a slice at a time. Each `yield` is a few
 * milliseconds of work at most; the generator returns the finished field
 *   { size, x0, z0, span, step, data: Uint8Array(size*size*4), stats }.
 *
 * @param model   the airfield model (taxiways in local metres)
 * @param pave    pavement geometry (facet-cut; position, index, surf)
 * @param rwy     runway geometry (facet-cut; position, index)
 * @param opts    { sizePx, halfM, blobs, lines }  blobs = standBlobs(...),
 *                lines = setTaxiLines(...) (extra centrelines, { pts })
 */
export function* apronFieldJob(model, pave, rwy, { sizePx = 2048, halfM = 3200, blobs = [], lines = [] } = {}) {
  const N = sizePx | 0;
  const span = 2 * halfM;
  const step = span / N;
  const x0 = -halfM, z0 = -halfM;
  const R = FIELD_RANGE;
  const stats = { size: N, step: +step.toFixed(3), segments: 0, setLines: lines.length, pavedTexels: 0, apronTexels: 0, blobs: blobs.length };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // 1. Taxiway centreline distance (exact per segment, inside each segment's padded box).
  const dc = new Float32Array(N * N).fill(R);
  let work = 0;
  for (const t of [...(model.taxiways ?? []), ...lines]) {
    const p = t.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - x0) / step)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + R - x0) / step));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R - z0) / step)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + R - z0) / step));
      if (i0 > i1 || j0 > j1) continue;
      stats.segments++;
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + (j + 0.5) * step;
        for (let ii = i0; ii <= i1; ii++) {
          const d = segDist(x0 + (ii + 0.5) * step, pz, ax, az, bx, bz);
          const k = j * N + ii;
          if (d < dc[k]) dc[k] = d;
        }
      }
      work += (i1 - i0 + 1) * (j1 - j0 + 1);
      if (work > 60000) { work = 0; yield 'taxi'; }
    }
  }
  yield 'taxi';
  // 2. Paved and apron masks from the drawn triangles.
  const paved = new Uint8Array(N * N);
  const apron = new Uint8Array(N * N);
  if (pave?.index?.length) {
    rasterTris(paved, N, x0, z0, step, pave.position, pave.index, null, 1);
    yield 'paved';
    const surf = pave.surf;
    if (surf) rasterTris(apron, N, x0, z0, step, pave.position, pave.index, (v) => Math.round(surf[v * 3]) === SURF.apron, 1);
    yield 'apron';
  }
  if (rwy?.index?.length) rasterTris(paved, N, x0, z0, step, rwy.position, rwy.index, null, 1);
  yield 'runway';
  // 3. Signed distance to the pavement edge: squared EDT outside (seeds =
  // paved) and inside (seeds = unpaved), in texels.
  const INF = 1e12;
  const out2 = new Float64Array(N * N), in2 = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const pv = paved[k];
    out2[k] = pv ? 0 : INF;
    in2[k] = pv ? INF : 0;
    stats.pavedTexels += pv;
    stats.apronTexels += apron[k];
  }
  const v = new Int32Array(N), zz = new Float64Array(N + 1), dd = new Float64Array(N);
  for (const f of [out2, in2]) {
    for (let i = 0; i < N; i++) {
      edt1(f, i, N, N, v, zz, dd); // columns
      if ((i & 63) === 63) yield 'edt';
    }
    for (let j = 0; j < N; j++) {
      edt1(f, j * N, 1, N, v, zz, dd); // rows
      if ((j & 63) === 63) yield 'edt';
    }
  }
  // 4. Stand stains: gaussian blobs (density, capped at 1).
  const stain = new Float32Array(N * N);
  for (const b of blobs) {
    const r = b.sigma * 3;
    const i0 = Math.max(0, Math.floor((b.x - r - x0) / step)), i1 = Math.min(N - 1, Math.ceil((b.x + r - x0) / step));
    const j0 = Math.max(0, Math.floor((b.z - r - z0) / step)), j1 = Math.min(N - 1, Math.ceil((b.z + r - z0) / step));
    const k2 = 1 / (2 * b.sigma * b.sigma);
    for (let j = j0; j <= j1; j++) {
      const ez = z0 + (j + 0.5) * step - b.z;
      for (let i = i0; i <= i1; i++) {
        const ex = x0 + (i + 0.5) * step - b.x;
        stain[j * N + i] += b.w * Math.exp(-(ex * ex + ez * ez) * k2);
      }
    }
  }
  yield 'stands';
  // 5. Apron weight: a separable 5-texel box blur of the apron mask.
  const tmp = new Float32Array(N * N), soft = new Float32Array(N * N);
  const RB = 2, inv = 1 / (2 * RB + 1);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let o = -RB; o <= RB; o++) { const x = i + o; if (x >= 0 && x < N) s += apron[j * N + x]; }
      tmp[j * N + i] = s * inv;
    }
    if ((j & 255) === 255) yield 'blur';
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let o = -RB; o <= RB; o++) { const y = j + o; if (y >= 0 && y < N) s += tmp[y * N + i]; }
      soft[j * N + i] = s * inv;
    }
    if ((j & 255) === 255) yield 'blur';
  }
  // 6. Pack.
  const data = new Uint8Array(N * N * 4);
  const q = (x) => (x <= 0 ? 0 : x >= 1 ? 255 : Math.round(x * 255));
  for (let k = 0; k < N * N; k++) {
    // The edge lies half a texel beyond the last paved texel centre.
    const sd = paved[k] ? -(Math.sqrt(in2[k]) - 0.5) * step : (Math.sqrt(out2[k]) - 0.5) * step;
    const o = k * 4;
    data[o] = q(dc[k] / R);
    data[o + 1] = q(0.5 + sd / (2 * R));
    data[o + 2] = q(stain[k]);
    data[o + 3] = q(soft[k]);
  }
  stats.ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return { size: N, x0, z0, span, step, data, stats };
}

/** Run a field job to completion (node gates, tests). */
export function buildApronField(model, pave, rwy, opts) {
  const job = apronFieldJob(model, pave, rwy, opts);
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}

/** Decode one texel of a field (node gates): { dc, sd, stain, apron } in metres / 0..1. */
export function fieldAt(field, x, z) {
  const i = Math.floor((x - field.x0) / field.step), j = Math.floor((z - field.z0) / field.step);
  if (i < 0 || j < 0 || i >= field.size || j >= field.size) return null;
  const o = (j * field.size + i) * 4, d = field.data;
  return { dc: (d[o] / 255) * FIELD_RANGE, sd: (d[o + 1] / 255 - 0.5) * 2 * FIELD_RANGE, stain: d[o + 2] / 255, apron: d[o + 3] / 255 };
}

// --- the shaders -----------------------------------------------------------------

/** One anchored substitution: throws when the anchor is missing (or not unique). */
export function swap(src, from, to, who) {
  const parts = src.split(from);
  if (parts.length !== 2) throw new Error(`airfield apron (${who}): shader anchor ${parts.length === 1 ? 'missing' : 'not unique'}: ${from.slice(0, 70)}`);
  return parts[0] + to + parts[1];
}

/** Uniform cells the flag adds to createAirfieldUniforms() (values set by the ground set). */
export function apronUniforms(Vector4) {
  return {
    uAfDetail: { value: null },
    uAfDetailBox: { value: new Vector4(0, 0, 1, 1) }, // x0, z0, 1/span, texel metres
    uAfApron: { value: new Vector4(0, 0, 0, 0) }, // level (0 = the previous look), night, eye x, eye z (local m)
    uAfApronK: { value: new Vector4(0, 0, 0, 0) }, // taxi wear, stand stains, marking border, edge dirt
    uAfApronS: { value: new Vector4(6.1, 7.5, 0, 9) }, // slab length, lane width, taxiway shoulder, taxiway half width
    uAfApronG: { value: new Vector4(0, 0, 0, 0) }, // mowing sheen, grass patches, verge, runway roll wear
    uAfApronC: { value: new Vector4(0.33, 1.12, 1.15, 0) }, // concrete albedo, pavement level cap, runway level cap, -
    uAfApronN: { value: new Vector4(1, 0.8, 0.58, 0) }, // apron floodlight colour (linear), strength
  };
}

// The field and helpers every patched fragment shader declares.
const DETAIL_DECL = /* glsl */ `
uniform sampler2D uAfDetail;
uniform vec4 uAfDetailBox;
uniform vec4 uAfApron;
uniform vec4 uAfApronK;
uniform vec4 uAfApronS;
uniform vec4 uAfApronG;
uniform vec4 uAfApronC;
uniform vec4 uAfApronN;
// The detail field at a local point; inBox = 0 outside it (then callers use
// their own neutral values: far from any taxiway, far from any edge).
vec4 afDetailAt( vec2 p, out float inBox ) {
  vec2 uv = ( p - uAfDetailBox.xy ) * uAfDetailBox.z;
  inBox = step( 0.0, uv.x ) * step( uv.x, 1.0 ) * step( 0.0, uv.y ) * step( uv.y, 1.0 );
  return texture( uAfDetail, uv );
}
// A gaussian bump box-filtered by a footprint w: the analytic convolution's
// width, so a narrow band seen edge-on widens and dims instead of aliasing.
float afGaussAA( float x, float mu, float s, float w ) {
  float s2 = sqrt( s * s + w * w / 12.0 );
  float t = ( x - mu ) / s2;
  return s / s2 * exp( -0.5 * t * t );
}
`;

// --- pavement ---

const PAVE_DECL_ADD = /* glsl */ `
${DETAIL_DECL}
float afSheen = 0.0;
float afFlood = 0.0;
// Concrete as an airport pours it: paving lanes along the airport grid,
// rectangular slabs, construction phases with their own tone, thin sealed
// joints with a patchy dirt line, sealed cracks in some slabs, weathering at
// every scale from aggregate to hundreds of metres.
vec3 afConcreteApron( vec2 p, float foot ) {
  vec2 g = vec2( dot( p, uAfSlab.xy ), dot( p, vec2( -uAfSlab.y, uAfSlab.x ) ) );
  vec2 dim = uAfApronS.xy;
  vec2 q = g / dim;
  vec2 slab = floor( q );
  vec2 fq = max( fwidth( q ), vec2( 1e-4 ) );
  vec2 phase = floor( slab / vec2( 9.0, 6.0 ) );
  float ph = afHash( phase * 3.1 + 11.0 );
  float lane = afHash( vec2( slab.y, 5.0 ) + phase.x * 0.37 );
  float tone = afHash( slab + 17.0 );
  float age = afHash( slab * 0.5 + 3.0 );
  vec3 c = vec3( uAfApronC.x, uAfApronC.x * 0.985, uAfApronC.x * 0.925 );
  c *= 0.88 + 0.24 * ph;
  c *= mix( vec3( 1.0 ), vec3( 1.035, 1.0, 0.94 ), afHash( phase + 2.0 ) );
  c *= 0.94 + 0.12 * lane;
  c *= 0.965 + 0.07 * tone;
  c *= mix( 1.0, 1.12, step( 0.965, age ) ) * mix( 1.0, 0.9, step( age, 0.06 ) );
  float wx = afNoise( p / 210.0 ) * 0.5 + afNoise( p / 70.0 + 3.0 ) * 0.3 + afNoise( p / 23.0 + 7.0 ) * 0.2;
  c *= 0.84 + 0.32 * wx;
  c *= 0.93 + 0.14 * afNoiseAA( p, 1.0 / 0.12, foot );
  c *= 0.95 + 0.1 * afNoiseAA( p + 13.0, 1.0 / 0.6, foot );
  // Joints: 2.5 cm of sealant, a patchy 22 cm line of dirt either side.
  vec2 sw = 0.025 / dim, dw = 0.22 / dim;
  float seal = max( 1.0 - afPulse( q.x + 0.5 * sw.x, 1.0 - sw.x, fq.x ), 1.0 - afPulse( q.y + 0.5 * sw.y, 1.0 - sw.y, fq.y ) );
  float dirt = max( 1.0 - afPulse( q.x + 0.5 * dw.x, 1.0 - dw.x, fq.x ), 1.0 - afPulse( q.y + 0.5 * dw.y, 1.0 - dw.y, fq.y ) );
  dirt *= 0.45 + 0.55 * afNoiseAA( p + 71.0, 1.0 / 1.5, foot );
  c *= 1.0 - 0.24 * dirt;
  // Sealed cracks: an overbanded black line across about one slab in six.
  float cr = afHash( slab + 29.0 );
  vec2 f = fract( q );
  float t = cr > 0.94 ? f.x + f.y - 1.0 : f.y - 0.25 - 0.5 * afHash( slab + 31.0 );
  t += ( afNoise( f * dim * 0.9 + slab * 7.0 ) - 0.5 ) * 0.16;
  float crack = afBand( t, -0.03 / dim.y, 0.03 / dim.y, max( fwidth( t ), 1e-4 ) ) * step( 0.83, cr );
  c = mix( c, vec3( 0.03 ), crack * 0.8 );
  return mix( c, vec3( 0.03 ), seal * 0.8 );
}
// Asphalt: fresh black binder oxidising to grey over the years, aggregate,
// darker patch repairs, meandering crack sealant in the older areas.
vec3 afAsphaltApron( vec2 p, float foot ) {
  float aggregate = afNoiseAA( p, 1.0 / 0.08, foot );
  float pebble = afNoiseAA( p + 5.0, 1.0 / 0.35, foot );
  float age = afNoise( p / 180.0 ) * 0.6 + afNoise( p / 45.0 + 9.0 ) * 0.4;
  float wear = afNoise( p / 29.0 ) * 0.6 + afNoise( p / 7.0 ) * 0.4;
  vec3 c = mix( vec3( 0.06, 0.062, 0.066 ), vec3( 0.112, 0.11, 0.105 ), smoothstep( 0.25, 0.85, age ) );
  c *= 0.86 + 0.28 * wear;
  c *= 0.9 + 0.2 * aggregate;
  c *= 0.93 + 0.14 * pebble;
  vec2 cell = floor( p / 14.0 );
  float patchy = step( 0.88, afHash( cell + 3.0 ) ) * afBand( fract( p.x / 14.0 ), 0.2, 0.8, fwidth( p.x / 14.0 ) ) * afBand( fract( p.y / 14.0 ), 0.25, 0.75, fwidth( p.y / 14.0 ) );
  c *= 1.0 - 0.3 * patchy;
  float n = afNoise( p / 6.0 + 17.0 ) + 0.5 * afNoise( p / 2.1 );
  float crack = afBand( n, 0.742, 0.758, max( fwidth( n ), 1e-4 ) ) * smoothstep( 0.55, 0.75, afNoise( p / 40.0 + 2.0 ) );
  return mix( c, vec3( 0.018 ), crack * 0.7 );
}
// Wear on any pavement: taxi paths (main-gear rubber either side of the
// centreline, soot down the middle, streaks along the direction of travel),
// stains on the stands and aprons, dirt along the pavement edge.
vec3 afApronWear( vec3 c, vec2 p, float foot, float concreteW ) {
  float inBox;
  vec4 det = afDetailAt( p, inBox );
  if ( inBox < 0.5 ) return c;
  float dc = det.r * ${FIELD_RANGE.toFixed(1)};
  float sd = ( det.g - 0.5 ) * ${(2 * FIELD_RANGE).toFixed(1)};
  if ( dc < 16.0 ) {
    float wdc = max( fwidth( dc ), 1e-3 );
    // Along the travel direction: perpendicular to the distance gradient.
    float h = uAfDetailBox.w;
    float ix, iz;
    float gx = afDetailAt( p + vec2( h, 0.0 ), ix ).r - det.r;
    float gz = afDetailAt( p + vec2( 0.0, h ), iz ).r - det.r;
    vec2 tang = normalize( vec2( -gz, gx ) + vec2( 1e-6, 0.0 ) );
    float along = dot( p, tang );
    float streak = afNoiseAA( vec2( along / 22.0, dc * 1.1 ), 1.0, max( wdc * 1.1, foot / 22.0 ) );
    float gear = afGaussAA( dc, 4.4, 1.7, wdc ) * ( 0.55 + 0.7 * streak );
    float inner = afGaussAA( dc, 1.8, 1.0, wdc ) * 0.45;
    float soot = 1.0 - smoothstep( 3.0, 13.0, dc );
    float wear = clamp( gear + inner + soot * 0.35, 0.0, 1.4 );
    c *= 1.0 - uAfApronK.x * mix( 0.45, 1.0, concreteW ) * wear;
    afSheen = max( afSheen, wear * 0.05 );
  }
  // Stains: blotches thresholded from noise, denser on the stands; the far
  // field takes the blotches' average coverage so the tone does not shift.
  float dens = clamp( det.b * 1.2 + det.a * 0.25 * smoothstep( 0.45, 0.8, afNoise( p / 37.0 + 5.0 ) ), 0.0, 1.0 );
  if ( dens > 0.01 ) {
    float blot = afNoiseAA( p + 41.0, 1.0 / 1.9, foot ) * 0.6 + afNoiseAA( p + 2.1, 1.0 / 0.7, foot ) * 0.25 + afNoise( p / 7.0 ) * 0.15;
    float nearStain = smoothstep( 0.6 - 0.22 * dens, 0.74 - 0.2 * dens, blot ) * dens;
    float stain = mix( nearStain, dens * 0.42, smoothstep( 0.25, 0.8, foot / 0.7 ) );
    c *= mix( vec3( 1.0 ), vec3( 0.5, 0.48, 0.45 ), stain * uAfApronK.y );
    afSheen = max( afSheen, stain * 0.3 );
  }
  // At night every apron is floodlit from its masts: a broad, slightly
  // uneven field of warm light (the set's own pools add the masts near the
  // lounge on top), so the lit aprons stand out from the dark taxiways.
  if ( uAfApron.y > 0.0 && det.a > 0.0 ) {
    // One mast per 90 m cell, jittered; each throws a pool ~2 heights wide.
    vec2 mc = floor( p / 90.0 );
    float pools = 0.0;
    for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
      vec2 cell = mc + vec2( float( i ), float( j ) );
      vec2 mast = ( cell + 0.2 + 0.6 * vec2( afHash( cell + 13.0 ), afHash( cell + 71.0 ) ) ) * 90.0;
      float r = length( p - mast ) / 58.0;
      pools = max( pools, ( 1.0 - smoothstep( 0.0, 1.0, r ) ) * ( 0.75 + 0.25 * afHash( cell + 5.0 ) ) );
    }
    afFlood = det.a * ( 0.22 + 0.78 * pools ) * uAfApron.y;
  }
  // Dirt and grass clippings along the pavement edge.
  float edge = 1.0 - smoothstep( 0.0, 1.8, -sd );
  c *= mix( vec3( 1.0 ), vec3( 0.84, 0.85, 0.77 ), edge * uAfApronK.w );
  return c;
}
`;

/** The pavement material's color / roughness text with the flag on. */
export function apronPavement({ decl, color, roughness }) {
  const who = 'pavement';
  let c = color;
  c = swap(c, 'vec3 pave = mix( afAsphalt( afP, afFoot, 0.085 ), afConcrete( afP, afFoot, 0.8 ), concreteW );',
    'vec3 pave = uAfApron.x > 0.5 ? mix( afAsphaltApron( afP, afFoot ), afConcreteApron( afP, afFoot ), concreteW ) : mix( afAsphalt( afP, afFoot, 0.085 ), afConcrete( afP, afFoot, 0.8 ), concreteW );', who);
  c = swap(c, 'float mean = mix( 0.085, 0.315, concreteW );\n  pave *= clamp( level / mean, 0.72, 1.35 );',
    'float mean = uAfApron.x > 0.5 ? mix( 0.085, uAfApronC.x * 0.96, concreteW ) : mix( 0.085, 0.315, concreteW );\n  pave *= clamp( level / mean, 0.72, uAfApron.x > 0.5 ? uAfApronC.y : 1.35 );', who);
  c = swap(c, 'diffuseColor.rgb = pave;', 'if ( uAfApron.x > 0.5 ) pave = afApronWear( pave, afP, afFoot, concreteW );\ndiffuseColor.rgb = pave;', who);
  // Oil and polished tyre tracks are smoother than the surrounding surface.
  const r = `${roughness}\nif ( uAfApron.x > 0.5 ) roughnessFactor = clamp( roughnessFactor - afSheen, 0.0, 1.0 );`;
  // Night: the aprons' floodlight, lit with their own albedo and texture.
  const emissive = 'if ( uAfApron.x > 0.5 ) totalEmissiveRadiance += diffuseColor.rgb * uAfApronN.rgb * ( uAfApronN.w * afFlood );';
  return { decl: `${decl}\n${PAVE_DECL_ADD}`, color: c, roughness: r, emissive };
}

// --- grass ---

const GRASS_DECL_ADD = /* glsl */ `
${DETAIL_DECL}
float afShoulder = 0.0;
// Grass near the pavement and at scale: tonal patches that survive distance,
// a dusty worn verge, drier grass along the edges, and the paved shoulders of
// the big taxiways (drawn here, on the grass, so no geometry changes).
vec3 afGrassApron( vec3 grass, vec2 p, float foot ) {
  float big = afNoise( p / 330.0 + 19.0 ) * 0.6 + afNoise( p / 110.0 + 4.0 ) * 0.4;
  grass *= mix( vec3( 1.0 ), mix( vec3( 0.86, 0.92, 0.97 ), vec3( 1.13, 1.07, 0.93 ), big ), uAfApronG.y );
  float inBox;
  vec4 det = afDetailAt( p, inBox );
  if ( inBox < 0.5 ) return grass;
  float sd = ( det.g - 0.5 ) * ${(2 * FIELD_RANGE).toFixed(1)};
  float dc = det.r * ${FIELD_RANGE.toFixed(1)};
  // The taxiway's own edge from the exact centreline distance (the
  // signed edge distance comes from a raster and steps on diagonals): where
  // a taxiway is the nearest pavement, its shoulder and verge follow it.
  float te = dc - uAfApronS.w;
  float isTaxi = 1.0 - smoothstep( 1.0, 3.5, te - sd );
  float shW = uAfApronS.z;
  float wte = max( fwidth( te ), 1e-3 );
  float shoulder = shW > 0.5 ? afBand( te, -1.0, shW, wte ) * isTaxi : 0.0;
  float v0 = max( mix( sd, te - shW, isTaxi ), 0.0 );
  float verge = ( 1.0 - smoothstep( 0.0, 3.5, v0 ) ) * step( -0.5, sd );
  float dry = 1.0 - smoothstep( 2.0, 14.0, v0 );
  grass = mix( grass, grass * vec3( 1.22, 1.1, 0.82 ) + vec3( 0.016, 0.01, 0.0 ), dry * 0.45 * uAfApronG.z );
  vec3 dust = vec3( 0.15, 0.137, 0.105 ) * ( 0.85 + 0.3 * afNoiseAA( p * 1.7, 1.0, foot * 1.7 ) );
  grass = mix( grass, dust, verge * ( 0.35 + 0.3 * afNoiseAA( p / 1.3 + 9.0, 1.0, foot / 1.3 ) ) * uAfApronG.z );
  // Shoulder: aged asphalt, lighter toward its outer edge where dust settles.
  vec3 sh = vec3( 0.105, 0.103, 0.098 ) * ( 0.85 + 0.3 * afNoise( p / 9.0 ) ) * ( 0.9 + 0.2 * afNoiseAA( p, 1.0 / 0.3, foot ) );
  sh *= 1.0 + 0.25 * smoothstep( shW * 0.4, shW, te );
  afShoulder = shoulder;
  return mix( grass, sh, shoulder );
}
`;

/** The grass material's text with the flag on. */
export function apronGrass({ decl, color, roughness }) {
  const who = 'grass';
  let c = color;
  // Mowing stripes catch the light by viewing direction: blades laid toward
  // the eye read dark, away from it light, and side-on the swaths vanish.
  c = swap(c, 'grass *= 1.0 + ( stripe - 0.5 ) * 0.17 * mowed;',
    'float mowK = 0.17;\nif ( uAfApron.x > 0.5 ) mowK = uAfApronG.x * dot( normalize( afP - uAfApron.zw + vec2( 1e-3, 0.0 ) ), uAfMow.xy );\ngrass *= 1.0 + ( stripe - 0.5 ) * mowK * mowed;', who);
  c = swap(c, 'diffuseColor.rgb = grass;', 'if ( uAfApron.x > 0.5 ) grass = afGrassApron( grass, afP, afFoot );\ndiffuseColor.rgb = grass;', who);
  const r = `${roughness}\nif ( uAfApron.x > 0.5 ) roughnessFactor = mix( roughnessFactor, 0.84, afShoulder );`;
  return { decl: `${decl}\n${GRASS_DECL_ADD}`, color: c, roughness: r };
}

// --- runway ---

const RWY_DECL_ADD = /* glsl */ `
uniform vec4 uAfApron;
uniform vec4 uAfApronG;
uniform vec4 uAfApronC;
float afGaussAA( float x, float mu, float s, float w ) {
  float s2 = sqrt( s * s + w * w / 12.0 );
  float t = ( x - mu ) / s2;
  return s / s2 * exp( -0.5 * t * t );
}
`;

/** The runway material's text with the flag on: roll wear down the centre, a gentler imagery level. */
export function apronRunway({ decl, color }) {
  const who = 'runway';
  let c = color;
  c = swap(c, 'base *= clamp( RD.z / mean, 0.75, 1.4 )',
    'base *= clamp( RD.z / mean, 0.75, uAfApron.x > 0.5 ? uAfApronC.z : 1.4 )', who);
  // Every take-off and landing roll wears the centre: nose and main gear
  // rubber along the whole length, lighter than in the touchdown zones.
  c = swap(c, 'rubber = clamp( rubber, 0.0, 1.0 ) * ( 1.0 - shoulder );',
    `if ( uAfApron.x > 0.5 ) {
  float roll = afGaussAA( abs( c ), 0.0, 1.4, w.y ) * 0.5 + afGaussAA( abs( c ), 5.5, 2.2, w.y ) * 0.6;
  roll *= ( 0.6 + 0.6 * afNoiseAA( vec2( s / 70.0, c * 0.6 ), 1.0, max( w.y * 0.6, w.x / 70.0 ) ) ) * smoothstep( 40.0, 260.0, min( s - thrA, ( L - s ) - thrB ) );
  rubber = max( rubber, roll * uAfApronG.w );
}
rubber = clamp( rubber, 0.0, 1.0 ) * ( 1.0 - shoulder );`, who);
  return { decl: `${decl}\n${RWY_DECL_ADD}`, color: c };
}

// --- paint ---

const PAINT_DECL_ADD = /* glsl */ `
uniform vec4 uAfApron;
uniform vec4 uAfApronK;
uniform sampler2D uAfPave;
uniform float uAfPaveOn;
uniform vec4 uAfGrid;
uniform vec2 uAfSize;
`;

/** The paint material's text with the flag on: black borders on light pavement, nose-gear wear. */
export function apronPaint({ decl, color }) {
  const who = 'paint';
  let c = color;
  // How much the pavement under the paint is concrete (light): the black
  // border light pavement carries for contrast (FAA AC 150/5340-1).
  c = swap(c, 'float cov = 0.0;',
    `float cov = 0.0;
float afBorder = 0.0;
if ( uAfApron.x > 0.5 && uAfPaveOn > 0.5 ) afBorder = smoothstep( 0.35, 0.75, texture( uAfPave, ( ( afP - uAfGrid.xy ) * uAfGrid.z + 0.5 ) / uAfSize ).r ) * uAfApronK.z;`, who);
  c = swap(c, `  col = mix( vec3( 0.025, 0.024, 0.024 ), yellow, line );
  alpha = max( line, rub );`,
    `  if ( uAfApron.x > 0.5 ) {
    line *= 1.0 - 0.3 * afNoiseAA( vec2( v / 2.5, u * 3.0 ), 1.0, max( wv / 2.5, wu * 3.0 ) ) * exp( -pow( u / 0.25, 2.0 ) );
    // The nose-gear rubber as a continuous smear (the base's noise breaks
    // it into dashes that read as hazard tape at distance).
    rub = exp( -pow( u / 1.1, 2.0 ) ) * ( 0.6 + 0.4 * afNoiseAA( vec2( v / 23.0, u * 1.7 ), 1.0, max( wu * 1.7, wv / 23.0 ) ) ) * 0.3;
    float blk = max( afBand( u, -0.3, 0.3, wu ) * afBorder, rub );
    alpha = max( line, blk );
    col = mix( vec3( 0.022, 0.021, 0.021 ), yellow, line / max( alpha, 1e-4 ) );
  } else {
  col = mix( vec3( 0.025, 0.024, 0.024 ), yellow, line );
  alpha = max( line, rub );
  }`, who);
  c = swap(c, '  alpha = max( l1, l2 );',
    `  alpha = max( l1, l2 );
  if ( uAfApron.x > 0.5 ) {
    float blk = afBand( u, -0.3, 0.45, wu ) * afBorder;
    col = mix( vec3( 0.022, 0.021, 0.021 ), yellow, alpha / max( max( alpha, blk ), 1e-4 ) );
    alpha = max( alpha, blk );
  }`, who);
  c = swap(c, '  alpha = max( solid, dashed ) * across;',
    `  alpha = max( solid, dashed ) * across;
  if ( uAfApron.x > 0.5 ) {
    float blk = afBand( v, -0.15, 2.25, wv ) * across * afBorder;
    col = mix( vec3( 0.022, 0.021, 0.021 ), yellow, alpha / max( max( alpha, blk ), 1e-4 ) );
    alpha = max( alpha, blk );
  }`, who);
  return { decl: `${decl}\n${PAINT_DECL_ADD}`, color: c };
}

/** The program-cache suffix of a patched layer (the flag-off key is unchanged). */
export const APRON_KEY = 'apron1';
