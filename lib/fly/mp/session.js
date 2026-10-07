/**
 * MULTIPLAYER — the client session (MULTIPLAYER.md §Client; design §5, §8, §9).
 * Loaded only through hooks/use-fly-multiplayer.js's dynamic import, and only
 * when mpAvailable(): with the flag off or no relay URL this file never runs.
 *
 * connectMultiplayer(runtime) → release(). One WebSocket per page, owned here:
 *
 *   · a 250 ms CONTROL TICK decides whether we want to be in the shared sky
 *     (the "Fly with others" toggle, Free Flight not exclusive, the tab not
 *     hidden for hiddenCloseSec) and runs the connect / leave / linger /
 *     reconnect / ping bookkeeping. Evaluated on the tick, never through store
 *     subscriptions: an Adventure's status lives on the runtime, not a store;
 *   · the REMOTE STEP, installed with runtime.traffic.setRemoteSource, runs
 *     first inside TrafficEngine.update() (after FlightModel.step): it
 *     captures our own pose and sends it (10 Hz near another pilot, 1 Hz
 *     otherwise), then dead-reckons every pilot to the relay's present
 *     (lib/fly/mp/motion.mjs) and writes their tracks into items;
 *   · signals (keys 4–7, runtime.mp.signal / toggleSmoke), speech bubbles,
 *     'fly-mp-signal' window events for the toast, and the where-summary.
 *
 * Nothing here is saved anywhere: the hello seed is a module variable (one per
 * page load), and callsign, pilots and clusters live in memory and in the
 * non-persisted stores/mp-store.js. Per-frame data never touches a store.
 */
import { CLOSE, EMOTES, F, PROTOCOL, STATE_BYTES, aircraftIndex, emoteOf, encodeState, readBatch, withEmote } from './protocol.mjs';
import { ClockSync, RemoteMotion, msSince } from './motion.mjs';
import { MP_ACTIVE, mpUrl } from './mp-flag.js';
import { pilotColor, remoteArchetype, remoteMeta } from './remote-meta.js';
import { mercatorScale } from '../coords.js';
import { worldXZToLonLat } from '../traffic-engine.js';
import { freeFlightExclusive } from '../encounter-runtime.js';
import { ESCORT_MESSAGES, releaseEscort } from '../escort.js';
import { useFlyStore } from '@/stores/fly-store';
import { useMpStore } from '@/stores/mp-store';

const CONTROL_MS = 250;
const NEAR_HOLD_MS = 1500; // a batch with nearCount > 0 keeps the 10 Hz uplink this long
const STORE_GAP_MS = 1000; // online / nearby reach the store at most once a second
const WHERE_GAP_MS = 3000; // the relay answers one `where` per 3 s per socket
const GHOST_SEC_K = 2; // a pilot with no sample for 2 × silenceSec is dropped
const SEND_SLACK_SEC = 0.004; // frame-quantised decimation: 6 frames at 60 fps is "0.1 s"
const GLYPH = ['', '👋', '➜', '👍'];
const SMOKE_KEY = 4;
const SIGNAL_KEYS = Object.freeze({
  Digit4: 1,
  Numpad4: 1,
  Digit5: 2,
  Numpad5: 2,
  Digit6: 3,
  Numpad6: 3,
  Digit7: SMOKE_KEY,
  Numpad7: SMOKE_KEY,
});
export const FOLLOW_RACE_MESSAGE = 'You both tried to follow — one of you lead.';

// One random u32 per page load, in memory only: a reconnect presents the same
// seed, so the relay hands back the same callsign and retires a half-open twin.
let SEED = null;
function pageSeed() {
  if (SEED === null) {
    try {
      SEED = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    } catch {
      SEED = Math.floor(Math.random() * 4294967296) >>> 0;
    }
  }
  return SEED;
}

/** 1..12 o'clock of a world offset relative to a heading (escort.js relativeTo's rule). */
function clockOf(dx, dz, heading) {
  const deg = (((Math.atan2(dx, -dz) - heading) * 180) / Math.PI) % 360;
  return Math.round((deg + 360) % 360 / 30) % 12 || 12;
}

