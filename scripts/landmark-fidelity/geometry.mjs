// Offline architectural modeling tools. No runtime geometry generation or textures.
import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
export { T };

export const SURFACES = {
  limestone: ['#c9bca2', .88, 0], marble: ['#e1d8c5', .64, .015],
  trim: ['#e7dcc4', .74, 0], recess: ['#5a5346', .95, 0],
  iron: ['#79634e', .55, .58], steel: ['#b3c0c5', .32, .8],
  darkSteel: ['#3c4951', .4, .68], glass: ['#526f81', .23, .38],
  darkGlass: ['#293e4d', .22, .35], ceramic: ['#ece8da', .42, .04],
  gold: ['#c7a25c', .31, .72], slate: ['#435e66', .67, .32],
  blue: ['#163653', .5, .28], whiteSteel: ['#d4d5cd', .39, .42],
};

/** Explicit per-part PBR and night response survives the single-mesh merge. */
export function finishSurface(g, role = 'limestone', options = {}) {
  const spec = SURFACES[role] ?? SURFACES.limestone;
  const col = new T.Color(options.color ?? spec[0]);
  const p = g.attributes.position, n = p.count;
  const c = new Uint8Array(n * 3), surface = new Float32Array(n * 2), light = new Float32Array(n * 3);
  const base = col.toArray(), emit = options.emit ?? (role.includes('Glass') || role === 'glass' ? 0 : .045);
  const glow = new T.Color(options.glow ?? '#ffddb0');
  const baked = g.attributes.color;
  for (let i = 0; i < n; i++) {
    const x=p.getX(i), y=p.getY(i), z=p.getZ(i);
    const wear=options.wear === false ? 1 : .97+.02*Math.sin(x*.73+y*.16+z*.41)*Math.sin(y*1.73-z*.2);
    for(let k=0;k<3;k++) c[i*3+k]=Math.round(Math.max(0,Math.min(1,(options.keepColor && baked ? baked.getComponent(i,k) : base[k])*wear))*255);
    surface.set([options.roughness ?? spec[1], options.metalness ?? spec[2]],i*2);
    const ny=g.attributes.normal?.getY(i) ?? 0;
    const wash=emit*(options.unlitMask ? 1 : .6+.4*Math.max(0,-ny));
    light.set([glow.r*wash,glow.g*wash,glow.b*wash],i*3);
  }
  for (const name of Object.keys(g.attributes)) if(!['position','normal'].includes(name))g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.setAttribute('color',new T.BufferAttribute(c,3,true));
  g.setAttribute('_model_surface',new T.BufferAttribute(surface,2));
  g.setAttribute('_model_light',new T.BufferAttribute(light,3));
  if(!g.index)g.setIndex(Array.from({length:n},(_,i)=>i));
  return g;
}

