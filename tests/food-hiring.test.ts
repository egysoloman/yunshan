import assert from 'node:assert/strict';
import test from 'node:test';
import { tradeSignals } from '../src/simulation/trade';
import { call, cash, exact24, nativeApproval, runtime, saveObservation, setup, until } from './food-hiring-fixture';

test('food shortage names an accepted worker without wages, then real owner review, walking, production and sale close the loop', () => {
  const c = setup(), { sim, shop, applicant, owner, staff } = c, beforeCash = cash(sim), originalDebts = structuredClone(runtime(sim).wageArrears);
  assert.equal(tradeSignals(sim, shop.id).sold, 0); assert.equal(shop.customers, 0);
  nativeApproval(sim, shop);
  const plan = runtime(sim).privateLabor.shifts[shop.id]; assert.equal(plan.assignments.length, staff.length); assert.equal(plan.assignments[0].citizenId, owner.id);
  // A real review with zero vacancies records this original, unfunded worker.
  // It creates no wage and no funding proof; adding zero names is not a promise.
  const idle = staff.find(person => person.id !== owner.id)!;
  assert.equal(plan.assignments.find((row: any) => row.citizenId === idle.id).minutesCap, 0, 'original zero-cash review recorded the inactive name');
  const wages: unknown[] = [], paid: unknown[] = [], production: unknown[] = [], sales: unknown[] = [], approvals: unknown[] = []; let applicantLabor = 0;
  sim.onEvent('wage-earned', event => { if (event.citizenId === applicant.id) { wages.push(structuredClone(event)); applicantLabor += event.minutes ?? 0; } });
  sim.onEvent('production', event => { if (event.shopId === shop.id) { production.push({ ...structuredClone(event), applicantLaborMinutes: applicantLabor }); applicantLabor = 0; } });
  sim.onEvent('sale', event => { if (event.shopId === shop.id) { const trust = sim.state.relationships.find(r => r.npcId === event.citizenId)?.trust ?? 0; sales.push({ ...structuredClone(event), actualUnitPrice: shop.price * (trust > 55 ? .95 : 1) }); } });
  sim.onEvent('wage-paid', event => { if (event.citizenId === applicant.id) paid.push(structuredClone(event)); });
  sim.onEvent('private-shift-authorized', event => { if (event.shopId === shop.id) approvals.push(structuredClone(event)); });
  saveObservation(sim, 'loop-premise', { applicantId: applicant.id, idleId: idle.id, ownerId: owner.id, demand: c.buyers.map(person => person.id), contribution: beforeCash - c.initialCash });
  until(sim, () => applicant.workId === shop.buildingId, 8, 'zero-sales food employer must accept a real reachable qualified applicant');
  const assignment = plan.assignments.find((a: any) => a.citizenId === applicant.id);
  assert.ok(assignment); assert.equal(assignment.minutesCap, 0); assert.equal(assignment.workedMinutes, 0); assert.equal(wages.length, 0); assert.equal(plan.reviews.length, 1);
  assert.equal(applicant.role, c.originalRole); assert.equal(applicant.homeId, c.originalHomeId); assert.deepEqual(runtime(sim).wageArrears, originalDebts);
  assert.equal(runtime(sim).publicLabor.jobs[applicant.id], c.originalWorkId); assert.equal(shop.employees, 2, 'same-tick commerce must not shrink accepted staff against the old workforce cache');
  assert.ok(plan.assignments.indexOf(assignment) < plan.assignments.findIndex((a: any) => a.citizenId === idle.id), 'accepted name precedes old zero-cap inactive names');
  exact24(sim, 'accepted-zero');
  until(sim, () => assignment.minutesCap > 0, 60, 'only original onsite employer review may sign a positive funded cap');
  assert.ok(approvals.length > 0); assert.equal(assignment.workedMinutes, 0); assert.equal(wages.length, 0); assert.ok(Number(applicant.id.slice(8)) > Number(idle.id.slice(8)));
  saveObservation(sim, 'signed', { assignment, reviews: plan.reviews });
  const arrived = () => assignment.workedMinutes > 0;
  until(sim, arrived, 900, 'new worker must physically walk the original route and accrue genuine onsite labor');
  assert.ok(wages.length > 0); assert.equal(sim.isOnDuty(applicant.id, shop.buildingId), true);
  exact24(sim, 'first-attendance');
  until(sim, () => (production as any[]).some(event => event.applicantLaborMinutes > 0) && sales.length > 0, 900, 'finite new-worker attendance must enter real production and a real buyer must pay for food');
  const p = production as any[], s = sales as any[]; assert.ok(p.every(event => event.minutes > 0 && event.amount > 0)); assert.ok(p.some(event => event.applicantLaborMinutes > 0), 'actual new worker minutes enter the original production batch'); assert.ok(s.some(event => c.buyers.some(b => b.id === event.citizenId)));
  assert.ok(s.every(event => Math.abs(event.amount - event.quantity * event.actualUnitPrice) < 1e-8 && event.quantity > 0));
  assert.ok(Math.abs(cash(sim) - beforeCash) < 1e-6, 'wallets, original supplier accounts, actual wages and tax conserve every existing coin');
  const produced = p.reduce((n, event) => n + event.amount, 0), sold = s.reduce((n, event) => n + event.quantity, 0);
  assert.ok(Math.abs(shop.inventory - (90 + produced - sold)) < 1e-7, 'food stock has only original units, actual funded production and actual sales');
  saveObservation(sim, 'loop-complete', { applicantId: applicant.id, assignment, wages, production, sales, approvals });
  exact24(sim, 'sold-loop');
  assert.ok(sim.command({ type: 'speed', value: 8 }).ok);
  until(sim, () => paid.length > 0, 300, 'original end-of-shift payroll actually pays the new worker from the real employer');
  const earned = (wages as any[]).reduce((sum, row) => sum + row.amount, 0), paidGross = (paid as any[]).reduce((sum, row) => sum + row.amount, 0);
  assert.ok(paidGross > 0); assert.ok(Math.abs(earned - paidGross - runtime(sim).wageArrears.filter((row: any) => row.citizenId === applicant.id && row.shopId === shop.id).reduce((sum: number, row: any) => sum + row.amount, 0)) < 1e-7, 'actual earnings equal real payment plus preserved creditor claims');
  assert.ok(Math.abs(cash(sim) - beforeCash) < 1e-6); saveObservation(sim, 'actual-payroll', { applicantId: applicant.id, earned, paidGross, wages, paid, production, sales, approvals }); exact24(sim, 'paid-loop');
});

