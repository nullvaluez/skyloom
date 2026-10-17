// The terminal pier under the observation lounge: apron (service) level with
// loading bays and personnel doors, a full-height curtain-wall gate level, a
// deep airside eave, a roofscape (clerestory spine, skylights, plant
// compounds, photovoltaic rows, parapets), finished pier ends with stair
// cores, and the pavilion base the lounge sits on.
//
// Seen from the seat, the ROOF is the pier's largest visible surface (the
// airside facade faces away from an eye that sits behind it), so the
// roofscape gets most of the geometric detail; the facades rely on the
// material's analytic mullions and interior so they hold up from outside.
import { GLOW, SURF } from './mesh-writer.js';
import { setRandom } from './plan.js';

// Walls, plinths and columns run this far below the apron plane, so the
// building never floats where the real ground dips under it (the DEM is not
// flat to the centimetre; see ground.js).
const BELOW = -2.5;

const COLORS = {
  concrete: '#bdb8ae',
  concreteDark: '#8d8a84',
  cladding: '#c9cdd0',
  claddingDark: '#5e666c',
  bronze: '#3a3530',
  mullion: '#8e959a',
  glass: '#1d2a31',
  membrane: '#a9aaa6',
  membraneDark: '#8f918e',
  plant: '#b7bcbd',
  plantDark: '#7e8689',
  door: '#7b8a96',
  doorDark: '#2a2f33',
  solar: '#1d2635',
  walkway: '#6f706c',
  rail: '#aeb4b6',
  yellow: '#d6a412',
};

/**
 * @param w     MeshWriter (room-local, apron-relative)
 * @param plan  planAirportSet() result
 * @param atlas planAtlas() layout (rect lookups for sign legends)
 */
