// Exterior skin seen across the cockpit rim. Each section follows the actual
// family planform, with camber, separate trailing-edge reveal and tip closure.
const wings={
  fighter:{hull:'#596775',trim:'#445361',root:[.54,-.51,.28,2.68],tip:[4.46,-.55,2.86,.58]},
  military:{hull:'#647781',trim:'#53656b',root:[.49,-.55,.71,2.62],tip:[5.72,-.66,2.37,.73]},
  'warbird-jet':{hull:'#929d9e',trim:'#6e7981',root:[.44,-.58,.11,3.29],tip:[4.24,-.67,2.93,.57]},
  'warbird-prop':{hull:'#afb4ac',trim:'#828d85',root:[.40,-.58,-.26,1.83],tip:[5.22,-.49,.34,.65]},
  prop:{hull:'#d8d5c7',trim:'#b1b6ac',root:[.51,.354,-.72,1.53],tip:[5.55,.47,-.60,.95],cx:.27},
  glider:{hull:'#e8e4d8',trim:'#b6b9b1',root:[.32,-.32,.28,1.11],tip:[8.92,-.05,.53,.32]},
  'flying-wing':{hull:'#41484d',trim:'#353b40',root:[.69,-.45,-1.92,4.66],tip:[10.5,-.82,3.99,2.16],cx:.385}
};

export function wingViews(k,id) {
  const {hull,trim,root,tip,cx=0}=wings[id];
  for(const s of [-1,1]){
    const point=(span,chord,upper=true)=>{
      const [x,y,lead,width]=root.map((n,i)=>n+(tip[i]-n)*span);
      const camber=Math.sin(chord*Math.PI)*width*(upper?.032:-.016);
      return [cx+s*x,y+camber,lead+chord*width];
    };
    const edge=(span,upper)=>[0,.14,.35,.68,.84,1].map(chord=>point(span,chord,upper));
    k.skin('paint',hull,[edge(0,true),edge(.70,true),edge(1,true),edge(1,false),edge(.70,false),edge(0,false)]);
    // A folded leading edge covers the join between upper and lower skins.
    // The exposed bright line is minute relative to the full wing chord.
    const lineAt=(u)=>[0,.25,.55,.80,1].map(span=>point(span,u));
    k.tube('paint',trim,lineAt(.115),.0035,9);
    const metal=id==='warbird-prop'||id==='warbird-jet';
    for(const span of [.23,.51,.76]){
      const seam=[.12,.32,.52,.70].map(chord=>point(span,chord));
      k.tube('paint',trim,seam,metal?.003:.002,7);
      if(metal) for(let i=0;i<9;i++){
        const [px,py,pz]=point(span+.004,.15+i*.062);
        k.rod('alloy','#93988e',[px,py-.0006,pz],[px,py+.0013,pz],.006,6);
      }
    }
    if(id==='glider'||id==='prop'){
      const span=id==='glider'?.928:.92;
      k.skin('paint',id==='glider'?'#507784':'#335765',
        [[0,.14,.35,.68,.84,1].map(u=>{const [x,y,z]=point(span,u);return [x,y+.002,z]}),
         [0,.14,.35,.68,.84,1].map(u=>{const [x,y,z]=point(span+.026,u);return [x,y+.002,z]})]);
    }
    // Hinge and an access cover follow the surface, including its dihedral.
    for(const chord of [.71,.73]){
      const hinge=[.25,.5,.75,.93].map(span=>point(span,chord));
      k.tube('paint',trim,hinge,.004,6);
    }
    const hatch=[[.16,.32],[.24,.32],[.24,.52],[.16,.52],[.16,.32]].map(([span,chord])=>point(span,chord));
    for(let i=1;i<hatch.length;i++) k.rod('paint',trim,hatch[i-1],hatch[i],.0035,6);
    if(id==='prop'){
      k.rod('alloy','#cac9ba',[cx+s*.49,-.56,.13],point(.48,.31,false),.024,8);
      k.rod('paint','#a6aaa2',[cx+s*.49,-.56,.13],point(.48,.68,false),.016,8);
    }
  }
}

// Instrument map stowage is built in layers: folded paper sits inside the
// lip and remains visible across its top. All geometry faces into the cabin.
export function chartPocket(k,x,y,z,side,color) {
  const inward=-side;
  k.box('leather',color,[x,y,z],[.027,.143,.239],[0,0,0],.011);
  k.box('paint','#d3cbb1',[x+inward*.018,y+.049,z-.011],[.005,.101,.184],[.045,0,0],.001);
  k.box('paint','#ded6be',[x+inward*.020,y+.052,z+.018],[.005,.080,.157],[-.08,0,0],.001);
  k.box('leather',color,[x+inward*.024,y-.015,z],[.024,.093,.242],[0,0,0],.009);
  k.tube('leather','#8f8267',[[x+inward*.037,y+.026,z-.11],[x+inward*.037,y+.024,z],[x+inward*.037,y+.026,z+.11]],.0028,8);
}

