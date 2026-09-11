'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color } from 'three';
import { DEPTH_PASS, SKY } from '@/lib/fly/fly-constants';
import { r25Block } from '@/lib/fly/r25-pins';
import { legacyBucket, resolveSky, skyDuskOn, trueElevationDeg } from '@/lib/fly/sky-dusk';
import { resolveSatelliteAtmosphere } from '@/lib/fly/satellite-atmosphere';
import {
  createShadowRungState,
  detachLightBubble,
  hemiGroundFor,
  lightBubbleOn,
  moonDiscBrightness,
  moonPayload,
  publishShadowRadius,
  publishSunRiders,
  setLightBubblePin,
  shadowTexelM,
  stepShadowRadius,
} from '@/lib/fly/light-bubble';
import { useFlyStore } from '@/stores/fly-store';

const _c1 = new Color();
const _c2 = new Color();

/**
 * ROUND 25 (C LIGHT) — LIGHT_BUBBLE_R25's frame half. Renders nothing, adds no
 * object to the scene, issues no draw, compiles nothing, moves no cache key.
 *
 * WHAT IT DOES, and why each one is a property write rather than a feature:
 *
 *  1. SHADOW. The ONE cascade is a fixed 1500 m ortho at 2048² — 1.46 m per
 *     texel, a shadow the size of a bus, and 5.9 m at the 512² low profile.
 *     50–500 ft AGL is exactly the band the user is complaining about, and the
 *     fix costs four numbers on a camera that already exists: the radius
 *     follows the ground bubble down to `radiusLowM` in quantised rungs
 *     (0.34 m/texel at 350 m), so contact shadows exist where the aeroplane is
 *     and nothing else has to pay for them. A SECOND shadow-casting light was
 *     REJECTED: the light COUNT is part of every program's cache key
 *     (lib/fly/prewarm.js:120-126 — three's WebGLPrograms folds light counts,
 *     fog and environment into the key), so adding one recompiles every lit
 *     material in the scene, which is the R21 "everything flashes" mechanism
 *     deliberately re-introduced.
 *
 *  2. AO. The retained N8AO pass's `aoRadius` is 24 m — a radius that measures
 *     city blocks, not the kerb under the wing (recon L6: 0–6 % occlusion
 *     measured at Manhattan). It follows the bubble to `radiusLowM`, with the
 *     intensity coming down as the radius shrinks. High tier only (the pass
 *     exists nowhere else), and the writes are quantised because n8ao's
 *     `configuration` is a Proxy that fires `firstFrame()` on every change.
 *
 *  3. MOON. See lib/fly/immersive.js — the phase and the five night knobs ride
 *     on `runtime.sun.moon` into a pure function FlyScene already calls every
 *     frame (:2737), so the key, the fill, the environment and the cloud pass
 *     all change together with no new call site and no new argument anywhere.
 *
 *  4. HEMI. `hemi.groundColor` is set once at mount from MOODS.satellite.hemi
 *     and never re-written (recon L3), so at midnight every underside in the
 *     world is lit by daytime olive grass. It now follows the SAME bucket
 *     cross-blend the key colour follows — resolved through `resolveSky` /
 *     `legacyBucket` from lib/fly/sky-dusk.js, i.e. the very functions
 *     FlyScene's keyMix effect calls, rather than a copy of its rule. It runs
 *     per frame instead of on that effect's 5 s cadence, which makes the
 *     crossing continuous rather than a step; the endpoints are identical.
 *
 *  5. GRADE. `sun.grade` and `sun.hazeNightFloor` ride the same way into
 *     satellite-atmosphere's bloom threshold / exposure and into FlyScene's
 *     night-ramp line.
 *
 * PRIORITY −48: GroundBubbleRig publishes k at −49 and FlyScene's flight/sun
 * block runs at −50, so this rig reads THIS frame's k — and the two FlyScene
 * readers of `runtime.shadowRadiusM` (the texel snap and the near-receive
 * reach) read the value published on the PREVIOUS frame. A one-frame lag on a
 * number that changes at most once per rung crossing, stated here rather than
 * hidden.
 *
 * Mounted inside <Canvas> from FlyCanvas by one line, only when armed.
 */
