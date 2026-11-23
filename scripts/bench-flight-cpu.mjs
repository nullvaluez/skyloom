/**
 * FRAME LEAN, stream M (FLY_HORIZON_FILL.md, "Second round"): a headless
 * flight of the REAL satellite streaming engines, timing their main-thread
 * work frame by frame.
 *
 *   node scripts/bench-flight-cpu.mjs --arm on  --label m-on
 *   node scripts/bench-flight-cpu.mjs --arm off --label m-off
 *   node scripts/bench-flight-cpu.mjs --compare m-off m-on
 *
 * WHAT RUNS. The building, skyline (World Pass stand-ins, the request as it
 * ships at desktop High), vegetation, road and clutter engines, constructed
 * and configured the way their layers do it (SatBuildingLayer,
 * SatSkylineLayer, SatVegLayer, SatRoadLayer, SatClutterLayer), stepped at a
 * fixed 60 Hz in the layers' frame order (-47 buildings, -46 roads, -45
 * skyline and vegetation, clutter). No renderer: geometry, materials and
 * uploads are prepared exactly as in the app and never drawn.
 *
 * THE ROUTE (default `owner`): the owner's Argenteuil leg, 48.889 N 2.246 E,
 * heading 037 true, 399 kt, 2,072 ft MSL. The aircraft is parked at the start
 * until every engine's queue has drained (or `--settle-max` seconds), then flies
 * `--seconds` (default 60) of measured flight, then parks again at the end and
 * settles (`--tail-max`) for the final-state hash.
 *
 * THE WORKER. The real vector-tile worker (lib/fly/toy-world/vector-tile.worker.js)
 * runs in node worker_threads (comlink stubbed), so its parsing and garbage
 * never touch the measured isolate. WHEN a result reaches the engines is a
 * deterministic model, not the threads' speed: every engine has its own pool
 * of N model workers (the layers' pool sizes); a request starts when its model
 * worker is free and finishes `fetchMs + 10 ms + bytes / 60 KB per ms` later
 * (virtual time). Results are released at frame boundaries, so a frame sees
 * them in bursts, as a browser does when several messages queue behind one
 * frame. The main thread waits (off the clock) for a thread that is late.
 * Timers (`setTimeout`) run on the same virtual clock.
 *
 * THE TILES. Real OpenFreeMap tiles (and the TileJSON, pinned) are fetched
 * once into .graphics-review/flight-cpu/tiles/ (git-ignored) and replayed from
 * disk on every later run; `--offline` refuses to fetch. `--pack <file>` reads
 * a single packed store instead (the committed fixture of
 * scripts/verify-flight-cpu.mjs).
 *
 * THE GROUND. A documented stand-in for the terrain engine: `groundAt(lon,
 * lat)` returns a smooth analytic height field (Seine-valley scale, 25 to 95 m)
 * at tileZ 15, constant in time unless --ground-change says otherwise, so a
 * drape's answer does not depend on WHEN it runs. The terrain query itself (terrain-ground-query.js, which needs the
 * three-tile mesh) is not exercised.
 *
 * WHAT IS MEASURED. Per frame: main-thread milliseconds per engine entry point
 * (update; inside it the refresh, queue pump, drape, finalize, refine, counts
 * and photo phases that exist on that engine), the delivery of worker results
 * (promise continuations, attributed to the engine), and virtual timers. Per
 * run: p50 / p95 / p99 / max frame, frames over 4 / 8 / 16 ms, total
 * main-thread seconds, GC count and pause time (PerformanceObserver), and the
 * heap growth between collections (allocation pressure). `--sample` adds a
 * built-in V8 CPU profile of the flight window and prints the hottest
 * functions (self time); `--cpu-prof` writes the .cpuprofile for DevTools.
 *
 * WHAT IT DOES NOT MEASURE. No GPU, no upload to a GPU, no draw, no React,
 * and not the browser's own structured-clone cost of receiving a result. Node
 * is not Chrome: absolute milliseconds are this machine's V8, and only the
 * before / after on the same machine and input is the claim.
 *
 * ARMS. `--arm off` sets window.__flyFrameLeanOverride = { enabled: false }
 * before anything is imported; `--arm on` leaves the shipped default.
 *
 * IDENTITY. `--exact` puts the engines on a virtual clock (performance.now()
 * returns the frame's virtual time plus 4 us per call), so every millisecond
 * budget expires after the same number of calls and a run is a pure function
 * of its input: two `--exact` runs of one arm give the same final-state hash,
 * and `--exact --arm off` against `--exact --arm on` is the identity proof.
 * On the real clock the skyline's stand-in heights are history dependent (a
 * building near the camera is seated on its lowest corner, and WHEN the
 * budgeted refine reaches it depends on the clock), so a timing pair is
 * compared engine by engine and the skyline may differ there.
 *
 * REPEATABILITY (2026-11-23, this container, 4 cores shared with other work):
 * identical code, two cached runs: total main-thread time 1.31 vs 1.38 s,
 * p95 1.21 vs 1.30 ms; a run that builds its tiles in threads at the same
 * time reads 20 to 30 % higher. Compare cached runs, several per arm.
 *
 * OPTIONS. --seconds 60, --settle-max 90, --tail-min 15, --tail-max 90,
 * --engines buildings,skyline,veg,roads,clutter, --route owner | fixture |
 * lat,lon,headingDeg,kt,altFt, --building-chunks N / --skyline-chunks N (a
 * small ring), --threads 4, --ground-us 2, --offline, --no-cache, --pack
 * <file[.gz]>, --write-pack <file[.gz]> (every response the run read),
 * --sample (top self-time functions), --cpu-prof (flight.cpuprofile for
 * DevTools), --alloc (sampled allocation sites), --quiet.
 *
 * THIRD ROUND (stream G, idle loops; FLY_HORIZON_FILL.md "Third round"):
 *   --parked N   N seconds stationary at the start once the world settled,
 *                measured (the idle tax: what the engines cost a frame while
 *                nothing arrives).
 *   --slow N     N seconds onward along the route after the flight at
 *                --slow-kt (default 60 kt), measured.
 *   --ground-change <segment>:<sec>[:<radius m>]  at that moment a square
 *                region centred on the aircraft (half side 2,500 m) refines:
 *                inside it the ground answers new heights at tileZ 16. The
 *                stand-in's change log (the shape lib/fly/terrain-ground-query.js
 *                exports as `groundChanges`) records it and is handed to every
 *                engine. The report's `groundChange.audit` counts the samples
 *                still on the old ground at the end (both arms must agree, and
 *                end on zero) and `convergeFrames` how long each engine took.
 *   --idle none | a,b   with --arm on, only these FRAME_LEAN.idle switches
 *                (refine, drapeRepair, contact, vegRegrid, batch): an ablation.
 *   --dump-heights   writes every skyline stand-in height table to heights.json.
 *   --scale K    a constant scale K on every streaming allowance (the seam
 *                STREAM_PACE uses): the settled world must not depend on it.
 *   --settle off FRAME_LEAN.settle off (in either arm): the previous settled
 *                state, which depends on when work was reached.
 *   The report adds `segments.{parked,flight,slow}` (frame statistics, per
 *   entry point the mean milliseconds a frame, ground queries a frame) and the
 *   engines' `idle` counters. A run with a ground change needs a tail longer
 *   than the canopy's re-grid back-off (up to 60 s) for the off arm to settle
 *   (--tail-min 75 for a change in the tail).
 *
 * OUTPUT. .graphics-review/flight-cpu/<label>/report.json (every number, the
 * per-frame series with its arrival timeline, the final-state hash per engine
 * and per chunk) and table.txt. `--compare <a> <b>` prints the before / after
 * table, the arrival shift and the hash verdict of two reports.
 */
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, Worker as Thread, parentPort, workerData } from 'node:worker_threads';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

// --- module hooks: extensionless and @/ specifiers, comlink stub -------------
const COMLINK = 'file:///flight-cpu-comlink-stub.mjs';
const LOADED = new Set(); // every module file loaded in this thread (the worker's fingerprint)
const probe = (base) => {
  for (const ext of ['', '.js', '.mjs', '/index.js']) {
    const p = base + ext;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
    } catch {
      /* next candidate */
    }
  }
  return null;
};
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK, shortCircuit: true };
    if (spec.startsWith('@/')) {
      const u = probe(path.join(ROOT, spec.slice(2)));
      if (u) return { url: u, shortCircuit: true };
    }
    if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new URL(spec, ctx.parentURL));
      if (!(fs.existsSync(base) && fs.statSync(base).isFile())) {
        const u = probe(base);
        if (u) return { url: u, shortCircuit: true };
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.startsWith('file:')) LOADED.add(url);
    if (url === COMLINK) {
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const expose=(a)=>{globalThis.__flightCpuApi=a;};' +
          'export const transfer=(v)=>v;' +
          'export const wrap=()=>{throw new Error("wrap is not stubbed");};',
      };
    }
    return next(url, ctx);
  },
});

