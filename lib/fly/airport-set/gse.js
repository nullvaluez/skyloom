// Ground support equipment: a procedural kit of airside vehicles, each built
// once into its own geometry and drawn as instances of the batched set.
//
// Every model faces -Z (front at -Z), sits on y = 0, is centred on its
// footprint, and is low-poly but shaped: chamfered bodies, real wheels, cab
// glass, bumpers, beacons and lamps. Liveries use generic airside colours
// (GSE yellow, white, orange, fuel-truck white with a red band) — never an
// operator's brand.
//
// `lights` are vehicle-local anchors for the glow set: beacons (amber,
// rotating), headlights and tail lights.
import { GLOW, SURF } from './mesh-writer.js';

const P = {
  yellow: '#e2a915',
  white: '#e4e5e1',
  orange: '#dd6a1d',
  grey: '#9ea4a8',
  dark: '#2b2f32',
  black: '#151617',
  glass: '#1a252b',
  steel: '#80878c',
  red: '#a8251c',
  blue: '#2c4f7a',
  canvas: '#3f5466',
  canvasRed: '#7f2a24',
  silver: '#b9bdc0',
  chrome: '#c7cbce',
  cone: '#f2621a',
};

function beacon(w, x, y, z) {
  w.paint(P.dark, SURF.PAINT, 0.5, 0.4);
  w.cylinder(x, y, z, 0.1, 0.05, 8, 'both');
  w.paint('#ffb54a', SURF.LAMP, 0.25, 0, GLOW.LAMP_AMBER);
  w.cylinder(x, y + 0.05, z, 0.085, 0.12, 8, 'top', 0.06);
}
function headlights(w, x, y, z, spread) {
  w.paint('#f2efe4', SURF.LAMP, 0.2, 0, GLOW.HEADLIGHT);
  for (const s of [-1, 1]) w.poly([[x + s * spread - 0.09, y - 0.06, z], [x + s * spread + 0.09, y - 0.06, z], [x + s * spread + 0.09, y + 0.06, z], [x + s * spread - 0.09, y + 0.06, z]].reverse(), null, [0, 0, -1]);
}
function taillights(w, x, y, z, spread) {
  w.paint('#e0322a', SURF.LAMP, 0.3, 0, GLOW.TAILLIGHT);
  for (const s of [-1, 1]) w.poly([[x + s * spread - 0.07, y - 0.05, z], [x + s * spread + 0.07, y - 0.05, z], [x + s * spread + 0.07, y + 0.05, z], [x + s * spread - 0.07, y + 0.05, z]], null, [0, 0, 1]);
}
/** Four wheels at (±tx, r, front/back). */
function wheels4(w, tx, r, zf, zb, width = 0.24) {
  for (const z of [zf, zb]) for (const s of [-1, 1]) w.wheel(s * tx, r, z, r, width, 12);
}

// --- vehicle builders -----------------------------------------------------------------

function tug(w, livery) {
  // Baggage tractor: low chassis, hood, open cab with a roll cage canopy.
  w.paint(livery, SURF.PAINT, 0.42, 0.15);
  w.chamferBox(0, 0.62, 0.1, 1.42, 0.62, 2.85, 0.08);
  w.chamferBox(0, 1.08, -0.85, 1.36, 0.42, 1.05, 0.1);
  w.paint(P.black, SURF.RUBBER, 0.8, 0);
  w.cbox(0, 0.42, -1.45, 1.5, 0.22, 0.14);
  w.cbox(0, 0.42, 1.58, 1.4, 0.26, 0.12);
  w.paint(P.dark, SURF.PAINT, 0.7, 0.1);
  w.cbox(0, 1.12, 0.55, 0.95, 0.12, 0.7); // seat base
  w.cbox(0, 1.45, 0.92, 0.95, 0.6, 0.1); // backrest
  w.paint(P.steel, SURF.PAINT, 0.45, 0.6);
  for (const sx of [-1, 1]) for (const sz of [-0.2, 1.2]) w.rod([sx * 0.62, 0.95, sz], [sx * 0.6, 1.98, sz], 0.035, 6);
  w.paint(livery, SURF.PAINT, 0.45, 0.15);
  w.chamferBox(0, 2.0, 0.5, 1.38, 0.08, 1.62, 0.03);
  w.paint(P.dark, SURF.PAINT, 0.4, 0.5);
  w.rod([0, 1.15, 0.1], [0, 1.45, -0.05], 0.03, 5);
  w.cylinder(0, 1.45, -0.08, 0.17, 0.03, 10, 'both');
  wheels4(w, 0.64, 0.3, -0.85, 0.95, 0.24);
  w.paint(P.steel, SURF.GALV, 0.5, 0.6);
  w.cbox(0, 0.5, 1.75, 0.18, 0.12, 0.3); // tow hitch
  headlights(w, 0, 0.98, -1.38, 0.48);
  taillights(w, 0, 0.82, 1.53, 0.52);
  beacon(w, 0.45, 2.04, 0.95);
}

