const fs = require("fs"),
  path = require("path"),
  sharp = require("sharp");
const root = ".graphics-review/landmarks";
const output = "docs/reviews/landmark-upgrades";
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
(async () => {
  const matrix = read(root + "/matrix/report.json");
  if (matrix.shots.length !== 288 || matrix.status === "RUNNING")
    throw new Error("Finish all 288 world captures before packaging evidence");
  const detailed = new Set([
    "Eiffel Tower",
    "Empire State Building",
    "Willis Tower",
    "CN Tower",
    "Burj Khalifa",
  ]);
  const checks = {
    complete:
      matrix.shots.length === 288 &&
      new Set(matrix.shots.map((s) => s.file)).size === 288,
    filesPresent: matrix.shots.every((s) =>
      fs.existsSync(root + "/matrix/" + s.file),
    ),
    highQuality: matrix.shots.every((s) => s.tier === "high"),
    worldReady: matrix.shots.every((s) => s.readiness?.ready && !s.degraded),
    sharpSatellite: matrix.shots
      .filter((s) => s.style === "satellite")
      .every((s) => s.terrain?.sharp),
    oneUpdatedDraw: matrix.shots
      .filter((s) => !s.baseline)
      .every((s) => s.landmarkDraws === 1),
    closeDetail: matrix.shots
      .filter((s) => !s.baseline && s.range === "close" && detailed.has(s.site))
      .every((s) => s.poi?.detail === "high"),
    distantFallback: matrix.shots
      .filter((s) => !s.baseline && s.range === "far")
      .every((s) => s.poi?.detail === "far"),
    exclusions: matrix.shots
      .filter(
        (s) =>
          !s.baseline &&
          s.range === "close" &&
          s.style === "satellite" &&
          s.exclusion,
      )
      .every((s) => s.exclusion.inside === 0 && s.exclusion.neighbors > 0),
    noPageErrors: matrix.errors.length === 0,
  };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    output + "/world-matrix-checks.json",
    JSON.stringify(
      {
        status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
        checks,
      },
      null,
      2,
    ),
  );
  const pairs = matrix.shots
    .filter((s) => !s.baseline)
    .map((s) => {
      const before = s.file.replace("-after", "-before");
      return `<article data-style="${s.style}" data-time="${s.time}" data-range="${s.range}"><h2>${esc(s.site)} · ${s.range} · ${s.time}</h2><p>${esc(s.lighting)} · ${s.poi?.detail ?? "far"} · readiness ${s.readiness?.ready} · ${s.landmarkDraws} landmark draw</p><div><figure><img loading="lazy" src="matrix/${before}" alt="${esc(s.site)} before"><figcaption>Original representation</figcaption></figure><figure><img loading="lazy" src="matrix/${s.file}" alt="${esc(s.site)} after"><figcaption>Updated representation</figcaption></figure></div></article>`;
    })
    .join("\n");
  fs.writeFileSync(
    root + "/world.html",
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Landmarks in the world</title><style>body{background:#0b1422;color:#eef5ff;font:15px system-ui;margin:24px;max-width:1500px}h1{font-weight:500}h2{font-size:18px}article{margin:28px 0}article>div{display:flex;gap:12px}figure{margin:0;flex:1}img{width:100%}p,figcaption{color:#b0c0d2}label{margin-right:16px}select{padding:10px;background:#203345;color:white;border:1px solid #7595aa;border-radius:8px}@media(max-width:650px){article>div{display:block}}</style><h1>Landmarks in the world</h1><p>288 geographic views. Capture status: ${matrix.status}. Fixed-pose visual evidence; moving-flight performance is reported separately. Neon uses its fixed palette for all clock states. Baseline restores original models and lighting in the current renderer.</p><a href="index.html">Isolated asset comparisons</a><p><label>Style <select id="style"><option value="satellite">Satellite</option><option value="toy">Neon</option></select></label><label>Light <select id="time"><option>day</option><option>dusk</option><option>night</option></select></label><label>Distance <select id="range"><option>close</option><option>far</option></select></label></p>${pairs}<script>const update=()=>document.querySelectorAll('article').forEach(e=>e.hidden=['style','time','range'].some(k=>e.dataset[k]!==document.getElementById(k).value));document.querySelectorAll('select').forEach(e=>e.onchange=update);update();</script></html>`,
  );
  fs.mkdirSync(output, { recursive: true });
  for (const [source, name] of [
    [root + "/matrix/report.json", "world-matrix.json"],
    [root + "/art/report.json", "asset-matrix.json"],
    [root + "/world/report.json", "moving-flight.json"],
    [root + "/transitions/report.json", "detail-transitions.json"],
    [root + "/runtime/report.json", "runtime.json"],
    [".graphics-review/mobile-flight/report.json", "mobile.json"],
  ]) {
    const report = read(source);
    if (report.status === "RUNNING")
      throw new Error(source + " is still running");
    fs.copyFileSync(source, path.join(output, name));
  }
  for (const file of [
    "Eiffel-Tower-satellite-close-night-before.png",
    "Eiffel-Tower-satellite-close-night-after.png",
    "Burj-Khalifa-satellite-close-day-after.png",
    "CN-Tower-satellite-close-night-after.png",
  ])
    await sharp(root + "/matrix/" + file)
      .webp({ quality: 92 })
      .toFile(output + "/" + file.replace(".png", ".webp"));
  for (const file of [
    "takeoff-portrait.png",
    "takeoff-844.png",
    "approach-portrait.png",
    "setup-320.png",
  ])
    await sharp(".graphics-review/mobile-flight/" + file)
      .webp({ quality: 92 })
      .toFile(output + "/mobile-" + file.replace(".png", ".webp"));
  for (const time of ["day", "night"])
    await sharp(root + "/art/contact-" + time + ".png")
      .webp({ quality: 92 })
      .toFile(output + "/landmarks-" + time + ".webp");
  console.log("Packaged reports and ten review images in " + output);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
