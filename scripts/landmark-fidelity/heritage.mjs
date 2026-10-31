import { T, Architecture } from './geometry.mjs';

function pointedPanel(b,x,y,z,w,h,yaw=0,role='recess'){
  const s=new T.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,h*.55);
  s.quadraticCurveTo(w*.48,h*.78,0,h);s.quadraticCurveTo(-w*.48,h*.78,-w/2,h*.55);s.closePath();
  const g=new T.ShapeGeometry(s,b.detail===2?16:8);g.rotateY(yaw);g.translate(x,y,z);b.add(g,role);
}
function faceBox(b,side,u,y,dist,w,h,d,role,options){
  const a=side*Math.PI/2,x=u*Math.cos(a)+dist*Math.sin(a),z=-u*Math.sin(a)+dist*Math.cos(a);
  const g=b.box(x,y,z,w,h,d,role,options);g.translate(-x,0,-z);g.rotateY(a);g.translate(x,0,z);return g;
}

export function taj(level){
  const b=new Architecture(level),seg=b.detail===2?64:b.detail?32:20;
  b.box(0,0,0,100,5.5,100,'marble',{color:'#c9c1ab'});b.box(0,5.5,0,101,.6,101,'trim');
  // Chamfered square mausoleum, four recessed iwans, corner kiosks and full minaret balconies.
  const s=new T.Shape(),v=[[-18,-28],[18,-28],[28,-18],[28,18],[18,28],[-18,28],[-28,18],[-28,-18]];
  v.forEach(([x,z],i)=>i?s.lineTo(x,z):s.moveTo(x,z));s.closePath();
  const main=new T.ExtrudeGeometry(s,{depth:28,bevelEnabled:false,steps:1});main.rotateX(-Math.PI/2);main.translate(0,6.1,0);b.add(main,'marble');
  b.cylinder(0,34.1,0,14,14,8.9,'marble',seg);
  b.dome(0,43,0,17.5,24,'marble',seg);
  b.lathe(0,67,0,[[1.7,0],[1.2,.6],[.5,1],[.4,3.6],[.75,4],[.32,4.5],[0,6]],'gold',20,{emit:.12});
  for(const x of [-44,44])for(const z of [-44,44]){
    b.cylinder(x,6.1,z,3.3,2.4,33,'marble',b.detail?24:12);
    for(const y of [16.2,27.6,38.3]){
      b.cylinder(x,y,z,3.8,3.8,.6,'trim',seg/2);
      if(b.detail){b.ring(x,y+1.25,z,3.5,.12,'trim',seg);for(let i=0;i<16;i++){const a=i/16*Math.PI*2;b.beam([x+3.5*Math.cos(a),y+.6,z+3.5*Math.sin(a)],[x+3.5*Math.cos(a),y+1.25,z+3.5*Math.sin(a)],.13,.13,'trim');}}
    }
    b.cylinder(x,39,z,2.6,2.6,.7,'trim',24);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;b.cylinder(x+Math.cos(a)*2.1,39.7,z+Math.sin(a)*2.1,.25,.2,3.5,'marble',8);}
    b.dome(x,43.2,z,3.1,3.7,'marble',seg/2);b.cylinder(x,46.9,z,.27,.08,1.8,'gold',8);
  }
  for(const x of [-19.5,19.5])for(const z of [-19.5,19.5]){
    b.cylinder(x,34,z,5.2,5.2,1,'marble',16);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;b.cylinder(x+Math.cos(a)*3.6,35,z+Math.sin(a)*3.6,.35,.3,4.6,'marble',8);}
    b.dome(x,39.6,z,5.2,6.8,'marble',seg/2);b.cylinder(x,46.4,z,.4,.08,2.4,'gold',8);
  }
  for(let side=0;side<4;side++){
    const a=side*Math.PI/2,wp=(u,dist)=>[u*Math.cos(a)+dist*Math.sin(a),-u*Math.sin(a)+dist*Math.cos(a)];
    // Nested arch recesses have layered depth and inlaid dark stone borders.
    const [x,z]=wp(0,28.07);pointedPanel(b,x,7,z,15,24,a,'recess');
    const [px,pz]=wp(0,28.11);pointedPanel(b,px,7,pz,12.6,21.8,a,'marble');
    const [qx,qz]=wp(0,28.16);pointedPanel(b,qx,7,qz,11.8,21.0,a,'recess');
    for(const u of [-8.7,8.7]){faceBox(b,side,u,6.5,28.5,1.5,27.7,1.1,'trim');faceBox(b,side,u,7,29.08,.16,26.5,.05,'recess');}
    faceBox(b,side,0,33,28.6,19,1.1,1.7,'trim');
    if(b.detail){
      for(const u of [-23,-15,15,23])for(const y of [7.5,20]){
        const dist=Math.abs(u)>18?26.4:28.12,[sx,sz]=wp(u,dist);
        pointedPanel(b,sx,y,sz,5.3,10.3,a,'recess');
        const [tx,tz]=wp(u,dist+.04);pointedPanel(b,tx,y+.5,tz,4.5,9.2,a,'marble');
        const [ix,iz]=wp(u,dist+.08);pointedPanel(b,ix,y+1,iz,3.6,7.7,a,'recess');
        faceBox(b,side,u,y+2,dist+.2,.15,4.7,.12,'marble');
      }
      for(let u=-17;u<=17;u+=2.2)faceBox(b,side,u,34.15,27.7,.55,1.1,.5,'trim');
      // Small floral stone-inlay panels and horizontal joints, not a noise texture.
      for(let u=-16;u<=16;u+=4)for(let y=9;y<33;y+=5.5){
        if(Math.abs(u)<10)continue;faceBox(b,side,u,y,28.24,.18,1.9,.03,'gold');
        faceBox(b,side,u,y+.5,28.26,1.2,.14,.03,'slate');
      }
      for(const y of [6.3,17.4,30.8])faceBox(b,side,0,y,28.3,36,.16,.15,'trim');
    }
  }
  return b.end();
}

