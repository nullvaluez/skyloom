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
// raises the binoculars on it, one on empty glass lowers them; a still
// long-press opens its details (closed again by their own button), no text
// selected; a one-finger drag turns the view the finger's way by the
// finger's angle (the exact grab) and a flick glides on; a pinch out raises
// the binoculars with mag = the gap ratio (a mid-zoom capture), the stick
// hides, a pinch in lowers them; the seated Walk ring, pushed, stands you up
// and walks, further runs (faster, its run state), the other thumb looks at
// the same time, release stops, standing it rests in the zone; motionLook
// has the contract's shape, enables with the binoculars, steers the head 1:1
// from synthetic orientation and goes off with them; the page never zooms,
// scrolls or selects text; no flight key leaks.
// LANDSCAPE: the field is exactly today's 58 degrees; drag and pinch work.
const DEG = Math.PI / 180;
const AIRCRAFT = '**/api/aircraft?**';

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

/** Wait until the head and the optics stop moving (the spring and any glide have landed). */
function settled(h, ms = 30000) {
  return h.until(() => {
    const w = window.__fly.airportWatch;
    const s = (window.__touchSettle ||= { yaw: NaN, pitch: NaN, mag: NaN, n: 0 });
    const still = Math.abs(w.yaw - s.yaw) < 2e-5 && Math.abs(w.pitch - s.pitch) < 2e-5 && Math.abs(w.optics.mag - s.mag) < 1e-5;
    s.yaw = w.yaw; s.pitch = w.pitch; s.mag = w.optics.mag;
    s.n = still ? s.n + 1 : 0;
    if (s.n >= 3) { window.__touchSettle = null; return true; }
    return false;
  }, undefined, ms);
}
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
/** Wait for QAL101 on screen and holding still (the held traffic has landed in the feed). */
async function aircraftReady(h) {
  const deadline = Date.now() + 90000;
  let last = null;
  while (Date.now() < deadline) {
    await h.until(() => window.__fly.loungePicker?.hits.some((q) => q.hex === 'a1b2c3' && q.onScreen), undefined, 15000);
    const a = await hitOf(h, 'a1b2c3');
    if (a && last && Math.hypot(a.x - last.x, a.y - last.y) < 3) return a;
    last = a;
    await h.wait(1500);
  }
  return null;
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
        // The capture once the glasses hold the lock (BinocularHud's reading: within an eighth of the field).
        const locked = await h.until(() => { const w = window.__fly.airportWatch; return w.tracking && w.lockError() < (window.__fly.camera.fov * Math.PI) / 180 / 8; }, undefined, 60000);
        h.info('portrait: the binoculars settle on QAL101 (lock within an eighth of the field)', { locked });
        await h.shot('binoculars-on-aircraft');
        const hits = await hitsAll(h);
        let empty = null;
        for (const fy of [0.3, 0.7, 0.45, 0.8, 0.2]) {
          for (const fx of [0.2, 0.5, 0.35, 0.65, 0.8]) {
            const q = [Math.round(W * fx), Math.round(H * fy)];
            if (hits.some((t) => Math.hypot(t.x - q[0], t.y - q[1]) < 150 + t.half)) continue;
            if (await onSurface(h, [q])) { empty = q; break; }
          }
          if (empty) break;
        }
        if (empty) {
          await touch.doubleTap(empty[0], empty[1]);
          await h.until(() => !window.__fly.airportWatch.binocular, undefined, 20000);
        }
        const e = await h.state();
        h.check('portrait: a double-tap on empty glass with the binoculars up lowers them (the selection stays)', !!empty && !e.binocular && e.selected === 'a1b2c3', { at: empty, binocular: e.binocular, selected: e.selected });
        await sample('double-tap');
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
};
