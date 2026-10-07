/**
 * MULTIPLAYER — verify-mp-protocol: the shared wire codec and the tables it
 * leans on (MULTIPLAYER.md §Protocol; design §13 gate 1). Pure node, no
 * network, no browser.
 *
 * (1)  STATE round-trips at seeded random and extreme values (lat ±85.05, lon
 *      ±180 and across the antimeridian, alt −500 / 20,000, heading wrap,
 *      pitch ±π/2, bank ±π, speed 0 / 800, vUp ±300), every field within
 *      half its quantization step; a, flags, warpSeq, ts exact.
 * (2)  BATCH round-trips (header + records built from raw STATE pose bytes),
 *      ageMs clamps to [0, 65535], a malformed length reads as null.
 * (3)  Exact sizes: STATE 29, RECORD 29, HEADER 8, batch 8 + 29k.
 * (4)  The 20-byte POSE tail sits at offset 9 in BOTH frames, byte-identical.
 * (5)  Flag bits are unique and inside F.KNOWN; reserved bits 8-15 mask off.
 * (6)  withEmote / emoteOf round-trip every code × toggle, other bits kept.
 * (7)  AIRCRAFT_IDS deep-equals PLAYER_AIRCRAFT ids (append-only mirror).
 * (8)  Every aircraftPresentation(resolveAircraft(id), true).url (the phone
 *      GLB the remote fleet loads) exists under public/models.
 * (9)  remote-meta: every REMOTE_ARCHETYPE value has a non-null
 *      TRAFFIC_MODELS[i]; REMOTE_ARCHETYPE / REMOTE_ICON cover AIRCRAFT_IDS.
 * (10) pilotId is 'p:<base36>' and isRemote tells it from an ICAO hex.
 * (11) NO-PERSISTENCE SCAN: no multiplayer file mentions localStorage,
 *      sessionStorage, indexedDB, persist( or document.cookie. A file that
 *      does not exist yet is reported 'not yet present' (INFO, not a pass).
 * (12) lib/fly/save-backup.mjs BACKUP_KEYS is exactly the pre-multiplayer list.
 *
 * Run: node scripts/verify-mp-protocol.mjs
 */
import { register } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

