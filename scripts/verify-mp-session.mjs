/**
 * MULTIPLAYER — verify-mp-session: the client session END TO END
 * (lib/fly/mp/session.js against the real relay; MULTIPLAYER.md). Node only,
 * loopback only, no browser:
 *
 *   node scripts/verify-mp-session.mjs
 *
 * An in-process relay (server/mp-relay.mjs, port 0, 20 Hz tick) and two
 * pilots, A and B. Each pilot is its own "page": a worker thread with its own
 * module graph — so its own page seed, mp-store and fly-store, exactly as two
 * browser tabs have — holding a stub runtime with a REAL TrafficEngine, a
 * FlightModel-shaped flight flying a known straight line (absolute mercator),
 * and minimal window / document / location shims installed BEFORE any app
 * module evaluates. Each worker drives its session the way TrafficLayer
 * does: traffic.update(performance.now()/1000, flight.pos) every frame.
 *
 * Asserted, in order:
 *   (1) both reach status online with distinct callsigns; nothing is
 *       uplinked during the disclosure hold; (1b) a third pilot, C, whose
 *       first welcome lands in a HIDDEN tab (far away, on its own) stamps no
 *       disclosure and sends nothing until the tab is visible, then holds
 *       the full disclosureHoldMs from that moment;
 *   (2) A appears in B's traffic.items[0] as 'p:*' with meta.flight = A's
 *       callsign, remote, within 50 m of A's truth (and B in A's); size stays
 *       0 (no ADS-B); remoteCount 1; nearby reaches the store;
 *   (3) A's signal(1) reaches B as ONE fly-mp-signal event (callsign, wave,
 *       ~1 km, 9 o'clock) + a 👋 bubble + a visible wing-rock; never to A;
 *       the cooldown refuses a second signal;
 *   (4) smoke: A.toggleSmoke() → B sees F.SMOKE; keys 4–7 (repeat and INPUT
 *       targets ignored; 6 → 👍 with no second toast inside toastPerSenderSec;
 *       7 → smoke off; NumLock off — the keypad steering as arrows / Home —
 *       sends nothing);
 *   (5) the mutual-follow race never leaves two autopilots chasing, and the
 *       pilot who engages on an ASSISTED leader yields with the banner; a
 *       leader who takes up someone else LATER releases its follower with
 *       the "following someone" message instead;
 *   (6) a hidden tab sends HELD (B sees stale 2, opacity 0.5), visible again
 *       clears it;
 *   (7) A going exclusive purges A's remotes and source at once, B gets the
 *       exit within 2 s, the socket lingers AND keeps pinging; back 14 s into
 *       the 15 s linger (past silenceSec since the last pre-leave pong) →
 *       re-enter both ways on the SAME socket;
 *   (8) the toggle off closes the socket now and B loses A; on again → the
 *       same callsign (one seed per page), disclosedAt unchanged, B sees A;
 *   (9) where() → a cluster with A counted and B subtracting itself; rate
 *       limited; B held past the relay's AFK window (the relay runs it at
 *       2 s, pinned to match) is no longer counted, so B stops subtracting and
 *       A stays listed; flying again, B subtracts itself again;
 *  (10) release(): runtime.mp deleted, source and remotes gone, listeners
 *       removed, sockets closed, the relay sees 0 connections, and each
 *       worker EXITS ON ITS OWN (no timer, socket or listener left).
 * A hard 60 s guard fails the gate if anything hangs.
 */
import { register } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
register('./_node-resolve.mjs', import.meta.url);

const LAT_A = 41.0;
const LAT_B = 40.991; // 1.0 km south of A: the relay's near tier, the same 2° where-cell
const LON0 = -83.0;
const LAT_C = -33.9; // C flies alone, half a world away (no enters, its own where-cell)
const LON_C = 151.2;
const LAT_D = 51.5; // D: a first welcome under a held HUD, alone over London
const LON_D = -0.12;
// The relay's AFK and where-cache windows, shortened, and pinned to match on
// every pilot (session.js mirrors the relay's windows to correct the where-summary).
const RELAY_AFK_MS = 2000;
const PIN = { relay: { afkMs: RELAY_AFK_MS, whereCacheMs: 0 } };
const ALT = 1500;
const SPEED = 150;
const HEADING = Math.PI / 2; // both fly east

if (isMainThread) await main();
else await pilot();

