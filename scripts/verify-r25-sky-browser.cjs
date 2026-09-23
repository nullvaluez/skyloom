/**
 * R25 (C SKY) — verify-r25-sky-browser (FIXTURE browser gate; SATELLITE).
 *
 * THE CLAIMS (FLY_ROUND25_PLAN.md, role C gates):
 *   (1) ONE HORIZON — the horizon seam deltaE (E's shared instrument,
 *       scripts/_r25-luma.js horizonSeam over E's HORIZON crop) is
 *       <= R25_CERT.horizon.maxDeltaE AND <= improveK x the Classic seam.
 *   (2) C-ONLY LUMINANCE — with `window.__flyR25Ground = 0` (D forced off),
 *       Enhanced / Classic mean linear terrain luminance (E's TERRAIN crop) is
 *       inside R25_CERT.luma.cOnly.
 *   (3) CLIP — the terrain crop's clip census rises by <= R25_CERT.luma.clipPts.
 *   (4) NO 22 km CLOUD EDGE — read off the CLOUD PASS'S OWN TARGET (the
 *       reduced-resolution march output, alpha = cloud transmittance), not
 *       off the composited scene: per target texel, the metric distance at
 *       which its ray reaches the dense cloud layer, binned. Classic keeps
 *       full opacity up to the IMMERSIVE.clouds.rangeM cut (the hard edge);
 *       Enhanced must have faded to <= 15 % of its 12-15 km opacity in the
 *       last 1 km before the cut. A Classic that shows no cloud near the cut
 *       reads NOT CALIBRATED (the leg measured no edge).
 *   (5) OWENS DRAWS UNCHANGED — Enhanced draws == Classic draws at P1, <= 261.
 *   (6) Classic -> Enhanced -> Classic restores Classic (within the venue's
 *       own two-capture floor).
 *
 * SESSION: one satellite fixture boot. `__flyVisualsOverride` UN-pinned and
 * `fly-visuals` seeded 'classic' (E's visuals idiom); `__flyAerialOverride`
 * UN-pinned — the aerial post pass IS the haze law Enhanced retires the stack
 * onto, and it always runs in the product (FlyScene: highTier folds
 * immersiveOn('lighting'), true), so the horizon and luminance legs measure
 * the product's atmosphere; the fleet-pinned column is recorded beside it
 * as INFORMATION. `__flyR25Ground = 0` makes every Enhanced column C-ONLY.
 * `__flyCloudFreeze = 1` stops cloud drift. Player + traffic hidden (the R17
 * lesson: a pixel gate must not contain an actor it does not control).
 *
 * POSES: P1 Owens 1500 m noon (the Owens lock; horizon + luminance + draws),
 * P6 Owens 7000 m noon (horizon + luminance at cruise), and CLOUD — Owens at
 * 3600 m MSL, pitch -0.06 rad, noon (the eye ~1000 m above the slab top, so
 * the layer's far edge sits a few degrees under the horizon, in frame).
 *
 * RED FIRST (scripts/r25-c-sky.md): with R25_SKY.enabled false on the server
 * tree (the branch as it stood before the flip), Enhanced == Classic, so the
 * seam ratio is 1.0 (FAIL against improveK 0.6) and the cloud leg's Enhanced
 * shows the same hard edge Classic does (FAIL).
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3203 FLY_URL=http://localhost:3033 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/verify-r25-sky-browser.cjs
 *   (R25_SKY_LEGS=owens,high,cloud,look selects legs; default all four;
 *    `look` is INFO only: Owens 1500 m at dusk facing the sun and away)
 *
 * Exit: 1 on any FAIL, else 2 when any leg is NOT CALIBRATED, else 0.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { pose, warpToPose } = require('./_r25-poses');
const L = require('./_r25-luma');
const { makeCanvasShot } = require('./_canvasshot');

const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'c');
fs.mkdirSync(OUT, { recursive: true });
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const LEGS = (process.env.R25_SKY_LEGS || 'owens,high,cloud,look').split(',');
// E's crops, verbatim (scripts/verify-r25-visuals.cjs) — one ruler.
const TERRAIN = { left: 0.12, top: 0.62, width: 0.76, height: 0.3 };
const HORIZON = { left: 0.35, top: 0.05, width: 0.3, height: 0.6 };

let pass = 0, fail = 0, notcal = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  rows.push({ name, verdict: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const notCal = (name, why) => {
  notcal++;
  rows.push({ name, verdict: 'NOT CALIBRATED', detail: why });
  console.log(`NOTCAL  ${name}  — ${why}`);
};
const info = (name, detail) => {
  rows.push({ name, verdict: 'INFO', detail });
  console.log(`INFO  ${name}  — ${detail}`);
};
const fmt = (d) => `mean ${d.mean.toFixed(3)}/255 p99 ${d.p99}/255 max ${d.max}`;

async function frames(page, n) {
  const f0 = await page.evaluate(() => window.__fly.framesRendered ?? 0);
  await page.waitForFunction((t) => (window.__fly.framesRendered ?? 0) >= t, f0 + n, { timeout: 180000 * SCALE, polling: 250 });
}
async function setVisuals(page, v) {
  await page.evaluate((v) => window.__flyStore.getState().setVisuals(v), v);
}
async function setAerialPin(page, v) {
  // unpinPins' getter reads window.__r22Unpinned[name]; undefined = the product.
  await page.evaluate((v) => {
    (window.__r22Unpinned ??= {}).__flyAerialOverride = v;
  }, v);
}
async function hideActors(page) {
  await page.evaluate(() => {
    window.__flyCloudFreeze = 1;
    if (window.__flyPlayer) window.__flyPlayer.visible = false;
    if (window.__flyTraffic) window.__flyTraffic.visible = false;
  });
}
async function draws(page) {
  await page.evaluate(() => {
    window.__flyStats.drawCalls = undefined;
  });
  await page.waitForFunction(() => Number.isFinite(window.__flyStats?.drawCalls), undefined, { timeout: 240000 * SCALE, polling: 500 }).catch(() => {});
  return page.evaluate(() => ({ draws: window.__flyStats?.drawCalls ?? null, tris: window.__flyStats?.triangles ?? null }));
}
async function skyStats(page) {
  return page.evaluate(() => ({ r25: window.__flyStats?.r25Sky ?? null, clouds: window.__fly?.immersiveClouds ? { ...window.__fly.immersiveClouds } : null }));
}

/**
 * THE CLOUD INSTRUMENT (in page): read the cloud pass's reduced-resolution
 * target (RGBA half float; a = transmittance after the march), and for each
 * texel in the central column band compute where its ray reaches the dense
 * layer (IMMERSIVE cloud base + 0.35 x thickness — the envelope's densest
 * band) in METRIC metres, the march's own `t * metricRay`. Returns opacity
 * binned per km.
 */
