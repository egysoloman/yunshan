const DB_NAME = 'yunshan-city';
const STORE = 'journeys';
const LEGACY_KEY = 'yunshan.save.v1';
const LEGACY_TIME = 'yunshan.save.timestamp.v1';
let database: Promise<IDBDatabase> | null = null;
interface SavedJourney { id: string; savedAt: number; json: string }

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onerror = () => reject(request.error ?? new Error('Cannot open save database'));
    request.onblocked = () => reject(new Error('Save database is blocked by another tab'));
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
  }).catch(error => { database = null; throw error; });
  database = opened;
  return opened;
}

/** One transaction commits the whole deterministic snapshot, including timers and RNG. */
export async function writeSavedGame(json: string): Promise<void> {
  const savedAt = Date.now();
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put({ id: 'autosave', savedAt, json } satisfies SavedJourney);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Save failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Save transaction aborted'));
    });
  } catch (databaseError) {
    // A small compressed snapshot can also survive when private browsing blocks IDB.
    try { localStorage.setItem(LEGACY_KEY, json); localStorage.setItem(LEGACY_TIME, String(savedAt)); }
    catch { throw databaseError; }
  }
}

export async function readSavedGame(): Promise<string | null> {
  let saved: SavedJourney | null = null;
  try {
    const db = await openDatabase();
    saved = await new Promise<SavedJourney | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get('autosave');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('Save read failed'));
    });
  } catch { /* The legacy fallback remains readable when the database is unavailable. */ }
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    const legacyTime = Number(localStorage.getItem(LEGACY_TIME) ?? '0');
    if (legacy && (!saved || legacyTime > saved.savedAt)) return legacy;
  } catch { /* Browsers can disallow both storage APIs independently. */ }
  return saved && typeof saved.json === 'string' ? saved.json : null;
}