export function LightBubbleRig({ runtime }) {
  const scene = useThree((s) => s.scene);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const rungRef = useRef(null);
  const lightsRef = useRef({ sun: null, hemi: null });
  const restoreRef = useRef({ cam: null, hemi: null, ao: null });
  const skyPhaseRef = useRef({ fn: undefined, last: -1 });
  const moonRef = useRef({});
  const liveRef = useRef(null);
  if (rungRef.current == null) rungRef.current = createShadowRungState();
  if (liveRef.current == null) {
    // ONE object, rewritten in place: the dev handle reads it, the frame loop
    // writes it, nothing allocates.
    liveRef.current = {
      k: 0,
      style: mapStyle,
      shadowRadiusM: null,
      shadowRung: null,
      shadowTexelM: null,
      aoRadius: null,
      aoIntensity: null,
      moon: null,
      hemiGround: null,
      hemiSky: null,
      hazeFloor: null,
    };
  }

  // B NIGHT ships `setSkyMoonPhase` in SkyDome.jsx and C may merge first, so
  // the seam is resolved lazily and stays undefined until it exists. A missing
  // seam costs the moon DISC, never a boot.
  useEffect(() => {
    let live = true;
    import('./SkyDome')
      .then((m) => {
        if (live) skyPhaseRef.current.fn = m.setSkyMoonPhase;
      })
      .catch(() => {
        /* the disc keeps its constant brightness */
      });
    return () => {
      live = false;
    };
  }, []);

  // The console / harness handle. `set` merges sub-block-aware into the R25
  // pin (r25-pins merges SHALLOWLY on purpose), so one knob can move without
  // silently dropping the other four. `read` reports what is on the light
  // objects right now, not what was asked for.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__flyLightBubble = {
      read: () => {
        const atmo = runtime?.sun ? resolveSatelliteAtmosphere(runtime.sun, runtime.weather?.wx) : null;
        return {
          ...liveRef.current,
          bloomThreshold: atmo ? atmo.bloomThreshold : null,
          exposureStops: atmo ? atmo.exposureStops : null,
          block: r25Block('LightBubble'),
        };
      },
      set: (patch) => setLightBubblePin(patch),
    };
    return () => {
      if (window.__flyLightBubble) delete window.__flyLightBubble;
    };
  }, [runtime]);

  // Undo every imperative write, so a hot reload or a flag flip cannot leave a
  // 350 m frustum, a night ground colour or a 5 m AO radius behind.
  useEffect(
    () => () => {
      const { sun, hemi } = lightsRef.current;
      const snap = restoreRef.current;
      if (sun?.shadow?.camera && snap.cam) {
        const c = sun.shadow.camera;
        c.left = snap.cam.left;
        c.right = snap.cam.right;
        c.top = snap.cam.top;
        c.bottom = snap.cam.bottom;
        c.updateProjectionMatrix();
      }
      if (hemi && snap.hemi) {
        hemi.groundColor.setHex(snap.hemi.ground);
        hemi.color.setHex(snap.hemi.sky);
      }
      const aoCfg = runtime?.aoPass?.configuration;
      if (aoCfg && snap.ao) {
        aoCfg.aoRadius = snap.ao.radius;
        aoCfg.intensity = snap.ao.intensity;
      }
      detachLightBubble(runtime);
    },
    [runtime]
  );

  useFrame(() => {
    const live = liveRef.current;
    const sat = mapStyle === 'satellite';
    const k = sat ? (runtime?.groundBubble?.k ?? 0) : 0;
    live.style = mapStyle;
    live.k = k;

    // --- the two light objects ------------------------------------------
    // The directional arrives on the runtime bus (FlyScene's one line). The
    // hemisphere has no such publisher, and both lights are DIRECT children of
    // the scene root (FlyScene.jsx:3289, :3292), so the fallback is one walk of
    // that child list, taken only until each is found and still parented.
    let sun = runtime?.sunLight ?? lightsRef.current.sun;
    let hemi = lightsRef.current.hemi;
    if (!sun?.parent || !hemi?.parent) {
      for (const o of scene.children) {
        if (!sun?.parent && o.isDirectionalLight) sun = o;
        if (!hemi?.parent && o.isHemisphereLight) hemi = o;
      }
      lightsRef.current.sun = sun ?? null;
      lightsRef.current.hemi = hemi ?? null;
    }

    const block = r25Block('LightBubble');

    // --- (1) the shadow cascade -----------------------------------------
    if (sat && lightBubbleOn('shadow') && sun?.shadow?.camera) {
      const cam = sun.shadow.camera;
      if (!restoreRef.current.cam) {
        restoreRef.current.cam = { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom };
      }
      const r = stepShadowRadius(rungRef.current, k, block.shadow);
      if (cam.right !== r.radiusM) {
        cam.left = -r.radiusM;
        cam.right = r.radiusM;
        cam.top = r.radiusM;
        cam.bottom = -r.radiusM;
        cam.updateProjectionMatrix();
      }
      publishShadowRadius(runtime, r.radiusM);
      const mapSize = sun.shadow.mapSize?.x ?? 2048;
      live.shadowRadiusM = r.radiusM;
      live.shadowRung = r.rung;
      live.shadowTexelM = shadowTexelM(r.radiusM, mapSize);
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        const stats = (window.__flyStats = window.__flyStats || {});
        stats.shadow = {
          radiusM: r.radiusM,
          texelM: live.shadowTexelM,
          rung: r.rung,
          rawM: r.rawM,
          mapSize,
          k,
        };
      }
    } else {
      publishShadowRadius(runtime, null);
      live.shadowRadiusM = null;
      live.shadowRung = null;
      live.shadowTexelM = null;
    }

    // --- (2) the AO radius ----------------------------------------------
    const pass = runtime?.aoPass;
    const aoConf = pass?.configuration;
    if (sat && lightBubbleOn('ao') && aoConf) {
      if (!restoreRef.current.ao) {
        restoreRef.current.ao = { radius: aoConf.aoRadius, intensity: aoConf.intensity };
      }
      const ao = block.ao;
      const hiR = DEPTH_PASS.n8ao.aoRadius ?? 24;
      const hiI = DEPTH_PASS.n8ao.intensity ?? 5;
      const radius = hiR + ((ao.radiusLowM ?? 5) - hiR) * k;
      const intensity = hiI + ((ao.intensityLow ?? 3.5) - hiI) * k;
      if (Math.abs((aoConf.aoRadius ?? 0) - radius) > 0.05) aoConf.aoRadius = radius;
      if (Math.abs((aoConf.intensity ?? 0) - intensity) > 0.02) aoConf.intensity = intensity;
    }
    live.aoRadius = aoConf?.aoRadius ?? null;
    live.aoIntensity = aoConf?.intensity ?? null;

    // --- (3) the moon and (5) the grade: riders on runtime.sun -----------
    const moonOn = sat && lightBubbleOn('moon');
    const gradeOn = sat && lightBubbleOn('grade');
    const moon = moonOn ? moonPayload(block.moon, Date.now(), moonRef.current) : null;
    publishSunRiders(runtime, {
      moon,
      grade: gradeOn ? gradeOf(block, gradeRef) : null,
      hazeNightFloor: gradeOn ? block.grade.hazeNightFloor : null,
    });
    live.hazeFloor = gradeOn ? block.grade.hazeNightFloor : null;
    // `runtime.immersiveLighting.moon` is what the LIGHT actually used this
    // frame (FlyScene publishes it at :2740) — one frame behind, and the only
    // honest source for `up` and `k`, which immersiveLighting derives itself.
    live.moon = moonOn ? (runtime?.immersiveLighting?.moon ?? { illum: moon.illum, up: null, k: null }) : null;
    if (moon && skyPhaseRef.current.fn && Math.abs(skyPhaseRef.current.last - moon.illum) > 1e-3) {
      skyPhaseRef.current.last = moon.illum;
      // B's seam takes the ILLUMINATION; the disc brightness C's block maps it
      // to rides along for an implementation that wants the number rather than
      // the ratio. A one-argument setter ignores the second.
      skyPhaseRef.current.fn(moon.illum, moonDiscBrightness(moon.illum, block.moon));
    }

    // --- (4) the hemisphere ---------------------------------------------
    if (sat && lightBubbleOn('hemi') && hemi) {
      if (!restoreRef.current.hemi) {
        restoreRef.current.hemi = { ground: hemi.groundColor.getHex(), sky: hemi.color.getHex() };
      }
      const s = runtime?.sun;
      let a = 'day';
      let b = 'day';
      let t = 0;
      if (s) {
        if (skyDuskOn() && Number.isFinite(s.sinEl)) {
          const r = resolveSky(s.az ?? 0, trueElevationDeg(s.sinEl));
          a = r.a;
          b = r.b;
          t = r.s;
        } else {
          a = legacyBucket(s.frac ?? 1, s.az ?? 0);
          b = a;
        }
      }
      const cfg = block.hemi;
      _c1.set(hemiGroundFor(a, cfg));
      if (t > 0) _c1.lerp(_c2.set(hemiGroundFor(b, cfg)), t);
      if (!hemi.groundColor.equals(_c1)) hemi.groundColor.copy(_c1);
      const HC = SKY.hdriCycle.hemiSky;
      const skyFor = (x) => (x === 'night' ? (cfg.skyNight ?? HC.night) : (HC[x] ?? HC.day));
      _c1.set(skyFor(a));
      if (t > 0) _c1.lerp(_c2.set(skyFor(b)), t);
      if (!hemi.color.equals(_c1)) hemi.color.copy(_c1);
    }
    if (hemi) {
      live.hemiGround = `#${hemi.groundColor.getHexString()}`;
      live.hemiSky = `#${hemi.color.getHexString()}`;
    }
  }, -48);

  return null;
}

// The grade payload is two numbers that only move when a pin moves, so it is
// rewritten in place rather than allocated per frame.
const gradeRef = { nightBloomThreshold: 0, nightExposureStops: 0 };
function gradeOf(block, out) {
  out.nightBloomThreshold = block.grade.nightBloomThreshold;
  out.nightExposureStops = block.grade.nightExposureStops;
  return out;
}
