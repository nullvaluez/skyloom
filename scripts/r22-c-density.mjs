/**
 * R22 C CLUTTER — the OWENS DISCRIMINATOR measurement.
 *
 * Parked cars / poles must place ZERO at the Owens draw-gate pose
 * (36.601 N, -118.060 W — which sits ON Lone Pine, a real mapped village) and
 * a believable field at Lewis Center / Powell OH. A pure "does this tile have
 * streets?" test cannot do that: Owens' z13 tile HAS streets. So the gate has
 * to be a DENSITY floor, and this measures the quantity the floor is set on:
 * true-metre centerline length of the street classes per true km² of tile, over
 * the 3x3 z13 ring around each pose (the ring the clutter engine streams).
 *
 * Usage: node scripts/r22-c-density.mjs
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;

// SAT_ROADS.classes — the sat-road class codes.
const CLS = {
  motorway: 1,
  trunk: 2,
  primary: 3,
  secondary: 4,
  tertiary: 5,
  minor: 6,
};

const POSES = [
  ['P-LEWIS Lewis Center OH', 40.2083, -83.0701],
  ['Powell OH', 40.1578, -83.0752],
  ['Dublin OH', 40.0992, -83.1141],
  ['OWENS gate pose (Lone Pine)', 36.601, -118.06],
  ['OWENS valley floor', 36.75, -118.05],
  ['Manhattan NY', 40.758, -73.9855],
  ['Melton AU', -37.6833, 144.5833],
  ['Craigieburn AU', -37.5936, 144.9411],
  ['Blagnac FR', 43.6353, 1.3675],
  ['Union County OH rural', 40.35, -83.35],
];

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latR = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return [x, y];
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return a / 2;
}

async function tileStats(tpl, z, x, y) {
  const url = tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const vt = new VectorTile(new PbfReader(buf));
  const span = WORLD_SIZE / 2 ** z; // mercator metres
  const mercYTop = WORLD_SIZE / 2 - y * span;
  const cz = -(mercYTop - span / 2);
  const latC = (2 * Math.atan(Math.exp(-cz / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
  const k = 1 / Math.cos((latC * Math.PI) / 180); // mercator stretch
  const kInv = 1 / k;
  const trueSpanKm = (span * kInv) / 1000;
  const areaKm2 = trueSpanKm * trueSpanKm;

  const out = {
    areaKm2,
    streetKm: 0, // cls 4-6 (secondary/tertiary/minor)
    minorKm: 0, // cls 6 alone
    arteryKm: 0, // cls 1-3
    serviceKm: 0,
    serviceChains: 0,
    resKm2: 0,
    parkingPois: 0,
    buildings: 0,
  };

  const t = vt.layers.transportation;
  if (t) {
    const scale = span / t.extent;
    for (let i = 0; i < t.length; i++) {
      const f = t.feature(i);
      if (f.type !== 2) continue;
      if (f.properties.brunnel === 'tunnel') continue;
      const c = f.properties.class;
      let len = 0;
      for (const line of f.loadGeometry()) {
        for (let j = 1; j < line.length; j++) {
          len += Math.hypot(line[j].x - line[j - 1].x, line[j].y - line[j - 1].y);
        }
      }
      const km = (len * scale * kInv) / 1000;
      if (c === 'service') {
        out.serviceKm += km;
        out.serviceChains += 1;
      } else if (CLS[c] >= 4) {
        out.streetKm += km;
        if (CLS[c] === 6) out.minorKm += km;
      } else if (CLS[c] >= 1) {
        out.arteryKm += km;
      }
    }
  }

  const lu = vt.layers.landuse;
  if (lu) {
    const scale = span / lu.extent;
    for (let i = 0; i < lu.length; i++) {
      const f = lu.feature(i);
      if (f.type !== 3 || f.properties.class !== 'residential') continue;
      for (const ring of f.loadGeometry()) {
        out.resKm2 += (Math.abs(signedArea(ring)) * scale * scale * kInv * kInv) / 1e6;
      }
    }
  }

  const poi = vt.layers.poi;
  if (poi) {
    for (let i = 0; i < poi.length; i++) {
      const f = poi.feature(i);
      if (f.properties.class === 'parking' || f.properties.subclass === 'parking') {
        out.parkingPois += 1;
      }
    }
  }
  const b = vt.layers.building;
  if (b) out.buildings = b.length;
  return out;
}

async function main() {
  const tj = await (await fetch(TILEJSON)).json();
  const tpl = tj.tiles[0];
  const z = 13;
  console.log(
    'pose'.padEnd(30),
    'streetKm/km2'.padStart(13),
    'minorKm/km2'.padStart(12),
    'svcKm/km2'.padStart(10),
    'svcChains'.padStart(10),
    'resKm2'.padStart(8),
    'parkPOI'.padStart(8)
  );
  for (const [name, lat, lon] of POSES) {
    const [tx, ty] = lonLatToTile(lon, lat, z);
    const agg = { areaKm2: 0, streetKm: 0, minorKm: 0, serviceKm: 0, serviceChains: 0, resKm2: 0, parkingPois: 0 };
    const per = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const s = await tileStats(tpl, z, tx + dx, ty + dy);
        if (!s) continue;
        for (const k of Object.keys(agg)) agg[k] += s[k];
        per.push((s.streetKm / s.areaKm2).toFixed(2));
      }
    }
    console.log(
      name.padEnd(30),
      (agg.streetKm / agg.areaKm2).toFixed(3).padStart(13),
      (agg.minorKm / agg.areaKm2).toFixed(3).padStart(12),
      (agg.serviceKm / agg.areaKm2).toFixed(3).padStart(10),
      String(agg.serviceChains).padStart(10),
      agg.resKm2.toFixed(2).padStart(8),
      String(agg.parkingPois).padStart(8),
      ' per-tile street/km2: [' + per.join(' ') + ']'
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
