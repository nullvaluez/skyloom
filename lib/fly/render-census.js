/**
 * SHIP PASS FRAME (FR-4, FR-7) — the draw, triangle and GPU-memory census.
 *
 * Three instruments, installed together by <CensusRig> (FlyCanvas) only when
 * the program census is wanted (SHADER_READY on, `?diag=1`, or automation;
 * lib/fly/program-census.js censusWanted()). None of them changes a GL
 * argument, a result, an error, a program key or a pixel.
 *
 * 1. LAYERS (`__flyStats.census.layers`). `renderer.renderBufferDirect` is an
 *    instance property every draw goes through (the main list, shadow maps,
 *    every composer pass). The wrapper reads `info.render.calls/triangles`
 *    before and after and books the delta to the object's layer: its nearest
 *    named ancestor, else `<top-level type>~<material type>`, cached per object
 *    in a WeakMap. Shadow-map draws (scene argument null) book to
 *    `shadow/<layer>`, draws of another scene (post passes) to `pass/<name>`.
 *    The per-layer sum equals the frame's gl.info totals by construction;
 *    `glCalls` / `glTriangles` carry three's own whole-frame counters when
 *    nothing resets them mid-frame (?diag=1), so a gate can check the 2%.
 *
 * 2. GPU MEMORY (`__flyStats.census.textureBytes`). The logical storage of
 *    every texture and renderbuffer allocated through this context: the
 *    allocation calls (texStorage*, texImage*, compressedTexImage*,
 *    renderbufferStorage*, generateMipmap) are wrapped on the context INSTANCE
 *    (WebGL2RenderingContext.prototype is untouched; the hangar and turntable
 *    canvases are not counted), with the bind calls tracked to know which
 *    handle an allocation lands on. This promotes FlyMode's opt-in
 *    `?graphicsMemory=1` probe (scripts/ground-texture-audit.cjs) to a live
 *    counter, at a fraction of its scope: logical bytes, not driver residency.
 *    RGBA16F is broken out (`rgba16f: { count, bytes, top }`) — the half-float
 *    targets the post chain and the sky allocate are the usual surprise.
 *
 * 3. UPLOAD TIME (FR-7 stall classification). The same wrappers time the
 *    upload calls (tex*Image*, texSubImage*, bufferData, bufferSubData); calls
 *    over 0.5 ms land in a 64-event ring the stall recorder reads
 *    (uploadMsBetween).
 *
 * Cost: the draw wrapper is two reads, two subtractions and one WeakMap hit
 * per draw; the GL wrappers run only on bind/allocation/upload calls.
 */
const LONG_UPLOAD_MS = 0.5;
const EVENTS = 64;

// ---------------------------------------------------------------------------
// 1. Layers
// ---------------------------------------------------------------------------
const layerCache = new WeakMap();

function materialType(o) {
  const m = Array.isArray(o?.material) ? o.material[0] : o?.material;
  return m?.type ?? 'none';
}

/** The census layer of an object (exported for the node gate). */
export function layerOf(object) {
  if (!object) return 'unknown';
  let k = layerCache.get(object);
  if (k !== undefined) return k;
  let top = object;
  for (let n = object; n; n = n.parent) {
    if (n.name) {
      k = n.name;
      break;
    }
    if (n.parent && !n.parent.isScene) top = n.parent;
  }
  if (!k) k = `${top.type ?? 'Object3D'}~${materialType(object)}`;
  layerCache.set(object, k);
  return k;
}

export function createLayerState() {
  return { frame: 0, rows: [], calls: 0, triangles: 0, glCalls: null, glTriangles: null, peakCalls: 0, peakTriangles: 0 };
}

/**
 * Wrap `gl.renderBufferDirect`. `getMainScene()` names the scene whose draws
 * are book by layer. Returns { tick(publish) } — call once per frame BEFORE
 * any draw; it closes the previous frame.
 */
