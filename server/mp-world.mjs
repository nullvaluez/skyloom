/**
 * MULTIPLAYER relay — the WORLD (MULTIPLAYER.md §Relay). Pure: no I/O, no
 * timers, no randomness. The relay (server/mp-relay.mjs) owns the sockets and
 * the clock and drives this with connect / onText / onBinary / disconnect /
 * tick; the gates drive it the same way with a fake now().
 *
 * What lives here, all in memory and never persisted:
 *   · players: uid (monotonic, never reused), callsign, last accepted pose
 *     (the 20 raw POSE bytes, copied verbatim into every record);
 *   · a 1° grid (antimeridian wrap; above ±80° a query takes the whole row);
 *   · interest every `interestEvery` ticks: the `maxVisible` nearest within
 *     `radiusKm`, a known pilot kept until `exitKm`; Wirth's FIND, no sort;
 *   · two tiers: near (≤ nearM AND among the nearMax nearest) every tick, far
 *     once per second on ticks where (tick + uid) % tickHz === 0. A record is
 *     sent only when the subject has a newer sample than the viewer last got;
 *   · per viewer per tick: JSON exits, JSON enters, then ONE binary batch;
 *   · presence (visible on the first valid STATE; hidden on leave, silence or
 *     a long HELD), validation, the where-summary and callsigns.
 */
import {
  ACCEPT,
  AIRCRAFT_IDS,
  CLIENT_TYPES,
  CLOSE,
  F,
  HEADER_BYTES,
  MAX_LAT,
  MAX_SPEED,
  MAX_TEXT,
  POSE_BYTES,
  POSE_OFFSET,
  PROTOCOL,
  RECORD_BYTES,
  decodeState,
  pilotId,
  tsDiff,
  wrap180,
  writeBatchHeader,
  writeRecord,
} from '../lib/fly/mp/protocol.mjs';

export const WORLD_DEFAULTS = Object.freeze({
  tickHz: 10,
  interestEvery: 5, // ticks: 2 Hz at the shipped 10 Hz tick
  radiusKm: 150,
  exitKm: 175, // hysteresis: a known pilot stays until it passes this
  maxVisible: 48,
  nearM: 3000,
  nearMax: 8,
  wholeRowLat: 80,
  helloTimeoutMs: 5000,
  silenceMs: 15000, // no STATE for this long -> invisible
  afkMs: 120000, // HELD for this long -> invisible
  idleCloseMs: 600000, // HELD (or no STATE) for this long -> close 4003
  tsPastMs: 3000,
  tsFutureMs: 500,
  teleportBurst: 3,
  teleportRefillMs: 5000,
  whereEveryMs: 3000, // per socket
  whereRebuildMs: 5000,
  whereTop: 48,
});

const D2R = Math.PI / 180;
export const KM_PER_DEG = (6371.0088 * Math.PI) / 180;

/** Equirectangular distance in km, dLon wrapped (the relay's one metric). */
export function distKm(lat1, lon1, lat2, lon2) {
  const x = wrap180(lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * D2R);
  const y = lat2 - lat1;
  return Math.sqrt(x * x + y * y) * KM_PER_DEG;
}

const cellKey = (lat, lon) => (Math.floor(lat) + 90) * 360 + ((((Math.floor(lon) + 180) % 360) + 360) % 360);

