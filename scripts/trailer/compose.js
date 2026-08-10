/**
 * Compose — trim each captured clip to its action window, normalize, and
 * concatenate into the final trailer.
 *
 * Two passes on purpose:
 *   1. TRIM + NORMALIZE each segment to its own intermediate file (uniform
 *      size / fps / pixel format / SAR / timebase). Mixing a 1600×900 VP8
 *      screen recording with a 1600×900 card recording through one giant
 *      filter_complex is where concat pipelines break; normalizing first makes
 *      each input independently inspectable when something looks wrong.
 *   2. CONCAT the intermediates with the concat demuxer, then encode once.
 *
 * Trim offsets come from the capture sidecars (`shot.json` → actionStartMs /
 * actionEndMs), never from guessing at frame content — Playwright records a
 * context from creation, so every raw clip opens with ~50 s of boot.
 *
 * Usage:
 *   node scripts/trailer/compose.js --manifest=<file.json> --out=<path>
 *   node scripts/trailer/compose.js --from-raw=<dir> --out=<path>
 *   … --pre-roll=600     ms of lead-in kept before actionStart
 *   … --fps=30           output frame rate
 *   … --webm             force VP8/WebM even when H.264 is available
 *
 * A manifest is `[{ file, ssMs, durMs, label }]`. `--from-raw` builds one by
 * scanning a capture output directory for each shot dir's `shot.json`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { resolveFfmpeg } = require('./ffmpeg');

const SCRATCH =
  process.env.TRAILER_SCRATCH ||
  '/tmp/claude-0/-home-user-skyloom/a2c8c929-63cc-5f77-b20e-356e7d2abdf2/scratchpad';

function arg(name, dflt = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
}
const flag = (name) => process.argv.includes(`--${name}`);

function run(bin, args, label) {
  try {
    execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    const err = (e.stderr || '').toString().split('\n').slice(-25).join('\n');
    throw new Error(`ffmpeg failed (${label}):\n${err}`);
  }
}

/**
 * Container duration in seconds. `ffmpeg -i <file>` with no output always
 * exits non-zero ("At least one output file must be specified") and prints
 * Duration to stderr, so both paths parse stderr.
 */
