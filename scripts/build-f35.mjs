/**
 * F-35A Lightning II — original Skyloom geometry, no downloaded meshes/textures.
 * Rebuild: node scripts/build-f35.mjs
 *
 * USAF proportions: length 15.7 m, span 10.7 m. Reference (dimensions/photos):
 * https://www.af.mil/About-Us/Fact-Sheets/Display/Article/478441/f-35a-lightning-ii/
 * Metres, +Y up, nose -Z. Deliberately clean configuration with closed bays.
 * Six independent surfaces rotate in hinge frames; no fixed skin underneath.
 */
import fs from 'node:fs';
import {finishAircraft} from './aircraft-surface.mjs';
import {pathToFileURL} from 'node:url';
import {Box3,BufferGeometry,Color,CylinderGeometry,Float32BufferAttribute,Group,Matrix4,Mesh,MeshStandardMaterial,Quaternion,SphereGeometry,TorusGeometry,Vector3} from 'three';
import {mergeGeometries,mergeVertices,toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

export const DEF={id:'f35',slug:'f35',length:15.7,span:10.7,type:'stealth-fighter',custom:true,
  colors:{hull:'#747b7e',trim:'#596164',accent:'#92999c'},
  url:'/models/player-f35-hero-v3.glb',mobileUrl:'/models/player-f35-mobile-v3.glb',thumbnail:'/models/player-f35-v3.svg',
  yawFixRad:0,forceVertexColors:false,canopyMaterial:'glass',liverySlots:['hull','trim','accent'],
  parts:{ailerons:['aileron-left','aileron-right'],elevators:['elevator-left','elevator-right'],rudder:['rudder-left','rudder-right'],propeller:null},
  // Nozzle lip aft plane; navigation lights on outer leading-edge fillets.
  engines:[[0,-.08,7.83]],lights:{left:[-5.31,.125,2.2],right:[5.31,.125,2.2],tail:[0,.67,6.16],beacon:[0,1.01,.7],landing:[[-.56,-.77,-4.25],[.56,-.77,-4.25]]},
  author:'Skyloom',license:'MIT',revision:3};
const mix=(a,b,t)=>a+(b-a)*t;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,t)=>{t=clamp((t-a)/(b-a),0,1);return t*t*(3-2*t);};
const V=p=>new Vector3(...p);

