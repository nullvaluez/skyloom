const {chromium}=require('playwright');
const fs=require('node:fs');
const output=process.argv[2]||'.graphics-review/home-drape-after';
(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const p=await b.newPage({viewport:{width:1920,height:1080}});
 await p.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-quality-tier','high');window.__flyGovPin='hold';window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,6,18,18);});
 try{
 await p.goto('http://localhost:3010/?graphics=cinematic&graphicsReview=1',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly,null,{timeout:90000});
 await p.evaluate(()=>{const f=window.__fly;f.warpToGeo(40.204,-83.0896,{altM:374.9});const pin={...f.flight.pos};setInterval(()=>{Object.assign(f.flight.pos,pin);f.flight.heading=3.89;f.flight.pitch=-0.08;f.flight.bank=0;f.flight.speed=0;},16);});
 await p.waitForTimeout(30000);
 const r=await p.evaluate(()=>{const f=window.__fly,px=f.flight.pos.x,pz=f.flight.pos.z;let home;f.satBuildings.object.parent.traverse(o=>{if(o.userData.__parcelInit)home=o;});const rows=[],m=home.matrixWorld.clone();for(let i=0;i<home.count;i++){home.getMatrixAt(i,m);const x=home.position.x+m.elements[12],z=home.position.z+m.elements[14],y=home.position.y+m.elements[13];const lon=x/6378137*180/Math.PI,lat=(2*Math.atan(Math.exp(-z/6378137))-Math.PI/2)*180/Math.PI;const ground=f.engine.getGroundAt(lon,lat);rows.push({i,x,z,lon,lat,d:Math.hypot(x-px,z-pz),baseY:y,height:m.elements[5],ground,delta:y-ground.elev});}rows.sort((a,b)=>a.d-b.d);return{count:home.count,parcel:f.parcelSettle,closest:rows.slice(0,3),minDelta:Math.min(...rows.map(x=>x.delta)),maxDelta:Math.max(...rows.map(x=>x.delta)),roadChunks:[...f.satRoads.chunks.values()].map(c=>({state:c.state,coarse:c.coarse,vertices:c.mesh?.geometry.attributes.position?.count,cls:[...new Set(c.mesh?.geometry.attributes.aRoadCls?.array??[])]}))};});
 r.status=!r.count?'BLOCKED':Math.abs(r.minDelta-0.12)<0.25&&Math.abs(r.maxDelta-0.12)<0.25?'PASS':'FAIL';fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/report.json',JSON.stringify(r,null,2));await p.screenshot({path:output+'/homes.png'});console.log(JSON.stringify({status:r.status,count:r.count,minDelta:r.minDelta,maxDelta:r.maxDelta,parcel:r.parcel}));process.exitCode=r.status==='PASS'?0:r.status==='BLOCKED'?2:1;
 }finally{await b.close();}
})();
