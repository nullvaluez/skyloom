/**
 * n8ao composites into its own full-size target and then copies that into the
 * composer's output with a plain texel-centre texture2D (no colour-space or
 * tone-mapping step). When the output buffer has the same size and format,
 * compositing straight into it writes the same values with the same program,
 * minus one full-resolution read and write per frame. The composer's read and
 * write buffers are distinct, so there is no feedback loop.
 * scripts/verify-n8ao-direct.mjs renders both paths and compares the pixels.
 */
const NO_COPY = { material: { uniforms: { tDiffuse: { value: null } } }, render() {} };

export function canCompositeDirect(pass, inputBuffer, outputBuffer) {
  const internal = pass.outputTargetInternal;
  return !pass.renderToScreen && !!internal && !!outputBuffer && !!inputBuffer && outputBuffer !== inputBuffer &&
    !outputBuffer.depthTexture && !outputBuffer.samples &&
    outputBuffer.width === internal.width && outputBuffer.height === internal.height &&
    outputBuffer.texture.type === inputBuffer.texture.type && outputBuffer.texture.format === inputBuffer.texture.format;
}

/** Run `render` (the pass's own render) compositing directly when possible.
 *  Returns whether the direct path was taken. */
export function withDirectComposite(pass, inputBuffer, outputBuffer, render) {
  const direct = canCompositeDirect(pass, inputBuffer, outputBuffer);
  const internal = pass.outputTargetInternal, copy = pass.copyQuad;
  if (direct) {
    pass.outputTargetInternal = outputBuffer;
    pass.copyQuad = NO_COPY;
  }
  try {
    render();
  } finally {
    pass.outputTargetInternal = internal;
    pass.copyQuad = copy;
  }
  return direct;
}