test('food hiring demand is read-only and rechecks food, cash and current position within the same people tick', () => {
  const { sim, shop, site, buyers } = setup(); const before = sim.exportSave();
  const names = call(sim, 'foodHiringDemandIds', shop, site) as string[];
  assert.equal(names.length, 92); assert.equal(sim.exportSave(), before, 'query changes no route, permit, money, intent or clock');
  const buyer = buyers[0]; buyer.food = 1; assert.ok(!(call(sim, 'foodHiringDemandIds', shop, site) as string[]).includes(buyer.id));
  buyer.food = 0; const wallet = buyer.money; buyer.money = shop.price - .01; assert.ok(!(call(sim, 'foodHiringDemandIds', shop, site) as string[]).includes(buyer.id)); buyer.money = wallet;
  const oldTravel = call(sim, 'foodHiringSaleDistance', buyer, site) as number; buyer.position = { x: 950, y: 20.6, z: 950 };
  const moved = call(sim, 'foodHiringDemandIds', shop, site) as string[]; assert.ok(moved.includes(buyer.id), 'a long but still timely actual walk is not rejected');
  const cached = Reflect.get(sim, 'foodHiringDemand').get(shop.id).find((row: any) => row.id === buyer.id); assert.ok(cached.travel > oldTravel, 'same-tick movement recomputes the actual route');
  assert.ok(sim.command({ type: 'setTime', value: 19.75 }).ok); assert.ok(!(call(sim, 'foodHiringDemandIds', shop, site) as string[]).includes(buyer.id), 'legal near-close display time leaves insufficient walking minutes');
});

