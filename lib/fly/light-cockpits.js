import { bow, gauges, nose, panel, pilotLegs, quadrant, screw, spar, stick, switches, tub, yoke } from './light-cockpit-structure.js';
import { annunciator, browLamp, bubbleGlazing, cassette, chartPocket, circuitBank, cockpitLatches, harnessGear, instrumentHood, leatherWelt, railCatch, selector, wingViews } from './light-cockpit-trim.js';

const signs=[-1,1];
const steel='#7b807b';
const black='#242825';
const z=-.90;

function sixPack(k,x,y,d,pitch,depth=z,maxKnots=400) {
  const kinds=['airspeed','attitude','altitude','turn','heading','vsi'];
  gauges(k,depth,kinds.map((kind,i)=>[kind,x+(i%3-1)*pitch,y-Math.floor(i/3)*pitch,d,kind==='airspeed'?{max:maxKnots}:undefined]));
}

function console(k,side,w,title) {
  const x=side*w, y=-.458;
  const stations=[[-.845,.049],[-.804,.068],[-.69,.077],[-.34,.079],[-.19,.073],[-.15,.048]];
  const edge=(sign,shrink,dy)=>stations.map(([depth,half])=>[x+sign*half*shrink,y+dy+(depth+.54)*.04,depth]);
  k.skin('paint','#455257',[edge(-1,.81,-.136),edge(-1,1,-.023),edge(-1,.94,-.006),
    edge(1,.94,-.006),edge(1,1,-.023),edge(1,.81,-.136)]);
  k.tube('alloy','#757e7a',edge(-side,.95,-.008),.0028,14);
  const switchPlate=(depth,length,face)=>{
    const level=y+(depth+.54)*.04;
    k.box('rubber','#1d2626',[x,level-.003,depth],[.136,.013,length+.009],[-.04,0,0],.005);
    k.box('paint',face,[x,level+.004,depth],[.128,.012,length],[-.04,0,0],.004);
    for(const s of signs)for(const t of signs){
      const px=x+s*.056,pz=depth+t*(length/2-.010),py=y+(pz+.54)*.04+.011;
      k.rod('alloy','#989b8d',[px,py,pz],[px,py+.002,pz],.0034,8);
    }
  };
  switchPlate(-.674,.172,'#364341');
  switchPlate(-.446,.252,'#434b49');
  k.label(title,[x,y+.003,-.724],[.105,.012],[-Math.PI/2+.04,0,0]);
  for(let i=0;i<4;i++){
    for(const dx of [-.031,.031]) {
      const pz=-.664+i*.073,py=y+.013+(pz+.54)*.04;
      k.rod('alloy',steel,[x+dx,py,pz],[x+dx,py+.006,pz],.012,10);
      if(i%2){
        k.rod('rubber',black,[x+dx,py+.005,pz],[x+dx,py+.019,pz],.010,12,.009);
        k.box('paint','#b6b5a5',[x+dx+.001,py+.020,pz-.003],[.0017,.001,.006],[0,.4,0],0);
      } else {
        const lean=dx>0?.006:-.005;
        k.rod('alloy','#c0beb0',[x+dx,py+.005,pz],[x+dx,py+.026,pz+lean],.0036,8);
        k.rod('rubber','#313b3a',[x+dx,py+.023,pz+lean],[x+dx,py+.030,pz+lean*1.3],.005,8);
      }
      const names=side<0?['VHF','UHF','VOL','SQL','INT','MIC','RX','TX']:['FLOOD','MAP','PORT','STBD','MAIN','AUX','DIM','BRIGHT'];
      k.label(names[i*2+Number(dx>0)],[x+dx,py-.001,pz-.021],[.040,.0075],[-Math.PI/2+.04,0,0]);
    }
  }
}

function glass(k,rows) { k.skin('glass','#b1c7c5',rows); }

