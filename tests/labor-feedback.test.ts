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

test('an open shift that pauses says why once per reason, and says so again when it resumes', async () => {
  const { freshLaborPause } = await import('../src/labor-feedback');
  const job = (status: string, pauseReason = '', workedMinutes = 23.6, id = 'labor-1') => ({ playerLabor: { job: { id, siteId: 'm', status, pauseReason, workedMinutes, requiredMinutes: 60 }, history: [] } }) as never;
  const name = () => '商肆4';
  let r = freshLaborPause(job('working'), null, name);
  assert.equal(r.notice, null, 'starting is announced by the command itself');
  r = freshLaborPause(job('paused', '离开原工作场所，工班暂停。'), r.seen, name);
  assert.equal(r.notice, '商肆4的工班暂停（已做 23/60 分钟）：离开原工作场所。');
  assert.equal(freshLaborPause(job('paused', '离开原工作场所，工班暂停。'), r.seen, name).notice, null, 'once per reason');
  r = freshLaborPause(job('paused', '乘车期间不能计入现场劳动。'), r.seen, name);
  assert.equal(r.notice, '商肆4的工班暂停（已做 23/60 分钟）：乘车期间不能计入现场劳动。');
  r = freshLaborPause(job('working', '', 23.9), r.seen, name);
  assert.equal(r.notice, '商肆4的工班继续，已做 23/60 分钟。');
  assert.equal(freshLaborPause(job('paused', '离开原工作场所，工班暂停。', 0, 'labor-2'), r.seen, name).notice, null, 'a different shift starts a new baseline');
  assert.deepEqual(freshLaborPause({ playerLabor: { job: null, history: [] } } as never, r.seen, name), { seen: { id: null, status: null, reason: '' }, notice: null });
});
