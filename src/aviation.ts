import type { Simulation } from './simulation';
import { getWalkHeight } from './world';
import type { AerialVehicle, AviationControls, AviationPad, AviationState, Command, CommandResult, SimState, Vec3, WorldDefinition } from './types';

export const AIRCRAFT_COMMANDS = new Set<Command['type']>(['rentAircraft', 'boardAircraft', 'leaveAircraft', 'landAircraft', 'returnAircraft', 'refuelAircraft']);
export const DRONE_RENTAL_FEE = 24;
const idleControls = (): AviationControls => ({ forward: 0, strafe: 0, climb: 0, yaw: 0, pitch: 0, speed: 85, boost: false });
const copy = (p: Vec3): Vec3 => ({ ...p });
const horizontal = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const cache = new WeakMap<WorldDefinition, AviationPad[]>();

/** World fixtures may place districts outside the nominal square. Bounds follow
 * the authoritative buildings/network, within the core's legal coordinate range. */
function flightBounds(world: WorldDefinition) {
  const points = [world.spawn, ...world.nodes.map(n => n.position), ...world.buildings.flatMap(b => [b.position, b.door]), ...world.edges.flatMap(e => e.points)];
  const limit = Math.max(10000, world.size * 3), margin = 120;
  return { minX: Math.max(-limit, Math.min(-world.size / 2, ...points.map(p => p.x)) - margin), maxX: Math.min(limit, Math.max(world.size / 2, ...points.map(p => p.x)) + margin), minZ: Math.max(-limit, Math.min(-world.size / 2, ...points.map(p => p.z)) - margin), maxZ: Math.min(limit, Math.max(world.size / 2, ...points.map(p => p.z)) + margin) };
}

/** Clear spaces beside existing public stations and the actual airport apron. */
export function getAviationPads(world: WorldDefinition): AviationPad[] {
  const saved = cache.get(world); if (saved) return saved;
  const pads: AviationPad[] = [];
  const clear = (p: Vec3, radius: number) => world.buildings.every(b => Math.abs(p.x - b.position.x) > b.width / 2 + radius || Math.abs(p.z - b.position.z) > b.depth / 2 + radius);
  const add = (id: string, name: string, districtId: string, origin: Vec3, kind: AviationPad['kind']) => {
    const radius = 8;
    for (const offset of [10, 18, 28, 42, 60, 80]) for (let angle = 0; angle < 8; angle++) {
      const x = origin.x + Math.cos(angle * Math.PI / 4) * offset;
      const z = origin.z + Math.sin(angle * Math.PI / 4) * offset;
      const y = getWalkHeight(world, x, z);
      const p = { x, y, z };
      const slope = Math.abs(getWalkHeight(world, x + radius, z) - y) + Math.abs(getWalkHeight(world, x, z + radius) - y);
      if (!clear(p, radius) || slope > 2.4 || pads.some(other => horizontal(other.position, p) < 22)) continue;
      pads.push({ id, name, districtId, position: p, kind }); return;
    }
  };
  for (const district of world.districts) {
    const station = world.nodes.find(n => n.districtId === district.id && n.station);
    if (station && !['airport', 'starport'].includes(district.kind)) add(`air-pad-${district.id}`, `${district.name}观景机租赁点`, district.id, station.position, 'rental');
  }
  const airport = world.buildings.find(b => b.kind === 'airport');
  if (airport) add('air-pad-military', '南岫机场飞行勤务机坪', airport.districtId, { ...airport.door, z: airport.door.z + 14 }, 'military');
  cache.set(world, pads); return pads;
}

export function activeAircraft(state: SimState): AerialVehicle | undefined {
  return state.aviation?.aircraft.find(a => a.id === state.aviation?.activeAircraftId);
}

