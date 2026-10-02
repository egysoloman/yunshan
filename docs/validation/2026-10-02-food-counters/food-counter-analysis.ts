import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWorld } from '../src/world';
import { Simulation } from '../src/simulation';
import { canAccessFloor } from '../src/access';

const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
async function sourceHashes() {
  const names = (await readdir('src', { recursive: true })).filter(name => name.endsWith('.ts') || name.endsWith('.css')).sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [`src/${name}`, hash(await readFile(`src/${name}`))])));
}
const sourceStart = await sourceHashes(), original = await readFile('artifacts/food-material-final.save.json', 'utf8');
const snapshotManifest = JSON.parse(await readFile('snapshot-manifest.json', 'utf8'));
if (Object.keys(sourceStart).length !== Object.keys(snapshotManifest.sourceCopy).length || Object.entries(sourceStart).some(([name, digest]) => snapshotManifest.sourceCopy[name] !== digest)) throw new Error('Read-only analysis must use the original 32-source immutable audit snapshot');
const world = createWorld(20261001), sim = new Simulation(world), loaded = sim.importSave(original);
if (!loaded.ok || sim.exportSave() !== original) throw new Error(`Original final save must load and round-trip exactly: ${loaded.message}`);
const before = sim.exportSave(), runtime: any = Reflect.get(sim, 'runtime'), profiles = sim.state.extension!.actorProfiles;
const at = sim.state.extension!.lastUpdate, day = Math.floor(at / 1440), publicShift = runtime.publicLabor?.shifts.find((shift: any) => shift.day === day);
const buildingById = new Map(world.buildings.map(building => [building.id, building]));
const walk = (citizen: any, building: any) => Reflect.get(sim, 'walkingDistance').call(sim, citizen, building) as number;
const near = (position: any, door: any) => Math.hypot(position.x - door.x, position.y - door.y, position.z - door.z);
const identity = (citizen: any) => Reflect.get(sim, 'citizenIdentity').call(sim, citizen) as string;
const healthy = (citizen: any) => profiles[citizen.id].alive && profiles[citizen.id].age >= 18 && profiles[citizen.id].health >= 45 && citizen.needs.hunger >= 40 && citizen.needs.fatigue >= 35;
const people = sim.state.citizens.filter(citizen => profiles[citizen.id].alive), hungry = people.filter(citizen => citizen.needs.hunger < 20 && citizen.money >= 15);
const targetIds = ['academy', 'government', 'starport'];
const speed = sim.state.weather === '雨' ? 3.1 : 4.2;
const officials = people.filter(citizen => ['official', 'council', 'mayor'].includes(identity(citizen))).map(citizen => ({
  id: citizen.id, identity: identity(citizen), districtId: citizen.districtId, workId: citizen.workId, workplaceKind: buildingById.get(citizen.workId)?.kind,
  state: citizen.state, activity: runtime.activities[citizen.id], healthy: healthy(citizen), onDuty: sim.isOnDuty(citizen.id, citizen.workId),
  physicallyNearOwnWorkplace: sim.isNearBuilding(buildingById.get(citizen.workId)!, citizen.position, 2), nearOwnWorkplaceDoor: near(citizen.position, buildingById.get(citizen.workId)!.door), hunger: citizen.needs.hunger, fatigue: citizen.needs.fatigue,
}));
const authorityGroups = [...new Set(officials.map(row => row.workId))].map(workId => ({ workId, onsiteHealthy: officials.filter(row => row.workId === workId && row.healthy && row.physicallyNearOwnWorkplace).map(row => row.id), onDuty: officials.filter(row => row.workId === workId && row.onDuty).map(row => row.id) }));
const districts = targetIds.map(districtId => {
  const residents = people.filter(citizen => citizen.districtId === districtId), richHungry = hungry.filter(citizen => citizen.districtId === districtId);
  const candidates = world.buildings.filter(building => building.districtId === districtId && ['station', 'hall', 'school'].includes(building.kind) && canAccessFloor(building, 0, { role: 'traveler', identities: [] })).map(building => {
    const staff = residents.filter(citizen => citizen.workId === building.id && citizen.role !== '学生').map(citizen => {
      const assignment = publicShift?.assignments.find((item: any) => item.citizenId === citizen.id && item.workId === building.id);
      return { id: citizen.id, role: citizen.role, identity: identity(citizen), homeId: citizen.homeId, state: citizen.state, activity: runtime.activities[citizen.id],
        position: citizen.position, walkingNow: walk(citizen, building), walkingFromHome: sim.buildingTravelDistance(citizen.homeId, building.id),
        healthy: healthy(citizen), hunger: citizen.needs.hunger, fatigue: citizen.needs.fatigue, health: profiles[citizen.id].health,
        onDuty: sim.isOnDuty(citizen.id, building.id), attendance: runtime.attendance[citizen.id] ?? 0, registeredPublicJob: runtime.publicLabor?.jobs[citizen.id] === building.id,
        fundedMinutesCap: assignment?.minutesCap ?? 0, workedMinutes: assignment?.workedMinutes ?? 0, remainingPromisedMinutes: assignment ? Math.max(0, assignment.minutesCap - assignment.workedMinutes) : 0,
        ratePerMinute: assignment?.ratePerMinute ?? null, ownsPrivateShop: sim.state.shops.some(shop => sim.shopOwnerId(shop) === citizen.id),
      };
    });
    const homeDistances = residents.map(citizen => ({ id: citizen.id, distance: sim.buildingTravelDistance(citizen.homeId, building.id) }));
    const nowDistances = richHungry.map(citizen => ({ id: citizen.id, distance: walk(citizen, building) }));
    const targetNode = Reflect.get(sim, 'buildingNode').call(sim, building);
    const nearestStationNodes = world.nodes.filter(node => node.station && node.districtId === districtId).map(node => {
      const distanceOnFoot = Reflect.get(sim, 'walkingTree').call(sim, node.id).costs.get(targetNode.id) ?? Infinity;
      return { id: node.id, distanceFromDoor: near(node.position, building.door), distanceOnFoot, roundTripMinutesOnFoot: distanceOnFoot * 2 / speed, position: node.position };
    }).sort((a,b) => a.distanceFromDoor - b.distanceFromDoor);
    return { id: building.id, name: building.name, kind: building.kind, facility: building.facility ?? null, door: building.door,
      capacity: building.capacity, publicFloors: building.publicFloors ?? null, groundPublic: true, groundUse: building.floorUses?.[0] ?? null,
      registeredStaff: staff.length, healthyStaff: staff.filter(row => row.healthy).length, onDutyStaff: staff.filter(row => row.onDuty).length,
      healthyPromisedStaff: staff.filter(row => row.healthy && row.remainingPromisedMinutes > 0).length,
      homeCoverage: { population: residents.length, within250: homeDistances.filter(row => row.distance <= 250).length, within500: homeDistances.filter(row => row.distance <= 500).length, within1000: homeDistances.filter(row => row.distance <= 1000).length, maximum: Math.max(...homeDistances.map(row => row.distance)) },
      richHungryCurrentCoverage: { population: richHungry.length, within250: nowDistances.filter(row => row.distance <= 250).length, within500: nowDistances.filter(row => row.distance <= 500).length, within1000: nowDistances.filter(row => row.distance <= 1000).length, maximum: Math.max(...nowDistances.map(row => row.distance)) },
      nearestStationNodes: nearestStationNodes.slice(0,2), staff, homeDistances, nowDistances,
    };
  }).sort((a,b) => b.homeCoverage.within500 - a.homeCoverage.within500 || b.registeredStaff - a.registeredStaff || a.id.localeCompare(b.id));
  const currentFood = sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'food' && shop.open && shop.inventory >= 1);
  const failures = richHungry.map(citizen => {
    const choice = Reflect.get(sim, 'chooseFacility').call(sim, citizen);
    const actualAffordable = currentFood.filter(shop => citizen.money >= shop.price).map(shop => {
      const building = buildingById.get(shop.buildingId)!; const actualWalk = walk(citizen, building);
      return { shopId: shop.id, buildingId: building.id, districtId: shop.districtId, price: shop.price, inventory: shop.inventory,
        straightDistance: near(citizen.position, building.door), walkingDistance: actualWalk, minutesOnFoot: actualWalk / speed,
        advertised: shop.districtId === citizen.districtId || near(citizen.position, building.door) <= 1200,
        closesAt: building.kind === 'market' ? 22 : 20, earliestArrivalHour: sim.state.hour + actualWalk / speed / 60 };
    }).filter(row => Number.isFinite(row.walkingDistance)).sort((a,b) => a.walkingDistance - b.walkingDistance);
    const nearestCounter = candidates.map(site => ({ id: site.id, kind: site.kind, walkingDistance: site.nowDistances.find(row => row.id === citizen.id)!.distance, healthyPromisedStaff: site.healthyPromisedStaff, onDutyStaff: site.onDutyStaff })).sort((a,b) => a.walkingDistance - b.walkingDistance)[0];
    return { id: citizen.id, homeId: citizen.homeId, workId: citizen.workId, role: citizen.role, wallet: citizen.money, hunger: citizen.needs.hunger, fatigue: citizen.needs.fatigue, food: citizen.food ?? 0,
      position: citizen.position, state: citizen.state, activity: runtime.activities[citizen.id], nativeChoice: { destinationId: choice.destination.id, activity: choice.activity }, nearestFood: actualAffordable[0] ?? null,
      globalAffordableReachableShops: actualAffordable.length, advertisedAffordableShops: actualAffordable.filter(row => row.advertised).length, nearestExistingCounterCandidate: nearestCounter };
  });
  return { districtId, population: residents.length, richHungry: richHungry.length, existingPool: runtime.freight[districtId] ?? 0, existingLots: runtime.freightLots[districtId],
    existingFoodShops: sim.state.shops.filter(shop => shop.districtId === districtId && sim.shopCommodity(shop) === 'food').length,
    candidates, failures, foodDemandIdealDaily: residents.length * 1440 * .05 / 52,
    initialPoolDaysAtIdealDemand: (runtime.freight[districtId] ?? 0) / (residents.length * 1440 * .05 / 52),
  };
});
const sourceEnd = await sourceHashes(), unchanged = sim.exportSave() === before;
if (!unchanged || JSON.stringify(sourceStart) !== JSON.stringify(sourceEnd)) throw new Error('Read-only analysis modified save or immutable source');
const result = { scope: 'Read-only original 14-day final save; no ticks, new counter, money, goods, staffing, approval or modified production source', at, day, hour: sim.state.hour, weather: sim.state.weather, walkingSpeed: speed,
  saveSha256: hash(original), snapshotSourceCount: Object.keys(sourceStart).length, sourceStart, sourceEnd, unchanged, finalSaveRoundtripExact: true,
  budget: sim.publicBudgetSnapshot(), publicLabor: { standingUntilDay: runtime.publicLabor?.standingUntilDay, today: publicShift ? { id: publicShift.id, approvedAt: publicShift.approvedAt, siteId: publicShift.siteId, approvedBy: publicShift.approvedBy, cap: publicShift.cap, assignments: publicShift.assignments.length, minutesCap: publicShift.assignments[0]?.minutesCap } : null },
  officials, authorityGroups, districts };
await writeFile('artifacts/food-counter-analysis.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, sourceStart: undefined, sourceEnd: undefined, officials: undefined, authorityGroups, districts: districts.map(district => ({ ...district, failures: undefined, candidates: district.candidates.map(site => ({ ...site, staff: undefined, homeDistances: undefined, nowDistances: undefined })) })) }, null, 2));
