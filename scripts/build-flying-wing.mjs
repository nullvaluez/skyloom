/**
 * Umbra — Skyloom's own stealth flying wing (hangar id 'flying-wing').
 * Original first-party geometry: no third-party meshes, textures or downloads.
 *
 *   node scripts/build-flying-wing.mjs
 *
 * Writes public/models/player-umbra-{hero,mobile}-v1.glb and the hangar glyph
 * public/models/player-umbra-v1.svg, then replaces only the 'flying-wing' rows
 * of public/models/adventure-fleet-v1.json (every other row is rewritten
 * byte-identical). build-adventure-fleet.mjs skips this `custom` airframe, so
 * rebuilding either script never regenerates the other's files.
 *
 * Metres, +Y up, nose toward -Z; the bounding box is exactly the declared
 * length and span. The planform maths below uses x (span, + right) and p
 * (metres aft of the nose apex); model z = p - length/2.
 *
 * Construction: one lofted skin across the whole span (no centreline seam),
 * sampled on spanwise stations with chordwise samples that land exactly on
 * every feature line (intake lip, exhaust slot, elevon hinge), so the double-W
 * trailing edge, the serrated intakes and the exhaust slots are real geometry
 * with crisp creases, while the skin itself keeps smooth area-weighted
 * normals. The four elevons are separate hinge-aligned groups (see elevon()).
 */
import fs from 'node:fs';
import {Box3,BufferGeometry,Color,Float32BufferAttribute,Group,Matrix4,Mesh,MeshStandardMaterial,Vector3} from 'three';
import {mergeGeometries,mergeVertices,toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {FLEET_PRESENTATION} from '../lib/fly/fleet-aircraft.mjs';
globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}};

const DEF=FLEET_PRESENTATION['flying-wing'];
if(!DEF)throw Error('lib/fly/fleet-aircraft.mjs has no flying-wing entry');
const L=DEF.length,HALF=DEF.span/2,Z0=L/2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};

// ---------------------------------------------------------------------------
// Planform. Every edge is parallel to one of the two 33° leading edges: the
// trailing edge runs centre tail -> notch -> outboard tooth -> cropped tip on
// each side (the double W). The teeth sit a little ahead of the centre tail.
// ---------------------------------------------------------------------------
const S=Math.tan(33*Math.PI/180);
const TOOTH=L-.45,TIP_CHORD=1.45;
const XA=(TIP_CHORD+2*S*HALF-TOOTH)/S;          // outboard tooth (span station)
const XB=(XA+(L-TOOTH)/S)/2,PB=L-S*XB;           // trailing-edge notch
const pLE=x=>S*Math.abs(x);
const pTE=x=>{const a=Math.abs(x);return a<=XB?L-S*a:a<=XA?PB+S*(a-XB):TOOTH-S*(a-XA);};
const chord=x=>pTE(x)-pLE(x);

// Thickness: a deep blended centre body (13 % of the root chord) over a thin,
// gently tapering outer wing (about 6 % at the tip). Metres, not ratios, so
// the zig-zag trailing edge never pinches the spanwise thickness line.
const thick=x=>{const a=Math.abs(x),outer=a<9?.46:.46-.37*((a-9)/(HALF-9))**1.6;return outer+1.89*Math.exp(-((a/5.6)**2.2));};
const yRef=x=>-.5*Math.exp(-((x/6)**2));                  // leading/trailing edge height: a low beak
const upShare=x=>.6+.08*Math.exp(-((x/5)**2));            // domed top, flatter belly
// Chordwise thickness law u^a (1-u)^b, peak 1 at u = a/(a+b). a > 1/2 gives the
// sharper stealth leading edge (sharpest at the centre beak); b > 1 a fine TE.
const leSharp=x=>.72-.1*smooth(2,9,Math.abs(x));
const section01=(u,a)=>{if(u<=0||u>=1)return 0;const b=1.25,m=a/(a+b);return (u/m)**a*((1-u)/(1-m))**b;};

const COCKPIT={w:1.8,h:.58,rise:[2.3,4.5],fall:[5.4,11]};
const cockpit=(x,p)=>{const r=x/COCKPIT.w;return Math.abs(r)>=1?0:COCKPIT.h*(1-r*r)**2*smooth(...COCKPIT.rise,p)*(1-smooth(...COCKPIT.fall,p));};