// ===========================================================================
// main: the relay, the two pilots and the assertions
// ===========================================================================
async function main() {
  const guard = setTimeout(() => {
    console.log('FAIL  hard timeout: the gate did not finish and exit within 60 s');
    process.exit(2);
  }, 60000);
  guard.unref();
  const started = performance.now();

  const { startRelay } = await import('../server/mp-relay.mjs');
  const { mercatorWorldXZ } = await import('../lib/fly/traffic-engine.js');
  const { mercatorScale } = await import('../lib/fly/coords.js');
  const { MULTIPLAYER } = await import('../lib/fly/fly-constants.js');
  const { F } = await import('../lib/fly/mp/protocol.mjs');
  const { FOLLOW_RACE_MESSAGE } = await import('../lib/fly/mp/session.js');
  const { ESCORT_MESSAGES } = await import('../lib/fly/escort.js');
  // session.js's race window: a far-tier sample plus a far-tier forward, + 0.5 s.
  const RACE_MS = 2000 / MULTIPLAYER.farSendHz + 500;
  const HOLD = MULTIPLAYER.disclosureHoldMs;

  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms) {
    const end = performance.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (performance.now() > end) return null;
      await sleep(20);
    }
  }

  const relay = await startRelay({ port: 0, allowNoOrigin: true, tickHz: 20, log: () => {}, afkMs: RELAY_AFK_MS, whereRebuildMs: 0 });
  const url = `ws://127.0.0.1:${relay.port}/mp`;
  const T0 = performance.timeOrigin + performance.now(); // both trajectories start here (absolute ms)

  class Pilot {
    constructor(name, lat, aircraftId, { lon = LON0, hidden = false, held = false, photo = false } = {}) {
      this.name = name;
      this.lat = lat;
      this.snap = null;
      this.events = [];
      this.pending = new Map();
      this.seq = 0;
      this.exitCode = null;
      const W = mercatorWorldXZ(lon, lat);
      this.k = mercatorScale(lat);
      this.W = W;
      this.w = new Worker(new URL(import.meta.url), { workerData: { name, url, T0, lat, lon, aircraftId, hidden, held, photo, pin: PIN } });
      this.w.on('message', (m) => {
        if (m.snap) this.snap = m.snap;
        if (m.event) this.events.push(m.event);
        if (m.re !== undefined) {
          this.pending.get(m.re)?.(m.value);
          this.pending.delete(m.re);
        }
      });
      this.w.on('error', (e) => check(`pilot ${name} worker ran without throwing`, false, String(e?.stack ?? e)));
      this.exited = new Promise((r) =>
        this.w.on('exit', (c) => {
          this.exitCode = c;
          r(c);
        })
      );
    }
    call(cmd, arg) {
      const id = ++this.seq;
      return new Promise((res) => {
        this.pending.set(id, res);
        this.w.postMessage({ id, cmd, arg });
      });
    }
    /** This pilot's true absolute-mercator position at absolute time `abs` (ms). */
    truth(abs) {
      const t = (abs - T0) / 1000;
      return { x: this.W.x + SPEED * Math.sin(HEADING) * t * this.k, y: ALT, z: this.W.z - SPEED * Math.cos(HEADING) * t * this.k };
    }
    /** The remote track for another pilot's callsign in this pilot's latest snapshot. */
    sees(cs) {
      return this.snap?.items.find((it) => it.remote && it.flight === cs) ?? null;
    }
  }

  const A = new Pilot('A', LAT_A, 'glider');
  const B = new Pilot('B', LAT_B, 'fighter');
  const C = new Pilot('C', LAT_C, 'fighter', { lon: LON_C, hidden: true });
  const distTrue = (p, q, k) => Math.hypot((p.x - q.x) / k, p.y - q.y, (p.z - q.z) / k);

  // (1b) C's whole leg runs alongside A and B; its rows print before (9).
  const hiddenLeg = (async () => {
    const rows = [];
    const welcomed = await until(() => C.snap?.status === 'online', 10000);
    const tW = performance.now();
    await sleep(HOLD + 1000);
    const s = C.snap;
    rows.push([
      '(1b) a first welcome in a HIDDEN tab: no disclosure stamped, no STATE sent, however long it stays hidden',
      !!welcomed && s?.disclosedAt === 0 && s?.states === 0,
      `disclosedAt ${s?.disclosedAt} · ${s?.states} STATEs after ${Math.round(performance.now() - tW)} ms hidden and welcomed`,
    ]);
    const vis = await C.call('hidden', false);
    const first = await until(() => (C.snap?.states > 0 ? C.snap : null), HOLD + 3000);
    const lag = first ? first.firstState - vis.abs : NaN;
    rows.push([
      `(1b) visible: the disclosure is stamped then, and the first STATE waits the full ${HOLD} ms hold from that moment`,
      vis.disclosedAgo !== null && vis.disclosedAgo < 50 && lag >= HOLD - 20,
      `disclosed ${vis.disclosedAgo?.toFixed(1)} ms into the visible tab · first STATE ${Math.round(lag)} ms after it`,
    ]);
    await C.call('release');
    return rows;
  })();

  // (1c) D's first welcome lands while the flying HUD cannot show the
  // disclosure — under a held frame (the boot hold, a menu, the Atlas), then
  // in photo mode: nothing is stamped or sent until the HUD is up.
  const D = new Pilot('D', LAT_D, 'prop', { lon: LON_D, held: true, photo: true });
  const heldLeg = (async () => {
    const rows = [];
    const welcomed = await until(() => D.snap?.status === 'online', 10000);
    await sleep(HOLD + 500);
    const s1 = D.snap;
    await D.call('runtime', { held: false });
    await sleep(1000);
    const s2 = D.snap;
    rows.push([
      '(1c) a first welcome under a held frame (boot hold / menu / Atlas), then in photo mode: no disclosure stamped, no STATE sent',
      !!welcomed && s1?.disclosedAt === 0 && s1?.states === 0 && s2?.disclosedAt === 0 && s2?.states === 0,
      `held: disclosedAt ${s1?.disclosedAt} · ${s1?.states} STATEs · photo: disclosedAt ${s2?.disclosedAt} · ${s2?.states} STATEs`,
    ]);
    const up = await D.call('runtime', { photo: false });
    const first = await until(() => (D.snap?.states > 0 ? D.snap : null), HOLD + 3000);
    const stampLag = first ? first.disclosedAbs - up.abs : NaN;
    const lag = first ? first.firstState - first.disclosedAbs : NaN;
    rows.push([
      `(1c) the HUD up: stamped within one control tick, and the first STATE waits the full ${HOLD} ms hold from the stamp`,
      stampLag >= -5 && stampLag <= 300 && lag >= HOLD - 20,
      `stamped ${Math.round(stampLag)} ms after the HUD came up · first STATE ${Math.round(lag)} ms after the stamp`,
    ]);
    await D.call('release');
    return rows;
  })();

  try {
    // ---- (1) online, distinct callsigns, the disclosure hold --------------
    const online = await until(() => A.snap?.status === 'online' && B.snap?.status === 'online', 10000);
    const tOnline = performance.now();
    check('(1) both sessions reach status online', !!online, `A ${A.snap?.status} · B ${B.snap?.status}`);
    const csA = A.snap?.callsign;
    const csB = B.snap?.callsign;
    check(
      '(1) distinct relay callsigns and palette colours in each page\'s mp-store',
      typeof csA === 'string' && typeof csB === 'string' && csA !== csB && /^#[0-9a-f]{6}$/i.test(A.snap.color) && /^#[0-9a-f]{6}$/i.test(B.snap.color),
      `${csA} / ${csB}`
    );
    check('(1) disclosedAt stamped on the first welcome; runtime.mp published', A.snap?.disclosedAt > 0 && B.snap?.disclosedAt > 0 && A.snap.mp && B.snap.mp);
    check('(1) nothing is uplinked during the disclosure hold', relay.world.stats().accepted === 0, `relay accepted ${relay.world.stats().accepted} STATEs`);

    // ---- (2) each sees the other, in place --------------------------------
    const seen = await until(() => B.sees(csA) && A.sees(csB), 10000);
    const holdMs = performance.now() - tOnline;
    check(
      `(2) A appears on B (and B on A) only after the ${MULTIPLAYER.disclosureHoldMs} ms disclosure hold`,
      !!seen && holdMs >= MULTIPLAYER.disclosureHoldMs - 300,
      `${Math.round(holdMs)} ms after both were online`
    );
    const it0 = B.snap?.items[0];
    check(
      "(2) A is B's traffic.items[0]: 'p:*', meta.flight = A's callsign, remote, A's aircraft",
      !!it0 && /^p:[0-9a-z]+$/.test(it0.hex) && it0.flight === csA && it0.remote === true && it0.aircraftId === 'glider',
      it0 ? `${it0.hex} ${it0.flight} ${it0.aircraftId}` : 'none'
    );
    check('(2) size stays 0 (no ADS-B), remoteCount 1, the remote source installed', B.snap?.size === 0 && B.snap?.remoteCount === 1 && A.snap?.size === 0 && A.snap?.remoteCount === 1 && B.snap?.source === true);
    let worstB = 0;
    let worstA = 0;
    let samples = 0;
    const tPos = performance.now();
    while (performance.now() - tPos < 1500) {
      const sb = B.snap;
      const sa = A.snap;
      const a = sb && B.sees(csA);
      const b = sa && A.sees(csB);
      if (a) worstB = Math.max(worstB, distTrue(a, A.truth(sb.abs), A.k));
      if (b) worstA = Math.max(worstA, distTrue(b, B.truth(sa.abs), B.k));
      samples++;
      await sleep(30);
    }
    check('(2) on B, A is within 50 m of its truth (and B within 50 m on A)', samples > 20 && worstB < 50 && worstA < 50, `worst ${worstB.toFixed(2)} m / ${worstA.toFixed(2)} m over ${samples} snapshots`);
    const fresh = B.sees(csA);
    check('(2) fresh, faded in, with the flight\'s velocity', fresh?.stale === 0 && fresh?.opacity === 1 && Math.abs(fresh.vE - SPEED) < 1 && Math.abs(fresh.vN) < 1, fresh ? `stale ${fresh.stale} opacity ${fresh.opacity} vE ${fresh.vE?.toFixed(2)}` : '');
    const nearby = await until(() => B.snap?.nearby === 1 && A.snap?.nearby === 1, 2500);
    const both = await until(() => A.snap?.online >= 2 && B.snap?.online >= 2, 7000);
    check('(2) nearby (≤ 60 km) and the online count reach mp-store', !!nearby && !!both, `nearby ${B.snap?.nearby} · online ${A.snap?.online}/${B.snap?.online}`);

    // ---- (3) a wave ------------------------------------------------------------
    const sent = await A.call('signal', 1);
    const again = await A.call('signal', 3);
    check('(3) signal(1) is accepted; a second inside cooldownMs is refused', sent === true && again === false);
    const ev = await until(() => B.events.find((e) => e.code === 'wave'), 3000);
    check(
      "(3) B gets a fly-mp-signal: A's id and callsign, 'wave', a palette colour, ~1 km, 9 o'clock",
      !!ev && ev.id === B.sees(csA)?.hex && ev.callsign === csA && /^#[0-9a-f]{6}$/i.test(ev.color) && Math.abs(ev.distM - 1000) < 60 && ev.clock === 9 && ev.at > 0,
      ev ? `${ev.callsign} ${ev.code} ${Math.round(ev.distM)} m ${ev.clock} o'clock` : 'no event'
    );
    let maxBank = 0;
    let bubble = null;
    const tWave = performance.now();
    while (performance.now() - tWave < 2000) {
      const a = B.sees(csA);
      if (a) {
        maxBank = Math.max(maxBank, Math.abs(a.bank));
        bubble ??= a.bubble;
      }
      await sleep(20);
    }
    check('(3) ...a 👋 bubble over A and a visible wing-rock (A itself flies wings level)', bubble === '👋' && maxBank > 15 * (Math.PI / 180), `bubble ${bubble} · |bank| up to ${(maxBank * 57.2958).toFixed(1)}°`);
    check('(3) exactly one toast for the held emote; A never hears its own wave', B.events.filter((e) => e.code === 'wave').length === 1 && A.events.length === 0, `B ${B.events.length} · A ${A.events.length}`);

    // ---- (4) smoke and the keys ---------------------------------------------
    const smokeOn = await A.call('smoke');
    const smokeSeen = await until(() => (B.sees(csA)?.mpFlags & F.SMOKE) !== 0 && A.snap?.smoke === true && A.snap?.mpSmoke === true, 2000);
    check('(4) toggleSmoke() → true; runtime.mp.smoke and mp-store.smoke follow; B sees F.SMOKE', smokeOn === true && !!smokeSeen);
    await until(() => A.snap && performance.now() > tWave + 200, 500);
    const cd0 = A.snap.cooldownUntil;
    await A.call('key', { code: 'Digit5', repeat: true });
    await A.call('key', { code: 'Digit5', tag: 'INPUT' });
    await A.call('key', { code: 'Digit5', ctrlKey: true });
    await sleep(100);
    check('(4) keys: a repeat, an INPUT target and a Ctrl chord send nothing', A.snap.cooldownUntil === cd0);
    await sleep(Math.max(0, MULTIPLAYER.signals.cooldownMs - (performance.now() - tWave)) + 100);
    await A.call('key', { code: 'Digit6' });
    const nice = await until(() => B.sees(csA)?.bubble === '👍', 2500);
    check(
      `(4) key 6 → 👍 on B, with no second toast inside toastPerSenderSec (${MULTIPLAYER.signals.toastPerSenderSec} s)`,
      !!nice && B.events.length === 1,
      `B events ${B.events.length}`
    );
    const tNice = performance.now();
    await A.call('key', { code: 'Numpad7' });
    const smokeOff = await until(() => B.sees(csA) && (B.sees(csA).mpFlags & F.SMOKE) === 0 && A.snap?.smoke === false, 2000);
    check('(4) key 7 (numpad) toggles smoke off; B sees it clear', !!smokeOff);
    await sleep(Math.max(0, MULTIPLAYER.signals.cooldownMs - (performance.now() - tNice)) + 150);
    const cd1 = A.snap.cooldownUntil;
    await A.call('key', { code: 'Numpad4', key: 'ArrowLeft' });
    await A.call('key', { code: 'Numpad5', key: 'Clear' });
    await A.call('key', { code: 'Numpad6', key: 'ArrowRight' });
    await A.call('key', { code: 'Numpad7', key: 'Home' });
    await sleep(100);
    check(
      '(4) NumLock off (the keypad steers as ArrowLeft / Clear / ArrowRight / Home): no signal, no smoke toggle',
      A.snap.cooldownUntil === cd1 && A.snap.smoke === false && B.events.length === 1,
      `cooldown moved ${A.snap.cooldownUntil !== cd1} · smoke ${A.snap.smoke} · B events ${B.events.length}`
    );

    // ---- (5) the mutual-follow race -------------------------------------------
    const idAonB = B.sees(csA).hex;
    const idBonA = A.sees(csB).hex;
    await A.call('runtime', { apMode: 'intercept', lockedHex: idBonA });
    const aAssisted = await until(() => (B.sees(csA)?.mpFlags & F.ASSISTED) !== 0, 2000);
    await B.call('runtime', { apMode: 'intercept', lockedHex: idAonB });
    const yielded = await until(() => B.snap?.apMode === 'off' && B.snap?.arrival === FOLLOW_RACE_MESSAGE, 1500);
    await sleep(800);
    check(
      '(5) B engaging on an ASSISTED A yields at once with the banner; A keeps leading',
      !!aAssisted && !!yielded && A.snap?.apMode === 'intercept' && A.snap?.arrival == null,
      `A ${A.snap?.apMode} · B ${B.snap?.apMode} "${B.snap?.arrival}"`
    );
    await A.call('runtime', { apMode: 'off', lockedHex: null, arrival: null });
    await B.call('runtime', { apMode: 'off', lockedHex: null, arrival: null });
    await until(() => (B.sees(csA)?.mpFlags & F.ASSISTED) === 0 && (A.sees(csB)?.mpFlags & F.ASSISTED) === 0, 2000);
    await Promise.all([A.call('runtime', { apMode: 'intercept', lockedHex: idBonA }), B.call('runtime', { apMode: 'intercept', lockedHex: idAonB })]);
    await sleep(1500);
    const released = [A, B].filter((p) => p.snap?.apMode === 'off');
    check(
      '(5) both engaging at once never leaves two autopilots chasing; whoever let go says why',
      released.length >= 1 && released.every((p) => p.snap.arrival === FOLLOW_RACE_MESSAGE),
      `A ${A.snap?.apMode} · B ${B.snap?.apMode}`
    );
    await A.call('runtime', { apMode: 'off', lockedHex: null, arrival: null });
    await B.call('runtime', { apMode: 'off', lockedHex: null, arrival: null });
    await until(() => (B.sees(csA)?.mpFlags & F.ASSISTED) === 0 && (A.sees(csB)?.mpFlags & F.ASSISTED) === 0, 2000);
    // A chain, not a race: B follows A, and A takes up an airliner well after.
    await B.call('runtime', { apMode: 'intercept', lockedHex: idAonB });
    await sleep(RACE_MS + 500);
    const following = B.snap?.apMode === 'intercept';
    await A.call('runtime', { apMode: 'intercept', lockedHex: 'a1b2c3' });
    const chained = await until(() => B.snap?.apMode === 'off' && B.snap?.arrival != null, 2500);
    check(
      `(5) a leader who takes up someone else ${RACE_MS + 500} ms later releases its follower with "${ESCORT_MESSAGES.busy}", not the race banner`,
      following && !!chained && B.snap.arrival === ESCORT_MESSAGES.busy && A.snap?.apMode === 'intercept' && A.snap?.arrival == null,
      `B "${B.snap?.arrival}" · A ${A.snap?.apMode}`
    );
    await A.call('runtime', { apMode: 'off', lockedHex: null, arrival: null });
    await B.call('runtime', { apMode: 'off', lockedHex: null, arrival: null });

    // ---- (6) a hidden tab -----------------------------------------------------
    await A.call('hidden', true);
    const held = await until(() => {
      const a = B.sees(csA);
      return a && a.mpFlags & F.HELD && a.stale === 2 && a.opacity === 0.5 && a.vE === 0;
    }, 2500);
    check('(6) a hidden tab sends HELD at once: B shows A paused (stale 2, opacity 0.5, no velocity)', !!held);
    await A.call('hidden', false);
    const unheld = await until(() => {
      const a = B.sees(csA);
      return a && (a.mpFlags & F.HELD) === 0 && a.stale === 0;
    }, 2500);
    check('(6) visible again: HELD clears', !!unheld);

    // ---- (7) exclusive (hangar) and back ----------------------------------------
    const smokeBefore = await A.call('smoke');
    const leaveAbs = await A.call('fly', { screen: 'hangar' });
    const purged = await until(() => A.snap?.remoteCount === 0 && A.snap?.source === false, 600);
    check("(7) going exclusive purges A's remotes and its remote source at once (≤ one control tick)", !!purged, `remoteCount ${A.snap?.remoteCount}`);
    const smokeLeft = await until(() => A.snap?.smoke === false && A.snap?.mpSmoke === false, 400);
    const leftWhere = await A.call('where');
    await A.call('key', { code: 'Digit7' });
    await sleep(150);
    check(
      '(7) left: own smoke went off with the leave, key 7 does nothing outside the shared sky, and where() is refused',
      smokeBefore === true && !!smokeLeft && leftWhere.sent === false && A.snap?.smoke === false && A.snap?.mpSmoke === false,
      `smoke at leave ${smokeLeft ? 'off' : 'still on'} · after key 7 ${A.snap?.smoke}/${A.snap?.mpSmoke} · where sent ${leftWhere.sent}`
    );
    const exitB = await until(() => B.snap?.remoteCount === 0 && !B.sees(csA), 2000);
    check('(7) B gets the exit within 2 s; A keeps its socket for the linger', !!exitB && A.snap?.status === 'online' && A.snap?.sockets.at(-1) === 1, `B remoteCount ${B.snap?.remoteCount} · A ${A.snap?.status}`);
    // 14 s into the 15 s linger: longer than silenceSec after any pong that
    // came before the leave, so only a socket that kept pinging is still good.
    const backAt = leaveAbs + (MULTIPLAYER.lingerSec - 1) * 1000;
    await sleep(Math.max(0, backAt - (performance.timeOrigin + performance.now())));
    const lingerPings = A.snap?.pings.filter((p) => p > leaveAbs + 500).length ?? 0;
    check(
      `(7) the lingering socket keeps pinging every ${MULTIPLAYER.pingSec} s and stays open`,
      lingerPings >= 2 && A.snap?.status === 'online' && A.snap?.sockets.length === 1 && A.snap.sockets[0] === 1,
      `${lingerPings} pings in the ${MULTIPLAYER.lingerSec - 1} s linger · sockets ${A.snap?.sockets}`
    );
    await A.call('fly', { screen: 'flight' });
    const back = await until(() => B.sees(csA) && A.sees(csB), 4000);
    await sleep(300);
    check(
      `(7) back in Free Flight ${MULTIPLAYER.lingerSec - 1} s into the linger: re-enter both ways on the SAME socket, no offline flash`,
      !!back && A.snap?.sockets.length === 1 && A.snap.status === 'online',
      `sockets ${A.snap?.sockets} · ${A.snap?.status}`
    );

    // ---- (8) the toggle ----------------------------------------------------------
    const discA = A.snap.disclosedAt;
    await A.call('enabled', false);
    const off = await until(() => A.snap?.status === 'off' && A.snap?.remoteCount === 0 && A.snap?.sockets.every((s) => s >= 2), 800);
    const lostA = await until(() => !B.sees(csA), 2500);
    check('(8) toggle off: socket closed now, status off, remotes gone, and B loses A', !!off && !!lostA);
    await A.call('enabled', true);
    const again2 = await until(() => A.snap?.status === 'online' && B.sees(csA), 5000);
    check(
      '(8) toggle on: the same callsign (one seed per page), disclosedAt unchanged, no second hold, B sees A',
      !!again2 && A.snap.callsign === csA && A.snap.disclosedAt === discA && A.snap.sockets.length === 2,
      `${A.snap?.callsign} · sockets ${A.snap?.sockets.length}`
    );

    // ---- (1b) the hidden-tab first welcome (C) -------------------------------------
    for (const row of await hiddenLeg) check(...row);
    for (const row of await heldLeg) check(...row);
    await until(() => relay.world.stats().conns === 2, 2000);

    // ---- (9) where ------------------------------------------------------------------
    const tAsk = performance.now();
    /** The clusters of the first snapshot B took after `at` that holds a reply. */
    const replied = (at) => until(() => (B.snap?.abs > at && B.snap.clusters.length ? B.snap.clusters : null), 2000);
    const asked = await B.call('where', { clear: true });
    const twice = await B.call('where');
    const clusters = await replied(asked.at);
    const c = clusters?.[0];
    check('(9) where() is sent, and rate-limited to one per 3 s', asked.sent === true && twice.sent === false);
    check(
      "(9) the reply lands in mp-store.clusters: A counted, B subtracting itself from its own cell",
      clusters?.length === 1 && c.key === `mp:${c.cell}` && c.n === 1 && Math.abs(c.lat - LAT_A) < 0.2 && Math.abs(c.lon - LON0) < 0.2 && c.altM === ALT,
      JSON.stringify(clusters)
    );
    // B held (the Atlas) past the relay's AFK window: the relay drops B (and
    // exits A on B), so its summary no longer counts B.
    await B.call('runtime', { held: true });
    const afk = await until(() => B.snap?.remoteCount === 0, RELAY_AFK_MS + 2000);
    await sleep(Math.max(0, 3100 - (performance.now() - tAsk)));
    const tAsk2 = performance.now();
    const asked2 = await B.call('where', { clear: true });
    const afkClusters = await replied(asked2.at);
    check(
      `(9) held past the relay's AFK window (${RELAY_AFK_MS} ms here): B is no longer counted, so it does not subtract itself and A stays listed`,
      !!afk && asked2.sent === true && afkClusters?.length === 1 && afkClusters[0].n === 1,
      JSON.stringify(afkClusters)
    );
    await B.call('runtime', { held: false });
    await until(() => B.sees(csA), 3000);
    await sleep(Math.max(0, 3100 - (performance.now() - tAsk2)));
    const asked3 = await B.call('where', { clear: true });
    const flyClusters = await replied(asked3.at);
    check('(9) flying again: the relay counts B again, and B subtracts itself again', asked3.sent === true && flyClusters?.length === 1 && flyClusters[0].n === 1, JSON.stringify(flyClusters));

    // ---- (10) release -------------------------------------------------------------
    const [ra, rb] = await Promise.all([A.call('release'), B.call('release')]);
    for (const [p, r] of [
      [A, ra],
      [B, rb],
    ]) {
      check(
        `(10) ${p.name} release(): runtime.mp deleted, source and remotes gone, listeners removed, sockets closing, store reset`,
        r && r.mp === false && r.source === false && r.remoteCount === 0 && r.listeners === 0 && r.sockets.every((s) => s >= 2) && r.status === 'off' && r.callsign === null && r.disclosedAt > 0,
        r ? `mp ${r.mp} source ${r.source} remotes ${r.remoteCount} listeners ${r.listeners} sockets ${r.sockets} status ${r.status}` : 'no reply'
      );
    }
    const relayEmpty = await until(() => relay.world.stats().conns === 0, 2000);
    check('(10) the relay sees both sockets closed', !!relayEmpty, `conns ${relay.world.stats().conns}`);
    let raceTimer;
    const exits = await Promise.race([
      Promise.all([A.exited, B.exited, C.exited, D.exited]),
      new Promise((r) => (raceTimer = setTimeout(() => r(null), 5000))),
    ]);
    clearTimeout(raceTimer);
    check('(10) all four pilot pages EXIT ON THEIR OWN after release (no timer, socket or listener left)', exits?.every((c2) => c2 === 0) === true, exits ? `exit codes ${exits}` : 'still running after 5 s');
    if (!exits) {
      await A.w.terminate();
      await B.w.terminate();
      await C.w.terminate();
      await D.w.terminate();
    }
  } finally {
    await relay.close();
  }
  const secs = (performance.now() - started) / 1000;
  check('the gate finishes in under 60 s', secs < 60, `${secs.toFixed(1)} s`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  // No process.exit(): the process must wind down on its own (the guard is
  // unref'd), and this says how long the wind-down took.
  const doneAt = performance.now();
  process.once('exit', () => console.log(`(process exited on its own ${Math.round(performance.now() - doneAt)} ms after the summary)`));
}

