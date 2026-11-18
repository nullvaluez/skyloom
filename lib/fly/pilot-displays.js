import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { mercatorScale, MPS_TO_KT, M_TO_FT, RAD2DEG } from './coords.js';

const green = '#9be2ae', white = '#d9ead8', muted = '#729987', grid = '#344f45';
function surface(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return { ctx, texture };
}
function line(c, color, x1, y1, x2, y2, width = 1) {
  c.strokeStyle = color; c.lineWidth = width;
  c.beginPath(); c.moveTo(x1,y1); c.lineTo(x2,y2); c.stroke();
}
function text(c, value, x, y, size, color = green, align = 'left') {
  c.fillStyle = color; c.font = '500 ' + size + 'px ui-monospace, Consolas, monospace';
  c.textAlign = align; c.fillText(value,x,y);
}
function circle(c, x, y, r, color) {
  c.strokeStyle=color; c.lineWidth=1.2;
  c.beginPath(); c.arc(x,y,r,0,2*Math.PI); c.stroke();
}
function wingMark(c, x, y, scale, color) {
  line(c,color,x-14*scale,y,x-5*scale,y,2);
  line(c,color,x-5*scale,y,x,y+3*scale,2);
  line(c,color,x,y+3*scale,x+5*scale,y,2);
  line(c,color,x+5*scale,y,x+14*scale,y,2);
}

/** A north-up navigation scope uses the same actual place and aircraft
 * positions as the game minimap. No tile requests or fictitious map data. */
