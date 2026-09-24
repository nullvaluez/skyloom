/**
 * R25 (E CERT) — why does the satellite ROAD ring not settle at a pose?
 *
 * The W0 baseline (scripts/r25-e-baseline.cjs) timed out at P1 Owens after
 * 900 s with readiness missing ['roads'] only. This probe boots satellite on
 * the fixture, warps (pinned) to a pose and every 20 s dumps the z13 1 km
 * ring the readiness contract reads: per tile, the road chunk's state /
 * reason / attempts and its pending drape (gi / nulls / tries), plus the DEM
 * zoom groundAt returns at the tile centre. Diagnostic, not a gate.
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3205 FLY_URL=http://localhost:3035 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/r25-e-roads-probe.cjs [pose] [minutes]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');
const { pose, warpToPose, readinessInPage, roadRingInPage } = require('./_r25-poses');

const P = pose(process.argv[2] || 'owens');
const MIN = Number(process.argv[3] || 12);
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e', 'roads-probe');
fs.mkdirSync(OUT, { recursive: true });


(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const log = [];
  try {
    const b = await bootFly(page, {
      style: 'satellite', timeoutMs: 1800000,
      geo: { lat: P.lat, lon: P.lon, altM: P.altM, headingRad: (P.hdgDeg * Math.PI) / 180 },
    });
    console.log(`boot ${b.ms} ms`);
    await warpToPose(page, P, { sun: 'noon', waitReady: false, pin: true });
    const t0 = Date.now();
    while (Date.now() - t0 < MIN * 60000) {
      await page.waitForTimeout(20000);
      const r = await page.evaluate(readinessInPage);
      const ring = await page.evaluate(roadRingInPage);
      const row = { s: Math.round((Date.now() - t0) / 1000), missing: r.missing, roads: r.roads, agl: r.agl, terra: r.terra, ring };
      log.push(row);
      console.log(JSON.stringify(row));
      fs.writeFileSync(path.join(OUT, `${P.name}.json`), JSON.stringify(log, null, 2));
      if (r.ready) break;
    }
  } catch (e) {
    console.log('ERROR', String(e).slice(0, 300));
  } finally {
    await browser.close();
  }
})();
