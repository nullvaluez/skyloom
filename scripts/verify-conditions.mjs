/**
 * CONDITIONS now ships OFF: normal play uses real time and provider weather.
 * Preserve pure legacy helpers for deterministic diagnostic coverage, while
 * checking that the production weather reader ignores historical manual and
 * adventure choices. The browser smoke proves the player controls are absent.
 *
 * THE CONTRACT — the real modules, one process per flag state:
 *  (1) flag off: nothing is offered and nothing changes (no payload, the
 *      legacy sun path, no panel);
 *  (2) the sun clock's precedence: a harness pin, then a curated Adventure,
 *      then the player's pick (landing exactly on the picked LOCAL SOLAR hour,
 *      within 12 h of now), then Live (exactly the real clock);
 *  (3) a time change glides: smoothstep over easeMs, exact at both ends, the
 *      shorter way round midnight, and back to the bit-exact real clock after
 *      returning to Live;
 *  (4) every weather preset lands where it says through the REAL weather
 *      model, and a harness pin and a curated Adventure both outrank it;
 *  (5) the store keeps the pick in [0, 24) and null means Live;
 *  (6) diagnostic sun/UI readers are gated; live weather ignores old picks;
 *  (7) shipping config has no pickers or procedural weather fallback.
 *
 * Run: node scripts/verify-conditions.mjs
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legArg = process.argv.find((a) => a.startsWith('--leg='));

if (legArg) {
  const on = legArg === '--leg=on';
  globalThis.window = { location: { search: '' }, __flyConditionsOverride: { enabled: on } };
  register('./_node-resolve.mjs', import.meta.url);
  const PC = await import('../lib/fly/player-conditions.js');
  const { computeTargets } = await import('../lib/fly/weather-model.js');
  const { adventureWeather, adventureSunTime } = await import('../lib/fly/adventure-environment.mjs');
  const { WEATHER, CONDITIONS } = await import('../lib/fly/fly-constants.js');
  const { useFlyStore } = await import('../stores/fly-store.js');
  const out = { on: PC.conditionsOn() };
  const NOW = Date.UTC(2026, 5, 21, 16, 20); // a fixed instant
  const LON = -83.07; // Ohio
  out.payloadOff = PC.playerWeatherPayload('rain', false);
  if (!on) {
    out.payload = PC.playerWeatherPayload('rain');
    console.log(JSON.stringify(out));
    process.exit(0);
  }

  // (2) precedence
  PC.resetEase();
  const pin = Date.UTC(2026, 0, 2, 3, 4);
  const curated = { mode: 'curated', lon: 8, preset: { localHour: 18.5 } };
  out.pinWins = PC.conditionsSunTime(curated, NOW, pin, LON, 9).tMs === pin;
  out.curatedWins = PC.conditionsSunTime(curated, NOW, undefined, LON, 9).tMs === adventureSunTime(curated, NOW, undefined);
  PC.resetEase();
  out.liveExact = PC.conditionsSunTime(null, NOW, undefined, LON, null).tMs === NOW;
  // a pick, once landed, is exactly that solar hour within 12 h of now
  PC.resetEase();
  PC.conditionsSunTime(null, NOW, undefined, LON, null); // establish the live hour
  const later = NOW + 5000;
  const landed = PC.conditionsSunTime(null, later, undefined, LON, 19.75);
  const after = PC.conditionsSunTime(null, later + 2000, undefined, LON, 19.75);
  out.pickHour = PC.solarHour(after.tMs, LON);
  out.pickNear = Math.abs(after.tMs - (later + 2000)) <= 12 * 3600000;
  out.pickEasingThenLanded = landed.easing === true && after.easing === false;

  // (3) the glide
  PC.resetEase();
  const E = CONDITIONS.easeMs;
  PC.easedHour(10, 10, 0); // settled at 10:00
  const g0 = PC.easedHour(14, 10, 1000).hour;
  const gMid = PC.easedHour(14, 10, 1000 + E / 2).hour;
  const gEnd = PC.easedHour(14, 10, 1000 + E).hour;
  const series = [];
  for (let i = 0; i <= 20; i++) series.push(PC.easedHour(14, 10, 1000 + (E * i) / 20).hour);
  out.glide = { g0, gMid, gEnd, monotone: series.every((v, i) => !i || v >= series[i - 1] - 1e-12) };
  PC.resetEase();
  PC.easedHour(23, 23, 0);
  PC.easedHour(1, 23, 1000);
  out.wrapMid = PC.easedHour(1, 23, 1000 + E / 2).hour; // through midnight, not noon
  // back to Live → exactly the real clock after the glide
  PC.resetEase();
  PC.conditionsSunTime(null, NOW, undefined, LON, 6);
  PC.conditionsSunTime(null, NOW + E + 10, undefined, LON, 6);
  const back0 = PC.conditionsSunTime(null, NOW + E + 20, undefined, LON, null);
  const backEnd = PC.conditionsSunTime(null, NOW + 2 * E + 40, undefined, LON, null);
  out.backToLive = back0.easing === true && backEnd.easing === false && backEnd.tMs === NOW + 2 * E + 40;

  // (4) presets through the real weather model
  const target = (payload) => computeTargets(payload, WEATHER, {});
  const t = Object.fromEntries(PC.WEATHER_PRESETS.map((p) => [p.id, target(adventureWeather(null, PC.playerWeatherPayload(p.id)))]));
  out.presets = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { state: v.state, precip: v.precip, precipT: +v.precipT.toFixed(3), fogT: +v.fogT.toFixed(3), source: v.source }]));
  window.__flyWeatherOverride = 'baseline';
  out.pinBeatsPick = target(adventureWeather(null, PC.playerWeatherPayload('overcast'))).state === 'baseline';
  delete window.__flyWeatherOverride;
  const curEnv = { mode: 'curated', preset: { cloudCoverPct: 5 } };
  out.curatedBeatsPick = target(adventureWeather(curEnv, PC.playerWeatherPayload('overcast'))).state === 'clear';
  out.livePassesThrough = target(adventureWeather(null, PC.playerWeatherPayload(null) ?? { found: true, cloudCoverPct: 70 })).state === 'broken';

  // (5) store
  const st = useFlyStore.getState();
  st.setConditionsHour(25.5);
  const a = useFlyStore.getState().conditionsHour;
  st.setConditionsHour(-1);
  const b = useFlyStore.getState().conditionsHour;
  st.setConditionsHour(null);
  const c = useFlyStore.getState().conditionsHour;
  st.setConditionsWeather('fog');
  const d = useFlyStore.getState().conditionsWeather;
  st.setConditionsWeather(null);
  out.store = { a, b, c, d, e: useFlyStore.getState().conditionsWeather };
  console.log(JSON.stringify(out));
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const leg = (name) =>
  JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
      .trim()
      .split('\n')
      .pop(),
  );
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replaceAll('\r\n','\n');

const off = leg('off');
const scene = read('components/fly/FlyScene.jsx');
check(
  '(1) flag off: no payload, the legacy sun path, no panel',
  !off.on && off.payload === null && off.payloadOff === null && /\} else \{\n\s*t = adventureSunTime\(runtime\.adventureEnvironment,Date\.now\(\),sunPin\);/.test(scene),
  JSON.stringify(off),
);

const on = leg('on');
check(
  '(2) sun precedence: pin, then curated Adventure, then the pick (exact solar hour within 12 h), then Live (the real clock exactly)',
  on.on && on.pinWins && on.curatedWins && on.liveExact && Math.abs(on.pickHour - 19.75) < 1e-9 && on.pickNear && on.pickEasingThenLanded,
  `pick lands at ${on.pickHour?.toFixed(6)} h`,
);
{
  const g = on.glide;
  check(
    '(3) a time change glides: exact ends, smoothstep midpoint, monotone, through midnight, then the exact real clock',
    g.g0 === 10 && Math.abs(g.gMid - 12) < 1e-9 && g.gEnd === 14 && g.monotone && Math.abs(on.wrapMid - 0) < 1e-9 && on.backToLive,
    `10→14: ${g.g0} / ${g.gMid} / ${g.gEnd} · 23→1 midpoint ${on.wrapMid}`,
  );
}
{
  const p = on.presets;
  const ok =
    p.clear.state === 'clear' && p.scattered.state === 'scattered' && p.overcast.state === 'overcast' &&
    p.rain.precip === 'rain' && p.rain.precipT === 1 && p.snow.precip === 'snow' && p.fog.fogT === 1 &&
    Object.values(p).every((v) => v.source === 'player') &&
    on.pinBeatsPick && on.curatedBeatsPick && on.livePassesThrough;
  check('(4) every preset lands through the real weather model; a harness pin and a curated Adventure outrank it', ok, JSON.stringify(p));
}
check(
  '(5) the store wraps the pick into [0, 24); null is Live',
  on.store.a === 1.5 && on.store.b === 23 && on.store.c === null && on.store.d === 'fog' && on.store.e === null,
  JSON.stringify(on.store),
);
{
  const weather = read('hooks/use-fly-weather.js');
  const rows = read('components/fly/hud/SettingsRows.jsx');
  const bar = read('components/fly/hud/PhotoModeBar.jsx');
  const ok =
    /if \(conditionsOn\(\)\) \{[\s\S]{0,400}conditionsSunTime\(runtime\.adventureEnvironment, Date\.now\(\), sunPin, lon, useFlyStore\.getState\(\)\.conditionsHour\)/.test(scene) &&
    /const unsubscribe = conditionsOn\(\)\n\s*\? useFlyStore\.subscribe\(/.test(scene) &&
    !weather.includes('conditionsWeather') &&
    !weather.includes('adventureWeather(') &&
    weather.includes('computeTargets(payload, WEATHER, w.targets)') &&
    rows.includes('const conditionsRow = conditionsOn() && <ConditionsPanel key="conditions" />;') &&
    bar.includes('{conditionsOn() && conditionsOpen && (') &&
    bar.includes('{conditionsOn() && (');
  check('(6) diagnostic time controls stay gated; production weather ignores manual and adventure picks', ok);
}

{
  const { CONDITIONS, WEATHER } = await import('../lib/fly/fly-constants.js');
  check('(7) ordinary players use live conditions, without pickers or invented weather', !CONDITIONS.enabled && WEATHER.fallback === 'baseline');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
