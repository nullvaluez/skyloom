/**
 * SHIP PASS FRAME (FR-10; DEVICE_POLICY) — the boot micro-benchmark.
 *
 * WHY. The start tier comes from hints Safari does not give reliably (D-02):
 * a masked "Apple GPU" is a 'medium' Mac whatever its size (D-03), an iPad
 * runs the phone profile (D-06), and Chrome on an M-Pro boots Ultra at DPR 2.
 * A short measurement of the two things this game spends its GPU on — fill
 * (full-screen shading) and the cloud march — answers the question the
 * hints cannot.
 *
 * WHAT IT DOES. On a throwaway WebGL2 context (never the game's), it draws a
 * fill shader and a 48-step cloud-march shader into an offscreen target in
 * batches that double until a batch takes `batchMs` or the budget is spent,
 * synchronising each batch with a 1×1 readPixels, and grades the throughput
 * (decideStart, below). Total wall time is capped at `maxMs` (1.5 s); it runs
 * once per device (renderer string) and app version and is cached in
 * localStorage, so later boots cost nothing. It runs inside the boot hold
 * (FlyMode resolves settings pre-mount, behind BootScreen) and can never
 * extend boot by more than the cap. The score records whether
 * EXT_disjoint_timer_query_webgl2 exists (`timer`); the synchronous run
 * cannot wait for a query result, so GPU-time refinement is a follow-up the
 * owner's first reports decide on (FLY_SHIP_PASS.md FRAME report).
 *
 * Off (DEVICE_POLICY off, the shipped state this pass): nothing here runs;
 * benchmarkScore() is null and every policy row answers as before. The
 * thresholds are PROVISIONAL (no device report exists yet; FLY_SHIP_PASS.md
 * W0.6) and live in the DEVICE_POLICY block.
 */
import { shipPassBlock, shipPassOn } from './ship-pass';

export const BENCH_KEY = 'fly-gpu-benchmark-v1';
export const BENCH_VERSION = 1;

/**
 * The decision table (pure; scripts/verify-ship-frame.mjs enumerates it).
 *   score    { fillMpixPerMs, cloudMs, grade? } | null
 *   cls      'phone' | 'tablet' | 'igpu' | 'dgpu' | 'software'
 *   masked   the renderer string is Safari's masked "Apple GPU"
 * → { grade, tier, preset, dprCap, tabletDesktopEffects }
 */
export function gradeScore(score, t) {
  if (!score || !Number.isFinite(score.fillMpixPerMs) || !Number.isFinite(score.cloudMs)) return null;
  if (score.fillMpixPerMs >= t.highFillMpixPerMs && score.cloudMs <= t.highCloudMs) return 'high';
  if (score.fillMpixPerMs >= t.mediumFillMpixPerMs && score.cloudMs <= t.mediumCloudMs) return 'medium';
  return 'low';
}

export function decideStart({ score = null, cls = 'dgpu', masked = false, thresholds = DEFAULT_THRESHOLDS, ultraDprMax = 2 } = {}) {
  const grade = score?.grade ?? gradeScore(score, thresholds);
  if (!grade) return { grade: null, tier: null, preset: null, dprCap: null, tabletDesktopEffects: false };
  if (cls === 'software') return { grade: 'low', tier: 'low', preset: 'low', dprCap: 1, tabletDesktopEffects: false };
  const touch = cls === 'phone' || cls === 'tablet';
  const tier = grade === 'high' ? 'high' : grade === 'medium' ? (touch ? 'high' : 'medium') : touch ? 'medium' : 'low';
  // Ultra is a desktop preset: a discrete GPU, or a masked/unknown Mac that
  // measured 'high'. Never on touch, never on an integrated part.
  const preset = !touch && grade === 'high' && (cls === 'dgpu' || masked) ? 'ultra' : tier;
  return {
    grade,
    tier,
    preset,
    // Ultra's DPR stays at 1.5 unless the benchmark passes 'high'.
    dprCap: preset === 'ultra' ? ultraDprMax : 1.5,
    // An iPad (tablet) that measures well may take the desktop medium/high
    // effects profile with the touch UI (FR-10). Phones never do.
    tabletDesktopEffects: cls === 'tablet' && (grade === 'high' || grade === 'medium'),
  };
}

const DEFAULT_THRESHOLDS = Object.freeze({ highFillMpixPerMs: 4, mediumFillMpixPerMs: 0.8, highCloudMs: 3, mediumCloudMs: 12 });

