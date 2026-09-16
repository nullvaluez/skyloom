/* Read-only provider evidence: the real worker rasterizer, no browser/GPU claim. */
import fs from 'node:fs';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { buildEarthSurfaceMask } from '../lib/fly/earth-surface-mask.js';
import { EARTH_SURFACE, STYLIZED_EARTH } from '../lib/fly/stylized-earth.js';
import fixtures from './earth-world-fixtures.cjs';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const[k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const output=args.output||'.graphics-review/stylized-earth/world/data.json';
const report={status:'BLOCKED',recordedAt:new Date().toISOString(),revision:STYLIZED_EARTH.surfaceRevision,sites:[]};
try {
  const response=await fetch('https://tiles.openfreemap.org/planet',{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`TileJSON HTTP ${response.status}`);
  const template=(await response.json()).tiles[0];report.template=template;
  for(const [name,site] of Object.entries(fixtures)){
    const row={name,kind:site.kind,tiles:[],classes:Object.fromEntries(Object.keys(EARTH_SURFACE).map(k=>[k,0])),tags:{}};
    for(const z of [9,12,14]){
      const n=2**z,x=Math.floor((site.lon+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(site.lat*Math.PI/180))/Math.PI)/2*n);
      const url=template.replace('{z}',z).replace('{x}',x).replace('{y}',y),r=await fetch(url,{signal:AbortSignal.timeout(20000)});
      if([204,404].includes(r.status)){row.tiles.push({z,x,y,status:r.status,noData:true});continue;}
      if(!r.ok)throw Error(`${name} ${z}/${x}/${y} HTTP ${r.status}`);
      const bytes=new Uint8Array(await r.arrayBuffer()),vt=new VectorTile(new PbfReader(bytes)),mask=buildEarthSurfaceMask(vt,z===14?256:128);
      for(const [k,id] of Object.entries(EARTH_SURFACE)) row.classes[k]+=mask.classes.reduce((sum,v)=>sum+(v===id),0);
      for(const name of ['landcover','landuse','water']){
        const layer=vt.layers[name];if(!layer)continue;
        for(let i=0;i<layer.length;i++){const p=layer.feature(i).properties,key=`${name}:${p.class||''}:${p.subclass||''}`;row.tags[key]=(row.tags[key]||0)+1;}
      }
      row.tiles.push({z,x,y,bytes:bytes.length,revision:mask.revision,water:mask.waterCells,classified:mask.classifiedCells,valid:mask.classes.every(v=>Object.values(EARTH_SURFACE).includes(v))&&mask.exclusion.length===mask.classes.length&&mask.waterEdges.length===4*mask.size});
    }
    row.expectedSurfaceObserved=row.classes[Object.keys(EARTH_SURFACE).find(k=>EARTH_SURFACE[k]===site.surface)]>0;
    report.sites.push(row);console.log(`${name}: ${JSON.stringify(row.classes)}, expected observed ${row.expectedSurfaceObserved}`);
  }
  report.status=report.sites.some(s=>s.tiles.some(t=>!t.noData&&!t.valid))?'FAIL':report.sites.every(s=>s.tiles.some(t=>t.valid))?'PASS':'BLOCKED';
  report.note='Class counts are live provider evidence, not invented coverage. Unclassified surfaces use imagery. Surface presence is reported separately from mask validity.';
}catch(error){report.reason=error.stack;}
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(`EARTH DATA: ${report.status}`);process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;
