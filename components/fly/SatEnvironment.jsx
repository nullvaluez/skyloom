'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PMREMGenerator,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
} from 'three';
import { RGBELoader } from 'three-stdlib';
import { SKY, SKY_DUSK, SKY_LIVE } from '@/lib/fly/fly-constants';
import { legacyBucket, resolveSky, skyDuskOn, skyKey, trueElevationDeg } from '@/lib/fly/sky-dusk';
import { clearSkySun, setSkySunElevation } from './SkyDome';

/**
 * Round 16 "Living World" — satellite's sky, unhitched from React.
 *
 * R13 gave satellite four time-of-day HDRIs, but it swapped them by putting
 * the BUCKET IN THE KEY of drei's `<Environment>`: every crossing unmounted
 * the component (restoring the old background), remounted it, re-loaded and
 * re-PMREM'd — a hard cut with a visible one-frame gap, and a brightness STEP
 * because the per-bucket env/bg intensities were four discrete constants. Dusk
 * looked like someone flicking a switch.
 *
 * This owns the same job imperatively:
 *
 *  • ONE PMREMGenerator for the whole app, refcounted at module scope, so
 *    React StrictMode's create→destroy→create can never leave two alive (and
 *    the second create rebuilds one, symmetric). The generator is the
 *    expensive object; the per-sky render targets are cheap.
 *  • Exactly ONE live cubemap render target. A crossing bakes the new one,
 *    assigns `scene.environment` + `scene.background` IN THE SAME FRAME, and
 *    disposes the old target on the NEXT frame — the assignment is atomic from
 *    the renderer's point of view, so there is no frame without a sky and
 *    never a second PMREM output held "just in case".
 *  • PREFETCH: within `SKY_LIVE.hdriFade.preloadFracMargin` of a bucket
 *    boundary the neighbouring .hdr is fetched (decode only, no bake), so the
 *    crossing itself is a bake, not a download.
 *  • A short background DIP across the swap (`hdriFade.dipSec/dipDepth`) masks
 *    the chroma cut — the eye reads a passing dim, not a different sky.
 *  • CONTINUOUS intensity: `f(sun.frac)` piecewise-linear through three
 *    anchors whose values ARE `SKY.hdriCycle.intensity`'s, so noon still
 *    resolves to exactly 0.85/1.0 and deep night to exactly 0.16/0.26 — the
 *    certified numbers — while everything between them moves smoothly. Weather
 *    folds in on top (overcast dims the ambient and the sky; fog eats the sky).
 *
 * SATELLITE ONLY. Toy keeps drei's `<Environment key='toy'>` on the certified
 * noon HDRI, byte-unchanged; this component is never mounted there.
 */

// --- module-scope resources -------------------------------------------------
// The HDR source textures are cached forever (four files, and this is exactly
// what drei's useLoader cache did before — no memory regression). The PMREM
// generator is refcounted so concurrent/StrictMode mounts share one.

const _hdrCache = new Map(); // url -> { texture } | { promise }
let _pmrem = null;
let _pmremGl = null;
let _pmremRefs = 0;

function acquirePmrem(gl) {
  if (_pmrem && _pmremGl !== gl) {
    _pmrem.dispose();
    _pmrem = null;
  }
  if (!_pmrem) {
    _pmrem = new PMREMGenerator(gl);
    _pmremGl = gl;
    _pmrem.compileEquirectangularShader();
  }
  _pmremRefs += 1;
  return _pmrem;
}

function releasePmrem() {
  _pmremRefs -= 1;
  if (_pmremRefs <= 0) {
    _pmremRefs = 0;
    if (_pmrem) _pmrem.dispose();
    _pmrem = null;
    _pmremGl = null;
  }
}

