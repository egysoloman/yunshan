import type { Vec3 } from '../types';

// Keep the original pool/page, actor and per-route limits. A city with many
// real stair flights can need several pages even though every route is valid.
export const ROUTE_POOL_PAGE_SIZE = 32768;
const MAX_ACTORS = 1024;
const MAX_ROUTE_POINTS = 1024;
const MAX_POOL_PAGES = MAX_ACTORS * MAX_ROUTE_POINTS / ROUTE_POOL_PAGE_SIZE;
export type RouteEncoding = 'pooled-v1' | 'paged-v1';

export function encodeCitizenRoutes<T extends { route?: Vec3[] }>(source: T[]) {
  const pool: Vec3[] = [], ids = new Map<string, number>();
  const citizens = source.map(citizen => ({ ...citizen, route: citizen.route?.map(point => {
    const key = `${point.x},${point.y},${point.z}`;
    let id = ids.get(key);
    if (id === undefined) { id = pool.length; ids.set(key, id); pool.push(point); }
    return id;
  }) }));
  if (pool.length <= ROUTE_POOL_PAGE_SIZE) return { citizens, routeEncoding: 'pooled-v1' as const, routePool: pool };
  const pages: Vec3[][] = [];
  for (let start = 0; start < pool.length; start += ROUTE_POOL_PAGE_SIZE) pages.push(pool.slice(start, start + ROUTE_POOL_PAGE_SIZE));
  return { citizens, routeEncoding: 'paged-v1' as const, routePool: pages };
}

function requireValue(value: unknown, field: string): asserts value { if (!value) throw new Error(`无效存档字段：${field}。`); }
function boundedArray(value: unknown, limit: number, field: string): any[] {
  requireValue(Array.isArray(value) && value.length <= limit, field);
  return value as any[];
}
function finitePoint(point: any): void {
  requireValue(point && typeof point === 'object' && !Array.isArray(point) && ['x', 'y', 'z'].every(key => typeof point[key] === 'number' && Number.isFinite(point[key])), 'pooled route position');
}

/** Decode only the parsed candidate, before live state is replaced. The caller
 * supplies its unchanged world-position validator where one is available. */
export function decodeCitizenRoutes(encoding: unknown, routePool: unknown, actors: unknown, validatePoint: (point: any) => void = finitePoint): void {
  requireValue(encoding === 'pooled-v1' || encoding === 'paged-v1', 'route encoding');
  const citizens = boundedArray(actors, MAX_ACTORS, 'encoded citizens');
  let references = 0;
  for (const citizen of citizens) {
    requireValue(citizen && typeof citizen === 'object' && !Array.isArray(citizen), 'encoded citizen');
    if (citizen.route !== undefined) references += boundedArray(citizen.route, MAX_ROUTE_POINTS, 'encoded route').length;
  }
  let count = 0;
  let pointAt: (index: number) => Vec3;
  if (encoding === 'pooled-v1') {
    const pool = boundedArray(routePool, ROUTE_POOL_PAGE_SIZE, 'route pool');
    for (const point of pool) validatePoint(point);
    count = pool.length; pointAt = index => pool[index];
  } else {
    const pages = boundedArray(routePool, MAX_POOL_PAGES, 'route pool pages');
    const coordinates = new Set<string>();
    for (let index = 0; index < pages.length; index++) {
      const page = boundedArray(pages[index], ROUTE_POOL_PAGE_SIZE, 'route pool page');
      requireValue(index === pages.length - 1 ? page.length > 0 : page.length === ROUTE_POOL_PAGE_SIZE, 'route pool page extent');
      for (const point of page) {
        validatePoint(point);
        const key = `${point.x},${point.y},${point.z}`;
        requireValue(!coordinates.has(key), 'duplicate route pool point');
        coordinates.add(key);
      }
      count += page.length;
    }
    // Every exported point belongs to at least one bounded actor route.
    requireValue(count > ROUTE_POOL_PAGE_SIZE && count <= references, 'route pool reference capacity');
    pointAt = index => pages[Math.floor(index / ROUTE_POOL_PAGE_SIZE)][index % ROUTE_POOL_PAGE_SIZE];
  }
  const used = encoding === 'paged-v1' ? new Set<number>() : null;
  for (const citizen of citizens) if (citizen.route !== undefined) citizen.route = citizen.route.map((index: unknown) => {
    requireValue(typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < count, 'route point index');
    // The exporter assigns IDs in actor/route order at the first occurrence.
    // Reject noncanonical new pools rather than silently changing save bytes
    // during partition assembly. Legacy pooled-v1 retains its old contract.
    if (used && !used.has(index)) {
      requireValue(index === used.size, 'route pool first-reference order');
      used.add(index);
    }
    const point = pointAt(index);
    return { x: point.x, y: point.y, z: point.z };
  });
  if (used) requireValue(used.size === count, 'unreferenced route pool point');
}
