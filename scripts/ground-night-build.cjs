/* A served receipt binds captures to the immutable production build, including HUD CSS/hooks. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = require('./ground-night-source.cjs');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const at = a.indexOf('='); return at < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, at), a.slice(at + 1)]; }));
const root = path.resolve(args.root || process.cwd());
const dist = args.dist || '.next-ground-mobile';
const before = source(root);
if (!args['stamp-existing']) {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
    cwd: root, env: { ...process.env, FLY_BUILD_DIR: dist }, stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const after = source(root);
if (before.sourceSha256 !== after.sourceSha256) throw new Error('Source changed during build: stop edits and rebuild before measuring.');
const buildId = fs.readFileSync(path.join(root, dist, 'BUILD_ID'), 'utf8').trim();
const receipt = { ...after, buildId, dist, stampExisting: !!args['stamp-existing'] };
const target = path.join(root, dist, 'static', buildId);
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'ground-source.json'), JSON.stringify(receipt, null, 2));
fs.mkdirSync(path.join(root, '.graphics-review'), { recursive: true });
fs.writeFileSync(path.join(root, '.graphics-review/ground-build.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
