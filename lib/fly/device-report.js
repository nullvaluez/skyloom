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
import { EARTH_HORIZON } from './fly-constants';
import { OPS_AIRFIELD, OPS_APRON, GATE_TO_GATE, PLAYER_GLOW_LIGHTS, OPS_FEEL, OPS_FX, OPS_AUDIO, CAMERA_DIRECTOR, FLIGHT_DECK, OPS_HANGAR, OPS_DEBRIEF, REPLAY, LOUNGE_PIER, LOUNGE_WALK, LOUNGE_BRIDGE, SEA_STATE, LOUNGE_INSTRUMENTS } from './fly-constants';
import { LIVING_CLOUDS, FAR_CLOUDS, CIRRUS, LIGHT_SHAFTS, LENS_FLARE, FILM_GRADE, NIGHT_SKY, SKY_TRAILS, RAIN_OVERLAY, VAPOR_FX, AIRFRAME_DETAIL, NIGHT_LIGHTS, GROUND_MIST, MENU_GLASS, TITLE_MOTION, FLIGHT_INSTRUMENTS, HANGAR_STAGE } from './fly-constants';
import { CALM_HUD, ENCOUNTER_FEEL, CITY_FACADES, LOUNGE_DIRECTOR, APRON_DETAIL, LOUNGE_MOBILE, MOBILE_ENHANCED } from './fly-constants';
import { SHADER_READY, PACE_ADAPT, DEVICE_POLICY, ULTRA_SUPERSAMPLE, AERIAL_CLARITY, REAL_MOON, SKY_LITE, CITY_RANGE, NIGHT_LITE, NIGHT_RHYTHM, TERRAIN_SHADOW, TRAFFIC_SHADOWS, AIRFRAME_SHADOW, SHADOW_REACH, PHOTO_HIRES, HANGAR_EXPOSURE, CHALLENGE_LAYER, DEEP_LINKS, ANALYTICS_V2, OFFLINE_SHELL } from './fly-constants';
import { getTrueScaleK, TRUE_SCALE_ENV_PATCH, TRUE_SCALE_SHADERS } from './true-scale';
import { OPERATOR_LIVERIES } from './fly-constants';
// SHIP PASS FRAME imports begin
import { censusSnapshot } from './census';
import { frameReportFields } from './frame-api';
import { missedShare } from './tier-budgets';
// SHIP PASS FRAME imports end

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
// One line per pass (TRUE EARTH, GATE TO GATE, LIVING WORLD, PLAY PASS + LOUNGE MOBILE, SHIP PASS);
// no comments inside the braces — gate (6) splits the literal on commas.
const FLAGS = {
  OPERATOR_LIVERIES,
  TWILIGHT_FIX, SUN_TRUE_AZ, HDR_GUARD, LOAD_GUARD, PLAYER_SURFACE, DEVICE_TIERS, TRUE_SCALE, TRUE_AREAS, CONDITIONS, CLOUD_CALM, PHYS_SKY, EARTH_HORIZON,
  OPS_AIRFIELD, OPS_APRON, GATE_TO_GATE, PLAYER_GLOW_LIGHTS, OPS_FEEL, OPS_FX, OPS_AUDIO, CAMERA_DIRECTOR, FLIGHT_DECK, OPS_HANGAR, OPS_DEBRIEF, REPLAY, LOUNGE_PIER, LOUNGE_WALK, LOUNGE_BRIDGE, SEA_STATE, LOUNGE_INSTRUMENTS,
  LIVING_CLOUDS, FAR_CLOUDS, CIRRUS, LIGHT_SHAFTS, LENS_FLARE, FILM_GRADE, NIGHT_SKY, SKY_TRAILS, RAIN_OVERLAY, VAPOR_FX, AIRFRAME_DETAIL, NIGHT_LIGHTS, GROUND_MIST, MENU_GLASS, TITLE_MOTION, FLIGHT_INSTRUMENTS, HANGAR_STAGE,
  CALM_HUD, ENCOUNTER_FEEL, CITY_FACADES, LOUNGE_DIRECTOR, APRON_DETAIL, LOUNGE_MOBILE, MOBILE_ENHANCED,
  SHADER_READY, PACE_ADAPT, DEVICE_POLICY, ULTRA_SUPERSAMPLE, AERIAL_CLARITY, REAL_MOON, SKY_LITE, CITY_RANGE, NIGHT_LITE, NIGHT_RHYTHM, TERRAIN_SHADOW, TRAFFIC_SHADOWS, AIRFRAME_SHADOW, SHADOW_REACH, PHOTO_HIRES, HANGAR_EXPOSURE, CHALLENGE_LAYER, DEEP_LINKS, ANALYTICS_V2, OFFLINE_SHELL,
};

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
  // SHIP PASS FRAME report body begin
  // FR-1 / FR-4 / FR-7: the census (programs first used after the reveal,
  // per-layer draws, logical texture + renderbuffer bytes, stalls by phase),
  // and FR-5 / FR-9 / FR-10: the governor, cadence and device-policy state.
  report.census = censusSnapshot();
  if (report.census.textureBytes) report.renderer.textureBytes = Math.round(report.census.textureBytes.totalMiB * 1048576);
  Object.assign(report, frameReportFields());
  // FR-6: frame time graded as the share of frames over 1.5x the target
  // interval (lib/fly/tier-budgets.js gradeReport), from the frame ring.
  const ring = typeof window === 'undefined' ? null : window.__flyStats?.frame?.ring?.();
  if (report.frame && Array.isArray(ring)) report.frame.missed = { targetFps: report.pacing.targetFps || 60, ...missedShare(ring, report.pacing.targetFps || 60) };
  // SHIP PASS FRAME report body end
  report.grade = gradeReport(report);
  return report;
}