// ===========================================================================
// pilot: one "page" (worker thread)
// ===========================================================================
async function pilot() {
  const { url, T0, lat, lon, aircraftId, hidden, held, photo, pin } = workerData;
  const abs = () => performance.timeOrigin + performance.now();

  // ---- shims, BEFORE any app module evaluates -------------------------------
  const target = (o) => {
    const m = new Map();
    o.addEventListener = (type, fn) => {
      if (!m.has(type)) m.set(type, new Set());
      m.get(type).add(fn);
    };
    o.removeEventListener = (type, fn) => m.get(type)?.delete(fn);
    o.dispatchEvent = (e) => {
      for (const fn of [...(m.get(e.type) ?? [])]) fn(e);
      return true;
    };
    o.listenerCount = () => [...m.values()].reduce((a, s) => a + s.size, 0);
    return o;
  };
  const win = target({ __flyMultiplayerOverride: { enabled: true, url, ...pin } });
  const doc = target({ hidden: !!hidden, visibilityState: hidden ? 'hidden' : 'visible' });
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.location = { protocol: 'http:', host: '127.0.0.1', search: '' };
  const sockets = [];
  const sent = { pings: [], states: 0, firstState: 0 }; // what this page put on the wire (abs ms)
  const NativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      sockets.push(this);
    }
    send(data) {
      if (typeof data !== 'string') {
        if (sent.states++ === 0) sent.firstState = abs();
      } else if (data.startsWith('{"t":"ping"')) sent.pings.push(abs());
      super.send(data);
    }
  };

  const { Vector3 } = await import('three');
  const { TrafficEngine, mercatorWorldXZ } = await import('../lib/fly/traffic-engine.js');
  const { mercatorScale } = await import('../lib/fly/coords.js');
  const { useFlyStore } = await import('../stores/fly-store.js');
  const { useMpStore } = await import('../stores/mp-store.js');
  const { connectMultiplayer } = await import('../lib/fly/mp/session.js');

  const k = mercatorScale(lat);
  const W = mercatorWorldXZ(lon, lat);
  const truth = (a) => {
    const t = (a - T0) / 1000;
    return [W.x + SPEED * Math.sin(HEADING) * t * k, ALT, W.z - SPEED * Math.cos(HEADING) * t * k];
  };
  const flight = { pos: new Vector3(...truth(abs())), heading: HEADING, pitch: 0, bank: 0, speed: SPEED, boosting: false, latDeg: lat };
  const traffic = new TrafficEngine();
  const runtime = {
    flight,
    traffic,
    geo: new Vector3(lon, lat, ALT),
    flightHeld: !!held,
    crash: { state: 'idle' },
    autopilot: {
      mode: 'off',
      disengage() {
        this.mode = 'off';
      },
    },
    targeting: { lockedHex: null },
    escort: null,
  };
  useFlyStore.setState({ screen: 'flight', flightMode: 'free', phase: 'flying', cameraMode: photo ? 'photo' : 'chase', runtimeReady: true, aircraftId, warpEpoch: 0, crashEpoch: 0, arrival: null });

  const harnessListeners = 1;
  win.addEventListener('fly-mp-signal', (e) => parentPort.postMessage({ event: { ...e.detail } }));

  const snapshot = (at) => {
    const s = useMpStore.getState();
    return {
      abs: at,
      status: s.status,
      online: s.online,
      nearby: s.nearby,
      callsign: s.callsign,
      color: s.color,
      disclosedAt: s.disclosedAt,
      disclosedAbs: s.disclosedAt > 0 ? performance.timeOrigin + s.disclosedAt : 0,
      clusters: s.clusters,
      smoke: s.smoke,
      cooldownUntil: s.signalCooldownUntil,
      mp: runtime.mp !== undefined,
      mpSmoke: runtime.mp?.smoke ?? null,
      size: traffic.size,
      remoteCount: traffic.remoteCount,
      source: traffic._remoteStep !== null,
      items: traffic.items.map((it) => ({
        hex: it.hex,
        remote: it.remote === true,
        flight: it.meta?.flight,
        aircraftId: it.meta?.aircraftId,
        rx: it.rx,
        ry: it.ry,
        rz: it.rz,
        x: it.rx,
        y: it.ry,
        z: it.rz,
        bank: it.bank,
        mpFlags: it.mpFlags,
        stale: it.stale,
        opacity: it.opacity,
        vE: it.fix1?.vE,
        vN: it.fix1?.vN,
        bubble: runtime.mp?.bubble(it.hex) ?? null,
      })),
      arrival: useFlyStore.getState().arrival?.name ?? null,
      apMode: runtime.autopilot.mode,
      sockets: sockets.map((w) => w.readyState),
      pings: sent.pings.slice(-16),
      states: sent.states,
      firstState: sent.firstState,
      listeners: win.listenerCount() + doc.listenerCount() - harnessListeners,
    };
  };

  const release = connectMultiplayer(runtime);
  let n = 0;
  const frame = () => {
    const at = abs();
    flight.pos.set(...truth(at));
    traffic.update(performance.now() / 1000, flight.pos);
    if (++n % 2 === 0) parentPort.postMessage({ snap: snapshot(at) });
  };
  const frameTimer = setInterval(frame, 16);

  parentPort.on('message', ({ id, cmd, arg }) => {
    let value;
    switch (cmd) {
      case 'signal':
        value = runtime.mp?.signal(arg);
        break;
      case 'smoke':
        value = runtime.mp?.toggleSmoke();
        break;
      case 'where':
        // A snapshot taken after `at` reflects the clear (or the reply).
        if (arg?.clear) useMpStore.getState().patch({ clusters: [] });
        value = { sent: runtime.mp?.where(), at: abs() };
        break;
      case 'key': {
        const key = arg.key ?? arg.code.replace(/^(Digit|Numpad)/, '');
        win.dispatchEvent({ type: 'keydown', code: arg.code, key, repeat: !!arg.repeat, ctrlKey: !!arg.ctrlKey, metaKey: false, altKey: false, target: arg.tag ? { tagName: arg.tag } : win });
        break;
      }
      case 'fly':
        useFlyStore.setState(arg);
        value = abs();
        break;
      case 'enabled':
        useMpStore.getState().setEnabled(arg);
        break;
      case 'runtime':
        if ('apMode' in arg) runtime.autopilot.mode = arg.apMode;
        if ('lockedHex' in arg) runtime.targeting.lockedHex = arg.lockedHex;
        if ('arrival' in arg) useFlyStore.setState({ arrival: arg.arrival });
        if ('held' in arg) runtime.flightHeld = !!arg.held;
        if ('photo' in arg) useFlyStore.setState({ cameraMode: arg.photo ? 'photo' : 'chase' });
        value = { abs: abs() };
        break;
      case 'hidden': {
        doc.hidden = !!arg;
        doc.visibilityState = arg ? 'hidden' : 'visible';
        doc.dispatchEvent({ type: 'visibilitychange' });
        const d = useMpStore.getState().disclosedAt;
        value = { abs: abs(), disclosedAgo: d > 0 ? performance.now() - d : null };
        break;
      }
      case 'release':
        release();
        clearInterval(frameTimer);
        traffic.update(performance.now() / 1000, flight.pos);
        value = snapshot(abs());
        // Nothing else may keep this page alive now: the port stops holding it.
        setImmediate(() => parentPort.unref());
        break;
      default:
    }
    parentPort.postMessage({ re: id, value });
  });
}
