/** Where the city's people actually are right now, for the map: residents who
 * are out (not asleep, at home or dead) grouped into CROWD_CELL-metre cells.
 * Each spot is the mean position of a cell with at least CROWD_MIN people;
 * the busiest CROWD_LIMIT are returned. Mirrored by Core/CrowdSpots.cs. */
export const CROWD_CELL = 120, CROWD_MIN = 5, CROWD_LIMIT = 4;
const RESTING = new Set(['sleeping', 'atHome', 'dead']);
export interface CrowdPerson { position: { x: number; z: number }; state: string; alive?: boolean }
export interface CrowdSpot { x: number; z: number; count: number }

export function crowdSpots(people: readonly CrowdPerson[]): CrowdSpot[] {
  const cells = new Map<string, { x: number; z: number; count: number }>();
  for (const person of people) {
    if (person.alive === false || RESTING.has(person.state)) continue;
    const key = `${Math.floor(person.position.x / CROWD_CELL)},${Math.floor(person.position.z / CROWD_CELL)}`;
    const cell = cells.get(key) ?? { x: 0, z: 0, count: 0 };
    cell.x += person.position.x; cell.z += person.position.z; cell.count++; cells.set(key, cell);
  }
  return [...cells.values()].filter(cell => cell.count >= CROWD_MIN).map(cell => ({ x: cell.x / cell.count, z: cell.z / cell.count, count: cell.count }))
    .sort((a, b) => b.count - a.count || a.x - b.x || a.z - b.z).slice(0, CROWD_LIMIT);
}
