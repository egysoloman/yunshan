import type { Simulation } from '../simulation';
import type { CommandResult } from '../types';
import { SERVICE_MATERIAL_POLICY } from '../simulation/service-material-scheduling';

/** Trusted host-only exact-current-v4 cutover. Normal import, gameplay and
 * generic events cannot activate a new procurement scheduling policy. */
export async function upgradeServiceMaterialScheduling(simulation: Simulation, expectedCurrentV4SHA256: string): Promise<CommandResult> {
  if (typeof expectedCurrentV4SHA256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedCurrentV4SHA256)) return { ok: false, message: '材料调度政策切换需要当前 v4 原件的精确 SHA256。' };
  try {
    if (simulation.saveVersion !== 4 || simulation.state.serviceMaterialScheduling !== undefined) return { ok: false, message: '仅无此政策的完整 v4 城市可显式切换材料调度。' };
    const snapshot = simulation.exportSave(), validation = simulation.validateSave(snapshot);
    if (!validation.ok) return { ok: false, message: `原件未通过完整生产读取校验：${validation.message}` };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedCurrentV4SHA256 || simulation.exportSave() !== snapshot) return { ok: false, message: '原件 SHA 不匹配或等待期间城市已继续；原城市未改变。' };
    const candidate = JSON.parse(snapshot);
    candidate.state.serviceMaterialScheduling = { version: 1, policyId: SERVICE_MATERIAL_POLICY, enablementId: candidate.state.civicStaffing.enablement.id,
      enabledAt: candidate.state.extension.lastUpdate, enabledTick: candidate.state.tick, sourceSave: { version: 4, sha256: actual } };
    candidate.runtime.serviceMaterialSchedulingVersion = 1; candidate.runtime.persistedModules.push('serviceMaterialScheduling');
    return simulation.importSave(JSON.stringify(candidate));
  } catch (error) { return { ok: false, message: `材料调度政策切换被拒绝：${error instanceof Error ? error.message : '格式错误'}；原城市未改变。` }; }
}