// ============================================================================
// Tile store (both threads): recorded responses, replayed byte for byte.
// ============================================================================
function openStore({ dir, pack, offline }) {
  if (pack) {
    const raw = fs.readFileSync(pack);
    const map = v8.deserialize(pack.endsWith('.gz') ? zlib.gunzipSync(raw) : raw);
    return {
      get: (url) => map[url] ?? null,
      put: (url) => {
        throw new Error(`flight-cpu: ${url} not in the pack`);
      },
      offline: true,
    };
  }
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
  return {
    get(url) {
      // another thread may have recorded it since we loaded the index
      let rec = index[url];
      if (!rec && fs.existsSync(indexFile)) {
        try {
          Object.assign(index, JSON.parse(fs.readFileSync(indexFile, 'utf8')));
        } catch {
          /* a concurrent write; try again next time */
        }
        rec = index[url];
      }
      if (!rec) return null;
      return { status: rec.status, type: rec.type, body: fs.readFileSync(path.join(dir, rec.file)) };
    },
    put(url, status, type, body) {
      const file = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32) + '.bin';
      fs.writeFileSync(path.join(dir, file), body);
      index[url] = { file, status, type };
      // merge with what other threads recorded
      let disk = {};
      try {
        disk = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
      } catch {
        disk = {};
      }
      const tmp = `${indexFile}.${process.pid}.${Math.random().toString(36).slice(2)}`;
      fs.writeFileSync(tmp, JSON.stringify({ ...disk, ...index }));
      fs.renameSync(tmp, indexFile);
    },
    offline,
  };
}

// ============================================================================
// THREAD: the real vector-tile worker.
// ============================================================================
if (!isMainThread) {
  const { storeOpts } = workerData;
  const store = openStore(storeOpts);
  const realFetch = globalThis.fetch;
  const used = new Set(); // every URL this thread read (for --write-pack)
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    used.add(url);
    let rec = store.get(url);
    if (!rec) {
      if (store.offline) throw new Error(`flight-cpu: input not recorded (offline): ${url}`);
      let res;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await realFetch(url, { credentials: 'omit' });
          if (res.status >= 500 || res.status === 429) throw new Error(`http ${res.status}`);
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      const body = Buffer.from(await res.arrayBuffer());
      rec = { status: res.status, type: res.headers.get('content-type') ?? '', body };
      store.put(url, rec.status, rec.type, body);
    }
    const nullBody = rec.status === 204 || rec.status === 304 || (rec.status >= 100 && rec.status < 200);
    return new Response(nullBody ? null : rec.body, { status: rec.status, headers: rec.type ? { 'content-type': rec.type } : {} });
  };
  // WorldCover decode (the proof script's polyfill), when sharp is present.
  try {
    const { default: sharp } = await import('sharp');
    globalThis.createImageBitmap = async (blob) => {
      const buf = Buffer.from(await blob.arrayBuffer());
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data: new Uint8ClampedArray(data), close() {} };
    };
    globalThis.OffscreenCanvas = class {
      constructor(w, h) {
        this.width = w;
        this.height = h;
        this._img = new Uint8ClampedArray(w * h * 4);
      }
      getContext() {
        const c = this;
        return {
          drawImage(bmp) {
            c._img.set(bmp.data.subarray(0, c._img.length));
          },
          getImageData(x, y, w, h) {
            return { data: c._img, width: w, height: h };
          },
        };
      }
    };
  } catch {
    /* no sharp: the worker's WorldCover path returns null, as in a bare node */
  }
  await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
  const api = globalThis.__flightCpuApi;
  const buffersOf = (v, out = new Set(), seen = new Set()) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return out;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      out.add(v.buffer);
      return out;
    }
    if (v instanceof ArrayBuffer) {
      out.add(v);
      return out;
    }
    for (const k of Object.keys(v)) buffersOf(v[k], out, seen);
    return out;
  };
  // One request at a time per thread: the worker's module state
  // (clutterOnly, diag) is toggled around a build.
  let chain = Promise.resolve();
  parentPort.on('message', (msg) => {
    chain = chain.then(async () => {
      const t0 = performance.now();
      let result;
      let error = null;
      try {
        if (msg.op === 'used') {
          result = [...used];
        } else if (msg.op === 'call') {
          result = await api[msg.method]?.(...msg.args);
        } else {
          await api.setClutterOnly(!!msg.clutterOnly);
          await api.setDiag(!!msg.diag);
          result = await api.buildTile(...msg.args);
        }
      } catch (e) {
        error = String(e?.message ?? e);
      }
      const ms = performance.now() - t0;
      const bufs = [...buffersOf(result)].filter((b) => !(b instanceof SharedArrayBuffer));
      const bytes = bufs.reduce((s, b) => s + b.byteLength, 0);
      try {
        parentPort.postMessage({ id: msg.id, result, error, ms, bytes }, bufs);
      } catch {
        parentPort.postMessage({ id: msg.id, result, error, ms, bytes });
      }
    });
  });
  parentPort.postMessage({ ready: true, files: [...LOADED].filter((u) => u !== COMLINK).map((u) => fileURLToPath(u)).sort() });
}

// ============================================================================
// MAIN
// ============================================================================
/** --exact: virtual milliseconds per performance.now() call. */
const EXACT_TICK_MS = 0.004;
/** The FRAME_LEAN.idle switches (third round), for --idle. */
export const IDLE_SWITCHES = ['refine', 'drapeRepair', 'contact', 'vegRegrid', 'batch'];

export const ROUTES = {
  // The owner's measured leg (FLY_HORIZON_FILL.md "What was measured").
  owner: { lat: 48.889, lon: 2.246, headingDeg: 37, kt: 399, altFt: 2072 },
  // The committed fixture's leg (scripts/verify-flight-cpu.mjs): the same
  // heading, speed and altitude over Powell, Ohio, whose suburban tiles are
  // small enough to commit (scripts/fixtures/horizon-fill/flight-powell.pack.gz).
  fixture: { lat: 40.158, lon: -83.075, headingDeg: 37, kt: 399, altFt: 2072 },
};

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);

async function mainCompare() {
  const [a, b] = [opt('--compare'), argv[argv.indexOf('--compare') + 2]];
  const dir = path.join(ROOT, '.graphics-review/flight-cpu');
  const A = JSON.parse(fs.readFileSync(path.join(dir, a, 'report.json'), 'utf8'));
  const B = JSON.parse(fs.readFileSync(path.join(dir, b, 'report.json'), 'utf8'));
  console.log(compareTable(A, B));
}

export function compareTable(A, B) {
  const rows = [];
  const f = (x, d = 2) => (x == null ? '-' : typeof x === 'number' ? x.toFixed(d) : String(x));
  const line = (name, x, y, d = 2) => {
    const pct = typeof x === 'number' && typeof y === 'number' && x !== 0 ? `${(((y - x) / x) * 100).toFixed(1)}%` : '';
    rows.push(`${name.padEnd(34)} ${f(x, d).padStart(12)} ${f(y, d).padStart(12)} ${pct.padStart(9)}`);
  };
  rows.push(`${''.padEnd(34)} ${A.label.padStart(12)} ${B.label.padStart(12)} ${'change'.padStart(9)}`);
  const fa = A.flight.frame;
  const fb = B.flight.frame;
  for (const k of ['p50', 'p95', 'p99', 'max']) line(`frame ${k} ms`, fa[k], fb[k], 3);
  for (const k of ['over4', 'over8', 'over16']) line(`frames ${k.replace('over', '> ')} ms`, fa[k], fb[k], 0);
  line('main-thread total s', fa.totalSec, fb.totalSec, 3);
  line('gc count', A.flight.gc.count, B.flight.gc.count, 0);
  line('gc pause ms', A.flight.gc.ms, B.flight.gc.ms, 1);
  line('heap growth MB (alloc proxy)', A.flight.heap.growthMB, B.flight.heap.growthMB, 1);
  const keys = new Set([...Object.keys(A.flight.phases), ...Object.keys(B.flight.phases)]);
  const sorted = [...keys].sort((x, y) => (B.flight.phases[y]?.totalMs ?? 0) + (A.flight.phases[y]?.totalMs ?? 0) - ((B.flight.phases[x]?.totalMs ?? 0) + (A.flight.phases[x]?.totalMs ?? 0)));
  rows.push('phase totals over the flight (ms), and per-frame max:');
  for (const k of sorted) {
    line(`  ${k}`, A.flight.phases[k]?.totalMs ?? 0, B.flight.phases[k]?.totalMs ?? 0, 1);
    line(`  ${k} max`, A.flight.phases[k]?.maxMs ?? 0, B.flight.phases[k]?.maxMs ?? 0, 2);
  }
  rows.push(arrivalShift(A, B));
  rows.push(`final-state hash: ${A.final.hash.slice(0, 16)} vs ${B.final.hash.slice(0, 16)}  ${A.final.hash === B.final.hash ? 'EQUAL' : 'DIFFERENT'} (${Object.keys(A.final.per).map((k) => `${k} ${A.final.per[k].hash === B.final.per[k]?.hash ? 'equal' : 'differs'}`).join(', ')})`);
  return rows.join('\n');
}

/**
 * How the two runs' arrival timelines differ: per engine, the first frame the
 * count of drawn chunks differs, and the largest number of frames by which
 * the second run reaches a count later (+) or earlier (-) than the first.
 */
export function arrivalShift(A, B) {
  const out = [];
  const names = A.engines;
  for (let e = 0; e < names.length; e++) {
    const a = A.series.map((f) => f.r?.[e] ?? 0);
    const b = B.series.map((f) => f.r?.[e] ?? 0);
    let first = -1;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) { first = i; break; }
    // frames to first reach each count, per run
    const reach = (s) => {
      const m = new Map();
      for (let i = 0; i < s.length; i++) if (!m.has(s[i])) m.set(s[i], i);
      return m;
    };
    const ra = reach(a);
    const rb = reach(b);
    let late = 0;
    let early = 0;
    for (const [k, i] of ra) if (rb.has(k)) { const dlt = rb.get(k) - i; late = Math.max(late, dlt); early = Math.min(early, dlt); }
    out.push(`${names[e]} ${first < 0 ? 'same timeline' : `differs from frame ${first}, shift ${early}..+${late} frames`}`);
  }
  return `arrival: ${out.join('; ')}`;
}

