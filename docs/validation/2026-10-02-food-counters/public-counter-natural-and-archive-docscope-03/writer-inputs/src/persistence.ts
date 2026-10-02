import { assembleSave, partitionSave, type SavePart, type SaveWorld } from './persistence/partition';
import { SaveSession, SaveSessionError, type SaveSessionOptions } from './persistence/session';
export { SaveSession, SaveSessionError } from './persistence/session';
export type { SaveSessionOptions, SaveSessionHeader, SaveSessionStats } from './persistence/session';

const DB_NAME = 'yunshan-city';
const LEGACY_STORE = 'journeys';
const MANIFESTS = 'save-manifests';
const STORES = ['save-global', 'save-player', 'save-chunks'] as const;
const LEGACY_KEY = 'yunshan.save.v1';
const LEGACY_TIME = 'yunshan.save.timestamp.v1';
const FALLBACK_KEY = 'yunshan.save.fallback.v2';
let database: Promise<IDBDatabase> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let latestTimestamp = 0;

type Store = typeof STORES[number];
interface StoredPart { id: string; json: string; checksum: string }
interface PartReference { id: string; recordId: string; store: Store; checksum: string }
interface Snapshot { generation: number; savedAt: number; parts: PartReference[] }
interface Manifest extends Snapshot { id: 'autosave'; version: 2; previous?: Snapshot }
interface SavedJourney { id: string; savedAt: number; json: string }
interface ReaderLease { id: string; version: 1; expiresAt: number; snapshots: Snapshot[] }
const LEASE_DURATION = 5 * 60_000;
export interface SaveStorageStatus {
  backend: 'none' | 'indexeddb' | 'localStorage';
  recoveredPrevious: boolean;
  lastWrite: { savedAt: number; generation: number; chunksWritten: number; totalChunks: number; globalWritten: boolean; playerWritten: boolean; bytesWritten: number; removedRecords: number } | null;
}
let status: SaveStorageStatus = { backend: 'none', recoveredPrevious: false, lastWrite: null };

/** Diagnostics describe completed storage operations, not simulation or rendering tiers. */
export function getSaveStorageStatus(): SaveStorageStatus { return structuredClone(status); }

// Equality also compares complete JSON: hash collisions cannot skip dirty data.
function checksum(json: string): string {
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
  return `${json.length}:${hash >>> 0}`;
}
function storeFor(part: Pick<SavePart, 'id'>): Store { return part.id === 'global' ? STORES[0] : part.id === 'player' ? STORES[1] : STORES[2]; }
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('Save request failed')); });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Save transaction aborted'));
    transaction.onerror = () => { /* onabort reports the final transaction outcome. */ };
  });
}
function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Snapshot;
  return Number.isSafeInteger(snapshot.generation) && snapshot.generation > 0 && Number.isFinite(snapshot.savedAt) &&
    Array.isArray(snapshot.parts) && snapshot.parts.length >= 2 && snapshot.parts.length <= 10000 &&
    snapshot.parts.every(part => part && typeof part.id === 'string' && (part.id === 'global' || part.id === 'player' || part.id.startsWith('chunk:')) && typeof part.recordId === 'string' && part.store === storeFor(part) && typeof part.checksum === 'string') &&
    new Set(snapshot.parts.map(part => part.id)).size === snapshot.parts.length && snapshot.parts.some(part => part.id === 'global') && snapshot.parts.some(part => part.id === 'player');
}
function snapshotOf(manifest: Manifest): Snapshot { return { generation: manifest.generation, savedAt: manifest.savedAt, parts: manifest.parts }; }
function validLease(value: unknown): value is ReaderLease {
  if (!value || typeof value !== 'object') return false;
  const lease = value as ReaderLease;
  return typeof lease.id === 'string' && lease.id.startsWith('reader:') && lease.version === 1 && Number.isFinite(lease.expiresAt) &&
    Array.isArray(lease.snapshots) && lease.snapshots.length > 0 && lease.snapshots.length <= 2 && lease.snapshots.every(validSnapshot);
}
const referenceKey = (reference: PartReference): string => `${reference.store}/${reference.recordId}`;
function collectGarbage(transaction: IDBTransaction, rows: unknown[], keep: PartReference[], candidates: PartReference[], now: number): number {
  const retained = new Set(keep.map(referenceKey));
  for (const row of rows) if (validLease(row)) {
    if (row.expiresAt > now) row.snapshots.forEach(snapshot => snapshot.parts.forEach(part => retained.add(referenceKey(part))));
    else { transaction.objectStore(MANIFESTS).delete(row.id); candidates.push(...row.snapshots.flatMap(snapshot => snapshot.parts)); }
  }
  let removed = 0;
  for (const [key, reference] of new Map(candidates.map(part => [referenceKey(part), part]))) if (!retained.has(key)) {
    transaction.objectStore(reference.store).delete(reference.recordId); removed++;
  }
  return removed;
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    let failed = false;
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      for (const store of [LEGACY_STORE, MANIFESTS, ...STORES]) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'id' });
    };
    request.onerror = () => { failed = true; reject(request.error ?? new Error('Cannot open save database')); };
    request.onblocked = () => { failed = true; reject(new Error('Save database is blocked by another tab')); };
    request.onsuccess = () => {
      const db = request.result;
      if (failed) { db.close(); return; }
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
  }).catch(error => { database = null; throw error; });
  return database;
}

