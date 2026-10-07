import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { airportFrame } from '../lib/fly/operations-airports.js';
const root=new URL('../public/data/runways/v1/',import.meta.url);
export function parseCsv(text){
  const rows=[];let row=[],field='',quote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quote&&text[i+1]==='"'){field+='"';i++;}else quote=!quote;}
    else if(c===','&&!quote){row.push(field);field='';}
    else if(c==='\n'&&!quote){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quote)throw Error('Unclosed CSV field');
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  const headers=rows.shift();return rows.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
export function regionFor(lat,lon){const y=Math.max(0,Math.min(15,Math.floor((1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2*16)));return `${Math.max(0,Math.min(15,Math.floor((lon+180)/360*16)))}-${y}`;}
export function buildCatalog(airports,runways){
  const allowed=new Map(airports.filter(a=>['small_airport','medium_airport','large_airport'].includes(a.type)).map(a=>[a.ident,a]));
  const regions={},index=[];
  const number=v=>v!==''&&v!=null&&Number.isFinite(Number(v))?Number(v):null;
  for(const r of runways){
    const a=allowed.get(r.airport_ident);
    if(!a||['KOSU','KCMH','KLCK'].includes(a.ident)||r.closed!=='0'||/water|wtr/i.test(r.surface)||!/^\d{1,2}[LRC]?$/.test(r.le_ident)||!/^\d{1,2}[LRC]?$/.test(r.he_ident)||parseInt(r.le_ident)<1||parseInt(r.le_ident)>36||parseInt(r.he_ident)<1||parseInt(r.he_ident)>36)continue;
    const lat=number(r.le_latitude_deg),lon=number(r.le_longitude_deg),endLat=number(r.he_latitude_deg),endLon=number(r.he_longitude_deg),length=number(r.length_ft),width=number(r.width_ft);
    if([lat,lon,endLat,endLon,length,width].some(v=>v===null)||Math.abs(lat)>85||Math.abs(endLat)>85||Math.abs(lon)>180||Math.abs(endLon)>180||Math.abs(endLon-lon)>180||length<500||width<15)continue;
    const elevation=number(a.elevation_ft),e1=number(r.le_elevation_ft)??elevation,e2=number(r.he_elevation_ft)??elevation;if(e1===null||e2===null)continue;
    const id=`${a.ident}:${r.le_ident}-${r.he_ident}`,region=regionFor(lat,lon);
    const airport={id,ident:a.ident,name:a.name,runway:r.le_ident,reciprocal:r.he_ident,width:width*.3048,a:{lat,lon,elevation:e1*.3048},b:{lat:endLat,lon:endLon,elevation:e2*.3048},thresholdA:(number(r.le_displaced_threshold_ft)||0)*.3048,thresholdB:(number(r.he_displaced_threshold_ft)||0)*.3048,authored:false,taxiSide:1,taxiOffset:0,standAlong:65,lighted:r.lighted==='1'};
    const actual=airportFrame(airport).length;
    if(!Number.isFinite(actual)||actual<150||actual>10000||actual/(length*.3048)<.5||actual/(length*.3048)>1.5||airport.width>500||[e1,e2].some(h=>h*.3048< -500||h*.3048>6000)||airport.thresholdA+airport.thresholdB>=actual*.8||a.name.length>160)continue;
    (regions[region]??=[]).push(airport);
    index.push({id,name:a.name,ident:a.ident,runway:`${r.le_ident}/${r.he_ident}`,lat,lon,region,length:Math.round(length*.3048),width:Math.round(width*.3048)});
  }
  index.sort((a,b)=>a.id.localeCompare(b.id));return {regions,index};
}
if(process.argv[1]&&new URL(`file:///${process.argv[1].replaceAll('\\','/')}`).pathname.endsWith('/build-runway-db.mjs')){
  const urls=['airports','runways'].map(name=>`https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/${name}.csv`);
  const texts=await Promise.all(urls.map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`${url}: ${r.status}`);return r.text();}));
  const catalog=buildCatalog(...texts.map(parseCsv));if(catalog.index.length<10000)throw Error('Unexpectedly small runway catalog; retain the previous version.');
  await mkdir(new URL('regions/',root),{recursive:true});
  for(const [id,airports]of Object.entries(catalog.regions))await writeFile(new URL(`regions/${id}.json`,root),JSON.stringify({version:1,airports}));
  await writeFile(new URL('index.json',root),JSON.stringify({version:1,runways:catalog.index}));
  await writeFile(new URL('manifest.json',root),JSON.stringify({version:1,source:'OurAirports',license:'Public domain',sourceUrls:urls,retrievedAt:new Date().toISOString(),sha256:texts.map(t=>createHash('sha256').update(t).digest('hex')),runways:catalog.index.length,regions:Object.keys(catalog.regions).length},null,2));
  console.log(`Built ${catalog.index.length} runways in ${Object.keys(catalog.regions).length} regions.`);
}
