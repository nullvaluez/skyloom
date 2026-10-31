import { Architecture, facade } from './geometry.mjs';

export function empire(level){
  const b=new Architecture(level);
  // Limestone setbacks, deeply recessed glazing, fluted piers, observatory and mooring mast.
  for(const [y,w,d,h] of [[0,119,61,20],[20,103,59,20],[40,85,53,36],[76,65,44,133],[209,55,38,63],[272,43,31,55],[327,31,25,45]]){
    b.box(0,y,0,w,h,d,'limestone');
    facade(b,{y,w,d,h,spacing:3.35,glass:'darkGlass',frame:.82,night:.21,windowRatio:.65});
    b.box(0,y+h-.65,0,w+1.5,.65,d+1.5,'trim',{emit:y>270?.3:.065});
    if(b.detail)for(const side of [-1,1])for(const x of [-w/2+1.1,w/2-1.1])b.box(x,y,side*(d/2+.24),1.2,h,.7,'trim');
  }
  b.cylinder(0,372,0,10.8,8.8,18,'limestone',b.detail?32:12);
  b.cylinder(0,390,0,8.8,5.4,14,'steel',b.detail?32:12);
  b.cylinder(0,404,0,3.2,1.9,27,'steel',16);
  b.cylinder(0,431,0,1.3,.28,12,'steel',12,{emit:.4,glow:'#bddeed'});
  if(b.detail){
    for(let i=0;i<16;i++){const a=i/16*Math.PI*2;b.beam([Math.cos(a)*10.9,373,Math.sin(a)*10.9],[Math.cos(a)*8.9,390,Math.sin(a)*8.9],.45,.45,'trim',{emit:.22});}
    for(const y of [374,378,382,386,390,400,410,418,426])b.ring(0,y,0,y<391?10.9:y<405?5.6:2.3,.18,'steel',32);
    for(const x of [-46,-37,37,46])b.box(x,1,30.6,4.2,12,.15,'darkGlass',{emit:.22,unlitMask:true});
    // Main entrance canopy and bronze-framed portals.
    b.box(0,0,30.8,21,14,.7,'recess');
    for(let x=-8;x<=8;x+=4){b.box(x,0,31.3,.3,13,.35,'gold');b.face(x+1.4,1,31.1,2.3,10,'darkGlass');}
    b.box(0,13,32,23,.65,3,'trim');
  }
  return b.end();
}

export function willis(level){
  const b=new Architecture(level),heights=[[206,270,206],[355,442,442],[270,355,270]],pitch=22.9;
  for(let ix=0;ix<3;ix++)for(let iz=0;iz<3;iz++){
    const x=(ix-1)*pitch,z=(iz-1)*pitch,h=heights[ix][iz];
    b.box(x,0,z,pitch,h,pitch,'darkGlass');
    if(b.detail)for(let side=0;side<4;side++){
      const dx=[0,1,0,-1][side],dz=[1,0,-1,0][side];
      const bottom=heights[ix+dx]?.[iz+dz]??0;if(bottom>=h)continue;
      const yaw=side*Math.PI/2,dist=pitch/2;
      const wp=(u,v)=>[x+u*Math.cos(yaw)+v*Math.sin(yaw),z-u*Math.sin(yaw)+v*Math.cos(yaw)];
      for(let col=0;col<=8;col++){const [px,pz]=wp(-pitch/2+col*pitch/8,dist+.1);const g=b.box(px,bottom,pz,.22,h-bottom,.3,'darkSteel');g.translate(-px,0,-pz);g.rotateY(yaw);g.translate(px,0,pz);}
      const step=b.detail===2?4.0:12.0;
      for(let y=bottom+.6,f=0;y<h-2;y+=step,f++){
        const [px,pz]=wp(0,dist+.1);const g=b.box(px,y,pz,pitch,.28,.28,'darkSteel');g.translate(-px,0,-pz);g.rotateY(yaw);g.translate(px,0,pz);
        for(let c=0;c<8;c++){const [wx,wz]=wp(-pitch/2+(c+.5)*pitch/8,dist+.02);const k=(c*11+f*7+ix*13+iz*5+side*3)%13;
          b.face(wx,y+.4,wz,pitch/8-.34,Math.min(step-.85,h-y-.5),'darkGlass',yaw,{color:k<4?'#435461':'#253844',emit:k<4?.24:0,unlitMask:true});}
      }
    }
    b.box(x,h-.4,z,pitch+.5,.4,pitch+.5,'steel',{emit:.035});
    if(b.detail){b.box(x,h,z,pitch-1,.6,pitch-1,'recess');b.box(x+3,h+.6,z-3,5,2.1,4,'darkSteel');}
  }
  for(const z of [0,pitch]){
    b.cylinder(0,442,z,2.0,1.25,50,'whiteSteel',12);
    b.cylinder(0,492,z,1.25,.5,27,'whiteSteel',12);
    b.cylinder(0,519,z,.5,.2,8,'steel',8,{emit:.6,glow:'#ef4b35'});
    if(b.detail)for(let y=449;y<520;y+=6)b.ring(0,y,z,y<493?1.45:.8,.19,'steel',12);
  }
  return b.end();
}

