import { CanvasTexture, LinearFilter, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { mercatorScale, MPS_TO_KT, M_TO_FT, RAD2DEG } from './coords.js';

const ink = '#e1eee2', phosphor = '#93e6a5', subdued = '#9aafa9', rule = '#36504e';
const font = 'Consolas, ui-monospace, monospace';
const bearing = value => String((Math.round(value) % 360 + 360) % 360).padStart(3, '0');
const thousands = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function surface(width, height, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx?.scale(canvas.width / width, canvas.height / height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return { ctx, texture };
}

function text(c, value, x, y, size, color = ink, align = 'left') {
  c.font = '500 ' + size + 'px ' + font;
  c.textAlign = align;
  c.fillStyle = color;
  c.fillText(value, x, y);
}
function line(c, color, x1, y1, x2, y2, width = 1) {
  c.strokeStyle = color; c.lineWidth = width;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
}
function box(c, x, y, w, h, fill, border) {
  c.fillStyle = fill; c.fillRect(x, y, w, h);
  if (border) { c.strokeStyle = border; c.lineWidth = 1.5; c.strokeRect(x, y, w, h); }
}
function arc(c, x, y, r, from, to, color, width = 1) {
  c.beginPath(); c.arc(x, y, r, from, to); c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
function ticks(c, x, y, r, start, end, spacing, major, color) {
  for (let d = start; d <= end; d += spacing) {
    const a = d / RAD2DEG, inner = r - (d % major === 0 ? 10 : 4);
    line(c, color, x + inner * Math.sin(a), y - inner * Math.cos(a), x + r * Math.sin(a), y - r * Math.cos(a));
  }
}

function tape(c, x, value, step, label, right) {
  const w = 64, center = 190, edge = right ? x : x + w;
  box(c, x, 92, w, 195, '#162321', rule);
  c.save(); c.beginPath(); c.rect(x, 94, w, 191); c.clip();
  const base = Math.floor(value / step) * step;
  for (let i = -3; i <= 3; i++) {
    const mark = base + i * step;
    const y = center + (value - mark) * 35 / step;
    if (mark < 0) continue;
    line(c, subdued, edge, y, edge + (right ? 7 : -7), y);
    text(c, mark, right ? x + 10 : x + w - 10, y + 4, 12, subdued, right ? 'left' : 'right');
  }
  c.restore();
  box(c, x - 2, center - 14, w + 4, 28, '#081410', phosphor);
  text(c, value, x + w / 2, center + 7, 19, ink, 'center');
  text(c, label, x + w / 2, 82, 13, phosphor, 'center');
}

function primaryFlight(c, flight, speed, altitude, heading) {
  const cx = 186, cy = 187;
  c.save(); c.beginPath(); c.rect(23, 76, 328, 221); c.clip();
  c.translate(cx, cy); c.rotate(-flight.bank);
  c.translate(0, flight.pitch * RAD2DEG * 3.5);
  const earth = c.createLinearGradient(0, -150, 0, 150);
  earth.addColorStop(0, '#21485d'); earth.addColorStop(.499, '#568090');
  earth.addColorStop(.5, '#695940'); earth.addColorStop(1, '#403c32');
  box(c, -450, -700, 900, 1400, earth);
  line(c, '#e5f1de', -450, 0, 450, 0, 2);
  for (let deg = -80; deg <= 80; deg += 5) {
    if (!deg) continue;
    const y = -deg * 3.5, extent = deg % 10 ? 15 : 28;
    line(c, ink, -extent, y, extent, y, 1.4);
    if (deg % 10 === 0) text(c, Math.abs(deg), extent + 5, y + 4, 11);
  }
  c.restore();
  arc(c, cx, cy, 83, -2.34, -.8, subdued);
  ticks(c, cx, cy, 83, -45, 45, 15, 30, ink);
  for (const s of [-1, 1]) {
    line(c, '#141811', cx + s * 39, cy, cx + s * 10, cy, 6);
    line(c, '#f3cf76', cx + s * 39, cy, cx + s * 10, cy, 3);
    line(c, '#f3cf76', cx + s * 10, cy, cx + s * 10, cy + 6, 3);
  }
  box(c, cx - 2, cy - 2, 4, 4, '#f3cf76');
  tape(c, 12, speed, 20, 'TAS KT', false);
  tape(c, 300, altitude, 500, 'ALT FT', true);
  // Heading ribbon behind a fixed lubber line.
  c.save(); c.beginPath(); c.rect(24, 309, 325, 42); c.clip();
  const first = Math.floor(heading / 5) * 5;
  for (let i = -7; i <= 7; i++) {
    const deg = first + i * 5, x = cx + (deg - heading) * 5;
    line(c, subdued, x, 311, x, deg % 10 ? 318 : 322);
    if (deg % 10 === 0) text(c, bearing(deg), x, 338, 12, subdued, 'center');
  }
  c.restore();
  box(c, cx - 25, 313, 50, 27, '#0c1714', phosphor);
  text(c, bearing(heading), cx, 333, 19, phosphor, 'center');
}

function navigation(c, runtime, flight) {
  const cx = 547, cy = 208, r = 113, range = 22 * 1852 * mercatorScale(flight.latDeg);
  const toX = x => cx + (x - flight.pos.x) * r / range;
  const toY = z => cy + (z - flight.pos.z) * r / range;
  c.save(); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
  const scope = c.createRadialGradient(cx, cy, 2, cx, cy, r);
  scope.addColorStop(0, '#173331'); scope.addColorStop(1, '#102323');
  box(c, cx-r, cy-r, r*2, r*2, scope);
  for (let i = -3; i <= 3; i++) {
    line(c, '#223e3b', cx + 35*i, cy-r, cx + 35*i, cy+r);
    line(c, '#223e3b', cx-r, cy + 35*i, cx+r, cy + 35*i);
  }
  c.setLineDash([3, 5]); arc(c,cx,cy,r/2,0,2*Math.PI,'#4d6660'); c.setLineDash([]);
  const labels = [];
  for (const p of runtime.poiSlots ?? []) {
    const x = toX(p.wx), y = toY(p.wz);
    if (!Number.isFinite(x+y) || Math.hypot(x-cx,y-cy) > r-3) continue;
    c.strokeStyle = '#83c2ce'; c.strokeRect(x-2,y-2,4,4);
    if (p.name && labels.length < 5 && labels.every(q => Math.abs(q.x-x)>46 || Math.abs(q.y-y)>14)) {
      text(c,p.name.slice(0,9).toUpperCase(),x+5,y-3,10,'#a7d3d7'); labels.push({x,y});
    }
  }
  for (const p of runtime.traffic?.items ?? []) {
    const x=toX(p.rx), y=toY(p.rz);
    if (Number.isFinite(x+y) && Math.hypot(x-cx,y-cy)<r) box(c,x-1.5,y-1.5,3,3,phosphor);
  }
  c.save(); c.translate(cx,cy); c.rotate(flight.heading);
  c.setLineDash([6,4]); line(c,phosphor,0,-10,0,-r); c.setLineDash([]);
  c.beginPath(); c.moveTo(0,-9); c.lineTo(6,7); c.lineTo(0,4); c.lineTo(-6,7);
  c.closePath(); c.fillStyle=ink; c.fill(); c.restore(); c.restore();
  arc(c,cx,cy,r,0,2*Math.PI,'#76918a'); ticks(c,cx,cy,r,0,350,10,30,subdued);
  for (const [d, x, y] of [['N',cx,cy-r-6],['E',cx+r+13,cy+4],['S',cx,cy+r+17],['W',cx-r-13,cy+4]])
    text(c,d,x,y,14,ink,'center');
  text(c,'22 NM',696,347,13,subdued,'right');
}
function panelPage(c, runtime, f, speed, alt, hdg) {
  box(c,0,0,1000,400,'#091412');
  for (const [x,w,label] of [[0,375,'PRIMARY FLIGHT'],[377,340,'NAVIGATION'],[719,281,'AIR DATA']]) {
    box(c,x+2,3,w-4,38,'#20322e');
    line(c,'#849a8f',x+2,42,x+w-2,42);
    text(c,label,x+15,29,19,ink);
    if(x)line(c,rule,x-1,3,x-1,396,2);
  }
  primaryFlight(c,f,speed,alt,hdg);
  text(c,'N UP',393,71,13,subdued); navigation(c,runtime,f);
  const agl=Number.isFinite(f.agl) ? thousands.format(Math.max(0,f.agl)*M_TO_FT) : '—';
  const fields=[['TRUE AIRSPEED',speed,'KT'],['BARO ALT',thousands.format(alt),'FT'],['HEIGHT AGL',agl,'FT']];
  fields.forEach(([name,value,unit],i)=>{
    const y=79+i*94;
    text(c,name,739,y,15,subdued); text(c,value,940,y+42,38,phosphor,'right');
    text(c,unit,950,y+41,15,subdued);
    line(c,rule,738,y+57,982,y+57);
  });
  line(c,rule,4,358,996,358);
  text(c,'BANK',16,385,14,subdued);
  const bank=f.bank*RAD2DEG;
  text(c,Math.abs(Math.round(bank))+'°'+(Math.abs(bank)>.5?(bank>0?' R':' L'):''),70,385,18);
  text(c,'PITCH',181,385,14,subdued); text(c,Math.round(f.pitch*RAD2DEG)+'°',245,385,18);
  const place=runtime.nearestPoi?.split(' · ')[0];
  text(c,place?.slice(0,22).toUpperCase() ?? 'NORTH UP',392,385,15,subdued);
  text(c,'HDG',738,385,14,subdued); text(c,bearing(hdg)+'°',980,385,19,phosphor,'right');
}

// The tape follows the gaze. Project the earth horizon into the physical
// visor plane, so its marks bank with the world even in a sideways glance.
function visorPage(c, speed, alt, hdg, eyeUp, width, centerY) {
  c.clearRect(0,0,520,206);
  c.save(); c.shadowColor='#102813'; c.shadowBlur=2.5;
  const green='#b4ffad';
  if (eyeUp.y>.28) {
    const scale=520/width;
    const horizon=103+(centerY-eyeUp.z/eyeUp.y)*scale;
    c.save();
    c.beginPath(); c.rect(127,49,266,147); c.clip();
    c.translate(260,horizon); c.rotate(Math.atan2(eyeUp.x,eyeUp.y));
    for(const degrees of [-10,-5,0,5,10]) {
      const y=-Math.tan(degrees/RAD2DEG)*scale, span=degrees===0?59:31;
      c.setLineDash(degrees<0?[5,4]:[]);
      line(c,green,-span,y,-15,y,1.35); line(c,green,15,y,span,y,1.35);
      c.setLineDash([]);
      if(degrees)text(c,String(Math.abs(degrees)),span+5,y+4,11,green);
    }
    c.restore();
  }
  for (const [x,w,value,unit] of [[8,74,speed,'KT'],[417,95,thousands.format(alt),'FT']]) {
    c.strokeStyle=green; c.lineWidth=1.35; c.strokeRect(x,100,w,28);
    text(c,value,x+w/2,121,21,green,'center'); text(c,unit,x+w/2,145,12,green,'center');
  }
  for(let i=-4;i<=4;i++){
    const mark=Math.floor(hdg/5)*5+i*5, x=260+(mark-hdg)*4;
    line(c,green,x,33,x,mark%10?28:24);
    if(mark%10===0 && Math.abs(x-260)>24)text(c,bearing(mark),x,21,11,green,'center');
  }
  text(c,bearing(hdg),260,26,18,green,'center');
  line(c,green,255,31,260,36); line(c,green,260,36,265,31);
  c.restore();
}

export function createPilotDisplays(compact = false) {
  const panel=surface(1000,400,compact ? .8 : 1.35), hud=surface(520,206,compact ? .85 : 1.3);
  const eyeUp=new Vector3(), look=new Vector3(), inverse=new Quaternion();
  return {
    panel, hud,
    update(runtime, orientation, visorWidth, visorCenterY) {
      const f=runtime.flight;
      if(!f) return;
      const speed=Math.round(f.speed*MPS_TO_KT), alt=Math.round(f.pos.y*M_TO_FT), hdg=f.heading*RAD2DEG;
      if(panel.ctx) panelPage(panel.ctx,runtime,f,speed,alt,hdg);
      if(hud.ctx) {
        eyeUp.set(0,1,0).applyQuaternion(inverse.copy(orientation).invert());
        look.set(0,0,-1).applyQuaternion(orientation);
        const gazeHeading=(Math.atan2(look.x,-look.z)*RAD2DEG+360)%360;
        visorPage(hud.ctx,speed,alt,gazeHeading,eyeUp,visorWidth,visorCenterY);
      }
      panel.texture.needsUpdate=true; hud.texture.needsUpdate=true;
    },
    dispose() { panel.texture.dispose(); hud.texture.dispose(); }
  };
}
