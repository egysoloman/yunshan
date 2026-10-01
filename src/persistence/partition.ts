import type { Vec3, WorldDefinition } from '../types';

export const SAVE_CHUNK_SIZE = 256;
export type SaveWorld = Pick<WorldDefinition, 'buildings' | 'districts' | 'nodes'>;
export interface SavePart { id: string; json: string }
type Document = Record<string, any>;
interface Chunk { arrays: Record<string, { index: number; value: unknown }[]>; maps: Record<string, Document> }
interface Layout { arrays: Record<string, number>; maps: string[]; order: Record<string, string[]> }

function object(value: unknown): value is Document { return !!value && typeof value === 'object' && !Array.isArray(value); }
function ownerAt(document: Document, path: string): { owner: Document; key: string } | null {
  const keys = path.split('.'), key = keys.pop()!;
  let owner = document;
  for (const segment of keys) { if (!object(owner[segment])) return null; owner = owner[segment]; }
  return { owner, key };
}
function valueAt(document: Document, path: string): any { const at = ownerAt(document, path); return at?.owner[at.key]; }
function positionChunk(position: unknown): string | null {
  if (!object(position) || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
  return `chunk:${Math.floor(position.x / SAVE_CHUNK_SIZE)}:${Math.floor(position.z / SAVE_CHUNK_SIZE)}`;
}
function emptyChunk(): Chunk { return { arrays: Object.create(null), maps: Object.create(null) }; }

/** Pure decomposition: unknown extension fields stay losslessly in global state. */
export function partitionSave(json: string, world?: SaveWorld): SavePart[] {
  if (typeof json !== 'string' || json.length > 8_000_000) throw new Error('存档大小超过8MB限制。');
  const document: Document = JSON.parse(json);
  if (!object(document) || document.format !== 'yunshan-save' || !object(document.state) || !object(document.runtime)) throw new Error('无效云山存档。');
  let visited = 0;
  const inspect = (value: unknown, depth = 0): void => {
    if (++visited > 2_000_000 || depth > 24) throw new Error('存档结构过于复杂。');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('存档包含不安全字段。'); inspect(child, depth + 1); }
  };
  inspect(document);
  const order: Record<string, string[]> = { '': Object.keys(document), state: Object.keys(document.state), runtime: Object.keys(document.runtime) };
  if (object(document.state.extension)) order['state.extension'] = Object.keys(document.state.extension);
  if (object(document.state.extension?.runtime)) order['state.extension.runtime'] = Object.keys(document.state.extension.runtime);
  if (object(document.state.aviation)) order['state.aviation'] = Object.keys(document.state.aviation);
  if (object(document.state.family)) order['state.family'] = Object.keys(document.state.family);
  if (document.routeEncoding === 'pooled-v1') {
    if (!Array.isArray(document.routePool) || !Array.isArray(document.state.citizens)) throw new Error('无效存档路线池。');
    for (const citizen of document.state.citizens) if (citizen.route !== undefined) {
      if (!Array.isArray(citizen.route)) throw new Error('无效存档路线。');
      citizen.route = citizen.route.map((index: unknown) => { if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= document.routePool.length) throw new Error('无效存档路线索引。'); return document.routePool[index as number]; });
    }
    delete document.routePool;
  }
  const chunks = new Map<string, Chunk>(), player: Document = { values: Object.create(null), maps: Object.create(null) };
  const layout: Layout = { arrays: Object.create(null), maps: [], order };
  const getChunk = (id: string): Chunk => { let chunk = chunks.get(id); if (!chunk) { chunk = emptyChunk(); chunks.set(id, chunk); } return chunk; };
  const districtChunks = new Map(world?.districts.map(district => [district.id, positionChunk(district.center)!]) ?? []);
  const buildingChunks = new Map(world?.buildings.map(building => [building.id, positionChunk(building.position)!]) ?? []);
  const nodeChunks = new Map(world?.nodes.map(node => [node.id, positionChunk(node.position)!]) ?? []);
  const districtChunk = (id: string): string => districtChunks.get(id) ?? `chunk:district:${id}`;
  const citizenChunks = new Map<string, string>((document.state.citizens ?? []).map((citizen: Document) => [citizen.id, positionChunk(citizen.position) ?? districtChunk(citizen.districtId)]));
  const locate = (value: Document): string => positionChunk(value.position) ?? buildingChunks.get(value.buildingId ?? value.homeId) ?? citizenChunks.get(value.npcId ?? value.citizenId ?? value.carrierId ?? value.from) ?? districtChunk(value.districtId ?? value.id ?? 'unlocated');
  const companyChunks = new Map<string, string>((document.state.extension?.companies ?? []).map((company: Document) => [company.id, locate(company)]));
  for (const path of ['state.citizens', 'state.vehicles', 'state.aviation.aircraft', 'state.family.pregnancies', 'state.shops', 'state.districts', 'state.crimes', 'state.voxels', 'state.extension.companies', 'state.extension.audits', 'runtime.links', 'runtime.wages']) {
    const at = ownerAt(document, path), array = at?.owner[at.key];
    if (!at || !Array.isArray(array)) continue;
    layout.arrays[path] = array.length;
    array.forEach((value, index) => { const chunk = getChunk(locate(value)); (chunk.arrays[path] ??= []).push({ index, value }); });
    delete at.owner[at.key];
  }
  for (const path of ['state.player', 'state.relationships', 'state.bankBalance', 'state.loan', 'state.extension.cooking', 'runtime.playerBusinesses', 'runtime.investment', 'runtime.campaign', 'runtime.focus', 'runtime.mode', 'runtime.detail', 'runtime.workAt', 'runtime.studyAt', 'runtime.restAt', 'runtime.relationshipAt', 'runtime.driving', 'runtime.lastInvestmentAt']) {
    const at = ownerAt(document, path); if (at && Object.hasOwn(at.owner, at.key)) { player.values[path] = at.owner[at.key]; delete at.owner[at.key]; }
  }
  for (const path of ['state.extension.actorProfiles', 'state.extension.runtime.deprivation', 'state.extension.runtime.diversions', 'state.extension.runtime.companyCursors', 'state.extension.runtime.cooldowns', 'state.family.children', 'state.family.studentGuardians', 'state.family.nextSupportAt', 'state.family.nextPlanAt', 'state.family.estates', 'runtime.riders', 'runtime.impressions', 'runtime.decisionAt', 'runtime.activities', 'runtime.attendance', 'runtime.customers', 'runtime.dispatches', 'runtime.hostileAt', 'runtime.freight', 'runtime.districtRelationMeans', 'state.signals', 'runtime.signalOverrides']) {
    const at = ownerAt(document, path), map = at?.owner[at.key];
    if (!at || !object(map)) continue;
    layout.maps.push(path);
    order[path] = Object.keys(map);
    for (const [key, value] of Object.entries(map)) {
      const entityId = path.endsWith('.cooldowns') ? key.slice(key.indexOf(':') + 1) : key;
      if (entityId === 'player' || path.endsWith('.cooldowns') && !citizenChunks.has(entityId) && !companyChunks.has(entityId)) { (player.maps[path] ??= Object.create(null))[key] = value; continue; }
      const chunk = getChunk(citizenChunks.get(entityId) ?? companyChunks.get(entityId) ?? nodeChunks.get(entityId) ?? districtChunk(entityId));
      (chunk.maps[path] ??= Object.create(null))[key] = value;
    }
    delete at.owner[at.key];
  }
  return [{ id: 'global', json: JSON.stringify({ document, layout }) }, { id: 'player', json: JSON.stringify(player) }, ...[...chunks].sort(([a], [b]) => a.localeCompare(b)).map(([id, chunk]) => ({ id, json: JSON.stringify(chunk) }))];
}

