import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import { blocksFloorPlanMovement, buildingLocalPosition, buildingWorldPosition, contains, containsUnion, floorPlanSupport, getBuildingBody, getBuildingEntrance, getBuildingFloorPlan, getBuildingUsePoints, getFloorPlanRoofRegions, getFloorPlanRoofSupport, getFloorPlanSlabRegions, wallPanels } from '../src/architecture-floor-plan';

test('new v4 body alone declares actual shared doors, unique programme aliases, holes, thin treads and usable fixtures',()=>{
  const world=createWorld(20261001,'current-v4'),marked=world.buildings.filter(b=>getBuildingBody(b));assert(marked.length>500);
  for(const b of marked){
    const body=getBuildingBody(b)!,ids=new Set<string>(),door=getBuildingEntrance(b);assert(Math.hypot(door.x-b.door.x,door.y-b.door.y,door.z-b.door.z)<1e-7,'world door quantization and the provider describe the same physical opening');
    for(const p of body.floorPlans){
      assert(p.walls.every(w=>w.height>=2.8),'each real storey retains standing headroom');
      for(const point of getBuildingUsePoints(b,p.floor)){assert(!ids.has(point.id),'programme ids are unique across floors and aliases');ids.add(point.id);const support=floorPlanSupport(b,p.floor,point.position);assert(support&&support.kind==='room',`${b.id}/${point.id} must be a physically supported room point`);}
      for(const tread of [...p.stairTreads,...p.stairLandings]){assert(Math.abs(tread.top-tread.bottom-.2)<1e-7);for(const value of [tread.rect.x0,tread.rect.x1,tread.rect.z0,tread.rect.z1,tread.top])assert(Math.abs(value*5-Math.round(value*5))<1e-7);assert(tread.rect.x0>=p.broadphase.x0-1e-7&&tread.rect.x1<=p.broadphase.x1+1e-7&&tread.rect.z0>=p.broadphase.z0-1e-7&&tread.rect.z1<=p.broadphase.z1+1e-7,'stairs fit the original envelope');}
      if(p.stairHole){const hole=p.stairHole,x=(hole.x0+hole.x1)/2,z=(hole.z0+hole.z1)/2;assert(!containsUnion(getFloorPlanSlabRegions(p),x,z),'shaft void cannot be covered by a fake rectangular slab');assert(containsUnion(getFloorPlanSlabRegions(p),p.stair.x,p.stair.z),'true shaft platform remains supported');}
      if(b.kind==='market'&&p.floor===0)assert.equal(p.fixtures.filter(f=>f.kind==='counter').length,3);
    }
  }
  const old=createWorld(20261001,'current-v3');for(const b of old.buildings)assert.equal(getBuildingBody(b),null,'unmarked prior world stays on its original access branch');
});

test('glass panes are physical barriers while declared door openings allow a .35m body',()=>{
  const b=createWorld(7,'current-v4').buildings.find(b=>b.kind==='market')!,p=getBuildingFloorPlan(b,0)!,door=buildingLocalPosition(b,getBuildingEntrance(b));
  assert.equal(blocksFloorPlanMovement(b,0,buildingWorldPosition(b,{x:door.x,y:0,z:door.z+.5}),buildingWorldPosition(b,{x:door.x,y:0,z:door.z-.5})),false);
  const glass=wallPanels(p).find(panel=>panel.kind==='glass'&&(panel.rect.x1-panel.rect.x0<.4||panel.rect.z1-panel.rect.z0<.4));assert(glass);
  const x=(glass.rect.x0+glass.rect.x1)/2,z=(glass.rect.z0+glass.rect.z1)/2,thinX=glass.rect.x1-glass.rect.x0<.4;
  const a=buildingWorldPosition(b,{x:x+(thinX?-.8:0),y:0,z:z+(thinX?0:-.8)}),to=buildingWorldPosition(b,{x:x+(thinX?.8:0),y:0,z:z+(thinX?0:.8)});
  assert.equal(blocksFloorPlanMovement(b,0,a,to),true,'a visible sealed window cannot be used as a door');
});

test('exposed gables share precise ray and body roof support and cannot collide with a body already standing above them',()=>{
  const b=createWorld(20261001,'current-v4').buildings.find(b=>b.id==='river-b0')!,body=getBuildingBody(b)!;
  const roof=getFloorPlanRoofRegions(body).find(r=>r.kind==='gable'&&r.floor===0);assert(roof);
  const point=buildingWorldPosition(b,{x:(roof.rect.x0+roof.rect.x1)/2,y:roof.top,z:(roof.rect.z0+roof.rect.z1)/2});
  const support=getFloorPlanRoofSupport(b,point,0);assert(support);assert(Math.abs(support.y-point.y)<1e-7);assert.equal(support.kind,'roof');
  const below={...point,y:point.y-.4};assert.equal(blocksFloorPlanMovement(b,0,below,{...below,x:below.x+.05}),true);
  assert.equal(blocksFloorPlanMovement(b,0,point,{...point,x:point.x+.01}),false);
  const worldPoint=buildingWorldPosition(b,buildingLocalPosition(b,point));assert(Math.hypot(worldPoint.x-point.x,worldPoint.y-point.y,worldPoint.z-point.z)<1e-9);
  assert(contains(roof.rect,buildingLocalPosition(b,point).x,buildingLocalPosition(b,point).z));
});
