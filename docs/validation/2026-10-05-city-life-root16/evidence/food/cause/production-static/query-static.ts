// Static JSON/source diagnostic. This imports only pure geometry/identity helpers.
// No Simulation instance, import/load/step, world generation, build or renderer.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FLOOR_PLAN_PROFILE, floorPlanSupport, getBuildingFloorPlan, buildingLocalPosition, contains, getBuildingUsePoints } from '/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/architecture-floor-plan.ts';
import { canAccessFloor, getFloorDimensions } from '/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/access.ts';
import { savedWorldFingerprint } from '/workspace/yunshan-work/ROOT15-gift-final-integration-20261004-01/source/src/persistence/world-layout.ts';

const root = '/workspace/yunshan-work/ROOT16-food-cause-20261005-01/production-static';
const originals = `${root}/originals`;
const saveBytes = readFileSync(`${originals}/root15-current-default-day-final.save.json`);
const save = JSON.parse(saveBytes.toString());
const worldBytes = readFileSync(`${originals}/WORLD-ORIGINAL.json`);
const world = JSON.parse(worldBytes.toString());
const audit = JSON.parse(readFileSync(`${originals}/root15-current-default-day.json`, 'utf8'));
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
if (sha(saveBytes) !== 'db40c8410ed5cd45f308fb12c12a4ef6678c58add40e3122e595a6bdd99efe16') throw new Error('Authoritative save SHA mismatch');
if (sha(worldBytes) !== '2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512') throw new Error('World original SHA mismatch');
const fingerprint = savedWorldFingerprint(world);
if (fingerprint !== save.worldFingerprint || world.layoutVersion !== 'current-v6' || world.seed !== save.worldSeed) throw new Error('Static world binding mismatch');
const s = save.state, r = save.runtime, clock = s.extension.lastUpdate, day = Math.floor(clock / 1440);
const buildings = new Map(world.buildings.map((b: any) => [b.id, b]));
const citizens = new Map(s.citizens.map((c: any) => [c.id, c]));
const districts = new Map(s.districts.map((d: any) => [d.id, d]));
const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const roles = ['traveler','police','soldier','teacher','driver','merchant','scientist','official','council','mayor'];
const roleMap: Record<string, string> = { '警察': 'police', '士兵': 'soldier', '驾驶员': 'driver', '老师': 'teacher', '科研员': 'scientist', '科学家': 'scientist', '工程师': 'scientist', '官员': 'official', '议员': 'council', '财政官': 'official', '档案员': 'teacher', '使节': 'official', '商人': 'merchant' };
const identity = (c: any) => roles.includes(c.role) ? c.role : roleMap[c.role] ?? 'traveler';
function presence(b: any, p: any) {
  const floor = Math.round((p.y - b.position.y - .6) / (b.height / b.floors));
  for (const candidate of [floor, floor - 1, floor + 1]) {
    const support = floorPlanSupport(b, candidate, p);
    if (support && Math.abs(support.y - p.y) <= .26) return support;
  }
  return null;
}
function near(b: any, p: any, radius = 2) {
  if (b.floorPlanProfile === FLOOR_PLAN_PROFILE) {
    const actual = presence(b, p);
    if (actual) return actual.kind === 'room' || actual.kind === 'stairs';
    const floor = getBuildingFloorPlan(b, 0), local = buildingLocalPosition(b, p);
    return !!floor && Math.abs(p.y - b.door.y) < 1.5 && dist(p, b.door) <= radius
      && (!contains(floor.broadphase, local.x, local.z) || dist(p, b.door) < .4);
  }
  const floorHeight = b.height / Math.max(1, b.floors), floor = Math.floor((p.y - b.position.y + .01) / floorHeight);
  if (floor === 0 && dist(p, b.door) <= radius) return true;
  if (floor < -(b.basements ?? 0) || floor >= b.floors) return false;
  const dx = p.x - b.position.x, dz = p.z - b.position.z;
  const x = dx * Math.cos(b.rotation) + dz * Math.sin(b.rotation), z = -dx * Math.sin(b.rotation) + dz * Math.cos(b.rotation);
  const dimensions = getFloorDimensions(b, floor);
  return Math.abs(x) <= dimensions.width / 2 && Math.abs(z) <= dimensions.depth / 2 && p.y >= b.position.y - floorHeight * (b.basements ?? 0) - .5 && p.y <= b.position.y + b.height + .5;
}
function atWork(b: any, p: any, c: any) {
  if (b.floorPlanProfile !== FLOOR_PLAN_PROFILE) return near(b, p);
  const actual = presence(b, p), id = identity(c), person = { role: id, identities: [id] };
  return !!actual && ['room','stairs'].includes(actual.kind) && (b.functionPoints ?? Array.from({length:b.floors},(_,floor)=>getBuildingUsePoints(b,floor)).flat()).some((point:any)=>point.floor === actual.floor && point.purpose === 'work' && canAccessFloor(b,point.floor,person) && dist(p,point.position)<=2);
}
const observations = audit.snapshots.at(-1).commodityObservations;
for (const item of observations.namedAttendance) if ((buildings.get(item.siteId) as any)?.kind !== item.siteKind) throw new Error('Observed site kind mismatch');
const summed = (items: any[], key: string) => items.reduce((total,item)=>total+(item[key]??0),0);
const group = (items:any[],key:(item:any)=>string) => items.reduce((out:any,item:any)=>{const name=key(item);out[name]=(out[name]??0)+1;return out;},{});
const shops = s.shops.map((shop:any) => {
  const b:any=buildings.get(shop.buildingId), d:any=districts.get(shop.districtId);
  const company=s.extension.companies.find((x:any)=>x.shopBindingReleasedAt===undefined&&x.buildingId===shop.buildingId);
  const ownerId=company?.ownerId??shop.ownerId, owner:any=ownerId==='player'?s.player:citizens.get(ownerId), profile=s.extension.actorProfiles[ownerId];
  const plan=r.privateLabor.shifts[shop.id], current=plan?.day===day;
  const allWork=s.citizens.filter((c:any)=>c.workId===shop.buildingId);
  const named=plan?.assignments??[];
  const currentRemaining=current?summed(named.map((a:any)=>({remaining:Math.max(0,a.minutesCap-a.workedMinutes)})),'remaining'):0;
  const debt=[...r.wageArrears,...r.wageAccruals,...r.wages].filter((x:any)=>x.shopId===shop.id).reduce((n:any,x:any)=>n+x.amount,0);
  const committed=current?named.reduce((n:any,x:any)=>n+(x.minutesCap-x.workedMinutes)*x.ratePerMinute,0):0;
  const funds=company?.capital??shop.cash??0, reserve=20*8/24;
  const fundedAttendance=observations.namedAttendance.filter((x:any)=>x.shopId===shop.id);
  const pointDistances=(b.functionPoints??[]).filter((x:any)=>x.purpose==='work').map((x:any)=>({id:x.id,floor:x.floor,distance:owner?dist(owner.position,x.position):null})).sort((a:any,b:any)=>a.distance-b.distance);
  const ownerGates={exists:!!owner,alive:!!profile?.alive,adult:(profile?.age??-1)>=18,health:(profile?.health??-1)>=45,hunger:(owner?.needs.hunger??-1)>=40,fatigue:(owner?.needs.fatigue??-1)>=35,near:!!owner&&near(b,owner.position),workPoint:b.floorPlanProfile!==FLOOR_PLAN_PROFILE||!!owner&&atWork(b,owner.position,owner)};
  const failed=Object.entries(ownerGates).filter(([,pass])=>!pass).map(([name])=>name);
  const workers=allWork.map((c:any)=>{
    const p=s.extension.actorProfiles[c.id], assignment=named.find((x:any)=>x.citizenId===c.id), attendance=observations.namedAttendance.find((x:any)=>x.shopId===shop.id&&x.citizenId===c.id);
    return {id:c.id,name:c.name,role:c.role,identity:identity(c),age:p.age,alive:p.alive,health:p.health,position:c.position,state:c.state,activity:r.activities[c.id]??null,destinationId:c.destinationId,routeIndex:c.routeIndex,routeLength:c.route?.length??0,riding:r.riders[c.id]??null,hunger:c.needs.hunger,fatigue:c.needs.fatigue,food:c.food,money:c.money,attendanceSinceLastPayroll:r.attendance[c.id]??0,observedFundedAttendanceMinutes:attendance?.fundedAttendanceMinutes??0,planAssignment:assignment??null,currentAllowance:current&&assignment?Math.max(0,assignment.minutesCap-assignment.workedMinutes):0,nearWorkBuilding:near(b,c.position,1),atWorkPoint:atWork(b,c.position,c),peopleDeferredMinutes:r.peopleElapsed[c.id]??0};
  });
  const producer=['farm','dock','workshop'].includes(b.kind);
  const diagnostics=[];
  if(producer&&shop.inventory>=120)diagnostics.push('inventory-at-or-above-120-target');
  if(producer&&!current)diagnostics.push(plan?'old-day-plan-no-current-allowance':'no-plan-no-current-allowance');
  if(producer&&currentRemaining<=0&&current)diagnostics.push('current-plan-no-remaining-minutes');
  if(producer&&shop.employees===0)diagnostics.push('zero-employees');
  if(!shop.open)diagnostics.push('shop-closed');
  if(d.energy<=25)diagnostics.push('energy-service-failure');
  if(b.kind==='market')diagnostics.push('retail-site-no-production-branch');
  const roster=allWork.filter((c:any)=>c.role!=='学生'&&(s.extension.actorProfiles[c.id]?.age??20)>=18&&s.extension.actorProfiles[c.id]?.alive!==false);
  const promised=named.filter((x:any)=>x.minutesCap>0),pending=named.filter((x:any)=>x.minutesCap===0);
  const lastNamed=[...promised,...pending].map((x:any)=>roster.find((c:any)=>c.id===x.citizenId)).filter(Boolean),lastNames=new Set(lastNamed.map((c:any)=>c.id));
  const nextRoster=[...lastNamed,...roster.filter((c:any)=>!lastNames.has(c.id))].slice(0,shop.employees).map((c:any)=>c.id);
  return {id:shop.id,buildingId:shop.buildingId,name:b.name,kind:b.kind,districtId:shop.districtId,shopOriginal:shop,stock:shop.inventory,productionTarget:producer?120:null,targetHeadroom:producer?Math.max(0,120-shop.inventory):null,open:shop.open,districtEnergy:d.energy,employees:shop.employees,workerCount:workers.length,ownerId,companyId:company?.id??null,funds,fundsSource:company?'company.capital':'shop.cash',payrollDebt:debt,currentCommittedPayroll:committed,lifecycleReservedFunds:0,reviewOperatingReserve:reserve,reviewAvailableCash:Math.max(0,funds-debt-committed-reserve),owner:owner?{id:ownerId,position:owner.position,state:owner.state,activity:r.activities[ownerId]??null,destinationId:owner.destinationId,hunger:owner.needs.hunger,fatigue:owner.needs.fatigue,food:owner.food,health:profile.health,age:profile.age,alive:profile.alive,ownerReviewGates:ownerGates,failedOwnerReviewGates:failed,nearestWorkPoint:pointDistances[0]??null}:null,plan:plan??null,planStatus:!plan?'absent':current?'current-day':'old-day',planAgeDays:plan?day-plan.day:null,currentRemainingMinutes:currentRemaining,currentWorkedMinutes:current?summed(named,'workedMinutes'):0,savedShopLabor:r.shopLabor[shop.id]??0,nextReviewRoster:nextRoster,observedFundedAttendanceMinutes:summed(fundedAttendance,'fundedAttendanceMinutes'),observedEarnedGross:summed(fundedAttendance,'earnedGross'),workers,diagnostics};
});
const byKind=Object.fromEntries(['farm','dock','market','workshop'].map(kind=>{
  const list=shops.filter((x:any)=>x.kind===kind),workers=list.flatMap((x:any)=>x.workers),owners=list.map((x:any)=>x.owner);
  return [kind,{shops:list.length,open:list.filter((x:any)=>x.open).length,inventory:summed(list,'stock'),inventoryMin:Math.min(...list.map((x:any)=>x.stock)),inventoryMax:Math.max(...list.map((x:any)=>x.stock)),stockAtOrAboveTarget:list.filter((x:any)=>x.productionTarget!==null&&x.stock>=x.productionTarget).length,employees:summed(list,'employees'),zeroEmployees:list.filter((x:any)=>x.employees===0).length,workerCount:workers.length,workerHungerBelow40:workers.filter((x:any)=>x.hunger<40).length,workerHungerBelow30:workers.filter((x:any)=>x.hunger<30).length,workerHungerZero:workers.filter((x:any)=>x.hunger===0).length,workerFatigueBelow35:workers.filter((x:any)=>x.fatigue<35).length,workerStates:group(workers,(x:any)=>x.state),workerActivities:group(workers,(x:any)=>x.activity),meanHunger:summed(workers,'hunger')/workers.length,planStatuses:group(list,(x:any)=>x.planStatus),currentRemainingMinutes:summed(list,'currentRemainingMinutes'),currentWorkedMinutes:summed(list,'currentWorkedMinutes'),currentAllowanceWorkers:workers.filter((x:any)=>x.currentAllowance>0).length,ownerFailedReviewGateCounts:group(owners.flatMap((x:any)=>x?.failedOwnerReviewGates??[]),(x:any)=>x),ownerAllPhysicalAndNeedGatesPass:list.filter((x:any)=>x.owner&&x.owner.failedOwnerReviewGates.length===0).map((x:any)=>x.id),ownerLowHunger:list.filter((x:any)=>x.owner&&x.owner.hunger<40).map((x:any)=>x.id),observedFundedAttendanceMinutes:summed(list,'observedFundedAttendanceMinutes')}];
}));
const result={scope:'Static authoritative terminal JSON plus frozen pure geometry/source helpers. No Simulation constructed or stepped; no building/worker mutable state edits.',authority:{saveSha256:sha(saveBytes),worldOriginalSha256:sha(worldBytes),worldFingerprint:fingerprint,layout:world.layoutVersion,saveWorldFingerprint:save.worldFingerprint},terminal:{tick:s.tick,day:s.day,hour:s.hour,clock,contractDay:day,nextPrivateReviewAt:r.privateLabor.nextReviewAt,commerceAt:r.commerceAt,payrollAt:r.payrollAt,savedShopLabor:r.shopLabor},historicalObservation:{flows:observations.flows,attendanceBySiteKind:observations.attendanceBySiteKind,zeroOutputBatchDisposition:observations.zeroOutputBatchDisposition,tradeStats:s.trade.stats},byKind,shops};
writeFileSync(`${root}/PRODUCTION-STATIC.json`,JSON.stringify(result,null,2)+'\n');
writeFileSync(`${root}/SUMMARY.json`,JSON.stringify({...result,shops:undefined},null,2)+'\n');
const columns=['id','kind','stock','targetHeadroom','open','employees','workerCount','ownerId','funds','payrollDebt','reviewAvailableCash','planStatus','planAgeDays','currentRemainingMinutes','currentWorkedMinutes','observedFundedAttendanceMinutes','ownerHunger','ownerState','ownerActivity','ownerFailedReviewGates','workerHungerBelow40','workerStates','diagnostics'];
const csv=(v:any)=>'"'+String(v??'').replaceAll('"','""')+'"';
writeFileSync(`${root}/SHOPS.csv`,columns.join(',')+'\n'+shops.map((x:any)=>columns.map(k=>csv(k==='ownerHunger'?x.owner?.hunger:k==='ownerState'?x.owner?.state:k==='ownerActivity'?x.owner?.activity:k==='ownerFailedReviewGates'?x.owner?.failedOwnerReviewGates.join('|'):k==='workerHungerBelow40'?x.workers.filter((w:any)=>w.hunger<40).length:k==='workerStates'?JSON.stringify(group(x.workers,(w:any)=>w.state)):k==='diagnostics'?x.diagnostics.join('|'):x[k])).join(',')).join('\n')+'\n');
console.log(JSON.stringify({authority:result.authority,terminal:result.terminal,byKind:result.byKind},null,2));
