import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation';
import { canAccessFloor } from '../src/access';
import { findBuildingFloorPlanRoute } from '../src/architecture-floor-plan';
import type { Building, BuildingFunctionPoint, Citizen, LifeProfile, Role, Vec3, VoxelModification } from '../src/types';

interface NativeFragment {
  actor: Citizen; actorProfile: LifeProfile; home: Building; work: Building;
  publicRest: Building; markedPublicRest: Building; homeNetworkTravel: number; publicNetworkTravel: number;
}
const native = JSON.parse(readFileSync(new URL('./fixtures/resident-public-rest-world291.json', import.meta.url), 'utf8')) as NativeFragment;
const clone = <T>(value: T): T => structuredClone(value);
interface Choice { destination: Building; activity: string }
interface Facade {
  state: { hour: number; shops: never[]; relationships: never[]; voxels: VoxelModification[]; extension: { actorProfiles: Record<string, LifeProfile> } };
  world: { buildings: Building[]; edges: never[]; size: number }; buildings: Map<string, Building>; runtime: { activities: Record<string, string> };
  availableHomeRestPoints: () => unknown[]; citizenIdentity: () => Role; isEmployed: () => boolean;
  walkingAnchors: () => { node: string; cost: number; points: Vec3[] }[];
  walkingTree: () => { costs: Map<string, number> }; buildingNode: (building: Building) => { id: string };
  publicRestReachable: (actor: Citizen, site: Building, anchors: ReturnType<Facade['walkingAnchors']>) => boolean;
  floorPlanPresence: (site: Building, position: Vec3) => { floor: number } | null;
  floorPlanRoute: (site: Building, fromFloor: number, toFloor: number, from: Vec3, to: Vec3) => Vec3[] | null;
  buildingFunctionPoints: (site: Building) => BuildingFunctionPoint[];
  validPosition: (position: unknown) => boolean;
  isNearBuilding: (site: Building, position: Vec3, margin?: number) => boolean;
  isAtBuildingFunctionPoint: (site: Building, position: Vec3, purpose?: BuildingFunctionPoint['purpose'], person?: { role: Role; identities: Role[] }) => boolean;
  routeFromCitizen: (actor: Citizen, site: Building) => Vec3[];
  roadPrefixAllowed: (actor: Citizen, route: Vec3[]) => boolean;
}
const choose = Reflect.get(Simulation.prototype, 'chooseFacility') as (this: Facade, actor: Citizen) => Choice;
const reachable = Reflect.get(Simulation.prototype, 'publicRestReachable') as Facade['publicRestReachable'];
const presence = Reflect.get(Simulation.prototype, 'floorPlanPresence') as Facade['floorPlanPresence'];
const atPoint = Simulation.prototype.isAtBuildingFunctionPoint as Facade['isAtBuildingFunctionPoint'];
const near = Reflect.get(Simulation.prototype, 'isNearBuilding') as Facade['isNearBuilding'];
const validPosition = Reflect.get(Simulation.prototype, 'validPosition') as Facade['validPosition'];

/** Real World291 fragments and actual 13:52 resident record. Dependency controls
 * isolate choice/permission/support failures. These tests construct/step no city,
 * and do not certify a natural commute, onsite recovery, payroll or overnight cycle. */
