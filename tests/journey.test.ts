import assert from 'node:assert/strict';
import test from 'node:test';
import { planTransitJourney, planWalkingJourney, publicDepartures } from '../src/journey.ts';
import { Simulation } from '../src/simulation.ts';
import { createWorld } from '../src/world.ts';
import { getStairPosition } from '../src/access.ts';
import type { SimState, WorldDefinition } from '../src/types.ts';

const point = (x: number, y = 0, z = 0) => ({ x, y, z });
const mini: WorldDefinition = {
  seed: 1, voxelSize: .2, size: 200, mountains: [], buildings: [], spawn: point(0), river: [],
  waterfall: { top: point(0), bottom: point(0), width: 1 },
  districts: [{ id: 'town', name: '谷口', kind: 'market', center: point(0), radius: 100, color: '#ffffff', population: 0 }],
  nodes: ['A', 'B', 'C'].map((id, i) => ({ id, name: id, districtId: 'town', position: point(i * 50), station: true })),
  edges: [
    { id: 'road-ac', from: 'A', to: 'C', mode: 'road', length: 100, capacity: 20, points: [point(0), point(100)] },
    { id: 'bridge-cb', from: 'C', to: 'B', mode: 'bridge', length: 50, capacity: 20, points: [point(100), point(50)] },
    { id: 'air-shortcut', from: 'A', to: 'B', mode: 'flight', length: 1, capacity: 20, points: [point(0), point(50)] },
  ],
};

test('walking guidance follows real roads and bridges rather than a shorter aircraft route', () => {
  const origin = { ...mini.spawn }, route = planWalkingJourney(mini, origin, 'B');
  assert(route);
  assert.deepEqual(route.edgeIds, ['road-ac', 'bridge-cb']);
  assert.equal(route.metres, 150);
  assert.deepEqual(route.points.at(-1), mini.nodes[1].position);
  assert.deepEqual(origin, mini.spawn);
  assert.equal(planWalkingJourney(mini, origin, 'invented-stop'), null);
});

test('every generated district has a walking route and explicit building guidance reaches its real door', () => {
  const world = createWorld();
  for (const district of world.districts) {
    const route = planWalkingJourney(world, world.spawn, district.id);
    assert(route, district.id);
    assert(route.edgeIds.every(id => ['road', 'bridge'].includes(world.edges.find(e => e.id === id)!.mode)));
  }
  const school = world.buildings.find(b => b.kind === 'school')!, route = planWalkingJourney(world, world.spawn, school.id);
  assert(route);
  assert.deepEqual(route.points.at(-1), school.door);
});

test('upper-floor guidance includes the shared stair shaft and entrance before joining the street', () => {
  const world = createWorld(), core = world.buildings.find(b => b.id === 'core-main')!;
  const origin = getStairPosition(core, 17), route = planWalkingJourney(world, origin, 'airport');
  assert(route);
  assert.equal(route.stairsFromFloor, 17);
  assert.deepEqual(route.points[2], getStairPosition(core, 0));
  assert.deepEqual(route.points[3], core.door);
  assert.deepEqual(origin, getStairPosition(core, 17));
});

test('public timetable uses the actual direction, departure clock and current energy', () => {
  const state = { day: 0, hour: 8, energy: 100, player: { vehicleId: null, inventory: {} }, vehicles: [{ id: 'train', kind: 'flight', edgeId: 'air-shortcut', position: point(50), progress: 1, direction: -1, speed: 10, state: 'waiting', passengers: 2, cargo: 0, nextDeparture: 530 }] } as unknown as SimState;
  const row = publicDepartures(mini, state)[0];
  assert.equal(row.from.id, 'B'); assert.equal(row.to.id, 'A');
  assert.equal(row.departureAt, 530); assert.equal(row.arrivalAt, 530.1);
  assert.equal(row.passengers, 2);
  state.vehicles[0].state = 'grounded';
  const grounded = publicDepartures(mini, state)[0];
  assert.equal(grounded.departureAt, null); assert.equal(grounded.arrivalAt, null);
  assert(grounded.reason);
});

test('a departing vehicle publishes its genuine next stop without inventing a new departure', () => {
  const state = { day: 0, hour: 8, energy: 100, player: { vehicleId: null, inventory: {} }, vehicles: [{ id: 'car', kind: 'road', edgeId: 'road-ac', position: point(50), progress: .5, direction: 1, speed: 10, state: 'moving', passengers: 1, cargo: 0, nextDeparture: 475 }] } as unknown as SimState;
  const row = publicDepartures(mini, state, 'C')[0];
  assert.equal(row.departed, true); assert.equal(row.departureAt, null);
  assert.equal(row.to.id, 'C'); assert(row.arrivalAt! > 480);
  assert.equal(publicDepartures(mini, state, 'B').length, 0);
});


