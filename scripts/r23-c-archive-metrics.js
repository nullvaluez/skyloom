/**
 * ROUND 23 (C "NIGHT-CERT") — ARCHIVE CALIBRATION.
 *
 * WHY THIS FILE EXISTS. verify-night-alive's absolute floors were supposed to be
 * frozen off a live RED run on base `f009263`. That run happened
 * (`scripts/r23-c-red-baseline.txt`) and produced numbers that mean NOTHING
 * about the product, because this session's egress policy denies CONNECT to the
 * two hosts the world is made of:
 *
 *   server.arcgisonline.com:443   403  (Esri World_Imagery + Terrain3D DEM)
 *   tiles.openfreemap.org:443     403  (every building, road, parcel, landuse)
 *
 * — confirmed at `http://127.0.0.1:38989/__agentproxy/status`, 3 085 off-origin
 * console errors in one run, and visible in `r23-c-red-man-pinned-high.png`: a
 * featureless grey field with POI letters and city-glow domes floating over it.
 * Freezing a floor off THAT frame would freeze a network condition.
 *
 * So the absolute floors are derived HERE instead, from the fleet's own
 * ARCHIVED, CERTIFIED night frames — captured in rounds 16/19/20 on machines
 * that could reach both hosts, at (in the P-MAN case) the identical pose. This
 * is a weaker calibration than a live one and is labelled as such everywhere it
 * lands; the procedure to replace it is one line in the verify-night-alive
 * header. What it is NOT is a guess.
 *
 * HONESTY ABOUT THE SOURCE FRAMES (each row prints its own caveat):
 *   • The R16 Manhattan frames are raw `glShot`s: the HUD, the minimap, the POI
 *     letters and the player jet are composited in. The x-crop removes the
 *     minimap and the right rail; the letters and the plane are NOT removable
 *     and are called out per row. They INFLATE lit/white and DEFLATE warm-share
 *     (grey aircraft, white text), so a floor set under them is conservative in
 *     the direction that matters.
 *   • The R19 Powell frames and the R20 Melton frames were shot with the
 *     player and the traffic pools parked (verify-groundlife's
 *     `setForegroundVisible(false)`), so they are close to what
 *     verify-night-alive shoots — but their DOM was not hidden.
 *   • None of them can tell us anything about the R22 world. They are the R16
 *     /R19/R20 read. That is precisely the point: they are the read the user
 *     says they have lost.
 *
 * Run: node scripts/r23-c-archive-metrics.js  (pure node, no browser)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { metricsOf, fmtMetrics } = require('./_night-metrics');

/**
 * ⚠️ THE SOURCE FRAMES ARE MUTABLE, AND THIS ROUND WATCHED THEM MUTATE.
 *
 * Every browser harness in the fleet writes its screenshots to FIXED filenames
 * under `scripts/`. Running `verify-sat-night` during this round therefore
 * OVERWROTE `r16-satnight-01..05` — the exact archived certified frames these
 * thresholds are derived from — with blank grey blockade frames, and a
 * re-derivation afterwards silently produced numbers from a world with no
 * tiles. Caught by `git status`, not by anything in the tooling.
 *
 * So the derivation now pins the first 16 hex of each source frame's SHA-256.
 * A mismatch is FATAL: a calibration that silently re-derives itself off
 * whatever happens to be on disk is worse than no calibration. Recovery is
 * `git checkout -- scripts/<frame>.png`.
 */
const FRAME_SHA16 = {
  'r16-satnight-01-manhattan-night.png': '2627e7b4a4881989',
  'r16-satnight-02-manhattan-night-after-ab.png': '380c5ff401b1cea3',
  'r16-satnight-07-jfk-night.png': '04e0f11967fb199b',
  'r16-satnight-08-cruise-glow.png': 'ce6de48c6793dc32',
  'r19-c-powell-night-houselights.png': '940ae1e09391d836',
  'r19-c-powell-night-down.png': '4c682270d4c5a981',
  'r19-c-night-on.png': '6df621daf8fdd12f',
  'r19-c-night-off.png': '5adac5b34b183593',
  'r20-b-melton-au-night-on.png': 'ef06556e8287a090',
  'r20-b-melton-au-night-off.png': '7ad91a1c2d316c69',
};
const sha16 = (p) =>
  crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);

