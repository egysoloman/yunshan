import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT22_HYDRO_MAINTENANCE_PLAN, runHydroMaintenanceActual } from '../scripts/hydro-maintenance-actual';

test('ROOT22 native original engineers, finite materials/escrow, original 17:00 wages and whole/rawclone/physicalParts future24', { timeout: 12 * 60 * 1000 }, () => {
  const parent = mkdtempSync(join(tmpdir(), 'yunshan-hydro-maintenance-integration-'));
  const result = runHydroMaintenanceActual(join(parent, 'originals'));
  assert.equal(result.status, 'ACTUAL_COMPLETED');
  assert.equal(result.primaryOrdinaryWindows, 160);
  assert.equal(result.stepCalls, 232);
  assert.equal(result.maintenance.workedMinutes, 60);
  assert.equal(result.maintenance.completedAt, 1020);
  assert(result.maintenance.laborCompletedAt! < 1020);
  assert.equal(result.maintenance.payment!.amount, result.maintenance.payment!.requestedAmount);
  assert.equal(result.maintenance.consumedUnits, 1);
  assert.deepEqual(result.future24.branches, ['whole', 'rawclone', 'physicalParts']);
  assert.equal(result.commandsThatJumpClock, 0);
  assert.equal(result.directBodyMoneyNeedsStockIdentityEdits, 0);
  assert.equal(result.payerSitePlacementCount, 1);
  assert.equal(result.npcBodyPlacementCount, 0);
  assert.equal(result.originalNpcWageAmountOrPaydayChanges, 0);
  assert(result.physicalOriginalBytesBeforeResult < ROOT22_HYDRO_MAINTENANCE_PLAN.caps.physicalOriginalBytes);
});
