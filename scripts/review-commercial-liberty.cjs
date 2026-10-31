// node scripts/review-commercial-liberty.cjs [--serve]
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.graphics-review/commercial-liberty');
fs.mkdirSync(out,{recursive:true});
(async()=>{
  await new Promise((resolve,reject)=>{
    const c=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'commercial-liberty-review.mjs'),output:{path:out,filename:'bundle.js',hashFunction:'sha256'},resolve:{alias:{'@':root},extensions:['.js','.mjs','.json'],fullySpecified:false},module:{rules:[{test:/\.m?js$/,resolve:{fullySpecified:false}}]},optimization:{minimize:false},cache:false});
    c.run((e,s)=>{c.close(()=>{});e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve();});
  });
  const html='<!doctype html><html><body style="margin:0;background:#c3cdd4"><script>window.__flyCommercialPaintOverride={enabled:true};window.__flyLibertyDetailOverride={enabled:true};</script><script src="/bundle.js"></script></body></html>';
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const base=url.pathname.startsWith('/models/')?path.join(root,'public'):out,file=path.resolve(base,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(base+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'model/gltf-binary');fs.createReadStream(file).pipe(res);
  });await new Promise(r=>server.listen(3188,'127.0.0.1',r));
  let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
    const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[],cases=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://127.0.0.1:3188/');await page.waitForFunction(()=>window.reviewReady);
    for(const id of ['airliner','cargo','concorde']){
      const cards=await page.evaluate(id=>window.review.gallery(id),id);cases.push({id,cards});
      await page.locator('canvas').screenshot({path:path.join(out,`${id}-gallery.png`)});
    }
    await page.evaluate(()=>window.review.reset());
    for(const [id,skin]of [['airliner','commercial-united'],['airliner','commercial-emirates'],['cargo','commercial-fedex'],['concorde','commercial-british-airways-concorde']])for(const side of [false,true]){
      cases.push(await page.evaluate(([id,skin,side])=>window.review.paint(id,skin,{side}),[id,skin,side]));
      await page.screenshot({path:path.join(out,`${id}-${skin}-${side?'starboard':'port'}.png`)});
    }
    cases.push(await page.evaluate(()=>window.review.paint('airliner','commercial-delta',{mobile:true})));
    await page.screenshot({path:path.join(out,'airliner-mobile.png')});
    for(const level of ['far','medium','high'])for(const before of (level==='high'?[true,false]:[false])){
      cases.push(await page.evaluate(([level,before])=>window.review.statue(level,before),[level,before]));
      await page.screenshot({path:path.join(out,`liberty-${before?'before':level}.png`)});
    }
    await page.evaluate(()=>window.review.statue('high',false,true));await page.screenshot({path:path.join(out,'liberty-night.png')});
    const stats=await page.evaluate(()=>window.review.stats()),report={cases,errors,...stats};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    if(errors.length||stats.programs.some(p=>!p.runnable))throw Error(JSON.stringify(report));
    console.log(JSON.stringify({cases:cases.length,errors,...stats}));
  }finally{await browser?.close();if(!process.argv.includes('--serve'))await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
