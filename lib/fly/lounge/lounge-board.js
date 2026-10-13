// Observation lounge — the flight information boards on the back wall.
//
// One CanvasTexture (2048 x 576) holds both screens — ARRIVALS on the left,
// DEPARTURES on the right — so the pair is one draw. Redrawn at most once a
// second from the live runtime: runtime.airportWatch.board() when the
// experience workstream provides it ({ arrivals, departures, ground, overhead },
// rows { hex, label, airline, type, phase, category, distanceM, altM,
// speedMs, vsMs, etaS }), else the snapshot rows ({ hex, label, category,
// distance, speed, stale }). Real live aircraft only; nothing is invented —
// an empty section says so.
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
} from 'three';
import { BOARDS, BOARD_Z } from './room-plan.js';
import { CITIES } from '../poi/cities.js';

const W = 2048, H = 576, HALF = W / 2;
const FONT = '"JetBrains Mono", "IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
const SANS = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

function boardGeometry() {
  const pos = [], uv = [];
  BOARDS.forEach((b, i) => {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y0, y1 = b.y0 + b.h, z = BOARD_Z;
    const u0 = i * 0.5, u1 = u0 + 0.5;
    // facing -Z (toward the window and the seat)
    const quad = [[x1, y0, u0, 0], [x0, y0, u1, 0], [x0, y1, u1, 1], [x1, y0, u0, 0], [x0, y1, u1, 1], [x1, y1, u0, 1]];
    for (const [x, y, u, v] of quad) { pos.push(x, y, z); uv.push(u, v); }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Coarse local time for an airport: nearest city's standard offset + DST heuristics. */
export function airportUtcOffsetH(lat, lon, at = Date.now()) {
  let best = null, bd = Infinity;
  for (const c of CITIES) {
    const d = (c[1] - lat) ** 2 + ((c[2] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  let off = best ? best[3] : Math.round(lon / 15);
  const d = new Date(at), m = d.getUTCMonth(), day = d.getUTCDate();
  const north = lat > 25 && lat < 72;
  const americas = lon < -50 && lon > -170, europe = lon > -25 && lon < 45;
  if (north && americas && !(lat < 37 && lon < -109 && lon > -115)) {
    // second Sunday in March to first Sunday in November (approximately)
    if ((m > 2 && m < 10) || (m === 2 && day >= 10) || (m === 10 && day < 4)) off += 1;
  } else if (north && europe) {
    if ((m > 2 && m < 9) || (m === 2 && day >= 27) || (m === 9 && day < 27)) off += 1;
  } else if (lat < -28 && ((lon > 135 && lon < 155) || lon > 165)) {
    // south-east Australia and New Zealand
    if (m > 8 || m < 3 || (m === 3 && day < 6)) off += 1;
  }
  return off;
}

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms, offH) => { const d = new Date(ms + offH * 3600e3); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

const STATUS = {
  approach: ['APPROACH', '#ffb547'], final: ['FINAL', '#ff8a3d'], landing: ['LANDING', '#ff8a3d'], landed: ['LANDED', '#5be08a'],
  rollout: ['LANDED', '#5be08a'], taxi: ['TAXIING', '#6cb8ff'], taxiing: ['TAXIING', '#6cb8ff'], ground: ['AT STAND', '#9fb3c8'],
  parked: ['AT STAND', '#9fb3c8'], takeoff: ['TAKE-OFF', '#5be08a'], departure: ['CLIMBING', '#7fd8ff'], climb: ['CLIMBING', '#7fd8ff'],
  cruise: ['EN ROUTE', '#c7d2de'], overhead: ['OVERHEAD', '#c7d2de'], nearby: ['NEARBY', '#c7d2de'], descent: ['DESCENDING', '#ffb547'],
};
const status = (row) => STATUS[String(row.phase || '').toLowerCase()] || STATUS[row.category] || ['TRACKING', '#c7d2de'];

/** Normalise the runtime's rows into the board's sections. */
export function boardSections(watch) {
  const empty = { arrivals: [], departures: [], ground: [], overhead: [] };
  if (!watch?.active) return empty;
  let data = null;
  try {
    if (typeof watch.board === 'function') data = watch.board();
  } catch { data = null; }
  if (data && (data.arrivals || data.departures)) {
    return { arrivals: data.arrivals ?? [], departures: data.departures ?? [], ground: data.ground ?? [], overhead: data.overhead ?? [] };
  }
  let rows = [];
  try { rows = watch.snapshot?.() ?? []; } catch { rows = []; }
  const out = { arrivals: [], departures: [], ground: [], overhead: [] };
  for (const r of rows) {
    const row = { hex: r.hex, label: r.label, airline: '', type: r.type ?? '', phase: r.category, category: r.category, distanceM: r.distance, altM: r.altM ?? null, speedMs: r.speed, etaS: r.category === 'approach' && r.speed > 20 ? r.distance / r.speed : null };
    if (r.category === 'approach') out.arrivals.push(row);
    else if (r.category === 'departure') out.departures.push(row);
    else if (r.category === 'ground') out.ground.push(row);
    else out.overhead.push(row);
  }
  out.arrivals.sort((a, b) => (a.etaS ?? 1e9) - (b.etaS ?? 1e9));
  out.departures.sort((a, b) => a.distanceM - b.distanceM);
  out.overhead.sort((a, b) => a.distanceM - b.distanceM);
  return out;
}

/** Draw one board (title, sections) into the canvas half at x0. */
function drawBoard(ctx, x0, { title, glyph, ident, place, time, sections, live, blink }) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b1018');
  g.addColorStop(1, '#05070b');
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, HALF, H);
  // header
  ctx.fillStyle = '#111a26';
  ctx.fillRect(x0, 0, HALF, 92);
  ctx.fillStyle = '#e8b04a';
  ctx.fillRect(x0, 92, HALF, 3);
  drawGlyph(ctx, x0 + 46, 46, glyph);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f4f6f9';
  ctx.font = `700 46px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText(title, x0 + 86, 48);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffc56b';
  ctx.font = `600 44px ${FONT}`;
  ctx.fillText(time, x0 + HALF - 28, 40);
  ctx.fillStyle = '#8796a8';
  ctx.font = `500 19px ${SANS}`;
  ctx.fillText(`${ident} · ${place}`.toUpperCase().slice(0, 44), x0 + HALF - 28, 74);
  // columns
  const cols = [[30, 'TIME'], [150, 'FLIGHT'], [355, 'OPERATOR'], [610, 'TYPE'], [720, 'ALT FT'], [868, 'STATUS']];
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6f7d8f';
  ctx.font = `600 17px ${SANS}`;
  for (const [x, label] of cols) ctx.fillText(label, x0 + x, 122);
  let y = 146;
  const rowH = 46;
  for (const section of sections) {
    if (section.heading) {
      ctx.fillStyle = '#1a2533';
      ctx.fillRect(x0 + 18, y, HALF - 36, 30);
      ctx.fillStyle = '#9fb0c4';
      ctx.font = `700 16px ${SANS}`;
      ctx.fillText(section.heading, x0 + 30, y + 16);
      y += 36;
    }
    if (!section.rows.length) {
      ctx.fillStyle = '#56657a';
      ctx.font = `500 22px ${SANS}`;
      ctx.fillText(section.empty, x0 + 30, y + rowH / 2);
      y += rowH;
      continue;
    }
    for (let i = 0; i < section.rows.length && y < H - 40; i++) {
      const r = section.rows[i];
      if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.028)'; ctx.fillRect(x0 + 18, y, HALF - 36, rowH); }
      const mid = y + rowH / 2 + 1;
      ctx.font = `500 26px ${FONT}`;
      ctx.fillStyle = '#ffc56b';
      ctx.fillText(r.time, x0 + 30, mid);
      ctx.fillStyle = '#f4f6f9';
      ctx.font = `700 27px ${FONT}`;
      ctx.fillText(String(r.label || r.hex || '').toUpperCase().slice(0, 9), x0 + 150, mid);
      ctx.fillStyle = '#c6cfda';
      ctx.font = `500 22px ${SANS}`;
      ctx.fillText(String(r.airline || '—').slice(0, 17), x0 + 355, mid);
      ctx.font = `500 24px ${FONT}`;
      ctx.fillStyle = '#e1e7ee';
      ctx.fillText(String(r.type || '—').toUpperCase().slice(0, 5), x0 + 610, mid);
      ctx.fillText(r.alt, x0 + 720, mid);
      const [word, color] = r.status;
      const flashing = word === 'FINAL' || word === 'LANDING';
      if (!flashing || blink) {
        ctx.font = `700 20px ${SANS}`;
        const w = ctx.measureText(word).width + 22;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(x0 + 864, mid - 16, w, 32);
        ctx.globalAlpha = 1;
        ctx.fillText(word, x0 + 875, mid + 1);
      }
      y += rowH;
    }
  }
  // footer
  ctx.fillStyle = '#4f5d70';
  ctx.font = `500 15px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText(live ? 'LIVE ADS-B · ACTUAL AIRCRAFT ONLY' : 'WAITING FOR LIVE TRAFFIC', x0 + 30, H - 18);
  ctx.textAlign = 'right';
  ctx.fillText('SKYLOOM LOUNGE', x0 + HALF - 28, H - 18);
  // bezel shading so the screen reads as a panel
  const v = ctx.createLinearGradient(x0, 0, x0 + HALF, 0);
  v.addColorStop(0, 'rgba(0,0,0,0.35)');
  v.addColorStop(0.04, 'rgba(0,0,0,0)');
  v.addColorStop(0.96, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = v;
  ctx.fillRect(x0, 0, HALF, H);
}

function drawGlyph(ctx, cx, cy, kind) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(kind === 'arrive' ? 0.5 : -0.5);
  ctx.fillStyle = '#e8b04a';
  ctx.beginPath();
  // a simple airliner silhouette, nose to +x
  ctx.moveTo(22, 0); ctx.lineTo(10, -3); ctx.lineTo(-2, -3); ctx.lineTo(-10, -18); ctx.lineTo(-15, -18); ctx.lineTo(-9, -3);
  ctx.lineTo(-18, -3); ctx.lineTo(-22, -9); ctx.lineTo(-25, -9); ctx.lineTo(-22, 0); ctx.lineTo(-25, 9); ctx.lineTo(-22, 9);
  ctx.lineTo(-18, 3); ctx.lineTo(-9, 3); ctx.lineTo(-15, 18); ctx.lineTo(-10, 18); ctx.lineTo(-2, 3); ctx.lineTo(10, 3); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The boards. `doc` supplies the canvas (absent in node: geometry only). */
export function createLoungeBoard(doc = typeof document !== 'undefined' ? document : null) {
  const canvas = doc?.createElement?.('canvas') ?? null;
  let ctx = null, texture = null;
  if (canvas) {
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.name = 'lounge-board';
  }
  // Unlit screen: the canvas colours at a display-like radiance.
  const material = new MeshBasicMaterial({ map: texture, color: new Color(1.35, 1.35, 1.35), fog: false, name: 'lounge-board' });
  const mesh = new Mesh(boardGeometry(), material);
  mesh.name = 'lounge:board';
  mesh.frustumCulled = false;
  let last = -Infinity, offH = null, clockBase = null, frames = 0;
  return {
    mesh,
    texture,
    /** Redraw (at most once per second). `now` in ms, `watch` = runtime.airportWatch. */
    update(now, watch, force = false) {
      if (!ctx || (!force && now - last < 1000)) return false;
      last = now;
      frames += 1;
      const airport = watch?.airport;
      const lat = airport?.a?.lat ?? 0, lon = airport?.a?.lon ?? 0;
      const pin = typeof window !== 'undefined' && Number.isFinite(window.__flySunOverride) ? window.__flySunOverride : null;
      if (clockBase == null || clockBase.pin !== pin) clockBase = { pin, real: Date.now() };
      const worldNow = pin != null ? pin + (Date.now() - clockBase.real) : Date.now();
      if (offH == null || frames % 600 === 0) offH = airportUtcOffsetH(lat, lon, worldNow);
      const s = boardSections(watch);
      const fmtAlt = (r) => (Number.isFinite(r.altM) ? (r.category === 'ground' ? 'GND' : String(Math.round((r.altM * 3.28084) / 100) * 100)) : '—');
      const rows = (list, kind) => list.slice(0, 8).map((r) => ({
        ...r,
        time: kind === 'arr' && Number.isFinite(r.etaS) ? clock(worldNow + r.etaS * 1000, offH) : kind === 'arr' ? '--:--' : clock(worldNow, offH),
        alt: fmtAlt(r),
        status: status(r),
      }));
      const ident = airport?.ident ?? String(airport?.id ?? '').split(':')[0] ?? '';
      const place = airport?.name ?? airport?.city ?? '';
      const time = clock(worldNow, offH);
      const live = (s.arrivals.length + s.departures.length + s.ground.length + s.overhead.length) > 0;
      const arr = rows(s.arrivals, 'arr'), dep = rows(s.departures, 'dep');
      const blink = Math.floor(now / 1000) % 2 === 0;
      drawBoard(ctx, 0, {
        title: 'ARRIVALS', glyph: 'arrive', ident, place, time, live, blink,
        sections: [
          { rows: arr.slice(0, 6), empty: 'No arrivals on approach right now' },
          { heading: 'OVERHEAD', rows: rows(s.overhead, 'ovh').slice(0, Math.max(1, 6 - arr.length)), empty: 'Clear skies overhead' },
        ],
      });
      drawBoard(ctx, HALF, {
        title: 'DEPARTURES', glyph: 'depart', ident, place, time, live, blink,
        sections: [
          { rows: dep.slice(0, 6), empty: 'No departures climbing out right now' },
          { heading: 'ON THE GROUND', rows: rows(s.ground, 'gnd').slice(0, Math.max(1, 6 - dep.length)), empty: 'No aircraft reported on the ground' },
        ],
      });
      texture.needsUpdate = true;
      return true;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture?.dispose();
    },
  };
}
