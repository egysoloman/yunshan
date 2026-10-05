import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { partitionSave, assembleSave } from '../src/persistence/partition.ts';
import type { Building, WorldDefinition } from '../src/types.ts';

function fixture(localBank = false): WorldDefinition {
  const district = { id: 'civic-street', name: '公共街坊', kind: 'government', center: { x: 0, y: 0, z: 0 }, radius: 1000, color: '#bba080', population: 384 };
  const kinds = ['home', 'hall', 'school', 'clinic', 'market', 'workshop', 'station', 'bank'] as const;
  const buildings: Building[] = kinds.map((kind, index) => ({ id: `civic-${kind}`, name: `街坊${kind}`, kind, districtId: district.id, position: { x: index * 70, y: 0, z: 0 }, door: { x: index * 70, y: 0, z: 6 }, width: 12, depth: 12, height: 12, floors: 2, rotation: 0, capacity: 128, seed: index }));
  // The closed-loop input keeps the existing bank within this neighbourhood.
  // Otherwise a five-job cycle coincides with the five initial education levels
  // and supplies no qualified hall official; do not manufacture credentials.
  if (localBank) { const bank = buildings.find(b => b.kind === 'bank')!; bank.position = { x: 275, y: 0, z: 50 }; bank.door = { x: 275, y: 0, z: 56 }; }
  const nodes = [0, 1].map(i => ({ id: `civic-node-${i}`, name: `街坊驿站${i}`, districtId: district.id, position: { x: i * 700, y: 0, z: 20 }, station: true }));
  return { seed: 718, voxelSize: .2, size: 2500, districts: [district], buildings, nodes, edges: [{ id: 'civic-road', mode: 'road', from: nodes[0].id, to: nodes[1].id, length: 700, capacity: 40, points: nodes.map(n => n.position) }], mountains: [], spawn: { ...buildings[0].door }, river: [], waterfall: { top: { x: 800, y: 60, z: 800 }, bottom: { x: 800, y: 0, z: 800 }, width: 10 } };
}
function create(topic: 'education' | 'health' = 'education', localBank = false) {
  const sim = new Simulation(fixture(localBank)), hall = sim.worldDefinition.buildings.find(b => b.kind === 'hall')!;
  // Controlled demand and attendance only: all wallet funds, public shifts,
  // fees, budgets, reply time, procurement and signatures remain native.
  for (const person of sim.state.citizens) person.education = Math.max(1, person.education ?? 0);
  const person = sim.state.citizens.find(c => c.money >= 110 && sim.state.extension!.actorProfiles[c.id].age >= 18)!;
  assert.ok(person);
  person.education = topic === 'education' ? 0 : 1;
  if (topic === 'health') sim.state.extension!.actorProfiles[person.id].health = 60;
  const observation = { healthAfterPeople: 0 };
  const pin = () => {
    observation.healthAfterPeople = sim.state.extension!.actorProfiles[person.id].health;
    person.position = { ...hall.door }; person.route = []; person.routeIndex = 0;
    person.destinationId = hall.id; person.needs = { hunger: 100, fatigue: 100, social: 80, fun: 60 };
    const r = Reflect.get(sim, 'runtime'); r.activities[person.id] = 'social'; r.decisionAt[person.id] = sim.state.extension!.lastUpdate + 60;
  };
  sim.onPhase('traffic', pin); sim.onPhase('people', () => { observation.healthAfterPeople = sim.state.extension!.actorProfiles[person.id].health; }); pin();
  return { sim, person, hall, observation };
}

test('an existing onsite adult independently pays a real10 filing fee and starts the original one-day procedure', () => {
  const { sim, person } = create(); sim.step(.25);
  const petition = sim.state.culture!.petitions.find(p => p.authorId === person.id);
  assert.ok(petition, 'native resident demand must not depend on a player command');
  assert.equal(petition.topic, 'education'); assert.equal(petition.status, 'open');
  assert.equal(petition.replyAt - petition.filedAt, 1440);
  const origin = petition.residentOrigin!;
  assert.equal(origin.feePaid, 10); assert.equal(origin.moneyBefore - origin.moneyAfter, 10); assert.ok(origin.moneyAfter >= 100);
  assert.ok(petition.signerIds.includes(person.id));
  assert.ok(sim.state.extension!.publicLedger.some(row => row.actorId === person.id && row.amount === 10 && row.purpose === '居民公共请愿备案费'));
  assert.equal(petition.executionId, null); assert.equal(sim.state.culture!.orders.length, 0, 'filing does not authorize money, materials or staff');
  assert.equal(person.education, 0, 'requesting education is not a free qualification');
});

