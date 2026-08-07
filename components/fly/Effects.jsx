'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Bloom,
  BrightnessContrast,
  DepthOfField,
  HueSaturation,
  Noise,
  ToneMapping,
  Vignette,
  SMAA,
} from '@react-three/postprocessing';
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  DepthOfFieldEffect,
  HueSaturationEffect,
  MaskFunction,
  NoiseEffect,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import {
  AERIAL_PERSPECTIVE,
  FLIGHT,
  SKY,
  SKY_LIVE,
  SPEED_FEEL,
  TOY,
} from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';
import { WhiteBalanceEffect } from './WhiteBalance';
import { AerialPerspectiveEffect } from './AerialPerspective';
import { SpeedLinesEffect, speedFeelStrength } from './SpeedLines';
import { FlyEffectComposer } from './FlyEffectComposer';

// Bloom buffer scale per quality tier; at 'low' bloom is dropped entirely
// (the composer stays for SMAA — cheaper than MSAA on integrated GPUs).
const BLOOM_SCALE = { high: 0.5, medium: 0.3, low: 0 };

// Per-style bloom grade: the neon tracers/letters need bloom in EVERY
// style; the threshold decides what else glows (nothing in daylight,
// the neon palette values in the dark styles).
const BLOOM_BY_STYLE = {
  satellite: { intensity: SKY.bloomIntensity, threshold: SKY.bloomThreshold },
  toy: { intensity: TOY.bloomIntensity, threshold: TOY.bloomThreshold },
};

