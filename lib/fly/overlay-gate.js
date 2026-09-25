/**
 * OVERLAY CLOUD GATE — analytic cloud-slab occlusion for the depth-less
 * airborne marks SkyOverlayPass draws after the cloud composite.
 *
 * Drawn after the composite, a trail no longer loses to clouds BEHIND it, but
 * it would also paint over clouds IN FRONT of it (Takeoff & Landing looks up
 * at cruise traffic through the 900–2,600 m slab every session). The cloud
 * pass has just marched this frame's clouds into a reduced-resolution target
 * whose alpha is the transmittance along each pixel's ray; the gate raises
 * that to the fraction of the marched slab segment that lies in FRONT of the
 * mark (Beer: T^f), so a mark above a deck is dimmed exactly as much as the
 * deck in front of it, a mark in front of the slab is untouched, and a mark
 * inside the slab dims proportionally.
 *
 * The slab and range mirror the march: low = base − OV_SLAB_PAD_M, high =
 * base + thickness, limited to rangeM / metricRay. One thing cannot be
 * mirrored: the terrain-depth limit (the scene depth texture is the ACTIVE
 * depth attachment during the overlay draw, so sampling it would be a
 * feedback loop) — marks inside a mountainous slab are slightly
 * under-occluded.
 *
 * Plain uniform objects (no three import) so world-bend.js — which carries
 * no renderer imports — can include the GLSL without a new dependency. The
 * gate is ON only for SkyOverlayPass's own draw; everywhere else (toy, the
 * main pass, a Classic frame without the pass) `on` is 0 and ovCloudGate()
 * returns the literal 1.0, so a × 1.0 is exact.
 */

// Mirrors immersive-cloud-pass.js march(): 'float low=base-600.,high=base+thickness;'
export const OV_SLAB_PAD_M = 600;

export const OVERLAY_GATE_UNIFORMS = {
  uOvCloud: { value: null }, // cloud-march target (.a = transmittance)
  uOvSlab: { value: { x: 0, y: 0, z: 22000, w: 1 } }, // low, high, march rangeM, metricScale
  uOvEye: { value: { x: 0, y: 0, z: 0, w: 0 } }, // eye xyz (rendered frame), w = on
  uOvRes: { value: { x: 1, y: 1, z: 0 } }, // 1/W, 1/H of the overlay target, cloudMix
};

/** Share the gate uniforms (by reference) into a program's uniform table. */
export function bindOverlayGate(u) {
  for (const k in OVERLAY_GATE_UNIFORMS) u[k] = OVERLAY_GATE_UNIFORMS[k];
}

/** Arm the gate from the live cloud pass for one overlay draw. */
export function setOverlayGate(clouds, w, h) {
  const u = clouds.uniforms;
  const G = OVERLAY_GATE_UNIFORMS;
  G.uOvCloud.value = clouds.target.texture;
  const s = G.uOvSlab.value;
  s.x = u.base.value - OV_SLAB_PAD_M;
  s.y = u.base.value + u.thickness.value;
  s.z = u.rangeM.value;
  s.w = u.metricScale.value || 1;
  const e = G.uOvEye.value;
  e.x = u.eye.value.x;
  e.y = u.eye.value.y;
  e.z = u.eye.value.z;
  e.w = 1;
  const r = G.uOvRes.value;
  r.x = 1 / Math.max(1, w);
  r.y = 1 / Math.max(1, h);
  r.z = u.cloudMix.value;
}

/** Disarm: identity everywhere, and never leave a disposed target bound. */
export function clearOverlayGate() {
  OVERLAY_GATE_UNIFORMS.uOvEye.value.w = 0;
  OVERLAY_GATE_UNIFORMS.uOvCloud.value = null;
}

export const OVERLAY_GATE_GLSL = /* glsl */ `
uniform sampler2D uOvCloud; uniform vec4 uOvSlab; uniform vec4 uOvEye; uniform vec3 uOvRes;
float ovCloudGate( vec3 w ) {
  if ( uOvEye.w < 0.5 ) return 1.0;
  vec3 dv = w - uOvEye.xyz; float dist = length( dv );
  if ( dist < 1.0 ) return 1.0;
  vec3 ray = dv / dist; float a = 0.0, b = 0.0;
  if ( abs( ray.y ) > 1e-4 ) {
    float t0 = ( uOvSlab.x - uOvEye.y ) / ray.y, t1 = ( uOvSlab.y - uOvEye.y ) / ray.y;
    a = max( 0.0, min( t0, t1 ) ); b = max( t0, t1 );
  } else if ( uOvEye.y > uOvSlab.x && uOvEye.y < uOvSlab.y ) b = 1e9;
  float mRay = length( vec3( ray.x / uOvSlab.w, ray.y, ray.z / uOvSlab.w ) );
  b = min( b, uOvSlab.z / max( mRay, 1e-3 ) );
  if ( b <= a || dist <= a ) return 1.0;
  float f = ( min( dist, b ) - a ) / ( b - a );
  float T = texture2D( uOvCloud, gl_FragCoord.xy * uOvRes.xy ).a;
  return pow( clamp( mix( 1.0, T, uOvRes.z ), 1e-3, 1.0 ), f );
}
`;
