/**
 * PLAY PASS — CALM_HUD (FLY_PLAY_PASS.md, findings F1–F3, F7): the pure half
 * of the calm HUD. No React and no DOM here, so scripts/verify-play-hud.mjs
 * pins every rule in node: the HUD modes and their persistence, the steering
 * cue's geometry, the legend's schedule and the notice lane.
 *
 * Read only through lib/fly/play-pass.js; with the flag off nothing imports
 * a value from here that changes what renders (FlyHUD asks `CALM` first).
 */
import { playPassBlock, playPassOn } from '@/lib/fly/play-pass';

export const CALM = playPassOn('CALM_HUD');
export const CALM_CFG = playPassBlock('CALM_HUD') ?? {};

export const HUD_MODES = Object.freeze(CALM_CFG.modes?.length ? [...CALM_CFG.modes] : ['explorer', 'instruments', 'clean']);
const LABELS = { explorer: 'Explorer', instruments: 'Instruments', clean: 'Clean' };
const NOTES = {
  explorer: 'Speed, altitude and heading at the bottom; the view stays clear.',
  instruments: 'Speed and altitude tapes, a heading scale and the flight-path marker.',
  clean: 'Only the essentials and notices. Nothing over the view.',
};

/** A stored or picked value as a known mode (anything else is the default). */
export function normalizeHudMode(v) {
  return HUD_MODES.includes(v) ? v : HUD_MODES.includes(CALM_CFG.defaultMode) ? CALM_CFG.defaultMode : HUD_MODES[0];
}
/** The mode after `mode` in the cycle (the H key). */
export function nextHudMode(mode) {
  const i = HUD_MODES.indexOf(normalizeHudMode(mode));
  return HUD_MODES[(i + 1) % HUD_MODES.length];
}
export const hudModeLabel = (mode) => LABELS[normalizeHudMode(mode)];
export const hudModeNote = (mode) => NOTES[normalizeHudMode(mode)];

const storageOf = (storage) => storage ?? globalThis.window?.localStorage;
/** The saved pick, or the default (storage blocked or junk reads as the default). */
export function readHudMode(storage) {
  try {
    return normalizeHudMode(storageOf(storage)?.getItem(CALM_CFG.storageKey ?? 'fly-hud-mode'));
  } catch {
    return normalizeHudMode(null);
  }
}
/** Persist a pick (a click or the key is a choice; a state change is not). */
export function saveHudMode(mode, storage) {
  const m = normalizeHudMode(mode);
  try {
    storageOf(storage)?.setItem(CALM_CFG.storageKey ?? 'fly-hud-mode', m);
  } catch {
    // storage blocked: the pick still applies for this session
  }
  return m;
}

/** Eight-point compass name for a heading in degrees. */
export function cardinal(deg) {
  const d = ((deg % 360) + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];
}
export const fmtThousands = (n) => {
  const s = String(Math.abs(Math.round(n)));
  const out = s.length > 3 ? `${s.slice(0, -3)},${s.slice(-3)}` : s;
  return n < 0 ? `-${out}` : out;
};

/**
 * The steering cue for a mouse at (mx, my) in the input controller's
 * normalised canvas space (-1..1, y down) on a w×h canvas: whether it shows,
 * where its needle points (screen degrees, 0 = right, 90 = down), how long it
 * is and the command it stands for (the input controller's own deadzone +
 * expo shaping, per axis, so the cue is exactly what the aircraft is told).
 */
export function steerCue(mx, my, w, h, { deadzone = 0.025, expo = 1.8, showAt = 2, needlePx = 40 } = {}) {
  const shape = (v) => {
    const a = Math.abs(v);
    if (a < deadzone) return 0;
    return Math.sign(v) * Math.pow(Math.min(1, (a - deadzone) / (1 - deadzone)), expo);
  };
  const x = Number.isFinite(mx) ? mx : 0;
  const y = Number.isFinite(my) ? my : 0;
  const turn = shape(x);
  const pitch = shape(y);
  const mag = Math.min(1, Math.hypot(turn, pitch));
  const off = Math.max(Math.abs(x), Math.abs(y));
  const dx = (x * w) / 2;
  const dy = (y * h) / 2;
  return {
    on: off > deadzone * showAt,
    centred: off <= deadzone,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    len: Math.round(6 + needlePx * Math.sqrt(mag)),
    mag,
    turn,
    pitch: -pitch,
  };
}

