import data from '../../public/data/living-regions.json' with { type: 'json' };

// Natural Earth is deliberately coarse context. It never supplies footprints,
// heights or landmark geometry; source building tags always take precedence.
const regions = data.regions.map(country => {
  const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
  return { ...country, polygons: polygons.map(rings => {
    const points = rings[0];
    return { rings, bounds: points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [180, 90, -180, -90]) };
  }) };
});
function inside(ring, x, y) {
  let hit = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if ((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
  }
  return hit;
}
export function architectureRegion(lat, lon) {
  for (const country of regions) for (const polygon of country.polygons) {
    const [x0,y0,x1,y1]=polygon.bounds;
    if (lon<x0||lon>x1||lat<y0||lat>y1||!inside(polygon.rings[0],lon,lat)||polygon.rings.slice(1).some(r=>inside(r,lon,lat))) continue;
    const r=country.region;
    const style = r==='Eastern Asia' ? 'east-asia' : r==='South-Eastern Asia' ? 'tropical-asia' :
      r==='Southern Asia' ? 'south-asia' : /Northern Africa|Western Asia/.test(r) ? 'arid' :
      /Southern Europe/.test(r) ? 'mediterranean' : /Europe/.test(r) ? 'europe' :
      /America|Caribbean/.test(r) && country.id!=='USA' && country.id!=='CAN' ? 'latin' :
      country.id==='AUS'||country.id==='NZL' ? 'oceania' : 'temperate';
    return { country:country.id, style, provenance:'natural-earth-50m-context' };
  }
  return { country:null, style:'temperate', provenance:'neutral-context' };
}
