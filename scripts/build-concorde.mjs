/**
 * Concorde — original Skyloom geometry, authored in metres, +Y up, nose -Z.
 * Rebuild: node scripts/build-concorde.mjs
 * No downloaded meshes, textures, or airline marks. Source dimensions:
 * https://airandspace.si.edu/collection-objects/concorde-fox-alpha-air-france/nasm_A20030139000
 * Smithsonian: length 61.66 m, span 25.56 m. The flying model excludes gear;
 * FlyMode owns the retractable gear. The four independent delta-wing elevons
 * and fin rudder use true hinge frames, so animation rotates around the hinge.
 */
import fs from 'node:fs';
import {finishAircraft} from './aircraft-surface.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Box3, BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export const definition = {
  id:'concorde', slug:'concorde', length:61.66, span:25.56, type:'supersonic', custom:true,
  colors:{hull:'#e5e6de',trim:'#203e50',accent:'#bc8757'},
  url:'/models/player-concorde-hero-v3.glb', mobileUrl:'/models/player-concorde-mobile-v3.glb', thumbnail:'/models/player-concorde-v3.svg',
  yawFixRad:0, forceVertexColors:false, canopyMaterial:'glass',
  parts:{ailerons:['aileron-left','aileron-right'],elevators:['elevator-left','elevator-right'],rudder:'rudder',propeller:null},
  liverySlots:['hull','trim','accent'], engines:[-5.75,-3.65,3.65,5.75].map(x=>[x,-1.76,21.15]),
  lights:{tail:[0,7.94,28.58],landing:[[-.57,-.99,-21.7],[.57,-.99,-21.7]]},
  gearMounts:{nose:[0,-1.06,-18.9],main:[[-2.48,-1.12,7.9],[2.48,-1.12,7.9]]},
  author:'Skyloom',license:'MIT',revision:3,
};
const HALF=definition.span/2, L=definition.length, clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),lerp=(a,b,t)=>a+(b-a)*t;
const V=p=>new Vector3(...p);

// Monotone cubic interpolation preserves the cylindrical cabin while giving
// the nose and tail smooth tangents rather than a stack of cone frustums.
function curve(rows,x,col=1){
  let i=rows.findIndex((r,k)=>k<rows.length-1&&x>=r[0]&&x<=rows[k+1][0]);
  if(i<0)return x<rows[0][0]?rows[0][col]:rows.at(-1)[col];
  const a=rows[i],b=rows[i+1],h=b[0]-a[0],t=(x-a[0])/h,d=(b[col]-a[col])/h;
  function slope(k){
    if(k===0)return (rows[1][col]-rows[0][col])/(rows[1][0]-rows[0][0]);
    if(k===rows.length-1)return (rows[k][col]-rows[k-1][col])/(rows[k][0]-rows[k-1][0]);
    const d0=(rows[k][col]-rows[k-1][col])/(rows[k][0]-rows[k-1][0]),d1=(rows[k+1][col]-rows[k][col])/(rows[k+1][0]-rows[k][0]);
    return d0*d1<=0?0:2*d0*d1/(d0+d1);
  }
  const m0=d===0?0:slope(i),m1=d===0?0:slope(i+1);
  return (2*t*t*t-3*t*t+1)*a[col]+(t*t*t-2*t*t+t)*h*m0+(-2*t*t*t+3*t*t)*b[col]+(t*t*t-t*t)*h*m1;
}
const BODY=[[-30.83,0,0,-.37],[-29.8,.15,.16,-.31],[-27.3,.40,.39,-.19],[-25,.69,.65,-.08],[-22.6,1.01,.99,.02],[-20.3,1.27,1.35,.05],[-17.4,1.43,1.54,.02],[-13,1.44,1.57,0],[8.8,1.44,1.57,0],[14,1.36,1.47,.03],[19,1.17,1.21,.11],[23.5,.79,.87,.28],[27,.40,.50,.40],[29.5,.14,.20,.46],[30.83,0,0,.48]];
const LE=[[0,-14.2],[1.5,-12.8],[2.4,-8.1],[3.5,-2.3],[5,2.7],[7,6.3],[9,10.1],[11,14.6],[HALF,18.65]];
const leading=x=>curve(LE,Math.abs(x));
const trailing=x=>24.0-.185*Math.abs(x);
const hinge=x=>trailing(x)-1.65;
const wingY=x=>-.70+.085*(Math.abs(x)/HALF)**2;
const wingThickness=x=>.72*(1-(Math.abs(x)/HALF)**1.15)+.055;
const section=u=>u<=0||u>=1?0:(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u*u*u-.1036*u*u*u*u)/.1;
function wingPoint(x,z,upper=true){const u=clamp((z-leading(x))/(trailing(x)-leading(x)),0,1),t=wingThickness(x)*section(u)*.5;return [x,wingY(x)+Math.sin(u*Math.PI)*.075+(upper?t:-t),z];}

