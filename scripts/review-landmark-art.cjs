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
let reviewBrowser;
(async () => {
  const dir = ".graphics-review/landmarks/art";
  fs.mkdirSync(dir, { recursive: true });
  const b = (reviewBrowser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-gpu"],
  }));
  const page = await b.newPage({ viewport: { width: 800, height: 800 } }),
    errors = [],
    shots = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /shader|THREE|WebGL/.test(m.text()))
      errors.push(m.text());
  });
  for (const name of names.filter(
    (n) =>
      !process.env.LANDMARK_NAMES ||
      process.env.LANDMARK_NAMES.split(",").includes(n),
  ))
    for (const style of ["sat", "toy"])
      for (const time of ["day", "dusk", "night"])
        for (const baseline of [true, false]) {
          const q = new URLSearchParams({ name, style, time });
          if (baseline) q.set("baseline", "1");
          await page.goto("http://localhost:3017/dev/landmarks?" + q);
          await page.waitForFunction(
            () => window.__landmarkArt?.ready || window.__landmarkArt?.error,
            null,
            { timeout: 30000 },
          );
          await page.waitForTimeout(180);
          const data = await page.evaluate(() => ({
            ...window.__landmarkArt,
            renderer: window.__artRenderer,
          }));
          if (data.error) throw Error(data.error);
          const file =
            [
              name.replaceAll(" ", "-"),
              style,
              time,
              baseline ? "before" : "after",
            ].join("-") + ".png";
          await page.screenshot({ path: dir + "/" + file });
          shots.push({ ...data, time, file });
          if (time === "night" && !baseline) console.log(name + " " + style);
        }
  fs.writeFileSync(
    dir + "/report.json",
    JSON.stringify(
      {
        status: errors.length ? "FAIL" : "CAPTURED",
        purpose: "isolated asset review",
        shots: process.env.LANDMARK_NAMES
          ? [
              ...JSON.parse(fs.readFileSync(dir + "/report.json")).shots.filter(
                (x) => !shots.some((y) => y.file === x.file),
              ),
              ...shots,
            ]
          : shots,
        errors,
      },
      null,
      2,
    ),
  );
  await b.close();
  if (errors.length) process.exitCode = 1;
})().catch(async (e) => {
  await reviewBrowser?.close();
  console.error(e);
  process.exitCode = 1;
});
