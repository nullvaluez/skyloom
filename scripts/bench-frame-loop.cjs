#!/usr/bin/env node
/**
 * FRAME LOOP bench (FLY_HORIZON_FILL.md, second round, stream R).
 *
 * What one frame costs on the MAIN THREAD outside the streaming engines:
 * the react-three-fiber frame subscribers, the render passes, the GL calls
 * they issue, the HUD canvases, React commits, long tasks.
 *
 *   node scripts/bench-frame-loop.cjs --url http://localhost:3491 --label base [--arm off]
 *
 * Options
 *   --url <u>        a PRODUCTION server (next start); required
 *   --label <name>   report directory .graphics-review/frame-loop/<label>/
 *   --arm on|off     off adds ?flags=-FRAME_LEAN (the previous frame loop)
 *   --frames <n>     frames sampled per run (default 30)
 *   --warm <s>       seconds after the boot screen is gone before sampling (default 20)
 *   --warmFrames <n> then this many more rendered frames (default 0): one-shot
 *                    per-frame queues (fleet geometry, prewarm) drain by frame
 *                    count, and a software frame is about 2 s
 *   --runs <n>       independent boots (default 2): the run-to-run spread
 *   --dsf <x>        Playwright deviceScaleFactor (default 0.2: a fifth-size
 *                    drawing buffer; CSS pixels, so the level-of-detail logic, unchanged)
 *   --width/--height viewport in CSS pixels (default 1600 x 900)
 *   --proof 1        instead of sampling: the pixel proof. Boots with
 *                    ?graphicsReview=1, holds the simulation (runtime.simHold
 *                    'review'), freezes the clouds (__flyCloudFreeze) and the
 *                    clock (performance.now / Date.now), stops the frame loop,
 *                    then renders the SAME frame with the stream R lean off
 *                    and on in one session (window.__flyFrameLoopLean.set)
 *                    in the order off, off, on, on, off, on, reading the
 *                    drawing buffer after each, and compares the bytes. Also
 *                    records what each arm submitted (the mechanism acted).
 *   --profile 1      also take a CDP CPU profile of the sampled window and
 *                    write the top functions by self time (with a source
 *                    snippet from the production chunk) to profile-<run>.txt
 *
 * Pose: at=48.889,2.246,2072 aircraft=airliner sunUtc=2026-06-21T13:00:00Z
 * weather=baseline, governor held, World Pass tier forced, quality "high",
 * /api/aircraft answered with an empty list.
 *
 * How it measures (nothing in the app is changed; everything is wrapped from
 * an init script):
 *   - three's __THREE_DEVTOOLS__ 'observe' event hands over the Scene and the
 *     WebGLRenderer; the r3f store is scene.__r3f.root.
 *   - each r3f subscriber's ref gets a `current` accessor that times the call
 *     (the subscriber's identity, which r3f uses to unsubscribe, is kept).
 *   - WebGL2RenderingContext.prototype is wrapped: every call is counted
 *     under the active label (a composer pass, the shadow map, a direct
 *     renderer.render, or 'frame' for subscriber-issued calls), with draw
 *     triangles and upload bytes.
 *   - Object3D.prototype.updateMatrixWorld / updateMatrix are counted.
 *   - CanvasRenderingContext2D drawing calls are counted per canvas (HUD).
 *   - a React DevTools hook stub counts commits and the components rendered.
 *   - a longtask observer.
 *
 * What it does NOT measure: frame rate and GPU time. The container renders
 * with SwiftShader (about 0.6 frames a second at this buffer size), so a GL
 * call's CPU cost here includes software rasterisation in the GPU process
 * and is NOT the cost on a real GPU. Counts and main-thread JavaScript time
 * are the honest numbers.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through */ }
  return require('/opt/node-tools/node_modules/playwright');
}

function parseArgs(argv) {
  const a = { url: null, label: 'run', arm: 'on', frames: 30, warm: 20, warmFrames: 0, profile: 0, proof: 0, runs: 2, dsf: 0.2, width: 1600, height: 900, timeout: 420 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, ''), v = argv[i + 1];
    if (k in a) { a[k] = typeof a[k] === 'number' ? Number(v) : v; i++; }
    else throw new Error(`unknown option --${k}`);
  }
  if (!a.url) throw new Error('--url is required (a production server)');
  if (a.arm !== 'on' && a.arm !== 'off') throw new Error('--arm on|off');
  return a;
}

