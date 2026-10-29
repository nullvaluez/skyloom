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
 * THE WALK STICK (LOUNGE MOBILE; FLY_LOUNGE_MOBILE.md): setMoveAnalog takes
 * the stick's analog forward / right (-1..1; their length is the share of the
 * walk speed, lib/fly/lounge/touch-stick.mjs) and the run flag. It is the
 * move keys' twin: the same stand-up, binoculars-down and décor-card rules,
 * the same acceleration, collisions, stairs, bob and footsteps; only the
 * speed scales with the throw. The keys keep their semantics exactly.
 *
 * THE PIER ROOM (second-level pass, LIFE; lib/fly/lounge/lounge-life.mjs):
 * each footstep names the surface it lands on (stone, oak, rug, tread); on the
 * stair flight a footfall comes every tread pair (LOUNGE_FEEL.stair.strideM,
 * horizontal) and the bob's vertical becomes a small stepped lift over the
 * continuous ramp (camera-only, faded over the first and last tread pair,
 * zero under reduced motion); and the décor on offer (upper-dressing.mjs
 * INSPECTABLES, once built) can be looked at in a calm card. The classic room
 * walks, steps and sounds exactly as before.
 *
 * watch.walk = {
 *   update(dt, now), lookLimits(), enter(entry), leave(), halt(),
 *   setMoveKeys(forward, right, run), sit(id, {instant}), stand(),
 *   seatAt(u, v)    the vantage chair under NDC (u, v) (click-a-chair), or null
 *   clearance()     metres from the eye to the nearest blocker (harnesses)
 *   bob             { x, y } camera-only, metres
 *   veil            0..1, the reduced-motion cut's dip to black
 *   speed           metres per second, as walked
 *   floorId         'lower' | 'stairs' | 'upper'
 *   inspectOffer    the décor on offer { id, label, prompt, text } or null (pier)
 *   inspecting      the décor whose card is open, or null (pier)
 *   openInspect(id) open the card of the piece on offer (id optional); closeInspect()
 *   decorAt(u, v)   the piece on offer when NDC (u, v) is on it (click-the-décor), or null
 * }
 */
import { LOUNGE_FEEL, LOUNGE_ROOM, VANTAGE, WALK } from './observation-config.js';
import { roomBlockers, roomDressing } from './lounge/room-build.js';
import { buildWalkSpace, isFree, moveWithCollision, seatGlide, sitPrompt, seatOnRay, walkClearance, floorHeight, comfortSec } from './lounge/room-walk.mjs';
import { footstepSurface, stairLift, stairWeight, inspectOffer } from './lounge/lounge-life.mjs';
import { INSPECTABLES } from './lounge/upper-dressing.mjs';
import { rayBox } from './lounge/observatory-stations.mjs';
import { walkBob, ndcDirection, prefersReducedMotion, fovForMag, DEG, smoothstep } from './airport-watch-camera.mjs';
import { getTrueScaleK } from './true-scale.js';

