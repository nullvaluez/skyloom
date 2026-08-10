/**
 * Shot runner — executes `shots.js` against the live app and writes one .webm
 * per shot plus a JSON sidecar of evidence and trim offsets.
 *
 * Usage:
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *   FLY_URL=http://localhost:3100 node scripts/trailer/capture.js --all
 *   … --shot=3            capture one shot
 *   … --width=1280 --height=720   smaller viewport (SwiftShader escape hatch)
 *   … --out=/path/to/raw  where clips land (default: scratchpad/raw)
 *   … --allow-unstreamed  keep footage even if the world-streamed gate fails
 *                         (DIAGNOSTIC ONLY — never for shipped footage)
 *
 * VIDEO TIMING CONTRACT. Playwright records a context from the moment it is
 * created, so every clip begins with boot + warp + settle. Rather than fight
 * that, each shot records its own wall-clock offsets into the sidecar:
 *
 *   t0          context created  (= video frame 0)
 *   actionStart the instant the camera move + overlay begin
 *   actionEnd   recording stops
 *
 * `compose.js` trims each clip to [actionStart − preRollMs, actionEnd] using
 * those numbers. Nothing is guessed from frame content.
 */

const fs = require('fs');
const path = require('path');
const { launch, newCaptureContext, bootTrailer } = require('./boot');
const { assertWorldStreamed, waitForPlateau, measureFps, readStats, samplePixels } = require('./probe');
const { resolveSun } = require('./sun');
const { SHOTS, DAY_UTC } = require('./shots');
const {
  showLowerThird,
  showTitleCard,
  showEndCard,
  clearOverlay,
  ensureOverlayRoot,
  showBlackout,
  fadeFromBlack,
} = require('./overlay');

const SCRATCH =
  process.env.TRAILER_SCRATCH ||
  '/tmp/claude-0/-home-user-skyloom/a2c8c929-63cc-5f77-b20e-356e7d2abdf2/scratchpad';

function arg(name, dflt = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
}
const flag = (name) => process.argv.includes(`--${name}`);

/**
 * How long the pre-shot black plate is held, and how long the shot takes to
 * fade off it. The hold must comfortably exceed compose.js's `blackdetect`
 * minimum-interval so the run is registered even at the ~1.4 fps this
 * container renders (a 2 s hold there is only ~3 frames).
 */
const BLACK_HOLD_MS = 3500;
const FADE_MS = 550;

/** Pin the sun for this shot (epoch-ms — the __flySunOverride contract). */
async function applySun(page, shot, place) {
  if (!shot.sun) return null;
  const solved = resolveSun(shot.sun, { lat: place.lat, lon: place.lon, dayUtc: shot.sun.dayUtc ?? DAY_UTC });
  if (!solved) return null;
  await page.evaluate((t) => {
    window.__flySunOverride = t;
  }, solved.tMs);
  return solved;
}

/** Warp + hold a pose. `warpToGeo` re-runs the day cycle (warpEpoch). */
async function warpTo(page, { lat, lon, altM, heading }) {
  await page.evaluate(
    ({ lat, lon, altM, heading }) => {
      window.__fly.warpToGeo(lat, lon, { altM, name: null });
      const f = window.__fly.flight;
      if (typeof heading === 'number') f.heading = (heading * Math.PI) / 180;
      f.pitch = 0;
      f.bank = 0;
    },
    { lat, lon, altM, heading }
  );
}

/** Freeze the aircraft exactly where it is (harness `pinScene` idiom). */
async function pinPose(page) {
  await page.evaluate(() => {
    const f = window.__fly.flight;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    const h = f.heading;
    clearInterval(window.__trailerPin);
    window.__trailerPin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = h;
      f.pitch = 0;
      f.bank = 0;
      f.speed = 0;
    }, 8);
  });
}
async function releasePose(page) {
  await page.evaluate(() => clearInterval(window.__trailerPin));
}

/**
 * Camera moves. Each returns a stop() that the runner calls at shot end.
 *
 * photoOrbit drives `photoRig._look.yaw` directly. That field accumulates drag
 * deltas and is otherwise only touched by `snap()` (lib/fly/photo-camera.js),
 * so advancing it per tick IS the orbit the drag would produce — no input
 * synthesis, no source change, and the plane keeps flying underneath.
 */
