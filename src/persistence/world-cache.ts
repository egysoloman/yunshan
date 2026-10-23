import { createWorld, type CityLayoutVersion } from '../world';
import type { WorldDefinition } from '../types';

/** A generated world is a deterministic function of (seed, layout) and costs
 * 2-5s to build; a save load used to rebuild every supported layout until one
 * matched its fingerprint. Worlds are kept as a pristine snapshot: their JSON
 * text plus the 14 shared references (edge points that are node positions)
 * JSON cannot express. Every caller receives a fresh copy with those references
 * relinked, so no caller can see another's later edits. A checked 8-layout
 * comparison found no other non-JSON value (no NaN, -0, undefined members or
 * non-plain objects). A packaged host may supply snapshots built by the same
 * bundle; anything else is generated in process. */
export interface WorldSnapshot { text: string; aliases: [string[], string[]][]; fingerprint?: string }
export type WorldSnapshotSource = (seed: number, layout: CityLayoutVersion) => WorldSnapshot | null;

let external: WorldSnapshotSource | null = null;
const memo = new Map<string, WorldSnapshot>();

export function useWorldSnapshots(source: WorldSnapshotSource | null): void { external = source; }

export function snapshotWorld(world: WorldDefinition): WorldSnapshot {
  const seen = new Map<object, string[]>(), aliases: [string[], string[]][] = [];
  const walk = (value: unknown, path: string[]) => {
    if (value === null || typeof value !== 'object') return;
    const first = seen.get(value);
    if (first) { aliases.push([path, first]); return; }
    seen.set(value, path);
    for (const key of Object.keys(value)) walk((value as Record<string, unknown>)[key], [...path, key]);
  };
  walk(world, []);
  return { text: JSON.stringify(world), aliases };
}

export function restoreWorld(snapshot: WorldSnapshot): WorldDefinition {
  const world = JSON.parse(snapshot.text) as WorldDefinition;
  const at = (path: string[]) => path.reduce<any>((node, key) => node[key], world);
  for (const [path, original] of snapshot.aliases) at(path.slice(0, -1))[path.at(-1)!] = at(original);
  return world;
}

function snapshotFor(seed: number, layout: CityLayoutVersion): WorldSnapshot {
  const key = `${seed}:${layout}`;
  let snapshot = memo.get(key);
  if (!snapshot) { snapshot = external?.(seed, layout) ?? snapshotWorld(createWorld(seed, layout)); memo.set(key, snapshot); }
  return snapshot;
}

/** The same world createWorld(seed, layout) returns, as an independent copy. */
export function cachedWorld(seed: number, layout: CityLayoutVersion): WorldDefinition {
  return restoreWorld(snapshotFor(seed, layout));
}

/** The saved-world fingerprint of that world, computed once per (seed, layout). */
export function cachedWorldFingerprint(seed: number, layout: CityLayoutVersion, fingerprint: (world: WorldDefinition) => string): string {
  const snapshot = snapshotFor(seed, layout);
  return snapshot.fingerprint ??= fingerprint(restoreWorld(snapshot));
}
