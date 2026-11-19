import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { mercatorScale, M_TO_FT, MPS_TO_KT, RAD2DEG } from './coords.js';

const tau = Math.PI * 2;
const ivory = '#e3e4cd', green = '#96dfad';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hdg = v => String((Math.round(v) % 360 + 360) % 360).padStart(3, '0');
const defaults = {
  airspeed:['AIRSPEED','KNOTS',0,400], altitude:['ALTITUDE','FEET',0,1000],
  attitude:['ATTITUDE','',0,0], heading:['DIRECTION','',0,360], turn:['TURN COORDINATOR','2 MIN',0,0],
  vsi:['VERTICAL SPEED','1000 FT/MIN',-6,6], rpm:['TACHOMETER','RPM ×100',0,35],
  fuel:['QUANTITY','FUEL %',0,100], pressure:['OIL PRESS','PSI',0,100],
  temperature:['TEMP','°C',0,150], mach:['MACH','',0,2.2],
  n1:['N1','% RPM',0,110], n2:['N2','% RPM',0,110], egt:['EGT','°C',0,900],
};
function text(c, words, x, y, px, color = ivory, align = 'center') {
  c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle';
  c.font = '600 ' + px + 'px Consolas, monospace'; c.fillText(words,x,y);
}
function line(c, x, y, x2, y2, color, width = 1) {
  c.beginPath(); c.moveTo(x,y); c.lineTo(x2,y2); c.lineWidth=width; c.strokeStyle=color; c.stroke();
}
function radial(c, a, r1, r2, color, w) {
  line(c, Math.sin(a)*r1, -Math.cos(a)*r1, Math.sin(a)*r2, -Math.cos(a)*r2, color, w);
}
function arc(c,x,y,r,start,end,color,width) {
  c.beginPath(); c.arc(x,y,r,start,end); c.strokeStyle=color; c.lineWidth=width; c.stroke();
}
function horizon(c, f, size) {
  c.save(); c.rotate(-f.bank); c.translate(0, clamp(f.pitch, -1.56, 1.56)*size*1.45);
  c.fillStyle='#476f8b'; c.fillRect(-2*size,-4*size,4*size,4*size);
  c.fillStyle='#846044'; c.fillRect(-2*size,0,4*size,4*size);
  line(c,-2*size,0,2*size,0,'#f5efd9',1.4);
  for (let mark=-60; mark<=60; mark+=5) {
    if (!mark) continue;
    const y = -mark/RAD2DEG*size*1.45, width = size*(mark%10 ? .09 : .17);
    line(c,-width,y,width,y,'#f3f0dc',1);
    if (!(mark%10)) text(c,Math.abs(mark),width+8,y,7);
  }
  c.restore();
}
function aircraftMark(c, size) {
  for (const s of [-1,1]) {
    line(c,s*size*.46,0,s*size*.12,0,'#241e18',5);
    line(c,s*size*.46,0,s*size*.12,0,'#ecbb64',2.5);
    line(c,s*size*.12,0,s*size*.12,4,'#ecbb64',2.5);
  }
  c.fillStyle='#f3ce80'; c.fillRect(-2,-2,4,4);
}
function compass(c, heading, r) {
  for(let d=0;d<360;d+=5) {
    const a=(d-heading)/RAD2DEG;
    radial(c,a,r,r-(d%30 ? 4 : 9),ivory, d%10 ? .9 : 1.7);
    if (!(d%30)) text(c, ['N','E','S','W'][d/90] || d/10, Math.sin(a)*(r-17),-Math.cos(a)*(r-17),10);
  }
  radial(c,0,r-2,r+4,'#edb761',3);
}
function needle(c,a,len,color,width) {
  c.save(); c.rotate(a);
  c.shadowColor='#000'; c.shadowBlur=2; c.shadowOffsetX=1.5; c.shadowOffsetY=2;
  c.beginPath(); c.moveTo(-width,10); c.lineTo(-width*.61,-len+7); c.lineTo(0,-len);
  c.lineTo(width*.61,-len+7); c.lineTo(width,10); c.closePath(); c.fillStyle=color; c.fill();
  c.restore();
}

