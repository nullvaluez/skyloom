import { wingspanFor, offsetAngles } from './airport-watch-camera.mjs';
import { airlineFor, typeNameFor, contactLabel } from './airport-watch-board.mjs';
import { getTrueScaleK } from './true-scale';
import { nextMovement, movementOfRow, momentStep, watchShot, rangeMagnification, framingMagnification, captionKicker, flightTitle, momentTitle, overRunway } from './airport-watch-director.mjs';

/*
 * watch.director — the lounge director (Play Pass DIRECTOR, LOUNGE_DIRECTOR;
 * FLY_PLAY_PASS.md A1–A4). Attached by lib/fly/airport-watch-runtime.js only
 * while the flag is on (it injects glazingFor, so no circular import); ticked
 * from watch.updateCamera (priority -50), read by
 * components/fly/hud/lounge/DirectorHud.jsx (4 Hz) and LoungeOverlay.jsx (per
 * GL frame: `next`, `touchdownZone`). The watch stays the only owner of the
 * selection, the optics and the head: the director only calls its public
 * surface (select, track, binoculars, glance, clearSelection).
 *
 *   next      the next movement at the field (lib/fly/airport-watch-director.mjs
 *             nextMovement), refreshed at cfg.next.refreshMs, with the
 *             following one as `next.then`;
 *   session   the movement being watched: started by N (watchNext), by a
 *             landing or a takeoff the player selects and follows, or by the
 *             auto director; it follows through touchdown and rollout (or the
 *             roll and the climb-out), then lets go: follow released, glasses down;
 *   auto      "Watch for me" (H): picks the next movement, looks at it, raises
 *             the glasses at the key moments, captions it, moves on; quiet
 *             spells go to an aircraft moving near the window; any player
 *             input hands control back (handBack);
 *   moments   touchdown / liftoff of the watched aircraft or the next one, as
 *             lower-thirds (and the existing select chime).
 */
const GROUNDED = 1;

