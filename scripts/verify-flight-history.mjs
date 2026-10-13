// GATE TO GATE — verify-flight-history (node; no browser, no server).
//
// lib/fly/flight-history.mjs (FLY_GATE_TO_GATE_PLAN.md W0.4; design-experience
// "Flight history v2") against an in-memory storage:
//   v2 append/read and normalisation · the 200-row cap · v1 rows mapped to v2
//   with grade null · corrupt rows skipped · the v1 key never deleted or
//   rewritten · v1/v2 twins shown once · bests() on a fixture · blocked
//   storage never throws (session rows) · appendHistoryV1 writes exactly what
//   OperationsHUD's writer writes.
// Imported with no resolver hook (the module must load bare).
// Run: node scripts/verify-flight-history.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = await import(pathToFileURL(path.join(ROOT, 'lib/fly/flight-history.mjs')).href);

let pass = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name} — ${String(error?.message || error).split('\n')[0]}`);
  }
}

// In-memory localStorage; `writes` counts setItem per key.
function memory(seed = {}) {
  const m = new Map(Object.entries(seed));
  const writes = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); writes.set(k, (writes.get(k) ?? 0) + 1); },
    removeItem: (k) => m.delete(k),
    m,
    writes,
  };
}
const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
const full = (seed) => Object.assign(memory(seed), { setItem() { throw new Error('QuotaExceededError'); } });

const T0 = Date.UTC(2026, 9, 13, 18);
const flight = (n, extra = {}) => ({
  at: T0 + n * 60000,
  durationSec: 600,
  aircraft: 'airliner',
  start: 'gate',
  departure: { id: 'KCMH', ident: 'KCMH', name: 'John Glenn Columbus', runway: '10R' },
  destination: { id: 'LOWI:08-26', ident: 'LOWI', name: 'Innsbruck', runway: '08' },
  assisted: false,
  assistReasons: [],
  touchdown: { fpm: -180, sinkMps: 0.91, crossFt: 4, aimFt: 120, speedKt: 138, vrefKt: 135, flareRatio: 0.8, floatSec: 2.1, bounced: false },
  rollout: { maxCrossFt: 6, remainingFt: 2400 },
  grade: { letter: 'A', score: 90, parts: { sink: 0.9, centreline: 0.95 } },
  route: { nm: 380, maxAltFt: 35000, track: [[39.99, -82.89], [47.26, 11.34]] },
  photoId: null,
  ...extra,
});
// OperationsHUD's v1 summary shape (flight-operations.js completion).
const summary = (n, extra = {}) => ({ aircraft: 'prop', departure: 'KOSU', destination: 'KCMH', duration: 300, touchdown: 'Smooth', assisted: false, at: T0 - 86400000 + n * 60000, ...extra });

// The v1 writer from OperationsHUD.jsx before G2G W0, verbatim (o.summary -> summary).
function hudWriter(summaryRow, localStorage) {
  try{let raw;try{raw=JSON.parse(localStorage.getItem('fly-flight-history')||'[]');}catch{raw=[];}const rows=Array.isArray(raw)?raw:[];localStorage.setItem('fly-flight-history',JSON.stringify([...rows,summaryRow].slice(-100)));}catch{}
}

// ---- section: v2 rows ---------------------------------------------------------
console.log('\n[v2]');

await check('a v2 row round-trips in its stored shape; unknown fields drop, the track keeps at most 64 points', () => {
  H.clearSessionHistory();
  const st = memory();
  const long = Array.from({ length: 300 }, (_, i) => [40 + i / 100, -83 + i / 100]);
  const row = H.appendHistoryV2({ ...flight(1, { id: 'f1', route: { nm: 12, maxAltFt: 3000, track: long } }), junk: 'x' }, st);
  assert.equal(row.v, 2);
  assert.equal(row.junk, undefined);
  assert.equal(row.route.track.length, H.TRACK_MAX);
  assert.deepEqual(row.route.track[0], long[0]);
  assert.deepEqual(row.route.track.at(-1), long.at(-1));
  assert.equal(row.startedAt, row.at - 600000);
  const read = H.readHistory(st);
  assert.deepEqual(read, [row]);
  assert.deepEqual(JSON.parse(st.getItem(H.HISTORY_V2_KEY)), [row]);
  // A missing id is generated; an invalid row is refused.
  assert.match(H.appendHistoryV2(flight(2), st).id, /^h-/);
  assert.equal(H.appendHistoryV2({ at: T0 }, st), null, 'no aircraft');
  assert.equal(H.appendHistoryV2(null, st), null);
  assert.equal(H.readHistory(st).length, 2);
  assert.deepEqual(H.START_KINDS, ['gate', 'apron', 'runway', 'approach', 'free']);
});

await check('the v2 log keeps the last 200 rows', () => {
  H.clearSessionHistory();
  const st = memory();
  for (let i = 0; i < 205; i++) H.appendHistoryV2(flight(i, { id: `f${i}` }), st);
  const stored = JSON.parse(st.getItem(H.HISTORY_V2_KEY));
  assert.equal(stored.length, H.HISTORY_V2_CAP);
  assert.equal(stored[0].id, 'f5');
  assert.equal(stored.at(-1).id, 'f204');
});

// ---- section: v1 merge --------------------------------------------------------
console.log('\n[v1]');

await check('v1 rows map to v2 with grade null; the v1 key is never deleted or rewritten', () => {
  H.clearSessionHistory();
  const v1 = JSON.stringify([summary(0), summary(1, { departure: null, destination: 'LOWI:08-26', touchdown: 'Firm' })]);
  const st = memory({ [H.HISTORY_V1_KEY]: v1 });
  const lookup = (id) => ({ KOSU: { name: 'Ohio State University', runway: '09R' }, KCMH: { name: 'John Glenn Columbus', runway: '10R' } })[id];
  H.appendHistoryV2(flight(5, { id: 'f5' }), st);
  const rows = H.readHistory(st, { lookup });
  assert.deepEqual(rows.map((r) => r.id), [`v1-${summary(0).at}`, `v1-${summary(1).at}`, 'f5'], 'oldest first');
  const [a, b] = rows;
  assert.equal(a.v, 2);
  assert.equal(a.grade, null);
  assert.equal(a.touchdown, null);
  assert.equal(a.durationSec, 300);
  assert.equal(a.startedAt, a.at - 300000);
  assert.deepEqual(a.departure, { id: 'KOSU', ident: 'KOSU', name: 'Ohio State University', runway: '09R' });
  assert.deepEqual(a.legacy, { key: H.HISTORY_V1_KEY, touchdown: 'Smooth' });
  assert.equal(a.start, null);
  assert.equal(b.start, 'free', 'no departure was free exploration');
  assert.deepEqual(b.destination, { id: 'LOWI:08-26', ident: 'LOWI', name: null, runway: '08' });
  // Read, appended and read again: the v1 key is the same bytes and was never written.
  H.readHistory(st);
  assert.equal(st.getItem(H.HISTORY_V1_KEY), v1);
  assert.equal(st.writes.get(H.HISTORY_V1_KEY) ?? 0, 0);
});

await check('corrupt rows and corrupt logs are skipped, never thrown', () => {
  H.clearSessionHistory();
  const good = flight(3, { id: 'good', v: 2 });
  const st = memory({
    [H.HISTORY_V2_KEY]: JSON.stringify([null, 7, 'x', [], { v: 3, id: 'later', at: T0, aircraft: 'prop' }, { v: 2, id: 'noat', aircraft: 'prop' }, { v: 2, at: T0, aircraft: 'prop' }, { v: 2, id: 'neg', at: -1, aircraft: 'prop' }, good]),
    [H.HISTORY_V1_KEY]: JSON.stringify([null, 'x', { aircraft: 'prop' }, { at: 'soon', aircraft: 'prop' }, summary(2)]),
  });
  assert.deepEqual(H.readHistory(st).map((r) => r.id), [`v1-${summary(2).at}`, 'good']);
  for (const junk of ['{nope', '{}', '"text"', 'null', '42']) {
    const s = memory({ [H.HISTORY_V2_KEY]: junk, [H.HISTORY_V1_KEY]: junk });
    assert.deepEqual(H.readHistory(s), [], junk);
  }
  // Malformed nested parts are cleaned, not fatal.
  const odd = H.appendHistoryV2(flight(4, { id: 'odd', grade: { letter: 'A', score: 'high' }, touchdown: 'soft', assistReasons: ['lineup', 3, ''], route: { track: [[1, 2], ['a', 3], 5] } }), memory());
  assert.equal(odd.grade, null);
  assert.equal(odd.touchdown, null);
  assert.deepEqual(odd.assistReasons, ['lineup']);
  assert.deepEqual(odd.route.track, [[1, 2]]);
});

await check('a v1 summary and its v2 twin (same time and aircraft) show once, as the v2 row', () => {
  H.clearSessionHistory();
  const s = summary(9, { aircraft: 'airliner' });
  const st = memory({ [H.HISTORY_V1_KEY]: JSON.stringify([s, summary(10)]) });
  H.appendHistoryV2(flight(0, { id: 'twin', at: s.at }), st);
  assert.deepEqual(H.readHistory(st).map((r) => r.id), ['twin', `v1-${summary(10).at}`]);
});

// ---- section: bests -----------------------------------------------------------
console.log('\n[bests]');

await check('bests() per destination ident: best grade, softest touchdown, flight count; ties keep the earlier row', () => {
  const at = (n) => T0 + n;
  const rows = [
    { id: 'a', at: at(1), destination: { ident: 'LOWI' }, grade: { letter: 'B', score: 80 }, touchdown: { fpm: -300 } },
    { id: 'b', at: at(2), destination: { ident: 'LOWI' }, grade: { letter: 'A', score: 91 }, touchdown: { fpm: -420 } },
    { id: 'c', at: at(3), destination: { ident: 'LOWI' }, grade: { letter: 'A', score: 91 }, touchdown: { sinkMps: 0.5 } },
    { id: 'd', at: at(4), destination: { ident: 'LOWI' }, grade: null, touchdown: null },
    { id: 'e', at: at(5), destination: { ident: 'KCMH' }, grade: null, touchdown: { fpm: -150 } },
    { id: 'f', at: at(6), destination: null, grade: { letter: 'A+', score: 99 } },
  ];
  const b = H.bests(rows);
  assert.deepEqual(Object.keys(b).sort(), ['KCMH', 'LOWI']);
  assert.equal(b.LOWI.count, 4);
  assert.equal(b.LOWI.best.id, 'b');
  assert.equal(b.LOWI.softest.id, 'c', '0.5 m/s = 98 fpm beats 300 fpm');
  assert.deepEqual([b.KCMH.count, b.KCMH.best, b.KCMH.softest.id], [1, null, 'e']);
  // Mapped v1 rows count but carry no grade.
  const st = memory({ [H.HISTORY_V1_KEY]: JSON.stringify([summary(1), summary(2)]) });
  const v1 = H.bests(H.readHistory(st));
  assert.deepEqual([v1.KCMH.count, v1.KCMH.best, v1.KCMH.softest], [2, null, null]);
  assert.deepEqual(Object.keys(H.bests(null)), []);
});

// ---- section: storage -----------------------------------------------------------
console.log('\n[storage]');

await check('blocked or full storage never throws: v2 rows live for the session, reads still merge', () => {
  H.clearSessionHistory();
  assert.deepEqual(H.readHistory(blocked), []);
  const row = H.appendHistoryV2(flight(1, { id: 's1' }), blocked);
  assert.equal(row.id, 's1');
  assert.deepEqual(H.readHistory(blocked).map((r) => r.id), ['s1']);
  assert.deepEqual(H.readHistory(null).map((r) => r.id), ['s1']);
  // Full: the stored rows still read, the new one is session-only.
  const st = full({ [H.HISTORY_V2_KEY]: JSON.stringify([flight(0, { id: 'stored', v: 2 })]) });
  H.appendHistoryV2(flight(2, { id: 's2' }), st);
  assert.deepEqual(H.readHistory(st).map((r) => r.id), ['stored', 's1', 's2']);
  assert.equal(H.appendHistoryV1(summary(1), blocked), false);
  assert.equal(H.appendHistoryV1(summary(1), null), false);
  H.clearSessionHistory();
  assert.deepEqual(H.readHistory(blocked), []);
});

await check("appendHistoryV1 writes exactly what OperationsHUD's writer wrote", () => {
  const full100 = JSON.stringify(Array.from({ length: 100 }, (_, i) => summary(i)));
  const seeds = [{}, { [H.HISTORY_V1_KEY]: '[]' }, { [H.HISTORY_V1_KEY]: full100 }, { [H.HISTORY_V1_KEY]: '{"rows":[]}' }, { [H.HISTORY_V1_KEY]: '{nope' }, { [H.HISTORY_V1_KEY]: '' }, { other: 'kept' }];
  for (const seed of seeds) {
    const ours = memory(seed), theirs = memory(seed);
    for (const s of [summary(200), summary(201, { departure: null, touchdown: 'Practice', assisted: true })]) {
      assert.equal(H.appendHistoryV1(s, ours), true);
      hudWriter(s, theirs);
    }
    assert.deepEqual([...ours.m], [...theirs.m], JSON.stringify(seed).slice(0, 40));
  }
  const ours = memory({ [H.HISTORY_V1_KEY]: full100 });
  H.appendHistoryV1(summary(300), ours);
  const rows = JSON.parse(ours.getItem(H.HISTORY_V1_KEY));
  assert.equal(rows.length, H.HISTORY_V1_CAP);
  assert.equal(rows.at(-1).at, summary(300).at);
  // Throwing storage: both swallow it (old: silent; new: false).
  const throwsOnRead = Object.assign(memory(), { getItem() { throw new Error('SecurityError'); } });
  const throwsOnRead2 = Object.assign(memory(), { getItem() { throw new Error('SecurityError'); } });
  assert.equal(H.appendHistoryV1(summary(1), throwsOnRead), true);
  hudWriter(summary(1), throwsOnRead2);
  assert.deepEqual([...throwsOnRead.m], [...throwsOnRead2.m]);
});

// ---- summary ----------------------------------------------------------------
const total = pass + failures.length;
console.log(`\nFLIGHT HISTORY: ${pass}/${total}${failures.length ? ` — FAILED: ${failures.join(' | ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