function drawDial(c, item, s) {
  const {kind, opts} = item;
  const [name,unit,lower,upper] = defaults[kind];
  const min=opts.min ?? lower, max=opts.max ?? upper;
  c.translate(64,64);
  if (item.background) c.drawImage(item.background,-64,-64,128,128);
  else {
    const enamel=c.createRadialGradient(-18,-26,2,0,0,68);
    enamel.addColorStop(0,'#343837'); enamel.addColorStop(.8,'#171b1c'); enamel.addColorStop(1,'#080b0b');
    c.fillStyle=enamel; c.fillRect(-64,-64,128,128);
    arc(c,0,0,61,0,tau,'#545854',1.2);
  }
  if (kind === 'attitude') {
    c.save(); c.beginPath(); c.arc(0,0,48,0,tau); c.clip(); horizon(c,s,50); c.restore();
    aircraftMark(c,62);
    for (let i=-60;i<=60;i+=10) radial(c,i/RAD2DEG,54, i%30?57:61,ivory,1.5);
    return;
  }
  if (kind === 'heading') {
    compass(c,s.heading,55); line(c,0,16,0,-21,'#c8b260',2); line(c,-14,1,14,1,'#c8b260',3);
    text(c,hdg(s.heading),0,21,9); return;
  }
  if (kind === 'turn') {
    text(c,'TURN COORDINATOR',0,-31,7); text(c,'L',-38,1,10); text(c,'R',38,1,10);
    c.save(); c.rotate(-clamp(s.bank,-.65,.65)); aircraftMark(c,67); c.restore();
    arc(c,0,-55,84,1.27,1.87,'#b5baae',6); arc(c,0,29,3,0,tau,'#202726',4);
    text(c,'2 MIN',0,43,7); return;
  }
  const alt = kind === 'altitude';
  const start=alt?0:-2.42, sweep=alt?tau:4.84;
  // Graduations and lettering are behind the pointer, physically inside the rim.
  if (!item.background) {
    for(let i=0;i<=50;i++){
      const major=i%5===0, a=start+sweep*i/50;
      radial(c,a,56,major?47:52,ivory,major?2:1);
      if (major && (!alt || i<50)) {
        const value=alt ? i/5 : min+(max-min)*i/50;
        text(c,Math.abs(max-min)>15?Math.round(value):Number(value.toFixed(1)),Math.sin(a)*38,-Math.cos(a)*38,10);
      }
    }
    text(c,opts.title || name,0,18,7.2); text(c,opts.unit ?? unit,0,28,6.7,'#babcae');
    // Keep the sub-dial at its original texel density for subsequent frames.
    const {x,y,width} = item;
    const background=document.createElement('canvas');
    background.width=background.height=width;
    background.getContext('2d').drawImage(c.canvas,x,y,width,width,0,0,width,width);
    item.background=background;
  }
  let value;
  switch(kind) {
    case 'altitude': value=(s.alt%1000+1000)%1000; break;
    case 'vsi': value=(opts.unit === 'm/s' ? s.vsi/196.85 : s.vsi/1000); break;
    case 'airspeed': value=s.speed; break;
    case 'mach': value=s.mach; break;
    case 'rpm': value=max>100 ? (650+2100*s.thrust) : (6.5+21*s.thrust); break;
    case 'n1': value=26+72*s.thrust; break;
    case 'n2': value=55+43*s.thrust; break;
    case 'egt': value=280+425*s.thrust; break;
    case 'pressure': value=min+(max-min)*(.41+.31*s.thrust); break;
    case 'temperature': value=min+(max-min)*(.40+.27*s.thrust); break;
    case 'fuel': value=min+(max-min)*.72; break;
  }
  if (alt) {
    text(c,String(Math.round(s.alt)).padStart(5,'0'),0,-18,8,'#d1d2c2');
    needle(c,tau*s.alt/10000,33,'#d5d0bb',2.9);
  }
  needle(c,start+sweep*clamp((value-min)/(max-min),0,1),48,'#f2f0d6',2.1);
  arc(c,0,0,4,0,tau,'#545953',3);
  const sheen=c.createLinearGradient(-50,-60,35,56);
  sheen.addColorStop(0,'rgba(202,223,218,.10)'); sheen.addColorStop(.46,'rgba(202,223,218,0)');
  sheen.addColorStop(1,'rgba(199,219,216,.025)'); c.fillStyle=sheen; c.fillRect(-64,-64,128,128);
}