/* Each row: the frame, the pose it stands for, the band verify-night-alive uses
 * for that pose, and what is wrong with the frame. */
const FRAMES = [
  {
    f: 'r16-satnight-01-manhattan-night.png',
    pose: 'P-MAN',
    round: 'R16',
    band: [0.55, 0.98],
    xBand: [0.02, 0.85],
    note: 'the R16 CERTIFIED read at the exact verify-sat-night Manhattan pose; HUD text, POI letters and the player jet are in frame',
  },
  {
    f: 'r16-satnight-02-manhattan-night-after-ab.png',
    pose: 'P-MAN',
    round: 'R16',
    band: [0.55, 0.98],
    xBand: [0.02, 0.85],
    note: 'same pose, post-A/B (a second sample of the same certified state)',
  },
  {
    f: 'r16-satnight-07-jfk-night.png',
    pose: 'JFK',
    round: 'R16',
    band: [0.55, 0.98],
    xBand: [0.02, 0.85],
    note: 'airfield night — sparse point lights, the case a mean is blind to',
  },
  {
    f: 'r16-satnight-08-cruise-glow.png',
    pose: 'CRUISE',
    round: 'R16',
    band: [0.55, 0.98],
    xBand: [0.02, 0.85],
    note: 'SatCityGlow at 6 km — the far-city read with the road ring disarmed',
  },
  {
    f: 'r19-c-powell-night-houselights.png',
    pose: 'P-POW',
    round: 'R19',
    band: [0.45, 1.0],
    xBand: [0.02, 0.98],
    note: 'Powell suburban night at a flying attitude; player+traffic PARKED, DOM not hidden',
  },
  {
    f: 'r19-c-powell-night-down.png',
    pose: 'P-POW-down',
    round: 'R19',
    band: [0.2, 0.95],
    xBand: [0.16, 0.84],
    note: 'the R19 measurement crop looking straight down at the subdivision (band ~ verify-groundlife CROP 260,430,1080,400)',
  },
  {
    f: 'r19-c-night-on.png',
    pose: 'P-POW-down',
    round: 'R19',
    band: [0.2, 0.95],
    xBand: [0.16, 0.84],
    note: 'R19 A/B, night sources ON  (its own litFrac over the CROP was 1.156%)',
  },
  {
    f: 'r19-c-night-off.png',
    pose: 'P-POW-down',
    round: 'R19',
    band: [0.2, 0.95],
    xBand: [0.16, 0.84],
    note: 'R19 A/B, night sources OFF (its own litFrac over the CROP was 0.465%) — THE CONTRAST THAT DEFINES A USEFUL WARM FLOOR',
  },
  {
    f: 'r20-b-melton-au-night-on.png',
    pose: 'P-MEL',
    round: 'R20',
    band: [0.45, 1.0],
    xBand: [0.02, 0.98],
    note: 'Melton AU parcel homes at night, ON',
  },
  {
    f: 'r20-b-melton-au-night-off.png',
    pose: 'P-MEL',
    round: 'R20',
    band: [0.45, 1.0],
    xBand: [0.02, 0.98],
    note: 'Melton AU parcel homes at night, OFF',
  },
  {
    f: 'r23-c-red-man-pinned-high.png',
    pose: 'P-MAN',
    round: 'R23-BLOCKED',
    band: [0.55, 0.98],
    xBand: [0.02, 0.85],
    note: 'TODAY, egress-blocked: no imagery, no vector content. Here so the blockade signature is on the record next to a real frame. VOLATILE BY DESIGN and deliberately NOT hash-pinned — verify-night-alive rewrites this file every run, which is exactly the mutable-filename hazard documented above, self-inflicted and harmless because nothing is derived from it.',
  },
  {
    f: 'r23-c-red-man-unpinned-live.png',
    pose: 'P-MAN',
    round: 'R23-BLOCKED',
    band: [0.55, 0.98],
    xBand: [0.02, 0.85],
    note: 'TODAY, egress-blocked, un-pinned leg',
  },
];

