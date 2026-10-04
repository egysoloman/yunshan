import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildingLocalPosition, buildingWorldPosition, getBuildingBody, getBuildingFloorPlan, getBuildingUsePoints, wallPanels } from '../src/architecture-floor-plan';
import { createWorld } from '../src/world';
import { Simulation } from '../src/simulation';
import { CityRenderer } from '../src/renderer';
import { MarketShopfrontPool, describeMarketShopfront, marketShopfrontBoards } from '../src/rendering/market-shopfront';
import { MarketGoodsPool } from '../src/rendering/market-goods';
import type { SimState } from '../src/types';

const world = createWorld(), market = world.buildings.find(site => site.id === 'market-b0')!;
const simulation = new Simulation(world), shop = simulation.state.shops.find(row => row.buildingId === market.id)!;
// Rendering-only controlled views exercise post-transaction states without
// pretending a cold store already has a recorded operating title.
const view = (): SimState => {
  const state = structuredClone(simulation.state);
  state.shopLifecycle ??= { version: 1, nextListingId: 1, nextLeaseId: 1, nextReceiptId: 1, titles: {}, listings: [], leases: [], receipts: [] };
  state.shopLifecycle.titles[shop.id] ??= { shopId: shop.id, buildingId: market.id, scope: 'existing-business-and-site-use', legacyOwnerId: shop.ownerId!, assetOwnerId: shop.ownerId!, state: 'operating', suspendedAt: null, reason: '', listingId: null, leaseId: null, materialsHeld: 0, reopen: null, reopenHistory: [] };
  return state;
};

test('market name and operating notices read actual stock, closure, offered lease and tenant without mutating the save', () => {
  const saved = simulation.exportSave(), description = describeMarketShopfront(simulation.state, shop, market);
  assert.equal(description.stock, `食材 ${Math.floor(shop.inventory)}份 · ${shop.price.toFixed(1)}文`);
  assert.equal(simulation.exportSave(), saved);
  const state = view(), displayed = state.shops.find(row => row.id === shop.id)!;
  displayed.inventory = 0; displayed.open = true; assert.equal(describeMarketShopfront(state, displayed, market).status, '售罄');
  displayed.open = false; displayed.profit = 0; assert.equal(describeMarketShopfront(state, displayed, market).status, '休市');
  displayed.profit = -601; assert.equal(describeMarketShopfront(state, displayed, market).status, '停业');
  const title = state.shopLifecycle!.titles[shop.id]; assert.ok(title);
  title.state = 'suspended'; displayed.open = true;
  assert.equal(describeMarketShopfront(state, displayed, market).status, '停业', 'open flag cannot override an actual operating title');
  const owner = state.citizens.find(row => row.id === shop.ownerId)!; assert.ok(owner);
  title.listingId = 'controlled-readonly-offer';
  const now = state.extension!.lastUpdate;
  state.shopLifecycle!.listings.push({ id: title.listingId, shopId: shop.id, sellerId: owner.id, kind: 'lease', price: 12, deposit: 20, leasePeriods: 2, createdAt: now, expiresAt: now + 60, state: 'offered', acceptedBy: null, acceptedAt: null });
  assert.equal(describeMarketShopfront(state, displayed, market).listing, '经营权招租');
  state.extension!.lastUpdate = now + 60; assert.equal(describeMarketShopfront(state, displayed, market).listing, '', 'expired offerings are removed on display without changing their saved history');
  const tenant = state.citizens.find(row => row.id !== owner.id && state.extension!.actorProfiles[row.id].alive)!;
  state.shopLifecycle!.leases.push({ id: 'controlled-readonly-lease', listingId: title.listingId, shopId: shop.id, lessorId: owner.id, tenantId: tenant.id, rent: 12, periods: 2, startedAt: now, endsAt: now + 1440, nextDueAt: now + 1440, accruedPeriods: 0, accruedRent: 0, paidRent: 0, arrears: 0, depositInitial: 20, depositEscrow: 20, depositToLessor: 0, depositRefunded: 0, advanceInitial: 12, advanceRefunded: 0, state: 'active', endedAt: null });
  title.state = 'operating'; displayed.inventory = 12;
  assert.equal(describeMarketShopfront(state, displayed, market).operator, `承租经营：${tenant.name}`);
  assert.equal(describeMarketShopfront(state, displayed, market).status, '营业中');
  assert.equal(simulation.exportSave(), saved, 'controlled display variants never overwrite the authoritative simulation');
});