// Buried engines: one long hump per side. A recessed throat with a straight front
// edge drops into the mouth under a serrated lip; at the back a flat exhaust slot
// spills onto a heat-resistant deck ahead of the trailing edge.
const ENGINE={x:5.1,w:2,h:.5,lip:5.5,serration:.4,half:1.6,throat:.75,dip:.18,exhaust:1.6,gLip:.8,gEx:.55};
const engineBx=x=>{const r=(Math.abs(x)-ENGINE.x)/ENGINE.w;return Math.abs(r)>=1?0:(1-r**4)**2;};
const throatBx=x=>1-smooth(ENGINE.half-.15,ENGINE.half+.25,Math.abs(Math.abs(x)-ENGINE.x));
const onDeck=x=>Math.abs(Math.abs(x)-ENGINE.x)<=ENGINE.w+1e-6;
// Forward-pointing teeth across the intake; outside it the lip holds the notch line.
const serration=(x,teeth)=>{const t=(Math.abs(x)-(ENGINE.x-ENGINE.half))/(2*ENGINE.half);if(t<=0||t>=1)return ENGINE.serration;const f=(t*teeth)%1;return ENGINE.serration*Math.abs(2*f-1);};
// The throat/lip/exhaust/hinge lines exist across the whole span (as plain skin
// outside the engines) so every station carries the same chordwise layout.
const engineZone=x=>1-smooth(ENGINE.w,ENGINE.w+1,Math.abs(Math.abs(x)-ENGINE.x));
const pLip=(x,teeth)=>lerp(pLE(x)+.3*chord(x),ENGINE.lip+serration(x,teeth),engineZone(x));
const pThroat=(x,teeth)=>lerp(pLip(x,teeth)-Math.min(ENGINE.throat,.15*chord(x)),ENGINE.lip-ENGINE.throat,engineZone(x));
const lipLean=x=>Math.min(.1,.03*chord(x));
const pEx=x=>pTE(x)-Math.min(ENGINE.exhaust,.34*chord(x));
const pEb=x=>pEx(x)+Math.min(.26,.05*chord(x));
const HINGE=1.15,GAP=.03;
const pH=x=>pTE(x)-Math.min(HINGE,.24*chord(x));

function hump(x,p,teeth){
  const bx=engineBx(x);if(!bx)return 0;
  const lt=pLip(x,teeth)+lipLean(x),ex=pEx(x);
  if(p<lt-1e-7||p>ex+1e-7)return 0;
  return ENGINE.h*bx*(ENGINE.gLip+(1-ENGINE.gLip)*smooth(lt,lt+2,p)-(1-ENGINE.gEx)*smooth(ex-3.4,ex,p));
}
function throat(x,p,teeth){
  const bt=throatBx(x);if(bt<=0)return 0;
  const rs=pThroat(x,teeth),lip=pLip(x,teeth);
  return p<=rs||p>lip+1e-7?0:-ENGINE.dip*bt*smooth(rs,lip,p);
}
const yUp=(x,p,teeth)=>yRef(x)+upShare(x)*thick(x)*section01((p-pLE(x))/chord(x),leSharp(x))+cockpit(x,p)+hump(x,p,teeth)+throat(x,p,teeth);
const yLo=(x,p)=>yRef(x)-(1-upShare(x))*thick(x)*section01((p-pLE(x))/chord(x),leSharp(x));

// Elevons on the long notch-to-tooth trailing edge: inboard 'elevator', outboard 'aileron'.
const XMID=(XB+.7+XA-.9)/2;
const ELEVONS=[{name:'elevator',a:XB+.7,b:XMID-.1},{name:'aileron',a:XMID+.1,b:XA-.9}];

const LODS={
  hero:{teeth:4,n:{nose:14,hump:16,deck:1,flap:6,belly:26},body:[.25,.55,.9,1.3,1.8,2.45],mid:[7.75,8.4,9.15],cutStep:.75,outer:[20.1,21.05],budget:18000,details:true},
  mobile:{teeth:3,n:{nose:6,hump:7,deck:0,flap:3,belly:10},body:[.6,1.25,1.8,2.45],mid:[8.5],cutStep:1.9,outer:[20.6],budget:4800,details:false},
};

