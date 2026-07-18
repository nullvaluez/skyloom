/**
 * R9-1 boot harness: fly-only pivot — app/page.js mounts FlyMode directly
 * under the BootScreen overlay. Verifies the window.__flyBoot contract for
 * BOTH styles on a fresh page each:
 *   - pct is real + monotonic, hits 100 exactly at reveal, and STAYS 100
 *   - the overlay (data-testid="boot-screen") unmounts after the reveal
 *   - goto → pct 100 wall time is reported
 *   - 'fly-last-pos' is persisted from the live session
 *   - zero pageerrors
 * Screenshots: boot-<style>-loading.png (mid-progress) and
 * boot-<style>-revealed.png. ALWAYS view screenshots.
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });

  const runStyle = async (style) => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') {
        const t = m.text();
        if (t.includes('fly') || t.includes('toy-world') || t.includes('THREE'))
          console.log(`[${style}] console:`, t.slice(0, 200));
      }
    });
    // Persisted style must exist BEFORE the app boots (PauseMenu reads it on
    // mount). Toy is the default — only satellite needs the key.
    if (style === 'satellite') {
      await page.addInitScript(() =>
        localStorage.setItem('fly-map-style-2', 'satellite')
      );
    }

    const t0 = Date.now();
    await page.goto('http://localhost:3000', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    // Sample __flyBoot until 100 (record the trace; snap one mid-progress shot)
    const trace = [];
    let midShot = false;
    let monotonic = true;
    let last = -1;
    let done = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const b = await page.evaluate(() => window.__flyBoot ?? null);
      if (b) {
        if (trace.length === 0 || trace[trace.length - 1].pct !== b.pct ||
            trace[trace.length - 1].phase !== b.phase) {
          trace.push({ ...b, tMs: Date.now() - t0 });
        }
        if (b.pct < last) monotonic = false;
        last = b.pct;
        if (!midShot && b.pct >= 10 && b.pct < 100) {
          midShot = true;
          await page.screenshot({ path: path.join(__dirname, `boot-${style}-loading.png`) });
        }
        if (b.pct === 100) {
          done = Date.now() - t0;
          break;
        }
      }
      await page.waitForTimeout(100);
    }
    // Fast boots can blow through the mid band between samples — grab the
    // overlay during the reveal fade instead so the record still has one.
    if (!midShot) {
      await page.screenshot({ path: path.join(__dirname, `boot-${style}-loading.png`) });
    }

    // Reveal settles; overlay must be gone, __flyBoot pinned at 100.
    await page.waitForTimeout(2000);
    const post = await page.evaluate(() => ({
      boot: window.__flyBoot ?? null,
      overlay: !!document.querySelector('[data-testid="boot-screen"]'),
      helpCard: document.body.innerText.includes('Welcome to Fly Mode'),
    }));
    await page.waitForTimeout(11000); // ride past a fly-last-pos save tick
    const persisted = await page.evaluate(() => {
      const still = window.__flyBoot ?? null;
      let lastPos = null;
      try { lastPos = JSON.parse(localStorage.getItem('fly-last-pos')); } catch { /* noop */ }
      return { still, lastPos };
    });
    await page.screenshot({ path: path.join(__dirname, `boot-${style}-revealed.png`) });

    console.log(`\n=== ${style} ===`);
    console.log('trace:', JSON.stringify(trace));
    console.log('goto→pct100:', done, 'ms; monotonic:', monotonic);
    console.log('post-reveal:', JSON.stringify(post));
    console.log('after +11s:', JSON.stringify(persisted));
    console.log('pageerrors:', errs.length ? errs : 'none');

    const pass =
      done != null &&
      monotonic &&
      post.boot?.pct === 100 &&
      !post.overlay &&
      persisted.still?.pct === 100 &&
      Number.isFinite(persisted.lastPos?.lat) &&
      errs.length === 0;
    console.log(pass ? `PASS ${style}` : `FAIL ${style}`);
    await page.close();
    return pass;
  };

  const toyOk = await runStyle('toy');
  const satOk = await runStyle('satellite');
  await browser.close();
  console.log('\nRESULT:', toyOk && satOk ? 'ALL PASS' : 'FAILURES');
  process.exit(toyOk && satOk ? 0 : 1);
})();
