import { getFloorDimensions, getStairPosition } from './access';
import { getAviationPads } from './aviation';
import { getWalkHeight } from './world';
import { blocksTransportBarrier } from './transport-geometry';
import { blocksMarketCounter, marketCounters, type MarketCounter } from './site-fixtures';
import type { NetworkEdge, NetworkNode, SimState, TransportMode, Vec3, WorldDefinition } from './types';

export interface JourneyDestination { id: string; name: string; districtId: string; position: Vec3; nodeId: string }
export interface WalkingJourney { destination: JourneyDestination; points: Vec3[]; edgeIds: string[]; metres: number; stairsFromFloor: number | null; originNodeId: string }
export interface PublicDeparture { vehicleId: string; mode: TransportMode; from: NetworkNode; to: NetworkNode; state: string; departed: boolean; departureAt: number | null; arrivalAt: number | null; passengers: number; reason: string | null }
export interface JourneyLeg { mode: 'walk' | TransportMode; fromNodeId: string; toNodeId: string; edgeIds: string[]; points: Vec3[]; metres: number; fare: number; vehicleIds: string[] }
export interface TransitJourney { destination: JourneyDestination; legs: JourneyLeg[]; fare: number; walkingMetres: number; transfers: number; approach: WalkingJourney }
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const walkable = (e: NetworkEdge) => e.mode === 'road' || e.mode === 'bridge';
const now = (s: SimState) => s.day*1440+s.hour*60;

interface Access { nodeId: string; points: Vec3[]; edgeIds: string[]; metres: number }
interface Projection { edge: NetworkEdge; index: number; point: Vec3; horizontal: number; along: number; total: number }
interface WalkingAccess { anchors: Access[]; stairsFromFloor: number | null }
const append = (points: Vec3[], point: Vec3) => { if (!points.length || dist(points.at(-1)!,point)>.01) points.push({...point}); };
const metres = (points: Vec3[]) => points.slice(1).reduce((sum,p,index)=>sum+dist(points[index],p),0);
const counterCache = new WeakMap<WorldDefinition, readonly MarketCounter[]>();
function worldCounters(world: WorldDefinition): readonly MarketCounter[] {
  let counters=counterCache.get(world);
  if(!counters){counters=world.buildings.flatMap(building=>marketCounters(world,building));counterCache.set(world,counters);}
  return counters;
}

/** A short sideways connection is sampled against the same floors, road heights,
 * cliff limit, market counters and transport barriers that the walking body consumes. It may not
 * cut through another building or wade across the river to reach a nearby deck. */
function canJoinRoad(world: WorldDefinition, from: Vec3, to: Vec3): boolean {
  let feet={...from}; const distance=Math.hypot(to.x-from.x,to.z-from.z),steps=Math.max(1,Math.ceil(distance/.2));
  if(distance>64)return false;
  const counters=worldCounters(world);
  const contains=(b:WorldDefinition['buildings'][number],p:Vec3)=>{const size=getFloorDimensions(b,0);return Math.abs(p.x-b.position.x)<size.width/2-.35&&Math.abs(p.z-b.position.z)<size.depth/2-.35;};
  const move=(x:number,z:number):boolean=>{
    const candidate={x,y:feet.y,z};
    if(blocksMarketCounter(counters,feet,candidate,.35,1.72)||blocksTransportBarrier(world,feet,candidate,.35))return false;
    for(const b of world.buildings){
      if(b.kind==='pavilion'||Math.abs(x-b.position.x)>b.width/2+1||Math.abs(z-b.position.z)>b.depth/2+1)continue;
      const size=getFloorDimensions(b,0),opening=Math.abs(x-b.door.x)<Math.max(1.5,Math.min(2.7,b.width*.1));
      const south=Math.abs(z-(b.position.z+size.depth/2))<1,other=Math.abs(Math.abs(x-b.position.x)-size.width/2)<.7||Math.abs(z-(b.position.z-size.depth/2))<.7;
      if(other||south&&!opening||contains(b,feet)!==contains(b,candidate)&&!opening||contains(b,candidate))return false;
    }
    const height=getWalkHeight(world,x,z,feet.y);if(!Number.isFinite(height)||Math.abs(height-feet.y)>2.6)return false;
    for(let i=1;i<world.river.length;i++){
      const a=world.river[i-1],b=world.river[i],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));
      if(Math.hypot(x-a.x-dx*t,z-a.z-dz*t)<15&&height<a.y+(b.y-a.y)*t+.2)return false;
    }
    feet={x,y:height,z};return true;
  };
  for(let i=1;i<=steps;i++){const x=from.x+(to.x-from.x)*i/steps,z=from.z+(to.z-from.z)*i/steps;if(!move(x,feet.z)||!move(feet.x,z))return false;}
  return Math.abs(feet.y-to.y)<.26;
}