async function runMove(page, shot) {
  const cam = shot.camera || {};
  switch (cam.move) {
    case 'photoOrbit': {
      // P toggles photo mode: HUD hides, AttributionBar survives (verify-photo).
      const already = await page.evaluate(() => window.__flyStore.getState().cameraMode === 'photo');
      if (!already) await page.keyboard.press('p');
      await page.waitForTimeout(500);
      await page.evaluate(
        ({ pitchDeg, distM, degPerSec }) => {
          const rig = window.__fly.photoRig;
          if (!rig) return;
          if (typeof pitchDeg === 'number') rig._look.pitch = (pitchDeg * Math.PI) / 180;
          if (typeof distM === 'number') {
            rig._distTarget = distM;
            rig._dist = distM;
          }
          const radPerMs = ((degPerSec || 0) * Math.PI) / 180 / 1000;
          let last = performance.now();
          clearInterval(window.__trailerOrbit);
          window.__trailerOrbit = setInterval(() => {
            const now = performance.now();
            rig._look.yaw += radPerMs * (now - last);
            last = now;
          }, 16);
        },
        { pitchDeg: cam.pitchDeg, distM: cam.distM, degPerSec: cam.degPerSec }
      );
      return async () => {
        await page.evaluate(() => clearInterval(window.__trailerOrbit));
      };
    }
    case 'freeFlight': {
      await releasePose(page);
      await page.evaluate(
        ({ speed, boost, pitchHold }) => {
          const f = window.__fly.flight;
          if (typeof speed === 'number') f.speed = speed;
          clearInterval(window.__trailerFly);
          window.__trailerFly = setInterval(() => {
            if (typeof pitchHold === 'number') f.pitch = pitchHold;
            f.bank = 0;
            if (boost) f.boosting = true;
          }, 16);
        },
        { speed: cam.speed, boost: !!cam.boost, pitchHold: cam.pitchHold }
      );
      return async () => {
        await page.evaluate(() => clearInterval(window.__trailerFly));
      };
    }
    case 'intercept': {
      await releasePose(page);
      const hex = await page.evaluate(() => {
        const fly = window.__fly;
        const t = fly.traffic.getNearest(8, fly.flight.pos).find((i) => i.fix1);
        if (!t) return null;
        fly.interceptHex(t.hex);
        return t.hex;
      });
      if (hex && shot.camera.cinema) {
        await page.waitForTimeout(3000); // let the intercept engage
        await page.keyboard.press('c'); // cinema wing-cam (R6)
      }
      return async () => {};
    }
    case 'still':
    default:
      return async () => {};
  }
}

/** Put the shot's overlay on screen. */
async function runOverlay(page, shot, durationMs) {
  const o = shot.overlay;
  if (!o) return;
  if (o.kind === 'title') await showTitleCard(page, { ...o, durationMs });
  else if (o.kind === 'end') await showEndCard(page, o);
  else await showLowerThird(page, { text: o.text, sub: o.sub, durationMs });
}

