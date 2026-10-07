/**
 * MULTIPLAYER wire protocol (MULTIPLAYER.md §Protocol). Shared by the relay
 * (server/*.mjs) and the browser session (lib/fly/mp/session.js), so it has
 * ZERO imports and runs unchanged in Node and in the browser.
 *
 * Binary frames carry poses, text frames carry JSON control. Everything is
 * little-endian through DataView.
 *
 *   STATE  client -> relay, 29 B
 *     0 u8  type = MSG.STATE        5 u32 ts  (relay ms, wrap-aware)
 *     1 u8  aircraft index          9 .. 28   POSE (20 B, below)
 *     2 u16 flags
 *     4 u8  warpSeq
 *
 *   BATCH  relay -> client, 8 B header + k x 29 B records
 *     header  0 u8 type = MSG.BATCH · 1 u8 nearCount · 2 u16 k · 4 u32 tS (relay ms)
 *     record  0 u32 uid · 4 u16 flags · 6 u8 warpSeq · 7 u16 ageMs · 9 .. 28 POSE
 *     (sample time = tS - ageMs). The POSE tail sits at offset 9 in both, so
 *     the relay copies 20 bytes and never re-quantizes.
 *
 *   POSE (20 B)
 *     0 i32 lat  x1e7 (clamped to the Web-Mercator limit)
 *     4 i32 lon  x1e7 (wrapped to [-180, 180))
 *     8 u16 alt  (MSL m + 1000) x2          -> 0.5 m
 *    10 u16 heading  [0, 2pi) / 2pi x 65536 (0 = north, clockwise = flight.heading)
 *    12 i16 pitch    [-pi/2, pi/2] / (pi/2) x 32767 (nose up +)
 *    14 i16 bank     [-pi, pi] / pi x 32767 (right wing down +)
 *    16 u16 speed    true m/s x20           -> 0.05 m/s
 *    18 i16 vUp      m/s x10                -> 0.1 m/s (measured, incl. the soft floor)
 *
 * Version: PROTOCOL travels in the URL (?v=) and in hello.v; the relay accepts
 * any v in ACCEPT. Additive changes (new JSON types, reserved bits) keep the
 * version; any byte-layout change bumps it (ship a relay accepting [v-1, v]
 * first, then the app).
 */

export const PROTOCOL = 1;
export const ACCEPT = Object.freeze([1]);

export const MSG = Object.freeze({ STATE: 1, BATCH: 2 });
export const STATE_BYTES = 29;
export const RECORD_BYTES = 29;
export const HEADER_BYTES = 8;
export const POSE_OFFSET = 9;
export const POSE_BYTES = 20;

/** Flag bits (u16). Bits 8-15 are reserved and masked to 0 by the relay. */
export const F = Object.freeze({
  HELD: 1 << 0, // paused / menu / inspect / atlas / hidden tab
  CRASHED: 1 << 1,
  BOOST: 1 << 2,
  SMOKE: 1 << 3, // a state: smoke on
  ASSISTED: 1 << 4, // autopilot / escort engaged
  EMOTE_SHIFT: 5,
  EMOTE_MASK: 0b11 << 5, // 0 none · 1 wave · 2 follow-me · 3 nice
  EMOTE_TOGGLE: 1 << 7, // flips on every new emote; receivers fire on a (code, toggle) change
  KNOWN: 0xff,
});

export const EMOTES = Object.freeze(['none', 'wave', 'follow', 'nice']);
export const emoteOf = (flags) => (flags & F.EMOTE_MASK) >> F.EMOTE_SHIFT;
export const withEmote = (flags, code, toggle) =>
  (flags & ~(F.EMOTE_MASK | F.EMOTE_TOGGLE)) | ((code & 3) << F.EMOTE_SHIFT) | (toggle ? F.EMOTE_TOGGLE : 0);

/** Aircraft by index. APPEND-ONLY; mirrors lib/fly/player-aircraft.js ids (verify-mp-protocol asserts it). */
export const AIRCRAFT_IDS = Object.freeze([
  'fighter',
  'military',
  'warbird-jet',
  'warbird-prop',
  'prop',
  'glider',
  'bizjet',
  'airliner',
  'cargo',
  'flying-wing',
]);
export const aircraftIndex = (id) => {
  const i = AIRCRAFT_IDS.indexOf(id);
  return i < 0 ? 0 : i;
};

/** Application close codes (RFC 6455 reserves 4000-4999 for applications). */
export const CLOSE = Object.freeze({
  REPLACED: 4000, // same seed reconnected; the old socket is closed
  FULL: 4001,
  VERSION: 4002,
  IDLE: 4003, // held too long
  RESTART: 1012,
  POLICY: 1008,
  TOO_BIG: 1009,
});

/** JSON message types the relay accepts from a client. */
export const CLIENT_TYPES = Object.freeze(['hello', 'ping', 'leave', 'where']);
export const MAX_TEXT = 256;

export const MAX_LAT = 85.0511;
export const MAX_SPEED = 800; // m/s; the boost envelope is 750

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
export const wrap2pi = (r) => ((r % TAU) + TAU) % TAU;
export const wrapPi = (r) => wrap2pi(r + Math.PI) - Math.PI;
/** Wrap-aware u32 millisecond difference a - b (valid within +-24.8 days). */
export const tsDiff = (a, b) => (a - b) | 0;

