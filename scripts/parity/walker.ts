// Scripted walking through doors and stairs for the C# PlayerWalker parity test.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import { createWorld } from '../../src/world';
import { PlayerController } from '../../src/controller';
import { canAccessFloor, getStairPosition } from '../../src/access';
import { getBuildingBody, getBuildingEntrance, buildingLocalPosition, buildingWorldPosition } from '../../src/architecture-floor-plan';
import { getWalkHeight } from '../../src/world';
import { canonical } from './world';
import type { Building } from '../../src/types';

const noop = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis, { window: noop, document: { ...noop, exitPointerLock() {}, pointerLockElement: null } });
const world = createWorld();
const player = { role: 'traveler' as const, identities: ['traveler' as const] };
const controller = new PlayerController(new THREE.PerspectiveCamera(), { ...noop, requestPointerLock() {} } as unknown as HTMLCanvasElement, world, () => {}, (b: Building, f: number) => canAccessFloor(b, f, player));
const walker = controller as unknown as { feet: { x: number; y: number; z: number }; stepWithKeys(dt: number, passenger: boolean, keys: Set<string>): void };
const nearest = (kind: string, count: number) => world.buildings.filter(b => b.kind === kind)
  .sort((a, b) => Math.hypot(a.door.x - world.spawn.x, a.door.z - world.spawn.z) - Math.hypot(b.door.x - world.spawn.x, b.door.z - world.spawn.z) || (a.id < b.id ? -1 : 1)).slice(0, count);
const targets = [...nearest('market', 2), ...nearest('home', 3), ...nearest('school', 1)];
const log: unknown[] = [];
const record = (label: string) => log.push({ label, feet: { ...walker.feet }, inside: controller.inside?.id ?? null, floor: controller.floor, yaw: controller.yaw, blocked: controller.blockedAccess });
const walkTo = (x: number, z: number, sprint: boolean, limit: number) => {
  for (let i = 0; i < limit; i++) {
    const f = walker.feet, dx = x - f.x, dz = z - f.z;
    if (Math.hypot(dx, dz) < 1.2) break;
    controller.yaw = Math.atan2(-dx, -dz);
    walker.stepWithKeys(1 / 30, false, new Set(sprint ? ['KeyW', 'ShiftLeft'] : ['KeyW']));
    if (i % 15 === 0) record(`walk ${i}`);
  }
  record('arrived');
};
for (const [index, building] of targets.entries()) {
  walkTo(building.door.x, building.door.z, index % 2 === 0, 2400);
  record(`street ${building.id}`);
  // Start again just outside the real entrance so every door and stair is exercised.
  const profiled = !!getBuildingBody(building), local = profiled ? buildingLocalPosition(building, getBuildingEntrance(building)) : null;
  const outside = local ? buildingWorldPosition(building, { ...local, z: local.z + 4 }) : { x: building.door.x, y: building.door.y, z: building.door.z + 4 };
  controller.setMode('walk', { x: outside.x, y: getWalkHeight(world, outside.x, outside.z, outside.y), z: outside.z });
  record(`placed ${building.id}`);
  walkTo(building.door.x, building.door.z, false, 600);
  record(`door ${building.id} ${controller.useDoor(building)}`);
  if (controller.inside) {
    const stair = getStairPosition(building, controller.floor);
    walkTo(stair.x, stair.z, false, 900);
    record(`stairs ${controller.useStairs()}`);
    const up = getStairPosition(building, controller.floor);
    walkTo(up.x + 2, up.z + 2, false, 300);
    record(`stairs ${controller.useStairs()}`);
    walkTo(building.door.x, building.door.z, false, 900);
    record(`out ${controller.useDoor(building)}`);
  }
  record(`profiled ${profiled}`);
}
writeFileSync(process.argv[2], gzipSync(JSON.stringify(canonical(log)), { level: 9 }));
console.log(log.length, 'records', JSON.stringify(log.slice(-3)));
