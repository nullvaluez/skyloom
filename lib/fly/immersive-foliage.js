import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, InstancedBufferAttribute, LinearMipmapLinearFilter, RGBAFormat } from 'three';

/** First-party leaf-cluster atlas, generated once, no external asset dependency. */
function leafAtlas() {
  const size=128,data=new Uint8Array(size*size*4);
  let seed=7321;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let n=0;n<380;n++){
    const a=random()*Math.PI*2,r=Math.sqrt(random()),cx=32+Math.cos(a)*r*26,cy=64+Math.sin(a)*r*58;
    const rx=1.2+random()*2.4,ry=2+random()*4;
    for(let y=Math.max(0,Math.floor(cy-ry));y<Math.min(size,cy+ry);y++)for(let x=Math.max(0,Math.floor(cx-rx));x<Math.min(64,cx+rx);x++){
      const d=((x-cx)/rx)**2+((y-cy)/ry)**2;if(d>1)continue;
      const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=data[i+3]=255;
    }
  }
  // Right half is the solid trunk cell.
  for(let y=0;y<size;y++)for(let x=64;x<size;x++)data.fill(255,(y*size+x)*4,(y*size+x)*4+4);
  const texture=new DataTexture(data,size,size,RGBAFormat);
  texture.generateMipmaps=true;texture.minFilter=LinearMipmapLinearFilter;texture.needsUpdate=true;
  return texture;
}
let atlas=null,users=0;
export function applyImmersiveFoliage(material) {
  atlas??=leafAtlas();users++;
  material.alphaMap=atlas;material.alphaTest=.42;material.side=DoubleSide;
  material.addEventListener('dispose',()=>{if(--users===0){atlas.dispose();atlas=null;}});
}

/** 34 triangles: three staggered leaf clusters, four crossed cards each, and trunk.
 * Fewer triangles than the previous 58-triangle solid crown; one shared instanced draw.
 */
export function buildImmersiveFoliage(pool) {
  const pos=[],uv=[],col=[],idx=[];
  const vertex=(x,y,z,u,v,c)=>{const i=pos.length/3;pos.push(x,y,z);uv.push(u,v);col.push(...c);return i;};
  for(let layer=0;layer<3;layer++)for(let card=0;card<4;card++){
    const a=card*Math.PI/4+layer*.6,w=[.85,1,.66][layer],bottom=[.30,.47,.68][layer],top=[.78,.93,1.04][layer];
    const dx=Math.cos(a)*w,dz=Math.sin(a)*w,ox=Math.sin(layer*5)*.14,oz=Math.cos(layer*7)*.12;
    const shade=.74+layer*.11,c=[shade,shade,shade];
    const n=vertex(ox-dx,bottom,oz-dz,0,0,c);
    vertex(ox+dx,bottom,oz+dz,.5,0,c);vertex(ox+dx,top,oz+dz,.5,1,c);vertex(ox-dx,top,oz-dz,0,1,c);
    idx.push(n,n+1,n+2,n,n+2,n+3);
  }
  for(let s=0;s<5;s++){
    const a=s/5*Math.PI*2,b=(s+1)/5*Math.PI*2,c=[.48,.35,.24];
    const n=vertex(Math.cos(a)*.045,0,Math.sin(a)*.045,.75,0,c);
    vertex(Math.cos(b)*.045,0,Math.sin(b)*.045,.9,0,c);
    vertex(Math.cos(b)*.025,.8,Math.sin(b)*.025,.9,1,c);vertex(Math.cos(a)*.025,.8,Math.sin(a)*.025,.75,1,c);
    idx.push(n,n+2,n+1,n,n+3,n+2);
  }
  const g=new BufferGeometry();g.setIndex(idx);
  g.setAttribute('position',new BufferAttribute(new Float32Array(pos),3));g.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2));
  g.setAttribute('color',new BufferAttribute(new Float32Array(col),3));
  g.setAttribute('aCanopyPhase',new InstancedBufferAttribute(new Float32Array(pool),1));g.computeVertexNormals();
  // Rounded canopy normals keep intersecting cards from reading as flat boards.
  const normal=g.getAttribute('normal');
  for(let i=0;i<48;i++){const x=pos[i*3],y=.7,z=pos[i*3+2],l=Math.hypot(x,y,z);normal.setXYZ(i,x/l,y/l,z/l);}
  return g;
}
