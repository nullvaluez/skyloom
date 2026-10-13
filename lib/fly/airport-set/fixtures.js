// Airfield fixtures around the apron: high-mast floodlights, the control
// tower, maintenance hangars, windsock masts and taxiway guidance signs.
// Each builder writes room-local metres at y = 0 on its own base (the set
// component lifts far fixtures onto their sampled ground).
import { GLOW, SURF } from './mesh-writer.js';

const C = {
  galv: '#a3a9ab',
  concrete: '#c4c0b7',
  concreteWarm: '#d6d1c6',
  cladding: '#c6cbcd',
  claddingDark: '#4b5257',
  roof: '#8c9194',
  glass: '#22323a',
  door: '#8a9ba7',
  doorDark: '#59656e',
  sign: '#232628',
};

/** High-mast flood light: tapered galvanised pole, head frame, 8 luminaires. */
export function buildMast(w, m) {
  w.push().translate(m.x, 0, m.z).rotateY(m.yaw || 0);
  // Plinth and pole run below the apron plane so low ground never shows a gap.
  w.paint(C.concrete, SURF.CONCRETE, 0.9, 0);
  w.chamferBox(0, -0.95, 0, 1.4, 3.1, 1.4, 0.06);
  w.paint(C.galv, SURF.GALV, 0.45, 0.75);
  w.cylinder(0, 0.6, 0, 0.36, m.h - 0.6, 8, 'none', 0.17);
  // Head frame: a ring plate with luminaires facing the apron (-Z), tilted down.
  const y = m.h;
  w.cylinder(0, y - 0.2, 0, 1.6, 0.18, 12, 'both');
  w.paint('#2f3438', SURF.PAINT, 0.5, 0.5);
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + ((i - 3.5) / 7) * 2.2; // a fan aimed at the apron
    const cx = Math.cos(a) * 1.45, cz = Math.sin(a) * 1.45;
    w.push().translate(cx, y - 0.45, cz).rotateY(Math.atan2(-cx, -cz) + Math.PI).rotateX(-0.55);
    w.paint('#2f3438', SURF.PAINT, 0.5, 0.5);
    w.chamferBox(0, 0, 0, 0.72, 0.22, 0.5, 0.04);
    w.paint('#f4f1e6', SURF.LAMP, 0.25, 0, GLOW.LAMP_WHITE);
    w.poly([[-0.32, -0.112, -0.22], [0.32, -0.112, -0.22], [0.32, -0.112, 0.22], [-0.32, -0.112, 0.22]], null, [0, -1, 0]);
    w.pop();
  }
  // Obstruction light on top.
  w.paint('#4a1512', SURF.LAMP, 0.3, 0, GLOW.LAMP_RED);
  w.sphere(0, y + 0.18, 0, 0.12, 6, 4);
  w.pop();
}

/**
 * Control tower: base building, a tapered shaft with a glazed stair fin, a
 * flared neck, a canted octagonal glass cab with an overhanging roof, an
 * equipment level, antennas and obstruction lights. Proportions scale with h.
 */
