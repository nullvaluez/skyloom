// The airport set around an observation lounge: terminal massing, the apron
// and its stands, in the lounge's room-local frame (lib/fly/lounge-site.js).
// Pure data. The AIRFIELD workstream owns the builders that turn it into
// meshes (lib/fly/airport-set/*); the FLEET workstream places parked aircraft
// on `stands`.
//
// This is the procedural default: a straight pier under the lounge, a
// head-of-stand service road along its airside face, nose-in stands beyond
// that road, then a tail-of-stand road and the apron taxilane. Real OSM
// gates/aprons, when the airport has them, may replace the stand list, but the
// record shape below is the contract.
//
// WHY THE NOSES STOP ~20 m OUT. The seated eye looks down at roughly 10-41
// degrees through the canted glass (FLY_OBSERVATION_LOUNGE.md). With the nose
// 6 m off the facade (the W0 stub) every nose, bridge cab and turnaround
// vehicle sat under the lounge's own floor slab. A real head-of-stand road
// plus nose clearance puts the docked bridges and the servicing equipment in
// the band the observer actually sees.
import { LOUNGE_ROOM } from './observation-config.js';
import { siteToWorld } from './lounge-site.js';

/**
 * Stand size classes: wingspan limit, fuselage length budget and stand pitch
 * (metres), plus the representative boarding doors a jet bridge docks at
 * (`aft` = metres behind the nose, `half` = half fuselage width, `sill` =
 * door sill above the apron). regional ~ E175/CRJ, narrow ~ A320/737,
 * wide ~ 777/A350 (whose second bridge serves door 2).
 */
export const STAND_CLASS = Object.freeze({
  regional: Object.freeze({ span: 30, length: 32, pitch: 40, door: Object.freeze({ aft: 3.6, half: 1.4, sill: 1.9 }) }),
  narrow: Object.freeze({ span: 36, length: 45, pitch: 48, door: Object.freeze({ aft: 5.2, half: 2.0, sill: 3.4 }) }),
  wide: Object.freeze({
    span: 65, length: 76, pitch: 80,
    door: Object.freeze({ aft: 8.6, half: 3.1, sill: 4.9 }),
    door2: Object.freeze({ aft: 21.5, half: 3.1, sill: 5.1 }),
  }),
});

/**
 * Terminal size class by lounge floor height (the site's runway class).
 * roadM: head-of-stand road width; noseM: facade-to-nose distance; tailRoadM:
 * the service road behind the stands (0 = none); bridges: jet bridges at
 * gates (small fields board by stairs).
 */
export const SET_SIZE = Object.freeze({
  big: Object.freeze({ halfLength: 300, depth: 70, roadM: 10, noseM: 24, tailRoadM: 8, bridges: true }),
  mid: Object.freeze({ halfLength: 170, depth: 46, roadM: 9, noseM: 20, tailRoadM: 7, bridges: true }),
  small: Object.freeze({ halfLength: 70, depth: 28, roadM: 7, noseM: 14, tailRoadM: 0, bridges: false }),
});

export function setSizeOf(site) {
  return site.floorM >= 20 ? 'big' : site.floorM >= 14 ? 'mid' : 'small';
}

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/**
 * Layout for a resolved lounge site. Every position is room-local metres
 * (x right, z toward the lounge's back, -z toward the runway) plus the
 * absolute scene position and a compass heading (0 = north, clockwise; the
 * traffic `yaw` convention) for things that face somewhere.
 *
 * {
 *   terminal: { x0, x1, z0, z1, roofY },     // pier massing (roofY = height above apron)
 *   apron:    { x0, x1, z0, z1 },            // the concrete in front of the pier
 *   stands:   [{ id, cls, x, z, wx, wz, heading, noseZ }],
 *   floorM:   site.floorM,                   // lounge floor above the apron
 * }
 *
 * Stand x/z is the parked aircraft's fuselage midpoint for the class length
 * budget; `noseZ` is the stop line the nose sits on (bridges dock relative to
 * it, see STAND_CLASS.door). Additive fields: `size` (SET_SIZE key) and
 * `lanes` (the service-road and taxilane lines the set builders share).
 */
export function airportLayout(site) {
  if (!site) return null;
  const size = setSizeOf(site);
  const S = SET_SIZE[size];
  const big = size === 'big', mid = size === 'mid';
  const facadeZ = LOUNGE_ROOM.glass.baseZ - 0.4; // the pier's airside face, under the lounge glass
  const halfLength = S.halfLength;
  const terminal = { x0: -halfLength, x1: halfLength, z0: facadeZ, z1: facadeZ + S.depth, roofY: Math.max(6, site.floorM - 4) };
  const noseZ = facadeZ - S.noseM;
  const stands = [];
  const rand = hash(site.airportId);
  // Wide stands flank the lounge at big airports; the middle stays narrow so
  // the view straight out is never a tail fin.
  for (let x = -halfLength + 30, n = 0; x <= halfLength - 30; n++) {
    const wide = big && Math.abs(x) > 120 && ((rand >>> (n % 24)) & 1) === 1;
    const cls = wide ? 'wide' : mid || big ? 'narrow' : 'regional';
    const c = STAND_CLASS[cls];
    const sx = x + c.pitch / 2;
    if (sx + c.pitch / 2 > halfLength) break;
    const z = noseZ - c.length / 2;
    const w = siteToWorld(site, sx, z);
    const toPier = siteToWorld(site, sx, z + 1);
    // Nose-in: the aircraft faces the pier (+z, room-local).
    const heading = Math.atan2(toPier.x - w.x, -(toPier.z - w.z));
    stands.push({ id: `${site.ident}-S${n + 1}`, cls, x: sx, z, wx: w.x, wz: w.z, heading, noseZ });
    x += c.pitch;
  }
  // Behind the deepest tail: the tail-of-stand road, then the taxilane whose
  // wingtip clearance is the largest stand's half span plus 7.5 m.
  const maxClass = STAND_CLASS[stands.some((s) => s.cls === 'wide') ? 'wide' : stands[0]?.cls ?? 'narrow'];
  const tailZ = noseZ - maxClass.length;
  const clear = maxClass.span / 2 + (size === 'small' ? 5 : 7.5);
  const tailRoad = S.tailRoadM > 0 ? { z0: tailZ - 3 - S.tailRoadM, z1: tailZ - 3 } : null;
  const taxilaneZ = (tailRoad ? tailRoad.z0 : tailZ) - clear;
  const apron = { x0: -halfLength - 40, x1: halfLength + 40, z0: taxilaneZ - clear, z1: facadeZ };
  const lanes = {
    road: { z0: facadeZ - 1.5 - S.roadM, z1: facadeZ - 1.5 }, // head-of-stand road
    tailRoad,
    taxilaneZ,
    noseZ,
  };
  return { terminal, apron, stands, floorM: site.floorM, size, lanes };
}
