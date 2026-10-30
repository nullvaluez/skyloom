/**
 * SHIP PASS FRAME — the browser smoke for the FRAME flags (FLY_SHIP_PASS.md
 * 3.5 "a browser smoke on the stream's own port with zero page or shader
 * errors, flag on and off").
 *
 *   FLY_URL=http://localhost:3131 FLY_TILE_FIXTURE=1 node scripts/verify-ship-frame-browser.cjs [--arms=off,on,policy,player] [--style=toy]
 *
 * Arms (each a fresh page, Neon by default — the fastest reveal on the
 * fixture; `--style=satellite` for the Enhanced world). Every arm names all
 * four FRAME flags explicitly (`NAME` / `-NAME`), so it means the same thing
 * whatever the shipped defaults are:
 *   off      every FRAME flag off (the W0 behaviour, the control)
 *   on       SHADER_READY + PACE_ADAPT on, DEVICE_POLICY + ULTRA_SUPERSAMPLE off
 *   policy   all four on
 *   player   as `on`, with navigator.webdriver hidden — against a PRODUCTION
 *            server this is the FR-2 production branch (checkShaderErrors
 *            false); against dev it must stay true.
 *   default  no ?flags at all: the shipped state, read from fly-constants.js
 * Every arm boots with ?diag=1 (DiagFrameTotals owns gl.info, so the
 * census's per-layer sum can be checked against three's whole-frame
 * totals: FR-4's 2%). Per arm it asserts: the boot reveals, zero page
 * errors, zero shader errors in the console, the census is published
 * (programs, layers within 2% of gl.info, texture bytes), and the arm's
 * flag state (governor paceAdapt, registry consumer, frame-rate row in the
 * pause menu). Everything is VENUE evidence (fixture + SwiftShader): no
 * timing here is a device number. Evidence: .graphics-review/ship-pass/frame/.
 */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { bootFly, BOOT_URL } = require('./_boot');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const ARMS = String(args.arms || 'off,on,policy').split(',');
const STYLE = args.style || 'toy';
const OUT = path.resolve('.graphics-review/ship-pass/frame');
mkdirSync(OUT, { recursive: true });

const FRAME_FLAGS = ['SHADER_READY', 'PACE_ADAPT', 'DEVICE_POLICY', 'ULTRA_SUPERSAMPLE'];
const spec = (...on) => FRAME_FLAGS.map((f) => (on.includes(f) ? f : `-${f}`)).join(',');
const FLAGS = {
  off: spec(),
  on: spec('SHADER_READY', 'PACE_ADAPT'),
  policy: spec(...FRAME_FLAGS),
  player: spec('SHADER_READY', 'PACE_ADAPT'),
  default: null,
};
// The shipped defaults (the `default` arm's expectation), read from the source.
const SHIPPED = (() => {
  const src = require('node:fs').readFileSync(path.resolve('lib/fly/fly-constants.js'), 'utf8').replace(/\r\n/g, '\n');
  const out = {};
  for (const f of FRAME_FLAGS) out[f] = new RegExp(`export const ${f} = \\{\\n\\s*enabled: true,`).test(src);
  return out;
})();
/** Is `name` on in this arm (explicit token, else the shipped default)? */
const flagOn = (arm, name) => {
  const toks = (FLAGS[arm] ?? '').split(',').filter(Boolean);
  if (toks.includes(name)) return true;
  if (toks.includes(`-${name}`)) return false;
  return SHIPPED[name];
};