// Keys belong to the removable display surround. The map and primary display
// have different legends and a tactile range knob the pilot can find by feel.
function displayKeys(k,x,y,width,height,legend) {
  const by=y-height/2-.029;
  k.box('paint','#393f40',[x,by,z+.012],[width+.018,.031,.016]);
  for(let i=0;i<5;i++){
    const bx=x+width*(i-2)*.174;
    k.box('rubber','#202624',[bx,by,z+.026],[width*.14,.016,.009],[0,0,0],.002);
    k.label(legend[i],[bx,by,z+.0311],[width*.117,.0068]);
  }
  const knobX=x+width*.5+.032;
  k.rod('alloy','#656b67',[knobX,y-height*.38,z+.005],[knobX,y-height*.38,z+.019],.012,12);
  k.rod('rubber',black,[knobX,y-height*.38,z+.019],[knobX,y-height*.38,z+.038],.010,12);
}

function avionicsLoom(k,w) {
  // The side rack carries wire looms on stamped saddles. The bend dives
  // behind the removable equipment tray at the front of the console.
  for(const s of signs){
    const x=s*(w-.032);
    for(let i=0;i<3;i++) {
      const y=-.514-i*.018;
      k.tube('rubber',['#3a4647','#53574d','#303939'][i],[[x,y+.033,-.50],[x,y,-.28],[x,y,.11],[x-s*.033,y-.039,.30]],.006,12);
    }
    for(const pz of [-.27,-.008,.22]) {
      k.box('alloy','#909188',[x-s*.005,-.530,pz],[.018,.067,.015],[0,0,0],.003);
      for(const py of [-.500,-.558])
        k.rod('paint','#434a46',[x-s*.012,py,pz],[x-s*.017,py,pz],.005,8);
    }
  }
}

function passengerSeat(k,x,color){
  k.box('cloth',color,[x,-.744,.13],[.39,.099,.435],[.06,0,0],.032);
  k.box('cloth',color,[x,-.46,.348],[.388,.514,.115],[-.13,0,0],.035);
  for(const side of signs) {
    k.tube('leather',color,[[x+side*.165,-.67,.265],[x+side*.181,-.53,.276],[x+side*.159,-.335,.303]],.027,12);
    k.tube('cloth','#837e70',[[x+side*.123,-.67,.273],[x+side*.138,-.53,.283],[x+side*.119,-.335,.312]],.0025,9);
    k.rod('alloy',steel,[x+side*.064,-.257,.354],[x+side*.064,-.169,.366],.005,10);
  }
  k.box('leather',color,[x,-.133,.369],[.227,.15,.101],[-.13,0,0],.026);
  k.tube('cloth','#5c5b50',[[x-.152,-.698,.15],[x-.095,-.685,.085],[x-.03,-.690,.064]],.014,7);
  k.box('alloy','#a2a297',[x-.017,-.685,.065],[.045,.013,.029],[0,.15,0]);
}

