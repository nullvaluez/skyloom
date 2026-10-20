/**
 * Living World (TITLE_MOTION) — builds the title cards' line art.
 *
 * Four original SVG drawings in the menus' instrument line style: ice lines,
 * selected-cyan for the flown route, amber for where you are going. They are
 * drawn here from geometry (a runway in true one-point perspective, a great
 * circle over the Earth's limb, a binocular field of view, a four-stop route
 * over contour lines) rather than by hand, so a tweak is a number, not a
 * redraw. No third-party art; the output is committed and served as CSS
 * backgrounds (components/fly/hud/title.css), so the AirportEntry card,
 * which another file renders, can wear its art without a markup change.
 *
 * Run: node scripts/build-title-art.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, '..', 'components', 'fly', 'hud', 'title-art');
mkdirSync(OUT, { recursive: true });

const ICE = '#eef5ff';
const CYAN = '#7fe7ff';
const AMBER = '#ffbf5e';
const RED = '#ff7a6b';
const WARM = '#ffd9a0';
const f = (n) => Number(n.toFixed(2));
const lerp = (a, b, t) => a + (b - a) * t;

/** A top-view airliner pointing +x, about 17 units long, centred on the origin. */
const PLANE =
  'M8 0L5-1L1-1.2L-2-7.6L-4-7.6L-2.6-1.2L-6.4-1L-8-3.6L-9.3-3.6L-8.4 0L-9.3 3.6L-8 3.6L-6.4 1L-2.6 1.2L-4 7.6L-2 7.6L1 1.2L5 1Z';
const plane = (x, y, deg, scale = 1, fill = ICE) =>
  `<path d="${PLANE}" fill="${fill}" transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)}) scale(${scale})"/>`;

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;

/** Perspective spacing: equal ground steps shrink toward the horizon. */
const persp = (i, k = 0.55) => 1 - 1 / (1 + i * k);