test('public route connects real services and transfer stops without booking or changing any actor', () => {
  const routeWorld:WorldDefinition={...mini,nodes:[{...mini.nodes[0]},{...mini.nodes[1],position:point(1000)},{...mini.nodes[2],position:point(500)}],edges:[
    {id:'road-ac',from:'A',to:'C',mode:'road',length:500,capacity:20,points:[point(0),point(500)]},
    {id:'road-cb',from:'C',to:'B',mode:'road',length:500,capacity:20,points:[point(500),point(1000)]},
    {id:'cable-ac',from:'A',to:'C',mode:'cable',length:500,capacity:20,points:[point(0),point(500)]},
    {id:'rail-cb',from:'C',to:'B',mode:'maglev',length:500,capacity:20,points:[point(500),point(1000)]},
  ]};
  const state={day:0,hour:8,energy:100,visibility:1,player:{position:point(0),vehicleId:null,inventory:{},money:100},vehicles:[
    {id:'cable',kind:'cable',edgeId:'cable-ac',position:point(0),progress:0,direction:1,speed:20,state:'waiting',nextDeparture:500,passengers:0,cargo:0},
    {id:'rail',kind:'maglev',edgeId:'rail-cb',position:point(500),progress:0,direction:1,speed:50,state:'waiting',nextDeparture:480,passengers:0,cargo:0},
  ]} as unknown as SimState;
  const before=JSON.stringify(state),plan=planTransitJourney(routeWorld,state,point(0),'B');assert(plan);
  assert.deepEqual(plan.legs.map(l=>l.mode),['cable','maglev']);assert.equal(plan.transfers,1);assert.equal(plan.fare,8);
  assert.equal(plan.approach.destination.id,'A');assert.equal(JSON.stringify(state),before);
  state.vehicles[1].state='noPower';const outage=planTransitJourney(routeWorld,state,point(0),'B');assert(outage);
  assert.deepEqual(outage.legs.map(l=>l.mode),['cable','walk']);assert.equal(outage.fare,4);
});

test('journey intentions persist exact actual targets and malformed references reject atomically', () => {
  const world=createWorld(78),sim=new Simulation(world),target=world.buildings.find(b=>b.kind==='school')!;
  const money=sim.state.player.money,position={...sim.state.player.position};
  assert.equal(sim.command({type:'planJourney',targetId:target.id,value:1}).ok,true);
  assert.equal(sim.state.journey!.targetId,target.id);assert.equal(sim.state.journey!.preference,'transit');
  assert.equal(sim.state.player.money,money);assert.deepEqual(sim.state.player.position,position);
  const save=sim.exportSave(),restored=new Simulation(world),loaded=restored.importSave(save);assert.equal(loaded.ok,true,loaded.message);assert.equal(restored.exportSave(),save);
  const bad=JSON.parse(save);bad.state.journey.lastArrival={vehicleId:sim.state.vehicles[0].id,nodeId:world.nodes[0].id,edgeId:'invented-edge',at:sim.state.extension!.lastUpdate};
  assert.equal(restored.importSave(JSON.stringify(bad)).ok,false);assert.equal(restored.exportSave(),save);
  assert.equal(sim.command({type:'cancelJourney'}).ok,true);assert.equal(sim.state.journey!.targetId,null);assert.deepEqual(sim.state.player.position,position);assert.equal(sim.state.player.money,money);
  const legacy=JSON.parse(save);delete legacy.state.journey;
  // Pre-module-manifest saves can acquire navigation; current declared modules
  // must retain their exact persisted bodies.
  delete legacy.runtime.persistedModules;
  assert.equal(restored.importSave(JSON.stringify(legacy)).ok,true);assert.equal(restored.state.journey!.status,'none');
});

test('a current save declaring journey rejects a missing intent without replacing state', () => {
  const world=createWorld(78),sim=new Simulation(world),target=world.buildings.find(b=>b.kind==='school')!;
  assert.equal(sim.command({type:'planJourney',targetId:target.id,value:1}).ok,true);
  const before=sim.exportSave(),damaged=JSON.parse(before);
  assert(damaged.runtime.persistedModules.includes('journey'));
  delete damaged.state.journey;
  assert.equal(sim.importSave(JSON.stringify(damaged)).ok,false);
  assert.equal(sim.exportSave(),before);
});

test('riding records the actual reached node before a vehicle turns and no navigation command pays fares', () => {
  const world=createWorld(79),sim=new Simulation(world),vehicle=sim.state.vehicles.find(v=>v.kind==='cable')!,edge=world.edges.find(e=>e.id===vehicle.edgeId)!,to=world.nodes.find(n=>n.id===edge.to)!;
  vehicle.progress=.999;vehicle.direction=1;vehicle.position={...to.position};vehicle.state='waiting';vehicle.nextDeparture=sim.state.day*1440+sim.state.hour*60;
  sim.state.player.position={...vehicle.position};const cash=sim.state.player.money,treasury=sim.state.treasury;
  assert.equal(sim.command({type:'planJourney',targetId:to.id,value:1}).ok,true);assert.equal(sim.state.player.money,cash);assert.equal(sim.state.treasury,treasury);
  assert.equal(sim.command({type:'ride',targetId:vehicle.id}).ok,true);assert.equal(sim.state.player.money,cash-4);assert.equal(sim.state.treasury,treasury+4);
  sim.step(.25);const observed=sim.state.journey!;
  assert.equal(observed.lastArrival?.nodeId,to.id);assert.equal(observed.lastArrival?.edgeId,edge.id);assert.equal(observed.vehicleId,vehicle.id);assert.equal(observed.status,'atStop');assert(observed.visitedStopIds.includes(to.id));
  assert.equal(sim.command({type:'leaveVehicle'}).ok,true);sim.step(.25);assert.equal(sim.state.journey!.status,'arrived');assert.equal(sim.state.player.vehicleId,null);
  const restored=new Simulation(world),result=restored.importSave(sim.exportSave());assert.equal(result.ok,true,result.message);assert.equal(restored.exportSave(),sim.exportSave());
});