function jetDeck(k,kind){
  const vector=kind==='fighter',w=vector?.61:.55;
  tub(k,{w,color:vector?'#46515b':'#666b68',seat:vector?'#535748':'#555b50'});
  bow(k,{w:w*.97,h:vector?.95:.81,z:vector?-.40:-.72,rake:vector?.27:.17,color:vector?'#444b50':'#6c736e',gauge:vector?.016:.029});
  bow(k,{w:w*.97,h:.81,z:.51,rake:-.025,color:'#535956',gauge:.028});
  bubbleGlazing(k,w,vector?-.64:-.83,.57,vector?.96:.84);
  nose(k,vector?'#5b6572':'#748183',w*.67,2.93);
  panel(k,{width:w*.96,top:vector?-.238:-.265,drop:vector?.095:.072,z,color:vector?'#343c42':'#4d5655'});
  leatherWelt(k,w*.96,vector?-.238:-.265,z,vector?.095:.072,false);
  for(const s of signs) browLamp(k,s*w*.80,vector?-.354:-.366,z+.011,s);
  if(vector){
    for(const s of signs) {
      const signedOutline=[[.134,-.286],[.351,-.286],[.379,-.315],[.379,-.511],[.349,-.545],[.140,-.545],[.120,-.519],[.120,-.321]];
      cassette(k,signedOutline.map(([x,y])=>[s*x,y]),z,'#3e4546');
      k.label(s<0?'PRIMARY DISPLAY':'NAV DISPLAY',[s*.253,-.281,z+.011],[.108,.009]);
      instrumentHood(k,s*.253,-.287,z,.265,.049,'#3d4547');
    }
    cassette(k,[[-.106,-.278],[.096,-.278],[.111,-.298],[.086,-.576],[.056,-.596],[-.064,-.596],[-.088,-.572]],z,'#434b4b');
    k.screen('pfd',[-.253,-.398,z+.009],[.201,.173],{title:'FLIGHT'});
    k.screen('nav',[.253,-.398,z+.009],[.201,.173],{title:'NAVIGATION'});
    displayKeys(k,-.253,-.398,.201,.173,['REF','BARO','STD','DIM','SET']);
    displayKeys(k,.253,-.398,.201,.173,['MAP','RTE','WPT','RNG','ENT']);
    k.screen('radio',[0,-.311,z+.009],[.168,.045],{title:'COM'});
    gauges(k,z,[['attitude',0,-.408,.100],['heading',0,-.527,.094],['fuel',.414,-.441,.057],['n1',.414,-.52,.057]]);
    switches(k,-.25,-.557,z+.008,5,'DISPLAY CONTROL');
    annunciator(k,.253,-.558,z+.012,['PWR','BUS','GEN','TEMP','ICE']);
    circuitBank(k,.248,-.663,z+.014,'AVIONICS BUS');
    selector(k,-.248,-.659,z+.012,.022,-.72,'SOURCE');
    selector(k,-.155,-.659,z+.012,.022,.33,'BRIGHT');
    k.screen('fms',[.018,-.664,z+.011],[.147,.080],{title:'POSITION'});
    // Separate glass blades sit in machined combiner shoes over the instrument hood.
    for(const side of signs) {
      k.tube('alloy','#5c6765',[[side*.083,-.247,-1.00],[side*.098,-.195,-.976],[side*.109,-.12,-1.005]],.009,9);
    }
    glass(k,[[[-.093,-.209,-.982],[.093,-.209,-.982]],[[-.123,-.10,-1.02],[.123,-.10,-1.02]],[[-.108,-.073,-1.032],[.108,-.073,-1.032]]]);
    k.hud([0,-.143,-.999],[.186,.104],{rotation:[-.32,0,0]});
    stick(k,.34,-.65,-.485,.26);
  } else {
    cassette(k,[[-.288,-.281],[.036,-.281],[.056,-.306],[.056,-.515],[.032,-.536],[-.285,-.536],[-.305,-.511],[-.305,-.307]],z,'#323b3e','#77817e');
    cassette(k,[[.260,-.296],[.390,-.312],[.405,-.339],[.405,-.514],[.385,-.542],[.252,-.542],[.244,-.518],[.244,-.324]],z,'#414a45','#787d72');
    instrumentHood(k,-.123,-.279,z,.369,.066,'#454f50');
    instrumentHood(k,.325,-.297,z,.162,.038,'#49504a');
    k.label('FLIGHT INSTRUMENTS',[-.123,-.516,z+.010],[.129,.009]);
    k.label('L     ENGINE     R',[.324,-.300,z+.011],[.094,.009]);
    sixPack(k,-.11,-.351,.095,.111,z,1500);
    k.screen('nav',[.157,-.427,z+.009],[.137,.138],{title:'COURSE'});
    const twin=[];
    for(const [i,kind] of ['n1','egt','fuel'].entries()){
      for(const side of signs) twin.push([kind,.331+side*.033,-.35-i*.075,.057]);
    }
    gauges(k,z,twin);
    k.screen('radio',[-.13,-.567,z+.009],[.197,.048],{title:'COMM'});
    switches(k,.18,-.567,z+.008,4,'CABIN SYSTEMS');
    annunciator(k,.323,-.608,z+.012,['PWR','L GEN','R GEN']);
    selector(k,-.247,-.674,z+.010,.024,.62,'AUDIO');
    circuitBank(k,.013,-.674,z+.012,'ELECTRICAL',5);
    stick(k,0,-.81,-.56,.34);
    for(const s of signs){
      const archAngle=.72, strutTop=[s*w*.97*Math.sin(archAngle),-.39+.81*Math.cos(archAngle),-.72-.17*Math.cos(archAngle)];
      spar(k,[s*.45,-.329,-1.12],strutTop,'#656b69',.011);
    }
  }
  console(k,1,w*.78,'LIGHTING');
  console(k,-1,w*.78,'COMMUNICATIONS');
  avionicsLoom(k,w);
  cockpitLatches(k,-w,-.391,.17,-1);
  railCatch(k,-w*.972,-.458,-.433,-1,false);
  quadrant(k,-w*.75,-.441,-.343,!vector);
  pilotLegs(k,{cloth:vector?'#59624e':'#64695b'});
  harnessGear(k,w,'modern');
}

