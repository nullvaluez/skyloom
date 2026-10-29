// LOUNGE MOBILE — the TOUCH stream's checks for scripts/verify-lounge-mobile.cjs
// (gestures, walk stick, portrait camera, motion look, haptics). The TOUCH
// stream owns this file. Each phase receives the runner's harness object `h`
// (see the runner's header for its fields) and reports through h.check().
//
// Every gesture is real multi-touch through CDP, aimed at points the check
// first proves are on the look surface (elementFromPoint), so the HUD's own
// layout (the GLASS stream's) never decides a gesture gate. The container
// renders at a fraction of a frame per second under load, so:
//  - every wait is on state (h.until), never on a frame count;
//  - gestures whose TIMING is the point (a tap, a double-tap, a flick, a
//    long-press's lift) go through stamped(): each event carries the time the
//    finger did it (CDP's timestamp) and a gesture's events are sent together,
//    because the surface judges input by the input's own clock and the page
//    here hands events over seconds late (a 60 ms tap would otherwise arrive
//    as a 2 s press). The rest use the runner's h.touch.
//  - the traffic is held still for this phase: the runner's QAL101 lands
//    within two minutes of placement, and this phase outlasts that, so it
//    serves its own slow fixture (QAL101 ahead of the glass, QAL202 overhead)
//    and hands the runner's back when it ends.
// Everything here is functional evidence (layout, gestures, state), never
// feel or frame rate.
//
// PORTRAIT: the naked eye spans the horizontal floor; a tap a fingertip away
// from QAL101 (past the mouse's radius) selects it; a double-tap on it
// raises the binoculars on it; with them up and locked, a double-tap on
// empty glass inside GLASS's real lens lowers them (picked where the old
// naked-eye finger reach still covered the locked aircraft: the integrated
// failure), and so does one on the locked aircraft itself; a quick
// corrective re-tap on the Motion control after a near miss on the glass is
// the control's (motion on, glasses up), not a double-tap; a still
// long-press opens its details (closed again by their own button), no text
// selected; a one-finger drag turns the view the finger's way by the
// finger's angle (the exact grab) and a flick glides on; a pinch out raises
// the binoculars with mag = the gap ratio (a mid-zoom capture), the stick
// hides, a pinch in lowers them; the seated Walk ring, pushed, stands you up
// and walks, further runs (faster, its run state), the other thumb looks at
// the same time, release stops, standing it rests in the zone; standing, a
// pinch with a finger in the thumb zone zooms (zone finger first, glass
// finger first, both in the zone) and never walks, and the stick still
// walks after; motionLook has the contract's shape, enables with the
// binoculars, steers the head 1:1 from synthetic orientation and goes off
// with them; the page never zooms, scrolls or selects text; no flight key
// leaks.
// LANDSCAPE: the field is exactly today's 58 degrees; drag and pinch work.
// TABLET (--device ipad, both orientations): the field (portrait: the touch
// floor; landscape: exactly today's), a drag looks by the finger's angle, a
// pinch raises the binoculars at the gap ratio and pinching back lowers them,
// a tap selects.
//
// The pick radii, the portrait field and the double-tap rule are read from
// the real modules (lib/fly/airport-watch-camera.mjs), not copied.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const DEG = Math.PI / 180;
const AIRCRAFT = '**/api/aircraft?**';
let camModule = null;
const cam = () => (camModule ||= import(pathToFileURL(path.join(__dirname, '../../lib/fly/airport-watch-camera.mjs')).href));

/** Is every CSS px point on the look surface (no HUD element over it)? */
const onSurface = (h, pts) => h.page.evaluate((list) => list.every(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return !!el && el.getAttribute('data-testid') === 'lounge-surface';
}), pts);
/** The first candidate whose every point is on the surface. */
async function clearSpot(h, candidates) {
  for (const c of candidates) if (await onSurface(h, c.points)) return c;
  return null;
}
const hitOf = (h, hex) => h.page.evaluate((x) => {
  const p = window.__fly.loungePicker?.hits.find((q) => q.hex === x && q.onScreen);
  return p ? { x: p.sx, y: p.sy, half: p.half } : null;
}, hex);
const hitsAll = (h) => h.page.evaluate(() => (window.__fly.loungePicker?.hits || []).map((q) => ({ hex: q.hex, x: q.sx, y: q.sy, half: q.half })));
const pageState = (h) => h.page.evaluate(() => ({ scale: window.visualViewport?.scale ?? 1, scrollY: window.scrollY, scrollX: window.scrollX, selection: String(window.getSelection?.() ?? '') }));
const keys = (h) => h.page.evaluate(() => [...(window.__fly.input?.keys ?? [])]);
const field = (h) => h.page.evaluate(() => window.__fly.airportWatch.fieldDeg?.() ?? null);
const stick = (h) => h.page.evaluate(() => {
  const el = document.querySelector('[data-testid="lounge-stick"]');
  const r = el?.getBoundingClientRect();
  return el ? { mode: el.getAttribute('data-mode'), state: el.getAttribute('data-state'), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, zone: !!document.querySelector('[data-testid="lounge-stick-zone"]') } : null;
});

/** The lounge's frame count (the runtime's updateCamera, wrapped once per page). */
const countFrames = (h) => h.page.evaluate(() => {
  const w = window.__fly.airportWatch;
  if (!w.__touchFrames) {
    const update = w.updateCamera;
    w.__touchFrames = { n: 0 };
    w.updateCamera = function counted(...args) {
      w.__touchFrames.n++;
      return update.apply(this, args);
    };
  }
  return w.__touchFrames.n;
});
/** Wait for `n` more lounge frames (a slow box renders a frame every second or two). */
async function frames(h, n, ms = 60000) {
  const f0 = await countFrames(h);
  return h.until(([f, k]) => window.__fly.airportWatch.__touchFrames.n >= f + k, [f0, n], ms);
}
/**
 * Wait until the head and the optics have landed: the optics exactly on their
 * target (easeMag lands on it), the head unchanged across three LOUNGE
 * FRAMES. The lounge's frame loop is budgeted ('demand'), so two rAF polls
 * can read the same values only because no frame ran between them: every
 * sample must follow a new frame, counted from the runtime's own
 * updateCamera (wrapped once per page; FlyScene calls it through the property).
 */
