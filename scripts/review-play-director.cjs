// Play Pass DIRECTOR review captures (desktop Chrome, real GPU, live feeds).
//
//   node scripts/review-play-director.cjs [--port 3134] [--airport KJFK] [--utc 16]
//        [--flags -LOUNGE_DIRECTOR] [--settle 25] [--width 1440 --height 900]
//        [--steps default,next,watch,bino,director] [--director-sec 90]
//        [--out .graphics-review/play-pass/director/<name>]
//
// Boots past the title like scripts/review-observation-lounge.cjs (the same
// pins: Enhanced, satellite, sound off, --utc as the sun pin), enters the
// lounge at --airport and runs the steps:
//   default   the window view as it opens (markers, the next-movement cue);
//   next      the next movement: its row, where it is (on screen or not);
//   watch     "Watch it" (N): the head turns and tracks it; shots over time;
//   bino      binoculars on the watched aircraft: drift measured over 6 s;
//   director  the auto-director (H) left running --director-sec, a shot
//             every 6 s with its state (shot, caption, subject).
// Every run writes PNGs plus report.json (errors, board, marker counts,
// director timeline) into --out.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const port = arg('port', '3134');
const airport = arg('airport', 'KJFK');
const utc = arg('utc', '');
const flags = arg('flags', '');
const settle = Number(arg('settle', '25')) * 1000;
const width = Number(arg('width', '1440')), height = Number(arg('height', '900'));
const steps = arg('steps', 'default,next,watch,bino,director').split(',');
const directorSec = Number(arg('director-sec', '90'));
const binoMag = Number(arg('mag', '0')); // bino: a fixed magnification (0: whatever raising chooses)
const out = path.resolve(arg('out', `.graphics-review/play-pass/director/${airport}-${utc || 'live'}${flags ? '-' + flags.replace(/[^A-Za-z0-9]+/g, '_') : ''}`));
const url = `http://localhost:${port}/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on${flags ? `&flags=${flags}` : ''}`;
fs.mkdirSync(out, { recursive: true });
const report = { airport, url, utc, flags, errors: [], shadersErrors: [], shots: [], steps: {} };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text().slice(0, 400);
    report.errors.push('console: ' + text);
    if (/shader|WebGLProgram|GL_INVALID/i.test(text)) report.shadersErrors.push(text);
  });
  const shot = async (name) => {
    const file = path.join(out, name + '.png');
    await page.screenshot({ path: file });
    report.shots.push(file);
    console.log('shot', file);
  };
  // What the overlay is drawing and what the director knows, this instant.
  const state = () => page.evaluate(() => {
    const r = window.__fly, w = r.airportWatch, p = r.loungePicker, d = w?.director;
    const b = w?.board?.();
    return {
      selected: w?.selected, tracking: w?.tracking, binocular: w?.binocular, mag: w && +w.optics.mag.toFixed(2),
      hits: p?.hits?.length ?? null, onScreen: p?.hits?.filter((h) => h.onScreen).length ?? null, drawn: p?.drawnMarks ?? null,
      board: b && { arrivals: b.arrivals.slice(0, 4).map((x) => `${x.label} ${x.phaseLabel} ${x.etaS != null ? Math.round(x.etaS) + 's' : ''}`), departures: b.departures.slice(0, 3).map((x) => `${x.label} ${x.phaseLabel}`), ground: b.ground.length },
      director: d ? d.snapshot() : null,
      lockError: w?.lockError ? +(w.lockError() * 180 / Math.PI).toFixed(3) : null,
    };
  });
  try {
    await page.addInitScript(([utcHour]) => {
      window.__flyVisualsOverride = 'enhanced';
      if (utcHour !== '') { const d = new Date(); window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(utcHour)); }
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
    }, [utc]);
    await page.goto(url, { timeout: 300000 });
    await page.waitForFunction(() => window.__fly?.airportWatch, undefined, { timeout: 300000 });
    await page.evaluate((id) => window.__fly.airportWatch.enter(id), airport);
    await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 300000 });
    await page.waitForTimeout(settle);
    if (steps.includes('default')) {
      await page.evaluate(() => window.__fly.airportWatch.resetLook());
      await page.waitForTimeout(1500);
      await shot('01-default');
      report.steps.default = await state();
    }
    if (steps.includes('next')) {
      report.steps.next = await state();
      await page.waitForTimeout(4000);
      await shot('02-next');
    }
    if (steps.includes('watch')) {
      // N: watch the next movement (the director's one-press watch); flag off: select the first arrival.
      const watched = await page.evaluate(() => {
        const w = window.__fly.airportWatch;
        if (w.director) return w.director.watchNext();
        const b = w.board(), row = b.arrivals[0] || b.departures[0];
        if (row) w.select(row.hex);
        return row?.hex ?? null;
      });
      report.steps.watch = { watched, timeline: [] };
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(i ? 5000 : 2500);
        report.steps.watch.timeline.push(await state());
        await shot(`03-watch-${i + 1}`);
      }
    }
    if (steps.includes('bino')) {
      await page.evaluate((mag) => { const w = window.__fly.airportWatch; if (w.selected && !w.binocular) w.binoculars(true); if (mag) w.setMagnification(mag); }, binoMag);
      const errs = [];
      for (let i = 0; i < 24; i++) {
        await page.waitForTimeout(250);
        const s = await page.evaluate(() => {
          const r = window.__fly, w = r.airportWatch, p = r.loungePicker;
          const hit = p?.hits?.find((h) => h.hex === w.selected);
          return hit ? { dx: Math.round(hit.sx - innerWidth / 2), dy: Math.round(hit.sy - innerHeight / 2), mag: +w.optics.mag.toFixed(1), km: +(hit.dist / 1000).toFixed(2), tracking: w.tracking } : { tracking: w.tracking, selected: w.selected };
        });
        errs.push(s);
        if (i === 11) await shot('04-bino');
      }
      report.steps.bino = errs;
      await shot('05-bino-late');
      await page.evaluate(() => { const w = window.__fly.airportWatch; if (w.binocular) w.binoculars(false); });
    }
    if (steps.includes('keys')) {
      // The real key path (LoungeSurface): N watches, H toggles, any other key or Esc hands back, the walk too.
      const st = () => page.evaluate(() => { const w = window.__fly.airportWatch; return { active: w.active, auto: !!w.director?.auto, session: w.director?.session?.hex ?? null, selected: w.selected, tracking: w.tracking, posture: w.posture }; });
      const keys = {};
      await page.mouse.click(720, 600); // focus the look surface (a click on nothing)
      await page.keyboard.press('n'); await page.waitForTimeout(1500); keys.n = await st();
      await page.keyboard.press('h'); await page.waitForTimeout(2500); keys.h = await st();
      await shot('07-keys-auto');
      await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(300); await page.keyboard.up('ArrowLeft'); keys.arrowHandsBack = await st();
      await page.keyboard.press('h'); await page.waitForTimeout(800); keys.h2 = await st();
      await page.keyboard.press('Escape'); await page.waitForTimeout(500); keys.escHandsBack = await st();
      await page.mouse.click(720, 600);
      await page.keyboard.press('h'); await page.waitForTimeout(800);
      await page.mouse.move(700, 500); await page.mouse.down(); await page.mouse.move(760, 520, { steps: 4 }); await page.mouse.up(); keys.dragHandsBack = await st();
      await page.keyboard.press('h'); await page.waitForTimeout(800);
      await page.keyboard.down('w'); await page.waitForTimeout(900); await page.keyboard.up('w'); await page.waitForTimeout(400); keys.walkHandsBack = await st();
      await shot('08-keys-standing');
      report.steps.keys = keys;
      console.log(JSON.stringify(keys));
    }
    if (steps.includes('director')) {
      const started = await page.evaluate(() => { const w = window.__fly.airportWatch; w.clearSelection(); return w.director ? (w.director.setAuto(true), true) : false; });
      report.steps.director = { started, timeline: [] };
      const n = Math.max(1, Math.round(directorSec / 6));
      for (let i = 0; i < n; i++) {
        await page.waitForTimeout(6000);
        report.steps.director.timeline.push(await state());
        await shot(`06-director-${String(i + 1).padStart(2, '0')}`);
      }
    }
  } catch (e) {
    report.failure = String(e.stack || e);
    console.error(e);
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
