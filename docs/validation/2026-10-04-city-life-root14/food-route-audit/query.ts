import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Simulation } from './base/src/simulation';
import { NpcStairMotion } from './base/src/simulation/npc-stair-motion';
import { savedWorldFingerprint } from './base/src/persistence/world-layout';
import { decodeCitizenRoutes } from './base/src/persistence/route-encoding';
import { canAccessFloor } from './base/src/access';
import { blocksFloorPlanMovement, floorPlanSupport } from './base/src/architecture-floor-plan';
import { blocksMarketCounter, marketCounters } from './base/src/site-fixtures';
import { isRoadOpen, roadMovementAllowed } from './base/src/roads';
import type { Building, Citizen, WorldDefinition, Vec3 } from './base/src/types';

// Read-only evidence object. Never call Simulation's constructor or any
// tick/mover/command/import/export hook. Only routing/geometry getters below
// are used, with actual decoded terminal state and actual persisted runtime.
const root = '/workspace/yunshan-work/ROOT14-default-food-route-audit-20261004-01';
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const saveBytes = readFileSync(root + '/TERMINAL-ORIGINAL.save.json');
const worldBytes = readFileSync(root + '/WORLD-ORIGINAL.json');
const auditBytes = readFileSync(root + '/DAY-AUDIT-ORIGINAL.json');
const envelope = JSON.parse(saveBytes.toString()), world = JSON.parse(worldBytes.toString()) as WorldDefinition;
const originalAudit = JSON.parse(auditBytes.toString());
assert.equal(digest(saveBytes), '72ce8b457cc689ec030459aad63f8e44f00a22175e4be614b2a75d16545dfb67');
assert.equal(world.layoutVersion, 'current-v6');
assert.equal(savedWorldFingerprint(world), envelope.worldFingerprint);
const frozen = JSON.parse(readFileSync(root + '/BASE-INPUTS.json', 'utf8'));
const inputRows = frozen.items.filter((row: any) => !row.originalSource);
assert.equal(inputRows.length, 295);
for (const row of inputRows) assert.equal(digest(readFileSync(root + '/base/' + row.path)), row.sha256, row.path);
for (const [path, sha] of Object.entries(originalAudit.sourceHash)) assert.equal(digest(readFileSync(root + '/base/' + path)), sha, 'actual day source ' + path);
decodeCitizenRoutes(envelope.routeEncoding, envelope.routePool, envelope.state.citizens);
const state = envelope.state, runtime = envelope.runtime;
const businessBefore = JSON.stringify({ state, runtime });
const worldBefore = JSON.stringify(world);
const q: any = Object.create(Simulation.prototype);
Object.assign(q, { world, state, runtime,
  buildings: new Map(world.buildings.map(b => [b.id, b])), edges: new Map(world.edges.map(e => [e.id, e])),
  neighbors: new Map(), nodeAt: new Map(), doorNodes: new Map(), routeCache: new Map(), walkingTrees: new Map(),
  workforce: new Map(), citizenRoadRevisions: new WeakMap(), routingRevision: -1,
  npcStairMotion: new NpcStairMotion(world), employment: new Set(), accrualIndex: new Map(),
});
for (const node of world.nodes) q.nodeAt.set(q.pointKey(node.position), node.id);
for (const site of world.buildings) q.doorNodes.set(site.id, q.nearestNode(site.door));
for (const edge of world.edges) { q.addNeighbor(edge.from, edge.to, edge); q.addNeighbor(edge.to, edge.from, edge); }
// refreshWorkforce only modifies q's independent roster map, never actors.
q.refreshWorkforce();
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
const count = (values: unknown[]) => Object.fromEntries([...new Set(values)].map(key => [String(key), values.filter(v => v === key).length]));
const pureRoute = (points: Vec3[] | null) => points ? { points: points.length, referenceLength: points.slice(1).reduce((n,p,i) => n+dist(points[i],p),0), from: points[0], to: points.at(-1) } : null;
const components = new Map<string, number>();
for (const node of world.nodes) {
  if (components.has(node.id)) continue;
  const component = new Set<string>([node.id]), todo = [node.id], id = components.size;
  while (todo.length) for (const link of q.neighbors.get(todo.pop()) ?? []) if (['road','bridge'].includes(link.edge.mode) && isRoadOpen(state,link.edge.id) && !component.has(link.node)) { component.add(link.node); todo.push(link.node); }
  for (const key of component) components.set(key,id);
}
const sites = state.shops.filter((shop: any) => ['farm','dock','market'].includes(q.buildings.get(shop.buildingId)?.kind));
const foodSites = sites.map((shop: any) => {
  const site = q.buildings.get(shop.buildingId) as Building;
  const salePoints = q.buildingFunctionPoints(site).filter((p: any) => p.purpose === 'sale' && p.floor === 0 && !site.floorUses?.[p.floor]?.includes('观景')).map((p: any) => {
    const route = q.floorPlanRoute(site,0,0,site.door,p.position);
    // Door-to-counter native materialization is a pure feasibility query,
    // separate from route existence and any resident's actual arrival.
    const firstBlocked = route ? route.slice(1).map((_v: Vec3,i: number) => ({ index:i+1, description:q.npcStairMotion.describe(route,i+1) })).find((leg: any) => leg.description.kind === 'blocked') : undefined;
    return { ...p, route: pureRoute(route), firstNativeMaterializationBlock: firstBlocked ? { index:firstBlocked.index, buildingId:firstBlocked.description.buildingId, from:route[firstBlocked.index-1], to:route[firstBlocked.index] } : null };
  });
  return { shopId:shop.id,siteId:site.id,kind:site.kind,districtId:site.districtId,open:shop.open,inventory:shop.inventory,rawUnitPrice:shop.price,
    door:site.door,doorNodeId:q.buildingNode(site).id,component:components.get(q.buildingNode(site).id),salePoints,
    floorPermissions:site.floorPermissions ?? null,publicFloors:site.publicFloors ?? null,requiredPermission:site.requiredPermission ?? null,
    shopFunds:q.shopFunds(shop),earnedPayrollDebt:q.shopPayrollDebt(shop),unworkedPayrollCommitment:q.shopCommittedPayroll(shop),profit:shop.profit,employees:shop.employees };
});
writeFileSync(root+'/FOOD-SITES.json',JSON.stringify(foodSites,null,2)+'\n');
const hungry = state.citizens.filter((actor: Citizen) => state.extension?.actorProfiles[actor.id]?.alive !== false && actor.needs.hunger < 30 && (actor.food ?? 0) < 1);
assert.equal(hungry.length,240);
const rows: any[] = [];
writeFileSync(root+'/RESIDENTS-PARTIAL.jsonl','');
const saleMap = new Map(foodSites.map((row: any) => [row.siteId,row]));
for (const actor of hungry as Citizen[]) {
  const id=actor.id, profile=state.extension.actorProfiles[id], person={role:q.citizenIdentity(actor),identities:[q.citizenIdentity(actor)]};
  const route = actor.route ?? [], index = actor.routeIndex ?? 0;
  const present = world.buildings.map(site => ({siteId:site.id,presence:q.floorPlanPresence(site,actor.position)})).filter(row => row.presence);
  const anchors=q.walkingAnchors(actor);
  const relation=state.relationships.find((r: any) => r.npcId === id);
  const offers=foodSites.filter((shop: any) => shop.open && shop.inventory>=1 && actor.money>=shop.rawUnitPrice).map((offer: any) => {
    const site=q.buildings.get(offer.siteId), shop=state.shops.find((row: any)=>row.id===offer.shopId);
    const crossDistrictExcluded=dist(actor.position,site.door)>1200 && site.districtId!==actor.districtId;
    const hostilePlayerShopExcluded=!!relation && q.hostilityRank(relation)>=2 && q.playerOwnsShop(shop);
    const graphTravel=Math.min(...anchors.map((a: any)=>a.cost+(q.walkingTree(a.node).costs.get(offer.doorNodeId)??Infinity)));
    const acl=offer.salePoints.filter((p: any)=>Array.from({length:p.floor+1},(_,floor)=>floor).every(floor=>canAccessFloor(site,floor,person)));
    const currentDestination=actor.destinationId===site.id;
    const target=route.at(-1), currentTargetSale=target && offer.salePoints.find((p: any)=>dist(p.position,target)<1e-8);
    return {shopId:offer.shopId,siteId:offer.siteId,kind:offer.kind,inventory:offer.inventory,rawUnitPrice:offer.rawUnitPrice,
      effectiveUnitPrice:offer.rawUnitPrice*((relation?.trust??0)>55?.95:1),walletCanPayRawQuote:true,crossDistrictExcluded,hostilePlayerShopExcluded,
      graphReachable:Number.isFinite(graphTravel),graphTravel:Number.isFinite(graphTravel)?graphTravel:null,doorComponent:offer.component,
      accessibleGroundSalePoints:acl.length,doorToSalePlannerRoutes:acl.filter((p: any)=>p.route).length,
      doorToSaleNativeMaterializableRoutes:acl.filter((p: any)=>p.route&&!p.firstNativeMaterializationBlock).length,
      hypotheticalEatScore:Number.isFinite(graphTravel)&&!crossDistrictExcluded&&!hostilePlayerShopExcluded?(100-actor.needs.hunger)*1.15+260-Math.min(150,graphTravel/12):null,
      currentDestination,currentTargetSaleId:currentTargetSale?.id??null};
  });
  let currentLeg: any={index,routePoints:route.length,from:index>0?route[index-1]??null:null,to:route[index]??null,kind:'complete'};
  if(index<route.length && index>=1){
    const description=q.npcStairMotion.describe(route,index);
    currentLeg.kind=description.kind;
    currentLeg.roadGuardAllowsWholeReferenceSegment=roadMovementAllowed(world,state,id,actor.position,route[index]);
    if(description.kind==='blocked') { currentLeg.blockedBuildingId=description.buildingId;currentLeg.unstartedExteriorDoorIntent=q.npcStairMotion.isUnstartedExteriorDoorApproach(route,index,actor.position); }
    if(description.kind==='legacy') {
      currentLeg.referenceBodyGuardAllowsWholeSegment=q.citizenReferenceSegmentAllowed(actor,actor.position,route[index],description.bodies??[]);
      currentLeg.bodyWitnesses=(description.bodies??[]).map((w:any)=>({buildingId:w.building.id,floors:w.floors,
        blockingFloors:w.floors.filter((floor:number)=>blocksFloorPlanMovement(w.building,floor,actor.position,route[index],.35,1.72)),counterBlocked:blocksMarketCounter(marketCounters(world,w.building),actor.position,route[index],.35,1.72)}));
    }
    if(description.kind==='physical') {
      currentLeg.buildingId=description.leg.building.id;currentLeg.physicalLength=description.leg.length;currentLeg.parts=description.leg.parts.length;
      currentLeg.cursorSource=runtime.npcStairCursors?.[id]?'saved':'hypothetical-opening';
      const cursor=runtime.npcStairCursors?.[id]??q.npcStairMotion.opening(route,index);
      try { q.npcStairMotion.validate(route,cursor,actor.position);currentLeg.cursorBodyValid=true; } catch(e) {currentLeg.cursorBodyValid=false;currentLeg.cursorBodyFailure=(e as Error).message;}
    }
  }
  const privateShop=state.shops.find((s:any)=>s.buildingId===actor.workId), privatePlan=privateShop&&runtime.privateLabor?.shifts?.[privateShop.id];
  const privateAssignment=privatePlan?.assignments.find((a:any)=>a.citizenId===id);
  const workAllowance=privateShop?q.privateWorkAllowance(actor,privateShop):q.publicWorkAllowance(actor);
  const actualActivity=runtime.activities[id]??null, currentShop=state.shops.find((s:any)=>s.buildingId===actor.destinationId);
  const committedEat=!!actor.destinationId&&actualActivity==='eat'&&actor.needs.hunger<55&&!!currentShop?.open&&currentShop.inventory>=1&&actor.money>=currentShop.price;
  const choice=q.chooseFacility(actor);
  const choiceSite=saleMap.get(choice.destination.id) as any;
  const chosenEligibleOffer=offers.find((o:any)=>o.siteId===choice.destination.id);
  const currentOffer=offers.find((o:any)=>o.siteId===actor.destinationId);
  rows.push({id,name:actor.name,districtId:actor.districtId,role:actor.role,canonicalIdentity:person.role,socialIdentities:actor.socialIdentities,
    age:profile.age,health:profile.health,needs:actor.needs,food:actor.food??0,money:actor.money,position:actor.position,
    homeId:actor.homeId,workId:actor.workId,workKind:q.buildings.get(actor.workId)?.kind,workShopId:privateShop?.id??null,state:actor.state,tier:actor.tier,
    currentActivity:actualActivity,destinationId:actor.destinationId,currentDestinationKind:actor.destinationId?q.buildings.get(actor.destinationId)?.kind:null,
    currentDestinationQuote:currentShop?{shopId:currentShop.id,open:currentShop.open,inventory:currentShop.inventory,rawUnitPrice:currentShop.price}:null,
    currentOffer:currentOffer??null,currentRoute:pureRoute(route),routeIndex:index,currentLeg,savedCursor:runtime.npcStairCursors?.[id]??null,
    currentBuildingPresence:present,walkingAnchors:anchors.map((a:any)=>({nodeId:a.node,component:components.get(a.node),prefix:pureRoute(a.points),cost:a.cost})),
    previousEatCommitment:committedEat,roadWaitingCommitment:!!actor.destinationId&&actor.state==='roadWaiting',decisionAt:runtime.decisionAt[id]??null,
    decisionDue:1920+1e-7>=(runtime.decisionAt[id]??0),pendingPeopleMinutes:runtime.peopleElapsed?.[id]??0,
    rider:runtime.riders?.[id]??null,dispatch:runtime.dispatches?.[id]??null,
    actualAttendanceSinceSettlement:runtime.attendance[id]??0,privatePlan:privatePlan?{day:privatePlan.day,assignment:privateAssignment??null}:null,
    workAllowance,unsettledClaims:(runtime.wageAccruals??[]).filter((a:any)=>a.citizenId===id),settlementArrears:(runtime.wageArrears??[]).filter((a:any)=>a.citizenId===id),
    pureHypotheticalChoice:{destinationId:choice.destination.id,activity:choice.activity,chosenOffer:chosenEligibleOffer??null,groundSalePoints:choiceSite?.salePoints??null},
    offerCount:offers.length,decisionEligibleOfferCount:offers.filter((o:any)=>!o.crossDistrictExcluded&&!o.hostilePlayerShopExcluded).length,
    graphReachableEligibleOfferCount:offers.filter((o:any)=>o.graphReachable&&!o.crossDistrictExcluded&&!o.hostilePlayerShopExcluded).length,
    plannerGroundSaleEligibleOfferCount:offers.filter((o:any)=>o.graphReachable&&!o.crossDistrictExcluded&&!o.hostilePlayerShopExcluded&&o.doorToSalePlannerRoutes>0).length,
    materializableGroundSaleEligibleOfferCount:offers.filter((o:any)=>o.graphReachable&&!o.crossDistrictExcluded&&!o.hostilePlayerShopExcluded&&o.doorToSaleNativeMaterializableRoutes>0).length,
    offers});
  appendFileSync(root+'/RESIDENTS-PARTIAL.jsonl',JSON.stringify(rows.at(-1))+'\n');
  if(rows.length%40===0) console.log(JSON.stringify({processed:rows.length,elapsedSeconds:process.uptime()}));
}
assert.equal(JSON.stringify({state,runtime}),businessBefore,'all state and runtime business fields unchanged');
assert.equal(JSON.stringify(world),worldBefore,'World object unchanged');
assert.equal(digest(readFileSync(root+'/TERMINAL-ORIGINAL.save.json')),digest(saveBytes));
assert.equal(digest(readFileSync(root+'/WORLD-ORIGINAL.json')),digest(worldBytes));
const summary={residents:rows.length,states:count(rows.map(r=>r.state)),activities:count(rows.map(r=>r.currentActivity)),
  currentLegKinds:count(rows.map(r=>r.currentLeg.kind)),currentNextLegBlocks:rows.filter(r=>r.currentLeg.kind==='blocked').map(r=>r.id),
  currentReferenceBodyGuardFailures:rows.filter(r=>r.currentLeg.referenceBodyGuardAllowsWholeSegment===false).map(r=>r.id),
  anchorless:rows.filter(r=>r.walkingAnchors.length===0).map(r=>r.id),noDecisionEligibleOffer:rows.filter(r=>r.decisionEligibleOfferCount===0).map(r=>r.id),
  noGraphReachableOffer:rows.filter(r=>r.graphReachableEligibleOfferCount===0).map(r=>r.id),noPlannerGroundSaleOffer:rows.filter(r=>r.plannerGroundSaleEligibleOfferCount===0).map(r=>r.id),
  noMaterializableGroundSaleOffer:rows.filter(r=>r.materializableGroundSaleEligibleOfferCount===0).map(r=>r.id),
  pureChoiceActivities:count(rows.map(r=>r.pureHypotheticalChoice.activity)),committedEat:rows.filter(r=>r.previousEatCommitment).length,
  currentEligibleShop:rows.filter(r=>r.currentOffer).length,riders:rows.filter(r=>r.rider).length,
  graphComponents:count([...components.values()]),foodSites:foodSites.length,foodSalePoints:foodSites.reduce((n,s)=>n+s.salePoints.length,0),
  doorToSaleRoutesWithNativeBlock:foodSites.flatMap(s=>s.salePoints.filter((p:any)=>p.firstNativeMaterializationBlock).map((p:any)=>({siteId:s.siteId,pointId:p.id,block:p.firstNativeMaterializationBlock}))),
  stateRuntimeEqual:true,worldObjectEqual:true,originalArtifactBytesEqual:true,helperStats:q.npcStairMotion.stats()};