/**
 * Where the dock sits (its `bottom`, in px from the viewport's bottom edge):
 * at `base` (just above the attribution bar) unless one of its rows would
 * overlap something already in the bottom band; then at the lowest height
 * that clears every row of all of them. Never higher than `maxBottom`: past
 * that it stays at the base (a transient surface over it wins; the dock does
 * not chase it up the screen). `rows` are the dock's rows as
 * { left, right, y0, y1 } with y measured UP from the dock's bottom edge;
 * obstacles are client rects { left, right, top, bottom }.
 */
export function placeDock(rows, obstacles, { base = 56, vh = 900, gap = 10, maxBottom = Infinity } = {}) {
  const pairs = [];
  for (const r of rows) for (const o of obstacles) if (o.left < r.right + gap && o.right > r.left - gap) pairs.push([r, o]);
  const clear = (b) => pairs.every(([r, o]) => !(vh - b - r.y1 < o.bottom + gap && vh - b - r.y0 > o.top - gap));
  const tries = [base, ...pairs.map(([r, o]) => Math.ceil(vh - o.top + gap - r.y0))].filter((b) => b >= base && b <= maxBottom).sort((a, b) => a - b);
  for (const b of tries) if (clear(b)) return b;
  return base;
}

/**
 * The legend's schedule: in full for the first `flights` flights, for the
 * first `seconds` of each, then the one-line hint. `tutorial` is the
 * first-flight tips state: while the tips are up they do the teaching.
 */