test('food shortages do not bypass reserved wages, owner presence or the materials-only business', () => {
  const c = setup(), { sim, shop, applicant, owner } = c, salary = 32 * (.7 + sim.state.districts[0].prosperity / 100);
  const original = { ...owner.position }; owner.position = { ...sim.worldDefinition.spawn }; let before = sim.exportSave();
  assert.equal(call(sim, 'foodShortageHiringOffer', shop, applicant, salary), false); assert.equal(sim.exportSave(), before);
  owner.position = original; nativeApproval(sim, shop);
  // A genuine owner amendment allocates the remaining cash to original workers.
  const required = salary * c.staff.length + 20 * 8 / 24; const returned = sim.shopFunds(shop) - required;
  assert.ok(returned >= 0); sim.transferShopFunds(shop, -returned); owner.money += returned;
  shop.employees = c.staff.length; nativeApproval(sim, shop); before = sim.exportSave();
  assert.equal(call(sim, 'foodShortageHiringOffer', shop, applicant, salary), false); assert.equal(sim.exportSave(), before); assert.ok(sim.shopProtectedFunds(shop) > 0);
  const materials = sim.state.shops.find(s => s.buildingId === 'food-materials')!; before = sim.exportSave();
  assert.equal(call(sim, 'foodShortageHiringOffer', materials, applicant, salary), false); assert.equal(sim.exportSave(), before);
});

test('the original actual-sale offer still signs only through the owner review and saves its named acceptance', () => {
  const { sim, shop, site, applicant, buyers } = setup();
  for (const buyer of buyers) buyer.needs.hunger = 70; // Explicit no-shortage boundary, never used in the walking lifecycle.
  assert.equal(call(sim, 'foodShortageHiringOffer', shop, applicant, 44.16), false);
  const stock = shop.inventory, money = sim.state.player.money, total = cash(sim);
  const bought = sim.command({ type: 'purchase', targetId: site.id, value: 1 }); assert.ok(bought.ok, bought.message);
  assert.equal(shop.inventory, stock - 1); assert.equal(sim.state.player.money, money - shop.price); assert.ok(tradeSignals(sim, shop.id).sold > 0);
  until(sim, () => applicant.workId === site.id, 8, 'existing sold-demand branch stays usable');
  const plan = runtime(sim).privateLabor.shifts[shop.id], row = plan.assignments.find((a: any) => a.citizenId === applicant.id);
  assert.equal(row.minutesCap, 0); assert.equal(row.workedMinutes, 0); assert.equal(plan.reviews.length, 0);
  exact24(sim, 'sold-acceptance'); until(sim, () => row.minutesCap > 0, 60, 'actual onsite reviewer funds original-sale hire');
  assert.ok(plan.reviews.length > 0); assert.ok(Math.abs(cash(sim) - total) < 1e-6); exact24(sim, 'sold-funded');
});

test('original two-official review creates a real future promise which food hiring cannot borrow', () => {
  const { sim, shop, applicant } = setup(true), hall = sim.worldDefinition.buildings.find(b => b.kind === 'hall')!;
  const officials = sim.state.citizens.filter(c => c.workId === hall.id && c.role === '官员' && sim.state.extension!.actorProfiles[c.id].age >= 18).slice(0, 2);
  assert.equal(officials.length, 2, 'only existing generated legal officials, not supplied identities');
  const labor = runtime(sim).publicLabor; labor.standingUntilDay = 1;
  for (const official of officials) { labor.jobs[official.id] = hall.id; official.position = { ...hall.position, y: hall.position.y + .6, z: .5 }; }
  const initialCash = cash(sim); until(sim, () => labor.shifts.some((shift: any) => shift.day === 1), 260, 'original standing timetable allows the real next public review');
  assert.ok(Math.abs(cash(sim) - initialCash) < 1e-7); const before = cash(sim);
  const tomorrow = labor.shifts.find((shift: any) => shift.day === 1), row = tomorrow?.assignments.find((a: any) => a.citizenId === applicant.id);
  assert.ok(row?.minutesCap > 0); assert.equal(row.workedMinutes, 0); assert.equal(labor.shifts.some((shift: any) => shift.day === 0), false);
  const snapshot = sim.exportSave(); assert.equal(call(sim, 'foodHiringApplicantAvailable', applicant), false); assert.equal(sim.exportSave(), snapshot); assert.equal(cash(sim), before);
  assert.equal(call(sim, 'foodShortageHiringOffer', shop, applicant, 44.16), false);
  assert.ok(sim.command({ type: 'purchase', targetId: shop.buildingId, value: 1 }).ok); assert.ok(tradeSignals(sim, shop.id).sold > 0);
  const oldWork = applicant.workId; call(sim, 'considerPrivateOpportunity', applicant); assert.equal(applicant.workId, oldWork, 'even real positive sales cannot take a future public commitment'); exact24(sim, 'future-public-promise');
});

