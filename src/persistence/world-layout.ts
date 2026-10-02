import { CITY_LAYOUT_VERSIONS, CURRENT_CITY_LAYOUT, GEOLOGICAL_GEOMETRY_VERSION, ARCHITECTURAL_GEOMETRY_VERSION, createWorld } from '../world';
import { getBuildingBody, getFloorPlanRoofRegions } from '../architecture-floor-plan';
import type { CityLayoutVersion } from '../world';
import type { WorldDefinition } from '../types';

/** Matches Simulation's saved geometry contract, never geometry supplied by a save. */
export function savedWorldFingerprint(world: WorldDefinition): string {
  const geometry = { seed: world.seed,
    buildings: world.buildings.map(site => [site.id, site.districtId, site.kind, site.position, site.door, site.width, site.height, site.depth, site.floorFootprints]),
    nodes: world.nodes.map(node => [node.id, node.position]),
    edges: world.edges.map(edge => [edge.id, edge.from, edge.to, edge.mode, edge.length, edge.points]),
  };
  // The legacy/v2 text and FNV algorithm must stay byte-for-byte unchanged.
  // Version three changes the collision heightfield while retaining its city
  // graph, so its code-owned recipe and all physical inputs need a new identity.
  // selectSavedWorld only calls this with regenerated trusted candidates. An
  // imported file's layout/terrain/geometry labels are never used as inputs.
  const layout = (world as WorldDefinition & { layoutVersion?: CityLayoutVersion }).layoutVersion;
  const terrain = layout === 'current-v3' || layout === 'current-v4' ? {
    algorithm: GEOLOGICAL_GEOMETRY_VERSION,
    voxelSize: world.voxelSize, size: world.size, mountains: world.mountains,
    districts: world.districts.map(district => [district.id, district.center, district.radius]),
    waterfall: world.waterfall, river: world.river,
    buildingPhysics: world.buildings.map(site => [site.id, site.rotation, site.floors, site.basements]),
  } : undefined;
  // A v4 identity includes the generated physical rooms, voids, openings and
  // support planes. A marker alone cannot describe their usable geometry.
  // This extra descriptor is deliberately absent from all four old recipes.
  const architecture = layout === 'current-v4' ? {
    algorithm: ARCHITECTURAL_GEOMETRY_VERSION,
    buildings: world.buildings.map(site => {
      const body = getBuildingBody(site);
      return [site.id, site.seed, site.floorPlanProfile, site.functionPoints,
        site.floorUses, site.floorPermissions, site.publicFloors, site.requiredPermission,
        body ? [body.family, body.roofRhythm, body.floorPlans, getFloorPlanRoofRegions(body)] : null];
    }),
  } : undefined;
  const text = JSON.stringify(architecture ? { ...geometry, terrain, architecture } : terrain ? { ...geometry, terrain } : geometry);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

/** Keep an existing world's actual rooms, routes and 0.2m edits intact on upgrade. */
export function selectSavedWorld(json?: string | null): { world: WorldDefinition & { layoutVersion: CityLayoutVersion }; layout: CityLayoutVersion } {
  if (json === undefined || json === null || json === '') return { world: createWorld(), layout: CURRENT_CITY_LAYOUT };
  if (typeof json !== 'string' || json.length > 8_000_000) throw new Error('保存的旅程超过可读取范围；原存档已保留。');
  let data: Record<string, any>;
  try { data = JSON.parse(json); } catch { throw new Error('保存的旅程格式损坏；原存档已保留。'); }
  if (!data || data.format !== 'yunshan-save' || data.version !== 1 || !Number.isSafeInteger(data.worldSeed)
    || data.worldSeed < 0 || data.worldSeed > 0xffffffff || data.state?.seed !== data.worldSeed
    || typeof data.worldFingerprint !== 'string' || !/^[0-9a-f]{1,8}$/.test(data.worldFingerprint)) {
    throw new Error('保存的世界标识无效；原存档已保留。');
  }
  // A label in an imported file does not authorize a different layout. Rebuild
  // every supported candidate from our code and match the complete fingerprint.
  for (const layout of CITY_LAYOUT_VERSIONS) {
    const world = createWorld(data.worldSeed, layout);
    if (savedWorldFingerprint(world) === data.worldFingerprint) return { world, layout };
  }
  throw new Error('此存档的世界布局不属于当前支持的版本；原存档已保留，不能以新城覆盖。');
}