/** The same live boarding rules drive the command and its onsite controls. */
export function aircraftBoardingBlockedReason(state: SimState, craft: AerialVehicle): string {
  if (state.extension?.actorProfiles.player?.alive === false) return '角色生命已结束，无法继续行动；可调节时间或读取存档。';
  if (state.aviation?.activeAircraftId || craft.status !== 'parked' || distance(state.player.position, craft.position) > 6 || state.player.vehicleId)
    return '请步行到停稳航空器的舱门 6 米内，不能远程进入驾驶舱。';
  if (craft.charging || craft.battery < 30) return '正在补能或电量不足 30%，暂不能起飞。';
  if (state.weather === '雨' || state.visibility < .35 || state.energy < 15) return '雷雨、低能见度或城市供能不足，机场暂不许可起飞。';
  const identity = (role: 'soldier' | 'driver') => state.player.role === role || state.player.identities?.includes(role);
  if (craft.kind === 'jet' && (!identity('soldier') || !identity('driver')))
    return '战机驾驶需要同时取得卫士和驾驶员身份：巡检司报到、书院学习与站点驾驶考核后再来机场。';
  if (craft.kind === 'drone' && !craft.reserved) return '请先在停机位支付观景无人机租用费。';
  return '';
}

/** Input is saved and integrated by the existing traffic phase, never by rendering. */
export function setAircraftControls(state: SimState, input: AviationControls): void {
  if (!activeAircraft(state) || ![input.forward, input.strafe, input.climb, input.yaw, input.pitch, input.speed].every(v => Number.isFinite(v)) || typeof input.boost !== 'boolean') return;
  state.aviation!.controls = { forward: clamp(input.forward, -1, 1), strafe: clamp(input.strafe, -1, 1), climb: clamp(input.climb, -1, 1), yaw: input.yaw, pitch: clamp(input.pitch, -1.48, 1.48), speed: clamp(input.speed, 25, 250), boost: input.boost };
}

