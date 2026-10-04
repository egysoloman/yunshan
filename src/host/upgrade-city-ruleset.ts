import type { Simulation } from '../simulation';
import type { CommandResult, SimState } from '../types';
import { createCivicStaffingState } from '../simulation/civic-staffing';
import { createBudgetAuthorityState, upgradeSupplementalBudgetState } from '../simulation/budget-authority';
import { employmentCivicOfficials, PRODUCT_RULESET, validateCityRulesetEnvelope } from '../simulation/city-ruleset';

/** Trusted host capability, deliberately absent from gameplay commands/events/load hooks. */
export async function upgradeCityRuleset(simulation: Simulation, expectedCurrentSaveSHA256: string): Promise<CommandResult> {
  if (typeof expectedCurrentSaveSHA256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedCurrentSaveSHA256)) return { ok: false, message: '升级需要当前原存档的精确 SHA256。' };
  try {
    if (simulation.effectiveRuleset !== 'legacy') return { ok: false, message: '此城市已经声明产品规则；不能再次升级。' };
    const snapshot = simulation.exportSave();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedCurrentSaveSHA256 || simulation.exportSave() !== snapshot) return { ok: false, message: '升级原件 SHA 不匹配或城市已继续运行；原城市未改变。' };
    const candidate = JSON.parse(snapshot), motionVersion = validateCityRulesetEnvelope(candidate);
    const enablement = { id: `civic-host-${actual}`, ruleVersion: 1 as const, origin: 'host-upgrade' as const,
      enabledAt: candidate.state.extension?.lastUpdate ?? candidate.state.day * 1440 + candidate.state.hour * 60, enabledTick: candidate.state.tick,
      sourceSave: { sha256: actual, version: candidate.version as 1 | 2, motionVersion } };
    candidate.state.civicStaffing = createCivicStaffingState(enablement, employmentCivicOfficials(candidate.state as SimState, candidate.runtime.publicLabor, simulation.worldDefinition));
    candidate.runtime.civicStaffingVersion = 1;
    candidate.state.budgetAuthority = createBudgetAuthorityState(enablement, candidate.runtime.publicBudgets ?? [], candidate.state.culture);
    candidate.runtime.budgetAuthorityVersion = 1;
    upgradeSupplementalBudgetState(candidate.state.culture);
    candidate.runtime.persistedModules.push('civicStaffing', 'budgetAuthority');
    candidate.version = 3; candidate.rulesetId = PRODUCT_RULESET; candidate.motionVersion = motionVersion;
    // The complete production reader validates first and then commits once.
    return simulation.importSave(JSON.stringify(candidate));
  } catch (error) { return { ok: false, message: `升级被拒绝：${error instanceof Error ? error.message : '格式错误'}` }; }
}
