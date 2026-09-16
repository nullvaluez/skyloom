const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = process.cwd(), dest = path.join(root, '.graphics-review/living-earth/baseline');
if (fs.existsSync(path.join(dest, 'manifest.json'))) throw Error('Baseline already preserved');
const tracked = execFileSync('git', ['ls-files', '-m', '-z'], { encoding: 'utf8' }).split('\0');
const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0');
const files = [...new Set([...tracked, ...added])].filter(p => /^(lib|components|hooks|stores|scripts|public)\//.test(p) || /^(CINEMATIC_FLIGHT|STYLIZED_EARTH)\.md$/.test(p));
const manifest = { capturedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), files: [] };
for (const file of files) {
  const bytes = fs.readFileSync(path.join(root, file));
  const target = path.join(dest, 'source', file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  manifest.files.push({ file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
const build = '.next-cinematic-ground-final';
if (fs.existsSync(`${build}/BUILD_ID`)) {
  manifest.buildId = fs.readFileSync(`${build}/BUILD_ID`, 'utf8').trim();
  const receipt = `${build}/static/${manifest.buildId}/ground-source.json`;
  if (fs.existsSync(receipt)) manifest.receipt = JSON.parse(fs.readFileSync(receipt));
}
fs.mkdirSync(dest, { recursive:true });
fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Preserved ${manifest.files.length} files; baseline build ${manifest.buildId}`);