// The walkable space per room variant (the grid is ~35k cells; built once, on
// first use, so an enter never pays for it: by the first validated frame the
// lounge has built the room and roomBlockers() reads its blockers). The pier
// also keeps the dressing its room built (the footstep rugs and the décor on
// offer follow it; the classic room has none).
const SPACES = new Map();
function walkSpace(variant) {
  if (!SPACES.has(variant)) {
    const blockers = roomBlockers(variant);
    const built = variant === 'pier' ? roomDressing(variant) : Object.freeze([]);
    SPACES.set(variant, { variant, blockers, built, grid: buildWalkSpace(blockers, { variant }), seats: VANTAGE[variant] ?? VANTAGE.classic });
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

  // amount: the share of the walk speed (1 for the keys; the stick's throw).
  const keys = { forward: 0, right: 0, run: false, amount: 1 };
  const vel = { x: 0, z: 0 };
  const moved = { x: 0, z: 0, blocked: false };
  const pose = {};
  let glide = null, glideT = 0, glideSeat = null, after = null; // after: 'seated' | 'standing'
  let reduced = prefersReducedMotion();
  let reducedFrames = 0; // re-read every 30 frames: the setting can change mid-visit
  let phase = 0, stepIndex = 0;

  const walk = {
    bob: { x: 0, y: 0 },
    veil: 0,
    speed: 0,
    floorId: 'lower',
    inspectOffer: null,
    inspecting: null,
    /**
     * Open the calm card for the décor on offer (pier). No camera move, no
     * reward, nothing remembered: the card is text about the piece, and a
     * stride, a seat or leaving closes it.
     */
    openInspect(id) {
      const offer = walk.inspectOffer;
      if (!offer || (id != null && id !== offer.id) || !watch.active || watch.posture !== 'standing') return false;
      // Opening mid-push ends that stride (as an instrument does); the next move key closes the card.
      keys.forward = keys.right = 0;
      keys.run = false;
      walk.halt();
      walk.inspecting = offer;
      return true;
    },
    closeInspect() {
      if (!walk.inspecting) return false;
      walk.inspecting = null;
      return true;
    },
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
    /** The binoculars came up (any route): the walk stops and the seat menu closes. */
    halt() {
      vel.x = vel.z = 0;
      walk.speed = 0;
      closeMenu();
    },
    setMoveKeys(forward, right, run) {
      keys.forward = Math.sign(forward || 0);
      keys.right = Math.sign(right || 0);
      keys.run = !!run;
      keys.amount = 1;
      return onMoveInput();
    },
    /** The walk stick (LOUNGE MOBILE): analog forward / right, -1..1 each. */
    setMoveAnalog(forward, right, run) {
      const f = Number.isFinite(forward) ? Math.max(-1, Math.min(1, forward)) : 0;
      const r = Number.isFinite(right) ? Math.max(-1, Math.min(1, right)) : 0;
      keys.forward = f;
      keys.right = r;
      keys.run = !!run && (f !== 0 || r !== 0);
      keys.amount = Math.min(1, Math.hypot(f, r));
      return onMoveInput();
    },
    sit(id, { instant = false } = {}) {
      const seat = seatById(id);
      if (!seat || !watch.active) return false;
      if (watch.posture === 'seated' && watch.seatId === id && !glide) return true;
      // A glide in progress is not re-planned from mid-air: the same seat is
      // already on its way, another waits until it lands.
      if (glide) return glideSeat?.id === id;
      reduced = prefersReducedMotion();
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
      reduced = prefersReducedMotion();
      closeMenu();
      if (reduced) {
        // A short rise and step out of the chair: under reduced motion it simply happens.
        setEye(seat.approach[0], (seat.floorY ?? 0) + WALK.eyeStandM, seat.approach[1]);
        watch.posture = 'standing';
        watch.publish?.();
        return true;
      }
      const from = { x: watch.eyeLocal.x, y: watch.eyeLocal.y, z: watch.eyeLocal.z };
      const to = { x: seat.approach[0], y: (seat.floorY ?? 0) + WALK.eyeStandM, z: seat.approach[1] };
      const dur = comfortSec(Math.hypot(to.x - from.x, to.z - from.z), WALK.sit.standSec);
      beginGlide({
        duration: dur, cut: false,
        sample(t, out) {
          const u = smoothstep(0, 1, t / dur);
          out.x = from.x + (to.x - from.x) * u; out.y = from.y + (to.y - from.y) * u; out.z = from.z + (to.z - from.z) * u;
          out.yaw = null; // the head stays where it is
          out.floorId = seat.floorId ?? 'lower';
          return out;
        },
        veil: () => 0,
      }, null, 'standing');
      return true;
    },
    clearance() {
      return walkClearance(ensureSpace().grid, { ...watch.eyeLocal, floorId: walk.floorId });
    },
    seatAt(u, v) {
      if (!watch.active || !Number.isFinite(u) || !Number.isFinite(v)) return null;
      return seatOnRay(ensureSpace().blockers, watch.eyeLocal, rayAt(u, v), { upper: ensureSpace().grid.upper });
    },
    /**
     * The décor on offer, when the pointer at NDC (u, v) is on it (pier): a
     * click on the piece itself opens its card, as a click on a chair sits.
     */
    decorAt(u, v) {
      const offer = walk.inspectOffer, item = offer && INSPECTABLES.find((i) => i.id === offer.id);
      if (!item || !watch.active || !Number.isFinite(u) || !Number.isFinite(v)) return null;
      return rayBox(watch.eyeLocal, rayAt(u, v), item.bounds.min, item.bounds.max) < Infinity ? item.id : null;
    },
    update(dt, now) {
      if (!watch.active || !watch.validated) return; // nothing walks before the floor is validated
      ensureSpace();
      if (++reducedFrames >= 30) {
        reducedFrames = 0;
        reduced = prefersReducedMotion();
      }
      if (glide) {
        stepGlide(dt);
        return;
      }
      if (watch.posture !== 'standing') {
        walk.bob.x = walk.bob.y = 0;
        walk.speed = 0;
        walk.inspectOffer = walk.inspecting = null;
        return;
      }
      stepWalk(dt, now);
    },
  };

  /** The room-local ray under NDC (u, v) through the live camera (click-a-chair, click-the-décor). */
  function rayAt(u, v) {
    const camera = runtime.camera;
    const tanV = Math.tan(((camera?.fov ?? fovForMag(watch.optics?.mag ?? 1)) * DEG) / 2);
    const d = ndcDirection(watch.yaw, watch.pitch, u, v, tanV * (camera?.aspect || 16 / 9), tanV, {});
    // The ray's rendered pitch into the room's metres: the scene stretches the
    // horizontal by the site scale k and TRUE_SCALE renders it at k0, so
    // tan(room pitch) = (k / k0) * tan(rendered pitch).
    const k = watch.frame?.k || 1, k0 = getTrueScaleK() || 1;
    const pitch = Math.atan((k / k0) * Math.tan(d.pitch));
    return { x: -Math.sin(d.yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(d.yaw) * Math.cos(pitch) };
  }
  /** A move input changed (keys or stick): the rules a stride starts with. */
  function onMoveInput() {
    const moving = keys.forward !== 0 || keys.right !== 0;
    if (moving) walk.closeInspect();
    if (moving && watch.binocular) watch.binoculars(false);
    if (moving && watch.posture === 'seated' && !glide) walk.stand();
    return true;
  }
  function reset() {
    glide = null;
    glideT = 0;
    glideSeat = null;
    after = null;
    keys.forward = keys.right = 0;
    keys.run = false;
    keys.amount = 1;
    vel.x = vel.z = 0;
    walk.speed = 0;
    walk.bob.x = walk.bob.y = 0;
    walk.veil = 0;
    walk.inspectOffer = walk.inspecting = null;
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
    walk.floorId = seat.floorId ?? 'lower';
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
    return { x: e.x, y: e.y, z: e.z, floorId: walk.floorId, yaw: watch.yaw, pitch: watch.pitch, seatId: watch.posture === 'seated' ? watch.seatId : null };
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
    walk.inspectOffer = walk.inspecting = null;
    watch.posture = 'gliding';
    watch.sitPrompt = null;
    watch.publish?.();
  }
  function stepGlide(dt) {
    glideT = Math.min(glide.duration, glideT + dt);
    glide.sample(glideT, pose);
    setEye(pose.x, pose.y, pose.z);
    if (pose.floorId) walk.floorId = pose.floorId;
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
    // Landed in a seat with a move key still held: the key stands you up, as it would have seated.
    if (watch.posture === 'seated' && (keys.forward || keys.right)) walk.stand();
  }
  function stepWalk(dt, now) {
    const e = watch.eyeLocal;
    e.y = WALK.eyeStandM + floorHeight(space.grid, e.x, e.z, walk.floorId);
    // Target velocity in the head's yaw frame (room-local; yaw 0 faces -Z).
    let fx = 0, fz = 0;
    if (!watch.binocular && (keys.forward || keys.right)) {
      const yaw = watch.yaw, s = Math.sin(yaw), c = Math.cos(yaw);
      fx = -s * keys.forward + c * keys.right;
      fz = -c * keys.forward - s * keys.right;
      const n = Math.hypot(fx, fz) || 1;
      const speed = (keys.run ? WALK.runMps : WALK.speedMps) * keys.amount;
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
    const x0 = e.x, y0 = e.y, z0 = e.z;
    if (vel.x || vel.z) {
      let dx = vel.x * dt, dz = vel.z * dt;
      const stair = space.grid.upper?.stair;
      if (stair && (walk.floorId === 'stairs' || (e.x >= stair.x0 && e.x <= stair.x1))) {
        // Walking speed is distance along the stair, not its horizontal
        // projection. Climbing never grants a speed boost or extra bob.
        const touchesRamp = Math.max(e.z, e.z + dz) > stair.z0 && Math.min(e.z, e.z + dz) < stair.z1;
        const horizontal = Math.hypot(dx, dz), dy = touchesRamp ? dz * space.grid.upper.floorY / (stair.z1 - stair.z0) : 0;
        const scale = horizontal / (Math.hypot(horizontal, dy) || 1);
        dx *= scale; dz *= scale;
      }
      moveWithCollision(space.grid, { ...e, floorId: walk.floorId }, dx, dz, moved);
      e.x = moved.x;
      e.z = moved.z;
      if (moved.floorId) walk.floorId = moved.floorId;
      e.y = WALK.eyeStandM + floorHeight(space.grid, e.x, e.z, walk.floorId);
    }
    const step = Math.hypot(e.x - x0, e.y - y0, e.z - z0);
    walk.speed = dt > 0 ? step / dt : 0;
    if (space.variant !== 'pier') {
      // Bob and footsteps from the distance actually walked.
      phase += (Math.PI * step) / WALK.bob.strideM;
      walkBob(phase, walk.speed, reduced, walk.bob);
      const k = Math.floor(phase / Math.PI);
      if (k !== stepIndex) {
        stepIndex = k;
        if (walk.speed > 0.3) runtime.airportAudio?.cue?.('step');
      }
    } else stepPier(e, Math.hypot(e.x - x0, e.z - z0), step);
    stepInspect(e);
    // The seat on offer.
    const prompt = sitPrompt(space.seats, e, watch.yaw);
    if ((prompt?.id ?? null) !== (watch.sitPrompt?.id ?? null)) {
      watch.sitPrompt = prompt;
      watch.publish?.();
    } else if (prompt) watch.sitPrompt = prompt;
  }
  /**
   * The pier's bob and footsteps. Off the stair flight this is the flat walk
   * (a footfall per 0.72 m walked, walkBob). On the flight a footfall comes
   * every tread pair of horizontal travel, and the bob's vertical becomes the
   * stepped lift (low at each footfall, scaled with walking speed like the
   * bob); both blend in over the first tread pair and out over the last, so
   * the phase and the camera stay continuous. Each footfall names its surface.
   */
  function stepPier(e, horizontal, step) {
    const w = stairWeight(walk.floorId, e.z);
    phase += Math.PI * ((1 - w) * (step / WALK.bob.strideM) + w * (horizontal / LOUNGE_FEEL.stair.strideM));
    walkBob(phase, walk.speed, reduced, walk.bob);
    if (w > 0) {
      const lift = reduced ? 0 : stairLift(phase / Math.PI) * Math.min(1, walk.speed / WALK.speedMps);
      walk.bob.y = (1 - w) * walk.bob.y + w * lift;
    }
    const k = Math.floor(phase / Math.PI);
    if (k !== stepIndex) {
      stepIndex = k;
      if (walk.speed > 0.3) runtime.airportAudio?.cue?.('step', { surface: footstepSurface(walk.floorId, e.x, e.z, space.built) });
    }
  }
  /**
   * The décor on offer (pier; nothing is ever offered in the classic room):
   * re-read every standing frame, so it follows the eye, the head and the
   * stillness the instant they change. The binoculars and the seat menu put
   * it away (an instrument closes it as it opens).
   */
  function stepInspect(e) {
    if (space.variant !== 'pier' || watch.binocular || watch.seatMenu) {
      walk.inspectOffer = walk.inspecting = null;
      return;
    }
    const offer = inspectOffer({ eye: e, yaw: watch.yaw, floorId: walk.floorId, speed: walk.speed, built: space.built, blockers: space.blockers });
    // Keep the published object while the same piece stays on offer (the HUD polls it).
    if ((offer?.id ?? null) !== (walk.inspectOffer?.id ?? null)) walk.inspectOffer = offer;
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
export function walkableAt(x, z, variant = 'classic', floorId = 'lower') {
  const grid = walkSpace(variant).grid;
  return isFree(grid.layers?.[floorId] ?? grid, x, z);
}