async function settled(h, ms = 60000) {
  await countFrames(h);
  await h.page.evaluate(() => {
    window.__touchSettle = { yaw: NaN, pitch: NaN, frame: window.__fly.airportWatch.__touchFrames.n, n: 0 };
  });
  return h.until(() => {
    const w = window.__fly.airportWatch, s = window.__touchSettle, frame = w.__touchFrames.n;
    if (frame === s.frame) return false; // no frame since the last sample: nothing to judge
    const still = w.optics.mag === w.optics.target && Math.abs(w.yaw - s.yaw) < 2e-5 && Math.abs(w.pitch - s.pitch) < 2e-5;
    s.yaw = w.yaw; s.pitch = w.pitch; s.frame = frame;
    s.n = still ? s.n + 1 : 0;
    return s.n >= 3;
  }, undefined, ms);
}
/**
 * Wait for the binoculars to hold their lock: up, tracking, inside the
 * runtime's lock tolerance (the director may keep reframing the power, so the
 * optics are not required to have landed).
 */
function lockHeld(h, ms = 60000) {
  return h.until(() => {
    const w = window.__fly.airportWatch;
    const tol = w.lockTolerance ? w.lockTolerance() : (window.__fly.camera.fov * Math.PI) / 180 / 8;
    return w.binocular && w.tracking && w.lockError() < tol;
  }, undefined, ms);
}
/** GLASS's binocular figure as the mask drew it ({ mode, R, lenses: [[x, y]] }), or null. */
const maskFigure = (h) => h.page.evaluate(() => {
  const c = document.querySelector('[data-testid="binocular-mask"]');
  return c?.dataset.figure ? JSON.parse(c.dataset.figure) : null;
});
/** Back to a known pose: naked eye, nothing selected or open, facing the view. */
async function calm(h) {
  await h.page.evaluate(() => {
    const w = window.__fly.airportWatch;
    window.__flyStore.getState().setInspectHex(null);
    if (w.director?.auto) w.director.handBack?.();
    if (w.binocular) w.binoculars(false);
    w.clearSelection();
    w.resetLook();
  });
  await settled(h);
}

/**
 * Timestamped touches (see the header): each event carries when the finger
 * did it, and a gesture's events go out together. `events` is
 * [[ms, 'touchStart' | 'touchMove' | 'touchEnd', points]] with points
 * [{ x, y, id }] (all the fingers still down, as CDP expects).
 */
function stamped(h) {
  const points = (list) => list.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 6, radiusY: 6, force: 1 }));
  const run = (events) => {
    const t0 = Date.now() / 1000;
    return Promise.all(events.map(([ms, type, list]) => h.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points(list), timestamp: t0 + ms / 1000 })));
  };
  return {
    run,
    tap: (x, y) => run([[0, 'touchStart', [{ x, y }]], [60, 'touchEnd', []]]),
    doubleTap: (x, y, gap = 140) => run([[0, 'touchStart', [{ x, y }]], [50, 'touchEnd', []], [50 + gap, 'touchStart', [{ x, y }]], [100 + gap, 'touchEnd', []]]),
    /** A flick: `steps` moves over `ms`, lifted with the finger still moving. */
    flick: (x0, y0, x1, y1, ms = 180, steps = 9) => {
      const ev = [[0, 'touchStart', [{ x: x0, y: y0 }]]];
      for (let i = 1; i <= steps; i++) ev.push([(ms * i) / steps, 'touchMove', [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }]]);
      ev.push([ms + 4, 'touchEnd', []]);
      return run(ev);
    },
    down: (x, y) => run([[0, 'touchStart', [{ x, y }]]]),
    up: () => run([[0, 'touchEnd', []]]),
  };
}

/**
 * This phase's own traffic (see the header): QAL101 crossing slowly 7 km out
 * ahead of the glass, 380 m up; QAL202 overhead. Returns the restore.
 */
async function holdTraffic(h) {
  const contacts = await h.page.evaluate(() => {
    const r = window.__fly, w = r.airportWatch, k = w.frame.k, e = w.eyeWorld();
    const facing = ((-w.roomHeading * 180) / Math.PI + 360) % 360;
    const geoAt = (a, range) => r.engine.worldToGeo({ x: e.x - Math.sin(a) * range * k, y: 0, z: e.z - Math.cos(a) * range * k });
    const mk = (hex, flight, reg, type, a, range, upM, track, gsMps) => {
      const g = geoAt(a, range), tr = (track * Math.PI) / 180;
      return { hex, flight, r: reg, t: type, category: 'A3', lat: g.y, lon: g.x, dLat: (gsMps * Math.cos(tr)) / 111320, dLon: (gsMps * Math.sin(tr)) / (111320 * Math.cos((g.y * Math.PI) / 180)), altFt: (e.y + upM) * 3.28084, gsKt: Math.max(60, gsMps * 1.943844), track };
    };
    return [
      mk('a1b2c3', 'QAL101', 'NB2C3', 'A320', w.roomHeading + 0.12, 7000, 380, (facing + 90) % 360, 3),
      mk('d4e5f6', 'QAL202', 'ND5F6', 'B738', w.roomHeading - 0.35, 5200, 900, (facing + 90) % 360, 3),
    ];
  });
  const t0 = Date.now();
  const handler = (route) => {
    const dt = (Date.now() - t0) / 1000;
    route.fulfill({ json: { ac: contacts.map((c) => ({ hex: c.hex, flight: c.flight, r: c.r, t: c.t, category: c.category, type: 'adsb_icao', lat: c.lat + c.dLat * dt, lon: c.lon + c.dLon * dt, alt_baro: Math.round(c.altFt), alt_geom: Math.round(c.altFt), gs: c.gsKt, track: c.track, baro_rate: 0, seen: 0, seen_pos: 0 })), now: Date.now(), source: 'QA lounge touch fixture' } });
  };
  await h.page.route(AIRCRAFT, handler);
  return () => h.page.unroute(AIRCRAFT, handler);
}
/**
 * Wait for QAL101 on screen and holding still across two lounge frames (the
 * held traffic has landed in the feed and the head has stopped).
 */
