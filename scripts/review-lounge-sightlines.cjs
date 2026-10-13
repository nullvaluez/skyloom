// Lounge sightlines: can the seated eye see each runway's approach and its
// touchdown zone, or does a building (or the terrain) stand in the way?
//
//   node scripts/review-lounge-sightlines.cjs [--port 3123] [--airports KCMH,KJFK,LOWI,YSSY,EGLL]
//        [--settle 25] [--out .graphics-review/lounge-sightlines]
//        [--site runwayId,along,cross,floorM] [--candidates ...] [--grid ...]
//
// For every landing direction of the observed airport (airportWatch.runways)
// it traces straight lines from the eye to the touchdown zone (threshold +
// 300 m, 4 m up) and to points on a 3-degree approach (1.5 to 12 km out),
// marching through the streamed satellite building columns
// (satBuildings.queryColumns, absolute world units) and the terrain
// (engine.getGroundAt). The world bend is ignored (under 8 m at 10 km).
// Writes report.json (per airport, per direction, per point: clear or the
// first obstruction with its range and height) and prints a summary.
//
// --candidates "lx,lz,floorM;..." also scores other seats around the current
// site (room-local metres: x right along the runway, z back, -z toward it),
// using the buildings already streamed around this one. Buildings inside a
// candidate's own set footprint (the pier and apron that would replace them,
// airport-layout.js 'big') are ignored there. --grid "x0:x1:dx,z0:z1:dz,floorM"
// adds a grid of candidates. Each candidate also reports where its footprint
// would land on the OSM airfield (runtime.airfieldGround.features): samples on
// a runway or taxiway (bad: the pier and apron would cover live pavement) and
// on an apron (good). The table at the end ranks them.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const port = arg('port', '3123');
const airports = arg('airports', 'KCMH,KJFK,LOWI,YSSY,EGLL').split(',');
const settle = Number(arg('settle', '25')) * 1000;
const out = path.resolve(arg('out', '.graphics-review/lounge-sightlines'));
const url = arg('url', `http://localhost:${port}/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on`);
const candidates = arg('candidates', '').split(';').filter(Boolean).map((s) => s.split(',').map(Number));
// --site "runwayId,along,cross,floorM": seat the lounge there instead of the
// authored one (window.__flyLoungeSiteOverride, development builds only).
const siteArg = arg('site', '');
const siteOverride = siteArg ? (([runway, along, cross, floorM]) => ({ runway, along: +along, cross: +cross, floorM: +floorM }))(siteArg.split(',')) : null;
const grid = arg('grid', '');
if (grid) {
  const [[x0, x1, dx], [z0, z1, dz], [floorM]] = grid.split(',').map((s) => s.split(':').map(Number));
  for (let x = x0; x <= x1; x += dx) for (let z = z0; z <= z1; z += dz) candidates.push([x, z, floorM]);
}
fs.mkdirSync(out, { recursive: true });
const report = { url, airports: {} };

