/**
 * MULTIPLAYER relay — all the I/O (MULTIPLAYER.md §Relay). Keyless, no disk,
 * no database: a node:http server with a /healthz, and a `ws` WebSocketServer
 * on MP_PATH whose world (server/mp-world.mjs) lives in memory only.
 *
 *   node server/mp-relay.mjs          (npm run mp)
 *
 * Before a socket exists, an upgrade is refused with an HTTP status:
 *   wrong path 404 · Origin not allowed 403 · per-IP-key or connect-rate cap 429.
 * Before a request exists, an untrusted peer holds at most 2 × MP_MAX_PER_IP
 * TCP connections (its /48 2 × 24), and unfinished headers time out in 5 s.
 * After accept (a browser cannot read an upgrade's status):
 *   global cap -> {t:'err',code:'full'} + 4001 · bad ?v= -> {t:'err',code:'version'} + 4002.
 * Per socket: a 20 msg/s token bucket (burst 40; > 300 drops in 10 s -> 1008),
 * binary must be exactly one STATE, text a short JSON of a known type, 20 s of
 * silence -> terminate, a batch is skipped above 64 KB buffered and the socket
 * terminated after 10 s above 1 MB.
 *
 * IP addresses are only ever in-memory cap keys: never logged, never stored.
 * The log is one aggregate line a minute plus a start and a stop line.
 *
 * ENV (none are secrets; startRelay(opts) overrides each):
 *   MP_HOST (127.0.0.1)  MP_PORT (8787)  MP_PATH (/mp)
 *   MP_ORIGINS           comma list; exact origins or a '*' in the leftmost host
 *                        label (https://*--site.netlify.app); a ':*' port = any.
 *                        Unset -> http://localhost:* and http://127.0.0.1:* only.
 *   MP_ALLOW_NO_ORIGIN   '1' admits an upgrade without an Origin header
 *   MP_TRUST_PROXY       loopback (default) | CIDR list | all
 *   MP_CLIENT_IP_HEADER  x-forwarded-for (default) | fly-client-ip | cf-connecting-ip | x-real-ip
 *   MP_MAX_PLAYERS (500) MP_MAX_PER_IP (6) MP_CONNECT_PER_MIN (20)
 *   MP_TICK_HZ (10)      MP_RADIUS_KM (150)
 * A value out of range, or an MP_ORIGINS / MP_TRUST_PROXY list with no valid
 * entry, refuses to start; an invalid list entry is skipped with a warning.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createWorld } from './mp-world.mjs';
import { ACCEPT, CLOSE, MAX_TEXT, PROTOCOL, STATE_BYTES } from '../lib/fly/mp/protocol.mjs';

const RELAY_DEFAULTS = {
  host: '127.0.0.1',
  port: 8787,
  path: '/mp',
  origins: null,
  allowNoOrigin: false,
  trustProxy: 'loopback',
  clientIpHeader: 'x-forwarded-for',
  maxPlayers: 500,
  maxPerIp: 6,
  maxPer48: 24, // IPv6 aggregate per /48
  maxConnPerIp: null, // raw TCP per untrusted peer key (null -> 2 × maxPerIp; its /48: 2 × maxPer48)
  connectPerMin: 20,
  tickHz: 10,
  radiusKm: 150,
  msgRate: 20,
  msgBurst: 40,
  dropCloseCount: 300,
  dropWindowMs: 10000,
  liveMs: 20000, // no message at all for this long -> terminate
  bufSkip: 64 * 1024,
  bufKill: 1024 * 1024,
  bufKillMs: 10000,
  headersTimeoutMs: 5000,
  connCheckMs: 1000, // how often node enforces headersTimeout (its default, 30 s, is no bound)
  logEveryMs: 60000,
  shutdownMs: 1000,
};

const ENV = {
  host: ['MP_HOST', String],
  port: ['MP_PORT', Number],
  path: ['MP_PATH', String],
  origins: ['MP_ORIGINS', String],
  allowNoOrigin: ['MP_ALLOW_NO_ORIGIN', (v) => v === '1' || v === 'true'],
  trustProxy: ['MP_TRUST_PROXY', String],
  clientIpHeader: ['MP_CLIENT_IP_HEADER', (v) => v.toLowerCase()],
  maxPlayers: ['MP_MAX_PLAYERS', Number],
  maxPerIp: ['MP_MAX_PER_IP', Number],
  connectPerMin: ['MP_CONNECT_PER_MIN', Number],
  tickHz: ['MP_TICK_HZ', Number],
  radiusKm: ['MP_RADIUS_KM', Number],
};

// Integer knobs and their sane ranges; anything else refuses to start (a
// tickHz of 0 is a busy loop with a dead far tier, a cap of 0 a closed relay).
const INT_RANGE = {
  port: [0, 65535],
  maxPlayers: [1, 100000],
  maxPerIp: [1, 100000],
  maxPer48: [1, 100000],
  connectPerMin: [1, 100000],
  tickHz: [1, 60],
};

function resolveConfig(opts, env) {
  const cfg = { ...RELAY_DEFAULTS };
  for (const [k, [name, parse]] of Object.entries(ENV)) {
    const raw = env[name];
    if (raw == null || raw === '') continue;
    cfg[k] = parse(raw);
  }
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) cfg[k] = v;
  const bad = (k, want) => new Error(`mp config: ${ENV[k]?.[0] ?? k} must be ${want}`);
  for (const [k, [lo, hi]] of Object.entries(INT_RANGE)) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < lo || cfg[k] > hi) throw bad(k, `an integer in [${lo}, ${hi}]`);
  }
  if (!(cfg.radiusKm > 0 && cfg.radiusKm <= 1000)) throw bad('radiusKm', 'a number in (0, 1000]');
  cfg.maxConnPerIp ??= 2 * cfg.maxPerIp;
  if (!Number.isInteger(cfg.maxConnPerIp) || cfg.maxConnPerIp < 1) throw bad('maxConnPerIp', 'a positive integer');
  return cfg;
}

// ---- IP parsing and keys ---------------------------------------------------

/** Parse an address to {v:4|6, b:bytes}; IPv4-mapped IPv6 becomes IPv4. null when invalid. */
function parseIp(addr) {
  if (typeof addr !== 'string') return null;
  let a = addr.trim();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (net.isIPv4(a)) return { v: 4, b: a.split('.').map(Number) };
  if (!net.isIPv6(a)) return null;
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (v4) {
    const o = v4[2].split('.').map(Number);
    a = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? null : tail ? tail.split(':') : [];
  const words = t === null ? h : [...h, ...new Array(8 - h.length - t.length).fill('0'), ...t];
  const w = words.map((x) => parseInt(x, 16));
  if (w.length !== 8 || w.some((x) => !(x >= 0 && x <= 0xffff))) return null;
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0xffff)
    return { v: 4, b: [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255] };
  const b = [];
  for (const x of w) b.push(x >> 8, x & 255);
  return { v: 6, b };
}

