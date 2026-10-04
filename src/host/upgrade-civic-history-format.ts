import type { Simulation } from '../simulation';
import type { CommandResult } from '../types';
import { createCivicHistory } from '../simulation/civic-history';
import { prepareCivicHistoryArchive } from '../simulation/civic-staffing';
import { validateCityRulesetEnvelope } from '../simulation/city-ruleset';

/** Trusted host-only capability. Gameplay, generic events and load hooks cannot
 * invoke this migration; legal enablement and its original source stay intact. */
export async function upgradeCivicHistoryFormat(simulation: Simulation, expectedCurrentV3SHA256: string): Promise<CommandResult> {
  if (typeof expectedCurrentV3SHA256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedCurrentV3SHA256)) return { ok: false, message: '历史格式升级需要当前 v3 原件的精确 SHA256。' };
  try {
    if (simulation.saveVersion !== 3) return { ok: false, message: '只有已完整声明原公民规则的 v3 城市可升级历史格式。' };
    const snapshot = simulation.exportSave(), validated = simulation.validateSave(snapshot);
    if (!validated.ok) return { ok: false, message: `原件未通过完整生产读取校验：${validated.message}` };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedCurrentV3SHA256 || simulation.exportSave() !== snapshot) return { ok: false, message: '原件 SHA 不匹配或等待期间城市已继续；原城市未改变。' };
    const candidate = JSON.parse(snapshot), motionVersion = validateCityRulesetEnvelope(candidate), civic = candidate.state.civicStaffing;
    const at = candidate.state.extension?.lastUpdate ?? candidate.state.day * 1440 + candidate.state.hour * 60;
    candidate.state.civicHistory = createCivicHistory(civic.enablement.id, motionVersion, at, candidate.state.tick, {
      sourceSave: { version: 3, sha256: actual },
      sourceCounts: { proofs: civic.proofs.length, applications: civic.applications.length, polls: civic.polls.length, terms: civic.terms.length,
        retiredProofCount: civic.retiredProofCount, nextProofId: civic.nextProofId, nextApplicationId: civic.nextApplicationId, nextPollId: civic.nextPollId, nextTermId: civic.nextTermId },
    });
    candidate.state.civicStaffing = { ...civic, version: 2, historyId: candidate.state.civicHistory.id };
    const archive = prepareCivicHistoryArchive(candidate.state, simulation.worldDefinition);
    if (archive) Object.assign(candidate.state, archive);
    candidate.version = 4; candidate.historyPolicyId = 'civic-history-pages-v1';
    candidate.runtime.civicStaffingVersion = 2; candidate.runtime.civicHistoryVersion = 1;
    candidate.runtime.persistedModules.push('civicHistory');
    // One complete reader checks all hot/cold business records, labor and both
    // actual budget copies before committing state/runtime exactly once.
    return simulation.importSave(JSON.stringify(candidate));
  } catch (error) { return { ok: false, message: `历史格式升级被拒绝：${error instanceof Error ? error.message : '格式错误'}；原城市未改变。` }; }
}
