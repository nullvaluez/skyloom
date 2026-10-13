// Apron-drive passenger boarding bridges. One geometry per bridge POSE (docked
// or retracted), built in room-local metres so the bridge renders as a static
// instance of the batched set; the other pose is a hidden instance, swapped
// when a stand's occupancy changes (no rebuild, no extra draw).
//
// Anatomy, from the terminal outward: a fixed link at gate level over the
// head-of-stand road; the rotunda on its column (with a service stair); three
// telescoping tunnel sections growing toward the cab (each outer section
// slides over the inner one), corrugated sides with a window band; the drive
// column (two telescoping legs, a bogie with two wheels) under the outer
// section; under-slung PCA and ground-power units; the cab, whose mouth and
// rubber bellows meet the fuselage at the boarding door.
import { GLOW, SURF } from './mesh-writer.js';
import { AIRFIELD } from '../observation-config.js';

const C = {
  white: '#dcdedb',
  panel: '#c3c8cb',
  dark: '#3a4045',
  steel: '#7d868c',
  glass: '#1f2c33',
  bellows: '#24272a',
  pca: '#c9cbc6',
  hose: '#d3a51b',
  cable: '#121314',
  yellow: '#d9a514',
};

/**
 * Build one pose. `stand` supplies the aircraft position for hoses (docked
 * pose only); `facadeZ` anchors the fixed link; `atlasRect` labels the tunnel.
 */
