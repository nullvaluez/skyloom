// Hand-built pilot-eye structures, all dimensions in metres. Curved skins span
// adjacent cross sections; every cut edge has a return or a rubber seal.
const rubber = '#222522';
const bright = '#90938b';
const signs = [-1, 1];

export function screw(k,x,y,z,r=.006) {
  k.rod('alloy',bright,[x,y,z],[x,y,z+.002],r,10);
  k.box('paint','#31342e',[x,y,z+.0022],[r*1.2,r*.25,.0008],[0,0,.47],0);
}

export function panel(k,{cx=0,width,top,drop=.1,z,color='#393c39',lip=rubber,bottom=-.92,baseWidth=1}) {
  const line = (dz,dy,scale=1) => Array.from({length:25},(_,i)=>{
    const t=(i-12)/12;
    return [cx+t*width*scale,top-drop*t**4+dy,z+dz];
  });
  const face=[line(0,0),line(0,-.055),line(0,bottom-top,baseWidth)];
  k.skin('paint',color,face);
  for(const edge of [0,24]){
    const cheek=face.map(row=>row[edge]);
    k.skin('paint',color,[cheek,cheek.map(([x,y,pz])=>[x,y-.01,pz-.15])]);
  }
  k.skin('paint',color,[line(-.32,-.045,.84),line(-.08,.014,.98),line(.012,0),line(.012,-.017)]);
  k.skin('leather',lip,[line(-.068,.015,.985),line(-.018,.012,.999),line(.012,0),line(.012,-.017)]);
  k.tube('rubber',lip,line(.014,-.012),.012,28);
  k.tube('leather','#73746b',line(.018,-.018),.002,28);
  for (const s of signs) {
    screw(k,cx+s*width*.87,top-drop*.87**4-.045,z+.002);
    const ventX=cx+s*width*.54,ventY=top-drop*.54**4+.012;
    k.box('rubber',rubber,[ventX,ventY,z-.10],[width*.30,.009,.045]);
    for(let i=-3;i<=3;i++)
      k.box('alloy','#595c53',[ventX+i*width*.038,ventY+.005,z-.10],[.003,.003,.037],[0,.22,0],0);
  }
}

export function bow(k,{w,h,z,base=-.39,rake=.23,color='#4e5754',gauge=.021}) {
  const arch=(delta,dz)=>Array.from({length:33},(_,i)=>{
    const a=(i/32-.5)*Math.PI, c=Math.cos(a);
    return [Math.sin(a)*(w+delta),base+c*(h+delta),z-rake*c+dz];
  });
  k.skin('alloy','#686e69',[arch(gauge+.005,-.026),arch(gauge+.004,-.004),arch(gauge-.001,.010)]);
  k.skin('paint',color,[arch(gauge,-.021),arch(gauge,.013),arch(gauge*.63,.020),arch(.003,.017),arch(0,-.021)]);
  k.tube('alloy','#a1a196',arch(gauge,.014),.0026,34);
  k.tube('rubber','#181f1e',arch(-.003,.013),.007,34);
  k.tube('rubber','#4a5049',arch(-.006,.013),.002,34);
  const edge=arch(gauge*.52,.021);
  for(let i=1;i<32;i+=3) screw(k,...edge[i],.0045);
  for(const s of signs){
    // Lower hinge knuckle and backing plate are joined to the rail at the
    // bow foot. Its transverse hinge pin sits in two separate cheeks.
    const px=s*(w+gauge*.52),py=base+.039;
    k.box('alloy','#676f6b',[px,py,z+.001],[gauge+.023,.097,.057],[0,0,-s*.045],.006);
    for(const dz of [-.025,.025]) k.box('paint',color,[px,py-.022,z+dz],[.045,.052,.012],[0,0,-s*.045],.005);
    k.rod('alloy','#9b9d8f',[px,py-.022,z-.036],[px,py-.022,z+.035],.008,12);
    screw(k,px,py+.029,z+.031,.006);
  }
}

export function spar(k,a,b,color,width=.024) {
  k.rod('rubber',rubber,a,b,width*1.18,8);
  const forward=p=>[p[0],p[1],p[2]+.007];
  k.rod('paint',color,forward(a),forward(b),width,8);
}

