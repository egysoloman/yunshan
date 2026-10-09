import type { WorldDefinition } from '../types';
import { decodeCitizenRoutes, encodeCitizenRoutes } from './route-encoding';
import { parseSaveWithinResources, validateSaveResources } from './save-resource';
import { decodeCivicHistory } from '../simulation/civic-history';
import { hasCityRulesetDeclaration, validateCityRulesetEnvelope } from '../simulation/city-ruleset';
import { validateReferenceCollisionPolicy } from '../simulation/reference-collision';
import { validateMealRoutePolicy } from '../simulation/meal-route';

export const SAVE_CHUNK_SIZE = 256;
export type SaveWorld = Pick<WorldDefinition, 'buildings' | 'districts' | 'nodes'>;
export interface SavePart { id: string; json: string }
type Document = Record<string, any>;
interface Chunk { arrays: Record<string, { index: number; value: unknown }[]>; maps: Record<string, Document> }
interface Layout { arrays: Record<string, number>; maps: string[]; order: Record<string, string[]>; playerValues?: string[]; playerArrays?: Record<string, number[]>; civicHistory?: { id: string; pageParts: string[] } }

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
  const document: Document = parseSaveWithinResources(json);
  if (!object(document) || document.format !== 'yunshan-save' || !object(document.state) || !object(document.runtime)) throw new Error('无效云山存档。');
  let visited = 0;
  const inspect = (value: unknown, depth = 0): void => {
    if (++visited > 2_000_000 || depth > 24) throw new Error('存档结构过于复杂。');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('存档包含不安全字段。'); inspect(child, depth + 1); }
  };
  inspect(document);
  if (hasCityRulesetDeclaration(document)) validateCityRulesetEnvelope(document);
  const order: Record<string, string[]> = { '': Object.keys(document), state: Object.keys(document.state), runtime: Object.keys(document.runtime) };
  if (object(document.state.extension)) order['state.extension'] = Object.keys(document.state.extension);
  if (object(document.state.extension?.runtime)) order['state.extension.runtime'] = Object.keys(document.state.extension.runtime);
  if (object(document.state.aviation)) order['state.aviation'] = Object.keys(document.state.aviation);
  if (object(document.state.family)) order['state.family'] = Object.keys(document.state.family);
  if (object(document.state.culture)) order['state.culture'] = Object.keys(document.state.culture);
  if (object(document.state.trade)) order['state.trade'] = Object.keys(document.state.trade);
  if (object(document.state.clinical)) order['state.clinical'] = Object.keys(document.state.clinical);
  if (object(document.state.education)) order['state.education'] = Object.keys(document.state.education);
  if (object(document.state.familyEducation)) order['state.familyEducation'] = Object.keys(document.state.familyEducation);
  if (object(document.state.hygiene)) order['state.hygiene'] = Object.keys(document.state.hygiene);
  if (object(document.state.pathology)) order['state.pathology'] = Object.keys(document.state.pathology);
  if (object(document.state.power)) order['state.power'] = Object.keys(document.state.power);
  if (object(document.state.shopLifecycle)) order['state.shopLifecycle'] = Object.keys(document.state.shopLifecycle);
  if (document.version === 4) {
    const history = document.state.civicHistory;
    decodeCivicHistory(history, document.state.civicStaffing.enablement.id, document.state.extension?.lastUpdate ?? document.state.day * 1440 + document.state.hour * 60, document.state.tick);
    order['state.civicHistory'] = Object.keys(history);
  }
  if (document.routeEncoding !== undefined) {
    decodeCitizenRoutes(document.routeEncoding, document.routePool, document.state.citizens);
    delete document.routePool;
  }
  const chunks = new Map<string, Chunk>(), player: Document = { values: Object.create(null), maps: Object.create(null), arrays: Object.create(null) };
  const layout: Layout = { arrays: Object.create(null), maps: [], order, playerValues: [], playerArrays: Object.create(null) };
  const getChunk = (id: string): Chunk => { let chunk = chunks.get(id); if (!chunk) { chunk = emptyChunk(); chunks.set(id, chunk); } return chunk; };
  const districtChunks = new Map(world?.districts.map(district => [district.id, positionChunk(district.center)!]) ?? []);
  const buildingChunks = new Map(world?.buildings.map(building => [building.id, positionChunk(building.position)!]) ?? []);
  const nodeChunks = new Map(world?.nodes.map(node => [node.id, positionChunk(node.position)!]) ?? []);
  const districtChunk = (id: string): string => districtChunks.get(id) ?? `chunk:district:${id}`;
  const citizenChunks = new Map<string, string>((document.state.citizens ?? []).map((citizen: Document) => [citizen.id, positionChunk(citizen.position) ?? districtChunk(citizen.districtId)]));
  const vehicleChunks = new Map<string, string>((document.state.vehicles ?? []).map((vehicle: Document) => [vehicle.id, positionChunk(vehicle.position) ?? districtChunk(vehicle.id)]));
  const playerChunk = positionChunk(document.state.player?.position); if (playerChunk) citizenChunks.set('player', playerChunk);
  const locate = (value: Document): string => positionChunk(value.position) ?? buildingChunks.get(value.buildingId ?? value.homeId ?? value.siteId) ?? citizenChunks.get(value.npcId ?? value.citizenId ?? value.carrierId ?? value.deceasedId ?? value.actorIds?.[0] ?? value.authorId ?? value.actorId ?? value.patientId ?? value.from) ?? districtChunk(value.districtId ?? value.id ?? 'unlocated');
  const companyChunks = new Map<string, string>((document.state.extension?.companies ?? []).map((company: Document) => [company.id, locate(company)]));
  const shopChunks = new Map<string, string>((document.state.shops ?? []).map((shop: Document) => [shop.id, locate(shop)]));
  for (const path of ['state.citizens', 'state.vehicles', 'state.aviation.aircraft', 'state.familyEducation.active', 'state.familyEducation.pages', 'state.family.pregnancies', 'state.family.bonds', 'state.family.movePlans', 'state.family.households', 'state.family.ceremonies', 'state.family.estateSales', 'state.culture.orders', 'state.culture.petitions', 'state.culture.works', 'state.culture.reports', 'state.clinical.orders', 'state.hygiene.batches', 'state.hygiene.jobs', 'state.hygiene.capacityHistory', 'state.pathology.history', 'state.pathology.contacts', 'state.pathology.sourceReceipts', 'state.power.repairs', 'state.power.faults', 'state.power.capacityHistory', 'state.shopLifecycle.listings', 'state.shopLifecycle.leases', 'state.shopLifecycle.receipts', 'state.shops', 'state.districts', 'state.crimes', 'state.voxels', 'state.extension.companies', 'state.extension.audits', 'runtime.links', 'runtime.wages']) {
    const at = ownerAt(document, path), array = at?.owner[at.key];
    if (!at || !Array.isArray(array)) continue;
    layout.arrays[path] = array.length;
    if (path === 'state.clinical.orders' || path === 'state.hygiene.jobs' || path === 'state.power.repairs') { player.arrays[path] = []; layout.playerArrays![path] = []; }
    array.forEach((value, index) => {
      if ((path === 'state.clinical.orders' || path === 'state.hygiene.jobs' || path === 'state.power.repairs') && value.payerId === 'player') { player.arrays[path].push({ index, value }); layout.playerArrays![path].push(index); }
      else { const chunk = getChunk(path === 'state.power.repairs' ? buildingChunks.get(document.state.power.operatorSiteId) ?? locate(value) : path === 'state.power.faults' ? buildingChunks.get(document.state.power.sourceSiteId) ?? locate(value) : path.startsWith('state.shopLifecycle.') ? shopChunks.get(value.shopId) ?? locate(value) : path === 'state.familyEducation.pages' ? locate(value[0]) : locate(value)); (chunk.arrays[path] ??= []).push({ index, value }); }
    });
    delete at.owner[at.key];
  }
  for (const path of ['state.player', 'state.playerLabor', 'state.relationships', 'state.bankBalance', 'state.loan', 'state.extension.cooking', 'state.culture.project', 'state.culture.playerServiceId', 'runtime.playerBusinesses', 'runtime.investment', 'runtime.campaign', 'runtime.focus', 'runtime.mode', 'runtime.detail', 'runtime.workAt', 'runtime.studyAt', 'runtime.restAt', 'runtime.relationshipAt', 'runtime.driving', 'runtime.lastInvestmentAt']) {
    const at = ownerAt(document, path); if (at && Object.hasOwn(at.owner, at.key)) { player.values[path] = at.owner[at.key]; layout.playerValues!.push(path); delete at.owner[at.key]; }
  }
  for (const path of ['state.education.course', 'state.education.history']) {
    const at = ownerAt(document, path); if (at && Object.hasOwn(at.owner, at.key)) { player.values[path] = at.owner[at.key]; layout.playerValues!.push(path); delete at.owner[at.key]; }
  }
  for (const path of ['state.extension.actorProfiles', 'state.extension.runtime.deprivation', 'state.extension.runtime.diversions', 'state.extension.runtime.companyCursors', 'state.extension.runtime.cooldowns', 'state.family.children', 'state.family.studentGuardians', 'state.family.careGuardians', 'state.family.nextSupportAt', 'state.family.nextPlanAt', 'state.family.estates', 'state.culture.transportMaintenance', 'state.trade.lots', 'state.trade.ownedLots', 'state.trade.activity', 'state.clinical.stock', 'state.education.stock', 'state.familyEducation.stock', 'state.hygiene.stock', 'state.hygiene.clinicalBaseline', 'state.pathology.episodes', 'state.pathology.pendingDose', 'state.power.buildingMeters', 'state.power.vehicleMeters', 'state.shopLifecycle.titles', 'state.clinical.nextVisitAt', 'runtime.riders', 'runtime.impressions', 'runtime.decisionAt', 'runtime.activities', 'runtime.attendance', 'runtime.customers', 'runtime.dispatches', 'runtime.hostileAt', 'runtime.freight', 'runtime.districtRelationMeans', 'state.signals', 'runtime.signalOverrides']) {
    const at = ownerAt(document, path), map = at?.owner[at.key];
    if (!at || !object(map)) continue;
    layout.maps.push(path);
    order[path] = Object.keys(map);
    for (const [key, value] of Object.entries(map)) {
      if (path === 'state.clinical.stock' || path === 'state.education.stock' || path === 'state.familyEducation.stock' || path === 'state.hygiene.stock' || path === 'state.hygiene.clinicalBaseline' || path === 'state.power.buildingMeters') { const chunk = getChunk(buildingChunks.get(key) ?? districtChunk(key)); (chunk.maps[path] ??= Object.create(null))[key] = value; continue; }
      const entityId = path.endsWith('.cooldowns') ? key.slice(key.indexOf(':') + 1) : key;
      if (entityId === 'player' || path.endsWith('.cooldowns') && !citizenChunks.has(entityId) && !companyChunks.has(entityId)) { (player.maps[path] ??= Object.create(null))[key] = value; continue; }
      const chunk = getChunk(citizenChunks.get(entityId) ?? vehicleChunks.get(entityId) ?? companyChunks.get(entityId) ?? shopChunks.get(entityId) ?? buildingChunks.get(entityId) ?? nodeChunks.get(entityId) ?? districtChunk(entityId));
      (chunk.maps[path] ??= Object.create(null))[key] = value;
    }
    delete at.owner[at.key];
  }
  const historyParts: SavePart[] = [];
  if (document.version === 4) {
    const history = document.state.civicHistory;
    historyParts.push(...history.pages.map((page: Document) => ({ id: `chunk:civic-history:${history.id}:${page.id}`,
      json: JSON.stringify({ arrays: {}, maps: {}, historyPage: { historyId: history.id, page } }) })));
    layout.civicHistory = { id: history.id, pageParts: historyParts.map(part => part.id) };
    delete history.pages;
  }
  return [{ id: 'global', json: JSON.stringify({ document, layout }) }, { id: 'player', json: JSON.stringify(player) }, ...[...chunks].sort(([a], [b]) => a.localeCompare(b)).map(([id, chunk]) => ({ id, json: JSON.stringify(chunk) })), ...historyParts];
}

