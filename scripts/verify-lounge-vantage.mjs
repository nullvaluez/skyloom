// Observation lounge — vantage seats gate (node, real modules; LOUNGE_WALK).
//
// Every vantage seat must earn its place. At KCMH, KJFK, LOWI, YSSY and EGLL
// (the classic room; the pier's back seat joins when LOUNGE_PIER lands):
//   - every seat's eye is inside the room and outside the walk blockers'
//     free space (it is in its chair), and its approach point is walkable;
//   - from every seat at least one touchdown zone of the faced runway
//     (threshold + 300 m, 4 m up) and at least two of the three 3-degree
//     approach points of one of its ends (1.5 / 3 / 5 km) are seen through
//     glazing (loungeApertureFrom from that seat's eye) — the targets the
//     seat chooser (lib/fly/lounge-seat.js) scores;
//   - picking works from every seat: through the real runtime (seated there
//     by the walk), a contact straight out of the front glass, out of the
//     nearer side glass and up through the roof strip is visible
//     (watch.contactVisible, the binoculars' and follow's test), and contacts
//     behind the back wall or the solid side walls are not.
// Buildings, terrain and trees are not modelled here (the sightline review,
// scripts/review-lounge-sightlines.cjs --seats all, traces those).
//
// Run: node scripts/verify-lounge-vantage.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Vector3, PerspectiveCamera } from 'three';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});

globalThis.window = { location: { search: '?graphicsReview=1&airports=on' }, matchMedia: () => ({ matches: false }) };
const saved = new Map(); globalThis.localStorage = { setItem: (k, v) => saved.set(k, v), getItem: (k) => saved.get(k) };
globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync('public' + url, 'utf8')) });

const registry = await import('../lib/fly/operations-airports.js');
const { loadCatalogAirport } = await import('./_catalog-airports.mjs');
const { LOUNGE_ROOM, VANTAGE, WALK, SEAT } = await import('../lib/fly/observation-config.js');
const { resolveLoungeSite, siteToWorld, loungeApertureFrom } = await import('../lib/fly/lounge-site.js');
const { roomBlockers } = await import('../lib/fly/lounge/room-build.js');
const W = await import('../lib/fly/lounge/room-walk.mjs');
const { connectAirportWatch } = await import('../lib/fly/airport-watch-runtime.js');
const { useFlyStore } = await import('../stores/fly-store.js');

let checks = 0, failed = 0;
const check = async (name, fn) => {
  try { await fn(); checks++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ' — ' + e.message); }
};
const E = LOUNGE_ROOM.envelope;
const AIRPORTS = ['KCMH', 'KJFK', 'LOWI', 'YSSY', 'EGLL'];
const tan3 = Math.tan((3 * Math.PI) / 180);

/** A scene point -> the room-local unit direction from a seat's eye. */
function roomDir(site, eyeLocal, p) {
  const e = siteToWorld(site, eyeLocal[0], eyeLocal[2]);
  const dx = (p.x - e.x) / site.k, dz = (p.z - e.z) / site.k, dy = p.y - (site.groundY + site.floorM + eyeLocal[1]);
  // Scene -> room-local: the inverse of siteDirToWorld (rotation by the site heading).
  const c = Math.cos(site.heading), s = Math.sin(site.heading);
  const lx = dx * c - dz * s, lz = dx * s + dz * c, n = Math.hypot(lx, dy, lz) || 1;
  return [lx / n, dy / n, lz / n];
}

await check('every vantage seat\'s eye is inside the room and in its chair; its approach is walkable', () => {
  const blockers = roomBlockers('classic'), grid = W.buildWalkGrid(blockers);
  for (const s of VANTAGE.classic) {
    assert.ok(s.eye[0] >= E.minX && s.eye[0] <= E.maxX && s.eye[2] >= E.minZ && s.eye[2] <= E.maxZ, s.id);
    assert.ok(!W.isFree(grid, s.eye[0], s.eye[2]), `${s.id}: the eye sits in its chair`);
    assert.ok(W.isFree(grid, ...s.approach), `${s.id}: the approach is walkable`);
    assert.ok(W.findPath(grid, { x: VANTAGE.classic[0].approach[0], z: VANTAGE.classic[0].approach[1] }, { x: s.approach[0], z: s.approach[1] }), `${s.id}: reachable from the window`);
  }
});

