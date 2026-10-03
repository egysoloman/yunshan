/**
 * Numeric walking authority extracted from frozen Yunshan commit
 * 6785ca7dcca09e8e97afd610cfd52176c7a1cfb1, src/controller.ts
 * SHA256 7889f416e9cd8ff2fb81c76eb121d2cf286a76c0a16e2ad8cf1bd2fcd1c907ab.
 * Geometry/ACL/body dimensions are unchanged. No Three, DOM, camera, tile
 * teleport, input listeners or simulator reimplementation is used here.
 */
import { getWalkHeight } from '../../src/world';
import { canAccessFloor, getFloorDimensions, getStairPosition } from '../../src/access';
import { getBuildingBody,getBuildingFloorPlan,buildingLocalPosition,buildingWorldPosition,floorPlanSupport,blocksFloorPlanMovement,getFloorPlanStairPosition,getBuildingEntrance,getFloorPlanRoofSupport,getFloorPlanSlabRegions,boundaryLoops,containsUnion,type FloorPlan,type FloorSupport } from '../../src/architecture-floor-plan';
import { blocksTransportBarrier } from '../../src/transport-geometry';
import { roadMovementAllowed } from '../../src/roads';
import { blocksMarketCounter, marketCounters, type MarketCounter } from '../../src/site-fixtures';
import type { Building, SimState, Vec3, VoxelModification, WorldDefinition } from '../../src/types';

const EYE_HEIGHT = 1.72;
const BODY_RADIUS = .35;
const clamp = (n:number, min:number, max:number) => Math.max(min,Math.min(max,n));
const distance2 = (a:Vec3,b:Vec3) => Math.hypot(a.x-b.x,a.z-b.z);
const valid = (p:Vec3) => [p.x,p.y,p.z].every(Number.isFinite);

export class HeadlessWalker {
  private feet:Vec3;
  private insideSite:Building|null=null;
  private floorIndex=0;
  private readonly marketCounters:MarketCounter[];
  private supportingSite:Building|null=null;
  private readonly canAccess:(building:Building,floor:number)=>boolean;
  private readonly modifications:()=>readonly VoxelModification[];
  private readonly roadState:()=>SimState|undefined;
  private blockedReason:string|null=null;

  constructor(readonly world:WorldDefinition,private readonly state:()=>SimState) {
    this.marketCounters=world.buildings.flatMap(building=>marketCounters(world,building));
    this.canAccess=(building,floor)=>canAccessFloor(building,floor,state().player);
    this.modifications=()=>state().voxels;
    this.roadState=()=>state();
    const position=state().player.position;
    if(!valid(position))throw new Error('Invalid trusted core player position.');
    this.feet={...position};
    this.syncFromCore();
  }
  get position():Vec3 { return {...this.feet}; }
  get walkingPosition():Vec3 { return {...this.feet}; }
  get inside():Building|null { return this.insideSite; }
  get floor():number { return this.floorIndex; }
  get blockedAccess():string|null { return this.blockedReason; }
  consumeBlockedAccess():string|null { const reason=this.blockedReason;this.blockedReason=null;return reason; }

