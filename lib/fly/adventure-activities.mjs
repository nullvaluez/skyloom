import { adventureEnvelope, bearingDeg, distanceM, interpolatePoint, offsetPoint } from './adventure-geometry.mjs';

const STORIES={
  'canyon-discovery': {condition:['Late-afternoon glow',16.5,22],caption:'Let the river draw your next turn.',first:['corridor','Follow the Colorado','Follow the curve through five gates as the canyon opens below.',.12],second:['corridor','The overlook pass','Hold the marked altitude through a long, level pass.',0],photo:['The eastern panorama',3,1800]},
  'manhattan-skyline': {condition:['Harbour golden hour',17,15],caption:'An island comes into focus, one landmark at a time.',first:['orbit','Liberty from every angle','Follow the wide arc around Liberty Island. Keep turning in the marked direction.',1],second:['corridor','Along the Hudson','Follow the river corridor past the skyline.',-.09],photo:['The Midtown skyline',2,400]},
  'sydney-harbour': {condition:['Clear harbour morning',9,20],caption:'Beyond the Heads, the city opens around the water.',first:['corridor','Through the Heads','Follow the sweeping harbour approach through five gates.',-.1],second:['orbit','The harbour turn','Make one broad viewing turn above the harbour.',-1],photo:['Opera House',1,35]},
  'alpine-valley': {condition:['Crisp Alpine morning',9.5,32],caption:'Take your time. The valley is the destination.',first:['corridor','Ride the ridge','Follow the rising corridor above the valley.',.09],second:['orbit','The mountain arc','Trace the panoramic arc, keeping a steady altitude.',1],photo:['The glacier valley',3,3200]},
  'yosemite-valley': {condition:['Granite afternoon',15.5,18],caption:'Every turn reveals another face of the granite.',first:['corridor','The valley line','Follow the gently climbing path between the viewpoints.',-.08],second:['orbit','El Capitan viewing turn','Follow the broad arc with the granite wall beside you.',1],photo:['Half Dome',3,2695]},
  'napali-coast': {condition:['Coastal evening',17,45],caption:'Keep the cliffs beside you and the ocean ahead.',first:['corridor','The coastal weave','Trace the coastline through a gentle sequence of changing turns.',.14],second:['corridor','The headland pass','Hold your course and altitude as the coast opens below.',0],photo:['Nāpali cliffs',3,800]},
};
export function adventurePresentation(route) {
  const s=STORIES[route.id];
  const photoTarget={...route.checkpoints[s.photo[1]],altM:s.photo[2]};
  // Landmark coordinates differ from the airborne viewing checkpoint.
  // Opera House: poi/landmarks.js. Nāpali: destinations.js (Kalalau rim).
  // Half Dome: mountainproject.com/area/105833395/half-dome (summit face).
  if(route.id==='sydney-harbour')Object.assign(photoTarget,{lat:-33.8568,lon:151.2153,altM:65});
  if(route.id==='yosemite-valley')Object.assign(photoTarget,{lat:37.74594,lon:-119.53304,altM:2695});
  if(route.id==='napali-coast')Object.assign(photoTarget,{lat:22.151,lon:-159.6461,altM:1230});
  return {recommendedAircraftId:route.aircraftId,artwork:`/adventures/${route.id}.webp`,caption:s.caption,
    conditions:{id:'curated',label:s.condition[0],localHour:s.condition[1],cloudCoverPct:s.condition[2],visM:45000,windMps:4,windDirDeg:240,precip:'none',cloudBaseM:Math.max(...route.checkpoints.map(p=>p.altM))+900,cloudThicknessM:1200},
    activities:[
      {id:`${route.id}:line`,kind:s.first[0],name:s.first[1],instruction:s.first[2],shape:s.first[3],from:0,to:1,unlockIndex:1,expiresIndex:2},
      {id:`${route.id}:turn`,kind:s.second[0],name:s.second[1],instruction:s.second[2],shape:s.second[3],from:1,to:2,unlockIndex:2,expiresIndex:3},
      {id:`${route.id}:photo`,kind:'photo',name:`Frame ${s.photo[0].replace(/^The /,'the ')}`,instruction:'Open Photo mode. Put the landmark inside the frame, then capture your view.',from:s.photo[1],to:s.photo[1],unlockIndex:route.id==='napali-coast'?1:Math.max(0,s.photo[1]),expiresIndex:Infinity,target:photoTarget,viewHeadingDeg:route.id==='napali-coast'?155:route.id==='yosemite-valley'?80:0},
    ]};
}
const courses=new Map();
// Optional flight paths have their own altitude rhythm; discoveries remain
// forgiving viewpoints. Heights are MSL, above the authored valley/rim routes.
const CONTOUR_ALTITUDES={
  'canyon-discovery':[2950,2980,3010,3040,3070],
  'alpine-valley':[4250,4300,4350,4400,4450],
  'yosemite-valley':[3375,3400,3480,3450,3520],
};
export function activityCourse(route,aircraftId,activityId) {
  const key=`${route.id}:${aircraftId}:${activityId}`;
  if(courses.has(key))return courses.get(key);
  const activity=route.activities.find(a=>a.id===activityId);
  if(!activity)return null;
  const envelope=adventureEnvelope(aircraftId),a=route.checkpoints[activity.from],b=route.checkpoints[activity.to];
  const heading=bearingDeg(a,b),points=[];
  let center=null,radiusM=0;
  if(activity.kind==='orbit'){
    const incoming=activity.from?route.checkpoints[activity.from-1]:route.start;
    const tangent=bearingDeg(incoming,a),sign=activity.shape;
    radiusM=Math.max(650,envelope.turnRadiusM*1.25);
    // The named discovery is the centre of the arc, not a point on its rim.
    center={...a};
    for(let i=0;i<=8;i++)points.push(offsetPoint(center,tangent-sign*90+sign*i*15,radiusM));
  }else if(activity.kind==='corridor'){
    const length=distanceM(a,b);
    // Large transports retain the authored route, with shallower curves.
    const amplitude=activity.shape*Math.min(length,length*length/(24*envelope.turnRadiusM));
    for(let i=0;i<5;i++){
      const t=.13+i*.17,p=interpolatePoint(a,b,t);
      if(activity.to===1&&CONTOUR_ALTITUDES[route.id])p.altM=CONTOUR_ALTITUDES[route.id][i];
      if(activity.shape===0)p.altM=Math.max(a.altM,b.altM);
      points.push(offsetPoint(p,heading+90,Math.sin(i*Math.PI/2)*amplitude));
    }
  }
  const headings=points.map((p,i)=>bearingDeg(points[Math.max(0,i-1)],points[Math.min(points.length-1,i+1)]));
  const approachHeading=headings[0]??activity.viewHeadingDeg??0;
  // Give elevated viewpoints room to compose a landscape instead of forcing
  // a steep top-down shot. Fast aircraft retain their longer timed approach.
  const photoDistance=Math.max(1600,envelope.speed*12,Math.max(0,a.altM-(activity.target?.altM??a.altM))*3);
  const first=points[0]||offsetPoint({...activity.target,altM:a.altM},approachHeading+180,photoDistance);
  const approach=points.length?offsetPoint(first,approachHeading+180,envelope.gateRadiusM+envelope.speed*20):first;
  const result={...activity,...envelope,points,headings,center,radiusM,approach:{...approach,headingDeg:approachHeading},photoRangeM:Math.max(5500,envelope.speed*30)};
  courses.set(key,result);return result;
}
export function adventureMinutes(route,aircraftId) {
  let length=0,p=route.start;
  for(const next of route.checkpoints){length+=distanceM(p,next);p=next;}
  const recommended=adventureEnvelope(route.aircraftId).speed,speed=adventureEnvelope(aircraftId).speed;
  length+=25*(speed-recommended);
  return Math.max(1,Math.round(length/speed/60));
}
export function aircraftAdvice(id,recommended) {
  if(id===recommended)return 'Recommended for this journey. A comfortable pace for the views.';
  if(['airliner','cargo'].includes(id))return 'Plan your turns early. Wider activity courses suit this heavy aircraft.';
  if(['fighter','military','warbird-jet'].includes(id))return 'A quick journey. Use slow flight for landmarks and precise turns.';
  if(id==='glider')return 'An unhurried journey. Leave extra time to explore the scenery.';
  return 'All activities adapt to your aircraft. Fly at your own pace.';
}