register('./_node-resolve.mjs', import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

const P = await import('../lib/fly/mp/protocol.mjs');
const { REMOTE_ARCHETYPE, REMOTE_ICON } = await import('../lib/fly/mp/remote-meta.js');
const { isRemote } = await import('../lib/fly/mp/mp-flag.js');
const { PLAYER_AIRCRAFT, resolveAircraft } = await import('../lib/fly/player-aircraft.js');
const { aircraftPresentation } = await import('../lib/fly/cinematic-earth.js');
const { TRAFFIC_MODELS } = await import('../lib/fly/assets.js');
const { BACKUP_KEYS } = await import('../lib/fly/save-backup.mjs');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const info = (name, detail) => console.log(`INFO  ${name}  — ${detail}`);

// Seeded so a red is reproducible.
let seed = 0x5eed1234;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const lerp = (a, b) => a + (b - a) * rnd();
const TAU = Math.PI * 2;
const angDiff = (a, b) => Math.abs(P.wrapPi(a - b));

// Half a quantization step per field (+ float slack).
const EPS = 1e-9;
const STEP = {
  lat: 0.5e-7 + EPS,
  lon: 0.5e-7 + EPS,
  alt: 0.25 + EPS,
  heading: Math.PI / 65536 + EPS,
  pitch: (Math.PI / 2 / 32767) * 0.5 + EPS,
  bank: (Math.PI / 32767) * 0.5 + EPS,
  speed: 0.025 + EPS,
  vUp: 0.05 + EPS,
};
function poseErrors(want, got) {
  const e = [];
  const err = {
    lat: Math.abs(got.lat - Math.max(-P.MAX_LAT, Math.min(P.MAX_LAT, want.lat))),
    lon: Math.abs(P.wrap180(got.lon - want.lon)),
    alt: Math.abs(got.alt - want.alt),
    heading: angDiff(got.heading, want.heading),
    pitch: Math.abs(got.pitch - want.pitch),
    bank: angDiff(got.bank, want.bank),
    speed: Math.abs(got.speed - want.speed),
    vUp: Math.abs(got.vUp - want.vUp),
  };
  for (const k of Object.keys(STEP)) if (!(err[k] <= STEP[k])) e.push(`${k} ${want[k]} -> ${got[k]} (err ${err[k]})`);
  return e;
}

const EXTREMES = [
  { lat: 85.05, lon: 180, alt: -500, heading: 0, pitch: Math.PI / 2, bank: Math.PI, speed: 0, vUp: 300 },
  { lat: -85.05, lon: -180, alt: 20000, heading: TAU - 1e-6, pitch: -Math.PI / 2, bank: -Math.PI, speed: 800, vUp: -300 },
  { lat: 0, lon: 179.9999999, alt: 0, heading: TAU, pitch: 0, bank: 0, speed: 750, vUp: 0 },
  { lat: 1e-7, lon: -179.9999999, alt: 31000, heading: -0.5, pitch: 0.3, bank: -2.9, speed: 0.05, vUp: 0.1 },
  { lat: 40.0001234, lon: 540.25, alt: -1000, heading: 7 * TAU + 1, pitch: -1.2, bank: 3 * Math.PI, speed: 180.12, vUp: -12.34 },
];

// (1) STATE round-trips
{
  const bad = [];
  const cases = [...EXTREMES];
  for (let i = 0; i < 4000; i++)
    cases.push({
      lat: lerp(-85.05, 85.05),
      lon: lerp(-180, 180),
      alt: lerp(-1000, 31000),
      heading: lerp(-TAU, 2 * TAU),
      pitch: lerp(-Math.PI / 2, Math.PI / 2),
      bank: lerp(-Math.PI, Math.PI),
      speed: lerp(0, 800),
      vUp: lerp(-300, 300),
    });
  cases.forEach((pose, i) => {
    const s = { ...pose, a: i % P.AIRCRAFT_IDS.length, flags: (i * 37) & 0xffff, warpSeq: i & 0xff, ts: (i * 2654435761) >>> 0 };
    const buf = P.encodeState(s);
    const d = P.decodeState(buf);
    if (!d) return bad.push(`#${i} decoded null`);
    const e = poseErrors(pose, d);
    if (d.a !== s.a || d.flags !== s.flags || d.warpSeq !== s.warpSeq || d.ts !== s.ts) e.push('header fields');
    if (e.length) bad.push(`#${i} ${e.join('; ')}`);
  });
  check(
    '(1) STATE round-trips within half a quantization step',
    bad.length === 0,
    bad.length ? `${bad.length} bad, first: ${bad[0]}` : `${cases.length} poses incl. ${EXTREMES.length} extremes`
  );
}

// (2) BATCH round-trips, built from raw STATE pose bytes
{
  const bad = [];
  const k = 48;
  const tS = 4294960000; // near the u32 wrap: sampleTs must wrap with it
  const u8 = new Uint8Array(P.HEADER_BYTES + k * P.RECORD_BYTES);
  P.writeBatchHeader(new DataView(u8.buffer), 3, k, tS);
  const want = [];
  for (let i = 0; i < k; i++) {
    const pose = i < EXTREMES.length ? EXTREMES[i] : { lat: lerp(-85, 85), lon: lerp(-180, 180), alt: lerp(0, 12000), heading: lerp(0, TAU), pitch: lerp(-1, 1), bank: lerp(-3, 3), speed: lerp(0, 800), vUp: lerp(-50, 50) };
    const st = new Uint8Array(P.encodeState({ ...pose, a: 1, flags: 0, warpSeq: 0, ts: 0 }));
    const ageMs = [-5, 0, 70000][i] ?? i * 13;
    want.push({ pose, uid: 0xfffffff0 + i, flags: i * 3, warpSeq: 250 + i, ageMs: Math.max(0, Math.min(65535, ageMs)) });
    P.writeRecord(u8, i, 0xfffffff0 + i, i * 3, 250 + i, ageMs, st.subarray(P.POSE_OFFSET, P.POSE_OFFSET + P.POSE_BYTES));
  }
  const got = [];
  const head = P.readBatch(u8, (r) => got.push({ ...r }));
  if (!head || head.nearCount !== 3 || head.k !== k || head.tS !== tS) bad.push(`header ${JSON.stringify(head)}`);
  got.forEach((r, i) => {
    const w = want[i];
    const e = poseErrors(w.pose, r);
    if (r.uid !== w.uid >>> 0 || r.flags !== (w.flags & 0xffff) || r.warpSeq !== (w.warpSeq & 0xff) || r.ageMs !== w.ageMs)
      e.push(`record fields ${r.uid}/${r.flags}/${r.warpSeq}/${r.ageMs}`);
    if (r.sampleTs !== ((tS - w.ageMs) >>> 0)) e.push(`sampleTs ${r.sampleTs}`);
    if (e.length) bad.push(`#${i} ${e.join('; ')}`);
  });
  if (got.length !== k) bad.push(`read ${got.length} of ${k}`);
  const short = P.readBatch(u8.subarray(0, u8.length - 1), () => {});
  const wrongType = P.readBatch(new Uint8Array(P.HEADER_BYTES), () => {});
  check(
    '(2) BATCH round-trips; ageMs clamps; malformed reads null',
    bad.length === 0 && short === null && wrongType === null,
    bad.length ? `first: ${bad[0]}` : `${k} records, u32-wrapping tS, ageMs -5 -> 0 and 70000 -> 65535`
  );
}

// (3) exact sizes
{
  const st = P.encodeState({ ...EXTREMES[0], a: 0, flags: 0, warpSeq: 0, ts: 0 });
  const wrongSize = P.decodeState(new Uint8Array(30)) === null && P.decodeState(new Uint8Array(28)) === null;
  const wrongType = new Uint8Array(st.slice(0));
  wrongType[0] = 2;
  check(
    '(3) exact sizes: STATE 29 · RECORD 29 · HEADER 8 · POSE 20 at 9',
    st.byteLength === 29 &&
      P.STATE_BYTES === 29 &&
      P.RECORD_BYTES === 29 &&
      P.HEADER_BYTES === 8 &&
      P.POSE_OFFSET === 9 &&
      P.POSE_BYTES === 20 &&
      P.POSE_OFFSET + P.POSE_BYTES === P.STATE_BYTES &&
      wrongSize &&
      P.decodeState(wrongType) === null,
    `encodeState -> ${st.byteLength} B; 28/30-byte and type-2 frames decode null`
  );
}

// (4) pose tail at offset 9 in both, byte-identical
{
  const st = new Uint8Array(P.encodeState({ ...EXTREMES[1], a: 9, flags: 0xff, warpSeq: 7, ts: 123 }));
  const tail = st.subarray(P.POSE_OFFSET, P.POSE_OFFSET + P.POSE_BYTES);
  const u8 = new Uint8Array(P.HEADER_BYTES + 2 * P.RECORD_BYTES);
  P.writeRecord(u8, 1, 42, 0, 0, 0, tail);
  const rec = u8.subarray(P.HEADER_BYTES + P.RECORD_BYTES + P.POSE_OFFSET, P.HEADER_BYTES + 2 * P.RECORD_BYTES);
  check(
    '(4) the 20-byte POSE tail is at offset 9 in STATE and record, byte-identical',
    rec.length === 20 && rec.every((b, i) => b === tail[i]),
    'the relay copies bytes and never re-quantizes'
  );
}

// (5) flag bits
{
  const bits = [P.F.HELD, P.F.CRASHED, P.F.BOOST, P.F.SMOKE, P.F.ASSISTED, P.F.EMOTE_MASK, P.F.EMOTE_TOGGLE];
  let seen = 0;
  let overlap = false;
  for (const b of bits) {
    if (seen & b) overlap = true;
    seen |= b;
  }
  check(
    '(5) flag bits unique, all inside F.KNOWN; reserved bits 8-15 mask to 0',
    !overlap && seen === P.F.KNOWN && P.F.KNOWN === 0xff && (0xffff & P.F.KNOWN) === 0xff && P.F.EMOTE_MASK === 3 << P.F.EMOTE_SHIFT,
    `union 0x${seen.toString(16)}`
  );
}

// (6) emotes
{
  const bad = [];
  for (const base of [0, P.F.HELD | P.F.SMOKE | P.F.ASSISTED, 0xff, 0xff00])
    for (let code = 0; code < 4; code++)
      for (const tog of [false, true]) {
        const f = P.withEmote(base, code, tog);
        const keep = base & ~(P.F.EMOTE_MASK | P.F.EMOTE_TOGGLE);
        if (P.emoteOf(f) !== code || !!(f & P.F.EMOTE_TOGGLE) !== tog || (f & ~(P.F.EMOTE_MASK | P.F.EMOTE_TOGGLE)) !== keep)
          bad.push(`${base}/${code}/${tog} -> ${f}`);
      }
  check(
    '(6) withEmote / emoteOf round-trip every code × toggle, other bits kept',
    bad.length === 0 && P.EMOTES.length === 4,
    bad.join(', ')
  );
}

// (7) AIRCRAFT_IDS mirrors the hangar
{
  const ids = PLAYER_AIRCRAFT.map((a) => a.id);
  check(
    '(7) AIRCRAFT_IDS deep-equals PLAYER_AIRCRAFT ids',
    JSON.stringify(ids) === JSON.stringify([...P.AIRCRAFT_IDS]),
    `${P.AIRCRAFT_IDS.length} ids: ${P.AIRCRAFT_IDS.join(' ')}`
  );
}

// (8) every phone presentation GLB exists
{
  const missing = [];
  const urls = [];
  for (const id of P.AIRCRAFT_IDS) {
    const url = aircraftPresentation(resolveAircraft(id), true).url;
    urls.push(url);
    if (typeof url !== 'string' || !url.startsWith('/models/') || !existsSync(path.join(ROOT, 'public', url)))
      missing.push(`${id} -> ${url}`);
  }
  check(
    '(8) every aircraftPresentation(resolveAircraft(id), true).url exists under public/models',
    missing.length === 0 && new Set(urls).size === urls.length,
    missing.length ? missing.join(', ') : `${urls.length} distinct phone GLBs`
  );
}

// (9) remote-meta tables
{
  const bad = [];
  for (const id of P.AIRCRAFT_IDS) {
    const i = REMOTE_ARCHETYPE[id];
    if (!Number.isInteger(i) || !TRAFFIC_MODELS[i]) bad.push(`${id} -> archetype ${i}`);
    if (typeof REMOTE_ICON[id] !== 'string') bad.push(`${id} has no icon`);
  }
  const extra = [...Object.keys(REMOTE_ARCHETYPE), ...Object.keys(REMOTE_ICON)].filter((k) => !P.AIRCRAFT_IDS.includes(k));
  check(
    '(9) every REMOTE_ARCHETYPE has a non-null TRAFFIC_MODELS[i]; tables cover AIRCRAFT_IDS exactly',
    bad.length === 0 && extra.length === 0 && TRAFFIC_MODELS.length === 13,
    bad.length || extra.length ? [...bad, ...extra.map((k) => `extra key ${k}`)].join(', ') : 'TRAFFIC_MODELS still 13'
  );
}

// (10) pilot ids
check(
  '(10) pilotId is p:<base36>; isRemote never matches an ICAO hex',
  P.pilotId(35) === 'p:z' &&
    P.pilotId(2 ** 32 - 1) === 'p:1z141z3' &&
    isRemote(P.pilotId(1)) &&
    !isRemote('a1b2c3') &&
    !isRemote('~a1b2c3') &&
    !isRemote(null),
  `${P.pilotId(1)} ${P.pilotId(2 ** 32 - 1)}`
);

// (11) no-persistence scan
{
  const BANNED = /localStorage|sessionStorage|indexedDB|persist\(|document\.cookie/;
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) return [{ rel, missing: true }];
    if (!statSync(abs).isDirectory()) return [{ rel }];
    return readdirSync(abs).flatMap((n) => walk(path.join(rel, n)));
  };
  const files = [
    'lib/fly/mp',
    'stores/mp-store.js',
    'server',
    'hooks/use-fly-multiplayer.js',
    'components/fly/hud/MpStatusChip.jsx',
    'components/fly/hud/atlas/PilotsCard.jsx',
  ].flatMap(walk);
  const hits = [];
  let scanned = 0;
  for (const f of files) {
    if (f.missing) {
      info('(11) no-persistence scan', `${f.rel} not yet present (a later phase adds it)`);
      continue;
    }
    scanned++;
    readFileSync(path.join(ROOT, f.rel), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (BANNED.test(line)) hits.push(`${f.rel}:${i + 1}`);
      });
  }
  check(
    '(11) NO-PERSISTENCE: no multiplayer file touches web storage, persist( or cookies',
    hits.length === 0 && scanned >= 5,
    hits.length ? hits.join(', ') : `${scanned} files scanned`
  );
}

// (12) BACKUP_KEYS unchanged
{
  const want = ['shadowadsb-passport', 'fly-atlas', 'fly-contracts', 'fly-contracts-active-v1', 'fly-adventures-v1', 'fly-encounters-v1'];
  check(
    '(12) BACKUP_KEYS is exactly the pre-multiplayer list',
    JSON.stringify(BACKUP_KEYS) === JSON.stringify(want),
    BACKUP_KEYS.join(', ')
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
