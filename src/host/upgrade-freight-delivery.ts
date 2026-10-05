import type { Simulation } from '../simulation';
import type { CommandResult } from '../types';
import { ROAD_FOOD_PICKUP_POLICY } from '../simulation/freight-access';
import { ROAD_FOOD_DELIVERY_POLICY } from '../simulation/freight-delivery';

/** Explicit host cutover from the existing road pickup contract. Only the two
 * delivery declarations change; routing remains derived from real arrivals. */
export async function upgradeFreightDelivery(simulation: Simulation, expectedCurrentV4SHA256: string): Promise<CommandResult> {
  if (typeof expectedCurrentV4SHA256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedCurrentV4SHA256)) return { ok: false, message: '道路粮食送货升级需要当前 v4 原件的精确 SHA256。' };
  try {
    if (simulation.saveVersion !== 4 || simulation.motionVersion !== 2
      || simulation.freightPickupPolicyId !== ROAD_FOOD_PICKUP_POLICY || simulation.freightDeliveryPolicyId !== 'legacy') return { ok: false, message: '只有已声明道路粮食装货、尚未声明送货规则的 v4/motion2 城市可升级。' };
    const snapshot = simulation.exportSave(), validated = simulation.validateSave(snapshot);
    if (!validated.ok) return { ok: false, message: `原件未通过完整生产读取校验：${validated.message}` };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedCurrentV4SHA256 || simulation.exportSave() !== snapshot) return { ok: false, message: '原件 SHA 不匹配或等待期间城市已继续；原城市未改变。' };
    const candidate = JSON.parse(snapshot);
    candidate.freightDeliveryPolicyId = ROAD_FOOD_DELIVERY_POLICY;
    candidate.runtime.freightDeliveryPolicyId = ROAD_FOOD_DELIVERY_POLICY;
    return simulation.importSave(JSON.stringify(candidate));
  } catch (error) { return { ok: false, message: `道路粮食送货升级被拒绝：${error instanceof Error ? error.message : '格式错误'}；原城市未改变。` }; }
}