function cart(w, canvas) {
  // Covered baggage cart: platform, four wheels, drawbar, roof on posts and
  // canvas side curtains rolled half up over a load of bags.
  w.paint(P.grey, SURF.PAINT, 0.55, 0.45);
  w.chamferBox(0, 0.52, 0, 1.5, 0.18, 2.75, 0.04);
  wheels4(w, 0.6, 0.24, -0.95, 0.95, 0.18);
  w.paint(P.steel, SURF.GALV, 0.5, 0.6);
  w.rod([0, 0.45, -1.35], [0, 0.32, -1.95], 0.04, 5);
  for (const sx of [-1, 1]) for (const sz of [-1.3, 1.3]) w.rod([sx * 0.72, 0.6, sz], [sx * 0.72, 1.95, sz], 0.03, 5);
  w.paint(canvas, SURF.PAINT, 0.88, 0);
  w.chamferBox(0, 1.98, 0, 1.56, 0.1, 2.78, 0.03);
  for (const sx of [-1, 1]) w.cbox(sx * 0.76, 1.68, 0, 0.04, 0.55, 2.66); // curtains rolled to half
  w.cbox(0, 1.25, -1.36, 1.46, 1.35, 0.04);
  // Bags.
  const bag = ['#262a2e', '#4a3a2a', '#20324a', '#5a1f1f', '#3b3f44', '#6b6f2e'];
  let k = 0;
  for (let z = -1.0; z <= 1.0; z += 0.55) for (let x = -0.4; x <= 0.4; x += 0.42) {
    w.paint(bag[k++ % bag.length], SURF.PAINT, 0.75, 0);
    w.chamferBox(x, 0.82 + (k % 2) * 0.05, z, 0.36, 0.42 + (k % 3) * 0.06, 0.5, 0.05);
  }
}

function dolly(w) {
  // ULD dolly with an LD3 container (the angled side faces +X).
  w.paint(P.dark, SURF.PAINT, 0.6, 0.4);
  w.chamferBox(0, 0.5, 0, 1.7, 0.16, 2.3, 0.04);
  wheels4(w, 0.68, 0.24, -0.8, 0.8, 0.18);
  w.paint(P.steel, SURF.GALV, 0.5, 0.6);
  w.rod([0, 0.45, -1.15], [0, 0.3, -1.8], 0.04, 5);
  w.paint(P.silver, SURF.CLADDING, 0.38, 0.75);
  w.prism([[-0.78, -1.0], [0.4, -1.0], [0.78, -0.62], [0.78, 1.0], [-0.78, 1.0]], 0.6, 2.2);
  w.paint('#59606a', SURF.RIBBED, 0.6, 0.3);
  w.poly([[-0.7, 0.7, -1.01], [0.35, 0.7, -1.01], [0.35, 2.05, -1.01], [-0.7, 2.05, -1.01]].reverse(), null, [0, 0, -1]);
}

