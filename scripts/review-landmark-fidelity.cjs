// Asset-only visual matrix. World integration is verified separately.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.graphics-review/landmark-fidelity');
fs.mkdirSync(out,{recursive:true});
(async()=>{
  await new Promise((resolve,reject)=>{const c=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'landmark-fidelity-review.mjs'),output:{path:out,filename:'bundle.js',hashFunction:'sha256'},resolve:{alias:{'@':root},extensions:['.js','.mjs','.json'],fullySpecified:false},module:{rules:[{test:/\.m?js$/,resolve:{fullySpecified:false}}]},optimization:{minimize:false},cache:false});c.run((e,s)=>{c.close(()=>{});e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve();});});
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0"><script src="/bundle.js"></script></body></html>');return;}
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const base=url.pathname.startsWith('/models/')?path.join(root,'public'):out,file=path.resolve(base,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(base+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'model/gltf-binary');res.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(res);
  });await new Promise(r=>server.listen(3189,'127.0.0.1',r));
  let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
    const page=await browser.newPage({viewport:{width:1800,height:1350}}),errors=[],cases=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://127.0.0.1:3189/');await page.waitForFunction(()=>window.reviewReady);
    for(const [level,before,night,label]of [['high',true,false,'before'],['far',false,false,'far'],['medium',false,false,'medium'],['high',false,false,'high'],['high',false,true,'night']]){
      const rows=await page.evaluate(([l,b,n])=>window.review.gallery(l,b,n),[level,before,night]);cases.push(...rows);
      await page.screenshot({path:path.join(out,`${label}.png`)});
    }
    await page.setViewportSize({width:1300,height:1100});await page.evaluate(()=>window.review.reset());
    for(const name of await page.evaluate(()=>window.review.names)){
      await page.evaluate(name=>window.review.show(name),name);await page.screenshot({path:path.join(out,name.toLowerCase().replaceAll(' ','-')+'.png')});
    }
    const stats=await page.evaluate(()=>window.review.stats());
    fs.writeFileSync(path.join(out,'art-report.json'),JSON.stringify({cases,errors,...stats},null,2));
    if(errors.length||stats.programs.some(p=>!p.runnable))throw Error(JSON.stringify(errors));
    console.log(JSON.stringify({cases:cases.length,errors,...stats}));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
