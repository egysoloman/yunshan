import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw), source = resolve(input.sourceRoot);
const provider = await import(pathToFileURL(resolve(source, 'src/architecture-floor-plan.ts')).href);
const rest = await import(pathToFileURL(resolve(source, 'src/simulation/home-rest.ts')).href);
const access = await import(pathToFileURL(resolve(source, 'src/access.ts')).href);
const worldAPI = await import(pathToFileURL(resolve(source, 'src/world.ts')).href);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const routeLength = points => points.slice(1).reduce((sum, point, i) => sum + distance(point, points[i]), 0);


function fail(reason, detail = {}) { throw Error(JSON.stringify({ unsupportedActualSupport: reason, ...detail })); }
function queryActualSupport(data) {
  if (data.bodyRadius !== .35 || data.eyeHeight !== 1.72) fail('Changed physical body contract');
  const { world, actualBody: feet, player, floor } = data;
  if (!feet || !['x','y','z'].every(k => Number.isFinite(feet[k])) || !Number.isInteger(floor)) fail('Invalid actual feet/floor');
  if (!Number.isInteger(data.expectedFloor) || floor !== data.expectedFloor) fail('Actual floor differs from the original ground-floor waypoint contract', { floor, expectedFloor: data.expectedFloor });
  if (!Array.isArray(data.voxels)) fail('Live voxel state must be explicitly recorded');
  if (data.voxels.length) fail('Nonempty live voxel support is outside this unbuilt-home scope', { voxelCount: data.voxels.length });
  const b = world.buildings.find(site => site.id === data.building?.id);
  if (!b || JSON.stringify(b) !== JSON.stringify(data.building) || !provider.getBuildingBody(b)) fail('Selected site/world mismatch or unmarked body');
  if (data.insideId && data.insideId !== b.id || data.supportingSiteId && data.supportingSiteId !== b.id) fail('A different site owns the actual support');
  // Match controller floor selection: an existing inside/supportingSite uses its actual floor;
  // otherwise the candidate floor is rounded from the actual foot height.
  const selectedFloor = data.insideId === b.id || data.supportingSiteId === b.id ? floor
    : Math.round((feet.y - b.position.y - .6) / (b.height / b.floors));
  if (selectedFloor !== floor) fail('Caller floor differs from controller actual-floor selection', { selectedFloor, floor });
  const plan = provider.getBuildingFloorPlan(b, selectedFloor);
  if (!plan) fail('Selected actual floor has no plan');
  const local = provider.buildingLocalPosition(b, feet);
  const support = provider.floorPlanSupport(b, selectedFloor, feet, .35);
  const center = provider.floorPlanSupport(b, selectedFloor, feet, 0);
  const roof = provider.getFloorPlanRoofSupport(b, feet, .35);
  const entrance = provider.buildingLocalPosition(b, provider.getBuildingEntrance(b));
  const opening = plan.walls.find(wall => wall.opening?.use === 'entrance')?.opening;
  const doorEdge = selectedFloor === 0 && opening && Math.abs(local.z - entrance.z) <= .35 + .21
    && Math.abs(local.x - entrance.x) < (opening.to - opening.from) / 2 - .35;
  if (provider.blocksFloorPlanMovement(b, selectedFloor, feet, feet, .35, 1.72)) fail('Actual full body/head intersects shared floor-plan solid');
  if (support) {
    if (support.floor !== data.expectedFloor) fail('Shared support reaches a different floor from the waypoint', { supportFloor: support.floor, expectedFloor: data.expectedFloor });
    if (!access.canAccessFloor(b, support.floor, player) || support.link && !access.canAccessFloor(b, support.link.toFloor, player)) fail('Actual support lacks original floor permission');
    if (!support.link && Math.abs(support.y - (b.position.y + .6 + plan.y)) > 1e-7) fail('Fixture-top support outside planned bed-side floor scope');
    return { kind: support.kind, y: support.y, floor: support.floor, support, source: 'floorPlanSupport(actualFeet,.35)',
      queryFeet: feet, bodyRadius: .35, eyeHeight: 1.72, voxelCount: 0, sourcePriority: 'Full body floor support is first, exactly as controller', selectedPlanHeadClear: true };
  }
  // Do not disguise controller's exceptional partial-footprint cases as full support.
  if (doorEdge && center) fail('Door-edge partial disk requires the exact controller exception; this endpoint oracle rejects it');
  if (center?.kind === 'courtyard' || center?.kind === 'gallery') fail('Ground-edge slab+terrain disk union not covered by this endpoint oracle');
  if (roof) fail('Roof support outside ground-home scope');
  if (data.insideId || data.supportingSiteId) fail('Remembered body owner has no full support at these actual feet');
  if (selectedFloor !== 0 || center) fail('No ground exterior fallback over a floor/shaft/body center');
  // Other overlapping bodies cannot silently supply a radius0 world height.
  for (const other of world.buildings) {
    if (other.id === b.id) continue;
    const c = Math.abs(Math.cos(other.rotation)), s = Math.abs(Math.sin(other.rotation));
    const halfWidth = (other.width * c + other.depth * s) / 2 + .35;
    const halfDepth = (other.width * s + other.depth * c) / 2 + .35;
    if (Math.abs(feet.x-other.position.x) <= halfWidth && Math.abs(feet.z-other.position.z) <= halfDepth)
      fail('Other body envelope may own exterior support; conservative rejection, never AABB admission', { otherSiteId: other.id });
  }
  // A conservative transport exclusion only rejects unsupported bridge/rail queries.
  // It does not approve or rebuild any road/deck geometry.
  for (const edge of world.edges) if (edge.mode !== 'road') for (let i=1; i<edge.points.length; i++) {
    const a=edge.points[i-1], z=edge.points[i], dx=z.x-a.x, dz=z.z-a.z;
    const t=Math.max(0,Math.min(1,((feet.x-a.x)*dx+(feet.z-a.z)*dz)/(dx*dx+dz*dz||1)));
    if (Math.hypot(feet.x-a.x-dx*t,feet.z-a.z-dz*t) <= 6 && Math.abs(feet.y-a.y-(z.y-a.y)*t) <= 1.1)
      fail('Non-road transport deck support outside this ground-home scope', { edgeId: edge.id, mode: edge.mode });
  }
  const y = worldAPI.getWalkHeight(world, feet.x, feet.z, feet.y);
  if (!Number.isFinite(y)) fail('Nonfinite actual-coordinate walking height');
  return { kind: 'ground-or-road', y, floor: 0, source: 'getWalkHeight(actualX,actualZ,actualFootY)', queryFeet: feet,
    bodyRadius: .35, eyeHeight: 1.72, voxelCount: 0,
    sourcePriority: 'Full floor/door-edge/ground-edge/roof/other-body cases checked first; unsupported exceptions rejected',
    selectedPlanHeadClear: true, targetHeightUsed: false, note: 'Matches existing exterior road/terrain height authority; does not claim a bridge/roof/modified-ground support contract' };
}

