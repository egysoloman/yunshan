import * as THREE from 'three';
import { buildingWorldPosition, getBuildingFloorPlan, wallPanels, type Rect } from '../architecture-floor-plan';
import { shopLifecycleAllowsOperation } from '../simulation/shop_lifecycle';
import type { Building, Shop, SimState, Vec3, WorldDefinition } from '../types';

export interface MarketShopfrontBoard {
  position: Vec3; width: number; height: number; rotation: number; style: 'name' | 'notice';
  /** The complete opaque host, in building-local coordinates. The image is a
   * surface finish on this existing solid, not a new free-standing obstacle. */
  host: { rect: Rect; bottom: number; top: number };
}
export interface MarketShopfrontDescription { name: string; status: string; operator: string; stock: string; listing: string; signature: string }

/** Only the authoritative existing-business title is displayed. A lease of an
 * operating asset is never described as ownership of the building or land. */
export function describeMarketShopfront(state: SimState, shop: Shop, building: Building): MarketShopfrontDescription {
  const title = state.shopLifecycle?.titles[shop.id];
  const now = state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
  const lease = state.shopLifecycle?.leases.find(row => row.shopId === shop.id && row.state !== 'ended');
  const company = state.extension?.companies.find(row => row.buildingId === building.id && row.shopBindingReleasedAt === undefined);
  const allowed = shopLifecycleAllowsOperation(state, shop.id);
  const status = !allowed ? title?.state === 'reopening' ? '整修中' : title?.state === 'suspended' ? '停业' : '租约受限'
    : !shop.open ? shop.profit < -600 ? '停业' : '休市' : shop.inventory < 1 ? '售罄' : '营业中';
  // Company share ownership is distinct from the actual operating-asset lease.
  const actorId = lease?.state === 'active' && now < lease.endsAt ? lease.tenantId : company?.ownerId ?? shop.ownerId;
  const actorName = actorId === 'player' ? '你' : state.citizens.find(row => row.id === actorId)?.name;
  const operator = actorName ? `${lease?.state === 'active' && now < lease.endsAt ? '承租经营' : '经营'}：${actorName}` : '经营人未登记';
  const offer = state.shopLifecycle?.listings.find(row => row.id === title?.listingId && row.state === 'offered' && now < row.expiresAt);
  const listing = offer ? offer.kind === 'lease' ? '经营权招租' : '出售经营资产' : '';
  const name = company?.name ?? building.name.split('·').at(-1) ?? building.name;
  const stock = `食材 ${Math.max(0, Math.floor(shop.inventory))}份 · ${shop.price.toFixed(1)}文`;
  const signature = JSON.stringify([name, status, operator, stock, listing]);
  return { name, status, operator, stock, listing, signature };
}

/** Small name boards finish the intact lintel, and notices finish actual opaque
 * wall panels. Every opening/window remains an opening/window in the image. */
export function marketShopfrontBoards(building: Building): MarketShopfrontBoard[] {
  if (building.kind !== 'market') return [];
  const plan = getBuildingFloorPlan(building, 0); if (!plan) return [];
  const boards: MarketShopfrontBoard[] = [];
  for (const wall of plan.walls.filter(wall => wall.opening && wall.a[0] > wall.b[0] && wall.a[1] === wall.b[1]).sort((a, b) => b.a[1] - a.a[1]).slice(0, 4)) {
    const opening = wall.opening!, gap = wall.height - opening.height;
    if (gap < .2 - 1e-7) continue;
    const width = Math.min(4, opening.to - opening.from - .4), height = Math.min(.4, gap);
    const x = wall.a[0] - (opening.from + opening.to) / 2;
    const host = { rect: { x0: wall.a[0] - opening.to, x1: wall.a[0] - opening.from, z0: wall.a[1] - wall.thickness / 2, z1: wall.a[1] + wall.thickness / 2 }, bottom: plan.y + opening.height, top: plan.y + wall.height };
    const position = buildingWorldPosition(building, { x, y: (host.bottom + host.top) / 2, z: host.rect.z1 + .003 });
    boards.push({ position, width, height, rotation: building.rotation, style: 'name', host });
  }
  const panels = wallPanels(plan).filter(panel => panel.kind === 'solid' && panel.rect.x1 - panel.rect.x0 >= 1.6 && panel.rect.z1 - panel.rect.z0 <= .4 + 1e-7 && panel.top - panel.bottom >= 1.2
    && plan.walls.some(wall => wall.a[0] > wall.b[0] && wall.a[1] === wall.b[1] && Math.abs((panel.rect.z0 + panel.rect.z1) / 2 - wall.a[1]) < 1e-7))
    .sort((a, b) => b.rect.z1 - a.rect.z1 || b.rect.x1 - b.rect.x0 - (a.rect.x1 - a.rect.x0));
  for (const panel of panels) {
    const x = (panel.rect.x0 + panel.rect.x1) / 2, z = panel.rect.z1;
    if (boards.some(board => board.style === 'notice' && Math.hypot(board.position.x - buildingWorldPosition(building, { x, y: 0, z }).x, board.position.z - buildingWorldPosition(building, { x, y: 0, z }).z) < 6)) continue;
    const width = Math.min(2.8, panel.rect.x1 - panel.rect.x0 - .4), height = Math.min(1.6, panel.top - panel.bottom - .2);
    const host = { rect: panel.rect, bottom: plan.y + panel.bottom, top: plan.y + panel.top };
    boards.push({ position: buildingWorldPosition(building, { x, y: (host.bottom + host.top) / 2, z: z + .003 }), width, height, rotation: building.rotation, style: 'notice', host });
    if (boards.filter(board => board.style === 'notice').length === 3) break;
  }
  return boards;
}