const cfg = () => ({ maxMs: 1500, batchMs: 40, size: 512, thresholds: DEFAULT_THRESHOLDS, ...(shipPassBlock('DEVICE_POLICY')?.benchmark ?? {}) });

// ---------------------------------------------------------------------------
// The measurement (browser only)
// ---------------------------------------------------------------------------
const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FILL_FS = `#version 300 es
precision highp float; uniform float u; out vec4 o;
void main(){ vec2 q = gl_FragCoord.xy * 0.01 + u; float a = 0.0;
  for (int i = 0; i < 16; i++) { a += sin(q.x + float(i)) * cos(q.y - a); q = q.yx * 1.01; }
  o = vec4(fract(a), fract(a * 1.7), fract(a * 2.3), 1.0); }`;
const CLOUD_FS = `#version 300 es
precision highp float; uniform float u; out vec4 o;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){ vec3 ro = vec3(gl_FragCoord.xy * 0.02, u), rd = normalize(vec3(0.3, 0.2, 1.0)); float t = 0.0, d = 0.0;
  for (int i = 0; i < 48; i++) { vec3 p = ro + rd * t; d += max(0.0, n(p) + 0.5 * n(p * 2.1) - 0.6) * (1.0 - d); t += 0.15; }
  o = vec4(vec3(d), 1.0); }`;

function program(gl, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('benchmark program did not link');
  return p;
}

/** Run the benchmark now (synchronous, capped). Returns a score or null. */
export function measureGpu(opts = {}) {
  if (typeof document === 'undefined') return null;
  const c = { ...cfg(), ...opts };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const t0 = performance.now();
  const px = new Uint8Array(4);
  try {
    const size = c.size;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, size, size);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const run = (prog, budget) => {
      gl.useProgram(prog);
      const u = gl.getUniformLocation(prog, 'u');
      gl.uniform1f(u, 0.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3); // warm (link, first use)
      sync();
      let n = 1;
      let best = null;
      for (;;) {
        const s = performance.now();
        for (let i = 0; i < n; i++) {
          gl.uniform1f(u, i * 0.37);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        sync();
        const ms = performance.now() - s;
        best = { n, ms };
        if (ms >= c.batchMs || performance.now() - t0 >= budget) break;
        n *= 2;
      }
      return best;
    };
    const fill = run(program(gl, FILL_FS), c.maxMs * 0.5);
    const cloud = run(program(gl, CLOUD_FS), c.maxMs);
    const mpix = (size * size) / 1e6;
    const score = {
      v: BENCH_VERSION,
      fillMpixPerMs: Math.round(((fill.n * mpix) / Math.max(1e-3, fill.ms)) * 1000) / 1000,
      // ms per full 512² cloud march (one draw)
      cloudMs: Math.round((cloud.ms / cloud.n) * 1000) / 1000,
      ms: Math.round(performance.now() - t0),
      timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    };
    score.grade = gradeScore(score, c.thresholds);
    return score;
  } catch {
    return null;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// ---------------------------------------------------------------------------
// The cached score (per device and app version)
// ---------------------------------------------------------------------------
let cached;

// Per device (localStorage is per browser profile) and per app version.
function cacheKeyFor(renderer) {
  return `${BENCH_VERSION}|${process.env.NEXT_PUBLIC_BUILD_SHA || 'dev'}|${renderer || ''}`;
}

/**
 * The score in force this session: cached, or measured once now (inside the
 * boot hold) when DEVICE_POLICY is on. null with the flag off.
 */
export function benchmarkScore({ renderer = '', measure = measureGpu } = {}) {
  if (cached !== undefined) return cached;
  if (!shipPassOn('DEVICE_POLICY') || typeof window === 'undefined') return (cached = null);
  const key = cacheKeyFor(renderer);
  try {
    const raw = JSON.parse(window.localStorage.getItem(BENCH_KEY) || 'null');
    if (raw?.key === key && raw.score) return (cached = raw.score);
  } catch {
    /* corrupt or blocked: measure */
  }
  cached = measure() ?? null;
  try {
    if (cached) window.localStorage.setItem(BENCH_KEY, JSON.stringify({ key, at: Date.now(), score: cached }));
  } catch {
    /* blocked storage: this session still uses the score */
  }
  return cached;
}

/** Test seam. */
export function resetBenchmark(value) {
  cached = value;
}