function beltLoader(w, livery) {
  // Belt loader: low chassis with a side cab and an inclined conveyor boom
  // rising toward the front (the cargo door).
  w.paint(livery, SURF.PAINT, 0.45, 0.15);
  w.chamferBox(0, 0.62, 0.3, 1.9, 0.55, 6.2, 0.08);
  w.paint(P.black, SURF.RUBBER, 0.8, 0);
  w.cbox(0, 0.5, -2.9, 2.0, 0.3, 0.2);
  wheels4(w, 0.85, 0.34, -1.9, 2.4, 0.28);
  // Driver station on the right side, mid-ship.
  w.paint(livery, SURF.PAINT, 0.45, 0.15);
  w.chamferBox(-0.55, 1.25, 0.9, 0.8, 0.7, 1.2, 0.06);
  w.paint(P.dark, SURF.PAINT, 0.7, 0.1);
  w.cbox(-0.55, 1.75, 1.15, 0.6, 0.5, 0.12);
  w.paint(P.steel, SURF.PAINT, 0.45, 0.55);
  for (const sz of [0.35, 1.45]) w.rod([-0.92, 1.3, sz], [-0.92, 2.3, sz], 0.03, 5);
  w.paint(livery, SURF.PAINT, 0.45, 0.15);
  w.chamferBox(-0.55, 2.32, 0.9, 0.85, 0.06, 1.3, 0.02);
  // Boom: from 0.85 m at the back to 2.0 m at the front, over the chassis.
  const back = [0.35, 0.95, 3.4], front = [0.35, 2.05, -3.5];
  const dz = front[2] - back[2], dy = front[1] - back[1];
  const len = Math.hypot(dz, dy), pitch = Math.atan2(dy, -dz);
  w.push().translate(back[0], back[1], back[2]).rotateX(pitch);
  w.paint(P.steel, SURF.PAINT, 0.5, 0.55);
  w.box(-0.5, -0.25, -len, 0.5, 0, 0);
  w.paint(P.black, SURF.RUBBER, 0.85, 0);
  w.box(-0.42, 0, -len, 0.42, 0.04, 0);
  w.paint(livery, SURF.PAINT, 0.45, 0.2);
  w.box(-0.52, 0, -len, -0.46, 0.22, 0);
  w.box(0.46, 0, -len, 0.52, 0.22, 0);
  w.pop();
  w.paint(P.steel, SURF.PAINT, 0.5, 0.55);
  w.rod([0.35, 0.9, -1.6], [0.35, 1.62, -2.2], 0.07, 6); // lift ram
  headlights(w, 0, 0.75, -2.98, 0.7);
  taillights(w, 0, 0.75, 3.42, 0.8);
  beacon(w, -0.55, 2.36, 0.9);
}

function pushback(w, heavy) {
  // Conventional towbar tractor: long low ballasted body, raised cab at one
  // side, big tyres, hazard-striped bumpers.
  const L = heavy ? 7.6 : 5.8, W = heavy ? 3.4 : 2.5, H = heavy ? 1.45 : 1.2;
  w.paint(P.yellow, SURF.PAINT, 0.42, 0.15);
  w.chamferBox(0, 0.35 + H / 2, 0, W, H, L, 0.12);
  w.paint(P.yellow, SURF.HAZARD, 0.5, 0.1);
  w.cbox(0, 0.62, -L / 2 - 0.08, W - 0.2, 0.4, 0.18);
  w.cbox(0, 0.62, L / 2 + 0.08, W - 0.2, 0.4, 0.18);
  const r = heavy ? 0.7 : 0.55;
  wheels4(w, W / 2 - 0.25, r, -L / 2 + 1.1, L / 2 - 1.1, heavy ? 0.6 : 0.45);
  // Cab.
  const cx = -W / 2 + 0.85, cz = -L / 2 + 1.35;
  w.paint(P.yellow, SURF.PAINT, 0.42, 0.15);
  w.chamferBox(cx, 0.35 + H + 0.75, cz, 1.5, 1.5, 1.7, 0.1);
  w.paint(P.glass, SURF.GLASS, 0.06, 0, GLOW.INTERIOR_COOL);
  w.poly([[cx - 0.66, 0.35 + H + 0.55, cz - 0.86], [cx + 0.66, 0.35 + H + 0.55, cz - 0.86], [cx + 0.66, 0.35 + H + 1.35, cz - 0.86], [cx - 0.66, 0.35 + H + 1.35, cz - 0.86]].reverse(), null, [0, 0, -1]);
  for (const s of [-1, 1]) w.poly([[cx + s * 0.76, 0.35 + H + 0.55, cz - 0.7], [cx + s * 0.76, 0.35 + H + 0.55, cz + 0.6], [cx + s * 0.76, 0.35 + H + 1.35, cz + 0.6], [cx + s * 0.76, 0.35 + H + 1.35, cz - 0.7]], null, [s, 0, 0]);
  w.paint(P.steel, SURF.GALV, 0.5, 0.6);
  w.cbox(0, 0.85, -L / 2 - 0.35, 0.5, 0.3, 0.5); // towbar coupling
  headlights(w, 0.5, 0.35 + H - 0.2, -L / 2 - 0.01, W / 2 - 0.5);
  taillights(w, 0, 0.35 + H - 0.2, L / 2 + 0.01, W / 2 - 0.4);
  beacon(w, cx, 0.35 + H + 1.5, cz);
}

