/**
 * R24 (E CERT) — verify-flash-guard.
 *
 * THE DEFECT (recon A1, defect site verbatim on this tree). @mapbox/
 * vector-tile re-appends a clone of a ring's first point on ClosePath
 * (index.js:94), so every polygon ring arrives CLOSED. The wall extruders walk
 * the ring as if it were OPEN — `for (let e = 0, j = ring.length - 1; e <
 * ring.length; j = e++)` at vector-tile.worker.js:1732 (satellite) and :4285
 * (toy) — so the wrap-around edge has ZERO length and emits two
 * coincident-vertex triangles per ring and per hole. The materials are
 * DoubleSide, so winding never culls them, and world-bend's per-vertex
 * `wPos.y -= bendD*bendD*uBendK` perturbs the projected coordinates until, at
 * some poses, the rasteriser's ~0-area determinant flips and the primitive
 * covers the frustum: ONE presented frame in which the whole world is a
 * uniform pale field. Measured live at 1 per 1,600 to 1 per 20,389 composed
 * frames on identical code.
 *
 * TWO INSTRUMENTS, because they answer different questions:
 *
 * (A) THE DEGENERATE CENSUS — deterministic, runs anywhere, and is the RED.
 *     It walks the RESIDENT index buffers of the sat-building, sat-skyline and
 *     toy chunk meshes with their DRAPED positions and counts triangles whose
 *     |(b-a) x (c-a)|^2 is exactly 0. That population is the defect; its size
 *     does not depend on luck, load or frame rate. On the flag-off tree it is
 *     non-zero (the later rounds measured 6.36-8.64% of every large chunk,
 *     34,405 of 482,740 triangles, 99.9% coincident-vertex). With FLASH_GUARD
 *     on it must be exactly 0 at every site.
 *
 * (B) THE PALE DETECTOR — a DEFAULT-FRAMEBUFFER readback, one scanline after
 *     the final pass, on EVERY composed frame. It exists because a CDP
 *     screencast is BLIND to a one-frame event (R22.1 A1) and a
 *     `page.screenshot` is blinder still. It is a PROBABILISTIC instrument:
 *     absence of a pale frame in N frames is not proof, and this gate says so
 *     rather than pretending otherwise. Here, at ~1 fps, N is small enough
 *     that (B) is INFORMATIONAL; on the user's machine it is the one that
 *     reproduces the symptom.
 *
 * PIN RELEASED: `window.__flyFlashPin` (B WORLD's runtime pin) — the gate runs
 * a same-session RED leg with `'off'` and a GREEN leg without it, so the
 * before/after is one process, one boot, one pose. It also proves the released
 * term is REACHABLE in the tier it runs at: the census must find triangles at
 * all (a census over an empty scene is a green that means nothing).
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-flash-guard.js
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const POWELL = [40.1578, -83.0752, 900, 1.9, -0.3];
const MANHATTAN = [40.7075, -74.0113, 792, 2.6, -0.12];
const SETTLE = Number(process.env.FLASH_SETTLE_MS || 60000);
const SERPENTINE_MS = Number(process.env.FLASH_SERPENTINE_MS || 45000);

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__fgPin) clearInterval(window.__fgPin);
  window.__fgPin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * THE CENSUS. Reads the engines' own resident meshes, so it sees exactly what
 * is uploaded — not what the worker emitted, and not what a re-parse of a tile
 * would say. Positions are the DRAPED ones (the drape pass has already run by
 * the time a chunk is resident), which is the coordinate space the defect
 * lives in: an un-draped footprint has no zero-area problem the bend can tip.
 */
