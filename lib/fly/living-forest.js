import { BufferGeometry, BufferAttribute, Color, DynamicDrawUsage, Group, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import { applyBendAnchor } from './toy-world/world-bend';
import { applyDaylightSurface } from './daylight-depth';
import { worldHash, LIVING_EARTH } from './living-earth';
import { useFlyStore } from '@/stores/fly-store';
import { GroundSupportView } from './ground-support-view';
import { painterlyOn, applyPainterlySurface, PAINTERLY_UNIFORMS } from './painterly-flight';
import { distributeForest } from './forest-distribution';
import { PAINTERLY } from './painterly-policy';

const WORLD=40075016.68557849,R=6378137;
const dummy=new Object3D(),color=new Color();
/** Irregular stands, with rounded crowns nearby and matching masses far away.
 * Every crown stays inside the evidence cell even after instance rotation. */
export function buildForestCluster(detail=true,painted=false) {
  const p=[],coarse=[],indices=[],colors=[],uv=[],leaf=[];
  const rings=detail?3:painted?2:1,sides=6;
  const crowns=painted&&!detail?3:9;
  for(let crown=0;crown<crowns;crown++){
    const seed=worldHash(crown,4,412),base=p.length/3;
    const angle=crown*2.3999632297,radius=crown===0?0:.12+Math.sqrt(crown/8)*.15;
    const target=detail?Math.floor(crown/3):crown,ca=target*Math.PI*2/3,cs=worldHash(target,4,412);
    const coarseX=Math.cos(ca)*.18,coarseZ=Math.sin(ca)*.18,coarseWidth=.22,coarseHeight=.72+cs*.20;
    const cx=painted&&!detail?coarseX:Math.cos(angle)*radius,cz=painted&&!detail?coarseZ:Math.sin(angle)*radius;
    const width=painted&&!detail?coarseWidth:.14+seed*.03,height=painted&&!detail?coarseHeight:.62+seed*.35;
    for(let row=0;row<=rings;row++)for(let col=0;col<sides;col++){
      const a=col*Math.PI*2/sides,phi=row/rings*Math.PI/2;
      // Same evidence-cell envelope and top/bottom in both LODs. The painted
      // coarse cluster groups nine crowns into three shouldered masses, at
      // exactly the original 54-triangle far budget. The near vertices morph
      // onto those same masses before the existing LOD switch. No new trees.
      const lobe=painted?.86+.14*worldHash(!detail?target:crown,col,817):1;
      const r=Math.cos(phi)*width*lobe;
      const lean=painted?Math.sin(phi)*width*.10*(seed-.5):0;
      p.push(cx+Math.cos(a)*r+lean,.28+Math.sin(phi)*height*.72,cz+Math.sin(a)*r);uv.push(cx+Math.cos(a)*r,cz+Math.sin(a)*r);leaf.push(1);
      const y=Math.sin(phi),shoulder=Math.SQRT1_2;
      const coarseLobe=.86+.14*worldHash(target,col,817),coarseLean=y*coarseWidth*.10*(cs-.5);
      const cr=(y<=shoulder?1+(shoulder-1)*y/shoulder:shoulder*(1-y)/(1-shoulder))*coarseWidth*coarseLobe;
      coarse.push(coarseX+Math.cos(a)*cr+coarseLean,.28+y*coarseHeight*.72,coarseZ+Math.sin(a)*cr);
      const v=painted?.76+(row/rings)*.13+seed*.055:.74+row*.065+seed*.08;colors.push(v*.88,v,v*.76);
    }
    for(let row=0;row<rings;row++)for(let col=0;col<sides;col++){
      const a=base+row*sides+col,b=base+row*sides+(col+1)%sides,c=a+sides,d=b+sides;
      if(row<rings-1)indices.push(a,c,b,b,c,d);else indices.push(a,c,b);
    }
    if(detail)for(let side=0;side<4;side++){
      const base=p.length/3,a=side*Math.PI/2,b=(side+1)*Math.PI/2,w=.005+seed*.002;
      for(const [angle,y]of [[a,.015],[b,.015],[b,.46],[a,.46]]){
        p.push(cx+Math.cos(angle)*w,y,cz+Math.sin(angle)*w);uv.push(cx,cz);colors.push(.25,.18,.105);leaf.push(0);
        coarse.push(cx+Math.cos(angle)*w,y,cz+Math.sin(angle)*w);
      }
      indices.push(base,base+2,base+1,base,base+3,base+2);
    }
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(p),3));geometry.setAttribute('color',new BufferAttribute(new Float32Array(colors),3));geometry.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2));geometry.setIndex(indices);
  geometry.setAttribute('aForestLeaf',new BufferAttribute(new Float32Array(leaf),1));
  geometry.computeVertexNormals();
  if(painted){
    const twin=new BufferGeometry();twin.setIndex(indices);twin.setAttribute('position',new BufferAttribute(new Float32Array(coarse),3));twin.computeVertexNormals();
    geometry.setAttribute('aForestCoarse',twin.attributes.position);geometry.setAttribute('aForestCoarseNormal',twin.attributes.normal);
    twin.dispose();
  }
  return geometry;
}