function halfStations(lod){
  const xs=[0,...lod.body,ENGINE.x-ENGINE.w,ENGINE.x+ENGINE.w,...lod.mid,XB,XA,...lod.outer,HALF];
  for(let k=0;k<=2*lod.teeth;k++)xs.push(ENGINE.x-ENGINE.half+k*ENGINE.half/lod.teeth);
  for(const e of ELEVONS)xs.push(e.a,e.b);
  const out=[];
  for(const x of [...new Set(xs.map(v=>Math.round(v*1e6)/1e6))].sort((a,b)=>a-b)){
    const start=ELEVONS.find(e=>Math.abs(x-e.a)<1e-6),end=ELEVONS.find(e=>Math.abs(x-e.b)<1e-6);
    if(start){out.push({x,cut:false},{x,cut:true});const n=Math.max(1,Math.round((start.b-start.a)/lod.cutStep));for(let k=1;k<n;k++)out.push({x:start.a+(start.b-start.a)*k/n,cut:true});}
    else if(end)out.push({x,cut:true},{x,cut:false});
    else out.push({x,cut:false});
  }
  return out;
}
const stationsFor=lod=>{const half=halfStations(lod);return [...half.slice(1).reverse().map(s=>({x:-s.x,cut:s.cut})),...half];};

// One spanwise station: ascending-p sample lists for the upper and lower skin.
function section(x,lod){
  const n=lod.n,le=pLE(x),te=pTE(x),rs=pThroat(x,lod.teeth),lip=pLip(x,lod.teeth),lt=lip+lipLean(x),ex=pEx(x),eb=pEb(x),h=pH(x),up=[],lo=[];
  for(let k=0;k<n.nose;k++)up.push(le+(rs-le)*(1-Math.cos(k/n.nose*Math.PI/2)));
  const iRs=up.length;up.push(rs);
  const iLip=up.length;up.push(lip,lt);
  for(let k=1;k<=n.hump;k++)up.push(lt+(ex-lt)*k/(n.hump+1));
  const iEx=up.length;up.push(ex,eb);
  for(let k=1;k<=n.deck;k++)up.push(eb+(h-eb)*k/(n.deck+1));
  const iH=up.length;up.push(h);
  const flap=[];for(let k=1;k<=n.flap;k++)flap.push(h+(te-h)*Math.sin(k/n.flap*Math.PI/2));
  up.push(...flap);
  for(let k=0;k<n.belly;k++)lo.push(le+(h-le)*(1-Math.cos(k/n.belly*Math.PI/2)));
  const iHl=lo.length;lo.push(h,...flap);
  for(const list of [up,lo])for(let k=1;k<list.length;k++)if(!(list[k]>list[k-1]))throw Error(`station ${x.toFixed(3)}: chordwise samples fold at ${k}`);
  return {x,iRs,iLip,iEx,iH,iHl,face:engineBx(x)>1e-6||throatBx(x)>1e-6,throat:throatBx(x)>1e-6,
    up:up.map(p=>[x,yUp(x,p,lod.teeth),p-Z0]),lo:lo.map(p=>[x,yLo(x,p),p-Z0])};
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const triNormal=(a,b,c)=>cross(sub(b,a),sub(c,a));
// Crease-feature soup: flat triangles, flipped toward `dir` when one is given.
function pushTri(soup,a,b,c,dir){const n=triNormal(a,b,c);if(dot(n,n)<1e-14)return;if(dir&&dot(n,dir)<0)[b,c]=[c,b];soup.push(a,b,c);}
function soupGeometry(soup,crease=.62){
  if(!soup.length)return null;
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(soup.flat(),3));
  const c=toCreasedNormals(g,crease);return mergeVertices(c,1e-5);
}
function indexedGeometry(positions,normals,index){
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));
  if(normals)g.setAttribute('normal',new Float32BufferAttribute(normals,3));g.setIndex(index);if(!normals)g.computeVertexNormals();return g;
}
// Keep only the vertices a role uses (normals were computed on the whole skin).
function compact(pos,nor,index){
  const map=new Map(),p=[],n=[],ix=[];
  for(const v of index){let k=map.get(v);if(k===undefined){k=p.length/3;map.set(v,k);p.push(pos[v*3],pos[v*3+1],pos[v*3+2]);n.push(nor[v*3],nor[v*3+1],nor[v*3+2]);}ix.push(k);}
  return indexedGeometry(p,n,ix);
}

