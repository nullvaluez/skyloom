/**
 * SPOTTER TRAILS — deterministic node gate (no browser, no GPU).
 *
 * Proves, from the app's own modules, the contracts the satellite traffic
 * trails (TRACERS.spot, lib/fly/tracer-spot.js) are built on:
 *   (1) layout: one Uint16 draw, contiguous rank regions, consistent counts;
 *   (2) gains vs the satellite bloom thresholds in force (1.08 day, 0.91
 *       night + 0.2 smoothing): the day body cannot bloom over any backdrop,
 *       the night head does, the body does not, the glint core always does;
 *   (3) the R16 taste rule: day added light is pale, night keeps its neon;
 *   (4) pixel floors at every buffer height / FOV, and the air-bend
 *       compensation against the real airDrop();
 *   (5) the length law and world spacing bounds;
 *   (6) spacing UNITS: backfilled and recorded trails agree;
 *   (7) far-tier decimation never slides;
 *   (8) shader integrity against three's REAL ShaderLib text, cache keys;
 *   (9) source contracts (dim-never-cull literal, toy off, band list, prewarm).
 *
 * Run: node scripts/verify-tracer-spot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { MeshBasicMaterial, ShaderLib } from 'three';

register('./_node-resolve.mjs', import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = await import('../lib/fly/tracer-spot.js');
const WB = await import('../lib/fly/toy-world/world-bend.js');
const { TRACERS, GLOBE } = await import('../lib/fly/fly-constants.js');
const { makeWakeMaterial } = await import('../lib/fly/aircraft-wake.js');
const S = TRACERS.spot;

let pass = 0;
const fails = [];
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass += 1;
  else fails.push(name);
};
const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const chroma = (c) => {
  const mx = Math.max(c.r, c.g, c.b);
  return mx > 0 ? (mx - Math.min(c.r, c.g, c.b)) / mx : 0;
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- (1) layout ------------------------------------------------------------
const geo = T.buildSpotGeometry();
const idx = geo.getIndex().array;
gate('(1a) one Uint16 draw: 19,200 verts / 51,456 indices', T.SPOT_VERTS === 19200 && T.SPOT_INDICES === 51456 && idx instanceof Uint16Array, `${T.SPOT_VERTS} / ${T.SPOT_INDICES} ${idx.constructor.name}`);
gate('(1b) rank regions cover TRACERS.max exactly', S.nearSlots + S.farSlots === TRACERS.max && T.SPOT_SLOTS === TRACERS.max);
gate('(1c) far pairs hold the decimated ring + head', S.farPairs >= 2 + Math.ceil(S.points / S.farStride));
let maxIdx = 0;
for (let i = 0; i < idx.length; i++) if (idx[i] > maxIdx) maxIdx = idx[i];
gate('(1d) every index is inside the vertex buffer', maxIdx === T.SPOT_VERTS - 1, `max ${maxIdx}`);
const counts = [0, 1, 96, 97, 512].map((n) => [n, T.spotDrawCount(n), T.spotUsedVerts(n)]);
gate(
  '(1e) draw range / used verts are contiguous and end at the buffer',
  T.spotDrawCount(512) === T.SPOT_INDICES && T.spotUsedVerts(512) === T.SPOT_VERTS && T.spotSlotBase(96) === T.spotUsedVerts(97) - 30 && T.spotSlotBase(95) === T.spotUsedVerts(96) - 70 && T.spotSlotBase(96) === 96 * 70,
  JSON.stringify(counts)
);
const tr = geo.getAttribute('aTracer').array;
let glintVerts = 0;
for (let v = 0; v < T.SPOT_VERTS; v++) if (tr[v * 3 + 2] === 1) glintVerts += 1;
gate('(1f) one 4-vertex glint per slot', glintVerts === 4 * TRACERS.max, `${glintVerts}`);

// ---- (2) gains ---------------------------------------------------------------
const noon = T.spotPalette({ n: 0, v: 1, g: 0, oc: 0 }, T.makeSpotPalette());
const night = T.spotPalette({ n: 1, v: 0, g: 0, oc: 0 }, T.makeSpotPalette());
// Day head end: optical vapour (lum ≤ cap, includes the sheen) over the sky + emission.
const aHead = noon.alphaPeak;
const eHead = noon.emitPeak + noon.headBoost;
const worst = Math.max(...[0, 0.3, 0.55, 0.95].map((bg) => S.look.vaporMaxLum * aHead + bg * (1 - aHead) + eHead));
gate('(2a) day head-end pixel < 1.08 bloom over any backdrop ≤ 0.95', worst < 1.08, worst.toFixed(3));
const tp08 = S.body.tailFloor + (1 - S.body.tailFloor) * 0.8;
gate('(2b) night body (tt ≤ 0.8) stays under bloom', night.emitPeak * tp08 <= 0.85, (night.emitPeak * tp08).toFixed(3));
const nh = night.emitPeak + night.headBoost;
gate('(2c) night head is a soft glow, not a flare (0.9–1.2)', nh >= 0.9 && nh <= 1.2, nh.toFixed(3));
const gDay = noon.glintCol.map((c) => luma(c) * noon.glintGain);
const gNight = night.glintCol.map((c) => luma(c) * night.glintGain);
gate(
  '(2d) the glint is a soft dot, not a star: day 0.6–1.0, night 1.0–1.5 luma, no spikes',
  Math.min(...gDay) >= 0.6 && Math.max(...gDay) <= 1.0 && Math.min(...gNight) >= 1.0 && Math.max(...gNight) <= 1.5 && night.spike === 0 && S.glint.pulse.depth === 0,
  `${Math.max(...gDay).toFixed(2)} / ${Math.max(...gNight).toFixed(2)}`
);
const PR = S.prominence;
gate(
  '(2e) prominence follows reach: full ≤ 15 km, glint gone by ≤ 50 km, far body a faint floor',
  PR.fullM <= 15000 && PR.glintFullM <= PR.glintFarM && PR.glintFarM <= 50000 && PR.fullM < PR.farM && PR.bodyFar > 0 && PR.bodyFar <= 0.4,
  JSON.stringify(PR)
);
{
  // Night: additive light over black reads at any level, so the law must be
  // steep — the far body a small fraction of the in-reach one, yet never 0.
  const pr = (d, n, pin = false) => ({ ...T.spotProminence(d, n, pin, {}) });
  const eN = (d) => {
    const p = pr(d, 1);
    return p.body * p.emit;
  };
  const r48 = eN(48000) / eN(10000);
  const r64 = eN(64000) / eN(10000);
  const day = pr(48000, 0);
  const pin = pr(90000, 1, true);
  gate(
    '(2f) night far emission recedes steeply (48 km ≤ 10 % of in-reach) but stays a line (> 0); day law untouched; the pinned target exempt',
    r48 <= 0.1 && r64 > 0 && r64 <= r48 && day.emit === 1 && pr(40000, 1).glint === 0 && pin.glint === 1 && pin.emit === 1,
    `48 km ${(100 * r48).toFixed(1)} % · 64 km ${(100 * r64).toFixed(1)} %`
  );
}

// ---- (3) R16 -----------------------------------------------------------------
const dayAdded = noon.bodyEmit.map((ec) => ({
  r: noon.vapor.r * aHead + ec.r * noon.emitPeak,
  g: noon.vapor.g * aHead + ec.g * noon.emitPeak,
  b: noon.vapor.b * aHead + ec.b * noon.emitPeak,
}));
const dayChroma = Math.max(...dayAdded.map(chroma));
gate('(3a) day added light is pale vapour (chroma ≤ 0.30, every band)', dayChroma <= 0.3, dayChroma.toFixed(3));
gate('(3b) night cruise emission keeps its neon (chroma ≥ 0.8)', chroma(night.bodyEmit[3]) >= 0.8, chroma(night.bodyEmit[3]).toFixed(3));
{
  // R18 overcast ADDS white emission: an overcast day line must stay pale.
  const oc = T.spotPalette({ n: 0, v: 1, g: 0, oc: 1 }, T.makeSpotPalette());
  const added = oc.bodyEmit.map((ec) => ({
    r: oc.vapor.r * oc.alphaPeak + ec.r * oc.emitPeak,
    g: oc.vapor.g * oc.alphaPeak + ec.g * oc.emitPeak,
    b: oc.vapor.b * oc.alphaPeak + ec.b * oc.emitPeak,
  }));
  const c = Math.max(...added.map(chroma));
  gate('(3c) overcast day added light stays pale (chroma ≤ 0.30, every band)', c <= 0.3, c.toFixed(3));
}

// ---- (4) floors + air-bend compensation --------------------------------------
let floorOk = true;
for (const H of [540, 720, 1080, 2160]) {
  const hRef = H / S.width.refHeightPx;
  const head = Math.max(S.width.minHeadPx, S.width.floorHeadPx * hRef);
  const tail = Math.max(S.width.minTailPx, S.width.floorTailPx * hRef);
  const r = Math.max(S.glint.minRadiusPx, S.glint.radiusPx * hRef);
  const far = r * Math.max(S.glint.farScale, S.glint.farMinPx / r);
  if (head < 1.25 || tail < 1.0 || far < 2.0) floorOk = false;
}
gate('(4a) floors ≥ 1.25 / 1.0 px and far glint ≥ 2.0 px at 540–2160 rows', floorOk);
// Seed the real air bend (satellite-like k at 40.7°N) and compare the
// compensation against a finite difference of the rendered position.
const k = 1 / (2 * 1e6 * (1 / Math.cos((40.7 * Math.PI) / 180)) ** 2);
WB.setBend(0, 0, k);
WB.setBendEye(3000, 0);
WB.applyBendAir(new MeshBasicMaterial(), GLOBE.trafficBend); // seeds uAirAgl/cap/lift from the same cfg
const comp = { vS: 1, rho: 1 };
const hx = 0, hy = 3000 + 9000, hz = -40000;
T.spotAirComp(comp, hx, hy, hz, 0, 3000, 0, WB.getBend());
const d = Math.hypot(hx, hz);
const rendered = (y) => y - WB.airDrop(d, y);
const vFD = (rendered(hy + 1) - rendered(hy - 1)) / 2;
gate('(4b) vS mirrors the rendered vertical scale of the far-lift', Math.abs(comp.vS - vFD) < 0.02 && comp.vS > 1.2, `vS ${comp.vS.toFixed(3)} vs ${vFD.toFixed(3)}`);
const rhoTrue = Math.hypot(hx, rendered(hy) - 3000, hz) / Math.hypot(hx, hy - 3000, hz);
gate('(4c) rho is the rendered / unbent head distance', Math.abs(comp.rho - rhoTrue) < 1e-6, comp.rho.toFixed(4));

// ---- (5) length law ----------------------------------------------------------
const L8 = T.spotLengthM(8000, 220);
const L80 = T.spotLengthM(80000, 220);
let mono = true;
for (let dd = 0, prev = 0; dd <= 200000; dd += 1000) {
  const L = T.spotLengthM(dd, 220);
  if (L + 1e-9 < prev) mono = false;
  prev = L;
}
const sp70 = Math.min(S.length.maxSpacingWorldM, (S.length.maxM / S.points) / Math.cos((70 * Math.PI) / 180));
gate('(5) L(8 km) = 4 km, 12 ≤ L(80 km) ≤ 14 km, monotone, spacing ≤ 0.6·warpReset at 70°N', Math.abs(L8 - 4000) < 1e-6 && L80 >= 12000 && L80 <= 14000 && mono && sp70 <= 0.6 * TRACERS.ribbon.warpResetM, `${L8} / ${L80.toFixed(0)} / ${sp70.toFixed(0)}`);

// ---- (6) spacing units -------------------------------------------------------
for (const lat of [40.7, 60]) {
  const kT = 1 / Math.cos((lat * Math.PI) / 180);
  const speed = 250;
  const Lm = T.spotLengthM(30000, speed);
  const spW = Math.min(S.length.maxSpacingWorldM, (Lm / S.points) * kT);
  const fix = { vE: speed, vN: 0, vUp: 0, latRad: (lat * Math.PI) / 180 };
  const back = T.newSpotRec([], 'aaaaaa');
  T.backfillSpot(back, fix, 0, 9000, 0, spW, kT, Lm);
  const span = (rec) => {
    const o = T.lastSpotIndex(rec);
    const oldest = ((rec.head - rec.cnt + S.points) % S.points) * 3;
    return Math.hypot(rec.buf[o] - rec.buf[oldest], rec.buf[o + 2] - rec.buf[oldest + 2]);
  };
  const live = T.newSpotRec([], 'bbbbbb');
  let x = 0;
  for (let step = 0; step < 120000; step++) {
    x += (speed * kT) / 60; // world metres per 60 Hz frame
    const li = T.lastSpotIndex(live);
    if (live.cnt === 0 || Math.abs(x - live.buf[li]) >= spW) T.appendSpot(live, x, 9000, 0);
  }
  const ratio = span(live) / span(back);
  gate(`(6) recorded ≡ backfilled trail length at ${lat}°`, Math.abs(ratio - 1) < 0.03, ratio.toFixed(3));
}

// ---- (7) decimation stability ------------------------------------------------
{
  const rec = T.newSpotRec([], 'cccccc');
  const out = new Float64Array((S.points + 1) * 3);
  let stable = true;
  let prev = null;
  for (let i = 0; i < 200; i++) {
    T.appendSpot(rec, i, 0, 0); // x = absolute append index
    const m = T.gatherSpot(rec, S.farStride, -1, 0, 0, out);
    const picked = new Set();
    for (let j = 1; j < m - 1; j++) picked.add(out[j * 3]); // skip the oldest (always kept) and the head
    if (prev) for (const v of prev) if (v > i - rec.cnt + 1 && !picked.has(v)) stable = false;
    prev = picked;
    if (m > S.farPairs) stable = false;
  }
  gate('(7) far decimation is seq-anchored (no crawl) and fits farPairs', stable);
}

// ---- (8) shader integrity ----------------------------------------------------
const compile = (mat) => {
  const sh = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} };
  mat.onBeforeCompile(sh, null);
  return sh;
};
const spot = T.makeSpotTracerMaterial();
const sh = compile(spot);
const once = (s, needle) => s.split(needle).length - 1 === 1;
gate(
  '(8a) tracer program: verbatim air projection + glint + gate + band',
  sh.vertexShader.includes('float dropRaw = bendD * bendD * uBendK;') &&
    sh.vertexShader.includes('vTracer = aTracer;') &&
    sh.vertexShader.includes('gl_Position.xy += aTracer.xy') &&
    sh.fragmentShader.includes('ovCloudGate( vOvW )') &&
    sh.fragmentShader.includes('uTrFade') &&
    ['uTrPx', 'uOvCloud', 'uBendK', 'uEdgeFade', 'uTrMarkFloor'].every((u) => u in sh.uniforms)
);
gate('(8b) tracer key is distinct and starts with world-bend-air', spot.customProgramCacheKey() === 'world-bend-air-tracer-v1');
const air = new MeshBasicMaterial();
WB.applyBendAir(air, GLOBE.trafficBend);
WB.applyOverlayCloudGate(air);
const airSh = compile(air);
const anc = new MeshBasicMaterial();
WB.applyBendAirAnchor(anc, GLOBE.trafficBend);
WB.applyOverlayCloudGate(anc, { floor: 0.2 });
const ancSh = compile(anc);
gate(
  '(8c) overlay gate wraps air and air-anchor exactly once',
  once(airSh.vertexShader, 'vOvW = wPos.xyz;') &&
    once(ancSh.vertexShader, 'vOvW = wPos.xyz;') &&
    airSh.fragmentShader.includes('gl_FragColor.a *= max( ovCloudGate( vOvW ), uOvFloor );') &&
    ancSh.uniforms.uOvFloor.value === 0.2 &&
    air.customProgramCacheKey() === 'world-bend-air|ovgate-v1' &&
    anc.customProgramCacheKey() === 'world-bend-air-anchor|ovgate-v1'
);
const wake = makeWakeMaterial(T.patchAirWake);
const wakeSh = compile(wake);
gate(
  '(8d) plume key + chain (gate before optical softening)',
  wake.customProgramCacheKey() === 'world-bend-air|ovgate-v1|optical-wake-v1' && wakeSh.fragmentShader.includes('ovCloudGate') && wakeSh.vertexShader.includes('vWake = aWake;')
);
gate('(8e) the gate slab mirrors the cloud march literal', read('lib/fly/immersive-cloud-pass.js').includes('float low=base-600.,high=base+thickness;') && (await import('../lib/fly/overlay-gate.js')).OV_SLAB_PAD_M === 600);

// ---- (9) source contracts ----------------------------------------------------
const tt = read('components/fly/TrafficTracers.jsx');
const spotSrc = tt.slice(tt.indexOf('function SpotTracers('), tt.indexOf('// Ribbon mode'));
gate('(9a) dim, never cull: the legacy skip literal is in SpotTracers', spotSrc.includes('if (displayAlpha * hFade <= 0.02) continue;'));
gate('(9b) toy never mounts the spot path', T.spotTracersOn('toy') === false && T.spotTracersOn('satellite') === S.enabled);
const bands = [...tt.matchAll(/\[\s*[\d.e+Infinity]+,\s*new Color\('(#[0-9a-f]{6})'\)\]/gi)].map((m) => m[1].toLowerCase());
gate('(9c) band list is the legacy BANDS', JSON.stringify(bands) === JSON.stringify(T.BAND_HEX), bands.join(' '));
const pw = read('lib/fly/prewarm.js');
gate(
  '(9d) prewarm builds the same factories (+ attribute sizes)',
  pw.includes('makeSpotTracerMaterial()') && pw.includes('makeWakeMaterial(patchAirWake)') && pw.includes('applyOverlayCloudGate(m,') && /aTracer:\s*3/.test(pw) && /aWake:\s*3/.test(pw)
);
{
  const a = spotSrc.indexOf('if (dev && window.__flyStats) {');
  const b = spotSrc.indexOf('\n    }\n', a);
  const rest = a > 0 && b > a ? spotSrc.slice(0, a) + spotSrc.slice(b) : spotSrc;
  const refs = [...rest.matchAll(/.{0,8}window\.__fly\w+/g)].map((m) => m[0]);
  gate(
    '(9e) dev stats and pins in SpotTracers sit behind NODE_ENV',
    spotSrc.includes("const dev = process.env.NODE_ENV === 'development';") && a > 0 && refs.every((r) => r.includes('dev && ')),
    refs.join(' | ')
  );
}

console.log(`\n${pass} passed, ${fails.length} failed`);
console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
process.exit(fails.length ? 1 : 0);
