import assert from 'node:assert/strict';
import { BloomEffect, BlendFunction } from 'postprocessing';
import { MobileBloomEffect } from '../lib/fly/mobile-bloom.js';

const options = { blendFunction: BlendFunction.ADD, mipmapBlur: true, resolutionScale: 0.3, intensity: 0.7, luminanceThreshold: 0.85 };
const native = new BloomEffect(options);
const mobile = new MobileBloomEffect(options, { scale: 0.3, levels: 5 });
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
function activeTargets(effect) {
  return [...new Set([effect.luminancePass.renderTarget, ...effect.mipmapBlurPass.downsamplingMipmaps, ...effect.mipmapBlurPass.upsamplingMipmaps])];
}
function area(effect) { return activeTargets(effect).reduce((n, t) => n + t.width * t.height, 0); }

try {
  check('RED calibration: installed mipmap bloom ignores the old resolutionScale budget', () => {
    native.setSize(1170, 2532);
    assert.equal(native.renderTarget.width, 351);
    assert.equal(native.luminancePass.renderTarget.width, 1170);
    assert.equal(native.mipmapBlurPass.resolution.x, 1170);
    assert.equal(native.mipmapBlurPass.levels, 8);
  });
  check('preview sizes the targets that actually render and reduces bloom draws', () => {
    mobile.setSize(1170, 2532);
    assert.deepEqual([mobile.luminancePass.renderTarget.width, mobile.luminancePass.renderTarget.height], [351, 760]);
    assert.deepEqual(mobile.mipmapBlurPass.resolution.toArray(), [351, 760]);
    assert.equal(mobile.mipmapBlurPass.levels, 5);
    assert.equal(activeTargets(native).length, 16);
    assert.equal(activeTargets(mobile).length, 10);
    assert.ok(area(mobile) / area(native) < 0.1);
    console.log(`INFO active bloom target pixels: ${area(native)} -> ${area(mobile)} (${(100 * area(mobile) / area(native)).toFixed(2)}%)`);
  });
  check('repeated sizing retains scene bookkeeping and existing target objects', () => {
    const targets = activeTargets(mobile);
    for (let i = 0; i < 10; i++) mobile.setSize(1170, 2532);
    assert.equal(mobile.resolution.baseWidth, 1170);
    assert.equal(mobile.resolution.baseHeight, 2532);
    assert.equal(mobile.luminancePass.renderTarget.width, 351);
    assert.deepEqual(activeTargets(mobile), targets);
  });
  check('DPR changes, orientation changes and tiny viewports keep every target valid', () => {
    for (const [width, height] of [[390, 844], [844, 390], [585, 1266], [1, 1], [2, 3], [2532, 1170]]) {
      mobile.setSize(width, height);
      assert.equal(mobile.luminancePass.renderTarget.width, Math.max(1, Math.round(width * 0.3)));
      assert.equal(mobile.luminancePass.renderTarget.height, Math.max(1, Math.round(height * 0.3)));
      for (const target of activeTargets(mobile)) assert.ok(target.width >= 1 && target.height >= 1, `${target.texture.name}: ${target.width}x${target.height}`);
    }
  });
  check('source intensity, luminance threshold and blend behavior are preserved', () => {
    assert.equal(mobile.intensity, native.intensity);
    assert.equal(mobile.luminanceMaterial.threshold, native.luminanceMaterial.threshold);
    assert.equal(mobile.blendMode.blendFunction, native.blendMode.blendFunction);
    assert.equal(mobile.getFragmentShader(), native.getFragmentShader());
    mobile.intensity = 0.24;
    mobile.luminanceMaterial.threshold = 1.1;
    mobile.setSize(390, 844);
    assert.equal(mobile.intensity, 0.24);
    assert.equal(mobile.luminanceMaterial.threshold, 1.1);
  });
  check('a unity-scale control retains native target dimensions', () => {
    const control = new MobileBloomEffect(options, { scale: 1, levels: 8 });
    try {
      native.setSize(844, 390); control.setSize(844, 390);
      assert.deepEqual(activeTargets(control).map(t => [t.width, t.height]), activeTargets(native).map(t => [t.width, t.height]));
    } finally { control.dispose(); }
  });
} finally { native.dispose(); mobile.dispose(); }
console.log(`VERIFY: PASS (${checks} installed-library bloom checks; GPU timing belongs to the device)`);
