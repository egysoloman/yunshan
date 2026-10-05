import {Simulation} from '/tmp/yunshan-phase3-root-coherent-05/src/simulation.ts';
import {createWorld} from '/tmp/yunshan-phase3-root-coherent-05/src/world.ts';
import {makeBody,containsUnion,wallCollisionBoxes,localPosition} from '/tmp/yunshan-architecture-prototype-02/prototype/floor-plan.ts';
import {writeFileSync} from 'node:fs';
const world=createWorld(20261001,'current-v3');const b=world.buildings.find(b=>b.kind==='market')!;b.floorPlanProfile='v4-program-bodies-02';
const plan=makeBody(b,'v4-wings').floorPlans.find(p=>p.floor===0)!;
const court=plan.courtyard.map(r=>({x:(r.x0+r.x1)/2,z:(r.z0+r.z1)/2})).find(p=>!containsUnion(plan.interior,p.x,p.z)&&!containsUnion(plan.circulation,p.x,p.z))!;
const c=Math.cos(b.rotation),s=Math.sin(b.rotation);const point={x:b.position.x+court.x*c+court.z*s,y:b.position.y+.6,z:b.position.z-court.x*s+court.z*c};
const sim=new Simulation(world);const current=sim.isNearBuilding(b,point,0);
const npc=sim.state.citizens.find(p=>p.workId===b.id&&p.role!=='学生')!;
const r=(sim as any).runtime;r.activities[npc.id]='work';(sim as any).setDestination(npc,b,true);
const walls=wallCollisionBoxes(plan).filter(w=>w.bottom<1.72&&w.top>.05);const crossings:any[]=[];
for(let i=1;i<npc.route!.length;i++){const a=npc.route![i-1],z=npc.route![i];if(Math.abs(a.y-(b.position.y+.6))>1e-5||Math.abs(z.y-a.y)>1e-5)continue;for(let n=0;n<=100;n++){const t=n/100,p=localPosition(b,{x:a.x+(z.x-a.x)*t,y:a.y,z:a.z+(z.z-a.z)*t});const wall=walls.find(w=>p.x>w.rect.x0-.35&&p.x<w.rect.x1+.35&&p.z>w.rect.z0-.35&&p.z<w.rect.z1+.35);if(wall){crossings.push({segment:i,from:a,to:z,localPoint:p,wall});break;}}}
const result={scope:'CPU pre-adaptation evidence: v3 fixture site assigned the trusted v4 marker, shared candidate02 physical body; core unchanged, no GL or actor teleport acceptance',buildingId:b.id,point,court,expectedFacilityInside:false,actualFacilityInside:current,routeCrossings:crossings,route:npc.route};
writeFileSync('/tmp/yunshan-v4-city-core-baseline/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({expected:false,actual:current,wallCrossings:crossings.length,building:b.id}));