// The liner curls from the rim under the arms to a continuous footwell.
export function tub(k,{w=.55,center=0,rim=-.40,color='#465052',lining='#292f30',seat='#4d5248'}) {
  const depths=[-1.38,-.92,-.52,.05,.46,.79];
  for(const s of signs) {
    const rail=(offset,dy)=>depths.map((z,i)=>{
      const taper=[.69,.89,1,1.04,1.02,.82][i];
      return [center+s*(w*taper+offset),rim+dy+[.003,0,0,.012,.045,.095][i],z];
    });
    k.skin('paint',color,[rail(.058,-.04),rail(.04,.003),rail(-.018,.004),rail(-.028,-.04)]);
    k.skin('paint',lining,[rail(-.028,-.04),rail(-.008,-.20),rail(-.105,-.51),rail(-.23,-.65)]);
    k.skin('paint',color,[rail(.058,-.04),rail(.096,-.16),rail(.082,-.39),rail(-.14,-.68)]);
    k.tube('rubber',rubber,rail(.012,.008),.009,20);
    k.tube('alloy','#77796e',rail(-.017,.007),.003,20);
    for(const z of [-.38,-.06,.26]) {
      const x=center+s*w;
      k.box('alloy','#717368',[x,rim+.012,z],[.032,.008,.052]);
      k.rod('paint','#474d47',[x,rim+.015,z-.016],[x,rim+.021,z-.016],.005,8);
    }
    // Guide channel in the forward rail, its stop ends and three recessed
    // attachment points remain visible with the pilot's head facing forward.
    const channel=[[-.84,.89],[-.67,.95],[-.50,1.0],[-.34,1.01]].map(([z,t])=>[center+s*w*t,rim+.009,z]);
    k.tube('rubber','#282d2b',channel,.0075,12);
    for(const [i,p] of channel.entries()){
      const [px,py,pz]=p;
      k.rod('alloy',i%2?'#b1afa2':'#717870',[px,py,pz],[px,py+.004,pz],.006,9);
    }
    k.tube('leather',seat,[[center+s*(w-.04),rim-.16,-.29],[center+s*(w-.055),rim-.14,.04],[center+s*(w-.06),rim-.13,.24]],.034,10);
  }
  // Dished front bulkhead continues behind the panel, preventing scenery
  // showing between the pod, the inner liner and the pedals on a head tilt.
  const cross=(half,y,z)=>[[center-half,y,z],[center,y-.018,z-.025],[center+half,y,z]];
  k.skin('paint',lining,[cross(w*.72,rim-.046,-1.39),cross(w*.88,rim-.22,-1.28),cross(w*.80,rim-.50,-1.16),cross(w*.72,-.98,-1.0)]);
  k.skin('paint',lining,[cross(w*.83,rim+.09,.79),cross(w*.86,rim-.25,.79),cross(w*.74,-.98,.78)]);
  k.box('rubber',rubber,[center,-.987,-.15],[w*1.78,.035,1.92]);
  k.box('cloth',seat,[0,-.76,.14],[.42,.09,.47],[.07,0,0],.032);
  k.box('cloth',seat,[0,-.49,.39],[.44,.5,.09],[-.17,0,0],.04);
  for(const s of signs){
    k.box('cloth','#807c65',[s*.14,-.51,.328],[.045,.41,.012],[-.17,0,s*.09],.004);
    k.box('alloy',bright,[s*.14,-.50,.317],[.050,.024,.012],[-.17,0,s*.09]);
    k.rod('alloy','#636967',[s*.15,-.92,-.88],[s*.15,-.79,-.91],.013,10);
    k.box('rubber','#373c38',[s*.15,-.79,-.92],[.097,.106,.019],[-.17,0,0]);
    for(let i=-2;i<=2;i++) k.box('alloy','#797d72',[s*.15,-.79+i*.016,-.907],[.078,.005,.006],[-.17,0,0],0);
  }
}

export function stick(k,x,y,z,height=.29,grip='#30332f') {
  k.box('rubber',rubber,[x,y-.012,z],[.094,.034,.102],[0,0,0],.014);
  k.control('stick',[x,y,z],c=>{
    c.tube('alloy','#737978',[[0,0,0],[0,height*.46,-.027],[0,height*.72,.01],[0,height,.021]],.014,12);
    c.tube('rubber',grip,[[0,height*.61,.002],[0,height*.80,.018],[0,height,.021]],.024,9);
    for(let i=0;i<4;i++) c.rod('rubber','#232723',[0,height*.68+i*.014,.018],[0,height*.68+i*.014+.003,.018],.0245,12);
    c.rod('rubber',grip,[0,height-.009,.020],[0,height+.013,.018],.025,12,.021);
    c.rod('alloy','#898c81',[-.007,height+.013,.018],[-.007,height+.016,.018],.007,12);
    c.tube('rubber',grip,[[.005,height-.048,.024],[.018,height-.032,.034],[.023,height-.022,.034]],.010,8);
  });
}

export function quadrant(k,x,y,z,twin=false) {
  k.box('paint','#4c5351',[x,y-.026,z],[twin?.14:.091,.065,.21],[0,0,0],.011);
  for(const dx of twin?[-.029,.029]:[0]) {
    k.box('rubber',rubber,[x+dx,y+.008,z],[.016,.007,.15]);
  }
  k.control('throttle',[x,y,z],c=>{
    for(const dx of twin?[-.029,.029]:[0]) {
      c.rod('alloy',bright,[dx,0,0],[dx,.092,-.032],.009,8);
      c.box('rubber','#292c29',[dx,.10,-.034],[.043,.033,.064],[-.13,0,0],.01);
    }
  });
}