function wheel(k,x,y,z,r,color) {
  const ring=Array.from({length:25},(_,i)=>[x,y+Math.sin(i*Math.PI/12)*r,z+Math.cos(i*Math.PI/12)*r]);
  k.tube('rubber',color,ring,.009,30);
  for(let i=0;i<3;i++) k.rod('alloy',steel,[x,y,z],[x,y+r*Math.sin(i*2*Math.PI/3),z+r*Math.cos(i*2*Math.PI/3)],.004,7);
}

function vintage(k,prop){
  const frame=prop?'#6b7051':'#7d8886',w=prop?.475:.51;
  tub(k,{w,rim:-.39,color:frame,lining:prop?'#565e40':'#526567',seat:prop?'#766047':'#675a4b'});
  bow(k,{w,h:prop?.78:.74,z:prop?-.70:-.64,rake:.17,color:frame,gauge:.029});
  bow(k,{w:w*.99,h:.76,z:.52,rake:-.04,color:frame,gauge:.031});
  bubbleGlazing(k,w,prop?-.84:-.79,.55,prop?.79:.76);
  const lower=[w*(prop?.93:.77),-.338,prop?-1.12:-1.22];
  const upper=[w*(prop?.54:.36),prop?.24:.215,prop?-.831:-.958];
  for(const s of signs) {
    spar(k,[lower[0]*s,lower[1],lower[2]],[upper[0]*s,upper[1],upper[2]],frame,prop?.021:.024);
    const angle=Math.asin(upper[0]/w);
    spar(k,[upper[0]*s,upper[1],upper[2]],[upper[0]*s,-.39+(prop?.78:.74)*Math.cos(angle),(prop?-.70:-.64)-.17*Math.cos(angle)],frame,.014);
    k.box('paint',frame,[s*(w-.049),-.472,-.14],[.095,.08,.43],[0,0,0],.009);
  }
  spar(k,[-upper[0],upper[1],upper[2]],[upper[0],upper[1],upper[2]],frame,prop?.014:.019);
  nose(k,prop?'#60674b':'#8b9290',w*.82,prop?3.05:2.70,prop?-.35:-.40);
  panel(k,{width:w*.98,top:prop?-.243:-.226,drop:.084,z,color:prop?'#353834':'#4a5759',lip:prop?'#453d31':'#343c39'});
  leatherWelt(k,w*.98,prop?-.243:-.226,z,.084,prop);
  if(prop){
    cassette(k,[[.079,-.298],[.115,-.272],[.278,-.285],[.315,-.313],[.315,-.494],[.285,-.536],[.106,-.536],[.080,-.501]],z,'#35382d','#797865');
    instrumentHood(k,-.101,-.281,z,.340,.043,'#47483c');
    // A removable six-instrument plate with a separate engine cluster on its right.
    k.box('paint','#272b2b',[-.101,-.401,z+.008],[.342,.263,.013],[0,0,0],.012);
    sixPack(k,-.101,-.345,.091,.108,z+.016);
    for(const s of signs) for(const t of signs) screw(k,-.101+s*.161,-.401+t*.121,z+.016,.005);
    gauges(k,z,[['rpm',.135,-.342,.090],['pressure',.249,-.355,.092],['temperature',.141,-.458,.076],['fuel',.251,-.461,.076],['fuel',.355,-.459,.056]]);
    switches(k,.037,-.584,z+.009,6,'ELECTRICAL');
    selector(k,-.245,-.594,z+.012,.030,-.88,'MAGNETO');
    selector(k,-.155,-.694,z+.013,.027,.78,'DIMMER');
    circuitBank(k,.162,-.689,z+.011,'FUSES',4);
    // Screw-on data plate under the main gauges has its own bright rim.
    k.box('alloy','#979482',[-.030,-.699,z+.010],[.098,.065,.004]);
    k.box('paint','#36372f',[-.030,-.699,z+.013],[.094,.061,.004]);
    for(const [i,line] of ['SKYLOOM AIRCRAFT','TYPE  W / P','ENGINE   12 CYL'].entries())
      k.label(line,[-.030,-.680-i*.016,z+.016],[.080,.008]);
    k.label('ENGINE INSTRUMENTS',[.203,-.523,z+.009],[.17,.013]);
    browLamp(k,-.362,-.376,z+.01,-1);
    wheel(k,-.354,-.566,-.03,.082,'#493e30');
    quadrant(k,-.345,-.455,-.366);
    // Deep fluted quadrant castings and the braided trim linkage follow the
    // exposed stringers in the Mustang's left wall.
    for(const y of [-.470,-.519,-.588]){
      k.tube('paint','#6f7554',[[-.344,y,-.96],[-.402,y,-.67],[-.436,y,-.39],[-.446,y,.16]],.009,14);
    }
    k.tube('alloy','#7c7863',[[-.35,-.59,-.05],[-.385,-.56,-.26],[-.384,-.55,-.55],[-.33,-.57,-.91]],.006,12);
    for(const dx of [-.024,.024]){
      k.rod('alloy','#898c7d',[.345+dx,-.54,-.72],[.345+dx,-.456,-.688],.007);
      k.box('paint',dx<0?'#514a34':'#805239',[.345+dx,-.448,-.683],[.025,.026,.040],[0,0,0],.008);
    }
    k.box('leather','#6d5039',[0,.005,.432],[.265,.235,.105],[-.15,0,0],.032);
  } else {
    cassette(k,[[-.368,-.363],[-.311,-.305],[-.204,-.274],[.102,-.259],[.164,-.288],[.163,-.495],[.132,-.526],[-.300,-.526],[-.366,-.490]],z,'#38464b','#99a29d');
    cassette(k,[[.168,-.334],[.242,-.328],[.363,-.36],[.367,-.444],[.264,-.509],[.178,-.508]],z,'#505750','#808b85');
    k.label('FLIGHT GROUP',[-.081,-.511,z+.010],[.098,.009]);
    instrumentHood(k,-.053,-.250,z,.317,.057,'#566467');
    browLamp(k,-.415,-.407,z+.01,-1);
    const upperRow=[['n1',-.306,-.373,.072],['airspeed',-.182,-.336,.093,{max:850}],['attitude',-.055,-.328,.110],['altitude',.086,-.337,.094],['egt',.212,-.369,.070],['fuel',.316,-.393,.065]];
    gauges(k,z,[...upperRow,['pressure',-.301,-.472,.071],['heading',-.177,-.465,.099],['vsi',-.055,-.461,.094],['turn',.084,-.459,.083],['mach',.212,-.464,.069]]);
    switches(k,-.121,-.566,z+.009,5,'PANEL LIGHTS');
    annunciator(k,.043,-.622,z+.009,['BUS','OIL','TEMP','GEN']);
    selector(k,-.227,-.674,z+.012,.023,.55,'RADIO');
    circuitBank(k,.207,-.674,z+.012,'AC SUPPLY');
    k.screen('radio',[.202,-.55,z+.011],[.143,.045],{title:'VHF'});
    quadrant(k,-.386,-.455,-.352);
    k.box('paint','#576969',[.367,-.523,-.56],[.123,.075,.402],[-.09,0,0],.009);
    for(let i=0;i<5;i++){
      const pz=-.708+i*.061;
      k.rod('alloy','#a3a99c',[.362,-.49,pz],[.362,-.479,pz],.014,14);
      k.rod('rubber','#373c34',[.362,-.479,pz],[.362,-.455,pz],.012,9);
    }
    k.tube('rubber','#3b4644',[[.406,-.43,-.73],[.434,-.48,-.47],[.437,-.514,.18]],.018,14);
  }
  stick(k,0,-.817,-.55,.345,prop?'#443f34':'#302e29');
  cockpitLatches(k,w,-.381,.12,1);
  railCatch(k,w*.971,-.451,-.40,1,prop);
  chartPocket(k,w-.037,-.628,.16,1,prop?'#655440':'#4b5551');
  pilotLegs(k,{cloth:prop?'#7a705b':'#666956',shoe:'#51473a'});
  harnessGear(k,w,prop?'period':'modern');
}

