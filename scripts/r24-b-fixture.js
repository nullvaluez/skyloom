/**
 * R24 B WORLD — a self-contained, offline MVT fixture for the IN-PROCESS
 * worker leg (the verify-seam idiom: import vector-tile.worker.js straight
 * into node through the comlink/extension loader hooks, then call the SAME
 * `api.buildTile` the app calls).
 *
 * WHY THIS EXISTS. This container cannot reach OpenFreeMap (403), so
 * verify-seam's live-tile node leg cannot run here at all, and every
 * flag-off byte-identity claim about the worker needs SOME deterministic tile
 * bytes. E CERT owns the round's canonical fixture (scripts/r24-fixture/,
 * geojson-vt + vt-pbf, wired into the browser through Playwright
 * context.route); this file is the NODE-ONLY subset B needs before that
 * lands, hand-rolled so it adds no dependency to package.json. When E's
 * generator is available it supersedes this for anything with a browser in
 * it; the worker fingerprints below stay valid either way because they are
 * a pure function of the bytes.
 *
 * WHAT IT ENCODES. Mapbox Vector Tile v2 by hand (protobuf wire format is
 * varints + length-delimited fields; ~70 lines). Crucially it emits ClosePath
 * exactly as a real tileset does, so `@mapbox/vector-tile`'s reader appends
 * `line[0].clone()` on decode — i.e. the fixture reproduces the RING-CLOSURE
 * DUPLICATE that is the root of WB-1/A1. A fixture that skipped ClosePath
 * would silently hide the defect under test.
 *
 * Exports:
 *   encodeTile(layers)      → Uint8Array of MVT bytes
 *   scene(name, opts)       → layers object for a named scene
 *   installFetchStub(fn)    → globalThis.fetch that serves TileJSON + tiles
 */

/* ------------------------------ protobuf ---------------------------------- */

