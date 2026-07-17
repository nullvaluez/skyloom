'use client';

import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  DepthOfField,
  HueSaturation,
  Noise,
  Vignette,
  SMAA,
} from '@react-three/postprocessing';
import { NIGHT, SKY, TOY } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';

// Bloom buffer scale per quality tier; at 'low' bloom is dropped entirely
// (the composer stays for SMAA — cheaper than MSAA on integrated GPUs).
const BLOOM_SCALE = { high: 0.5, medium: 0.3, low: 0 };

// Per-style bloom grade: the neon tracers/letters need bloom in EVERY
// style; the threshold decides what else glows (nothing in daylight,
// the neon palette values in the dark styles).
const BLOOM_BY_STYLE = {
  satellite: { intensity: SKY.bloomIntensity, threshold: SKY.bloomThreshold },
  night: { intensity: NIGHT.bloomIntensity, threshold: NIGHT.bloomThreshold },
  toy: { intensity: TOY.bloomIntensity, threshold: TOY.bloomThreshold },
};

/**
 * The single post chain: Bloom + Vignette + SMAA, plus the diorama grade
 * (tilt-shift DOF + grain + saturation/contrast) in the Toy/Neon style.
 * multisampling=0 — MSAA multiplies composer buffers; SMAA covers AA far
 * cheaper on integrated GPUs. Reconfigures only on discrete store
 * transitions.
 */
export function Effects() {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const bloomScale = BLOOM_SCALE[qualityTier] ?? 0.5;
  const toy = mapStyle === 'toy';
  const bloom = BLOOM_BY_STYLE[mapStyle] ?? BLOOM_BY_STYLE.satellite;

  return (
    <EffectComposer multisampling={0}>
      {bloomScale > 0 && (
        <Bloom
          mipmapBlur
          intensity={bloom.intensity}
          luminanceThreshold={bloom.threshold}
          luminanceSmoothing={0.2}
          resolutionScale={bloomScale}
        />
      )}
      {toy && <HueSaturation saturation={TOY.saturation} />}
      {toy && <BrightnessContrast contrast={TOY.contrast} />}
      {/* Diorama camera: tilt-shift-ish shallow focus + film grain */}
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
    </EffectComposer>
  );
}
