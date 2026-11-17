/** WORLD PASS B r2 (item 6): find the deepest footings and look at them, flag off and on.
 *   find:  node scripts/wp-arrival-r2-footing.cjs --mode=find --pose=hk-slope,sf-slope,sf-hills,nyc-harbor --out=<dir>
 *          (WORLD_ARRIVAL on) per pose: settle, then the N runs whose footing is deepest (the
 *          wall bottoms carried below the shipped 6 m sink), with world position and ground;
 *          writes <out>/footing-poses.json: a camera 220 m from each, 70 m above its ground,
 *          looking at it (heading from the camera to the building).
 *   shoot: node scripts/wp-arrival-r2-footing.cjs --mode=shoot --flags=WORLD_ARRIVAL|'' --out=<dir>
 *          one frame per footing pose (and the footing counters of the run under the view).
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./wp-arrival-r2-lib.cjs');
const { args } = L;
const url = args.url || 'http://localhost:3322';
const out = path.resolve(String(args.out));
fs.mkdirSync(out, { recursive: true });
const mode = args.mode || 'find';
const N = Number(args.n || 2);

(async () => {
  console.log('SLOT after', await L.acquireSlot(`wp-arrival-r2-footing ${mode}`), 'ms');
  const browser = await L.launch();
  const report = { mode, flags: args.flags ?? (mode === 'find' ? 'WORLD_ARRIVAL' : ''), errors: [], poses: [] };
  try {
    if (mode === 'find') {
      const names = String(args.pose || 'hk-slope,sf-slope,sf-hills,nyc-harbor').split(',');
      const { page } = await L.boot(browser, { url, flags: 'WORLD_ARRIVAL', firstPose: L.POSES[names[0]] ?? L.POSES['sf-hills'], errors: report.errors });
      const poses = {};
      for (const name of names) {
        const pose = L.POSES[name] ?? { lat: 40.689, lon: -74.028, altM: 420, headingDeg: 30 };
        await L.warp(page, pose); await L.sleep(4000); await L.settle(page, 150000); await L.sleep(8000);
        const top = await page.evaluate((n) => {
          const r = window.__fly, b = r.satBuildings, all = [];
          for (const c of b.chunks.values()) for (const run of c.drapeRuns ?? []) if (run.footDelta > 6) all.push({ x: c.cx + run.ax, z: c.cz + run.az, ground: run.ground, delta: run.footDelta, zoom: run.footZoom });
          all.sort((a, b2) => b2.delta - a.delta);
          return all.slice(0, n).map((f) => { const g = r.engine.worldToGeo({ x: f.x, y: 0, z: f.z }); return { ...f, lon: g.x, lat: g.y }; });
        }, N);
        top.forEach((f, i) => {
          // camera 220 m south-west of the building, looking at it
          const back = 220, a = Math.PI * 1.25, dLat = (back * Math.cos(a)) / 110540, dLon = (back * Math.sin(a)) / (111320 * Math.cos((f.lat * Math.PI) / 180));
          poses[`${name}-foot${i}`] = { lat: f.lat + dLat, lon: f.lon + dLon, altM: Math.round(f.ground + 70), headingDeg: 45, footing: f };
        });
        report.poses.push({ pose: name, top });
        console.log(name, JSON.stringify(top.map((f) => ({ delta: +f.delta.toFixed(1), ground: +f.ground.toFixed(1), zoom: f.zoom }))));
      }
      fs.writeFileSync(path.join(out, 'footing-poses.json'), JSON.stringify(poses, null, 1));
    } else {
      const poses = JSON.parse(fs.readFileSync(path.join(out, 'footing-poses.json'), 'utf8'));
      const flags = typeof args.flags === 'string' ? args.flags : '';
      const names = Object.keys(poses);
      const { page } = await L.boot(browser, { url, flags, firstPose: poses[names[0]], errors: report.errors });
      for (const name of names) {
        const pose = poses[name];
        await L.warp(page, pose); await L.sleep(4000); await L.settle(page, 150000); await L.sleep(10000);
        await page.screenshot({ path: path.join(out, `${name}__${flags ? 'on' : 'off'}.png`) });
        const st = await page.evaluate(() => { const s = window.__fly.satBuildings?.stats ?? {}; return { footings: s.footings, footGaps: s.footGaps, footMaxDelta: s.footMaxDelta, ready: s.ready }; });
        report.poses.push({ pose: name, ...st });
        console.log(name, flags || 'off', JSON.stringify(st));
      }
    }
  } catch (e) { report.errors.push('fatal ' + String(e?.message ?? e).slice(0, 300)); console.error(e); }
  finally { fs.writeFileSync(path.join(out, `footing-${mode}-${args.flags ? 'on' : mode === 'find' ? 'on' : 'off'}.json`), JSON.stringify(report, null, 1)); await browser.close(); L.releaseSlot(); console.log('DONE', out); }
})();
