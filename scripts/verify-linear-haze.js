/**
 * R24 (E CERT) — verify-linear-haze: the horizon must not have a seam.
 *
 * THE DEFECT (recon L1). Fog and the SkyDome are linear-correct — three
 * converts `fogColor` and a material `color` from sRGB on upload. The haze,
 * edge-fade and aerial-perspective colours are NOT: they are authored as sRGB
 * hex numbers and pushed straight into uniforms that are mixed in linear space
 * by the composer. Since R19 moved the aerial term into the EffectPass, the
 * terrain's fade-out colour and the dome's horizon band are therefore two
 * DIFFERENT colours by construction, and no amount of tuning can make them
 * meet: tune them to match at noon and they part at dusk.
 *
 * THE MEASUREMENT. Park at a pose with a clean, distant horizon. Find the
 * horizon row by the largest vertical luma step in a centre column band, then
 * read two crops: one a few rows BELOW it (terrain at the fade end) and one a
 * few rows ABOVE (the dome band), with a gap so neither crop straddles the
 * seam. The gate is |ΔL| between them.
 *
 * WHY BOTH NOON AND DEEP NIGHT. A single-time-of-day gate is exactly how this
 * defect survived: it can be tuned away at one sun elevation. The colours are
 * different FUNCTIONS, so the two must be measured at the two ends.
 *
 * BOUNDS. `HAZE_MAX_DELTA` (default 12/255) is a STARTING bound, and this gate
 * says so: the number that matters is the flag-off RED measured on this tree,
 * which the first run establishes and the ledger records. Do not lower the
 * bound to make a run pass; raise the evidence.
 *
 * STAMP OFF. This gate runs with `FLY_FIXTURE_STAMP=off` forced, because the
 * imagery tile-identity stamp is a high-contrast white plate that would sit in
 * the terrain crop. A pixel gate must not contain an actor it does not control
 * (R17 §7.1).
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-linear-haze.js
 */
process.env.FLY_FIXTURE_STAMP = 'off';

const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

// A high, flat, empty pose: nothing but ground, haze and sky in the frame.
const POSE = [36.6, -118.1, 4200, 1.2, -0.06];
const SETTLE = Number(process.env.HAZE_SETTLE_MS || 90000);
const MAX_DELTA = Number(process.env.HAZE_MAX_DELTA || 12);

const UNPIN_SUN = () => {
  try {
    Object.defineProperty(window, '__flySunOverride', {
      configurable: true,
      get: () => window.__r24Sun,
      set: (v) => {
        window.__r24SunAttempt = v;
      },
    });
  } catch {
    /* blocked */
  }
};

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__hazePin) clearInterval(window.__hazePin);
  window.__hazePin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
  // Park the hero and the traffic: a pixel gate must not contain an actor it
  // does not control (R17 §7.1 — verify-sat-night's noon gates had been
  // passing on the aeroplane's idle bob).
  if (window.__flyPlayer) window.__flyPlayer.visible = false;
};

/**
 * Read the seam IN THE PAGE, off the default framebuffer, rather than through
 * a screenshot: a `page.screenshot` composites the DOM HUD over the canvas and
 * would put label pixels in the crop.
 */