// ---- callsigns: curated, inoffensive sky / aviation nouns × 10–99 ----------
export const CALLSIGN_NOUNS = Object.freeze([
  // birds
  'HERON', 'KESTREL', 'SKYLARK', 'SWIFT', 'FALCON', 'MERLIN', 'OSPREY', 'CONDOR', 'ALBATROSS', 'PETREL',
  'TERN', 'GANNET', 'PELICAN', 'CRANE', 'STORK', 'IBIS', 'EGRET', 'PLOVER', 'CURLEW', 'LAPWING',
  'KITE', 'HARRIER', 'EAGLE', 'HAWK', 'GOSHAWK', 'RAVEN', 'MAGPIE', 'ROBIN', 'WREN', 'FINCH',
  'LINNET', 'SISKIN', 'ORIOLE', 'PIPIT', 'AVOCET', 'DUNLIN', 'MARTIN', 'SHEARWATER', 'FULMAR', 'PUFFIN',
  // sky and weather
  'CIRRUS', 'STRATUS', 'CUMULUS', 'NIMBUS', 'ZEPHYR', 'SIROCCO', 'MISTRAL', 'CHINOOK', 'AURORA', 'HALO',
  'RAINBOW', 'MONSOON', 'JETSTREAM', 'THERMAL', 'UPDRAFT', 'BREEZE', 'GALE', 'TEMPEST', 'SQUALL', 'DAWN',
  'DUSK', 'TWILIGHT', 'ZENITH', 'HORIZON', 'SOLSTICE',
  // stars and space
  'VEGA', 'ALTAIR', 'LYRA', 'ORION', 'SIRIUS', 'RIGEL', 'DENEB', 'CAPELLA', 'POLARIS', 'ANTARES',
  'SPICA', 'ARCTURUS', 'PROCYON', 'MIRA', 'CASTOR', 'POLLUX', 'ELECTRA', 'MAIA', 'ATLAS', 'COMET',
  'METEOR', 'NOVA', 'QUASAR', 'PULSAR', 'NEBULA',
  // aviation
  'AILERON', 'RUDDER', 'BEACON', 'COMPASS', 'SEXTANT', 'VECTOR', 'CONTRAIL', 'AIRFOIL', 'WINGLET', 'NAVIGATOR',
]);
export const CALLSIGN_DENY = Object.freeze([14, 18, 69, 88]);
const NUMBERS = [];
for (let n = 10; n <= 99; n++) if (!CALLSIGN_DENY.includes(n)) NUMBERS.push(n);

