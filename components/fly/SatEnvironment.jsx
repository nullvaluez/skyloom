'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EquirectangularReflectionMapping, FloatType, PMREMGenerator } from 'three';
import { RGBELoader } from 'three-stdlib';
import { SKY, SKY_LIVE } from '@/lib/fly/fly-constants';

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
    new RGBELoader().setDataType(FloatType).load(
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
            for (let i = 0; i < d.length; i += 1) if (d[i] > cap) d[i] = cap;
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

/** The R13 bucket rule, unchanged (FlyScene owns the live one; this mirrors
 *  it only to name the NEIGHBOUR across a boundary for the prefetch). */
function bucketFor(frac, az) {
  const hc = SKY.hdriCycle;
  if (frac >= hc.dayFrac) return 'day';
  if (frac < hc.nightFrac) return 'night';
  return az < 0 ? 'dawn' : 'dusk';
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
      bucketRef.current = null;
      envRef.current = null;
      bgRef.current = null;
      pmremRef.current = null;
      releasePmrem();
    };
  }, [scene, gl]);

  // --- the swap: load → bake → assign (same frame) → retire the old ---------
  useEffect(() => {
    let cancelled = false;
    const url = SKY.hdriCycle[bucket] ?? SKY.hdri;
    if (bucketRef.current === bucket) return undefined;
    loadHdr(url)
      .then((tex) => {
        const pm = pmremRef.current;
        if (cancelled || !aliveRef.current || !pm) return;
        const t0 = performance.now();
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
        bucketRef.current = bucket;
        swapsRef.current += 1;
        swapAtRef.current = performance.now();
        if (dev && typeof window !== 'undefined') {
          const stats = (window.__flyStats ??= {});
          stats.envSwapMs = +(performance.now() - t0).toFixed(2);
          stats.envSwaps = swapsRef.current;
          stats.envUrl = url;
        }
      })
      .catch((err) => {
        // A dead CDN must not take the scene with it: keep the previous sky.
        if (dev) console.warn('[fly] HDRI load failed', url, err?.message ?? err);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket, scene]);

  // --- per-frame: retire, prefetch, intensity -------------------------------
  useFrame((_, delta) => {
    // (1) The frame after a swap: the old target is provably unreferenced.
    if (retiredRef.current.length) {
      for (const rt of retiredRef.current) rt.dispose();
      retiredRef.current.length = 0;
    }

    const frac = runtime?.sun?.frac ?? 1;
    const az = runtime?.sun?.az ?? 0;

    // (2) Prefetch the neighbour across any boundary we are approaching, so a
    //     crossing costs a bake and not a download.
    const hc = SKY.hdriCycle;
    const margin = SKY_LIVE.hdriFade.preloadFracMargin;
    for (const b of [hc.dayFrac, hc.nightFrac]) {
      if (Math.abs(frac - b) >= margin) continue;
      // the bucket on the OTHER side of this boundary
      const other = bucketFor(frac >= b ? b - 1e-4 : b + 1e-4, az);
      if (other !== bucketRef.current) {
        const u = hc[other];
        if (u && !_hdrCache.has(u)) loadHdr(u).catch(() => {});
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
      bgOut = bg * (1 - SKY_LIVE.hdriFade.dipDepth * (1 - since / dipSec));
    }

    scene.environmentIntensity = env;
    scene.backgroundIntensity = bgOut;

    if (dev && typeof window !== 'undefined' && window.__flyStats) {
      window.__flyStats.envIntensity = +env.toFixed(4);
      window.__flyStats.bgIntensity = +bgOut.toFixed(4);
    }
  });

  return null;
}