export function installLayerCensus(gl, state, getMainScene) {
  if (!gl || typeof gl.renderBufferDirect !== 'function' || gl.renderBufferDirect.__census) return null;
  const info = gl.info.render;
  const acc = new Map(); // key -> [calls, triangles]
  const orig = gl.renderBufferDirect;
  const wrapped = function censusDraw(camera, scene, geometry, material, object, group) {
    const c0 = info.calls;
    const t0 = info.triangles;
    const out = orig.call(this, camera, scene, geometry, material, object, group);
    const dc = info.calls - c0;
    if (dc > 0) {
      const base = layerOf(object);
      const key = scene == null ? `shadow/${base}` : scene !== getMainScene() ? `pass/${scene.name || base}` : base;
      let row = acc.get(key);
      if (!row) acc.set(key, (row = [0, 0]));
      row[0] += dc;
      row[1] += info.triangles - t0;
    }
    return out;
  };
  wrapped.__census = true;
  gl.renderBufferDirect = wrapped;
  let publishEvery = 30;
  return {
    /** Close the frame that just rendered. `own` = gl.info is not reset mid-frame. */
    tick(own) {
      let calls = 0;
      let tris = 0;
      for (const row of acc.values()) {
        calls += row[0];
        tris += row[1];
      }
      state.frame++;
      state.calls = calls;
      state.triangles = tris;
      if (calls > state.peakCalls) state.peakCalls = calls;
      if (tris > state.peakTriangles) state.peakTriangles = tris;
      state.glCalls = own ? info.calls : null;
      state.glTriangles = own ? info.triangles : null;
      if (state.frame % publishEvery === 1) {
        state.rows = [...acc.entries()]
          .map(([key, [c, t]]) => ({ key, calls: c, triangles: t }))
          .sort((a, b) => b.calls - a.calls);
      }
      for (const row of acc.values()) row[0] = row[1] = 0;
    },
    setPublishEvery(n) {
      publishEvery = Math.max(1, n | 0);
    },
    uninstall() {
      if (gl.renderBufferDirect === wrapped) gl.renderBufferDirect = orig;
    },
  };
}

// ---------------------------------------------------------------------------
// 2 + 3. GPU memory and upload time
// ---------------------------------------------------------------------------
const SIZED = new Map([
  [0x8229, 1], [0x8f94, 1], [0x8231, 1], [0x8232, 1], // R8 R8_SNORM R8I R8UI
  [0x822b, 2], [0x822d, 2], [0x8d62, 2], [0x8056, 2], [0x8057, 2], [0x81a5, 2], // RG8 R16F RGB565 RGBA4 RGB5_A1 DEPTH16
  [0x8051, 3], [0x8c41, 3], // RGB8 SRGB8
  [0x8058, 4], [0x8c43, 4], [0x822e, 4], [0x822f, 4], [0x8059, 4], [0x8c3a, 4], [0x8c3d, 4], [0x8cac, 4], [0x88f0, 4], [0x81a6, 4], [0x84f9, 4], [0x8d7c, 4],
  // RGBA8 SRGB8_A8 R32F RG16F RGB10_A2 R11G11B10F RGB9_E5 DEPTH32F DEPTH24_STENCIL8 DEPTH24 DEPTH_STENCIL RGBA8UI
  [0x881b, 6], // RGB16F
  [0x881a, 8], [0x8230, 8], [0x8cad, 8], // RGBA16F RG32F DEPTH32F_STENCIL8
  [0x8815, 12], [0x8814, 16], // RGB32F RGBA32F
  [0x8d48, 1], // STENCIL_INDEX8
]);
const RGBA16F = 0x881a;
const CHANNELS = new Map([[0x1906, 1], [0x1909, 1], [0x190a, 2], [0x1903, 1], [0x8227, 2], [0x1907, 3], [0x1908, 4], [0x1902, 1]]);
const TYPE_BYTES = new Map([[0x1400, 1], [0x1401, 1], [0x1402, 2], [0x1403, 2], [0x1404, 4], [0x1405, 4], [0x1406, 4], [0x140b, 2], [0x8d61, 2]]);
const PACKED = new Map([[0x8363, 2], [0x8033, 2], [0x8034, 2], [0x8368, 4], [0x8c3b, 4], [0x8c3e, 4], [0x84fa, 4]]);
// Compressed: [blockW, blockH, bytesPerBlock]
const COMPRESSED = new Map();
for (const f of [0x83f0, 0x83f1, 0x8c4c, 0x8c4d, 0x8d64, 0x9270, 0x9271, 0x9274, 0x9275, 0x9276, 0x9277, 0x8dbb, 0x8dbc]) COMPRESSED.set(f, [4, 4, 8]);
for (const f of [0x83f2, 0x83f3, 0x8c4e, 0x8c4f, 0x9272, 0x9273, 0x9278, 0x9279, 0x8dbd, 0x8dbe, 0x8e8c, 0x8e8d, 0x8e8e, 0x8e8f]) COMPRESSED.set(f, [4, 4, 16]);
[[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]].forEach(([w, h], i) => {
  COMPRESSED.set(0x93b0 + i, [w, h, 16]);
  COMPRESSED.set(0x93d0 + i, [w, h, 16]);
});

