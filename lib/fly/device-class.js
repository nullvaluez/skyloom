'use client';

/**
 * Static phone-class gate for performance policy (post-R16 mobile pass).
 *
 * WHY STATIC: the R16 lesson — PerformanceMonitor's onIncline reverts any
 * downward tier nudge within seconds, so anything that must HOLD on a class
 * of device has to be a source gate, not a runtime reaction. This is that
 * gate: decided once per session from what the device IS, never from how a
 * frame happened to run.
 *
 * "Phone" = a coarse-pointer touch device (the use-is-touch pair — BOTH
 * required, so a touchscreen laptop stays desktop) whose smallest screen
 * dimension is under 768 CSS px. Tablets (iPad: 768+) and desktops are NOT
 * phone-class. Graphics policy uses the separate coarse-touch gate below so
 * tablets do not accidentally allocate desktop effects because of screen size.
 */
let pointerWindow, pointerReader, coarsePointer;
export function isMobileGraphicsClass() {
  if (typeof window === 'undefined') return false;
  // A profile is read by several frame drivers. Creating a MediaQueryList on
  // every read adds browser objects/GC to every frame; the list itself is live.
  if (pointerWindow !== window || pointerReader !== window.matchMedia) {
    pointerWindow = window;
    pointerReader = window.matchMedia;
    coarsePointer = window.matchMedia?.('(pointer: coarse)');
  }
  const coarse = coarsePointer?.matches ?? false;
  const hasTouch =
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    'ontouchstart' in window;
  return coarse && hasTouch;
}

export function isPhoneClass() {
  if (!isMobileGraphicsClass()) return false;
  const s = window.screen;
  const minDim = Math.min(
    s?.width ?? window.innerWidth,
    s?.height ?? window.innerHeight
  );
  return minDim > 0 && minDim < 768;
}

/*
 * TRUE EARTH — GPU class from the unmasked WebGL renderer string.
 *
 * Pure (string in, class out) so the device-report grader and node gates use
 * the exact rule the app uses. Classes match the pass's tier budgets
 * (lib/fly/tier-budgets.js): 'high' = discrete desktop GPU or a big Apple
 * Silicon part, 'medium' = integrated laptop GPU (the median web player) or
 * an unknown desktop GPU, 'phone' = a mobile GPU on a touch device, 'low' =
 * a software rasteriser. Safari masks the string ("Apple GPU"), so a coarse-
 * pointer Apple GPU is a phone/tablet and a fine-pointer one is a Mac whose
 * size we cannot see — medium, the safe start.
 */
const SOFTWARE_GPU = /SwiftShader|llvmpipe|softpipe|Microsoft Basic Render|Software Rasterizer/i;
const MOBILE_GPU = /Adreno|Mali|PowerVR|Immortalis|Xclipse|Apple A\d|Apple GPU/i;
const DISCRETE_GPU = /NVIDIA|GeForce|Quadro|RTX|GTX|Radeon\s*(?:\(TM\)\s*)?(?:RX|Pro)\b|Intel\(R\) Arc|\bArc\s?A\d/i;
const APPLE_BIG = /Apple M\d+ (?:Pro|Max|Ultra)/i;
// Entry-level discrete parts that perform like integrated graphics.
const DISCRETE_ENTRY = /GeForce MX\s?\d|GeForce GT \d/i;

/** { cls: 'high'|'medium'|'phone'|'low', reason } from a renderer string. */
export function gpuClass(renderer, { coarse = false } = {}) {
  const r = String(renderer || '');
  if (!r) return { cls: coarse ? 'phone' : 'medium', reason: 'renderer unknown' };
  if (SOFTWARE_GPU.test(r)) return { cls: 'low', reason: 'software rasteriser' };
  if (MOBILE_GPU.test(r)) return { cls: coarse ? 'phone' : 'medium', reason: coarse ? 'mobile GPU, touch' : 'mobile-class GPU, fine pointer' };
  if (APPLE_BIG.test(r)) return { cls: 'high', reason: 'Apple Silicon Pro/Max/Ultra' };
  if (DISCRETE_ENTRY.test(r)) return { cls: 'medium', reason: 'entry-level discrete GPU' };
  if (DISCRETE_GPU.test(r)) return { cls: 'high', reason: 'discrete GPU' };
  return { cls: 'medium', reason: 'integrated or unknown desktop GPU' };
}

/** Unmasked vendor/renderer of a WebGL context (or a throwaway one). */
export function readGpuInfo(gl) {
  let ctx = gl;
  let canvas = null;
  try {
    if (!ctx && typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    }
    if (!ctx) return { vendor: '', renderer: '' };
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    const vendor = String(ext ? ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR));
    const renderer = String(ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER));
    return { vendor, renderer };
  } catch {
    return { vendor: '', renderer: '' };
  } finally {
    if (canvas && ctx) ctx.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
