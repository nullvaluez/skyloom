// Read-only probe: polygons / holes / areas per OpenFreeMap building feature.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const places = { midtown:[40.7540,-73.9840], brooklyn:[40.6780,-73.9700], paris:[48.8530,2.3300], tokyo:[35.6900,139.7000], london:[51.5130,-0.0850], phoenix:[33.3800,-111.8400], hongkong:[22.2800,114.1600], powell:[40.1990,-83.0811] };
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tpl = tj.tiles[0]; const z=14; const out={};
const sa = r => { let s=0; for(let i=0,j=r.length-1;i<r.length;j=i++) s+=(r[j].x-r[i].x)*(r[j].y+r[i].y); return s/2; };
for (const [name,[lat,lon]] of Object.entries(places)) {
  const n=2**z, x=Math.floor((lon+180)/360*n), y=Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*n);
  const buf=new Uint8Array(await (await fetch(tpl.replace('{z}',z).replace('{x}',x).replace('{y}',y))).arrayBuffer());
  const vt=new VectorTile(new PbfReader(buf)); const L=vt.layers.building;
  const tileM = 40075016.7*Math.cos(lat*Math.PI/180)/n; const m2 = (tileM/L.extent)**2;
  let outers=0, holes=0, areas=[], cover=0; const hByPoly=[]; let maxPolysInFeature=0;
  for(let i=0;i<L.length;i++){ const f=L.feature(i); if(f.properties.hide_3d) continue; const rings=f.loadGeometry(); let po=0;
    // sign convention: in MVT y-down, exterior rings have positive area by spec (clockwise in screen) — count both signs
    const signs = rings.map(sa); const ext = Math.sign(signs.reduce((a,b)=>Math.abs(b)>Math.abs(a)?b:a,0));
    for(let k=0;k<rings.length;k++){ if(Math.sign(signs[k])===ext){outers++;po++; const a=Math.abs(signs[k])*m2; areas.push(a); cover+=a; hByPoly.push(f.properties.render_height);} else {holes++; cover-=Math.abs(signs[k])*m2;} }
    maxPolysInFeature=Math.max(maxPolysInFeature,po);
  }
  areas.sort((a,b)=>a-b); const q=p=>Math.round(areas[Math.floor(areas.length*p)]||0);
  const tileArea=tileM*tileM;
  out[name]={features:L.length, outerPolys:outers, holes, maxPolysInFeature, areaP10:q(.1), areaMedian:q(.5), areaP90:q(.9), areaMax:q(.999), coverFrac:+(cover/tileArea).toFixed(3), tileKm:+(tileM/1000).toFixed(2), under220m2:areas.filter(a=>a<220).length, over5000m2:areas.filter(a=>a>5000).length };
}
console.log(JSON.stringify(out,null,1));
