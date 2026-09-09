#!/usr/bin/env node
/**
 * R24 (B STREAM) — r24-b-probe-live: THE FOUR LIVE PROBES, WITH HONEST BLOCKS.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM scripts/r24-b-ringhold.mjs ─────────────
 * The sim in that file certifies the SELECTION ARITHMETIC: it is exact,
 * deterministic, red-calibrated, and it runs anywhere. What it cannot do is
 * certify the user-visible claim — that a pilot stops seeing buildings, trees
 * and roads blink — because that claim is about a world that has streamed, a
 * DEM that has refined and a chunk that took real wall-clock time to come back.
 *
 * This file is those measurements. It is written to run, and to REFUSE to
 * report a number it did not earn:
 *
 *   • It calls `checkWorldContent` before every claim. On a session where the
 *     tile hosts are unreachable it prints `VERIFY: BLOCKED` and exits 2 —
 *     never PASS, never FAIL. A metric taken under a blockade is evidence of
 *     the blockade (R23's ruling, and this round's environment: both Esri and
 *     OpenFreeMap answer 403 to CONNECT through the agent proxy).
 *   • It calls `checkMachineHonesty` before every MOTION claim. Every probe
 *     here keys on distance flown, and a machine that renders at 1 fps under
 *     SwiftShader covers a fraction of the intended track inside the same wall
 *     clock — so the leg would silently measure a much shorter flight. That is
 *     the third outcome, not a soft pass.
 *
 * ── THE FOUR PROBES (B's Wave-1 P-B1…P-B4) ─────────────────────────────────
 *   P1  THE CHURN LEDGER — the load-bearing one. Samples every engine's
 *       resident key set at 5 Hz through three legs (straight, sustained turn
 *       at cruise, sustained turn on boost) and reports, per ring: evictions,
 *       keep-set re-entries, THRASH (evicted while still within 1.25×ringR and
 *       back within 6 s), and — the number no sim can produce — the WALL-CLOCK
 *       GAP between a chunk's eviction and its next ready.
 *   P2  THE A/B — the same turn leg with `window.__flyRingHold` / `__flyLeadSafe`
 *       forced 0 then 1, in ONE session on ONE machine. This is the only
 *       measurement that can attribute the change to the fix rather than to the
 *       day, and the dev arms exist for exactly this.
 *   P3  VEG COVERAGE BEHIND — during the turn leg, the minimum distance from
 *       the player to an ABSENT veg chunk, against `SAT_VEG.distFade.endM`.
 *       Wave-1 predicts 1164 u uncapped, >= 2400 u capped.
 *   P4  POOL SATURATION — at a dense pose, whether the clutter/parcel pools
 *       actually saturate, and how much of the instance set changes across a
 *       20 m move. POOL_FAIR's whole premise is that they DO saturate
 *       somewhere; R22 only ever measured P-LEWIS, where they do not.
 *
 * ── THE GAP THIS FILE DOES NOT CLOSE ───────────────────────────────────────
 * P1's eviction→ready gap is expected to be dominated by A's tileZ/DEM
 * behaviour (a chunk re-entering behind the aircraft sits on unrefined DEM and
 * holds in `_finalizePending` for up to drapeMaxTries × 1.5 s). B's fixes
 * reduce how OFTEN that happens; they do not shorten the hold. Reading a small
 * improvement here and calling B's work done would be the wrong conclusion —
 * the gap column is reported so the two rounds' contributions stay separable.
 *
 * USAGE
 *   node scripts/r24-b-probe-live.js                  all four, dev server 3019
 *   node scripts/r24-b-probe-live.js --probe=1        one probe
 *   node scripts/r24-b-probe-live.js --port=3021
 */

const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');

let precondition = null;
try {
  precondition = require('./_world-precondition');
} catch {
  /* E's module may not have landed; every use below is optional-chained. */
}

