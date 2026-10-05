import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { decodeCitizenRoutes, encodeCitizenRoutes, ROUTE_POOL_PAGE_SIZE } from '../src/persistence/route-encoding.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { Simulation } from '../src/simulation.ts';
import { createWorld, samplePolyline } from '../src/world.ts';
import type { Vec3 } from '../src/types.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function oldEncode(source: { route?: Vec3[] }[]) {
  const routePool: Vec3[] = [], ids = new Map<string, number>();
  const citizens = source.map(citizen => ({ ...citizen, route: citizen.route?.map(point => {
    const key = `${point.x},${point.y},${point.z}`;
    let id = ids.get(key);
    if (id === undefined) { id = routePool.length; ids.set(key, id); routePool.push(point); }
    return id;
  }) }));
  return { citizens, routeEncoding: 'pooled-v1', routePool };
}
function uniqueRoutes(count: number) {
  return Array.from({ length: Math.ceil(count / 1024) }, (_, actor) => ({
    route: Array.from({ length: Math.min(1024, count - actor * 1024) }, (_, step) => ({ x: actor, y: step * .2, z: actor * 1024 + step })),
  }));
}

test('the original pooled route bytes stay exact at the unchanged 32768-point boundary', () => {
  for (const count of [0, 1, 1024, ROUTE_POOL_PAGE_SIZE]) {
    const source = uniqueRoutes(count);
    source.push({ route: source[0]?.route?.slice() ?? [] });
    const before = JSON.stringify(source), encoded = encodeCitizenRoutes(source);
    assert.equal(JSON.stringify(encoded), JSON.stringify(oldEncode(source)));
    assert.equal(JSON.stringify(source), before, 'encoding must not edit live actor routes');
    const candidate = JSON.parse(JSON.stringify(encoded));
    decodeCitizenRoutes(candidate.routeEncoding, candidate.routePool, candidate.citizens);
    assert.deepEqual(candidate.citizens, source);
  }
});

test('a second route page preserves every exact coordinate and bounded actor route', () => {
  const source = uniqueRoutes(ROUTE_POOL_PAGE_SIZE + 1), encoded = encodeCitizenRoutes(source);
  assert.equal(encoded.routeEncoding, 'paged-v1');
  assert.deepEqual(encoded.routePool.map(page => (page as Vec3[]).length), [32768, 1]);
  assert(encoded.citizens.every(citizen => citizen.route!.length <= 1024));
  const candidate = JSON.parse(JSON.stringify(encoded));
  decodeCitizenRoutes(candidate.routeEncoding, candidate.routePool, candidate.citizens);
  assert.deepEqual(candidate.citizens, source, 'the extra point cannot be pruned, rounded or replaced');
  assert.equal(JSON.stringify(encodeCitizenRoutes(candidate.citizens)), JSON.stringify(encoded));
});

