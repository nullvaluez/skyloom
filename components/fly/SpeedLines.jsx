/**
 * Round 19 (E "SLIPSTREAM") — the speed cue. FLY_ROUND19_PLAN §0 P4: "zero
 * speed sensation — no streaks/radial cues/boost punch; FOV kick only
 * speed^1.5". At 750 m/s the world outside the cockpit is a smooth, silent,
 * perfectly sharp postcard, and the only thing that changes between cruise and
 * boost is 16° of FOV. This Effect gives the frame itself a velocity.
 *
 * THREE TERMS, ONE PASS:
 *  1. RADIAL SMEAR — the honest one. It drags the actual frame content outward
 *     from the focus of expansion (screen centre = where you are going), which
 *     is what a fast camera really does. Critically it reads on ANY background:
 *     an additive white overlay is invisible over an overcast sky or a white
 *     roof (the R18 steam-plume lesson, learned the expensive way) whereas a
 *     smear is visible wherever there is contrast, and where there is none
 *     there was nothing to sell anyway.
 *  2. WIND STREAKS — sparse dashes in angular wedges, scrolling outward. Pure
 *     arcade garnish on top of (1), and the thing that makes 750 m/s read as
 *     750 and not merely "blurry".
 *  3. HEAT HAZE — a small UV wobble applied to the sample taps while boosting,
 *     which is the afterburner's contribution to the same image.
 *
 * WHY A POST EFFECT: it MERGES into the EffectPass that already runs (Bloom is
 * its own pass; everything from here to the tone map is one merged program), so
 * the cost is fragment ALU on a fullscreen pass that already exists and the
 * draw count moves by exactly ZERO. The Owens Valley ≤261 and toy ≤480 gates
 * are untouchable this round, so 0 was the only acceptable number.
 *
 * NO DEPTH ATTRIBUTE, deliberately. B DEEPFIELD's AerialPerspective had to
 * declare EffectAttribute.DEPTH and then defuse the reversed-depth-buffer trap
 * (postprocessing's un-reverse branch is behind a define nothing sets, so raw
 * depth arrives reversed and every fragment reconstructs to ~1 m). Speed lines
 * are a screen-space phenomenon — they need no distance — so this effect never
 * reads depth, never forces the composer to allocate a depth texture on toy or
 * on medium tier, and cannot inherit that class of bug at all.
 *
 * PROBE SAFETY IS STRUCTURAL, not a pin. Intensity is a smoothstep that starts
 * at SPEED_FEEL.onFrac (0.55) of the AIRCRAFT's own boost speed. Cruise is
 * 180/750 = 0.24, so every harness probe, and all normal flight, sits at
 * literal zero — and at zero the shader takes an early-out that returns
 * inputColor UNMODIFIED, which is what makes an armed cruise frame
 * bit-identical to an unmounted one rather than merely close. This is the same
 * construction R18's SHAKE used (CLAUDE.md: "no fleet pin needed").
 */
import { Effect } from 'postprocessing';
import { Uniform, Vector2 } from 'three';