function truckCab(w, colour, zFront, width = 2.4) {
  // A forward-control truck cab: box with wraparound windscreen.
  w.paint(colour, SURF.PAINT, 0.38, 0.2);
  w.chamferBox(0, 1.55, zFront + 1.05, width, 2.1, 2.1, 0.14);
  w.paint(P.glass, SURF.GLASS, 0.05, 0, GLOW.INTERIOR_COOL);
  w.poly([[-width / 2 + 0.12, 1.65, zFront - 0.01], [width / 2 - 0.12, 1.65, zFront - 0.01], [width / 2 - 0.12, 2.45, zFront - 0.01], [-width / 2 + 0.12, 2.45, zFront - 0.01]].reverse(), null, [0, 0, -1]);
  for (const s of [-1, 1]) w.poly([[s * (width / 2 + 0.01), 1.7, zFront + 0.15], [s * (width / 2 + 0.01), 1.7, zFront + 1.3], [s * (width / 2 + 0.01), 2.4, zFront + 1.3], [s * (width / 2 + 0.01), 2.4, zFront + 0.15]], null, [s, 0, 0]);
  w.paint(P.black, SURF.RUBBER, 0.8, 0);
  w.cbox(0, 0.62, zFront - 0.05, width + 0.05, 0.3, 0.2);
  headlights(w, 0, 0.9, zFront - 0.16, width / 2 - 0.35);
}

function hydrant(w) {
  // Hydrant dispenser: small truck with a rear deck carrying the lift
  // platform, filter vessel and hose reels.
  truckCab(w, P.white, -3.4, 2.3);
  w.paint(P.dark, SURF.PAINT, 0.6, 0.4);
  w.chamferBox(0, 0.72, 0.6, 2.2, 0.45, 5.6, 0.06);
  wheels4(w, 0.98, 0.45, -2.2, 2.4, 0.32);
  w.paint(P.white, SURF.PAINT, 0.4, 0.2);
  w.chamferBox(0, 1.35, 1.0, 2.25, 0.9, 3.6, 0.08);
  w.paint(P.red, SURF.PAINT, 0.45, 0.1);
  w.cbox(0, 1.35, 1.0, 2.27, 0.18, 3.62);
  w.paint(P.chrome, SURF.PAINT, 0.25, 0.85);
  w.cylinder(-0.5, 1.8, 0.6, 0.38, 1.3, 14, 'top');
  w.paint(P.dark, SURF.RUBBER, 0.8, 0);
  w.push().translate(0.6, 2.05, 1.9).rotateZ(Math.PI / 2);
  w.cylinder(0, -0.4, 0, 0.45, 0.8, 14, 'both');
  w.pop();
  // Lift platform with rails, lowered.
  w.paint(P.yellow, SURF.PAINT, 0.5, 0.3);
  w.box(-1.0, 1.82, 2.4, 1.0, 1.92, 3.4);
  w.paint(P.steel, SURF.GALV, 0.5, 0.6);
  for (const s of [-1, 1]) w.rod([s * 0.95, 1.92, 3.35], [s * 0.95, 2.9, 3.35], 0.03, 5);
  w.rod([-0.95, 2.9, 3.35], [0.95, 2.9, 3.35], 0.03, 5);
  taillights(w, 0, 0.9, 3.42, 0.9);
  beacon(w, 0, 2.62, -2.5);
}

function bowser(w) {
  // Fuel tanker truck: cab, chassis, elliptical tank, rear cabinet.
  truckCab(w, P.white, -5.6, 2.5);
  w.paint(P.dark, SURF.PAINT, 0.6, 0.4);
  w.chamferBox(0, 0.78, 0.6, 2.2, 0.4, 9.6, 0.06);
  for (const z of [-4.3, 2.4, 3.8]) for (const s of [-1, 1]) w.wheel(s * 1.0, 0.5, z, 0.5, 0.36, 12);
  // Tank along Z (rotateX(+PI/2) turns the +Y cylinder axis into +Z).
  w.push().translate(0, 2.05, -3.3).rotateX(Math.PI / 2);
  w.paint(P.white, SURF.PAINT, 0.32, 0.25);
  w.cylinder(0, 0, 0, 1.15, 7.4, 18, 'both');
  w.pop();
  // Red band low on the tank flanks.
  w.paint(P.red, SURF.PAINT, 0.4, 0.15);
  w.box(-1.17, 1.55, -3.2, 1.17, 1.8, 4.0, 'py');
  w.paint(P.steel, SURF.GALV, 0.45, 0.7);
  w.box(-1.1, 3.18, -2.5, 1.1, 3.24, 3.4); // top walkway
  w.chamferBox(0, 1.5, 4.55, 2.3, 1.4, 0.9, 0.06);
  taillights(w, 0, 0.95, 5.02, 1.0);
  beacon(w, 0, 3.05, -5.0);
}

