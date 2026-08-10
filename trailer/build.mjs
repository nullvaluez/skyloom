/**
 * SkyLoom game trailer builder.
 *
 * Assembles `trailer/skyloom-trailer.mp4` (1280x720 @ 24fps, ~75 s) from the
 * repo's certified round-evidence captures in `scripts/*.png` — every world
 * frame in the trailer is a real, unretouched capture of the game produced by
 * the verification harnesses — plus Chromium-rendered title cards and a
 * first-party procedurally synthesized ambient soundtrack (no third-party
 * audio, nothing to license).
 *
 * Motion is Ken Burns (ffmpeg zoompan over a 3200x1800 upscale so the pan
 * steps stay sub-pixel). Title cards use the app's own bundled Archivo Black
 * (`public/fonts/`, OFL). The end card carries the same data attribution the
 * in-game AttributionBar shows (and which is already baked into the captures).
 *
 * Prereqs (not in package.json — install ad hoc, exactly like the verify
 * harnesses' playwright dependency):
 *   npm i --no-save playwright ffmpeg-static
 * Chromium: uses PLAYWRIGHT default resolution; set CHROMIUM_PATH to override
 * (e.g. /opt/pw-browsers/chromium on CI containers).
 *
 * Run: node trailer/build.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = process.env.TRAILER_WORK || path.join(ROOT, 'trailer', '.work');
const OUT = path.join(ROOT, 'trailer', 'skyloom-trailer.mp4');
const POSTER = path.join(ROOT, 'trailer', 'poster.jpg');
const FPS = 24;
const W = 1280;
const H = 720;

const ffmpeg = (await import(path.join(ROOT, 'node_modules', 'ffmpeg-static', 'index.js'))).default;
const { chromium } = await import(path.join(ROOT, 'node_modules', 'playwright', 'index.mjs'));

fs.mkdirSync(WORK, { recursive: true });

// ---------------------------------------------------------------------------
// 1. Storyboard
// ---------------------------------------------------------------------------
// kind 'shot': Ken Burns over scripts/<src>.
//   move 'push' zooms 1 -> 1+amp at focus (fx,fy); move 'pan' holds zoom and
//   slides the focus x from fx to fx2 at height fy.
// kind 'card': Chromium-rendered title card (built below), fades in/out.
const BOARD = [
  { kind: 'card', id: 'title', dur: 4.2 },
  { kind: 'shot', src: 'r18a1-manhattan-roofs.png', dur: 4.6, move: 'push', amp: 0.1, fx: 0.5, fy: 0.42 },
  { kind: 'shot', src: 'r13-bldg-tokyo.png', dur: 4.6, move: 'pan', zoom: 1.08, fx: 0.18, fx2: 0.55, fy: 0.4 },
  { kind: 'shot', src: 'weather-09-dusk-walk.png', dur: 4.4, move: 'push', amp: 0.08, fx: 0.5, fy: 0.35 },
  { kind: 'card', id: 'real', dur: 3.2 },
  { kind: 'shot', src: 'p5-03-formation.png', dur: 4.6, move: 'push', amp: 0.1, fx: 0.46, fy: 0.42 },
  { kind: 'shot', src: 'r21b-on-heal-sf.png', dur: 4.4, move: 'pan', zoom: 1.08, fx: 0.25, fx2: 0.6, fy: 0.45 },
  { kind: 'card', id: 'night', dur: 2.8 },
  { kind: 'shot', src: 'r16-satnight-01-manhattan-night.png', dur: 4.8, move: 'pan', zoom: 1.08, fx: 0.6, fx2: 0.25, fy: 0.45 },
  { kind: 'shot', src: 'r20-c-eiffel-satellite-after.png', dur: 4.8, move: 'push', amp: 0.11, fx: 0.5, fy: 0.45 },
  { kind: 'shot', src: 'hangar-01-fighter.png', dur: 4.4, move: 'push', amp: 0.09, fx: 0.5, fy: 0.45 },
  { kind: 'shot', src: 'neon-01-manhattan.png', dur: 4.4, move: 'pan', zoom: 1.07, fx: 0.38, fx2: 0.6, fy: 0.5 },
  { kind: 'shot', src: 'f5-02-skyline.png', dur: 4.4, move: 'push', amp: 0.1, fx: 0.7, fy: 0.45 },
  { kind: 'shot', src: 'edge-05-boost-ribbons.png', dur: 3.6, move: 'push', amp: 0.16, fx: 0.5, fy: 0.45 },
  { kind: 'card', id: 'features', dur: 3.4 },
  { kind: 'shot', src: 'atlas-01-open.png', dur: 4.0, move: 'push', amp: 0.06, fx: 0.5, fy: 0.5 },
  { kind: 'shot', src: 'r20-c-esb-satellite-after.png', dur: 4.6, move: 'push', amp: 0.09, fx: 0.5, fy: 0.4 },
  { kind: 'card', id: 'end', dur: 6.5 },
];
const TOTAL = BOARD.reduce((s, b) => s + b.dur, 0);
console.log(`storyboard: ${BOARD.length} segments, ${TOTAL.toFixed(1)}s`);

// ---------------------------------------------------------------------------
// 2. Title cards (Chromium render, app-styled)
// ---------------------------------------------------------------------------
const fontB64 = fs.readFileSync(path.join(ROOT, 'public/fonts/ArchivoBlack-Regular.ttf')).toString('base64');

function cardHtml({ kicker = '', title, sub = '', fine = '', big = false }) {
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:'Archivo Black';src:url(data:font/ttf;base64,${fontB64})format('truetype')}
  *{margin:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  body{background:radial-gradient(120% 90% at 50% 20%,#0b1226 0%,#060a18 55%,#03050c 100%);
    display:flex;align-items:center;justify-content:center;position:relative;
    font-family:ui-monospace,'Cascadia Mono','Menlo',monospace;color:#e8ecf6}
  canvas{position:absolute;inset:0}
  .wrap{position:relative;text-align:center;padding:0 90px;z-index:2}
  .kicker{color:#d7a94b;letter-spacing:.42em;font-size:15px;text-transform:uppercase;margin-bottom:26px}
  h1{font-family:'Archivo Black';font-weight:400;color:#fff;letter-spacing:.06em;
    font-size:${big ? 118 : 54}px;line-height:1.08;
    text-shadow:0 0 34px rgba(120,160,255,.38),0 2px 0 rgba(0,0,0,.55)}
  .sub{margin-top:30px;font-size:21px;color:#aab6d4;letter-spacing:.08em;line-height:1.7}
  .sub b{color:#d7a94b;font-weight:400}
  .rule{width:84px;height:2px;background:#d7a94b;margin:34px auto 0;opacity:.85}
  .fine{position:absolute;left:0;right:0;bottom:26px;text-align:center;font-size:12.5px;
    color:#5c6785;letter-spacing:.06em;line-height:1.8;z-index:2}
  </style><body>
  <canvas id="s" width="${W}" height="${H}"></canvas>
  <div class="wrap">
    ${kicker ? `<div class="kicker">${kicker}</div>` : ''}
    <h1>${title}</h1>
    ${sub ? `<div class="rule"></div><div class="sub">${sub}</div>` : ''}
  </div>
  ${fine ? `<div class="fine">${fine}</div>` : ''}
  <script>
  // deterministic starfield, same flavor as the game's night sky
  const c=document.getElementById('s').getContext('2d');let seed=7;
  const rnd=()=>((seed=seed*16807%2147483647)/2147483647);
  for(let i=0;i<240;i++){const x=rnd()*${W},y=rnd()*${H},r=rnd()*1.3+.2,a=rnd()*.55+.1;
    c.fillStyle='rgba(210,225,255,'+a+')';c.beginPath();c.arc(x,y,r,0,7);c.fill()}
  </script></body>`;
}

const CARDS = {
  title: cardHtml({
    kicker: 'A flight game inside a live flight tracker',
    title: 'SKYLOOM',
    sub: 'Fly the live sky.',
    big: true,
  }),
  real: cardHtml({
    title: 'Every plane up there<br>is real',
    sub: 'Live ADS-B traffic — <b>real aircraft, real routes</b>,<br>streamed into a flyable world',
  }),
  night: cardHtml({ title: 'Chase the night' }),
  features: cardHtml({
    title: 'Real monuments.<br>Nine flyable aircraft.',
    sub: 'Contracts &nbsp;·&nbsp; photo mode &nbsp;·&nbsp; logbook &nbsp;·&nbsp; a whole living planet',
  }),
  end: cardHtml({
    kicker: 'Keyless · open source · runs in your browser',
    title: 'SKYLOOM',
    sub: 'github.com/nullvaluez/skyloom',
    big: true,
    fine:
      'Map data © OpenStreetMap contributors · Tiles © OpenFreeMap · Imagery &amp; terrain © Esri, Maxar, Earthstar Geographics<br>' +
      'Flight data © adsb.lol / adsb.fi · All footage captured in-engine',
  }),
};

async function renderCards() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [id, html] of Object.entries(CARDS)) {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(WORK, `card-${id}.png`) });
    console.log(`card ${id} rendered`);
  }
  // Poster: end-style title over the Eiffel night capture, for the README.
  const eiffel = fs
    .readFileSync(path.join(ROOT, 'scripts/r20-c-eiffel-satellite-after.png'))
    .toString('base64');
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:'Archivo Black';src:url(data:font/ttf;base64,${fontB64})format('truetype')}
    *{margin:0}html,body{width:${W}px;height:${H}px;overflow:hidden}
    .bg{position:absolute;inset:0;background:url(data:image/png;base64,${eiffel}) center/cover;filter:brightness(.72)}
    .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,5,12,.55),rgba(3,5,12,.05) 40%,rgba(3,5,12,.7))}
    .t{position:absolute;left:0;right:0;top:56px;text-align:center;font-family:'Archivo Black';
      font-size:96px;color:#fff;letter-spacing:.06em;text-shadow:0 0 34px rgba(120,160,255,.5),0 2px 0 rgba(0,0,0,.6)}
    .s{position:absolute;left:0;right:0;bottom:44px;text-align:center;
      font-family:ui-monospace,monospace;font-size:20px;color:#d7a94b;letter-spacing:.3em}
    </style><body><div class="bg"></div><div class="shade"></div>
    <div class="t">SKYLOOM</div><div class="s">FLY THE LIVE SKY</div></body>`,
    { waitUntil: 'networkidle' }
  );
  await page.waitForTimeout(120);
  await page.screenshot({ path: POSTER, type: 'jpeg', quality: 88 });
  console.log('poster rendered');
  await browser.close();
}

// ---------------------------------------------------------------------------
// 3. Soundtrack — offline ambient synth (saw pads + sub, slow chords)
// ---------------------------------------------------------------------------
function synthAudio(outWav) {
  const SR = 44100;
  const N = Math.ceil(TOTAL * SR);
  const L = new Float64Array(N);
  const R = new Float64Array(N);
  const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

  // A-minor progression, one chord per ~8 s, final chord holds to the end.
  const PROG = [
    [45, 52, 59, 60], // Am9
    [41, 48, 52, 57], // Fmaj7
    [48, 55, 64], // C
    [43, 50, 59], // G
    [45, 52, 59, 60], // Am9
    [41, 48, 52, 57], // Fmaj7
    [50, 57, 64, 65], // Dm9
    [45, 52, 57, 60], // Am (final)
  ];
  const CHORD_S = 8;
  let rs = 42;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);

  const renderChord = (notes, t0, t1, gain) => {
    const att = 2.6;
    const rel = 3.2;
    const s0 = Math.max(0, Math.floor(t0 * SR));
    const s1 = Math.min(N, Math.ceil((t1 + rel) * SR));
    const voices = [];
    for (const m of notes) {
      const f = midiHz(m);
      for (const det of [-0.0016, 0.0013]) {
        voices.push({ f: f * (1 + det), ph: rnd(), pan: rnd() * 0.7 + 0.15 });
      }
    }
    // sub an octave below the root
    voices.push({ f: midiHz(notes[0] - 12), ph: 0, pan: 0.5, sine: true, g: 0.9 });
    for (const v of voices) {
      const g = (gain * (v.g ?? 0.32)) / Math.sqrt(voices.length);
      let phase = v.ph;
      const inc = v.f / SR;
      let lpL = 0;
      const lpC = 1 - Math.exp((-2 * Math.PI * 950) / SR);
      for (let s = s0; s < s1; s++) {
        const t = s / SR;
        let env;
        if (t < t0 + att) env = (t - t0) / att;
        else if (t > t1) env = Math.max(0, 1 - (t - t1) / rel);
        else env = 1;
        env *= env;
        phase += inc;
        if (phase >= 1) phase -= 1;
        let x = v.sine ? Math.sin(2 * Math.PI * phase) : phase * 2 - 1;
        lpL += lpC * (x - lpL);
        x = v.sine ? x : lpL;
        const a = x * env * g;
        L[s] += a * (1 - v.pan);
        R[s] += a * v.pan;
      }
    }
  };

  for (let i = 0; i < PROG.length; i++) {
    const t0 = i * CHORD_S;
    const t1 = i === PROG.length - 1 ? TOTAL - 3.5 : (i + 1) * CHORD_S;
    if (t0 > TOTAL) break;
    renderChord(PROG[i], t0, Math.min(t1, TOTAL), 0.5);
  }

  // Gentle filtered-noise swells rising into each title card.
  let tCursor = 0;
  const swells = [];
  for (const b of BOARD) {
    if (b.kind === 'card' && tCursor > 1) swells.push(tCursor);
    tCursor += b.dur;
  }
  for (const at of swells) {
    const dur = 1.6;
    const s0 = Math.max(0, Math.floor((at - dur) * SR));
    const s1 = Math.min(N, Math.floor((at + 0.35) * SR));
    let lp = 0;
    const lpC = 1 - Math.exp((-2 * Math.PI * 640) / SR);
    for (let s = s0; s < s1; s++) {
      const p = (s - s0) / (s1 - s0);
      const env = p < 0.82 ? (p / 0.82) ** 2.4 : 1 - (p - 0.82) / 0.18;
      lp += lpC * (rnd() * 2 - 1 - lp);
      const a = lp * env * 0.055;
      L[s] += a;
      R[s] += a;
    }
  }

  // Master: slow width LFO, fade in/out, normalize, 16-bit WAV.
  let peak = 0;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const lfo = 1 + 0.06 * Math.sin(2 * Math.PI * t * 0.05);
    const fade = Math.min(1, t / 1.2, Math.max(0, (TOTAL - t) / 4));
    L[s] *= lfo * fade;
    R[s] *= (2 - lfo) * fade;
    peak = Math.max(peak, Math.abs(L[s]), Math.abs(R[s]));
  }
  const norm = 0.62 / (peak || 1);
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + N * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(N * 4, 40);
  for (let s = 0; s < N; s++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[s] * norm)) * 32767), 44 + s * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[s] * norm)) * 32767), 46 + s * 4);
  }
  fs.writeFileSync(outWav, buf);
  console.log(`audio: ${TOTAL.toFixed(1)}s -> ${outWav}`);
}

// ---------------------------------------------------------------------------
// 4. Video segments (ffmpeg zoompan) + final assembly
// ---------------------------------------------------------------------------
function run(args, label) {
  const r = spawnSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    console.error(r.stderr?.toString().slice(-3000));
    throw new Error(`ffmpeg failed: ${label}`);
  }
}

function buildSegment(b, i) {
  const nf = Math.round(b.dur * FPS);
  // .mp4 intermediates, NOT .ts: this static ffmpeg build segfaults on any
  // mpegts demux (encode is fine, reading back crashes); mp4 read is clean.
  const seg = path.join(WORK, `seg-${String(i).padStart(2, '0')}.mp4`);
  const enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-r', String(FPS), seg];
  if (b.kind === 'card') {
    const img = path.join(WORK, `card-${b.id}.png`);
    const fadeOut = (b.dur - 0.6).toFixed(2);
    run(
      ['-y', '-loop', '1', '-t', b.dur.toFixed(3), '-i', img, '-vf',
        `fps=${FPS},scale=${W}:${H},fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut}:d=0.6,format=yuv420p`,
        ...enc],
      `card ${b.id}`
    );
  } else {
    const img = path.join(ROOT, 'scripts', b.src);
    const M = nf - 1;
    let z, x, y;
    if (b.move === 'push') {
      z = `1+${b.amp}*on/${M}`;
      x = `(iw-iw/zoom)*${b.fx}`;
      y = `(ih-ih/zoom)*${b.fy}`;
    } else {
      z = String(b.zoom);
      x = `(iw-iw/zoom)*(${b.fx}+(${b.fx2}-${b.fx})*on/${M})`;
      y = `(ih-ih/zoom)*${b.fy}`;
    }
    run(
      ['-y', '-i', img, '-vf',
        `scale=3200:1800,zoompan=z='${z}':x='${x}':y='${y}':d=${nf}:s=${W}x${H}:fps=${FPS},format=yuv420p`,
        '-frames:v', String(nf), ...enc],
      `shot ${b.src}`
    );
  }
  console.log(`seg ${i} (${b.kind === 'card' ? b.id : b.src}) ${b.dur}s`);
  return seg;
}

await renderCards();
synthAudio(path.join(WORK, 'score.wav'));
const segs = BOARD.map(buildSegment);
const listFile = path.join(WORK, 'concat.txt');
fs.writeFileSync(listFile, segs.map((s) => `file '${s}'`).join('\n'));
run(
  ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-i', path.join(WORK, 'score.wav'),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', OUT],
  'final mux'
);
const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
console.log(`DONE: ${OUT} (${mb} MB, ${TOTAL.toFixed(1)}s)`);