export function cn(level){
  const b=new Architecture(level),segments=b.detail===2?64:b.detail?32:16;
  // Triangular concrete spine and three external flutes/elevator tracks.
  b.cylinder(0,0,0,12.7,5.9,330,'limestone',3,{color:'#aaa99c'}).rotateY(Math.PI/6);
  for(let i=0;i<3;i++){
    const a=i/3*Math.PI*2,dx=Math.sin(a),dz=Math.cos(a);
    const levels=[[0,20],[12,19],[55,15.7],[140,12.0],[245,8.1],[330,5.8]];
    for(let j=0;j<levels.length-1;j++){const [y,r]=levels[j],[ny,nr]=levels[j+1];
      b.beam([dx*r,y,dz*r],[dx*nr,ny,dz*nr],b.detail?4.1:4.4,4.1,'limestone',{color:'#c2bdac'});
      if(b.detail)b.beam([dx*(r+2.08),y,dz*(r+2.08)],[dx*(nr+2.08),ny,dz*(nr+2.08)],.65,.65,'darkGlass');
    }
    if(b.detail){const y=110+i*58,r=20-y*.043;b.box(dx*r,y,dz*r,2.6,4.5,2.6,'gold',{emit:.12});}
  }
  b.lathe(0,326,0,[[5.5,0],[10,3],[17,8],[20.7,12],[21.3,18],[21.3,28],[18,34],[11.8,40],[6.2,43]],'whiteSteel',segments);
  b.cylinder(0,340,0,21.45,21.45,12,'glass',segments,{emit:.18,unlitMask:true});
  b.cylinder(0,369,0,5.8,3.25,76,'limestone',segments,{color:'#b8b6a9'});
  b.lathe(0,445,0,[[3.2,0],[7.6,2],[8.5,6],[8.5,9],[6.7,13],[3.0,17]],'whiteSteel',segments);
  b.cylinder(0,450,0,8.55,8.55,5,'glass',segments,{emit:.18,unlitMask:true});
  b.cylinder(0,462,0,2.9,1.3,65,'whiteSteel',24);
  b.cylinder(0,527,0,1.3,.4,26,'steel',16,{emit:.2,glow:'#f58874'});
  if(b.detail){
    for(const y of [340,344,348,352])b.ring(0,y,0,21.5,.18,'whiteSteel',segments);
    for(let i=0;i<48;i++){const a=i/48*Math.PI*2,x=Math.sin(a)*21.55,z=Math.cos(a)*21.55;b.beam([x,340,z],[x,352,z],.16,.16,'steel');}
    for(let y=466;y<551;y+=4)b.ring(0,y,0,y<527?2.3:1.0,.13,'darkSteel',24);
  }
  return b.end();
}

