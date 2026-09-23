const { chromium } = require("playwright");
const fs = require("fs");
const percent = (a, p) =>
  [...a].sort((a, b) => a - b)[
    Math.min(a.length - 1, Math.floor(a.length * p))
  ];
(async () => {
  const transitions = process.env.LANDMARK_TRANSITIONS === "1";
  const out = transitions
    ? ".graphics-review/landmarks/transitions"
    : ".graphics-review/landmarks/world";
  fs.mkdirSync(out, { recursive: true });
  const report = { status: "RUNNING", runs: [], errors: [] };
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-gpu"],
  });
  try {
    for (const baseline of [true, false]) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });
      page.on("pageerror", (e) => report.errors.push(e.message));
      await page.addInitScript((b) => {
        localStorage.setItem("fly-controls-seen", "1");
        localStorage.setItem("fly-sound-on", "0");
        localStorage.setItem("fly-quality-tier", "high");
        window.__flyLandmarkBaseline = b;
        window.__flySunOverride = Date.UTC(2026, 6, 18, 22);
        window.__flyWeatherOverride = "baseline";
      }, baseline);
      await page.goto("http://localhost:3017/?graphicsReview=1");
      await page.getByTestId("hangar-pick-prop").click({ timeout: 60000 });
      await page
        .locator(".ops-start-options label")
        .filter({ has: page.locator('input[value="approach"]') })
        .click();
      await page.getByTestId("hangar-fly").click({ timeout: 60000 });
      await page.waitForFunction(
        () =>
          window.__flyBoot?.pct === 100 &&
          !window.__fly.worldLoading &&
          window.__fly.worldReadiness.ready,
        null,
        { timeout: 90000 },
      );
      for (const site of transitions
        ? [
            { name: "Eiffel Tower", lat: 48.8584, lon: 2.2945, y: 320 },
            { name: "Burj Khalifa", lat: 25.1972, lon: 55.2744, y: 640 },
          ]
        : [
            { name: "Eiffel Tower", lat: 48.8584, lon: 2.2945, y: 240 },
            {
              name: "Empire State Building",
              lat: 40.7484,
              lon: -73.9857,
              y: 360,
            },
          ]) {
        await page.evaluate(
          ({ s, transitions }) => {
            const r = window.__fly;
            r.warpToGeo(s.lat - (transitions ? 0.027 : 0.014), s.lon, {
              altM: s.y,
            });
            r.autopilot.disengage();
            r.flight.heading = 0;
            r.flight.pitch = 0;
            r.flight.bank = 0;
          },
          { s: site, transitions },
        );
        await page
          .getByTestId("warp-hold")
          .waitFor({ state: "hidden", timeout: 30000 });
        if (!baseline || site.name !== "Burj Khalifa")
          await page.waitForFunction(
            (name) =>
              window.__flyMonuments?.placed?.some((p) => p.name === name),
            site.name,
            { timeout: 30000 },
          );
        // Warm the local scene, then restart the identical measured approach. No governor or terrain pins.
        await page.waitForTimeout(6000);
        await page.evaluate(
          ({ s, transitions }) => {
            const r = window.__fly;
            r.warpToGeo(s.lat - (transitions ? 0.027 : 0.014), s.lon, {
              altM: s.y,
            });
            r.flight.heading = 0;
            r.flight.pitch = 0;
          },
          { s: site, transitions },
        );
        await page
          .getByTestId("warp-hold")
          .waitFor({ state: "hidden", timeout: 30000 });
        const metrics = await page.evaluate(
          async ({ site, baseline, transitions }) => {
            const r = window.__fly,
              f = r.flight,
              original = f.step.bind(f),
              frames = [],
              tiers = [],
              start = performance.now();
            const detailChanges = [],
              draws = [],
              triangles = [];
            const heapStart = performance.memory?.usedJSHeapSize;
            let heapPeak = heapStart;
            let lastDetail = null;
            let last = 0,
              distance = 0,
              prev = { x: f.pos.x, z: f.pos.z };
            const gl = window.__flyComposer.getRenderer(),
              ext = gl.getContext().getExtension("WEBGL_debug_renderer_info");
            f.step = (dt, cmd) =>
              original(dt, {
                ...cmd,
                speedOverride: 80,
                turn: 0,
                pitch: 0,
                boost: false,
              });
            await new Promise((resolve) => {
              function sample(t) {
                if (last) frames.push(t - last);
                draws.push(gl.info.render.calls);
                triangles.push(gl.info.render.triangles);
                heapPeak = Math.max(
                  heapPeak || 0,
                  performance.memory?.usedJSHeapSize || 0,
                );
                const detail = window.__flyMonuments?.placed?.find(
                  (p) => p.name === site.name,
                )?.detail;
                if (detail !== lastDetail) {
                  detailChanges.push({
                    detail,
                    sampleIndex: frames.length - 1,
                    atMs: t - start,
                    frameMs: last ? t - last : 0,
                  });
                  lastDetail = detail;
                }
                last = t;
                distance +=
                  Math.hypot(f.pos.x - prev.x, f.pos.z - prev.z) *
                  Math.cos((site.lat * Math.PI) / 180);
                prev = { x: f.pos.x, z: f.pos.z };
                tiers.push(window.__flyStore.getState().qualityTier);
                if (t - start < (transitions ? 30000 : 20000))
                  requestAnimationFrame(sample);
                else resolve();
              }
              requestAnimationFrame(sample);
            });
            f.step = original;
            let root = r.engine.object;
            while (root.parent) root = root.parent;
            const marquee = root.getObjectByName("monument-marquee");
            return {
              baseline,
              pins: {
                governor: window.__flyGovPin ?? null,
                terrain: window.__flyTerraPin ?? null,
              },
              site: site.name,
              frames,
              detailChanges,
              draws,
              triangleSamples: triangles,
              heapStart,
              heapPeak,
              gpuMemory: { ...gl.info.memory },
              programs: gl.info.programs?.length,
              distance,
              tiers: [...new Set(tiers)],
              renderer:
                ext &&
                gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL),
              calls: gl.info.render.calls,
              triangles: gl.info.render.triangles,
              heap: performance.memory?.usedJSHeapSize,
              monuments: window.__flyMonuments,
              stats: window.__flyStats?.monuments,
              landmarkMeshes: marquee ? 1 : 0,
              landmarkDraws:
                marquee &&
                !Array.isArray(marquee.material) &&
                marquee.geometry.groups.length === 0
                  ? 1
                  : 0,
              readiness: r.worldReadiness,
              terrain: window.__graphicsReview?.terrain,
            };
          },
          { site, baseline, transitions },
        );
        metrics.drawsP95 = percent(metrics.draws, 0.95);
        metrics.trianglesP95 = percent(metrics.triangleSamples, 0.95);
        delete metrics.draws;
        delete metrics.triangleSamples;
        metrics.p95 = percent(metrics.frames, 0.95);
        metrics.p50 = percent(metrics.frames, 0.5);
        metrics.max = Math.max(...metrics.frames);
        for (const change of metrics.detailChanges)
          change.nearbyMaxMs = Math.max(
            ...metrics.frames.slice(
              Math.max(0, change.sampleIndex - 1),
              change.sampleIndex + 4,
            ),
          );
        delete metrics.frames;
        report.runs.push(metrics);
        await page.screenshot({
          path:
            out +
            "/" +
            site.name.replaceAll(" ", "-") +
            (baseline ? "-before" : "-after") +
            ".png",
        });
        console.log(
          JSON.stringify({
            site: site.name,
            baseline,
            p95: metrics.p95,
            distance: metrics.distance,
            tier: metrics.tiers,
            mon: metrics.stats,
          }),
        );
        fs.writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
      }
      await page.close();
    }
    const comparisons = report.runs
      .filter((r) => !r.baseline)
      .map((r) => {
        const b = report.runs.find((s) => s.baseline && s.site === r.site);
        return {
          site: r.site,
          ratio: r.p95 / b.p95,
          within10Percent: r.p95 <= b.p95 * 1.1,
          matchedTiers: JSON.stringify(r.tiers) === JSON.stringify(b.tiers),
          moving: r.distance > 1000 && b.distance > 1000,
          oneDraw: r.landmarkDraws === 1,
          readiness: r.readiness?.ready && b.readiness?.ready,
          transition:
            !transitions ||
            (r.detailChanges.some((c) => c.detail === "far") &&
              r.detailChanges.some((c) => c.detail === "high")),
          detailActive: r.monuments?.placed?.some(
            (p) => p.name === r.site && p.detail === "high",
          ),
          hardware: !/(SwiftShader|llvmpipe|software)/i.test(
            r.renderer || "software",
          ),
        };
      });
    report.comparisons = comparisons;
    report.status = report.errors.length
      ? "FAIL"
      : comparisons.every(
            (c) =>
              c.within10Percent &&
              c.matchedTiers &&
              c.moving &&
              c.oneDraw &&
              c.readiness &&
              c.transition &&
              c.detailActive &&
              c.hardware,
          )
        ? "PASS"
        : "FAIL";
    if (report.status === "FAIL") process.exitCode = 1;
  } catch (e) {
    report.status = "BLOCKED";
    report.reason = String(e.stack || e);
    process.exitCode = 2;
  } finally {
    fs.writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
    console.log("WORLD " + report.status);
    await browser.close();
  }
})();
