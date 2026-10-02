import { getFloorDimensions, getStairPosition } from './access';
import { getAviationPads } from './aviation';
import type { NetworkEdge, NetworkNode, SimState, TransportMode, Vec3, WorldDefinition } from './types';

export interface JourneyDestination { id: string; name: string; districtId: string; position: Vec3; nodeId: string }
export interface WalkingJourney { destination: JourneyDestination; points: Vec3[]; edgeIds: string[]; metres: number; stairsFromFloor: number | null }
export interface PublicDeparture { vehicleId: string; mode: TransportMode; from: NetworkNode; to: NetworkNode; state: string; departed: boolean; departureAt: number | null; arrivalAt: number | null; passengers: number; reason: string | null }
export interface JourneyLeg { mode: 'walk' | TransportMode; fromNodeId: string; toNodeId: string; edgeIds: string[]; points: Vec3[]; metres: number; fare: number; vehicleIds: string[] }
export interface TransitJourney { destination: JourneyDestination; legs: JourneyLeg[]; fare: number; walkingMetres: number; transfers: number; approach: WalkingJourney }
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const walkable = (e: NetworkEdge) => e.mode === 'road' || e.mode === 'bridge';
const now = (s: SimState) => s.day*1440+s.hour*60;

/** Targets are authoritative doors and stops; selecting one never moves an actor. */
export function resolveJourneyDestination(world: WorldDefinition, id: string): JourneyDestination | null {
  const building=world.buildings.find(b=>b.id===id), node=world.nodes.find(n=>n.id===id), district=world.districts.find(d=>d.id===id), pad=id.startsWith('air-pad-')?getAviationPads(world).find(p=>p.id===id):undefined;
  const target=building?.door??node?.position??pad?.position??district?.center;
  if(!target)return null;
  const roadNodes=new Set(world.edges.filter(walkable).flatMap(e=>[e.from,e.to]));
  const nearest=node&&roadNodes.has(node.id)?node:world.nodes.filter(n=>roadNodes.has(n.id)&&(!district||n.districtId===district.id)).sort((a,b)=>dist(a.position,target)-dist(b.position,target))[0];
  if(!nearest)return null;
  return {id,name:building?.name??node?.name??pad?.name??district!.name,districtId:building?.districtId??node?.districtId??pad?.districtId??district!.id,position:{...(building?.door??node?.position??pad?.position??nearest.position)},nodeId:nearest.id};
}

/** A walking line follows ground roads and bridges, including the physical door
 * and shared stair shaft when the actor starts inside an upper/basement floor. */
export function planWalkingJourney(world: WorldDefinition, from: Vec3, targetId: string): WalkingJourney | null {
  const destination=resolveJourneyDestination(world,targetId);if(!destination)return null;
  const nodes=new Map(world.nodes.map(n=>[n.id,n])),adj=new Map<string,{edge:NetworkEdge,to:string}[]>();
  for(const edge of world.edges.filter(walkable)){for(const [a,b] of [[edge.from,edge.to],[edge.to,edge.from]]){const list=adj.get(a)??[];list.push({edge,to:b});adj.set(a,list);}}
  let position=from,stairsFromFloor:number|null=null;
  const prefix:Vec3[]=[{...from}];
  const interior=world.buildings.find(b=>{const level=Math.floor((from.y-b.position.y+.01)/(b.height/b.floors)),size=getFloorDimensions(b,level);return level>=-(b.basements??0)&&level<b.floors&&Math.abs(from.x-b.position.x)<size.width/2-.3&&Math.abs(from.z-b.position.z)<size.depth/2-.3;});
  if(interior){const level=Math.floor((from.y-interior.position.y+.01)/(interior.height/interior.floors));if(level!==0){stairsFromFloor=level;prefix.push(getStairPosition(interior,level),getStairPosition(interior,0));}prefix.push({...interior.door});position=interior.door;}
  const origin=world.nodes.filter(n=>adj.has(n.id)).sort((a,b)=>dist(a.position,position)-dist(b.position,position))[0];if(!origin)return null;
  const costs=new Map([[origin.id,0]]),previous=new Map<string,{from:string,edge:NetworkEdge}>(),pending=new Set([origin.id]);
  while(pending.size){let current:string|null=null;for(const id of pending)if(current===null||costs.get(id)!<costs.get(current)!)current=id;pending.delete(current!);if(current===destination.nodeId)break;for(const item of adj.get(current!)??[]){const cost=costs.get(current!)!+item.edge.length;if(cost<(costs.get(item.to)??Infinity)){costs.set(item.to,cost);previous.set(item.to,{from:current!,edge:item.edge});pending.add(item.to);}}}
  if(!costs.has(destination.nodeId))return null;
  const legs:{from:string,edge:NetworkEdge}[]=[];let cursor=destination.nodeId;while(cursor!==origin.id){const leg=previous.get(cursor);if(!leg)return null;legs.unshift(leg);cursor=leg.from;}
  const points=[...prefix,{...origin.position}];for(const leg of legs){const path=leg.edge.from===leg.from?leg.edge.points:[...leg.edge.points].reverse();for(const p of path)if(dist(points.at(-1)!,p)>.01)points.push({...p});}
  if(dist(points.at(-1)!,destination.position)>.01)points.push({...destination.position});
  return {destination,points,edgeIds:legs.map(l=>l.edge.id),metres:points.slice(1).reduce((total,p,i)=>total+dist(points[i],p),0),stairsFromFloor};
}