test('actual personal health demand chooses medical service without adding a pathogen or instant treatment', () => {
  const { sim, person, observation } = create('health'); sim.step(.25);
  const petition = sim.state.culture!.petitions.find(p => p.authorId === person.id)!;
  assert.ok(petition); assert.equal(petition.topic, 'health'); assert.equal(petition.residentOrigin!.healthAtFiling, observation.healthAfterPeople);
  assert.equal(sim.state.pathology, undefined); assert.equal(sim.state.culture!.orders.length, 0);
});

for (const reason of ['absent', 'minor', 'no-demand', 'life-reserve'] as const) test(`resident filing refuses ${reason} without a fee or ghost agenda`, () => {
  const { sim, person, hall } = create();
  if (reason === 'absent') sim.onPhase('traffic', () => { person.position = { x: hall.position.x + 1000, y: 0, z: 0 }; });
  if (reason === 'minor') sim.state.extension!.actorProfiles[person.id].age = 17;
  if (reason === 'no-demand') person.education = 1;
  if (reason === 'life-reserve') person.money = 100;
  sim.step(.25);
  assert.equal(sim.state.culture!.petitions.some(p => p.authorId === person.id), false);
  assert.equal(sim.state.extension!.publicLedger.some(row => row.actorId === person.id && row.purpose === '居民公共请愿备案费'), false);
});

test('pending topic coalesces without repeated resident fees, survives partition and24 complete reader steps', () => {
  const { sim, person } = create(); sim.step(.25);
  const saved = sim.exportSave(), petition = sim.state.culture!.petitions[0]; assert.ok(petition);
  const reader = new Simulation(sim.worldDefinition); assert.equal(reader.importSave(saved).ok, true); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, sim.worldDefinition)), saved);
  // No fixture hook is used during continuation; both instances resume the
  // native saved journey and decision timers.
  const live = new Simulation(sim.worldDefinition); assert.equal(live.importSave(saved).ok, true);
  for (let tick = 0; tick < 24; tick++) { live.step(.25); reader.step(.25); assert.equal(reader.exportSave(), live.exportSave()); }
  assert.equal(reader.state.culture!.petitions.length, 1);
  assert.equal(reader.state.extension!.publicLedger.filter(row => row.actorId === person.id && row.purpose === '居民公共请愿备案费').length, 1);
});

test('altered resident fee, authority point and deadline are rejected atomically', () => {
  const { sim } = create(); sim.step(.25); const original = sim.exportSave();
  for (const mutate of [
    (p: any) => { p.residentOrigin.moneyAfter += 10; },
    (p: any) => { p.residentOrigin.ageAtFiling = 17; },
    (p: any) => { p.residentOrigin.position.y += 100; },
    (p: any) => { p.replyAt = p.filedAt; },
  ]) { const bad = JSON.parse(original); mutate(bad.state.culture.petitions[0]); assert.equal(sim.importSave(JSON.stringify(bad)).ok, false); assert.equal(sim.exportSave(), original); }
});

function autonomousService(withSigners = true) {
  const { sim, person, hall } = create('education', true);
  const school = sim.worldDefinition.buildings.find(b => b.kind === 'school')!;
  const officers = sim.state.citizens.filter(c => ['官员', '财政官', 'official', '议员', 'council'].includes(c.role) && c.workId === hall.id && (c.education ?? 0) >= 2 && sim.state.extension!.actorProfiles[c.id].age >= 18).slice(0, 2);
  const teachers = sim.state.citizens.filter(c => ['老师', 'teacher'].includes(c.role) && c.workId === school.id && (c.education ?? 0) >= 2 && sim.state.extension!.actorProfiles[c.id].age >= 18).slice(0, 2);
  assert.equal(officers.length, 2, 'the fixture uses two existing qualified hall officials');
  assert.equal(teachers.length, 2, 'the fixture uses two existing qualified school teachers');
  const excluded = new Set([...officers, ...teachers, person].map(c => c.id));
  const attendees = [person, ...sim.state.citizens.filter(c => !excluded.has(c.id) && sim.state.extension!.actorProfiles[c.id].age >= 18).slice(0, 5)];
  assert.equal(attendees.length, 6);
  assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  // This is a controlled on-site attendance test. Native identities, wallets,
  // wages, supply inventories, reply time, review and procurement are retained.
  sim.onPhase('traffic', () => {
    const active = sim.state.culture!.orders.some(o => o.topic === 'education' && o.state === 'active');
    const place = (c: typeof person, b: Building, activity: 'social' | 'work') => {
      c.position = { ...b.door }; c.route = []; c.routeIndex = 0; c.destinationId = b.id;
      c.needs = { hunger: 100, fatigue: 100, social: 80, fun: 50 };
      const runtime = Reflect.get(sim, 'runtime'); runtime.activities[c.id] = activity; runtime.decisionAt[c.id] = sim.state.extension!.lastUpdate + 60;
    };
    for (const c of officers) place(c, hall, 'work');
    for (const c of teachers) place(c, school, 'work');
    for (const c of attendees) if (c.id === person.id || withSigners) place(c, active ? school : hall, 'social');
    if (!withSigners) for (const c of sim.state.citizens) if (c.id !== person.id) {
      const home = sim.worldDefinition.buildings.find(b => b.id === c.homeId)!; place(c, home, 'social');
    }
  });
  return { sim, person, officers, teachers, attendees };
}

