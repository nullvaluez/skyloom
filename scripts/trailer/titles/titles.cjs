#!/usr/bin/env node
/**
 * Skyloom trailer - title-card renderer.
 *
 * Renders every card in scripts/trailer/cuesheet.json ("titles") to PNG
 * sequences with a real alpha channel (transparent overlays), plus the opaque
 * end card, by driving titles.html's pure render(t) in headless Chromium.
 *
 *   nice -n 15 node scripts/trailer/titles/titles.cjs              # everything
 *   nice -n 15 node scripts/trailer/titles/titles.cjs --only=paris,endcard
 *   nice -n 15 node scripts/trailer/titles/titles.cjs --review     # contact-sheet stills only
 *   nice -n 15 node scripts/trailer/titles/titles.cjs --resume     # finish an interrupted render
 *
 * Output (default OUT=/tmp/claude-0/titles):
 *   <OUT>/<NN>_<slug>/<frame>.png   frame = round((t - t0) * 30), 4-digit padded
 *   <OUT>/manifest.json             one entry per sequence
 * Review mode writes stills to <OUT>/review/raw/<slug>/<label>.png and then
 * runs contact.py to build the contact sheets in <OUT>/review/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const HERE = __dirname;
const CUESHEET = path.join(HERE, '..', 'cuesheet.json');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const OUT = args.out || '/tmp/claude-0/titles';
const ONLY = args.only ? String(args.only).split(',').map((s) => s.trim().toLowerCase()) : null;
const REVIEW = !!args.review;
const RESUME = !!args.resume; // keep complete frames already on disk
const FPS = 30;

function quant(t) { return Math.round(t * FPS) / FPS; }

// the five review moments: entry, landed, mid-hold, pre-exit, exit
function moments(g) {
  const s = g.spec || { in: 0.3, out: 0.3 };
  const last = g.t1 - 1 / FPS;
  return [
    ['1-entry', g.t0 + s.in * 0.35],
    ['2-landed', g.t0 + s.in + 0.1],
    ['3-mid', (g.t0 + g.t1) / 2],
    ['4-preexit', last - s.out - 0.05],
    ['5-exit', last - s.out * 0.5],
  ].map(([k, t]) => [k, quant(t)]);
}

// Hero type is vector geometry: shape.py (HarfBuzz) shapes every string and
// exports outlines. The result is cached next to this file, keyed by the
// request + font bytes, so re-renders need Python only when a title changes.
function shapeGlyphs(req) {
  for (const k of Object.keys(req.fonts)) req.fonts[k].file = path.resolve(HERE, req.fonts[k].file);
  const h = crypto.createHash('sha1').update(JSON.stringify(req));
  for (const k of Object.keys(req.fonts).sort()) h.update(fs.readFileSync(req.fonts[k].file));
  const key = h.digest('hex');
  const cache = path.join(HERE, 'glyphs.cache.json');
  if (fs.existsSync(cache)) {
    const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (c.key === key) return c.glyphs;
  }
  const tmp = path.join(require('os').tmpdir(), `skyloom-shape-${process.pid}`);
  fs.writeFileSync(tmp + '.req.json', JSON.stringify(req));
  execFileSync('python3', [path.join(HERE, 'shape.py'), tmp + '.req.json', tmp + '.out.json'], { stdio: 'inherit' });
  const glyphs = JSON.parse(fs.readFileSync(tmp + '.out.json', 'utf8'));
  fs.writeFileSync(cache, JSON.stringify({ key, glyphs }));
  fs.rmSync(tmp + '.req.json', { force: true }); fs.rmSync(tmp + '.out.json', { force: true });
  return glyphs;
}

// one browser, one page; re-opened only if Chromium dies (the machine is
// shared and memory-tight: an OOM kill must cost one frame, not the render)
async function openPage(cues) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { console.error('[pageerror]', e.message); process.exitCode = 1; });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto('file://' + path.join(HERE, 'titles.html'));
  const ok = await page.evaluate(() => window.fontsReady());
  if (!ok.every(Boolean)) throw new Error('fonts failed to load: ' + JSON.stringify(ok));
  const glyphs = shapeGlyphs(await page.evaluate((titles) => window.shapingRequest(titles), cues.titles));
  const groups = await page.evaluate(([titles, gl]) => window.setup(titles, gl), [cues.titles, glyphs]);
  return { browser, page, groups };
}
// a frame on disk counts only if it is a complete PNG (ends with the IEND chunk)
function frameDone(file) {
  try {
    const st = fs.statSync(file);
    if (st.size < 64) return false;
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(8);
    fs.readSync(fd, b, 0, 8, st.size - 8); fs.closeSync(fd);
    return b.toString('latin1', 0, 4) === 'IEND';
  } catch { return false; }
}

(async () => {
  const cues = JSON.parse(fs.readFileSync(CUESHEET, 'utf8'));
  let { browser, page, groups } = await openPage(cues);
  const pick = groups.filter((g) => !ONLY || ONLY.some((o) => g.slug.includes(o) || g.kind === o));
  fs.mkdirSync(OUT, { recursive: true });

  if (REVIEW) {
    const RAW = path.join(OUT, 'review', 'raw');
    const plan = [];
    for (const g of pick) {
      await page.evaluate((i) => window.showGroup(i), g.index);
      const dir = path.join(RAW, g.slug);
      fs.mkdirSync(dir, { recursive: true });
      const shots = g.kind === 'end'
        ? [['a-9450-boom', 94.5 + 2 / 30], ['b-9480', 94.8], ['c-9550', 95.5], ['d-9800', 98.0], ['e-10100', 101.0], ['f-10350', 103.5]].map(([k, t]) => [k, quant(t)])
        : moments(g);
      for (const [label, t] of shots) {
        await page.evaluate((tt) => window.render(tt), t);
        await page.screenshot({ path: path.join(dir, label + '.png'), omitBackground: g.alpha });
      }
      plan.push({ slug: g.slug, kind: g.kind, text: g.text, alpha: g.alpha, shots: shots.map(([label, t]) => ({ label, t })) });
      console.log('review', g.slug, shots.map((s) => s[1].toFixed(3)).join(' '));
    }
    fs.writeFileSync(path.join(OUT, 'review', 'plan.json'), JSON.stringify(plan, null, 1));
    await browser.close();
    execFileSync('python3', [path.join(HERE, 'contact.py'), path.join(OUT, 'review')], { stdio: 'inherit' });
    return;
  }

  const manifestPath = path.join(OUT, 'manifest.json');
  let manifest = { fps: FPS, width: 1920, height: 1080, sequences: [] };
  if ((ONLY || RESUME) && fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const t00 = Date.now();
  let relaunches = 0;
  for (const g of pick) {
    const dir = path.join(OUT, g.slug);
    if (!RESUME) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const n = Math.round((g.t1 - g.t0) * FPS);
    const tg = Date.now();
    let shown = false, skipped = 0;
    for (let f = 0; f < n; f++) {
      const file = path.join(dir, String(f).padStart(4, '0') + '.png');
      if (RESUME && frameDone(file)) { skipped++; continue; }
      const t = g.t0 + f / FPS;
      try {
        if (!shown) { await page.evaluate((i) => window.showGroup(i), g.index); shown = true; }
        await page.evaluate((tt) => window.render(tt), t);
        await page.screenshot({ path: file + '.tmp.png', omitBackground: g.alpha });
        fs.renameSync(file + '.tmp.png', file);
      } catch (e) {
        if (++relaunches > 6) throw e;
        console.error(`! ${g.slug} frame ${f}: ${e.message.split('\n')[0]} - relaunching (${relaunches}/6)`);
        try { await browser.close(); } catch { /* already gone */ }
        await new Promise((r) => setTimeout(r, 5000));
        ({ browser, page } = await openPage(cues));
        shown = false;
        f--; // pure function of t: just redo this frame
      }
    }
    const entry = {
      dir: path.join(OUT, g.slug), slug: g.slug, kind: g.kind, text: g.text,
      t0: g.t0, t1: g.t1, frames: n, fps: FPS, alpha: g.alpha, pattern: '%04d.png',
      ...(g.kind === 'end' ? { note: 'opaque end card: logo 94.5 + tagline 96.6 + CTA/credits 99.2 + fade to black 103-104 baked in' } : {}),
    };
    manifest.sequences = manifest.sequences.filter((s) => s.slug !== g.slug);
    manifest.sequences.push(entry);
    manifest.sequences.sort((a, b) => a.t0 - b.t0);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    console.log(`${g.slug}: ${n} frames (${skipped} already on disk) in ${((Date.now() - tg) / 1000).toFixed(1)}s`);
  }
  console.log(`done: ${pick.length} sequences in ${((Date.now() - t00) / 1000).toFixed(1)}s -> ${manifestPath}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