function catering(w, lift) {
  // High-lift catering truck: cab, scissor lift, insulated box with a front
  // platform that meets the door. `lift` is the box floor height (0 = driving).
  truckCab(w, P.blue, -3.9, 2.4);
  w.paint(P.dark, SURF.PAINT, 0.6, 0.4);
  w.chamferBox(0, 0.75, 0.4, 2.3, 0.4, 7.2, 0.06);
  wheels4(w, 1.02, 0.45, -2.7, 2.7, 0.32);
  const floor = Math.max(1.25, lift - 0.15);
  if (floor > 1.4) {
    // Scissor arms between the chassis and the box underside.
    w.paint(P.steel, SURF.PAINT, 0.5, 0.6);
    const n = 3, h = (floor - 1.0) / n;
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const y0 = 1.0 + i * h, y1 = y0 + h;
      w.rod([s * 1.0, y0, -1.6], [s * 1.0, y1, 2.6], 0.07, 6);
      w.rod([s * 1.0, y0, 2.6], [s * 1.0, y1, -1.6], 0.07, 6);
    }
  }
  w.paint(P.white, SURF.CLADDING, 0.4, 0.3);
  w.chamferBox(0, floor + 1.35, 0.6, 2.5, 2.6, 6.4, 0.08);
  w.paint(P.blue, SURF.PAINT, 0.45, 0.2);
  w.cbox(0, floor + 0.35, 0.6, 2.52, 0.25, 6.42);
  // Front platform (toward the aircraft) with folding rails.
  w.paint(P.steel, SURF.GALV, 0.5, 0.6);
  w.box(-1.1, floor - 0.05, -3.4, 1.1, floor + 0.05, -2.6);
  for (const s of [-1, 1]) w.rod([s * 1.05, floor + 0.05, -3.35], [s * 1.05, floor + 1.1, -3.35], 0.03, 5);
  w.rod([-1.05, floor + 1.1, -3.35], [1.05, floor + 1.1, -3.35], 0.03, 5);
  taillights(w, 0, 0.95, 4.05, 1.0);
  beacon(w, 0, floor + 2.7, 0.6);
}

function uldLoader(w) {
  // Lower-deck container loader: long flat frame, raised front bridge
  // platform at the door, rear lift platform, side cab.
  w.paint(P.yellow, SURF.PAINT, 0.45, 0.15);
  w.chamferBox(0, 0.62, 0.2, 3.2, 0.55, 8.6, 0.08);
  wheels4(w, 1.4, 0.4, -3.0, 3.2, 0.3);
  w.paint(P.steel, SURF.PAINT, 0.5, 0.55);
  for (const s of [-1, 1]) {
    w.rod([s * 1.2, 0.9, -3.2], [s * 1.2, 2.9, -2.0], 0.09, 6);
    w.rod([s * 1.2, 0.9, -2.0], [s * 1.2, 2.9, -3.2], 0.09, 6);
  }
  w.paint(P.yellow, SURF.PAINT, 0.45, 0.2);
  w.box(-1.5, 2.9, -4.1, 1.5, 3.1, -1.4); // bridge platform at sill height
  w.box(-1.5, 1.0, -0.9, 1.5, 1.2, 3.6); // rear platform
  w.paint(P.dark, SURF.RUBBER, 0.7, 0);
  for (let z = -3.9; z < -1.5; z += 0.35) w.cbox(0, 3.12, z, 2.7, 0.05, 0.1); // rollers
  w.paint(P.yellow, SURF.PAINT, 0.45, 0.15);
  w.chamferBox(1.25, 1.65, 1.6, 0.9, 1.2, 1.4, 0.08);
  w.paint(P.glass, SURF.GLASS, 0.06, 0, GLOW.INTERIOR_COOL);
  w.poly([[0.82, 1.5, 0.92], [1.68, 1.5, 0.92], [1.68, 2.15, 0.92], [0.82, 2.15, 0.92]].reverse(), null, [0, 0, -1]);
  headlights(w, 0, 0.8, -3.92, 1.2);
  beacon(w, 1.25, 2.3, 1.6);
}

