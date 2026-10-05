import type { Simulation } from '../simulation';
import { resolveJourneyDestination } from '../journey';
import type { SimState } from '../types';

export interface JourneyState {
  version: 1; targetId: string | null; preference: 'walk' | 'transit';
  startedAt: number | null; arrivedAt: number | null;
  status: 'none' | 'walking' | 'riding' | 'atStop' | 'arrived';
  vehicleId: string | null; nextStopNodeId: string | null; visitedStopIds: string[];
  lastArrival?: { vehicleId: string; nodeId: string; edgeId: string; at: number } | null;
}
const installed = new WeakSet<Simulation>();
const empty = (): JourneyState => ({ version: 1, targetId: null, preference: 'walk', startedAt: null, arrivedAt: null, status: 'none', vehicleId: null, nextStopNodeId: null, visitedStopIds: [], lastArrival: null });

/** Persist intentions and observations; the existing ride and leave commands
 * retain all authority over fares, bodies, vehicles and legal stopping points. */
export function installJourneys(simulation: Simulation): void {
  if (installed.has(simulation)) return;
  installed.add(simulation);
  const world=simulation.worldDefinition, clock=()=>simulation.state.extension?.lastUpdate??simulation.state.day*1440+simulation.state.hour*60;
  simulation.state.journey=empty();
  simulation.registerCommandHandler(command=>{
    if(command.type!=='planJourney'&&command.type!=='cancelJourney')return null;
    if(command.type==='cancelJourney'){simulation.state.journey=empty();return {ok:true,message:'已取消导航；人物仍在实际所在位置。'};}
    if(typeof command.targetId!=='string'||!resolveJourneyDestination(world,command.targetId)||command.value!==undefined&&command.value!==0&&command.value!==1)return {ok:false,message:'请选择城市中真实入口或停靠点，出行方式为步行或公共交通。'};
    const preference=command.value===1?'transit':'walk';
    simulation.state.journey={...empty(),targetId:command.targetId,preference,startedAt:clock(),status:'walking'};
    return {ok:true,message:preference==='transit'?'已记录公共交通目的地，请按真实班次到站购票；到站下车后可继续换乘。':'已记录步行目的地，导航沿真实道路与桥面到达入口。'};
  });
  simulation.onEvent('vehicle-arrived',event=>{
    const journey=simulation.state.journey;
    if(!journey?.targetId||event.vehicleId!==simulation.state.player.vehicleId||!event.nodeId||!event.fromEdgeId||event.arrivedAt===undefined)return;
    journey.lastArrival={vehicleId:event.vehicleId,nodeId:event.nodeId,edgeId:event.fromEdgeId,at:event.arrivedAt};
    if(!journey.visitedStopIds.includes(event.nodeId)){journey.visitedStopIds.push(event.nodeId);if(journey.visitedStopIds.length>64)journey.visitedStopIds.shift();}
  });
  simulation.onPhase('traffic',state=>{
    const journey=state.journey;if(!journey?.targetId)return;
    const target=resolveJourneyDestination(world,journey.targetId);if(!target)return;
    const vehicle=state.vehicles.find(v=>v.id===state.player.vehicleId);
    journey.vehicleId=vehicle?.id??null;
    if(vehicle){
      const edge=world.edges.find(e=>e.id===vehicle.edgeId)!;
      journey.nextStopNodeId=vehicle.direction>0?edge.to:edge.from;
      const stop=vehicle.progress===0?edge.from:vehicle.progress===1?edge.to:null;
      if(stop&&vehicle.state!=='moving'){
        journey.status='atStop';
        if(!journey.visitedStopIds.includes(stop)){journey.visitedStopIds.push(stop);if(journey.visitedStopIds.length>64)journey.visitedStopIds.shift();}
      }else journey.status='riding';
      return;
    }
    journey.nextStopNodeId=null;
    const p=state.player.position,t=target.position;
    if(Math.hypot(p.x-t.x,p.y-t.y,p.z-t.z)<8){journey.status='arrived';journey.arrivedAt??=clock();}
    else journey.status='walking';
  });
  simulation.registerSaveValidator((candidate:SimState)=>{
    const j=candidate.journey;if(j===undefined)return;
    const validTime=(n:unknown)=>n===null||typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e12;
    const ids=new Set(world.nodes.map(n=>n.id));
    const arrival=j.lastArrival;
    if(arrival!==undefined&&arrival!==null&&(!candidate.vehicles.some(v=>v.id===arrival.vehicleId)||!ids.has(arrival.nodeId)||!world.edges.some(e=>e.id===arrival.edgeId&&(e.from===arrival.nodeId||e.to===arrival.nodeId))||!validTime(arrival.at)||arrival.at===null||j.startedAt===null||arrival.at<j.startedAt))throw Error('无效出行存档：实际到站回执。');
    if(j.version!==1||j.targetId!==null&&(typeof j.targetId!=='string'||!resolveJourneyDestination(world,j.targetId))||!['walk','transit'].includes(j.preference)||!['none','walking','riding','atStop','arrived'].includes(j.status)||!validTime(j.startedAt)||!validTime(j.arrivedAt)||j.arrivedAt!==null&&(j.startedAt===null||j.arrivedAt<j.startedAt)||j.vehicleId!==null&&!candidate.vehicles.some(v=>v.id===j.vehicleId)||j.nextStopNodeId!==null&&!ids.has(j.nextStopNodeId)||!Array.isArray(j.visitedStopIds)||j.visitedStopIds.length>64||new Set(j.visitedStopIds).size!==j.visitedStopIds.length||j.visitedStopIds.some(id=>!ids.has(id))||j.targetId===null&&(j.status!=='none'||j.startedAt!==null||j.arrivedAt!==null||j.vehicleId!==null||j.nextStopNodeId!==null||j.visitedStopIds.length!==0)||j.targetId!==null&&j.startedAt===null)throw Error('无效出行存档：目的地、时间、站点或载具记录。');
  });
  simulation.onLoad(()=>{simulation.state.journey??=empty();simulation.state.journey.lastArrival??=null;});
}
