import * as THREE from 'three';
import { getWalkHeight } from './world';
import { getFloorDimensions, getStairPosition } from './access';
import { blocksTransportBarrier } from './transport-geometry';
import { blocksMarketCounter, marketCounters, type MarketCounter } from './site-fixtures';
import type { AerialVehicle, AviationControls, Building, Vec3, ViewMode, VoxelModification, WorldDefinition } from './types';

const EYE_HEIGHT = 1.72;
const BODY_RADIUS = 0.35;
const distance2 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Only transforms the player's camera. Simulation and rendering stay independent. */
export class PlayerController {
  mode: ViewMode = 'walk';
  yaw = 0;
  pitch = -0.35;
  inside: Building | null = null;
  floor = 0;
  jetSpeed = 85;
  private keys = new Set<string>();
  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;
  private feet: Vec3;
  private listeners: (() => void)[] = [];
  private readonly marketCounters: MarketCounter[];

  blockedAccess: string | null = null;

  constructor(readonly camera: THREE.PerspectiveCamera, readonly canvas: HTMLCanvasElement, readonly world: WorldDefinition, private onAction: (key: string) => void, private canAccess: (building: Building, floor: number) => boolean = () => true, private modifications: () => readonly VoxelModification[] = () => []) {
    this.marketCounters = world.buildings.flatMap(building => marketCounters(world, building));
    this.feet = { ...world.spawn };
    this.readAngles();
    this.setMode('walk', world.spawn);
    this.listen(window, 'keydown', (event) => {
      const e = event as KeyboardEvent;
      if (e.defaultPrevented) return;
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return;
      if ((e.target as HTMLElement)?.closest('button, a, [role="tab"]') && ['Space', 'Enter'].includes(e.code)) return;
      if (e.repeat && ['KeyV', 'KeyE', 'KeyF', 'KeyB', 'KeyX', 'KeyT'].includes(e.code)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (['KeyV', 'KeyE', 'KeyF', 'KeyB', 'KeyX', 'KeyT', 'Escape'].includes(e.code)) this.onAction(e.code);
    });
    this.listen(window, 'keyup', (event) => this.keys.delete((event as KeyboardEvent).code));
    this.listen(window, 'blur', () => { this.keys.clear(); this.dragging = false; });
    this.listen(document, 'visibilitychange', () => { this.keys.clear(); this.dragging = false; });
    this.listen(canvas, 'mousedown', (event) => {
      const e = event as MouseEvent;
      if (e.button !== 0) return;
      this.dragging = true;
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
    });
    this.listen(window, 'mouseup', () => { this.dragging = false; });
    this.listen(window, 'mousemove', (event) => {
      const e = event as MouseEvent;
      const locked = document.pointerLockElement === canvas;
      if (!this.dragging && !locked) return;
      const dx = locked ? e.movementX : e.clientX - this.pointerX;
      const dy = locked ? e.movementY : e.clientY - this.pointerY;
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.yaw -= dx * 0.003;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0025, -1.48, 1.48);
      this.orient();
    });
    this.listen(canvas, 'dblclick', () => {
      if (this.mode === 'walk') canvas.requestPointerLock?.();
    });
    this.listen(canvas, 'wheel', (event) => {
      const e = event as WheelEvent;
      e.preventDefault();
      if (this.mode === 'jet') this.jetSpeed = THREE.MathUtils.clamp(this.jetSpeed - e.deltaY * 0.06, 25, 250);
      else if (this.mode === 'drone') this.jetSpeed = THREE.MathUtils.clamp(this.jetSpeed - e.deltaY * 0.06, 25, 150);
    }, { passive: false });
  }

