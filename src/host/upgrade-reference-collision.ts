import type { Simulation } from '../simulation';
import type { CommandResult } from '../types';
import { CONTINUOUS_REFERENCE_COLLISION_POLICY } from '../simulation/reference-collision';

/** Trusted host-only cutover. Loading an old city and ordinary gameplay cannot
 * select a new collision policy. Only two policy fields change: no actor,
 * route, cursor, clock, need, money, inventory or random state is rewritten. */
export async function upgradeReferenceCollision(simulation: Simulation, expectedCurrentV4SHA256: string): Promise<CommandResult> {
  if (typeof expectedCurrentV4SHA256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedCurrentV4SHA256)) return { ok: false, message: '通行规则升级需要当前 v4 原件的精确 SHA256。' };
  try {
    if (simulation.saveVersion !== 4 || simulation.motionVersion !== 2 || simulation.referenceCollisionPolicyId !== 'legacy') return { ok: false, message: '只有尚未声明新通行判据的 v4/motion2 城市可升级。' };
    const snapshot = simulation.exportSave(), validated = simulation.validateSave(snapshot);
    if (!validated.ok) return { ok: false, message: `原件未通过完整生产读取校验：${validated.message}` };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedCurrentV4SHA256 || simulation.exportSave() !== snapshot) return { ok: false, message: '原件 SHA 不匹配或等待期间城市已继续；原城市未改变。' };
    const candidate = JSON.parse(snapshot);
    candidate.referenceCollisionPolicyId = CONTINUOUS_REFERENCE_COLLISION_POLICY;
    candidate.runtime.referenceCollisionPolicyId = CONTINUOUS_REFERENCE_COLLISION_POLICY;
    return simulation.importSave(JSON.stringify(candidate));
  } catch (error) { return { ok: false, message: `通行规则升级被拒绝：${error instanceof Error ? error.message : '格式错误'}；原城市未改变。` }; }
}