/** Decode an .hdr once; concurrent callers share the in-flight promise. */
function loadHdr(url) {
  const hit = _hdrCache.get(url);
  if (hit?.texture) return Promise.resolve(hit.texture);
  if (hit?.promise) return hit.promise;
  const promise = new Promise((resolve, reject) => {
    // HALF float, not full float — this is a HARD mobile constraint, found
    // live (satellite washed out to a single pale field on iPhone while Neon
    // was fine). RGBA32F is not linear-filterable on Apple GPUs before A17
    // Pro, so iOS WebKit never exposes OES_texture_float_linear there, and
    // three r185 no longer downgrades the filters — it warns and samples an
    // INCOMPLETE texture: undefined on Metal (reads blown-white garbage that
    // ACES+bloom smear over the whole frame; strict GLES drivers read black).
    // RGBA16F is core-filterable in every WebGL2 — and it is what toy's drei
    // <Environment> has always decoded to, which is exactly why Neon worked
    // on the same phone. Half precision is a superset of the 8-bit RGBE
    // mantissas being decoded, so the sky itself is visually unchanged.
    new RGBELoader().setDataType(HalfFloatType).load(
      url,
      (tex) => {
        tex.mapping = EquirectangularReflectionMapping;
        // R16 sweep fix: cap linear-space texels ONCE at load, per role.
        // Two findings behind this (measured, R16 sweep):
        //  1. Baked suns/moons can be enormous in linear space — above any
        //     bloom threshold at ANY backgroundIntensity → mipmap bloom smears
        //     them into a wash. texelCap (generous, 12) bounds that for the
        //     day/dawn/dusk files.
        //  2. qwantani "night" purseky is really a DEEP-TWILIGHT sky: a bright
        //     sunset-remnant band (linear ~2-4) sits on one azimuth. Facing it,
        //     "night" rendered luma 225/255 (facing away: the certified dark).
        //     R13 shipped it un-eyeballed from that heading. nightTexelCap
        //     flattens the band so night is night from EVERY heading.
        // 0 disables either cap.
        const isNight = url === SKY.hdriCycle.night;
        const cap = isNight
          ? (SKY_LIVE.hdriFade.nightTexelCap ?? 0)
          : (SKY_LIVE.hdriFade.texelCap ?? 0);
        if (cap > 0) {
          const d = tex.image?.data;
          if (d) {
            // The data is raw half-float BITS (Uint16). RGBE decodes are
            // never negative, and non-negative halves order the same as
            // their values bit-wise, so one uint16 compare both finds and
            // clamps over-cap texels (NaN/Inf bit patterns land above every
            // finite cap and get clamped with them, which is what we want).
            const capBits = DataUtils.toHalfFloat(cap);
            for (let i = 0; i < d.length; i += 1) if (d[i] > capBits) d[i] = capBits;
            tex.needsUpdate = true;
          }
        }
        resolve(tex);
      },
      undefined,
      reject
    );
  })
    .then((tex) => {
      _hdrCache.set(url, { texture: tex });
      return tex;
    })
    .catch((err) => {
      _hdrCache.delete(url); // a failed fetch must be retryable
      throw err;
    });
  _hdrCache.set(url, { promise });
  return promise;
}

// --- pure helpers -----------------------------------------------------------

/**
 * Round 19 (D) — the EQUIRECT BLENDER.
 *
 * A PMREM bake takes ONE equirect, so a true cross-fade between two HDRIs has
 * to composite them first. This is a 1024×512 half-float scratch target and a
 * two-sampler fullscreen quad: mix in linear space, then PMREM the result and
 * hand the SAME target's texture to `scene.background` (which stays a RAW
 * equirect — the R16 finding that a CubeUV background ignores
 * backgroundIntensity entirely still binds).
 *
 * HalfFloatType is not a quality choice here either — it is the same device
 * contract as the source decode (R16 §9): RGBA16F is core-filterable in every
 * WebGL2, RGBA32F is not on Apple GPUs.
 *
 * The material is a raw ShaderMaterial, so three appends NO tonemapping and NO
 * colorspace chunk: what is sampled is what is written, linear in and linear
 * out. UV orientation round-trips exactly (source uv.y=0 → quad bottom →
 * target row 0 → target uv.y=0), so no flip correction is needed.
 */