const ROMAN=['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];
function numeral(b,side,text,cx,cy,dist,scale){
  const strokes={I:[[0,-.45,0,.45]],V:[[-.23,.45,0,-.45],[0,-.45,.23,.45]],X:[[-.23,.45,.23,-.45],[-.23,-.45,.23,.45]]};
  const a=side*Math.PI/2,wp=(u,y)=>[u*Math.cos(a)+dist*Math.sin(a),y,-u*Math.sin(a)+dist*Math.cos(a)];
  for(let i=0;i<text.length;i++)for(const [x1,y1,x2,y2] of strokes[text[i]])b.beam(wp(cx+(x1+(i-(text.length-1)/2)*.58)*scale,cy+y1*scale),wp(cx+(x2+(i-(text.length-1)/2)*.58)*scale,cy+y2*scale),.065,.065,'blue',{wear:false});
}
export function bigBen(level){
  const b=new Architecture(level),seg=b.detail===2?64:32;
  b.box(0,0,0,12.6,55,12.6,'limestone',{color:'#c1ad87'});
  for(const [y,w,h]of [[0,14,1.5],[14.2,13.3,.8],[28.1,13.4,.9],[42.4,13.6,.9],[54,15,1.5],[68,15.5,1.5],[78,14,.8]])b.box(0,y,0,w,h,w,'trim');
  b.box(0,55,0,14,13,14,'limestone',{color:'#d5c29d'});
  b.box(0,69.5,0,11.5,8.5,11.5,'recess');
  b.box(0,78.8,0,13,.65,13,'gold');
  const roof=b.cylinder(0,79.45,0,9.2,2.0,12.8,'slate',4);roof.rotateY(Math.PI/4);
  b.cylinder(0,92.25,0,1.8,.5,2.7,'gold',8);b.cylinder(0,94.95,0,.25,0,1.05,'gold',8,{emit:.2});
  for(let side=0;side<4;side++){
    const a=side*Math.PI/2;
    if(b.detail){
      for(const u of [-5.6,-4.1,4.1,5.6])faceBox(b,side,u,1.5,6.45,.55,52.5,.75,'trim');
      for(let y=3;y<54;y+=6.8)for(const u of [-2.8,0,2.8]){
        const x=u*Math.cos(a)+6.39*Math.sin(a),z=-u*Math.sin(a)+6.39*Math.cos(a);
        pointedPanel(b,x,y,z,1.75,4.6,a,'recess');
        faceBox(b,side,u,y+.2,6.5,.16,3.0,.2,'trim');
        b.arch(x,y+3.2,z,.85,1.4,.18,.24,'trim',a,b.detail===2?8:4);
      }
      for(const u of [-3.5,0,3.5]){faceBox(b,side,u,70,5.9,.6,7.7,.6,'trim');for(let y=71;y<77.8;y+=.7)faceBox(b,side,u+1.3,y,5.78,1.7,.18,.15,'slate');}
      for(const y of [15.1,29.1,43.4])for(let u=-5.3;u<6;u+=1.1)faceBox(b,side,u,y,6.8,.32,.7,.25,'gold');
    }
    // Four opalescent dials, true blue metal tracery, Roman numerals and separate hands.
    const x=Math.sin(a)*7.08,z=Math.cos(a)*7.08;
    const dial=new T.CircleGeometry(3.55,seg);dial.rotateY(a);dial.translate(x,62.5,z);
    b.add(dial,'ceramic',{color:'#f2ead8',emit:.8,unlitMask:true,glow:'#fff2d6'});
    for(const [r,t,role]of [[3.65,.16,'gold'],[3.38,.045,'blue'],[2.6,.045,'blue'],[.28,.05,'gold']]){
      const g=new T.TorusGeometry(r,t,4,seg);g.rotateY(a);g.translate(Math.sin(a)*7.14,62.5,Math.cos(a)*7.14);b.add(g,role,{wear:false});
    }
    if(b.detail){
      for(let i=0;i<60;i+=b.detail===2?1:5){
        const t=i*Math.PI*2/60,r1=i%5===0?3.12:3.25,r2=3.36;
        const wp=(r)=>[Math.sin(t)*r*Math.cos(a)+7.2*Math.sin(a),62.5+Math.cos(t)*r,-Math.sin(t)*r*Math.sin(a)+7.2*Math.cos(a)];
        b.beam(wp(r1),wp(r2),i%5===0?.07:.035,.035,'blue',{wear:false});
      }
      for(let i=0;i<12;i++){const t=i*Math.PI/6;numeral(b,side,ROMAN[i],Math.sin(t)*2.96,62.5+Math.cos(t)*2.96,7.23,.43);}
      for(let i=0;i<12;i++){const t=i*Math.PI/6;const wp=r=>[Math.sin(t)*r*Math.cos(a)+7.16*Math.sin(a),62.5+Math.cos(t)*r,-Math.sin(t)*r*Math.sin(a)+7.16*Math.cos(a)];b.beam(wp(.4),wp(2.56),.035,.035,'blue',{wear:false});}
    }
    for(const [t,r]of [[-Math.PI/3,1.7],[Math.PI/3,2.65]])b.beam([7.26*Math.sin(a),62.5,7.26*Math.cos(a)],[Math.sin(t)*r*Math.cos(a)+7.26*Math.sin(a),62.5+Math.cos(t)*r,-Math.sin(t)*r*Math.sin(a)+7.26*Math.cos(a)],.14,.11,'blue',{wear:false});
  }
  for(const x of [-6.2,6.2])for(const z of [-6.2,6.2]){
    b.box(x,68,z,1.1,12,1.1,'trim');b.cylinder(x,80,z,.85,0,5.1,'gold',4);
    if(b.detail)for(const y of [55,69,76,80])b.box(x,y,z,1.65,.4,1.65,'gold');
  }
  return b.end();
}

export function gateway(level){
  const b=new Architecture(level),segments=b.detail===2?192:b.detail?96:40;
  // Smooth weighted catenary with a tapered triangular steel section (NPS profile).
  const points=[],k=.03291765;
  for(let i=0;i<=segments;i++){
    const x=-91.2+182.4*i/segments,y=192*(Math.cosh(k*91.2)-Math.cosh(k*x))/(Math.cosh(k*91.2)-1);
    const slope=-192*k*Math.sinh(k*x)/(Math.cosh(k*91.2)-1),norm=new T.Vector3(-slope,1,0).normalize();
    const side=16.46+(5.18-16.46)*(y/192),r=side/Math.sqrt(3);
    points.push([0,1,2].map(j=>{const t=j*Math.PI*2/3-Math.PI/2;return new T.Vector3(x,y,0).addScaledVector(norm,Math.sin(t)*r).add(new T.Vector3(0,0,Math.cos(t)*r));}));
  }
  for(let side=0;side<3;side++){
    const p=[],ix=[];
    for(let i=0;i<=segments;i++)for(const j of [side,(side+1)%3])p.push(...points[i][j].toArray());
    for(let i=0;i<segments;i++){const q=i*2;ix.push(q,q+1,q+2,q+1,q+3,q+2);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();
    b.add(g,'steel',{color:side===0?'#aab7bf':side===1?'#c5ced1':'#8a9ca7',roughness:.29});
  }
  if(b.detail){
    for(let i=1;i<segments;i+=b.detail===2?2:3)for(let s=0;s<3;s++)b.beam(points[i][s].toArray(),points[i][(s+1)%3].toArray(),.035,.035,'darkSteel');
    // Observation slits on both faces of the crown, tiny in the world but legible up close.
    for(const sign of [-1,1])for(let i=-7;i<=7;i++)b.face(i*1.05,189.1,sign*2.32,.6,.28,'darkGlass',sign<0?Math.PI:0,{emit:.12,unlitMask:true});
  }
  const g=b.end();g.computeBoundingBox();const h=g.boundingBox.max.y-g.boundingBox.min.y;g.translate(0,-g.boundingBox.min.y,0);g.scale(192/h,192/h,192/h);return g;
}