async function audit(page, cand) {
  return page.evaluate((cand) => {
    const r = window.__fly, w = r.airportWatch, cam = r.camera, A = r.origin.anchor, site = w.site;
    const toWorld = (lx, lz) => {
      const c = Math.cos(site.heading), s = Math.sin(site.heading);
      return { x: site.x + site.k * (lx * c + lz * s), z: site.z + site.k * (-lx * s + lz * c) };
    };
    const groundY = (x, z) => {
      const geo = r.engine.worldToGeo({ x, y: 0, z });
      const s = r.engine.getGroundAt(geo.x, geo.y);
      return s && Number.isFinite(s.elev) ? s.elev : null;
    };
    let eye = { x: cam.position.x + A.x, y: cam.position.y, z: cam.position.z + A.z };
    const [clx, clz] = cand || [0, 0];
    if (cand) {
      const p = toWorld(clx, clz);
      const g = groundY(p.x, p.z) ?? site.groundY;
      eye = { x: p.x, y: g + cand[2] + 1.18, z: p.z };
    }
    // The seat's own pier and apron retire the OSM buildings under them (the
    // collision columns keep them), so a column inside that box is not in the
    // view. The live layout when there is one, else the 'big' set's box.
    const L = r.airportSet?.layout;
    const box = L ? { x0: L.apron.x0, x1: L.apron.x1, z0: L.apron.z0, z1: L.terminal.z1 } : { x0: -340, x1: 340, z0: -190, z1: 75 };
    const ignore = (x, z) => {
      const c = Math.cos(site.heading), s = Math.sin(site.heading);
      const ux = (x - site.x) / site.k, uz = (z - site.z) / site.k;
      const rx = ux * c - uz * s - clx, rz = ux * s + uz * c - clz;
      return rx > box.x0 && rx < box.x1 && rz > box.z0 && rz < box.z1;
    };
    const trace = (tx, ty, tz) => {
      const dx = tx - eye.x, dy = ty - eye.y, dz = tz - eye.z;
      const k = w.frame?.k || w.site?.k || 1;
      const len = Math.hypot(dx / k, dz / k);
      const steps = Math.ceil(Math.min(len, 6000) / 12);
      for (let i = 1; i <= steps; i++) {
        const t = (i * 12) / len;
        if (t >= 1) break;
        const px = eye.x + dx * t, py = eye.y + dy * t, pz = eye.z + dz * t;
        const cols = r.satBuildings?.queryColumns?.(px, pz, 40 * k) ?? [];
        for (const c of cols) {
          if (ignore(c.x, c.z)) continue;
          if (Math.hypot(c.x - px, c.z - pz) < c.r && c.topY > py) {
            return { blocked: 'building', rangeM: Math.round(t * len), aboveSightM: +(c.topY - py).toFixed(1), topY: +c.topY.toFixed(1) };
          }
        }
        if (i % 4 === 0) {
          const g = groundY(px, pz);
          if (g != null && g > py) return { blocked: 'terrain', rangeM: Math.round(t * len), aboveSightM: +(g - py).toFixed(1) };
        }
      }
      return { blocked: null, rangeM: Math.round(len) };
    };
    const tan3 = Math.tan((3 * Math.PI) / 180);
    const rows = [];
    for (const rw of w.runways || []) {
      const k = rw.k || 1;
      const g0 = groundY(rw.tx, rw.tz) ?? rw.elev;
      const tdx = rw.tx + rw.ux * 300 * k, tdz = rw.tz + rw.uz * 300 * k;
      const tdy = (groundY(tdx, tdz) ?? g0) + 4;
      const points = [{ at: 'touchdown', ...trace(tdx, tdy, tdz) }];
      for (const d of [1500, 3000, 5000, 8000, 12000]) {
        points.push({ at: `final ${d / 1000} km`, ...trace(rw.tx - rw.ux * d * k, g0 + 15 + d * tan3, rw.tz - rw.uz * d * k) });
      }
      rows.push({ runway: rw.label, points });
    }
    // Footprint on the OSM airfield: sample the pier + apron box of this seat.
    let footprint = null;
    const F = r.airfieldGround?.features;
    if (F) {
      const inRing = (ring, x, z) => {
        let inside = false;
        for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
          const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
          if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
        }
        return inside;
      };
      const inPoly = (rings, x, z) => inRing(rings[0], x, z) && !rings.slice(1).some((h) => inRing(h, x, z));
      const nearLine = (lines, x, z, m) => lines.some((l) => {
        const P = l.pts; // flat [x, z, x, z, ...]
        for (let i = 0; i + 3 < P.length; i += 2) {
          const ax = P[i], az = P[i + 1], bx = P[i + 2], bz = P[i + 3];
          const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
          if (Math.hypot(ax + vx * t - x, az + vz * t - z) < m * site.k) return true;
        }
        return false;
      });
      const [clx, clz] = cand ? cand : [0, 0];
      let n = 0, runway = 0, taxiway = 0, apron = 0;
      for (let lx = -300; lx <= 300; lx += 30) {
        for (let lz = -190; lz <= 68; lz += 24) {
          const p = toWorld(clx + lx, clz + lz);
          n++;
          const polys = F.pavements.filter((q) => inPoly(q.rings, p.x, p.z));
          if (polys.some((q) => q.cls === 'runway') || nearLine(F.runwayLines || [], p.x, p.z, 40)) runway++;
          else if (polys.some((q) => q.cls === 'taxiway') || nearLine(F.taxiwayLines || [], p.x, p.z, 18)) taxiway++;
          else if (polys.some((q) => q.cls === 'apron')) apron++;
        }
      }
      footprint = { samples: n, runway, taxiway, apron };
    }
    return {
      site: w.site && { runway: w.site.runwayId, along: Math.round(w.site.along), cross: Math.round(w.site.cross), floorM: w.site.floorM },
      candidate: cand,
      footprint,
      columnsNearEye: (r.satBuildings?.queryColumns?.(eye.x, eye.z, 3000) ?? []).length,
      blocked: rows.reduce((n, row) => n + row.points.filter((p) => p.blocked).length, 0),
      rows,
    };
  }, cand);
}