function probeDuration(bin, file) {
  let s = '';
  try {
    execFileSync(bin, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    s = (e.stderr || '').toString();
  }
  const m = s.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

/**
 * Wall-clock → video-time ratio. Used only as a FALLBACK and as a diagnostic;
 * `findCut` is the real mechanism.
 *
 * Playwright records a context from creation, so the boot/warp/settle head has
 * to be cut off every clip. Wall-clock offsets cannot locate that cut on their
 * own: MEASURED here, a clip whose context lived 169.5 s wall was written as a
 * 177.8 s container, and correcting by that 1.049 ratio still put the cut ~7 s
 * early — the mapping is not a linear stretch anchored at the origin. (An
 * earlier 1.25 figure in these notes was inferred from an ESTIMATED close time
 * and was wrong; 1.049 is the measured value.)
 */
function timeScale(bin, file, closeMs) {
  const dur = probeDuration(bin, file);
  if (!dur || !closeMs) return { ratio: 1, dur, closeMs, measured: false };
  return { ratio: (dur * 1000) / closeMs, dur, closeMs, measured: true };
}

/**
 * Find the shot's cut point IN THE CONTENT.
 *
 * `capture.js` holds an opaque #000 plate over everything from just after the
 * world-streamed gate until the instant the shot begins, then fades off it.
 * The end of the LAST black interval is therefore exactly the cut — no
 * timeline assumption involved. Two black runs can exist (a dark night scene
 * could read as black earlier), so the last one before content wins.
 *
 * Detection alone is not enough to PICK the right interval: a night shot, and
 * the end card's own #09090b plate, can both read as black too. So the
 * wall-clock estimate is used as a COARSE locator (it is accurate to a few
 * seconds) and the cut SNAPS to the detected interval whose end is nearest —
 * coarse position from the clock, exact frame from the content.
 *
 * Returns seconds, or null when the filter is unavailable or finds nothing.
 */
// pix_th 0.10 is ffmpeg's own default and it matters here: VP8 stores
// limited-range luma, so a pure #000 plate comes back as Y=16 → 16/255 =
// 0.0627. A "tighter" 0.06 threshold therefore excludes true black by a hair
// and finds NOTHING. Measured: at 0.06 the plate was invisible to the filter;
// at 0.10 it is detected cleanly.
function findCut(bin, file, { minDurSec = 0.4, pixThresh = 0.1, nearSec = null, windowSec = 30 } = {}) {
  // spawnSync, not execFileSync: `-f null -` SUCCEEDS, and blackdetect writes
  // its findings to stderr. execFileSync only surfaces stderr when the process
  // throws, so on the success path the report was being silently discarded and
  // every clip reported "no black anchor".
  const r = spawnSync(
    bin,
    ['-hide_banner', '-i', file, '-vf', `blackdetect=d=${minDurSec}:pix_th=${pixThresh}`, '-an', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  const s = (r.stderr || '') + (r.stdout || '');
  if (!s) return null;
  const intervals = [...s.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({
    start: +m[1],
    end: +m[2],
  }));
  if (!intervals.length) return null;
  if (nearSec === null) return intervals[intervals.length - 1].end;
  let best = null;
  for (const iv of intervals) {
    const d = Math.abs(iv.end - nearSec);
    if (d <= windowSec && (!best || d < best.d)) best = { d, end: iv.end };
  }
  return best ? best.end : null;
}

/** Build a manifest from a capture run's sidecars, ordered by shot id. */
function manifestFromRaw(dir, preRollMs) {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const j = path.join(dir, name, 'shot.json');
    if (!fs.existsSync(j)) continue;
    const s = JSON.parse(fs.readFileSync(j, 'utf8'));
    if (!s.kept || !s.clip) {
      console.log(`  skip shot ${s.id} (${s.slug}): ${s.rejectReason || s.error || 'not kept'}`);
      continue;
    }
    const ss = Math.max(0, (s.actionStartMs ?? 0) - preRollMs);
    const dur = Math.max(500, (s.actionEndMs ?? 0) - ss);
    entries.push({ file: s.clip, ssMs: ss, durMs: dur, label: `${s.id}-${s.slug}`, id: s.id, closeMs: s.closeMs });
  }
  return entries.sort((a, b) => a.id - b.id);
}

(async () => {
  const outPath = arg('out', path.join(process.cwd(), 'marketing/trailer/skyloom-trailer.mp4'));
  const fps = Number(arg('fps', 30));
  const preRoll = Number(arg('pre-roll', 600));
  const width = Number(arg('width', 1600));
  const height = Number(arg('height', 900));
  const forceWebm = flag('webm');

  const { bin, caps } = resolveFfmpeg();
  console.log(`ffmpeg: ${bin}`);
  console.log(
    `  caps: h264=${caps.h264} vp8=${caps.vp8} concat=${caps.canConcat} fpsFilter=${caps.fpsFilter} setsar=${caps.setsarFilter}`
  );

  let manifest;
  const mf = arg('manifest');
  const raw = arg('from-raw');
  if (mf) manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  else if (raw) manifest = manifestFromRaw(raw, preRoll);
  else manifest = [];

  // Cards bookend the gameplay: title plate in front, end card last. They are
  // captured separately (cards.js) because they need no streamed world.
  const cardsDir = arg('cards');
  if (cardsDir) {
    const head = [];
    const tail = [];
    for (const [kind, bucket] of [
      ['title', head],
      ['end', tail],
    ]) {
      const j = path.join(cardsDir, `${kind}-card.json`);
      if (!fs.existsSync(j)) {
        console.log(`  no ${kind} card at ${j} — skipping`);
        continue;
      }
      const c = JSON.parse(fs.readFileSync(j, 'utf8'));
      const ss = Math.max(0, (c.actionStartMs ?? 0) - Math.min(preRoll, 300));
      bucket.push({
        // Sidecars store a basename so they stay portable; older/absolute
        // values still work.
        file: path.isAbsolute(c.file) ? c.file : path.join(cardsDir, c.file),
        ssMs: ss,
        durMs: Math.max(500, (c.actionEndMs ?? 0) - ss),
        label: `${kind}-card`,
        closeMs: c.closeMs,
        // Cards carry no black plate — they have no boot head to cut, and both
        // are near-#09090b throughout, which `blackdetect` would happily flag
        // as one long black interval. Their own offsets are exact.
        noCutDetect: true,
      });
    }
    manifest = [...head, ...manifest, ...tail];
  }
  if (!manifest.length) throw new Error('pass --manifest=<file.json>, --from-raw=<dir> and/or --cards=<dir>');

  console.log(`\nsegments (${manifest.length}):`);
  manifest.forEach((m) => console.log(`  ${String(m.label).padEnd(24)} ss=${(m.ssMs / 1000).toFixed(2)}s dur=${(m.durMs / 1000).toFixed(2)}s  ${path.basename(m.file)}`));

  const useH264 = caps.h264 && !forceWebm;
  const ext = useH264 ? 'mp4' : 'webm';
  const finalOut = outPath.replace(/\.(mp4|webm)$/, '') + '.' + ext;
  if (!useH264 && /\.mp4$/.test(outPath))
    console.log('\n!! No H.264 encoder available — falling back to VP8/WebM. Final file will be .webm.');

  const work = path.join(SCRATCH, 'compose');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  // ---- pass 1: trim + normalize -----------------------------------------
  const parts = [];
  manifest.forEach((m, i) => {
    if (!fs.existsSync(m.file)) throw new Error(`missing clip: ${m.file}`);
    const part = path.join(work, `part${String(i).padStart(2, '0')}.${ext}`);
    // Only the filters the resolved binary actually HAS. Playwright's build
    // ships scale+pad and nothing else; `-r` forces the frame rate without the
    // `fps` filter, and SAR is already 1:1 on Playwright recordings.
    const vf = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      ...(caps.fpsFilter ? [`fps=${fps}`] : []),
      ...(caps.setsarFilter ? ['setsar=1'] : []),
    ].join(',');
    const enc = useH264
      ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p']
      : ['-c:v', 'libvpx', '-b:v', '3M', '-pix_fmt', 'yuv420p'];
    // Cut point: prefer the black-plate anchor in the content; fall back to
    // the wall-clock ratio only when there is no plate (e.g. the card clips,
    // which have no boot head to cut and start at their own frame 0).
    const ts = timeScale(bin, m.file, m.closeMs);
    const predicted = (m.ssMs / 1000) * ts.ratio;
    const cut = m.noCutDetect ? null : findCut(bin, m.file, { nearSec: predicted });
    let ssSec;
    let durSec;
    if (cut !== null) {
      // The action runs from the fade to the end of the recorded action; its
      // LENGTH in video time still scales with the clip's stretch.
      ssSec = Math.max(0, cut - preRoll / 1000);
      durSec = (m.durMs / 1000) * ts.ratio;
      console.log(`  ${m.label}: cut found at ${cut.toFixed(2)}s (black-plate anchor), ${durSec.toFixed(2)}s`);
    } else {
      ssSec = (m.ssMs / 1000) * ts.ratio;
      durSec = (m.durMs / 1000) * ts.ratio;
      console.log(
        `  ${m.label}: no black anchor — wall-clock offsets ×${ts.ratio.toFixed(3)} (${ts.measured ? 'measured' : 'no closeMs'})`
      );
    }

    run(
      bin,
      [
        '-y',
        '-ss', ssSec.toFixed(3),
        '-t', durSec.toFixed(3),
        '-i', m.file,
        '-an',
        '-vf', vf,
        '-r', String(fps),
        ...enc,
        // MP4-only: an even timescale keeps concat from accumulating drift.
        // Playwright's build does not recognise the option at all.
        ...(useH264 ? ['-video_track_timescale', '90000'] : []),
        part,
      ],
      `trim ${m.label}`
    );
    parts.push(part);
    console.log(`  normalized ${m.label} → ${path.basename(part)} (${(fs.statSync(part).size / 1e6).toFixed(1)} MB)`);
  });

  // A single segment needs no join — this is the one multi-clip-free case the
  // Playwright build CAN finish on its own.
  if (parts.length === 1) {
    fs.mkdirSync(path.dirname(finalOut), { recursive: true });
    fs.copyFileSync(parts[0], finalOut);
    const b = fs.statSync(finalOut).size;
    console.log(`\n=== ${finalOut} ===\n  ${(b / 1e6).toFixed(1)} MB · single segment, no concat needed`);
    return;
  }

  if (!caps.canConcat) {
    console.error(
      `\nThis ffmpeg cannot JOIN segments: no concat demuxer and no concat filter.\n` +
        `  binary: ${bin}\n` +
        `  ${parts.length} normalized segments are in ${work}\n\n` +
        `Playwright's bundled ffmpeg is built with --disable-everything and cannot\n` +
        `concatenate by any route (its PNG decoder is absent too, so a frame-sequence\n` +
        `round trip is not available). Install a full build OUTSIDE the repo:\n\n` +
        `  cd <scratch> && npm i ffmpeg-static\n` +
        `  TRAILER_FFMPEG=<scratch>/node_modules/ffmpeg-static/ffmpeg node scripts/trailer/compose.js ...\n`
    );
    process.exit(3);
  }

  // ---- pass 2: concat ----------------------------------------------------
  const listFile = path.join(work, 'concat.txt');
  fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  fs.mkdirSync(path.dirname(finalOut), { recursive: true });
  const finalEnc = useH264
    ? ['-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    : ['-c:v', 'libvpx', '-b:v', '2.5M', '-pix_fmt', 'yuv420p'];
  run(bin, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-an', ...finalEnc, finalOut], 'concat');

  // Hero stills: each kept shot's `still.png` becomes a numbered marketing PNG.
  const stillsDir = arg('stills');
  if (stillsDir && raw) {
    fs.mkdirSync(stillsDir, { recursive: true });
    let n = 0;
    for (const name of fs.readdirSync(raw).sort()) {
      const j = path.join(raw, name, 'shot.json');
      if (!fs.existsSync(j)) continue;
      const s = JSON.parse(fs.readFileSync(j, 'utf8'));
      if (!s.kept || !s.still || !fs.existsSync(s.still)) continue;
      const dest = path.join(stillsDir, `${String(s.id).padStart(2, '0')}-${s.slug}.png`);
      fs.copyFileSync(s.still, dest);
      n++;
    }
    console.log(`\n  ${n} hero still(s) → ${stillsDir}`);
  }

  const bytes = fs.statSync(finalOut).size;
  const dur = probeDuration(bin, finalOut);
  console.log(`\n=== ${finalOut} ===`);
  console.log(`  ${(bytes / 1e6).toFixed(1)} MB · ${typeof dur === 'number' ? dur.toFixed(1) + 's' : 'duration unknown'} · ${useH264 ? 'H.264/MP4' : 'VP8/WebM'} · ${width}×${height} @ ${fps}fps`);
  if (bytes > 60e6) console.log('  !! over the 60 MB brief cap — raise CRF or shorten shots.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