export function buildTerminal(w, plan, atlas) {
  const T = plan.terminal;
  const { x0, x1, z0, z1, roofY } = T;
  const gateY = plan.gateY;
  const eave = T.eave;
  const rand = setRandom(plan.seed ^ 0x7e7);
  const small = plan.size === 'small';
  const baseZ = z0 + (small ? 0 : 1.8); // service-level wall sits back under the gate level

  // --- service (apron) level -------------------------------------------------
  if (!small) {
    // Recessed concrete wall with bays: build it in 12 m bays so doors,
    // louvres and plain panels alternate in a believable rhythm.
    const bay = 12;
    for (let x = x0; x < x1 - 1e-6; x += bay) {
      const xa = x, xb = Math.min(x1, x + bay);
      const kind = Math.floor(((xa - x0) / bay) % 4);
      w.paint(COLORS.concrete, SURF.CONCRETE, 0.86, 0);
      if (kind === 1) {
        // Loading bay: roller door between two concrete piers.
        w.box(xa, BELOW, baseZ, xa + 3.4, gateY - 0.7, baseZ + 0.6);
        w.box(xb - 3.4, BELOW, baseZ, xb, gateY - 0.7, baseZ + 0.6);
        w.box(xa + 3.4, BELOW, baseZ + 0.2, xb - 3.4, 0, baseZ + 0.6); // dock plinth under the door
        w.box(xa + 3.4, 4.2, baseZ, xb - 3.4, gateY - 0.7, baseZ + 0.6);
        w.paint(COLORS.door, SURF.RIBBED, 0.5, 0.45);
        w.box(xa + 3.4, 0, baseZ + 0.35, xb - 3.4, 4.2, baseZ + 0.5, 'pz');
        w.paint(COLORS.yellow, SURF.HAZARD, 0.6, 0);
        w.box(xa + 3.1, 0, baseZ - 0.35, xa + 3.4, 1.2, baseZ, 'pz');
        w.box(xb - 3.4, 0, baseZ - 0.35, xb - 3.1, 1.2, baseZ, 'pz');
      } else if (kind === 3) {
        // Personnel door + louvre panel.
        w.box(xa, BELOW, baseZ, xb, gateY - 0.7, baseZ + 0.6, 'nz');
        w.poly([[xa, BELOW, baseZ], [xa + 4, BELOW, baseZ], [xa + 4, gateY - 0.7, baseZ], [xa, gateY - 0.7, baseZ]], null, [0, 0, -1]);
        w.poly([[xb - 1.0, BELOW, baseZ], [xb, BELOW, baseZ], [xb, gateY - 0.7, baseZ], [xb - 1.0, gateY - 0.7, baseZ]], null, [0, 0, -1]);
        w.poly([[xa + 4, BELOW, baseZ], [xb - 1, BELOW, baseZ], [xb - 1, 0, baseZ], [xa + 4, 0, baseZ]], null, [0, 0, -1]);
        w.poly([[xa + 4, 2.6, baseZ], [xb - 1, 2.6, baseZ], [xb - 1, gateY - 0.7, baseZ], [xa + 4, gateY - 0.7, baseZ]], null, [0, 0, -1]);
        w.paint(COLORS.doorDark, SURF.PAINT, 0.55, 0.3);
        w.poly([[xa + 4, 0, baseZ + 0.05], [xa + 5.2, 0, baseZ + 0.05], [xa + 5.2, 2.4, baseZ + 0.05], [xa + 4, 2.4, baseZ + 0.05]], null, [0, 0, -1]);
        w.paint(COLORS.claddingDark, SURF.LOUVRE, 0.5, 0.5);
        w.poly([[xa + 6, 0.4, baseZ + 0.02], [xb - 1, 0.4, baseZ + 0.02], [xb - 1, 2.6, baseZ + 0.02], [xa + 6, 2.6, baseZ + 0.02]], null, [0, 0, -1]);
        w.paint(COLORS.concrete, SURF.CONCRETE, 0.86, 0);
        w.poly([[xa + 5.2, 0, baseZ], [xa + 6, 0, baseZ], [xa + 6, 2.6, baseZ], [xa + 5.2, 2.6, baseZ]], null, [0, 0, -1]);
      } else {
        w.box(xa, BELOW, baseZ, xb, gateY - 0.7, baseZ + 0.6);
      }
      // Column on the slab edge every bay (round steel, painted).
      w.paint(COLORS.cladding, SURF.PAINT, 0.45, 0.25);
      w.cylinder(xa + bay / 2, BELOW, z0 + 0.45, 0.32, gateY - 0.6 - BELOW, 12, 'none');
      w.paint(COLORS.concreteDark, SURF.CONCRETE, 0.9, 0);
      w.cbox(xa + bay / 2, 0.15, z0 + 0.45, 0.9, 0.3, 0.9);
    }
    // Gate-level slab edge: a spandrel band, then the soffit under the overhang.
    w.paint(COLORS.claddingDark, SURF.CLADDING, 0.38, 0.55);
    w.box(x0, gateY - 0.7, z0 - 0.05, x1, gateY + 0.35, baseZ, 'pz');
    w.paint(COLORS.cladding, SURF.CLADDING, 0.5, 0.3);
    w.poly([[x0, gateY - 0.7, z0 - 0.05], [x1, gateY - 0.7, z0 - 0.05], [x1, gateY - 0.7, baseZ], [x0, gateY - 0.7, baseZ]], null, [0, -1, 0]);
    // Guard rail along the building line (galvanised), broken at the bays.
    w.paint(COLORS.rail, SURF.GALV, 0.45, 0.7);
    for (let x = x0 + 2; x < x1 - 2; x += 3) w.cbox(x, 0.45, z0 + 1.0, 0.12, 0.9, 0.12);
  }

  // --- gate level: curtain wall ----------------------------------------------
  // The glazing is one long face per side; mullions, transoms, spandrels and
  // the lit concourse are the material's (SURF.CURTAIN, metre UVs).
  const gy0 = small ? 0.45 : gateY + 0.35;
  if (small) {
    w.paint(COLORS.concrete, SURF.CONCRETE, 0.86, 0);
    w.box(x0, BELOW, z0, x1, gy0, z0 + 0.5);
  }
  w.paint(COLORS.glass, SURF.CURTAIN, 0.06, 0, GLOW.INTERIOR_WARM);
  w.poly([[x1, gy0, z0], [x0, gy0, z0], [x0, roofY, z0], [x1, roofY, z0]], null, [0, 0, -1]);
  // Landside: glazing band over a concrete base.
  w.poly([[x0, gy0 + 1.5, z1], [x1, gy0 + 1.5, z1], [x1, roofY, z1], [x0, roofY, z1]], null, [0, 0, 1]);
  w.paint(COLORS.concrete, SURF.CONCRETE, 0.85, 0);
  w.poly([[x0, BELOW, z1], [x1, BELOW, z1], [x1, gy0 + 1.5, z1], [x0, gy0 + 1.5, z1]], null, [0, 0, 1]);

  // --- pier ends: glazed end walls with a stair core ----------------------------
  for (const side of [-1, 1]) {
    const xe = side < 0 ? x0 : x1;
    const out = [side, 0, 0];
    w.paint(COLORS.concrete, SURF.CONCRETE, 0.85, 0);
    w.poly([[xe, BELOW, z0], [xe, BELOW, z1], [xe, gy0, z1], [xe, gy0, z0]], null, out);
    w.paint(COLORS.glass, SURF.CURTAIN, 0.06, 0, GLOW.INTERIOR_WARM);
    w.poly([[xe, gy0, z0], [xe, gy0, z1 - 12], [xe, roofY, z1 - 12], [xe, roofY, z0]], null, out);
    // Stair/lift core proud of the end wall at the landside corner, rising above the roof.
    w.paint(COLORS.concreteDark, SURF.CONCRETE, 0.88, 0);
    const cx = xe + side * 4.2;
    w.box(cx - 4.4, BELOW, z1 - 12.5, cx + 4.4, roofY + 3.2, z1 + 0.5);
    w.paint(COLORS.glass, SURF.CURTAIN, 0.06, 0, GLOW.INTERIOR_COOL);
    w.poly([[cx + side * 4.41, 1, z1 - 11], [cx + side * 4.41, 1, z1 - 7.5], [cx + side * 4.41, roofY + 2.2, z1 - 7.5], [cx + side * 4.41, roofY + 2.2, z1 - 11]], null, out);
  }

  // --- roof ---------------------------------------------------------------------
  const ez0 = z0 - eave, ez1 = z1 + 1.2;
  // Eave/roof slab with a deep metal fascia; the soffit is lit at night.
  w.paint(COLORS.cladding, SURF.CLADDING, 0.34, 0.65);
  w.box(x0 - 1.2, roofY - 0.2, ez0, x1 + 1.2, roofY + 1.0, ez0 + 0.25); // fascia face
  w.box(x0 - 1.2, roofY - 0.2, ez1 - 0.25, x1 + 1.2, roofY + 1.0, ez1);
  w.box(x0 - 1.2, roofY - 0.2, ez0, x0 - 0.95, roofY + 1.0, ez1);
  w.box(x1 + 0.95, roofY - 0.2, ez0, x1 + 1.2, roofY + 1.0, ez1);
  w.paint('#d8d9d6', SURF.CLADDING, 0.62, 0.1, GLOW.LAMP_WHITE);
  w.poly([[x0 - 1.2, roofY - 0.2, ez0], [x1 + 1.2, roofY - 0.2, ez0], [x1 + 1.2, roofY - 0.2, z0], [x0 - 1.2, roofY - 0.2, z0]], null, [0, -1, 0]);
  // Membrane field, in strips so the lounge podium punches through cleanly.
  w.paint(COLORS.membrane, SURF.MEMBRANE, 0.92, 0);
  const pod = plan.podium;
  w.poly([[x0 - 0.95, roofY + 0.4, ez0 + 0.25], [pod.x0, roofY + 0.4, ez0 + 0.25], [pod.x0, roofY + 0.4, ez1 - 0.25], [x0 - 0.95, roofY + 0.4, ez1 - 0.25]], null, [0, 1, 0]);
  w.poly([[pod.x1, roofY + 0.4, ez0 + 0.25], [x1 + 0.95, roofY + 0.4, ez0 + 0.25], [x1 + 0.95, roofY + 0.4, ez1 - 0.25], [pod.x1, roofY + 0.4, ez1 - 0.25]], null, [0, 1, 0]);
  w.poly([[pod.x0, roofY + 0.4, ez0 + 0.25], [pod.x1, roofY + 0.4, ez0 + 0.25], [pod.x1, roofY + 0.4, pod.z0], [pod.x0, roofY + 0.4, pod.z0]], null, [0, 1, 0]);
  w.poly([[pod.x0, roofY + 0.4, pod.z1], [pod.x1, roofY + 0.4, pod.z1], [pod.x1, roofY + 0.4, ez1 - 0.25], [pod.x0, roofY + 0.4, ez1 - 0.25]], null, [0, 1, 0]);
  // Eave floodlights (plan.roofFloods): slim housings under the fascia lip,
  // lens tilted down toward the stand.
  for (const f of plan.roofFloods || []) for (const x of f.lamps) {
    w.paint(COLORS.claddingDark, SURF.PAINT, 0.45, 0.5);
    w.box(x - 0.55, roofY - 0.62, ez0 - 0.5, x + 0.55, roofY - 0.2, ez0 + 0.05);
    w.paint('#f4f1e6', SURF.LAMP, 0.25, 0, GLOW.LAMP_WHITE);
    w.poly([[x - 0.45, roofY - 0.63, ez0 - 0.45], [x + 0.45, roofY - 0.63, ez0 - 0.45], [x + 0.45, roofY - 0.63, ez0 - 0.02], [x - 0.45, roofY - 0.63, ez0 - 0.02]], null, [0, -1, 0]);
  }
  // Parapet coping (the fascia's top edge, inside face).
  w.paint(COLORS.claddingDark, SURF.CLADDING, 0.4, 0.6);
  w.box(x0 - 0.95, roofY + 0.4, ez0 + 0.25, x1 + 0.95, roofY + 1.05, ez0 + 0.45, 'nz');
  w.box(x0 - 0.95, roofY + 0.4, ez1 - 0.45, x1 + 0.95, roofY + 1.05, ez1 - 0.25, 'pz');

  // Clerestory spine along the pier, split around the lounge podium.
  const sz = (z0 + z1) / 2 + (small ? 0 : 3), sw = small ? 5 : 9, sh = small ? 1.6 : 2.4;
  const spineRuns = [[x0 + 18, pod.x0 - 8], [pod.x1 + 8, x1 - 18]];
  for (const [a, b] of spineRuns) {
    if (b - a < 20) continue;
    w.paint(COLORS.glass, SURF.CURTAIN, 0.06, 0, GLOW.SKYLIGHT);
    w.poly([[b, roofY + 0.4, sz - sw / 2], [a, roofY + 0.4, sz - sw / 2], [a, roofY + 0.4 + sh, sz - sw / 2], [b, roofY + 0.4 + sh, sz - sw / 2]], null, [0, 0, -1]);
    w.poly([[a, roofY + 0.4, sz + sw / 2], [b, roofY + 0.4, sz + sw / 2], [b, roofY + 0.4 + sh, sz + sw / 2], [a, roofY + 0.4 + sh, sz + sw / 2]], null, [0, 0, 1]);
    w.paint(COLORS.cladding, SURF.CLADDING, 0.36, 0.6);
    // Shallow pitched cap overhanging the glass.
    const top = roofY + 0.4 + sh;
    w.poly([[a - 0.6, top, sz - sw / 2 - 0.6], [b + 0.6, top, sz - sw / 2 - 0.6], [b + 0.6, top + 0.7, sz], [a - 0.6, top + 0.7, sz]], null, [0, 1, -0.4]);
    w.poly([[b + 0.6, top, sz + sw / 2 + 0.6], [a - 0.6, top, sz + sw / 2 + 0.6], [a - 0.6, top + 0.7, sz], [b + 0.6, top + 0.7, sz]], null, [0, 1, 0.4]);
    w.box(a - 0.6, roofY + 0.4, sz - sw / 2 - 0.2, a, top + 0.7, sz + sw / 2 + 0.2);
    w.box(b, roofY + 0.4, sz - sw / 2 - 0.2, b + 0.6, top + 0.7, sz + sw / 2 + 0.2);
    // Mullion posts on the spine glass every 3 m.
    w.paint(COLORS.mullion, SURF.PAINT, 0.35, 0.7);
    for (let x = a + 3; x < b; x += 3) {
      w.cbox(x, roofY + 0.4 + sh / 2, sz - sw / 2 - 0.05, 0.12, sh, 0.14);
      w.cbox(x, roofY + 0.4 + sh / 2, sz + sw / 2 + 0.05, 0.12, sh, 0.14);
    }
  }

  // Skylights: raised glazed boxes in two rows.
  const rows = small ? [z0 + 6] : [z0 + 8.5, z1 - 8];
  for (const zr of rows) {
    for (let x = x0 + 14; x < x1 - 10; x += small ? 10 : 13) {
      if (x > pod.x0 - 6 && x < pod.x1 + 6) continue;
      w.paint(COLORS.cladding, SURF.CLADDING, 0.4, 0.55);
      w.box(x - 1.7, roofY + 0.4, zr - 1.7, x + 1.7, roofY + 0.85, zr + 1.7, 'py');
      w.paint(COLORS.glass, SURF.GLASS, 0.05, 0, GLOW.SKYLIGHT);
      w.poly([[x - 1.6, roofY + 0.85, zr + 1.6], [x + 1.6, roofY + 0.85, zr + 1.6], [x + 1.6, roofY + 1.25, zr], [x - 1.6, roofY + 1.25, zr]], null, [0, 1, 0.3]);
      w.poly([[x + 1.6, roofY + 0.85, zr - 1.6], [x - 1.6, roofY + 0.85, zr - 1.6], [x - 1.6, roofY + 1.25, zr], [x + 1.6, roofY + 1.25, zr]], null, [0, 1, -0.3]);
      w.paint(COLORS.cladding, SURF.CLADDING, 0.4, 0.55);
      w.poly([[x - 1.6, roofY + 0.85, zr - 1.6], [x - 1.6, roofY + 0.85, zr + 1.6], [x - 1.6, roofY + 1.25, zr]], null, [-1, 0, 0]);
      w.poly([[x + 1.6, roofY + 0.85, zr + 1.6], [x + 1.6, roofY + 0.85, zr - 1.6], [x + 1.6, roofY + 1.25, zr]], null, [1, 0, 0]);
    }
  }

  // Maintenance walkways (dark paving strips) along the airside row.
  w.paint(COLORS.walkway, SURF.CONCRETE, 0.9, 0);
  for (const [a, b] of spineRuns) if (b - a > 20) w.box(a, roofY + 0.4, sz - sw / 2 - 2.2, b, roofY + 0.47, sz - sw / 2 - 1.2, 'ny');

  // Plant compounds on the landside half: air handling units behind louvred
  // screens, fan stacks, ducts down to the spine, and a few vent hoods.
  if (!small) {
    for (let x = x0 + 40; x < x1 - 30; x += 64 + rand() * 18) {
      if (x > pod.x0 - 28 && x < pod.x1 + 22) continue;
      const cz = z1 - 13 - rand() * 4;
      const len = 16 + rand() * 10;
      w.paint(COLORS.claddingDark, SURF.LOUVRE, 0.55, 0.45);
      // Screen: four louvred walls, open top.
      w.box(x - len / 2 - 1.5, roofY + 0.4, cz - 5.5, x + len / 2 + 1.5, roofY + 3.6, cz - 5.3, 'ny');
      w.box(x - len / 2 - 1.5, roofY + 0.4, cz + 5.3, x + len / 2 + 1.5, roofY + 3.6, cz + 5.5, 'ny');
      w.box(x - len / 2 - 1.5, roofY + 0.4, cz - 5.3, x - len / 2 - 1.3, roofY + 3.6, cz + 5.3, 'ny');
      w.box(x + len / 2 + 1.3, roofY + 0.4, cz - 5.3, x + len / 2 + 1.5, roofY + 3.6, cz + 5.3, 'ny');
      // AHUs.
      for (let k = 0; k < 2; k++) {
        const uz = cz - 2.2 + k * 4.4;
        w.paint(COLORS.plant, SURF.CLADDING, 0.45, 0.4);
        w.chamferBox(x, roofY + 0.4 + 1.35, uz, len, 2.7, 3.2, 0.08, true);
        w.paint(COLORS.plantDark, SURF.LOUVRE, 0.5, 0.5);
        w.poly([[x - len / 2 + 0.6, roofY + 0.9, uz - 1.61], [x - len / 2 + 3.6, roofY + 0.9, uz - 1.61], [x - len / 2 + 3.6, roofY + 2.6, uz - 1.61], [x - len / 2 + 0.6, roofY + 2.6, uz - 1.61]].reverse(), null, [0, 0, -1]);
        // Fan stacks on top.
        for (let f = -len / 2 + 2; f < len / 2 - 1; f += 3.2) {
          w.paint(COLORS.plantDark, SURF.PAINT, 0.5, 0.5);
          w.cylinder(x + f, roofY + 0.4 + 2.7, uz, 1.05, 0.55, 14, 'none');
          w.paint('#2b2f31', SURF.LOUVRE, 0.6, 0.4);
          w.cylinder(x + f, roofY + 0.4 + 2.7 + 0.5, uz, 1.0, 0.02, 14, 'top');
        }
      }
      // Duct run toward the spine, on low supports.
      w.paint(COLORS.plant, SURF.CLADDING, 0.4, 0.55);
      w.box(x - 1.0, roofY + 1.0, sz + sw / 2 + 0.7, x + 1.0, roofY + 2.2, cz - 5.6);
      w.paint(COLORS.rail, SURF.GALV, 0.5, 0.7);
      for (let zz = sz + sw / 2 + 2; zz < cz - 6; zz += 3) w.cbox(x, roofY + 0.7, zz, 1.8, 0.6, 0.15);
    }
    // Photovoltaic rows on the airside half, clear of the lounge.
    for (let x = x0 + 30; x < x1 - 30; x += 46) {
      if (x > pod.x0 - 40 && x < pod.x1 + 30) continue;
      if (rand() < 0.35) continue;
      for (let r = 0; r < 3; r++) {
        const pz = z0 + 13 + r * 3.6;
        if (pz > sz - sw / 2 - 3) break;
        w.paint(COLORS.solar, SURF.SOLAR, 0.16, 0.3);
        w.poly([[x - 14, roofY + 0.75, pz + 1.1], [x + 14, roofY + 0.75, pz + 1.1], [x + 14, roofY + 1.35, pz - 1.1], [x - 14, roofY + 1.35, pz - 1.1]], [[x - 14, 0], [x + 14, 0], [x + 14, 2.28], [x - 14, 2.28]], [0, 1, -0.27]);
        w.paint(COLORS.rail, SURF.GALV, 0.5, 0.7);
        w.box(x - 14, roofY + 0.4, pz - 1.1, x + 14, roofY + 0.75, pz - 1.0);
        w.box(x - 14, roofY + 0.4, pz + 1.0, x + 14, roofY + 0.75, pz + 1.1);
      }
    }
    // Small vents and hoods scattered on the membrane.
    for (let i = 0; i < 40; i++) {
      const x = x0 + 10 + rand() * (x1 - x0 - 20);
      if (x > pod.x0 - 6 && x < pod.x1 + 6) continue;
      const z = z0 + 3 + rand() * (z1 - z0 - 6);
      if (Math.abs(z - sz) < sw / 2 + 2.5) continue;
      w.paint(COLORS.plant, SURF.PAINT, 0.5, 0.55);
      if (rand() < 0.5) w.cylinder(x, roofY + 0.4, z, 0.25 + rand() * 0.2, 0.7 + rand() * 0.6, 8, 'top');
      else w.chamferBox(x, roofY + 0.4 + 0.4, z, 1.2, 0.8, 1.0, 0.05, true);
    }
  }

  // --- the lounge pavilion base ------------------------------------------------
  // A dark bronze-and-glass plinth from the pier roof to the room slab: four
  // concrete piers carry the room; between them a recessed glazed band.
  {
    const { x0: px0, x1: px1, z0: pz0, z1: pz1, y0, y1 } = pod;
    const ry = roofY + 0.4;
    w.paint(COLORS.bronze, SURF.CLADDING, 0.4, 0.7);
    w.box(px0, y1 - 0.55, pz0, px1, y1, pz1); // ring beam under the slab
    w.paint(COLORS.glass, SURF.CURTAIN, 0.06, 0, GLOW.INTERIOR_WARM);
    const inset = 0.7;
    w.poly([[px1 - inset, ry, pz0 + inset], [px0 + inset, ry, pz0 + inset], [px0 + inset, y1 - 0.55, pz0 + inset], [px1 - inset, y1 - 0.55, pz0 + inset]], null, [0, 0, -1]);
    w.poly([[px0 + inset, ry, pz1 - inset], [px1 - inset, ry, pz1 - inset], [px1 - inset, y1 - 0.55, pz1 - inset], [px0 + inset, y1 - 0.55, pz1 - inset]], null, [0, 0, 1]);
    w.poly([[px0 + inset, ry, pz0 + inset], [px0 + inset, ry, pz1 - inset], [px0 + inset, y1 - 0.55, pz1 - inset], [px0 + inset, y1 - 0.55, pz0 + inset]], null, [-1, 0, 0]);
    w.poly([[px1 - inset, ry, pz1 - inset], [px1 - inset, ry, pz0 + inset], [px1 - inset, y1 - 0.55, pz0 + inset], [px1 - inset, y1 - 0.55, pz1 - inset]], null, [1, 0, 0]);
    w.paint(COLORS.concrete, SURF.CONCRETE, 0.8, 0);
    for (const px of [px0, px1 - 1.6]) for (const pz of [pz0, pz1 - 1.6]) w.box(px, ry, pz, px + 1.6, y1 - 0.55, pz + 1.6);
    // Vertical bronze fins on the front band.
    w.paint(COLORS.bronze, SURF.PAINT, 0.4, 0.7);
    for (let x = px0 + 2.2; x < px1 - 1.8; x += 1.1) w.cbox(x, (ry + y1 - 0.55) / 2, pz0 + inset - 0.2, 0.06, y1 - 0.55 - ry, 0.4);
  }

  buildGateSigns(w, plan, atlas);
}

