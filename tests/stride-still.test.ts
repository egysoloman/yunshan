import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STRIDE_STILL_SECONDS, striding } from '../src/rendering/citizen-appearance';

test('a resident who stops moving stands instead of freezing mid-stride', () => {
  assert.equal(striding(true, 10, 10.2), true, 'moved a moment ago: still striding between simulation steps');
  assert.equal(striding(true, 10, 10 + STRIDE_STILL_SECONDS), false, 'standing after half a second without moving');
  assert.equal(striding(true, undefined, 10), false, 'never seen moving');
  assert.equal(striding(false, 10, 10), false, 'not in the moving state');
});
