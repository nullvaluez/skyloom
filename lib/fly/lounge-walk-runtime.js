/**
 * LOUNGE_WALK — the walking observer (Gate to Gate W4, stream N).
 *
 * connectAirportWatch (lib/fly/airport-watch-runtime.js) calls
 * attachLoungeWalk(watch, runtime) on each enter while LOUNGE_WALK is on and
 * calls the function it returns to detach. Attached, it installs watch.walk
 * and sets watch.seats to the room variant's vantage seats.
 *
 * POSTURES. 'seated' (the eye at a vantage seat, 1.18 m; the seat's look
 * limits), 'standing' (the eye at WALK.eyeStandM, 1.65 m; the head turns all
 * the way round) and 'gliding' (a deterministic move into a seat or out of
 * one, room-walk.mjs seatGlide). Every visit starts seated, at the seat the
 * enter() options name or the window.
 *
 * WALKING. Held move keys (LoungeSurface: W/A/S/D, Shift to run) set a target
 * velocity in the head's yaw frame; the velocity eases toward it over
 * WALK.accelSec and the eye moves through room-walk.mjs moveWithCollision, so
 * it slides along furniture and never leaves free space. A move key while
 * seated stands you up first; while the binoculars are up it lowers them, and
 * the glasses going up stops a walk (halt). Nothing moves until the floor is
 * validated. The head bob is camera-only (watch.walk.bob, applied by
 * updateCamera) and zero under reduced motion; a footstep plays each stride
 * on the room bus. While standing, the nearest chair you face within reach is
 * offered (watch.sitPrompt; Enter sits).
 *
 * watch.walk = {
 *   update(dt, now), lookLimits(), enter(entry), leave(), halt(),
 *   setMoveKeys(forward, right, run), sit(id, {instant}), stand(),
 *   seatAt(u, v)    the vantage chair under NDC (u, v) (click-a-chair), or null
 *   clearance()     metres from the eye to the nearest blocker (harnesses)
 *   bob             { x, y } camera-only, metres
 *   veil            0..1, the reduced-motion cut's dip to black
 *   speed           metres per second, as walked
 * }
 */
import { LOUNGE_ROOM, VANTAGE, WALK } from './observation-config.js';
import { roomBlockers } from './lounge/room-build.js';
import { buildWalkGrid, isFree, moveWithCollision, seatGlide, sitPrompt, seatOnRay, clearance, comfortSec } from './lounge/room-walk.mjs';
import { walkBob, ndcDirection, prefersReducedMotion, fovForMag, DEG, smoothstep } from './airport-watch-camera.mjs';

// The walkable space per room variant (the grid is ~35k cells; built once, on
// first use, so an enter never pays for it: by the first validated frame the
// lounge has built the room and roomBlockers() reads its blockers).
const SPACES = new Map();
function walkSpace(variant) {
  if (!SPACES.has(variant)) {
    const blockers = roomBlockers(variant);
    SPACES.set(variant, { variant, blockers, grid: buildWalkGrid(blockers), seats: VANTAGE[variant] ?? VANTAGE.classic });
  }
  return SPACES.get(variant);
}

// Standing: a full circle of yaw; R faces the runway.
const STANDING_LOOK = Object.freeze({
  centre: 0, yawSpan: Math.PI, pitchMin: WALK.standing.pitchMin, pitchMax: WALK.standing.pitchMax,
  defaultPitch: LOUNGE_ROOM.look.defaultPitch, face: 0,
});

