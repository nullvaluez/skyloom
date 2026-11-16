// LOOK PASS D (LAYERS) node gate (FLY_LOOK_PASS.md; ledger scripts/look-pass-layers.md).
//   node scripts/verify-look-layers.mjs
// 1. LOOK_LAYERS off: the Enhanced cloud march carries no LOOK text, and the
//    composite and filter are the same text as with the flag on (this stream
//    never edits them).
// 2. Flag on with every dial at 0: march, composite and filter are byte-identical
//    to flag off (a dial at 0 removes its text, not just its weight).
// 3. The horizon bank is off by default (bank dial 0, no lookBank text), and the
//    gate can see it when a leg turns it on.
// 4. The look is gated to desktop High and Ultra: Medium, phone and Low get the
//    flag-off uniforms exactly, High and Ultra do not.
// Each leg runs in its own process (the flag and dials resolve at module load).
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leg = process.argv.find((a) => a.startsWith('--leg='))?.slice(6);
// This stream's own identifiers (other Look streams have uLook* uniforms of their own).
const MINE = /uLook(Vol|Bank2?|Form|High|Sun)|lookBank|lookCool|lookCovAway|lookEdge|lookNear/;
const sha = (s) => createHash('sha256').update(String(s ?? '')).digest('hex').slice(0, 16);

const LEGS = {
  off: { enabled: false },
  on: null, // the shipped block, no pin
  zero: { enabled: true, volume: 0, bank: 0, high: 0 },
  bank: { enabled: true, bank: 1 },
};
const PROFILES = ['ultra', 'ultra-balanced', 'high', 'high-balanced', 'medium', 'phone', 'low'];
// Noon, golden (7 deg), civil dusk and night: every branch of the sun weights.
const SUNS = [40, 7, -3, -20];

async function buildLeg(name) {
  globalThis.window = { location: { search: '', href: 'http://localhost/' } };
  if (LEGS[name]) globalThis.window.__flyLookLayersOverride = LEGS[name];
  if (typeof globalThis.OffscreenCanvas === 'undefined') {
    const inert = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert, construct: () => inert });
    globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
  }
  register('./_node-resolve.mjs', import.meta.url);
  register('./_alias-loader.mjs', import.meta.url);
  register('./_r25-c-jsx-loader.mjs', import.meta.url);
  const imp = (rel) => import(new URL(`../${rel}`, import.meta.url).href);
  const THREE = await imp('node_modules/three/build/three.module.js');
  const CP = await imp('lib/fly/immersive-cloud-pass.js');
  const LC = await imp('lib/fly/living-clouds.js');
  const LL = await imp('lib/fly/look-layers.js');
  const FC = await imp('lib/fly/fly-constants.js');
  const pass = new CP.ImmersiveCloudPass(new THREE.PerspectiveCamera(), {});
  pass.ensureR25();
  const march = pass.r25.march.fragmentShader;
  const composite = pass.r25.composite.fragmentShader;
  const filter = pass.r25.filter ? pass.r25.filter.fragmentShader : '';
  // Per-frame uniforms for each profile and sun, from a fresh holder each time.
  const uniforms = {};
  for (const prof of PROFILES) {
    for (const el of SUNS) {
      const u = pass.r25.uniforms;
      const ctx = { env: null, sky: null, wx: { overcastT: 0, presenceFrac: 0.5 }, sinEl: Math.sin((el * Math.PI) / 180), dt: 0, paused: true, k: 1, timeMs: 3.6e6 * 5 };
      LC.updateLivingClouds(u, { name: prof }, ctx);
      const snap = {};
      for (const [k, v] of Object.entries(u)) {
        if (!/^uL(iv|ook)/.test(k)) continue;
        const x = v.value;
        snap[k] = typeof x === 'number' ? x : x && typeof x.toArray === 'function' ? x.toArray() : null;
      }
      uniforms[`${prof}@${el}`] = snap;
    }
  }
  return {
    blockBank: FC.LOOK_LAYERS.bank,
    dials: LL.LOOK_LAYERS_DIALS,
    profile: Object.fromEntries(PROFILES.concat(['phone-economy', 'phone-low', undefined]).map((p) => [String(p), LL.lookLayersProfile(p)])),
    march: { sha: sha(march), len: march.length, uLook: MINE.test(march), lookBank: march.includes('lookBank('), cool: march.includes('lookCool'), away: march.includes('lookCovAway'), form: march.includes('lookEdge'), hasSunCone: march.includes('lookNear') },
    composite: { sha: sha(composite), uLook: MINE.test(composite) },
    filter: { sha: sha(filter), uLook: MINE.test(filter) },
    uniforms,
  };
}

if (leg) {
  process.stdout.write(JSON.stringify(await buildLeg(leg)));
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${d ? `  — ${d}` : ''}`); };
const run = (name) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`], { cwd: ROOT, maxBuffer: 64 << 20 }).toString());
const off = run('off'), on = run('on'), zero = run('zero'), bank = run('bank');

