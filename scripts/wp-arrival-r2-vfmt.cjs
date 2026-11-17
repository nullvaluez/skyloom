/** WORLD PASS B r2 (item 8): does a 3-component 8- or 16-bit vertex attribute cost a conversion
 * under ANGLE / D3D11, and does a 4-component layout avoid it? A blank page, WebGL2, installed
 * Chrome, D3D11. Per layout: upload N vertices (bufferData), bind as the only attribute of a
 * trivial program, draw once, gl.finish(); wall time of upload + first draw + finish, and of a
 * second draw + finish (no upload). Medians of --reps runs, interleaved layouts. No dev server.
 *   node scripts/wp-arrival-r2-vfmt.cjs [--n=400000] [--reps=9] --out=<dir>
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./wp-arrival-r2-lib.cjs');
const { args } = L;
const out = path.resolve(String(args.out || '.graphics-review/world-pass/r2/arrival/vfmt'));
fs.mkdirSync(out, { recursive: true });
(async () => {
  console.log('SLOT after', await L.acquireSlot('wp-arrival-r2-vfmt'), 'ms');
  const browser = await L.launch();
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    const res = await page.evaluate(({ n, reps }) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; document.body.appendChild(c);
      const gl = c.getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info');
      const vs = '#version 300 es\nin vec4 a; void main(){ gl_Position = vec4(a.xyz * 0.0, 1.0); gl_PointSize = 1.0; }';
      const fs = '#version 300 es\nprecision mediump float; out vec4 o; void main(){ o = vec4(1.0); }';
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p); gl.useProgram(p);
      const layouts = {
        'uint8 norm x3 (colour)': [Uint8Array, 3, gl.UNSIGNED_BYTE, true], 'uint8 norm x4': [Uint8Array, 4, gl.UNSIGNED_BYTE, true],
        'int8 norm x3 (normal)': [Int8Array, 3, gl.BYTE, true], 'int8 norm x4': [Int8Array, 4, gl.BYTE, true],
        'int16 norm x3': [Int16Array, 3, gl.SHORT, true], 'int16 norm x4 (position r2)': [Int16Array, 4, gl.SHORT, true],
        'float32 x3 (position r1)': [Float32Array, 3, gl.FLOAT, false],
      };
      const runs = {};
      gl.finish();
      for (let r = 0; r < reps; r++) for (const [k, [T, size, type, norm]] of Object.entries(layouts)) {
        const data = new T(n * size); for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 100;
        const b = gl.createBuffer();
        const t0 = performance.now();
        gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, size, type, norm, 0, 0);
        gl.drawArrays(gl.POINTS, 0, n); gl.finish();
        const t1 = performance.now();
        gl.drawArrays(gl.POINTS, 0, n); gl.finish();
        const t2 = performance.now();
        (runs[k] ??= { first: [], again: [] }); runs[k].first.push(t1 - t0); runs[k].again.push(t2 - t1);
        gl.deleteBuffer(b);
      }
      const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(2); };
      return { gpu: gl.getParameter(e.UNMASKED_RENDERER_WEBGL), n, reps, layouts: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { uploadDrawFinishMs: med(v.first), drawFinishMs: med(v.again), all: v.first.map((x) => +x.toFixed(2)) }])) };
    }, { n: Number(args.n || 400000), reps: Number(args.reps || 9) });
    fs.writeFileSync(path.join(out, 'vfmt.json'), JSON.stringify(res, null, 1));
    console.log(res.gpu, 'n', res.n);
    for (const [k, v] of Object.entries(res.layouts)) console.log(k.padEnd(30), 'upload+draw+finish', v.uploadDrawFinishMs, 'ms | draw+finish', v.drawFinishMs, 'ms');
  } finally { await browser.close(); L.releaseSlot(); }
})();
