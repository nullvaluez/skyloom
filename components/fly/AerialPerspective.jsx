/**
 * Round 19 (B "DEEPFIELD") — REAL aerial perspective, from the depth buffer.
 *
 * The field study's headline "flat" finding (FLY_ROUND19_PLAN §0): with
 * `SKY.haze.startM = 16000` and a fogExp2 density of 7.5e-6, EVERY fragment
 * inside 16 km is mathematically unattenuated. That is the entire near and mid
 * field — the part of the world you actually fly through — rendered with zero
 * distance cue. This Effect gives every pixel a distance.
 *
 * WHY A POST EFFECT AND NOT MORE SHADER PATCHES: the alternative is a haze
 * term in every content variant (tiles, buildings, skyline, roads, water, veg,
 * monuments, letters) — eight cache-key moves, eight chances to disagree at a
 * seam, and veg/letters have no fragment seam to patch at all. One depth pass
 * covers all of them on ONE law, and because it MERGES into the existing
 * satellite EffectPass (HueSaturation + BrightnessContrast + WhiteBalance) it
 * costs ZERO extra draw calls — it is more fragment ALU on a fullscreen pass
 * that already runs. Declaring EffectAttribute.DEPTH is also what makes the
 * composer allocate its depth texture (previously unused).
 *
 * ORDER: this is the FIRST satellite effect in the chain, before the grade.
 * That is a correctness requirement, not taste. The tile band's haze
 * (setDepthHazeRGB) and the SkyDome's rim are both baked in the SCENE render,
 * so they pass through the whole grade. If this pass ran after
 * HueSaturation/BrightnessContrast, a fully-hazed pixel would land on the RAW
 * rim colour while the sky it is supposed to melt into landed on the GRADED
 * one — a visible step at exactly the horizon this effect exists to sell.
 *
 * COLOUR SPACE: deliberately NO inputColorSpace override. The tile band mixes
 * toward the same raw `_atmoRim` triple on the scene buffer's own values; by
 * doing the same mix, on the same values, in the same space, the two agree by
 * construction — whatever that space turns out to be. (WhiteBalance overrides
 * to sRGB because a white balance is a photographic gamma-space operation;
 * this is a scene-space blend and must not be.)
 *
 * R24 C (LINEAR_HAZE, recon L1) — the R19 reasoning above is sound and its
 * conclusion was still wrong, because "the same space" was the WRONG space for
 * BOTH of them. The buffer is linear (the composer's HalfFloat RT makes three's
 * <colorspace_fragment> an identity), the fog and the SkyDome decode their copy
 * of the same triple with SRGBColorSpace, and the tile band + this pass did not.
 * With LINEAR_HAZE on, world-bend's setters and this uniform both decode, so the
 * three-way agreement the R19 header was reaching for finally holds against the
 * sky as well as against the tiles. Still no inputColorSpace override: the BLEND
 * stays a scene-space blend; only the TARGET colour is decoded.
 *
 * DRIVEN BY MODULE SETTERS: FlyScene's -50 block already computes the live rim
 * triple, the bend uniforms, the ground reference and the tier/style gates one
 * step before the composer renders at priority 1. It pushes them here; the
 * Effect's own update() — which postprocessing calls immediately before the
 * pass draws — copies them into uniforms. No React state, no per-frame store
 * reads, and the copy happens at the latest possible moment.
 */
import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector2, Vector3, Color, SRGBColorSpace } from 'three';
import { LINEAR_HAZE } from '@/lib/fly/fly-constants';

/**
 * Module-scope frame state. One satellite scene exists at a time, so a plain
 * object is the whole mechanism — and because update() COPIES out of it, a
 * StrictMode double-mount or an effect rebuild just picks up the latest values
 * on its next frame instead of needing any registration bookkeeping.
 */
const _state = {
  strength: 0, // AERIAL_PERSPECTIVE.maxMix × tier/style gate × __flyAerialOverride
  startM: 800,
  endM: 14000,
  heightFalloffM: 1200,
  rim: [0, 0, 0],
  camPos: [0, 0, 0],
  camRight: [1, 0, 0],
  camUp: [0, 1, 0],
  camZ: [0, 0, -1],
  tanHalfFov: 0.5,
  bendCx: 0,
  bendCz: 0,
  bendK: 0,
  groundY: 0,
};

/**
 * The per-frame feed (FlyScene -50). `strength` is the ONLY kill switch that
 * matters: at 0 the shader takes an early-out that returns inputColor
 * unchanged, so a pinned/medium/toy frame is bit-identical to pre-R19.
 */