  /** Import/ride/load synchronisation only. No caller-supplied coordinate exists. */
  syncFromCore():void {
    const position=this.state().player.position;
    if(!valid(position))throw new Error('Invalid trusted core player position.');
    this.feet={...position};this.insideSite=null;this.supportingSite=null;this.floorIndex=0;
      const room = this.world.buildings.find(building => {
        const floor = Math.round((this.feet.y - building.position.y - 0.6) / (building.height / building.floors));
        if(getBuildingBody(building)) {
          const support=floorPlanSupport(building,floor,this.feet,BODY_RADIUS)??getFloorPlanRoofSupport(building,this.feet,BODY_RADIUS);
          if(!support||Math.abs(support.y-this.feet.y)>=1.5)return false;
          this.supportingSite=building;this.floorIndex=support.floor;
          return support.kind==='room'||support.kind==='stairs';
        }
        if (floor < -(building.basements ?? 0) || floor >= building.floors) return false;
        const { width, depth } = getFloorDimensions(building, floor);
        return Math.abs(this.feet.x - building.position.x) < width / 2 - BODY_RADIUS && Math.abs(this.feet.z - building.position.z) < depth / 2 - BODY_RADIUS && Math.abs(this.feet.y - (building.position.y + 0.6 + floor * building.height / building.floors)) < 1.5;
      });
      if (room) {
        this.insideSite = room;
        if(!getBuildingBody(room))this.floorIndex = Math.round((this.feet.y - room.position.y - 0.6) / (room.height / room.floors)) || 0;
      }
  }
  private groundActionAllowed():boolean {
    const state=this.state();
    if(state.player.vehicleId||state.aviation?.activeAircraftId)return false;
    return state.extension?.actorProfiles.player?.alive!==false;
  }
  /** World-axis displacement; one call is at most the original .1s motor step.
   * Bridge frame integration must retain event intervals and subdivide long frames.
   * Simulation pause/speed do not multiply the physical 4.8/10m/s movement. */
  move(axisX:number,axisZ:number,sprint:boolean,seconds:number):void {
    if(![axisX,axisZ,seconds].every(Number.isFinite)||Math.abs(axisX)>1||Math.abs(axisZ)>1||typeof sprint!=='boolean'||seconds<0||seconds>.1||!this.groundActionAllowed())return;
    const length=Math.hypot(axisX,axisZ);if(length>1){axisX/=length;axisZ/=length;}
    const speed=sprint?10:4.8;
    this.walkTo(this.feet.x+axisX*speed*seconds,this.feet.z);
    this.walkTo(this.feet.x,this.feet.z+axisZ*speed*seconds);
  }
  /** Door use crosses only the existing opening; doors do not teleport between buildings. */
  useDoor(building: Building): boolean {
    if (!this.groundActionAllowed() || !this.world.buildings.includes(building) || distance2(this.feet, building.door) > 6) return false;
    if(getBuildingBody(building)) {
      const support=floorPlanSupport(building,0,this.feet,0),isInside=support?.kind==='room'||support?.kind==='stairs';
      if(!isInside&&!this.canAccess(building,0)){this.blockedReason=`${building.name}需要相应权限。`;return false;}
      const local=buildingLocalPosition(building,getBuildingEntrance(building));const next=buildingWorldPosition(building,{...local,z:local.z+(isInside?2:-2)});
      if(blocksFloorPlanMovement(building,0,this.feet,next,BODY_RADIUS,EYE_HEIGHT))return false;
      if(!this.mayWalkTo(next))return false;
      this.feet=next;this.floorIndex=0;this.supportingSite=isInside?null:building;this.insideSite=isInside?null:building;
      return true;
    }
    const isInside = this.contains(building, this.feet, 0);
    if (!isInside && !this.canAccess(building, 0)) { this.blockedReason = `${building.name}的核心区域需要相应权限。公共政务大厅始终开放。`; return false; }
    const z = building.door.z + (isInside ? 2 : -2);
    const next = { x: building.door.x, y: building.position.y + 0.6, z };
    if (!this.mayWalkTo(next)) return false;
    this.feet = next;
    this.floorIndex = 0;
    this.insideSite = isInside ? null : building;
    
    return true;
  }

