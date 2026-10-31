/** Residents yield to the player (2026-10-18, new cities). A resident walking an
 * outdoor leg does not step into the player's body: when its next step would pass
 * within PLAYER_YIELD_METRES of the player on foot (two 0.35 m body disks), it
 * walks up to that circle and waits there, and walks on once the
 * player has stepped aside. It never leaves its route (stair cursors, road permits
 * and routes are untouched). Old saves and undeclared cities walk through as before. */
import type { Vec3 } from '../types';

export const PLAYER_YIELD_POLICY = 'player-yield-v1' as const;
export type PlayerYieldPolicy = typeof PLAYER_YIELD_POLICY;
export const PLAYER_YIELD_POLICIES: readonly PlayerYieldPolicy[] = [PLAYER_YIELD_POLICY];
export const PLAYER_YIELD_METRES = .7, PLAYER_YIELD_HEIGHT = 1.5;

/** Whether a resident stepping from `from` to `to` waits for the player standing at `player`:
 * the step passes within PLAYER_YIELD_METRES of the player (a whole step is tested, so a long step
 * cannot jump through), or, already that close, it would come closer still. */
export function yieldsToPlayer(policy: PlayerYieldPolicy | undefined, player: Vec3 | null, from: Vec3, to: Vec3): boolean {
  if (policy !== PLAYER_YIELD_POLICY || !player || Math.abs(to.y - player.y) > PLAYER_YIELD_HEIGHT) return false;
  const start = Math.hypot(from.x - player.x, from.z - player.z);
  if (start < PLAYER_YIELD_METRES) return Math.hypot(to.x - player.x, to.z - player.z) < start;
  const dx = to.x - from.x, dz = to.z - from.z, length2 = dx * dx + dz * dz;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((player.x - from.x) * dx + (player.z - from.z) * dz) / length2));
  return Math.hypot(from.x + dx * t - player.x, from.z + dz * t - player.z) < PLAYER_YIELD_METRES;
}

/** How far along from→to a yielding resident still walks: up to where it meets the
 * PLAYER_YIELD_METRES circle (from itself if it is already inside). */
export function yieldStop(player: Vec3, from: Vec3, to: Vec3): Vec3 {
  const dx = to.x - from.x, dz = to.z - from.z, fx = from.x - player.x, fz = from.z - player.z;
  const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - PLAYER_YIELD_METRES * PLAYER_YIELD_METRES;
  if (a === 0 || c <= 0) return { ...from };
  const t = Math.max(0, Math.min(1, (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a)));
  return { x: from.x + dx * t, y: from.y + (to.y - from.y) * t, z: from.z + dz * t };
}

export function validatePlayerYieldPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'playerYieldPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'playerYieldPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !PLAYER_YIELD_POLICIES.includes(data.playerYieldPolicyId)
    || data.runtime.playerYieldPolicyId !== data.playerYieldPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：player yield policy pair。');
}
