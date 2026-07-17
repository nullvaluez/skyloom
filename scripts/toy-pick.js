/** Dev probe: teleport in toy mode, raycast through screen points, report
 *  which toy-world mesh (material/color/height) is under each pixel. */
const { chromium } = require('playwright');
const path = require('path');

const lon = parseFloat(process.argv[2] ?? '-73.951');
const lat = parseFloat(process.argv[3] ?? '40.727');
const altM = parseFloat(process.argv[4] ?? '500');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 200)));
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('header', { timeout: 120000 });
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 120000 });
  await page.waitForTimeout(8000);
  await page.mouse.move(800, 450);
  await page.evaluate(
    ({ lon, lat, altM }) => {
      const fly = window.__fly;
      fly.flight.pos.copy(fly.engine.geoToWorld(lon, lat, altM));
      fly.flight.speed = 60;
    },
    { lon, lat, altM }
  );
  await page.waitForTimeout(16000);
  await page.screenshot({ path: path.join(__dirname, 'toy-pick.png') });

  const report = await page.evaluate(() => {
    const fly = window.__fly;
    const scene = fly.engine.object.parent?.parent; // worldRoot -> scene
    const toy = scene?.getObjectByName('toy-world');
    if (!toy) return 'no toy-world group';
    const THREE_R = fly.engine.object.parent.constructor; // not three — use manual ray
    // Build a raycaster from three via any mesh's constructor chain is messy;
    // instead use the camera's project/unproject on scene meshes' raycast:
    const cam = fly.camera;
    const results = [];
    for (const [sx, sy] of [[0.0, -0.35], [0.0, -0.7], [-0.3, -0.5], [0.3, -0.5], [0, -0.15]]) {
      // NDC → ray via camera matrices (manual, no three import needed)
      const invProj = cam.projectionMatrixInverse.elements;
      const m = cam.matrixWorld.elements;
      const apply = (e, x, y, z) => {
        const w = e[3] * x + e[7] * y + e[11] * z + e[15];
        return [
          (e[0] * x + e[4] * y + e[8] * z + e[12]) / w,
          (e[1] * x + e[5] * y + e[9] * z + e[13]) / w,
          (e[2] * x + e[6] * y + e[10] * z + e[14]) / w,
        ];
      };
      const local = apply(invProj, sx, sy, 0.5);
      const world = apply(m, local[0], local[1], local[2]);
      const origin = [m[12], m[13], m[14]];
      const dir = [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]];
      const len = Math.hypot(...dir);
      dir[0] /= len;
      dir[1] /= len;
      dir[2] /= len;
      // use three's Raycaster through an existing instance: grab from any mesh
      // — toy meshes' geometry has boundingSphere; use the renderer's THREE via
      // window if exposed. Fallback: cheap manual march against mesh bboxes.
      // Simplest: borrow Raycaster from the drei/three already in scene:
      const anyMesh = toy.children.find((c) => c.isMesh);
      if (!anyMesh) return 'no meshes';
      const three = anyMesh.constructor; // Mesh class — no module access
      // Use object3D.raycast via a hand-rolled Raycaster-like: not feasible —
      // instead intersect using three's built-in raycast through the shared
      // Raycaster on window.__toyRaycaster if FlyScene exposed one… it didn't.
      // Pragmatic: use camera-space depth sampling instead: find nearest mesh
      // whose bounding box the ray crosses, then report material + avg color.
      let best = null;
      for (const mesh of toy.children) {
        if (!mesh.isMesh) continue;
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        const px = mesh.position.x + (toy.parent?.position.x ?? 0);
        const py = mesh.position.y;
        const pz = mesh.position.z + (toy.parent?.position.z ?? 0);
        // slab AABB in render space
        const min = [bb.min.x + px, bb.min.y + py, bb.min.z + pz];
        const max = [bb.max.x + px, bb.max.y + py, bb.max.z + pz];
        // ray-AABB
        let t0 = 0;
        let t1 = 1e9;
        let ok = true;
        for (let a = 0; a < 3; a++) {
          const inv = 1 / dir[a];
          let tn = (min[a] - origin[a]) * inv;
          let tf = (max[a] - origin[a]) * inv;
          if (tn > tf) [tn, tf] = [tf, tn];
          t0 = Math.max(t0, tn);
          t1 = Math.min(t1, tf);
          if (t0 > t1) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        if (!best || t0 < best.t) {
          best = { t: t0, mesh };
        }
      }
      if (!best) {
        results.push({ sx, sy, hit: null });
        continue;
      }
      const mesh = best.mesh;
      const mat = mesh.material;
      const colAttr = mesh.geometry.getAttribute('color');
      let avg = null;
      if (colAttr) {
        let r = 0;
        let g = 0;
        let b = 0;
        const n = Math.min(colAttr.count, 3000);
        for (let i = 0; i < n; i++) {
          r += colAttr.getX(i);
          g += colAttr.getY(i);
          b += colAttr.getZ(i);
        }
        avg = [r / n, g / n, b / n].map((v) => +v.toFixed(3));
      }
      const posAttr = mesh.geometry.getAttribute('position');
      let yMin = Infinity;
      let yMax = -Infinity;
      for (let i = 0; i < Math.min(posAttr.count, 5000); i++) {
        const y = posAttr.getY(i);
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
      results.push({
        sx,
        sy,
        isInstanced: !!mesh.isInstancedMesh,
        side: mat.side,
        vertexColors: mat.vertexColors,
        matColor: mat.color?.getHexString?.(),
        avgVertexColor: avg,
        yMin: +yMin.toFixed(1),
        yMax: +yMax.toFixed(1),
        chunkPos: [Math.round(mesh.position.x), Math.round(mesh.position.z)],
        tris: (mesh.geometry.index?.count ?? 0) / 3,
      });
    }
    return results;
  });
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