// ---------------------------------------------------------------------------
// The skin
// ---------------------------------------------------------------------------
function buildSkin(lod){
  const list=stationsFor(lod),secs=new Map();
  for(const s of list)if(!secs.has(s.x))secs.set(s.x,section(s.x,lod));
  const pos=[],ids=new Map(),roles={hull:[],metal:[]},features={hull:[],dark:[]};
  const vid=(x,surf,j)=>{if(surf==='l'&&j===0)surf='u';const key=`${x}|${surf}|${j}`;let v=ids.get(key);
    if(v===undefined){const s=secs.get(x),P=surf==='u'?s.up[j]:s.lo[j];v=pos.length/3;pos.push(...P);ids.set(key,v);}return v;};
  const quad=(role,a,b,c,d)=>roles[role].push(a,b,c,c,b,d);   // a,b on station i; c,d on station i+1
  for(let i=0;i<list.length-1;i++){
    const A=secs.get(list[i].x),B=secs.get(list[i+1].x);
    if(list[i].x===list[i+1].x){
      // Notch wall where a fixed full-chord section meets an elevon cut-out.
      // Fanned from its centroid so the wall shares the hinge face's edge exactly.
      const s=A,dir=[list[i].cut?-1:1,0,0],poly=[...s.up.slice(s.iH),...s.lo.slice(s.iHl).reverse()];
      const c=poly.reduce((m,p)=>m.map((v,k)=>v+p[k]/poly.length),[0,0,0]);
      for(let k=0;k<poly.length;k++)pushTri(features.dark,c,poly[k],poly[(k+1)%poly.length],dir);
      continue;
    }
    const cut=list[i].cut&&list[i+1].cut,upEnd=cut?A.iH:A.up.length-1,loEnd=cut?A.iHl:A.lo.length-1;
    const faces=A.face||B.face,throatOn=A.throat||B.throat,deck=onDeck(A.x)&&onDeck(B.x);
    for(let j=0;j<upEnd;j++){
      if((faces&&(j===A.iLip||j===A.iEx))||(throatOn&&j===A.iRs)){
        // Intake throat + mouth (forward-up) and exhaust slot (aft-up): crisp, dark.
        const dir=j===A.iEx?[0,.4,1]:[0,.4,-1];
        pushTri(features.dark,A.up[j],A.up[j+1],B.up[j],j===A.iRs?[0,1,0]:dir);pushTri(features.dark,B.up[j],A.up[j+1],B.up[j+1],j===A.iRs?[0,1,0]:dir);
        continue;
      }
      quad(deck&&j>A.iEx?'metal':'hull',vid(A.x,'u',j),vid(A.x,'u',j+1),vid(B.x,'u',j),vid(B.x,'u',j+1));
    }
    for(let j=0;j<loEnd;j++){const a=vid(A.x,'l',j),b=vid(A.x,'l',j+1),c=vid(B.x,'l',j),d=vid(B.x,'l',j+1);roles.hull.push(a,c,b,c,d,b);}
    if(cut){ // hinge face behind the fixed skin, facing the elevon
      const dir=[-S*Math.sign(A.x+B.x),0,1];
      pushTri(features.dark,A.up[A.iH],A.lo[A.iHl],B.up[B.iH],dir);pushTri(features.dark,B.up[B.iH],A.lo[A.iHl],B.lo[B.iHl],dir);
    }
  }
  // Cropped wingtips.
  for(const x of [-HALF,HALF]){const s=secs.get(x),poly=[...s.up.slice().reverse(),...s.lo.slice(1)],c=poly.reduce((m,p)=>m.map((v,k)=>v+p[k]/poly.length),[0,0,0]);
    for(let k=0;k<poly.length-1;k++)pushTri(features.hull,c,poly[k],poly[k+1],[Math.sign(x),0,0]);}
  const all=indexedGeometry(pos,null,[...roles.hull,...roles.metal]),nor=all.getAttribute('normal').array;
  return {secs,roles:{hull:compact(pos,nor,roles.hull),metal:compact(pos,nor,roles.metal)},features};
}