if (isMainThread && argv.includes('--compare')) {
  await mainCompare();
  process.exit(0);
}

if (isMainThread && !argv.includes('--compare') && process.env.FLIGHT_CPU_LIB !== '1') {
  const report = await runFlight({
    arm: opt('--arm', 'on'),
    label: opt('--label', `run-${opt('--arm', 'on')}`),
    route: opt('--route', 'owner'),
    seconds: Number(opt('--seconds', 60)),
    settleMax: Number(opt('--settle-max', 90)),
    tailMax: Number(opt('--tail-max', 90)),
    tailMin: Number(opt('--tail-min', 15)),
    offline: flag('--offline'),
    pack: opt('--pack', null),
    threads: Number(opt('--threads', 4)),
    sample: flag('--sample'),
    cpuProf: flag('--cpu-prof'),
    engines: (opt('--engines', 'buildings,skyline,veg,roads,clutter') || '').split(',').filter(Boolean),
    quiet: flag('--quiet'),
    noCache: flag('--no-cache'),
    exact: flag('--exact'),
    alloc: flag('--alloc'),
    groundUs: Number(opt('--ground-us', 2)),
    parked: Number(opt('--parked', 0)),
    slow: Number(opt('--slow', 0)),
    slowKt: Number(opt('--slow-kt', 60)),
    groundChange: opt('--ground-change', null),
    idle: opt('--idle', null),
    scale: opt('--scale', null) == null ? null : Number(opt('--scale')),
    settle: opt('--settle', null),
    dumpHeights: flag('--dump-heights'),
    buildingChunks: opt('--building-chunks', null) == null ? undefined : Number(opt('--building-chunks')),
    skylineChunks: opt('--skyline-chunks', null) == null ? undefined : Number(opt('--skyline-chunks')),
    writePack: opt('--write-pack', null),
  });
  process.exit(report.ok ? 0 : 1);
}

