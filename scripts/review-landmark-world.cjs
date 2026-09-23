/* World-space comparison matrix. Fixed poses are visual evidence, not frame-time measurements. */
const { chromium } = require("playwright");
const fs = require("fs");
const names = [
  "Eiffel Tower",
  "Empire State Building",
  "Statue of Liberty",
  "Taj Mahal",
  "Sydney Opera House",
  "Big Ben",
  "Space Needle",
  "Gateway Arch",
  "Colosseum",
  "Willis Tower",
  "CN Tower",
  "Burj Khalifa",
];
const source = fs.readFileSync("lib/fly/poi/landmarks.js", "utf8");
const sites = [
  ...source.matchAll(
    /\['([^']+)',\s*([-\d.]+),\s*([-\d.]+),\s*'[^']+',\s*([\d.]+)/g,
  ),
]
  .filter((m) => names.includes(m[1]))
  .map((m) => ({ name: m[1], lat: +m[2], lon: +m[3], height: +m[4] }))
  .sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
(async () => {
  const out = ".graphics-review/landmarks/matrix";
  fs.mkdirSync(out, { recursive: true });
  const previous = fs.existsSync(out + "/report.json")
    ? JSON.parse(fs.readFileSync(out + "/report.json"))
    : null;
  const report = {
    status: "RUNNING",
    purpose: "fixed world poses; moving flight is measured separately",
    shots: previous?.shots ?? [],
    errors: [],
    blockedAttempts: previous?.blockedAttempts ?? [],
  };
  if (previous?.reason) report.blockedAttempts.push({reason:previous.reason,errors:previous.errors??[]});
  const save = () =>
    fs.writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
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
        window.__flyLandmarkBaseline = b;
        localStorage.setItem("fly-controls-seen", "1");
        localStorage.setItem("fly-sound-on", "0");
        localStorage.setItem("fly-crash-mode", "forgiving");
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
      for (const style of ["satellite", "toy"]) {
        await page.evaluate(
          (style) => window.__flyStore.getState().setMapStyle(style),
          style,
        );
        for (const site of sites)
          for (const range of ["far", "close"]) {
            if (
              report.shots.filter(
                (s) =>
                  s.site === site.name &&
                  s.range === range &&
                  s.style === style &&
                  s.baseline === baseline,
              ).length === 3
            )
              continue;
            await page.evaluate(
              ({ site, range }) => {
                const r = window.__fly,
                  f = r.flight;
                window.__matrixStep ??= f.step.bind(f);
                f.step = window.__matrixStep;
                const ground = r.engine.getElevationAt(site.lon, site.lat) || 0;
                const distance =
                  range === "far" ? 3100 : Math.max(380, site.height * 1.8);
                r.warpToGeo(site.lat, site.lon, {
                  offsetM: distance,
                  offsetBearingRad: Math.PI,
                  altM: ground + Math.max(100, site.height * 0.75),
                });
                r.autopilot.disengage();
                const position = f.pos.clone();
                f.heading = 0;
                f.pitch = 0;
                f.bank = 0;
                f.speed = 0;
                f.step = (dt, cmd) => {
                  window.__matrixStep(dt, {
                    ...cmd,
                    speedOverride: 0,
                    turn: 0,
                    pitch: 0,
                    boost: false,
                  });
                  f.pos.copy(position);
                  f.speed = 0;
                  f.heading = 0;
                  f.pitch = 0;
                  f.bank = 0;
                };
              },
              { site, range },
            );
            await page
              .getByTestId("warp-hold")
              .waitFor({ state: "hidden", timeout: 90000 });
            await page.waitForTimeout(6000);
            for (const time of ["day", "dusk", "night"]) {
              await page.evaluate(
                ({ site, time }) => {
                  const base = Date.UTC(2026, 6, 18),
                    phi = (site.lat * Math.PI) / 180,
                    decl =
                      ((-23.44 * Math.PI) / 180) *
                      Math.cos((2 * Math.PI * (199 + 10)) / 365.24);
                  const dusk =
                    12 +
                    (Math.acos(
                      (Math.sin((3 * Math.PI) / 180) -
                        Math.sin(phi) * Math.sin(decl)) /
                        (Math.cos(phi) * Math.cos(decl)),
                    ) *
                      12) /
                      Math.PI;
                  const hour =
                    (time === "day" ? 12 : time === "night" ? 24 : dusk) -
                    site.lon / 15;
                  window.__flySunOverride = base + hour * 3600000;
                  window.__flyStore.getState().bumpWarpEpoch("local");
                },
                { site, time },
              );
              await page
                .getByTestId("warp-hold")
                .waitFor({ state: "hidden", timeout: 90000 });
              await page.waitForTimeout(2100);
              const data = await page.evaluate(
                ({ site, range, baseline, style, time }) => {
                  const r = window.__fly,
                    renderer = window.__flyComposer.getRenderer();
                  let root = r.engine.object;
                  while (root.parent) root = root.parent;
                  const m = root.getObjectByName("monument-marquee"),
                    placed = window.__flyMonuments?.placed ?? [];
                  const w = r.engine.geoToWorld(site.lon, site.lat, 0),
                    cos = Math.cos((site.lat * Math.PI) / 180);
                  const columns =
                    r.satBuildings?.queryColumns?.(w.x, w.z, 400 / cos) || [];
                  const exclusion =
                    site.name === "CN Tower"
                      ? 32
                      : site.name === "Burj Khalifa"
                        ? 90
                        : null;
                  return {
                    site: site.name,
                    range,
                    baseline,
                    style,
                    time,
                    poi: placed.find((p) => p.name === site.name),
                    sun: r.sun,
                    terrain: window.__graphicsReview?.terrain,
                    readiness: r.worldReadiness,
                    tier: window.__flyStore.getState().qualityTier,
                    monuments: window.__flyStats?.monuments,
                    landmarkDraws:
                      m &&
                      !Array.isArray(m.material) &&
                      m.geometry.groups.length === 0
                        ? 1
                        : 0,
                    exclusion: exclusion
                      ? {
                          radius: exclusion,
                          inside: columns.filter(
                            (c) =>
                              Math.hypot(c.x - w.x, c.z - w.z) * cos <
                              exclusion,
                          ).length,
                          neighbors: columns.filter(
                            (c) =>
                              Math.hypot(c.x - w.x, c.z - w.z) * cos >=
                              exclusion,
                          ).length,
                        }
                      : null,
                    gpuMemory: renderer.info.memory,
                  };
                },
                { site, range, baseline, style, time },
              );
              const file =
                [
                  site.name.replaceAll(" ", "-"),
                  style,
                  range,
                  time,
                  baseline ? "before" : "after",
                ].join("-") + ".png";
              await page.screenshot({ path: out + "/" + file });
              report.shots = report.shots.filter((s) => s.file !== file);
              report.shots.push({ ...data, file });
              save();
            }
            console.log(
              [baseline ? "before" : "after", style, site.name, range].join(
                " ",
              ),
            );
          }
      }
      await page.close();
    }
    report.status = report.errors.length
      ? "FAIL"
      : report.shots.some(
            (s) =>
              !s.readiness?.ready ||
              (s.style === "satellite" && !s.terrain?.sharp),
          )
        ? "BLOCKED"
        : "CAPTURED";
  } catch (e) {
    report.status = "BLOCKED";
    report.reason = String(e.stack || e);
    report.blockedAttempts.push(report.reason);
    process.exitCode = 2;
  } finally {
    save();
    console.log("MATRIX " + report.status);
    await browser.close();
  }
})();