/** Write a POSE at `off`. `p` = {lat, lon, alt, heading, pitch, bank, speed, vUp}. */
export function writePose(dv, off, p) {
  dv.setInt32(off, Math.round(clamp(p.lat, -MAX_LAT, MAX_LAT) * 1e7), true);
  dv.setInt32(off + 4, Math.round(wrap180(p.lon) * 1e7), true);
  dv.setUint16(off + 8, Math.round((clamp(p.alt, -1000, 31767) + 1000) * 2), true);
  dv.setUint16(off + 10, Math.round((wrap2pi(p.heading) / TAU) * 65536) & 0xffff, true);
  dv.setInt16(off + 12, Math.round((clamp(p.pitch, -HALF_PI, HALF_PI) / HALF_PI) * 32767), true);
  dv.setInt16(off + 14, Math.round((clamp(wrapPi(p.bank), -Math.PI, Math.PI) / Math.PI) * 32767), true);
  dv.setUint16(off + 16, Math.round(clamp(p.speed, 0, 3276.75) * 20), true);
  dv.setInt16(off + 18, Math.round(clamp(p.vUp, -3276.7, 3276.7) * 10), true);
}

/** Read a POSE at `off` into `out` (allocation-free when `out` is reused). */
export function readPose(dv, off, out = {}) {
  out.lat = dv.getInt32(off, true) / 1e7;
  out.lon = dv.getInt32(off + 4, true) / 1e7;
  out.alt = dv.getUint16(off + 8, true) / 2 - 1000;
  out.heading = (dv.getUint16(off + 10, true) / 65536) * TAU;
  out.pitch = (dv.getInt16(off + 12, true) / 32767) * HALF_PI;
  out.bank = (dv.getInt16(off + 14, true) / 32767) * Math.PI;
  out.speed = dv.getUint16(off + 16, true) / 20;
  out.vUp = dv.getInt16(off + 18, true) / 10;
  return out;
}

const dvOf = (buf) =>
  buf instanceof DataView
    ? buf
    : ArrayBuffer.isView(buf)
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);

/** Encode a STATE into `buf` (an ArrayBuffer / view of >= 29 bytes; a new one when omitted). */
export function encodeState(s, buf = new ArrayBuffer(STATE_BYTES)) {
  const dv = dvOf(buf);
  dv.setUint8(0, MSG.STATE);
  dv.setUint8(1, s.a & 0xff);
  dv.setUint16(2, s.flags & 0xffff, true);
  dv.setUint8(4, s.warpSeq & 0xff);
  dv.setUint32(5, s.ts >>> 0, true);
  writePose(dv, POSE_OFFSET, s);
  return buf;
}

/** Decode a STATE; null when it is not exactly one well-typed STATE frame. */
export function decodeState(buf, out = {}) {
  const dv = dvOf(buf);
  if (dv.byteLength !== STATE_BYTES || dv.getUint8(0) !== MSG.STATE) return null;
  out.a = dv.getUint8(1);
  out.flags = dv.getUint16(2, true);
  out.warpSeq = dv.getUint8(4);
  out.ts = dv.getUint32(5, true);
  readPose(dv, POSE_OFFSET, out);
  return out;
}

export function writeBatchHeader(dv, nearCount, k, tS) {
  dv.setUint8(0, MSG.BATCH);
  dv.setUint8(1, Math.min(255, nearCount));
  dv.setUint16(2, k, true);
  dv.setUint32(4, tS >>> 0, true);
}

/**
 * Write record `i` of a batch. `pose` is the 20 raw POSE bytes (a Uint8Array
 * view) exactly as they arrived in the subject's STATE.
 */
export function writeRecord(u8, i, uid, flags, warpSeq, ageMs, pose) {
  const off = HEADER_BYTES + i * RECORD_BYTES;
  const dv = new DataView(u8.buffer, u8.byteOffset + off, RECORD_BYTES);
  dv.setUint32(0, uid >>> 0, true);
  dv.setUint16(4, flags & 0xffff, true);
  dv.setUint8(6, warpSeq & 0xff);
  dv.setUint16(7, clamp(Math.round(ageMs), 0, 65535), true);
  u8.set(pose, off + POSE_OFFSET);
}

/**
 * Read a BATCH. Calls onRecord(rec) for each record with ONE reused object:
 * {uid, flags, warpSeq, ageMs, sampleTs, lat, lon, alt, heading, pitch, bank, speed, vUp}.
 * Returns {nearCount, k, tS} or null when malformed.
 */
export function readBatch(buf, onRecord, rec = {}) {
  const dv = dvOf(buf);
  if (dv.byteLength < HEADER_BYTES || dv.getUint8(0) !== MSG.BATCH) return null;
  const nearCount = dv.getUint8(1);
  const k = dv.getUint16(2, true);
  const tS = dv.getUint32(4, true);
  if (dv.byteLength !== HEADER_BYTES + k * RECORD_BYTES) return null;
  for (let i = 0; i < k; i++) {
    const off = HEADER_BYTES + i * RECORD_BYTES;
    rec.uid = dv.getUint32(off, true);
    rec.flags = dv.getUint16(off + 4, true);
    rec.warpSeq = dv.getUint8(off + 6);
    rec.ageMs = dv.getUint16(off + 7, true);
    rec.sampleTs = (tS - rec.ageMs) >>> 0;
    readPose(dv, off + POSE_OFFSET, rec);
    onRecord(rec);
  }
  return { nearCount, k, tS };
}

/**
 * Horizontal velocity exactly as FlightModel displaces (flight-model.js
 * "Displace"): east = sin(h)·cos(p)·s, north = cos(h)·cos(p)·s, true m/s.
 */
export function velocityOf(p, out = {}) {
  const vxz = p.speed * Math.cos(p.pitch);
  out.vE = Math.sin(p.heading) * vxz;
  out.vN = Math.cos(p.heading) * vxz;
  out.vUp = p.vUp;
  return out;
}

/** The remote pilot id for a relay uid (never collides with a 6-hex ICAO address). */
export const pilotId = (uid) => `p:${(uid >>> 0).toString(36)}`;
