// Worker-safe geographic and architectural policy: no window, store or renderer.
import regions from './showcase-regions.json' with { type: 'json' };
export { regions as SHOWCASE_REGIONS };
export function showcaseRegionAt(lon,lat){
 if(!Number.isFinite(lon)||!Number.isFinite(lat))return null;
 return regions.find(({bounds:[w,s,e,n]})=>lon>=w&&lon<=e&&lat>=s&&lat<=n)??null;
}

/** Appearance only. Never changes mapped height, polygon topology or ground. */
export function refineArchitectureStyle(style,{height,areaM2,tags='',region=null}={}){
 const next={...style};
 const domestic=style.family===0||style.family===6;
 const explicitFlat=/\bflat\b/.test(tags),explicitPitch=/gable|hipped|pitched/.test(tags);
 // Institutional/industrial slabs should not acquire a pitched house roof
 // solely because their height fell below the legacy small-building threshold.
 if(!domestic||explicitFlat)next.roofRise=0;
 if(explicitPitch&&domestic)next.roofRise=style.roofRise??1;
 if(region?.architecture==='manhattan'){
  // Brownstones, lofts and tenements typically terminate at a parapet. This
  // also stops invented mansards on mapped glass/concrete office towers.
  if(!explicitPitch)next.roofRise=0;
  next.roofTreatment=height>=13&&height<80&&areaM2<1600&&[1,2,6].includes(style.family)?'urban-residential':'flat';
 }
 return next;
}

export function forestFormAt(lon,lat,elevation,regional){
 if(regional&&showcaseRegionAt(lon,lat)?.forest==='conifer')return 'conifer';
 return Math.abs(lat)>51||elevation>1650?'conifer':'deciduous';
}
