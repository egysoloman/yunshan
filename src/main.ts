import * as THREE from 'three';
import './style.css';
import { Simulation } from './simulation';
import { createCityLifeProductCity, PRODUCT_CITY_LAYOUT } from './product-city';
import { CityRenderer } from './renderer';
import { CityUI } from './ui';
import { PlayerController } from './controller';
import { activeAircraft, AIRCRAFT_COMMANDS, getAviationPads, setAircraftControls } from './aviation';
import { AviationRenderer } from './aviation-renderer';
import { canAccessFloor } from './access';
import { JourneyNavigation } from './journey';
import type { JourneyNavigationPlan, TransitJourney, WalkingJourney } from './journey';
import { releaseRoadExitPermit } from './roads';
import { Ambience, ambienceLevels } from './audio/ambience';
import { cueFor } from './audio/cues';
import { entranceHint } from './entrance-hint';
import { getWaterfallPath, terrainHeight } from './world';
import { readSavedGame, writeSavedGame } from './persistence';
import { savedWorldFingerprint, selectSavedWorld } from './persistence/world-layout';
import type { Building, Command, Quality, SimState, UIActions, Vec3, ViewMode, ViewState } from './types';

import { eGreetsResident, nearbyResident } from './social-reach';
import { AUTO_TRANSIT_METRES } from './first-day';
import { mealFeedback } from './meal-feedback';
import { eBoardsVehicle } from './transit-label';
const PREF_KEY = 'yunshan.preferences.v1';
/** A map crowd halo farther than this (straight line) is reached by public transport when a service exists. */
/** The resident the player last met (see social-reach): kept while within talking reach. */
let metCitizenId: string | null = null;
const app = document.querySelector<HTMLElement>('#app')!;
const stage = document.createElement('main');
stage.className = 'world-stage';
stage.setAttribute('aria-label', '云山巨城三维世界，拖动鼠标环顾，WASD 移动');
app.append(stage);

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
let previousSave: string | null = null;
let startupReadFailed = false;
try { previousSave = await readSavedGame(); } catch { startupReadFailed = true; }
let startupLayoutError = '';
let selection: ReturnType<typeof selectSavedWorld>;
try { selection = selectSavedWorld(previousSave, PRODUCT_CITY_LAYOUT); } catch (error) { startupLayoutError = error instanceof Error ? error.message : '未知城市布局'; selection = selectSavedWorld(undefined, PRODUCT_CITY_LAYOUT); }
let autosaveAllowed = !startupReadFailed && !startupLayoutError;
const world = selection.world;
const simulation = await createCityLifeProductCity(world);
let city: CityRenderer;
try {
  city = new CityRenderer(stage, world);
} catch (error) {
  const message = document.createElement('div');
  message.className = 'startup-error';
  const title = document.createElement('h1');
  title.textContent = '云山巨城需要 WebGL 2';
  const details = document.createElement('p');
  details.textContent = '请在 Safari、Chrome 或 Firefox 中启用硬件加速后重新打开。' + (error instanceof Error ? ` (${error.message})` : '');
  message.append(title, details);
  app.append(message);
  throw error;
}

const settings = { quality: 'balanced' as Quality, renderDistance: 5700, fpsCap: 60, dynamicResolution: true, simulationDetail: 1, volume: .6 };
try {
  const stored = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null');
  if (stored && ['low', 'balanced', 'high'].includes(stored.quality)) settings.quality = stored.quality;
  if (stored && Number.isFinite(stored.renderDistance)) settings.renderDistance = THREE.MathUtils.clamp(stored.renderDistance, 800, 6000);
  if (stored && [30, 60, 120].includes(stored.fpsCap)) settings.fpsCap = stored.fpsCap;
  if (stored && typeof stored.dynamicResolution === 'boolean') settings.dynamicResolution = stored.dynamicResolution;
  if (stored && Number.isFinite(stored.simulationDetail)) settings.simulationDetail = THREE.MathUtils.clamp(stored.simulationDetail, 0.5, 2);
  if (stored && Number.isFinite(stored.volume)) settings.volume = THREE.MathUtils.clamp(stored.volume, 0, 1);
} catch { /* Storage may be unavailable in a private or restricted browser. */ }
city.setQuality(settings.quality);
city.setRenderDistance(settings.renderDistance);
city.setDynamicResolution(settings.dynamicResolution);