function cabinFrame(k,cx,w,h,color) {
  for(const s of signs){
    const shoulder=[cx+s*w,-.318,-1.17], corner=[cx+s*w*.78,h,-.68],aft=[cx+s*w*.89,h+.01,.51];
    spar(k,shoulder,corner,color,.033);
    spar(k,corner,aft,color,.039);
    spar(k,[cx+s*w,-.34,.50],aft,color,.040);
    glass(k,[[shoulder,corner],[[cx+s*w,-.32,.50],aft]]);
    k.tube('leather',color,[[cx+s*w,-.326,-.93],[cx+s*w,-.302,-.12],[cx+s*w,-.29,.52]],.021,14);
    k.box('leather',color,[cx+s*w,-.50,.01],[.043,.34,.75],[0,0,0],.022);
    k.tube('alloy',steel,[[cx+s*(w-.021),-.415,-.23],[cx+s*(w-.050),-.400,-.20],[cx+s*(w-.052),-.396,-.12]],.009,8);
  }
  k.skin('cloth',color,[[[cx-w*.78,h,-.68],[cx+w*.78,h,-.68]],[[cx-w*.89,h+.01,.51],[cx+w*.89,h+.01,.51]]]);
}

function skylark(k){
  const cx=.27,w=.57;
  tub(k,{w,center:cx,color:'#b4a48d',lining:'#706d5e',seat:'#756958',rim:-.36});
  cabinFrame(k,cx,w,.345,'#aa9f8c');
  glass(k,[[[cx-w,-.318,-1.17],[cx+w,-.318,-1.17]],[[cx-w*.78,.345,-.68],[cx+w*.78,.345,-.68]]]);
  nose(k,'#d2ccc0',.49,2.35,-.39,cx);
  panel(k,{cx,width:w,top:-.245,drop:.055,z,color:'#4a4b46',lip:'#5c574e'});
  k.screen('pfd',[.015,-.369,z+.012],[.238,.154],{title:'PRIMARY FLIGHT'});
  k.screen('nav',[.447,-.369,z+.012],[.238,.154],{title:'MOVING MAP'});
  displayKeys(k,.015,-.369,.238,.154,['PFD','CDI','INSET','TMR','NRST']);
  displayKeys(k,.447,-.369,.238,.154,['MAP','FPL','DCLTR','PROC','ENT']);
  k.screen('radio',[.232,-.331,z+.012],[.121,.053],{title:'COM'});
  gauges(k,z,[['airspeed',.182,-.436,.061,{max:200}],['attitude',.252,-.436,.061],['altitude',.322,-.436,.061]]);
  switches(k,-.013,-.518,z+.012,6,'MASTER     LIGHTS     PITOT');
  circuitBank(k,.464,-.548,z+.014,'CIRCUIT BREAKERS',6);
  selector(k,-.144,-.585,z+.014,.022,-.78,'IGNITION');
  k.box('paint','#4e524c',[.658,-.408,z+.009],[.144,.147,.018]);
  k.label('GLOVE BOX',[.657,-.408,z+.021],[.086,.013]);
  for(const s of signs) screw(k,.658+s*.060,-.345,z+.02);
  yoke(k,-.010,-.525,-.59);
  yoke(k,.476,-.525,-.59);
  k.control('plunger',[.178,-.535,z+.035],c=>{
    c.rod('alloy',steel,[0,0,0],[0,0,.076],.009,10);
    c.rod('rubber',black,[0,0,.068],[0,0,.097],.022,16);
  });
  k.rod('alloy',steel,[.246,-.535,z+.014],[.246,-.535,z+.085],.008);
  k.rod('paint','#963e32',[.246,-.535,z+.082],[.246,-.535,z+.109],.018,14);
  k.label('THROTTLE     MIXTURE',[.218,-.581,z+.013],[.144,.012]);
  passengerSeat(k,.53,'#807461');
  for(const x of [-.059,.55]){
    k.box('leather','#86806e',[x,.312,-.648],[.23,.027,.10],[-.19,0,0],.011);
  }
  chartPocket(k,cx-w+.035,-.581,.065,-1,'#887962');
  pilotLegs(k,{cloth:'#565e66',shoe:'#534b40'});
}

