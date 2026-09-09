/*
 * GPU regression: cached terrain images must use the same geographic UVs as
 * upstream HTMLImageElement textures, including overzoom quadrant clipping.
 * Runs the actual cached loader class extracted from raster-cache.js, the
 * vendored upstream loader/getSubImage, and installed Three in real Chrome.
 * No app server, remote tiles, cache purge, or production settings are needed.
 * node scripts/verify-raster-orientation.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib/fly/raster-cache.js'), 'utf8');
const loaderSource = source.match(/class FlyCachedImageLoader extends TileImageLoader \{[\s\S]*?\n\}/)?.[0];
if (!loaderSource) throw new Error('Cached image loader source extraction failed');
const threeDir = path.dirname(require.resolve('three'));
const output = path.join(root, '.graphics-review/raster-orientation');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://raster.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const files = {
        '/three.module.js': path.join(threeDir, 'three.module.js'),
        '/three.core.js': path.join(threeDir, 'three.core.js'),
        '/tile.js': path.join(root, 'lib/fly/vendor/three-tile/index.js'),
      };
      if (files[pathname]) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(files[pathname]) });
      return route.fulfill({ contentType: 'text/html', body: '<script type="importmap">{"imports":{"three":"/three.module.js"}}</script>' });
    });
    await page.goto('http://raster.test/');
    const result = await page.evaluate(async sourceText => {
      const T = await import('/three.module.js');
      const { TileImageLoader, getSubImage } = await import('/tile.js');
      const ActualLoader = new Function('TileImageLoader', 'getSubImage', 'Texture', 'SRGBColorSpace', 'cachedFetch', 'CACHED_IMAGE_TYPE', `${sourceText}; return FlyCachedImageLoader;`)(
        TileImageLoader, getSubImage, T.Texture, T.SRGBColorSpace, url => fetch(url), 'test-cached-image',
      );
      // Deliberate historical defect control: a raw ImageBitmap ignores
      // Texture.flipY. The old clipped branch already happened to use canvas.
      class BrokenLoader extends TileImageLoader {
        async doLoad(url, params) {
          const bitmap = await createImageBitmap(await (await fetch(url)).blob());
          const cb = params.clipBounds;
          const image = cb && cb[2] - cb[0] < 1 ? getSubImage(bitmap, cb) : bitmap;
          const texture = new T.Texture(image);
          texture.colorSpace = T.SRGBColorSpace;
          texture.needsUpdate = true;
          texture.userData.decoderBitmap = bitmap;
          return texture;
        }
      }
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d');
      // Every geographic row/column has a distinct color; a crop selected
      // after an accidental flip cannot pass simply because it is uniform.
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        ctx.fillStyle = `rgb(${24 + y * 30},${24 + x * 30},${24 + ((x + y * 3) % 8) * 30})`;
        ctx.fillRect(x * 32, y * 32, 32, 32);
      }
      const url = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
      const renderer = new T.WebGLRenderer({ antialias: false });
      renderer.setSize(64, 64, false);
      const gl = renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      if (!gpu || /SwiftShader|llvmpipe|software/i.test(gpu)) {
        renderer.dispose(); URL.revokeObjectURL(url);
        return { status: 'BLOCKED', reason: 'Real GPU unavailable', gpu };
      }
      const scene = new T.Scene();
      const camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10);
      camera.position.z = 1;
      const material = new T.MeshBasicMaterial({ toneMapped: false });
      const geometry = new T.PlaneGeometry(2, 2);
      scene.add(new T.Mesh(geometry, material));
      const target = new T.WebGLRenderTarget(64, 64);
      const render = texture => {
        texture.minFilter = T.NearestFilter;
        texture.magFilter = T.NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        material.map = texture; material.needsUpdate = true;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(64 * 64 * 4);
        renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
        return pixels;
      };
      const difference = (a, b) => {
        let max = 0, changed = 0;
        for (let i = 0; i < a.length; i++) {
          const delta = Math.abs(a[i] - b[i]);
          max = Math.max(max, delta); changed += delta > 2 ? 1 : 0;
        }
        return { maxChannelDifference: max, differingChannels: changed };
      };
      const cases = [
        ['whole', [0, 0, 1, 1]],
        ['northwest', [0, 0, .5, .5]],
        ['northeast', [.5, 0, 1, .5]],
        ['southwest', [0, .5, .5, 1]],
        ['southeast', [.5, .5, 1, 1]],
        ['deeper-south-crop', [.25, .625, .5, .875]],
      ];
      const rows = [];
      const actual = new ActualLoader(), upstream = new TileImageLoader(), broken = new BrokenLoader();
      for (const [name, clipBounds] of cases) {
        const params = { clipBounds };
        const reference = await upstream.doLoad(url, params);
        const before = await broken.doLoad(url, params);
        const after = await actual.doLoad(url, params);
        const expectedPixels = render(reference);
        rows.push({ name, clipBounds, old: difference(render(before), expectedPixels), fixed: difference(render(after), expectedPixels), imageType: after.image.constructor.name });
        reference.dispose(); before.dispose(); after.dispose();
        before.userData.decoderBitmap.close();
      }
      target.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); URL.revokeObjectURL(url);
      const requiredRed = rows[0].old.differingChannels > 64 * 64;
      const fixedPass = rows.every(r => r.fixed.differingChannels === 0);
      return { status: requiredRed && fixedPass ? 'PASS' : 'FAIL', gpu, requiredRed, fixedPass, rows };
    }, loaderSource);
    result.errors = errors;
    result.loaderSha256 = crypto.createHash('sha256').update(loaderSource).digest('hex');
    if (errors.length) result.status = 'FAIL';
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'PASS' ? 0 : result.status === 'BLOCKED' ? 2 : 1;
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