// Decals conform exactly to the drawn (faceted) upper skin: every decal cell is
// clipped against the skin's own triangles in planform and each piece is lifted
// off that triangle's plane, so no skin resolution can poke through a window
// or a panel line. Lit with the analytic surface normal.
function decalFactory(secs,lod){
  const rows=[...secs.values()].sort((a,b)=>a.x-b.x),tris=[];
  for(let i=0;i<rows.length-1;i++){const A=rows[i].up,B=rows[i+1].up;if(B[0][0]-A[0][0]<1e-9)continue;
    for(let j=0;j<A.length-1;j++)for(const t of [[A[j],A[j+1],B[j]],[B[j],A[j+1],B[j+1]]]){const xs=t.map(v=>v[0]),zs=t.map(v=>v[2]);
      tris.push({t,minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)});}}
  const normal=(x,p)=>{const h=.02,dx=(yUp(x+h,p,lod.teeth)-yUp(x-h,p,lod.teeth))/(2*h),dp=(yUp(x,p+h,lod.teeth)-yUp(x,p-h,lod.teeth))/(2*h),l=Math.hypot(dx,1,dp);return [-dx/l,1/l,-dp/l];};
  const cross2=(a,b,u)=>(b[0]-a[0])*(u[1]-a[1])-(b[1]-a[1])*(u[0]-a[0]);
  // Convex planform polygon [[x,p],...] -> conforming triangles.
  function conform(out,poly,lift){
    const pz=poly.map(([x,p])=>[x,p-Z0]),xs=pz.map(v=>v[0]),zs=pz.map(v=>v[1]);
    const [x0,x1,z0,z1]=[Math.min(...xs),Math.max(...xs),Math.min(...zs),Math.max(...zs)];
    for(const T of tris){
      if(T.maxX<x0||T.minX>x1||T.maxZ<z0||T.minZ>z1)continue;
      const tri=T.t.map(v=>[v[0],v[2]]);let piece=pz;
      for(let e=0;e<3&&piece.length>=3;e++){
        const a=tri[e],b=tri[(e+1)%3],c=tri[(e+2)%3],sc=cross2(a,b,c);if(Math.abs(sc)<1e-12){piece=[];break;}
        const next=[];
        for(let k=0;k<piece.length;k++){const u=piece[k],v=piece[(k+1)%piece.length],su=cross2(a,b,u)*sc,sv=cross2(a,b,v)*sc;
          if(su>=0)next.push(u);if((su>=0)!==(sv>=0)){const t=su/(su-sv);next.push([u[0]+(v[0]-u[0])*t,u[1]+(v[1]-u[1])*t]);}}
        piece=next;
      }
      if(piece.length<3)continue;
      const [P,Q,R]=T.t,d=(Q[0]-P[0])*(R[2]-P[2])-(R[0]-P[0])*(Q[2]-P[2]);
      const y=([x,z])=>{const u=((x-P[0])*(R[2]-P[2])-(R[0]-P[0])*(z-P[2]))/d,v=((Q[0]-P[0])*(z-P[2])-(x-P[0])*(Q[2]-P[2]))/d;return P[1]+u*(Q[1]-P[1])+v*(R[1]-P[1]);};
      const pts=piece.map(q=>[q[0],y(q)+lift,q[1]]),base=out.p.length/3;
      for(const q of pts){out.p.push(...q);out.n.push(...normal(q[0],q[2]+Z0));}
      for(let k=1;k<pts.length-1;k++){const n=triNormal(pts[0],pts[k],pts[k+1]);if(Math.abs(n[1])<1e-10)continue;n[1]>0?out.i.push(base,base+k,base+k+1):out.i.push(base,base+k+1,base+k);}
    }
  }
  // Grid of convex cells over a planform map (s,t) in [0,1]^2 -> [x,p].
  function patch(out,map,lift,nu=4,nv=3){
    for(let j=0;j<nv;j++)for(let i=0;i<nu;i++)conform(out,[map(i/nu,j/nv),map((i+1)/nu,j/nv),map((i+1)/nu,(j+1)/nv),map(i/nu,(j+1)/nv)],lift);
  }
  const quadMap=c=>(s,t)=>[0,1].map(k=>lerp(lerp(c[0][k],c[1][k],s),lerp(c[3][k],c[2][k],s),t));
  // Constant-width ribbon along a planform polyline.
  function ribbon(out,path,width,lift,step=.5){
    const pts=[];for(let k=0;k<path.length-1;k++){const [a,b]=[path[k],path[k+1]],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));for(let s=k?1:0;s<=n;s++)pts.push([lerp(a[0],b[0],s/n),lerp(a[1],b[1],s/n)]);}
    for(let k=0;k<pts.length-1;k++){const [a,b]=[pts[k],pts[k+1]],l=Math.hypot(b[0]-a[0],b[1]-a[1]),ox=-(b[1]-a[1])/l*width/2,op=(b[0]-a[0])/l*width/2;
      patch(out,quadMap([[a[0]+ox,a[1]+op],[a[0]-ox,a[1]-op],[b[0]-ox,b[1]-op],[b[0]+ox,b[1]+op]]),lift,1,1);}
  }
  return {patch,ribbon};
}