const aviationRenderer = new AviationRenderer(city.scene, world);

let ui: CityUI;
let targetDistrict: string | null = null;
/** How much of a simulation tick runs per frame before the rest waits for the next (Simulation.stepSliced). */
const TICK_FRAME_BUDGET_MS = 6;
let view: ViewState;
let notice = '';
let fps = 0;
let currentInterior: string | null = null;
const controller = new PlayerController(city.camera, city.renderer.domElement, world, onKey, canAccessBuilding, () => simulation.state.voxels, () => simulation.state);

const targetMarker = new THREE.Group();
const targetMaterial = new THREE.MeshBasicMaterial({ color: 0xeabf69, transparent: true, opacity: 0.65 });
const targetRing = new THREE.Mesh(new THREE.TorusGeometry(15, 0.6, 4, 40), targetMaterial);
targetRing.rotation.x = -Math.PI / 2;
targetMarker.add(targetRing);
const targetBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 100, 4), new THREE.MeshBasicMaterial({ color: 0xeabf69, transparent: true, opacity: 0.25, depthWrite: false }));
targetBeam.position.y = 50;
targetMarker.add(targetBeam);
targetMarker.visible = false;
city.scene.add(targetMarker);
const navigationPath = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe9c16d, transparent: true, opacity: 0.72, depthTest: false }));
navigationPath.renderOrder = 3;
navigationPath.visible = false;
city.scene.add(navigationPath);
let navigationJourney: WalkingJourney | null = null;
let transitJourney: TransitJourney | null = null;
const journeyNavigation = new JourneyNavigation(world);
let navigationPlan: JourneyNavigationPlan | null = null;

const placedBlocks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: '#d0b784', roughness: 0.9 }), 4096);
placedBlocks.count = 0;
placedBlocks.frustumCulled = false;
city.scene.add(placedBlocks);
let blocksVersion = '';
const matrix = new THREE.Matrix4();