export function attachLoungeWalk(watch, runtime) {
  let space = null;
  const variantOf = () => (watch.site?.variant === 'pier' ? 'pier' : 'classic');
  const seatsOf = () => VANTAGE[variantOf()] ?? VANTAGE.classic;
  const ensureSpace = () => {
    const variant = variantOf();
    if (!space || space.variant !== variant) space = walkSpace(variant);
    return space;
  };
  const seatById = (id) => seatsOf().find((s) => s.id === id) ?? null;
  const lookFor = new Map(); // seat id -> its look limits with `face`
  const seatLook = (seat) => {
    if (!lookFor.has(seat.id)) lookFor.set(seat.id, Object.freeze({ ...seat.look, face: seat.look.centre }));
    return lookFor.get(seat.id);
  };

  const keys = { forward: 0, right: 0, run: false };
  const vel = { x: 0, z: 0 };
  const moved = { x: 0, z: 0, blocked: false };
  const pose = {};
  let glide = null, glideT = 0, glideSeat = null, after = null; // after: 'seated' | 'standing'
  let reduced = prefersReducedMotion();
  let phase = 0, stepIndex = 0;

  const walk = {
    bob: { x: 0, y: 0 },
    veil: 0,
    speed: 0,
    lookLimits() {
      if (watch.posture === 'seated') {
        const seat = seatById(watch.seatId);
        if (seat) return seatLook(seat);
      }
      return STANDING_LOOK;
    },
    enter(entry) {
      watch.seats = seatsOf();
      reduced = prefersReducedMotion();
      reset();
      const seat = seatById(entry?.seat) ?? seatById('window') ?? watch.seats[0];
      placeSeated(seat);
    },
    leave() {
      reset();
    },
    halt() {
      vel.x = vel.z = 0;
      walk.speed = 0;
    },
    setMoveKeys(forward, right, run) {
      keys.forward = Math.sign(forward || 0);
      keys.right = Math.sign(right || 0);
      keys.run = !!run;
      const moving = keys.forward !== 0 || keys.right !== 0;
      if (moving && watch.binocular) watch.binoculars(false);
      if (moving && watch.posture === 'seated' && !glide) walk.stand();
      return true;
    },
    sit(id, { instant = false } = {}) {
      const seat = seatById(id);
      if (!seat || !watch.active) return false;
      if (watch.posture === 'seated' && watch.seatId === id && !glide) return true;
      closeMenu();
      if (instant) {
        reset();
        placeSeated(seat);
        aimAt(seat.look.centre, seat.look.defaultPitch);
        watch.publish?.();
        return true;
      }
      const sp = ensureSpace();
      const g = seatGlide(currentFrom(), seat, sp.grid, { reduced, seats: sp.seats });
      if (!g) return false;
      beginGlide(g, seat, 'seated');
      return true;
    },
    stand() {
      if (!watch.active || watch.posture !== 'seated' || glide) return false;
      const seat = seatById(watch.seatId);
      if (!seat) return false;
      closeMenu();
      if (reduced) {
        // A short rise and step out of the chair: under reduced motion it simply happens.
        setEye(seat.approach[0], WALK.eyeStandM, seat.approach[1]);
        watch.posture = 'standing';
        watch.publish?.();
        return true;
      }
      const from = { x: watch.eyeLocal.x, y: watch.eyeLocal.y, z: watch.eyeLocal.z };
      const to = { x: seat.approach[0], y: WALK.eyeStandM, z: seat.approach[1] };
      const dur = comfortSec(Math.hypot(to.x - from.x, to.z - from.z), WALK.sit.standSec);
      beginGlide({
        duration: dur, cut: false,
        sample(t, out) {
          const u = smoothstep(0, 1, t / dur);
          out.x = from.x + (to.x - from.x) * u; out.y = from.y + (to.y - from.y) * u; out.z = from.z + (to.z - from.z) * u;
          out.yaw = null; // the head stays where it is
          return out;
        },
        veil: () => 0,
      }, null, 'standing');
      return true;
    },
    clearance() {
      return clearance(ensureSpace().blockers, watch.eyeLocal.x, watch.eyeLocal.z);
    },
    seatAt(u, v) {
      if (!watch.active || !Number.isFinite(u) || !Number.isFinite(v)) return null;
      const camera = runtime.camera;
      const tanV = Math.tan(((camera?.fov ?? fovForMag(watch.optics?.mag ?? 1)) * DEG) / 2);
      const d = ndcDirection(watch.yaw, watch.pitch, u, v, tanV * (camera?.aspect || 16 / 9), tanV, {});
      const dir = { x: -Math.sin(d.yaw) * Math.cos(d.pitch), y: Math.sin(d.pitch), z: -Math.cos(d.yaw) * Math.cos(d.pitch) };
      return seatOnRay(ensureSpace().blockers, watch.eyeLocal, dir);
    },
    update(dt, now) {
      if (!watch.active || !watch.validated) return; // nothing walks before the floor is validated
      ensureSpace();
      if (glide) {
        stepGlide(dt);
        return;
      }
      if (watch.posture !== 'standing') {
        walk.bob.x = walk.bob.y = 0;
        walk.speed = 0;
        return;
      }
      stepWalk(dt, now);
    },
  };

  function reset() {
    glide = null;
    glideT = 0;
    glideSeat = null;
    after = null;
    keys.forward = keys.right = 0;
    keys.run = false;
    vel.x = vel.z = 0;
    walk.speed = 0;
    walk.bob.x = walk.bob.y = 0;
    walk.veil = 0;
    phase = 0;
    stepIndex = 0;
    if (watch.sitPrompt) watch.sitPrompt = null;
  }
  function setEye(x, y, z) {
    watch.eyeLocal.x = x;
    watch.eyeLocal.y = y;
    watch.eyeLocal.z = z;
  }
  function placeSeated(seat) {
    setEye(seat.eye[0], seat.eye[1], seat.eye[2]);
    watch.posture = 'seated';
    watch.seatId = seat.id;
    watch.sitPrompt = null;
  }
  function aimAt(yaw, pitch) {
    if (watch.tracking) watch.track(false);
    watch.yaw = yaw;
    watch.pitch = pitch;
  }
  function closeMenu() {
    if (watch.seatMenu) watch.seatMenuOpen(false);
  }
  function currentFrom() {
    const e = watch.eyeLocal;
    return { x: e.x, y: e.y, z: e.z, yaw: watch.yaw, pitch: watch.pitch, seatId: watch.posture === 'seated' ? watch.seatId : null };
  }
  function beginGlide(g, seat, then) {
    if (watch.binocular) watch.binoculars(false);
    if (watch.tracking && g.sample(0, {}).yaw != null) watch.track(false);
    glide = g;
    glideT = 0;
    glideSeat = seat;
    after = then;
    vel.x = vel.z = 0;
    walk.speed = 0;
    walk.bob.x = walk.bob.y = 0;
    watch.posture = 'gliding';
    watch.sitPrompt = null;
    watch.publish?.();
  }
  function stepGlide(dt) {
    glideT = Math.min(glide.duration, glideT + dt);
    glide.sample(glideT, pose);
    setEye(pose.x, pose.y, pose.z);
    if (pose.yaw != null && !watch.tracking) {
      watch.yaw = pose.yaw;
      watch.pitch = pose.pitch;
    }
    walk.veil = glide.veil(glideT);
    if (glideT < glide.duration) return;
    walk.veil = 0;
    const seat = glideSeat;
    glide = null;
    glideSeat = null;
    if (after === 'seated' && seat) {
      placeSeated(seat);
      if (!watch.tracking) aimAt(seat.look.centre, seat.look.defaultPitch);
    } else watch.posture = 'standing';
    after = null;
    watch.publish?.();
  }
  function stepWalk(dt, now) {
    const e = watch.eyeLocal;
    if (e.y !== WALK.eyeStandM) e.y = WALK.eyeStandM;
    // Target velocity in the head's yaw frame (room-local; yaw 0 faces -Z).
    let fx = 0, fz = 0;
    if (!watch.binocular && (keys.forward || keys.right)) {
      const yaw = watch.yaw, s = Math.sin(yaw), c = Math.cos(yaw);
      fx = -s * keys.forward + c * keys.right;
      fz = -c * keys.forward - s * keys.right;
      const n = Math.hypot(fx, fz) || 1;
      const speed = keys.run ? WALK.runMps : WALK.speedMps;
      fx = (fx / n) * speed;
      fz = (fz / n) * speed;
    }
    // Velocity eases toward the keys at a constant acceleration: from rest to
    // a run in WALK.accelSec, and back to rest as quickly (it stops dead).
    const maxDv = (WALK.runMps / WALK.accelSec) * Math.max(0, dt);
    const dvx = fx - vel.x, dvz = fz - vel.z, dv = Math.hypot(dvx, dvz);
    if (dv <= maxDv) {
      vel.x = fx;
      vel.z = fz;
    } else {
      vel.x += (dvx / dv) * maxDv;
      vel.z += (dvz / dv) * maxDv;
    }
    const x0 = e.x, z0 = e.z;
    if (vel.x || vel.z) {
      moveWithCollision(space.grid, e, vel.x * dt, vel.z * dt, moved);
      e.x = moved.x;
      e.z = moved.z;
    }
    const step = Math.hypot(e.x - x0, e.z - z0);
    walk.speed = dt > 0 ? step / dt : 0;
    // Bob and footsteps from the distance actually walked.
    phase += (Math.PI * step) / WALK.bob.strideM;
    walkBob(phase, walk.speed, reduced, walk.bob);
    const k = Math.floor(phase / Math.PI);
    if (k !== stepIndex) {
      stepIndex = k;
      if (walk.speed > 0.3) runtime.airportAudio?.cue?.('step');
    }
    // The seat on offer.
    const prompt = sitPrompt(space.seats, e, watch.yaw);
    if ((prompt?.id ?? null) !== (watch.sitPrompt?.id ?? null)) {
      watch.sitPrompt = prompt;
      watch.publish?.();
    } else if (prompt) watch.sitPrompt = prompt;
  }

  watch.walk = walk;
  watch.seats = seatsOf();
  return () => {
    reset();
    if (watch.walk === walk) watch.walk = null;
    watch.seats = [];
  };
}

/** Test hook: is (x, z) walkable in the classic room? */
export function walkableAt(x, z, variant = 'classic') {
  return isFree(walkSpace(variant).grid, x, z);
}