/** Runs one flight in THIS process (the arm pin must be set before the first engine import). */
export async function runFlight(o) {
  const realNow = performance.now.bind(performance);
  const log = o.quiet ? () => {} : (...a) => console.log(...a);
  const OUT = path.join(ROOT, '.graphics-review/flight-cpu', o.label);
  fs.mkdirSync(OUT, { recursive: true });
  const storeOpts = o.pack ? { pack: path.resolve(ROOT, o.pack) } : { dir: path.join(ROOT, '.graphics-review/flight-cpu/tiles'), offline: !!o.offline };

  // --- the page the engines believe they are on: desktop High, Enhanced ------
  globalThis.window = {
    location: { search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    navigator: { userAgent: 'node' },
    devicePixelRatio: 1,
    innerWidth: 1920,
    innerHeight: 1080,
    __flyWorldPassTierOverride: { preset: 'high', mobile: false },
    addEventListener() {},
    removeEventListener() {},
  };
  if (o.arm === 'off') globalThis.window.__flyFrameLeanOverride = { enabled: false };
  else if (o.arm !== 'on') throw new Error(`--arm on|off, not ${o.arm}`);
  // --idle none | a,b,c (third round): with --arm on, only these idle switches
  // of FRAME_LEAN.idle stay on (an ablation; the default is the shipped block).
  if (o.idle != null && o.arm === 'on') {
    const want = new Set(String(o.idle).split(',').filter((k) => k && k !== 'none'));
    globalThis.window.__flyFrameLeanOverride = { idle: Object.fromEntries(IDLE_SWITCHES.map((k) => [k, want.has(k)])) };
  }
  // --settle on|off (third round repair): FRAME_LEAN.settle in either arm.
  // It ships off (the previous, history-dependent settled state); on is what
  // the constant-scale identity in scripts/verify-flight-cpu.mjs is proven with.
  if (o.settle === 'off' || o.settle === 'on') globalThis.window.__flyFrameLeanOverride = { ...(globalThis.window.__flyFrameLeanOverride ?? {}), settle: { enabled: o.settle === 'on' } };
  else if (o.settle != null) throw new Error(`--settle on|off, not ${o.settle}`);
  // --scale K: a constant scale on every time and count allowance, through the
  // seam STREAM_PACE uses (lib/fly/harness-budget.js setStreamPaceK; budgetK()
  // = harness factor x K). Not a measurement arm: an identity probe (does the
  // settled world depend on how fast the allowances let work through?).
  if (o.scale != null) {
    if (!(o.scale > 0)) throw new Error(`--scale must be positive, not ${o.scale}`);
    (await import(pathToFileURL(path.join(ROOT, 'lib/fly/harness-budget.js')).href)).setStreamPaceK(o.scale);
  }
  globalThis.document ??= {
    createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }),
  };

  // --- virtual time: timers fire at frame boundaries ------------------------
  let vnow = 0; // seconds
  // --exact: the engines' clock is virtual. performance.now() reads the frame's
  // virtual time plus a fixed tick per call, so every millisecond budget
  // expires after the same number of calls in both arms and the run is a pure
  // function of its input (the identity proof). Never for timing numbers.
  let ticks = 0;
  if (o.exact) {
    performance.now = () => vnow * 1000 + ++ticks * EXACT_TICK_MS;
  }
  const timers = new Map();
  let timerId = 1;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms = 0, ...args) => {
    const id = timerId++;
    timers.set(id, { at: vnow + Math.max(0, +ms || 0) / 1000, fn, args });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  // Animation-frame callbacks run at the start of the next frame (virtual
  // time), as a browser runs them before its frame. Until the third round's
  // repair this was a no-op, so a roof-photo fade (lib/fly/look-roof-patch.js)
  // that began on a drawn tile never advanced: the tile kept its old roof
  // colours for good, and whether a photo landed before or after its tile was
  // first drawn decided the final colours (an instrument artifact; in a
  // browser the fade ends on the new colours either way).
  const rafs = new Map();
  let rafId = 1;
  globalThis.requestAnimationFrame = (fn) => {
    const id = rafId++;
    rafs.set(id, fn);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => rafs.delete(id);
  const runRafs = () => {
    if (!rafs.size) return 0;
    const due = [...rafs];
    rafs.clear();
    for (const [, fn] of due) {
      try {
        fn(performance.now());
      } catch (e) {
        log('animation frame threw', e?.message);
      }
    }
    return due.length;
  };
  globalThis.requestIdleCallback = undefined;
  const runTimers = () => {
    let n = 0;
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])) {
      if (t.at > vnow) continue;
      timers.delete(id);
      n++;
      try {
        t.fn(...t.args);
      } catch (e) {
        log('timer threw', e?.message);
      }
    }
    return n;
  };
  const drain = () => new Promise((r) => setImmediate(r));

  // --- photo worker stub (the stand-in ground photos) ------------------------
  const photoReplies = []; // { at, worker, data }
  let photoAlb = null;
  const { photoSize } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/sat-stand-in-photo-core.js')).href);
  const { FLIGHT_CLARITY_ON } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/world-clarity.js')).href);
  globalThis.Worker = class PhotoWorkerStub {
    constructor() {
      this.onmessage = null;
    }
    postMessage(msg) {
      const S = photoSize(msg.sub);
      const H = FLIGHT_CLARITY_ON ? S + (S >> 1) : S;
      // deterministic synthetic albedo, one shared pattern (copied per reply)
      if (!photoAlb || photoAlb.length !== S * H * 4) {
        photoAlb = new Uint8Array(S * H * 4);
        for (let i = 0; i < photoAlb.length; i++) photoAlb[i] = (i * 2654435761) >>> 24;
      }
      photoReplies.push({ at: vnow + PHOTO_MS / 1000, worker: this, data: { id: msg.id, n: S, alb: photoAlb.slice() } });
    }
    terminate() {
      this.onmessage = null;
    }
  };
  const PHOTO_MS = 350;

  // --- the build farm and the model worker pools ----------------------------
  const threads = [];
  const waiters = new Map();
  let msgId = 1;
  for (let i = 0; i < Math.max(1, o.threads); i++) {
    const th = new Thread(SELF, { workerData: { storeOpts }, execArgv: ['--no-warnings'], env: { ...process.env, FLIGHT_CPU_LIB: '1' } });
    th.busy = 0;
    th.on('message', (m) => {
      if (m.ready) return th.readyResolve?.(m.files);
      const w = waiters.get(m.id);
      waiters.delete(m.id);
      th.busy--;
      w?.(m);
    });
    th.on('error', (e) => log('thread error', e?.message));
    th.ready = new Promise((r) => (th.readyResolve = r));
    threads.push(th);
  }
  const workerFiles = (await Promise.all(threads.map((t) => t.ready)))[0];
  // Built results are cached on disk under a fingerprint of every module the
  // worker loaded (its whole import graph, node_modules included), so a later
  // run replays them with no build thread competing for the CPU.
  const fpHash = crypto.createHash('sha256');
  for (const f of workerFiles) fpHash.update(f.replace(ROOT, '')).update(fs.readFileSync(f));
  const workerFp = fpHash.digest('hex').slice(0, 16);
  const CACHE = o.noCache ? null : path.join(ROOT, '.graphics-review/flight-cpu/results', workerFp);
  if (CACHE) fs.mkdirSync(CACHE, { recursive: true });
  const cacheFile = (args, clutterOnly) => path.join(CACHE, crypto.createHash('sha256').update(JSON.stringify([args, !!clutterOnly])).digest('hex').slice(0, 40) + '.bin');
  const farm = (payload) => {
    const th = threads.reduce((a, b) => (b.busy < a.busy ? b : a));
    th.busy++;
    const id = msgId++;
    return new Promise((resolve) => {
      waiters.set(id, resolve);
      th.postMessage({ ...payload, id });
    });
  };
  // The thread queue: build in the order requests were issued (FIFO across
  // engines), so a thread is never left idle while the frames wait.
  // Per-detail service time, fitted once to the real worker's build time
  // against its output size in node (2026-11-23, this route: buildings mean
  // 1.36 s for 7.4 MB, the 0.6 to 2.4 s the World Pass record measured in the
  // browser), then frozen so arrival is a pure function of the requests.
  const FETCH_MS = 40;
  const SERVICE = {
    'sat-buildings': [125, 0.167],
    'sat-skyline': [5, 1.6],
    'sat-veg': [200, 0],
    'sat-roads': [20, 0.08],
  };
  const serviceMs = (detail, bytes) => {
    const [a, b] = SERVICE[detail] ?? [20, 0.1];
    return FETCH_MS + a + (b * bytes) / 1024;
  };
  const jobs = []; // every model job, for the release loop
  const statsW = { builds: 0, cacheHits: 0, threadMs: 0, waitedMs: 0, bytes: 0, samples: [] };
  function makePool(name, n, clutterOnly = false) {
    const slots = Array.from({ length: n }, () => ({ freeAt: 0, queue: [] }));
    const mkApi = (slot) => ({
      init: () => Promise.resolve(true),
      setDiag: () => Promise.resolve(false),
      setClutterOnly: () => Promise.resolve(clutterOnly),
      buildTile(...args) {
        let resolve, reject;
        const promise = new Promise((a, b) => {
          resolve = a;
          reject = b;
        });
        const file = CACHE ? cacheFile(args, clutterOnly) : null;
        const hit = file && fs.existsSync(file);
        const job = { engine: name, args, issuedAt: vnow, slot, resolve, reject, file, hit, msg: hit ? null : farm({ op: 'build', args, clutterOnly }) };
        slot.queue.push(job);
        jobs.push(job);
        return promise;
      },
    });
    return { name, slots, apis: slots.map(mkApi) };
  }
  // Is a job due by `t`? Schedule (waiting on threads) only as far as needed.
  async function scheduleUntil(t) {
    for (;;) {
      let progressed = false;
      for (const job of jobs) {
        if (job.finishAt !== undefined) continue;
        const slot = job.slot;
        if (slot.queue[0] !== job) continue;
        if (Math.max(job.issuedAt, slot.freeAt) > t) continue; // cannot finish by t
        const t0 = realNow();
        let m;
        if (job.hit) {
          m = v8.deserialize(fs.readFileSync(job.file));
          statsW.cacheHits++;
        } else {
          m = await job.msg;
          if (job.file && !m.error) fs.writeFileSync(job.file, v8.serialize(m));
        }
        statsW.waitedMs += realNow() - t0;
        statsW.builds++;
        statsW.threadMs += m.ms;
        statsW.bytes += m.bytes;
        statsW.samples.push([job.engine, job.args[3], m.bytes, +m.ms.toFixed(1)]);
        job.result = m;
        job.finishAt = Math.max(job.issuedAt, slot.freeAt) + serviceMs(job.args[3], m.bytes) / 1000;
        slot.freeAt = job.finishAt;
        slot.queue.shift();
        progressed = true;
      }
      if (!progressed) return;
    }
  }

  // --- import the app (after the pins) --------------------------------------
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const { useFlyStore } = await imp('stores/fly-store.js');
  useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced', qualityPreset: 'high', qualityTier: 'high' });
  const { frameLeanOn } = await imp('lib/fly/frame-lean.js');
  const C = await imp('lib/fly/fly-constants.js');
  const { worldPassOn, worldPassConfig } = await imp('lib/fly/world-pass.js');
  const { withRunwayGeometry } = await imp('lib/fly/runway-worker.js');
  const { satelliteVisualsOn, satelliteVisualProfile } = await imp('lib/fly/satellite-visuals.js');
  const { stylizedEarthOn } = await imp('lib/fly/stylized-earth.js');
  const { cityRangeFor } = await imp('lib/fly/city-range.js');
  const { immersiveOn } = await imp('lib/fly/immersive.js');
  const { nightCityOn } = await imp('lib/fly/night-city.js');
  const { setSatelliteArchitectureCoverage } = await imp('lib/fly/satellite-architecture-material.js');
  const { getSatBldgFade } = await imp('lib/fly/toy-world/world-bend.js');
  const { noteFinalizeFrame } = await imp('lib/fly/finalize-pace.js');
  const { SatBuildingEngine } = await imp('lib/fly/toy-world/sat-building-engine.js');
  const { SatSkylineEngine } = await imp('lib/fly/toy-world/sat-skyline-engine.js');
  const { SatVegEngine } = await imp('lib/fly/toy-world/sat-veg-engine.js');
  const { SatRoadEngine } = await imp('lib/fly/toy-world/sat-road-engine.js');
  const { SatClutterEngine } = await imp('lib/fly/toy-world/sat-clutter-engine.js');
  const { PerspectiveCamera } = await import('three');
  const lean = frameLeanOn('engines');
  log(`flight-cpu: arm ${o.arm} (frameLeanOn('engines') = ${lean}), route ${o.route}, engines ${o.engines.join(',')}`);

  // --- the route ----------------------------------------------------------------
  const R = 6378137;
  const r = typeof o.route === 'string'
    ? ROUTES[o.route] ?? (o.route.includes(',') ? (([lat, lon, headingDeg, kt, altFt]) => ({ lat, lon, headingDeg, kt, altFt }))(o.route.split(',').map(Number)) : null)
    : o.route;
  if (!r) throw new Error(`unknown route ${o.route}`);
  const toX = (lon) => (lon * Math.PI * R) / 180;
  const toZ = (lat) => -R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const latOf = (z) => (2 * Math.atan(Math.exp(-z / R)) - Math.PI / 2) * (180 / Math.PI);
  const hdg = (r.headingDeg * Math.PI) / 180;
  const speed = r.kt * 0.514444; // true m/s
  const altM = r.altFt * 0.3048;
  const x0 = toX(r.lon);
  const z0 = toZ(r.lat);
  // The ground stand-in: a smooth height field, constant in time.
  const groundH0 = (lon, lat) => 60 + 22 * Math.sin(lon * 41.3 + 0.7) * Math.cos(lat * 37.1) + 13 * Math.sin(lon * 151 + lat * 97);
  // --ground-change <segment>:<sec>[:<radius m>] (third round): at that moment a
  // square region centred on the aircraft (half side `radius`, default 2,500 m)
  // REFINES, as a finer terrain tile loading there does: inside it the ground
  // answers a new height field at tileZ 16 instead of 15. The stand-in's change
  // log (`groundChanges`, the shape lib/fly/terrain-ground-query.js exports)
  // records the region at that epoch, and the engines are handed it, so an
  // engine that skips idle work must see the change and converge to the new
  // ground. Deterministic: the moment is a frame of virtual time.
  const GC = (() => {
    if (!o.groundChange) return null;
    const [seg, sec, rad] = String(o.groundChange).split(':');
    return { seg, sec: Number(sec) || 0, radiusM: Number(rad) || 2500, at: Infinity, box: null };
  })();
  const inChange = (lon, lat) => {
    const b = GC?.box;
    return !!b && vnow >= GC.at && lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
  };
  const groundH = (lon, lat) => (inChange(lon, lat) ? groundH0(lon, lat) + 6.5 + 4 * Math.sin(lon * 97 + lat * 61) : groundH0(lon, lat));
  const groundZ = (lon, lat) => (inChange(lon, lat) ? 16 : 15);
  // The stand-in's change log: one entry per change (epoch, lon/lat box).
  const changeLog = [];
  let changeEpoch = 1;
  const groundChanges = {
    live: () => true,
    epoch: () => changeEpoch,
    changedSince(e, w, s, east, n) {
      if (!(e < changeEpoch)) return false;
      for (const c of changeLog) if (c.epoch > e && !(c.box[2] < w || c.box[0] > east || c.box[3] < s || c.box[1] > n)) return true;
      return false;
    },
  };
  const triggerChange = () => {
    const lon = (flight.pos.x / R) * (180 / Math.PI);
    const lat = flight.latDeg;
    const dLat = (GC.radiusM / R) * (180 / Math.PI);
    const dLon = dLat / Math.cos((lat * Math.PI) / 180);
    GC.box = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
    GC.at = vnow;
    changeEpoch += 1;
    changeLog.push({ epoch: changeEpoch, box: GC.box });
    log(`ground change at ${vnow.toFixed(2)} s virtual (${GC.seg}:${GC.sec}): box ${GC.box.map((v) => v.toFixed(5)).join(', ')}`);
  };
  // Each query also costs `--ground-us` microseconds of real time (default 2,
  // a model of the batched exact terrain query; the unbatched reference
  // measured 17 to 21 us, FLY_WORLD_PASS.md), so a loop that queries more
  // costs more here as it does in the app. Counted per engine.
  // The cost is a fixed arithmetic loop calibrated once at start-up (no
  // clock reads, no allocation), so it adds neither garbage nor clock noise.
  const groundUs = o.groundUs ?? 2;
  let sink = 0;
  const spin = (n) => {
    let a = 1.000001;
    for (let i = 0; i < n; i++) a = a * 1.0000001 + 1e-9;
    sink += a;
  };
  // Calibrated once per machine and stored, so every later run (both arms)
  // spins the same count.
  let spinN = 0;
  if (groundUs > 0) {
    const calFile = path.join(ROOT, '.graphics-review/flight-cpu/ground-spin.json');
    let perUs = null;
    try {
      perUs = JSON.parse(fs.readFileSync(calFile, 'utf8')).perUs;
    } catch {
      spin(2e6); // warm
      let best = Infinity;
      for (let k = 0; k < 5; k++) {
        const t0 = realNow();
        spin(4e6);
        best = Math.min(best, realNow() - t0);
      }
      perUs = 4e6 / (best * 1000);
      fs.mkdirSync(path.dirname(calFile), { recursive: true });
      fs.writeFileSync(calFile, JSON.stringify({ perUs }));
    }
    spinN = Math.round(perUs * groundUs);
  }
  const queries = {};
  const groundFor = (name) => {
    queries[name] = 0;
    return (lon, lat) => {
      queries[name]++;
      if (spinN) spin(spinN);
      return { elev: groundH(lon, lat), tileZ: groundZ(lon, lat) };
    };
  };
  const flight = { pos: { x: x0, y: altM, z: z0 }, heading: hdg, speed: 0, latDeg: r.lat, groundElev: 0 };
  const anchor = { x: x0, y: 0, z: z0 };
  const camera = new PerspectiveCamera(68, 16 / 9, 1, 400000);
  const K = 540 / Math.tan((68 * Math.PI) / 360);
  const place = (dist) => {
    // dist in true metres along the heading from the start (rhumb line)
    const mz = -Math.cos(hdg) * dist;
    const mx = Math.sin(hdg) * dist;
    // integrate the Mercator scale along the leg (short legs: midpoint)
    const latMid = latOf(z0 + (mz / 2) / Math.cos((r.lat * Math.PI) / 180));
    const k = 1 / Math.cos((latMid * Math.PI) / 180);
    flight.pos.x = x0 + mx * k;
    flight.pos.z = z0 + mz * k;
    flight.latDeg = latOf(flight.pos.z);
    flight.groundElev = groundH(flight.pos.x / R * 180 / Math.PI, flight.latDeg);
    camera.position.set(flight.pos.x - anchor.x - Math.sin(hdg) * 30, altM + 8, flight.pos.z - anchor.z + Math.cos(hdg) * 30);
    camera.lookAt(flight.pos.x - anchor.x + Math.sin(hdg) * 1000, altM - 120, flight.pos.z - anchor.z - Math.cos(hdg) * 1000);
    camera.updateMatrixWorld();
  };
  place(0);

  // --- engines, configured as their layers do -------------------------------
  const tier = 'high';
  let layerSink = 0;
  const profile = satelliteVisualProfile(tier);
  const want = new Set(o.engines);
  const engines = [];
  let buildings = null;
  if (want.has('buildings')) {
    const e = new SatBuildingEngine({ groundAt: groundFor('buildings'), groundChanges });
    e.setWaterEnabled(!stylizedEarthOn() && C.SAT_WATER.enabled && (satelliteVisualsOn('water') ? profile.water : tier === C.SAT_WATER.minTier));
    e.setFacadeEnabled(C.SAT_BUILDINGS.facade.enabled);
    const nightMinTier = nightCityOn('tier') ? C.NIGHT_CITY_R23.tier.nightMinTier : C.SAT_BUILDINGS.night.minTier;
    e.setNightWindowsEnabled(C.SAT_BUILDINGS.night.enabled && ['low', 'medium', 'high'].indexOf(tier) >= ['low', 'medium', 'high'].indexOf(nightMinTier));
    e.setCoverage(satelliteVisualsOn() ? { ringM: C.SAT_COVERAGE.high.ringM, maxChunks: o.buildingChunks ?? profile.buildingChunks } : C.SAT_COVERAGE.high);
    e.setArchitectureDetail(profile.normalMaps);
    e.setCityRange(cityRangeFor(tier));
    e.setShadows(C.SAT_SHADOWS.enabled && (tier === C.SAT_SHADOWS.minTier || immersiveOn('lighting')));
    e.setBandListener(() => {});
    const n = worldPassOn('arrival') ? Math.max(1, worldPassConfig('arrival').workers | 0) : 1;
    const pool = makePool('buildings', n);
    const apis = pool.apis.map((a) => withRunwayGeometry(a));
    e.setWorker(apis[0], apis.length > 1 ? apis.slice(1) : null);
    buildings = e;
    engines.push({
      name: 'buildings',
      e,
      pool,
      phases: ['_refreshDesired', '_pumpQueue', '_pumpWaterBackfill', '_pumpRedrape', '_drapePending', '_finalizePending', '_repairContactDrape', '_oceanFill', '_stepFades', '_wpTrackRing', '_wpTrackGround'],
      step: (t, agl) => {
        e.setNightMix(1);
        if (e._arr.readiness) e.setView(flight.heading);
        e.update(t, flight.pos.x, flight.pos.z, agl);
        // SatBuildingLayer's per-frame reads after the update (ready, births)
        const t0 = realNow();
        if (lean) layerSink += e.readyCount() + e.birthCount();
        else layerSink += e.stats.ready + e.stats.births;
        addPhase('buildings.layerStats', realNow() - t0);
      },
    });
  }
  if (want.has('roads')) {
    const e = new SatRoadEngine({ groundAt: groundFor('roads'), groundChanges });
    const pool = makePool('roads', 1);
    e.setWorker(withRunwayGeometry(pool.apis[0]));
    e.setRunwayLightExclusion(null);
    engines.push({
      name: 'roads',
      e,
      pool,
      phases: ['_refreshDesired', '_pumpQueue', '_drapePending', '_finalizePending'],
      step: (t, agl) => {
        e.update(t, flight.pos.x, flight.pos.z, agl, 1);
        const t0 = realNow(); // SatRoadLayer's per-frame read
        layerSink += lean ? e.readyCount() : e.stats.ready;
        addPhase('roads.layerStats', realNow() - t0);
      },
    });
  }
  if (want.has('skyline')) {
    const e = new SatSkylineEngine({ groundAt: groundFor('skyline'), groundChanges });
    e.setMaxChunks(o.skylineChunks ?? (satelliteVisualsOn() ? profile.skylineChunks : C.SAT_SKYLINE.maxChunksByTier[tier]) ?? 0);
    e.setHorizonTier(tier);
    e.setCityRange(cityRangeFor(tier));
    if (o.skylineChunks != null) e.setMaxChunks(o.skylineChunks); // a small fixture ring
    const n = e.standInsOn ? Math.max(1, Math.min(4, e.workerCount)) : 1;
    const pool = makePool('skyline', n);
    const apis = pool.apis.map((a) => withRunwayGeometry(a));
    e.setWorker(apis[0], apis.length > 1 ? apis.slice(1) : undefined);
    if (e.standInsOn) {
      e.setPhotoGate(() => {
        const s = buildings?.stats;
        return s && (s.queued || s.building || s.draping) ? 'busy' : true;
      });
    }
    engines.push({
      name: 'skyline',
      e,
      pool,
      phases: ['_refreshDesired', '_pumpQueue', '_hfPollCache', '_drapePending', '_finalizePending', '_pumpPhotos', '_patchPhotos', '_stepPhotoRamps', '_repairDrape', '_refineStandIns', '_updateStandInCounts', '_updateVisibility', '_stepFades', '_writeChoreography', '_wpTrackRing'],
      step: (t, agl) => {
        if (e.standInsOn) e.setStandInView(K, anchor, 1080, null, camera);
        e.setNightMix(1);
        setSatelliteArchitectureCoverage(e.material, buildings, anchor, getSatBldgFade());
        e.update(t, flight.pos.x, flight.pos.z, agl, flight.groundElev);
        // SatSkylineLayer's per-frame reads (stream L's file: the full stats both arms)
        const t0 = realNow();
        layerSink += e.stats.ready + e.stats.births;
        addPhase('skyline.layerStats', realNow() - t0);
      },
    });
  }
  if (want.has('veg')) {
    const poolTier = satelliteVisualsOn('ground') ? 'high' : tier;
    const e = new SatVegEngine({ groundAt: groundFor('veg'), groundChanges, maxChunks: C.SAT_VEG.maxChunksByTier[poolTier] ?? 0 });
    const pool = makePool('veg', 1);
    e.setWorker(withRunwayGeometry(pool.apis[0]));
    engines.push({
      name: 'veg',
      e,
      pool,
      phases: ['_refreshDesired', '_pumpQueue', '_samplePending', '_sampleFine', '_commitFine', '_commitPending'],
      step: (t, agl) => {
        const mercK = 1 / Math.cos((flight.latDeg * Math.PI) / 180);
        e.update(t, flight.pos.x, flight.pos.z, agl, satelliteVisualsOn('ground'), 0, tier, mercK);
      },
    });
  }
  if (want.has('clutter') && C.CLUTTER.enabled) {
    const e = new SatClutterEngine({ groundAt: groundFor('clutter'), groundChanges });
    const pool = makePool('clutter', 1, true);
    e.setWorker(withRunwayGeometry(pool.apis[0]));
    engines.push({
      name: 'clutter',
      e,
      pool,
      phases: ['_refreshDesired', '_pumpQueue', '_samplePending', '_commitPending'],
      step: (t, agl) => e.update(t, flight.pos.x, flight.pos.z, agl),
    });
  }

  // --- instrumentation ------------------------------------------------------
  const frameRec = { phases: new Map() };
  const addPhase = (key, ms) => frameRec.phases.set(key, (frameRec.phases.get(key) ?? 0) + ms);
  for (const en of engines) {
    for (const m of ['update', ...en.phases]) {
      const fn = en.e[m];
      if (typeof fn !== 'function') continue;
      const key = m === 'update' ? `${en.name}.update` : `${en.name}.${m}`;
      en.e[m] = function timed(...args) {
        const t0 = realNow();
        try {
          return fn.apply(this, args);
        } finally {
          addPhase(key, realNow() - t0);
        }
      };
    }
  }

  // GC observation
  const { PerformanceObserver, constants: perfConst } = await import('node:perf_hooks');
  const gcLog = [];
  const gcObs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) gcLog.push({ t: e.startTime, ms: e.duration, kind: e.detail?.kind ?? e.kind });
  });
  gcObs.observe({ entryTypes: ['gc'] });
  void perfConst;

  // --- frame loop -------------------------------------------------------------
  const DT = 1 / 60;
  let frameNo = 0;
  const series = [];
  const segStart = {}; // segment -> virtual seconds at its first frame
  async function frame(phase) {
    vnow = frameNo * DT;
    ticks = 0;
    frameNo++;
    segStart[phase] ??= vnow;
    if (GC && GC.at === Infinity && GC.seg === phase && vnow - segStart[phase] >= GC.sec) triggerChange();
    // Off the clock: make sure every job due by this frame has its result.
    await scheduleUntil(vnow);
    frameRec.phases = new Map();
    const heap0 = v8.getHeapStatistics().used_heap_size;
    const f0 = realNow();
    // 1. messages that arrived since the last frame (worker results, photos)
    for (const en of engines) {
      const due = [];
      for (const j of jobs) if (j.engine === en.name && j.finishAt !== undefined && j.finishAt <= vnow && !j.delivered) due.push(j);
      if (!due.length) continue;
      const t0 = realNow();
      for (const j of due) {
        j.delivered = true;
        if (j.result.error) j.reject(new Error(j.result.error));
        else j.resolve(j.result.result);
      }
      await drain();
      addPhase(`${en.name}.arrival`, realNow() - t0);
    }
    for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].delivered) jobs.splice(i, 1);
    if (photoReplies.length) {
      const t0 = realNow();
      for (let i = photoReplies.length - 1; i >= 0; i--) {
        const p = photoReplies[i];
        if (p.at > vnow) continue;
        photoReplies.splice(i, 1);
        p.worker.onmessage?.({ data: p.data });
      }
      await drain();
      addPhase('skyline.photoArrival', realNow() - t0);
    }
    if (timers.size) {
      const t0 = realNow();
      if (runTimers()) {
        await drain();
        addPhase('timers', realNow() - t0);
      }
    }
    if (rafs.size) {
      const t0 = realNow();
      runRafs();
      addPhase('raf', realNow() - t0);
    }
    // 2. the frame callbacks, in the layers' priority order
    noteFinalizeFrame(DT);
    const agl = Math.max(0, flight.pos.y - flight.groundElev);
    for (const en of engines) en.step(vnow, agl);
    await drain(); // continuations the frame itself scheduled
    const ms = realNow() - f0;
    const heap1 = v8.getHeapStatistics().used_heap_size;
    // arrival timeline: drawn chunks per engine after this frame
    const ready = engines.map((en) => {
      let k = 0;
      for (const c of en.e.chunks?.values?.() ?? []) if (c.mesh || c.state === 'ready') k++;
      return k;
    });
    const rec = { n: frameNo, t: vnow, phase, ms, heap0, heap1, start: f0, end: f0 + ms, phases: Object.fromEntries(frameRec.phases), ready };
    series.push(rec);
    // --ground-change: how many frames each engine takes to stand entirely on
    // the new ground (audited every 6 frames, off the clock).
    if (GC && GC.at <= vnow && (frameNo - 1) % 6 === 0) {
      GC.converge ??= {};
      const au = groundAudit(engines, GC.box, groundH0);
      const since = Math.round((vnow - GC.at) * 60);
      for (const [k, a] of Object.entries(au)) {
        if (!a.inRegion) continue;
        if (a.old === 0) GC.converge[k] ??= since;
        else delete GC.converge[k]; // fell back (a new chunk on old ground): not converged yet
      }
    }
    return rec;
  }
  const busy = () => {
    if (jobs.length || photoReplies.length || rafs.size) return true; // rafs: a roof fade still running
    for (const en of engines) {
      const e = en.e;
      if (e.queue?.length || e.building > 0 || e.pendingFinalize?.length || e.pendingDrape?.length || e.pendingSample?.length || e.wpPending?.length) return true;
      if (e.settlePending?.()) return true; // FRAME_LEAN.settle: the stand-ins still moving to their canonical state at rest
      // a roof photo still to land (lib/fly/look-roof-patch.js lookRoofPending's first term)
      if (e._lookRoofJobs?.size) for (const job of e._lookRoofJobs.values()) if (!(job.delay > 0)) return true;
    }
    return false;
  };

  // phase A: parked at the start until settled
  const tWall0 = realNow();
  let settleFrames = 0;
  while (settleFrames < o.settleMax * 60) {
    await frame('settle');
    settleFrames++;
    if (settleFrames > 120 && !busy()) break;
  }
  log(`settled the start in ${(settleFrames / 60).toFixed(1)} s virtual (${((realNow() - tWall0) / 1000).toFixed(1)} s wall); in flight next`);
  // phase A2 (third round, `--parked N`): N seconds stationary at the start
  // with the world settled, measured: what the engines cost a frame while
  // nothing is arriving (the idle tax).
  const segRange = {};
  const qAt = () => ({ ...queries });
  const segQ = {};
  if (o.parked > 0) {
    const a = series.length;
    const q = qAt();
    for (let i = 0; i < Math.round(o.parked * 60); i++) await frame('parked');
    segRange.parked = [a, series.length];
    segQ.parked = Object.fromEntries(Object.entries(queries).map(([k, v]) => [k, v - (q[k] ?? 0)]));
  }
  // phase B: the measured flight
  let session = null;
  if (o.sample || o.cpuProf || o.alloc) {
    const { Session } = await import('node:inspector/promises');
    session = new Session();
    session.connect();
    if (o.sample || o.cpuProf) {
      await session.post('Profiler.enable');
      await session.post('Profiler.setSamplingInterval', { interval: 250 });
      await session.post('Profiler.start');
    }
    if (o.alloc) {
      await session.post('HeapProfiler.enable');
      await session.post('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    }
  }
  const flightStart = series.length;
  const q0 = { ...queries };
  const gcStart = gcLog.length;
  const tFlight0 = realNow();
  flight.speed = speed;
  const nFlight = Math.round(o.seconds * 60);
  for (let i = 1; i <= nFlight; i++) {
    place(speed * i * DT);
    await frame('flight');
  }
  const tFlight1 = realNow();
  let cpuProfile = null;
  let allocProfile = null;
  if (session) {
    if (o.sample || o.cpuProf) cpuProfile = (await session.post('Profiler.stop')).profile;
    if (o.alloc) allocProfile = (await session.post('HeapProfiler.stopSampling')).profile;
    session.disconnect();
  }
  const flightEnd = series.length;
  const flightQueries = Object.fromEntries(Object.entries(queries).map(([k, v]) => [k, v - (q0[k] ?? 0)]));
  segRange.flight = [flightStart, flightEnd];
  segQ.flight = flightQueries;
  // phase B2 (third round, `--slow N`): N seconds onward along the route at
  // `--slow-kt` (default 60 kt), measured: a slow taxi-speed drift that brings
  // little new into any ring.
  if (o.slow > 0) {
    const a = series.length;
    const q = qAt();
    const d0 = speed * nFlight * DT;
    const sp = o.slowKt * 0.514444;
    flight.speed = sp;
    for (let i = 1; i <= Math.round(o.slow * 60); i++) {
      place(d0 + sp * i * DT);
      await frame('slow');
    }
    segRange.slow = [a, series.length];
    segQ.slow = Object.fromEntries(Object.entries(queries).map(([k, v]) => [k, v - (q[k] ?? 0)]));
  }
  // phase C: parked at the end, settle for the final state
  flight.speed = 0;
  let tail = 0;
  while (tail < o.tailMax * 60) {
    await frame('tail');
    tail++;
    if (tail >= o.tailMin * 60 && !busy()) break;
  }
  const settledEnd = !busy();
  await new Promise((r) => realSetTimeout(r, 50));
  gcObs.disconnect();

  // --- summarise --------------------------------------------------------------
  const fl = series.slice(flightStart, flightEnd);
  const ms = fl.map((f) => f.ms).sort((a, b) => a - b);
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  const phases = {};
  for (const f of fl) {
    for (const [k, v] of Object.entries(f.phases)) {
      const p = (phases[k] ??= { totalMs: 0, maxMs: 0, frames: 0 });
      p.totalMs += v;
      p.maxMs = Math.max(p.maxMs, v);
      p.frames++;
    }
  }
  const gcs = gcLog.slice(gcStart).filter((g) => g.t >= fl[0].start - 1 && g.t <= fl.at(-1).end + 1);
  const gcInFrames = gcs.filter((g) => fl.some((f) => g.t >= f.start && g.t <= f.end));
  for (const g of gcLog) {
    const f = series.find((x) => g.t >= x.start && g.t <= x.end);
    if (f) f.gcMs = (f.gcMs ?? 0) + g.ms;
  }
  // allocation proxy: the heap growth inside frames (heapUsed after - before,
  // positive parts; a collection inside a frame hides what it freed)
  const growth = fl.reduce((s, f) => s + Math.max(0, f.heap1 - f.heap0), 0);
  // Per segment (third round): frame statistics and, per engine entry point,
  // the mean milliseconds a frame (total / frames, every frame counted).
  const summarize = ([a, b], q) => {
    const fr = series.slice(a, b);
    if (!fr.length) return null;
    const m = fr.map((f) => f.ms).sort((x, y) => x - y);
    const at = (p) => m[Math.min(m.length - 1, Math.floor(p * m.length))];
    const ph = {};
    for (const f of fr) for (const [k, v] of Object.entries(f.phases)) ph[k] = (ph[k] ?? 0) + v;
    return {
      frames: fr.length,
      frame: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: m.at(-1), mean: m.reduce((s, v) => s + v, 0) / m.length, totalSec: m.reduce((s, v) => s + v, 0) / 1000 },
      perFrameMs: Object.fromEntries(Object.entries(ph).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, v / fr.length])),
      groundQueriesPerFrame: Object.fromEntries(Object.entries(q ?? {}).map(([k, v]) => [k, v / fr.length])),
    };
  };
  const segments = {};
  for (const k of ['parked', 'flight', 'slow']) if (segRange[k]) segments[k] = summarize(segRange[k], segQ[k]);
  const report = {
    label: o.label,
    arm: o.arm,
    exact: !!o.exact,
    lean,
    segments,
    groundChange: GC ? { seg: GC.seg, sec: GC.sec, radiusM: GC.radiusM, at: GC.at, box: GC.box, audit: groundAudit(engines, GC.box, groundH0), convergeFrames: GC.converge ?? {} } : null,
    idle: Object.fromEntries(engines.map((en) => [en.name, en.e._idle ?? null])),
    route: r,
    engines: engines.map((e) => e.name),
    model: { groundUs, groundSpinN: spinN, fetchMs: FETCH_MS, serviceMs: 'fetchMs + a + b * KB', service: SERVICE, photoMs: PHOTO_MS, pools: Object.fromEntries(engines.map((e) => [e.name, e.pool.slots.length])) },
    settleSec: settleFrames / 60,
    tailSec: tail / 60,
    settledEnd,
    wallSec: { flight: (tFlight1 - tFlight0) / 1000 },
    worker: statsW,
    flight: {
      frames: fl.length,
      frame: {
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: ms.at(-1),
        mean: ms.reduce((s, v) => s + v, 0) / ms.length,
        over4: ms.filter((v) => v > 4).length,
        over8: ms.filter((v) => v > 8).length,
        over16: ms.filter((v) => v > 16).length,
        totalSec: ms.reduce((s, v) => s + v, 0) / 1000,
      },
      phases,
      gc: {
        count: gcs.length,
        ms: gcs.reduce((s, g) => s + g.ms, 0),
        inFrames: gcInFrames.length,
        inFramesMs: gcInFrames.reduce((s, g) => s + g.ms, 0),
        byKind: gcs.reduce((m, g) => ((m[g.kind] = (m[g.kind] ?? 0) + 1), m), {}),
      },
      heap: { growthMB: growth / 1048576 },
      groundQueries: flightQueries,
    },
    final: finalState(engines),
    series: series.map((f) => ({ n: f.n, ph: f.phase[0], ms: +f.ms.toFixed(3), r: f.ready, ...(f.gcMs ? { gc: +f.gcMs.toFixed(3) } : {}), p: Object.fromEntries(Object.entries(f.phases).map(([k, v]) => [k, +v.toFixed(3)])) })),
  };
  if (cpuProfile) {
    report.hot = hottest(cpuProfile, 30);
    if (o.cpuProf) fs.writeFileSync(path.join(OUT, 'flight.cpuprofile'), JSON.stringify(cpuProfile));
  }
  if (allocProfile) report.alloc = allocSites(allocProfile, 30);
  report.ok = true;
  // A library caller's own look at the engines once the run has ended.
  if (typeof o.inspect === 'function') report.inspect = o.inspect(engines);
  // --dump-heights: every skyline stand-in height table (for diffing two arms).
  if (o.dumpHeights) {
    const sk = engines.find((en) => en.name === 'skyline');
    const dump = {};
    for (const [k, c] of sk?.e.chunks ?? []) if (c.standIns?.base) dump[k] = { h: Array.from(c.standIns.base.array), rLimit: c.standIns.rLimit, gz: Array.from(c.standIns.gz ?? []) };
    fs.writeFileSync(path.join(OUT, 'heights.json'), JSON.stringify(dump));
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report));
  const table = printTable(report);
  fs.writeFileSync(path.join(OUT, 'table.txt'), table);
  log(table);
  log(`wrote ${path.relative(ROOT, OUT)}/report.json`);
  if (o.writePack) {
    const urls = new Set();
    for (const th of threads) {
      const id = msgId++;
      const m = await new Promise((resolve) => {
        waiters.set(id, resolve);
        th.busy++;
        th.postMessage({ op: 'used', id });
      });
      for (const u of m.result ?? []) urls.add(u);
    }
    const store = openStore(storeOpts);
    const pack = {};
    for (const u of [...urls].sort()) {
      const rec = store.get(u);
      if (rec) pack[u] = { status: rec.status, type: rec.type, body: rec.body };
    }
    const file = path.resolve(ROOT, o.writePack);
    const bytes = v8.serialize(pack);
    fs.writeFileSync(file, file.endsWith('.gz') ? zlib.gzipSync(bytes, { level: 9 }) : bytes);
    log(`wrote the pack ${path.relative(ROOT, file)}: ${Object.keys(pack).length} responses, ${(fs.statSync(file).size / 1048576).toFixed(2)} MB`);
  }
  for (const th of threads) await th.terminate();
  for (const en of engines) en.e.dispose?.();
  return report;
}

