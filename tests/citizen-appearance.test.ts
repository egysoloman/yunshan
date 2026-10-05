import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CitizenAppearancePool, citizenBodyHeight, citizenFaceStyle, createCitizenFaceTexture, describeCitizen } from '../src/rendering/citizen-appearance.ts';
import type { Citizen, SimState } from '../src/types.ts';

function resident(id='citizen-1'):Citizen{return {id,name:'林舟',districtId:'town',homeId:'home',workId:'work',role:'居民',position:{x:0,y:20,z:0},state:'moving',destinationId:null,money:40,needs:{hunger:80,fatigue:80,social:70,fun:60},tier:'active',route:[{x:0,y:20,z:50}],routeIndex:0};}
function state(citizens=[resident()]):SimState{return {citizens,vehicles:[],paused:false,extension:{actorProfiles:Object.fromEntries(citizens.map(c=>[c.id,{age:30,alive:true}]))},family:{ceremonies:[]}} as unknown as SimState;}
const matrices=(pool:CitizenAppearancePool)=>pool.group.children.map(object=>{const mesh=object as THREE.InstancedMesh;return Array.from(mesh.instanceMatrix.array).slice(0,mesh.count*16);});

test('resident anatomy has real adult stature, quantized solid limbs and stable individual clothing',()=>{
  const person=resident(),before=JSON.stringify(person),appearance=describeCitizen(person,{age:30,alive:true});
  assert.equal(appearance.height,1.8);assert(appearance.parts.some(p=>p.name==='head'));assert(appearance.parts.some(p=>p.name.startsWith('shoe')));assert(appearance.parts.some(p=>p.name.startsWith('hand')));
  for(const part of appearance.parts)for(const size of Object.values(part.size)){assert(size>=.2);assert(Math.abs(size/.2-Math.round(size/.2))<1e-7);}
  assert.deepEqual(describeCitizen(person,{age:30,alive:true}),appearance);assert.equal(JSON.stringify(person),before);
  const variants=new Set(Array.from({length:32},(_,i)=>{const a=describeCitizen(resident(`actor-${i}`),{age:30,alive:true});return `${a.clothing}/${a.hair}/${a.hat}/${a.bag}/${a.parts[0].color}`;}));assert(variants.size>=16);
  assert.deepEqual([1,4,10,16,30].map(citizenBodyHeight),[.6,1,1.2,1.6,1.8]);
  const child=describeCitizen(person,{age:4,alive:true});assert.equal(child.height,1);assert(child.parts.every(p=>p.position.y+p.size.y/2<=1+1e-7));
});

test('face ink uses one shared texture instead of eye or mouth boxes on every NPC',()=>{
  const texture=createCitizenFaceTexture();assert.equal(texture.image.width,32*6);assert.equal(texture.image.height,16);assert.equal(texture.magFilter,THREE.NearestFilter);
  const pixels=texture.image.data as Uint8Array;assert(pixels.some((v,i)=>i%4!==3&&v<100));texture.dispose();
  assert(describeCitizen(resident()).parts.every(p=>!['eye','mouth'].includes(p.name)));
});

test('actual near heads select age and mood atlas cells while shared clothes keep the crowd budget',()=>{
  const scene=new THREE.Scene(),s=state(),pool=new CitizenAppearancePool(scene),eye={x:0,y:21.72,z:5};
  try{
    pool.update(s,eye,0,1900);const heads=pool.group.children[1] as THREE.InstancedMesh,body=pool.group.children[0] as THREE.InstancedMesh;
    const styles=heads.geometry.getAttribute('instanceFaceStyle'),garments=body.geometry.getAttribute('instanceGarment');assert.equal(styles.getX(0),0);assert.equal(garments.getX(0)>0,true);
    const priorBudget={...pool.group.userData.budget},position={...s.citizens[0].position};s.extension!.actorProfiles['citizen-1'].age=73;pool.update(s,eye,1,1900);assert.equal(styles.getX(0),1);
    s.extension!.actorProfiles['citizen-1'].stress=85;pool.update(s,eye,2,1900);assert.equal(styles.getX(0),4);assert.deepEqual(pool.group.userData.budget,priorBudget);assert.deepEqual(s.citizens[0].position,position);
    assert.equal(citizenFaceStyle(10),2);assert.equal(citizenFaceStyle(10,20),5);
    const texture=(heads.material as THREE.MeshStandardMaterial).map as THREE.DataTexture,data=texture.image.data as Uint8Array,width=texture.image.width;
    const rgb=(style:number)=>Array.from(data.slice((15*width+style*32+20)*4,(15*width+style*32+20)*4+3));assert.notDeepEqual(rgb(0),rgb(1),'elder front hair ink is independent of adult brown hair');
  }finally{pool.dispose();}
});

