import * as THREE from '/workspace/yunshan/node_modules/three/build/three.module.js';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWorld } from '/tmp/yunshan-phase3-root-coherent-03/src/world.ts';
import { PlayerController } from '/tmp/yunshan-phase3-root-coherent-03/src/controller.ts';
import { planWalkingJourney } from '/tmp/yunshan-phase3-root-coherent-03/src/journey.ts';
import { canAccessFloor } from '/tmp/yunshan-phase3-root-coherent-03/src/access.ts';
const root='/tmp/yunshan-phase3-root-coherent-03',file='/workspace/yunshan/artifacts/phase2-player-journey-r7-export/resume-ui-export.json';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const files=['src/world.ts','src/controller.ts','src/journey.ts','src/access.ts','src/transport-geometry.ts','src/site-fixtures.ts'];
async function hashes(){return Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(root+'/'+p))])));}
const before=await hashes(),bytes=await readFile(file),saved=JSON.parse(bytes.toString()),raw={...saved.state.player.position},world=createWorld(saved.worldSeed,'current-v2-r5');
const keyboard=Object.assign(new EventTarget(),{closest:()=>null}),doc=Object.assign(new EventTarget(),{pointerLockElement:null});
Object.defineProperty(globalThis,'window',{value:keyboard,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
const result:any={scope:'CPU readonly coherent03 actual unchanged PlayerController keyboard validation using unedited native r7 export; raw and public HUD rounded origin both checked. Not real browser progress, not GL or full navigation correctness. Root has requested shared counter start-access fix before04 live run.',root,exportFile:file,exportBytes:bytes.length,exportSHA256:sha(bytes),sourceHashesStart:before,cases:[]};
for(const from of [raw,{x:Math.round(raw.x),y:Math.round(raw.y),z:Math.round(raw.z)}]){
 const plan=planWalkingJourney(world,from,'academy-b13');if(!plan)throw new Error('Actual origin has no route');
 const endpoint=world.nodes.find(n=>n.id===plan.originNodeId)!;
 const endIndex=plan.points.findIndex(p=>Math.hypot(p.x-endpoint.position.x,p.y-endpoint.position.y,p.z-endpoint.position.z)<.01);
 const controller=new PlayerController(new THREE.PerspectiveCamera(),new EventTarget()as HTMLCanvasElement,world,()=>{},(b,f)=>canAccessFloor(b,f,saved.state.player),()=>saved.state.voxels??[]);
 controller.setMode('walk',raw);const down=new Event('keydown');Object.assign(down,{code:'KeyW',repeat:false});keyboard.dispatchEvent(down);
 const trace=[];
 try{
  for(const target of plan.points.slice(1,endIndex+1)){
   const initial=controller.position;let steps=0;
   while(steps++<4000){const body=controller.position,dx=target.x-body.x,dz=target.z-body.z,distance=Math.hypot(dx,dz);if(distance<.03)break;controller.yaw=Math.atan2(-dx,-dz);controller.step(Math.min(1/60,distance/4.8),false);}
   const end=controller.position,remaining=Math.hypot(end.x-target.x,end.z-target.z);trace.push({initial,target,end,steps,remaining});if(remaining>=.03)throw new Error('New prefix controller blocked '+JSON.stringify(trace.at(-1)));
  }
  result.cases.push({origin:from,actualRawControllerOrigin:raw,originNodeId:plan.originNodeId,edgeIds:plan.edgeIds,firstPoints:plan.points.slice(0,endIndex+1),totalMetres:plan.metres,trace,end:controller.position,inside:controller.inside?.id??null,passed:true});
 }finally{controller.dispose();}
}
result.sourceHashesEnd=await hashes();result.sourceUnchanged=JSON.stringify(before)===JSON.stringify(result.sourceHashesEnd);if(!result.sourceUnchanged)throw new Error('Copied source changed');
await writeFile('/workspace/yunshan/artifacts/phase2-player-journey-r7/coherent03-prefix-proof.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({scope:result.scope,sourceUnchanged:result.sourceUnchanged,cases:result.cases.map((c:any)=>({origin:c.origin,firstPoints:c.firstPoints,originNodeId:c.originNodeId,end:c.end,inside:c.inside,passed:c.passed}))}));
