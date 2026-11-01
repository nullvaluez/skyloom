import assert from 'node:assert/strict';
import {
  FACADE_FILTER_GLSL, facadeCoverage, facadeMinify, facadeReliefResolved,
  facadePaneProfile, facadePaneSlope, facadeGlassSlope,
} from '../lib/fly/facade-filtering.js';

const close = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} vs ${b}`);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const frac = (x) => x - Math.floor(x);
const opening = [0.47, 0.58];
const pane = (cell, width) => {
  const raw = facadeCoverage(cell[0], opening[0], width[0]) * facadeCoverage(cell[1], opening[1], width[1]);
  const m = facadeMinify(Math.max(...width));
  return raw * (1 - m) + opening[0] * opening[1] * m;
};
const legacyPane = (cell, width) => {
  const raw = opening.map((duty, i) => 1 - smooth(duty * 0.5 - width[i], duty * 0.5 + width[i], Math.abs(frac(cell[i]) - 0.5))).reduce((a, b) => a * b, 1);
  const m = smooth(0.3, 1.4, Math.max(...width));
  return raw * (1 - m) + opening[0] * opening[1] * m;
};

// Independent midpoint integration of a binary opening catches wrap, negative
// coordinates and multi-cell intervals; it does not reproduce the helper math.
let integrationCases = 0;
for (const phase of [-13.21, -0.01, 0, 0.31, 0.5, 0.99, 123.72]) {
  for (const duty of [0.048, 0.36, 0.58, 0.91]) for (const width of [0.01, 0.13, 0.37, 0.7, 1, 2.6]) {
    let reference = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i++) {
      const x = frac(phase - width * 0.5 + width * (i + 0.5) / samples);
      reference += Math.abs(x - 0.5) < duty * 0.5 ? 1 : 0;
    }
    const coverage = facadeCoverage(phase, duty, width);
    close(coverage, reference / samples, 2 / samples, 'coverage vs sampled interval');
    close(coverage, facadeCoverage(phase - 53, duty, width), 2e-11, 'integer translation');
    integrationCases++;
  }
}

for (const duty of [0.048, 0.36, 0.58, 0.91]) {
  for (const width of [0.013, 0.2, 0.37, 0.75, 1, 2, 3.6]) {
    let sum = 0;
    const phases = 10000;
    for (let i = 0; i < phases; i++) sum += facadeCoverage((i + 0.5) / phases, duty, width);
    close(sum / phases, duty, 1e-9, 'phase-average preserves area');
  }
  for (let i = 0; i < 101; i++) {
    close(facadeCoverage(i / 101, duty, 1), duty, 1e-12, 'one-cell footprint has no phase wobble');
    close(facadeCoverage(i / 101, duty, 3), duty, 1e-12, 'three-cell footprint has no phase wobble');
  }
}

// Close facades retain opaque wall and fully open panes; the fix is not a
// full-screen blur. Only an unresolved periodic detail becomes its area mean.
close(pane([0.5, 0.5], [0.02, 0.03]), 1, 1e-12, 'resolved window centre');
close(pane([0.05, 0.05], [0.02, 0.03]), 0, 1e-12, 'resolved wall pier');
for (const width of [[0.5, 0.1], [0.1, 0.5], [0.8, 0.8], [1.4, 2.1]]) {
  for (let i = 0; i < 1000; i++) {
    close(pane([i * 0.037, i * 0.071], width), opening[0] * opening[1], 1e-12, 'unresolved motion phase is stable');
  }
}

// A moving pixel over a facade near/beyond Nyquist. The old shader keeps a
// substantial changing pattern here; measure temporal change rather than just
// comparing two stills. This is an analytical signal test, not a GPU fps claim.
const motion = (sample, width) => {
  const values = Array.from({ length: 600 }, (_, frame) => sample([frame * 0.037 + 0.17, frame * 0.071 + 0.29], width));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    rms: Math.sqrt(values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length),
    deltaRms: Math.sqrt(values.slice(1).reduce((sum, x, i) => sum + (x - values[i]) ** 2, 0) / (values.length - 1)),
  };
};
const rows = [0.4, 0.49, 0.5, 0.8, 1].map((width) => {
  const before = motion(legacyPane, [width, width * 0.8]), after = motion(pane, [width, width * 0.8]);
  assert.ok(after.deltaRms < before.deltaRms * 0.70, `motion residual reduced at ${width} cells/pixel`);
  if (width >= 0.5) assert.ok(after.rms < 1e-12, 'no sub-Nyquist pattern remains');
  return { width, before: before.deltaRms, after: after.deltaRms };
});

// Analytic slopes are checked against central differences of the physical
// height profile. Their footprint fade retires relief before cell minification.
const pitch = [3.1, 3.8], epsilon = 1e-6;
for (const cell of [[0.267, 0.5], [0.728, 0.5], [0.5, 0.212], [0.5, 0.789], [-0.733, 10.5], [0.269, 0.216], [0.5, 0.5]]) {
  const slope = facadePaneSlope(cell, opening, pitch);
  for (let axis = 0; axis < 2; axis++) {
    const left = [...cell], right = [...cell];
    left[axis] -= epsilon / pitch[axis]; right[axis] += epsilon / pitch[axis];
    close(slope[axis], (facadePaneProfile(right, opening) - facadePaneProfile(left, opening)) / (2 * epsilon), 2e-7, 'analytic pane slope');
  }
}
for (const footprint of [0.025, 0.05, 0.3, 0.5, 1, 20]) close(facadeReliefResolved(footprint), 0, 0, 'unresolved bevel relief is zero');
close(facadeReliefResolved(0.01), 1, 0, 'resolved relief retained');
for (const boundary of [-97, -1, 0, 1, 109]) {
  for (const offset of [-1e-7, 0, 1e-7]) for (const duties of [[0.048, 0.15], [0.47, 0.58], [0.91, 0.9]]) {
    for (const cell of [[boundary + offset, 0.5], [0.5, boundary + offset], [boundary + offset, boundary + offset]]) {
      const slope = facadePaneSlope(cell, duties, pitch);
      assert.ok(slope.every(Number.isFinite), 'pane slope finite at positive and negative cell seams');
      slope.forEach((x) => close(x, 0, 0, 'cell seam lies in flat wall, not a derivative spike'));
      assert.ok(facadeGlassSlope(cell, pitch, 255).every(Number.isFinite), 'broad glass slope finite at cell seams');
    }
  }
}
for (const seed of [0, 79, 255]) {
  const cell = [17.314, -3.157], slope = facadeGlassSlope(cell, pitch, seed);
  const height = (c) => Math.sin(c[0] * 1.31 + seed) * Math.sin(c[1] * 0.79 + seed * 0.37) * 0.035;
  for (let axis = 0; axis < 2; axis++) {
    const left = [...cell], right = [...cell];
    left[axis] -= epsilon / pitch[axis]; right[axis] += epsilon / pitch[axis];
    close(slope[axis], (height(right) - height(left)) / (2 * epsilon), 2e-9, 'analytic glass slope');
  }
}
assert.ok(!/\b(?:dFdx|dFdy|fwidth)\s*\(/.test(FACADE_FILTER_GLSL), 'filter helpers never take derivatives of filtered values');
console.log(`Facade filtering: ${integrationCases} interval cases; area, close-detail, motion and analytic-slope checks passed.`);
for (const row of rows) console.log(`  ${row.width.toFixed(2)} cells/px: frame-delta RMS ${row.before.toFixed(6)} → ${row.after.toFixed(6)}`);
