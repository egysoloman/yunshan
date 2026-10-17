import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mealFeedback } from '../src/meal-feedback';

test('a purchase or meal message tells what the body actually gained', () => {
  assert.equal(mealFeedback('purchase', { hunger: 40, food: 0 }, { hunger: 92, food: 0 }), '饱腹 40 → 92。');
  assert.equal(mealFeedback('purchase', { hunger: 40, food: 0 }, { hunger: 92, food: 1 }), '饱腹 40 → 92，随身食物 +1（共 1 份）。');
  assert.equal(mealFeedback('eat', { hunger: 30, food: 2 }, { hunger: 70, food: 1 }), '饱腹 30 → 70，随身食物剩 1 份。');
  assert.equal(mealFeedback('purchase', { hunger: 50, food: 0 }, { hunger: 50, food: 0 }), '', 'materials change no body need');
  assert.equal(mealFeedback('rent', { hunger: 40, food: 0 }, { hunger: 92, food: 0 }), '');
});
