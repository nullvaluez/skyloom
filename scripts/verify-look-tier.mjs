/**
 * LOOK PASS tier test gate (FLY_LOOK_PASS.md, "Tier test"): lib/fly/look-tier.js.
 *
 * Node only (no GPU). Every cinema profile name, on a desktop and on the mobile
 * graphics class, goes through the shared predicate AND through each stream's
 * own gate function, and all six answers must agree:
 *   ATMOS   updateLookAtmos(env, profile)  -> uLookAtmosA.w
 *   SHADOW  lookShadowLightDepth(profile)  -> non-null; lookShadowCloudGate(profile) > 0;
 *           lookShadowTerrainSoftGate(profile) -> 1 (the terrain uTsSoft ring)
 *   FACADE  setLookFacadeProfile(profile)  -> uLookFacade
 *   LAYERS  lookLayersProfile(name)
 *   GRADE   lookGradeWeight(profile)
 * Then the wiring: the two component call sites hand the live cinema profile
 * (not the store tier) to their stream, and no stream keeps its own name list.
 * Informational: the governor rungs where the old store-tier test disagreed.
 * Run: node scripts/verify-look-tier.mjs
 */
import { register } from 'node:module';
import fs from 'node:fs';

register('./_node-resolve.mjs', import.meta.url);
const { lookTierAllowed, LOOK_TIER_PROFILES } = await import('../lib/fly/look-tier.js');
const { CINEMA_PROFILES, resolveCinemaProfile } = await import('../lib/fly/cinema-profile.js');
const LA = await import('../lib/fly/look-atmos.js');
const LS = await import('../lib/fly/look-shadow.js');
const LF = await import('../lib/fly/look-facade.js');
const LL = await import('../lib/fly/look-layers.js');
const LG = await import('../lib/fly/look-grade.js');

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${d ? `  — ${d}` : ''}`); };

const MOBILE_WINDOW = { matchMedia: () => ({ matches: true }), ontouchstart: null, screen: { width: 1024, height: 1366 }, innerWidth: 1024, innerHeight: 1366 };
const env = { day: 1, golden: 0, overcast: 0 };
const cloudDial = Math.max(0, Math.min(1, Number(LS.LOOK_SHADOW_CFG.cloudShadow ?? 1)));

function streams(profile) {
  LA.updateLookAtmos(env, profile);
  LF.setLookFacadeProfile(profile);
  return {
    atmos: LA.LOOK_ATMOS_UNIFORMS.uLookAtmosA.value.w === 1,
    shadow: LS.lookShadowLightDepth(profile) !== null,
    shadowCloud: LS.lookShadowCloudGate(profile) > 0,
    shadowTerrain: LS.lookShadowTerrainSoftGate(profile ?? null) === 1,
    facade: LF.LOOK_FACADE_UNIFORMS.uLookFacade.value === 1,
    layers: LL.lookLayersProfile(profile?.name),
    grade: LG.lookGradeWeight(profile) === 1,
  };
}
const flagOn = {
  atmos: LA.LOOK_ATMOS_ON, shadow: LS.LOOK_SHADOW_CFG.enabled === true, shadowCloud: LS.LOOK_SHADOW_CFG.enabled === true && cloudDial > 0,
  shadowTerrain: LS.lookShadowTerrainSoft(),
  facade: LF.LOOK_FACADE_ON, layers: LL.LOOK_LAYERS_ON, grade: LG.LOOK_GRADE_ON,
};
console.log('flags:', Object.entries(flagOn).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`).join(' '));

// 1. The predicate itself: exactly the four desktop High/Ultra names, never on the mobile class.
const names = Object.values(CINEMA_PROFILES).map((p) => p.name);
ok(names.length === 11 && LOOK_TIER_PROFILES.every((n) => names.includes(n)), '(1a) every allowed name is a real cinema profile', names.join(' '));
ok(names.every((n) => lookTierAllowed(n, false) === /^(ultra|high)/.test(n)), '(1b) desktop: allowed exactly for the ultra*/high* profiles');
ok(names.every((n) => lookTierAllowed(n, true) === false), '(1c) mobile graphics class: never allowed');
ok([undefined, null, '', 'ultra-x', { name: 'medium' }].every((p) => lookTierAllowed(p, false) === false) && lookTierAllowed({ name: 'ultra' }, false), '(1d) object or name; anything else is not allowed');