// Round 13 P0: filmic tone-map modes. Named strings live in the constants
// (SKY.toneMapping.byStyle) so the loser stays one edit away; 'None' skips
// the pass entirely (the pre-R13 linear→sRGB baseline).
const TONE_MODES = {
  AgX: ToneMappingMode.AGX,
  ACES: ToneMappingMode.ACES_FILMIC,
  Neutral: ToneMappingMode.NEUTRAL,
  None: null,
};

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * ROUND 21 (A GOVERNOR, S2/S4) — the post chain as DATA.
 *
 * The R20 composer rebuilt every pass on every re-render of this component
 * (@react-three/postprocessing lists `children` — a fresh array each render —
 * in its pass-assembly effect's dependency array), and postprocessing's
 * removePass never disposes, so each rebuild leaked an EffectPass, its
 * EffectMaterial and the compiled program; with AerialPerspectiveEffect
 * declaring EffectAttribute.DEPTH it also churned the composer's depth target.
 * The React half of the fix is here: the child list is derived ONLY from the
 * discrete inputs below and useMemo'd, so a DPR state change or an unrelated
 * store tick leaves element identity untouched.
 *
 * It is also the SINGLE SOURCE OF TRUTH for the pre-warm. Each descriptor
 * carries both an `el()` (the production React element, using the caller's
 * long-lived effect singletons) and a `raw()` (a fresh postprocessing effect
 * built from the SAME option values). @react-three/postprocessing's wrappers
 * are thin — wrapEffect does `new Ctor({...defaults, ...props})` — so the two
 * paths generate the same merged fragment shader, which is what lets
 * lib/fly/prewarm.js compile the ALTERNATE tier's chain at boot and have the
 * real tier flip find that program already in three's cache.
 *
 * Ordering is load-bearing and unchanged from R19/R20: speed lines first (they
 * sample the un-graded scene buffer), aerial perspective next (the tile haze
 * band and the SkyDome rim are baked in the scene render, so a post haze must
 * precede the grade or it steps at the horizon), then the per-style grade,
 * then vignette + SMAA, then the filmic tone map LAST.
 */
export function buildPassList(style, tier, ctx = {}) {
  const toy = style === 'toy';
  const sat = style === 'satellite';
  const bloomScale = BLOOM_SCALE[tier] ?? 0.5;
  const bloom = BLOOM_BY_STYLE[style] ?? BLOOM_BY_STYLE.satellite;
  const toneName = ctx.toneName ?? SKY.toneMapping.byStyle[style] ?? 'ACES';
  const toneMode = TONE_MODES[toneName];
  const aerialOn = sat && AERIAL_PERSPECTIVE.enabled && tier === 'high';
  const speedOn = SPEED_FEEL.enabled && tier === 'high' && ctx.speedMount !== false;
  const list = [];

  if (bloomScale > 0) {
    list.push({
      id: 'bloom',
      el: () => (
        <Bloom
          key="bloom"
          ref={ctx.setBloom}
          mipmapBlur
          intensity={bloom.intensity}
          luminanceThreshold={bloom.threshold}
          luminanceSmoothing={0.2}
          resolutionScale={bloomScale}
        />
      ),
      // wrapEffect(BloomEffect, { blendFunction: BlendFunction.ADD })
      raw: () =>
        new BloomEffect({
          blendFunction: BlendFunction.ADD,
          mipmapBlur: true,
          intensity: bloom.intensity,
          luminanceThreshold: bloom.threshold,
          luminanceSmoothing: 0.2,
          resolutionScale: bloomScale,
        }),
    });
  }
  if (speedOn) {
    list.push({
      id: 'speed',
      el: () => <primitive key="speed" object={ctx.speedLines} dispose={null} />,
      raw: () => new SpeedLinesEffect(),
    });
  }
  if (aerialOn) {
    list.push({
      id: 'aerial',
      el: () => <primitive key="aerial" object={ctx.aerial} dispose={null} />,
      raw: () => new AerialPerspectiveEffect(),
    });
  }
  if (sat) {
    list.push({
      id: 'sat-hue',
      el: () => <HueSaturation key="sat-hue" saturation={SKY.grade.saturation} />,
      raw: () => new HueSaturationEffect({ saturation: SKY.grade.saturation }),
    });
    list.push({
      id: 'sat-bc',
      el: () => (
        <BrightnessContrast
          key="sat-bc"
          brightness={SKY.grade.brightness}
          contrast={SKY.grade.contrast}
        />
      ),
      raw: () =>
        new BrightnessContrastEffect({
          brightness: SKY.grade.brightness,
          contrast: SKY.grade.contrast,
        }),
    });
    list.push({
      id: 'sat-wb',
      el: () => <primitive key="sat-wb" object={ctx.whiteBalance} dispose={null} />,
      raw: () => new WhiteBalanceEffect({ balance: SKY.grade.neutral }),
    });
  }
  if (toy) {
    list.push({
      id: 'toy-hue',
      el: () => <HueSaturation key="toy-hue" saturation={TOY.saturation} />,
      raw: () => new HueSaturationEffect({ saturation: TOY.saturation }),
    });
    list.push({
      id: 'toy-bc',
      el: () => <BrightnessContrast key="toy-bc" contrast={TOY.contrast} />,
      raw: () => new BrightnessContrastEffect({ contrast: TOY.contrast }),
    });
    if (tier === 'high') {
      list.push({
        id: 'toy-dof',
        el: () => (
          <DepthOfField
            key="toy-dof"
            worldFocusDistance={TOY.dofFocusM}
            worldFocusRange={TOY.dofRangeM}
            bokehScale={TOY.dofBokeh}
          />
        ),
        // drei's DepthOfField is NOT wrapEffect: it reads the composer camera
        // from context and restores the 6.21.3 mask behavior. Both are
        // replicated here so the warmed program matches.
        raw: (warmCtx) => {
          const e = new DepthOfFieldEffect(warmCtx?.camera, {
            blendFunction: undefined,
            worldFocusDistance: TOY.dofFocusM,
            worldFocusRange: TOY.dofRangeM,
            focusDistance: undefined,
            focusRange: undefined,
            focalLength: undefined,
            bokehScale: TOY.dofBokeh,
            resolutionScale: undefined,
            resolutionX: undefined,
            resolutionY: undefined,
            width: undefined,
            height: undefined,
          });
          if (e.maskPass) e.maskPass.maskFunction = MaskFunction.MULTIPLY_RGB_SET_ALPHA;
          return e;
        },
      });
    }
    list.push({
      id: 'toy-noise',
      el: () => <Noise key="toy-noise" premultiply opacity={TOY.grainOpacity} />,
      // wrapEffect(NoiseEffect, { blendFunction: BlendFunction.COLOR_DODGE });
      // `opacity` is consumed by the wrapper as blendMode-opacity-value, not a
      // constructor arg — a uniform, so it never touches the shader text.
      raw: () => {
        const e = new NoiseEffect({
          blendFunction: BlendFunction.COLOR_DODGE,
          premultiply: true,
        });
        e.blendMode.opacity.value = TOY.grainOpacity;
        return e;
      },
    });
  }
  list.push({
    id: 'vignette',
    el: () => <Vignette key="vignette" eskil={false} offset={0.25} darkness={0.55} />,
    raw: () => new VignetteEffect({ eskil: false, offset: 0.25, darkness: 0.55 }),
  });
  list.push({
    id: 'smaa',
    el: () => <SMAA key="smaa" />,
    raw: () => new SMAAEffect({}),
  });
  if (toneMode != null) {
    list.push({
      id: 'tone',
      el: () => <ToneMapping key="tone" mode={toneMode} />,
      raw: () => new ToneMappingEffect({ mode: toneMode }),
    });
  }
  return list;
}

/**
 * Round 16: satellite bloom BREATHES with the clock. The daylight grade
 * (SKY.bloomIntensity 0.7 / threshold 0.85) exists so that nothing but the
 * tracers glows in sunlight — which is right at noon and wrong at midnight,
 * where the whole point of the new night ground (city lights, runway lights,
 * lit windows) is that it glows. `nightT` is 0 at/above SKY_LIVE.bloomNight
 * .dayFrac, so every sun-pinned DAYLIGHT gate sees exactly the JSX constants
 * and toy (which never calls this) is untouched.
 *
 * Written as direct property mutation on the live effect: changing the JSX
 * props would reconstruct the BloomEffect and force an EffectPass recompile
 * on every tick.
 */
function applyBloom(effect, frac) {
  const bn = SKY_LIVE.bloomNight;
  const nightT = Math.min(1, Math.max(0, 1 - frac / bn.dayFrac));
  const intensity = lerp(SKY.bloomIntensity, bn.intensity, nightT);
  const threshold = lerp(SKY.bloomThreshold, bn.threshold, nightT);
  effect.intensity = intensity;
  if (effect.luminanceMaterial) effect.luminanceMaterial.threshold = threshold;
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    (window.__flyStats ??= {}).bloom = {
      intensity: +intensity.toFixed(3),
      threshold: +threshold.toFixed(3),
      nightT: +nightT.toFixed(3),
    };
  }
}

