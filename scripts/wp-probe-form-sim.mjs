// Read-only offline simulation of the Enhanced satellite typology on live OpenFreeMap tiles.
// Mirrors buildSatBuildings (visuals=true, sceneryForms=true) for: height, family, roofRise, detailed set.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);
const { inferBuildingStyle, buildingClassificationHeight } = await import('../lib/fly/building-profiles.js');
const { refineArchitectureStyle, showcaseRegionAt } = await import('../lib/fly/showcase-policy.js');
const { architectureRegion } = await import('../lib/fly/living-regions.js');
const places = { midtown:[40.7540,-73.9840], brooklyn:[40.6780,-73.9700], paris:[48.8530,2.3300], tokyo:[35.6900,139.7000], london:[51.5130,-0.0850], phoenix:[33.3800,-111.8400], hongkong:[22.2800,114.1600] };
const FAM=['house','apartment','masonry','concrete','glass','industrial','attached','airport'];
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json(); const tpl=tj.tiles[0]; const z=14; const out={};
const sa=r=>{let s=0;for(let i=0,j=r.length-1;i<r.length;j=i++)s+=(r[j].x-r[i].x)*(r[j].y+r[i].y);return s/2;};
for (const [name,[lat,lon]] of Object.entries(places)) {
  const n=2**z,x=Math.floor((lon+180)/360*n),y=Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*n);
  const vt=new VectorTile(new PbfReader(new Uint8Array(await (await fetch(tpl.replace('{z}',z).replace('{x}',x).replace('{y}',y))).arrayBuffer())));
  const L=vt.layers.building, ext=L.extent, tileM=40075016.7*Math.cos(lat*Math.PI/180)/n, m2=(tileM/ext)**2;
  const lu=vt.layers.landuse; const regions=[]; if(lu)for(let i=0;i<lu.length;i++){const f=lu.feature(i);if(f.type===3&&['residential','industrial','commercial','retail'].includes(f.properties.class))regions.push(f);}
  const geo=architectureRegion(lat,lon), showcase=showcaseRegionAt(lon,lat);
  const items=[]; let dropped=0;
  for(let i=0;i<L.length;i++){const f=L.feature(i);if(f.type!==3||f.properties.hide_3d)continue;let rawH=f.properties.render_height??0;if(rawH===5&&f.properties.height==null)rawH=0;
    const rings=f.loadGeometry();const signs=rings.map(sa);const ext0=Math.sign(signs.reduce((a,b)=>Math.abs(b)>Math.abs(a)?b:a,0));
    rings.forEach((r,k)=>{if(Math.sign(signs[k])!==ext0)return;const aM2=Math.abs(signs[k])*m2;if(aM2>60000)return; if(aM2<120*Math.cos(40*Math.PI/180)**2){dropped++;return;}
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const p of r){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);}
      items.push({id:(Math.imul(f.id??i,2654435761)^Math.imul(k+1,40503))>>>0,rawH,aM2,aspect:Math.max(x1-x0,y1-y0)/Math.max(1e-6,Math.min(x1-x0,y1-y0)),nv:r.length,tags:Object.values(f.properties).filter(v=>typeof v==='string').join(' '),colour:f.properties.colour??null});});}
  const density=L.length/((tileM/1000)**2);
  for(const it of items){const hash=(((it.id*2654435761)>>>0)%4096)/4096; it.h=it.rawH>0?it.rawH:(it.aM2<=220?5+hash*3:Math.min(42,Math.max(6,9+Math.sqrt(it.aM2)*0.5))*(0.85+hash*0.3));}
  const ranked=items.slice().sort((a,b)=>b.aM2*b.h-a.aM2*a.h); const anchors=ranked.slice(0,180),rest=ranked.slice(180),room=500-anchors.length;
  let detailed; if(rest.length<=room)detailed=new Set(ranked); else {rest.sort((a,b)=>(Math.imul(a.id,2654435761)>>>0)-(Math.imul(b.id,2654435761)>>>0));const st=rest.length/room;detailed=new Set(anchors);for(let i=0;i<room;i++)detailed.add(rest[Math.floor(i*st)]);}
  const fam=[0,0,0,0,0,0,0,0]; let tagHits=0, pitchEligible=0, roofRise0=0, bare=0, mappedH=0, colourTagged=0;
  for(const it of items){const height=buildingClassificationHeight(it.rawH,it.aM2,it.id);
    let style=inferBuildingStyle({id:it.id,height,areaM2:it.aM2,aspect:it.aspect,density,landuse:undefined,tags:it.tags,region:geo.style});
    style=refineArchitectureStyle(style,{height,areaM2:it.aM2,tags:it.tags,region:showcase});
    fam[style.family]++; if(/terminal|airport|terrace|row.?house|industrial|warehouse|hangar|house|detached|bungalow|cabin|apart|residen|dorm|hotel|glass|curtain|masonry|brick|stone|concrete|office|commercial/i.test(it.tags))tagHits++;
    if((style.roofRise??1)>0&&it.h<16)pitchEligible++; else roofRise0++; if(!detailed.has(it))bare++; if(it.rawH>0)mappedH++; if(it.colour)colourTagged++;}
  out[name]={droppedUnder120m2:dropped,region:geo.style,country:geo.country,showcase:showcase?.id??null,polys:items.length,mappedHeightShare:+(mappedH/items.length).toFixed(2),colourTaggedShare:+(colourTagged/items.length).toFixed(2),detailedShare:+(1-bare/items.length).toFixed(3),bareNoRoofDispatch:bare,families:Object.fromEntries(FAM.map((f,i)=>[f,fam[i]])),typeTagRegexHits:tagHits,pitchedEligible:pitchEligible,flatForced:roofRise0,landuseRegions:regions.length};
}
console.log(JSON.stringify(out,null,1));