// 2. Every profile x device: the predicate and all five streams agree.
for (const mobile of [false, true]) {
  if (mobile) globalThis.window = MOBILE_WINDOW; else delete globalThis.window;
  const rows = [];
  for (const p of Object.values(CINEMA_PROFILES)) {
    const want = lookTierAllowed(p);
    const got = streams(p);
    const bad = Object.entries(got).filter(([k, v]) => v !== (want && flagOn[k]));
    rows.push(`${p.name}=${want ? 'on' : 'off'}`);
    ok(!bad.length && want === (!mobile && LOOK_TIER_PROFILES.includes(p.name)), `(2) ${mobile ? 'mobile ' : 'desktop'} ${p.name}: predicate ${want ? 'on' : 'off'}, all five streams agree`, bad.map(([k, v]) => `${k}=${v}`).join(' '));
  }
  console.log(`      ${mobile ? 'mobile ' : 'desktop'}: ${rows.join(' ')}`);
}
delete globalThis.window;
const none = streams(undefined);
ok(Object.values(none).every((v) => v === false), '(2z) no profile: every stream off', JSON.stringify(none));

// 3. Wiring: the live cinema profile reaches every stream; no stream keeps its own tier test.
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const rig = read('components/fly/AtmosphereRig.jsx');
const sbl = read('components/fly/SatBuildingLayer.jsx');
ok(/updateLookAtmos\(runtime\.cinemaEnvironment, cinemaProfile\(\)\)/.test(rig) && !/updateLookAtmos\([^)]*qt\b/.test(rig), '(3a) AtmosphereRig hands ATMOS the live cinema profile, not the store tier');
ok(/setLookFacadeProfile\(cinemaProfile\(\)\)/.test(sbl) && !/setLookFacade\w*\(qualityTier\)/.test(sbl), '(3b) SatBuildingLayer sets the FACADE gate from the live cinema profile each frame, not the store tier');
const src = { grade: read('lib/fly/look-grade.js'), shadow: read('lib/fly/look-shadow.js'), layers: read('lib/fly/look-layers.js'), facade: read('lib/fly/look-facade.js'), atmos: read('lib/fly/look-atmos.js') };
ok(Object.values(src).every((s) => s.includes("import { lookTierAllowed } from './look-tier';")), '(3c) all five stream modules import the shared tier test');
ok(Object.values(src).every((s) => !/new Set\(\[\s*'ultra'/.test(s) && !/isMobileGraphicsClass\(\)/.test(s)), '(3d) no stream module keeps its own profile set or device-class test');
// The flag-on shader text stays a static, per-session decision: no governor rung recompiles.
ok(!/lookTierAllowed|cinemaProfile/.test(read('lib/fly/look-grade-flag.js')) && /LOOK_GRADE_COMPILED = LOOK_GRADE_ON && !isMobileGraphicsClass\(\)/.test(read('lib/fly/look-grade-flag.js')), '(3e) GRADE shader text keys off the static device class, not the live profile');

// 4. Informational: the governor's reachable (preset, tier, effects, scale) states where the
// old store-tier test (ATMOS, FACADE) and the profile test (GRADE, SHADOW, LAYERS) disagreed.
const diffs = [];
for (const preset of ['ultra', 'high', 'medium', 'low']) for (const tier of ['high', 'medium', 'low']) for (const effectLevel of [0, 1, 2, 3]) for (const scale of [1, 0.85, 0.75]) for (const scaleDemotes of [false, true]) {
  if (preset !== 'ultra' && preset !== tier && ['high', 'medium', 'low'].indexOf(tier) < ['high', 'medium', 'low'].indexOf(preset)) continue; // the governor only steps down
  const p = resolveCinemaProfile({ preset, tier, effectLevel, scale, phone: false, scaleDemotes });
  const store = tier === 'high', prof = lookTierAllowed(p, false);
  if (store !== prof) diffs.push(`${preset}/${tier}/fx${effectLevel}/s${scale}${scaleDemotes ? '/demote' : ''} -> ${p.name}: store ${store ? 'on' : 'off'}, profile ${prof ? 'on' : 'off'}`);
}
console.log(`INFO  ${diffs.length} desktop governor states where the old store-tier test disagreed (now the profile answer):`);
for (const d of diffs) console.log(`      ${d}`);

console.log(`\nverify-look-tier: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
