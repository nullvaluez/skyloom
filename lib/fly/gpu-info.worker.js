/** Keep the capability context alive until the flight canvas takes ownership.
 * Context creation can wait on the driver for seconds; it belongs off the UI
 * thread while LaunchScreen remains responsive. No scene or shader work here.
 */
let context = null;
self.onmessage = ({ data }) => {
  if (data?.type !== 'probe') return;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const options = { powerPreference: 'high-performance', antialias: false, stencil: false, alpha: false };
    context = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
    if (!context) throw Error('WebGL is unavailable in this worker');
    const ext = context.getExtension('WEBGL_debug_renderer_info');
    const vendor = String(context.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : context.VENDOR));
    const renderer = String(context.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : context.RENDERER));
    self.postMessage({ type: 'gpu-info', ok: true, vendor, renderer });
  } catch {
    self.postMessage({ type: 'gpu-info', ok: false });
  }
};
