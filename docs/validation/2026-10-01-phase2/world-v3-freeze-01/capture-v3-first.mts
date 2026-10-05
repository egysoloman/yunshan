import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

// Both passes import only this immutable coherent02 copy, never live src/.
const sourceRoot = '/tmp/yunshan-r5-native-proof-01';
const archive = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(archive, '../../../../tests/fixtures/world-layout');
const sourceManifest = JSON.parse(await readFile(`${sourceRoot}/source-manifest.json`, 'utf8'));
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const checkSource = async () => {
  assert.equal(sourceManifest.fileCount, 81);
  assert.equal(sourceManifest.sourceHashesStableOnCopy, true);
  assert.deepEqual(sourceManifest.sourceHashesCopy, sourceManifest.sourceHashesBefore);
  const hashes: Record<string, string> = {};
  for (const [path, expected] of Object.entries(sourceManifest.sourceHashesCopy)) {
    hashes[path] = sha(await readFile(`${sourceRoot}/${path}`));
    assert.equal(hashes[path], expected, `frozen source changed: ${path}`);
  }
  assert.equal(Object.keys(hashes).length, 81);
  return hashes;
};
const before = await checkSource();
const worldApi = await import(pathToFileURL(`${sourceRoot}/src/world.ts`).href);
const { createWorld, terrainHeight, naturalTerrainHeight, getWalkHeight, getWaterfallPath, GEOLOGICAL_GEOMETRY_VERSION } = worldApi;
const { savedWorldFingerprint } = await import(pathToFileURL(`${sourceRoot}/src/persistence/world-layout.ts`).href);
const { getFloorDimensions, getStairPosition } = await import(pathToFileURL(`${sourceRoot}/src/access.ts`).href);
type World = ReturnType<typeof createWorld>;
type Point = World['river'][number];
const seeds = [20261001, 7, 2024];
const coordinates = Array.from({ length: 29 }, (_, index) => -2100 + index * 150);

function capture(seed: number) {
  const world = createWorld(seed, 'current-v3');
  assert.equal(world.layoutVersion, 'current-v3');
  assert.equal(world.buildings.length, 612);
  const grid = coordinates.flatMap(z => coordinates.map(x => {
    const ground = terrainHeight(world, x, z);
    return [x, z, naturalTerrainHeight(world, x, z), ground, terrainHeight(world, x, z, false), getWalkHeight(world, x, z), getWalkHeight(world, x, z, ground)];
  }));
  const doors = world.buildings.flatMap(site => {
    const dx = site.door.x - site.position.x, dz = site.door.z - site.position.z, length = Math.hypot(dx, dz);
    assert(length > 0, `${site.id}: door requires an outward direction`);
    return [0, 2.2].map(outside => {
      const x = site.door.x + dx / length * outside, z = site.door.z + dz / length * outside;
      return [site.id, outside, x, site.door.y, z, terrainHeight(world, x, z), terrainHeight(world, x, z, false), getWalkHeight(world, x, z, site.door.y), getWalkHeight(world, x, z), naturalTerrainHeight(world, x, z)];
    });
  });
  let vertices = 0, midpoints = 0, selectedEdges = 0;
  const decks = world.edges.flatMap((edge, edgeIndex) => {
    if (edge.mode !== 'road' && edge.mode !== 'bridge') return [];
    selectedEdges++;
    const row = (p: Point, pointIndex: number) => [edgeIndex, pointIndex, p.x, p.y, p.z, terrainHeight(world, p.x, p.z), getWalkHeight(world, p.x, p.z), getWalkHeight(world, p.x, p.z, p.y), terrainHeight(world, p.x, p.z, false), naturalTerrainHeight(world, p.x, p.z)];
    return edge.points.flatMap((p, pointIndex) => {
      vertices++;
      const rows = [row(p, pointIndex)];
      if (pointIndex > 0) {
        const a = edge.points[pointIndex - 1];
        rows.push(row({ x: (a.x + p.x) / 2, y: (a.y + p.y) / 2, z: (a.z + p.z) / 2 }, pointIndex - .5));
        midpoints++;
      }
      return rows;
    });
  });
  const grades = world.edges.flatMap((edge, edgeIndex) => edge.mode === 'road' || edge.mode === 'bridge' ? edge.points.slice(1).map((p, index) => {
    const a = edge.points[index], horizontal = Math.hypot(p.x - a.x, p.z - a.z);
    assert(horizontal > 0, `${edge.id}:${index + 1}: zero horizontal segment`);
    return [edgeIndex, index + 1, Math.abs(p.y - a.y) / horizontal];
  }) : []);
  const core = world.buildings.find(site => site.id === 'core-main')!;
  assert.equal(core.basements, 2); assert.equal(core.floors, 30);
  const floorDetails = Array.from({ length: 32 }, (_, index) => index - 2).map(floor => ({ floor, dimensions: getFloorDimensions(core, floor), stair: getStairPosition(core, floor) }));
  const floors = floorDetails.flatMap(({ floor }) => {
    const y = core.position.y + .6 + floor * core.height / core.floors;
    return [0, 50].map(dx => {
      const x = core.position.x + dx, z = core.position.z;
      return [floor, x, y, z, getWalkHeight(world, x, z, y), terrainHeight(world, x, z), terrainHeight(world, x, z, false), getWalkHeight(world, x, z)];
    });
  });
  const waterfallPath = getWaterfallPath(world);
  const water = [...world.river, ...waterfallPath].map(p => [p.x, p.y, p.z, terrainHeight(world, p.x, p.z), getWalkHeight(world, p.x, p.z), getWalkHeight(world, p.x, p.z, p.y), terrainHeight(world, p.x, p.z, false), naturalTerrainHeight(world, p.x, p.z)]);
  // Exact code-owned terrain descriptor used by the frozen savedWorldFingerprint.
  const terrainDescriptor = {
    algorithm: GEOLOGICAL_GEOMETRY_VERSION,
    voxelSize: world.voxelSize, size: world.size, mountains: world.mountains,
    districts: world.districts.map(district => [district.id, district.center, district.radius]),
    waterfall: world.waterfall, river: world.river,
    buildingPhysics: world.buildings.map(site => [site.id, site.rotation, site.floors, site.basements]),
  };
  const fingerprint = savedWorldFingerprint(world);
  assert.notEqual(fingerprint, savedWorldFingerprint(createWorld(seed, 'current-v2')));
  const counts = { buildings: world.buildings.length, nodes: world.nodes.length, edges: world.edges.length, sampledRoadBridgeEdges: selectedEdges, gridSamples: grid.length, doorSamples: doors.length, deckVertices: vertices, deckMidpoints: midpoints, deckSamples: decks.length, gradeSamples: grades.length, floorSamples: floors.length, riverPoints: world.river.length, waterfallPoints: waterfallPath.length, waterSamples: water.length };
  assert.equal(grid.length, 841); assert.equal(doors.length, 1224); assert.equal(floors.length, 64);
  assert.equal(midpoints, grades.length); assert.equal(decks.length, vertices + midpoints);
  for (const [name, rows] of Object.entries({ grid, doors, decks, grades, floors, water })) for (const row of rows) for (const value of row) if (typeof value === 'number') assert(Number.isFinite(value), `${name}: nonfinite sample`);
  const record = { seed, layout: 'current-v3', fingerprint, worldSha256: sha(JSON.stringify(world)), terrainDescriptorSha256: sha(JSON.stringify(terrainDescriptor)), terrainDescriptor, world, grid, doors, decks, grades, floors, floorDetails, river: world.river, waterfallPath, water, counts };
  const json = JSON.stringify(record), gzip = gzipSync(json, { level: 9 });
  return { record, json, gzip, summary: { seed, layout: record.layout, fingerprint, worldSha256: record.worldSha256, terrainDescriptorSha256: record.terrainDescriptorSha256, counts, jsonSha256: sha(json), jsonBytes: Buffer.byteLength(json), gzipSha256: sha(gzip), gzipBytes: gzip.length } };
}

