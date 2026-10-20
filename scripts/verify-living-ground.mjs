/**
 * LIVING WORLD (GROUND) — verify-living-ground: NIGHT_LIGHTS and GROUND_MIST
 * (lib/fly/night-lights-atlas.js, lib/fly/ground-mist.js, the Enhanced
 * aerial pass in components/fly/AerialPerspective.jsx).
 *
 *  (1) tile math: GIBS/XYZ tiles of known places, scene <-> tile round trips
 *  (2) the window: re-centres with 1.5-2.5 tile margins, holds inside its
 *      hysteresis band, toroidal slots never collide inside a window
 *  (3) the atlas: 4x4 slots per band, nearest ring and coarse band first, a
 *      window step replaces exactly one row/column (aborting its requests,
 *      zeroing its texels) and keeps the rest; poles and 4xx are no-data; a
 *      failure retries later and enough of them pause the source
 *  (4) uploads: whole array before the GPU has a copy, then one slot
 *      rectangle per commit at the right layer and offset; arrival fades
 *  (5) the colour key: moonlit sea, snow and desert in Black Marble's
 *      palette are black; warm and white lights pass, monotonic in brightness
 *  (6) the night weight and the range ramp: endpoints, monotonic, the ramp
 *      leaves the generated lights alone low and takes the whole view high
 *  (7) the mist profile: dawn > dusk > night > noon = 0, weather adds; the
 *      floor follows valleys down fast and rises slowly, re-seeds on a warp;
 *      the closed-form optical depth matches numerical integration; the cover
 *      field is periodic over 65,536 scene units (a rebase never moves it)
 *  (8) the drivers: day = no atlas and zero strength; night = an atlas whose
 *      band origins match the window; fixture / Low tier / Classic = dark;
 *      release after a day; the mist is off outside Enhanced and on Low
 *  (9) shader text: flags off = the pre-pass Enhanced program byte for byte
 *      and no new uniform; on = anchored edits (PHYS_SKY and TRUE_SCALE still
 *      patched, verify-phys-sky's substrings intact); each flag alone; the
 *      plain living-air path without PHYS_SKY; a moved anchor throws
 *
 * Run: node scripts/verify-living-ground.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const legArg = process.argv.find((a) => a.startsWith('--leg='));

async function loaders() {
  const { register } = await import('node:module');
  register('./_node-resolve.mjs', import.meta.url);
  register('./_alias-loader.mjs', import.meta.url);
  register('./_r25-c-jsx-loader.mjs', import.meta.url);
}

if (legArg) {
  // One flag state per process: the flags decide program text at module load.
  const leg = legArg.slice(6);
  const pins = {};
  if (leg === 'off' || leg === 'gm') pins.__flyNightLightsOverride = { enabled: false };
  if (leg === 'off' || leg === 'nl') pins.__flyGroundMistOverride = { enabled: false };
  if (leg === 'nophys') pins.__flyPhysSkyOverride = { enabled: false };
  globalThis.window = { location: { search: '', href: 'http://localhost/' }, ...pins };
  const inert = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert, construct: () => inert });
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
  await loaders();
  const AP = await imp('components/fly/AerialPerspective.jsx');
  const RT = await imp('lib/fly/atmosphere/runtime.js');
  const TS = await imp('lib/fly/true-scale.js');
  const LW = await imp('lib/fly/living-world.js');
  const e = new AP.AerialPerspectiveEffect({ r25: true });
  const classic = new AP.AerialPerspectiveEffect();
  const text = e.fragmentShader;
  const base = AP.ENHANCED_AERIAL_TEXT_BASE;
  // A moved anchor must throw, never silently drop the feature.
  const throws = [];
  for (const anchor of ['void mainImage(const in vec4 inputColor', 'float transmission=livingAirTransmission(', 'outputColor=vec4((inputColor.rgb*transmittance']) {
    try {
      AP.livingGroundShader(base.replace(anchor, `${anchor}/*moved*/`), { nl: true, gm: true });
      throws.push(false);
    } catch {
      throws.push(true);
    }
  }
  let physMoved = false;
  try {
    AP.livingGroundShader(base.replace('vec3 lit=inputColor.rgb*apT', 'vec3 lit = inputColor.rgb*apT'), { nl: true, gm: true, phys: true });
  } catch {
    physMoved = true;
  }
  console.log(JSON.stringify({
    flags: LW.livingWorldFlags(),
    phys: RT.PHYS_SKY_SHADERS['aerial-enhanced'],
    ts: TS.TRUE_SCALE_SHADERS['aerial-enhanced'],
    equalsBase: text === base,
    baseClean: !/lwGround|lwSurf|uNL|uGM|nlEmission|gmMist/.test(base),
    hasGround: text.includes('vec3 lwSurf=lwGround(inputColor.rgb,world,metricRay,trueY,dXZ,haze);'),
    hasNl: text.includes('nlEmission('),
    hasGm: text.includes('gmMist('),
    physUsesSurf: text.includes('vec3 lit=lwSurf*apT+apS*uPskySunIllum+pskyNightAir(apDir)*(1.-apT);'),
    plainUsesSurf: text.includes('outputColor=vec4((lwSurf*transmittance+haze*(1.-transmittance))*uR25Exposure,inputColor.a);'),
    keepsPhysSubstrings: text.includes('pskyAerial(') === base.includes('pskyAerial(') && text.includes('pskyNightAir(apDir)*(1.-apT)') === base.includes('pskyNightAir(apDir)*(1.-apT)'),
    noInputLeft: !/inputColor\.rgb\*apT|inputColor\.rgb\*transmittance/.test(text) || text === base,
    uniforms: [...e.uniforms.keys()],
    classicHasNone: ![...classic.uniforms.keys()].some((k) => k.startsWith('uNL') || k.startsWith('uGM')) && !/lwGround/.test(classic.fragmentShader),
    throws,
    physMoved,
    len: text.length,
    baseLen: base.length,
  }));
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

await loaders();
const NLm = await imp('lib/fly/night-lights-atlas.js');
const GMm = await imp('lib/fly/ground-mist.js');
const { NIGHT_LIGHTS, GROUND_MIST } = await imp('lib/fly/fly-constants.js');
const NL = NLm.resolveNightLights(NIGHT_LIGHTS);
const GM = GMm.resolveGroundMist(GROUND_MIST);

// (1) tile math
{
  const t = (lon, lat, z) => {
    const p = NLm.geoToScene(lon, lat);
    const c = NLm.sceneToTile(p.x, p.z, z);
    return [Math.floor(c.tx), Math.floor(c.ty)];
  };
  // Known XYZ tiles (z/x/y): Philadelphia-NYC z7 37/48, Chicago z8 65/95, Innsbruck z8 136/89, the Nile z6 37/27.
  const cases = [[-74.0, 40.7, 7, 37, 48], [-87.63, 41.88, 8, 65, 95], [11.39, 47.27, 8, 136, 89], [31, 27, 6, 37, 27]];
  const bad = cases.filter(([lon, lat, z, x, y]) => { const [tx, ty] = t(lon, lat, z); return tx !== x || ty !== y; });
  const p = NLm.geoToScene(0, 0);
  const span8 = NLm.NL_WORLD / 256;
  const c0 = NLm.sceneToTile(p.x, p.z, 8);
  check('(1) GIBS/XYZ tiles of known places; the origin is the centre of the world', bad.length === 0 && near(c0.tx, 128, 1e-9) && near(c0.ty, 128, 1e-9) && near(span8, 156543.03, 0.01),
    bad.length ? `bad: ${JSON.stringify(bad)}` : 'NYC z7 37/48, Chicago z8 65/95, Innsbruck z8 136/89, Nile z6 37/27');
}

// (2) the window
{
  let ok = true;
  const notes = [];
  for (let t = 0.05; t < 40; t += 0.37) {
    const s = NLm.windowStart(NaN, t);
    const lo = t - s, hi = s + 4 - t;
    if (lo < 1.5 - 1e-9 || hi < 1.5 - 1e-9) { ok = false; notes.push(`re-centre t=${t.toFixed(2)} margins ${lo.toFixed(2)}/${hi.toFixed(2)}`); }
    // Held inside the hysteresis band, re-centred outside it.
    if (NLm.windowStart(s, t + 0.25) !== s) { ok = false; notes.push(`no hold at t=${t.toFixed(2)}`); }
    if (NLm.windowStart(s, s + 0.9) === s) { ok = false; notes.push('kept a window with under 1.2 tiles of margin'); }
  }
  // Thrash test: oscillating across a tile edge never moves the window.
  let s = NLm.windowStart(NaN, 10.5), moves = 0;
  for (let i = 0; i < 200; i++) { const n = NLm.windowStart(s, 10.5 + 0.3 * Math.sin(i)); if (n !== s) moves++; s = n; }
  // Toroidal slots: the 16 tiles of any window map to 16 distinct slots.
  let distinct = true;
  for (const [x0, y0] of [[0, 0], [5, 9], [-3, 7], [253, 1]]) {
    const set = new Set();
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) set.add(NLm.slotIndex(x0 + dx, y0 + dy));
    if (set.size !== 16) distinct = false;
  }
  check('(2) window: 1.5-2.5 tile margins, hysteresis holds, no thrash, 16 distinct toroidal slots', ok && moves === 0 && distinct, notes.slice(0, 3).join('; ') || `moves ${moves}`);
}

// (3) the atlas state machine, with a fake fetcher and clock
const flush = () => new Promise((r) => setTimeout(r, 0));
{
  let clock = 100;
  const calls = [];
  const resolvers = new Map();
  const fetchTile = (z, x, y, signal) => new Promise((resolve, reject) => {
    calls.push({ z, x, y, signal });
    resolvers.set(`${z}/${x}/${y}`, { resolve, reject, signal });
    signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const a = new NLm.NightLightsAtlas({ bands: [6, 7, 8], slotPx: 4, maxRequests: 100, fetchTile, fadeSec: 1, clock: () => clock, retrySec: [5, 10], offlineAfter: 1000 });
  const p = NLm.geoToScene(-87.63, 41.88); // Chicago
  a.update(p.x, p.z, clock);
  await flush();
  const perBand = [6, 7, 8].map((z) => calls.filter((c) => c.z === z).length);
  // Request order: the camera's own tiles (ring 0) of each band come first, coarse band first.
  const first3 = calls.slice(0, 3).map((c) => c.z).join(',');
  const own = calls.slice(0, 3).every((c) => {
    const tt = NLm.sceneToTile(p.x, p.z, c.z);
    return c.x === Math.floor(tt.tx) && c.y === Math.floor(tt.ty);
  });
  // Arrivals: band z8 all ready with a byte pattern; z6 one 404-like null; z7 one failure.
  const bytes = (v) => new Uint8Array(16).fill(v);
  for (const [k, r] of resolvers) if (k.startsWith('8/')) r.resolve(bytes(200));
  const z6 = [...resolvers.keys()].filter((k) => k.startsWith('6/'));
  resolvers.get(z6[0]).resolve(null);
  for (const k of z6.slice(1)) resolvers.get(k).resolve(bytes(50));
  const z7 = [...resolvers.keys()].filter((k) => k.startsWith('7/'));
  resolvers.get(z7[0]).reject(new Error('Failed to fetch'));
  for (const k of z7.slice(1)) resolvers.get(k).resolve(bytes(90));
  await flush();
  const cen = a.census();
  const failed = a.bands[1].slots.find((s) => s.state === 'error');
  check('(3a) 4x4 slots per band, own tiles first (coarse band first), ready / no-data / error recorded',
    perBand.join(',') === '16,16,16' && first3 === '6,7,8' && own && cen.ready === 46 && cen.noData === 1 && cen.error === 1 && failed && near(failed.retryAt, 105, 1e-9),
    `per band ${perBand}, first ${first3}, census ${JSON.stringify(cen)}`);

  // A window step east on z8: exactly one column is replaced and its requests aborted.
  const b8 = a.bands[2];
  const keysBefore = b8.slots.map((s) => s.key);
  const ready8 = b8.slots.filter((s) => s.state === 'ready').length;
  calls.length = 0;
  const step = b8.span * 1.2; // > the hysteresis margin
  clock = 101;
  // Leave one in-flight request on the column that will be replaced: re-queue a slot first.
  const leaving = b8.minX;
  const leavingSlot = b8.slots.find((s) => Number(s.key.split('/')[1]) === leaving);
  const leavingIdx = b8.slots.indexOf(leavingSlot);
  // Mark one texel so the clear is visible.
  const side = a.side, sx = (leavingIdx % 4) * a.slot, sy = Math.floor(leavingIdx / 4) * a.slot;
  const texel = 2 * side * side + sy * side + sx;
  const was = a.data[texel];
  a.update(p.x + step * 1.0, p.z, clock);
  await flush();
  const keysAfter = b8.slots.map((s) => s.key);
  const changed = keysAfter.filter((k, i) => k !== keysBefore[i]).length;
  const newCol = calls.filter((c) => c.z === 8).length;
  check('(3b) a window step replaces one column (4 slots), keeps 12 ready, zeroes the leaving texels, requests only the new column',
    changed === 4 && newCol === 4 && b8.slots.filter((s) => s.state === 'ready').length === ready8 - 4 && was === 200 && a.data[texel] === 0 && b8.minX === leaving + 1,
    `changed ${changed}, requested ${newCol}, texel ${was} -> ${a.data[texel]}`);

  // Abort: the new east column is still in flight; flying back west drops it.
  const inFlight = b8.slots.filter((s) => s.state === 'loading').map((s) => s.key);
  clock = 102;
  a.update(p.x - step * 0.6, p.z, clock);
  await flush();
  const abortedCount = a.stats.aborted;
  for (const k of inFlight) {
    const [, x, y] = k.split('/');
    resolvers.get(`8/${x}/${y}`)?.resolve(bytes(255));
  }
  await flush();
  const lateIgnored = !b8.slots.some((s) => inFlight.includes(s.key) && s.state === 'ready');
  check('(3c) requests in flight for slots that leave the window are aborted; a late answer is ignored',
    inFlight.length === 4 && abortedCount >= 4 && lateIgnored, `in flight ${inFlight.length}, aborted ${abortedCount}`);

  // Retry after retrySec; poles are no-data without a request.
  calls.length = 0;
  clock = 106;
  a.update(p.x - step * 0.6, p.z, clock);
  await flush();
  const retried = calls.some((c) => c.z === 7);
  const polar = new NLm.NightLightsAtlas({ bands: [6], slotPx: 4, maxRequests: 100, fetchTile: () => Promise.resolve(bytes(1)), clock: () => 0 });
  const pole = NLm.geoToScene(0, 85);
  polar.update(pole.x, pole.z, 0);
  await flush();
  const pc = polar.census();
  check('(3d) a failure retries after retrySec; tiles beyond the poles are no-data, never requested',
    retried && pc.noData === 8 && pc.ready === 8 && polar.stats.requested === 8, `retried ${retried}, poles ${JSON.stringify(pc)}, requested ${polar.stats.requested}`);

  // Offline: failures with no success pause the source.
  let n = 0;
  const off = new NLm.NightLightsAtlas({ bands: [6, 7], slotPx: 4, maxRequests: 50, fetchTile: () => { n++; return Promise.reject(new Error('blocked')); }, offlineAfter: 8, offlineSec: 300, clock: () => 500 });
  off.update(p.x, p.z, 500);
  await flush();
  const before = n;
  off.update(p.x, p.z, 520); // retry time passed for some, but offline
  await flush();
  check('(3e) a blocked host (every request failing) pauses the source and never throws', off.stats.offline === true && n === before && off.offlineUntil === 800, `requests ${before} then ${n}, offline until ${off.offlineUntil}`);

  // (4) uploads
  const calls2 = [];
  const fakeRenderer = (has) => ({ properties: { has: () => has }, copyTextureToTexture: (src, dst, region, pos) => calls2.push({ src, dst, min: [region.min.x, region.min.y], max: [region.max.x, region.max.y], pos: [pos.x, pos.y, pos.z] }) });
  const up = new NLm.NightLightsAtlas({ bands: [6, 7, 8], slotPx: 4, maxRequests: 100, fetchTile: () => Promise.resolve(new Uint8Array(16).fill(9)), clock: () => 0, fadeSec: 2 });
  up.update(p.x, p.z, 0);
  await flush();
  const v0 = up.texture.version;
  const full = up.flush(fakeRenderer(false));
  const fullOk = full === 1 && up.texture.version === v0 + 1 && calls2.length === 0 && up.dirty.length === 0;
  // Now a single slot commit on band 1 (z7): its rectangle and destination.
  const b7 = up.bands[1];
  const idx = 6;
  up._writeSlot(b7, idx, new Uint8Array(16).fill(77));
  up.flush(fakeRenderer(true));
  const c = calls2[0];
  const rectOk = calls2.length === 1 && c.src === up.staging && c.dst === up.texture &&
    c.min[0] === (idx % 4) * 4 && c.min[1] === 1 * up.side + Math.floor(idx / 4) * 4 && c.max[0] - c.min[0] === 4 && c.max[1] - c.min[1] === 4 &&
    c.pos[0] === (idx % 4) * 4 && c.pos[1] === Math.floor(idx / 4) * 4 && c.pos[2] === 1;
  // The staging view is the same bytes (layer-major = one tall image).
  const viewOk = up.staging.image.data === up.data && up.staging.image.height === up.side * 3 && up.data[1 * up.side * up.side + Math.floor(idx / 4) * 4 * up.side + (idx % 4) * 4] === 77;
  up._weights(1);
  const fade = up.ready[2 * 16 + 0];
  up._weights(5);
  check('(4) uploads: whole array before a GPU copy exists, then one slot rectangle per commit at its layer; arrivals fade in',
    fullOk && rectOk && viewOk && near(fade, 0.5, 1e-9) && up.ready[2 * 16 + 0] === 1 && up.census().ready === 48 && up.texture.isDataArrayTexture && up.texture.image.depth === 3 && up.texture.generateMipmaps === false,
    `full ${fullOk}, rect ${c ? JSON.stringify({ min: c.min, max: c.max, pos: c.pos }) : 'none'}, view ${viewOk}, fade ${fade}`);
  a.dispose();
  up.dispose();
  off.dispose();
  polar.dispose();
}

// (5) the colour key (Black Marble palette, measured on real tiles)
{
  const px = (list) => {
    const out = new Uint8Array(list.length * 4);
    list.forEach(([r, g, b], i) => out.set([r, g, b, 255], i * 4));
    return NLm.nightLightsKey(out, list.length, NL.key);
  };
  // Bucket means measured on GIBS tiles: Lake Michigan / Atlantic, Alpine land, dim land,
  // moonlit Alpine snow, Sahara, Greenland ice.
  const dark = px([[4, 5, 15], [9, 11, 19], [19, 20, 34], [37, 39, 66], [25, 26, 42], [47, 50, 79]]);
  const lights = px([[61, 54, 50], [102, 85, 67], [158, 132, 100], [226, 197, 153], [255, 255, 255], [253, 251, 245]]);
  const mono = [...lights].every((v, i, a) => i === 0 || v >= a[i - 1] || i >= 4);
  check('(5) key: moonlit sea, land, snow and desert are black; warm to white lights pass, rising with brightness, white cores at 255',
    [...dark].every((v) => v === 0) && lights[0] > 0 && lights[3] > 150 && lights[4] === 255 && mono,
    `dark ${[...dark]} lights ${[...lights]}`);
}

// (6) night weight and range ramp
{
  const w = (el) => NLm.nightLightsWeight(el, NL);
  let mono = true;
  for (let el = 10; el > -20; el -= 0.5) if (w(el - 0.5) < w(el) - 1e-12) mono = false;
  const lo = NLm.nightLightsRange(300, NL), mid = NLm.nightLightsRange(3000, NL), hi = NLm.nightLightsRange(10000, NL);
  const at4 = NLm.nightLightsRange(4100, NL);
  check('(6) night weight 0 by day, 1 by -8 deg, monotonic; range ramp leaves the generated lights alone low and opens the view high',
    w(5) === 0 && w(1) === 0 && w(-8) === 1 && w(-20) === 1 && w(-3) > 0.2 && w(-3) < 0.8 && mono &&
      lo[0] === NL.rangeLowM[0] && lo[1] === NL.rangeLowM[1] && mid[0] === NL.rangeLowM[0] && hi[0] === NL.rangeHighM[0] && hi[1] === NL.rangeHighM[1] &&
      at4[0] < lo[0] && at4[0] > hi[0] && lo[0] >= 6000,
    `w(-3) ${w(-3).toFixed(3)}; 300 m ${lo}; 3 km ${mid}; 4.1 km ${at4.map((v) => Math.round(v))}; 10 km ${hi}`);
}

// (7) the mist profile
{
  const tod = (el, east) => GMm.mistTimeOfDay(el, east, GM);
  const dawn = tod(1, 1), dusk = tod(1, -1), night = tod(-25, 1), noon = tod(50, 1), late = tod(10, 1);
  const humid = GMm.mistHumidity(1, 0, GM);
  // Floor: down to a valley in ~floorSec[0], up out of it slowly; re-seeded by a warp.
  const st = { y: NaN, epoch: -1 };
  GMm.stepMistFloor(st, 1000, 0.016, 0, GM);
  for (let i = 0; i < 600; i++) GMm.stepMistFloor(st, 600, 0.05, 0, GM); // 30 s over a valley
  const down = st.y;
  for (let i = 0; i < 600; i++) GMm.stepMistFloor(st, 1400, 0.05, 0, GM); // 30 s over a ridge
  const up = st.y;
  GMm.stepMistFloor(st, 50, 0.05, 1, GM); // warp
  const seeded = st.y === 50;
  // Closed form vs numerical integration of exp(-max(y,-cap)/H) along the segment.
  const numeric = (L, a, b, H, cap) => { let s = 0; const n = 20000; for (let i = 0; i < n; i++) { const y = a + (b - a) * ((i + 0.5) / n); s += Math.exp(-Math.max(y, -cap) / H); } return (s / n) * L; };
  const cases = [[3000, 800, 0, 70, 140], [12000, 50, 60, 400, 800], [20000, 300, 2000, 400, 800], [5000, -50, 300, 70, 140], [9000, 10000, 0, 400, 800]];
  const errs = cases.map(([L, a, b, H, cap]) => { const x = GMm.mistDepth(L, a, b, H, cap), y = numeric(L, a, b, H, cap); return Math.abs(x - y) / Math.max(1e-9, y); });
  // Noise: in [0, 1], periodic over GM_PERIOD scene units, and a rebase moves it nowhere: the
  // shader samples world + phase with phase = mod(anchor - drift, P), so for an anchor step D
  // the coordinate world' + phase' equals world + phase, mod P.
  const cell = 4096, period = 16, P = GMm.GM_PERIOD;
  let inRange = true, periodic = true, rebase = true;
  for (let i = 0; i < 400; i++) {
    const x = Math.sin(i * 12.9898) * 43758.5453 % 70000, z = Math.cos(i * 78.233) * 12345.678 % 70000;
    const n = GMm.mistNoise(x, z, cell, period, 1);
    if (!(n >= 0 && n <= 1)) inRange = false;
    if (Math.abs(n - GMm.mistNoise(x + P, z - 2 * P, cell, period, 1)) > 1e-6) periodic = false;
    const anchor = 704 * (i % 37), D = 704 * 15, world = x - anchor;
    const phase = ((anchor % P) + P) % P, phase2 = (((anchor + D) % P) + P) % P;
    if (Math.abs(GMm.mistNoise(world + phase, z, cell, period, 1) - GMm.mistNoise(world - D + phase2, z, cell, period, 1)) > 1e-6) rebase = false;
  }
  check('(7a) mist amount: dawn > dusk > night > noon = 0; humid air adds; the morning window closes after the sun climbs',
    dawn === 1 && dusk < dawn && dusk > night && night > 0 && noon === 0 && late < dawn && late > 0 && humid === GM.humid.fog,
    `dawn ${dawn.toFixed(2)} dusk ${dusk.toFixed(2)} night ${night.toFixed(2)} 10deg ${late.toFixed(2)} noon ${noon}`);
  check('(7b) floor: follows a valley down in ~10 s, rises out of it slowly, re-seeds on a warp',
    down < 600 + 25 && up < 1000 && up > down && seeded, `30 s down -> ${down.toFixed(1)} m, 30 s up -> ${up.toFixed(1)} m`);
  check('(7c) closed-form optical depth = numerical integration (within 0.5%)', errs.every((e) => e < 0.005), errs.map((e) => (e * 100).toFixed(3) + '%').join(' '));
  check('(7d) cover field in [0,1], periodic over 65,536 scene units, unmoved by a rebase', inRange && periodic && rebase);
}

// (8) the drivers
{
  const U = NLm.NIGHT_LIGHTS_UNIFORMS;
  const D = NLm.__nightLightsInternals._drv;
  let fetched = 0;
  D.fetcher = (z, x, y) => { fetched++; return Promise.resolve(new Uint8Array(NL.slotPx * NL.slotPx).fill(30)); };
  const p = NLm.geoToScene(-74.0, 40.7);
  const origin = { x: p.x - 1234, z: p.z + 567 }; // the anchor
  const ctx = (o) => ({ frame: Math.random(), now: 10, dt: 0.016, renderer: null, cinema: true, tier: 'high', phone: false, fixture: false,
    origin, camX: 1234, camY: 10500, camZ: -567, groundY: 20, kMerc: 1.32, sunSinEl: Math.sin(30 * Math.PI / 180), ...o });
  NLm.stepNightLights(ctx({}));
  const dayOk = !D.atlas && U.uNL.value.x === 0 && fetched === 0;
  // maxRequests at a time: pump until the three bands are in.
  for (let i = 0; i < 20; i++) {
    NLm.stepNightLights(ctx({ sunSinEl: Math.sin(-20 * Math.PI / 180), now: 10 + i * 0.1 }));
    await flush();
  }
  const a = D.atlas;
  const fetchedNight = fetched;
  const A = U.uNLBandA.value, B = U.uNLBandB.value;
  let originsOk = !!a;
  for (let i = 0; a && i < 3; i++) {
    const b = a.bands[i];
    // The window origin in REBASED scene units; the camera's own tile sits inside it.
    const tx = (1234 - A[i * 4]) * A[i * 4 + 2], ty = (-567 - A[i * 4 + 1]) * A[i * 4 + 2];
    if (!(tx >= 1.2 && tx <= 2.8 && ty >= 1.2 && ty <= 2.8)) originsOk = false;
    // (The uniform arrays are Float32: compare the texel density relatively.)
    const dens = (NL.slotPx * 1.32) / b.span;
    if (A[i * 4 + 3] !== i || B[i * 4] !== ((b.minX % 4) + 4) % 4 || !near(B[i * 4 + 2], dens, dens * 1e-6)) originsOk = false;
  }
  const nightOk = !!a && fetchedNight === 48 && a.census().ready === 48 && U.uNL.value.x === NL.gain && U.uNLAtlas.value === a.texture && originsOk && U.uNL.value.y === NL.rangeHighM[0];
  // Fixture, Low tier, Classic: dark (and no new atlas in the fixture).
  NLm.releaseNightLights();
  fetched = 0;
  NLm.stepNightLights(ctx({ sunSinEl: -0.5, fixture: true }));
  const fixtureOk = !D.atlas && fetched === 0 && U.uNL.value.x === 0;
  NLm.stepNightLights(ctx({ sunSinEl: -0.5, tier: 'low' }));
  const lowOk = !D.atlas && U.uNL.value.x === 0;
  NLm.stepNightLights(ctx({ sunSinEl: -0.5, cinema: false }));
  const classicOk = !D.atlas && U.uNL.value.x === 0;
  NLm.stepNightLights(ctx({ sunSinEl: -0.5, phone: true }));
  const phoneBands = D.atlas?.bands.map((b) => b.z).join(',');
  // A day releases the atlas after releaseSec (same device, so the band set holds).
  let released = false;
  for (let t = 0; t < NL.releaseSec + 2; t += 0.1) {
    NLm.stepNightLights(ctx({ sunSinEl: Math.sin(40 * Math.PI / 180), dt: 0.1, phone: true }));
    if (!D.atlas) { released = t > NL.releaseSec - 1; break; }
  }
  check('(8a) night lights driver: day = no atlas, no fetch, zero strength; night = 3 bands, 48 requests, origins on the window',
    dayOk && nightOk, `day ${dayOk}; night ${nightOk} (fetched ${fetchedNight}, origins ${originsOk})`);
  check('(8b) the fixture, the Low tier and Classic stay dark; phones keep z6+z7; a day releases the atlas',
    fixtureOk && lowOk && classicOk && phoneBands === NL.bandsPhone.join(',') && released, `phone ${phoneBands}, released ${released}`);
  NLm.releaseNightLights();

  const G = GMm.GROUND_MIST_UNIFORMS;
  const mctx = (o) => ({ frame: Math.random(), dt: 0.016, cinema: true, tier: 'high', phone: false, origin: { x: 1e6, z: -2e6 }, camX: 0, camY: 400, camZ: 0,
    groundY: 300, kMerc: 1.3, warpEpoch: 3, sunDir: [Math.cos(0.02), Math.sin(0.02), 0], fog: 0, overcast: 0, wind: [1, 0], windMps: 4, ...o });
  GMm.stepGroundMist(mctx({}));
  const dawnOn = G.uGMFloor.value.y === GM.maxOpacity && G.uGMLayer.value.x > 0 && G.uGMLayer.value.z > 0 && G.uGMPath.value.w === 1;
  GMm.stepGroundMist(mctx({ sunDir: [0, 1, 0] }));
  const noonOff = G.uGMFloor.value.y === 0;
  GMm.stepGroundMist(mctx({ sunDir: [0, 1, 0], fog: 1 }));
  const fogOn = G.uGMFloor.value.y > 0;
  GMm.stepGroundMist(mctx({ cinema: false }));
  const classicOff = G.uGMFloor.value.y === 0;
  GMm.stepGroundMist(mctx({ tier: 'low' }));
  const lowOff = G.uGMFloor.value.y === 0;
  GMm.stepGroundMist(mctx({ phone: true }));
  const phoneCheap = G.uGMFloor.value.y > 0 && G.uGMPath.value.w === 0;
  GMm.stepGroundMist(mctx({ camY: 11000 }));
  const cruise = G.uGMLayer.value.z === 0 && near(G.uGMLayer.value.x, GM.valley.density * GM.valley.keepAloft, 1e-12);
  check('(8c) mist driver: on at dawn, off at clear noon, on in fog, off in Classic and on Low, cheap on phones; from cruise the haze is gone and the valley pools stay',
    dawnOn && noonOff && fogOn && classicOff && lowOff && phoneCheap && cruise, JSON.stringify({ dawnOn, noonOff, fogOn, classicOff, lowOff, phoneCheap, cruise }));
}

// (9) shader text, per flag state (one process each)
{
  const { execFileSync } = await import('node:child_process');
  const leg = (name) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop());
  const on = leg('on'), off = leg('off'), nl = leg('nl'), gm = leg('gm'), nophys = leg('nophys');
  const isNew = (k) => k.startsWith('uNL') || k.startsWith('uGM');
  check('(9a) flags off: the Enhanced aerial program is the pre-pass text byte for byte, no new uniform, Classic untouched',
    !off.flags.NIGHT_LIGHTS && !off.flags.GROUND_MIST && off.equalsBase && off.baseClean && !off.uniforms.some(isNew) && off.classicHasNone && off.phys === 'patched' && off.ts === 'patched',
    `len ${off.len} = base ${off.baseLen}`);
  check('(9b) flags on: the ground terms enter the PHYS block and the plain living-air line; PHYS_SKY and TRUE_SCALE still patched; verify-phys-sky substrings intact',
    on.flags.NIGHT_LIGHTS && on.flags.GROUND_MIST && !on.equalsBase && on.hasGround && on.hasNl && on.hasGm && on.physUsesSurf && on.plainUsesSurf && on.keepsPhysSubstrings && on.noInputLeft &&
      on.phys === 'patched' && on.ts === 'patched' && on.uniforms.filter((k) => k.startsWith('uNL')).length === 10 && on.uniforms.filter((k) => k.startsWith('uGM')).length === 5 && on.classicHasNone,
    `len ${on.baseLen} -> ${on.len}`);
  check('(9c) each flag alone carries only its own terms and uniforms',
    nl.hasNl && !nl.hasGm && nl.uniforms.some((k) => k.startsWith('uNL')) && !nl.uniforms.some((k) => k.startsWith('uGM')) &&
      gm.hasGm && !gm.hasNl && gm.uniforms.some((k) => k.startsWith('uGM')) && !gm.uniforms.some((k) => k.startsWith('uNL')));
  check('(9d) without PHYS_SKY the plain living-air line carries the terms', nophys.phys === 'off' && nophys.hasGround && nophys.plainUsesSurf && !nophys.physUsesSurf);
  check('(9e) a moved anchor throws (main, living-air block, plain line, PHYS line)', on.throws.every(Boolean) && on.physMoved, JSON.stringify({ throws: on.throws, phys: on.physMoved }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
