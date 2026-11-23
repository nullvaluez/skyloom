// ONE REVEAL (FLY_HORIZON_FILL.md "Second round", stream L): the owner's
// review harness for the RTX 5080. Boots a fixed pose four times, each in its
// own fresh browser profile:
//
//   on-cold   ?flags=ONE_REVEAL,   empty profile (no HTTP or Cache API cache)
//   on-warm   the same profile, reloaded
//   off-cold  ?flags=-ONE_REVEAL,  empty profile
//   off-warm  the same profile, reloaded
//
// and records, per boot: the time from navigation to the reveal
// (window.__flyBoot.pct reaching 100), window.__flyStats.oneReveal at the
// reveal and again `afterSec` later (which term released the hold, how long
// each term held it, and what changed inside the reveal area after it: late
// roof fades, terrain promotions, colour-reference fades, photo fades, carpet
// rebuilds), then prints the arms side by side.
//
//   node scripts/review-one-reveal.cjs <server-url> [place] [preset] [afterSec]
//     place     argenteuil | manhattan | powell        (default argenteuil)
//     preset    high | ultra                           (default high)
//     afterSec  seconds watched after each reveal      (default 30)
//
// Output: .graphics-review/one-reveal/<place>-<preset>/report.json. It runs
// against a server the owner starts; it never starts one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.graphics-review', 'one-reveal');
const PLACES = {
  // The owner's slow flight: 399 kt over Argenteuil ran at about 31 FPS.
  argenteuil: { lat: 48.947, lon: 2.248, altM: 915, headingDeg: 140, sunUtc: '2026-06-21T10:00:00Z' },
  manhattan: { lat: 40.70, lon: -74.03, altM: 900, headingDeg: 30, sunUtc: '2026-06-21T16:00:00Z' },
  powell: { lat: 40.199, lon: -83.128, altM: 915, headingDeg: 130, sunUtc: '2026-06-21T15:00:00Z' },
};
const ARMS = [
  { name: 'on', flags: 'ONE_REVEAL' },
  { name: 'off', flags: '-ONE_REVEAL' },
];
const REVEAL_TIMEOUT_MS = 120000;

// Installed before any page script: notes the moment the curtain reaches 100.
function revealProbe() {
  window.__orProbe = { revealAt: null, phases: [] };
  const id = setInterval(() => {
    const b = window.__flyBoot;
    if (!b) return;
    const last = window.__orProbe.phases.at(-1);
    if (!last || last.phase !== b.phase) window.__orProbe.phases.push({ phase: b.phase, at: Math.round(performance.now()) });
    if (b.pct === 100 && window.__orProbe.revealAt == null) {
      window.__orProbe.revealAt = Math.round(performance.now());
      clearInterval(id);
    }
  }, 50);
}

const read = () => ({
  probe: window.__orProbe,
  oneReveal: window.__flyStats?.oneReveal ? JSON.parse(JSON.stringify(window.__flyStats.oneReveal)) : null,
  bootGate: window.__flyStats?.bootGate ?? null,
  worldStatus: window.__flyWorldStatus ?? null,
  roofs: typeof window.__flyLookRoofs === 'function' ? (({ faded, landed, intoBundle, photoShare }) => ({ faded, landed, intoBundle, photoShare }))(window.__flyLookRoofs()) : null,
});

async function boot(page, url, afterSec) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__orProbe?.revealAt != null, null, { timeout: REVEAL_TIMEOUT_MS, polling: 250 });
  const atReveal = await page.evaluate(read);
  const wallMs = Date.now() - t0;
  await page.waitForTimeout(afterSec * 1000);
  const later = await page.evaluate(read);
  return { revealMs: atReveal.probe.revealAt, wallMs, phases: atReveal.probe.phases, atReveal: atReveal.oneReveal, after: later.oneReveal, bootGate: later.bootGate, worldStatus: later.worldStatus, roofs: later.roofs };
}

async function run(origin, place = 'argenteuil', preset = 'high', afterSec = 30) {
  const { chromium } = require('playwright');
  assert.ok(origin && /^https?:\/\//.test(origin), 'Supply the server URL the owner started');
  assert.ok(Object.hasOwn(PLACES, place), `place: ${Object.keys(PLACES).join(' | ')}`);
  assert.ok(['high', 'ultra'].includes(preset), 'preset: high | ultra');
  assert.ok(Number.isFinite(afterSec) && afterSec >= 0, 'afterSec: a number of seconds');
  const pose = PLACES[place];
  const out = path.join(OUT, `${place}-${preset}`);
  fs.mkdirSync(out, { recursive: true });
  const report = { place, preset, afterSec, pose, arms: {}, errors: [] };
  for (const arm of ARMS) {
    const url = new URL(origin);
    url.search = new URLSearchParams({
      at: [pose.lat, pose.lon, Math.round(pose.altM / 0.3048)].join(','),
      aircraft: 'airliner', sunUtc: pose.sunUtc, weather: 'baseline', flags: arm.flags,
    }).toString();
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), `one-reveal-${arm.name}-`));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      page.on('pageerror', (err) => report.errors.push(`${arm.name}: ${err.message}`));
      await page.route('**/api/aircraft?*', (route) => route.fulfill({ json: { ac: [], now: 1782054000 } }));
      await page.addInitScript((quality) => {
        localStorage.setItem('fly-quality-tier', quality);
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      }, preset);
      await page.addInitScript(revealProbe);
      console.log(`${arm.name}-cold ...`);
      report.arms[`${arm.name}-cold`] = { url: url.href, ...(await boot(page, url.href, afterSec)) };
      console.log(`${arm.name}-warm ...`);
      report.arms[`${arm.name}-warm`] = { url: url.href, ...(await boot(page, url.href, afterSec)) };
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  print(report);
  console.log(`\nreport: ${path.relative(ROOT, path.join(out, 'report.json'))}`);
  if (report.errors.length) console.log(`page errors:\n  ${report.errors.join('\n  ')}`);
}

function print(report) {
  const names = Object.keys(report.arms);
  const col = (v) => String(v ?? '-').padStart(12);
  const row = (label, f) => console.log(label.padEnd(26) + names.map((n) => col(f(report.arms[n]))).join(''));
  console.log(`\nONE REVEAL review: ${report.place}, ${report.preset}, ${report.afterSec} s watched after each reveal\n`);
  console.log(''.padEnd(26) + names.map(col).join(''));
  row('reveal (ms from load)', (a) => a.revealMs);
  row('released by', (a) => a.after?.hold?.released);
  row('cap extended (ms)', (a) => a.after?.hold?.extendedMs);
  const held = new Set();
  for (const n of names) for (const k of Object.keys(report.arms[n].after?.hold?.heldMs ?? {})) held.add(k);
  for (const k of [...held].sort()) row(`  held by ${k} (ms)`, (a) => a.after?.hold?.heldMs?.[k] ?? 0);
  row('missing at reveal', (a) => (a.after?.hold?.missingAtReveal ?? []).join(',') || 'none');
  console.log('after the reveal, inside the reveal area:');
  for (const k of ['roofFades', 'terrainPromotions', 'colorRefFades', 'photoFades', 'carpetRebuilds']) row(`  ${k}`, (a) => a.after?.after?.[k]);
  row('  total', (a) => a.after?.afterTotal);
  row('  outside the area', (a) => a.after?.outside);
}

if (require.main === module) {
  const [origin, place, preset, afterSec] = process.argv.slice(2);
  run(origin, place, preset, afterSec === undefined ? 30 : Number(afterSec)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run, PLACES };