/**
 * The ground-change run's audit (third round): inside the changed region, how
 * many of each engine's ground samples still hold the OLD ground (the tileZ 15
 * answer) at the end. Buildings: drape runs (zoom); skyline: drape lattice
 * points (zoom) and stand-ins inside the refine limit (gz); vegetation: fine
 * grid points whose height is still the old field's. Roads and clutter drape
 * once at arrival and are not repaired in place (today's behaviour), so they
 * are not audited. Both arms must report the same numbers.
 */
export function groundAudit(engines, box, oldH) {
  if (!box) return null;
  const R = 6378137;
  const lonOf = (x) => (x / R) * (180 / Math.PI);
  const latOf = (z) => (2 * Math.atan(Math.exp(-z / R)) - Math.PI / 2) * (180 / Math.PI);
  const inBox = (x, z) => {
    const lon = lonOf(x), lat = latOf(z);
    return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
  };
  const out = {};
  for (const en of engines) {
    const a = { inRegion: 0, old: 0 };
    for (const c of en.e.chunks?.values?.() ?? []) {
      if (en.name === 'buildings' && c.drapeRuns) {
        for (const r of c.drapeRuns) {
          if (r.end - r.start > 16384 || !inBox(c.cx + r.ax, c.cz + r.az)) continue;
          a.inRegion++;
          if (!(r.zoom >= 16)) a.old++;
        }
      }
      if (en.name === 'skyline') {
        const d = c.drape;
        if (d?.grid) {
          for (let i = 0; i < d.grid.length; i++) {
            const wx = d.minX + (i % (d.n + 1)) * d.step, wz = d.minZ + Math.floor(i / (d.n + 1)) * d.step;
            if (!inBox(wx, wz)) continue;
            a.inRegion++;
            if (!(d.zoom[i] >= 16)) a.old++;
          }
        }
        const S = c.standIns;
        if (S?.gz && c.mesh) {
          const lim = Math.min(S.n, S.rLimit ?? 0);
          for (let i = 0; i < lim; i++) {
            const root = S.parent?.get(i) ?? i;
            if (!inBox(c.mesh.position.x + S.ax[root], c.mesh.position.z + S.az[root])) continue;
            a.inRegion++;
            if (!(S.gz[i] >= 16)) a.old++;
          }
        }
      }
      if (en.name === 'veg' && c.wpGrid && en.e.wpGridSegments) {
        const G = en.e.wpGridSegments;
        for (let gi = 0; gi < c.wpGrid.length; gi++) {
          const wx = c.cx - c.span / 2 + ((gi % (G + 1)) / G) * c.span, wz = c.cz - c.span / 2 + (((gi / (G + 1)) | 0) / G) * c.span;
          if (!inBox(wx, wz)) continue;
          a.inRegion++;
          if (c.wpGrid[gi] === Math.fround(oldH(lonOf(wx), latOf(wz)))) a.old++;
        }
      }
    }
    out[en.name] = a;
  }
  return out;
}