export function cockpitLatches(k,x,y,z,side) {
  const tip=x-side*.027;
  k.box('paint','#545956',[x,y,z],[.044,.022,.135],[0,0,0],.005);
  for (const dz of [-.052,.052])
    k.rod('alloy','#aaa99a',[x,y+.012,z+dz],[x,y+.015,z+dz],.005,8);
  k.rod('alloy','#a5a696',[x,y+.011,z-.024],[tip,y+.047,z-.022],.008,10);
  k.tube('rubber','#373b37',[[tip,y+.046,z-.027],[tip,y+.054,z-.012],[tip,y+.054,z+.051]],.010,8);
}

// Two gently blown side lights and the quarter lights ahead of the bow. The
// laminated cut edge catches light without tinting the whole outside world.
export function bubbleGlazing(k,w,fore,aft,top,rim=-.39) {
  const crownAt=(x,y,z)=>Array.from({length:19},(_,i)=>{
    const t=(i/18-.5)*Math.PI;
    return [Math.sin(t)*x,rim+Math.cos(t)*y,z-.06*Math.cos(t)];
  });
  k.skin('glass','#b8c5bf',[
    crownAt(w*.57,-.10,fore-.53),crownAt(w*.90,top*.84,fore-.18),
    crownAt(w,top,fore),crownAt(w*1.045,top+.085,(aft+fore)*.5),
    crownAt(w*.99,top*.94,aft),crownAt(w*.65,top*.46,aft+.31),
  ],true);
}

// Removable front-panel units use captured screws, collars, knurled knobs
// and screened scales. Keeping the pointer on the knob makes its angle
// legible in grazing light even when panel lettering is below a pixel.
export function selector(k,x,y,z,r,heading,title) {
  const face=z+.006;
  k.box('paint','#39413f',[x,y,z],[r*3.2,r*3.2,.011],[0,0,0],.004);
  k.rod('alloy','#93978d',[x,y,face],[x,y,face+.005],r*1.06,20);
  k.rod('rubber','#353936',[x,y,face+.005],[x,y,face+.024],r,12,r*.92);
  k.box('paint','#bfbdac',[x+Math.sin(heading)*r*.44,y+Math.cos(heading)*r*.44,face+.025],
    [r*.12,r*.74,.0015],[0,0,-heading],0);
  for(let i=-2;i<=2;i++){
    const a=i*.63;
    k.box('paint','#d2cebc',[x+Math.sin(a)*r*1.28,y+Math.cos(a)*r*1.28,face+.001],
      [.0017,.004,.001],[0,0,-a],0);
  }
  k.label(title,[x,y-r*1.34,face+.001],[r*2.6,r*.34]);
}

export function circuitBank(k,x,y,z,title,columns=4){
  const pitch=.030, width=(columns+1)*pitch;
  k.box('paint','#353d39',[x,y,z],[width,.090,.012],[0,0,0],.004);
  k.label(title,[x,y+.032,z+.007],[width*.79,.009]);
  for(let i=0;i<columns;i++) for(let j=0;j<2;j++){
    const px=x+(i-(columns-1)/2)*pitch, py=y+.009-j*.029;
    k.rod('alloy','#797d70',[px,py,z+.006],[px,py,z+.010],.010,12);
    k.rod('rubber','#272c29',[px,py,z+.010],[px,py,z+.017],.008,10);
    k.label(String(3+(i+j)%4*2),[px,py,z+.0175],[.009,.007]);
  }
}

export function annunciator(k,x,y,z,legends) {
  const n=legends.length, width=n*.037;
  k.box('paint','#4c5553',[x,y,z],[width+.012,.040,.013],[0,0,0],.004);
  for(let i=0;i<n;i++){
    const px=x+(i-(n-1)/2)*.037;
    k.box('rubber','#242a29',[px,y,z+.009],[.034,.027,.009],[0,0,0],.003);
    const active=i===0;
    k.box('paint',active?'#54785e':'#44483d',[px,y,z+.015],[.029,.019,.003],[0,0,0],.001);
    k.label(legends[i],[px,y,z+.017],[.025,.006],undefined,active?'#d2e0c5':'#bbb9a7');
  }
}
// A formed sheet cassette. The contour is a convex outline in the X/Y
// plane; the three concentric outlines are the dark reveal, bevel and face.
export function cassette(k,outline,z,face,edge='#555c59') {
  const cx=outline.reduce((sum,p)=>sum+p[0],0)/outline.length;
  const cy=outline.reduce((sum,p)=>sum+p[1],0)/outline.length;
  const strip=(scale,depth)=>[...outline,outline[0]].map(([x,y])=>[cx+(x-cx)*scale,cy+(y-cy)*scale,z+depth]);
  k.skin('rubber','#1b201e',[strip(1.028,.001),strip(1.028,.004),strip(1,.005)]);
  k.skin('alloy',edge,[strip(1,.005),strip(.979,.008)]);
  const front=strip(.979,.008);
  const center=[cx,cy,z+.008];
  for(let i=0;i<outline.length;i++){
    const prev=front[(i+outline.length-1)%outline.length],p=front[i],next=front[i+1];
    const midpoint=q=>[(p[0]+q[0])*.5,(p[1]+q[1])*.5,p[2]];
    k.skin('paint',face,[[p,midpoint(next)],[midpoint(prev),center]]);
  }
  // A pair of slot-head quarter-turns retain the cassette at its shoulders.
  for(const i of [0,Math.floor(outline.length/2)]){
    const p=front[i];
    const x=p[0]+(cx-p[0])*.066,y=p[1]+(cy-p[1])*.066;
    k.rod('alloy','#858a7f',[x,y,z+.008],[x,y,z+.010],.0043,9);
    k.box('paint','#30342f',[x,y,z+.0105],[.005,.0014,.001],[0,0,i*.8+.37],0);
  }
}