/** Shared gate signage; the rear geometry is rotated by the set. */
export function buildGateSigns(w, plan, atlas) {
  const { roofY, z0 } = plan.terminal;
  const gateY = plan.gateY, small = plan.size === 'small';
  // --- gate signage and VDGS boards ----------------------------------------------
  if (!small) {
    for (const s of plan.stands) {
      const label = `${plan.gateLetter}${s.number}`;
      const r = atlas?.rect(label);
      // Backlit gate number high on the curtain wall, beside the fixed link.
      const gx = s.x + 7 + 3.2;
      w.paint('#1b1f22', SURF.PAINT, 0.5, 0.3);
      w.box(gx - 1.6, roofY - 2.9, z0 - 0.45, gx + 1.6, roofY - 1.5, z0 - 0.05);
      if (r) {
        w.paint('#f1f0ea', SURF.SIGN, 0.4, 0, GLOW.SIGN_WHITE);
        w.poly([[gx + 1.45, roofY - 2.8, z0 - 0.46], [gx - 1.45, roofY - 2.8, z0 - 0.46], [gx - 1.45, roofY - 1.6, z0 - 0.46], [gx + 1.45, roofY - 1.6, z0 - 0.46]],
          [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]], [0, 0, -1]);
      }
      // VDGS: docking guidance display on the stand centreline, facing the cockpit.
      const vy = gateY + 2.6;
      w.paint('#202326', SURF.PAINT, 0.45, 0.5);
      w.box(s.x - 1.0, vy - 0.9, z0 - 0.55, s.x + 1.0, vy + 0.9, z0 - 0.05);
      const d = atlas?.rect(s.cls === 'wide' ? 'B777' : s.cls === 'narrow' ? 'A320' : 'E175');
      if (d) {
        w.paint('#050505', SURF.SIGN, 0.3, 0, GLOW.DISPLAY);
        w.poly([[s.x + 0.85, vy + 0.15, z0 - 0.56], [s.x - 0.85, vy + 0.15, z0 - 0.56], [s.x - 0.85, vy + 0.75, z0 - 0.56], [s.x + 0.85, vy + 0.75, z0 - 0.56]],
          [[d.u0, d.v0], [d.u1, d.v0], [d.u1, d.v1], [d.u0, d.v1]], [0, 0, -1]);
        // Closing-rate bar below the type.
        w.paint('#050505', SURF.LAMP, 0.3, 0, GLOW.DISPLAY);
        w.poly([[s.x + 0.12, vy - 0.75, z0 - 0.56], [s.x - 0.12, vy - 0.75, z0 - 0.56], [s.x - 0.12, vy + 0.05, z0 - 0.56], [s.x + 0.12, vy + 0.05, z0 - 0.56]], null, [0, 0, -1]);
      }
    }
  }
}