for (const id of AIRPORTS) {
  await check(`${id}: every seat sees a touchdown zone and two of three approach points of the faced runway through glazing`, () => {
    const airport = loadCatalogAirport(registry, id);
    const site = resolveLoungeSite(airport, { variant: 'classic' });
    const rw = registry.airportById(site.runwayId);
    const f = registry.airportFrame(rw);
    const report = [];
    for (const seat of VANTAGE.classic) {
      let tdz = 0, bestApproach = 0;
      for (const [from, thr, dir] of [[0, rw.thresholdA || 0, 1], [f.length, rw.thresholdB || 0, -1]]) {
        const t = from + dir * thr;
        const q = registry.airportPoint(rw, t + dir * 300, 0);
        if (loungeApertureFrom(seat.eye, ...roomDir(site, seat.eye, { x: q.x, y: q.y + 4, z: q.z }), 'classic')) tdz++;
        let seen = 0;
        for (const d of SEAT.approachM) {
          const a = registry.airportPoint(rw, t - dir * d, 0);
          if (loungeApertureFrom(seat.eye, ...roomDir(site, seat.eye, { x: a.x, y: a.y + 15 + d * tan3, z: a.z }), 'classic')) seen++;
        }
        bestApproach = Math.max(bestApproach, seen);
      }
      report.push(`${seat.id} tdz ${tdz}/2 approach ${bestApproach}/3`);
      assert.ok(tdz >= 1 && bestApproach >= 2, `${seat.id}: tdz ${tdz}, approach ${bestApproach} (${site.source} seat, runway ${site.runwayId})`);
    }
    console.log('  ' + id + ': ' + report.join(' · '));
  });
}

// Picking from every seat, through the real runtime. These are the classic
// room's seats and walls, so the classic room is pinned: LOUNGE_PIER ships on
// since 2026-10-18 and its back curtain wall would (rightly) show the '-back'
// contacts. The pier's apertures are verify-lounge-walk's and -pier's.
globalThis.window.__flyLoungeWalkOverride = { enabled: true };
globalThis.window.__flyLoungePierOverride = { enabled: false };
const engine = { worldToGeo: (p) => new Vector3(p.x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(-p.z / 6378137)) - Math.PI / 2) * 180 / Math.PI, p.y), getGroundAt: () => ({ tileZ: 18, elev: 250 }) };
const flight = { pos: new Vector3(), cfg: { speeds: { slow: 60, boost: 300 } }, heading: 0, speed: 100, pitch: 0, bank: 0 };
const runtime = {
  engine, flight, worldLoading: false, traffic: { tracks: new Map(), items: [] }, trafficStatus: { state: 'live' },
  autopilot: { mode: 'off' }, adventures: { suspend() {} },
  operations: { phase: 'airborne', profile: null, events: [], warp() {}, snapshot() { return { ...this }; }, restore(s) { Object.assign(this, s); } },
  warpToGeo(lat, lon, { altM, headingRad = 0 }) { const p = registry.projectAirportPoint(lon, lat); flight.pos.set(p.x, altM, p.z); flight.heading = headingRad; return true; },
};
runtime.targeting = { lockedHex: null, target: null, _lockT: 0 };
useFlyStore.setState({ runtimeReady: true, aircraftId: 'fighter', soundOn: false });
const dispose = connectAirportWatch(runtime);
const w = runtime.airportWatch;
const camera = new PerspectiveCamera(50, 16 / 9, 2.5, 600000);
runtime.camera = camera;

await check('picking from every seat: front, side and roof contacts are visible; contacts behind the back wall or a solid side wall are not', async () => {
  assert.equal(await w.enter('KCMH'), true);
  for (let i = 0; i < 5; i++) w.updateCamera(1 / 60, camera);
  const k = w.frame.k, DEG = Math.PI / 180;
  // A contact `range` metres from the seat's eye along a room-local direction.
  const contact = (hex, eyeL, dir, range) => {
    const n = Math.hypot(...dir), d = dir.map((v) => v / n);
    const local = [eyeL[0] + d[0] * range, eyeL[2] + d[2] * range];
    const p = siteToWorld(w.site, local[0], local[1]);
    const t = { hex, rx: p.x, rz: p.z, ry: w.floorY + eyeL[1] + d[1] * range, stale: 0, flags: 0, horizonFade: 1, fix1: { vE: 0, vN: 0, vUp: 0, latRad: 40 * DEG, t: 1 } };
    t.ryd = t.ry;
    return t;
  };
  for (const seat of VANTAGE.classic) {
    assert.equal(w.sit(seat.id, { instant: true }), true, seat.id);
    for (let i = 0; i < 3; i++) w.updateCamera(1 / 60, camera);
    const sideX = seat.eye[0] < 0 ? -1 : 1;
    const want = {
      [`${seat.id}-front`]: [[0, 0.02, -1], 3000, true],
      [`${seat.id}-side`]: [[sideX * 11.2 - seat.eye[0], 1.2, 1.5 - seat.eye[2]], 2500, true],
      [`${seat.id}-roof`]: [[0, 1, -0.25], 2000, true],
      [`${seat.id}-back`]: [[0, 0.05, 1], 3000, false],
      [`${seat.id}-wall`]: [[-sideX * 1, 0.02, 0.9], 3000, false],
    };
    const tracks = Object.entries(want).map(([hex, [dir, range]]) => contact(hex, seat.eye, dir, range));
    runtime.traffic.tracks = new Map(tracks.map((t) => [t.hex, t]));
    runtime.traffic.items = tracks;
    for (const [hex, [, , visible]] of Object.entries(want)) assert.equal(w.contactVisible(hex), visible, `${hex} visible=${!visible}`);
  }
});

dispose();
delete globalThis.window.__flyLoungeWalkOverride;
delete globalThis.window.__flyLoungePierOverride;
console.log(`\nLOUNGE VANTAGE: ${checks}/${checks + failed}${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