const fragmentShader = /* glsl */ `
uniform float uStrength;   // master 0..1 — 0 is the early-out
uniform float uTime;       // seconds, accumulated on the app's own clock
uniform float uRush;       // extra smear gain in the low-AGL band
uniform float uHaze;       // boost-only wobble amount
uniform float uSmearUv;    // outermost tap offset (uv) at full strength
uniform float uLines;      // streak wedges around the circle
uniform float uStreakGain;
uniform float uScroll;     // streak scroll rate (Hz)
uniform vec2  uRadius;     // r0/r1 screen-radius ramp

// One cheap hash per wedge so the fan is not a perfectly regular starburst
// (a regular one reads as a UI element, not as air).
float wedgeHash(float n) {
  return fract(sin(n * 127.1) * 43758.5453123);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // THE early-out. Everything — the speed gate, the tier gate, the flag, the
  // dev pin — lands on uStrength, and returning inputColor untouched is the
  // whole byte-identity contract (verify-feel's cruise A/B measures it).
  if (uStrength <= 0.0) {
    outputColor = inputColor;
    return;
  }

  // Aspect-corrected screen vector from the focus of expansion. "aspect" is an
  // EffectMaterial builtin, so this stays right on any viewport.
  vec2 p = uv - 0.5;
  p.x *= aspect;
  float r = length(p);
  vec2 dir = r > 1e-5 ? p / r : vec2(0.0);

  // Ramp: nothing at the crosshair (the one part of the frame the player is
  // actually reading), full past r1.
  float ramp = smoothstep(uRadius.x, uRadius.y, r);
  float amt = uStrength * uSmearUv * (1.0 + uRush) * ramp;

  // Boost heat wobble — two orthogonal sines, no texture. Multiplied by uHaze,
  // which is exactly 0 off boost, so the taps land on the same texels the
  // un-wobbled path would have sampled.
  vec2 wob = vec2(
    sin(uv.y * 91.0 + uTime * 8.7),
    sin(uv.x * 73.0 - uTime * 6.3)
  ) * (uHaze * 0.0035);

  // Radial smear. Taps march BACK toward the centre — the trail behind a
  // fragment is where it came from — and the offsets are un-aspect-corrected
  // on x before they are used as UVs.
  vec3 sum = inputColor.rgb;
  for (int i = 1; i <= 4; i++) {
    float f = float(i) * 0.25;
    vec2 off = dir * (amt * f) + wob * f;
    off.x /= aspect;
    sum += texture2D(inputBuffer, clamp(uv - off, vec2(0.0), vec2(1.0))).rgb;
  }
  vec3 col = sum * 0.2;

  // Wind streaks: angular wedges, each with an outward-scrolling dash.
  float t = atan(p.y, p.x) * uLines * 0.15915494; // /(2*pi)
  float wedge = floor(t);
  float rnd = wedgeHash(wedge);
  float f = fract(t) - 0.5;
  float thin = exp(-f * f * 46.0); // gaussian across the wedge = a thin line
  float phase = fract(r * 1.7 - uTime * uScroll * (0.75 + rnd * 0.6) + rnd);
  float dash = smoothstep(0.62, 0.94, phase) * (1.0 - smoothstep(0.94, 1.0, phase));
  float streak = thin * dash * ramp * uStrength * uStreakGain;

  // Brighten toward a desaturated version of what is already there. This lands
  // BEFORE the tone map, so pushing past 1.0 rolls off filmically instead of
  // clipping to a flat white bar.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum + 0.55), streak);

  outputColor = vec4(col, inputColor.a);
}
`;

export class SpeedLinesEffect extends Effect {
  constructor() {
    super('SpeedLinesEffect', fragmentShader, {
      uniforms: new Map([
        ['uStrength', new Uniform(0)],
        ['uTime', new Uniform(0)],
        ['uRush', new Uniform(0)],
        ['uHaze', new Uniform(0)],
        ['uSmearUv', new Uniform(0.022)],
        ['uLines', new Uniform(44)],
        ['uStreakGain', new Uniform(0.34)],
        ['uScroll', new Uniform(1.15)],
        ['uRadius', new Uniform(new Vector2(0.16, 0.72))],
      ]),
    });
    // Mirrors the uniforms for dev/harness introspection (verify-feel reads
    // the live strength instead of re-deriving it from the flight model, so
    // the gate measures what the GPU was actually handed).
    this._feel = { strength: 0, rush: 0, haze: 0, speedFrac: 0, aglM: 0 };
  }

  /**
   * Per-frame feed from Effects.jsx (an r3f useFrame at priority 0 — after
   * FlyScene's -50 publish, before the composer's priority-1 render). Plain
   * uniform writes; no React state, no store reads, no allocation.
   */
  setFeel(f) {
    const u = this.uniforms;
    u.get('uStrength').value = f.strength;
    u.get('uTime').value = f.time;
    u.get('uRush').value = f.rush;
    u.get('uHaze').value = f.haze;
    u.get('uSmearUv').value = f.smearUv;
    u.get('uLines').value = f.lines;
    u.get('uStreakGain').value = f.streakGain;
    u.get('uScroll').value = f.scroll;
    u.get('uRadius').value.set(f.r0, f.r1);
    this._feel.strength = f.strength;
    this._feel.rush = f.rush;
    this._feel.haze = f.haze;
    this._feel.speedFrac = f.speedFrac;
    this._feel.aglM = f.aglM;
  }

  /** Hand the pass back to identity (unmount / tier drop / flag off). */
  clearFeel() {
    this.uniforms.get('uStrength').value = 0;
    this._feel.strength = 0;
  }

  getFeel() {
    return { ...this._feel };
  }
}

/**
 * The CPU half of the speed curve, exported so the harness can assert the
 * shape without a GPU read: 0 at and below onFrac (exactly — this is the
 * probe-safety construction), smoothstep to 1 at full boost.
 */
export function speedFeelStrength(speedFrac, cfg) {
  const s = Math.min(1, Math.max(0, (speedFrac - cfg.onFrac) / (1 - cfg.onFrac)));
  return cfg.maxStrength * s * s * (3 - 2 * s);
}
