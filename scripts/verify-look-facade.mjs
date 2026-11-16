// LOOK PASS C (FACADE) node gate: the flag-off identity of the architecture
// programs, the flag-on key and patch, the shader anchors, and the tier rule.
//   node scripts/verify-look-facade.mjs
// 1. LOOK_FACADE off: the program key carries no look-facade suffix and the
//    shader text holds no LOOK_FACADE term (vertex text and chunks match the on arm).
// 2. LOOK_FACADE on: the key is the off key with LOOK_FACADE_KEY added, and the
//    fragment text is exactly the off text with applyLookFacade run over it.
// 3. Every anchor applyLookFacade patches is found exactly once; a missing or
//    repeated anchor throws instead of silently skipping.
// 4. uLookFacade is 0 unless the tier is High (desktop High and Ultra) on a
//    non-touch device: Medium, Low and phones run the shipped expressions.
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const arm = process.argv.find((x) => x.startsWith('--arm='))?.slice(6);
if (arm) {
  register('./_node-resolve.mjs', import.meta.url);
  globalThis.window = { location: { search: '' }, __flyLookFacadeOverride: { enabled: arm === 'on' } };
  const { ShaderLib, ShaderChunk, UniformsUtils } = await import('three');
  const originalChunks = { ...ShaderChunk };
  const { createSatelliteArchitectureMaterial } = await import('../lib/fly/satellite-architecture-material.js');
  const { useFlyStore } = await import('../stores/fly-store.js');
  delete globalThis.window;
  const programs = {};
  for (const visuals of ['enhanced', 'classic']) {
    useFlyStore.setState({ mapStyle: 'satellite', visuals });
    for (const distant of [false, true]) {
      const m = createSatelliteArchitectureMaterial({ distant });
      const s = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
      m.onBeforeCompile(s, {});
      programs[`${visuals}-${distant ? 'far' : 'near'}`] = {
        distant, vs: s.vertexShader, fs: s.fragmentShader, key: m.customProgramCacheKey(),
        uLookFacade: s.uniforms.uLookFacade ? s.uniforms.uLookFacade.value : null,
        chunks: Object.keys(ShaderChunk).filter((k) => ShaderChunk[k] !== originalChunks[k]).sort(),
      };
      m.dispose();
    }
  }
  process.stdout.write(JSON.stringify(programs));
  process.exit(0);
}

register('./_node-resolve.mjs', import.meta.url);
const { applyLookFacade, LOOK_FACADE_KEY, LOOK_FACADE_UNIFORMS, LOOK_FACADE_CFG, setLookFacadeProfile } = await import('../lib/fly/look-facade.js');
const { NIGHT_RHYTHM_KEY } = await import('../lib/fly/night-rhythm.js');

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log(`PASS  ${m}${d ? `  — ${d}` : ''}`); } else { fail++; console.log(`FAIL  ${m}${d ? `  — ${d}` : ''}`); } };
const runArm = (name) => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--arm=${name}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.log(r.stderr); process.exit(1); }
  return JSON.parse(r.stdout);
};
const off = runArm('off'), on = runArm('on');
const patch = (p, fs) => {
  const s = { fragmentShader: fs, uniforms: {} };
  applyLookFacade(s, { groundLighting: p.key.includes('|ground-window-v2'), nightRhythm: p.key.includes(NIGHT_RHYTHM_KEY), distant: p.distant }, LOOK_FACADE_CFG);
  return s;
};