// ---------------------------------------------------------------------------
// Takeoff & Landing — a runway on approach, PAPI on the glide path.
function runway() {
  const W = 320;
  const H = 120;
  const horizon = 40;
  const vp = { x: 196, y: horizon };
  const near = { y: 124, l: 118, r: 292 };
  const y = (t) => lerp(near.y, vp.y, t);
  const lx = (t) => lerp(near.l, vp.x, t);
  const rx = (t) => lerp(near.r, vp.x, t);
  const at = (t, u) => ({ x: lerp(lx(t), rx(t), (u + 1) / 2), y: y(t) });
  const far = (near.y - (horizon + 6)) / (near.y - horizon);
  const parts = [];
  parts.push(
    `<defs><radialGradient id="g" cx="0.5" cy="1" r="0.5" gradientTransform="translate(0.5 1) scale(1 0.32) translate(-0.5 -1)"><stop offset="0" stop-color="${CYAN}" stop-opacity="0.3"/><stop offset="1" stop-color="${CYAN}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect x="${vp.x - 170}" y="${horizon - 40}" width="340" height="40" fill="url(#g)"/>`,
    `<path d="M0 ${horizon}H${W}" stroke="${ICE}" stroke-opacity="0.22"/>`,
  );
  // Surface and edges.
  const a = at(0, -1);
  const b = at(far, -1);
  const c = at(far, 1);
  const d = at(0, 1);
  parts.push(
    `<path d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}L${f(c.x)} ${f(c.y)}L${f(d.x)} ${f(d.y)}Z" fill="${ICE}" fill-opacity="0.05"/>`,
    `<path d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}M${f(d.x)} ${f(d.y)}L${f(c.x)} ${f(c.y)}M${f(b.x)} ${f(b.y)}L${f(c.x)} ${f(c.y)}" stroke="${ICE}" stroke-opacity="0.6" stroke-width="1.2"/>`,
  );
  // Centreline dashes.
  for (let i = 0; i < 14; i++) {
    const t0 = persp(i, 0.5) * far;
    const t1 = lerp(t0, persp(i + 1, 0.5) * far, 0.5);
    if (t0 < 0.16) continue;
    const p = at(t0, 0);
    const q = at(t1, 0);
    parts.push(`<path d="M${f(p.x)} ${f(p.y)}L${f(q.x)} ${f(q.y)}" stroke="${ICE}" stroke-opacity="0.55" stroke-width="${f(1.6 * (1 - t0) + 0.4)}"/>`);
  }
  // Threshold piano keys.
  for (const u of [-0.84, -0.68, -0.52, -0.36, 0.36, 0.52, 0.68, 0.84]) {
    const p = at(0.02, u);
    const q = at(0.12, u);
    parts.push(`<path d="M${f(p.x)} ${f(p.y)}L${f(q.x)} ${f(q.y)}" stroke="${ICE}" stroke-opacity="0.75" stroke-width="2.4"/>`);
  }
  // Touchdown zone bars.
  for (const u of [-0.42, 0.42]) {
    const p = at(0.27, u);
    const q = at(0.33, u);
    parts.push(`<path d="M${f(p.x)} ${f(p.y)}L${f(q.x)} ${f(q.y)}" stroke="${ICE}" stroke-opacity="0.55" stroke-width="3"/>`);
  }
  // Edge lights, then the red end lights.
  for (let i = 0; i < 16; i++) {
    const t = persp(i, 0.42) * far;
    for (const u of [-1.1, 1.1]) {
      const p = at(t, u);
      const r = 0.35 + 1.7 * Math.pow(1 - t, 0.8);
      parts.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(r)}" fill="${WARM}" fill-opacity="${f(0.45 + 0.5 * (1 - t))}"/>`);
    }
  }
  for (const u of [-0.75, -0.25, 0.25, 0.75]) {
    const p = at(far, u);
    parts.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="0.9" fill="${RED}"/>`);
  }
  // PAPI: on the glide path, the two units nearest the runway show red.
  const papi = [
    [-1.4, RED],
    [-1.62, RED],
    [-1.84, ICE],
    [-2.06, ICE],
  ];
  for (const [u, col] of papi) {
    const p = at(0.3, u);
    parts.push(
      `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="4.2" fill="${col}" fill-opacity="0.18"/>`,
      `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="1.7" fill="${col}"/>`,
    );
  }
  // The glide path to the touchdown point, and the aircraft on it.
  const td = at(0.3, 0);
  const from = { x: 26, y: 4 };
  const ac = { x: lerp(from.x, td.x, 0.36), y: lerp(from.y, td.y, 0.36) };
  const ang = (Math.atan2(td.y - from.y, td.x - from.x) * 180) / Math.PI;
  parts.push(
    `<path d="M${f(from.x)} ${f(from.y)}L${f(ac.x)} ${f(ac.y)}" stroke="${CYAN}" stroke-opacity="0.5" stroke-width="1.2"/>`,
    `<path d="M${f(ac.x)} ${f(ac.y)}L${f(td.x)} ${f(td.y)}" stroke="${CYAN}" stroke-width="1.3" stroke-dasharray="2 4"/>`,
    `<circle cx="${f(td.x)}" cy="${f(td.y)}" r="3" stroke="${CYAN}" stroke-width="1.2"/>`,
    plane(ac.x, ac.y, ang, 0.95),
  );
  return svg(W, H, parts.join(''));
}

// ---------------------------------------------------------------------------
// Where will you fly? — a great circle over the Earth's limb.
function explore() {
  const W = 480;
  const H = 140;
  const cx = 240;
  const cy = 760;
  const R = 680;
  const limbY = (x, r = R) => cy - Math.sqrt(r * r - (x - cx) ** 2);
  const arc = (r) => `M0 ${f(limbY(0, r))}A${r} ${r} 0 0 1 ${W} ${f(limbY(W, r))}`;
  const parts = [];
  parts.push(
    `<defs><linearGradient id="limb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ICE}" stop-opacity="0.15"/><stop offset="0.5" stop-color="${CYAN}" stop-opacity="0.9"/><stop offset="1" stop-color="${ICE}" stop-opacity="0.15"/></linearGradient>` +
      `<linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${CYAN}" stop-opacity="0"/><stop offset="1" stop-color="${CYAN}"/></linearGradient>` +
      `<radialGradient id="dest"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.35"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient></defs>`,
  );
  // Air glow above the limb, then the limb.
  parts.push(
    `<path d="${arc(R + 16)}" stroke="${CYAN}" stroke-opacity="0.06" stroke-width="10"/>`,
    `<path d="${arc(R + 6)}" stroke="${CYAN}" stroke-opacity="0.16" stroke-width="4"/>`,
    `<path d="${arc(R)}" stroke="url(#limb)" stroke-width="1.5"/>`,
  );
  // Graticule below the limb.
  for (const r of [R - 22, R - 50]) parts.push(`<path d="${arc(r)}" stroke="${ICE}" stroke-opacity="0.1"/>`);
  for (const x of [70, 150, 240, 330, 410]) {
    const y0 = limbY(x);
    const dx = cx - x;
    const dy = cy - y0;
    const n = Math.hypot(dx, dy);
    parts.push(`<path d="M${f(x)} ${f(y0)}L${f(x + (dx / n) * 60)} ${f(y0 + (dy / n) * 60)}" stroke="${ICE}" stroke-opacity="0.1"/>`);
  }
  // City lights on the night side of the limb.
  for (const [x, dy] of [[52, 10], [58, 13], [126, 9], [131, 12], [137, 8], [298, 7], [350, 11], [355, 8], [418, 12], [446, 14]]) {
    parts.push(`<circle cx="${x}" cy="${f(limbY(x) + dy)}" r="1.15" fill="${WARM}" fill-opacity="0.8"/>`);
  }
  // The route: a quadratic great circle, flown to t, the rest to come.
  const O = { x: 108, y: limbY(108) + 10 };
  const D = { x: 372, y: limbY(372) + 9 };
  const C = { x: 236, y: -18 };
  const t = 0.6;
  const q0 = { x: lerp(O.x, C.x, t), y: lerp(O.y, C.y, t) };
  const q1 = { x: lerp(C.x, D.x, t), y: lerp(C.y, D.y, t) };
  const S = { x: lerp(q0.x, q1.x, t), y: lerp(q0.y, q1.y, t) };
  const ang = (Math.atan2(q1.y - q0.y, q1.x - q0.x) * 180) / Math.PI;
  parts.push(
    `<path d="M${f(O.x)} ${f(O.y)}Q${f(q0.x)} ${f(q0.y)} ${f(S.x)} ${f(S.y)}" stroke="url(#trail)" stroke-width="1.6"/>`,
    `<path d="M${f(S.x)} ${f(S.y)}Q${f(q1.x)} ${f(q1.y)} ${f(D.x)} ${f(D.y)}" stroke="${ICE}" stroke-opacity="0.5" stroke-width="1.2" stroke-dasharray="2 5"/>`,
    `<circle cx="${f(O.x)}" cy="${f(O.y)}" r="3" stroke="${ICE}" stroke-opacity="0.7" stroke-width="1.2"/>`,
    `<circle cx="${f(D.x)}" cy="${f(D.y)}" r="14" fill="url(#dest)"/>`,
    `<circle cx="${f(D.x)}" cy="${f(D.y)}" r="5" stroke="${AMBER}" stroke-width="1.4"/>`,
    `<circle cx="${f(D.x)}" cy="${f(D.y)}" r="1.8" fill="${AMBER}"/>`,
    plane(S.x, S.y, ang, 1.05),
  );
  // A few faint stars above the air.
  for (const [x, y2, r] of [[36, 22, 0.9], [168, 12, 0.7], [312, 18, 0.8], [452, 30, 0.9], [90, 46, 0.6]]) {
    parts.push(`<circle cx="${x}" cy="${y2}" r="${r}" fill="${ICE}" fill-opacity="0.4"/>`);
  }
  return svg(W, H, parts.join(''));
}

