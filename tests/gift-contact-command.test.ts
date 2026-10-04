/** Candidate regression suite, NOT_RUN when authored on 2026-10-04.
 * Every command below calls the actual Simulation.command implementation.
 * World bytes are an existing saved descriptor; no world/fixture factory runs.
 * Position assignments are CONTROLLED test inputs on checked original support
 * points. They do not demonstrate natural arrival, a natural gift or a consumer.
 * No food, needs, wallet, identity, ACL, relationship or runtime clock is granted.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { canAccessFloor } from '../src/access.ts';
import { blocksFloorPlanReferenceMovement, floorPlanSupport, getBuildingFloorPlan, wallPanels } from '../src/architecture-floor-plan.ts';
import { getWalkHeight } from '../src/world.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { giftContactReason } from '../src/simulation/gift-contact.ts';
import { legacyGiftDoorPresence } from '../src/simulation/gift-contact-legacy.ts';
import type { SimulationOptions } from '../src/simulation/city-ruleset.ts';
import type { Building, Citizen, Command, Role, Vec3, WorldDefinition } from '../src/types.ts';

const WORLD_SHA256 = '78a9b469fb18e4f377151fd679045fdb25b9160d456f25ba8a0027b2b15a0bbe';
const OLD_SAVE_SHA256 = '3640274b3e2234b793925a574f825615a89d9c168539d10960510f39f1e1c2c3';
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const publicPlayerPoint: Vec3 = { x: 72, y: .6, z: -18 };
const publicNpcPoint: Vec3 = { x: 73, y: .6, z: -18 };
const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');

function readOriginalWorld(): WorldDefinition {
  const bytes = readFileSync(new URL('./fixtures/civic-history/root13-four-day.world.json', import.meta.url));
  assert.equal(hash(bytes), WORLD_SHA256, 'retain the original descriptor without changing geometry or ACL');
  return JSON.parse(bytes.toString('utf8')) as WorldDefinition;
}

function supportAt(site: Building, floor: number, point: Vec3, kind: 'room' | 'courtyard') {
  const support = floorPlanSupport(site, floor, point, .35);
  assert.ok(support, 'the complete original .35-radius body has actual support');
  assert.equal(support.floor, floor);
  assert.equal(support.kind, kind);
  assert.ok(Math.abs(support.y - point.y) < 1e-8);
  assert.equal(blocksFloorPlanReferenceMovement(site, floor, point, point, .35, 1.72), false,
    'the stationary original full body does not penetrate walls or furniture');
}

function controlledPublicPositions(sim: Simulation, hall: Building, citizen: Citizen, target = publicNpcPoint) {
  // CONTROLLED positions, not a claim that either actor arrived naturally.
  supportAt(hall, 0, publicPlayerPoint, 'room');
  supportAt(hall, 0, target, 'room');
  assert.equal(canAccessFloor(hall, 0, sim.state.player), true);
  assert.equal(blocksFloorPlanReferenceMovement(hall, 0, publicPlayerPoint, target, .35, 1.72), false);
  sim.state.player.position = { ...publicPlayerPoint };
  citizen.position = { ...target };
}

function fixture(carryFood = 1) {
  const world = readOriginalWorld(), originalWorld = JSON.stringify(world), sim = new Simulation(world);
  assert.equal(JSON.stringify(world), originalWorld, 'constructor cannot rewrite the saved world descriptor');
  assert.equal(sim.state.player.role, 'traveler');
  assert.deepEqual(sim.state.player.identities, ['traveler']);
  assert.equal(sim.state.player.money, 600);
  assert.deepEqual({ ...sim.state.player.inventory }, { block: 32 });
  assert.equal(sim.state.relationships.length, 0);
  const hall = world.buildings.find(site => site.id === 'civic-0-hall');
  const market = world.buildings.find(site => site.id === 'civic-0-market');
  assert.ok(hall && market);
  const citizen = sim.state.citizens.find(actor => sim.state.extension!.actorProfiles[actor.id].alive
    && Number.isFinite(actor.needs.hunger) && actor.needs.hunger <= 80);
  assert.ok(citizen, 'choose an actual original resident whose unmodified hunger admits the original +20');

  if (carryFood > 0) {
    // CONTROLLED original door point, independently checked against the saved
    // road node and original walking surface before the real purchase command.
    assert.ok(world.nodes.some(node => node.id === `${market.id}-door` && distance(node.position, market.door) === 0));
    assert.equal(getWalkHeight(world, market.door.x, market.door.z, market.door.y), market.door.y);
    assert.equal(canAccessFloor(market, 0, sim.state.player), true);
    sim.state.player.position = { ...market.door };
    const shop = sim.state.shops.find(item => item.buildingId === market.id);
    assert.ok(shop);
    const beforeCash = sim.state.player.money, beforeStock = shop.inventory, price = shop.price;
    const purchased = sim.command({ type: 'purchase', targetId: market.id, value: carryFood + 1 });
    assert.equal(purchased.ok, true, purchased.message);
    assert.equal(sim.state.player.inventory.food, carryFood, 'purchase eats one and carries only the paid remainder');
    assert.equal(sim.state.player.money, beforeCash - price * (carryFood + 1));
    assert.equal(shop.inventory, beforeStock - carryFood - 1);
  }
  controlledPublicPositions(sim, hall, citizen);
  return { world, sim, hall, citizen };
}

function rejectAtomically(sim: Simulation, command: Command, message?: RegExp) {
  const beforeSave = sim.exportSave(), beforeState = structuredClone(sim.state), beforeRuntime = structuredClone(runtime(sim));
  const beforeRelationships = structuredClone(sim.state.relationships);
  const result = sim.command(command);
  assert.equal(result.ok, false, result.message);
  if (message) assert.match(result.message, message);
  assert.deepEqual(sim.state, beforeState, 'rejection leaves the complete authoritative state unchanged');
  assert.deepEqual(runtime(sim), beforeRuntime, 'rejection leaves every runtime field and clock unchanged');
  assert.deepEqual(sim.state.relationships, beforeRelationships, 'rejection cannot create or initialise a relationship');
  assert.equal(sim.exportSave(), beforeSave, 'rejection retains exact complete save bytes');
  assert.deepEqual(sim.state, beforeState);
  assert.deepEqual(runtime(sim), beforeRuntime);
  return result;
}

function future24Exact(source: Simulation, world: WorldDefinition, options?: SimulationOptions) {
  const saved = source.exportSave(), assembled = assembleSave(partitionSave(saved, world));
  assert.equal(assembled, saved, 'partition transport keeps the exact writer bytes and original schema');
  const full = new Simulation(world, options), partition = new Simulation(world, options);
  for (const [reader, bytes] of [[full, saved], [partition, assembled]] as const) {
    const loaded = reader.importSave(bytes);
    assert.equal(loaded.ok, true, loaded.message);
    assert.equal(reader.exportSave(), saved, 'full and partition readers preserve the exact original opening');
  }
  const initialTick = source.state.tick;
  assert.equal(source.state.paused, false);
  // Future execution only: original .25-second steps, original saved speed,
  // no clock edits, no accelerations, no injected events or actor/need changes.
  for (let index = 0; index < 24; index++) {
    source.step(.25); full.step(.25); partition.step(.25);
    assert.equal(source.state.tick, initialTick + index + 1);
    assert.equal(full.exportSave(), source.exportSave(), `complete reader future original tick ${index + 1}`);
    assert.equal(partition.exportSave(), source.exportSave(), `partition reader future original tick ${index + 1}`);
  }
}

test('controlled actual gift consumes one purchased food and retains original +20, relationship and identity feedback', () => {
  const { world, sim, citizen } = fixture();
  const beforePlayer = structuredClone(sim.state.player), beforeCitizen = structuredClone(citizen);
  const beforeProfiles = structuredClone(sim.state.extension!.actorProfiles);
  const beforeClock = runtime(sim).relationshipClock;
  assert.equal(distance(sim.state.player.position, citizen.position), 1);
  const result = sim.command({ type: 'gift', targetId: citizen.id });
  assert.equal(result.ok, true, result.message);
  assert.equal(sim.state.player.inventory.food, beforePlayer.inventory.food! - 1);
  assert.equal(citizen.needs.hunger, beforeCitizen.needs.hunger + 20);
  assert.deepEqual(citizen, { ...beforeCitizen, needs: { ...beforeCitizen.needs, hunger: beforeCitizen.needs.hunger + 20 } },
    'only original resident hunger changes; identity and every other resident field remain intact');
  assert.deepEqual(sim.state.player, { ...beforePlayer, reputation: beforePlayer.reputation + .5,
    inventory: { ...beforePlayer.inventory, food: beforePlayer.inventory.food! - 1 } },
  'only the one paid food and original reputation feedback change in the complete player');
  assert.deepEqual(sim.state.extension!.actorProfiles, beforeProfiles, 'no life profile or identity is granted');
  assert.deepEqual(sim.state.player.needs, beforePlayer.needs);
  assert.equal(sim.state.player.money, beforePlayer.money);
  assert.equal(sim.state.player.reputation, beforePlayer.reputation + .5);
  assert.equal(sim.state.player.role, beforePlayer.role);
  assert.deepEqual(sim.state.player.identities, beforePlayer.identities);
  assert.equal(sim.state.player.partnerId, beforePlayer.partnerId);
  assert.equal(sim.state.relationships.length, 1);
  const relation = sim.state.relationships[0];
  assert.equal(relation.npcId, citizen.id);
  assert.equal(relation.affection, 12); assert.equal(relation.trust, 8); assert.equal(relation.encounters, 1);
  assert.equal(relation.type, 'acquaintance');
  assert.deepEqual(relation.memories, [{ tick: sim.state.tick, text: '赠送食物', impact: 12 }]);
  assert.equal(runtime(sim).relationshipAt[citizen.id], beforeClock);
  assert.equal(runtime(sim).relationshipClock, beforeClock);
  assert.equal(sim.state.events.at(-1)?.type, 'gift');
  assert.ok(Number.isFinite(sim.state.player.inventory.food) && Number.isFinite(citizen.needs.hunger));
  future24Exact(sim, world);
});

test('controlled actual gift rejects the original same-floor 1.6m opaque wall atomically before creating a relation', () => {
  const { sim, hall, citizen } = fixture();
  const from = { x: 119.3, y: .6, z: 9 }, to = { x: 119.3, y: .6, z: 10.6 };
  supportAt(hall, 0, from, 'room'); supportAt(hall, 0, to, 'courtyard');
  assert.equal(canAccessFloor(hall, 0, sim.state.player), true);
  const plan = getBuildingFloorPlan(hall, 0); assert.ok(plan);
  assert.ok(wallPanels(plan).some(panel => panel.kind === 'solid' && panel.rect.x0 === 21.6
    && panel.rect.x1 === 25 && panel.rect.z0 === 9.6 && panel.rect.z1 === 10 && panel.top === 2.8));
  assert.ok(Math.abs(distance(from, to) - 1.6) < 1e-8);
  assert.equal(blocksFloorPlanReferenceMovement(hall, 0, from, to, .35, 1.72), true);
  // CONTROLLED supported room/courtyard positions; no natural encounter claim.
  sim.state.player.position = from; citizen.position = to;
  rejectAtomically(sim, { type: 'gift', targetId: citizen.id });
  assert.equal(sim.state.relationships.length, 0);
});

test('controlled actual gift rejects the original 3.8m cross-floor case without granting a private-floor identity', () => {
  const { sim, hall } = fixture();
  const citizen = sim.state.citizens.find(actor => actor.role === '官员' || actor.role === 'official');
  assert.ok(citizen, 'choose an original constructor official instead of assigning a role');
  const identity = Reflect.get(sim, 'citizenIdentity').call(sim, citizen) as Role;
  assert.equal(identity, 'official', 'derive the existing canonical identity without changing the resident');
  const from = { ...publicPlayerPoint }, to = { ...publicPlayerPoint, y: hall.position.y + .6 + hall.height / hall.floors };
  supportAt(hall, 0, from, 'room'); supportAt(hall, 1, to, 'room');
  assert.equal(canAccessFloor(hall, 0, sim.state.player), true);
  assert.equal(canAccessFloor(hall, 1, sim.state.player), false);
  assert.equal(canAccessFloor(hall, 1, { role: identity, identities: [identity] }), true);
  assert.ok(Math.abs(distance(from, to) - 3.8) < 1e-8);
  // CONTROLLED original support points; no invented official or natural arrival.
  sim.state.player.position = from; citizen.position = to;
  rejectAtomically(sim, { type: 'gift', targetId: citizen.id });
  assert.equal(sim.state.relationships.length, 0);
});

test('controlled legal contact with original zero food still rejects without adding a food key or a relation', () => {
  const { sim, citizen } = fixture(0);
  assert.equal(Object.hasOwn(sim.state.player.inventory, 'food'), false);
  rejectAtomically(sim, { type: 'gift', targetId: citizen.id }, /食物/);
  assert.equal(Object.hasOwn(sim.state.player.inventory, 'food'), false);
  assert.equal(sim.state.relationships.length, 0);
});

test('controlled legal gift retains the original ten-minute cooldown even while another paid food remains', () => {
  const { sim, citizen } = fixture(2);
  const first = sim.command({ type: 'gift', targetId: citizen.id });
  assert.equal(first.ok, true, first.message);
  assert.equal(sim.state.player.inventory.food, 1, 'the repeat must reach the cooldown rather than fail for lack of food');
  assert.equal(runtime(sim).relationshipAt[citizen.id], runtime(sim).relationshipClock);
  rejectAtomically(sim, { type: 'gift', targetId: citizen.id }, /刚刚已交流过/);
  assert.equal(sim.state.relationships[0].encounters, 1);
});

test('controlled 3m contact keeps original socialize behavior while the new actual gift refuses atomically', () => {
  const { sim, hall, citizen } = fixture();
  controlledPublicPositions(sim, hall, citizen, { x: 75, y: .6, z: -18 });
  assert.equal(distance(sim.state.player.position, citizen.position), 3);
  rejectAtomically(sim, { type: 'gift', targetId: citizen.id }, /两米/);
  assert.equal(sim.state.relationships.length, 0);
  const beforeHunger = citizen.needs.hunger, beforeFood = sim.state.player.inventory.food;
  const social = sim.command({ type: 'socialize', targetId: citizen.id });
  assert.equal(social.ok, true, social.message);
  const relation = sim.state.relationships[0];
  assert.equal(relation.npcId, citizen.id); assert.equal(relation.affection, 6); assert.equal(relation.trust, 5);
  assert.deepEqual(relation.memories, [{ tick: sim.state.tick, text: '街巷相谈', impact: 6 }]);
  assert.equal(sim.state.player.inventory.food, beforeFood);
  assert.equal(citizen.needs.hunger, beforeHunger);
});

test('the actual original v3 save keeps exact full and partition opening bytes and 24 original future ticks', () => {
  const world = readOriginalWorld();
  const bytes = readFileSync(new URL('./fixtures/civic-history/root13-four-day.save.json', import.meta.url));
  assert.equal(hash(bytes), OLD_SAVE_SHA256, 'retain the genuine immutable original source save');
  const saved = bytes.toString('utf8'), options: SimulationOptions = { rulesetId: 'civic-local-v1' };
  const original = new Simulation(world, options), loaded = original.importSave(saved);
  assert.equal(loaded.ok, true, loaded.message);
  assert.equal(original.exportSave(), saved, 'the manual contact gate cannot silently add a policy or rewrite old saves');
  future24Exact(original, world, options);
});

test('controlled actual legacy gifts admit only the original south ground door disk, including exact and +/- .1/.3 feet', () => {
  // NOT_RUN when authored. Five separate original constructor/paid-food
  // scenarios keep their real inventory and cooldown independent.
  const cases = [
    { label: 'both exact original door', playerOffset: 0, npcOffset: 0 },
    { label: 'inside -.1 to outside +.1', playerOffset: -.1, npcOffset: .1 },
    { label: 'outside +.1 to inside -.1', playerOffset: .1, npcOffset: -.1 },
    { label: 'inside -.3 to outside +.3', playerOffset: -.3, npcOffset: .3 },
    { label: 'outside +.3 to inside -.3', playerOffset: .3, npcOffset: -.3 },
  ];
  for (const scenario of cases) {
    const world = readOriginalWorld(), originalWorld = JSON.stringify(world), sim = new Simulation(world);
    assert.equal(JSON.stringify(world), originalWorld);
    assert.equal(sim.state.player.role, 'traveler');
    assert.deepEqual(sim.state.player.identities, ['traveler']);
    assert.equal(sim.state.player.money, 600);
    assert.deepEqual({ ...sim.state.player.inventory }, { block: 32 });
    assert.equal(sim.state.relationships.length, 0);
    const market = world.buildings.find(site => site.id === 'civic-0-market');
    assert.ok(market);
    assert.equal(market.floorPlanProfile, undefined);
    assert.equal(getBuildingFloorPlan(market, 0), null, 'this is the unchanged bodyless legacy building');
    assert.equal(market.door.z, market.position.z + market.depth / 2);
    assert.equal(market.door.y, market.position.y + .6);
    assert.ok(world.nodes.some(node => node.id === `${market.id}-door` && distance(node.position, market.door) === 0));
    const citizen = sim.state.citizens.find(actor => sim.state.extension!.actorProfiles[actor.id].alive
      && Number.isFinite(actor.needs.hunger) && actor.needs.hunger <= 80);
    assert.ok(citizen, 'select an actual original resident without changing hunger, life or identity');
    const role = Reflect.get(sim, 'citizenIdentity').call(sim, citizen) as Role;
    const identity = { role, identities: [role] };
    assert.equal(canAccessFloor(market, 0, sim.state.player), true);
    assert.equal(canAccessFloor(market, 0, identity), true);

    // No floorPlanSupport proxy: explicit original legacy door-disk support,
    // original walking height and main contact admission own these feet.
    assert.deepEqual(legacyGiftDoorPresence(world, market, market.door, sim.state.player), { floor: 0, y: market.door.y });
    assert.equal(getWalkHeight(world, market.door.x, market.door.z, market.door.y), market.door.y);
    sim.state.player.position = { ...market.door }; // CONTROLLED original door, not natural arrival.
    const shop = sim.state.shops.find(item => item.buildingId === market.id); assert.ok(shop);
    const beforeCash = sim.state.player.money, beforeStock = shop.inventory, price = shop.price;
    const purchased = sim.command({ type: 'purchase', targetId: market.id, value: 3 });
    assert.equal(purchased.ok, true, `${scenario.label}: ${purchased.message}`);
    assert.equal(sim.state.player.inventory.food, 2);
    assert.equal(sim.state.player.money, beforeCash - price * 3);
    assert.equal(shop.inventory, beforeStock - 3);

    const from = { ...market.door, z: market.door.z + scenario.playerOffset };
    const to = { ...market.door, z: market.door.z + scenario.npcOffset };
    for (const [point, person] of [[from, sim.state.player], [to, identity]] as const) {
      assert.equal(getWalkHeight(world, point.x, point.z, point.y), point.y, scenario.label);
      assert.deepEqual(legacyGiftDoorPresence(world, market, point, person), { floor: 0, y: market.door.y },
        `${scenario.label}: the original full disk straddles this real open ground door`);
    }
    // CONTROLLED, pure-certified original feet only. No ACL/body/needs/food grant.
    sim.state.player.position = from; citizen.position = to;
    const canonicalRecipient = { position: citizen.position, ...identity };
    assert.equal(giftContactReason(world, sim.state.player, canonicalRecipient, sim.state.voxels), null,
      `${scenario.label}: main contact guard must use the explicit legal legacy door admission`);
    const beforePlayer = structuredClone(sim.state.player), beforeCitizen = structuredClone(citizen);
    const beforeProfiles = structuredClone(sim.state.extension!.actorProfiles), clock = runtime(sim).relationshipClock;
    const delivered = sim.command({ type: 'gift', targetId: citizen.id });
    assert.equal(delivered.ok, true, `${scenario.label}: ${delivered.message}`);
    assert.deepEqual(sim.state.player, { ...beforePlayer, reputation: beforePlayer.reputation + .5,
      inventory: { ...beforePlayer.inventory, food: beforePlayer.inventory.food! - 1 } }, scenario.label);
    assert.deepEqual(citizen, { ...beforeCitizen, needs: { ...beforeCitizen.needs, hunger: beforeCitizen.needs.hunger + 20 } },
      `${scenario.label}: only the original hunger feedback changes in the complete original resident`);
    assert.deepEqual(sim.state.extension!.actorProfiles, beforeProfiles);
    assert.equal(sim.state.player.inventory.food, 1);
    assert.equal(sim.state.relationships.length, 1);
    const relation = sim.state.relationships[0];
    assert.equal(relation.npcId, citizen.id); assert.equal(relation.affection, 12);
    assert.equal(relation.trust, 8); assert.equal(relation.encounters, 1);
    assert.equal(relation.type, 'acquaintance');
    assert.deepEqual(relation.memories, [{ tick: sim.state.tick, text: '赠送食物', impact: 12 }]);
    assert.equal(runtime(sim).relationshipAt[citizen.id], clock);
    assert.equal(runtime(sim).relationshipClock, clock);
    assert.equal(sim.state.events.at(-1)?.type, 'gift');
    // Another paid food remains, so this checks the actual original cooldown.
    rejectAtomically(sim, { type: 'gift', targetId: citizen.id }, /刚刚已交流过/);
    assert.equal(sim.state.relationships[0].encounters, 1);
  }
});

test('controlled actual saved-voxel bottom boundaries admit a head-clear gift and reject feet overlap atomically', () => {
  // NOT_RUN when authored. These are two independent finite saved-voxel
  // geometry fixtures, not blocks claimed to come from a build command.
  // Actual build rounds to .2m and needs owned space: neither exact boundary
  // below is a grid position in this unchanged public hall. No block material
  // or construction counter is fabricated; only this explicit voxel fixture
  // is added, while the original food comes from a real paid purchase.
  const scenarios = [
    { label: 'actual bottom .05 above original head is clear', headClear: true },
    { label: 'actual bottom .15 below feet puts the .2 cube top .05 above feet', headClear: false },
  ];
  for (const scenario of scenarios) {
    const { world, sim, citizen } = fixture(2);
    assert.equal(world.voxelSize, .2);
    assert.equal(sim.state.voxels.length, 0);
    assert.equal(sim.state.relationships.length, 0);
    assert.equal(sim.state.player.inventory.food, 2, 'only the real purchase provides food');
    const feet = sim.state.player.position.y, head = feet + 1.72;
    const bottom = scenario.headClear ? head + .05 : feet - .15;
    const controlledVoxel = {
      id: scenario.headClear ? 'gift-contact-controlled-saved-voxel-head-clear' : 'gift-contact-controlled-saved-voxel-feet-overlap',
      position: { x: sim.state.player.position.x, y: bottom, z: sim.state.player.position.z },
      color: '#8fcdc9',
    };
    assert.ok(Object.values(controlledVoxel.position).every(Number.isFinite));
    assert.ok(controlledVoxel.id.length <= 80 && /^#[0-9a-fA-F]{6}$/.test(controlledVoxel.color));
    const actualTop = bottom + .2, oldCentreBottom = bottom - .1, oldCentreTop = bottom + .1;
    if (scenario.headClear) {
      assert.ok(Math.abs(bottom - head - .05) < 1e-8);
      assert.ok(bottom > head, 'rendered/controller .2 cube begins above the complete actual body');
      assert.ok(oldCentreBottom < head && oldCentreTop > feet + .01,
        'the former center interpretation falsely intersects this original standing body');
    } else {
      assert.ok(Math.abs(bottom - feet + .15) < 1e-8);
      assert.ok(Math.abs(actualTop - feet - .05) < 1e-8);
      assert.ok(bottom < feet && actualTop > feet + .01,
        'the actual cube overlaps the original supported feet by more than the .01 allowance');
      assert.ok(oldCentreTop < feet, 'the former center interpretation missed the actual feet overlap');
    }
    const beforeGeometryState = structuredClone(sim.state), beforeGeometryRuntime = structuredClone(runtime(sim));
    // CONTROLLED existing saved-voxel geometry, not natural construction,
    // ownership, arrival or consumption. No inventory/runtime source is granted.
    sim.state.voxels.push(controlledVoxel);
    assert.deepEqual(sim.state, { ...beforeGeometryState, voxels: [controlledVoxel] },
      'the controlled geometry input changes only the finite saved voxel array');
    assert.deepEqual(runtime(sim), beforeGeometryRuntime);
    const geometrySave = sim.exportSave(), openingReader = new Simulation(world);
    const opened = openingReader.importSave(geometrySave);
    assert.equal(opened.ok, true, `${scenario.label}: the real reader accepts the finite original-schema voxel`);
    assert.equal(openingReader.exportSave(), geometrySave, 'the geometry fixture keeps exact original full-save opening bytes');
    assert.deepEqual(openingReader.state.voxels, [controlledVoxel]);
    const role = Reflect.get(sim, 'citizenIdentity').call(sim, citizen) as Role;
    const recipient = { position: citizen.position, role, identities: [role] };
    const reason = giftContactReason(world, sim.state.player, recipient, sim.state.voxels);
    if (!scenario.headClear) {
      assert.ok(reason, 'actual stationary voxel overlap must fail contact before a relationship exists');
      assert.match(reason, /体素/);
      rejectAtomically(sim, { type: 'gift', targetId: citizen.id }, /体素/);
      assert.equal(sim.state.relationships.length, 0);
      assert.deepEqual(sim.state.voxels, [controlledVoxel]);
      assert.equal(sim.state.player.inventory.food, 2);
      continue;
    }
    assert.equal(reason, null, 'a cube above the original head cannot make legal contact fail');
    const beforePlayer = structuredClone(sim.state.player), beforeCitizen = structuredClone(citizen);
    const beforeProfiles = structuredClone(sim.state.extension!.actorProfiles), beforeVoxels = structuredClone(sim.state.voxels);
    const clock = runtime(sim).relationshipClock;
    const delivered = sim.command({ type: 'gift', targetId: citizen.id });
    assert.equal(delivered.ok, true, `${scenario.label}: ${delivered.message}`);
    assert.deepEqual(sim.state.player, { ...beforePlayer, reputation: beforePlayer.reputation + .5,
      inventory: { ...beforePlayer.inventory, food: beforePlayer.inventory.food! - 1 } },
      'complete original player retains funds, identity and needs while consuming exactly one paid food');
    assert.deepEqual(citizen, { ...beforeCitizen, needs: { ...beforeCitizen.needs, hunger: beforeCitizen.needs.hunger + 20 } });
    assert.deepEqual(sim.state.extension!.actorProfiles, beforeProfiles);
    assert.deepEqual(sim.state.voxels, beforeVoxels, 'legal gift cannot remove or rewrite the fixture geometry');
    assert.equal(sim.state.player.inventory.food, 1);
    assert.equal(sim.state.relationships.length, 1);
    const relation = sim.state.relationships[0];
    assert.equal(relation.npcId, citizen.id); assert.equal(relation.affection, 12);
    assert.equal(relation.trust, 8); assert.equal(relation.encounters, 1);
    assert.equal(relation.type, 'acquaintance');
    assert.deepEqual(relation.memories, [{ tick: sim.state.tick, text: '赠送食物', impact: 12 }]);
    assert.equal(runtime(sim).relationshipAt[citizen.id], clock);
    assert.equal(runtime(sim).relationshipClock, clock);
    assert.equal(sim.state.events.at(-1)?.type, 'gift');
    rejectAtomically(sim, { type: 'gift', targetId: citizen.id }, /刚刚已交流过/);
    assert.equal(sim.state.relationships[0].encounters, 1);
    assert.deepEqual(sim.state.voxels, beforeVoxels);
  }
});
