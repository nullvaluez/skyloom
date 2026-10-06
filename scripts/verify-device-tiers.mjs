/**
 * TRUE EARTH — verify-device-tiers: DEVICE_TIERS (lib/fly/device-tiers.js and
 * its readers: lib/fly/fly-settings.js defaultQualityTier,
 * lib/fly/perf-governor.js buildLadder, lib/fly/cinema-policy.js cinemaProfile,
 * lib/fly/cinema-profile.js resolveCinemaProfile).
 *
 * THE DEFECTS
 *  - every desktop started at High, integrated GPUs and software rasterisers
 *    included (Safari never reports RAM; there was no GPU check);
 *  - the governor's first real step down on a desktop dropped a shadow
 *    cascade (effect rungs 2 and 3 come before any render-scale rung), and on
 *    a DPR-1 display the render-scale rungs dropped cascades too, because
 *    the cinema profile demotes below scale 0.9 / 0.8. Every cascade change
 *    recompiles every lit material: a hitch, then a flat image.
 *
 * THE CONTRACT — the REAL governor, one process per flag state (the pin
 * resolves at import, as in the app):
 *  (1) flag off: today's ladders, unchanged; the desktop cascade drops come
 *      before any render-scale rung (the defect, documented);
 *  (2) flag on, desktop: the same coverage (length, render scales, tiers,
 *      effect levels, final rung), reordered: no cascade drop while any
 *      render-scale reduction remains, and cascades never come back up;
 *  (3) flag on, Ultra: the 3 -> 2 cascade rung is deferred the same way;
 *  (4) flag on, phone: identical rungs (every phone effect rung already keeps
 *      its cascade), and render scale no longer drops it either;
 *  (5) start tier: discrete -> high, integrated/unknown -> medium, software ->
 *      low, phone -> existing policy; flag off -> existing policy.
 *
 * Run: node scripts/verify-device-tiers.mjs
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legArg = process.argv.find((a) => a.startsWith('--leg='));

if (legArg) {
  const on = legArg === '--leg=on';
  const phoneWindow = (search) => ({
    location: { search },
    matchMedia: () => ({ matches: true }),
    ontouchstart: null,
    screen: { width: 390, height: 844 },
    innerWidth: 390,
    innerHeight: 844,
    ...(on ? { __flyDeviceTiersOverride: { enabled: true } } : {}),
  });
  register('./_node-resolve.mjs', import.meta.url);
  const { useFlyStore } = await import('../stores/fly-store.js');
  const { resolveCinemaProfile } = await import('../lib/fly/cinema-profile.js');
  if (on) globalThis.window = { location: { search: '' }, __flyDeviceTiersOverride: { enabled: true } };
  const tiers = await import('../lib/fly/device-tiers.js');
  const gov = await import('../lib/fly/perf-governor.js');
  const { defaultQualityTier } = await import('../lib/fly/fly-settings.js');
  const ladder = ({ dpr0, preset = 'high', phone = false }) => {
    if (phone) {
      globalThis.window = phoneWindow('');
      Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 5 }, configurable: true });
    }
    useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced', qualityPreset: preset });
    const g = gov.createGovernor({ dpr0, tier0: 'high', applyDpr() {}, applyTier() {}, applyEffects() {} });
    return g.ladder.map((r) => ({
      ...r,
      cascades: resolveCinemaProfile({ preset, tier: r.tier, scale: r.dpr, phone, effectLevel: r.effects, scaleDemotes: !tiers.ladderOrderOn() }).cascades,
    }));
  };
  const out = {
    on: tiers.ladderOrderOn(),
    desktop1: ladder({ dpr0: 1 }),
    desktop15: ladder({ dpr0: 1.5 }),
    ultra1: ladder({ dpr0: 1, preset: 'ultra' }),
    start: {
      high: tiers.gpuStartTier(tiers.DEVICE_TIERS_ACTIVE, 'high'),
      medium: tiers.gpuStartTier(tiers.DEVICE_TIERS_ACTIVE, 'medium'),
      low: tiers.gpuStartTier(tiers.DEVICE_TIERS_ACTIVE, 'low'),
      phone: tiers.gpuStartTier(tiers.DEVICE_TIERS_ACTIVE, 'phone'),
      unknownDesktop: defaultQualityTier(),
    },
    phone15: ladder({ dpr0: 1.5, phone: true }),
  };
  console.log(JSON.stringify(out));
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const leg = (name) =>
  JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .pop(),
  );
const sig = (l) => l.map((r) => `${r.dpr}/${r.tier}/e${r.effects}`);
const fmt = (l) => l.map((r) => `${r.dpr}/${r.tier}/e${r.effects}:c${r.cascades}`).join(' ');
// Same coverage, not the same rungs: under the flag the render-scale rungs carry
// the highest cascade-keeping effect level instead of level 3, by design.
const uniq = (l, key) => JSON.stringify([...new Set(l.map(key))].sort());
const sameRungs = (a, b) =>
  a.length === b.length &&
  JSON.stringify(sig(a).at(-1)) === JSON.stringify(sig(b).at(-1)) &&
  uniq(a, (r) => r.dpr) === uniq(b, (r) => r.dpr) &&
  uniq(a, (r) => r.tier) === uniq(b, (r) => r.tier) &&
  uniq(a, (r) => r.effects) === uniq(b, (r) => r.effects);
/** No cascade drop while a lower render scale remains; never back up. */
function cascadeSafe(l) {
  const dprMin = Math.min(...l.map((r) => r.dpr));
  const c0 = l[0].cascades;
  for (let i = 0; i < l.length; i++) {
    if (i && l[i].cascades > l[i - 1].cascades) return false;
    if (l[i].cascades < c0 && l.slice(i).some((r) => r.dpr > dprMin + 1e-6)) return false;
    if (l[i].cascades < c0 && l[i].dpr > dprMin + 1e-6) return false;
  }
  return true;
}

