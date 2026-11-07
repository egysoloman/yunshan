/** A faster funded migration (2026-10-30, new cities). Registered migration (public-finance v7/v8) admits adults from
 * outside only into shop jobs whose spare cash funds a day's wage, with a home with room within 500 m; in audits
 * v9i–v9k it admitted exactly MIGRANTS_PER_DAY (3) every day, so the daily limit, not the funded openings, bounded
 * the city's growth, and the arrival town filled slowly. In a declared city at most MIGRATION_PACE adults arrive at
 * each day close; every other condition (funded job, home, savings brought in, MIGRATION_CAP) is unchanged. */
export const MIGRATION_PACE_POLICY = 'migration-pace-v1' as const;
export type MigrationPacePolicy = typeof MIGRATION_PACE_POLICY;
export const MIGRATION_PACE_POLICIES: readonly MigrationPacePolicy[] = [MIGRATION_PACE_POLICY];
export const MIGRATION_PACE = 6;

export function validateMigrationPacePolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'migrationPacePolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'migrationPacePolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !MIGRATION_PACE_POLICIES.includes(data.migrationPacePolicyId)
    || data.runtime.migrationPacePolicyId !== data.migrationPacePolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：migration pace policy pair。');
}
