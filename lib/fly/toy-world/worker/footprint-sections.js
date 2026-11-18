import { pointInPoly, signedArea } from './geom';

// Fit a few coplanar rectangles inside a mapped footprint. Only large, visibly
// concave buildings merit more than one distant instance. The occupancy grid
// samples holes too, so a courtyard remains open to the ground photograph.
const GRID = 8;
export function footprintSections(poly, yaw, unitsPerMetre) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const p of poly.outer) {
    const u = p.x*cs + p.y*sn, v = -p.x*sn + p.y*cs;
    left = Math.min(left,u); right = Math.max(right,u);
    top = Math.min(top,v); bottom = Math.max(bottom,v);
  }
  const du = (right-left)/GRID, dv = (bottom-top)/GRID;
  if (Math.min(du,dv) < 1.5*unitsPerMetre) return null;
  const area = (Math.abs(signedArea(poly.outer))-poly.holes.reduce((sum,h)=>sum+Math.abs(signedArea(h)),0))*.5;
  if (area >= .9*(right-left)*(bottom-top)) return null;
  const occupied = new Uint8Array(GRID*GRID);
  const inside = (u,v) => pointInPoly(poly,u*cs-v*sn,u*sn+v*cs);
  let count = 0;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const u = left+(x+.5)*du, v = top+(y+.5)*dv;
      if (inside(u,v) && inside(u-du*.30,v-dv*.30) && inside(u+du*.30,v-dv*.30) &&
          inside(u-du*.30,v+dv*.30) && inside(u+du*.30,v+dv*.30)) {
        occupied[y*GRID+x] = 1;
        count++;
      }
    }
  }
  if (count > GRID*GRID*.84 || count < 12) return null;
  const sections = [];
  let covered = 0;
  while (sections.length < 4 && covered < count) {
    let best = null, area = 0;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        let w = GRID-x;
        for (let j = y; j < GRID && w; j++) {
          let run = 0;
          while (run < w && occupied[j*GRID+x+run]) run++;
          w = run;
          const h = j-y+1;
          if (w*h > area) { area = w*h; best = {x,y,w,h}; }
        }
      }
    }
    if (area < 3) break;
    const {x,y,w,h} = best;
    for (let j = y; j < y+h; j++) occupied.fill(0,j*GRID+x,j*GRID+x+w);
    const u = left+(x+w/2)*du, v = top+(y+h/2)*dv;
    // Keep edges apart by centimetres. Shared section faces cannot z-fight.
    const gap = .04*unitsPerMetre;
    sections.push({x:u*cs-v*sn,y:u*sn+v*cs,hu:w*du/2-gap,hv:h*dv/2-gap,yaw});
    covered += area;
  }
  return sections.length > 1 && covered >= .83*count ? sections : null;
}
