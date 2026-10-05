import { generationWorldText } from './world-generation-binding';
import { Simulation } from '../simulation';
import { savedWorldFingerprint } from '../persistence/world-layout';
import { FULL_SAVE_CHARACTER_LIMIT, parseSaveWithinResources } from '../persistence/save-resource';
import type { WorldDefinition } from '../types';

export interface WorldGeneration<C> {
  readonly revision: number;
  readonly worldSHA256: string;
  readonly world: WorldDefinition;
  readonly simulation: Simulation;
  readonly consumers: C;
}
export interface GenerationExpectation {
  revision: number;
  worldSHA256: string;
  sourceSaveSHA256: string;
}
export interface SelectedWorldSave {
  worldSHA256: string; saveSHA256: string; save: string;
}
export interface PreparedWorldGeneration {
  readonly kind: 'prepared-world-generation-v1';
  readonly sourceRevision: number;
  readonly nextRevision: number;
  readonly sourceSaveSHA256: string;
  readonly sourceWorldSHA256: string;
  readonly worldSHA256: string;
}
export interface GenerationResult { ok: boolean; message: string }
export type GenerationPreparation = GenerationResult & { prepared?: PreparedWorldGeneration };
/** Resolution is supplied by the trusted host. A checkpoint contains no geometry
 * and cannot add a world to this registry or grant a demolition entitlement. */
export interface WorldGenerationServices<C> {
  resolveWorld(worldSHA256: string): WorldDefinition | Promise<WorldDefinition>;
  /** Stage every consumer against these candidate references. The returned
   * bundle and all of its disposable inner resources must be exclusively new;
   * wrapping an old renderer/controller in a new object is forbidden. We track
   * bundle identity, not arbitrary nested GPU/DOM ownership. If staging throws,
   * the factory owns cleanup of resources not returned to us. */
  stageConsumers(world: WorldDefinition, simulation: Simulation): C | Promise<C>;
  releaseConsumers(consumers: C): void;
}
interface Record<C> {
  source: WorldGeneration<C>; sourceSave: string; sourceWorldText: string;
  candidate: WorldGeneration<C>; candidateSave: string; candidateWorldText: string;
}
interface Checkpoint {
  format: 'yunshan-world-generation'; version: 1; revision: number;
  worldSHA256: string; baseWorldFingerprint: string; saveSHA256: string; save: string;
}
// Weak ownership identities survive cancellation/retirement without retaining
// old consumers. Cross-host reuse cannot dispose another active generation.
const seenConsumers = new WeakSet<object>();
function claimConsumers(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) throw new Error('消费者资源必须为独立对象，或undefined表示无资源。');
  if (seenConsumers.has(value)) return false;
  seenConsumers.add(value); return true;
}
const hex = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const reject = (message: string): GenerationResult => ({ ok: false, message });
const message = (error: unknown) => error instanceof Error ? error.message : '事务输入无效';
export async function generationSHA256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** A host registry can pin a custom parameter world without invoking a city
 * recipe or trusting world data embedded in a save. */
export async function generationWorldSHA256(world: WorldDefinition): Promise<string> { return generationSHA256(generationWorldText(world)); }
function freezeDefinition(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeDefinition(child);
  Object.freeze(value);
}
function ownDefinition(world: WorldDefinition): WorldDefinition {
  const result = structuredClone(world);
  // New World/Building identities rebuild all WeakMap spatial/geometry caches.
  freezeDefinition(result);
  return result;
}
function checkpoint(json: string): Checkpoint {
  if (typeof json !== 'string' || json.length > FULL_SAVE_CHARACTER_LIMIT * 2 + 4096) throw new Error('世代检查点超过资源限制。');
  const data = JSON.parse(json) as Checkpoint;
  if (!data || Object.keys(data).sort().join(',') !== 'baseWorldFingerprint,format,revision,save,saveSHA256,version,worldSHA256'
    || data.format !== 'yunshan-world-generation' || data.version !== 1
    || !Number.isSafeInteger(data.revision) || data.revision < 0 || data.revision > 1e9
    || !hex(data.worldSHA256) || !hex(data.saveSHA256) || typeof data.baseWorldFingerprint !== 'string'
    || !/^[0-9a-f]{1,8}$/.test(data.baseWorldFingerprint) || typeof data.save !== 'string') throw new Error('世代检查点字段无效。');
  const save = parseSaveWithinResources(data.save);
  if (save.worldFingerprint !== data.baseWorldFingerprint) throw new Error('世代与原世界指纹不一致。');
  return data;
}

