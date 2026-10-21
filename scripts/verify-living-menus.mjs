/**
 * Living World UI-MENUS — verify-living-menus: MENU_GLASS and TITLE_MOTION.
 *
 * Server-renders the real Pause, Settings, Credits and Title components in
 * three arms, each in its own node process:
 *   base  the four menu components as they were at the pass's base commit
 *         (git show LW_MENUS_BASE, default 5ed7486), today's everything else;
 *   off   this tree with both blocks forced off;
 *   on    this tree with both blocks forced on.
 * The blocks are forced in memory by the loader (the constants file on disk
 * is never touched — the R24 harness-hygiene rule).
 *
 *  (1) flag off renders today's markup: every scene, off === base, byte for
 *      byte;
 *  (2) flag on carries the new language (lg- / lwt classes) and flag off
 *      carries none of it;
 *  (3) every data-testid, aria-label, form label and button name of the base
 *      markup is present in the on arm (the harness fleet's addresses);
 *  (4) the blocks are read only through lib/fly/living-world.js, and each
 *      ships enabled:true exactly when its consumer has landed, with its
 *      tunables in its own braces;
 *  (5) title.css keeps every pre-pass line, and every rule this pass added to
 *      it (and every rule in living-glass.css) is scoped to a flag-on class;
 *  (6) reduced motion: both stylesheets stand everything still under
 *      prefers-reduced-motion and under the app's own reduced-motion pick;
 *  (7) the card art is original vector line art (no raster, no external
 *      references) and every file is used.
 *
 * Run: node scripts/verify-living-menus.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.LW_MENUS_BASE || '5ed7486';
const OWNED = [
  'components/fly/PauseMenu.jsx',
  'components/fly/hud/SettingsRows.jsx',
  'components/fly/hud/CreditsPanel.jsx',
  'components/fly/hud/TitleScreen.jsx',
];
// The data: URL loader cannot resolve a bare specifier, so it gets TypeScript's file URL.
const TS_URL = pathToFileURL(createRequire(import.meta.url).resolve('typescript')).href;
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const gitShow = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: ROOT, encoding: 'utf8' }).replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// The loader every arm runs under: JSX, a stylesheet stub, the base arm's
// sources and the forced flag values. Registered as a data: URL so the gate
// is one file.
const LOADER = `
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from '${TS_URL}';
let cfg = {};
export async function initialize(data) { cfg = data; }
const STUB = { 'lwm-stub:css': 'export default {};' };
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) return { url: 'lwm-stub:css', shortCircuit: true };
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.startsWith('lwm-stub:')) return { format: 'module', source: STUB[url], shortCircuit: true };
  if (!url.startsWith('file:')) return nextLoad(url, context);
  const file = fileURLToPath(url.split('?')[0]);
  const rel = path.relative(cfg.root, file).split(path.sep).join('/');
  if (rel === 'lib/fly/fly-constants.js' && cfg.arm !== 'base') {
    let src = readFileSync(file, 'utf8');
    for (const name of ['MENU_GLASS', 'TITLE_MOTION']) {
      const re = new RegExp('(export const ' + name + ' = \\\\{\\\\s*enabled:\\\\s*)(true|false)');
      if (!re.test(src)) throw new Error('verify-living-menus: no ' + name + ' block');
      src = src.replace(re, '$1' + (cfg.arm === 'on'));
    }
    // TITLE_CINEMA replaces the title this gate certifies, so it is pinned OFF
    // in both arms (an absent pin inherits the shipped state);
    // scripts/verify-title-cinema.mjs owns the cinema title.
    src = src.replace(/(export const TITLE_CINEMA = \\{\\s*enabled:\\s*)(true|false)/, '$1false');
    return { format: 'module', source: src, shortCircuit: true };
  }
  if (!file.endsWith('.jsx')) return nextLoad(url, context);
  const source = cfg.arm === 'base' && cfg.owned.includes(rel)
    ? execFileSync('git', ['show', cfg.base + ':' + rel], { cwd: cfg.root, encoding: 'utf8' })
    : readFileSync(file, 'utf8');
  const out = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return { format: 'module', source: out, shortCircuit: true };
}
`;

// ---------------------------------------------------------------------------
// CHILD: render the scenes for one arm and print them as JSON.
async function child(arm) {
  const { register } = await import('node:module');
  register('./_node-resolve.mjs', import.meta.url);
  register(`data:text/javascript,${encodeURIComponent(LOADER)}`, { data: { arm, base: BASE, root: ROOT, owned: OWNED } });
  // A module deep in the title's import graph (the vendored tile plugin) builds
  // a texture at load; node has no OffscreenCanvas, and nothing here draws.
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
  const { PauseMenu } = await import('../components/fly/PauseMenu.jsx');
  const { SettingsRows } = await import('../components/fly/hud/SettingsRows.jsx');
  const { CreditsPanel } = await import('../components/fly/hud/CreditsPanel.jsx');
  const { TitleScreen } = await import('../components/fly/hud/TitleScreen.jsx');
  const init = { ...useFlyStore.getInitialState() };
  const at = (state, el) => {
    Object.assign(useFlyStore.getInitialState(), init, state);
    return renderToStaticMarkup(el);
  };
  const h = React.createElement;
  const flight = { screen: 'flight', phase: 'paused', mapStyle: 'satellite', airportWatch: null };
  const title = { screen: 'title', phase: 'flying', mapStyle: 'satellite', settingsOpen: false, creditsOpen: false, logbookOpen: false };
  const scenes = {
    pause: at(flight, h(PauseMenu, { onExit() {} })),
    'pause-sound-on-ultra': at({ ...flight, soundOn: true, qualityPreset: 'ultra', qualityTier: 'high', encountersEnabled: false }, h(PauseMenu, { onExit() {} })),
    'pause-credits': at({ ...flight, creditsOpen: true }, h(PauseMenu, { onExit() {} })),
    'pause-closed': at({ ...flight, phase: 'flying' }, h(PauseMenu, { onExit() {} })),
    'rows-pause': at(flight, h(SettingsRows, { includeConditions: false })),
    'rows-sheet': at(title, h(SettingsRows, { sheet: true })),
    credits: at(flight, h(CreditsPanel, { onClose() {} })),
    title: at(title, h(TitleScreen, { runtime: {} })),
    'title-settings': at({ ...title, settingsOpen: true }, h(TitleScreen, { runtime: {} })),
    'title-credits': at({ ...title, creditsOpen: true }, h(TitleScreen, { runtime: {} })),
  };
  process.stdout.write(JSON.stringify(scenes));
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
  const arms = { base: run('base'), off: run('off'), on: run('on') };
  const names = Object.keys(arms.base);

  // (1)
  const differ = names.filter((n) => arms.off[n] !== arms.base[n]);
  check(`(1) flag off renders the pre-pass markup byte for byte (${names.length} scenes vs ${BASE})`, differ.length === 0, differ.join(', '));

  // Each block ships ON exactly when its consumer has landed (a flag that
  // reads nothing must not claim the look is on — FLY_LIVING_WORLD.md).
  const titleSrc = read('components/fly/hud/TitleScreen.jsx');
  const consumer = {
    MENU_GLASS: /livingWorldOn\('MENU_GLASS'\)/.test(read('components/fly/hud/LivingGlass.jsx')),
    TITLE_MOTION: /livingWorldOn\('TITLE_MOTION'\)/.test(titleSrc),
  };

  // (2)
  const lgScenes = ['pause', 'pause-credits', 'rows-pause', 'rows-sheet', 'credits', 'title-settings', 'title-credits'];
  const lwtScenes = ['title', 'title-settings', 'title-credits'];
  const offLeak = names.filter((n) => /class="[^"]*\b(lg|lg-[a-z-]+|lwt[a-z-]*)\b/.test(arms.off[n]) || /data-motion=/.test(arms.off[n]));
  const onMissing = [
    ...lgScenes.filter((n) => !/class="[^"]*\blg-/.test(arms.on[n])).map((n) => `${n}: no lg-`),
    ...(consumer.TITLE_MOTION ? lwtScenes : []).filter((n) => !/class="fly-title lwt"/.test(arms.on[n]) || !/lwt-wordmark/.test(arms.on[n])).map((n) => `${n}: no lwt`),
  ];
  check('(2) flag on carries the glass + title-motion classes; flag off carries none', offLeak.length === 0 && onMissing.length === 0, [...offLeak.map((n) => `off leak: ${n}`), ...onMissing].join(' | '));
  check('(2b) the pause card leaves the DOM when unpaused, in both arms', arms.on['pause-closed'] === '' && arms.off['pause-closed'] === '');

  // (3)
  const attrs = (html, attr) => new Set([...html.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map((m) => m[1]));
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const stripHidden = (s) => {
    let prev;
    do {
      prev = s;
      s = s.replace(/<(span|svg|g)\b[^>]*aria-hidden="true"[^>]*>(?:(?!<\1\b)[\s\S])*?<\/\1>/g, '').replace(/<span\b[^>]*aria-hidden="true"[^>]*\/>/g, '');
    } while (s !== prev);
    return s;
  };
  const buttonNames = (html, accessible) =>
    new Set(
      [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, a, inner]) => {
        const label = /aria-label="([^"]*)"/.exec(a);
        if (accessible && label) return decode(label[1]);
        const body = accessible ? stripHidden(inner) : inner;
        return decode(body.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      }),
    );
  const lost = [];
  for (const n of names) {
    for (const attr of ['data-testid', 'aria-label']) for (const v of attrs(arms.base[n], attr)) if (!attrs(arms.on[n], attr).has(v)) lost.push(`${n} ${attr}=${v}`);
    const onNames = buttonNames(arms.on[n], true);
    const onText = buttonNames(arms.on[n], false);
    for (const v of buttonNames(arms.base[n], false)) {
      // A pre-pass button's text is its name: the on arm keeps it as an
      // accessible name (aria-label or visible text) or as its exact text.
      if (v && !onNames.has(v) && !onText.has(v)) lost.push(`${n} button "${v}"`);
    }
  }
  check('(3) every testid, aria-label and button name of the base markup survives with the flags on', lost.length === 0, lost.slice(0, 12).join(' | '));
  const labels = ['Steering sensitivity', 'Invert pitch', 'Master volume', 'Reduced motion: Off', 'Sound: On', 'Close settings', 'Resume'];
  const missingLabels = labels.filter((l) => !Object.values(arms.on).some((html) => html.includes(l)));
  check('(3b) the harness labels (getByLabel / getByRole names) render with the flags on', missingLabels.length === 0, missingLabels.join(', '));
  const lowExact = /<button[^>]*data-testid="settings-quality-low"[^>]*>low<\/button>/.test(arms.on['title-settings']);
  check('(3c) quality keys keep their exact text ("button:text-is(\\"low\\")", verify-logbook)', lowExact);

  // (4)
  const consts = read('lib/fly/fly-constants.js');
  const block = (name) => (consts.match(new RegExp(`export const ${name} = \\{[\\s\\S]*?\\n\\};`)) || [''])[0];
  const mine = [...OWNED, 'components/fly/hud/LivingGlass.jsx'].map(read).join('\n');
  const direct = /import\s*\{[^}]*\b(MENU_GLASS|TITLE_MOTION)\b[^}]*\}\s*from\s*['"][^'"]*fly-constants/.test(mine);
  check('(4) the blocks are read only through living-world.js', !direct && consumer.MENU_GLASS);
  const ships = (name, tunable) => (consumer[name] ? /enabled: true/.test(block(name)) && tunable.test(block(name)) : /enabled: false/.test(block(name)));
  check(
    `(4b) a block ships ON iff its consumer has landed (MENU_GLASS ${consumer.MENU_GLASS ? 'on' : 'off'}, TITLE_MOTION ${consumer.TITLE_MOTION ? 'on' : 'off'}), tunables in its own braces`,
    ships('MENU_GLASS', /exitMs:/) && ships('TITLE_MOTION', /settleMs:/),
  );

  // (5)
  const titleCss = read('components/fly/hud/title.css');
  const baseTitleCss = gitShow('components/fly/hud/title.css');
  const baseLines = baseTitleCss.split('\n').filter((l) => l.trim());
  const nowLines = new Set(titleCss.split('\n'));
  const gone = baseLines.filter((l) => !nowLines.has(l));
  check('(5) title.css keeps every pre-pass line verbatim', gone.length === 0, gone.slice(0, 3).join(' | '));
  const selectorsOf = (css) => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
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
  const added = titleCss.slice(baseTitleCss.length);
  const unscopedTitle = selectorsOf(added).filter((s) => !/\.lwt\b|\.lwt-/.test(s));
  const glassCss = read('components/fly/hud/living-glass.css');
  const unscopedGlass = selectorsOf(glassCss).filter((s) => !/\.lg\b|\.lg-/.test(s));
  check('(5b) every added title rule is under .lwt; every living-glass rule is under an lg- class', titleCss.startsWith(baseTitleCss) && unscopedTitle.length === 0 && unscopedGlass.length === 0,
    [...unscopedTitle, ...unscopedGlass].slice(0, 6).join(' | '));

  // (6)
  check('(6) reduced motion: prefers-reduced-motion and the in-app pick stand both layers still',
    /prefers-reduced-motion:\s*reduce\)\s*\{\s*\.lg,/.test(glassCss) && /\[data-still\]/.test(glassCss) &&
      (!consumer.TITLE_MOTION ||
        (/prefers-reduced-motion:reduce\)\{\.lwt \*/.test(added) && /\[data-motion='still'\] \*/.test(added) && /stillMotion\(\) \? 'still' : 'enter'/.test(titleSrc))));

  // (7)
  const artDir = 'components/fly/hud/title-art';
  let arts = [];
  try {
    arts = readdirSync(path.join(ROOT, artDir)).filter((f) => f.endsWith('.svg'));
  } catch {
    // no art yet: TITLE_MOTION has not landed
  }
  const badArt = arts.filter((f) => {
    const s = read(`${artDir}/${f}`);
    return /<image|href=|<script|url\((?!#)/.test(s) || !titleCss.includes(`./title-art/${f}`);
  });
  if (consumer.TITLE_MOTION) check(`(7) the ${arts.length} card drawings are pure vector, self-contained and all in use`, arts.length >= 4 && badArt.length === 0, badArt.join(', '));

  console.log(`\nVERIFY living-menus: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