export function setAerial(s) {
  _state.strength = s.strength;
  _state.startM = s.startM;
  _state.endM = s.endM;
  _state.heightFalloffM = s.heightFalloffM;
  _state.rim[0] = s.rim[0];
  _state.rim[1] = s.rim[1];
  _state.rim[2] = s.rim[2];
  _state.camPos[0] = s.camPos[0];
  _state.camPos[1] = s.camPos[1];
  _state.camPos[2] = s.camPos[2];
  _state.camRight[0] = s.camRight[0];
  _state.camRight[1] = s.camRight[1];
  _state.camRight[2] = s.camRight[2];
  _state.camUp[0] = s.camUp[0];
  _state.camUp[1] = s.camUp[1];
  _state.camUp[2] = s.camUp[2];
  _state.camZ[0] = s.camZ[0];
  _state.camZ[1] = s.camZ[1];
  _state.camZ[2] = s.camZ[2];
  _state.tanHalfFov = s.tanHalfFov;
  _state.bendCx = s.bendCx;
  _state.bendCz = s.bendCz;
  _state.bendK = s.bendK;
  _state.groundY = s.groundY;
}

/** Hand the pass back to identity (style switch / unmount / non-satellite). */
export function clearAerial() {
  _state.strength = 0;
}

/** Dev/harness introspection — verify-aerial reads the live strength. */
export function getAerialState() {
  return {
    strength: _state.strength,
    startM: _state.startM,
    endM: _state.endM,
    heightFalloffM: _state.heightFalloffM,
    rim: [..._state.rim],
  };
}

const fragmentShader = /* glsl */ `
uniform vec3 uHazeColor;
uniform vec2 uBand;
uniform float uMaxMix;
uniform float uHeightFalloff;
uniform float uTanHalfFov;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamZ;
uniform vec2 uBendCenter;
uniform float uBendK;
uniform float uGroundY;
uniform float uReverseDepth;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // REVERSED DEPTH. FlyCanvas runs the renderer with reversedDepthBuffer true
  // (three r184+, near-uniform precision out to a 600 km far plane without
  // logarithmic depth's early-z cost). That stores depth near->1, far->0.
  // postprocessing's readDepth() HAS an un-reverse branch, but it is guarded by
  // USE_REVERSED_DEPTH_BUFFER — a define NEITHER library ever sets (the string
  // does not occur anywhere in three's source). So the raw value arrives still
  // reversed: terrain kilometres away reads ~2e-4, getViewZ() maps that to
  // about -cameraNear, every fragment reconstructs to ~1 m from the eye, and
  // the entire pass silently mixes nothing. Measured before this line existed:
  // the strength-0-vs-on A/B moved 0.00/255.
  //
  // Flipping recovers the standard [0,1] depth the formula expects. It is
  // DETECTED from the live renderer, never assumed: three downgrades the
  // request to an ordinary depth buffer when EXT_clip_control is missing, and a
  // hard-coded flip would then invert the world on exactly those devices.
  float d = uReverseDepth > 0.5 ? 1.0 - depth : depth;

  // TWO early-outs, and both are load-bearing.
  // (1) strength 0 — the fleet pin, the tier gate and the style gate all land
  //     here, and returning inputColor UNMODIFIED is what makes a pinned frame
  //     bit-identical rather than merely close.
  // (2) sky — SkyDome is depthWrite:false at renderOrder -100, so sky pixels
  //     keep the CLEARED far depth. They must be skipped: the dome already
  //     paints the rim gradient this effect mixes toward, and hazing it would
  //     wash the zenith toward the horizon colour.
  if ( uMaxMix <= 0.0 || d >= 0.999999 ) {
    outputColor = inputColor;
    return;
  }

  // View-space position from window depth. The EffectMaterial hands us
  // getViewZ()/cameraNear/cameraFar/aspect but NOT projectionMatrixInverse, so
  // the unprojection is done longhand from the FOV — which also keeps it
  // correct while the speed/boost FOV kick is animating (uTanHalfFov is
  // re-read every frame from the live camera).
  float viewZ = getViewZ( d );
  float linZ = -viewZ;
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 viewPos = vec3( ndc.x * aspect * uTanHalfFov * linZ, ndc.y * uTanHalfFov * linZ, viewZ );
  float dist = length( viewPos );

  // Back to the (rebased) world frame via the camera's own basis vectors — the
  // three COLUMNS of camera.matrixWorld, which are its local axes in world
  // space. Note uCamZ is column 2 = local +Z, which points BACKWARD (three
  // cameras look down -Z); viewPos.z is correspondingly negative in front of
  // the camera, so the two signs cancel and the sum is a plain change of basis.
  // Only XZ is rebased by the floating origin; Y is true altitude in both
  // frames, which is why the height term below needs no origin correction.
  vec3 world = uCamPos + uCamRight * viewPos.x + uCamUp * viewPos.y + uCamZ * viewPos.z;

  // UNDO THE MINI-PLANET BEND before asking how high this fragment is. The
  // depth buffer sees BENT geometry — at the satellite k (1/2R, R = 100 km)
  // ground 14 km out has been pushed ~980 m down, which is most of an e-fold
  // of the height falloff. Left un-corrected, distant peaks would read as
  // valley floors and the whole height term would collapse into a second
  // distance term. The bend is exactly d²k about uBendCenter, so the inverse
  // is exact and costs one distance() plus a multiply-add.
  float dXZ = distance( world.xz, uBendCenter );
  float trueY = world.y + dXZ * dXZ * uBendK;

  // Height above the player's ground reference, the same datum the air-bend
  // uses. Below the datum clamps to 0 = full density, so valleys fill first
  // and ridges stand out of the haze — the read that sells depth.
  float h = max( 0.0, trueY - uGroundY );

  float t = smoothstep( uBand.x, uBand.y, dist );
  float hFall = exp( -h / uHeightFalloff );
  outputColor = vec4( mix( inputColor.rgb, uHazeColor, uMaxMix * t * hFall ), inputColor.a );
}
`;

