/** WORLD PASS B r2 (item 4): kill a building pool worker mid-build and watch the pool recover.
 * Boot with WORLD_ARRIVAL, warp to --pose (dense: many builds in flight), and --killAt s after the
 * warp terminate pool worker --slot (Worker.terminate: its in-flight buildTile promises never
 * settle, exactly a hung or dead worker). Every second: builds in flight, per-slot load, the
 * pool counters (buildTimeouts, workerChecks, workersReplaced), ready tiles, the full ring.
 * Pass: the timed-out builds re-queue, the dead worker is replaced, nothing stays in flight,
 * and the ring completes.
 *   node scripts/wp-arrival-r2-killworker.cjs --url=http://localhost:3322 --out=<dir> [--pose=paris] [--killAt=2] [--slot=1]
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./wp-arrival-r2-lib.cjs');
const { args } = L;
const url = args.url || 'http://localhost:3322';
const out = path.resolve(String(args.out));
fs.mkdirSync(out, { recursive: true });
const pose = L.POSES[args.pose || 'paris'];
const report = { tool: 'wp-arrival-r2-killworker', pose: args.pose || 'paris', killAt: Number(args.killAt || 2), slot: Number(args.slot ?? 1), errors: [], consoleErrors: [], samples: [] };
(async () => {
  console.log('SLOT after', await L.acquireSlot('wp-arrival-r2-killworker'), 'ms');
  const browser = await L.launch();
  try {
    const { page } = await L.boot(browser, { url, flags: 'WORLD_ARRIVAL', firstPose: pose, errors: report.errors, consoleErrors: report.consoleErrors });
    await L.sleep(4000);
    await L.warp(page, pose);
    const t0 = Date.now();
    let killed = false;
    for (;;) {
      await L.sleep(1000);
      const t = (Date.now() - t0) / 1000;
      if (!killed && t >= report.killAt) {
        report.killed = await page.evaluate((i) => { const b = window.__fly.satBuildings, s = b._pool?.[i]; if (!s?.dispose) return { ok: false, pool: b._pool?.length }; const n = s.n; s.dispose(); return { ok: true, inflightOnSlot: n, pool: b._pool.length }; }, report.slot);
        killed = true;
        console.log('KILL', JSON.stringify(report.killed));
      }
      const s = await page.evaluate(() => { const b = window.__fly.satBuildings, st = b.stats; return { building: b.building, slots: b._pool?.map((p) => p.n), timeouts: st.buildTimeouts, checks: st.workerChecks, replaced: st.workersReplaced, ready: st.ready, queued: st.queued, fullRingSec: st.fullRingSec, errorRetries: b._stat.errorRetries }; });
      report.samples.push({ t, ...s });
      if (t % 5 < 1) console.log(t.toFixed(0), JSON.stringify(s));
      if ((s.fullRingSec >= 0 && killed && s.replaced > 0 && s.building === 0) || t > Number(args.sec || 120)) break;
    }
    const last = report.samples.at(-1);
    report.pass = !!report.killed?.ok && last.replaced >= 1 && last.timeouts >= 1 && last.building === 0 && last.fullRingSec >= 0;
    await page.screenshot({ path: path.join(out, 'killworker-after.png') });
  } catch (e) { report.errors.push('fatal ' + String(e?.message ?? e).slice(0, 300)); console.error(e); }
  finally {
    fs.writeFileSync(path.join(out, 'killworker.json'), JSON.stringify(report, null, 1));
    await browser.close(); L.releaseSlot();
    console.log(report.pass ? 'PASS' : 'FAIL', JSON.stringify(report.samples.at(-1)), 'errors', report.errors.length, report.consoleErrors.length);
  }
})();
