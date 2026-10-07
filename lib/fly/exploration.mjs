export const EXPLORATION_KEY = 'fly-exploration-v1';
const safeId = v => typeof v === 'string' && /^[\w:., -]{1,100}$/.test(v) && !['__proto__','constructor','prototype'].includes(v);
export const emptyExploration = () => ({version:1,places:[],landings:[],photos:[]});
export function validateExploration(value) {
  if (value?.version !== 1 || !Array.isArray(value.places) || !Array.isArray(value.landings) || value.places.length > 8000 || value.landings.length > 500) throw Error('Invalid travel journal.');
  const clean = (r, landing) => {
    if (!r || !safeId(r.id) || typeof r.name !== 'string' || r.name.length > 160 || !Number.isFinite(r.lat) || Math.abs(r.lat)>85 || !Number.isFinite(r.lon) || Math.abs(r.lon)>180 || !Number.isFinite(r.at) || r.at<0) throw Error('Invalid journal location.');
    return {id:r.id,name:r.name,lat:r.lat,lon:r.lon,at:r.at,...(landing?{quality:['Smooth','Good','Firm','Recovered bounce'].includes(r.quality)?r.quality:'Landed'}:{})};
  };
  const unique = rows => [...new Map(rows.map(r=>[r.id,r])).values()];
  if(value.photos!=null&&(!Array.isArray(value.photos)||value.photos.length>200))throw Error('Invalid journal photos.');
  const photos=(value.photos||[]).map(r=>({...clean(r,false),thumbnail:typeof r.thumbnail==='string'&&/^memory-[\w-]{1,80}$/.test(r.thumbnail)?r.thumbnail:null}));
  return {version:1, places:unique(value.places.map(r=>clean(r,false))), landings:unique(value.landings.map(r=>clean(r,true))),photos:unique(photos)};
}
export function rememberPlace(state, place) {
  if (state.places.some(p=>p.id===place.id)) return state;
  // Region discoveries must outlive ordinary map-cell history pruning.
  const places=[place,...state.places];
  const permanent=places.filter(p=>p.id.startsWith('discovery:'));
  const other=places.filter(p=>!p.id.startsWith('discovery:')).slice(0,8000-permanent.length);
  return validateExploration({...state,places:[...permanent,...other]});
}
export function rememberLanding(state, landing) {
  if (state.landings.some(p=>p.id===landing.id)) return state;
  return validateExploration({...state,landings:[landing,...state.landings].slice(0,500)});
}
export function rememberPhoto(state,photo){
  if(state.photos?.some(p=>p.id===photo.id))return state;
  return validateExploration({...state,photos:[photo,...state.photos||[]].slice(0,200)});
}
