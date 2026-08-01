/**
 * R17 "Your Wings" — LIVING-WORLD CONTRACTS + DAILY SET + PROGRESS PERSISTENCE.
 *
 * Everything here is driven through the frozen override contracts so the
 * harness never depends on the real sky, the real clock or the real traffic
 * over the spawn:
 *
 *   window.__flyWeatherOverride  weather-model.js (R16)
 *   window.__flySunOverride      FlyScene's day cycle (R13)
 *   window.__flyDayOverride      lib/fly/daily.js  (R17, NEW)
 *   localStorage['fly-contracts-active-v1']  the R17 progress snapshot — seeded
 *       pre-mount to put a specific contract on the board (the rotation wheel
 *       would otherwise need eight completions to reach the R17 templates).
 *       Seeds are IDEMPOTENT (only written when the key is absent) because
 *       addInitScript re-runs on EVERY navigation — the R16 lesson — and the
 *       persistence gate reloads on purpose.
 *
 * Gates:
 *   1  RAIN — a seeded storm-chaser ticks up under a rain override (satellite)
 *   2  NIGHT — a seeded night-spots advances on a synthetic spot at pinned
 *      midnight, and the panel survives it with no page errors
 *   3  VISIT-TAG — a seeded visit-boneyard completes off an atlas visit, the
 *      lifetime counter increments and the completion toast fires
 *   4  TOY IS SEALED — a fresh toy boot shows no weather/night row at all, and
 *      a seeded one rotates itself out within staleSwapSec with no payout
 *   5  DAILY DETERMINISM — two fresh boots on the same __flyDayOverride show
 *      the identical pair; a different day shows a different pair
 *   6  PERSISTENCE — spot-heli advanced to 1/2 survives a reload, with the
 *      rotation cursor intact
 *   7  zero pageerrors across every phase
 *
 * Run: npm run dev (:3000), then `node scripts/verify-living-contracts.js`.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

const PROGRESS_KEY = 'fly-contracts-active-v1';
// Two UTC days whose seeded picks are disjoint (computed with
// scripts/verify-daily.mjs's own pickDaily): 07-25 → warbird+widebody,
// 07-26 → military+touch-go.
const DAY_A = Date.UTC(2026, 6, 25, 12, 0, 0);
const DAY_B = Date.UTC(2026, 6, 26, 12, 0, 0);
// NYC at 07:00Z is ~02:00 local solar — deep night at any time of year.
const SITE = { lat: 40.75, lon: -73.98, altM: 1500 };
const MIDNIGHT = Date.UTC(2026, 6, 25, 7, 0, 0);
const LIVE_IDS = [
  'storm-chaser', 'ifr-legs', 'wind-rider', 'above-weather',
  'night-spots', 'night-buzz',
];

const fails = [];
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

/**
 * Seed the progress snapshot + the clock pins, pre-mount and idempotently.
 *
 * WEATHER IS PINNED THROUGH AN ACCESSOR, not an assignment. This script's init
 * script is registered BEFORE bootFly's, so bootFly's fleet-wide
 * `__flyWeatherOverride = 'baseline'` would land on top of a plain assignment.
 * The pin has to survive it: a restored weather contract is judged from the
 * FIRST 1 Hz tick, the Contracts panel mounts under the BootScreen, and a boot
 * takes far longer than CONTRACTS_LIVING.staleSwapSec — so a rain override
 * applied after bootFly() returns arrives to find the contract already rotated
 * out (which is the product working correctly, and a useless test). The setter
 * swallows the baseline write; nothing else in the app writes this global.
 */
async function seed(page, { active = null, poolIdx = 3, dayMs = null, sunMs = null, wx = null } = {}) {
  await page.addInitScript(
    (cfg) => {
      if (Number.isFinite(cfg.dayMs)) window.__flyDayOverride = cfg.dayMs;
      if (Number.isFinite(cfg.sunMs)) window.__flySunOverride = cfg.sunMs;
      if (cfg.wx) {
        Object.defineProperty(window, '__flyWeatherOverride', {
          get: () => cfg.wx,
          set: () => {},
          configurable: true,
        });
      }
      if (!cfg.active) return;
      try {
        // Idempotent: a reload must read what the APP saved, not the seed.
        if (localStorage.getItem(cfg.key)) return;
        localStorage.setItem(
          cfg.key,
          JSON.stringify({
            v: 1,
            poolIdx: cfg.poolIdx,
            active: cfg.active.map((id) => ({ id, progress: 0, done: false, hits: [] })),
            daily: null,
          })
        );
      } catch {
        /* storage blocked — the gate below will say so */
      }
    },
    { key: PROGRESS_KEY, active, poolIdx, dayMs, sunMs, wx }
  );
}

