/** Worker-baked architectural relief. The mapped body remains authoritative. */
export function emitArchitectureRelief(mesh, vertex, polygon, item, style, metresPerTile) {
  const ring = polygon.outer, h = item.h, family = style.family;
  if (ring.length < 3 || h < 4) return 0;
  const centre = ring.reduce((a,p)=>({x:a.x+p.x/ring.length,y:a.y+p.y/ring.length}),{x:0,y:0});
  const wall = style.walls[style.variant % style.walls.length];
  const value = Number.parseInt(wall.slice(1),16);
  const linear = n => { const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4; };
  const color = [linear(value>>16),linear(value>>8&255),linear(value&255)].map(v=>v*.76);
  let quads = 0;
  const quad = (a,b,c,d,col=color) => { const k=[a,b,c,d].map(p=>vertex(p[0],p[1],p[2],col));mesh.idx.push(k[0],k[2],k[1],k[0],k[3],k[2]);quads++; };
  // Floor ledges, mechanical floors and a substantial ground-floor plinth.
  // Caps bound complexity by building, not by emission order across a tile.
  const floors = Math.max(1,Math.floor(h/style.floor));
  const bands = [Math.min(3.2,h*.3)];
  if(family===1 || family===6) for(let f=2;f<floors&&bands.length<9;f+=Math.max(2,Math.ceil(floors/8)))bands.push(f*style.floor);
  else if(h>24) for(let f=4;f<floors&&bands.length<6;f+=Math.max(4,Math.ceil(floors/5)))bands.push(f*style.floor);
  bands.push(h-.35);
  for(let e=0;e<ring.length&&e<32;e++){
    const a=ring[e],b=ring[(e+1)%ring.length],len=Math.hypot(b.x-a.x,b.y-a.y);
    if(len*metresPerTile<2)continue;
    let nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len;
    if((centre.x-(a.x+b.x)/2)*nx+(centre.y-(a.y+b.y)/2)*ny<0){nx=-nx;ny=-ny;}
    const depth=(family===1?.5:.24)/metresPerTile;
    const inset=p=>[p.x-nx*depth,p.y-ny*depth];
    const ai=inset(a),bi=inset(b);
    for(const y of bands){
      const t=Math.min(.32,h*.03);
      quad([a.x,a.y,y],[b.x,b.y,y],[bi[0],bi[1],y+t],[ai[0],ai[1],y+t]);
      quad([ai[0],ai[1],y-t],[bi[0],bi[1],y-t],[bi[0],bi[1],y+t],[ai[0],ai[1],y+t]);
    }
    // Vertical facade divisions at the scale visible from an aircraft.
    if(family===2||family===3||family===4||family===7){
      const count=Math.min(10,Math.floor(len*metresPerTile/(family===7?9:7)));
      for(let i=1;i<=count;i++){
        const t=i/(count+1),cx=a.x+(b.x-a.x)*t,cy=a.y+(b.y-a.y)*t;
        const sx=(b.x-a.x)/len*.22/metresPerTile,sy=(b.y-a.y)/len*.22/metresPerTile;
        const px=cx-nx*.15/metresPerTile,py=cy-ny*.15/metresPerTile;
        quad([px-sx,py-sy,Math.min(3,h*.2)],[px+sx,py+sy,Math.min(3,h*.2)],[px+sx,py+sy,h-.5],[px-sx,py-sy,h-.5],color.map(v=>v*1.2));
      }
    }
  }
  return quads;
}

/** Only convex, unperforated midrise/tower plates receive inferred setbacks.
 * The source footprint and roof height are preserved. Concave courtyards and
 * mapped elevated structures keep their exact extrusions. */
export function steppedBuildingLevels(polygon,height,style) {
  const ring=polygon.outer;
  if(polygon.holes.length||ring.length<4||ring.length>12||height<42||height>150||![2,3].includes(style.family)||style.seed%3===0)return null;
  let sign=0;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],c=ring[(i+2)%ring.length];
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if(Math.abs(cross)<1e-7)continue;
    if(sign&&sign!==Math.sign(cross))return null;sign=Math.sign(cross);
  }
  if(!sign)return null;
  return [{top:Math.floor(height*.62/style.floor)*style.floor,scale:1},{top:Math.floor(height*.85/style.floor)*style.floor,scale:.91},{top:height,scale:.79}];
}

export function emitSteppedBuilding(mesh,vertex,polygon,levels,bottom,baseColor,wallColor,roofColor,metres,uPeriod,vPeriod){
  const ring=polygon.outer,n=ring.length,c=ring.reduce((v,p)=>({x:v.x+p.x/n,y:v.y+p.y/n}),{x:0,y:0});
  const at=(p,s)=>({x:c.x+(p.x-c.x)*s,y:c.y+(p.y-c.y)*s});
  const quad=(a,b,d,e)=>mesh.idx.push(a,d,b,a,e,d);
  let y=bottom;
  for(let level=0;level<levels.length;level++){
    const {top,scale}=levels[level],next=levels[level+1]?.scale;
    for(let i=0;i<n;i++){
      const a=at(ring[i],scale),b=at(ring[(i+1)%n],scale);
      const length=Math.hypot(a.x-b.x,a.y-b.y);if(length<1e-5)continue;
      const half=length*metres/uPeriod/2;
      quad(vertex(a.x,a.y,y,level?wallColor:baseColor,.5-half,y/vPeriod),vertex(b.x,b.y,y,level?wallColor:baseColor,.5+half,y/vPeriod),vertex(b.x,b.y,top,wallColor,.5+half,top/vPeriod),vertex(a.x,a.y,top,wallColor,.5-half,top/vPeriod));
      if(next){
        const ai=at(ring[i],next),bi=at(ring[(i+1)%n],next);
        quad(vertex(a.x,a.y,top,roofColor),vertex(b.x,b.y,top,roofColor),vertex(bi.x,bi.y,top,roofColor),vertex(ai.x,ai.y,top,roofColor));
      }
    }
    y=top;
  }
  const top=levels.at(-1),centre=vertex(c.x,c.y,top.top,roofColor);
  for(let i=0;i<n;i++){
    const a=at(ring[i],top.scale),b=at(ring[(i+1)%n],top.scale);
    if(Math.hypot(a.x-b.x,a.y-b.y)<1e-5)continue;
    mesh.idx.push(centre,vertex(b.x,b.y,top.top,roofColor),vertex(a.x,a.y,top.top,roofColor));
  }
}