async function captureShot(browser, shot, opts) {
  const { width, height, outDir, allowUnstreamed } = opts;
  const place = shot.place || shot.montage[0].place;
  const videoDir = path.join(outDir, `shot${String(shot.id).padStart(2, '0')}-${shot.slug}`);
  fs.mkdirSync(videoDir, { recursive: true });

  const t0 = Date.now();
  const context = await newCaptureContext(browser, { width, height, videoDir, record: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const log = (m) => console.log(`  [${shot.id}] ${m}`);
  const sidecar = {
    id: shot.id,
    slug: shot.slug,
    place: place.label,
    lat: place.lat,
    lon: place.lon,
    altM: shot.altM ?? null,
    heading: shot.heading ?? null,
    claim: shot.claim,
    overlay: shot.overlay,
    viewport: { width, height },
    t0,
  };

  try {
    const boot = await bootTrailer(page, { weather: 'weather' in shot ? shot.weather : 'baseline' });
    sidecar.bootMs = boot.ms;
    log(`booted in ${(boot.ms / 1000).toFixed(1)}s`);

    // Sun BEFORE warp — warpToGeo bumps warpEpoch, which re-runs the day-cycle
    // effect (the verify-dusk ordering: "Pin the sun, THEN warp").
    sidecar.sun = await applySun(page, shot, place);
    if (sidecar.sun) log(`sun el=${sidecar.sun.elDeg}° (${sidecar.sun.iso})`);

    if (shot.altM != null) {
      await warpTo(page, { lat: place.lat, lon: place.lon, altM: shot.altM, heading: shot.heading });
      if (shot.camera?.move === 'photoOrbit' || shot.camera?.move === 'still') await pinPose(page);
      log(`warped → ${place.label} @ ${shot.altM}m; settling ${(shot.settleMs / 1000).toFixed(0)}s`);
      await page.waitForTimeout(shot.settleMs);
      const pl = await waitForPlateau(page);
      sidecar.plateau = { ok: pl.plateaued, ms: pl.ms, tris: pl.history };
      log(`plateau=${pl.plateaued} tris=${pl.stats.triangles} draws=${pl.stats.drawCalls} traffic=${pl.stats.traffic}`);
    }

    if (shot.requiresTraffic && shot.camera?.waitTrafficMs) {
      await page.waitForTimeout(shot.camera.waitTrafficMs);
      const n = await page.evaluate(() => window.__fly.traffic.tracks.size);
      sidecar.trafficTracks = n;
      log(`live traffic tracks: ${n}`);
    }

    // THE honesty gate (brief §5) — the end card is exempt: it is an opaque
    // plate and deliberately shows no world.
    const needsWorld = shot.overlay?.kind !== 'end';
    const streamed = await assertWorldStreamed(page);
    sidecar.streamed = streamed;
    sidecar.fps = await measureFps(page, 3000);
    log(`world streamed: ${streamed.ok ? 'YES' : 'NO'}  fps=${sidecar.fps}`);
    if (!streamed.ok) streamed.reasons.forEach((r) => log(`   ! ${r}`));
    if (needsWorld && !streamed.ok && !allowUnstreamed) {
      sidecar.kept = false;
      sidecar.rejectReason = 'world-not-streamed';
      throw new Error(`shot ${shot.id}: world did not stream — refusing to keep footage. ${streamed.reasons.join('; ')}`);
    }

    await ensureOverlayRoot(page);

    // Black run: applied AFTER the gate (whose screenshots would otherwise
    // sample this plate instead of the world) and held long enough for
    // `blackdetect` to register it as an interval. Everything before the cut —
    // boot, warp, arrival transient, gate — ends up on the far side of it.
    await showBlackout(page);
    await page.waitForTimeout(BLACK_HOLD_MS);

    const stop = await runMove(page, shot);

    // THE cut. Everything before this frame is black by construction.
    const actionStart = Date.now();
    sidecar.actionStartMs = actionStart - t0;
    sidecar.fadeMs = FADE_MS;
    await fadeFromBlack(page, FADE_MS);
    await runOverlay(page, shot, shot.recordMs);

    // Montage: warp between beats while the clip keeps rolling.
    if (shot.montage) {
      for (const beat of shot.montage) {
        await warpTo(page, { lat: beat.place.lat, lon: beat.place.lon, altM: beat.altM, heading: beat.heading });
        await pinPose(page);
        await page.waitForTimeout(beat.holdMs);
      }
    } else {
      await page.waitForTimeout(shot.recordMs);
    }

    sidecar.actionEndMs = Date.now() - t0;
    await stop();

    // A hero still from the shot's best moment, for marketing/trailer/stills.
    const stillPath = path.join(videoDir, 'still.png');
    await page.locator('.fixed.inset-0 canvas').first().screenshot({ path: stillPath });
    sidecar.still = stillPath;
    sidecar.finalPixels = await samplePixels(page);
    sidecar.finalStats = await readStats(page);
    sidecar.kept = true;
  } catch (e) {
    sidecar.error = e.message;
    sidecar.kept = sidecar.kept ?? false;
    console.error(`  [${shot.id}] FAILED: ${e.message}`);
  }

  sidecar.pageErrors = pageErrors.slice(0, 10);
  const video = page.video();
  const vpath = video ? await video.path() : null;
  // The LAST MOMENT OF RECORDED CONTENT is the second anchor compose.js needs
  // to map wall-clock offsets onto video time (compose.js `timeScale`).
  // Measure it BEFORE context.close(): close() spends real seconds flushing
  // the encoder, and none of that is recorded content — including it biases
  // the ratio low (measured 0.88 on a clip whose true ratio was ~1.0).
  sidecar.closeMs = Date.now() - t0;
  await context.close(); // flushes the .webm
  if (vpath) {
    const dest = path.join(videoDir, 'clip.webm');
    try {
      fs.renameSync(vpath, dest);
      sidecar.clip = dest;
      sidecar.clipBytes = fs.statSync(dest).size;
    } catch (e) {
      sidecar.clipError = e.message;
    }
  }
  fs.writeFileSync(path.join(videoDir, 'shot.json'), JSON.stringify(sidecar, null, 2));
  return sidecar;
}

(async () => {
  const width = Number(arg('width', 1600));
  const height = Number(arg('height', 900));
  const outDir = arg('out', path.join(SCRATCH, 'raw'));
  const allowUnstreamed = flag('allow-unstreamed');
  const only = arg('shot', null);

  const list = only
    ? SHOTS.filter((s) => String(s.id) === String(only) || s.slug === only)
    : SHOTS.filter((s) => !s.optional || flag('with-optional'));
  if (!list.length) {
    console.error('no shots selected');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  console.log(`capturing ${list.length} shot(s) at ${width}×${height} → ${outDir}`);
  if (allowUnstreamed) console.log('!! --allow-unstreamed: footage will be kept even without a streamed world (diagnostic only)');

  const browser = await launch();
  const results = [];
  for (const shot of list) {
    console.log(`\n=== shot ${shot.id} · ${shot.slug} ===`);
    results.push(await captureShot(browser, shot, { width, height, outDir, allowUnstreamed }));
  }
  await browser.close();

  fs.writeFileSync(path.join(outDir, 'ledger.json'), JSON.stringify(results, null, 2));
  const kept = results.filter((r) => r.kept).length;
  console.log(`\n=== ${kept}/${results.length} shots kept · ledger → ${path.join(outDir, 'ledger.json')} ===`);
  process.exit(kept === results.length ? 0 : 2);
})().catch((e) => {
  console.error('capture crashed:', e);
  process.exit(1);
});
