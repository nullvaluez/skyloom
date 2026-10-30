/**
 * SHIP PASS (FLY_SHIP_PASS.md 5.5) — the RELEASE stream's node gate.
 *
 *   node scripts/verify-ship-release.mjs
 *
 * Prints PASS / FAIL rows and "N passed, M failed"; exit 1 on any failure.
 * CRLF is normalized on every source read (the owner's checkout is Windows).
 *
 * Sections:
 *   A  RL-2  Challenge layer: the migration table, flag-off identity against
 *            the W0 tree (940b751) — crashStakesOn(), the daily pick, contract
 *            eligibility and the juice scoring sequence — and the flag-on rules
 *            (calm fresh profile, calm daily pool, buzz dealt only with
 *            Challenge on, no combo chain when calm).
 *   T  RL-11 the title copy.
 *   S  RL-10 the save whitelist and import validation.
 *   (later sections are added as their items land)
 *
 * FLAG-OFF IDENTITY, HOW: each arm runs in its own node process (a flag is
 * resolved once, at module load) with `window.__fly<Flag>Override` pinned and a
 * fake localStorage, and prints a JSON fingerprint. The W0 arm is computed
 * live from `git archive 940b751` when that commit is reachable, and otherwise
 * from GOLDEN below (recorded from the same W0 tree on 2026-10-30), so the gate
 * also runs on a depth-1 CI clone.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
process.removeAllListeners('warning'); // node's MODULE_TYPELESS_PACKAGE_JSON notice on app modules
const W0 = '940b751';
const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16);
const read = (rel, root = ROOT) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// ARM MODE: `--arm --root=<tree> --flags=CHALLENGE_LAYER:on,...` prints one
// JSON fingerprint of the tree's behaviour and exits.
// ---------------------------------------------------------------------------
if (process.argv.includes('--arm')) {
  const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? '';
  const root = arg('root') || ROOT;
  register(pathToFileURL(path.join(root, 'scripts/_node-resolve.mjs')));
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const win = { localStorage: ls };
  for (const pair of arg('flags').split(',').filter(Boolean)) {
    const [name, state] = pair.split(':');
    const pascal = name.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    win[`__fly${pascal}Override`] = { enabled: state === 'on' };
  }
  globalThis.window = win;
  const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  const out = {};
  const contracts = await imp('lib/fly/contracts.js');
  const daily = await imp('lib/fly/daily.js');
  const juice = await imp('lib/fly/juice.js');
  const settings = await imp('lib/fly/fly-settings.js');
  const challenge = await imp('lib/fly/challenge.js');

  // Crash stakes for every storage state a player can be in.
  const stakes = {};
  for (const [label, seed] of Object.entries({ fresh: null, stakes: 'stakes', forgiving: 'forgiving', corrupt: 'x' })) {
    store.clear();
    if (seed) store.set('fly-crash-mode', seed);
    settings.resolveInitialCrashMode();
    stakes[label] = settings.crashStakesOn();
  }
  out.stakes = stakes;

  // The daily pick (400 days) and the pool.
  store.clear();
  challenge.resolveChallenge?.();
  out.dailyIds = contracts.DAILY_TEMPLATE_IDS;
  const day0 = daily.utcDayNumber(Date.UTC(2026, 9, 30));
  out.dailyHash = sha(Array.from({ length: 400 }, (_, d) => daily.pickDaily(day0 + d, contracts.DAILY_TEMPLATE_IDS, 2)));
  out.livingDays = [Date.UTC(2026, 6, 25, 12), Date.UTC(2026, 6, 26, 12)].map((t) =>
    daily.pickDaily(daily.utcDayNumber(t), contracts.DAILY_TEMPLATE_IDS, 2),
  );

  // Contract eligibility across the world contexts Contracts.jsx builds.
  const wxs = [undefined, { found: false }, { found: true, precip: 'rain', precipT: 1, fogT: 1, windX: 20, windZ: 0, overcastT: 1 },
    { found: true, precip: 'none', precipT: 0, fogT: 0, windX: 0, windZ: 0, overcastT: 0 }];
  const ctxs = [];
  for (const mapStyle of ['toy', 'satellite']) for (const sunFrac of [undefined, 0.05, 0.6]) for (const wx of wxs) ctxs.push({ mapStyle, sunFrac, wx });
  const eligible = (t) => ctxs.map((c) => (contracts.contractEligible(t, c) ? 1 : 0)).join('');
  out.eligibleHash = sha(contracts.CONTRACT_TEMPLATES.map((t) => `${t.id}:${eligible(t)}`));
  const buzz = contracts.CONTRACT_TEMPLATES.find((t) => t.id === 'buzz-tower');
  out.buzzDealt = { [challenge.challengeOn() ? 'challenge' : 'calm']: contracts.contractEligible(buzz, ctxs[0]) };
  if (challenge.saveChallenge) {
    challenge.saveChallenge(true);
    out.buzzDealt.afterChallengeOn = contracts.contractEligible(buzz, ctxs[0]);
    challenge.saveChallenge(false);
    out.buzzDealt.afterChallengeOff = contracts.contractEligible(buzz, ctxs[0]);
    out.savedKeys = { challenge: store.get('fly-challenge-v1') ?? null };
    store.clear();
    challenge.resolveChallenge();
  }

  // The juice scoring sequence (the three-argument call every pre-pass caller
  // makes), then the calm variant where the tree supports it.
  const seq = [['nearMiss', 150, 0], ['buzz', 200, 1], ['contract', 100, 2.5], ['spot', 50, 9], ['nearMiss', 150, 9.4], ['touchGo', 250, 9.9], ['spot', 50, 30]];
  const run = (extra) => {
    juice.resetJuice();
    const rows = seq.map(([k, p, t]) => {
      juice.tickCombo(t);
      return extra ? juice.scoreEvent(k, p, t, ...extra) : juice.scoreEvent(k, p, t);
    });
    return { rows, state: { ...juice.getState() } };
  };
  out.juiceHash = sha(run(null));
  if (challenge.resolveChallenge) { // the post-W0 tree (scoreEvent takes `chain`)
    const calm = run([false]);
    out.juiceCalm = { maxCombo: Math.max(...calm.rows.map((r) => r.combo)), maxMult: Math.max(...calm.rows.map((r) => r.mult)), session: calm.state.sessionScore };
  }

  // Challenge resolution for every storage state (the migration table, live).
  if (challenge.resolveChallenge) {
    const res = {};
    for (const [label, seed] of Object.entries({ fresh: {}, stakes: { 'fly-crash-mode': 'stakes' }, forgiving: { 'fly-crash-mode': 'forgiving' }, saved1: { 'fly-challenge-v1': '1' }, saved0: { 'fly-challenge-v1': '0', 'fly-crash-mode': 'stakes' } })) {
      store.clear();
      for (const [k, v] of Object.entries(seed)) store.set(k, v);
      const before = store.get('fly-challenge-v1') ?? null;
      const on = challenge.resolveChallenge();
      const after = store.get('fly-challenge-v1') ?? null;
      res[label] = { on, wrote: after !== before ? after : null };
    }
    store.clear();
    win.__flyChallengeOverride = true;
    res.pinOn = challenge.resolveChallenge();
    win.__flyChallengeOverride = { enabled: false };
    store.set('fly-crash-mode', 'stakes');
    res.pinOffObject = challenge.resolveChallenge();
    delete win.__flyChallengeOverride;
    out.challenge = res;
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
function gate(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function arm(root, flags) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-ship-release.mjs'), '--arm', `--root=${root}`, `--flags=${flags}`], {
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1', NODE_ENV: 'production' },
    timeout: 120000,
    maxBuffer: 16 << 20,
  });
  if (r.status !== 0) throw new Error(`arm ${flags} failed: ${(r.stderr || r.error?.message || '').slice(-800)}`);
  return JSON.parse(r.stdout);
}

/**
 * The W0 behaviour, recorded on 2026-10-30 by running the arm above against
 * `git archive 940b751` (the Ship Pass W0 commit). Used when that commit is
 * not in the clone (CI checks out depth 1).
 */
