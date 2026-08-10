/**
 * SkyLoom trailer — LIVE gameplay capture.
 *
 * Run this on a machine where the dev server is up with real network access
 * (tiles, imagery, live ADS-B) and a real GPU — i.e. your machine, not a CI
 * sandbox. It records short in-engine gameplay segments with Playwright's
 * video recorder and trims/encodes them into `trailer/live/<scene>.mp4`.
 * `trailer/build.mjs` automatically swaps these live segments into the
 * trailer in place of the corresponding Ken Burns stills — rerun it after
 * this script and the trailer becomes real motion footage.
 *
 * Prereqs (same ad-hoc idiom as the verify harnesses):
 *   npm i --no-save playwright ffmpeg-static
 * Usage:
 *   FLY_URL=http://localhost:3000 node trailer/capture.mjs        # all scenes
 *   FLY_URL=http://localhost:3002 node trailer/capture.mjs boost  # one scene
 *
 * Every scene is independent and fails soft: a scene that errors (no traffic
 * up, tiles slow, whatever) is skipped with a log line and the rest continue.
 * Harness etiquette per FLY_ROUND19: point FLY_URL at your own dev server,
 * and don't fly the app in another tab while this records.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = path.join(ROOT, 'trailer', 'live');
const WORK = path.join(ROOT, 'trailer', '.work', 'capture');
const URL = process.env.FLY_URL || 'http://localhost:3000';
const only = process.argv[2] || null;

const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
const { chromium } = await import(path.join(ROOT, 'node_modules', 'playwright', 'index.mjs'));
const { bootFly } = require(path.join(ROOT, 'scripts', '_boot.js'));

fs.mkdirSync(LIVE, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

// Local-solar-time sun pins (the __flySunOverride idiom from r19-f-shots).
const SUN = {
  nyNoon: Date.UTC(2026, 6, 17, 16, 30),
  nyGolden: Date.UTC(2026, 6, 17, 23, 30), // ~19:30 EDT — low warm sun
  nyNight: Date.UTC(2026, 6, 18, 4, 0),
  parisNight: Date.UTC(2026, 6, 18, 0, 30),
};

/**
 * Each scene: boot style, pin sun, warp, let the world stream in, then run
 * `action(page)` — ONLY the final `keepSec` seconds end up in the trailer,
 * so choreography should reach its photogenic state before the end.
 */