/** Connections use existing track, water and air edges with actual vehicles.
 * A connection is a route suggestion; only the live board promises a current
 * vehicle's next stop and clock. Future turns and reservations remain unknown. */
export function planTransitJourney(world: WorldDefinition, state: SimState, from: Vec3, targetId: string): TransitJourney | null {
  const walking=planWalkingJourney(world,from,targetId);if(!walking)return null;
  const nodes=new Map(world.nodes.map(n=>[n.id,n])),roadNodes=new Set(world.edges.filter(walkable).flatMap(e=>[e.from,e.to]));
  const firstRoadPoint=walking.points.find(p=>world.nodes.some(n=>roadNodes.has(n.id)&&dist(p,n.position)<.01));
  const start=firstRoadPoint?world.nodes.find(n=>roadNodes.has(n.id)&&dist(n.position,firstRoadPoint)<.01):undefined;if(!start)return null;
  type Connection={edge:NetworkEdge,to:string,mode:JourneyLeg['mode'],vehicles:string[],cost:number};
  const graph=new Map<string,Connection[]>();
  for(const edge of world.edges){
    const vehicles=state.vehicles.filter(v=>v.edgeId===edge.id&&v.kind===edge.mode&&v.state!=='noPower'&&v.state!=='grounded'&&!(v.kind==='flight'&&(state.hour<6||state.hour>=23||state.visibility<.6))&&!(v.id===state.player.vehicleId&&state.player.inventory.driving===1));
    const choices:Omit<Connection,'to'>[]=[];
    if(walkable(edge))choices.push({edge,mode:'walk',vehicles:[],cost:edge.length/4.8});
    if(edge.mode!=='bridge'&&vehicles.length&&state.energy>=18){const speed=vehicles.reduce((sum,v)=>sum+v.speed,0)/vehicles.length*Math.max(.3,state.energy/100);if(speed>0)choices.push({edge,mode:edge.mode,vehicles:vehicles.map(v=>v.id),cost:edge.length/speed+(edge.mode==='flight'?75:edge.mode==='road'?8:16)});}
    for(const [a,b] of [[edge.from,edge.to],[edge.to,edge.from]])for(const choice of choices){const list=graph.get(a)??[];list.push({...choice,to:b});graph.set(a,list);}
  }
  const costs=new Map([[start.id,0]]),previous=new Map<string,{from:string,connection:Connection}>(),pending=new Set([start.id]);
  while(pending.size){let current:string|null=null;for(const id of pending)if(current===null||costs.get(id)!<costs.get(current)!)current=id;pending.delete(current!);if(current===walking.destination.nodeId)break;for(const c of graph.get(current!)??[]){const cost=costs.get(current!)!+c.cost;if(cost<(costs.get(c.to)??Infinity)){costs.set(c.to,cost);previous.set(c.to,{from:current!,connection:c});pending.add(c.to);}}}
  if(!costs.has(walking.destination.nodeId))return null;
  const route:{from:string,connection:Connection}[]=[];let cursor=walking.destination.nodeId;while(cursor!==start.id){const part=previous.get(cursor);if(!part)return null;route.unshift(part);cursor=part.from;}
  const legs:JourneyLeg[]=route.map(({from:node,connection:c})=>({mode:c.mode,fromNodeId:node,toNodeId:c.to,edgeIds:[c.edge.id],points:(c.edge.from===node?c.edge.points:[...c.edge.points].reverse()).map(p=>({...p})),metres:c.edge.length,fare:c.mode==='walk'?0:c.mode==='flight'?45:4,vehicleIds:c.vehicles}));
  const firstRide=legs.findIndex(l=>l.mode!=='walk'),boardingNodeId=firstRide<0?walking.destination.nodeId:legs[firstRide].fromNodeId;
  const approach=firstRide<0?walking:planWalkingJourney(world,from,boardingNodeId);if(!approach)return null;
  const lastNode=nodes.get(walking.destination.nodeId)!;
  if(dist(lastNode.position,walking.destination.position)>.01)legs.push({mode:'walk',fromNodeId:lastNode.id,toNodeId:lastNode.id,edgeIds:[],points:[{...lastNode.position},{...walking.destination.position}],metres:dist(lastNode.position,walking.destination.position),fare:0,vehicleIds:[]});
  const rides=legs.filter(l=>l.mode!=='walk');
  return {destination:walking.destination,legs,fare:rides.reduce((n,l)=>n+l.fare,0),walkingMetres:approach.metres+legs.slice(firstRide<0?legs.length:firstRide).filter(l=>l.mode==='walk').reduce((n,l)=>n+l.metres,0),transfers:Math.max(0,rides.length-1),approach};
}

