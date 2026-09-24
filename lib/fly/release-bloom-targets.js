/** Release outgoing BloomEffect GPU buffers before its replacement allocates.
 * Keep its materials until R3F's normal deferred disposal: destroying the last
 * program reference during commit forces the incoming effect to compile again.
 * Only visit BloomEffect's private target owners, never scenes or uniforms. */
export function releaseBloomTargets(effect) {
  const seen = new Set();
  const release = value => {
    if (!value?.isWebGLRenderTarget || seen.has(value)) return;
    seen.add(value);
    value.dispose();
  };
  for (const owner of [effect, effect?.blurPass, effect?.luminancePass, effect?.mipmapBlurPass]) {
    if (!owner) continue;
    for (const value of Object.values(owner)) {
      if (Array.isArray(value)) value.forEach(release);
      else release(value);
    }
  }
}
