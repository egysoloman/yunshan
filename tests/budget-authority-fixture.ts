import assert from 'node:assert/strict';
import { civicFixtureWorld } from './civic-staffing-fixture.ts';
import { FLOOR_PLAN_PROFILE, getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import type { Building, Vec3, WorldDefinition } from '../src/types.ts';

/** A declared parameter-city extension BEFORE any constructor. It adds one
 * real school, clinic and industrial producer with physical lanes. It does
 * not supply a councillor, wage, vote, money, material or attendance record.
 * Actual constructor residents and original rules determine all staffing. */
export function budgetAuthorityFixtureWorld(): WorldDefinition {
  const world = civicFixtureWorld(), district = world.districts[0], anchor = world.nodes.find(n => n.id === `${district.id}-home-door`)!;
  for (const [index,kind] of (['school','clinic','workshop'] as const).entries()) {
    const marked = kind === 'school' || kind === 'clinic', x = district.center.x - 72 - index * 64;
    const site: Building = { id: `${district.id}-${kind}`, districtId: district.id, name: `有限补充服务${kind}`, kind,
      position: { x, y: 0, z: -60 }, door: { x, y: .6, z: marked ? -41 : -54 },
      width: marked ? 50 : 12, depth: marked ? 38 : 12, height: marked ? 11.4 : 12, floors: marked ? 3 : 2, rotation: 0, capacity: 120, seed: 300 + index };
    if (marked) { site.floorPlanProfile = FLOOR_PLAN_PROFILE; site.stairGeometryRevision = 2; site.publicFloors = 1;
      site.floorPermissions = ['public','official','official']; site.functionPoints = Array.from({length: site.floors}, (_,floor) => getBuildingUsePoints(site,floor)).flat(); }
    world.buildings.push(site);
    const node = { id: `${site.id}-door`, districtId: district.id, name: site.name, station: false, position: { ...site.door } }; world.nodes.push(node);
    const points: Vec3[] = [{ ...anchor.position }, { x: anchor.position.x, y: .6, z: -40 }, { x, y: .6, z: -40 }, { ...site.door }];
    const length = points.slice(1).reduce((sum,p,i) => sum + Math.hypot(p.x-points[i].x,p.y-points[i].y,p.z-points[i].z),0);
    world.edges.push({ id: `${site.id}-road`, from: anchor.id, to: node.id, mode: 'road', length, capacity: 100, points });
  }
  // Explicit legal player opening at the actual public hall service point;
  // all NPCs still begin at their original constructor home positions.
  const hall = world.buildings.find(b => b.id === `${district.id}-hall`)!;
  world.spawn = { ...hall.functionPoints!.find(p => p.floor === 0 && p.purpose === 'service')!.position };
  assert.equal(world.buildings.filter(b => b.kind === 'workshop').length, 1);
  return world;
}
