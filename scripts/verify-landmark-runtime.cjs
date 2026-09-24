/* Browser integration: real loading failures, quality/style changes and warps. Not a performance benchmark. */
const { chromium } = require("playwright"),
  fs = require("fs");
(async () => {
  const out = ".graphics-review/landmarks/runtime";
  fs.mkdirSync(out, { recursive: true });
  const report = { status: "RUNNING", checks: [], errors: [] };
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-gpu"],
  });
  const check = (name, pass, data) => {
    report.checks.push({ name, pass, data });
    if (!pass) throw Error(name);
  };
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    page.on("pageerror", (e) => report.errors.push(e.stack));
    await page.addInitScript(() => {
      localStorage.setItem("fly-controls-seen", "1");
      localStorage.setItem("fly-sound-on", "0");
      localStorage.setItem("fly-quality-tier", "high");
      window.__flyWeatherOverride = "baseline";
    });
    await page.goto(
      (process.env.FLY_URL || "http://localhost:3017") + "/?graphicsReview=1",
    );
    await require("./_landmark-boot.cjs").enterOperationsHangar(page);
    await page.getByTestId("hangar-pick-prop").click({ timeout: 60000 });
    await page
      .locator(".ops-start-options label")
      .filter({ has: page.locator('input[value="approach"]') })
      .click();
    await page.getByTestId("hangar-fly").click();
    await page.waitForFunction(
      () =>
        window.__flyBoot?.pct === 100 &&
        !window.__fly.worldLoading &&
        window.__fly.worldReadiness.ready,
      null,
      { timeout: 90000 },
    );
    const park = async (lat, lon) => {
      await page.evaluate(
        ({ lat, lon }) => {
          const r = window.__fly,
            f = r.flight;
          r.warpToGeo(lat, lon, {
            altM: 300,
            offsetM: 800,
            offsetBearingRad: Math.PI,
          });
          r.autopilot.disengage();
          const pos = f.pos.clone();
          window.__runtimeStep ??= f.step.bind(f);
          f.step = (dt, cmd) => {
            window.__runtimeStep(dt, {
              ...cmd,
              speedOverride: 0,
              turn: 0,
              pitch: 0,
            });
            f.pos.copy(pos);
            f.speed = 0;
          };
        },
        { lat, lon },
      );
    };
    const detail = async (level) => {
      await page.waitForFunction(
        (level) =>
          window.__flyMonuments?.placed?.some(
            (p) => p.name === "Eiffel Tower" && p.detail === level,
          ),
        level,
        { timeout: 40000 },
      );
      return page.evaluate(() =>
        window.__flyMonuments.placed.find((p) => p.name === "Eiffel Tower"),
      );
    };
    await park(48.8584, 2.2945);
    check(
      "high detail replaces Eiffel fallback",
      (await detail("high")).triangles === 56012,
    );
    await page.evaluate(() =>
      window.__flyStore.getState().setQualityTier("low"),
    );
    check(
      "low quality returns to distant geometry",
      (await detail("far")).triangles === 2904,
    );
    await page.evaluate(() =>
      window.__flyStore.getState().setQualityTier("medium"),
    );
    check(
      "medium detail fits its own budget",
      (await detail("medium")).triangles === 9000,
    );
    await page.evaluate(() => window.__flyStore.getState().setMapStyle("toy"));
    await page.waitForFunction(
      () => window.__flyMonuments?.style === "toy",
      null,
      { timeout: 40000 },
    );
    check(
      "style change reloads medium geometry",
      (await detail("medium")).triangles === 9000,
    );
    await page.evaluate(() => {
      const r = window.__fly;
      r.warpToGeo(43.6426, -79.3871, { altM: 500 });
      r.warpToGeo(25.1972, 55.2744, { altM: 600 });
      r.warpToGeo(48.8584, 2.2945, {
        altM: 300,
        offsetM: 800,
        offsetBearingRad: Math.PI,
      });
    });
    await park(48.8584, 2.2945);
    await detail("medium");
    check(
      "rapid warps retain bounded detail/cache",
      await page.evaluate(
        () =>
          window.__flyStats.monuments.detailed <= 2 &&
          window.__flyStats.monuments.detailCache <= 4,
      ),
    );
    let failures = 0;
    await page.route("**/monument-eiffel-detail-v1.glb", (route) => {
      failures++;
      return route.fulfill({ status: 503, body: "controlled detail failure" });
    });
    await page.evaluate(() => {
      window.__flyStore.getState().setMapStyle("satellite");
      window.__flyStore.getState().setQualityTier("high");
    });
    await page.waitForFunction(
      () => window.__flyMonuments?.style === "satellite",
      null,
      { timeout: 40000 },
    );
    await page.waitForTimeout(6000);
    check(
      "failed high request leaves a visible distant model",
      failures > 0 && (await detail("far")).triangles === 2904,
      { failures },
    );
    await page.unroute("**/monument-eiffel-detail-v1.glb");
    await page.evaluate(() =>
      window.__flyStore.getState().setQualityTier("medium"),
    );
    await detail("medium");
    const state = await page.evaluate(() => {
      let root = window.__fly.engine.object;
      while (root.parent) root = root.parent;
      const m = root.getObjectByName("monument-marquee");
      return {
        key: m.material.customProgramCacheKey(),
        groups: m.geometry.groups.length,
        materialArray: Array.isArray(m.material),
        stats: window.__flyStats.monuments,
      };
    });
    check(
      "recovery retains one shared draw",
      state.groups === 0 && !state.materialArray,
      state,
    );
    check(
      "fallback suppression stays in the same frame",
      state.stats.lagSec === 0 && state.stats.lateConsumes === 0,
      state.stats,
    );
    check("no page errors", report.errors.length === 0);
    report.status = "PASS";
  } catch (e) {
    report.status = "FAIL";
    report.reason = String(e.stack || e);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    await browser.close();
  }
})();
