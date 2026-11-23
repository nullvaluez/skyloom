/**
 * HORIZON FILL (FLY_HORIZON_FILL.md) stream C: the persistent stand-in bundle
 * cache. A built 'sat-skyline' stand-in result is stored in the Cache API, so a
 * revisited city refills without fetching, parsing or admitting its 384 vector
 * tiles again. Used by vector-tile.worker.js only while the build request
 * carries `horizonFill.bundleCache === true` (the worker never reads a flag).
 *
 * KEY. The tileset identity (the resolved tiles URL template, which carries
 * OpenFreeMap's dated planet build), z/x/y, the detail, WORKER_PROTOCOL, the
 * canonical JSON of the WHOLE build request (sorted keys, so the World Pass
 * key, the reach tunables and the census switch are all in it), BUNDLE_SCHEMA
 * and the build identity (NEXT_PUBLIC_BUILD_STAMP, else NEXT_PUBLIC_BUILD_SHA, when the bundler inlines it).
 * The full key text is stored in the entry and compared on read, so a hash
 * collision is a miss, never a wrong bundle.
 *
 * CONTAINER. 'HFB1', u32 header length, a JSON header (the result with every
 * typed array replaced by a reference, plus the arrays' types, offsets and
 * lengths), then the array bytes, each 8-byte aligned. Decoding gives every
 * array its own ArrayBuffer, so the result is transferable exactly like a
 * fresh build. Non-JSON scalars (NaN, +-Infinity, -0, undefined) round-trip.
 *
 * STORE. One entry per bundle at https://hf-bundle.invalid/<hash>?b=<bytes>, so
 * the store's own key list carries every entry's size, plus a small index entry
 * (hash -> last use) for LRU order. Several skyline workers share the store;
 * each keeps the index in memory, re-reads the key list before it trims, and
 * merges its last-use times into the index entry (the latest time wins). Over
 * maxEntries or maxBytes the least recently used go first. With `caches`
 * missing, or a full quota, every call quietly does nothing.
 *
 * What is never stored: failures (they throw before a result exists), 'no-data'
 * results, results without a reason tag, results carrying the diagnostic stage
 * counters (`wpStages`), and results the caller marks unstable.
 */

/** Bump when the container or the key text changes shape. */
export const BUNDLE_SCHEMA = 1;

/** Defaults; equal to HORIZON_FILL.stream (the engine sends its copy with setBundleCache). */
export const BUNDLE_DEFAULTS = Object.freeze({
  name: 'fly-horizon-fill-bundles-v1',
  maxEntries: 1600,
  maxBytes: 96 * 1024 * 1024,
});

const ORIGIN = 'https://hf-bundle.invalid/';
const INDEX_URL = `${ORIGIN}index`;
const MAGIC = 0x31424648; // 'HFB1' little endian

/** The build identity the bundler inlines into the worker, or ''. */
export function buildIdentity() {
  let sha = '';
  try {
    // The stamp also changes for uncommitted edits (next.config.mjs buildStamp).
    sha = process.env.NEXT_PUBLIC_BUILD_STAMP || process.env.NEXT_PUBLIC_BUILD_SHA || '';
  } catch {
    sha = '';
  }
  return `s${BUNDLE_SCHEMA}-${sha}`;
}

/** Canonical JSON: object keys sorted at every level; typed arrays as their type and contents. */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) return JSON.stringify(String(v));
    return v === undefined ? 'null' : JSON.stringify(v);
  }
  if (ArrayBuffer.isView(v)) return `{"$ta":"${v.constructor.name}","v":[${Array.from(v).join(',')}]}`;
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}

/** Two independent 32-bit FNV-1a variants over the UTF-16 units: a 64-bit hex id. */
export function hash64(s) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** The full key text of one bundle. */
export function bundleKey({ template, z, x, y, detail, protocol, options, build = buildIdentity() }) {
  return `${template}|${z}/${x}/${y}|${detail}|p${protocol}|${build}|${canonicalJson(options ?? {})}`;
}

/** May this result be stored? See the header for the list. */
export function bundleCacheable(r) {
  if (!r || typeof r !== 'object' || r.wpStages) return false;
  if (r.empty === true) return r.reason === 'zero';
  return !!(r.satStandIns && r.satStandIns.n > 0);
}

const TYPED = {
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
};