function fixture(options: { night?: boolean; publicSite?: Building; bedAvailable?: boolean; travel?: number } = {}) {
  const actor = clone(native.actor), home = clone(native.home), work = clone(native.work), publicRest = clone(options.publicSite ?? native.publicRest);
  const node = (site: Building) => ({ id: `rest-fixture:${site.id}` });
  const facade: Facade = {
    state: { hour: options.night ? 23 : (3712 % 1440) / 60, shops: [], relationships: [], voxels: [], extension: { actorProfiles: { [actor.id]: clone(native.actorProfile) } } },
    world: { buildings: [home, publicRest], edges: [], size: 4400 }, buildings: new Map([home, work, publicRest].map(site => [site.id, site])),
    runtime: { activities: { [actor.id]: 'rest' } }, availableHomeRestPoints: () => options.bedAvailable === false ? [] : [{}],
    citizenIdentity: () => 'police', isEmployed: () => false,
    walkingAnchors: () => [{ node: 'origin', cost: 0, points: [actor.position] }],
    walkingTree: () => ({ costs: new Map([[node(home).id, native.homeNetworkTravel], [node(publicRest).id, options.travel ?? native.publicNetworkTravel]]) }),
    buildingNode: node, publicRestReachable: reachable, floorPlanPresence: presence,
    floorPlanRoute: (site, fromFloor, toFloor, from, to) => findBuildingFloorPlanRoute(site, fromFloor, toFloor, from, to, .35),
    buildingFunctionPoints: site => site.functionPoints ?? [], validPosition, isNearBuilding: near, isAtBuildingFunctionPoint: atPoint,
    routeFromCitizen: (person, site) => [person.position, site.door], roadPrefixAllowed: () => true,
  };
  return { facade, actor, home, publicRest };
}
test('exhausted real resident outside home district prefers the walkable 247m public rest offer over a 1465m home trip without mutation', () => {
  const { facade, actor, publicRest } = fixture(), before = JSON.stringify(actor), stateBefore = JSON.stringify(facade.state);
  assert.equal(actor.needs.fatigue, 0); assert.notEqual(actor.districtId, publicRest.districtId);
  const choice = choose.call(facade, actor); assert.equal(choice.activity, 'rest'); assert.equal(choice.destination.id, publicRest.id);
  assert.equal(JSON.stringify(actor), before); assert.equal(JSON.stringify(facade.state), stateBefore);
});
test('new daytime cross-district offer uses the existing strict fatigue 25 boundary', () => {
  const { facade, actor, home, publicRest } = fixture(); actor.needs.fatigue = 24;
  assert.equal(choose.call(facade, actor).destination.id, publicRest.id);
  actor.needs.fatigue = 25; assert.equal(choose.call(facade, actor).destination.id, home.id);
});
test('night with a legal home bed retains own-home preference and does not probe a new outside offer', () => {
  const { facade, actor, home } = fixture({ night: true });
  facade.publicRestReachable = () => { throw Error('new daytime eligibility must not replace night home-bed policy'); };
  assert.equal(choose.call(facade, actor).destination.id, home.id);
});
test('existing full-home night fallback remains available without invoking the daytime helper', () => {
  const { facade, actor, publicRest } = fixture({ night: true, bedAvailable: false });
  facade.publicRestReachable = () => { throw Error('original night fallback is unchanged'); };
  assert.equal(choose.call(facade, actor).destination.id, publicRest.id);
});
test('a closer foreign hall still supplies no rest offer', () => {
  const { facade, actor, home } = fixture({ publicSite: { ...native.publicRest, kind: 'hall' } });
  actor.needs.social = 100; actor.needs.fun = 100;
  assert.equal(choose.call(facade, actor).destination.id, home.id);
});
test('an inaccessible legacy public-rest floor is rejected before choosing without spending or moving', () => {
  const forbidden: Building = { ...native.publicRest, publicFloors: 0, requiredPermission: 'mayor', floorPermissions: ['mayor'] };
  assert.equal(canAccessFloor(forbidden, 0, { role: 'police', identities: ['police'] }), false);
  const { facade, actor, home } = fixture({ publicSite: forbidden }), before = JSON.stringify(actor);
  assert.equal(choose.call(facade, actor).destination.id, home.id); assert.equal(JSON.stringify(actor), before);
});
test('a foreign public rest site with no current road approach or an infinite network cost is rejected', () => {
  const { facade, actor, home } = fixture(); facade.routeFromCitizen = person => [person.position];
  assert.equal(choose.call(facade, actor).destination.id, home.id);
  facade.routeFromCitizen = (person, site) => [person.position, site.door]; facade.roadPrefixAllowed = () => false;
  assert.equal(choose.call(facade, actor).destination.id, home.id);
  facade.roadPrefixAllowed = () => true; facade.walkingTree = () => ({ costs: new Map([[facade.buildingNode(home).id, native.homeNetworkTravel]]) });
  assert.equal(choose.call(facade, actor).destination.id, home.id);
});
test('a supported marked service point is usable, but a missing or blocked interior is not advertised', () => {
  const { facade, actor, publicRest, home } = fixture({ publicSite: native.markedPublicRest });
  assert.equal(choose.call(facade, actor).destination.id, publicRest.id);
  facade.buildingFunctionPoints = () => []; assert.equal(choose.call(facade, actor).destination.id, home.id);
  facade.buildingFunctionPoints = site => site.functionPoints ?? []; facade.floorPlanRoute = () => null;
  assert.equal(choose.call(facade, actor).destination.id, home.id);
});
test('a marked service point with an invalid supporting floor or placed body voxel is rejected', () => {
  const { facade, actor, home } = fixture({ publicSite: native.markedPublicRest });
  facade.floorPlanRoute = (_site, _fromFloor, _toFloor, from, to) => [from, to];
  const service = native.markedPublicRest.functionPoints!.find(point => point.purpose === 'service')!;
  facade.buildingFunctionPoints = () => [{ ...service, position: { ...service.position, x: service.position.x + 1000 } }];
  assert.equal(choose.call(facade, actor).destination.id, home.id);
  facade.buildingFunctionPoints = () => [service]; facade.state.voxels = [{ id: 'controlled-blocked-rest-target', position: { ...service.position }, color: '#777777' }];
  assert.equal(choose.call(facade, actor).destination.id, home.id);
});
