import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);
const { InputController } = await import('../lib/fly/input-controller.js');
const { loadExplorerPreferences, setExplorerPreferences, explorerPreferences, PREFERENCES_KEY } = await import('../lib/fly/explorer-preferences.mjs');

function setup() {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  loadExplorerPreferences(storage);
  globalThis.window = new EventTarget();
  const canvas = new EventTarget();
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 600 });
  const captured = new Set();
  canvas.setPointerCapture = id => captured.add(id);
  canvas.hasPointerCapture = id => captured.has(id);
  canvas.releasePointerCapture = id => captured.delete(id);
  const input = new InputController();
  input.attach(canvas);
  const fire = (target, type, props = {}) => {
    const e = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(props)) Object.defineProperty(e, key, { value });
    target.dispatchEvent(e);
    return e;
  };
  const key = (key, props = {}) => fire(window, 'keydown', { key, ...props });
  const move = (x = 1100, y = 300, props = {}) => fire(canvas, 'pointermove', { pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, movementX: 20, movementY: 10, ...props });
  const down = (props = {}) => fire(canvas, 'pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 640, clientY: 300, ...props });
  return { input, storage, fire, key, move, down, canvas };
}

test('keyboard steering takes over from a parked mouse until the pointer moves again', () => {
  const t = setup();
  try {
    t.move(); assert.ok(t.input.read().turn > 0);
    t.key('ArrowLeft'); assert.equal(t.input.read().turn, -1);
    t.fire(window, 'keyup', { key: 'ArrowLeft' }); assert.equal(t.input.read().turn, 0);
    t.move(); assert.ok(t.input.read().turn > 0);
  } finally { t.input.detach(); }
});

test('laptop keyboard preference persists, ignores trackpad steering, and keeps touch controls', () => {
  const t = setup();
  try {
    setExplorerPreferences({ steeringInput: 'keyboard' }, t.storage);
    assert.equal(JSON.parse(t.storage.getItem(PREFERENCES_KEY)).settings.steeringInput, 'keyboard');
    loadExplorerPreferences(t.storage); assert.equal(explorerPreferences().steeringInput, 'keyboard');
    t.move(); assert.equal(t.input.read().turn, 0);
    t.key('ArrowRight'); assert.equal(t.input.read().turn, 1);
    t.fire(window, 'keyup', { key: 'ArrowRight' });
    t.input.setTouchSteer(.5, 0); assert.ok(t.input.read().turn > 0);
    t.input.clearTouchSteer();
    setExplorerPreferences({ steeringInput: 'corrupt' }, t.storage);
    assert.equal(explorerPreferences().steeringInput, 'mouse');
  } finally { t.input.detach(); }
});

test('keyboard mode offers a primary-button trackpad drag, ending cleanly after capture loss', () => {
  const t = setup();
  try {
    setExplorerPreferences({ steeringInput: 'keyboard' }, t.storage);
    t.down(); t.move(700, 330);
    assert.equal(t.input.read().freeLook.active, true);
    assert.ok(t.input.read().freeLook.dx > 0);
    assert.equal(t.input.read().turn, 0);
    t.fire(t.canvas, 'lostpointercapture', { pointerId: 1 });
    assert.equal(t.input.read().freeLook.active, false);
    assert.equal(t.input.read().freeLook.dx, 0);
    t.down({ pointerId: 2 }); t.move(740, 350, { pointerId: 2 });
    assert.equal(t.input.read().freeLook.active, true);
    t.fire(window, 'pointerup', { pointerId: 2, button: 0 });
    assert.equal(t.input.read().freeLook.active, false);
  } finally { t.input.detach(); }
});

test('right-button look and photo drag remain available in the default mouse scheme', () => {
  const t = setup();
  try {
    t.down({ button: 2 }); t.move(); assert.ok(t.input.read().freeLook.dx > 0);
    t.fire(window, 'pointerup', { pointerId: 1, button: 2 });
    assert.equal(t.input.read().freeLook.active, false);
    t.input.setPhotoLook(true); t.down(); t.move(700, 350);
    assert.equal(t.input.read().freeLook.active, true);
    t.input.neutralize(); assert.ok(t.input.read().freeLook.dx > 0);
    t.fire(window, 'blur');
    assert.equal(t.input.read().freeLook.active, false);
    assert.equal(t.input.read().freeLook.dx, 0);
    t.down(); t.move(710, 330); assert.equal(t.input.read().freeLook.active, true);
  } finally { t.input.detach(); }
});

test('native controls and browser shortcuts do not steer or queue gameplay actions', () => {
  const t = setup();
  try {
    for (const target of [{ tagName: 'SELECT' }, { tagName: 'BUTTON' }, { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { isContentEditable: true }]) {
      t.key('ArrowLeft', { target }); assert.equal(t.input.read().turn, 0);
      t.key('m', { target }); assert.equal(t.input.consumePress('m'), false);
    }
    for (const props of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      t.key('w', props); assert.equal(t.input.read().pitch, 0);
      t.key('l', props); assert.equal(t.input.consumePress('l'), false);
    }
    const arrow = t.key('ArrowDown'); assert.equal(arrow.defaultPrevented, true);
    t.fire(window, 'keyup', { key: 'ArrowDown' });
    assert.equal(t.key('Tab').defaultPrevented, false);
  } finally { t.input.detach(); }
});

test('focus loss releases steering, boosts, brake, queued presses and captured look', () => {
  const t = setup();
  try {
    t.move(); t.key('w'); t.input.setBoost(true); t.input.setBrake(true); t.key('p'); t.down({ button: 2 });
    t.fire(window, 'blur');
    const c = t.input.read();
    assert.equal(c.turn, 0); assert.equal(c.pitch, 0); assert.equal(c.boost, false); assert.equal(c.brake, 0);
    assert.equal(c.freeLook.active, false); assert.equal(t.input.consumePress('p'), false);
    t.move(); assert.ok(t.input.read().turn > 0);
  } finally { t.input.detach(); }
});
