// The airport set around an observation lounge: terminal massing, the apron
// and its stands, in the lounge's room-local frame (lib/fly/lounge-site.js).
// Pure data. The AIRFIELD workstream owns the builders that turn it into
// meshes; the FLEET workstream places parked aircraft on `stands`.
//
// This is the procedural default (a straight pier under the lounge). Real OSM
// gates/aprons, when the airport has them, may replace the stand list, but
// the record shape below is the contract.
import { LOUNGE_ROOM } from './observation-config.js';
import { siteToWorld } from './lounge-site.js';

/** Stand size classes: wingspan limit and the fuselage length budget, metres. */
export const STAND_CLASS = Object.freeze({
  regional: { span: 30, length: 32, pitch: 40 },
  narrow: { span: 36, length: 45, pitch: 48 },
  wide: { span: 65, length: 76, pitch: 80 },
});

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
 */
export function airportLayout(site) {
  if (!site) return null;
  const big = site.floorM >= 20, mid = site.floorM >= 14;
  const facadeZ = LOUNGE_ROOM.glass.baseZ - 0.4; // the pier's airside face, under the lounge glass
  const halfLength = big ? 300 : mid ? 170 : 70;
  const depth = big ? 70 : mid ? 46 : 28;
  const terminal = { x0: -halfLength, x1: halfLength, z0: facadeZ, z1: facadeZ + depth, roofY: Math.max(6, site.floorM - 4) };
  const apronDepth = big ? 125 : mid ? 95 : 60;
  const apron = { x0: -halfLength - 40, x1: halfLength + 40, z0: facadeZ - apronDepth, z1: facadeZ };
  const stands = [];
  const rand = hash(site.airportId);
  // Wide stands flank the lounge at big airports; the middle stays narrow so
  // the view straight out is never a tail fin.
  for (let x = -halfLength + 30, n = 0; x <= halfLength - 30; n++) {
    const wide = big && Math.abs(x) > 120 && ((rand >>> (n % 24)) & 1) === 1;
    const cls = wide ? 'wide' : mid ? 'narrow' : 'regional';
    const c = STAND_CLASS[cls];
    const sx = x + c.pitch / 2;
    if (sx + c.pitch / 2 > halfLength) break;
    // Nose-in: the nose stops 6 m off the facade, the aircraft faces the pier.
    const noseZ = facadeZ - 6;
    const z = noseZ - c.length / 2;
    const w = siteToWorld(site, sx, z);
    const toPier = siteToWorld(site, sx, z + 1);
    const heading = Math.atan2(toPier.x - w.x, -(toPier.z - w.z));
    stands.push({ id: `${site.ident}-S${n + 1}`, cls, x: sx, z, wx: w.x, wz: w.z, heading, noseZ });
    x += c.pitch;
  }
  return { terminal, apron, stands, floorM: site.floorM };
}
