/* Local-only evidence viewer; never part of the published game. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('.graphics-review/painterly'),port=Number(process.env.PAINTERLY_REVIEW_PORT||3041);
http.createServer((req,res)=>{
  let file;try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));}catch{res.writeHead(400);res.end();return;}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404);res.end('Evidence not available');return;}
    const type={'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.log':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res);
  });
}).listen(port,'127.0.0.1',()=>console.log('Painterly comparison: http://localhost:'+port));