const SCENES = [
  {
    id: 'sat-manhattan',
    style: 'satellite',
    sun: SUN.nyGolden,
    warp: { lat: 40.728, lon: -73.998, altM: 750, headingRad: 0 },
    settleSec: 30,
    keepSec: 4.6,
    action: async (page) => {
      await page.keyboard.down('d');
      await page.waitForTimeout(2200);
      await page.keyboard.up('d');
      await page.waitForTimeout(4500);
    },
  },
  {
    id: 'liberty',
    style: 'satellite',
    sun: SUN.nyNoon,
    // spawn 1.6 km south of the statue, nose on it, low
    warp: { lat: 40.6892, lon: -74.0445, altM: 420, offsetM: 1600, offsetBearingRad: Math.PI },
    settleSec: 28,
    keepSec: 4.6,
    action: async (page) => {
      await page.keyboard.down('a');
      await page.waitForTimeout(900);
      await page.keyboard.up('a');
      await page.waitForTimeout(5300);
    },
  },
  {
    id: 'eiffel-night',
    style: 'satellite',
    sun: SUN.parisNight,
    warp: { lat: 48.8584, lon: 2.2945, altM: 620, offsetM: 1900, offsetBearingRad: (5 * Math.PI) / 4 },
    settleSec: 34,
    keepSec: 4.8,
    action: async (page) => {
      await page.waitForTimeout(6200);
    },
  },
  {
    id: 'traffic-cinema',
    style: 'satellite',
    sun: SUN.nyNoon,
    warp: { lat: 40.7549, lon: -73.984, altM: 900, headingRad: 0 },
    settleSec: 26,
    keepSec: 4.6,
    action: async (page) => {
      // Chase a real plane: force-lock + intercept the nearest live contact,
      // then C for the cinema wing-cam once the autopilot is flying the chase.
      const hex = await page.evaluate(() => {
        const items = [...(window.__fly?.traffic?.items ?? [])].sort((a, b) => a.distM - b.distM);
        const t = items.find((i) => i.distM > 800);
        if (t) window.__fly.interceptHex(t.hex);
        return t?.hex ?? null;
      });
      if (!hex) throw new Error('no live traffic in range');
      await page.waitForTimeout(5000);
      await page.keyboard.press('c');
      await page.waitForTimeout(6000);
    },
  },
  {
    id: 'photo-orbit',
    style: 'satellite',
    sun: SUN.nyGolden,
    warp: { lat: 40.706, lon: -74.012, altM: 800, headingRad: Math.PI / 2 },
    settleSec: 28,
    keepSec: 4.4,
    action: async (page) => {
      await page.keyboard.press('p'); // photo mode: HUD hides, flight keeps flying
      await page.waitForTimeout(700);
      await page.mouse.move(640, 360);
      await page.mouse.down();
      for (let i = 1; i <= 40; i++) {
        await page.mouse.move(640 + i * 9, 360 - i * 1.2);
        await page.waitForTimeout(110);
      }
      await page.mouse.up();
      await page.waitForTimeout(900);
      await page.keyboard.press('p');
    },
  },
  {
    id: 'neon-night',
    style: null, // toy/Neon
    sun: SUN.nyNight,
    warp: { lat: 40.73, lon: -73.99, altM: 700, headingRad: 0 },
    settleSec: 24,
    keepSec: 4.4,
    action: async (page) => {
      await page.keyboard.down('a');
      await page.waitForTimeout(2000);
      await page.keyboard.up('a');
      await page.waitForTimeout(4500);
    },
  },
  {
    id: 'boost',
    style: null,
    sun: SUN.nyNight,
    warp: { lat: 41.1, lon: -74.04, altM: 7900, headingRad: 0 },
    settleSec: 18,
    keepSec: 3.6,
    action: async (page) => {
      await page.keyboard.down('Shift'); // fleet boot pins infinite boost
      await page.waitForTimeout(6500);
      await page.keyboard.up('Shift');
    },
  },
];

function trim(src, dst, keepSec, label) {
  const r = spawnSync(
    ffmpeg,
    ['-y', '-sseof', String(-keepSec - 0.3), '-i', src, '-t', keepSec.toFixed(2),
      '-vf', 'scale=1280:720:flags=lanczos,fps=24,format=yuv420p',
      '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', dst],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  if (r.status !== 0) {
    console.error(r.stderr?.toString().slice(-1500));
    throw new Error(`ffmpeg trim failed: ${label}`);
  }
}

const browser = await chromium.launch({
  channel: process.env.CHROMIUM_PATH ? undefined : 'chrome',
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
});

for (const scene of SCENES) {
  if (only && scene.id !== only) continue;
  const t0 = Date.now();
  let ctx;
  try {
    ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: WORK, size: { width: 1280, height: 720 } },
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`  pageerror(${scene.id}): ${e.message}`));
    await page.addInitScript((sun) => {
      window.__flySunOverride = sun;
    }, scene.sun);
    await bootFly(page, { url: URL, ...(scene.style ? { style: scene.style } : {}) });
    await page.evaluate((w) => {
      const { lat, lon, ...opts } = w;
      window.__fly.warpToGeo(lat, lon, { name: null, ...opts });
    }, scene.warp);
    await page.waitForTimeout(scene.settleSec * 1000);
    await scene.action(page);
    const video = page.video();
    await ctx.close();
    const webm = await video.path();
    trim(webm, path.join(LIVE, `${scene.id}.mp4`), scene.keepSec, scene.id);
    fs.rmSync(webm, { force: true });
    console.log(`SCENE ${scene.id}: OK (${Math.round((Date.now() - t0) / 1000)}s) -> trailer/live/${scene.id}.mp4`);
  } catch (e) {
    console.log(`SCENE ${scene.id}: SKIPPED — ${e.message}`);
    try {
      await ctx?.close();
    } catch {}
  }
}
await browser.close();
const got = fs.readdirSync(LIVE).filter((f) => f.endsWith('.mp4'));
console.log(`\ncaptured ${got.length} live segment(s): ${got.join(', ') || 'none'}`);
console.log('now run: node trailer/build.mjs   (live segments replace the matching stills)');