const ARGV = process.argv.slice(2);
const arg = (k, d) => {
  const hit = ARGV.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const PORT = arg('port', '3019');
const ONLY = arg('probe', null);
const BASE = `http://localhost:${PORT}`;

/* Powell OH — the round's reference suburb, and the pose R21/R22 both used. */
const POSE = { lat: 40.1573, lon: -83.0752, altM: 520 };

const lines = [];
const say = (s) => {
  console.log(s);
  lines.push(s);
};

/* ═══════════════════════ in-page instrument (P1/P2/P3) ════════════════════ */

/**
 * Installed before mount. Samples every satellite engine's resident key set on
 * a 5 Hz timer and keeps a per-key life ledger. Reads ONLY dev handles the
 * engines already publish — it adds no product code path.
 */
function INSTALL_LEDGER() {
  const L = {
    t0: performance.now(),
    rings: {},
    samples: 0,
    legs: [],
    leg: 'boot',
  };
  const ENGINES = () => ({
    buildings: window.__satBuildings ?? null,
    veg: window.__flyStats?.satVegEngine ?? window.__satVeg ?? null,
    clutter: window.__flyClutter?.engine ?? null,
    roads: window.__satRoads ?? null,
    skyline: window.__satSkyline ?? null,
  });
  const ringOf = (name) => (L.rings[name] ??= { keys: new Map(), evictions: 0, reentries: 0, thrash: 0, gaps: [] });

  L.mark = (leg) => {
    L.leg = leg;
    L.legs.push({ leg, at: performance.now() - L.t0 });
  };

  const tick = () => {
    const now = (performance.now() - L.t0) / 1000;
    const px = window.__fly?.flight?.pos?.x;
    const pz = window.__fly?.flight?.pos?.z;
    if (px === undefined) return;
    L.samples += 1;
    for (const [name, eng] of Object.entries(ENGINES())) {
      if (!eng || !eng.chunks) continue;
      const R = ringOf(name);
      const live = new Set();
      for (const [key, c] of eng.chunks) {
        if (c.state !== 'ready') continue;
        live.add(key);
        const rec = R.keys.get(key);
        if (!rec) {
          R.keys.set(key, { present: true, born: now, cx: c.cx, cz: c.cz });
        } else if (!rec.present) {
          rec.present = true;
          R.reentries += 1;
          if (rec.goneAt !== undefined) {
            R.gaps.push(+(now - rec.goneAt).toFixed(2));
            // THRASH: it went while it was still nearby, and it came back fast.
            if (now - rec.goneAt <= 6 && rec.goneNear) R.thrash += 1;
          }
        }
      }
      for (const [key, rec] of R.keys) {
        if (rec.present && !live.has(key)) {
          rec.present = false;
          rec.goneAt = now;
          const r = eng._coverage?.ringM ?? eng.ringR ?? 3600;
          const d = Math.hypot((rec.cx ?? px) - px, (rec.cz ?? pz) - pz);
          rec.goneNear = d <= r * 1.25;
          R.evictions += 1;
        }
      }
    }
  };
  L.timer = setInterval(tick, 200);
  L.read = () => {
    const out = { samples: L.samples, legs: L.legs, rings: {} };
    for (const [name, R] of Object.entries(L.rings)) {
      const gaps = R.gaps.slice().sort((a, b) => a - b);
      out.rings[name] = {
        evictions: R.evictions,
        reentries: R.reentries,
        thrash: R.thrash,
        gapMedian: gaps.length ? gaps[gaps.length >> 1] : null,
        gapP90: gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.9))] : null,
        gapMax: gaps.length ? gaps[gaps.length - 1] : null,
        gapN: gaps.length,
      };
    }
    return out;
  };
  L.reset = () => {
    L.rings = {};
    L.samples = 0;
  };
  window.__r24b = L;
}