const GOLDEN = {
  stakes: { fresh: true, stakes: true, forgiving: false, corrupt: true },
  dailyIds: ['spot-3', 'spot-heli', 'overfly-landmarks', 'spot-widebody', 'spot-warbird', 'alt-fl300', 'spot-military', 'buzz-tower', 'touch-go'],
  dailyHash: '2532ee5dbeeb5678',
  eligibleHash: 'fa5f40226c6069e3',
  juiceHash: '2dbc8233bc75b335',
};

function w0Arm() {
  let have = false;
  if (process.env.SHIP_RELEASE_GOLDEN === '1') return { source: 'golden (SHIP_RELEASE_GOLDEN=1)', fp: GOLDEN };
  try {
    execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${W0}^{commit}`], { stdio: 'ignore' });
    have = true;
  } catch {
    have = false;
  }
  if (!have) return { source: 'golden (W0 commit not in this clone)', fp: GOLDEN };
  const dir = mkdtempSync(path.join(tmpdir(), 'ship-release-w0-'));
  try {
    const tar = execFileSync('git', ['-C', ROOT, 'archive', W0, 'lib', 'stores', 'scripts/_node-resolve.mjs', 'package.json'], { maxBuffer: 256 << 20 });
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    // The W0 tree has no RELEASE flags to pin, and its own arm script is this one.
    return { source: `live (git archive ${W0})`, fp: arm(dir, '') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const printGolden = process.argv.includes('--print-golden');
console.log('SHIP PASS RELEASE gate (verify-ship-release)\n');

// === A  RL-2 Challenge layer ==================================================
{
  const w0 = w0Arm();
  if (printGolden) console.log(JSON.stringify(w0.fp, null, 2));
  const off = arm(ROOT, 'CHALLENGE_LAYER:off');
  const on = arm(ROOT, 'CHALLENGE_LAYER:on');
  const W = w0.fp;
  console.log(`[A] Challenge layer (W0 arm: ${w0.source})`);
  gate('A1 flag off: crashStakesOn() for fresh / stakes / forgiving / corrupt storage equals W0', JSON.stringify(off.stakes) === JSON.stringify(W.stakes), JSON.stringify(off.stakes));
  gate('A2 flag off: the daily pool equals W0', JSON.stringify(off.dailyIds) === JSON.stringify(W.dailyIds), off.dailyIds.join(', '));
  gate('A3 flag off: 400 days of daily picks equal W0', off.dailyHash === W.dailyHash, `${off.dailyHash} vs ${W.dailyHash}`);
  gate('A4 flag off: contract eligibility (every template × 24 world contexts) equals W0', off.eligibleHash === W.eligibleHash, `${off.eligibleHash} vs ${W.eligibleHash}`);
  gate('A5 flag off: the juice scoring sequence (combos, multipliers, tallies) equals W0', off.juiceHash === W.juiceHash, `${off.juiceHash} vs ${W.juiceHash}`);
  gate('A6 flag off: challengeOn() is true in every storage state (and ignores the pin)',
    Object.values(off.challenge).every((v) => (typeof v === 'boolean' ? v === true : v.on === true && v.wrote === null)),
    JSON.stringify(off.challenge));
  const c = on.challenge;
  gate('A7 flag on: a fresh profile is calm, and nothing is written', c.fresh.on === false && c.fresh.wrote === null, JSON.stringify(c.fresh));
  gate("A8 flag on: migration — saved 'stakes' turns Challenge on (written '1'), 'forgiving' leaves it off (written '0')",
    c.stakes.on === true && c.stakes.wrote === '1' && c.forgiving.on === false && c.forgiving.wrote === '0', `${JSON.stringify(c.stakes)} ${JSON.stringify(c.forgiving)}`);
  gate('A9 flag on: a saved fly-challenge-v1 wins over the legacy key; the pin wins over both',
    c.saved1.on === true && c.saved0.on === false && c.pinOn === true && c.pinOffObject === false, JSON.stringify({ saved1: c.saved1, saved0: c.saved0, pinOn: c.pinOn, pinOff: c.pinOffObject }));
  gate('A10 flag on: crashes follow Challenge (fresh = no crash; saved stakes = crashes; forgiving = none)',
    on.stakes.fresh === false && on.stakes.stakes === true && on.stakes.forgiving === false && on.stakes.corrupt === false, JSON.stringify(on.stakes));
  const calmPool = W.dailyIds.filter((id) => id !== 'buzz-tower' && id !== 'night-buzz');
  gate('A11 flag on: the daily pool is the calm pool (no tower buzz) for every player',
    JSON.stringify(on.dailyIds) === JSON.stringify(calmPool), on.dailyIds.join(', '));
  gate('A12 flag on: verify-living-contracts DAY_A / DAY_B still draw different pairs',
    on.livingDays[0].join('|') !== on.livingDays[1].join('|'), on.livingDays.map((p) => p.join('+')).join(' vs '));
  gate('A13 flag on: buzz-tower is dealt only with Challenge on',
    on.buzzDealt.calm === false && on.buzzDealt.afterChallengeOn === true && on.buzzDealt.afterChallengeOff === false && on.savedKeys.challenge === '0',
    JSON.stringify(on.buzzDealt));
  gate('A14 flag on: a calm player banks at ×1 with no chain', on.juiceCalm && on.juiceCalm.maxCombo === 0 && on.juiceCalm.maxMult === 1, JSON.stringify(on.juiceCalm));
  gate('A15 flag on: with Challenge on the juice sequence is the W0 sequence', on.juiceHash === W.juiceHash, on.juiceHash);

  // Source contracts the arms cannot see.
  const scene = read('components/fly/FlyScene.jsx');
  gate('A16 FlyScene arms crashes only through crashStakesOn() (the stakes block decides)',
    /enabled:[^\n]*CRASH\.enabled && crashStakesOn\(\)/.test(scene));
  const settings = read('lib/fly/fly-settings.js');
  const block = settings.slice(settings.indexOf('SHIP PASS RELEASE stakes begin'), settings.indexOf('SHIP PASS RELEASE stakes end'));
  gate('A17 the fly-settings stakes block acts only with the layer on', /if \(challengeLayerOn\(\)\) _stakesOn = resolveChallenge\(\);/.test(block) && block.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length === 2);
  const js = read('components/fly/JuiceSystems.jsx');
  gate('A18 JuiceSystems: combos, near-miss, run summary and tower-buzz scoring read challengeOn()',
    /scoreEvent\(kind, basePts, nowSec, challengeOn\(\)\)/.test(js) && /!SESSION\.enabled \|\| !challengeOn\(\)/.test(js) &&
      /if \(!touchGo && !challengeOn\(\)\) return;/.test(js) && /runtime\.escort\?\.source !== 'airport' && challengeOn\(\)/.test(js));
  const rows = read('components/fly/hud/SettingsRows.jsx');
  gate('A19 Settings: the Challenge row keeps the settings-stakes / pause-stakes testids',
    /label="Challenge mode"/.test(rows) && (rows.match(/testid=\{sheet \? 'settings-stakes' : 'pause-stakes'\}/g) || []).length === 4);
  const crash = read('scripts/verify-crash.js');
  const juiceGate = read('scripts/verify-juice.js');
  gate('A20 harness posture: verify-crash and verify-juice pin Challenge on',
    /if \(s !== 'forgiving'\) window\.__flyChallengeOverride = true;/.test(crash) && (juiceGate.match(/window\.__flyChallengeOverride = true;/g) || []).length === 2);
}

// === R  RL-3 PLAYER_SURFACE ON ================================================
{
  console.log('\n[R] One look (PLAYER_SURFACE)');
  const c = read('lib/fly/fly-constants.js');
  const blk = c.slice(c.indexOf('export const PLAYER_SURFACE = {'), c.indexOf('};', c.indexOf('export const PLAYER_SURFACE = {')));
  gate('R1 PLAYER_SURFACE ships enabled:true', /\n  enabled: true,\n/.test(blk));
  // A second boot after the migration: the stored Day / Enhanced simply stay.
  const leg = (saved) => {
    const code = `
      import { register } from 'node:module';
      register(${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts/_node-resolve.mjs')).href)});
      const store = new Map(${JSON.stringify(Object.entries(saved))});
      globalThis.window = { location: { search: '' }, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
      Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false }, configurable: true });
      const imp = (r) => import(${JSON.stringify(pathToFileURL(ROOT).href)} + '/' + r);
      const { resolveInitialMapStyle } = await imp('lib/fly/map-style.js');
      const { resolveInitialVisuals } = await imp('lib/fly/visuals-profile.js');
      const { useFlyStore } = await imp('stores/fly-store.js');
      resolveInitialMapStyle(); resolveInitialVisuals();
      const s = useFlyStore.getState();
      process.stdout.write(JSON.stringify({ mapStyle: s.mapStyle, visuals: s.visuals, saved: Object.fromEntries(store) }));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    return JSON.parse(r.stdout || '{}');
  };
  const first = leg({ 'fly-map-style-2': 'toy', 'fly-visuals': 'classic' });
  const second = leg(first.saved || {});
  gate('R2 a saved Neon + Classic player boots Day / Enhanced once, and the next boot stays there',
    first.mapStyle === 'satellite' && first.visuals === 'enhanced' && second.mapStyle === 'satellite' && second.visuals === 'enhanced' &&
      second.saved?.['fly-map-style-2'] === 'satellite' && second.saved?.['fly-visuals'] === 'enhanced',
    JSON.stringify({ first: [first.mapStyle, first.visuals], second: [second.mapStyle, second.visuals] }));
}

