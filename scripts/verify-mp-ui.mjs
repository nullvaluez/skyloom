/**
 * MULTIPLAYER — verify-mp-ui: the HUD + signals UI, rendered for real in node
 * (MULTIPLAYER.md; design §8 UI half, §9 chip, §10 settings). No browser, no
 * network, no relay:
 *
 *   node scripts/verify-mp-ui.mjs
 *
 * The components are the app's own .jsx, compiled on load with Next's bundled
 * babel preset-react and rendered with react-dom/server. Two arms, because the
 * flag is read once at module scope (installUrlFlags-before-FlyMode):
 *
 * OFF (this process, shipped constants — the harness fleet's state):
 * (1) mpAvailable() is false; FlyMode calls useFlyMultiplayer(runtime) right
 *     after useFlyWeather and mounts <MpStatusChip> only behind
 *     MP_UI = mpAvailable(), never inside the flight-stats-strip.
 * (2) the settings rows (pause + sheet), the touch actions panel and the
 *     paused menu carry NONE of the multiplayer UI; the help rows are spread
 *     behind MP_HELP, so the arrays are the pre-multiplayer arrays.
 * (3) the toast coalescing text (SpotToast's mergeSignal): one sender, merged
 *     senders, mixed signals; and the routing under React's batching (one
 *     relay batch = several synchronous dispatches, no render between): no
 *     sender lost, never a second card, a stale pending entry restarts.
 *
 * ON (a child process with the URL-flag pin and a wss:// relay URL):
 * (4) the "Fly with others" card in both variants (settings-/pause-multiplayer)
 *     with its one-sentence disclosure.
 * (5) touch signals: absent until the session is online; then exactly
 *     wave / follow / nice / smoke, the three emotes dimmed (aria-disabled,
 *     still focusable) through a live cooldown, smoke pressed from the store.
 * (6) the pause help gains the 4 / 5 / 6 / 7 row.
 * (7) MpStatusChip: every status line, nothing when off / disabled / outside
 *     Free Flight / during an Adventure (touch signals too), and the
 *     disclosure inside its window only.
 *
 * Browser behaviour (layout, keys, the toast stack under load) belongs to
 * verify-mp-browser.js.
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const ON = process.argv[2] === '--on';

// Loader: '@/' + extensionless (the shared hook), then .jsx -> babel and .css
// -> an empty module. SpotToast is loaded with `?expose` to reach mergeSignal,
// routeSignal and showSignal.
const HOOKS = `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});
const babel = req('next/dist/compiled/babel/core');
const presetReact = req('next/dist/compiled/babel/preset-react');
export async function resolve(spec, ctx, next) {
  if (spec.endsWith('.css')) return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (!url.startsWith('file:') || !/\\.jsx(\\?|$)/.test(url)) return next(url, ctx);
  const [u, q] = url.split('?');
  let src = readFileSync(fileURLToPath(u), 'utf8');
  if (q === 'expose') src += '\\nexport { mergeSignal, routeSignal, showSignal };';
  const out = babel.transformSync(src, { filename: fileURLToPath(u), babelrc: false, configFile: false,
    presets: [[presetReact, { runtime: 'automatic' }]], sourceType: 'module' });
  return { format: 'module', source: out.code, shortCircuit: true };
}`;
register('./_node-resolve.mjs', import.meta.url);
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, import.meta.url);

// three-tile's vendored bundle builds an OffscreenCanvas at module scope (the
// paused menu's import graph reaches it); node has none.
globalThis.OffscreenCanvas ??= class {
  getContext() {
    return new Proxy({}, { get: () => () => ({ data: [] }) });
  }
};
if (ON) {
  // The URL-flag pin, exactly what installUrlFlags leaves on window.
  globalThis.window = {
    __flyMultiplayerOverride: { enabled: true, url: 'wss://relay.example/mp' },
    location: { protocol: 'https:', host: 'skyloom.test', search: '' },
    addEventListener() {},
    removeEventListener() {},
  };
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const { default: React, createElement: h } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
// zustand's SERVER snapshot is getInitialState(); these checks drive the live
// store, so render its client snapshot instead.
const useSES = React.useSyncExternalStore;
React.useSyncExternalStore = (sub, get) => useSES(sub, get, get);

const C = (rel) => path.join(ROOT, 'components/fly', rel);
const { mpAvailable } = await import('../lib/fly/mp/mp-flag.js');
const { useMpStore } = await import('../stores/mp-store.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { SettingsRows } = await import(C('hud/SettingsRows.jsx'));
const { TouchActionPanel } = await import(C('hud/TouchActionPanel.jsx'));
const { PauseMenu } = await import(C('PauseMenu.jsx'));
const render = (el) => renderToStaticMarkup(el).replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>');
const runtime = { input: { setBoost() {}, setSpeedPreset() {} } };
const actions = new Proxy({}, { get: () => () => {} });
const panel = () => render(h(TouchActionPanel, { runtime, actions, speedPreset: 'cruise' }));
const paused = () => {
  useFlyStore.setState({ phase: 'paused' });
  return render(h(PauseMenu, { onExit() {} }));
};
const MP_MARKS = /multiplayer|Fly with others|touch-signal|mp-chip|4 \/ 5 \/ 6 \/ 7|👋 Signals/;

if (!ON) {
  const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
  const mode = src('components/fly/FlyMode.jsx');
  const pause = src('components/fly/PauseMenu.jsx');
  check(
    '(1) flag off: mpAvailable() is false; FlyMode mounts the hook after useFlyWeather and the chip only behind MP_UI',
    mpAvailable() === false &&
      /useFlyWeather\(runtime, true\);\s*(\/\/[^\n]*\n\s*)*useFlyMultiplayer\(runtime\);/.test(mode) &&
      /const MP_UI = mpAvailable\(\);/.test(mode) &&
      /\{MP_UI && <MpStatusChip runtime=\{runtime\} \/>\}/.test(mode) &&
      !/MpStatusChip/.test(src('components/fly/hud/FlyHUD.jsx'))
  );
  const rows = render(h(SettingsRows, {})) + render(h(SettingsRows, { sheet: true }));
  const tap = panel();
  const menu = paused();
  check(
    '(2) flag off: settings (pause + sheet), touch actions and the paused menu carry no multiplayer UI',
    !MP_MARKS.test(rows) && !MP_MARKS.test(tap) && !MP_MARKS.test(menu) && /data-testid="touch-pause"/.test(tap) && menu.length > 0,
    `${rows.length + tap.length + menu.length} B rendered`
  );
  check(
    '(2) flag off: both help tables spread their signal row behind MP_HELP only',
    /const MP_HELP = mpAvailable\(\);/.test(pause) &&
      /\.\.\.\(MP_HELP \? \[\['4 \/ 5 \/ 6 \/ 7'/.test(pause) &&
      /\.\.\.\(MP_HELP \? \[\['👋 Signals'/.test(pause)
  );

  const { mergeSignal, routeSignal, showSignal } = await import(`${C('hud/SpotToast.jsx')}?expose`);
  const entry = () => ({ id: 0, signal: true, ms: 3500, senders: new Map() });
  const line = (e) => `${e.label} | ${e.title} | ${e.type}`;
  const one = mergeSignal(entry(), { id: 'p:1', callsign: 'HERON 27', code: 'wave', color: '#38bdf8', distM: 2222, clock: 3 }, 1);
  const a = line(one);
  mergeSignal(one, { id: 'p:2', callsign: 'KESTREL 4', code: 'wave', distM: 900, clock: 9 }, 2);
  mergeSignal(one, { id: 'p:3', callsign: 'OSPREY 9', code: 'wave', distM: 900, clock: 9 }, 3);
  const b = line(one);
  mergeSignal(one, { id: 'p:3', callsign: 'OSPREY 9', code: 'nice', distM: 900, clock: 9 }, 4);
  const c = line(one);
  check(
    '(3) toast text: one sender, three coalesced, then mixed; the first sender keeps the card and its colour',
    a === "👋 pilot | HERON 27 | waves · 1.2 nm 3 o'clock" &&
      b === '👋 pilots | HERON 27 + 2 others | wave' &&
      c === '✦ pilots | HERON 27 + 2 others | signal' &&
      one.senders.size === 3 && one.accent === '#38bdf8' && one.at === 4,
    [a, b, c].join(' / ')
  );

  // Batched setState: updaters queue until commit(), exactly like React
  // between two dispatches of one relay batch (session.js onBatch → onEmote).
  let stack = [];
  const queue = [];
  const setToasts = (u) => queue.push(u);
  const commit = () => {
    for (const u of queue.splice(0)) stack = u(stack);
  };
  const live = { current: null };
  const pend = { current: [] };
  const ids = { current: 0 };
  const sig = (id, callsign, code = 'wave') => ({ id, callsign, code, distM: 900, clock: 9 });
  const route = (d, now) => routeSignal(d, now, live, pend, ids, setToasts);
  const drain = (now) => {
    // the drain's signal branch (SpotToast's drain effect)
    const next = pend.current.shift();
    showSignal(next, now, live);
    setToasts((prev) => [next, ...prev].slice(0, 2));
  };
  route(sig('p:1', 'HERON 27'), 1000);
  drain(1000);
  commit();
  route(sig('p:2', 'KESTREL 4'), 1500);
  route(sig('p:3', 'OSPREY 9'), 1500);
  commit();
  const batch = stack.map((t) => t.title).join();
  // The drain has queued its card; a relay message lands before the render.
  stack = [];
  live.current = null;
  route(sig('p:4', 'TERN 2', 'nice'), 10000);
  drain(10000);
  const raced = route(sig('p:5', 'SWIFT 8', 'nice'), 10010);
  commit();
  const race = `${stack.filter((t) => t.signal).map((t) => t.title).join()} pending ${pend.current.length}`;
  // Both slots busy: HERON waits out the stale window, then KESTREL waves.
  live.current = null;
  route(sig('p:6', 'HERON 27'), 20000);
  route(sig('p:7', 'KESTREL 4'), 23600);
  const restarted = pend.current[0];
  check(
    '(3) toast routing under batching: same-batch senders all land, never a second card, a stale pending entry restarts',
    batch === 'HERON 27 + 2 others' &&
      raced === false && race === 'TERN 2 + 1 other pending 0' &&
      pend.current.length === 1 && restarted.title === 'KESTREL 4' && restarted.senders.size === 1,
    `${batch} / ${race} / ${restarted?.title}`
  );

  // ---- the ON arm, in a fresh process (the flag is read at module scope) ---
  let out = '';
  try {
    out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--on'], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  for (const l of out.split('\n')) {
    const m = l.match(/^__COUNTS__ (\d+) (\d+)$/);
    if (m) {
      pass += Number(m[1]);
      fail += Number(m[2]);
    } else if (/^(PASS|FAIL)/.test(l)) console.log(l);
  }
  if (!/__COUNTS__/.test(out)) check('(4-7) the ON arm ran', false, out.slice(-400));
  console.log(`\nVERIFY mp-ui: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
} else {
  const sheet = render(h(SettingsRows, { sheet: true }));
  const pauseRows = render(h(SettingsRows, {}));
  const sentence =
    'Other pilots see your aircraft, its in-game position and a random callsign. No account, nothing saved, never your real location.';
  check(
    '(4) flag on: "Fly with others" is its own card in both variants, with the disclosure sentence',
    mpAvailable() === true &&
      /<section aria-label="Fly with others"[^>]*><button data-testid="settings-multiplayer"[^>]*>Fly with others: On<\/button>/.test(sheet) &&
      /data-testid="pause-multiplayer"[^>]*>Fly with others: On</.test(pauseRows) &&
      sheet.includes(sentence) &&
      !/<section class="journey-save"[^]*Fly with others/.test(sheet)
  );

  const offline = panel();
  useMpStore.setState({ status: 'online', signalCooldownUntil: performance.now() + 60000, smoke: true });
  const cooling = panel();
  useMpStore.setState({ signalCooldownUntil: performance.now() - 1, smoke: false });
  const ready = panel();
  const ids = [...cooling.matchAll(/data-testid="(touch-signal-[a-z]+)"/g)].map((m) => m[1]);
  check(
    '(5) touch signals: absent until online; then wave / follow / nice / smoke, emotes dim through a cooldown, smoke pressed',
    !/touch-signals/.test(offline) &&
      /<fieldset class="touch-target" data-testid="touch-signals">/.test(cooling) &&
      ids.join() === 'touch-signal-wave,touch-signal-follow,touch-signal-nice,touch-signal-smoke' &&
      (cooling.match(/aria-disabled="true" data-cooling="1"/g) || []).length === 3 &&
      /data-testid="touch-signal-smoke" class="touch-action" aria-pressed="true">/.test(cooling) &&
      !/data-cooling/.test(ready) && /data-testid="touch-signal-smoke" class="touch-action" aria-pressed="false">/.test(ready) &&
      !/touch-signal-[a-z]+"[^>]* disabled/.test(cooling),
    ids.join(' ')
  );
  check(
    '(6) flag on: the pause help gains the signal row',
    /4 \/ 5 \/ 6 \/ 7<\/span><span[^>]*>signals to nearby pilots: wave · follow me · nice · smoke</.test(paused())
  );

  const { MpStatusChip } = await import(C('hud/MpStatusChip.jsx'));
  useFlyStore.setState({ screen: 'flight', flightMode: 'free' });
  const chip = (p) => {
    useMpStore.setState({ enabled: true, callsign: 'HERON 27', color: '#38bdf8', disclosedAt: 0, online: 23, nearby: 2, ...p });
    return render(h(MpStatusChip));
  };
  const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");
  const want = {
    online: '23 online · 2 in range · you are HERON 27',
    connecting: 'Connecting…',
    offline: 'Offline — retrying',
    full: 'Sky is full — retrying',
    outdated: 'Multiplayer was updated — reload',
    replaced: 'Opened in another tab',
  };
  const got = Object.fromEntries(Object.keys(want).map((s) => [s, text(chip({ status: s }))]));
  const nobody = text(chip({ status: 'online', nearby: 0 }));
  const silent = [chip({ status: 'off' }), chip({ status: 'online', enabled: false })];
  useFlyStore.setState({ flightMode: 'ops' });
  silent.push(chip({ status: 'online' }));
  useFlyStore.setState({ flightMode: 'free' });
  const { useAdventureStore } = await import('../stores/adventure-store.js');
  const progress0 = useAdventureStore.getState().progress;
  useAdventureStore.setState({ progress: { ...progress0, active: { id: 'x', status: 'flying' } } });
  silent.push(chip({ status: 'online' }));
  const adventurePanel = panel();
  useAdventureStore.setState({ progress: { ...progress0, active: { id: 'x', status: 'paused' } } });
  const pausedAdventure = chip({ status: 'online' });
  useAdventureStore.setState({ progress: progress0 });
  const fresh = chip({ status: 'online', disclosedAt: performance.now() - 100 });
  const stale = chip({ status: 'online', disclosedAt: performance.now() - 60000 });
  check(
    '(7) chip: every status line; the no-one-nearby call to action; nothing when off, disabled, outside Free Flight or during an Adventure (touch signals too)',
    Object.keys(want).every((s) => got[s] === want[s]) &&
      nobody === 'No one nearby · Atlas (M) shows where pilots are' &&
      silent.length === 4 && silent.every((s) => s === '') &&
      !/touch-signals/.test(adventurePanel) && text(pausedAdventure) === want.online &&
      /data-testid="mp-chip" data-status="online"/.test(chip({ status: 'online' })),
    JSON.stringify(got)
  );
  check(
    '(7) chip: the disclosure ("visible as HERON 27 · Turn off") only inside its window',
    /data-testid="mp-disclosure"/.test(fresh) &&
      text(fresh) === "You're visible to other pilots as HERON 27 ·Turn off" &&
      /data-testid="mp-disclosure-off" aria-label="Turn off flying with others"/.test(fresh) &&
      !/mp-disclosure/.test(stale) && text(stale) === want.online
  );
  console.log(`__COUNTS__ ${pass} ${fail}`);
}
