/* Native Page Visibility + lounge audio lifecycle, in a test-owned headless Chrome.
 * node scripts/verify-native-lounge-visibility.cjs --port 3349 --airport KCMH
 * Optional: --chrome <chrome.exe> --expect-build <id> --timeout-ms 120000 --out <dir>
 * Run only in an assigned GPU slot. No benchmark, screenshots, video, user profile,
 * synthetic visibility events, property overrides, or application source changes.
 * Playwright's normal launch/newContext forces focus/visibility. Its supported
 * connectOverCDP({noDefaults:true}) avoids that override ONLY in the default context.
 * A fresh profile and ephemeral loopback CDP port isolate this child from user tabs.
 * Exit 0: all gates pass; 1: app/setup failure; 2: native visibility unavailable.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('playwright');
const execFileAsync = promisify(execFile);
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const timeoutMs = Number(arg('timeout-ms', '120000'));
if (!Number.isFinite(timeoutMs) || timeoutMs < 20000 || timeoutMs > 240000) throw new Error('--timeout-ms must be 20000..240000');
const out = path.resolve(arg('out', `.graphics-review/living-observatory/native-visibility-${Date.now()}`));
const url = new URL(arg('url', `http://localhost:${arg('port', '3349')}/`));
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('This local acceptance harness requires a loopback application URL');
url.searchParams.set('graphicsReview', '1');
url.searchParams.set('flags', 'LOUNGE_WALK,LOUNGE_PIER,LOUNGE_INSTRUMENTS');
fs.mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), status: 'running', url: url.toString(), airport: arg('airport', 'KCMH'), timeoutMs, noDefaults: true, headless: true, simulatedVisibility: false, checks: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, detail }); save();
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass) throw new Error(name);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class NativeVisibilityUnavailable extends Error {}

function findChrome() {
  const requested = arg('chrome', process.env.CHROME_PATH);
  const candidates = requested ? [requested] : [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map((p) => path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome executable not found; provide --chrome with an installed Chrome binary');
  return path.resolve(found);
}

function servedBuild(html) {
  const chunks = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { chunks.push(JSON.parse(m[1])); } catch { /* Preserve an unrecognized document as unknown. */ }
  }
  return chunks.join('').match(/"b":"([^"\n]+)"/)?.[1] ?? null;
}

// Records real getters and trusted events; this never writes platform properties.
async function observeVisibility(page) {
  await page.evaluate(() => {
    const hiddenGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get;
    const stateGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get;
    const snapshot = () => ({
      hidden: document.hidden, visibilityState: document.visibilityState,
      nativeHidden: hiddenGetter.call(document), nativeState: stateGetter.call(document),
      ownHidden: Object.hasOwn(document, 'hidden'), ownVisibilityState: Object.hasOwn(document, 'visibilityState'),
      focused: document.hasFocus(), at: performance.now(),
      phase: window.__flyStore?.getState().phase ?? null,
      muted: window.__fly?.airportAudio?.base.muted ?? null,
      graph: !!window.__fly?.airportAudio?.graph,
    });
    window.__nativeVisibilityProbe = { events: [], snapshot };
    document.addEventListener('visibilitychange', (event) => window.__nativeVisibilityProbe.events.push({ ...snapshot(), trusted: event.isTrusted }));
  });
}

async function nativeState(page, state) {
  await page.waitForFunction((expected) => {
    const probe = window.__nativeVisibilityProbe, s = probe.snapshot();
    return s.visibilityState === expected && s.nativeState === expected && s.hidden === (expected === 'hidden') && s.nativeHidden === s.hidden && !s.ownHidden && !s.ownVisibilityState && probe.events.some((e) => e.trusted && e.visibilityState === expected && e.nativeState === expected);
  }, state, { polling: 100, timeout: 3500 });
  return page.evaluate(() => ({ ...window.__nativeVisibilityProbe.snapshot(), events: window.__nativeVisibilityProbe.events }));
}

