'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  DepthOfField,
  HueSaturation,
  Noise,
  ToneMapping,
  Vignette,
  SMAA,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { SKY, SKY_LIVE, TOY } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';
import { WhiteBalanceEffect } from './WhiteBalance';

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
export function Effects({ runtime }) {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const bloomScale = BLOOM_SCALE[qualityTier] ?? 0.5;
  const toy = mapStyle === 'toy';
  const sat = mapStyle === 'satellite';
  const bloom = BLOOM_BY_STYLE[mapStyle] ?? BLOOM_BY_STYLE.satellite;

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
  const toneMode = TONE_MODES[toneName];
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

  return (
    <EffectComposer multisampling={0}>
      {bloomScale > 0 && (
        <Bloom
          ref={setBloom}
          mipmapBlur
          intensity={bloom.intensity}
          luminanceThreshold={bloom.threshold}
          luminanceSmoothing={0.2}
          resolutionScale={bloomScale}
        />
      )}
      {/* Satellite grade (round 13 P0): saturation + contrast + a sun-driven
          warm/cool white balance. All three merge into one EffectPass. */}
      {sat && <HueSaturation saturation={SKY.grade.saturation} />}
      {sat && (
        <BrightnessContrast
          brightness={SKY.grade.brightness}
          contrast={SKY.grade.contrast}
        />
      )}
      {sat && <primitive object={whiteBalance} dispose={null} />}
      {/* Diorama camera (toy): saturation/contrast + tilt-shift DOF + grain */}
      {toy && <HueSaturation saturation={TOY.saturation} />}
      {toy && <BrightnessContrast contrast={TOY.contrast} />}
      {toy && qualityTier === 'high' && (
        <DepthOfField
          worldFocusDistance={TOY.dofFocusM}
          worldFocusRange={TOY.dofRangeM}
          bokehScale={TOY.dofBokeh}
        />
      )}
      {toy && <Noise premultiply opacity={TOY.grainOpacity} />}
      <Vignette eskil={false} offset={0.25} darkness={0.55} />
      <SMAA />
      {/* Round 13 P0: filmic tone map — the FINAL child, so it compresses the
          fully-graded HDR image (bloom happens upstream in linear light). */}
      {toneMode != null && <ToneMapping mode={toneMode} />}
    </EffectComposer>
  );
}
