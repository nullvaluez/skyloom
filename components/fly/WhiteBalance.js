/**
 * Round 13 Phase 0 — satellite color grade: a sun-frac-driven warm/cool
 * white balance. A trivial per-pixel RGB multiply (no convolution, no own
 * pass) so it MERGES into the shared fullscreen EffectPass — ZERO extra
 * composer draw calls (the tone-map pass is the only +1 this phase adds).
 *
 * The `balance` uniform is driven on a ~5s cadence from `runtime.sun.frac`
 * (Effects.jsx) — golden-hour warm, deep-night cool, neutral at noon — the
 * same discrete-sampling discipline CloudField uses for its cloud tint (no
 * per-frame store reads). inputColorSpace = sRGB so the multiply happens in
 * perceptual space, matching how BrightnessContrast/HueSaturation grade.
 */
import { Effect } from 'postprocessing';
import { Color, Uniform, SRGBColorSpace } from 'three';

const fragmentShader = /* glsl */ `
uniform vec3 balance;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * balance, inputColor.a);
}
`;

export class WhiteBalanceEffect extends Effect {
  constructor({ balance = [1, 1, 1] } = {}) {
    super('WhiteBalanceEffect', fragmentShader, {
      uniforms: new Map([
        ['balance', new Uniform(new Color(balance[0], balance[1], balance[2]))],
      ]),
    });
    // Grade in gamma space so a warm/cool multiply reads like a photo white
    // balance (the library grade effects declare the same input space).
    this.inputColorSpace = SRGBColorSpace;
  }

  setBalance(r, g, b) {
    this.uniforms.get('balance').value.setRGB(r, g, b);
  }
}
