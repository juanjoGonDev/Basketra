import test from 'node:test';
import assert from 'node:assert/strict';
import { addMoney, formatMoney, money, multiplyMoney, parseEuroMinor, subtractMoney } from '../../src/domain/money.ts';

test('money validates and calculates exact minor units', () => {
  assert.deepEqual(money(199), { currency: 'EUR', minor: 199 });
  assert.deepEqual(parseEuroMinor('1,99 €'), money(199));
  assert.deepEqual(parseEuroMinor('2'), money(200));
  assert.deepEqual(parseEuroMinor('2.5'), money(250));
  assert.deepEqual(addMoney(money(100), money(25), money(0)), money(125));
  assert.deepEqual(subtractMoney(money(200), money(50)), money(150));
  assert.deepEqual(multiplyMoney(money(125), 3), money(375));
  assert.match(formatMoney(money(199)), /1,99/);
});

test('money rejects unsafe, negative and malformed input', () => {
  for (const value of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => money(value), RangeError);
  for (const value of ['', 'abc', '1.999', '-1', '1,2,3']) assert.throws(() => parseEuroMinor(value), RangeError);
  assert.throws(() => subtractMoney(money(1), money(2)), RangeError);
  for (const quantity of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => multiplyMoney(money(1), quantity), RangeError);
});