// z, half-width, upper radius, lower radius, chine extension. The shoulder
// broadens at the intake/wing carry-through, then closes around the F135.
const BODY=[[-7.85,.006,.008,.009,.01],[-7.5,.16,.13,.15,.04],[-6.9,.39,.28,.29,.10],[-6.1,.63,.45,.39,.12],[-5.25,.78,.59,.48,.13],[-4.35,.91,.76,.59,.13],[-3.5,1.04,.89,.76,.15],[-2.4,1.16,.99,.92,.18],[-1,1.32,1.02,1.04,.14],[.65,1.37,1.01,1.08,.12],[2.1,1.25,.91,1.04,.11],[3.5,1.13,.82,.99,.08],[4.9,1.03,.76,.92,.04],[6.1,.86,.70,.86,0],[6.65,.77,.665,.815,0],[7.17,.72,.64,.80,0]];
// Shape-preserving cubic interpolation keeps the longitudinal loft smooth
// without overshooting the nose or the monotone aft engine fairing.
function sample(rows,z){
  let i=rows.findIndex((a,k)=>k<rows.length-1&&z>=a[0]&&z<=rows[k+1][0]);
  if(i<0)return (z<rows[0][0]?rows[0]:rows.at(-1)).slice(1);
  const a=rows[i],b=rows[i+1],d=b[0]-a[0],t=(z-a[0])/d,out=[];
  for(let j=1;j<a.length;j++){
    const slope=k=>(rows[k+1][j]-rows[k][j])/(rows[k+1][0]-rows[k][0]);
    const m=k=>{if(k===0)return slope(0);if(k===rows.length-1)return slope(k-1);const p=slope(k-1),q=slope(k);return p*q<=0?0:2*p*q/(p+q);};
    out.push((2*t*t*t-3*t*t+1)*a[j]+(t*t*t-2*t*t+t)*m(i)*d+(-2*t*t*t+3*t*t)*b[j]+(t*t*t-t*t)*m(i+1)*d);
  }
  return out;
}
function bodyPoint(z,a,lift=0){const [w,up,dn,chine]=sample(BODY,z),s=Math.sin(a),c=Math.cos(a);return [c*(w+chine*Math.exp(-((s/.18)**2)))+lift*c,(s>=0?up:dn)*s+lift*s,z];}
function bodyTop(x,z,lift=.009){const [w,up]=sample(BODY,z);return [x,up*Math.sqrt(Math.max(0,1-(x/w)**2))+lift,z];}
function geom(pos,ix,crease=null){
  // Closed thin foils meet exactly at their leading/trailing edges. Cull the
  // zero-area closure cells, then compact so no unused zero normal exports.
  const p=[],index=[],map=new Map();
  for(let i=0;i<ix.length;i+=3){const ids=ix.slice(i,i+3),q=ids.map(k=>new Vector3().fromArray(pos,k*3));if(q[1].clone().sub(q[0]).cross(q[2].clone().sub(q[0])).lengthSq()<1e-15)continue;
    for(const id of ids){if(!map.has(id)){map.set(id,p.length/3);p.push(...pos.slice(id*3,id*3+3));}index.push(map.get(id));}}
  let g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(index);g.computeVertexNormals();if(crease!==null)g=mergeVertices(toCreasedNormals(g,crease),1e-5);return g;
}
function soup(points,dir){const p=[],ix=[];for(const q of points){const n=V(q[1]).sub(V(q[0])).cross(V(q[2]).sub(V(q[0])));if(n.lengthSq()<1e-13)continue;const tri=dir&&n.dot(V(dir))<0?[q[0],q[2],q[1]]:q;const o=p.length/3;p.push(...tri.flat());ix.push(o,o+1,o+2);}return geom(p,ix,.42);}
function rings(rows,segments,point,{capStart=false,capEnd=false}={}){
  const p=[],ix=[];for(const r of rows)for(let j=0;j<segments;j++)p.push(...point(r,j/segments*Math.PI*2));
  for(let i=0;i<rows.length-1;i++)for(let j=0;j<segments;j++){const a=i*segments+j,b=i*segments+(j+1)%segments,c=a+segments,d=b+segments;ix.push(a,b,c,b,d,c);}
  for(const [cap,k,flip] of [[capStart,0,true],[capEnd,rows.length-1,false]])if(cap){const center=[0,0,0];for(let j=0;j<segments;j++)for(let s=0;s<3;s++)center[s]+=p[(k*segments+j)*3+s]/segments;const ci=p.length/3;p.push(...center);for(let j=0;j<segments;j++){const a=k*segments+j,b=k*segments+(j+1)%segments;flip?ix.push(ci,b,a):ix.push(ci,a,b);}}
  return geom(p,ix);
}