export function installAviation(simulation: Simulation): void {
  const world = simulation.worldDefinition, pads = getAviationPads(world), bounds = flightBounds(world);
  const padById = new Map(pads.map(p => [p.id, p]));
  const initialize = (): AviationState => ({ version: 1, activeAircraftId: null, controls: idleControls(), stats: { rentals: 0, flights: 0, landings: 0, fees: 0 }, aircraft: pads.map(p => ({ id: `aircraft-${p.id}`, name: p.kind === 'military' ? '青隼垂直起降战机' : '云游载人无人机', kind: p.kind === 'military' ? 'jet' : 'drone', homePadId: p.id, padId: p.id, position: { ...p.position, y: p.position.y + .6 }, yaw: 0, pitch: 0, speed: 0, battery: 100, status: 'parked', reserved: false, charging: false, landingPadId: null })) });
  simulation.state.aviation = initialize();
  const state = () => simulation.state;
  const air = () => state().aviation!;
  const notice = (message: string, craft: AerialVehicle) => simulation.appendNotice('aviation', message, padById.get(craft.homePadId)!.districtId);
  const fee = (craft: AerialVehicle, amount: number, purpose: string) => {
    state().player.money -= amount; air().stats.fees += amount;
    const districtId = padById.get(craft.homePadId)!.districtId;
    simulation.emitEvent({ type: 'transit-fare', amount, vehicleId: craft.id, districtId });
    const extension = state().extension;
    if (extension) {
      const runtime = (extension as unknown as { runtime?: { lastTreasury: number } }).runtime;
      if (runtime) runtime.lastTreasury += amount;
      extension.publicLedger.push({ tick: state().tick, actorId: 'player', amount, purpose, account: 'public', districtId, sourceEvent: 'transit-fare' });
      if (extension.publicLedger.length > 512) extension.publicLedger.splice(0, extension.publicLedger.length - 512);
    }
  };
  const floor = (p: Vec3): number => {
    let y = getWalkHeight(world, p.x, p.z);
    for (const b of world.buildings) if (Math.abs(p.x - b.position.x) < b.width / 2 + 8 && Math.abs(p.z - b.position.z) < b.depth / 2 + 8) y = Math.max(y, b.position.y + b.height + 8);
    return y;
  };
  const canApproach = (craft: AerialVehicle) => craft.status === 'parked' && distance(state().player.position, craft.position) <= 6 && !state().player.vehicleId;
  const startLanding = (craft: AerialVehicle) => {
    const home = padById.get(craft.homePadId)!;
    // Every aircraft returns to its registered stand: the next renter can find it.
    craft.landingPadId = home.id; craft.padId = null; craft.status = 'landing';
  };
  const sync = (craft: AerialVehicle) => { state().player.position = { ...craft.position, y: craft.position.y + .3 }; };

  simulation.registerCommandHandler((command): CommandResult | null => {
    if (!AIRCRAFT_COMMANDS.has(command.type)) return null;
    const fail = (message: string) => ({ ok: false, message });
    const craft = command.targetId ? air().aircraft.find(a => a.id === command.targetId) : activeAircraft(state());
    if (!craft) return fail('请沿导航到真实租赁停机位或机场机坪，走近航空器后操作。');
    const isActive = air().activeAircraftId === craft.id;
    const ok = (message: string) => { notice(message, craft); return { ok: true, message }; };
    if (command.type === 'rentAircraft') {
      if (craft.kind !== 'drone') return fail('军用航空器不可民用租赁，需卫士与驾驶员资质。');
      if (air().activeAircraftId || !canApproach(craft)) return fail('请先下车，再步行到无人机舱门 6 米内。');
      if (craft.reserved) return fail('已租用这架无人机，请直接登机或归还。');
      if (craft.charging || craft.battery < 30) return fail('无人机正在补能或电量低于 30%，请完成地面补能。');
      if (state().player.money < DRONE_RENTAL_FEE) return fail(`租用需要 ${DRONE_RENTAL_FEE} 云币。`);
      fee(craft, DRONE_RENTAL_FEE, '载人观景无人机租用收入'); craft.reserved = true; air().stats.rentals++;
      return ok(`租用${craft.name}，${DRONE_RENTAL_FEE} 云币进入公共航空服务账户。旅行者可使用自动驾驶操控，无需军籍；请在舱门登机。`);
    }
    if (command.type === 'boardAircraft') {
      const reason = aircraftBoardingBlockedReason(state(), craft); if (reason) return fail(reason);
      craft.reserved = true; air().activeAircraftId = craft.id; air().controls = { ...idleControls(), yaw: craft.yaw, pitch: craft.pitch }; sync(craft);
      return ok(`已进入${craft.name}。R / Q 升降，WASD 操控，拖动环顾；战机离地后持续前进。返航会实际飞回机坪，落地后可退出。`);
    }
    if (command.type === 'landAircraft') {
      if (!isActive) return fail('只有机舱中的乘员可发起返航。');
      if (craft.status === 'parked') return ok('航空器已经停稳，可以退出机舱。');
      startLanding(craft); return ok(`自动返航至${padById.get(craft.homePadId)!.name}。请等待真实进近与落地。`);
    }
    if (command.type === 'leaveAircraft') {
      if (!isActive) return fail('你没有乘坐这架航空器。');
      if (craft.status !== 'parked' || !craft.padId || craft.speed > .01) return fail('空中不能退出；请先返航并等待航空器停稳。');
      const pad = padById.get(craft.padId)!;
      state().player.position = { x: pad.position.x + (craft.kind === 'jet' ? 5 : 3), y: getWalkHeight(world, pad.position.x + (craft.kind === 'jet' ? 5 : 3), pad.position.z), z: pad.position.z };
      air().activeAircraftId = null; air().controls = idleControls(); if (craft.kind === 'jet') craft.reserved = false;
      return ok('从舱门退出，回到停机坪继续城市生活。');
    }
    if (command.type === 'returnAircraft') {
      if (isActive || !canApproach(craft)) return fail('请先落地、退出，步行到停机位归还。');
      if (craft.kind !== 'drone' || !craft.reserved) return fail('当前没有可归还的无人机租约。');
      craft.reserved = false; return ok('无人机租约已结束，实际停机位可再次租用。');
    }
    if (command.type === 'refuelAircraft') {
      if (isActive || !canApproach(craft)) return fail('补能需在停机位熄火并退出机舱。');
      if (craft.charging || craft.battery > 99.9) return fail('航空器电量已满或正在补能。');
      if (state().energy < 15) return fail('城市电力不足，暂时不能补能。');
      const cost = Math.ceil((100 - craft.battery) * .16);
      if (state().player.money < cost) return fail(`补能需 ${cost} 云币。`);
      fee(craft, cost, '航空器地面补能收入'); craft.charging = true;
      return ok(`支付 ${cost} 云币补能费。地面电网每游戏分钟最多补充 0.5% 电量，城市供能不足会暂停。`);
    }
    return fail('未知航空操作。');
  });

  simulation.onPhase('energy', (s, minutes) => {
    for (const craft of air().aircraft) if (craft.charging && craft.status === 'parked' && s.energy >= 15) {
      const gained = Math.min(100 - craft.battery, .5 * minutes * s.energy / 100);
      craft.battery += gained; s.energy = Math.max(0, s.energy - gained * .02);
      if (craft.battery >= 99.999) { craft.battery = 100; craft.charging = false; notice(`${craft.name}地面补能完成。`, craft); }
    }
  });
  simulation.onPhase('traffic', (s, minutes) => {
    const craft = activeAircraft(s); if (!craft) return;
    const c = air().controls, total = minutes / s.speed;
    const shouldReturn = craft.battery <= 20 || s.weather === '雨' || s.visibility < .35 || s.extension?.actorProfiles.player?.alive === false;
    if (shouldReturn && craft.status === 'flying') { startLanding(craft); notice('低电量、恶劣天气或身体状态触发安全返航。', craft); }
    for (let remaining = total; remaining > 1e-8;) {
      const dt = Math.min(.05, remaining); remaining -= dt;
      const previousPosition = copy(craft.position);
      if (craft.status === 'landing') {
        const pad = padById.get(craft.landingPadId!)!, target = { ...pad.position, y: pad.position.y + .6 };
        const d = horizontal(craft.position, target), speed = craft.kind === 'jet' ? 95 : 70;
        const step = Math.min(d, speed * dt);
        const next = d > .01 ? { x: craft.position.x + (target.x - craft.position.x) / d * step, y: craft.position.y, z: craft.position.z + (target.z - craft.position.z) / d * step } : copy(craft.position);
        const altitude = d > 6 ? Math.max(target.y + 18, floor(next) + 14) : target.y;
        // Ascend before crossing rooftops; approach below rooflines is never snapped upward.
        if (d > 6 && craft.position.y < altitude - 1) craft.position.y += Math.min(altitude - craft.position.y, 35 * dt);
        else { craft.position.x = next.x; craft.position.z = next.z; craft.position.y += clamp(altitude - craft.position.y, -12 * dt, 20 * dt); }
        craft.yaw = d > .01 ? Math.atan2(-(target.x - previousPosition.x), -(target.z - previousPosition.z)) : craft.yaw;
        craft.pitch = 0; craft.speed = d > 6 ? speed : Math.abs(altitude - craft.position.y) > .1 ? 12 : 0;
        if (horizontal(craft.position, target) < .1 && Math.abs(craft.position.y - target.y) < .1) {
          craft.position = target; craft.status = 'parked'; craft.padId = pad.id; craft.landingPadId = null; craft.speed = 0; air().controls = { ...idleControls(), yaw: craft.yaw }; air().stats.landings++; notice(`${craft.name}已在${pad.name}停稳，可以退出。`, craft);
        }
      } else {
        craft.yaw = c.yaw; craft.pitch = c.pitch;
        if (craft.status === 'parked' && c.climb > 0) {
          craft.status = 'flying'; craft.padId = null; air().stats.flights++;
        }
        if (craft.status === 'flying') {
          const speed = craft.kind === 'jet' ? c.speed : c.boost ? 150 : c.speed;
          const forward = craft.kind === 'jet' ? (craft.position.y > padById.get(craft.homePadId)!.position.y + 4 ? 1 + c.forward * .6 : Math.max(0, c.forward)) : c.forward;
          const length = Math.max(1, Math.hypot(craft.kind === 'jet' ? c.forward : forward, c.strafe));
          const next = {
            x: craft.position.x + (-Math.sin(c.yaw) * Math.cos(c.pitch) * forward / length + Math.cos(c.yaw) * c.strafe / length) * speed * dt,
            y: craft.position.y + (Math.sin(c.pitch) * forward / length + c.climb) * speed * dt,
            z: craft.position.z + (-Math.cos(c.yaw) * Math.cos(c.pitch) * forward / length - Math.sin(c.yaw) * c.strafe / length) * speed * dt,
          };
          next.x = clamp(next.x, bounds.minX, bounds.maxX); next.z = clamp(next.z, bounds.minZ, bounds.maxZ); next.y = clamp(next.y, 0, 1800);
          const obstacle = floor(next) + .6;
          if (next.y >= obstacle && (next.y - obstacle > 2 || horizontal(next, padById.get(craft.homePadId)!.position) < 10)) {
            craft.speed = distance(craft.position, next) / dt; craft.position = next;
          } else {
            // A building blocks horizontal motion, while the pilot can still climb
            // vertically in the clear launch shaft rather than become stuck.
            const previousY = craft.position.y;
            const verticalY = clamp(next.y, floor(craft.position) + .6, 1800);
            if (next.y > previousY && verticalY === next.y) craft.position.y = next.y;
            craft.speed = Math.abs(craft.position.y - previousY) / dt;
          }
        }
      }
      craft.speed = craft.status === 'parked' ? 0 : distance(previousPosition, craft.position) / dt;
      if (craft.status !== 'parked') craft.battery = Math.max(0, craft.battery - dt * (craft.kind === 'jet' ? .05 + craft.speed * .0001 : .02 + craft.speed * .00006));
      sync(craft);
      if (craft.status === 'parked') break;
    }
  });

  simulation.registerSaveValidator(candidate => {
    const a = candidate.aviation; if (a === undefined) return; // Legacy saves gain the same deterministic parked fleet.
    const ensure = (test: unknown, label: string) => { if (!test) throw new Error(`无效航空存档：${label}。`); };
    const finite = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
    const expected = initialize();
    ensure(a.version === 1 && Array.isArray(a.aircraft) && a.aircraft.length === expected.aircraft.length, '版本或机队');
    ensure(new Set(a.aircraft.map(c => c.id)).size === a.aircraft.length, '重复航空器');
    for (const c of a.aircraft) {
      const e = expected.aircraft.find(x => x.id === c.id); ensure(e && e.kind === c.kind && e.homePadId === c.homePadId && c.name === e.name, '航空器身份');
      ensure(c.position && finite(c.position.x, bounds.minX, bounds.maxX) && finite(c.position.z, bounds.minZ, bounds.maxZ) && finite(c.position.y, -100, 1800), '位置');
      ensure(finite(c.yaw, -1e8, 1e8) && finite(c.pitch, -1.48, 1.48) && finite(c.speed, 0, 1000) && finite(c.battery, 0, 100), '飞行数值');
      ensure(['parked', 'flying', 'landing'].includes(c.status) && typeof c.reserved === 'boolean' && typeof c.charging === 'boolean', '状态');
      ensure(c.status === 'parked' ? c.padId === c.homePadId && c.landingPadId === null && distance(c.position, expected.aircraft.find(x => x.id === c.id)!.position) < .15 && c.speed === 0 : c.padId === null && !c.charging && c.reserved && c.id === a.activeAircraftId, '停机位或乘员');
      ensure(c.status === 'landing' ? c.landingPadId === c.homePadId : c.landingPadId === null, '进近目标');
    }
    ensure(a.activeAircraftId === null || a.aircraft.some(c => c.id === a.activeAircraftId && c.reserved && !c.charging) && candidate.player.vehicleId === null, '乘坐引用');
    const occupied = a.aircraft.find(c => c.id === a.activeAircraftId);
    if (occupied) { ensure(distance(candidate.player.position, { ...occupied.position, y: occupied.position.y + .3 }) < .01, '乘员位置'); ensure(occupied.kind !== 'jet' || [...(candidate.player.identities ?? []), candidate.player.role].includes('soldier') && [...(candidate.player.identities ?? []), candidate.player.role].includes('driver'), '军用许可'); }
    const c = a.controls; ensure(c && finite(c.forward, -1, 1) && finite(c.strafe, -1, 1) && finite(c.climb, -1, 1) && finite(c.yaw, -1e8, 1e8) && finite(c.pitch, -1.48, 1.48) && finite(c.speed, 25, 250) && typeof c.boost === 'boolean', '操控');
    ensure(a.stats && Object.keys(a.stats).length === 4 && ['rentals', 'flights', 'landings', 'fees'].every(key => finite(a.stats[key as keyof AviationState['stats']], 0, 1e12)), '统计');
  });
  simulation.onLoad(() => { if (!state().aviation) state().aviation = initialize(); });
}
