// World Pass D (LOOK) round 2: frame numbers and triptychs for the control /
// own-flag / all-four arms shot in one session from one server.
//   node scripts/wp-look-frames.cjs <dir with control/ own/ all4/> [crop.json]
// Writes <dir>/frames.json (per shot and arm: mean sRGB luma of the frame and of
// its lower third, mean chroma of the lower half) and <dir>/tri-<shot>.jpg
// (control | own | all four, full frame at 1/3), plus each crop in crop.json
// ({ name: [shot, left, top, width, height] }) as crop-<name>.jpg.
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(process.argv[2]);
const crops = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {};
const ARMS = ['control', 'own', 'all4'];
(async () => {
  const shots = [...new Set(ARMS.flatMap((a) => (fs.existsSync(path.join(dir, a)) ? fs.readdirSync(path.join(dir, a)).filter((f) => f.endsWith('.png')) : [])))].sort();
  const out = {};
  for (const shot of shots) {
    out[shot] = {};
    for (const a of ARMS) {
      const f = path.join(dir, a, shot);
      if (!fs.existsSync(f)) continue;
      const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let L = 0, Ll = 0, nl = 0, ch = 0, nh = 0;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const o = (y * info.width + x) * 3;
        const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
        L += l;
        if (y >= (info.height * 2) / 3) {
          Ll += l;
          nl++;
        }
        if (y >= info.height / 2) {
          ch += Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]);
          nh++;
        }
      }
      out[shot][a] = { luma: +(L / (info.width * info.height)).toFixed(2), lowerThirdLuma: +(Ll / nl).toFixed(2), lowerHalfChroma: +(ch / nh).toFixed(2) };
    }
    const have = ARMS.filter((a) => fs.existsSync(path.join(dir, a, shot)));
    const W = 534, H = 300;
    const tiles = await Promise.all(have.map((a) => sharp(path.join(dir, a, shot)).resize(W, H).toBuffer()));
    await sharp({ create: { width: W * have.length + 6 * (have.length - 1), height: H, channels: 3, background: '#f0f' } })
      .composite(tiles.map((input, i) => ({ input, left: i * (W + 6), top: 0 })))
      .jpeg({ quality: 88 })
      .toFile(path.join(dir, `tri-${shot.replace('.png', '')}.jpg`));
  }
  for (const [name, [shot, l, t, w, h]] of Object.entries(crops)) {
    const have = ARMS.filter((a) => fs.existsSync(path.join(dir, a, shot)));
    const sc = Math.min(1, 600 / w);
    const W = Math.round(w * sc), H = Math.round(h * sc);
    const tiles = await Promise.all(have.map((a) => sharp(path.join(dir, a, shot)).extract({ left: l, top: t, width: w, height: h }).resize(W, H).toBuffer()));
    await sharp({ create: { width: W * have.length + 6 * (have.length - 1), height: H, channels: 3, background: '#f0f' } })
      .composite(tiles.map((input, i) => ({ input, left: i * (W + 6), top: 0 })))
      .jpeg({ quality: 90 })
      .toFile(path.join(dir, `crop-${name}.jpg`));
  }
  fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(out, null, 1));
  for (const [s, r] of Object.entries(out)) console.log(s, JSON.stringify(r));
})();