function tape(c,x,value,step,unit) {
  c.fillStyle='#253037'; c.fillRect(x,22,23,76);
  const base=Math.floor(value/step)*step;
  for(let i=-3;i<=3;i++){
    const mark=base+i*step, y=59+(value-mark)*13/step;
    if(mark<0 || y<25 || y>93) continue;
    text(c,mark,x+10,y,5.8); line(c,x+19,y,x+22,y,'#bbcabe',.8);
  }
  c.fillStyle='#080f14'; c.fillRect(x-1,53,25,13);
  text(c,Math.round(value),x+11,60,8); text(c,unit,x+11,103,5.7,'#79c5ca');
}
function drawScreen(c,{kind,opts},s,runtime) {
  if (kind === 'hud') {
    text(c,hdg(s.heading),64,25,12,green); text(c,Math.round(s.speed),18,69,11,green); text(c,Math.round(s.alt),105,69,11,green);
    c.translate(64,69); c.rotate(-s.bank);
    for(let d=-10;d<=10;d+=5){ const y=(s.pitch*RAD2DEG-d)*2.4; if(Math.abs(y)<32){line(c,-17,y,-5,y,green,1);line(c,5,y,17,y,green,1);} }
    return;
  }
  if (kind === 'strip') {
    const reading = {'SPEED':Math.round(s.speed),'HEADING':hdg(s.heading),'ALTITUDE':Math.round(s.alt/10)*10,'VERT SPEED':Math.round(s.vsi/100)*100};
    c.fillStyle='#151b19'; c.fillRect(0,0,128,128);
    c.scale(1,2.8); text(c,reading[opts.title],64,23,25,'#dacc95');
    return;
  }
  if (kind === 'ins') {
    const f=runtime.flight, lat=f.latDeg ?? 0, lon=runtime.geo?.x ?? 0;
    c.fillStyle='#151a18'; c.fillRect(0,0,128,128); c.scale(1,3.2);
    text(c,Math.abs(lat).toFixed(2)+(lat<0?'S':'N'),32,19,15,'#cfae70');
    text(c,Math.abs(lon).toFixed(2)+(lon<0?'W':'E'),95,19,15,'#cfae70');
    return;
  }
  if (kind === 'radio') {
    // Radios are ribbon displays. Give the numerals their proper physical
    // aspect regardless of whether the cut-out is 2:1 or 4:1.
    c.fillStyle='#101b1a'; c.fillRect(0,0,128,128);
    const aspect=opts.aspect || 3;
    c.scale(1,aspect);
    const h=128/aspect;
    text(c,'COM 1',5,h*.22,6,'#a0bcaa','left');
    text(c,'STANDBY',74,h*.22,5.5,'#a0bcaa','left');
    text(c,'121.500',4,h*.66,12.5,green,'left'); text(c,'122.800',72,h*.66,10.5,'#c9c79c','left');
    return;
  }
  c.fillStyle='#10191f'; c.fillRect(0,0,128,128);
  const title=opts.title ?? ({pfd:'FLIGHT DISPLAY',nav:'NAV DISPLAY',engine:'ENGINES',radio:'RADIO',fms:'FLIGHT PLAN'}[kind]);
  text(c,title,5,7,7,'#b8dbdd','left'); line(c,4,13,124,13,'#45585d',1);
  if (kind === 'pfd') {
    c.save(); c.beginPath(); c.rect(3,16,122,85); c.clip(); c.translate(64,60);
    horizon(c,s,55); aircraftMark(c,44); c.restore();
    tape(c,4,s.speed,20,'KT'); tape(c,101,s.alt,500,'FT');
    c.save(); c.translate(64,155); compass(c,s.heading,48); c.restore();
    text(c,hdg(s.heading),64,112,8,'#a9e5c4');
  } else if (kind === 'nav') {
    const x=64,y=81,range=22*1852*mercatorScale(runtime.flight.latDeg || 0);
    c.save(); c.beginPath(); c.rect(2,16,124,101); c.clip(); c.translate(x,y);
    for(const r of [19,38,57]) arc(c,0,0,r,0,tau,'#425654',.8);
    compass(c,s.heading,57);
    c.save(); c.rotate(-s.heading/RAD2DEG);
    let names=0;
    for (const poi of runtime.poiSlots ?? []) {
      const px=(poi.wx-runtime.flight.pos.x)/range*56, py=(poi.wz-runtime.flight.pos.z)/range*56;
      if(Math.hypot(px,py)<50) {
        c.save(); c.translate(px,py); c.rotate(s.heading/RAD2DEG);
        c.strokeStyle='#76aaad'; c.strokeRect(-1,-1,2,2);
        if (names < 3 && poi.name && Math.hypot(px,py)>14+names*7) {
          text(c,poi.name.slice(0,7).toUpperCase(),3,-3,4.5,'#a7c6be','left'); names++;
        }
        c.restore();
      }
    }
    c.restore();
    line(c,0,10,0,-10,ivory,2); line(c,-6,3,6,3,ivory,1.5); c.restore();
    text(c,'22 NM',5,120,7,green,'left'); text(c,hdg(s.heading)+'°',124,120,7,'#d7d5aa','right');
  } else if (kind === 'engine') {
    const n=opts.engines ?? 2;
    for(let i=0;i<n;i++){
      const x=(i+.5)*128/n, r=Math.min(21,50/n);
      text(c,'ENG '+(i+1),x,23,7);
      for(const [j,label,val,top] of [[0,'N1',26+72*s.thrust,110],[1,'EGT',280+425*s.thrust,900]]){
        const y=47+j*48, end=Math.PI*(.76+1.50*val/top);
        arc(c,x,y,r,Math.PI*.75,Math.PI*2.26,'#61716c',2.5);
        arc(c,x,y,r,Math.PI*.75,end,green,2.5);
        line(c,x,y,x+r*Math.cos(end),y+r*Math.sin(end),ivory,1.5);
        text(c,Math.round(val),x,y+8,8); text(c,label,x,y+20,6,'#7ea4ac');
      }
    }
  } else if(kind === 'fms') {
    const f=runtime.flight;
    text(c,'PRESENT POSITION',9,28,9,green,'left');
    for(const [i,caption,value] of [[0,'LAT',f.latDeg?.toFixed(3)],[1,'LON',runtime.geo?.x?.toFixed(3)],[2,'TRK',hdg(s.heading)],[3,'GS',Math.round(s.speed)+' KT']]){
      text(c,caption,8,47+i*19,8,'#91acb2','left');text(c,value ?? '----',119,47+i*19,9,ivory,'right');
    }
  }
}

