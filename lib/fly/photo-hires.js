/**
 * SHIP PASS LIGHT — PHOTO_HIRES (FLY_SHIP_PASS.md LT-6): photos worth sharing.
 *
 * The shutter used to export the drawing buffer (about 1055 x 487 on a phone).
 * With PHOTO_HIRES on, the photo-mode shutter asks for a supersampled export:
 * PhotoCapture renders one frame offscreen at 2-3x — the renderer's pixel
 * ratio and the composer's buffers raised for that one frame, inside the same
 * rAF task, so the held simulation cannot move between the render and the read
 * — tiled with camera view offsets only where the export would exceed
 * MAX_TEXTURE_SIZE / MAX_RENDERBUFFER_SIZE / MAX_VIEWPORT_DIMS, with the
 * quality governor held (frame-api.js holdGovernor) so the long frame cannot
 * step quality, and then everything restored. The attribution is burned in as
 * before, scaled to the export.
 *
 * PROVIDES (FLY_SHIP_PASS.md section 6): capturePhoto({ scale }) -> Promise<Blob>,
 * emitting track('photo_taken') (PhotoCapture does, for every capture).
 *
 * FLAG OFF: the runtime action ignores `scale` and exports the drawing buffer
 * exactly as before (verify-photo's IHDR === drawing buffer contract).
 */
import { getRuntimeAction } from './runtime-bus';
import { lightBlock, lightFeature, shipPassOn } from './ship-light';

/** True when this device may supersample a photo (flag + policy). */
export function photoHiresActive(ctx = {}) {
  return shipPassOn('PHOTO_HIRES') && lightFeature('PHOTO_HIRES', ctx).allowed === true;
}

/**
 * The export plan for a drawing buffer of `bufW` x `bufH` (pure; node-gated).
 * request: 'auto' (the block's scale; touchScale when `touch`), a number, or
 * anything else (1x).
 * budget: the policy's { maxScale, maxLongPx }; limits: the GL limits
 * { maxTexture, maxRenderbuffer, maxViewport: [w, h] }.
 * Returns { scale, outW, outH, tiles, tileW, tileH } where tiles is the
 * number of tiles per axis (1 = a single offscreen render).
 */
export function photoExportPlan({ bufW, bufH, request, budget = {}, block = lightBlock('PHOTO_HIRES'), limits = {}, touch = false }) {
  const one = { scale: 1, outW: bufW, outH: bufH, tiles: 1, tileW: bufW, tileH: bufH };
  if (!(bufW > 0 && bufH > 0)) return one;
  // 'auto' on a touch device aims lower (touchScale): a phone's memory, not
  // its GPU, bounds the export, so it asks only what minLongPx needs.
  const wanted = request === 'auto' ? (touch ? block.touchScale : undefined) ?? block.scale ?? 3 : Number(request);
  if (!(wanted > 1)) return one;
  const long = Math.max(bufW, bufH);
  const maxScale = Math.max(1, budget.maxScale ?? 2);
  const maxLong = Math.max(long, budget.maxLongPx ?? 4096);
  let scale = Math.min(wanted, maxScale);
  // Reach the minimum long side when the policy allows it…
  if (long * scale < (block.minLongPx ?? 0)) scale = Math.min(maxScale, (block.minLongPx ?? 0) / long);
  // …and never past the policy's long-side ceiling.
  scale = Math.min(scale, maxLong / long);
  if (!(scale > 1.0001)) return one;
  // (+1e-6: a minLongPx scale times its own long side must not floor to 2,559)
  const outW = Math.floor(bufW * scale + 1e-6), outH = Math.floor(bufH * scale + 1e-6);
  const limit = Math.min(limits.maxTexture ?? Infinity, limits.maxRenderbuffer ?? Infinity, limits.maxViewport?.[0] ?? Infinity, limits.maxViewport?.[1] ?? Infinity);
  let tiles = Number.isFinite(limit) && limit > 0 ? Math.max(1, Math.ceil(Math.max(outW, outH) / limit)) : 1;
  const maxTiles = Math.max(1, block.maxTiles ?? 16);
  if (tiles * tiles > maxTiles) {
    // Too many tiles: shrink the export to what the bound allows.
    const n = Math.floor(Math.sqrt(maxTiles));
    const s2 = Math.min(scale, (n * limit) / long);
    if (!(s2 > 1.0001)) return one;
    return photoExportPlan({ bufW, bufH, request: s2, budget: { ...budget, maxScale: s2 }, block: { ...block, minLongPx: 0 }, limits });
  }
  return { scale, outW, outH, tiles, tileW: Math.ceil(outW / tiles), tileH: Math.ceil(outH / tiles) };
}

/**
 * Tile (tx, ty) of an n x n export as a clip-space matrix to left-multiply
 * the camera's projection: it maps the tile's rectangle of the full frame
 * onto the whole viewport (ty = 0 is the top row, as the 2D canvas is drawn).
 */
export function photoTileMatrix(n, tx, ty, out) {
  return out.set(n, 0, 0, n - 1 - 2 * tx, 0, n, 0, -(n - 1 - 2 * ty), 0, 0, 1, 0, 0, 0, 0, 1);
}

/** GL limits for the plan, from a three renderer. */
export function glPhotoLimits(renderer) {
  const gl = renderer?.getContext?.();
  if (!gl) return {};
  const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  return {
    maxTexture: renderer.capabilities?.maxTextureSize ?? gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    maxViewport: vp ? [vp[0], vp[1]] : undefined,
  };
}

/**
 * The section 6 contract: a photo of the current view as a PNG Blob.
 * `scale` as photoExportPlan's `request` ('auto' = the supersampled export
 * when PHOTO_HIRES is on; 1 = the drawing buffer).
 */
export function capturePhoto({ scale = 'auto' } = {}) {
  const action = getRuntimeAction('capturePhoto');
  if (!action) return Promise.reject(new Error('The camera is not ready.'));
  return action({ scale }).then((result) => result.blob);
}
