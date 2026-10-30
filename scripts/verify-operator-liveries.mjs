// Pure resolver/registry gate. Run: node scripts/verify-operator-liveries.mjs
import assert from 'node:assert/strict';
import { OPERATOR_LIVERIES, liveryForAircraft } from '../lib/fly/operator-liveries.mjs';

let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`PASS ${name}`);
}
const resolve = (flight, rest, palette) => liveryForAircraft({ flight, ...rest }, palette);
const id = (flight, rest, palette) => resolve(flight, rest, palette)?.id ?? null;

check('requested major airlines are individually identified', () => {
  assert.equal(id('DAL123'), 'delta');
  assert.equal(id('SWA42'), 'southwest');
  assert.equal(id('UAL17'), 'united');
  assert.equal(id('AAL9'), 'american');
  assert.notDeepEqual(resolve('DAL123').colors, resolve('SWA42').colors);
  assert.notDeepEqual(resolve('UAL17').colors, resolve('DAL123').colors);
});

check('padding, casing and alphanumeric flight suffixes', () => {
  assert.equal(id('  swa 123 \t'), 'southwest');
  assert.equal(id('ual\t4AB'), 'united');
  assert.equal(id('baw21A'), 'british-airways');
  assert.equal(id('UAL12345'), 'united');
  assert.equal(liveryForAircraft({ callsign: 'KLM123' })?.id, 'klm');
});

check('no partial, IATA, telephony, malformed or registration matches', () => {
  for (const value of [null, undefined, '', '   ', 123, {}, 'DAL', 'DALONE', 'DALX12',
    'SWAX123', 'S W A123', 'SWA-123', 'SWA123/ABC', 'SWA123456', 'SWA12 3',
    'SW123', 'WN123', 'SOUTHWEST123', 'UNITED123', 'N123UA', 'N123SWA', 'D-ALAB',
    'G-DALA', 'C-FUAL', 'VT-DAL', 'B-1234', 'UNKNOWN', 'XXX123']) {
    assert.equal(id(value), null, `unexpected livery for ${String(value)}`);
  }
  assert.equal(id('SWA123', { r: 'SWA-123' }), null);
  assert.equal(id('SWA123', { r: ' swa123 ' }), null);
  assert.equal(id('SWA123', { r: 'N8728Q' }), 'southwest');
  assert.equal(liveryForAircraft(null), null);
  assert.equal(liveryForAircraft(undefined), null);
});

check('regional and contractor callsigns do not invent parent liveries', () => {
  for (const prefix of ['SKW', 'RPA', 'ENY', 'JIA', 'PDT', 'EDV', 'CMB']) {
    assert.equal(id(`${prefix}123`), null, prefix);
  }
});

check('current flight metadata controls paint even on a reused track', () => {
  const meta = { hex: 'abc123', t: 'A320', r: 'N12345', flight: null };
  assert.equal(liveryForAircraft(meta), null);
  meta.flight = 'UAL12';
  assert.equal(liveryForAircraft(meta)?.id, 'united');
  meta.flight = 'DAL12';
  assert.equal(liveryForAircraft(meta)?.id, 'delta');
  meta.flight = '';
  assert.equal(liveryForAircraft(meta), null);
  meta.flight = 'ZZZ12';
  assert.equal(liveryForAircraft(meta), null);
});

check('specific military prefixes resolve service-level schemes', () => {
  for (const [prefix, expected] of [['RCH', 'us-air-force'], ['CNV', 'us-navy'],
    ['RRR', 'royal-air-force'], ['CFC', 'canadian-forces']]) {
    assert.equal(id(`${prefix}12`), expected);
    assert.equal(resolve(`${prefix}12`).kind, 'military');
  }
  for (const flight of ['RCH', 'RCHIEF1', 'RCH123456', 'REACH12', 'KING123', 'PAT12', 'SAM123']) {
    assert.equal(id(flight), null, flight);
  }
});

check('military metadata stays unmarked without reliable service evidence', () => {
  for (const meta of [{ iconType: 'military' }, { military: true }, { dbFlags: 1 }, { dbFlags: 3 }]) {
    assert.equal(id('UNKNOWN', meta), 'military-low-vis');
    assert.equal(id('DAL123', meta), 'military-low-vis');
    assert.equal(id('RRR123', meta), 'royal-air-force');
    const fallback = resolve('', meta);
    assert.equal(fallback.marking, '');
    assert.equal(fallback.code, '');
  }
  assert.equal(id('DAL123', {}, 'military'), 'military-low-vis');
  assert.equal(liveryForAircraft(null, 'military')?.id, 'military-low-vis');
  assert.equal(id('DAL123', { dbFlags: 2 }), 'delta');
  assert.equal(id('DAL123', { dbFlags: '1' }), 'delta');
  assert.equal(id('CMB123', { iconType: 'military' }), 'military-low-vis');
});

check('catalogue has stable distinct atlas indices and valid paint records', () => {
  assert.ok(OPERATOR_LIVERIES.length <= 63, 'shared atlas capacity');
  assert.ok(OPERATOR_LIVERIES.filter((livery) => livery.kind === 'airline').length >= 50);
  const ids = new Set(), prefixes = new Set();
  const tailTypes = new Set(['delta', 'southwest', 'united', 'stripes', 'roundel', 'text']);
  for (const [index, livery] of OPERATOR_LIVERIES.entries()) {
    assert.equal(livery.index, index);
    assert.ok(!ids.has(livery.id), `duplicate id ${livery.id}`);
    ids.add(livery.id);
    assert.ok(tailTypes.has(livery.tail), livery.id);
    assert.ok([0, 1, 2].includes(livery.bellyStyle), livery.id);
    assert.equal(typeof livery.cheat, 'boolean', livery.id);
    for (const slot of ['body', 'belly', 'fin', 'nacelle', 'wing', 'accent', 'radome', 'ink', 'tailInk']) {
      assert.match(livery.colors[slot], /^#[a-f0-9]{6}$/i, `${livery.id}/${slot}`);
    }
    for (const prefix of livery.prefixes) {
      assert.match(prefix, /^[A-Z]{3}$/);
      assert.ok(!prefixes.has(prefix), `duplicate prefix ${prefix}`);
      prefixes.add(prefix);
      assert.equal(resolve(`${prefix}123`), livery);
    }
    assert.ok(Object.isFrozen(livery));
    assert.ok(Object.isFrozen(livery.prefixes));
    assert.ok(Object.isFrozen(livery.colors));
  }
  assert.ok(Object.isFrozen(OPERATOR_LIVERIES));
});

console.log(`\n${checks}/${checks} operator livery checks passed; ${OPERATOR_LIVERIES.length} schemes.`);
