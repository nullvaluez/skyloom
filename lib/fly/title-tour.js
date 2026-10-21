/**
 * TITLE_CINEMA — the title's world tour and its dataview helpers (pure).
 *
 * The cinema title (components/fly/hud/CinemaTitle.jsx) shows one featured
 * destination at a time and moves between them behind a window shade: the
 * shade comes down, the frozen title flight is staged to the next stop
 * (runtime.stageDestination — the hangar's own pre-stream path), and the shade
 * lifts once that world reads ready. Everything here is pure so
 * scripts/verify-title-cinema.mjs can pin it in node; the component owns the
 * timers and the runtime calls.
 *
 * Offline and keyless like the destinations it reads.
 */
import { DESTINATIONS } from './destinations';
import { computeSun } from './sun-model';

const DEG = Math.PI / 180;

/**
 * Real in-game captures (public/adventures, the Photo shutter on the
 * production build; credits retained in each file) shown, frosted, on the
 * window shade while a stop streams in. Stops without one get the plain shade.
 */
export const TOUR_POSTERS = Object.freeze({
  'grand-canyon': '/adventures/canyon-discovery.webp',
  manhattan: '/adventures/manhattan-skyline.webp',
  'swiss-alps': '/adventures/alpine-valley.webp',
  sydney: '/adventures/sydney-harbour.webp',
  yosemite: '/adventures/yosemite-valley.webp',
  napali: '/adventures/napali-coast.webp',
});

/** Stops that read well in the dark too (their night lights are the view). */
const NIGHT_SHOWABLE = new Set(['manhattan', 'tokyo', 'dubai', 'sydney', 'rio']);

function km(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * DEG);
  return Math.hypot(dLat, dLon);
}

/** Sun elevation (degrees) at a destination. */
export function stopSunDeg(d, now) {
  const s = computeSun(d.lon, d.lat, now);
  return Math.asin(Math.max(-1, Math.min(1, s.sinEl))) / DEG;
}

/**
 * The tour: every featured destination but the practice field, in the
 * curated order. In satellite, a stop in deep night is skipped unless its
 * city lights are the view (canyons and fjords are black at night); the toy
 * world has no live sun, so it keeps every stop. Never fewer than three.
 */
export function tourStops({ style = 'satellite', now = Date.now(), minSunDeg = -4 } = {}) {
  const all = DESTINATIONS.filter((d) => d.id !== 'columbus-practice');
  if (style === 'toy') return all;
  const lit = all.filter((d) => NIGHT_SHOWABLE.has(d.id) || stopSunDeg(d, now) >= minSunDeg);
  return lit.length >= 3 ? lit : all;
}

/** Index of the stop within `maxKm` of (lat, lon), else -1. */
export function tourIndexAt(stops, lat, lon, maxKm = 25) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return -1;
  let best = -1;
  let bestKm = maxKm;
  stops.forEach((d, i) => {
    const k = km(lat, lon, d.lat, d.lon);
    if (k < bestKm) {
      bestKm = k;
      best = i;
    }
  });
  return best;
}

/** The neighbouring stop (dir +1 / -1), wrapping; from "not on the tour" (-1) +1 is the first. */
export function tourStep(count, index, dir) {
  if (!(count > 0)) return -1;
  if (index < 0) return dir < 0 ? count - 1 : 0;
  return (((index + (dir < 0 ? -1 : 1)) % count) + count) % count;
}

/**
 * May the tour move on by itself right now? Only on the bare title (no
 * sheet, journal, library or browser over it), on a visible tab, once the
 * world has revealed, with no hop already in flight, after the dwell, and
 * after the player has been idle for a moment (a destination never changes
 * under a cursor that is about to click it).
 */
export function tourMayAdvance({ auto, covered, hidden, bootReady, busy, dwellMs, shownMs, idleMs, idleNeedMs }) {
  return !!auto && !covered && !hidden && !!bootReady && !busy && shownMs >= dwellMs && idleMs >= idleNeedMs;
}

/**
 * The shade's state for a stop: down while the world behind it is not ready
 * (the boot has not revealed, or a staging is still streaming), up otherwise.
 * `capMs` lifts it anyway once a staging has run that long, so a slow network
 * never strands the title behind a closed shade.
 */
export function shadeWanted({ bootReady, staging, now, capMs }) {
  if (!bootReady) return true;
  if (!staging || staging.ready || staging.launched) return false;
  return !(Number.isFinite(staging.since) && now - staging.since >= capMs);
}

/** The title camera's compass heading (degrees) from its orbit angle: the eye sits at angle a, looking back through the centre. */
export function orbitHeadingDeg(angleDeg) {
  if (!Number.isFinite(angleDeg)) return null;
  return (((angleDeg + 180) % 360) + 360) % 360;
}

function dms(v, pos, neg) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}′${v >= 0 ? pos : neg}`;
}

/** 40°42′N 74°01′W */
export function formatLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'W')}`;
}

/** A light phrase for the sun at the stop: what the window is showing. */
export function lightPhrase(sinEl) {
  if (!Number.isFinite(sinEl)) return null;
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / DEG;
  if (el < -12) return { kind: 'night', label: 'Night', el };
  if (el < -4) return { kind: 'night', label: 'Blue hour', el };
  if (el < 0) return { kind: 'golden', label: 'Twilight', el };
  if (el < 10) return { kind: 'golden', label: 'Golden hour', el };
  if (el < 30) return { kind: 'day', label: 'Soft daylight', el };
  return { kind: 'day', label: 'High sun', el };
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable flight number for the boarding pass ("SKY 0427"). */
export function passFlightNo(key) {
  return `SKY ${String(hash32(String(key || 'skyloom')) % 9000 + 1000)}`;
}

/** A stable barcode for the boarding pass: bars {x, w} (widths 1..3, gaps 1..2) inside `units`. */
export function passBarcode(key, units = 64) {
  let h = hash32(`bc:${key || 'skyloom'}`);
  const bars = [];
  let x = 0;
  for (;;) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    const w = 1 + (h % 3);
    if (x + w > units) break;
    bars.push({ x, w });
    x += w + 1 + ((h >>> 8) % 2);
  }
  return bars;
}
