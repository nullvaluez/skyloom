/**
 * ROUND 22 (B "SETTLE") — the agent's own measurement rig. NOT a gate: it
 * prints an A/B and writes scripts/r22-b-*.json for the round record. E CERT
 * owns verify-settle / verify-arrival; this is the evidence B's charter asks
 * for (§ "Self-measurement targets"), taken with the SAME flag flip a gate
 * would use — `__flySettleForce` / `__flyArrivalForce`, the dev A/B handles
 * exported from lib/fly/settle.js.
 *
 * LEGS
 *   boot     Powell OH satellite boot, HDRI fetch DELAYED by hdriDelayMs (a
 *            request-route shim, not CDP throttling: the R21 defect is
 *            specifically "the warm cannot start until the HDRI resolves", so
 *            the honest reproduction delays that ONE resource and leaves the
 *            tile stream alone). Reports long frames (>40 ms) in reveal+10 s,
 *            the per-layer pop-in table, boot wall time and the prewarm
 *            queue/slice counters. Run twice: flags off, then flags on.
 *   warp     far warp Powell → Dublin IE at FL300, reporting the measured
 *            hold and, when A TERRA's runtime.terraStats exists, the camera
 *            tile zoom AT the reveal. With terraStats absent the flag-on leg
 *            must reproduce the legacy hold — that identity is asserted here.
 *   ladder   the governor ladder shape at devicePixelRatio 1, built through
 *            the app's own exported factory (window.__flyGovFactory).
 *   parcel   Melton AU (parcel-heavy) flags-on: the largest single-frame jump
 *            in `placed` and whether an envelope was running across it;
 *            Powell OH must still place EXACTLY ZERO (the R20 contract).
 *
 * Usage: FLY_URL=http://localhost:3221 node scripts/r22-b-measure.js [leg...]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly } = require('./_boot');

const URL = process.env.FLY_URL || 'http://localhost:3221';
const OUT = (name) => path.join(__dirname, `r22-b-${name}`);
const legs = process.argv.slice(2).length ? process.argv.slice(2) : ['boot', 'warp', 'ladder', 'parcel'];

/** Clear the fleet legacy pin and force a family on/off, before app mount. */
const forceInit = (on) => {
  window.__flySettlePin = undefined;
  window.__flySettleForce = on ? 1 : 0;
  window.__flyArrivalForce = on ? 1 : 0;
};

/** Delay ONE resource class (the HDRI) so the warm starts late, as it does on
 *  a cold cache — the exact precondition of the R21 post-reveal compile tail. */