function cloudProfileInPage() {
  const composer = window.__flyComposer;
  const pass = composer?.passes?.find((p) => p?.name === 'ImmersiveClouds');
  const rt = window.__fly;
  const gl = window.__flyGl;
  if (!pass || !gl || !rt?.camera) return { error: 'no cloud pass / gl / camera' };
  const t = pass.target;
  const w = t.width, h = t.height;
  const buf = new Uint16Array(w * h * 4);
  try {
    gl.readRenderTargetPixels(t, 0, 0, w, h, buf);
  } catch (e) {
    return { error: `read failed: ${e.message}` };
  }
  const half = (b) => {
    const s = (b & 0x8000) >> 15, e = (b & 0x7c00) >> 10, f = b & 0x03ff;
    if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024);
    if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
    return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024);
  };
  const cam = rt.camera;
  cam.updateMatrixWorld();
  const u = pass.uniforms;
  const base = u.base.value, thick = u.thickness.value, k = u.metricScale.value;
  const hMid = base + 0.35 * thick;
  const eye = cam.position;
  const V = cam.position.constructor;
  const v = new V();
  const bins = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = Math.floor(w * 0.3); x < Math.ceil(w * 0.7); x++) {
      v.set(((x + 0.5) / w) * 2 - 1, ((y + 0.5) / h) * 2 - 1, 0.5).applyMatrix4(cam.projectionMatrixInverse).applyMatrix4(cam.matrixWorld).sub(eye).normalize();
      if (v.y >= -1e-4) continue;
      const tt = (hMid - eye.y) / v.y;
      if (!(tt > 0)) continue;
      const mr = Math.hypot(v.x / k, v.y, v.z / k);
      const dKm = (tt * mr) / 1000;
      const a = half(buf[(y * w + x) * 4 + 3]);
      if (!Number.isFinite(a)) continue;
      const bin = Math.floor(dKm);
      const e = bins.get(bin) ?? { n: 0, op: 0 };
      e.n++;
      e.op += 1 - Math.min(1, Math.max(0, a));
      bins.set(bin, e);
    }
  }
  const out = {};
  for (const [b, e] of bins) out[b] = { n: e.n, op: +(e.op / e.n).toFixed(4) };
  return { w, h, hMid, rangeKm: 22, bins: out, eyeY: eye.y };
}