export class LivingForest {
  constructor(){
    this.group=new Group();this.group.name='living-forest-coverage';this.tiles=new Map();this.supportView=new GroundSupportView();
    this.geometry=buildForestCluster();this.farGeometry=buildForestCluster(false);
    this.material=new MeshStandardMaterial({color:'#a3ab93',vertexColors:true,roughness:.96,metalness:0,envMapIntensity:.45});
    applyBendAnchor(this.material);applyDaylightSurface(this.material,'canopy');
    const previous=this.material.onBeforeCompile,key=this.material.customProgramCacheKey();
    this.uniforms={uForestRadius:{value:LIVING_EARTH.forest.radiusM},uForestK:{value:1}};
    this.material.onBeforeCompile=(s,r)=>{
      previous(s,r);Object.assign(s.uniforms,this.uniforms);
      Object.assign(s.uniforms,PAINTERLY_UNIFORMS);
      s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vForestLocal;\nattribute float aForestLeaf;\nvarying float vForestLeaf;').replace('#include <begin_vertex>','#include <begin_vertex>\nvForestLocal=(instanceMatrix*vec4(position,1.0)).xyz;vForestLeaf=aForestLeaf;');
      s.vertexShader=s.vertexShader.replace('#include <common>',`#include <common>
uniform float uPainterly;uniform float uForestK;
attribute vec3 aForestCoarse;attribute vec3 aForestCoarseNormal;
float forestMorph(vec2 centre){
  vec3 p=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;
  return smoothstep(280.0,440.0,length(p.xz-centre)/max(1.0,uForestK));
}`)
        .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nif(uPainterly>.5)objectNormal=normalize(mix(objectNormal,aForestCoarseNormal,forestMorph(uBendCenter)));')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nif(uPainterly>.5)transformed=mix(transformed,aForestCoarse,forestMorph(uBendCenter));');
      s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
uniform float uForestRadius;uniform float uForestK;uniform float uPainterly;varying vec3 vForestLocal;varying float vForestLeaf;
float forestHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float forestNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(forestHash(i),forestHash(i+vec2(1,0)),f.x),mix(forestHash(i+vec2(0,1)),forestHash(i+vec2(1)),f.x),f.y);}`)
        .replace('#include <color_fragment>',`#include <color_fragment>
vec2 leafUV=vForestLocal.xz/uForestK+vForestLocal.y*vec2(.37,.53);
float leafResolved=1.-smoothstep(.3,1.4,max(length(dFdx(leafUV)),length(dFdy(leafUV))));
float leafBroad=forestNoise(leafUV*.52),leafFine=forestNoise(leafUV*2.3);
float leafRelief=(leafBroad*.7+leafFine*.3)*leafResolved;
if(uPainterly>.5){
  leafFine=mix(.5,leafBroad,.25);
  leafRelief=leafBroad*.32*leafResolved;
}
diffuseColor.rgb*=mix(1.,mix(.90,.56+leafBroad*.50+leafFine*.55,leafResolved),vForestLeaf);`)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
vec3 leafDx=dFdx(-vViewPosition),leafDy=dFdy(-vViewPosition),leafR1=cross(leafDy,normal),leafR2=cross(normal,leafDx);
float leafDet=dot(leafDx,leafR1),leafHeight=leafRelief*.18*vForestLeaf;
normal=normalize(max(abs(leafDet),.00001)*normal-sign(leafDet)*(dFdx(leafHeight)*leafR1+dFdy(leafHeight)*leafR2));
float forestRim=1.-abs(dot(normal,normalize(vViewPosition)));
if(vForestLeaf>.5&&leafResolved>.35&&forestNoise(leafUV*1.4)<(uPainterly>.5?.06+.12*forestRim:.13+.24*forestRim))discard;`);
      // Stable screen-door fade keeps depth/shadows opaque and avoids sort artifacts.
      s.fragmentShader=s.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
