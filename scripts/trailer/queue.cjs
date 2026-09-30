#!/usr/bin/env node
/**
 * Capture queue: runs shot captures with bounded concurrency, one retry on
 * failure (the container's OOM killer targets Chrome renderers first).
 *
 *   node scripts/trailer/queue.cjs [--jobs=2] [--extra="--preview=1 --stride=6 --res=960x540"] shot1 shot2 ...
 *
 * Shot names resolve to scripts/trailer/shots/<name>.cjs. Output directories
 * follow capture.cjs (<TRAILER_SHOTS>/<id>[-preview]). A shot whose output dir
 * already holds a DONE marker is skipped unless --force.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? '1']; }));
const shots = argv.filter((a) => !a.startsWith('--'));
const JOBS = Number(opt.jobs || 2);
const extra = (opt.extra || '').split(' ').filter(Boolean);
const ROOT = path.resolve(__dirname, '../..');
const SHOTS_DIR = process.env.TRAILER_SHOTS || '/tmp/claude-0/shots';
const LOG = path.join(SHOTS_DIR, 'queue.log');
fs.mkdirSync(SHOTS_DIR, { recursive: true });
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ` + a.join(' '); fs.appendFileSync(LOG, s + '\n'); console.log(s); };

function outDir(name) {
  const shot = require(path.join(__dirname, 'shots', name + '.cjs'));
  const preview = extra.some((e) => e.startsWith('--preview'));
  return path.join(SHOTS_DIR, shot.id + (preview ? '-preview' : ''));
}

function runOne(name, attempt) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    log('start', name, 'attempt', attempt);
    const p = spawn('node', ['scripts/trailer/capture.cjs', `scripts/trailer/shots/${name}.cjs`, ...extra], { cwd: ROOT, env: { ...process.env, QUIET: '1' }, stdio: 'ignore' });
    p.on('exit', (code) => {
      const dir = outDir(name);
      const logTxt = fs.existsSync(path.join(dir, 'capture.log')) ? fs.readFileSync(path.join(dir, 'capture.log'), 'utf8') : '';
      const ok = code === 0 && /\] done \d+ frames/.test(logTxt) && !/MISS frame/.test(logTxt);
      log('exit', name, 'code', code, ok ? 'OK' : 'FAIL', ((Date.now() - t0) / 60000).toFixed(1) + ' min');
      if (ok) fs.writeFileSync(path.join(dir, 'DONE'), new Date().toISOString());
      resolve(ok);
    });
  });
}

(async () => {
  const queue = shots.filter((s) => opt.force || !fs.existsSync(path.join(outDir(s), 'DONE')));
  log('queue', queue.join(' '), 'jobs', JOBS, 'extra', extra.join(' '));
  const results = {};
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      let ok = await runOne(s, 1);
      if (!ok) ok = await runOne(s, 2);
      results[s] = ok;
    }
  }
  await Promise.all(Array.from({ length: JOBS }, worker));
  log('summary', JSON.stringify(results));
})();