test('resident demand traverses the real day and joint review but missing materials cannot produce a qualification', () => {
  const { sim, person, officers, teachers } = autonomousService();
  sim.step(.25); const petition = sim.state.culture!.petitions.find(p => p.authorId === person.id)!; assert.ok(petition);
  assert.ok(petition.signerIds.length >= 3); assert.equal(petition.executionId, null);
  let ticks = 1;
  while (sim.state.extension!.lastUpdate < petition.replyAt - 1e-7) { sim.step(.25); ticks++; assert.ok(ticks <= 725); }
  assert.ok(ticks >= 720, 'the full one-day deadline advances through ordinary simulation steps');
  assert.equal(petition.status, 'answered');
  const order = sim.state.culture!.orders.find(o => o.id === petition.executionId)!; assert.ok(order);
  assert.equal(order.authorizedCap, 40); assert.deepEqual(order.approvedBy, officers.map(c => c.id));
  for (let i = 0; i < 40 && !order.servedIds.includes(person.id); i++) sim.step(.25);
  assert.equal(order.state, 'awaitingSupply', order.lastReason);
  assert.equal(order.servedIds.includes(person.id), false); assert.ok(order.receivedUnits < 1);
  assert.ok(Math.abs(order.receipts.reduce((n, receipt) => n + receipt.paid, 0) - order.spent) < 1e-7);
  assert.equal(order.consumedUnits, 0); assert.equal(order.serviceMinutes[person.id] ?? 0, 0);
  assert.equal(person.education, 0);
  assert.ok(teachers.every(c => (c.education ?? 0) >= 2));
  assert.ok(order.lastReason.includes('供应商'));
});

test('an unanswered solitary need receives a real reply without an authorized ghost service', () => {
  const { sim, person } = autonomousService(false); sim.step(.25);
  const petition = sim.state.culture!.petitions.find(p => p.authorId === person.id)!; assert.ok(petition);
  // Isolate the quorum boundary by locating every other hall occupant at
  // home before the first filing and throughout the reply interval.
  sim.onPhase('traffic', () => { for (const c of sim.state.citizens) if (c.id !== person.id) {
    const home = sim.worldDefinition.buildings.find(b => b.id === c.homeId)!; c.position = { ...home.door }; c.route = []; c.routeIndex = 0; c.destinationId = home.id;
  } });
  while (sim.state.extension!.lastUpdate < petition.replyAt - 1e-7) sim.step(.25);
  assert.equal(petition.status, 'answered');
  assert.ok(petition.signerIds.length < 3, `actual on-site signers: ${petition.signerIds.length}`);
  assert.equal(petition.executionId, null); assert.equal(sim.state.culture!.orders.length, 0); assert.equal(person.education, 0);
});

test('resident filing continues when the player has died', () => {
  const { sim, person } = create(); const life = sim.state.extension!.actorProfiles.player; life.alive = false; life.health = 0;
  sim.step(.25); assert.ok(sim.state.culture!.petitions.some(p => p.authorId === person.id));
  assert.equal(sim.state.extension!.actorProfiles.player.alive, false);
  assert.equal(sim.command({ type: 'filePetition', targetId: 'education', title: '观察者', text: '观察者不能替仍在城市中生活的居民直接办理正式请愿手续。' }).ok, false);
});