/** A soaking, blowing, low-visibility sky — clears every offer threshold. */
const RAIN = {
  cloudCoverPct: 100, precip: 'rain', precipMm: 5, tempC: 12, visM: 4000,
  windDirDeg: 270, windMps: 18,
};

/** Every contract row currently on the panel, split active vs daily. */
const readRows = (page) =>
  page.evaluate(() => {
    const out = { active: [], daily: [] };
    for (const el of document.querySelectorAll('[data-testid^="contract-"]')) {
      const testid = el.getAttribute('data-testid');
      if (testid === 'contract-toast') continue;
      const daily = testid.startsWith('contract-daily-');
      const id = testid.replace(daily ? 'contract-daily-' : 'contract-', '');
      const text = (el.textContent || '').trim();
      const m = /(\d+)\/(\d+)\s*$/.exec(text);
      const rec = {
        id,
        text,
        done: el.getAttribute('data-done') === '1',
        progress: m ? Number(m[1]) : null,
        target: m ? Number(m[2]) : null,
      };
      (daily ? out.daily : out.active).push(rec);
    }
    out.completed = document.querySelector('[data-testid="contracts-completed"]')?.textContent ?? '';
    out.score = document.querySelector('[data-testid="contracts-score"]')?.textContent ?? '';
    return out;
  });

/** Inject a synthetic track and open its card — the verify-contracts pattern
 *  (InspectModal logs the passport spot on open, which is the product path). */