// 1. Flag off.
ok(!off.march.uLook && !off.march.lookBank && !off.march.cool && !off.march.away && !off.march.form, 'flag off: the march carries no LOOK_LAYERS text');
ok(!off.composite.uLook && !off.filter.uLook, 'flag off: composite and filter carry no LOOK_LAYERS text');
ok(on.composite.sha === off.composite.sha && on.filter.sha === off.filter.sha, 'flag on: composite and filter text unchanged from flag off', `${on.composite.sha} / ${on.filter.sha}`);
ok(Object.values(off.dials).every((v) => v === 0), 'flag off: every dial resolves to 0', JSON.stringify(off.dials));

// 2. Every dial at 0.
ok(zero.march.sha === off.march.sha && zero.march.len === off.march.len, 'dials all 0: the march is byte-identical to flag off', `${zero.march.sha} / ${off.march.sha}`);
ok(zero.composite.sha === off.composite.sha && zero.filter.sha === off.filter.sha, 'dials all 0: composite and filter byte-identical to flag off');

// The shipped frame does carry the look (the gate is not vacuous).
ok(on.march.uLook && on.march.form && on.march.cool && on.march.away && on.march.hasSunCone, 'flag on: the march carries the body, base, high-layer and sun-cone edits');

// 3. The horizon bank.
ok(on.blockBank === 0 && on.dials.bank === 0, 'horizon bank is off by default (block bank 0, dial 0)');
ok(!on.march.lookBank, 'flag on: no bank text in the shipped march');
ok(bank.march.lookBank, 'calibration: a bank:1 leg does carry the bank text');

// 4. Profiles.
const prof = on.profile;
ok(prof.ultra && prof['ultra-balanced'] && prof.high && prof['high-balanced'], 'High and Ultra profiles take the look', JSON.stringify(prof));
ok(!prof.medium && !prof.phone && !prof.low && !prof['phone-economy'] && !prof['phone-low'] && !prof.undefined, 'Medium, phone and Low profiles do not');
const diffKeys = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
// The look's own uniforms and every Living uniform it writes, per profile and sun.
const lookKeys = (snap) => Object.fromEntries(Object.entries(snap).filter(([k]) => /^uLook/.test(k)));
const livKeys = (snap) => Object.fromEntries(Object.entries(snap).filter(([k]) => /^uLiv/.test(k)));
for (const p of ['medium', 'phone', 'low']) {
  const bad = [];
  for (const el of SUNS) {
    const k = `${p}@${el}`;
    for (const d of diffKeys(livKeys(on.uniforms[k]), livKeys(off.uniforms[k]))) bad.push(`${el}:${d}`);
    for (const d of diffKeys(lookKeys(on.uniforms[k]), lookKeys(off.uniforms[k]))) bad.push(`${el}:${d}`);
  }
  ok(bad.length === 0, `${p}: every Living and LOOK uniform equals flag off at noon, golden, dusk and night`, bad.join(' '));
}
for (const p of ['ultra', 'high']) {
  const d = diffKeys(on.uniforms[`${p}@40`], off.uniforms[`${p}@40`]);
  ok(d.includes('uLookVol') && d.includes('uLookForm'), `${p}: the look's uniforms are live at noon`, d.join(','));
}
// Identity values the GLSL relies on (the text exists on Medium; the uniforms make it a no-op).
{
  const m = on.uniforms['medium@7'];
  const [ox, oy, oz] = m.uLookVol, f = m.uLookForm, s = m.uLookSun;
  ok(ox === 0 && oy === 1 && oz === 0 && f[0] === 0 && f[1] === 0 && s.every((v) => v === 0) && m.uLookBank2[3] === 0 && m.uLookBank[3] === 0,
    'medium at golden: identity uniforms (vol 0/1/0, form 0, sun 0, away cover 0, bank cover 0)', JSON.stringify({ vol: m.uLookVol, form: f, sun: s, bank2: m.uLookBank2 }));
}
// r4 items: the base cool push is noon-only and the away cover golden-only.
{
  const hi = (el) => on.uniforms[`ultra@${el}`];
  ok(hi(40).uLookSun[0] === 0 && hi(40).uLookSun[1] === 0, 'ultra noon: low-sun and night weights 0 (the base cool push is live)');
  ok(hi(7).uLookSun[0] > 0.25 && hi(-20).uLookSun[1] === 1, 'ultra golden / night: the weights that switch the base cool push off', `${hi(7).uLookSun[0].toFixed(3)} / ${hi(-20).uLookSun[1]}`);
  ok(hi(40).uLookBank2[3] === 0 && hi(7).uLookBank2[3] > 0 && hi(-3).uLookBank2[3] === 0 && hi(-20).uLookBank2[3] === 0, 'away-from-sun cirrus cover: golden only (0 at noon, dusk, night)', `${hi(7).uLookBank2[3].toFixed(4)}`);
}

console.log(`\nverify-look-layers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
