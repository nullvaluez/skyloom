/**
 * TRAFFIC-TRAIL VISIBILITY GATE — the instrument that was missing.
 *
 * Every tracer assertion before this file was a COUNT (__flyStats.tracers,
 * tracerBackfills). Counts stayed green while two changes made trails
 * invisible in the shipped default (satellite + Enhanced): a 0.18 × 0.25
 * brightness/width squeeze (be711f2) and the cloud composite's daytime sky
 * replacement erasing every depth-less mark against the sky (f0cd81e). This
 * gate measures PIXELS instead.
 *
 * Method (per leg: noon / dusk / night):
 *  - satellite boot with the Visuals, aerial and depth pins LIFTED, so the
 *    post chain is the one players get;
 *  - the player pose is pinned (speed 0), the player, traffic hulls and
 *    billboards are parked, clouds and the trail pulse frozen, the overlay
 *    cloud gate pinned off (visibility is measured independent of where the
 *    baseline clouds happen to fall), and the traffic engine frozen after the
 *    fleet is injected — the only thing toggled is the trail root
 *    `window.__flyTracers`;
 *  - synthetic cruising traffic at 4–80 km, above the eye (sky-backed) and
 *    below it, flying broadside, plus one head-on target at 26 km;
 *  - each head, a point 1.2 km down its trail and 16 points along 60 % of the
 *    trail are projected to screen through the SAME air-bend drop the GPU
 *    applies (__flyAirDrop); the signal is the max per-CHANNEL |ΔRGB| (white
 *    vapour on blue sky shows mainly in R) between trails SHOWN and HIDDEN,
 *    the noise the same between two SHOWN frames.
 *
 * VISIBLE = sig ≥ max(12, 2 × noise).
 *
 * The contract (the user's live review: far marks must not read as a
 * starfield): traffic within REACH (≤ 26 km — lockable/pickable) is clearly
 * marked (head + body visible, continuous line, head-on glint), while far
 * traffic (≥ 40 km) stays PRESENT but SUBTLE: a faint continuous hairline,
 * never a bright head.
 *
 * Run (container / no hardware GPU; uses the offline fixture):
 *   FLY_TILE_FIXTURE=1 node scripts/verify-traffic-trails.cjs
 * Env: FLY_URL (default :3000), TRAILS_LEGS (default "noon,dusk,night"),
 *      TRAILS_ALT_M (default 3000), TRAILS_LEGACY=1 (the RED calibration arm:
 *      boots with the legacy satellite ribbon — the head gates must FAIL).
 * Screenshots: scripts/r24-out/fixture-trails-gate-<leg>-{on,off}.png under
 * the fixture (the fixture redirects artifact writes out of scripts/).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');
const { makeCanvasShot } = require('./_canvasshot');

const ALT = Number(process.env.TRAILS_ALT_M || 3000);
const LEGS = (process.env.TRAILS_LEGS || 'noon,dusk,night').split(',');
const LEGACY = process.env.TRAILS_LEGACY === '1';
const MIN_SIG = 12; // 0..255, max channel
const RANGES_KM = [4, 9, 16, 26, 40, 60, 80];

// The harness's copy of TRACERS.spot.length (only used to place samples).
const trailLenM = (dM, speed) =>
  Math.min(22000, Math.max(4000, 4000 * Math.pow(dM / 8000, 0.7))) * Math.min(1, Math.max(0.45, speed / 220));

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // three reports shader compile/link failures on console.error, not as page errors.
  const shaderErrs = [];
  page.on('console', (m) => {
    const bad = (m.type() === 'error' && /shader|WebGLProgram/i.test(m.text())) || /needle missing/.test(m.text());
    if (bad) shaderErrs.push(m.text().slice(0, 300));
  });
  const fails = [];
  let gates = 0;
  const gate = (name, ok, detail = '') => {
    gates += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  await page.addInitScript(unpinPins, ['__flyVisualsOverride', '__flyAerialOverride', '__flyDepthPin']);
  await page.addInitScript((legacy) => {
    window.__flyTracerFreeze = true; // the glint pulse clock (ONE reader: SpotTracers)
    window.__flyOverlayGatePin = false; // the overlay cloud gate (ONE reader: sky-overlay-pass)
    if (legacy) window.__flySpotTracers = false; // RED arm (ONE reader: spotTracersOn)
  }, LEGACY);
  await bootFly(page, { style: 'satellite', timeoutMs: 900000 });
  const cap = makeCanvasShot(page);
  console.log(LEGACY ? 'ARM: LEGACY satellite ribbon (RED calibration)' : 'ARM: spotter trails');

  // Pin the pose (heading north, nose slightly up so sky AND ground are in
  // frame), park every other mover.
  await page.evaluate((alt) => {
    const fly = window.__fly;
    const f = fly.flight;
    f.pos.y = alt;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    if (window.__trailPin) clearInterval(window.__trailPin);
    window.__trailPin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = 0;
      f.pitch = 0.04;
      f.bank = 0;
      f.speed = 0;
    }, 8);
    window.__flyCloudFreeze = true;
    for (const o of [window.__flyPlayer, window.__flyTraffic]) if (o) o.visible = false;
  }, ALT);

  const targets = await page.evaluate((ranges) => {
    const fly = window.__fly;
    const f = fly.flight;
    const liveT = Math.max(0, ...[...fly.traffic.tracks.values()].map((t) => t.fix1?.t ?? 0));
    const out = [];
    const add = (hex, x, alt, z, vE, vN, extra) => {
      const d = Math.hypot(x - f.pos.x, z - f.pos.z);
      const track = {
        hex, meta: { flight: hex.toUpperCase(), t: 'A320', iconType: 'airliner' }, archetype: 0, flags: 0,
        fix0: null,
        fix1: { x, y: alt, z, vE, vN, vUp: 0, latRad: (f.latDeg * Math.PI) / 180, t: liveT },
        groundElev: 0, yaw: 0, bank: 0, rx: x, ry: alt, rz: z, distM: d, opacity: 1, scaleK: 1,
        stale: 0, blendFix1: null, blendFix0: null, blendStart: 0, altBlendFrom: 0, altBlendStart: null,
        snapDipUntil: null, lastPollServer: liveT,
      };
      fly.traffic.tracks.set(hex, track);
      fly.traffic.items.push(track);
      out.push({ hex, ...extra });
    };
    ranges.forEach((km, i) => {
      for (const side of [-1, 1]) {
        const above = side < 0; // left = above the eye (always sky-backed), right = below
        const d = km * 1000;
        // ~7° above the eye / ~10° below it, ±17° off the nose.
        const alt = above ? f.pos.y + Math.max(500, 0.12 * d) : Math.max(700, f.pos.y - Math.max(900, 0.18 * d));
        add(`ee${i}${above ? 'a' : 'b'}00`, f.pos.x + side * d * 0.3, alt, f.pos.z - d, side * 230, 0, { km, sky: above, headOn: false, speed: 230 });
      }
    });
    // Head-on: straight ahead, flying at the camera (its trail is edge-on).
    add('ee9h00', f.pos.x, f.pos.y + 0.12 * 26000, f.pos.z - 26000, 0, -230, { km: 26, sky: true, headOn: true, speed: 230 });
    return out;
  }, RANGES_KM);

  // Let the engine project the fleet and the trails backfill, then FREEZE the
  // engine (update() keeps returning the last items), so nothing moves
  // between the shots of an A/B (at this venue's ~1 fps a moving target
  // travels ~100 px between two captures — noise == signal).
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const tr = window.__fly.traffic;
    tr.__update ??= tr.update;
    tr.update = function frozen() {
      return this.items;
    };
  });

  // Screen positions: head, a body point 1.2 km back, and 16 samples along
  // 60 % of the trail — all through the GPU's own air drop.
  const project = () =>
    page.evaluate(
      ([ts, lenTable]) => {
        const fly = window.__fly;
        const cam = fly.camera;
        const f = fly.flight;
        const ax = fly.origin?.anchor?.x ?? 0;
        const az = fly.origin?.anchor?.z ?? 0;
        cam.updateMatrixWorld();
        const V = cam.matrixWorldInverse.elements;
        const P = cam.projectionMatrix.elements;
        const mul = (m, v) => [
          m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
          m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
        ];
        const toScreen = (x, y, z) => {
          const d = Math.hypot(x - f.pos.x, z - f.pos.z);
          const drop = window.__flyAirDrop ? window.__flyAirDrop(d, y) : 0;
          const c = mul(P, mul(V, [x - ax, y - drop, z - az, 1]));
          if (c[3] <= 0) return null;
          return { x: ((c[0] / c[3]) * 0.5 + 0.5) * innerWidth, y: (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * innerHeight };
        };
        return ts.map((t) => {
          const tr = fly.traffic.tracks.get(t.hex);
          if (!tr) return { ...t, head: null, body: null, along: [] };
          const k = 1 / Math.cos(tr.fix1.latRad || 0);
          const h = Math.hypot(tr.fix1.vE, tr.fix1.vN) || 1;
          const bx = (-tr.fix1.vE / h) * k;
          const bz = (tr.fix1.vN / h) * k; // world +z = south
          const y = tr.ryd ?? tr.ry;
          const L = lenTable[t.hex];
          const along = [];
          for (let i = 1; i <= 16; i++) {
            const s = (0.6 * L * i) / 16;
            along.push(toScreen(tr.rx + bx * s, y, tr.rz + bz * s));
          }
          return {
            ...t,
            head: toScreen(tr.rx, y, tr.rz),
            body: t.headOn ? null : toScreen(tr.rx + bx * 1200, y, tr.rz + bz * 1200),
            along: t.headOn ? [] : along,
          };
        });
      },
      [targets, Object.fromEntries(targets.map((t) => [t.hex, trailLenM(t.km * 1000, t.speed)]))]
    );

  const setTrails = (v) =>
    page.evaluate((on) => {
      if (window.__flyTracers) window.__flyTracers.visible = on;
    }, v);
  // Two presented frames after a toggle before a capture.
  const frames = (n = 2) =>
    page.evaluate(
      (k) =>
        new Promise((res) => {
          let i = 0;
          const tick = () => (++i >= k ? res() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      n
    );

  // Per point: max-channel |Δ| (ON−OFF = sig, ON−ON2 = noise) in a window,
  // the ON peak luma, the signed ΔRGB at the peak, and ON/OFF saturation.
  const measure = (a, b, c, pts) =>
    page.evaluate(
      async ([sa, sb, sc, ps]) => {
        const load = (s) =>
          new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = 'data:image/png;base64,' + s;
          });
        const imgs = await Promise.all([sa, sb, sc].map(load));
        const data = imgs.map((img) => {
          const cv = document.createElement('canvas');
          cv.width = img.width;
          cv.height = img.height;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          return { w: img.width, h: img.height, d: ctx.getImageData(0, 0, img.width, img.height).data };
        });
        const W = data[0].w;
        const H = data[0].h;
        const sx = W / innerWidth;
        const sy = H / innerHeight;
        const sat = (r, g, b) => {
          const mx = Math.max(r, g, b);
          return mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
        };
        const probe = (pt, rad) => {
          if (!pt) return null;
          const cx = Math.round(pt.x * sx);
          const cy = Math.round(pt.y * sy);
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
          const A = data[0].d;
          const B = data[1].d;
          const C = data[2].d;
          let sig = 0;
          let noise = 0;
          let peak = 0;
          let best = null;
          for (let y = cy - rad; y <= cy + rad; y++)
            for (let x = cx - rad; x <= cx + rad; x++) {
              if (x < 0 || y < 0 || x >= W || y >= H) continue;
              const o = (y * W + x) * 4;
              const s = Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
              const nz = Math.max(Math.abs(A[o] - C[o]), Math.abs(A[o + 1] - C[o + 1]), Math.abs(A[o + 2] - C[o + 2]));
              peak = Math.max(peak, 0.2126 * A[o] + 0.7152 * A[o + 1] + 0.0722 * A[o + 2]);
              if (s > sig) {
                sig = s;
                best = {
                  d: [A[o] - B[o], A[o + 1] - B[o + 1], A[o + 2] - B[o + 2]],
                  satOn: sat(A[o], A[o + 1], A[o + 2]),
                  satOff: sat(B[o], B[o + 1], B[o + 2]),
                };
              }
              noise = Math.max(noise, nz);
            }
          return { sig, noise, peak: Math.round(peak), ...best };
        };
        return ps.map((p) => ({
          hex: p.hex,
          head: probe(p.head, 5),
          body: probe(p.body, 4),
          along: p.along.map((q) => probe(q, 1)),
        }));
      },
      [a, b, c, pts]
    );

  const sunFor = (leg) =>
    page.evaluate((l) => {
      const g = window.__fly?.geo ?? { x: -74, y: 40.7 };
      const day0 = Date.UTC(2026, 5, 21);
      const noonUtcH = 12 - g.x / 15; // local solar noon, UTC hours
      if (l === 'night' || l === 'noon') {
        // solar midnight / solar noon: the deepest night, the highest sun
        const h = l === 'night' ? noonUtcH + 12 : noonUtcH;
        window.__flySunOverride = day0 + (((h % 24) + 24) % 24) * 3600000;
        return;
      }
      // dusk: the EVENING side, frac nearest 0.1
      let best = day0;
      let err = Infinity;
      for (let m = 0; m < 12 * 60; m += 5) {
        const t = day0 + (noonUtcH * 60 + m) * 60000;
        const f = window.__flySunModel ? window.__flySunModel(g.x, g.y, t) : 1;
        if (Math.abs(f - 0.1) < err) {
          err = Math.abs(f - 0.1);
          best = t;
        }
      }
      window.__flySunOverride = best;
    }, leg);

  const outDir = fs.existsSync(path.join(__dirname, 'r24-out')) ? path.join(__dirname, 'r24-out') : __dirname;
  const vis = (p) => !!p && p.sig >= Math.max(MIN_SIG, 2 * p.noise);
  for (const leg of LEGS) {
    await sunFor(leg);
    await page
      .waitForFunction(
        (l) => {
          const f = window.__fly?.sun?.frac;
          return l === 'night' ? f < 0.02 : l === 'dusk' ? f > 0.03 && f < 0.25 : f > 0.9;
        },
        leg,
        { timeout: 240000, polling: 1000 }
      )
      .catch(() => console.log(`  (${leg}) sun pin did not publish in 240 s`));
    // Damped look weights (0.6/s), bloom and sky settle.
    await page.waitForTimeout(Number(process.env.TRAILS_SETTLE_MS || 20000));
    // Freeze the rendered camera pose and hide every DOM/HUD layer (the label
    // canvas draws right next to the probed heads and animates) — the A/B
    // must differ ONLY by the trail root.
    await page.evaluate(() => {
      const cam = window.__fly.camera;
      cam.__freezeP = cam.position.clone();
      cam.__freezeQ = cam.quaternion.clone();
      if (!cam.__freezeOrig) {
        cam.__freezeOrig = cam.updateMatrixWorld.bind(cam);
        cam.updateMatrixWorld = (force) => {
          cam.position.copy(cam.__freezeP);
          cam.quaternion.copy(cam.__freezeQ);
          cam.__freezeOrig(force);
        };
      }
      const glc = document.querySelector('.fixed.inset-0 canvas');
      const keep = new Set();
      for (let e = glc; e; e = e.parentElement) keep.add(e);
      for (const el of document.body.querySelectorAll('*')) if (!keep.has(el)) el.style.visibility = 'hidden';
      glc.style.visibility = 'visible';
    });
    await frames(3);
    await setTrails(true);
    await frames();
    const pts = await project();
    const on1 = await cap.shot64();
    await setTrails(false);
    await frames();
    const off = await cap.shot64();
    await setTrails(true);
    await frames();
    const on2 = await cap.shot64();
    const tag = LEGACY ? `legacy-${leg}` : leg;
    fs.writeFileSync(path.join(outDir, `fixture-trails-gate-${tag}-on.png`), Buffer.from(on1, 'base64'));
    fs.writeFileSync(path.join(outDir, `fixture-trails-gate-${tag}-off.png`), Buffer.from(off, 'base64'));
    const res = await measure(on1, off, on2, pts);
    const stats = await page.evaluate(() => ({
      tracers: window.__flyStats?.tracers,
      spot: window.__flyStats?.tracerSpot,
      overlays: window.__flyStats?.skyOverlays,
      sunFrac: window.__fly?.sun?.frac,
      el: Math.round((Math.asin(Math.max(-1, Math.min(1, window.__fly?.sun?.sinEl ?? 1))) * 1800) / Math.PI) / 10,
    }));
    console.log(`\n[${leg}] ${JSON.stringify(stats)}`);
    const rows = targets.map((t) => {
      const r = res.find((x) => x.hex === t.hex);
      const along = (r?.along ?? []).filter(Boolean);
      const cont = along.filter((q) => q.sig >= 5).length;
      const row = { ...t, head: r?.head, body: r?.body, headVis: vis(r?.head), bodyVis: vis(r?.body), cont, contN: along.length };
      console.log(
        `  ${String(t.km).padStart(2)} km ${t.headOn ? 'head-on' : t.sky ? 'above  ' : 'below  '} head ${r?.head ? `${r.head.sig}/${r.head.noise} pk${r.head.peak}` : 'off'}` +
          `  body ${r?.body ? `${r.body.sig}/${r.body.noise}` : '-'}  cont ${cont}/${along.length}`
      );
      return row;
    });
    const sky = rows.filter((r) => r.sky && !r.headOn);
    const low = rows.filter((r) => !r.sky);
    const reach = (r) => r.km >= 9 && r.km <= 26;
    gate(`${leg}: tracers drawing`, (stats.tracers ?? 0) > 0, `${stats.tracers}`);
    gate(
      `${leg}: in-reach heads visible (9–26 km, above and below the eye)`,
      rows.filter((r) => !r.headOn && reach(r)).every((r) => r.headVis),
      rows.filter((r) => !r.headOn && reach(r)).map((r) => `${r.km}${r.sky ? 's' : 'b'}:${r.headVis ? 'Y' : 'n'}`).join(' ')
    );
    const ho = rows.find((r) => r.headOn);
    gate(`${leg}: head-on target visible (edge-on exemption)`, !!ho?.headVis, ho?.head ? `${ho.head.sig}/${ho.head.noise}` : 'off');
    gate(
      `${leg}: in-reach trail bodies visible (≤ 26 km)`,
      rows.filter((r) => !r.headOn && r.km <= 26 && r.km >= 9).every((r) => r.bodyVis),
      rows.filter((r) => !r.headOn && r.km <= 26 && r.km >= 9).map((r) => `${r.km}${r.sky ? 's' : 'b'}:${r.bodyVis ? 'Y' : 'n'}`).join(' ')
    );
    const need = leg === 'noon' ? 12 : 14;
    const near26 = sky.filter((r) => r.km === 26);
    gate(
      `${leg}: in-reach sky trail is a continuous line at 26 km (≥${need}/16)`,
      near26.every((r) => r.contN >= 12 && r.cont >= Math.min(need, r.contN)),
      near26.map((r) => `${r.km}:${r.cont}/${r.contN}`).join(' ')
    );
    const far = sky.filter((r) => r.km >= 40);
    gate(
      `${leg}: far traffic stays PRESENT (a faint line at 40–60 km)`,
      far.filter((r) => r.km <= 60).every((r) => r.contN >= 8 && r.cont >= Math.ceil(r.contN / 2)),
      far.map((r) => `${r.km}:${r.cont}/${r.contN}`).join(' ')
    );
    gate(
      `${leg}: far traffic stays SUBTLE (no bright head ≥ 40 km: Δ ≤ 40)`,
      far.every((r) => !r.head || r.head.sig <= 40),
      far.map((r) => `${r.km}:${r.head ? r.head.sig : '-'}`).join(' ')
    );
    if (leg === 'noon' && !LEGACY) {
      const bodies = sky.filter((r) => r.km <= 16 && r.body && r.body.sig > 0);
      gate(
        'noon: day vapour whitens the sky it crosses (R16: never a neon tint)',
        bodies.length > 0 && bodies.every((r) => r.body.satOn <= r.body.satOff + 0.02),
        bodies.map((r) => `${r.km}:${r.body.satOn.toFixed(2)}≤${r.body.satOff.toFixed(2)}`).join(' ')
      );
      const peaks = sky.filter((r) => r.km >= 9 && r.km <= 60 && r.head);
      console.log(`  (info) noon glint peak luma 9–60 km: ${peaks.map((r) => `${r.km}:${r.head.peak}`).join(' ')}`);
    }
    if (leg === 'dusk') {
      const d = sky.filter((r) => r.body?.d).map((r) => r.body.d[0] - r.body.d[2]);
      console.log(`  (info) dusk body ΔR−ΔB (gold catch-light): ${d.join(' ')}`);
    }
  }
  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  gate('zero shader / patch errors', shaderErrs.length === 0, shaderErrs.slice(0, 2).join(' | '));
  console.log(`\n${gates} gates. ${fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS'}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