// ---------------------------------------------------------------------------
// Watch an airport — the field through binoculars.
function watch() {
  const W = 320;
  const H = 120;
  const r = 50;
  const c1 = { x: 128, y: 62 };
  const c2 = { x: 192, y: 62 };
  const half = (c2.x - c1.x) / 2;
  const iy = Math.sqrt(r * r - half * half);
  const mx = (c1.x + c2.x) / 2;
  const view = `M${mx} ${f(c1.y - iy)}A${r} ${r} 0 1 0 ${mx} ${f(c1.y + iy)}A${r} ${r} 0 1 0 ${mx} ${f(c1.y - iy)}Z`;
  const horizon = 71;
  const parts = [];
  parts.push(
    `<defs><clipPath id="v"><path d="${view}"/></clipPath>` +
      `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${CYAN}" stop-opacity="0"/><stop offset="1" stop-color="${CYAN}" stop-opacity="0.14"/></linearGradient></defs>`,
    `<g clip-path="url(#v)">`,
    `<rect x="60" y="${horizon - 34}" width="200" height="34" fill="url(#sky)"/>`,
    `<path d="M60 ${horizon}H260" stroke="${ICE}" stroke-opacity="0.35"/>`,
    // Terminal and tower.
    `<path d="M70 ${horizon}V60H98V${horizon}" stroke="${ICE}" stroke-opacity="0.35"/>`,
    `<path d="M74 64H94" stroke="${ICE}" stroke-opacity="0.2"/>`,
    `<path d="M102 ${horizon}L104 42M110 ${horizon}L108 42" stroke="${ICE}" stroke-opacity="0.6" stroke-width="1.2"/>`,
    `<path d="M97 42H115L112.5 33H99.5Z" stroke="${ICE}" stroke-opacity="0.7" stroke-width="1.2" fill="${CYAN}" fill-opacity="0.12"/>`,
    `<path d="M106 33V26" stroke="${ICE}" stroke-opacity="0.6"/>`,
    `<circle cx="106" cy="25" r="1.2" fill="${RED}"/>`,
    // Runway band and the aircraft lifting off it.
    `<path d="M126 77H262M134 82H262" stroke="${ICE}" stroke-opacity="0.3"/>`,
    `<path d="M150 79.5H178" stroke="${ICE}" stroke-opacity="0.5" stroke-dasharray="4 4"/>`,
    `<path d="M168 79L203 56" stroke="${CYAN}" stroke-width="1.3" stroke-dasharray="2 4"/>`,
    plane(209, 52, -33, 1),
    // A rangefinder scale in the right eyepiece.
    `<path d="M172 96H212" stroke="${ICE}" stroke-opacity="0.35"/>`,
    ...[172, 180, 188, 196, 204, 212].map((x, i) => `<path d="M${x} 96V${i % 2 ? 93 : 91}" stroke="${ICE}" stroke-opacity="0.35"/>`),
    `</g>`,
    `<path d="${view}" stroke="${ICE}" stroke-opacity="0.45" stroke-width="1.3"/>`,
    `<path d="M${c2.x - 5} ${c2.y}H${c2.x + 5}M${c2.x} ${c2.y - 5}V${c2.y + 5}" stroke="${CYAN}" stroke-opacity="0.6"/>`,
  );
  return svg(W, H, parts.join(''));
}