export function attachLoungeDirector(watch, runtime, cfg, { glazingFor }) {
  let disposed = false, auto = false, stage = 'rest', stageAt = 0, time = 0, refreshAt = -1e9;
  let next = null, session = null, caption = null, lastShotFlip = -1e9, version = 0;
  const moments = [], memo = new Map(), used = new Map(), momented = new Map();
  const eye = {}, angles = {};
  let zones = { epoch: null, list: [] };

  const bump = () => { version++; };
  const trackOf = (hex) => (hex ? runtime.traffic?.tracks.get(hex) ?? null : null);
  const speedOf = (t) => (t?.fix1 ? Math.hypot(t.fix1.vE, t.fix1.vN) : 0);
  const fieldElev = () => (watch.airport ? (watch.airport.a.elevation + watch.airport.b.elevation) / 2 : 0);
  function rangeOf(t) {
    watch.eyeWorld(eye);
    const k = watch.frame?.k || 1;
    return Math.hypot((t.rx - eye.x) / k, (t.ry ?? 0) - eye.y, (t.rz - eye.z) / k);
  }

  /** Touchdown zones of the observed runways (scene points), and whether each is seen from the eye. */
  function touchdownZones() {
    const key = `${watch.siteEpoch}|${watch.seatId}|${watch.posture}`;
    if (zones.epoch === key && time - zones.at < 2) return zones.list;
    watch.eyeWorld(eye);
    const along = cfg.locator.touchdownAlongM;
    zones = {
      epoch: key, at: time,
      list: (watch.runways || []).map((r) => {
        const wx = r.tx + r.ux * along * r.k, wz = r.tz + r.uz * along * r.k, y = r.elev;
        return { label: r.label, wx, wz, y, seen: !!glazingFor(watch, wx - eye.x, y - eye.y, wz - eye.z) };
      }),
    };
    return zones.list;
  }
  const zoneOf = (runway) => (runway ? touchdownZones().find((z) => z.label === runway) ?? null : null);
  const faced = (runway) => {
    const a = watch.airport;
    if (!runway || !a) return null;
    return runway === a.runway || runway === a.reciprocal;
  };

  /** The facts a movement's urgency needs (lib/fly/airport-watch-director.mjs movementUrgency). */
  function factsOf(hex, m) {
    const t = trackOf(hex);
    const zone = m.kind === 'landing' ? zoneOf(m.runway) : null;
    return { touchdownSeen: zone ? zone.seen : null, facedRunway: faced(m.runway), rangeM: t ? rangeOf(t) : 0 };
  }

  function describe(hex, row) {
    const t = trackOf(hex);
    const label = row?.label || contactLabel(t?.meta, hex);
    const airline = row?.airline ?? airlineFor(t?.meta?.flight);
    return { hex, label, airline, title: flightTitle(label, airline), type: row?.type || typeNameFor(t?.meta) || t?.meta?.t || null, typeCode: row?.typeCode || t?.meta?.t || null, flight: t?.meta?.flight?.trim() || null };
  }

  function refreshNext() {
    if (!watch.validated) { if (next) { next = null; bump(); } return; }
    const board = watch.board();
    const exclude = session && session.kind !== 'filler' ? session.hex : null;
    const m = nextMovement(board, next, cfg, factsOf, exclude);
    const before = next?.hex;
    next = m && { ...m, ...describe(m.hex, m.row), touchdown: m.kind === 'landing' ? zoneOf(m.runway) : null, row: undefined };
    if ((next?.hex ?? null) !== (before ?? null)) bump();
  }

  // --- moments ---------------------------------------------------------------
  const runwayOf = (label) => (label ? (watch.runways || []).find((r) => r.label === label) ?? null : null);
  /** A moment's lower third (and the select chime), once per aircraft and kind. */
  function pushMoment(hex, moment, runway, now) {
    const key = `${hex}:${moment}`;
    if (now - (momented.get(key) ?? -1e9) < 90) return;
    momented.set(key, now);
    moments.push({ id: `${key}:${Math.round(now)}`, moment, at: now, runway, kicker: momentTitle(moment, runway), ...describe(hex, null) });
    while (moments.length > 4) moments.shift();
    runtime.airportAudio?.cue?.('select');
    bump();
  }
  function watchMoments(now) {
    const want = new Set([session?.hex, next?.hex, watch.selected].filter(Boolean));
    for (const hex of memo.keys()) if (!want.has(hex)) memo.delete(hex);
    for (const hex of want) {
      const t = trackOf(hex);
      if (!t?.fix1 || t.stale) continue;
      let m = memo.get(hex);
      if (!m) memo.set(hex, (m = { fixT: null }));
      if (t.fix1.t === m.fixT) continue; // one decision per fresh position
      m.fixT = t.fix1.t;
      const runway = (session?.hex === hex ? session.runway : null) || (next?.hex === hex ? next.runway : null) || watch.board().arrivals.concat(watch.board().departures).find((r) => r.hex === hex)?.runway || null;
      const landing = (session?.hex === hex && session.kind === 'landing') || (next?.hex === hex && next.kind === 'landing');
      // The ground flag (two fresh reads), or a landing seen over its runway.
      const moment = momentStep(m, !!(t.flags & GROUNDED), speedOf(t), now, cfg) || (landing && overRunway(t, runwayOf(runway), cfg) ? 'touchdown' : null);
      if (!moment || rangeOf(t) > cfg.moments.rangeM) continue;
      pushMoment(hex, moment, runway, now);
    }
  }

  // --- sessions ----------------------------------------------------------------
  function startSession(hex, kind, { runway = null, auto: byDirector = false } = {}) {
    const t = trackOf(hex);
    if (!t) return false;
    session = { hex, kind, runway, auto: byDirector, startedAt: time, seen: false, hiddenSince: null, reason: null, touchdownAt: null, liftoffAt: null, shotBino: false };
    const visible = watch.contactVisible(hex);
    // Visible: select and follow (the head eases into the swing). Not yet:
    // select it and look where it will appear; the follow starts on sight.
    watch.select(hex, { follow: visible, quiet: byDirector });
    if (!visible) glanceAtAction(session);
    if (byDirector) caption = { ...describe(hex, null), kicker: captionKicker(kind, null, runway), at: time, kind };
    bump();
    return true;
  }
  function endSession(reason) {
    if (!session) return;
    const s = session;
    session = null;
    if (watch.binocular && (s.auto || s.shotBino || watch.selected === s.hex)) watch.binoculars(false);
    if (watch.selected === s.hex && watch.tracking) watch.track(false);
    if (s.auto && watch.selected === s.hex) watch.clearSelection();
    used.set(s.hex, time);
    s.endReason = reason;
    bump();
  }
  /** Turn the head (gently) to where the watched movement will happen. */
  function glanceAtAction(s) {
    const zone = s.kind === 'landing' ? zoneOf(s.runway) : null;
    if (zone?.seen) return watch.glance?.({ wx: zone.wx, wz: zone.wz, y: zone.y });
    const lim = watch.lookLimits();
    return watch.glance?.({ yaw: lim.face, pitch: lim.defaultPitch });
  }

  function sessionFacts(s, t) {
    const visible = watch.contactVisible(s.hex);
    const firstSight = visible && !s.seen;
    if (visible) { s.seen = true; s.hiddenSince = null; }
    else if (s.seen && s.hiddenSince == null) s.hiddenSince = time;
    // On the ground: the feed's flag, or a landing over its runway (overRunway).
    const grounded = !!(t.flags & GROUNDED) || (s.kind === 'landing' && overRunway(t, runwayOf(s.runway), cfg));
    // The ground/air change itself, before the moment confirms it (two fresh
    // reads): the shot must not wait, or the glasses would drop and rise again.
    if (s.kind === 'landing' && grounded && s.touchdownAt == null) s.touchdownAt = time;
    if (s.kind === 'takeoff' && !grounded && s.liftoffAt == null && s.wasGrounded) s.liftoffAt = time;
    if (grounded) s.wasGrounded = true;
    const row = watch.board()[s.kind === 'landing' ? 'arrivals' : 'departures'].find((r) => r.hex === s.hex);
    if (row?.runway && !s.runway) s.runway = row.runway;
    return {
      kind: s.kind, etaS: row?.etaS ?? null, rangeM: rangeOf(t), grounded, speedMs: speedOf(t),
      aglM: (t.ry ?? 0) - fieldElev(), visible, hiddenS: s.hiddenSince == null ? 0 : time - s.hiddenSince,
      sinceTouchdown: s.touchdownAt == null ? null : time - s.touchdownAt, sinceLiftoff: s.liftoffAt == null ? null : time - s.liftoffAt,
      sinceStart: time - s.startedAt, firstSight,
    };
  }

  function runSession() {
    const s = session;
    // The player took the selection elsewhere (or cleared it): the watch is theirs.
    if (watch.selected !== s.hex) return endSession('replaced');
    const t = trackOf(s.hex);
    if (!t || t.stale === 2) return endSession('lost');
    const f = sessionFacts(s, t);
    const shot = watchShot(f, cfg, s.auto);
    if (shot.reason !== s.reason) {
      const beat = s.auto && (shot.reason === 'short-final' || shot.reason === 'takeoff-roll');
      s.reason = shot.reason;
      if (beat || (s.auto && !caption)) caption = { ...describe(s.hex, null), kicker: captionKicker(s.kind, shot.reason, s.runway), at: time, kind: s.kind };
      bump();
    }
    if (shot.done) return endSession(shot.reason);
    // On sight, the follow starts (a manual watch asked for it too); a manual
    // drag that stopped the follow ends a manual watch (the player has it).
    if (!watch.tracking) {
      if (f.visible && (f.firstSight || s.auto)) watch.track(true);
      else if (!s.auto && s.followed) return endSession('released');
    } else s.followed = true;
    // An aircraft so near that the naked eye frames it needs no glasses.
    if (shot.binoculars && framingMagnification(f.rangeM, wingspanFor(t.meta?.category), cfg) < cfg.optics.nakedMag) shot.binoculars = false;
    if (s.auto && shot.binoculars !== watch.binocular && time - lastShotFlip > 2.2 && (!shot.binoculars || watch.tracking)) {
      lastShotFlip = time;
      s.shotBino = shot.binoculars || s.shotBino;
      watch.binoculars(shot.binoculars, { acquire: false });
    }
  }

  // --- the auto director -------------------------------------------------------------
  function fillerCandidate() {
    const C = cfg.director;
    let best = null, bestD = Infinity;
    for (const row of watch.board().ground) {
      if (row.distanceM > C.fillerRangeM || row.speedMs < cfg.sky.groundMovingMs || row.stale) continue;
      if (time - (used.get(row.hex) ?? -1e9) < C.fillerCooldownS * 3) continue;
      if (!watch.contactVisible(row.hex)) continue;
      if (row.distanceM < bestD) { bestD = row.distanceM; best = row; }
    }
    return best;
  }
  function runAuto() {
    const C = cfg.director;
    if (session) {
      // A filler or a climb-out gives way to a movement that is about to happen.
      if ((session.kind === 'filler' || session.kind === 'climb') && next && next.urgency <= C.leadS * 0.5 && next.hex !== session.hex) endSession('preempted');
      else return;
    }
    if (stage !== 'rest') { stage = 'rest'; stageAt = time; if (!watch.tracking) glanceAtRunway(); }
    if (time - stageAt < C.restS) return;
    if (next && next.urgency <= C.leadS) {
      startSession(next.hex, next.kind, { runway: next.runway, auto: true });
      stage = 'session';
      return;
    }
    if (time - (used.get('__filler') ?? -1e9) < C.fillerCooldownS) return;
    const filler = fillerCandidate();
    if (filler) {
      used.set('__filler', time);
      startSession(filler.hex, 'filler', { auto: true });
      stage = 'session';
    }
  }
  /** Between subjects the head rests where the next movement will happen (else the runway). */
  function glanceAtRunway() {
    if (next) glanceAtAction({ kind: next.kind, runway: next.runway });
    else glanceAtAction({ kind: null });
  }

  function setAuto(on) {
    const want = !!on && watch.active;
    if (want === auto) return auto;
    auto = want;
    if (auto) {
      // The director starts from a clean view: a watched movement continues under it.
      if (session) session.auto = true;
      else if (watch.selected) { if (watch.binocular) watch.binoculars(false); watch.clearSelection(); }
      stage = 'rest';
      stageAt = time - cfg.director.restS; // the first pick need not wait
      glanceAtRunway();
      caption = null;
    } else {
      if (session) session.auto = false;
      caption = null;
    }
    bump();
    watch.publish?.();
    return auto;
  }

  const director = {
    get next() { return next; },
    get session() { return session; },
    get auto() { return auto; },
    get version() { return version; },
    /** N: watch the next movement (select it; the head turns and follows through the event). */
    watchNext() {
      if (!watch.active) return null;
      if (!next) refreshNext();
      if (!next) return null;
      if (session && session.hex !== next.hex) endSession('replaced');
      startSession(next.hex, next.kind, { runway: next.runway, auto });
      return next?.hex ?? session?.hex ?? null;
    },
    setAuto,
    toggleAuto: () => setAuto(!auto),
    /** Any player input while the director has the view: it is theirs again. */
    handBack() {
      if (!auto) return false;
      setAuto(false);
      return true;
    },
    /** The zoom steady binoculars use for the selection now, or null (lib/fly/airport-watch-runtime.js). */
    opticsFor(hex) {
      const t = trackOf(hex);
      if (!t?.fix1) return null;
      return rangeMagnification(rangeOf(t), wingspanFor(t.meta?.category), cfg);
    },
    /** Rendered head angles toward a scene point from the eye (yaw room-relative). */
    anglesTo(p, out = angles) {
      watch.eyeWorld(eye);
      return offsetAngles(p.wx - eye.x, p.y - eye.y, p.wz - eye.z, getTrueScaleK(), watch.roomHeading, out);
    },
    touchdownZone: (runway) => zoneOf(runway),
    tick(dt) {
      if (disposed || !watch.active) return;
      time += dt;
      if (time - refreshAt >= cfg.next.refreshMs / 1000) {
        refreshAt = time;
        refreshNext();
        // A landing or a takeoff the player selected and follows (a board row,
        // a click) is a watch too: it lets go once the movement is over.
        if (!session && watch.selected && watch.tracking) {
          const row = [...watch.board().arrivals, ...watch.board().departures].find((r) => r.hex === watch.selected);
          const m = row && movementOfRow(row, cfg);
          if (m && m.kind !== 'climb') session = { hex: m.hex, kind: m.kind, runway: m.runway, auto: false, startedAt: time, seen: true, hiddenSince: null, reason: null, touchdownAt: null, liftoffAt: null, shotBino: false, followed: true };
        }
      }
      watchMoments(time);
      if (session) runSession();
      if (auto) runAuto();
      if (caption && time - caption.at > cfg.director.captionS) { caption = null; bump(); }
    },
    snapshot() {
      return {
        auto, stage, version,
        next: next && { hex: next.hex, kind: next.kind, etaS: next.etaS, runway: next.runway, label: next.label, airline: next.airline, title: next.title, type: next.type, typeCode: next.typeCode, flight: next.flight, urgency: next.urgency, unseen: next.kind === 'landing' && next.touchdown ? !next.touchdown.seen : null, then: next.then },
        session: session && { hex: session.hex, kind: session.kind, runway: session.runway, auto: session.auto, reason: session.reason, seen: session.seen, ...describe(session.hex, null) },
        caption: caption && { ...caption, age: time - caption.at },
        moments: moments.filter((m) => time - m.at < cfg.moments.showS).map((m) => ({ ...m, age: time - m.at })),
      };
    },
    /** Forget everything (a new airport or seat, leaving). */
    reset() {
      session = null; next = null; caption = null; auto = false; stage = 'rest';
      moments.length = 0; memo.clear(); used.clear(); momented.clear(); zones = { epoch: null, list: [] };
      refreshAt = -1e9;
      bump();
    },
    dispose() {
      disposed = true;
      director.reset();
      if (watch.director === director) watch.director = null;
    },
  };
  watch.director = director;
  return () => director.dispose();
}
