import { painterlyProfile, PAINTERLY } from './painterly-policy';

export const PAINTERLY_UNIFORMS = { uPainterly: { value: 0 } };
export function painterlyOn() {
  return PAINTERLY_UNIFORMS.uPainterly.value === 1;
}
export function updatePainterlyProfile(profile, style) {
  PAINTERLY_UNIFORMS.uPainterly.value = painterlyProfile(profile, style) ? 1 : 0;
}

/** Shared response, before tone mapping. No posterisation, outlines or new pass.
 * The sky owns light chroma; surfaces only control the width of the highlight.
 * Explicit zero-weight branch preserves Classic and Neon arithmetic. */
export function applyPainterlySurface(material, role = 'scenery') {
  if (!material || material.userData.painterly) return material;
  material.userData.painterly = PAINTERLY.appearanceKey;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    Object.assign(shader.uniforms, PAINTERLY_UNIFORMS);
    if (!shader.fragmentShader.includes('uniform float uPainterly;')) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uPainterly;');
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
if (uPainterly > 0.5) {
  // Saturated local colour survives fill; specular stays subordinate to form.
  reflectedLight.indirectSpecular *= ${role === 'glass' ? '0.82' : '0.66'};
  reflectedLight.directSpecular *= ${role === 'glass' ? '0.92' : '0.78'};
}`);
  };
  material.customProgramCacheKey = () => `${key}|${PAINTERLY.appearanceKey}-${role}`;
  material.needsUpdate = true;
  return material;
}