/** Sampled allocation (self bytes) per function from a V8 sampling heap profile. */
function allocSites(profile, n) {
  const self = new Map();
  const walk = (node) => {
    const cf = node.callFrame;
    const k = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/skyloom\//, '')}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + node.selfSize);
    for (const c of node.children ?? []) walk(c);
  };
  walk(profile.head);
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ fn: k, MB: +(v / 1048576).toFixed(2) }));
}

/** Self time per function from a V8 CPU profile. */
function hottest(profile, n) {
  const self = new Map();
  const dt = new Map();
  const { samples, timeDeltas, nodes } = profile;
  for (let i = 0; i < samples.length; i++) dt.set(samples[i], (dt.get(samples[i]) ?? 0) + (timeDeltas[i] ?? 0));
  for (const node of nodes) {
    const cf = node.callFrame;
    if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
    const k = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/skyloom\//, '')}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + (dt.get(node.id) ?? 0) / 1000);
  }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ fn: k, selfMs: +v.toFixed(2) }));
}

/**
 * A hash over every resident chunk's state: each mesh under the engine's
 * object (geometry attribute and index bytes, draw range, groups, instance
 * count, instance matrices, position, visibility) and each chunk record's
 * typed arrays (grids, scatter, stand-in tables; one level into plain
 * objects), plus every group's drawn prefix (instanceCount). Timing fields
 * are never read. `per[engine].chunks` maps a chunk key to its hash, so two
 * reports can be diffed chunk by chunk.
 */
