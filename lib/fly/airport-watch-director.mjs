// The lounge director (Play Pass DIRECTOR, FLY_PLAY_PASS.md A1–A4): what is
// the next movement at the observed airport, how a watched movement is shot
// (follow, binoculars, let go), the moments worth a caption, and the zoom a
// steady pair of binoculars uses for a range. Pure: board rows and per-track
// facts in, decisions out; no three, no DOM, no store. `cfg` is the resolved
// LOUNGE_DIRECTOR block (lib/fly/play-pass.js); the runtime half is
// lib/fly/airport-watch-director-runtime.js.
//
// A movement is one of:
//   landing   an arrival lined up (or descending toward the field), eta = its board ETA
//   takeoff   a departure on its takeoff roll (now)
//   climb     a departure climbing out, still close (it just left)
// Every one is an inference from live positions, never a schedule. Between
// movements the auto director watches a `filler`: an aircraft moving on the
// ground near the window.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const DEG = Math.PI / 180;

/** The movement a board row describes, or null (ground traffic at a stand, overflights). */
export function movementOfRow(row, cfg) {
  if (!row) return null;
  const N = cfg.next;
  if (row.category === 'arrival') {
    // Landed already (rolling out, taxiing in): the movement is over.
    if (row.phase === 'runway' || row.phase === 'taxi' || row.phase === 'parked' || row.etaS === 0) return null;
    if (!Number.isFinite(row.etaS) || row.etaS > N.horizonS) return null;
    return { hex: row.hex, kind: 'landing', etaS: row.etaS, runway: row.runway || null };
  }
  if (row.category === 'departure') {
    if (row.phase === 'runway') return { hex: row.hex, kind: 'takeoff', etaS: 0, runway: row.runway || null };
    if (row.distanceM > N.climbRangeM) return null;
    return { hex: row.hex, kind: 'climb', etaS: 0, runway: row.runway || null };
  }
  return null;
}

/**
 * How soon a movement deserves attention, in seconds (lower is sooner).
 * `facts` = { touchdownSeen (bool|null), facedRunway (bool|null), rangeM }.
 */
export function movementUrgency(m, facts, cfg) {
  const N = cfg.next;
  if (m.kind === 'takeoff') return 0;
  if (m.kind === 'climb') return N.climbS + ((facts?.rangeM ?? 0) / 1000) * N.climbPerKmS;
  let s = m.etaS;
  if (facts?.touchdownSeen === false) s += N.hiddenTouchdownS;
  if (facts?.facedRunway === false) s += N.otherRunwayS;
  return s;
}

/**
 * The next movement from the board, with hysteresis: the shown one stays
 * until it is gone or a candidate is cfg.next.switchS sooner. `factsOf(hex,
 * movement)` supplies the per-movement facts (visibility of the touchdown
 * zone, the faced runway, range). `exclude` (a hex) is skipped — the
 * movement already being watched. Returns {hex, kind, etaS, runway, urgency}
 * plus `then` (the following movement, or null), or null.
 */