export class Architecture {
  constructor(level){this.level=level;this.detail=level==='high'?2:level==='medium'?1:0;this.parts=[];}
  add(g,role,options){this.parts.push(finishSurface(g,role,options));return g;}
  box(x,y,z,w,h,d,role='limestone',options={}) {
    const g=new T.BoxGeometry(w,h,d);g.translate(x,y+h/2,z);return this.add(g,role,options);
  }
  cylinder(x,y,z,rb,rt,h,role='limestone',segments=24,options={}) {
    const g=new T.CylinderGeometry(rt,rb,h,segments,1);g.translate(x,y+h/2,z);return this.add(g,role,options);
  }
  beam(a,b,width,depth=width,role='steel',options={}) {
    const start=new T.Vector3(...a),end=new T.Vector3(...b),d=end.clone().sub(start);
    const g=new T.BoxGeometry(width,d.length(),depth);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.normalize()));
    g.translate(...start.add(end).multiplyScalar(.5).toArray());return this.add(g,role,options);
  }
  lathe(x,y,z,profile,role='limestone',segments=32,options={}) {
    const g=new T.LatheGeometry(profile.map(([r,h])=>new T.Vector2(r,h)),segments);
    g.translate(x,y,z);return this.add(g,role,options);
  }
  // A framed vertical face, local +Z outward; yaw and offset are architectural coordinates.
  face(x,y,z,w,h,role='glass',yaw=0,options={}) {
    const g=new T.PlaneGeometry(w,h);g.rotateY(yaw);g.translate(x,y+h/2,z);return this.add(g,role,options);
  }
  ring(x,y,z,r,tube,role='trim',segments=32,options={}) {
    const g=new T.TorusGeometry(r,tube,4,segments);g.rotateX(Math.PI/2);g.translate(x,y,z);return this.add(g,role,options);
  }
  /** Open arch with a real intrados: no black decal pretending to be a hole. */
  arch(x,y,z,r,rise,thick,depth,role='trim',yaw=0,segments=12) {
    const shape=new T.Shape();
    for(let i=0;i<=segments;i++){const a=i/segments*Math.PI;const u=Math.cos(a)*(r+thick),v=Math.sin(a)*(rise+thick);i?shape.lineTo(u,v):shape.moveTo(u,v);}
    for(let i=segments;i>=0;i--){const a=i/segments*Math.PI;shape.lineTo(Math.cos(a)*r,Math.sin(a)*rise);}
    shape.closePath();
    const g=new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false,steps:1});g.translate(0,0,-depth/2);g.rotateY(yaw);g.translate(x,y,z);return this.add(g,role);
  }
  dome(x,y,z,r,h,role='marble',segments=48,options={}) {
    // Bulbous Mughal profile with a restrained lotus crown, not a sphere on a box.
    const profile=[[r*.77,0],[r*.85,h*.08],[r*.96,h*.22],[r,h*.36],[r*.94,h*.51],[r*.78,h*.67],[r*.54,h*.80],[r*.25,h*.91],[r*.08,h*.98],[0,h]];
    return this.lathe(x,y,z,profile,role,segments,options);
  }
  end(){
    const raw=mergeGeometries(this.parts,false);this.parts.forEach(g=>g.dispose());
    const g=mergeVertices(raw,1e-5);raw.dispose();
    const p=g.attributes.position,idx=g.index,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),clean=[];
    for(let i=0;i<idx.count;i+=3){const ia=idx.getX(i),ib=idx.getX(i+1),ic=idx.getX(i+2);a.fromBufferAttribute(p,ia);b.fromBufferAttribute(p,ib).sub(a);c.fromBufferAttribute(p,ic).sub(a);if(b.cross(c).lengthSq()>1e-14)clean.push(ia,ib,ic);}
    g.setIndex(clean);
    const expanded=g.toNonIndexed(),compact=mergeVertices(expanded,1e-5);expanded.dispose();g.dispose();
    const normals=compact.attributes.normal;
    for(let i=0;i<normals.count;i++){
      const x=normals.getX(i),y=normals.getY(i),z=normals.getZ(i),len=Math.hypot(x,y,z);
      normals.setXYZ(i,len>1e-8?x/len:0,len>1e-8?y/len:1,len>1e-8?z/len:0);
    }
    compact.computeBoundingBox();return compact;
  }
}

/** Glazing recessed between solid floor bands and mullions. High/medium share silhouette. */
export function facade(b,{x=0,z=0,y,w,d,h,spacing=3.3,floor=4.1,stone='trim',glass='glass',frame=.28,night=.26,windowRatio=.72}) {
  if(!b.detail)return;
  const stride=b.detail===2?1:2;
  for(let side=0;side<4;side++){
    const yaw=side*Math.PI/2,span=side%2?d:w,dist=(side%2?w:d)/2;
    const world=(u,v)=>[x+u*Math.cos(yaw)+v*Math.sin(yaw),z-u*Math.sin(yaw)+v*Math.cos(yaw)];
    const cols=Math.max(1,Math.floor((span-1)/spacing)),cw=(span-1)/cols;
    for(let i=0;i<=cols;i+=stride){const [px,pz]=world(-span/2+.5+i*cw,dist+.12);const g=b.box(px,y,pz,frame,h,.28,stone);g.translate(-px,0,-pz);g.rotateY(yaw);g.translate(px,0,pz);}
    for(let f=0;f<Math.floor(h/floor);f+=stride){
      const fy=y+f*floor;
      const [px,pz]=world(0,dist+.13);const g=b.box(px,fy,pz,span,.3,.32,stone);g.translate(-px,0,-pz);g.rotateY(yaw);g.translate(px,0,pz);
      for(let i=0;i<cols;i+=stride){
        const cells=Math.min(stride,cols-i),[wx,wz]=world(-span/2+.5+(i+cells/2)*cw,dist+.025),hash=(i*17+f*31+side*13)%11;
        b.face(wx,fy+.7,wz,(cw*cells-frame)*windowRatio,Math.min(floor*stride-1.3,y+h-fy-.75),glass,yaw,{color:hash<3?'#3e5666':hash<7?'#536b79':'#768e9c',emit:hash<4?night:0,unlitMask:true});
      }
    }
  }
}
