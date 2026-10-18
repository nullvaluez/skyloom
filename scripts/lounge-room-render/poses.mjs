// Named room-local poses for the room-only render harness
// (scripts/render-lounge-room.cjs). Shared by the node driver (names,
// availability) and the page (camera placement). Room-local metres, the
// LOUNGE_ROOM frame: +X right (east), +Z toward the back wall, -Z toward the
// runway glass; yaw 0 faces -Z.
//
// A pose is either a vantage SEAT (its exact VANTAGE eye, look centre and
// default pitch) or a standing EYE with a TARGET point. Standing eyes are
// WALK.eyeStandM (1.65 m) above the floor they stand on: 0 downstairs, the
// stair ramp's height on the stair, LOUNGE_PIER_ROOM.upper.floorY upstairs.
import { VANTAGE, WALK, LOUNGE_PIER_ROOM } from '../../lib/fly/observation-config.js';

const U = LOUNGE_PIER_ROOM.upper;
const UP = U.floorY;
const STAND = WALK.eyeStandM;
/** The stair's walking height at z (lib/fly/lounge/room-walk.mjs floorHeight). */
const rampY = (z) => UP * Math.max(0, Math.min(1, (z - U.stair.z0) / (U.stair.z1 - U.stair.z0)));

export const POSES = Object.freeze([
  { name: 'lower-front-seat', variants: ['pier', 'classic'], seat: 'window', note: 'the default view: the window seat' },
  { name: 'lower-back-seat', variants: ['pier'], seat: 'back', note: 'the rear window seat' },
  { name: 'lower-mid-wide', variants: ['pier', 'classic'], eye: [8.4, STAND, 1.4], target: [-9.0, 2.6, 10.5], note: 'front-right corner looking back-left across the lounge' },
  {
    name: 'bar', variants: ['pier', 'classic'], eye: [5.9, STAND, 8.9], target: [10.6, 1.4, 7.0], note: 'standing at the right-wall bar',
    classic: { eye: [0.5, STAND, 8.6], target: [0, 1.6, 13.5] },
  },
  { name: 'stair-side', variants: ['pier'], eye: [-4.6, STAND, 4.6], target: [-10.2, 2.4, 8.4], note: 'the stair seen from the lower lounge' },
  { name: 'stair-foot', variants: ['pier'], eye: [-10.0, STAND, 2.3], target: [-10.0, UP + 1.2, 11.6], note: 'bottom landing looking up the flight' },
  { name: 'stair-mid', variants: ['pier'], eye: [-10.0, STAND + rampY(7.4), 7.4], target: [-9.6, UP + 1.5, 13.2], note: 'halfway up' },
  { name: 'top-landing', variants: ['pier'], eye: [-9.8, UP + STAND, 11.95], target: [2.0, UP + 1.3, 10.6], note: 'top landing looking east into the upper room' },
  { name: 'upper-landing-down', variants: ['pier'], eye: [-10.0, UP + STAND, 12.4], target: [-10.0, 1.2, 3.0], note: 'top of the flight looking down' },
  { name: 'upper-wide-from-landing', variants: ['pier'], eye: [-8.3, UP + STAND, 13.4], target: [10.5, UP + 0.9, 8.6], note: 'the whole upper room from its west end' },
  { name: 'upper-front-seat', variants: ['pier'], seat: 'upper-front', note: 'upper runway seat' },
  { name: 'upper-back-seat', variants: ['pier'], seat: 'upper-back', note: 'upper rear seat' },
  { name: 'upper-east', variants: ['pier'], eye: [2.6, UP + STAND, 11.2], target: [8.9, UP + 0.75, 10.95], note: 'toward the credenza and the east glazing' },
  { name: 'upper-west', variants: ['pier'], eye: [5.0, UP + STAND, 11.4], target: [-9.6, UP + 0.9, 10.2], note: 'toward the stairwell, guard and landing' },
]);

/**
 * The camera for a pose in a variant: { eye:[x,y,z], dir:[x,y,z] (unit),
 * seatId|null, upper:boolean }, or null when the pose does not exist there.
 */
export function resolvePose(name, variant = 'pier') {
  const pose = POSES.find((p) => p.name === name);
  if (!pose || !pose.variants.includes(variant)) return null;
  const spec = { ...pose, ...(pose[variant] ?? {}) };
  if (spec.seat) {
    const seat = (VANTAGE[variant] ?? []).find((s) => s.id === spec.seat);
    if (!seat) return null;
    const yaw = seat.look.centre, pitch = seat.look.defaultPitch;
    const dir = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    return { name, eye: [...seat.eye], dir, seatId: seat.id, upper: (seat.floorY ?? 0) > 0, note: spec.note };
  }
  const d = spec.target.map((v, i) => v - spec.eye[i]);
  const l = Math.hypot(...d);
  return { name, eye: [...spec.eye], dir: d.map((v) => v / l), seatId: null, upper: spec.eye[1] >= UP + 0.5, note: spec.note };
}

export const POSE_NAMES = POSES.map((p) => p.name);