const off = leg('off');
const on = leg('on');

check(
  '(1) flag off: today\'s desktop ladder, cascade drops before any render-scale rung (the defect)',
  !off.on &&
    JSON.stringify(sig(off.desktop1)) ===
      JSON.stringify(['1/high/e0', '1/high/e1', '1/high/e2', '1/high/e3', '0.875/high/e3', '0.75/high/e3', '0.75/medium/e3', '0.75/low/e3']) &&
    !cascadeSafe(off.desktop1),
  fmt(off.desktop1),
);
check(
  '(2) flag on, desktop: same coverage, reordered; no cascade drop while render scale remains',
  on.on && sameRungs(on.desktop1, off.desktop1) && cascadeSafe(on.desktop1) && cascadeSafe(on.desktop15) && sameRungs(on.desktop15, off.desktop15),
  `DPR1: ${fmt(on.desktop1)} | DPR1.5: ${fmt(on.desktop15)}`,
);
check('(3) flag on, Ultra: the 3 -> 2 cascade rung waits for render scale too', sameRungs(on.ultra1, off.ultra1) && cascadeSafe(on.ultra1), fmt(on.ultra1));
check(
  '(4) flag on, phone: identical rungs, and render scale no longer drops the cascade',
  JSON.stringify(sig(on.phone15)) === JSON.stringify(sig(off.phone15)) && cascadeSafe(on.phone15),
  `off: ${fmt(off.phone15)} | on: ${fmt(on.phone15)}`,
);
check(
  '(5) start tier follows the GPU class (phone keeps its policy); flag off keeps today\'s',
  JSON.stringify(on.start) === JSON.stringify({ high: 'high', medium: 'medium', low: 'low', phone: null, unknownDesktop: 'medium' }) &&
    off.start.high === null && off.start.unknownDesktop === 'high',
  `on ${JSON.stringify(on.start)} | off ${JSON.stringify(off.start)}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