/** Reassemble one complete generation; reject missing/duplicate array members. */
export function assembleSave(parts: SavePart[]): string {
  const byId = new Map(parts.map(part => [part.id, part.json]));
  if (byId.size !== parts.length || !byId.has('global') || !byId.has('player')) throw new Error('存档分区不完整。');
  const { document, layout }: { document: Document; layout: Layout } = JSON.parse(byId.get('global')!);
  const historyPartIds = new Set<string>();
  if (document?.version === 4) {
    const history = document.state?.civicHistory, declared = layout.civicHistory;
    if (!object(history) || !object(declared) || Object.keys(declared).sort().join(',') !== 'id,pageParts' || declared.id !== history.id
      || !Array.isArray(declared.pageParts) || declared.pageParts.length !== history.pageDescriptors?.length || Object.hasOwn(history, 'pages')) throw new Error('历史存档页面布局不完整。');
    history.pages = declared.pageParts.map((id, index) => {
      if (id !== `chunk:civic-history:${history.id}:${history.pageDescriptors[index].id}` || historyPartIds.has(id) || !byId.has(id)) throw new Error('缺失或重复历史存档页面。');
      historyPartIds.add(id);
      const chunk = JSON.parse(byId.get(id)!);
      if (!object(chunk) || Object.keys(chunk).sort().join(',') !== 'arrays,historyPage,maps' || !object(chunk.arrays) || Object.keys(chunk.arrays).length
        || !object(chunk.maps) || Object.keys(chunk.maps).length || !object(chunk.historyPage) || Object.keys(chunk.historyPage).sort().join(',') !== 'historyId,page'
        || chunk.historyPage.historyId !== history.id) throw new Error('历史存档页面载体无效。');
      return chunk.historyPage.page;
    });
  } else if (layout.civicHistory !== undefined || parts.some(part => part.id.startsWith('chunk:civic-history:'))) throw new Error('旧存档不能声明历史页面。');
  for (const part of parts) if (part.id.startsWith('chunk:civic-history:') && !historyPartIds.has(part.id)) throw new Error('孤立或混合代际历史页面。');
  const player = JSON.parse(byId.get('player')!);
  if (!object(player) || !object(player.values) || !object(player.maps)) throw new Error('玩家存档分区不完整。');
  if (layout.playerValues && (!Array.isArray(layout.playerValues) || new Set(layout.playerValues).size !== layout.playerValues.length || layout.playerValues.length !== Object.keys(player.values).length || layout.playerValues.some(path => !Object.hasOwn(player.values, path)))) throw new Error('缺失或重复玩家存档字段。');
  if (layout.playerArrays !== undefined) {
    if (!object(layout.playerArrays) || !object(player.arrays) || Object.keys(layout.playerArrays).length !== Object.keys(player.arrays).length) throw new Error('玩家托管实体分区不完整。');
    for (const [path, expected] of Object.entries(layout.playerArrays)) {
      const entries = player.arrays[path];
      if (!Array.isArray(expected) || new Set(expected).size !== expected.length || !Array.isArray(entries) || entries.length !== expected.length || entries.some((entry, index) => !object(entry) || entry.index !== expected[index])) throw new Error('缺失或重复玩家托管实体。');
    }
  }
  const indices = new Map<string, Set<number>>();
  const setValue = (path: string, value: unknown): void => { const at = ownerAt(document, path); if (!at) throw new Error('存档字段路径不完整。'); at.owner[at.key] = value; };
  for (const [path, length] of Object.entries(layout.arrays)) { if (!Number.isInteger(length) || length < 0 || length > 100000) throw new Error('无效存档数组。'); setValue(path, new Array(length)); indices.set(path, new Set()); }
  for (const path of layout.maps) setValue(path, Object.create(null));
  for (const [path, value] of Object.entries(player.values)) setValue(path, value);
  const mergeArrays = (arrays: Chunk['arrays']): void => {
    if (!object(arrays)) throw new Error('存档实体分区无效。');
    for (const [path, entries] of Object.entries(arrays)) {
      const array = valueAt(document, path), seen = indices.get(path);
      if (!Array.isArray(array) || !seen || !Array.isArray(entries)) throw new Error('未知存档数组。');
      for (const { index, value } of entries) { if (!Number.isInteger(index) || index < 0 || index >= array.length || seen.has(index)) throw new Error('重复或无效存档实体。'); seen.add(index); array[index] = value; }
    }
  };
  if (player.arrays !== undefined) mergeArrays(player.arrays);
  const mergeMaps = (maps: Record<string, Document>): void => {
    for (const [path, entries] of Object.entries(maps)) { if (!layout.maps.includes(path)) throw new Error('未知存档映射。'); const target = valueAt(document, path); for (const [key, value] of Object.entries(entries)) { if (Object.hasOwn(target, key)) throw new Error('重复存档映射。'); target[key] = value; } }
  };
  mergeMaps(player.maps);
  for (const part of parts) if (part.id.startsWith('chunk:') && !historyPartIds.has(part.id)) {
    const chunk: Chunk = JSON.parse(part.json);
    mergeArrays(chunk.arrays);
    mergeMaps(chunk.maps);
  }
  for (const [path, seen] of indices) if (seen.size !== layout.arrays[path]) throw new Error('缺失存档实体。');
  for (const path of layout.maps) {
    const expected = layout.order[path], target = valueAt(document, path);
    if (!Array.isArray(expected) || new Set(expected).size !== expected.length || Object.keys(target).length !== expected.length || expected.some(key => !Object.hasOwn(target, key))) throw new Error('缺失存档映射。');
  }
  if (document.routeEncoding !== undefined) {
    if (document.routeEncoding !== 'pooled-v1' && document.routeEncoding !== 'paged-v1') throw new Error('无效存档路线编码。');
    const encoded = encodeCitizenRoutes(document.state.citizens);
    if (encoded.routeEncoding !== document.routeEncoding) throw new Error('存档分区路线编码与完整代际不匹配。');
    decodeCitizenRoutes(encoded.routeEncoding, encoded.routePool,
      encoded.citizens.map(citizen => ({ ...citizen, route: citizen.route?.slice() })));
    document.state.citizens = encoded.citizens;
    document.routePool = encoded.routePool;
  }
  // Preserve object-key order too: deterministic export/continuation tooling can
  // compare the reconstructed version-one export byte for byte.
  const reorder = (value: any, path: string): any => {
    if (!object(value)) return value;
    const keys = Object.keys(value), expected = layout.order[path] ?? keys;
    // Ordering metadata may change byte order, never remove a retained field.
    // Check every visited object, including unknown extensions and service
    // books, rather than a growing allowlist of individual policy markers.
    if (!Array.isArray(expected) || new Set(expected).size !== expected.length
      || expected.length !== keys.length || expected.some(key => typeof key !== 'string' || !Object.hasOwn(value, key))) throw new Error('存档字段顺序缺失、重复或包含未知字段。');
    const ordered: Document = Object.create(null);
    for (const key of expected) ordered[key] = reorder(value[key], path ? `${path}.${key}` : key);
    return ordered;
  };
  if (hasCityRulesetDeclaration(document)) validateCityRulesetEnvelope(document);
  if (document.version === 4) decodeCivicHistory(document.state.civicHistory, document.state.civicStaffing.enablement.id, document.state.extension?.lastUpdate ?? document.state.day * 1440 + document.state.hour * 60, document.state.tick);
  for (const policyKey of ['referenceCollisionPolicyId', 'mealRoutePolicyId', 'freightPickupPolicyId', 'farmYieldPolicyId', 'foodFreightPolicyId', 'publicFinancePolicyId']) if (Object.hasOwn(document, policyKey)) {
    for (const path of ['', 'runtime']) {
      if (!Array.isArray(layout.order[path]) || layout.order[path].filter(key => key === policyKey).length !== 1) throw new Error('行程规则不能在存档字段顺序中缺失或重复。');
    }
  }
  const reordered = reorder(document, '');
  if (hasCityRulesetDeclaration(reordered)) validateCityRulesetEnvelope(reordered);
  const assembled = JSON.stringify(reordered);
  validateSaveResources(document, assembled);
  return assembled;
}
