// Authored airborne sightseeing routes. Coordinates WGS84, altitude metres MSL.
// Every retry starts at the last visited checkpoint, never at arbitrary saved GPS.
const point = (name, lat, lon, altM, description, hint) => ({ name, lat, lon, altM, description, hint, radiusM: 650 });
export const ADVENTURES = [
  { id: 'canyon-discovery', destinationId: 'grand-canyon', name: 'A river through time', place: 'Grand Canyon', packId: 'first-flights', aircraftId: 'prop', minutes: 6, color: '#dba77b', reward: 'prop',
    introduction: 'Follow the Colorado through a landscape two billion years in the making. Your first adventure starts in the air.',
    start: point('South Rim departure', 36.045, -112.14, 2950),
    checkpoints: [
      point('Yavapai overlook',36.066,-112.117,2950,'The South Rim reveals layers of rock deposited long before the canyon itself existed.','Steer gently with your mouse, WASD or the left stick. Follow the beacon above the overlook.'),
      point('Above the Colorado',36.098,-112.087,2950,'The Colorado River continues to carve the landscape below.','Press 1 for a slower look, 2 for cruise. On touch, use the throttle controls.'),
      point('Temple country',36.143,-112.046,3100,'Isolated buttes stand like islands above the inner canyon.','The compass bearing points to your next discovery. Keep the turn gentle.'),
      point('The eastern panorama',36.125,-111.956,3100,'Look back along the canyon: every bend opens a different view.','Choose Photo below. Capture a view, then return to flight to collect your stamp.'),
    ] },
  { id:'manhattan-skyline',destinationId:'manhattan',name:'An island of skylines',place:'Manhattan',packId:'first-flights',aircraftId:'prop',minutes:7,color:'#9ac5d5',reward:'fighter',
    introduction:'From the harbour to the Hudson, discover the city from the air.',start:point('Harbour departure',40.555,-74.15,1050),
    checkpoints:[point('Liberty Island',40.6892,-74.0445,1050,'Liberty Island marks the entrance to New York Harbor.'),point('The Battery',40.703,-74.019,1050,'At Manhattan’s southern tip, the rivers meet the harbour.'),point('Midtown skyline',40.7484,-73.9857,1150,'The Empire State Building anchors a century of vertical ambition.'),point('Hudson panorama',40.88,-73.955,1150,'Turn back for a view down the Hudson, with Manhattan stretching toward the ocean.')] },
  { id:'sydney-harbour',destinationId:'sydney',name:'Around the harbour',place:'Sydney',packId:'first-flights',aircraftId:'prop',minutes:6,color:'#91cfc6',reward:'bizjet',
    introduction:'A harbour circuit connecting coastal cliffs, open water and unmistakable landmarks.',start:point('Coastal departure',-33.885,151.30,900),
    checkpoints:[point('The harbour entrance',-33.835,151.28,900,'The Heads shelter Sydney Harbour from the open Pacific.'),point('Opera House',-33.857,151.217,900,'The Opera House’s shells occupy the tip of Bennelong Point.'),point('Harbour Bridge',-33.85,151.208,950,'The steel arch links the northern shore with the city.'),point('Western waterways',-33.837,151.11,950,'Beyond the famous skyline, the harbour branches into sheltered waterways.')] },
  { id:'alpine-valley',destinationId:'swiss-alps',name:'Above the glacier valley',place:'Swiss Alps',packId:'wild-earth',aircraftId:'glider',minutes:6,color:'#bdd5ee',reward:'glider',
    introduction:'An unhurried glider journey above Lauterbrunnen. Stay high and let the valley reveal its shape.',start:point('Valley departure',46.635,7.90,4300),
    checkpoints:[point('Lauterbrunnen',46.594,7.909,4300,'Glacial ice shaped this steep-sided valley.'),point('Cliff villages',46.57,7.894,4300,'Villages perch on terraces above the valley floor.'),point('Stechelberg',46.543,7.904,4400,'The valley narrows toward the high mountains.'),point('Alpine amphitheatre',46.506,7.907,4500,'Snowfields and peaks close the southern horizon.')] },
  { id:'yosemite-valley',destinationId:'yosemite',name:'Granite giants',place:'Yosemite',packId:'wild-earth',aircraftId:'prop',minutes:6,color:'#b8c5a0',reward:'warbird-prop',
    introduction:'Follow the valley past granite walls, wooded meadows and the unmistakable Half Dome.',start:point('Western departure',37.70,-119.76,3450),
    checkpoints:[point('Valley entrance',37.716,-119.677,3450,'The Merced River winds between granite walls and wooded slopes.'),point('El Capitan',37.731,-119.636,3450,'El Capitan rises as one great granite face above the valley.'),point('Valley meadows',37.743,-119.59,3450,'Open meadows interrupt the forest along the valley floor.'),point('Half Dome panorama',37.768,-119.50,3600,'Half Dome’s distinctive profile marks the eastern skyline.')] },
  { id:'napali-coast',destinationId:'napali',name:'Where cliffs meet the sea',place:'Nāpali Coast',packId:'wild-earth',aircraftId:'prop',minutes:6,color:'#86c9bc',reward:'warbird-jet',
    introduction:'Trace Kauaʻi’s northern coast, with the ocean on one side and folded green cliffs on the other.',start:point('Western coastal departure',22.14,-159.735,1700),
    checkpoints:[point('Polihale coast',22.176,-159.707,1700,'Long beaches give way to the steep Nāpali coastline.'),point('Kalalau coast',22.193,-159.65,1700,'Ridges divide valleys that run from the mountains to the sea.'),point('Hanakoa coast',22.21,-159.61,1700,'Rain and erosion have folded the cliffs into deep channels.'),point('Kēʻē panorama',22.237,-159.561,1700,'Look west for a final view along the coastline.')] },
].map(a => Object.freeze({ ...a, start: openingApproach(a), objectives:[{id:'photo',label:'Capture a photo near a discovery'},{id:'steady',label:'Fly steadily for 30 seconds'}] }));
// Place the first discovery about 25 seconds ahead of the checkpoint boundary
// at the recommended cruise speed. Interpolate along the authored safe approach,
// facing the target at its altitude; subsequent checkpoint/resume locations stay authored.
function openingApproach(route) {
  const target=route.checkpoints[0], speed={prop:60,glider:38,'warbird-prop':115}[route.aircraftId];
  const range=distanceM(route.start,target), fraction=Math.min(1,(target.radiusM+speed*25)/range);
  return {...route.start,lat:target.lat+(route.start.lat-target.lat)*fraction,
    lon:target.lon+(route.start.lon-target.lon)*fraction,altM:target.altM};
}
export const adventureById = id => ADVENTURES.find(a => a.id === id);
export const COLLECTION_REWARDS = [{count:2,aircraftId:'military'},{count:4,aircraftId:'airliner'},{count:6,aircraftId:'cargo'}];
export const LIVERIES = {
  fighter:{name:'Harbour midnight',hull:'#526b82',trim:'#152c43',accent:'#edba67'},
  military:{name:'Explorer copper',hull:'#778a85',trim:'#263c3c',accent:'#dd9557'},
  'warbird-jet':{name:'Pacific blue',hull:'#b3d5d2',trim:'#214d6b',accent:'#e5aa65'},
  'warbird-prop':{name:'Granite silver',hull:'#bac5c8',trim:'#394d4d',accent:'#bf733f'},
  prop:{name:'Canyon sunrise',hull:'#e0cbb4',trim:'#6e4734',accent:'#de7a40'},
  glider:{name:'Alpine ice',hull:'#dfeaf0',trim:'#385b87',accent:'#f0bb6e'},
  bizjet:{name:'Harbour pearl',hull:'#e0e1d6',trim:'#244f5b',accent:'#67c9be'},
  airliner:{name:'Continental',hull:'#d4dfdf',trim:'#244674',accent:'#dea450'},
  cargo:{name:'World traveller',hull:'#b9bfc1',trim:'#35434d',accent:'#d7aa57'},
};
export function distanceM(a,b) {
  const rad=Math.PI/180, y=(b.lat-a.lat)*111320, x=(b.lon-a.lon)*111320*Math.cos((a.lat+b.lat)*rad/2);
  return Math.hypot(x,y);
}
export function bearingDeg(a,b) { return (Math.atan2((b.lon-a.lon)*Math.cos((a.lat+b.lat)*Math.PI/360),b.lat-a.lat)*180/Math.PI+360)%360; }
export function checkpointStart(a,index) {
  const p=index>0?a.checkpoints[index-1]:a.start, next=a.checkpoints[Math.min(index,3)];
  return {...p,id:`poi:adventure:${a.id}:${index}`,kind:'adventure',region:a.place,headingDeg:bearingDeg(p,next),clearM:p.altM-500,groundM:0};
}
