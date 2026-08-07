/**
 * R22 C CLUTTER — self-measurement (NOT a gate; E CERT owns verify-clutter).
 *
 * Produces scripts/r22-c-<pose>.json + r22-c-*.png:
 *   • P-LEWIS fixed pose, flags armed — exact +N draws, per-pool instance and
 *     triangle counts, screenshots at ~120 m AGL.
 *   • Owens gate pose — 0 instances / +0 draws / the scene totals that the
 *     flag-OFF run must match bit-for-bit.
 *   • Powell OH — parked cars on residential streets + the anti-dup ledger.
 *   • Determinism — two independent boots at the same pose with the clock
 *     pinned ('freeze'), instance matrices hashed.
 *
 * Usage:
 *   FLY_URL=http://localhost:3222 node scripts/r22-c-measure.js [pin]
 *     pin = 0 (default, live clock) | freeze | 1 (legacy/flag-off control)
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const PIN = process.argv[2] ?? '0';
const TAG = process.argv[3] ?? '';

const POSES = [
  ['lewis', 40.2083, -83.0701, 120, 20, -12],
  ['powell', 40.1578, -83.0752, 260, 200, -18],
  ['owens', 36.601, -118.06, 500, 45, -10],
  ['manhattan', 40.758, -73.9855, 400, 210, -14],
];

const pinScene = async ([lat, lon, altM, heading, pitch]) => {
  for (let i = 0; i < 120 && !window.__fly?.flight?.pos; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!window.__fly?.flight?.pos) throw new Error('flight handle never returned');
  // RELEASE THE PREVIOUS PIN FIRST. It runs on a setInterval, so during the
  // settle wait below it would drag the aeroplane straight back to the previous
  // pose 125 times a second — and the pose after that would be captured there.
  // (Measured the hard way: four consecutive poses reported identical instance
  // COUNTS with different matrix hashes, which is what "one place, re-placed"
  // looks like from the outside.)
  if (window.__pin) clearInterval(window.__pin);
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  // Then let the DEM answer before the altitude is frozen: at warp time
  // groundElev is still the seeded 0, so pinning pos.y immediately parks the
  // aeroplane at an AGL unrelated to the requested one (a 120 m ask landed at
  // 50 m AGL once the Ohio ground streamed in under it).
  await new Promise((r) => setTimeout(r, 4000));
  f.pos.y = (f.groundElev ?? 0) + altM;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * FNV-1a over every instance matrix of a pool — the determinism instrument.
 *
 * TWO hashes, because they answer two different questions and only one of them
 * is C's to answer. `h` covers the whole matrix. `hxz` SKIPS element 13 (the Y
 * translation), which is the draped DEM height — a quantity that is still
 * refining while the harness measures and that A TERRA is deliberately moving
 * this round (demMaxZoom 15→16). What C owns is the SELECTION and the LAYOUT:
 * which anchors get a car, which chain offsets get a lamp, where in XZ each one
 * stands and which way it faces. That is `hxz`, and that is what has to be a
 * pure function of place.
 */
