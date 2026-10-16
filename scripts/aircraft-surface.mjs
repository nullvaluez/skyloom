/** Shared first-party aircraft finish. Baked into each GLB; no runtime texture
 * downloads or random rebuilds. Service details share one extra draw call.
 * Surface metadata is retained
 * by GLTFLoader so flight and hangar use the same authored PBR response. */
import {Color,Float32BufferAttribute,Vector3} from 'three';
import {detailAircraft} from './aircraft-detail.mjs';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

export function finishAircraft(root,{military=false,stealth=false,bareMetal=false}={}){
  const seen=new Set();
  root.updateMatrixWorld(true);
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    for(const m of mats){
      if(seen.has(m))continue;seen.add(m);
      const role=m.name.toLowerCase(),glass=/glass|canopy|cabin/.test(role),metal=/metal|titanium|nozzle/.test(role),dark=/dark|interior/.test(role);
      m.roughness=glass?(/cabin/.test(role)?.58:.11):dark?.84:metal?.30:stealth?.39:military?.36:bareMetal?.27:.30;
      m.metalness=glass?(/cabin/.test(role)?.03:.38):dark?.03:metal?.82:bareMetal&&/hull/.test(role)?.72:stealth?.24:military?.20:.12;
      if(military&&!glass&&!metal&&!dark){
        // Low-visibility trim shares the skin's hue; it is paint, not a black
        // outline around every moving surface.
        const hull=root.getObjectByName('hull')?.material?.color;
        if(hull&&(/trim|panels/.test(role)))m.color.lerp(hull,.13);
        if(hull&&(/accent|recognition/.test(role)))m.color.lerp(hull,.12);
      }
      if(glass&&!/cabin/.test(role))m.color.set(root.name.includes('F-35')?'#716449':stealth?'#203540':'#163a4b');
      m.userData={...m.userData,aircraftSurface:2};
    }
    const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal;
    const role=mats[0].name.toLowerCase();
    if(!p||!n)return;
    // Remove collapsed closure cells before export. Welding keeps the creases
    // (different normals remain separate) and saves downloads on every device.
    const a=new Vector3(),b=new Vector3(),c0=new Vector3(),cross=new Vector3(),keep=[];
    const index=g.index,count=index?.count??p.count;
    for(let k=0;k<count;k+=3){
      const ids=[0,1,2].map(j=>index?index.getX(k+j):k+j);
      a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c0.fromBufferAttribute(p,ids[2]);
      cross.crossVectors(b.sub(a),c0.sub(a));if(cross.lengthSq()<1e-18)continue;
      keep.push(...ids);
      cross.normalize();
      for(const v of ids)if(Math.hypot(n.getX(v),n.getY(v),n.getZ(v))<.5)n.setXYZ(v,cross.x,cross.y,cross.z);
    }
    g.setIndex(keep);g.normalizeNormals();
    if(/glass|canopy|cabin|dark|interior/.test(role)){
      mesh.geometry=mergeVertices(g,1e-5);g.dispose();return;
    }
    // Low-amplitude, continuous manufacturing variation, not random per-face
    // colours. The same coordinates produce the same finish at both LODs.
    const colors=new Float32Array(p.count*3),prior=g.attributes.color;
    const metal=/metal|titanium|nozzle/.test(role),c=new Color();
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const grain=Math.sin(z*2.71+x*.73)*Math.sin(x*3.11+y*1.37);
      const shade=1-(metal?.045:.018)*(grain*.5+.5)-(stealth?.022:.012)*(1-Math.abs(n.getY(i)));
      c.setRGB(shade,shade,shade);
      if(prior){c.r*=prior.getX(i);c.g*=prior.getY(i);c.b*=prior.getZ(i);}
      colors.set([c.r,c.g,c.b],i*3);
    }
    g.setAttribute('color',new Float32BufferAttribute(colors,3));mats.forEach(m=>m.vertexColors=true);
    mesh.geometry=mergeVertices(g,1e-5);g.dispose();
  });
  detailAircraft(root,{military,stealth,bareMetal});
  root.userData={...root.userData,surfaceRevision:2};
  return root;
}

/** Shape-preserving interpolation; no overshoot at pointed ends or straight
 * cabin sections. Also used by conformal windows and maintenance joints. */
export function station(rows,x){
  let i=rows.findIndex((r,k)=>k<rows.length-1&&x>=r[0]&&x<=rows[k+1][0]);
  if(i<0)return (x<rows[0][0]?rows[0]:rows.at(-1)).slice(1);
  const a=rows[i],b=rows[i+1],h=b[0]-a[0],t=(x-a[0])/h;
  return a.slice(1).map((_,j)=>{j++;const slope=k=>(rows[k+1][j]-rows[k][j])/(rows[k+1][0]-rows[k][0]);const tangent=k=>{if(k===0)return slope(0);if(k===rows.length-1)return slope(k-1);const p=slope(k-1),q=slope(k);return p*q<=0?0:2*p*q/(p+q);};return(2*t**3-3*t*t+1)*a[j]+(t**3-2*t*t+t)*h*tangent(i)+(-2*t**3+3*t*t)*b[j]+(t**3-t*t)*h*tangent(i+1);});
}