// Windscreen visor: a gently curved band across the cockpit hump's front slope.
const VISOR={half:1.46,front:x=>3.02+.18*(x/1.46)**2,rear:x=>3.9+.14*(x/1.46)**2};
// One pane: inner/outer x at its front and rear edges, and its depth band (0..1) within the visor.
const paneMap=(side,[fi,fo,ri,ro],t0=.14,t1=.86)=>(s,t)=>{const tt=lerp(t0,t1,t),x=side*lerp(lerp(fi,fo,s),lerp(ri,ro,s),tt),p=lerp(VISOR.front(x),VISOR.rear(x),tt);return [x,p];};

function details(secs,lod){
  const {patch,ribbon}=decalFactory(secs,lod),out=Object.fromEntries(['hull','trim','accent','glass','metal','dark'].map(r=>[r,{p:[],n:[],i:[]}]));
  const q=lod.details?3:2;   // pane cells across (edges follow the visor curve)
  // Visor band (trim) carrying four small, dark windscreen panes.
  patch(out.trim,(s,t)=>{const x=lerp(-VISOR.half,VISOR.half,s);return [x,lerp(VISOR.front(x),VISOR.rear(x),t)];},.01,lod.details?10:5,1);
  for(const side of [-1,1]){
    patch(out.glass,paneMap(side,[.1,.66,.1,.7]),.018,q,1);
    patch(out.glass,paneMap(side,[.8,1.24,.84,1.34]),.018,q,1);
    // Restrained recognition chevrons near each wingtip.
    const cx=side*20.2,cp=pLE(20.2)+.7;
    ribbon(out.accent,[[cx-side*.42,cp+.36],[cx,cp],[cx+side*.42,cp+.36]],.1,.014,1);
    if(lod.details){
      // Leading-edge panel joint (outboard of the intakes) and a long spine
      // chevron converging on the tail.
      ribbon(out.trim,[[side*7.6,pLE(7.6)+.86],[side*21.3,pLE(21.3)+.62]],.06,.012,3);
      ribbon(out.trim,[[side*1.25,6.6],[side*.06,16.9]],.06,.012,3);
      // Exhaust deck border, aft edge of each engine hump.
      ribbon(out.trim,[[side*(ENGINE.x-ENGINE.w+.05),pEb(ENGINE.x-ENGINE.w+.05)+.12],[side*(ENGINE.x+ENGINE.w-.05),pEb(ENGINE.x+ENGINE.w-.05)+.12]],.05,.012,3);
    }
  }
  const geos={};for(const [role,o] of Object.entries(out))if(o.i.length)geos[role]=indexedGeometry(o.p,o.n,o.i);
  return geos;
}