const actions: UIActions = {
  cue: name => ambience.cue(name),
  inspectBuildingAlteration: buildingId => simulation.inspectBuildingAlteration({ buildingId }),
  publicEmploymentStatus: () => simulation.publicServiceCoverage().transferReview ?? null,
  isAtBuildingFunctionPoint(buildingId, purpose) {
    const building = world.buildings.find(site => site.id === buildingId);
    return !!building && simulation.isAtBuildingFunctionPoint(building, simulation.state.player.position, purpose);
  },
  command: execute,
  navigateTarget(targetId,preference) { actions.travel(targetId,preference); },
  navigateAircraft(aircraftId) { const craft = simulation.state.aviation?.aircraft.find(a => a.id === aircraftId); if (craft) setMode(craft.kind, craft.id); },
  setMode,
  setQuality(quality) {
    settings.quality = quality;
    city.setQuality(quality);
    persistPreferences();
  },
  travel(targetId, preference: 'walk' | 'transit' | 'auto' = 'walk') {
    // 'auto' (a map crowd halo): public transport for a far venue when a service exists, otherwise walking.
    if (preference === 'auto') {
      const site = world.buildings.find(b => b.id === targetId), feet = simulation.state.player.position, metres = site ? Math.round(Math.hypot(site.door.x - feet.x, site.door.z - feet.z)) : 0;
      if (metres > AUTO_TRANSIT_METRES && simulation.command({ type: 'planJourney', targetId, value: 1 }).ok) {
        syncNavigation();
        if (!navigationPlan?.unavailable) return showNotice(`目的地较远（直线约 ${metres} 米），已规划公共交通至${navigationPlan!.destination!.name}；请先步行到首段乘车点，现场查看当前班次与票款。`);
      }
      preference = 'walk';
    }
    const planned = simulation.command({ type: 'planJourney', targetId, value: preference === 'transit' ? 1 : 0 });
    if (!planned.ok) return showNotice(planned.message, false);
    syncNavigation();
    if (navigationPlan?.unavailable) return showNotice(navigationPlan.unavailable, false);
    const journey = navigationJourney!;
    showNotice(preference === 'transit' ? `公共交通方案至${navigationPlan!.destination!.name}；请先步行到首段乘车点，现场查看当前班次与票款。` : `步行导航至${journey.destination.name}，道路与桥面路线约 ${Math.round(journey.metres)} 米。${journey.stairsFromFloor !== null ? '请先在楼梯处按 E 回到一层。' : '金线通往实际入口或停靠点；公开班次可在交通手册查看。'}`);
  },
  interact,
  async save() { await save(true); },
  async load() {
    try {
      const data = await readSavedGame();
      if (!data) return showNotice('当前浏览器还没有存档。', false);
      await loadData(data);
    } catch { showNotice('浏览器存储不可用，请导入下载的 JSON 存档。', false); }
  },
  exportSave() {
    const blob = new Blob([simulation.exportSave()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yunshan-day-${simulation.state.day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showNotice('存档已导出，保留该文件即可跨浏览器恢复。');
  },
  async importSave(file) {
    if (file.size > 8 * 1024 * 1024) return showNotice('存档超过 8 MB，无法读取。', false);
    try { await loadData(await file.text()); } catch { showNotice('无法读取存档文件。', false); }
  },
  setSetting(key, value) {
    if (key === 'renderDistance' && typeof value === 'number') {
      settings.renderDistance = THREE.MathUtils.clamp(value, 800, 6000);
      city.setRenderDistance(settings.renderDistance);
    } else if (key === 'fpsCap' && typeof value === 'number' && [30, 60, 120].includes(value)) settings.fpsCap = value;
    else if (key === 'dynamicResolution' && typeof value === 'boolean') {
      settings.dynamicResolution = value;
      city.setDynamicResolution(value);
    } else if (key === 'simulationDetail' && typeof value === 'number') settings.simulationDetail = THREE.MathUtils.clamp(value, 0.5, 2);
    else if (key === 'volume' && typeof value === 'number') { settings.volume = THREE.MathUtils.clamp(value, 0, 1); ambience.setVolume(settings.volume); }
    persistPreferences();
  },
  resetView() { controller.resetView(); showNotice('已调整当前人物的视线；可步行登临观景处，或到租赁点登机俯瞰山城。'); },
};
ui = new CityUI(app, world, actions);

try {
  if (previousSave && !startupLayoutError) {
    const result = simulation.importSave(previousSave);
    if (result.ok) { syncPlayerView(); ui.notify('已恢复这个浏览器中的上次旅程。'); }
    else { autosaveAllowed = false; ui.notify('上次存档无法恢复，已保留原存档并停止自动覆盖：' + result.message, false); }
  }
} catch { autosaveAllowed = false; ui.notify('浏览器存储不可用；旅程仍可通过导出 JSON 保存。', false); }
if (startupLayoutError) ui.notify('上次存档的城市布局无法识别，已保留原存档并停止自动覆盖：' + startupLayoutError, false);
if (startupReadFailed) ui.notify('浏览器存储不可用；旅程仍可通过导出 JSON 保存。', false);

city.renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  simulation.command({ type: 'pause', value: 1 });
  save(false);
  ui.notify('图形上下文已中断。已尝试保存，请重新加载页面恢复。', false);
});

let last = performance.now();
let lastRender = -1000;
let uiAccumulator = 0;
let fpsAccumulator = 0;
let renderedFrames = 0;
let autosaveAccumulator = 0;
let elapsed = 0;
let raf = 0;
// Ambience (procedural, display only) starts on the first user gesture, as browsers require.
const ambience = new Ambience(settings.volume), waterfall = getWaterfallPath(world);
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => { if (settings.volume > 0) ambience.start(); }, { capture: true });
let ambiencePosition: Vec3 | null = null;
function segmentDistanceXZ(p: Vec3, a: Vec3, b: Vec3): number { const dx = b.x - a.x, dz = b.z - a.z, n = dx * dx + dz * dz, t = n ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / n)) : 0; return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t); }
function updateAmbience(state: SimState, seconds: number): void {
  if (!ambience.started) return;
  const p = controller.position, profiles = state.extension?.actorProfiles;
  let water = Infinity;
  for (const line of [world.river, waterfall]) for (let i = 1; i < line.length; i++) water = Math.min(water, segmentDistanceXZ(p, line[i - 1], line[i]));
  const speed = ambiencePosition && seconds > 0 ? Math.hypot(p.x - ambiencePosition.x, p.z - ambiencePosition.z) / seconds : 0; ambiencePosition = { ...p };
  const nearbyPeople = state.citizens.filter(c => c.state !== 'riding' && profiles?.[c.id]?.alive !== false && Math.hypot(c.position.x - p.x, c.position.y - p.y, c.position.z - p.z) < 25).length;
  ambience.update(ambienceLevels({ hour: state.hour, position: p, ground: terrainHeight(world, p.x, p.z), waterDistance: water, nearbyPeople, walkingSpeed: controller.mode === 'walk' ? speed : 0, inside: !!controller.inside, weather: state.weather, paused: state.paused }));
}
function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  const rawDelta = Math.max((now - last) / 1000, 0);
  // Catch up ordinary slow frames without making simulation speed depend on
  // rendering FPS. Cap long stalls; visibilitychange resets the clock separately.
  const delta = Math.min(rawDelta, 1);
  last = now;
  if (document.hidden) return;
  elapsed += delta;
  // Preserve real held-key intervals and small collision steps on slow frames.
  controller.stepWalkingFrame(now, rawDelta, Boolean(simulation.state.player.vehicleId), simulation.state.paused);
  if (controller.blockedAccess) { showNotice(controller.blockedAccess, false); controller.blockedAccess = null; }
  // The player's own inputs reach the city just before a tick starts, once a frame (as step() took them
  // before its ticks); a tick part-way through (stepSliced) has read them already.
  let inputsApplied = false;
  const applyInputs = () => {
    if (inputsApplied) return; inputsApplied = true;
    if (controller.mode === 'walk' && !simulation.state.player.vehicleId && !activeAircraft(simulation.state)) {
      simulation.state.player.position = controller.walkingPosition;
      releaseRoadExitPermit(world, simulation.state, 'player', simulation.state.player.position);
    }
    if (activeAircraft(simulation.state)) setAircraftControls(simulation.state, controller.aviationControls);
    simulation.setFocus(controller.position, controller.mode);
    const driveAPI = simulation as Simulation & { isDriving?: (id?: string) => boolean; driveInput?: (throttle: number, turn: number, brake: boolean) => void };
    if (driveAPI.isDriving?.()) {
      const input = controller.mode === 'walk' ? controller.drivingControls : { throttle: 0, turn: 0, brake: true };
      driveAPI.driveInput?.(input.throttle, input.turn, input.brake);
    }
    const detailAPI = simulation as Simulation & { setDetail?: (detail: number) => void };
    detailAPI.setDetail?.(settings.simulationDetail);
  };
  // A tick is spread over frames, at most about TICK_FRAME_BUDGET_MS of it per frame (results are those of step()),
  // unless it has fallen behind (a slow frame rate): then it finishes now, so the city never runs slower than before.
  const sliceStart = performance.now();
  simulation.stepSliced(delta, () => performance.now() - sliceStart < TICK_FRAME_BUDGET_MS || simulation.tickBehind, applyInputs);
  // A paused or idle frame still hands the city the player's position and focus, as before.
  if (!simulation.tickOpen) applyInputs();
  // Rebuild the gold line after canonical closures/reopening and after state
  // replacement. The original journey remains the authority for its target.
  syncNavigation(false);
  const aircraft = activeAircraft(simulation.state);
  if (aircraft) controller.syncAircraft(aircraft);
  else if (simulation.state.player.vehicleId) controller.syncPassenger(simulation.state.player.position);
  const interior = controller.inside ? `${controller.inside.id}:${controller.floor}` : null;
  if (interior !== currentInterior) { city.setInterior(controller.inside?.id ?? null, controller.floor); currentInterior = interior; }
  updateBlocks();
  (city as { setFlying?(flying: boolean): void }).setFlying?.(controller.mode !== 'walk');
  (city as { setFirstPersonArms?(visible: boolean): void }).setFirstPersonArms?.(controller.mode === 'walk' && !simulation.state.player.vehicleId && !activeAircraft(simulation.state));
  city.update(simulation.state, elapsed);
  aviationRenderer.update(simulation.state, elapsed);
  if (now - lastRender >= 1000 / settings.fpsCap - 0.5) {
    city.render();
    lastRender = now;
    renderedFrames++;
  }
  fpsAccumulator += rawDelta;
  if (fpsAccumulator >= 1) { fps = Math.round(renderedFrames / fpsAccumulator); fpsAccumulator = 0; renderedFrames = 0; }
  uiAccumulator += delta;
  if (uiAccumulator >= 0.2) {
    view = getView();
    ui.update(simulation.state, view);
    updateAmbience(simulation.state, uiAccumulator);
    uiAccumulator = 0;
  }
  autosaveAccumulator += delta;
  if (autosaveAccumulator >= 30) { autosaveAccumulator = 0; save(false); }
}
view = getView();
ui.update(simulation.state, view);
raf = requestAnimationFrame(frame);
window.addEventListener('resize', () => city.resize());
document.addEventListener('visibilitychange', () => { last = performance.now(); if (document.hidden) save(false); });
window.addEventListener('pagehide', () => save(false));