/** This host supports same-geometry reconstruction and explicit selection of a
 * different complete native session from the trusted World registry. The latter
 * is a session load, not a geometry patch or new resources in the current city.
 * It performs real Simulation replacement, import and consumer publication;
 * it does not execute unimplemented relocation, construction or demolition.
 * Geometry-changing patches need a separate rights/work/origin contract. */
export class WorldGenerationHost<C> {
  private active: WorldGeneration<C>;
  private readonly pending = new Map<PreparedWorldGeneration, Record<C>>();
  private disposed = false;
  private preparing = 0;
  private readonly releaseFailures: string[] = [];
  private constructor(active: WorldGeneration<C>, private readonly services: WorldGenerationServices<C>) { this.active = active; }
  static async attach<C>(simulation: Simulation, consumers: C, services: WorldGenerationServices<C>): Promise<WorldGenerationHost<C>> {
    const snapshot = simulation.exportSave(), text = generationWorldText(simulation.worldDefinition);
    const checked = simulation.validateSave(snapshot);
    if (!checked.ok) throw new Error(`原世代未通过完整生产校验：${checked.message}`);
    const worldSHA256 = await generationSHA256(text);
    if (simulation.exportSave() !== snapshot || generationWorldText(simulation.worldDefinition) !== text) throw new Error('建立事务宿主期间原世代已继续或几何改变。');
    if (!claimConsumers(consumers)) throw new Error('当前消费者已由另一个世代接管；没有释放该共享资源。');
    return new WorldGenerationHost(Object.freeze({ revision: 0, worldSHA256, world: simulation.worldDefinition, simulation, consumers }), services);
  }
  get current(): WorldGeneration<C> { return this.active; }
  /** Disposal problems occur after publication; callers can inspect them without
   * falsely reporting a rollback of an already committed generation. */
  get cleanupFailures(): readonly string[] { return [...this.releaseFailures]; }
  private release(consumers: C): void {
    try { this.services.releaseConsumers(consumers); } catch (error) { this.releaseFailures.push(message(error)); }
  }
  async prepareRebuild(expected: GenerationExpectation): Promise<GenerationPreparation> {
    if (!expected) return reject('世代预期无效。');
    return this.prepareSelected(expected, { worldSHA256: expected.worldSHA256, saveSHA256: expected.sourceSaveSHA256,
      save: this.active.simulation.exportSave() }, true);
  }
  /** Explicit trusted session loading. A selected native save keeps its own
   * original civic identity/history; no field is transplanted from either city. */
  async prepareLoad(expected: GenerationExpectation, selected: SelectedWorldSave): Promise<GenerationPreparation> {
    return this.prepareSelected(expected, selected, false);
  }
  private async prepareSelected(expected: GenerationExpectation, selected: SelectedWorldSave, rebuilding: boolean): Promise<GenerationPreparation> {
    if (this.disposed || this.pending.size + this.preparing >= 4 || !expected || !Number.isSafeInteger(expected.revision)
      || expected.revision < 0 || expected.revision >= 1e9 || !hex(expected.worldSHA256) || !hex(expected.sourceSaveSHA256) || !selected
      || !hex(selected.worldSHA256) || !hex(selected.saveSHA256) || typeof selected.save !== 'string' || selected.save.length > FULL_SAVE_CHARACTER_LIMIT) return reject('世代预期无效、宿主已退出或暂存事务已满。');
    expected = { ...expected }; selected = { ...selected };
    const source = this.active, sourceSave = source.simulation.exportSave(), sourceWorldText = generationWorldText(source.world);
    let staged: C | undefined, hasStaged = false;
    this.preparing++;
    try {
      if (expected.revision !== source.revision || expected.worldSHA256 !== source.worldSHA256) return reject('世代已改变；原实例未改变。');
      const checked = source.simulation.validateSave(sourceSave);
      if (!checked.ok) return reject(`原世代未通过完整生产校验：${checked.message}`);
      const [saveSHA, actualWorldSHA] = await Promise.all([generationSHA256(sourceSave), generationSHA256(sourceWorldText)]);
      if (saveSHA !== expected.sourceSaveSHA256 || actualWorldSHA !== source.worldSHA256) return reject('原件 SHA 或可信世界已改变；原实例未改变。');
      const selectedSave = selected.save, selectedWorldSHA = selected.worldSHA256, selectedSaveSHA = selected.saveSHA256;
      const selectedDocument = parseSaveWithinResources(selectedSave);
      if (await generationSHA256(selectedSave) !== selectedSaveSHA) return reject('选中业务原件 SHA 不匹配；原实例未改变。');
      const world = ownDefinition(await this.services.resolveWorld(selectedWorldSHA));
      if (this.disposed || this.active !== source || source.simulation.exportSave() !== sourceSave || generationWorldText(source.world) !== sourceWorldText) return reject('解析世界期间原世代已继续或退出；原实例未替换。');
      const candidateWorldText = generationWorldText(world);
      if (await generationSHA256(candidateWorldText) !== selectedWorldSHA || selectedDocument.worldFingerprint !== savedWorldFingerprint(world)) return reject('可信解析器没有返回选中原件绑定的完整世界；原实例未改变。');
      if (rebuilding && candidateWorldText !== sourceWorldText) return reject('不同几何不能冒充原城重建；尚无产权、施工及历史来源合同。');
      const simulation = new Simulation(world), imported = simulation.importSave(selectedSave);
      if (!imported.ok) return reject(`新实例未通过完整生产读取：${imported.message}`);
      if (simulation.exportSave() !== selectedSave) return reject('读取改变了选中原件的居民、钱料、路线或历史；原实例未改变。');
      staged = await this.services.stageConsumers(world, simulation);
      if (!claimConsumers(staged)) return reject('暂存消费者与当前、退休或另一候选资源同一对象；没有释放该共享资源，原实例未替换。');
      hasStaged = true;
      if (this.disposed || this.active !== source || source.simulation.exportSave() !== sourceSave || generationWorldText(source.world) !== sourceWorldText
        || simulation.exportSave() !== selectedSave || generationWorldText(world) !== candidateWorldText) {
        this.release(staged); hasStaged = false;
        return reject('等待期间原城市继续、世代改变或暂存资源改写了候选；原实例未替换。');
      }
      const candidate = Object.freeze({ revision: source.revision + 1, worldSHA256: selectedWorldSHA, world, simulation, consumers: staged });
      const prepared: PreparedWorldGeneration = Object.freeze({ kind: 'prepared-world-generation-v1', sourceRevision: source.revision,
        nextRevision: candidate.revision, sourceSaveSHA256: saveSHA, sourceWorldSHA256: source.worldSHA256, worldSHA256: selectedWorldSHA });
      this.pending.set(prepared, { source, sourceSave, sourceWorldText, candidate, candidateSave: selectedSave, candidateWorldText });
      return { ok: true, message: '完整候选已准备，原世代仍在运行；提交时再次核验原件。', prepared };
    } catch (error) {
      if (hasStaged) this.release(staged as C);
      return reject(`世代准备被拒绝：${message(error)}；原实例未替换。`);
    } finally { this.preparing--; }
  }
  /** A synchronous compare-and-swap publishes simulation/world/consumers as one
   * authoritative view. No await or externally supplied callback splits it. */
  commit(prepared: PreparedWorldGeneration): GenerationResult {
    const record = this.pending.get(prepared);
    if (this.disposed || !record) return reject('未知、已撤销或已用过的世代事务。');
    this.pending.delete(prepared);
    try {
      if (this.active !== record.source || record.source.simulation.exportSave() !== record.sourceSave || generationWorldText(record.source.world) !== record.sourceWorldText
        || record.candidate.simulation.exportSave() !== record.candidateSave || generationWorldText(record.candidate.world) !== record.candidateWorldText) {
        this.release(record.candidate.consumers);
        return reject('原城市继续或候选发生变化；世代提交拒绝，原实例仍有效。');
      }
      this.active = record.candidate;
    } catch (error) {
      this.release(record.candidate.consumers);
      return reject(`世代提交被拒绝：${message(error)}；原实例未替换。`);
    }
    this.release(record.source.consumers);
    return { ok: true, message: '新 Simulation、世界与全部声明消费者已作为一个世代发布；原业务存档逐字保留。' };
  }
  cancel(prepared: PreparedWorldGeneration): GenerationResult {
    const record = this.pending.get(prepared);
    if (!record) return reject('未知或已结束的世代事务。');
    this.pending.delete(prepared); this.release(record.candidate.consumers);
    return { ok: true, message: '候选世代已撤销，原实例继续有效。' };
  }
  async exportCheckpoint(): Promise<string> {
    if (this.disposed) throw new Error('世代宿主已退出。');
    const active = this.active, save = active.simulation.exportSave(), text = generationWorldText(active.world);
    const checked = active.simulation.validateSave(save);
    if (!checked.ok) throw new Error(checked.message);
    const [saveSHA256, worldSHA256] = await Promise.all([generationSHA256(save), generationSHA256(text)]);
    if (this.disposed || this.active !== active || active.simulation.exportSave() !== save || generationWorldText(active.world) !== text || worldSHA256 !== active.worldSHA256) throw new Error('导出期间世代继续或几何改变；没有生成检查点。');
    return JSON.stringify({ format: 'yunshan-world-generation', version: 1, revision: active.revision, worldSHA256,
      baseWorldFingerprint: savedWorldFingerprint(active.world), saveSHA256, save } satisfies Checkpoint);
  }
  static async restore<C>(json: string, expectedCheckpointSHA256: string, services: WorldGenerationServices<C>): Promise<WorldGenerationHost<C>> {
    if (!hex(expectedCheckpointSHA256)) throw new Error('恢复需要受信宿主提供检查点原件的精确 SHA256。');
    const data = checkpoint(json);
    if (await generationSHA256(json) !== expectedCheckpointSHA256 || await generationSHA256(data.save) !== data.saveSHA256) throw new Error('检查点或业务原件 SHA 不匹配。');
    const world = ownDefinition(await services.resolveWorld(data.worldSHA256)), text = generationWorldText(world);
    if (await generationSHA256(text) !== data.worldSHA256 || savedWorldFingerprint(world) !== data.baseWorldFingerprint) throw new Error('可信注册表无法重建此世代的原世界；没有退回新城。');
    const simulation = new Simulation(world), imported = simulation.importSave(data.save);
    if (!imported.ok || simulation.exportSave() !== data.save) throw new Error(`世代业务读取失败或改变了原件：${imported.message}`);
    const consumers = await services.stageConsumers(world, simulation);
    if (!claimConsumers(consumers)) throw new Error('恢复消费者已由另一世代接管或释放；没有释放该共享资源。');
    try {
      if (simulation.exportSave() !== data.save || generationWorldText(world) !== text) throw new Error('恢复消费者改写了候选世代。');
      return new WorldGenerationHost(Object.freeze({ revision: data.revision, worldSHA256: data.worldSHA256, world, simulation, consumers }), services);
    } catch (error) { services.releaseConsumers(consumers); throw error; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.pending.values()) this.release(record.candidate.consumers);
    this.pending.clear(); this.release(this.active.consumers);
  }
}
