import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { budgetDescriptorSha256, legacyAuthorizationDescriptor, type LegacyBudgetAuthorization } from '../src/simulation/budget-authority.ts';

test('browser-compatible immutable authorization SHA256 matches independent Node UTF8 oracle at padding and multi-block boundaries', () => {
  for (const text of ['', 'abc', '云山真正已批准的旧授权', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(1000)]) {
    assert.equal(budgetDescriptorSha256(text), createHash('sha256').update(text, 'utf8').digest('hex'));
  }
});
test('old authorization boundary retains cap, approval and signer provenance while legitimate expenditure and closure remain mutable', () => {
  const original: LegacyBudgetAuthorization = { id: 'service-1-supplement-1', siteId: 'school-1', purpose: 'civic-education-supplement', cap: 160, approvedAt: 600,
    approvedBy: ['citizen-1','citizen-2'], spent: 0, closedAt: null, signatures: [1,2].map(i => ({ actorId: `citizen-${i}`, role: 'council', siteId: 'hall-1', signedAt: 600 })) };
  const originalDigest = budgetDescriptorSha256(legacyAuthorizationDescriptor(original));
  assert.equal(budgetDescriptorSha256(legacyAuthorizationDescriptor({ ...original, spent: 80, closedAt: 800 })), originalDigest);
  for (const mutate of [
    (b: LegacyBudgetAuthorization) => { b.cap++; },
    (b: LegacyBudgetAuthorization) => { b.approvedAt++; },
    (b: LegacyBudgetAuthorization) => { b.purpose = 'civic-health-supplement'; },
    (b: LegacyBudgetAuthorization) => { b.siteId = 'school-2'; },
    (b: LegacyBudgetAuthorization) => { b.approvedBy.reverse(); },
    (b: LegacyBudgetAuthorization) => { b.signatures[0].actorId = 'citizen-3'; },
    (b: LegacyBudgetAuthorization) => { b.signatures[0].role = 'official'; },
    (b: LegacyBudgetAuthorization) => { b.signatures[0].siteId = 'hall-2'; },
    (b: LegacyBudgetAuthorization) => { b.signatures[0].signedAt++; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.notEqual(budgetDescriptorSha256(legacyAuthorizationDescriptor(changed)), originalDigest);
  }
});