function getView(): ViewState {
  const position = controller.position;
  const building = controller.inside ?? world.buildings.filter(b => distance(position, b.door) < 18).sort((a, b) => distance(position, a.door) - distance(position, b.door))[0] ?? null;
  const citizen = nearbyResident(simulation.state, position, metCitizenId); metCitizenId = citizen?.id ?? null;
  const vehicle = simulation.state.vehicles.filter(v => distance(position, v.position) < 24).sort((a, b) => distance(position, a.position) - distance(position, b.position))[0] ?? null;
  const aircraft = activeAircraft(simulation.state) ?? simulation.state.aviation?.aircraft.filter(a => distance(position, a.position) < 18).sort((a, b) => distance(position, a.position) - distance(position, b.position))[0] ?? null;
  return { navigationUnavailable: navigationPlan?.unavailable ?? null, transitJourney, journey: navigationJourney, nearbyAircraft: aircraft, mode: controller.mode, ...settings, fps, drawCalls: city.renderer.info.render.calls, triangles: city.renderer.info.render.triangles, position, nearbyBuilding: building, nearbyCitizen: citizen, nearbyVehicle: vehicle, targetDistrict, inside: Boolean(controller.inside), notice };
}

function execute(command: Command): void {
  simulation.finishTick();
  if (!['setTime', 'pause', 'speed'].includes(command.type) && !AIRCRAFT_COMMANDS.has(command.type) && controller.mode !== 'walk') {
    showNotice('请先安全落地并退出机舱，走近人物、建筑或站点后操作。', false);
    return;
  }
  const body = () => ({ hunger: simulation.state.player.needs.hunger, food: simulation.state.player.inventory.food ?? 0 }), before = body();
  const result = simulation.command(command);
  showNotice(result.ok ? result.message + mealFeedback(command.type, before, body()) : result.message, result.ok);
  ambience.cue(cueFor(command.type, result.ok));
  if (result.ok && ['boardAircraft', 'leaveAircraft'].includes(command.type)) syncPlayerView();
  if (result.ok && ['leaveVehicle', 'ride', 'drive'].includes(command.type)) controller.syncPassenger(simulation.state.player.position);
  if (result.ok && ['planJourney', 'cancelJourney', 'leaveVehicle'].includes(command.type)) syncNavigation();
  view = getView();
  ui.update(simulation.state, view);
}

