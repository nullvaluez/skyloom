/**
 * TRUE EARTH — verify-player-surface: PLAYER_SURFACE (lib/fly/player-surface.js
 * and its readers: lib/fly/map-style.js, lib/fly/visuals-profile.js,
 * components/fly/hud/SettingsRows.jsx, components/fly/PauseMenu.jsx,
 * components/fly/FlyScene.jsx).
 *
 * THE INTENT. Ship ONE look: players never see the Neon/Classic switches, the
 * review warps or the neon warp confetti in satellite, and a saved Neon or
 * Classic choice migrates once. The harness fleet (automation: it seeds Neon
 * and pins Classic, and three harnesses click the rows) and `?graphicsReview=1`
 * keep every legacy surface.
 *
 * THE CONTRACT — each leg runs the REAL pre-mount resolvers in its own
 * process (the pin resolves once at import, as in the app), seeded with a
 * saved Neon map style and a saved Classic profile:
 *  (1) flag off: nothing moves (today's behaviour);
 *  (2) flag on, player: both choices migrate (store + storage) and the
 *      surfaces are hidden;
 *  (3) flag on, automation: seeded choices stand, surfaces shown;
 *  (4) flag on, ?graphicsReview=1: same as (3);
 *  (5) the three UI sites are gated by reviewSurfaceOn().
 *
 * Run: node scripts/verify-player-surface.mjs
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legArg = process.argv.find((a) => a.startsWith('--leg='));

if (legArg) {
  const leg = JSON.parse(decodeURIComponent(legArg.slice(6)));
  const store = new Map([
    ['fly-map-style-2', 'toy'],
    ['fly-visuals', 'classic'],
  ]);
  globalThis.window = {
    location: { search: leg.review ? '?graphicsReview=1' : '' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    __flyPlayerSurfaceOverride: { enabled: !!leg.flag },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { webdriver: leg.webdriver }, configurable: true });
  register('./_node-resolve.mjs', import.meta.url);
  const { reviewSurfaceOn } = await import('../lib/fly/player-surface.js');
  const { resolveInitialMapStyle } = await import('../lib/fly/map-style.js');
  const { resolveInitialVisuals } = await import('../lib/fly/visuals-profile.js');
  const { useFlyStore } = await import('../stores/fly-store.js');
  resolveInitialMapStyle();
  resolveInitialVisuals();
  const s = useFlyStore.getState();
  console.log(
    JSON.stringify({
      surface: reviewSurfaceOn(),
      mapStyle: s.mapStyle,
      visuals: s.visuals,
      savedStyle: store.get('fly-map-style-2'),
      savedVisuals: store.get('fly-visuals'),
    }),
  );
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const run = (leg) =>
  JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${encodeURIComponent(JSON.stringify(leg))}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .pop(),
  );
const legacy = (r) => r.surface === true && r.mapStyle === 'toy' && r.visuals === 'classic' && r.savedStyle === 'toy' && r.savedVisuals === 'classic';

const off = run({ flag: false, webdriver: false, review: false });
check('(1) flag off: nothing moves', legacy(off), JSON.stringify(off));
const player = run({ flag: true, webdriver: false, review: false });
check(
  '(2) flag on, player: Neon/Classic migrate to Day/Enhanced (store + storage); surfaces hidden',
  player.surface === false && player.mapStyle === 'satellite' && player.visuals === 'enhanced' && player.savedStyle === 'satellite' && player.savedVisuals === 'enhanced',
  JSON.stringify(player),
);
const bot = run({ flag: true, webdriver: true, review: false });
check('(3) flag on, automation: the harness fleet\'s seeded choices stand', legacy(bot), JSON.stringify(bot));
const review = run({ flag: true, webdriver: false, review: true });
check('(4) flag on, ?graphicsReview=1: legacy surfaces and choices stand', legacy(review), JSON.stringify(review));

{
  const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
  const rows = read('components/fly/hud/SettingsRows.jsx');
  const pause = read('components/fly/PauseMenu.jsx');
  const scene = read('components/fly/FlyScene.jsx');
  const ok =
    rows.includes('const lookSwitches = reviewSurfaceOn();') &&
    rows.includes('const visualsRow = visualsAvailable() && lookSwitches && (') &&
    rows.includes('const mapStyleRow = lookSwitches && (') &&
    pause.includes("mapStyle === 'satellite' && immersiveOn() && reviewSurfaceOn() && (") &&
    scene.includes("{(mapStyle === 'toy' || reviewSurfaceOn()) && <WarpBurst");
  check('(5) the rows, the review warps and the satellite confetti are gated by reviewSurfaceOn()', ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
