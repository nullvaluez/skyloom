// Original captain-eye geometry. The glazing stations and trim follow the five
// Skyloom exteriors. Layout references: Museum of Flight Concorde/747/787
// cabin scans, Textron Citation Longitude flight deck, Boeing C-17 flight deck.
import { pilotLegs } from './light-cockpit-structure.js';
const black = '#222828', metal = '#828781', marking = '#d8d9cb';
const zero = [0,0,0];
const shapes = {
  bizjet:   { seat:.91, wall:.46, top:.41, depth:1.01, brow:-.196, rake:.44, panel:'#42494a', trim:'#948d7e', pad:'#3d3935', seatCloth:'#958b76', designation:'MERIDIAN' },
  airliner: { seat:1.28,wall:.59, top:.57, depth:1.17, brow:-.19, rake:.48, panel:'#566267', trim:'#858e8e', pad:'#30393e', seatCloth:'#4d6471', designation:'STRATOLINER' },
  cargo:    { seat:1.22,wall:.55, top:.49, depth:1.15, brow:-.207,rake:.37, panel:'#796c5b', trim:'#a49a86', pad:'#4c4138', seatCloth:'#796e61', designation:'LEVIATHAN' },
  c17:      { seat:1.42,wall:.66, top:.56, depth:1.24, brow:-.225,rake:.34, panel:'#535955', trim:'#777f7a', pad:'#383d3d', seatCloth:'#516578', designation:'C-17A' },
  concorde: { seat:.96, wall:.46, top:.38, depth:1.09, brow:-.198,rake:.30, panel:'#56595a', trim:'#828582', pad:'#343739', seatCloth:'#747377', designation:'CONCORDE' },
};
const shift = (p,dx,dy,dz) => [p[0]+dx,p[1]+dy,p[2]+dz];
const along = (a,b,t) => a.map((n,i)=>n+(b[i]-n)*t);
function screw(k,p,r=.006) {
  k.rod('alloy','#737873',p,shift(p,0,0,.0022),r,10);
  k.box('paint','#292d2c',shift(p,0,0,.0025),[r*1.25,r*.22,.0008],[0,0,.56],0);
}
function knob(k,x,y,z,r=.016,cap='#747972') {
  k.rod('paint','#2a3030',[x,y,z],[x,y,z+.012],r*1.2,18);
  k.rod('rubber',cap,[x,y,z+.012],[x,y,z+.03],r,14,r*.89);
  k.box('paint',marking,[x,y+r*.34,z+.0307],[.0025,r*.65,.001],zero,0);
}
function button(k,x,y,z,w,h,words,lit=false) {
  k.box('rubber','#292f31',[x,y,z],[w,h,.011],zero,.0025);
  k.label(words,[x,y,z+.006],[w*.88,h*.64],zero,lit?'#b8debd':marking);
}
// A flattened, folded windscreen post, edged separately from its rubber seal.
function pillar(k,a,b,width,trim) {
  const rail=(w,z)=>[shift(a,-w,0,z),shift(b,-w,0,z),shift(a,w,0,z),shift(b,w,0,z)];
  const [la,lb,ra,rb]=rail(width*.65,0);
  k.skin('rubber','#242b2b',[[la,ra],[lb,rb]]);
  const [fa,fb,ga,gb]=rail(width*.49,.018);
  k.skin('paint',trim,[[la,fa,ga,ra],[lb,fb,gb,rb]]);
  k.rod('alloy','#737975',ga,gb,.0025);
  for(const t of [.14,.53,.88]) screw(k,shift(along(a,b,t),0,0,.019),.0048);
}
function broadShell(k,d,id) {
  const {seat,wall,top,depth,brow,rake,pad,panel,trim}=d;
  const cx=seat/2, half=cx+wall;
  const sill=[], roof=[];
  // Aft side pane, sliding/side light, pilot's front quarter, centre mullion.
  for(const s of [-1,1]) {
    const p=(x,y,z)=>[cx+s*x,y,z];
    const quarter=id==='c17'?.61:id==='concorde'?.82:.70;
    const base=[p(half+.04,brow-.14,.74),p(half,brow-.12,-.16),
      p(half-.04,brow-.068,-depth*quarter),p(half-.16,brow-.005,-depth),p(0,brow+.024,-depth-.10)];
    const crown=[p(half-.07,top+.06,.74),p(half-.095,top+.06,-.14),
      p(half-.14,top+.026,-depth*.45),p(half-.29,top-.004,-depth+rake),p(0,top+.06,-depth+rake-.16)];
    sill.push(base); roof.push(crown);
    const posts=id==='bizjet'?[0,1,3]:[0,1,2,3];
    for(const i of posts) pillar(k,base[i],crown[i],i===2?.044:id==='cargo'?.079:.064,trim);
    for(let i=1;i<base.length;i++){
      // Separate planes give each window its own angle to the sky.
      k.skin('glass','#a8bfc4',[[base[i-1],base[i]],[crown[i-1],crown[i]]]);
    }
    k.tube('rubber','#262a2b',base,.021,24);
    k.tube('leather',trim,crown,.033,28);
    const cap=base.slice(0,4).map(v=>shift(v,-s*.067,-.012,.016));
    k.skin('leather',pad,[base.slice(0,4),cap]);
    k.tube('alloy','#7f817b',cap,.0032,20);
    const edge=base.map(v=>shift(v,s*.037,-.071,0));
    const floor=base.map(v=>[v[0]+s*.043,-1.04,v[2]]);
    k.skin('paint',trim,[base,edge,floor]);
    // Armrest, recess for charts, window pull and the latch striker.
    const side=cx+s*(half-.01);
    k.box('leather',pad,[side,-.46,.05],[.095,.084,.55],zero,.025);
    k.box('cloth','#4c5151',[side-s*.015,-.69,-.06],[.071,.20,.39],zero,.017);
    k.tube('alloy',metal,[[side-s*.015,-.30,-.25],[side-s*.044,-.29,-.24],
      [side-s*.047,-.29,-.125],[side-s*.009,-.308,-.10]],.008,12);
    // Window-slide channel and the toothed locking track. Seen obliquely
    // along the sill, the rail has both an inner lip and a contact shadow.
    for(const dx of [.013,.034]) k.tube(dx>.02?'alloy':'rubber',dx>.02?'#93938a':black,
      base.slice(0,4).map(v=>shift(v,-s*dx,.013,.006)),.0045,19);
    for(let j=0;j<9;j++){
      const pin=shift(along(base[1],base[2],(j+.5)/9),-s*.036,.015,.005);
      k.rod('alloy',metal,pin,shift(pin,0,.003,0),.0048,8);
    }
    const a=base[3],b=base[4];
    const shoe=along(a,b,.20), elbow=shift(along(a,b,.36),0,.037,-.02);
    k.rod('alloy','#515756',shift(shoe,0,.018,-.009),elbow,.008);
    const bladeA=shift(along(a,b,.28),0,.044,-.015),bladeB=shift(along(a,b,.72),0,.061,-.02);
    k.rod('rubber',black,bladeA,bladeB,.006);
    k.rod('alloy','#636a68',elbow,shift(along(bladeA,bladeB,.50),0,.006,0),.003);
    k.rod('alloy','#7f8380',shift(shoe,0,.01,0),shift(shoe,0,.031,0),.011,16);
    // Blind guide, warm moulded lining and the overhead eyebrow.
    const inner=crown.map(v=>[cx+(v[0]-cx)*.78,v[1]+.055,v[2]+.06]);
    k.skin('paint',trim,[crown,inner]);
  }
  pillar(k,sill[0][4],roof[0][4],id==='concorde'?.050:.070,trim);
  const aft=[cx,.56+top*.28,.85];
  for(const side of roof) k.skin('paint',trim,[side,side.map(p=>along(p,aft,.95))]);
  // The instrument hood projects over the recessed panel, with a rolled,
  // stitched crash pad and a separate anti-reflective top.
  const front=Array.from({length:39},(_,i)=>{
    const u=2*i/38-1, edge=Math.abs(u), shoulder=Math.exp(-((edge-.52)**2)/.025);
    const hood=id==='concorde'?.045*shoulder:id==='bizjet'?.022*shoulder:.014*shoulder;
    return [cx+u*(half-.035), brow+.012+hood-.085*edge**6, -depth+.168+.128*edge**5];
  });
  const lip=front.map(v=>shift(v,0,-.028,.01));
  k.skin('leather',pad,[lip,front,front.map(v=>shift(v,0,.002,-.21))],true);
  k.tube('rubber',pad,front,.016,30);
  k.tube('leather','#686c66',lip.map(p=>shift(p,0,.003,.003)),.0026,24);
  k.box('paint',panel,[cx,brow-.285,-depth+.095],[2*half-.07,.54,.11],zero,.025);
  k.box('paint','#434845',[cx,-.731,-depth+.012],[half*2,.71,.13],zero,.02);
  k.box('rubber','#333830',[cx,-.992,-depth+.13],[half*2,.068,.45],zero,.012);
  k.box('rubber','#303436',[cx,-.966,-.22],[half*2,.075,1.72],zero,.02);
  for (const x of [0,seat]) {
    for(const side of [-1,1]){
      k.box('rubber','#363a39',[x+side*.116,-.827,-.635],[.122,.043,.165],[-.47,0,0]);
      for(let j=0;j<4;j++) k.rod('alloy','#5b605c',[x+side*.116-.047,-.79-j*.009,-.68+j*.028],[x+side*.116+.047,-.79-j*.009,-.68+j*.028],.003);
    }
    k.box('cloth',d.seatCloth,[x,-.72,.11],[.48,.115,.49],zero,.048);
    k.box('paint','#535954',[x,-.848,.13],[.35,.19,.30],zero,.024);
    for (const side of [-1,1]){
      k.box('alloy','#727970',[x+side*.16,-.946,.13],[.034,.033,.65],zero,.004);
      k.rod('alloy','#7c837d',[x+side*.055,-.202,.363],[x+side*.055,-.125,.367],.009);
    }
    k.box('cloth',d.seatCloth,[x,-.427,.335],[.44,.49,.115],[-.13,0,0],.045);
    k.box('leather',pad,[x,-.10,.374],[.25,.16,.108],[-.13,0,0],.035);
    for(const side of [-1,1]){
      k.box('cloth',d.seatCloth,[x+side*.18,-.42,.262],[.078,.39,.077],[-.17,0,side*.09],.026);
      k.tube('cloth','#424845',[[x+side*.142,-.18,.264],[x+side*.12,-.37,.236],[x+side*.092,-.57,.14]],.015,12);
    }
  }
  // Enclose the volume behind both pilots. A wide side glance sees the
  // observer's bulkhead past the other seat, especially on portrait devices.
  const aftZ=id==='concorde'?1.49:1.24;
  for(const s of [-1,1]){
    const side=cx+s*(half+.042);
    k.box('paint',trim,[side,-.212,(.72+aftZ)/2],[.077,top+1.18,aftZ-.70],zero,.012);
    k.tube('leather',d.pad,[[side-s*.052,-.54,.59],[side-s*.054,-.54,.87],[side-s*.055,-.54,aftZ]],.017,10);
  }
  k.box('paint',trim,[cx,-.22,aftZ],[half*2+.13,top+1.23,.078],zero,.018);
  k.box('paint',trim,[cx,top+.059,(.73+aftZ)/2],[half*2,.095,aftZ-.68],zero,.012);
  k.box('rubber',black,[cx,-.984,1.01],[half*2,.093,.93],zero,.008);
  k.frame([cx,-.25,aftZ-.045],[0,Math.PI,0],rear=>{
    rear.box('rubber','#414744',[0,0,0],[.56,1.39,.023],zero,.023);
    rear.box('paint',trim,[0,0,.016],[.536,1.36,.017],zero,.018);
    rear.box('alloy',metal,[-.174,-.024,.033],[.11,.02,.02],zero,.007);
    rear.label('FLIGHT DECK',[0,.354,.027],[.174,.019]);
  });
}
function overhead(k,d,id) {
  const cx=d.seat/2, r=[Math.PI*.55,0,0];
  k.frame([cx,d.top+.072,-.32],r,o=>{
    const w=id==='bizjet'?.36:id==='concorde'?.44:.53;
    o.box('paint',d.panel,[0,0,0],[w,.66,.048],zero,.017);
    const systems=id==='bizjet'?['ELECTRICAL','LIGHTING','AIR']:id==='concorde'?['INTAKE','LIGHTS','DE-ICE']:['ELECTRICAL','AIR COND','ANTI-ICE'];
    systems.forEach((title,i)=>{
      const x=(i-1)*w*.31;
      o.box('paint','#424948',[x,0,.026],[w*.29,.56,.009],zero,.004);
      o.label(title,[x,.239,.032],[w*.255,.022]);
      for(let j=0;j<5;j++) {
        for(const side of [-1,1]){
          const xx=x+side*w*.058,y=.17-j*.082;
          if (j%2) knob(o,xx,y,.031,.010,'#96998b');
          else {
            o.rod('alloy','#a5a79e',[xx,y,.032],[xx,y+.008,.055],.0033);
            o.box('rubber','#b2afa1',[xx,y+.008,.055],[.014,.012,.013],zero,.003);
          }
        }
      }
      for(const y of [-.255,.266]) screw(o,[x-w*.12,y,.033],.004);
    });
  });
}
function yoke(k,x,classic=false,business=false) {
  const y=-.48,z=business?-.51:-.56, w=business?.131:.168;
  k.tube('paint',classic?'#70716d':'#454b4a',[[x,-.88,-.57],[x,-.71,-.57],[x,y-.06,z-.05],[x,y,z]],.037,16);
  k.control('yoke',[x,y,z],s=>{
    const finish=classic?'#777975':'#333a39';
    const points=[[-w,.066,-.013],[-w*.95,.005,.005],[-w*.75,-.037,.01],
      [0,-.016,.022],[w*.75,-.037,.01],[w*.95,.005,.005],[w,.066,-.013]];
    s.tube('paint',finish,points,.022,24,10);
    for(const side of [-1,1]){
      s.tube('rubber','#303535',[[side*w*.91,.003,.009],[side*w,.044,-.003],[side*w*.97,.092,-.027]],.021,10);
      s.box('paint',finish,[side*w*.95,.089,-.019],[.046,.031,.039],zero,.009);
      s.rod('rubber','#626863',[side*w*.95,.091,.002],[side*w*.95,.097,.003],.009);
    }
    s.box('paint',finish,[0,-.009,.025],[.091,.061,.035],zero,.01);
    s.box('alloy','#777f7b',[0,.012,.045],[.055,.004,.003],zero,0);
    s.box('rubber','#343735',[0,-.008,.044],[.068,.036,.003],zero,.002);
    s.label(business?'PITCH TRIM':'CONTROL WHEEL',[0,-.006,.046],[.055,.009]);
    for(const side of [-1,1]) {
      s.box('paint','#626661',[side*w,.071,.003],[.027,.032,.017],[.22,0,0],.004);
      for(let j=0;j<3;j++) s.box('rubber','#292c29',[side*w,.06+j*.006,.012],[.019,.0018,.0015],zero,0);
    }
  });
}
function stick(k,x) {
  k.box('rubber','#282e2c',[x,-.82,-.34],[.14,.045,.19],zero,.014);
  k.control('stick',[x,-.813,-.34],s=>{
    s.tube('paint','#515853',[[0,0,0],[0,.13,-.04],[0,.24,-.06],[.008,.30,-.045]],.024,16);
    s.tube('rubber',black,[[0,.221,-.063],[.005,.28,-.055],[.007,.32,-.039]],.029,14);
    s.box('rubber','#343b37',[.006,.321,-.047],[.068,.056,.051],[-.16,0,0],.016);
    knob(s,.013,.328,-.024,.008);
  });
}
function keyboard(k,x,y,z,w,kind) {
  k.box('paint','#3e4442',[x,y,z],[w,.20,.022],zero,.008);
  k.screen(kind,[x,y+.044,z+.012],[w*.67,.077],{title:kind==='radio'?'TUNING':'NAV DATA'});
  for(let j=0;j<4;j++) for(let i=0;i<6;i++){
    const xx=x+(i-2.5)*w*.124, yy=y-.014-j*.022;
    button(k,xx,yy,z+.016,w*.105,.017,'ABCDEFGHIJKLMNOPQRSTUVWX'[j*6+i]);
  }
}
function inertialUnit(k,x,w) {
  k.box('paint','#565752',[x,0,.006],[w,.211,.024],zero,.006);
  k.screen('ins',[x,.067,.021],[w*.81,.032]);
  for(let j=0;j<3;j++) for(let i=0;i<3;i++)
    button(k,x+(i-1)*w*.19,-.014-j*.025,.021,w*.16,.021,String(7+i-3*j));
  button(k,x,-.090,.021,w*.16,.019,'0');
  knob(k,x-w*.34,-.069,.021,.014,'#8e9087');
  k.label('INS',[x,.026,.022],[w*.24,.010]);
}
function pedestal(k,d,n,id) {
  const cx=d.seat/2, z=-d.depth+.18, width=id==='bizjet'?.24:id==='c17'?.39:.33;
  k.box('paint',d.panel,[cx,-.71,-.26],[width,.37,1.18],zero,.026);
  k.frame([cx,-.50,z+.13],[-1.05,0,0],f=>{
    if(id==='concorde') for(const s of [-1,1]) inertialUnit(f,s*width*.245,width*.46);
    else if(id==='bizjet') f.screen('fms',[0,0,.008],[.176,.108],{title:'FLIGHT MANAGEMENT'});
    else for(const s of [-1,1]) keyboard(f,s*width*.245,0,.006,width*.44,'fms');
  });
  const tz=id==='concorde'?-.39:-.355, y=-.506, spacing=n===2?.068:.047;
  for(let i=0;i<n;i++){
    const x=cx+(i-(n-1)/2)*spacing;
    k.box('rubber','#171d1e',[x,y,tz],[.027,.014,.26],zero,.005);
    k.label(String(i+1),[x,y+.009,tz-.151],[.027,.016],[-Math.PI/2,0,0]);
  }
  k.control('throttle',[cx,y,tz],q=>{
    for(let i=0;i<n;i++){
      const x=(i-(n-1)/2)*spacing;
      q.tube('alloy','#7b8180',[[x,0,0],[x,.047,-.007],[x,.099,-.034]],.009,8);
      q.box('rubber',id==='concorde'?'#45433c':'#333a3b',[x,.116,-.035],[spacing*.92,.048,.064],[-.18,0,0],.012);
      q.box('alloy','#939792',[x,.144,-.048],[spacing*.78,.005,.016],[-.16,0,0],.002);
    }
  });
  for(const s of [-1,1]){
    const x=cx+s*(width/2-.021);
    k.tube('alloy',metal,[[x,y,tz+.12],[x,y+.051,tz+.086],[x,y+.067,tz+.072]],.006,10);
    k.box('paint',s>0?'#b7b6a6':'#686e6b',[x,y+.074,tz+.07],[.046,.026,.044],zero,.006);
  }
  k.frame([cx,-.515,.043],[-Math.PI/2,0,0],f=>{
    f.label('PEDESTAL LIGHTS',[0,-.06,.01],[width*.66,.015]);
    for(let i=-1;i<2;i++) knob(f,i*width*.27,0,.01,.014);
  });
}
function glareControls(k,d,id,z) {
  const cx=d.seat/2,y=d.brow-.047, width=d.seat*.84;
  k.box('paint',d.panel,[cx,y,z],[width,.084,.057],zero,.007);
  for(const [i,caption] of ['SPEED','HEADING','ALTITUDE','VERT SPEED'].entries()){
    const x=cx+(i-1.5)*width*.224;
    k.label(caption,[x,y+.025,z+.03],[width*.13,.012]);
    k.screen('strip',[x-.012,y-.001,z+.023],[width*.081,.019],{title:caption});
    knob(k,x+width*.064,y-.006,z+.03,.011,id==='concorde'?'#aca993':'#93978d');
    button(k,x-.011,y-.024,z+.03,width*.08,.012,['IAS','HDG','ALT','V/S'][i]);
  }
  for(const x of [0,d.seat]) {
    button(k,x-.075,y,z+.004,.055,.033,'WARN');
    button(k,x-.01,y,z+.004,.055,.033,'CAUT');
  }
}
function panelEdges(k,d,z) {
  const cx=d.seat/2;
  for(const side of [-1,1]) {
    const x=cx+side*(cx+d.wall-.077);
    for(let i=0;i<4;i++) {
      const y=d.brow-.133-i*.058;
      button(k,x,y,z+.005,.054,.026,['PANEL','MAP','FLOOD','DOME'][i]);
    }
    for(const y of [d.brow-.09,d.brow-.46]) screw(k,[x,y,z+.006]);
  }
}
// Removable outboard panels also fill the triangular space where the
// windshield tapers into the fuselage. The return and dark seam under every
// plate give the screws, axial vents and thumbwheels a real mounting surface.
function fittings(k,d,id,z) {
  const x=-d.wall*.67,y=d.brow-.242;
  k.frame([x,y,z+.004],[0,.10,0],f=>{
    const w=id==='bizjet'?.146:.177;
    f.box('rubber','#2f3332',[0,0,0],[w+.009,.239,.012],zero,.007);
    f.box('paint',d.panel,[0,0,.006],[w,.231,.009],zero,.006);
    for(const s of [-1,1]) for(const t of [-1,1]) screw(f,[s*(w/2-.008),t*.106,.012],.0048);
    f.label(id==='c17'?'CREW AIR':'AIR OUTLET',[0,.084,.012],[w*.77,.013]);
    const vy=.036;
    f.rod('alloy','#92948a',[0,vy,.012],[0,vy,.019],.035,28);
    f.rod('rubber','#222827',[0,vy,.019],[0,vy,.023],.031,28,.027);
    for(let j=-2;j<=2;j++){
      const len=Math.sqrt(.024**2-(j*.0085)**2);
      f.rod('alloy','#7f8276',[-len,vy+j*.0085,.024],[len,vy+j*.0085,.024],.0026,8);
    }
    f.label('FLOOD      PANEL',[0,-.028,.014],[w*.77,.012]);
    for(const s of [-1,1]) knob(f,s*w*.215,-.07,.012,.015,'#5e625b');
  });
  const instrumentX=id==='concorde'?-.10:0;
  k.frame([instrumentX,d.brow-.427,z+.025],[-.14,0,0],f=>{
    const w=id==='bizjet'?.32:.42;
    f.box('paint',d.panel,[0,0,0],[w,.090,.022],zero,.007);
    for(const s of [-1,1]) screw(f,[s*(w/2-.01),.031,.012],.005);
    for(const [i,caption] of ['MIC','BOOM','SPKR','INT','CAB'].entries()){
      const xx=(i-2)*w*.153;
      f.label(caption,[xx,.020,.013],[.038,.011]);
      if(i===1 || i===3) knob(f,xx,-.009,.012,.010,'#737971');
      else {
        f.rod('alloy','#646961',[xx,-.010,.013],[xx,-.010,.018],.009,14);
        f.rod('alloy','#a9ab9b',[xx,-.010,.017],[xx,-.003,.033],.0037,8);
      }
    }
  });
  // Side console and steering tiller lie outboard of the captain's knee.
  const side=-d.wall+.094;
  k.frame([side,-.48,-.39],[-1.23,.12,0],f=>{
    f.box('paint',d.trim,[0,0,0],[.15,.35,.06],zero,.021);
    f.box('rubber','#363c3c',[0,.012,.031],[.12,.272,.008],zero,.011);
    f.label('STEERING',[0,.101,.037],[.091,.016]);
    f.rod('alloy','#747d78',[0,-.013,.035],[0,-.013,.066],.032,18,.024);
    f.tube('rubber','#373a35',[[-.041,.032,.078],[-.055,-.008,.089],[-.040,-.045,.092],
      [0,-.060,.093],[.040,-.045,.092],[.055,-.008,.089],[.041,.032,.078]],.009,20);
    f.rod('paint',d.panel,[-.048,-.015,.089],[.048,-.015,.089],.006);
  });
  // Bolted access covers, service placard and seat rail along the inner liner.
  k.frame([-d.wall+.035,-.40,-.655],[0,1.41,0],f=>{
    f.box('paint',d.trim,[0,0,0],[.30,.125,.014],zero,.009);
    f.box('rubber','#343938',[0,.004,.008],[.151,.072,.004],zero,.002);
    for(const [j,words] of ['WINDOW LATCH','CHECK LOCKED','BEFORE FLIGHT'].entries())
      f.label(words,[0,.021-j*.017,.011],[.12,.012]);
    for(const s of [-1,1]) for(const t of [-1,1]) screw(f,[s*.134,t*.049,.009],.004);
  });
}
function visorStructure(k,d) {
  // Concorde's raised outer visor sits ahead of the pressure windscreen.
  // Its lower rail rides on the long, narrow beak in the pilot's sightline.
  const cx=d.seat/2, z=-d.depth, half=cx+d.wall;
  for(const side of [-1,1]){
    const p=(x,y,dz)=>[cx+side*x,y,z+dz];
    const lower=p(half*.74,-.164,-.43),inner=p(.045,-.145,-.73);
    k.rod('paint','#617076',lower,inner,.012,12);
    k.rod('rubber','#383e3d',lower,p(half*.92,.212,-.13),.012);
    k.skin('paint','#b0b6b7',[[lower,inner],[p(half*.67,-.236,-.70),p(0,-.191,-1.00)],
      [p(half*.24,-.56,-3.24),p(0,-.53,-3.42)]]);
    k.rod('alloy','#909891',lower,p(half*.93,.217,-.122),.0053);
  }
}
function glassPanel(k,d,id,z) {
  const y=d.brow-.204,cx=d.seat/2;
  const screens=id==='bizjet'?
    [['pfd',0,.329,.205],['nav',cx,.343,.205],['pfd',d.seat,.329,.205]]:
    id==='c17'?
    [['pfd',-.026,.270,.232],['nav',.32,.263,.232],['engine',d.seat-.32,.263,.232],['pfd',d.seat+.026,.270,.232]]:
    [['pfd',-.092,.252,.231],['nav',.206,.252,.231],['engine',cx,.254,.231],
     ['nav',d.seat-.206,.252,.231],['pfd',d.seat+.092,.252,.231]];
  for(const [kind,x,w,h] of screens) {
    k.screen(kind,[x,y,z+.009],[w,h],{engines:id==='c17'?4:2});
    for(const s of [-1,1]) {
      screw(k,[x+s*(w/2-.007),y-h/2-.021,z+.009],.004);
      knob(k,x+s*(w/2+.005),y-h/2-.037,z+.007,.009);
    }
    for(let j=0;j<5;j++) button(k,x+(j-2)*w*.15,y-h/2-.026,z+.007,w*.125,.015,['RNG','NAV','SYS','MAP','ENT'][j]);
  }
  k.label(d.designation,[0,d.brow-.092,z+.022],[.12,.013]);
  if(id==='c17'){
    for(const [i,kind] of ['attitude','altitude','airspeed'].entries()) k.gauge(kind,[cx+(i-1)*.091,y+.023,z+.008],.078);
  } else {
    for(const [i,kind] of ['airspeed','attitude','altitude'].entries()) k.gauge(kind,[cx+(i-1)*.077,y-.184,z+.008],.065);
  }
  glareControls(k,d,id,z+.025);
}
function freighter(k,d,z) {
  const cx=d.seat/2, y=d.brow-.205;
  // A mixed CRT/standby panel and a four-engine centre stack on the
  // raised upper deck, with separate mode-control and radio pedestals.
  for(const x of [0,d.seat]) {
    const toward=x===0?1:-1;
    for(const [kind,xx] of [['pfd',x-.059*toward],['nav',x+.19*toward]]){
      k.box('paint','#5d574d',[xx,y,z+.003],[.236,.233,.032],zero,.009);
      k.screen(kind,[xx,y,z+.021],[.191,.17]);
      knob(k,xx-.085,y-.105,z+.023,.011);
      k.label(kind==='pfd'?'EADI':'EHSI',[xx,y-.103,z+.023],[.054,.010]);
    }
    for(const [i,kind] of ['airspeed','attitude','altitude'].entries()) k.gauge(kind,[x+(i-1)*.087,y-.181,z+.015],.076);
  }
  k.screen('engine',[cx,y+.018,z+.013],[.223,.172],{engines:4,title:'ENGINE INDICATION'});
  for(let j=0;j<4;j++) k.gauge('egt',[cx+(j-1.5)*.056,y-.136,z+.012],.048);
  glareControls(k,d,'cargo',z+.025);
}
function concordePanel(k,d,z) {
  const cx=d.seat/2, y=d.brow-.161;
  // Black instrument subpanels fastened to a grey fascia, large paired
  // attitude/heading indicators and four vertical Olympus instrument columns.
  for(const x of [0,d.seat]) {
    k.box('paint','#303434',[x,y-.083,z+.008],[.49,.354,.027],zero,.012);
    for(const [kind,xx,yy,diameter] of [
      ['airspeed',-.141,0,.094],['attitude',-.013,-.002,.122],['altitude',.119,.003,.086],
      ['mach',-.144,-.115,.081],['heading',-.015,-.139,.118],['vsi',.119,-.102,.078],
      ['turn',.123,-.196,.069],['pressure',-.142,-.213,.065],
    ]) k.gauge(kind,[x+xx,y+yy,z+.024],diameter,{max:kind==='airspeed'?600:undefined});
    for(const s of [-1,1]) for(const t of [-1,1]) screw(k,[x+s*.226,y-.083+t*.16,z+.024]);
  }
  for(const [i,kind] of ['n1','egt','n2','fuel'].entries()){
    for(let j=0;j<4;j++) k.gauge(kind,[cx+(j-1.5)*.062,y+.001-i*.075,z+.012],.054);
  }
  glareControls(k,d,'concorde',z+.025);
  // A reclining side glance catches the forward edge of the engineer station.
  k.frame([d.seat+d.wall-.018,-.28,.45],[0,-Math.PI/2,0],o=>{
    o.box('paint','#464d4d',[0,0,0],[.77,.59,.07],zero,.008);
    for(const [i,name] of ['FUEL TRANSFER','ELECTRICAL','HYDRAULICS'].entries()){
      const x=(i-1)*.239; o.label(name,[x,.225,.038],[.18,.019]);
      for(let j=0;j<2;j++) o.gauge(i===0?'fuel':'pressure',[x+(j-.5)*.099,.13,.039],.072);
      for(let row=0;row<3;row++) for(let col=0;col<3;col++) knob(o,x+(col-1)*.063,-.001-row*.077,.038,.012);
    }
  });
}
function combiner(k,x) {
  for(const s of [-1,1]) {
    k.tube('paint','#424a48',[[x+s*.124,.43,-.64],[x+s*.129,.33,-.70],[x+s*.12,.143,-.801]],.015,14);
    k.rod('alloy',metal,[x+s*.119,.16,-.8],[x+s*.119,.11,-.808],.007);
  }
  k.box('paint','#555d59',[x,.396,-.65],[.282,.071,.119],[-.18,0,0],.016);
  const pane=[[[x-.138,-.037,-.854],[x+.138,-.037,-.854]],[[x-.16,.128,-.79],[x+.16,.128,-.79]]];
  k.skin('glass','#9abdae',pane);
  k.hud([x,.044,-.815],[.253,.145],{rotation:[.37,0,0]});
}
export function buildTransportCockpit(id,k) {
  const d=shapes[id];
  broadShell(k,d,id); overhead(k,d,id);
  const z=-d.depth+.153;
  panelEdges(k,d,z);
  if(id==='concorde') concordePanel(k,d,z);
  else if(id==='cargo') freighter(k,d,z);
  else glassPanel(k,d,id,z);
  fittings(k,d,id,z);
  if(id==='concorde') visorStructure(k,d);
  for(const x of [0,d.seat]) {
    if(id==='c17') { stick(k,x); combiner(k,x); }
    else yoke(k,x,id==='concorde',id==='bizjet');
  }
  pedestal(k,d,id==='airliner'||id==='bizjet'?2:4,id);
  pilotLegs(k,{cloth:id==='c17'?'#646c57':'#3e4955',shoe:'#373a39',spread:.135});
}