function makeBlender(size) {
  const rt = new WebGLRenderTarget(size, size / 2, {
    type: HalfFloatType,
    format: RGBAFormat,
    colorSpace: NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  rt.texture.mapping = EquirectangularReflectionMapping;
  const material = new ShaderMaterial({
    uniforms: { tA: { value: null }, tB: { value: null }, uMix: { value: 0 } },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tA;
      uniform sampler2D tB;
      uniform float uMix;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(
          mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, uMix),
          1.0
        );
      }
    `,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  return { rt, material, quad, scene, camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}

function disposeBlender(b) {
  if (!b) return;
  b.rt.dispose();
  b.quad.geometry.dispose();
  b.material.dispose();
  b.scene.clear();
}

/** Composite A→B at `s` into the scratch equirect and return its texture. */
function renderBlend(gl, b, texA, texB, s) {
  b.material.uniforms.tA.value = texA;
  b.material.uniforms.tB.value = texB;
  b.material.uniforms.uMix.value = s;
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(b.rt);
  gl.render(b.scene, b.camera);
  gl.setRenderTarget(prev);
  return b.rt.texture;
}

const _base = { env: 0, bg: 0 };

/**
 * Continuous env/bg intensity from the sun fraction. Anchored so the values at
 * the anchors are EXACTLY SKY.hdriCycle.intensity's day / dawn / night rows;
 * outside the outer anchors it clamps (noon and deep night are flat).
 */
function baseIntensity(frac) {
  const a = SKY_LIVE.hdriFade.anchors;
  const I = SKY.hdriCycle.intensity;
  let lo;
  let hi;
  let t;
  if (frac >= a.day) {
    _base.env = I.day.env;
    _base.bg = I.day.bg;
    return _base;
  }
  if (frac <= a.night) {
    _base.env = I.night.env;
    _base.bg = I.night.bg;
    return _base;
  }
  if (frac >= a.dawnDusk) {
    lo = I.dawn;
    hi = I.day;
    t = (frac - a.dawnDusk) / (a.day - a.dawnDusk);
  } else {
    lo = I.night;
    hi = I.dawn;
    t = (frac - a.night) / (a.dawnDusk - a.night);
  }
  _base.env = lo.env + (hi.env - lo.env) * t;
  _base.bg = lo.bg + (hi.bg - lo.bg) * t;
  return _base;
}

const dev = process.env.NODE_ENV === 'development';

export function SatEnvironment({ runtime, bucket }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);

  const pmremRef = useRef(null);
  const rtRef = useRef(null); // the LIVE cubemap render target
  const retiredRef = useRef([]); // disposed on the frame AFTER the swap
  const aliveRef = useRef(false);
  const bucketRef = useRef(null); // what is actually on screen
  const swapAtRef = useRef(-1e9);
  const swapsRef = useRef(0);
  const envRef = useRef(null); // damped intensities (null = snap on first frame)
  const bgRef = useRef(null);
  // Round 19 (D): the elevation-keyed sky state. `desiredRef` holds the live
  // descriptor {a, b, s}; `skyState` is only its KEY, so React re-runs the
  // swap effect exactly once per step and never per frame. With the round
  // flagged off the descriptor is {a: bucket, b: bucket, s: 0} — the key IS
  // the prop, so the effect's dependency and behaviour are the R18 ones.
  const desiredRef = useRef(null);
  const skyKeyRef = useRef(null); // last key HANDED to React (no per-frame setState)
  const [skyState, setSkyState] = useState(null);
  const blenderRef = useRef(null);
  // Scales hdriFade.dipDepth for the NEXT swap: 1 for a bucket/pair change (a
  // real chroma cut), SKY_DUSK.blendDipK for an intra-pair blend step (a
  // 1/8 nudge — a full dip would be more visible than the step it masks).
  const dipScaleRef = useRef(1);
  const pairRef = useRef(null);

  // --- lifetime: PMREM + a symmetric restore of everything we touch ---------
  // Declared FIRST so React creates it before the bucket effect below (which
  // needs the generator) and tears it down after that effect's cleanup.
  useEffect(() => {
    const prev = {
      background: scene.background,
      environment: scene.environment,
      envIntensity: scene.environmentIntensity,
      bgIntensity: scene.backgroundIntensity,
    };
    pmremRef.current = acquirePmrem(gl);
    aliveRef.current = true;
    // The retired-target list is mutated in place and never reassigned, so
    // capturing it here is the same array the cleanup needs (and silences the
    // stale-ref-in-cleanup lint, which is aimed at ref'd DOM nodes).
    const retired = retiredRef.current;
    return () => {
      aliveRef.current = false;
      scene.background = prev.background;
      scene.environment = prev.environment;
      scene.environmentIntensity = prev.envIntensity;
      scene.backgroundIntensity = prev.bgIntensity;
      for (const rt of retired) rt.dispose();
      retired.length = 0;
      if (rtRef.current) rtRef.current.dispose();
      rtRef.current = null;
      // Round 19: the blend scratch target is ours alone and dies with us —
      // symmetric with acquire, so StrictMode's create→destroy→create leaves
      // exactly one alive (the same discipline as the PMREM refcount).
      disposeBlender(blenderRef.current);
      blenderRef.current = null;
      bucketRef.current = null;
      pairRef.current = null;
      envRef.current = null;
      bgRef.current = null;
      pmremRef.current = null;
      // This component mounts iff satellite, so our unmount IS the
      // satellite→toy transition: hand the dome's sun channel back.
      clearSkySun();
      releasePmrem();
    };
  }, [scene, gl]);

  // --- the swap: load → bake → assign (same frame) → retire the old ---------
  // Round 19 (D): `skyState` replaces the raw bucket prop. When the round is
  // flagged off it IS the bucket prop (the frame loop mirrors it verbatim), so
  // this is the R18 effect with the R18 dependency. When it is on, a key can
  // also name a PAIR at a blend step, which takes the composite path below.
  useEffect(() => {
    let cancelled = false;
    const key = skyState;
    if (key == null || bucketRef.current === key) return undefined;
    const d = desiredRef.current;
    const blending = !!d && d.s > 0 && d.s < 1 && d.a !== d.b;
    const urlA = SKY.hdriCycle[blending ? d.a : key] ?? SKY.hdri;
    const urlB = blending ? (SKY.hdriCycle[d.b] ?? SKY.hdri) : null;
    Promise.all(blending ? [loadHdr(urlA), loadHdr(urlB)] : [loadHdr(urlA)])
      .then(([texA, texB]) => {
        const pm = pmremRef.current;
        if (cancelled || !aliveRef.current || !pm) return;
        const t0 = performance.now();
        // A pure endpoint (s === 0 or 1) bakes the RAW source texture — the
        // exact R18 path, which is what keeps a settled day/night sky
        // bit-identical. Only a genuine intermediate step pays for the
        // composite, and only while a crossing is in progress.
        const tex = blending
          ? renderBlend(
              gl,
              (blenderRef.current ??= makeBlender(SKY_DUSK.blendSize)),
              texA,
              texB,
              d.s
            )
          : texA;
        const rt = pm.fromEquirectangular(tex);
        // ATOMIC: the new cubemap becomes both the IBL and the visible sky in
        // one go. The old target only dies a frame later (below), so the
        // renderer never sees a null background or two live PMREM outputs in
        // the same draw.
        if (rtRef.current) retiredRef.current.push(rtRef.current);
        rtRef.current = rt;
        scene.environment = rt.texture;
        // Background = the RAW equirect, NOT the PMREM output (drei's pattern,
        // and R13's). Measured in the R16 sweep: a CubeUV texture as
        // scene.background renders at full brightness and IGNORES
        // scene.backgroundIntensity entirely (0.26 vs 0.02 → identical
        // pixels) — the night sky washed white. The equirect lives in the
        // module cache forever, so it must never be disposed here.
        scene.background = tex;
        bucketRef.current = key;
        // A step WITHIN one pair gets a shallow dip; a new pair (a real
        // chroma cut) keeps the full certified dipDepth.
        const pair = blending || d ? `${d?.a}|${d?.b}` : key;
        dipScaleRef.current = pairRef.current === pair ? SKY_DUSK.blendDipK : 1;
        pairRef.current = pair;
        swapsRef.current += 1;
        swapAtRef.current = performance.now();
        if (dev && typeof window !== 'undefined') {
          const stats = (window.__flyStats ??= {});
          stats.envSwapMs = +(performance.now() - t0).toFixed(2);
          stats.envSwaps = swapsRef.current;
          stats.envUrl = blending ? `${urlA}~${urlB}@${d.s}` : urlA;
          stats.envBlend = blending ? d.s : 0;
          stats.skyBucket = key;
          // verify-sat-mobile gates on this: HalfFloatType (1016) or the
          // whole sky is undefined-sampling territory on iOS (see loadHdr).
          // A blended sky is the SAME type by construction (the scratch
          // target is HalfFloatType too — that is a device contract, R16 §9).
          stats.envTexType = tex.type;
        }
      })
      .catch((err) => {
        // A dead CDN must not take the scene with it: keep the previous sky.
        if (dev) console.warn('[fly] HDRI load failed', urlA, err?.message ?? err);
      });
    return () => {
      cancelled = true;
    };
  }, [skyState, scene, gl]);

  // --- per-frame: retire, prefetch, intensity -------------------------------
  useFrame((_, delta) => {
    // (1) The frame after a swap: the old target is provably unreferenced.
    if (retiredRef.current.length) {
      for (const rt of retiredRef.current) rt.dispose();
      retiredRef.current.length = 0;
    }

    const frac = runtime?.sun?.frac ?? 1;
    const az = runtime?.sun?.az ?? 0;
    const duskOn = skyDuskOn();

    // (1b) Round 19 (D) — resolve the sky state and publish the TRUE solar
    //      elevation. runtime.sun.el is the hillshade-CLAMPED value ([8.6°,
    //      51.6°], asin(max(0, sinEl))) and cannot represent a setting sun at
    //      all; sinEl is the documented unclamped truth. This is also the only
    //      writer of the SkyDome's sub-horizon elevation channel.
    const elDeg = trueElevationDeg(runtime?.sun?.sinEl);
    if (duskOn) setSkySunElevation(elDeg);
    const desired = duskOn
      ? resolveSky(az, elDeg)
      : { a: bucket, b: bucket, s: 0, label: bucket };
    desiredRef.current = desired;
    const key = duskOn ? skyKey(desired) : bucket;
    if (key !== skyKeyRef.current) {
      skyKeyRef.current = key;
      setSkyState(key);
    }

    // (2) Prefetch the neighbour across any boundary we are approaching, so a
    //     crossing costs a bake and not a download.
    const hc = SKY.hdriCycle;
    if (duskOn) {
      // Elevation-keyed: warm the twilight file (and the far edge) one blend
      // step before the window opens, so entering dusk is a bake, not a fetch.
      const stepDeg =
        (SKY_DUSK.elDayDeg - SKY_DUSK.elNightDeg) / Math.max(1, SKY_DUSK.blendSteps);
      const nearNight = Math.abs(elDeg - SKY_DUSK.elNightDeg) <= stepDeg;
      const nearDay = Math.abs(elDeg - SKY_DUSK.elDayDeg) <= stepDeg;
      if (nearNight || nearDay) {
        for (const b of [az < 0 ? 'dawn' : 'dusk', nearNight ? 'night' : 'day']) {
          const u = hc[b];
          if (u && !_hdrCache.has(u)) loadHdr(u).catch(() => {});
        }
      }
    } else {
      const margin = SKY_LIVE.hdriFade.preloadFracMargin;
      for (const b of [hc.dayFrac, hc.nightFrac]) {
        if (Math.abs(frac - b) >= margin) continue;
        // the bucket on the OTHER side of this boundary
        const other = legacyBucket(frac >= b ? b - 1e-4 : b + 1e-4, az);
        if (other !== bucketRef.current) {
          const u = hc[other];
          if (u && !_hdrCache.has(u)) loadHdr(u).catch(() => {});
        }
      }
    }

    // (3) Continuous intensity + weather dimming. Two scalar writes; the
    //     renderer reads both at draw time, so this is free.
    const base = baseIntensity(frac);
    const wx = runtime?.weather?.wx;
    const oc = wx ? wx.overcastT : 0;
    const fg = wx ? wx.fogT : 0;
    const wd = SKY_LIVE.weatherDim;
    const envT = base.env * (1 - wd.env * oc);
    const bgT = base.bg * (1 - wd.bg * oc) * (1 - wd.bgFog * fg);

    const k = 1 - Math.exp(-(delta > 0.25 ? 0.25 : delta) / SKY_LIVE.hdriFade.rampSec);
    let env = envRef.current == null ? envT : envRef.current + (envT - envRef.current) * k;
    let bg = bgRef.current == null ? bgT : bgRef.current + (bgT - bgRef.current) * k;
    // Snap once the ramp is visually done, so a settled sky sits on the EXACT
    // certified constant rather than an asymptotic approximation of it.
    if (Math.abs(env - envT) < 1e-4) env = envT;
    if (Math.abs(bg - bgT) < 1e-4) bg = bgT;
    envRef.current = env;
    bgRef.current = bg;

    // (4) The swap dip — applied AFTER the damping so it stays a crisp
    //     transient rather than being smeared into the steady value.
    const since = (performance.now() - swapAtRef.current) / 1000;
    const dipSec = SKY_LIVE.hdriFade.dipSec;
    let bgOut = bg;
    if (since >= 0 && since < dipSec) {
      // Round 19: dipScale is 1 for every R18 swap (and for every pair change),
      // so the certified dip is unchanged; only an intra-pair blend step
      // shallows it — masking a 1/8 nudge with a 45% dim would be louder than
      // the nudge.
      bgOut =
        bg * (1 - SKY_LIVE.hdriFade.dipDepth * dipScaleRef.current * (1 - since / dipSec));
    }

    scene.environmentIntensity = env;
    scene.backgroundIntensity = bgOut;

    if (dev && typeof window !== 'undefined' && window.__flyStats) {
      window.__flyStats.envIntensity = +env.toFixed(4);
      window.__flyStats.bgIntensity = +bgOut.toFixed(4);
      // Round 19 (D) — verify-dusk's probe surface. skyElDeg is the TRUE
      // elevation (never runtime.sun.el, which is clamped at 8.6°).
      window.__flyStats.skyElDeg = +elDeg.toFixed(3);
      window.__flyStats.skyState = desired.label;
      window.__flyStats.skyBlendS = desired.s;
      window.__flyStats.skyDuskOn = duskOn;
    }
  });

  return null;
}