test('paged routes reject malformed pages, indices, points and actor or route capacity', async t => {
  const encoded = encodeCitizenRoutes(uniqueRoutes(ROUTE_POOL_PAGE_SIZE + 1));
  const cases: [string, (value: any) => void][] = [
    ['unknown encoding', value => { value.routeEncoding = 'paged-v999'; }],
    ['33 pages exceeds actor-route capacity', value => { value.routePool = Array(33).fill([]); }],
    ['oversize page', value => { value.routePool[0].push(value.routePool[0][0]); }],
    ['nonfinal page hole', value => { value.routePool[0].pop(); }],
    ['empty final page', value => { value.routePool[1] = []; }],
    ['nonarray page', value => { value.routePool[1] = {}; }],
    ['duplicate coordinates', value => { value.routePool[1][0] = { ...value.routePool[0][0] }; }],
    ['invalid point', value => { value.routePool[1][0].x = null; }],
    ['negative index', value => { value.citizens[0].route[0] = -1; }],
    ['fractional index', value => { value.citizens[0].route[0] = .5; }],
    ['out of bounds index', value => { value.citizens[0].route[0] = 32769; }],
    ['string index', value => { value.citizens[0].route[0] = '0'; }],
    ['noncanonical first reference', value => { value.citizens[0].route[0] = 1; value.citizens[0].route[1] = 0; }],
    ['unreferenced point', value => { value.citizens.at(-1).route[0] = 0; }],
    ['point count exceeds route references', value => { value.citizens.at(-1).route = []; }],
    ['1025-point actor route', value => { value.citizens[0].route.push(0); }],
    ['1025 actors', value => { value.citizens = Array(1025).fill({ route: [] }); }],
    ['invalid actor', value => { value.citizens[0] = null; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const value = structuredClone(encoded); mutate(value);
    assert.throws(() => decodeCitizenRoutes(value.routeEncoding, value.routePool, value.citizens), /无效存档字段/);
  });
  const originalPool = oldEncode(uniqueRoutes(ROUTE_POOL_PAGE_SIZE + 1));
  assert.throws(() => decodeCitizenRoutes(originalPool.routeEncoding, originalPool.routePool, originalPool.citizens), /route pool/,
    'the legacy one-page cap remains enforced; only the new explicit encoding adds pages');
  for (const routePool of [[], [[{ x: 0, y: 0, z: 0 }]]]) {
    const citizens = [{ route: routePool.length ? [0] : [] }];
    assert.throws(() => decodeCitizenRoutes('paged-v1', routePool, citizens), /route pool reference capacity/);
  }
});

test('partition assembly rejects a changed generation that would change the original route encoding', () => {
  const make = (routes: { route: Vec3[] }[]) => JSON.stringify({ format: 'yunshan-save', routeEncoding: encodeCitizenRoutes(routes).routeEncoding,
    routePool: encodeCitizenRoutes(routes).routePool, state: { citizens: encodeCitizenRoutes(routes).citizens }, runtime: {} });
  const low = Array.from({ length: 33 }, (_, actor) => ({ route: [{ x: actor, y: 0, z: 0 }] })), high = uniqueRoutes(32769);
  for (const [initial, replacement] of [[low, high], [high, low]]) {
    const parts = partitionSave(make(initial));
    // Explicit malformed-generation fixture: replace only the chunk actor
    // routes, retaining their old global encoding and entity count/order.
    const chunk = parts.find(part => part.id.startsWith('chunk:'))!, body = JSON.parse(chunk.json);
    for (const entry of body.arrays['state.citizens']) entry.value.route = replacement[entry.index].route;
    chunk.json = JSON.stringify(body);
    assert.throws(() => assembleSave(parts), /路线编码与完整代际不匹配/);
  }
  const parts = partitionSave(make(low)), chunk = parts.find(part => part.id.startsWith('chunk:'))!, body = JSON.parse(chunk.json);
  body.arrays['state.citizens'][0].value.route = Array(1025).fill({ x: 0, y: 0, z: 0 }); chunk.json = JSON.stringify(body);
  assert.throws(() => assembleSave(parts), /encoded route/);
});

test('four trusted older layouts preserve the old complete pooled save and partition bytes', () => {
  for (const layout of ['legacy-ee3e7a1', 'current-v2', 'current-v2-r5', 'current-v3'] as const) {
    const world = createWorld(20261001, layout), source = new Simulation(world);
    const saved = source.exportSave(), document = JSON.parse(saved), previous = oldEncode(source.state.citizens);
    assert.equal(document.routeEncoding, 'pooled-v1');
    assert.deepEqual(document.routePool, previous.routePool); assert.deepEqual(document.state.citizens, JSON.parse(JSON.stringify(previous.citizens)));
    assert.equal(assembleSave(partitionSave(saved, world)), saved);
    const restored = new Simulation(world), result = restored.importSave(saved);
    assert(result.ok, result.message); assert.equal(restored.exportSave(), saved);
  }
});

test('a complete city with over 32768 real-road sample points keeps whole and partition saves and identical continuation', t => {
  const world = createWorld(), source = new Simulation(world), roads = world.edges.filter(edge => edge.mode === 'road' && edge.points.length > 1);
  // A codec stress fixture on existing physical road polylines. It does not
  // claim a normal journey, and does not alter cash, roles, needs or clocks.
  for (let actor = 0; actor < 40; actor++) {
    const citizen = source.state.citizens[actor], edge = roads[actor];
    citizen.route = Array.from({ length: 1024 }, (_, step) => samplePolyline(edge.points, step / 1023));
    citizen.routeIndex = 0;
  }
  const saved = source.exportSave(), document = JSON.parse(saved), pointCount = document.routePool.reduce((sum: number, page: Vec3[]) => sum + page.length, 0);
  assert.equal(document.routeEncoding, 'paged-v1'); assert(pointCount > ROUTE_POOL_PAGE_SIZE);
  assert(saved.length < 8_000_000); assert(document.state.citizens.every((citizen: any) => citizen.route === undefined || citizen.route.length <= 1024));
  const previous = { ...document, routeEncoding: 'pooled-v1', routePool: document.routePool.flat() };
  const rejected = new Simulation(world), rejectedBefore = rejected.exportSave(), oldResult = rejected.importSave(JSON.stringify(previous));
  assert.equal(oldResult.ok, false); assert.match(oldResult.message, /route pool/); assert.equal(rejected.exportSave(), rejectedBefore);
  const partitioned = assembleSave(partitionSave(saved, world)); assert.equal(partitioned, saved);
  const restored = new Simulation(world), result = restored.importSave(partitioned);
  assert(result.ok, result.message); assert.equal(restored.exportSave(), saved);
  // Every malformed candidate is rejected before replacing the live city.
  for (const mutate of [
    (value: any) => { value.routePool[0][0].x = 1e30; },
    (value: any) => { value.routePool[0][0].y = null; },
    (value: any) => { value.routePool[0].pop(); },
    (value: any) => { value.state.citizens[0].route.push(0); },
    (value: any) => { value.routeEncoding = 'unknown'; },
    (value: any) => { value.state.citizens[0].route[0] = -1; },
  ]) {
    const candidate = JSON.parse(saved); mutate(candidate);
    const refused = restored.importSave(JSON.stringify(candidate));
    assert.equal(refused.ok, false, 'malformed pages must fail with full live state unchanged'); assert.equal(restored.exportSave(), saved);
  }
  assert.equal(restored.importSave(' '.repeat(8_000_001)).ok, false); assert.equal(restored.exportSave(), saved);
  for (let tick = 0; tick < 24; tick++) { source.step(.25); restored.step(.25); }
  assert.equal(restored.exportSave(), source.exportSave(), 'all city state must continue identically');
  t.diagnostic(JSON.stringify({ encoding: document.routeEncoding, pages: document.routePool.map((page: Vec3[]) => page.length), pointCount,
    actors: document.state.citizens.length, singleRouteLimit: 1024, saveBytes: Buffer.byteLength(saved), beforeSHA256: hash(saved),
    continuedTicks: 24, continuationSHA256: hash(source.exportSave()), originalPoolAtomicRejection: oldResult.message, wholeAndPartitionExact: true }));
});