  get position(): Vec3 { return { ...this.feet }; }
  get walkingPosition(): Vec3 { return { ...this.feet }; }
  get moving(): boolean { return this.keys.size > 0 || this.mode === 'jet'; }
  get drivingControls(): { throttle: number; turn: number; brake: boolean } {
    return { throttle: Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')), turn: Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')), brake: this.keys.has('Space') };
  }

  get aviationControls(): AviationControls {
    const drive = this.drivingControls;
    return { forward: drive.throttle, strafe: drive.turn, climb: Number(this.keys.has('KeyR') || this.keys.has('Space')) - Number(this.keys.has('KeyQ') || this.keys.has('ControlLeft')), yaw: this.yaw, pitch: this.pitch, speed: this.jetSpeed, boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') };
  }

  setMode(mode: ViewMode, playerPosition: Vec3, aircraft?: AerialVehicle): boolean {
    if (mode !== 'walk' && (!aircraft || aircraft.kind !== mode)) { this.blockedAccess = '航空视角需要在城市停机位租用并实际登机。'; return false; }
    this.keys.clear();
    if (this.mode === 'walk') this.feet = { ...playerPosition };
    this.mode = mode;
    this.floor = 0;
    this.inside = null;
    if (mode === 'walk') {
      this.feet = { ...playerPosition };
      const room = this.world.buildings.find(building => {
        const floor = Math.round((this.feet.y - building.position.y - 0.6) / (building.height / building.floors));
        if (floor < -(building.basements ?? 0) || floor >= building.floors) return false;
        const { width, depth } = getFloorDimensions(building, floor);
        return Math.abs(this.feet.x - building.position.x) < width / 2 - BODY_RADIUS && Math.abs(this.feet.z - building.position.z) < depth / 2 - BODY_RADIUS && Math.abs(this.feet.y - (building.position.y + 0.6 + floor * building.height / building.floors)) < 1.5;
      });
      if (room) {
        this.inside = room;
        this.floor = Math.round((this.feet.y - room.position.y - 0.6) / (room.height / room.floors)) || 0;
      }
      this.camera.position.set(this.feet.x, this.feet.y + EYE_HEIGHT, this.feet.z);
      this.pitch = -0.05;
    } else if (aircraft) {
      this.yaw = aircraft.yaw; this.pitch = aircraft.pitch; this.jetSpeed = 85;
      this.syncAircraft(aircraft);
    }
    this.orient();
    return true;
  }

  syncAircraft(aircraft: AerialVehicle): void {
    this.feet = { ...aircraft.position, y: aircraft.position.y + .3 };
    this.camera.position.set(aircraft.position.x, aircraft.position.y + 1.15, aircraft.position.z);
    this.inside = null;
    this.floor = 0;
    if (aircraft.status === 'landing') { this.yaw = aircraft.yaw; this.pitch = aircraft.pitch; this.orient(); }
  }

  syncPassenger(position: Vec3): void {
    this.feet = { ...position };
    if (this.mode === 'walk') this.camera.position.set(position.x, position.y + EYE_HEIGHT + 0.5, position.z);
    this.inside = null;
  }

  resetView(): void {
    this.pitch = -0.05;
    this.orient();
  }

  /** Door use crosses only the existing opening; doors do not teleport between buildings. */
  useDoor(building: Building): boolean {
    if (this.mode !== 'walk' || distance2(this.feet, building.door) > 6) return false;
    const isInside = this.contains(building, this.feet, 0);
    if (!isInside && !this.canAccess(building, 0)) { this.blockedAccess = `${building.name}的核心区域需要相应权限。公共政务大厅始终开放。`; return false; }
    const z = building.door.z + (isInside ? 2 : -2);
    this.feet = { x: building.door.x, y: building.position.y + 0.6, z };
    this.floor = 0;
    this.inside = isInside ? null : building;
    this.camera.position.set(this.feet.x, this.feet.y + EYE_HEIGHT, this.feet.z);
    this.yaw = isInside ? Math.PI : 0;
    this.pitch = 0;
    this.orient();
    return true;
  }

  useStairs(): boolean {
    if (!this.inside || this.inside.floors + (this.inside.basements ?? 0) < 2) return false;
    const b = this.inside;
    const stair = getStairPosition(b, this.floor);
    if (Math.abs(this.feet.x - stair.x) > 3 || Math.abs(this.feet.z - stair.z) > 5) return false;
    const floors = Array.from({ length: b.floors + (b.basements ?? 0) }, (_, index) => index - (b.basements ?? 0));
    const current = floors.indexOf(this.floor);
    const next = [...floors.slice(current + 1), ...floors.slice(0, current + 1)].find(floor => floor !== this.floor && this.canAccess(b, floor));
    if (next === undefined) { this.blockedAccess = '此处其他楼层需要相应权限。'; return false; }
    this.floor = next;
    const floorHeight = b.height / b.floors;
    this.feet.y = b.position.y + 0.6 + this.floor * floorHeight;
    this.camera.position.y = this.feet.y + EYE_HEIGHT;
    return true;
  }

  step(seconds: number, passenger: boolean, _paused = false): void {
    const dt = Math.min(seconds, 0.1);
    if (passenger || this.mode !== 'walk') return;
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    let strafe = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const length = Math.hypot(forward, strafe);
    if (length > 1) { forward /= length; strafe /= length; }
    if (this.mode === 'walk') {
      const speed = sprint ? 10 : 4.8;
      const dx = (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe) * speed * dt;
      const dz = (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe) * speed * dt;
      this.walkTo(this.feet.x + dx, this.feet.z);
      this.walkTo(this.feet.x, this.feet.z + dz);
      this.camera.position.set(this.feet.x, this.feet.y + EYE_HEIGHT, this.feet.z);
    }
  }

  dispose(): void { this.listeners.forEach(remove => remove()); document.exitPointerLock?.(); }

  private walkTo(x: number, z: number): void {
    const limit = this.world.size / 2 - 8;
    x = THREE.MathUtils.clamp(x, -limit, limit);
    z = THREE.MathUtils.clamp(z, -limit, limit);
    const candidate = { x, y: this.feet.y, z };
    if (blocksMarketCounter(this.marketCounters, this.feet, candidate, BODY_RADIUS, EYE_HEIGHT)) return;
    if (!this.inside && blocksTransportBarrier(this.world, this.feet, candidate, BODY_RADIUS)) return;
    for (const b of this.world.buildings) {
      if (b.kind === 'pavilion') continue;
      if (Math.abs(x - b.position.x) > b.width / 2 + 1 || Math.abs(z - b.position.z) > b.depth / 2 + 1) continue;
      const level = b.id === this.inside?.id ? this.floor : 0;
      const { width, depth } = getFloorDimensions(b, level);
      const wasInside = this.contains(b, this.feet, BODY_RADIUS);
      const nowInside = this.contains(b, candidate, BODY_RADIUS);
      const opening = Math.abs(x - b.door.x) < Math.max(1.5, Math.min(2.7, b.width * 0.1));
      const southWall = Math.abs(z - (b.position.z + depth / 2)) < 1;
      const otherWall = Math.abs(Math.abs(x - b.position.x) - width / 2) < 0.7 || Math.abs(z - (b.position.z - depth / 2)) < 0.7;
      if (otherWall || (southWall && !opening) || (wasInside !== nowInside && !opening)) return;
      if (this.floor !== 0 && wasInside !== nowInside) return;
    }
    const building = this.world.buildings.find(b => this.contains(b, candidate, BODY_RADIUS));
    if (building && !this.canAccess(building, building.id === this.inside?.id ? this.floor : 0)) { this.blockedAccess = `${building.name}需要相应权限。`; return; }
    const nextFloor = building?.id === this.inside?.id ? this.floor : 0;
    let height = building ? building.position.y + 0.6 + nextFloor * building.height / building.floors : getWalkHeight(this.world, x, z, this.feet.y);
    const blocks = this.modifications();
    // Small steps can support the body. Taller stacks and head-height cubes are solid.
    for (const block of blocks) {
      const p = block.position, top = p.y + 0.2;
      if (Math.abs(x - p.x) < 0.1 + BODY_RADIUS && Math.abs(z - p.z) < 0.1 + BODY_RADIUS && top > height && top <= this.feet.y + 0.4 + 1e-7) height = top;
    }
    for (const block of blocks) {
      const p = block.position;
      if (Math.abs(x - p.x) < 0.1 + BODY_RADIUS && Math.abs(z - p.z) < 0.1 + BODY_RADIUS && p.y < height + EYE_HEIGHT && p.y + 0.2 > height + 0.01) return;
    }
    // Crossing mountain cliffs requires the road, lift or cableway.
    if (Math.abs(height - this.feet.y) > 2.6 && !building) return;
    this.floor = nextFloor;
    this.inside = building ?? null;
    this.feet = { x, y: height, z };
  }

  private contains(b: Building, p: Vec3, margin: number): boolean {
    const level = b.id === this.inside?.id ? this.floor : 0;
    const { width, depth } = getFloorDimensions(b, level);
    return Math.abs(p.x - b.position.x) < width / 2 - margin && Math.abs(p.z - b.position.z) < depth / 2 - margin;
  }
  private readAngles(): void { const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ'); this.yaw = e.y; this.pitch = e.x; }
  private orient(): void { this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')); }
  private listen(target: EventTarget, event: string, fn: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(event, fn, options);
    this.listeners.push(() => target.removeEventListener(event, fn, options));
  }
}