test('company share owner is not labelled as the actual operating lease tenant', () => {
  const saved = simulation.exportSave(), state = view(), displayed = state.shops.find(row => row.id === shop.id)!;
  const owner = state.citizens.find(row => row.id === shop.ownerId)!, tenant = state.citizens.find(row => row.id !== owner.id && state.extension!.actorProfiles[row.id].alive)!;
  const now = state.extension!.lastUpdate;
  // A controlled rendering input only: no incorporation/lease transaction or
  // cash/land ownership change is claimed from this distinct-owner case.
  state.shopLifecycle!.leases.push({ id: 'controlled-owner-mismatch-lease', listingId: 'controlled-owner-mismatch-offer', shopId: shop.id, lessorId: owner.id, tenantId: tenant.id, rent: 12, periods: 2, startedAt: now, endsAt: now + 1440, nextDueAt: now + 1440, accruedPeriods: 0, accruedRent: 0, paidRent: 0, arrears: 0, depositInitial: 20, depositEscrow: 20, depositToLessor: 0, depositRefunded: 0, advanceInitial: 12, advanceRefunded: 0, state: 'active', endedAt: null });
  state.extension!.companies.push({ id: 'controlled-owner-mismatch-company', name: '只读公司主体', ownerId: owner.id, buildingId: market.id, districtId: market.districtId, capital: 0, shares: 100, sharePrice: 0, listed: false, employees: 1, inventory: 0, revenue: 0, profit: 0, level: 1, marketShare: 0, shareholders: { [owner.id]: 100 }, foundedAt: now, parentId: null, shopBindingId: shop.id });
  const description = describeMarketShopfront(state, displayed, market);
  assert.equal(description.name, '只读公司主体');
  assert.equal(description.operator, `承租经营：${tenant.name}`, 'the actual lessee remains the displayed lessee after share ownership changes');
  assert.notEqual(description.operator, `承租经营：${owner.name}`);
  assert.equal(simulation.exportSave(), saved);
});

test('all native market boards finish existing opaque panels or lintels and leave every sale point and doorway clear', () => {
  const before = JSON.stringify(world); let notices = 0;
  for (const site of world.buildings.filter(site => site.kind === 'market')) {
    const plan = getBuildingFloorPlan(site, 0)!, panels = wallPanels(plan).filter(panel => panel.kind === 'solid');
    for (const board of marketShopfrontBoards(site)) {
      const centre = buildingLocalPosition(site, board.position), host = board.host;
      assert.ok(board.width > 0 && board.height > 0 && Object.values(centre).every(Number.isFinite));
      assert.ok(centre.x - board.width / 2 >= host.rect.x0 - 1e-7 && centre.x + board.width / 2 <= host.rect.x1 + 1e-7);
      assert.ok(centre.y - board.height / 2 >= host.bottom - 1e-7 && centre.y + board.height / 2 <= host.top + 1e-7);
      assert.ok(Math.abs(centre.z - host.rect.z1 - .003) < 1e-7);
      assert.ok(panels.some(panel => centre.x - board.width / 2 >= panel.rect.x0 - 1e-7 && centre.x + board.width / 2 <= panel.rect.x1 + 1e-7 && Math.abs(host.rect.z1 - panel.rect.z1) < 1e-7 && centre.y - board.height / 2 >= plan.y + panel.bottom - 1e-7 && centre.y + board.height / 2 <= plan.y + panel.top + 1e-7), `${site.id}: the complete graphic must have an opaque host`);
      notices++;
    }
  }
  assert.ok(notices > 200); assert.equal(JSON.stringify(world), before);
});

test('resident shop surfaces reuse textures on unchanged frames and dispose all textures and geometry on eviction', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = { fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: '', textBaseline: '', font: '', fillRect() {}, strokeRect() {}, fillText() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
  const scene = new THREE.Scene(), pool = new MarketShopfrontPool(scene, world), saved = simulation.exportSave();
  try {
    pool.update(simulation.state, market.door, new Set([market.id]));
    const initial = { ...pool.group.userData.budget }, resources = pool.group.children[0].children.map(child => child.uuid);
    assert.equal(initial.markets, 1); assert.ok(initial.textures > 0 && initial.textures <= 2); assert.equal(initial.paints, 1);
    for (let frame = 0; frame < 300; frame++) pool.update(simulation.state, market.door, new Set([market.id]));
    assert.deepEqual(pool.group.children[0].children.map(child => child.uuid), resources); assert.equal(pool.group.userData.budget.paints, 1);
    const state = view(); state.shops.find(row => row.id === shop.id)!.inventory = 0;
    pool.update(state, market.door, new Set([market.id])); assert.equal(pool.group.userData.budget.paints, 2);
    const textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>(); let disposedTextures = 0, disposedGeometry = 0;
    pool.group.traverse(object => { if (object instanceof THREE.Mesh) { textures.add(object.material.map); geometries.add(object.geometry); } });
    for (const texture of textures) texture.addEventListener('dispose', () => disposedTextures++);
    for (const geometry of geometries) geometry.addEventListener('dispose', () => disposedGeometry++);
    pool.update(state, market.door, new Set()); assert.equal(pool.group.children.length, 0); assert.equal(disposedTextures, textures.size); assert.equal(disposedGeometry, geometries.size);
    assert.equal(simulation.exportSave(), saved);
  } finally { pool.dispose(); if (prior) Object.defineProperty(globalThis, 'document', prior); else Reflect.deleteProperty(globalThis, 'document'); }
});