export function finalState(engines) {
  const per = {};
  const all = crypto.createHash('sha256');
  const bytesOf = (h, v) => h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  for (const en of engines) {
    const meshes = [];
    const geoSeen = new Map();
    const geoHash = (g) => {
      if (geoSeen.has(g)) return geoSeen.get(g);
      const h = crypto.createHash('sha256');
      for (const n of Object.keys(g.attributes).sort()) {
        const a = g.attributes[n];
        const arr = a.array ?? a.data?.array;
        h.update(`${n}:${a.itemSize}:${a.normalized ? 1 : 0}:${arr?.constructor?.name}:${arr?.length};`);
        if (arr) bytesOf(h, arr);
      }
      if (g.index) bytesOf(h, g.index.array);
      h.update(JSON.stringify([g.drawRange, g.groups, g.instanceCount ?? null]));
      const d = h.digest('hex');
      geoSeen.set(g, d);
      return d;
    };
    const meshHash = (o) => {
      const h = crypto.createHash('sha256');
      h.update(`${o.type}|${o.name}|${o.position.x},${o.position.y},${o.position.z}|${o.count ?? ''}|${o.visible}|`);
      h.update(geoHash(o.geometry));
      if (o.isInstancedMesh) bytesOf(h, o.instanceMatrix.array.subarray(0, o.count * 16));
      return h.digest('hex');
    };
    const owner = new Map(); // mesh -> chunk key
    const chunkHashes = {};
    const chunkFields = {};
    for (const [k, c] of en.e.chunks ?? []) {
      const h = crypto.createHash('sha256');
      h.update(`${k}|${c.state}|`);
      const fields = {};
      const walk = (v, depth, name) => {
        if (!v || typeof v !== 'object') return;
        if (ArrayBuffer.isView(v)) {
          h.update(`${name}:${v.constructor.name}:${v.length};`);
          bytesOf(h, v);
          fields[name] = crypto.createHash('sha256').update(Buffer.from(v.buffer, v.byteOffset, v.byteLength)).digest('hex').slice(0, 8);
          return;
        }
        if (v.isObject3D) {
          owner.set(v, k);
          if (v.isMesh) {
            const mh = meshHash(v);
            h.update(`${name}=mesh:${mh};`);
            fields[name] = mh.slice(0, 8);
            const g = v.geometry;
            fields[`${name}.ic`] = `${g.instanceCount}|${v.count ?? ''}|${v.visible}|${JSON.stringify(g.drawRange)}`;
            for (const an of Object.keys(g.attributes)) {
              const arr = g.attributes[an].array ?? g.attributes[an].data?.array;
              if (arr) fields[`${name}.${an}`] = crypto.createHash('sha256').update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest('hex').slice(0, 8);
            }
          }
          return;
        }
        if (depth > 1 || v instanceof Map || v instanceof Set || v.isBufferGeometry || v.isMaterial) return;
        if (Array.isArray(v) && v.length > 64) return;
        if (Object.getPrototypeOf(v) !== Object.prototype && !Array.isArray(v)) return;
        for (const key of Object.keys(v)) walk(v[key], depth + 1, `${name}.${key}`);
      };
      for (const key of Object.keys(c)) walk(c[key], 0, key);
      chunkHashes[k] = h.digest('hex').slice(0, 16);
      chunkFields[k] = fields;
    }
    en.e.object?.traverse?.((o) => {
      if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isLineSegments) return;
      meshes.push(`${owner.get(o) ?? '-'}:${meshHash(o)}`);
    });
    meshes.sort();
    const keys = Object.keys(chunkHashes).sort();
    const h = crypto.createHash('sha256').update(meshes.join('\n'));
    for (const k of keys) h.update(`${k}=${chunkHashes[k]};`);
    const hex = h.digest('hex');
    per[en.name] = { meshes: meshes.length, chunks: keys.length, hash: hex, chunkHashes, chunkFields, meshHashes: meshes.map((m) => m.slice(0, 48)) };
    all.update(`${en.name}:${hex};`);
  }
  return { hash: all.digest('hex'), per };
}