/* ------------------------------------------------------------------------ */
/* The init script: runs in the page before any app code.                    */
/* ------------------------------------------------------------------------ */
function initScript() {
  window.__flyGovPin = 'hold';
  window.__flyWorldPassTierOverride = true;
  try { localStorage.setItem('fly-quality-tier', 'high'); } catch { /* private window */ }

  const B = (window.__benchFL = {
    labels: ['frame'], // label stack; top is the active label
    nestedMs: 0, renderDepth: 0, // render time nested inside a subscriber (subtracted for its self time)
    frame: 0,
    sampling: false,
    cur: null, // the per-frame accumulator
    frames: [],
    scenes: [], renderers: [],
    subMeta: new Map(), // key -> { priority, text }
    canvasIds: new WeakMap(), canvasSeq: 0,
    commits: 0, commitNames: new Map(), commitCauses: new Map(),
    longTasks: [],
    stacks: {}, // first call stack of an unattributed render and of each 2D canvas
  });
  const now = () => performance.now();
  const label = () => B.labels[B.labels.length - 1];
  const newFrame = () => ({ t0: now(), subs: {}, gl: {}, matrix: { world: 0, local: 0 }, matrixBy: {}, uniforms: {}, emptyNames: {}, canvas: {}, commits: 0, renderMs: {} });
  const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

  /* three hands its Scene and WebGLRenderer to the devtools hook. */
  const devtools = new EventTarget();
  devtools.addEventListener('observe', (e) => {
    const d = e.detail;
    if (d && d.isScene) B.scenes.push(d);
    else if (d && typeof d.render === 'function' && d.shadowMap) B.renderers.push(d);
  });
  Object.defineProperty(window, '__THREE_DEVTOOLS__', { value: devtools, configurable: true });

  /* ---------------- WebGL calls ---------------- */
  const KIND = {
    drawArrays: 'draw', drawElements: 'draw', drawArraysInstanced: 'draw', drawElementsInstanced: 'draw', drawRangeElements: 'draw',
    useProgram: 'program', bindTexture: 'bindTexture', activeTexture: 'activeTexture',
    bufferData: 'bufferUpload', bufferSubData: 'bufferUpload',
    texImage2D: 'texUpload', texSubImage2D: 'texUpload', texImage3D: 'texUpload', texSubImage3D: 'texUpload',
    compressedTexImage2D: 'texUpload', compressedTexSubImage2D: 'texUpload', texStorage2D: 'texAlloc', texStorage3D: 'texAlloc',
    bindFramebuffer: 'bindFramebuffer', bindBuffer: 'bindBuffer', bindVertexArray: 'bindVAO', bindBufferBase: 'bindUBO', bindBufferRange: 'bindUBO',
    clear: 'clear', readPixels: 'readPixels', viewport: 'state', scissor: 'state', enable: 'state', disable: 'state',
    blendFunc: 'state', blendFuncSeparate: 'state', blendEquation: 'state', blendEquationSeparate: 'state', depthFunc: 'state',
    depthMask: 'state', colorMask: 'state', cullFace: 'state', frontFace: 'state', polygonOffset: 'state', stencilFunc: 'state',
    getParameter: 'query', getUniformLocation: 'query', getAttribLocation: 'query', getError: 'query', getExtension: 'query',
    getProgramParameter: 'query', getShaderParameter: 'query',
    compileShader: 'compile', linkProgram: 'compile', shaderSource: 'compile',
  };
  const triCount = (mode, count, inst) => (mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0) * (inst || 1);
  const texBytes = (args) => {
    for (const x of args) if (x && typeof x === 'object' && typeof x.byteLength === 'number') return x.byteLength;
    for (const x of args) if (x && typeof x === 'object' && typeof x.width === 'number') return (x.width * x.height * 4) | 0;
    const nums = args.filter((x) => typeof x === 'number');
    return 0 * nums.length;
  };
  const proto = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  const locName = new WeakMap();
  if (proto) {
    const gul = proto.getUniformLocation;
    proto.getUniformLocation = function (program, name) {
      const loc = gul.call(this, program, name);
      if (loc) locName.set(loc, name);
      return loc;
    };
    for (const name of Object.getOwnPropertyNames(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (!desc || typeof desc.value !== 'function' || name === 'constructor') continue;
      const orig = desc.value;
      const kind = KIND[name] || (name.startsWith('uniform') ? 'uniform' : name.startsWith('vertexAttrib') ? 'attrib' : 'other');
      proto[name] = function (...args) {
        const f = B.cur;
        if (f) {
          const g = (f.gl[label()] ||= {});
          bump(g, 'calls'); bump(g, kind);
          if (kind === 'uniform' && args[0]) bump(f.uniforms, `${label().replace(/^.*>/, '')} ${locName.get(args[0]) || '?'}`);
          if (kind === 'draw') {
            let tri = 0;
            if (name === 'drawArrays') tri = triCount(args[0], args[2], 1);
            else if (name === 'drawElements') tri = triCount(args[0], args[1], 1);
            else if (name === 'drawArraysInstanced') tri = triCount(args[0], args[2], args[3]);
            else if (name === 'drawElementsInstanced') tri = triCount(args[0], args[1], args[4]);
            else if (name === 'drawRangeElements') tri = triCount(args[0], args[3], 1);
            bump(g, 'triangles', tri);
            const inst = name === 'drawArraysInstanced' ? args[3] : name === 'drawElementsInstanced' ? args[4] : 1;
            const cnt = name === 'drawArrays' || name === 'drawArraysInstanced' ? args[2] : name === 'drawRangeElements' ? args[3] : args[1];
            if (!inst || !cnt) bump(g, 'emptyDraw');
          } else if (kind === 'bufferUpload') {
            const d = args[1];
            bump(g, 'bufferBytes', typeof d === 'number' ? d : d && d.byteLength ? d.byteLength : 0);
          } else if (kind === 'texUpload') bump(g, 'texBytes', texBytes(args));
        }
        return orig.apply(this, args);
      };
    }
  }

  /* ---------------- 2D canvases (HUD) ---------------- */
  const c2d = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (c2d) {
    for (const name of ['clearRect', 'fillRect', 'fillText', 'strokeText', 'drawImage', 'stroke', 'fill', 'putImageData']) {
      const orig = c2d[name];
      if (typeof orig !== 'function') continue;
      c2d[name] = function (...args) {
        const f = B.cur;
        if (f) {
          const cv = this.canvas;
          let id = B.canvasIds.get(cv);
          if (!id) {
            id = (cv.getAttribute && (cv.getAttribute('data-testid') || cv.className)) || '';
            id = `${id || 'canvas'}#${++B.canvasSeq}${cv.isConnected ? '' : '(offscreen)'}${cv.width}x${cv.height}@${label()}`;
            B.canvasIds.set(cv, id);
            B.stacks[`canvas ${id}`] = String(new Error().stack).split('\n').slice(2, 9).join(' | ');
          }
          const o = (f.canvas[id] ||= {});
          bump(o, name);
        }
        return orig.apply(this, args);
      };
    }
  }

  /* ---------------- React commits ---------------- */
  const nameOf = (fiber) => {
    const t = fiber.type;
    let n = (t && (t.displayName || t.name)) || (t && t.render && (t.render.displayName || t.render.name)) || (t && t.type && (t.type.displayName || t.type.name)) || '?';
    let c = fiber.child, guard = 0;
    while (c && guard++ < 6) {
      if (typeof c.type === 'string' && c.stateNode && c.stateNode.getAttribute) {
        const tag = c.stateNode.getAttribute('data-testid') || (c.stateNode.getAttribute('class') || '').split(' ')[0];
        if (tag) n += `<${c.type}.${tag}>`;
        break;
      }
      c = c.child;
    }
    return n;
  };
  const walkCommit = (root) => {
    const stack = [root.current];
    let visited = 0;
    while (stack.length && visited < 20000) {
      const fiber = stack.pop(); visited++;
      const alt = fiber.alternate;
      // function, class, forwardRef, memo, simpleMemo components that rendered this commit
      if ((fiber.tag === 0 || fiber.tag === 1 || fiber.tag === 11 || fiber.tag === 14 || fiber.tag === 15) && alt &&
          (fiber.memoizedProps !== alt.memoizedProps || fiber.memoizedState !== alt.memoizedState)) {
        const n = nameOf(fiber);
        B.commitNames.set(n, (B.commitNames.get(n) || 0) + 1);
        // the cause: a component whose OWN state (a hook, a store selector) changed
        if (fiber.memoizedState !== alt.memoizedState && fiber.memoizedProps === alt.memoizedProps) B.commitCauses.set(n, (B.commitCauses.get(n) || 0) + 1);
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
  };
  let rid = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r) { const id = ++rid; this.renderers.set(id, r); return id; },
    checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, setStrictMode() {},
    onCommitFiberRoot(_id, root) {
      if (!B.sampling) return;
      B.commits++;
      if (B.cur) B.cur.commits++;
      try { walkCommit(root); } catch { /* best effort */ }
    },
  };

  /* ---------------- long tasks ---------------- */
  try {
    new PerformanceObserver((list) => {
      if (!B.sampling) return;
      for (const e of list.getEntries()) B.longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: false });
  } catch { /* unsupported */ }

  /* ---------------- install on the live scene ---------------- */
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
  const wrapped = new WeakSet();
  function wrapSubscriber(sub) {
    const ref = sub.ref;
    if (!ref || wrapped.has(ref)) return;
    wrapped.add(ref);
    let real = ref.current, key = null, wrapper = null;
    const make = () => {
      const fnText = String(real).replace(/\s+/g, ' ');
      key = `p${sub.priority}:${hash(fnText)}`;
      if (!B.subMeta.has(key)) B.subMeta.set(key, { priority: sub.priority, text: fnText.slice(0, 220), length: fnText.length });
      const k = key, fn = real;
      wrapper = function (state, delta, frame) {
        const f = B.cur;
        if (!f) return fn(state, delta, frame);
        B.labels.push(`sub ${k}`);
        const t = now(), r0 = B.nestedMs;
        try { return fn(state, delta, frame); }
        finally {
          const e = now() - t, nested = B.nestedMs - r0;
          const s = (f.subs[k] ||= { ms: 0, selfMs: 0, n: 0 }); s.ms += e; s.selfMs += e - nested; s.n++;
          B.labels.pop();
        }
      };
    };
    make();
    Object.defineProperty(ref, 'current', {
      configurable: true,
      get() { return wrapper; },
      set(v) { if (v !== real) { real = v; make(); } },
    });
  }
  function wrapRenderer(gl) {
    if (gl.__benchWrapped) return;
    gl.__benchWrapped = true;
    const render = gl.render.bind(gl);
    gl.render = function (scene, camera) {
      const f = B.cur;
      const inPass = label().startsWith('pass') || label().includes('>pass');
      if (label() === 'frame' && f) { const k = `render@frame ${scene && scene.name}`; if (!B.stacks[k]) B.stacks[k] = String(new Error().stack).split('\n').slice(2, 10).join(' | '); }
      if (!inPass) B.labels.push(`${label()}>render:${scene && (scene.name || (scene.isScene ? 'scene' : scene.type))}/${camera && camera.type}/${gl.getRenderTarget() ? 'rt' : 'screen'}`);
      const t = now(), outer = B.renderDepth++ === 0;
      try { return render(scene, camera); }
      finally {
        B.renderDepth--;
        const e = now() - t;
        if (outer) B.nestedMs += e;
        if (f && !inPass) bump(f.renderMs, label(), e);
        if (!inPass) B.labels.pop();
      }
    };
    const sm = gl.shadowMap;
    const smRender = sm.render.bind(sm);
    sm.render = function (...args) {
      B.labels.push(`${label()}>shadow`);
      const f = B.cur, t = now();
      try { return smRender(...args); }
      finally { if (f) bump(f.renderMs, label(), now() - t); B.labels.pop(); }
    };
  }
  function wrapComposer() {
    const c = window.__flyComposer;
    if (!c || !c.passes) return;
    c.passes.forEach((p, i) => {
      if (p.__benchWrapped) return;
      p.__benchWrapped = true;
      const r = p.render.bind(p);
      const name = `pass${i}:${p.name || (p.constructor && p.constructor.name) || 'pass'}`;
      p.render = function (...args) {
        const lab = `${label()}>${name}`;
        B.labels.push(lab);
        const f = B.cur, t = now(), outer = B.renderDepth++ === 0;
        try { return r(...args); }
        finally {
          B.renderDepth--;
          const e = now() - t;
          if (outer) B.nestedMs += e;
          if (f) bump(f.renderMs, lab, e);
          B.labels.pop();
        }
      };
    });
  }
  B.install = function install() {
    const scene = B.scenes.find((s) => s.__r3f && s.__r3f.root);
    if (!scene) return false;
    const store = scene.__r3f.root;
    const state = store.getState();
    B.store = store; B.scene = scene;
    wrapRenderer(state.gl);
    // Object3D matrix work
    if (!B.o3d) {
      const O3D = Object.getPrototypeOf(Object.getPrototypeOf(scene));
      B.o3d = O3D;
      const umw = O3D.updateMatrixWorld, um = O3D.updateMatrix;
      O3D.updateMatrixWorld = function (force) { if (B.cur) { B.cur.matrix.world++; bump(B.cur.matrixBy, `world ${label()}`); } return umw.call(this, force); };
      // objects three submits (default onBeforeRender only: a custom one hides the object from this count)
      const obr = O3D.onBeforeRender;
      O3D.onBeforeRender = function (...args) {
        if (B.cur) { const g = (B.cur.gl[label()] ||= {}); bump(g, 'objects'); if (this.isInstancedMesh && this.count === 0) { bump(g, 'emptyInstanced'); bump(B.cur.emptyNames, `${label().replace(/^.*>/, '')} ${this.name || (this.parent && this.parent.name ? this.parent.name + '/' : '') + ((this.material && this.material.name) || this.material?.type || '?')}`); } }
        return obr.apply(this, args);
      };
      O3D.updateMatrix = function () {
        if (B.cur) {
          B.cur.matrix.local++;
          const k = `local ${label()}`;
          bump(B.cur.matrixBy, k);
          if (!B.stacks[k]) B.stacks[k] = String(new Error().stack).split('\n').slice(2, 8).join(' | ');
        }
        return um.call(this);
      };
    }
    // the frame boundary: a subscriber ahead of every other one
    if (!B.boundary) {
      B.boundary = { current: () => {
        B.rendered = (B.rendered || 0) + 1;
        if (!B.sampling) { B.cur = null; return; }
        if (B.cur) { B.cur.ms = now() - B.cur.t0; B.frames.push(B.cur); }
        B.frame++;
        B.cur = newFrame();
      } };
      state.internal.subscribe(B.boundary, -100000, store);
    }
    return true;
  };
  B.rescan = function rescan() {
    if (!B.store) return;
    const subs = B.store.getState().internal.subscribers;
    for (const s of subs) if (s.ref !== B.boundary) wrapSubscriber(s);
    wrapComposer();
  };
  B.census = function census() {
    const out = { objects: 0, meshes: 0, visibleMeshes: 0, notFrustumCulled: 0, matrixAutoUpdate: 0, matrixWorldAutoUpdate: 0, customOnBeforeRender: 0, castShadow: 0, layersNonDefault: 0, instanced: 0, points: 0, lines: 0, sprites: 0 };
    const O3D = B.o3d; const defaultOBR = O3D && O3D.onBeforeRender;
    const walk = (o, vis) => {
      out.objects++;
      const v = vis && o.visible;
      if (o.isMesh) { out.meshes++; if (v) out.visibleMeshes++; if (o.castShadow && v) out.castShadow++; if (o.isInstancedMesh) out.instanced++; }
      if (o.isPoints) out.points++;
      if (o.isLine) out.lines++;
      if (o.isSprite) out.sprites++;
      if (v && (o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.frustumCulled === false) out.notFrustumCulled++;
      if (o.matrixAutoUpdate) out.matrixAutoUpdate++;
      if (o.matrixWorldAutoUpdate !== false) out.matrixWorldAutoUpdate++;
      if (o.onBeforeRender !== defaultOBR) out.customOnBeforeRender++;
      if (o.layers && o.layers.mask !== 1) out.layersNonDefault++;
      for (const c of o.children) walk(c, v);
    };
    if (B.scene) walk(B.scene, true);
    out.subscribers = B.store ? B.store.getState().internal.subscribers.length - 1 : 0;
    return out;
  };
}

/* ------------------------------------------------------------------------ */
/* Report                                                                     */
/* ------------------------------------------------------------------------ */
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r2 = (x) => Math.round(x * 100) / 100;

function summarizeRun(raw) {
  const frames = raw.frames;
  const n = frames.length || 1;
  const subs = {};
  for (const f of frames) for (const [k, s] of Object.entries(f.subs)) { (subs[k] ||= { ms: [], self: [], calls: 0 }); subs[k].ms.push(s.ms); subs[k].self.push(s.selfMs); subs[k].calls += s.n; }
  const subRows = Object.entries(subs).map(([k, s]) => {
    while (s.ms.length < frames.length) s.ms.push(0);
    while (s.self.length < frames.length) s.self.push(0);
    const meta = raw.subMeta[k] || {};
    return { key: k, priority: meta.priority, selfMs: r2(mean(s.self)), selfMedianMs: r2(median(s.self)), meanMs: r2(mean(s.ms)), medianMs: r2(median(s.ms)), maxMs: r2(Math.max(...s.ms)), callsPerFrame: r2(s.calls / n), text: meta.text };
  }).sort((a, b) => b.selfMs - a.selfMs);
  const gl = {};
  for (const f of frames) for (const [lab, g] of Object.entries(f.gl)) { const o = (gl[lab] ||= {}); for (const [k, v] of Object.entries(g)) o[k] = (o[k] || 0) + v; }
  const glRows = Object.entries(gl).map(([lab, g]) => {
    const row = { label: lab };
    for (const [k, v] of Object.entries(g)) row[k] = r2(v / n);
    return row;
  }).sort((a, b) => (b.calls || 0) - (a.calls || 0));
  const renderMs = {};
  for (const f of frames) for (const [lab, v] of Object.entries(f.renderMs)) (renderMs[lab] ||= []).push(v);
  const renderRows = Object.entries(renderMs).map(([lab, v]) => { while (v.length < frames.length) v.push(0); return { label: lab, meanMs: r2(mean(v)), medianMs: r2(median(v)) }; }).sort((a, b) => b.meanMs - a.meanMs);
  const canvas = {};
  for (const f of frames) for (const [id, o] of Object.entries(f.canvas)) { const c = (canvas[id] ||= { frames: 0, ops: 0 }); c.frames++; for (const v of Object.values(o)) c.ops += v; }
  const agg = (pick) => { const o = {}; for (const f of frames) for (const [k, v] of Object.entries(pick(f))) o[k] = (o[k] || 0) + v; return Object.fromEntries(Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 40).map(([k, v]) => [k, r2(v / n)])); };
  const subTotal = frames.map((f) => Object.values(f.subs).reduce((a, s) => a + s.selfMs, 0));
  const glTotal = (k) => mean(frames.map((f) => Object.values(f.gl).reduce((a, g) => a + (g[k] || 0), 0)));
  const sec = raw.sampleMs / 1000;
  return {
    frames: frames.length,
    sampleSeconds: r2(sec),
    frameMs: { mean: r2(mean(frames.map((f) => f.ms))), median: r2(median(frames.map((f) => f.ms))) },
    subscribersMsPerFrame: { mean: r2(mean(subTotal)), median: r2(median(subTotal)) },
    renderMsPerFrame: r2(mean(frames.map((f) => Object.entries(f.renderMs).filter(([k]) => !k.endsWith('>shadow')).reduce((a, [, v]) => a + v, 0)))),
    glPerFrame: { calls: r2(glTotal('calls')), draw: r2(glTotal('draw')), emptyDraw: r2(glTotal('emptyDraw')), objects: r2(glTotal('objects')), emptyInstanced: r2(glTotal('emptyInstanced')), triangles: Math.round(glTotal('triangles')), uniform: r2(glTotal('uniform')), program: r2(glTotal('program')), bindTexture: r2(glTotal('bindTexture')), state: r2(glTotal('state')), bufferUpload: r2(glTotal('bufferUpload')), bufferBytes: Math.round(glTotal('bufferBytes')), texUpload: r2(glTotal('texUpload')), texBytes: Math.round(glTotal('texBytes')), query: r2(glTotal('query')) },
    matrixPerFrame: { updateMatrixWorld: r2(mean(frames.map((f) => f.matrix.world))), updateMatrix: r2(mean(frames.map((f) => f.matrix.local))) },
    matrixBy: agg((f) => f.matrixBy || {}),
    uniformsBy: agg((f) => f.uniforms || {}),
    emptyInstancedBy: agg((f) => f.emptyNames || {}),
    reactCommitsPerFrame: r2(mean(frames.map((f) => f.commits))),
    reactCommitsPerSecond: r2(raw.commits / sec),
    reactRendered: Object.fromEntries([...Object.entries(raw.commitNames)].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, r2(v / n)])),
    reactCauses: Object.fromEntries([...Object.entries(raw.commitCauses || {})].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, r2(v / n)])),
    hudCanvases: Object.fromEntries(Object.entries(canvas).map(([id, c]) => [id, { framesDrawn: c.frames, opsPerFrame: r2(c.ops / n) }])),
    longTasks: { count: raw.longTasks.length, totalMs: raw.longTasks.reduce((a, b) => a + b, 0), max: Math.max(0, ...raw.longTasks) },
    census: raw.census,
    subscribers: subRows,
    gl: glRows,
    renderPasses: renderRows,
    boot: raw.boot,
    stacks: raw.stacks,
  };
}

