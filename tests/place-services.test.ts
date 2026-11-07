import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeServicesSummary } from '../src/place-services';

test('a place seen from the street names its services in one line', () => {
  assert.equal(placeServicesSummary(['购餐，吃 1 份 · 11.67 云币', '购餐并带 1 份 · 23.35 云币', '开始 60 分钟现场工班', '商人考核 · 80 云币']), '这里可办理：购餐 · 购餐并带 1 份 · 开始 60 分钟现场工班 · 商人考核');
  assert.equal(placeServicesSummary(['租住 · 80 云币', '床旁休息 · 20 分钟']), '这里可办理：租住 · 床旁休息');
  assert.equal(placeServicesSummary(['a', 'b', 'c', 'd', 'e', 'a']), '这里可办理：a · b · c · d 等 5 项');
  assert.equal(placeServicesSummary([]), '这里可办理的事项');
});
