// FLEET & SKY review captures from the observation lounge (desktop Chrome,
// real GPU, live feeds). Workstream C's companion to
// review-observation-lounge.cjs.
//
//   node scripts/review-fleet-sky.cjs --port 3143 --airport KJFK --utc 16
//        [--views gallery,closeup,approach,cruise,up,wide,parked] [--families a320,b737,...]
//        [--out <dir>] [--settle 20] [--room hide|show] [--fov 3]
//
// Views:
//   gallery   synthetic, frozen airframes parked on the apron in front of the
//             seat (never live contacts: harness-only tracks), each framed at
//             a narrow field of view: the honest way to judge the models
//   closeup   the nearest live contact in front, framed at --fov degrees
//   approach  the nearest approach/departure contact, tracked + framed
//   cruise    the nearest jet laying a contrail, at three zooms
//   up        the sky above the runway (contrails), room meshes parked
//   parked    the stands under the lounge (parked airframes, jet bridges)
//   wide      the default seat view
// Every run writes PNGs and report.json (fleet stats, lights, wakes,
// renderer counts, console errors).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const port = arg('port', '3143');
const airport = arg('airport', 'KJFK');
const utc = arg('utc', '');
const settle = Number(arg('settle', '20')) * 1000;
const views = arg('views', 'gallery,closeup,up,wide').split(',');
const families = arg('families', 'a320,b737,b787,b777,a350,crj,ejet,b747').split(',');
const room = arg('room', 'hide');
const fovDeg = Number(arg('fov', '3'));
const out = path.resolve(arg('out', `.graphics-review/fleet-sky/${airport}-${utc || 'live'}`));
const url = arg('url', `http://localhost:${port}/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on`);
fs.mkdirSync(out, { recursive: true });
const report = { airport, utc, errors: [], shots: [], views: {} };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /fleet|airframe|glow/i.test(m.text())) report.errors.push(m.type() + ': ' + m.text().slice(0, 400)); });
  const shot = async (name) => {
    const file = path.join(out, name + '.png');
    await page.screenshot({ path: file });
    report.shots.push(file);
    console.log('shot', file);
  };
  // Narrow the lens beyond the binoculars' range by wrapping the seat camera.
  const lens = (fov) => page.evaluate((f) => {
    const w = window.__fly.airportWatch;
    if (!w.__origUpdate) w.__origUpdate = w.updateCamera;
    w.updateCamera = (dt, cam) => { w.__origUpdate(dt, cam); if (f > 0 && cam.fov !== f) { cam.fov = f; cam.updateProjectionMatrix(); } };
  }, fov);
  const hideRoom = (hide) => page.evaluate((h) => {
    const root = window.__flyTraffic?.parent;
    const roomGroup = root?.getObjectByName('airport-lounge');
    roomGroup?.traverse((o) => { if (o.isMesh) o.visible = !h; });
    return !!roomGroup;
  }, hide);
  try {
    await page.addInitScript((utcHour) => {
      window.__flyVisualsOverride = 'enhanced';
      if (utcHour !== '') { const d = new Date(); window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(utcHour)); }
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
    }, utc);
    await page.goto(url, { timeout: 240000 });
    await page.waitForFunction(() => window.__fly?.airportWatch, undefined, { timeout: 240000 });
    await page.evaluate((id) => window.__fly.airportWatch.enter(id), airport);
    await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
    await page.waitForTimeout(settle);
    if (room === 'hide') report.roomParked = await hideRoom(true);
    // --tracers hide: park the navigation tracers so only the contrails show.
    // The root also carries the contrails: mute only the tracer meshes.
    if (arg('tracers', 'show') === 'hide') await page.evaluate(() => {
      window.__flyTracers?.traverse((o) => { if (o.isMesh && o.name !== 'sky-trails' && o.name !== 'aircraft-condensation') o.material.colorWrite = false; });
    });
    const stats = () => page.evaluate(() => {
      const r = window.__fly, s = window.__flyStats || {}, info = window.__flyGl?.info;
      return { liveFleet: r.liveFleet && { ...r.liveFleet }, lights: r.fleetLights && { ...r.fleetLights }, wake: s.trafficWake, frame: s.frame, render: info && { calls: info.render.calls, triangles: info.render.triangles }, items: r.traffic?.items?.length };
    });
    report.stats = await stats();
    console.log(JSON.stringify(report.stats));

    for (const view of views) {
      if (view === 'wide') {
        await lens(0);
        await page.evaluate(() => { const w = window.__fly.airportWatch; w.clearSelection(); w.tracking = false; w.yaw = 0; w.pitch = -0.07; });
        await page.waitForTimeout(1500);
        await shot('wide');
      }
      if (view === 'up') {
        await lens(0);
        await page.evaluate(() => { const w = window.__fly.airportWatch; w.clearSelection(); w.tracking = false; w.yaw = 0.1; w.pitch = 0.62; });
        await page.waitForTimeout(1500);
        await shot('up');
        await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw = -1.0; w.pitch = 0.35; });
        await page.waitForTimeout(1200);
        await shot('up-right');
        report.views.up = await stats();
      }
      if (view === 'parked') {
        // The stands under the lounge: parked airframes at the jet bridges.
        await lens(0);
        for (const [name, yaw, pitch, fov] of [['parked', 0, -0.42, 0], ['parked-left', 0.55, -0.32, 0], ['parked-right', -0.55, -0.32, 0], ['parked-door', 0.12, -0.5, 24]]) {
          await page.evaluate(([y, p]) => { const w = window.__fly.airportWatch; w.clearSelection(); w.tracking = false; w.yaw = y; w.pitch = p; }, [yaw, pitch]);
          await lens(fov);
          await page.waitForTimeout(1500);
          await shot(name);
        }
        // Close on the bridge cab at the nearest parked aircraft's L1 door.
        const dock = await page.evaluate(() => {
          const r = window.__fly, w = r.airportWatch, set = r.airportSet, site = set?.site;
          if (!set) return null;
          const stands = set.layout.stands.map((s, i) => ({ s, i })).sort((a, b) => Math.abs(a.s.x) - Math.abs(b.s.x));
          const cls = { regional: { aft: 3.6, half: 1.4, sill: 1.9 }, narrow: { aft: 5.2, half: 2.0, sill: 3.4 }, wide: { aft: 8.6, half: 3.1, sill: 4.9 } };
          const pick = stands[0];
          const d = cls[pick.s.cls];
          const lx = pick.s.x + d.half, lz = pick.s.noseZ - d.aft;
          const c = Math.cos(site.heading), sn = Math.sin(site.heading);
          const wx = site.x + site.k * (lx * c + lz * sn), wz = site.z + site.k * (-lx * sn + lz * c), wy = set.apronY() + set.groundAt(lx, lz) + d.sill + 1;
          const eye = w.seat;
          const dx = wx - eye.x, dz = wz - eye.z, dy = wy - (eye.y + 1.2);
          const yaw = Math.atan2(-dx, -dz) - w.roomHeading, pitch = Math.atan2(dy * site.k, Math.hypot(dx, dz));
          w.clearSelection(); w.tracking = false; w.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); w.pitch = pitch;
          return { stand: pick.s.id, cls: pick.s.cls, distM: Math.round(Math.hypot(dx, dz) / site.k) };
        });
        if (dock) {
          await lens(Math.max(3, Math.min(30, (2 * Math.atan(14 / dock.distM) * 180) / Math.PI)));
          await page.waitForTimeout(1500);
          await shot('parked-dock-' + dock.cls);
        }
        await lens(0);
        report.views.parked = await page.evaluate(() => ({ parked: window.__fly.parkedFleet && { ...window.__fly.parkedFleet }, set: !!window.__fly.airportSet }));
        report.views.dock = dock;
      }
      if (view === 'cruise') {
        // The nearest jet laying a trail: the condensation gap and engine
        // lines (tight), then the whole trail spreading behind it (wide).
        const pick = await page.evaluate(() => {
          const r = window.__fly, w = r.airportWatch, sky = window.__flySkyTrails;
          // Prefer a high jet well above the horizon (less cloud in the way).
          const elev = (x) => { const t = r.traffic.tracks.get(x.hex); return t ? Math.atan2(t.ry - w.floorY, x.distance) : 0; };
          const rows = w.snapshot().filter((x) => x.stale === 0 && sky?.byHex.has(x.hex) && (!w.contactVisible || w.contactVisible(x.hex)) && elev(x) < 0.6)
            .sort((a, b) => (elev(b) > 0.2) - (elev(a) > 0.2) || a.distance - b.distance);
          const p = rows[0];
          if (!p) return null;
          w.select(p.hex);
          const t = r.traffic.tracks.get(p.hex);
          return { hex: p.hex, label: p.label, km: +(p.distance / 1000).toFixed(2), type: t?.meta?.t, altM: Math.round(t?.ry ?? 0), lod: t?.fleet?.lod };
        });
        report.views.cruise = pick;
        if (pick) {
          // The lounge's own binoculars (workstream B): max power, locked on.
          await page.evaluate((hex) => { const w = window.__fly.airportWatch; w.select(hex, { follow: true, binoculars: true }); w.setMagnification(99); }, pick.hex);
          await page.waitForTimeout(3500);
          await shot('cruise-binoculars-' + (pick.type || 'x'));
          for (const [name, spanM] of [['trail', 9000], ['sky', 40000]]) {
            await page.evaluate(() => window.__fly.airportWatch.binoculars(false));
            await lens(Math.max(0.2, Math.min(60, (2 * Math.atan(spanM * 0.5 / (pick.km * 1000)) * 180) / Math.PI)));
            await page.waitForTimeout(2200);
            await shot('cruise-' + name + '-' + (pick.type || 'x'));
          }
          await lens(0);
        }
      }
      if (view === 'closeup' || view === 'approach') {
        const pick = await page.evaluate((mode) => {
          const r = window.__fly, w = r.airportWatch;
          const rows = w.snapshot().filter((x) => x.inFront && x.stale === 0);
          // Arrivals first (facing the lounge: landing lights), then departures.
          const p = mode === 'approach' ? rows.find((x) => x.category === 'approach') || rows.find((x) => x.category === 'departure') : rows.find((x) => x.category !== 'nearby') || rows[0];
          if (!p) return null;
          w.select(p.hex);
          const t = r.traffic.tracks.get(p.hex);
          return { hex: p.hex, label: p.label, km: +(p.distance / 1000).toFixed(2), type: t?.meta?.t, reg: t?.meta?.r, phase: t?.fleet?.phase, lod: t?.fleet?.lod };
        }, view);
        report.views[view] = pick;
        if (pick) {
          // Through the lounge's binoculars, power set so the airframe fills
          // about half the frame (capped at the glasses' maximum).
          await page.evaluate(([hex, km]) => { const w = window.__fly.airportWatch; w.select(hex, { follow: true, binoculars: true }); w.setMagnification(km * 1000 * 0.0101 * 1.2); }, [pick.hex, pick.km]);
          await page.waitForTimeout(3500);
          await shot(view + '-' + (pick.type || 'x'));
          report.views[view].after = await page.evaluate((hex) => { const w = window.__fly.airportWatch, t = window.__fly.traffic.tracks.get(hex); return t && { lod: t.fleet?.lod, px: t.fleetPx, gear: t.fleet?.gear, flaps: t.fleet?.flaps, phase: t.fleet?.phase, mag: w.optics?.mag }; }, pick.hex);
          await page.evaluate(() => { const w = window.__fly.airportWatch; w.binoculars(false); w.clearSelection(); });
        }
      }
      if (view === 'gallery') {
        // Harness-only frozen tracks on the apron, one per family.
        const placed = await page.evaluate((ids) => {
          const r = window.__fly, w = r.airportWatch, T = r.traffic;
          const fams = { a320: 'A321', b737: 'B738', b787: 'B789', b777: 'B77W', a350: 'A359', crj: 'CRJ9', ejet: 'E175', b747: 'B744', a380: 'A388', a330: 'A333', b757: 'B752', b767: 'B763', a220: 'BCS3', md11: 'MD11', erj: 'E145', md80: 'MD88', atr: 'AT76', dash8: 'DH8D', business: 'GLF6', c130: 'C30J', k35r: 'K35R', c17: 'C17', a300: 'A306', piston: 'C172', twin: 'BE20', helicopter: 'EC45' };
          const site = w.site, k = site.k, c = Math.cos(site.heading), s = Math.sin(site.heading);
          const toWorld = (lx, lz) => ({ x: site.x + k * (lx * c + lz * s), z: site.z + k * (-lx * s + lz * c) });
          const now = T.serverNow(performance.now() / 1000) ?? 0;
          const ground = w.floorY - site.floorM;
          const outp = [];
          ids.forEach((id, i) => {
            const hex = 'f1ee' + String(i).padStart(2, '0');
            const t = T._createTrack(hex);
            const lx = -170 + i * 48, lz = -150;
            const p = toWorld(lx, lz);
            const vE = 0, vN = 0;
            t.fix1 = { t: now + 1e6, x: p.x, y: ground + 2, z: p.z, vE, vN, vUp: 0, latRad: 2 * Math.atan(Math.exp(-p.z / 6378137)) - Math.PI / 2 };
            t.flags = 1; t.archetype = 0; t.groundElev = ground; t.yaw = Math.PI / 2 - site.heading + (i % 2 ? 0.55 : -0.45);
            t.meta = { hex, t: fams[id] ?? id, flight: 'TEST' + i, r: 'N' + (100 + i) + 'SK', category: 'A3' };
            T.tracks.set(hex, t);
            outp.push({ hex, id, type: t.meta.t, lx, lz });
          });
          return outp;
        }, families);
        report.views.gallery = placed;
        await page.waitForTimeout(4000);
        for (const g of placed) {
          await page.evaluate((hex) => { const w = window.__fly.airportWatch; w.select(hex); }, g.hex);
          const dist = Math.hypot(g.lx, g.lz + 0) ;
          const fov = (2 * Math.atan((70 * 0.5) / Math.max(60, dist)) * 180) / Math.PI;
          await lens(Math.min(30, fov));
          await page.waitForTimeout(2200);
          await shot('gallery-' + g.id);
        }
        await lens(0);
        await page.evaluate(() => { const w = window.__fly.airportWatch; w.clearSelection(); w.yaw = 0; w.pitch = -0.25; });
        await page.waitForTimeout(1200);
        await shot('gallery-overview');
        report.views.galleryStats = await stats();
        await page.evaluate(() => { const T = window.__fly.traffic; for (const hex of [...T.tracks.keys()]) if (hex.startsWith('f1ee')) T.tracks.delete(hex); });
      }
    }
    report.final = await stats();
  } catch (e) {
    report.failure = String(e.stack || e);
    console.error(e);
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
