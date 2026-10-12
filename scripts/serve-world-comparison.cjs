// Only serves the local review artifact and its explicit assets, on loopback.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../.graphics-review/world-comparison');
const port = Number(process.env.WORLD_COMPARISON_PORT || 3100);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };
http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  let file;
  try { file = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html'; }
  catch { res.writeHead(400).end(); return; }
  if (!/^(index\.html|manifest\.json|CREDITS\.md|(?:columbus|manhattan|innsbruck|sydney)-(?:before|after|materials-before)\.png)$/.test(file)) {
    res.writeHead(404).end(); return;
  }
  const source = file === 'index.html' ? path.join(__dirname, 'world-comparison.html') : file === 'CREDITS.md' ? path.resolve(__dirname, '../CREDITS.md') : path.join(root, file);
  fs.stat(source, (error, stat) => {
    if (error) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Content-Length': stat.size, 'Cache-Control': file.endsWith('.png') ? 'public, max-age=3600' : 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(source).on('error', () => res.destroy()).pipe(res);
  });
}).listen(port, '127.0.0.1', () => console.log(`World comparison: http://localhost:${port}`));
