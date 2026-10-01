import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld, findPath, getWalkHeight, samplePolyline, terrainHeight } from '../src/world';
import type { Building, NetworkEdge, NetworkNode, TransportMode, Vec3, WorldDefinition } from '../src/types';

const EPSILON = 1e-8;
const world = createWorld();
const generatedWorlds = [world, createWorld(7), createWorld(2024)];
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const near = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: ${actual} != ${expected}`);
const lattice = (n: number, label: string) => near(n / .2, Math.round(n / .2), `${label} is on the 0.2 m voxel lattice`);
const samePoint = (actual: Vec3, expected: Vec3, label: string) => {
  for (const axis of ['x', 'y', 'z'] as const) near(actual[axis], expected[axis], `${label}.${axis}`);
};

/** Segment clipping against the open footprint: touching an entrance/wall is legal. */
function crossesInterior(a: Vec3, b: Vec3, building: Building): boolean {
  let start = 0, end = 1;
  for (const [axis, halfExtent] of [['x', building.width / 2], ['z', building.depth / 2]] as const) {
    const min = building.position[axis] - halfExtent + EPSILON;
    const max = building.position[axis] + halfExtent - EPSILON;
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPSILON) {
      if (a[axis] < min || a[axis] > max) return false;
    } else {
      const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
      start = Math.max(start, Math.min(t1, t2));
      end = Math.min(end, Math.max(t1, t2));
      if (start > end) return false;
    }
  }
  return start <= end;
}

test('seeded city generation preserves scale, distinct districts, and deterministic variation', () => {
  assert.deepEqual(createWorld(world.seed), world);
  assert.notDeepEqual(createWorld(7).buildings, world.buildings);
  assert.equal(world.size, 4400);
  assert.equal(world.voxelSize, .2);
  assert.equal(world.districts.length, 11);
  assert.equal(new Set(world.districts.map(d => d.id)).size, 11);
  assert.ok(world.buildings.length >= 220);
  assert.ok(new Set(world.districts.map(d => d.center.y)).size >= 8, 'districts occupy multiple mountain elevations');
  for (const district of world.districts) {
    assert.ok(world.buildings.some(b => b.districtId === district.id), `${district.id} contains buildings`);
    assert.ok(world.nodes.some(n => n.districtId === district.id && n.station), `${district.id} has a station`);
  }
  assert.equal(world.waterfall.top.x, world.waterfall.bottom.x);
  assert.ok(world.waterfall.top.y - world.waterfall.bottom.y >= 100);
  samePoint(world.river[0], world.waterfall.bottom, 'river begins at waterfall plunge pool');
  assert.ok(world.buildings.some(b => b.kind === 'core'));
  assert.ok(world.buildings.some(b => b.kind === 'pavilion' && b.districtId === 'summit'));
  assert.ok(world.buildings.some(b => b.kind === 'airport'));
  assert.ok(world.buildings.some(b => b.kind === 'starport'));
});

test('all generated assets use voxel units and have usable floors and south-facing doors', () => {
  for (const generated of generatedWorlds) {
    assert.equal(new Set(generated.buildings.map(b => b.id)).size, generated.buildings.length);
    for (const b of generated.buildings) {
      assert.ok(Number.isInteger(b.floors) && b.floors >= 1, `${b.id} has positive integral floors`);
      assert.ok(b.width > 0 && b.depth > 0 && b.height >= b.floors * 3.4 - EPSILON, `${b.id} has usable internal floor dimensions`);
      assert.ok(b.capacity > 0, `${b.id} has usable capacity`);
      assert.equal(b.rotation, 0, `${b.id} matches its axis-aligned entrance`);
      for (const [label, n] of Object.entries({ x: b.position.x, y: b.position.y, z: b.position.z, width: b.width, depth: b.depth, height: b.height, doorX: b.door.x, doorY: b.door.y, doorZ: b.door.z })) lattice(n, `${generated.seed}:${b.id}.${label}`);
      lattice(b.height / b.floors, `${generated.seed}:${b.id}.floorSpacing`);
      near(b.door.x, b.position.x, `${b.id} entrance centered on south wall`);
      near(b.door.z, b.position.z + b.depth / 2, `${b.id} entrance touches exact south wall`);
      near(b.door.y, b.position.y + .6, `${b.id} entrance is level with its interior floor`);
    }
    for (const edge of generated.edges) for (const point of edge.points) for (const axis of ['x', 'y', 'z'] as const) lattice(point[axis], `${generated.seed}:${edge.id}.${axis}`);
  }
});

test('building footprints never overlap, including generated landmarks', () => {
  for (const generated of generatedWorlds) for (let i = 0; i < generated.buildings.length; i++) for (let j = i + 1; j < generated.buildings.length; j++) {
    const a = generated.buildings[i], b = generated.buildings[j];
    const overlapX = Math.abs(a.position.x - b.position.x) < (a.width + b.width) / 2 - EPSILON;
    const overlapZ = Math.abs(a.position.z - b.position.z) < (a.depth + b.depth) / 2 - EPSILON;
    assert.ok(!(overlapX && overlapZ), `${generated.seed}: ${a.id} overlaps ${b.id}`);
  }
});

test('every building footprint has a level terrain foundation and accessible interior floor', () => {
  for (const generated of generatedWorlds) for (const b of generated.buildings) {
    for (const [offsetX, offsetZ] of [[0, 0], [-.48, -.48], [.48, -.48], [-.48, .48], [.48, .48]]) {
      const x = b.position.x + b.width * offsetX, z = b.position.z + b.depth * offsetZ;
      const insideBasement = (b.basements ?? 0) > 0 && Math.abs(x - b.position.x) < b.width / 2 - .8 && Math.abs(z - b.position.z) < b.depth / 2 - .8;
      const ground = insideBasement ? b.position.y - b.basements! * b.height / b.floors - .6 : b.position.y;
      near(terrainHeight(generated, x, z), ground, `${generated.seed}:${b.id} foundation or excavated basement`);
      near(getWalkHeight(generated, x, z), b.position.y + .6, `${generated.seed}:${b.id} interior floor`);
    }
    near(getWalkHeight(generated, b.door.x, b.door.z), b.door.y, `${generated.seed}:${b.id} entrance floor`);
  }
});

test('ground transport avoids every building interior and keeps grades walkable after voxel rounding', () => {
  for (const generated of generatedWorlds) for (const edge of generated.edges.filter(e => e.mode === 'road' || e.mode === 'bridge')) {
    assert.ok(edge.points.length >= 2, `${edge.id} has a traversable polyline`);
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i];
      const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
      assert.ok(horizontal > EPSILON, `${generated.seed}:${edge.id} segment ${i} has nonzero horizontal length`);
      assert.ok(Math.abs(b.y - a.y) <= horizontal * .25 + EPSILON, `${generated.seed}:${edge.id} segment ${i} exceeds 25% grade: ${Math.abs(b.y - a.y) / horizontal}`);
      for (const building of generated.buildings) assert.ok(!crossesInterior(a, b, building), `${generated.seed}:${edge.id} segment ${i} crosses ${building.id}`);
    }
  }
});

test('elevated rail, cable, and flight routes clear buildings and terrain along every segment', () => {
  const failures = new Map<string, { seed: number; edge: string; segment: number; position: Vec3; obstacle: string; depth: number }>();
  const elevatedModes: TransportMode[] = ['maglev', 'lightRail', 'cable', 'flight'];
  for (const generated of generatedWorlds) for (const edge of generated.edges.filter(e => elevatedModes.includes(e.mode))) {
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i];
      const steps = Math.max(1, Math.ceil(distance(a, b) / 4));
      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
        for (const building of generated.buildings) {
          if (Math.abs(point.x - building.position.x) < building.width / 2 - EPSILON && Math.abs(point.z - building.position.z) < building.depth / 2 - EPSILON && point.y > building.position.y + EPSILON && point.y < building.position.y + building.height - EPSILON) {
            const key = `${generated.seed}:${edge.id}:${building.id}`;
            if (!failures.has(key)) failures.set(key, { seed: generated.seed, edge: edge.id, segment: i, position: point, obstacle: building.id, depth: building.position.y + building.height - point.y });
          }
        }
        const terrain = terrainHeight(generated, point.x, point.z);
        if (point.y < terrain - 2 - EPSILON) {
          const key = `${generated.seed}:${edge.id}:terrain`;
          if (!failures.has(key)) failures.set(key, { seed: generated.seed, edge: edge.id, segment: i, position: point, obstacle: 'terrain', depth: terrain - point.y });
        }
      }
    }
  }
  assert.deepEqual([...failures.values()], [], 'elevated transport never clips through a building body or runs more than 2 m under terrain; depth is measured below roof/terrain');
});

test('all entrances attach exactly to the road graph and every district is connected', () => {
  const expectedModes: TransportMode[] = ['road', 'maglev', 'lightRail', 'cable', 'lift', 'ferry', 'bridge', 'flight'];
  assert.deepEqual([...new Set(world.edges.map(e => e.mode))].sort(), expectedModes.sort());
  assert.equal(new Set(world.nodes.map(n => n.id)).size, world.nodes.length);
  assert.equal(new Set(world.edges.map(e => e.id)).size, world.edges.length);
  const nodeMap = new Map(world.nodes.map(n => [n.id, n]));
  const neighbors = new Map(world.nodes.map(n => [n.id, [] as string[]]));
  for (const edge of world.edges) {
    assert.ok(nodeMap.has(edge.from) && nodeMap.has(edge.to), `${edge.id} refers to existing graph nodes`);
    samePoint(edge.points[0], nodeMap.get(edge.from)!.position, `${edge.id} starts at its node`);
    samePoint(edge.points[edge.points.length - 1], nodeMap.get(edge.to)!.position, `${edge.id} ends at its node`);
    near(edge.length, edge.points.slice(1).reduce((sum, p, i) => sum + distance(edge.points[i], p), 0), `${edge.id} has arc-length weight`);
    assert.ok(edge.length > 0 && edge.capacity > 0, `${edge.id} has positive transport weight/capacity`);
    neighbors.get(edge.from)!.push(edge.to);
    neighbors.get(edge.to)!.push(edge.from);
  }
  const visited = new Set<string>();
  const queue = [world.nodes[0].id];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...neighbors.get(id)!.filter(next => !visited.has(next)));
  }
  assert.equal(visited.size, world.nodes.length, 'the entire multimodal graph is one connected city');
  for (const b of world.buildings) {
    const door = nodeMap.get(`${b.id}-door`);
    assert.ok(door, `${b.id} has a graph entrance`);
    samePoint(door.position, b.door, `${b.id} graph entrance meets its physical door`);
    const route = findPath(world, door.id, `${b.districtId}-station`, 'road');
    assert.ok(route.length >= 2, `${b.id} has a road route to its district station`);
    assert.equal(route[0].id, door.id);
    assert.equal(route[route.length - 1].id, `${b.districtId}-station`);
  }
});

test('the Tianshu landmark has usable public areas, distinct civic wings, and lower service buildings', () => {
  const main = world.buildings.find(b => b.id === 'core-main');
  assert.ok(main);
  assert.equal(main.name, '天枢阁');
  assert.equal(main.kind, 'core');
  assert.equal(main.facility, 'mayor');
  assert.ok(main.width >= 144 && main.depth >= 112, 'the civic landmark has its actual monumental footprint');
  assert.ok(main.height >= 220 && main.height <= 245, 'the landmark scale is represented in world geometry');
  assert.ok(main.height / main.floors >= 4 && main.height / main.floors <= 8.5, 'usable civic floors have credible ceiling heights');
  const wings = [
    { id: 'core-admin-east', facility: 'administration', axis: 'x', direction: 1 },
    { id: 'core-data-west', facility: 'data', axis: 'x', direction: -1 },
    { id: 'core-energy-south', facility: 'energy', axis: 'z', direction: 1 },
    { id: 'core-security-north', facility: 'emergency', axis: 'z', direction: -1 },
  ] as const;
  for (const wing of wings) {
    const building = world.buildings.find(b => b.id === wing.id);
    assert.ok(building, `${wing.id} is a real building`);
    assert.equal(building.facility, wing.facility);
    assert.ok((building.position[wing.axis] - main.position[wing.axis]) * wing.direction > 0, `${wing.id} is on its designated side of 天枢阁`);
    near(building.position.y, main.position.y, `${wing.id} shares the main civic terrace`);
    assert.ok(building.width >= 60 && building.depth >= 42 && building.height >= 40, `${wing.id} has a substantial usable palace wing`);
  }
  const facilities = new Set(world.buildings.filter(b => b.districtId === 'core').map(b => b.facility));
  for (const facility of ['mayor', 'council', 'administration', 'data', 'energy', 'emergency', 'embassy', 'archives', 'treasury']) assert.ok(facilities.has(facility as Building['facility']), `${facility} exists in the civic complex`);
  for (const b of world.buildings.filter(b => b.facility)) {
    assert.ok(Number.isInteger(b.publicFloors) && b.publicFloors! > 0 && b.publicFloors! <= b.floors, `${b.id} exposes usable public floors`);
    assert.ok(b.requiredPermission, `${b.id} declares restricted-area permission`);
  }
  for (const id of ['core-archives', 'core-treasury']) {
    const building = world.buildings.find(b => b.id === id);
    assert.ok(building);
    assert.ok(building.position.y < main.position.y, `${id} occupies the lower service terrace`);
  }
});

test('the expanded city has connected purpose-built neighbourhoods and leaves open mountain land', () => {
  assert.ok(world.buildings.length >= 600 && world.buildings.length <= 700, 'the city contains actual usable buildings at the requested scale');
  const quarters = world.nodes.filter(n => n.id.includes('-quarter-'));
  assert.equal(quarters.length, 44, 'eleven districts each contain four distinct local stops');
  for (const district of world.districts) {
    const local = quarters.filter(n => n.districtId === district.id);
    assert.equal(local.length, 4);
    assert.ok(world.buildings.filter(b => b.districtId === district.id).length >= 24, `${district.name} has a real settlement`);
    for (const stop of local) assert.ok(findPath(world, stop.id, `${district.id}-station`, 'road').length >= 2, `${stop.name} connects to its district trunk`);
  }
  const homes = world.buildings.filter(b => b.kind === 'home');
  assert.ok(homes.length >= 150);
  assert.ok(homes.some(b => b.floors <= 4) && homes.some(b => b.floors >= 12), 'courtyard homes and tall mountain residences serve different households');
  assert.ok(world.buildings.filter(b => b.height >= 40).length >= world.buildings.length * .2, 'the broader city has a layered skyline beyond a single landmark');
  const footprintArea = world.buildings.reduce((area, b) => area + b.width * b.depth, 0);
  assert.ok(footprintArea < world.size ** 2 * .15, 'water, woods and mountain land remain open between buildings');
});

test('Tianshu has excavated usable underground archives and treasury beneath its actual main hall', () => {
  const main = world.buildings.find(b => b.id === 'core-main')!;
  assert.equal(main.basements, 2);
  assert.equal(main.basementUses?.length, 2);
  assert.match(main.basementUses![0], /档案/);
  assert.match(main.basementUses![1], /金库/);
  assert.equal(main.floorUses?.length, main.floors);
  assert.equal(main.floorPermissions?.length, main.floors);
  assert.match(main.floorUses![main.floors - 1], /观景/);
  assert.equal(main.floorPermissions![main.floors - 1], 'public');
  for (let floor = -2; floor < main.floors; floor++) {
    const level = main.position.y + .6 + floor * main.height / main.floors;
    near(getWalkHeight(world, main.position.x, main.position.z, level), level, `main hall floor ${floor} is usable at its real height`);
  }
  const basementFloor = main.position.y + .6 - 2 * main.height / main.floors;
  assert.ok(terrainHeight(world, main.position.x, main.position.z) < basementFloor, 'mountain earth has actually been removed below the basement floor');
  near(terrainHeight(world, main.position.x + main.width / 2, main.position.z), main.position.y, 'the cutout retains the supporting foundation rim');
  near(getWalkHeight(world, main.door.x, main.door.z), main.position.y + .6, 'the street entrance still lands on the public ground floor');
});

test('ordinary buildings fit their mountain shoulders rather than tall artificial pedestals', () => {
  for (const generated of generatedWorlds) {
    const land = { ...generated, buildings: [], edges: [] };
    for (const b of generated.buildings) {
      if (b.districtId === 'core' && !b.id.startsWith('core-b')) continue;
      const originalGround = terrainHeight(land, b.position.x, b.position.z);
      assert.ok(b.position.y <= originalGround + 14.1 && b.position.y >= originalGround - 8.1, `${generated.seed}:${b.id} terrace follows its actual mountain shoulder (${b.position.y - originalGround} m change)`);
    }
  }
});

test('Tianshu has five real shrinking floor footprints and full-size basement space', () => {
  const main = world.buildings.find(b => b.id === 'core-main')!;
  const floorFootprints = (main as Building & { floorFootprints: { width: number; depth: number }[] }).floorFootprints;
  assert.equal(floorFootprints.length, main.floors);
  const terraces = [[144, 112], [126, 98], [108, 84], [90, 70], [72, 56]];
  for (let floor = 0; floor < main.floors; floor++) {
    const dimensions = floorFootprints[floor];
    assert.deepEqual([dimensions.width, dimensions.depth], terraces[Math.floor(floor / 6)], `floor ${floor} has its actual palace-tier footprint`);
    lattice(dimensions.width, `floor ${floor} width`); lattice(dimensions.depth, `floor ${floor} depth`);
    assert.ok(dimensions.width <= main.width && dimensions.depth <= main.depth);
    assert.ok(dimensions.width >= 72 && dimensions.depth >= 56, 'all upper civic rooms and fixed stair core remain usable');
  }
  assert.equal(main.width, 144); assert.equal(main.depth, 112);
  assert.equal(main.basements, 2);
  const observationFloor = main.position.y + .6 + (main.floors - 1) * main.height / main.floors;
  const outsideTop = getWalkHeight(world, main.position.x + 50, main.position.z, observationFloor);
  assert.notEqual(outsideTop, observationFloor, 'the narrower upper palace does not create an invisible walkable floor over the lower wings');
});

test('vertical transport reaches the cliff and waterfall ferries link both lower city docks', () => {
  const lift = world.edges.find(e => e.mode === 'lift');
  assert.ok(lift);
  samePoint({ ...lift.points[0], y: 0 }, { ...lift.points[lift.points.length - 1], y: 0 }, 'lift has a vertical shaft');
  assert.ok(Math.abs(lift.points[0].y - lift.points[lift.points.length - 1].y) >= 150);
  assert.ok(findPath(world, lift.from, 'core-station').length >= 2, 'cliff-base station reaches the civic terrace');
  assert.deepEqual(findPath(world, 'core-dock', 'market-dock', 'ferry').map(n => n.id), ['core-dock', 'market-dock']);
  assert.deepEqual(findPath(world, 'core-dock', 'river-dock', 'ferry').map(n => n.id), ['core-dock', 'market-dock', 'river-dock']);
  const dockBuilding = world.buildings.find(b => b.id === 'core-dock-building');
  assert.ok(dockBuilding);
  assert.ok(dockBuilding.position.y < world.waterfall.top.y - 100, 'waterfall dock is on the lower river terrace');
  assert.ok(findPath(world, `${dockBuilding.id}-door`, 'core-dock').length >= 2, 'walkable building entrance reaches the ferry station');
});

test('the airport runway is a connected flat ground strip shared by departing flights', () => {
  const runway = world.edges.find(e => e.id === 'road-airport-runway-strip');
  assert.ok(runway);
  assert.ok(runway.length >= 800);
  assert.equal(runway.points.length, 2, 'the physical runway is a straight strip');
  near(runway.points[0].y, runway.points[1].y, 'runway is level');
  near(runway.points[0].z, runway.points[1].z, 'runway has no corner');
  assert.ok(findPath(world, runway.from, 'airport-station', 'road').length >= 2);
  const halfway = samplePolyline(runway.points, .5);
  near(getWalkHeight(world, halfway.x, halfway.z), halfway.y, 'runway ground agrees with transport deck');
  const naturalLand = { ...world, buildings: [], edges: [] };
  for (let i = 0; i <= 10; i++) {
    const point = samplePolyline(runway.points, i / 10);
    near(terrainHeight(world, point.x, point.z), point.y - .6, `runway ${i} has a continuous real land foundation`);
    assert.ok(point.y - .6 - terrainHeight(naturalLand, point.x, point.z) <= 12.2, 'the runway follows its actual valley instead of a sixty-metre artificial platform');
  }
  const flights = world.edges.filter(e => e.mode === 'flight' && e.from === runway.from);
  assert.ok(flights.length >= 2, 'scheduled flights connect the runway to multiple destinations');
  for (const flight of flights) {
    samePoint(flight.points[0], runway.points[0], `${flight.id} starts at the runway threshold`);
    samePoint(flight.points[1], runway.points[1], `${flight.id} uses the actual takeoff roll`);
    assert.ok(flight.points.slice(2).some(p => p.y > runway.points[0].y + 100), `${flight.id} climbs into an air lane`);
  }
});

test('cross-valley carriageways preserve the landscape below their supported bridge decks', () => {
  const land = { ...world, edges: [] };
  const spans = world.edges.filter(e => e.mode === 'road').flatMap(e => e.points.filter(p => p.y - .6 - terrainHeight(land, p.x, p.z) > 40));
  assert.ok(spans.length > 0, 'the mountain road network really crosses open valleys');
  assert.ok(spans.every(point => terrainHeight(world, point.x, point.z) < point.y - 12), 'high bridges keep their natural valley floor instead of filling it with walls of terrain');
});

function graphFixture(): WorldDefinition {
  const nodes: NetworkNode[] = ['a', 'b', 'c', 'd', 'isolated'].map((id, i) => ({ id, districtId: 'test', name: id, position: { x: i, y: 0, z: 0 }, station: true }));
  const edge = (from: string, to: string, mode: TransportMode, length: number): NetworkEdge => ({ id: `${from}-${to}-${mode}`, from, to, mode, length, capacity: 10, points: [nodes.find(n => n.id === from)!.position, nodes.find(n => n.id === to)!.position] });
  return { ...world, nodes, edges: [edge('a', 'd', 'road', 20), edge('a', 'b', 'road', 2), edge('b', 'c', 'road', 2), edge('c', 'd', 'road', 2), edge('a', 'd', 'maglev', 1)] };
}

test('Dijkstra chooses total travel weight, respects modes, and supports bidirectional links', () => {
  const fixture = graphFixture();
  assert.deepEqual(findPath(fixture, 'a', 'd').map(n => n.id), ['a', 'd']);
  assert.deepEqual(findPath(fixture, 'a', 'd', 'road').map(n => n.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(findPath(fixture, 'd', 'a', 'road').map(n => n.id), ['d', 'c', 'b', 'a']);
  assert.deepEqual(findPath(fixture, 'a', 'd', 'maglev').map(n => n.id), ['a', 'd']);
  assert.deepEqual(findPath(fixture, 'a', 'd', 'ferry'), []);
  assert.deepEqual(findPath(fixture, 'a', 'isolated'), []);
  assert.deepEqual(findPath(fixture, 'missing', 'a'), []);
  assert.deepEqual(findPath(fixture, 'a', 'missing'), []);
  assert.deepEqual(findPath(fixture, 'missing', 'missing'), []);
  assert.deepEqual(findPath(fixture, 'a', 'a').map(n => n.id), ['a']);
});

test('polyline sampling uses 3D arc length, clamps endpoints, and handles degenerate paths', () => {
  const points = [{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: 15 }];
  samePoint(samplePolyline(points, .125), { x: 1.5, y: 2, z: 0 }, 'halfway along the first 5 m section');
  samePoint(samplePolyline(points, .25), points[1], 'first section ends at 25% of 20 m path');
  samePoint(samplePolyline(points, .5), { x: 3, y: 4, z: 5 }, 'halfway uses distance instead of point index');
  samePoint(samplePolyline(points, -5), points[0], 'negative progress clamps to start');
  samePoint(samplePolyline(points, 5), points[2], 'excess progress clamps to end');
  samePoint(samplePolyline([], .5), { x: 0, y: 0, z: 0 }, 'empty path');
  samePoint(samplePolyline([points[1]], .5), points[1], 'single point path');
  samePoint(samplePolyline([points[0], points[0], points[1]], .5), { x: 1.5, y: 2, z: 0 }, 'zero-length segment');
  samePoint(samplePolyline([points[1], points[1]], .5), points[1], 'zero-length polyline');
  const result = samplePolyline(points, 0);
  result.x = 100;
  assert.equal(points[0].x, 0, 'sampling returns a value without mutating input points');
});

test('walking heights choose road and bridge decks using the player elevation at crossings', () => {
  const points = (y: number): Vec3[] => [{ x: -20, y, z: 0 }, { x: 20, y, z: 0 }];
  const deck = (id: string, mode: TransportMode, y: number): NetworkEdge => ({ id, from: 'a', to: 'b', mode, length: 40, capacity: 10, points: points(y) });
  const fixture: WorldDefinition = { ...world, buildings: [], edges: [deck('low-road', 'road', 10), deck('high-bridge', 'bridge', 30)] };
  near(getWalkHeight(fixture, 0, 0, 10), 10, 'walking at road elevation stays on road');
  near(getWalkHeight(fixture, 0, 0, 30), 30, 'walking at bridge elevation stays on bridge');
  near(getWalkHeight(fixture, 0, 4.5, 30), 10, 'bridge width does not extend to the neighboring road verge');
  near(getWalkHeight(fixture, 150, 0), terrainHeight(fixture, 150, 0), 'off-network walking follows terrain');
});