/** The actor joins the actual occupied road layer at a polyline projection.
 * Both endpoints retain the remaining physical segment before graph search. */
function walkingAccess(world: WorldDefinition, from: Vec3): WalkingAccess | null {
  const roadEdges=world.edges.filter(walkable),nodeMap=new Map(world.nodes.map(n=>[n.id,n]));
  const prefix:Vec3[]=[{...from}];let position=from,stairsFromFloor:number|null=null;
  const interior=world.buildings.find(b=>{const level=Math.round((from.y-b.position.y-.6)/(b.height/b.floors)),size=getFloorDimensions(b,level);return level>=-(b.basements??0)&&level<b.floors&&Math.abs(from.y-(b.position.y+.6+level*b.height/b.floors))<1.5&&Math.abs(from.x-b.position.x)<size.width/2-.35&&Math.abs(from.z-b.position.z)<size.depth/2-.35;});
  if(interior){
    const level=Math.round((from.y-interior.position.y-.6)/(interior.height/interior.floors));
    if(level!==0){stairsFromFloor=level;prefix.push(getStairPosition(interior,level),getStairPosition(interior,0));}
    append(prefix,interior.door);position=interior.door;
    const doorNode=world.nodes.find(n=>dist(n.position,position)<.01&&roadEdges.some(e=>e.from===n.id||e.to===n.id));
    if(doorNode)return {anchors:[{nodeId:doorNode.id,points:prefix,edgeIds:[],metres:metres(prefix)}],stairsFromFloor};
  }
  const projections:Projection[]=[];
  for(const edge of roadEdges){
    let along=0;const total=metres(edge.points);
    for(let index=1;index<edge.points.length;index++){
      const a=edge.points[index-1],b=edge.points[index],dx=b.x-a.x,dz=b.z-a.z,length=dist(a,b),t=Math.max(0,Math.min(1,((position.x-a.x)*dx+(position.z-a.z)*dz)/(dx*dx+dz*dz||1)));
      const point={x:a.x+dx*t,y:a.y+(b.y-a.y)*t,z:a.z+dz*t},horizontal=Math.hypot(position.x-point.x,position.z-point.z);
      if(horizontal<=64)projections.push({edge,index,point,horizontal,along:along+length*t,total});along+=length;
    }
  }
  const surface=getWalkHeight(world,position.x,position.z,position.y);
  const occupied=projections.filter(p=>p.horizontal<=(p.edge.id.includes('airport-runway-strip')?22:p.edge.mode==='bridge'?4:5)&&Math.abs(p.point.y-surface)<1e-5);
  const candidates=(occupied.length?occupied:projections).sort((a,b)=>(a.horizontal+Math.abs(a.point.y-position.y)*2)-(b.horizontal+Math.abs(b.point.y-position.y)*2));
  const projection=candidates.find(p=>canJoinRoad(world,position,p.point));if(!projection)return null;
  const anchors:Access[]=[];
  for(const forward of [false,true]){
    const nodeId=forward?projection.edge.to:projection.edge.from,node=nodeMap.get(nodeId);if(!node)continue;
    const points=prefix.map(p=>({...p}));append(points,projection.point);
    const path=forward?projection.edge.points.slice(projection.index):projection.edge.points.slice(0,projection.index).reverse();for(const p of path)append(points,p);append(points,node.position);
    const remaining=forward?projection.total-projection.along:projection.along;
    anchors.push({nodeId,points,edgeIds:remaining>.01?[projection.edge.id]:[],metres:metres(points)});
  }
  return anchors.length?{anchors,stairsFromFloor}:null;
}

interface Connection { edge: NetworkEdge; to: string; mode: JourneyLeg['mode']; vehicles: string[]; cost: number }
function search(anchors:Access[],graph:Map<string,Connection[]>,target:string,seconds=false):{anchor:Access;route:{from:string;connection:Connection}[]}|null {
  const roots=new Map<string,Access>(),costs=new Map<string,number>(),previous=new Map<string,{from:string;connection:Connection}>(),pending=new Set<string>();
  for(const anchor of anchors){const cost=anchor.metres/(seconds?4.8:1);if(cost<(costs.get(anchor.nodeId)??Infinity)){roots.set(anchor.nodeId,anchor);costs.set(anchor.nodeId,cost);pending.add(anchor.nodeId);}}
  while(pending.size){let current:string|null=null;for(const id of pending)if(current===null||costs.get(id)!<costs.get(current)!)current=id;pending.delete(current!);if(current===target)break;for(const c of graph.get(current!)??[]){const cost=costs.get(current!)!+c.cost;if(cost<(costs.get(c.to)??Infinity)){costs.set(c.to,cost);previous.set(c.to,{from:current!,connection:c});pending.add(c.to);}}}
  if(!costs.has(target))return null;const route:{from:string;connection:Connection}[]=[];let cursor=target;
  while(previous.has(cursor)){const leg=previous.get(cursor)!;route.unshift(leg);cursor=leg.from;}
  const anchor=roots.get(cursor);return anchor?{anchor,route}:null;
}

