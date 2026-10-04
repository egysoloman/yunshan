import type { LegacyBudgetAuthorization as BudgetAuthorization, BudgetAuthorization as AnyBudgetAuthorization } from '../../../src/simulation/budget-authority.ts';
import type { Building, Citizen, Role, SimState } from '../../../src/types.ts';
import type { PublicBudgetAuthorization } from '../../../src/simulation.ts';
export interface OriginalAuthorizationContext {
 state: SimState; now: number; buildings: Map<string, Building>; runtime: { publicBudgets?: AnyBudgetAuthorization[] };
 publicBudgetSnapshot(): { available: number }; buildingNear(targetId: string | undefined, kinds: string[]): Building | null;
 hasIdentity(role: Role): boolean; citizenIdentity(actor: Citizen): Role; isOnDuty(actorId: string, siteId: string): boolean;
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** Literal untouched original production method body; only the typed test
 * function header exposes it against the real current simulation object. */
export function originalAuthorizePublicBudget(this: OriginalAuthorizationContext, request: PublicBudgetAuthorization): boolean {
    const time = this.state.extension?.lastUpdate ?? this.now, site = this.buildings.get(request.siteId), budgets = this.runtime.publicBudgets ??= [];
    if (!site || !finite(request.cap) || request.cap <= 0 || request.cap > 1e6 || !finite(request.approvedAt) || Math.abs(request.approvedAt - time) > 1e-6
      || typeof request.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(request.id) || typeof request.purpose !== 'string' || !request.purpose.length || request.purpose.length > 100
      || !Array.isArray(request.approvedBy) || new Set(request.approvedBy).size !== request.approvedBy.length || budgets.some(budget => budget.id === request.id) || budgets.length >= 256 || request.cap > this.publicBudgetSnapshot().available) return false;
    const signatures: BudgetAuthorization['signatures'] = [];
    for (const actorId of request.approvedBy) {
      if (actorId === 'player') {
        const chamber = this.buildingNear(undefined, ['hall', 'core']);
        if (!this.hasIdentity('mayor') || !chamber || !this.state.extension?.actorProfiles.player.alive) return false;
        signatures.push({ actorId, role: 'mayor', siteId: chamber.id, signedAt: time });
      } else {
        const actor = this.state.citizens.find(c => c.id === actorId), workplace = actor && this.buildings.get(actor.workId);
        if (!actor || !workplace || !['official', 'council', 'mayor'].includes(this.citizenIdentity(actor)) || !['hall', 'core', 'bank'].includes(workplace.kind) || !this.isOnDuty(actorId, workplace.id)) return false;
        signatures.push({ actorId, role: this.citizenIdentity(actor), siteId: workplace.id, signedAt: time });
      }
    }
    const mayor = signatures.some(signature => signature.role === 'mayor'), council = signatures.filter(signature => signature.role === 'council');
    const departmental = request.cap <= 40 && signatures.length >= 2 && new Set(signatures.map(signature => signature.siteId)).size === 1;
    if (!mayor && !(council.length >= 2) && !departmental) return false;
    budgets.push({ ...request, approvedBy: [...request.approvedBy], spent: 0, closedAt: null, signatures }); return true;
  }