// ---------------------------------------------------------------------------
// Elevons. Each lives in a hinge frame (outer group at the pivot, rotated so
// local +X runs along the swept hinge line toward world +X) holding the named
// group fleetAnimator drives. rotation.x then hinges the surface about its own
// axis: positive moves the trailing edge down, exactly as the fleet's
// unswept surfaces do. They sit GAP behind the fixed hinge face and GAP inside
// the notch walls, so the neutral pose never double-draws.
// ---------------------------------------------------------------------------
function elevon(e,side,lod,role){
  const n=Math.max(1,Math.round((e.b-e.a)/lod.cutStep)),xs=[];
  for(let k=0;k<=n;k++)xs.push(side*clamp(e.a+(e.b-e.a)*k/n,e.a+GAP,e.b-GAP));
  if(side<0)xs.reverse();
  const rows=xs.map(x=>{const h=pH(x),te=pTE(x),ps=[h+GAP];for(let k=1;k<=lod.n.flap;k++)ps.push(h+(te-h)*Math.sin(k/lod.n.flap*Math.PI/2));
    return {x,up:ps.map(p=>[x,yUp(x,p,lod.teeth),p-Z0]),lo:ps.map(p=>[x,yLo(x,p),p-Z0])};});
  const sheet=(key,flip)=>{const p=[],ix=[],m=rows[0][key].length;for(const r of rows)for(const v of r[key])p.push(...v);
    for(let i=0;i<rows.length-1;i++)for(let j=0;j<m-1;j++){const a=i*m+j,b=a+1,c=a+m,d=c+1;flip?ix.push(a,c,b,c,d,b):ix.push(a,b,c,c,b,d);}
    return indexedGeometry(p,null,ix);};
  const soup=[],fwd=[S*side,0,-1];
  for(let i=0;i<rows.length-1;i++){const A=rows[i],B=rows[i+1];pushTri(soup,A.up[0],A.lo[0],B.up[0],fwd);pushTri(soup,B.up[0],A.lo[0],B.lo[0],fwd);}
  for(const [r,dir] of [[rows[0],-1],[rows.at(-1),1]]){const poly=[...r.up,...r.lo.slice().reverse()],c=poly.reduce((m,p)=>m.map((v,k)=>v+p[k]/poly.length),[0,0,0]);
    for(let k=0;k<poly.length;k++)pushTri(soup,c,poly[k],poly[(k+1)%poly.length],[dir,0,0]);}
  const geometry=mergeGeometries([sheet('up',false),sheet('lo',true),soupGeometry(soup)]);
  // Hinge axis through the middle of the gap, at the hinge-face mid height.
  const ends=[xs[0],xs.at(-1)].map(x=>new Vector3(x,(yUp(x,pH(x),lod.teeth)+yLo(x,pH(x)))/2,pH(x)+GAP/2-Z0));
  const X=ends[1].clone().sub(ends[0]).normalize(),Y=new Vector3(0,1,0).addScaledVector(X,-X.y).normalize(),Z=new Vector3().crossVectors(X,Y);
  const basis=new Matrix4().makeBasis(X,Y,Z),pivot=ends[0].clone().add(ends[1]).multiplyScalar(.5);
  const toLocal=new Matrix4().makeTranslation(pivot.x,pivot.y,pivot.z).multiply(basis).invert();
  geometry.applyMatrix4(toLocal);
  const name=`${e.name}-${side<0?'left':'right'}`,frame=new Group(),part=new Group();
  frame.name=`${name}-hinge`;frame.position.copy(pivot);frame.quaternion.setFromRotationMatrix(basis);
  const mesh=new Mesh(geometry,role);mesh.name=`${name}-skin`;
  part.name=name;frame.add(part);part.add(mesh);
  return frame;
}

// ---------------------------------------------------------------------------
function build(low){
  const lod=low?LODS.mobile:LODS.hero,root=new Group();
  root.name=`Skyloom ${DEF.slug}`;root.userData={author:'Skyloom',license:'MIT',revision:DEF.revision,lod:low?'mobile':'hero',units:'metres',nose:'-Z'};
  const spec={hull:[DEF.colors.hull,.42,.18],trim:[DEF.colors.trim,.5,.15],accent:[DEF.colors.accent,.32,.25],glass:['#1a2730',.1,.35],metal:['#5c646a',.45,.55],dark:['#0b0e11',.75,.05]};
  const mats=Object.fromEntries(Object.entries(spec).map(([name,[color,roughness,metalness]])=>[name,new MeshStandardMaterial({name,color,roughness,metalness})]));
  const skin=buildSkin(lod),decals=details(skin.secs,lod),parts={};
  const add=(role,g)=>{if(g)(parts[role]??=[]).push(g);};
  add('hull',skin.roles.hull);add('metal',skin.roles.metal);add('hull',soupGeometry(skin.features.hull));add('dark',soupGeometry(skin.features.dark));
  for(const [role,g] of Object.entries(decals))add(role,g);
  for(const role of Object.keys(mats))if(parts[role]){const mesh=new Mesh(mergeGeometries(parts[role]),mats[role]);mesh.name=role;root.add(mesh);}
  for(const side of [-1,1])for(const e of ELEVONS)root.add(elevon(e,side,lod,mats.trim));
  root.updateMatrixWorld(true);let triangles=0,draws=0;
  root.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;draws++;}});
  return {root,triangles,draws,budget:lod.budget};
}

