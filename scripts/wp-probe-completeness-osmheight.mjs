// Completeness critique probe: does OSM itself carry heights for the Phoenix
// pose's buildings (data.md says Overture's decimal heights there are "OSM")?
// Queries the public Overpass API (keyless) for the centre z14 tile.
const lat = 33.38, lon = -111.84, z = 14;
const n = 2 ** z;
const x = Math.floor((lon + 180) / 360 * n);
const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
const lon2 = (x) => x / n * 360 - 180;
const lat2 = (y) => { const t = Math.PI - 2 * Math.PI * y / n; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t))); };
const s = lat2(y + 1), w = lon2(x), nn = lat2(y), e = lon2(x + 1);
const q = `[out:json][timeout:60];way["building"](${s},${w},${nn},${e});out tags;`;
const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'skyloom-review-probe' } });
const j = await r.json();
const ways = j.elements || [];
let h = 0, lv = 0, hv = [], src = {};
for (const wy of ways) { const t = wy.tags || {}; if (t.height) { h++; hv.push(+t.height); } if (t['building:levels']) lv++; const k = t.source || t['height:source'] || 'none'; src[k] = (src[k] || 0) + 1; }
hv.sort((a, b) => a - b);
const q2 = (p) => hv.length ? hv[Math.floor(p * (hv.length - 1))] : null;
console.log(JSON.stringify({ tile: `${z}/${x}/${y}`, bbox: [s, w, nn, e], ways: ways.length, withHeight: h, withLevels: lv, heightP10: q2(.1), p50: q2(.5), p90: q2(.9), max: hv.at(-1), nonInteger: hv.filter(v => v % 1).length, sourceTags: Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 8) }, null, 1));
