/**
 * SHIP PASS FRAME (FR-1, FR-4) — the census hub: one install call for
 * FlyCanvas, one snapshot for the device report, the diagnostics panel and
 * the gates. Published under `window.__flyStats.census`:
 *
 *   programs      lib/fly/program-census.js   (FR-1)
 *   layers        lib/fly/render-census.js    (FR-4, closed by <CensusRig>)
 *   textureBytes  lib/fly/render-census.js    (FR-4; logical texture +
 *                 renderbuffer bytes, RGBA16F audit, upload-time ring)
 *   stalls        lib/fly/stall-census.js     (FR-7; >100 ms intervals by phase)
 *
 * Nothing here is installed unless censusWanted() (SHADER_READY on, `?diag=1`
 * or automation), and none of it changes a GL call, a program key or a pixel.
 */
import { censusWanted, installProgramCensus, programCensus } from './program-census';
import { createMemoryState, installMemoryCensus } from './render-census';
import { installStallCensus } from './stall-census';
import { applyShaderErrorPolicy } from './shader-ready';
import { track } from './analytics';

let memory = null;

/** Install every census on a renderer (FlyCanvas onCreated). Idempotent. */
export function installCensus(gl) {
  if (!gl || !censusWanted()) return false;
  installProgramCensus(gl);
  if (!memory || memory.gl !== gl) {
    const state = createMemoryState();
    const ctl = installMemoryCensus(gl.getContext?.(), state);
    if (ctl) {
      memory = { gl, state, ctl };
      if (typeof window !== 'undefined') ((window.__flyStats ??= {}).census ??= {}).textureBytes = state;
    }
  }
  installStallCensus(memoryState);
  return true;
}

/**
 * FlyCanvas onCreated, first thing — before any program or texture exists:
 *  1. FR-2 (SHADER_READY): production builds outside automation skip three's
 *     per-program info-log reads (lib/fly/shader-ready.js). Flag off, dev or
 *     harness: the renderer field is never written (three's default, true).
 *  2. FR-1 / FR-4: the program, memory and stall census (censusWanted() only).
 *  3. Error telemetry for RELEASE (RL-6): a lost context reports
 *     track('client_error', { kind: 'context_lost' }); track() is
 *     consent-gated and never throws, and SessionRecovery still owns recovery.
 */
export function installFrameRenderer(gl) {
  if (!gl) return;
  applyShaderErrorPolicy(gl);
  installCensus(gl);
  gl.domElement?.addEventListener?.('webglcontextlost', () => track('client_error', { kind: 'context_lost' }));
}

/** { frame() } of the memory census, or null. */
export function memoryCensus() {
  return memory?.ctl ?? null;
}

/** The memory census state, or null. */
export function memoryState() {
  return memory?.state ?? null;
}

const MiB = 1048576;
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/**
 * A plain, structured-clone-safe summary (device report, gates). Programs
 * after reveal are listed up to 40 (the full list stays on __flyStats).
 */
export function censusSnapshot() {
  const stats = typeof window === 'undefined' ? {} : window.__flyStats?.census ?? {};
  const p = programCensus();
  const m = memory?.state;
  const l = stats.layers;
  return {
    installed: !!p,
    programs: p
      ? {
          total: p.total,
          live: p.live,
          preReveal: p.preReveal,
          afterRevealCount: p.afterRevealCount,
          afterReveal: p.afterReveal.slice(0, 40),
          firstUseMs: r2(p.firstUseMs),
          worstMs: r2(p.worstMs),
          linkFailures: p.linkFailures,
        }
      : null,
    layers: l ? { calls: l.calls, triangles: l.triangles, glCalls: l.glCalls, glTriangles: l.glTriangles, peakCalls: l.peakCalls, peakTriangles: l.peakTriangles, rows: l.rows.slice(0, 24) } : null,
    textureBytes: m
      ? {
          textures: m.textures,
          textureMiB: r2(m.textureBytes / MiB),
          renderbufferMiB: r2(m.renderbufferBytes / MiB),
          totalMiB: r2(m.totalBytes / MiB),
          peakMiB: r2(m.peakBytes / MiB),
          unknown: m.unknown,
          rgba16f: { count: m.rgba16f.count, mib: r2(m.rgba16f.bytes / MiB), top: m.rgba16f.top.slice() },
        }
      : null,
    stalls: stats.stalls?.summary?.() ?? null,
  };
}
