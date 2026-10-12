// First-party simplified exteriors. Placement is an authored approximation,
// not airport navigation data. Shared footprints also retire generic buildings.
export const AIRPORT_LANDMARKS = Object.freeze({
  KCMH:{terminal:[-82.8917,39.9978],tower:[-82.8901,39.9999],heading:100,roof:'#9daaa5',wall:'#c9c3ab',height:17,wings:[[0,0,210,42,17],[95,55,34,155,13],[-100,40,30,115,13],[0,75,32,130,13]],towerHeight:53},
  KJFK:{terminal:[-73.7789,40.6453],tower:[-73.7854,40.6398],heading:35,roof:'#d6d1bb',wall:'#aab6b1',height:22,wings:[[0,0,150,80,18],[-78,35,32,115,12],[78,35,32,115,12],[0,105,240,34,20]],towerHeight:98},
  LOWI:{terminal:[11.3518,47.2574],tower:[11.3499,47.2577],heading:80,roof:'#879694',wall:'#c1c8bd',height:14,wings:[[0,0,170,43,14],[-90,0,55,34,10],[90,0,55,34,10]],towerHeight:30},
  YSSY:{terminal:[151.1665,-33.9362],tower:[151.1798,-33.9453],heading:165,roof:'#bbc4b5',wall:'#afb7ad',height:22,wings:[[0,0,280,65,22],[-115,95,38,195,17],[110,75,38,150,17],[0,110,180,30,14]],towerHeight:81},
});
export function airportLandmark(a){return AIRPORT_LANDMARKS[a.ident||a.id.split(':')[0]]||null;}
