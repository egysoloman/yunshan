import assert from 'node:assert/strict';
import { test } from 'node:test';
import { laborSettlementNotice } from '../src/labor-feedback';

test('a finished shift tells the time worked, the net pay, the gross and the tax', () => {
  const job = { status: 'completed' as const, workedMinutes: 60, requiredMinutes: 60, paidNet: 32.2, paidGross: 35, paidTax: 2.8, refundedGross: 0 };
  assert.equal(laborSettlementNotice(job, '商肆4'), '商肆4的工班完成：60 分钟，实得 32.2 云币（税前 35.0 云币，缴税 2.8 云币）。');
  assert.equal(laborSettlementNotice({ ...job, status: 'cancelled', workedMinutes: 20, paidNet: 10.7, paidGross: 11.7, paidTax: .9, refundedGross: 23.3 }, '商肆4'),
    '商肆4的工班已结束：做了 20/60 分钟，实得 10.7 云币（税前 11.7 云币，缴税 0.9 云币）；未做部分 23.3 云币 退回雇主。');
});

test('a settled shift is announced once, only when it just ended; a loaded history is not news', async () => {
  const { freshLaborSettlement } = await import('../src/labor-feedback');
  const job = { siteId: 'm', status: 'completed', workedMinutes: 60, requiredMinutes: 60, paidNet: 32.2, paidGross: 35, paidTax: 2.8, refundedGross: 0, endedAt: 549 };
  const state = (history: unknown[], minute: number) => ({ day: Math.floor(minute / 1440), hour: (minute % 1440) / 60, playerLabor: { history } }) as never;
  assert.deepEqual(freshLaborSettlement(state([job], 550), null, () => '商肆'), { seen: 1, notice: null }, 'first sight sets the baseline');
  assert.equal(freshLaborSettlement(state([job], 550), 0, () => '商肆').notice, '商肆的工班完成：60 分钟，实得 32.2 云币（税前 35.0 云币，缴税 2.8 云币）。');
  assert.equal(freshLaborSettlement(state([job], 600), 0, () => '商肆').notice, null, 'ended 51 minutes ago');
  assert.equal(freshLaborSettlement(state([job], 550), 1, () => '商肆').notice, null, 'already announced');
});