async function aircraftReady(h) {
  const deadline = Date.now() + 150000;
  let last = null;
  while (Date.now() < deadline) {
    await h.until(() => window.__fly.loungePicker?.hits.some((q) => q.hex === 'a1b2c3' && q.onScreen), undefined, 15000);
    const a = await hitOf(h, 'a1b2c3');
    if (a && last && Math.hypot(a.x - last.x, a.y - last.y) < 3) return a;
    last = a;
    await h.wait(400);
    await frames(h, 2, 20000);
  }
  return null;
}

/**
 * Empty glass inside GLASS's binocular lens (the mask's own figure): on the
 * look surface and clear of every aircraft's binocular touch reach
 * (touchPickRadius(mag, true) + its half-span, plus a margin). With
 * `preferNear`, a point that the naked-eye finger's reach (touchPickRadius
 * (mag) + half) of that aircraft still covered comes first.
 */
async function emptyGlass(h, { preferNear = null } = {}) {
  const c = await cam();
  const fig = await maskFigure(h);
  if (!fig) return null;
  const hits = await hitsAll(h);
  const mag = (await h.state()).mag;
  const near = [], far = [];
  for (const [lx, ly] of fig.lenses) {
    for (const f of [0.55, 0.7, 0.4, 0.8]) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const q = [Math.round(lx + Math.cos(a) * fig.R * f), Math.round(ly + Math.sin(a) * fig.R * f)];
        if (hits.some((t) => Math.hypot(t.x - q[0], t.y - q[1]) <= c.touchPickRadius(mag, true) + t.half + 10)) continue;
        const target = preferNear && hits.find((t) => t.hex === preferNear);
        (target && Math.hypot(target.x - q[0], target.y - q[1]) <= c.touchPickRadius(mag) + target.half ? near : far).push(q);
      }
    }
  }
  for (const q of [...near, ...far]) {
    if (await onSurface(h, [q])) return { at: q, withinOldReach: near.includes(q), lens: fig, mag: +mag.toFixed(2) };
  }
  return null;
}
/**
 * A near miss beside a control (by test id): a point on the glass just
 * outside its round (31-34 px from its centre, inside the double-tap's
 * doublePx), and the control's centre.
 */
async function nearMiss(h, testid) {
  const r = await h.page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    const b = el?.getBoundingClientRect();
    return b && b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2 } : null;
  }, testid);
  if (!r) return null;
  for (const d of [r.r + 3, r.r + 4, r.r + 5]) {
    if (d > 34) break;
    for (let k = 0; k < 16; k++) {
      const a = -Math.PI / 2 + (k / 16) * Math.PI * 2;
      const q = [Math.round(r.x + Math.cos(a) * d), Math.round(r.y + Math.sin(a) * d)];
      if (Math.hypot(q[0] - r.x, q[1] - r.y) > 34) continue;
      if (await onSurface(h, [q])) return { glass: q, control: [Math.round(r.x), Math.round(r.y)], gapPx: +Math.hypot(q[0] - r.x, q[1] - r.y).toFixed(1) };
    }
  }
  return null;
}
/**
 * Standing: a pinch with a finger in the walk stick's thumb zone zooms (the
 * zone relays it to the glass) and never walks. Three ways a pinch lands:
 * the zone finger first, the glass finger first, both in the zone. Then the
 * stick still walks (nothing left relaying).
 */
async function zonePinches(h, W, H) {
  const zoneRect = () => h.page.evaluate(() => {
    const b = document.querySelector('[data-testid="lounge-stick-zone"]')?.getBoundingClientRect();
    return b && b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null;
  });
  const calmUp = async () => {
    await h.page.evaluate(() => { const w = window.__fly.airportWatch; if (w.binocular) w.binoculars(false); w.clearSelection(); });
    await settled(h);
    await h.until(() => !!document.querySelector('[data-testid="lounge-stick-zone"]') && !document.querySelector('.lounge-stick-zone[data-relay]'), undefined, 15000);
  };
  const variants = [
    { name: 'the zone finger first', fingers: (z, y) => [{ x: z.r - 70, y, dx: -40 }, { x: z.r + 40, y, dx: 80, glass: true }] },
    { name: 'the glass finger first', fingers: (z, y) => [{ x: z.r + 40, y, dx: 80, glass: true }, { x: z.r - 70, y, dx: -40 }] },
    { name: 'both in the zone', fingers: (z, y) => [{ x: z.l + 40, y, dx: -20 }, { x: z.l + 40 + 100, y, dx: 90 }] },
  ];
  for (const v of variants) {
    await calmUp();
    const z = await zoneRect();
    let fingers = null;
    if (z) {
      for (const fy of [0.55, 0.4, 0.7]) {
        const y = Math.round(z.t + (z.b - z.t) * fy);
        const f = v.fingers(z, y).map((p) => ({ ...p, x: Math.round(p.x) }));
        const ok = await h.page.evaluate((list) => list.every((p) => {
          const el = document.elementFromPoint(p.x, p.y);
          return p.glass ? el?.getAttribute('data-testid') === 'lounge-surface' : !!el?.closest('[data-testid="lounge-stick-zone"]');
        }), f);
        if (ok) { fingers = f; break; }
      }
    }
    const eye0 = (await h.state()).eye;
    let ratio = null;
    if (fingers) {
      const at = (i) => fingers.map((p, id) => ({ x: p.x + (p.dx * i) / 10, y: p.y, id }));
      const gap = (i) => Math.abs(at(i)[0].x - at(i)[1].x);
      ratio = gap(10) / gap(0);
      await h.touch.send('touchStart', at(0));
      for (let i = 1; i <= 10; i++) { await h.wait(40); await h.touch.send('touchMove', at(i)); }
      await h.wait(200);
      await h.touch.send('touchEnd', []);
      await h.until(() => window.__fly.airportWatch.binocular, undefined, 15000);
      await settled(h);
    }
    const s = await h.state();
    const walked = eye0 && s.eye ? Math.hypot(s.eye.x - eye0.x, s.eye.z - eye0.z) : null;
    h.check(`stick: standing, a pinch with a finger in the thumb zone zooms and never walks (${v.name})`, !!fingers && s.binocular && Math.abs(s.target - ratio) < 0.1 && walked != null && walked < 0.05,
      { fingers: fingers && fingers.map((p) => [p.x, p.y]), ratio: ratio && +ratio.toFixed(3), target: +s.target.toFixed(3), binocular: s.binocular, walkedM: walked != null ? +walked.toFixed(3) : null });
    if (v === variants[0]) await h.shot('zone-pinch');
  }
  // Nothing left relaying: the stick walks again.
  await calmUp();
  const z = await zoneRect();
  let speed = 0;
  if (z) {
    const x = Math.round(z.l + (z.r - z.l) * 0.45), y = Math.round(z.t + (z.b - z.t) * 0.6);
    const eye0 = (await h.state()).eye;
    await h.touch.send('touchStart', [{ x, y, id: 0 }]);
    for (let i = 1; i <= 6; i++) { await h.wait(30); await h.touch.send('touchMove', [{ x, y: y - (30 * i) / 6, id: 0 }]); }
    await h.until(() => (window.__fly.airportWatch.walk?.speed ?? 0) > 0.2, undefined, 20000);
    await h.wait(1200);
    speed = await h.page.evaluate(() => window.__fly.airportWatch.walk?.speed ?? 0);
    await h.touch.send('touchEnd', []);
    await h.until(() => (window.__fly.airportWatch.walk?.speed ?? 1) < 0.02, undefined, 20000);
    const eye1 = (await h.state()).eye;
    h.check('stick: after the pinches the thumb zone walks again (nothing left relaying)', speed > 0.2 && Math.hypot(eye1.x - eye0.x, eye1.z - eye0.z) > 0.1, { speed: +speed.toFixed(2) });
  } else h.check('stick: after the pinches the thumb zone walks again (nothing left relaying)', false, { zone: null });
}