export function buildBridgePose(w, pose, { stand, facadeZ, gateY, sill, docked, label }) {
  const B = AIRFIELD.structures.bridge;
  const { rot, yaw, len, sections, columnS } = pose;
  const rr = B.rotundaR;

  // --- fixed link over the head-of-stand road ----------------------------------
  w.push().translate(rot.x, 0, 0);
  w.paint(C.white, SURF.CLADDING, 0.42, 0.35);
  const lz0 = facadeZ - 0.05, lz1 = rot.z + rr * 0.6;
  w.box(-1.3, gateY - 0.45, lz1, 1.3, gateY + 2.85, lz0, 'pz');
  w.paint(C.glass, SURF.GLASS, 0.08, 0, GLOW.INTERIOR_COOL);
  for (const sx of [-1, 1]) {
    w.poly([[sx * 1.31, gateY + 0.85, lz1 + 0.5], [sx * 1.31, gateY + 0.85, lz0 - 0.3], [sx * 1.31, gateY + 2.1, lz0 - 0.3], [sx * 1.31, gateY + 2.1, lz1 + 0.5]], null, [sx, 0, 0]);
  }
  w.pop();

  // --- rotunda + column + service stair -------------------------------------------
  w.push().translate(rot.x, 0, rot.z);
  w.paint(C.steel, SURF.PAINT, 0.5, 0.55);
  w.cylinder(0, -2.5, 0, 0.48, gateY + 2.0, 12, 'none'); // runs below the apron plane: never floats
  w.paint('#8f8b84', SURF.CONCRETE, 0.9, 0);
  w.cbox(0, -1.1, 0, 1.6, 2.8, 1.6);
  w.paint(C.white, SURF.CLADDING, 0.42, 0.35);
  w.cylinder(0, gateY - 0.5, 0, rr, 3.45, 20, 'both');
  w.paint(C.glass, SURF.GLASS, 0.08, 0, GLOW.INTERIOR_COOL);
  w.cylinder(0, gateY + 0.9, 0, rr + 0.03, 1.15, 20, 'none');
  w.paint(C.dark, SURF.CLADDING, 0.45, 0.6);
  w.cylinder(0, gateY + 2.95, 0, rr + 0.18, 0.18, 20, 'both');
  // Service stair down the -X side of the rotunda (landing + flight + rails).
  w.paint(C.steel, SURF.GALV, 0.5, 0.65);
  const stairX = -rr - 0.55;
  w.box(stairX - 0.55, gateY - 0.55, -0.6, stairX + 0.55, gateY - 0.45, 0.6);
  const flight = gateY - 0.5;
  w.push().translate(stairX, 0, 0.6);
  const run = flight * 1.05;
  w.poly([[-0.5, flight, 0], [0.5, flight, 0], [0.5, 0.05, run], [-0.5, 0.05, run]], null, [0, 1, 0.8]);
  w.poly([[0.5, flight - 0.15, 0], [-0.5, flight - 0.15, 0], [-0.5, -0.1, run], [0.5, -0.1, run]], null, [0, -1, -0.8]);
  w.rod([-0.52, flight + 1.0, 0], [-0.52, 1.0, run], 0.025, 5);
  w.rod([0.52, flight + 1.0, 0], [0.52, 1.0, run], 0.025, 5);
  w.rod([-0.52, 0, run], [-0.52, 1.0, run], 0.025, 5);
  w.rod([0.52, 0, run], [0.52, 1.0, run], 0.025, 5);
  w.pop();
  w.pop();

  // --- tunnel ---------------------------------------------------------------------
  // Tunnel frame: origin at the rotunda centre on the gate floor, local -Z
  // along the tunnel, pitched so the far end meets the cab floor.
  const rise = pose.floorB - pose.floorA;
  const pitch = Math.atan2(rise, len);
  w.push().translate(rot.x, pose.floorA, rot.z).rotateY(yaw).rotateX(pitch);
  sections.forEach((s, i) => {
    const hw = s.w / 2, h = s.h, y0 = -0.32;
    const za = -s.s0, zb = -s.s1;
    // Corrugated sides, flat roof, dark underside.
    w.paint(i === 0 ? C.white : C.panel, SURF.RIBBED, 0.45, 0.4);
    w.poly([[hw, y0, za], [hw, y0, zb], [hw, h, zb], [hw, h, za]], null, [1, 0, 0]);
    w.poly([[-hw, y0, zb], [-hw, y0, za], [-hw, h, za], [-hw, h, zb]], null, [-1, 0, 0]);
    w.paint(C.white, SURF.CLADDING, 0.4, 0.35);
    w.poly([[-hw, h, za], [hw, h, za], [hw, h, zb], [-hw, h, zb]], null, [0, 1, 0]);
    w.paint(C.dark, SURF.PAINT, 0.7, 0.3);
    w.poly([[-hw, y0, zb], [hw, y0, zb], [hw, y0, za], [-hw, y0, za]], null, [0, -1, 0]);
    // Window band (inset glazing strip) on both sides.
    w.paint(C.glass, SURF.GLASS, 0.08, 0, GLOW.INTERIOR_COOL);
    const wz0 = za - 0.6, wz1 = zb + 0.6;
    if (wz0 - wz1 > 0.8) {
      w.poly([[hw + 0.01, 0.95, wz0], [hw + 0.01, 0.95, wz1], [hw + 0.01, 1.9, wz1], [hw + 0.01, 1.9, wz0]], null, [1, 0, 0]);
      w.poly([[-hw - 0.01, 0.95, wz1], [-hw - 0.01, 0.95, wz0], [-hw - 0.01, 1.9, wz0], [-hw - 0.01, 1.9, wz1]], null, [-1, 0, 0]);
    }
    // Section end frame: the reveal you see where the next section slides out.
    w.paint(C.dark, SURF.PAINT, 0.5, 0.5);
    const f = 0.12;
    w.box(-hw - f, y0 - f, zb - 0.05, hw + f, y0, zb + 0.35);
    w.box(-hw - f, h, zb - 0.05, hw + f, h + f, zb + 0.35);
    w.box(-hw - f, y0, zb - 0.05, -hw, h, zb + 0.35);
    w.box(hw, y0, zb - 0.05, hw + f, h, zb + 0.35);
    // Gate label on the inner section, both sides.
    if (i === 0 && label) {
      // Gate number board (the atlas cell is 2.4:1), near the rotunda end.
      const R = za - 0.7, L = R - 1.68;
      if (L > zb + 0.6) {
        w.paint('#f1f0ea', SURF.SIGN, 0.4, 0, GLOW.SIGN_WHITE);
        const uv = [[label.u0, label.v0], [label.u1, label.v0], [label.u1, label.v1], [label.u0, label.v1]];
        w.poly([[hw + 0.02, 1.72, R], [hw + 0.02, 1.72, L], [hw + 0.02, 2.42, L], [hw + 0.02, 2.42, R]], uv, [1, 0, 0]);
        w.poly([[-hw - 0.02, 1.72, L], [-hw - 0.02, 1.72, R], [-hw - 0.02, 2.42, R], [-hw - 0.02, 2.42, L]], uv, [-1, 0, 0]);
      }
    }
  });
  // Under-slung PCA and ground-power units near the cab end.

  w.paint(C.pca, SURF.CLADDING, 0.5, 0.35);
  w.chamferBox(0, -0.32 - 0.55, -(len - 3.2), 1.5, 1.1, 2.0, 0.06);
  w.chamferBox(0.2, -0.32 - 0.35, -(len - 5.6), 1.0, 0.7, 1.1, 0.05);
  w.paint(C.dark, SURF.LOUVRE, 0.5, 0.5);
  w.poly([[0.76, -1.3, -(len - 2.4)], [0.76, -1.3, -(len - 4.0)], [0.76, -0.45, -(len - 4.0)], [0.76, -0.45, -(len - 2.4)]], null, [1, 0, 0]);
  w.pop();

  // --- cab ---------------------------------------------------------------------------
  {
    const { cab, cabYaw } = pose;
    const D = B.cabDepth, W = B.cabWidth, H = B.cabHeight;
    w.push().translate(cab.x, pose.floorB, cab.z).rotateY(cabYaw);
    // Body: floor slab, walls, roof; the mouth (-Z face) is open behind the bellows.
    w.paint(C.white, SURF.CLADDING, 0.42, 0.35);
    w.box(-W / 2, -0.35, -D / 2, W / 2, 0, D / 2);
    w.box(-W / 2, H - 0.2, -D / 2, W / 2, H, D / 2);
    w.box(-W / 2, 0, -D / 2 + 0.4, -W / 2 + 0.15, H - 0.2, D / 2);
    w.box(W / 2 - 0.15, 0, -D / 2 + 0.4, W / 2, H - 0.2, D / 2);
    w.box(-W / 2, 0, D / 2 - 0.15, W / 2, H - 0.2, D / 2);
    // Wraparound cab glazing on the sides near the mouth (the operator's view).
    w.paint(C.glass, SURF.GLASS, 0.06, 0, GLOW.INTERIOR_COOL);
    w.poly([[W / 2 + 0.01, 0.9, -D / 2 + 0.4], [W / 2 + 0.01, 0.9, D / 2 - 0.5], [W / 2 + 0.01, H - 0.45, D / 2 - 0.5], [W / 2 + 0.01, H - 0.45, -D / 2 + 0.4]].reverse(), null, [1, 0, 0]);
    w.poly([[-W / 2 - 0.01, 0.9, -D / 2 + 0.4], [-W / 2 - 0.01, 0.9, D / 2 - 0.5], [-W / 2 - 0.01, H - 0.45, D / 2 - 0.5], [-W / 2 - 0.01, H - 0.45, -D / 2 + 0.4]], null, [-1, 0, 0]);
    // Bellows (canopy): accordion hood around the door opening, ridged.
    w.paint(C.bellows, SURF.RUBBER, 0.85, 0);
    const ridges = docked ? 5 : 3;
    for (let r = 0; r < ridges; r++) {
      const z = -D / 2 - 0.05 - r * 0.13, g = r % 2 ? 0.06 : 0;
      w.box(-W / 2 + 0.15 - g, -0.25, z - 0.13, W / 2 - 0.15 + g, -0.15, z);
      w.box(-W / 2 + 0.15 - g, H - 0.15, z - 0.13, W / 2 - 0.15 + g, H - 0.05 + g, z);
      w.box(-W / 2 + 0.05 - g, -0.25, z - 0.13, -W / 2 + 0.2, H - 0.05, z);
      w.box(W / 2 - 0.2, -0.25, z - 0.13, W / 2 - 0.05 + g, H - 0.05, z);
    }
    // Floor bumper and the auto-leveller arm.
    w.paint('#141516', SURF.RUBBER, 0.8, 0);
    w.box(-W / 2 + 0.3, -0.42, -D / 2 - 0.22, W / 2 - 0.3, -0.18, -D / 2 - 0.02);
    // Cab roof light (lamp face downward) and a small hood.
    w.paint('#2a2e31', SURF.PAINT, 0.5, 0.5);
    w.box(-0.35, H, -D / 2 + 0.1, 0.35, H + 0.18, -D / 2 + 0.6);
    w.paint('#e7e3d5', SURF.LAMP, 0.3, 0, GLOW.LAMP_WHITE);
    w.poly([[-0.3, H + 0.06, -D / 2 + 0.08], [0.3, H + 0.06, -D / 2 + 0.08], [0.3, H + 0.16, -D / 2 + 0.08], [-0.3, H + 0.16, -D / 2 + 0.08]].reverse(), null, [0, 0, -1]);
    w.pop();
  }

  // --- docked only: PCA duct and ground power cable to the aircraft ------------------
  if (docked && stand) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const ux = rot.x + fx * (len - 3.2), uz = rot.z + fz * (len - 3.2);
    const uy = pose.floorA + rise * ((len - 3.2) / len) - 1.45;
    const belly = { x: stand.x + 0.4, y: stand.cls === 'wide' ? 2.6 : 1.7, z: stand.noseZ - (stand.cls === 'wide' ? 12 : 7.5) };
    w.paint(C.hose, SURF.RUBBER, 0.7, 0);
    w.tube([[ux, uy, uz], [ux - 0.3, 0.35, uz - 0.6], [(ux + belly.x) / 2, 0.22, (uz + belly.z) / 2], [belly.x + 0.8, 0.3, belly.z + 0.5], [belly.x, belly.y, belly.z]], 0.17, 7);
    w.paint(C.cable, SURF.RUBBER, 0.6, 0);
    const nose = { x: stand.x - 0.9, y: 1.4, z: stand.noseZ - 3.2 };
    w.tube([[ux + 0.3, uy + 0.2, uz + 2.2], [ux, 0.12, uz + 1.8], [(ux + nose.x) / 2, 0.08, (uz + nose.z) / 2 + 1], [nose.x + 0.4, 0.15, nose.z], [nose.x, nose.y, nose.z]], 0.045, 5);
  }
}

