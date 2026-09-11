import { ARCHITECTURE_UV_PERIOD, BUILDING_PROFILES } from './building-profiles';
import { SAT_ROADS, SUBURB_NIGHT } from './fly-constants';
import { buildingEmission } from './night-lighting-policy';

const warm=[1,.75,.43], neutral=[.80,.86,1], kinds=['buildings','roads','lamps','homes','porches'];
const empty=()=>({sources:[],counts:Object.fromEntries(kinds.map(k=>[k,0])),signature:0});
const visible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
const version=a=>`${a?.version??-1}:${a?.count??0}`;

// Reject before decoding. Tile bounds require no new whole-geometry walk.
function nearChunk(c,x,z,span,margin){
  const m=c.mesh,b=m.geometry.boundingBox;
  if(b)return b.max.x+m.position.x>=x-span/2-margin&&b.min.x+m.position.x<=x+span/2+margin&&
    b.max.z+m.position.z>=z-span/2-margin&&b.min.z+m.position.z<=z+span/2+margin;
  const width=c.span??(Number.isFinite(c.tile?.z)?40075016.68557849/2**c.tile.z:null);
  return width==null||(Math.abs(m.position.x-x)<=(span+width)/2+margin&&Math.abs(m.position.z-z)<=(span+width)/2+margin);
}

/** Cache topology, not world heights. A drape heal changes Y, which is read
 * afresh at the stored bottom-wall vertex. Facade UV encodes its original
 * support-relative height: negative at a tucked base, positive at min_height.
 * Removing only its negative part recovers support without flattening bridges.
 * Run/column metadata is an optimization, never a settlement-source gate.
 */
function* buildings(c,cache){
  const g=c.mesh.geometry,p=g.attributes.position,a=g.attributes.aBendAnchor,s=g.attributes.aBuildingStyle,uv=g.attributes.uv;
  if(!p||!a||!s)return [];
  const key=`${version(a)}:${version(s)}:${version(uv)}:${p.count}:${uv?'':p.version}`,saved=cache.get(g);
  if(saved?.key===key&&saved.p===p&&saved.a===a&&saved.s===s&&saved.uv===uv)return saved.data;
  const data=[];
  if(uv&&c.drapeRuns&&c.columns?.data){
    // Worker writes a roof then bottom/top wall quads, consecutively per
    // building. Every bottom wall has the same Y; radius is already recorded.
    for(const run of c.drapeRuns){
      yield;
      const r=c.columns.data[run.column*4+3];if(!Number.isFinite(r))continue;
      for(let i=run.start;i<Math.min(run.end,p.count);i++){
        yield;if(s.getZ(i)<.5)continue;
        data.push({x:a.getX(i),z:a.getY(i),r,index:i,sink:Math.max(0,-uv.getY(i)*ARCHITECTURE_UV_PERIOD[1]),seed:Math.round(s.getY(i)),family:Math.round(s.getX(i))});break;
      }
    }
  }else{
    // Fallback for geometry without run metadata, sliced by the SAME budget.
    const groups=new Map();
    for(let i=0;i<p.count;i++){
      yield;
      const seed=Math.round(s.getY(i)),ax=a.getX(i),az=a.getY(i),id=`${ax}:${az}:${seed}`;
      let b=groups.get(id);
      if(!b){b={x:ax,z:az,r:0,seed,family:Math.round(s.getX(i)),index:-1,low:Infinity,sink:0};groups.set(id,b);}
      b.r=Math.max(b.r,Math.hypot(p.getX(i)-ax,p.getZ(i)-az));
      const wall=!uv||s.getZ(i)>=.5,localY=uv?uv.getY(i)*ARCHITECTURE_UV_PERIOD[1]:p.getY(i);
      if(wall&&localY<b.low){b.index=i;b.low=localY;b.sink=uv?Math.max(0,-localY):0;}
    }
    for(const b of groups.values()){yield;if(b.index>=0)data.push(b);}
  }
  cache.set(g,{key,data,p,a,s,uv});return data;
}

function* roads(c,cache){
  const g=c.mesh.geometry,p=g.attributes.position,a=g.attributes.aRoadArc,cls=g.attributes.aRoadCls;
  if(!p||!a||!cls)return [];
  const key=`${p.count}:${version(a)}:${version(cls)}`,saved=cache.get(g);
  if(saved?.key===key&&saved.p===p&&saved.a===a&&saved.cls===cls)return saved.data;
  const data=[];
  for(let i=0;i+3<p.count;i+=4){
    yield;const k=Math.round(cls.getX(i));if(k<1||k>6)continue;
    // Four vertices belong to ONE quad, never a guessed join across roads.
    data.push({i,cls:k,ax:(p.getX(i)+p.getX(i+1))*.5,az:(p.getZ(i)+p.getZ(i+1))*.5,
      bx:(p.getX(i+2)+p.getX(i+3))*.5,bz:(p.getZ(i+2)+p.getZ(i+3))*.5,arcA:a.getX(i),arcB:a.getX(i+2)});
  }
  cache.set(g,{key,data,p,a,cls});return data;
}

