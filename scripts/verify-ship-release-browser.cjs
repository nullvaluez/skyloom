/* SHIP PASS RELEASE — the browser half of verify-ship-release (FLY_SHIP_PASS.md
 * 5.5, RL-4 and RL-6 acceptance), on a PRODUCTION build and the offline world
 * fixture. SwiftShader proves correctness here, never performance.
 *
 *   FLY_BUILD_DIR=.next-release NEXT_PUBLIC_POSTHOG_KEY=phc_ship_release_test \
 *   NEXT_PUBLIC_POSTHOG_HOST=http://127.0.0.1:3197 \
 *     node node_modules/next/dist/bin/next build --webpack
 *   FLY_URL=http://localhost:3135 node scripts/verify-ship-release-browser.cjs   (server: next start -p 3135)
 *
 * The PostHog host is a local address no server listens on: every request to
 * it is intercepted and counted, so "zero network calls without consent" is
 * measured, and the consent leg is its positive control.
 *
 * Legs (each a fresh browser context, so a fresh profile):
 *   off      all RELEASE flags off + a ?fly= link: the link does nothing, the
 *            title stays, zero page / shader errors
 *   fly      ?fly=grand-canyon&aircraft=glider with the flags on and NO consent:
 *            Free Flight opens in the glider, the URL is cleaned, zero requests
 *            to the analytics host, zero page / shader errors
 *   watch    ?watch=KJFK: the lounge opens at JFK
 *   journey  ?journey=<first>: that journey's briefing opens
 *   invalid  ?fly=atlantis: the title stays with the quiet notice
 *   consent  consent 'yes' (positive control): analytics requests are seen
 * LEGS=fly,watch limits the run. Evidence: .graphics-review/ship-pass/release/.
 */
const path = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { chromium } = require('playwright');
const { attachFixture, fixturePin } = require('./_fixture');

const BASE = process.env.FLY_URL || 'http://localhost:3135';
const OUT = path.resolve('.graphics-review/ship-pass/release');
mkdirSync(OUT, { recursive: true });
// Not 3199: that is the offline world fixture's port (scripts/_fixture.js).
const PH_HOST = process.env.SHIP_PH_HOST || 'http://127.0.0.1:3197';
const LEG_MS = Number(process.env.LEG_MS || 480000);
const ON = 'CHALLENGE_LAYER,DEEP_LINKS,ANALYTICS_V2,PLAYER_SURFACE';
const OFF = '-CHALLENGE_LAYER,-DEEP_LINKS,-ANALYTICS_V2,-PLAYER_SURFACE';
const wanted = (process.env.LEGS || 'meta,off,fly,watch,journey,invalid,consent').split(',');

let passed = 0;
let failed = 0;
const rows = [];
function gate(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  rows.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

async function leg(browser, fixture, name, search, { consent = null, check }) {
  if (!wanted.includes(name)) return;
  const started = Date.now();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await attachFixture(context);
  const analytics = [];
  await context.route(`${PH_HOST}/**`, (route) => {
    analytics.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  context.on('request', (r) => {
    if (/posthog\.com|i\.posthog/.test(r.url())) analytics.push(r.url());
  });
  await context.addInitScript(
    ([pin, consentValue]) => {
      window.__flyTileFixture = pin;
      try {
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-quality-tier', 'low');
        if (consentValue) localStorage.setItem('fly-analytics-consent', consentValue);
      } catch {
        /* storage blocked: the gates below say so */
      }
    },
    [fixturePin(fixture.url), consent],
  );
  const page = await context.newPage();
  const errors = [];
  const shader = [];
  const asserts = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|WebGLProgram|THREE\.WebGLShader/i.test(m.text())) shader.push(m.text().slice(0, 200));
    // RL-9: three-tile's console.assert (the PoiLetters flood) prints as an assert.
    if (m.type() === 'assert' || /Assertion failed/i.test(m.text())) asserts.push(m.text().slice(0, 120));
  });
  page.setDefaultTimeout(LEG_MS);
  try {
    await page.goto(`${BASE}/${search}`, { waitUntil: 'domcontentloaded' });
    await check(page, { analytics, errors, shader });
  } catch (e) {
    gate(`${name}: leg completed`, false, String(e.message).slice(0, 300));
    await page.screenshot({ path: path.join(OUT, `browser-${name}-failure.png`), timeout: 20000 }).catch(() => {});
  }
  gate(`${name}: zero page errors and zero shader errors`, errors.length === 0 && shader.length === 0, { errors: errors.slice(0, 3), shader: shader.slice(0, 3) });
  gate(`${name}: zero console assert failures (RL-9)`, asserts.length === 0, { count: asserts.length, first: asserts[0] });
  console.log(`   (${name}: ${((Date.now() - started) / 1000).toFixed(0)} s)`);
  await context.close();
}

