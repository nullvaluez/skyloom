/**
 * R22 C CLUTTER — offline OFM tile probe (measurement, not product code).
 *
 * Decides the parking/driveway anchor source and the mover/pole path source by
 * ASKING THE PLANET what layers/classes actually ship at the ring zooms this
 * round streams, at the canonical R22 poses. No app, no browser: fetch the same
 * OpenFreeMap pbf the worker fetches and enumerate it.
 *
 * Usage: node scripts/r22-c-tileprobe.mjs
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const TILEJSON = 'https://tiles.openfreemap.org/planet';

const POSES = [
  ['P-LEWIS  Lewis Center OH', 40.2083, -83.0701],
  ['Powell OH', 40.1578, -83.0752],
  ['Owens/Lone Pine CA', 36.606, -118.062],
  ['Manhattan NY', 40.758, -73.9855],
  ['Melton AU', -37.6833, 144.5833],
  ['Dublin OH', 40.0992, -83.1141],
];

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latR = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return [x, y];
}

async function main() {
  const tj = await (await fetch(TILEJSON)).json();
  const tpl = tj.tiles[0];
  console.log('tile template:', tpl, '\n');

  for (const [name, lat, lon] of POSES) {
    for (const z of [13, 14]) {
      const [x, y] = lonLatToTile(lon, lat, z);
      const url = tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`${name} z${z} ${x}/${y}: HTTP ${res.status}`);
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const vt = new VectorTile(new PbfReader(buf));
      const rows = [];
      for (const lname of Object.keys(vt.layers)) {
        const layer = vt.layers[lname];
        const classes = new Map();
        const subclasses = new Map();
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          const c = `${f.type}:${f.properties.class ?? '-'}`;
          classes.set(c, (classes.get(c) ?? 0) + 1);
          const s = f.properties.subclass;
          if (s) subclasses.set(s, (subclasses.get(s) ?? 0) + 1);
        }
        rows.push(
          `    ${lname} (${layer.length}) ` +
            [...classes.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ') +
            (subclasses.size
              ? '  | sub: ' +
                [...subclasses.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')
              : '')
        );
      }
      console.log(`${name} z${z} ${x}/${y}  (${buf.length} bytes)`);
      console.log(rows.join('\n'));
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
