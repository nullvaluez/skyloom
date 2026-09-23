const fs = require("fs"),
  path = require("path"),
  sharp = require("sharp");
(async () => {
  const root = ".graphics-review/landmarks",
    dir = root + "/art",
    r = JSON.parse(fs.readFileSync(dir + "/report.json"));
  for (const time of ["day", "night"]) {
    const rows = r.shots.filter(
      (x) => x.style === "sat" && x.time === time && !x.baseline,
    );
    const parts = await Promise.all(
      rows.map(async (x, i) => ({
        input: await sharp(dir + "/" + x.file)
          .resize(300, 300)
          .png()
          .toBuffer(),
        left: (i % 4) * 300,
        top: Math.floor(i / 4) * 300,
      })),
    );
    await sharp({
      create: { width: 1200, height: 900, channels: 3, background: "#08101a" },
    })
      .composite(parts)
      .png()
      .toFile(dir + "/contact-" + time + ".png");
  }
  const pairs = r.shots
    .filter((x) => !x.baseline)
    .map(
      (s) =>
        `<article data-style="${s.style}" data-time="${s.time}"><h2>${s.poi} · ${s.style} · ${s.time}</h2><div><figure><img loading="lazy" src="art/${s.file.replace("-after", "-before")}" alt="${s.poi} before"><figcaption>Before</figcaption></figure><figure><img loading="lazy" src="art/${s.file}" alt="${s.poi} after"><figcaption>After · ${s.triangles.toLocaleString()} triangles</figcaption></figure></div></article>`,
    )
    .join("");
  fs.writeFileSync(
    root + "/index.html",
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Landmark comparisons</title><style>body{background:#0b1422;color:#eef5ff;font:15px system-ui;margin:24px;max-width:1400px}h1{font-weight:500}article{margin:28px 0}h2{font-size:16px;font-weight:500}article>div{display:flex;gap:16px}figure{margin:0;flex:1}img{width:100%;height:auto}figcaption{padding:8px;color:#b0c0d2}label{margin-right:20px}select{padding:10px;background:#203345;color:white;border:1px solid #7595aa;border-radius:8px}</style><h1>Landmarks · before and after</h1><p>Isolated model and material comparisons. Geographic placement and moving-flight measurements have separate reports.</p><label>Style <select id="style"><option value="sat">Satellite</option><option value="toy">Neon</option></select></label><label>Light <select id="time"><option>day</option><option>dusk</option><option>night</option></select></label>${pairs}<script>const update=()=>document.querySelectorAll('article').forEach(e=>e.hidden=e.dataset.style!==document.getElementById('style').value||e.dataset.time!==document.getElementById('time').value);document.querySelectorAll('select').forEach(e=>e.onchange=update);update();</script></html>`,
  );
})();