test('elapsed render time and paused simulation never invent walking displacement or advance a step',()=>{
  const scene=new THREE.Scene(),pool=new CitizenAppearancePool(scene),s=state(),eye={x:0,y:21.72,z:5};
  try{
    const original=JSON.stringify(s);pool.update(s,eye,0,1900);const initial=matrices(pool);
    pool.update(s,eye,99999,1900);assert.deepEqual(matrices(pool),initial);assert.equal(JSON.stringify(s),original);
    s.paused=true;pool.update(s,eye,100000,1900);assert.deepEqual(matrices(pool),initial);
    s.paused=false;s.citizens[0].position.z+=.5;pool.update(s,eye,100001,1900);const walked=matrices(pool);assert.notDeepEqual(walked,initial);
    pool.update(s,eye,100002,1900);assert.deepEqual(matrices(pool),walked,'no further real move means no extra stride');
    s.citizens[0].state='riding';pool.update(s,eye,100003,1900);assert.notDeepEqual(matrices(pool),walked,'actual passengers have seated legs');
  }finally{pool.dispose();}assert.equal(scene.children.length,0);
});

test('large crowds stay in two shared draws and far residents omit faces and accessories',()=>{
  const scene=new THREE.Scene(),people=Array.from({length:616},(_,i)=>resident(`crowd-${i}`)),s=state(people),pool=new CitizenAppearancePool(scene);
  try{
    pool.update(s,{x:0,y:21.72,z:10},0,1900);const near=pool.group.userData.budget;
    assert.equal(near.residents,616);assert.equal(near.drawCalls,2);assert.equal(pool.group.children.length,2);assert(near.triangles<160000);
    pool.update(s,{x:0,y:21.72,z:600},1,1900);const far=pool.group.userData.budget;assert.equal(far.residents,616);assert.equal(far.faceInstances,0);assert.equal(far.drawCalls,1);assert(far.triangles<near.triangles);
    s.citizens[0].tier='statistical';pool.update(s,{x:0,y:21.72,z:600},2,1900);assert.equal(pool.group.userData.budget.residents,615);
  }finally{pool.dispose();pool.dispose();}
});

test('actual death renders a low corpse at the same location until the funeral finishes',()=>{
  const scene=new THREE.Scene(),s=state(),pool=new CitizenAppearancePool(scene),eye={x:0,y:21.72,z:5};
  try{
    pool.update(s,eye,0,1900);const living=matrices(pool);s.extension!.actorProfiles['citizen-1'].alive=false;s.citizens[0].state='dead';s.citizens[0].tier='statistical';const position={...s.citizens[0].position};
    pool.update(s,eye,1,1900);assert.equal(pool.group.userData.budget.corpses,1);assert.notDeepEqual(matrices(pool),living);assert.deepEqual(s.citizens[0].position,position);
    const body=pool.group.children[0] as THREE.InstancedMesh,matrix=new THREE.Matrix4();for(let i=0;i<body.count;i++){body.getMatrixAt(i,matrix);assert(matrix.elements[13]<position.y+.8,'dead bodies lie low rather than standing');}
    s.family!.ceremonies.push({kind:'funeral',subjectId:'citizen-1',completedAt:null} as never);pool.update(s,eye,2,1900);assert.equal(pool.group.userData.budget.corpses,1);
    s.family!.ceremonies[0].completedAt=3;pool.update(s,eye,3,1900);assert.equal(pool.group.userData.budget.residents,0);assert.deepEqual(s.citizens[0].position,position);
  }finally{pool.dispose();}
});