function fallbackSaves(): SavedJourney[] {
  const saves: SavedJourney[] = [];
  try {
    const json = localStorage.getItem(FALLBACK_KEY);
    if (json) { const data = JSON.parse(json); if (data.version === 2 && typeof data.json === 'string' && Number.isFinite(data.savedAt)) saves.push({ id: 'fallback', savedAt: data.savedAt, json: data.json }); }
  } catch { /* Legacy saves remain independent of the newer fallback envelope. */ }
  try {
    const json = localStorage.getItem(LEGACY_KEY), savedAt = Number(localStorage.getItem(LEGACY_TIME) ?? '0');
    if (json) saves.push({ id: 'legacy', savedAt: Number.isFinite(savedAt) ? savedAt : 0, json });
  } catch { /* Browsers can block localStorage independently of IndexedDB. */ }
  return saves;
}

async function commitSave(parts: SavePart[], json: string): Promise<void> {
  let savedAt = Math.max(Date.now(), latestTimestamp + 1, ...fallbackSaves().map(save => save.savedAt + 1));
  try {
    const db = await openDatabase();
    const transaction = db.transaction([MANIFESTS, ...STORES], 'readwrite');
    const complete = transactionDone(transaction);
    complete.catch(() => {});
    try {
      const [stored, metadata] = await Promise.all([
        requestValue<Manifest | undefined>(transaction.objectStore(MANIFESTS).get('autosave')),
        requestValue<unknown[]>(transaction.objectStore(MANIFESTS).getAll()),
      ]);
      const current = stored?.version === 2 && validSnapshot(stored) ? stored : undefined;
      const generation = (Number.isSafeInteger(stored?.generation) ? stored!.generation : 0) + 1;
      savedAt = Math.max(savedAt, (current?.savedAt ?? 0) + 1);
      const oldById = new Map(current?.parts.map(part => [part.id, part]) ?? []);
      const priorRecords = await Promise.all((current?.parts ?? []).map(reference => requestValue<StoredPart | undefined>(transaction.objectStore(reference.store).get(reference.recordId))));
      const recordsById = new Map(current?.parts.map((reference, index) => [reference.id, priorRecords[index]]) ?? []);
      const oldRecords = parts.map(part => recordsById.get(part.id));
      let previous: Snapshot | undefined;
      if (current && current.parts.every((reference, index) => priorRecords[index]?.checksum === reference.checksum && typeof priorRecords[index]?.json === 'string' && checksum(priorRecords[index]!.json) === reference.checksum)) previous = snapshotOf(current);
      else if (stored?.previous && validSnapshot(stored.previous) && await readSnapshot(transaction, stored.previous) !== null) previous = stored.previous;
      const references: PartReference[] = [];
      const written = { savedAt, generation, chunksWritten: 0, totalChunks: parts.filter(part => part.id.startsWith('chunk:')).length, globalWritten: false, playerWritten: false, bytesWritten: 0, removedRecords: 0 };
      parts.forEach((part, index) => {
        const previous = oldById.get(part.id), old = oldRecords[index];
        const digest = checksum(part.json);
        if (previous && old?.json === part.json && old.checksum === digest && previous.checksum === digest) { references.push(previous); return; }
        const store = storeFor(part), recordId = `${generation}:${part.id}`;
        transaction.objectStore(store).put({ id: recordId, json: part.json, checksum: digest } satisfies StoredPart);
        references.push({ id: part.id, recordId, store, checksum: digest });
        if (part.id === 'global') written.globalWritten = true;
        else if (part.id === 'player') written.playerWritten = true;
        else written.chunksWritten++;
        written.bytesWritten += new TextEncoder().encode(part.json).byteLength;
      });
      // Keep one complete prior generation, including its reused records.
      written.removedRecords = collectGarbage(transaction, metadata, [...references, ...(previous?.parts ?? [])],
        [...(current?.parts ?? []), ...(stored?.previous && validSnapshot(stored.previous) ? stored.previous.parts : [])], Date.now());
      transaction.objectStore(MANIFESTS).put({ id: 'autosave', version: 2, generation, savedAt, parts: references, ...(previous ? { previous } : {}) } satisfies Manifest);
      await complete;
      latestTimestamp = savedAt;
      status = { backend: 'indexeddb', recoveredPrevious: false, lastWrite: written };
    } catch (error) {
      try { transaction.abort(); } catch { /* It may already have aborted. */ }
      await complete.catch(() => {});
      throw error;
    }
  } catch (databaseError) {
    // A single setItem atomically stores JSON plus time; retain old v1 records.
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify({ version: 2, savedAt, json }));
      latestTimestamp = savedAt;
      status = { backend: 'localStorage', recoveredPrevious: false, lastWrite: { savedAt, generation: 0, chunksWritten: 0, totalChunks: parts.length - 2, globalWritten: true, playerWritten: true, bytesWritten: new TextEncoder().encode(json).byteLength, removedRecords: 0 } };
    } catch { throw databaseError; }
  }
}