export function spaceNeedle(level){
  const b=new Architecture(level),seg=b.detail===2?64:b.detail?40:20;
  b.cylinder(0,0,0,14,14,5,'limestone',12,{color:'#a8a18e'});
  b.cylinder(0,5,0,4.3,3.3,140,'darkSteel',12);
  for(let leg=0;leg<3;leg++){
    const a=leg*Math.PI*2/3,dx=Math.sin(a),dz=Math.cos(a),tx=Math.cos(a),tz=-Math.sin(a);
    const knots=[[4,17],[36,13.4],[70,8.1],[98,6.1],[118,7.8],[137,12.3],[148,18.2]];
    for(let i=0;i<knots.length-1;i++)for(const offset of [-1.35,1.35]){
      const [y,r]=knots[i],[ny,nr]=knots[i+1];
      b.beam([dx*r+tx*offset,y,dz*r+tz*offset],[dx*nr+tx*offset,ny,dz*nr+tz*offset],1.6,1.55,'whiteSteel');
      if(b.detail)b.beam([dx*r+tx*offset,y,dz*r+tz*offset],[dx*nr-tx*offset,ny,dz*nr-tz*offset],.25,.3,'steel');
    }
    if(b.detail)for(let y=7;y<141;y+=7){b.beam([dx*3.9+tx*1.3,y,dz*3.9+tz*1.3],[dx*3.9+tx*1.3,y+6.7,dz*3.9+tz*1.3],.2,.2,'steel');}
  }
  b.lathe(0,145,0,[[7,0],[17,2],[20.3,5],[20.8,8],[20.8,11],[21.6,12],[21.6,13],[18.5,17],[6,22],[2.9,23]],'whiteSteel',seg);
  b.cylinder(0,151,0,20.85,20.85,4.4,'darkGlass',seg,{emit:.25,unlitMask:true});
  b.cylinder(0,157,0,20.5,19.3,3,'glass',seg,{emit:.13,unlitMask:true});
  b.lathe(0,162,0,[[21.2,0],[16,1.7],[8,4.8],[3.1,6.2]],'ceramic',seg,{color:'#d5cbb0'});
  b.cylinder(0,168,0,2.3,1.1,5,'whiteSteel',24);b.cylinder(0,173,0,.65,.14,11,'steel',12);
  if(b.detail){
    for(let i=0;i<48;i++){const a=i/48*Math.PI*2,x=Math.cos(a),z=Math.sin(a);b.beam([x*20.95,151,z*20.95],[x*20.95,155.6,z*20.95],.12,.15,'steel');b.beam([x*20.8,159,z*20.8],[x*19.7,162,z*19.7],.1,.1,'whiteSteel');}
    for(const [y,r] of [[151,21],[155.5,21],[157.5,21],[161.8,20]])b.ring(0,y,0,r,.16,'steel',seg);
    for(let i=0;i<24;i++){const a=i/24*Math.PI*2;b.beam([Math.cos(a)*20.6,162.1,Math.sin(a)*20.6],[Math.cos(a)*3.2,168.2,Math.sin(a)*3.2],.16,.14,'trim');}
  }
  return b.end();
}

export function burj(level){
  const b=new Architecture(level),seg=b.detail===2?24:b.detail?12:10;
  // Buttressed Y-plan: wings end at different heights and retire around the core.
  b.cylinder(0,0,0,21,5.2,700,'glass',seg);
  for(let wing=0;wing<3;wing++){
    const a=wing*Math.PI*2/3,dx=Math.sin(a),dz=Math.cos(a),tx=Math.cos(a),tz=-Math.sin(a);
    for(let step=0;step<8;step++){
      const y=step*72,h=72+(step===7?(2-wing)*16:0),r=12.8-step*.95,reach=43-step*4.2;
      const shaft=b.box(dx*reach/2,y,dz*reach/2,r*1.65,h,reach,'glass');shaft.translate(-dx*reach/2,0,-dz*reach/2);shaft.rotateY(a);shaft.translate(dx*reach/2,0,dz*reach/2);
      b.cylinder(dx*reach,y,dz*reach,r,r,h,'glass',seg,{color:wing===1?'#7d97a5':'#91a5ae'});
      b.cylinder(dx*reach,y+h-.7,dz*reach,r+.35,r+.35,.7,'steel',seg);
      if(b.detail){
        // Continuous cladding fins and horizontal floor bands wrap each rounded nose.
        for(let i=0;i<seg;i++){const t=i/seg*Math.PI*2,px=dx*reach+Math.sin(t)*(r+.08),pz=dz*reach+Math.cos(t)*(r+.08);b.beam([px,y,pz],[px,y+h,pz],.13,.13,'steel');}
        const floors=b.detail===2?8.2:24.6;
        for(let fy=y+4.1;fy<y+h;fy+=floors){
          b.cylinder(dx*reach,fy,dz*reach,r+.12,r+.12,.21,'steel',seg);
          for(const sign of [-1,1]){
            b.beam([tx*r*.83*sign,fy,tz*r*.83*sign],[dx*reach+tx*r*.83*sign,fy,dz*reach+tz*r*.83*sign],.22,.22,'steel');
          }
        }
        for(const sign of [-1,1])for(let f=1;f<6;f++){
          const dist=reach*f/6;b.beam([dx*dist+tx*r*.83*sign,y,dz*dist+tz*r*.83*sign],[dx*dist+tx*r*.83*sign,y+h,dz*dist+tz*r*.83*sign],.17,.17,'steel');
        }
      }
    }
  }
  for(const [y,r,rt,h] of [[576,13,10,67],[643,10,7,52],[695,7,4.1,45],[740,4.1,2.3,41],[781,2.3,.35,47]]){
    b.cylinder(0,y,0,r,rt,h,'steel',seg);
    if(b.detail)for(let fy=y+5;fy<y+h;fy+=8)b.ring(0,fy,0,r+(rt-r)*(fy-y)/h,.13,'darkSteel',seg);
  }
  return b.end();
}
