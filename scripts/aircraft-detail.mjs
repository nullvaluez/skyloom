/** Offline surface work. Ray-projected markings follow the real skin and
 * ambient occlusion is baked into vertex colours, so neither needs a runtime
 * shader, texture download or per-frame raycast. */
import {Box3,BufferGeometry,Color,DoubleSide,Float32BufferAttribute,Mesh,MeshStandardMaterial,Ray,Triangle,Vector3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {mergeGeometries,mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

export function detailAircraft(root,{military=false,stealth=false,bareMetal=false}={}){
  const low=root.userData.lod==='mobile',name=root.name.toLowerCase();
  const umbra=name.includes('umbra'),f35=name.includes('f-35'),glider=name.includes('whisper');
  const box=new Box3().setFromObject(root),size=box.getSize(new Vector3()),L=size.z,S=size.x;
  const meshes=[];root.traverse(m=>{if(m.isMesh)meshes.push(m);});
  const parts=meshes.map(m=>{const g=m.geometry.clone();g.applyMatrix4(m.matrixWorld);for(const k of Object.keys(g.attributes))if(!['position','normal'].includes(k))g.deleteAttribute(k);return g.index?g.toNonIndexed():g;});
  const surface=mergeGeometries(parts);parts.forEach(g=>g.dispose());
  const bvh=new MeshBVH(surface,{maxLeafTris:12});
  const ray=new Ray(),p=new Vector3(),n=new Vector3(),u=new Vector3(),v=new Vector3(),dir=new Vector3();
  const radius=L*.055,epsilon=L*.00028;
  for(const m of meshes){
    const g=m.geometry,a=g.attributes.position,normal=g.attributes.normal,prior=g.attributes.color;
    if(/glass|canopy|cabin|interior|dark/i.test(m.material.name))continue;
    const c=new Float32Array(a.count*3),cache=new Map();
    for(let i=0;i<a.count;i++){
      p.fromBufferAttribute(a,i).applyMatrix4(m.matrixWorld);n.fromBufferAttribute(normal,i).transformDirection(m.matrixWorld);
      const key=[p.x,p.y,p.z,n.x,n.y,n.z].map(q=>q.toFixed(4)).join(',');let shade=cache.get(key);
      if(shade===undefined){
        u.set(Math.abs(n.y)<.9?0:1,Math.abs(n.y)<.9?1:0,0).cross(n).normalize();v.crossVectors(n,u);
        ray.origin.copy(p).addScaledVector(n,epsilon);let blocked=0;const samples=low?5:9;
        for(let k=0;k<samples;k++){
          const a=k*2.39996323,t=Math.sqrt((k+.5)/samples)*.93;
          dir.copy(n).multiplyScalar(Math.sqrt(1-t*t)).addScaledVector(u,Math.cos(a)*t).addScaledVector(v,Math.sin(a)*t).normalize();ray.direction.copy(dir);
          const hit=bvh.raycastFirst(ray,DoubleSide,epsilon*.1,radius);if(hit)blocked+=1-Math.min(1,hit.distance/radius)*.65;
        }
        shade=1-blocked/samples*.57;cache.set(key,shade);
      }
      // A small anti-glare radome is a separate coating, not a painted outline.
      let tint=1;
      if(m.name==='hull'&&military&&!umbra&&p.z<box.min.z+L*.13)tint=.65;
      if(m.name==='hull'&&bareMetal&&p.z<box.min.z+L*.33&&n.y>.5)tint=.22;
      for(let j=0;j<3;j++)c[i*3+j]=shade*tint*(prior?prior.array[i*3+j]:1);
    }
    g.setAttribute('color',new Float32BufferAttribute(c,3));m.material.vertexColors=true;
  }
  // All service markings share one draw call. The skin is sampled for each
  // corner and subdivided along curved surfaces; no hovering flat decals.
  const pos=[],colors=[],normal=[],ink=new Color();
  const project=(x,z)=>{
    ray.origin.set(x,box.max.y+L,z);ray.direction.set(0,-1,0);
    const h=bvh.raycastFirst(ray,DoubleSide);if(!h||h.face.normal.y<.45)return null;
    const ids=[h.face.a,h.face.b,h.face.c],pts=ids.map(i=>new Vector3().fromBufferAttribute(surface.attributes.position,i));
    const bary=new Vector3();Triangle.getBarycoord(h.point,...pts,bary);
    const smooth=new Vector3();ids.forEach((id,k)=>smooth.addScaledVector(new Vector3().fromBufferAttribute(surface.attributes.normal,id),bary.getComponent(k)));smooth.normalize();
    const q=h.point.addScaledVector(h.face.normal,L*.00035);q.skinNormal=smooth;return q;
  };
  function face(points,color){
    if(points.some(p=>!p))return;ink.set(color);
    const nn=new Vector3().subVectors(points[1],points[0]).cross(new Vector3().subVectors(points[2],points[0])).normalize();
    if(nn.y<0){points.reverse();nn.negate();}
    for(let i=1;i<points.length-1;i++)for(const q of [points[0],points[i],points[i+1]]){pos.push(...q.toArray());normal.push(...(q.skinNormal||nn).toArray());colors.push(ink.r,ink.g,ink.b);}
  }
  // Clip the coating to existing skin triangles. Four flat decal corners
  // would cut through a cambered wing and leave jagged triangular holes.
  function coating(outline,color){
    const pp=surface.attributes.position,nn=surface.attributes.normal,ix=surface.index;
    const minX=Math.min(...outline.map(p=>p[0])),maxX=Math.max(...outline.map(p=>p[0])),minZ=Math.min(...outline.map(p=>p[1])),maxZ=Math.max(...outline.map(p=>p[1]));
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const sign=Math.sign(cross(outline[0],outline[1],outline[2]));
    for(let i=0;i<ix.count;i+=3){
      const ids=[ix.getX(i),ix.getX(i+1),ix.getX(i+2)],tri=ids.map(k=>new Vector3().fromBufferAttribute(pp,k));
      if(tri.every(p=>p.x<minX)||tri.every(p=>p.x>maxX)||tri.every(p=>p.z<minZ)||tri.every(p=>p.z>maxZ))continue;
      const outward=new Vector3().subVectors(tri[1],tri[0]).cross(new Vector3().subVectors(tri[2],tri[0])).normalize();if(outward.y<.45)continue;
      let poly=tri.map((p,k)=>({p,n:new Vector3().fromBufferAttribute(nn,ids[k])}));
      for(let e=0;e<outline.length&&poly.length;e++){
        const a=outline[e],b=outline[(e+1)%outline.length],out=[];
        for(let j=0;j<poly.length;j++){
          const p=poly[j],q=poly[(j+1)%poly.length],u=cross(a,b,[p.p.x,p.p.z])*sign,v=cross(a,b,[q.p.x,q.p.z])*sign;
          if(u>=0)out.push(p);if((u>=0)!==(v>=0)){const t=u/(u-v);out.push({p:p.p.clone().lerp(q.p,t),n:p.n.clone().lerp(q.n,t).normalize()});}
        }poly=out;
      }
      if(poly.length>=3)face(poly.map(({p,n})=>{p.addScaledVector(n,L*.00035);p.skinNormal=n;return p;}),color);
    }
  }
  function strip(a,b,width,color,steps=1){
    const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<1e-8)return;
    const xx=-dz/len*width/2,zz=dx/len*width/2;
    for(let i=0;i<steps;i++){const q=t=>[a[0]+dx*t,a[1]+dz*t],c=q(i/steps),d=q((i+1)/steps);face([[c[0]-xx,c[1]-zz],[d[0]-xx,d[1]-zz],[d[0]+xx,d[1]+zz],[c[0]+xx,c[1]+zz]].map(([x,z])=>project(x,z)),color);}
  }
  const code=umbra?'02':f35?'35':name.includes('c-17')?'17':bareMetal?'12':name.includes('vector')?'01':name.includes('talon')?'31':'08';
  // Continuous-stroke numerals stay readable without a font atlas.
  const digits={0:'ab cdef'.replaceAll(' ',''),1:'bc',2:'abdeg',3:'abcdg',4:'bcfg',5:'acdfg',6:'acdefg',7:'abc',8:'abcdefg',9:'abcdfg'};
  const segments={a:[[0,0],[1,0]],b:[[1,0],[1,1]],c:[[1,1],[1,2]],d:[[0,2],[1,2]],e:[[0,1],[0,2]],f:[[0,0],[0,1]],g:[[0,1],[1,1]]};
  function number(text,x,z,h,color){for(let i=0;i<text.length;i++)for(const key of digits[text[i]]){const [a,b]=segments[key];strip([x+(a[0]+i*1.5)*h*.45,z+a[1]*h*.5],[x+(b[0]+i*1.5)*h*.45,z+b[1]*h*.5],h*.065,color,1);}}
  // Find the actual main-wing chord; works for the swept, straight and delta
  // wings without drawing panel grids through empty space.
  const chords=[];
  for(const fraction of [ .28,.42,.57,.72,.86 ]){
    const x=S*.5*fraction;let zs=[];
    for(let j=0;j<=140;j++){const z=box.min.z+L*j/140,q=project(x,z);if(q&&q.y<L*.12)zs.push(z);}
    // Main wing is always the forward continuous cluster (tail is behind it).
    const runs=[];let run=[];for(const z of zs){if(run.length&&z-run.at(-1)>L/100){runs.push(run);run=[];}run.push(z);}if(run.length)runs.push(run);
    const longest=runs.sort((a,b)=>b.length-a.length)[0];if(longest?.length>2)chords.push({x,front:longest[0]+L*.004,back:longest.at(-1)-L*.008});
  }
  const seam=umbra?'#272f37':military?'#4c5960':bareMetal?'#646e70':'#8d9698';
  const panel=umbra?'#424d57':military?'#63727b':bareMetal?'#a2aeb1':'#acb7bc';
  for(const side of [-1,1]){
    const q=chords.map(q=>({...q,x:q.x*side}));
    for(let i=0;i<q.length-1;i++){
      const a=q[i],b=q[i+1],at=(q,t)=>[q.x,q.front+(q.back-q.front)*t];
      // Separate wing box, slat strip and narrow trailing hinge line.
      for(const t of (low?[.68]:[.16,.68]))strip(at(a,t),at(b,t),L*(umbra?.0007:.0009),seam,2);
      if(!low){
        strip(at(a,.18),at(a,.66),L*.00055,seam,2);
        // Subtle inset wing-box coating, a large readable physical surface.
        if(!umbra&&i===1)coating([at(a,.22),at(b,.22),at(b,.58),at(a,.58)],panel);
        strip(at(a,.07),at(b,.07),L*.0022,umbra?'#596570':military?'#9ba5aa':'#c6d0d1',2);
      }
    }
    if(!low&&q.length>2){const a=q[2],z=a.front+(a.back-a.front)*.32;
      // A small maintenance serial and a pair of original chevrons.
      if(military||bareMetal)number(code,a.x-L*.025,z,L*(umbra?.025:.025),military?'#aeb9bf':'#53656e');
    }
  }
  // Dorsal service access panels and fastener strips, kept off the cockpit.
  if(!glider&&!low)for(const side of [-1,1])for(const z of [0,.11,.22]){
    const x=side*L*(umbra?.09:.035),zz=z*L,w=L*.017,h=L*.026;
    for(const [a,b]of [[[x-w,zz-h],[x+w,zz-h]],[[x+w,zz-h],[x+w,zz+h]],[[x+w,zz+h],[x-w,zz+h]],[[x-w,zz+h],[x-w,zz-h]]])strip(a,b,L*.00055,seam,3);
  }
  if(pos.length){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));g.setAttribute('normal',new Float32BufferAttribute(normal,3));g.setAttribute('color',new Float32BufferAttribute(colors,3));
    const material=new MeshStandardMaterial({name:'Service markings',color:0xffffff,roughness:.48,metalness:.12,vertexColors:true});material.userData.aircraftSurface=2;
    const marks=new Mesh(mergeVertices(g,1e-6),material);marks.name='service-markings';root.add(marks);
  }
  surface.dispose();root.userData.detailRevision=3;
}
