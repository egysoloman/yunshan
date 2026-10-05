import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import { buildingLocalPosition, getBuildingBody, getBuildingFloorPlan, containsUnion } from '../src/architecture-floor-plan';
import { getInteriorLightConfigurations, interiorLightAttenuation, INTERIOR_LIGHT_SLOTS } from '../src/rendering/interior-lighting';
import type { Building, Vec3 } from '../src/types';

const world = createWorld();
const market = world.buildings.find(building => building.id === 'river-b1')!;

test('the actual overbright river shop gets bounded light at its real sale points', () => {
  const plan = getBuildingFloorPlan(market, 0)!, snapshot = JSON.stringify(market);
  const camera = { ...market.position, y: market.position.y + .6 + 1.72, z: market.position.z + 11 };
  const lights = getInteriorLightConfigurations(market, 0, camera, 1, 1);
  assert.equal(lights.length, INTERIOR_LIGHT_SLOTS);
  for (const light of lights) {
    assert.equal(light.source, 'program-use-point');
    assert.ok(plan.usePoints.some(point => point.id === light.anchorId));
    const sourcePoint = market.functionPoints!.find(point => point.id === `0:${light.anchorId}:sale`)!;
    assert.ok(sourcePoint, 'uses the already stored World sale point rather than an inverted floating origin');
    assert.equal(light.position.x, sourcePoint.position.x); assert.equal(light.position.z, sourcePoint.position.z);
    const local = buildingLocalPosition(market, light.position);
    assert.ok(local.y > plan.y + 1.72 && local.y < plan.ceilingY - .4);
    const eyeDistance = local.y - plan.y - 1.72;
    assert.ok(light.intensity * interiorLightAttenuation(eyeDistance, light.distance) <= 1.25 + 1e-9);
    const oldHeight = market.height / market.floors * .68;
    const old = Math.max(90, market.width * 13) * .7 * interiorLightAttenuation(oldHeight - 1.72, Math.max(market.width, market.depth) * 1.25);
    assert.ok(old > 100, 'retains the measured old low-ceiling irradiance failure');
    assert.ok(light.distance < Math.min(market.width, market.depth));
    assert.equal(light.decay, 2);
  }
  assert.equal(JSON.stringify(market), snapshot);
});

test('all three real sale bays can receive a slot without adding fake positions or a third light', () => {
  const plan = getBuildingFloorPlan(market, 0)!;
  for (const point of plan.usePoints) {
    const camera = { x: market.position.x + point.x, y: market.position.y + .6 + 1.72, z: market.position.z + point.z };
    const lights = getInteriorLightConfigurations(market, 0, camera, 0, 1);
    assert.equal(lights[0].anchorId, point.id); assert.ok(lights.length <= 2);
  }
});

test('every current program floor keeps its sources within the real occupied wing and ceiling', () => {
  const snapshot = JSON.stringify(world); let count = 0, floorCount = 0;
  for (const building of world.buildings) {
    const body = getBuildingBody(building); if (!body) continue;
    for (const plan of body.floorPlans) {
      floorCount++;
      const lights = getInteriorLightConfigurations(building, plan.floor, building.door, .4, .5);
      assert.ok(lights.length <= INTERIOR_LIGHT_SLOTS);
      for (const light of lights) {
        const local = buildingLocalPosition(building, light.position);
        assert.ok(containsUnion(plan.interior, local.x, local.z), `${building.id}/${plan.floor}: no court source`);
        assert.ok(plan.usePoints.some(point => point.id === light.anchorId));
        assert.ok(local.y > plan.y + 1.72 && local.y < plan.ceilingY - .4);
        assert.ok(light.intensity >= 0 && light.intensity <= 70);
        assert.ok(light.distance > 0 && light.distance <= 14);
        assert.ok([light.position.x, light.position.y, light.position.z, light.intensity, light.distance].every(Number.isFinite));
        count++;
      }
    }
  }
  assert.ok(floorCount > 1500 && count > 1500);
  assert.equal(JSON.stringify(world), snapshot);
  console.log(JSON.stringify({ scope: 'pure-current-world-light-configuration', floors: floorCount, lightConfigurations: count, worldUnchanged: true }));
});

test('zero supplied power extinguishes local lights, and day/night dimming is continuous and bounded', () => {
  const camera = market.door;
  const night = getInteriorLightConfigurations(market, 0, camera, 0, 1);
  const halfPower = getInteriorLightConfigurations(market, 0, camera, 0, .5);
  const noPower = getInteriorLightConfigurations(market, 0, camera, 0, 0);
  const morning = getInteriorLightConfigurations(market, 0, camera, .5, 1);
  const day = getInteriorLightConfigurations(market, 0, camera, 1, 1);
  for (let i = 0; i < night.length; i++) {
    assert.equal(halfPower[i].intensity, night[i].intensity * .5);
    assert.equal(noPower[i].intensity, 0);
    assert.ok(day[i].intensity > 0 && day[i].intensity < night[i].intensity);
    assert.ok(Math.abs(morning[i].intensity - (day[i].intensity + night[i].intensity) / 2) < 1e-12);
  }
  for (const power of [NaN, Infinity, -1]) assert.ok(getInteriorLightConfigurations(market, 0, camera, 0, power).every(light => light.intensity === 0));
});

test('buried floors do not infer daylight and different real room uses have distinct task light', () => {
  const home = world.buildings.find(building => building.kind === 'home' && getBuildingBody(building))!;
  const clinic = world.buildings.find(building => building.kind === 'clinic' && getBuildingBody(building))!;
  const house = getInteriorLightConfigurations(home, 0, home.door, 0, 1);
  const care = getInteriorLightConfigurations(clinic, 0, clinic.door, 0, 1);
  assert.notEqual(house[0].color, care[0].color);
  const basementSite = { ...market, basements: 1 } as Building;
  assert.deepEqual(getInteriorLightConfigurations(basementSite, -1, market.door, 0, 1), getInteriorLightConfigurations(basementSite, -1, market.door, 1, 1));
  for (const floor of [NaN, .5, -2, market.floors]) assert.deepEqual(getInteriorLightConfigurations(market, floor, market.door, 1, 1), []);
});

test('historical landmark placements stay unchanged while width stops multiplying source strength', () => {
  const core = world.buildings.find(building => building.id === 'core-main')!;
  const camera: Vec3 = core.door, snapshot = JSON.stringify(core);
  const lights = getInteriorLightConfigurations(core, 0, camera, 1, 1);
  assert.equal(lights.length, 2); assert.ok(lights.every(light => light.source === 'preserved-legacy-placement'));
  for (const light of lights) {
    assert.ok(Math.abs(Math.abs(light.position.x - core.position.x) - core.width * .22) < 1e-9);
    assert.equal(light.position.z, core.position.z);
    assert.ok(light.intensity <= 70); assert.ok(light.distance <= 14);
  }
  assert.equal(JSON.stringify(core), snapshot);
});
