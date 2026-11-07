/** Short stops at plain junctions (2026-10-29, new cities). A road vehicle stops for its full 8-minute dwell at
 * the end of every road edge it drives, and the current-v9 streets split into short edges at every junction: on
 * day 2 of a new city road vehicles stood still 49% of the time, 31% of it at plain junctions (neither a station
 * nor a building door) — the parked trucks of the lantern streets. In a declared city a road vehicle stops
 * JUNCTION_DWELL minutes at a plain junction instead (long enough for a waiting resident to board, who boards any
 * vehicle not moving); stations, doors, rail, ferries, flights and red lights keep their dwell. */
export const JUNCTION_DWELL_POLICY = 'junction-dwell-v1' as const;
export type JunctionDwellPolicy = typeof JUNCTION_DWELL_POLICY;
export const JUNCTION_DWELL_POLICIES: readonly JunctionDwellPolicy[] = [JUNCTION_DWELL_POLICY];
export const JUNCTION_DWELL = 2;

export function validateJunctionDwellPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'junctionDwellPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'junctionDwellPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !JUNCTION_DWELL_POLICIES.includes(data.junctionDwellPolicyId)
    || data.runtime.junctionDwellPolicyId !== data.junctionDwellPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：junction dwell policy pair。');
}