function spread(runs, pick) {
  const xs = runs.map(pick).filter((x) => Number.isFinite(x));
  if (xs.length < 2) return null;
  const m = mean(xs);
  return { values: xs.map(r2), mean: r2(m), spreadPct: m ? r2(((Math.max(...xs) - Math.min(...xs)) / m) * 100) : 0 };
}

function table(report) {
  const L = [];
  const pad = (s, w) => String(s).padEnd(w).slice(0, w);
  const num = (s, w) => String(s).padStart(w);
  L.push(`FRAME LOOP bench  label=${report.label}  arm=${report.arm}  url=${report.url}  runs=${report.runs.length}  frames/run=${report.args.frames}  dsf=${report.args.dsf}`);
  L.push(`renderer: ${report.gpu}`);
  L.push('');
  L.push('Per frame (mean over runs; [spread % across runs])');
  const keys = [
    ['subscribers self ms (JS, no render)', (r) => r.subscribersMsPerFrame.mean],
    ['render ms (SwiftShader-bound)', (r) => r.renderMsPerFrame],
    ['GL calls', (r) => r.glPerFrame.calls],
    ['GL draws', (r) => r.glPerFrame.draw],
    ['  of which draw nothing (0 instances)', (r) => r.glPerFrame.emptyDraw || 0],
    ['objects submitted (default onBeforeRender)', (r) => r.glPerFrame.objects || 0],
    ['  instanced meshes with count 0', (r) => r.glPerFrame.emptyInstanced || 0],
    ['triangles', (r) => r.glPerFrame.triangles],
    ['uniform uploads', (r) => r.glPerFrame.uniform],
    ['program switches', (r) => r.glPerFrame.program],
    ['texture binds', (r) => r.glPerFrame.bindTexture],
    ['state calls', (r) => r.glPerFrame.state],
    ['GL queries (getParameter...)', (r) => r.glPerFrame.query],
    ['buffer uploads', (r) => r.glPerFrame.bufferUpload],
    ['buffer bytes', (r) => r.glPerFrame.bufferBytes],
    ['texture uploads', (r) => r.glPerFrame.texUpload],
    ['texture bytes', (r) => r.glPerFrame.texBytes],
    ['updateMatrixWorld calls', (r) => r.matrixPerFrame.updateMatrixWorld],
    ['updateMatrix calls', (r) => r.matrixPerFrame.updateMatrix],
    ['React commits / frame', (r) => r.reactCommitsPerFrame],
    ['long tasks (count)', (r) => r.longTasks.count],
  ];
  for (const [k, f] of keys) {
    const s = spread(report.runs, f);
    const v = s ? s.mean : r2(f(report.runs[0]));
    L.push(`  ${pad(k, 34)} ${num(v, 12)}${s ? `  [${s.spreadPct}%]` : ''}`);
  }
  const r0 = report.runs[0];
  L.push('');
  L.push('Frame subscribers, run 1 (self ms / frame excluding nested renders, incl. ms, top 30)');
  for (const s of r0.subscribers.slice(0, 30)) L.push(`  ${num(s.selfMs, 7)} ${num(s.meanMs, 7)}  ${pad(s.key, 16)} ${String(s.text || '').slice(0, 100)}`);
  L.push('');
  L.push('GL by label, run 1 (per frame)');
  L.push(`  ${pad('label', 44)} ${num('calls', 8)} ${num('draw', 6)} ${num('empty', 6)} ${num('objs', 6)} ${num('inst0', 6)} ${num('tris', 9)} ${num('unif', 7)} ${num('prog', 5)} ${num('tex', 6)} ${num('state', 6)}`);
  for (const g of r0.gl.slice(0, 30)) L.push(`  ${pad(g.label, 44)} ${num(g.calls || 0, 8)} ${num(g.draw || 0, 6)} ${num(g.emptyDraw || 0, 6)} ${num(g.objects || 0, 6)} ${num(g.emptyInstanced || 0, 6)} ${num(Math.round(g.triangles || 0), 9)} ${num(g.uniform || 0, 7)} ${num(g.program || 0, 5)} ${num(g.bindTexture || 0, 6)} ${num(g.state || 0, 6)}`);
  L.push('');
  L.push('HUD canvases, run 1 (frames drawn of sampled / ops per frame)');
  for (const [id, c] of Object.entries(r0.hudCanvases)) L.push(`  ${pad(id, 50)} ${num(c.framesDrawn, 5)} ${num(c.opsPerFrame, 8)}`);
  L.push('');
  L.push('React components rendered per frame, run 1');
  for (const [k, v] of Object.entries(r0.reactRendered)) L.push(`  ${num(v, 7)}  ${k}`);
  L.push('Matrix updates by label, run 1 (per frame, top 15)');
  for (const [k, v] of Object.entries(r0.matrixBy || {}).slice(0, 15)) L.push(`  ${num(v, 9)}  ${k}`);
  L.push('');
  L.push('Uniform uploads by pass and uniform name, run 1 (per frame, top 30)');
  for (const [k, v] of Object.entries(r0.uniformsBy || {}).slice(0, 30)) L.push(`  ${num(v, 9)}  ${k}`);
  L.push('');
  L.push('Instanced meshes submitted with count 0, run 1 (per frame, top 25)');
  for (const [k, v] of Object.entries(r0.emptyInstancedBy || {}).slice(0, 25)) L.push(`  ${num(v, 9)}  ${k}`);
  L.push('');
  L.push('React components whose own state changed (the commit causes), run 1');
  for (const [k, v] of Object.entries(r0.reactCauses || {})) L.push(`  ${num(v, 7)}  ${k}`);
  L.push('');
  L.push(`Scene census, run 1: ${JSON.stringify(r0.census)}`);
  return L.join('\n');
}