let child, childExit, browser, rootCdp, profile, profileParent, page, cover;
let childEnded = false, stderr = '';
async function run() {
  report.stage = 'launch';
  profileParent = fs.realpathSync(os.tmpdir());
  profile = fs.mkdtempSync(path.join(profileParent, 'skyloom-native-visibility-'));
  report.profile = profile; report.chrome = findChrome();
  const args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1600,1000', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', 'about:blank'];
  report.chromeArgs = args;
  child = spawn(report.chrome, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  report.childPid = child.pid;
  childExit = new Promise((resolve) => { child.once('exit', (code, signal) => { childEnded = true; resolve({ code, signal }); }); child.once('error', (error) => { childEnded = true; resolve({ error: error.message }); }); });
  child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-32000); });
  const endpointFile = path.join(profile, 'DevToolsActivePort');
  const launchDeadline = Date.now() + 15000;
  while (!fs.existsSync(endpointFile)) {
    if (childEnded || Date.now() > launchDeadline) throw new Error('Dedicated Chrome did not publish its own CDP endpoint');
    await delay(50);
  }
  const [port, target] = fs.readFileSync(endpointFile, 'utf8').trim().split(/\r?\n/);
  if (!/^\d+$/.test(port) || !target?.startsWith('/devtools/browser/')) throw new Error('Unexpected dedicated CDP endpoint');
  browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${target}`, { noDefaults: true, isLocal: true, timeout: 10000 });
  report.browserVersion = browser.version();
  rootCdp = await browser.newBrowserCDPSession();
  const context = browser.contexts()[0]; // Do NOT call newContext: it restores focus emulation.
  check('Fresh browser contains only its default context', browser.contexts().length === 1);
  page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => { report.errors.push({ message: error.message, stack: error.stack }); save(); });
  cover = await context.newPage();
  await cover.goto('about:blank');
  const gameCdp = await context.newCDPSession(page), coverCdp = await context.newCDPSession(cover);
  const gameTarget = (await gameCdp.send('Target.getTargetInfo')).targetInfo.targetId;
  const coverTarget = (await coverCdp.send('Target.getTargetInfo')).targetInfo.targetId;
  const gameWindow = await rootCdp.send('Browser.getWindowForTarget', { targetId: gameTarget });
  const coverWindow = await rootCdp.send('Browser.getWindowForTarget', { targetId: coverTarget });
  report.windows = { game: gameWindow, cover: coverWindow };
  check('Both test-owned tabs belong to the same headless window', gameWindow.windowId === coverWindow.windowId);
  report.stage = 'native-visibility-preflight'; save();
  await observeVisibility(page);
  try {
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible', undefined, { timeout: 3500 });
    await cover.bringToFront(); report.preflightHidden = await nativeState(page, 'hidden');
    await page.bringToFront(); report.preflightVisible = await nativeState(page, 'visible');
  } catch (error) {
    report.preflight = await page.evaluate(() => ({ ...window.__nativeVisibilityProbe.snapshot(), events: window.__nativeVisibilityProbe.events }));
    throw new NativeVisibilityUnavailable(`This Chrome build did not provide native tab visibility without emulation: ${error.message}`);
  }
  check('Blank-page preflight has trusted native hidden and visible events', true, { hidden: report.preflightHidden, visible: report.preflightVisible });

  report.stage = 'arrival'; save();
  await page.addInitScript(() => {
    window.__flyVisualsOverride = 'enhanced';
    localStorage.setItem('fly-map-style-2', 'satellite');
    localStorage.setItem('fly-controls-seen', '1');
    localStorage.setItem('fly-sound-on', '0');
    localStorage.setItem('fly-reduced-motion', '1');
  });
  const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  report.servedBuildId = servedBuild(await response.text());
  const expectedBuild = arg('expect-build', null);
  if (expectedBuild) check('Served build matches requested immutable snapshot', report.servedBuildId === expectedBuild, { expectedBuild, servedBuildId: report.servedBuildId });
  await page.waitForFunction(() => !!window.__fly?.airportWatch, undefined, { timeout: 60000 });
  await page.evaluate((airport) => window.__fly.airportWatch.enter(airport), report.airport);
  await page.waitForFunction(() => window.__fly.airportWatch.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 60000 });
  await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 30000 });
  await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
  await page.waitForFunction(() => !!window.__fly.airportAudio?.graph && !window.__fly.airportAudio.base.muted, undefined, { timeout: 12000 });
  await observeVisibility(page);
  report.before = await page.evaluate(() => window.__nativeVisibilityProbe.snapshot());
  check('Visible lounge starts with an unmuted live audio graph', report.before.visibilityState === 'visible' && report.before.phase !== 'paused' && report.before.graph && !report.before.muted, report.before);
  report.stage = 'native-hide'; save();
  await cover.bringToFront();
  report.hidden = await nativeState(page, 'hidden');
  await page.waitForFunction(() => document.hidden && window.__flyStore.getState().phase === 'paused' && window.__fly.airportAudio.base.muted, undefined, { polling: 100, timeout: 3500 });
  check('Native backgrounding pauses and mutes the shared master', true, await page.evaluate(() => window.__nativeVisibilityProbe.snapshot()));
  await page.waitForFunction(() => !window.__fly.airportAudio.graph, undefined, { polling: 200, timeout: 15000 });
  check('Hidden lounge audio graph tears down', true, await page.evaluate(() => window.__nativeVisibilityProbe.snapshot()));
  const toggled = await page.evaluate(() => {
    const state = window.__flyStore.getState(); state.setSoundOn(false); state.setSoundOn(true);
    return window.__nativeVisibilityProbe.snapshot();
  });
  check('Explicit sound toggle while genuinely hidden cannot unmute or reopen audio', toggled.hidden && toggled.phase === 'paused' && toggled.muted && !toggled.graph, toggled);
  report.stage = 'native-return'; save();
  await page.bringToFront(); report.returned = await nativeState(page, 'visible');
  await delay(250);
  const retained = await page.evaluate(() => window.__nativeVisibilityProbe.snapshot());
  check('Native return retains pause and silence until explicit resume', retained.phase === 'paused' && retained.muted && !retained.graph, retained);
  // Explicit runtime resume mirrors the existing interaction harness; visibility
  // itself remains entirely native. This does not certify a lounge Resume UI.
  await page.evaluate((phase) => window.__flyStore.getState().setPhase(phase), report.before.phase);
  await page.waitForFunction(() => !!window.__fly.airportAudio.graph && !window.__fly.airportAudio.base.muted, undefined, { polling: 100, timeout: 12000 });
  check('Explicit runtime resume restores observation audio', true, await page.evaluate(() => window.__nativeVisibilityProbe.snapshot()));
  await page.getByRole('button', { name: 'Mute sound', exact: true }).click();
  await page.waitForFunction(() => !window.__fly.airportAudio.graph, undefined, { polling: 100, timeout: 12000 });
  check('Visible mute tears down audio after resume', true);
  check('No application page exceptions', report.errors.length === 0, report.errors);
}

async function cleanup() {
  report.cleanup = { requested: true };
  if (rootCdp && !childEnded) await Promise.race([rootCdp.send('Browser.close').catch(() => {}), delay(2000)]);
  if (childExit && !childEnded) await Promise.race([childExit, delay(5000)]);
  if (child && !childEnded) {
    // Only the exact child PID/tree belongs to this test. Never kill by image name.
    if (process.platform === 'win32') await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 }).catch((error) => { report.cleanup.killError = error.message; });
    else child.kill('SIGTERM');
    await Promise.race([childExit, delay(3000)]);
  }
  if (browser) await Promise.race([browser.close().catch(() => {}), delay(2000)]);
  report.cleanup.childExited = !child || childEnded;
  if (profile && (!child || childEnded)) {
    const resolved = fs.realpathSync(profile);
    if (path.dirname(resolved) !== profileParent || !path.basename(resolved).startsWith('skyloom-native-visibility-')) throw new Error('Refusing cleanup outside this test-owned temporary profile');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    report.cleanup.profileRemoved = !fs.existsSync(resolved);
  }
  report.chromeStderrTail = stderr;
}

(async () => {
  let timer;
  try {
    await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Bounded ${timeoutMs}ms deadline exceeded during ${report.stage}`)), timeoutMs); })]);
    report.status = 'passed';
  } catch (error) {
    report.status = error instanceof NativeVisibilityUnavailable ? 'unsupported-native-visibility' : 'failed';
    report.failure = error.stack; process.exitCode = error instanceof NativeVisibilityUnavailable ? 2 : 1;
    console.error(error.stack);
  } finally {
    clearTimeout(timer);
    await cleanup().catch((error) => { report.cleanupError = error.stack; report.status = 'failed'; process.exitCode = 1; });
    if (report.cleanup?.childExited === false) { report.status = 'failed'; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(`${report.status}: ${path.join(out, 'report.json')}`);
  }
})();