(async () => {
  const C = await import(pathToFileURL(path.join(__dirname, '..', 'lib/fly/fly-constants.js')).href);
  const CERT = C.R25_CERT;
  const rangeKm = C.R25_SKY.cloudAir.fadeEndM / 1000;
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  const shot = makeCanvasShot(page).shot;
  const cap = async (tag) => {
    const buf = await shot();
    fs.writeFileSync(path.join(OUT, `${tag}.png`), buf);
    return buf;
  };
  const results = {};
  try {
    await page.addInitScript(unpinPins, ['__flyVisualsOverride', '__flyAerialOverride']);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('fly-visuals', 'classic');
      } catch {
        /* storage blocked */
      }
      window.__flyR25Ground = 0; // C-ONLY: D's block forced off in Enhanced
      window.__flyCloudFreeze = 1;
    });
    const boot = await bootFly(page, { style: 'satellite', timeoutMs: 1200000 });
    console.log(`[boot] revealed in ${boot.ms} ms`);
    const shipped = await page.evaluate(() => ({ visuals: window.__flyStore.getState().visuals }));
    console.log(`[boot] profile ${shipped.visuals}`);

    const measurePose = async (tag, P, { lumaLeg = true, drawLeg = false } = {}) => {
      const { readiness, ms } = await warpToPose(page, P, { sun: 'noon', timeoutMs: 900000, pollMs: 5000, pin: true, pitchRad: P.pitchRad ?? -0.1 });
      console.log(`[${tag}] ready=${readiness?.ready} in ${ms} ms missing=${JSON.stringify(readiness?.missing)}`);
      if (!readiness?.ready) {
        notCal(`(${tag}) pose settles`, `world never ready: missing ${JSON.stringify(readiness?.missing)}`);
        return null;
      }
      await hideActors(page);
      await setAerialPin(page, undefined);
      await setVisuals(page, 'classic');
      await frames(page, 30);
      const r = (results[tag] = {});
      const c0 = await cap(`${tag}-classic-0`);
      await frames(page, 12);
      const c0b = await cap(`${tag}-classic-0b`);
      r.floor = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(c0b));
      const dC = drawLeg ? await draws(page) : null;
      await setVisuals(page, 'enhanced');
      await frames(page, 24);
      const e1 = await cap(`${tag}-enhanced`);
      r.sky = await skyStats(page);
      const dE = drawLeg ? await draws(page) : null;
      // the fleet-pinned column (INFO): aerial pin 0 in both profiles
      await setAerialPin(page, 0);
      await frames(page, 16);
      const ep = await cap(`${tag}-enhanced-aerialpin0`);
      await setVisuals(page, 'classic');
      await frames(page, 16);
      const cp = await cap(`${tag}-classic-aerialpin0`);
      await setAerialPin(page, undefined);
      await frames(page, 20);
      const c1 = await cap(`${tag}-classic-1`);

      const hC = L.horizonSeam(await L.loadRegion(c0, HORIZON));
      const hE = L.horizonSeam(await L.loadRegion(e1, HORIZON));
      r.seam = { classic: hC, enhanced: hE };
      const ok1 = Number.isFinite(hE.deltaE) && hE.deltaE <= CERT.horizon.maxDeltaE && hE.deltaE <= CERT.horizon.improveK * hC.deltaE;
      gate(`(1) ${tag}: horizon seam dE <= ${CERT.horizon.maxDeltaE} and <= ${CERT.horizon.improveK} x Classic`, ok1,
        `Classic ${hC.deltaE.toFixed(2)} @row ${hC.row} [${hC.above?.srgb8.map((v) => v.toFixed(0))} | ${hC.below?.srgb8.map((v) => v.toFixed(0))}] · ` +
          `Enhanced ${hE.deltaE.toFixed(2)} @row ${hE.row} [${hE.above?.srgb8.map((v) => v.toFixed(0))} | ${hE.below?.srgb8.map((v) => v.toFixed(0))}]`);
      const hCp = L.horizonSeam(await L.loadRegion(cp, HORIZON));
      const hEp = L.horizonSeam(await L.loadRegion(ep, HORIZON));
      info(`${tag}: horizon seam under the FLEET aerial pin (0)`, `Classic ${hCp.deltaE.toFixed(2)} @${hCp.row} · Enhanced ${hEp.deltaE.toFixed(2)} @${hEp.row}`);
      if (lumaLeg) {
        const tC = L.census(await L.loadRegion(c0, TERRAIN));
        const tE = L.census(await L.loadRegion(e1, TERRAIN));
        const k = L.ratio(tE.meanLin, tC.meanLin);
        r.luma = { classic: tC, enhanced: tE, ratio: k };
        const [lo, hi] = CERT.luma.cOnly;
        gate(`(2) ${tag}: C-only Enhanced/Classic terrain luminance in [${lo}, ${hi}]`, k != null && k >= lo && k <= hi,
          `ratio ${k?.toFixed(4)} (Classic ${tC.meanLin.toFixed(4)} -> Enhanced ${tE.meanLin.toFixed(4)})`);
        gate(`(3) ${tag}: clip +<= ${CERT.luma.clipPts} pt`, tE.clip - tC.clip <= CERT.luma.clipPts, `${tC.clip.toFixed(2)} -> ${tE.clip.toFixed(2)} %`);
        const tCp = L.census(await L.loadRegion(cp, TERRAIN));
        const tEp = L.census(await L.loadRegion(ep, TERRAIN));
        info(`${tag}: C-only luminance under the fleet aerial pin`, `ratio ${L.ratio(tEp.meanLin, tCp.meanLin)?.toFixed(4)}`);
      }
      const back = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(c1));
      r.back = back;
      const resolvable = r.floor.mean <= 0.5 && r.floor.p99 <= 2;
      if (!resolvable) notCal(`(6) ${tag}: Classic -> Enhanced -> Classic restores Classic`, `venue floor ${fmt(r.floor)}`);
      else gate(`(6) ${tag}: Classic -> Enhanced -> Classic restores Classic`, back.mean <= r.floor.mean + 0.5 && back.p99 <= Math.max(2, r.floor.p99), `${fmt(back)} (floor ${fmt(r.floor)})`);
      if (drawLeg) {
        r.draws = { classic: dC, enhanced: dE };
        gate(`(5) ${tag}: draws unchanged by Enhanced and <= 261`, Number.isFinite(dC?.draws) && dC.draws === dE?.draws && dE.draws <= 261,
          `Classic ${dC?.draws} / Enhanced ${dE?.draws} (tris ${dC?.tris} / ${dE?.tris})`);
      }
      info(`${tag}: r25Sky stats (Enhanced)`, JSON.stringify(r.sky.r25));
      return r;
    };

    if (LEGS.includes('owens')) await measurePose('P1-owens', pose('owens'), { drawLeg: true });
    if (LEGS.includes('high')) await measurePose('P6-owensHigh', pose('owensHigh'));

    if (LEGS.includes('cloud')) {
      const P = { id: 'PC', name: 'owensCloud', scene: 'owens', lat: 36.6, lon: -118.1, altM: 3600, hdgDeg: 0, pitchRad: -0.06 };
      const { readiness } = await warpToPose(page, P, { sun: 'noon', timeoutMs: 900000, pollMs: 5000, pin: true, pitchRad: -0.06 });
      if (!readiness?.ready) notCal('(4) cloud pose settles', `missing ${JSON.stringify(readiness?.missing)}`);
      else {
        await hideActors(page);
        await setAerialPin(page, undefined);
        const prof = {};
        for (const v of ['classic', 'enhanced']) {
          await setVisuals(page, v);
          await frames(page, 24);
          await cap(`PC-cloud-${v}`);
          prof[v] = await page.evaluate(cloudProfileInPage);
        }
        await setVisuals(page, 'classic');
        results.cloud = prof;
        const op = (p, a, b) => {
          let n = 0, s = 0;
          for (const [k, e] of Object.entries(p.bins ?? {})) if (+k >= a && +k < b) (n += e.n), (s += e.op * e.n);
          return n ? s / n : null;
        };
        const cut = Math.round(rangeKm);
        const cRef = op(prof.classic, 12, 15), cEdge = op(prof.classic, cut - 1, cut);
        const eRef = op(prof.enhanced, 12, 15), eEdge = op(prof.enhanced, cut - 1, cut);
        const beyondC = op(prof.classic, cut + 1, cut + 6), beyondE = op(prof.enhanced, cut + 1, cut + 6);
        console.log(`[cloud] classic bins ${JSON.stringify(prof.classic.bins)}`);
        console.log(`[cloud] enhanced bins ${JSON.stringify(prof.enhanced.bins)}`);
        const detail = `Classic 12-15 km ${cRef?.toFixed(3)} / ${cut - 1}-${cut} km ${cEdge?.toFixed(3)} / beyond ${beyondC?.toFixed(3)} · ` +
          `Enhanced 12-15 km ${eRef?.toFixed(3)} / ${cut - 1}-${cut} km ${eEdge?.toFixed(3)} / beyond ${beyondE?.toFixed(3)}`;
        if (prof.classic.error || prof.enhanced.error) notCal('(4) no 22 km cloud edge', `instrument: ${prof.classic.error ?? prof.enhanced.error}`);
        else if (!(cRef > 0.02) || !(cEdge > 0.5 * cRef)) notCal('(4) no 22 km cloud edge', `Classic shows no cloud at the cut to fade (${detail})`);
        else gate('(4) no 22 km cloud edge: Enhanced opacity in the last km before the cut <= 15 % of its 12-15 km opacity', eRef > 0.02 && eEdge <= 0.15 * eRef, detail);
      }
    }
    // LOOK (INFO only, evidence for the user's A/B): Owens 1500 m at DUSK
    // (+4 deg), facing the sun and facing away — the case the azimuth-
    // dependent in-scatter and the IBL rotation exist for. Heading toward the
    // sun is az + pi (flight forward = (sin h, ., -cos h); the app sun is
    // (-sin az, ., cos az)).
    if (LEGS.includes('look')) {
      const { sunTimeMs } = require('./_r25-poses');
      const { computeSun } = await import(pathToFileURL(path.join(__dirname, '..', 'lib/fly/sun-model.js')).href);
      const base = pose('owens');
      const { tMs } = await sunTimeMs(base, 'dusk');
      const az = computeSun(base.lon, base.lat, tMs).az;
      for (const [tag, hdg] of [['toward', az + Math.PI], ['away', az]]) {
        const P = { ...base, id: `PL-${tag}`, hdgDeg: ((hdg * 180) / Math.PI + 360) % 360 };
        const { readiness } = await warpToPose(page, P, { sun: tMs, timeoutMs: 600000, pollMs: 5000, pin: true, pitchRad: -0.05 });
        if (!readiness?.ready) {
          info(`look ${tag}`, `world not ready: ${JSON.stringify(readiness?.missing)}`);
          continue;
        }
        await hideActors(page);
        await setAerialPin(page, undefined);
        const got = {};
        for (const v of ['classic', 'enhanced']) {
          await setVisuals(page, v);
          await frames(page, 24);
          got[v] = await cap(`PL-dusk-${tag}-${v}`);
        }
        await setVisuals(page, 'classic');
        const hC = L.horizonSeam(await L.loadRegion(got.classic, HORIZON));
        const hE = L.horizonSeam(await L.loadRegion(got.enhanced, HORIZON));
        info(`look dusk ${tag} (hdg ${P.hdgDeg.toFixed(1)})`, `seam Classic ${hC.deltaE.toFixed(2)} @${hC.row} · Enhanced ${hE.deltaE.toFixed(2)} @${hE.row}`);
      }
    }
  } catch (err) {
    fail++;
    console.log(`FAIL  harness error — ${err?.stack ?? err}`);
  } finally {
    fs.writeFileSync(path.join(OUT, 'verify-r25-sky-browser.json'), JSON.stringify({ rows, results }, null, 2));
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed, ${notcal} not calibrated`);
  process.exit(fail ? 1 : notcal ? 2 : 0);
})();
