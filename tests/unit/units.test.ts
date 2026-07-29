import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRational, divideRational, ensureComparable, multiplyRational, normalizeQuantity, normalizedMinorPerBaseUnit, parseDecimalRational, rational } from '../../src/domain/units.ts';

test('rational quantities normalize exactly', () => {
  assert.deepEqual(rational(2, 4), { numerator: 1, denominator: 2 });
  assert.deepEqual(rational(0), { numerator: 0, denominator: 1 });
  assert.deepEqual(parseDecimalRational('1,5'), { numerator: 3, denominator: 2 });
  assert.deepEqual(parseDecimalRational('2'), { numerator: 2, denominator: 1 });
  assert.deepEqual(multiplyRational(rational(2, 3), rational(3, 4)), rational(1, 2));
  assert.deepEqual(divideRational(rational(1, 2), rational(3, 4)), rational(2, 3));
  assert.deepEqual(normalizeQuantity({ amount: rational(3, 2), unit: 'kg' }), { amount: rational(1500), unit: 'g' });
  assert.deepEqual(normalizeQuantity({ amount: rational(1), unit: 'l' }), { amount: rational(1000), unit: 'ml' });
  for (const unit of ['g','ml','unit','pack','roll','sheet','capsule','dose','wash','m'] as const) {
    assert.deepEqual(normalizeQuantity({ amount: rational(2), unit }), { amount: rational(2), unit });
  }
  assert.deepEqual(normalizedMinorPerBaseUnit(285, { amount: rational(3, 2), unit: 'kg' }), rational(19, 100));
  assert.equal(compareRational(rational(1, 2), rational(2, 4)), 0);
  assert.equal(compareRational(rational(1, 3), rational(1, 2)), -1);
  assert.equal(compareRational(rational(2, 3), rational(1, 2)), 1);
  assert.doesNotThrow(() => ensureComparable({ amount: rational(1), unit: 'kg' }, { amount: rational(500), unit: 'g' }));
});

test('unit operations reject invalid semantics and values', () => {
  for (const args of [[-1,1],[1,-1],[1,0],[1.2,1],[1,1.2]] as const) assert.throws(() => rational(args[0], args[1]), RangeError);
  for (const input of ['', '-1', 'a', '1.2.3']) assert.throws(() => parseDecimalRational(input), RangeError);
  assert.throws(() => divideRational(rational(1), rational(0)), RangeError);
  assert.throws(() => ensureComparable({ amount: rational(1), unit: 'kg' }, { amount: rational(1), unit: 'l' }), RangeError);
  assert.throws(() => normalizedMinorPerBaseUnit(-1, { amount: rational(1), unit: 'kg' }), RangeError);
  assert.throws(() => normalizedMinorPerBaseUnit(1.2, { amount: rational(1), unit: 'kg' }), RangeError);
  assert.throws(() => normalizedMinorPerBaseUnit(1, { amount: rational(0), unit: 'kg' }), RangeError);
});