// === T  RL-11 title copy ======================================================
{
  console.log('\n[T] Title copy');
  const t = read('components/fly/hud/CinemaTitle.jsx');
  gate('T1 the Takeoff & Landing row reads "Real runways, worldwide."', t.includes("desc: 'Real runways, worldwide.'") && !/gate to gate/i.test(t));
  gate("T2 'From the gate' shows only while GATE_TO_GATE is on", /gate: gateToGate\(\)\.enabled === true \? 'From the gate' : null/.test(t));
  gate('T3 the mode row keeps its testid', t.includes("testid: 'title-takeoff-landing'"));
}

// === S  RL-10 save whitelist ==================================================
{
  console.log('\n[S] Save whitelist');
  register(pathToFileURL(path.join(ROOT, 'scripts/_node-resolve.mjs')));
  const sb = await import(pathToFileURL(path.join(ROOT, 'lib/fly/save-backup.mjs')).href);
  const fh = await import(pathToFileURL(path.join(ROOT, 'lib/fly/flight-history.mjs')).href);
  const frame = await import(pathToFileURL(path.join(ROOT, 'lib/fly/frame-api.js')).href);
  const ch = await import(pathToFileURL(path.join(ROOT, 'lib/fly/challenge.js')).href);
  gate('S1 the backup whitelists fly-challenge-v1, fly-frame-rate-v1 and the v2 flight history',
    [ch.CHALLENGE_KEY, frame.FRAME_RATE_KEY, fh.HISTORY_V2_KEY].every((k) => sb.BACKUP_KEYS.includes(k)), [ch.CHALLENGE_KEY, frame.FRAME_RATE_KEY, fh.HISTORY_V2_KEY].join(', '));
  const mem = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
  };
  const row = { v: 2, id: 'h-1', at: 1761800000000, durationSec: 300, aircraft: 'glider', start: 'runway', extra: 'dropped' };
  const src = mem({ 'fly-challenge-v1': '1', 'fly-frame-rate-v1': '30', 'fly-flight-history-v2': JSON.stringify([row]) });
  const b = sb.createBackup(src);
  const dst = mem();
  sb.restoreBackup(dst, b);
  const back = JSON.parse(dst.getItem('fly-flight-history-v2') || '[]');
  gate('S2 export → import round-trips the three new records (history rows re-normalized)',
    dst.getItem('fly-challenge-v1') === '1' && dst.getItem('fly-frame-rate-v1') === '30' && back.length === 1 && back[0].id === 'h-1' && !('extra' in back[0]),
    JSON.stringify({ challenge: dst.getItem('fly-challenge-v1'), rate: dst.getItem('fly-frame-rate-v1'), rows: back.length }));
  const bad = (data) => {
    try {
      sb.parseBackup(JSON.stringify({ format: 'skyloom-guest-backup', version: 1, data }));
      return false;
    } catch {
      return true;
    }
  };
  gate('S3 import rejects a bad Challenge value, an unknown frame-rate mode, and corrupt history',
    bad({ 'fly-challenge-v1': 'yes' }) && bad({ 'fly-frame-rate-v1': '144' }) && bad({ 'fly-flight-history-v2': [{ v: 1 }] }) &&
      bad({ 'fly-flight-history-v2': { rows: [] } }) && bad({ 'fly-flight-history-v2': Array.from({ length: fh.HISTORY_V2_CAP + 1 }, () => row) }));
  gate('S4 the frame-rate whitelist is exactly FRAME\'s cadence modes',
    JSON.stringify(frame.FRAME_CADENCE_MODES) === JSON.stringify(['60', 'display', '30']) && !bad({ 'fly-frame-rate-v1': 'display' }));
}