/** Logical bytes of one image (exported for the node gate). null = unknown format. */
export function imageBytes(internal, format, type, w, h, d = 1) {
  if (!(w >= 0 && h >= 0 && d >= 0)) return null;
  const c = COMPRESSED.get(internal);
  if (c) return Math.ceil(w / c[0]) * Math.ceil(h / c[1]) * c[2] * d;
  const sized = SIZED.get(internal);
  if (sized) return w * h * d * sized;
  const bpp = PACKED.get(type) ?? (CHANNELS.has(format ?? internal) && TYPE_BYTES.has(type) ? CHANNELS.get(format ?? internal) * TYPE_BYTES.get(type) : null);
  return bpp == null ? null : w * h * d * bpp;
}

export function createMemoryState() {
  return { textures: 0, textureBytes: 0, renderbufferBytes: 0, totalBytes: 0, peakBytes: 0, unknown: 0, rgba16f: { count: 0, bytes: 0, top: [] }, uploadMsFrame: 0, uploadEvents: [] };
}

const FACE0 = 0x8515;
const CUBE = 0x8513;

/**
 * Wrap the allocation, bind and upload calls of ONE WebGL2 context instance.
 * `now` is injectable for the node gate. Returns { frame() } — call once per
 * frame to roll `uploadMsFrame`.
 */
