import {
  DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace
} from 'three';
import { isMobileGraphicsClass } from './device-class';

const URL = '/materials/cinema-v1/facade-surfaces.webp';
const SIZE = 512;
const COUNT = 4;
const owners = new WeakSet();
let users = 0;
let loading = null;
let retryAfter = 0;
let atlas = null;
let anisotropy = 1;
const texture = { value: null };
const ready = { value: 0 };
const stats = { state:'idle', size:SIZE, layers:COUNT, users:0, anisotropy:1 };

async function load(controller) {
  const response = await fetch(URL, { signal: controller.signal });
  if (!response.ok) throw new Error('Facade sheet HTTP ' + response.status);
  const image = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
  try {
    if (image.width !== SIZE || image.height !== SIZE * COUNT) throw new Error('Unexpected facade sheet size');
    if (controller.signal.aborted) return;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE * COUNT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const array = new DataArrayTexture(new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength), SIZE, SIZE, COUNT);
    array.name = 'Flight facade elevations';
    array.colorSpace = SRGBColorSpace;
    array.wrapS = array.wrapT = RepeatWrapping;
    array.minFilter = LinearMipmapLinearFilter;
    array.magFilter = LinearFilter;
    array.generateMipmaps = true;
    array.anisotropy = anisotropy;
    array.needsUpdate = true;
    atlas = texture.value = array;
    ready.value = 1;
    stats.state = 'ready';
  } finally {
    image.close();
  }
}

function requestIfVisible(tier) {
  if (tier.value <= .5 || atlas || loading || !users || typeof createImageBitmap !== 'function' || Date.now() < retryAfter) return;
  const request = new AbortController();
  loading = request;
  stats.state = 'loading';
  load(request).catch(() => {
    if (!request.signal.aborted) {
      stats.state = 'fallback';
      retryAfter = Date.now() + 30000;
    }
  }).finally(() => {
    if (loading === request) loading = null;
  });
}

/** Near, far and prewarm materials share one array. Recompiling a material adds
 * no owner. A live governor promotion can trigger the load on its next draw. */
export function bindFlightFacadeSurfaces(shader, material, renderer) {
  const tier = shader.uniforms.uLookFacade;
  if (!tier || !material?.addEventListener || !renderer?.capabilities || isMobileGraphicsClass()) return false;
  if (!owners.has(material)) {
    owners.add(material);
    stats.users = ++users;
    material.userData.flightFacadeSurfaces = stats;
    anisotropy = Math.max(anisotropy, Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1));
    stats.anisotropy = anisotropy;
    const release = () => {
      material.removeEventListener('dispose',release);
      owners.delete(material);
      stats.users = --users;
      if (users) return;
      loading?.abort();
      loading = null;
      atlas?.dispose();
      atlas = texture.value = null;
      ready.value = 0;
      retryAfter = 0;
      anisotropy = 1;
      Object.assign(stats,{state:'idle',anisotropy:1});
    };
    material.addEventListener('dispose',release);
  }
  requestIfVisible(tier);
  shader.uniforms.uFlightFacadeSheet = texture;
  shader.uniforms.uFlightFacadeReady = {
    get value() {
      if (!ready.value) requestIfVisible(tier);
      return ready.value;
    }
  };
  return true;
}

export const FLIGHT_FACADE_SURFACE_GLSL = `
uniform highp sampler2DArray uFlightFacadeSheet;
uniform float uFlightFacadeReady;
// Families 0/1/6 are domestic, 2 masonry, 3 concrete, 4 glass, 5 industrial
// and 7 terminal. A mapped glass tag wins over a fallback family.
float flightFacadeLayer(float family, float curtain, float variant) {
 if(curtain>.5)return 1.;
 if(family==2.)return variant>.22?3.:0.;
 if(family==3. || family==4. || family==5. || family==7.)return 2.;
 return variant>.79?3.:0.;
}
`;