test('food display refuses a suspended operating title even when a stale open flag is true', () => {
  const scene = new THREE.Scene(), pool = new MarketGoodsPool(scene, world), state = view(), displayed = state.shops.find(row => row.id === shop.id)!;
  try {
    displayed.open = true; displayed.inventory = 8; pool.update(state, market.door, new Set([market.id])); assert.equal(pool.mesh.count, 8);
    state.shopLifecycle!.titles[shop.id].state = 'suspended'; pool.update(state, market.door, new Set([market.id])); assert.equal(pool.mesh.count, 0);
  } finally { pool.dispose(); }
});

test('actual program office ceiling survives interior visibility while the canonical stair opening remains open', () => {
  const bank = world.buildings.find(site => site.commercialGeometryRevision === 1)!, body = getBuildingBody(bank)!;
  const renderer = Object.create(CityRenderer.prototype) as any;
  renderer.world = { ...world, buildings: [bank] }; renderer.scene = new THREE.Scene(); renderer.chunks = []; renderer.interiors = new Map(); renderer.distantRefs = new Map(); renderer.insideId = null; renderer.insideFloor = 0;
  renderer.materials = Object.fromEntries(['wall', 'wood', 'stone', 'roof', 'glass', 'cyan', 'amber', 'red', 'metal'].map(key => [key, new THREE.MeshStandardMaterial()]));
  renderer.buildCity();
  try {
    renderer.nearChunks.update(bank.door, { quality: 'balanced', insideBuildingId: bank.id }); renderer.setInterior(bank.id, 2); renderer.scene.updateMatrixWorld(true);
    const point = getBuildingUsePoints(bank, 2).find(point => point.purpose === 'work')!.position;
    const ray = new THREE.Raycaster(new THREE.Vector3(point.x, point.y + 1.72, point.z), new THREE.Vector3(0, 1, 0), 0, 5);
    const hit = ray.intersectObject(renderer.scene, true)[0]; assert.ok(hit, 'the actual overhead slab must close the office room');
    const current = body.floorPlans.find(plan => plan.floor === 2)!, next = body.floorPlans.find(plan => plan.floor === 3)!;
    assert.ok(Math.abs(hit.point.y - (bank.position.y + .6 + next.y - .2)) < 1e-5);
    const hole = next.stairHole!, stair = buildingWorldPosition(bank, { x: (hole.x0 + hole.x1) / 2, y: current.y + 1.72, z: (hole.z0 + hole.z1) / 2 });
    ray.set(new THREE.Vector3(stair.x, stair.y, stair.z), new THREE.Vector3(0, 1, 0));
    assert.equal(ray.intersectObject(renderer.scene, true).filter(hit => Math.abs(hit.point.y - (bank.position.y + .6 + next.y - .2)) < 1e-5).length, 0, 'retaining a real slab must preserve the actual stair void');
    let ceiling = 0, hidden = 0;
    for (const reference of renderer.interiors.get(bank.id)) { const actual = new THREE.Matrix4(); reference.mesh.getMatrixAt(reference.index, actual); if (reference.ceiling && reference.floor === 3 && !reference.roof) { assert.notEqual(actual.elements[0], 0); ceiling++; } else if (reference.floor > 2) { assert.equal(actual.elements[0], 0); hidden++; } }
    assert.ok(ceiling > 0 && hidden > 0);
    renderer.setInterior(null); for (const reference of renderer.interiors.get(bank.id)) { const actual = new THREE.Matrix4(); reference.mesh.getMatrixAt(reference.index, actual); actual.elements.forEach((value, index) => assert.ok(Math.abs(value - reference.matrix.elements[index]) < .0001)); }
  } finally { renderer.nearChunks.dispose(); renderer.scene.traverse((object: THREE.Object3D) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); if (object instanceof THREE.InstancedMesh) object.dispose(); } }); Object.values(renderer.materials).forEach((material: any) => material.dispose()); }
});
