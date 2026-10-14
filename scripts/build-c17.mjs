/**
 * Skyloom C-17 Globemaster III. Original first-party procedural geometry.
 * Rebuild: node scripts/build-c17.mjs
 * Metres, +Y up, nose -Z. Landing gear is supplied by the runtime.
 * Dimensions: USAF C-17 fact sheet, 53 m long / 51.75 m span.
 * https://www.af.mil/About-Us/Fact-Sheets/Display/Article/1529726/c-17-globemaster-iii/
 * No external meshes, textures, insignia or font assets.
 */
import fs from 'node:fs';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {Box3,BufferGeometry,Color,CylinderGeometry,Float32BufferAttribute,Group,Matrix4,Mesh,MeshStandardMaterial,Quaternion,SphereGeometry,Vector3} from 'three';
import {mergeGeometries,mergeVertices,toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

export const definition={
  id:'c17',slug:'c17',length:53,span:51.75,type:'strategic-airlift',
  colors:{hull:'#9ba7aa',trim:'#4e626b',accent:'#bb975d'},
  url:'/models/player-c17-hero-v1.glb',mobileUrl:'/models/player-c17-mobile-v1.glb',thumbnail:'/models/player-c17-v1.svg',
  yawFixRad:0,forceVertexColors:false,canopyMaterial:'glass',custom:true,
  parts:{ailerons:['aileron-left','aileron-right'],elevators:['elevator-left','elevator-right'],rudder:'rudder',propeller:null},
  liverySlots:['hull','trim','accent'],
  engines:[[-8.3,-.43,-3.25],[-17.1,-.72,1.65],[8.3,-.43,-3.25],[17.1,-.72,1.65]],
  lights:{tail:[0,11.08,24.62],landing:[[-3.65,-1.94,-6.7],[3.65,-1.94,-6.7]]},
  author:'Skyloom',license:'MIT',revision:1,
};

// Cross-sections preserve the short rounded nose, raised flight deck and the
// upswept ramp/tail cone. Elliptical rings have independent top/bottom radii.
// z, width radius, upper radius, lower radius, vertical centre
const BODY=[
  [-26.5,0,0,0,-.33],[-26.35,.58,.54,.50,-.32],[-26.0,1.17,1.06,.85,-.31],
  [-25.35,1.88,1.72,1.38,-.29],[-24.5,2.43,2.25,1.85,-.20],
  [-23.5,2.85,2.87,2.39,-.04],[-22.25,3.15,3.43,2.91,.02],
  [-20.5,3.34,3.63,3.29,.04],[-18,3.42,3.54,3.43,.02],
  [-14,3.45,3.47,3.46,0],[-9,3.45,3.46,3.46,0],[-3,3.45,3.46,3.46,0],
  [3,3.45,3.46,3.46,0],[8,3.44,3.46,3.46,0],[12,3.31,3.40,3.25,.06],
  [15,2.98,3.20,2.74,.24],[18,2.42,2.81,1.95,.50],[21,1.60,2.09,1.02,1.0],
  [23.5,.91,1.31,.48,1.62],[25.2,.38,.62,.22,2.09],[26.3,.10,.18,.07,2.32],[26.5,0,0,0,2.38],
];
const ENGINE=[{x:8.3,y:-.43,z:-10.25},{x:17.1,y:-.72,z:-5.35}];
const WING=[
  [1.8,-8.6,14.35,2.70,1.47],[3.45,-8.12,13.44,2.82,1.38],
  [7,-6.51,11.39,2.78,1.17],[12,-4.24,8.77,2.58,.85],
  [15.9,-2.39,6.91,2.35,.65],[20.25,-.27,4.90,2.09,.45],
  [23.8,1.49,3.28,1.87,.30],[24.82,2.0,2.72,1.81,.25],
  [25.1,2.20,2.41,2.24,.21],[25.48,2.79,1.81,3.93,.14],[25.875,3.46,1.08,5.03,.08],
];
const TAIL=[ [.20,17.17,7.35,10.73,.58],[2.0,17.88,6.59,10.84,.53],[6.4,19.93,4.71,11.07,.32],[10.60,22.10,2.62,11.27,.10] ];
const VFIN=[ [2.40,10.75,14.55,.83],[4.20,12.95,12.02,.65],[7.50,16.2,8.62,.47],[10.75,18.64,6.05,.24] ];
const EPS=.026;
const mix=(a,b,t)=>a+(b-a)*t;
const v=p=>new Vector3(...p);
const triangleNormal=(a,b,c)=>v(b).sub(v(a)).cross(v(c).sub(v(a)));

function geometry(p,i){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p.flat(),3));g.setIndex(i);g.computeVertexNormals();return g;}
function soupGeometry(soup){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(soup.flat(2),3));return mergeVertices(toCreasedNormals(g,.68),1e-5);}
function tri(soup,a,b,c,dir){const normal=triangleNormal(a,b,c);if(normal.lengthSq()<1e-13)return;if(dir&&normal.dot(v(dir))<0)[b,c]=[c,b];soup.push([a,b,c]);}
function quad(soup,a,b,c,d,dir){tri(soup,a,b,c,dir);tri(soup,a,c,d,dir);}
function refine(rows,n){const out=[];for(let i=0;i<rows.length-1;i++)for(let j=0;j<n;j++)out.push(rows[i].map((x,k)=>mix(x,rows[i+1][k],j/n)));out.push(rows.at(-1));return out;}
function interpolate(rows,x){let j=rows.findIndex((r,i)=>i<rows.length-1&&x>=r[0]&&x<=rows[i+1][0]);j=Math.max(0,j);const t=(x-rows[j][0])/(rows[j+1][0]-rows[j][0]);return rows[j].map((a,k)=>mix(a,rows[j+1][k],t));}

