/**
 * Trailer capture: launch chromium on Mesa lavapipe (ANGLE Vulkan backend).
 * Measured in this container: ~2.4x SwiftShader's fill rate at 1920x1080.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BACKENDS = {
  lavapipe: { args: ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-vulkan=native', '--ignore-gpu-blocklist', '--disable-vulkan-surface'], env: { VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/lvp_icd.json' } },
  egl: { args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--use-gl=angle'], env: { EGL_PLATFORM: 'surfaceless', GALLIUM_DRIVER: 'llvmpipe' } },
  swiftshader: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], env: {} },
};
async function launch({ backend = process.env.TRAILER_GL || 'lavapipe', extraArgs = [] } = {}) {
  const B = BACKENDS[backend];
  return chromium.launch({
    headless: true,
    args: [...B.args, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...extraArgs],
    env: { ...process.env, ...B.env },
  });
}
module.exports = { launch, BACKENDS };
