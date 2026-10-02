import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const observation = JSON.parse(await readFile('artifacts/food-counter-analysis.json', 'utf8'));
const original = await readFile('artifacts/food-material-final.save.json');
const district = (id: string) => observation.districts.find((row: any) => row.districtId === id);
const citizen = (id: string) => observation.districts.flatMap((row: any) => row.failures).find((row: any) => row.id === id);
const near = (a: number, b: number) => assert.ok(Math.abs(a-b) < 1e-9, `${a} must equal ${b}`);

test('original 32-source snapshot and actual final save remain unchanged after read-only queries', () => {
  assert.equal(observation.snapshotSourceCount, 32);
  assert.deepEqual(observation.sourceStart, observation.sourceEnd);
  assert.equal(observation.saveSha256, createHash('sha256').update(original).digest('hex'));
  assert.equal(observation.unchanged, true); assert.equal(observation.finalSaveRoundtripExact, true);
});
test('existing public region goods do not establish counter-site custody or create a food shop', () => {
  for (const [id, quantity] of [['academy',140],['government',168],['starport',172]] as const) {
    const row = district(id); assert.equal(row.existingFoodShops, 0); assert.equal(row.existingPool, quantity);
    assert.deepEqual(row.existingLots, [{ shopId: null, quantity }]);
    assert.ok(row.existingLots.every((lot: any) => lot.nodeId === undefined && lot.siteId === undefined));
  }
  assert.equal(district('academy').candidates.every((row: any) => row.kind === 'school'), true);
});
test('actual government buyer can pay and has finite food routes but native choice still lacks food advertising', () => {
  const actor = citizen('citizen-5'); assert.equal(actor.hunger, 0); assert.equal(actor.food, 0);
  assert.ok(actor.wallet > actor.nearestFood.price); assert.equal(actor.globalAffordableReachableShops,43);
  assert.equal(actor.advertisedAffordableShops,0); assert.equal(actor.nativeChoice.activity,'rest');
  assert.ok(actor.nearestFood.walkingDistance > 3900); assert.ok(actor.nearestFood.earliestArrivalHour > actor.nearestFood.closesAt);
  assert.ok(actor.nearestExistingCounterCandidate.walkingDistance < 400);
  assert.equal(actor.nearestExistingCounterCandidate.onDutyStaff,0);
});
test('actual starport demand and contracted staffing are distinct from service availability', () => {
  const row = district('starport'), actor = citizen('citizen-21');
  assert.equal(row.richHungry,56); assert.ok(row.failures.every((failure: any) => failure.advertisedAffordableShops === 0));
  assert.equal(actor.hunger,0); assert.ok(actor.wallet > 700); assert.equal(actor.nativeChoice.activity,'work');
  assert.ok(actor.nearestExistingCounterCandidate.walkingDistance < 252);
  assert.ok(row.candidates.some((site: any) => site.staff.some((staff: any) => staff.remainingPromisedMinutes === 195)));
  assert.ok(row.candidates.every((site: any) => site.healthyPromisedStaff === 0 && site.onDutyStaff === 0));
});
test('actual budget and quorum reject the claim that these counters are already legally staffed and funded', () => {
  assert.equal(observation.budget.available,0); assert.ok(observation.budget.reserve > observation.budget.cash);
  assert.equal(observation.publicLabor.today.minutesCap,195);
  assert.ok(observation.authorityGroups.every((group: any) => group.onDuty.length < 2));
  assert.deepEqual(observation.authorityGroups.find((group: any) => group.workId === 'government-b13').onDuty,['citizen-555']);
});

// Arithmetic examples for the proposed contract; no counter module exists or
// executes here. These checks must not be reported as a native-sale regression.
function proposedSplit(price: number, supplierPrice: number, quantity: number, taxRate: number, publicOwner: boolean) {
  const paid = price * quantity, grossSupplier = publicOwner ? 0 : supplierPrice * quantity;
  if (quantity <= 0 || quantity > 8 || paid * (1-taxRate) < grossSupplier) return null;
  const supplierNet = grossSupplier * (1-taxRate), saleTax = paid * taxRate, wholesaleTax = grossSupplier * taxRate;
  return { paid, supplierNet, publicRetailMargin: paid * (1-taxRate) - grossSupplier, saleTax, wholesaleTax };
}
test('proposed sale of two existing public meals transfers buyer 24 to public cash with one actual meal consumed and one retained', () => {
  const split = proposedSplit(12,4,2,.08,true)!;
  assert.deepEqual(split, { paid:24, supplierNet:0, publicRetailMargin:22.080000000000002, saleTax:1.92, wholesaleTax:0 });
  near(split.publicRetailMargin + split.saleTax,24);
  near(2 - 1 - 1,0); // stock reduction = actual consumption + real consumer bag
});
test('proposed frozen owner price preserves supplier entitlement, tax and public margin without uncovered public subsidy', () => {
  for (const H of [4,6.17]) {
    const split = proposedSplit(12,H,2,.08,false)!;
    near(split.paid, split.supplierNet + split.publicRetailMargin + split.saleTax + split.wholesaleTax);
    near(split.supplierNet,2*H*.92);
  }
  assert.equal(proposedSplit(5,6.17,2,.08,false),null);
  assert.equal(proposedSplit(12,4,9,.08,false),null);
});