/** Public board reads current vehicles, direction and departure clocks. It does
 * not fabricate fixed routes for buses whose subsequent turns are unknown. */
export function publicDepartures(world: WorldDefinition,state: SimState,nodeId?: string): PublicDeparture[] {
  const edges=new Map(world.edges.map(e=>[e.id,e])),nodes=new Map(world.nodes.map(n=>[n.id,n])),time=now(state);
  return state.vehicles.flatMap(v=>{const edge=edges.get(v.edgeId);if(!edge||v.kind==='bridge')return[];const from=nodes.get(v.direction>0?edge.from:edge.to),to=nodes.get(v.direction>0?edge.to:edge.from);if(!from||!to||nodeId&&from.id!==nodeId&&to.id!==nodeId)return[];
    const departed=v.state==='moving'||v.state==='congested';
    const reason=v.state==='grounded'||v.kind==='flight'&&(state.hour<6||state.hour>=23||state.visibility<.6)?'夜间或能见度限制停飞':v.state==='noPower'||state.energy<18?'等待城市供能':v.state==='redLight'?'等待合法信号':v.kind==='road'&&state.player.vehicleId===v.id&&state.player.inventory.driving===1?'由驾驶员实际操作':null;
    const departureAt=departed||reason?null:Math.max(time,v.nextDeparture);
    const remaining=edge.length*(v.direction>0?1-v.progress:v.progress),speed=v.speed*Math.max(.3,state.energy/100)*(v.kind==='road'?.8+(state.hour>=7&&state.hour<9||state.hour>=17&&state.hour<19?-.22:.1):1);
    const arrivalAt=reason||speed<=0?null:(departureAt??time)+remaining/speed;
    return [{vehicleId:v.id,mode:v.kind,from,to,state:v.state,departed,departureAt,arrivalAt,passengers:v.passengers,reason}];
  }).sort((a,b)=>(a.departureAt??a.arrivalAt??Infinity)-(b.departureAt??b.arrivalAt??Infinity)||a.vehicleId.localeCompare(b.vehicleId));
}