function geom(positions,index){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setIndex(index);g.computeVertexNormals();return g;}
function triangle(out,a,b,c,dir){const n=V(b).sub(V(a)).cross(V(c).sub(V(a)));if(n.lengthSq()<1e-14)return;if(dir&&n.dot(V(dir))<0)[b,c]=[c,b];out.push(...a,...b,...c);}
function soup(out,crease=.55){if(!out.length)return null;const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(out,3));return mergeVertices(toCreasedNormals(g,crease),1e-5);}
function quad(out,a,b,c,d,dir){triangle(out,a,b,c,dir);triangle(out,a,c,d,dir);}
function meshRole(geometry,material,name){const mesh=new Mesh(geometry,material);mesh.name=name;return mesh;}

// Articulated meshes are made in world coordinates then moved into their
// actual swept hinge frames; the animator sees zero local rotation at rest.
function articulated(name,g,a,b,axis,material){
  let X,Y,Z;
  if(axis==='x'){X=V(b).sub(V(a)).normalize();if(X.x<0)X.negate();Y=new Vector3(0,1,0).addScaledVector(X,-X.y).normalize();Z=X.clone().cross(Y);}
  else{Y=V(b).sub(V(a)).normalize();X=new Vector3(1,0,0);Z=X.clone().cross(Y).normalize();}
  const basis=new Matrix4().makeBasis(X,Y,Z),pivot=V(a).add(V(b)).multiplyScalar(.5),frame=new Group(),part=new Group();
  g.applyMatrix4(new Matrix4().makeTranslation(...pivot.toArray()).multiply(basis).invert());
  frame.name=`${name}-hinge`;frame.position.copy(pivot);frame.quaternion.setFromRotationMatrix(basis);part.name=name;part.add(meshRole(g,material,`${name}-skin`));frame.add(part);return frame;
}

