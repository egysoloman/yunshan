import { assembleSave, type SavePart, type SaveWorld } from './partition';

export interface SaveSessionOptions { maxCachedChunks?: number; maxCachedBytes?: number; world?: SaveWorld }
export interface SaveSessionHeader {
  readonly generation: number;
  readonly savedAt: number;
  readonly backend: 'indexeddb' | 'localStorage';
  readonly recoveredPrevious: boolean;
  readonly chunkIds: readonly string[];
}
export interface SaveSessionStats {
  chunkReads: number; cacheHits: number; bytesRead: number;
  cachedChunks: number; cachedBytes: number; closed: boolean; invalidated: boolean;
}
/** Storage driver owns the durable generation lease; readers never substitute
 * individual parts from another generation. */
export interface SaveSessionDriver {
  read(id: string): Promise<SavePart>;
  check(): void;
  renew?(): Promise<void>;
  release(): Promise<void>;
  recover(): Promise<SaveSession | null>;
}
export class SaveSessionError extends Error {
  constructor(message: string) { super(message); this.name = 'SaveSessionError'; }
}
const bytes = (json: string): number => new TextEncoder().encode(json).byteLength;

/** A pinned storage view, not a partially restored simulation. Only materialize
 * returns a complete save suitable for Simulation.importSave. */
export class SaveSession {
  readonly header: SaveSessionHeader;
  readonly global: Readonly<SavePart>;
  readonly player: Readonly<SavePart>;
  private readonly ids: Set<string>;
  private readonly cache = new Map<string, { part: Readonly<SavePart>; bytes: number }>();
  private readonly pending = new Map<string, Promise<Readonly<SavePart>>>();
  private readonly limits: { chunks: number; bytes: number };
  private readonly counters: SaveSessionStats = { chunkReads: 0, cacheHits: 0, bytesRead: 0, cachedChunks: 0, cachedBytes: 0, closed: false, invalidated: false };
  private timer?: ReturnType<typeof setInterval>;
  private failure?: SaveSessionError;
  private closing?: Promise<void>;
  constructor(header: SaveSessionHeader, global: SavePart, player: SavePart, private readonly driver: SaveSessionDriver, options: SaveSessionOptions = {}) {
    this.header = Object.freeze({ ...header, chunkIds: Object.freeze([...header.chunkIds]) });
    this.global = Object.freeze({ ...global }); this.player = Object.freeze({ ...player });
    this.ids = new Set(header.chunkIds);
    const bound = (value: number | undefined, fallback: number, maximum: number): number => value === undefined ? fallback : Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : (() => { throw new RangeError('Invalid save session cache limit'); })();
    this.limits = { chunks: bound(options.maxCachedChunks, 32, 128), bytes: bound(options.maxCachedBytes, 4 * 1024 * 1024, 16 * 1024 * 1024) };
    if (driver.renew) this.timer = setInterval(() => { void driver.renew!().catch(error => this.invalidate(error)); }, 60_000);
  }
  private invalidate(error: unknown): SaveSessionError {
    this.failure ??= error instanceof SaveSessionError ? error : new SaveSessionError(error instanceof Error ? error.message : 'Save generation unavailable');
    this.counters.invalidated = true; this.cache.clear(); this.counters.cachedBytes = 0;
    if (this.timer !== undefined) clearInterval(this.timer);
    return this.failure;
  }
  private check(): void {
    if (this.counters.closed) throw new SaveSessionError('Save session is closed');
    if (this.failure) throw this.failure;
    try { this.driver.check(); } catch (error) { throw this.invalidate(error); }
  }
  async readChunk(id: string): Promise<Readonly<SavePart> | null> {
    this.check();
    if (!this.ids.has(id)) return null;
    const hit = this.cache.get(id);
    if (hit) { this.cache.delete(id); this.cache.set(id, hit); this.counters.cacheHits++; return hit.part; }
    const pending = this.pending.get(id); if (pending) return pending;
    const read = (async () => {
      try {
        const part = Object.freeze({ ...await this.driver.read(id) });
        this.counters.chunkReads++; this.counters.bytesRead += bytes(part.json);
        this.check();
        const size = bytes(part.json);
        if (this.limits.chunks > 0 && size <= this.limits.bytes) {
          this.cache.set(id, { part, bytes: size }); this.counters.cachedBytes += size;
          while (this.cache.size > this.limits.chunks || this.counters.cachedBytes > this.limits.bytes) {
            const [oldId, old] = this.cache.entries().next().value!; this.cache.delete(oldId); this.counters.cachedBytes -= old.bytes;
          }
        }
        return part;
      } catch (error) { throw this.invalidate(error); }
      finally { this.pending.delete(id); }
    })();
    this.pending.set(id, read); return read;
  }
  async materialize(): Promise<string> {
    this.check();
    const parts: SavePart[] = [{ ...this.global }, { ...this.player }];
    // Bounded outstanding IDB requests; whole restore deliberately holds all JSON.
    for (let i = 0; i < this.header.chunkIds.length; i += 8) {
      const loaded = await Promise.all(this.header.chunkIds.slice(i, i + 8).map(id => this.readChunk(id)));
      parts.push(...loaded as SavePart[]);
    }
    this.check();
    try { return assembleSave(parts); } catch (error) { throw this.invalidate(error); }
  }
  /** Recovery creates a distinct complete-generation view. The caller must
   * discard data activated from this reader before using the returned reader. */
  async recover(): Promise<SaveSession | null> {
    if (this.counters.closed) throw new SaveSessionError('Save session is closed');
    return this.driver.recover();
  }
  getStats(): SaveSessionStats { return { ...this.counters, cachedChunks: this.cache.size }; }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.counters.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.cache.clear(); this.counters.cachedBytes = 0;
    this.closing = (async () => { await Promise.allSettled(this.pending.values()); await this.driver.release(); })();
    return this.closing;
  }
}
