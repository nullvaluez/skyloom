const { chromium, devices } = require("playwright");
const fs = require("fs");
(async () => {
  const out = ".graphics-review/mobile-flight";
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-gpu"],
  });
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage(),
    report = { status: "RUNNING", checks: [], errors: [] };
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("fly-controls-seen", "1");
    localStorage.setItem("fly-sound-on", "0");
  });
  const check = (name, ok) => {
    report.checks.push({ name, pass: ok });
    if (!ok) throw Error(name);
  };
  const bounds = async () => {
    const r = await page.evaluate(() => {
      const nodes = [
        ...document.querySelectorAll(
          '.mfd-strip,.mfd-guidance,.mfd-power,[data-testid="touch-joystick"],[data-testid="touch-fab"]',
        ),
      ].filter((e) => e.getClientRects().length);
      return nodes.map((e) => {
        const b = e.getBoundingClientRect();
        return {
          name: e.className,
          x: b.x,
          y: b.y,
          w: b.width,
          h: b.height,
          inside:
            b.x >= 0 &&
            b.y >= 0 &&
            b.right <= innerWidth + 1 &&
            b.bottom <= innerHeight + 1,
          hit: !e.matches(".mfd-guidance")
            ? e.contains(
                document.elementFromPoint(
                  b.x + b.width / 2,
                  b.y + b.height / 2,
                ),
              )
            : true,
        };
      });
    });
    report.rects ??= [];
    report.rects.push({ viewport: page.viewportSize(), r });
    check(
      "visible controls inside viewport",
      r.every((x) => x.inside),
    );
    check(
      "controls not covered",
      r.every((x) => x.hit),
    );
    check(
      "no horizontal overflow",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  };
  try {
    await page.goto(process.env.FLY_URL || "http://localhost:3017");
    await page.getByTestId("hangar-pick-prop").tap({ timeout: 60000 });
    await page.screenshot({ path: out + "/hangar-portrait.png" });
    for (const viewport of [
      { width: 844, height: 390 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      check(
        "hangar launch remains visible and reachable",
        await page.getByTestId("hangar-fly").evaluate((e) => {
          const b = e.getBoundingClientRect();
          return (
            b.top >= 0 &&
            b.bottom <= innerHeight &&
            e.contains(
              document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2),
            )
          );
        }),
      );
      await page.screenshot({
        path: out + "/hangar-" + viewport.width + ".png",
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator(".ops-start-options label")
      .filter({ has: page.locator('input[value="runway"]') })
      .tap();
    await page.getByTestId("hangar-fly").tap({ timeout: 60000 });
    let full = true;
    try {
      await page.waitForFunction(
        () =>
          window.__flyBoot?.pct === 100 &&
          !window.__fly?.worldLoading &&
          window.__fly?.worldReadiness?.ready,
        null,
        { timeout: 90000 },
      );
    } catch {
      full = false;
      report.readiness = await page.evaluate(() => window.__fly.worldReadiness);
      const btn = page.getByRole("button", {
        name: "Continue with reduced detail",
      });
      if (await btn.count()) await btn.last().click();
      await page.waitForFunction(
        () => window.__flyBoot?.pct === 100 && !window.__fly?.worldLoading,
        null,
        { timeout: 15000 },
      );
    }
    report.fullWorld = full;
    await page
      .getByTestId("warp-hold")
      .waitFor({ state: "hidden", timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.getByTestId("mobile-flight-deck").waitFor();
    await bounds();
    await page.screenshot({ path: out + "/runway-portrait.png" });
    await page
      .getByRole("button", { name: "Begin takeoff", exact: true })
      .tap();
    check(
      "takeoff action reaches flight engine",
      await page.evaluate(
        () => window.__fly.operations.phase === "takeoffRoll",
      ),
    );
    await page.locator("#mobile-flight-throttle").fill("35");
    check(
      "power slider reaches flight engine",
      await page.evaluate(() => window.__fly.operations.throttle === 0.35),
    );
    const cdp = await context.newCDPSession(page),
      stick = await page.getByTestId("touch-joystick").boundingBox(),
      brake = await page
        .getByRole("button", { name: "Hold brakes", exact: true })
        .boundingBox();
    const a = {
        x: stick.x + stick.width / 2 + 30,
        y: stick.y + stick.height / 2,
        id: 1,
      },
      b = {
        x: brake.x + brake.width / 2,
        y: brake.y + brake.height / 2,
        id: 2,
      };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [a],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [a, b],
    });
    await page.waitForTimeout(200);
    check(
      "both thumbs reach input controller",
      await page.evaluate(
        () => window.__fly.input.touch.active && window.__fly.input.touchBrake,
      ),
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    check(
      "touch cancellation clears steering and brake",
      await page.evaluate(
        () =>
          !window.__fly.input.touch.active && !window.__fly.input.touchBrake,
      ),
    );
    await page.screenshot({ path: out + "/takeoff-portrait.png" });
    report.checks.push({
      name: "two-finger steer + brake then cancellation",
      pass: true,
    });
    for (const viewport of [
      { width: 844, height: 390 },
      { width: 320, height: 568 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      await bounds();
      await page
        .getByRole("button", { name: "Flight setup", exact: true })
        .tap();
      check(
        "setup leaves power controls reachable",
        await page.getByTestId("mobile-flight-power").evaluate((e) => {
          const b = e.getBoundingClientRect();
          return e.contains(
            document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2),
          );
        }),
      );
      await page.screenshot({
        path: out + "/setup-" + viewport.width + ".png",
      });
      await page.getByRole("button", { name: "Close flight setup" }).tap();
      await page.screenshot({
        path: out + "/takeoff-" + viewport.width + ".png",
      });
    }
    await page.evaluate(() =>
      window.__fly.beginDeparture("prop", "KOSU", "approach"),
    );
    await page
      .getByTestId("warp-hold")
      .waitFor({ state: "hidden", timeout: 20000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: out + "/approach-portrait.png" });
    await page.getByRole("button", { name: "Flight setup", exact: true }).tap();
    await page.selectOption("#mobile-arrival", "KCMH");
    check(
      "destination updates",
      await page.evaluate(() => window.__fly.operations.destination === "KCMH"),
    );
    await page.getByRole("button", { name: "Close flight setup" }).tap();
    await page.getByRole("button", { name: "Flight setup", exact: true }).tap();
    await page.getByRole("button", { name: /Practice landing/ }).tap();
    await page
      .getByTestId("warp-hold")
      .waitFor({ state: "hidden", timeout: 20000 });
    await page.getByRole("button", { name: "Go around", exact: true }).tap();
    check(
      "go around reaches engine",
      await page.evaluate(
        () =>
          window.__fly.operations.throttle === 1 &&
          window.__fly.operations.phase === "airborne",
      ),
    );
    await page.getByTestId("touch-fab").tap();
    await page.getByTestId("touch-pause").tap();
    check(
      "operations hidden under full overlay",
      !(await page.getByTestId("mobile-flight-deck").count()),
    );
    report.status = full ? "PASS" : "BLOCKED";
    report.controlStatus = "PASS";
  } catch (e) {
    report.status = "FAIL";
    report.error = String(e.stack || e);
    await page.screenshot({ path: out + "/failure.png" }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    await browser.close();
  }
})();
