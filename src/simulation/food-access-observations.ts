import type { Building, Citizen, District, LifeProfile, Needs, NetworkNode, Shop, Vec3 } from '../types';

type FoodKind = 'farm' | 'dock' | 'market';
type ObservedCitizen = Pick<Citizen, 'id' | 'name' | 'districtId' | 'position' | 'state' | 'destinationId' | 'money' | 'needs' | 'food' | 'route' | 'routeIndex'>;
type ObservedShop = Pick<Shop, 'id' | 'buildingId' | 'districtId' | 'inventory' | 'price' | 'open'>;
export interface FoodAccessState {
  day: number; hour: number; weather: string;
  citizens: readonly ObservedCitizen[]; shops: readonly ObservedShop[];
  extension?: { lastUpdate: number; actorProfiles: Readonly<Record<string, Pick<LifeProfile, 'alive'>>> };
}
export interface FoodAccessWorld {
  districts: readonly Pick<District, 'id' | 'name'>[];
  buildings: readonly Pick<Building, 'id' | 'kind' | 'districtId'>[];
  nodes: readonly Pick<NetworkNode, 'id' | 'position'>[];
}
export interface FoodAccessRuntime {
  activities?: Readonly<Record<string, string>>;
  decisionAt?: Readonly<Record<string, number>>;
  riders?: Readonly<Record<string, { vehicleId: string; stopNodeId: string; arrived?: boolean; arrivedAt?: number }>>;
  customers?: Readonly<Record<string, string>>;
}