class Writer {
  constructor() {
    this.b = [];
  }
  varint(v) {
    let n = v >>> 0;
    while (n > 0x7f) {
      this.b.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.b.push(n);
    return this;
  }
  tag(field, wire) {
    return this.varint((field << 3) | wire);
  }
  uint(field, v) {
    return this.tag(field, 0).varint(v);
  }
  bytes(field, arr) {
    this.tag(field, 2).varint(arr.length);
    for (let i = 0; i < arr.length; i++) this.b.push(arr[i]);
    return this;
  }
  str(field, s) {
    return this.bytes(field, Array.from(Buffer.from(s, 'utf8')));
  }
  msg(field, w) {
    return this.bytes(field, w.b);
  }
  double(field, v) {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(v, 0);
    this.tag(field, 1);
    for (let i = 0; i < 8; i++) this.b.push(buf[i]);
    return this;
  }
  packed(field, nums) {
    const inner = new Writer();
    for (const n of nums) inner.varint(n);
    return this.bytes(field, inner.b);
  }
  out() {
    return new Uint8Array(this.b);
  }
}

const zig = (n) => (n << 1) ^ (n >> 31);

/** ring [{x,y}, …] (NOT pre-closed) → MVT command/parameter integers. */
function ringGeometry(ring, cursor) {
  const g = [];
  g.push((1 & 0x7) | (1 << 3)); // MoveTo, 1
  g.push(zig(Math.round(ring[0].x) - cursor.x), zig(Math.round(ring[0].y) - cursor.y));
  cursor.x = Math.round(ring[0].x);
  cursor.y = Math.round(ring[0].y);
  g.push((2 & 0x7) | ((ring.length - 1) << 3)); // LineTo, n-1
  for (let i = 1; i < ring.length; i++) {
    const px = Math.round(ring[i].x);
    const py = Math.round(ring[i].y);
    g.push(zig(px - cursor.x), zig(py - cursor.y));
    cursor.x = px;
    cursor.y = py;
  }
  g.push((7 & 0x7) | (1 << 3)); // ClosePath — the duplicate the reader adds
  return g;
}

/**
 * layers = { name: { extent?, features: [{ id?, type?, props, rings }] } }
 * rings: array of rings; ring[0] = outer, rest = holes (opposite winding).
 */
function encodeTile(layers) {
  const tile = new Writer();
  for (const [name, spec] of Object.entries(layers)) {
    const extent = spec.extent ?? 4096;
    const keys = [];
    const keyIdx = new Map();
    const values = [];
    const valIdx = new Map();
    const L = new Writer();
    L.uint(15, 2); // version
    L.str(1, name);
    for (const f of spec.features) {
      const F = new Writer();
      if (f.id != null) F.uint(1, f.id);
      const tags = [];
      for (const [k, v] of Object.entries(f.props ?? {})) {
        if (v == null) continue;
        if (!keyIdx.has(k)) {
          keyIdx.set(k, keys.length);
          keys.push(k);
        }
        const vk = typeof v + ':' + v;
        if (!valIdx.has(vk)) {
          valIdx.set(vk, values.length);
          values.push(v);
        }
        tags.push(keyIdx.get(k), valIdx.get(vk));
      }
      if (tags.length) F.packed(2, tags);
      F.uint(3, f.type ?? 3); // POLYGON
      const cursor = { x: 0, y: 0 };
      const geom = [];
      for (const r of f.rings) geom.push(...ringGeometry(r, cursor));
      F.packed(4, geom);
      L.msg(2, F);
    }
    for (const k of keys) L.str(3, k);
    for (const v of values) {
      const V = new Writer();
      if (typeof v === 'string') V.str(1, v);
      else if (typeof v === 'boolean') V.uint(7, v ? 1 : 0);
      else V.double(3, v);
      L.msg(4, V);
    }
    L.uint(5, extent);
    tile.msg(3, L);
  }
  return tile.out();
}

/* ------------------------------- scenes ----------------------------------- */

const rect = (x, y, w, h, cw) =>
  cw
    ? [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]
    : [
        { x, y },
        { x, y: y + h },
        { x: x + w, y: y + h },
        { x: x + w, y },
      ];

/**
 * Deterministic scenes. `cw:false` matches the LIVE OpenFreeMap winding that
 * R18 measured (every ring negative signed area) — the winding-agnostic
 * classifyRingsSat handles it, and classifyRings (toy, flag-off) does not,
 * which is itself faithful to production.
 */
function scene(name) {
  const B = [];
  const push = (i, x, y, w, h, props, holes) =>
    B.push({ id: i + 1, type: 3, props, rings: holes ? [rect(x, y, w, h, false), ...holes] : [rect(x, y, w, h, false)] });
  if (name === 'dense') {
    // 18×18 = 324 towers on a 4096 grid — the "capped tile" population.
    let i = 0;
    for (let gy = 0; gy < 18; gy++)
      for (let gx = 0; gx < 18; gx++, i++) {
        const x = 60 + gx * 220;
        const y = 60 + gy * 220;
        const h = 30 + ((i * 37) % 160);
        push(i, x, y, 150 + ((i * 13) % 40), 150 + ((i * 29) % 40), {
          render_height: h,
          height: h,
        });
      }
    // one courtyard building (a HOLE — the second degenerate site per ring)
    push(i, 3400, 3400, 500, 500, { render_height: 44, height: 44 }, [
      rect(3550, 3550, 200, 200, true),
    ]);
  } else if (name === 'suburb') {
    let i = 0;
    for (let gy = 0; gy < 8; gy++)
      for (let gx = 0; gx < 8; gx++, i++)
        push(i, 200 + gx * 480, 200 + gy * 480, 120, 90, { render_height: 8, height: 8 });
  } else if (name === 'desert') {
    return { landcover: { features: [{ id: 1, type: 3, props: { class: 'sand' }, rings: [rect(10, 10, 4000, 4000, false)] }] } };
  }
  return { building: { extent: 4096, features: B } };
}

/* ------------------------------ fetch stub -------------------------------- */

const TILEJSON = {
  tiles: ['https://r24-b-fixture.invalid/{z}/{x}/{y}.pbf'],
  minzoom: 0,
  maxzoom: 14,
};

/**
 * Install a globalThis.fetch that serves the TileJSON and, for every tile
 * URL, the bytes returned by `bytesFor(z, x, y)` (return null for a 404).
 * Returns a restore function.
 */
function installFetchStub(bytesFor) {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('tilejson') || u.endsWith('.json') || !u.endsWith('.pbf'))
      return {
        ok: true,
        status: 200,
        json: async () => TILEJSON,
      };
    const m = u.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf/);
    const [z, x, y] = m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
    const bytes = bytesFor(z, x, y);
    if (!bytes) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
  return () => {
    globalThis.fetch = prev;
  };
}

module.exports = { encodeTile, scene, installFetchStub, rect, Writer };
