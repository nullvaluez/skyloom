import { BoxGeometry, CylinderGeometry, TorusGeometry, MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, RepeatWrapping, SRGBColorSpace, Color, Float32BufferAttribute } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One shared room, in real metres. No lights, shadow maps, render targets or
// reflective passes: it receives the world's existing daylight/environment.
export function createAirportLounge() {
  let seed=431;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  function texture(kind) {
    const c=document.createElement('canvas');c.width=c.height=512;
    const ctx=c.getContext('2d');
    ctx.fillStyle=kind==='oak'?'#8f6743':'#696b68';ctx.fillRect(0,0,512,512);
    if(kind==='oak') {
      for(let i=0;i<1300;i++) {const y=random()*512;ctx.strokeStyle=`rgba(${random()>.5?'37,20,9':'215,181,130'},${.02+random()*.12})`;ctx.lineWidth=.2+random()*1.3;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(170,y+Math.sin(y)*3,350,y+Math.cos(y)*3,512,y);ctx.stroke();}
    } else {
      for(let i=0;i<22000;i++){const v=random();ctx.fillStyle=v>.78?'#a0a29c':v>.45?'#5d605c':'#767872';const x=random()*512,y=random()*512,s=.3+random()*2;ctx.fillRect(x,y,s,s*.7);}
      ctx.strokeStyle='#505551';ctx.lineWidth=1;ctx.strokeRect(0,0,512,512);
    }
    const t=new CanvasTexture(c);t.colorSpace=SRGBColorSpace;t.wrapS=t.wrapT=RepeatWrapping;t.anisotropy=4;return t;
  }
  const oak=texture('oak'),stone=texture('stone');
  const materials={
    oak:new MeshStandardMaterial({map:oak,color:'#dfc7a2',roughness:.48,metalness:0,envMapIntensity:.55}),
    stone:new MeshStandardMaterial({map:stone,color:'#d7ded9',roughness:.72,metalness:0,envMapIntensity:.4}),
    frame:new MeshStandardMaterial({color:'#637178',roughness:.34,metalness:.62,envMapIntensity:.8}),
    fabric:new MeshStandardMaterial({color:'#b7beb5',roughness:.96,metalness:0,envMapIntensity:.3}),
    pale:new MeshStandardMaterial({color:'#ced5cc',roughness:.72,metalness:.04,envMapIntensity:.4}),
    light:new MeshBasicMaterial({color:'#ffdeb2',toneMapped:true}),
  };
  // A little material-local bounce keeps the sheltered interior legible at
  // night, without adding an irradiance source to the outdoor world.
  for(const name of ['oak','stone','fabric','pale']) {materials[name].emissive=new Color(materials[name].color);materials[name].emissiveIntensity=.075;}
  materials.oak.bumpMap=oak;materials.oak.bumpScale=.002;
  materials.stone.bumpMap=stone;materials.stone.bumpScale=.001;
  // Baked contact occlusion in the floor's second UV set. One small static
  // map gives furniture weight; no dynamic shadows or extra draw/pass.
  const aoCanvas=document.createElement('canvas');aoCanvas.width=aoCanvas.height=512;
  const aoCtx=aoCanvas.getContext('2d');aoCtx.fillStyle='#ffffff';aoCtx.fillRect(0,0,512,512);
  function shadow(x,z,r,opacity){const px=(x+14)/28*512,py=(1-(z+6)/18)*512,rr=r/28*512;const g=aoCtx.createRadialGradient(px,py,0,px,py,rr);g.addColorStop(0,'rgba(0,0,0,'+opacity+')');g.addColorStop(1,'rgba(0,0,0,0)');aoCtx.fillStyle=g;aoCtx.fillRect(px-rr,py-rr,rr*2,rr*2);}
  for(let x=-10.5;x<=12;x+=3)shadow(x,-1.8,1,.72);
  for(const x of [-10,-7,-4,3,6,9])shadow(x,-.05,.8,.55);
  for(const x of [-9,-7,7,9]){shadow(x,5.8,.8,.55);shadow(x,8.5,.8,.55);}
  for(const x of [-10.5,10.5])shadow(x,-1,.85,.7);
  const ao=new CanvasTexture(aoCanvas);ao.channel=1;materials.stone.aoMap=ao;
  const buckets=Object.fromEntries(Object.keys(materials).map(k=>[k,[]]));
  function add(g,mat,x,y,z,rotation=0) {
    if(g.index){const indexed=g;g=g.toNonIndexed();indexed.dispose();}
    g.rotateY(rotation);g.translate(x,y,z);
    // Local metre UVs for the two tactile surfaces, no stretched image atlas.
    if(mat==='oak'||mat==='stone') {const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;for(let i=0;i<p.count;i++){const horizontal=Math.abs(n.getY(i))>.5;uv.setXY(i,p.getX(i)/(mat==='oak'?2:1.2),(horizontal?p.getZ(i):p.getY(i))/(mat==='oak'?.6:1.2));}}
    const color=[];const p=g.attributes.position,n=g.attributes.normal;
    if(mat==='stone'){const uv1=[];for(let i=0;i<p.count;i++)uv1.push((p.getX(i)+14)/28,(p.getZ(i)+6)/18);g.setAttribute('uv1',new Float32BufferAttribute(uv1,2));}
    for(let i=0;i<p.count;i++){const shade=n.getY(i)<-.5?.62:n.getY(i)>.5?1:.86;color.push(shade,shade,shade);}
    g.setAttribute('color',new Float32BufferAttribute(color,3));materials[mat].vertexColors=true;
    buckets[mat].push(g);
  }
  const box=(mat,x,y,z,w,h,d,r=0,bevel=0)=>add(bevel?new RoundedBoxGeometry(w,h,d,2,bevel):new BoxGeometry(w,h,d),mat,x,y,z,r);
  const cylinder=(mat,x,y,z,top,bottom,h,segments=16)=>add(new CylinderGeometry(top,bottom,h,segments),mat,x,y,z);
  // Spacious concourse, deliberately framed from seated eye height. The
  // window itself is clear, avoiding a full-screen transparent overdraw layer.
  box('stone',0,-.12,3,28,.24,18);
  box('frame',0,4.55,3,28,.3,18);
  box('pale',0,2.2,11.8,28,4.4,.22);
  box('pale',-13.9,2.2,3,.22,4.4,18);box('pale',13.9,2.2,3,.22,4.4,18);
  for(let x=-13.7;x<=13.8;x+=.34)box('oak',x,4.31,3,.12,.24,17.8);
  // Continuous clerestory, deep reveals, sill and narrow glazing mullions.
  box('pale',0,.18,-3.2,28,.36,.48);box('frame',0,.38,-3.2,28,.055,.52);
  box('frame',0,4.05,-3.2,28,.2,.32);
  for(let x=-12.075;x<=14;x+=3.45){box('frame',x,2.19,-3.2,.055,3.65,.14);box('pale',x,2.2,-3.34,.025,3.6,.03);}
  for(const x of [-10.5,10.5]) {cylinder('pale',x,2.2,-1,.18,.2,4.4,24);cylinder('frame',x,.1,-1,.22,.22,.2,24);}
  // Window counter: thick end-grain edge, inset dark apron and metal legs.
  box('oak',0,.78,-1.7,26,.075,.8,0,.035);box('frame',0,.71,-1.72,25.8,.07,.45);
  for(let x=-10.5;x<=12;x+=3){box('frame',x,.34,-1.8,.055,.68,.055);box('frame',x,.035,-1.8,.48,.035,.42);}
  // Warm recessed strips and ventilation slots, entirely static geometry.
  for(const z of [-2.5,3,8]) {box('frame',0,4.15,z,25,.06,.12);box('light',0,4.115,z,24.8,.015,.045);}
  for(let x=-12;x<=12;x+=1.2)box('frame',x,4.15,10,.8,.015,.18);
  function chair(x,z,r=0) {
    const piece=(mat,dx,y,dz,w,h,d,b=.03)=>{const c=Math.cos(r),s=Math.sin(r);box(mat,x+dx*c+dz*s,y,z-dx*s+dz*c,w,h,d,r,b);};
    piece('fabric',0,.44,0,.68,.15,.67,.065);piece('fabric',0,.81,.29,.68,.65,.14,.055);
    for(const dx of [-.36,.36]){piece('oak',dx,.66,0,.075,.075,.65,.02);piece('frame',dx,.37,.2,.035,.58,.035,0);piece('frame',dx,.22,-.22,.035,.44,.035,0);}
  }
  for(const x of [-10,-7,-4,3,6,9])chair(x,-.05);
  for(const x of [-9,-7,7,9]){chair(x,5.8,Math.PI);chair(x,8.5);}
  for(const x of [-8,8]){cylinder('frame',x,.24,7,.035,.035,.48);cylinder('frame',x,.035,7,.35,.35,.035);cylinder('oak',x,.49,7,.55,.55,.055,32);}
  // The foreground gives the seated view human scale: a ceramic cup, saucer,
  // quiet reading material and a flush power socket. No dynamic canvas work.
  cylinder('pale',.65,.832,-1.62,.11,.11,.012,32);cylinder('pale',.65,.89,-1.62,.062,.044,.105,32);
  cylinder('frame',.65,.942,-1.62,.051,.051,.002,24);
  const handle=new TorusGeometry(.033,.009,8,20);handle.rotateY(Math.PI/2);add(handle,'pale',.716,.89,-1.62);
  box('pale',-.66,.832,-1.68,.32,.008,.22,-.14);box('frame',-.68,.837,-1.68,.26,.001,.014,-.14);
  box('frame',1.25,.821,-1.88,.12,.004,.07);box('pale',1.25,.824,-1.88,.04,.002,.012);
  // Solid rear planters, with a bounded cluster of sculpted broad leaves.
  for(const x of [-12,12]) {cylinder('pale',x,.38,8,.34,.25,.76,24);cylinder('frame',x,.77,8,.30,.30,.025);for(let i=0;i<9;i++){const r=i*2.4;box('fabric',x+Math.cos(r)*.15,1+random()*.5,8+Math.sin(r)*.15,.1,.7,.025,r,.02);}}
  const meshes=Object.entries(buckets).map(([name,geometries])=>{const geometry=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());geometry.computeBoundingSphere();return {name,geometry,material:materials[name]};});
  return {meshes,textures:[oak,stone,ao],dispose(){for(const m of meshes){m.geometry.dispose();m.material.dispose();}oak.dispose();stone.dispose();ao.dispose();}};
}