function printTable(rep) {
  const f = rep.flight.frame;
  const rows = [];
  rows.push(`flight-cpu ${rep.label}: arm ${rep.arm}${rep.exact ? ' EXACT (virtual clock: timings are not meaningful)' : ''} (engines lean ${rep.lean}), ${rep.flight.frames} flight frames, settle ${rep.settleSec.toFixed(1)} s, tail ${rep.tailSec.toFixed(1)} s${rep.settledEnd ? '' : ' (NOT settled)'}`);
  rows.push(`frame ms  p50 ${f.p50.toFixed(3)}  p95 ${f.p95.toFixed(3)}  p99 ${f.p99.toFixed(3)}  max ${f.max.toFixed(2)}  mean ${f.mean.toFixed(3)}`);
  rows.push(`frames > 4 ms ${f.over4}   > 8 ms ${f.over8}   > 16 ms ${f.over16}   main-thread total ${f.totalSec.toFixed(3)} s`);
  const g = rep.flight.gc;
  rows.push(`gc ${g.count} (${g.ms.toFixed(1)} ms; ${g.inFrames} inside frames, ${g.inFramesMs.toFixed(1)} ms) ${JSON.stringify(g.byKind)}   heap growth in frames ${rep.flight.heap.growthMB.toFixed(1)} MB`);
  rows.push(`ground queries in flight: ${JSON.stringify(rep.flight.groundQueries)} (${rep.model.groundUs} us each)`);
  rows.push(`worker: ${rep.worker.builds} builds (${rep.worker.cacheHits} from the result cache), ${(rep.worker.bytes / 1048576).toFixed(1)} MB, thread ${(rep.worker.threadMs / 1000).toFixed(1)} s`);
  rows.push('phase                                      total ms     max ms   frames');
  for (const [k, p] of Object.entries(rep.flight.phases).sort((a, b) => b[1].totalMs - a[1].totalMs)) {
    rows.push(`${k.padEnd(40)} ${p.totalMs.toFixed(1).padStart(10)} ${p.maxMs.toFixed(2).padStart(10)} ${String(p.frames).padStart(8)}`);
  }
  if (rep.hot) {
    rows.push('hottest functions in the flight window (self ms):');
    for (const h of rep.hot.slice(0, 25)) rows.push(`  ${h.selfMs.toFixed(1).padStart(8)}  ${h.fn}`);
  }
  for (const [name, sg] of Object.entries(rep.segments ?? {})) {
    if (!sg) continue;
    rows.push(`segment ${name}: ${sg.frames} frames, frame ms mean ${sg.frame.mean.toFixed(3)} p50 ${sg.frame.p50.toFixed(3)} p95 ${sg.frame.p95.toFixed(3)} max ${sg.frame.max.toFixed(2)}; ground queries a frame ${JSON.stringify(Object.fromEntries(Object.entries(sg.groundQueriesPerFrame).map(([k, v]) => [k, +v.toFixed(1)])))}`);
    for (const [k, v] of Object.entries(sg.perFrameMs)) if (v >= 0.0005) rows.push(`  ${k.padEnd(38)} ${v.toFixed(4).padStart(9)} ms/frame`);
  }
  if (rep.groundChange) rows.push(`ground change ${rep.groundChange.seg}:${rep.groundChange.sec} at ${rep.groundChange.at?.toFixed?.(2)} s; old-ground samples left in the region: ${JSON.stringify(rep.groundChange.audit)}; frames to converge ${JSON.stringify(rep.groundChange.convergeFrames)}`);
  if (rep.idle) rows.push(`idle counters: ${JSON.stringify(rep.idle)}`);
  if (rep.alloc) {
    rows.push('allocation sites in the flight window (sampled MB, includes the off-clock result decode):');
    for (const h of rep.alloc.slice(0, 20)) rows.push(`  ${h.MB.toFixed(1).padStart(8)}  ${h.fn}`);
  }
  rows.push(`final state ${rep.final.hash.slice(0, 16)}  ${Object.entries(rep.final.per).map(([k, v]) => `${k} ${v.chunks}c/${v.meshes}m ${v.hash.slice(0, 8)}`).join('  ')}`);
  return rows.join('\n');
}
