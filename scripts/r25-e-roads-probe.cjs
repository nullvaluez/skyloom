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
const { pose, warpToPose, readinessInPage } = require('./_r25-poses');

const P = pose(process.argv[2] || 'owens');
const MIN = Number(process.argv[3] || 12);
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e', 'roads-probe');
fs.mkdirSync(OUT, { recursive: true });

function ringDump() {
  const rt = window.__fly, f = rt.flight, eng = rt.satRoads;
  const WORLD = 40075016.68557849, zoom = 13, radiusM = 1000;
  const k = 1 / Math.max(0.1, Math.cos((f.latDeg * Math.PI) / 180));
  const span = WORLD / 2 ** zoom, radius = radiusM * k, n = 2 ** zoom;
  const x0 = Math.floor((f.pos.x - radius + WORLD / 2) / span), x1 = Math.floor((f.pos.x + radius + WORLD / 2) / span);
  const y0 = Math.floor((f.pos.z - radius + WORLD / 2) / span), y1 = Math.floor((f.pos.z + radius + WORLD / 2) / span);
  const tiles = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const minX = x * span - WORLD / 2, minZ = y * span - WORLD / 2;
      const d = Math.hypot(Math.max(minX - f.pos.x, 0, f.pos.x - minX - span), Math.max(minZ - f.pos.z, 0, f.pos.z - minZ - span)) / k;
      if (d > radiusM) continue;
      const key = `${zoom}/${((x % n) + n) % n}/${y}`;
      const c = eng?.chunks?.get(key);
      const p = eng?.pendingFinalize?.find((q) => q.key === key);
      const lon = ((minX + span / 2) / 6378137) * (180 / Math.PI);
      const lat = (2 * Math.atan(Math.exp(-(minZ + span / 2) / 6378137)) - Math.PI / 2) * (180 / Math.PI);
      const g = rt.engine?.getGroundAt?.(lon, lat);
      tiles.push({ key, d: Math.round(d), state: c?.state ?? null, reason: c?.reason ?? null, attempts: c?.attempts ?? null,
        pending: p ? { gi: p.gi, nulls: p.nulls, tries: p.tries ?? 0, hasGrid: !!p.grid } : null, demZ: g?.tileZ ?? null });
    }
  return { now: eng?._now ?? null, pendingN: eng?.pendingFinalize?.length ?? null, chunks: eng?.chunks?.size ?? null, tiles };
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const log = [];
  try {
    const b = await bootFly(page, { style: 'satellite', timeoutMs: 900000 });
    console.log(`boot ${b.ms} ms`);
    await warpToPose(page, P, { sun: 'noon', waitReady: false, pin: true });
    const t0 = Date.now();
    while (Date.now() - t0 < MIN * 60000) {
      await page.waitForTimeout(20000);
      const r = await page.evaluate(readinessInPage);
      const ring = await page.evaluate(ringDump);
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