export function legendMode({ flights = 0, shownSec = 0, tutorial = 'done' } = {}, cfg = CALM_CFG.legend ?? {}) {
  if (tutorial === 'new') return 'none';
  return flights < (cfg.flights ?? 3) && shownSec < (cfg.seconds ?? 40) ? 'full' : 'hint';
}
export function readLegendFlights(storage) {
  try {
    const n = Number(JSON.parse(storageOf(storage)?.getItem(CALM_CFG.legend?.storageKey ?? 'fly-hud-legend-v1') ?? 'null')?.flights);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}
export function saveLegendFlights(n, storage) {
  try {
    storageOf(storage)?.setItem(CALM_CFG.legend?.storageKey ?? 'fly-hud-legend-v1', JSON.stringify({ flights: n }));
  } catch {
    // storage blocked: the legend simply shows again next time
  }
}

export const NOTICE_TEXT = Object.freeze({
  scenery: 'Scenery is still arriving here. It will fill in as you fly.',
  delayed: 'Live traffic is running a little behind.',
  unavailable: 'Live traffic is offline for now. The world is still yours to explore.',
});

/**
 * Scenery trouble a player can actually see: the ground still coarse (the
 * terrain loader has not settled at a sharp zoom) or, on the Enhanced earth,
 * its surface or material layers not up. The boot gate's readiness parts are
 * not this: a capped arrival leaves `shaders` "missing" for the whole flight
 * (the prewarm was bypassed) and the camera tile depth breathes by a level
 * while flying, and neither is anything on screen (F3: the notice that sat
 * up for minutes over a finished Manhattan).
 */
export function sceneryTrouble(rt) {
  const earth = rt?.earthSurface;
  return rt?.terraStats?.sharp === false || (!!earth && (earth.near?.ready === false || (!!earth.materials && earth.materials.state !== 'ready')));
}

/**
 * The notice lane: one notice at a time, discovery first, then scenery, then
 * traffic. `step(nowSec, input)` with
 *   input.trouble   sceneryTrouble() this tick; it has to hold, unbroken,
 *                   for `sceneryAfterSec` before the lane says anything,
 *   input.traffic   null | 'delayed' | 'unavailable',
 *   input.discovery null | { text, until } (until in seconds),
 * returns { notice: null | { kind, text }, retry } where `retry` asks the
 * caller to re-arm the scenery providers (once per degradation).
 * Every condition has to hold for its `…AfterSec` before it is said, it is
 * said for `showSec`, then the lane stays quiet about it for `repeatSec`.
 */
export function createNoticeLane(cfg = CALM_CFG.notices ?? {}) {
  const c = { sceneryAfterSec: 30, retryAfterSec: 15, showSec: 9, trafficAfterSec: 15, repeatSec: 240, ...cfg };
  const st = {};
  const reset = () => {
    st.degradedSince = null;
    st.retried = false;
    st.sceneryAt = null;
    st.sceneryQuiet = -Infinity;
    st.traffic = null;
    st.trafficSince = null;
    st.trafficAt = null;
    st.trafficQuiet = -Infinity;
  };
  reset();
  const step = (now, { trouble = false, traffic = null, discovery = null } = {}) => {
    let retry = false;
    // Scenery
    if (!trouble) {
      st.degradedSince = null;
      st.sceneryAt = null;
      st.retried = false;
    } else {
      st.degradedSince ??= now;
      const held = now - st.degradedSince;
      if (!st.retried && held >= c.retryAfterSec) {
        st.retried = true;
        retry = true;
      }
      if (st.sceneryAt === null && held >= c.sceneryAfterSec && now >= st.sceneryQuiet) st.sceneryAt = now;
      if (st.sceneryAt !== null && now - st.sceneryAt >= c.showSec) {
        st.sceneryAt = null;
        st.sceneryQuiet = now + c.repeatSec;
      }
    }
    // Traffic
    const t = traffic === 'delayed' || traffic === 'unavailable' ? traffic : null;
    if (t !== st.traffic) {
      st.traffic = t;
      st.trafficSince = t ? now : null;
      st.trafficAt = null;
    }
    if (t && st.trafficAt === null && now - st.trafficSince >= c.trafficAfterSec && now >= st.trafficQuiet) st.trafficAt = now;
    if (st.trafficAt !== null && now - st.trafficAt >= c.showSec) {
      st.trafficAt = null;
      st.trafficQuiet = now + c.repeatSec;
    }
    const notice =
      discovery && discovery.until > now
        ? { kind: 'discovery', text: discovery.text }
        : st.sceneryAt !== null
          ? { kind: 'scenery', text: NOTICE_TEXT.scenery }
          : st.trafficAt !== null
            ? { kind: 'traffic', text: NOTICE_TEXT[t] }
            : null;
    return { notice, retry };
  };
  return { step, reset, state: st };
}

// The calm controller's event bus: anything that should bring the dimmed
// chrome back (a notice, a gain) calls wakeHud(); CalmHud reads lastWake().
let wokeAt = -Infinity;
export function wakeHud(now = typeof performance !== 'undefined' ? performance.now() : 0) {
  wokeAt = now;
}
export const lastWake = () => wokeAt;

// The lane's current notice, published by ExplorerGuide (which owns the
// lane) and drawn by CalmHud: in the dock on a pointer device, so it moves
// with the dock and never meets the toasts, the escort pill or the bottom
// band; in the place line's slot on a phone.
let notice = null;
const noticeSubs = new Set();
export function publishNotice(n) {
  const next = n ? { kind: n.kind, text: n.text } : null;
  if (next?.kind === notice?.kind && next?.text === notice?.text) return;
  notice = next;
  noticeSubs.forEach((fn) => fn());
}
export const currentNotice = () => notice;
export function subscribeNotice(fn) {
  noticeSubs.add(fn);
  return () => noticeSubs.delete(fn);
}