/* In the page: the same frame, lean off and on, read back and compared. */
async function runProof() {
  const B = window.__benchFL, lean = window.__flyFrameLoopLean, rt = window.__fly;
  if (!lean) return { error: 'window.__flyFrameLoopLean missing (needs ?graphicsReview=1 and FRAME_LEAN on)' };
  rt.simHold.add('review');
  const state = B.store.getState();
  // let the hold land, then freeze time and stop the loop
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const T = performance.now(), D = Date.now();
  performance.now = () => T;
  Date.now = () => D;
  state.setFrameloop('never');
  await new Promise((r) => setTimeout(r, 1500));
  const gl = state.gl, ctx = gl.getContext();
  const w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight;
  const hash = (buf) => { let x = 2166136261; for (let i = 0; i < buf.length; i++) x = Math.imul(x ^ buf[i], 16777619); return (x >>> 0).toString(16); };
  const shots = [];
  const seq = ['off', 'off', 'on', 'on', 'off', 'on'];
  for (const arm of seq) {
    lean.set(arm === 'on');
    B.frames = []; B.sampling = true; B.cur = null;
    state.advance(T / 1000, true);
    // close the accumulator this advance filled
    const f = B.cur; B.sampling = false; B.cur = null;
    gl.setRenderTarget(null);
    const px = new Uint8Array(w * h * 4);
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    const total = (k) => (f ? Object.values(f.gl).reduce((s, g) => s + (g[k] || 0), 0) : null);
    shots.push({ arm, px, hash: hash(px), submitted: total('objects'), emptyInstanced: total('emptyInstanced'), draws: total('draw'), uniforms: total('uniform'), glCalls: total('calls'), trafficHidden: rt.trafficLean ? rt.trafficLean.hidden : null });
    await new Promise((r) => setTimeout(r, 300));
  }
  lean.set(true);
  const ref = shots[0].px;
  const diff = (px) => { let n = 0, max = 0; for (let i = 0; i < px.length; i++) { const d = Math.abs(px[i] - ref[i]); if (d) { n++; if (d > max) max = d; } } return { bytesDiffer: n, maxDelta: max }; };
  let nonBlack = 0; for (let i = 0; i < ref.length; i += 4) if (ref[i] | ref[i + 1] | ref[i + 2]) nonBlack++;
  return {
    width: w, height: h, nonBlackPixels: nonBlack,
    uniformDedupe: lean.uniforms ? { ...lean.uniforms } : null,
    shots: shots.map((s) => ({ arm: s.arm, hash: s.hash, ...diff(s.px), submitted: s.submitted, emptyInstanced: s.emptyInstanced, draws: s.draws, uniforms: s.uniforms, glCalls: s.glCalls, trafficHidden: s.trafficHidden })),
    identical: shots.every((s) => s.hash === shots[0].hash),
  };
}