export function nextMovement(board, previous, cfg, factsOf = () => null, exclude = null) {
  const out = [];
  const seen = new Set();
  for (const list of [board?.arrivals, board?.departures, board?.ground]) {
    for (const row of list || []) {
      if (!row || row.hex === exclude || seen.has(row.hex)) continue;
      const m = movementOfRow(row, cfg);
      if (!m) continue;
      seen.add(row.hex);
      m.urgency = movementUrgency(m, factsOf(row.hex, m), cfg);
      m.row = row;
      out.push(m);
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => a.urgency - b.urgency || (a.row.distanceM ?? 0) - (b.row.distanceM ?? 0));
  let best = out[0];
  const held = previous && out.find((m) => m.hex === previous.hex);
  if (held && held !== best && held.urgency - best.urgency < cfg.next.switchS) best = held;
  const then = out.find((m) => m !== best) || null;
  return { hex: best.hex, kind: best.kind, etaS: best.etaS, runway: best.runway, urgency: best.urgency, row: best.row, then: then && { hex: then.hex, kind: then.kind, etaS: then.etaS, runway: then.runway, label: then.row.label } };
}

/**
 * Binocular magnification that frames an aircraft of wingspan `spanM` at
 * `rangeM`: its span fills cfg.optics.fill of the vertical field
 * (FOV = baseFovDeg / mag), within [minMag, maxMag].
 */
export function rangeMagnification(rangeM, spanM, cfg, baseFovDeg = 58) {
  const O = cfg.optics;
  if (!(rangeM > 0) || !(spanM > 0)) return O.minMag;
  return clamp(framingMagnification(rangeM, spanM, cfg, baseFovDeg), O.minMag, O.maxMag);
}

/** The same framing unclamped: below the binoculars' power the naked eye already frames it. */
export function framingMagnification(rangeM, spanM, cfg, baseFovDeg = 58) {
  if (!(rangeM > 0) || !(spanM > 0)) return 1;
  const spanDeg = (2 * Math.atan(spanM / 2 / rangeM)) / DEG;
  return (baseFovDeg * cfg.optics.fill) / spanDeg;
}

/**
 * One step of a contact's ground/air memory: returns 'touchdown' |
 * 'liftoff' | null. A transition counts once it has held two fresh reads, at
 * a speed that belongs to a landing or a takeoff (a taxiing aircraft that
 * blips airborne is no liftoff). `memo` is per contact and is mutated.
 */
export function momentStep(memo, grounded, speedMs, nowSec, cfg) {
  const M = cfg.moments;
  if (memo.state == null) {
    memo.state = grounded;
    memo.cand = null;
    return null;
  }
  if (grounded === memo.state) {
    memo.cand = null;
    return null;
  }
  if (memo.cand !== grounded) {
    memo.cand = grounded;
    memo.candAt = nowSec;
    memo.reads = 1;
    return null;
  }
  memo.reads = (memo.reads || 0) + 1;
  if (memo.reads < 2) return null;
  memo.state = grounded;
  memo.cand = null;
  if (grounded && speedMs >= M.touchdownMinMs) return 'touchdown';
  if (!grounded && speedMs >= M.liftoffMinMs) return 'liftoff';
  return null;
}

/**
 * The shot for a watched movement this instant. `f` = {kind ('landing' |
 * 'takeoff' | 'climb' | 'lineup' | 'filler'), etaS, rangeM, grounded,
 * speedMs, aglM, visible, hiddenS (seconds out of sight, 0 in view),
 * sinceTouchdown, sinceLiftoff (seconds, or null), sinceStart}. Returns
 * {binoculars, done, reason}: whether the glasses belong up (the auto
 * director's choice; a manual watch only uses `done`) and whether the
 * movement is over and the watch should let go.
 */
export function watchShot(f, cfg, auto = false) {
  const W = cfg.watch, D = cfg.director;
  if (f.hiddenS > W.lostS) return { binoculars: false, done: true, reason: 'lost' };
  if (f.sinceStart > W.maxWatchS) return { binoculars: false, done: true, reason: 'timeout' };
  const seen = f.visible && f.hiddenS === 0;
  switch (f.kind) {
    case 'landing': {
      if (f.sinceTouchdown != null) {
        const done = f.sinceTouchdown >= W.landedDoneS || (f.grounded && f.speedMs < W.taxiMs && f.sinceTouchdown >= 3);
        return { binoculars: auto && seen && f.sinceTouchdown < W.rolloutHoldS, done, reason: done ? 'landed' : 'rollout' };
      }
      // Rolling already when first seen (a missed touchdown): watch it slow, then go.
      if (f.grounded) return { binoculars: false, done: f.speedMs < W.taxiMs, reason: 'rollout' };
      // The glasses come up on short final, or sooner when it passes close to the window.
      const short = Number.isFinite(f.etaS) && f.etaS <= D.closeEtaS;
      return { binoculars: auto && seen && (short || f.rangeM <= D.closeRangeM), done: false, reason: short ? 'short-final' : 'approach' };
    }
    case 'takeoff': {
      if (f.sinceLiftoff != null) {
        const done = f.sinceLiftoff >= W.airborneDoneS || f.rangeM > W.climbDoneRangeM;
        return { binoculars: auto && seen && f.sinceLiftoff < W.climbHoldS, done, reason: done ? 'airborne' : 'climb-out' };
      }
      // Airborne without a liftoff seen (the ground flag can lag): a climb-out.
      if (!f.grounded) return watchShot({ ...f, kind: 'climb' }, cfg, auto);
      // A roll that stops (a rejected takeoff, a vacate) is over.
      if (f.speedMs < W.taxiMs && f.sinceStart > 6) return { binoculars: false, done: true, reason: 'stopped' };
      return { binoculars: auto && seen, done: false, reason: 'takeoff-roll' };
    }
    case 'climb': {
      const done = f.sinceStart >= W.climbWatchS || f.rangeM > W.climbDoneRangeM;
      return { binoculars: auto && seen && f.sinceStart < W.climbHoldS, done, reason: done ? 'gone' : 'climb-out' };
    }
    case 'filler': {
      const done = f.sinceStart >= D.fillerS;
      return { binoculars: auto && seen && !done, done, reason: 'filler' };
    }
    default:
      return { binoculars: false, done: true, reason: 'unknown' };
  }
}

/**
 * Over the runway past its touchdown zone, on the centreline and not
 * climbing: a landing that has touched down even when the feed never flags it
 * on the ground (many do not, and reported heights near the field are off by
 * the day's pressure). `rw` is a runwayDirections entry {tx, tz, ux, uz, k}
 * (lib/fly/airport-watch-board.mjs); scene coordinates in.
 */
export function overRunway(t, rw, cfg) {
  if (!t?.fix1 || !rw) return false;
  const M = cfg.moments;
  const rx = (t.rx - rw.tx) / rw.k, rz = (t.rz - rw.tz) / rw.k;
  const along = rx * rw.ux + rz * rw.uz, cross = -rx * rw.uz + rz * rw.ux;
  return along >= M.pastThresholdM && along <= M.runwayM && Math.abs(cross) <= M.centrelineM && (t.fix1.vUp || 0) < M.levelMs;
}

/** "JBU60" -> "JetBlue Airways 60" when the airline is known, else the callsign. */
export function flightTitle(label, airline) {
  const m = /^([A-Z]{3})(\d[0-9A-Z]{0,4})$/.exec(String(label || '').trim().toUpperCase());
  return airline && m ? `${airline} ${m[2]}` : String(label || '');
}

/** The lower-third kicker for a watched movement and its shot reason. */
export function captionKicker(kind, reason, runway) {
  const rw = runway ? ` · Runway ${runway}` : '';
  if (kind === 'landing') {
    if (reason === 'rollout' || reason === 'landed') return `Landed${rw}`;
    if (reason === 'short-final') return `Short final${rw}`;
    return `Arriving${rw}`;
  }
  if (kind === 'takeoff') return reason === 'takeoff-roll' ? `Takeoff roll${rw}` : `Departing${rw}`;
  if (kind === 'climb') return `Climbing out${rw}`;
  if (kind === 'filler') return 'On the ground here';
  return '';
}

/** The moment's lower-third line: "Touchdown · Runway 04R" / "Airborne · Runway 22R". */
export function momentTitle(moment, runway) {
  const rw = runway ? ` · Runway ${runway}` : '';
  return moment === 'touchdown' ? `Touchdown${rw}` : moment === 'liftoff' ? `Airborne${rw}` : '';
}

/** Countdown text for the cue: 'now' under 10 s, m:ss under ten minutes, else whole minutes. */
export function countdown(etaS) {
  if (!Number.isFinite(etaS)) return '';
  if (etaS < 10) return 'now';
  const r = Math.round(etaS);
  if (r < 600) return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
  return `${Math.round(etaS / 60)} min`;
}

/** The cue's verb for a movement kind. */
export function movementVerb(kind) {
  return kind === 'landing' ? 'Landing' : kind === 'takeoff' ? 'Taking off' : kind === 'climb' ? 'Climbing out' : 'Moving';
}

/**
 * Which idle marker a contact earns in the clean sky: 'bracket' | 'dot' |
 * null. `c` = {grounded, speedMs, dist, category ('arrival' | 'departure' |
 * ...)}; the selection, the hover and the next movement are drawn by their
 * own rules and never ask.
 */
export function skyMarker(c, cfg) {
  const S = cfg.sky;
  if (c.grounded) return c.speedMs >= S.groundMovingMs && c.dist <= S.groundMovingM ? 'bracket' : null;
  if (c.category === 'arrival' || c.category === 'departure') return c.dist <= S.movementM ? 'bracket' : c.dist <= S.dotM ? 'dot' : null;
  if (c.dist <= S.bracketM) return 'bracket';
  return c.dist <= S.dotM ? 'dot' : null;
}
