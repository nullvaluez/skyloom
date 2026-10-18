// Observation lounge — the pier room's feel, as pure functions (LOUNGE_PIER).
//
// The LIFE lane of the second-level pass (FLY_LOUNGE_SECOND_LEVEL.md): what a
// footstep lands on, how the stair moves the eye, how the room sounds on each
// floor, which piece of décor is on offer for a closer look, and how the seat
// menu groups its chairs. The walk runtime, the soundscape and the HUD read
// these; nothing here touches three, the DOM or audio. Pier variant only:
// every caller gates on it, so the classic room is unchanged.
//
// Shared positions come from upper-dressing.mjs (the frozen W0 contract);
// tunables from LOUNGE_FEEL (observation-config.js).
import { LOUNGE_FEEL, LOUNGE_PIER_ROOM } from '../observation-config.js';
import { INSPECTABLES, surfaceAt } from './upper-dressing.mjs';
import { rayBox, stationLineClear } from './observatory-stations.mjs';

const STAIR = LOUNGE_PIER_ROOM.upper.stair;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// Footsteps
// ---------------------------------------------------------------------------
/**
 * The surface under a footfall: 'stone' | 'oak' | 'rug' | 'tread'. The stair
 * layer (room-walk.mjs) reaches a little past the flight at both ends, and
 * those run-ins are flat floor: the travertine below, the oak landing above.
 * `built` is roomDressing('pier'): a contracted rug counts once it is built.
 */
export function footstepSurface(floorId, x, z, built = []) {
  const layer = floorId === 'stairs' ? (z < STAIR.z0 ? 'lower' : z > STAIR.z1 ? 'upper' : 'stairs') : floorId;
  return surfaceAt(layer, x, z, built);
}

// ---------------------------------------------------------------------------
// The stair: cadence and the stepped lift
// ---------------------------------------------------------------------------
const RISE = LOUNGE_FEEL.stair.riseFrac;
const MEAN = 0.5 - RISE / 2;
// One footfall's deviation from the continuous ramp, u in [0, 1): low at the
// footfall, an eased rise over the first `riseFrac` of the stride (the leg
// straightening onto the next tread pair), then the ramp catches up while the
// eye holds. Zero mean, so the average eye stays on the ramp; periodic and C1
// across footfalls (both ends sit at -MEAN with slope -1).
const rawLift = (u) => smooth(u / RISE) - u - MEAN;
const PEAK = (() => {
  let m = 0;
  for (let i = 0; i <= 4000; i++) m = Math.max(m, Math.abs(rawLift(i / 4000)));
  return m;
})();
/**
 * The camera-only stepped lift at a footfall phase (`strides` = footfalls
 * walked, fractional), metres, peak LOUNGE_FEEL.stair.liftM. Direction-free:
 * the same profile reads as eased steps up the flight and down it.
 */
export function stairLift(strides) {
  const u = strides - Math.floor(strides);
  return (LOUNGE_FEEL.stair.liftM * rawLift(u)) / PEAK;
}
/**
 * How much of the stair's cadence and lift applies at z on a walk layer:
 * 0 off the flight (and on its flat run-ins), easing to 1 over the first
 * tread pair and back to 0 over the last, so nothing pops at either end.
 */
export function stairWeight(floorId, z) {
  if (floorId !== 'stairs') return 0;
  const s = LOUNGE_FEEL.stair.strideM;
  return smooth((z - STAIR.z0) / s) * smooth((STAIR.z1 - z) / s);
}

// ---------------------------------------------------------------------------
// Ambience
// ---------------------------------------------------------------------------
/** 0 on the lower floor, 1 upstairs, smooth over the stair (from the eye's room-local height). */
export function upstairsFactor(eyeY) {
  const A = LOUNGE_FEEL.ambience;
  return Number.isFinite(eyeY) ? smooth((eyeY - A.lowerEyeM) / (A.upperEyeM - A.lowerEyeM)) : 0;
}

// ---------------------------------------------------------------------------
// Inspectable décor
// ---------------------------------------------------------------------------
const inBox = (x, z, b) => x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2];
/**
 * The décor's line of sight: the eye to the nearest point of its box at its
 * focus height, against the walk blockers of its own floor (the same oriented
 * boxes stationLineClear uses for the instruments, and the intermediate deck).
 * The piece's own furniture (a blocker centred inside its box) never hides it,
 * and the stair's handrails are left out: their collision boxes span the whole
 * flight's height, while the prints hang well above the rails (the contract
 * keeps every frame >= 0.25 m clear of them).
 */
export function decorLineClear(item, eye, blockers = []) {
  const b = item.bounds;
  const target = { x: clamp(eye.x, b.min[0], b.max[0]), y: item.focus[1], z: clamp(eye.z, b.min[2], b.max[2]) };
  const own = blockers.filter((k) => (k.floorId ?? 'lower') === item.floorId && !inBox(k.c[0], k.c[1], b) && !(k.kind === 'rail' && k.floorId === 'stairs'));
  return stationLineClear({ kind: 'decor', variant: 'pier', position: item.focus }, eye, target, own);
}

