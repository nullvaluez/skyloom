/**
 * Phase 4 verification (FLY_MODE_HANDOFF.md §5.4): live traffic.
 * - dozens of aircraft ingest over NYC; they move CONTINUOUSLY between 2s
 *   polls (20Hz sampling of one fast track: no teleport steps)
 * - end-to-end accuracy: rendered position of one hex vs the same
 *   adsb.lol payload (via the local proxy) within ~1.5km / 250m alt
 * - stale ladder under DevTools offline: dim → freeze → fade while still
 *   dead-reckoning, recovery on reconnect
 * - draw calls < 300 with traffic + labels + minimap
 */
const { chromium } = require('playwright');
const path = require('path');

const OUT = __dirname;
const URL = 'http://localhost:3000';
const R = 6378137;
const DEG2RAD = Math.PI / 180;

function worldToLonLat(x, z) {
  return {
    lon: x / R / DEG2RAD,
    lat: (2 * Math.atan(Math.exp(-z / R)) - Math.PI / 2) / DEG2RAD,
  };
}

function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  const apiHits = []; // {t, status} of /api/aircraft responses
  page.on('response', (r) => {
    if (r.url().includes('/api/aircraft?')) apiHits.push({ t: Date.now(), status: r.status() });
  });
  page.on('requestfailed', (r) => {
    if (r.url().includes('/api/aircraft?'))
      apiHits.push({ t: Date.now(), status: `FAIL:${r.failure()?.errorText}` });
  });
  const apiSummary = (sinceMs) => {
    const rows = apiHits.filter((h) => h.t >= sinceMs);
    const ok = rows.filter((h) => h.status === 200).length;
    return `${ok}/${rows.length} polls OK`;
  };

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('header', { timeout: 90000 });
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 90000 });
  console.log('flying; waiting for tiles + first polls...');
  await page.waitForTimeout(18000);
  await page.mouse.move(800, 450);

  // --- ingest sanity ---
  const boot = await page.evaluate(() => ({
    tracks: window.__fly?.traffic?.size ?? -1,
    skew: window.__fly?.traffic?._skewSec,
    stats: window.__flyStats || null,
  }));
  console.log('tracks:', boot.tracks, 'clock skew(s):', boot.skew?.toFixed(2), 'stats:', JSON.stringify(boot.stats));

  // --- continuity: 20Hz for 6s on a fast track ---
  const cont = await page.evaluate(async () => {
    const rt = window.__fly;
    const items = rt.traffic.getNearest(30, rt.flight.pos);
    const pick =
      items.find((i) => Math.hypot(i.fix1.vE, i.fix1.vN) > 80 && i.stale === 0) || items[0];
    if (!pick) return null;
    const hex = pick.hex;
    const out = [];
    await new Promise((res) => {
      const id = setInterval(() => {
        const tr = rt.traffic.tracks.get(hex);
        if (tr) out.push({ t: performance.now(), x: tr.rx, y: tr.ry, z: tr.rz, yaw: tr.yaw });
        if (out.length >= 120) {
          clearInterval(id);
          res();
        }
      }, 50);
    });
    return { hex, samples: out, speed: Math.hypot(pick.fix1.vE, pick.fix1.vN) };
  });

  if (!cont) {
    console.log('CONTINUITY: no track to sample (empty sky?)');
  } else {
    let maxStep = 0;
    let jumps = 0;
    let total = 0;
    for (let i = 1; i < cont.samples.length; i++) {
      const a = cont.samples[i - 1];
      const b = cont.samples[i];
      const step = Math.hypot(b.x - a.x, b.z - a.z); // world units ≈ 1.32× true m
      total += step;
      maxStep = Math.max(maxStep, step);
      if (step > 150) jumps++;
    }
    console.log(
      `CONTINUITY ${cont.hex}: speed=${cont.speed.toFixed(0)}m/s samples=${cont.samples.length} total=${total.toFixed(0)}u maxStep=${maxStep.toFixed(1)}u teleports(>150u)=${jumps} (expect 0)`
    );

    // --- accuracy vs the same API the 2D map uses ---
    const geo = await page.evaluate(() => {
      const g = window.__fly.geo;
      return g ? { lat: g.y, lon: g.x } : null;
    });
    const rendered = cont.samples[cont.samples.length - 1];
    const res = await fetch(
      `${URL}/api/aircraft?lat=${geo.lat.toFixed(2)}&lon=${geo.lon.toFixed(2)}&dist=150`
    );
    const payload = await res.json();
    const ac = payload.ac?.find((a) => a.hex === cont.hex);
    if (!ac || typeof ac.lat !== 'number') {
      console.log('ACCURACY: hex not in fresh payload, skipping');
    } else {
      // Extrapolate the API's own fix by seen_pos so both sides speak
      // "now" (our renderer dead-reckons; the raw fix is seen_pos old).
      const KT = 0.514444;
      const age = typeof ac.seen_pos === 'number' ? ac.seen_pos : 0;
      const spd = (ac.gs ?? 0) * KT;
      const trk = ((ac.track ?? 0) * Math.PI) / 180;
      const apiLat = ac.lat + ((spd * Math.cos(trk) * age) / 6371000 / DEG2RAD) * 1;
      const apiLon =
        ac.lon + (spd * Math.sin(trk) * age) / (6371000 * Math.cos(ac.lat * DEG2RAD)) / DEG2RAD;
      const ll = worldToLonLat(rendered.x, rendered.z);
      const dPos = haversineM(ll.lat, ll.lon, apiLat, apiLon);
      const apiAltM = (typeof ac.alt_geom === 'number' ? ac.alt_geom : ac.alt_baro) * 0.3048;
      const dAlt = Math.abs(rendered.y - (Number.isFinite(apiAltM) ? apiAltM : rendered.y));
      let dHdg = null;
      if (typeof ac.track === 'number') {
        const yawDeg = ((rendered.yaw / DEG2RAD) % 360 + 360) % 360;
        dHdg = Math.abs(((yawDeg - ac.track + 540) % 360) - 180);
      }
      console.log(
        `ACCURACY ${cont.hex}: pos Δ${dPos.toFixed(0)}m (≤1500) alt Δ${dAlt.toFixed(0)}m (≤250) hdg Δ${dHdg?.toFixed(0)}° (≤15)`
      );
    }
  }

  // --- screenshots while turning toward the traffic ---
  await page.keyboard.down('d');
  await page.waitForTimeout(2600);
  await page.keyboard.up('d');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'p4-01-traffic.png') });

  // --- stale ladder: offline 40s ---
  console.log('going offline 40s (stale ladder)...');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  const ladderProbe = () =>
    page.evaluate(() => {
      const rt = window.__fly;
      const now = rt.traffic.serverNow(performance.now() / 1000);
      const rows = [];
      for (const tr of rt.traffic.tracks.values()) {
        if (!tr.fix1) continue;
        rows.push({ age: now - tr.fix1.t, opacity: tr.opacity, stale: tr.stale });
        if (rows.length >= 400) break;
      }
      const ages = rows.map((r) => r.age).sort((a, b) => a - b);
      return {
        rows,
        skew: rt.traffic._skewSec,
        ageMin: ages[0],
        ageMed: ages[Math.floor(ages.length / 2)],
        ageMax: ages[ages.length - 1],
      };
    });

  const offlineStart = Date.now();
  await page.waitForTimeout(17000);
  let probe = await ladderProbe();
  let rows = probe.rows;
  let bad = rows.filter((r) => r.age > 16 && r.age < 29 && r.opacity > 0.65).length;
  console.log(
    `t+17s: ${rows.length} tracks, dim violations: ${bad} (expect 0) | ages min/med/max ${probe.ageMin?.toFixed(0)}/${probe.ageMed?.toFixed(0)}/${probe.ageMax?.toFixed(0)}s`
  );

  // dead reckoning continues while offline
  const drA = await page.evaluate(() => {
    const it = window.__fly.traffic.getNearest(5, window.__fly.flight.pos)[0];
    return it ? { hex: it.hex, x: it.rx, z: it.rz } : null;
  });
  await page.waitForTimeout(2000);
  const drB = await page.evaluate((hex) => {
    const tr = window.__fly.traffic.tracks.get(hex);
    return tr ? { x: tr.rx, z: tr.rz, stale: tr.stale } : null;
  }, drA?.hex);
  if (drA && drB) {
    const moved = Math.hypot(drB.x - drA.x, drB.z - drA.z);
    console.log(`offline DR: ${drA.hex} moved ${moved.toFixed(0)}u in 2s (must be > 0 unless frozen; stale=${drB.stale})`);
  }

  await page.waitForTimeout(16000);
  probe = await ladderProbe();
  rows = probe.rows;
  bad = rows.filter((r) => r.age > 31 && r.age < 59 && (r.opacity > 0.35 || r.stale !== 2)).length;
  console.log(
    `t+35s: ${rows.length} tracks, freeze violations: ${bad} (expect 0) | ages min/med/max ${probe.ageMin?.toFixed(0)}/${probe.ageMed?.toFixed(0)}/${probe.ageMax?.toFixed(0)}s`
  );
  await page.screenshot({ path: path.join(OUT, 'p4-02-stale.png') });

  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  console.log('back online (30s recovery window)...');
  const reconnectAt = Date.now();
  await page.waitForTimeout(30000);
  const recovered = await page.evaluate(() => {
    const rt = window.__fly;
    const now = rt.traffic.serverNow(performance.now() / 1000);
    let fresh = 0;
    for (const tr of rt.traffic.tracks.values()) {
      if (tr.fix1 && now - tr.fix1.t < 12) fresh++;
    }
    return { fresh, total: rt.traffic.size };
  });
  console.log(`recovery: ${recovered.fresh}/${recovered.total} tracks fresh (<12s) — must be > 0`);
  console.log(
    `api polls during offline: ${apiSummary(offlineStart)} | after reconnect: ${apiSummary(reconnectAt)}`,
    '| last few:',
    JSON.stringify(apiHits.slice(-5).map((h) => h.status))
  );
  await page.screenshot({ path: path.join(OUT, 'p4-03-recovered.png') });

  // --- perf ---
  const frames = await page.evaluate(async () => {
    const out = [];
    await new Promise((res) => {
      let prev = 0;
      let n = 0;
      const loop = (t) => {
        if (prev) out.push(t - prev);
        prev = t;
        if (++n < 240) requestAnimationFrame(loop);
        else res();
      };
      requestAnimationFrame(loop);
    });
    return out;
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const stats = await page.evaluate(() => window.__flyStats || null);
  console.log(
    `frames p50=${sorted[Math.floor(sorted.length / 2)].toFixed(1)}ms p95=${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms | stats:`,
    JSON.stringify(stats),
    '| drawCalls must be < 300'
  );

  console.log('--- errors ---');
  const errs = consoleLines.filter((l) => l.startsWith('[pageerror]') || l.includes('fly-traffic'));
  console.log(errs.slice(0, 10).join('\n') || 'none');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  await browser.close();
})().catch((e) => {
  console.error('DRIVE FAILED:', e.message);
  process.exit(1);
});
