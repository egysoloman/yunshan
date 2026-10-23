/** Display only: when E finds nothing to use, name the nearest entrance within ENTRANCE_HINT_METRES
 * and where it lies relative to the way the player faces (shared with Unity, Core/EntranceHint.cs). */
export const ENTRANCE_HINT_METRES = 80;
const SIDES = ['正前方', '右前方', '右侧', '右后方', '身后', '左后方', '左侧', '左前方'] as const;

/** `forward` is the horizontal facing direction (it need not be normalised). */
export function entranceHint(position: { x: number; y: number; z: number }, forward: { x: number; z: number }, doors: readonly { name: string; door: { x: number; y: number; z: number } }[]): string | null {
  let best: { name: string; dx: number; dz: number; metres: number } | null = null;
  for (const b of doors) {
    const dx = b.door.x - position.x, dz = b.door.z - position.z, metres = Math.hypot(dx, dz);
    if (metres <= ENTRANCE_HINT_METRES && Math.abs(b.door.y - position.y) < 12 && (!best || metres < best.metres || metres === best.metres && b.name < best.name)) best = { name: b.name, dx, dz, metres };
  }
  if (!best) return null;
  const length = Math.hypot(forward.x, forward.z) || 1, fx = forward.x / length, fz = forward.z / length;
  // Right of the facing direction on the ground plane (y up): (-fz, fx) in this world's x/z.
  const ahead = best.dx * fx + best.dz * fz, right = best.dx * -fz + best.dz * fx;
  const bearing = Math.atan2(right, ahead) * 180 / Math.PI, side = SIDES[((Math.round(bearing / 45) % 8) + 8) % 8];
  return `最近的入口：${best.name}，在你${side}约 ${Math.max(1, Math.round(best.metres))} 米。`;
}