/** Commit changed geographic chunks, global state and player state atomically.
 * Optional world data locates buildings and signals; JSON exports stay v1. */
export function writeSavedGame(json: string, world?: SaveWorld): Promise<void> {
  let parts: SavePart[];
  try { parts = partitionSave(json, world); } catch (error) { return Promise.reject(error); }
  const operation = writeQueue.then(() => commitSave(parts, json));
  writeQueue = operation.catch(() => {});
  return operation;
}

async function readSnapshot(transaction: IDBTransaction, snapshot: Snapshot): Promise<string | null> {
  try {
    if (!validSnapshot(snapshot)) return null;
    const parts = await Promise.all(snapshot.parts.map(async reference => {
      const record = await requestValue<StoredPart | undefined>(transaction.objectStore(reference.store).get(reference.recordId));
      if (!record || typeof record.json !== 'string' || record.checksum !== reference.checksum || checksum(record.json) !== reference.checksum) throw new Error('Incomplete save generation');
      return { id: reference.id, json: record.json };
    }));
    return assembleSave(parts);
  } catch { return null; }
}

export async function readSavedGame(): Promise<string | null> {
  await writeQueue;
  const candidates: (SavedJourney & { backend: 'localStorage' | 'indexeddb'; recovered: boolean })[] = fallbackSaves().map(save => ({ ...save, backend: 'localStorage', recovered: false }));
  try {
    const db = await openDatabase();
    const transaction = db.transaction([LEGACY_STORE, MANIFESTS, ...STORES], 'readonly');
    const complete = transactionDone(transaction); complete.catch(() => {});
    const [manifest, legacy] = await Promise.all([
      requestValue<Manifest | undefined>(transaction.objectStore(MANIFESTS).get('autosave')),
      requestValue<SavedJourney | undefined>(transaction.objectStore(LEGACY_STORE).get('autosave')),
    ]);
    if (manifest?.version === 2) {
      const snapshots = [manifest, manifest.previous].filter((snapshot): snapshot is Snapshot => validSnapshot(snapshot));
      const loaded = await Promise.all(snapshots.map(snapshot => readSnapshot(transaction, snapshot)));
      snapshots.forEach((snapshot, index) => { if (loaded[index] !== null) candidates.push({ id: 'autosave', savedAt: snapshot.savedAt, json: loaded[index]!, backend: 'indexeddb', recovered: snapshot !== manifest }); });
    }
    if (legacy && typeof legacy.json === 'string' && Number.isFinite(legacy.savedAt)) candidates.push({ ...legacy, backend: 'indexeddb', recovered: false });
    await complete;
  } catch { /* The legacy fallback remains readable when IDB is unavailable. */ }
  const newest = candidates.sort((a, b) => b.savedAt - a.savedAt)[0];
  if (newest) { latestTimestamp = Math.max(latestTimestamp, newest.savedAt); status.backend = newest.backend; status.recoveredPrevious = newest.recovered; return newest.json; }
  return null;
}

