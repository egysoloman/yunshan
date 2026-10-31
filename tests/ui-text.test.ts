import assert from 'node:assert/strict';
import test from 'node:test';
import { displayMoney } from '../src/ui-text';

test('amounts counted in 文 read in 云币; other words with 文 are untouched', () => {
  assert.equal(displayMoney('已开始60分钟现场工班，35文工资由真实现金托管'), '已开始60分钟现场工班，35 云币工资由真实现金托管');
  assert.equal(displayMoney('支付12.5文。'), '支付12.5 云币。');
  assert.equal(displayMoney('文化节庆与3文件归档'), '文化节庆与3文件归档');
  assert.equal(displayMoney('花费11.9云币。'), '花费11.9云币。');
});