export function yoke(k,x,y,z) {
  k.control('yoke',[x,y,z],c=>{
    c.rod('alloy','#787a71',[0,0,-.16],[0,0,.012],.020);
    const outline=[[-.128,.107,.018],[-.124,.029,.012],[-.082,-.005,.006],[0,-.022,0],[.082,-.005,.006],[.124,.029,.012],[.128,.107,.018]];
    c.tube('rubber','#292824',outline,.016,24);
    c.box('paint','#514f49',[0,-.008,.009],[.095,.052,.038],[0,0,0],.013);
    for(const s of signs) c.tube('leather','#38352e',[[s*.121,.027,.014],[s*.129,.071,.018],[s*.128,.108,.02]],.021,9);
  });
}

export function gauges(k,z,items) {
  for(const [kind,x,y,d,scale] of items){
    k.gauge(kind,[x,y,z+.007],d,typeof scale==='string'?{title:scale}:scale);
  }
}

export function switches(k,x,y,z,n,title,pitch=.035) {
  const width=n*pitch+.022;
  k.box('paint','#303431',[x,y,z],[width,.066,.013]);
  k.label(title,[x,y+.017,z+.008],[width*.87,.012]);
  for(let i=0;i<n;i++) {
    const px=x+(i-(n-1)/2)*pitch;
    k.rod('alloy','#87887a',[px,y-.010,z+.006],[px,y-.010,z+.012],.009,8);
    k.rod('alloy','#bec0af',[px,y-.010,z+.012],[px,y-.003,z+.029],.0035,7);
  }
}

export function nose(k,color,width,length,y=-.36,center=0) {
  const section=(w,h,z)=>Array.from({length:21},(_,i)=>{
    const a=i*Math.PI/20;
    return [center+w*Math.cos(a),h+.10*Math.sin(a),z];
  });
  const panels=[section(width*.89,y-.12,-1.045),section(width,y-.02,-1.13),section(width*.85,y-.06,-1.52),section(width*.48,y-.21,-length*.77),section(.025,y-.40,-length)];
  k.skin('paint',color,panels,true);
  for(const side of [0,20]){
    const edge=panels.map(row=>row[side]);
    k.skin('paint',color,[edge,edge.map(([x,py,z])=>[x,py-.18,z])]);
  }
  for(const n of [6,14]) {
    const seam=panels.slice(1,4).map(row=>row[n]);
    k.tube('alloy','#7b827d',seam,.0022,9);
  }
}

// Section lofts retain the curved silhouettes of the pilot's lap, knees and
// boot welts during a downward head tilt, without a separate skinned avatar.
export function pilotLegs(k,{cloth='#535a4a',shoe='#37392f',spread=.144,recline=0}) {
  for(const s of signs){
    const legSection=(x,y,z,w,h,ripple=0)=>Array.from({length:29},(_,i)=>{
      const a=Math.PI*i/14;
      const fold=1+ripple*Math.cos(4*a+z*37);
      return [s*(x+Math.cos(a)*w*fold),y+Math.sin(a)*h*fold,z];
    });
    const sections=[
      [.101,-.702,.11,.095,.082],[.119,-.688,-.10,.090,.079],
      [spread,-.647+recline,-.33,.084,.076],[spread,-.652+recline,-.41,.075,.069],
      [.141,-.729+recline,-.61,.059,.055],[.141,-.802,-.80,.044,.043],
    ];
    const rows=[];
    for(let i=0;i<sections.length-1;i++){
      const a=sections[Math.max(0,i-1)],b=sections[i],c=sections[i+1],d=sections[Math.min(i+2,sections.length-1)];
      for(let j=0;j<5;j++){
        const t=j/5;
        const section=b.map((v,n)=>.5*(2*v+(-a[n]+c[n])*t+(2*a[n]-5*v+4*c[n]-d[n])*t*t+(-a[n]+3*v-3*c[n]+d[n])*t*t*t));
        const fold=.026*Math.exp(-((section[2]+.43)**2)/.018);
        rows.push(legSection(...section,fold));
      }
    }
    rows.push(legSection(...sections.at(-1)));
    k.skin('cloth',cloth,rows,true);
    k.tube('cloth','#75776a',sections.slice(0,5).map(([x,y,z,w])=>[s*(x+w*.91),y+.023,z]),.002,9);
    k.tube('cloth',cloth,[[s*(spread+.046),-.622+recline,-.457],[s*(spread+.030),-.595+recline,-.413],[s*(spread-.007),-.580+recline,-.399],[s*(spread-.043),-.593+recline,-.366]],.003,12);
    k.skin('leather',shoe,[
      legSection(.141,-.795,-.745,.05,.05),legSection(.141,-.812,-.82,.052,.05),
      legSection(.141,-.814,-.887,.054,.037),legSection(.141,-.819,-.917,.04,.028),
    ]);
  }
}