export function installMemoryCensus(ctx, state, now = () => performance.now()) {
  if (!ctx || ctx.__flyMemoryCensus) return null;
  ctx.__flyMemoryCensus = true;
  const tex = new Map(); // handle -> { images: Map, bytes, half }
  const rbs = new Map(); // handle -> { bytes, half }
  const bound = new Map(); // `${unit}:${target}` -> handle
  let unit = 0;
  let rb = null;
  let frameUpload = 0;
  const targetOf = (t) => (t >= FACE0 && t < FACE0 + 6 ? CUBE : t);
  const sum = () => {
    state.totalBytes = state.textureBytes + state.renderbufferBytes;
    if (state.totalBytes > state.peakBytes) state.peakBytes = state.totalBytes;
  };
  const halfTop = (bytes, w, h, kind) => {
    const top = state.rgba16f.top;
    top.push({ kind, w, h, mib: Math.round((bytes / 1048576) * 100) / 100 });
    top.sort((a, b) => b.mib - a.mib);
    if (top.length > 8) top.length = 8;
  };
  const recordTex = (target, level, bytes, internal, w, h) => {
    const handle = bound.get(`${unit}:${targetOf(target)}`);
    if (!handle) return;
    let r = tex.get(handle);
    if (!r) {
      r = { images: new Map(), bytes: 0, half: false };
      tex.set(handle, r);
      state.textures++;
    }
    const key = `${target}:${level}`;
    const prev = r.images.get(key) ?? 0;
    if (bytes == null) {
      state.unknown++;
      return;
    }
    r.images.set(key, bytes);
    r.bytes += bytes - prev;
    state.textureBytes += bytes - prev;
    if (internal === RGBA16F && level === 0 && !prev) {
      r.half = true;
      state.rgba16f.count++;
      halfTop(bytes, w, h, 'texture');
    }
    if (internal === RGBA16F) state.rgba16f.bytes += bytes - prev;
    sum();
  };
  const dropTex = (handle) => {
    const r = tex.get(handle);
    if (!r) return;
    state.textureBytes -= r.bytes;
    if (r.half) {
      state.rgba16f.count--;
      state.rgba16f.bytes -= r.bytes;
    }
    state.textures--;
    tex.delete(handle);
    sum();
  };
  const wrap = (name, after, timed = false) => {
    const orig = ctx[name];
    if (typeof orig !== 'function') return;
    ctx[name] = function censusCall(...args) {
      const t0 = timed ? now() : 0;
      const out = orig.apply(this, args);
      if (timed) {
        const ms = now() - t0;
        frameUpload += ms;
        if (ms > LONG_UPLOAD_MS) {
          state.uploadEvents.push({ at: t0, ms, call: name });
          if (state.uploadEvents.length > EVENTS) state.uploadEvents.shift();
        }
      }
      if (after) {
        try {
          after(args, out);
        } catch {
          /* the census never breaks a GL call */
        }
      }
      return out;
    };
  };
  wrap('activeTexture', ([u]) => {
    unit = u - 0x84c0;
  });
  wrap('bindTexture', ([target, handle]) => {
    bound.set(`${unit}:${targetOf(target)}`, handle);
  });
  wrap('deleteTexture', ([handle]) => dropTex(handle));
  wrap('texStorage2D', ([target, levels, internal, w, h]) => {
    const faces = target === CUBE ? [0, 1, 2, 3, 4, 5].map((i) => FACE0 + i) : [target];
    for (const f of faces)
      for (let l = 0; l < levels; l++) recordTex(f === target ? target : f, l, imageBytes(internal, null, null, Math.max(1, w >> l), Math.max(1, h >> l)), internal, w, h);
  }, true);
  wrap('texStorage3D', ([target, levels, internal, w, h, d]) => {
    for (let l = 0; l < levels; l++) recordTex(target, l, imageBytes(internal, null, null, Math.max(1, w >> l), Math.max(1, h >> l), target === 0x8c1a ? d : Math.max(1, d >> l)), internal, w, h);
  }, true);
  wrap('texImage2D', (a) => {
    const [target, level, internal] = a;
    let w, h, format, type;
    if (a.length >= 9) [w, h, , format, type] = a.slice(3, 8);
    else {
      [format, type] = a.slice(3, 5);
      const s = a[5];
      w = s?.videoWidth ?? s?.naturalWidth ?? s?.displayWidth ?? s?.width;
      h = s?.videoHeight ?? s?.naturalHeight ?? s?.displayHeight ?? s?.height;
    }
    recordTex(target, level, imageBytes(internal, format, type, w, h), internal, w, h);
  }, true);
  wrap('texImage3D', (a) => recordTex(a[0], a[1], imageBytes(a[2], a[7], a[8], a[3], a[4], a[5]), a[2], a[3], a[4]), true);
  wrap('compressedTexImage2D', (a) => recordTex(a[0], a[1], imageBytes(a[2], null, null, a[3], a[4]), a[2], a[3], a[4]), true);
  wrap('compressedTexImage3D', (a) => recordTex(a[0], a[1], imageBytes(a[2], null, null, a[3], a[4], a[5]), a[2], a[3], a[4]), true);
  wrap('texSubImage2D', null, true);
  wrap('texSubImage3D', null, true);
  wrap('compressedTexSubImage2D', null, true);
  wrap('bufferData', null, true);
  wrap('bufferSubData', null, true);
  wrap('generateMipmap', ([target]) => {
    const handle = bound.get(`${unit}:${targetOf(target)}`);
    const r = handle && tex.get(handle);
    const base = r?.images.get(`${target}:0`);
    // A mip chain adds a third of the base level (2D targets).
    if (base && !r.images.has(`${target}:mips`)) {
      r.images.set(`${target}:mips`, Math.round(base / 3));
      r.bytes += Math.round(base / 3);
      state.textureBytes += Math.round(base / 3);
      sum();
    }
  });
  wrap('bindRenderbuffer', ([, handle]) => {
    rb = handle;
  });
  const storeRb = (internal, w, h, samples) => {
    if (!rb) return;
    const prev = rbs.get(rb);
    const bytes = (imageBytes(internal, null, null, w, h) ?? 0) * Math.max(1, samples);
    if (prev) {
      state.renderbufferBytes -= prev.bytes;
      if (prev.half) {
        state.rgba16f.count--;
        state.rgba16f.bytes -= prev.bytes;
      }
    }
    const half = internal === RGBA16F;
    rbs.set(rb, { bytes, half });
    state.renderbufferBytes += bytes;
    if (half) {
      state.rgba16f.count++;
      state.rgba16f.bytes += bytes;
      halfTop(bytes, w, h, samples ? `renderbuffer×${samples}` : 'renderbuffer');
    }
    sum();
  };
  wrap('renderbufferStorage', ([, internal, w, h]) => storeRb(internal, w, h, 0));
  wrap('renderbufferStorageMultisample', ([, samples, internal, w, h]) => storeRb(internal, w, h, samples));
  wrap('deleteRenderbuffer', ([handle]) => {
    const r = rbs.get(handle);
    if (!r) return;
    state.renderbufferBytes -= r.bytes;
    if (r.half) {
      state.rgba16f.count--;
      state.rgba16f.bytes -= r.bytes;
    }
    rbs.delete(handle);
    sum();
  });
  ctx.canvas?.addEventListener?.('webglcontextlost', () => {
    tex.clear();
    rbs.clear();
    bound.clear();
    Object.assign(state, { textures: 0, textureBytes: 0, renderbufferBytes: 0, totalBytes: 0, rgba16f: { count: 0, bytes: 0, top: [] } });
  });
  return {
    frame() {
      state.uploadMsFrame = Math.round(frameUpload * 100) / 100;
      frameUpload = 0;
    },
  };
}

/** Sum of long-upload ms whose start falls in [from, to]. */
export function uploadMsBetween(state, from, to) {
  if (!state) return 0;
  let ms = 0;
  for (const e of state.uploadEvents) if (e.at >= from && e.at <= to) ms += e.ms;
  return ms;
}
