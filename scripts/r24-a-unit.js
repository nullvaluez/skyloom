/**
 * ROUND 24 (A "MOTION HOLD") — r24-a-unit: THE PATCHES, EXERCISED IN-PROCESS.
 *
 * WHY THIS FILE EXISTS. R24's ship set is five vendored patch sites and one
 * engine-side retry loop, and the machine this round was built on cannot grade
 * a browser run: both Esri hosts and OpenFreeMap answer 403 to CONNECT (proven
 * with `curl -sS "$HTTPS_PROXY/__agentproxy/status"`), and the renderer is
 * SwiftShader at ~1 fps, which E's `_world-precondition.js` shows makes a timed
 * motion leg meaningless anyway. So every browser probe in this round exits
 * BLOCKED here, by design — and BLOCKED is not evidence.
 *
 * This file is the evidence that CAN be taken here. `lib/fly/vendor/three-tile/
 * index.js` imports exactly one bare specifier (`three`) and nothing
 * extensionless, so unlike every other file in `lib/fly/` it is importable by
 * plain Node. That means patches #6a/#6b/#6c/#7/#8 can be run against the REAL
 * `Tile` class rather than against a re-typed model of it — the distinction
 * R20 §5 paid for when a brand-new harness "matched prose as code".
 *
 * `lib/fly/raster-cache.js` is NOT directly importable (`import … from
 * './fly-constants'` has no extension, which plain Node ESM refuses), so §6
 * loads it through a specifier-only redirect into the scratchpad and ASSERTS
 * that exactly the two expected substitutions were made. It is the real
 * function body under test, not a copy of its idea.
 *
 * EXIT CODES: 0 = VERIFY: PASS · 1 = VERIFY: FAIL. There is no BLOCKED path —
 * nothing here touches the network or a GPU, so this probe is always gradeable,
 * which is the whole point of having it.
 *
 * RUN: node scripts/r24-a-unit.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const VENDOR = path.resolve(__dirname, '../lib/fly/vendor/three-tile/index.js');
const RASTER = path.resolve(__dirname, '../lib/fly/raster-cache.js');

let pass = 0;
const fails = [];
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fails.push(name);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const M = await import('file://' + VENDOR);
  const { Tile, setFlyPatch, flyGetPatch, flyTileHoldStats } = M;

  /** Reset every switch to the value that means "upstream". */
  const OFF = () =>
    setFlyPatch({
      mergeDwellMs: 0,
      frustumPenalty: 5,
      lodHysteresis: 1,
      unlockOnReject: false,
      rasterMark: false,
    });

  /**
   * A Tile with the two things LOD() needs stubbed out: the size cache (so
   * `_getTileSize` is a no-op) and the evaluator (so a test scripts the verdict
   * instead of building a camera). Everything else — the dwell state machine,
   * the merge/refine dispatch, the return value — is the shipped code.
   */
  const mkTile = (z = 13) => {
    const t = new Tile(0, 0, z);
    t._sizeInWorld = 1000;
    t._subTiles = ['stub']; // truthy: LOD()'s merge branch is guarded on it
    t.calls = { load: 0, remove: 0 };
    t._loadSubTiles = function () {
      this.calls.load++;
      return Promise.resolve(true);
    };
    t._removeSubTiles = function () {
      this.calls.remove++;
      return Promise.resolve(true);
    };
    return t;
  };
  const scripted = (t, verdict) => {
    t._LODEvaluate = () => verdict;
  };
  const P = { minLevel: 2, maxLevel: 18, LODThreshold: 0.86 };

  /* ═══════════ §1  PATCH #6a — THE MERGE DWELL STATE MACHINE ═══════════ */
  console.log('\n── §1 patch #6a (mergeDwellMs) ──');

  // (1) OFF is upstream: a merge verdict destroys the subtree on the same tick.
  OFF();
  {
    const t = mkTile();
    scripted(t, 2);
    const r = t.LOD(P);
    gate(
      '(1) dwell OFF — merge fires on the tick it is wanted',
      t.calls.remove === 1 && r === 2,
      `remove=${t.calls.remove} LOD()=${r}`
    );
  }

  // (2) ARMED: the same verdict is HELD, and the return value is still `s`.
  //     This is the whole defect fix in one assertion — an out-of-frustum
  //     subtree survives the tick that used to destroy it.
  setFlyPatch({ mergeDwellMs: 400 });
  {
    const t = mkTile();
    scripted(t, 2);
    const before = flyTileHoldStats().dwellHeld;
    const r = t.LOD(P);
    const r2 = t.LOD(P);
    gate(
      '(2) dwell ARMED — merge is deferred, LOD() still returns 2',
      t.calls.remove === 0 && r === 2 && r2 === 2,
      `remove=${t.calls.remove} LOD()=${r},${r2} dwellHeld+${flyTileHoldStats().dwellHeld - before}`
    );
  }

  // (3) …and it is a DELAY, not a veto: past the dwell the merge goes ahead.
  //     This is what makes the settled tree converge on upstream's, which is
  //     the identity argument every frozen gate rests on.
  {
    const t = mkTile();
    scripted(t, 2);
    t.LOD(P);
    await sleep(460);
    const r = t.LOD(P);
    gate(
      '(3) dwell EXPIRES — the merge is delayed, never cancelled',
      t.calls.remove === 1 && r === 2,
      `remove=${t.calls.remove} after ~460ms of a 400ms dwell`
    );
  }

  // (4) The release. A tile that comes back into view inside the window keeps
  //     its children AND its clock is reset, so a serpentine that re-crosses
  //     the boundary can never accumulate its way to a merge.
  {
    const t = mkTile();
    scripted(t, 2);
    t.LOD(P); // arm
    await sleep(300);
    scripted(t, 0); // back in frustum
    t.LOD(P);
    scripted(t, 2); // and out again
    t.LOD(P); // re-arms from zero
    await sleep(200); // 500ms total, but only 200ms on the current arm
    const r = t.LOD(P);
    gate(
      '(4) dwell RELEASES on any non-merge verdict (re-arms from zero)',
      t.calls.remove === 0 && t._mergeWantSince > 0 && r === 2,
      `remove=${t.calls.remove} (500ms elapsed, 200ms armed, dwell 400ms)`
    );
  }

  // (5) The refine path must be untouched: this round holds merges, it does not
  //     slow the descent down. A dwell that delayed subdivision would make the
  //     ground BLURRIER, i.e. it would ship the defect it is fixing.
  {
    const t = mkTile();
    t._subTiles = undefined; // a leaf
    t._inFrustum = true;
    scripted(t, 1);
    const r = t.LOD(P);
    gate(
      '(5) refine is NOT dwelled — subdivision still fires immediately',
      t.calls.load === 1 && r === 1,
      `load=${t.calls.load} LOD()=${r}`
    );
  }

  // (6) The counters move, so a gate can prove the path was EXERCISED rather
  //     than merely armed (the verify-frame-pace `flySkirtStats` lesson).
  {
    const s = flyTileHoldStats();
    gate(
      '(6) receipts move — dwellArmed/Held/Fired all non-zero',
      s.dwellArmed > 0 && s.dwellHeld > 0 && s.dwellFired > 0,
      `armed=${s.dwellArmed} held=${s.dwellHeld} fired=${s.dwellFired}`
    );
  }

  /* ═══════════ §2  PATCH #6b — frustumPenalty ═══════════ */
  console.log('\n── §2 patch #6b (frustumPenalty) ──');
  OFF();
  {
    // N (the camera world position) is the module's zero vector until update()
    // runs, so a tile placed at (300, 0, 400) sits exactly 500 away.
    const mk = (inFrustum) => {
      const t = new Tile(0, 0, 13);
      t._sizeInWorld = 100;
      t._maxZ = 0;
      t.matrixWorld.elements[12] = 300;
      t.matrixWorld.elements[14] = 400;
      t._inFrustum = inFrustum;
      return t;
    };
    const out = mk(false);
    const inn = mk(true);
    const baseOut = out._getDistRatio();
    const baseIn = inn._getDistRatio();
    gate(
      '(7) OFF is the upstream literal — out×5, in×0.8',
      near(baseOut, 25) && near(baseIn, 4),
      `out=${baseOut} (want 25) in=${baseIn} (want 4)`
    );
    setFlyPatch({ frustumPenalty: 1.6 });
    const swept = out._getDistRatio();
    const inSwept = inn._getDistRatio();
    gate(
      '(8) the knob moves ONLY the out-of-frustum branch',
      near(swept, 8) && near(inSwept, 4),
      `out=${swept} (want 8) in=${inSwept} (want 4, unmoved)`
    );
    // A malformed constants block must not be able to change the world.
    setFlyPatch({ frustumPenalty: 0 });
    const zeroed = out._getDistRatio();
    setFlyPatch({ frustumPenalty: null });
    const nulled = out._getDistRatio();
    gate(
      '(9) 0 / null fall back to upstream 5, not to 0',
      near(zeroed, 25) && near(nulled, 25),
      `zero=${zeroed} null=${nulled}`
    );
  }

  /* ═══════════ §3  PATCH #6c — lodHysteresis ═══════════ */
  console.log('\n── §3 patch #6c (lodHysteresis) ──');
  OFF();
  {
    const mk = (ratio, leaf) => {
      const t = new Tile(0, 0, 13);
      t._getDistRatio = () => ratio;
      Object.defineProperty(t, 'isLeaf', { value: leaf, configurable: true });
      return t;
    };
    const T = 0.86;
    // Interior node just past the threshold: upstream merges it.
    gate(
      '(10) H=1 (shipped) is the upstream expression — merge at n > T',
      mk(0.87, false)._LODEvaluate(2, 18, T) === 2 && mk(0.85, false)._LODEvaluate(2, 18, T) === 0,
      `n=0.87→${mk(0.87, false)._LODEvaluate(2, 18, T)} n=0.85→${mk(0.85, false)._LODEvaluate(2, 18, T)}`
    );
    setFlyPatch({ lodHysteresis: 1.35 });
    const inBand = mk(1.0, false)._LODEvaluate(2, 18, T); // 0.86 < 1.0 < 1.161
    const past = mk(1.3, false)._LODEvaluate(2, 18, T);
    const refine = mk(0.5, true)._LODEvaluate(2, 18, T);
    gate(
      '(11) H=1.35 opens a deadband on MERGE only, refine keeps T',
      inBand === 0 && past === 2 && refine === 1,
      `n=1.00→${inBand} (want 0) n=1.30→${past} (want 2) leaf n=0.50→${refine} (want 1)`
    );
  }

  /* ═══════════ §4  PATCH #7 — unlockOnReject ═══════════ */
  console.log('\n── §4 patch #7 (unlockOnReject) ──');
  {
    /** A loader whose every update() throws — the transient this protects. */
    const badLoader = {
      update() {
        throw new Error('r24-unit synthetic transport failure');
      },
    };
    const params = { loader: badLoader, minLevel: 2, maxLevel: 18, LODThreshold: 0.86 };

    /* --- _loadSubTiles: THE PERMANENT BRICK, and the un-brick ------------- */
    // RED (OFF): the rejection escapes AND `_subTiles` stays set, which is what
    // makes LOD()'s `!this.subTiles` guard refuse to ever refine this node
    // again. Proving the RED here is what makes the GREEN below mean something.
    OFF();
    {
      const t = new Tile(0, 0, 13);
      let threw = false;
      await t._loadSubTiles(params).catch(() => (threw = true));
      gate(
        '(12) RED _loadSubTiles OFF — rejects and leaves _subTiles SET (bricked)',
        threw && !!t.subTiles,
        `threw=${threw} subTiles=${t.subTiles ? 'set (can never refine again)' : 'clear'}`
      );
    }
    setFlyPatch({ unlockOnReject: true });
    {
      const t = new Tile(0, 0, 13);
      const before = flyTileHoldStats().rejectLoad;
      let threw = false;
      const r = await t._loadSubTiles(params).catch(() => (threw = true));
      gate(
        '(13) GREEN _loadSubTiles ON — resolves false, _subTiles CLEARED, counted',
        !threw && r === false && t.subTiles === undefined &&
          flyTileHoldStats().rejectLoad === before + 1,
        `threw=${threw} ret=${r} subTiles=${t.subTiles} rejectLoad+${flyTileHoldStats().rejectLoad - before}`
      );
    }

    /* --- _removeSubTiles: THE FROZEN SUBTREE ------------------------------ */
    /** An interior node with four real Tile children, as a merge finds it. */
    const mkInterior = () => {
      const t = new Tile(0, 0, 13);
      const kids = [new Tile(0, 0, 14), new Tile(1, 0, 14), new Tile(0, 1, 14), new Tile(1, 1, 14)];
      t.add(...kids);
      t._subTiles = kids;
      return { t, kids };
    };
    OFF();
    {
      const { t } = mkInterior();
      let threw = false;
      await t._removeSubTiles(params).catch(() => (threw = true));
      gate(
        '(14) RED _removeSubTiles OFF — rejects and leaves _loadState "loading"',
        threw && t.loadState === 'loading' && t.subTiles === undefined,
        `threw=${threw} loadState=${t.loadState} (this and its whole subtree stop updating)`
      );
    }
    setFlyPatch({ unlockOnReject: true });
    {
      const { t, kids } = mkInterior();
      const before = flyTileHoldStats().rejectMerge;
      let threw = false;
      const r = await t._removeSubTiles(params).catch(() => (threw = true));
      const restored = Array.isArray(t.subTiles) && t.subTiles.length === kids.length;
      gate(
        '(15) GREEN _removeSubTiles ON — state un-frozen, _subTiles RESTORED',
        !threw && r === false && t.loadState !== 'loading' && restored &&
          t.model === undefined && flyTileHoldStats().rejectMerge === before + 1,
        `loadState=${t.loadState} subTiles=${restored ? kids.length + ' kids' : t.subTiles} model=${t.model}`
      );
      // The node must be a WORKING interior node again: able to merge (guarded
      // on subTiles) and correctly not a leaf. A recovery that left it unable to
      // do either would be a different permanent brick.
      gate(
        '(16) …and it is a working interior node again (can merge, is not a leaf)',
        !!t.subTiles && t.isLeaf === false,
        `subTiles=${!!t.subTiles} isLeaf=${t.isLeaf} children=${t.children.length}`
      );
    }

    /* --- _updateModel: the same freeze, plus the retry-storm guard --------- */
    const mkWithModel = () => {
      const t = new Tile(0, 0, 13);
      t._model = { maxHeight: 0, removeFromParent() {}, dispose() {}, syncShadow() {} };
      t._root._epoch = 7;
      t._loadedEpoch = 3;
      return t;
    };
    OFF();
    {
      const t = mkWithModel();
      let threw = false;
      await t._updateModel(badLoader).catch(() => (threw = true));
      gate(
        '(17) RED _updateModel OFF — rejects and leaves _loadState "loading"',
        threw && t.loadState === 'loading',
        `threw=${threw} loadState=${t.loadState}`
      );
    }
    setFlyPatch({ unlockOnReject: true });
    {
      const t = mkWithModel();
      const before = flyTileHoldStats().rejectUpdate;
      let threw = false;
      await t._updateModel(badLoader).catch(() => (threw = true));
      gate(
        '(18) GREEN _updateModel ON — un-frozen AND epoch advanced (no 20Hz storm)',
        !threw && t.loadState === 'loaded' && t._loadedEpoch === 7 &&
          flyTileHoldStats().rejectUpdate === before + 1,
        `loadState=${t.loadState} loadedEpoch=${t._loadedEpoch} (root epoch 7)`
      );
    }
  }

  /* ═══════════ §5  PATCH #8 — the error-material re-ask ═══════════ */
  console.log('\n── §5 patch #8 (rasterMark) ──');
  {
    // The reuse test upstream is `userData.source === l`. Patch #8 stamps that
    // source (making the failure censusable) and adds `flyError`, which is what
    // actually re-opens the re-ask — stamping the source ALONE would have made
    // the black material REUSED FOREVER, the exact opposite of the intent.
    const src = fs.readFileSync(VENDOR, 'utf8');
    const guard = src.includes("r.find((c) => c?.userData?.source === l && !c?.userData?.flyError)");
    const stamp = src.includes('m.userData.source = l, m.userData.flyError = 1');
    gate(
      '(19) the reuse test excludes flyError-marked materials',
      guard,
      guard ? 'error materials are re-asked, not reused' : 'GUARD MISSING'
    );
    gate('(20) the error material is stamped and counted', stamp);
    gate(
      '(21) flag-off identity — flyError is set nowhere but behind FLY_PATCH.rasterMark',
      (src.match(/userData\.flyError = 1/g) || []).length === 1 &&
        src.includes('FLY_PATCH.rasterMark && (m.userData.source = l'),
      'so the guard above reads `!undefined` === true, i.e. upstream, when off'
    );
  }

  /* ═══════════ §6  raster-cache — THE BOUNDED RETRY ═══════════ */
  console.log('\n── §6 TILE_HOLD.raster (lib/fly/raster-cache.js) ──');
  {
    // raster-cache.js imports './fly-constants' with no extension, which plain
    // Node ESM refuses, so it is loaded through a specifier-only redirect and
    // the substitution count is ASSERTED — the body under test is the real one.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r24a-'));
    // The shim needs to resolve the bare specifier `three` exactly as the real
    // file does. Symlinking the repo's node_modules beside it is the smallest
    // way to get that without rewriting a third specifier and guessing at
    // three's build filename. `fs.rmSync` unlinks symlinks rather than
    // following them, so the cleanup below cannot reach the real tree.
    try {
      fs.symlinkSync(path.resolve(__dirname, '../node_modules'), path.join(dir, 'node_modules'), 'dir');
    } catch {
      /* falls through to a clear ERR_MODULE_NOT_FOUND rather than a silent skip */
    }
    let src = fs.readFileSync(RASTER, 'utf8');
    let subs = 0;
    src = src.replace("from './fly-constants'", () => (subs++, "from './fly-constants.js'"));
    src = src.replace(
      "from './vendor/three-tile/index.js'",
      () => (subs++, `from ${JSON.stringify('file://' + VENDOR)}`)
    );
    gate('(22) redirect shim rewrote exactly the 2 expected specifiers', subs === 2, `subs=${subs}`);
    fs.writeFileSync(
      path.join(dir, 'fly-constants.js'),
      'export const TERRA_CACHE = { name: "r24-unit", maxEntries: 10 };\n'
    );
    fs.writeFileSync(path.join(dir, 'raster-cache.js'), src);
    const R = await import('file://' + path.join(dir, 'raster-cache.js'));
    const { setRasterPolicy, rasterStats, __flyFetchWithPolicy: fwp } = R;

    const stub = (plan) => {
      let i = 0;
      const calls = [];
      globalThis.fetch = async (url, opts) => {
        const step = plan[Math.min(i++, plan.length - 1)];
        calls.push(step);
        if (step === 'hang') {
          return new Promise((_, rej) => {
            opts?.signal?.addEventListener('abort', () => {
              const e = new Error('aborted');
              e.name = 'AbortError';
              rej(e);
            });
          });
        }
        return { ok: step === 200, status: step };
      };
      return calls;
    };

    // (23) policy null = the R22 body: one attempt, and !ok throws that error.
    setRasterPolicy(null);
    {
      const calls = stub([503]);
      let msg = '';
      await fwp('u1').catch((e) => (msg = e.message));
      gate(
        '(23) policy OFF — ONE attempt, upstream error text',
        calls.length === 1 && msg === 'raster 503 u1',
        `attempts=${calls.length} err="${msg}"`
      );
    }

    setRasterPolicy({ timeoutMs: 60, retries: 2, backoffBaseMs: 1 });

    // (24) a retryable status is re-asked, and a later success is returned.
    {
      const calls = stub([503, 200]);
      const before = rasterStats.retries;
      const res = await fwp('u2');
      gate(
        '(24) 503 then 200 — retried once, resolves ok',
        calls.length === 2 && res.ok === true && rasterStats.retries === before + 1,
        `attempts=${calls.length} retries+${rasterStats.retries - before}`
      );
    }

    // (25) a 404 is an ANSWER, not a transient. Re-asking it would spend the
    //      budget that the real transients need.
    {
      const calls = stub([404]);
      let msg = '';
      await fwp('u3').catch((e) => (msg = e.message));
      gate(
        '(25) 404 is NOT retried — one attempt',
        calls.length === 1 && /404/.test(msg),
        `attempts=${calls.length} err="${msg}"`
      );
    }

    // (26) THE BOUND. retries:2 means at most 3 attempts, ever. A retry loop
    //      that can grow without limit against a service that is already
    //      rate-limiting is how a retry becomes the outage.
    {
      const calls = stub([503]);
      const before = rasterStats.giveUps;
      await fwp('u4').catch(() => {});
      gate(
        '(26) the retry is BOUNDED at retries+1 attempts',
        calls.length === 3 && rasterStats.giveUps === before + 1,
        `attempts=${calls.length} (want 3) giveUps+${rasterStats.giveUps - before}`
      );
    }

    // (27) THE TIMEOUT — the defect that has no error at all. A hung raster
    //      fetch inside _removeSubTiles freezes a whole subtree for the session
    //      because _loadState is left at "loading"; nothing before R24 could
    //      ever end that wait.
    {
      const calls = stub(['hang', 'hang', 200]);
      const before = rasterStats.timeouts;
      const t0 = Date.now();
      const res = await fwp('u5');
      const dt = Date.now() - t0;
      gate(
        '(27) a HUNG fetch is aborted by the timeout and re-asked',
        res.ok === true && calls.length === 3 && rasterStats.timeouts === before + 2 && dt < 2000,
        `attempts=${calls.length} timeouts+${rasterStats.timeouts - before} in ${dt}ms`
      );
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* scratch cleanup is best-effort */
    }
  }

  /* ═══════════ §7  FLAG-OFF IDENTITY, END TO END ═══════════ */
  console.log('\n── §7 flag-off identity ──');
  OFF();
  {
    const p = flyGetPatch();
    gate(
      '(28) every R24 switch is at its upstream-equivalent value when OFF',
      p.mergeDwellMs === 0 && p.frustumPenalty === 5 && p.lodHysteresis === 1 &&
        p.unlockOnReject === false && p.rasterMark === false,
      JSON.stringify({
        mergeDwellMs: p.mergeDwellMs,
        frustumPenalty: p.frustumPenalty,
        lodHysteresis: p.lodHysteresis,
        unlockOnReject: p.unlockOnReject,
        rasterMark: p.rasterMark,
      })
    );
    // And the R22/R22.1 switches are untouched by anything above: this round
    // adds keys to FLY_PATCH, it does not re-point one.
    gate(
      '(29) R22/R22.1 switches are not disturbed by the R24 keys',
      'parallelFetch' in p && 'lodBailFix' in p && 'skirtEdges' in p && 'demErrorTable' in p,
      `keys=${Object.keys(p).join(',')}`
    );
  }

  console.log(
    `\n${fails.length ? 'VERIFY: FAIL' : 'VERIFY: PASS'} — ${pass} passed, ${fails.length} failed` +
      (fails.length ? `\nfailed: ${fails.join(' · ')}` : '')
  );
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('VERIFY: FAIL — probe threw:', e);
  process.exit(1);
});