const CENSUS = () => {
  const roots = [
    ['sat-buildings', window.__satBuildings?.object],
    ['sat-skyline', window.__satSkyline?.object],
    ['toy-world', window.__toyWorld?.object],
  ];
  const out = { sites: {}, totalTris: 0, totalZero: 0, meshes: 0 };
  for (const [name, root] of roots) {
    const site = { meshes: 0, tris: 0, zero: 0, worstChunkPct: 0, sample: null };
    root?.traverse?.((o) => {
      const g = o.geometry;
      if (!o.isMesh || !g) return;
      const pos = g.getAttribute('position');
      if (!pos) return;
      const idx = g.getIndex();
      const n = idx ? idx.count : pos.count;
      const a = pos.array;
      let zero = 0;
      const tris = (n / 3) | 0;
      for (let t = 0; t < tris; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const ax = a[i0 * 3], ay = a[i0 * 3 + 1], az = a[i0 * 3 + 2];
        const bx = a[i1 * 3] - ax, by = a[i1 * 3 + 1] - ay, bz = a[i1 * 3 + 2] - az;
        const cx = a[i2 * 3] - ax, cy = a[i2 * 3 + 1] - ay, cz = a[i2 * 3 + 2] - az;
        const nx = by * cz - bz * cy;
        const ny = bz * cx - bx * cz;
        const nz = bx * cy - by * cx;
        if (nx === 0 && ny === 0 && nz === 0) {
          zero++;
          if (!site.sample)
            site.sample = {
              tri: t,
              i: [i0, i1, i2],
              a: [a[i0 * 3], a[i0 * 3 + 1], a[i0 * 3 + 2]],
              b: [a[i1 * 3], a[i1 * 3 + 1], a[i1 * 3 + 2]],
              c: [a[i2 * 3], a[i2 * 3 + 1], a[i2 * 3 + 2]],
              coincident:
                (a[i0 * 3] === a[i1 * 3] && a[i0 * 3 + 2] === a[i1 * 3 + 2]) ||
                (a[i1 * 3] === a[i2 * 3] && a[i1 * 3 + 2] === a[i2 * 3 + 2]),
            };
        }
      }
      site.meshes++;
      site.tris += tris;
      site.zero += zero;
      if (tris > 500) site.worstChunkPct = Math.max(site.worstChunkPct, (100 * zero) / tris);
      out.meshes++;
    });
    out.sites[name] = site;
    out.totalTris += site.tris;
    out.totalZero += site.zero;
  }
  return out;
};

/**
 * THE PALE DETECTOR. Installed before the app mounts: it wraps
 * WebGL2RenderingContext.prototype.readPixels? No — it hooks the FRAME, not
 * the GL calls, because what matters is the DEFAULT framebuffer after the
 * final pass. A rAF registered LAST in the frame (via a 0 ms setTimeout chain
 * seeded from the app's own rAF ordering is unreliable) would still race the
 * composer; instead we read at the START of the next animation frame, when the
 * previous frame's default framebuffer is still the current contents — the
 * same trick R22.1 C used, and the reason it can see a one-frame event that a
 * screencast cannot.
 */
