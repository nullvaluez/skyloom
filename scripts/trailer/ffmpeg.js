/**
 * ffmpeg resolution.
 *
 * There is NO system ffmpeg in the capture container. Two candidates exist,
 * with very different capabilities:
 *
 *   1. ffmpeg-static (PREFERRED) — a full GPL build (7.0.2 as measured:
 *      libx264, libvpx, xfade, concat, drawtext). Installed OUTSIDE the repo
 *      (`npm i ffmpeg-static` in a scratch dir) so the certified tree gains no
 *      dependency. Gives a real H.264 MP4.
 *   2. Playwright's bundled ffmpeg at
 *      `/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux` — built with
 *      `--disable-everything` plus a short allowlist. MEASURED capability:
 *        filters   crop, format, hflip, null, pad, scale, transpose, trim,
 *                  vflip  — and NOTHING else (no `fps`, no `setsar`, no
 *                  `concat`)
 *        demuxers  image2pipe, matroska/webm  — NO `concat` demuxer
 *        encoders  png, libvpx (VP8)  — no libx264; the png DECODER is absent
 *                  so a PNG-sequence round trip is not available either
 *      Consequence: **it cannot join two clips together by any route.** It can
 *      trim/scale/pad a SINGLE clip into a WebM, and that is all. A
 *      multi-segment trailer therefore REQUIRES ffmpeg-static; the trailer
 *      brief's "fallback: Playwright ffmpeg → VP8 WebM" is not achievable for
 *      more than one segment, and compose.js says so rather than emitting a
 *      truncated file.
 *
 * Resolution order: $TRAILER_FFMPEG → a resolvable `ffmpeg-static` → known
 * scratch install → Playwright's. Capabilities are PROBED (encoders, filters,
 * demuxers), never assumed from the path.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');

const SCRATCH_FFMPEG =
  '/tmp/claude-0/-home-user-skyloom/a2c8c929-63cc-5f77-b20e-356e7d2abdf2/scratchpad/ffm/node_modules/ffmpeg-static/ffmpeg';
const PW_FFMPEG = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';

function tryResolveStatic() {
  try {
    // Only if the caller's NODE_PATH happens to expose it.
    return require('ffmpeg-static');
  } catch {
    return null;
  }
}

function ask(bin, what) {
  try {
    return execFileSync(bin, ['-hide_banner', what], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function resolveFfmpeg() {
  const candidates = [process.env.TRAILER_FFMPEG, tryResolveStatic(), SCRATCH_FFMPEG, PW_FFMPEG].filter(Boolean);
  for (const bin of candidates) {
    if (!fs.existsSync(bin)) continue;
    const enc = ask(bin, '-encoders');
    const filters = ask(bin, '-filters');
    const demuxers = ask(bin, '-demuxers');
    const caps = {
      h264: /libx264/.test(enc),
      vp8: /libvpx\b/.test(enc),
      vp9: /libvpx-vp9/.test(enc),
      // Joining segments needs EITHER the concat demuxer or the concat filter.
      // Playwright's build has neither — probe, never assume.
      concatDemuxer: /^\s*D\s+concat\b/m.test(demuxers),
      concatFilter: /^\s*\S*\s+concat\s/m.test(filters),
      fpsFilter: /^\s*\S*\s+fps\s/m.test(filters),
      setsarFilter: /^\s*\S*\s+setsar\s/m.test(filters),
      xfade: /^\s*\S*\s+xfade\s/m.test(filters),
    };
    caps.canConcat = caps.concatDemuxer || caps.concatFilter;
    return { bin, caps, probed: !!enc };
  }
  throw new Error(
    'no ffmpeg found. Install one outside the repo:\n' +
      '  cd <scratch> && npm i ffmpeg-static\n' +
      'then re-run, or set TRAILER_FFMPEG=/path/to/ffmpeg'
  );
}

module.exports = { resolveFfmpeg, SCRATCH_FFMPEG, PW_FFMPEG };