/** splitmix32: a well-mixed u32 -> u32 hash. */
export function splitmix32(a) {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

/** The k-th callsign candidate for a seed ('HERON 27'); k > 0 re-rolls a collision. */
export function callsignFor(seed, k = 0) {
  const h1 = splitmix32((seed + k) >>> 0);
  const h2 = splitmix32(h1);
  return `${CALLSIGN_NOUNS[h1 % CALLSIGN_NOUNS.length]} ${NUMBERS[h2 % NUMBERS.length]}`;
}
export const paletteFor = (seed) => splitmix32((seed ^ 0x5bd1e995) >>> 0) & 7;

export function createWorld(cfgIn = {}, { now } = {}) {
  const cfg = { ...WORLD_DEFAULTS, ...cfgIn };
  if (cfgIn.exitKm == null) cfg.exitKm = cfg.radiusKm * (WORLD_DEFAULTS.exitKm / WORLD_DEFAULTS.radiusKm);
  const clock = now ?? (() => 0);

  const players = new Map(); // uid -> player
  const grid = new Map(); // cellKey -> Set<player> (visible players only)
  const callsigns = new Map(); // live callsign -> owning player
  const seeds = new Map(); // live hello seed -> player
  let nextUid = 1;
  let tickNo = 0;
  let online = 0;
  let visible = 0;
  let stamp = 0;
  let whereCache = null;
  let whereAt = -Infinity;
  const counts = {
    statesIn: 0,
    accepted: 0,
    invalid: 0,
    teleport: 0, // rejected jumps
    text: 0,
    where: 0,
    warps: 0, // accepted teleports (warpSeq bump + token)
    batches: 0,
    records: 0,
  };

  // Reusable interest scratch: parallel candidate arrays + the selected batch.
  const candP = [];
  const candD = [];
  const pick = [];
  const scratch = {};

  // ---- grid ---------------------------------------------------------------
  function gridAdd(p) {
    p.cell = cellKey(p.lat, p.lon);
    let set = grid.get(p.cell);
    if (!set) grid.set(p.cell, (set = new Set()));
    set.add(p);
  }
  function gridRemove(p) {
    if (p.cell < 0) return;
    const set = grid.get(p.cell);
    if (set) {
      set.delete(p);
      if (set.size === 0) grid.delete(p.cell);
    }
    p.cell = -1;
  }

  // ---- presence -----------------------------------------------------------
  const present = (p, t) =>
    !p.left &&
    p.hasState &&
    t - p.lastStateAt <= cfg.silenceMs &&
    (p.heldSince === 0 || t - p.heldSince <= cfg.afkMs);

  function show(p) {
    p.visible = true;
    visible++;
    gridAdd(p);
  }

  /** why: 'leave' | 'gone' (the viewer already purged / is gone) | 'away' (silence, AFK). */
  function hide(p, why) {
    if (!p.visible) return;
    p.visible = false;
    visible--;
    gridRemove(p);
    for (const v of p.viewers) {
      v.known.delete(p.uid);
      v.exits.push(p.id);
    }
    p.viewers.clear();
    for (const uid of p.known.keys()) {
      players.get(uid)?.viewers.delete(p);
      if (why === 'away') p.exits.push(pilotId(uid));
    }
    p.known.clear();
    p.vis.length = 0;
    p.visNear.length = 0;
    p.nearCount = 0;
  }

  function kill(p, code, reason) {
    if (p.dead) return;
    p.close(code, reason);
    disconnect(p);
  }

  // ---- connection lifecycle ----------------------------------------------
  function connect(send, close) {
    const uid = nextUid++ >>> 0;
    const p = {
      uid,
      id: pilotId(uid),
      send,
      close,
      connectedAt: clock(),
      helloed: false,
      dead: false,
      seed: null,
      cs: null,
      c: 0,
      // last accepted sample
      hasState: false,
      a: 0,
      flags: 0,
      warpSeq: 0,
      ts: 0, // presentation time (ageMs): clamped to [recv - tsPastMs, recv + tsFutureMs]
      moveTs: 0, // pacing time (movement rule): the sender's own ts, in [recv - silenceMs, recv + tsFutureMs]
      seq: 0,
      lat: 0,
      lon: 0,
      alt: 0,
      pose: new Uint8Array(POSE_BYTES),
      lastStateAt: 0,
      heldSince: 0,
      left: false,
      visible: false,
      cell: -1,
      stamp: 0,
      tpTokens: cfg.teleportBurst,
      tpAt: 0,
      lastWhereAt: -Infinity,
      // as a viewer
      known: new Map(), // subject uid -> seq last sent (0 = entered, nothing sent yet)
      viewers: new Set(), // players that currently know this one
      vis: [],
      visNear: [],
      nearCount: 0,
      exits: [],
      enters: [],
    };
    players.set(uid, p);
    return p;
  }

  function disconnect(p) {
    if (!p || p.dead) return;
    hide(p, 'gone');
    p.dead = true;
    players.delete(p.uid);
    if (p.helloed) online--;
    if (p.cs != null && callsigns.get(p.cs) === p) callsigns.delete(p.cs);
    if (p.seed != null && seeds.get(p.seed) === p) seeds.delete(p.seed);
  }

  function hello(p, m) {
    if (p.helloed) return;
    if (!ACCEPT.includes(m.v)) {
      p.send(JSON.stringify({ t: 'err', code: 'version', need: PROTOCOL }));
      kill(p, CLOSE.VERSION, 'version');
      return;
    }
    const seed = Number.isInteger(m.seed) && m.seed >= 0 && m.seed <= 0xffffffff ? m.seed : null;
    p.helloed = true;
    online++;
    const old = seed == null ? null : seeds.get(seed);
    if (old && !old.dead) {
      // A half-open reconnect: the new socket inherits the callsign, the old one goes.
      p.cs = old.cs;
      p.c = old.c;
      callsigns.set(p.cs, p);
      kill(old, CLOSE.REPLACED, 'replaced');
    } else {
      const base = seed ?? splitmix32(p.uid ^ 0x2545f491);
      p.c = paletteFor(base);
      for (let k = 0; k < 4096 && p.cs == null; k++) {
        const cs = callsignFor(base, k);
        if (!callsigns.has(cs)) p.cs = cs;
      }
      p.cs ??= `PILOT ${p.uid}`;
      callsigns.set(p.cs, p);
    }
    if (seed != null) {
      p.seed = seed;
      seeds.set(seed, p);
    }
    p.send(JSON.stringify({ t: 'welcome', v: PROTOCOL, id: p.id, cs: p.cs, c: p.c, n: online }));
  }

  function onText(p, str) {
    if (p.dead) return;
    let m = null;
    if (typeof str === 'string' && str.length <= MAX_TEXT) {
      try {
        m = JSON.parse(str);
      } catch {
        m = null;
      }
    }
    if (!m || typeof m !== 'object' || !CLIENT_TYPES.includes(m.t)) {
      counts.text++;
      return;
    }
    const t = clock();
    switch (m.t) {
      case 'hello':
        hello(p, m);
        return;
      case 'ping':
        p.send(
          JSON.stringify({ t: 'pong', c: Number.isFinite(m.c) ? m.c : null, s: Math.floor(t) >>> 0, n: online })
        );
        return;
      case 'leave':
        p.left = true;
        hide(p, 'leave');
        // The client purges every remote itself at leave: nothing queued for it still applies.
        p.exits.length = 0;
        p.enters.length = 0;
        return;
      case 'where':
        if (!p.helloed || t - p.lastWhereAt < cfg.whereEveryMs) {
          counts.where++;
          return;
        }
        p.lastWhereAt = t;
        // `me` = the cell this summary counted the asker in (null when it did
        // not count them), so the client can leave itself out exactly.
        p.send(`${whereSummary(t)},"me":${p.whereCell ?? null}}`);
        return;
    }
  }

  // ---- STATE validation ---------------------------------------------------
  function takeTeleport(p, t) {
    p.tpTokens = Math.min(cfg.teleportBurst, p.tpTokens + (t - p.tpAt) / cfg.teleportRefillMs);
    p.tpAt = t;
    if (p.tpTokens < 1) return false;
    p.tpTokens -= 1;
    return true;
  }

  function onBinary(p, data) {
    if (p.dead) return;
    counts.statesIn++;
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const s = p.helloed ? decodeState(u8, scratch) : null;
    if (
      !s ||
      !Number.isFinite(s.lat) ||
      !Number.isFinite(s.lon) ||
      !Number.isFinite(s.alt) ||
      !Number.isFinite(s.heading) ||
      !Number.isFinite(s.pitch) ||
      !Number.isFinite(s.bank) ||
      !Number.isFinite(s.speed) ||
      !Number.isFinite(s.vUp) ||
      Math.abs(s.lat) > MAX_LAT ||
      Math.abs(s.lon) > 180 ||
      s.speed > MAX_SPEED ||
      s.a >= AIRCRAFT_IDS.length
    ) {
      counts.invalid++;
      return;
    }
    const t = clock();
    const recv = Math.floor(t) >>> 0;
    // Two clocks per sample. The movement rule paces by the SENDER's own ts
    // (kept within the silence window), so a stalled TCP queue of correctly
    // spaced samples is never a teleport, and each stored baseline time
    // matches its stored pose. Records carry the tighter presentation clamp.
    // A forged ts buys the window once (15.5 s, ~19 km), not repeatedly:
    // moveTs cannot go backwards and cannot run ahead of recv + tsFutureMs.
    let mts = s.ts;
    if (tsDiff(mts, recv) < -cfg.silenceMs) mts = (recv - cfg.silenceMs) >>> 0;
    else if (tsDiff(mts, recv) > cfg.tsFutureMs) mts = (recv + cfg.tsFutureMs) >>> 0;
    const ts = tsDiff(mts, recv) < -cfg.tsPastMs ? (recv - cfg.tsPastMs) >>> 0 : mts;
    const lon = wrap180(s.lon);
    if (p.hasState) {
      const dt = tsDiff(mts, p.moveTs);
      if (dt < 0) {
        counts.invalid++; // older than what we hold
        return;
      }
      const moveM = distKm(p.lat, p.lon, s.lat, lon) * 1000;
      const limitM = MAX_SPEED * Math.max(dt / 1000, 0.1) * 1.5 + 500;
      if (moveM > limitM) {
        // A rejected jump keeps the old warpSeq, so it heals once a token refills.
        if (s.warpSeq === p.warpSeq || !takeTeleport(p, t)) {
          counts.teleport++;
          return;
        }
        counts.warps++;
      }
    }
    p.hasState = true;
    // The latest aircraft is stored and every enter reads it. A change is not
    // re-announced to current viewers (MULTIPLAYER.md §Relay 6): every client
    // path that changes it sends leave first, and a client that flips it
    // mid-flight cannot spam its viewers with enters.
    p.a = s.a;
    p.flags = s.flags & F.KNOWN;
    p.warpSeq = s.warpSeq;
    p.ts = ts;
    p.moveTs = mts;
    p.seq++;
    p.lat = s.lat;
    p.lon = lon;
    p.alt = s.alt;
    p.pose.set(u8.subarray(POSE_OFFSET, POSE_OFFSET + POSE_BYTES));
    p.lastStateAt = t;
    p.left = false;
    if (p.flags & F.HELD) {
      if (p.heldSince === 0) p.heldSince = t;
    } else p.heldSince = 0;
    counts.accepted++;

    if (p.visible) {
      if (!present(p, t)) hide(p, 'away');
      else {
        const cell = cellKey(p.lat, p.lon);
        if (cell !== p.cell) {
          gridRemove(p);
          gridAdd(p);
        }
      }
    } else if (present(p, t)) show(p);
  }

  // ---- interest -----------------------------------------------------------
  function swap(i, j) {
    const p = candP[i];
    candP[i] = candP[j];
    candP[j] = p;
    const d = candD[i];
    candD[i] = candD[j];
    candD[j] = d;
  }
  /** Wirth's FIND: afterwards candD[0..k) holds the k smallest of candD[0..n) (unordered). */
  function selectSmallest(n, k) {
    const t = k - 1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const x = candD[t];
      let i = lo;
      let j = hi;
      do {
        while (candD[i] < x) i++;
        while (x < candD[j]) j--;
        if (i <= j) {
          swap(i, j);
          i++;
          j--;
        }
      } while (i <= j);
      if (j < t) lo = i;
      if (t < i) hi = j;
    }
  }

  function computeInterest(v) {
    const R = cfg.exitKm;
    let n = 0;
    const dLat = R / KM_PER_DEG;
    const r0 = Math.max(-90, Math.floor(v.lat - dLat));
    const r1 = Math.min(89, Math.floor(v.lat + dLat));
    for (let r = r0; r <= r1; r++) {
      // The row's widest column span is set by its most poleward latitude.
      const maxAbs = Math.max(Math.abs(v.lat), Math.abs(r), Math.abs(r + 1));
      let c0 = 0;
      let c1 = 359;
      let whole = true;
      if (maxAbs < cfg.wholeRowLat) {
        const dLon = R / (KM_PER_DEG * Math.cos(maxAbs * D2R));
        const a = Math.floor(v.lon - dLon);
        const b = Math.floor(v.lon + dLon);
        if (b - a < 359) {
          c0 = a;
          c1 = b;
          whole = false;
        }
      }
      const base = (r + 90) * 360;
      for (let c = c0; c <= c1; c++) {
        const set = grid.get(base + (whole ? c : (((c + 180) % 360) + 360) % 360));
        if (!set) continue;
        for (const s of set) {
          if (s === v) continue;
          const d = distKm(v.lat, v.lon, s.lat, s.lon);
          if (d > cfg.radiusKm && !(d <= cfg.exitKm && v.known.has(s.uid))) continue;
          candP[n] = s;
          candD[n] = d;
          n++;
        }
      }
    }
    const m = Math.min(n, cfg.maxVisible);
    if (n > m) selectSmallest(n, m);
    const nearK = Math.min(m, cfg.nearMax);
    if (m > nearK) selectSmallest(m, nearK);

    const mark = ++stamp;
    v.vis.length = m;
    v.visNear.length = m;
    v.nearCount = 0;
    for (let i = 0; i < m; i++) {
      const s = candP[i];
      s.stamp = mark;
      v.vis[i] = s;
      const near = i < nearK && candD[i] * 1000 <= cfg.nearM;
      v.visNear[i] = near;
      if (near) v.nearCount++;
    }
    for (const uid of v.known.keys()) {
      const s = players.get(uid);
      if (s && s.stamp === mark) continue;
      v.known.delete(uid);
      s?.viewers.delete(v);
      v.exits.push(pilotId(uid));
    }
    for (let i = 0; i < m; i++) {
      const s = v.vis[i];
      if (v.known.has(s.uid)) continue;
      v.known.set(s.uid, 0);
      s.viewers.add(v);
      v.enters.push(s);
    }
    for (let i = 0; i < n; i++) candP[i] = null; // never pin a gone player
  }

  // ---- per-viewer send: exits, enters, ONE batch -------------------------
  function flush(v, tS, farTick) {
    for (let i = 0; i < v.exits.length; i++) v.send(`{"t":"exit","id":"${v.exits[i]}"}`);
    v.exits.length = 0;
    for (let i = 0; i < v.enters.length; i++) {
      const s = v.enters[i];
      if (s.dead || !v.known.has(s.uid)) continue;
      v.send(JSON.stringify({ t: 'enter', id: s.id, cs: s.cs, a: s.a, c: s.c }));
    }
    v.enters.length = 0;
    if (!v.visible) return;
    let k = 0;
    for (let i = 0; i < v.vis.length; i++) {
      const s = v.vis[i];
      const last = v.known.get(s.uid);
      if (last === undefined || !s.visible || s.seq <= last) continue;
      // A fresh enter gets its first record at once; then near every tick, far at 1 Hz.
      if (last !== 0 && !v.visNear[i] && !farTick) continue;
      pick[k++] = s;
    }
    if (k === 0) return;
    const u8 = new Uint8Array(HEADER_BYTES + k * RECORD_BYTES);
    writeBatchHeader(new DataView(u8.buffer), v.nearCount, k, tS);
    for (let i = 0; i < k; i++) {
      const s = pick[i];
      writeRecord(u8, i, s.uid, s.flags, s.warpSeq, tsDiff(tS, s.ts), s.pose);
    }
    // The relay skips a batch under backpressure (send -> false): state is
    // latest-wins, so nothing is marked sent and the next tick carries it.
    if (v.send(u8) !== false) {
      for (let i = 0; i < k; i++) v.known.set(pick[i].uid, pick[i].seq);
      counts.batches++;
      counts.records += k;
    }
    for (let i = 0; i < k; i++) pick[i] = null;
  }

  function tick() {
    const t = clock();
    tickNo++;
    for (const p of players.values()) {
      if (!p.helloed) {
        if (t - p.connectedAt > cfg.helloTimeoutMs) kill(p, CLOSE.POLICY, 'hello');
        continue;
      }
      const quietSince = p.hasState ? p.lastStateAt : p.connectedAt;
      if ((p.heldSince !== 0 && t - p.heldSince > cfg.idleCloseMs) || t - quietSince > cfg.idleCloseMs) {
        kill(p, CLOSE.IDLE, 'idle');
        continue;
      }
      if (p.visible && !present(p, t)) hide(p, 'away');
    }
    const recompute = tickNo % cfg.interestEvery === 0;
    const tS = Math.floor(t) >>> 0;
    for (const v of players.values()) {
      if (!v.helloed) continue;
      if (recompute && v.visible) computeInterest(v);
      flush(v, tS, (tickNo + v.uid) % cfg.tickHz === 0);
    }
  }

  // ---- where: 2° cells of visible pilots, on demand ----------------------
  // The cached JSON is left OPEN (no closing brace): each reply appends the
  // asker's own `me`. p.whereCell is the cell this build counted p in.
  function whereSummary(t) {
    if (whereCache !== null && t - whereAt < cfg.whereRebuildMs) return whereCache;
    const cells = new Map();
    for (const p of players.values()) {
      p.whereCell = null;
      if (!p.visible) continue;
      const key = Math.floor((p.lat + 90) / 2) * 180 + (Math.floor((p.lon + 180) / 2) % 180);
      p.whereCell = key;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { key, lat: 0, lon: 0, alts: [] }));
      c.lat += p.lat;
      c.lon += p.lon;
      c.alts.push(p.alt);
    }
    const r1 = (x) => Math.round(x * 10) / 10;
    const top = [...cells.values()]
      .sort((a, b) => b.alts.length - a.alts.length || a.key - b.key)
      .slice(0, cfg.whereTop)
      .map((c) => {
        const n = c.alts.length;
        c.alts.sort((x, y) => x - y);
        const med = n % 2 ? c.alts[n >> 1] : (c.alts[n / 2 - 1] + c.alts[n / 2]) / 2;
        return [c.key, r1(c.lat / n), r1(c.lon / n), n, Math.round(med / 100) * 100];
      });
    whereCache = JSON.stringify({ t: 'where', c: top }).slice(0, -1);
    whereAt = t;
    return whereCache;
  }

  function stats() {
    return { conns: players.size, online, visible, ticks: tickNo, ...counts };
  }

  return { cfg, connect, onText, onBinary, disconnect, tick, stats };
}