function walkingPlan(destination:JourneyDestination,access:WalkingAccess,found:{anchor:Access;route:{from:string;connection:Connection}[]}):WalkingJourney {
  const points=found.anchor.points.map(p=>({...p})),edgeIds=[...found.anchor.edgeIds];
  for(const {from,connection:c}of found.route){for(const p of c.edge.from===from?c.edge.points:[...c.edge.points].reverse())append(points,p);edgeIds.push(c.edge.id);}
  append(points,destination.position);return {destination,points,edgeIds,metres:metres(points),stairsFromFloor:access.stairsFromFloor,originNodeId:found.anchor.nodeId};
}

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
  const destination=resolveJourneyDestination(world,targetId),access=walkingAccess(world,from);if(!destination||!access)return null;
  const graph=new Map<string,Connection[]>();
  for(const edge of world.edges.filter(walkable))for(const [a,b]of [[edge.from,edge.to],[edge.to,edge.from]]){const list=graph.get(a)??[];list.push({edge,to:b,mode:'walk',vehicles:[],cost:edge.length});graph.set(a,list);}
  const found=search(access.anchors,graph,destination.nodeId);return found?walkingPlan(destination,access,found):null;
}

/** Connections use existing track, water and air edges with actual vehicles.
 * A connection is a route suggestion; only the live board promises a current
 * vehicle's next stop and clock. Future turns and reservations remain unknown. */
export function planTransitJourney(world: WorldDefinition, state: SimState, from: Vec3, targetId: string): TransitJourney | null {
  const destination=resolveJourneyDestination(world,targetId),access=walkingAccess(world,from);if(!destination||!access)return null;
  const nodes=new Map(world.nodes.map(n=>[n.id,n]));
  const graph=new Map<string,Connection[]>();
  for(const edge of world.edges){
    const vehicles=state.vehicles.filter(v=>v.edgeId===edge.id&&v.kind===edge.mode&&v.state!=='noPower'&&v.state!=='grounded'&&!(v.kind==='flight'&&(state.hour<6||state.hour>=23||state.visibility<.6))&&!(v.id===state.player.vehicleId&&state.player.inventory.driving===1));
    const choices:Omit<Connection,'to'>[]=[];
    if(walkable(edge))choices.push({edge,mode:'walk',vehicles:[],cost:edge.length/4.8});
    if(edge.mode!=='bridge'&&vehicles.length&&state.energy>=18){const speed=vehicles.reduce((sum,v)=>sum+v.speed,0)/vehicles.length*Math.max(.3,state.energy/100);if(speed>0)choices.push({edge,mode:edge.mode,vehicles:vehicles.map(v=>v.id),cost:edge.length/speed+(edge.mode==='flight'?75:edge.mode==='road'?8:16)});}
    for(const [a,b] of [[edge.from,edge.to],[edge.to,edge.from]])for(const choice of choices){const list=graph.get(a)??[];list.push({...choice,to:b});graph.set(a,list);}
  }
  const found=search(access.anchors,graph,destination.nodeId,true);if(!found)return null;const {route}=found;
  const legs:JourneyLeg[]=route.map(({from:node,connection:c})=>({mode:c.mode,fromNodeId:node,toNodeId:c.to,edgeIds:[c.edge.id],points:(c.edge.from===node?c.edge.points:[...c.edge.points].reverse()).map(p=>({...p})),metres:c.edge.length,fare:c.mode==='walk'?0:c.mode==='flight'?45:4,vehicleIds:c.vehicles}));
  const firstRide=legs.findIndex(l=>l.mode!=='walk'),boardingNodeId=firstRide<0?destination.nodeId:legs[firstRide].fromNodeId;
  const boarding=nodes.get(boardingNodeId)!;
  const approach=walkingPlan(firstRide<0?destination:{id:boarding.id,name:boarding.name,districtId:boarding.districtId,position:{...boarding.position},nodeId:boarding.id},access,{anchor:found.anchor,route:route.slice(0,firstRide<0?route.length:firstRide)});
  const lastNode=nodes.get(destination.nodeId)!;
  if(dist(lastNode.position,destination.position)>.01)legs.push({mode:'walk',fromNodeId:lastNode.id,toNodeId:lastNode.id,edgeIds:[],points:[{...lastNode.position},{...destination.position}],metres:dist(lastNode.position,destination.position),fare:0,vehicleIds:[]});
  const rides=legs.filter(l=>l.mode!=='walk');
  return {destination,legs,fare:rides.reduce((n,l)=>n+l.fare,0),walkingMetres:approach.metres+legs.slice(firstRide<0?legs.length:firstRide).filter(l=>l.mode==='walk').reduce((n,l)=>n+l.metres,0),transfers:Math.max(0,rides.length-1),approach};
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
