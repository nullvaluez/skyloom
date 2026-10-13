// FLIGHT HISTORY — the flights logbook (FLY_GATE_TO_GATE_PLAN.md, "Payoff").
//
// v2 rows live in localStorage 'fly-flight-history-v2' (the last 200):
//
//   { v: 2, id, at, startedAt, durationSec, aircraft,
//     start: 'gate' | 'apron' | 'runway' | 'approach' | 'free' | null,
//     departure: { id, ident, name, runway } | null, destination: { … } | null,
//     assisted, assistReasons: string[],
//     touchdown: { fpm, sinkMps, crossFt, aimFt, speedKt, vrefKt, flareRatio,
//                  floatSec, bounced } | null,
//     rollout: { maxCrossFt, remainingFt } | null,
//     grade: { letter, score, parts } | null,
//     route: { nm, maxAltFt, track: [[lat, lon]] (at most 64) } | null,
//     photoId }
//
// The v1 log 'fly-flight-history' (OperationsHUD's completion summaries, the
// last 100) is READ-ONLY here: readHistory() maps its rows to v2 shape with no
// grade and never deletes or rewrites the key. appendHistoryV1() is that
// writer, byte for byte, so it can move out of the HUD unchanged. With storage
// blocked or full, v2 rows live for the page session; nothing here throws.
// Pure apart from storage: no DOM, no React.
import { airportById } from './operations-airports.js';

export const HISTORY_V2_KEY = 'fly-flight-history-v2';
export const HISTORY_V1_KEY = 'fly-flight-history';
export const HISTORY_V2_CAP = 200;
export const HISTORY_V1_CAP = 100;
export const TRACK_MAX = 64;
export const START_KINDS = Object.freeze(['gate', 'apron', 'runway', 'approach', 'free']);
const FPM_PER_MPS = 196.8504;

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // a SecurityError on access counts as blocked
  }
}

// v2 rows the storage refused (blocked or full): kept for the page session.
const sessionRows = [];
let generated = 0;

/** Forget the session-only rows (node gates). */
export function clearSessionHistory() {
  sessionRows.length = 0;
}

// --- validation ---------------------------------------------------------------
const str = (v, max = 160) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function endpointOf(e) {
  if (!isObject(e)) return null;
  const id = str(e.id, 64);
  const ident = str(e.ident, 16) ?? (id ? id.split(':')[0] : null);
  if (!ident) return null;
  return { id, ident, name: str(e.name), runway: str(e.runway, 16) };
}

function touchdownOf(t) {
  if (!isObject(t)) return null;
  const out = {};
  for (const k of ['fpm', 'sinkMps', 'crossFt', 'aimFt', 'speedKt', 'vrefKt', 'flareRatio', 'floatSec']) out[k] = num(t[k]);
  out.bounced = !!t.bounced;
  return out;
}

function rolloutOf(r) {
  return isObject(r) ? { maxCrossFt: num(r.maxCrossFt), remainingFt: num(r.remainingFt) } : null;
}

function gradeOf(g) {
  if (!isObject(g) || !str(g.letter, 4) || num(g.score) == null) return null;
  const parts = {};
  if (isObject(g.parts)) for (const [k, v] of Object.entries(g.parts)) if (num(v) != null && k.length <= 32) parts[k] = v;
  return { letter: g.letter, score: g.score, parts };
}

// At most TRACK_MAX points, evenly spaced, first and last kept.
function trackOf(track) {
  const points = Array.isArray(track) ? track.filter((p) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null).map((p) => [p[0], p[1]]) : [];
  if (points.length <= TRACK_MAX) return points;
  return Array.from({ length: TRACK_MAX }, (_, i) => points[Math.round((i * (points.length - 1)) / (TRACK_MAX - 1))]);
}

function routeOf(r) {
  return isObject(r) ? { nm: num(r.nm), maxAltFt: num(r.maxAltFt), track: trackOf(r.track) } : null;
}

/** A v2 row in its stored shape, or null when it is not one (wrong version, no id, time or aircraft). */
export function normalizeHistoryRow(raw) {
  if (!isObject(raw) || raw.v !== 2) return null;
  const id = str(raw.id, 80), at = num(raw.at), aircraft = str(raw.aircraft, 40);
  if (!id || at == null || at < 0 || !aircraft) return null;
  const durationSec = Math.max(0, num(raw.durationSec) ?? 0);
  return {
    v: 2,
    id,
    at,
    startedAt: num(raw.startedAt) ?? at - durationSec * 1000,
    durationSec,
    aircraft,
    start: START_KINDS.includes(raw.start) ? raw.start : null,
    departure: endpointOf(raw.departure),
    destination: endpointOf(raw.destination),
    assisted: !!raw.assisted,
    assistReasons: Array.isArray(raw.assistReasons) ? raw.assistReasons.filter((r) => str(r, 40)).slice(0, 16) : [],
    touchdown: touchdownOf(raw.touchdown),
    rollout: rolloutOf(raw.rollout),
    grade: gradeOf(raw.grade),
    route: routeOf(raw.route),
    photoId: str(raw.photoId, 120),
  };
}

