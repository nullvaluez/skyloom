const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const local=path.join(__dirname,'aircraft-review');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.glb':'model/gltf-binary','.json':'application/json','.png':'image/png','.css':'text/css'};
http.createServer((req,res)=>{
 try{const u=new URL(req.url,'http://localhost'),p=decodeURIComponent(u.pathname);let base,file;
 if(p.startsWith('/three/')){base=path.join(root,'node_modules/three');file=path.resolve(base,p.slice(7));}
 else if(p.startsWith('/models/')){base=path.join(root,'public/models');file=path.resolve(base,p.slice(8));}
 else if(p.startsWith('/before/')){base=path.join(root,'public/models');file=path.resolve(base,p.slice(8));}
 else{base=local;file=path.resolve(base,p==='/'?'index.html':p.slice(1));}
 if(!file.startsWith(path.resolve(base)+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end('Not found');return;}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
 }catch(e){res.writeHead(500);res.end(e.message);}
}).listen(3166,'127.0.0.1',()=>console.log('Aircraft comparison: http://127.0.0.1:3166'));