module.exports = {
  name: 'touch',

  async portrait(h) {
    const { width: W, height: H } = h.viewport;
    const touch = stamped(h);
    const guard = { samples: 0, bad: [], selected: [] };
    const leaked = [];
    const sample = async (label) => {
      const p = await pageState(h);
      guard.samples++;
      if (p.scale !== 1 || p.scrollY !== 0 || p.scrollX !== 0) guard.bad.push({ label, ...p });
      if (p.selection) guard.selected.push({ label, selection: p.selection.slice(0, 40) });
      const k = await keys(h);
      if (k.length) leaked.push({ label, keys: k });
    };
    const restoreTraffic = await holdTraffic(h);
    try {
      await calm(h);

      // --- the portrait field ---------------------------------------------------------
      const s0 = await h.state();
      const f0 = await field(h);
      const across = (2 * Math.atan(Math.tan((s0.fov * DEG) / 2) * s0.aspect)) / DEG;
      // MOBILE_TOUCH.portrait: 50 deg across, the vertical capped at 86 deg
      // (a 390 x 844 screen reaches the cap and keeps ~46.6 deg across).
      const need = (2 * Math.atan(Math.tan(25 * DEG) / s0.aspect)) / DEG, naked = Math.min(86, Math.max(58, need));
      const floor = Math.min(50, (2 * Math.atan(Math.tan(43 * DEG) * s0.aspect)) / DEG);
      h.check('portrait: the naked eye spans the horizontal floor (50 deg across, vertical capped at 86), not the 58 deg vertical slit', s0.fov > 58 && Math.abs(s0.fov - naked) < 1e-6 && across >= floor - 1e-6 && Math.abs(f0?.h - across) < 1e-6,
        { fov: +s0.fov.toFixed(3), aspect: +s0.aspect.toFixed(4), horizontal: +across.toFixed(3), slitWas: +((2 * Math.atan(Math.tan(29 * DEG) * s0.aspect)) / DEG).toFixed(2) });
      await h.shot('field');

      // --- tap: a fingertip's pick radius --------------------------------------------
      let a = await aircraftReady(h);
      {
        // Between the mouse's reach at 1x (26 px + the half-span) and a
        // fingertip's (MOBILE_TOUCH.pick: 33.8 px + the half-span).
        let at = null;
        if (a) for (const ang of [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4]) {
          const p = [Math.round(a.x + Math.cos(ang) * (30 + a.half)), Math.round(a.y + Math.sin(ang) * (30 + a.half))];
          const d = Math.hypot(p[0] - a.x, p[1] - a.y);
          if (d > 26 + a.half && d < 33.8 + a.half && (await onSurface(h, [p]))) { at = p; break; }
        }
        if (at) {
          await touch.tap(at[0], at[1]);
          await h.until(() => window.__fly.airportWatch.selected === 'a1b2c3', undefined, 20000);
        }
        const s = await h.state();
        h.check('portrait: a tap a fingertip away from QAL101 (past the mouse\'s pick radius) selects it', s.selected === 'a1b2c3' && !s.binocular, { hit: a && { x: Math.round(a.x), y: Math.round(a.y), half: Math.round(a.half) }, tappedAt: at, selected: s.selected });
        await sample('tap');
      }

      // --- double-tap: binoculars on the aircraft; on empty glass, down -------------------
      await calm(h);
      a = await aircraftReady(h);
      {
        const p = a && [Math.round(a.x), Math.round(a.y)];
        if (p && (await onSurface(h, [p]))) {
          await touch.doubleTap(p[0], p[1]);
          await h.until(() => { const w = window.__fly.airportWatch; return w.binocular && w.selected === 'a1b2c3'; }, undefined, 20000);
        }
        const s = await h.state();
        h.check('portrait: a double-tap on QAL101 raises the binoculars on it (selected and followed)', s.binocular && s.selected === 'a1b2c3' && s.tracking, { at: p, binocular: s.binocular, selected: s.selected, tracking: s.tracking, mag: +s.mag.toFixed(2) });
        // (The checks below test their own gestures: if that raise failed, set it up directly.)
        if (!s.binocular || s.selected !== 'a1b2c3') await h.page.evaluate(() => window.__fly.airportWatch.select('a1b2c3', { binoculars: true }));
        // The capture once the glasses hold the lock (the runtime's lock tolerance).
        const locked = await lockHeld(h);
        h.info('portrait: the binoculars settle on QAL101 (inside the lock tolerance)', { locked });
        await h.shot('binoculars-on-aircraft');
        // Empty glass inside GLASS's real lens, picked where the naked-eye
        // finger's reach (MOBILE_TOUCH.pick.maxPx + the half-span: the
        // integrated failure) still covered the locked aircraft, but clear of
        // the binocular reach of every aircraft.
        const empty = await emptyGlass(h, { preferNear: 'a1b2c3' });
        const up = (await h.state()).binocular;
        if (empty && up) {
          await touch.doubleTap(empty.at[0], empty.at[1]);
          await h.until(() => !window.__fly.airportWatch.binocular, undefined, 20000);
        }
        const e = await h.state();
        h.check('portrait: a double-tap on empty glass with the binoculars up lowers them (the selection stays) — inside GLASS\'s lens, within the old finger reach of the locked aircraft', !!empty?.withinOldReach && up && !e.binocular && e.selected === 'a1b2c3', { ...empty, upBefore: up, binocular: e.binocular, selected: e.selected });
        await sample('double-tap');

        // Up again on it (set up directly: with the glasses down a phone's
        // spotter sheet covers the screen centre where the follow holds it).
        // Then a near miss on the glass by the Motion control and a quick
        // corrective re-tap ON the control (within doubleMs / doublePx) is
        // the control's tap, not a double-tap: the glasses stay up and
        // motion look turns on.
        await h.page.evaluate(() => window.__fly.airportWatch.select('a1b2c3', { binoculars: true }));
        const relocked = await lockHeld(h);
        h.info('portrait: binoculars up on QAL101 again (set up directly)', { relocked });
        const miss = await nearMiss(h, 'binocular-motion');
        if (miss) {
          await touch.run([[0, 'touchStart', [{ x: miss.glass[0], y: miss.glass[1] }]], [50, 'touchEnd', []], [170, 'touchStart', [{ x: miss.control[0], y: miss.control[1] }]], [220, 'touchEnd', []]]);
          await h.until(() => window.__fly.airportWatch.motionLook?.active, undefined, 15000);
          await h.wait(800);
        }
        const m = await h.page.evaluate(() => ({ binocular: window.__fly.airportWatch.binocular, motion: !!window.__fly.airportWatch.motionLook?.active }));
        h.check('portrait: a quick corrective re-tap on a binocular control after a near miss on the glass is the control\'s (motion look on, the glasses stay up), not a double-tap', !!miss && m.binocular && m.motion, { ...miss, ...m });
        await h.page.evaluate(() => window.__fly.airportWatch.motionLook?.disable?.());

        // A double-tap on the locked aircraft itself lowers them too (the gesture table).
        // (Motion look took the head from the lock: lock on again first.)
        await h.page.evaluate(() => { const w = window.__fly.airportWatch; if (!w.binocular || !w.tracking) w.select('a1b2c3', { binoculars: true }); });
        const held = await lockHeld(h);
        const b = await hitOf(h, 'a1b2c3');
        const pre = await h.state();
        const onIt = !!b && (await onSurface(h, [[Math.round(b.x), Math.round(b.y)]]));
        if (onIt && pre.binocular) {
          await touch.doubleTap(Math.round(b.x), Math.round(b.y));
          await h.until(() => !window.__fly.airportWatch.binocular, undefined, 20000);
        }
        const d = await h.state();
        h.check('portrait: a double-tap on the aircraft the binoculars hold lowers them (the selection stays)', onIt && pre.binocular && pre.tracking && !d.binocular && d.selected === 'a1b2c3', { at: b && [Math.round(b.x), Math.round(b.y)], held, before: { binocular: pre.binocular, tracking: pre.tracking }, binocular: d.binocular, selected: d.selected });
        await sample('double-tap-locked');
      }

      // --- long-press: the details ---------------------------------------------------------
      await calm(h);
      a = await aircraftReady(h);
      {
        const p = a && [Math.round(a.x + 6), Math.round(a.y + 4)];
        let opened = false;
        if (p && (await onSurface(h, [p]))) {
          await touch.down(p[0], p[1]);
          opened = await h.until(() => window.__flyStore.getState().inspectHex === 'a1b2c3', undefined, 20000);
          await touch.up();
        }
        await h.wait(600);
        const s = await h.state();
        const sel = await pageState(h);
        h.check('portrait: a still long-press on QAL101 opens its details (inspectHex) and selects it, with no text selected', opened && s.inspect === 'a1b2c3' && s.selected === 'a1b2c3' && !sel.selection, { at: p, inspect: s.inspect, selected: s.selected, selection: sel.selection });
        await h.shot('long-press-details');
        const close = await h.page.evaluate(() => {
          const r = [...document.querySelectorAll('button[aria-label="Close aircraft details"]')].map((el) => el.getBoundingClientRect()).find((b) => b.width > 0 && b.height > 0 && b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth);
          return r ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null;
        });
        if (close) await touch.tap(close[0], close[1]);
        const closed = await h.until(() => !window.__flyStore.getState().inspectHex, undefined, 15000);
        h.check('portrait: the details close again (their own close button, by touch)', !!close && closed, { close });
        await sample('long-press');
      }

      // --- one-finger drag: the exact grab; a flick glides --------------------------------
      await calm(h);
      {
        const rows = [0.6, 0.66, 0.54, 0.72, 0.48].map((fy) => ({ y: Math.round(H * fy), points: [[Math.round(W * 0.28), Math.round(H * fy)], [Math.round(W * 0.72), Math.round(H * fy)]] }));
        const spot = await clearSpot(h, rows);
        const y = spot?.y ?? Math.round(H * 0.6), x0 = Math.round(W * 0.3), x1 = Math.round(W * 0.7);
        const before = await h.state();
        // Paced like a finger (each move awaits the page): when this box's
        // frames are slower than a long-press (under 2 fps), the moves wait
        // for the next frame after the long-press timer has come due. The
        // press is judged at that frame (createHoldTimer), so it stays a drag.
        await h.touch.drag(x0, y, x1, y, { steps: 12, ms: 360, release: false });
        await settled(h);
        const held = await h.state();
        await h.wait(400);
        await touch.up(); // lifted after a pause: no glide
        await settled(h);
        const after = await h.state();
        const tanH = Math.tan((before.fov * DEG) / 2) * before.aspect;
        const u0 = (x0 / W) * 2 - 1, u1 = (x1 / W) * 2 - 1;
        const finger = (Math.atan(u1 * tanH) - Math.atan(u0 * tanH)) / DEG;
        const turned = (held.yaw - before.yaw) / DEG;
        h.check('portrait: a one-finger drag turns the view the finger\'s way by the finger\'s angle (the world stays under it)', !!spot && turned > 0 && Math.abs(turned / finger - 1) < 0.12 && Math.abs(after.yaw - held.yaw) < 0.2 * DEG,
          { turnedDeg: +turned.toFixed(2), fingerAngleDeg: +finger.toFixed(2), afterPausedLiftDeg: +((after.yaw - held.yaw) / DEG).toFixed(3), y });
        const b2 = await h.state();
        await touch.flick(x1, y, x0, y, 160, 8);
        await settled(h);
        const a2 = await h.state();
        const flick = (b2.yaw - a2.yaw) / DEG;
        h.check('portrait: a flick glides on after the finger lifts (further than the finger\'s angle)', flick > finger * 1.15, { turnedDeg: +flick.toFixed(2), fingerAngleDeg: +finger.toFixed(2) });
        await sample('drag');
      }

      // --- pinch: binoculars up with mag = the gap ratio, then down ------------------------
      await calm(h);
      {
        const cands = [0.62, 0.55, 0.68, 0.48].map((fy) => {
          const cx = Math.round(W / 2), cy = Math.round(H * fy);
          return { cx, cy, points: [[cx - 30, cy], [cx + 30, cy], [cx - 100, cy], [cx + 100, cy]] };
        });
        const spot = await clearSpot(h, cands);
        const c = spot ?? cands[0], from = 60, to = 180;
        const at = (gap) => [{ x: c.cx - gap / 2, y: c.cy, id: 0 }, { x: c.cx + gap / 2, y: c.cy, id: 1 }];
        // By hand, so the mid-zoom frame is captured with both fingers down.
        await h.touch.send('touchStart', at(from));
        for (let i = 1; i <= 8; i++) { await h.wait(30); await h.touch.send('touchMove', at(from + ((to - from) * i) / 14)); }
        const mid = await h.until(() => window.__fly.airportWatch.optics.mag > 1.6, undefined, 20000);
        await h.shot('pinch-mid-zoom');
        const midState = await h.state();
        for (let i = 9; i <= 14; i++) { await h.wait(30); await h.touch.send('touchMove', at(from + ((to - from) * i) / 14)); }
        await h.touch.send('touchEnd', []);
        await settled(h);
        const r = await h.state();
        h.check('portrait: a pinch out raises the binoculars and the magnification tracks the finger gap (60 -> 180 px = 3x)', !!spot && mid && r.binocular && Math.abs(r.target - to / from) < 0.08 && Math.abs(r.mag - r.target) < 0.05,
          { midZoomMag: +midState.mag.toFixed(2), mag: +r.mag.toFixed(3), target: +r.target.toFixed(3), binocular: r.binocular, centre: [c.cx, c.cy] });
        h.check('portrait: the walk stick hides while the binoculars are up', !(await stick(h)));
        await h.shot('pinched');
        // Pinch in where the binocular HUD leaves the glass free: vertical pinches across the view.
        const ins = [0.3, 0.38, 0.22, 0.5, 0.62].map((fx) => {
          const cx = Math.round(W * fx), cy = Math.round(H * 0.56);
          return { cx, cy, points: [[cx, cy - 110], [cx, cy + 110]] };
        });
        const pin = await clearSpot(h, ins);
        if (pin) await h.touch.pinch(pin.cx, pin.cy, 220, 40, { steps: 12, ms: 420, angle: Math.PI / 2 });
        await settled(h);
        const q = await h.state();
        h.check('portrait: a pinch in lowers the binoculars (the wheel\'s semantics)', !!pin && !q.binocular && q.target < 1.5, { mag: +q.mag.toFixed(3), target: +q.target.toFixed(3), binocular: q.binocular, centre: pin && [pin.cx, pin.cy] });
        await sample('pinch');
      }

      // --- the walk stick -----------------------------------------------------------------------
      await calm(h);
      {
        const ring = await stick(h);
        h.check('stick: seated, a small Walk ring waits in the lower-left thumb zone (a 44 px+ target, above the dock line)', !!ring && ring.mode === 'seated' && ring.w >= 44 && ring.x < W / 2 && ring.y > H / 2, ring);
        await h.shot('stick-seated');
        if (ring?.mode === 'seated') {
          const eye0 = (await h.state()).eye;
          // Push the ring down the screen (back into the room, away from the glass): a walk at half throw.
          const cx = Math.round(ring.x), cy = Math.round(ring.y);
          await h.touch.send('touchStart', [{ x: cx, y: cy, id: 0 }]);
          for (let i = 1; i <= 6; i++) { await h.wait(30); await h.touch.send('touchMove', [{ x: cx + (4 * i) / 6, y: cy + (26 * i) / 6, id: 0 }]); }
          const stood = await h.until(() => window.__fly.airportWatch.posture === 'standing', undefined, 30000);
          const walking = await h.until(() => (window.__fly.airportWatch.walk?.speed ?? 0) > 0.2, undefined, 30000);
          await h.wait(1500);
          const w1 = await h.page.evaluate(() => ({ speed: window.__fly.airportWatch.walk.speed, state: document.querySelector('[data-testid="lounge-stick"]')?.getAttribute('data-state') }));
          await h.shot('stick-walking');
          // The other thumb looks around at the same time (two touches, two elements).
          const look = [Math.round(W * 0.55), Math.round(H * 0.45)];
          const lookFree = await onSurface(h, [look, [look[0] + 90, look[1]]]);
          const y0 = (await h.state()).yaw;
          await h.touch.send('touchStart', [{ x: cx + 4, y: cy + 26, id: 0 }, { x: look[0], y: look[1], id: 1 }]);
          for (let i = 1; i <= 8; i++) { await h.wait(40); await h.touch.send('touchMove', [{ x: cx + 4, y: cy + 26, id: 0 }, { x: look[0] + (90 * i) / 8, y: look[1], id: 1 }]); }
          await h.until((y) => window.__fly.airportWatch.yaw - y > 0.035, y0, 30000);
          const y1 = (await h.state()).yaw;
          const stillWalking = await h.page.evaluate(() => window.__fly.airportWatch.walk.speed > 0.2);
          // Push further, the look finger still resting (CDP lifts fingers only all together): past the run threshold.
          const rest = { x: look[0] + 90, y: look[1], id: 1 };
          for (let i = 1; i <= 4; i++) { await h.wait(30); await h.touch.send('touchMove', [{ x: cx + 6, y: cy + 26 + (40 * i) / 4, id: 0 }, rest]); }
          await h.until(() => document.querySelector('[data-testid="lounge-stick"]')?.getAttribute('data-state') === 'run', undefined, 15000);
          await h.wait(1500);
          const w2 = await h.page.evaluate(() => ({ speed: window.__fly.airportWatch.walk.speed, state: document.querySelector('[data-testid="lounge-stick"]')?.getAttribute('data-state') }));
          await h.shot('stick-running');
          const eye1 = (await h.state()).eye;
          await h.touch.send('touchEnd', []);
          const stopped = await h.until(() => (window.__fly.airportWatch.walk?.speed ?? 1) < 0.02, undefined, 20000);
          const moved = Math.hypot(eye1.x - eye0.x, eye1.z - eye0.z);
          h.check('stick: pushing the seated Walk ring stands you up and walks (the eye moves)', stood && walking && moved > 0.3 && w1.state === 'active', { stood, walking, movedM: +moved.toFixed(2), walkSpeed: +w1.speed.toFixed(2), state: w1.state });
          h.check('stick: past the run threshold it runs: faster, and the stick shows its run state', w2.state === 'run' && w2.speed > w1.speed * 1.3, { walk: +w1.speed.toFixed(2), run: +w2.speed.toFixed(2), state: w2.state });
          h.check('stick: the other thumb drags to look while the stick walks (multi-touch)', lookFree && y1 - y0 > 2 * DEG && stillWalking, { turnedDeg: +((y1 - y0) / DEG).toFixed(2), stillWalking, lookFree });
          h.check('stick: release stops the walk', stopped);
          const standing = await stick(h);
          h.check('stick: standing, it rests in the thumb zone, and a thumb anywhere in the zone starts it', standing?.mode === 'standing' && standing.state === 'rest' && standing.zone, standing);
          await sample('stick');
          if (standing?.mode === 'standing') await zonePinches(h, W, H);
        }
      }
      await h.page.evaluate(() => window.__fly.airportWatch.sit?.('window', { instant: true }));
      await calm(h);

      // --- motion look (contract 3) -----------------------------------------------------------
      {
        const shape = await h.page.evaluate(() => {
          const m = window.__fly.airportWatch.motionLook;
          return { hasEvent: typeof window.DeviceOrientationEvent === 'function', m: m && { supported: m.supported, active: m.active, needsPermission: m.needsPermission, enable: typeof m.enable, disable: typeof m.disable } };
        });
        const shaped = !!shape.m && typeof shape.m.supported === 'boolean' && typeof shape.m.active === 'boolean' && typeof shape.m.needsPermission === 'boolean' && shape.m.enable === 'function' && shape.m.disable === 'function';
        h.check('motion look: watch.motionLook has the contract\'s shape where DeviceOrientationEvent exists', shape.hasEvent && shaped, shape);
        if (shape.m?.supported) {
          const r = await h.page.evaluate(async () => {
            const w = window.__fly.airportWatch, m = w.motionLook;
            const before = await m.enable();
            w.binoculars(true, { acquire: false });
            const on = await m.enable();
            return { refusedWithoutGlasses: before === false, on, active: m.active };
          });
          const fire = (alpha, beta, gamma) => h.page.evaluate(([al, be, ga]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: al, beta: be, gamma: ga })), [alpha, beta, gamma]);
          await fire(30, 88, 0); // the first pose is the zero
          await h.wait(300);
          await settled(h);
          const m0 = await h.state();
          for (let i = 0; i < 12; i++) { await fire(34, 90, 0); await h.wait(60); } // left 4 deg, up 2
          await settled(h);
          const m1 = await h.state();
          const dyaw = (m1.yaw - m0.yaw) / DEG, dpitch = (m1.pitch - m0.pitch) / DEG;
          h.check('motion look: enable() works with the binoculars up, and the phone steers the head 1:1 (left 4 deg, up 2 deg, less the deadband)', r.refusedWithoutGlasses && r.on && r.active && Math.abs(dyaw - 4) < 0.5 && Math.abs(dpitch - 2) < 0.5, { ...r, dyawDeg: +dyaw.toFixed(2), dpitchDeg: +dpitch.toFixed(2) });
          await h.page.evaluate(() => window.__fly.airportWatch.binoculars(false));
          const off = await h.until(() => !window.__fly.airportWatch.motionLook.active, undefined, 15000);
          h.check('motion look: lowering the binoculars switches it off', off);
        }
      }

      // --- page integrity -------------------------------------------------------------------------
      await calm(h);
      await sample('end');
      h.check('portrait: the page never zoomed or scrolled (visualViewport.scale 1, scroll 0) and no text was selected', guard.bad.length === 0 && guard.selected.length === 0 && guard.samples >= 6, { samples: guard.samples, bad: guard.bad, selected: guard.selected });
      h.check('portrait: no flight input key leaked (runtime.input.keys empty after every gesture)', leaked.length === 0, leaked);
    } finally {
      await restoreTraffic();
    }
  },

  async landscape(h) {
    const { width: W, height: H } = h.viewport;
    await calm(h);
    const s0 = await h.state();
    h.check('landscape: the naked-eye field is exactly today\'s (58 deg vertical, desktop-identical)', s0.fov === 58, { fov: s0.fov, aspect: +s0.aspect.toFixed(3) });
    const rows = [0.5, 0.58, 0.42, 0.66].map((fy) => ({ y: Math.round(H * fy), points: [[Math.round(W * 0.38), Math.round(H * fy)], [Math.round(W * 0.62), Math.round(H * fy)]] }));
    const spot = await clearSpot(h, rows);
    const y = spot?.y ?? Math.round(H * 0.5);
    await h.touch.drag(Math.round(W * 0.4), y, Math.round(W * 0.6), y, { steps: 10, ms: 300, release: false });
    await settled(h);
    const s1 = await h.state();
    await h.touch.send('touchEnd', []);
    const tanH = Math.tan((58 * DEG) / 2) * s0.aspect;
    const finger = (Math.atan(0.2 * tanH) - Math.atan(-0.2 * tanH)) / DEG;
    const turned = (s1.yaw - s0.yaw) / DEG;
    h.check('landscape: a one-finger drag turns the view by the finger\'s angle', !!spot && Math.abs(turned / finger - 1) < 0.12, { turnedDeg: +turned.toFixed(2), fingerAngleDeg: +finger.toFixed(2) });
    await calm(h);
    const cands = [0.5, 0.42, 0.6, 0.35].map((fx) => {
      const cx = Math.round(W * fx), cy = Math.round(H * 0.55);
      return { cx, cy, points: [[cx - 25, cy], [cx + 25, cy], [cx - 75, cy], [cx + 75, cy]] };
    });
    const ps = await clearSpot(h, cands);
    if (ps) await h.touch.pinch(ps.cx, ps.cy, 50, 150, { steps: 10, ms: 360 });
    await settled(h);
    const s2 = await h.state();
    h.check('landscape: a pinch out raises the binoculars with mag = the gap ratio (3x) at today\'s field (58 / mag)', !!ps && s2.binocular && Math.abs(s2.target - 3) < 0.08 && Math.abs(s2.fov - 58 / s2.mag) < 1e-9, { mag: +s2.mag.toFixed(3), target: +s2.target.toFixed(3), fov: s2.fov });
    await h.shot('pinched');
    await calm(h);
  },

  /** A tablet (--device ipad), once per orientation (h.phase). */
  async tablet(h) {
    const { width: W, height: H } = h.viewport;
    const tag = `tablet ${h.phase}`;
    const c = await cam();
    const restoreTraffic = await holdTraffic(h);
    try {
      await calm(h);
      // The field: a portrait tablet (aspect 0.75) gets the touch floor, a landscape one exactly today's.
      const s0 = await h.state();
      const f0 = await field(h);
      const naked = c.nakedFovDeg(s0.aspect);
      if (h.phase === 'portrait') {
        h.check(`${tag}: the naked eye spans the touch floor (50 deg across), not the 58 deg vertical`, s0.fov > 58 && Math.abs(s0.fov - naked) < 1e-9 && Math.abs(f0?.h - 50) < 1e-6, { fov: +s0.fov.toFixed(3), aspect: +s0.aspect.toFixed(4), horizontal: f0 && +f0.h.toFixed(3) });
      } else {
        h.check(`${tag}: the naked-eye field is exactly today's (58 deg vertical, desktop-identical)`, s0.fov === 58 && naked === 58, { fov: s0.fov, aspect: +s0.aspect.toFixed(4) });
      }
      // Drag look by the finger's angle.
      const rows = [0.55, 0.62, 0.48, 0.7, 0.4].map((fy) => ({ y: Math.round(H * fy), points: [[Math.round(W * 0.38), Math.round(H * fy)], [Math.round(W * 0.62), Math.round(H * fy)]] }));
      const spot = await clearSpot(h, rows);
      const y = spot?.y ?? Math.round(H * 0.55);
      await h.touch.drag(Math.round(W * 0.4), y, Math.round(W * 0.6), y, { steps: 10, ms: 300, release: false });
      await settled(h);
      const s1 = await h.state();
      await h.touch.send('touchEnd', []);
      const tanH = Math.tan((s0.fov * DEG) / 2) * s0.aspect;
      const finger = (Math.atan(0.2 * tanH) - Math.atan(-0.2 * tanH)) / DEG;
      const turned = (s1.yaw - s0.yaw) / DEG;
      h.check(`${tag}: a one-finger drag turns the view by the finger's angle`, !!spot && Math.abs(turned / finger - 1) < 0.12, { turnedDeg: +turned.toFixed(2), fingerAngleDeg: +finger.toFixed(2) });
      // Pinch out into the binoculars (mag = the gap ratio), then back out of them.
      await calm(h);
      const cands = [0.5, 0.42, 0.58, 0.35].map((fx) => {
        const cx = Math.round(W * fx), cy = Math.round(H * 0.55);
        return { cx, cy, points: [[cx - 30, cy], [cx + 30, cy], [cx - 90, cy], [cx + 90, cy]] };
      });
      const ps = await clearSpot(h, cands);
      if (ps) await h.touch.pinch(ps.cx, ps.cy, 60, 180, { steps: 12, ms: 420 });
      await settled(h);
      const s2 = await h.state();
      h.check(`${tag}: a pinch out raises the binoculars with mag = the gap ratio (3x)`, !!ps && s2.binocular && Math.abs(s2.target - 3) < 0.08 && s2.mag === s2.target && Math.abs(s2.fov - naked / s2.mag) < 1e-9, { mag: +s2.mag.toFixed(3), target: +s2.target.toFixed(3), fov: +s2.fov.toFixed(4) });
      await h.shot('tablet-pinched');
      const ins = [0.5, 0.4, 0.6, 0.3].map((fx) => {
        const cx = Math.round(W * fx), cy = Math.round(H * 0.55);
        return { cx, cy, points: [[cx - 110, cy], [cx + 110, cy]] };
      });
      const pin = await clearSpot(h, ins);
      if (pin) await h.touch.pinch(pin.cx, pin.cy, 220, 40, { steps: 12, ms: 420 });
      await settled(h);
      const s3 = await h.state();
      h.check(`${tag}: a pinch in lowers the binoculars`, !!pin && !s3.binocular && s3.target < 1.5, { mag: +s3.mag.toFixed(3), target: +s3.target.toFixed(3), binocular: s3.binocular });
      // Tap: select QAL101 a fingertip away.
      await calm(h);
      const a = await aircraftReady(h);
      let at = null;
      if (a) {
        for (const ang of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
          const q = [Math.round(a.x + Math.cos(ang) * (8 + a.half)), Math.round(a.y + Math.sin(ang) * (8 + a.half))];
          if (await onSurface(h, [q])) { at = q; break; }
        }
      }
      if (at) {
        await stamped(h).tap(at[0], at[1]);
        await h.until(() => window.__fly.airportWatch.selected === 'a1b2c3', undefined, 20000);
      }
      const s4 = await h.state();
      h.check(`${tag}: a tap on QAL101 selects it`, !!at && s4.selected === 'a1b2c3' && !s4.binocular, { hit: a && { x: Math.round(a.x), y: Math.round(a.y), half: Math.round(a.half) }, tappedAt: at, selected: s4.selected });
      await calm(h);
    } finally {
      await restoreTraffic();
    }
  },
};
