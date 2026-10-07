/** Original Skyloom fleet. No third-party meshes/textures. Rebuild with Node.
 * Smooth lofted hulls, cambered wings, recessed engines and articulated surfaces.
 * Geometry is authored in normalized airframe lengths; export is in metres. */
import fs from 'node:fs';
import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,SphereGeometry,CylinderGeometry,TorusGeometry,BoxGeometry,Vector3,Quaternion} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FLEET_PRESENTATION} from '../lib/fly/fleet-aircraft.mjs';
globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}};

function build(def,low){
  const root=new Group(),L=def.length,n=low?12:24;
  root.name=`Skyloom ${def.slug}`;root.userData={author:'Skyloom',license:'MIT',revision:1,lod:low?'mobile':'hero',units:'metres',nose:'-Z'};
  const mats=Object.fromEntries(Object.entries({...def.colors,metal:'#6d7d83',dark:'#12242c',glass:'#244858',cabin:'#132c3c'}).map(([name,color])=>[name,new MeshStandardMaterial({name,color,roughness:name==='cabin'?.7:name==='glass'?.14:name==='metal'?.28:.38,metalness:name==='cabin'?0:name==='metal'?.75:name==='glass'?.3:.12})]));
  const buckets=Object.fromEntries(Object.keys(mats).map(k=>[k,[]]));
  function add(g,role='hull',pos=[0,0,0],rot=[0,0,0],part=null){g.rotateX(rot[0]);g.rotateY(rot[1]);g.rotateZ(rot[2]);g.translate(...pos);g.scale(L,L,L);const p=g.index?g.toNonIndexed():g;p.deleteAttribute('uv');if(part){const mesh=new Mesh(p,mats[role]);part.add(mesh);}else buckets[role].push(p);}
  function ball(pos,size,role='hull'){const detail=Math.max(...size)>.02;const g=new SphereGeometry(1,detail?n:low?6:8,detail?(low?8:16):4);g.scale(...size);add(g,role,pos);}
  function rod(a,b,r,role='trim'){const va=new Vector3(...a),vb=new Vector3(...b),g=new CylinderGeometry(r,r,va.distanceTo(vb),low?4:6);g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),vb.clone().sub(va).normalize()));add(g,role,va.add(vb).multiplyScalar(.5).toArray());}
  function loft(sections,role='hull',x=0,y=0){const p=[],ix=[];for(const [z,rx,ry,cy=0] of sections)for(let j=0;j<=n;j++){const a=j/n*Math.PI*2;p.push(x+Math.cos(a)*rx,y+cy+Math.sin(a)*ry,z);}for(let i=0;i<sections.length-1;i++)for(let j=0;j<n;j++){const a=i*(n+1)+j,b=a+n+1;ix.push(a,a+1,b,b,a+1,b+1);}const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();add(g,role);}
  // Closed polygon prism. Winding is corrected against the requested outward face.
  function prism(points,thickness,role='hull',vertical=false,part=null){const p=[],ix=[],s=points.length;for(const d of [-1,1])for(const [x,y,z] of points)p.push(x+(vertical?d*thickness/2:0),y+(vertical?0:d*thickness/2),z);for(let i=1;i<s-1;i++)ix.push(0,i+1,i,s,s+i,s+i+1);for(let i=0;i<s;i++){const j=(i+1)%s;ix.push(i,j,s+i,j,s+j,s+i);}const a=new Vector3(...points[2]).sub(new Vector3(...points[0])),b=new Vector3(...points[1]).sub(new Vector3(...points[0]));if(a.cross(b).getComponent(vertical?0:1)>0)for(let i=0;i<ix.length;i+=3)[ix[i+1],ix[i+2]]=[ix[i+2],ix[i+1]];const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();add(g,role,[0,0,0],[0,0,0],part);}
  // Airfoil rings, with rounded leading edge and tapered trailing edge.
  function wing(stations,side,role='hull'){const p=[],ix=[],steps=low?6:12;for(const [span,lead,chord,y,thick] of stations){for(let j=0;j<=steps*2;j++){const a=j/(steps*2)*Math.PI*2,u=(1-Math.cos(a))/2;p.push(side*span,y+Math.sin(a)*thick*.5+Math.sin(u*Math.PI)*thick*.13,lead+u*chord);}}const stride=steps*2+1;for(let i=0;i<stations.length-1;i++)for(let j=0;j<stride-1;j++){const a=i*stride+j,b=a+stride;ix.push(a,a+1,b,b,a+1,b+1);}if(side<0)for(let i=0;i<ix.length;i+=3)[ix[i+1],ix[i+2]]=[ix[i+2],ix[i+1]];const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();add(g,role);}
  function moving(name,points,pivot,vertical=false,role='hull'){const group=new Group();group.name=name;group.position.set(...pivot.map(v=>v*L));root.add(group);prism(points.map(p=>p.map((v,i)=>v-pivot[i])),.006,role,vertical,group);}
  function cockpit(z,rx,ry,rz,y){ball([0,y,z],[rx,ry,rz],'glass');for(const zz of [-.45,.5]){const dz=zz*rz,r=Math.sqrt(1-zz*zz);let last=null;for(let i=0;i<=8;i++){const a=i/8*Math.PI,p=[Math.cos(a)*rx*r*1.015,y+Math.sin(a)*ry*r*1.02,z+dz];if(last)rod(last,p,.0022);last=p;}}for(const side of [-1,1]){let last=null;for(let i=0;i<=12;i++){const a=i/12*Math.PI,p=[side*Math.sin(a)*rx*1.015,y+.002,z+Math.cos(a)*rz];if(last)rod(last,p,.0025);last=p;}}}
  function engine(x,y,z,r,length){loft([[z-length/2,r*.85,r*.85],[z-length*.28,r,r],[z+length*.3,r*.86,r*.86],[z+length/2,r*.63,r*.63]],'hull',x,y);add(new TorusGeometry(r*.83,r*.065,low?4:6,n),'metal',[x,y,z-length/2]);add(new CylinderGeometry(r*.76,r*.76,length*.2,n,1,true),'dark',[x,y,z-length*.4],[Math.PI/2,0,0]);add(new CylinderGeometry(r*.70,r*.70,.002,n),'dark',[x,y,z-length*.29],[Math.PI/2,0,0]);ball([x,y,z-length*.31],[r*.21,r*.21,r*.26],'metal');for(let i=0;i<(low?8:16);i++){const a=i/(low?8:16)*Math.PI*2;rod([x+Math.cos(a)*r*.22,y+Math.sin(a)*r*.22,z-length*.3],[x+Math.cos(a+.3)*r*.69,y+Math.sin(a+.3)*r*.69,z-length*.31],r*.055,'metal');}add(new TorusGeometry(r*.59,r*.045,4,n),'metal',[x,y,z+length/2]);add(new CylinderGeometry(r*.54,r*.4,.035,n,1,true),'dark',[x,y,z+length/2-.017],[Math.PI/2,0,0]);}
  const heavy=['widebody','freighter','business'].includes(def.type),glider=def.type==='sailplane',prop=['high-wing','warbird'].includes(def.type),high=def.type==='high-wing',war=def.type==='warbird',delta=def.type==='delta',twin=def.type==='twin-jet';
  const r=heavy?(def.type==='business'?.060:.059):glider?.029:prop?.057:.067;
  const body=heavy?[[-.5,.001,.001],[-.48,r*.5,r*.56],[-.44,r*.86,r*.91],[-.37,r,r],[-.2,r,r],[.16,r,r],[.32,r*.91,r*.92],[.43,r*.47,r*.47],[.50,.002,.003]]:
    prop?[[-.5,.002,.002],[-.455,r*.7,r*.68],[-.38,r*.94,r*.99],[-.25,r,r],[-.04,r*.94,r*.96],[.15,r*.7,r*.77],[.34,r*.3,r*.4],[.48,.009,.014],[.5,.001,.001]]:
    [[-.5,.001,.001],[-.44,r*.3,r*.45],[-.34,r*.74,r*.79],[-.2,r,r*.94],[.06,r,r],[.26,r*.78,r*.85],[.43,r*.4,r*.52],[.5,.002,.004]];
  loft(body);
  // Cabin glazing follows the hull surface; raised ellipsoids look like beads.
  function windowPatch(side,y,z,hy,hz,role='cabin',offset=.0007){
    const shape=[[-.65,-1],[.65,-1],[1,-.65],[1,.65],[.65,1],[-.65,1],[-1,.65],[-1,-.65]];
    const surface=([dy,dz])=>{const yy=y+dy*hy,zz=z+dz*hz;let i=body.findIndex((b,i)=>i<body.length-1&&zz>=b[0]&&zz<=body[i+1][0]);i=Math.max(0,i);const a=body[i],b=body[i+1],t=(zz-a[0])/(b[0]-a[0]),rx=a[1]+(b[1]-a[1])*t,ry=a[2]+(b[2]-a[2])*t,cy=(a[3]||0)+((b[3]||0)-(a[3]||0))*t;return [side*(rx*Math.sqrt(Math.max(.001,1-((yy-cy)/ry)**2))+offset),yy,zz];};
    // Subdivide over the curved hull. A single corner fan cuts through the
    // nose between its loft sections and makes cockpit glass look punctured.
    const rings=low?2:4,p=surface([0,0]),ix=[];
    for(let ring=1;ring<=rings;ring++)for(const point of shape)p.push(...surface(point.map(v=>v*ring/rings)));
    const tri=(a,b,c)=>side>0?ix.push(a,b,c):ix.push(a,c,b);
    for(let j=0;j<8;j++)tri(0,1+j,1+(j+1)%8);
    for(let ring=1;ring<rings;ring++)for(let j=0;j<8;j++){const a=1+(ring-1)*8+j,b=1+(ring-1)*8+(j+1)%8,c=a+8,d=b+8;tri(a,c,b);tri(b,c,d);}
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();add(g,role);
  }
  const span=def.span/L/2,wy=high?.073:glider?.012:heavy?-.025:-.018,lead=high?-.15:war?-.11:glider?-.095:-.12;
  const sweep=high?.015:war?.035:glider?.024:delta?.36:twin?.24:heavy?.26:.1;
  const chord=high?.18:war?.24:glider?.105:delta?.48:twin?.39:.28;
  const tipChord=glider?.032:high?.13:war?.12:delta?.018:twin?.085:.08;
  for(const side of [-1,1]){
    wing([[r*.5,lead,chord,wy,.024],[span*.55,lead+sweep*.48,chord*.68,wy+.013,.017],[span,lead+sweep,tipChord,wy+.035,.006]],side);
    // Trailing-edge hinges sit behind the fixed airfoil, so animation never double-draws it.
    const a=span*.6,b=span*.94,z=lead+sweep*.57+chord*.59;
    moving(`aileron-${side<0?'left':'right'}`,[[side*a,wy+.018,z],[side*b,wy+.03,lead+sweep*.95+tipChord*.9],[side*b,wy+.03,lead+sweep*.95+tipChord+.028],[side*a,wy+.018,z+.035]],[side*a,wy+.018,z]);
    const tailY=def.type==='business'?.19:high?.025:.025,tailSpan=glider?.20:heavy?.22:prop?.22:.23;
    wing([[r*.3,.33,.145,tailY,.012],[tailSpan,.395,.07,tailY+.013,.006]],side);
    moving(`elevator-${side<0?'left':'right'}`,[[side*r*.35,tailY,.46],[side*tailSpan,tailY+.013,.458],[side*tailSpan,tailY+.013,.49],[side*r*.35,tailY,.49]],[0,tailY,.46]);
    // Crisp house stripes and tip recognition panels.
    wing([[span*.80,lead+sweep*.80+.018,tipChord*.63,wy+.033,.002],[span*.96,lead+sweep*.96+.01,tipChord*.70,wy+.037,.002]],side,'accent');
    if(high){rod([side*.04,-.035,.02],[side*span*.59,wy-.009,-.04],.004,'metal');}
  }
  if(twin){for(const side of [-1,1]){prism([[side*.062,.025,.20],[side*.112,.21,.35],[side*.121,.18,.43],[side*.075,.03,.42]],.008,'trim',true);moving(`rudder-${side<0?'left':'right'}`,[[side*.075,.03,.425],[side*.121,.18,.435],[side*.123,.18,.472],[side*.075,.03,.46]],[side*.075,.03,.425],true,'accent');engine(side*.060,-.010,.19,.046,.50);}}
  else{const finHeight=glider?.16:high?.19:heavy?.205:.22;prism([[0,.02,.27],[0,finHeight,.37],[0,finHeight*.98,.435],[0,.025,.46]],.01,'trim',true);moving('rudder',[[0,.025,.461],[0,finHeight*.98,.436],[0,finHeight*.93,.485],[0,.03,.50]],[0,.025,.46],true,'accent');}
  if(heavy){
    // Wraparound cockpit and regular inset cabin windows, clearly separate from paint.
    for(const side of [-1,1]){windowPatch(side,.027,-.442,.010,.014);windowPatch(side,.030,-.413,.010,.011);
      const count=def.type==='business'?7:def.type==='freighter'?9:27;
      for(let i=0;i<count;i++)windowPatch(side,.018,-.32+i*(def.type==='business'?.077:.023),.0065,.0048);
      for(const z of [-.36,.30]){windowPatch(side,.004,z,.027,.012,'trim');windowPatch(side,.004,z,.0255,.0105,'hull',.0012);}
      rod([side*r*.997,-.009,-.35],[side*r*.997,-.009,.27],.0027,'accent');
      if(def.type==='business'){prism([[side*.035,.015,.23],[side*.14,.035,.25],[side*.14,.028,.33],[side*.035,.01,.34]],.01);engine(side*.13,.026,.295,.039,.195);}
      else{const xs=def.type==='freighter'?[.16,.29]:[.19];for(const x of xs){const z=-.11+x*.45;prism([[side*x,-.025,z-.018],[side*x,-.075,z-.08],[side*x,-.071,z+.1],[side*x,-.018,z+.09]],.009,'metal',true);engine(side*x,-.087,z,.036,.15);} }
    }
    if(def.type==='freighter')loft([[-.46,.018,.018,.05],[-.39,.043,.040,.05],[-.2,.043,.030,.05],[-.1,.026,.012,.049],[0,.002,.002,.049]]);
  }else{cockpit(glider?-.19:prop?-.17:-.20,glider?.027:prop?.049:.040,glider?.035:high?.065:.046,glider?.105:high?.106:.13,r*.75);
    if(delta)engine(0,0,.255,.047,.35);
    if(war){loft([[.015,.029,.014,-.05],[.08,.033,.028,-.051],[.21,.029,.020,-.047],[.24,.005,.004,-.046]],'trim');for(const side of [-1,1])for(let i=0;i<5;i++)add(new CylinderGeometry(.004,.004,.018,6),'metal',[side*.057,.012,-.34+i*.018],[0,0,Math.PI/2]);}
  }
  if(prop){const spinner=new SphereGeometry(1,n,low?8:16);spinner.scale(.029,.029,.047);add(spinner,'accent',[0,0,-.447]);
    const rotating=new Group();rotating.name='propeller';rotating.position.z=-.452*L;root.add(rotating);const count=war?4:2;
    for(let i=0;i<count;i++){const angle=i/count*Math.PI*2,g=new BoxGeometry(.017,.14,.006);g.translate(0,.075,0);g.rotateZ(angle);add(g,'trim',[0,0,0],[0,0,0],rotating);const tip=new BoxGeometry(.017,.022,.006);tip.translate(0,.134,0);tip.rotateZ(angle);add(tip,'accent',[0,0,0],[0,0,0],rotating);}
    for(const side of [-1,1])ball([side*.027,-.015,-.425],[.015,.012,.008],'dark');
  }
  // Large maintenance seams, aerial and navigation lenses; no micro-detail noise.
  if(!glider)rod([0,r*.92,.04],[0,r+.036,.09],.002,'trim');
  for(const side of [-1,1])ball([side*span,wy+.038,lead+sweep+tipChord*.6],[.004,.003,.009],side<0?'accent':'glass');
  for(const [role,list] of Object.entries(buckets))if(list.length){const mesh=new Mesh(mergeGeometries(list),mats[role]);mesh.name=role;root.add(mesh);}
  const propeller=root.getObjectByName('propeller');
  if(propeller){for(const role of ['trim','accent']){const meshes=propeller.children.filter(m=>m.material===mats[role]);const merged=new Mesh(mergeGeometries(meshes.map(m=>m.geometry)),mats[role]);meshes.forEach(m=>propeller.remove(m));propeller.add(merged);}}
  root.updateMatrixWorld(true);let triangles=0,draws=0;root.traverse(o=>{if(o.isMesh){triangles+=o.geometry.attributes.position.count/3;draws++;}});
  return {root,triangles,draws};
}
function thumbnail(root){
  const faces=[];root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh)return;const pos=o.geometry.attributes.position,v=new Vector3();for(let i=0;i<pos.count;i+=3){const points=[],depth=[];for(let j=0;j<3;j++){v.fromBufferAttribute(pos,i+j).applyMatrix4(o.matrixWorld);points.push([v.x*.87+v.z*.5,v.x*.19-v.y*.92-v.z*.33]);depth.push(-v.x*.46-v.y*.4+v.z*.79);}faces.push({points,depth:depth.reduce((a,b)=>a+b,0)/3,color:`#${o.material.color.getHexString()}`});}});
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
const vector=fs.readFileSync('public/models/player-vector-mobile-v2.glb');
const vectorScene=await new GLTFLoader().parseAsync(vector.buffer.slice(vector.byteOffset,vector.byteOffset+vector.byteLength),'');
fs.writeFileSync('public/models/player-vector-v2.svg',thumbnail(vectorScene.scene));