/** Encode a result into one ArrayBuffer (a copy: the result's own buffers are untouched). */
export function encodeBundle(result, keyText = '') {
  const arrays = [];
  const header = JSON.stringify({ k: keyText, r: result }, function replacer(k, v) {
    const raw = this[k];
    if (ArrayBuffer.isView(raw)) {
      if (!TYPED[raw.constructor.name]) throw new Error('bundle-cache: unsupported array');
      arrays.push(raw);
      return { $ta: arrays.length - 1 };
    }
    if (typeof raw === 'number') {
      if (Number.isNaN(raw)) return { $n: 'NaN' };
      if (raw === Infinity) return { $n: 'Inf' };
      if (raw === -Infinity) return { $n: '-Inf' };
      if (Object.is(raw, -0)) return { $n: '-0' };
    }
    if (raw === undefined && k !== '') return { $u: 1 };
    return v;
  });
  const meta = [];
  let off = 0;
  for (const a of arrays) {
    off = (off + 7) & ~7;
    meta.push([a.constructor.name, off, a.length]);
    off += a.byteLength;
  }
  const head = new TextEncoder().encode(JSON.stringify({ a: meta, h: header }));
  const base = (8 + head.length + 7) & ~7;
  const buf = new ArrayBuffer(base + off);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, head.length, true);
  new Uint8Array(buf, 8, head.length).set(head);
  arrays.forEach((a, i) => {
    new Uint8Array(buf, base + meta[i][1], a.byteLength).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  });
  return buf;
}

/** Decode -> { key, result, transfer } or null for anything malformed. */
export function decodeBundle(buf) {
  try {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 8) return null;
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== MAGIC) return null;
    const hl = dv.getUint32(4, true);
    const outer = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    const base = (8 + hl + 7) & ~7;
    const arrays = outer.a.map(([name, off, len]) => {
      const C = TYPED[name];
      const bytes = len * C.BYTES_PER_ELEMENT;
      if (base + off + bytes > buf.byteLength) throw new Error('short');
      return new C(buf.slice(base + off, base + off + bytes));
    });
    const doc = JSON.parse(outer.h, (k, v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (typeof v.$ta === 'number' && Object.keys(v).length === 1) return arrays[v.$ta];
        if (typeof v.$n === 'string' && Object.keys(v).length === 1) return v.$n === 'NaN' ? NaN : v.$n === 'Inf' ? Infinity : v.$n === '-Inf' ? -Infinity : -0;
      }
      return v;
    });
    restoreUndefined(doc);
    return { key: doc.k, result: doc.r, transfer: arrays.map((a) => a.buffer) };
  } catch {
    return null;
  }
}

function restoreUndefined(o) {
  if (!o || typeof o !== 'object' || ArrayBuffer.isView(o)) return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && v.$u === 1 && Object.keys(v).length === 1) o[k] = undefined;
    else restoreUndefined(v);
  }
}

/**
 * One cache handle per worker.
 *   get(keyText) -> { result, transfer } | null
 *   put(keyText, result) -> Promise<boolean>   (encodes synchronously, before any await)
 *   stats  { hits, misses, puts, evictions, failed, bytes, entries }
 * @param cfg  { name, maxEntries, maxBytes, caches? (a CacheStorage; default globalThis.caches), now? }
 */