test('natural day rollover preserves genuine old staff, debt and public history when preparing a zero-cap private ledger', () => {
  const c = setup(true), { sim, applicant, originalWorkId } = c;
  const shop = sim.state.shops.find(row => row.buildingId === 'food-materials')!, site = sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!, owner = sim.state.citizens.find(person => person.id === sim.shopOwnerId(shop))!;
  const staff = sim.state.citizens.filter(person => person.workId === site.id && person.role !== '学生');
  // Existing materials business makes the generic roster boundary test possible
  // after food runs out. No food is added or hunger refilled to restore quorum.
  owner.position = { ...site.position, y: site.position.y + .6, z: .5 };
  const seed = sim.shopFunds(shop); sim.transferShopFunds(shop, -seed); owner.money += seed;
  nativeApproval(sim, shop); const idle = staff.find(person => person.id !== owner.id)!; shop.employees = 1;
  assert.ok(runtime(sim).privateLabor.shifts[shop.id].assignments.every((row: any) => row.minutesCap === 0));
  owner.money -= seed; sim.transferShopFunds(shop, seed);
  sim.setFocus({ ...site.door }, 'walk'); const total = cash(sim), stock = shop.inventory;
  const bought = sim.command({ type: 'purchase', targetId: site.id, value: 25 }); assert.ok(bought.ok, bought.message); assert.equal(shop.inventory, stock - 25);
  assert.ok(tradeSignals(sim, shop.id).sold > 0); nativeApproval(sim, shop);
  until(sim, () => applicant.workId === shop.buildingId, 8, 'actual positive-sale materials offer accepts original qualified worker');
  until(sim, () => runtime(sim).privateLabor.shifts[shop.id].assignments.find((row: any) => row.citizenId === applicant.id)?.minutesCap > 0, 60, 'first named worker gets actual owner review');
  const prior = structuredClone(runtime(sim).privateLabor.shifts[shop.id]); assert.ok(prior.assignments.find((row: any) => row.citizenId === applicant.id).minutesCap > 0);
  assert.equal(prior.assignments.find((row: any) => row.citizenId === idle.id).minutesCap, 0);
  assert.ok(sim.command({ type: 'speed', value: 8 }).ok);
  until(sim, () => sim.state.extension!.lastUpdate >= 1440, 600, 'natural monotonic next day, not setTime');
  assert.equal(Math.floor(sim.state.extension!.lastUpdate / 1440), 1);
  const labor = runtime(sim).publicLabor;
  assert.equal(labor.jobs[applicant.id], originalWorkId);
  assert.ok(labor.shifts.length > 0, 'original officers actually authorized current/next public shifts during day zero');
  assert.ok(labor.shifts.every((shift: any) => !shift.assignments.some((row: any) => row.citizenId === applicant.id)), 'new public promises exclude actual private worker while keeping historical job registry');
  const oldPlan = runtime(sim).privateLabor.shifts[shop.id]; assert.equal(oldPlan.day, 0);
  assert.ok(oldPlan.assignments.some((row: any) => row.citizenId === applicant.id));
  const expectedNames = (call(sim, 'privateRoster', shop, oldPlan) as typeof staff).map(person => person.id);
  const history = structuredClone(labor.shifts), debt = structuredClone(runtime(sim).wageArrears), claims = structuredClone(runtime(sim).wageAccruals);
  // This narrow bookkeeping boundary calls the same helper used after a real
  // offer is accepted. It is not another hire or an autonomous recovery claim.
  const beforeCash = cash(sim), claimsBefore = structuredClone(runtime(sim).wageAccruals);
  const plan = call(sim, 'preparePrivateAcceptance', shop, 1); assert.equal(plan.day, 1); assert.equal(plan.reviews.length, 0);
  assert.ok(plan.assignments.some((row: any) => row.citizenId === owner.id)); assert.ok(plan.assignments.some((row: any) => row.citizenId === applicant.id), 'previous real named worker remains ahead of inactive old workforce slots');
  assert.ok(expectedNames.every(id => plan.assignments.some((row: any) => row.citizenId === id)));
  assert.ok(plan.assignments.every((row: any) => row.minutesCap === 0 && row.workedMinutes === 0));
  assert.deepEqual(labor.shifts, history); assert.deepEqual(runtime(sim).wageArrears, debt); assert.deepEqual(runtime(sim).wageAccruals, claimsBefore); assert.equal(cash(sim), beforeCash); assert.ok(Math.abs(cash(sim) - total) < 1e-6);
  assert.equal(applicant.role, c.originalRole); assert.equal(applicant.homeId, c.originalHomeId);
  saveObservation(sim, 'next-day-zero-cap-ledger', { prior, plan, oldClaims: claims, originalDebts: debt, idleId: idle.id }); exact24(sim, 'next-day');
});

