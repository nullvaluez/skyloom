/* Shipped-scene precondition for opt-in legacy regression runs. The historical
 * pixel/ordering assertions are untouched; unavailable evidence is BLOCKED. */
module.exports = async function graphicsPrecondition(page) {
  const evidence = await page.evaluate(() => {
    const gl = window.__flyComposer?.getRenderer?.().getContext();
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
      pins: Object.fromEntries(['__flyTerraPin', '__flyClutterPin', '__flyDepthPin', '__flyAerialOverride', '__flySatShadowOverride']
        .map(k => [k, window[k] ?? null])),
      immersive: new URLSearchParams(location.search).get('graphics') === 'immersive',
      clouds: window.__flyComposer?.passes.some(p => p.name === 'ImmersiveClouds'),
    };
  });
  if (!evidence.renderer || /software|swiftshader|llvmpipe/i.test(evidence.renderer))
    return { status: 'BLOCKED', reason: 'Hardware WebGL renderer unavailable', evidence };
  if (Object.values(evidence.pins).some(v => v !== null) || (evidence.immersive && !evidence.clouds))
    return { status: 'BLOCKED', reason: 'The requested rendering stack is not active', evidence };
  try {
    await page.waitForFunction(() => window.__graphicsReview?.terrain?.sharp && window.__fly?.satBuildings?.stats.ready > 0,
      null, { timeout: 60000 });
  } catch {
    return { status: 'BLOCKED', reason: 'Terrain/building readiness was not established', evidence };
  }
  return { status: 'READY', evidence };
};
