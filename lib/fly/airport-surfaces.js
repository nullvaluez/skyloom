import earcut from 'earcut';

/** Mapped pavement. Width defaults are explicitly inferred from the mapped
 * centreline class; no aircraft, vehicles, gate occupation or flight is invented. */
export function buildAirportSurfaces(vt,span,k){
  const pos=[],uv=[],style=[];
  const evidence={mappedPolygons:0,mappedWidths:0,inferredWidths:0,roadSegments:0};
  let scale=1;
  const roadWidths={motorway:22,trunk:18,primary:12,secondary:10,tertiary:8,minor:6,residential:6,service:4};
  const vertex=(p,t,kind,width)=>{pos.push(p.x*scale,0,p.y*scale);uv.push(t[0],t[1]);style.push(kind,width);};
  const tri=(a,b,c,depth=0)=>{
    const area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));if(area*scale*scale<.0001)return;
    if(depth<5&&Math.max(Math.hypot(b.x-a.x,b.y-a.y),Math.hypot(c.x-b.x,c.y-b.y),Math.hypot(a.x-c.x,a.y-c.y))*scale/k>90){
      const ab={x:(a.x+b.x)/2,y:(a.y+b.y)/2},bc={x:(b.x+c.x)/2,y:(b.y+c.y)/2},ca={x:(c.x+a.x)/2,y:(c.y+a.y)/2};
      tri(a,ab,ca,depth+1);tri(ab,b,bc,depth+1);tri(ca,bc,c,depth+1);tri(ab,bc,ca,depth+1);return;
    }
    for(const p of [a,c,b])vertex(p,[p.x*scale/k,p.y*scale/k],3,0);
  };
  for(const [name,layer] of [['aeroway',vt.layers.aeroway],['transportation',vt.layers.transportation]]){
    if(!layer)continue;scale=span/layer.extent;
    const street=name==='transportation';
    for(let i=0;i<layer.length;i++){
    const f=layer.feature(i),cls=f.properties.class;
    if(street ? !roadWidths[cls]||f.type!==2||f.properties.brunnel : !['runway','taxiway','apron'].includes(cls))continue;
    const rings=f.loadGeometry();
    if(f.type===3){
      let flat=[],holes=[],points=[],sign=0;
      const flush=()=>{if(points.length<3)return;const indices=earcut(flat,holes);for(let j=0;j<indices.length;j+=3)tri(points[indices[j]],points[indices[j+1]],points[indices[j+2]]);};
      for(const ring of rings){
        let area=0;for(let a=0,b=ring.length-1;a<ring.length;b=a++)area+=ring[b].x*ring[a].y-ring[a].x*ring[b].y;
        if(!area)continue;
        if(!sign||Math.sign(area)===sign){flush();flat=[];holes=[];points=[];sign=Math.sign(area);}else holes.push(points.length);
        for(const p of ring){flat.push(p.x,p.y);points.push(p);}
      }
      flush();evidence.mappedPolygons++;
    }else if(f.type===2){
      const mapped=Number(f.properties.width),width=mapped>3&&mapped<100?mapped:street?roadWidths[cls]:cls==='runway'?45:18;
      evidence[mapped>3&&mapped<100?'mappedWidths':'inferredWidths']++;
      const half=width*k/scale/2,kind=street?4:cls==='runway'?1:2;
      if(street)evidence.roadSegments++;
      for(const ring of rings){let travelled=0;
        for(let j=1;j<ring.length;j++){
          const a=ring[j-1],b=ring[j],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<.001)continue;
          const lengthM=len*scale/k,steps=Math.max(1,Math.ceil(lengthM/40)),nx=-dy/len*half,ny=dx/len*half;
          for(let q=0;q<steps;q++){
            const p={x:a.x+dx*q/steps,y:a.y+dy*q/steps},r={x:a.x+dx*(q+1)/steps,y:a.y+dy*(q+1)/steps};
            const corners=[{x:p.x+nx,y:p.y+ny},{x:p.x-nx,y:p.y-ny},{x:r.x-nx,y:r.y-ny},{x:r.x+nx,y:r.y+ny}];
            const tex=[[width/2,travelled+lengthM*q/steps],[-width/2,travelled+lengthM*q/steps],[-width/2,travelled+lengthM*(q+1)/steps],[width/2,travelled+lengthM*(q+1)/steps]];
            for(const v of [0,2,1,0,3,2])vertex(corners[v],tex[v],kind,width);
          }
          travelled+=lengthM;
        }
      }
    }
  }
  }
  return{pos:new Float32Array(pos),uv:new Float32Array(uv),style:new Float32Array(style),evidence};
}
