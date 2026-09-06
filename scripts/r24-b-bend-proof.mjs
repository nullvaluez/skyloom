/**
 * R24 B WORLD — BEND_LEAD (recon WB-6) arithmetic gate. Pure function of the
 * constants: no browser, no GPU, no network, so it runs anywhere.
 *
 * THE DEFECT. `bendMarginM(ringAliveR, halfDiag)` pads a chunk's bounding
 * sphere by the world-bend vertical drop, modelling the worst vertex distance
 * from the player as ringR + halfDiag. But R21's lookahead centres the DESIRED
 * SET on the lead point, so a chunk is legitimately alive out to
 * (1 + STREAM_KEEPER.lookahead.maxLeadFrac)·ringR + halfDiag from the player.
 * The drop is QUADRATIC in that distance, so the pad is short by the ratio of
 * the squares — and a short pad is a chunk that is on screen and culled.
 *
 * GATES
 *  (1) RED — with BEND_LEAD off, worstDrop > padOff on at least one ring
 *      (i.e. the false-cull window is open on the flag-off tree).
 *  (2) GREEN — with BEND_LEAD on, padOn >= worstDrop on EVERY ring.
 *  (3) SAFETY — the pad only ever grows (it can never drop geometry that the
 *      R21 pad kept).
 *  (4) POOLS — the pooled layers' stale-maxD lead is >= one cadence at the
 *      fleet's fastest airframe.
 */
import {
  BEND_LEAD,
  GLOBE,
  SAT_BUILDINGS,
  SAT_ROADS,
  SAT_SKYLINE,
  STREAM_KEEPER,
  TOY_WORLD,
  FLIGHT,
  SAT_VEG,
} from '../lib/fly/fly-constants.js';

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const halfDiag = (z, groupN = 1) => ((WORLD_SIZE / 2 ** z) * groupN * Math.SQRT2) / 2;

const LEAD = STREAM_KEEPER.lookahead.maxLeadFrac;
const PAD = STREAM_KEEPER.bendMargin.pad;
const kSat = 1 / (2 * GLOBE.bendRadiusM.satellite);
const kToy = 1 / (2 * GLOBE.bendRadiusM.toy);

// The toy 'ultra' ring radius is DYNAMIC: max(far ring, edgeFade.endM × slack).
// verify-neon-alt's certified FL260 pose measures the band at 81.5 km, so the
// worst-case radius quoted here is that band × slack — the same number the
// engine records on a chunk as `ringR` at that altitude.
const ULTRA_R = Math.max(
  TOY_WORLD.rings[TOY_WORLD.rings.length - 1].r,
  81500 * (TOY_WORLD.ultraRing?.slack ?? 1.1)
);
const RINGS = [
  ['sat-buildings z14', SAT_BUILDINGS.ring.r, halfDiag(SAT_BUILDINGS.ring.z), kSat, 0],
  ['sat-roads z13', SAT_ROADS.ring.r, halfDiag(SAT_ROADS.ring.z), kSat, 0],
  ['sat-skyline z14×g', SAT_SKYLINE.ring.r, halfDiag(SAT_SKYLINE.ring.z, SAT_SKYLINE.groupN), kSat, SAT_SKYLINE.cullMarginM],
  ...TOY_WORLD.rings.map((r) => [`toy ${r.detail} z${r.z}`, r.r, halfDiag(r.z), kToy, 0]),
  ['toy ultra z10', ULTRA_R, halfDiag(TOY_WORLD.ultraRing.z), kToy, 0],
];

let fails = 0;
let redSeen = 0;
const gate = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fails++;
};

console.log(`maxLeadFrac ${LEAD} · pad ${PAD} · BEND_LEAD.enabled ${BEND_LEAD.enabled}\n`);
console.log('ring                   ringR   halfDiag   padOFF     padON    worstDrop   deficitOFF');
for (const [name, r, hd, k, floor] of RINGS) {
  const padOff = Math.max(floor, (r + hd) ** 2 * k * PAD);
  const padOn = Math.max(floor, (r * (1 + LEAD) + hd) ** 2 * k * PAD);
  const worst = (r * (1 + LEAD) + hd) ** 2 * k; // the real drop at the alive edge
  const deficit = worst - padOff;
  console.log(
    `${name.padEnd(20)} ${String(Math.round(r)).padStart(7)} ${String(Math.round(hd)).padStart(9)} ` +
      `${String(Math.round(padOff)).padStart(8)} ${String(Math.round(padOn)).padStart(9)} ` +
      `${String(Math.round(worst)).padStart(10)} ${String(Math.round(deficit)).padStart(11)}`
  );
  if (deficit > 0) redSeen++;
  gate(`(2) GREEN ${name}: padON covers the worst lead-edge drop`, padOn >= worst - 1e-6, `${Math.round(padOn)} >= ${Math.round(worst)}`);
  gate(`(3) SAFETY ${name}: the pad only grows`, padOn >= padOff - 1e-6);
}
gate('(1) RED: at least one ring false-culls with BEND_LEAD off', redSeen > 0, `${redSeen} of ${RINGS.length} rings short`);

const cadence = SAT_VEG.placeCadenceSec ?? 2;
const vmax = FLIGHT.bars?.maxSpeedMps ?? 750;
gate(
  '(4) POOLS: poolLeadM covers one placement cadence at fleet max speed',
  BEND_LEAD.poolLeadM >= cadence * vmax - 1e-6,
  `${BEND_LEAD.poolLeadM} m >= ${cadence} s × ${vmax} m/s = ${cadence * vmax} m`
);

console.log(`\nVERIFY: ${fails ? 'FAIL' : 'PASS'}`);
process.exit(fails ? 1 : 0);