function syncPlayerView(): void {
  const aircraft = activeAircraft(simulation.state);
  controller.setMode(aircraft?.kind ?? 'walk', simulation.state.player.position, aircraft);
  if (aircraft) controller.jetSpeed = simulation.state.aviation!.controls.speed;
  currentInterior = null;
  city.setInterior(controller.inside?.id ?? null, controller.floor);
  syncNavigation();
}

function syncNavigation(force = true): void {
  const next = journeyNavigation.read(simulation.state, force);
  if (next === navigationPlan) return;
  navigationPlan = next;
  transitJourney = next.transit;
  navigationJourney = next.walking;
  targetDistrict = next.destination?.districtId ?? null;
  targetMarker.visible = !!next.destination;
  navigationPath.visible = !!navigationJourney;
  if (next.destination) targetMarker.position.copy(next.destination.position);
  if (navigationJourney) {
    navigationPath.geometry.dispose();
    navigationPath.geometry = new THREE.BufferGeometry().setFromPoints(navigationJourney.points.map(p => new THREE.Vector3(p.x,p.y+.3,p.z)));
  }
}

function setMode(mode: ViewMode, aircraftId?: string): void {
  simulation.finishTick();
  const active = activeAircraft(simulation.state);
  if (mode === 'walk') {
    if (active) return execute({ type: 'leaveAircraft', targetId: active.id });
    controller.setMode('walk', simulation.state.player.position);
    return showNotice('WASD 步行，拖动环顾，双击锁定鼠标；E 使用建筑、人物与附近载具。');
  }
  if (active) return showNotice('已在航空器机舱内。请返航停稳、退出后，再取得另一架航空器。', false);
  const craft = simulation.state.aviation?.aircraft.filter(a => a.kind === mode && (!aircraftId || a.id === aircraftId)).sort((a, b) => distance(simulation.state.player.position, a.position) - distance(simulation.state.player.position, b.position))[0];
  if (!craft) return showNotice('此城市尚无该类航空器停机位。', false);
  if (distance(simulation.state.player.position, craft.position) <= 6) {
    if (mode === 'drone' && !craft.reserved) return execute({ type: 'rentAircraft', targetId: craft.id });
    return execute({ type: 'boardAircraft', targetId: craft.id });
  }
  const pad = getAviationPads(world).find(p => p.id === craft.homePadId)!;
  actions.travel(pad.id);
  if (navigationPlan?.unavailable) return;
  showNotice(`导航至${pad.name}。需步行走到机舱门旁${mode === 'drone' ? '支付 24 云币租用并登机；载人无人机使用自动驾驶，无远程摄像模式' : '登机；战机需要同时持有卫士与驾驶员资质'}。`);
}