/** Reassemble one complete generation; reject missing/duplicate array members. */
export function assembleSave(parts: SavePart[]): string {
  const byId = new Map(parts.map(part => [part.id, part.json]));
  if (byId.size !== parts.length || !byId.has('global') || !byId.has('player')) throw new Error('存档分区不完整。');
  const { document, layout }: { document: Document; layout: Layout } = JSON.parse(byId.get('global')!);
  const player = JSON.parse(byId.get('player')!);
  const indices = new Map<string, Set<number>>();
  const setValue = (path: string, value: unknown): void => { const at = ownerAt(document, path); if (!at) throw new Error('存档字段路径不完整。'); at.owner[at.key] = value; };
  for (const [path, length] of Object.entries(layout.arrays)) { if (!Number.isInteger(length) || length < 0 || length > 100000) throw new Error('无效存档数组。'); setValue(path, new Array(length)); indices.set(path, new Set()); }
  for (const path of layout.maps) setValue(path, Object.create(null));
  for (const [path, value] of Object.entries(player.values)) setValue(path, value);
  const mergeMaps = (maps: Record<string, Document>): void => {
    for (const [path, entries] of Object.entries(maps)) { if (!layout.maps.includes(path)) throw new Error('未知存档映射。'); const target = valueAt(document, path); for (const [key, value] of Object.entries(entries)) { if (Object.hasOwn(target, key)) throw new Error('重复存档映射。'); target[key] = value; } }
  };
  mergeMaps(player.maps);
  for (const part of parts) if (part.id.startsWith('chunk:')) {
    const chunk: Chunk = JSON.parse(part.json);
    for (const [path, entries] of Object.entries(chunk.arrays)) {
      const array = valueAt(document, path), seen = indices.get(path);
      if (!Array.isArray(array) || !seen) throw new Error('未知存档数组。');
      for (const { index, value } of entries) { if (!Number.isInteger(index) || index < 0 || index >= array.length || seen.has(index)) throw new Error('重复或无效存档实体。'); seen.add(index); array[index] = value; }
    }
    mergeMaps(chunk.maps);
  }
  for (const [path, seen] of indices) if (seen.size !== layout.arrays[path]) throw new Error('缺失存档实体。');
  if (document.routeEncoding === 'pooled-v1') {
    const routePool: Vec3[] = [], ids = new Map<string, number>();
    for (const citizen of document.state.citizens) if (citizen.route !== undefined) citizen.route = citizen.route.map((point: Vec3) => { const key = `${point.x},${point.y},${point.z}`; let id = ids.get(key); if (id === undefined) { id = routePool.length; ids.set(key, id); routePool.push(point); } return id; });
    document.routePool = routePool;
  }
  // Preserve object-key order too: deterministic export/continuation tooling can
  // compare the reconstructed version-one export byte for byte.
  const reorder = (value: any, path: string): any => {
    if (!object(value)) return value;
    const ordered: Document = Object.create(null);
    for (const key of layout.order[path] ?? Object.keys(value)) if (Object.hasOwn(value, key)) ordered[key] = reorder(value[key], path ? `${path}.${key}` : key);
    return ordered;
  };
  return JSON.stringify(reorder(document, ''));
}