export function connectMultiplayer(runtime) {
  const cfg = MP_ACTIVE;
  const sig = cfg.signals;
  // A leader whose ASSISTED rises this close to my own engage raced me (its
  // bit can take a far-tier sample plus a far-tier forward to arrive).
  const raceMs = 2000 / cfg.farSendHz + 500;
  const store = useMpStore;
  const win = globalThis.window ?? null;
  const doc = globalThis.document ?? null;
  const now = () => performance.now();

  const clock = new ClockSync();
  const pilots = new Map(); // 'p:…' -> pilot
  const byUid = new Map(); // relay uid -> pilot
  const out = {}; // render scratch
  const rec = {}; // readBatch scratch

  let released = false;
  let ws = null;
  let gen = 0; // per-socket generation: a stale socket's events are ignored
  let welcomed = false;
  let openedAt = 0;
  let errHint = null;
  let myUid = -1;
  let backoff = cfg.reconnect.minMs;
  let retryAt = 0;
  let stopped = null; // 'replaced' | 'outdated': no retry until the toggle is cycled
  let waitUnheld = false; // closed idle (4003): reconnect once flying again
  let leftAt = 0; // when we sent `leave` (Free Flight went exclusive); 0 = in the sky
  let hiddenSince = 0;
  let lastPingAt = 0;
  let lastPongAt = 0;
  let burstTimer = null;
  let lastWhereAt = -Infinity;
  let installedOn = null; // the TrafficEngine our step is installed on
  let lastStoreAt = -Infinity;
  let onlineN = 0;
  let nearbyN = 0;
  let batchNow = 0;

  // ---- uplink state -------------------------------------------------------
  const buf = new ArrayBuffer(STATE_BYTES); // ONE buffer, reused for every STATE
  const st = { a: 0, flags: 0, warpSeq: 0, ts: 0, lat: 0, lon: 0, alt: 0, heading: 0, pitch: 0, bank: 0, speed: 0, vUp: 0 };
  const ll = {};
  let posed = false; // st holds a captured pose
  let capX = 0;
  let capY = 0;
  let capZ = 0;
  let ownLon = 0; // unbounded (flight.pos.x is continuous across ±180°)
  let warpSeq = 0;
  let lastWarpEpoch = null;
  let lastCrashEpoch = null;
  let prevY = 0;
  let prevYSec = -1;
  let sentAny = false;
  let forceSend = false;
  let lastSendSec = -Infinity;
  let sentX = 0;
  let sentY = 0;
  let sentZ = 0;
  let sentSpeed = 0;
  // What the relay's where-summary can know of us (client ms; 0 = not counted).
  let followHex = null; // the remote my autopilot follows, and since when (client ms)
  let followSince = 0;
  let nearUntil = -Infinity; // client ms
  let smoke = false;
  let emoteCode = 0;
  let emoteToggle = false;
  let emoteUntil = 0;
  let cooldownUntil = 0;
  let discAt = store.getState().disclosedAt || 0;

  const patch = (p) => store.getState().patch(p);
  function setStatus(status) {
    if (store.getState().status !== status) patch({ status });
  }
  function goOff() {
    const s = store.getState();
    if (s.status !== 'off' || s.online || s.nearby || s.clusters.length) patch({ status: 'off', online: 0, nearby: 0, clusters: [] });
  }
  function sendText(obj) {
    if (ws !== null && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ---- the engine ---------------------------------------------------------
  /** Drop every remote track and our step (a close, a leave, a release). */
  function purge() {
    const tr = installedOn ?? runtime.traffic ?? null;
    if (tr) {
      for (const p of pilots.values()) tr.removeRemote(p.id);
      if (tr._remoteStep === step) tr.setRemoteSource(null);
    }
    pilots.clear();
    byUid.clear();
    installedOn = null;
    nearbyN = 0;
  }

  /** (Re)install the step on runtime.traffic: a scene remount brings a fresh engine (its dispose() cleared ours). */
  function ensureInstalled() {
    const tr = runtime.traffic ?? null;
    if (tr !== installedOn) {
      if (installedOn) {
        for (const p of pilots.values()) installedOn.removeRemote(p.id);
        if (installedOn._remoteStep === step) installedOn.setRemoteSource(null);
      }
      for (const p of pilots.values()) p.track = null;
      installedOn = tr;
    }
    if (tr && tr._remoteStep !== step) tr.setRemoteSource(step);
  }

  // ---- socket -------------------------------------------------------------
  function open() {
    const base = mpUrl();
    if (!base || typeof WebSocket !== 'function') {
      retryAt = now() + cfg.reconnect.maxMs;
      goOff();
      return;
    }
    const url = `${base}${base.includes('?') ? '&' : '?'}v=${PROTOCOL}`;
    const g = ++gen;
    let s;
    try {
      s = new WebSocket(url);
    } catch {
      scheduleRetry(null);
      return;
    }
    s.binaryType = 'arraybuffer';
    ws = s;
    welcomed = false;
    errHint = null;
    openedAt = now();
    setStatus('connecting');
    s.onopen = () => {
      if (g === gen) sendText({ t: 'hello', v: PROTOCOL, seed: pageSeed() });
    };
    s.onmessage = (e) => {
      if (g === gen) onMessage(e.data);
    };
    s.onerror = () => {};
    s.onclose = (e) => {
      if (g === gen) onClosed(e.code);
    };
  }

  /** Close (if open) and forget everything the socket brought: remotes, clock, uplink. */
  function dropSocket() {
    const s = ws;
    ws = null;
    gen++;
    welcomed = false;
    errHint = null;
    myUid = -1;
    clearTimeout(burstTimer);
    burstTimer = null;
    if (s) {
      s.onopen = s.onmessage = s.onerror = s.onclose = null;
      try {
        s.close(1000, 'bye');
      } catch {
        /* already closing */
      }
    }
    purge();
    clock.reset();
    leftAt = 0;
    sentAny = false;
    lastSendSec = -Infinity;
    nearUntil = -Infinity;
  }

  function scheduleRetry(fixedMs, status = 'offline') {
    let d = fixedMs;
    if (d == null) {
      d = backoff;
      backoff = Math.min(cfg.reconnect.maxMs, backoff * 2);
    }
    const j = cfg.reconnect.jitter ?? 0.3;
    retryAt = now() + d * (1 + j * (2 * Math.random() - 1));
    setStatus(status);
  }

  function onClosed(code) {
    const hint = errHint;
    dropSocket();
    if (released) return;
    if (code === CLOSE.REPLACED) {
      stopped = 'replaced';
      setStatus('replaced');
    } else if (code === CLOSE.VERSION || hint === 'version') {
      stopped = 'outdated';
      setStatus('outdated');
    } else if (code === CLOSE.FULL || hint === 'full') scheduleRetry(cfg.reconnect.maxMs, 'full');
    else if (code === CLOSE.POLICY || code === CLOSE.TOO_BIG) scheduleRetry(cfg.reconnect.maxMs);
    else if (code === CLOSE.RESTART || hint === 'bye') {
      retryAt = now() + 1000 + Math.random() * 4000;
      setStatus('offline');
    } else if (code === CLOSE.IDLE) {
      waitUnheld = true;
      retryAt = 0;
      setStatus('offline');
    } else scheduleRetry(null);
  }

  function ping() {
    lastPingAt = now();
    sendText({ t: 'ping', c: lastPingAt });
  }

  function onMessage(data) {
    if (typeof data !== 'string') {
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) onBatch(data);
      return;
    }
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'welcome':
        onWelcome(m);
        break;
      case 'pong':
        lastPongAt = now();
        clock.add(m.c, m.s, lastPongAt);
        if (Number.isFinite(m.n)) onlineN = m.n;
        break;
      case 'enter':
        onEnter(m);
        break;
      case 'exit':
        onExit(m.id);
        break;
      case 'where':
        onWhere(m);
        break;
      case 'err':
      case 'bye':
        errHint = m.t === 'bye' ? 'bye' : m.code;
        break;
      default:
    }
  }

  function onWelcome(m) {
    welcomed = true;
    backoff = cfg.reconnect.minMs;
    myUid = typeof m.id === 'string' ? parseInt(m.id.slice(2), 36) : -1;
    purge(); // a fresh relay session starts from an empty known set
    onlineN = Number.isFinite(m.n) ? m.n : 0;
    const t = now();
    patch({ status: 'online', callsign: typeof m.cs === 'string' ? m.cs : null, color: pilotColor(m.c), online: onlineN });
    disclose(t);
    lastStoreAt = t;
    lastPongAt = t;
    // Clock sync: three pings 200 ms apart, then one every pingSec (the tick).
    const g = gen;
    let k = 0;
    const burst = () => {
      burstTimer = null;
      if (g !== gen || released) return;
      ping();
      if (++k < 3) burstTimer = setTimeout(burst, 200);
    };
    burst();
    if (!freeFlightExclusive(runtime, useFlyStore.getState())) ensureInstalled();
  }

  /**
   * The disclosure is stamped ONCE per page load, never on a reconnect — and
   * only where the player can read it: a visible tab in Free Flight (where
   * MpStatusChip shows it), with the flying HUD up. A welcome that lands in a
   * hidden tab, the hangar, under the boot hold / a menu / the Atlas
   * (runtime.flightHeld, published every frame by FlyScene — undefined before
   * its first frame) or in photo mode (the HUD is display:none) waits here,
   * and so does the uplink (uplinkReady holds it disclosureHoldMs past the
   * stamp). The control tick retries every 250 ms.
   */
  function disclose(t) {
    if (discAt > 0 || !welcomed || doc?.hidden || runtime.flightHeld !== false) return;
    const fs = useFlyStore.getState();
    if (fs.cameraMode === 'photo' || freeFlightExclusive(runtime, fs)) return;
    if (!store.getState().disclosedAt) patch({ disclosedAt: t });
    discAt = store.getState().disclosedAt;
  }

  function onEnter(m) {
    // After `leave` the relay forgets what it told us: anything still in
    // flight would become a pilot no exit ever removes.
    if (leftAt !== 0 || typeof m.id !== 'string' || !m.id.startsWith('p:')) return;
    const uid = parseInt(m.id.slice(2), 36);
    if (!(uid >= 0) || uid === myUid) return;
    const meta = remoteMeta(m.id, typeof m.cs === 'string' ? m.cs : '', m.a | 0, m.c | 0);
    let p = pilots.get(m.id);
    if (!p) {
      p = {
        id: m.id,
        uid,
        meta,
        archetype: 0,
        motion: new RemoteMotion(cfg.dr, sig),
        track: null,
        flags: 0,
        assistedAt: -Infinity,
        eCode: 0,
        eTog: false,
        bubbleCode: 0,
        bubbleAt: 0,
        toastAt: -Infinity,
      };
      pilots.set(m.id, p);
      byUid.set(uid, p);
    }
    // A repeated enter is an upsert (a changed aircraft rides the next enter).
    p.meta = meta;
    p.archetype = remoteArchetype(meta.aircraftId);
    if (p.track !== null) {
      p.track.meta = meta; // in place; the step re-upserts into a fresh engine
      p.track.archetype = p.archetype;
    }
  }

  function onExit(id) {
    const p = pilots.get(id);
    if (!p) return;
    (installedOn ?? runtime.traffic)?.removeRemote(id);
    pilots.delete(id);
    byUid.delete(p.uid);
  }

  /** Safety net: the relay exits a pilot after silenceSec; one silent for twice that is a ghost. */
  function sweepGhosts(t) {
    if (!clock.ready) return;
    const tS = clock.serverNow(t);
    for (const p of pilots.values()) {
      if (p.motion.has && msSince(tS, p.motion.t) > GHOST_SEC_K * cfg.silenceSec * 1000) onExit(p.id);
    }
  }

  function onBatch(data) {
    if (!clock.ready || leftAt !== 0) return;
    const t = now();
    batchNow = clock.serverNow(t);
    const head = readBatch(data, onRecord, rec);
    if (head && head.nearCount > 0) nearUntil = t + NEAR_HOLD_MS;
  }

  function onRecord(r) {
    const p = byUid.get(r.uid);
    if (p === undefined) return; // unknown until its enter arrives
    if (!p.motion.push(r, batchNow, ownLon)) return;
    if (r.flags & F.ASSISTED && !(p.flags & F.ASSISTED)) p.assistedAt = now();
    p.flags = r.flags;
    const code = emoteOf(r.flags);
    const tog = (r.flags & F.EMOTE_TOGGLE) !== 0;
    if (code !== p.eCode || tog !== p.eTog) {
      p.eCode = code;
      p.eTog = tog;
      if (code !== 0) onEmote(p, code);
    }
  }

  /** A received emote edge: bubble, wing-rock, and (rate-limited) the toast event. */
  function onEmote(p, code) {
    const f = runtime.flight;
    const m = p.motion;
    if (!f) return;
    const dx = m.x0 - f.pos.x;
    const dz = m.z0 - f.pos.z;
    const distM = Math.hypot(dx / m.k, m.alt - f.pos.y, dz / m.k);
    if (!(distM <= cfg.signalRangeM)) return; // too far to have seen it
    const t = now();
    p.bubbleCode = code;
    p.bubbleAt = t;
    if (code === 1) m.startWave(batchNow);
    if (t - p.toastAt < sig.toastPerSenderSec * 1000) return;
    p.toastAt = t;
    if (!win || typeof win.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
    const detail = {
      id: p.id,
      callsign: p.meta.flight,
      code: EMOTES[code],
      color: p.meta.color,
      distM,
      clock: clockOf(dx, dz, f.heading),
      at: t,
    };
    try {
      win.dispatchEvent(new CustomEvent('fly-mp-signal', { detail }));
    } catch (err) {
      console.warn('[fly-mp] signal listener failed:', err);
    }
  }

  function onWhere(m) {
    if (!Array.isArray(m.c) || leftAt !== 0) return; // a reply still in flight at `leave`
    // Leave ourselves out: the relay names the cell this summary counted us
    // in (`me`), or null when it did not count us at all.
    const mine = Number.isInteger(m.me) ? m.me : null;
    const clusters = [];
    for (const row of m.c) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const [cell, lat, lon, n0, altM] = row;
      const n = cell === mine ? n0 - 1 : n0;
      if (!(n > 0) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      clusters.push({ key: `mp:${cell}`, cell, lat, lon, n, altM: Number.isFinite(altM) ? altM : 0 });
    }
    patch({ clusters });
  }

  // ---- the remote step (inside TrafficEngine.update, every frame) ----------
  function step(clientSec, playerPos, items) {
    const tr = installedOn;
    if (released || tr === null || tr.items !== items) return; // a stale engine
    // Before the capture: a pilot who must yield never sends ASSISTED at all.
    followRace();
    const f = runtime.flight;
    if (f) capture(clientSec, f);
    if (!clock.ready) return;
    const t = clock.serverNow(clientSec * 1000);
    let near = 0;
    for (const p of pilots.values()) {
      const m = p.motion;
      if (!m.has) continue;
      let tk = p.track;
      if (tk === null || tr.tracks.get(p.id) !== tk) tk = p.track = tr.upsertRemote(p.id, p.meta, p.archetype);
      m.render(t, out);
      tk.rx = out.x;
      tk.ry = out.y;
      tk.ryd = out.y; // pilots fly true MSL in every style (renderLift 0)
      tk.rz = out.z;
      tk.yaw = out.yaw;
      tk.bank = out.bank;
      tk.pitch = out.pitch;
      const fx = tk.fix1;
      fx.t = out.t;
      fx.x = out.x;
      fx.y = out.y;
      fx.z = out.z;
      fx.vE = out.vE;
      fx.vN = out.vN;
      fx.vUp = out.vUp;
      fx.latRad = out.latRad;
      tk.opacity = out.opacity;
      tk.scaleK = 1;
      tk.stale = out.stale;
      tk.snapEpoch = m.snapEpoch;
      tk.mpFlags = p.flags;
      if (playerPos) {
        tk.distM = Math.hypot((out.x - playerPos.x) / m.k, out.y - playerPos.y, (out.z - playerPos.z) / m.k);
      }
      if (tk.distM <= cfg.signalRangeM) near++;
      items.push(tk);
    }
    nearbyN = near;
  }

  /**
   * Two pilots who engage on each other within a round trip both see the
   * other ASSISTED: both let go, and the banner says why (design §7 row 15).
   * One who engages on a leader already showing ASSISTED lets go alone, in
   * the same frame, before its own sample can carry the bit. The wire does
   * not say WHOM a leader follows, so the banner goes by timing: a bit that
   * rose within raceMs of my engage is the race; one that was up long before
   * or rose long after (the leader took up someone else) is a chain.
   */
  function followRace() {
    const mode = runtime.autopilot?.mode;
    if (!mode || mode === 'off') {
      followHex = null;
      return;
    }
    const hex = runtime.targeting?.lockedHex ?? runtime.escort?.hex;
    if (hex !== followHex) {
      followHex = hex;
      followSince = now();
    }
    const p = hex ? pilots.get(hex) : undefined;
    if (p === undefined || !(p.flags & F.ASSISTED)) return;
    releaseEscort(runtime);
    followHex = null;
    const race = Math.abs(p.assistedAt - followSince) <= raceMs;
    useFlyStore.getState().setArrival({ name: race ? FOLLOW_RACE_MESSAGE : ESCORT_MESSAGES.busy, kind: null, at: Date.now() });
  }

  function uplinkReady(fs, tc) {
    return (
      welcomed &&
      leftAt === 0 &&
      clock.ready &&
      ws !== null &&
      ws.readyState === 1 &&
      fs.runtimeReady === true &&
      !!runtime.geo &&
      discAt > 0 &&
      tc - discAt >= cfg.disclosureHoldMs
    );
  }

  /** Capture our pose from the flight model (absolute mercator) and send it at the tier's rate. */
  function capture(clientSec, f) {
    const fs = useFlyStore.getState();
    worldXZToLonLat(f.pos.x, f.pos.z, ll);
    ownLon = ll.lon;
    if (fs.warpEpoch !== lastWarpEpoch || fs.crashEpoch !== lastCrashEpoch) {
      if (lastWarpEpoch !== null) warpSeq = (warpSeq + 1) & 0xff; // warp, or a crash respawn
      lastWarpEpoch = fs.warpEpoch;
      lastCrashEpoch = fs.crashEpoch;
      prevYSec = -1; // no climb rate across a jump
    }
    // The ACTUAL vertical rate (frame Δy, soft floor included), lightly smoothed.
    const dtY = clientSec - prevYSec;
    if (prevYSec < 0) st.vUp = 0;
    else if (dtY > 0) st.vUp = dtY < 0.5 ? st.vUp + ((f.pos.y - prevY) / dtY - st.vUp) * Math.min(1, dtY / 0.1) : 0;
    if (dtY !== 0) {
      prevY = f.pos.y;
      prevYSec = clientSec;
    }
    const held = !!runtime.flightHeld || !!doc?.hidden;
    const crash = runtime.crash?.state;
    const ap = runtime.autopilot?.mode;
    const tc = clientSec * 1000;
    let flags =
      (held ? F.HELD : 0) |
      (crash && crash !== 'idle' ? F.CRASHED : 0) |
      (f.boosting ? F.BOOST : 0) |
      (smoke ? F.SMOKE : 0) |
      (ap && ap !== 'off' ? F.ASSISTED : 0);
    flags = withEmote(flags, tc < emoteUntil ? emoteCode : 0, emoteToggle);
    st.a = aircraftIndex(fs.aircraftId);
    st.flags = flags;
    st.lat = ll.lat;
    st.lon = ownLon;
    st.alt = f.pos.y;
    st.heading = f.heading;
    st.pitch = f.pitch;
    st.bank = f.bank;
    st.speed = f.speed;
    capX = f.pos.x;
    capY = f.pos.y;
    capZ = f.pos.z;
    posed = true;

    if (!uplinkReady(fs, tc)) return;
    const hz = held ? cfg.heldSendHz : tc < nearUntil ? cfg.sendHz : cfg.farSendHz;
    const dt = clientSec - lastSendSec;
    if (!forceSend && dt < 1 / hz - SEND_SLACK_SEC) return;
    // Catch-all: consecutive samples too far apart for the speed are a jump.
    if (sentAny && Number.isFinite(dt)) {
      const k = mercatorScale(ll.lat);
      const d = Math.hypot((capX - sentX) / k, capY - sentY, (capZ - sentZ) / k);
      if (d > Math.max(f.speed, sentSpeed) * dt + 1000) warpSeq = (warpSeq + 1) & 0xff;
    }
    sendState(clientSec);
  }

  function sendState(clientSec) {
    st.warpSeq = warpSeq;
    st.ts = (clientSec * 1000 + clock.offset) >>> 0; // RELAY ms
    encodeState(st, buf);
    ws.send(buf);
    sentAny = true;
    forceSend = false;
    lastSendSec = clientSec;
    sentX = capX;
    sentY = capY;
    sentZ = capZ;
    sentSpeed = st.speed;
  }

  // ---- control tick -------------------------------------------------------
  function control() {
    if (released) return;
    const t = now();
    const fs = useFlyStore.getState();
    const enabled = store.getState().enabled === true;
    if (doc?.hidden) hiddenSince ||= t;
    else hiddenSince = 0;
    const hiddenLong = hiddenSince !== 0 && t - hiddenSince >= cfg.hiddenCloseSec * 1000;

    if (!enabled || hiddenLong) {
      if (!enabled) {
        stopped = null; // cycling the toggle is a fresh start
        if (smoke) api.toggleSmoke();
      }
      if (ws) dropSocket();
      retryAt = 0;
      waitUnheld = false;
      goOff();
      return;
    }
    if (freeFlightExclusive(runtime, fs)) {
      if (ws) {
        if (leftAt === 0) {
          // Title / hangar / ops / an Adventure: invisible at once, nothing
          // rendered at once, the socket kept for the linger. Status stays
          // 'online' through the linger, so the counts and the Atlas clusters
          // clear here, and own smoke goes off (no one can see it).
          leftAt = t;
          sendText({ t: 'leave' });
          purge();
          if (smoke) api.toggleSmoke();
          const s = store.getState();
          if (s.nearby || s.clusters.length) patch({ nearby: 0, clusters: [] });
        }
        if (t - leftAt >= cfg.lingerSec * 1000 || (welcomed && t - lastPongAt > cfg.silenceSec * 1000)) {
          dropSocket();
          goOff();
        } else if (welcomed && burstTimer === null && t - lastPingAt >= cfg.pingSec * 1000) {
          ping(); // the lingering socket stays live: a return inside the linger finds it fresh
        }
      } else if (!stopped) goOff();
      return;
    }
    leftAt = 0; // back within the linger: the next STATE shows us again
    if (stopped) return;
    if (!ws) {
      if (waitUnheld && runtime.flightHeld) return;
      if (t >= retryAt) {
        waitUnheld = false;
        open();
      }
      return;
    }
    if (!welcomed) {
      if (t - openedAt > cfg.silenceSec * 1000) {
        dropSocket();
        scheduleRetry(null);
      }
      return;
    }
    if (t - lastPongAt > cfg.silenceSec * 1000) {
      dropSocket();
      scheduleRetry(null);
      return;
    }
    disclose(t);
    ensureInstalled();
    sweepGhosts(t);
    if (burstTimer === null && t - lastPingAt >= cfg.pingSec * 1000) ping();
    if (t - lastStoreAt >= STORE_GAP_MS) {
      lastStoreAt = t;
      const s = store.getState();
      if (s.online !== onlineN || s.nearby !== nearbyN) patch({ online: onlineN, nearby: nearbyN });
    }
  }

  // ---- DOM: keys 4–7 and the hidden-tab HELD sample --------------------------
  function onKey(e) {
    if (released || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = SIGNAL_KEYS[e.code];
    if (k === undefined) return;
    // NumLock off, the keypad is arrows / Clear / Home, and InputController
    // steers on those keys: only a keypad DIGIT is a signal.
    if (e.code.startsWith('Numpad') && e.key !== e.code.slice(6)) return;
    const tg = e.target;
    const tag = tg?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tg?.isContentEditable) return;
    if (runtime.flightHeld || store.getState().enabled !== true) return;
    // Outside the shared sky (title / hangar / an Adventure) a signal goes
    // nowhere, and smoke would draw on our own plane only.
    if (freeFlightExclusive(runtime, useFlyStore.getState())) return;
    if (k === SMOKE_KEY) api.toggleSmoke();
    else api.signal(k);
  }

  function onVisibility() {
    if (released || !doc) return;
    if (!doc.hidden) {
      hiddenSince = 0;
      disclose(now());
      return;
    }
    hiddenSince ||= now();
    // rAF stops with the tab: one HELD sample from the last pose, so viewers
    // see "paused" instead of a plane dead-reckoning away.
    if (posed && uplinkReady(useFlyStore.getState(), now())) {
      st.flags |= F.HELD;
      sendState(now() / 1000);
    }
  }

  // ---- runtime.mp ---------------------------------------------------------
  const api = {
    /** 1 wave · 2 follow me · 3 nice. false while cooling down, held or not online. */
    signal(code) {
      const c = code | 0;
      if (released || c < 1 || c > 3) return false;
      if (!welcomed || leftAt !== 0 || runtime.flightHeld) return false;
      const t = now();
      if (t < cooldownUntil) return false;
      emoteCode = c;
      emoteToggle = !emoteToggle;
      emoteUntil = t + sig.holdMs;
      cooldownUntil = t + sig.cooldownMs;
      forceSend = true; // ride the next frame, not the next 1 Hz slot
      patch({ signalCooldownUntil: cooldownUntil });
      return true;
    },
    /** Own smoke on/off (a state, sent as F.SMOKE). Returns the new state. */
    toggleSmoke() {
      if (released) return false;
      smoke = !smoke;
      forceSend = true;
      patch({ smoke });
      return smoke;
    },
    get smoke() {
      return smoke;
    },
    /** The speech-bubble glyph over a pilot's label while their emote is fresh, else null. */
    bubble(id) {
      const p = pilots.get(id);
      if (p === undefined || p.bubbleCode === 0 || now() - p.bubbleAt >= sig.bubbleSec * 1000) return null;
      return GLYPH[p.bubbleCode];
    },
    /** Ask the relay where pilots are (≤ 1 per 3 s); the reply lands in mp-store.clusters. */
    where() {
      // Not while left (the linger): we are not in the shared sky.
      if (released || !welcomed || ws === null || leftAt !== 0) return false;
      const t = now();
      if (t - lastWhereAt < WHERE_GAP_MS) return false;
      lastWhereAt = t;
      sendText({ t: 'where' });
      return true;
    },
  };

  runtime.mp = api;
  win?.addEventListener?.('keydown', onKey);
  doc?.addEventListener?.('visibilitychange', onVisibility);
  const tickTimer = setInterval(control, CONTROL_MS);
  control();

  return function release() {
    if (released) return;
    released = true;
    clearInterval(tickTimer);
    win?.removeEventListener?.('keydown', onKey);
    doc?.removeEventListener?.('visibilitychange', onVisibility);
    dropSocket();
    if (runtime.mp === api) delete runtime.mp;
    store.getState().resetSession();
  };
}