export function buildTower(w, t) {
  const h = t.h;
  const cabH = Math.max(3.4, Math.min(5.2, h * 0.075));
  const shaftTop = h - cabH - 3.2;
  const rBase = Math.max(2.4, h / 17), rTop = rBase * 0.82;
  w.push().translate(t.x, 0, t.z);
  // Base building (ops block) wrapped around the shaft foot.
  w.paint(C.concreteWarm, SURF.CONCRETE, 0.85, 0);
  const bw = Math.max(14, h * 0.32), bd = Math.max(9, h * 0.18), bh = Math.min(12, Math.max(5, h * 0.14));
  w.box(-bw / 2, 0, -bd / 2, bw / 2, bh, bd / 2);
  w.paint(C.glass, SURF.CURTAIN, 0.06, 0, GLOW.INTERIOR_WARM);
  w.poly([[bw / 2 - 1, 1, -bd / 2 - 0.02], [-bw / 2 + 1, 1, -bd / 2 - 0.02], [-bw / 2 + 1, bh - 1.2, -bd / 2 - 0.02], [bw / 2 - 1, bh - 1.2, -bd / 2 - 0.02]], null, [0, 0, -1]);
  w.poly([[-bw / 2 + 1, 1, bd / 2 + 0.02], [bw / 2 - 1, 1, bd / 2 + 0.02], [bw / 2 - 1, bh - 1.2, bd / 2 + 0.02], [-bw / 2 + 1, bh - 1.2, bd / 2 + 0.02]], null, [0, 0, 1]);
  w.paint(C.claddingDark, SURF.CLADDING, 0.4, 0.6);
  w.box(-bw / 2 - 0.3, bh, -bd / 2 - 0.3, bw / 2 + 0.3, bh + 0.5, bd / 2 + 0.3);
  // Shaft.
  w.paint(C.concreteWarm, SURF.CONCRETE, 0.78, 0);
  w.cylinder(0, 0, 0, rBase, shaftTop, 20, 'none', rTop);
  // Glazed stair fin running up one face.
  w.paint(C.glass, SURF.CURTAIN, 0.06, 0, GLOW.INTERIOR_COOL);
  w.box(-0.9, bh + 0.5, -rBase - 0.6, 0.9, shaftTop - 0.5, -rTop + 0.4);
  // Neck flaring out to the cab floor, and a catwalk ring.
  const rCab = Math.max(5, rTop * 1.9);
  w.paint(C.cladding, SURF.CLADDING, 0.38, 0.6);
  w.cylinder(0, shaftTop, 0, rTop, 2.4, 20, 'none', rCab * 0.92);
  w.paint(C.claddingDark, SURF.CLADDING, 0.45, 0.6);
  w.cylinder(0, shaftTop + 2.4, 0, rCab + 0.6, 0.55, 8, 'both');
  w.paint(C.galv, SURF.GALV, 0.45, 0.7);
  w.cylinder(0, shaftTop + 2.95, 0, rCab + 0.55, 1.05, 16, 'none');
  // Canted cab glazing (wider at the top), mullions at the octagon corners.
  const cy0 = shaftTop + 2.95, cy1 = cy0 + cabH;
  w.paint(C.glass, SURF.GLASS, 0.04, 0, GLOW.INTERIOR_COOL);
  w.cylinder(0, cy0, 0, rCab, cabH, 8, 'none', rCab * 1.12);
  w.paint(C.claddingDark, SURF.PAINT, 0.4, 0.7);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    w.rod([Math.cos(a) * rCab, cy0, Math.sin(a) * rCab], [Math.cos(a) * rCab * 1.12, cy1, Math.sin(a) * rCab * 1.12], 0.12, 5);
  }
  // Overhanging roof, equipment level, antennas.
  w.paint(C.claddingDark, SURF.CLADDING, 0.4, 0.65);
  w.cylinder(0, cy1, 0, rCab * 1.22, 0.75, 8, 'both', rCab * 1.18);
  w.paint(C.cladding, SURF.CLADDING, 0.45, 0.5);
  w.cylinder(0, cy1 + 0.75, 0, rCab * 0.55, 2.2, 12, 'top');
  w.paint(C.galv, SURF.GALV, 0.45, 0.75);
  w.rod([0, cy1 + 2.95, 0], [0, cy1 + 9, 0], 0.08, 6);
  w.rod([rCab * 0.35, cy1 + 2.95, 0.4], [rCab * 0.35, cy1 + 6.2, 0.4], 0.05, 5);
  w.rod([-rCab * 0.3, cy1 + 2.95, -0.6], [-rCab * 0.3, cy1 + 5.0, -0.6], 0.05, 5);
  w.paint('#e7e9ea', SURF.PAINT, 0.4, 0.2);
  w.sphere(-rCab * 0.25, cy1 + 3.9, rCab * 0.3, 0.9, 10, 6); // radome
  w.paint('#4a1512', SURF.LAMP, 0.3, 0, GLOW.LAMP_RED);
  w.sphere(0, cy1 + 9.15, 0, 0.18, 6, 4);
  w.pop();
  return { top: cy1 + 9.15, cabY: (cy0 + cy1) / 2, rCab, roofY: cy1 + 0.75 };
}

/**
 * Maintenance hangar: clad walls, a shallow arched roof, a sliding door wall
 * (six panels, one bay open), a header with the hangar number, a side annex.
 */