function print(res) {
  for (const row of res.rows) {
    const cells = row.points.map((p) => (p.blocked ? `${p.at}: ${p.blocked.toUpperCase()} @${p.rangeM}m (+${p.aboveSightM}m)` : `${p.at}: clear`));
    console.log(`    ${row.runway.padEnd(4)} ${cells.join(' | ')}`);
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    for (const airport of airports) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      await page.addInitScript(([ident, seat]) => {
        window.__flyVisualsOverride = 'enhanced';
        if (seat) window.__flyLoungeSiteOverride = { [ident]: seat };
        localStorage.setItem('fly-map-style-2', 'satellite');
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-controls-seen', '1');
      }, [airport, siteOverride]);
      try {
        await page.goto(url, { timeout: 240000 });
        await page.waitForFunction(() => window.__fly?.airportWatch, undefined, { timeout: 240000 });
        await page.evaluate((id) => window.__fly.airportWatch.enter(id), airport);
        await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
        await page.waitForTimeout(settle);
        const res = await audit(page, null);
        report.airports[airport] = { ...res, errors, candidates: [] };
        console.log(`\n${airport}  site ${JSON.stringify(res.site)}  columns<3km ${res.columnsNearEye}  blocked ${res.blocked}  footprint ${JSON.stringify(res.footprint)}`);
        print(res);
        const scored = [];
        for (const cand of candidates) {
          const c = await audit(page, cand);
          report.airports[airport].candidates.push(c);
          scored.push(c);
        }
        if (scored.length) {
          // Rank: no pavement under the set first, then fewest blocked sightlines, then most apron.
          const bad = (c) => (c.footprint ? c.footprint.runway * 4 + c.footprint.taxiway : 0);
          scored.sort((a, b) => bad(a) - bad(b) || a.blocked - b.blocked || (b.footprint?.apron ?? 0) - (a.footprint?.apron ?? 0));
          console.log('  candidates (lx, lz, floor): blocked | footprint runway/taxiway/apron of samples');
          for (const c of scored) {
            const f = c.footprint;
            console.log(`    ${String(c.candidate.join(', ')).padEnd(16)} blocked ${String(c.blocked).padStart(2)} | ${f ? `${f.runway}/${f.taxiway}/${f.apron} of ${f.samples}` : 'no airfield data'}`);
          }
        }
      } catch (e) {
        report.airports[airport] = { failure: String(e.stack || e), errors };
        console.error(airport, e.message);
        process.exitCode = 1;
      } finally {
        await page.close();
      }
    }
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