function interact(): void {
  simulation.finishTick();
  const aircraft = activeAircraft(simulation.state);
  if (aircraft) return execute({ type: aircraft.status === 'parked' ? 'leaveAircraft' : 'landAircraft', targetId: aircraft.id });
  if (simulation.state.player.vehicleId) return execute({ type: 'leaveVehicle' });
  const groundAircraft = getView().nearbyAircraft;
  if (groundAircraft && distance(controller.position, groundAircraft.position) <= 6) return execute({ type: groundAircraft.kind === 'drone' && !groundAircraft.reserved ? 'rentAircraft' : 'boardAircraft', targetId: groundAircraft.id });
  if (controller.useStairs()) {
    const building = controller.inside!;
    simulation.state.player.position = controller.walkingPosition;
    releaseRoadExitPermit(world, simulation.state, 'player', simulation.state.player.position);
    city.setInterior(building.id, controller.floor);
    const level = controller.floor < 0 ? `地下 ${-controller.floor} 层` : `${controller.floor + 1} 层`;
    const use = controller.floor < 0 ? building.basementUses?.[-controller.floor - 1] : building.floorUses?.[controller.floor];
    showNotice(`抵达${level}${use ? ' · ' + use : ''}。再次按 E 使用楼梯与升降。`);
    return;
  }
  if (controller.blockedAccess) { showNotice(controller.blockedAccess, false); controller.blockedAccess = null; return; }
  const nearby = getView();
  const building = nearby.nearbyBuilding;
  // A vehicle stopped to board right here comes before the door, unless the panel shows the place (transit-label.ts).
  if (!controller.inside && eBoardsVehicle(controller.position, nearby.nearbyVehicle, building?.door, ui.shownContext)) return execute({ type: 'ride', targetId: nearby.nearbyVehicle!.id });
  // On the resident's tab E greets them before any door (social-reach.ts eGreetsResident).
  if (!controller.inside && ui.shownContext === 'citizen' && nearby.nearbyCitizen && eGreetsResident(controller.position, nearby.nearbyCitizen.position, building?.door, 'citizen')) return execute({ type: 'socialize', targetId: nearby.nearbyCitizen.id });
  if (building && controller.useDoor(building)) {
    simulation.state.player.position = controller.walkingPosition;
    releaseRoadExitPermit(world, simulation.state, 'player', simulation.state.player.position);
    city.setInterior(controller.inside?.id ?? null);
    showNotice(controller.inside ? `进入${building.name}，可在生活面板使用设施。楼内左后角为楼梯。` : `走出${building.name}。`);
    return;
  }
  if (nearby.nearbyCitizen && eGreetsResident(controller.position, nearby.nearbyCitizen.position, null, ui.shownContext)) return execute({ type: 'socialize', targetId: nearby.nearbyCitizen.id });
  if (nearby.nearbyVehicle && ui.shownContext !== 'building') return execute({ type: 'ride', targetId: nearby.nearbyVehicle.id });
  // The panel names a place whose door is still a few steps away: say where it is rather than try to use it from here.
  const facing = city.camera.getWorldDirection(new THREE.Vector3());
  if (building && !controller.inside && Math.hypot(building.door.x - controller.position.x, building.door.z - controller.position.z) > 6) {
    const hint = entranceHint(controller.position, { x: facing.x, z: facing.z }, [building]);
    if (hint) return showNotice(`${hint}走到门前按 E。`);
  }
  if (building) {
    const command: Record<string, Command['type']> = { market: 'purchase', home: 'rest', workshop: 'work', school: 'work', farm: 'work', core: 'energy' };
    if (command[building.kind]) return execute({ type: command[building.kind], targetId: building.id });
  }
  // Nothing here: point to the nearest entrance relative to the way the player faces (entrance-hint.ts).
  const hint = !controller.inside && entranceHint(controller.position, { x: facing.x, z: facing.z }, world.buildings);
  showNotice(hint ? `${hint}走近后按 E。` : '靠近建筑入口、居民或交通站点后按 E。');
}

