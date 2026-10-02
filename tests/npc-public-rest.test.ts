import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation';
import { homeRestPoints } from '../src/simulation/home-rest';
import type { HomeRestPoint } from '../src/simulation/home-rest';
import type { Building, BuildingFunctionPoint, Citizen, LifeProfile, Role, Vec3 } from '../src/types';

interface NativeFixture { actor: Citizen; home: Building; work: Building; publicRest: Building; actorProfile: LifeProfile }
const native = JSON.parse(readFileSync(new URL('./fixtures/npc-rest-offer-native.json', import.meta.url), 'utf8')) as NativeFixture;
const clone = <T>(value: T): T => structuredClone(value);
interface Choice { destination: Building; activity: string }
interface Facade {
  state: { hour: number; shops: never[]; relationships: never[]; extension: { actorProfiles: Record<string, LifeProfile> } };
  world: { buildings: Building[] }; buildings: Map<string, Building>; runtime: { activities: Record<string, string> };
  availableHomeRestPoints: () => HomeRestPoint[];
  walkingAnchors: () => { node: string; cost: number; points: Vec3[] }[];
  walkingTree: () => { costs: Map<string, number> };
  buildingNode: (building: Building) => { id: string };
  isEmployed: () => boolean; citizenIdentity: () => Role;
}
interface RouteFacade extends Facade {
  activityPointPurpose: (activity?: string) => BuildingFunctionPoint['purpose'];
  buildingFunctionPoints?: () => BuildingFunctionPoint[];
  floorPlanPresence: () => null; floorPlanRoute: () => Vec3[] | null; routeFromCitizen: () => Vec3[];
}
const choose = Reflect.get(Simulation.prototype, 'chooseFacility') as (this: Facade, citizen: Citizen) => Choice;
const setDestination = Reflect.get(Simulation.prototype, 'setDestination') as (this: RouteFacade, citizen: Citizen, building: Building) => void;
const activityPointPurpose = Reflect.get(Simulation.prototype, 'activityPointPurpose') as RouteFacade['activityPointPurpose'];

/** Pure dependency fixtures exercise the real private selection/routing methods.
 * They reuse native offer fields with an empty route, but control bed capacity, road cost, and
 * daypart. No Simulation is constructed or stepped; this is not natural city,
 * full graph, physical movement, or onsite recovery validation. */
function fixture(options: { bedAvailable?: boolean; publicWalkable?: boolean; night?: boolean } = {}) {
  const { bedAvailable = false, publicWalkable = true, night = true } = options;
  const actor = clone(native.actor), home = clone(native.home), work = clone(native.work), publicRest = clone(native.publicRest);
  const point = homeRestPoints(home, 0)[0]; assert(point, 'native home has a supported shaft-connected bed side');
  const node = (building: Building) => ({ id: `fixture-node:${building.id}` });
  const facade: Facade = {
    state: { hour: night ? 0 : 12, shops: [], relationships: [], extension: { actorProfiles: { [actor.id]: clone(native.actorProfile) } } },
    world: { buildings: [home, publicRest] }, buildings: new Map([home, work, publicRest].map(building => [building.id, building])),
    runtime: { activities: { [actor.id]: 'rest' } }, availableHomeRestPoints: () => bedAvailable ? [point] : [],
    walkingAnchors: () => [{ node: 'fixture-origin', cost: 0, points: [actor.position] }],
    walkingTree: () => ({ costs: new Map([[node(home).id, 100], [node(publicRest).id, publicWalkable ? 200 : Infinity]]) }),
    buildingNode: node, isEmployed: () => false, citizenIdentity: () => 'traveler',
  };
  return { facade, actor, home, publicRest };
}
const routeFacade = (facade: Facade, actor: Citizen, target: Building): RouteFacade => ({
  ...facade, activityPointPurpose, floorPlanPresence: () => null,
  floorPlanRoute: () => { throw new Error('an absent or forbidden point must not be routed'); },
  routeFromCitizen: () => [actor.position, target.door],
});

