/**
 * Regenerate CREDITS.md from lib/fly/assets.js (the single manifest).
 * Run after any asset change: node scripts/gen-credits.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { FLY_ASSETS } = await import(new URL('../lib/fly/assets.js', import.meta.url));

// Mirrors CREDITS_ATTRIBUTIONS in lib/fly/tile-sources.js (not importable
// here without dragging three-tile into node) — update both on change;
// scripts/verify-attribution.mjs fails while they differ.
const TERRAIN_ATTRIBUTIONS = [
  { label: '© Esri, Maxar, Earthstar Geographics', href: 'https://www.esri.com/en-us/legal/terms/data-attributions' },
  { label: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium', href: 'https://esa-worldcover.org/en/data-access' },
  { label: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
  { label: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
  { label: 'Tiles © OpenFreeMap', href: 'https://openfreemap.org' },
  { label: 'Terrain © Esri', href: 'https://www.esri.com/en-us/legal/terms/data-attributions' },
  { label: 'Flight data © adsb.lol', href: 'https://adsb.lol' },
  { label: 'Flight data © adsb.fi', href: 'https://adsb.fi' },
  { label: 'Flight data © airplanes.live', href: 'https://airplanes.live' },
];

const lines = [
  '# Credits',
  '',
  '<!-- GENERATED from lib/fly/assets.js — edit that manifest, then run: node scripts/gen-credits.mjs -->',
  '',
  '## Fly Mode assets',
  '',
];

for (const a of FLY_ASSETS) {
  lines.push(
    `- **${a.name}** (${a.kind}) — ${a.author}, ${a.source} · [${a.license}](${a.url})` +
      (a.modifications && a.modifications !== 'none' ? ` · modifications: ${a.modifications}` : '')
  );
}

lines.push(
  '',
  '## Map data & imagery',
  '',
  ...TERRAIN_ATTRIBUTIONS.map((t) => `- ${t.label} — ${t.href}`),
  '',
  '## Live flight data',
  '',
  '- ADS-B data by [adsb.lol](https://adsb.lol) — community-run, ODbL.',
  ''
);

writeFileSync(path.join(root, 'CREDITS.md'), lines.join('\n'));
console.log('CREDITS.md written:', FLY_ASSETS.length, 'assets,', TERRAIN_ATTRIBUTIONS.length, 'attributions');