export class AerialPerspectiveEffect extends Effect {
  constructor() {
    super('AerialPerspectiveEffect', fragmentShader, {
      // This is what makes the composer allocate + bind its depth texture.
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uHazeColor', new Uniform(new Color(0, 0, 0))],
        ['uBand', new Uniform(new Vector2(800, 14000))],
        ['uMaxMix', new Uniform(0)],
        ['uHeightFalloff', new Uniform(1200)],
        ['uTanHalfFov', new Uniform(0.5)],
        ['uCamPos', new Uniform(new Vector3())],
        ['uCamRight', new Uniform(new Vector3(1, 0, 0))],
        ['uCamUp', new Uniform(new Vector3(0, 1, 0))],
        ['uCamZ', new Uniform(new Vector3(0, 0, -1))],
        ['uBendCenter', new Uniform(new Vector2())],
        ['uBendK', new Uniform(0)],
        ['uGroundY', new Uniform(0)],
        ['uReverseDepth', new Uniform(0)],
      ]),
    });
    // Resolved from the live renderer on the first update() — see the shader.
    this._reversed = null;
  }

  /**
   * postprocessing calls this immediately before the pass draws — the latest
   * point in the frame, and therefore the least stale. Pure uniform writes.
   */
  update(renderer) {
    const u = this.uniforms;
    const s = _state;
    // Depth-buffer orientation is a device contract, not a preference (the R16
    // HalfFloatType lesson): ASK the renderer what it actually got rather than
    // trusting what was requested, because three quietly falls back to a normal
    // depth buffer when EXT_clip_control is unavailable. Cached after the first
    // successful read — it cannot change for the life of a context.
    if (this._reversed === null && renderer) {
      const got = renderer.state?.buffers?.depth?.getReversed?.();
      if (got !== undefined) this._reversed = got ? 1 : 0;
    }
    u.get('uReverseDepth').value = this._reversed ?? 0;
    u.get('uMaxMix').value = s.strength;
    // R24 C (LINEAR_HAZE): Color.setRGB's default colorSpace is the WORKING
    // space, i.e. no conversion — which is exactly the L1 defect. Naming
    // SRGBColorSpace decodes the authored triple into the linear buffer the
    // composer actually renders into. Flag off = the R19 call, unchanged.
    if (LINEAR_HAZE.enabled) {
      u.get('uHazeColor').value.setRGB(s.rim[0], s.rim[1], s.rim[2], SRGBColorSpace);
    } else {
      u.get('uHazeColor').value.setRGB(s.rim[0], s.rim[1], s.rim[2]);
    }
    u.get('uBand').value.set(s.startM, s.endM);
    u.get('uHeightFalloff').value = Math.max(1, s.heightFalloffM);
    u.get('uTanHalfFov').value = s.tanHalfFov;
    u.get('uCamPos').value.set(s.camPos[0], s.camPos[1], s.camPos[2]);
    u.get('uCamRight').value.set(s.camRight[0], s.camRight[1], s.camRight[2]);
    u.get('uCamUp').value.set(s.camUp[0], s.camUp[1], s.camUp[2]);
    u.get('uCamZ').value.set(s.camZ[0], s.camZ[1], s.camZ[2]);
    u.get('uBendCenter').value.set(s.bendCx, s.bendCz);
    u.get('uBendK').value = s.bendK;
    u.get('uGroundY').value = s.groundY;
  }
}