test('night full home with no local public site offers walkable cross-district public rest without actor mutation', () => {
  const { facade, actor, publicRest } = fixture(), before = JSON.stringify(actor);
  const choice = choose.call(facade, actor); assert.equal(choice.destination.id, publicRest.id); assert.equal(choice.activity, 'rest');
  assert.equal(JSON.stringify(actor), before);
});
test('a home with an available bed retains the original own-home rest preference', () => {
  const { facade, actor, home } = fixture({ bedAvailable: true }); assert.equal(choose.call(facade, actor).destination.id, home.id);
});
test('the full-home cross-district exception is restricted to night', () => {
  const { facade, actor, home } = fixture({ night: false }); assert.equal(choose.call(facade, actor).destination.id, home.id);
});
test('unwalkable public offers are filtered and a full home still rejects routing without changing needs or wallet', () => {
  const { facade, actor, home } = fixture({ publicWalkable: false }), before = clone(actor);
  assert.equal(choose.call(facade, actor).destination.id, home.id); setDestination.call(routeFacade(facade, actor, home), actor, home);
  assert.equal(actor.state, 'unreachable'); assert.equal(actor.route?.length, 1); assert.equal(actor.routeIndex, 1);
  assert.deepEqual(actor.needs, before.needs); assert.equal(actor.money, before.money);
});
test('the existing same-district daytime low-fatigue public rest offer remains available', () => {
  const { facade, actor, home, publicRest } = fixture({ bedAvailable: true, night: false }); actor.needs.fatigue = 24;
  const local = { ...publicRest, districtId: home.districtId }; facade.world.buildings = [home, local];
  facade.walkingTree = () => ({ costs: new Map([[facade.buildingNode(home).id, 100], [facade.buildingNode(local).id, 20]]) });
  const choice = choose.call(facade, actor); assert.equal(choice.destination.id, local.id); assert.equal(choice.activity, 'rest');
});
test('the night full-home exception does not advertise an unrelated cross-district hall as rest', () => {
  const { facade, actor, home, publicRest } = fixture(); facade.world.buildings = [home, { ...publicRest, kind: 'hall' }];
  assert.equal(choose.call(facade, actor).destination.id, home.id);
});
test('marked public service permissions remain authoritative when setting a destination', () => {
  const { facade, actor, publicRest } = fixture(), before = clone(actor);
  const forbidden: Building = { ...publicRest, publicFloors: 0, requiredPermission: 'mayor', floorPermissions: ['mayor'] };
  const service = publicRest.functionPoints?.find(point => point.purpose === 'service'); assert(service);
  const routes: RouteFacade = { ...routeFacade(facade, actor, forbidden), buildingFunctionPoints: () => [{ ...service, floor: 0 }] };
  setDestination.call(routes, actor, forbidden); assert.equal(actor.state, 'unreachable'); assert.equal(actor.route?.length, 1);
  assert.deepEqual(actor.needs, before.needs); assert.equal(actor.money, before.money);
});
test('same-district computed social/rest ties retain the original stable choice without actor mutation', () => {
  const { facade, actor, home, publicRest } = fixture({ bedAvailable: true, night: false });
  actor.needs.fatigue = 0; actor.needs.social = 0; actor.needs.fun = 0;
  const pavilion: Building = { ...publicRest, id: 'fixture-local-pavilion', kind: 'pavilion', districtId: home.districtId };
  const hall: Building = { ...publicRest, id: 'fixture-local-hall', kind: 'hall', districtId: home.districtId };
  facade.world.buildings = [home, pavilion, hall];
  facade.walkingTree = () => ({ costs: new Map([[facade.buildingNode(home).id, 2700], [facade.buildingNode(pavilion).id, 900], [facade.buildingNode(hall).id, 0]]) });
  // Production computes equal highest scores: pavilion rest190 - 900/12 = 115;
  // hall social115 - 0/12 = 115. Stable ordering must choose the earlier rest.
  const before = JSON.stringify(actor), choice = choose.call(facade, actor);
  assert.equal(choice.destination.id, pavilion.id); assert.equal(choice.activity, 'rest');
  assert.equal(JSON.stringify(actor), before);
});
test('the full-home cross-district rest exception starts at exactly 22:00', () => {
  const { facade, actor, publicRest } = fixture(); facade.state.hour = 22;
  const before = JSON.stringify(actor), choice = choose.call(facade, actor);
  assert.equal(choice.destination.id, publicRest.id); assert.equal(choice.activity, 'rest');
  assert.equal(JSON.stringify(actor), before);
});
test('the full-home cross-district rest exception ends at exactly 06:00', () => {
  const { facade, actor, home } = fixture(); facade.state.hour = 6;
  const before = JSON.stringify(actor), choice = choose.call(facade, actor);
  assert.equal(choice.destination.id, home.id); assert.equal(choice.activity, 'rest');
  assert.equal(JSON.stringify(actor), before);
});
