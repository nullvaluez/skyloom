// Read-only: dump the enabled state of every constants block (top-level + nested 'enabled').
import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL(process.argv[2]).href);
const rows = [];
for (const [k, v] of Object.entries(m)) {
  if (!v || typeof v !== 'object') continue;
  const top = 'enabled' in v ? v.enabled : '(none)';
  const subs = [];
  for (const [sk, sv] of Object.entries(v)) {
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && 'enabled' in sv) subs.push(`${sk}=${sv.enabled}`);
  }
  rows.push(`${k}\t${top}\t${subs.join(' ')}`);
}
console.log(rows.join('\n'));
