import type { Building, SimState } from '../src/types';

type Commodity = 'food' | 'materials' | 'unknown';
interface ObservedEvent { shopId?: string; citizenId?: string; siteId?: string; amount?: number; quantity?: number; minutes?: number; ratePerMinute?: number; creditedWorkStartAt?: number; creditedWorkEndAt?: number }
const emptyFlow = () => ({ producedUnits: 0, productionMinutes: 0, retailUnits: 0, retailGross: 0, counterMeals: 0, unattributedRetailUnits: 0 });
type AttendanceKind = 'farm' | 'dock' | 'workshop' | 'market' | 'other' | 'unknown';
const emptyAttendance = () => ({ fundedAttendanceMinutes: 0, earnedGross: 0, namedEvents: 0, eventsWithActualWindow: 0 });

/** Event observations never infer meals from money or count industrial stock as food. */
export function commodityObserver(buildings: ReadonlyMap<string, Pick<Building, 'kind'>>, shopBuildings: ReadonlyMap<string, string>, isActualNpcWage: (event: object) => boolean = () => false) {
  const flows = { food: emptyFlow(), materials: emptyFlow(), unknown: emptyFlow() };
  const attendance = { farm: emptyAttendance(), dock: emptyAttendance(), workshop: emptyAttendance(), market: emptyAttendance(), other: emptyAttendance(), unknown: emptyAttendance() };
  const namedAttendance = new Map<string, { citizenId: string; shopId: string; siteId: string | null; siteKind: AttendanceKind; fundedAttendanceMinutes: number; earnedGross: number; namedEvents: number; eventsWithActualWindow: number }>();
  let unclassifiedWageEvents = 0;
  let storedMeals = 0, playerConsumedMeals = 0;
  const commodity = (shopId: string | undefined): Commodity => {
    const id = shopId && shopBuildings.get(shopId), building = id && buildings.get(id);
    if (!building) return 'unknown';
    return building.kind === 'workshop' ? 'materials' : ['market', 'farm', 'dock'].includes(building.kind) ? 'food' : 'unknown';
  };
  return {
    /** Canonical wage-earned minutes are funded onsite attendance, including
     * legal work while stock is already above the production target. They are
     * earned claims, not cash payments or consumed production-batch minutes. */
    wageEarned(event: ObservedEvent) {
      const minutes = event.minutes, gross = event.amount;
      if (!isActualNpcWage(event) || !event.shopId || !event.citizenId || !Number.isFinite(minutes) || !(minutes! > 0) || !Number.isFinite(gross) || !(gross! > 0)) { unclassifiedWageEvents++; return; }
      const siteId = shopBuildings.get(event.shopId), kind = siteId && buildings.get(siteId)?.kind;
      const siteKind: AttendanceKind = !kind ? 'unknown' : ['farm', 'dock', 'workshop', 'market'].includes(kind) ? kind as AttendanceKind : 'other';
      const actualWindow = event.siteId === siteId && Number.isFinite(event.creditedWorkStartAt) && Number.isFinite(event.creditedWorkEndAt)
        && event.creditedWorkEndAt! > event.creditedWorkStartAt!
        && Math.abs(event.creditedWorkEndAt! - event.creditedWorkStartAt! - minutes!) <= 1e-7;
      const flow = attendance[siteKind]; flow.fundedAttendanceMinutes += minutes!; flow.earnedGross += gross!; flow.namedEvents++; if (actualWindow) flow.eventsWithActualWindow++;
      const key = JSON.stringify([event.citizenId, event.shopId, siteId ?? null]);
      const named = namedAttendance.get(key) ?? { citizenId: event.citizenId, shopId: event.shopId, siteId: siteId ?? null, siteKind, ...emptyAttendance() };
      named.fundedAttendanceMinutes += minutes!; named.earnedGross += gross!; named.namedEvents++; if (actualWindow) named.eventsWithActualWindow++;
      namedAttendance.set(key, named);
    },
    production(event: ObservedEvent) { const flow = flows[commodity(event.shopId)]; flow.producedUnits += event.amount ?? 0; flow.productionMinutes += event.minutes ?? 0; },
    sale(event: ObservedEvent) {
      const kind = commodity(event.shopId), flow = flows[kind];
      flow.retailUnits += event.quantity ?? 0; flow.retailGross += event.amount ?? 0;
      // The core NPC counter-sale consumes one meal and carries the remaining
      // purchased units. Other sale emitters do not identify immediate eating.
      if (kind === 'food' && event.citizenId && event.citizenId !== 'player') flow.counterMeals++;
      else flow.unattributedRetailUnits += event.quantity ?? 0;
    },
    storedMeal(event: ObservedEvent) { storedMeals += event.amount ?? 0; },
    foodConsumed(event: ObservedEvent) { if (event.citizenId === 'player') playerConsumedMeals += event.amount ?? 0; },
    snapshot() { return { flows: structuredClone(flows), attendanceBySiteKind: structuredClone(attendance), namedAttendance: structuredClone([...namedAttendance.values()]), unclassifiedWageEvents,
      storedMeals, playerConsumedMeals, observedNpcMeals: flows.food.counterMeals + storedMeals,
      attendanceScope: 'Native core-certified named NPC wage-earned events with positive finite minutes and gross, classified by actual shop building kind. These are funded onsite earned minutes, not paid cash, production labor consumed, or a classification of every zero-output batch. Uncertified events, legacy amount-only and public wage events are excluded from private-site attendance; player employment is a separate contract.',
      zeroOutputBatchDisposition: 'NOT_OBSERVED',
      scope: 'Observed positive production and retail events by actual site kind; productionMinutes remain minutes attached to positive output batches, not all attendance. Counter meals require named NPC sale events. Unattributed sales are not assumed eaten; this is not a complete inventory mass balance.' }; },
  };
}