export function buildHangar(w, hg, atlas) {
  const { w: W, d: D, h: H } = hg;
  w.push().translate(hg.x, 0, hg.front);
  // Walls (front face is the door wall at z = 0, building extends to +D).
  w.paint(C.cladding, SURF.CLADDING, 0.48, 0.45);
  w.poly([[-W / 2, 0, D], [W / 2, 0, D], [W / 2, H, D], [-W / 2, H, D]], null, [0, 0, 1]);
  w.poly([[W / 2, 0, D], [W / 2, 0, 0], [W / 2, H, 0], [W / 2, H, D]], null, [1, 0, 0]);
  w.poly([[-W / 2, 0, 0], [-W / 2, 0, D], [-W / 2, H, D], [-W / 2, H, 0]], null, [-1, 0, 0]);
  // Arched roof across the width (8 facets), gable infills front and back.
  const rise = H * 0.16, n = 8;
  const arc = (i) => { const x = -W / 2 + (W * i) / n, t = (2 * i) / n - 1; return [x, H + rise * (1 - t * t)]; };
  w.paint(C.roof, SURF.CLADDING, 0.45, 0.55);
  for (let i = 0; i < n; i++) {
    const [xa, ya] = arc(i), [xb, yb] = arc(i + 1);
    w.poly([[xa, ya, -0.6], [xb, yb, -0.6], [xb, yb, D + 0.6], [xa, ya, D + 0.6]].reverse(), null, [ya - yb, xb - xa, 0]);
  }
  w.paint(C.cladding, SURF.CLADDING, 0.48, 0.45);
  for (let i = 0; i < n; i++) {
    const [xa, ya] = arc(i), [xb, yb] = arc(i + 1);
    w.poly([[xa, H, D], [xb, H, D], [xb, yb, D], [xa, ya, D]], null, [0, 0, 1]);
  }
  // Door header (deep beam) carrying the sign; door panels below it.
  const doorH = H - 3.2;
  w.paint(C.claddingDark, SURF.CLADDING, 0.42, 0.6);
  w.box(-W / 2, doorH, -0.4, W / 2, H, 0.2);
  for (let i = 0; i < n; i++) {
    const [xa, ya] = arc(i), [xb, yb] = arc(i + 1);
    w.poly([[xb, H, -0.4], [xa, H, -0.4], [xa, ya, -0.4], [xb, yb, -0.4]], null, [0, 0, -1]);
  }
  const panels = 6, pw = (W - 2) / panels;
  for (let i = 0; i < panels; i++) {
    const open = i === 2 || i === 3;
    const x0 = -W / 2 + 1 + i * pw;
    const z = open ? -0.1 : i % 2 ? -0.75 : -0.35;
    if (open && i === 3) continue; // the open bay: panels stacked aside
    w.paint(i % 2 ? C.door : C.doorDark, SURF.RIBBED, 0.5, 0.45);
    w.box(x0 + 0.05, 0, z - 0.2, x0 + pw - 0.05, doorH, z);
  }
  // Open bay: dark interior with work lights.
  w.paint('#16191b', SURF.PAINT, 0.9, 0, GLOW.HANGAR);
  w.poly([[-W / 2 + 1 + 4 * pw, 0, 6], [-W / 2 + 1 + 3 * pw, 0, 6], [-W / 2 + 1 + 3 * pw, doorH, 6], [-W / 2 + 1 + 4 * pw, doorH, 6]], null, [0, 0, -1]);
  w.paint('#2a2d30', SURF.CONCRETE, 0.9, 0);
  w.poly([[-W / 2 + 1 + 3 * pw, 0.02, 6], [-W / 2 + 1 + 4 * pw, 0.02, 6], [-W / 2 + 1 + 4 * pw, 0.02, -0.1], [-W / 2 + 1 + 3 * pw, 0.02, -0.1]], null, [0, 1, 0]);
  for (const s of [-1, 1]) {
    w.paint('#2a2d30', SURF.CLADDING, 0.6, 0.3, GLOW.HANGAR);
    w.poly([[-W / 2 + 1 + (s < 0 ? 3 : 4) * pw, 0, -0.1], [-W / 2 + 1 + (s < 0 ? 3 : 4) * pw, 0, 6], [-W / 2 + 1 + (s < 0 ? 3 : 4) * pw, doorH, 6], [-W / 2 + 1 + (s < 0 ? 3 : 4) * pw, doorH, -0.1]], null, [-s, 0, 0]);
  }
  // Sign on the header.
  const r = atlas?.rect(`HANGAR ${hg.number}`);
  if (r) {
    w.paint('#f1f0ea', SURF.SIGN, 0.4, 0, GLOW.SIGN_WHITE);
    const sw = Math.min(W * 0.36, 26), sh = 2.0;
    w.poly([[sw / 2, H - 2.6, -0.42], [-sw / 2, H - 2.6, -0.42], [-sw / 2, H - 2.6 + sh, -0.42], [sw / 2, H - 2.6 + sh, -0.42]],
      [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]], [0, 0, -1]);
  }
  // Floodlights over the door, red obstruction lights at the roof corners.
  for (let x = -W / 2 + 6; x < W / 2 - 3; x += 12) {
    w.paint('#2f3438', SURF.PAINT, 0.5, 0.5);
    w.box(x - 0.4, doorH + 0.3, -0.95, x + 0.4, doorH + 0.65, -0.4);
    w.paint('#f4f1e6', SURF.LAMP, 0.25, 0, GLOW.LAMP_WHITE);
    w.poly([[x - 0.35, doorH + 0.29, -0.92], [x + 0.35, doorH + 0.29, -0.92], [x + 0.35, doorH + 0.29, -0.45], [x - 0.35, doorH + 0.29, -0.45]], null, [0, -1, 0]);
  }
  w.paint('#4a1512', SURF.LAMP, 0.3, 0, GLOW.LAMP_RED);
  for (const x of [-W / 2, W / 2]) w.sphere(x, H + 0.25, -0.5, 0.15, 6, 4);
  // Side annex (workshops/offices) along +X with a window band.
  w.paint(C.concrete, SURF.CONCRETE, 0.85, 0);
  w.box(W / 2, 0, 4, W / 2 + 9, 7.5, D - 4);
  w.paint(C.glass, SURF.CURTAIN, 0.06, 0, GLOW.INTERIOR_WARM);
  w.poly([[W / 2 + 9.02, 1, D - 6], [W / 2 + 9.02, 1, 6], [W / 2 + 9.02, 6.5, 6], [W / 2 + 9.02, 6.5, D - 6]].reverse(), null, [1, 0, 0]);
  w.poly([[W / 2 + 8.5, 1.2, 3.98], [W / 2 + 1, 1.2, 3.98], [W / 2 + 1, 6.2, 3.98], [W / 2 + 8.5, 6.2, 3.98]], null, [0, 0, -1]);
  w.pop();
}