function gpu(w) {
  // Ground power unit on a towed trailer, cable reel at the back.
  w.paint(P.dark, SURF.PAINT, 0.6, 0.4);
  w.chamferBox(0, 0.48, 0, 1.4, 0.16, 2.3, 0.04);
  wheels4(w, 0.62, 0.26, -0.75, 0.75, 0.2);
  w.paint(P.steel, SURF.GALV, 0.5, 0.6);
  w.rod([0, 0.45, -1.1], [0, 0.32, -1.75], 0.04, 5);
  w.paint(P.yellow, SURF.PAINT, 0.45, 0.2);
  w.chamferBox(0, 1.05, -0.1, 1.3, 1.0, 1.8, 0.07);
  w.paint(P.dark, SURF.LOUVRE, 0.5, 0.5);
  for (const s of [-1, 1]) w.poly([[s * 0.66, 0.75, -0.7], [s * 0.66, 0.75, 0.3], [s * 0.66, 1.4, 0.3], [s * 0.66, 1.4, -0.7]], null, [s, 0, 0]);
  w.paint(P.black, SURF.RUBBER, 0.7, 0);
  w.push().translate(0, 0.95, 1.0).rotateZ(Math.PI / 2);
  w.cylinder(0, -0.45, 0, 0.32, 0.9, 12, 'both');
  w.pop();
}

function stairs(w) {
  // Towable passenger stairs: wheeled base, inclined flight rising to a
  // front platform, handrails both sides.
  w.paint(P.grey, SURF.PAINT, 0.55, 0.4);
  w.chamferBox(0, 0.45, 0.6, 1.7, 0.25, 4.6, 0.05);
  wheels4(w, 0.75, 0.25, -1.3, 2.4, 0.2);
  const top = 1.95, n = 9;
  w.paint(P.white, SURF.PAINT, 0.5, 0.2);
  for (let i = 0; i < n; i++) {
    const y = 0.6 + ((top - 0.6) * (i + 1)) / n, z = 2.7 - (i + 1) * 0.38;
    w.box(-0.6, y - 0.06, z, 0.6, y, z + 0.38);
  }
  w.box(-0.65, top - 0.06, -1.55, 0.65, top, -0.72); // platform
  // Side stringers: the triangular plate under the flight on each side.
  w.paint(P.grey, SURF.PAINT, 0.5, 0.45);
  for (const s of [-1, 1]) {
    w.poly([[s * 0.66, 0.58, 2.8], [s * 0.66, 0.58, -0.7], [s * 0.66, top, -0.7]], null, [s, 0, 0]);
    w.poly([[s * 0.64, 0.58, 2.8], [s * 0.64, 0.58, -0.7], [s * 0.64, top, -0.7]], null, [-s, 0, 0]);
  }
  w.paint(P.steel, SURF.GALV, 0.45, 0.7);
  for (const s of [-1, 1]) {
    w.rod([s * 0.66, 1.55, 2.7], [s * 0.66, top + 1.0, -0.72], 0.03, 5);
    w.rod([s * 0.66, top + 1.0, -0.72], [s * 0.66, top + 1.0, -1.5], 0.03, 5);
    w.rod([s * 0.66, top, -1.5], [s * 0.66, top + 1.0, -1.5], 0.03, 5);
    w.rod([s * 0.66, 0.6, 2.7], [s * 0.66, 1.55, 2.7], 0.03, 5);
  }
}

function bus(w) {
  // Low-floor apron bus: long glazed box, rounded corners, doors both sides.
  const L = 13.5, W = 2.95, H = 2.95;
  w.paint(P.white, SURF.PAINT, 0.35, 0.2);
  w.chamferBox(0, 0.3 + H / 2, 0, W, H, L, 0.18);
  w.paint(P.glass, SURF.GLASS, 0.05, 0, GLOW.INTERIOR_WARM);
  for (const s of [-1, 1]) w.poly([[s * (W / 2 + 0.01), 1.0, -L / 2 + 0.6], [s * (W / 2 + 0.01), 1.0, L / 2 - 0.6], [s * (W / 2 + 0.01), 2.85, L / 2 - 0.6], [s * (W / 2 + 0.01), 2.85, -L / 2 + 0.6]].map((p) => (s < 0 ? p : p)), null, [s, 0, 0]);
  w.poly([[-W / 2 + 0.2, 1.0, -L / 2 - 0.01], [W / 2 - 0.2, 1.0, -L / 2 - 0.01], [W / 2 - 0.2, 2.9, -L / 2 - 0.01], [-W / 2 + 0.2, 2.9, -L / 2 - 0.01]].reverse(), null, [0, 0, -1]);
  w.paint(P.blue, SURF.PAINT, 0.4, 0.2);
  w.cbox(0, 0.62, 0, W + 0.02, 0.32, L + 0.02);
  w.paint(P.grey, SURF.PAINT, 0.45, 0.4);
  w.cbox(0, H + 0.38, 1.0, W - 0.5, 0.18, 4.0); // roof AC pod
  for (const z of [-L / 2 + 2.2, L / 2 - 2.2]) for (const s of [-1, 1]) w.wheel(s * (W / 2 - 0.3), 0.45, z, 0.45, 0.3, 12);
  headlights(w, 0, 0.75, -L / 2 - 0.03, W / 2 - 0.35);
  taillights(w, 0, 0.95, L / 2 + 0.03, W / 2 - 0.3);
  beacon(w, 0, H + 0.3, -L / 2 + 1.0);
}