function canAccessBuilding(building: Building, floor: number): boolean {
  return canAccessFloor(building, floor, simulation.state.player);
}

function onKey(key: string): void {
  simulation.finishTick();
  if (!ui) return;
  if (key === 'KeyV') { const craft = activeAircraft(simulation.state); if (craft) execute({ type: craft.status === 'parked' ? 'leaveAircraft' : 'landAircraft', targetId: craft.id }); else setMode('drone'); }
  else if (key === 'KeyE') interact();
  else if (key === 'KeyF') execute({ type: 'pause', value: simulation.state.paused ? 0 : 1 });
  else if (key === 'KeyT') actions.resetView();
  else if (key === 'KeyB' || key === 'KeyX') {
    const direction = new THREE.Vector3();
    city.camera.getWorldDirection(direction);
    const position = { x: Math.round((controller.position.x + direction.x * 1.4) / 0.2) * 0.2, y: Math.round((controller.position.y + 0.1) / 0.2) * 0.2, z: Math.round((controller.position.z + direction.z * 1.4) / 0.2) * 0.2 };
    execute({ type: key === 'KeyB' ? 'build' : 'demolish', position });
  } else if (key === 'Escape') document.exitPointerLock?.();
}

function showNotice(message: string, ok = true): void { notice = message; ui?.notify(message, ok); }
function persistPreferences(): void { try { localStorage.setItem(PREF_KEY, JSON.stringify(settings)); } catch { /* Saving settings is optional. */ } }
async function save(explicit: boolean): Promise<void> {
  if (!explicit && !autosaveAllowed) return;
  try { await writeSavedGame(simulation.exportSave(), world); autosaveAllowed = true; if (explicit) showNotice('旅程已保存在当前浏览器。'); }
  catch { if (explicit) showNotice('浏览器存储不可用或已满，请下载 JSON 存档。', false); }
}
async function loadData(data: string): Promise<void> {
  try {
    const selected = selectSavedWorld(data);
    if (savedWorldFingerprint(selected.world) !== savedWorldFingerprint(world)) {
      const candidate = new Simulation(selected.world), checked = candidate.importSave(data);
      if (!checked.ok) return showNotice(checked.message,false);
      const priorAutosave = autosaveAllowed, wasPaused = simulation.state.paused;
      autosaveAllowed = false; simulation.command({type:'pause',value:1});
      try {
        await writeSavedGame(candidate.exportSave(),selected.world);
        showNotice('已验证并保存另一座已知布局城市；正在重新打开以同步地形、碰撞、人物和存档。');
        window.location.reload();
      } catch {
        autosaveAllowed = priorAutosave; simulation.command({type:'pause',value:wasPaused?1:0});
        showNotice('无法保存新布局存档，当前旅程保持原样。请导出存档后检查浏览器存储。',false);
      }
      return;
    }
    const result = simulation.importSave(data);
    if (result.ok) {
      syncPlayerView(); currentInterior = null; blocksVersion = '';
      city.setInterior(controller.inside?.id ?? null, controller.floor);
      autosaveAllowed = true; await save(false);
    }
    showNotice(result.message,result.ok);
  } catch (error) { showNotice('读档失败：'+(error instanceof Error?error.message:'未知城市布局'),false); }
}
function updateBlocks(): void {
  const voxels = (simulation.state as SimState & { voxels?: { position: Vec3 }[] }).voxels ?? [];
  const lastBlock = voxels.at(-1)?.position;
  const key = `${voxels.length}:${lastBlock?.x}:${lastBlock?.y}:${lastBlock?.z}`;
  if (key === blocksVersion) return;
  blocksVersion = key;
  placedBlocks.count = Math.min(voxels.length, 4096);
  for (let i = 0; i < placedBlocks.count; i++) {
    const p = voxels[i].position;
    matrix.makeTranslation(p.x, p.y + 0.1, p.z);
    placedBlocks.setMatrixAt(i, matrix);
  }
  placedBlocks.instanceMatrix.needsUpdate = true;
}

// Opt-in diagnostics aid local verification. No network, credentials or remote writes.
if (new URLSearchParams(location.search).has('debug')) {
  const diagnostics = { world, simulation, city, controller, actions, getView, canAccessBuilding, ambience, storage: { read: readSavedGame, write: (json: string) => writeSavedGame(json, world) }, dispose() { cancelAnimationFrame(raf); controller.dispose(); ui.dispose(); aviationRenderer.dispose(); city.dispose(); } };
  Object.assign(window, { __YUNSHAN__: diagnostics });
}