/** Windsock mast (the sock itself is an animated instance). Returns the pivot. */
export function buildWindsockMast(w, ws) {
  w.push().translate(ws.x, 0, ws.z);
  w.paint(C.concrete, SURF.CONCRETE, 0.9, 0);
  w.cylinder(0, 0, 0, 0.9, 0.25, 12, 'top');
  w.paint('#e9e7e1', SURF.PAINT, 0.45, 0.3);
  w.cylinder(0, 0.25, 0, 0.09, 6.4, 8, 'top');
  w.paint('#e23a1a', SURF.PAINT, 0.45, 0.2);
  for (let y = 1.2; y < 6.4; y += 1.6) w.cylinder(0, y, 0, 0.095, 0.55, 8, 'none');
  w.paint('#9ca3a6', SURF.GALV, 0.4, 0.8);
  w.cylinder(0, 6.65, 0, 0.12, 0.25, 8, 'both');
  w.paint('#4a1512', SURF.LAMP, 0.3, 0, GLOW.LAMP_RED);
  w.sphere(0, 7.05, 0, 0.12, 6, 4);
  w.pop();
  return { x: ws.x, y: 6.75, z: ws.z };
}

/**
 * Taxiway guidance sign group at a holding position, faces toward the apron
 * (+Z): [location][mandatory runway hold][direction]. Frangible legs.
 */
export function buildSignGroup(w, sg, atlas) {
  const panels = [
    { text: sg.taxiway, glow: GLOW.SIGN_BLACK, color: '#121212', width: 1.4 },
    { text: sg.runway, glow: GLOW.SIGN_RED, color: '#b3170f', width: 3.0 },
    { text: sg.direction, glow: GLOW.SIGN_YELLOW, color: '#e3b51a', width: 2.2 },
  ];
  const total = panels.reduce((s, p) => s + p.width, 0);
  w.push().translate(sg.x, 0, sg.z);
  // Housing.
  w.paint(C.sign, SURF.PAINT, 0.5, 0.4);
  w.box(-total / 2 - 0.08, 0.35, -0.22, total / 2 + 0.08, 1.45, 0.18);
  w.paint('#9aa0a3', SURF.GALV, 0.45, 0.7);
  for (const x of [-total / 2 + 0.4, total / 2 - 0.4]) w.cbox(x, 0.18, 0, 0.14, 0.36, 0.14);
  let x = -total / 2;
  for (const p of panels) {
    const r = atlas?.rect(p.text);
    w.paint(p.color, SURF.SIGN, 0.45, 0, p.glow);
    const uv = r ? [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]] : null;
    w.poly([[x + 0.06, 0.45, 0.19], [x + p.width - 0.06, 0.45, 0.19], [x + p.width - 0.06, 1.35, 0.19], [x + 0.06, 1.35, 0.19]], uv, [0, 0, 1]);
    x += p.width;
  }
  w.pop();
}
