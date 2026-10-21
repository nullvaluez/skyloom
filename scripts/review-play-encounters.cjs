/**
 * PLAY PASS — ENCOUNTERS review captures (FLY_PLAY_PASS.md, ENCOUNTER_FEEL).
 *
 * Review artifact only: nothing here is imported by the app. It boots one dev
 * server, pins the sun, weather, governor and traffic, puts the aircraft over
 * the Hudson and flies a real Nearby → Fly alongside escort through the UI,
 * writing a full-UI PNG every few seconds plus telemetry (camera mode, lock
 * phase, separation, where each aircraft lands on screen and how big the
 * target draws) to manifest.json.
 *
 *   node scripts/review-play-encounters.cjs --label=after --scene=heli
 *   node scripts/review-play-encounters.cjs --label=before --flags=-ENCOUNTER_FEEL
 *   options: --url=http://localhost:3132  --scene=heli|cessna|jet|live
 *            --seconds=45 --every=3  --width=1440 --height=900  --hour=15.5
 *            --discovery[=id] (no escort: Nearby → Go on a discovery, fly at it, frame it, shoot)
 *            --noSpot (dev pin: no traffic trails, to see the hulls alone)
 *            --trails (no escort: Spotting on, the pose held, a few frames of every trail)
 *
 * The synthetic sky (--scene other than live) flies on from its first poll, so
 * both arms of a before/after see the same aircraft in the same place. These
 * are LOOK captures on a shared GPU, never fps evidence.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { enterFlight } = require('./_skip-menus.js');

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [k, ...v] = s.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const url = (args.url || 'http://localhost:3132').replace(/\/$/, '');
const label = args.label || 'capture';
const sceneId = args.scene || 'heli';
const out = path.resolve(args.out || `.graphics-review/play-pass/encounters/${label}-${sceneId}`);
const viewport = { width: Number(args.width || 1440), height: Number(args.height || 900) };
const seconds = Number(args.seconds || 45);
const every = Number(args.every || 3);
const hour = Number(args.hour || 15.5);
const isMobile = viewport.width < 768;

// Player over the Hudson off Midtown, heading north; the contact ahead.
const PLAYER = { lat: 40.735, lon: -74.016, altM: 320, headingDeg: 5 };
const SCENES = {
  heli: { hex: 'a4f2c1', flight: 'N412SK', r: 'N412SK', t: 'AS50', category: 'A7', altFt: 900, gs: 100, track: 10, dxKm: 0.25, dzKm: 1.3 },
  cessna: { hex: 'a1c77e', flight: 'N738SK', r: 'N738SK', t: 'C172', category: 'A1', altFt: 1500, gs: 105, track: 15, dxKm: -0.4, dzKm: 1.6 },
  jet: { hex: 'a9b3d2', flight: 'SKY204', r: 'N204SK', t: 'A320', category: 'A3', altFt: 4000, gs: 220, track: 20, dxKm: 0.6, dzKm: 2.4 },
};
const scene = SCENES[sceneId] ?? null;
const live = sceneId === 'live';

function solar(lon, h, day = Date.UTC(2026, 6, 18)) {
  return day + (h - lon / 15) * 3600000;
}

const FEED_EPOCH = 1767225600;
let trailPhase = null; // { at, lat, lon } once --trails starts capturing
const feedT0 = Date.now();
function syntheticTraffic() {
  const now = FEED_EPOCH + (Date.now() - feedT0) / 1000;
  const flown = now - FEED_EPOCH;
  const ac = [];
  const add = (a) => {
    const km = (a.gs * 1.852 * flown) / 3600;
    const dx = a.dxKm + km * Math.sin((a.track * Math.PI) / 180);
    const dz = a.dzKm + km * Math.cos((a.track * Math.PI) / 180);
    ac.push({ hex: a.hex, flight: a.flight, r: a.r, t: a.t, category: a.category,
      lat: PLAYER.lat + dz / 111.32, lon: PLAYER.lon + dx / (111.32 * Math.cos((PLAYER.lat * Math.PI) / 180)),
      alt_baro: a.altFt, alt_geom: a.altFt + 100, gs: a.gs, track: a.track, baro_rate: 0, squawk: '1200', seen: 0.4, seen_pos: 0.4 });
  };
  if (scene && !args.trails) add(scene);
  // --trails: crossing contacts at four heights, fresh hexes from the moment
  // the capture phase starts (instant trails), placed off the frozen player.
  if (trailPhase) {
    const tf = now - trailPhase.at;
    const near = (a) => {
      const km = (a.gs * 1.852 * tf) / 3600;
      const dx = a.dxKm + km * Math.sin((a.track * Math.PI) / 180);
      const dz = a.dzKm + km * Math.cos((a.track * Math.PI) / 180);
      ac.push({ hex: a.hex, flight: a.flight, r: a.r, t: a.t, category: a.category,
        lat: trailPhase.lat + dz / 111.32, lon: trailPhase.lon + dx / (111.32 * Math.cos((trailPhase.lat * Math.PI) / 180)),
        alt_baro: a.altFt, alt_geom: a.altFt + 100, gs: a.gs, track: a.track, baro_rate: 0, squawk: '1200', seen: 0.4, seen_pos: 0.4 });
    };
    near({ hex: 'b10001', flight: 'N77HX', r: 'N77HX', t: 'AS50', category: 'A7', altFt: 900, gs: 100, track: 90, dxKm: -1.2, dzKm: 1.6 });
    near({ hex: 'b10002', flight: 'N52CS', r: 'N52CS', t: 'C172', category: 'A1', altFt: 2500, gs: 110, track: 270, dxKm: 1.4, dzKm: 3.2 });
    near({ hex: 'b10003', flight: 'SKY611', r: 'N611SK', t: 'A320', category: 'A3', altFt: 6000, gs: 250, track: 90, dxKm: -3.5, dzKm: 5.5 });
    near({ hex: 'b10004', flight: 'SKY340', r: 'N340SK', t: 'B738', category: 'A3', altFt: 34000, gs: 460, track: 270, dxKm: 7, dzKm: 12 });
  }
  // A light background sky: one jet climbing out far away, one at cruise.
  add({ hex: 'a7e011', flight: 'SKY88', r: 'N88SK', t: 'B738', category: 'A3', altFt: 9000, gs: 280, track: 250, dxKm: 14, dzKm: 9 });
  add({ hex: 'a7e012', flight: 'SKY912', r: 'N912SK', t: 'B789', category: 'A5', altFt: 36000, gs: 470, track: 70, dxKm: -20, dzKm: 24 });
  return { ac, now: now * 1000, total: ac.length, source: 'Play Pass encounters fixture' };
}

const report = { purpose: 'Unedited game frames for the ENCOUNTERS review. Not a performance benchmark.', label, url, scene: sceneId,
  viewport, flags: args.flags ?? null, capturedAt: new Date().toISOString(), frames: [], errors: [], console: [], steps: [] };
const save = () => fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(report, null, 2));
const step = (s, data) => { report.steps.push({ s, data, at: Date.now() }); console.log(`STEP ${s}${data ? ` ${JSON.stringify(data)}` : ''}`); };

async function telemetry(page, hex) {
  return page.evaluate((hex) => {
    const rt = window.__fly, s = window.__flyStore.getState(), cam = rt.camera, a = rt.origin.anchor;
    const t = hex ? rt.traffic?.tracks?.get(hex) : rt.targeting?.target;
    const proj = (x, y, z) => { const v = cam.position.clone().set(x, y, z).project(cam); return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(4)]; };
    const f = rt.flight;
    const player = proj(f.pos.x - a.x, f.pos.y, f.pos.z - a.z);
    let target = null;
    if (t) {
      const ndc = proj(t.rx - a.x, t.ryd ?? t.ry, t.rz - a.z);
      const dx = t.rx - a.x - cam.position.x, dy = (t.ryd ?? t.ry) - cam.position.y, dz = t.rz - a.z - cam.position.z;
      const camDist = Math.hypot(dx, dy, dz);
      const len = t.fleetType?.spec?.length ?? null;
      const focal = cam.projectionMatrix.elements[5] * innerHeight * 0.5;
      target = { hex: t.hex, ndc, camDistM: Math.round(camDist), distM: Math.round(t.distM), lenM: len,
        px: len ? Math.round((len * focal) / Math.max(1, camDist)) : null, lod: t.fleet?.lod ?? null, living: !!t.livingDetailed,
        opacity: +(t.opacity ?? 0).toFixed(2), horizon: +(t.horizonFade ?? 1).toFixed(2), stale: t.stale, altFt: Math.round(t.ry * 3.28084) };
    }
    const enc = rt.encounters?.controller?.active;
    return { cameraMode: s.cameraMode, lockState: s.lockState, lockedHex: s.lockedHex, ap: rt.autopilot?.mode ?? null,
      sepM: t ? Math.round(Math.hypot((f.pos.x - t.rx) / (1 / Math.cos(t.fix1?.latRad ?? 0.7)), f.pos.y - (t.ryd ?? t.ry), (f.pos.z - t.rz) / (1 / Math.cos(t.fix1?.latRad ?? 0.7)))) : null,
      player, target, playerSpeed: Math.round(f.speed), fov: +cam.fov.toFixed(1), escort: rt.escort ? { ...rt.escort } : null,
      encounter: enc ? { id: enc.id, seconds: enc.seconds ?? 0, hold: +(enc.hold ?? 0).toFixed(1) } : null,
      result: rt.encounters?.controller?.result ?? null,
      card: (() => { const c = document.querySelector('[data-testid="hud-chase-chip"]'); const w = c?.parentElement; return c ? { active: c.dataset.active, letterbox: w?.dataset.letterbox ?? null, bottom: w ? getComputedStyle(w).bottom : null, rect: c.getBoundingClientRect().toJSON(), wrap: w?.getBoundingClientRect().toJSON(), wrapTop: w ? getComputedStyle(w).top : null, wrapH: w ? getComputedStyle(w).height : null, tr: getComputedStyle(c).transform } : null; })() };
  }, hex);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage({ viewport, deviceScaleFactor: isMobile ? 2 : 1, isMobile, hasTouch: isMobile });
  page.on('pageerror', (e) => report.errors.push({ message: e.message.slice(0, 600) }));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && /shader|WebGL|program|ReferenceError|TypeError|GLSL/i.test(text)) report.errors.push({ console: text.slice(0, 1500) });
  });
  await page.addInitScript(({ sun, noSpot }) => {
    if (noSpot) window.__flySpotTracers = false; // dev A/B pin: no traffic trails
    window.__flyGovPin = 'hold';
    window.__flyBoostInfinite = true;
    window.__flySunOverride = sun;
    window.__flyWeatherOverride = 'few';
    try {
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-visuals', 'enhanced');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-crash-mode', 'forgiving');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { sensitivity: 1, invertPitch: false, master: 1, effects: 1, music: 0.65, tutorial: 'done' } }));
    } catch { /* private mode */ }
  }, { sun: solar(PLAYER.lon, hour), noSpot: !!args.noSpot });
  if (!live) {
    await page.route('**/api/aircraft?**', (r) => r.fulfill({ json: syntheticTraffic() }));
    await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
  }
  const flagQuery = args.flags ? `&flags=${encodeURIComponent(args.flags)}` : '';
  try {
    await page.goto(`${url}/?graphicsReview=1${flagQuery}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
    await enterFlight(page, { lat: PLAYER.lat, lon: PLAYER.lon, altM: PLAYER.altM, headingDeg: PLAYER.headingDeg, name: null }, { timeoutMs: 300000, waitReveal: true });
    await page.evaluate(() => { const s = window.__flyStore.getState(); s.setFlightMode?.('free'); s.setPhase?.('flying'); });
    await page.waitForFunction(() => !window.__fly.worldLoading, undefined, { timeout: 240000, polling: 1000 }).catch(() => {});
    report.playPass = await page.evaluate(() => window.__flyPlayPass ?? null);
    // Hold the pose while the world settles so the contact stays ahead.
    await page.evaluate((p) => {
      const f = window.__fly.flight; window.__reviewHold = { y: f.pos.y, h: (p.headingDeg * Math.PI) / 180 };
      window.__reviewStep ??= f.step.bind(f);
      f.step = (dt, cmd) => { window.__reviewStep(dt, { ...cmd, turn: 0, pitch: 0 }); if (window.__reviewHold) { f.pos.y = window.__reviewHold.y; f.heading = window.__reviewHold.h; f.pitch = 0.0; f.bank = 0; } };
      f.speed = f.cfg.speeds.slow;
    }, PLAYER);
    await page.waitForTimeout(9000);
    await page.screenshot({ path: path.join(out, 'start.png') });
    if (args.trails) {
      // Honest trails: every trail on (Spotting), the player frozen facing
      // north, four crossing contacts placed off it, the same elapsed time
      // in both arms.
      const at = await page.evaluate(() => {
        const r = window.__fly, f = r.flight;
        window.__reviewHold.h = 0;
        f.speed = 0;
        f.step = () => { f.heading = 0; f.pitch = 0; f.bank = 0; };
        window.__flyStore.getState().setSpotting(true);
        return { lat: r.geo.y, lon: r.geo.x };
      });
      trailPhase = { at: FEED_EPOCH + (Date.now() - feedT0) / 1000, ...at };
      for (const [i, waitMs] of [[0, 14000], [1, 6000]]) {
        await page.waitForTimeout(waitMs);
        await page.screenshot({ path: path.join(out, `trails-${i}.png`) });
        report.frames.push({ file: `trails-${i}.png`, t: Math.round(FEED_EPOCH + (Date.now() - feedT0) / 1000 - trailPhase.at) });
      }
      return;
    }
    if (args.discovery) {
      // A Nearby discovery end to end: Go, fly at it, frame it in photo mode, shoot.
      const id = typeof args.discovery === 'string' ? args.discovery : 'manhattan-skyline:photo';
      const snap = async (name) => {
        await page.screenshot({ path: path.join(out, `${name}.png`) });
        const st = await page.evaluate(() => { const c = window.__fly.encounters?.controller; return { active: c?.active ? { id: c.active.id, kind: c.active.kind, gate: c.active.gate } : null, result: c?.result ?? null, mode: window.__flyStore.getState().cameraMode, moment: window.__flyEncounterMoment ?? null }; });
        report.frames.push({ file: `${name}.png`, ...st });
        console.log(`FRAME ${name} ${JSON.stringify(st)}`);
      };
      await page.evaluate(() => { window.__reviewHold = { ...window.__reviewHold }; });
      await page.evaluate(() => window.__fly.encounters?.nearby());
      await page.waitForTimeout(1500);
      await snap('discovery-nearby');
      await page.getByTestId(`nearby-contact-${id}`).getByRole('button', { name: 'Go', exact: true }).click();
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.waitForTimeout(1500);
      await snap('discovery-accepted');
      // Hold the aircraft level and pointed at the subject.
      await page.evaluate(() => {
        const r = window.__fly, f = r.flight, w = r.encounters.waypoint(), g = r.geo;
        const dx = (w.lon - g.x) * Math.cos((g.y * Math.PI) / 180), dz = w.lat - g.y;
        window.__reviewHold = { y: f.pos.y, h: Math.atan2(dx, dz) };
        f.step = (dt, cmd) => { window.__reviewStep(dt, { ...cmd, turn: 0, pitch: 0 }); f.pos.y = window.__reviewHold.y; f.heading = window.__reviewHold.h; f.pitch = 0; f.bank = 0; };
        f.speed = f.cfg.speeds.slow;
      });
      await page.waitForTimeout(Number(args.approachMs || 12000));
      await snap('discovery-toward');
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(2500);
      await snap('discovery-photo-mode');
      await page.getByTestId('photo-shutter').click().catch(() => {});
      // The shutter encodes a full-size PNG: wait for it (the button reads "…" while busy).
      await page.waitForFunction(() => !/…/.test(document.querySelector('[data-testid="photo-shutter"]')?.textContent ?? ''), undefined, { timeout: 20000, polling: 250 }).catch(() => {});
      await page.waitForTimeout(1500);
      await snap('discovery-shot');
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(2500);
      await snap('discovery-after');
      return;
    }
    let hex = scene?.hex ?? null;
    if (live) {
      hex = await page.evaluate(() => window.__fly.encounters?.controller?.candidates?.find((c) => c.kind === 'traffic')?.hex ?? null);
      step('live candidate', { hex });
    }
    // Release the hold: from here on the autopilot (or the player) flies.
    await page.evaluate(() => { const f = window.__fly.flight; window.__reviewHold = null; f.step = window.__reviewStep; });
    if (!isMobile) await page.getByTestId('nearby-button').click({ timeout: 20000 });
    else await page.evaluate(() => window.__fly.encounters?.nearby());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, 'nearby.png') });
    report.candidates = await page.evaluate(() => window.__fly.encounters?.controller?.candidates?.map((c) => ({ id: c.id, kind: c.kind, name: c.name, distanceM: Math.round(c.distanceM) })) ?? []);
    step('candidates', report.candidates);
    const cand = report.candidates.find((c) => c.kind === 'traffic' && (!hex || c.id === `live:${hex}`));
    if (!cand) throw new Error('no live candidate in Nearby');
    hex = cand.id.slice(5);
    await page.getByTestId(`nearby-contact-${cand.id}`).getByRole('button', { name: 'Fly alongside', exact: true }).click();
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    step('fly alongside', { hex });
    const t0 = Date.now();
    let n = 0;
    while ((Date.now() - t0) / 1000 < seconds) {
      const tele = await telemetry(page, hex);
      const file = `t${String(n * every).padStart(3, '0')}.png`;
      await page.screenshot({ path: path.join(out, file) });
      report.frames.push({ file, t: Math.round((Date.now() - t0) / 100) / 10, ...tele });
      console.log(`FRAME ${file} card=${JSON.stringify(tele.card && { lb: tele.card.letterbox, b: tele.card.bottom })} ${tele.cameraMode}/${tele.lockState} sep=${tele.sepM} tgt=${JSON.stringify(tele.target?.ndc)} px=${tele.target?.px} lod=${tele.target?.lod} player=${JSON.stringify(tele.player)} enc=${tele.encounter?.seconds ?? '-'} ${tele.result ?? ''}`);
      save();
      n++;
      const wait = t0 + n * every * 1000 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    }
    // Let the memory land (30 s alongside), then a few frames of the payoff.
    await page.waitForFunction(() => !window.__fly.encounters?.controller?.active, undefined, { timeout: 45000, polling: 500 }).catch(() => {});
    for (let i = 0; i < 4; i++) {
      const tele = await telemetry(page, hex);
      const file = `payoff-${i}.png`;
      await page.screenshot({ path: path.join(out, file) });
      report.frames.push({ file, t: Math.round((Date.now() - t0) / 100) / 10, ...tele });
      console.log(`FRAME ${file} ${tele.cameraMode}/${tele.lockState} enc=${tele.encounter?.seconds ?? '-'} ${tele.result ?? ''}`);
      await page.waitForTimeout(1500);
    }
  } catch (e) {
    report.errors.push({ fatal: e.message.split('\n')[0] });
    console.error(e);
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  } finally {
    save();
    await browser.close();
    console.log(`DONE ${label}-${sceneId}: ${report.frames.length} frames, ${report.errors.length} errors -> ${out}`);
  }
})();