export function build(low=false){
  const root=new Group(),n=low?12:36;
  root.name='Skyloom C-17 Globemaster III';
  root.userData={author:'Skyloom',license:'MIT',revision:1,lod:low?'mobile':'hero',units:'metres',nose:'-Z',airframe:'C-17 Globemaster III'};
  const colors={...definition.colors,glass:'#152c3a',metal:'#69747a',dark:'#15232a'};
  const mats=Object.fromEntries(Object.entries(colors).map(([name,color])=>[name,new MeshStandardMaterial({name,color,roughness:name==='glass'?.13:name==='metal'?.31:name==='dark'?.8:.53,metalness:name==='metal'?.70:name==='glass'?.28:.14})]));
  const buckets=Object.fromEntries(Object.keys(mats).map(k=>[k,[]]));
  function add(g,role='hull'){if(!g)return;const normalized=g.index?g.toNonIndexed():g;normalized.deleteAttribute('uv');buckets[role].push(normalized);}
  function ball(pos,radii,role='hull',small=false){const g=new SphereGeometry(1,small?(low?6:10):n,small?4:(low?8:16));g.scale(...radii);g.translate(...pos);add(g,role);}
  function rod(a,b,r,role='trim'){const A=v(a),B=v(b),g=new CylinderGeometry(r,r,A.distanceTo(B),low?3:6,1,true);g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),B.clone().sub(A).normalize()));g.translate(...A.add(B).multiplyScalar(.5).toArray());add(g,role);}
  function polyline(points,r=.025,role='trim'){for(let i=1;i<points.length;i++)rod(points[i-1],points[i],r,role);}
  function slab(points,thick,role='hull',axis=0){const soup=[],off=p=>p.map((x,k)=>x+(axis===k?thick/2:0)),under=p=>p.map((x,k)=>x-(axis===k?thick/2:0));const a=points.map(off),b=points.map(under),center=points.reduce((s,p)=>s.map((x,k)=>x+p[k]/points.length),[0,0,0]);
    const dir=[0,0,0];dir[axis]=1;
    for(let i=1;i<points.length-1;i++){tri(soup,a[0],a[i],a[i+1],dir);tri(soup,b[0],b[i],b[i+1],dir.map(x=>-x));}
    for(let i=0;i<points.length;i++){const j=(i+1)%points.length,mid=points[i].map((x,k)=>(x+points[j][k])/2-center[k]);quad(soup,a[i],b[i],b[j],a[j],mid);}
    const g=soupGeometry(soup);if(role)add(g,role);return g;
  }
  // Revolved surfaces: rings run from front to rear. An inward-return profile
  // makes a real hollow shell rather than covering the intake with a disc.
  function revolution(profile,x=0,y=0,role='hull',segments=n){const p=[],ix=[];for(const [z,r,ry=r,cy=0] of profile)for(let j=0;j<=segments;j++){const a=j/segments*Math.PI*2;p.push([x+Math.cos(a)*r,y+cy+Math.sin(a)*ry,z]);}
    for(let i=0;i<profile.length-1;i++)for(let j=0;j<segments;j++){const a=i*(segments+1)+j,b=a+segments+1;for(const t of [[a,a+1,b],[b,a+1,b+1]])if(triangleNormal(...t.map(k=>p[k])).lengthSq()>1e-13)ix.push(...t);}
    add(geometry(p,ix),role);
  }
  function bodyPoint(theta,z,offset=0){const row=interpolate(BODY,z),[_,rx,top,bottom,cy]=row;const c=Math.cos(theta),s=Math.sin(theta),ry=s>=0?top:bottom;return [c*(rx+offset),cy+s*(ry+offset),z];}
  // The hull has no overlapping cap triangles. Pole fans use only nonzero faces.
  const bp=[],bi=[];for(const row of BODY)for(let j=0;j<=n;j++)bp.push(bodyPoint(j/n*Math.PI*2,row[0]));
  for(let i=0;i<BODY.length-1;i++)for(let j=0;j<n;j++){const a=i*(n+1)+j,b=a+n+1;for(const t of [[a,a+1,b],[b,a+1,b+1]])if(triangleNormal(...t.map(k=>bp[k])).lengthSq()>1e-13)bi.push(...t);}
  add(geometry(bp,bi));

  // Airfoil sections. A fixed wing and its aileron share a true hinge cut;
  // the moving geometry never overlays a complete fixed trailing edge.
  function foilPoint(row,u,upper=true,vertical=false,side=1){const [span,lead,chord,y,thick]=row;
    const h=5*thick*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u*u*u-.1036*u*u*u*u);
    const t=(upper?1:-1)*h+(vertical?0:thick*.075*Math.sin(Math.PI*u));
    return vertical?[t,span,lead+u*chord]:[side*span,y+t,lead+u*chord];
  }
  function hingePoint(row,u,vertical=false,side=1){const a=foilPoint(row,u,true,vertical,side),b=foilPoint(row,u,false,vertical,side);return a.map((x,k)=>(x+b[k])/2);}
  function foil(rows,side,{u0=0,u1=1,vertical=false,role='hull',chordSteps=low?4:12}={}){
    const p=[],ix=[],steps=chordSteps,sample=Array.from({length:steps+1},(_,i)=>u0+(u1-u0)*(1-Math.cos(i/steps*Math.PI))/2),stride=(steps+1)*2;
    for(const row of rows){for(const u of sample)p.push(foilPoint(row,u,true,vertical,side));for(const u of sample.slice().reverse())p.push(foilPoint(row,u,false,vertical,side));}
    for(let i=0;i<rows.length-1;i++)for(let j=0;j<stride;j++){const k=(j+1)%stride,a=i*stride+j,b=i*stride+k,c=(i+1)*stride+j,d=(i+1)*stride+k;for(const t of [[a,b,c],[c,b,d]])if(triangleNormal(...t.map(k=>p[k])).lengthSq()>1e-13)ix.push(...t);}
    // First ring's outward upper-side winding: horizontal right wing points up;
    // fin uses x as thickness, so its outward direction is the opposite parity.
    if((side<0&&!vertical)||vertical)for(let i=0;i<ix.length;i+=3)[ix[i+1],ix[i+2]]=[ix[i+2],ix[i+1]];
    const soup=[];for(const [ri,dir] of [[0,-1],[rows.length-1,1]]){const pts=p.slice(ri*stride,(ri+1)*stride),c=pts.reduce((s,p)=>s.map((x,k)=>x+p[k]/pts.length),[0,0,0]);
      const normal=vertical?[0,dir,0]:[side*dir,0,0];for(let j=0;j<stride;j++)tri(soup,c,pts[j],pts[(j+1)%stride],normal);}
    const g=mergeGeometries([geometry(p,ix),soupGeometry(soup)]);if(role)add(g,role);return g;
  }
  function animate(name,g,A,B,vertical=false){const axis=v(B).sub(v(A)).normalize(),pivot=v(A).add(v(B)).multiplyScalar(.5),basis=new Matrix4();
    if(vertical){const X=new Vector3(1,0,0),Z=new Vector3().crossVectors(X,axis).normalize();basis.makeBasis(X,axis,Z);}
    else{const X=axis.x<0?axis.negate():axis,Y=new Vector3(0,1,0).addScaledVector(X,-X.y).normalize(),Z=new Vector3().crossVectors(X,Y);basis.makeBasis(X,Y,Z);}
    g.applyMatrix4(new Matrix4().makeTranslation(...pivot.toArray()).multiply(basis).invert());
    const frame=new Group(),part=new Group(),mesh=new Mesh(g,mats.hull);frame.name=`${name}-hinge`;frame.position.copy(pivot);frame.quaternion.setFromRotationMatrix(basis);part.name=name;mesh.name=`${name}-skin`;part.add(mesh);frame.add(part);root.add(frame);
  }
  const wingRows=refine(WING,low?1:2),tailRows=refine(TAIL,low?1:3);
  for(const side of [-1,1]){
    const name=side<0?'left':'right';
    // Cut the outer wing into a fixed forward skin and a separate aft surface.
    const inside=wingRows.filter(r=>r[0]<=15.9),moving=wingRows.filter(r=>r[0]>=15.9&&r[0]<=23.8),outside=wingRows.filter(r=>r[0]>=23.8);
    foil(inside,side);foil(moving,side,{u1:.74});foil(outside,side);
    const control=moving.map(r=>{const c=r.slice();c[0]+=r[0]===15.9?EPS:r[0]===23.8?-EPS:0;return c;});
    const A=hingePoint(control[0],.742,false,side),B=hingePoint(control.at(-1),.742,false,side);
    animate(`aileron-${name}`,foil(control,side,{u0:.744,role:null,chordSteps:low?2:6}),A,B);
    foil(tailRows,side,{u1:.69});
    const tailControl=tailRows.map(r=>{const a=r.slice();a[0]+=r===tailRows[0]?EPS:r===tailRows.at(-1)?-EPS:0;return a;});
    animate(`elevator-${name}`,foil(tailControl,side,{u0:.695,role:null,chordSteps:low?2:6}),hingePoint(tailControl[0],.692,false,side),hingePoint(tailControl.at(-1),.692,false,side));
    // Flap tracks are streamlined fairings below the high wing. They give the
    // C-17 its unmistakable heavy-lift wing even in a clean gear-up silhouette.
    for(const x of [5.8,9.8,13.6]){const w=interpolate(WING,x),z=w[1]+w[2]*.81,y=w[3]-.52;
      revolution([[z-2.5,.015,.04],[z-1.8,.20,.32],[z+.2,.24,.39],[z+1.7,.11,.19],[z+2.2,0,0]],side*x,y,'hull',low?6:14);
    }
    // Winglets: a restrained warm recognition stripe across the vertical tip.
    const tip=interpolate(WING,25.65),tip2=interpolate(WING,25.82);
    foil([tip,tip2].map(r=>{const a=r.slice();a[3]+=.018;return a;}),side,{role:'accent',u0:.09,u1:.84,chordSteps:low?3:5});
  }
  // Vertical fin, with the Y-axis hinge aligned to the actual swept rudder.
  const finRows=refine(VFIN,low?1:3).map(([y,lead,chord,thick])=>[y,lead,chord,0,thick]);
  foil(finRows,1,{vertical:true,u1:.72});
  animate('rudder',foil(finRows,1,{vertical:true,u0:.725,role:null,chordSteps:low?2:6}),hingePoint(finRows[0],.722,true),hingePoint(finRows.at(-1),.722,true),true);

  // Underwing nacelles: rounded inlet lip, recessed intake duct, swept fan
  // blades with real depth, spinner, core cone and separate exhaust annulus.
  for(const side of [-1,1])for(const E of ENGINE){const x=E.x*side,y=E.y,z=E.z;
    revolution([[z,1.52],[z+.23,1.68],[z+.78,1.79],[z+2.2,1.81],[z+4.8,1.62],[z+5.7,1.32]],x,y);
    revolution(low?[[z-.025,1.51],[z+.14,1.57],[z+.14,1.41],[z-.025,1.51]]:[[z-.025,1.51],[z+.035,1.56],[z+.14,1.57],[z+.20,1.47],[z+.13,1.41],[z+.025,1.41],[z-.025,1.51]],x,y,'metal');
    revolution([[z+1.13,1.27],[z+.75,1.35],[z+.14,1.41]],x,y,'dark');
    const fanZ=z+1.12,fan=[],blades=low?10:30;
    for(let j=0;j<blades;j++){const a=j/blades*Math.PI*2,ang=[a,a+.045,a+.24,a+.32],radius=[.27,.27,1.27,1.27];const pts=ang.map((aa,k)=>[x+Math.cos(aa)*radius[k],y+Math.sin(aa)*radius[k],fanZ+(k<2?-.02:.13)]);
      quad(fan,...pts,[0,0,-1]);if(!low)quad(fan,...pts.map(p=>[p[0],p[1],p[2]+.036]).reverse(),[0,0,1]);
    }add(soupGeometry(fan),'metal');
    // This backing is deliberately behind the blades, so gaps read as a duct.
    revolution([[fanZ+.25,0],[fanZ+.25,1.29]],x,y,'dark');
    revolution([[fanZ-.66,0],[fanZ-.45,.16],[fanZ-.14,.31],[fanZ+.22,.36]],x,y,'metal',low?8:24);
    revolution([[z+5.65,1.32],[z+6.5,1.06],[z+6.67,.96],[z+6.65,.83],[z+6.10,.80]],x,y,'metal');
    revolution([[z+6.11,.80],[z+5.70,.60]],x,y,'dark');
    revolution([[z+5.65,.62],[z+6.47,.40],[z+7,0]],x,y,'metal',low?8:24);
    const w=interpolate(WING,E.x),wy=w[3]-.28;
    slab([[x,y+1.10,z+.50],[x,wy,z+1.15],[x,wy,z+5.07],[x,y+1.12,z+4.62]],.43,'hull',0);
    // Nacelle inspection seam and an anti-glare pylon leading strip.
    if(!low){revolution([[z+2.03,1.815],[z+2.065,1.815]],x,y,'trim');revolution([[z+4.45,1.671],[z+4.49,1.669]],x,y,'trim');}
  }

  // The characteristic long landing-gear sponsons sit against the lower sides
  // of the body. They remain in flight; deployed wheels are runtime geometry.
  for(const side of [-1,1]){
    revolution([[-10.2,0,0],[-8.6,.53,.49],[-6.5,.83,.86],[-3,.94,1.0],[4.8,.94,1.0],[9.2,.75,.83],[12.0,.40,.51],[13.7,0,0]],side*3.05,-2.26,'hull',low?8:24);
    polyline([[-6,-2.60],[8,-2.60],[9.6,-2.32]].map(([z,y])=>[side*3.96,y,z]),.027,'trim');
    if(!low)for(const z of [-3.6,2.2,7.3])polyline([[side*3.93,-2.58,z],[side*3.95,-2.03,z],[side*3.90,-1.65,z]],.020,'trim');
  }

  // Surface-conforming cockpit glazing and service details. Every patch is
  // sampled at the fuselage ring/station boundaries to follow its real facets.
  function surfacePoint(theta,z,lift=.02){
    const step=Math.PI*2/n,t=(theta%(2*Math.PI)+2*Math.PI)%(2*Math.PI),a=Math.floor(t/step)*step,b=a+step,u=(t-a)/step;
    let j=BODY.findIndex((r,i)=>i<BODY.length-1&&z>=r[0]&&z<=BODY[i+1][0]);j=Math.max(0,j);const z0=BODY[j][0],z1=BODY[j+1][0],w=(z-z0)/(z1-z0);
    const A=bodyPoint(a,z0),B=bodyPoint(b,z0),C=bodyPoint(a,z1),D=bodyPoint(b,z1);
    return A.map((_,k)=>(u+w<=1?A[k]+u*(B[k]-A[k])+w*(C[k]-A[k]):D[k]+(1-u)*(C[k]-D[k])+(1-w)*(B[k]-D[k]))+(k===0?Math.cos(theta)*lift:k===1?Math.sin(theta)*lift:0));
  }
  function patch(theta0,theta1,z0,z1,role='glass',lift=.033){
    const soup=[],cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
    // Clip to each actual hull triangle, then project through that triangle's
    // plane. Bilinear loft interpolation cuts through a coarse LOD's nose.
    for(let j=0;j<BODY.length-1;j++){
      const c=BODY[j][0],d=BODY[j+1][0];if(d<z0||c>z1)continue;
      for(let i=0;i<n;i++){
        const a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2;if(b<theta0||a>theta1)continue;
        for(const T of [[[a,c],[b,c],[a,d]],[[a,d],[b,c],[b,d]]]){
          let poly=[[theta0,z0],[theta1,z0],[theta1,z1],[theta0,z1]];
          for(let e=0;e<3&&poly.length;e++){const P=T[e],Q=T[(e+1)%3],R=T[(e+2)%3],sign=Math.sign(cross(P,Q,R)),out=[];
            for(let k=0;k<poly.length;k++){const p=poly[k],q=poly[(k+1)%poly.length],u=cross(P,Q,p)*sign,vv=cross(P,Q,q)*sign;if(u>=-1e-10)out.push(p);if((u>=0)!==(vv>=0)){const t=u/(u-vv);out.push(p.map((x,k)=>mix(x,q[k],t)));}}poly=out;
          }
          if(poly.length<3)continue;const pts=poly.map(([t,z])=>surfacePoint(t,z,lift));for(let k=1;k<pts.length-1;k++)tri(soup,pts[0],pts[k],pts[k+1],[Math.cos((a+b)/2),Math.sin((a+b)/2),0]);
        }
      }
    }
    add(soupGeometry(soup),role);
  }
  for(const side of [-1,1]){
    const angles=side>0?[[.56,.83],[.875,1.14],[1.19,1.49]]:[[Math.PI-1.49,Math.PI-1.19],[Math.PI-1.14,Math.PI-.875],[Math.PI-.83,Math.PI-.56]];
    for(let j=0;j<angles.length;j++){const [a,b]=angles[j],inner=side>0?j:2-j,z0=inner===2?-24.0:inner===1?-23.65:-22.70,z1=inner===2?-22.65:inner===1?-21.93:-20.87;
      patch(a-.018,b+.018,z0-.06,z1+.06,'trim',.037);patch(a,b,z0,z1,'glass',.051);
    }
    // Flight-deck escape panel and the separate forward personnel door.
    const theta=side>0?.10:Math.PI-.10,da=.34;
    const outline=[[theta-da,-19.3],[theta+da,-19.3],[theta+da,-17.7],[theta-da,-17.7],[theta-da,-19.3]].map(([t,z])=>surfacePoint(t,z,.032));
    polyline(outline,.028);rod(surfacePoint(theta-.10,-18.1,.058),surfacePoint(theta-.10,-17.86,.058),.040,'metal');
    const at=side>0?.32:Math.PI-.32;
    patch(at-.075,at+.075,-18.96,-18.48,'glass',.044);
    // Sparse real transport windows rather than an airliner cabin-window row.
    for(const z of [-13.5,10.8])patch(at-.050,at+.050,z-.18,z+.18,'glass',.042);
  }
  // Radome split, cargo-ramp perimeter and aft clamshell seam.
  const nose=[];for(let j=0;j<=n;j++)nose.push(surfacePoint(j/n*Math.PI*2,-24.8,.025));polyline(nose,.022,'trim');
  const seamSteps=low?4:12;
  for(const theta of [Math.PI*1.19,Math.PI*1.81]){const line=[];for(let j=0;j<=seamSteps;j++)line.push(surfacePoint(theta,mix(11.8,22.6,j/seamSteps),.039));polyline(line,.031,'trim');}
  for(const z of (low?[11.8,22.6]:[11.8,18.4,22.6])){const line=[];for(let j=0;j<=seamSteps;j++)line.push(surfacePoint(mix(Math.PI*1.19,Math.PI*1.81,j/seamSteps),z,.039));polyline(line,.031,'trim');}
  // Recessed vents over the cargo ramp, dorsal aerials, and fin recognition bars.
  for(const side of [-1,1]){
    const theta=side>0?.63:Math.PI-.63;
    for(let j=0;j<(low?3:5);j++)patch(theta-.036,theta+.036,12.4+j*.35,12.55+j*.35,'dark',.043);
    slab([[side*.19,9.63,19.43],[side*.19,9.87,19.60],[side*.19,9.87,22.90],[side*.19,9.63,22.96]],.018,'trim',0);
    slab([[side*.18,9.91,19.66],[side*.18,10.06,19.77],[side*.18,10.06,22.88],[side*.18,9.91,22.90]],.018,'accent',0);
    ball([side*25.79,4.90,4.34],[.073,.09,.14],side<0?'accent':'glass',true);
    ball([side*3.65,-1.94,-6.7],[.12,.14,.10],'glass',true);
  }
  slab([[0,3.49,-12.8],[0,4.36,-11.98],[0,4.43,-11.55],[0,3.47,-11.3]],.09,'hull',0);
  slab([[0,3.42,4.70],[0,4.12,5.37],[0,4.12,5.71],[0,3.44,5.76]],.08,'hull',0);
  ball([0,3.58,-5.5],[.23,.14,.33],'trim',true);
  ball(definition.lights.tail,[.09,.09,.13],'glass',true);

  for(const [role,geometries] of Object.entries(buckets))if(geometries.length){
    // Weld complete position+normal tuples only: shared smooth skin is compact,
    // but crease normals and material boundaries remain exactly as authored.
    const mesh=new Mesh(mergeVertices(mergeGeometries(geometries),1e-6),mats[role]);mesh.name=role;root.add(mesh);
  }
  root.updateMatrixWorld(true);let triangles=0,draws=0,degenerate=0;
  root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry,p=g.attributes.position,ix=g.index;triangles+=(ix?ix.count:p.count)/3;draws++;
    for(let j=0;j<(ix?ix.count:p.count);j+=3){const pts=[0,1,2].map(k=>new Vector3().fromBufferAttribute(p,ix?ix.getX(j+k):j+k));if(pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).lengthSq()<1e-13)degenerate++;}
  });
  const box=new Box3().setFromObject(root,true),size=box.getSize(new Vector3());
  return {root,triangles,draws,degenerate,budget:low?4400:18000,bounds:{min:box.min.toArray(),max:box.max.toArray(),size:size.toArray()}};
}

