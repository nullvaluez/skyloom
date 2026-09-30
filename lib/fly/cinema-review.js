// Review locations are camera staging only; no alternate terrain or fixtures.
export const CINEMA_REVIEW_SITES={
 manhattan:{name:'Manhattan waterfront',lat:40.72,lon:-74.02,altM:900,headingRad:.3,day:17,golden:22,night:5},
 alps:{name:'Bernese Alps',lat:46.58,lon:7.94,altM:3500,headingRad:2.3,day:12,golden:17,night:23},
 canyon:{name:'Grand Canyon',lat:36.09,lon:-112.1,altM:2700,headingRad:2,day:20,golden:1,night:8},
};
export function stageCinemaReview(runtime,siteKey,condition){
 const site=CINEMA_REVIEW_SITES[siteKey]??CINEMA_REVIEW_SITES.manhattan;
 window.__flySunOverride=Date.UTC(2026,8,27,site[condition==='overcast'?'day':condition]??site.day);
 window.__flyWeatherOverride=condition==='overcast'?'overcast':'baseline';
 runtime.warpToGeo(site.lat,site.lon,{altM:site.altM,headingRad:site.headingRad,name:null});
}