const store = (page) => page.evaluate(() => {
  const s = window.__flyStore?.getState?.();
  return s ? { screen: s.screen, flightMode: s.flightMode, aircraftId: s.aircraftId, watch: !!s.airportWatch, hangar: s.hangarOpen } : null;
});
const booted = (page) => page.waitForFunction(() => window.__flyBoot?.pct === 100, null, { polling: 2000 });

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const fixture = await attachFixture(await browser.newContext());
  try {
    // RL-5: the BUILT page carries the share card and no legacy domain.
    if (wanted.includes('meta')) {
      const html = await (await fetch(`${BASE}/`)).text();
      const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
      const tw = html.match(/<meta name="twitter:image" content="([^"]+)"/)?.[1];
      const img = og ? await fetch(new URL(og, BASE)).then((r) => (r.ok ? r.headers.get('content-type') : null)).catch(() => null) : null;
      gate('meta: the built HTML has og:image and twitter:image, served as an image', !!og && !!tw && /^image\//.test(img || ''), { og, tw, img });
      gate('meta: no legacy shadowadsb.app URL in the built HTML', !/shadowadsb\.app/.test(html));
      const man = await (await fetch(`${BASE}/manifest.json`)).json();
      gate('meta: the served manifest leads with the real Earth', /real Earth/.test(man.description) && !/neon/i.test(man.description), man.description);
    }
    await leg(browser, fixture, 'off', `?graphicsReview=1&flags=${OFF}&fly=grand-canyon`, {
      async check(page, { analytics }) {
        await page.getByTestId('title-screen').waitFor();
        await booted(page);
        await page.waitForTimeout(8000);
        const s = await store(page);
        gate('off: with DEEP_LINKS off a link does nothing (the title stays, the URL is untouched)', s?.screen === 'title' && page.url().includes('fly=grand-canyon'), { s, url: page.url() });
        gate('off: no analytics requests', analytics.length === 0, analytics.slice(0, 3));
      },
    });
    await leg(browser, fixture, 'fly', `?graphicsReview=1&flags=${ON}&fly=grand-canyon&aircraft=glider`, {
      async check(page, { analytics }) {
        await page.getByTestId('title-screen').waitFor();
        gate('fly: the link is consumed once (stripped from the URL, other parameters kept)', !page.url().includes('fly=') && page.url().includes('graphicsReview=1'), page.url());
        await page.waitForFunction(() => window.__flyStore?.getState?.().screen === 'flight', null, { polling: 2000 });
        const s = await store(page);
        gate('fly: ?fly= opens Free Flight in the linked aircraft', s?.flightMode === 'free' && s?.aircraftId === 'glider', s);
        await page.waitForTimeout(5000);
        gate('fly: without consent, zero requests reach the analytics host', analytics.length === 0, analytics.slice(0, 3));
        await page.screenshot({ path: path.join(OUT, 'browser-fly.png'), timeout: 60000 }).catch(() => {});
      },
    });
    await leg(browser, fixture, 'watch', `?graphicsReview=1&flags=${ON}&watch=KJFK`, {
      async check(page) {
        await page.waitForFunction(() => !!window.__flyStore?.getState?.().airportWatch, null, { polling: 2000 });
        const s = await store(page);
        gate('watch: ?watch=KJFK opens the lounge', s?.watch === true, s);
        await page.screenshot({ path: path.join(OUT, 'browser-watch.png'), timeout: 60000 }).catch(() => {});
      },
    });
    await leg(browser, fixture, 'journey', `?graphicsReview=1&flags=${ON}&journey=${process.env.SHIP_JOURNEY || 'manhattan-skyline'}`, {
      async check(page) {
        await page.waitForFunction(() => window.__flyStore?.getState?.().screen === 'hangar', null, { polling: 2000 });
        const s = await store(page);
        gate('journey: ?journey= opens that journey\'s briefing in the hangar', s?.screen === 'hangar', s);
      },
    });
    await leg(browser, fixture, 'invalid', `?graphicsReview=1&flags=${ON}&fly=atlantis`, {
      async check(page) {
        await page.getByTestId('deep-link-notice').waitFor();
        const s = await store(page);
        gate('invalid: an unknown place leaves the title up with the quiet notice', s?.screen === 'title', s);
      },
    });
    await leg(browser, fixture, 'consent', `?graphicsReview=1&flags=${ON}`, {
      consent: 'yes',
      async check(page, { analytics }) {
        await page.getByTestId('title-screen').waitFor();
        await page.waitForFunction(() => true);
        const deadline = Date.now() + 120000;
        while (!analytics.length && Date.now() < deadline) await page.waitForTimeout(3000);
        gate('consent (positive control): with consent the same interception sees analytics requests', analytics.length > 0, analytics.slice(0, 2));
      },
    });
  } finally {
    await browser.close();
    await fixture.close?.();
    writeFileSync(path.join(OUT, 'browser.json'), JSON.stringify({ at: new Date().toISOString(), venue: 'fixture + SwiftShader (correctness only)', rows }, null, 2));
  }
  console.log(`\nverify-ship-release-browser: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
