/** Original Skyloom fleet. No third-party meshes/textures. Rebuild with Node.
 * Smooth lofted hulls, cambered wings, recessed engines and articulated surfaces.
 * Geometry is authored in normalized airframe lengths; export is in metres. */
import fs from 'node:fs';
import {finishAircraft,station} from './aircraft-surface.mjs';
import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,SphereGeometry,CylinderGeometry,TorusGeometry,BoxGeometry,Vector3,Quaternion} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FLEET_PRESENTATION} from '../lib/fly/fleet-aircraft.mjs';
globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}};

function build(def,low){
  const root=new Group(),L=def.length,n=low?12:28;
  root.name=`Skyloom ${def.slug}`;root.userData={author:'Skyloom',license:'MIT',revision:3,lod:low?'mobile':'hero',units:'metres',nose:'-Z'};
  const mats=Object.fromEntries(Object.entries({...def.colors,metal:'#6d7d83',dark:'#12242c',glass:'#244858',cabin:'#132c3c'}).map(([name,color])=>[name,new MeshStandardMaterial({name,color,roughness:name==='cabin'?.7:name==='glass'?.14:name==='metal'?.28:.38,metalness:name==='cabin'?0:name==='metal'?.75:name==='glass'?.3:.12})]));
  const buckets=Object.fromEntries(Object.keys(mats).map(k=>[k,[]]));
  function add(g,role='hull',pos=[0,0,0],rot=[0,0,0],part=null){g.rotateX(rot[0]);g.rotateY(rot[1]);g.rotateZ(rot[2]);g.translate(...pos);g.scale(L,L,L);const p=g.index?g.toNonIndexed():g;p.deleteAttribute('uv');if(part){const mesh=new Mesh(p,mats[role]);part.add(mesh);}else buckets[role].push(p);}
  function ball(pos,size,role='hull'){const detail=Math.max(...size)>.02;const g=new SphereGeometry(1,detail?n:low?6:8,detail?(low?8:16):4);g.scale(...size);add(g,role,pos);}
  function rod(a,b,r,role='trim'){const va=new Vector3(...a),vb=new Vector3(...b),g=new CylinderGeometry(r,r,va.distanceTo(vb),low?3:4);g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),vb.clone().sub(va).normalize()));add(g,role,va.add(vb).multiplyScalar(.5).toArray());}
  function loft(sections,role='hull',x=0,y=0){
    const source=sections.map(r=>[...r.slice(0,3),r[3]||0]),count=sections.length>6?(low?14:32):(low?4:14);
    const zs=[...new Set([...source.map(s=>s[0]),...Array.from({length:count},(_,i)=>source[0][0]+(source.at(-1)[0]-source[0][0])*i/(count-1))])].sort((a,b)=>a-b),p=[],ix=[];
    for(const z of zs){const [rx,ry,cy]=station(source,z);for(let j=0;j<n;j++){const a=j/n*Math.PI*2;p.push(x+Math.cos(a)*rx,y+cy+Math.sin(a)*ry,z);}}
    for(let i=0;i<zs.length-1;i++)for(let j=0;j<n;j++){const a=i*n+j,b=i*n+(j+1)%n,c=a+n,d=b+n;ix.push(a,b,c,b,d,c);}
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();add(g,role);
  }
  // Closed polygon prism. Winding is corrected against the requested outward face.
  function prism(points,thickness,role='hull',vertical=false,part=null){const p=[],ix=[],s=points.length;for(const d of [-1,1])for(const [x,y,z] of points)p.push(x+(vertical?d*thickness/2:0),y+(vertical?0:d*thickness/2),z);for(let i=1;i<s-1;i++)ix.push(0,i+1,i,s,s+i,s+i+1);for(let i=0;i<s;i++){const j=(i+1)%s;ix.push(i,j,s+i,j,s+j,s+i);}const a=new Vector3(...points[2]).sub(new Vector3(...points[0])),b=new Vector3(...points[1]).sub(new Vector3(...points[0]));if(a.cross(b).getComponent(vertical?0:1)>0)for(let i=0;i<ix.length;i+=3)[ix[i+1],ix[i+2]]=[ix[i+2],ix[i+1]];const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();add(g,role,[0,0,0],[0,0,0],part);}
  // Airfoil rings, with rounded leading edge and tapered trailing edge.
  function wing(stations,side,role='hull',part=null,pivot=[0,0,0],u0=0,u1=1){
    const p=[],ix=[],steps=low?6:16;
    for(const [span,lead,chord,y,thick] of stations){for(let j=0;j<steps*2;j++){
      const a=j/(steps*2)*Math.PI*2,u=u0+(u1-u0)*(1-Math.cos(a))/2;
      const h=thick*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)/.1;
      p.push(side*span,y+(j<=steps?1:-1)*h+Math.sin(u*Math.PI)*thick*.055,lead+u*chord);
    }}
    const stride=steps*2;
    for(let i=0;i<stations.length-1;i++)for(let j=0;j<stride;j++){const a=i*stride+j,b=i*stride+(j+1)%stride,c=a+stride,d=b+stride;ix.push(a,b,c,b,d,c);}
    for(const [k,flip] of [[0,true],[stations.length-1,false]]){const c=p.length/3,row=stations[k];p.push(side*row[0],row[3],row[1]+row[2]*(u0+u1)*.5);for(let j=0;j<stride;j++){const a=k*stride+j,b=k*stride+(j+1)%stride;flip?ix.push(c,b,a):ix.push(c,a,b);}}
    if(side<0)for(let i=0;i<ix.length;i+=3)[ix[i+1],ix[i+2]]=[ix[i+2],ix[i+1]];
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();g.translate(...pivot.map(v=>-v));add(g,role,[0,0,0],[0,0,0],part);
  }
  function moving(name,points,pivot,vertical=false,role='hull'){const group=new Group();group.name=name;group.position.set(...pivot.map(v=>v*L));root.add(group);prism(points.map(p=>p.map((v,i)=>v-pivot[i])),.0025,role,vertical,group);}
  function cockpit(z,rx,ry,rz,y){
    const shape=[[-1,.015,.01],[-.8,.5,.48],[-.4,.91,.88],[0,1,1],[.52,.78,.78],[.83,.38,.38],[1,.01,.01]];
    const rows=low?8:20,arc=low?8:20,p=[],ix=[];
    const point=(u,a)=>{const [w,h]=station(shape,u);return[Math.cos(a)*rx*w,y+Math.sin(a)*ry*h,z+u*rz];};
    for(let k=0;k<=rows;k++)for(let j=0;j<=arc;j++)p.push(...point(-1+k/rows*2,j/arc*Math.PI));
    for(let k=0;k<rows;k++)for(let j=0;j<arc;j++){const a=k*(arc+1)+j,b=a+1,c=a+arc+1,d=c+1;ix.push(a,b,c,b,d,c);}
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();add(g,'glass');
    for(const u of [-.55,.66]){let last;for(let j=0;j<=12;j++){const q=point(u,j/12*Math.PI);q[1]+=.0006;if(last)rod(last,q,.0010,'trim');last=q;}}
    for(const a of [0,Math.PI]){let last;for(let j=0;j<=rows;j++){const q=point(-1+j/rows*2,a);q[1]+=.0004;if(last)rod(last,q,.0011,'trim');last=q;}}
  }
  function engine(x,y,z,r,length){
    const front=z-length/2,back=z+length/2;
    loft([[front,r*.88,r*.88],[front+length*.08,r*.97,r*.97],[front+length*.24,r,r],[front+length*.65,r*.91,r*.91],[back,r*.68,r*.68]],'hull',x,y);
    add(new TorusGeometry(r*.865,r*.035,low?4:6,n),'metal',[x,y,front]);
    const duct=new CylinderGeometry(r*.82,r*.73,length*.25,n,1,true),indices=duct.index.array;
    for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];duct.computeVertexNormals();
    add(duct,'dark',[x,y,front+length*.125],[Math.PI/2,0,0]);
    add(new CylinderGeometry(r*.74,r*.74,.001,n),'dark',[x,y,front+length*.27],[Math.PI/2,0,0]);
    ball([x,y,front+length*.235],[r*.19,r*.19,r*.26],'metal');
    // Swept fan blades, not thick radial spokes. All blades merge into metal.
    const blades=low?14:28,fanZ=front+length*.245;
    for(let i=0;i<blades;i++){
      const a=i/blades*Math.PI*2,point=(rad,angle,dz)=>[x+Math.cos(angle)*r*rad,y+Math.sin(angle)*r*rad,fanZ+dz];
      const q=[point(.20,a,0),point(.75,a+.31,-r*.04),point(.75,a+.44,-r*.035),point(.23,a+.2,r*.025)];
      const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(q.flat(),3));g.setIndex([0,2,1,0,3,2]);g.computeVertexNormals();add(g,'metal');
    }
    add(new TorusGeometry(r*.65,r*.025,4,n),'metal',[x,y,back]);
    const lining=new CylinderGeometry(r*.62,r*.43,length*.18,n,1,true),ids=lining.index.array;
    for(let i=0;i<ids.length;i+=3)[ids[i+1],ids[i+2]]=[ids[i+2],ids[i+1]];lining.computeVertexNormals();
    add(lining,'dark',[x,y,back-length*.09],[Math.PI/2,0,0]);
    add(new CylinderGeometry(r*.45,r*.45,.001,n),'dark',[x,y,back-length*.18],[Math.PI/2,0,0]);
    ball([x,y,back-length*.09],[r*.22,r*.22,length*.10],'metal');
    if(!low)for(const offset of [.34]){let last;for(let j=0;j<=n;j++){const a=j/n*Math.PI*2,q=[x+Math.cos(a)*r*(offset<.5?.991:.895),y+Math.sin(a)*r*(offset<.5?.991:.895),front+length*offset];if(last)rod(last,q,.00027,'trim');last=q;}}
  }
  const heavy=['widebody','freighter','business'].includes(def.type),glider=def.type==='sailplane',prop=['high-wing','warbird'].includes(def.type),high=def.type==='high-wing',war=def.type==='warbird',delta=def.type==='delta',twin=def.type==='twin-jet';
  const r=heavy?(def.type==='business'?.047:def.type==='freighter'?.052:.052):glider?.020:high?.056:war?.055:.058;
  const body=heavy?[[-.5,.001,.001],[-.48,r*.5,r*.56],[-.44,r*.86,r*.91],[-.37,r,r],[-.2,r,r],[.16,r,r],[.32,r*.91,r*.92],[.43,r*.47,r*.47],[.50,.002,.003]]:
    prop?[[-.5,.002,.002],[-.455,r*.7,r*.68],[-.38,r*.94,r*.99],[-.25,r,r],[-.04,r*.94,r*.96],[.15,r*.7,r*.77],[.34,r*.3,r*.4],[.48,.009,.014],[.5,.001,.001]]:
    [[-.5,.001,.001],[-.44,r*.3,r*.45],[-.34,r*.74,r*.79],[-.2,r,r*.94],[.06,r,r],[.26,r*.78,r*.85],[.43,r*.4,r*.52],[.5,.002,.004]];
  if(def.type==='freighter'){
    // Blend the upper deck into the main shell rather than intersecting two
    // hulls. Belly stations stay fixed; the front crown rises smoothly.
    const crown=[[-.5,0],[-.48,.004],[-.44,.019],[-.37,.029],[-.2,.026],[-.10,.010],[0,0],[.5,0]];
    const original=body.map(q=>[...q.slice(0,3),q[3]||0]);
    const zs=[...new Set([...body.map(q=>q[0]),-.10,0])].sort((a,b)=>a-b);
    body.splice(0,body.length,...zs.map(z=>{const [rx,ry,cy]=station(original,z),[rise]=station(crown,z);return[z,rx,ry+rise/2,cy+rise/2];}));
  }
  if(high)body.splice(0,body.length,...[[-.5,.002,.002,0],[-.46,.035,.031,0],[-.36,.050,.041,.004],[-.28,.055,.063,.015],[-.20,.056,.069,.020],[-.07,.053,.063,.018],[.03,.044,.044,.009],[.18,.030,.029,0],[.38,.013,.017,0],[.5,.001,.001,0]]);
  if(war)body.splice(0,body.length,...[[-.5,.001,.001],[-.45,.031,.033],[-.39,.047,.049],[-.27,.055,.060],[-.12,.052,.054],[.03,.045,.051],[.22,.029,.036],[.4,.012,.019],[.5,.001,.001]]);
  loft(body);
  // Cabin glazing follows the hull surface; raised ellipsoids look like beads.
  function windowPatch(side,y,z,hy,hz,role='cabin',offset=.0007){
    const outline=[[-.65,-1],[.65,-1],[1,-.65],[1,.65],[.65,1],[-.65,1],[-1,.65],[-1,-.65]].map(([a,b])=>[y+a*hy,z+b*hz]);
    const base=buckets.hull[0],pp=base.attributes.position,nn=base.attributes.normal,p=[],norm=[];
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    for(let i=0;i<pp.count;i+=3){
      const pts=[0,1,2].map(k=>new Vector3().fromBufferAttribute(pp,i+k).multiplyScalar(1/L));
      if(pts.every(p=>p.y<y-hy)||pts.every(p=>p.y>y+hy)||pts.every(p=>p.z<z-hz)||pts.every(p=>p.z>z+hz))continue;
      const face=new Vector3().subVectors(pts[1],pts[0]).cross(new Vector3().subVectors(pts[2],pts[0])).normalize();if(face.x*side<.01)continue;
      let poly=pts.map((q,k)=>({p:q,n:new Vector3().fromBufferAttribute(nn,i+k)}));
      for(let e=0;e<outline.length&&poly.length;e++){
        const a=outline[e],b=outline[(e+1)%outline.length],out=[];
        for(let j=0;j<poly.length;j++){const p=poly[j],q=poly[(j+1)%poly.length],u=cross(a,b,[p.p.y,p.p.z]),v=cross(a,b,[q.p.y,q.p.z]);if(u>=0)out.push(p);if((u>=0)!==(v>=0)){const t=u/(u-v);out.push({p:p.p.clone().lerp(q.p,t),n:p.n.clone().lerp(q.n,t).normalize()});}}poly=out;
      }
      for(let j=1;j<poly.length-1;j++){
        const q=[poly[0],poly[j],poly[j+1]];if(q[1].p.clone().sub(q[0].p).cross(q[2].p.clone().sub(q[0].p)).lengthSq()<1e-18)continue;
        for(const v of q){p.push(...v.p.clone().addScaledVector(v.n,offset).toArray());norm.push(...v.n.toArray());}
      }
    }
    if(p.length){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setAttribute('normal',new Float32BufferAttribute(norm,3));add(g,role);}
  }
  const span=def.span/L/2,wy=high?.095:glider?.012:heavy?-.025:-.018,lead=high?-.15:war?-.11:glider?-.095:-.12;
  const sweep=high?.015:war?.035:glider?.024:delta?.36:twin?.24:heavy?.26:.1;
  const chord=high?.18:war?.24:glider?.105:delta?.48:twin?.39:.28;
  const tipChord=glider?.032:high?.13:war?.12:delta?.018:twin?.085:.08;
  for(const side of [-1,1]){
    const stations=war?[[r*.5,lead,chord,wy,.015],[span*.38,lead+.006,.22,wy+.008,.012],[span*.76,lead+.025,.18,wy+.022,.007],[span*.94,lead+.060,.105,wy+.032,.003],[span,lead+.095,.036,wy+.035,.0015]]:
      [[r*.5,lead,chord,wy,heavy?.014:glider?.007:.017],[span*.38,lead+sweep*.30,chord*.82,wy+.009,glider?.005:.011],[span*.70,lead+sweep*.66,chord*.48,wy+.025,glider?.0035:.006],[span,lead+sweep,tipChord,wy+.035,glider?.0018:.0025]];
    const a=span*.60,b=span*.94,sa=[a,...station(stations,a)],sb=[b,...station(stations,b)];
    wing([...stations.filter(q=>q[0]<a),sa],side);
    wing([sa,...stations.filter(q=>q[0]>a&&q[0]<b),sb],side,'hull',null,[0,0,0],0,.76);
    wing([sb,...stations.filter(q=>q[0]>b)],side);
    const hinge=[side*a,sa[3],sa[1]+sa[2]*.775],aileron=new Group();aileron.name='aileron-'+(side<0?'left':'right');aileron.position.set(...hinge.map(v=>v*L));root.add(aileron);
    wing([sa,...stations.filter(q=>q[0]>a&&q[0]<b),sb],side,'hull',aileron,hinge,.79,1);
    if(heavy||glider){
      const z=lead+sweep,y=wy+.035,h=glider?.035:def.type==='business'?.085:.065;
      prism([[side*span,y,z],[side*(span-.004),y+h*.45,z+.018],[side*(span-.008),y+h,z+.055],[side*(span-.008),y+h,z+.085],[side*span,y,z+tipChord]],.002,'trim',true);
    }
    if(heavy&&!low)for(const t of [.38,.60,.78]){
      const x=span*t,[le,c,y]=station(stations,x),z=le+c;
      prism([[side*x,y-.010,z-.05],[side*x,y-.022,z-.015],[side*x,y-.016,z+.012],[side*x,y-.009,z+.025]],.008,'hull',true);
    }
    const tailY=def.type==='business'?.19:high?.025:.025,tailSpan=glider?.20:heavy?.22:prop?.22:.23;
    const tailRows=[[r*.3,.33,.145,tailY,.009],[tailSpan,.395,.07,tailY+.013,.0035]];
    wing(tailRows,side,'hull',null,[0,0,0],0,.76);
    const ep=[0,tailY,.443],elevator=new Group();elevator.name='elevator-'+(side<0?'left':'right');elevator.position.set(...ep.map(v=>v*L));root.add(elevator);wing(tailRows,side,'hull',elevator,ep,.79,1);
    // Small recognition panels preserve the house liveries without thick caps.
    wing([[span*.93,lead+sweep*.80+.018,tipChord*.30,wy+.033,.002],[span*.985,lead+sweep*.96+.01,tipChord*.32,wy+.037,.002]],side,'accent');
    if(high){rod([side*.04,-.035,.02],[side*span*.59,wy-.009,-.04],.0024,'metal');}
  }
  if(twin){for(const side of [-1,1]){prism([[side*.062,.025,.20],[side*.112,.21,.35],[side*.121,.18,.43],[side*.075,.03,.42]],.004,'hull',true);moving(`rudder-${side<0?'left':'right'}`,[[side*.075,.03,.425],[side*.121,.18,.435],[side*.123,.18,.472],[side*.075,.03,.46]],[side*.075,.03,.425],true,heavy?'trim':'hull');engine(side*.060,-.010,.30,.041,.28);
      // Trapezoidal inlet lip and chine fairing distinguish the twin-jet body.
      const x=side*.064,z=-.125;
      prism([[side*.035,.018,-.22],[side*.102,.012,z],[side*.116,.003,.22],[side*.042,.025,.26]],.008,'hull');
      prism([[x-side*.028,.020,z],[x+side*.037,.020,z+.018],[x+side*.037,-.042,z+.018],[x-side*.028,-.038,z]],.003,'dark',true);
      rod([x-side*.028,.021,z-.002],[x+side*.037,.021,z+.016],.002,'metal');}}
  else{const finHeight=glider?.16:high?.19:heavy?.205:.22;prism([[0,.02,.27],[0,finHeight,.37],[0,finHeight*.98,.435],[0,.025,.46]],.005,heavy?'trim':'hull',true);moving('rudder',[[0,.025,.461],[0,finHeight*.98,.436],[0,finHeight*.93,.485],[0,.03,.50]],[0,.025,.46],true,'accent');}
  if(heavy){
    // Wraparound cockpit and regular inset cabin windows, clearly separate from paint.
    for(const side of [-1,1]){windowPatch(side,def.type==='freighter'?.042:.027,-.442,.008,.014);windowPatch(side,def.type==='freighter'?.051:.030,-.413,.008,.011);
      const count=def.type==='business'?7:def.type==='freighter'?9:27;
      for(let i=0;i<count;i++)windowPatch(side,.018,-.32+i*(def.type==='business'?.077:.023),.0052,.0037);
      for(const z of [-.36,.30]){windowPatch(side,.004,z,.027,.012,'trim');windowPatch(side,.004,z,.0255,.0105,'hull',.0012);}
      rod([side*r*.997,-.009,-.35],[side*r*.997,-.009,.27 ],.0011,'accent');
      if(def.type==='business'){prism([[side*.035,.015,.23],[side*.14,.035,.25],[side*.14,.028,.33],[side*.035,.01,.34]],.01);engine(side*.13,.026,.295,.039,.195);}
      else{const xs=def.type==='freighter'?[.16,.29]:[.19];for(const x of xs){const z=-.11+x*.45;prism([[side*x,-.025,z-.018],[side*x,-.075,z-.08],[side*x,-.071,z+.1],[side*x,-.018,z+.09]],.009,'metal',true);engine(side*x,-.087,z,.036,.15);} }
    }

  }else{
    if(high){
      // Enclosed utility cabin: sloped windscreen, two side windows, door seams.
      for(const side of [-1,1]){
        windowPatch(side,.056,-.253,.022,.036,'glass',.0012);
        windowPatch(side,.059,-.163,.023,.039,'glass',.0012);
        windowPatch(side,.047,-.063,.019,.025,'glass',.0012);
        windowPatch(side,.011,-.17,.052,.046,'trim',.0007);
        windowPatch(side,.010,-.17,.049,.043,'hull',.0010);
        windowPatch(side,.059,-.163,.023,.039,'glass',.0015);
        rod([side*.056,.014,-.136],[side*.056,.014,-.116],.0013,'metal');
      }
    }else cockpit(glider?-.22:war?-.10:-.22,glider?.020:war?.036:.034,glider?.027:war?.038:.036,glider?.125:war?.104:.13,r*.82);
    if(delta){engine(0,0,.34,.042,.18);for(const side of [-1,1]){
      loft([[-.22,.001,.001],[-.19,.018,.032],[-.10,.023,.034],[.11,.015,.025],[.24,.001,.001]],'hull',side*.053,-.008);
      add(new CylinderGeometry(.023,.022,.006,low?8:16),'dark',[side*.054,-.008,-.178],[Math.PI/2,0,0]);
    }}
    if(high)for(const side of [-1,1])for(let k=0;k<4;k++)rod([side*.046,-.006,-.37+k*.015],[side*.046,.012,-.375+k*.015],.0016,'dark');
    if(war){loft([[.015,.029,.014,-.05],[.08,.033,.028,-.051],[.21,.029,.020,-.047],[.24,.005,.004,-.046]],'trim');for(const side of [-1,1])for(let i=0;i<5;i++)add(new CylinderGeometry(.004,.004,.018,6),'metal',[side*.057,.012,-.34+i*.018],[0,0,Math.PI/2]);}
  }
  if(prop){const spinner=new SphereGeometry(1,n,low?8:16);spinner.scale(.029,.029,.047);add(spinner,'accent',[0,0,-.447]);
    const rotating=new Group();rotating.name='propeller';rotating.position.z=-.452*L;root.add(rotating);const count=war?4:2;
    for(let i=0;i<count;i++){
      const angle=i/count*Math.PI*2,outline=[[-.003,.015],[.008,.035],[.011,.085],[.007,.132],[.001,.148],[-.004,.145],[-.008,.115],[-.006,.055]];
      const pts=outline.map(([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle),.014*(1-y/.15)]);
      // The blades live in the named spinning group and retain their controls.
      const g=new BufferGeometry(),v=[];for(const d of [-.001,.001])for(const q of pts)v.push(q[0],q[1],q[2]+d);
      const ix=[],n=pts.length;for(let j=1;j<n-1;j++)ix.push(0,j+1,j,n,n+j,n+j+1);for(let j=0;j<n;j++){const k=(j+1)%n;ix.push(j,k,n+j,k,n+k,n+j);}g.setAttribute('position',new Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();add(g,'trim',[0,0,0],[0,0,0],rotating);
      const tip=new BoxGeometry(.007,.009,.002);tip.translate(0,.137,-.001);tip.rotateZ(angle);add(tip,'accent',[0,0,0],[0,0,0],rotating);
    }
    for(const side of [-1,1])ball([side*.027,-.015,-.425],[.015,.012,.008],'dark');
  }
  // Conformal service seams: narrow, restrained and cheaper on mobile.
  const shell=(theta,z,lift=.00035)=>{const [rx,ry,cy]=station(body.map(q=>[...q.slice(0,3),q[3]||0]),z);return[Math.cos(theta)*(rx+lift),cy+Math.sin(theta)*(ry+lift),z];};
  for(const z of (low?[-.38,.30]:[-.38,-.27,.18,.32])){let last;for(let j=0;j<=n;j++){const q=shell(j/n*Math.PI*2,z);if(last)rod(last,q,.00022,'trim');last=q;}}
  if(!low)for(const side of [-1,1]){
    for(const z of heavy?[-.32,.25]:[-.32,.13]){
      const theta=side>0?.40:Math.PI-.40;
      const outline=[[-.12,-.009],[.12,-.009],[.12,.009],[-.12,.009],[-.12,-.009]];
      let last;for(const [a,dz]of outline){const q=shell(theta+a,z+dz,.00065);if(last)rod(last,q,.0003,'trim');last=q;}
    }
  }
  // Large maintenance seams, aerial and navigation lenses; no micro-detail noise.
  if(!glider)rod([0,r*.92,.04],[0,r+.036,.09],.002,'trim');
  for(const side of [-1,1])ball([side*span,wy+.038,lead+sweep+tipChord*.6],[.004,.003,.009],side<0?'accent':'glass');
  for(const [role,list] of Object.entries(buckets))if(list.length){const mesh=new Mesh(mergeGeometries(list),mats[role]);mesh.name=role;root.add(mesh);}
  const propeller=root.getObjectByName('propeller');
  if(propeller){for(const role of ['trim','accent']){const meshes=propeller.children.filter(m=>m.material===mats[role]);const merged=new Mesh(mergeGeometries(meshes.map(m=>m.geometry)),mats[role]);meshes.forEach(m=>propeller.remove(m));propeller.add(merged);}}
  finishAircraft(root,{military:twin||delta,bareMetal:war});
  root.updateMatrixWorld(true);let triangles=0,draws=0;root.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;draws++;}});
  return {root,triangles,draws};
}
function thumbnail(root){
  const faces=[];root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh)return;const geometry=o.geometry.index?o.geometry.toNonIndexed():o.geometry,pos=geometry.attributes.position,v=new Vector3();for(let i=0;i<pos.count;i+=3){const points=[],depth=[];for(let j=0;j<3;j++){v.fromBufferAttribute(pos,i+j).applyMatrix4(o.matrixWorld);points.push([v.x*.87+v.z*.5,v.x*.19-v.y*.92-v.z*.33]);depth.push(-v.x*.46-v.y*.4+v.z*.79);}faces.push({points,depth:depth.reduce((a,b)=>a+b,0)/3,color:`#${o.material.color.getHexString()}`});}});
  const pts=faces.flatMap(f=>f.points),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY;
  const scale=Math.min(220/w,98/h),x=(240-w*scale)/2,y=(120-h*scale)/2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><title>${root.name}</title>${faces.sort((a,b)=>b.depth-a.depth).map(f=>`<path fill="${f.color}" d="M${f.points.map(p=>`${((p[0]-minX)*scale+x).toFixed(1)},${((p[1]-minY)*scale+y).toFixed(1)}`).join('L')}Z"/>`).join('')}</svg>`;
}
const exporter=new GLTFExporter(),receipt=[];
// `custom` airframes (the Umbra) have their own builder; keep their files and receipt rows.
const customRows=JSON.parse(fs.readFileSync('public/models/adventure-fleet-v1.json','utf8')).filter(r=>FLEET_PRESENTATION[r.id]?.custom);
for(const def of Object.values(FLEET_PRESENTATION).filter(d=>!d.custom))for(const low of [false,true]){
  const {root,triangles,draws}=build(def,low);if(triangles>(low?4800:18000))throw Error(`${def.slug} has no gear budget: ${triangles}`);
  const url=low?def.mobileUrl:def.url,data=await exporter.parseAsync(root,{binary:true});fs.writeFileSync(`public${url}`,Buffer.from(data));
  if(low)fs.writeFileSync(`public${def.thumbnail}`,thumbnail(root));receipt.push({id:def.id,lod:low?'mobile':'hero',url,triangles,draws,bytes:data.byteLength});
}
fs.writeFileSync('public/models/adventure-fleet-v1.json',JSON.stringify([...receipt,...customRows],null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
const vector=fs.readFileSync('public/models/player-vector-mobile-v4.glb');
const vectorScene=await new GLTFLoader().parseAsync(vector.buffer.slice(vector.byteOffset,vector.byteOffset+vector.byteLength),'');
fs.writeFileSync('public/models/player-vector-v4.svg',thumbnail(vectorScene.scene));