function van(w) {
  // Airside operations van ("follow me" yellow with a hazard band).
  w.paint(P.yellow, SURF.PAINT, 0.35, 0.25);
  w.chamferBox(0, 0.85, 0, 1.95, 0.9, 4.9, 0.14);
  w.chamferBox(0, 1.72, 0.35, 1.9, 0.95, 3.9, 0.18);
  w.paint(P.yellow, SURF.HAZARD, 0.4, 0.1);
  w.cbox(0, 1.08, 0, 1.97, 0.22, 4.92);
  w.paint(P.glass, SURF.GLASS, 0.05, 0, GLOW.INTERIOR_COOL);
  w.poly([[-0.85, 1.4, -1.62], [0.85, 1.4, -1.62], [0.85, 2.05, -1.42], [-0.85, 2.05, -1.42]].reverse(), null, [0, 0.3, -1]);
  for (const s of [-1, 1]) w.poly([[s * 0.96, 1.42, -1.3], [s * 0.96, 1.42, 1.9], [s * 0.96, 2.05, 1.9], [s * 0.96, 2.05, -1.3]], null, [s, 0, 0]);
  wheels4(w, 0.86, 0.36, -1.6, 1.6, 0.25);
  w.paint(P.dark, SURF.PAINT, 0.5, 0.5);
  w.cbox(0, 2.24, 0, 1.3, 0.1, 0.35); // light bar
  headlights(w, 0, 0.82, -2.46, 0.68);
  taillights(w, 0, 0.95, 2.46, 0.78);
  beacon(w, -0.45, 2.29, 0);
  beacon(w, 0.45, 2.29, 0);
}

function cone(w) {
  w.paint(P.cone, SURF.PAINT, 0.6, 0);
  w.cbox(0, 0.02, 0, 0.38, 0.04, 0.38);
  w.cylinder(0, 0.04, 0, 0.16, 0.66, 10, 'top', 0.035);
  w.paint('#f4f4ee', SURF.PAINT, 0.35, 0);
  w.cylinder(0, 0.36, 0, 0.098, 0.12, 10, 'none', 0.078);
}

function chock(w) {
  w.paint('#e8b416', SURF.PAINT, 0.6, 0);
  for (const s of [-1, 1]) {
    w.push().translate(s * 0.45, 0, 0);
    w.poly([[-0.15, 0, -0.18], [0.15, 0, -0.18], [0.15, 0.22, 0.05], [-0.15, 0.22, 0.05]].reverse(), null, [0, 1, -1]);
    w.poly([[-0.15, 0, 0.18], [-0.15, 0.22, 0.05], [0.15, 0.22, 0.05], [0.15, 0, 0.18]].reverse(), null, [0, 1, 1]);
    for (const x of [-0.15, 0.15]) w.poly([[x, 0, -0.18], [x, 0, 0.18], [x, 0.22, 0.05]], null, [Math.sign(x), 0, 0]);
    w.pop();
  }
  w.paint(P.dark, SURF.RUBBER, 0.8, 0);
  w.rod([-0.3, 0.06, 0.1], [0.3, 0.06, 0.1], 0.015, 4);
}

/** Windsock: the sock alone (pivot at the origin, streaming toward -Z). */
function windsock(w) {
  const bands = 5, L = 3.6, r0 = 0.45, r1 = 0.2;
  for (let i = 0; i < bands; i++) {
    const a = i / bands, b = (i + 1) / bands;
    w.paint(i % 2 ? '#f2efe8' : '#f04f19', SURF.PAINT, 0.85, 0);
    w.push().rotateX(-Math.PI / 2);
    w.cylinder(0, a * L, 0, r0 + (r1 - r0) * a, (b - a) * L, 12, 'none', r0 + (r1 - r0) * b);
    w.pop();
  }
  w.paint('#9ca3a6', SURF.GALV, 0.4, 0.8);
  w.push().rotateX(-Math.PI / 2);
  w.cylinder(0, -0.05, 0, r0 + 0.03, 0.1, 12, 'none');
  w.pop();
}

