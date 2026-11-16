// Read-only probe: what does the OpenFreeMap building layer actually carry?
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const places = { midtown:[40.7540,-73.9840], brooklyn:[40.6780,-73.9700], paris:[48.8530,2.3300], tokyo:[35.6900,139.7000], london:[51.5130,-0.0850], phoenix:[33.3800,-111.8400], hongkong:[22.2800,114.1600] };
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tpl = tj.tiles[0];
const z = 14;
const out = {};
for (const [name,[lat,lon]] of Object.entries(places)) {
  const n = 2**z, x = Math.floor((lon+180)/360*n), y = Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*n);
  const buf = new Uint8Array(await (await fetch(tpl.replace('{z}',z).replace('{x}',x).replace('{y}',y))).arrayBuffer());
  const vt = new VectorTile(new PbfReader(buf));
  const L = vt.layers.building; const keys = {}; let withH=0, withMin=0, withColour=0, hide=0, total=L?L.length:0; const colours={}; const hs=[];
  for (let i=0;i<total;i++){ const p=L.feature(i).properties; for(const k of Object.keys(p)) keys[k]=(keys[k]||0)+1; if(p.render_height!=null && !(p.render_height===5&&p.height==null)) withH++; if(p.render_min_height>0) withMin++; if(p.colour){withColour++; colours[p.colour]=(colours[p.colour]||0)+1;} if(p.hide_3d) hide++; hs.push(p.render_height??0); }
  hs.sort((a,b)=>a-b);
  const lu = vt.layers.landuse; const luc={}; if(lu) for(let i=0;i<lu.length;i++){const c=lu.feature(i).properties.class; luc[c]=(luc[c]||0)+1;}
  const poi = vt.layers.poi; const poic={}; if(poi) for(let i=0;i<poi.length;i++){const c=poi.feature(i).properties.class; poic[c]=(poic[c]||0)+1;}
  out[name] = { tile:`${z}/${x}/${y}`, total, keys, renderHeightNot5:withH, minHeight:withMin, colour:withColour, topColours:Object.entries(colours).sort((a,b)=>b[1]-a[1]).slice(0,8), hide3d:hide, hMedian:hs[hs.length>>1], hP90:hs[Math.floor(hs.length*0.9)], hMax:hs.at(-1), landuse:luc, poiTop:Object.entries(poic).sort((a,b)=>b[1]-a[1]).slice(0,10), layers:Object.keys(vt.layers) };
}
console.log(JSON.stringify(out,null,1));
