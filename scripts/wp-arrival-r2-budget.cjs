/** WORLD PASS B r2: geometry bytes per pose, CPU arrays (world-pass-budget's count) and the GPU
 * estimate, plus draws, triangles, engine counters, console errors and a frame per pose.
 *   node scripts/wp-arrival-r2-budget.cjs --url=http://localhost:3322 --pose=paris,nyc-low
 *        [--quality=ultra|high] [--flags=WORLD_ARRIVAL] --out=<dir> [--shots=1]
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./wp-arrival-r2-lib.cjs');
const { args } = L;
const url = args.url || 'http://localhost:3322';
const quality = args.quality || 'ultra';
const flags = typeof args.flags === 'string' ? args.flags : '';
const poses = String(args.pose || 'paris').split(',');
const out = path.resolve(String(args.out));
fs.mkdirSync(out, { recursive: true });
const report = { tool: 'wp-arrival-r2-budget', url, quality, flags, date: new Date().toISOString(), poses: [], errors: [], consoleErrors: [] };
const save = () => fs.writeFileSync(path.join(out, `r2-budget-${quality}.json`), JSON.stringify(report, null, 1));

(async () => {
  console.log('SLOT after', await L.acquireSlot(`wp-arrival-r2-budget ${flags}`), 'ms');
  const browser = await L.launch();
  try {
    const { page, gpu } = await L.boot(browser, { url, flags, quality, firstPose: L.POSES[poses[0]], errors: report.errors, consoleErrors: report.consoleErrors });
    report.gpu = gpu;
    for (const name of poses) {
      const pose = L.POSES[name];
      await L.warp(page, pose);
      const t0 = Date.now();
      await L.sleep(4000);
      const settled = await L.settle(page, Number(args.settleTimeout || 180000));
      await L.sleep(3000);
      const g = await L.geometry(page);
      const st = await page.evaluate(() => {
        const s = window.__fly.satBuildings?.stats ?? {};
        const pick = Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'number'));
        let q = 0; for (const c of window.__fly.satBuildings?.chunks?.values?.() ?? []) if (c.q) q++;
        return { ...pick, quantChunks: q, wp: window.__flyStats?.worldPass?.state?.key ?? null };
      });
      if (args.shots) await page.screenshot({ path: path.join(out, `${name}__${flags ? flags.replace(/,/g, '+') : 'off'}__${quality}.png`) });
      report.poses.push({ pose: name, settled, settleMs: Date.now() - t0, ...g, stats: st });
      save();
      console.log(name, JSON.stringify({ settled, draws: g.draws, tris: g.triangles, cpu: g.cpuMiB, gpu: g.gpuMiB.total, gpuBld: g.gpuMiB.buildings, q: st.quantChunks, clamp: st.quantClamped ?? 0, wp: st.wp }));
    }
  } catch (e) { report.errors.push('fatal ' + e.message); console.error(e); }
  finally { save(); await browser.close(); L.releaseSlot(); console.log('ERRORS', report.errors.length, 'CONSOLE', report.consoleErrors.length, report.consoleErrors.slice(0, 3)); console.log('DONE', out); }
})();