async function syntheticSpot(page, hex, reg, type, iconType) {
  await page.evaluate(
    ([h, r, t, ic]) => {
      const fly = window.__fly;
      const f = fly.flight;
      const liveT = Math.max(0, ...[...fly.traffic.tracks.values()].map((k) => k.fix1?.t ?? 0));
      const x = f.pos.x + 1500;
      const y = f.pos.y + 100;
      const z = f.pos.z;
      const track = {
        hex: h,
        meta: { flight: r, r, t, color: '#a78bfa', iconType: ic, category: null, squawk: null },
        archetype: 1,
        flags: 0,
        fix0: null,
        fix1: { x, y, z, vE: 40, vN: 20, vUp: 0, latRad: (f.latDeg * Math.PI) / 180, t: liveT },
        groundElev: 0,
        yaw: 0,
        bank: 0,
        rx: x,
        ry: y,
        ryd: y,
        renderLift: 0,
        _liftTarget: 0,
        rz: z,
        distM: 1500,
        opacity: 1,
        scaleK: 1,
        stale: 0,
        blendFix1: null,
        blendFix0: null,
        blendStart: 0,
        altBlendFrom: 0,
        altBlendStart: null,
        snapDipUntil: null,
        lastPollServer: liveT,
      };
      fly.traffic.tracks.set(h, track);
      if (!fly.traffic.items.includes(track)) fly.traffic.items.push(track);
      window.__flyStore.getState().setInspectHex(h);
    },
    [hex, reg, type, iconType]
  );
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const errs = [];
  const newPage = async () => {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    p.on('pageerror', (e) => errs.push(e.message));
    return p;
  };

  try {
    // =====================================================================
    // PHASE 1 — satellite: rain + night, on one page
    // =====================================================================
    {
      const page = await newPage();
      await seed(page, {
        active: ['storm-chaser', 'night-spots', 'spot-heli'],
        dayMs: DAY_A,
        sunMs: MIDNIGHT,
        wx: RAIN,
      });
      await bootFly(page, { style: 'satellite' });
      await page.mouse.move(800, 450);
      // Pin the position AND re-apply the sun there (verify-weather's trick:
      // warpToGeo bumps warpEpoch, which re-runs the day-cycle effect).
      await page.evaluate((s) => {
        window.__fly.warpToGeo(s.lat, s.lon, { altM: s.altM, name: null });
      }, SITE);
      await page.waitForTimeout(9000);

      const seeded = await readRows(page);
      gate(
        'seeded R17 contracts restore from the snapshot and SURVIVE the boot',
        seeded.active.some((r) => r.id === 'storm-chaser') &&
          seeded.active.some((r) => r.id === 'night-spots'),
        seeded.active.map((r) => r.id).join(', ')
      );

      // ---- (1) RAIN ------------------------------------------------------
      const wxOn = await page.evaluate(() => {
        const wx = window.__fly?.weather?.wx ?? null;
        return wx ? { precip: wx.precip, precipT: wx.precipT, found: wx.found } : null;
      });
      const r0 = seeded.active.find((r) => r.id === 'storm-chaser');
      await page.waitForTimeout(9000);
      const r1 = (await readRows(page)).active.find((r) => r.id === 'storm-chaser');
      // The rain is pinned from BEFORE mount, so the contract has been ticking
      // since the boot screen — by the second read it may legitimately have
      // finished (60 ticks) and started rotating away. Any of "more progress",
      // "done", or "already gone" is the same fact: it ticked.
      gate(
        'storm-chaser ticks under a rain override',
        !!wxOn && wxOn.precipT > 0.35 && !!r0 && r0.progress > 0 &&
          (!r1 || r1.done || (r1.progress ?? 0) > r0.progress),
        `wx precipT ${wxOn?.precipT?.toFixed(3)} · ${r0?.progress}/${r0?.target} → ${
          r1 ? (r1.done ? 'done' : `${r1.progress}/${r1.target}`) : 'rotated out'
        }`
      );

      // ---- (2) NIGHT -----------------------------------------------------
      const sunFrac = await page.evaluate(() => window.__flyStats?.sunFactor ?? null);
      await syntheticSpot(page, 'feed171', 'N17NGT', 'B407', 'helicopter');
      await page.waitForTimeout(800);
      const nightRow = (await readRows(page)).active.find((r) => r.id === 'night-spots');
      gate(
        'night-spots advances on a spot at pinned midnight',
        sunFrac !== null && sunFrac <= 0.16 && !!nightRow && nightRow.progress >= 1,
        `sunFrac ${sunFrac} · ${nightRow?.progress}/${nightRow?.target}`
      );
      await page.screenshot({ path: path.join(__dirname, 'living-01-satellite.png') });

      // ---- (3) VISIT-TAG (drives the atlas store through the dev handle) --
      const before = await readRows(page);
      const beforeN = Number((before.completed.match(/(\d+)/) ?? [])[1] ?? -1);
      await page.evaluate(() => {
        // Reseat visit-boneyard onto the board without another boot: the
        // rotation cursor would take eight completions to reach it.
        window.__flyStores.useFlyAtlasStore
          .getState()
          .logVisit('hotspot:Pinal Airpark', 'Pinal Airpark', 'hotspot');
      });
      await page.waitForTimeout(1200);
      const handle = await page.evaluate(() =>
        Object.keys(window.__flyStores ?? {}).sort().join(',')
      );
      // The dev store registry exists and a tagged visit resolves without
      // throwing; the payout itself is gated in phase 2 (visit-boneyard is not
      // on this board, so nothing here may change).
      gate(
        'the dev store registry exists and a tagged visit is safe',
        handle === 'useFlyAtlasStore,useFlyContractsStore,useFlyStore,usePassportStore' &&
          errs.length === 0,
        `__flyStores = {${handle}} · completed line "${before.completed.trim()}" (n=${beforeN})`
      );
      await page.close();
    }

    // =====================================================================
    // PHASE 2 — visit-tag completion + the completion toast (satellite)
    // =====================================================================
    {
      const page = await newPage();
      await seed(page, {
        active: ['visit-boneyard', 'spot-heli', 'chase-formation'],
        dayMs: DAY_A,
      });
      await bootFly(page, { style: 'satellite' });
      await page.mouse.move(800, 450);
      const pre = await readRows(page);
      const preN = Number((pre.completed.match(/(\d+)/) ?? [])[1] ?? -1);
      const preScore = Number(pre.score.replace(/[^\d]/g, '')) || 0;
      await page.evaluate(() => {
        window.__flyStores.useFlyAtlasStore
          .getState()
          .logVisit('hotspot:Pinal Airpark', 'Pinal Airpark', 'hotspot');
      });
      await page.waitForTimeout(900);
      const toast = await page
        .locator('[data-testid="contract-toast"]')
        .first()
        .textContent()
        .catch(() => null);
      const post = await readRows(page);
      const postN = Number((post.completed.match(/(\d+)/) ?? [])[1] ?? -1);
      const postScore = Number(post.score.replace(/[^\d]/g, '')) || 0;
      await page.screenshot({ path: path.join(__dirname, 'living-02-visit-tag.png') });
      gate(
        'visit-tag completes off a tagged atlas visit (+300)',
        postScore === preScore + 300 && postN === preN + 1,
        `score ${preScore}→${postScore}, lifetime ${preN}→${postN}`
      );
      gate(
        'contract-toast announces the completion',
        !!toast && /\+300/.test(toast),
        toast ? toast.trim() : 'no toast'
      );
      await page.close();
    }

    // =====================================================================
    // PHASE 3 — toy is sealed: no live rows, and a seeded one rotates out
    // =====================================================================
    {
      const page = await newPage();
      await seed(page, {
        active: ['storm-chaser', 'spot-heli', 'chase-formation'],
        dayMs: DAY_A,
      });
      await bootFly(page); // toy
      await page.mouse.move(800, 450);
      const t0 = await readRows(page);
      gate(
        'toy restores the seeded live row before judging it',
        t0.active.some((r) => r.id === 'storm-chaser'),
        t0.active.map((r) => r.id).join(', ')
      );
      // staleSwapSec is 30 ticks; give the swap a generous margin.
      await page.waitForTimeout(42000);
      const t1 = await readRows(page);
      const stillLive = t1.active.filter((r) => LIVE_IDS.includes(r.id));
      const scoreT1 = Number(t1.score.replace(/[^\d]/g, '')) || 0;
      await page.screenshot({ path: path.join(__dirname, 'living-03-toy-swap.png') });
      gate(
        'toy rotates a stale weather contract out, unpaid',
        stillLive.length === 0 && t1.active.length === 3 && scoreT1 === 0,
        `${t0.active.map((r) => r.id).join('/')} → ${t1.active.map((r) => r.id).join('/')} · score ${scoreT1}`
      );
      const dailyLive = t1.daily.filter((r) => LIVE_IDS.includes(r.id));
      gate(
        'the daily set never contains a weather/night contract',
        dailyLive.length === 0 && t1.daily.length === 2,
        t1.daily.map((r) => r.id).join(', ')
      );
      await page.close();
    }

    // =====================================================================
    // PHASE 4 — daily determinism across fresh boots
    // =====================================================================
    {
      const dailyIds = async (dayMs) => {
        const page = await newPage();
        await seed(page, { dayMs });
        await bootFly(page);
        const rows = await readRows(page);
        await page.close();
        return rows.daily.map((r) => r.id);
      };
      const a1 = await dailyIds(DAY_A);
      const a2 = await dailyIds(DAY_A);
      const b1 = await dailyIds(DAY_B);
      gate(
        'same __flyDayOverride → identical daily set on a fresh boot',
        a1.length === 2 && a1.join('|') === a2.join('|'),
        `${a1.join(' + ')} vs ${a2.join(' + ')}`
      );
      gate(
        'a different UTC day → a different daily set',
        b1.length === 2 && b1.join('|') !== a1.join('|'),
        `${a1.join(' + ')} vs ${b1.join(' + ')}`
      );
    }

    // =====================================================================
    // PHASE 5 — progress survives a reload
    // =====================================================================
    {
      const page = await newPage();
      await seed(page, {
        active: ['spot-3', 'spot-heli', 'chase-formation'],
        poolIdx: 9,
        dayMs: DAY_A,
      });
      await bootFly(page);
      await page.mouse.move(800, 450);
      await syntheticSpot(page, 'feed17a', 'N17PER', 'B407', 'helicopter');
      await page.waitForTimeout(1500);
      const pre = await readRows(page);
      const preHeli = pre.active.find((r) => r.id === 'spot-heli');
      gate(
        'a spot advances spot-heli to 1/2',
        !!preHeli && preHeli.progress === 1 && preHeli.target === 2,
        `${preHeli?.progress}/${preHeli?.target}`
      );
      // The save is debounced ~800ms — give it room, then reload.
      await page.waitForTimeout(2000);
      const snapBefore = await page.evaluate(
        (k) => JSON.parse(localStorage.getItem(k) || 'null'),
        PROGRESS_KEY
      );
      // R19 probe-determinism fix (Fable; mechanism deterministically
      // reproduced by D GOLDENHOUR): between this snapshot read and the
      // reload's pagehide flush, LIVE traffic can COMPLETE a row (a second
      // helicopter finishes spot-heli; a third spot finishes spot-3). A
      // completed row is deliberately never persisted (R17: it paid out and
      // rotates away), so the flushed snapshot legitimately lacks it and the
      // mount refill legitimately advances poolIdx. The completedCount in the
      // fly-contracts envelope is the deterministic witness: every vanished
      // row must be covered by a completion. A wipe still fails BOTH gates
      // (rows gone, completedCount unmoved). Gate semantics preserved; no
      // number weakened.
      const completedBefore = await page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem('fly-contracts') || '{}').state?.completedCount ?? 0;
        } catch {
          return 0;
        }
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, {
        timeout: 180000,
        polling: 250,
      });
      await page.waitForTimeout(3000);
      const post = await readRows(page);
      const postHeli = post.active.find((r) => r.id === 'spot-heli');
      const postAny = post.active.find((r) => r.id === 'spot-3');
      const snapAfter = await page.evaluate(
        (k) => JSON.parse(localStorage.getItem(k) || 'null'),
        PROGRESS_KEY
      );
      await page.screenshot({ path: path.join(__dirname, 'living-04-restored.png') });
      // LIVE traffic also logs spots, so the counts only ever grow — the
      // regression this guards is "everything resets to 0 on reload", which a
      // >= against the snapshot catches exactly. `spot-heli` is checked against
      // the value that was actually WRITTEN, not against a literal.
      const savedOf = (snap, id) =>
        (snap?.active ?? []).find((r) => r.id === id)?.progress ?? null;
      const savedHeli = savedOf(snapBefore, 'spot-heli');
      const savedAny = savedOf(snapBefore, 'spot-3');
      // R19 (see the completedBefore comment): a row may legitimately vanish
      // across the reload ONLY by completing — witnessed by completedCount.
      const completedAfter = await page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem('fly-contracts') || '{}').state?.completedCount ?? 0;
        } catch {
          return 0;
        }
      });
      const completedDelta = Math.max(0, completedAfter - completedBefore);
      const rowOk = (row, saved) =>
        row ? row.done || row.progress >= saved : completedDelta > 0;
      const vanished = ['spot-heli', 'spot-3'].filter(
        (id) => !post.active.find((r) => r.id === id)
      ).length;
      gate(
        'progress restores across a reload',
        savedHeli === 1 && savedAny >= 1 &&
          rowOk(postHeli, savedHeli) && rowOk(postAny, savedAny) &&
          vanished <= completedDelta,
        `saved heli ${savedHeli} / any ${savedAny} → restored heli ${postHeli?.progress}/${postHeli?.target}, any ${postAny?.progress}/${postAny?.target} · vanished ${vanished} ≤ completedΔ ${completedDelta}`
      );
      // R19: the cursor may advance ONLY to refill completion-vacated slots —
      // Δ is bounded by the completion witness. A wipe (poolIdx reset or a
      // 3-slot refill with no completions) still fails.
      const poolDelta = (snapAfter?.poolIdx ?? -99) - (snapBefore?.poolIdx ?? 0);
      gate(
        'the rotation cursor survives the reload',
        snapBefore?.poolIdx === 9 && poolDelta >= 0 && poolDelta <= completedDelta,
        `poolIdx ${snapBefore?.poolIdx} → ${snapAfter?.poolIdx} (Δ${poolDelta} ≤ completedΔ ${completedDelta})`
      );
      gate(
        'the fly-contracts envelope is untouched by the new key',
        await page.evaluate(() => {
          const raw = localStorage.getItem('fly-contracts');
          if (!raw) return true; // never written = never polluted
          const o = JSON.parse(raw);
          const keys = Object.keys(o.state ?? {}).sort();
          return keys.join(',') === 'completedCount,totalScore';
        }),
        'partialize pins {totalScore, completedCount}'
      );
      await page.close();
    }

    gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('harness completed', false, e.message);
  }

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});