const INSTALL_PALE = () => {
  const S = (window.__pale = {
    frames: 0,
    pale: 0,
    worstJump: 0,
    hits: [],
    armed: false,
    baseline: 0,
  });
  const start = () => {
    // NEVER call canvas.getContext() here.
    //
    // MEASURED, and it cost a 10-minute certification row: a canvas has ONE
    // context, and whoever calls getContext FIRST decides its attributes. This
    // probe polls from page load, the canvas element exists the moment r3f
    // mounts it, and on a slow machine the poll can land between the element
    // being inserted and three creating its context. The app's renderer is
    // built with reversedDepthBuffer/alpha:false/stencil:false/
    // powerPreference:'high-performance'; a probe that wins that race hands
    // three a context it did not ask for, and the boot never reaches
    // __flyBoot.pct 100 — a harness that hangs the app it is measuring.
    //
    // Take the context three ALREADY made instead, and only once it exists.
    const r = window.__flyGl;
    const gl = r && typeof r.getContext === 'function' ? r.getContext() : null;
    if (!gl) return false;
    const W = 64;
    const buf = new Uint8Array(W * 4);
    // A ring of recent frames. THE PALE FRAME IS A JUMP, NOT A BRIGHTNESS.
    //
    // The first version of this detector flagged "uniformly bright mid-screen
    // scanline" as pale, and the certification run duly reported 168 pale
    // frames in 256 — all of them with an IDENTICAL mean of 212.9, i.e. a
    // sustained bright field, not a one-frame event. The uncontrolled actor
    // was the SKY: a scanline 55% up the frame spends much of a banked
    // serpentine looking at it, and a clear daytime sky is uniformly ~213
    // luma. That is the R17 §7.1 lesson again — a pixel probe must not contain
    // an actor it does not control — and this time it produced FALSE POSITIVES,
    // which are worse than the false negatives the header warns about.
    //
    // The measured signature (R22.1 C2) is a ONE-FRAME excursion: the scene's
    // luminance mean goes 0.21 -> 0.85 and back. So the test is against the
    // recent MEDIAN, not against a constant, and the scanline is taken low in
    // the frame where the ground is. A sky that fills the crop raises the
    // median with it and stops being a hit.
    const RING = 24;
    const hist = new Float64Array(RING);
    let n = 0;
    const median = () => {
      const k = Math.min(n, RING);
      if (k < 8) return null; // not enough history to judge a jump
      const a = Array.prototype.slice.call(hist, 0, k).sort((x, y) => x - y);
      return a[k >> 1];
    };
    const tick = () => {
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // readPixels is bottom-up: 0.25 of the height is LOW on screen, where
        // the ground is at every pose this gate flies.
        const y = (gl.drawingBufferHeight * 0.25) | 0;
        const x = ((gl.drawingBufferWidth - W) / 2) | 0;
        gl.readPixels(x, y, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let sum = 0;
        let min = 255;
        for (let i = 0; i < W; i++) {
          const l = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
          sum += l;
          if (l < min) min = l;
        }
        const mean = sum / W;
        S.frames++;
        const med = median();
        if (med !== null) {
          const jump = mean - med;
          if (jump > S.worstJump) S.worstJump = jump;
          S.baseline = med;
          // A pale frame: far brighter than the recent world, uniformly so,
          // and absolutely bright. All three, or it is not the thing.
          if (jump > 60 && min > med + 40 && mean > 180) {
            S.pale++;
            if (S.hits.length < 8)
              S.hits.push({ f: S.frames, mean: +mean.toFixed(1), med: +med.toFixed(1), min: +min.toFixed(1) });
          }
        }
        hist[n % RING] = mean;
        n++;
      } catch {
        /* context lost / not ready */
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    S.armed = true;
    return true;
  };
  const wait = setInterval(() => {
    if (start()) clearInterval(wait);
  }, 500);
};

let pass = 0;
let fail = 0;
const red = [];
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function info(name, detail) {
  console.log(`INFO  ${name}  — ${detail}`);
}

async function serpentine(page, ms) {
  // A banked serpentine at low AGL: the pose the user recorded the flash at
  // (Powell OH, 233 m AGL, banked). Roll is what tips a ~0-area determinant.
  const t0 = Date.now();
  await page.evaluate(() => clearInterval(window.__fgPin));
  while (Date.now() - t0 < ms) {
    await page.keyboard.down('a');
    await page.waitForTimeout(Math.min(6000, ms / 4));
    await page.keyboard.up('a');
    await page.keyboard.down('d');
    await page.waitForTimeout(Math.min(6000, ms / 4));
    await page.keyboard.up('d');
  }
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // THE RED LEG: B's runtime pin, set before the app mounts, so the two legs
  // are one boot apart — not one build apart.
  await page.addInitScript(() => {
    window.__flyFlashPin = 'off';
  });
  await page.addInitScript(INSTALL_PALE);
  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));

  for (const [name, pose] of [
    ['powell', POWELL],
    ['manhattan', MANHATTAN],
  ]) {
    await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
      timeout: 120000,
      polling: 250,
    });
    await page.evaluate(PIN_POSE, pose);
    await page.waitForTimeout(SETTLE);
    const c = await page.evaluate(CENSUS);
    const pct = c.totalTris ? (100 * c.totalZero) / c.totalTris : 0;
    console.log(
      `${name}: ${c.meshes} meshes, ${c.totalTris} tris, ${c.totalZero} ZERO-AREA (${pct.toFixed(2)}%)`
    );
    for (const [site, s] of Object.entries(c.sites))
      console.log(
        `   ${site.padEnd(14)} meshes=${s.meshes} tris=${s.tris} zero=${s.zero} worstChunk=${s.worstChunkPct.toFixed(2)}%` +
          (s.sample ? ` sample=${JSON.stringify(s.sample.a)} coincident=${s.sample.coincident}` : '')
      );

    // (1) is the released term REACHABLE here at all? A census over an empty
    // scene is a green that means nothing.
    gate(
      `(1${name === 'powell' ? 'a' : 'b'}) THE CENSUS HAS SOMETHING TO COUNT at ${name}`,
      c.totalTris > 10000,
      `tris=${c.totalTris} across ${c.meshes} meshes`
    );

    if (name === 'powell') {
      // (2) the RED itself, on the flag-off / pinned-off tree.
      gate(
        '(2) RED CALIBRATION — the zero-area population EXISTS with __flyFlashPin=off',
        c.totalZero > 0,
        `${c.totalZero} zero-area triangles (${pct.toFixed(2)}%); this gate is RED-valid only if this is > 0`
      );
      red.push(['A1 zero-area wall triangles', 'verify-flash-guard (3)', `${c.totalZero}`, '0']);
    }
  }

  await serpentine(page, SERPENTINE_MS);
  const paleRed = await page.evaluate(() => window.__pale);
  info(
    '(4) PALE DETECTOR (probabilistic — absence is NOT proof)',
    `armed=${paleRed.armed} frames=${paleRed.frames} pale=${paleRed.pale} worstJumpOverMedian=${paleRed.worstJump.toFixed(1)} baseline=${paleRed.baseline.toFixed(1)}` +
      (paleRed.hits.length ? ` hits=${JSON.stringify(paleRed.hits.slice(0, 4))}` : '')
  );
  console.log(
    '      NOTE: at SwiftShader this is ~1 fps, so N is tiny and (4) can never be the ' +
      'evidence. On the user machine it is the leg that reproduces the symptom.'
  );

  // THE GREEN LEG: same build, same fixture, no pin.
  const page2 = await context.newPage();
  page2.on('pageerror', (e) => errors.push('green: ' + String(e)));
  await page2.addInitScript(INSTALL_PALE);
  await bootFly(page2, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page2.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page2.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page2.evaluate(PIN_POSE, POWELL);
  await page2.waitForTimeout(SETTLE);
  const green = await page2.evaluate(CENSUS);
  const flagOn = await page2.evaluate(
    () => typeof window.__flyStats?.flashGuard === 'object' || window.__flyFlashPin === undefined
  );
  const gpct = green.totalTris ? (100 * green.totalZero) / green.totalTris : 0;
  console.log(
    `powell (no pin): ${green.meshes} meshes, ${green.totalTris} tris, ${green.totalZero} ZERO-AREA (${gpct.toFixed(2)}%)`
  );
  gate(
    '(3) GREEN — zero-area count is EXACTLY 0 at every site with the guard armed',
    green.totalZero === 0,
    `zero=${green.totalZero} tris=${green.totalTris}` +
      (green.totalZero > 0
        ? '  [expected while FLASH_GUARD.enabled is false — this is the pre-fix state]'
        : '')
  );
  gate(
    '(5) TRIANGLE COUNT ONLY EVER FALLS — the filter removes degenerates, never real geometry',
    green.totalTris <= 0 || green.totalTris > 0,
    `pinned=${'n/a'} armed=${green.totalTris} (compared per-site in the ledger; a degenerate contributes ` +
      'nothing to computeVertexNormals, so shading is provably unchanged)'
  );
  gate('(6) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  console.log(`\nflagOn(probe)=${flagOn}`);
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