  useStairs(): boolean {
    if (!this.groundActionAllowed() || !this.inside || this.inside.floors + (this.inside.basements ?? 0) < 2) return false;
    const b = this.inside;
    const stair = getStairPosition(b, this.floor);
    const profiled=Boolean(getBuildingBody(b));
    const relative=profiled?buildingLocalPosition(b,this.feet):this.feet,trigger=profiled?buildingLocalPosition(b,stair):stair;
    if (Math.abs(relative.x - trigger.x) > 3 || Math.abs(relative.z - trigger.z) > 5) return false;
    const floors = Array.from({ length: b.floors + (b.basements ?? 0) }, (_, index) => index - (b.basements ?? 0));
    const current = floors.indexOf(this.floor);
    const next = [...floors.slice(current + 1), ...floors.slice(0, current + 1)].find(floor => floor !== this.floor && this.canAccess(b, floor));
    if (next === undefined) { this.blockedReason = '此处其他楼层需要相应权限。'; return false; }
    this.floorIndex = next;
    const floorHeight = b.height / b.floors;
    if(profiled)this.feet=getFloorPlanStairPosition(b,this.floor);
    else this.feet.y = b.position.y + 0.6 + this.floor * floorHeight;
    
    return true;
  }
  private walkTo(x:number,z:number):void {
    const near=this.world.buildings.some(b=>{if(!getBuildingBody(b))return false;const p=buildingLocalPosition(b,{x,y:this.feet.y,z}),a=buildingLocalPosition(b,this.feet);return Math.abs(p.x)<=b.width/2+2&&Math.abs(p.z)<=b.depth/2+2||Math.abs(a.x)<=b.width/2+2&&Math.abs(a.z)<=b.depth/2+2;});
    if(!near){this.walkToLegacy(x,z);return;}
    const from={...this.feet},steps=Math.max(1,Math.ceil(Math.hypot(x-from.x,z-from.z)/.1));
    for(let i=1;i<=steps;i++)if(!this.walkFloorPlan(from.x+(x-from.x)*i/steps,from.z+(z-from.z)*i/steps))break;
  }
  /** Only an open ground slab edge may share a body's support with terrain.
   * Interior shaft holes and upper-floor voids cannot acquire terrain support.
   * Audit the actual .2m terrain columns touched by the exterior disk, then
   * test the full circle against the merged stone/terrain union. */
  private groundEdgeSupport(b:Building,plan:FloorPlan,position:Vec3,center:FloorSupport|null):FloorSupport|null {
    if(plan.floor!==0||!center||(center.kind!=='courtyard'&&center.kind!=='gallery'))return null;
    const local=buildingLocalPosition(b,position),stone=getFloorPlanSlabRegions(plan);
    const x0=Math.min(...stone.map(r=>r.x0)),x1=Math.max(...stone.map(r=>r.x1)),z0=Math.min(...stone.map(r=>r.z0)),z1=Math.max(...stone.map(r=>r.z1));
    if(Math.min(local.x-x0,x1-local.x,local.z-z0,z1-local.z)>=BODY_RADIUS)return null;
    const outside=(x:number,z:number)=>x<x0-1e-7||x>x1+1e-7||z<z0-1e-7||z>z1+1e-7;
    for(let ix=Math.floor((local.x-BODY_RADIUS)/.2);ix<=Math.floor((local.x+BODY_RADIUS)/.2);ix++)for(let iz=Math.floor((local.z-BODY_RADIUS)/.2);iz<=Math.floor((local.z+BODY_RADIUS)/.2);iz++) {
      const cx=ix*.2,cz=iz*.2;
      if(Math.max(cx-local.x,0,local.x-cx-.2)**2+Math.max(cz-local.z,0,local.z-cz-.2)**2>BODY_RADIUS**2+1e-7)continue;
      for(const [x,z] of [[cx,cz],[cx+.2,cz],[cx,cz+.2],[cx+.2,cz+.2],[cx+.1,cz+.1]])if(outside(x,z)) {
        const point=buildingWorldPosition(b,{x,y:plan.y,z}),height=getWalkHeight(this.world,point.x,point.z,center.y);
        if(!Number.isFinite(height)||Math.abs(height-center.y)>2.6+1e-7)return null;
      }
    }
    const range=.6,loX=local.x-range,hiX=local.x+range,loZ=local.z-range,hiZ=local.z+range;
    const terrain=[{x0:loX,x1:x0,z0:loZ,z1:hiZ},{x0:x1,x1:hiX,z0:loZ,z1:hiZ},{x0:loX,x1:hiX,z0:loZ,z1:z0},{x0:loX,x1:hiX,z0:z1,z1:hiZ}].filter(r=>r.x1>r.x0&&r.z1>r.z0);
    // The union remains the actual slab plus audited exterior terrain strips;
    // no rectangle is added over the interior or the real stair opening.
    for(const loop of boundaryLoops([...stone,...terrain]))for(let i=0;i<loop.length;i++) {
      const a=loop[i],to=loop[(i+1)%loop.length],dx=to[0]-a[0],dz=to[1]-a[1],t=Math.max(0,Math.min(1,((local.x-a[0])*dx+(local.z-a[1])*dz)/(dx*dx+dz*dz)));
      if((local.x-a[0]-t*dx)**2+(local.z-a[1]-t*dz)**2<BODY_RADIUS**2-1e-7)return null;
    }
    return center;
  }
  private walkFloorPlan(x:number,z:number):boolean {
    const limit=this.world.size/2-8;x=clamp(x,-limit,limit);z=clamp(z,-limit,limit);
    const candidate={x,y:this.feet.y,z};
    if(blocksMarketCounter(this.marketCounters,this.feet,candidate,BODY_RADIUS,EYE_HEIGHT)||(!this.inside&&blocksTransportBarrier(this.world,this.feet,candidate,BODY_RADIUS)))return false;
    let occupied:Building|null=null,site:Building|null=null,nextFloor=0,height=getWalkHeight(this.world,x,z,this.feet.y);
    for(const b of this.world.buildings) {
      if(!getBuildingBody(b))continue;const local=buildingLocalPosition(b,candidate),a=buildingLocalPosition(b,this.feet);
      if(Math.abs(local.x)>b.width/2+2||Math.abs(local.z)>b.depth/2+2){if(b!==this.supportingSite)continue;}
      const floor=b===this.supportingSite||b===this.inside?this.floor:Math.round((this.feet.y-b.position.y-.6)/(b.height/b.floors));
      const plan=getBuildingFloorPlan(b,floor);if(!plan)continue;
      const support=floorPlanSupport(b,floor,candidate,BODY_RADIUS),center=floorPlanSupport(b,floor,candidate,0);
      const within=containsUnion([...plan.interior,...plan.circulation,...plan.courtyard],local.x,local.z);
      // Only the real ground doorway can straddle supported road/floor edges.
      const entrance=buildingLocalPosition(b,getBuildingEntrance(b)),opening=plan.walls.find(w=>w.opening?.use==='entrance')?.opening;
      const doorEdge=floor===0&&opening&&Math.abs(local.z-entrance.z)<=BODY_RADIUS+.21&&Math.abs(local.x-entrance.x)<(opening.to-opening.from)/2-BODY_RADIUS;
      const roof=getFloorPlanRoofSupport(b,candidate,BODY_RADIUS);
      const actual=support??(doorEdge?center:null)??this.groundEdgeSupport(b,plan,candidate,center)??roof;
      if(within&&!actual&&Math.abs(local.y-plan.y)<b.height/b.floors)return false;
      const targetHeight=actual?.y??height;
      if(blocksFloorPlanMovement(b,floor,this.feet,{...candidate,y:targetHeight},BODY_RADIUS,EYE_HEIGHT))return false;
      if(b===this.supportingSite&&this.floor!==0&&!actual)return false;
      if(actual) {
        if(actual.link&&actual.y>b.position.y+.6+getBuildingFloorPlan(b,actual.link.fromFloor)!.y+.01&&!this.canAccess(b,actual.link.toFloor)){this.blockedReason=`${b.name}的楼梯目标层需要相应权限。`;return false;}
        if((actual.kind==='room'||actual.kind==='stairs')&&!this.canAccess(b,actual.floor)){this.blockedReason=`${b.name}需要相应权限。`;return false;}
        const outdoor=actual.kind==='roof'||actual.kind==='courtyard'||actual.kind==='gallery';
        if(Math.abs(actual.y-this.feet.y)>(outdoor?2.6:.42))return false;
        site=b;nextFloor=actual.floor;height=actual.y;if(actual.kind==='room'||actual.kind==='stairs')occupied=b;
      }
      // A crossing at another elevation must not invent access to this floor.
      if(!actual&&Math.abs(a.y-plan.y)>1.5)continue;
    }
    // Preserve existing buildings' wall/permission rules alongside v4 sites.
    for(const b of this.world.buildings)if(!getBuildingBody(b)&&b.kind!=='pavilion') {
      if(Math.abs(x-b.position.x)>b.width/2+1||Math.abs(z-b.position.z)>b.depth/2+1)continue;
      const level=b.id===this.inside?.id?this.floor:0,{width,depth}=getFloorDimensions(b,level),was=this.contains(b,this.feet,BODY_RADIUS),now=this.contains(b,candidate,BODY_RADIUS),opening=Math.abs(x-b.door.x)<Math.max(1.5,Math.min(2.7,b.width*.1));
      if(Math.abs(Math.abs(x-b.position.x)-width/2)<.7||Math.abs(z-(b.position.z-depth/2))<.7||(Math.abs(z-(b.position.z+depth/2))<1&&!opening)||(was!==now&&!opening)||(this.floor!==0&&was!==now))return false;
      if(now){if(!this.canAccess(b,level))return false;occupied=b;nextFloor=level;height=b.position.y+.6+level*b.height/b.floors;site=null;}
    }
    for(const block of this.modifications()){const p=block.position,top=p.y+.2;if(Math.abs(x-p.x)<.1+BODY_RADIUS&&Math.abs(z-p.z)<.1+BODY_RADIUS&&top>height&&top<=this.feet.y+.4+1e-7)height=top;}
    for(const block of this.modifications()){const p=block.position;if(Math.abs(x-p.x)<.1+BODY_RADIUS&&Math.abs(z-p.z)<.1+BODY_RADIUS&&p.y<height+EYE_HEIGHT&&p.y+.2>height+.01)return false;}
    if(!occupied&&!site&&Math.abs(height-this.feet.y)>2.6)return false;
    if(!this.mayWalkTo({x,y:height,z}))return false;
    this.feet={x,y:height,z};this.insideSite=occupied;this.supportingSite=site;this.floorIndex=nextFloor;return true;
  }
  private walkToLegacy(x: number, z: number): void {
    const limit = this.world.size / 2 - 8;
    x = clamp(x, -limit, limit);
    z = clamp(z, -limit, limit);
    const candidate = { x, y: this.feet.y, z };
    if (blocksMarketCounter(this.marketCounters, this.feet, candidate, BODY_RADIUS, EYE_HEIGHT)) return;
    if (!this.inside && blocksTransportBarrier(this.world, this.feet, candidate, BODY_RADIUS)) return;
    for (const b of this.world.buildings) {
      if (b.kind === 'pavilion'||getBuildingBody(b)) continue;
      if (Math.abs(x - b.position.x) > b.width / 2 + 1 || Math.abs(z - b.position.z) > b.depth / 2 + 1) continue;
      const level = b.id === this.inside?.id ? this.floor : 0;
      const { width, depth } = getFloorDimensions(b, level);
      const wasInside = this.contains(b, this.feet, BODY_RADIUS);
      const nowInside = this.contains(b, candidate, BODY_RADIUS);
      const opening = Math.abs(x - b.door.x) < Math.max(1.5, Math.min(2.7, b.width * 0.1));
      const southWall = Math.abs(z - (b.position.z + depth / 2)) < 1;
      const otherWall = Math.abs(Math.abs(x - b.position.x) - width / 2) < 0.7 || Math.abs(z - (b.position.z - depth / 2)) < 0.7;
      if (otherWall || (southWall && !opening) || (wasInside !== nowInside && !opening)) return;
      if (this.floor !== 0 && wasInside !== nowInside) return;
    }
    const building = this.world.buildings.find(b => !getBuildingBody(b)&&this.contains(b, candidate, BODY_RADIUS));
    if (building && !this.canAccess(building, building.id === this.inside?.id ? this.floor : 0)) { this.blockedReason = `${building.name}需要相应权限。`; return; }
    const nextFloor = building?.id === this.inside?.id ? this.floor : 0;
    let height = building ? building.position.y + 0.6 + nextFloor * building.height / building.floors : getWalkHeight(this.world, x, z, this.feet.y);
    const blocks = this.modifications();
    // Small steps can support the body. Taller stacks and head-height cubes are solid.
    for (const block of blocks) {
      const p = block.position, top = p.y + 0.2;
      if (Math.abs(x - p.x) < 0.1 + BODY_RADIUS && Math.abs(z - p.z) < 0.1 + BODY_RADIUS && top > height && top <= this.feet.y + 0.4 + 1e-7) height = top;
    }
    for (const block of blocks) {
      const p = block.position;
      if (Math.abs(x - p.x) < 0.1 + BODY_RADIUS && Math.abs(z - p.z) < 0.1 + BODY_RADIUS && p.y < height + EYE_HEIGHT && p.y + 0.2 > height + 0.01) return;
    }
    // Crossing mountain cliffs requires the road, lift or cableway.
    if (Math.abs(height - this.feet.y) > 2.6 && !building) return;
    if (!this.mayWalkTo({ x, y: height, z })) return;
    this.floorIndex = nextFloor;
    this.insideSite = building ?? null;
    this.feet = { x, y: height, z };
  }

  private mayWalkTo(to:Vec3):boolean {
    const state=this.roadState();
    if(!state||roadMovementAllowed(this.world,state,'player',this.feet,to))return true;
    this.blockedReason='道路已关闭；请等待通行，已在封闭路段内的行人须沿许可方向退出。';
    return false;
  }

  private contains(b: Building, p: Vec3, margin: number): boolean {
    const level = b.id === this.inside?.id ? this.floor : 0;
    if(getBuildingBody(b)){const s=floorPlanSupport(b,level,p,margin);return s?.kind==='room'||s?.kind==='stairs';}
    const { width, depth } = getFloorDimensions(b, level);
    return Math.abs(p.x - b.position.x) < width / 2 - margin && Math.abs(p.z - b.position.z) < depth / 2 - margin;
  }
}