// ---------------------------------------------------------------------------
// Guided journeys — four discoveries on a route over contour lines.
function journeys() {
  const W = 320;
  const H = 120;
  const parts = [];
  // Contours: closed, slightly wavy rings around a summit.
  const centre = { x: 176, y: 62 };
  const rings = [
    [92, 0.09],
    [70, 0.12],
    [48, 0.15],
    [27, 0.19],
    [10, 0.24],
  ];
  for (const [R, op] of rings) {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const th = (i / 96) * Math.PI * 2;
      const k = 1 + 0.1 * Math.sin(3 * th + 0.7) + 0.06 * Math.sin(5 * th + 2.1) + (R < 30 ? 0.05 * Math.sin(2 * th) : 0);
      pts.push(`${f(centre.x + Math.cos(th) * R * 1.55 * k)} ${f(centre.y + Math.sin(th) * R * 0.6 * k)}`);
    }
    parts.push(`<path d="M${pts.join('L')}Z" stroke="${ICE}" stroke-opacity="${op}"/>`);
  }
  const w = [
    { x: 44, y: 88 },
    { x: 116, y: 46 },
    { x: 196, y: 84 },
    { x: 274, y: 38 },
  ];
  parts.push(
    `<path d="M${w[0].x} ${w[0].y}C74 88 86 46 ${w[1].x} ${w[1].y}S166 84 ${w[2].x} ${w[2].y}" stroke="${CYAN}" stroke-width="1.6"/>`,
    `<path d="M${w[2].x} ${w[2].y}C226 84 244 38 ${w[3].x} ${w[3].y}" stroke="${ICE}" stroke-opacity="0.5" stroke-width="1.2" stroke-dasharray="2 5"/>`,
  );
  for (const p of w.slice(0, 3)) {
    parts.push(
      `<circle cx="${p.x}" cy="${p.y}" r="7.5" stroke="${CYAN}" stroke-opacity="0.35"/>`,
      `<circle cx="${p.x}" cy="${p.y}" r="3.6" fill="${CYAN}"/>`,
    );
  }
  const z = w[3];
  parts.push(
    `<circle cx="${z.x}" cy="${z.y}" r="13" fill="${AMBER}" fill-opacity="0.08"/>`,
    `<circle cx="${z.x}" cy="${z.y}" r="6.5" stroke="${AMBER}" stroke-width="1.4"/>`,
    `<circle cx="${z.x}" cy="${z.y}" r="2" fill="${AMBER}"/>`,
  );
  return svg(W, H, parts.join(''));
}

const files = { 'runway.svg': runway(), 'explore.svg': explore(), 'watch.svg': watch(), 'journeys.svg': journeys() };
for (const [name, text] of Object.entries(files)) {
  writeFileSync(path.join(OUT, name), text);
  console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, name))} (${text.length} bytes)`);
}