const mode = process.argv[2];
assert(mode === 'capture' || mode === 'verify', 'usage: tsx capture-v3.mts capture|verify');
const records = [];
for (const seed of seeds) {
  const result = capture(seed), fixture = `${fixtures}/current-v3-${seed}.json.gz`;
  if (mode === 'capture') await writeFile(fixture, result.gzip, { flag: 'wx' });
  else {
    const savedGzip = await readFile(fixture), savedJson = gunzipSync(savedGzip).toString('utf8');
    assert.deepEqual(result.record, JSON.parse(savedJson), `${seed}: second independent generation differs`);
    assert.equal(result.json, savedJson, `${seed}: JSON bytes differ`);
    assert.equal(sha(result.gzip), sha(savedGzip), `${seed}: gzip bytes differ`);
    const captured = JSON.parse(await readFile(`${archive}/capture-results.json`, 'utf8')).records.find((r: { seed: number }) => r.seed === seed);
    assert.deepEqual(result.summary, captured, `${seed}: first/second summary differs`);
  }
  records.push(result.summary);
  console.log(JSON.stringify({ pass: mode, ...result.summary }));
}
assert.equal(new Set(records.map(record => record.fingerprint)).size, 3, 'all seeds need distinct fingerprints');
const after = await checkSource();
assert.deepEqual(after, before);
const results = { at: new Date().toISOString(), mode, node: process.version, sourceRoot, sourceFiles: 81, sourceHashesBefore: before, sourceHashesAfter: after, sourceUnchanged: true, geologicalGeometryVersion: GEOLOGICAL_GEOMETRY_VERSION, records, independentFreshProcess: mode === 'verify', fullRecordsDeepEqual: mode === 'verify', jsonBytesIdentical: mode === 'verify', gzipBytesIdentical: mode === 'verify', limits: ['CPU authoritative generator, geometry and height sampling only.', 'No WebGL, GPU, normal walking, simulation performance benchmark, or browser profile access.', 'The second pass is a fresh Node process, with new world instances and module-local caches.'] };
await writeFile(`${archive}/${mode}-results.json`, JSON.stringify(results, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ mode, seeds: records.length, sourceFiles: 81, sourceUnchanged: true, allChecksPassed: true }));
