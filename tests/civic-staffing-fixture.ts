import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProductCity } from '../src/product-city.ts';
import { Simulation } from '../src/simulation.ts';
import { FLOOR_PLAN_PROFILE, getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import type { Building, Vec3, WorldDefinition } from '../src/types.ts';
import { civicCouncilSourceProof, type CivicTerm } from '../src/simulation/civic-staffing.ts';

/** Explicit PRE-constructor compact parameter city. It is not the default
 * terrain/map. All residents, ages, professions, education, wallets, cash,
 * food, employment, wages, needs, intents and ballots come from the actual
 * constructor and ordinary simulation. No pins, mayor, appoint, free grant,
 * fake event, skipped poll deadline or selected candidate is installed. */
export function civicFixtureWorld(): WorldDefinition {
  const districts = Array.from({ length: 11 }, (_, index) => ({ id: `civic-${index}`, name: `现场补选参数街坊${index}`,
    kind: 'government', center: { x: index * 250, y: 0, z: 0 }, radius: 120, color: '#bbcccc', population: 56 }));
  const buildings: Building[] = [], nodes: WorldDefinition['nodes'] = [], edges: WorldDefinition['edges'] = [];
  const length = (points: Vec3[]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y, point.z - points[index].z), 0);
  for (const district of districts) {
    const kinds = ['home', 'market', 'farm', 'hall'] as const;
    const local = kinds.map((kind, index): Building => {
      const hall = kind === 'hall', x = district.center.x + index * 32;
      const site: Building = { id: `${district.id}-${kind}`, districtId: district.id, name: `${district.name}${kind}`, kind,
        position: { x, y: 0, z: 0 }, door: { x, y: .6, z: hall ? 19 : 6 }, width: hall ? 50 : 12, depth: hall ? 38 : 12,
        height: hall ? 11.4 : 12, floors: hall ? 3 : 2, rotation: 0, capacity: 120, seed: index + 100 };
      if (hall) {
        site.floorPlanProfile = FLOOR_PLAN_PROFILE; site.stairGeometryRevision = 2;
        site.publicFloors = 1; site.requiredPermission = 'official'; site.floorPermissions = ['public', 'official', 'official'];
        site.floorUses = ['公共接待', '行政办公', '行政办公'];
        site.functionPoints = Array.from({ length: site.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat();
      }
      return site;
    });
    buildings.push(...local);
    const localNodes = local.map(site => ({ id: `${site.id}-door`, districtId: district.id, name: site.name, station: false, position: { ...site.door } }));
    nodes.push(...localNodes);
    for (let index = 1; index < localNodes.length; index++) {
      const previous = localNodes[index - 1], next = localNodes[index];
      const points = index === localNodes.length - 1
        ? [{ ...previous.position }, { x: local[index].position.x - local[index].width / 2 - 1, y: .6, z: 20 },
          { x: next.position.x, y: .6, z: 20 }, { ...next.position }]
        : [{ ...previous.position }, { ...next.position }];
      edges.push({ id: `${district.id}-road-${index}`, from: previous.id, to: next.id, mode: 'road', length: length(points), capacity: 100, points });
    }
  }
  return { seed: 20261004, voxelSize: .2, size: 4000, districts, buildings, nodes, edges,
    mountains: [], river: [], waterfall: { top: { x: 3900, y: 60, z: 1000 }, bottom: { x: 3900, y: 0, z: 1000 }, width: 10 }, spawn: { ...buildings[0].door } };
}
export function civicFixture() {
  const world = civicFixtureWorld(), sim = createProductCity(world);
  assert.equal(sim.effectiveRuleset, 'civic-local-v1'); assert.equal(sim.saveVersion, 3);
  assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
  return sim;
}
export const businessClock = (sim: Simulation) => sim.state.extension!.lastUpdate;
export const civicRuntime = (sim: Simulation) => Reflect.get(sim, 'runtime');
export function civicArtifact(name: string, contents: unknown, raw = false) {
  const directory = process.env.CIVIC_ARTIFACT_DIR; if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), raw ? contents as string : JSON.stringify(contents, null, 2) + '\n');
}
export function civicUntil(sim: Simulation, condition: () => boolean, maxTicks: number, message: string) {
  for (let tick = 0; tick < maxTicks && !condition(); tick++) sim.step(.25);
  if (!condition()) {
    const label = message.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
    civicArtifact(`FAIL-${label}.save.json`, sim.exportSave(), true); civicArtifact(`FAIL-${label}.world.json`, sim.worldDefinition);
  }
  assert.ok(condition(), `${message}; tick=${sim.state.tick}, clock=${businessClock(sim)}, proofs=${sim.state.civicStaffing?.proofs.length}, polls=${sim.state.civicStaffing?.polls.length}, terms=${sim.state.civicStaffing?.terms.length}`);
}
export function civicExact24(sim: Simulation) {
  const saved = sim.exportSave(), restored = createProductCity(sim.worldDefinition), result = restored.importSave(saved);
  assert.equal(result.ok, true, result.message); assert.equal(restored.exportSave(), saved);
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); restored.step(.25); assert.equal(restored.exportSave(), sim.exportSave(), `civic full save future tick ${tick + 1}`); }
}
/** Reusable ordinary driver. The caller chooses its complete world BEFORE
 * constructing the product city. This performs only original step(.25),
 * never adds a job, term, vote, money, source history or accelerated deadline. */
export function civicSameHallTerms(sim: Simulation, maxTicks = 1650): [CivicTerm, CivicTerm] {
  const pair = (): [CivicTerm, CivicTerm] | undefined => {
    const terms = sim.state.civicStaffing?.terms.filter(term => civicCouncilSourceProof(sim.state, term.actorId)) ?? [];
    for (const first of terms) {
      const second = terms.find(second => second.actorId !== first.actorId && second.officeId === first.officeId && second.districtId === first.districtId);
      if (second) return [first, second];
    }
  };
  civicUntil(sim, () => !!pair(), maxTicks, 'two actual different candidates must complete separate full resident polls at the same hall');
  return pair()!;
}