/* CPU profile: self time per function, with the chunk text at its position. */
async function summarizeProfile(profile, page) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas || [];
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    if (!n) continue;
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
    const e = self.get(key) || { ms: 0, cf };
    e.ms += (dt[i] || 0) / 1000;
    self.set(key, e);
  }
  const total = [...self.values()].reduce((x, e) => x + e.ms, 0);
  const rows = [...self.entries()].sort((x, y) => y[1].ms - x[1].ms).slice(0, 70);
  const sources = new Map();
  const out = [`total sampled ${total.toFixed(0)} ms`];
  for (const [key, e] of rows) {
    let snippet = '';
    const url = e.cf.url;
    if (url && url.startsWith('http')) {
      if (!sources.has(url)) sources.set(url, await page.evaluate((u) => fetch(u).then((r) => r.text()).catch(() => ''), url));
      const lines = sources.get(url).split('\n');
      const line = lines[e.cf.lineNumber] || '';
      snippet = line.slice(Math.max(0, e.cf.columnNumber - 10), e.cf.columnNumber + 150).replace(/\s+/g, ' ');
    }
    out.push(`${e.ms.toFixed(1).padStart(8)} ms  ${key}\n            ${snippet}`);
  }
  return out.join('\n');
}

/* ------------------------------------------------------------------------ */
async function bootAndSample(chromium, a, runIndex) {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: a.width, height: a.height }, deviceScaleFactor: a.dsf });
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
    await page.addInitScript(initScript);
    await page.route('**/api/aircraft?*', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'bench' } }));
    const u = new URL(a.url);
    u.searchParams.set('at', '48.889,2.246,2072');
    u.searchParams.set('aircraft', 'airliner');
    u.searchParams.set('sunUtc', '2026-06-21T13:00:00Z');
    u.searchParams.set('weather', 'baseline');
    if (a.arm === 'off') u.searchParams.set('flags', '-FRAME_LEAN');
    if (a.proof) { u.searchParams.set('graphicsReview', '1'); await page.addInitScript(() => { window.__flyCloudFreeze = true; }); }
    const t0 = Date.now();
    await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: a.timeout * 1000 });
    await page.waitForFunction(() => window.__benchFL && window.__benchFL.install(), undefined, { timeout: a.timeout * 1000, polling: 500 });
    const gpu = await page.evaluate(() => { const g = window.__benchFL.store.getState().gl.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; });
    // the boot screen is gone (the player is released) or the boot cap passed
    await page.waitForFunction(() => (window.__flyBoot && window.__flyBoot.pct === 100), undefined, { timeout: a.timeout * 1000, polling: 1000 }).catch(() => errors.push('boot did not reach 100'));
    const bootMs = Date.now() - t0;
    await page.waitForTimeout(a.warm * 1000);
    if (a.warmFrames > 0) {
      const base = await page.evaluate(() => window.__benchFL.rendered || 0);
      await page.waitForFunction((n) => (window.__benchFL.rendered || 0) >= n, base + a.warmFrames, { timeout: a.timeout * 1000, polling: 1000 });
    }
    if (a.proof) {
      const proof = await page.evaluate(runProof);
      return { gpu, summary: null, proof };
    }
    let cdp = null;
    if (a.profile) {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
      await cdp.send('Profiler.start');
    }
    await page.evaluate(() => { const B = window.__benchFL; B.rescan(); B.frames = []; B.commits = 0; B.commitNames = new Map(); B.commitCauses = new Map(); B.longTasks = []; B.sampling = true; B.t0 = performance.now(); B.timer = setInterval(() => B.rescan(), 300); });
    await page.waitForFunction((n) => window.__benchFL.frames.length >= n, a.frames, { timeout: a.timeout * 1000, polling: 500 });
    const raw = await page.evaluate(() => {
      const B = window.__benchFL; B.sampling = false; clearInterval(B.timer);
      return { stacks: B.stacks, frames: B.frames, sampleMs: performance.now() - B.t0, commits: B.commits, commitNames: Object.fromEntries(B.commitNames), commitCauses: Object.fromEntries(B.commitCauses), longTasks: B.longTasks, subMeta: Object.fromEntries(B.subMeta), census: B.census() };
    });
    raw.boot = { ms: bootMs, errors };
    let profileText = null;
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      profileText = await summarizeProfile(profile, page);
    }
    return { gpu, summary: summarizeRun(raw), profileText };
  } finally {
    await browser.close();
  }
}

