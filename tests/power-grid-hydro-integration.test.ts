import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHydroActual } from '../scripts/power-grid-hydro-actual';

// All gameplay receipts come from the ordinary ten-phase native Simulation.
// The initial trusted other-city assets and one doorway setFocus are disclosed
// in the fixture/PLAN. No natural primary-city or completed-medical claim.
test('declared finite hydro drives native paid food production, local medical/transport guards and actual whole/all-part future24 with exact events', () => {
  const parent = mkdtempSync(join(tmpdir(), 'yunshan-hydro-integration-'));
  const result = runHydroActual(join(parent, 'originals'));
  assert.equal(result.status, 'ACTUAL_COMPLETED');
  assert(result.business.fed.actualCounts.positivePlayerWageCount > 0);
  assert(result.business.fed.actualCounts.farmProduced > 0);
  assert.equal(result.business.depleted.actualCounts.farmProduced, 0);
  assert.equal(result.commandsThatJumpClock, 0);
  assert.deepEqual(result.future24.branches, ['whole', 'rawclone', 'parts']);
});
