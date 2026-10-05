/** Proposed pure intersection contract only; no Simulation or runtime patch. */
export interface TimeWindow { start: number; end: number }
export function intervalMinutes(...intervals: TimeWindow[]): number {
  return Math.max(0, Math.min(...intervals.map(w => w.end)) - Math.max(...intervals.map(w => w.start)));
}
