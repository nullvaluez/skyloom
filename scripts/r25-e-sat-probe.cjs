/**
 * R25 (E CERT, E1 step 1) — the SATELLITE OFFLINE-FIXTURE BOOT PROBE.
 *
 * Question: does a satellite `bootFly` reach `__flyBoot.pct === 100` on the
 * offline fixture, and does the Living Earth content contract
 * (lib/fly/world-readiness.js) hold at Owens, Manhattan and Powell? If not,
 * WHICH part is missing and WHICH third-party host is the page still asking
 * for? Every non-local request is logged with its fate.
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3205 FLY_URL=http://localhost:3035 \
 *   FLY_BOOT_SCALE=3 /tmp/r25-locks/run-browser.sh \
 *     node -r ./scripts/_pw-shim.js scripts/r25-e-sat-probe.cjs [toy|satellite] [poses...]
 *
 * Output: a JSON record in .graphics-review/r25/e/sat-probe-<style>.json plus
 * a line per poll on stdout. Diagnostic only — no verdict, exit 0 unless the
 * boot itself throws.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { POSES, readinessInPage, warpToPose, pose } = require('./_r25-poses');

const style = process.argv[2] || 'satellite';
const poseNames = process.argv.slice(3).length ? process.argv.slice(3) : ['owens', 'manhattan', 'powell'];
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const hosts = new Map(); // host -> {n, failed, statuses}
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200));
  });
  const note = (req, status, failed) => {
    let h;
    try {
      h = new URL(req.url()).host;
    } catch {
      return;
    }
    if (/^(localhost|127\.0\.0\.1)(:|$)/.test(h) || req.url().startsWith('data:') || req.url().startsWith('blob:')) return;
    const r = hosts.get(h) || { n: 0, failed: 0, statuses: {}, sample: req.url().slice(0, 160) };
    r.n++;
    if (failed) r.failed++;
    if (status != null) r.statuses[status] = (r.statuses[status] || 0) + 1;
    hosts.set(h, r);
  };
  page.on('requestfinished', async (req) => {
    const res = await req.response().catch(() => null);
    note(req, res ? res.status() : null, false);
  });
  page.on('requestfailed', (req) => note(req, 'failed:' + (req.failure()?.errorText || '?'), true));

  // R25_PROBE_UNPIN_TERRA=1: boot with the R22 TERRA fleet pin removed, the
  // A/B that decides whether the pin is what holds the satellite reveal.
  const unpinTerra = process.env.R25_PROBE_UNPIN_TERRA === '1';
  if (unpinTerra) await page.addInitScript(unpinPins, ['__flyTerraPin']);
  const record = { style, unpinTerra, boot: null, poses: [], hosts: null, errors: null };
  const t0 = Date.now();
  // Poll readiness in parallel with the boot so a stall is attributable.
  let stop = false;
  const poller = (async () => {
    while (!stop) {
      await new Promise((r) => setTimeout(r, 10000));
      if (stop) break;
      const s = await page
        .evaluate((fn) => {
          const r = new Function(`return (${fn})()`)();
          const hist = (e) => {
            const h = {};
            for (const c of e?.chunks?.values?.() ?? []) {
              const k = c.state + (c.reason ? ':' + c.reason : '');
              h[k] = (h[k] || 0) + 1;
            }
            return h;
          };
          r.bHist = hist(window.__fly?.satBuildings);
          r.rHist = hist(window.__fly?.satRoads);
          return { boot: window.__flyBoot, ws: window.__flyWorldStatus ?? null, r };
        }, readinessInPage.toString())
        .catch((e) => ({ err: String(e).slice(0, 120) }));
      console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] boot=${JSON.stringify(s.boot)} missing=${JSON.stringify(s.r?.missing)} agl=${s.r?.agl} terra=${JSON.stringify(s.r?.terra)} near=${JSON.stringify(s.r?.near)} mat=${s.r?.materials} forest=${JSON.stringify(s.r?.forest)} apt=${s.r?.airportsPending} dl=${s.r?.downloading} wc=${s.r?.worldCoverTiles} bRing=${JSON.stringify(s.r?.buildings)} rRing=${JSON.stringify(s.r?.roads)} bHist=${JSON.stringify(s.r?.bHist)} rHist=${JSON.stringify(s.r?.rHist)}`);
    }
  })();
  try {
    const b = await bootFly(page, { style: style === 'toy' ? null : style, timeoutMs: 600000 });
    record.boot = { ms: b.ms, worldStatus: await page.evaluate(() => window.__flyWorldStatus ?? null) };
    console.log(`BOOT ${style} revealed in ${b.ms} ms; worldStatus=${JSON.stringify(record.boot.worldStatus)}`);
  } catch (e) {
    record.boot = { error: String(e).slice(0, 300) };
    console.log(`BOOT ${style} FAILED: ${String(e).slice(0, 300)}`);
  }
  stop = true;
  await poller;

  if (style === 'satellite' && record.boot && !record.boot.error) {
    for (const n of poseNames) {
      const P = pose(n);
      const t = Date.now();
      const { ms, readiness } = await warpToPose(page, P, { timeoutMs: 300000, pollMs: 5000 });
      const arrival = await page.evaluate(() => {
        const a = window.__fly.arrivalStats;
        return a ? { kind: a.kind, revealAt: a.revealAt, holdMs: a.holdMs, reason: a.reason } : null;
      });
      const row = { pose: P.id, name: P.name, readyMs: readiness?.ready ? ms : null, readiness, arrival, wallMs: Date.now() - t };
      record.poses.push(row);
      console.log(`POSE ${P.id} ${P.name}: ready=${readiness?.ready} in ${ms} ms missing=${JSON.stringify(readiness?.missing)} arrival=${JSON.stringify(arrival)}`);
    }
  }
  record.hosts = Object.fromEntries(hosts);
  record.errors = [...new Set(errors)].slice(0, 40);
  console.log('HOSTS', JSON.stringify(record.hosts, null, 1));
  console.log('ERRORS', record.errors.length, JSON.stringify(record.errors.slice(0, 10), null, 1));
  const file = path.join(OUT, `sat-probe-${style}${unpinTerra ? '-unpinned' : ''}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 1));
  console.log('wrote', path.relative(process.cwd(), file));
  await browser.close();
  process.exit(record.boot?.error ? 1 : 0);
})();