const FOOD_KINDS: readonly FoodKind[] = ['farm', 'dock', 'market'];
const finite = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Food access observation requires finite ${label}`);
  return value;
};
const point = (value: Vec3, label: string): Vec3 => {
  if (!value || typeof value !== 'object') throw new Error(`Food access observation requires ${label} coordinates`);
  return { x: finite(value.x, `${label}.x`), y: finite(value.y, `${label}.y`), z: finite(value.z, `${label}.z`) };
};
const needs = (value: Needs, label: string): Needs => {
  if (!value || typeof value !== 'object') throw new Error(`Food access observation requires ${label}`);
  return { hunger: finite(value.hunger, `${label}.hunger`), fatigue: finite(value.fatigue, `${label}.fatigue`), social: finite(value.social, `${label}.social`), fun: finite(value.fun, `${label}.fun`) };
};
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const countBy = (rows: readonly { state: string }[]) => {
  const result: Record<string, number> = Object.create(null);
  for (const row of rows) result[row.state] = (result[row.state] ?? 0) + 1;
  return result;
};

/** A pure current-state observation. Finite fields used here are checked; this
 * does not validate a complete save or execute a future people/traffic phase. */
export function observeFoodAccess(state: FoodAccessState, world: FoodAccessWorld, runtime: FoodAccessRuntime) {
  const day = finite(state.day, 'day'), hour = finite(state.hour, 'hour');
  const displayClock = finite(day * 1440 + hour * 60, 'display clock');
  const clock = finite(state.extension?.lastUpdate ?? displayClock, 'observation clock');
  const buildings = new Map(world.buildings.map(building => [building.id, building]));
  const nodes = new Map(world.nodes.map(node => [node.id, node]));
  const unresolvedShopBuildingReferences: { shopId: string; buildingId: string; shopDistrictId: string }[] = [];
  const shopBuildingDistrictMismatches: { shopId: string; buildingId: string; shopDistrictId: string; buildingDistrictId: string; buildingKind: Building['kind'] }[] = [];
  const foodSites = state.shops.flatMap(shop => {
    const building = buildings.get(shop.buildingId);
    if (!building) {
      unresolvedShopBuildingReferences.push({ shopId: shop.id, buildingId: shop.buildingId, shopDistrictId: shop.districtId });
      return [];
    }
    if (shop.districtId !== building.districtId) shopBuildingDistrictMismatches.push({
      shopId: shop.id, buildingId: shop.buildingId, shopDistrictId: shop.districtId,
      buildingDistrictId: building.districtId, buildingKind: building.kind,
    });
    if (!FOOD_KINDS.includes(building.kind as FoodKind)) return [];
    const inventory = finite(shop.inventory, `shop ${shop.id} inventory`), price = finite(shop.price, `shop ${shop.id} price`);
    const kind = building.kind as FoodKind, closesAtHour = kind === 'market' ? 22 : 20;
    return [{ id: shop.id, buildingId: shop.buildingId, districtId: shop.districtId, kind, open: shop.open, inventory, price,
      openStocked: shop.open && inventory >= 1, opensAtHour: 6, closesAtHour,
      scheduledOpenAtCurrentPhase: hour >= 6 && hour < closesAtHour }];
  });
  const sitesByBuilding = new Map(foodSites.map(shop => [shop.buildingId, shop]));
  const openStocked = foodSites.filter(shop => shop.openStocked);
  const checkedCitizens = state.citizens.map(actor => {
    const observedNeeds = needs(actor.needs, `actor ${actor.id} needs`);
    const money = finite(actor.money, `actor ${actor.id} money`), food = finite(actor.food ?? 0, `actor ${actor.id} carried food`);
    // This is exactly foodSnapshot's eligibility predicate, including missing
    // profiles and missing carried food; affordability alone proves no path.
    const alive = state.extension?.actorProfiles[actor.id]?.alive !== false;
    return { actor, needs: observedNeeds, money, food, alive, hungry: alive && observedNeeds.hunger < 30 && food < 1 };
  });
  const alive = checkedCitizens.filter(row => row.alive);
  const hungry = checkedCitizens.filter(row => row.hungry);
  const weatherWalkingSpeed = state.weather === '雨' ? 3.1 : 4.2;
  const hungryActors = hungry.map(({ actor, needs: observedNeeds, money, food }) => {
    const route = actor.route ?? [], routeIndex = finite(actor.routeIndex ?? 0, `actor ${actor.id} route index`);
    if (!Number.isSafeInteger(routeIndex) || routeIndex < 0 || routeIndex > route.length) throw new Error(`Food access observation requires valid actor ${actor.id} route index`);
    const remainingRoute3D = [point(actor.position, `actor ${actor.id} position`), ...route.slice(routeIndex).map((p, index) => point(p, `actor ${actor.id} route[${routeIndex + index}]`))];
    const remainingDistance3D = finite(remainingRoute3D.slice(1).reduce((sum, p, index) => sum + distance(remainingRoute3D[index], p), 0), `actor ${actor.id} remaining route distance`);
    const riding = runtime.riders?.[actor.id], stop = riding ? nodes.get(riding.stopNodeId) : undefined;
    const rider = riding ? {
      vehicleId: riding.vehicleId, stopNodeId: riding.stopNodeId,
      stopPosition: stop ? point(stop.position, `rider ${actor.id} named stop`) : null,
      stopObservation: stop ? 'NAMED_STOP_FOUND' as const : 'NAMED_STOP_NOT_FOUND' as const,
      arrived: riding.arrived === true,
      arrivedAt: riding.arrivedAt === undefined ? null : finite(riding.arrivedAt, `rider ${actor.id} arrivedAt`),
    } : null;
    const moving = actor.state === 'moving';
    const walkingReference = rider || !moving ? {
      status: 'NOT_ESTIMATED' as const, reason: rider ? 'RIDER' as const : 'STATE_NOT_MOVING' as const, minutes: null,
    } : { status: 'REFERENCE_ESTIMATED' as const, reason: 'CURRENT_REMAINING_ROUTE_AT_CURRENT_WEATHER' as const,
      minutes: finite(remainingDistance3D / weatherWalkingSpeed, `actor ${actor.id} walking reference minutes`) };
    const destinationFoodShop = actor.destinationId ? sitesByBuilding.get(actor.destinationId) ?? null : null;
    const customerShopId = runtime.customers?.[actor.id] ?? null;
    const decisionAt = runtime.decisionAt?.[actor.id];
    const decision = decisionAt === undefined ? { at: null, status: 'NO_SAVED_DEADLINE' as const } : {
      at: finite(decisionAt, `actor ${actor.id} decisionAt`),
      status: clock + 1e-7 >= decisionAt ? 'DUE_REQUIRES_FUTURE_PEOPLE_PROCESSING' as const : 'NOT_DUE' as const,
    };
    const estimatedArrivalPhaseMinute = walkingReference.minutes === null ? null
      : finite(hour * 60 + walkingReference.minutes, `actor ${actor.id} arrival phase minute`);
    const openingReference = destinationFoodShop ? {
      opensAtHour: destinationFoodShop.opensAtHour, closesAtHour: destinationFoodShop.closesAtHour,
      scheduledOpenAtCurrentPhase: destinationFoodShop.scheduledOpenAtCurrentPhase,
      observedOpen: destinationFoodShop.open, estimatedArrivalPhaseMinute,
      estimatedArrivalBeforeClosing: estimatedArrivalPhaseMinute === null ? null : estimatedArrivalPhaseMinute < destinationFoodShop.closesAtHour * 60,
      estimatedArrivalWithinScheduledOpening: estimatedArrivalPhaseMinute === null ? null
        : estimatedArrivalPhaseMinute >= 6 * 60 && estimatedArrivalPhaseMinute < destinationFoodShop.closesAtHour * 60,
    } : null;
    const affordableOpenStockedFoodOfferIds = openStocked.filter(shop => money >= shop.price).map(shop => shop.id);
    return {
      id: actor.id, name: actor.name, districtId: actor.districtId, alive: true,
      needs: observedNeeds, money, food, state: actor.state, activity: runtime.activities?.[actor.id] ?? null,
      destinationId: actor.destinationId, stateShopping: actor.state === 'shopping', decision,
      destinationFoodShop: destinationFoodShop ? { ...destinationFoodShop, canAffordOneUnit: money >= destinationFoodShop.price } : null,
      queueObservation: { customerShopId, matchesCurrentDestination: !!destinationFoodShop && customerShopId === destinationFoodShop.id },
      canAffordAnyStockedOpenFoodOffer: affordableOpenStockedFoodOfferIds.length > 0, affordableOpenStockedFoodOfferIds,
      route: { routeIndex, remainingRoute3D, remainingDistance3D, weatherWalkingSpeed, walkingReference, rider }, openingReference,
    };
  });
  const districtIds = [...new Set([...world.districts.map(district => district.id), ...state.shops.map(shop => shop.districtId),
    ...shopBuildingDistrictMismatches.map(reference => reference.buildingDistrictId), ...state.citizens.map(actor => actor.districtId)])];
  const districts = districtIds.map(districtId => {
    const localSites = foodSites.filter(shop => shop.districtId === districtId), localAlive = alive.filter(row => row.actor.districtId === districtId);
    const localHungry = hungryActors.filter(actor => actor.districtId === districtId);
    const unresolved = unresolvedShopBuildingReferences.filter(reference => reference.shopDistrictId === districtId);
    const mismatches = shopBuildingDistrictMismatches.filter(reference => reference.shopDistrictId === districtId || reference.buildingDistrictId === districtId);
    const integrity = unresolved.length ? 'INCOMPLETE_SHOP_BUILDING_REFERENCES' as const
      : mismatches.length ? 'INCONSISTENT_SHOP_BUILDING_DISTRICTS' as const : 'KNOWN_CONSISTENT_SHOP_BUILDING_REFERENCES' as const;
    const foodFacilityAssessment = unresolved.length ? 'INCOMPLETE_SHOP_BUILDING_REFERENCES' as const
      : mismatches.length ? 'INCONSISTENT_SHOP_BUILDING_DISTRICTS' as const
        : localSites.length ? 'KNOWN_FOOD_SHOPS_OBSERVED' as const : 'NO_FOOD_SHOPS_OBSERVED' as const;
    return { districtId, name: world.districts.find(district => district.id === districtId)?.name ?? null,
      integrity, foodFacilityAssessment,
      unresolvedShopBuildingReferenceCount: unresolved.length, shopBuildingDistrictMismatchCount: mismatches.length,
      foodShopCount: localSites.length, farmCount: localSites.filter(shop => shop.kind === 'farm').length,
      dockCount: localSites.filter(shop => shop.kind === 'dock').length, marketCount: localSites.filter(shop => shop.kind === 'market').length,
      openStockedFoodOfferCount: localSites.filter(shop => shop.openStocked).length,
      aliveResidents: localAlive.length, hungryWithoutCarriedFood: localHungry.length,
      hungerZeroAliveResidents: localAlive.filter(row => row.needs.hunger === 0).length,
      hungryCanAffordAnyStockedOpenFoodOffer: localHungry.filter(actor => actor.canAffordAnyStockedOpenFoodOffer).length,
    };
  });
  return {
    scope: 'Pure current JSON observation of food offers, named hungry residents, saved decisions, customer queue and remaining 3D route. It does not advance actors or certify a journey, counter receipt or legal reachability.',
    inputValidationScope: 'Finite needs, cash and carried food for population eligibility; finite food offer inventory/price and clocks; finite diagnosed actor positions, remaining route coordinates/index, deadline and named rider stop fields. This is not complete save validation.',
    walkingReferenceScope: 'Only a non-rider in state moving gets remaining 3D route length divided by current weather speed (晴/other 4.2, 雨 3.1). Same displayed-day opening reference excludes future weather, traffic, replanning, ACL, body collision, queue and inventory changes. It is not an observed arrival.',
    decisionScope: 'A due saved deadline requires actual future people-phase processing; this observer never calls chooseFacility or predicts its choice.',
    queueScope: 'Saved runtime customer requests are queue observations, not settled purchases or meals.',
    foodOfferDistrictSource: 'saved shop.districtId' as const,
    unresolvedShopBuildingReferences, shopBuildingDistrictMismatches,
    referenceIntegrity: {
      status: unresolvedShopBuildingReferences.length ? 'INCOMPLETE_SHOP_BUILDING_REFERENCES' as const
        : shopBuildingDistrictMismatches.length ? 'INCONSISTENT_SHOP_BUILDING_DISTRICTS' as const : 'KNOWN_CONSISTENT_SHOP_BUILDING_REFERENCES' as const,
      unresolvedShopBuildingReferenceCount: unresolvedShopBuildingReferences.length,
      shopBuildingDistrictMismatchCount: shopBuildingDistrictMismatches.length,
      scope: 'Food shop counts include only resolved food kinds and retain saved shop district bucketing. An unresolved building reference or inconsistent shop/building districts makes affected district assessment incomplete or inconsistent; such counts cannot certify absence of food shops. This observer does not repair references, infer unknown kinds or reassign districts.',
    },
    routeReachability: 'NOT_OBSERVED' as const,
    clock: { simulationMinutes: clock, displayMinutes: displayClock, day, hour, source: state.extension ? 'extension.lastUpdate' as const : 'day/hour' as const },
    aliveResidents: alive.length, hungryWithoutCarriedFood: hungryActors.length,
    hungerZeroAliveResidents: alive.filter(row => row.needs.hunger === 0).length,
    hungryHungerZero: hungryActors.filter(actor => actor.needs.hunger === 0).length,
    hungryCanAffordAnyStockedOpenFoodOffer: hungryActors.filter(actor => actor.canAffordAnyStockedOpenFoodOffer).length,
    hungryStates: countBy(hungryActors), foodSites, districts, hungryActors,
  };
}
