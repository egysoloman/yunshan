import { fixture } from './clinical-presence-fixture.ts';
import { getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
export function world() {
  const definition = fixture(false);
  const hall = definition.buildings.find(b => b.kind === 'hall')!;
  Object.assign(hall, { facility: 'council', width: 50, depth: 38, height: 11.4, floors: 3, floorPlanProfile: 'v4-program-bodies-02' });
  hall.door = { x: hall.position.x, y: .6, z: 19 };
  hall.functionPoints = Array.from({ length: hall.floors }, (_, floor) => getBuildingUsePoints(hall, floor)).flat();
  definition.nodes.find(n => n.id === `${hall.id}-door`)!.position = { ...hall.door };
  definition.buildings.find(b => b.kind === 'workshop')!.facility = 'data';
  return definition;
}