const result={scope:'Static exact-terminal analysis. No Simulation constructor, createWorld, tick, people/commerce, moveCitizen, command, importSave, RNG, event emission or actual arrival/purchase. Object.create(Simulation.prototype) is an incomplete independent getter object populated only with original decoded state/runtime, read-only world/maps and private geometry/route caches. Native walkingPrefixAllowed may advance an independent hypothetical cursor solely to evaluate a route prefix; original actors/cursors remain byte-identical. All paths and choices are counterfactual current-state queries, not observed future behavior.',
  originals:{saveSHA256:digest(saveBytes),worldSHA256:digest(worldBytes),dayAuditSHA256:digest(auditBytes),worldFingerprint:envelope.worldFingerprint},
  actualTerminal:{tick:state.tick,day:state.day,hour:state.hour,clock:state.extension.lastUpdate,weather:state.weather},
  source:{baseInputs:inputRows.length,productionInputs:inputRows.filter((r:any)=>r.path.startsWith('src/')).length,daySourcesAllMatch:true,driverSHA256:digest(readFileSync(root+'/query.ts'))},
  summary,rows};
writeFileSync(root+'/RESIDENTS-240.json',JSON.stringify(result,null,2)+'\n');
writeFileSync(root+'/QUERY-SUMMARY.json',JSON.stringify({scope:result.scope,originals:result.originals,actualTerminal:result.actualTerminal,source:result.source,summary},null,2)+'\n');
console.log(JSON.stringify(summary));