/** Where a pose's drive column stands (room-local) and which way it faces. */
export function bridgeColumnSpot(pose) {
  const fx = -Math.sin(pose.yaw), fz = -Math.cos(pose.yaw);
  return { x: pose.rot.x + fx * pose.columnS, z: pose.rot.z + fz * pose.columnS, yaw: pose.yaw };
}

/**
 * The drive column of a pose, built at its own origin (the ground under the
 * column, -Z along the tunnel). It is a separate instance so it can stand on
 * the sampled ground: the telescoping legs run 2.4 m up INTO the tunnel, so a
 * column lowered or raised by the terrain still meets the yoke out of sight.
 */
export function buildBridgeColumn(w, pose) {
  const B = AIRFIELD.structures.bridge;
  const rise = pose.floorB - pose.floorA;
  const under = pose.floorA + rise * (pose.columnS / pose.len) - 0.32;
  const halfW = B.sectionW[2] / 2 - 0.3;
  w.paint(C.steel, SURF.PAINT, 0.45, 0.6);
  for (const sx of [-1, 1]) {
    const top = under + 2.4;
    w.cbox(sx * halfW, (0.95 + top) / 2, 0, 0.42, top - 0.95, 0.42);
    w.paint('#b8bec2', SURF.GALV, 0.3, 0.85);
    w.cylinder(sx * halfW, 0.75, 0, 0.13, 1.2, 8, 'none');
    w.paint(C.steel, SURF.PAINT, 0.45, 0.6);
  }
  w.cbox(0, under - 0.2, 0, halfW * 2 + 0.5, 0.35, 0.5); // yoke under the tunnel
  // Bogie: hazard-banded beam, two wheels rolling along the tunnel.
  w.paint(C.yellow, SURF.HAZARD, 0.55, 0.2);
  w.chamferBox(0, 0.7, 0, halfW * 2 + 0.6, 0.45, 0.9, 0.06);
  w.wheel(-halfW + 0.15, 0.5, 0, 0.5, 0.36, 14);
  w.wheel(halfW - 0.15, 0.5, 0, 0.5, 0.36, 14);
}