function whisper(k) {
  const ivory='#dcd8c4',w=.373;
  tub(k,{w,rim:-.39,color:ivory,lining:'#c4c2ac',seat:'#687783'});
  // The small removable instrument pod stands proud inside the white shell.
  const section=(w,y,z)=>[[-w,y-.115,z],[-w*.82,y-.008,z],[0,y+.024,z],[w*.82,y-.008,z],[w,y-.115,z]];
  k.skin('paint',ivory,[section(.275,-.302,-.83),section(.255,-.314,-1.01),section(.135,-.399,-1.39)]);
  panel(k,{width:.254,top:-.286,drop:.083,z:-.80,color:'#404643',bottom:-.622,baseWidth:.62,lip:'#5c6257'});
  gauges(k,-.8,[['airspeed',-.103,-.361,.095,{max:140}],['vsi',.014,-.348,.101,{title:'VARIO',unit:'m/s',min:-5,max:5}],['altitude',.131,-.372,.076],['heading',-.070,-.470,.079],['turn',.042,-.462,.082]]);
  k.screen('radio',[.026,-.557,-.785],[.139,.04],{title:'VHF'});
  selector(k,-.132,-.555,-.785,.015,.35,'VOLUME');
  k.box('alloy','#888a7f',[.141,-.486,-.784],[.081,.043,.003]);
  k.box('paint','#d6c7a2',[.141,-.486,-.781],[.077,.039,.002]);
  k.label('MAX  140 KT',[.141,-.479,-.779],[.065,.010],undefined,'#3e382d');
  k.label('CANOPY LOCK',[.141,-.493,-.779],[.065,.008],undefined,'#3e382d');
  nose(k,ivory,.255,2.43,-.42);
  bow(k,{w,h:.77,z:.46,base:-.39,rake:-.02,color:ivory,gauge:.017});
  bubbleGlazing(k,w,-.65,.47,.81);
  for(const s of signs){
    k.tube('paint',ivory,[[s*.19,-.38,-1.41],[s*.292,-.338,-.96],[s*.363,-.373,-.51],[s*.378,-.374,.04],[s*.349,-.328,.45]],.017,16);
    k.tube('rubber','#8c9283',[[s*.192,-.363,-1.41],[s*.293,-.322,-.96],[s*.364,-.357,-.51],[s*.379,-.358,.04],[s*.349,-.312,.45]],.005,16);
  }
  k.tube('paint',ivory,[[-.19,-.38,-1.41],[-.130,-.409,-1.49],[0,-.43,-1.55],[.130,-.409,-1.49],[.19,-.38,-1.41]],.016,16);
  stick(k,0,-.812,-.51,.327,'#705744');
  k.box('paint',ivory,[-.314,-.472,-.10],[.047,.061,.37]);
  k.rod('alloy',steel,[-.307,-.474,-.15],[-.276,-.418,-.16],.008);
  k.box('paint','#3e7290',[-.266,-.41,-.16],[.034,.032,.090],[0,0,-.2],.009);
  k.tube('paint','#b9a43c',[[-.191,-.54,-.66],[-.191,-.521,-.58],[-.165,-.52,-.56],[-.143,-.52,-.58],[-.143,-.54,-.66]],.009,12);
  chartPocket(k,.315,-.548,.09,1,'#68736a');
  cockpitLatches(k,-.358,-.378,-.32,-1);
  pilotLegs(k,{cloth:'#667986',shoe:'#777469',spread:.127,recline:.024});
}