const hashPool = (name) =>
  ((m) => {
    if (!m || !m.count) return { n: 0, h: '0', hxz: '0' };
    const a = m.instanceMatrix.array;
    let h = 0x811c9dc5;
    let hxz = 0x811c9dc5;
    const mix = (acc, v) => {
      acc ^= v & 0xff;
      acc = Math.imul(acc, 0x01000193);
      acc ^= (v >>> 8) & 0xff;
      acc = Math.imul(acc, 0x01000193);
      acc ^= (v >>> 16) & 0xff;
      return Math.imul(acc, 0x01000193);
    };
    // …and a third, `hset`, which is COMMUTATIVE (per-instance hashes summed
    // mod 2^32). The two above are order-sensitive, and buffer order is a
    // STREAMING artifact here: the pools are filled chunk-by-chunk in
    // nearest-first order, so a ring that resolved its tiles in a different
    // sequence writes the SAME placements at different indices. A gate that
    // cannot tell those apart is testing the streamer, not the placement.
    let hset = 0;
    for (let i = 0; i < m.count * 16; i++) {
      const v = Math.round(a[i] * 100) | 0; // 1 cm
      h = mix(h, v);
      if (i % 16 !== 13) hxz = mix(hxz, v);
    }
    for (let i = 0; i < m.count; i++) {
      let e = 0x811c9dc5;
      for (let j = 0; j < 16; j++) {
        if (j === 13) continue; // the draped DEM height — see above
        e = mix(e, Math.round(a[i * 16 + j] * 100) | 0);
      }
      hset = (hset + (e >>> 0)) >>> 0;
    }
    return {
      n: m.count,
      h: (h >>> 0).toString(16),
      hxz: (hxz >>> 0).toString(16),
      hset: hset.toString(16),
    };
  })(window.__satClutter?.[name]);

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/CORS policy|net::ERR_FAILED|Failed to load resource/.test(t))
      errs.push(`console: ${t.slice(0, 200)}`);
  });

  // The pool sizes are read at MOUNT (an InstancedMesh cannot grow), so the pin
  // has to be in place before the app boots. scripts/_boot.js writes 1 for the
  // whole fleet; this makes that write a no-op instead of racing it — an
  // ordinary init script added first would simply be overwritten by _boot's.
  await page.addInitScript((v) => {
    let cur = v === '1' ? 1 : v === 'freeze' ? 'freeze' : 0;
    Object.defineProperty(window, '__flyClutterPin', {
      get: () => cur,
      set: () => {},
      configurable: true,
    });
  }, PIN);

  await bootFly(page, { ...BOOT_OPTS, style: 'satellite' });
  await page.waitForTimeout(2500);

  const out = { pin: PIN, poses: {}, errs: [] };
  for (const pose of POSES) {
    const [name] = pose;
    await page.evaluate(pinScene, pose.slice(1));
    await page.waitForTimeout(14000); // stream-in + two placement cadences

    const s = await page.evaluate(() => {
      return {
        draws: window.__flyStats?.drawCalls ?? -1,
        tris: window.__flyStats?.triangles ?? -1,
        clutter: window.__flyStats?.satClutter ?? null,
        contract: window.__flyStats?.clutter ?? null,
        treeGeo: (() => {
          const m = window.__satVeg?.mesh;
          if (!m?.geometry?.index) return null;
          const g = m.geometry;
          g.computeBoundingBox();
          const b = g.boundingBox;
          return {
            tris: g.index.count / 3,
            bboxY: [+b.min.y.toFixed(3), +b.max.y.toFixed(3)],
            bboxX: [+b.min.x.toFixed(3), +b.max.x.toFixed(3)],
            hasColor: !!g.attributes.color,
          };
        })(),
        veg: window.__flyStats?.satVeg ?? null,
        parcel: window.__flyStats?.parcelHomes ?? null,
        agl: Math.max(
          0,
          (window.__fly?.flight?.pos?.y ?? 0) - (window.__fly?.flight?.groundElev ?? 0)
        ),
      };
    });
    const hashes = await page.evaluate(
      (fn) => ({
        parked: eval(`(${fn})`)('parkedMesh'),
        movers: eval(`(${fn})`)('moverMesh'),
        poles: eval(`(${fn})`)('poleMesh'),
      }),
      hashPool.toString()
    );
    out.poses[name] = { ...s, hashes };
    console.log(
      `${name.padEnd(10)} draws=${s.draws} tris=${s.tris} ` +
        `parked=${s.clutter?.parked} movers=${s.clutter?.movers} poles=${s.clutter?.poles} ` +
        `+draws=${s.clutter?.draws} clutterTris=${s.clutter?.tris} ` +
        `anchors=${s.clutter?.anchors} colSup=${s.clutter?.colSuppressed} ` +
        `dupSup=${s.clutter?.dupSuppressed} juncSup=${s.clutter?.juncSuppressed} ` +
        `veg=${s.veg?.placed} agl=${Math.round(s.agl)}`
    );
    console.log(
      `           SET-hash parked=${hashes.parked.n}/${hashes.parked.hset} ` +
        `movers=${hashes.movers.n}/${hashes.movers.hset} poles=${hashes.poles.n}/${hashes.poles.hset}` +
        `  |  full parked=${hashes.parked.h} movers=${hashes.movers.h} poles=${hashes.poles.h}`
    );
    await page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot({ path: path.join(__dirname, `r22-c-${name}${TAG}-pin${PIN}.png`) });
  }

  out.errs = errs;
  fs.writeFileSync(
    path.join(__dirname, `r22-c-measure${TAG}-pin${PIN}.json`),
    JSON.stringify(out, null, 2)
  );
  console.log(errs.length ? `ERRORS: ${errs.slice(0, 5).join(' | ')}` : 'no page errors');
  await browser.close();
})();