function navigation(c, runtime, flight, hdg) {
  const cx=354, cy=133, radius=77;
  const range=22*1852*mercatorScale(flight.latDeg);
  c.save(); c.beginPath();c.arc(cx,cy,radius,0,2*Math.PI);c.clip();
  c.fillStyle='#0a1e1b';c.fillRect(cx-radius,cy-radius,2*radius,2*radius);
  for (let i=-3;i<=3;i++) {
    line(c,'#16302b',cx+i*24,cy-radius,cx+i*24,cy+radius);
    line(c,'#16302b',cx-radius,cy+i*24,cx+radius,cy+i*24);
  }
  circle(c,cx,cy,radius*.5,grid);
  const labels=[];
  for (const p of runtime.poiSlots ?? []) {
    const x=cx+(p.wx-flight.pos.x)*radius/range, y=cy+(p.wz-flight.pos.z)*radius/range;
    c.strokeStyle='#76b6a8';c.lineWidth=1.3;c.strokeRect(x-2,y-2,4,4);
    if (labels.length<4 && Math.hypot(x-cx,y-cy)<radius-14 && labels.every(q=>Math.abs(q.x-x)>34 || Math.abs(q.y-y)>10)) {
      text(c,p.name.slice(0,8).toUpperCase(),x+4,y-2,8,'#8ab9ae');
      labels.push({x,y});
    }
  }
  for (const p of runtime.traffic?.items ?? []) {
    const x=cx+(p.rx-flight.pos.x)*radius/range,y=cy+(p.rz-flight.pos.z)*radius/range;
    if (Number.isFinite(x+y) && Math.hypot(x-cx,y-cy)<radius) {
      c.fillStyle=green;c.fillRect(x-1,y-1,2.5,2.5);
    }
  }
  c.save();c.translate(cx,cy);c.rotate(hdg/RAD2DEG);
  c.setLineDash([3,4]);line(c,'#64a98e',0,-8,0,-radius);c.setLineDash([]);
  c.beginPath();c.moveTo(0,-7);c.lineTo(5,5);c.lineTo(0,2);c.lineTo(-5,5);c.closePath();c.fillStyle=white;c.fill();
  c.restore();c.restore();circle(c,cx,cy,radius,'#598777');
  for(let i=0;i<36;i++) {
    const a=i*Math.PI/18, r=radius-(i%3?2:6);
    line(c,muted,cx+Math.sin(a)*r,cy-Math.cos(a)*r,cx+Math.sin(a)*radius,cy-Math.cos(a)*radius);
  }
  text(c,'N',cx,cy-radius-3,11,white,'center');
  text(c,'22 NM',460,195,10,muted,'right');
}
function attitudeDisplay(c, pitch, bank) {
  c.save();
  c.beginPath();c.rect(27,67,183,114);c.clip();
  c.translate(119,124);c.rotate(-bank);c.translate(0,Math.max(-125,Math.min(125,pitch*RAD2DEG*2.2)));
  c.fillStyle='#1a3536';c.fillRect(-160,-200,320,200);
  c.fillStyle='#2a3026';c.fillRect(-160,0,320,200);line(c,'#99b89b',-160,0,160,0,1.5);
  for(let i=-3;i<=3;i++) if(i) {
    const y=i*22,w=i%2?14:25;line(c,'#7a9c89',-w,y,w,y);
    if(!(i%2))text(c,String(-i*10),w+5,y+3,9,muted);
  }
  c.restore();wingMark(c,119,124,1.2,'#e9dea0');
  for(let i=-6;i<=6;i++) {
    const a=i*Math.PI/36,r=58;
    line(c,muted,119+Math.sin(a)*r,121-Math.cos(a)*r,119+Math.sin(a)*(r+(i%3?3:6)),121-Math.cos(a)*(r+(i%3?3:6)));
  }
}
function panelPage(c, runtime, f, speed, alt, hdg) {
  const w=800,h=242;
  const screen=c.createLinearGradient(0,0,w,h);
  screen.addColorStop(0,'#172624');screen.addColorStop(.28,'#091512');screen.addColorStop(1,'#08110f');
  c.fillStyle=screen;c.fillRect(0,0,w,h);
  c.strokeStyle='#516359';c.lineWidth=1.5;c.strokeRect(4,4,w-8,h-8);
  for(const x of [236,476])line(c,grid,x,7,x,h-7,1.5);
  for(const y of [31,212])line(c,grid,5,y,w-5,y);
  text(c,'PFD',17,23,15,white); text(c,'ATT',218,23,12,muted,'right');
  text(c,'NAV',249,23,15,white); text(c,'N UP',462,23,12,muted,'right');
  text(c,'FLIGHT DATA',491,23,15,white);
  const geo=runtime.geo;
  text(c,Number.isFinite(geo?.y) ? Math.abs(geo.y).toFixed(2)+'°'+(geo.y<0?'S':'N')+'  '+Math.abs(geo.x).toFixed(2)+'°'+(geo.x<0?'W':'E') : '',783,23,11,muted,'right');
  attitudeDisplay(c,f.pitch,f.bank);
  text(c,'BANK',17,199,11,muted);
  text(c,Math.round(Math.abs(f.bank*RAD2DEG))+'° '+(f.bank>.008?'R':f.bank<-.008?'L':''),64,199,13,white);
  navigation(c,runtime,f,hdg);
  const directions=['N','NE','E','SE','S','SW','W','NW'];
  const fields=[['AIRSPEED',String(speed),'KT'],['ALTITUDE',alt.toLocaleString('en-US'),'FT'],['HEADING',String(hdg).padStart(3,'0')+'°',directions[Math.round(hdg/45)%8]]];
  fields.forEach(([name,value,unit],i)=>{
    const y=41+i*55;
    text(c,name,492,y+12,12,muted);
    text(c,value,698,y+34,33,green,'right');text(c,unit,712,y+32,14,muted);
    line(c,'#283b32',492,y+47,779,y+47);
  });
  text(c,'FLIGHT',16,229,11,green);
  const loc=runtime.nearestPoi?.split(' · ')[0];
  text(c,loc ? loc.slice(0,24) : 'POSITION',250,229,11,muted);
  const agl=Number.isFinite(f.agl)?Math.max(0,Math.round(f.agl*M_TO_FT)).toLocaleString('en-US')+' FT':'—';
  text(c,'AGL  '+agl,491,229,11,muted);
}
function headUp(c, f, speed, alt, hdg) {
  const phosphor='#aaff96';
  c.clearRect(0,0,320,220);c.save();
  c.shadowColor='#193b24';c.shadowBlur=1.4;
  // Thin flight-only symbology, printed inside the combiner's cut edges.
  line(c,phosphor,49,39,271,39,1.2);
  const phase=(hdg%5)*2;
  for(let i=-10;i<=10;i++){
    const x=160+i*10-phase;
    line(c,phosphor,x,39,x,39-(i%2?3:6));
  }
  c.fillStyle='#456449';c.fillRect(139,27,42,22);
  c.strokeStyle=phosphor;c.strokeRect(139,27,42,22);
  text(c,String(hdg).padStart(3,'0'),160,43,15,phosphor,'center');
  for(const [x,w,val] of [[5,51,speed],[249,66,alt.toLocaleString('en-US')]]){
    c.strokeStyle=phosphor;c.strokeRect(x,91,w,24);
    text(c,String(val),x+w/2,109,17,phosphor,'center');
  }
  c.save();c.beginPath();c.rect(70,57,180,119);c.clip();
  c.translate(160,112);c.rotate(-f.bank);
  const deg=f.pitch*RAD2DEG;
  const base=Math.round(deg/5)*5;
  for(let i=-2;i<=2;i++){
    const v=base+i*5,y=(deg-v)*3.1,w=v%10?20:34;
    line(c,phosphor,-w,y,-9,y);line(c,phosphor,9,y,w,y);
    if(v%10===0)text(c,String(v),w+4,y+3,9,phosphor);
  }
  c.restore();wingMark(c,160,112,.85,phosphor);
  c.restore();
}
export function createPilotDisplays() {
  const panel=surface(800,242), hud=surface(320,220);
  return {
    panel,hud,
    update(runtime) {
      const f=runtime.flight;
      if(!f)return;
      const speed=Math.round(f.speed*MPS_TO_KT), alt=Math.round(f.pos.y*M_TO_FT);
      const hdg=((Math.round(f.heading*RAD2DEG)%360)+360)%360;
      if(panel.ctx)panelPage(panel.ctx,runtime,f,speed,alt,hdg);
      if(hud.ctx)headUp(hud.ctx,f,speed,alt,hdg);
      panel.texture.needsUpdate=true;hud.texture.needsUpdate=true;
    },
    dispose() { panel.texture.dispose();hud.texture.dispose(); }
  };
}