export function build(low=false){
  const root=new Group();root.name='Skyloom F-35A Lightning II';root.userData={author:'Skyloom',license:'MIT',revision:3,lod:low?'mobile':'hero',units:'metres',nose:'-Z'};
  const materialSpec={hull:[DEF.colors.hull,.46,.16],trim:[DEF.colors.trim,.54,.15],accent:[DEF.colors.accent,.42,.22],glass:['#736443',.12,.55],metal:['#737275',.34,.7],dark:['#10181e',.8,.05]};
  const mats=Object.fromEntries(Object.entries(materialSpec).map(([name,[color,roughness,metalness]])=>[name,new MeshStandardMaterial({name,color,roughness,metalness})]));
  const buckets=Object.fromEntries(Object.keys(mats).map(k=>[k,[]]));
  const add=(g,role='hull')=>{if(g?.attributes.position.count)buckets[role].push(g);};
  const rod=(a,b,r=.012,role='trim')=>{const d=V(b).sub(V(a)),g=new CylinderGeometry(r,r,d.length(),low?4:6,1);g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),d.normalize()));g.translate(...V(a).add(V(b)).multiplyScalar(.5).toArray());g.deleteAttribute('uv');add(g,role);};
  const poly=(points,role='trim',dir=[0,1,0])=>{const tris=[];for(let i=1;i<points.length-1;i++)tris.push([points[0],points[i],points[i+1]]);add(soup(tris,dir),role);};
  const lens=(p,r,role='accent')=>{const g=new SphereGeometry(1,low?6:10,low?4:6);g.scale(...r);g.translate(...p);g.deleteAttribute('uv');add(g,role);};
  // The body mesh shares its station vertices and normals across its full skin.
  const zs=[...new Set([...BODY.map(s=>s[0]),...Array.from({length:low?24:60},(_,i)=>mix(-7.85,7.17,i/((low?24:60)-1)))])].sort((a,b)=>a-b);
  add(rings(zs,low?24:48,(z,a)=>bodyPoint(z,a),{capStart:true}));

  // Closed cambered airfoil; the split trailing segment is a genuine cutout.
  const WING=[[1.02,-1.87,5.54,-.10,.31],[1.9,-1.22,4.97,-.07,.26],[3.1,-.09,3.94,.01,.19],[5.15,1.79,1.99,.095,.09],[5.35,1.98,1.76,.11,.075]];
  const wingSample=x=>sample(WING,x);
  const foil=(u,t)=>t*(.2969*Math.sqrt(Math.max(0,u))-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)/.2;
  function wingGeo(side,x0,x1,u0=0,u1=1,tail=false){
    const list=tail?[[1.02,4.42,2.65,.02,.16],[2.3,4.63,2.52,.035,.12],[3.93,5.51,1.34,.05,.07]]:WING;
    const get=x=>sample(list,x),xs=[x0,...list.map(s=>s[0]).filter(x=>x>x0&&x<x1),x1],n=low?5:11,p=[],ix=[],stride=(n+1)*2;
    const points=[];
    for(const x of xs){const [le,c,y,t]=get(x),row=[];for(const sign of [1,-1])for(let j=0;j<=n;j++){const u=mix(u0,u1,(1-Math.cos(j/n*Math.PI))/2),q=[side*x,y+sign*foil(u,t)*.5+.015*Math.sin(u*Math.PI),le+u*c];row.push(q);p.push(...q);}points.push(row);}
    for(let i=0;i<xs.length-1;i++)for(let j=0;j<n;j++){const a=i*stride+j,b=a+1,c=a+stride,d=c+1;ix.push(a,b,c,b,d,c);const A=a+n+1,B=A+1,C=A+stride,D=C+1;ix.push(A,C,B,B,C,D);}
    for(let i=0;i<xs.length-1;i++)for(const j of [0,n]){const a=i*stride+j,b=a+n+1,c=a+stride,d=b+stride;j===0?ix.push(a,c,b,b,c,d):ix.push(a,b,c,b,d,c);}
    for(const [i,sgn] of [[0,-1],[xs.length-1,1]]){const path=[...Array.from({length:n+1},(_,j)=>i*stride+j),...Array.from({length:n+1},(_,j)=>i*stride+2*n+1-j)],ctr=points[i].reduce((s,q)=>s.map((v,k)=>v+q[k]/stride),[0,0,0]),ci=p.length/3;p.push(...ctr);for(let j=0;j<path.length;j++){const a=path[j],b=path[(j+1)%path.length];sgn<0?ix.push(ci,b,a):ix.push(ci,a,b);}}
    if(side<0)for(let i=0;i<ix.length;i+=3)[ix[i+1],ix[i+2]]=[ix[i+2],ix[i+1]];
    return geom(p,ix);
  }
  // Axis is always positive global X/Y as expected by fleetAnimator.
  function animated(name,g,a,b,axis,role='hull'){
    let X,Y,Z;const direction=V(b).sub(V(a)).normalize();
    if(axis==='x'){X=direction;Y=new Vector3(0,1,0).addScaledVector(X,-X.y).normalize();Z=new Vector3().crossVectors(X,Y);}
    else {Y=direction;X=new Vector3(1,0,0).addScaledVector(Y,-Y.x).normalize();Z=new Vector3().crossVectors(X,Y);}
    const basis=new Matrix4().makeBasis(X,Y,Z),pivot=V(a).add(V(b)).multiplyScalar(.5),frame=new Group(),part=new Group();
    g.applyMatrix4(new Matrix4().makeTranslation(...pivot.toArray()).multiply(basis).invert());
    frame.name=`${name}-hinge`;frame.position.copy(pivot);frame.quaternion.setFromRotationMatrix(basis);part.name=name;const mesh=new Mesh(g,mats[role]);mesh.name=`${name}-skin`;part.add(mesh);frame.add(part);root.add(frame);
  }
  for(const side of [-1,1]){
    const suffix=side<0?'left':'right';
    add(wingGeo(side,1.02,3.10));add(wingGeo(side,3.10,5.15,0,.755));add(wingGeo(side,5.15,5.35));
    const hinge=x=>{const [le,c,y]=wingSample(x);return [side*x,y,le+.762*c];};
    const ends=[hinge(3.115),hinge(5.135)].sort((a,b)=>a[0]-b[0]);
    animated(`aileron-${suffix}`,wingGeo(side,3.115,5.135,.77,1),...ends,'x');
    animated(`elevator-${suffix}`,wingGeo(side,1.02,3.93,0,1,true),[side<0?-3.93:1.02,.035,side<0?5.9:5.18],[side<0?-1.02:3.93,.035,side<0?5.18:5.9],'x');
    // Longitudinal edge RAM tape is broad enough to read without line noise.
    const a=wingSample(2.03),b=wingSample(5.13);
    poly([[side*2.03,a[2]+.055,a[0]+.18],[side*5.13,b[2]+.025,b[0]+.09],[side*5.13,b[2]+.035,b[0]+.17],[side*2.03,a[2]+.075,a[0]+.3]],'trim');
    lens([side*5.29,.132,2.17],[.045,.027,.11],side<0?'accent':'glass');
  }

  // Two swept fins, each canted 26 degrees outwards. Forward fin and rudder
  // meet at u=.72 with a 2 cm articulation clearance, never overlapping.
  function finGeo(side,u0,u1){
    const heights=low?4:9,n=low?4:9,p=[],ix=[],stride=(n+1)*2;
    const finPoint=(h,u,d)=>{const y=mix(.51,2.87,h),x=side*(1.1+.49*(y-.51));return [x+d*(1-.38*h),y,mix(2.49,4.65,h)+u*mix(3.91,1.36,h)];};
    for(let i=0;i<=heights;i++)for(const sideFace of [-1,1])for(let j=0;j<=n;j++){const h=i/heights,u=mix(u0,u1,j/n),th=.075*Math.sin(Math.PI*u)**.6;const q=finPoint(h,u,sideFace*th);p.push(...q);}
    for(let i=0;i<heights;i++)for(let f=0;f<2;f++)for(let j=0;j<n;j++){const a=i*stride+f*(n+1)+j,b=a+1,c=a+stride,d=c+1;f===0?ix.push(a,b,c,b,d,c):ix.push(a,c,b,b,c,d);}
    for(let i=0;i<heights;i++)for(const j of [0,n]){const a=i*stride+j,b=a+n+1,c=a+stride,d=b+stride;j===0?ix.push(a,c,b,b,c,d):ix.push(a,b,c,b,d,c);}
    for(const k of [0,heights])for(let j=0;j<n;j++){const a=k*stride+j,b=a+1,c=a+n+1,d=c+1;k===0?ix.push(a,c,b,b,c,d):ix.push(a,b,c,b,d,c);}
    return geom(p,ix);
  }
  for(const side of [-1,1]){
    add(finGeo(side,0,.712));
    const a=[side*1.1,.51,2.49+.722*3.91],b=[side*(1.1+.49*2.36),2.87,4.65+.722*1.36];
    animated(`rudder-${side<0?'left':'right'}`,finGeo(side,.727,1),a,b,'y','trim');
    // Small muted two-band fin recognition mark, over the outer fin face.
    for(const y of [2.22,2.36]){const t=(y-.51)/2.36,x=side*(1.1+.49*(y-.51)+.063*(1-.38*t)),z=mix(2.49,4.65,t);poly([[x,y,z+.29],[x+side*.032,y+.064,z+.33],[x+side*.032,y+.064,z+.78],[x,y,z+.79]],'accent',[side,0,0]);}
  }

  // Recessed six-sided DSI intakes; a continuous outer shell and an inner
  // duct lead to a black throat .6 m behind the lip (no flat black sticker).
  for(const side of [-1,1]){
    const front=[[1.04,.52,-3.75],[1.46,.57,-3.52],[1.72,.39,-3.38],[1.82,-.30,-3.22],[1.59,-.66,-3.3],[1.10,-.68,-3.62]].map(p=>[p[0]*side,p[1],p[2]]);
    const c=front.reduce((s,p)=>s.map((v,k)=>v+p[k]/front.length),[0,0,0]);
    const inset=front.map(p=>p.map((v,k)=>mix(v,c[k],.1)+(k===2?.06:0)));
    const inner=inset.map(p=>[p[0]*.97,p[1]*.84,p[2]+.64]);
    const back=front.map(p=>[side*(.99+(Math.abs(p[0])-1)*.48),p[1]*.78,p[2]+4.8]);
    const rings=[front,front.map(p=>[p[0]*1.025,p[1]*1.06,p[2]+.52]),back],outer=[],lip=[],tunnel=[];
    for(let r=0;r<rings.length-1;r++)for(let j=0;j<front.length;j++){const k=(j+1)%front.length;outer.push([rings[r][j],rings[r][k],rings[r+1][j]],[rings[r][k],rings[r+1][k],rings[r+1][j]]);}
    for(let j=0;j<front.length;j++){const k=(j+1)%front.length;lip.push([front[j],front[k],inset[j]],[front[k],inset[k],inset[j]]);tunnel.push([inset[j],inset[k],inner[j]],[inset[k],inner[k],inner[j]]);}
    // Shell face winding from its local centre, preserving the intake opening.
    const shell=[];for(const tri of outer){const center=tri.reduce((s,p)=>s.map((v,k)=>v+p[k]/3),[0,0,0]);const dir=[center[0]-side*1.28,center[1],0];const n=V(tri[1]).sub(V(tri[0])).cross(V(tri[2]).sub(V(tri[0])));shell.push(n.dot(V(dir))<0?[tri[0],tri[2],tri[1]]:tri);}
    add(soup(shell),'hull');add(soup(lip,[0,0,-1]),'trim');add(soup(tunnel,[-side,0,0]),'dark');poly(inner,'dark',[0,0,-1]);
  }

  // One-piece gold canopy, with a thin perimeter sill and a flush fore frame.
  const CANOPY=[[-5.67,.012,.43,.012],[-5.4,.24,.5,.26],[-4.87,.46,.64,.55],[-4.05,.52,.76,.58],[-3.38,.48,.83,.55],[-2.87,.37,.88,.41],[-2.51,.015,.92,.02]];
  const rows=[...new Set([...CANOPY.map(s=>s[0]),...Array.from({length:low?10:22},(_,i)=>mix(-5.67,-2.51,i/((low?10:22)-1)))])].sort((a,b)=>a-b),arc=low?10:22,p=[],ix=[];
  for(const z of rows){const [w,base,height]=sample(CANOPY,z);for(let j=0;j<=arc;j++){const a=j/arc*Math.PI;p.push(Math.cos(a)*w,base+height*Math.sin(a),z);}}
  for(let i=0;i<rows.length-1;i++)for(let j=0;j<arc;j++){const a=i*(arc+1)+j,b=a+1,c=a+arc+1,d=c+1;ix.push(a,b,c,b,d,c);}
  add(geom(p,ix),'glass');
  for(const side of [-1,1])for(let i=0;i<rows.length-1;i++){const z0=rows[i],z1=rows[i+1],a=sample(CANOPY,z0),b=sample(CANOPY,z1);rod([side*a[0],a[1]+.01,z0],[side*b[0],b[1]+.01,z1],low?.012:.014,'trim');}
  // Dorsal refuelling hatch and sawtooth RAM seams, projected onto the loft.
  function bodyLine(path,width=.012,role='trim'){
    for(let i=0;i<path.length-1;i++){const a=path[i],b=path[i+1],n=low?1:Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.34));for(let j=0;j<n;j++){const x0=mix(a[0],b[0],j/n),z0=mix(a[1],b[1],j/n),x1=mix(a[0],b[0],(j+1)/n),z1=mix(a[1],b[1],(j+1)/n);rod(bodyTop(x0,z0,.014),bodyTop(x1,z1,.014),width,role);}}
  }
  bodyLine([[-.39,-.84],[-.39,.07],[0,.34],[.39,.07],[.39,-.84],[-.39,-.84]],.013);
  for(const side of [-1,1]){
    bodyLine([[side*.59,1.46],[side*.76,1.66],[side*.62,1.85],[side*.77,2.02],[side*.53,4.23]],.01);
    // Canopy shoulder chine retains the fighter's long forward arrow shape.
    if(!low)bodyLine([[side*.38,-6.3],[side*.60,-5.54],[side*.74,-4.85]],.009,'accent');
    if(!low)for(let j=0;j<5;j++)bodyLine([[side*.66,2.32+j*.15],[side*.92,2.41+j*.15]],.018,'dark');
  }
  // Faceted EOTS window under the nose, seated in a small blended fairing.
  poly([[-.22,-.55,-5.35],[.22,-.55,-5.35],[.20,-.82,-4.82],[-.2,-.82,-4.82]],'metal',[0,-1,-.3]);
  poly([[-.18,-.575,-5.31],[.18,-.575,-5.31],[.16,-.82,-4.91],[-.16,-.82,-4.91]],'glass',[0,-1,-.3]);

  // Single F135 exhaust. Individual convergent petals alternate depth at the
  // aft edge, with an inset annular throat and centre flameholder, not a cap.
  const petals=low?16:24,n=petals*2;
  // The shroud continues the tapered aft fuselage. The old .94 m flare
  // exceeded the surrounding skin and exposed 1.75 m of engine hardware.
  add(rings([7.08,7.19,7.28],n,(z,a)=>{const r=mix(.725,.705,smooth(7.08,7.28,z));return [Math.cos(a)*r,Math.sin(a)*r-.08,z];}),'metal');
  const petalTris=[];for(let i=0;i<petals;i++){
    const a0=(i+.05)/petals*Math.PI*2,a1=(i+.95)/petals*Math.PI*2,am=(a0+a1)/2;
    const point=(a,r,z)=>[Math.cos(a)*r,Math.sin(a)*r-.08,z],A=point(a0,.706,7.25),B=point(a1,.706,7.25),C=point(a0,.62,7.85),D=point(a1,.62,7.85),M=point(am,.633,7.81);
    petalTris.push([A,B,M],[A,M,C],[B,D,M]);
    if(!low)rod(point(am,.709,7.30),point(am,.647,7.69),.006,'trim');
  }
  add(soup(petalTris),'metal');
  // Duct is intentionally inward-facing; its far black cap occludes the hull.
  const duct=rings([6.70,7.85],n,(z,a)=>{const r=mix(.40,.603,(z-6.70)/1.15);return [Math.cos(a)*r,Math.sin(a)*r-.08,z];});
  const di=duct.index.array;for(let i=0;i<di.length;i+=3)[di[i+1],di[i+2]]=[di[i+2],di[i+1]];duct.computeVertexNormals();add(duct,'dark');
  const disk=new CylinderGeometry(.40,.40,.015,n,1,false);disk.rotateX(Math.PI/2);disk.translate(0,-.08,6.7);disk.deleteAttribute('uv');add(disk,'dark');
  const ring=new TorusGeometry(.32,.015,low?3:5,n);ring.translate(0,-.08,6.75);ring.deleteAttribute('uv');add(ring,'metal');
  lens([0,-.08,6.78],[.075,.075,.045],'metal');
  for(let i=0;i<(low?6:12);i++){const a=i/(low?6:12)*Math.PI*2;rod([Math.cos(a)*.08,Math.sin(a)*.08-.08,6.68],[Math.cos(a+.14)*.31,Math.sin(a+.14)*.31-.08,6.67],.013,'metal');}
  lens([0,1.03,.7],[.065,.025,.10],'accent');
  for(const [role,geos] of Object.entries(buckets))if(geos.length){const mesh=new Mesh(mergeGeometries(geos),mats[role]);mesh.name=role;root.add(mesh);}
  finishAircraft(root,{military:true,stealth:true});
  root.updateMatrixWorld(true);let triangles=0,draws=0;root.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;draws++;}});
  return {root,triangles,draws,budget:low?4800:18000};
}

