const { chromium } = require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch({args:['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader-webgl']});
const p=await b.newPage({viewport:{width:1600,height:900}});p.on('pageerror',e=>console.log('pageerror',e.message));
await p.goto('http://127.0.0.1:8765/scripts/trailer/inspect.html?m='+(process.argv[2]||'player-jet.glb'));await p.waitForFunction(()=>window.ready,null,{timeout:60000});
console.log(JSON.stringify(await p.evaluate(()=>window.info)));
for(const v of ['top','side','back']){const d=await p.evaluate(v=>window.view(v),v);fs.writeFileSync(`/tmp/claude-0/insp-${v}.png`,Buffer.from(d.split(',')[1],'base64'));}
await b.close();})();