const SEAM = () => {
  // The renderer's OWN context — never canvas.getContext(), which would create
  // one with the wrong attributes if it ever won the race with three (see the
  // note in verify-flash-guard.js: it hangs the boot).
  const r = window.__flyGl;
  const gl = r && typeof r.getContext === 'function' ? r.getContext() : null;
  if (!gl) return { error: 'window.__flyGl absent — cannot read the default framebuffer' };
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const colW = Math.max(32, W >> 3);
  const x0 = ((W - colW) / 2) | 0;
  const buf = new Uint8Array(colW * 4);
  const lum = new Float64Array(H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for (let y = 0; y < H; y++) {
    gl.readPixels(x0, y, colW, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let s = 0;
    for (let i = 0; i < colW; i++)
      s += 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
    lum[y] = s / colW;
  }
  // readPixels rows are bottom-up. Find the largest step over a 3-row window.
  let bestY = -1;
  let bestD = -1;
  for (let y = 6; y < H - 6; y++) {
    const d = Math.abs(lum[y + 3] - lum[y - 3]);
    if (d > bestD) {
      bestD = d;
      bestY = y;
    }
  }
  const GAP = 4;
  const BAND = 6;
  const avg = (a, b) => {
    let s = 0;
    let n = 0;
    for (let y = a; y <= b; y++) {
      if (y < 0 || y >= H) continue;
      s += lum[y];
      n++;
    }
    return n ? s / n : NaN;
  };
  // bottom-up: BELOW the horizon on screen = LOWER y in this buffer.
  const terrain = avg(bestY - GAP - BAND, bestY - GAP);
  const sky = avg(bestY + GAP, bestY + GAP + BAND);
  return {
    W,
    H,
    horizonY: bestY,
    step: bestD,
    terrainLuma: terrain,
    skyLuma: sky,
    delta: Math.abs(terrain - sky),
    profile: Array.from({ length: 21 }, (_, i) => +lum[Math.max(0, bestY - 10 + i)].toFixed(1)),
  };
};

let pass = 0;
let fail = 0;
const red = [];
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(UNPIN_SUN);

  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page.evaluate(PIN_POSE, POSE);
  await page.waitForTimeout(SETTLE);

  const results = {};
  for (const [label, elDeg] of [
    ['noon', 55],
    ['night', -14],
  ]) {
    await page.evaluate((el) => {
      window.__r24Sun = { elDeg: el };
    }, elDeg);
    await page.waitForTimeout(20000);
    const s = await page.evaluate(SEAM);
    if (s.error) {
      gate(`(1${label === 'noon' ? 'a' : 'b'}) READ THE DEFAULT FRAMEBUFFER (${label})`, false, s.error);
      continue;
    }
    results[label] = s;
    console.log(
      `\n${label} (sun ${elDeg}°): ${s.W}x${s.H} · horizon row ${s.horizonY} (step ${s.step.toFixed(1)}) · ` +
        `terrain L ${s.terrainLuma.toFixed(1)} · sky L ${s.skyLuma.toFixed(1)} · Δ ${s.delta.toFixed(1)}`
    );
    console.log(`  luma profile around the seam: ${JSON.stringify(s.profile)}`);
    gate(
      `(1${label === 'noon' ? 'a' : 'b'}) A HORIZON WAS FOUND AT ALL (${label})`,
      s.horizonY > 10 && s.horizonY < s.H - 10 && s.step > 2,
      `row ${s.horizonY} of ${s.H}, step ${s.step.toFixed(1)} — a step of ~0 means the frame has no ` +
        'horizon in it and the delta below is meaningless'
    );
    gate(
      `(2${label === 'noon' ? 'a' : 'b'}) RIM SEAM: |terrain − dome| ≤ ${MAX_DELTA}/255 (${label})`,
      s.delta <= MAX_DELTA,
      `Δ ${s.delta.toFixed(1)}`
    );
    red.push([
      `L1 sRGB haze mixed as linear (${label})`,
      `verify-linear-haze (2${label === 'noon' ? 'a' : 'b'})`,
      `Δ ${s.delta.toFixed(1)}`,
      `≤ ${MAX_DELTA}`,
    ]);
  }

  const spread = Math.abs(results.noon.delta - results.night.delta);
  gate(
    '(3) THE SEAM DOES NOT DEPEND ON THE TIME OF DAY',
    spread <= MAX_DELTA,
    `noon Δ ${results.noon.delta.toFixed(1)} vs night Δ ${results.night.delta.toFixed(1)} — spread ` +
      `${spread.toFixed(1)}. A large spread is the signature of the defect: two different colour ` +
      'FUNCTIONS can be tuned to agree at one sun elevation and nowhere else'
  );
  gate('(4) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  console.log(
    `\nBOUND NOTE: ${MAX_DELTA}/255 is a STARTING bound (HAZE_MAX_DELTA). What matters is the ` +
      'flag-off RED this run measured; record it in the ledger and set the bound from the ' +
      'flag-on measurement, never the other way round.'
  );
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