/** Pure parameter-driven diagnosis. An affordable offer is not proof of a legal route. */
export function foodSnapshot(state: SimState, buildings: ReadonlyMap<string, Pick<Building, 'kind'>>) {
  const foodSites = state.shops.filter(shop => ['market', 'farm', 'dock'].includes(buildings.get(shop.buildingId)?.kind ?? ''));
  const stockedOpen = foodSites.filter(shop => shop.open && shop.inventory >= 1);
  const alive = state.citizens.filter(actor => state.extension?.actorProfiles[actor.id]?.alive !== false);
  const hungryWithoutCarriedFood = alive.filter(actor => actor.needs.hunger < 30 && (actor.food ?? 0) < 1);
  return {
    aliveResidents: alive.length,
    nominalResidentMealsPerDay: alive.length * .05 * 1440 / 52,
    nominalDemandScope: 'Current NPC hunger decay .05 per game minute divided by one meal recovery 52; theoretical daily demand, not measured consumption or a sustainability verdict.',
    shopFoodUnits: foodSites.reduce((sum, shop) => sum + shop.inventory, 0),
    residentCarriedFoodUnits: state.citizens.reduce((sum, actor) => sum + (actor.food ?? 0), 0),
    playerCarriedFoodUnits: state.player.inventory.food ?? 0,
    bySiteKind: Object.fromEntries(['farm', 'dock', 'market', 'workshop'].map(kind => {
      const sites = state.shops.filter(shop => buildings.get(shop.buildingId)?.kind === kind);
      return [kind, { sites: sites.length, open: sites.filter(shop => shop.open).length, inventoryUnits: sites.reduce((sum, shop) => sum + shop.inventory, 0), employees: sites.reduce((sum, shop) => sum + shop.employees, 0) }];
    })),
    hungryWithoutCarriedFood: hungryWithoutCarriedFood.length,
    hungryCanAffordAnyStockedOpenFoodOffer: hungryWithoutCarriedFood.filter(actor => stockedOpen.some(shop => actor.money >= shop.price)).length,
    routeReachability: 'NOT_OBSERVED',
    inventoryScope: 'Shop inventories and personal carried food only; excludes freight custody, ingredients, dishes and separate company stores. Consignment lots are ownership records already included in shop inventory and are not counted twice.',
  };
}
