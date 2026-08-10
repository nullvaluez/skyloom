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
// The cut is beat-synced: the score runs at 120 BPM, so one bar = 2.0 s and
// EVERY duration below is a multiple of 2.0 — every hard cut lands on a
// downbeat. Shots are fast (one bar) with aggressive Ken Burns moves plus a
// 6-frame punch-in at each cut; the two 4 s shots (Eiffel, boost) are the
// held "hero" beats.
// kind 'shot': Ken Burns over scripts/<src>.
//   move 'push' zooms 1 -> 1+amp at focus (fx,fy); move 'pan' holds zoom and
//   slides the focus x from fx to fx2 at height fy.
//   live: if trailer/live/<live>.mp4 exists (recorded by trailer/capture.mjs
//   against a dev server with real network + GPU), that LIVE gameplay footage
//   replaces the Ken Burns still for this slot, same duration.
// kind 'card': Chromium-rendered title card (built below), fades in/out.
const BOARD = [
  { kind: 'card', id: 'title', dur: 4.0 },
  { kind: 'shot', src: 'r18a1-manhattan-roofs.png', dur: 2.0, move: 'push', amp: 0.16, fx: 0.5, fy: 0.42, live: 'sat-manhattan' },
  { kind: 'shot', src: 'r13-bldg-tokyo.png', dur: 2.0, move: 'pan', zoom: 1.1, fx: 0.15, fx2: 0.6, fy: 0.4 },
  { kind: 'shot', src: 'r21b-on-heal-sf.png', dur: 2.0, move: 'pan', zoom: 1.1, fx: 0.22, fx2: 0.62, fy: 0.45, live: 'liberty' },
  { kind: 'shot', src: 'weather-09-dusk-walk.png', dur: 2.0, move: 'push', amp: 0.14, fx: 0.5, fy: 0.35, live: 'photo-orbit' },
  { kind: 'card', id: 'real', dur: 2.0 },
  { kind: 'shot', src: 'r13-water-nyharbor.png', dur: 2.0, move: 'push', amp: 0.16, fx: 0.5, fy: 0.45, live: 'traffic-cinema' },
  { kind: 'shot', src: 'warp-03-sat-tokyo.png', dur: 2.0, move: 'push', amp: 0.14, fx: 0.5, fy: 0.4 },
  { kind: 'card', id: 'night', dur: 2.0 },
  { kind: 'shot', src: 'r16-satnight-01-manhattan-night.png', dur: 2.0, move: 'pan', zoom: 1.1, fx: 0.58, fx2: 0.25, fy: 0.45 },
  { kind: 'shot', src: 'r20-c-eiffel-satellite-after.png', dur: 4.0, move: 'push', amp: 0.16, fx: 0.5, fy: 0.45, live: 'eiffel-night' },
  { kind: 'shot', src: 'hangar-01-fighter.png', dur: 2.0, move: 'push', amp: 0.18, fx: 0.5, fy: 0.45, live: 'neon-night' },
  { kind: 'shot', src: 'globe-02-neon-down.png', dur: 2.0, move: 'push', amp: 0.2, fx: 0.5, fy: 0.5 },
  { kind: 'shot', src: 'neon-01-manhattan.png', dur: 2.0, move: 'pan', zoom: 1.09, fx: 0.35, fx2: 0.62, fy: 0.5 },
  { kind: 'shot', src: 'neon-03-kjfk-runways.png', dur: 2.0, move: 'push', amp: 0.15, fx: 0.5, fy: 0.5 },
  { kind: 'shot', src: 'edge-05-boost-ribbons.png', dur: 4.0, move: 'push', amp: 0.3, fx: 0.5, fy: 0.45, live: 'boost' },
  { kind: 'card', id: 'features', dur: 2.0 },
  { kind: 'shot', src: 'atlas-01-open.png', dur: 2.0, move: 'push', amp: 0.1, fx: 0.5, fy: 0.5 },
  { kind: 'card', id: 'end', dur: 6.0 },
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
    sub: '<b>Live ADS-B traffic</b>',
  }),
  night: cardHtml({ title: 'Chase the night' }),
  features: cardHtml({
    title: 'A whole living planet',
    sub: 'Real monuments &nbsp;·&nbsp; <b>nine aircraft</b> &nbsp;·&nbsp; contracts &nbsp;·&nbsp; photo mode',
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
// 3. Soundtrack — offline synthwave engine (120 BPM, the cut's bar grid)
// ---------------------------------------------------------------------------
// Four-on-the-floor kick, offbeat hats, snare on 2 & 4, driving eighth-note
// bass and a 16th-note arp with a dotted-eighth echo, all sidechain-ducked
// against the kick. Crashes land on every card and on the boost shot. First
// bar is a drum+riser count-in under the title; drums stop one bar into the
// end card and the final chord rings out.
function synthAudio(outWav) {
  const SR = 44100;
  const BEAT = 0.5; // 120 BPM
  const BAR = 4 * BEAT;
  const N = Math.ceil(TOTAL * SR);
  const L = new Float64Array(N);
  const R = new Float64Array(N);
  const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
  let rs = 42;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);

  // Cut-sheet timing hooks.
  let cursor = 0;
  const crashAt = [];
  let endCardT = TOTAL - 6;
  for (const b of BOARD) {
    if (b.kind === 'card') {
      crashAt.push(cursor);
      if (b.id === 'end') endCardT = cursor;
    }
    if (b.live === 'boost' || b.src === 'edge-05-boost-ribbons.png') crashAt.push(cursor);
    cursor += b.dur;
  }
  const drumsEnd = Math.min(TOTAL, endCardT + BAR); // one bar into the end card
  const grooveT0 = BAR; // bar 0 = count-in, groove from bar 1

  // Am / F / C / G, one chord per bar; the bar that starts the end card and
  // everything after it holds Am so the outro resolves.
  const CHORDS = [
    [45, 48, 52, 57], // Am
    [41, 45, 48, 52], // F
    [43, 48, 52, 55], // C
    [43, 47, 50, 55], // G
  ];
  const chordAtBar = (bar) => (bar * BAR >= endCardT - 0.01 ? CHORDS[0] : CHORDS[bar % 4]);

  // --- tiny event renderers -------------------------------------------------
  const addKick = (t) => {
    const s0 = Math.floor(t * SR);
    for (let i = 0; i < SR * 0.28; i++) {
      const tt = i / SR;
      const f = 48 + 112 * Math.exp(-tt / 0.028);
      const a = Math.exp(-tt / 0.085) * 0.95 * Math.sin(2 * Math.PI * f * tt);
      const s = s0 + i;
      if (s < N) {
        L[s] += a;
        R[s] += a;
      }
    }
  };
  const addNoise = (t, dur, gain, lpHz, hp = false) => {
    const s0 = Math.floor(t * SR);
    const n = Math.floor(dur * SR);
    let lp = 0;
    const c = 1 - Math.exp((-2 * Math.PI * lpHz) / SR);
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      lp += c * (w - lp);
      const x = hp ? w - lp : lp;
      const a = x * Math.exp((-i / n) * 5) * gain;
      const s = s0 + i;
      if (s < N) {
        L[s] += a;
        R[s] += a;
      }
    }
  };
  const addSnare = (t) => {
    addNoise(t, 0.14, 0.34, 1800, true);
    const s0 = Math.floor(t * SR);
    for (let i = 0; i < SR * 0.08; i++) {
      const tt = i / SR;
      const a = Math.exp(-tt / 0.03) * 0.25 * Math.sin(2 * Math.PI * 195 * tt);
      const s = s0 + i;
      if (s < N) {
        L[s] += a;
        R[s] += a;
      }
    }
  };
  // pluck: short enveloped saw through a one-pole, with optional echo
  const addPluck = (t, midi, dur, gain, lpHz, pan) => {
    const f = midiHz(midi);
    const s0 = Math.floor(t * SR);
    const n = Math.min(N - s0, Math.floor(dur * SR));
    if (n <= 0) return;
    let ph = 0;
    let lp = 0;
    const c = 1 - Math.exp((-2 * Math.PI * lpHz) / SR);
    for (let i = 0; i < n; i++) {
      ph += f / SR;
      if (ph >= 1) ph -= 1;
      lp += c * (ph * 2 - 1 - lp);
      const env = Math.min(1, i / (SR * 0.004)) * Math.exp((-i / SR) / (dur * 0.38));
      const a = lp * env * gain;
      const s = s0 + i;
      L[s] += a * (1 - pan);
      R[s] += a * pan;
    }
  };

  // --- pattern sequencing ---------------------------------------------------
  const bars = Math.ceil(TOTAL / BAR);
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * BAR;
    if (t0 >= TOTAL) break;
    const ch = chordAtBar(bar);
    const root = ch[0];
    const inGroove = t0 >= grooveT0 - 0.01 && t0 < drumsEnd - 0.01;

    // drums
    if (t0 < drumsEnd - 0.01) {
      for (let b = 0; b < 4; b++) {
        const bt = t0 + b * BEAT;
        if (bt >= drumsEnd) break;
        addKick(bt);
        if (inGroove) {
          addNoise(bt + BEAT / 2, 0.03, 0.16, 6000, true); // offbeat hat
          if (b === 1 || b === 3) addSnare(bt);
        }
      }
    }
    // bass: driving eighths on the root, octave pop on the last eighth
    if (inGroove) {
      for (let e = 0; e < 8; e++) {
        const et = t0 + e * (BEAT / 2);
        addPluck(et, root - 12 + (e === 7 ? 12 : 0), 0.22, 0.5, 420, 0.5);
      }
      // arp: 16ths cycling chord tones over two octaves + dotted-eighth echo
      for (let x = 0; x < 16; x++) {
        const xt = t0 + x * (BEAT / 4);
        const seq = [0, 1, 2, 3, 2, 1, 3, 2];
        const m = ch[seq[x % 8] % ch.length] + (x % 8 >= 4 ? 12 : 0) + 12;
        const pan = 0.3 + 0.4 * ((x % 4) / 3);
        addPluck(xt, m, 0.16, 0.2, 2400, pan);
        addPluck(xt + 0.375, m, 0.14, 0.075, 1900, 1 - pan); // echo
      }
    }
    // pad: sustained chord through the whole bar (rings past drumsEnd)
    for (const m of ch) {
      addPluck(t0, m, t0 >= endCardT ? 5.5 : BAR * 1.1, 0.11, 900, 0.35 + 0.3 * rnd());
    }
  }
  // count-in riser into the first groove bar, and one into the boost/cards
  for (const at of [grooveT0, ...crashAt]) {
    const dur = Math.min(1.6, at);
    const s0 = Math.max(0, Math.floor((at - dur) * SR));
    const s1 = Math.floor(at * SR);
    let lp = 0;
    const c = 1 - Math.exp((-2 * Math.PI * 900) / SR);
    for (let s = s0; s < s1; s++) {
      const p = (s - s0) / (s1 - s0);
      lp += c * (rnd() * 2 - 1 - lp);
      const a = lp * p * p * 0.11;
      L[s] += a;
      R[s] += a;
    }
  }
  for (const at of crashAt) addNoise(at, 0.9, 0.2, 7500, true);

  // Sidechain duck everything (except the kicks we just re-add) + master.
  // Cheap trick: duck the WHOLE mix a hair after each beat, then re-add kick
  // punch via the exponential itself — reads as pumping without bus routing.
  let peak = 0;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const inPump = t >= grooveT0 && t < drumsEnd;
    const phase = ((t % BEAT) + BEAT) % BEAT;
    const duck = inPump ? 1 - 0.42 * Math.exp(-phase / 0.07) : 1;
    const fade = Math.min(1, t / 0.4, Math.max(0, (TOTAL - t) / 2.5));
    L[s] *= duck * fade;
    R[s] *= duck * fade;
    peak = Math.max(peak, Math.abs(L[s]), Math.abs(R[s]));
  }
  const norm = 0.78 / (peak || 1);
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
  const liveSrc = b.live && path.join(ROOT, 'trailer', 'live', `${b.live}.mp4`);
  if (liveSrc && fs.existsSync(liveSrc)) {
    // Live gameplay footage from trailer/capture.mjs — normalize and slot in.
    run(
      ['-y', '-i', liveSrc, '-vf', `fps=${FPS},scale=${W}:${H},format=yuv420p`,
        '-t', b.dur.toFixed(3), '-an', ...enc],
      `live ${b.live}`
    );
    console.log(`seg ${i} (LIVE ${b.live}) ${b.dur}s`);
    return seg;
  }
  if (b.kind === 'card') {
    const img = path.join(WORK, `card-${b.id}.png`);
    // Big cards (title/end) breathe; the fast mid-cards snap in and out.
    const fIn = b.dur > 3 ? 0.4 : 0.2;
    const fOut = b.dur > 3 ? 0.6 : 0.25;
    run(
      ['-y', '-loop', '1', '-t', b.dur.toFixed(3), '-i', img, '-vf',
        `fps=${FPS},scale=${W}:${H},fade=t=in:st=0:d=${fIn},fade=t=out:st=${(b.dur - fOut).toFixed(2)}:d=${fOut},format=yuv420p`,
        ...enc],
      `card ${b.id}`
    );
  } else {
    const img = path.join(ROOT, 'scripts', b.src);
    const M = nf - 1;
    // 6-frame punch-in at the head of every shot = the cut lands ON the beat.
    const punch = `0.05*min(on,6)/6`;
    let z, x, y;
    if (b.move === 'push') {
      z = `1+${punch}+${b.amp}*on/${M}`;
      x = `(iw-iw/zoom)*${b.fx}`;
      y = `(ih-ih/zoom)*${b.fy}`;
    } else {
      z = `${b.zoom}+${punch}`;
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