function umbra(k){
  const cx=.385,w=.82,frame='#464c50';
  tub(k,{w,center:cx,rim:-.33,color:frame,lining:'#30363a',seat:'#535755'});
  cabinFrame(k,cx,w,.32,frame);
  // Faceted brow and split windscreen are continuous with the angular nose.
  const left=[-.43,-.31,-1.29],mid=[.38,-.201,-1.50],right=[1.17,-.31,-1.29];
  const highLeft=[-.25,.32,-.68],highMid=[.38,.305,-.89],highRight=[1.02,.32,-.68];
  glass(k,[[left,mid,right],[highLeft,highMid,highRight]]);
  for(const [a,b] of [[left,mid],[mid,right],[highLeft,highMid],[highMid,highRight],[mid,highMid]]) spar(k,a,b,frame,.023);
  k.skin('paint',frame,[[left,mid,right],[[-.43,-.274,-1.16],[.38,-.245,-1.11],[1.17,-.274,-1.16]]]);
  k.skin('paint','#4e555a',[[left,mid,right],[[-.62,-.48,-2.19],[.38,-.411,-2.63],[1.37,-.48,-2.19]],[[-.15,-.72,-3.91],[.38,-.67,-4.32],[.92,-.72,-3.91]]]);
  panel(k,{cx,width:w*.98,top:-.225,drop:.061,z,color:'#363e42'});
  for(const [kind,x,title] of [['pfd',-.042,'FLIGHT'],['nav',.215,'ROUTE'],['engine',.510,'SYSTEMS'],['pfd',.769,'FLIGHT']]){
    k.screen(kind,[x,-.358,z+.011],[.217,.162],{title});
  }
  gauges(k,z,[['attitude',.258,-.50,.069],['altitude',.352,-.50,.068],['fuel',.447,-.50,.069]]);
  switches(k,-.04,-.516,z+.01,5,'DISPLAY SELECT');
  annunciator(k,.736,-.509,z+.012,['PWR','ICE','CABIN','BUS','EXT']);
  k.screen('fms',[.160,-.665,z+.012],[.171,.094],{title:'POSITION'});
  selector(k,-.05,-.634,z+.014,.024,.66,'BARO');
  circuitBank(k,.577,-.632,z+.010,'LIGHTING BUS',5);
  k.box('paint','#3d4446',[.391,-.56,-.39],[.22,.235,.75],[-.12,0,0],.017);
  quadrant(k,.393,-.44,-.37,true);
  yoke(k,-.037,-.56,-.56);
  passengerSeat(k,.733,'#5c6260');
  chartPocket(k,cx-w+.033,-.53,.018,-1,'#4b5150');
  pilotLegs(k,{cloth:'#565c54'});
}

const builders={
  fighter:k=>jetDeck(k,'fighter'),military:k=>jetDeck(k,'military'),
  'warbird-jet':k=>vintage(k,false),'warbird-prop':k=>vintage(k,true),
  prop:skylark,glider:whisper,'flying-wing':umbra,
};
export function buildLightCockpit(id,k) {
  if(!builders[id]) return false;
  builders[id](k);
  wingViews(k,id);
  return true;
}