// === D  RL-4 deep links =========================================================
{
  console.log('\n[D] Deep links (DEEP_LINKS)');
  register(pathToFileURL(path.join(ROOT, 'scripts/_node-resolve.mjs')));
  const DL = await import(pathToFileURL(path.join(ROOT, 'lib/fly/deep-link.mjs')).href);
  const { LOUNGE_AIRPORTS } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/lounge-airports.mjs')).href);
  const { DESTINATIONS } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/destinations.js')).href);
  const { ADVENTURES } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/adventures.mjs')).href);
  const { resolveDestination } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/flight-plan.js')).href);
  const P = DL.parseDeepLink;
  const valid = [
    ['?watch=KJFK', (r) => r.kind === 'watch' && r.airportId === 'KJFK'],
    ['?watch=kjfk', (r) => r.kind === 'watch' && r.airportId === 'KJFK'],
    ['?fly=grand-canyon', (r) => r.kind === 'fly' && r.destinationId === 'grand-canyon' && r.aircraftId === null],
    ['?fly=grand-canyon&aircraft=glider', (r) => r.kind === 'fly' && r.aircraftId === 'glider'],
    ['?at=40.7484,-73.9857', (r) => r.kind === 'at' && r.altFt === 5000 && r.dest.altM === 1524],
    ['?at=46.5,8.0,12000&aircraft=airliner', (r) => r.kind === 'at' && r.altFt === 12000 && r.aircraftId === 'airliner'],
    ['?at=-33.8568%2C151.2153', (r) => r.kind === 'at' && r.lat === -33.8568],
    [`?journey=${ADVENTURES[0].id}`, (r) => r.kind === 'journey' && r.adventureId === ADVENTURES[0].id],
    ['?flags=CHALLENGE&fly=grand-canyon', (r) => r.kind === 'fly'],
  ];
  const vbad = valid.filter(([q, ok]) => { const r = P(q); return !(r?.ok && ok(r)); }).map(([q]) => `${q} → ${JSON.stringify(P(q))?.slice(0, 80)}`);
  gate(`D1 valid links of every kind parse (${valid.length})`, vbad.length === 0, vbad.join(' | '));
  const none = ['', '?', '?flags=-CHALLENGE_LAYER', '?graphicsReview=1&diag=1', null, undefined, 42];
  gate('D2 no link → null (other parameters are not links)', none.every((q) => P(q) === null));
  const junk = [
    '?watch=ZZZZ', '?watch=KJF', '?watch=K JFK', '?fly=atlantis', '?fly=Grand-Canyon', '?journey=nope',
    '?at=91,0', '?at=86,0', '?at=0,181', '?at=0,0,100', '?at=0,0,46000', '?at=0,0,5000.5', '?at=0', '?at=0,0,0,0', '?at=1e2,3', '?at=0x10,1', '?at=NaN,1',
    '?fly=grand-canyon&aircraft=spaceship', '?watch=KJFK&aircraft=glider', '?aircraft=glider', '?fly=grand-canyon&watch=KJFK',
    '?fly=grand-canyon&fly=yosemite', `?fly=${'a'.repeat(600)}`,
    '?fly=<script>alert(1)</script>', '?watch=%3Cimg%20src%3Dx%3E', '?journey=../../etc/passwd', "?fly=grand-canyon'%22;--", '?at=40.7,-73.9,<b>', '?fly=__proto__', '?journey=constructor',
  ];
  const jbad = junk.filter((q) => { const r = P(q); return !(r && r.ok === false && r.kind === 'invalid' && typeof r.reason === 'string'); });
  gate(`D3 invalid, junk, out-of-range and injection links are refused (${junk.length})`, jbad.length === 0, jbad.join(' | '));
  const echo = junk.map((q) => JSON.stringify(P(q))).filter((t) => /<|script|passwd|proto|constructor|alert|img/i.test(t));
  gate('D4 a refusal never echoes what the URL carried', echo.length === 0, echo.slice(0, 3).join(' | '));
  const everyWatch = LOUNGE_AIRPORTS.every((a) => P(`?watch=${a.ident}`)?.airportId === a.id);
  const everyFly = DESTINATIONS.every((d) => P(`?fly=${d.id}`)?.destinationId === d.id);
  const everyJourney = ADVENTURES.every((a) => P(`?journey=${a.id}`)?.adventureId === a.id);
  gate(`D5 every catalog row is linkable (${LOUNGE_AIRPORTS.length} airports, ${DESTINATIONS.length} destinations, ${ADVENTURES.length} journeys)`, everyWatch && everyFly && everyJourney);
  const at = P('?at=27.9881,86.925,30000');
  const atDest = resolveDestination(at.dest);
  gate('D6 an ?at= point resolves as a Free Flight destination (flight-plan validatePoiDest)', !!atDest && atDest.altM === 9144 && atDest.lat === 27.9881, JSON.stringify(atDest && { id: atDest.id, altM: atDest.altM }));
  const base = 'https://skyloom.example';
  const round = [
    { kind: 'watch', airportId: 'KJFK', ident: 'KJFK' }, { kind: 'fly', destinationId: 'grand-canyon', aircraftId: 'glider' },
    { kind: 'at', lat: 46.55, lon: 7.98, altFt: 11000 }, { kind: 'journey', adventureId: ADVENTURES[0].id },
  ];
  const rbad = round.filter((l) => { const url = DL.buildDeepLink(l, base); const r = P(new URL(url).search); return !(url.startsWith(`${base}/?`) && r?.ok && r.kind === l.kind); });
  let throws = false;
  try { DL.buildDeepLink({ kind: 'fly', destinationId: 'atlantis' }, base); } catch { throws = true; }
  gate('D7 Copy link builds URLs the parser accepts, and refuses an unknown place', rbad.length === 0 && throws, rbad.map((l) => l.kind).join(','));
  gate('D8 stripping keeps other parameters and drops every link parameter',
    DL.stripDeepLink('?flags=CHALLENGE&fly=x&aircraft=y&diag=1') === '?flags=CHALLENGE&diag=1' && DL.stripDeepLink('?watch=KJFK') === '');
  // One-shot consumption against a fake window: parsed once, URL cleaned once.
  const calls = [];
  const win = { location: { pathname: '/', search: '?fly=grand-canyon&flags=X', hash: '' }, history: { state: null, replaceState: (s, t, u) => calls.push(u) } };
  const first = DL.consumeDeepLink(win);
  win.location.search = '?fly=yosemite';
  const second = DL.consumeDeepLink(win);
  gate('D9 consumed once: history.replaceState strips the link, a second read is the same answer', first?.destinationId === 'grand-canyon' && second === first && calls.length === 1 && calls[0] === '/?flags=X', JSON.stringify(calls));
  // The pre-mount blocks: flag-gated, bypass pins win, env-injected gates untouched.
  const fd = read('lib/fly/front-door.js');
  const fp = read('lib/fly/flight-plan.js');
  const entry = fd.slice(fd.indexOf('SHIP PASS RELEASE entry begin'), fd.indexOf('SHIP PASS RELEASE entry end'));
  const spawn = fp.slice(fp.indexOf('SHIP PASS RELEASE spawn begin'), fp.indexOf('SHIP PASS RELEASE spawn end'));
  gate('D10 the entry and spawn blocks act only with DEEP_LINKS on, and a harness bypass pin wins',
    /shipPassOn\('DEEP_LINKS'\) && frontDoorOn\(\) && !titleBypassPinned\(\) && consumeDeepLink\(\)/.test(entry) &&
      /shipPassOn\('DEEP_LINKS'\) && flightPlanOn\(\) && env\.title === undefined && !titleBypassPinned\(\)/.test(spawn));
  const host = read('components/fly/hud/DeepLinkHost.jsx');
  gate('D11 the launcher waits for the opening title (the spawn resolves async): only leaving it AFTER it was up stands the link down; it reports __flyDeepLink',
    /if \(s\.screen === 'title'\) sawTitle = true;\s*else if \(sawTitle\) return finish\('', 'stood-down'\);/.test(host) && !/if \(s\.screen !== 'title'\) return finish/.test(host) && /window\.__flyDeepLink = \{/.test(host));
  // React runs a child's effects before its parent's on the mounting commit, so
  // DeepLinkHost's effect body runs BEFORE FlyMode's pre-mount effect consumes
  // the link (measured in the venue: the link was stripped, __flyDeepLink never
  // set). The link must be read on the first interval tick (arm), never in the
  // effect body.
  const body = host.slice(host.indexOf('let link = null;'), host.indexOf('timer = setInterval(step, 500);'));
  gate('D12 the launcher reads the consumed link on its first tick, after FlyMode\'s pre-mount effect (a child effect runs before its parent\'s)',
    /const arm = \(\) => \{\s*link = pendingDeepLink\(\);/.test(host) && /if \(!link && !arm\(\)\) return;/.test(host) &&
      (host.match(/pendingDeepLink\(\)/g) || []).length === 1 && !/^\s*const link = pendingDeepLink\(\)/m.test(host) && body.length > 0);
}

// === N  RL-6 analytics =========================================================
{
  console.log('\n[N] Analytics (ANALYTICS_V2)');
  register(pathToFileURL(path.join(ROOT, 'scripts/_node-resolve.mjs')));
  const A = await import(pathToFileURL(path.join(ROOT, 'lib/fly/analytics.js')).href);
  const S = A.sanitizeEvent;
  gate('N1 unknown events are dropped', [S('page_view', {}), S('__proto__', {}), S('constructor'), S(null), S('Session_Start', {}), S('$pageview', {})].every((x) => x === null));
  const rows = [
    ['mode_entered', { mode: 'free', extra: 1, lat: 40.7 }, { mode: 'free' }],
    ['mode_entered', { mode: 'free flight over my house' }, {}],
    ['deep_link_opened', { kind: '<script>' }, {}],
    ['deep_link_opened', { kind: 'invalid' }, { kind: 'invalid' }],
    ['link_copied', { kind: 'watch', url: 'https://x/?watch=KJFK' }, { kind: 'watch' }],
    ['challenge_toggled', { on: 'yes' }, {}],
    ['challenge_toggled', { on: true }, { on: true }],
    ['client_error', { kind: 'boundary', message: 'TypeError at secret.js', stack: 'x' }, { kind: 'boundary' }],
    ['client_error', { kind: 'oops' }, {}],
    ['perf_summary', { p95_bucket: '<=16.7', stalls_per_min: 1.234, rung: 'ultra-balanced' }, { p95_bucket: '<=16.7', stalls_per_min: 1.2, rung: 'ultra-balanced' }],
    ['perf_summary', { p95_bucket: 'a b c', stalls_per_min: Infinity, rung: 'x'.repeat(40) }, {}],
    ['session_end', { minutes_by_mode: { free: 12.34, watch: 3, hacker: 9, title: -1 }, preset: 'ultra', device_class: 'dgpu', userAgent: 'x' }, { minutes_by_mode: { free: 12.3, watch: 3 }, preset: 'ultra', device_class: 'dgpu' }],
    ['photo_taken', { hires: true, dataUrl: 'data:image/png;base64,AAA' }, { hires: true }],
    ['lounge_movement_watched', { movement: 'arrival', hex: 'a1b2c3', callsign: 'DAL123' }, { movement: 'arrival' }],
    ['adventure_completed', { adventureId: 'alpine-air', medal: 3, location: [1, 2] }, { adventureId: 'alpine-air', medal: 3 }],
    ['pack_interest', { packId: 'wild-earth', answer: 'maybe' }, { packId: 'wild-earth', answer: 'maybe' }],
  ];
  const wrong = rows.filter(([e, p, want]) => JSON.stringify(S(e, p)?.properties) !== JSON.stringify(want)).map(([e, p]) => `${e} ${JSON.stringify(S(e, p))}`);
  gate(`N2 unknown fields, free text and out-of-schema values are dropped (${rows.length} cases)`, wrong.length === 0, wrong.join(' | '));
  const names = Object.keys(A.SCHEMA);
  const spec = ['session_start', 'mode_entered', 'session_end', 'lounge_movement_watched', 'photo_taken', 'deep_link_opened', 'link_copied', 'challenge_toggled', 'perf_summary', 'client_error'];
  const legacy = ['adventure_started', 'adventure_checkpoint', 'adventure_completed', 'adventure_retried', 'reward_claimed', 'return_visit', 'pack_interest'];
  gate('N3 the schema is exactly the RL-6 events plus the pre-pass adventure events', JSON.stringify([...names].sort()) === JSON.stringify([...spec, ...legacy].sort()), names.join(','));
  const w = A.sanitizeWire({ event: 'mode_entered', properties: { mode: 'watch', distinct_id: 'abc', $current_url: 'https://x/?at=1,2', $referrer: 'r', $ip: '1.2.3.4', token: 't' }, timestamp: 1, uuid: 'u' });
  gate('N4 before_send keeps only schema fields and the SDK identity keys (no URL, referrer or IP), GeoIP off',
    JSON.stringify(Object.keys(w.properties).sort()) === JSON.stringify(['$geoip_disable', 'distinct_id', 'mode', 'token']) && w.properties.$geoip_disable === true && A.sanitizeWire({ event: '$pageview', properties: {} }) === null,
    JSON.stringify(w.properties));
  // Consent and flag, each arm in its own process (a flag resolves once).
  const armA = (flag, consent, key) => {
    const code = `
      import { register } from 'node:module';
      register(${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts/_node-resolve.mjs')).href)});
      const store = new Map(${JSON.stringify(consent ? [['fly-analytics-consent', consent]] : [])});
      globalThis.window = { __flyAnalyticsV2Override: { enabled: ${flag} }, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } };
      const A = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib/fly/analytics.js')).href)});
      for (let i = 0; i < 40; i++) { A.track('mode_entered', { mode: 'free' }); A.track('client_error', { kind: 'boundary' }); }
      await new Promise((r) => setTimeout(r, 50));
      process.stdout.write(JSON.stringify(A.analyticsState()));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1', ...(key ? { NEXT_PUBLIC_POSTHOG_KEY: 'phc_test', NEXT_PUBLIC_POSTHOG_HOST: 'http://127.0.0.1:9' } : { NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_PUBLIC_POSTHOG_HOST: '' }) } });
    try { return JSON.parse(r.stdout); } catch { return { error: (r.stderr || '').slice(-300) }; }
  };
  const never = armA(true, null, true);
  const no = armA(true, 'no', true);
  const off = armA(false, 'yes', true);
  const yes = armA(true, 'yes', true);
  gate('N5 without consent (never asked, or "no"), 80 track() calls load nothing and queue nothing — the SDK is never imported',
    never.loading === false && never.client === false && never.queued === 0 && no.loading === false && no.queued === 0, JSON.stringify({ never, no }));
  gate('N6 flag off: track() is the W0 no-op even with consent', off.loading === false && off.queued === 0 && off.on === false, JSON.stringify(off));
  gate('N7 with consent and a configured key, the existing posthog-js integration is what loads (positive control)', yes.loading === true && yes.consent === 'yes', JSON.stringify(yes));
  const src = read('lib/fly/analytics.js');
  const trackBody = src.slice(src.indexOf('export function track('));
  gate('N8 track() checks the flag and consent before sanitizing, queueing or connecting', /if \(!analyticsV2On\(\) \|\| analyticsConsent\(\) !== 'yes'\) return;/.test(trackBody) && trackBody.indexOf("analyticsConsent() !== 'yes'") < trackBody.indexOf('connect()'));
  const aa = read('lib/fly/adventure-analytics.js');
  gate('N9 adventure-analytics is a thin wrapper under the flag (the pre-pass bodies stand with it off)',
    /if\(analyticsV2On\(\)\)return track\(event,data\);/.test(aa) && /if\(analyticsV2On\(\)\)return setConsent\(!!value\);/.test(aa) && aa.includes("const ALLOWED = new Set(['adventure_started'"));
  const adv = read('components/fly/hud/AdventureExperience.jsx');
  gate('N10 pack_interest is emitted from the Wild Earth debrief', /trackAdventure\('pack_interest',\{packId:'wild-earth',answer:value\}\)/.test(adv) && /route\.packId==='wild-earth'&&progress\.interest==null&&<PackInterest\/>/.test(adv));
}

// === P  RL-9 POI letters ========================================================
{
  console.log('\n[P] POI letter heights');
  register(pathToFileURL(path.join(ROOT, 'scripts/_node-resolve.mjs')));
  const G = await import(pathToFileURL(path.join(ROOT, 'lib/fly/poi-ground.js')).href);
  const { Vector3 } = await import('three');
  let raycasts = 0;
  const map = { rootTile: { isTile: false, scale: { z: 1 }, children: [] }, geo2world: (v) => new Vector3(v.x, 0, v.y), worldToLocal: (v) => v };
  const engine = { map, getElevationAt: () => { raycasts++; throw new Error('raycast'); } };
  const none = G.poiGroundAt(engine, -73.98, 40.75);
  gate('P1 a three-tile map is queried through the bucketed ground query, never the raycast (no covering tile → null, no assert path)', none === null && raycasts === 0);
  const poi = {};
  const seq = [[{ elev: 10, tileZ: 8 }, 10], [null, 10], [{ elev: 55, tileZ: 14 }, 55], [{ elev: 12, tileZ: 9 }, 55], [{ elev: NaN, tileZ: 16 }, 55], [{ elev: 57, tileZ: 15 }, 57]];
  const got = seq.map(([g]) => G.mergePoiGround(poi, g));
  gate('P2 each POI keeps its finest answer: coarser or missing tiles never overwrite, a finer tile replaces it', JSON.stringify(got) === JSON.stringify(seq.map(([, w]) => w)) && poi.elevZ === 15, JSON.stringify(got));
  const toy = { getElevationAt: () => 42 };
  gate('P3 an engine without a three-tile map keeps its own getElevationAt', G.poiGroundAt(toy, 0, 0)?.elev === 42);
  const pl = read('components/fly/PoiLetters.jsx');
  gate('P4 PoiLetters samples through refreshPoiElevation and no longer calls getElevationAt', pl.includes('refreshPoiElevation(runtime.engine, poi)') && !pl.includes('getElevationAt('));
  gate('P5 PoiLetters writes no ref during render (the two react-hooks errors)', !/^\s*(pickedRef|styleRef)\.current = /m.test(pl.replace(/useLayoutEffect\(\(\) => \{\n\s*(pickedRef|styleRef)\.current = [^\n]*\n/g, '')));
}

// === M  RL-5 share metadata =====================================================
{
  console.log('\n[M] Share metadata');
  const layout = read('app/layout.js');
  gate('M1 the legacy shadowadsb.app domain is gone; metadataBase comes from NEXT_PUBLIC_SITE_URL',
    !/shadowadsb\.app"/.test(layout) && !/url: "https:\/\/shadowadsb/.test(layout) && /metadataBase: new URL\(SITE_URL\)/.test(layout) && /process\.env\.NEXT_PUBLIC_SITE_URL/.test(layout));
  gate('M2 Open Graph and Twitter carry the 1200×630 card', /images: \[SHARE_IMAGE\]/.test(layout) && /images: \[SHARE_IMAGE\.url\]/.test(layout) && /url: "\/og\/skyloom\.jpg", width: 1200, height: 630/.test(layout));
  const jpg = readFileSync(path.join(ROOT, 'public/og/skyloom.jpg'));
  // JPEG SOF0/SOF2 frame: height then width, big-endian.
  let w = 0, h = 0;
  for (let i = 2; i < jpg.length - 9; ) {
    if (jpg[i] !== 0xff) break;
    const marker = jpg[i + 1], len = jpg.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) { h = jpg.readUInt16BE(i + 5); w = jpg.readUInt16BE(i + 7); break; }
    i += 2 + len;
  }
  gate('M3 public/og/skyloom.jpg is a 1200×630 JPEG', w === 1200 && h === 630, `${w}×${h}`);
  const man = JSON.parse(read('public/manifest.json'));
  const icons = man.icons || [];
  const has = (size) => icons.some((i) => i.sizes === size && existsSync(path.join(ROOT, 'public', i.src)));
  gate('M4 the manifest validates (name, short_name, id, start_url, scope, display, 192 and 512 icons on disk) and leads with the real Earth',
    man.name && man.short_name && man.id === '/' && man.start_url === '/' && man.scope === '/' && ['standalone', 'fullscreen'].includes(man.display) && has('192x192') && has('512x512') &&
      /^Fly the real Earth/.test(man.description) && !/neon/i.test(man.description));
}

// === E  RL-7 entitlement seam ===================================================
{
  console.log('\n[E] Entitlement seam');
  const E = await import(pathToFileURL(path.join(ROOT, 'lib/fly/entitlements.js')).href);
  const CA = await import(pathToFileURL(path.join(ROOT, 'lib/fly/content-access.mjs')).href);
  const O = await import(pathToFileURL(path.join(ROOT, 'lib/fly/offer.mjs')).href);
  gate('E1 currentGrants() grants nothing (frozen [])', Array.isArray(E.currentGrants()) && E.currentGrants().length === 0 && Object.isFrozen(E.currentGrants()));
  const ca = read('lib/fly/content-access.mjs');
  gate('E2 contentAccess() takes its grants from currentGrants() by default', /export function contentAccess\(id,progress=\{\},grants=currentGrants\(\),packs=PACKS\)/.test(ca));
  // Every call site in the app: none may supply its own grants (third argument).
  const files = execFileSync('git', ['-C', ROOT, 'ls-files', 'components', 'lib', 'stores', 'app', 'hooks'], { encoding: 'utf8' }).split('\n').filter((f) => /\.(m?js|jsx)$/.test(f));
  const sites = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/contentAccess\(/g)) {
      if (src.slice(Math.max(0, m.index - 16), m.index).includes('function ')) continue;
      let depth = 0, args = 1, i = m.index + 'contentAccess('.length;
      for (; i < src.length; i++) {
        const ch = src[i];
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
        else if (ch === ',' && depth === 0) args++;
      }
      sites.push({ f, args });
    }
  }
  const own = sites.filter((s) => s.args > 2);
  gate(`E3 every contentAccess call site (${sites.length}) passes grants through the resolver (none supplies its own)`, sites.length >= 8 && own.length === 0, own.map((s) => s.f).join(', '));
  const progress = { rewards: [] };
  const same = Object.keys(CA.CONTENT).every((id) => JSON.stringify(CA.contentAccess(id, progress)) === JSON.stringify(CA.contentAccess(id, progress, [])));
  gate('E4 behaviour unchanged: every content id answers exactly as with grants []', same, `${Object.keys(CA.CONTENT).length} ids`);
  gate('E5 the server seam keeps only known pack ids', JSON.stringify(E.grantsFromList('wild-earth, nope,first-flights,wild-earth,__proto__', CA.PACKS)) === JSON.stringify(['wild-earth', 'first-flights']) && E.grantsFromList(undefined, CA.PACKS).length === 0);
  const offerText = JSON.stringify([O.FREE_CORE, O.SKYLOOM_PASS]);
  gate('E6 the offer is data with no prices, currencies or purchase URLs, and names only real packs',
    !/price|currency|usd|eur|\$|http/i.test(offerText) && O.offerPackIds().length === [...O.FREE_CORE.includes, ...O.SKYLOOM_PASS.includes].filter((x) => x.kind === 'pack').length);
  const route = read('app/api/entitlements/route.js');
  gate('E7 /api/entitlements answers {grants} from the validated server env only, uncached', /grants: grantsFromList\(process\.env\.SKYLOOM_GRANTS, PACKS\)/.test(route) && /no-store/.test(route));
}

// === W  RL-8 offline shell =======================================================
{
  console.log('\n[W] Offline shell (OFFLINE_SHELL)');
  const vm = await import('node:vm');
  const swSrc = read('public/sw.js');
  const ctx = { self: { addEventListener() {}, location: { origin: 'https://skyloom.example' } }, URL, console };
  vm.createContext(ctx);
  vm.runInContext(`${swSrc}\n;globalThis.__probe = { shellCacheable, CACHE, VERSION };`, ctx);
  const { shellCacheable, CACHE } = ctx.__probe;
  const O = 'https://skyloom.example';
  const cases = [
    ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/14/6000/4000', 'no-cors', 'GET', null],
    ['https://tiles.openfreemap.org/planet/20260802/14/4823/6160.pbf', 'cors', 'GET', null],
    ['https://api.adsb.lol/v2/lat/40/lon/-73/dist/50', 'cors', 'GET', null],
    ['https://api.open-meteo.com/v1/forecast?latitude=40', 'cors', 'GET', null],
    ['https://us.i.posthog.com/e/', 'cors', 'POST', null],
    [`${O}/api/aircraft?lat=1&lon=2`, 'cors', 'GET', null],
    [`${O}/api/weather?lat=1&lon=2`, 'cors', 'GET', null],
    [`${O}/api/entitlements`, 'cors', 'GET', null],
    [`${O}/api/aircraft/abc123/photo`, 'cors', 'GET', null],
    [`${O}/sw.js`, 'same-origin', 'GET', null],
    [`${O}/_next/static/chunks/app/page-0123abcd.js`, 'cors', 'GET', 'immutable'],
    [`${O}/_next/static/chunks/app/page-0123abcd.js`, 'cors', 'POST', null],
    [`${O}/models/player-vector-hero-v4.glb`, 'cors', 'GET', 'static'],
    [`${O}/materials/ground/x.bc3`, 'cors', 'GET', 'static'],
    [`${O}/hdri/day.hdr`, 'cors', 'GET', 'static'],
    [`${O}/fonts/x.woff2`, 'cors', 'GET', 'static'],
    [`${O}/data/runways.bin`, 'cors', 'GET', 'static'],
    [`${O}/manifest.json`, 'cors', 'GET', 'static'],
    [`${O}/`, 'navigate', 'GET', 'shell'],
    [`${O}/?fly=grand-canyon`, 'navigate', 'GET', 'shell'],
    [`${O}/somewhere`, 'navigate', 'GET', null],
    ['https://evil.example/models/x.glb', 'cors', 'GET', null],
  ];
  const bad = cases.filter(([u, m, meth, want]) => shellCacheable(u, O, m, meth) !== want).map(([u, m, meth, want]) => `${meth} ${u} → ${shellCacheable(u, O, m, meth)} (want ${want})`);
  gate(`W1 the cache allowlist: first-party static only; never /api, provider tiles, ADS-B, weather, analytics or cross-origin (${cases.length} cases)`, bad.length === 0, bad.join(' | '));
  gate('W2 caches are versioned and an activate drops every older Skyloom cache', /^skyloom-shell-v\d+$/.test(CACHE) && /k\.startsWith\('skyloom-shell-'\) && k !== CACHE/.test(swSrc) && !/cache\.addAll\(.*api/.test(swSrc));
  const OS = await import(pathToFileURL(path.join(ROOT, 'lib/fly/offline-shell.js')).href);
  const act = (o) => OS.offlineShellAction({ on: true, production: true, webdriver: false, pinned: false, supported: true, ...o });
  const table = [
    [{ on: false }, 'unregister'], [{ on: false, production: false }, 'unregister'], [{ production: false }, 'skip'], [{}, 'register'],
    [{ webdriver: true }, 'skip'], [{ webdriver: true, pinned: true }, 'register'], [{ supported: false }, 'skip'], [{ on: false, supported: false }, 'skip'],
  ];
  const tbad = table.filter(([o, want]) => act(o) !== want).map(([o, want]) => `${JSON.stringify(o)} → ${act(o)} (want ${want})`);
  gate('W3 registration is production-only, and the flag off is a kill switch (unregister + delete caches)', tbad.length === 0, tbad.join(' | '));
  const nc = read('next.config.mjs');
  gate('W4 /sw.js is served no-cache with Service-Worker-Allowed: /', /source: '\/sw\.js'[\s\S]{0,200}no-cache, no-store, must-revalidate[\s\S]{0,120}Service-Worker-Allowed/.test(nc));
  const fm = read('components/fly/FlyMode.jsx');
  const mounts = fm.slice(fm.indexOf('SHIP PASS RELEASE mounts begin'), fm.indexOf('SHIP PASS RELEASE mounts end'));
  gate('W5 FlyMode mounts the shell host whatever the flag (so the kill switch runs)', /\n\s*<OfflineShell \/>/.test(mounts));

  // The LIVE handlers, not just the pure allowlist: a fake worker global runs
  // sw.js, then fetch and warm events are dispatched into it.
  const handlers = {};
  const fetched = [];
  const stored = new Map();
  const cache = { match: async (r) => stored.get(typeof r === 'string' ? r : r.url) ?? undefined, put: async (r, res) => void stored.set(typeof r === 'string' ? r : r.url, res), add: async () => {} };
  const ctx2 = {
    self: { addEventListener: (t, fn) => (handlers[t] = fn), location: { origin: O }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async (u) => {
      fetched.push(typeof u === 'string' ? u : u.url);
      return { ok: true, status: 200, type: 'basic', clone() { return this; } };
    },
    URL, console, Response: { error: () => ({ type: 'error' }) },
  };
  vm.createContext(ctx2);
  vm.runInContext(swSrc, ctx2);
  const fetchEvent = (url, mode = 'cors', method = 'GET', headers = {}) => {
    let responded = false;
    handlers.fetch({ request: { url, mode, method, headers: { has: (h) => h in headers } }, respondWith: () => (responded = true), waitUntil() {} });
    return responded;
  };
  const live = [
    [`${O}/api/aircraft?lat=1`, false], [`${O}/api/weather`, false], ['https://server.arcgisonline.com/x/tile/1/2/3', false], ['https://tiles.openfreemap.org/planet/1/2/3.pbf', false],
    [`${O}/_next/static/chunks/main-abc.js`, true], [`${O}/models/x.glb`, true], [`${O}/`, true, 'navigate'], [`${O}/sw.js`, false],
  ];
  const lbad = live.filter(([u, want, m]) => fetchEvent(u, m) !== want).map(([u, want]) => `${u} intercepted=${!want}`);
  lbad.push(...(fetchEvent(`${O}/models/x.glb`, 'cors', 'GET', { range: 'bytes=0-1' }) ? ['a ranged read was intercepted'] : []));
  gate('W6 the live fetch handler answers only allowlisted requests (an /api, tile or ranged request falls through to the network untouched)', lbad.length === 0, lbad.join(' | '));
  await new Promise((r) => setTimeout(r, 20)); // let W6's responses settle, then count only the warm
  fetched.length = 0;
  stored.clear();
  let warmDone = null;
  handlers.message({ data: { type: 'warm', urls: [`${O}/_next/static/chunks/app-1.js`, `${O}/api/aircraft?x=1`, 'https://evil.example/_next/static/x.js', `${O}/models/m.glb`, `${O}/somewhere`, `${O}/sw.js`, 42] }, waitUntil: (p) => (warmDone = p) });
  await warmDone;
  const warmWant = [`${O}/_next/static/chunks/app-1.js`, `${O}/models/m.glb`];
  gate('W7 the first visit warms the cache through the same allowlist (no /api, cross-origin or page URLs)', JSON.stringify(fetched) === JSON.stringify(warmWant) && [...stored.keys()].every((k) => warmWant.includes(k)), JSON.stringify(fetched));
  // The kill switch retires the worker first: an unregistered worker still
  // serves the pages it controls, and its caches.open() would re-create the
  // cache the page deletes (measured in the venue: verify-offline-shell 'kill').
  fetched.length = 0;
  let retireDone = null;
  let ack = null;
  const deleted = [];
  ctx2.caches.keys = async () => ['skyloom-shell-v1', 'other-cache'];
  ctx2.caches.delete = async (k) => (deleted.push(k), true);
  handlers.message({ data: { type: 'retire' }, ports: [{ postMessage: (m) => (ack = m) }], waitUntil: (p) => (retireDone = p) });
  await retireDone;
  const afterRetire = fetchEvent(`${O}/_next/static/chunks/main-abc.js`) || fetchEvent(`${O}/`, 'navigate');
  let warm2 = null;
  handlers.message({ data: { type: 'warm', urls: [`${O}/_next/static/chunks/x.js`] }, waitUntil: (p) => (warm2 = p) });
  await warm2;
  const offlineSrc = read('lib/fly/offline-shell.js');
  gate('W12 retire: the worker deletes only Skyloom caches, acks, then answers and stores nothing; the kill switch retires before it unregisters',
    JSON.stringify(deleted) === '["skyloom-shell-v1"]' && ack === 'retired' && !afterRetire && fetched.length === 0 && /await retireWorker\(r\.active\);\s*if \(await r\.unregister\(\)\) n\+\+;/.test(offlineSrc), JSON.stringify({ deleted, ack, afterRetire, fetched }));
  const constants = read('lib/fly/fly-constants.js');
  const shellBlk = constants.slice(constants.indexOf('export const OFFLINE_SHELL = {'), constants.indexOf('};', constants.indexOf('export const OFFLINE_SHELL = {')));
  gate('W13 OFFLINE_SHELL ships enabled:true (D6: production-only registration, the allowlist and an offline launch measured in the venue)', /\n  enabled: true,\n/.test(shellBlk + '\n'));
  const offline = read('lib/fly/offline-shell.js');
  const host = read('components/fly/hud/OfflineShell.jsx');
  gate('W8 registration waits for the load event and an idle period (never inside the first minute\'s critical path)', /whenIdle\(\(\) => \{\s*syncOfflineShell\(action\)/.test(host) && /readyState === 'complete'/.test(offline) && /addEventListener\('load', go/.test(offline) && /requestIdleCallback\(run, \{ timeout \}\)/.test(offline));
  gate('W9 install hint: touch devices only, the second visit after a completed flight, never installed or dismissed; the browser prompt is captured only for that player', /\['phone', 'tablet'\]\.includes\(deviceClassOf\(\)\)/.test(host) && /touch && !standalone && flewBefore && visit >= 2 && read\(DISMISS_KEY\) !== '1'/.test(host) && /if \(!show\) return cancelSync;[\s\S]*beforeinstallprompt/.test(host) && /data-testid="install-hint"/.test(host));
  const urls = OS.warmUrls(
    { scripts: [{ src: '/_next/static/a.js' }, { src: '' }, { src: 'https://cdn.example/x.js' }], querySelectorAll: () => [{ href: 'http://localhost:3135/_next/static/c.css' }] },
    { getEntriesByType: () => [{ name: 'http://localhost:3135/models/m.glb' }, { name: 'https://tiles.example/1.png' }] },
    'http://localhost:3135',
  );
  const consent = read('components/fly/hud/ConsentPrompt.jsx');
  const ra = read('components/fly/hud/ReleaseAnalytics.jsx');
  const reserveHook = read('components/fly/hud/use-title-credit-reserve.js');
  gate('W11 the install hint and the consent card sit above the title\'s imagery credit (the measured --fly-title-attr-reserve), never on it',
    /--fly-title-attr-reserve/.test(reserveHook) && /title-attribution/.test(reserveHook) && /style=\{\{ bottom: reserve \+ 12 \}\}/.test(host) && /style=\{\{ bottom: reserve \+ 12 \}\}/.test(consent) && !/bottom-\[max\(env\(safe-area-inset-bottom\),1rem\)\]/.test(host + consent));
  gate('N11 the consent prompt is raised on the title only (never mid-flight over a phone\'s stick), after a first completed flight, once per visit, never under automation',
    /s\.consentPrompt && s\.screen === 'title'/.test(consent) && /!prompted && !automation && firstDone && s\.screen === 'title' && analyticsV2On\(\) && analyticsConsent\(\) == null/.test(ra) && /navigator\?\.webdriver === true/.test(ra) && !/completeFirstFlight[\s\S]{0,400}setConsentPrompt/.test(ra.slice(ra.indexOf('const completeFirstFlight'), ra.indexOf('let prompted'))));
  gate('W10 warmUrls offers only same-origin URLs the page already loaded', JSON.stringify(urls) === JSON.stringify(['http://localhost:3135/_next/static/a.js', 'http://localhost:3135/_next/static/c.css', 'http://localhost:3135/models/m.glb']), urls);
}

console.log(`\nverify-ship-release: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
