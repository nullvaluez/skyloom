import { RGBAFormat, RedFormat, VSMShadowMap } from 'three';

/** PCF/Basic sample depthTexture, not the unused colour attachment. Keep
 * depth precision and all shadow filtering unchanged; R8 saves 12 MiB for
 * a 2048 square target. VSM and cube shadows have different contracts.
 */
export function compactDepthShadowTarget(shadow, type) {
  const map=shadow?.map;
  if(!map?.depthTexture || map.isWebGLCubeRenderTarget || type===VSMShadowMap || map.texture.format!==RGBAFormat)return false;
  map.texture.format=RedFormat;
  map.dispose(); // storage is recreated before the next shadow draw
  shadow.needsUpdate=true;
  return true;
}