// Faces with the same range and artwork share texels across both seats. Static
// mesh UVs reference one atlas, so a Concorde instrument cluster is one draw.
export function makeInstrumentAtlas(compact) {
  const items = new Map(), cell = compact ? 128 : 224;
  let c, canvas, texture;
  function register(kind, opts, dial) {
    if (dial && !Object.hasOwn(defaults,kind)) throw Error('Unknown cockpit dial '+kind);
    const {title,min,max,unit,engines,aspect} = opts;
    const key=JSON.stringify([kind,title,min,max,unit,engines,aspect,dial]);
    if (!items.has(key)) items.set(key,{kind,opts:{title,min,max,unit,engines,aspect},dial});
    return items.get(key);
  }
  function bake() {
    const cols=Math.max(1,Math.ceil(Math.sqrt(items.size))), rows=Math.max(1,Math.ceil(items.size/cols));
    canvas=document.createElement('canvas'); canvas.width=cols*cell; canvas.height=rows*cell;
    c=canvas.getContext('2d');
    let i=0;
    for(const item of items.values()){
      item.x=(i%cols)*cell; item.y=Math.floor(i/cols)*cell; item.width=cell; i++;
      item.rect=[(item.x+1)/canvas.width,1-(item.y+cell-1)/canvas.height,(cell-2)/canvas.width,(cell-2)/canvas.height];
    }
    texture=new CanvasTexture(canvas); texture.colorSpace=SRGBColorSpace;
    texture.generateMipmaps=false; texture.minFilter=LinearFilter; texture.anisotropy=2;
    return texture;
  }
  function update(runtime,thrust) {
    const f=runtime.flight;
    if(!f) return;
    const soundSpeed=Math.sqrt(1.4*287.05*Math.max(216.65,288.15-.0065*f.pos.y));
    const s={speed:f.speed*MPS_TO_KT,alt:f.pos.y*M_TO_FT,heading:f.heading*RAD2DEG,bank:f.bank,pitch:f.pitch,
      vsi:runtime.operations?.grounded ? 0 : Math.sin(f.pitch)*f.speed*M_TO_FT*60, mach:f.speed/soundSpeed,thrust};
    for(const item of items.values()){
      c.save(); c.translate(item.x,item.y); c.scale(cell/128,cell/128);
      c.beginPath(); c.rect(0,0,128,128); c.clip(); c.clearRect(0,0,128,128);
      if(item.dial) drawDial(c,item,s); else drawScreen(c,item,s,runtime);
      c.restore();
    }
    texture.needsUpdate=true;
  }
  return {register,bake,update};
}
