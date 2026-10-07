/**
 * MULTIPLAYER — verify-mp-relay: the relay end to end (MULTIPLAYER.md §Relay;
 * design §13 gate 2). In-process relays on 127.0.0.1:0, driven by Node 22's
 * global WebSocket (bot pilots that encode STATE with protocol.mjs) and by raw
 * http.request upgrades wherever a header matters (Node's WebSocket cannot set
 * Origin or X-Forwarded-For) or a malformed frame must be sent. No network
 * beyond loopback, no browser. Short test timings ride startRelay(opts).
 *
 * MAIN instance (tickHz 20, afkMs 1000, idleCloseMs 3000, teleportRefillMs
 * 2000, allowNoOrigin):
 *  (1)  welcome + callsign format; (2) same seed -> same callsign, old socket
 *       4000; (3) colliding callsigns made unique; (4) ?v=2 -> err + 4002;
 *  (5)  Origin / path refused BEFORE a socket exists (403 / 404, raw upgrade);
 *  (6)  A and B 2 km apart: B gets enter{cs:A} THEN a batch whose decoded
 *       lat/lon match within 1e-6, nearCount 1;
 *  (7)  C 500 km away gets nothing; (8) C at 140 km -> enter + ~1 record/s;
 *  (9)  the near tier runs at the tick rate; (10) hysteresis: C at 165 km is
 *       kept, past 175 km it exits;
 *  (11) teleport: no warpSeq bump -> dropped; bump -> accepted; the 4th bump
 *       inside the token budget -> dropped, then heals when a token refills;
 *  (12) a TCP burst of correctly spaced samples is all accepted;
 *  (13) out-of-range lat / lon / speed / aircraft / type, junk text and a
 *       NaN-encoded pose are dropped without closing the socket; reserved
 *       flag bits never reach a viewer;
 *  (14) flood -> 1008; (15) 1 KB frame -> 1009; (16) invalid UTF-8 -> 1007;
 *  (17) after all three /healthz is 200 and a fresh client gets welcome;
 *  (18) HELD past afkMs -> viewers get exit; past idleCloseMs -> 4003;
 *  (19) leave -> exit; the next STATE with a new aircraft re-enters with it;
 *  (20) where -> 2° cell clusters with correct counts, rate-limited, cached;
 *  (21) ping -> pong with the relay clock and the online count;
 *  (22) close() -> {t:'bye'} + 1012 on every live socket.
 * CAP instance (maxPlayers 3): (23) the 4th client gets err full + 4001.
 * IP instance (trustProxy loopback, maxPerIp 2): (24) XFF keys + 429, the
 *  right-most untrusted hop wins; (25) IPv6 /56 shared key and /48 aggregate
 *  cap; (26) the connect-rate cap; (27) ipKeys / makeTrust / clientIp units.
 * (28) sharedKeyWarn fires on ATTEMPTS: 12 upgrades from one key at the
 *      default maxPerIp 6 (live sockets alone can never pass 80% of 10);
 *      the IP instance's mixed keys read 0.
 * (29) pre-request: an untrusted peer holds at most 2 × maxPerIp TCP
 *      connections, and idle / half-sent headers get 408 within
 *      headersTimeout + the check interval (node's default check is 30 s).
 * (30) config: out-of-range numbers, an MP_ORIGINS or MP_TRUST_PROXY list with
 *      no valid entry refuse to start; a bad entry beside good ones is a
 *      warning naming its position; a failed listen leaves no timer running.
 * (31) a SYMLINKED main auto-starts, and SIGTERM stops it cleanly (exit 0).
 * (32) THE LOG: every captured line, from every instance, holds no loopback or
 *      XFF test address, no callsign and no pilot id.
 * WORLD direct (fake clock): (33) 2,000 pilots across the antimeridian and
 *      above 80°N — grid + quickselect interest == brute force nearest-48
 *      within 150 km (the gate's OWN copy of the metric), every viewer, with
 *      the shipped hysteresis AND with exitKm = radiusKm (no query slack);
 *      callsigns unique; a repeat pass is stable.
 * (34) a TCP stall: 1 Hz samples at 750 m/s queued 2.5 / 5.1 / 8.1 s and
 *      delivered together are all accepted; a forged ts buys the window once.
 * (35) leave purges what was queued for the leaver: no exit for an id the
 *      client already dropped (a control viewer still gets both).
 * (36) an aircraft flip mid-flight sends current viewers nothing (no enter
 *      spam); a NEW viewer's enter carries the latest aircraft.
 *
 * RED CALIBRATION (mutated copies of server/mp-world.mjs, each run in a scratch
 * tree): movement paced by arrival time -> (12)+(13) red; reserved flags kept
 * -> (13); a rejected jump adopting its warpSeq -> (11); no dLon wrap in the
 * metric -> (33) 217/217; partial rows without the column wrap -> (33) 0/7;
 * column span from the viewer's latitude with no whole row -> (33) 0/1;
 * first-48 instead of nearest-48 -> (33) 1101/1101. The tight pass is what
 * sees the two grid-bound defects: the shipped 175 km query hides them.
 * Pacing by the 3 s presentation clamp -> (34) 2.5 s 2/2, 5.1 s 3/5, 8.1 s
 * 1/8; leave without purging the queue -> (35) 2 stale exits; re-announcing
 * an aircraft change -> (36) 40 enters. Relay (server/mp-relay.mjs) copies:
 * sharedKeyWarn on live sockets only -> (28) 0; node's default 30 s
 * connection check -> (29) no 408 inside 5 s; no per-peer TCP cap -> (29) 0
 * refused; no range / list validation -> (30) all 12 start; an interval
 * started before listen -> (30) one more timer; path.resolve without
 * realpath for the main check -> (31) never starts.
 *
 * Run: node scripts/verify-mp-relay.mjs   (finishes in well under 60 s)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startRelay, ipKeys, makeTrust, clientIp } from '../server/mp-relay.mjs';
import { createWorld, callsignFor, CALLSIGN_NOUNS, CALLSIGN_DENY, KM_PER_DEG } from '../server/mp-world.mjs';
import * as P from '../lib/fly/mp/protocol.mjs';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const watchdog = setTimeout(() => {
  console.log('FAIL  the gate itself timed out at 58 s');
  process.exit(1);
}, 58000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 3000) {
  const end = performance.now() + ms;
  for (;;) {
    const v = pred();
    if (v || performance.now() > end) return v;
    await sleep(10);
  }
}
const nowTs = () => Math.floor(performance.now()) >>> 0; // the relay runs in-process: same clock
const north = (pose, km) => ({ ...pose, lat: pose.lat + km / KM_PER_DEG });
const at = (lat, lon, alt = 1000) => ({ lat, lon, alt, heading: 0, pitch: 0, bank: 0, speed: 150, vUp: 0 });
const uidOf = (id) => parseInt(id.slice(2), 36);
const CS_RE = /^([A-Z]+) (\d\d)$/;
const callsignsSeen = new Set();
const idsSeen = new Set();

// ---- bot pilots on Node's global WebSocket --------------------------------
const bots = new Set();
const pumped = new Set();
let pumpOn = true;
const pump = setInterval(() => {
  if (pumpOn) for (const b of pumped) b.state();
}, 50);

function bot(port, seed, { v = 1 } = {}) {
  const b = { msgs: [], welcome: null, closed: null, pose: null, a: 0, flags: 0, warpSeq: 0 };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/mp?v=${v}`);
  ws.binaryType = 'arraybuffer';
  b.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 1, seed }));
  ws.onmessage = (e) => {
    const i = b.msgs.length;
    if (typeof e.data === 'string') {
      const m = JSON.parse(e.data);
      m._i = i;
      b.msgs.push(m);
      if (m.t === 'welcome') {
        b.welcome = m;
        callsignsSeen.add(m.cs);
        idsSeen.add(m.id);
      }
      if (m.t === 'enter') callsignsSeen.add(m.cs);
    } else {
      const recs = [];
      const head = P.readBatch(e.data, (r) => recs.push({ ...r }));
      b.msgs.push({ t: 'batch', head, recs, _i: i, _at: performance.now() });
    }
  };
  ws.onerror = () => {};
  b.closedP = new Promise((res) => {
    ws.onclose = (e) => {
      b.closed = { code: e.code, reason: e.reason };
      pumped.delete(b);
      res(b.closed);
    };
  });
  b.send = (o) => ws.readyState === 1 && ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  b.raw = (u8) => ws.readyState === 1 && ws.send(u8);
  b.encode = (over = {}) => P.encodeState({ ...b.pose, a: b.a, flags: b.flags, warpSeq: b.warpSeq, ts: nowTs(), ...over });
  b.state = (over) => b.pose && b.raw(b.encode(over));
  b.json = (t, id) => b.msgs.filter((m) => m.t === t && (id === undefined || m.id === id));
  b.recs = (uid, from = 0) => b.msgs.filter((m) => m.t === 'batch' && m._i >= from).flatMap((m) => m.recs.filter((r) => r.uid === uid));
  b.lastRec = (uid) => b.recs(uid).at(-1);
  bots.add(b);
  return b;
}
async function pilot(port, seed, pose, opts = {}) {
  const b = bot(port, seed, opts);
  await waitFor(() => b.welcome || b.closed);
  if (pose) {
    b.pose = pose;
    pumped.add(b);
  }
  return b;
}
const closedWith = async (b, ms = 3000) => (await Promise.race([b.closedP, sleep(ms).then(() => null)]))?.code;

// ---- raw upgrades (headers we control, frames we can malform) -------------
const rawSockets = new Set();
function rawUpgrade(port, reqPath, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: reqPath,
      agent: false,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        ...headers,
      },
    });
    req.on('upgrade', (res, socket, head) => {
      socket.on('error', () => {});
      rawSockets.add(socket);
      resolve({ status: res.statusCode, socket, head });
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.end();
  });
}
function maskedFrame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  const body = Buffer.from(payload.map((x, i) => x ^ mask[i & 3]));
  return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, body]);
}
function closeCodeOf(socket, head) {
  return new Promise((resolve) => {
    let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0);
    const parse = () => {
      let off = 0;
      while (buf.length - off >= 2) {
        const op = buf[off] & 0x0f;
        let len = buf[off + 1] & 0x7f;
        let h = 2;
        if (len === 126) {
          if (buf.length - off < 4) return;
          len = buf.readUInt16BE(off + 2);
          h = 4;
        }
        if (buf.length - off < h + len) return;
        if (op === 8) return resolve(len >= 2 ? buf.readUInt16BE(off + h) : 1005);
        off += h + len;
      }
    };
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      parse();
    });
    socket.on('close', () => resolve(null));
    setTimeout(() => resolve(null), 3000);
    parse();
  });
}
const healthz = async (port, p = '/mp/healthz') => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`);
  return { status: res.status, cc: res.headers.get('cache-control'), acao: res.headers.get('access-control-allow-origin'), body: await res.json() };
};

const logs = [];
const log = (line) => logs.push(line);

// =========================== MAIN instance ================================
const main = await startRelay({
  port: 0,
  allowNoOrigin: true,
  maxPlayers: 40,
  maxPerIp: 60,
  connectPerMin: 1000,
  tickHz: 20,
  afkMs: 1000,
  idleCloseMs: 3000,
  // A refill inside idleCloseMs: a pilot whose every sample is rejected has
  // sent no ACCEPTED state, so it is idle-closed after 3 s (by design).
  teleportRefillMs: 2000,
  msgRate: 40,
  msgBurst: 80,
  logEveryMs: 400,
  log,
});
const W = main.world;
const port = main.port;

// (1) welcome + callsign
const OHIO = at(40, -83, 1000);
const A1 = await pilot(port, 1001, OHIO);
{
  const w = A1.welcome;
  const m = CS_RE.exec(w?.cs ?? '');
  const num = m ? Number(m[2]) : -1;
  check(
    '(1) welcome: id p:<base36>, callsign NOUN NN from the curated list, palette 0-7',
    !!w &&
      w.v === P.PROTOCOL &&
      /^p:[0-9a-z]+$/.test(w.id) &&
      !!m &&
      CALLSIGN_NOUNS.includes(m[1]) &&
      num >= 10 &&
      num <= 99 &&
      !CALLSIGN_DENY.includes(num) &&
      w.cs === callsignFor(1001) &&
      Number.isInteger(w.c) &&
      w.c >= 0 &&
      w.c <= 7 &&
      w.n >= 1 &&
      CALLSIGN_NOUNS.length >= 90 &&
      new Set(CALLSIGN_NOUNS).size === CALLSIGN_NOUNS.length &&
      CALLSIGN_NOUNS.every((n) => /^[A-Z]+$/.test(n)),
    w ? `${w.id} ${w.cs} c=${w.c} n=${w.n}; ${CALLSIGN_NOUNS.length} nouns, deny ${CALLSIGN_DENY.join('/')}` : 'no welcome'
  );
}

// (2) same seed replaces
const A = await pilot(port, 1001, OHIO);
{
  const code = await closedWith(A1);
  check(
    '(2) the same seed again: new socket inherits the callsign, the old one closes 4000',
    A.welcome?.cs === A1.welcome?.cs && A.welcome.id !== A1.welcome.id && uidOf(A.welcome.id) > uidOf(A1.welcome.id) && code === P.CLOSE.REPLACED,
    `${A.welcome?.cs} ${A1.welcome?.id} -> ${A.welcome?.id}, old closed ${code}`
  );
}

// (3) colliding callsigns
{
  const base = callsignFor(7777);
  let s2 = 1;
  while (s2 === 7777 || callsignFor(s2) !== base) s2++;
  const X = await pilot(port, 7777);
  const Y = await pilot(port, s2);
  const k = [1, 2, 3, 4, 5, 6, 7, 8].find((i) => callsignFor(s2, i) === Y.welcome?.cs);
  check(
    '(3) two seeds that hash to the same callsign get unique ones (re-rolled with seed+k)',
    X.welcome?.cs === base && Y.welcome?.cs !== base && CS_RE.test(Y.welcome?.cs ?? '') && k > 0,
    `seeds 7777 / ${s2} both hash to ${base}; second got ${Y.welcome?.cs} (k=${k})`
  );
}

// (4) version
{
  const V = bot(port, 5, { v: 2 });
  const code = await closedWith(V);
  const err = V.json('err')[0];
  check(
    '(4) an unsupported ?v= gets {t:err,code:version,need} and close 4002',
    code === P.CLOSE.VERSION && err?.code === 'version' && err?.need === P.PROTOCOL,
    `close ${code}, ${JSON.stringify(err)}`
  );
}

// (5) Origin / path, refused before a socket exists
{
  const evil = await rawUpgrade(port, '/mp?v=1', { Origin: 'https://evil.example' });
  const lookalike = await rawUpgrade(port, '/mp?v=1', { Origin: 'http://localhost.evil.example' });
  const local = await rawUpgrade(port, '/mp?v=1', { Origin: 'http://localhost:3000' });
  const wrongPath = await rawUpgrade(port, '/nope?v=1');
  local.socket?.destroy();
  check(
    '(5) bad Origin -> 403 and wrong path -> 404 before any socket; a localhost origin upgrades',
    evil.status === 403 && lookalike.status === 403 && local.status === 101 && wrongPath.status === 404,
    `evil ${evil.status} · lookalike ${lookalike.status} · localhost:3000 ${local.status} · /nope ${wrongPath.status}`
  );
}

// (6) A and B 2 km apart
const B = await pilot(port, 2002, north(OHIO, 2));
{
  const enter = await waitFor(() => B.json('enter', A.welcome.id)[0]);
  const uid = uidOf(A.welcome.id);
  const first = await waitFor(() => B.msgs.find((m) => m.t === 'batch' && m.recs.some((r) => r.uid === uid)));
  const rec = first?.recs.find((r) => r.uid === uid);
  check(
    '(6) 2 km apart: B gets enter{cs:A} THEN a batch whose decoded lat/lon match within 1e-6, nearCount 1',
    !!enter &&
      enter.cs === A.welcome.cs &&
      enter.a === A.a &&
      enter.c === A.welcome.c &&
      !!first &&
      first._i > enter._i &&
      Math.abs(rec.lat - OHIO.lat) < 1e-6 &&
      Math.abs(rec.lon - OHIO.lon) < 1e-6 &&
      first.head.nearCount === 1,
    rec
      ? `enter #${enter._i} -> batch #${first._i} k=${first.head.k} near=${first.head.nearCount}, dLat ${Math.abs(rec.lat - OHIO.lat).toExponential(1)}`
      : 'no record'
  );
}

// (7) C 500 km away hears nothing
const C = await pilot(port, 3003, north(OHIO, 500));
await sleep(1200);
check(
  '(7) C 500 km away gets no enter and no batch, and nobody enters C',
  C.msgs.filter((m) => m.t === 'enter' || m.t === 'batch').length === 0 &&
    A.json('enter', C.welcome.id).length === 0 &&
    B.json('enter', C.welcome.id).length === 0,
  `${C.msgs.length} message(s) to C after 1.2 s (${Math.round(1200 / 50 / 5)} interest passes)`
);

// (8) + (9) C at 140 km: enter, far tier ~1/s; near tier at the tick rate
{
  C.pose = north(OHIO, 140);
  C.warpSeq++;
  const enterA = await waitFor(() => C.json('enter', A.welcome.id)[0] && C.json('enter', B.welcome.id)[0]);
  await sleep(300);
  const uidA = uidOf(A.welcome.id);
  const fromC = C.msgs.length;
  const fromB = B.msgs.length;
  await sleep(3000);
  const far = C.recs(uidA, fromC).length;
  const near = B.recs(uidA, fromB).length;
  const farBatches = C.msgs.filter((m) => m.t === 'batch' && m._i >= fromC);
  check(
    '(8) C moved to 140 km: enter for A and B, then about 1 record/s each (far tier), nearCount 0',
    !!enterA && far >= 2 && far <= 5 && farBatches.every((m) => m.head.nearCount === 0),
    `${far} records of A in 3 s, ${farBatches.length} batches`
  );
  check(
    '(9) near tier: B gets A on every 20 Hz tick that carries a newer sample',
    near >= 30 && near >= 8 * far,
    `${near} records of A in 3 s (pump 20 Hz, tick 20 Hz) vs ${far} far`
  );
}

// (10) hysteresis: kept at 165 km, exits past 175 km
{
  C.pose = north(OHIO, 165);
  C.warpSeq++;
  await sleep(800);
  const kept = C.json('exit', A.welcome.id).length === 0 && C.lastRec(uidOf(A.welcome.id)) != null;
  C.pose = north(OHIO, 185);
  C.warpSeq++;
  const exitA = await waitFor(() => C.json('exit', A.welcome.id)[0] && C.json('exit', B.welcome.id)[0] && A.json('exit', C.welcome.id)[0]);
  check(
    '(10) hysteresis: a known pilot at 165 km stays; past 175 km both sides get exit',
    kept && !!exitA,
    `kept at 165 km: ${kept}; exits at 185 km: ${!!exitA}`
  );
}

// (11) teleport rules
{
  const P0 = at(30, -90, 2000);
  const T = await pilot(port, 4401, P0);
  const Wt = await pilot(port, 4402, north(P0, 0.5));
  const uidT = uidOf(T.welcome.id);
  await waitFor(() => Wt.lastRec(uidT));
  const near = (r, p) => r && Math.abs(r.lat - p.lat) < 1e-6;
  const s0 = W.stats();
  // Zig-zag 100+ km jumps, so the watcher 0.5 km from P0 keeps T in view.
  const P1 = north(P0, 50);
  T.pose = P1; // no warpSeq bump
  await sleep(500);
  const s1 = W.stats();
  const unbumped = s1.teleport > s0.teleport && near(Wt.lastRec(uidT), P0);
  // Bumps are paced on the world's own warp counter, not on the viewer: once
  // an interest pass puts T 50 km out in the 1 Hz far tier, waiting on its
  // records stretches bumps 1-4 toward the 2 s refill and the viewer lags.
  const warps = (n) => () => W.stats().warps - s0.warps >= n;
  T.warpSeq++;
  const ok1 = !!(await waitFor(warps(1)));
  T.pose = north(P0, -50);
  T.warpSeq++;
  const ok2 = !!(await waitFor(warps(2)));
  T.pose = north(P0, 60);
  T.warpSeq++;
  const ok3 = !!(await waitFor(warps(3)));
  const s3 = W.stats();
  T.pose = north(P0, -60);
  T.warpSeq++;
  const t4 = performance.now();
  await sleep(600);
  const fourthDropped = W.stats().warps === s3.warps && W.stats().teleport > s3.teleport;
  const healed = await waitFor(warps(4), 4000);
  const healS = (performance.now() - t4) / 1000;
  const seen = !!(await waitFor(() => near(Wt.lastRec(uidT), T.pose), 2000));
  check(
    '(11) teleport: no warpSeq bump -> dropped; bumps 1-3 accepted; the 4th dropped, then heals on a refill',
    unbumped && ok1 && ok2 && ok3 && fourthDropped && !!healed && healS >= 0.6 && seen && W.stats().warps - s0.warps === 4,
    `unbumped dropped ${s1.teleport - s0.teleport}×; bumps ${ok1}/${ok2}/${ok3}; 4th dropped ${fourthDropped}, healed after ${healS.toFixed(1)} s, viewer sees it ${seen}; warps +${W.stats().warps - s0.warps}`
  );
  T.pose = null;
  pumped.delete(T);
  pumped.delete(Wt);
  T.ws.close();
  Wt.ws.close();
}

// (12) a TCP burst of correctly spaced samples
{
  const U = await pilot(port, 5501);
  const base = at(0.5, 100, 3000);
  pumpOn = false;
  await sleep(120);
  const s0 = W.stats();
  const t0 = nowTs();
  for (let i = 0; i < 4; i++)
    U.raw(P.encodeState({ ...north(base, i * 0.75), speed: 750, a: 0, flags: 0, warpSeq: 0, ts: (t0 - 2900 + 1000 * i) >>> 0 }));
  await sleep(300);
  const s1 = W.stats();
  pumpOn = true;
  check(
    '(12) TCP burst: 4 samples 1 s apart by ts (750 m steps) arriving together are all accepted',
    s1.accepted - s0.accepted === 4 && s1.teleport === s0.teleport && s1.invalid === s0.invalid,
    `accepted +${s1.accepted - s0.accepted}, teleport +${s1.teleport - s0.teleport}, invalid +${s1.invalid - s0.invalid} (arrival spacing alone would cap a step at 620 m)`
  );
  U.ws.close();
}

// (13) validation drops, socket kept
{
  const s0 = W.stats();
  const craft = (fn) => {
    const u8 = new Uint8Array(A.encode());
    fn(new DataView(u8.buffer), u8);
    return u8;
  };
  A.raw(craft((dv) => dv.setInt32(9, 860000000, true))); // lat 86
  A.raw(craft((dv) => dv.setInt32(13, 1810000000, true))); // lon 181
  A.raw(A.encode({ speed: 900 }));
  A.raw(A.encode({ a: P.AIRCRAFT_IDS.length }));
  A.raw(craft((dv, u8) => (u8[0] = 9))); // not a STATE
  A.send('{"t":"nope"}');
  A.send('not json');
  A.raw(A.encode({ lat: NaN, lon: NaN, alt: NaN, heading: NaN, speed: NaN }));
  await sleep(300);
  const s1 = W.stats();
  const lastOfA = B.lastRec(uidOf(A.welcome.id));
  A.flags = 0xff00 | P.F.BOOST; // reserved bits set
  const from = B.msgs.length;
  await sleep(250);
  const masked = B.recs(uidOf(A.welcome.id), from);
  A.flags = 0;
  check(
    '(13) lat 86 / lon 181 / speed 900 / aircraft 10 / type 9 / junk text dropped; a NaN pose (encodes as 0,0) is rejected as a jump; reserved flag bits masked; socket kept',
    s1.invalid - s0.invalid === 5 &&
      s1.text - s0.text === 2 &&
      s1.teleport - s0.teleport >= 1 &&
      A.ws.readyState === 1 &&
      Math.abs(lastOfA.lat - OHIO.lat) < 1e-6 &&
      masked.some((r) => r.flags === P.F.BOOST) &&
      masked.every((r) => (r.flags & 0xff00) === 0),
    `invalid +${s1.invalid - s0.invalid}, text +${s1.text - s0.text}, teleport +${s1.teleport - s0.teleport}, A open ${A.ws.readyState === 1}, ` +
      `viewers still see A at ${lastOfA?.lat}; flags 0xff04 arrive as ${[...new Set(masked.map((r) => '0x' + r.flags.toString(16)))].join('/')}`
  );
}

// (14)-(17) floods, oversize and malformed frames; the relay keeps serving
{
  const Fl = await pilot(port, 6601);
  for (let i = 0; i < 1000; i++) Fl.send('{"t":"ping","c":1}');
  const flood = await closedWith(Fl);
  check('(14) a 1,000-message flood -> close 1008', flood === P.CLOSE.POLICY, `close ${flood}`);

  const G = await pilot(port, 6602);
  G.raw(new Uint8Array(1024));
  const big = await closedWith(G);
  check('(15) a 1 KB frame (maxPayload 512) -> close 1009', big === P.CLOSE.TOO_BIG, `close ${big}`);

  const raw = await rawUpgrade(port, '/mp?v=1');
  raw.socket?.write(maskedFrame(1, [0xc3, 0x28]));
  const utf = raw.socket ? await closeCodeOf(raw.socket, raw.head) : null;
  raw.socket?.destroy();
  check('(16) a text frame with invalid UTF-8 -> close 1007', utf === 1007, `upgrade ${raw.status}, close ${utf}`);

  const h = await healthz(port);
  const h2 = await healthz(port, '/healthz');
  const Z = await pilot(port, 6603);
  check(
    '(17) after all three, /healthz still 200 (no-store, ACAO *) and a fresh client gets welcome',
    h.status === 200 &&
      h2.status === 200 &&
      h.body.ok === true &&
      h.body.v === P.PROTOCOL &&
      h.cc === 'no-store' &&
      h.acao === '*' &&
      ['online', 'visible', 'conns', 'uptimeS'].every((k) => Number.isFinite(h.body[k])) &&
      !!Z.welcome,
    `${JSON.stringify(h.body)}; fresh ${Z.welcome?.id}`
  );
  Z.ws.close();
}

// (18) AFK and idle
{
  const SPOT = at(20, -100, 1500);
  const H = await pilot(port, 7701, SPOT);
  H.flags = P.F.HELD;
  const V2 = await pilot(port, 7702, north(SPOT, 1));
  const t0 = performance.now();
  const entered = await waitFor(() => V2.json('enter', H.welcome.id)[0]);
  const exited = await waitFor(() => V2.json('exit', H.welcome.id)[0], 3000);
  const afkS = (performance.now() - t0) / 1000;
  const code = await closedWith(H, 4000);
  const idleS = (performance.now() - t0) / 1000;
  check(
    '(18) a HELD pilot is visible, exits after afkMs (1 s) and is closed 4003 after idleCloseMs (3 s)',
    !!entered && !!exited && exited._i > entered._i && code === P.CLOSE.IDLE && idleS >= 2.5,
    `enter, exit after ${afkS.toFixed(1)} s, close ${code} after ${idleS.toFixed(1)} s`
  );
  pumped.delete(V2);
  V2.ws.close();
}

// (19) leave -> exit; re-enter carries the new aircraft
{
  const SPOT = at(-20, 30, 900);
  const L = await pilot(port, 8801, SPOT);
  const V3 = await pilot(port, 8802, north(SPOT, 1));
  const enter0 = await waitFor(() => V3.json('enter', L.welcome.id)[0]);
  pumped.delete(L);
  L.send({ t: 'leave' });
  const exit = await waitFor(() => V3.json('exit', L.welcome.id)[0], 1500);
  L.a = 7;
  pumped.add(L);
  const reenter = await waitFor(() => V3.json('enter', L.welcome.id).find((m) => m._i > (exit?._i ?? Infinity)));
  check(
    '(19) leave -> viewers get exit; the next STATE with a new aircraft re-enters carrying it',
    enter0?.a === 0 && !!exit && reenter?.a === 7 && reenter.cs === L.welcome.cs,
    `enter a=${enter0?.a} #${enter0?._i} -> exit #${exit?._i} -> enter a=${reenter?.a} #${reenter?._i}`
  );
}

// (20) where
{
  const Q = [];
  for (const [i, [lat, lon, alt]] of [
    [10.31, 20.31, 1150],
    [10.33, 20.29, 1234],
    [10.29, 20.33, 1290],
  ].entries())
    Q.push(await pilot(port, 9900 + i, at(lat, lon, alt)));
  await waitFor(() => W.stats().visible >= 7);
  await sleep(150);
  Q[0].send({ t: 'where' });
  const reply = await waitFor(() => Q[0].json('where')[0]);
  const visibleNow = W.stats().visible;
  const cell = Math.floor((10.31 + 90) / 2) * 180 + Math.floor((20.31 + 180) / 2);
  const entry = reply?.c.find((e) => e[0] === cell);
  const total = reply ? reply.c.reduce((n, e) => n + e[3], 0) : -1;
  const w0 = W.stats().where;
  Q[0].send({ t: 'where' });
  await sleep(500);
  const limited = Q[0].json('where').length === 1 && W.stats().where === w0 + 1;
  Q[1].send({ t: 'where' });
  const cached = await waitFor(() => Q[1].json('where')[0]);
  const strip = (m) => JSON.stringify(m?.c);
  check(
    '(20) where: 2° cells [cell, lat, lon, n, medianAlt] with correct counts; 1 per 3 s per socket; cached',
    JSON.stringify(entry) === JSON.stringify([cell, 10.3, 20.3, 3, 1200]) &&
      total === visibleNow &&
      reply.c.every((e) => e.length === 5) &&
      limited &&
      strip(cached) === strip(reply),
    `cluster ${JSON.stringify(entry)}; ${reply?.c.length} cells, n sum ${total} = visible ${visibleNow}; repeat limited ${limited}; second socket served the cache ${strip(cached) === strip(reply)}`
  );
}

// (21) ping -> pong
{
  const c = 12345.5;
  A.send({ t: 'ping', c });
  const pong = await waitFor(() => A.json('pong').find((m) => m.c === c));
  check(
    '(21) ping -> pong {c, s: relay ms, n: online}',
    !!pong && Math.abs(P.tsDiff(pong.s, nowTs())) < 1000 && pong.n === W.stats().online,
    pong ? `s=${pong.s} (now ${nowTs()}), n=${pong.n}` : 'no pong'
  );
}

// (22) close -> bye + 1012
{
  clearInterval(pump);
  const open = [...bots].filter((b) => b.ws.readyState === 1);
  await main.close();
  const codes = await Promise.all(open.map((b) => closedWith(b, 2000)));
  const byes = open.filter((b) => b.json('bye').length === 1).length;
  check(
    '(22) close(): every live socket gets {t:bye} and close 1012',
    open.length >= 5 && byes === open.length && codes.every((c) => c === P.CLOSE.RESTART),
    `${open.length} open sockets, ${byes} byes, codes ${[...new Set(codes)].join('/')}`
  );
}

// ============================ CAP instance ================================
{
  const cap = await startRelay({ port: 0, allowNoOrigin: true, maxPlayers: 3, maxPerIp: 10, log });
  const three = [];
  for (let i = 0; i < 3; i++) three.push(await pilot(cap.port, 100 + i));
  const fourth = bot(cap.port, 103);
  const code = await closedWith(fourth);
  const err = fourth.json('err')[0];
  check(
    '(23) cap 3: the 4th client gets {t:err,code:full} and close 4001',
    three.every((b) => b.welcome) && err?.code === 'full' && code === P.CLOSE.FULL,
    `3 welcomed, 4th ${JSON.stringify(err)} close ${code}`
  );
  await cap.close();
}

// ============================= IP instance ================================
{
  var iprLog = [];
  const ipr = await startRelay({
    port: 0,
    trustProxy: 'loopback',
    maxPerIp: 2,
    maxPlayers: 100,
    connectPerMin: 100,
    log: (l) => (logs.push(l), iprLog.push(l)),
  });
  const up = (xff) => rawUpgrade(ipr.port, '/mp?v=1', { Origin: 'http://localhost:5173', 'X-Forwarded-For': xff });
  const st = async (list) => {
    const out = [];
    for (const x of list) out.push((await up(x)).status);
    return out;
  };
  const v4 = await st(['203.0.113.5', '203.0.113.5', '203.0.113.5', '203.0.113.6', '203.0.113.5, 198.51.100.7']);
  check(
    '(24) XFF behind a loopback proxy: 3rd socket from 203.0.113.5 -> 429; .6 and a spoofed chain (right-most hop wins) accepted',
    JSON.stringify(v4) === JSON.stringify([101, 101, 429, 101, 101]),
    v4.join(' ')
  );
  const v6 = await st(['2001:db8:1:100::1', '2001:db8:1:1ff::2', '2001:db8:1:1aa::3', '2001:db8:1:200::1']);
  const agg = [];
  for (let n = 0; n < 12; n++) for (const h of [1, 2]) agg.push(`2001:db8:2:${n.toString(16)}00::${h}`);
  const agg24 = await st(agg);
  const agg25 = await st(['2001:db8:2:c00::1', '2001:db8:3::1']);
  check(
    '(25) IPv6: one /56 shares a key (3rd -> 429); a /48 caps at 24 across /56s; another /48 is fine',
    JSON.stringify(v6) === JSON.stringify([101, 101, 429, 101]) && agg24.every((s) => s === 101) && JSON.stringify(agg25) === JSON.stringify([429, 101]),
    `/56: ${v6.join(' ')} · /48: ${agg24.filter((s) => s === 101).length}/24 then ${agg25.join(' ')}`
  );
  for (const s of rawSockets) s.destroy();
  rawSockets.clear();
  await ipr.close();

  const rr = await startRelay({ port: 0, trustProxy: 'loopback', maxPerIp: 10, connectPerMin: 3, log });
  const rates = [];
  for (let i = 0; i < 4; i++) {
    const r = await rawUpgrade(rr.port, '/mp?v=1', { Origin: 'http://127.0.0.1:3000', 'X-Forwarded-For': '192.0.2.44' });
    rates.push(r.status);
    r.socket?.destroy();
  }
  check('(26) connect-rate cap: the 4th upgrade inside a minute at connectPerMin 3 -> 429', JSON.stringify(rates) === '[101,101,101,429]', rates.join(' '));
  await rr.close();
}

// (27) unit cases
{
  const k = (a) => ipKeys(a);
  const trustL = makeTrust('loopback');
  const trust10 = makeTrust('10.0.0.0/8, 2001:db8::/32');
  const cases = [
    ['::ffff:1.2.3.4 -> 1.2.3.4', k('::ffff:1.2.3.4').key === '1.2.3.4' && k('::ffff:1.2.3.4').agg === null],
    ['::1 is loopback', k('::1').loopback === true],
    ['::ffff:127.0.0.1 is loopback, keyed 127.0.0.1', k('::ffff:127.0.0.1').loopback && k('::ffff:127.0.0.1').key === '127.0.0.1'],
    ['127.9.9.9 is loopback', k('127.9.9.9').loopback === true],
    ['8.8.8.8 is not', k('8.8.8.8').loopback === false],
    ['link-local keyed per /56', k('fe80::1%lo0').key === 'fe80:0:0:0::/56' && !k('fe80::1').loopback],
    ['same /56 shares a key', k('2001:db8:1:1ff::2').key === k('2001:db8:1:100::1').key],
    ['next /56 differs', k('2001:db8:1:200::1').key !== k('2001:db8:1:100::1').key],
    ['/48 aggregate', k('2001:db8:1:200::1').agg === '2001:db8:1::/48'],
    ['bracketed v6', k('[2001:db8::1]').key === k('2001:db8::1').key],
    ['garbage', k('not-an-ip').key === 'unknown' && k(undefined).key === 'unknown'],
    ['untrusted peer: header ignored', clientIp('203.0.113.9', { 'x-forwarded-for': '1.1.1.1' }, trustL) === '203.0.113.9'],
    ['loopback peer: right-most untrusted', clientIp('127.0.0.1', { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, trustL) === '2.2.2.2'],
    ['CIDR list: skip trusted hops', clientIp('10.1.2.3', { 'x-forwarded-for': '9.9.9.9, 10.0.0.7' }, trust10) === '9.9.9.9'],
    ['all: right-most entry', clientIp('5.5.5.5', { 'x-forwarded-for': '1.1.1.1, 7.7.7.7' }, makeTrust('all'), 'x-forwarded-for', true) === '7.7.7.7'],
    ['fly-client-ip from a trusted peer', clientIp('::1', { 'fly-client-ip': '4.4.4.4' }, trustL, 'fly-client-ip') === '4.4.4.4'],
    ['v6 CIDR', trust10('2001:db8:ffff::1') && !trust10('2001:db9::1') && !trust10('11.0.0.1')],
  ];
  const bad = cases.filter(([, ok]) => !ok).map(([n]) => n);
  check('(27) ipKeys / makeTrust / clientIp unit cases', bad.length === 0, bad.length ? bad.join('; ') : `${cases.length} cases`);
}

// (28) sharedKeyWarn counts attempts
{
  const mine = [];
  const sk = await startRelay({ port: 0, trustProxy: 'loopback', connectPerMin: 100, log: (l) => (logs.push(l), mine.push(l)) });
  const st = [];
  for (let i = 0; i < 12; i++) {
    const r = await rawUpgrade(sk.port, '/mp?v=1', { Origin: 'http://localhost:3000', 'X-Forwarded-For': '198.51.100.20' });
    st.push(r.status);
  }
  for (const s of rawSockets) s.destroy();
  rawSockets.clear();
  await sk.close();
  const warn = (lines) => lines.filter((l) => l.startsWith('mp online=')).map((l) => Number(/sharedKeyWarn=(\d)/.exec(l)?.[1]));
  check(
    '(28) sharedKeyWarn: one key making 12 upgrade attempts (6 live at the default maxPerIp, 6 refused) warns; mixed keys do not',
    st.filter((x) => x === 101).length === 6 && st.filter((x) => x === 429).length === 6 && warn(mine).at(-1) === 1 && warn(iprLog).at(-1) === 0,
    `statuses ${st.filter((x) => x === 101).length}×101 ${st.filter((x) => x === 429).length}×429; warn ${warn(mine).join('/')}; IP instance ${warn(iprLog).join('/')}`
  );
}

// (29) before any request: per-peer TCP cap and the headers timeout
{
  const mine = [];
  // 127.0.0.1 is NOT trusted here, so the loopback peer is an ordinary client.
  const sl = await startRelay({
    port: 0,
    trustProxy: '10.0.0.0/8',
    maxPerIp: 2,
    headersTimeoutMs: 1000,
    connCheckMs: 250,
    log: (l) => (logs.push(l), mine.push(l)),
  });
  const t0 = performance.now();
  const socks = [];
  for (let i = 0; i < 6; i++) {
    const s = { data: '', closedAt: null };
    s.sock = net.connect(sl.port, '127.0.0.1');
    s.sock.on('error', () => {});
    s.sock.on('data', (d) => (s.data += d));
    s.sock.on('close', () => (s.closedAt = performance.now() - t0));
    if (i % 2) s.sock.on('connect', () => s.sock.write('GET /mp?v=1 HTTP/1.1\r\nHost: x\r\n')); // half-sent headers
    socks.push(s);
  }
  await waitFor(() => socks.every((s) => s.closedAt != null), 5000);
  const refused = socks.filter((s) => s.closedAt != null && s.closedAt < 500 && s.data === '').length;
  const timed = socks.filter((s) => s.data.startsWith('HTTP/1.1 408') && s.closedAt >= 900 && s.closedAt < 2500);
  const h = await healthz(sl.port).catch(() => ({ status: 0 }));
  for (const x of socks) x.sock.destroy();
  await sl.close();
  check(
    '(29) an untrusted peer holds at most 2 × maxPerIp TCP connections; idle and half-sent headers get 408 within ~headersTimeout',
    refused === 2 && timed.length === 4 && h.status === 200 && mine.some((l) => /,conn=2\}/.test(l)),
    `refused ${refused} at once; 408 for ${timed.length} at ${timed.map((s) => (s.closedAt / 1000).toFixed(1)).join('/')} s (timeout 1 s, check 0.25 s); healthz after ${h.status}`
  );
}

// (30) config refusals, warnings, and a failed listen
{
  const mine = [];
  const tryStart = async (o) => {
    try {
      const r = await startRelay({ port: 0, log: (l) => (logs.push(l), mine.push(l)), ...o });
      await r.close();
      return 'started';
    } catch (e) {
      return e.message;
    }
  };
  const refusals = [
    [{ tickHz: 0 }, /MP_TICK_HZ/],
    [{ env: { MP_TICK_HZ: '-5' } }, /MP_TICK_HZ/],
    [{ env: { MP_TICK_HZ: '7.5' } }, /MP_TICK_HZ/],
    [{ env: { MP_MAX_PLAYERS: '-1' } }, /MP_MAX_PLAYERS/],
    [{ env: { MP_MAX_PER_IP: '0' } }, /MP_MAX_PER_IP/],
    [{ env: { MP_CONNECT_PER_MIN: 'x' } }, /MP_CONNECT_PER_MIN/],
    [{ env: { MP_PORT: 'abc' }, port: undefined }, /MP_PORT/],
    [{ env: { MP_RADIUS_KM: '0' } }, /MP_RADIUS_KM/],
    [{ env: { MP_ORIGINS: 'shadowads.netlify.app' } }, /MP_ORIGINS/],
    [{ env: { MP_ORIGINS: ' , ' } }, /MP_ORIGINS/],
    [{ env: { MP_TRUST_PROXY: '10.0.0.0/33' } }, /MP_TRUST_PROXY/],
    [{ env: { MP_TRUST_PROXY: '10.0.0.0/8;192.168.0.0/16' } }, /MP_TRUST_PROXY/],
  ];
  const wrong = [];
  for (const [o, re] of refusals) {
    const r = await tryStart(o);
    if (!re.test(r)) wrong.push(`${JSON.stringify(o)} -> ${r}`);
  }
  const partial = await tryStart({ env: { MP_ORIGINS: 'https://ok.example, shadowads.netlify.app', MP_TRUST_PROXY: '10.0.0.0/8, 10.0.0.0/33' } });
  const warned =
    mine.some((l) => l === 'mp warn MP_ORIGINS entries #2 ignored: not scheme://host[:port]') &&
    mine.some((l) => l === 'mp warn MP_TRUST_PROXY entries #2 ignored: not a CIDR');
  const blocker = http.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
  const t0 = timers();
  const busy = await tryStart({ port: blocker.address().port });
  const t1 = timers();
  blocker.close();
  check(
    '(30) config: bad numbers and lists with no valid entry refuse to start; a bad entry is a positional warning; a failed listen leaves no timer',
    wrong.length === 0 && partial === 'started' && warned && /EADDRINUSE/.test(busy) && t1 <= t0,
    wrong.length
      ? wrong.join('; ')
      : `${refusals.length} refusals; partial lists ${partial}, warned ${warned}; busy port -> ${busy.split(' ')[0]}, timers ${t0} -> ${t1}`
  );
}

// (31) a symlinked main (a releases/N -> current layout) auto-starts; SIGTERM stops it
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-relay-link-'));
  const link = path.join(dir, 'relay.mjs');
  fs.symlinkSync(fileURLToPath(new URL('../server/mp-relay.mjs', import.meta.url)), link);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('MP_')));
  const child = spawn(process.execPath, [link], { env: { ...env, MP_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  const started = !!(await waitFor(() => out.includes('mp relay start'), 5000));
  const port = Number(/port=(\d+)/.exec(out)?.[1]);
  const h = started ? await healthz(port).catch(() => null) : null;
  child.kill('SIGTERM');
  const code = await Promise.race([exited, sleep(4000).then(() => 'timeout')]);
  if (code === 'timeout') child.kill('SIGKILL');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const line of out.split('\n')) if (line) logs.push(line);
  check(
    '(31) launched through a symlink, the relay starts (healthz 200); SIGTERM -> stop line, exit 0',
    started && h?.status === 200 && code === 0 && out.includes('mp relay stop'),
    `started ${started}, healthz ${h?.status}, exit ${code}, stop line ${out.includes('mp relay stop')}`
  );
}

// (32) the log
{
  const banned = ['127.0.0.1', '::1', '203.0.113', '198.51.100', '192.0.2.', '2001:db8', 'fe80'];
  const hits = [];
  for (const line of logs) {
    for (const b of banned) if (line.includes(b)) hits.push(`${b} in "${line}"`);
    for (const cs of callsignsSeen) if (line.includes(cs)) hits.push(`callsign ${cs}`);
    if (/\bp:[0-9a-z]+/.test(line)) hits.push(`pilot id in "${line}"`);
  }
  const periodic = logs.filter((l) => l.startsWith('mp online=')).length;
  check(
    '(32) the log holds no IPs, IP keys, callsigns or pilot ids (start/stop + aggregate lines only)',
    hits.length === 0 && periodic >= 3 && logs.some((l) => l.startsWith('mp relay start')) && logs.some((l) => l.startsWith('mp relay stop')),
    hits.length ? hits.slice(0, 3).join('; ') : `${logs.length} lines (${periodic} aggregate), ${callsignsSeen.size} callsigns checked`
  );
}

// =========================== WORLD, direct ================================
// The brute force carries its OWN copy of the relay's metric (equirectangular,
// dLon wrapped), so a world whose metric breaks cannot agree with itself.
// Two passes: the shipped hysteresis (the grid is queried at exitKm 175) and a
// TIGHT one (exitKm = radiusKm), where the grid bound has no slack to hide in.
const D2R = Math.PI / 180;
function refKm(lat1, lon1, lat2, lon2) {
  const dLon = ((((lon2 - lon1 + 180) % 360) + 360) % 360) - 180;
  const x = dLon * Math.cos(((lat1 + lat2) / 2) * D2R);
  const y = lat2 - lat1;
  return Math.sqrt(x * x + y * y) * ((6371.0088 * Math.PI) / 180);
}
function worldVsBruteForce(cfg) {
  let t = 1e6;
  const world = createWorld(cfg, { now: () => t });
  const N = 2000;
  const ps = [];
  const inbox = [];
  let s = 0x2468ace;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const span = (c, r) => c + (rnd() * 2 - 1) * r;
  for (let i = 0; i < N; i++) {
    let lat;
    let lon;
    if (i < 700) [lat, lon] = [span(10, 1.5), P.wrap180(span(179.5, 1.6))]; // straddles the antimeridian
    else if (i < 1200) [lat, lon] = [span(82.5, 2), span(0, 180)]; // above 80°N: whole-row queries
    else if (i < 1600) [lat, lon] = [span(45, 1), span(7, 1.2)];
    else [lat, lon] = [span(0, 80), span(0, 180)];
    const box = [];
    inbox.push(box);
    const p = world.connect((d) => typeof d === 'string' && box.push(JSON.parse(d)), () => {});
    world.onText(p, JSON.stringify({ t: 'hello', v: 1, seed: i * 7919 }));
    const u8 = new Uint8Array(P.encodeState({ ...at(lat, lon, 1000 + i), a: i % 10, flags: 0, warpSeq: 0, ts: Math.floor(t) }));
    world.onBinary(p, u8);
    ps.push({ id: box[0]?.id, cs: box[0]?.cs, ...P.decodeState(u8) });
  }
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) world.tick(); // the 5th tick recomputes interest
  const ms = performance.now() - t0;
  let mismatch = 0;
  let saturated = 0;
  let firstBad = '';
  for (let i = 0; i < N; i++) {
    const v = ps[i];
    const cand = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const d = refKm(v.lat, v.lon, ps[j].lat, ps[j].lon);
      if (d <= 150) cand.push([d, ps[j].id]);
    }
    if (cand.length > 48) saturated++;
    cand.sort((a, b) => a[0] - b[0]);
    const want = new Set(cand.slice(0, 48).map((c) => c[1]));
    const got = new Set(inbox[i].filter((m) => m.t === 'enter').map((m) => m.id));
    if (want.size !== got.size || [...want].some((id) => !got.has(id))) {
      mismatch++;
      firstBad ||= `#${i} at ${v.lat.toFixed(2)},${v.lon.toFixed(2)}: want ${want.size} got ${got.size}`;
    }
  }
  const before = inbox.map((b) => b.length);
  for (let i = 0; i < 5; i++) world.tick();
  const churn = inbox.reduce((n, b, i) => n + b.slice(before[i]).filter((m) => m.t === 'enter' || m.t === 'exit').length, 0);
  return { mismatch, saturated, firstBad, churn, ms, cs: new Set(ps.map((x) => x.cs)), N };
}
{
  const a = worldVsBruteForce({});
  const b = worldVsBruteForce({ exitKm: 150 });
  check(
    '(33) grid + quickselect == brute force nearest-48 within 150 km for 2,000 pilots (antimeridian, 82°N); callsigns unique; stable on repeat',
    a.mismatch === 0 &&
      b.mismatch === 0 &&
      a.saturated > 500 &&
      a.cs.size === a.N &&
      [...a.cs].every((c) => CS_RE.test(c)) &&
      a.churn === 0 &&
      b.churn === 0,
    `${a.mismatch} / ${b.mismatch} mismatches (shipped / tight)${a.firstBad || b.firstBad ? ` (${a.firstBad || b.firstBad})` : ''}; ` +
      `${a.saturated} viewers had > 48 candidates; ${a.cs.size} unique callsigns; ${a.churn + b.churn} enter/exit on the repeat pass; ` +
      `first interest pass ${a.ms.toFixed(0)} ms for 2,000`
  );
}

// A small world on a fake clock: pilots post STATE stamped with the world's time.
function miniWorld(cfg = {}) {
  let t = 1e6;
  const world = createWorld(cfg, { now: () => t });
  const join = (seed, pose) => {
    const box = [];
    const p = world.connect((d) => (box.push(typeof d === 'string' ? JSON.parse(d) : { t: 'batch' }), true), () => {});
    world.onText(p, JSON.stringify({ t: 'hello', v: 1, seed }));
    const pl = { p, box, id: box[0]?.id, pose, a: 0 };
    pl.send = (over = {}) =>
      world.onBinary(p, new Uint8Array(P.encodeState({ ...pl.pose, a: pl.a, flags: 0, warpSeq: 0, ts: Math.floor(t) >>> 0, ...over })));
    pl.got = (type, id, from = 0) => box.slice(from).filter((m) => m.t === type && (id === undefined || m.id === id));
    if (pose) pl.send();
    return pl;
  };
  const ticks = (n) => {
    for (let i = 0; i < n; i++) world.tick();
  };
  return { world, join, ticks, advance: (ms) => (t += ms), now: () => t };
}

// (34) a TCP stall: the movement rule paces by the sender's ts
{
  const rows = [];
  for (const stallS of [2.5, 5.1, 8.1]) {
    const m = miniWorld();
    const base = { ...at(40, 10, 3000), speed: 750 };
    const step = (k) => ({ ...base, lon: base.lon + (k * 0.75) / (KM_PER_DEG * Math.cos(40 * D2R)) });
    const U = m.join(1, null);
    const T0 = Math.floor(m.now());
    U.send({ ...step(0), ts: T0 });
    m.advance(stallS * 1000 + 100); // the queued 1 Hz samples all arrive now
    const n = Math.floor(stallS);
    const s0 = m.world.stats();
    for (let k = 1; k <= n; k++) U.send({ ...step(k), ts: (T0 + 1000 * k) >>> 0 });
    const s1 = m.world.stats();
    rows.push({ stallS, n, ok: s1.accepted - s0.accepted, tp: s1.teleport - s0.teleport });
  }
  // A forged ts buys the window once: the oldest the relay takes, then the newest.
  const m = miniWorld();
  const F0 = at(-10, 50, 2000);
  const X = m.join(2, null);
  const r = Math.floor(m.now());
  X.send({ ...F0, ts: (r - 60000) >>> 0 }); // taken as recv - silenceMs (15 s)
  const a0 = m.world.stats();
  X.send({ ...north(F0, 25), ts: (r + 60000) >>> 0 }); // taken as recv + 500: 15.5 s -> 19.1 km, 25 km refused
  X.send({ ...north(F0, 15), ts: (r + 60000) >>> 0 }); // 15 km inside it: accepted
  X.send({ ...north(F0, 30), ts: (r + 60000) >>> 0 }); // spent: Δts 0 -> 620 m
  const a1 = m.world.stats();
  const forged = a1.accepted - a0.accepted === 1 && a1.teleport - a0.teleport === 2;
  check(
    '(34) TCP stall: 1 Hz samples at 750 m/s queued 2.5 / 5.1 / 8.1 s and delivered together are all accepted; a forged ts buys the window once',
    rows.every((x) => x.ok === x.n && x.tp === 0) && forged,
    `${rows.map((x) => `${x.stallS} s ${x.ok}/${x.n}`).join(', ')}; forged ts: 25 km refused, 15 km taken, then 15 km more refused: ${forged}`
  );
}

// (35) leave purges what was queued for the leaver
{
  const m = miniWorld();
  const SP = at(5, 5, 1000);
  const V = m.join(10, SP);
  const Wc = m.join(13, north(SP, 1)); // control: never leaves
  const S = m.join(11, north(SP, 2));
  const S2 = m.join(12, north(SP, -2));
  m.ticks(5);
  const entered = [S, S2].every((x) => V.got('enter', x.id).length === 1 && Wc.got('enter', x.id).length === 1);
  const fromV = V.box.length;
  const fromW = Wc.box.length;
  m.world.disconnect(S.p); // queues exit S for V and Wc
  m.world.onText(S2.p, '{"t":"leave"}'); // queues exit S2 for V and Wc
  m.world.onText(V.p, '{"t":"leave"}'); // V's client drops every remote itself
  m.ticks(5);
  const stale = V.got('exit', undefined, fromV).length;
  const control = Wc.got('exit', S.id, fromW).length === 1 && Wc.got('exit', S2.id, fromW).length === 1;
  check(
    '(35) leave purges the leaver\'s queue: no exit for an id its client already dropped; a control viewer gets both',
    entered && stale === 0 && control,
    `entered ${entered}; exits to the leaver ${stale}; control got both ${control}`
  );
}

// (36) an aircraft flip mid-flight: no enter spam; a new viewer gets the latest
{
  const m = miniWorld();
  const SP = at(-30, -60, 1500);
  const V = m.join(20, SP);
  const S = m.join(21, north(SP, 1));
  m.ticks(5);
  const from = V.box.length;
  for (let i = 1; i <= 40; i++) {
    m.advance(50);
    S.a = i % 10;
    S.send();
    V.send();
    if (i % 2 === 0) m.ticks(1);
  }
  const spam = V.got('enter', S.id, from).length;
  const records = V.box.slice(from).filter((x) => x.t === 'batch').length;
  const N = m.join(22, north(SP, -1));
  m.ticks(5);
  const nEnter = N.got('enter', S.id)[0];
  check(
    '(36) 40 aircraft flips in 2 s send the current viewer no enter (records keep flowing); a new viewer\'s enter carries the latest',
    spam === 0 && records >= 15 && nEnter?.a === S.a && S.a === 0,
    `${spam} enters to the current viewer, ${records} batches; new viewer enter a=${nEnter?.a} (latest ${S.a})`
  );
}

for (const b of bots) if (b.ws.readyState <= 1) b.ws.close();
for (const s of rawSockets) s.destroy();
clearTimeout(watchdog);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
