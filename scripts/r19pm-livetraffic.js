/**
 * R19 POSTMORTEM (Agent L) — "live crafts aren't showing up" repro.
 *
 * DELIBERATELY NOT scripts/_boot.js. bootFly seeds the harness fleet pins
 * (toy style, weather 'baseline', __flyBoostInfinite, __flyAerialOverride 0)
 * and several probes hide window.__flyPlayer + live traffic outright. A live
 * traffic kill is invisible to that fleet by construction. This boots like a
 * REAL user: default style resolution (satellite), live weather, no pins, real
 * geolocation over NYC — the busiest airspace on the planet.
 *
 * Counts what the user would actually see: TrafficEngine tracks/items (the
 * ingested ADS-B set) and the /api/aircraft responses that fed them.
 *
 * Usage: node scripts/r19pm-livetraffic.js [tag]   (FLY_URL to point elsewhere)
 */
const { chromium } = require('playwright');

const URL = process.env.FLY_URL || 'http://localhost:3210';
const TAG = process.argv[2] || 'before';

// Midtown Manhattan.
const LAT = 40.7128;
const LON = -73.99;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    geolocation: { latitude: LAT, longitude: LON },
    permissions: ['geolocation'],
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  const page = await context.newPage();

  // Record every aircraft-proxy response: which upstream served it, how many
  // rows came back. This is the evidence that separates "ingest dropped them"
  // from "the data never arrived".
  const apiHits = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('/api/aircraft?')) return;
    let n = -1;
    let err = null;
    try {
      const j = await res.json();
      n = Array.isArray(j.ac) ? j.ac.length : -1;
      err = j.error ?? null;
    } catch {
      /* non-JSON */
    }
    apiHits.push({
      status: res.status(),
      source: res.headers()['x-adsb-source'] ?? null,
      stale: res.headers()['x-adsb-stale'] ?? null,
      unavailable: res.headers()['x-adsb-unavailable'] ?? null,
      n,
      err,
    });
  });

  const consoleWarns = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/aircraft|adsb|ADS-B|traffic/i.test(t)) consoleWarns.push(`${m.type()}: ${t}`);
  });

  console.log(`[${TAG}] booting ${URL} (raw, no _boot pins) at ${LAT},${LON} ...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, {
    timeout: 180000,
    polling: 250,
  });
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="boot-screen"]'), {
    timeout: 30000,
  });

  const style = await page.evaluate(() => window.__flyStore?.getState?.().mapStyle ?? null);
  console.log(`[${TAG}] booted. mapStyle=${style}`);

  // Park the plane over Midtown so the poll cell is unambiguous, then let the
  // 1 Hz key + React Query poll run through several cycles.
  await page.evaluate(
    ([lat, lon]) => window.__fly?.warpToGeo?.(lat, lon, { altM: 2500, name: null }),
    [LAT, LON]
  );

  const samples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => {
      const t = window.__fly?.traffic;
      return {
        tracks: t?.tracks?.size ?? null,
        items: t?.items?.length ?? null,
        size: t?.size ?? null,
      };
    });
    samples.push(s);
    console.log(`[${TAG}]   t+${(i + 1) * 5}s  tracks=${s.tracks} items=${s.items}`);
  }

  const final = samples[samples.length - 1];
  await page.screenshot({ path: `scripts/r19pm-livetraffic-${TAG}.png` });

  console.log(`\n[${TAG}] ===== /api/aircraft responses (${apiHits.length}) =====`);
  for (const h of apiHits) {
    console.log(
      `[${TAG}]   status=${h.status} source=${h.source} ac=${h.n}` +
        `${h.err ? ` error=${h.err}` : ''}${h.stale ? ' STALE' : ''}` +
        `${h.unavailable ? ` unavailable=${h.unavailable}` : ''}`
    );
  }
  if (consoleWarns.length) {
    console.log(`\n[${TAG}] ===== console (traffic-related) =====`);
    for (const c of consoleWarns.slice(0, 20)) console.log(`[${TAG}]   ${c}`);
  }

  const maxAc = apiHits.reduce((m, h) => Math.max(m, h.n), -1);
  console.log(`\n[${TAG}] RESULT mapStyle=${style} tracks=${final.tracks} items=${final.items}`);
  console.log(`[${TAG}] RESULT proxy max ac rows in any response = ${maxAc}`);
  console.log(
    `[${TAG}] VERDICT ${final.tracks > 0 ? 'LIVE TRAFFIC PRESENT' : 'NO LIVE TRAFFIC'}`
  );
  console.log(`[${TAG}] screenshot scripts/r19pm-livetraffic-${TAG}.png`);

  await browser.close();
  process.exit(final.tracks > 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