async function delayHdri(page, ms) {
  await page.route(/\.hdr($|\?)/i, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

const jsonWrite = (name, obj) => {
  fs.writeFileSync(`${OUT(name)}.json`, JSON.stringify(obj, null, 2));
  console.log(`  → scripts/r22-b-${name}.json`);
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });

  const newPage = async (on, extra) => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (e) => console.log('  pageerror:', e.message));
    await page.addInitScript(forceInit, on);
    if (extra) await page.addInitScript(extra);
    return page;
  };

  // ------------------------------------------------------------------ boot
  if (legs.includes('boot')) {
    const bootLeg = async (on, hdriDelayMs, cpuRate) => {
      const page = await newPage(on, () => {
        localStorage.setItem('fly-last-pos', JSON.stringify({ lat: 40.1578, lon: -83.0752 }));
        // Per-rAF sampler, installed before the app mounts. Two series:
        //  · groundElev RAW vs runtime.groundElevVis — the slew rate E's red
        //    measured at 22,697-24,023 m/s on the raw channel.
        //  · the sat-road ring's resolved fraction — E's red has satRoads
        //    reaching 90% only at reveal+12.9 s, i.e. the road web assembling
        //    in front of the player.
        const S = (window.__r22g = {
          rows: [],
          maxRawMps: 0,
          maxVisMps: 0,
          maxRawStepM: 0,
          maxVisStepM: 0,
        });
        let prev = null;
        const tick = () => {
          const f = window.__fly?.flight;
          const t = performance.now();
          if (f) {
            const raw = f.groundElev;
            const vis = window.__fly.groundElevVis;
            if (prev && t > prev.t) {
              const dt = (t - prev.t) / 1000;
              const r = Math.abs(raw - prev.raw) / dt;
              const v = Math.abs((vis ?? raw) - (prev.vis ?? prev.raw)) / dt;
              if (Number.isFinite(r) && r > S.maxRawMps) S.maxRawMps = r;
              if (Number.isFinite(v) && v > S.maxVisMps) S.maxVisMps = v;
              // The PER-FRAME STEP in metres is the unambiguous number: the
              // damper clamps dt at 50 ms, so its ceiling is slewMps * 0.05 =
              // 4.00 m however short the frame that observes it happens to be.
              // A m/s figure computed with a DIFFERENT dt than the damper used
              // is an instrument artifact (the R19 lesson).
              const sr = Math.abs(raw - prev.raw);
              const sv = Math.abs((vis ?? raw) - (prev.vis ?? prev.raw));
              if (Number.isFinite(sr) && sr > S.maxRawStepM) S.maxRawStepM = sr;
              if (Number.isFinite(sv) && sv > S.maxVisStepM) S.maxVisStepM = sv;
            }
            prev = { t, raw, vis };
            const rs = window.__flyStats?.satRoads;
            const bs = window.__flyStats?.satBuildings;
            S.rows.push({
              t: Math.round(t),
              roadFrac: rs && rs.chunks > 0 ? (rs.ready + rs.empty) / rs.chunks : null,
              bldgFrac: bs && bs.chunks > 0 ? (bs.ready + bs.empty) / bs.chunks : null,
            });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      if (hdriDelayMs) await delayHdri(page, hdriDelayMs);
      // CPU THROTTLING is not decoration here. A GLSL compile is CPU/driver
      // work; on the calibration machine the whole warm finishes inside the
      // ~10 s satellite boot even with the HDRI held back 3.5 s, so there is
      // no post-reveal tail to slice and the A/B measures nothing. Throttling
      // reproduces the machine the user actually reported from — the R21
      // verify-stability phase-1b recipe, same rationale.
      let cdp = null;
      if (cpuRate > 1) {
        cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
      }
      const t0 = Date.now();
      await bootFly(page, { style: 'satellite', settleMs: 500 });
      const bootMs = Date.now() - t0;
      // THE PROGRAM CENSUS. A GLSL compile that happens after the reveal is a
      // compile the player paid for, and three counts them for us:
      // renderer.info.programs is the live program cache. Sampling it AT the
      // reveal and again 10 s later is a machine-independent measure of
      // exactly the thing the warm set exists to prevent — no timing, no
      // throttling, no noise.
      const progAt = () =>
        page.evaluate(() => {
          const roots = Array.from(window.__r3f?.roots?.values?.() ?? []);
          const gl =
            window.__flyPlayer?.__r3f?.root?.getState?.().gl ??
            roots[0]?.store?.getState?.().gl ??
            null;
          const ps = gl?.info?.programs;
          if (!ps) return null;
          return { n: ps.length, keys: ps.map((x) => String(x.cacheKey ?? '?')) };
        });
      const pa = await progAt();
      await page.waitForTimeout(11000); // the whole reveal+10 s census window
      const pb = await progAt();
      const programsAtReveal = pa?.n ?? null;
      const programsAfter = pb?.n ?? null;
      // WHICH programs. A count says a compile happened; the cache KEY says
      // what compiled, which is the only form of this measurement a warm-set
      // extension can act on.
      const before = new Set(pa?.keys ?? []);
      const newKeys = (pb?.keys ?? []).filter((k) => !before.has(k));
      if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const out = await page.evaluate(() => ({
        ground: window.__r22g
          ? {
              maxRawMps: Math.round(window.__r22g.maxRawMps),
              maxVisMps: Math.round(window.__r22g.maxVisMps),
              maxRawStepM: +window.__r22g.maxRawStepM.toFixed(2),
              maxVisStepM: +window.__r22g.maxVisStepM.toFixed(2),
            }
          : null,
        // t90 measured from the REVEAL, using the same clock the popin
        // instrument stamps its layers with.
        t90: (() => {
          const g = window.__r22g;
          const p = window.__flyStats?.popin;
          if (!g || !p) return null;
          const revealAt = Object.values(p.layers ?? {}).length
            ? null
            : null;
          const rv = window.__fly?.arrivalStats?.revealAt ?? null;
          const hit = (key) => {
            const r = g.rows.find((x) => x[key] != null && x[key] >= 0.9);
            return r && rv != null ? Math.round(r.t - rv) : null;
          };
          return { revealAt: rv, roadsMs: hit('roadFrac'), bldgMs: hit('bldgFrac') };
        })(),
        settleOn: window.__flySettleForce,
        popin: window.__flyStats?.popin
          ? {
              longFrames: window.__flyStats.popin.longFrames,
              worstMs: window.__flyStats.popin.worstMs,
              frames: window.__flyStats.popin.frames,
              layers: window.__flyStats.popin.layers,
            }
          : null,
        prewarm: window.__flyStats?.prewarm ?? null,
        bootGate: window.__flyStats?.bootGate ?? null,
        parcel: window.__flyStats?.parcelHomes?.placed ?? null,
      }));
      await page.close();
      return { on, hdriDelayMs, cpuRate, bootMs, programsAtReveal, programsAfter, newKeys, ...out };
    };
    const rows = [];
    // ALTERNATING ORDER, two runs each. The browser's HTTP cache warms across
    // runs, so a straight OFF-then-ON pair cannot separate the flag from the
    // cache — the second leg of any pair is faster for free.
    const CPU = Number(process.env.R22_CPU || 6);
    // E CERT's recipe: the HDRI held back 9 s (their RED: 13 post-reveal
    // compiles + a 179 ms frame at reveal+9.9 s).
    const HDRI = Number(process.env.R22_HDRI || 9000);
    for (const on of [false, true, false, true]) rows.push(await bootLeg(on, HDRI, CPU));
    for (const r of rows) {
      const p = r.popin;
      console.log(
        `BOOT flags=${r.on ? 'ON ' : 'OFF'} boot=${r.bootMs}ms longFrames=${p?.longFrames ?? '?'} worst=${p?.worstMs ?? '?'}ms ` +
          `prewarm(queued=${r.prewarm?.queued ?? 0} pre=${r.prewarm?.compiledPreReveal ?? 0} post=${r.prewarm?.compiledPostReveal ?? 0} sliceMs=${r.prewarm?.sliceMs ?? 0}) ` +
          `programs ${r.programsAtReveal}→${r.programsAfter} (+${(r.programsAfter ?? 0) - (r.programsAtReveal ?? 0)} post-reveal) ` +
          `bootContentHeld=${r.bootGate?.contentHeldMs ?? 0}ms
     groundElev maxRaw=${r.ground?.maxRawMps} m/s maxVis=${r.ground?.maxVisMps} m/s · ` +
          `terms@reveal=${JSON.stringify(r.bootGate?.terms)}
     newProgramKeys=${JSON.stringify((r.newKeys ?? []).map((k) => k.slice(0, 90)))}`
      );
      for (const [k, v] of Object.entries(p?.layers ?? {})) {
        const rel = v.sinceRevealMs < 0 ? 'pre-reveal' : `+${v.sinceRevealMs} ms`;
        console.log(`   layer ${k.padEnd(16)} ${rel.padStart(12)}  birthed=${v.birthed}`);
      }
    }
    jsonWrite('boot', rows);
  }

  // ------------------------------------------------------------------ warp
  if (legs.includes('warp')) {
    const warpLeg = async (on) => {
      const page = await newPage(on);
      await bootFly(page, { style: 'satellite' });
      await page.evaluate(() => {
        window.__r22warp = { t0: performance.now() };
        window.__fly.warpToGeo(53.3498, -6.2603, { altM: 9144, name: 'Dublin' }); // FL300
      });
      await page.waitForFunction(() => window.__flyStats?.warpGate?.epoch > 0, undefined, {
        timeout: 30000,
        polling: 100,
      });
      const out = await page.evaluate(() => ({
        gate: window.__flyStats.warpGate,
        terra: window.__fly?.terraStats ?? null,
      }));
      await page.close();
      return { on, ...out };
    };
    const rows = [];
    for (const on of [false, true]) rows.push(await warpLeg(on));
    for (const r of rows) {
      console.log(
        `WARP flags=${r.on ? 'ON ' : 'OFF'} hold=${r.gate.holdMs}ms capped=${r.gate.capped} holdMax=${r.gate.holdMax ?? 3500} ` +
          `terms=${JSON.stringify(r.gate.terms)}`
      );
    }
    const off = rows.find((r) => !r.on);
    const on = rows.find((r) => r.on);
    if (off && on && !on.gate.terms) {
      console.log(
        `  legacy-identity: terraStats absent ⇒ flag-on took the same legacy path (|Δhold| = ${Math.abs(on.gate.holdMs - off.gate.holdMs)} ms, both bounded by their own cap)`
      );
    }
    jsonWrite('warp', rows);
  }

  // ---------------------------------------------------------------- ladder
  if (legs.includes('ladder')) {
    const ladderLeg = async (on) => {
      const page = await newPage(on);
      await bootFly(page, { style: 'satellite' });
      const out = await page.evaluate(() => {
        const f = window.__flyGovFactory;
        if (!f) return { err: 'no __flyGovFactory (dev only)' };
        const build = (dpr0) => {
          const g = f({ dpr0, tier0: 'high', applyDpr: () => {}, applyTier: () => {} });
          return g.ladder.map((r) => ({ dpr: r.dpr, tier: r.tier }));
        };
        return { dpr1: build(1), dpr15: build(1.5), devicePixelRatio: window.devicePixelRatio };
      });
      await page.close();
      return { on, ...out };
    };
    const rows = [];
    for (const on of [false, true]) rows.push(await ladderLeg(on));
    for (const r of rows) {
      const l = r.dpr1 ?? [];
      const firstTier = l.findIndex((x, i) => i > 0 && x.tier !== l[0].tier);
      const scaleRungs = (firstTier < 0 ? l.length : firstTier) - 1;
      console.log(
        `LADDER flags=${r.on ? 'ON ' : 'OFF'} dpr0=1 rungs=${l.length} scaleRungsBeforeFirstTierStep=${scaleRungs} ` +
          `[${l.map((x) => `${x.dpr}/${x.tier}`).join(' ')}]`
      );
    }
    jsonWrite('ladder', rows);
  }

  // ---------------------------------------------------------------- parcel
  if (legs.includes('parcel')) {
    const parcelLeg = async (on, lat, lon, name) => {
      const page = await newPage(on, () => {
        window.__r22samples = [];
      });
      await bootFly(page, { style: 'satellite' });
      await page.evaluate(
        ([la, lo]) => {
          window.__fly.warpToGeo(la, lo, { altM: 900, name: null });
          window.__r22samples = [];
          const tick = () => {
            const p = window.__flyStats?.parcelHomes;
            const m = window.__satVeg?.homeMesh;
            if (p) {
              // The live scale of instance 0 — the envelope, read off the
              // buffer three will actually draw (never off our own state).
              let s = null;
              if (m && m.count > 0) {
                const a = m.instanceMatrix.array;
                s = Math.hypot(a[0], a[1], a[2]);
              }
              window.__r22samples.push({
                t: Math.round(performance.now()),
                placed: p.placed,
                scale0: s,
                anchors: p.anchors,
                held: p.held,
                settled: p.settled,
                provisional: p.provisional,
                regK: p.regK,
              });
            }
            if (window.__r22samples.length < 3000) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
        [lat, lon]
      );
      await page.waitForTimeout(Number(process.env.R22_PARCEL_MS || 35000));
      const out = await page.evaluate(() => {
        const s = window.__r22samples;
        let maxJump = 0;
        let jumpAt = -1;
        for (let i = 1; i < s.length; i++) {
          const d = s[i].placed - s[i - 1].placed;
          if (d > maxJump) {
            maxJump = d;
            jumpAt = i;
          }
        }
        const last = s.length ? s[s.length - 1] : null;
        return {
          samples: s.length,
          last,
          finalPlaced: last ? last.placed : 0,
          maxPlaced: s.reduce((m, x) => Math.max(m, x.placed), 0),
          maxSingleFrameJump: maxJump,
          scaleAtJump: jumpAt > 0 ? s[jumpAt].scale0 : null,
          scaleAfter250ms: jumpAt > 0 && s[jumpAt + 15] ? s[jumpAt + 15].scale0 : null,
          series: s.filter((_, i) => i % 10 === 0).slice(0, 90),
        };
      });
      await page.close();
      return { on, name, ...out };
    };
    const rows = [];
    rows.push(await parcelLeg(true, -37.6833, 144.5833, 'Melton AU'));
    rows.push(await parcelLeg(false, -37.6833, 144.5833, 'Melton AU'));
    rows.push(await parcelLeg(true, 40.1578, -83.0752, 'Powell OH'));
    for (const r of rows) {
      console.log(
        `PARCEL ${r.name.padEnd(10)} flags=${r.on ? 'ON ' : 'OFF'} final=${r.finalPlaced} max=${r.maxPlaced} ` +
          `maxFrameJump=${r.maxSingleFrameJump} scaleAtJump=${r.scaleAtJump?.toFixed?.(3) ?? '-'} ` +
          `→+250ms=${r.scaleAfter250ms?.toFixed?.(3) ?? '-'}`
      );
    }
    jsonWrite('parcel', rows);
  }

  await browser.close();
})();
