import { BufferAttribute, BufferGeometry } from 'three';
import forestAtlas from '../../public/materials/forest-atlas-v1/manifest.json' with {type:'json'};
const noise=(i)=>{const x=Math.sin(i*127.1+17.7)*43758.5453;return x-Math.floor(x);};

/** Four crossed, asset-derived views per tree. 48 triangles for six trees at
 * either LOD, below the former 54-triangle far cluster. A shared atlas supplies
 * branches and needles; repeated high-poly source trees never reach the game. */
export function buildNaturalForest(detail=true,species='deciduous'){
 const p=[],uv=[],c=[],leaf=[],index=[],normal=[],row=species==='conifer'?1:0;
 const aspect=forestAtlas.sources[row].bakedAspect;
 for(let tree=0;tree<6;tree++){
  const seed=noise(tree+7),a=tree*2.39996323,r=tree===0?0:.12+Math.sqrt(tree/5)*.23;
  const x=Math.cos(a)*r,z=Math.sin(a)*r,height=.66+seed*.31,width=height*aspect*.40;
  for(let view=0;view<4;view++){
   const angle=view*Math.PI/4,dx=Math.cos(angle)*width,dz=-Math.sin(angle)*width,start=p.length/3;
   const u0=(view+.004)/4,u1=(view+.996)/4,v0=(row+.996)/2,v1=(row+.004)/2;
   for(const [sign,y,u,v]of [[-1,-height*.04,u0,v0],[1,-height*.04,u1,v0],[1,height*.96,u1,v1],[-1,height*.96,u0,v1]]){
    p.push(x+dx*sign,y,z+dz*sign);uv.push(u,v);c.push(1,1,1);leaf.push(1);
    // Rounded outward crown normal, shared by both sides of a card. This
    // removes alternating dark boards while retaining the real scene lighting.
    const nx=Math.cos(angle)*sign*.35+Math.sin(angle)*.8,nz=-Math.sin(angle)*sign*.35+Math.cos(angle)*.8,ny=.55,l=Math.hypot(nx,ny,nz);
    normal.push(nx/l,ny/l,nz/l);
   }
   index.push(start,start+1,start+2,start,start+2,start+3);
  }
 }
 const geometry=new BufferGeometry();geometry.name=`forest-atlas-${species}-${detail?'near':'far'}`;geometry.setIndex(index);
 for(const [name,values,size]of [['position',p,3],['normal',normal,3],['uv',uv,2],['color',c,3],['aForestLeaf',leaf,1]])geometry.setAttribute(name,new BufferAttribute(new Float32Array(values),size));
 geometry.computeBoundingSphere();return geometry;
}

/** Asymmetric eroded stone, 38 triangles. Scrub keeps its existing geometry. */
export function buildNaturalStone(){
 const p=[],c=[],idx=[],sides=8;
 for(let ring=0;ring<3;ring++)for(let s=0;s<sides;s++){
  const a=s*Math.PI*2/sides+.13*ring,r=(ring===0?.38:ring===1?.5:.28)*(.88+noise(s*5+ring)*.22);
  p.push(Math.cos(a)*r+.06*ring,ring===0?-.08:ring===1?.33+noise(s)*.12:.72+noise(s+71)*.13,Math.sin(a)*r);
  const shade=.66+ring*.11+noise(s+ring)*.08;c.push(shade,shade,shade);
 }
 for(let ring=0;ring<2;ring++)for(let s=0;s<sides;s++){const a=ring*sides+s,b=ring*sides+(s+1)%sides;idx.push(a,a+sides,b,b,a+sides,b+sides);}
 for(let s=1;s<sides-1;s++)idx.push(16,16+s,16+s+1);
 const g=new BufferGeometry();g.setIndex(idx);g.setAttribute('position',new BufferAttribute(new Float32Array(p),3));g.setAttribute('color',new BufferAttribute(new Float32Array(c),3));g.computeVertexNormals();return g;
}