async function main() {
  const a = parseArgs(process.argv);
  const { chromium } = loadPlaywright();
  const dir = path.join(process.cwd(), '.graphics-review', 'frame-loop', a.label);
  fs.mkdirSync(dir, { recursive: true });
  const report = { label: a.label, arm: a.arm, url: a.url, args: a, started: new Date().toISOString(), gpu: null, runs: [] };
  for (let i = 0; i < a.runs; i++) {
    console.log(`run ${i + 1}/${a.runs} (arm ${a.arm})...`);
    const r = await bootAndSample(chromium, a, i);
    report.gpu = r.gpu;
    if (a.proof) {
      (report.proofs ||= []).push(r.proof);
      fs.writeFileSync(path.join(dir, 'proof.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(r.proof, null, 1));
      continue;
    }
    report.runs.push(r.summary);
    if (r.profileText) fs.writeFileSync(path.join(dir, `profile-${i + 1}.txt`), r.profileText + '\n');
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  }
  if (a.proof) return;
  report.spread = {
    subscribersMs: spread(report.runs, (r) => r.subscribersMsPerFrame.mean),
    glCalls: spread(report.runs, (r) => r.glPerFrame.calls),
    draws: spread(report.runs, (r) => r.glPerFrame.draw),
    uniforms: spread(report.runs, (r) => r.glPerFrame.uniform),
  };
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  const t = table(report);
  fs.writeFileSync(path.join(dir, 'table.txt'), t + '\n');
  console.log(t);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { initScript, summarizeRun, table };
