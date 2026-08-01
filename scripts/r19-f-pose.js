/**
 * F REWIND — toy draw/tri measurement at the budget poses.
 *
 * Altitude is PINNED on an interval (the verify-neon-alt idiom): a warp's
 * altM is an initial condition, not a hold — the flight model sinks out of it
 * within seconds and the ultra-ring hysteresis then disarms, which silently
 * turns a "cruise" measurement into a low one (first run of this script
 * reported full:36 at FL260 — the ring had never shrunk).
 *
 * Usage: node scripts/r19-f-pose.js <label> [poses...]
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const POSES = {
  // cruise = the verify-neon-alt pose: FL260, ultra ring armed, full ring shrunk
  cruise: { lat: 40.7549, lon: -73.984, y: 7925, ultra: true },
  powell: { lat: 40.1578, lon: -83.0752, y: 900, ultra: false },
  nyclow: { lat: 40.7549, lon: -73.984, y: 1200, ultra: false },
};

(async () => {
  const label = process.argv[2] || 'run';
  const want = process.argv.slice(3);
  const list = want.length ? want : Object.keys(POSES);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  let errs = 0;
  page.on('pageerror', (e) => {
    errs++;
    console.log('PAGEERROR', e.message);
  });
  await bootFly(page);
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 16, 0); // sun pinned (R18 lesson 7)
  });

  for (const key of list) {
    const p = POSES[key];
    await page.evaluate((pp) => {
      if (window.__posePin) clearInterval(window.__posePin);
      window.__fly.warpToGeo(pp.lat, pp.lon, { altM: pp.y, name: null });
    }, p);
    await page.waitForTimeout(2000);
    await page.evaluate((pp) => {
      window.__posePin = setInterval(() => {
        window.__fly.flight.pos.y = pp.y;
      }, 400);
    }, p);
    if (p.ultra) {
      await page
        .waitForFunction(() => (window.__flyStats?.toy?.ultraReady ?? 0) >= 8, undefined, {
          timeout: 150000,
          polling: 1000,
        })
        .catch(() => console.log(`  (${key}: ultraReady never reached 8)`));
    }
    await page.waitForTimeout(35000); // streaming + drape + finalize settle

    // Peak-sampled: streaming makes a single instant unrepresentative.
    const s = await page.evaluate(async () => {
      let maxDraws = 0;
      let maxTris = 0;
      for (let i = 0; i < 24; i++) {
        maxDraws = Math.max(maxDraws, window.__flyStats?.drawCalls ?? 0);
        maxTris = Math.max(maxTris, window.__flyStats?.triangles ?? 0);
        await new Promise((r) => setTimeout(r, 250));
      }
      const tw = window.__toyWorld;
      const byDetail = {};
      let chunks = 0;
      let meshes = 0;
      // Where do the triangles live? Bucket every toy chunk mesh by its
      // material and by the ring that issued it — tuning caps without this
      // split is guesswork.
      const M = tw?.materials ?? {};
      const nameOf = (mat) =>
        Object.keys(M).find((k) => M[k] === mat) ?? (mat?.type === 'MeshToonMaterial' ? 'toon?' : '?');
      const triBy = {};
      const meshBy = {};
      const instCounts = {};
      if (tw?.chunks) {
        for (const c of tw.chunks.values()) {
          chunks++;
          meshes += c.meshes?.length ?? 0;
          const d = c.tile?.detail ?? '?';
          byDetail[d] = (byDetail[d] ?? 0) + 1;
          for (const m of c.meshes ?? []) {
            const g = m.geometry;
            if (!g) continue;
            const t = g.index ? g.index.count / 3 : (g.attributes?.position?.count ?? 0) / 3;
            const inst = m.isInstancedMesh ? m.count : 1;
            const key = `${d}/${nameOf(m.material)}`;
            triBy[key] = (triBy[key] ?? 0) + t * inst;
            meshBy[key] = (meshBy[key] ?? 0) + 1;
            if (m.isInstancedMesh) {
              (instCounts[key] ??= []).push(m.count);
            }
          }
        }
      }
      for (const k of Object.keys(triBy)) triBy[k] = Math.round(triBy[k] / 1000); // ktris
      // Instance-count distribution: a chunk emitting 4 trees still costs a
      // whole draw call, so the SMALL instancers are the cheap draws to shed.
      const instDist = {};
      for (const k of Object.keys(instCounts)) {
        const a = instCounts[k].sort((x, y) => x - y);
        instDist[k] = `n${a.length} min${a[0]} p25:${a[a.length >> 2]} med${
          a[a.length >> 1]
        } max${a[a.length - 1]} under40:${a.filter((v) => v < 40).length}`;
      }
      return {
        draws: maxDraws,
        tris: maxTris,
        y: Math.round(window.__fly?.flight?.pos?.y ?? -1),
        armed: window.__flyStats?.toy?.ultraArmed,
        chunks,
        meshes,
        byDetail,
        triBy,
        meshBy,
        instDist,
      };
    });
    console.log(
      `POSE ${label} ${key.padEnd(7)} y ${String(s.y).padStart(5)} ultraArmed ${String(
        s.armed
      ).padEnd(5)} draws ${String(s.draws).padStart(4)}  tris ${(s.tris / 1e6).toFixed(
        3
      )}M  chunks ${s.chunks} meshes ${s.meshes}  ${JSON.stringify(s.byDetail)}`
    );
    const top = Object.entries(s.triBy)
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} ${v}k`)
      .join('  ');
    console.log(`     ktris: ${top}`);
    console.log(`     meshes: ${JSON.stringify(s.meshBy)}`);
    console.log(`     inst:   ${JSON.stringify(s.instDist)}`);
  }
  console.log(`POSE ${label} pageerrors ${errs}`);
  await browser.close();
})();