export function browLamp(k,x,y,z,side) {
  // A shrouded chart lamp casts toward the panel. The ground glass stays
  // under its hood, so the pilot sees only the lens and the sprung clip.
  k.box('alloy','#68716d',[x,y,z],[.054,.058,.013],[0,0,-side*.19],.004);
  k.rod('paint','#38413f',[x,y+.002,z+.006],[x+side*.004,y-.010,z+.049],.019,14,.016);
  k.rod('alloy','#878a7c',[x+side*.004,y-.010,z+.049],[x+side*.004,y-.011,z+.053],.017,16,.016);
  k.rod('glass','#dfdec3',[x+side*.004,y-.011,z+.053],[x+side*.004,y-.012,z+.055],.013,14);
}

export function harnessGear(k,w,era) {
  const olive=era==='period'?'#6a654c':'#59624e';
  for(const s of [-1,1]){
    const x=s*.144;
    // Individual ribbon segments bridge the leg loft, including the turn
    // over the outside of the knee and the rolled edge at the buckle.
    const section=(dy,dz)=>[
      [x+s*.081,-.628+dy,-.399+dz],[x+s*.049,-.591+dy,-.399+dz],
      [x,-.576+dy,-.399+dz],[x-s*.050,-.592+dy,-.399+dz],
    ];
    k.skin('cloth',olive,[section(0,0),section(.001,.027)]);
    k.box('alloy','#93958a',[x,-.574,-.384],[.042,.007,.038],[-.10,0,s*.07],.004);
    k.box('cloth','#474d41',[x,-.570,-.384],[.030,.004,.025],[-.10,0,s*.07],.002);
    // Recessed footwell edging and curved longerons under the console.
    const p=[[s*(w-.085),-.60,-.88],[s*(w-.074),-.67,-.67],[s*(w-.068),-.72,-.38]];
    k.tube('rubber','#252e2e',p,.013,12);
  }
}

export function leatherWelt(k,w,y,z,drop,period) {
  const lip=x=>y-drop*(x/w)**4;
  // Saddle stitching takes short flat segments across the pilot-facing
  // fold, stopping at the hidden ends of the padded glareshield.
  for(let i=0;i<40;i++){
    const x=-w*.89+i*w*.045;
    k.rod('cloth',period?'#96876c':'#80857a',[x,lip(x)-.003,z+.012],[x+.009,lip(x+.009)-.003,z+.014],.0015,5);
  }
}
export function instrumentHood(k,x,y,z,width,reach,color) {
  const arch=(depth,dy)=>Array.from({length:15},(_,i)=>{
    const t=(i-7)/7;
    return [x+width*.5*t,y+dy-.025*t**4,z+depth*(1-.32*t*t)];
  });
  k.skin('paint',color,[arch(-.007,-.016),arch(-.001,.001),arch(reach*.70,.006),arch(reach,.002),arch(reach,-.006)]);
  k.tube('rubber','#29302d',arch(reach,-.005),.003,16);
}

export function railCatch(k,x,y,z,side,period) {
  const xs=d=>x-side*d;
  k.box('paint',period?'#676e51':'#484e4b',[x,y,z],[.026,.106,.153],[0,0,0],.006);
  k.label(period?'HOOD LOCK':'CANOPY LOCK',[xs(.014),y-.029,z],[.089,.010],[0,-side*Math.PI/2,0]);
  for(const t of [-1,1]) {
    k.rod('alloy','#939689',[xs(.012),y+.018,z+t*.050],[xs(.022),y+.018,z+t*.050],.014,12);
    k.rod('paint','#54594f',[xs(.020),y+.018,z+t*.050],[xs(.041),y+.038,z+t*.037],.007,8);
  }
  k.tube(period?'leather':'rubber',period?'#76664e':'#343b37',[
    [xs(.038),y+.034,z-.043],[xs(.045),y+.040,z-.032],[xs(.045),y+.040,z+.033],[xs(.038),y+.034,z+.043]
  ],.010,12);
}
