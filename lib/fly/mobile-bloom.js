import { BloomEffect } from 'postprocessing';

/**
 * BloomEffect's resolutionScale only sizes its deprecated Kawase buffers.
 * With mipmapBlur enabled, 6.39.2 still renders luminance and the MIP pyramid
 * at the full scene size. Size those actual target owners explicitly.
 *
 * Preserve the library's scene-size bookkeeping: Resolution's change listener
 * calls setSize again, so passing scaled dimensions to super would repeatedly
 * scale its base size. No draw occurs during setSize; the temporary full-size
 * metadata is reduced before any target is allocated by the renderer.
 */
export class MobileBloomEffect extends BloomEffect {
  constructor(options = {}, { scale = 0.3, levels = 5 } = {}) {
    const boundedScale = Number.isFinite(scale) ? Math.min(1, Math.max(0.1, scale)) : 0.3;
    const boundedLevels = Number.isFinite(levels) ? Math.min(8, Math.max(2, Math.round(levels))) : 5;
    super({ ...options, mipmapBlur: true, resolutionScale: boundedScale, levels: boundedLevels });
    this.mobileBloomScale = boundedScale;
  }

  setSize(width, height) {
    super.setSize(width, height);
    const scale = this.mobileBloomScale ?? 1;
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    this.luminancePass.resolution.setPreferredSize(w, h);
    this.luminancePass.setSize(width, height);
    this.mipmapBlurPass.setSize(w, h);
  }
}