/**
 * One piece of décor's state for the eye. Offered when its dressing is built,
 * from its own walk layer, within its reach of its box, nearly still, facing
 * it and in clear sight. Facing: the head (its yaw, at the piece's focus
 * height) looks straight at its box, or within LOUNGE_FEEL.inspect.facingDeg
 * of its nearest point, or of its focus while that is within reach too (a
 * long piece, the stair's prints, is not on offer just because its middle lies
 * up the flight ahead of you).
 */
export function inspectState(item, { eye, yaw = 0, floorId = 'lower', speed = 0, built = [], blockers = [] }) {
  const F = LOUNGE_FEEL.inspect, b = item.bounds;
  const isBuilt = built.includes(item.dressingId);
  const onFloor = floorId === item.floorId;
  const nx = clamp(eye.x, b.min[0], b.max[0]), nz = clamp(eye.z, b.min[2], b.max[2]);
  const distanceM = Math.hypot(eye.x - nx, eye.z - nz);
  const inReach = distanceM <= item.reachM;
  const still = speed < F.stillMps;
  const cone = (F.facingDeg * Math.PI) / 180;
  const off = (x, z) => Math.abs(wrap(Math.atan2(-(x - eye.x), -(z - eye.z)) - yaw));
  const focusNear = Math.hypot(item.focus[0] - eye.x, item.focus[2] - eye.z) <= item.reachM;
  const facing = rayBox({ x: eye.x, y: item.focus[1], z: eye.z }, { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) }, b.min, b.max) < Infinity
    || (distanceM > 1e-6 && off(nx, nz) <= cone) || (focusNear && off(item.focus[0], item.focus[2]) <= cone);
  const ready = isBuilt && onFloor && inReach && still && facing;
  const clear = ready && decorLineClear(item, eye, blockers);
  return { id: item.id, built: isBuilt, onFloor, inReach, still, facing, clear, offered: ready && clear, distanceM };
}

/** The piece on offer (the nearest one that is), as { id, label, prompt, text, distanceM }, or null. */
export function inspectOffer(context, items = INSPECTABLES) {
  let best = null;
  for (const item of items) {
    const s = inspectState(item, context);
    if (s.offered && (!best || s.distanceM < best.distanceM)) best = { id: item.id, label: item.label, prompt: item.prompt, text: item.text, distanceM: s.distanceM };
  }
  return best;
}

/**
 * Whether the décor has the floor: standing, with nothing raised or open, and
 * no chair or instrument within reach claiming Enter (one prompt at a time).
 * `w` is the live watch, `obs` the observatory snapshot (null without the
 * instruments). The HUD's prompt and the Enter key both ask this.
 */
export function decorTurn(w, obs = null) {
  return !!w?.walk && w.posture === 'standing' && !w.binocular && !w.seatMenu && !w.sitPrompt && !obs?.active && !obs?.prompt
    && !obs?.stations?.some((s) => s.available && s.nearby && ['listen', 'support', 'compass'].includes(s.kind));
}

/**
 * What Enter / Escape do about the décor card: 'open' | 'close' | null.
 * Escape closes an open card first. Enter closes it too, unless focus is on
 * one of the card's own controls (that control answers Enter itself); with no
 * card open, Enter opens the piece on offer when nothing else claims the key.
 */
export function inspectKeyAction(key, { open = false, offer = null, onControl = false, blocked = false } = {}) {
  if (key === 'Escape') return open ? 'close' : null;
  if (key !== 'Enter') return null;
  if (open) return onControl ? null : 'close';
  return offer && !blocked && !onControl ? 'open' : null;
}

// ---------------------------------------------------------------------------
// The seat menu and the place label
// ---------------------------------------------------------------------------
const FLOOR_LABEL = Object.freeze({ lower: 'Lower lounge', upper: 'Upper room' });
/** The seats grouped by floor, lower first ([{ id, label, seats }]), or null when they share one floor. */
export function seatGroups(seats = []) {
  const floors = [...new Set(seats.map((s) => s.floorId ?? 'lower'))].sort((a, b) => (a === 'lower' ? -1 : b === 'lower' ? 1 : 0));
  if (floors.length < 2) return null;
  return floors.map((id) => ({ id, label: FLOOR_LABEL[id] ?? id, seats: seats.filter((s) => (s.floorId ?? 'lower') === id) }));
}

/**
 * Where you stand in the pier room, for the header: the stair and each
 * floor by name (seated and gliding read as before).
 */
export function pierPlace(floorId) {
  return floorId === 'upper' ? 'Upper observation room' : floorId === 'stairs' ? 'Staircase' : 'Lower lounge';
}