test('a home-reachable food vacancy still rejects an isolated current position and a work arrival after closing', () => {
  const { sim, shop, site, applicant } = setup(), salary = 32 * (.7 + sim.state.districts[0].prosperity / 100);
  const before = sim.exportSave(), original = { ...applicant.position }; const route = call(sim, 'foodHiringWorkDistance', applicant, site);
  assert.ok(Number.isFinite(route)); assert.equal(sim.exportSave(), before, 'work ETA is a read-only route query');
  // A disconnected node is declared before another Simulation is constructed.
  const world = structuredClone(sim.worldDefinition); world.nodes.push({ id: 'food-isolated', name: '原声明孤立站', districtId: 'food-district', station: false, position: { x: 900, y: 20.6, z: 900 } });
  const isolated = new (sim.constructor as typeof import('../src/simulation').Simulation)(world), target = isolated.state.citizens.find(c => c.id === applicant.id)!;
  const otherShop = isolated.state.shops.find(s => s.buildingId === shop.buildingId)!; target.position = { ...world.nodes.at(-1)!.position }; target.route = []; target.routeIndex = 0;
  assert.ok(isolated.buildingTravelDistance(target.homeId, otherShop.buildingId) <= 500); const saved = isolated.exportSave();
  assert.equal(call(isolated, 'foodHiringWorkDistance', target, site), Infinity); assert.equal(isolated.exportSave(), saved);
  assert.ok(sim.command({ type: 'setTime', value: 16.9 }).ok); applicant.position = original;
  assert.equal(call(sim, 'foodShortageHiringOffer', shop, applicant, salary), false, 'near closing is not a funded shift before a real arrival');
});

test('cached food demand notices the real same-phase hunger decay of an initially ineligible resident', () => {
  const { sim, shop, site, owner } = setup(), buyer = sim.state.citizens.find(person => person.id === 'citizen-202')!;
  assert.equal(buyer.food ?? 0, 0); assert.ok(buyer.money >= shop.price); assert.ok(sim.state.extension!.actorProfiles[buyer.id].alive);
  buyer.needs.hunger = 55.01; // One controlled threshold premise; ordinary people decay below 55, never a refill or forced route.
  nativeApproval(sim, shop); let firstTick = -1, verified = false;
  sim.onEvent('wage-earned', event => {
    if (event.citizenId === owner.id && buyer.needs.hunger >= 55) {
      firstTick = sim.state.tick; assert.ok(!(call(sim, 'foodHiringDemandIds', shop, site) as string[]).includes(buyer.id));
    }
  });
  sim.onPhase('people', () => {
    if (sim.state.tick === firstTick && buyer.needs.hunger < 55) {
      saveObservation(sim, 'same-phase-hunger-decay', { buyerId: buyer.id, hunger: buyer.needs.hunger, firstTick });
      assert.ok((call(sim, 'foodHiringDemandIds', shop, site) as string[]).includes(buyer.id), 'the resident crossed the hunger threshold through original elapsed needs decay in this same people phase'); verified = true;
    }
  });
  until(sim, () => verified, 8, 'actual same-phase cache transition observed');
});

test('a demand cache first built before food or wallet eligibility later recognizes the same original person', () => {
  const { sim, shop, site, buyers } = setup(), buyer = buyers[0], second = buyers[1], wallet = second.money;
  buyer.food = 1; second.money = shop.price - .01;
  const initial = call(sim, 'foodHiringDemandIds', shop, site) as string[]; assert.ok(!initial.includes(buyer.id)); assert.ok(!initial.includes(second.id));
  buyer.food = 0; second.money = wallet; const before = sim.exportSave();
  const current = call(sim, 'foodHiringDemandIds', shop, site) as string[];
  assert.ok(current.includes(buyer.id)); assert.ok(current.includes(second.id)); assert.equal(sim.exportSave(), before, 'boundary queries change no cash or physical body');
});