// A max-heap retains nearest candidates even when encountered late. Both its
// memory and insertion work are bounded; chunk iteration never decides winners.
const compare=(a,b)=>a.d2-b.d2||(a.id<b.id?-1:a.id>b.id?1:0);
function down(heap,i){
  for(;;){let child=i*2+1;if(child>=heap.length)return;
    if(child+1<heap.length&&compare(heap[child+1],heap[child])>0)child++;
    if(compare(heap[i],heap[child])>=0)return;
    [heap[i],heap[child]]=[heap[child],heap[i]];i=child;
  }
}
function retain(heap,s,limit){
  if(heap.length===limit){if(compare(s,heap[0])>=0)return;heap[0]=s;down(heap,0);return;}
  let i=heap.length;heap.push(s);
  while(i>0){const parent=(i-1)>>1;if(compare(heap[parent],s)>=0)break;heap[i]=heap[parent];i=parent;}
  heap[i]=s;
}

function* scan(runtime,scene,x,z,span,limit,caches){
  const scale=1/Math.max(.25,Math.cos((runtime.flight?.latDeg??0)*Math.PI/180));
  // Map iterators are live: visiting insertions across frames could keep a
  // scan open forever during fast streaming. Resident rings are bounded; take
  // their membership once and leave later arrivals for the following scan.
  const buildingChunks=[...(runtime.satBuildings?.chunks?.entries()??[])];
  const roadChunks=[...(runtime.satRoads?.chunks?.entries()??[])];
  const heaps=Object.fromEntries(kinds.map(k=>[k,[]])),counts=Object.fromEntries(kinds.map(k=>[k,0]));
  const put=(kind,px,py,pz,r,gain,color,id)=>{
    if(!Number.isFinite(px+py+pz+r+gain)||gain<=0||r<=0||limit<1)return;
    if(Math.abs(px-x)>span*.52+r||Math.abs(pz-z)>span*.52+r)return;
    retain(heaps[kind],{x:px,y:py,z:pz,r,gain,color,id,d2:(px-x)**2+(pz-z)**2},limit);
  };
  for(const [key,c] of buildingChunks){
    yield;const m=c.mesh;if(runtime.satBuildings?.chunks?.get(key)!==c||c.state!=='ready'||!m||!visible(m)||!nearChunk(c,x,z,span,52*scale))continue;
    const data=yield* buildings(c,caches.buildings);
    for(const b of data){
      yield;if(runtime.satBuildings?.chunks?.get(key)!==c||c.mesh!==m||c.state!=='ready'||!visible(m))break;
      const profile=BUILDING_PROFILES[b.family]??BUILDING_PROFILES[0],light=buildingEmission(b.seed,profile.warmth,profile.occupancy);
      if(!light.lit)continue;
      const px=m.position.x+b.x,pz=m.position.z+b.z,py=m.position.y+m.geometry.attributes.position.getY(b.index)+b.sink;
      put('buildings',px,py,pz,Math.min(52*scale,Math.max(13*scale,b.r+9*scale)),light.gain*(.12+light.occupancy*.25),light.color,`b${px}:${pz}:${b.seed}`);
    }
  }
  const segments=new Set();
  for(const [key,c] of roadChunks){
    yield;const m=c.mesh;if(runtime.satRoads?.chunks?.get(key)!==c||c.state!=='ready'||!m||!visible(m)||!nearChunk(c,x,z,span,18*scale))continue;
    const data=yield* roads(c,caches.roads),p=m.geometry.attributes.position;
    for(const b of data){
      yield;if(runtime.satRoads?.chunks?.get(key)!==c||c.mesh!==m||c.state!=='ready'||!visible(m))break;
      const ax=b.ax+m.position.x,az=b.az+m.position.z,bx=b.bx+m.position.x,bz=b.bz+m.position.z;
      if(Math.max(ax,bx)<x-span*.55||Math.min(ax,bx)>x+span*.55||Math.max(az,bz)<z-span*.55||Math.min(az,bz)>z+span*.55)continue;
      const length=Math.hypot(bx-ax,bz-az);if(length<.1||length>1000*scale)continue;
      const id=`${Math.round(ax)}:${Math.round(az)}:${Math.round(bx)}:${Math.round(bz)}`;
      if(segments.has(id))continue;segments.add(id);
      // Remove only the ribbon's decorative lift, retaining draped slopes and
      // any actual deck elevation. Do not sample DEM below a raised road.
      const ay=(p.getY(b.i)+p.getY(b.i+1))*.5+m.position.y-SAT_ROADS.liftM;
      const by=(p.getY(b.i+2)+p.getY(b.i+3))*.5+m.position.y-SAT_ROADS.liftM;
      const pieces=Math.min(40,Math.ceil(length/(24*scale)));
      for(let j=0;j<pieces;j++){yield;const t=(j+.5)/pieces;
        put('roads',ax+(bx-ax)*t,ay+(by-ay)*t,az+(bz-az)*t,14*scale,.032,neutral,`r${id}:${j}`);
      }
      if(b.cls>=4&&b.arcB>b.arcA){
        // Exactly the visible shader's 42m phase through chunk boundaries.
        for(let arc=Math.ceil(b.arcA/42)*42;arc<b.arcB;arc+=42){yield;const t=(arc-b.arcA)/(b.arcB-b.arcA);
          put('lamps',ax+(bx-ax)*t,ay+(by-ay)*t,az+(bz-az)*t,18*scale,.18,warm,`l${id}:${arc}`);
        }
      }
    }
  }
  // Incremental traversal, including independent procedural homes and porch
  // instances. Hidden subtrees contain no visibly emitting source instances.
  const stack=scene?[{node:scene,child:-1,end:scene.children.length}]:[];
  while(stack.length){
    yield;const frame=stack[stack.length-1],mesh=frame.node;
    if(!mesh.visible){stack.pop();continue;}
    if(frame.child===-1){
      frame.child=0;const parcel=mesh.userData.__parcelInit,porch=mesh.userData.__houseInit;
      if(mesh.isInstancedMesh&&mesh.count&&(parcel||porch)){
        const variant=mesh.geometry.attributes.aHomeVariant,matrix=mesh.instanceMatrix.array;
        for(let i=0;i<mesh.count;i++){
          yield;const offset=i*16;
          if(Math.hypot(matrix[offset],matrix[offset+1],matrix[offset+2])<.001)continue;
          const v=variant?Math.round(variant.getX(i)):0;if(parcel&&v===7)continue;
          const px=mesh.position.x+matrix[offset+12],pz=mesh.position.z+matrix[offset+14];
          const py=mesh.position.y+matrix[offset+13]-(porch?SUBURB_NIGHT.houseLights.liftM:0);
          put(parcel?'homes':'porches',px,py,pz,(parcel?16:10)*scale,parcel?.14:.09,
            parcel&&v%3===2?neutral:warm,`${parcel?'h':'p'}${px}:${pz}`);
        }
      }
    }
    if(frame.child>=Math.min(frame.end,mesh.children.length))stack.pop();
    else{const node=mesh.children[frame.child++];stack.push({node,child:-1,end:node.children.length});}
  }
  // Heap extraction is sliced too; a full Array.sort would merely relocate
  // the synchronous spike to the final selection stage.
  const lists={};
  for(const kind of kinds){
    const heap=heaps[kind],list=new Array(heap.length);lists[kind]=list;
    while(heap.length){yield;list[heap.length-1]=heap[0];const last=heap.pop();if(heap.length){heap[0]=last;down(heap,0);}}
  }
  const sources=[];let signature=2166136261;
  for(let i=0;sources.length<limit;i++){
    let added=false;
    for(const kind of kinds){yield;
      if(i>=lists[kind].length||sources.length>=limit)continue;
      const source=lists[kind][i];sources.push(source);counts[kind]++;added=true;
      for(const n of [source.x,source.y,source.z,source.gain*1000]){signature^=Math.round(n*4);signature=Math.imul(signature,16777619);}
    }
    if(!added)break;
  }
  return {sources,counts,signature:signature>>>0,x,z,span};
}

/** Pump once per frame, independently of texture refresh cadence. Completed
 * sources remain installed during a cold decode/heal. Every stage is bounded
 * by both a hard work count and elapsed time; weak caches do not retain tiles.
 */
export function createNightSourceCollector(){
  const caches={buildings:new WeakMap(),roads:new WeakMap()};
  let job=null,result=empty(),revision=0;
  return {
    get pending(){return job!==null;},
    start(runtime,scene,x,z,span,limit=4096){if(job)return false;job=scan(runtime,scene,x,z,span,Math.max(0,Math.floor(limit)),caches);return true;},
    step({budgetMs=.75,maxWork=1024,clock=()=>performance.now()}={}){
      const start=clock();let work=0;
      while(job&&work<maxWork&&clock()-start<budgetMs){const next=job.next();work++;if(next.done){result=next.value;job=null;revision++;}}
      return {result,revision,pending:job!==null,work,ms:clock()-start};
    },
    reset(){job=null;result=empty();revision++;},
  };
}
