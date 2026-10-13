// Observation lounge — the flight information boards on the back wall.
//
// One CanvasTexture (1536 x 432, drawn in a 2048 x 576 layout space) holds both screens — ARRIVALS on the left,
// DEPARTURES on the right — so the pair is one draw. Redrawn at most once a
// second from the live runtime: runtime.airportWatch.board() (cached 400 ms by
// its owner) returns { arrivals, departures, ground, overhead, local, at }:
// arrivals sorted by ETA, the rest by distance, rows { hex, label, airline,
// type, typeCode, phase, phaseLabel, category, distanceM, altM, aglM,
// speedMs, vsMs, etaS (arrivals), runway, stale }. Without it the board
// falls back to snapshot() rows. Real live aircraft only; there are no
// schedules, so nothing is invented: arrivals show their live ETA,
// departures the runway they left from, and an empty section says so.
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
// The same local clock the lounge HUD shows (zone + daylight-saving rules,
// labelled mean solar time where no zone is known), so the two never disagree.
import { localClockAt } from '../airport-watch-sky.mjs';

const W = 2048, H = 576, HALF = W / 2;
// The canvas is 3/4 of the layout: from the seat a 4.8 m board spans ~360 px,
// so 768 px per screen is still 2x oversampled, and the pair costs 3.4 MiB
// with mips instead of 6 (the room's texture budget is 24 MiB).
const SCALE = 0.75;
/** The canvas the boards draw into (texture budget: x4 bytes, x4/3 mips). */
export const BOARD_CANVAS = Object.freeze({ width: Math.round(W * SCALE), height: Math.round(H * SCALE) });
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

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms, offH) => { const d = new Date(ms + offH * 3600e3); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

// FIDS status words, by the board's flight phase (lib/fly/flight-phase.js
// values) and, failing that, by the row's list.
const STATUS = {
  approach: ['APPROACH', '#ffb547'], final: ['FINAL', '#ff8a3d'], descent: ['DESCENDING', '#ffb547'],
  runway: ['ON RUNWAY', '#ff8a3d'], taxi: ['TAXIING', '#6cb8ff'], parked: ['AT STAND', '#9fb3c8'],
  'climb-out': ['DEPARTED', '#5be08a'], departure: ['DEPARTED', '#5be08a'], climb: ['CLIMBING', '#7fd8ff'],
  cruise: ['EN ROUTE', '#c7d2de'], level: ['EN ROUTE', '#c7d2de'],
  arrival: ['APPROACH', '#ffb547'], ground: ['AT STAND', '#9fb3c8'], overhead: ['OVERHEAD', '#c7d2de'], local: ['NEARBY', '#c7d2de'],
};
export function status(row) {
  const label = String(row.phaseLabel || '');
  if (row.category === 'arrival' && (row.etaS === 0 || /^landed/i.test(label))) return ['LANDED', '#5be08a'];
  if (/takeoff roll/i.test(label)) return ['TAKE-OFF', '#5be08a'];
  if (row.stale >= 2) return ['NO SIGNAL', '#6f7d8f'];
  const s = STATUS[String(row.phase || '').toLowerCase()] || STATUS[row.category] || ['TRACKING', '#c7d2de'];
  // a final with a runway reads "FINAL 28L" (the board knows the runway)
  return row.runway && (s[0] === 'FINAL' || s[0] === 'APPROACH') ? [`${s[0]} ${row.runway}`.slice(0, 13), s[1]] : s;
}

/** Normalise the runtime's rows into the board's sections. */
export function boardSections(watch) {
  const empty = { arrivals: [], departures: [], ground: [], overhead: [] };
  if (!watch?.active) return empty;
  let data = null;
  try {
    if (typeof watch.board === 'function') data = watch.board();
  } catch { data = null; }
  if (data && (data.arrivals || data.departures)) {
    // "local" (airborne nearby, not over the field) shares the overhead section
    const overhead = [...(data.overhead ?? []), ...(data.local ?? [])].sort((a, b) => a.distanceM - b.distanceM);
    return { arrivals: data.arrivals ?? [], departures: data.departures ?? [], ground: data.ground ?? [], overhead };
  }
  let rows = [];
  try { rows = watch.snapshot?.() ?? []; } catch { rows = []; }
  const out = { arrivals: [], departures: [], ground: [], overhead: [] };
  for (const r of rows) {
    const cat = r.category === 'approach' ? 'arrival' : r.category === 'departure' ? 'departure' : r.category === 'ground' ? 'ground' : 'overhead';
    const row = { hex: r.hex, label: r.label, airline: '', type: r.type ?? '', typeCode: r.typeCode ?? null, phase: r.category, category: cat, distanceM: r.distance, altM: r.altM ?? null, speedMs: r.speed, etaS: cat === 'arrival' && r.speed > 20 ? r.distance / r.speed : null, runway: null, stale: r.stale ?? 0 };
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
function drawBoard(ctx, x0, { title, glyph, ident, place, time, sections, footer, blink, firstColumn }) {
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
  const cols = [[30, firstColumn], [150, 'FLIGHT'], [355, 'OPERATOR'], [610, 'TYPE'], [720, 'ALT FT'], [868, 'STATUS']];
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
      ctx.globalAlpha = r.stale >= 1 ? 0.55 : 1; // a contact the feed is losing dims
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
      ctx.fillText(String(r.typeCode || '—').toUpperCase().slice(0, 5), x0 + 610, mid);
      ctx.fillText(r.alt, x0 + 720, mid);
      const [word, color] = r.status;
      const flashing = word.startsWith('FINAL') || word === 'TAKE-OFF';
      if (!flashing || blink) {
        ctx.font = `700 20px ${SANS}`;
        const w = ctx.measureText(word).width + 22;
        ctx.fillStyle = color;
        const a = ctx.globalAlpha;
        ctx.globalAlpha = 0.16 * a;
        ctx.fillRect(x0 + 864, mid - 16, w, 32);
        ctx.globalAlpha = a;
        ctx.fillText(word, x0 + 875, mid + 1);
      }
      ctx.globalAlpha = 1;
      y += rowH;
    }
  }
  // footer
  ctx.fillStyle = '#4f5d70';
  ctx.font = `500 15px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText(footer, x0 + 30, H - 18);
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
    canvas.width = BOARD_CANVAS.width;
    canvas.height = BOARD_CANVAS.height;
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
  let last = -Infinity;
  return {
    mesh,
    texture,
    /**
     * Redraw (at most once per second). `now` in ms, `watch` =
     * runtime.airportWatch, `feed` = runtime.trafficStatus.state ('live' |
     * 'delayed' | 'unavailable'; the HUD's wording, so an outage never reads
     * as an empty sky).
     */
    update(now, watch, force = false, feed = 'live') {
      if (!ctx || (!force && now - last < 1000)) return false;
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      last = now;
      const airport = watch?.airport;
      const lat = airport?.a?.lat ?? 0, lon = airport?.a?.lon ?? 0;
      // World time: the session's pinned sun instant when there is one (as
      // the HUD reads it), else now.
      const worldNow = typeof window !== 'undefined' && Number.isFinite(window.__flySunOverride) ? window.__flySunOverride : Date.now();
      const local = localClockAt(lat, lon, worldNow);
      const offH = local.offsetH;
      const s = boardSections(watch);
      const onGround = (r) => r.category === 'ground' || (r.category === 'arrival' && r.etaS === 0 && (r.aglM ?? 0) < 25);
      const fmtAlt = (r) => (onGround(r) ? 'GND' : Number.isFinite(r.altM) ? String(Math.max(0, Math.round((r.altM * 3.28084) / 100) * 100)) : '—');
      // First column: an arrival's live ETA as local clock time; anything
      // else shows the runway it is using when the board knows it.
      const first = (r, kind) => {
        if (kind === 'arr') return Number.isFinite(r.etaS) ? clock(worldNow + r.etaS * 1000, offH) : '--:--';
        return r.runway ? String(r.runway).slice(0, 4) : '—';
      };
      const rows = (list, kind) => list.slice(0, 8).map((r) => ({
        ...r,
        time: first(r, kind),
        alt: fmtAlt(r),
        status: status(r),
      }));
      const ident = airport?.ident ?? String(airport?.id ?? '').split(':')[0] ?? '';
      const place = airport?.name ?? airport?.city ?? '';
      const time = local.text;
      const any = (s.arrivals.length + s.departures.length + s.ground.length + s.overhead.length) > 0;
      const down = feed === 'unavailable' && !any;
      const footer = down ? 'TRAFFIC CONNECTION UNAVAILABLE' : feed === 'delayed' ? 'POSITIONS DELAYED · LIVE ADS-B' : any ? 'LIVE ADS-B · ACTUAL AIRCRAFT ONLY' : 'LIVE ADS-B · QUIET SKIES';
      const quiet = (text) => (down ? 'Live traffic unavailable' : text);
      const arr = rows(s.arrivals, 'arr'), dep = rows(s.departures, 'dep');
      const blink = Math.floor(now / 1000) % 2 === 0;
      drawBoard(ctx, 0, {
        title: 'ARRIVALS', glyph: 'arrive', ident, place, time, footer, blink, firstColumn: 'ETA',
        sections: [
          { rows: arr.slice(0, 6), empty: quiet('No arrivals on approach right now') },
          { heading: 'OVERHEAD', rows: rows(s.overhead, 'ovh').slice(0, Math.max(1, 6 - arr.length)), empty: quiet('Clear skies overhead') },
        ],
      });
      drawBoard(ctx, HALF, {
        title: 'DEPARTURES', glyph: 'depart', ident, place, time, footer, blink, firstColumn: 'RWY',
        sections: [
          { rows: dep.slice(0, 6), empty: quiet('No departures climbing out right now') },
          { heading: 'ON THE GROUND', rows: rows(s.ground, 'gnd').slice(0, Math.max(1, 6 - dep.length)), empty: quiet('No aircraft reported on the ground') },
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