/**
 * The single post chain: Bloom + Vignette + SMAA + a FINAL filmic tone map
 * (round 13), plus a per-style grade — the diorama grade (tilt-shift DOF +
 * grain + saturation/contrast) in Toy, and a color + sun-driven warm/cool
 * white balance in Satellite. multisampling=0 — MSAA multiplies composer
 * buffers; SMAA covers AA far cheaper on integrated GPUs. Reconfigures only
 * on discrete store transitions.
 */
export const Effects = memo(function Effects({ runtime }) {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const sat = mapStyle === 'satellite';

  // Tone-map mode: constant per style, with a dev-only live override so the
  // A/B capture (scripts/r13-tonemap-capture.js) can flip AgX/ACES/None
  // without a rebuild. Changing the mode reconstructs only the tone pass.
  const [toneOverride, setToneOverride] = useState(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
    window.__flySetTone = (m) => setToneOverride(m ?? null);
    return () => {
      if (window.__flySetTone) delete window.__flySetTone;
    };
  }, []);
  const toneName = toneOverride ?? SKY.toneMapping.byStyle[mapStyle] ?? 'ACES';
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    (window.__flyStats ??= {}).toneMode = toneName;
  }

  // Live handle on the BloomEffect. A CALLBACK ref on purpose: @react-three/
  // postprocessing's wrapper memoises its constructor args on
  // `JSON.stringify(restProps)`, and an object ref would put the effect
  // instance (circular) into that stringify the moment it populated. Functions
  // are dropped by JSON.stringify, so a callback ref is invisible to it.
  // If the handle never arrives the bloom simply stays on its JSX day grade —
  // a missing flourish, never a broken frame.
  const bloomRef = useRef(null);
  const bloomFracRef = useRef(null); // last sun frac, so a rebuilt effect catches up
  const setBloom = useCallback((o) => {
    bloomRef.current = o ?? null;
    if (o && bloomFracRef.current != null) applyBloom(o, bloomFracRef.current);
  }, []);

  // Satellite white-balance effect (one persistent instance — the balance
  // uniform is mutated in place; no reconstruction/recompile per sun step).
  const whiteBalance = useMemo(
    () => new WhiteBalanceEffect({ balance: SKY.grade.neutral }),
    []
  );

  // Round 19 (B): depth-based aerial perspective. Mounted ONLY on satellite +
  // high tier — declaring EffectAttribute.DEPTH makes the composer allocate a
  // depth texture, which is a real (if small) cost, so medium/low must not pay
  // it. Its uniforms are fed by FlyScene's -50 block through module setters, so
  // the instance itself is constructed once and never reconfigured.
  const aerial = useMemo(() => new AerialPerspectiveEffect(), []);

  // ---- Round 19 (E SLIPSTREAM): speed lines -----------------------------
  // HIGH TIER ONLY, and that is a §1 decision-2 constraint rather than taste:
  // every R19 visual spend is high-tier-gated and medium/low must stay
  // byte-identical to R18 (phones are capped at medium). Style-agnostic —
  // Neon flies at the same 750 m/s and needs the same cue — because the effect
  // adds no draw either way. `__flySpeedLines.setMount(false)` is verify-feel's
  // A/B leg: it UNMOUNTS the primitive, so the composer rebuilds the merged
  // program without it and the cruise comparison is against a genuinely
  // absent effect, not merely a zeroed one.
  const [speedMountPin, setSpeedMountPin] = useState(true);
  const speedLines = useMemo(() => new SpeedLinesEffect(), []);
  const speedOn = SPEED_FEEL.enabled && qualityTier === 'high' && speedMountPin;
  const speedTimeRef = useRef(0);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
    window.__flySpeedLines = {
      setMount: (v) => setSpeedMountPin(!!v),
      get: () => speedLines.getFeel(),
    };
    return () => {
      if (window.__flySpeedLines) delete window.__flySpeedLines;
    };
  }, [speedLines]);
  // The feed. Priority 0: after FlyScene's -50 publish (so flight state is
  // this frame's), before the composer's priority-1 render. Pure arithmetic +
  // uniform writes — nothing here reaches React or the store.
  useFrame((_, delta) => {
    if (!speedOn) return;
    const flight = runtime?.flight;
    if (!flight) return;
    const dt = Math.min(delta, 0.05);
    speedTimeRef.current += dt;
    const F = flight.cfg ?? FLIGHT;
    const speedFrac = Math.min(1, flight.speed / F.speeds.boost);
    // EXACTLY 0 at and below onFrac — cruise is 0.24 against a 0.55 gate, so
    // this is a literal zero and the shader's early-out fires.
    const strength = speedFeelStrength(speedFrac, SPEED_FEEL);
    const agl = Number.isFinite(flight.agl) ? Math.max(0, flight.agl) : Infinity;
    const band = SPEED_FEEL.groundRush.aglBandM;
    // Ground rush: the low band multiplies the smear, because near the deck the
    // same airspeed sweeps far more angular content past the eye.
    const rush =
      agl < band ? SPEED_FEEL.groundRush.boost * (1 - agl / band) * (strength > 0 ? 1 : 0) : 0;
    speedLines.setFeel({
      strength,
      time: speedTimeRef.current,
      rush,
      haze: strength > 0 && flight.boosting ? SPEED_FEEL.heatHaze.strength : 0,
      smearUv: SPEED_FEEL.smear.maxUv,
      lines: SPEED_FEEL.streaks.lines,
      streakGain: SPEED_FEEL.streaks.gain,
      scroll: SPEED_FEEL.streaks.scrollHz,
      r0: SPEED_FEEL.radius.r0,
      r1: SPEED_FEEL.radius.r1,
      speedFrac,
      aglM: agl,
    });
  });
  // A tier drop or a flag flip must not leave the last armed frame's strength
  // sitting in the uniform.
  useEffect(() => {
    if (!speedOn) speedLines.clearFeel();
  }, [speedOn, speedLines]);
  // Drive the balance from runtime.sun.frac on a discrete cadence (never per
  // frame; runtime.sun is only published in satellite by FlyScene's day cycle).
  useEffect(() => {
    if (!sat || !runtime) return;
    const g = SKY.grade;
    const apply = () => {
      const frac = runtime.sun?.frac ?? 1;
      let bal;
      if (frac >= g.goldenFrac) {
        const t = (frac - g.goldenFrac) / (1 - g.goldenFrac); // golden→noon
        bal = [
          lerp(g.warm[0], g.neutral[0], t),
          lerp(g.warm[1], g.neutral[1], t),
          lerp(g.warm[2], g.neutral[2], t),
        ];
      } else {
        const t = frac / g.goldenFrac; // night→golden
        bal = [
          lerp(g.cool[0], g.warm[0], t),
          lerp(g.cool[1], g.warm[1], t),
          lerp(g.cool[2], g.warm[2], t),
        ];
      }
      whiteBalance.setBalance(bal[0], bal[1], bal[2]);
      // Round 16: the night bloom rides this SAME 5s cadence — no new timer,
      // no new state, and it reads the frac that was just resolved.
      bloomFracRef.current = frac;
      if (bloomRef.current) applyBloom(bloomRef.current, frac);
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        (window.__flyStats ??= {}).gradeBalance = bal.map((v) => +v.toFixed(3));
        window.__flyStats.gradeFrac = +frac.toFixed(3);
      }
    };
    apply();
    const id = setInterval(apply, 5000);
    return () => clearInterval(id);
  }, [sat, runtime, whiteBalance]);

  // ROUND 21 (S2): the child list, keyed on the DISCRETE inputs only. Every
  // value the chain reads is either one of these five or a module constant, so
  // a re-render that changes none of them (a DPR state step, a store selector
  // tick, a parent re-render) reuses this exact array — and FlyEffectComposer's
  // pass-list diff then does nothing at all. `runtime` is deliberately NOT a
  // dependency: it is a stable mutable handle, never a render input.
  const children = useMemo(
    () =>
      buildPassList(mapStyle, qualityTier, {
        toneName,
        speedMount: speedMountPin,
        setBloom,
        speedLines,
        aerial,
        whiteBalance,
      }).map((p) => p.el()),
    [mapStyle, qualityTier, toneName, speedMountPin, setBloom, speedLines, aerial, whiteBalance]
  );

  return (
    <FlyEffectComposer multisampling={0}>{children}</FlyEffectComposer>
  );
})
