import type { Simulation } from '../src/simulation';
import type { Shop } from '../src/types';
import { tradeSignals } from '../src/simulation/trade';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Read-only diagnostics: event listeners never alter actors, money, RNG,
 * routing, employment, inventories, approvals or the simulation clock. */
export function observeFoodMaterial(sim: Simulation) {
  const world = sim.worldDefinition, sites = new Map(world.buildings.map(b => [b.id, b]));
  const shops = new Map(sim.state.shops.map(shop => [shop.id, shop]));
  const core = () => Reflect.get(sim, 'runtime');
  const clock = () => sim.state.extension!.lastUpdate;
  const kinds = ['farm', 'dock', 'workshop', 'market'];
  const metrics = Object.fromEntries(kinds.map(kind => [kind, { production: 0, productionMinutes: 0, earnedLabor: 0, actualLaborMinutes: 0, paidWages: 0, publicPurchasedUnits: 0, publicPurchasedGross: 0, wholesaleUnits: 0, wholesaleGross: 0, consumerUnits: 0, consumers: 0, consumerGross: 0, utilityCashPaid: 0, authorizedLaborMinutes: 0, authorizedLaborGross: 0 }]));
  const kindRow = (id: string | undefined) => id && shops.has(id) ? metrics[sites.get(shops.get(id)!.buildingId)!.kind] : undefined;
  const value = (e: any, key: string) => e[key] ?? 0;
  let storedConsumed = 0, immediateFoodConsumed = 0;
  const freightEvents: any[] = [];
  const initialVehicleCargo = sim.state.vehicles.reduce((sum,vehicle)=>sum+vehicle.cargo,0);
  let loadedUnits=0, unloadedUnits=0;
  sim.onEvent('cargo-loaded', event=>{
    loadedUnits+=event.amount??0; const vehicle=sim.state.vehicles.find(v=>v.id===event.vehicleId)!;
    const passengers=Math.max(vehicle.passengers,Object.values(core().riders as Record<string,any>).filter(r=>r.vehicleId===vehicle.id&&!r.arrived).length+(sim.state.player.vehicleId===vehicle.id?1:0));
    const source=shops.get(event.shopId!)!, site=sites.get(source.buildingId)!;
    freightEvents.push({tick:sim.state.tick,at:clock(),...event,passengers,position:{...vehicle.position},actualNodeAndVehiclePickup:sim.isNearBuilding(site,world.nodes.find(n=>n.id===event.nodeId)!.position,2)&&sim.isNearBuilding(site,vehicle.position,2),cargoOwner:core().cargoSources[vehicle.id]});
  });
  sim.onEvent('cargo-arrived',event=>{unloadedUnits+=event.amount??0;});
  const sourceEvents: any[] = [], transitions: any[] = [], samples: any[] = [];
  const events = ['production', 'wage-earned', 'wage-paid', 'private-shift-authorized', 'public-shift-authorized', 'sale', 'wholesale', 'business-expense', 'public-procurement', 'security-procurement', 'emergency-procurement', 'medical-procurement', 'civic-procurement'];
  for (const type of events) sim.onEvent(type, event => {
    const e = event as any, r = kindRow(e.shopId);
    if (r) {
      if (type === 'production') { r.production += value(e, 'amount'); r.productionMinutes += value(e, 'minutes'); }
      if (type === 'wage-earned') { r.earnedLabor += value(e, 'amount'); r.actualLaborMinutes += value(e, 'minutes'); }
      if (type === 'wage-paid') r.paidWages += value(e, 'amount');
      if (type === 'private-shift-authorized') { r.authorizedLaborMinutes += value(e, 'minutes'); r.authorizedLaborGross += value(e, 'amount'); }
      if (type === 'sale') { r.consumerUnits += e.quantity ?? 1; r.consumerGross += value(e, 'amount'); r.consumers++; if (shops.get(e.shopId) && sim.shopCommodity(shops.get(e.shopId)!) === 'food') immediateFoodConsumed++; }
      if (type === 'wholesale') { r.wholesaleUnits += value(e, 'quantity'); r.wholesaleGross += value(e, 'amount'); }
      if (type === 'business-expense') r.utilityCashPaid += value(e, 'amount');
      if (type.endsWith('-procurement')) { r.publicPurchasedUnits += value(e, 'quantity'); r.publicPurchasedGross += value(e, 'amount'); }
    }
    if (sourceEvents.length < 400 && (type === 'private-shift-authorized' || type === 'wage-earned' || type === 'production' || type === 'public-procurement') && ['farm', 'dock', 'workshop'].includes(e.shopId ? sites.get(shops.get(e.shopId)!.buildingId)!.kind : '')) sourceEvents.push({ tick: sim.state.tick, at: clock(), ...e });
  });
  sim.onEvent('stored-meal', e => { storedConsumed += e.amount ?? 0; });
  function snapshot(detailed = false) {
    const state = sim.state, runtime = core(), alive = state.citizens.filter(c => state.extension!.actorProfiles[c.id].alive);
    const totals: Record<string, any> = Object.fromEntries(kinds.map(kind => [kind, { sites: 0, employees: 0, employedPeople: 0, staffedSites: 0, openSites: 0, stock: 0, cash: 0, protectedCash: 0, actualRemainingCash: 0, acceptedMinutes: 0, workedMinutes: 0, futureReserved: 0, ownerAtSite: 0, ownerHealthyAtSite: 0, ownerUnfundedReviewNeed: 0, recentSold: 0, zeroProductionWindowWithLabor: 0, profitable: 0, actualDutyPeople: 0, fundedOfferSites: 0 }]));
    const ownerEvents: any[] = [];
    for (const shop of state.shops) {
      const site = sites.get(shop.buildingId)!, kind = site.kind, r = totals[kind], plan = runtime.privateLabor?.shifts[shop.id], current = plan?.day === Math.floor(clock() / 1440);
      const assignments = current ? plan.assignments : [], signals = tradeSignals(sim, shop.id);
      const ownerId = sim.shopOwnerId(shop), owner = ownerId === 'player' ? state.player : state.citizens.find(c => c.id === ownerId), profile = ownerId ? state.extension!.actorProfiles[ownerId] : undefined;
      const ownerPresent = !!owner && sim.isNearBuilding(site, owner.position, 2), qualified = ownerPresent && !!profile?.alive && profile.age >= 18 && profile.health >= 45 && owner!.needs.hunger >= 40 && owner!.needs.fatigue >= 35;
      const cash = sim.shopFunds(shop), protectedCash = sim.shopProtectedFunds(shop), minimumSalary = 32 * (.7 + state.districts.find(d => d.id === shop.districtId)!.prosperity / 100);
      r.sites++; r.employees += shop.employees; r.employedPeople += alive.filter(c => c.workId === site.id && c.role !== '学生').length; r.staffedSites += Number(shop.employees > 0); r.openSites += Number(shop.open); r.stock += shop.inventory; r.cash += cash; r.protectedCash += protectedCash; r.actualRemainingCash += Math.max(0, cash - protectedCash); r.acceptedMinutes += assignments.reduce((n: number, a: any) => n + a.minutesCap, 0); r.workedMinutes += assignments.reduce((n: number, a: any) => n + a.workedMinutes, 0); r.futureReserved += sim.shopCommittedPayroll(shop); r.ownerAtSite += Number(ownerPresent); r.ownerHealthyAtSite += Number(qualified); r.ownerUnfundedReviewNeed += Number(qualified && cash - protectedCash <= 20 * 8 / 24); r.recentSold += signals.sold; r.zeroProductionWindowWithLabor += Number(signals.labor > 0 && signals.produced === 0); r.profitable += Number(shop.profit > 0); r.actualDutyPeople += alive.filter(c => c.workId === site.id && sim.isOnDuty(c.id, site.id)).length; r.fundedOfferSites += Number(shop.open && cash - protectedCash >= minimumSalary && signals.sold > 0 && shop.employees < Math.min(100, site.capacity));
      if (detailed && kind !== 'market') ownerEvents.push({ shopId: shop.id, districtId: shop.districtId, kind, ownerId, ownerWorkId: ownerId === 'player' ? null : state.citizens.find(c => c.id === ownerId)?.workId, ownerAtSite: ownerPresent, ownerQualifiedAtSite: qualified, ownerMoney: owner?.money, ownerHealth: profile?.health, ownerHunger: owner?.needs.hunger, ownerFatigue: owner?.needs.fatigue, employees: shop.employees, cash, protectedCash, inventory: shop.inventory, recentSold: signals.sold, actualProductionWindow: signals.produced, acceptedMinutes: assignments.reduce((n: number, a: any) => n + a.minutesCap, 0), workedMinutes: assignments.reduce((n: number, a: any) => n + a.workedMinutes, 0), quote: sim.quoteSupply(shop.id, 1), profit: shop.profit, open: shop.open });
    }
    const food = state.shops.filter(shop => sim.shopCommodity(shop) === 'food'), openFood = food.filter(shop => shop.open && shop.inventory >= 1);
    const starving = alive.filter(c => c.needs.hunger < 20), cashRichStarving = starving.filter(c => c.money >= 15);
    const foodInTransit = state.vehicles.reduce((n, v) => n + v.cargo, 0) + Object.values(runtime.freight as Record<string, number>).reduce((n, qty) => n + qty, 0);
    const naturalVacancies = state.shops.filter(shop => shop.open && sim.shopFunds(shop) - sim.shopProtectedFunds(shop) >= 32 * (.7 + state.districts.find(d => d.id === shop.districtId)!.prosperity / 100) && tradeSignals(sim, shop.id).sold > 0 && shop.employees < Math.min(100, sites.get(shop.buildingId)!.capacity));
    const eligibleResting = runtime.publicLabor ? alive.filter(c => runtime.publicLabor.jobs[c.id] && !state.shops.some(shop => shop.buildingId === c.workId) && c.needs.hunger >= 45 && c.needs.fatigue >= 40 && (c.skills?.craft ?? 0) >= 20 && !['官员','议员','财政官','official','council','mayor'].includes(c.role)) : [];
    const lowEnergy = state.districts.filter(d => d.energy <= 25);
    return { tick: state.tick, at: clock(), day: state.day, hour: state.hour, treasury: state.treasury, energy: state.energy, publicSupply: runtime.publicSupply ?? 1, policy: { taxRate: state.taxRate, policeBudget: state.policeBudget }, bankCash: state.banking?.cash, bankDeposits: Object.values(state.banking?.accounts ?? {}).reduce((n, a) => n + a.deposits, 0), totals, metrics: structuredClone(metrics), publicBudget: sim.publicBudgetSnapshot(), publicLabor: sim.publicServiceCoverage(), privateLabor: sim.privateLaborCoverage(), food: { stock: food.reduce((n, shop) => n + shop.inventory, 0), inTransit: foodInTransit, totalStock: food.reduce((n, shop) => n + shop.inventory, 0) + foodInTransit + alive.reduce((n,c) => n + (c.food ?? 0), 0), consumerStored: alive.reduce((n,c) => n + (c.food ?? 0), 0), storedConsumed, immediateConsumed: immediateFoodConsumed, inferredConsumed: storedConsumed + immediateFoodConsumed, openAvailableSites: openFood.length, demandPortionsPerDay: alive.length * 1440 * .05 / 52 }, people: { total: state.citizens.length, alive: alive.length, meanHunger: alive.reduce((n,c)=>n+c.needs.hunger,0)/Math.max(1,alive.length), meanHealth: alive.reduce((n,c)=>n+state.extension!.actorProfiles[c.id].health,0)/Math.max(1,alive.length), poor: alive.filter(c=>c.money<80).length, hungryUnder20: starving.length, cashRichStarving: cashRichStarving.length, noStoredMeal: alive.filter(c=>(c.food??0)<1).length, depletedWorkers: alive.filter(c=>c.needs.hunger<40||c.needs.fatigue<35).length }, jobOffers: { note: 'Read-only candidates implied by current code; there is no persisted posted-vacancy registry.', potentialSites: naturalVacancies.length, foodSites: naturalVacancies.filter(s=>['farm','dock'].includes(sites.get(s.buildingId)!.kind)).length, healthyRestingPublicApplicants: eligibleResting.length }, lowEnergyDistricts: lowEnergy.map(d=>({id:d.id,energy:d.energy})), ...(detailed?{suppliers:ownerEvents, districts:state.districts.map(d=>({id:d.id,energy:d.energy,employment:d.employment,prosperity:d.prosperity})), starvingExamples:cashRichStarving.slice(0,12).map(c=>({id:c.id,hunger:c.needs.hunger,money:c.money,workId:c.workId,destinationId:c.destinationId,state:c.state,position:c.position}))}: {}) };
  }
  samples.push(snapshot(true));
  const observed = new Set<string>();
  sim.onPhase('feedback', () => {
    for (const [key, condition] of [['energyBelow25', sim.state.energy < 25], ['meanHungerBelow40', sim.state.citizens.reduce((n,c)=>n+c.needs.hunger,0)/sim.state.citizens.length<40], ['foodOpenSitesUnder10',sim.state.shops.filter(s=>sim.shopCommodity(s)==='food'&&s.open&&s.inventory>=1).length<10], ['publicLaborActivated',!!core().publicLabor]] as const) if(condition && !observed.has(key)) {observed.add(key);const sample=snapshot(true);transitions.push({condition:key,sample});console.log(JSON.stringify({causeTransition:key,tick:sample.tick,day:sample.day,hour:sample.hour,energy:sample.energy,treasury:sample.treasury,hunger:sample.people.meanHunger}));}
    if(sim.state.tick%180===0){const sample=snapshot(sim.state.tick%720===0);samples.push(sample);if(sim.state.tick%720===0)console.log(JSON.stringify({foodMaterialDay:sim.state.tick/720,treasury:sample.treasury,energy:sample.energy,food:sample.food,people:sample.people,totals:sample.totals}));}
  });
  return { async write(path: string) { const manifest=JSON.parse(await readFile('snapshot-manifest.json','utf8'));const endHash=Object.fromEntries(await Promise.all(Object.keys(manifest.sourceCopy).map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));const stable=JSON.stringify(endHash)===JSON.stringify(manifest.sourceCopy);await writeFile(path,JSON.stringify({scope:'Same single default actual audit trajectory; readonly event/phase observers; no policy changes, no cash or goods injection; no independent CPU benchmark.',seed:world.seed,speed:sim.state.speed,ticks:sim.state.tick,sourceHash:manifest.sourceCopy,endSourceHash:endHash,sourceStable:stable,samples,transitions,sourceEvents,freight:{initialVehicleCargo,loadedUnits,unloadedUnits,finalVehicleCargo:sim.state.vehicles.reduce((sum,v)=>sum+v.cargo,0),cargoResidual:initialVehicleCargo+loadedUnits-unloadedUnits-sim.state.vehicles.reduce((sum,v)=>sum+v.cargo,0),loadEvents:freightEvents},final:snapshot(true)},null,2));if(!stable)throw new Error('Observer source changed during the isolated audit');} };
}