// Geometry-derived, depth-sorted hangar glyph. Identical oblique projection to
// the existing fleet, with shaded faces and seam-closing same-colour strokes.
export function thumbnail(root){
  const az=Math.PI/6,el=42*Math.PI/180,D=new Vector3(-Math.sin(az)*Math.cos(el),-Math.sin(el),Math.cos(az)*Math.cos(el)),X=new Vector3(Math.cos(az),0,Math.sin(az)),Y=new Vector3().crossVectors(X,D),view=D.clone().negate(),key=new Vector3(.25,1,-.35).normalize(),faces=[];
  const tones={hull:'#aab6bd',trim:'#687985',accent:'#d1c4a2',glass:'#a08c5c',metal:'#8d969d',dark:'#111921'};
  root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry,p=g.attributes.position,base=new Color(tones[o.material.name]);
    for(let i=0;i<p.count;i+=3){const q=[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,i+j).applyMatrix4(o.matrixWorld)),n=q[1].clone().sub(q[0]).cross(q[2].clone().sub(q[0]));if(n.lengthSq()<1e-12||n.normalize().dot(view)<=0)continue;const color=base.clone().multiplyScalar(.49+.72*Math.max(0,n.dot(key)));faces.push({pts:q.map(v=>[v.dot(X),v.dot(Y)]),depth:q.reduce((s,v)=>s+v.dot(D),0)/3,color:`#${color.getHexString()}`});}});
  const pts=faces.flatMap(f=>f.pts),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY,s=Math.min(220/w,100/h),dx=(240-w*s)/2,dy=(120-h*s)/2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><title>F-35A Lightning II</title><g stroke-width=".32" stroke-linejoin="round">${faces.sort((a,b)=>b.depth-a.depth).map(f=>`<path fill="${f.color}" stroke="${f.color}" d="M${f.pts.map(p=>`${((p[0]-minX)*s+dx).toFixed(2)},${((p[1]-minY)*s+dy).toFixed(2)}`).join('L')}Z"/>`).join('')}</g></svg>`;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}};
  const exporter=new GLTFExporter(),rows=[];
  for(const low of [false,true]){const {root,triangles,draws,budget}=build(low);if(triangles>budget)throw Error(`F-35 ${low?'mobile':'hero'} over budget: ${triangles}/${budget}`);if(draws>14)throw Error(`F-35 ${draws} draw calls`);const bounds=new Box3().setFromObject(root),size=bounds.getSize(new Vector3());if(Math.abs(size.x-10.7)>.005||Math.abs(size.z-15.7)>.005)throw Error(`F-35 incorrect bounds: ${size.toArray()}`);const url=low?DEF.mobileUrl:DEF.url,data=await exporter.parseAsync(root,{binary:true});fs.writeFileSync(`public${url}`,Buffer.from(data));if(low)fs.writeFileSync(`public${DEF.thumbnail}`,thumbnail(root));rows.push({id:DEF.id,lod:low?'mobile':'hero',url,triangles,draws,bytes:data.byteLength,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}});}
  fs.writeFileSync('public/models/f35-metrics.json',JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(rows,null,2));
}