if (input.operation === 'supportActual') {
  console.log(JSON.stringify(queryActualSupport(input)));
} else if (input.operation === 'assemble') {
  const partition = await import(pathToFileURL(resolve(source, 'src/persistence/partition.ts')).href);
  console.log(JSON.stringify({ json: partition.assembleSave(input.parts) }));
} else if (input.operation === 'route') {
  const route = provider.findFloorPlanRoute(input.building, 0, input.from, input.to, .35);
  if (!route) throw Error('No authoritative floor-zero route between actual feet and target');
  console.log(JSON.stringify({ points: route, metres: routeLength(route), purpose: 'Read-only physical planning; these points are not movement evidence' }));
} else if (input.operation === 'plan') {
  const b = input.world.buildings.find(b => b.id === input.buildingId);
  if (!b || b.kind !== 'home' || !provider.getBuildingBody(b)) throw Error('Selected actual world has no marked v4 home');
  if (!access.canAccessFloor(b, 0, input.player)) throw Error('Actual player cannot access the selected ground floor');
  const floor = provider.getBuildingFloorPlan(b, 0), entrance = provider.getBuildingEntrance(b);
  const localEntrance = provider.buildingLocalPosition(b, entrance);
  const point = offset => {
    const p = provider.buildingWorldPosition(b, { x: localEntrance.x, y: floor.y, z: localEntrance.z + offset });
    p.y = worldAPI.getWalkHeight(input.world, p.x, p.z, entrance.y);
    return p;
  };
  const stage = point(3.2), approach = point(1.2);
  const stageSupport = provider.floorPlanSupport(b, 0, stage, .35);
  if (stageSupport && ['room', 'stairs'].includes(stageSupport.kind)) throw Error('Controlled starting point is not outside the home');
  const expectedDoorExit = provider.buildingWorldPosition(b, { x: localEntrance.x, y: floor.y, z: localEntrance.z - 2 });
  const sides = rest.homeRestPoints(b, 0);
  const services = provider.getFloorPlanUsePoints(b, 0).filter(p => p.purpose === 'service'
    && provider.floorPlanSupport(b, 0, p.position, .35)?.kind === 'room'
    && sides.every(side => distance(side.position, p.position) > 1));
  const choices = [];
  for (const service of services) for (const side of sides) {
    const toService = provider.findFloorPlanRoute(b, 0, expectedDoorExit, service.position, .35);
    const toBed = provider.findFloorPlanRoute(b, 0, service.position, side.position, .35);
    if (toService && toBed) choices.push({ service, side, toService, toBed, metres: routeLength(toService) + routeLength(toBed) });
  }
  choices.sort((a, b) => a.metres - b.metres || a.side.id.localeCompare(b.side.id));
  const selected = choices[0];
  if (!selected) throw Error('No actual accessible ground-floor service/bed-side pair with a legal shared route');
  console.log(JSON.stringify({ building: b, floor: 0, stage, approach, stageSupport,
    expectedDoorExit, entrance, service: selected.service, bed: selected.side, allGroundRestPoints: sides,
    plannedRouteToService: selected.toService, plannedRouteToBed: selected.toBed,
    staticPlannedMetres: selected.metres, bodyRadius: .35, eyeHeight: 1.72, restPointRadius: .4,
    restFootHeightTolerance: 1e-7, note: 'Static actual source provider planning only; no Simulation, position writes or traversal claim' }));
} else throw Error('Unknown read-only operation');