export function build(low=false){
  const root=new Group();root.name='Skyloom Concorde';root.userData={author:'Skyloom',license:'MIT',revision:3,lod:low?'mobile':'hero',units:'metres',nose:'-Z'};
  const palette={...definition.colors,glass:'#203b48',metal:'#748188',dark:'#101a20',cabin:'#183341'};
  const mats=Object.fromEntries(Object.entries(palette).map(([name,color])=>[name,new MeshStandardMaterial({name,color,roughness:name==='glass'?.14:name==='metal'?.29:name==='cabin'?.78:.39,metalness:name==='cabin'?0:name==='metal'?.68:name==='glass'?.28:.15})]));
  const buckets=Object.fromEntries(Object.keys(mats).map(k=>[k,[]]));
  const add=(g,role='hull')=>{if(g)buckets[role].push(g);};
  const n=low?14:32,zs=[...new Set([...BODY.map(r=>r[0]),...Array.from({length:low?26:76},(_,i)=>-L/2+L*i/(low?25:75))])].sort((a,b)=>a-b);
  const bodyPoint=(theta,z,lift=0)=>[(curve(BODY,z,1)+lift)*Math.cos(theta),curve(BODY,z,3)+(curve(BODY,z,2)+lift)*Math.sin(theta),z];
  // Lofted fuselage with a sealed needle nose and tail cone.
  {const p=[],ix=[];for(const z of zs)for(let j=0;j<=n;j++)p.push(...bodyPoint(j/n*Math.PI*2,z));
    for(let i=0;i<zs.length-1;i++)for(let j=0;j<n;j++){const a=i*(n+1)+j,b=a+n+1;if(i!==0)ix.push(a,a+1,b);if(i!==zs.length-2)ix.push(b,a+1,b+1);}add(geom(p,ix));}

  // Decals follow the body's actual polygonal ring interpolation, preventing
  // a coarse mobile hull from cutting through a cockpit pane or cabin window.
  function surface(theta,z,lift=.025){
    theta=(theta%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
    const q=theta/(Math.PI*2)*n,j=Math.min(n-1,Math.floor(q)),u=q-j;
    let k=zs.findIndex((s,i)=>i<zs.length-1&&z>=s&&z<=zs[i+1]);k=clamp(k,0,zs.length-2);const t=clamp((z-zs[k])/(zs[k+1]-zs[k]),0,1);
    const A=V(bodyPoint(j/n*Math.PI*2,zs[k])),B=V(bodyPoint((j+1)/n*Math.PI*2,zs[k])),C=V(bodyPoint(j/n*Math.PI*2,zs[k+1])),D=V(bodyPoint((j+1)/n*Math.PI*2,zs[k+1]));
    const p=u+t<=1?A.clone().addScaledVector(B.clone().sub(A),u).addScaledVector(C.clone().sub(A),t):D.clone().addScaledVector(C.clone().sub(D),1-u).addScaledVector(B.clone().sub(D),1-t);
    p.x+=Math.cos(theta)*lift;p.y+=Math.sin(theta)*lift;return p.toArray();
  }
  function bodyPatch(side,theta,z,halfTheta,halfZ,role,lift=.03,rounded=true){
    const o=[],base=side>0?theta:Math.PI-theta,sgn=side>0?1:-1;
    const coords=rounded&&low?[[-.7,-1],[.7,-1],[1,0],[.7,1],[-.7,1],[-1,0]]:rounded?[[0,-1],[.70,-.91],[1,-.60],[1,.60],[.70,.91],[0,1],[-.7,.91],[-1,.6],[-1,-.6],[-.7,-.91]]:[[-1,-1],[1,-1],[1,1],[-1,1]];
    const c=surface(base,z,lift),rings=halfTheta>.4?(low?2:3):1,dir=[side,Math.sin(theta),0];let previous=null;
    for(let ring=1;ring<=rings;ring++){
      const rim=coords.map(([a,b])=>surface(base+sgn*a*halfTheta*ring/rings,z+b*halfZ*ring/rings,lift));
      for(let j=0;j<rim.length;j++){const k=(j+1)%rim.length;if(previous)quad(o,previous[j],rim[j],rim[k],previous[k],dir);else triangle(o,c,rim[j],rim[k],dir);}previous=rim;
    }add(soup(o,.9),role);
  }
  function bodyRibbon(side,theta0,theta1,z0,z1,role,lift=.025){
    const o=[],steps=low?20:55;for(let i=0;i<steps;i++){const za=lerp(z0,z1,i/steps),zb=lerp(z0,z1,(i+1)/steps),a=side>0?theta0:Math.PI-theta0,b=side>0?theta1:Math.PI-theta1;quad(o,surface(a,za,lift),surface(b,za,lift),surface(b,zb,lift),surface(a,zb,lift),[side,0,0]);}add(soup(o,.7),role);
  }
  for(const side of [-1,1]){
    // Two angled flight-deck panes and raised visor glazing on the beak.
    bodyPatch(side,.51,-22.5,.245,.80,'trim',.038,false);
    bodyPatch(side,.51,-22.51,.195,.71,'glass',.057,false);
    bodyPatch(side,.65,-20.87,.18,.62,'trim',.037,false);
    bodyPatch(side,.65,-20.87,.14,.55,'glass',.056,false);
    bodyPatch(side,.91,-24.17,.26,.72,'glass',.029,false);
    bodyRibbon(side,.018,.086,-18.0,20.6,'trim');
    bodyRibbon(side,-.003,.016,-18.0,20.6,'accent',.030);
    // Concorde's small pressure windows, at a regular 0.79 m cabin pitch.
    for(let j=0;j<43;j++){const z=-15.82+j*.79;if(!low)bodyPatch(side,.37,z,.105,.153,'trim',.026);bodyPatch(side,.37,z,.078,.122,'cabin',.043);}
    // Door outlines occupy real gaps in the window train.
    for(const z of [-17.2,18.7]){bodyPatch(side,.15,z,.567,.357,'trim',.028);bodyPatch(side,.15,z,.547,.337,'hull',.046);bodyPatch(side,.52,z,.09,.11,'cabin',.059);}
    // A fine nose separation line and rear pressure bulkhead joint.
    for(const z of [-25.2,22.8])bodyPatch(side,.23,z,.97,.011,'metal',.018,false);
  }

  function wingPanel(side,x0,x1,back,front='lead',stepsX=6,stepsU=10){
    const p=[],ix=[],rows=[];
    for(let i=0;i<=stepsX;i++){
      const x=side*lerp(x0,x1,i/stepsX),a=front==='lead'?leading(x):hinge(x)+.04,b=back==='tail'?trailing(x):hinge(x)-.04;
      const row=[];for(const upper of [true,false])for(let j=0;j<=stepsU;j++){const u=(1-Math.cos(j/stepsU*Math.PI))/2,P=wingPoint(x,lerp(a,b,u),upper);row.push(P);p.push(...P);}rows.push(row);
    }
    const stride=2*(stepsU+1),s=stepsU+1;
    function tri(a,b,c,up){const A=V(p.slice(a*3,a*3+3)),B=V(p.slice(b*3,b*3+3)),C=V(p.slice(c*3,c*3+3));if(B.sub(A).cross(C.sub(A)).y*up<0)[b,c]=[c,b];ix.push(a,b,c);}
    for(let i=0;i<stepsX;i++)for(let j=0;j<stepsU;j++)for(let layer=0;layer<2;layer++){const a=i*stride+layer*s+j,b=a+1,c=a+stride,d=c+1;tri(a,b,c,layer?-1:1);tri(c,b,d,layer?-1:1);}
    const caps=[];for(let i=0;i<stepsX;i++){const A=rows[i],B=rows[i+1];quad(caps,A[0],A[s],B[s],B[0],[0,0,-1]);quad(caps,A[stepsU],B[stepsU],B[stride-1],A[stride-1],[0,0,1]);}
    for(const [i,dir] of [[0,-side],[stepsX,side]]){const R=rows[i];for(let j=0;j<stepsU;j++)quad(caps,R[j],R[j+1],R[s+j+1],R[s+j],[dir,0,0]);}
    const pieces=[geom(p,ix),soup(caps)];return mergeGeometries(pieces.filter(Boolean));
  }
  for(const side of [-1,1]){
    add(wingPanel(side,0,2.2,'tail','lead',low?3:8,low?5:13));
    add(wingPanel(side,2.2,12.2,'hinge','lead',low?8:28,low?5:13));
    add(wingPanel(side,12.2,HALF,'tail','lead',2,low?4:10));
    for(const [name,a,b] of [['elevator',2.25,6.92],['aileron',7.05,12.15]]){
      const g=wingPanel(side,a,b,'tail','hinge',low?3:6,low?3:5),A=wingPoint(side*a,hinge(a)),B=wingPoint(side*b,hinge(b));
      A[1]=wingY(a);B[1]=wingY(b);root.add(articulated(`${name}-${side<0?'left':'right'}`,g,A,B,'x',mats.hull));
    }
    // Fine spanwise panel joints, and two copper tip recognition strokes.
    const o=[],ac=[];
    for(const x of (low?[7.0]:[3.35,7.0,9.7])){const zz=leading(x)+.8,zt=hinge(x)-.16,steps=low?3:12;
      for(let i=0;i<steps;i++){const a=lerp(zz,zt,i/steps),b=lerp(zz,zt,(i+1)/steps),P=[wingPoint(side*(x-.012),a),wingPoint(side*(x+.012),a),wingPoint(side*(x+.012),b),wingPoint(side*(x-.012),b)].map(v=>[v[0],v[1]+.026,v[2]]);quad(o,...P,[0,1,0]);}}
    for(const x of [11.68,11.86]){const a=leading(x)+.65,b=hinge(x)-.30,P=[wingPoint(side*(x-.045),a),wingPoint(side*(x+.045),a),wingPoint(side*(x+.045),b),wingPoint(side*(x-.045),b)].map(v=>[v[0],v[1]+.017,v[2]]);quad(ac,...P,[0,1,0]);}add(soup(o),'metal');add(soup(ac),'accent');
  }

  // Tall swept single fin, an airfoil instead of an extruded flat polygon.
  const FIN=[[.55,12.6,29.6,.46],[2.0,16.0,29.6,.38],[4.5,19.4,29.25,.26],[7.8,24.2,28.9,.11],[8.14,24.78,28.73,.075]];
  const finPoint=(y,u,side)=>{const le=curve(FIN,y,1),te=curve(FIN,y,2),t=curve(FIN,y,3),z=lerp(le,te,u);return [side*t*section(u)*.5,y,z];};
  const finHinge=y=>lerp(25.79,27.8452,(y-.55)/(8.14-.55));
  function finPanel(moving=false){
    const o=[],ny=low?7:18,nu=low?4:12,start=moving?.78:0,end=moving?1:.772;
    const point=(y,u,side)=>{const le=curve(FIN,y,1),te=curve(FIN,y,2),h=(finHinge(y)-le)/(te-le),gap=.035/(te-le),t=(u-start)/(end-start);return finPoint(y,moving?lerp(h+gap,1,t):lerp(0,h-gap,t),side);};
    for(const side of [-1,1])for(let i=0;i<ny;i++)for(let j=0;j<nu;j++){const ya=lerp(.55,8.14,i/ny),yb=lerp(.55,8.14,(i+1)/ny),ua=lerp(start,end,j/nu),ub=lerp(start,end,(j+1)/nu);quad(o,point(ya,ua,side),point(ya,ub,side),point(yb,ub,side),point(yb,ua,side),[side,0,0]);}
    for(let i=0;i<ny;i++){const ya=lerp(.55,8.14,i/ny),yb=lerp(.55,8.14,(i+1)/ny);for(const [u,dir] of [[start,[0,0,-1]],[end,[0,0,1]]])quad(o,point(ya,u,-1),point(ya,u,1),point(yb,u,1),point(yb,u,-1),dir);}
    for(const [y,dir] of [[.55,[0,-1,0]],[8.14,[0,1,0]]])for(let j=0;j<nu;j++){const ua=lerp(start,end,j/nu),ub=lerp(start,end,(j+1)/nu);quad(o,point(y,ua,-1),point(y,ub,-1),point(y,ub,1),point(y,ua,1),dir);}return soup(o,.8);
  }
  add(finPanel(),'trim');
  root.add(articulated('rudder',finPanel(true),[0,.55,finHinge(.55)],[0,8.14,finHinge(8.14)],'y',mats.trim));
  for(const side of [-1,1]){const o=[];
    for(let i=0;i<18;i++){const ya=lerp(1.5,7.8,i/18),yb=lerp(1.5,7.8,(i+1)/18),a=.12,b=.155,pts=[finPoint(ya,a,side),finPoint(ya,b,side),finPoint(yb,b,side),finPoint(yb,a,side)].map(p=>[p[0]+side*.014,p[1],p[2]]);quad(o,...pts,[side,0,0]);}add(soup(o),'accent');
    // Original Skyloom lozenge, no airline branding.
    const badge=[],cx=side*.15,cy=5.6,cz=25.2;quad(badge,[cx,cy-.43,cz],[cx,cy,cz-.70],[cx,cy+.43,cz],[cx,cy,cz+.70],[side,0,0]);add(soup(badge),'hull');
  }

  // Two paired intake boxes with four deeply recessed rectangular throats.
  // Each pack has its own central splitter. Rings are open-ended: the dark
  // interior and recessed ramps are actual geometry, not black front discs.
  function boxRing(cx,z,w,h,cy,bevel=.1){return [[-w/2+bevel,-h/2],[-w/2,-h/2+bevel],[-w/2,h/2-bevel],[-w/2+bevel,h/2],[w/2-bevel,h/2],[w/2,h/2-bevel],[w/2,-h/2+bevel],[w/2-bevel,-h/2]].map(([x,y])=>[cx+x,cy+y,z]);}
  function connectRings(rings,role,inward=false){const o=[];for(let i=0;i<rings.length-1;i++)for(let j=0;j<rings[i].length;j++){const k=(j+1)%rings[i].length,A=rings[i][j],B=rings[i][k],C=rings[i+1][k],D=rings[i+1][j],cx=rings[i].reduce((s,p)=>s+p[0],0)/rings[i].length,cy=rings[i].reduce((s,p)=>s+p[1],0)/rings[i].length;quad(o,A,B,C,D,[(A[0]+B[0])/2-cx,(A[1]+B[1])/2-cy,0].map(v=>v*(inward?-1:1)));}add(soup(o,.5),role);}
  for(const side of [-1,1]){
    const cx=side*4.7;
    const rings=[[1.85,4.24,1.90,-1.54],[3.2,4.28,1.94,-1.53],[8.2,4.22,1.87,-1.59],[15.8,4.08,1.76,-1.70],[19.15,3.97,1.62,-1.76]].map(([z,w,h,y])=>boxRing(cx,z,w,h,y,.12));connectRings(rings,'hull');
    // Thin metallic lip over the cream nacelle and rectangular throat tunnels.
    for(const x of [side*3.65,side*5.75]){
      const outside=boxRing(x,1.83,2.04,1.90,-1.54,.09),inside=boxRing(x,1.83,1.78,1.64,-1.54,.07),back=boxRing(x,5.0,1.65,1.25,-1.53,.05),lip=[];
      for(let j=0;j<8;j++)quad(lip,outside[j],outside[(j+1)%8],inside[(j+1)%8],inside[j],[0,0,-1]);add(soup(lip),'metal');connectRings([inside,back],'dark',true);
      const ramp=[];quad(ramp,[x-.82,-.82,2.28],[x+.82,-.82,2.28],[x+.80,-1.30,4.20],[x-.80,-1.30,4.20],[0,-1,-1]);add(soup(ramp),'metal');
      const stop=[];for(let j=1;j<back.length-1;j++)triangle(stop,back[0],back[j],back[j+1],[0,0,-1]);add(soup(stop),'dark');
      // Variable exhaust petals taper toward a visible annular nozzle. Copper
      // on the recessed throat catches a small warm reflection, never emissive.
      const segments=low?12:24,nozzle=[],inner=[],end=[],hub=[];
      const point=(a,z,r)=>[x+Math.cos(a)*r,-1.76+Math.sin(a)*r*.89,z];
      for(let j=0;j<segments;j++){
        const a=j/segments*Math.PI*2,b=(j+1)/segments*Math.PI*2,r=j%2?.805:.84;
        quad(nozzle,point(a,18.65,.88),point(b,18.65,.88),point(b,20.96,r),point(a,20.96,r),[Math.cos((a+b)/2),Math.sin((a+b)/2),0]);
        quad(end,point(a,20.96,r),point(b,20.96,r),point(b,21.15,.70),point(a,21.15,.70),[0,0,1]);
        quad(inner,point(a,21.15,.70),point(b,21.15,.70),point(b,19.56,.53),point(a,19.56,.53),[-Math.cos((a+b)/2),-Math.sin((a+b)/2),0]);
        triangle(hub,[x,-1.76,19.54],point(a,19.55,.53),point(b,19.55,.53),[0,0,1]);
      }add(soup(nozzle,.18),'metal');add(soup(inner,.3),'dark');add(soup(end,.25),'metal');add(soup(hub),'dark');
      if(!low){const petals=[];for(let j=0;j<12;j++){const a=j/12*Math.PI*2,d=.009;quad(petals,point(a-d,18.75,.891),point(a+d,18.75,.891),point(a+d,20.78,.83),point(a-d,20.78,.83),[Math.cos(a),Math.sin(a),0]);}add(soup(petals),'dark');}
    }
    // Paired intake splitter and narrow service panels on each pack.
    const splitter=[];quad(splitter,[cx-.065,-2.49,1.83],[cx+.065,-2.49,1.83],[cx+.065,-.59,1.83],[cx-.065,-.59,1.83],[0,0,-1]);add(soup(splitter),'hull');
    const seam=[];for(const z of [5.6,12.5,17.3])quad(seam,[cx-1.9,-2.48,z-.018],[cx+1.9,-2.48,z-.018],[cx+1.9,-2.48,z+.018],[cx-1.9,-2.48,z+.018],[0,-1,0]);add(soup(seam),'metal');
  }

  for(const [role,list] of Object.entries(buckets))if(list.length){const clean=list.map(g=>{g.deleteAttribute('uv');return g.index?g.toNonIndexed():g;});addMesh(role,mergeVertices(mergeGeometries(clean),1e-5));}
  function addMesh(role,g){root.add(meshRole(g,mats[role],role));}
  finishAircraft(root,{military:false});
  root.updateMatrixWorld(true);let triangles=0,draws=0;root.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;draws++;}});
  return {root,triangles,draws,budget:low?4800:18000};
}