float forestDistance=length(vViewPosition)/uForestK;
float forestKeep=1.0-smoothstep(uForestRadius*.82,uForestRadius,forestDistance);
float forestDither=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));
if(forestDither>forestKeep)discard;`);
    };
    this.material.customProgramCacheKey=()=>`${key}-forest-coverage-v4`;
    applyPainterlySurface(this.material,'forest');
    this.stats={patches:0,tiles:0,pending:0,nearPending:0,failedSupport:0,draws:0,triangles:0};this.lastScan=-Infinity;this.turn=0;
  }
  update(surface,runtime,now){
    const painted=painterlyOn();
    if(painted&&!this.paintedGeometry){this.paintedGeometry=buildForestCluster(true,true);this.paintedFarGeometry=buildForestCluster(false,true);}
    const f=runtime.flight,k=1/Math.max(.1,Math.cos(f.latDeg*Math.PI/180));this.uniforms.uForestK.value=k;
    this.supportView.update(runtime);
    if(now-this.lastScan>.5||this.stats.sourceCommit!==surface.stats.commits||this.painted!==painted){
      this.painted=painted;
      this.lastScan=now;const keep=new Set(),band=surface.bands[2];
      for(const slot of band.slots){
        if(slot.state!=='ready'||!slot.mask?.forest)continue;
        const [,tx,ty]=slot.key.split('/').map(Number),x=tx*band.span-WORLD/2,z=ty*band.span-WORLD/2;
        const dx=Math.max(x-f.pos.x,0,f.pos.x-(x+band.span)),dz=Math.max(z-f.pos.z,0,f.pos.z-(z+band.span));
        if(Math.hypot(dx,dz)/k>LIVING_EARTH.forest.radiusM)continue;
        // Quarter tiles preserve every evidence point while keeping detailed
        // crowns local. A 2.4 km parent tile should not select near geometry
        // for thousands of trees merely because one corner is near the plane.
        for(let q=0;q<4;q++){
          const key=`${slot.key}:${q}:${painted?PAINTERLY.appearanceKey:'classic'}`;keep.add(key);if(this.tiles.has(key))continue;
          if(painted&&slot.mask.forestAppearanceKey!==PAINTERLY.appearanceKey){
            slot.mask.paintedForest=distributeForest(slot.mask,tx,ty);
            slot.mask.forestAppearanceKey=PAINTERLY.appearanceKey;
          }
          const qx=q%2,qz=Math.floor(q/2),source=painted?slot.mask.paintedForest:slot.mask.forest,values=[];
          for(let i=0;i<source.length;i+=3)if(Math.min(1,Math.floor(source[i]*2))===qx&&Math.min(1,Math.floor(source[i+1]*2))===qz)values.push(source[i]*2-qx,source[i+1]*2-qz,source[i+2]*2);
          const points=Float32Array.from(values),n=points.length/3;if(!n)continue;
          const span=band.span/2,px=x+qx*span,pz=z+qz*span;
          const mesh=new InstancedMesh(this.geometry,this.material,n);mesh.name=`forest:${key}`;mesh.position.set(px,0,pz);mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.count=0;mesh.frustumCulled=false;mesh.receiveShadow=true;
          const pending=Array.from({length:n},(_,i)=>i),distance=i=>(px+points[i*3]*span-f.pos.x)**2+(pz+points[i*3+1]*span-f.pos.z)**2;
          pending.sort((a,b)=>distance(a)-distance(b));
          this.group.add(mesh);this.tiles.set(key,{mesh,points,x:px,z:pz,span,cursor:0,pending,supportHeight:new Float32Array(n).fill(NaN),rows:[],growing:new Set(),heal:0});
        }
      }
      for(const [key,tile]of this.tiles)if(!keep.has(key)){tile.mesh.removeFromParent();tile.mesh.dispose();this.tiles.delete(key);}
      this.stats.sourceCommit=surface.stats.commits;
    }
    const start=performance.now(),tiles=[...this.tiles.values()];let checks=0;
    const sample=(x,z)=>runtime.engine.getGroundAt(x/R*180/Math.PI,(2*Math.atan(Math.exp(-z/R))-Math.PI/2)*180/Math.PI);
    // Round-robin admission cannot be starved by a far tile without DEM, or by
    // endless repairs on the first completed tile. Every fourth slot is repair.
    while(tiles.length&&checks<48&&performance.now()-start<LIVING_EARTH.forest.commitBudgetMs){
      const tile=tiles[this.turn++%tiles.length];checks++;
      // Each tile owns its repair cadence. A global modulo permanently assigns
      // every fourth tile to repairs when the tile count is divisible by four.
      tile.queries=(tile.queries??0)+1;
      if(tile.pending.length && (tile.queries%4!==0||!tile.rows.length)){
        const at=tile.cursor++%tile.pending.length,i=tile.pending[at],x=tile.x+tile.points[i*3]*tile.span,z=tile.z+tile.points[i*3+1]*tile.span;
        const g=sample(x,z),near=Math.hypot(x-f.pos.x,z-f.pos.z)/k<1000;
        if(Number.isFinite(g?.elev))tile.supportHeight[i]=g.elev;
        if(!g||!Number.isFinite(g.elev)||g.tileZ<(near?14:12)){this.stats.failedSupport++;continue;}
        tile.pending.splice(at,1);tile.cursor=at;
        const seed=worldHash(Math.round(x/4),Math.round(z/4)),row={x,z,width:tile.points[i*3+2]*tile.span,height:18+seed*14,ground:g.elev,seed,born:now,zoom:g.tileZ};
        tile.rows.push(row);tile.growing.add(tile.rows.length-1);this._place(tile,tile.rows.length-1,row,k,0);tile.mesh.count=tile.rows.length;
      } else if(tile.rows.length){
        const i=tile.heal++%tile.rows.length,row=tile.rows[i],g=sample(row.x,row.z);
        if(g&&Number.isFinite(g.elev)&&g.tileZ>=row.zoom){row.ground+=(g.elev-row.ground)*.25;row.zoom=g.tileZ;this._place(tile,i,row,k,Math.min(1,(now-row.born)/.8));}
      }
    }
    this.stats.tiles=this.tiles.size;this.stats.patches=0;this.stats.pending=0;this.stats.nearPending=0;this.stats.nearHiddenPending=0;this.stats.triangles=0;
    const tier=useFlyStore.getState().qualityTier;
    for(const t of tiles){
      const d=Math.hypot(Math.max(t.x-f.pos.x,0,f.pos.x-t.x-t.span),Math.max(t.z-f.pos.z,0,f.pos.z-t.z-t.span))/k;
      const wasDetail=t.mesh.geometry===this.geometry||t.mesh.geometry===this.paintedGeometry;
      const detail=tier!=='low'&&d<(wasDetail?600:450);
      t.mesh.geometry=painted?(detail?this.paintedGeometry:this.paintedFarGeometry):(detail?this.geometry:this.farGeometry);
      t.mesh.castShadow=detail;
      this.stats.patches+=t.mesh.count;this.stats.pending+=t.pending.length;this.stats.triangles+=t.mesh.count*t.mesh.geometry.index.count/3;
      if(d<=1000)for(const i of t.pending){
        const x=t.x+t.points[i*3]*t.span,z=t.z+t.points[i*3+1]*t.span,r=t.points[i*3+2]*t.span*.72;
        if(Math.hypot(x-f.pos.x,z-f.pos.z)<=1000*k+r){
          const elevation=Number.isFinite(t.supportHeight[i])?t.supportHeight[i]:f.groundElev;
          if(this.supportView.visible(x,z,elevation,r+80))this.stats.nearPending++;else this.stats.nearHiddenPending++;
        }
      }
      // Birth easing uses existing transforms; the geometry and its identity stay.
      for(const i of t.growing){const fade=Math.min(1,(now-t.rows[i].born)/.8);this._place(t,i,t.rows[i],k,fade);if(fade===1)t.growing.delete(i);}
    }
    this.stats.draws=[...this.tiles.values()].filter(t=>t.mesh.count).length;
    if(!painted&&this.paintedGeometry){this.paintedGeometry.dispose();this.paintedFarGeometry.dispose();this.paintedGeometry=this.paintedFarGeometry=null;}
  }
  _place(tile,i,row,k,fade=1){
    const sx=this.painted?0:(worldHash(Math.round(row.x),Math.round(row.z),712)-.5)*.035*row.width,sz=this.painted?0:(row.seed-.5)*.035*row.width;
    // Birth starts at fade=0. A zero Y scale makes three's instanced normal
    // transform divide by zero, while the flattened crown still covers pixels.
    // Those NaNs spread through bloom and black out the entire frame. Keep the
    // initial crown below ground with a finite, invertible 1 cm height instead.
    const height=Math.max(.01,row.height*fade);
    dummy.position.set(row.x-tile.x+sx,row.ground-.8,row.z-tile.z+sz);dummy.rotation.set(0,row.seed*Math.PI*2,0);dummy.scale.set(row.width,height,row.width);dummy.updateMatrix();tile.mesh.setMatrixAt(i,dummy.matrix);tile.mesh.instanceMatrix.addUpdateRange(i*16,16);tile.mesh.instanceMatrix.needsUpdate=true;
    if(!row.colorSet){color.setHSL(.225+row.seed*.045,.17+row.seed*.08,.38+row.seed*.085);tile.mesh.setColorAt(i,color);tile.mesh.instanceColor.addUpdateRange(i*3,3);tile.mesh.instanceColor.needsUpdate=true;row.colorSet=true;}
  }
  dispose(){for(const t of this.tiles.values()){t.mesh.removeFromParent();t.mesh.dispose();}this.tiles.clear();this.geometry.dispose();this.farGeometry.dispose();this.paintedGeometry?.dispose();this.paintedFarGeometry?.dispose();this.material.dispose();this.group.removeFromParent();}
}