const hex4 = (b, i) => ((b[i] << 8) | b[i + 1]).toString(16);
const isLoopback = (ip) =>
  !!ip && (ip.v === 4 ? ip.b[0] === 127 : ip.b.slice(0, 15).every((x) => x === 0) && ip.b[15] === 1);

/**
 * Cap keys for an address: IPv4 by address; IPv6 by /56 (`key`) plus its /48
 * (`agg`, the aggregate cap). Keys are in-memory only and never logged.
 */
export function ipKeys(addr) {
  const ip = parseIp(addr);
  if (!ip) return { ip: '', key: 'unknown', agg: null, loopback: false };
  if (ip.v === 4) {
    const s = ip.b.join('.');
    return { ip: s, key: s, agg: null, loopback: isLoopback(ip) };
  }
  const b = ip.b;
  const w48 = `${hex4(b, 0)}:${hex4(b, 2)}:${hex4(b, 4)}`;
  return {
    ip: addr,
    key: `${w48}:${(b[6] << 8).toString(16)}::/56`,
    agg: `${w48}::/48`,
    loopback: isLoopback(ip),
  };
}

/**
 * A predicate "is this peer a trusted proxy": 'loopback' | 'all' | 'cidr,cidr,…'.
 * A list predicate carries `bad` (1-based positions of entries that did not
 * parse, which are skipped) and `size` (entries that did).
 */