export function createBundleCache(cfg = {}) {
  const name = typeof cfg.name === 'string' && cfg.name ? cfg.name : BUNDLE_DEFAULTS.name;
  const maxEntries = Number.isFinite(cfg.maxEntries) ? Math.max(1, cfg.maxEntries | 0) : BUNDLE_DEFAULTS.maxEntries;
  const maxBytes = Number.isFinite(cfg.maxBytes) ? Math.max(1, cfg.maxBytes) : BUNDLE_DEFAULTS.maxBytes;
  const storage = cfg.caches !== undefined ? cfg.caches : typeof caches === 'undefined' ? null : caches;
  const now = typeof cfg.now === 'function' ? cfg.now : () => Date.now();
  const stats = { hits: 0, misses: 0, puts: 0, evictions: 0, failed: 0, bytes: 0, entries: 0 };
  const lastUse = new Map(); // hash -> ms
  let open;
  let dirty = false;
  let indexTimer = null;
  let chain = Promise.resolve(); // puts and trims run one at a time per worker

  function store() {
    if (open !== undefined) return open;
    open = (async () => {
      if (!storage || typeof storage.open !== 'function') return null;
      const c = await storage.open(name);
      try {
        const res = await c.match(INDEX_URL);
        const idx = res ? await res.json() : null;
        if (idx && typeof idx === 'object') for (const [h, t] of Object.entries(idx)) if (Number.isFinite(t)) lastUse.set(h, t);
      } catch {
        /* no index yet */
      }
      return c;
    })().catch(() => null);
    return open;
  }

  const urlOf = (h, bytes) => `${ORIGIN}${h}?b=${bytes}`;

  function scheduleIndex() {
    dirty = true;
    if (indexTimer !== null) return;
    indexTimer = setTimeout(() => {
      indexTimer = null;
      chain = chain.then(writeIndex, writeIndex);
    }, 2000);
  }

  async function writeIndex() {
    if (!dirty) return;
    dirty = false;
    try {
      const c = await store();
      if (!c) return;
      let merged = {};
      try {
        const res = await c.match(INDEX_URL);
        if (res) merged = (await res.json()) || {};
      } catch {
        merged = {};
      }
      const live = new Set((await c.keys()).map((r) => entryOf(r.url)).filter(Boolean).map((e) => e.h));
      const out = {};
      for (const h of live) {
        const t = Math.max(Number(merged[h]) || 0, lastUse.get(h) || 0);
        if (t) out[h] = t;
      }
      await c.put(INDEX_URL, new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } }));
    } catch {
      /* best effort */
    }
  }

  async function trim(c) {
    const reqs = await c.keys();
    const entries = [];
    let bytes = 0;
    let order = 0;
    for (const r of reqs) {
      const e = entryOf(r.url);
      if (!e) continue;
      e.url = r.url;
      e.t = lastUse.get(e.h) ?? 0;
      e.order = order++;
      entries.push(e);
      bytes += e.b;
    }
    if (entries.length > maxEntries || bytes > maxBytes) {
      entries.sort((p, q) => p.t - q.t || p.order - q.order);
      let n = entries.length;
      for (const e of entries) {
        if (n <= maxEntries && bytes <= maxBytes) break;
        try {
          await c.delete(e.url);
        } catch {
          /* best effort */
        }
        lastUse.delete(e.h);
        n -= 1;
        bytes -= e.b;
        stats.evictions += 1;
      }
      entries.length = n;
      scheduleIndex();
      stats.entries = n;
    } else {
      stats.entries = entries.length;
    }
    stats.bytes = bytes;
  }

  async function get(keyText) {
    const h = hash64(keyText);
    try {
      const c = await store();
      if (!c) {
        stats.misses += 1;
        return null;
      }
      const res = await c.match(`${ORIGIN}${h}`, { ignoreSearch: true });
      if (!res) {
        stats.misses += 1;
        return null;
      }
      const d = decodeBundle(await res.arrayBuffer());
      if (!d || d.key !== keyText) {
        stats.misses += 1;
        return null;
      }
      lastUse.set(h, now());
      scheduleIndex();
      stats.hits += 1;
      return { result: d.result, transfer: d.transfer };
    } catch {
      stats.misses += 1;
      return null;
    }
  }

  function put(keyText, result) {
    let buf;
    try {
      buf = encodeBundle(result, keyText);
    } catch {
      stats.failed += 1;
      return Promise.resolve(false);
    }
    const h = hash64(keyText);
    const run = async () => {
      try {
        const c = await store();
        if (!c) return false;
        // One entry per hash: drop an older size variant first.
        for (const r of await c.keys(`${ORIGIN}${h}`, { ignoreSearch: true })) await c.delete(r.url ?? r);
        await c.put(urlOf(h, buf.byteLength), new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
        lastUse.set(h, now());
        stats.puts += 1;
        await trim(c);
        scheduleIndex();
        return true;
      } catch {
        stats.failed += 1;
        return false;
      }
    };
    const p = chain.then(run, run);
    chain = p.then(
      () => {},
      () => {}
    );
    return p;
  }

  /** Wait for queued puts and the index write (gates). */
  async function flush() {
    if (indexTimer !== null) {
      clearTimeout(indexTimer);
      indexTimer = null;
      chain = chain.then(writeIndex, writeIndex);
    }
    await chain;
  }

  return { get, put, flush, stats, name, maxEntries, maxBytes };
}

function entryOf(url) {
  const s = String(url);
  if (!s.startsWith(ORIGIN)) return null;
  const m = /^([0-9a-f]{16})\?b=(\d+)$/.exec(s.slice(ORIGIN.length));
  return m ? { h: m[1], b: Number(m[2]) } : null;
}
