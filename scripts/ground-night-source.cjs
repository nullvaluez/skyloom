const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

module.exports = function sourceReceipt(root = process.cwd()) {
  const hash = crypto.createHash('sha256');
  const add = relative => {
    const p = path.join(root, relative);
    if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) add(`${relative}/${name}`);
    } else if (/\.(?:js|jsx|mjs|cjs|css|json)$/.test(relative)) {
      hash.update(relative.replaceAll('\\', '/'));
      hash.update(fs.readFileSync(p));
    }
  };
  for (const p of ['app', 'components', 'hooks', 'lib', 'stores', 'public', 'package.json', 'package-lock.json', 'next.config.mjs']) add(p);
  const opts = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], opts).trim(),
    sourceSha256: hash.digest('hex'),
    recordedAt: new Date().toISOString(),
  };
};