export function makeTrust(spec) {
  const s = String(spec ?? 'loopback').trim().toLowerCase();
  if (s === 'all') return () => true;
  if (s === '' || s === 'loopback') return (addr) => isLoopback(parseIp(addr));
  const nets = [];
  const bad = [];
  s.split(',').forEach((x, i) => {
    const cidr = x.trim();
    if (!cidr) return;
    if (cidr === 'loopback') return void nets.push('loopback');
    const parts = cidr.split('/');
    const ip = parts.length <= 2 ? parseIp(parts[0]) : null;
    const max = ip?.v === 4 ? 32 : 128;
    const n = parts[1] === undefined ? max : /^\d+$/.test(parts[1]) ? Number(parts[1]) : NaN;
    if (ip && n <= max) nets.push({ ...ip, n });
    else bad.push(i + 1);
  });
  const trust = (addr) => {
    const ip = parseIp(addr);
    if (!ip) return false;
    return nets.some((m) => {
      if (m === 'loopback') return isLoopback(ip);
      if (m.v !== ip.v) return false;
      for (let bit = 0; bit < m.n; bit += 8) {
        const left = Math.min(8, m.n - bit);
        const mask = (0xff << (8 - left)) & 0xff;
        if ((m.b[bit >> 3] & mask) !== (ip.b[bit >> 3] & mask)) return false;
      }
      return true;
    });
  };
  trust.bad = bad;
  trust.size = nets.length;
  return trust;
}

/**
 * The client address of a request. The header is read only when the peer is
 * a trusted proxy. X-Forwarded-For is walked right to left to the first
 * untrusted entry ('all': the right-most entry the edge appended).
 */
export function clientIp(peer, headers, trust, headerName = 'x-forwarded-for', trustAll = false) {
  if (!trust(peer)) return peer;
  const raw = headers[headerName];
  if (!raw) return peer;
  const list = String(raw)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!list.length) return peer;
  if (headerName !== 'x-forwarded-for' || trustAll) return parseIp(list[list.length - 1]) ? list[list.length - 1] : peer;
  for (let i = list.length - 1; i >= 0; i--) {
    if (!parseIp(list[i])) return peer; // a malformed hop: fall back to the socket
    if (!trust(list[i])) return list[i];
  }
  return list[0];
}

// ---- Origin ----------------------------------------------------------------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An Origin predicate carrying `bad` (1-based positions of entries that do not parse, skipped) and `size`. */
function originMatcher(list) {
  const res = [];
  const bad = [];
  for (const [i, raw] of list.entries()) {
    if (!String(raw).trim()) continue;
    const m = /^(https?):\/\/([^/:]+)(?::(\d+|\*))?\/?$/i.exec(String(raw).trim());
    const labels = m ? m[2].toLowerCase().split('.') : [];
    // '*' only in the leftmost label
    if (!m || labels.slice(1).some((l) => l.includes('*'))) {
      bad.push(i + 1);
      continue;
    }
    const first = labels[0].split('*').map(escapeRe).join('[a-z0-9-]+');
    const host = [first, ...labels.slice(1).map(escapeRe)].join('\\.');
    const port = m[3] === '*' ? '(?::\\d+)?' : m[3] ? `:${m[3]}` : '';
    res.push(new RegExp(`^${m[1].toLowerCase()}://${host}${port}$`));
  }
  const ok = (origin) => typeof origin === 'string' && res.some((r) => r.test(origin.toLowerCase()));
  ok.bad = bad;
  ok.size = res.length;
  return ok;
}