(async () => {
  const rows = [];
  const tampered = [];
  for (const r of FRAMES) {
    const p = path.join(__dirname, r.f);
    if (!fs.existsSync(p)) {
      console.log(`MISSING ${r.f}`);
      continue;
    }
    const want = FRAME_SHA16[r.f];
    if (want) {
      const got = sha16(p);
      if (got !== want) {
        console.log(`TAMPERED ${r.f} — sha16 ${got}, expected ${want}`);
        tampered.push(r.f);
        continue;
      }
    }
    const m = await metricsOf(p, { groundBand: r.band, xBand: r.xBand });
    rows.push({ ...r, m: { ...m, hist: undefined } });
    console.log(fmtMetrics(`${r.round.padEnd(12)} ${r.pose.padEnd(11)} ${r.f.padEnd(44)}`, m));
    console.log(`             ↳ ${r.note}`);
  }
  fs.writeFileSync(
    path.join(__dirname, 'r23-c-archive-metrics.json'),
    JSON.stringify(rows, null, 2)
  );

  // ── the derivation, printed so the ledger can quote it ──────────────────
  const by = (pose, round) => rows.filter((r) => r.pose === pose && r.round === round).map((r) => r.m);
  const man = by('P-MAN', 'R16');
  const pow = by('P-POW', 'R19');
  const powOn = rows.find((r) => r.f === 'r19-c-night-on.png')?.m;
  const powOff = rows.find((r) => r.f === 'r19-c-night-off.png')?.m;
  const blocked = by('P-MAN', 'R23-BLOCKED');
  const min = (a, k) => Math.min(...a.map((x) => x[k]));
  console.log('\n=== DERIVATION (all floors are HALF the weakest certified sample) ===');
  if (man.length) {
    console.log(
      `P-MAN certified litFrac min ${(min(man, 'litFrac') * 100).toFixed(3)}% ` +
        `warm-of-lit min ${(min(man, 'warmLitFrac') * 100).toFixed(1)}% ` +
        `p95 min ${Math.min(...man.map((x) => x.p95))} ` +
        `→ floors lit ${((min(man, 'litFrac') / 2) * 100).toFixed(2)}% warm ${((min(man, 'warmLitFrac') / 2) * 100).toFixed(0)}% p95 ${Math.floor(Math.min(...man.map((x) => x.p95)) / 2)}`
    );
    if (blocked.length)
      console.log(
        `  …vs TODAY (egress-blocked, NOT a product number): lit ${(blocked[0].litFrac * 100).toFixed(3)}% warm ${(blocked[0].warmLitFrac * 100).toFixed(1)}%`
      );
  }
  if (pow.length)
    console.log(
      `P-POW certified litFrac ${(min(pow, 'litFrac') * 100).toFixed(3)}% warm-of-lit ${(min(pow, 'warmLitFrac') * 100).toFixed(1)}% ` +
        `→ floors lit ${((min(pow, 'litFrac') / 2) * 100).toFixed(2)}% warm ${((min(pow, 'warmLitFrac') / 2) * 100).toFixed(0)}%`
    );
  if (powOn && powOff)
    console.log(
      `R19 A/B separation at Powell-down: lit ${(powOn.litFrac * 100).toFixed(3)}% ON vs ${(powOff.litFrac * 100).toFixed(3)}% OFF (${(powOn.litFrac / powOff.litFrac).toFixed(2)}x) · ` +
        `warm-of-lit ${(powOn.warmLitFrac * 100).toFixed(1)}% vs ${(powOff.warmLitFrac * 100).toFixed(1)}% (${(powOn.warmLitFrac / Math.max(1e-9, powOff.warmLitFrac)).toFixed(1)}x) ` +
        `— the WARM metric separates the two states ${(powOn.warmLitFrac / Math.max(1e-9, powOff.warmLitFrac) / (powOn.litFrac / powOff.litFrac)).toFixed(1)}x better than litFrac alone`
    );
  console.log('\nwritten: scripts/r23-c-archive-metrics.json');
  if (tampered.length) {
    console.error(
      `\nFATAL — ${tampered.length} calibration source frame(s) no longer match their pinned ` +
        `hash: ${tampered.join(', ')}. A harness has overwritten the archive (every browser ` +
        `harness writes fixed filenames under scripts/). Recover with:\n` +
        `  git checkout -- ${tampered.map((f) => 'scripts/' + f).join(' ')}\n` +
        `The numbers printed above are INCOMPLETE and must not be used to move a threshold.`
    );
    process.exit(1);
  }
})();
