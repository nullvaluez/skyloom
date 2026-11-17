/** WORLD PASS B r2 (item 3): does the async compile of the quantized building program seed the
 * program the frame actually draws with? Boot with WORLD_ARRIVAL (or --flags) at --pose, wrap
 * the engine's compiler as soon as it exists, and record the program three assigned to the
 * building material right after the compile call (the compile is synchronous; only the
 * readiness poll is async). Once the meshes are shown and drawn, read the program the material
 * draws with. Pass: the same program (cache key) - the compile seeded what the frame uses.
 * Before the fix the compile ran against the canvas, minted a variant with the canvas's output
 * colour space and tone mapping, and the frame linked a second program on first draw.
 *   node scripts/wp-arrival-r2-compilekey.cjs --url=http://localhost:3322 --out=<dir> [--pose=nyc-low] [--old --tag=old]
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./wp-arrival-r2-lib.cjs');
const { args } = L;
const url = args.url || 'http://localhost:3322';
const out = path.resolve(String(args.out));
fs.mkdirSync(out, { recursive: true });
const pose = L.POSES[args.pose || 'nyc-low'];
const report = { tool: 'wp-arrival-r2-compilekey', pose: args.pose || 'nyc-low', flags: args.flags || 'WORLD_ARRIVAL', errors: [], consoleErrors: [] };

function hook() {
  const t = setInterval(() => {
    const e = window.__fly?.satBuildings, gl = window.__flyGl;
    if (!e?._compile || !gl || e._compile.__wrapped) return;
    // --old: the round-2 first version, compileAsync against whatever target is bound (the canvas)
    const root = (o) => { while (o.parent) o = o.parent; return o; };
    const orig = window.__ckOld ? (obj) => gl.compileAsync(obj, window.__fly.camera, root(obj)) : e._compile;
    const w = (obj) => {
      const p = orig(obj);
      const prog = gl.properties.get(obj.material)?.currentProgram;
      window.__ck = { mat: obj.material, key: prog?.cacheKey ?? null, name: prog?.name ?? null, t: performance.now() };
      return p;
    };
    w.__wrapped = true;
    e._compile = w;
    clearInterval(t);
  }, 20);
}

(async () => {
  console.log('SLOT after', await L.acquireSlot('wp-arrival-r2-compilekey'), 'ms');
  const browser = await L.launch();
  try {
    const { page } = await L.boot(browser, { url, flags: report.flags, firstPose: pose, errors: report.errors, consoleErrors: report.consoleErrors, init: args.old ? `window.__ckOld = true; (${hook})();` : hook });
    const t0 = Date.now();
    for (;;) {
      await L.sleep(1000);
      const s = await page.evaluate(() => window.__fly.satBuildings?.stats?.quantCompileMs ?? -1);
      if (s >= 0 || Date.now() - t0 > 180000) break;
    }
    await L.sleep(3000);
    report.result = await page.evaluate(() => {
      const gl = window.__flyGl, ck = window.__ck, st = window.__fly.satBuildings?.stats ?? {};
      if (!ck) return { hooked: false, quantCompileMs: st.quantCompileMs };
      const now = gl.properties.get(ck.mat)?.currentProgram;
      const a = String(ck.key ?? '').split(','), b = String(now?.cacheKey ?? '').split(',');
      const diff = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff.push([i, a[i], b[i]]);
      return { hooked: true, quantCompileMs: st.quantCompileMs, quantChunks: st.quantChunks, compiledName: ck.name, drawnName: now?.name ?? null, same: !!now && now.cacheKey === ck.key, keyFieldsDiffering: diff.slice(0, 8), wpqInKey: String(now?.cacheKey ?? '').includes('wpq1a') };
    });
    report.pass = !!report.result.hooked && report.result.same && report.result.wpqInKey;
    console.log(JSON.stringify(report.result));
  } catch (e) { report.errors.push('fatal ' + String(e?.message ?? e).slice(0, 300)); console.error(e); }
  finally {
    fs.writeFileSync(path.join(out, `compilekey-${args.tag || 'run'}.json`), JSON.stringify(report, null, 1));
    await browser.close(); L.releaseSlot();
    console.log(report.pass ? 'PASS' : 'FAIL', 'errors', report.errors.length, report.consoleErrors.length);
  }
})();