// --- storage ------------------------------------------------------------------
function readArray(storage, key) {
  try {
    const raw = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function storedV2(storage) {
  return storage ? readArray(storage, HISTORY_V2_KEY).map(normalizeHistoryRow).filter(Boolean) : [];
}

// A v1 summary { aircraft, departure, destination, duration, touchdown, assisted, at }.
function fromV1(raw, lookup) {
  if (!isObject(raw)) return null;
  const at = num(raw.at), aircraft = str(raw.aircraft, 40);
  if (at == null || at < 0 || !aircraft) return null;
  const durationSec = Math.max(0, num(raw.duration) ?? 0);
  const place = (id) => {
    if (!str(id, 64)) return null;
    const a = lookup?.(id);
    return { id, ident: id.split(':')[0], name: a?.name ?? null, runway: a?.runway ?? id.split(':')[1]?.split('-')[0] ?? null };
  };
  return {
    v: 2,
    id: `v1-${at}`,
    at,
    startedAt: at - durationSec * 1000,
    durationSec,
    aircraft,
    start: raw.departure ? null : 'free', // v1 kept no start; a flight without a departure was free exploration
    departure: place(raw.departure),
    destination: place(raw.destination),
    assisted: !!raw.assisted,
    assistReasons: [],
    touchdown: null,
    rollout: null,
    grade: null,
    route: null,
    photoId: null,
    legacy: { key: HISTORY_V1_KEY, touchdown: str(raw.touchdown, 40) }, // the v1 one-word touchdown
  };
}

/**
 * Every flight, oldest first: stored v2 rows, this session's unstored rows,
 * and the read-only v1 log mapped to v2 (grade null, `legacy` set). A v1 row
 * with the same time and aircraft as a v2 row is that flight's twin and is
 * left out. Corrupt rows are skipped. `lookup` names v1 airports by id.
 */
export function readHistory(storage = defaultStorage(), { lookup = airportById } = {}) {
  const rows = [];
  const ids = new Set();
  for (const r of [...storedV2(storage), ...sessionRows]) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    rows.push(r);
  }
  const twins = new Set(rows.map((r) => `${r.at}|${r.aircraft}`));
  const legacy = [];
  const legacyIds = new Map();
  for (const raw of storage ? readArray(storage, HISTORY_V1_KEY) : []) {
    const r = fromV1(raw, lookup);
    if (!r || twins.has(`${r.at}|${r.aircraft}`)) continue;
    const n = legacyIds.get(r.id) ?? 0;
    legacyIds.set(r.id, n + 1);
    if (n) r.id = `${r.id}-${n}`;
    legacy.push(r);
  }
  return [...legacy, ...rows].sort((a, b) => a.at - b.at);
}

/**
 * Append one v2 row (`v` and a missing `id` are filled in). Returns the row as
 * stored, or null when it is not a valid row. When storage is blocked or full
 * the row is kept for the page session instead.
 */
export function appendHistoryV2(row, storage = defaultStorage()) {
  if (!isObject(row)) return null;
  const clean = normalizeHistoryRow({ ...row, v: 2, id: row.id ?? `h-${num(row.at) ?? 0}-${++generated}` });
  if (!clean) return null;
  try {
    if (!storage) throw new Error('no storage');
    storage.setItem(HISTORY_V2_KEY, JSON.stringify([...storedV2(storage), clean].slice(-HISTORY_V2_CAP)));
  } catch {
    sessionRows.push(clean);
    if (sessionRows.length > HISTORY_V2_CAP) sessionRows.splice(0, sessionRows.length - HISTORY_V2_CAP);
  }
  return clean;
}

/**
 * The v1 writer, exactly as OperationsHUD has it: read 'fly-flight-history'
 * (anything but an array reads as []), append the summary, keep the last 100,
 * write it back, swallow storage errors. Returns true when written.
 */
export function appendHistoryV1(summary, storage = defaultStorage()) {
  try {
    let raw;
    try {
      raw = JSON.parse(storage.getItem(HISTORY_V1_KEY) || '[]');
    } catch {
      raw = [];
    }
    const rows = Array.isArray(raw) ? raw : [];
    storage.setItem(HISTORY_V1_KEY, JSON.stringify([...rows, summary].slice(-HISTORY_V1_CAP)));
    return true;
  } catch {
    return false; // storage blocked or full: the flight simply goes unlogged, as before
  }
}

// The softness of a touchdown in feet per minute (lower is softer).
function sinkFpm(t) {
  if (!t) return null;
  if (num(t.fpm) != null) return Math.abs(t.fpm);
  if (num(t.sinkMps) != null) return Math.abs(t.sinkMps) * FPM_PER_MPS;
  return null;
}

/**
 * Per destination ident: { best (highest grade score), softest (lowest sink
 * rate), count (flights that ended there) }. Rows without a grade or a
 * touchdown still count. Ties keep the earlier row.
 */
export function bests(rows) {
  const out = Object.create(null);
  for (const r of rows || []) {
    const ident = r?.destination?.ident;
    if (!ident) continue;
    const b = (out[ident] ??= { best: null, softest: null, count: 0 });
    b.count++;
    if (num(r.grade?.score) != null && (!b.best || r.grade.score > b.best.grade.score)) b.best = r;
    const sink = sinkFpm(r.touchdown);
    if (sink != null && (!b.softest || sink < sinkFpm(b.softest.touchdown))) b.softest = r;
  }
  return out;
}
