'use client';
/**
 * TRUE EARTH — the device report the diagnostics overlay sends to the owner's
 * PC (app/api/dev/device-report) and scripts/verify-device-report.mjs grades.
 * Everything here is a READ of state the app already keeps; it allocates only
 * the report object.
 */
import { useFlyStore } from '@/stores/fly-store';
import { gpuClass, isMobileGraphicsClass, isPhoneClass, readGpuInfo } from './device-class';
import { cinemaProfile } from './cinema-policy';
import { gradeReport } from './tier-budgets';
import { TWILIGHT_FIX, SUN_TRUE_AZ, HDR_GUARD, LOAD_GUARD, PLAYER_SURFACE, DEVICE_TIERS, TRUE_SCALE, TRUE_AREAS, CONDITIONS, CLOUD_CALM, PHYS_SKY } from './fly-constants';
import { overrideGlobalName } from './fly-pins';
import { getTrueScaleK, TRUE_SCALE_ENV_PATCH, TRUE_SCALE_SHADERS } from './true-scale';

export const REPORT_SCHEMA = 'skyloom-device-report/1';
const EXTENSIONS = [
  'EXT_clip_control',
  'EXT_disjoint_timer_query_webgl2',
  'KHR_parallel_shader_compile',
  'WEBGL_compressed_texture_astc',
  'WEBGL_compressed_texture_etc',
  'WEBGL_compressed_texture_s3tc',
  'EXT_texture_compression_bptc',
  'EXT_texture_filter_anisotropic',
  'OES_texture_float_linear',
  'EXT_color_buffer_float',
  'EXT_color_buffer_half_float',
];
// Every TRUE EARTH flag block (scripts/verify-true-earth-flags.mjs (6) keeps this complete).
const FLAGS = { TWILIGHT_FIX, SUN_TRUE_AZ, HDR_GUARD, LOAD_GUARD, PLAYER_SURFACE, DEVICE_TIERS, TRUE_SCALE, TRUE_AREAS, CONDITIONS, CLOUD_CALM, PHYS_SKY };

const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/** The effective state of every TRUE EARTH flag (constant default + pin). */
export function resolvedFlags() {
  const out = {};
  for (const [name, block] of Object.entries(FLAGS)) {
    const pin = typeof window === 'undefined' ? null : window[overrideGlobalName(name)];
    out[name] = pin && typeof pin === 'object' && 'enabled' in pin ? pin.enabled === true : block.enabled === true;
  }
  return out;
}

export function collectDeviceReport({ runtime, gl, benchmark = null } = {}) {
  const ctx = gl?.getContext?.() ?? null;
  const gpu = readGpuInfo(ctx);
  const coarse = isMobileGraphicsClass();
  const cls = gpuClass(gpu.renderer, { coarse });
  const supported = new Set(ctx?.getSupportedExtensions?.() ?? []);
  const store = useFlyStore.getState();
  const stats = typeof window === 'undefined' ? {} : window.__flyStats ?? {};
  const frame = typeof stats.frame?.sample === 'function' ? stats.frame.sample() : null;
  let profile = null;
  try {
    profile = cinemaProfile();
  } catch {
    profile = null;
  }
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  const report = {
    schema: REPORT_SCHEMA,
    at: new Date().toISOString(),
    build: { sha: process.env.NEXT_PUBLIC_BUILD_SHA || null, mode: process.env.NODE_ENV },
    page: typeof window === 'undefined' ? null : window.location.pathname + window.location.search,
    flags: { url: typeof window === 'undefined' ? {} : window.__flyUrlFlags ?? {}, resolved: resolvedFlags() },
    trueScale: { k0: round(getTrueScaleK(), 4), envPatch: TRUE_SCALE_ENV_PATCH, shaders: { ...TRUE_SCALE_SHADERS } },
    device: {
      userAgent: nav.userAgent ?? null,
      platform: nav.userAgentData?.platform ?? nav.platform ?? null,
      cores: nav.hardwareConcurrency ?? null,
      memoryGB: nav.deviceMemory ?? null,
      dpr: typeof window === 'undefined' ? null : window.devicePixelRatio,
      viewport: typeof window === 'undefined' ? null : { w: window.innerWidth, h: window.innerHeight },
      coarsePointer: coarse,
      phoneClass: isPhoneClass(),
    },
    gpu: {
      vendor: gpu.vendor,
      renderer: gpu.renderer,
      class: cls.cls,
      classReason: cls.reason,
      webgl2: typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext,
      maxTextureSize: ctx?.getParameter?.(ctx.MAX_TEXTURE_SIZE) ?? null,
      reversedDepth: gl?.capabilities?.reversedDepthBuffer === true,
      extensions: Object.fromEntries(EXTENSIONS.map((e) => [e, supported.has(e)])),
    },
    quality: {
      tier: store.qualityTier,
      preset: store.qualityPreset,
      visuals: store.visuals,
      mapStyle: store.mapStyle,
      pixelRatio: gl?.getPixelRatio?.() ?? null,
      canvas: gl?.domElement ? { w: gl.domElement.width, h: gl.domElement.height } : null,
      profile,
    },
    frame,
    renderer: {
      calls: stats.diag?.calls ?? null,
      triangles: stats.diag?.triangles ?? null,
      callsPeak: stats.diag?.callsPeak ?? null,
      trianglesPeak: stats.diag?.trianglesPeak ?? null,
      programs: gl?.info?.programs?.length ?? null,
      geometries: gl?.info?.memory?.geometries ?? null,
      textures: gl?.info?.memory?.textures ?? null,
      textureBytes: null, // not measurable in-app yet; see TRUE_EARTH_PASS.md
    },
    shadows: runtime?.cinemaShadows ? { ...runtime.cinemaShadows } : null,
    world: {
      lat: round(runtime?.geo?.y, 5),
      lon: round(runtime?.geo?.x, 5),
      altM: round(runtime?.flight?.pos?.y, 1),
      aglM: round(runtime?.flight ? runtime.flight.pos.y - runtime.flight.groundElev : null, 1),
      missing: runtime?.worldReadiness?.missing ?? null,
      arrival: runtime?.arrivalStats ? { ...runtime.arrivalStats, terms: undefined } : null,
      speedPreset: store.speedPreset ?? null,
    },
    traffic: { count: store.trafficCount ?? null, source: store.trafficSource ?? null },
    benchmark,
  };
  report.grade = gradeReport(report);
  return report;
}