// A depth-tested oblique geometry projection. The PNG is generated entirely
// from the model and embedded in the SVG. A depth buffer is necessary for a
// high wing, pylons and fuselage: mean-depth SVG face sorting creates spurious
// sawtooth edges where those surfaces intersect. Supersampling also keeps the
// smooth fuselage/cowling normals intact at the fleet rail's tiny dimensions.
export function thumbnail(root){
  const width=960,height=480,az=Math.PI/6,el=34*Math.PI/180,D=new Vector3(-Math.sin(az)*Math.cos(el),-Math.sin(el),Math.cos(az)*Math.cos(el)),X=new Vector3(Math.cos(az),0,Math.sin(az)),Y=new Vector3().crossVectors(X,D),faces=[];
  const view=D.clone().negate(),key=new Vector3(-.45,1,-.7).normalize(),fill=new Vector3(.8,.25,.2).normalize();
  root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry,p=g.attributes.position,n=g.attributes.normal;
    for(let i=0;i<p.count;i+=3){const pts=[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,i+j).applyMatrix4(o.matrixWorld)),face=pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0]));
      if(face.lengthSq()<1e-12||face.normalize().dot(view)<=0)continue;
      const cols=[0,1,2].map(j=>{const normal=new Vector3().fromBufferAttribute(n,i+j).transformDirection(o.matrixWorld),shade=new Color(o.material.color).multiplyScalar(.46+.75*Math.max(0,normal.dot(key))+.17*Math.max(0,normal.dot(fill)));shade.convertLinearToSRGB();return [shade.r*255,shade.g*255,shade.b*255];});
      faces.push({p:pts.map(v=>[v.dot(X),v.dot(Y),v.dot(D)]),cols});
    }
  });
  const pts=faces.flatMap(f=>f.p),xx=pts.map(v=>v[0]),yy=pts.map(v=>v[1]),minX=Math.min(...xx),minY=Math.min(...yy),w=Math.max(...xx)-minX,h=Math.max(...yy)-minY,s=Math.min(width*.925/w,height*.85/h),x=(width-w*s)/2,y=(height-h*s)/2;
  const pixels=Buffer.alloc(width*height*4),depth=new Float64Array(width*height).fill(Infinity);
  for(const {p,cols} of faces){const P=p.map(([a,b,c])=>[(a-minX)*s+x,(b-minY)*s+y,c]),[A,B,C]=P,den=(B[1]-C[1])*(A[0]-C[0])+(C[0]-B[0])*(A[1]-C[1]);if(Math.abs(den)<1e-12)continue;
    const x0=Math.max(0,Math.floor(Math.min(...P.map(p=>p[0])))),x1=Math.min(width-1,Math.ceil(Math.max(...P.map(p=>p[0])))),y0=Math.max(0,Math.floor(Math.min(...P.map(p=>p[1])))),y1=Math.min(height-1,Math.ceil(Math.max(...P.map(p=>p[1]))));
    for(let py=y0;py<=y1;py++)for(let px=x0;px<=x1;px++){
      const u=((B[1]-C[1])*(px+.5-C[0])+(C[0]-B[0])*(py+.5-C[1]))/den,vv=((C[1]-A[1])*(px+.5-C[0])+(A[0]-C[0])*(py+.5-C[1]))/den,t=1-u-vv;
      if(Math.min(u,vv,t)<-1e-8)continue;const z=u*A[2]+vv*B[2]+t*C[2],index=py*width+px;if(z>=depth[index])continue;depth[index]=z;
      for(let k=0;k<3;k++)pixels[index*4+k]=Math.max(0,Math.min(255,Math.round(u*cols[0][k]+vv*cols[1][k]+t*cols[2][k])));pixels[index*4+3]=255;
    }
  }
  const scan=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)pixels.copy(scan,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  const crc=data=>{let c=0xffffffff;for(const byte of data){c^=byte;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const header=Buffer.alloc(8),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);header.write(type,4);tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type),data])));return Buffer.concat([header,data,tail]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan,{level:9})),chunk('IEND',Buffer.alloc(0))]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><title>C-17 Globemaster III</title><image width="240" height="120" href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
}

