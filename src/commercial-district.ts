import type { Building, WorldDefinition } from './types';
import { getBuildingBody, getBuildingEntrance, getBuildingUsePoints } from './architecture-floor-plan';

/** A new, code-owned recipe. These are existing banks, not new economic actors. */
export const COMMERCIAL_GEOMETRY_REVISION = 1 as const;
export const COMMERCIAL_ROUTE_REVISION = 1 as const;
export const COMMERCIAL_RECIPE_VERSION = 'commercial-five-bank-towers-01';
export const COMMERCIAL_TOWER_SITES = [
  { id: 'market-b6', floors: 40, storeyHeight: 4.4 },
  { id: 'market-b38', floors: 30, storeyHeight: 4.4 },
  { id: 'market-b44', floors: 25, storeyHeight: 4.4 },
  { id: 'market-b41', floors: 22, storeyHeight: 4.4 },
  { id: 'market-b35', floors: 20, storeyHeight: 4.4 },
] as const;
const q = (value: number) => Math.round(value * 5) / 5;
const program = (floor: number, floors: number): string => floor === 0 ? '原钱庄公共柜台与接待'
  : floor === 1 ? '公共金融咨询与办事厅'
  : floor === floors - 1 ? '钱庄上层办公与城市会客厅'
  : ['钱庄记账与结算办公室', '原钱庄业务办公区', '钱庄账务复核办公室', '钱庄档案与协作办公区'][(floor - 2) % 4];

export interface CommercialNetworkConflict { siteId: string; edgeId: string; floor: number; segment: number }
/** Conservative swept-volume guard for new floors. Existing track/road/flight
 * centre lines remain unchanged. It does not certify an entire traffic system. */
export function commercialNetworkConflicts(world: WorldDefinition): CommercialNetworkConflict[] {
  const conflicts: CommercialNetworkConflict[] = [];
  for (const site of world.buildings) {
    if (site.commercialGeometryRevision !== 1) continue;
    const body = getBuildingBody(site)!;
    for (const edge of world.edges) {
      // Shared road/bridge widths are 10/9m and rail width is 6m. The
      // additional .6m is a clearance guard, not a replacement road mesh.
      const half = edge.mode === 'flight' ? 22 : edge.mode === 'bridge' ? 4.5 : ['maglev', 'lightRail'].includes(edge.mode) ? 3 : edge.mode === 'cable' ? 2 : 5;
      const below = edge.mode === 'flight' ? 3 : 2.4, above = edge.mode === 'flight' ? 5 : 4.8;
      for (let segment = 1; segment < edge.points.length; segment++) {
        const a = edge.points[segment - 1], b = edge.points[segment];
        for (const plan of body.floorPlans.filter(plan => plan.floor >= 2)) {
          const r = plan.broadphase, minY = site.position.y + .6 + plan.y - .2, maxY = site.position.y + .6 + plan.ceilingY + 1.2;
          let lo = 0, hi = 1;
          for (const [axis, min, max] of [
            ['x', site.position.x + r.x0 - half - .6, site.position.x + r.x1 + half + .6],
            ['z', site.position.z + r.z0 - half - .6, site.position.z + r.z1 + half + .6],
            ['y', minY - above, maxY + below],
          ] as const) {
            const delta = b[axis] - a[axis];
            if (Math.abs(delta) < 1e-12) { if (a[axis] < min || a[axis] > max) { lo = 2; break; } }
            else { const u = (min - a[axis]) / delta, v = (max - a[axis]) / delta; lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v)); }
          }
          if (lo <= hi) { conflicts.push({ siteId: site.id, edgeId: edge.id, floor: plan.floor, segment }); break; }
        }
      }
    }
  }
  return conflicts;
}

/** Mutates only the five declared banks of a fresh trusted v5 world.
 * All ground envelopes/doors, IDs, names, kind, capacity and graph stay intact.
 * Capacity is deliberately not monetised into new jobs, ownership or inventory. */
export function applyCommercialDistrict(world: WorldDefinition): void {
  const selected: Building[] = COMMERCIAL_TOWER_SITES.map(spec => {
    const site = world.buildings.find(building => building.id === spec.id);
    if (!site || site.kind !== 'bank' || site.districtId !== 'market' || site.floorPlanProfile !== 'v4-program-bodies-02'
      || site.stairGeometryRevision !== 2 || site.rotation !== 0 || site.width < 40 || site.depth < 33)
      throw new Error(`商业高楼配方缺少可信原钱庄或尺寸不适用：${spec.id}`);
    return site;
  });
  for (let index = 0; index < selected.length; index++) {
    const site = selected[index], spec = COMMERCIAL_TOWER_SITES[index], door = { ...site.door };
    site.commercialGeometryRevision = COMMERCIAL_GEOMETRY_REVISION;
    site.commercialRouteRevision = COMMERCIAL_ROUTE_REVISION;
    site.floors = spec.floors;
    site.height = q(spec.floors * spec.storeyHeight);
    site.floorFootprints = Array.from({ length: spec.floors }, (_, floor) => {
      const scale = floor < 2 ? 1 : floor < Math.ceil(spec.floors * .40) ? .92 : floor < Math.ceil(spec.floors * .78) ? .86 : .80;
      return { width: floor < 2 ? site.width : q(site.width * scale), depth: floor < 2 ? site.depth : q(site.depth * scale) };
    });
    site.floorUses = Array.from({ length: spec.floors }, (_, floor) => program(floor, spec.floors));
    // Original bank staff (钱庄职员 currently maps to traveler) retain access.
    // No new merchant identity, company, ownership or money is created.
    site.floorPermissions = Array.from({ length: spec.floors }, () => 'public');
    site.publicFloors = spec.floors;
    const entrance = getBuildingEntrance(site);
    if (Math.hypot(entrance.x - door.x, entrance.z - door.z) > 1e-7 || Math.abs(entrance.y - door.y) > 1e-7)
      throw new Error(`商业高楼不得移动原钱庄入口：${site.id}`);
    site.functionPoints = Array.from({ length: spec.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat();
  }
  const conflicts = commercialNetworkConflicts(world);
  if (conflicts.length) throw new Error(`商业高楼侵入现有真实交通走廊，拒绝此seed：${conflicts[0].siteId}/${conflicts[0].edgeId}`);
}
