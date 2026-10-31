import { Architecture } from './geometry.mjs';

export function colosseum(level){
  const b=new Architecture(level),bays=b.detail===2?80:32,arcSegments=b.detail===2?6:b.detail?4:3;
  const point=(a,rx,rz)=>[Math.cos(a)*rx,Math.sin(a)*rz];
  const wall=(rx,rz,base,rows,outer)=>{
    for(let i=0;i<bays;i++){
      const a=(i+.5)*Math.PI*2/bays,[x,z]=point(a,rx,rz);
      const tangent=[-Math.sin(a)*rx,Math.cos(a)*rz],yaw=Math.atan2(-tangent[1],tangent[0]);
      const width=Math.hypot(...tangent)*Math.PI*2/bays;
      // Retain the north outer wall; the south perimeter exposes the inner arcades.
      const intact=!outer||Math.sin(a)>.02;
      const count=intact?rows:Math.sin(a)>-.2?Math.max(1,rows-1):0;
      for(let row=0;row<count;row++){
        const y=base+row*10.7,opening=width*.60,r=opening/2,spring=6.0;
        const g=b.box(x,y,z,width-opening,10.7,outer?3.1:2.1,'limestone',{color:(i+row)%5===0?'#b2a28b':'#c0b199'});g.translate(-x,0,-z);g.rotateY(yaw);g.translate(x,0,z);
        const next=a+Math.PI/bays,[ax,az]=point(next,rx,rz);
        b.arch(ax,y+spring,az,r,3.6,1.2,outer?3.1:2.1,'limestone',yaw,arcSegments);
        const top=b.box(x,y+9.8,z,width+.12,.9,outer?3.5:2.6,'trim',{color:'#c5b69e'});top.translate(-x,0,-z);top.rotateY(yaw);top.translate(x,0,z);
        if(b.detail){
          const normal=[Math.sin(yaw),Math.cos(yaw)],cx=x+normal[0]*1.75,cz=z+normal[1]*1.75;
          b.cylinder(cx,y+.5,cz,.38,.33,8.6,'limestone',b.detail===2?8:6,{color:'#c8bba5'});
          const cap=b.box(cx,y+9.1,cz,1.3,.5,.8,'trim');cap.translate(-cx,0,-cz);cap.rotateY(yaw);cap.translate(cx,0,cz);
          b.cylinder(cx,y+.2,cz,.52,.52,.45,'trim',8);
        }
      }
      if(outer&&intact){
        const y=base+rows*10.7;
        const g=b.box(x,y,z,width*.64,11.6,3.0,'limestone',{color:'#beae94'});g.translate(-x,0,-z);g.rotateY(yaw);g.translate(x,0,z);
        const [ax,az]=point(a+Math.PI/bays,rx,rz);
        for(const [yy,hh]of [[y,3.8],[y+6.8,4.8]]){const f=b.box(ax,yy,az,width*.4,hh,3,'limestone');f.translate(-ax,0,-az);f.rotateY(yaw);f.translate(ax,0,az);}
        const coping=b.box(x,y+11.6,z,width+.2,.8,3.6,'trim');coping.translate(-x,0,-z);coping.rotateY(yaw);coping.translate(x,0,z);
      }
    }
  };
  b.cylinder(0,0,0,1,1,.5,'limestone',bays).scale(95,1,79);
  wall(93,76.5,.5,3,true);
  wall(84.4,68.0,.5,2,false);
  // The exposed inner bowl has stepped cavea and a visible hypogeum below.
  const steps=b.detail===2?10:b.detail?7:5;
  for(let j=0;j<steps;j++){
    const rx=43+j*2.5,rz=25+j*2.45,y=2+j*1.44;
    const g=b.cylinder(0,y,0,1,1,.65,'limestone',bays,{color:j%3===0?'#9e907b':'#b4a68f'});
    // Replace the cylinder with an open elliptical ring; seating never fills the arena.
    b.parts.pop();g.dispose();
    for(let i=0;i<bays;i++){
      const a=i*Math.PI*2/bays,next=(i+1)*Math.PI*2/bays;
      const [x,z]=point(a,rx,rz),[nx,nz]=point(next,rx,rz);
      b.beam([x,y,z],[nx,y,nz],.65,2.1,'limestone',{color:j%3===0?'#9e907b':'#b4a68f'});
    }
  }
  if(b.detail){
    for(let x=-36;x<=36;x+=8)b.box(x,.6,0,.7,3.1,39,'recess',{color:'#9a8971'});
    for(let z=-18;z<=18;z+=6)b.box(0,.6,z,78,3.1,.55,'limestone',{color:'#a99b82'});
    for(let i=0;i<24;i++){
      const a=i*Math.PI*2/24,[x,z]=point(a,45,27),[nx,nz]=point(a,82,65);
      b.beam([x,3.8,z],[nx,23,nz],1.1,.45,'trim',{color:'#c7b99e'});
    }
    // Irregular surviving wall fragments along the broken south outer circumference.
    for(let i=0;i<19;i++){
      const a=Math.PI+(i+.5)*Math.PI/19,[x,z]=point(a,91,75),h=1.4+(i*7%5)*.6;
      const g=b.box(x,.5,z,2.2,h,2.6,'limestone',{color:'#b0a18a'});g.translate(-x,0,-z);g.rotateY(-a);g.translate(x,0,z);
    }
  }
  const g=b.end();g.computeBoundingBox();const h=g.boundingBox.max.y;g.scale(1,48/h,1);return g;
}
