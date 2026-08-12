/**
 * R22.1 (C "FLASH") — PROBE 12: how many zero-area triangles are there?
 *
 * Probe 11 named ONE degenerate triangle (three collinear vertices) as the
 * sole painter of a pale frame. This probe censuses every streamed
 * sat-buildings chunk and counts degenerate triangles — exactly zero-area
 * (three collinear or coincident vertices) and near-zero-area — so the fix
 * can be sized and the "content-neutral" claim can be checked: a zero-area
 * triangle contributes no pixels when it behaves, so removing it must not
 * change the scene.
 *
 * No pale event needed; this is a static census of the streamed geometry.
 *
 *   node scripts/r22p1-c-probe12.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-degen');
const POSES = {
  powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' },
  nyc: null,
};
const POSE = POSES[process.env.POSE ?? 'nyc'];

const CENSUS = () => {
  const g = window.__satBuildings?.object;
  if (!g) return { err: 'no sat-buildings group' };
  const out = { chunks: [], totals: { tris: 0, zeroArea: 0, coincident: 0, tiny: 0, meshes: 0 } };
  for (const m of g.children) {
    const geo = m.geometry;
    const P = geo?.attributes?.position;
    if (!P) continue;
    const idx = geo.index;
    const n = idx ? idx.count : P.count;
    let tris = 0, zero = 0, coin = 0, tiny = 0;
    let worstZeroExample = null;
    for (let i = 0; i + 2 < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      const ax = P.getX(a), ay = P.getY(a), az = P.getZ(a);
      const bx = P.getX(b), by = P.getY(b), bz = P.getZ(b);
      const cx = P.getX(c), cy = P.getY(c), cz = P.getZ(c);
      // cross((b-a),(c-a)) magnitude = 2*area
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const area2 = Math.hypot(nx, ny, nz);
      tris++;
      if (area2 === 0) {
        zero++;
        if (!worstZeroExample) worstZeroExample = { i, a, b, c, pa: [ax, ay, az], pb: [bx, by, bz], pc: [cx, cy, cz] };
        if ((ax === bx && ay === by && az === bz) || (ax === cx && ay === cy && az === cz) || (bx === cx && by === cy && bz === cz)) coin++;
      } else if (area2 < 1e-6) tiny++;
    }
    out.chunks.push({
      uuid: m.uuid.slice(0, 8), verts: P.count, tris, zeroArea: zero, coincident: coin, tiny,
      pctZero: +((100 * zero) / Math.max(1, tris)).toFixed(3), example: worstZeroExample,
    });
    out.totals.tris += tris; out.totals.zeroArea += zero; out.totals.coincident += coin; out.totals.tiny += tiny; out.totals.meshes++;
  }
  out.totals.pctZero = +((100 * out.totals.zeroArea) / Math.max(1, out.totals.tris)).toFixed(3);
  return out;
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1', args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 660 }, deviceScaleFactor: +(process.env.DSF ?? 1.5) });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(unpinPins, ['__flySettlePin']);
  console.log(`[c12] boot ${(await bootFly(page, { ...BOOT_OPTS, style: 'satellite' })).ms} ms`);
  if (POSE) {
    await page.evaluate(([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }), [POSE.lat, POSE.lon, POSE.altM, POSE.name]);
  }
  await page.waitForTimeout(+(process.env.SETTLE ?? 30000));
  const c = await page.evaluate(CENSUS);
  console.log(`\n[c12] pose=${process.env.POSE ?? 'nyc'}  ${JSON.stringify(c.totals)}`);
  for (const r of (c.chunks ?? []).slice(0, 40)) {
    console.log(`  ${r.uuid} verts=${String(r.verts).padStart(6)} tris=${String(r.tris).padStart(6)} ZERO=${String(r.zeroArea).padStart(5)} (${r.pctZero}%) coincident=${r.coincident} tiny=${r.tiny}`);
  }
  const ex = (c.chunks ?? []).find((r) => r.example)?.example;
  if (ex) console.log(`\n  example zero-area triangle: ${JSON.stringify(ex)}`);
  fs.writeFileSync(path.join(OUT, `degen-${process.env.POSE ?? 'nyc'}.json`), JSON.stringify(c, null, 1));
  console.log('[c12] pageerrors', errs.length);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