// Hangar glyph: the fleet's oblique projector (same 30° azimuth and handedness)
// raised to a 46° elevation so a flat wing shows its planform, with per-face
// light and a lifted palette so a near-black airframe still reads on the dark
// fleet rail. Each face is stroked in its own colour to close AA seams.
function thumbnail(root){
  const az=30*Math.PI/180,el=46*Math.PI/180;
  const D=new Vector3(-Math.sin(az)*Math.cos(el),-Math.sin(el),Math.cos(az)*Math.cos(el)),X=new Vector3(Math.cos(az),0,Math.sin(az)),Y=new Vector3().crossVectors(X,D);
  const faces=[],view=D.clone().negate(),key=new Vector3(.25,1,-.35).normalize(),fill=new Vector3(-.7,.35,.45).normalize();
  const tone={hull:'#6c7883',trim:'#414b55',accent:'#e0a468',glass:'#3a5767',metal:'#8d969d',dark:'#151a20'};
  root.updateMatrixWorld(true);
  root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry,pos=g.attributes.position,base=new Color(tone[o.material.name]??`#${o.material.color.getHexString()}`);
    for(let i=0;i<pos.count;i+=3){
      const v=[0,1,2].map(j=>new Vector3().fromBufferAttribute(pos,i+j).applyMatrix4(o.matrixWorld)),n=new Vector3().subVectors(v[1],v[0]).cross(new Vector3().subVectors(v[2],v[0]));
      if(n.lengthSq()<1e-12||n.normalize().dot(view)<=0)continue;
      const shade=base.clone().multiplyScalar(.42+.72*Math.max(0,n.dot(key))+.2*Math.max(0,n.dot(fill)));
      faces.push({points:v.map(p=>[p.dot(X),p.dot(Y)]),depth:v.reduce((s,p)=>s+p.dot(D),0)/3,color:`#${shade.getHexString()}`});
    }});
  const pts=faces.flatMap(f=>f.points),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY;
  const scale=Math.min(220/w,98/h),x=(240-w*scale)/2,y=(120-h*scale)/2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><title>${root.name}</title><g stroke-width=".35" stroke-linejoin="round">${faces.sort((a,b)=>b.depth-a.depth).map(f=>`<path fill="${f.color}" stroke="${f.color}" d="M${f.points.map(p=>`${((p[0]-minX)*scale+x).toFixed(1)},${((p[1]-minY)*scale+y).toFixed(1)}`).join('L')}Z"/>`).join('')}</g></svg>`;
}

// The wake/exhaust stations declared in FLEET_PRESENTATION must sit in the slots built here.
for(const [i,e] of DEF.engines.entries()){
  const x=Math.sign(e[0])*ENGINE.x,ex=pEx(x),eb=pEb(x),slot=[x,(yUp(x,ex,4)+yUp(x,eb,4))/2,(ex+eb)/2-Z0];
  if(Math.hypot(...slot.map((v,k)=>v-e[k]))>.05)throw Error(`engine ${i} [${e}] is not at its exhaust slot [${slot.map(v=>v.toFixed(2))}]`);
}
const exporter=new GLTFExporter(),rows=[];
for(const low of [false,true]){
  const {root,triangles,draws,budget}=build(low);
  if(triangles>budget)throw Error(`${DEF.slug} ${low?'mobile':'hero'} is over budget: ${triangles} > ${budget}`);
  const size=new Box3().setFromObject(root).getSize(new Vector3());
  if(Math.abs(size.z-L)>.005||Math.abs(size.x-DEF.span)>.005)throw Error(`${DEF.slug}: bounding box ${size.toArray().map(v=>v.toFixed(3))} != ${DEF.span} x ${L}`);
  const url=low?DEF.mobileUrl:DEF.url,data=await exporter.parseAsync(root,{binary:true});fs.writeFileSync(`public${url}`,Buffer.from(data));
  if(low)fs.writeFileSync(`public${DEF.thumbnail}`,thumbnail(root));
  rows.push({id:DEF.id,lod:low?'mobile':'hero',url,triangles,draws,bytes:data.byteLength});
}
const file='public/models/adventure-fleet-v1.json',kept=JSON.parse(fs.readFileSync(file,'utf8')).filter(r=>r.id!==DEF.id);
fs.writeFileSync(file,JSON.stringify([...kept,...rows],null,2)+'\n');
console.log(JSON.stringify(rows,null,2));