// 1 + 2. Key and text identities, all four programs (Enhanced/Classic x near/far).
for (const name of Object.keys(off)) {
  const a = off[name], b = on[name];
  ok(!a.key.includes('look-facade') && !/uLookFacade|LOOK_FACADE|\blf[A-Z]/.test(a.fs) && a.uLookFacade === null, `${name}: flag off carries no look-facade key, text or uniform`);
  // Other layers wrap the key after the architecture material, so the suffix sits mid-key.
  ok(b.key.split(LOOK_FACADE_KEY).length === 2 && b.key.replace(LOOK_FACADE_KEY, '') === a.key, `${name}: flag on key = off key with ${LOOK_FACADE_KEY} added once`);
  ok(b.vs === a.vs && JSON.stringify(b.chunks) === JSON.stringify(a.chunks), `${name}: vertex text and shader chunks are untouched by the flag`);
  ok(patch(a, a.fs).fragmentShader === b.fs, `${name}: flag-on fragment = flag-off fragment + applyLookFacade (nothing else moves)`);
  ok(b.uLookFacade === 0, `${name}: uLookFacade starts at 0 (Medium/Low until the layer raises it)`);
  // Every look block sits behind the tier branch, so uLookFacade 0 runs the shipped expressions.
  const blocks = b.fs.split('\n').filter((l) => l.startsWith('// LOOK_FACADE:'));
  ok(blocks.length >= 3 && blocks.every((l) => { const nx = b.fs.slice(b.fs.indexOf(l)).split('\n')[1]; return nx.startsWith('if(') && nx.includes('uLookFacade>.5'); }), `${name}: each LOOK_FACADE block opens on a uLookFacade branch`, `${blocks.length} blocks`);
}

// 3. Anchors: present exactly once in the base text; a miss or a repeat throws.
const base = off['enhanced-near'];
// The palette anchors are whole statements (head up to the line end): the city
// facade program gates them on its own head, so a drifted body must throw, not skip.
const stmt = (head) => { const i = base.fs.indexOf(head); return i < 0 ? head : base.fs.slice(i, base.fs.indexOf(';\n', i) + 1); };
const ANCHORS = [
  'uniform float uArchitectureDetail;',
  'paneMask = mix(paneMask, opening.x * opening.y * isWall, minify);',
  'float entrance = ',
  'glow += entrance * ',
  'reflectedLight.indirectSpecular*=1.+(uCityReflect-1.)*cityGlassMask;',
  stmt('vec3 cityCuts='),
  stmt('vec3 cityTint='),
  (base.fs.match(/\+vec3\(0\.,[0-9.]+\+cityPanelTilt,0\.\)/) || ['+vec3(0.,?+cityPanelTilt,0.)'])[0],
];
const count = (s, x) => s.split(x).length - 1;
for (const a of ANCHORS) ok(count(base.fs, a) === 1, `anchor found exactly once: ${a.trim().slice(0, 60)}`);
const throwsOn = (fs) => { try { patch(base, fs); return null; } catch (e) { return e.message; } };
for (const a of ANCHORS) {
  // A palette statement keeps its head (the program is still a city program) with a drifted body.
  const head = a.startsWith('vec3 city') ? a.slice(0, a.indexOf('=') + 1) : '';
  const missing = throwsOn(base.fs.replace(a, head ? `${head}vec3(1.);` : '/*gone*/'));
  ok(!!missing && /LOOK_FACADE/.test(missing), `missing anchor throws: ${a.trim().slice(0, 48)}`, missing || 'no throw');
  const repeated = throwsOn(base.fs.replace(a, `${a}\n${a}`));
  ok(!!repeated && /LOOK_FACADE/.test(repeated), `repeated anchor throws: ${a.trim().slice(0, 48)}`, repeated || 'no throw');
}

// 4. Tier rule: the live cinema profile through the shared tier test (lib/fly/look-tier.js):
// desktop High/Ultra profiles and their governor rungs only (scripts/verify-look-tier.mjs covers every name).
const u = LOOK_FACADE_UNIFORMS.uLookFacade;
for (const [profile, want] of [['high', 1], ['high-balanced', 1], ['ultra', 1], ['ultra-balanced', 1], ['medium', 0], ['low', 0], ['phone', 0], [undefined, 0]]) {
  setLookFacadeProfile(profile === undefined ? undefined : { name: profile });
  ok(u.value === want, `desktop profile ${profile}: uLookFacade ${want}`);
}
globalThis.window = { matchMedia: () => ({ matches: true }), ontouchstart: null, screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844 };
setLookFacadeProfile({ name: 'high' });
ok(u.value === 0, 'touch device on a High profile: uLookFacade 0 (rule 5 is desktop only)');
delete globalThis.window;
setLookFacadeProfile({ name: 'high' });
ok(u.value === 1, 'back on desktop High: uLookFacade 1');
setLookFacadeProfile({ name: 'medium' });

console.log(`\nverify-look-facade: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