interface Entry { group: THREE.Group; signature: string; canvases: Map<MarketShopfrontBoard['style'], { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; material: THREE.MeshStandardMaterial }> }
/** Lazy, bounded surface artwork. One texture per style per resident market is
 * reused across its boards and repainted only when displayed data changes. */
export class MarketShopfrontPool {
  readonly group = new THREE.Group();
  private readonly sites = new Map<string, { building: Building; boards: MarketShopfrontBoard[] }>();
  private readonly entries = new Map<string, Entry>();
  private disposed = false;
  private paints = 0;
  constructor(parent: THREE.Scene | THREE.Group, world: WorldDefinition) {
    this.group.name = '市集 · 真实经营与招租牌'; parent.add(this.group);
    for (const building of world.buildings) { const boards = marketShopfrontBoards(building); if (boards.length) this.sites.set(building.id, { building, boards }); }
  }
  update(state: SimState, camera: Vec3, residentBuildingIds: ReadonlySet<string>, limit = 8): void {
    if (this.disposed || typeof document === 'undefined') return;
    const selected = [...this.sites].filter(([id, site]) => residentBuildingIds.has(id) && Math.hypot(camera.x - site.building.position.x, camera.z - site.building.position.z) <= 110)
      .sort((a, b) => Math.hypot(camera.x - a[1].building.position.x, camera.z - a[1].building.position.z) - Math.hypot(camera.x - b[1].building.position.x, camera.z - b[1].building.position.z)).slice(0, Math.min(8, Math.max(0, Math.floor(limit))));
    const desired = new Set(selected.map(([id]) => id));
    for (const id of this.entries.keys()) if (!desired.has(id)) this.release(id);
    for (const [id, site] of selected) {
      const shop = state.shops.find(row => row.buildingId === id); if (!shop) { this.release(id); continue; }
      const description = describeMarketShopfront(state, shop, site.building);
      let entry = this.entries.get(id); if (!entry) { entry = this.create(site.boards); this.entries.set(id, entry); this.group.add(entry.group); }
      if (entry.signature !== description.signature) {
        for (const [style, resource] of entry.canvases) this.paint(resource.canvas, description, style);
        for (const resource of entry.canvases.values()) resource.texture.needsUpdate = true;
        entry.signature = description.signature; this.paints++;
      }
    }
    this.group.userData.budget = { markets: this.entries.size, maxMarkets: 8, textures: [...this.entries.values()].reduce((n, entry) => n + entry.canvases.size, 0), paints: this.paints };
  }
  private create(boards: MarketShopfrontBoard[]): Entry {
    const entry: Entry = { group: new THREE.Group(), signature: '', canvases: new Map() };
    for (const board of boards) {
      let resource = entry.canvases.get(board.style);
      if (!resource) {
        const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = board.style === 'name' ? 96 : 448;
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        resource = { canvas, texture, material: new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }) }; entry.canvases.set(board.style, resource);
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(board.width, board.height), resource.material); mesh.name = `商店${board.style === 'name' ? '檐下名牌' : '经营告示'}`;
      mesh.position.set(board.position.x, board.position.y, board.position.z); mesh.rotation.y = board.rotation; entry.group.add(mesh);
    }
    return entry;
  }
  private paint(canvas: HTMLCanvasElement, view: MarketShopfrontDescription, style: MarketShopfrontBoard['style']): void {
    const context = canvas.getContext('2d'); if (!context) return;
    const { width, height } = canvas;
    context.fillStyle = style === 'name' ? '#493529' : '#dfd0a7'; context.fillRect(0, 0, width, height);
    context.strokeStyle = style === 'name' ? '#c1a66c' : '#6b5038'; context.lineWidth = 6; context.strokeRect(10, 10, width - 20, height - 20);
    context.textAlign = 'center'; context.textBaseline = 'middle';
    if (style === 'name') {
      context.fillStyle = '#e8d9ac'; context.font = '600 54px "Noto Serif CJK SC", serif'; context.fillText(view.name, width / 2, height / 2, width - 72); return;
    }
    context.fillStyle = '#523b2b'; context.font = '600 60px "Noto Serif CJK SC", serif'; context.fillText(view.name, width / 2, 64, width - 72);
    context.fillStyle = view.status === '营业中' ? '#4d6652' : '#8b4637'; context.font = '600 56px "Noto Serif CJK SC", serif'; context.fillText(view.status, width / 2, 140, width - 72);
    context.fillStyle = '#493b2d'; context.font = '500 40px "Noto Sans CJK SC", sans-serif'; context.fillText(view.stock, width / 2, 218, width - 72);
    context.font = '500 38px "Noto Sans CJK SC", sans-serif'; context.fillText(view.operator, width / 2, 290, width - 72);
    context.fillStyle = '#8b4637'; context.font = '500 38px "Noto Serif CJK SC", serif'; context.fillText(view.listing || '食材买卖 · 市井生活', width / 2, 374, width - 72);
  }
  private release(id: string): void {
    const entry = this.entries.get(id); if (!entry) return;
    entry.group.removeFromParent(); entry.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    for (const resource of entry.canvases.values()) { resource.texture.dispose(); resource.material.dispose(); }
    entry.group.clear(); this.entries.delete(id);
  }
  dispose(): void { if (this.disposed) return; for (const id of this.entries.keys()) this.release(id); this.group.removeFromParent(); this.group.clear(); this.disposed = true; }
}