let pass = 0;
let fail = 0;
const rows = [];
const check = (arm, name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  rows.push({ arm, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${arm}] ${name}${detail ? `  — ${detail}` : ''}`);
};

async function runArm(browser, arm) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  const shaderErrors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && /Shader Error|WebGLProgram|shader compile|getProgramInfoLog|VALIDATE_STATUS/i.test(t)) shaderErrors.push(t.slice(0, 300));
  });
  // FR-3: one harness-only registry entry (lib/fly/registry-warm.js REGISTRY_PROBE_KEY).
  await page.addInitScript(() => {
    window.__flyRegistryProbe = true;
  });
  if (arm === 'player') {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    });
  }
  const q = new URLSearchParams({ diag: '1' });
  if (FLAGS[arm]) q.set('flags', FLAGS[arm]);
  const url = `${BOOT_URL.replace(/\/$/, '')}/?${q}`;
  const t0 = Date.now();
  let boot = null;
  try {
    boot = await bootFly(page, { style: STYLE, url, timeoutMs: 900000, settleMs: 6000 });
  } catch (e) {
    errors.push(`boot: ${String(e.message || e).slice(0, 200)}`);
  }
  const bootS = Math.round((Date.now() - t0) / 1000);
  check(arm, 'boot reveals (window.__flyBoot.pct === 100)', boot?.ms != null || (await page.evaluate(() => window.__flyBoot?.pct === 100).catch(() => false)), `${bootS} s`);
  await page.waitForTimeout(4000);
  const s = await page.evaluate(() => {
    const st = window.__flyStats ?? {};
    const c = st.census ?? {};
    const p = c.programs;
    const l = c.layers;
    const m = c.textureBytes;
    const gov = window.__flyGov?.state?.() ?? null;
    return {
      programs: p ? { total: p.total, live: p.live, afterRevealCount: p.afterRevealCount, afterReveal: p.afterReveal.slice(0, 20), worstMs: p.worstMs, linkFailures: p.linkFailures } : null,
      layers: l ? { calls: l.calls, triangles: l.triangles, glCalls: l.glCalls, glTriangles: l.glTriangles, rows: l.rows.slice(0, 12), frame: l.frame } : null,
      tex: m ? { textures: m.textures, mib: m.totalBytes / 1048576, rgba16f: { count: m.rgba16f.count, mib: m.rgba16f.bytes / 1048576, top: m.rgba16f.top }, unknown: m.unknown, uploads: m.uploadEvents.length } : null,
      stalls: c.stalls?.summary?.() ?? null,
      checkShaderErrors: c.shaderErrorsChecked ?? null,
      diag: st.diag ?? null,
      gov,
      prewarm: { warmed: st.prewarm?.warmed, passes: st.prewarm?.passes, error: st.prewarm?.error, published: !!st.prewarm, pending: st.prewarm?.pending, registry: st.prewarmRegistry ?? st.prewarm?.registry ?? null },
      dpr: window.devicePixelRatio,
      tier: window.__flyStore?.getState?.().qualityTier,
      preset: window.__flyStore?.getState?.().qualityPreset,
      frameRateMode: window.__flyStore?.getState?.().frameRateMode,
      devicePolicy: st.devicePolicy ?? null,
      flags: c.flags ?? null,
    };
  });
  if (arm === 'policy') {
    const d = s.devicePolicy;
    check(arm, 'DEVICE_POLICY: the boot benchmark ran inside the hold and chose a start (FR-10)', !!d?.score && !!d?.start?.tier && d.score.ms <= 1600, d ? `class ${d.cls}, score ${JSON.stringify(d.score)}, start ${JSON.stringify(d.start)}; tier ${s.tier}, preset ${s.preset}` : 'absent');
  }
  check(arm, 'zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check(arm, 'zero shader compile/link errors in the console', shaderErrors.length === 0, shaderErrors.slice(0, 2).join(' | '));
  check(arm, 'program census published (FR-1)', !!s.programs && s.programs.total > 0, s.programs ? `${s.programs.total} programs, ${s.programs.afterRevealCount} first used after the reveal, worst first use ${s.programs.worstMs} ms, link failures ${s.programs.linkFailures}` : 'absent');
  const within = s.layers && s.layers.glCalls != null && s.layers.glCalls > 0 ? Math.abs(s.layers.calls - s.layers.glCalls) / s.layers.glCalls : null;
  check(arm, 'layer census matches gl.info within 2% (FR-4)', within != null && within <= 0.02, s.layers ? `census ${s.layers.calls} draws / ${s.layers.triangles} tris vs gl.info ${s.layers.glCalls} / ${s.layers.glTriangles}; top ${s.layers.rows.slice(0, 4).map((r) => `${r.key}:${r.calls}`).join(', ')}` : 'absent');
  check(arm, 'texture + renderbuffer bytes counted, RGBA16F audited (FR-4)', !!s.tex && s.tex.mib > 0, s.tex ? `${s.tex.mib.toFixed(1)} MiB in ${s.tex.textures} textures; RGBA16F ${s.tex.rgba16f.count} (${s.tex.rgba16f.mib.toFixed(1)} MiB); unknown ${s.tex.unknown}` : 'absent');
  const paceOn = flagOn(arm, 'PACE_ADAPT');
  if (s.flags) check(arm, 'the page resolved the arm\'s FRAME flags', FRAME_FLAGS.every((f) => s.flags[f] === flagOn(arm, f)), FRAME_FLAGS.map((f) => `${f}:${+s.flags[f]}`).join(' '));
  if (s.gov) check(arm, `governor PACE_ADAPT ${paceOn ? 'on' : 'off'}`, s.gov.paceAdapt === paceOn, `refresh ${s.gov.refresh}, target ${s.gov.targetFps}, rung ${s.gov.rung}/${s.gov.rungs}, lock ${s.gov.cadenceLock}`);
  const shaderReady = flagOn(arm, 'SHADER_READY');
  check(arm, `prewarm registry consumer ${shaderReady ? 'published' : 'absent'} (FR-3)`, shaderReady ? !!s.prewarm?.registry : !s.prewarm?.registry, s.prewarm?.registry ? JSON.stringify({ entries: s.prewarm.registry.entries, reachable: s.prewarm.registry.reachable, warmed: s.prewarm.registry.warmed, failed: s.prewarm.registry.failed, errors: s.prewarm.registry.errors }) : `prewarm ${JSON.stringify({ ...s.prewarm, flags: s.flags })}`);
  if (shaderReady && s.prewarm?.registry) {
    // The probe entry: seen, judged reachable, queued or compiled, never failed.
    // Compiled pre-reveal on a real GPU; on SwiftShader the boot drain's 3 s
    // budget can run out first and the post-reveal slice never gets a frame
    // fast enough to take it, so "queued" is the venue's honest answer.
    const r = s.prewarm.registry;
    const warmed = (r.warmedKeys ?? []).includes('FRAME:registry-probe');
    check(arm, 'the registry probe entry is seen, reachable and warmed or queued, with no failure (FR-3)', r.entries >= 1 && r.reachable >= 1 && r.failed === 0 && (warmed || r.queued >= 1), `entries ${r.entries}, reachable ${r.reachable}, ${warmed ? 'WARMED' : `not yet warmed (queued ${r.queued}, prewarm pending ${s.prewarm.pending ?? '?'})`}, failed ${r.failed}`);
  }
  if (arm === 'player') {
    // FRAME_PROD=1 when FLY_URL is a `next start` of a production build.
    const prod = process.env.FRAME_PROD === '1';
    check(arm, `checkShaderErrors ${prod ? 'false (production, not automated, SHADER_READY)' : 'true (dev server keeps diagnostics)'} (FR-2)`, s.checkShaderErrors === !prod, `read ${s.checkShaderErrors}`);
  } else if (s.checkShaderErrors != null) {
    check(arm, 'checkShaderErrors stays true under automation (FR-2)', s.checkShaderErrors === true);
  }
  // FR-9: Battery saver / 30 persists, mirrors into the store and re-aims the governor.
  if (paceOn) {
    const m = await page.evaluate(async () => {
      const f = window.__flyFrame;
      if (!f) return null;
      f.setFrameCadence('30');
      await new Promise((r) => setTimeout(r, 3000));
      const out = { stored: localStorage.getItem('fly-frame-rate-v1'), store: window.__flyStore.getState().frameRateMode, mode: f.frameCadence(), target: window.__flyGov?.state?.().targetFps ?? null, refresh: window.__flyGov?.state?.().refresh ?? null };
      f.setFrameCadence('60');
      await new Promise((r) => setTimeout(r, 1500));
      out.back = { stored: localStorage.getItem('fly-frame-rate-v1'), target: window.__flyGov?.state?.().targetFps ?? null };
      return out;
    });
    check(arm, 'frame-rate mode 30 persists (fly-frame-rate-v1), mirrors to the store, re-aims the governor (FR-9)', !!m && m.stored === '30' && m.store === '30' && (m.refresh ? m.target === 30 : true) && m.back.stored === '60', JSON.stringify(m));
  }
  // FR-9: the Frame rate row exists only with PACE_ADAPT (desktop: Match display).
  let row = null;
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);
    row = await page.evaluate(() => !!document.querySelector('[data-testid="pause-frame-rate"],[data-testid="settings-frame-rate"]'));
    await page.keyboard.press('Escape');
  } catch {
    row = null;
  }
  if (row != null) check(arm, `Frame rate settings row ${paceOn ? 'present' : 'absent'} (FR-9)`, row === paceOn, `row ${row}`);
  await page.screenshot({ path: path.join(OUT, `smoke-${arm}-${STYLE}.png`) }).catch(() => {});
  await context.close();
  return { arm, bootS, errors, shaderErrors, ...s };
}

(async () => {
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const results = [];
  try {
    for (const arm of ARMS) results.push(await runArm(browser, arm));
  } finally {
    await browser.close();
  }
  const file = path.join(OUT, `smoke-${STYLE}-${ARMS.join('-')}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), venue: 'cloud container: offline world fixture + SwiftShader; functional evidence only, no device numbers', url: BOOT_URL, style: STYLE, rows, results }, null, 2));
  console.log(`\nwrote ${path.relative(process.cwd(), file)}`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