async function main(){
  globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}};
  const exporter=new GLTFExporter(),rows=[];
  for(const low of [false,true]){const result=build(low),{root,triangles,draws,degenerate,budget,bounds}=result;
    if(triangles>budget||draws>14||degenerate)throw Error(`C-17 ${low?'mobile':'hero'} invalid budget/mesh: ${triangles} triangles, ${draws} draws, ${degenerate} degenerate`);
    if(Math.abs(bounds.size[0]-definition.span)>.02||Math.abs(bounds.size[2]-definition.length)>.02)throw Error(`C-17 dimensions drifted: ${bounds.size}`);
    const url=low?definition.mobileUrl:definition.url,data=await exporter.parseAsync(root,{binary:true});fs.writeFileSync(`public${url}`,Buffer.from(data));
    if(low)fs.writeFileSync(`public${definition.thumbnail}`,thumbnail(root));
    rows.push({id:definition.id,lod:low?'mobile':'hero',url,triangles,draws,bytes:data.byteLength,degenerate,bounds});
  }
  fs.writeFileSync('public/models/c17-metrics.json',JSON.stringify({definition,gear:{nose:[0,-3.15,-18.6],main:[[-3.17,-3.06,3.1],[3.17,-3.06,3.1]],wheelRadius:.68,wheelY:-4.95},rows},null,2)+'\n');console.log(JSON.stringify(rows,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