// ---- the relay -------------------------------------------------------------
function abort(socket, code) {
  socket.once('finish', socket.destroy);
  socket.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Start a relay. Resolves {port, close(), world}. opts override env; port 0 = ephemeral; opts.log captures log lines. */
export async function startRelay(opts = {}) {
  const cfg = resolveConfig(opts, opts.env ?? process.env);
  const log = typeof cfg.log === 'function' ? cfg.log : (line) => console.log(line);
  const now = () => performance.now();
  const startedAt = now();
  // Config warnings name list positions only: entries may hold addresses.
  const warns = [];
  const originsList =
    cfg.origins == null ? null : Array.isArray(cfg.origins) ? cfg.origins : String(cfg.origins).split(',');
  const originOk = originMatcher(originsList ?? ['http://localhost:*', 'http://127.0.0.1:*']);
  if (originsList == null) warns.push('mp warn MP_ORIGINS unset: only localhost origins (any port) may connect');
  else if (!originOk.size) throw new Error('mp config: MP_ORIGINS has no valid entry (scheme://host[:port])');
  else if (originOk.bad.length) warns.push(`mp warn MP_ORIGINS entries #${originOk.bad.join(',#')} ignored: not scheme://host[:port]`);
  const trust = makeTrust(cfg.trustProxy);
  const trustSpec = String(cfg.trustProxy ?? '').trim().toLowerCase();
  const trustAll = trustSpec === 'all';
  // Logged as a mode only: a CIDR list is never printed (no addresses in the log).
  const trustMode = trustAll ? 'all' : trustSpec === '' || trustSpec === 'loopback' ? 'loopback' : 'list';
  if (trustMode === 'list') {
    if (!trust.size) throw new Error('mp config: MP_TRUST_PROXY has no valid entry (loopback | all | comma-separated CIDRs)');
    if (trust.bad.length) warns.push(`mp warn MP_TRUST_PROXY entries #${trust.bad.join(',#')} ignored: not a CIDR`);
  }
  const world = createWorld({ ...opts, tickHz: cfg.tickHz, radiusKm: cfg.radiusKm }, { now });

  const live = new Set(); // accepted connections
  const perKey = new Map(); // ip key -> live sockets
  const perAgg = new Map(); // IPv6 /48 -> live sockets
  const rate = new Map(); // ip key -> connect token bucket
  const rawPer = new Map(); // untrusted peer key -> open TCP connections
  const rawAgg = new Map(); // untrusted peer IPv6 /48 -> open TCP connections
  const tries = new Map(); // ip key -> upgrade attempts this log window (for sharedKeyWarn)
  let triesTotal = 0;
  const c = {
    in: 0,
    out: 0,
    bytesOut: 0,
    skip: 0,
    dropRate: 0,
    dropSize: 0,
    reject: { path: 0, origin: 0, ip: 0, full: 0, version: 0, conn: 0 },
    wsErr: 0,
    err: 0,
  };
  let closing = false;
  let lastErrLog = -Infinity;
  const fail = (e) => {
    c.err++;
    if (now() - lastErrLog > 60000) {
      lastErrLog = now();
      log(`mp error ${e?.message ?? e}`);
    }
  };
  const bump = (map, k, d) => {
    if (k == null) return;
    const n = (map.get(k) ?? 0) + d;
    if (n > 0) map.set(k, n);
    else map.delete(k);
  };

  function admit(keys) {
    if ((perKey.get(keys.key) ?? 0) >= cfg.maxPerIp) return false;
    if (keys.agg != null && (perAgg.get(keys.agg) ?? 0) >= cfg.maxPer48) return false;
    const t = now();
    const b = rate.get(keys.key) ?? { tokens: cfg.connectPerMin, at: t };
    b.tokens = Math.min(cfg.connectPerMin, b.tokens + ((t - b.at) * cfg.connectPerMin) / 60000);
    b.at = t;
    if (b.tokens < 1) {
      rate.set(keys.key, b);
      return false;
    }
    b.tokens -= 1;
    rate.set(keys.key, b);
    return true;
  }

  const server = http.createServer({ connectionsCheckingInterval: cfg.connCheckMs }, (req, res) => {
    const p = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && (p === '/healthz' || p === `${cfg.path}/healthz`)) {
      const s = world.stats();
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(
        JSON.stringify({
          ok: !closing,
          v: PROTOCOL,
          online: s.online,
          visible: s.visible,
          conns: live.size,
          uptimeS: Math.round((now() - startedAt) / 1000),
        })
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end('not found\n');
  });
  server.headersTimeout = cfg.headersTimeoutMs;
  server.requestTimeout = cfg.headersTimeoutMs;
  server.maxConnections = cfg.maxPlayers + 64;

  // One untrusted address cannot fill maxConnections with idle or half-sent
  // requests (the per-IP caps only run at upgrade). A trusted proxy is exempt:
  // every player behind it shares its address, and it forwards whole requests.
  server.on('connection', (socket) => {
    const peer = socket.remoteAddress;
    if (trust(peer)) return;
    const k = ipKeys(peer);
    if ((rawPer.get(k.key) ?? 0) >= cfg.maxConnPerIp || (k.agg != null && (rawAgg.get(k.agg) ?? 0) >= 2 * cfg.maxPer48)) {
      c.reject.conn++;
      socket.destroy();
      return;
    }
    bump(rawPer, k.key, 1);
    bump(rawAgg, k.agg, 1);
    socket.once('close', () => {
      bump(rawPer, k.key, -1);
      bump(rawAgg, k.agg, -1);
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 512, perMessageDeflate: false, clientTracking: false });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => c.wsErr++);
    if (closing) return abort(socket, 503);
    let url;
    try {
      url = new URL(req.url ?? '', 'http://relay');
    } catch {
      return abort(socket, 400);
    }
    if (url.pathname !== cfg.path) {
      c.reject.path++;
      return abort(socket, 404);
    }
    const origin = req.headers.origin;
    if (origin === undefined ? !cfg.allowNoOrigin : !originOk(origin)) {
      c.reject.origin++;
      return abort(socket, 403);
    }
    const keys = ipKeys(clientIp(socket.remoteAddress, req.headers, trust, cfg.clientIpHeader, trustAll));
    triesTotal++;
    if (tries.has(keys.key) || tries.size < 4096) bump(tries, keys.key, 1);
    if (!admit(keys)) {
      c.reject.ip++;
      return abort(socket, 429);
    }
    const v = Number(url.searchParams.get('v'));
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, keys, v));
  });

  function accept(ws, keys, v) {
    bump(perKey, keys.key, 1);
    bump(perAgg, keys.agg, 1);
    const conn = { ws, keys, p: null, tokens: cfg.msgBurst, at: now(), drops: 0, dropAt: now(), lastMsgAt: now(), bufSince: 0 };
    live.add(conn);
    ws.on('error', () => c.wsErr++);
    ws.on('close', () => {
      live.delete(conn);
      bump(perKey, keys.key, -1);
      bump(perAgg, keys.agg, -1);
      if (conn.p) world.disconnect(conn.p);
    });
    if (world.stats().conns >= cfg.maxPlayers) {
      c.reject.full++;
      ws.send('{"t":"err","code":"full"}');
      ws.close(CLOSE.FULL, 'full');
      return;
    }
    if (!ACCEPT.includes(v)) {
      c.reject.version++;
      ws.send(JSON.stringify({ t: 'err', code: 'version', need: PROTOCOL }));
      ws.close(CLOSE.VERSION, 'version');
      return;
    }
    const send = (data) => {
      if (ws.readyState !== 1) return false;
      if (typeof data !== 'string' && ws.bufferedAmount > cfg.bufSkip) {
        c.skip++;
        return false;
      }
      ws.send(data);
      c.out++;
      c.bytesOut += typeof data === 'string' ? data.length : data.byteLength;
      return true;
    };
    conn.p = world.connect(send, (code, reason) => ws.close(code, reason));
    ws.on('message', (data, isBinary) => {
      if (closing) return;
      const t = now();
      c.in++;
      conn.lastMsgAt = t;
      conn.tokens = Math.min(cfg.msgBurst, conn.tokens + ((t - conn.at) * cfg.msgRate) / 1000);
      conn.at = t;
      if (conn.tokens < 1) {
        c.dropRate++;
        if (t - conn.dropAt > cfg.dropWindowMs) {
          conn.dropAt = t;
          conn.drops = 0;
        }
        if (++conn.drops > cfg.dropCloseCount) ws.close(CLOSE.POLICY, 'rate');
        return;
      }
      conn.tokens -= 1;
      try {
        if (isBinary) {
          if (data.length !== STATE_BYTES) c.dropSize++;
          else world.onBinary(conn.p, data);
        } else if (data.length > MAX_TEXT) c.dropSize++;
        else world.onText(conn.p, data.toString());
      } catch (e) {
        fail(e);
      }
    });
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = server.address().port;
  for (const w of warns) log(w);
  log(
    `mp relay start v=${PROTOCOL} port=${port} path=${cfg.path} tickHz=${cfg.tickHz} radiusKm=${cfg.radiusKm}` +
      ` maxPlayers=${cfg.maxPlayers} trustProxy=${trustMode}`
  );

  // Timers start only once listening: a failed listen leaves nothing running.
  const tickTimer = setInterval(() => {
    try {
      world.tick();
    } catch (e) {
      fail(e);
    }
  }, 1000 / cfg.tickHz);

  // Once a second: liveness, the backpressure kill, and the connect-rate sweep.
  const houseTimer = setInterval(() => {
    const t = now();
    for (const conn of live) {
      const { ws } = conn;
      if (t - conn.lastMsgAt > cfg.liveMs) {
        ws.terminate();
        continue;
      }
      if (ws.bufferedAmount > cfg.bufKill) {
        conn.bufSince ||= t;
        if (t - conn.bufSince > cfg.bufKillMs) ws.terminate();
      } else conn.bufSince = 0;
    }
    for (const [k, b] of rate) {
      if (b.tokens + ((t - b.at) * cfg.connectPerMin) / 60000 >= cfg.connectPerMin && !perKey.has(k)) rate.delete(k);
    }
  }, 1000);

  let last = { t: now(), in: 0, out: 0, bytesOut: 0 };
  const logLine = () => {
    const t = now();
    const s = world.stats();
    const sec = Math.max(0.001, (t - last.t) / 1000);
    // A proxy-trust misconfiguration puts every player on one key, which the
    // per-IP cap then holds to maxPerIp live sockets: so ATTEMPTS are counted
    // too (admitted + refused), and the window's counts are reset each line.
    let maxShare = 0;
    for (const n of perKey.values()) maxShare = Math.max(maxShare, n);
    let maxTries = 0;
    for (const n of tries.values()) maxTries = Math.max(maxTries, n);
    const shared =
      (live.size >= 10 && maxShare > 0.8 * live.size) || (triesTotal >= 10 && maxTries > 0.8 * triesTotal) ? 1 : 0;
    tries.clear();
    triesTotal = 0;
    const r = c.reject;
    log(
      `mp online=${s.online} conns=${live.size} visible=${s.visible}` +
        ` in/s=${((c.in - last.in) / sec).toFixed(1)} out/s=${((c.out - last.out) / sec).toFixed(1)}` +
        ` kbOut/s=${((c.bytesOut - last.bytesOut) / 1024 / sec).toFixed(2)}` +
        ` drop{rate=${c.dropRate},invalid=${s.invalid + c.dropSize},teleport=${s.teleport},text=${s.text},where=${s.where},skip=${c.skip}}` +
        ` reject{origin=${r.origin},ip=${r.ip},full=${r.full},version=${r.version},path=${r.path},conn=${r.conn}}` +
        ` err=${c.err} sharedKeyWarn=${shared}`
    );
    last = { t, in: c.in, out: c.out, bytesOut: c.bytesOut };
  };
  const logTimer = setInterval(logLine, cfg.logEveryMs);

  let closed = null;
  function close() {
    closed ??= (async () => {
      closing = true;
      clearInterval(tickTimer);
      clearInterval(houseTimer);
      clearInterval(logTimer);
      server.close();
      for (const { ws } of live) {
        try {
          if (ws.readyState === 1) ws.send('{"t":"bye"}');
          ws.close(CLOSE.RESTART, 'restart');
        } catch (e) {
          fail(e);
        }
      }
      const deadline = now() + cfg.shutdownMs;
      while (live.size && now() < deadline) await new Promise((r) => setTimeout(r, 20));
      for (const { ws } of live) ws.terminate();
      server.closeAllConnections?.();
      logLine();
      log(`mp relay stop uptimeS=${Math.round((now() - startedAt) / 1000)}`);
    })();
    return closed;
  }

  return { port, close, world };
}

// Auto-start only when run directly (`node server/mp-relay.mjs`), never on
// import. Realpaths on both sides: node gives a symlinked main (a
// /srv/app/current -> releases/N layout) its real path in import.meta.url.
function isMain() {
  try {
    return !!process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMain()) {
  const relay = await startRelay();
  const stop = () => relay.close().then(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
