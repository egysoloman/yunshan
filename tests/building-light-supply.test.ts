import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../src/world';
import type { SimState } from '../src/types';
import { gridWorld, gridState } from './power-grid-fixture';
import { dispatchPowerGrid } from '../src/simulation/power-grid';
import { buildingLightSupplyRatio } from '../src/rendering/building-light-supply';
import { ArchitectureDetailManager } from '../src/rendering/architecture-detail';

test('an actual disconnected finite feeder leaves its building light off despite a high city average', () => {
  const world = gridWorld(), state = gridState(world);
  world.powerGrid!.links[0].closed = false;
  state.powerGrid = dispatchPowerGrid(world, state, .25); state.energy = 100;
  const original = JSON.stringify({ world, state });
  assert.equal(state.powerGrid.dispatch!.buildings['other-city-farm'].servedP, 0);
  assert.equal(buildingLightSupplyRatio(world, state, 'other-city-farm'), 0);
  assert.equal(buildingLightSupplyRatio(world, state, 'other-city-clinic'), 1);
  assert.equal(buildingLightSupplyRatio(world, state, 'missing'), 0);
  assert.equal(JSON.stringify({ world, state }), original);
});

test('partial building dispatch, null feeders, stale phases and missing grid data never fall back to aggregate power', () => {
  const world = gridWorld(), state = gridState(world);
  world.powerGrid!.links[0].capacityP = 1;
  world.powerGrid!.buildings.find(b => b.buildingId === 'other-city-clinic')!.nodeId = null;
  state.powerGrid = dispatchPowerGrid(world, state, .25); state.energy = 100;
  assert.equal(buildingLightSupplyRatio(world, state, 'other-city-farm'), .5);
  assert.equal(buildingLightSupplyRatio(world, state, 'other-city-clinic'), 0);
  const missing = { ...state, powerGrid: undefined }; assert.equal(buildingLightSupplyRatio(world, missing, 'other-city-farm'), 0);
  state.tick++; assert.equal(buildingLightSupplyRatio(world, state, 'other-city-farm'), 0); state.tick--;
  state.hour += 1 / 60; assert.equal(buildingLightSupplyRatio(world, state, 'other-city-farm'), 0);
});

test('an undeclared-grid legacy world keeps the original city energy ratio without creating a supply', () => {
  const world = { powerGrid: undefined }, state = { tick: 7, day: 0, hour: 11.2, energy: 63, powerGrid: undefined, extension: undefined };
  const original = JSON.stringify({ world, state });
  assert.equal(buildingLightSupplyRatio(world, state, 'any-existing-building'), .63);
  assert.equal(JSON.stringify({ world, state }), original);
  assert.equal(buildingLightSupplyRatio(world, { ...state, energy: 0 }, 'any-existing-building'), 0);
});

test('per-building emission and at most two street sources follow the same supplied meter and release owned materials', () => {
  const world = createWorld(), building = world.buildings.find(b => b.kind === 'market')!, manager = new ArchitectureDetailManager([building]);
  try {
    const camera = { ...building.door, y: building.door.y + 1.72 };
    manager.update(camera);
    const emissions: THREE.MeshStandardMaterial[] = [];
    manager.group.traverse(o => { if (o instanceof THREE.InstancedMesh && o.name === '灯笼暖光') emissions.push(o.material as THREE.MeshStandardMaterial); });
    assert.equal(emissions.length, 1);
    const supplied = (id: string) => id === building.id ? 1 : 0, half = (id: string) => id === building.id ? .5 : 0, disconnected = () => 0;
    manager.setLighting(0, 1, supplied);
    const fullEmission = emissions[0].emissiveIntensity, full = manager.getExteriorLightConfigurations(camera, 0, supplied);
    assert.ok(full.length > 0 && full.length <= 2);
    manager.setLighting(0, 1, half);
    assert.equal(emissions[0].emissiveIntensity, fullEmission / 2);
    assert.equal(manager.getExteriorLightConfigurations(camera, 0, half)[0].intensity, full[0].intensity / 2);
    manager.setLighting(0, 1, disconnected);
    assert.equal(emissions[0].emissiveIntensity, 0);
    assert.equal(manager.getStats().lanternEmissionByBuilding[building.id], 0);
    assert.deepEqual(manager.getExteriorLightConfigurations(camera, 0, disconnected), []);
    // Returning to the legacy numeric API retains the original public method.
    manager.setLighting(0, .5); assert.equal(emissions[0].emissiveIntensity, fullEmission / 2);
    let disposed = 0; emissions.forEach(m => m.addEventListener('dispose', () => disposed++));
    manager.update({ x: 100000, y: 100000, z: 100000 }); assert.equal(disposed, 1);
    manager.dispose(); assert.equal(disposed, 1);
  } finally { manager.dispose(); }
});