/* ═════════════════════════════ the driver ═════════════════════════════════ */

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const net = { img: 0, imgFail: 0, vec: 0, vecFail: 0, hosts: new Set() };
  const errs = [];
  let blocked = null;

  const newPage = async () => {
    const p = await context.newPage();
    // B's own arms + the settle pin, so a leg can take RED and GREEN in ONE
    // session (the whole point of P2).
    await p.addInitScript(unpinPins, ['__flyClutterPin', '__flySettlePin']);
    await p.addInitScript(INSTALL_LEDGER);
    p.on('pageerror', (e) => errs.push(e.message));
    if (precondition?.wireWorldTally) precondition.wireWorldTally(p, net);
    else
      p.on('response', (r) => {
        const u = r.url();
        if (/arcgisonline|World_Imagery/.test(u)) r.ok() ? (net.img += 1) : (net.imgFail += 1);
        else if (/openfreemap|\.pbf/.test(u)) r.ok() ? (net.vec += 1) : (net.vecFail += 1);
        if (!r.ok()) try { net.hosts.add(new URL(u).host); } catch { /* ignore */ }
      });
    return p;
  };

  /** Fly a leg by driving the real input controller, then read the ledger. */
  const flyLeg = async (page, { name, secs, speedPreset, turn }) =>
    page.evaluate(
      async ([nm, s, preset, tr]) => {
        const F = window.__fly;
        window.__r24b.mark(nm);
        F.input?.press?.(preset); // '1' slow · '2' cruise · '3' boost
        const t0 = performance.now();
        let frames = 0;
        while (performance.now() - t0 < s * 1000) {
          if (tr) F.input?.setAxis?.('roll', tr);
          await new Promise((r) => requestAnimationFrame(r));
          frames += 1;
        }
        F.input?.setAxis?.('roll', 0);
        return { frames, secs: (performance.now() - t0) / 1000, speed: F.flight?.speed ?? null };
      },
      [name, secs, speedPreset, turn]
    );

  const report = [];
  const emit = (probe, verdict, detail) => {
    report.push({ probe, verdict, detail });
    say(`${verdict} ${probe} — ${detail}`);
  };

  try {
    const page = await newPage();
    await bootFly(page, { style: 'satellite', url: `${BASE}/`, settleMs: 3000 });
    await page.evaluate(
      ([lat, lon, alt]) => window.__fly.warpToGeo(lat, lon, alt),
      [POSE.lat, POSE.lon, POSE.altM]
    );
    await page.waitForTimeout(6000);

    /* ── PRECONDITION 1: did a world stream at all? ───────────────────────── */
    const resident = await page.evaluate(
      () => (window.__satBuildings?.stats?.ready ?? 0) + (window.__fly?.engine?.terraStats?.tiles ?? 0) > 0
    );
    const world = precondition?.checkWorldContent
      ? precondition.checkWorldContent(net, { resident })
      : {
          ok: resident || net.img > 0,
          report:
            `WORLD tiles: imagery ${net.img}/${net.imgFail} · vector ${net.vec}/${net.vecFail} · ` +
            `resident ${resident}` +
            (resident || net.img > 0
              ? ''
              : '\nBLOCKED the world never streamed — every metric below would describe the network.'),
        };
    say(world.report ?? world.line ?? '');
    if (!world.ok) blocked = 'world';

    /* ── PRECONDITION 2: can this machine actually fly the legs? ──────────── */
    if (!blocked) {
      const cal = await flyLeg(page, { name: 'calibrate', secs: 4, speedPreset: '2', turn: 0 });
      const predicted = precondition?.predictedDistanceM
        ? precondition.predictedDistanceM(cal.frames, cal.speed ?? 200)
        : cal.frames * 0.05 * (cal.speed ?? 200);
      const fps = cal.frames / cal.secs;
      const m = { fps, frames: cal.frames, predictedM: predicted, secs: cal.secs };
      const honest = precondition?.checkMachineHonesty
        ? precondition.checkMachineHonesty(m, { minFps: 12 })
        : { ok: fps >= 12, report: `MACHINE ${fps.toFixed(1)} fps over ${cal.secs.toFixed(1)} s` };
      say(honest.report ?? honest.line ?? `MACHINE ${fps.toFixed(1)} fps`);
      if (!honest.ok) blocked = blocked ?? 'machine';
    }

    if (blocked) {
      say(
        `\nVERIFY: BLOCKED (${blocked}) — no probe below was run. This is the THIRD OUTCOME, not a\n` +
          'pass and not a failure: on this session the product could not be observed. The R24 B\n' +
          'selection arithmetic is certified separately and deterministically by\n' +
          '`node scripts/r24-b-ringhold.mjs` (14/14, red-calibrated), which needs neither tiles nor\n' +
          'a GPU — but it certifies the ARITHMETIC only. The user-visible claim is UNMEASURED until\n' +
          'this file runs somewhere with egress.'
      );
      if (precondition?.exitBlocked) await precondition.exitBlocked(lines.join('\n'), { code: 2 });
      await browser.close();
      process.exit(2);
    }

    const wants = (n) => !ONLY || ONLY === String(n);

    /* ── P1 THE CHURN LEDGER ─────────────────────────────────────────────── */
    if (wants(1)) {
      await page.evaluate(() => window.__r24b.reset());
      await flyLeg(page, { name: 'straight-cruise', secs: 60, speedPreset: '2', turn: 0 });
      await flyLeg(page, { name: 'turn-cruise', secs: 60, speedPreset: '2', turn: 0.6 });
      await flyLeg(page, { name: 'turn-boost', secs: 60, speedPreset: '3', turn: 0.6 });
      const led = await page.evaluate(() => window.__r24b.read());
      emit(
        'P1 churn ledger',
        'DATA',
        Object.entries(led.rings)
          .map(
            ([nm, r]) =>
              `${nm}: evict ${r.evictions} · re-enter ${r.reentries} · THRASH ${r.thrash} · ` +
              `gap med ${r.gapMedian}s p90 ${r.gapP90}s max ${r.gapMax}s (n=${r.gapN})`
          )
          .join('\n     ')
      );
      say(
        '     ^ the GAP column is the number no sim can produce, and it is the one that separates\n' +
          '       B from A: B reduces how often a chunk is dropped, A (TILE_HOLD / the tileZ contract)\n' +
          '       decides how long it takes to come back.'
      );
    }

    /* ── P2 THE A/B, one session, one machine ────────────────────────────── */
    if (wants(2)) {
      const arm = async (label, ringHold, leadSafe) => {
        await page.evaluate(
          ([rh, ls]) => {
            window.__flyRingHold = rh;
            window.__flyLeadSafe = ls;
            window.__r24b.reset();
          },
          [ringHold, leadSafe]
        );
        await flyLeg(page, { name: `ab-${label}`, secs: 60, speedPreset: '2', turn: 0.6 });
        return page.evaluate(() => window.__r24b.read());
      };
      const off = await arm('RED', 0, 0);
      const on = await arm('GREEN', 1, 1);
      await page.evaluate(() => {
        delete window.__flyRingHold;
        delete window.__flyLeadSafe;
      });
      const row = (nm) =>
        `${nm}: thrash ${off.rings[nm]?.thrash ?? '-'} → ${on.rings[nm]?.thrash ?? '-'} · ` +
        `evict ${off.rings[nm]?.evictions ?? '-'} → ${on.rings[nm]?.evictions ?? '-'}`;
      emit(
        'P2 RED/GREEN A/B',
        'DATA',
        ['buildings', 'veg', 'clutter', 'roads'].map(row).join('\n     ')
      );
      say(
        '     ^ the sim predicts (20-leg matrix, same metric): buildings 121→69, veg 48→1,\n' +
          '       clutter 0→0, roads 88→59. A live ratio in the same DIRECTION on the same machine\n' +
          '       is the corroboration; the absolute numbers will not match (one pose, not twenty).'
      );
    }

    /* ── P3 VEG COVERAGE BEHIND ──────────────────────────────────────────── */
    if (wants(3)) {
      const cov = await page.evaluate(async () => {
        const out = [];
        const F = window.__fly;
        const eng = window.__flyStats?.satVegEngine ?? window.__satVeg;
        const t0 = performance.now();
        while (performance.now() - t0 < 30000) {
          F.input?.setAxis?.('roll', 0.6);
          await new Promise((r) => requestAnimationFrame(r));
          if (!eng?.chunks) continue;
          const px = F.flight.pos.x;
          const pz = F.flight.pos.z;
          const span = (2 * Math.PI * 6378137) / 2 ** 14;
          const half = (2 * Math.PI * 6378137) / 2;
          const keep = new Set([...eng.chunks.keys()]);
          const ptx = Math.floor((px + half) / span);
          const pty = Math.floor((pz + half) / span);
          let best = Infinity;
          for (let ty = pty - 4; ty <= pty + 4; ty++)
            for (let tx = ptx - 4; tx <= ptx + 4; tx++) {
              if (keep.has(`14/${tx}/${ty}`)) continue;
              const minX = -half + tx * span;
              const minZ = -(half - ty * span);
              const dx = Math.max(minX - px, 0, px - (minX + span));
              const dz = Math.max(minZ - pz, 0, pz - (minZ + span));
              const d = Math.hypot(dx, dz);
              if (d < best) best = d;
            }
          out.push(Math.round(best));
        }
        F.input?.setAxis?.('roll', 0);
        return out;
      });
      const worst = cov.length ? Math.min(...cov) : null;
      emit(
        'P3 veg coverage behind',
        'DATA',
        `worst guaranteed radius around the player over a 30 s turn: ${worst} u ` +
          `(samples ${cov.length}); SAT_VEG.distFade.endM = 2400. Wave-1 predicts 1164 u with the ` +
          'lead uncapped and >= 2400 u with LEAD_SAFE armed.'
      );
    }

    /* ── P4 POOL SATURATION at a dense pose ──────────────────────────────── */
    if (wants(4)) {
      await page.evaluate(() => window.__fly.warpToGeo(40.7549, -73.984, 400)); // Midtown
      await page.waitForTimeout(9000);
      const sat = await page.evaluate(() => {
        const s = window.__flyStats ?? {};
        const grab = (m) => {
          if (!m) return null;
          const a = [];
          for (let i = 0; i < m.count; i++) a.push(Math.round(m.instanceMatrix.array[i * 16 + 12]));
          return a.join(',');
        };
        return {
          clutter: s.clutter ?? null,
          parcel: s.parcelHomes ?? null,
          veg: s.satVeg ?? null,
          sig: {
            parked: grab(window.__flyClutter?.parkedMesh),
            poles: grab(window.__flyClutter?.poleMesh),
          },
        };
      });
      await page.evaluate(() => {
        const F = window.__fly;
        F.flight.pos.x += 20;
      });
      await page.waitForTimeout(2600);
      const sat2 = await page.evaluate(() => {
        const grab = (m) => {
          if (!m) return null;
          const a = [];
          for (let i = 0; i < m.count; i++) a.push(Math.round(m.instanceMatrix.array[i * 16 + 12]));
          return a.join(',');
        };
        return { parked: grab(window.__flyClutter?.parkedMesh), poles: grab(window.__flyClutter?.poleMesh) };
      });
      const churn = (a, b) => {
        if (!a || !b) return null;
        const A = new Set(a.split(','));
        const B2 = new Set(b.split(','));
        let same = 0;
        for (const v of B2) if (A.has(v)) same += 1;
        return `${(100 * (1 - same / Math.max(1, B2.size))).toFixed(1)}% changed`;
      };
      emit(
        'P4 pool saturation (Midtown)',
        'DATA',
        `clutter ${JSON.stringify(sat.clutter)} · parcel ${JSON.stringify(sat.parcel)} · ` +
          `across a 20 m move: parked ${churn(sat.sig.parked, sat2.parked)}, poles ${churn(sat.sig.poles, sat2.poles)}. ` +
          'POOL_FAIR only binds where a pool SATURATES; R22 measured 242/34/132 at P-LEWIS against ' +
          'caps of 1500/300/900, i.e. never. If the pools do not saturate here either, POOL_FAIR is ' +
          'proven inert rather than proven right — say so.'
      );
    }

    say(`\npage errors: ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
    say(
      '\nVERIFY: DATA — this file REPORTS, it does not assert. Every bound R24 B ships is asserted\n' +
        'deterministically in scripts/r24-b-ringhold.mjs; what lives here are the four measurements\n' +
        'that need a streaming world, so that the round can say which of its claims are earned and\n' +
        'which are still owed.'
    );
    await browser.close();
    process.exit(0);
  } catch (e) {
    say(`\nVERIFY: ERROR — ${e.message}`);
    await browser.close();
    process.exit(1);
  }
})();