/**
 * The kit. `build(writer)` emits the model; `length` is bumper to bumper
 * (trains space their carts with it); `lights` are local glow anchors.
 */
export const GSE_KIT = {
  tug: { build: (w) => tug(w, P.yellow), length: 3.3, lights: { beacon: [[0.45, 2.2, 0.95]], head: [[-0.48, 0.98, -1.4], [0.48, 0.98, -1.4]], tail: [[-0.52, 0.82, 1.55], [0.52, 0.82, 1.55]] } },
  'tug-white': { build: (w) => tug(w, P.white), length: 3.3, lights: { beacon: [[0.45, 2.2, 0.95]], head: [[-0.48, 0.98, -1.4], [0.48, 0.98, -1.4]], tail: [[-0.52, 0.82, 1.55], [0.52, 0.82, 1.55]] } },
  cart: { build: (w) => cart(w, P.canvas), length: 3.6 },
  'cart-red': { build: (w) => cart(w, P.canvasRed), length: 3.6 },
  dolly: { build: dolly, length: 3.5 },
  'belt-loader': { build: (w) => beltLoader(w, P.yellow), length: 7.0, lights: { beacon: [[-0.55, 2.5, 0.9]], head: [[-0.7, 0.75, -3.0], [0.7, 0.75, -3.0]], tail: [[-0.8, 0.75, 3.45], [0.8, 0.75, 3.45]] } },
  pushback: { build: (w) => pushback(w, false), length: 6.2, lights: { beacon: [[-0.4, 3.05, -1.55]], head: [[-0.75, 1.35, -2.92], [0.75, 1.35, -2.92]] } },
  'pushback-heavy': { build: (w) => pushback(w, true), length: 8.0, lights: { beacon: [[-0.85, 3.45, -2.45]], head: [[-1.2, 1.6, -3.82], [1.2, 1.6, -3.82]] } },
  hydrant: { build: hydrant, length: 7.0, lights: { beacon: [[0, 2.8, -2.5]], head: [[-0.8, 0.9, -3.58], [0.8, 0.9, -3.58]] } },
  bowser: { build: bowser, length: 11.0, lights: { beacon: [[0, 3.2, -5.0]], head: [[-0.9, 0.9, -5.78], [0.9, 0.9, -5.78]], tail: [[-1.0, 0.95, 5.05], [1.0, 0.95, 5.05]] } },
  catering: { build: (w) => catering(w, 0), length: 8.2, lights: { beacon: [[0, 4.2, 0.6]], head: [[-0.85, 0.9, -4.08], [0.85, 0.9, -4.08]], tail: [[-1.0, 0.95, 4.08], [1.0, 0.95, 4.08]] } },
  'catering-up': { build: (w) => catering(w, 3.4), length: 8.2, lights: { beacon: [[0, 6.2, 0.6]] } },
  'catering-up-wide': { build: (w) => catering(w, 5.0), length: 8.2, lights: { beacon: [[0, 7.8, 0.6]] } },
  'uld-loader': { build: uldLoader, length: 8.8, lights: { beacon: [[1.25, 2.45, 1.6]] } },
  gpu: { build: gpu, length: 3.0 },
  stairs: { build: stairs, length: 4.8 },
  bus: { build: bus, length: 13.6, lights: { beacon: [[0, 3.45, -5.75]], head: [[-1.12, 0.75, -6.8], [1.12, 0.75, -6.8]], tail: [[-1.17, 0.95, 6.8], [1.17, 0.95, 6.8]] } },
  van: { build: van, length: 4.9, lights: { beacon: [[-0.45, 2.45, 0], [0.45, 2.45, 0]], head: [[-0.68, 0.82, -2.48], [0.68, 0.82, -2.48]], tail: [[-0.78, 0.95, 2.48], [0.78, 0.95, 2.48]] } },
  cone: { build: cone, length: 0.4 },
  chock: { build: chock, length: 0.5 },
  windsock: { build: windsock, length: 3.6 },
};

/** Expand a mover kind into its vehicles (a train is a tug and N carts). */
export function moverParts(kind, seed = 0) {
  const m = /^train(\d)$/.exec(kind);
  if (m) {
    const parts = [{ type: seed % 3 === 0 ? 'tug-white' : 'tug', lead: true }];
    for (let i = 0; i < Number(m[1]); i++) parts.push({ type: (seed + i) % 4 === 0 ? 'cart-red' : 'cart' });
    return parts;
  }
  return [{ type: kind, lead: true }];
}
