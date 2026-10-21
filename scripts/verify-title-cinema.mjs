/**
 * verify-title-cinema: the window-seat title, in node.
 *
 * Server-renders the real CinemaTitle in a child node process (JSX through
 * the loader, stylesheets stubbed) and runs the pure checks there. The cinema
 * title is the only title: no flag gates it (2026-10-21, owner's call).
 *
 *  (1) its tunables live in lib/fly/title-tour.js (TITLE_TOUR), and no flag
 *      named TITLE_CINEMA (or its pin) survives anywhere in the app;
 *  (2) CinemaTitle renders the title root carrying every harness address of
 *      the old title (and its own), and nothing off the title screen;
 *  (3) FlyMode mounts CinemaTitle and no longer mounts the classic TitleScreen
 *      (whose Settings / Credits sheets and wordmark the cinema title reuses);
 *  (4) the tour helpers: the stop list, the stop under a position, stepping,
 *      when the tour may move on by itself, when the shade is down, and the
 *      tape heading against the title camera's own behindAngle;
 *  (5) the boarding pass: the Continue fields for every saved-setup kind and
 *      a journey; the flight number and barcode are stable;
 *  (6) the stylesheet: every rule is under .tcn, reduced motion (the OS pick
 *      and the app's) stands it still, and every shade poster exists;
 *  (7) the UI sounds play through _beep (the effects bus, so the master mute
 *      silences them) and the title asks for them optional-chained.
 *  (8) automation (navigator.webdriver) keeps the tour manual unless a harness
 *      opts in; phones and reduced motion never move it by themselves.
 *  (9) the far-warp overlay draws nothing on the title (the shade owns the
 *      transition) but keeps its readiness hold and bookkeeping.
 *
 * Run: node scripts/verify-title-cinema.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS_URL = pathToFileURL(createRequire(import.meta.url).resolve('typescript')).href;
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// The loader the child runs under: JSX and a stylesheet stub.
const LOADER = `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from '${TS_URL}';
let cfg = {};
export async function initialize(data) { cfg = data; }
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) return { url: 'tcn-stub:css', shortCircuit: true };
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url === 'tcn-stub:css') return { format: 'module', source: 'export default {};', shortCircuit: true };
  if (!url.startsWith('file:')) return nextLoad(url, context);
  const file = fileURLToPath(url.split('?')[0]);
  const rel = path.relative(cfg.root, file).split(path.sep).join('/');
  if (!file.endsWith('.jsx')) return nextLoad(url, context);
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return { format: 'module', source: out, shortCircuit: true };
}
`;

// ---------------------------------------------------------------------------
// CHILD: render the scenes for one arm (and, on, run the pure checks there:
// they need the app's module graph) and print JSON.
async function child(arm) {
  const { register } = await import('node:module');
  register('./_node-resolve.mjs', import.meta.url);
  register(`data:text/javascript,${encodeURIComponent(LOADER)}`, { data: { arm, root: ROOT } });
  globalThis.OffscreenCanvas ??= class {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return null;
    }
  };
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { useFlyStore } = await import('../stores/fly-store.js');
  const { CinemaTitle, continueFields } = await import('../components/fly/hud/CinemaTitle.jsx');
  const h = React.createElement;
  const init = { ...useFlyStore.getInitialState() };
  const at = (state, el) => {
    Object.assign(useFlyStore.getInitialState(), init, state);
    return renderToStaticMarkup(el);
  };
  const title = { screen: 'title', phase: 'flying', mapStyle: 'satellite', settingsOpen: false, creditsOpen: false, logbookOpen: false };
  const out = {
    scenes: {
      cinema: at(title, h(CinemaTitle, { runtime: {} })),
      'cinema-settings': at({ ...title, settingsOpen: true }, h(CinemaTitle, { runtime: {} })),
      'cinema-flight': at({ ...title, screen: 'flight' }, h(CinemaTitle, { runtime: {} })),
    },
  };
  if (arm === 'on') {
    const tour = await import('../lib/fly/title-tour.js');
    const { behindAngle } = await import('../lib/fly/title-camera.js');
    const { DESTINATIONS, destinationById } = await import('../lib/fly/destinations.js');
    const { validateSetup } = await import('../lib/fly/flight-plan.js');
    const { LIVING_AIRPORTS } = await import('../lib/fly/airport-feature-policy.js');
    const noon = Date.UTC(2026, 5, 21, 12, 0, 0); // Greenwich noon: Europe lit, the Pacific dark
    const toy = tour.tourStops({ style: 'toy' });
    const sat = tour.tourStops({ style: 'satellite', now: noon });
    const ids = (l) => l.map((d) => d.id);
    const mh = destinationById('manhattan');
    const heading = [0, 25, 90, 185, 270, 359].map((deg) => tour.orbitHeadingDeg((behindAngle((deg * Math.PI) / 180) * 180) / Math.PI));
    const adv = { id: 'canyon-discovery', aircraftId: 'prop', index: 1 };
    const setups = {
      free: validateSetup({ v: 1, flightMode: 'free', aircraftId: 'bizjet', dest: { id: 'manhattan' }, at: 1 }),
      ops: validateSetup({ v: 1, flightMode: 'ops', aircraftId: 'prop', airportId: 'KOSU', start: 'runway', at: 1 }),
      approach: validateSetup({ v: 1, flightMode: 'ops', aircraftId: 'prop', airportId: 'KOSU', start: 'approach', at: 1 }),
      practice: validateSetup({ v: 1, flightMode: 'ops', aircraftId: 'glider', start: 'practice', at: 1 }),
    };
    out.pure = {
      featured: DESTINATIONS.length,
      toy: ids(toy),
      sat: ids(sat),
      satHasPractice: sat.some((d) => d.id === 'columbus-practice'),
      at: tour.tourIndexAt(toy, mh.lat + 0.02, mh.lon - 0.02),
      far: tour.tourIndexAt(toy, 0, 0),
      nan: tour.tourIndexAt(toy, NaN, 1),
      steps: [tour.tourStep(10, 9, 1), tour.tourStep(10, 0, -1), tour.tourStep(10, -1, 1), tour.tourStep(10, -1, -1), tour.tourStep(0, 0, 1), tour.tourStep(10, 3, 1)],
      heading,
      latlon: tour.formatLatLon(40.7, -74.03),
      light: [-20, -8, -2, 5, 20, 45].map((el) => tour.lightPhrase(Math.sin((el * Math.PI) / 180))?.label),
      fno: [tour.passFlightNo('free:manhattan'), tour.passFlightNo('free:manhattan'), tour.passFlightNo('free:tokyo')],
      bars: [JSON.stringify(tour.passBarcode('x')), JSON.stringify(tour.passBarcode('x')), JSON.stringify(tour.passBarcode('y'))],
      barsFit: tour.passBarcode('free:manhattan', 64).every((b) => b.x >= 0 && b.x + b.w <= 64 && b.w >= 1 && b.w <= 3),
      posters: tour.TOUR_POSTERS,
      route: (() => {
        const M = tour.ROUTE_MAP;
        const ny = { lat: 40.71, lon: -74.01 }, syd = { lat: -33.86, lon: 151.21 }, zrh = { lat: 46.5, lon: 8.0 };
        const inside = (p) => p.x >= 0 && p.x <= M.w && p.y >= 0 && p.y <= M.h;
        const gcA = tour.greatCircle(ny, zrh, 48), gcB = tour.greatCircle(syd, { lat: 37.77, lon: -122.42 }, 48);
        const end = (g, q) => Math.abs(g[0].lat - q[0].lat) < 1e-9 && Math.abs(g[0].lon - q[0].lon) < 1e-9 && Math.abs(g.at(-1).lat - q[1].lat) < 1e-9 && Math.abs(g.at(-1).lon - q[1].lon) < 1e-9;
        const atl = tour.routePath(gcA, M), pac = tour.routePath(gcB, M);
        const coast = tour.coastPath([[-74, 40.7, -70, 42, -66, 44.5], [170, 10, 179, 10, -179, 10, -170, 10]], M);
        return {
          corners: [tour.projectRoute(M.latTop, -180, M), tour.projectRoute(M.latBottom, 179.999, M)].map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
          inside: [ny, syd, zrh].every((q) => inside(tour.projectRoute(q.lat, q.lon, M))),
          ends: end(gcA, [ny, zrh]) && end(gcB, [syd, { lat: 37.77, lon: -122.42 }]),
          n: gcA.length,
          atlMoves: (atl.match(/M/g) || []).length,
          pacMoves: (pac.match(/M/g) || []).length,
          coastMoves: (coast.match(/M/g) || []).length,
        };
      })(),
      advance: {
        base: tour.tourMayAdvance({ auto: true, covered: false, hidden: false, bootReady: true, busy: false, dwellMs: 1000, shownMs: 1000, idleMs: 5000, idleNeedMs: 5000 }),
        manual: tour.tourMayAdvance({ auto: false, covered: false, hidden: false, bootReady: true, busy: false, dwellMs: 1000, shownMs: 1000, idleMs: 5000, idleNeedMs: 5000 }),
        covered: tour.tourMayAdvance({ auto: true, covered: true, hidden: false, bootReady: true, busy: false, dwellMs: 1000, shownMs: 1000, idleMs: 5000, idleNeedMs: 5000 }),
        tab: tour.tourMayAdvance({ auto: true, covered: false, hidden: true, bootReady: true, busy: false, dwellMs: 1000, shownMs: 1000, idleMs: 5000, idleNeedMs: 5000 }),
        boot: tour.tourMayAdvance({ auto: true, covered: false, hidden: false, bootReady: false, busy: false, dwellMs: 1000, shownMs: 1000, idleMs: 5000, idleNeedMs: 5000 }),
        busy: tour.tourMayAdvance({ auto: true, covered: false, hidden: false, bootReady: true, busy: true, dwellMs: 1000, shownMs: 1000, idleMs: 5000, idleNeedMs: 5000 }),
        early: tour.tourMayAdvance({ auto: true, covered: false, hidden: false, bootReady: true, busy: false, dwellMs: 1000, shownMs: 999, idleMs: 5000, idleNeedMs: 5000 }),
        active: tour.tourMayAdvance({ auto: true, covered: false, hidden: false, bootReady: true, busy: false, dwellMs: 1000, shownMs: 1000, idleMs: 4999, idleNeedMs: 5000 }),
      },
      shade: {
        boot: tour.shadeWanted({ bootReady: false, staging: null, now: 0, capMs: 30000 }),
        idle: tour.shadeWanted({ bootReady: true, staging: null, now: 0, capMs: 30000 }),
        streaming: tour.shadeWanted({ bootReady: true, staging: { ready: false, since: 0 }, now: 1000, capMs: 30000 }),
        ready: tour.shadeWanted({ bootReady: true, staging: { ready: true, since: 0 }, now: 1000, capMs: 30000 }),
        launched: tour.shadeWanted({ bootReady: true, staging: { ready: false, launched: true, since: 0 }, now: 1000, capMs: 30000 }),
        capped: tour.shadeWanted({ bootReady: true, staging: { ready: false, since: 0 }, now: 30000, capMs: 30000 }),
      },
      pass: {
        free: continueFields(setups.free, null),
        ops: continueFields(setups.ops, null),
        approach: continueFields(setups.approach, null),
        practice: continueFields(setups.practice, null),
        journey: continueFields(null, adv),
        none: continueFields(null, null),
        setupsValid: Object.values(setups).every(Boolean),
      },
      livingAirports: LIVING_AIRPORTS.enabled === true,
      block: tour.TITLE_TOUR,
    };
  }
  process.stdout.write(JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// PARENT
const armArg = process.argv.find((a) => a.startsWith('--arm='));
if (armArg) {
  await child(armArg.slice(6));
} else {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  };
  const run = (arm) => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--arm=${arm}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new Error(`arm ${arm} failed:\n${r.stderr.slice(-3000)}`);
    return JSON.parse(r.stdout);
  };
  const on = run('on');
  const P = on.pure;

  // (1)
  const block = read('lib/fly/title-tour.js');
  const cinemaSrc = read('components/fly/hud/CinemaTitle.jsx');
  const modeSrc = read('components/fly/FlyMode.jsx');
  const appFiles = (dir) =>
    readdirSync(path.join(ROOT, dir), { recursive: true })
      .map(String)
      .filter((f) => /\.(m?js|jsx|css)$/.test(f) && !f.includes('vendor') && !f.includes('.built.'))
      .map((f) => path.join(dir, f));
  const flagged = ['components', 'lib', 'app', 'stores', 'hooks']
    .filter((d) => existsSync(path.join(ROOT, d)))
    .flatMap(appFiles)
    .filter((f) => /\bTITLE_CINEMA\b|__flyTitleCinemaOverride/.test(read(f)));
  check(
    '(1) the title\'s tunables live in title-tour.js (TITLE_TOUR), and no TITLE_CINEMA flag or pin survives in the app',
    /export const TITLE_TOUR = Object\.freeze\(/.test(block) && /dwellSec:/.test(block) && /capSec:/.test(block) &&
      /const CFG = TITLE_TOUR;/.test(cinemaSrc) && flagged.length === 0 &&
      P.block?.tour?.dwellSec > 0 && P.block?.shade?.capSec > 0 && P.block?.enabled === undefined,
    flagged.join(', '),
  );

  // (2)
  const testids = (html) => new Set([...html.matchAll(/data-testid="([^"]*)"/g)].map((m) => m[1]));
  const c = on.scenes.cinema;
  const want = [
    'title-screen', 'title-fly-here', 'title-explore', 'title-adventures', 'title-takeoff-landing',
    'title-logbook', 'title-settings', 'title-credits', 'title-attribution',
    'title-tour-prev', 'title-tour-next', 'title-hide-ui',
    ...(P.livingAirports ? ['watch-airport'] : []),
  ];
  const got = testids(c);
  const missing = want.filter((t) => !got.has(t));
  check(
    `(2) the cinema root renders every harness address (${want.length}) at the title z, and nothing off the title screen`,
    missing.length === 0 && /class="tcn"/.test(c) && /data-overlay="title"/.test(c) && /data-ready="false"/.test(c) && /z-index:45/.test(c) &&
      on.scenes['cinema-flight'] === '',
    missing.length ? `missing ${missing.join(', ')}` : `${c.length} chars`,
  );
  const ids = [...c.matchAll(/data-testid="([^"]*)"/g)].map((m) => m[1]);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  check('(2b) no harness address appears twice (one Fly here: on the pass when there is no Continue)', dupes.length === 0, dupes.join(', '));
  check('(2c) the Settings sheet opens inside the cinema title (settings-sheet, settings-close)',
    testids(on.scenes['cinema-settings']).has('settings-sheet') && testids(on.scenes['cinema-settings']).has('settings-close'));

  // (3)
  check(
    '(3) FlyMode mounts CinemaTitle and no longer imports or mounts the classic TitleScreen',
    /<CinemaTitle runtime=\{runtime\} \/>/.test(modeSrc) && !/<TitleScreen\b/.test(modeSrc) && !/import \{ TitleScreen \}/.test(modeSrc) &&
      /if \(!FRONT_DOOR\.enabled \|\| screen !== 'title'\) return null;\s*return <CinemaBody/.test(cinemaSrc),
  );

  // (4)
  const stops10 = P.featured - 1;
  check(
    `(4) the tour: every featured stop but the practice field in toy (${P.toy.length}); satellite skips dark nature stops but keeps at least three, never the practice field`,
    P.toy.length === stops10 && !P.toy.includes('columbus-practice') && P.sat.length >= 3 && P.sat.length <= stops10 && !P.satHasPractice &&
      P.sat.includes('swiss-alps') && P.sat.includes('manhattan'),
    `sat@noon ${P.sat.join(',')}`,
  );
  check(
    '(4b) the stop under a position (within 25 km), -1 elsewhere; stepping wraps both ways and enters from -1',
    P.toy[P.at] === 'manhattan' && P.far === -1 && P.nan === -1 && JSON.stringify(P.steps) === JSON.stringify([0, 9, 0, 9, -1, 4]),
    `${P.at} ${P.far} ${P.nan} ${JSON.stringify(P.steps)}`,
  );
  const A = P.advance;
  check(
    '(4c) the tour moves on by itself only on the bare, visible, revealed title, after the dwell and a still moment',
    A.base && !A.manual && !A.covered && !A.tab && !A.boot && !A.busy && !A.early && !A.active,
    JSON.stringify(A),
  );
  const S = P.shade;
  check(
    '(4d) the shade is down through the boot and a live staging, up when ready, launched or past the cap',
    S.boot && !S.idle && S.streaming && !S.ready && !S.launched && !S.capped,
    JSON.stringify(S),
  );
  check(
    '(4e) the heading tape reads the compass heading the title camera looks along (its own behindAngle)',
    JSON.stringify(P.heading.map((v) => Math.round(v * 1e6) / 1e6)) === JSON.stringify([0, 25, 90, 185, 270, 359]),
    JSON.stringify(P.heading),
  );
  check(
    '(4f) the dataview formats: coordinates in degrees and minutes, a light phrase per sun band',
    P.latlon === '40°42′N 74°01′W' && JSON.stringify(P.light) === JSON.stringify(['Night', 'Blue hour', 'Twilight', 'Golden hour', 'Soft daylight', 'High sun']),
    `${P.latlon} · ${P.light.join(', ')}`,
  );
  check(
    '(4g) the route map: the crop spans the plate exactly, places project inside it, great circles keep their endpoints, and a path that crosses the antimeridian (an arc or a coastline) breaks instead of drawing a seam across the map',
    JSON.stringify(P.route.corners) === JSON.stringify([[0, 0], [380, 137]]) && P.route.inside && P.route.ends && P.route.n === 49 &&
      P.route.atlMoves === 1 && P.route.pacMoves === 2 && P.route.coastMoves === 3,
    JSON.stringify(P.route),
  );

  // (5)
  const F = P.pass;
  const fields = (p) => (p ? p.fields.map(([k, v]) => `${k}=${v}`).join(' ') : null);
  check(
    '(5) the Continue pass names the mode, aircraft and place for every saved-setup kind and a journey',
    F.setupsValid && F.none === null &&
      F.free?.label === 'Continue' && fields(F.free) === 'Mode=Free flight Aircraft=Meridian To=Manhattan' &&
      fields(F.ops) === 'Mode=Takeoff Aircraft=Skylark From=KOSU' && /On the runway/.test(F.ops.sub) &&
      fields(F.approach) === 'Mode=Landing Aircraft=Skylark To=KOSU' &&
      fields(F.practice) === 'Mode=Practice Aircraft=Whisper From=KOSU' &&
      fields(F.journey) === 'Mode=Journey Aircraft=Skylark To=Grand Canyon',
    [F.free, F.ops, F.approach, F.practice, F.journey].map(fields).join(' | '),
  );
  check(
    '(5b) the flight number and barcode are stable per pass and differ between passes; bars stay inside the strip',
    P.fno[0] === P.fno[1] && P.fno[0] !== P.fno[2] && /^SKY \d{4}$/.test(P.fno[0]) && P.bars[0] === P.bars[1] && P.bars[0] !== P.bars[2] && P.barsFit,
    P.fno.join(', '),
  );

  // (6)
  const css = read('components/fly/hud/cinema-title.css');
  const menusCss = read('components/fly/hud/cinema-menus.css');
  const selectorsOf = (text) => {
    const body = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const out = [];
    const re = /([^{}]+)\{/g;
    let m;
    while ((m = re.exec(body))) {
      const sel = m[1].trim();
      if (!sel || sel.startsWith('@')) continue;
      out.push(...sel.split(/,(?![^(]*\))/).map((s) => s.trim()));
    }
    return out;
  };
  const selectors = selectorsOf(css);
  const menuSelectors = selectorsOf(menusCss);
  const unscoped = [...selectors, ...menuSelectors].filter((s) => !/\.tcn\b|\.tcn-/.test(s));
  check(
    `(6) every rule in cinema-title.css (${selectors.length} selectors) and cinema-menus.css (${menuSelectors.length}) is under a .tcn class`,
    selectors.length > 50 && menuSelectors.length > 20 && unscoped.length === 0,
    unscoped.slice(0, 5).join(' | '),
  );
  check(
    '(6d) the menus wear the cinema classes (the journeys sheet, the glass pause card)',
    /className='tcn-sheet' style=\{\{'--tcn-photo':/.test(read('components/fly/hud/AdventureExperience.jsx')) &&
      /className="lg lg-pause-scrim tcn-pause"/.test(read('components/fly/PauseMenu.jsx')),
  );
  check(
    '(6b) reduced motion stands it still: the OS pick, the app pick (data-motion="still") and the shade opens without travel',
    /@media \(prefers-reduced-motion:reduce\)\{\s*\.tcn \*/.test(css) && /\.tcn\[data-motion='still'\] \*/.test(css) &&
      /\.tcn\[data-motion='still'\] \.tcn-shade\[data-state='up'\] \.tcn-shade-panel\{transform:none;opacity:0\}/.test(css) &&
      /if \(stillMotion\(\)\) return 'still';/.test(cinemaSrc),
  );
  check(
    '(6e) nothing animates forever, and the lifted shade leaves the compositor (both measured as frame-rate costs on the fixture)',
    // Rules only: the comments may say the word.
    ![css, menusCss].some((t) => /\binfinite\b/.test(t.replace(/\/\*[\s\S]*?\*\//g, ''))) &&
      /\.tcn-shade\[data-state='up'\] \.tcn-shade-panel\{[^}]*visibility:hidden[^}]*visibility 0s linear 1\.4s\}/.test(css),
  );
  const posters = Object.entries(P.posters);
  const absent = posters.filter(([id, url]) => !existsSync(path.join(ROOT, 'public', url)) || !P.toy.includes(id));
  check(`(6c) every shade poster (${posters.length}) is a shipped in-game capture of a tour stop`, posters.length >= 6 && absent.length === 0, absent.map(([id]) => id).join(', '));

  // (7)
  const audio = read('lib/fly/audio-engine.js');
  check(
    '(7) the UI sounds play through _beep (the effects bus, under the master mute); the title asks for them optional-chained',
    /uiFocus\(\) \{\s*this\._beep\(/.test(audio) && /uiConfirm\(\) \{\s*this\._beep\(/.test(audio) &&
      /audio\?\.uiFocus\?\.\(\)/.test(cinemaSrc) && /audio\?\.uiConfirm\?\.\(\)/.test(cinemaSrc),
  );

  // (8)
  check(
    '(8) automation keeps the tour manual (navigator.webdriver, the DEVICE_TIERS rule) unless a harness opts in with __flyTitleTourAuto; phones and reduced motion never auto-advance',
    /navigator\.webdriver !== true\) return true;\s*return typeof window !== 'undefined' && window\.__flyTitleTourAuto === true;/.test(cinemaSrc) &&
      /const auto = !reduced && tourAutoAllowed\(\) && \(isPhone \? TOUR_CFG\.autoPhone === true : TOUR_CFG\.autoDesktop !== false\);/.test(cinemaSrc) &&
      /autoPhone: false/.test(block),
  );

  // (9)
  const warp = read('components/fly/hud/WarpFlash.jsx');
  check(
    '(9) the warp overlay draws nothing while the title is up (the shade owns stage warps) and keeps its hold logic; in flight it is unchanged',
    /const titleUp = useFlyStore\(\(s\) => s\.screen === 'title'\);/.test(warp) &&
      /if \(!stage \|\| titleUp\) return null;/.test(warp) &&
      (warp.match(/titleUp/g) || []).length === 2,
  );

  console.log(`\nVERIFY title-cinema: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
