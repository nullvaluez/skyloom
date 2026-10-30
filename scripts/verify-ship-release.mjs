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

console.log(`\nverify-ship-release: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