async function readPart(transaction: IDBTransaction, reference: PartReference): Promise<SavePart> {
  const record = await requestValue<StoredPart | undefined>(transaction.objectStore(reference.store).get(reference.recordId));
  if (!record || typeof record.json !== 'string' || record.checksum !== reference.checksum || checksum(record.json) !== reference.checksum) throw new SaveSessionError('Pinned save generation is incomplete or damaged');
  const value = JSON.parse(record.json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SaveSessionError('Invalid save part');
  if (reference.id === 'global' && (value.document?.format !== 'yunshan-save' || !value.layout?.arrays || !value.layout?.maps)) throw new SaveSessionError('Invalid save header');
  if (reference.id === 'player' && (!value.values || !value.maps)) throw new SaveSessionError('Invalid player part');
  if (reference.id.startsWith('chunk:') && (!value.arrays || !value.maps)) throw new SaveSessionError('Invalid geographic part');
  return { id: reference.id, json: record.json };
}
async function releaseLease(id: string): Promise<void> {
  const db = await openDatabase(), transaction = db.transaction([MANIFESTS, ...STORES], 'readwrite');
  const complete = transactionDone(transaction); complete.catch(() => {});
  try {
    const rows = await requestValue<unknown[]>(transaction.objectStore(MANIFESTS).getAll());
    const lease = rows.find(row => validLease(row) && row.id === id) as ReaderLease | undefined;
    const manifest = rows.find(row => (row as Manifest)?.id === 'autosave') as Manifest | undefined;
    const keep = [...(validSnapshot(manifest) ? manifest.parts : []), ...(validSnapshot(manifest?.previous) ? manifest!.previous!.parts : [])];
    transaction.objectStore(MANIFESTS).delete(id);
    collectGarbage(transaction, rows.filter(row => (row as ReaderLease)?.id !== id), keep, lease?.snapshots.flatMap(snapshot => snapshot.parts) ?? [], Date.now());
    await complete;
  } catch (error) { try { transaction.abort(); } catch { /* Already finished. */ } await complete.catch(() => {}); throw error; }
}
function memorySession(save: SavedJourney, backend: 'indexeddb' | 'localStorage', options: SaveSessionOptions, recovered = false): SaveSession {
  // v1/fallback blobs necessarily require one full read and decomposition. The
  // modern indexeddb path below never reads unrequested geographic records.
  const parts = new Map(partitionSave(save.json, options.world).map(part => [part.id, part]));
  return new SaveSession({ generation: 0, savedAt: save.savedAt, backend, recoveredPrevious: recovered, chunkIds: [...parts.keys()].filter(id => id.startsWith('chunk:')) }, parts.get('global')!, parts.get('player')!, {
    check() {}, async read(id) { return parts.get(id)!; }, async release() { parts.clear(); }, async recover() { return null; },
  }, options);
}
async function legacySession(options: SaveSessionOptions, before = Infinity, recovered = false): Promise<SaveSession | null> {
  const candidates: { save: SavedJourney; backend: 'indexeddb' | 'localStorage' }[] = fallbackSaves().map(save => ({ save, backend: 'localStorage' }));
  try {
    const db = await openDatabase(), transaction = db.transaction(LEGACY_STORE, 'readonly');
    const complete = transactionDone(transaction); complete.catch(() => {});
    const legacy = await requestValue<SavedJourney | undefined>(transaction.objectStore(LEGACY_STORE).get('autosave'));
    await complete;
    if (legacy && typeof legacy.json === 'string' && Number.isFinite(legacy.savedAt)) candidates.push({ save: legacy, backend: 'indexeddb' });
  } catch { /* Independent fallback may still be available. */ }
  for (const { save, backend } of candidates.sort((a, b) => b.save.savedAt - a.save.savedAt)) if (save.savedAt < before) {
    try { return memorySession(save, backend, options, recovered); } catch { /* Skip malformed legacy candidates. */ }
  }
  return null;
}
async function pinnedSession(options: SaveSessionOptions, forced?: Snapshot, sourceLease?: string): Promise<SaveSession | null> {
  const db = await openDatabase(), transaction = db.transaction([MANIFESTS, ...STORES], 'readwrite');
  const complete = transactionDone(transaction); complete.catch(() => {});
  let snapshot: Snapshot, previous: Snapshot | undefined, global: SavePart, player: SavePart;
  let recovered = !!forced, expiresAt = Date.now() + LEASE_DURATION;
  const id = `reader:${crypto.randomUUID()}`;
  try {
    if (sourceLease) {
      const source = await requestValue<ReaderLease | undefined>(transaction.objectStore(MANIFESTS).get(sourceLease));
      if (!validLease(source) || source.expiresAt <= Date.now()) throw new SaveSessionError('Save reader lease expired; reopen the whole generation');
    }
    const manifest = await requestValue<Manifest | undefined>(transaction.objectStore(MANIFESTS).get('autosave'));
    const choices: Snapshot[] = forced ? [forced] : manifest?.version === 2 && validSnapshot(manifest) ? [snapshotOf(manifest), ...(validSnapshot(manifest.previous) ? [manifest.previous] : [])] : [];
    if (!choices.length) { await complete; return null; }
    // A newer atomic fallback envelope supersedes an older IDB save, matching
    // the full-save API, while legacy IDB blobs stay untouched on this fast path.
    if (!forced) {
      const local = fallbackSaves().filter(save => save.savedAt > choices[0].savedAt).sort((a, b) => b.savedAt - a.savedAt);
      for (const save of local) { try { const session = memorySession(save, 'localStorage', options); await complete; return session; } catch { /* Try the valid IDB headers. */ } }
    }
    let selected: { snapshot: Snapshot; global: SavePart; player: SavePart; index: number } | undefined;
    for (let index = 0; index < choices.length; index++) {
      const candidate = choices[index];
      try {
        const [g, p] = await Promise.all(['global', 'player'].map(partId => readPart(transaction, candidate.parts.find(part => part.id === partId)!)));
        selected = { snapshot: candidate, global: g, player: p, index }; break;
      } catch { /* Header damage chooses a whole previous generation. */ }
    }
    if (!selected) { await complete; return null; }
    snapshot = structuredClone(selected.snapshot); global = selected.global; player = selected.player;
    recovered ||= selected.index > 0;
    previous = !forced && selected.index === 0 && choices[1] ? structuredClone(choices[1]) : undefined;
    transaction.objectStore(MANIFESTS).put({ id, version: 1, expiresAt, snapshots: [snapshot, ...(previous ? [previous] : [])] } satisfies ReaderLease);
    await complete;
  } catch (error) { try { transaction.abort(); } catch { /* Already finished. */ } await complete.catch(() => {}); throw error; }
  const references = new Map(snapshot.parts.map(reference => [reference.id, reference]));
  const check = (): void => { if (Date.now() >= expiresAt) throw new SaveSessionError('Save reader lease expired; reopen the whole generation'); };
  const leaseTransaction = async (renew: boolean, partId?: string): Promise<SavePart | undefined> => {
    check();
    const transaction = db.transaction(partId ? [MANIFESTS, references.get(partId)!.store] : [MANIFESTS], renew ? 'readwrite' : 'readonly');
    const complete = transactionDone(transaction); complete.catch(() => {});
    try {
      const lease = await requestValue<ReaderLease | undefined>(transaction.objectStore(MANIFESTS).get(id));
      if (!validLease(lease) || lease.expiresAt <= Date.now()) throw new SaveSessionError('Save reader lease expired; reopen the whole generation');
      let nextExpiry = lease.expiresAt;
      if (renew) { nextExpiry = Date.now() + LEASE_DURATION; transaction.objectStore(MANIFESTS).put({ ...lease, expiresAt: nextExpiry }); }
      const part = partId ? await readPart(transaction, references.get(partId)!) : undefined;
      await complete; expiresAt = nextExpiry; return part;
    } catch (error) { try { transaction.abort(); } catch { /* Already finished. */ } await complete.catch(() => {}); throw error; }
  };
  latestTimestamp = Math.max(latestTimestamp, snapshot.savedAt);
  return new SaveSession({ generation: snapshot.generation, savedAt: snapshot.savedAt, backend: 'indexeddb', recoveredPrevious: recovered, chunkIds: snapshot.parts.filter(part => part.id.startsWith('chunk:')).map(part => part.id) }, global, player, {
    check, async read(partId) { return (await leaseTransaction(false, partId))!; }, async renew() { await leaseTransaction(true); }, async release() { await releaseLease(id); },
    async recover() {
      if (previous) { const recovered = await pinnedSession(options, previous, id); if (recovered) return recovered; }
      return legacySession(options, snapshot.savedAt, true);
    },
  }, options);
}

/** Open global/player metadata and pin a generation without fetching its city
 * chunks. Old whole-blob saves use the explicitly separate compatibility path. */
export async function openSavedGameSession(options: SaveSessionOptions = {}): Promise<SaveSession | null> {
  for (const [value, maximum] of [[options.maxCachedChunks, 128], [options.maxCachedBytes, 16 * 1024 * 1024]]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > maximum!)) throw new RangeError('Invalid save session cache limit');
  await writeQueue;
  try { const session = await pinnedSession(options); if (session) return session; } catch { /* IDB failure preserves whole-blob compatibility. */ }
  return legacySession(options);
}