// A deterministic software depth buffer makes intersecting body/wing facets
// occlude correctly. Three samples per output pixel give clean small edges;
// embedding the resulting PNG avoids thousands of SVG paths in the hangar.
function png(width,height,pixels){
  const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(name,data)=>{const t=Buffer.from(name),n=Buffer.alloc(4),sum=Buffer.alloc(4);n.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const scan=Buffer.alloc(height*(1+width*4));for(let y=0;y<height;y++)pixels.copy(scan,y*(1+width*4)+1,y*width*4,(y+1)*width*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
// Same oblique camera and understated palette as the existing hangar.
export function thumbnail(root){
  const az=Math.PI/6,el=46*Math.PI/180,D=new Vector3(-Math.sin(az)*Math.cos(el),-Math.sin(el),Math.cos(az)*Math.cos(el)),X=new Vector3(Math.cos(az),0,Math.sin(az)),Y=new Vector3().crossVectors(X,D),view=D.clone().negate(),key=new Vector3(.25,1,-.35).normalize(),faces=[];
  root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry,p=g.attributes.position;
    for(let i=0;i<p.count;i+=3){const v=[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,i+j).applyMatrix4(o.matrixWorld)),n=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));if(n.lengthSq()<1e-12||n.normalize().dot(view)<=0)continue;
      const color=new Color(o.material.color).multiplyScalar(.55+.64*Math.max(0,n.dot(key)));faces.push({p:v.map(q=>[q.dot(X),q.dot(Y),q.dot(D)]),color:color.getHex()});}});
  const pts=faces.flatMap(f=>f.p),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY,s=Math.min(220/w,98/h),ox=(240-w*s)/2,oy=(120-h*s)/2;
  const W=1440,H=720,AA=3,S=6,depth=new Float32Array(W*H).fill(Infinity),rgba=new Uint8Array(W*H*4);
  for(const f of faces){const v=f.p.map(p=>[((p[0]-minX)*s+ox)*S,((p[1]-minY)*s+oy)*S,p[2]]),[a,b,c]=v,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)continue;
    const x0=clamp(Math.floor(Math.min(...v.map(p=>p[0]))),0,W-1),x1=clamp(Math.ceil(Math.max(...v.map(p=>p[0]))),0,W-1),y0=clamp(Math.floor(Math.min(...v.map(p=>p[1]))),0,H-1),y1=clamp(Math.ceil(Math.max(...v.map(p=>p[1]))),0,H-1);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const u=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/den,vv=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/den,t=1-u-vv;if(u<0||vv<0||t<0)continue;const z=u*a[2]+vv*b[2]+t*c[2],k=y*W+x;if(z>=depth[k])continue;depth[k]=z;rgba[k*4]=f.color>>>16;rgba[k*4+1]=(f.color>>>8)&255;rgba[k*4+2]=f.color&255;rgba[k*4+3]=255;}
  }
  const width=W/AA,height=H/AA,pixels=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sum=[0,0,0,0];let covered=0;for(let dy=0;dy<AA;dy++)for(let dx=0;dx<AA;dx++){const k=((y*AA+dy)*W+x*AA+dx)*4;if(!rgba[k+3])continue;covered++;for(let j=0;j<3;j++)sum[j]+=rgba[k+j];}const k=(y*width+x)*4;if(covered){for(let j=0;j<3;j++)pixels[k+j]=Math.round(sum[j]/covered);pixels[k+3]=Math.round(covered/(AA*AA)*255);}}
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><title>Skyloom Concorde</title><image width="240" height="120" href="data:image/png;base64,${png(width,height,pixels).toString('base64')}"/></svg>`;
}

async function main(){
  globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}};
  const exporter=new GLTFExporter(),rows=[];
  for(const low of [false,true]){const {root,triangles,draws,budget}=build(low),bounds=new Box3().setFromObject(root,true),size=bounds.getSize(new Vector3());
    if(triangles>budget||draws>14)throw Error(`Concorde ${low?'mobile':'hero'}: ${triangles}/${budget} tris, ${draws}/14 draws`);
    if(Math.abs(size.z-L)>.005||Math.abs(size.x-definition.span)>.005)throw Error(`Concorde bounds ${size.toArray()} do not match declared length/span`);
    const url=low?definition.mobileUrl:definition.url,data=await exporter.parseAsync(root,{binary:true});fs.writeFileSync(`public${url}`,Buffer.from(data));if(low)fs.writeFileSync(`public${definition.thumbnail}`,thumbnail(root));
    rows.push({id:definition.id,lod:low?'mobile':'hero',url,triangles,draws,bytes:data.byteLength,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:size.toArray()}});
  }
  fs.writeFileSync('public/models/concorde-metrics.json',JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(rows,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
